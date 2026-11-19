// Runs the electron-vite CLI with a sane environment. Used by dev, build, preview and
// package:win. Usage: node scripts/electron-vite.mjs <dev|build|preview> [args]
//
// 1. Canonical cwd. On Windows a shell can start node with a lowercase drive letter
//    (d:\...). Vite then resolves some modules under d:\ and others under D:\, and the
//    renderer bundle gets two copies of React (blank window, "reading 'useCallback'").
//    Same fix as scripts/vitest.mjs.
// 2. ELECTRON_RUN_AS_NODE. Shells spawned from VS Code / Claude Code inherit
//    ELECTRON_RUN_AS_NODE=1, which makes Electron start as plain Node and crash in
//    main ("reading 'whenReady'"). electron-vite spawns Electron with this process's
//    env, so drop the variable here.
// 3. Electron binary. electron@45 has no install script: it downloads its binary lazily
//    the first time `require('electron')` runs. electron-vite reads
//    node_modules/electron/path.txt directly and never triggers that download, so after a
//    fresh `npm ci` dev/preview fail with "Electron uninstall". Download it here first.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

process.chdir(realpathSync.native(process.cwd()))
delete process.env.ELECTRON_RUN_AS_NODE

const command = process.argv[2]

function electronInstalled(dir) {
  const pathFile = join(dir, 'path.txt')
  if (!existsSync(pathFile)) return false
  return existsSync(join(dir, 'dist', readFileSync(pathFile, 'utf8')))
}

if (command === 'dev' || command === 'preview') {
  const electronDir = join(process.cwd(), 'node_modules', 'electron')
  if (!electronInstalled(electronDir)) {
    console.log('Electron binary missing, downloading it (one time)...')
    const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })
    if (r.status !== 0 || !electronInstalled(electronDir)) {
      console.error('Electron download failed. Run "node node_modules/electron/install.js" and retry.')
      process.exit(1)
    }
  }
}

const cli = join(process.cwd(), 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
process.argv = [process.argv[0], cli, ...process.argv.slice(2)]
await import(pathToFileURL(cli).href)
