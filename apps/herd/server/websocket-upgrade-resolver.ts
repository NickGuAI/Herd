import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { HerdWebSocketDeclaration } from '../src/types/module-manifest.js'

export type WebSocketUpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

export interface WebSocketUpgradeRoute {
  declaration: HerdWebSocketDeclaration
  handleUpgrade: WebSocketUpgradeHandler
}

export interface ResolvedWebSocketUpgrade {
  route: WebSocketUpgradeRoute
  params: Readonly<Record<string, string>>
}

interface CompiledWebSocketUpgradeRoute extends WebSocketUpgradeRoute {
  staticSegmentCount: number
  segmentCount: number
  regex: RegExp
  paramNames: readonly string[]
}

export class WebSocketUpgradeResolverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebSocketUpgradeResolverError'
  }
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function requestPathname(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return null
  }
}

function compilePathTemplate(pathTemplate: string): {
  regex: RegExp
  paramNames: readonly string[]
  staticSegmentCount: number
  segmentCount: number
  normalizedShape: string
} {
  if (!pathTemplate.startsWith('/')) {
    throw new WebSocketUpgradeResolverError(`WebSocket path "${pathTemplate}" must start with "/"`)
  }

  const segments = pathSegments(pathTemplate)
  if (segments.length < 3) {
    throw new WebSocketUpgradeResolverError(`WebSocket path "${pathTemplate}" is too broad`)
  }

  const paramNames: string[] = []
  const regexSegments = segments.map((segment) => {
    if (segment.startsWith(':')) {
      const paramName = segment.slice(1)
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(paramName)) {
        throw new WebSocketUpgradeResolverError(`Invalid websocket path parameter "${segment}"`)
      }
      paramNames.push(paramName)
      return '([^/]+)'
    }
    return escapeRegex(segment)
  })
  const normalizedSegments = segments.map((segment) => (segment.startsWith(':') ? ':' : segment))

  return {
    regex: new RegExp(`^/${regexSegments.join('/')}$`),
    paramNames,
    staticSegmentCount: segments.filter((segment) => !segment.startsWith(':')).length,
    segmentCount: segments.length,
    normalizedShape: `/${normalizedSegments.join('/')}`,
  }
}

export function createWebSocketUpgradeResolver(
  routes: readonly WebSocketUpgradeRoute[],
): (req: IncomingMessage) => ResolvedWebSocketUpgrade | null {
  const seenIds = new Set<string>()
  const seenShapes = new Map<string, string>()
  const compiled = routes.map((route): CompiledWebSocketUpgradeRoute => {
    if (route.declaration.match !== 'exact') {
      throw new WebSocketUpgradeResolverError(
        `WebSocket "${route.declaration.id}" must use exact template matching`,
      )
    }
    if (seenIds.has(route.declaration.id)) {
      throw new WebSocketUpgradeResolverError(`Duplicate websocket id "${route.declaration.id}"`)
    }
    seenIds.add(route.declaration.id)

    const path = compilePathTemplate(route.declaration.path)
    const existingShapeOwner = seenShapes.get(path.normalizedShape)
    if (existingShapeOwner) {
      throw new WebSocketUpgradeResolverError(
        `Ambiguous websocket path "${route.declaration.path}" conflicts with "${existingShapeOwner}"`,
      )
    }
    seenShapes.set(path.normalizedShape, route.declaration.id)

    return {
      ...route,
      regex: path.regex,
      paramNames: path.paramNames,
      staticSegmentCount: path.staticSegmentCount,
      segmentCount: path.segmentCount,
    }
  }).sort((left, right) => (
    right.staticSegmentCount - left.staticSegmentCount
    || right.segmentCount - left.segmentCount
    || left.declaration.id.localeCompare(right.declaration.id)
  ))

  return (req) => {
    const pathname = requestPathname(req)
    if (!pathname) {
      return null
    }

    for (const route of compiled) {
      const match = route.regex.exec(pathname)
      if (!match) {
        continue
      }

      return {
        route,
        params: Object.fromEntries(route.paramNames.map((name, index) => [
          name,
          match[index + 1] ?? '',
        ])),
      }
    }

    return null
  }
}
