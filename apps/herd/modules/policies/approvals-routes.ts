import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { bearerTokenFromHeader, type AuthUser } from '@gehirn/auth-providers'
import type {
  ApprovalSessionsInterface,
  CodexApprovalQueueEvent,
  PendingCodexApprovalView,
} from '../agents/routes.js'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import { createAuth0Verifier } from '../../server/middleware/auth0.js'
import {
  InMemoryTransportAuthTicketStore,
  readTransportAuthTicketFromUrl,
} from '../../server/auth/transport-tickets.js'
import { ApprovalCoordinator } from './pending-store.js'
import type { ApprovalCoordinatorEvent, ApprovalHistoryEntry, PendingApproval } from './types.js'

type CommanderNameLookup = (commanderId: string | null | undefined) => string | null
type CodexResolverRef = Extract<NonNullable<PendingApproval['resolverRef']>, { kind: 'codex' }>

export interface ApprovalsRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  approvalCoordinator: ApprovalCoordinator
  approvalSessionsInterface: ApprovalSessionsInterface
  buildCommanderNameLookup?: () => Promise<CommanderNameLookup>
}

function normalizeCommanderName(resolved: string | null | undefined): string | null {
  const name = typeof resolved === 'string' ? resolved.trim() : ''
  return name || null
}

function readDetail(details: Record<string, string> | undefined, labels: readonly string[]): string | undefined {
  if (!details) {
    return undefined
  }
  const normalizedLabels = new Set(labels.map((label) => label.trim().toLowerCase()))
  for (const [label, value] of Object.entries(details)) {
    if (!normalizedLabels.has(label.trim().toLowerCase())) {
      continue
    }
    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}

function readRequestId(details: Record<string, string> | undefined): string | number | undefined {
  const value = readDetail(details, ['Request ID', 'Request'])
  if (!value) {
    return undefined
  }
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && String(numeric) === value ? numeric : value
}

function resolveQueuedCodexIds(
  resolverRef: CodexResolverRef | null,
  details: Record<string, string> | undefined,
) {
  return {
    requestId: resolverRef?.requestId ?? readRequestId(details),
    threadId: resolverRef?.threadId ?? readDetail(details, ['Thread ID', 'Thread']),
    turnId: resolverRef?.turnId ?? readDetail(details, ['Turn ID', 'Turn']),
    itemId: resolverRef?.itemId ?? readDetail(details, ['Item ID', 'Item']),
  }
}

async function buildCommanderNameLookup(options: ApprovalsRouterOptions): Promise<CommanderNameLookup> {
  if (!options.buildCommanderNameLookup) {
    return () => null
  }

  try {
    return await options.buildCommanderNameLookup()
  } catch (err) {
    console.error('[approvals] commander name lookup failed', err)
    return () => null
  }
}

function toQueuedApprovalResponse(
  getCommanderName: CommanderNameLookup,
  approval: PendingApproval,
) {
  const redactedContext = redactApprovalContext(approval.context)
  const codexResolverRef = approval.resolverRef?.kind === 'codex' ? approval.resolverRef : null
  const codexIds = approval.source === 'codex' || codexResolverRef
    ? resolveQueuedCodexIds(codexResolverRef, redactedContext.details)
    : { requestId: undefined, threadId: undefined, turnId: undefined, itemId: undefined }
  const details = Object.entries(redactedContext.details ?? {}).map(([label, value]) => ({
    label,
    value,
  }))
  const commanderName = normalizeCommanderName(getCommanderName(approval.commanderId))

  return {
    id: approval.id,
    approvalId: approval.id,
    decisionId: approval.id,
    requestId: codexIds.requestId ?? approval.id,
    actionId: approval.actionId,
    actionLabel: approval.actionLabel,
    commanderId: approval.commanderId ?? null,
    commanderName,
    sessionName: approval.sessionId ?? null,
    conversationId: approval.conversationId ?? null,
    threadId: codexIds.threadId ?? null,
    turnId: codexIds.turnId ?? null,
    itemId: codexIds.itemId ?? null,
    source: approval.source,
    requestedAt: approval.requestedAt,
    summary: redactedContext.summary,
    reason: null,
    risk: null,
    preview: redactedContext.preview,
    previewText: redactedContext.preview,
    details,
    context: {
      ...redactedContext,
      ...(commanderName ? { commanderName } : {}),
      sessionName: approval.sessionId ?? undefined,
      conversationId: approval.conversationId ?? undefined,
      threadId: codexIds.threadId,
      turnId: codexIds.turnId,
      itemId: codexIds.itemId,
    },
    raw: redactedPendingApprovalRaw({
      ...approval,
      context: redactedContext,
      details,
    }),
  }
}

function toCodexApprovalResponse(
  getCommanderName: CommanderNameLookup,
  approval: PendingCodexApprovalView,
) {
  const details = [
    approval.reason ? { label: 'Reason', value: approval.reason } : null,
    approval.risk ? { label: 'Risk', value: approval.risk } : null,
    approval.threadId ? { label: 'Thread', value: approval.threadId } : null,
    approval.turnId ? { label: 'Turn', value: approval.turnId } : null,
    approval.itemId ? { label: 'Item', value: approval.itemId } : null,
    approval.conversationId ? { label: 'Conversation', value: approval.conversationId } : null,
  ].filter((detail): detail is { label: string; value: string } => detail !== null)
  const commanderName = normalizeCommanderName(getCommanderName(approval.commanderScopeId))

  return {
    id: approval.id,
    approvalId: approval.id,
    decisionId: approval.id,
    requestId: approval.requestId,
    actionId: approval.actionId,
    actionLabel: approval.actionLabel,
    commanderId: approval.commanderScopeId ?? null,
    commanderName,
    sessionName: approval.sessionName,
    conversationId: approval.conversationId ?? null,
    threadId: approval.threadId ?? null,
    turnId: approval.turnId ?? null,
    itemId: approval.itemId ?? null,
    source: 'codex',
    requestedAt: approval.requestedAt,
    summary: approval.reason ?? `${approval.actionLabel} requires approval.`,
    reason: approval.reason ?? null,
    risk: approval.risk ?? null,
    preview: approval.risk ?? undefined,
    previewText: approval.risk ?? approval.reason ?? null,
    details,
    context: {
      summary: approval.reason ?? `${approval.actionLabel} requires approval.`,
      details: Object.fromEntries(details.map((detail) => [detail.label, detail.value])),
      sessionName: approval.sessionName,
      conversationId: approval.conversationId,
      threadId: approval.threadId,
      turnId: approval.turnId,
      itemId: approval.itemId,
      ...(commanderName ? { commanderName } : {}),
    },
    raw: redactUnknown(approval),
  }
}

const SENSITIVE_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|password|private[_-]?key|secret|token)(?:$|[_-])/iu
const SECRET_SHAPED_VALUE_PATTERN = /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|hmrb_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|gh[psuor]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/gu
const REDACTED = '[redacted]'

function redactString(value: string): string {
  return value.replace(SECRET_SHAPED_VALUE_PATTERN, REDACTED)
}

function redactUnknown(value: unknown, keyHint = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) {
    return REDACTED
  }
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactUnknown(entry, key),
      ]),
    )
  }
  return value
}

function redactApprovalContext(context: PendingApproval['context']): PendingApproval['context'] {
  const details: Record<string, string> = {}
  for (const [key, value] of Object.entries(context.details ?? {})) {
    const redacted = redactUnknown(value, key)
    if (typeof redacted === 'string') {
      details[key] = redacted
    }
  }

  return {
    summary: redactString(context.summary),
    details,
    ...(typeof context.preview === 'string' ? { preview: redactString(context.preview) } : {}),
    ...(context.command ? { command: redactString(context.command) } : {}),
    ...(context.primaryTarget
      ? {
        primaryTarget: {
          label: context.primaryTarget.label,
          value: redactString(context.primaryTarget.value),
        },
      }
      : {}),
  }
}

function redactedPendingApprovalRaw(
  approval: PendingApproval & { details?: Array<{ label: string; value: string }> },
): Record<string, unknown> {
  const { toolInput: _toolInput, ...safeApproval } = approval
  return redactUnknown(safeApproval) as Record<string, unknown>
}

async function listApprovalResponses(options: ApprovalsRouterOptions) {
  const getCommanderName = await buildCommanderNameLookup(options)
  const queuedApprovals = await options.approvalCoordinator.listPending()
  const codexApprovals = options.approvalSessionsInterface.listPendingCodexApprovals()
  const queuedResponses = queuedApprovals.map((approval) => toQueuedApprovalResponse(getCommanderName, approval))
  const codexResponses = codexApprovals.map((approval) => toCodexApprovalResponse(getCommanderName, approval))
  return [
    ...queuedResponses,
    ...codexResponses,
  ].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return
  }
  ws.send(JSON.stringify(payload))
}

function buildCodexHistoryEntry(event: CodexApprovalQueueEvent): ApprovalHistoryEntry {
  const summary = event.approval.reason ?? `${event.approval.actionLabel} requires approval.`
  if (event.type === 'resolved') {
    return {
      timestamp: new Date().toISOString(),
      type: 'approval.resolved',
      approvalId: event.approval.id,
      actionId: event.approval.actionId,
      actionLabel: event.approval.actionLabel,
      commanderId: event.approval.commanderScopeId,
      sessionId: event.approval.sessionName,
      conversationId: event.approval.conversationId,
      source: 'codex',
      summary,
      decision: event.decision,
      delivered: event.delivered,
      outcome: event.decision
        ? {
          decision: event.decision,
          allowed: event.decision === 'approve',
        }
        : undefined,
    }
  }

  return {
    timestamp: event.approval.requestedAt,
    type: 'approval.enqueued',
    approvalId: event.approval.id,
    actionId: event.approval.actionId,
    actionLabel: event.approval.actionLabel,
    commanderId: event.approval.commanderScopeId,
    sessionId: event.approval.sessionName,
    conversationId: event.approval.conversationId,
    source: 'codex',
    summary,
  }
}

function sendQueuedApprovalEvent(
  ws: WebSocket,
  event: ApprovalCoordinatorEvent,
  approval: ReturnType<typeof toQueuedApprovalResponse>,
): void {
  if (event.type === 'resolved') {
    sendJson(ws, {
      type: 'approval.resolved',
      approvalId: event.approval.id,
      approval,
      decision: event.decision,
      delivered: event.delivered,
    })
    return
  }

  sendJson(ws, {
    type: 'approval.enqueued',
    approvalId: event.approval.id,
    approval,
  })
}

function sendCodexApprovalEvent(
  ws: WebSocket,
  event: CodexApprovalQueueEvent,
  approval: ReturnType<typeof toCodexApprovalResponse>,
): void {
  if (event.type === 'resolved') {
    sendJson(ws, {
      type: 'approval.resolved',
      approvalId: event.approval.id,
      approval,
      decision: event.decision,
      delivered: event.delivered,
    })
    return
  }

  sendJson(ws, {
    type: 'approval.enqueued',
    approvalId: event.approval.id,
    approval,
  })
}

async function sendQueuedApprovalStreamEvent(
  ws: WebSocket,
  options: ApprovalsRouterOptions,
  event: ApprovalCoordinatorEvent,
): Promise<void> {
  try {
    const getCommanderName = await buildCommanderNameLookup(options)
    sendQueuedApprovalEvent(ws, event, toQueuedApprovalResponse(getCommanderName, event.approval))
  } catch (err) {
    console.error('[approvals] stream conversion failed', err)
    try {
      sendQueuedApprovalEvent(ws, event, toQueuedApprovalResponse(() => null, event.approval))
    } catch (fallbackErr) {
      console.error('[approvals] stream fallback conversion failed', fallbackErr)
    }
  }
}

async function sendCodexApprovalStreamEvent(
  ws: WebSocket,
  options: ApprovalsRouterOptions,
  event: CodexApprovalQueueEvent,
): Promise<void> {
  try {
    const getCommanderName = await buildCommanderNameLookup(options)
    sendCodexApprovalEvent(ws, event, toCodexApprovalResponse(getCommanderName, event.approval))
  } catch (err) {
    console.error('[approvals] stream conversion failed', err)
    try {
      sendCodexApprovalEvent(ws, event, toCodexApprovalResponse(() => null, event.approval))
    } catch (fallbackErr) {
      console.error('[approvals] stream fallback conversion failed', fallbackErr)
    }
  }
}

export function createApprovalsRouter(options: ApprovalsRouterOptions): {
  router: Router
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
} {
  const router = Router()
  const wss = new WebSocketServer({ noServer: true })
  const streamTickets = new InMemoryTransportAuthTicketStore()
  const auth0Verifier = createAuth0Verifier({
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    internalToken: options.internalToken,
    verifyToken: options.verifyAuth0Token,
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
  })
  options.approvalSessionsInterface.subscribeToCodexApprovalQueue((event) => {
    void options.approvalCoordinator.recordHistoryEntry(buildCodexHistoryEntry(event))
  })

  router.get('/pending', requireReadAccess, async (_req, res) => {
    res.json({
      approvals: await listApprovalResponses(options),
    })
  })

  router.post('/stream-ticket', requireReadAccess, (_req, res) => {
    res.json(streamTickets.issue('approvals.pending-stream'))
  })

  router.get('/history', requireReadAccess, async (req, res) => {
    const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
    const commanderId = typeof req.query.commander === 'string' && req.query.commander.trim().length > 0
      ? req.query.commander.trim()
      : undefined
    const actionId = typeof req.query.action === 'string' && req.query.action.trim().length > 0
      ? req.query.action.trim()
      : undefined
    const source = req.query.source === 'claude' || req.query.source === 'codex'
      ? req.query.source
      : undefined
    const rawFrom = typeof req.query.from === 'string' ? req.query.from.trim() : ''
    const from = rawFrom.length > 0 ? rawFrom : undefined
    const to = typeof req.query.to === 'string' && req.query.to.trim().length > 0
      ? req.query.to.trim()
      : undefined

    const historyFilter = {
      ...(commanderId ? { commanderId } : {}),
      ...(actionId ? { actionId } : {}),
      ...(source ? { source } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(typeof limit === 'number' && Number.isFinite(limit) ? { limit } : {}),
    }

    res.json({
      history: await options.approvalCoordinator.listHistory(historyFilter),
    })
  })

  async function verifyWsAuth(req: IncomingMessage): Promise<boolean> {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    if (
      streamTickets.consume(
        readTransportAuthTicketFromUrl(url),
        'approvals.pending-stream',
      )
    ) {
      return true
    }

    const authorizationHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization
    const bearerToken = bearerTokenFromHeader(authorizationHeader)
    const apiKeyHeader = req.headers['x-herd-api-key'] as string | undefined
    const token = bearerToken ?? apiKeyHeader

    if (!token) {
      return false
    }

    if (auth0Verifier) {
      try {
        await auth0Verifier(token)
        return true
      } catch {
        // Fall through to API key verification.
      }
    }

    if (options.apiKeyStore) {
      const result = await options.apiKeyStore.verifyKey(token, {
        requiredScopes: ['agents:read'],
      })
      return result.ok
    }

    return false
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    if (!url.pathname.endsWith('/stream')) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    void verifyWsAuth(req).then((authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const unsubscribeQueuedApprovals = options.approvalCoordinator.subscribe((event) => {
          void sendQueuedApprovalStreamEvent(ws, options, event)
        })
        const unsubscribeCodexApprovals = options.approvalSessionsInterface.subscribeToCodexApprovalQueue(
          (event: CodexApprovalQueueEvent) => {
            void sendCodexApprovalStreamEvent(ws, options, event)
          },
        )

        ws.on('close', () => {
          unsubscribeQueuedApprovals()
          unsubscribeCodexApprovals()
        })

        void listApprovalResponses(options).then((approvals) => {
          sendJson(ws, {
            type: 'approval.snapshot',
            approvals,
          })
        }).catch((err) => {
          console.error('[approvals] stream snapshot failed', err)
        })
      })
    })
  }

  return {
    router,
    handleUpgrade,
  }
}
