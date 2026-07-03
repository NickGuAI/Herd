import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Code2, Copy, Download, FileText, FolderTree, MessageSquarePlus, Play, Plus, Trash2, X } from 'lucide-react'
import { buildRequestHeaders, fetchJson } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import {
  buildSessionDraftImagesStorageKey,
  buildSessionDraftStorageKey,
} from '@modules/agents/page-shell/use-session-draft'
import { buildCommandRoomLaunchTarget } from '@modules/command-room/route-metadata'
import type { ConversationRecord } from '@modules/conversation/hooks/use-conversations'

interface SkillInfo {
  name: string
  dirName: string
  description: string
  userInvocable: boolean
  argumentHint?: string
  allowedTools?: string
  supportedProviders?: string[]
  source: string
}

interface SkillPackageFile {
  path: string
  type: 'directory' | 'file'
  sizeBytes?: number
}

interface SkillPackageSymbol {
  path: string
  name: string
  kind: 'heading' | 'function' | 'class'
  line: number
}

interface SkillPackageDetail extends SkillInfo {
  displayDirectory: string
  skillMd: string
  files: SkillPackageFile[]
  symbols: SkillPackageSymbol[]
}

interface SkillExportPreview {
  skill: SkillPackageDetail
  installDestinations: Array<{
    id: string
    label: string
    path: string
  }>
  archiveName: string
}

interface CreationPromptResponse {
  prompt: string
}

interface GaiaOnboardingStatus {
  exists: boolean
  commanderId: string | null
  conversationId: string | null
  displayName: string
}

interface OnboardingStatusResponse {
  gaia: GaiaOnboardingStatus
}

interface StartConversationResponse {
  conversation: ConversationRecord
}

interface SkillEditWithGaiaDeps {
  fetchJsonImpl?: typeof fetchJson
  storage?: Pick<Storage, 'setItem' | 'removeItem'>
  location?: Pick<Location, 'assign'>
}

type Panel = 'hub' | 'detail' | 'export'

const PROVIDERS = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude code', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
]

function fetchSkills(): Promise<SkillInfo[]> {
  return fetchJson<SkillInfo[]>('/api/skills')
}

function fetchSkillDetail(name: string): Promise<SkillPackageDetail> {
  return fetchJson<SkillPackageDetail>(`/api/skills/${encodeURIComponent(name)}`)
}

function fetchSkillExport(name: string): Promise<SkillExportPreview> {
  return fetchJson<SkillExportPreview>('/api/skills/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

async function downloadSkillArchive(name: string, archiveName: string): Promise<void> {
  const headers = await buildRequestHeaders()
  const response = await fetch(`${getApiBase()}/api/skills/${encodeURIComponent(name)}/archive`, {
    headers,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Download failed (${response.status}): ${body}`)
  }

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = archiveName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

function deleteSkill(name: string): Promise<{ deleted: boolean }> {
  return fetchJson<{ deleted: boolean }>(`/api/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

function createManualSkill(payload: { name: string; description: string; provider: string }): Promise<SkillPackageDetail> {
  return fetchJson<SkillPackageDetail>('/api/skills/manual', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function fetchCreationPrompt(): Promise<CreationPromptResponse> {
  return fetchJson<CreationPromptResponse>('/api/skills/creation-prompt')
}

function fetchOnboardingStatus(fetchJsonImpl: typeof fetchJson = fetchJson): Promise<OnboardingStatusResponse> {
  return fetchJsonImpl<OnboardingStatusResponse>('/api/onboarding/status')
}

function buildGaiaSkillEditPrompt(skill: SkillPackageDetail): string {
  return [
    `Please help me edit the Herd skill "${skill.name}".`,
    '',
    `Skill directory: ${skill.displayDirectory}`,
    '',
    'Review the current SKILL.md and package files first. Base every recommendation on the actual files, include verification criteria, and ask me to confirm the intended change before editing.',
  ].join('\n')
}

function writeSkillEditDraft(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  sessionName: string,
  prompt: string,
): void {
  storage.setItem(buildSessionDraftStorageKey(sessionName), prompt)
  storage.removeItem(buildSessionDraftImagesStorageKey(sessionName))
}

export async function openSkillEditWithGaia(
  skill: SkillPackageDetail,
  deps: SkillEditWithGaiaDeps = {},
): Promise<void> {
  const fetchJsonImpl = deps.fetchJsonImpl ?? fetchJson
  const storage = deps.storage ?? window.localStorage
  const location = deps.location ?? window.location
  const status = await fetchOnboardingStatus(fetchJsonImpl)
  const { gaia } = status
  if (!gaia.exists || !gaia.commanderId) {
    throw new Error('Gaia is not ready. Finish onboarding before editing skills with Gaia.')
  }

  const createdConversation = await fetchJsonImpl<ConversationRecord>(
    `/api/commanders/${encodeURIComponent(gaia.commanderId)}/conversations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'ui' }),
    },
  )
  const startedConversation = await fetchJsonImpl<StartConversationResponse>(
    `/api/conversations/${encodeURIComponent(createdConversation.id)}/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
  const conversation = startedConversation.conversation
  const sessionName = conversation.sendTarget?.sessionName
  if (!sessionName) {
    throw new Error('Gaia conversation is unavailable for skill editing.')
  }

  writeSkillEditDraft(storage, sessionName, buildGaiaSkillEditPrompt(skill))
  location.assign(buildCommandRoomLaunchTarget({
    commanderId: gaia.commanderId,
    conversationId: conversation.id,
  }).path)
}

function formatSize(value: number | undefined): string {
  if (value === undefined) return ''
  if (value < 1024) return `${value}b`
  return `${(value / 1024).toFixed(1)}kb`
}

function providerLabel(skill: SkillInfo): string {
  return skill.supportedProviders?.[0] ?? skill.allowedTools?.split(',')[0]?.trim() ?? 'Provider open'
}

function statusForSkill(skill: SkillInfo): 'active' | 'idle' {
  if (!skill.userInvocable) return 'idle'
  return skill.supportedProviders?.length ? 'active' : 'idle'
}

function skillPackageLabel(skill: SkillInfo): string {
  return `${skill.userInvocable ? 'Invocable' : 'Reference'} package · ${skill.source}`
}

function PageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div className="card-sumi max-w-md p-7 text-center">
        <h1 className="font-display text-2xl text-sumi-black">Skills</h1>
        <p className="mt-3 text-sm text-sumi-diluted">
          {error instanceof Error ? error.message : 'Unable to load skills.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg border border-ink-border bg-sumi-black px-4 py-2 text-sm text-washi-white"
        >
          Retry
        </button>
      </div>
    </section>
  )
}

function SkillCard({
  skill,
  onOpen,
  onRun,
  onExport,
  onDelete,
}: {
  skill: SkillInfo
  onOpen: () => void
  onRun: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const status = statusForSkill(skill)
  const statusClassName = status === 'active' ? 'badge-active' : 'badge-idle'
  return (
    <article className="rounded-lg border border-ink-border bg-washi-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-3">
            <h2 className="truncate font-display text-xl text-sumi-black">{skill.name}</h2>
            <span className={statusClassName}>{status}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-sumi-diluted">
            {skill.description || 'No description provided.'}
          </p>
          <p className="mt-4 font-mono text-xs uppercase tracking-[0.14em] text-sumi-faint">
            {providerLabel(skill)} · {skillPackageLabel(skill)}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" title="Run skill" onClick={onRun} className="rounded-md border border-ink-border bg-washi-aged p-2 text-sumi-diluted">
            <Play size={16} />
          </button>
          <button type="button" title="Export" onClick={onExport} className="rounded-md border border-ink-border bg-washi-aged p-2 text-sumi-diluted">
            <Download size={16} />
          </button>
          <button type="button" title="Delete" onClick={onDelete} className="rounded-md border border-ink-border bg-washi-aged p-2 text-[color:var(--vermillion-seal)]">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}

function pathDepth(filePath: string): number {
  return Math.max(0, filePath.split('/').length - 1)
}

function PackageTree({ files, maxHeightClassName = 'max-h-72' }: { files: SkillPackageFile[]; maxHeightClassName?: string }) {
  return (
    <div className="rounded-lg border border-ink-border bg-washi-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
          <FolderTree size={15} />
          Directory
        </div>
        <span className="font-mono text-xs text-sumi-faint">{files.length} entries</span>
      </div>
      <div className={`${maxHeightClassName} space-y-1 overflow-auto pr-1 font-mono text-xs text-sumi-diluted`}>
        {files.map((file) => (
          <div key={file.path} className="flex items-center justify-between gap-3" style={{ paddingLeft: pathDepth(file.path) * 12 }}>
            <span className={file.type === 'directory' ? 'text-sumi-black' : ''}>
              {file.type === 'directory' ? '▸ ' : '  '}
              {file.path}
            </span>
            <span className="text-sumi-faint">{formatSize(file.sizeBytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SymbolKindBadge({ kind }: { kind: SkillPackageSymbol['kind'] }) {
  const label = kind === 'heading' ? 'section' : kind
  return (
    <span className="rounded border border-ink-border bg-washi-aged px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-sumi-faint">
      {label}
    </span>
  )
}

function PackageSymbols({ symbols }: { symbols: SkillPackageSymbol[] }) {
  return (
    <div className="rounded-lg border border-ink-border bg-washi-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
          <Code2 size={15} />
          Sections & symbols
        </div>
        <span className="font-mono text-xs text-sumi-faint">{symbols.length} found</span>
      </div>
      {symbols.length === 0 ? (
        <p className="text-sm text-sumi-diluted">No headings or code symbols detected in this package.</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-auto pr-1">
          {symbols.map((symbol) => (
            <div key={`${symbol.path}:${symbol.line}:${symbol.name}`} className="rounded-md border border-ink-border bg-washi-aged px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-sm text-sumi-black">{symbol.name}</div>
                <SymbolKindBadge kind={symbol.kind} />
              </div>
              <div className="mt-1 break-all font-mono text-xs text-sumi-faint">
                {symbol.path}:{symbol.line}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SkillSourcePreview({ skill }: { skill: SkillPackageDetail }) {
  return (
    <div className="min-h-0 rounded-lg border border-ink-border bg-washi-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
          <FileText size={15} />
          SKILL.md
        </div>
        <span className="font-mono text-xs text-sumi-faint">{formatSize(skill.skillMd.length)}</span>
      </div>
      <pre className="max-h-[44rem] overflow-auto whitespace-pre-wrap rounded-md bg-sumi-black p-4 font-mono text-xs leading-5 text-washi-white">
        {skill.skillMd}
      </pre>
    </div>
  )
}

function SkillDirectoryInspector({ skill }: { skill: SkillPackageDetail }) {
  const fileCount = skill.files.filter((file) => file.type === 'file').length
  const directoryCount = skill.files.filter((file) => file.type === 'directory').length
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-washi-aged/35 p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-ink-border bg-washi-white p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-sumi-faint">Files</div>
              <div className="mt-1 font-display text-2xl text-sumi-black">{fileCount}</div>
            </div>
            <div className="rounded-lg border border-ink-border bg-washi-white p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-sumi-faint">Folders</div>
              <div className="mt-1 font-display text-2xl text-sumi-black">{directoryCount}</div>
            </div>
            <div className="rounded-lg border border-ink-border bg-washi-white p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-sumi-faint">Symbols</div>
              <div className="mt-1 font-display text-2xl text-sumi-black">{skill.symbols.length}</div>
            </div>
          </div>
          <PackageTree files={skill.files} maxHeightClassName="max-h-[34rem]" />
        </div>
        <div className="space-y-5">
          <PackageSymbols symbols={skill.symbols} />
          <div className="rounded-lg border border-ink-border bg-washi-white p-4">
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">Package root</div>
            <div className="mt-2 break-all font-mono text-xs text-sumi-black">{skill.displayDirectory}</div>
          </div>
        </div>
        <div className="xl:col-span-2">
          <SkillSourcePreview skill={skill} />
        </div>
      </div>
    </div>
  )
}

function SkillDetailPanel({
  skill,
  onBack,
  onRun,
  onEditWithGaia,
  onExport,
  onDelete,
  isEditingWithGaia,
  editWithGaiaError,
}: {
  skill: SkillPackageDetail
  onBack: () => void
  onRun: () => void
  onEditWithGaia: () => void
  onExport: () => void
  onDelete: () => void
  isEditingWithGaia: boolean
  editWithGaiaError: Error | null
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ink-border bg-washi-white px-6 py-4">
        <button type="button" onClick={onBack} className="font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
          ← Skills
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-sumi-black">{skill.name}</h1>
            <p className="mt-1 text-sm text-sumi-diluted">{skill.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRun} className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-diluted">
              <Play size={15} className="mr-2 inline" />
              Run skill
            </button>
            <button
              type="button"
              onClick={onEditWithGaia}
              disabled={isEditingWithGaia}
              className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-diluted disabled:opacity-60"
            >
              <MessageSquarePlus size={15} className="mr-2 inline" />
              {isEditingWithGaia ? 'Opening Gaia...' : 'Edit with Gaia'}
            </button>
            <button type="button" onClick={onExport} className="rounded-lg border border-ink-border bg-sumi-black px-3 py-2 text-sm text-washi-white">
              <Download size={15} className="mr-2 inline" />
              Export
            </button>
            <button type="button" onClick={onDelete} className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-[color:var(--vermillion-seal)]">
              <Trash2 size={15} className="mr-2 inline" />
              Delete
            </button>
          </div>
        </div>
        {editWithGaiaError && (
          <p className="mt-3 text-sm text-[color:var(--vermillion-seal)]">{editWithGaiaError.message}</p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
        <SkillDirectoryInspector skill={skill} />
        <aside className="min-h-0 overflow-auto border-t border-ink-border bg-washi-aged/45 p-5 xl:border-l xl:border-t-0">
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-border bg-washi-white p-4">
              <div className="font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">Config</div>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-sumi-faint">Provider</dt>
                  <dd className="text-sumi-black">{providerLabel(skill)}</dd>
                </div>
                <div>
                  <dt className="text-sumi-faint">Directory</dt>
                  <dd className="break-all font-mono text-xs text-sumi-black">{skill.displayDirectory}</dd>
                </div>
                <div>
                  <dt className="text-sumi-faint">Permissions</dt>
                  <dd className="text-sumi-black">{skill.allowedTools ?? 'Declared in SKILL.md'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ExportPanel({
  preview,
  onBack,
}: {
  preview: SkillExportPreview
  onBack: () => void
}) {
  const downloadMutation = useMutation({
    mutationFn: () => downloadSkillArchive(preview.skill.dirName, preview.archiveName),
  })

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-washi-aged/35">
      <div className="border-b border-ink-border bg-washi-white px-6 py-4">
        <button type="button" onClick={onBack} className="font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
          ← {preview.skill.name}
        </button>
        <h1 className="mt-3 font-display text-3xl text-sumi-black">Export package</h1>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-5 overflow-auto p-5">
        <div className="space-y-4">
          <PackageTree files={preview.skill.files} />
          <div className="rounded-lg border border-ink-border bg-washi-white p-4">
            <div className="font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">Destinations</div>
            <div className="mt-3 space-y-2">
              {preview.installDestinations.map((destination) => (
                <div key={destination.id} className="rounded-md border border-ink-border bg-washi-aged px-3 py-2">
                  <div className="text-sm text-sumi-black">{destination.label}</div>
                  <div className="break-all font-mono text-xs text-sumi-faint">{destination.path}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="min-h-0 rounded-lg border border-ink-border bg-washi-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-sumi-faint">
              <FileText size={15} />
              SKILL.md
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-sumi-faint">{preview.archiveName}</span>
              <button
                type="button"
                onClick={() => downloadMutation.mutate()}
                disabled={downloadMutation.isPending}
                className="rounded-md border border-ink-border bg-washi-aged px-3 py-1.5 text-xs text-sumi-diluted disabled:opacity-60"
              >
                <Download size={14} className="mr-1 inline" />
                Download ZIP
              </button>
            </div>
          </div>
          {downloadMutation.error && (
            <p className="mb-3 text-sm text-[color:var(--vermillion-seal)]">{downloadMutation.error.message}</p>
          )}
          <pre className="h-[calc(100%-2rem)] overflow-auto whitespace-pre-wrap rounded-md bg-sumi-black p-4 font-mono text-xs leading-5 text-washi-white">
            {preview.skill.skillMd}
          </pre>
        </div>
      </div>
    </section>
  )
}

function CreateSkillDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (skill: SkillPackageDetail) => void
}) {
  const [mode, setMode] = useState<'gaia' | 'manual'>('gaia')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState(PROVIDERS[0]?.id ?? 'codex')
  const promptQuery = useQuery({
    queryKey: ['skills', 'creation-prompt'],
    queryFn: fetchCreationPrompt,
  })
  const createMutation = useMutation({
    mutationFn: createManualSkill,
    onSuccess: onCreated,
  })

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate({ name, description, provider })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sumi-black/30 px-4">
      <div className="w-full max-w-2xl rounded-lg border border-ink-border bg-washi-white shadow-xl">
        <div className="flex items-center justify-between border-b border-ink-border px-5 py-4">
          <h2 className="font-display text-2xl text-sumi-black">Create new skill</h2>
          <button type="button" title="Close" onClick={onClose} className="rounded-md border border-ink-border p-2 text-sumi-diluted">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          <button
            type="button"
            onClick={() => setMode('gaia')}
            className={`rounded-lg border p-4 text-left ${mode === 'gaia' ? 'border-sumi-black bg-washi-aged' : 'border-ink-border bg-washi-white'}`}
          >
            <MessageSquarePlus size={18} />
            <div className="mt-3 font-display text-lg text-sumi-black">Create with Gaia</div>
            <div className="mt-1 text-sm text-sumi-diluted">Conversation package generation</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`rounded-lg border p-4 text-left ${mode === 'manual' ? 'border-sumi-black bg-washi-aged' : 'border-ink-border bg-washi-white'}`}
          >
            <FileText size={18} />
            <div className="mt-3 font-display text-lg text-sumi-black">Create manually</div>
            <div className="mt-1 text-sm text-sumi-diluted">Blank SKILL.md package</div>
          </button>
        </div>
        {mode === 'gaia' ? (
          <div className="border-t border-ink-border p-5">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-sumi-black p-4 font-mono text-xs leading-5 text-washi-white">
              {promptQuery.data?.prompt ?? 'Loading Gaia prompt...'}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(promptQuery.data?.prompt ?? '')
                }}
                className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-diluted"
              >
                <Copy size={15} className="mr-2 inline" />
                Copy prompt
              </button>
              <a href="/command-room" className="rounded-lg border border-sumi-black bg-sumi-black px-3 py-2 text-sm text-washi-white">
                Open Gaia
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={submitManual} className="space-y-4 border-t border-ink-border p-5">
            <label className="block">
              <span className="section-title mb-2 block">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none md:text-sm"
              />
            </label>
            <label className="block">
              <span className="section-title mb-2 block">Provider</span>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none md:text-sm"
              >
                {PROVIDERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="section-title mb-2 block">Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-[16px] text-sumi-black focus:outline-none md:text-sm"
              />
            </label>
            {createMutation.error && (
              <p className="text-sm text-[color:var(--vermillion-seal)]">{createMutation.error.message}</p>
            )}
            <div className="flex justify-end">
              <button type="submit" className="rounded-lg border border-sumi-black bg-sumi-black px-4 py-2 text-sm text-washi-white">
                Create package
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function DeleteDialog({
  skill,
  onCancel,
  onConfirm,
  isDeleting,
}: {
  skill: SkillInfo
  onCancel: () => void
  onConfirm: () => void
  isDeleting: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sumi-black/30 px-4">
      <div className="w-full max-w-md rounded-lg border border-ink-border bg-washi-white p-6 shadow-xl">
        <h2 className="font-display text-2xl text-sumi-black">Delete {skill.name}?</h2>
        <p className="mt-3 text-sm leading-6 text-sumi-diluted">
          This removes the local skill package directory from its installed source.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-ink-border bg-washi-aged px-3 py-2 text-sm text-sumi-diluted">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={isDeleting} className="rounded-lg border border-[color:var(--vermillion-seal)] bg-[color:var(--vermillion-seal)] px-3 py-2 text-sm text-washi-white disabled:opacity-60">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export function SkillsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillInfo | null>(null)
  const queryClient = useQueryClient()
  const panel = (searchParams.get('panel') as Panel | null) ?? 'hub'
  const selectedName = searchParams.get('skill') ?? ''
  const skillsQuery = useQuery({ queryKey: ['skills', 'manage'], queryFn: fetchSkills })
  const selectedSkill = useMemo(
    () => skillsQuery.data?.find((skill) => skill.name === selectedName || skill.dirName === selectedName) ?? null,
    [skillsQuery.data, selectedName],
  )
  const detailQuery = useQuery({
    queryKey: ['skills', 'detail', selectedName],
    queryFn: () => fetchSkillDetail(selectedName),
    enabled: Boolean(selectedName) && panel === 'detail',
  })
  const exportQuery = useQuery({
    queryKey: ['skills', 'export', selectedName],
    queryFn: () => fetchSkillExport(selectedName),
    enabled: Boolean(selectedName) && panel === 'export',
  })
  const deleteMutation = useMutation({
    mutationFn: deleteSkill,
    onSuccess: async () => {
      setDeleteTarget(null)
      setSearchParams({})
      await queryClient.invalidateQueries({ queryKey: ['skills'] })
    },
  })
  const editWithGaiaMutation = useMutation({
    mutationFn: (skill: SkillPackageDetail) => openSkillEditWithGaia(skill),
  })

  function runSkill(skill: SkillInfo) {
    void navigator.clipboard?.writeText(`/${skill.name}`)
    window.location.assign('/command-room')
  }

  function openPanel(nextPanel: Panel, skill: SkillInfo) {
    setSearchParams({ panel: nextPanel, skill: skill.dirName })
  }

  if (skillsQuery.isLoading) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center" data-testid="skills-page-loading">
        <div className="h-3 w-3 animate-breathe rounded-full bg-sumi-mist" />
      </section>
    )
  }

  if (skillsQuery.error || !skillsQuery.data) {
    return <PageError error={skillsQuery.error} onRetry={() => void skillsQuery.refetch()} />
  }

  if (panel === 'detail' && detailQuery.data) {
    return (
      <>
        <SkillDetailPanel
          skill={detailQuery.data}
          onBack={() => setSearchParams({})}
          onRun={() => runSkill(detailQuery.data)}
          onEditWithGaia={() => editWithGaiaMutation.mutate(detailQuery.data)}
          onExport={() => setSearchParams({ panel: 'export', skill: detailQuery.data.dirName })}
          onDelete={() => setDeleteTarget(detailQuery.data)}
          isEditingWithGaia={editWithGaiaMutation.isPending}
          editWithGaiaError={editWithGaiaMutation.error}
        />
        {deleteTarget && (
          <DeleteDialog
            skill={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => deleteMutation.mutate(deleteTarget.dirName)}
            isDeleting={deleteMutation.isPending}
          />
        )}
      </>
    )
  }

  if (panel === 'export' && exportQuery.data) {
    return <ExportPanel preview={exportQuery.data} onBack={() => setSearchParams({ panel: 'detail', skill: exportQuery.data.skill.dirName })} />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-washi-aged/35" data-testid="skills-page">
      <div className="border-b border-ink-border bg-washi-white px-6 py-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-sumi-faint">Herd</p>
            <h1 className="mt-1 font-display text-3xl text-sumi-black">Skills</h1>
            <p className="mt-1 text-sm text-sumi-diluted">Reusable automation packages driven by commanders and providers.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-lg border border-sumi-black bg-sumi-black px-4 py-2 text-sm text-washi-white"
          >
            <Plus size={16} className="mr-2 inline" />
            New skill
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-5xl gap-4">
          {skillsQuery.data.map((skill) => (
            <SkillCard
              key={`${skill.source}:${skill.dirName}`}
              skill={skill}
              onOpen={() => openPanel('detail', skill)}
              onRun={() => runSkill(skill)}
              onExport={() => openPanel('export', skill)}
              onDelete={() => setDeleteTarget(skill)}
            />
          ))}
        </div>
      </div>
      {panel === 'detail' && selectedSkill && detailQuery.isError && (
        <PageError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      )}
      {panel === 'export' && selectedSkill && exportQuery.isError && (
        <PageError error={exportQuery.error} onRetry={() => void exportQuery.refetch()} />
      )}
      {createOpen && (
        <CreateSkillDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async (skill) => {
            setCreateOpen(false)
            await queryClient.invalidateQueries({ queryKey: ['skills'] })
            setSearchParams({ panel: 'detail', skill: skill.dirName })
          }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          skill={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.dirName)}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </section>
  )
}

export default SkillsPage
