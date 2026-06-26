import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Clock3, MessageSquare, Pencil, Play, Square, Trash2, Zap } from 'lucide-react'
import { useProviderRegistry } from '@/hooks/use-providers'
import { cn } from '@/lib/utils'
import { AgentAvatar } from '@modules/components/herd'
import type { CommanderAgentType, CommanderSession } from '../hooks/useCommander'

export interface CommanderCardProps {
  commander: CommanderSession
  onStart: (id: string, agentType: CommanderAgentType) => void
  onStop: (id: string) => void
  onTriggerHeartbeat?: (id: string) => void
  onOpenChat: (id: string, agentType: CommanderAgentType) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  isStartPending: boolean
  isStopPending: boolean
  isTriggerHeartbeatPending?: boolean
  isDeletePending: boolean
}

const STATE_BADGE_CLASSES: Record<CommanderSession['state'], string> = {
  idle: 'badge-idle',
  running: 'badge-active',
  paused: 'badge-idle',
  stopped: 'badge-stale',
}

const CHANNEL_PROVIDER_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
  email: 'Email',
  circle: 'Circle',
  imessage: 'iMessage',
  matrix: 'Matrix',
}

const ACTION_CONTROL_CLASSES =
  'btn-ghost !px-3 !py-0 inline-flex h-11 w-full items-center justify-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60'

const STAT_LINK_CLASSES =
  'btn-ghost !px-2.5 !py-1.5 inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[color:var(--hv-fg-muted)]'

declare module '../hooks/useCommander' {
  interface CommanderSession {
    channelMeta?: {
      provider: 'whatsapp' | 'telegram' | 'discord'
      displayName: string
      sessionKey?: string
      subject?: string
    }
  }
}

function resolveDisplayName(commander: CommanderSession): string {
  const channelMeta = commander.channelMeta
  if (!channelMeta) {
    return commander.host
  }
  const providerLabel = CHANNEL_PROVIDER_LABELS[channelMeta.provider] ?? channelMeta.provider
  const baseLabel = channelMeta.displayName.trim() || commander.host
  return `${providerLabel} - ${baseLabel}`
}

export function CommanderCard({
  commander,
  onStart,
  onStop,
  onTriggerHeartbeat,
  onOpenChat,
  onDelete,
  onEdit,
  isStartPending,
  isStopPending,
  isTriggerHeartbeatPending = false,
  isDeletePending,
}: CommanderCardProps) {
  const { data: providers = [] } = useProviderRegistry()
  const [agentType, setAgentType] = useState<CommanderAgentType>('claude')

  const isRunning = commander.state === 'running'
  const isStopped = commander.state === 'stopped'
  const displayName = resolveDisplayName(commander)

  const hasActiveTask = Boolean(commander.currentTask)
  const questCount = commander.questCount ?? 0
  const scheduleCount = commander.scheduleCount ?? 0

  const currentTaskTitle = commander.currentTask?.title?.trim()
  const tone = commander.ui?.speakingTone?.trim()

  return (
    <div className="card-sumi border-2 border-[color:var(--hv-border-soft)] p-4">
      {/* Identity, quest/schedule pills, state */}
      <div className="flex flex-wrap items-center gap-2">
        <AgentAvatar
          commander={{
            id: commander.id,
            displayName,
            host: commander.host,
            avatarUrl: commander.avatarUrl,
            ui: commander.ui,
          }}
          size={40}
          active={isRunning}
        />
        <p className="min-w-0 flex-1 font-mono text-sm text-[color:var(--hv-fg)] truncate">{displayName}</p>
        <Link
          to={`/quests?commander=${commander.id}`}
          className={STAT_LINK_CLASSES}
          onClick={(e) => e.stopPropagation()}
        >
          <ClipboardCheck size={12} className="shrink-0" />
          {questCount} quests
        </Link>
        <Link
          to={`/command-room?commander=${commander.id}&panel=automation`}
          className={STAT_LINK_CLASSES}
          onClick={(e) => e.stopPropagation()}
        >
          <Clock3 size={12} className="shrink-0" />
          {scheduleCount} schedules
        </Link>
        <span className={cn('badge-sumi shrink-0', STATE_BADGE_CLASSES[commander.state])}>
          <span
            className={cn(
              'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
              isRunning ? 'bg-[var(--hv-accent-success)] animate-breathe' : 'bg-[var(--hv-fg-faint)]',
            )}
          />
          {commander.state}
        </span>
      </div>
      {tone ? (
        <p className="mt-2 text-whisper text-[color:var(--hv-fg-subtle)] italic leading-snug">{tone}</p>
      ) : null}

      {/* Current task */}
      {currentTaskTitle && (
        <div className="mt-3">
          <p className="text-sm text-[color:var(--hv-fg-muted)] truncate">
            <span className="text-whisper text-[color:var(--hv-fg-subtle)] uppercase">Current task: </span>
            {currentTaskTitle}
          </p>
        </div>
      )}

      {/* Pill nav */}
      <div className="mt-3 flex gap-1 p-1 rounded-full bg-[var(--hv-bg-raised)] border border-[color:var(--hv-border-hair)] w-fit">
        <Link
          to={`/quests?commander=${commander.id}`}
          className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide font-medium text-[color:var(--hv-fg-muted)] hover:text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-card)] transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          Quests
        </Link>
        <Link
          to={`/command-room?commander=${commander.id}&panel=automation`}
          className="px-3 py-1 rounded-full text-[10px] uppercase tracking-wide font-medium text-[color:var(--hv-fg-muted)] hover:text-[color:var(--hv-fg)] hover:bg-[var(--hv-surface-card)] transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          Automations
        </Link>
      </div>

      {/* Primary actions */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {isStopped ? (
          <>
            <label className={cn(ACTION_CONTROL_CLASSES, 'cursor-pointer text-[color:var(--hv-fg-subtle)]')}>
              <select
                value={agentType}
                onChange={(e) => setAgentType(e.target.value)}
                className="w-full bg-transparent text-center text-[color:var(--hv-fg)] focus:outline-none"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={isStartPending}
              onClick={() => onStart(commander.id, agentType)}
              className={ACTION_CONTROL_CLASSES}
            >
              <Play size={12} className="fill-current" />
              Start
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isStopPending}
            onClick={() => onStop(commander.id)}
            className={ACTION_CONTROL_CLASSES}
          >
            <Square size={10} className="fill-current" />
            Stop
          </button>
        )}
        {isRunning && onTriggerHeartbeat && (
          <button
            type="button"
            disabled={isTriggerHeartbeatPending}
            onClick={() => onTriggerHeartbeat(commander.id)}
            className={ACTION_CONTROL_CLASSES}
          >
            <Zap size={12} />
            {isTriggerHeartbeatPending ? 'Triggering...' : 'Heartbeat'}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            onOpenChat(
              commander.id,
              isRunning ? (commander.agentType ?? agentType) : agentType,
            )}
          className={ACTION_CONTROL_CLASSES}
        >
          <MessageSquare size={12} />
          Chat
        </button>
        <button
          type="button"
          onClick={() => onEdit(commander.id)}
          className={ACTION_CONTROL_CLASSES}
        >
          <Pencil size={12} />
          Edit
        </button>
        {isStopped && (
          <button
            type="button"
            disabled={isDeletePending}
            onClick={() => onDelete(commander.id)}
            className={cn(ACTION_CONTROL_CLASSES, 'text-[color:var(--hv-accent-danger)]')}
          >
            <Trash2 size={12} />
            Delete
          </button>
        )}
      </div>

    </div>
  )
}
