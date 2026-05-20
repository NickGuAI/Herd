import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/lib/api'
import type {
  WorkspaceContextMaterialization,
  WorkspaceContextRequest,
  WorkspaceFileAnnotation,
  WorkspacePendingFileAnnotation,
  WorkspaceFilePreview,
  WorkspaceGitLog,
  WorkspaceGitStatus,
  WorkspaceMutationResult,
  WorkspacePathResolution,
  WorkspaceTreeResponse,
} from './types'

export type WorkspaceSource =
  {
    kind: 'target'
    targetId: string
    label?: string
    readOnly?: boolean
  }

export function getWorkspaceSourceKey(source: WorkspaceSource): string {
  return `target:${source.targetId}`
}

function withPathQuery(basePath: string, relativePath?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  if (extra?.targetId) {
    params.set('targetId', extra.targetId)
  }
  if (relativePath) {
    params.set('path', relativePath)
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (key === 'targetId') {
        continue
      }
      params.set(key, value)
    }
  }
  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}

function targetQuery(source: WorkspaceSource): Record<string, string> {
  return { targetId: source.targetId }
}

function withTargetQuery(basePath: string, source: WorkspaceSource): string {
  return withPathQuery(basePath, undefined, targetQuery(source))
}

export interface WorkspaceOpenResponse {
  targetId: string
  label: string
  host: string
  rootPath: string
  isReadOnly: boolean
}

export async function openWorkspaceTarget(input: {
  conversationId?: string
  sessionName?: string
  commanderId?: string
  hostHint?: string | null
  pathHint?: string | null
}): Promise<WorkspaceOpenResponse> {
  return fetchJson<WorkspaceOpenResponse>('/api/workspace/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function fetchWorkspaceTree(
  source: WorkspaceSource,
  relativePath = '',
): Promise<WorkspaceTreeResponse> {
  return fetchJson<WorkspaceTreeResponse>(
    withPathQuery('/api/workspace/tree', relativePath, targetQuery(source)),
  )
}

export async function fetchWorkspaceExpandedTree(
  source: WorkspaceSource,
  relativePath: string,
): Promise<WorkspaceTreeResponse> {
  return fetchJson<WorkspaceTreeResponse>(
    withPathQuery('/api/workspace/expand', relativePath, targetQuery(source)),
  )
}

export async function fetchWorkspacePathResolution(
  source: WorkspaceSource,
  requestedPath: string,
): Promise<WorkspacePathResolution> {
  return fetchJson<WorkspacePathResolution>(
    withPathQuery('/api/workspace/resolve-path', requestedPath, targetQuery(source)),
  )
}

async function fetchWorkspaceFilePreview(
  source: WorkspaceSource,
  relativePath: string,
): Promise<WorkspaceFilePreview> {
  return fetchJson<WorkspaceFilePreview>(
    withPathQuery('/api/workspace/file', relativePath, targetQuery(source)),
  )
}

export async function materializeWorkspaceContext(
  request: WorkspaceContextRequest,
): Promise<WorkspaceContextMaterialization> {
  return fetchJson<WorkspaceContextMaterialization>('/api/workspace/context/materialize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
}

async function fetchWorkspaceGitStatus(source: WorkspaceSource): Promise<WorkspaceGitStatus> {
  return fetchJson<WorkspaceGitStatus>(
    withPathQuery('/api/workspace/git/status', undefined, targetQuery(source)),
  )
}

async function fetchWorkspaceGitLog(
  source: WorkspaceSource,
  limit = 15,
): Promise<WorkspaceGitLog> {
  return fetchJson<WorkspaceGitLog>(
    withPathQuery('/api/workspace/git/log', undefined, {
      ...targetQuery(source),
      limit: String(limit),
    }),
  )
}

async function putWorkspaceFile(
  source: WorkspaceSource,
  relativePath: string,
  content: string,
): Promise<WorkspaceMutationResult> {
  return fetchJson<WorkspaceMutationResult>(withTargetQuery('/api/workspace/file', source), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: relativePath, content }),
  })
}

async function postWorkspaceMutation(
  source: WorkspaceSource,
  suffix: string,
  body: Record<string, string>,
): Promise<WorkspaceMutationResult> {
  return fetchJson<WorkspaceMutationResult>(withTargetQuery(`/api/workspace/${suffix}`, source), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function deleteWorkspacePath(
  source: WorkspaceSource,
  relativePath: string,
): Promise<WorkspaceMutationResult> {
  return fetchJson<WorkspaceMutationResult>(
    withPathQuery('/api/workspace/path', relativePath, targetQuery(source)),
    { method: 'DELETE' },
  )
}

async function postWorkspaceGitInit(source: WorkspaceSource): Promise<{ output: string }> {
  return fetchJson<{ output: string }>(withTargetQuery('/api/workspace/git/init', source), {
    method: 'POST',
  })
}

export async function uploadWorkspaceFiles(
  source: WorkspaceSource,
  relativePath: string,
  files: FileList | File[],
): Promise<{ uploaded: string[]; path: string }> {
  const formData = new FormData()
  Array.from(files).forEach((file) => formData.append('files', file))
  return fetchJson<{ uploaded: string[]; path: string }>(
    withPathQuery('/api/workspace/upload', relativePath, targetQuery(source)),
    {
      method: 'POST',
      body: formData,
    },
  )
}

export function useWorkspaceFilePreview(
  source: WorkspaceSource,
  relativePath: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['workspace', getWorkspaceSourceKey(source), 'file', relativePath ?? 'none'],
    queryFn: () => fetchWorkspaceFilePreview(source, relativePath!),
    enabled: enabled && Boolean(relativePath),
  })
}

export function useWorkspaceGitStatus(source: WorkspaceSource, enabled = true) {
  return useQuery({
    queryKey: ['workspace', getWorkspaceSourceKey(source), 'git', 'status'],
    queryFn: () => fetchWorkspaceGitStatus(source),
    enabled,
  })
}

export function useWorkspaceGitLog(source: WorkspaceSource, enabled = true, limit = 15) {
  return useQuery({
    queryKey: ['workspace', getWorkspaceSourceKey(source), 'git', 'log', limit],
    queryFn: () => fetchWorkspaceGitLog(source, limit),
    enabled,
  })
}

export function useWorkspaceActions(source: WorkspaceSource) {
  const queryClient = useQueryClient()
  const sourceKey = getWorkspaceSourceKey(source)

  async function invalidateAll(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['workspace', sourceKey] })
  }

  return {
    invalidateAll,
    saveFile: async (relativePath: string, content: string) => {
      const result = await putWorkspaceFile(source, relativePath, content)
      await invalidateAll()
      return result
    },
    createFile: async (relativePath: string) => {
      const result = await postWorkspaceMutation(source, 'new-file', { path: relativePath })
      await invalidateAll()
      return result
    },
    createFolder: async (relativePath: string) => {
      const result = await postWorkspaceMutation(source, 'new-folder', { path: relativePath })
      await invalidateAll()
      return result
    },
    renamePath: async (fromPath: string, toPath: string) => {
      const result = await postWorkspaceMutation(source, 'rename', { fromPath, toPath })
      await invalidateAll()
      return result
    },
    deletePath: async (relativePath: string) => {
      const result = await deleteWorkspacePath(source, relativePath)
      await invalidateAll()
      return result
    },
    initGit: async () => {
      const result = await postWorkspaceGitInit(source)
      await invalidateAll()
      return result
    },
    uploadFiles: async (relativePath: string, files: FileList | File[]) => {
      const result = await uploadWorkspaceFiles(source, relativePath, files)
      await invalidateAll()
      return result
    },
  }
}

export type {
  WorkspaceContextMaterialization,
  WorkspaceContextRequest,
  WorkspaceFileAnnotation,
  WorkspacePendingFileAnnotation,
}
