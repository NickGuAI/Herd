import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquarePlus } from 'lucide-react'
import {
  createMachine,
  type CreateMachineInput,
} from '@/hooks/use-agents'
import { parseTailscaleStatusJson } from '@gehirn/herd-cli/tailscale-status'
import { buildGaiaCreateMachinePrompt } from '@modules/command-room/gaia-entry-prompts'
import { openGaiaConversationWithDraft } from '@modules/command-room/gaia-launch'

type WorkerConnectionMode = 'same-machine' | 'direct-ssh' | 'tailscale'
type TailscalePlatformOption = 'macos' | 'linux' | 'already-installed'

const INPUT_CLASS =
  'w-full rounded-lg border border-[color:var(--hv-border-hair)] px-3 py-2 text-[16px] md:text-sm bg-[var(--hv-surface-card)] focus:outline-none focus:ring-1 focus:ring-[color:var(--hv-field-focus-border)] placeholder:text-[color:var(--hv-fg-faint)]'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[120px] resize-y font-mono text-xs`
const LABEL_CLASS = 'text-whisper uppercase tracking-wide text-[color:var(--hv-fg-subtle)]'

const MODE_OPTIONS: Array<{ value: WorkerConnectionMode; label: string }> = [
  { value: 'same-machine', label: 'Same machine' },
  { value: 'direct-ssh', label: 'Direct SSH' },
  { value: 'tailscale', label: 'Behind NAT - use Tailscale' },
]

const TAILSCALE_PLATFORM_OPTIONS: Array<{ value: TailscalePlatformOption; label: string }> = [
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'already-installed', label: 'Already installed' },
]

const TAILSCALE_COMMANDS: Record<TailscalePlatformOption, string[]> = {
  macos: [
    'brew install tailscale',
    'sudo tailscale up',
  ],
  linux: [
    'curl -fsSL https://tailscale.com/install.sh | sh',
    'sudo tailscale up',
  ],
  'already-installed': [
    'sudo tailscale up',
  ],
}

function detectSuggestedTailscalePlatform(): TailscalePlatformOption {
  if (typeof navigator === 'undefined') {
    return 'macos'
  }

  const fingerprint = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (fingerprint.includes('mac')) {
    return 'macos'
  }
  if (fingerprint.includes('linux')) {
    return 'linux'
  }
  return 'already-installed'
}

function parsePort(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined
}

function renderCommandList(platform: TailscalePlatformOption) {
  return (
    <div className="space-y-2 rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-3">
      <p className="text-sm text-[color:var(--hv-fg)]">
        Run these commands on the machine you want to pair:
      </p>
      {TAILSCALE_COMMANDS[platform].map((command) => (
        <pre
          key={command}
          className="overflow-x-auto rounded-md bg-[var(--hv-button-primary-bg)] px-3 py-2 font-mono text-xs text-[color:var(--hv-fg-inverse)]"
        >
          {command}
        </pre>
      ))}
      <p className="text-xs text-[color:var(--hv-fg-subtle)]">
        `tailscale up` opens the Tailscale auth flow the first time it runs.
      </p>
      <div className="rounded-md border border-dashed border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)] p-3">
        <p className="text-sm text-[color:var(--hv-fg)]">
          Then run <span className="font-mono">tailscale status --json</span> and paste the full JSON output below.
        </p>
      </div>
    </div>
  )
}

export function AddWorkerWizard({
  onCreated,
}: {
  onCreated: () => void | Promise<void>
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<WorkerConnectionMode>('tailscale')
  const [tailscalePlatform, setTailscalePlatform] = useState<TailscalePlatformOption>(
    () => detectSuggestedTailscalePlatform(),
  )
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [tailscaleStatusJson, setTailscaleStatusJson] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [cwd, setCwd] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isOpeningWithGaia, setIsOpeningWithGaia] = useState(false)
  const [gaiaError, setGaiaError] = useState<string | null>(null)

  const parsedTailscaleStatus = useMemo(() => {
    const trimmed = tailscaleStatusJson.trim()
    return trimmed ? parseTailscaleStatusJson(trimmed) : null
  }, [tailscaleStatusJson])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    if (mode === 'same-machine') {
      setActionError('The local machine is already available as `local` and does not need registration.')
      return
    }

    const parsedStatus = mode === 'tailscale'
      ? parseTailscaleStatusJson(tailscaleStatusJson.trim())
      : null
    if (parsedStatus && !parsedStatus.ok) {
      setActionError(parsedStatus.error)
      return
    }

    const trimmedId = id.trim() || (parsedStatus?.ok ? parsedStatus.status.machineId : '')
    const trimmedLabel = label.trim() || (parsedStatus?.ok ? parsedStatus.status.label : '')
    if (!trimmedId || !trimmedLabel) {
      setActionError('Machine ID and label are required.')
      return
    }
    if (!cwd.trim()) {
      setActionError('Working directory is required.')
      return
    }

    const input: CreateMachineInput = {
      id: trimmedId,
      label: trimmedLabel,
      user: user.trim() || undefined,
      port: parsePort(port),
      cwd: cwd.trim() || undefined,
    }

    if (mode === 'direct-ssh') {
      const trimmedHost = host.trim()
      if (!trimmedHost) {
        setActionError('Host is required for direct SSH machines.')
        return
      }
      input.host = trimmedHost
    } else {
      if (!tailscaleStatusJson.trim()) {
        setActionError('Full Tailscale status JSON is required.')
        return
      }
      input.tailscaleStatusJson = tailscaleStatusJson.trim()
    }

    setIsSubmitting(true)
    setActionError(null)
    try {
      await createMachine(input)
      await queryClient.invalidateQueries({ queryKey: ['agents', 'machines'] })
      await onCreated()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to register machine.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleOpenWithGaia(): Promise<void> {
    setIsOpeningWithGaia(true)
    setGaiaError(null)
    try {
      await openGaiaConversationWithDraft(buildGaiaCreateMachinePrompt())
    } catch (error) {
      setGaiaError(error instanceof Error ? error.message : 'Failed to open Gaia.')
    } finally {
      setIsOpeningWithGaia(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleOpenWithGaia()}
          disabled={isOpeningWithGaia}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-[color:var(--hv-border-soft)] px-3 py-1.5 text-sm text-[color:var(--hv-fg)] transition-colors hover:bg-[var(--hv-surface-hover)] disabled:opacity-60"
        >
          <MessageSquarePlus size={15} className="mr-2 inline" />
          {isOpeningWithGaia ? 'Opening Gaia...' : 'Do it with Gaia'}
        </button>
      </div>

      {gaiaError ? (
        <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
          {gaiaError}
        </div>
      ) : null}

      <div className="space-y-2">
        <label className={LABEL_CLASS} htmlFor="worker-connection-mode">Machine location</label>
        <select
          id="worker-connection-mode"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as WorkerConnectionMode)
            setActionError(null)
          }}
          className={INPUT_CLASS}
          required
        >
          {MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      {mode === 'same-machine' && (
        <div className="rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] p-4 text-sm text-[color:var(--hv-fg)]">
          The Herd host already exposes the local machine as <span className="font-mono">local</span>.
          Use that machine entry when you want to run sessions on this server.
        </div>
      )}

      {mode === 'tailscale' && (
        <>
          <div className="space-y-2">
            <label className={LABEL_CLASS} htmlFor="worker-tailscale-platform">Machine OS</label>
            <select
              id="worker-tailscale-platform"
              value={tailscalePlatform}
              onChange={(event) => setTailscalePlatform(event.target.value as TailscalePlatformOption)}
              className={INPUT_CLASS}
              required
            >
              {TAILSCALE_PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {renderCommandList(tailscalePlatform)}
        </>
      )}

      {mode !== 'same-machine' && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-id">Machine ID</label>
              <input
                id="worker-id"
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="home-mac"
                className={INPUT_CLASS}
                required={mode === 'direct-ssh'}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-label">Label</label>
              <input
                id="worker-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Home Mac"
                className={INPUT_CLASS}
                required={mode === 'direct-ssh'}
              />
            </div>
          </div>

          {mode === 'direct-ssh' ? (
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-host">SSH Host</label>
              <input
                id="worker-host"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="10.0.1.60"
                className={INPUT_CLASS}
                required
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-tailscale-status-json">Tailscale status JSON</label>
              <textarea
                id="worker-tailscale-status-json"
                value={tailscaleStatusJson}
                onChange={(event) => {
                  setTailscaleStatusJson(event.target.value)
                  setActionError(null)
                }}
                placeholder="Paste the full output of tailscale status --json"
                className={TEXTAREA_CLASS}
                required
              />
              {parsedTailscaleStatus?.ok ? (
                <p className="text-sm text-[color:var(--hv-fg)]">
                  Derived <span className="font-mono">{parsedTailscaleStatus.status.machineId}</span>
                  {' '}from <span className="font-mono">{parsedTailscaleStatus.status.dnsName}</span>
                  {' '}({parsedTailscaleStatus.status.primaryTailscaleIp}).
                </p>
              ) : null}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-user">SSH User</label>
              <input
                id="worker-user"
                value={user}
                onChange={(event) => setUser(event.target.value)}
                placeholder="yugu"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-port">SSH Port</label>
              <input
                id="worker-port"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                placeholder="22"
                inputMode="numeric"
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <label className={LABEL_CLASS} htmlFor="worker-cwd">Working Directory</label>
              <input
                id="worker-cwd"
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="/Users/yugu"
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </>
      )}

      {actionError && (
        <div className="rounded-lg border border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
          {actionError}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="btn-ghost min-h-[44px]"
          disabled={isSubmitting || mode === 'same-machine'}
        >
          {isSubmitting ? 'Registering...' : 'Register machine'}
        </button>
      </div>
    </form>
  )
}
