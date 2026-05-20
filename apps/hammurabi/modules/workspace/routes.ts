import { createReadStream } from 'node:fs'
import { Router, type Request, type Response } from 'express'
import { combinedAuth } from '../../server/middleware/combined-auth.js'
import type { Auth0TokenVerifier } from '../../server/middleware/auth0.js'
import type { ApiKeyStoreLike } from '../../server/api-keys/store.js'
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  createWorkspaceUploadMiddleware,
  deleteWorkspaceEntry,
  getMimeType,
  initWorkspaceGit,
  listWorkspaceTree,
  readWorkspaceFilePreview,
  readWorkspaceGitLog,
  readWorkspaceGitStatus,
  resolveWorkspacePathSelection,
  renameWorkspaceEntry,
  resolveWorkspacePath,
  resolveWorkspaceUploadDestination,
  saveWorkspaceTextFile,
  toWorkspaceError,
  WorkspaceError,
} from './index.js'
import type { WorkspaceCommandRunner } from './git.js'
import type { WorkspaceResolverCapability } from './capability.js'
import { WorkspacePreferencesStore } from './store.js'
import {
  materializeWorkspaceContextPayload,
  readWorkspaceContextPayload,
} from './context.js'

export interface WorkspaceRouterOptions {
  apiKeyStore?: ApiKeyStoreLike
  auth0Domain?: string
  auth0Audience?: string
  auth0ClientId?: string
  verifyAuth0Token?: Auth0TokenVerifier
  resolver: WorkspaceResolverCapability
  preferencesStore?: WorkspacePreferencesStore
}

function sendWorkspaceError(res: Response, error: unknown): void {
  const workspaceError = toWorkspaceError(error)
  res.status(workspaceError.statusCode).json({ error: workspaceError.message })
}

function rejectRawLocationParams(query: Record<string, unknown>): void {
  if (query.host !== undefined || query.rootPath !== undefined) {
    throw new WorkspaceError(400, 'Workspace reads require targetId; host/rootPath are not supported')
  }
}

function readTargetId(query: Record<string, unknown>): string {
  rejectRawLocationParams(query)
  const targetId = typeof query.targetId === 'string' ? query.targetId.trim() : ''
  if (!targetId) {
    throw new WorkspaceError(400, 'targetId query parameter is required')
  }
  return targetId
}

function readPath(query: Record<string, unknown>): string {
  return typeof query.path === 'string' ? query.path : ''
}

function readBodyPath(body: unknown, key = 'path'): string {
  if (typeof body !== 'object' || body === null) {
    return ''
  }
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function readRequiredBodyPath(body: unknown, key = 'path'): string {
  const targetPath = readBodyPath(body, key).trim()
  if (!targetPath) {
    throw new WorkspaceError(400, `${key} body field is required`)
  }
  return targetPath
}

function readRequiredPath(query: Record<string, unknown>): string {
  const targetPath = readPath(query).trim()
  if (!targetPath) {
    throw new WorkspaceError(400, 'path query parameter is required')
  }
  return targetPath
}

function readContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return ''
  }
  const content = (body as Record<string, unknown>).content
  return typeof content === 'string' ? content : ''
}

function readBodyString(body: unknown, key: string): string {
  if (typeof body !== 'object' || body === null) {
    return ''
  }
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function readRequiredBodyString(body: unknown, key: string): string {
  const value = readBodyString(body, key).trim()
  if (!value) {
    throw new WorkspaceError(400, `${key} body field is required`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readRemoteRawFile(
  filePath: string,
  runner: WorkspaceCommandRunner,
): Promise<Buffer> {
  const { stdout } = await runner.exec('bash', ['-lc', 'base64 < "$1"', '--', filePath])
  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64')
}

function runUploadMiddleware(req: Request, res: Response, destinationPath: string): Promise<void> {
  const middleware = createWorkspaceUploadMiddleware(destinationPath).array('files')
  return new Promise((resolve, reject) => {
    middleware(req, res, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function createWorkspaceRouter(options: WorkspaceRouterOptions): Router {
  const router = Router()
  const preferencesStore = options.preferencesStore ?? new WorkspacePreferencesStore()
  const requireReadAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:read'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })
  const requireWriteAccess = combinedAuth({
    apiKeyStore: options.apiKeyStore,
    requiredApiKeyScopes: ['agents:write'],
    domain: options.auth0Domain,
    audience: options.auth0Audience,
    clientId: options.auth0ClientId,
    verifyToken: options.verifyAuth0Token,
  })

  router.post('/open', requireReadAccess, async (req, res) => {
    try {
      const conversationId = typeof req.body?.conversationId === 'string'
        ? req.body.conversationId
        : ''
      const sessionName = typeof req.body?.sessionName === 'string'
        ? req.body.sessionName
        : ''
      const commanderId = typeof req.body?.commanderId === 'string'
        ? req.body.commanderId
        : ''
      const target = await options.resolver.open({
        conversationId,
        sessionName,
        commanderId,
        hostHint: typeof req.body?.hostHint === 'string' ? req.body.hostHint : undefined,
        pathHint: typeof req.body?.pathHint === 'string' ? req.body.pathHint : undefined,
      })
      res.json({
        targetId: target.targetId,
        label: target.label,
        host: target.host,
        isReadOnly: target.readOnly,
        rootPath: target.rootPath,
      })
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/tree', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await listWorkspaceTree(
        resolved.workspace,
        readPath(req.query),
        resolved.commandRunner,
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/expand', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await listWorkspaceTree(
        resolved.workspace,
        readPath(req.query),
        resolved.commandRunner,
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/resolve-path', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await resolveWorkspacePathSelection(
        resolved.workspace,
        readRequiredPath(req.query),
        resolved.commandRunner,
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/file', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await readWorkspaceFilePreview(
        resolved.workspace,
        readRequiredPath(req.query),
        resolved.commandRunner,
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/raw', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      const { absolutePath } = await resolveWorkspacePath(
        resolved.workspace,
        readRequiredPath(req.query),
        { expectFile: true },
        resolved.commandRunner,
      )
      const mimeType = getMimeType(absolutePath)
      if (mimeType) {
        res.type(mimeType)
      }
      if (resolved.workspace.isRemote) {
        if (!resolved.commandRunner) {
          throw new WorkspaceError(501, 'Remote workspace browsing is not supported yet')
        }
        res.send(await readRemoteRawFile(absolutePath, resolved.commandRunner))
        return
      }
      createReadStream(absolutePath).on('error', (error) => {
        sendWorkspaceError(res, error)
      }).pipe(res)
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/context/materialize', requireReadAccess, async (req, res) => {
    try {
      const targetId = readRequiredBodyString(req.body, 'targetId')
      const context = readWorkspaceContextPayload({
        ...(isRecord(req.body) ? req.body : {}),
        targetId,
      })
      res.json(await materializeWorkspaceContextPayload({
        resolver: options.resolver,
        context,
      }))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/git/status', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await readWorkspaceGitStatus(resolved.workspace, resolved.commandRunner))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/git/log', requireReadAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      const limit = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 15
      res.json(await readWorkspaceGitLog(
        resolved.workspace,
        Number.isFinite(limit) ? limit : 15,
        resolved.commandRunner,
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.put('/file', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await saveWorkspaceTextFile(
        resolved.workspace,
        readRequiredBodyPath(req.body),
        readContent(req.body),
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/new-file', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await createWorkspaceFile(resolved.workspace, readRequiredBodyPath(req.body)))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/new-folder', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await createWorkspaceFolder(resolved.workspace, readRequiredBodyPath(req.body)))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/rename', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await renameWorkspaceEntry(
        resolved.workspace,
        readRequiredBodyPath(req.body, 'fromPath'),
        readRequiredBodyPath(req.body, 'toPath'),
      ))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.delete('/path', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json(await deleteWorkspaceEntry(resolved.workspace, readRequiredPath(req.query)))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/upload', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      const destination = await resolveWorkspaceUploadDestination(
        resolved.workspace,
        readPath(req.query),
      )
      await runUploadMiddleware(req, res, destination.absolutePath)
      const uploaded = (req.files as Express.Multer.File[] | undefined)?.map((file) => file.filename) ?? []
      res.json({ uploaded, path: destination.relativePath })
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.post('/git/init', requireWriteAccess, async (req, res) => {
    try {
      const resolved = await options.resolver.resolveTarget(readTargetId(req.query))
      res.json({ output: await initWorkspaceGit(resolved.workspace, resolved.commandRunner) })
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.get('/preferences', requireReadAccess, async (_req, res) => {
    try {
      res.json(await preferencesStore.get())
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  router.put('/preferences', requireWriteAccess, async (req, res) => {
    try {
      res.json(await preferencesStore.update({
        panelDefault: req.body?.panelDefault,
      }))
    } catch (error) {
      sendWorkspaceError(res, error)
    }
  })

  return router
}
