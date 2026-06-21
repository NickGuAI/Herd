import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  type PendingApproval,
  useApprovalDecision,
  usePendingApprovals,
} from '@/hooks/use-approvals'
import {
  fetchJson,
  fetchVoid,
  isAuthRecoveryRequiredError,
} from '../../../src/lib/api'
import { getWsBase } from '../../../src/lib/api-base'
import { issueAgentSessionStreamTicket } from '../../../src/hooks/use-agent-session-stream'
import Transcript from '../../agents/components/Transcript'
import type { MsgItem } from '../../agents/messages/model'
import { createReconnectBackoff, shouldReconnectWebSocketClose } from '../../agents/ws-reconnect'
import ApprovalCard from '../../approvals/ApprovalCard'

const MAX_WIZARD_LINES = 400

type WizardLineRole = 'assistant' | 'user' | 'system'

interface WizardLine {
  id: number
  role: WizardLineRole
  text: string
  completionText?: string
  completionMode?: 'append'
}

interface WizardStartResponse {
  sessionName: string
  created: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function splitLines(raw: string): string[] {
  return raw
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function normalizeMessageText(raw: string): string | null {
  const normalized = raw.replaceAll('\r', '').trim()
  return normalized.length > 0 ? normalized : null
}

function assistantLinesFromPayload(payload: Record<string, unknown>): string[] {
  const message = payload.message
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return []
  }

  const lines: string[] = []
  for (const block of message.content) {
    if (!isRecord(block)) {
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = normalizeMessageText(block.text)
      if (text) {
        lines.push(text)
      }
      continue
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      const text = normalizeMessageText(block.thinking)
      if (text) {
        lines.push(text)
      }
      continue
    }
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      lines.push(`[tool] ${block.name}`)
    }
  }
  return lines
}

function wizardRoleFromMessageKind(kind: MsgItem['kind']): WizardLineRole | null {
  switch (kind) {
    case 'agent':
      return 'assistant'
    case 'user':
      return 'user'
    case 'system':
    case 'provider':
    case 'error':
      return 'system'
    default:
      return null
  }
}

function isProjectedMessage(value: unknown): value is MsgItem {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.kind === 'string'
    && typeof value.text === 'string'
}

function projectionToLines(value: unknown): WizardLine[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((message) => {
    if (!isProjectedMessage(message)) {
      return []
    }
    const role = wizardRoleFromMessageKind(message.kind)
    const text = normalizeMessageText(message.text)
    return role && text ? [{ id: 0, role, text }] : []
  })
}

function transcriptEnvelopeToLines(envelope: Record<string, unknown>): WizardLine[] {
  if (envelope.schemaVersion !== 2) {
    return []
  }
  const source = isRecord(envelope.source) ? envelope.source : null
  const rawEventType = typeof source?.rawEventType === 'string' ? source.rawEventType : ''
  const isUserEcho = rawEventType === 'hammurabi/user' || typeof envelope.clientSendId === 'string'
  const ev = isRecord(envelope.ev) ? envelope.ev : null
  const evType = typeof ev?.type === 'string' ? ev.type : ''
  if (evType === 'message.delta' && typeof ev?.text === 'string') {
    if (isUserEcho) {
      return []
    }
    const text = normalizeMessageText(ev.text)
    return [{
      id: 0,
      role: 'assistant',
      text: text ?? '',
      completionText: ev.text,
      completionMode: 'append',
    }]
  }
  if (evType === 'provider.error' && typeof ev?.message === 'string') {
    const text = normalizeMessageText(ev.message)
    return text ? [{ id: 0, role: 'system', text }] : []
  }
  if (evType === 'provider.activity') {
    const title = typeof ev?.title === 'string' ? ev.title : ''
    const detail = typeof ev?.detail === 'string' ? ev.detail : ''
    const text = normalizeMessageText([title, detail].filter(Boolean).join(': '))
    return text ? [{ id: 0, role: 'system', text }] : []
  }
  return []
}

function eventToLines(event: Record<string, unknown>): WizardLine[] {
  const envelopeLines = transcriptEnvelopeToLines(event)
  if (envelopeLines.length > 0) {
    return envelopeLines
  }

  const eventType = typeof event.type === 'string' ? event.type : ''
  if (eventType === 'assistant') {
    return assistantLinesFromPayload(event).map((text) => ({ id: 0, role: 'assistant', text }))
  }
  if (eventType === 'system' && typeof event.text === 'string') {
    return splitLines(event.text).map((text) => ({ id: 0, role: 'system', text }))
  }
  if (eventType === 'result' && typeof event.result === 'string') {
    return splitLines(event.result).map((text) => ({ id: 0, role: 'system', text }))
  }
  return []
}

function parseIncomingLines(data: unknown): WizardLine[] {
  let parsed: unknown = data
  if (data instanceof ArrayBuffer) {
    parsed = new TextDecoder().decode(data)
  }

  if (typeof parsed === 'string') {
    const rawText = parsed
    try {
      parsed = JSON.parse(rawText) as unknown
    } catch {
      return splitLines(rawText).map((text) => ({ id: 0, role: 'system', text }))
    }
  }

  if (!isRecord(parsed)) {
    return []
  }

  if (parsed.type === 'replay') {
    const projectionLines = projectionToLines(isRecord(parsed.projection) ? parsed.projection.messages : undefined)
    if (projectionLines.length > 0) {
      return projectionLines
    }

    if (!Array.isArray(parsed.events)) {
      return []
    }

    const lines: WizardLine[] = []
    for (const event of parsed.events) {
      if (isRecord(event)) {
        lines.push(...eventToLines(event))
      }
    }
    return lines
  }

  return eventToLines(parsed)
}

function wizardWsUrl(sessionName: string, ticket: string | null): string {
  const query = new URLSearchParams()
  if (ticket) {
    query.set('ticket', ticket)
  }

  const wsBase = getWsBase()
  const sessionPath = `/api/agents/sessions/${encodeURIComponent(sessionName)}/ws`
  const queryString = query.toString()
  if (wsBase) {
    return `${wsBase}${sessionPath}?${queryString}`
  }

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}${sessionPath}?${queryString}`
}

async function startWizardSession(): Promise<WizardStartResponse> {
  return fetchJson<WizardStartResponse>('/api/commanders/wizard/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentType: 'claude',
      effort: 'low',
    }),
  })
}

async function sendWizardMessage(sessionName: string, text: string): Promise<void> {
  await fetchJson<{ sent: boolean }>(
    `/api/agents/sessions/${encodeURIComponent(sessionName)}/send`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    },
  )
}

async function cleanupWizardSession(sessionName: string): Promise<void> {
  await fetchVoid(`/api/commanders/wizard/${encodeURIComponent(sessionName)}`, { method: 'DELETE' })
}

function keepLatestLines(lines: WizardLine[]): WizardLine[] {
  if (lines.length <= MAX_WIZARD_LINES) {
    return lines
  }
  return lines.slice(-MAX_WIZARD_LINES)
}

function wizardLineToMessage(line: WizardLine): MsgItem {
  return {
    id: `wizard-${line.id}`,
    kind: line.role === 'assistant' ? 'agent' : line.role,
    text: line.text,
  }
}

function hasWizardCreateSuccess(text: string): boolean {
  return splitLines(text).some((line) => /^WIZARD_CREATE_SUCCESS\s+\S+\s+\S+$/.test(line))
}

function approvalBelongsToWizardSession(approval: PendingApproval, sessionName: string | null): boolean {
  if (!sessionName) {
    return false
  }
  return approval.sessionName === sessionName
}

export function WizardChatPanel({
  onCancel,
  onCreated,
  onBusyChange,
}: {
  onCancel?: () => void
  onCreated?: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [status, setStatus] = useState<'starting' | 'ready' | 'failed'>('starting')
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
    'disconnected',
  )
  const [lines, setLines] = useState<WizardLine[]>([])
  const [composerValue, setComposerValue] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const pendingApprovalsQuery = usePendingApprovals({
    enabled: Boolean(sessionName),
    refetchIntervalMs: 2_000,
  })
  const approvalDecision = useApprovalDecision()
  const wizardApprovals = useMemo(
    () => (pendingApprovalsQuery.data ?? []).filter((approval) => (
      approvalBelongsToWizardSession(approval, sessionName)
    )),
    [pendingApprovalsQuery.data, sessionName],
  )
  const wizardMessages = useMemo(() => lines.map(wizardLineToMessage), [lines])

  const nextLineId = useRef(1)
  const completedRef = useRef(false)
  const assistantDeltaTextRef = useRef('')
  const feedRef = useRef<HTMLDivElement | null>(null)
  const sessionNameRef = useRef<string | null>(null)

  useEffect(() => {
    sessionNameRef.current = sessionName
  }, [sessionName])

  useEffect(() => {
    onBusyChange?.(
      status === 'starting' ||
      Boolean(sessionName) ||
      isSending ||
      isClosing ||
      wizardApprovals.length > 0,
    )
  }, [isClosing, isSending, onBusyChange, sessionName, status, wizardApprovals.length])

  useEffect(() => () => {
    onBusyChange?.(false)
  }, [onBusyChange])

  useEffect(() => {
    setStatus('starting')
    setActionError(null)
    setLines([])
    completedRef.current = false
    assistantDeltaTextRef.current = ''

    let disposed = false
    let startedSessionName: string | null = null

    void startWizardSession()
      .then((started) => {
        if (disposed) {
          void cleanupWizardSession(started.sessionName).catch(() => {})
          return
        }
        startedSessionName = started.sessionName
        setSessionName(started.sessionName)
        setStatus('ready')
      })
      .catch((error) => {
        if (disposed) {
          return
        }
        setStatus('failed')
        setActionError(error instanceof Error ? error.message : 'Failed to start wizard session.')
      })

    return () => {
      disposed = true
      if (startedSessionName) {
        void cleanupWizardSession(startedSessionName).catch(() => {})
      }
    }
  }, [retryCount])

  useEffect(() => {
    if (!sessionName) {
      setConnectionStatus('disconnected')
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let disposed = false
    const reconnectBackoff = createReconnectBackoff()

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const appendParsedLines = (incoming: WizardLine[]) => {
      if (incoming.length === 0) {
        return
      }

      const visibleLines = incoming.filter((line) => line.text.length > 0)
      const withIds = visibleLines.map((line) => ({
        ...line,
        id: nextLineId.current++,
      }))

      const hasCreateSuccess = incoming.some((line) => {
        const completionText = line.completionText ?? line.text
        if (line.role === 'assistant' && line.completionMode === 'append') {
          assistantDeltaTextRef.current += completionText
          return hasWizardCreateSuccess(assistantDeltaTextRef.current)
        }

        assistantDeltaTextRef.current = line.role === 'assistant' ? completionText : ''
        return hasWizardCreateSuccess(completionText)
      })
      if (withIds.length > 0) {
        setLines((current) => keepLatestLines([...current, ...withIds]))
      }

      if (!hasCreateSuccess || completedRef.current) {
        return
      }
      completedRef.current = true
      setActionError(null)

      const activeSessionName = sessionNameRef.current
      if (!activeSessionName) {
        return
      }

      setIsClosing(true)
      void cleanupWizardSession(activeSessionName)
        .catch(() => {})
        .finally(() => {
          setSessionName(null)
          setConnectionStatus('disconnected')
          setIsClosing(false)
          onCreated?.()
        })
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return
      }
      setConnectionStatus('connecting')
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, reconnectBackoff.nextDelayMs())
    }

    const connect = async () => {
      clearReconnectTimer()
      setConnectionStatus('connecting')
      let ticket: string | null
      try {
        ticket = await issueAgentSessionStreamTicket()
      } catch (error) {
        if (isAuthRecoveryRequiredError(error)) {
          if (!disposed) {
            setConnectionStatus('disconnected')
          }
          return
        }
        throw error
      }
      if (disposed) {
        return
      }

      const nextSocket = new WebSocket(wizardWsUrl(sessionName, ticket))
      nextSocket.binaryType = 'arraybuffer'
      socket = nextSocket

      nextSocket.onopen = () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        reconnectBackoff.reset()
        setConnectionStatus('connected')
      }

      nextSocket.onmessage = (event) => {
        if (disposed || socket !== nextSocket) {
          return
        }
        appendParsedLines(parseIncomingLines(event.data))
      }

      nextSocket.onerror = () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        if (
          nextSocket.readyState === WebSocket.CONNECTING ||
          nextSocket.readyState === WebSocket.OPEN
        ) {
          nextSocket.close()
        }
      }

      nextSocket.onclose = (event) => {
        if (disposed || socket !== nextSocket) {
          return
        }
        socket = null
        if (shouldReconnectWebSocketClose(event)) {
          scheduleReconnect()
          return
        }
        setConnectionStatus('disconnected')
      }
    }

    void connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      setConnectionStatus('disconnected')
      const activeSocket = socket
      socket = null
      if (
        activeSocket &&
        (activeSocket.readyState === WebSocket.CONNECTING || activeSocket.readyState === WebSocket.OPEN)
      ) {
        activeSocket.close()
      }
    }
  }, [onCreated, sessionName])

  useEffect(() => {
    if (!feedRef.current) {
      return
    }
    feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [lines])

  const handleSend = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const activeSessionName = sessionNameRef.current
    const text = composerValue.trim()
    if (!activeSessionName || !text) {
      return
    }

    assistantDeltaTextRef.current = ''
    setActionError(null)
    setIsSending(true)
    setComposerValue('')
    setLines((current) => keepLatestLines([
      ...current,
      { id: nextLineId.current++, role: 'user', text },
    ]))

    try {
      await sendWizardMessage(activeSessionName, text)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to send message.')
    } finally {
      setIsSending(false)
    }
  }, [composerValue])

  const handleCancel = useCallback(async () => {
    const activeSessionName = sessionNameRef.current
    setIsClosing(true)
    setActionError(null)

    try {
      if (activeSessionName) {
        await cleanupWizardSession(activeSessionName)
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to close wizard session.')
      setIsClosing(false)
      return
    }

    setSessionName(null)
    setConnectionStatus('disconnected')
    setIsClosing(false)
    onCancel?.()
  }, [onCancel])

  const handleApprovalDecision = useCallback(async (
    approval: PendingApproval,
    decision: 'approve' | 'reject',
  ) => {
    assistantDeltaTextRef.current = ''
    setActionError(null)
    try {
      await approvalDecision.mutateAsync({ approval, decision })
      await pendingApprovalsQuery.refetch()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to resolve approval.')
    }
  }, [approvalDecision, pendingApprovalsQuery])

  const setupStatusLabel = status === 'starting' ? 'Starting' : status === 'ready' ? 'Ready' : 'Needs attention'
  const connectionLabel = connectionStatus === 'connected'
    ? 'Live'
    : connectionStatus === 'connecting'
      ? 'Connecting'
      : 'Offline'

  return (
    <div className="flex min-h-[min(78dvh,46rem)] flex-col gap-4" data-testid="wizard-chat-onboarding">
      <header className="flex flex-col gap-4 border-b border-[color:var(--hv-border-hair)] pb-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold leading-tight text-[color:var(--hv-fg)] md:text-3xl">
            Get your AI worker to work
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--hv-fg-subtle)]">
            Describe the worker you need. The setup chat will collect the details, preview the commander, and create it after you approve.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={isClosing}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isClosing ? 'Closing...' : 'Close'}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--hv-fg-subtle)]">
        <span className="rounded-full border border-[color:var(--hv-border-hair)] px-2.5 py-1">
          {setupStatusLabel}
        </span>
        <span className="rounded-full border border-[color:var(--hv-border-hair)] px-2.5 py-1">
          {connectionLabel}
        </span>
        <span className="min-w-0 rounded-full border border-[color:var(--hv-border-hair)] px-2.5 py-1 font-mono">
          session {sessionName ?? 'starting'}
        </span>
      </div>

      {status === 'failed' ? (
        <div className="space-y-3 rounded-lg border border-accent-vermillion/40 bg-accent-vermillion/5 p-4">
          <p className="text-sm text-accent-vermillion">
            {actionError ?? 'Failed to start wizard session.'}
          </p>
          <button
            type="button"
            onClick={() => setRetryCount((current) => current + 1)}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--hv-surface-hover)]"
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          className={
            wizardApprovals.length > 0 || pendingApprovalsQuery.isError
              ? 'grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]'
              : 'flex min-h-0 flex-1 flex-col'
          }
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div
              ref={feedRef}
              className="min-h-80 flex-1 overflow-y-auto rounded-lg border border-[color:var(--hv-border-soft)] bg-washi-white p-4"
            >
              {status === 'starting' && lines.length === 0 && (
                <p className="text-sm text-sumi-diluted">Starting wizard session...</p>
              )}
              {status === 'ready' && lines.length === 0 && (
                <p className="text-sm text-sumi-diluted">Waiting for the wizard to respond...</p>
              )}
              {wizardMessages.length > 0 && (
                <div className="hervald-chat-pane p-0">
                  <Transcript
                    messages={wizardMessages}
                    sessionId={sessionName ?? 'commander-wizard'}
                    className="hervald-chat-transcript"
                  />
                </div>
              )}
            </div>

            <form onSubmit={(event) => void handleSend(event)} className="flex gap-2">
              <input
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
                placeholder="Tell me what this AI worker should own..."
                className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-[color:var(--hv-border-soft)] bg-washi-white px-3 py-2 text-[16px] text-[color:var(--hv-fg)] placeholder:text-sumi-mist focus:outline-none focus:ring-1 focus:ring-sumi-black/20 md:text-sm"
                disabled={!sessionName || isSending || isClosing}
              />
              <button
                type="submit"
                disabled={!sessionName || !composerValue.trim() || isSending || isClosing}
                className="min-h-[44px] min-w-[72px] rounded-lg bg-[var(--hv-button-primary-bg)] px-3 py-1.5 text-sm text-[color:var(--hv-fg-inverse)] transition-colors hover:bg-[var(--hv-button-primary-bg)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? 'Sending...' : 'Send'}
              </button>
            </form>
          </div>

          {(wizardApprovals.length > 0 || pendingApprovalsQuery.isError) && (
            <aside
              className="min-w-0 rounded-lg border border-[color:var(--hv-border-soft)] bg-washi-aged/50 p-4"
              data-testid="wizard-inline-approvals"
            >
              <p className="section-title">Approvals</p>
              <p className="mt-1 text-xs leading-5 text-sumi-diluted">
                Review requests from this setup chat without closing the panel.
              </p>
              {pendingApprovalsQuery.error instanceof Error ? (
                <p className="mt-3 text-sm text-accent-vermillion">
                  {pendingApprovalsQuery.error.message}
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {wizardApprovals.map((approval) => (
                    <ApprovalCard
                      key={approval.id}
                      approval={approval}
                      compact
                      className="shadow-none"
                      onApprove={() => handleApprovalDecision(approval, 'approve')}
                      onDeny={() => handleApprovalDecision(approval, 'reject')}
                    />
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {actionError && status !== 'failed' && (
        <p className="text-sm text-accent-vermillion">{actionError}</p>
      )}
    </div>
  )
}
