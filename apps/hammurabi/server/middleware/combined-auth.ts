import type { RequestHandler } from 'express'
import { bearerTokenFromHeader, type AuthUser } from '@gehirn/auth-providers'
import { authorizeApiKeyRequest, type ApiKeyAuthOptions } from './auth.js'
import {
  authorizeAuth0Request,
  auth0UserHasRequiredPermissions,
  createAuth0Verifier,
  type Auth0AuthorizationResult,
  type Auth0Options,
} from './auth0.js'

export interface CombinedAuthOptions extends ApiKeyAuthOptions, Auth0Options {
  requiredApiKeyScopes?: readonly string[]
  /**
   * Browser/Auth0 permissions may be coarser than API-key scopes. When omitted,
   * Auth0 keeps the legacy behavior and uses requiredApiKeyScopes.
   */
  requiredAuth0Permissions?: readonly string[]
  auth0PermissionMode?: 'all' | 'any'
  unconfiguredApiKeyMessage?: string
  optional?: boolean
  /** Server-generated token accepted via `x-hammurabi-internal-token` header. */
  internalToken?: string
}

function auth0UserHasCombinedPermissions(
  user: AuthUser,
  options: CombinedAuthOptions,
): boolean {
  const requiredPermissions = options.requiredAuth0Permissions ?? options.requiredApiKeyScopes
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true
  }

  if (options.auth0PermissionMode === 'any') {
    return requiredPermissions.some((permission) =>
      auth0UserHasRequiredPermissions(user, [permission]),
    )
  }

  return auth0UserHasRequiredPermissions(user, requiredPermissions)
}

export function combinedAuth(options: CombinedAuthOptions = {}): RequestHandler {
  const verifyAuth0Token = createAuth0Verifier(options)

  return async (req, res, next) => {
    // Internal server-to-self calls bypass all external auth
    if (options.internalToken) {
      const provided = req.header('x-hammurabi-internal-token')
      if (provided && provided === options.internalToken) {
        req.user = { id: 'internal', email: 'system' }
        req.authMode = 'api-key'
        next()
        return
      }
    }

    // Support access_token query param for SSE (EventSource can't send headers)
    if (
      !req.headers.authorization &&
      typeof req.query.access_token === 'string' &&
      req.query.access_token.length > 0
    ) {
      req.headers.authorization = `Bearer ${req.query.access_token}`
    }

    const bearerToken = bearerTokenFromHeader(req.header('authorization'))
    let auth0AttemptResult: Auth0AuthorizationResult | null = null

    if (bearerToken) {
      auth0AttemptResult = await authorizeAuth0Request(req, options, verifyAuth0Token)
      if (auth0AttemptResult.ok) {
        if (!auth0UserHasCombinedPermissions(auth0AttemptResult.user, options)) {
          if (options.optional) {
            next()
            return
          }

          res.status(403).json({ error: 'Insufficient permissions' })
          return
        }

        req.user = auth0AttemptResult.user
        req.authMode = 'auth0'
        next()
        return
      }
    }

    const apiKeyAuthorization = await authorizeApiKeyRequest(req, {
      apiKeyStore: options.apiKeyStore,
      requiredScopes: options.requiredApiKeyScopes,
      unconfiguredMessage: options.unconfiguredApiKeyMessage,
      now: options.now,
    })
    if (apiKeyAuthorization.ok) {
      req.user = apiKeyAuthorization.user
      req.authMode = 'api-key'
      next()
      return
    }

    if (options.optional) {
      next()
      return
    }

    res
      .status(apiKeyAuthorization.status)
      .json({ error: apiKeyAuthorization.error })
  }
}

export function optionalCombinedAuth(
  options: Omit<CombinedAuthOptions, 'optional'> = {},
): RequestHandler {
  return combinedAuth({
    ...options,
    optional: true,
  })
}
