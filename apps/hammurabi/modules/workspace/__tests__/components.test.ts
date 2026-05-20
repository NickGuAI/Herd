import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceGitPanel } from '../components/WorkspaceGitPanel'
import { buildWorkspaceRawUrl } from '../components/WorkspaceFilePreview'
import { WorkspaceTree } from '../components/WorkspaceTree'

const workspace = {
  source: {
    kind: 'target' as const,
    id: 'session-1',
    label: 'session-1',
  },
  rootPath: '/tmp/workspace',
  rootName: 'workspace',
  gitRoot: null,
  readOnly: true,
  isRemote: false,
}

describe('workspace components', () => {
  it('renders an empty workspace tree state', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceTree, {
        nodesByParent: { '': [] },
        expandedPaths: new Set<string>(),
        loadingPaths: new Set<string>(),
        selectedPath: null,
        onSelectPath: () => undefined,
        onToggleDirectory: () => undefined,
      }),
    )

    expect(html).toContain('Workspace is empty')
  })

  it('renders the non-git empty state', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceGitPanel, {
        status: {
          workspace,
          enabled: false,
          branch: null,
          ahead: 0,
          behind: 0,
          entries: [],
        },
        log: {
          workspace,
          enabled: false,
          commits: [],
        },
      }),
    )

    expect(html).toContain('Git is not initialized for this workspace')
  })

  it('builds a tokenized raw URL for target workspaces', () => {
    expect(
      buildWorkspaceRawUrl({
        kind: 'target',
        id: 'wt-1',
        label: 'local:/tmp/workspace',
      }, 'docs/report.pdf', 'token-123'),
    ).toBe(
      '/api/workspace/raw?path=docs%2Freport.pdf&access_token=token-123&targetId=wt-1',
    )
  })

  it('omits the raw token query parameter when no token is available', () => {
    expect(
      buildWorkspaceRawUrl({
        kind: 'target',
        id: 'wt-1',
        label: 'local:/tmp/workspace',
      }, 'docs/report.pdf'),
    ).toBe(
      '/api/workspace/raw?path=docs%2Freport.pdf&targetId=wt-1',
    )
  })

})
