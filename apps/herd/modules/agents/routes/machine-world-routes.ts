import type { Request, RequestHandler, Router } from 'express'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { parseTailscaleStatusJson } from '@gehirn/herd-cli/tailscale-status'
import type { CommanderSessionStore } from '../../commanders/store.js'
import {
  buildMachineProbeScript,
  buildLoginShellCommand,
  isRemoteMachine,
  prepareMachineLaunchEnvironment,
  parseMachineHealthOutput,
  runCapturedCommand,
} from '../machines.js'
import {
  readMachineTextFile,
  resolveMachineHomeDirectory,
  runMachineAuthStatus,
  upsertExportedEnvVars,
  writeMachineTextFile,
  type MachineAuthProvider,
} from '../machine-auth.js'
import { updateMachineEnvEntries } from '../machine-credentials.js'
import {
  buildDaemonMachineHealthReport,
  buildMachineDaemonStatus,
} from '../daemon/status.js'
import { buildMachineDaemonPairCommand } from '../daemon/pairing-command.js'
import {
  createMachineEnrollmentToken,
  verifyMachineEnrollmentToken,
} from '../daemon/enrollment-token.js'
import {
  createDaemonPairingToken,
  createDaemonPairingTokenExpiresAt,
  hashDaemonPairingToken,
  type MachineDaemonRegistry,
} from '../daemon/registry.js'
import {
  getMachineProvider,
  type MachineAuthMode,
} from '../providers/machine-provider-adapter.js'
import { parseSessionName } from '../session/input.js'
import { aggregateCommanderWorldAgentSource, toCommanderWorldAgent, toWorldAgent } from '../session/state.js'
import type { ConversationStore } from '../../commanders/conversation-store.js'
import type {
  AnySession,
  MachineConfig,
  MachineDaemonPairCommand,
  MachineHealthReport,
  WorldAgent,
} from '../types.js'

interface MachineWorldRouteDeps {
  router: Router
  requireReadAccess: RequestHandler
  requireWriteAccess: RequestHandler
  commanderSessionStore?: Pick<CommanderSessionStore, 'list'>
  conversationStore?: Pick<ConversationStore, 'listByCommander'>
  sessions: Map<string, AnySession>
  buildSshArgs(
    machine: MachineConfig & { host: string },
    remoteCommand: string,
    interactive: boolean,
    approvalBridge?: { port: number | string; internalToken?: string },
    sendEnvKeys?: readonly string[],
  ): string[]
  isRemoteMachine(machine: MachineConfig | undefined): machine is MachineConfig & { host: string }
  parseSessionName: typeof parseSessionName
  pruneStaleCronSessions(): number
  pruneStaleNonHumanSessions(): Promise<number>
  readMachineRegistry(): Promise<MachineConfig[]>
  resolveTailscaleHostname(hostname: string): Promise<{
    tailscaleHostname: string
    resolvedHost: string
  }>
  validateMachineConfig(value: unknown, options?: { requireHost?: boolean }): MachineConfig
  verifyMachineLaunch?(
    machineId: string,
    options?: { agentType?: string; candidateMachine?: MachineConfig },
  ): Promise<
    | {
        ok: true
        agentType: string
        host: string
        machineId: string
        sessionName: string
      }
    | { ok: false; status: number; stage: string; error: string }
  >
  withMachineRegistryWriteLock<T>(operation: () => Promise<T>): Promise<T>
  writeMachineRegistry(machines: readonly MachineConfig[]): Promise<MachineConfig[]>
  daemonRegistry: MachineDaemonRegistry
  machineEnrollmentSigningSecret: string
}

class MachineCreateLaunchVerificationError extends Error {
  constructor(
    readonly status: number,
    readonly stage: string,
    message: string,
  ) {
    super(message)
    this.name = 'MachineCreateLaunchVerificationError'
  }
}

export function registerMachineWorldRoutes(deps: MachineWorldRouteDeps): void {
  const { router, requireReadAccess, requireWriteAccess } = deps

  async function pruneSessions(): Promise<void> {
    deps.pruneStaleCronSessions()
    await deps.pruneStaleNonHumanSessions()
  }

  router.get('/machines', requireReadAccess, async (_req, res) => {
    try {
      const machines = await deps.readMachineRegistry()
      res.json(machines.map(serializeMachineForResponse))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines', requireWriteAccess, async (req, res) => {
    let machine: MachineConfig
    try {
      machine = deps.validateMachineConfig(normalizeMachineCreatePayload(req.body), { requireHost: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid machine payload'
      res.status(400).json({ error: message })
      return
    }

    const createOptions = parseMachineCreateOptions(req.body)
    if (!createOptions.ok) {
      res.status(400).json({ error: createOptions.error })
      return
    }
    if (createOptions.verifyLaunch && !deps.verifyMachineLaunch) {
      res.status(501).json({ error: 'Machine launch verification is not available' })
      return
    }

    if (machine.tailscaleHostname) {
      try {
        const verified = await deps.resolveTailscaleHostname(machine.tailscaleHostname)
        machine = {
          ...machine,
          host: verified.resolvedHost,
          tailscaleHostname: verified.tailscaleHostname,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to verify Tailscale hostname'
        res.status(502).json({ error: message })
        return
      }
    }

    try {
      const created = await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        if (current.some((entry) => entry.id === machine.id)) {
          throw new Error(`Machine "${machine.id}" already exists`)
        }

        let verification: Awaited<ReturnType<NonNullable<MachineWorldRouteDeps['verifyMachineLaunch']>>> | undefined
        if (createOptions.verifyLaunch && deps.verifyMachineLaunch) {
          const result = await deps.verifyMachineLaunch(machine.id, {
            ...(createOptions.agentType ? { agentType: createOptions.agentType } : {}),
            candidateMachine: machine,
          })
          if (!result.ok) {
            throw new MachineCreateLaunchVerificationError(result.status, result.stage, result.error)
          }
          verification = result
        }

        const next = await deps.writeMachineRegistry([...current, machine])
        const createdMachine = next.find((entry) => entry.id === machine.id) ?? machine
        return { machine: createdMachine, verification }
      })
      res.status(201).json({
        ...serializeMachineForResponse(created.machine),
        ...(created.verification ? { verification: created.verification } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update machines registry'
      if (error instanceof MachineCreateLaunchVerificationError) {
        res.status(error.status).json({
          stage: error.stage,
          error: message,
        })
        return
      }
      if (message.includes('already exists')) {
        res.status(409).json({ error: message })
        return
      }
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines/enrollment-token', requireWriteAccess, async (req, res) => {
    const request = parseMachineEnrollmentTokenRequest(req.body)
    if (!request.ok) {
      res.status(400).json({ error: request.error })
      return
    }

    try {
      const endpoint = resolveRequestEndpoint(req)
      const enrollment = createMachineEnrollmentToken({
        signingSecret: deps.machineEnrollmentSigningSecret,
        endpoint,
        ...(request.value.label ? { label: request.value.label } : {}),
        ...(request.value.cwd ? { cwd: request.value.cwd } : {}),
      })
      res.status(201).json({
        enrollment: {
          token: enrollment.token,
          endpoint,
          expiresAt: enrollment.expiresAt,
          command: buildMachineEnrollmentCommand({
            endpoint,
            token: enrollment.token,
          }),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mint machine enrollment token'
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines/enroll', async (req, res) => {
    const request = parseMachineEnrollRequest(req.body)
    if (!request.ok) {
      res.status(400).json({ error: request.error })
      return
    }

    const verification = verifyMachineEnrollmentToken(request.value.token, {
      signingSecret: deps.machineEnrollmentSigningSecret,
    })
    if (!verification.ok) {
      if (verification.reason === 'expired') {
        res.status(401).json({
          error: 'Enrollment token expired. Mint a new enrollment token in Herd Machines and run the new herd connect command.',
        })
        return
      }
      res.status(401).json({
        error: 'Enrollment token is invalid. Mint a new enrollment token in Herd Machines and try again.',
      })
      return
    }

    const endpoint = verification.endpoint ?? resolveRequestEndpoint(req)
    const token = createDaemonPairingToken()
    const pairedAt = new Date().toISOString()
    const expiresAt = createDaemonPairingTokenExpiresAt()

    try {
      const enrolledMachine = await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        const label = verification.label ?? request.value.label ?? 'Herd daemon'
        const machineId = createEnrollmentMachineId(label, current, deps.parseSessionName)
        const nextMachine: MachineConfig = {
          id: machineId,
          label,
          host: null,
          transport: 'daemon',
          cwd: verification.cwd ?? request.value.cwd,
          daemon: {
            pairingTokenHash: hashDaemonPairingToken(token),
            pairedAt,
            expiresAt,
          },
        }
        const persisted = await deps.writeMachineRegistry([...current, nextMachine])
        return persisted.find((entry) => entry.id === machineId) ?? nextMachine
      })

      res.status(201).json({
        machine: serializeMachineForResponse(enrolledMachine),
        credentials: {
          machineId: enrolledMachine.id,
          pairingToken: token,
          endpoint,
          websocketPath: `/api/agents/daemons/ws?machine_id=${encodeURIComponent(enrolledMachine.id)}`,
          pairedAt,
          expiresAt,
        },
        status: buildMachineDaemonStatus(
          enrolledMachine,
          deps.daemonRegistry.getConnection(enrolledMachine.id),
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enroll daemon machine'
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines/:id/verify-launch', requireWriteAccess, async (req, res) => {
    if (!deps.verifyMachineLaunch) {
      res.status(501).json({ error: 'Machine launch verification is not available' })
      return
    }

    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    const agentType = typeof req.body?.agentType === 'string' && req.body.agentType.trim().length > 0
      ? req.body.agentType.trim()
      : undefined
    const result = await deps.verifyMachineLaunch(machineId, { agentType })
    if (!result.ok) {
      res.status(result.status).json({
        stage: result.stage,
        error: result.error,
      })
      return
    }

    res.json(result)
  })

  router.post('/machines/verify-tailscale', requireWriteAccess, async (req, res) => {
    const rawHostname = typeof req.body?.hostname === 'string'
      ? req.body.hostname
      : (typeof req.body?.tailscaleHostname === 'string' ? req.body.tailscaleHostname : '')
    const hostname = rawHostname.trim()
    if (!hostname) {
      res.status(400).json({ error: 'tailscale hostname is required' })
      return
    }

    try {
      const result = await deps.resolveTailscaleHostname(hostname)
      res.json({
        tailscaleHostname: result.tailscaleHostname,
        resolvedHost: result.resolvedHost,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify Tailscale hostname'
      res.status(502).json({ error: message })
    }
  })

  router.delete('/machines/:id', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    try {
      await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        const target = current.find((entry) => entry.id === machineId)
        if (!target) {
          throw new Error(`Machine "${machineId}" not found`)
        }
        if (target.id === 'local') {
          throw new Error(`Machine "${machineId}" is the local machine and cannot be removed`)
        }

        await deps.writeMachineRegistry(current.filter((entry) => entry.id !== machineId))
      })
      res.status(204).end()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update machines registry'
      if (message.includes('cannot be removed')) {
        res.status(400).json({ error: message })
        return
      }
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
        return
      }
      res.status(500).json({ error: message })
    }
  })

  router.get('/machines/:id/health', requireReadAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    if (machine.transport === 'daemon') {
      res.json(buildDaemonMachineHealthReport(
        machine,
        deps.daemonRegistry.getConnection(machine.id),
      ))
      return
    }

    const probeScript = buildMachineProbeScript()

    try {
      const preparedLaunch = prepareMachineLaunchEnvironment(machine, process.env)
      const result = deps.isRemoteMachine(machine)
        ? await runCapturedCommand(
          'ssh',
          [
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            ...deps.buildSshArgs(
              machine,
              buildLoginShellCommand(probeScript, machine.cwd, preparedLaunch.sourcedEnvFile),
              false,
              undefined,
              preparedLaunch.sshSendEnvKeys,
            ),
          ],
          { env: preparedLaunch.env, timeoutMs: 12_000, spawnImpl: spawn },
        )
        : await runCapturedCommand(
          '/bin/bash',
          ['-lc', buildLoginShellCommand(probeScript, machine.cwd, preparedLaunch.sourcedEnvFile)],
          { cwd: machine.cwd, env: preparedLaunch.env, timeoutMs: 12_000, spawnImpl: spawn },
        )

      if (result.code !== 0) {
        const detail = result.stderr.trim() || (result.timedOut ? 'Command timed out' : '')
        res.status(502).json({
          error: deps.isRemoteMachine(machine)
            ? `Machine "${machine.id}" health check failed over SSH`
            : `Machine "${machine.id}" local health check failed`,
          detail: detail || undefined,
          exitCode: result.code,
          signal: result.signal ?? undefined,
        })
        return
      }

      res.json(parseMachineHealthOutput(machine, result.stdout) as MachineHealthReport)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Health check failed'
      res.status(502).json({
        error: deps.isRemoteMachine(machine)
          ? `Machine "${machine.id}" health check failed over SSH`
          : `Machine "${machine.id}" local health check failed`,
        detail: message,
      })
    }
  })

  router.post('/machines/:id/daemon/pair', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }
    if (machineId === 'local') {
      res.status(400).json({ error: 'The local machine cannot be paired as a daemon machine' })
      return
    }

    const request = parseDaemonPairRequest(req.body)
    if (!request.ok) {
      res.status(400).json({ error: request.error })
      return
    }

    const token = createDaemonPairingToken()
    const pairedAt = new Date().toISOString()
    const expiresAt = createDaemonPairingTokenExpiresAt()

    try {
      const pairedMachine = await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        const existing = current.find((entry) => entry.id === machineId)
        const nextMachine: MachineConfig = {
          id: machineId,
          label: request.value.label ?? existing?.label ?? machineId,
          host: existing?.host ?? null,
          transport: 'daemon',
          tailscaleHostname: existing?.tailscaleHostname,
          user: existing?.user,
          port: existing?.port,
          cwd: request.value.cwd ?? existing?.cwd,
          envFile: existing?.envFile,
          daemon: {
            pairingTokenHash: hashDaemonPairingToken(token),
            pairedAt,
            expiresAt,
          },
        }
        const next = existing
          ? current.map((entry) => (entry.id === machineId ? nextMachine : entry))
          : [...current, nextMachine]
        const persisted = await deps.writeMachineRegistry(next)
        return persisted.find((entry) => entry.id === machineId) ?? nextMachine
      })

      res.status(201).json({
        machine: serializeMachineForResponse(pairedMachine),
        pairing: {
          machineId,
          token,
          websocketPath: `/api/agents/daemons/ws?machine_id=${encodeURIComponent(machineId)}`,
          pairedAt,
          expiresAt,
          command: buildMachineDaemonPairCommand({
            machineId,
            token,
            endpoint: resolveRequestEndpoint(req),
          }),
        },
        status: buildMachineDaemonStatus(
          pairedMachine,
          deps.daemonRegistry.getConnection(machineId),
        ),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pair daemon machine'
      res.status(500).json({ error: message })
    }
  })

  router.post('/machines/:id/daemon/revoke', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }
    if (machineId === 'local') {
      res.status(400).json({ error: 'The local machine cannot be revoked as a daemon machine' })
      return
    }

    const revokedAt = new Date().toISOString()
    try {
      const revokedMachine = await deps.withMachineRegistryWriteLock(async () => {
        const current = await deps.readMachineRegistry()
        const existing = current.find((entry) => entry.id === machineId)
        if (!existing) {
          throw new Error(`Machine "${machineId}" not found`)
        }
        const nextMachine: MachineConfig = {
          ...existing,
          daemon: {
            pairedAt: existing.daemon?.pairedAt,
            expiresAt: existing.daemon?.expiresAt,
            revokedAt,
            lastSeenAt: existing.daemon?.lastSeenAt,
            daemonVersion: existing.daemon?.daemonVersion,
          },
        }
        const persisted = await deps.writeMachineRegistry(
          current.map((entry) => (entry.id === machineId ? nextMachine : entry)),
        )
        return persisted.find((entry) => entry.id === machineId) ?? nextMachine
      })
      deps.daemonRegistry.disconnect(machineId, 'Daemon pairing revoked')
      res.json({
        machine: serializeMachineForResponse(revokedMachine),
        status: buildMachineDaemonStatus(revokedMachine, null),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke daemon pairing'
      if (message.includes('not found')) {
        res.status(404).json({ error: message })
        return
      }
      res.status(500).json({ error: message })
    }
  })

  router.get('/machines/:id/daemon/status', requireReadAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    res.json(buildMachineDaemonStatus(
      machine,
      deps.daemonRegistry.getConnection(machineId),
    ))
  })

  router.get('/machines/:id/auth-status', requireReadAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    try {
      res.json(await runMachineAuthStatus(machine))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider auth status probe failed'
      res.status(502).json({ error: message })
    }
  })

  router.post('/machines/:id/auth-setup', requireWriteAccess, async (req, res) => {
    const machineId = deps.parseSessionName(req.params.id)
    if (!machineId) {
      res.status(400).json({ error: 'Invalid machine ID' })
      return
    }

    const setup = parseMachineAuthSetupRequest(req.body)
    if (!setup.ok) {
      res.status(400).json({ error: setup.error })
      return
    }

    let machine: MachineConfig | undefined
    try {
      const machines = await deps.readMachineRegistry()
      machine = machines.find((entry) => entry.id === machineId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read machines registry'
      res.status(500).json({ error: message })
      return
    }

    if (!machine) {
      res.status(404).json({ error: `Machine "${machineId}" not found` })
      return
    }

    try {
      const homeDir = await resolveMachineHomeDirectory(machine)
      const envFilePath = machine.envFile ?? path.posix.join(homeDir, '.herd-env')
      const targetMachine = machine.envFile === envFilePath
        ? machine
        : await persistMachineEnvFile(deps, machine.id, envFilePath)

      // Side effects (e.g. codex device-auth needs ~/.codex/config.toml configured for file-store).
      await applyMachineAuthSetupSideEffects(targetMachine, homeDir, setup.value)

      const updates = computeMachineAuthSetupUpdates(setup.value)

      // Encrypted local env files MUST go through the canonical encrypted-aware
      // writer or the ciphertext record gets clobbered with shell text and
      // future launches fail to decrypt. See codex-review on PR #1269.
      // Plaintext (local) and remote (always plaintext-on-remote) keep using
      // the text-based readMachineTextFile + upsertExportedEnvVars path.
      if (envFilePath.endsWith('.enc') && !isRemoteMachine(targetMachine)) {
        await updateMachineEnvEntries(targetMachine, envFilePath, updates)
      } else {
        const existingEnvContents = await readMachineTextFile(targetMachine, envFilePath)
        const nextEnvContents = upsertExportedEnvVars(existingEnvContents, updates)
        if (nextEnvContents !== existingEnvContents) {
          await writeMachineTextFile(targetMachine, envFilePath, nextEnvContents)
        }
      }

      res.json(await runMachineAuthStatus(targetMachine))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider auth setup failed'
      res.status(502).json({ error: message })
    }
  })

  router.get('/world', requireReadAccess, async (_req, res) => {
    await pruneSessions()

    const nowMs = Date.now()
    const worldAgentsById = new Map<string, WorldAgent>()
    for (const session of deps.sessions.values()) {
      const worldAgent = toWorldAgent(session, nowMs)
      worldAgentsById.set(worldAgent.id, worldAgent)
    }

    try {
      const commanderSessions = await deps.commanderSessionStore?.list() ?? []
      for (const commanderSession of commanderSessions) {
        if (commanderSession.state === 'stopped') {
          continue
        }
        // Conversation rows now own runtime telemetry (`currentTask`,
        // `totalCostUsd`, `lastHeartbeat`); aggregate them so /api/agents/world
        // continues to report best-effort runtime values for commanders that
        // are not currently backed by a live stream session. See codex-review
        // P2 on PR #1279 (comment 3174491802).
        let source = {}
        if (deps.conversationStore) {
          try {
            const conversations = await deps.conversationStore.listByCommander(commanderSession.id)
            source = aggregateCommanderWorldAgentSource(conversations)
          } catch {
            // Conversation store failures fall back to commander-only data.
          }
        }
        const worldAgent = toCommanderWorldAgent(commanderSession, source)
        if (!worldAgentsById.has(worldAgent.id)) {
          worldAgentsById.set(worldAgent.id, worldAgent)
        }
      }
    } catch {
      // Ignore commander store failures and fall back to live sessions.
    }

    res.json([...worldAgentsById.values()])
  })
}

interface ParsedMachineAuthSetup {
  provider: MachineAuthProvider
  mode: MachineAuthMode
  secret?: string
}

interface ParsedDaemonPairRequest {
  label?: string
  cwd?: string
}

interface ParsedMachineEnrollmentTokenRequest {
  label?: string
  cwd?: string
}

interface ParsedMachineEnrollRequest {
  token: string
  label?: string
  cwd?: string
}

function serializeMachineForResponse(machine: MachineConfig): Record<string, unknown> {
  return {
    id: machine.id,
    label: machine.label,
    host: machine.host,
    ...(machine.transport ? { transport: machine.transport } : {}),
    ...(machine.tailscaleHostname ? { tailscaleHostname: machine.tailscaleHostname } : {}),
    ...(machine.user ? { user: machine.user } : {}),
    ...(machine.port ? { port: machine.port } : {}),
    ...(machine.cwd ? { cwd: machine.cwd } : {}),
    ...(machine.envFile ? { envFile: machine.envFile } : {}),
    ...(machine.daemon
      ? {
          daemon: {
            pairedAt: machine.daemon.pairedAt ?? null,
            expiresAt: machine.daemon.expiresAt ?? null,
            revokedAt: machine.daemon.revokedAt ?? null,
            lastSeenAt: machine.daemon.lastSeenAt ?? null,
            daemonVersion: machine.daemon.daemonVersion ?? null,
          },
        }
      : {}),
  }
}

function resolveRequestEndpoint(req: Request): string {
  const configuredEndpoint = process.env.HERD_API_BASE_URL?.trim()
  if (configuredEndpoint) {
    return configuredEndpoint.replace(/\/+$/u, '')
  }

  const forwardedProto = req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = req.header('x-forwarded-host')?.split(',')[0]?.trim()
  const protocol = forwardedProto || req.protocol || 'http'
  const host = forwardedHost || req.header('host')?.trim()
  return host ? `${protocol}://${host}` : '<herd-endpoint>'
}

function buildMachineEnrollmentCommand(options: {
  endpoint: string
  token: string
}): MachineDaemonPairCommand {
  const endpoint = options.endpoint.replace(/\/+$/u, '')
  return {
    shortCommand: `herd connect ${endpoint} --token <enrollment-token>`,
    fullCommand: `herd connect ${endpoint} --token ${options.token}`,
    disclosureLabel: 'Show full enrollment command',
  }
}

function parseMachineEnrollmentTokenRequest(
  value: unknown,
): { ok: true; value: ParsedMachineEnrollmentTokenRequest } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}

  const label = typeof record.label === 'string' && record.label.trim().length > 0
    ? record.label.trim()
    : undefined
  const cwd = typeof record.cwd === 'string' && record.cwd.trim().length > 0
    ? record.cwd.trim()
    : undefined
  if (cwd && !cwd.startsWith('/')) {
    return { ok: false, error: 'cwd must be an absolute path when provided' }
  }

  return {
    ok: true,
    value: {
      ...(label ? { label } : {}),
      ...(cwd ? { cwd } : {}),
    },
  }
}

function parseMachineEnrollRequest(
  value: unknown,
): { ok: true; value: ParsedMachineEnrollRequest } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
  if (!record) {
    return { ok: false, error: 'Invalid enrollment payload' }
  }

  const token = typeof record.token === 'string' && record.token.trim().length > 0
    ? record.token.trim()
    : ''
  const label = typeof record.label === 'string' && record.label.trim().length > 0
    ? record.label.trim()
    : undefined
  const cwd = typeof record.cwd === 'string' && record.cwd.trim().length > 0
    ? record.cwd.trim()
    : undefined
  if (!token) {
    return { ok: false, error: 'token is required' }
  }
  if (cwd && !cwd.startsWith('/')) {
    return { ok: false, error: 'cwd must be an absolute path when provided' }
  }

  return {
    ok: true,
    value: {
      token,
      ...(label ? { label } : {}),
      ...(cwd ? { cwd } : {}),
    },
  }
}

function slugifyMachineIdSeed(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^\w-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 42) || 'daemon'
}

function createEnrollmentMachineId(
  label: string,
  current: readonly MachineConfig[],
  parseMachineId: typeof parseSessionName,
): string {
  const existingIds = new Set(current.map((entry) => entry.id))
  const seed = parseMachineId(slugifyMachineIdSeed(label)) ?? 'daemon'
  if (!existingIds.has(seed) && seed !== 'local') {
    return seed
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${seed}-${randomBytes(3).toString('hex')}`
    if (!existingIds.has(candidate) && candidate !== 'local') {
      return candidate
    }
  }

  return `daemon-${randomBytes(8).toString('hex')}`
}

function parseDaemonPairRequest(
  value: unknown,
): { ok: true; value: ParsedDaemonPairRequest } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}

  const label = typeof record.label === 'string' && record.label.trim().length > 0
    ? record.label.trim()
    : undefined
  const cwd = typeof record.cwd === 'string' && record.cwd.trim().length > 0
    ? record.cwd.trim()
    : undefined
  if (cwd && !cwd.startsWith('/')) {
    return { ok: false, error: 'cwd must be an absolute path when provided' }
  }

  if (record.transport !== undefined && record.transport !== 'daemon') {
    return { ok: false, error: 'daemon pairing only supports daemon transport' }
  }

  return {
    ok: true,
    value: {
      label,
      cwd,
    },
  }
}

function parseMachineCreateOptions(
  value: unknown,
): { ok: true; verifyLaunch: boolean; agentType?: string } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}

  let verifyLaunch = false
  if (record.verifyLaunch !== undefined) {
    if (typeof record.verifyLaunch !== 'boolean') {
      return { ok: false, error: 'verifyLaunch must be a boolean when provided' }
    }
    verifyLaunch = record.verifyLaunch
  }

  const agentType = typeof record.agentType === 'string' && record.agentType.trim().length > 0
    ? record.agentType.trim()
    : undefined

  return {
    ok: true,
    verifyLaunch,
    ...(agentType ? { agentType } : {}),
  }
}

function normalizeMachineCreatePayload(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const record = value as Record<string, unknown>

  const tailscaleStatusJson = typeof record.tailscaleStatusJson === 'string'
    ? record.tailscaleStatusJson.trim()
    : ''
  if (!tailscaleStatusJson) {
    return record
  }

  const parsed = parseTailscaleStatusJson(tailscaleStatusJson)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  return {
    ...record,
    id: typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id
      : parsed.status.machineId,
    label: typeof record.label === 'string' && record.label.trim().length > 0
      ? record.label
      : parsed.status.label,
    host: typeof record.host === 'string' && record.host.trim().length > 0
      ? record.host
      : parsed.status.primaryTailscaleIp,
    tailscaleHostname: parsed.status.dnsName,
  }
}

function parseMachineAuthSetupRequest(
  value: unknown,
): { ok: true; value: ParsedMachineAuthSetup } | { ok: false; error: string } {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
  if (!record) {
    return { ok: false, error: 'Invalid auth setup payload' }
  }

  const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
  const mode = typeof record.mode === 'string' ? record.mode.trim() : ''
  const secret = typeof record.secret === 'string' ? record.secret.trim() : ''
  const machineProvider = getMachineProvider(provider)

  if (!machineProvider) {
    return { ok: false, error: 'provider must be a registered machine provider' }
  }

  if (!machineProvider.supportedAuthModes.includes(mode as MachineAuthMode)) {
    return {
      ok: false,
      error: `${machineProvider.label} setup requires one of: ${machineProvider.supportedAuthModes.join(', ')}`,
    }
  }

  const requiresSecret = machineProvider.modeRequiresSecret(mode as MachineAuthMode)
  if (requiresSecret && secret.length < 12) {
    return { ok: false, error: 'A non-empty token or API key is required' }
  }

  const parsedMode = mode as MachineAuthMode

  return {
    ok: true,
    value: {
      provider,
      mode: parsedMode,
      ...(secret ? { secret } : {}),
    },
  }
}

async function persistMachineEnvFile(
  deps: Pick<MachineWorldRouteDeps, 'readMachineRegistry' | 'withMachineRegistryWriteLock' | 'writeMachineRegistry'>,
  machineId: string,
  envFilePath: string,
): Promise<MachineConfig> {
  return await deps.withMachineRegistryWriteLock(async () => {
    const current = await deps.readMachineRegistry()
    const target = current.find((entry) => entry.id === machineId)
    if (!target) {
      throw new Error(`Machine "${machineId}" not found`)
    }

    const updated = { ...target, envFile: envFilePath }
    const persisted = await deps.writeMachineRegistry(
      current.map((entry) => (entry.id === machineId ? updated : entry)),
    )
    return persisted.find((entry) => entry.id === machineId) ?? updated
  })
}

/**
 * Pure decision logic: what env-var updates are required for this auth setup?
 * Null value removes the key. Caller routes the resulting updates through the
 * appropriate writer (encrypted-aware for `.enc`, plaintext otherwise).
 */
function computeMachineAuthSetupUpdates(
  setup: ParsedMachineAuthSetup,
): Record<string, string | null> {
  return getMachineProvider(setup.provider)?.computeAuthSetupUpdates(setup) ?? {}
}

/**
 * Side effects that must happen on top of env-file updates — currently only
 * codex device-auth, which requires `~/.codex/config.toml` to opt into the
 * file-based credential store.
 */
async function applyMachineAuthSetupSideEffects(
  machine: MachineConfig,
  homeDir: string,
  setup: ParsedMachineAuthSetup,
): Promise<void> {
  await getMachineProvider(setup.provider)?.ensureCredentialStore?.(machine, homeDir, setup)
}
