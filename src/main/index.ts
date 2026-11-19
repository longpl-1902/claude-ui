import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { createAccountsService } from './accounts/accountsService'
import { safeNodeFs } from './accounts/safeFs'
import { createChokidarWatchFile } from './accounts/signIn'
import type { HostEnv } from './contracts'
import { createHandlers, registerIpcHandlers } from './ipc/handlers'
import { resolveClaudeCommand } from './pty/claudeBinary'
import { createPtyManager, loadNodePty } from './pty/ptyManager'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0E0F11',
    title: 'Agent Console',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const host: HostEnv = { home: homedir(), platform: process.platform, env: process.env, appData: process.env['APPDATA'] }
  const pty = createPtyManager({
    loadPty: loadNodePty,
    resolveClaude: () => resolveClaudeCommand({ platform: host.platform, env: process.env, home: host.home, exists: existsSync }),
    baseEnv: process.env,
    platform: host.platform
  })
  const accounts = createAccountsService({
    fs: safeNodeFs,
    host,
    userDataDir: app.getPath('userData'),
    pty,
    watchFile: createChokidarWatchFile(),
    claudeFound: () =>
      resolveClaudeCommand({ platform: host.platform, env: process.env, home: host.home, exists: existsSync }) !== null
  })

  accounts.onChanged((s) => broadcast(IPC.accountsChanged, s))
  accounts.signIn.onStatus((s) => broadcast(IPC.accountsSignInStatus, s))
  pty.onExit((ptyId, exitCode) => {
    flushPtyData(ptyId)
    broadcast(IPC.ptyExit, { ptyId, exitCode })
  })

  // Coalesce pty output per id within one 16 ms tick.
  const pending = new Map<string, { data: string; end: number }>()
  let timer: ReturnType<typeof setTimeout> | null = null
  function flushPtyData(only?: string): void {
    for (const [ptyId, { data, end }] of [...pending]) {
      if (only !== undefined && ptyId !== only) continue
      pending.delete(ptyId)
      broadcast(IPC.ptyData, { ptyId, data, end })
    }
    if (pending.size === 0 && timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  pty.onData((ptyId, data, end) => {
    pending.set(ptyId, { data: (pending.get(ptyId)?.data ?? '') + data, end })
    timer ??= setTimeout(() => {
      timer = null
      flushPtyData()
    }, 16)
  })

  app.on('before-quit', () => {
    pty.disposeAll()
    accounts.signIn.disposeAll()
  })

  registerIpcHandlers(
    ipcMain,
    createHandlers({
      version: app.getVersion(),
      accounts,
      pty,
      pickFolder: async () => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const opts = { properties: ['openDirectory' as const] }
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
      },
      defaultCwd: () => (app.isPackaged ? host.home : (process.env['INIT_CWD'] ?? process.cwd()))
    })
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
