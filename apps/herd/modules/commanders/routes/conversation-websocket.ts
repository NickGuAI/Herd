import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { buildConversationSessionName } from './conversation-runtime.js'
import type { CommanderRoutesContext } from './types.js'

export type WebSocketUpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

const CONVERSATION_WS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function writeAndDestroy(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`)
  socket.destroy()
}

function extractConversationIdFromUrl(url: URL): string | null {
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/ws$/)
  if (!match) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(match[1])
  } catch {
    return null
  }

  return CONVERSATION_WS_ID_PATTERN.test(decoded) ? decoded : null
}

export function createConversationWebSocket(
  context: CommanderRoutesContext,
  delegateToAgentSession: WebSocketUpgradeHandler,
): WebSocketUpgradeHandler {
  return (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
    const conversationId = extractConversationIdFromUrl(url)
    if (!conversationId) {
      writeAndDestroy(socket, '400 Bad Request')
      return
    }

    void context.conversationStore.get(conversationId)
      .then((conversation) => {
        if (!conversation) {
          writeAndDestroy(socket, '404 Not Found')
          return
        }

        const sessionName = buildConversationSessionName(conversation)
        if (!context.sessionsInterface?.getSession(sessionName)) {
          writeAndDestroy(socket, '404 Not Found')
          return
        }

        req.url = `/api/agents/sessions/${encodeURIComponent(sessionName)}/ws${url.search}`
        delegateToAgentSession(req, socket, head)
      })
      .catch(() => {
        writeAndDestroy(socket, '500 Internal Server Error')
      })
  }
}
