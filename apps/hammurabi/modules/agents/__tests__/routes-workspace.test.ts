import express from 'express'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiKeyStoreLike } from '../../../server/api-keys/store'
import { createWorkspaceRouter } from '../../workspace/routes'
import { resolveWorkspaceRoot } from '../../workspace/resolver'
import type { WorkspaceResolverCapability } from '../../workspace/capability'

const AUTH_HEADERS = { 'x-hammurabi-api-key': 'test-key' }

function createTestApiKeyStore(): ApiKeyStoreLike {
  return {
    hasAnyKeys: async () => true,
    verifyKey: async (rawKey, options) => {
      if (rawKey !== 'test-key') {
        return { ok: false, reason: 'not_found' as const }
      }
      const scopes = ['agents:read', 'agents:write']
      const required = options?.requiredScopes ?? []
      return required.every((scope) => scopes.includes(scope))
        ? {
            ok: true,
            record: {
              id: 'test',
              name: 'Test',
              keyHash: 'hash',
              prefix: 'hmrb_test',
              createdBy: 'test',
              createdAt: new Date(0).toISOString(),
              lastUsedAt: null,
              scopes,
            },
          }
        : { ok: false, reason: 'insufficient_scope' as const }
    },
  }
}

async function startWorkspaceServer(
  resolver: WorkspaceResolverCapability,
): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const app = express()
  app.use(express.json())
  app.use('/api/workspace', createWorkspaceRouter({
    apiKeyStore: createTestApiKeyStore(),
    resolver,
  }))
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind to a TCP port')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

describe('workspace routes', () => {
  let server: Awaited<ReturnType<typeof startWorkspaceServer>> | null = null
  let workspaceDir: string | null = null

  afterEach(async () => {
    await server?.close()
    server = null
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true })
      workspaceDir = null
    }
  })

  it('serves unified targetId-only tree, file, raw, and git routes', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-route-'))
    await mkdir(join(workspaceDir, 'docs', 'diagrams'), { recursive: true })
    await writeFile(join(workspaceDir, 'README.md'), 'Unified workspace\n', 'utf8')
    await writeFile(join(workspaceDir, 'docs', 'diagrams', 'flow.svg'), '<svg />\n', 'utf8')
    await writeFile(join(workspaceDir, 'docs', 'diagrams', 'flow.dot'), 'digraph Flow {}\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => {
        expect(targetId).toBe('wt-test')
        return {
          target: {
            targetId,
            label: 'local',
            host: 'local',
            rootPath: workspaceDir!,
            readOnly: false,
          },
          workspace,
          host: 'local',
          rootPath: workspace.rootPath,
          readOnly: false,
        }
      },
    }
    server = await startWorkspaceServer(resolver)

    const openResponse = await fetch(`${server.baseUrl}/api/workspace/open`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-1' }),
    })
    expect(openResponse.status).toBe(200)
    await expect(openResponse.json()).resolves.toMatchObject({ targetId: 'wt-test' })

    const treeResponse = await fetch(
      `${server.baseUrl}/api/workspace/tree?targetId=wt-test`,
      { headers: AUTH_HEADERS },
    )
    expect(treeResponse.status).toBe(200)
    await expect(treeResponse.json()).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: 'docs', type: 'directory' }),
        expect.objectContaining({ name: 'README.md', type: 'file' }),
      ]),
    })

    const fileResponse = await fetch(
      `${server.baseUrl}/api/workspace/file?targetId=wt-test&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(fileResponse.status).toBe(200)
    await expect(fileResponse.json()).resolves.toMatchObject({
      kind: 'text',
      content: expect.stringContaining('Unified workspace'),
    })

    const rawResponse = await fetch(
      `${server.baseUrl}/api/workspace/raw?targetId=wt-test&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(rawResponse.status).toBe(200)
    expect(await rawResponse.text()).toBe('Unified workspace\n')

    const gitStatusResponse = await fetch(
      `${server.baseUrl}/api/workspace/git/status?targetId=wt-test`,
      { headers: AUTH_HEADERS },
    )
    expect(gitStatusResponse.status).toBe(200)
    await expect(gitStatusResponse.json()).resolves.toMatchObject({ enabled: false })

    const resolvedPathResponse = await fetch(
      `${server.baseUrl}/api/workspace/resolve-path?targetId=wt-test&path=${
        encodeURIComponent(join(workspaceDir, 'docs', 'diagrams', 'flow.svg'))
      }`,
      { headers: AUTH_HEADERS },
    )
    expect(resolvedPathResponse.status).toBe(200)
    await expect(resolvedPathResponse.json()).resolves.toMatchObject({
      path: 'docs/diagrams/flow.svg',
      type: 'file',
      treePath: 'docs/diagrams',
    })

    const badLegacyExpandPath = join(workspaceDir, 'docs', 'diagrams').replace(/^\//u, '')
    const legacyExpandResponse = await fetch(
      `${server.baseUrl}/api/workspace/expand?targetId=wt-test&path=${encodeURIComponent(badLegacyExpandPath)}`,
      { headers: AUTH_HEADERS },
    )
    expect(legacyExpandResponse.status).toBe(200)
    await expect(legacyExpandResponse.json()).resolves.toMatchObject({
      parentPath: 'docs/diagrams',
      nodes: expect.arrayContaining([
        expect.objectContaining({ name: 'flow.dot', type: 'file' }),
        expect.objectContaining({ name: 'flow.svg', type: 'file' }),
      ]),
    })

    const saveResponse = await fetch(`${server.baseUrl}/api/workspace/file?targetId=wt-test`, {
      method: 'PUT',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'README.md', content: 'Saved through target\n' }),
    })
    expect(saveResponse.status).toBe(200)
    await expect(saveResponse.json()).resolves.toMatchObject({ path: 'README.md' })
    await expect(readFile(join(workspaceDir, 'README.md'), 'utf8')).resolves.toBe('Saved through target\n')
  })

  it('rejects raw host/rootPath reads', async () => {
    const resolver = {
      open: async () => {
        throw new Error('not used')
      },
      resolveTarget: async () => {
        throw new Error('targetId should be rejected before resolution')
      },
    } satisfies WorkspaceResolverCapability
    server = await startWorkspaceServer(resolver)

    const response = await fetch(
      `${server.baseUrl}/api/workspace/tree?host=local&rootPath=/tmp`,
      { headers: AUTH_HEADERS },
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('targetId'),
    })
  })

  it('materializes ad hoc file annotations without persisting file comments', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-annotations-'))
    await writeFile(join(workspaceDir, 'README.md'), '# Context file\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => ({
        target: {
          targetId,
          conversationId: 'conv-1',
          label: 'local',
          host: 'local',
          rootPath: workspaceDir!,
          readOnly: false,
        },
        workspace,
        host: 'local',
        rootPath: workspace.rootPath,
        readOnly: false,
      }),
    }
    server = await startWorkspaceServer(resolver)

    const createResponse = await fetch(`${server.baseUrl}/api/workspace/file-comments`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        path: 'README.md',
        body: 'Please revise the heading.',
      }),
    })
    expect(createResponse.status).toBe(404)

    const listResponse = await fetch(
      `${server.baseUrl}/api/workspace/file-comments?targetId=wt-test&conversationId=conv-1&path=README.md`,
      { headers: AUTH_HEADERS },
    )
    expect(listResponse.status).toBe(404)

    const materializeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['README.md'],
        fileAnnotations: [{
          path: 'README.md',
          body: 'Please revise the heading.',
          quote: '# Context file',
          range: { startLine: 1, endLine: 1 },
        }],
      }),
    })
    expect(materializeResponse.status).toBe(200)
    await expect(materializeResponse.json()).resolves.toMatchObject({
      filePaths: ['README.md'],
      fileAnnotations: [{
        path: 'README.md',
        body: 'Please revise the heading.',
        quote: '# Context file',
        range: { startLine: 1, endLine: 1 },
      }],
      text: expect.stringContaining('Please revise the heading.'),
    })
    await expect(readFile(join(workspaceDir, 'file-comments.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const escapeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['../secret.md'],
      }),
    })
    expect(escapeResponse.status).toBe(400)
  })

  it('skips stale selected file paths when materializing workspace context', async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'hammurabi-workspace-stale-context-'))
    await writeFile(join(workspaceDir, 'README.md'), '# Current file\n', 'utf8')
    const workspace = await resolveWorkspaceRoot({
      rootPath: workspaceDir,
      source: {
        kind: 'target',
        id: 'wt-test',
        label: 'local',
      },
    })
    const resolver: WorkspaceResolverCapability = {
      open: async () => ({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        label: 'local',
        host: 'local',
        rootPath: workspaceDir!,
        readOnly: false,
      }),
      resolveTarget: async (targetId) => ({
        target: {
          targetId,
          conversationId: 'conv-1',
          label: 'local',
          host: 'local',
          rootPath: workspaceDir!,
          readOnly: false,
        },
        workspace,
        host: 'local',
        rootPath: workspace.rootPath,
        readOnly: false,
      }),
    }
    server = await startWorkspaceServer(resolver)

    const materializeResponse = await fetch(`${server.baseUrl}/api/workspace/context/materialize`, {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        targetId: 'wt-test',
        conversationId: 'conv-1',
        filePaths: ['README.md', 'deleted.md'],
        fileAnnotations: [
          {
            path: 'deleted-note.md',
            body: 'This stale annotation should be skipped.',
          },
        ],
      }),
    })

    expect(materializeResponse.status).toBe(200)
    await expect(materializeResponse.json()).resolves.toMatchObject({
      filePaths: ['README.md'],
      directoryPaths: [],
      fileAnnotations: [],
      skippedFilePaths: [
        {
          path: 'deleted.md',
          reason: 'not_found',
          error: 'Workspace path not found',
        },
        {
          path: 'deleted-note.md',
          reason: 'not_found',
          error: 'Workspace path not found',
        },
      ],
      text: expect.stringContaining('@README.md'),
    })
  })
})
