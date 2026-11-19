import { promises as nodeFs } from 'node:fs'
import { join } from 'node:path'

export interface EndpointInfo { port: number; token: string; pid: number }
export interface EndpointFs {
  mkdir(p: string, o: { recursive: true }): Promise<unknown>
  writeFile(p: string, d: string, o: { mode: number }): Promise<void>
  rename(a: string, b: string): Promise<void>
  rm(p: string, o?: { force?: boolean }): Promise<void>
}

export function createEndpointFile(dir: string, fsImpl: EndpointFs = nodeFs as unknown as EndpointFs): { path: string; write(info: EndpointInfo): Promise<void>; remove(): Promise<void> } {
  const path = join(dir, 'endpoint.json')
  const tmp = join(dir, `endpoint.json.${process.pid}.tmp`)
  return {
    path,
    async write(info) {
      await fsImpl.mkdir(dir, { recursive: true })
      await fsImpl.writeFile(tmp, JSON.stringify({ port: info.port, token: info.token, pid: info.pid }), { mode: 0o600 })
      await fsImpl.rename(tmp, path)
    },
    async remove() {
      try {
        await fsImpl.rm(path, { force: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
  }
}
