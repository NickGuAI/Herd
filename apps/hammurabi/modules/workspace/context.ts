import {
  resolveWorkspacePath,
  WorkspaceError,
} from './resolver.js'
import { listWorkspaceTree } from './tree.js'
import type { WorkspaceResolverCapability } from './capability.js'
import type {
  WorkspaceContextMaterialization,
  WorkspaceContextPayload,
  WorkspaceContextSkippedFile,
  WorkspaceFileAnnotation,
  WorkspaceTreeNode,
} from './types.js'

interface MaterializedDirectoryContext {
  path: string
  entries: WorkspaceTreeNode[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const strings: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue
    }
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    strings.push(trimmed)
  }
  return strings
}

function normalizeAnnotationRange(value: unknown): WorkspaceFileAnnotation['range'] {
  if (!isRecord(value)) {
    return null
  }
  const startLine = typeof value.startLine === 'number' && Number.isFinite(value.startLine)
    ? Math.max(1, Math.floor(value.startLine))
    : null
  const endLine = typeof value.endLine === 'number' && Number.isFinite(value.endLine)
    ? Math.max(startLine ?? 1, Math.floor(value.endLine))
    : null
  return startLine || endLine ? { startLine, endLine } : null
}

export function normalizeWorkspaceFileAnnotations(value: unknown): WorkspaceFileAnnotation[] {
  if (!Array.isArray(value)) {
    return []
  }
  const annotations: WorkspaceFileAnnotation[] = []
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue
    }
    const annotationPath = typeof entry.path === 'string' ? entry.path.trim() : ''
    const annotationBody = typeof entry.body === 'string' ? entry.body.trim() : ''
    if (!annotationPath || !annotationBody) {
      continue
    }
    const quote = typeof entry.quote === 'string' && entry.quote.trim()
      ? entry.quote.trim()
      : null
    annotations.push({
      path: annotationPath,
      body: annotationBody,
      quote,
      range: normalizeAnnotationRange(entry.range),
    })
  }
  return annotations
}

export function readWorkspaceContextPayload(value: unknown): WorkspaceContextPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const targetId = typeof value.targetId === 'string' && value.targetId.trim()
    ? value.targetId.trim()
    : null
  const conversationId = typeof value.conversationId === 'string' && value.conversationId.trim()
    ? value.conversationId.trim()
    : null
  const filePaths = normalizeStringArray(value.filePaths)
  const directoryPaths = normalizeStringArray(value.directoryPaths)
  const fileAnnotations = normalizeWorkspaceFileAnnotations(value.fileAnnotations)

  if (
    !targetId
    && !conversationId
    && filePaths.length === 0
    && directoryPaths.length === 0
    && fileAnnotations.length === 0
  ) {
    return null
  }

  return {
    ...(targetId ? { targetId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(filePaths.length > 0 ? { filePaths } : {}),
    ...(directoryPaths.length > 0 ? { directoryPaths } : {}),
    ...(fileAnnotations.length > 0 ? { fileAnnotations } : {}),
  }
}

export function hasWorkspaceContextPayload(value: WorkspaceContextPayload | null | undefined): boolean {
  return Boolean(value?.filePaths?.length || value?.directoryPaths?.length || value?.fileAnnotations?.length)
}

export function formatWorkspaceContextText(input: {
  filePaths: string[]
  directoryContexts?: MaterializedDirectoryContext[]
  directoryPaths?: string[]
  fileAnnotations: WorkspaceFileAnnotation[]
}): string {
  const lines: string[] = []
  if (input.filePaths.length > 0) {
    lines.push('<workspace-files>')
    for (const filePath of input.filePaths) {
      lines.push(`@${filePath}`)
    }
    lines.push('</workspace-files>')
  }
  const directoryContexts = input.directoryContexts
    ?? input.directoryPaths?.map((directoryPath) => ({ path: directoryPath, entries: [] }))
    ?? []
  if (directoryContexts.length > 0) {
    lines.push('<workspace-directories>')
    for (const directoryContext of directoryContexts) {
      const directoryPath = directoryContext.path.endsWith('/')
        ? directoryContext.path
        : `${directoryContext.path}/`
      lines.push(`@${directoryPath}`)
      for (const entry of directoryContext.entries) {
        const entryName = entry.type === 'directory' ? `${entry.name}/` : entry.name
        const sizeLabel = typeof entry.size === 'number' ? ` (${entry.size} bytes)` : ''
        lines.push(`- ${entryName} [${entry.type}]${sizeLabel}`)
      }
    }
    lines.push('</workspace-directories>')
  }
  if (input.fileAnnotations.length > 0) {
    lines.push('<workspace-file-annotations>')
    for (const annotation of input.fileAnnotations) {
      lines.push(`- file: ${annotation.path}`)
      if (annotation.range?.startLine || annotation.range?.endLine) {
        const startLine = annotation.range.startLine ?? annotation.range.endLine
        const endLine = annotation.range.endLine ?? annotation.range.startLine
        lines.push(`  range: ${startLine}-${endLine}`)
      }
      if (annotation.quote) {
        lines.push(`  quote: ${annotation.quote}`)
      }
      lines.push('  annotation: |-')
      for (const line of annotation.body.split(/\r?\n/u)) {
        lines.push(`    ${line}`)
      }
    }
    lines.push('</workspace-file-annotations>')
  }
  return lines.join('\n').trim()
}

export async function materializeWorkspaceContextPayload(input: {
  resolver?: WorkspaceResolverCapability
  context?: WorkspaceContextPayload | null
}): Promise<WorkspaceContextMaterialization> {
  const context = input.context ?? null
  const requestedFilePaths = normalizeStringArray(context?.filePaths)
  const requestedDirectoryPaths = normalizeStringArray(context?.directoryPaths)
  const requestedFileAnnotations = normalizeWorkspaceFileAnnotations(context?.fileAnnotations)

  if (
    requestedFilePaths.length === 0
    && requestedDirectoryPaths.length === 0
    && requestedFileAnnotations.length === 0
  ) {
    return {
      text: '',
      filePaths: [],
      directoryPaths: [],
      fileAnnotations: [],
      skippedFilePaths: [],
      skippedDirectoryPaths: [],
    }
  }

  const targetId = typeof context?.targetId === 'string' ? context.targetId.trim() : ''
  if (!targetId) {
    return {
      text: formatWorkspaceContextText({
        filePaths: requestedFilePaths,
        directoryPaths: requestedDirectoryPaths,
        fileAnnotations: requestedFileAnnotations,
      }),
      filePaths: requestedFilePaths,
      directoryPaths: requestedDirectoryPaths,
      fileAnnotations: requestedFileAnnotations,
      skippedFilePaths: [],
      skippedDirectoryPaths: [],
    }
  }

  if (!input.resolver) {
    throw new WorkspaceError(503, 'Workspace context resolution is unavailable')
  }

  const resolved = await input.resolver.resolveTarget(targetId)
  const filePaths: string[] = []
  const skippedFilePaths: WorkspaceContextSkippedFile[] = []
  const directoryContexts: MaterializedDirectoryContext[] = []
  const skippedDirectoryPaths: WorkspaceContextSkippedFile[] = []

  for (const filePath of requestedFilePaths) {
    let relativePath: string
    try {
      const resolvedPath = await resolveWorkspacePath(
        resolved.workspace,
        filePath,
        { expectFile: true },
        resolved.commandRunner,
      )
      relativePath = resolvedPath.relativePath
    } catch (error) {
      if (error instanceof WorkspaceError && error.statusCode === 404) {
        skippedFilePaths.push({
          path: filePath,
          reason: 'not_found',
          error: error.message,
        })
        continue
      }
      throw error
    }
    if (!filePaths.includes(relativePath)) {
      filePaths.push(relativePath)
    }
  }

  for (const directoryPath of requestedDirectoryPaths) {
    try {
      const resolvedPath = await resolveWorkspacePath(
        resolved.workspace,
        directoryPath,
        { expectDirectory: true },
        resolved.commandRunner,
      )
      const relativePath = resolvedPath.relativePath
      if (directoryContexts.some((entry) => entry.path === relativePath)) {
        continue
      }
      const tree = await listWorkspaceTree(
        resolved.workspace,
        relativePath,
        resolved.commandRunner,
      )
      directoryContexts.push({
        path: relativePath,
        entries: tree.nodes,
      })
    } catch (error) {
      if (error instanceof WorkspaceError && error.statusCode === 404) {
        skippedDirectoryPaths.push({
          path: directoryPath,
          reason: 'not_found',
          error: error.message,
        })
        continue
      }
      throw error
    }
  }

  const fileAnnotations: WorkspaceFileAnnotation[] = []
  for (const annotation of requestedFileAnnotations) {
    let relativePath: string
    try {
      const resolvedPath = await resolveWorkspacePath(
        resolved.workspace,
        annotation.path,
        { expectFile: true },
        resolved.commandRunner,
      )
      relativePath = resolvedPath.relativePath
    } catch (error) {
      if (error instanceof WorkspaceError && error.statusCode === 404) {
        skippedFilePaths.push({
          path: annotation.path,
          reason: 'not_found',
          error: error.message,
        })
        continue
      }
      throw error
    }
    fileAnnotations.push({
      ...annotation,
      path: relativePath,
    })
  }

  return {
    text: formatWorkspaceContextText({ filePaths, directoryContexts, fileAnnotations }),
    filePaths,
    directoryPaths: directoryContexts.map((directoryContext) => directoryContext.path),
    fileAnnotations,
    skippedFilePaths,
    skippedDirectoryPaths,
  }
}

export async function applyWorkspaceContextToText(input: {
  text: string
  resolver?: WorkspaceResolverCapability
  context?: WorkspaceContextPayload | null
}): Promise<string> {
  const materialized = await materializeWorkspaceContextPayload({
    resolver: input.resolver,
    context: input.context,
  })
  return `${materialized.text}\n${input.text.trim()}`.trim()
}
