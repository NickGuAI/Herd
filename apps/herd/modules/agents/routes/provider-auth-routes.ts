import type { Request, RequestHandler, Response, Router } from 'express'
import {
  buildProviderNativeAuthDetail,
  buildProviderReauthUrl,
  completeProviderOAuthFlow,
  prepareProviderSpawnAuth,
  ProviderAuthRequiredError,
  ProviderAuthStore,
  providerUsesManagedOAuth,
  resolveProviderAuthScopeId,
  startProviderOAuthFlow,
  type ProviderAuthSnapshot,
  type CredentialPoolProvider,
  type ProviderOAuthCompleteResult,
} from '../provider-auth.js'
import type {
  AgentType,
  AgentsRouterOptions,
  AnySession,
  CredentialPoolRecoveryRequest,
  MachineConfig,
  SessionCreator,
  StreamJsonEvent,
  StreamSession,
} from '../types.js'
import { parseProviderId } from '../providers/registry.js'
import { installBlockedCredentialPoolRecovery } from '../session/provider-runtime.js'

export const DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS = 60_000

interface ProviderAuthRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  sessions: Map<string, AnySession>
  providerAuthStore: ProviderAuthStore
  questStore?: AgentsRouterOptions['questStore']
  readMachineRegistry(): Promise<MachineConfig[]>
  sessionCreatorIdFromUser(req: Request): string | undefined
  appendStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  broadcastStreamEvent(session: StreamSession, event: StreamJsonEvent): void
  schedulePersistedSessionsWrite(): void
  markCredentialRecoveryRequest(sessionName: string, request: CredentialPoolRecoveryRequest): void
  scheduleCredentialRecoveryReplacement?(sessionName: string): void
  recoverCredentialPoolSession?(
    sessionName: string,
    request: CredentialPoolRecoveryRequest,
  ): Promise<Record<string, unknown>>
}

interface RegisteredProviderAuthRoutes {
  markProviderAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<ProviderAuthSnapshot>
  refreshProviderAuthSnapshots(): Promise<ProviderAuthSnapshot[]>
}

export function resolveProviderAuthProbeIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.HERD_PROVIDER_AUTH_PROBE_INTERVAL_MS?.trim()
  if (!raw) {
    return DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PROVIDER_AUTH_PROBE_INTERVAL_MS
}

function firstForwardedHeader(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const first = value.split(',')[0]?.trim()
  return first && /^[a-z0-9.:-]+$/iu.test(first) ? first : null
}

function configuredProviderOAuthCallbackUrl(provider: AgentType): string | null {
  const providerSpecificKey = provider === 'codex'
    ? 'HERD_CODEX_OAUTH_CALLBACK_URL'
    : null
  const configured = (providerSpecificKey ? process.env[providerSpecificKey] : undefined)
    ?? process.env.HERD_PROVIDER_OAUTH_CALLBACK_URL
  return configured?.trim() || null
}

function inferPublicRequestOrigin(req: Request): string {
  const configuredBase = process.env.HERD_PUBLIC_BASE_URL?.trim()
    ?? process.env.HERD_PROVIDER_OAUTH_CALLBACK_BASE_URL?.trim()
  if (configuredBase) {
    return configuredBase
  }

  const proto = firstForwardedHeader(req.headers['x-forwarded-proto']) ?? req.protocol
  const host = firstForwardedHeader(req.headers['x-forwarded-host']) ?? req.get('host')
  if (!host) {
    throw new Error('Unable to infer Herd public host for provider OAuth callback')
  }
  return `${proto}://${host}`
}

function providerOAuthCallbackUrl(req: Request, provider: AgentType): string {
  const configured = configuredProviderOAuthCallbackUrl(provider)
  if (configured) {
    return configured
  }
  return new URL('/api/agents/provider-auth/oauth/callback', inferPublicRequestOrigin(req)).toString()
}

function escapeProviderOAuthHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sendProviderOAuthCallbackHtml(res: Response, statusCode: number, title: string, message: string): void {
  res
    .status(statusCode)
    .type('html')
    .set('cache-control', 'no-store')
    .send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeProviderOAuthHtml(title)}</title></head>
<body>
  <h1>${escapeProviderOAuthHtml(title)}</h1>
  <p>${escapeProviderOAuthHtml(message)}</p>
</body>
</html>`)
}

function humanCreatorId(
  sessionCreatorIdFromUser: ProviderAuthRouteDeps['sessionCreatorIdFromUser'],
  req: Request,
): SessionCreator {
  return { kind: 'human', id: sessionCreatorIdFromUser(req) }
}

function parsePoolProvider(value: unknown): CredentialPoolProvider | null {
  const provider = typeof value === 'string' ? parseProviderId(value) : null
  return provider === 'claude' || provider === 'codex' ? provider : null
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function registerProviderAuthRoutes(deps: ProviderAuthRouteDeps): RegisteredProviderAuthRoutes {
  const {
    router,
    providerAuthStore,
    questStore,
    readMachineRegistry,
    requireReadAccess,
    requireWriteAccess,
    sessionCreatorIdFromUser,
    sessions,
    appendStreamEvent,
    broadcastStreamEvent,
    schedulePersistedSessionsWrite,
    markCredentialRecoveryRequest,
  } = deps

  async function queueCredentialRecovery(
    sessionName: string | undefined,
    provider: CredentialPoolProvider,
    exhaustedId: string | undefined,
    result: Awaited<ReturnType<ProviderAuthStore['switchToNextPoolCredential']>>,
  ): Promise<Record<string, unknown> | undefined> {
    const activeCredentialId = result.activeCredential?.id
    if (sessionName && result.blocked) {
      const session = sessions.get(sessionName)
      if (session?.kind === 'stream' && session.agentType === provider) {
        installBlockedCredentialPoolRecovery({
          providerAuthStore,
          appendStreamEvent,
          broadcastStreamEvent,
          markCredentialRecoveryRequest,
          schedulePersistedSessionsWrite,
          ...(deps.scheduleCredentialRecoveryReplacement
            ? { scheduleCredentialRecoveryReplacement: deps.scheduleCredentialRecoveryReplacement }
            : {}),
        }, session, {
          reason: exhaustedId ? 'usage_limit' : 'manual_switch',
          ...(result.blocked.earliestExhaustedUntil ? { blockedUntil: result.blocked.earliestExhaustedUntil } : {}),
        })
      }
      return {
        status: 'blocked',
        sessionName,
        ...(result.blocked.earliestExhaustedUntil ? { blockedUntil: result.blocked.earliestExhaustedUntil } : {}),
      }
    }
    if (!sessionName || !activeCredentialId || !result.switched) {
      return undefined
    }

    const request: CredentialPoolRecoveryRequest = {
      provider,
      credentialPoolId: activeCredentialId,
      ...(result.previousCredential?.id
        ? { previousCredentialPoolId: result.previousCredential.id }
          : {}),
      clearResumeProviderContext: true,
      reason: exhaustedId ? 'usage_limit' : 'manual_switch',
      requestedAt: new Date().toISOString(),
    }
    markCredentialRecoveryRequest(sessionName, request)

    const session = sessions.get(sessionName)
    if (session?.kind === 'stream' && session.agentType === provider) {
      session.credentialPoolRecovery = request
    }

    const recovered = await deps.recoverCredentialPoolSession?.(sessionName, request)
    return recovered ?? {
      status: 'recovered_in_place',
      sessionName,
      credentialPoolId: request.credentialPoolId,
      clearResumeProviderContext: request.clearResumeProviderContext,
    }
  }

  async function markProviderAuthRequired(
    session: StreamSession,
    detail: string,
  ): Promise<ProviderAuthSnapshot> {
    const scopeId = resolveProviderAuthScopeId(session.creator)
    const host = session.host ?? 'local'
    const managedOAuth = providerUsesManagedOAuth(session.agentType)
    const nativeAuthDetail = buildProviderNativeAuthDetail(session.agentType, host)
    const snapshot: ProviderAuthSnapshot = {
      provider: session.agentType,
      scopeId,
      host,
      status: 'auth_required',
      authMethod: managedOAuth ? 'oauth' : nativeAuthDetail ? 'login' : 'missing',
      detail: nativeAuthDetail ? `${detail} ${nativeAuthDetail}` : detail,
      lastCheckedAt: new Date().toISOString(),
      ...(managedOAuth ? { reauthUrl: buildProviderReauthUrl(session.agentType, scopeId, host) } : {}),
    }
    session.providerAuthSnapshot = snapshot
    await providerAuthStore.upsertSnapshot(snapshot)
    if (session.creator.kind === 'commander' && session.creator.id) {
      await questStore?.blockActiveForAuthRequired(session.creator.id, detail)
    }
    return snapshot
  }

  async function handleProviderAuthCompleted(result: ProviderOAuthCompleteResult): Promise<void> {
    await questStore?.unblockAuthRequired(
      result.scopeId,
      `${result.provider} provider authentication is ready`,
    )
  }

  async function refreshProviderAuthSnapshots(): Promise<ProviderAuthSnapshot[]> {
    const machines = await readMachineRegistry().catch(() => [] as MachineConfig[])
    const machineById = new Map(machines.map((machine) => [machine.id, machine]))
    const seen = new Set<string>()
    const snapshots: ProviderAuthSnapshot[] = []

    for (const session of sessions.values()) {
      if (session.kind !== 'stream') {
        continue
      }
      const scopeId = resolveProviderAuthScopeId(session.creator)
      const host = session.host ?? 'local'
      const key = `${session.agentType}:${scopeId}:${host}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const machine = session.host
        ? machineById.get(session.host) ?? {
          id: session.host,
          label: session.host,
          host: null,
        } satisfies MachineConfig
        : undefined

      try {
        const providerAuth = await prepareProviderSpawnAuth({
          provider: session.agentType,
          scopeId,
          machine,
          store: providerAuthStore,
        })
        session.providerAuthSnapshot = providerAuth.snapshot
        snapshots.push(providerAuth.snapshot)
        if (
          providerAuth.snapshot.status === 'auth_required'
          && session.creator.kind === 'commander'
          && session.creator.id
        ) {
          await questStore?.blockActiveForAuthRequired(
            session.creator.id,
            providerAuth.snapshot.detail ?? 'Provider authentication is required',
          )
        }
        if (
          providerAuth.snapshot.status === 'ready'
          && session.creator.kind === 'commander'
          && session.creator.id
        ) {
          await questStore?.unblockAuthRequired(
            session.creator.id,
            `${session.agentType} provider authentication is ready`,
          )
        }
      } catch (error) {
        if (error instanceof ProviderAuthRequiredError) {
          snapshots.push(await markProviderAuthRequired(session, error.message))
          continue
        }
        console.warn(
          '[agents/provider-auth] failed to refresh auth snapshot',
          { provider: session.agentType, scopeId, host, error: error instanceof Error ? error.message : String(error) },
        )
      }
    }

    return snapshots.length > 0 ? snapshots : providerAuthStore.listSnapshots()
  }

  async function startReauthFlowForRequest(
    req: Request,
    provider: AgentType,
    scopeId: string,
    host: string,
  ) {
    return startProviderOAuthFlow({
      provider,
      scopeId,
      host,
      store: providerAuthStore,
      callbackUrl: providerOAuthCallbackUrl(req, provider),
    })
  }

  router.get('/provider-auth/snapshots', requireReadAccess, async (_req, res) => {
    try {
      res.json({ snapshots: await providerAuthStore.listSnapshots() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read provider auth snapshots'
      res.status(500).json({ error: message })
    }
  })

  router.post('/provider-auth/probe', requireReadAccess, async (_req, res) => {
    try {
      res.json({ snapshots: await refreshProviderAuthSnapshots() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh provider auth snapshots'
      res.status(500).json({ error: message })
    }
  })

  router.get('/provider-auth/pool/:provider', requireReadAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      res.json(await providerAuthStore.listPoolCredentials(provider))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read credential pool'
      res.status(500).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/credentials', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.body?.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      res.status(201).json(await providerAuthStore.registerPoolCredential(
        provider,
        parseOptionalString(req.body?.label) ?? 'Credential',
        parseOptionalString(req.body?.email),
      ))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register credential'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/pool/switch', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.body?.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid credential pool provider' })
      return
    }
    try {
      const exhaustedId = parseOptionalString(req.body?.exhaustedId)
      const result = await providerAuthStore.switchToNextPoolCredential(
        provider,
        exhaustedId,
      )
      const recovery = await queueCredentialRecovery(
        parseOptionalString(req.body?.sessionName),
        provider,
        exhaustedId,
        result,
      )
      res.json({
        ...result,
        ...(recovery ? { recovery } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch credential'
      res.status(400).json({ error: message })
    }
  })

  router.delete('/provider-auth/pool/credentials/:provider/:credentialId', requireWriteAccess, async (req, res) => {
    const provider = parsePoolProvider(req.params.provider)
    const credentialId = parseOptionalString(req.params.credentialId)
    if (!provider || !credentialId) {
      res.status(400).json({ error: 'Invalid credential pool credential' })
      return
    }
    try {
      res.json(await providerAuthStore.removePoolCredential(provider, credentialId))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove credential'
      res.status(400).json({ error: message })
    }
  })

  router.get('/provider-auth/:provider/reauth', requireWriteAccess, async (req, res) => {
    const provider = parseProviderId(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid provider' })
      return
    }
    const scopeId = typeof req.query.scopeId === 'string' && req.query.scopeId.trim().length > 0
      ? req.query.scopeId.trim()
      : resolveProviderAuthScopeId(humanCreatorId(sessionCreatorIdFromUser, req))
    const host = typeof req.query.host === 'string' && req.query.host.trim().length > 0
      ? req.query.host.trim()
      : 'local'
    try {
      const flow = await startReauthFlowForRequest(req, provider, scopeId, host)
      res.redirect(flow.authorizationUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start provider OAuth flow'
      res.status(400).json({ error: message })
    }
  })

  router.post('/provider-auth/:provider/reauth/start', requireWriteAccess, async (req, res) => {
    const provider = parseProviderId(req.params.provider)
    if (!provider) {
      res.status(400).json({ error: 'Invalid provider' })
      return
    }
    const scopeId = typeof req.body?.scopeId === 'string' && req.body.scopeId.trim().length > 0
      ? req.body.scopeId.trim()
      : resolveProviderAuthScopeId(humanCreatorId(sessionCreatorIdFromUser, req))
    const host = typeof req.body?.host === 'string' && req.body.host.trim().length > 0
      ? req.body.host.trim()
      : 'local'
    try {
      res.json(await startReauthFlowForRequest(req, provider, scopeId, host))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start provider OAuth flow'
      res.status(400).json({ error: message })
    }
  })

  router.get('/provider-auth/oauth/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : ''
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : ''
    if (!state || !code) {
      sendProviderOAuthCallbackHtml(res, 400, 'Re-auth failed', 'OAuth callback requires state and code.')
      return
    }
    try {
      const result = await completeProviderOAuthFlow({
        state,
        code,
        store: providerAuthStore,
      })
      await handleProviderAuthCompleted(result)
      sendProviderOAuthCallbackHtml(
        res,
        200,
        'Re-auth complete',
        'Provider authentication is ready. You can close this tab and return to Herd.',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to complete provider OAuth flow'
      sendProviderOAuthCallbackHtml(res, 400, 'Re-auth failed', message)
    }
  })

  return {
    markProviderAuthRequired,
    refreshProviderAuthSnapshots,
  }
}
