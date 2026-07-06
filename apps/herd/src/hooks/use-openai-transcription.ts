import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import { getWsBase } from '@/lib/api-base'

interface RealtimeTranscriptionConfig {
  openaiConfigured: boolean
}

interface RealtimeProxyMessage {
  type?: unknown
  text?: unknown
  message?: unknown
  code?: unknown
}

interface RealtimeTranscriptionUrlOptions {
  language: string
  model?: string
  prompt?: string
  terms?: readonly string[]
}

const PCM16_SAMPLE_RATE = 24_000
const PCM16_BYTES_PER_SAMPLE = 2
const MIN_AUDIO_DURATION_MS = 100
const WS_OPEN = 1
const TRANSCRIPTION_WORKLET_URL = '/audio-processor.js'
const CLIENT_TIMING_SAMPLE_LIMIT = 100
const STARTUP_READY_TIMEOUT_MS = 30_000
const MAX_PENDING_SETUP_AUDIO_BYTES = PCM16_SAMPLE_RATE * PCM16_BYTES_PER_SAMPLE * 30

export const MIN_AUDIO_BYTES =
  (PCM16_SAMPLE_RATE * PCM16_BYTES_PER_SAMPLE * MIN_AUDIO_DURATION_MS) / 1000

type ClientTranscriptionPhase =
  | 'resume'
  | 'media'
  | 'worklet'
  | 'ticket'
  | 'ws-open'
  | 'ready'

type ClientTimingMetric = ClientTranscriptionPhase | 'capture-live' | 'ready-total'

type ClientStartTimingStatus =
  | 'ready'
  | 'setup-error'
  | 'cancelled'
  | 'socket-error'
  | 'socket-closed'
  | 'proxy-error'
  | 'short-audio'
  | 'startup-timeout'
  | 'buffer-overflow'
  | 'final'

type ClientPhaseOffsets = Partial<Record<ClientTranscriptionPhase, {
  startMs: number
  endMs?: number
}>>

type ClientPhaseMs = Partial<Record<ClientTranscriptionPhase, number>>

type ClientTimingStats = Partial<Record<ClientTimingMetric, {
  p50Ms: number
  p95Ms: number
  sampleCount: number
}>>

interface ClientStartTimingRecord {
  source: 'client'
  event: 'realtime_transcription_start_timing'
  sessionId: string
  status: ClientStartTimingStatus
  startedAtEpochMs: number
  totalMs: number
  captureLiveMs?: number
  readyTotalMs?: number
  phaseMs: ClientPhaseMs
  phaseOffsetsMs: ClientPhaseOffsets
  rollingStats: ClientTimingStats
}

const clientTimingMetricKeys: ClientTimingMetric[] = [
  'resume',
  'media',
  'worklet',
  'ticket',
  'ws-open',
  'ready',
  'capture-live',
  'ready-total',
]
const clientTimingSamples: Array<Partial<Record<ClientTimingMetric, number>>> = []
let clientTimingSequence = 0
let workletPreloadPromise: Promise<void> | null = null

export interface ActiveTranscriptionSession {
  ws: WebSocket
  mediaStream: MediaStream
  audioContext: AudioContext
  sourceNode: MediaStreamAudioSourceNode
  workletNode: AudioWorkletNode
  pendingStop: boolean
  finalizationTimer: number | null
  ready: boolean
  pendingChunks: ArrayBuffer[]
  totalBytesSent: number
  audioReleased?: boolean
  controllerId?: number
}

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext
type AudioWindow = Window & {
  AudioContext?: AudioContextConstructor
  webkitAudioContext?: AudioContextConstructor
}

export interface UseOpenAITranscriptionOptions {
  enabled?: boolean
  language?: string
  model?: string
  prompt?: string
  terms?: readonly string[]
  onShortAudio?: () => void
  onError?: (message: string) => void
}

export interface UseOpenAITranscriptionResult {
  isListening: boolean
  isConnecting: boolean
  transcript: string
  startListening: () => void
  stopListening: () => void
  isSupported: boolean
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function roundTimingMs(value: number): number {
  return Math.round(value * 10) / 10
}

function createClientTimingSessionId(): string {
  clientTimingSequence += 1
  return `rt-${Date.now().toString(36)}-${clientTimingSequence}`
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0
  }

  const sortedValues = values.slice().sort((first, second) => first - second)
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileValue / 100) * sortedValues.length) - 1,
  )
  return roundTimingMs(sortedValues[index] ?? 0)
}

function shouldRecordClientTimingSample(status: ClientStartTimingStatus): boolean {
  return status === 'ready' || status === 'final'
}

function recordClientTimingSample(
  status: ClientStartTimingStatus,
  metrics: Partial<Record<ClientTimingMetric, number>>,
): ClientTimingStats {
  if (shouldRecordClientTimingSample(status)) {
    clientTimingSamples.push(metrics)
    if (clientTimingSamples.length > CLIENT_TIMING_SAMPLE_LIMIT) {
      clientTimingSamples.shift()
    }
  }

  const stats: ClientTimingStats = {}
  for (const key of clientTimingMetricKeys) {
    const values = clientTimingSamples
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (values.length === 0) {
      continue
    }
    stats[key] = {
      p50Ms: percentile(values, 50),
      p95Ms: percentile(values, 95),
      sampleCount: values.length,
    }
  }

  return stats
}

function emitClientStartTimingRecord(record: ClientStartTimingRecord): void {
  console.debug('[openai-transcription] mic-start-timings', record)
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return
  }

  try {
    window.dispatchEvent(new CustomEvent('herd:realtime-transcription-timing', {
      detail: record,
    }))
  } catch {
    // Debug telemetry must never interfere with mic startup.
  }
}

function createClientStartTiming() {
  const sessionId = createClientTimingSessionId()
  const startedAtMs = nowMs()
  const startedAtEpochMs = Date.now()
  const phases: Partial<Record<ClientTranscriptionPhase, {
    startedAtMs: number
    endedAtMs?: number
  }>> = {}
  let captureLiveAtMs: number | null = null
  let readyAtMs: number | null = null
  let emitted = false

  const markStart = (phase: ClientTranscriptionPhase) => {
    if (typeof phases[phase]?.startedAtMs === 'number') {
      return
    }
    phases[phase] = {
      startedAtMs: nowMs(),
    }
  }

  const markEnd = (phase: ClientTranscriptionPhase) => {
    const phaseTiming = phases[phase]
    if (!phaseTiming || typeof phaseTiming.endedAtMs === 'number') {
      return
    }
    phaseTiming.endedAtMs = nowMs()
  }

  const markCaptureLive = () => {
    if (captureLiveAtMs === null) {
      captureLiveAtMs = nowMs()
    }
  }

  const markReady = () => {
    if (readyAtMs === null) {
      readyAtMs = nowMs()
    }
    markEnd('ready')
  }

  const emit = (status: ClientStartTimingStatus): ClientStartTimingRecord | null => {
    if (emitted) {
      return null
    }
    emitted = true

    const recordedAtMs = status === 'ready' && readyAtMs !== null ? readyAtMs : nowMs()
    const phaseMs: ClientPhaseMs = {}
    const phaseOffsetsMs: ClientPhaseOffsets = {}

    for (const [phase, timing] of Object.entries(phases) as Array<[
      ClientTranscriptionPhase,
      { startedAtMs: number; endedAtMs?: number },
    ]>) {
      phaseOffsetsMs[phase] = {
        startMs: roundTimingMs(timing.startedAtMs - startedAtMs),
        ...(typeof timing.endedAtMs === 'number'
          ? { endMs: roundTimingMs(timing.endedAtMs - startedAtMs) }
          : {}),
      }
      if (typeof timing.endedAtMs === 'number') {
        phaseMs[phase] = roundTimingMs(timing.endedAtMs - timing.startedAtMs)
      }
    }

    const captureLiveMs =
      captureLiveAtMs === null ? undefined : roundTimingMs(captureLiveAtMs - startedAtMs)
    const readyTotalMs =
      readyAtMs === null ? undefined : roundTimingMs(readyAtMs - startedAtMs)
    const rollingStats = recordClientTimingSample(status, {
      ...phaseMs,
      ...(typeof captureLiveMs === 'number' ? { 'capture-live': captureLiveMs } : {}),
      ...(typeof readyTotalMs === 'number' ? { 'ready-total': readyTotalMs } : {}),
    })
    const record: ClientStartTimingRecord = {
      source: 'client',
      event: 'realtime_transcription_start_timing',
      sessionId,
      status,
      startedAtEpochMs,
      totalMs: roundTimingMs(recordedAtMs - startedAtMs),
      ...(typeof captureLiveMs === 'number' ? { captureLiveMs } : {}),
      ...(typeof readyTotalMs === 'number' ? { readyTotalMs } : {}),
      phaseMs,
      phaseOffsetsMs,
      rollingStats,
    }

    emitClientStartTimingRecord(record)
    return record
  }

  return {
    markStart,
    markEnd,
    markCaptureLive,
    markReady,
    emit,
  }
}

function getTranscriptionSetupErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? asNonEmptyString(error.message)
      : typeof error === 'string'
        ? asNonEmptyString(error)
        : null

  return message
    ? `Unable to start realtime transcription: ${message}`
    : 'Unable to start realtime transcription'
}

function normalizeLanguage(value: string): string {
  const normalized = value.trim()
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(normalized)) {
    return 'en'
  }
  return normalized
}

function resolveAudioContextConstructor(targetWindow: AudioWindow): AudioContextConstructor | null {
  return targetWindow.AudioContext ?? targetWindow.webkitAudioContext ?? null
}

function browserSupportsOpenAITranscription(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const audioWindow = window as AudioWindow
  return (
    Boolean(resolveAudioContextConstructor(audioWindow)) &&
    typeof window.AudioWorkletNode !== 'undefined' &&
    typeof window.WebSocket !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

async function issueRealtimeTranscriptionTicket(): Promise<string | null> {
  const response = await fetchJson<{ ticket?: unknown }>('/api/realtime/transcription-ticket', {
    method: 'POST',
  })
  return typeof response.ticket === 'string' && response.ticket.trim().length > 0
    ? response.ticket.trim()
    : null
}

export function preloadOpenAITranscriptionWorklet(): Promise<void> {
  if (typeof fetch !== 'function') {
    return Promise.resolve()
  }

  if (!workletPreloadPromise) {
    workletPreloadPromise = fetch(TRANSCRIPTION_WORKLET_URL, {
      cache: 'force-cache',
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to preload ${TRANSCRIPTION_WORKLET_URL}: ${response.status}`)
      }
    }).catch((error) => {
      workletPreloadPromise = null
      console.debug('[openai-transcription] worklet-preload-failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return workletPreloadPromise
}

function buildRealtimeTranscriptionUrl(
  ticket: string | null,
  options: RealtimeTranscriptionUrlOptions,
): string {
  const params = new URLSearchParams()
  if (ticket) {
    params.set('ticket', ticket)
  }
  params.set('language', normalizeLanguage(options.language))
  const model = asNonEmptyString(options.model)
  if (model) {
    params.set('model', model)
  }
  const prompt = asNonEmptyString(options.prompt)
  if (prompt) {
    params.set('prompt', prompt)
  }
  for (const term of options.terms ?? []) {
    const normalizedTerm = asNonEmptyString(term)
    if (normalizedTerm) {
      params.append('term', normalizedTerm)
    }
  }
  const query = params.toString()
  const querySuffix = query.length > 0 ? `?${query}` : ''
  const wsBase = getWsBase()

  if (wsBase) {
    return `${wsBase}/api/realtime/transcription${querySuffix}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/realtime/transcription${querySuffix}`
}

function parseRealtimeProxyMessage(data: unknown): RealtimeProxyMessage | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    return JSON.parse(data) as RealtimeProxyMessage
  } catch {
    return null
  }
}

function isSocketOpen(socket: Pick<WebSocket, 'readyState'>): boolean {
  return socket.readyState === WS_OPEN
}

function sendAudioChunk(
  session: Pick<ActiveTranscriptionSession, 'ws' | 'totalBytesSent'>,
  chunk: ArrayBuffer,
): boolean {
  if (!isSocketOpen(session.ws)) {
    return false
  }
  session.ws.send(chunk)
  session.totalBytesSent += chunk.byteLength
  return true
}

function getPendingChunkBytes(chunks: ArrayBuffer[]): number {
  return chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
}

export function getBufferedTranscript(
  transcriptSegments: readonly string[],
  partialTranscript: string,
): string {
  const combinedTranscript = transcriptSegments.join(' ').trim()
  if (combinedTranscript) {
    return combinedTranscript
  }
  return partialTranscript.trim()
}

export function hasBufferedTranscript(
  transcriptSegments: readonly string[],
  partialTranscript: string,
): boolean {
  return getBufferedTranscript(transcriptSegments, partialTranscript).length > 0
}

export function relayAudioChunk(
  session: Pick<
    ActiveTranscriptionSession,
    'ws' | 'ready' | 'pendingStop' | 'pendingChunks' | 'totalBytesSent'
  >,
  chunk: ArrayBuffer,
): 'queued' | 'sent' | 'skipped' {
  if (session.pendingStop) {
    return 'skipped'
  }
  if (!session.ready) {
    session.pendingChunks.push(chunk)
    return 'queued'
  }
  return sendAudioChunk(session, chunk) ? 'sent' : 'skipped'
}

export function flushPendingAudioChunks(
  session: Pick<ActiveTranscriptionSession, 'ws' | 'pendingChunks' | 'totalBytesSent'>,
): number {
  const pendingChunks = session.pendingChunks.splice(0, session.pendingChunks.length)
  let flushedCount = 0

  for (const chunk of pendingChunks) {
    if (sendAudioChunk(session, chunk)) {
      flushedCount += 1
    }
  }

  return flushedCount
}

function hasMinimumBufferedAudio(
  session: Pick<ActiveTranscriptionSession, 'pendingChunks' | 'totalBytesSent'>,
): boolean {
  return session.totalBytesSent + getPendingChunkBytes(session.pendingChunks) >= MIN_AUDIO_BYTES
}

interface StopTranscriptionSessionOptions {
  session: ActiveTranscriptionSession | null
  onShortAudio?: () => void
  closeSession: () => void
  releaseAudioCapture: (session: ActiveTranscriptionSession) => void
  setIsListening: (listening: boolean) => void
  scheduleFinalization: (callback: () => void, delayMs: number) => number
  onFinalizeTimeout?: () => void
}

class TranscriptionSetupCancelledError extends Error {
  constructor() {
    super('Realtime transcription setup cancelled')
  }
}

class TranscriptionSetupFailedError extends Error {
  constructor(
    message: string,
    readonly status: ClientStartTimingStatus = 'setup-error',
  ) {
    super(message)
  }
}

interface TranscriptionStartController {
  id: number
  timing: ReturnType<typeof createClientStartTiming>
  audioContext: AudioContext
  audioContextResume: Promise<void>
  mediaStream: MediaStream | null
  sourceNode: MediaStreamAudioSourceNode | null
  workletNode: AudioWorkletNode | null
  ws: WebSocket | null
  session: ActiveTranscriptionSession | null
  pendingChunks: ArrayBuffer[]
  stopRequested: boolean
  failed: boolean
  cancelled: boolean
  cleanedUp: boolean
  timingEmitted: boolean
  captureLive: boolean
  audioReleased: boolean
  finalizationTimer: number | null
  readyTimeout: number | null
  errorNotified: boolean
  shortAudioNotified: boolean
}

function stopMediaStreamTracks(mediaStream: MediaStream | null): void {
  if (!mediaStream) {
    return
  }

  for (const track of mediaStream.getTracks()) {
    track.stop()
  }
}

function clearSessionFinalizationTimer(session: ActiveTranscriptionSession): void {
  if (session.finalizationTimer !== null) {
    window.clearTimeout(session.finalizationTimer)
    session.finalizationTimer = null
  }
}

export function stopTranscriptionSession({
  session,
  onShortAudio,
  closeSession,
  releaseAudioCapture,
  setIsListening,
  scheduleFinalization,
  onFinalizeTimeout,
}: StopTranscriptionSessionOptions): { stopped: boolean; tooShort: boolean } {
  if (!session) {
    return { stopped: false, tooShort: false }
  }

  if (!hasMinimumBufferedAudio(session)) {
    onShortAudio?.()
    closeSession()
    return { stopped: true, tooShort: true }
  }

  session.pendingStop = true
  setIsListening(false)
  releaseAudioCapture(session)

  if (session.ready) {
    flushPendingAudioChunks(session)
  }

  if (session.ready && isSocketOpen(session.ws)) {
    session.ws.send(JSON.stringify({ type: 'commit' }))

    session.finalizationTimer = scheduleFinalization(() => {
      onFinalizeTimeout?.()
      closeSession()
    }, 10000)
  }

  return { stopped: true, tooShort: false }
}

async function fetchRealtimeTranscriptionConfig(): Promise<RealtimeTranscriptionConfig> {
  return fetchJson<RealtimeTranscriptionConfig>('/api/realtime/config')
}

export function useOpenAITranscriptionConfig() {
  return useQuery({
    queryKey: ['realtime', 'transcription', 'config'],
    queryFn: fetchRealtimeTranscriptionConfig,
    refetchInterval: 15_000,
  })
}

export function useOpenAITranscription(
  options: UseOpenAITranscriptionOptions = {},
): UseOpenAITranscriptionResult {
  const enabled = options.enabled ?? true
  const language = options.language ?? 'en'
  const model = options.model
  const prompt = options.prompt
  const terms = options.terms
  const onShortAudioRef = useRef(options.onShortAudio)
  const onErrorRef = useRef(options.onError)
  const [isListening, setIsListening] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [transcript, setTranscript] = useState('')
  const sessionRef = useRef<ActiveTranscriptionSession | null>(null)
  const startControllerRef = useRef<TranscriptionStartController | null>(null)
  const startGenerationRef = useRef(0)
  const partialTranscriptRef = useRef('')
  const transcriptSegmentsRef = useRef<string[]>([])

  onShortAudioRef.current = options.onShortAudio
  onErrorRef.current = options.onError

  const isSupported = useMemo(
    () => enabled && browserSupportsOpenAITranscription(),
    [enabled],
  )

  const releaseAudioCapture = useCallback((session: ActiveTranscriptionSession) => {
    if (session.audioReleased) {
      return
    }
    session.audioReleased = true
    session.workletNode.port.onmessage = null
    try {
      session.sourceNode.disconnect()
    } catch {
      // no-op
    }
    try {
      session.workletNode.disconnect()
    } catch {
      // no-op
    }
    stopMediaStreamTracks(session.mediaStream)
    void session.audioContext.close().catch(() => undefined)
  }, [])

  const releaseControllerAudio = useCallback((controller: TranscriptionStartController) => {
    if (controller.audioReleased) {
      return
    }
    controller.audioReleased = true

    if (controller.workletNode) {
      controller.workletNode.port.onmessage = null
      try {
        controller.workletNode.disconnect()
      } catch {
        // no-op
      }
    }

    if (controller.sourceNode) {
      try {
        controller.sourceNode.disconnect()
      } catch {
        // no-op
      }
    }

    stopMediaStreamTracks(controller.mediaStream)
    void controller.audioContext.close().catch(() => undefined)
  }, [])

  const finalizeController = useCallback((
    controller: TranscriptionStartController,
    status: ClientStartTimingStatus,
    options: {
      closeSocket?: boolean
      keepSession?: boolean
      errorMessage?: string
      notifyShortAudio?: boolean
    } = {},
  ) => {
    const closeSocket = options.closeSocket !== false

    if (status === 'cancelled') {
      controller.cancelled = true
    } else if (status !== 'ready' && status !== 'final') {
      controller.failed = true
    }

    if (options.errorMessage && !controller.errorNotified) {
      controller.errorNotified = true
      onErrorRef.current?.(options.errorMessage)
    }

    if (options.notifyShortAudio && !controller.shortAudioNotified) {
      controller.shortAudioNotified = true
      onShortAudioRef.current?.()
    }

    if (!controller.timingEmitted) {
      controller.timingEmitted = true
      controller.timing.emit(status)
    }

    if (controller.readyTimeout !== null) {
      window.clearTimeout(controller.readyTimeout)
      controller.readyTimeout = null
    }

    if (options.keepSession) {
      setIsConnecting(false)
      return
    }

    if (controller.cleanedUp) {
      return
    }
    controller.cleanedUp = true

    const session = controller.session
    if (session) {
      clearSessionFinalizationTimer(session)
      releaseAudioCapture(session)
      if (sessionRef.current === session) {
        sessionRef.current = null
      }
    } else {
      releaseControllerAudio(controller)
    }

    if (closeSocket && controller.ws && controller.ws.readyState <= WebSocket.OPEN) {
      controller.ws.close()
    }

    if (startControllerRef.current === controller) {
      startControllerRef.current = null
    }

    setIsListening(false)
    setIsConnecting(false)
  }, [releaseAudioCapture, releaseControllerAudio])

  const closeSession = useCallback((options: { closeSocket?: boolean } = {}) => {
    const controller = startControllerRef.current
    if (controller?.session) {
      finalizeController(controller, 'cancelled', {
        closeSocket: options.closeSocket,
      })
      return
    }
    if (controller) {
      finalizeController(controller, 'cancelled', {
        closeSocket: options.closeSocket,
      })
      return
    }

    const session = sessionRef.current
    if (!session) {
      return
    }

    sessionRef.current = null
    clearSessionFinalizationTimer(session)
    releaseAudioCapture(session)

    if (options.closeSocket !== false && session.ws.readyState <= WebSocket.OPEN) {
      session.ws.close()
    }

    setIsListening(false)
    setIsConnecting(false)
  }, [finalizeController, releaseAudioCapture])

  useEffect(() => {
    return () => {
      closeSession()
    }
  }, [closeSession])

  const finalizeTranscript = useCallback(() => {
    const bufferedTranscript = getBufferedTranscript(
      transcriptSegmentsRef.current,
      partialTranscriptRef.current,
    )
    if (bufferedTranscript) {
      setTranscript(bufferedTranscript)
    }
  }, [])

  const isControllerActive = useCallback((controller: TranscriptionStartController) => (
    startControllerRef.current === controller &&
    !controller.cancelled &&
    !controller.failed &&
    !controller.cleanedUp
  ), [])

  const assertControllerActive = useCallback((controller: TranscriptionStartController) => {
    if (!isControllerActive(controller)) {
      throw new TranscriptionSetupCancelledError()
    }
  }, [isControllerActive])

  const appendPendingAudioChunk = useCallback((
    controller: TranscriptionStartController,
    chunk: ArrayBuffer,
  ): boolean => {
    if (!isControllerActive(controller)) {
      return false
    }

    const nextPendingBytes = getPendingChunkBytes(controller.pendingChunks) + chunk.byteLength
    if (nextPendingBytes > MAX_PENDING_SETUP_AUDIO_BYTES) {
      finalizeController(controller, 'buffer-overflow', {
        errorMessage: 'Realtime transcription startup buffered too much audio before ready',
      })
      return false
    }

    controller.pendingChunks.push(chunk)
    return true
  }, [finalizeController, isControllerActive])

  const scheduleStopCommit = useCallback((
    controller: TranscriptionStartController,
    session: ActiveTranscriptionSession,
  ) => {
    if (!isControllerActive(controller) || session.finalizationTimer !== null) {
      return
    }

    flushPendingAudioChunks(session)
    if (isSocketOpen(session.ws)) {
      session.ws.send(JSON.stringify({ type: 'commit' }))
    }

    session.finalizationTimer = window.setTimeout(() => {
      finalizeController(controller, 'startup-timeout', {
        errorMessage: 'Realtime transcription timed out',
      })
    }, 10000)
  }, [finalizeController, isControllerActive])

  const requestStopForSession = useCallback((
    controller: TranscriptionStartController,
    session: ActiveTranscriptionSession,
  ): { stopped: boolean; tooShort: boolean } => {
    if (!hasMinimumBufferedAudio(session)) {
      finalizeController(controller, 'short-audio', {
        notifyShortAudio: true,
      })
      return { stopped: true, tooShort: true }
    }

    session.pendingStop = true
    controller.stopRequested = true
    setIsListening(false)
    releaseAudioCapture(session)

    if (session.ready) {
      scheduleStopCommit(controller, session)
    } else {
      setIsConnecting(true)
    }

    return { stopped: true, tooShort: false }
  }, [finalizeController, releaseAudioCapture, scheduleStopCommit])

  const startListening = useCallback(() => {
    if (!isSupported) {
      return
    }

    if (sessionRef.current || startControllerRef.current) {
      if (startControllerRef.current?.stopRequested) {
        onErrorRef.current?.('Realtime transcription is still finalizing the previous recording')
      }
      return
    }

    setTranscript('')
    setIsConnecting(false)
    partialTranscriptRef.current = ''
    transcriptSegmentsRef.current = []
    const timing = createClientStartTiming()

    const audioWindow = window as AudioWindow
    const AudioContextCtor = resolveAudioContextConstructor(audioWindow)
    if (!AudioContextCtor) {
      timing.emit('setup-error')
      onErrorRef.current?.('AudioContext is not available')
      return
    }

    let audioContext: AudioContext
    let audioContextResume: Promise<void>
    try {
      audioContext = new AudioContextCtor()
      timing.markStart('resume')
      audioContextResume = audioContext.resume().then(
        () => {
          timing.markEnd('resume')
        },
        (error) => {
          timing.markEnd('resume')
          throw error
        },
      )
    } catch (error) {
      timing.emit('setup-error')
      onErrorRef.current?.(getTranscriptionSetupErrorMessage(error))
      return
    }

    startGenerationRef.current += 1
    const controller: TranscriptionStartController = {
      id: startGenerationRef.current,
      timing,
      audioContext,
      audioContextResume,
      mediaStream: null,
      sourceNode: null,
      workletNode: null,
      ws: null,
      session: null,
      pendingChunks: [],
      stopRequested: false,
      failed: false,
      cancelled: false,
      cleanedUp: false,
      timingEmitted: false,
      captureLive: false,
      audioReleased: false,
      finalizationTimer: null,
      readyTimeout: null,
      errorNotified: false,
      shortAudioNotified: false,
    }
    startControllerRef.current = controller
    const clearReadyTimeout = () => {
      if (controller.readyTimeout !== null) {
        window.clearTimeout(controller.readyTimeout)
        controller.readyTimeout = null
      }
    }
    const waitForStoppedPreReadyFinal = (
      session: ActiveTranscriptionSession,
      status: ClientStartTimingStatus,
      errorMessage?: string,
    ): boolean => {
      if (!isControllerActive(controller) || !session.pendingStop || session.ready) {
        return false
      }
      if (session.finalizationTimer !== null) {
        return true
      }
      if (!hasMinimumBufferedAudio(session) || !isSocketOpen(session.ws)) {
        return false
      }

      clearReadyTimeout()
      flushPendingAudioChunks(session)
      if (!hasMinimumBufferedAudio(session) || !isSocketOpen(session.ws)) {
        return false
      }

      session.ws.send(JSON.stringify({ type: 'commit' }))
      setIsListening(false)
      setIsConnecting(true)
      session.finalizationTimer = window.setTimeout(() => {
        finalizeController(controller, status, errorMessage ? { errorMessage } : undefined)
      }, 10000)
      return true
    }
    const armReadyTimeout = () => {
      if (controller.readyTimeout !== null || !isControllerActive(controller)) {
        return
      }
      controller.readyTimeout = window.setTimeout(() => {
        if (controller.session && waitForStoppedPreReadyFinal(
          controller.session,
          'startup-timeout',
          'Realtime transcription startup timed out',
        )) {
          return
        }
        finalizeController(controller, 'startup-timeout', {
          errorMessage: 'Realtime transcription startup timed out',
        })
      }, STARTUP_READY_TIMEOUT_MS)
    }
    setIsConnecting(true)

    const failSetup = (
      status: ClientStartTimingStatus,
      error: unknown,
      message = getTranscriptionSetupErrorMessage(error),
    ) => {
      if (controller.cleanedUp || controller.failed || controller.cancelled) {
        return
      }
      finalizeController(controller, status, {
        errorMessage: message,
      })
    }

    const setupAudioGraph = async () => {
      await controller.audioContextResume
      assertControllerActive(controller)

      timing.markStart('media')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      timing.markEnd('media')
      if (!isControllerActive(controller)) {
        stopMediaStreamTracks(stream)
        throw new TranscriptionSetupCancelledError()
      }
      controller.mediaStream = stream
      assertControllerActive(controller)
      armReadyTimeout()

      timing.markStart('worklet')
      await audioContext.audioWorklet.addModule(TRANSCRIPTION_WORKLET_URL)
      timing.markEnd('worklet')
      assertControllerActive(controller)

      const nextSourceNode = audioContext.createMediaStreamSource(stream)
      const nextWorkletNode = new AudioWorkletNode(audioContext, 'pcm16-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        processorOptions: {
          targetSampleRate: 24000,
        },
      })
      controller.sourceNode = nextSourceNode
      controller.workletNode = nextWorkletNode
      nextWorkletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!(event.data instanceof ArrayBuffer) || controller.stopRequested) {
          return
        }
        appendPendingAudioChunk(controller, event.data)
      }
      nextSourceNode.connect(nextWorkletNode)
      assertControllerActive(controller)
      timing.markCaptureLive()
      controller.captureLive = true
      setIsListening(true)
    }

    const setupSocket = async () => {
      await controller.audioContextResume
      assertControllerActive(controller)

      timing.markStart('ticket')
      const ticket = await issueRealtimeTranscriptionTicket()
      timing.markEnd('ticket')
      assertControllerActive(controller)

      const nextWs = new WebSocket(buildRealtimeTranscriptionUrl(ticket, {
        language,
        model,
        prompt,
        terms,
      }))
      controller.ws = nextWs
      nextWs.binaryType = 'arraybuffer'

      timing.markStart('ws-open')
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const rejectOpen = (message: string, status: ClientStartTimingStatus) => {
          if (settled) {
            return
          }
          settled = true
          reject(new TranscriptionSetupFailedError(message, status))
        }

        nextWs.onopen = () => {
          if (settled) {
            return
          }
          if (!isControllerActive(controller)) {
            nextWs.close()
            rejectOpen('Realtime transcription setup cancelled', 'cancelled')
            return
          }
          settled = true
          timing.markEnd('ws-open')
          resolve()
        }

        nextWs.onerror = () => {
          rejectOpen('Realtime transcription connection failed', 'socket-error')
        }

        nextWs.onclose = () => {
          rejectOpen('Realtime transcription connection closed before it opened', 'socket-closed')
        }
      })

      assertControllerActive(controller)
      nextWs.onclose = () => {
        if (!controller.session && isControllerActive(controller)) {
          finalizeController(controller, 'socket-closed', {
            closeSocket: false,
          })
        }
      }
      nextWs.onerror = () => {
        if (!controller.session && isControllerActive(controller)) {
          finalizeController(controller, 'socket-error', {
            closeSocket: false,
            errorMessage: 'Realtime transcription connection failed',
          })
        }
      }
      return nextWs
    }

    const setup = async () => {
      const audioGraphPromise = setupAudioGraph().catch((error) => {
        if (error instanceof TranscriptionSetupCancelledError) {
          throw error
        }
        failSetup(
          error instanceof TranscriptionSetupFailedError ? error.status : 'setup-error',
          error,
          error instanceof TranscriptionSetupFailedError ? error.message : undefined,
        )
        throw error
      })
      const socketPromise = setupSocket().catch((error) => {
        if (error instanceof TranscriptionSetupCancelledError) {
          throw error
        }
        failSetup(
          error instanceof TranscriptionSetupFailedError ? error.status : 'socket-error',
          error,
          error instanceof TranscriptionSetupFailedError ? error.message : undefined,
        )
        throw error
      })

      const [audioResult, socketResult] = await Promise.allSettled([
        audioGraphPromise,
        socketPromise,
      ])
      if (audioResult.status === 'rejected' || socketResult.status === 'rejected') {
        if (audioResult.status === 'rejected' && audioResult.reason instanceof TranscriptionSetupCancelledError) {
          finalizeController(controller, 'cancelled')
        }
        if (socketResult.status === 'rejected' && socketResult.reason instanceof TranscriptionSetupCancelledError) {
          finalizeController(controller, 'cancelled')
        }
        return
      }
      assertControllerActive(controller)

      if (!controller.mediaStream || !controller.sourceNode || !controller.workletNode || !controller.ws) {
        throw new Error('Audio graph setup did not complete')
      }

      const activeSession: ActiveTranscriptionSession = {
        ws: controller.ws,
        mediaStream: controller.mediaStream,
        audioContext,
        sourceNode: controller.sourceNode,
        workletNode: controller.workletNode,
        pendingStop: controller.stopRequested,
        finalizationTimer: null,
        ready: false,
        pendingChunks: controller.pendingChunks,
        totalBytesSent: 0,
        audioReleased: controller.audioReleased,
        controllerId: controller.id,
      }
      controller.session = activeSession
      sessionRef.current = activeSession

      activeSession.workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (sessionRef.current !== activeSession || activeSession.pendingStop) {
          return
        }
        if (event.data instanceof ArrayBuffer) {
          if (activeSession.ready) {
            relayAudioChunk(activeSession, event.data)
          } else {
            appendPendingAudioChunk(controller, event.data)
          }
        }
      }

      activeSession.ws.onmessage = (event) => {
        if (sessionRef.current !== activeSession) {
          return
        }

        const message = parseRealtimeProxyMessage(event.data)
        if (!message) {
          return
        }

        const messageType = asNonEmptyString(message.type)
        if (!messageType) {
          return
        }

        if (messageType === 'ready') {
          if (!activeSession.ready) {
            activeSession.ready = true
            timing.markReady()
            setIsConnecting(false)
            flushPendingAudioChunks(activeSession)
            finalizeController(controller, 'ready', {
              keepSession: true,
            })
            if (activeSession.pendingStop) {
              scheduleStopCommit(controller, activeSession)
            }
          }
          return
        }

        if (messageType === 'partial') {
          if (!activeSession.pendingStop) {
            return
          }
          const partialText = asNonEmptyString(message.text)
          if (partialText) {
            partialTranscriptRef.current = partialText
          }
          return
        }

        if (messageType === 'final') {
          if (!activeSession.pendingStop) {
            return
          }
          const finalText = asNonEmptyString(message.text)
          const fallback = partialTranscriptRef.current.trim()
          const segment = finalText ?? (fallback.length > 0 ? fallback : null)
          if (segment) {
            transcriptSegmentsRef.current.push(segment)
          }
          partialTranscriptRef.current = ''

          if (activeSession.pendingStop) {
            finalizeTranscript()
            finalizeController(controller, 'final', {
              closeSocket: false,
            })
          }
          return
        }

        if (messageType === 'error') {
          const errorCode = asNonEmptyString(message.code)
          if (errorCode === 'audio_too_short') {
            finalizeController(controller, 'short-audio', {
              notifyShortAudio: true,
            })
            return
          }

          const proxyMessage = asNonEmptyString(message.message)
          if (waitForStoppedPreReadyFinal(activeSession, 'proxy-error', proxyMessage ?? undefined)) {
            return
          }
          if (
            activeSession.pendingStop &&
            hasBufferedTranscript(transcriptSegmentsRef.current, partialTranscriptRef.current)
          ) {
            finalizeTranscript()
          }
          if (proxyMessage) {
            finalizeController(controller, 'proxy-error', {
              closeSocket: false,
              errorMessage: proxyMessage,
            })
            return
          }
          finalizeController(controller, 'proxy-error', {
            closeSocket: false,
          })
        }
      }

      activeSession.ws.onclose = () => {
        if (sessionRef.current !== activeSession) {
          return
        }
        if (
          activeSession.pendingStop &&
          hasBufferedTranscript(transcriptSegmentsRef.current, partialTranscriptRef.current)
        ) {
          finalizeTranscript()
        }
        finalizeController(controller, 'socket-closed', {
          closeSocket: false,
        })
      }

      activeSession.ws.onerror = () => {
        if (sessionRef.current !== activeSession) {
          return
        }
        finalizeController(controller, 'socket-error', {
          closeSocket: false,
          errorMessage: 'Realtime transcription connection failed',
        })
      }

      if (controller.stopRequested && !hasMinimumBufferedAudio(activeSession)) {
        finalizeController(controller, 'short-audio', {
          notifyShortAudio: true,
        })
        return
      }

      if (controller.stopRequested) {
        activeSession.pendingStop = true
        setIsListening(false)
        releaseAudioCapture(activeSession)
      }

      assertControllerActive(controller)
      timing.markStart('ready')
      activeSession.ws.send(JSON.stringify({ type: 'start' }))
    }

    void setup().catch((error) => {
      if (error instanceof TranscriptionSetupCancelledError) {
        finalizeController(controller, 'cancelled')
        return
      }
      finalizeController(controller, 'setup-error', {
        errorMessage: getTranscriptionSetupErrorMessage(error),
      })
    })
  }, [
    appendPendingAudioChunk,
    assertControllerActive,
    finalizeController,
    finalizeTranscript,
    isControllerActive,
    isSupported,
    language,
    model,
    prompt,
    releaseAudioCapture,
    scheduleStopCommit,
    terms,
  ])

  const stopListening = useCallback(() => {
    const controller = startControllerRef.current
    if (controller?.session) {
      requestStopForSession(controller, controller.session)
      return
    }

    if (controller) {
      controller.stopRequested = true
      setIsListening(false)
      if (!controller.captureLive || getPendingChunkBytes(controller.pendingChunks) < MIN_AUDIO_BYTES) {
        finalizeController(controller, 'short-audio', {
          notifyShortAudio: true,
        })
        return
      }

      releaseControllerAudio(controller)
      setIsConnecting(true)
      return
    }

    const result = stopTranscriptionSession({
      session: sessionRef.current,
      onShortAudio: () => {
        onShortAudioRef.current?.()
      },
      closeSession,
      releaseAudioCapture,
      setIsListening,
      scheduleFinalization: (callback, delayMs) => window.setTimeout(callback, delayMs),
      onFinalizeTimeout: () => {
        onErrorRef.current?.('Realtime transcription timed out')
      },
    })
    if (result.stopped) {
      setIsConnecting(false)
    }
  }, [
    closeSession,
    finalizeController,
    releaseAudioCapture,
    releaseControllerAudio,
    requestStopForSession,
  ])

  return {
    isListening,
    isConnecting,
    transcript,
    startListening,
    stopListening,
    isSupported,
  }
}
