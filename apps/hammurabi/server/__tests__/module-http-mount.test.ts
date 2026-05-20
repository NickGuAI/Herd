import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { mountDeclaredBodyParsers } from '../module-http-mount'

const servers: Array<{ close: () => Promise<void> }> = []

async function startApp() {
  const app = express()
  mountDeclaredBodyParsers(app, [
    {
      id: 'test.large-json',
      kind: 'json',
      mount: '/declared',
      ownerModuleId: 'test',
      limit: '1kb',
    },
    {
      id: 'test.multipart',
      kind: 'multipart-memory',
      mount: '/upload',
      ownerModuleId: 'test',
    },
  ])
  app.use(express.json())
  app.post('/declared', (req, res) => {
    res.json({ ok: true, bytes: JSON.stringify(req.body).length })
  })
  app.post('/global', (req, res) => {
    res.json({ ok: true, body: req.body })
  })
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (
      typeof error === 'object'
      && error !== null
      && 'type' in error
      && error.type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'too large' })
      return
    }

    next(error)
  })

  const server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve test server address')
  }
  const running = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  }
  servers.push(running)
  return running
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('mountDeclaredBodyParsers', () => {
  it('mounts manifest-declared JSON parsers before the global parser', async () => {
    const server = await startApp()

    const declaredResponse = await fetch(`${server.baseUrl}/declared`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(900) }),
    })
    expect(declaredResponse.status).toBe(200)

    const tooLargeResponse = await fetch(`${server.baseUrl}/declared`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(2_000) }),
    })
    expect(tooLargeResponse.status).toBe(413)

    const globalResponse = await fetch(`${server.baseUrl}/global`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    })
    expect(globalResponse.status).toBe(200)
    await expect(globalResponse.json()).resolves.toEqual({ ok: true, body: { ok: true } })
  })
})
