import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HookEvent } from '../../shared/types'

export const TOKEN_HEADER = 'x-agent-console-token'
export const MAX_BODY = 1024 * 1024

export interface HookServerDeps {
  parse: (body: unknown, receivedMs: number) => HookEvent | null
  onEvent: (e: HookEvent) => void
  endpoint: { write(info: { port: number; token: string; pid: number }): Promise<void>; remove(): Promise<void> }
  token?: () => string
  nowMs?: () => number
  pid?: number
}

export function createHookServer(deps: HookServerDeps): {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
  info(): { listening: boolean; port?: number }
  stats(): { received: number; rejected: number; lastEventMs?: number }
} {
  const now = deps.nowMs ?? Date.now
  let server: http.Server | null = null
  let port: number | undefined
  let token = ''
  const st: { received: number; rejected: number; lastEventMs?: number } = { received: 0, rejected: 0 }

  const reject = (res: http.ServerResponse, code: number): void => {
    st.rejected++
    res.statusCode = code
    res.setHeader('connection', 'close')
    res.end()
  }

  function tokenOk(h: string | string[] | undefined): boolean {
    if (typeof h !== 'string') return false
    const a = Buffer.from(h)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = (req.url ?? '').split('?')[0]
    if (url !== '/hook') return reject(res, 404)
    if (req.method !== 'POST') return reject(res, 405)
    if (req.headers.host !== `127.0.0.1:${port}`) return reject(res, 403)
    if (!tokenOk(req.headers[TOKEN_HEADER])) return reject(res, 401)
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      if (over) return
      size += c.length
      if (size > MAX_BODY) {
        over = true
        reject(res, 413)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('error', () => {})
    req.on('end', () => {
      if (over) return
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reject(res, 400)
      }
      const ms = now()
      let ev: HookEvent | null = null
      try {
        ev = deps.parse(body, ms)
      } catch {
        ev = null
      }
      if (!ev) return reject(res, 400)
      st.received++
      st.lastEventMs = ms
      res.statusCode = 204
      res.end()
      try {
        deps.onEvent(ev)
      } catch {
        // a failing consumer must never affect the hook sender
      }
    })
  }

  return {
    async start() {
      if (server) return { port: port! }
      token = (deps.token ?? (() => randomBytes(32).toString('hex')))()
      const s = http.createServer(handle)
      s.on('clientError', (_e, sock) => sock.destroy())
      await new Promise<void>((resolve, rej) => {
        s.once('error', rej)
        s.listen(0, '127.0.0.1', () => resolve())
      })
      port = (s.address() as AddressInfo).port
      server = s
      try {
        await deps.endpoint.write({ port, token, pid: deps.pid ?? process.pid })
      } catch (e) {
        server = null
        port = undefined
        await new Promise<void>((r) => s.close(() => r()))
        throw e
      }
      return { port }
    },
    async stop() {
      const s = server
      server = null
      port = undefined
      if (s) {
        s.closeAllConnections?.()
        await new Promise<void>((r) => s.close(() => r()))
      }
      await deps.endpoint.remove().catch(() => {})
    },
    info: () => (server ? { listening: true, port } : { listening: false }),
    stats: () => ({ ...st })
  }
}
