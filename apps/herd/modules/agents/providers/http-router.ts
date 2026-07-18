import type { AuthUser } from '@gehirn/auth-providers'
import { Router } from 'express'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store.js'
import { combinedAuth } from '../../../server/middleware/combined-auth.js'
import {
  resolveProviderDefaults,
  type ProviderAdapter,
  type ProviderModelDiscoveryContext,
  type ProviderModelsResponse,
  type ProviderRegistryEntry,
} from './provider-adapter.js'
import {
  getProvider,
  listProviders,
  resolveAutomationDefaultProviderId as resolveRegisteredAutomationDefaultProviderId,
  resolveDefaultProviderId as resolveRegisteredDefaultProviderId,
} from './registry.js'
import {
  ProviderModelRefreshRateLimitError,
  refreshProviderModels,
  resolveProviderModels,
} from './model-discovery.js'

export interface ProviderRegistryRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: (token: string) => Promise<AuthUser>
  internalToken?: string
  resolveModelDiscoveryContext?: (
    provider: ProviderAdapter,
    credentialPoolId?: string,
  ) => Promise<ProviderModelDiscoveryContext>
}

function providerSupportedTransports(
  provider: ProviderAdapter,
): ProviderRegistryEntry['supportedTransports'] {
  return provider.uiCapabilities.forcedTransport === 'stream'
    ? ['stream']
    : ['stream', 'pty']
}

async function resolveDiscoveryContext(
  provider: ProviderAdapter,
  credentialPoolId: string | undefined,
  options: ProviderRegistryRouterOptions,
): Promise<ProviderModelDiscoveryContext> {
  if (!options.resolveModelDiscoveryContext || !provider.modelDiscovery) {
    return credentialPoolId ? { credentialPoolId } : {}
  }
  try {
    return await options.resolveModelDiscoveryContext(provider, credentialPoolId)
  } catch {
    return {
      ...(credentialPoolId ? { credentialPoolId } : {}),
      unavailableReason: `${provider.label} credentials are unavailable for model discovery`,
    }
  }
}

async function resolveModels(
  provider: ProviderAdapter,
  credentialPoolId: string | undefined,
  options: ProviderRegistryRouterOptions,
  forceRefresh = false,
) {
  const context = await resolveDiscoveryContext(provider, credentialPoolId, options)
  return forceRefresh
    ? await refreshProviderModels(provider, context)
    : await resolveProviderModels(provider, context, {
        skipDiscovery: !options.resolveModelDiscoveryContext,
      })
}

async function toRegistryEntry(
  provider: ProviderAdapter,
  options: ProviderRegistryRouterOptions,
): Promise<ProviderRegistryEntry> {
  const resolvedModels = await resolveModels(provider, undefined, options)
  return {
    id: provider.id,
    label: provider.label,
    eventProvider: provider.eventProvider,
    capabilities: {
      ...provider.capabilities,
    },
    uiCapabilities: {
      ...provider.uiCapabilities,
      permissionModes: provider.uiCapabilities.permissionModes.map((mode) => ({ ...mode })),
      ...(provider.uiCapabilities.infoBanner
        ? { infoBanner: { ...provider.uiCapabilities.infoBanner } }
        : {}),
    },
    availableModels: resolvedModels.models,
    modelCatalogScope: provider.modelDiscovery?.catalogScope ?? 'credential',
    modelDiscovery: resolvedModels.discovery,
    supportsCustomModels: resolvedModels.supportsCustomModels,
    supportedTransports: providerSupportedTransports(provider),
    defaults: resolveProviderDefaults(provider, resolvedModels.models),
    disabledReason: null,
    ...(provider.machineAuth
      ? {
          machineAuth: {
            cliBinaryName: provider.machineAuth.cliBinaryName,
            ...(provider.machineAuth.installPackageName
              ? { installPackageName: provider.machineAuth.installPackageName }
              : {}),
            authEnvKeys: [...provider.machineAuth.authEnvKeys],
            supportedAuthModes: [...provider.machineAuth.supportedAuthModes],
            requiresSecretModes: provider.machineAuth.supportedAuthModes
              .filter((mode) => provider.machineAuth?.modeRequiresSecret(mode)),
            loginStatusCommand: provider.machineAuth.loginStatusCommand,
          },
        }
      : {}),
  }
}

function toModelsResponse(
  provider: ProviderAdapter,
  resolved: Awaited<ReturnType<typeof resolveModels>>,
): ProviderModelsResponse {
  return {
    providerId: provider.id,
    availableModels: resolved.models,
    modelCatalogScope: provider.modelDiscovery?.catalogScope ?? 'credential',
    modelDiscovery: resolved.discovery,
    supportsCustomModels: resolved.supportsCustomModels,
  }
}

function parseCredentialPoolId(raw: unknown): { ok: true; value?: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true }
  }
  if (typeof raw !== 'string') {
    return { ok: false }
  }
  const value = raw.trim()
  return value.length > 0 && value.length <= 128
    ? { ok: true, value }
    : { ok: false }
}

function parseRouteProviderId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
}

export function createProviderRegistryRouter(
  options: ProviderRegistryRouterOptions = {},
): Router {
  const router = Router()
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
    internalToken: options.internalToken,
  })

  router.get('/providers', requireReadAccess, async (_req, res) => {
    const providers = await Promise.all(listProviders().map(async (provider) => (
      await toRegistryEntry(provider, options)
    )))
    res.json({
      defaultProviderId: resolveRegisteredDefaultProviderId(),
      automationDefaultProviderId: resolveRegisteredAutomationDefaultProviderId(),
      providers,
    })
  })

  router.get('/providers/:providerId/models', requireReadAccess, async (req, res) => {
    const providerId = parseRouteProviderId(req.params.providerId)
    const provider = providerId ? getProvider(providerId) : undefined
    if (!provider) {
      res.status(404).json({ error: `Unknown provider "${providerId ?? ''}"` })
      return
    }
    const credentialPoolId = parseCredentialPoolId(req.query.credentialPoolId)
    if (!credentialPoolId.ok) {
      res.status(400).json({ error: 'credentialPoolId must be a non-empty string of at most 128 characters' })
      return
    }
    const resolved = await resolveModels(provider, credentialPoolId.value, options)
    res.json(toModelsResponse(provider, resolved))
  })

  router.post('/providers/:providerId/models/refresh', requireWriteAccess, async (req, res) => {
    const providerId = parseRouteProviderId(req.params.providerId)
    const provider = providerId ? getProvider(providerId) : undefined
    if (!provider) {
      res.status(404).json({ error: `Unknown provider "${providerId ?? ''}"` })
      return
    }
    const credentialPoolId = parseCredentialPoolId(req.body?.credentialPoolId)
    if (!credentialPoolId.ok) {
      res.status(400).json({ error: 'credentialPoolId must be a non-empty string of at most 128 characters' })
      return
    }
    try {
      const resolved = await resolveModels(provider, credentialPoolId.value, options, true)
      res.json(toModelsResponse(provider, resolved))
    } catch (error) {
      if (error instanceof ProviderModelRefreshRateLimitError) {
        res.status(429).json({ error: error.message, retryAt: error.retryAt })
        return
      }
      throw error
    }
  })

  return router
}
