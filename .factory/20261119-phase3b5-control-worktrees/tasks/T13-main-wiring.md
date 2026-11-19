# T13 - Main wiring: IPC handlers and app startup for control, git, hooks, external actions

- Wave: 6
- Depends on: T01, T05, T07, T08, T10, T11, T21
- Spec refs: R-01, R-04, R-07, R-15, R-19
- Tests: tests/main/ipcHandlers.test.ts

## Goal
Replace the T01 stubs with real handlers and create/dispose the new services in `src/main/index.ts`; ship the hook
script as an extra resource.

## Owned files
- modify: src/main/ipc/handlers.ts
- modify: src/main/index.ts
- modify: electron-builder.yml (add `extraResources: [{ from: resources/hook, to: hook }]` only)
- modify: tests/main/ipcHandlers.test.ts

## Read-only context
- All modules from T05, T07, T08, T10, T11; src/main/accounts/safeFs.ts; src/main/transcripts/projectResolver.ts (`createExecFn`)
- plan.md Decisions D1-D6, D11

## Notes
HandlerDeps gains optional `control`, `worktrees`, `hooks`, `externalKiller`, `openInEditor`,
`isSessionLive(accountId, sessionId)`. Handlers (validate with T01 validators; invalid -> INVALID_ARGS):
- `control:start`: `isControlStartRequest`; if `resume.kind==='resume' && !resume.fork && await isSessionLive(...)`
  -> `{ok:false, reason:'session-live-elsewhere'}`; else `accounts.launchControlled(req)`.
- `control:send` (text <= 32 000 chars), `interrupt`, `stop`, `answer` (`isPermissionAnswer`), `set-model`
  (MODEL_RE or null), `set-mode`, `list`, `get-stream` -> manager.
- `team:pause-all` -> `{ ok: true, reason: String(control.interruptAll()) }` (count in reason is fine) or
  `{ok:false, reason:'nothing-running'}`.
- `session:kill-external` -> externalKiller.kill. `worktree:open-in-editor` -> openInEditor.open.
- `git:watch` (string <= 1024 or null) / `git:compare` -> worktrees. `hooks:*` -> hooksService.
index.ts:
- `createControlManager({ spawn: (f,a,o) => child_process.spawn(f,a,{...o, stdio:'pipe'}), resolveClaude, baseEnv:
  process.env, platform, killTree: createKillTree(createExecFn(), platform) })`; pushes `control:changed`
  (+ `transcripts.onPtyChanged()` so Auto can follow) and `control:stream`.
- accounts gets `control: { create: control.create, running: () => control.list().filter(...) }`; transcripts gets
  `controlHint` (newest non-draft/non-exited session with pid: `{pid, cwd, startedAtMs, accountId, sessionId}`) and
  `controlledSessions`.
- `createWorktreeService({ exec: createExecFn(), platform, watchFiles: chokidar-based (ignoreInitial, no polling
  of trees), ... })`; `transcripts.onActivity(() => worktrees.poke())`; push `git:changed`.
- Hooks: userData `hook/` dir; `createEndpointFile(dir)`; `createHookServer({ parse: parseHookPayload, onEvent: (e)
  => hooksService handler, endpoint })`; hooksService with `installer` over a small fs adapter (node:fs/promises,
  atomic write via temp+rename), `resolveNode` with process.env, `installScript` = ensureScriptInstalled from
  `app.isPackaged ? join(process.resourcesPath,'hook/agent-console-hook.cjs') : join(app.getAppPath(),'resources/hook/agent-console-hook.cjs')`;
  `onHook: (e) => transcripts.ingestHook(e)`; push `hooks:changed`; `await hooks.start()` before createWindow (failure
  logged without details, app continues).
- `openInEditor` deps: `spawn(file,args,{detached:true, stdio:'ignore', windowsHide:true, env}).unref()`, `shell.openPath`.
- `externalKiller` deps: `readRegistry` from a separate read-only `createSessionIndex({ fs: transcriptNodeFs, ... })`
  instance called with the same roots (`buildRoots(accounts)`), `isPidAlive` as today, `imageName =
  createImageName(createExecFn(), platform)`, `killTree`, `ownPids = [...pty.list(), ...control.list()]` pids.
- Attention (T21): `createStatusHub({...})` with `listSessions: transcripts.listSessions`, `controls` from the
  manager, `usageByProject: transcripts.usageByProject`, refresh on `onSessions`, `control:changed`, hook events (`hub.ingestHook`) and the
  chokidar transcript change callback; push `attention:changed`. `createNotifier({ show: (n) => new
  Notification({title, body}).on('click', ...).show(), flash: (on) => win.flashFrame(on), overlay: (c) =>
  win.setOverlayIcon(c > 0 ? redDot : null, c > 0 ? `${c} need you` : ''), isFocusedAndVisible: () => win.isFocused()
  && win.isVisible(), prefs, onFocusItem: (id) => { win.show(); win.focus(); broadcast('attention:focus', {itemId: id}) } })`;
  `redDot` = `nativeImage.createFromDataURL(<16x16 red circle PNG data URL constant>)`. Prefs via T21 prefs.ts in
  userData. Handlers `attention:get|get-prefs|set-prefs`. On win32 call `app.setAppUserModelId('com.longpl.agentconsole')`
  (= electron-builder appId) before any Notification so toasts show in packaged builds.
- before-quit: `control.disposeAll()`, `hub.dispose()`, `worktrees.dispose()`, `await hooks.stop()` (best effort, sync-safe).
- **R-19:** nothing in startup calls `control.send`; test: createHandlers with a recording fake manager - no call
  to send/start unless the handler is invoked.
Tests: every new handler happy path + invalid args, session-live-elsewhere, pause-all count, R-19 recorder.

## Acceptance commands
- npm test -- tests/main/ipcHandlers.test.ts tests/shared/ipcContract.test.ts
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass
- Only owned files changed
