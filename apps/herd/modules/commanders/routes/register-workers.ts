import path from 'node:path'
import { parseSessionId } from '../route-parsers.js'
import { parseEvalAdapterDescriptor } from '../../eval/adapter-preflight.js'
import type { CommanderRoutesContext } from './types.js'

/**
 * Registers `POST /:id/workers` — the canonical external dispatch path for
 * worker sessions attributed to a commander. The commander identity is baked
 * from the URL (verifiable via the route's `commanders:write` scope check),
 * so no caller can self-claim attribution they have not been authorized for.
 *
 * The actual session-spawn logic lives on the agents-side
 * `CommanderSessionsInterface.dispatchWorkerForCommander`; this route is the
 * thin adapter that handles URL parsing, commander existence validation,
 * and response forwarding. See issue #1223 for the full architecture.
 */
export function registerWorkerRoutes(
  router: import('express').Router,
  context: CommanderRoutesContext,
): void {
  router.post('/:id/workers', context.requireWorkerDispatchAccess, async (req, res) => {
    const commanderId = parseSessionId(req.params.id)
    if (!commanderId) {
      res.status(400).json({ error: 'Invalid commander id' })
      return
    }

    const commander = await context.sessionStore.get(commanderId)
    if (!commander) {
      res.status(404).json({ error: `Commander "${commanderId}" not found` })
      return
    }

    if (!context.sessionsInterface) {
      res.status(500).json({ error: 'sessionsInterface not configured' })
      return
    }

    const rawBody = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : null
    let bodyForDispatch: unknown = req.body
    if (rawBody && Object.prototype.hasOwnProperty.call(rawBody, 'evalAdapter')) {
      const adapter = parseEvalAdapterDescriptor(rawBody.evalAdapter)
      if (!adapter) {
        res.status(400).json({
          error: 'evalAdapter must contain an absolute adapterRoot and dotted adapterModule',
        })
        return
      }
      if (!context.evalAdapterPreflight) {
        res.status(503).json({ error: 'Eval adapter preflight is not configured' })
        return
      }

      const effectiveHost = typeof rawBody.host === 'string' && rawBody.host.trim().length > 0
        ? rawBody.host.trim()
        : commander.host
      const effectiveCwd = typeof rawBody.cwd === 'string' && rawBody.cwd.trim().length > 0
        ? rawBody.cwd.trim()
        : commander.cwd
      if (!effectiveCwd || !path.isAbsolute(effectiveCwd)) {
        res.status(400).json({ error: 'Eval worker cwd must be an absolute adapter root' })
        return
      }
      if (path.normalize(effectiveCwd) !== adapter.adapterRoot) {
        res.status(400).json({ error: 'evalAdapter.adapterRoot must match the worker cwd' })
        return
      }

      const preflight = await context.evalAdapterPreflight.check({
        machineId: effectiveHost,
        adapterRoot: adapter.adapterRoot,
        adapterModule: adapter.adapterModule,
      })
      if (!preflight.ok) {
        res.status(preflight.status).json({ error: preflight.error })
        return
      }

      const { evalAdapter: _evalAdapter, ...dispatchFields } = rawBody
      bodyForDispatch = {
        ...dispatchFields,
        host: preflight.machineId,
        cwd: preflight.adapterRoot,
      }
    }

    try {
      const result = await context.sessionsInterface.dispatchWorkerForCommander({
        commanderId,
        rawBody: (
          bodyForDispatch && typeof bodyForDispatch === 'object' && !Array.isArray(bodyForDispatch)
            ? {
                ...(bodyForDispatch as Record<string, unknown>),
                ...(
                  !Object.prototype.hasOwnProperty.call(bodyForDispatch, 'model')
                  && commander.model !== undefined
                    ? { model: commander.model }
                    : {}
                ),
                ...(
                  !Object.prototype.hasOwnProperty.call(bodyForDispatch, 'host')
                  && commander.host !== undefined
                    ? { host: commander.host }
                    : {}
                ),
                ...(
                  !Object.prototype.hasOwnProperty.call(bodyForDispatch, 'cwd')
                  && commander.cwd !== undefined
                    ? { cwd: commander.cwd }
                    : {}
                ),
              }
            : bodyForDispatch
        ),
      })
      res.status(result.status).json(result.body)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to dispatch worker'
      res.status(500).json({ error: message })
    }
  })
}
