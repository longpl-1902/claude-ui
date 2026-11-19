import { join } from 'node:path'

export function resolveNode(o: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; exists: (p: string) => boolean }): string | null {
  const win = o.platform === 'win32'
  let pathVal = ''
  for (const [k, v] of Object.entries(o.env)) {
    if (typeof v !== 'string') continue
    if (win ? k.toLowerCase() === 'path' : k === 'PATH') {
      pathVal = v
      break
    }
  }
  const name = win ? 'node.exe' : 'node'
  for (const dir of pathVal.split(win ? ';' : ':').filter((d) => d.length > 0)) {
    const p = dir.endsWith('/') || dir.endsWith('\\') ? dir + name : `${dir}${win ? '\\' : '/'}${name}`
    if (o.exists(p)) return p
  }
  return null
}

export async function ensureScriptInstalled(o: {
  srcPath: string
  destDir: string
  fs: { readText(p: string): Promise<string | null>; writeTextAtomic(p: string, t: string): Promise<void>; mkdirp(p: string): Promise<void> }
}): Promise<string> {
  const dest = join(o.destDir, 'agent-console-hook.cjs')
  const src = await o.fs.readText(o.srcPath)
  if (src === null) throw new Error('hook script missing from app resources')
  await o.fs.mkdirp(o.destDir)
  if ((await o.fs.readText(dest)) !== src) await o.fs.writeTextAtomic(dest, src)
  return dest
}
