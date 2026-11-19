import { execFile, spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { watch as chokidarWatch } from 'chokidar'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { createAccountsService } from './accounts/accountsService'
import { expandHome, isAbsoluteFor, isDefaultConfigDir, toDisplayPath } from './accounts/paths'
import { isDeniedPath, safeNodeFs } from './accounts/safeFs'
import { createChokidarWatchFile } from './accounts/signIn'
import { createCatalog, type CatalogFs } from './catalog/catalog'
import { createClaudeCli, type CliExec } from './catalog/claudeCli'
import { createAttentionPrefs, type AttentionPrefsFs } from './attention/prefs'
import { createNotifier } from './attention/notifier'
import { createStatusHub } from './attention/statusHub'
import type { HostEnv } from './contracts'
import { registerContextMenu } from './contextMenu'
import { createControlManager } from './control/controlManager'
import { createExternalKiller } from './control/externalKill'
import { createImageName, createKillTree } from './control/processTree'
import { createOpenInEditor } from './editor/openInEditor'
import { createWorktreeService } from './git/worktreeService'
import { createEndpointFile } from './hooks/endpointFile'
import { buildHookEntry, createHookInstaller, hooksState } from './hooks/hookInstaller'
import { parseHookPayload } from './hooks/hookPayload'
import { ensureScriptInstalled, resolveNode } from './hooks/hookRuntime'
import { createHookServer } from './hooks/hookServer'
import { createHooksService } from './hooks/hooksService'
import { createHandlers, registerIpcHandlers } from './ipc/handlers'
import { resolveClaudeCommand } from './pty/claudeBinary'
import { createPtyManager, loadNodePty } from './pty/ptyManager'
import { createExecFn } from './transcripts/projectResolver'
import { createSessionIndex } from './transcripts/sessionIndex'
import { transcriptNodeFs } from './transcripts/transcriptFs'
import { buildRoots, createChokidarWatchDir, createTranscriptService } from './transcripts/transcriptService'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** Catalog reads: directory listing, the first bytes of a file, existence. Credential files are never touched. */
const catalogFs: CatalogFs = {
  async readdir(p) {
    if (isDeniedPath(p)) return []
    return (await safeNodeFs.readdir(p)).map((e) => ({ name: e.name, isDir: e.isDirectory() }))
  },
  async readHead(p, max) {
    if (isDeniedPath(p)) return null
    let fh: Awaited<ReturnType<typeof fsp.open>> | null = null
    try {
      fh = await fsp.open(p, 'r')
      const buf = Buffer.alloc(max)
      const { bytesRead } = await fh.read(buf, 0, max, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } catch {
      return null
    } finally {
      await fh?.close().catch(() => undefined)
    }
  },
  exists: (p) => safeNodeFs.exists(p)
}

/** execFile wrapper: resolves {stdout, stderr, code} for any exit code; rejects only when the process cannot run or times out. */
const cliExec: CliExec = (file, args, o) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { cwd: o.cwd, env: o.env, timeout: o.timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout, stderr, code: 0 })
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
      if (e.killed) return reject(new Error('The command timed out'))
      if (typeof e.code === 'number') return resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: e.code })
      reject(err)
    })
  })

const gitExec = (args: string[]): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    execFile('git', args, { timeout: 10_000, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve({ stdout })
    )
  })

/** 16x16 red dot used as the taskbar overlay when sessions need the user. */
const RED_DOT_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVklEQVR4nGP4TyFgGDUAFf+HYqIM+A/F6AaQZMB/KMZmAFEG/IdiXAYQZcB/KMZnAF4D/kMxIQPwGvAfiolxAU4DSDEApwGkGvAfitENIBcPUgMoBQDBfKbJXkd/dAAAAABJRU5ErkJggg=='

/** node:fs adapter used by the prefs store, hook installer and hook-script copy: temp file + rename for writes. */
const nodeTextFs = {
  async readText(p: string): Promise<string | null> {
    try {
      return await fsp.readFile(p, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  },
  async writeTextAtomic(p: string, text: string): Promise<void> {
    const tmp = `${p}.${process.pid}.tmp`
    await fsp.writeFile(tmp, text, 'utf8')
    await fsp.rename(tmp, p)
  },
  async mkdirp(p: string): Promise<void> {
    await fsp.mkdir(p, { recursive: true })
  },
  async remove(p: string): Promise<void> {
    await fsp.rm(p, { force: true })
  }
} satisfies AttentionPrefsFs & { remove(p: string): Promise<void> }

const mainWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())

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
  registerContextMenu(win.webContents, {
    buildMenu: (t) => Menu.buildFromTemplate(t as Electron.MenuItemConstructorOptions[]),
    writeClipboard: (text) => clipboard.writeText(text)
  })

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

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.longpl.agentconsole')
  const host: HostEnv = { home: homedir(), platform: process.platform, env: process.env, appData: process.env['APPDATA'] }
  const pty = createPtyManager({
    loadPty: loadNodePty,
    resolveClaude: () => resolveClaudeCommand({ platform: host.platform, env: process.env, home: host.home, exists: existsSync }),
    baseEnv: process.env,
    platform: host.platform
  })
  const exec = createExecFn()
  const resolveClaude = (): ReturnType<typeof resolveClaudeCommand> =>
    resolveClaudeCommand({ platform: host.platform, env: process.env, home: host.home, exists: existsSync })
  const control = createControlManager({
    spawn: (file, args, opts) => nodeSpawn(file, args, { ...opts, stdio: 'pipe' }),
    resolveClaude,
    baseEnv: process.env,
    platform: host.platform,
    killTree: createKillTree(exec, host.platform)
  })
  const accounts = createAccountsService({
    control: {
      create: (o) => control.create(o),
      running: () => control.list().filter((c) => c.state !== 'draft' && c.state !== 'exited')
    },
    fs: safeNodeFs,
    host,
    userDataDir: app.getPath('userData'),
    pty,
    watchFile: createChokidarWatchFile(),
    claudeFound: () =>
      resolveClaudeCommand({ platform: host.platform, env: process.env, home: host.home, exists: existsSync }) !== null
  })

  const pad = (n: number): string => String(n).padStart(2, '0')
  const transcripts = createTranscriptService({
    fs: transcriptNodeFs,
    host,
    roots: async () => buildRoots((await accounts.snapshot()).accounts, host),
    ptyHint: () => {
      const claude = pty.list().filter((p) => p.purpose === 'claude' && p.exitCode === undefined)
      const newest = claude.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]
      if (!newest) return null
      return { pid: newest.pid, cwd: newest.cwd, startedAtMs: Date.parse(newest.startedAt), accountId: newest.accountId ?? '' }
    },
    watchDir: createChokidarWatchDir(),
    isPidAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM'
      }
    },
    nowMs: () => Date.now(),
    localDay: (ms) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    execGit: exec,
    controlHint: () => {
      const live = control
        .list()
        .filter((c) => c.state !== 'draft' && c.state !== 'exited' && c.pid !== undefined)
        .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))[0]
      if (!live || live.pid === undefined) return null
      return {
        pid: live.pid,
        cwd: live.cwd,
        startedAtMs: Date.parse(live.startedAt ?? '') || Date.now(),
        accountId: live.accountId,
        ...(live.sessionId ? { sessionId: live.sessionId } : {})
      }
    },
    controlledSessions: () =>
      control.list().flatMap((c) => (c.sessionId ? [{ sessionId: c.sessionId, controlId: c.id }] : []))
  })
  transcripts.onTeam((s) => broadcast(IPC.teamChanged, s))
  transcripts.onSessions((list) => broadcast(IPC.transcriptsSessionsChanged, list))
  transcripts.onUsage((u) => broadcast(IPC.usageChanged, u))

  accounts.onChanged((s) => {
    broadcast(IPC.accountsChanged, s)
    void transcripts.refreshRoots()
  })
  accounts.signIn.onStatus((s) => broadcast(IPC.accountsSignInStatus, s))
  pty.onExit((ptyId, exitCode) => {
    flushPtyData(ptyId)
    broadcast(IPC.ptyExit, { ptyId, exitCode })
    transcripts.onPtyChanged()
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

  const worktrees = createWorktreeService({
    exec,
    platform: host.platform,
    watchFiles: (paths, onChange) => {
      const w = chokidarWatch(paths, { ignoreInitial: true, followSymlinks: false })
      w.on('all', () => onChange())
      w.on('error', () => undefined)
      return { close: () => void w.close().catch(() => undefined) }
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    now: () => new Date()
  })
  transcripts.onActivity(() => worktrees.poke())
  worktrees.onChanged((snap) => broadcast(IPC.gitChanged, snap))

  // ---- hooks ----
  const hookDir = join(app.getPath('userData'), 'hook')
  const hookScriptSrc = app.isPackaged
    ? join(process.resourcesPath, 'hook/agent-console-hook.cjs')
    : join(app.getAppPath(), 'resources/hook/agent-console-hook.cjs')
  const installScript = (): Promise<string> => ensureScriptInstalled({ srcPath: hookScriptSrc, destDir: hookDir, fs: nodeTextFs })
  const resolveNodePath = (): string | null => resolveNode({ platform: host.platform, env: process.env, exists: existsSync })
  const installer = createHookInstaller({ fs: nodeTextFs, newId: () => randomUUID(), platform: host.platform })

  // ---- attention ----
  const hooksInstalledCache = new Map<string, { at: number; value: boolean }>()
  const hooksInstalled = async (root: string): Promise<boolean> => {
    const hit = hooksInstalledCache.get(root)
    if (hit && Date.now() - hit.at < 30_000) return hit.value
    let value = false
    try {
      const node = resolveNodePath()
      const r = node ? await installer.read(root) : null
      if (node && r && !r.error) value = hooksState(r.json, buildHookEntry(node, await installScript())) === 'installed'
    } catch {
      value = false
    }
    hooksInstalledCache.set(root, { at: Date.now(), value })
    return value
  }
  const hub = createStatusHub({
    fs: transcriptNodeFs,
    nowMs: () => Date.now(),
    listSessions: () => transcripts.listSessions(),
    controls: () => control.list().map((info) => ({ info, permissions: control.streamState(info.id)?.permissions ?? [] })),
    sessionFile: (s) => join(s.configDir, 'projects', s.projectDir, `${s.sessionId}.jsonl`),
    usageByProject: () => transcripts.usageByProject(),
    hooksInstalled,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
  })
  const prefs = createAttentionPrefs({ filePath: join(app.getPath('userData'), 'attention-prefs.json'), fs: nodeTextFs })
  await prefs.load()
  const redDot = nativeImage.createFromDataURL(RED_DOT_DATA_URL)
  const liveNotifications = new Set<Notification>()
  const notifier = createNotifier({
    show: (n) => {
      if (!Notification.isSupported()) return
      const note = new Notification({ title: n.title, body: n.body })
      liveNotifications.add(note)
      note.on('click', n.onClick)
      note.on('close', () => liveNotifications.delete(note))
      note.show()
    },
    flash: (on) => mainWindow()?.flashFrame(on),
    overlay: (c) => mainWindow()?.setOverlayIcon(c > 0 ? redDot : null, c > 0 ? `${c} need you` : ''),
    isFocusedAndVisible: () => {
      const w = mainWindow()
      return !!w && w.isFocused() && w.isVisible()
    },
    prefs: () => prefs.get(),
    onFocusItem: (itemId) => {
      const w = mainWindow()
      w?.show()
      w?.focus()
      broadcast(IPC.attentionFocus, { itemId })
    }
  })
  hub.onChanged((snap) => {
    broadcast(IPC.attentionChanged, snap)
    notifier.update(snap)
  })
  transcripts.onSessions(() => void hub.refresh())
  transcripts.onFileChange((path) => hub.onFileChanged(path))

  const hookServer = createHookServer({
    parse: parseHookPayload,
    onEvent: (e) => hooks.handleEvent(e),
    endpoint: createEndpointFile(hookDir)
  })
  const hooks = createHooksService({
    server: hookServer,
    installer,
    resolveNode: resolveNodePath,
    installScript,
    onHook: (e) => {
      transcripts.ingestHook(e)
      hub.ingestHook(e)
    }
  })
  hooks.onChanged((st) => {
    hooksInstalledCache.clear()
    broadcast(IPC.hooksChanged, st)
    void hub.refresh()
  })

  // ---- control pushes ----
  control.onChanged((list) => {
    broadcast(IPC.controlChanged, list)
    transcripts.onPtyChanged()
    void hub.refresh()
  })
  control.onStream((events) => broadcast(IPC.controlStream, events))
  control.onDetails((d) => broadcast(IPC.controlDetailsChanged, d))

  // ---- catalog + claude mcp/plugin CLI (T25) ----
  const catalog = createCatalog({ fs: catalogFs, home: host.home, platform: host.platform })
  const claudeCli = createClaudeCli({
    exec: cliExec,
    resolveClaude,
    baseEnv: process.env,
    platform: host.platform,
    newId: () => randomUUID(),
    now: () => Date.now()
  })
  const resolveAccountDir = async (accountId: string): Promise<{ abs: string; configDirAbs: string | null; display: string } | null> => {
    const a = (await accounts.snapshot()).accounts.find((x) => x.id === accountId)
    if (!a) return null
    const abs = expandHome(a.configDir, host.home)
    if (!isAbsoluteFor(abs, host.platform)) return null
    const isDefault = isDefaultConfigDir(abs, host.home, host.platform)
    return { abs, configDirAbs: isDefault ? null : abs, display: isDefault ? '~/.claude' : toDisplayPath(abs, host.home, host.platform) }
  }

  const pidAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  const registryIndex = createSessionIndex({
    fs: transcriptNodeFs,
    platform: host.platform,
    home: host.home,
    isPidAlive: pidAlive,
    nowMs: () => Date.now()
  })
  const externalKiller = createExternalKiller({
    readRegistry: async () => registryIndex.readRegistry(buildRoots((await accounts.snapshot()).accounts, host)),
    isPidAlive: pidAlive,
    imageName: createImageName(exec, host.platform),
    killTree: createKillTree(exec, host.platform),
    ownPids: () => [...pty.list().map((p) => p.pid), ...control.list().flatMap((c) => (c.pid !== undefined ? [c.pid] : []))]
  })
  const openInEditor = createOpenInEditor({
    platform: host.platform,
    env: process.env,
    exists: existsSync,
    isDir: async (p) => {
      try {
        return (await fsp.stat(p)).isDirectory()
      } catch {
        return false
      }
    },
    spawnDetached: (file, args, env) => {
      try {
        const c = nodeSpawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, ...(env ? { env } : {}) })
        c.on('error', () => undefined)
        c.unref()
        return true
      } catch {
        return false
      }
    },
    openPath: (p) => shell.openPath(p)
  })

  app.on('before-quit', () => {
    control.disposeAll()
    hub.dispose()
    worktrees.dispose()
    void hooks.stop().catch(() => undefined)
    transcripts.dispose()
    pty.disposeAll()
    accounts.signIn.disposeAll()
  })

  registerIpcHandlers(
    ipcMain,
    createHandlers({
      version: app.getVersion(),
      accounts,
      pty,
      transcripts,
      onPtySpawned: () => transcripts.onPtyChanged(),
      control,
      worktrees,
      hooks,
      externalKiller,
      openInEditor,
      catalog,
      claudeCli,
      resolveAccountDir,
      execGit: gitExec,
      isSessionLive: (accountId, sessionId) => transcripts.isSessionLive(accountId, sessionId),
      attention: {
        snapshot: () => hub.snapshot(),
        getPrefs: () => prefs.get(),
        setPrefs: async (p) => {
          const r = await prefs.save(p)
          if (r.ok) notifier.update(hub.snapshot())
          return r
        }
      },
      pickFolder: async () => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const opts = { properties: ['openDirectory' as const] }
        const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
        return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
      },
      openExternal: (url) => shell.openExternal(url),
      defaultCwd: () => (app.isPackaged ? host.home : (process.env['INIT_CWD'] ?? process.cwd()))
    })
  )
  void transcripts.start().then(() => hub.refresh())
  try {
    await hooks.start()
  } catch {
    // details are not logged; the app continues without hooks
    console.error('hook server failed to start')
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
