// Verifies node-pty loads and spawns a process under Electron's Node runtime.
// Prints one line: `node-pty OK (prebuilt|build)` or the error. Exit 0 iff the marker is seen within 15 s.
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
if (!existsSync(electron)) {
  console.log(`node-pty check failed: electron binary not found at ${electron}`)
  process.exit(1)
}

const MARKER = 'agent-console-pty-ok'
const script = `
const path = require('path')
const root = ${JSON.stringify(root)}
let pty
try { pty = require(require.resolve('node-pty', { paths: [root] })) } catch (e) { console.log('ERR load: ' + e.message); process.exit(2) }
const kind = require('fs').existsSync(path.join(root, 'node_modules', 'node-pty', 'build', 'Release')) ? 'build' : 'prebuilt'
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const win = process.platform === 'win32'
let out = ''
let p
try {
  p = win ? pty.spawn('cmd.exe', ['/d', '/c', 'echo ${MARKER}'], { env }) : pty.spawn('sh', ['-c', 'echo ${MARKER}'], { env })
} catch (e) { console.log('ERR spawn: ' + e.message); process.exit(3) }
p.onData((d) => {
  out += d
  if (out.includes('${MARKER}')) { console.log('node-pty OK (' + kind + ')'); process.exit(0) }
})
setTimeout(() => { console.log('ERR timeout: marker not seen'); process.exit(4) }, 14000)
`
const file = join(tmpdir(), `check-pty-${process.pid}.cjs`)
writeFileSync(file, script)
const child = spawn(electron, [file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (out += d))
const timer = setTimeout(() => child.kill(), 15000)
child.on('exit', (code) => {
  clearTimeout(timer)
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? `no output (exit ${code})`
  console.log(line)
  process.exit(code === 0 ? 0 : 1)
})
