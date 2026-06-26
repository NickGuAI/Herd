import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import {
  createMachine,
  setupMachineAuth,
  useMachineAuthStatus,
  verifyMachineLaunch,
} from '@/hooks/use-agents'
import { useProviderRegistry } from '@/hooks/use-providers'
import { parseTailscaleStatusJson } from '@gehirn/herd-cli/tailscale-status'
import type {
  Machine,
  MachineAuthMode,
  MachineAuthProvider,
  ProviderRegistryEntry,
} from '@/types'
import { ModalFormContainer } from '@modules/components/ModalFormContainer'

const INPUT_CLASS =
  'w-full rounded-lg border border-[color:var(--hv-border-hair)] px-3 py-2 text-[16px] md:text-sm bg-[var(--hv-surface-card)] focus:outline-none focus:ring-1 focus:ring-[color:var(--hv-field-focus-border)] placeholder:text-[color:var(--hv-fg-faint)]'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[96px] resize-y`
const GUIDE_URL = 'https://github.com/NickGuAI/Herd/blob/main/apps/herd/docs/provider-auth-setup.md'

interface AddWorkerWizardProps {
  open: boolean
  onClose: () => void
  onMachineReady?: (machine: Machine) => void
  initialMachine?: Machine | null
}

interface ProviderDraftState {
  mode: MachineAuthMode
  secret: string
  isSubmitting: boolean
  error: string | null
}

function slugifyMachineId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'machine'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildSshCommand(machine: Machine, innerCommand: string): string {
  if (!machine.host) {
    return innerCommand
  }
  const destination = machine.user ? `${machine.user}@${machine.host}` : (machine.host ?? 'machine')
  const portPart = machine.port ? `-p ${machine.port} ` : ''
  return `ssh ${portPart}${destination} ${shellQuote(innerCommand)}`
}

function buildInitialProviderDrafts(
  providers: readonly ProviderRegistryEntry[],
): Record<string, ProviderDraftState> {
  return Object.fromEntries(
    providers
      .filter((provider) => provider.machineAuth)
      .map((provider) => [
        provider.id,
        {
          mode: provider.machineAuth?.supportedAuthModes[0] ?? 'api-key',
          secret: '',
          isSubmitting: false,
          error: null,
        } satisfies ProviderDraftState,
      ]),
  )
}

function buildInitialProviderSelection(
  providers: readonly ProviderRegistryEntry[],
): Record<string, boolean> {
  return Object.fromEntries(
    providers
      .filter((provider) => provider.machineAuth)
      .map((provider) => [provider.id, true]),
  )
}

function providerActionLabel(mode: MachineAuthMode): string {
  if (mode === 'device-auth') {
    return 'Prepare device auth'
  }
  if (mode === 'setup-token') {
    return 'Save token and verify'
  }
  return 'Save API key and verify'
}

function modeLabel(mode: MachineAuthMode): string {
  if (mode === 'setup-token') {
    return 'Setup token'
  }
  if (mode === 'device-auth') {
    return 'Device auth'
  }
  return 'API key'
}

function buildManualAuthCommand(
  provider: ProviderRegistryEntry,
  mode: MachineAuthMode,
): string {
  const cli = provider.machineAuth?.cliBinaryName ?? provider.id
  if (mode === 'setup-token') {
    return `${cli} setup-token`
  }
  if (mode === 'device-auth') {
    return `${cli} login --device-auth`
  }
  return cli
}

export function AddWorkerWizard({
  open,
  onClose,
  onMachineReady,
  initialMachine = null,
}: AddWorkerWizardProps) {
  const { data: providers = [] } = useProviderRegistry()
  const machineProviders = useMemo(
    () => providers.filter((provider) => provider.machineAuth),
    [providers],
  )
  const queryClient = useQueryClient()
  const [step, setStep] = useState<1 | 2>(initialMachine ? 2 : 1)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [host, setHost] = useState(initialMachine?.host ?? '')
  const [tailscaleStatusJson, setTailscaleStatusJson] = useState('')
  const [label, setLabel] = useState(initialMachine?.label ?? '')
  const [user, setUser] = useState(initialMachine?.user ?? '')
  const [port, setPort] = useState(initialMachine?.port ? String(initialMachine.port) : '')
  const [cwd, setCwd] = useState(initialMachine?.cwd ?? '')
  const [isCreating, setIsCreating] = useState(false)
  const [isLaunchVerifying, setIsLaunchVerifying] = useState(false)
  const [machine, setMachine] = useState<Machine | null>(initialMachine)
  const [selectedProviders, setSelectedProviders] = useState<Record<string, boolean>>({})
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraftState>>({})

  useEffect(() => {
    if (!open) {
      return
    }

    setStep(initialMachine ? 2 : 1)
    setConnectionError(null)
    setHost(initialMachine?.host ?? '')
    setTailscaleStatusJson('')
    setLabel(initialMachine?.label ?? '')
    setUser(initialMachine?.user ?? '')
    setPort(initialMachine?.port ? String(initialMachine.port) : '')
    setCwd(initialMachine?.cwd ?? '')
    setIsCreating(false)
    setIsLaunchVerifying(false)
    setMachine(initialMachine)
    setSelectedProviders(buildInitialProviderSelection(machineProviders))
    setProviderDrafts(buildInitialProviderDrafts(machineProviders))
  }, [initialMachine, machineProviders, open])

  const parsedTailscaleStatus = useMemo(() => {
    const trimmed = tailscaleStatusJson.trim()
    return trimmed ? parseTailscaleStatusJson(trimmed) : null
  }, [tailscaleStatusJson])

  const derivedMachineId = useMemo(() => {
    const parsed = parsedTailscaleStatus?.ok ? parsedTailscaleStatus.status : null
    return slugifyMachineId(label.trim() || parsed?.machineId || host.trim())
  }, [host, label, parsedTailscaleStatus])

  const authStatusQuery = useMachineAuthStatus(machine?.id, open && machine !== null)
  const authStatus = authStatusQuery.data
  const machineLabel = (machine?.label ?? label.trim()) || 'Machine'
  const machineHost = machine?.host ?? (host.trim() || 'local')

  const selectedMachineProviders = machineProviders.filter((provider) => selectedProviders[provider.id])
  const launchProviderId = selectedMachineProviders.find((provider) =>
    authStatus?.providers[provider.id]?.configured === true,
  )?.id
  const canFinish = machineProviders.length === 0 || (
    selectedMachineProviders.length > 0 &&
    selectedMachineProviders.every((provider) => authStatus?.providers[provider.id]?.configured === true) &&
    Boolean(launchProviderId)
  )

  async function handleCreateMachine(): Promise<void> {
    const trimmedHost = host.trim()
    const trimmedTailscaleStatusJson = tailscaleStatusJson.trim()
    const parsedStatus = trimmedTailscaleStatusJson ? parseTailscaleStatusJson(trimmedTailscaleStatusJson) : null
    if (parsedStatus && !parsedStatus.ok) {
      setConnectionError(parsedStatus.error)
      return
    }

    const trimmedLabel = label.trim() || (parsedStatus?.ok ? parsedStatus.status.label : trimmedHost)
    const trimmedUser = user.trim()
    const trimmedCwd = cwd.trim()

    if (!trimmedHost && !trimmedTailscaleStatusJson) {
      setConnectionError('Hostname/IP or full Tailscale status JSON is required.')
      return
    }

    const parsedPort = port.trim() ? Number.parseInt(port.trim(), 10) : undefined
    if (port.trim() && (!Number.isInteger(parsedPort) || (parsedPort ?? 0) <= 0 || (parsedPort ?? 0) > 65535)) {
      setConnectionError('SSH port must be between 1 and 65535.')
      return
    }

    if (!trimmedCwd) {
      setConnectionError('Workspace directory is required for launch verification.')
      return
    }

    if (!trimmedCwd.startsWith('/')) {
      setConnectionError('Workspace directory must be an absolute path.')
      return
    }

    setIsCreating(true)
    setConnectionError(null)

    try {
      const created = await createMachine({
        id: derivedMachineId,
        label: trimmedLabel,
        ...(trimmedTailscaleStatusJson ? { tailscaleStatusJson: trimmedTailscaleStatusJson } : { host: trimmedHost }),
        ...(trimmedUser ? { user: trimmedUser } : {}),
        ...(parsedPort ? { port: parsedPort } : {}),
        cwd: trimmedCwd,
      })
      setMachine(created)
      setStep(2)
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Failed to add machine.')
    } finally {
      setIsCreating(false)
    }
  }

  function updateProviderDraft(
    provider: MachineAuthProvider,
    updates: Partial<ProviderDraftState>,
  ): void {
    setProviderDrafts((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        ...updates,
      },
    }))
  }

  async function handleProviderSetup(provider: MachineAuthProvider): Promise<void> {
    if (!machine) {
      return
    }

    const draft = providerDrafts[provider]
    const needsSecret = draft.mode !== 'device-auth'
    if (needsSecret && draft.secret.trim().length < 12) {
      updateProviderDraft(provider, { error: 'Paste a valid token or API key first.' })
      return
    }

    updateProviderDraft(provider, { isSubmitting: true, error: null })

    try {
      await setupMachineAuth(machine.id, {
        provider,
        mode: draft.mode,
        ...(needsSecret ? { secret: draft.secret.trim() } : {}),
      })
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
      await authStatusQuery.refetch()
      updateProviderDraft(provider, { secret: '' })
    } catch (error) {
      updateProviderDraft(
        provider,
        { error: error instanceof Error ? error.message : 'Failed to save provider credentials.' },
      )
    } finally {
      updateProviderDraft(provider, { isSubmitting: false })
    }
  }

  function handleProviderSkip(provider: MachineAuthProvider): void {
    setSelectedProviders((current) => ({
      ...current,
      [provider]: false,
    }))
    updateProviderDraft(provider, { error: null, secret: '' })
  }

  async function handleFinish(): Promise<void> {
    if (!machine) {
      onClose()
      return
    }
    if (!canFinish) {
      setConnectionError('Configure at least one provider before launch verification.')
      return
    }

    setIsLaunchVerifying(true)
    setConnectionError(null)
    try {
      await verifyMachineLaunch(machine.id, {
        ...(launchProviderId ? { agentType: launchProviderId } : {}),
      })
      onMachineReady?.(machine)
      onClose()
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Machine launch verification failed.')
    } finally {
      setIsLaunchVerifying(false)
    }
  }

  return (
    <ModalFormContainer
      open={open}
      onClose={onClose}
      title={step === 1 ? 'Add Machine' : 'Machine Provider Auth'}
      contentClassName="space-y-4"
    >
      <div className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3">
        <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--hv-fg-subtle)]">
          {step === 1 ? 'Step 1 of 2' : 'Step 2 of 2'}
        </div>
        <div className="mt-1 text-sm text-[color:var(--hv-fg)]">
          {step === 1
          ? 'Register the machine first, then configure provider auth on the same machine.'
            : `Configure provider auth on ${machineLabel}.`}
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
              <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">Machine label</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Workshop Mac Mini"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
              <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">Hostname or IP</span>
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="tail2bb6ea.ts.net"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
              <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">SSH user</span>
              <input
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="yugu"
                className={INPUT_CLASS}
              />
            </label>

            <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
              <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">SSH port</span>
              <input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="22"
                className={INPUT_CLASS}
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
            <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">Tailscale status JSON</span>
            <textarea
              value={tailscaleStatusJson}
              onChange={(event) => setTailscaleStatusJson(event.target.value)}
              placeholder="Paste the full output of tailscale status --json"
              className={TEXTAREA_CLASS}
            />
            {parsedTailscaleStatus?.ok ? (
              <span className="block text-xs text-[color:var(--hv-fg-subtle)]">
                Derived from Tailscale: {parsedTailscaleStatus.status.dnsName} ({parsedTailscaleStatus.status.primaryTailscaleIp})
              </span>
            ) : null}
          </label>

          <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
            <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">Workspace directory</span>
            <input
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
              placeholder="/Users/yugu/workspace"
              className={INPUT_CLASS}
            />
          </label>

          <div className="rounded-lg border border-dashed border-[color:var(--hv-border-hair)] px-3 py-2 text-sm text-[color:var(--hv-fg-subtle)]">
            Machine ID preview: <span className="font-mono text-[color:var(--hv-fg)]">{derivedMachineId}</span>
          </div>

          {connectionError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {connectionError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreateMachine()}
              className="btn-primary inline-flex items-center gap-2"
              disabled={isCreating}
            >
              {isCreating ? <Loader2 size={14} className="animate-spin" /> : null}
              Continue to provider auth
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3 text-sm text-[color:var(--hv-fg)]">
            <div className="font-medium">{machineLabel}</div>
            <div className="mt-1 text-[color:var(--hv-fg-subtle)]">
              {machineHost}
              {machine?.user ? ` as ${machine.user}` : ''}
              {machine?.port ? ` on port ${machine.port}` : ''}
            </div>
            {authStatus?.envFile ? (
              <div className="mt-2 font-mono text-xs text-[color:var(--hv-fg-subtle)]">
                env file: {authStatus.envFile}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3 text-sm">
            <div className="text-[color:var(--hv-fg-subtle)]">
              Need the manual commands? The full guide stays in the repo docs.
            </div>
            <a
              href={GUIDE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[color:var(--hv-fg)] underline underline-offset-2"
            >
              Provider auth guide
              <ExternalLink size={14} />
            </a>
          </div>

          {authStatusQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-3 text-sm text-[color:var(--hv-fg-subtle)]">
              <Loader2 size={14} className="animate-spin" />
              Checking machine provider status...
            </div>
          ) : null}

          {authStatusQuery.error ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {authStatusQuery.error instanceof Error
                ? authStatusQuery.error.message
                : 'Could not read provider auth status.'}
            </div>
          ) : null}

          {machineProviders.map((provider) => {
            const status = authStatus?.providers[provider.id]
            const draft = providerDrafts[provider.id]
            if (!draft) {
              return null
            }
            const selected = selectedProviders[provider.id]
            const sshCommand = machine
              ? buildSshCommand(machine, buildManualAuthCommand(provider, draft.mode))
              : ''
            const supportedAuthModes = provider.machineAuth?.supportedAuthModes ?? []
            const requiresSecret = provider.machineAuth?.requiresSecretModes.includes(draft.mode) ?? true

            return (
              <div key={provider.id} className="rounded-xl border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => setSelectedProviders((current) => ({
                        ...current,
                        [provider.id]: event.target.checked,
                      }))}
                      className="mt-1 h-4 w-4 rounded border-[color:var(--hv-border-hair)]"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-[color:var(--hv-fg)]">
                        {status?.label ?? provider.label}
                        </div>
                        <a
                          href={GUIDE_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[color:var(--hv-fg-subtle)] underline underline-offset-2"
                        >
                          Guide
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <div className="mt-1 text-sm text-[color:var(--hv-fg-subtle)]">
                        {supportedAuthModes.includes('setup-token')
                          ? 'Run setup-token on the machine, paste the resulting token here, then verify before dispatching sessions.'
                          : supportedAuthModes.includes('device-auth')
                            ? 'Use an API key or device auth on the machine. Device auth keeps provider credentials on disk.'
                            : 'Paste an API key here, then verify the machine before dispatching sessions.'}
                      </div>
                    </div>
                  </label>

                  <div className="rounded-full border border-[color:var(--hv-border-hair)] px-2.5 py-1 text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">
                    {status?.configured
                      ? 'ready'
                      : selected
                        ? (status?.installed === false ? 'cli missing' : 'pending')
                        : 'skipped'}
                  </div>
                </div>

                {status ? (
                  <div className="mt-3 grid gap-2 text-xs text-[color:var(--hv-fg-subtle)] md:grid-cols-2">
                    <div>Version: <span className="font-mono text-[color:var(--hv-fg)]">{status.version ?? 'missing'}</span></div>
                    <div>Detected auth: <span className="font-mono text-[color:var(--hv-fg)]">{status.currentMethod}</span></div>
                    <div>Env source: <span className="font-mono text-[color:var(--hv-fg)]">{status.envSourceKey ?? 'missing'}</span></div>
                    <div>Verification: <span className="font-mono text-[color:var(--hv-fg)]">{status.verificationCommand}</span></div>
                  </div>
                ) : null}

                {selected ? (
                  <div className="mt-4 space-y-3">
                    {supportedAuthModes.length > 1 ? (
                      <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
                        <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">Auth mode</span>
                        <select
                          value={draft.mode}
                          onChange={(event) => updateProviderDraft(provider.id, {
                            mode: event.target.value as MachineAuthMode,
                            error: null,
                          })}
                          className={INPUT_CLASS}
                        >
                          {supportedAuthModes.map((mode) => (
                            <option key={mode} value={mode}>
                              {modeLabel(mode)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {draft.mode === 'setup-token' ? (
                      <div className="rounded-lg border border-dashed border-[color:var(--hv-border-hair)] px-3 py-2 text-sm text-[color:var(--hv-fg-subtle)]">
                        1. Run on the machine:
                        <div className="mt-2 font-mono text-xs text-[color:var(--hv-fg)]">{sshCommand}</div>
                        <div className="mt-2">2. Paste the resulting token below and verify it.</div>
                      </div>
                    ) : null}

                    {draft.mode === 'device-auth' ? (
                      <div className="rounded-lg border border-dashed border-[color:var(--hv-border-hair)] px-3 py-2 text-sm text-[color:var(--hv-fg-subtle)]">
                        1. Click <strong>Prepare device auth</strong> once so the machine can store credentials on disk.
                        <div className="mt-2">2. Run on the machine:</div>
                        <div className="mt-2 font-mono text-xs text-[color:var(--hv-fg)]">{sshCommand}</div>
                        <div className="mt-2">3. Complete the device-code prompt, then refresh status here.</div>
                      </div>
                    ) : null}

                    {requiresSecret ? (
                      <label className="space-y-1 text-sm text-[color:var(--hv-fg)]">
                        <span className="text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">
                          {modeLabel(draft.mode)}
                        </span>
                        <textarea
                          value={draft.secret}
                          onChange={(event) => updateProviderDraft(provider.id, {
                            secret: event.target.value,
                            error: null,
                          })}
                          className={TEXTAREA_CLASS}
                          placeholder={draft.mode === 'setup-token' ? 'Paste setup token' : 'Paste provider secret'}
                        />
                      </label>
                    ) : null}

                    {draft.error ? (
                      <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {draft.error}
                      </div>
                    ) : null}

                    {status?.configured ? (
                      <div className="flex items-center gap-2 rounded-lg border border-[color:var(--hv-accent-success)] bg-[var(--hv-accent-success-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-success)]">
                        <CheckCircle2 size={16} />
                        {status.label} is ready on this machine.
                      </div>
                    ) : null}

                    {status?.installed === false ? (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {status.label} CLI is missing on this machine. Run <span className="font-mono">herd machine bootstrap {machine?.id}</span> first, then come back here to verify auth.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleProviderSetup(provider.id)}
                        className="btn-primary inline-flex items-center gap-2"
                        disabled={draft.isSubmitting || !machine}
                      >
                        {draft.isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
                        {providerActionLabel(draft.mode)}
                      </button>

                      <button
                        type="button"
                        onClick={() => void authStatusQuery.refetch()}
                        className="btn-ghost inline-flex items-center gap-2"
                        disabled={authStatusQuery.isFetching}
                      >
                        <RefreshCw size={14} className={authStatusQuery.isFetching ? 'animate-spin' : ''} />
                        Refresh status
                      </button>

                      <button
                        type="button"
                        onClick={() => handleProviderSkip(provider.id)}
                        className="btn-ghost"
                      >
                        Skip for now
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          {connectionError ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {connectionError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[color:var(--hv-fg-subtle)]">
              Configure at least one provider so Herd can launch-verify this machine.
            </div>
            <div className="flex items-center gap-2">
              {!initialMachine ? (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-ghost"
                >
                  Back
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleFinish()}
                className="btn-primary"
                disabled={!canFinish || isLaunchVerifying}
              >
                {isLaunchVerifying ? 'Verifying launch...' : 'Finish machine setup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalFormContainer>
  )
}
