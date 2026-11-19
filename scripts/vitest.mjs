// Runs the vitest CLI from the canonical spelling of the cwd.
// On Windows a shell can start node with a lowercase drive letter (d:\...). Node and
// Vite then load some modules under d:\ and others under D:\, giving two copies of
// vitest, React, etc. Normalising the cwd before vitest loads keeps every path on one
// spelling. Usage: node scripts/vitest.mjs [vitest args]
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.chdir(realpathSync.native(process.cwd()))

const bin = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
process.argv = [process.argv[0], bin, ...process.argv.slice(2)]
await import(pathToFileURL(bin).href)
