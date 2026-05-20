import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  createWebSocketUpgradeResolver,
  WebSocketUpgradeResolverError,
  type WebSocketUpgradeRoute,
} from '../websocket-upgrade-resolver'

function request(url: string, headers: IncomingHttpHeaders = { host: 'localhost' }): IncomingMessage {
  return {
    url,
    headers,
  } as IncomingMessage
}

function route(id: string, path: string): WebSocketUpgradeRoute {
  return {
    declaration: {
      id,
      path,
      match: 'exact',
      auth: 'api-key-or-auth0',
      ownerModuleId: id.split('.')[0] ?? 'test',
    },
    handleUpgrade: vi.fn(),
  }
}

describe('createWebSocketUpgradeResolver', () => {
  it('matches exact manifest path templates without prefix fallthrough', () => {
    const agents = route('agents.session-stream', '/api/agents/sessions/:name/ws')
    const approvals = route('approvals.pending-stream', '/api/approvals/stream')
    const audit = route('audit.logs', '/api/audit/:name/logs')
    const realtime = route('realtime.transcription', '/api/realtime/transcription')
    const resolve = createWebSocketUpgradeResolver([agents, approvals, audit, realtime])

    expect(resolve(request('/api/agents/sessions/demo/ws?api_key=test'))?.route.declaration.id).toBe(
      'agents.session-stream',
    )
    expect(resolve(request('/api/approvals/stream'))?.route.declaration.id).toBe('approvals.pending-stream')
    expect(resolve(request('/api/audit/hammurabi/logs'))?.route.declaration.id).toBe('audit.logs')
    expect(resolve(request('/api/realtime/transcription'))?.route.declaration.id).toBe('realtime.transcription')
    expect(resolve(request('/api/agents/sessions/demo/ws/extra'))).toBeNull()
    expect(resolve(request('/api/audit/hammurabi/logs/tail'))).toBeNull()
  })

  it('does not trust or throw on malformed upgrade request URL inputs', () => {
    const agents = route('agents.session-stream', '/api/agents/sessions/:name/ws')
    const resolve = createWebSocketUpgradeResolver([agents])

    expect(resolve(request('/api/agents/sessions/demo/ws', { host: '%%%' }))?.route.declaration.id).toBe(
      'agents.session-stream',
    )
    expect(resolve(request('http://%'))).toBeNull()
  })

  it('rejects duplicate, ambiguous, and overly broad websocket declarations', () => {
    expect(() => createWebSocketUpgradeResolver([
      route('one.ws', '/api/agents/:id/ws'),
      route('two.ws', '/api/agents/:name/ws'),
    ])).toThrow(/Ambiguous websocket path/)

    expect(() => createWebSocketUpgradeResolver([
      route('one.ws', '/api/agents/:id/ws'),
      route('one.ws', '/api/agents/:id/logs'),
    ])).toThrow(/Duplicate websocket id/)

    expect(() => createWebSocketUpgradeResolver([
      route('api.ws', '/api'),
    ])).toThrow(/too broad/)

    expect(() => createWebSocketUpgradeResolver([
      {
        ...route('legacy.ws', '/api/legacy/ws'),
        declaration: {
          ...route('legacy.ws', '/api/legacy/ws').declaration,
          match: 'prefix',
        },
      },
    ])).toThrow(WebSocketUpgradeResolverError)
  })
})
