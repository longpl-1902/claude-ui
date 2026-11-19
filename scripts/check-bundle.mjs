// Post-build checks on the renderer output. Exits non-zero on failure.
// Usage: node scripts/check-bundle.mjs [rendererOutDir]   (default: out/renderer)
//  - exactly one copy of React. Two copies (see scripts/electron-vite.mjs) make hooks
//    throw at startup and the window stays blank.
//  - production CSP: connect-src is exactly 'self' and nothing mentions localhost (R-18).
import { readdirSync, readFileSync, statSync } from 'node:fs'
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

if (errors.length) {
  for (const e of errors) console.error(`check-bundle: ${e}`)
  process.exit(1)
}
console.log(`check-bundle: OK (1 React copy, connect-src 'self') in ${dir}`)
