// Post-build checks on the renderer output. Exits non-zero on failure.
// Usage: node scripts/check-bundle.mjs [rendererOutDir]   (default: out/renderer)
//  - exactly one copy of React. Two copies (see scripts/electron-vite.mjs) make hooks
//    throw at startup and the window stays blank.
//  - the hook script resources/hook/agent-console-hook.cjs (shipped via extraResources): present, CommonJS,
//    no console output and no file writes (it must never print or write anything).
//    Override the path with the HOOK_SCRIPT env var (tests).
//  - production CSP: connect-src is exactly 'self' and nothing mentions localhost (R-18).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? 'out/renderer')

function jsFiles(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name)
    if (statSync(p).isDirectory()) return jsFiles(p)
    return p.endsWith('.js') ? [p] : []
  })
}

// Every copy of the `react` package defines its Suspense export exactly once
// (`exports.Suspense = ...` unminified, `x.Suspense=...` minified). react-dom does not.
const REACT_COPY = /\.Suspense\s*=(?!=)/g

const errors = []
let reactCopies = 0
for (const file of jsFiles(dir)) {
  reactCopies += (readFileSync(file, 'utf8').match(REACT_COPY) ?? []).length
}
if (reactCopies !== 1) errors.push(`expected 1 copy of React in ${dir}, found ${reactCopies}`)

const html = readFileSync(join(dir, 'index.html'), 'utf8')
const csp = /<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"/i.exec(html)?.[1]
const connect = csp
  ?.split(';')
  .map((d) => d.trim())
  .find((d) => d.startsWith('connect-src'))
if (connect !== "connect-src 'self'") errors.push(`expected connect-src 'self', found ${connect}`)
if (/localhost/i.test(html)) errors.push('index.html mentions localhost')

const hookPath = resolve(process.env.HOOK_SCRIPT ?? 'resources/hook/agent-console-hook.cjs')
if (!existsSync(hookPath)) {
  errors.push(`hook script missing: ${hookPath}`)
} else {
  const hook = readFileSync(hookPath, 'utf8')
  if (!/\brequire\(/.test(hook)) errors.push('hook script is not CommonJS (no require( call)')
  if (/\bconsole\./.test(hook)) errors.push('hook script contains console. calls')
  if (/writeFile/.test(hook)) errors.push('hook script contains writeFile')
}

if (errors.length) {
  for (const e of errors) console.error(`check-bundle: ${e}`)
  process.exit(1)
}
console.log(`check-bundle: OK (1 React copy, connect-src 'self', hook script) in ${dir}`)
