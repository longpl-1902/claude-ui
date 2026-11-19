# T36 — Per-window selection (two monitors, different sessions) (follow-up to T34, 2026-11-19)

Spec by senior-architect (opus); saved by the orchestrator.

T34 added pop-out windows (kind `chat` = one session, kind `project` = pinned project). The transcript service still
has ONE app-wide selection (`src/main/transcripts/transcriptService.ts:180-181`, `select()` at :772), and
`team:changed` is broadcast to all windows (`src/main/index.ts:303`). So a chat window that selects its session
(`src/renderer/src/windowKinds.tsx:39`) also switches the main window. Two monitors cannot show two sessions at once.

Wave: after T34 (merged), in parallel with T32 (renderer declutter). T36 owns main, shared and preload. Its renderer
changes are limited to the exact list in §E.

## Behaviour
1. **Selection per window (viewer).** Each window has its own `TeamSelection`, its own auto pick and its own
   `waitingForSession`, and receives only its own `team:changed` pushes. `team:get-snapshot`, `transcripts:select` and
   `transcripts:get-selection` answer for the calling window. The renderer API does not change.
2. **Shared work.** Watchers (per root), the usage counter, session listing and the registry stay app-wide. A tailed
   session (model + tailer + files) exists once, however many windows view it, and is refcounted by viewer.
   When the last viewer leaves a session, the session is dropped: no more reads and no more parsing.
3. **Default viewer = main window** (`DEFAULT_VIEWER = 'main'`). It always exists, `start()` runs auto for it, and every
   call without a viewer argument uses it. This keeps the single-window behaviour and the existing tests.
4. **Auto mode per viewer.** Each viewer in auto mode is re-picked separately (stability rule included) with its own
   `projectKey`. A viewer created lazily (first IPC from a new window) starts in `{mode:'auto'}` and gets a
   background auto pick.
5. **Release on close.** When a secondary window is closed, its viewer is released (its session refcount goes down).
   The main viewer is never released.
6. **Still broadcast:** sessions-changed, usage, attention, control (+ stream/details), git, hooks, accounts, pty, window
   pushes.
7. **R-19 unchanged:** nothing here sends anything to Claude. Focus routing only focuses windows.
8. **Small issues from T34, folded in:**
   - Ctrl+J / Ctrl+Shift+J (`focusNext` / `focusPrev`) asks main to route the jump. Main focuses the window that shows
     the item: a chat window for that exact session first, then the project window, then main. That window handles
     it via the existing `attention:focus` push. The current window is no longer hijacked. Without the new API it falls
     back to the old local behaviour.
   - Toast suppression becomes per-window: a toast is skipped when the app is focused AND any non-minimized window's
     viewer is showing the item's session (accountId + sessionId). The renderer's `viewedProjectKey` push (last
     window wins) is ignored by main from now on. It stays in prefs for compatibility; no renderer change.
   - Settings UI for `reopenOnStart`: a checkbox "Reopen pop-out windows on start" in the Accounts → Appearance card.

## Data model (transcriptService.ts)
```ts
// src/main/transcripts/viewer.ts (new, exact content)
export type ViewerId = string
/** The main window's viewer; also the viewer of every call that names none (tests, single-window). */
export const DEFAULT_VIEWER: ViewerId = 'main'

// inside createTranscriptService (replace the `Selected` interface at :142-149)
interface Session {            // was Selected
  key: string                  // pickKey(pick) = `${accountId}|${sessionId}|${norm(configDirAbs)}`
  pick: AutoPick
  model: SessionModel
  tailer: Tailer
  files: Map<string, FileRec>
  subDir: string
  registryJson: string
  viewers: Set<ViewerId>       // refcount
}
interface Viewer { id: ViewerId; selection: TeamSelection; session: Session | null; waiting: boolean }
const sessions = new Map<string, Session>()
const viewers = new Map<ViewerId, Viewer>()   // DEFAULT_VIEWER inserted at construction: { mode: 'auto' }, null, false
const pendingTail = new Map<string /* norm(path) */, Session>()   // was Set<string>
const pushQueue = new Set<ViewerId>()                               // viewers owed a throttled push
const isActive = (s: Session): boolean => !disposed && sessions.get(s.key) === s
const isLiveViewer = (v: Viewer): boolean => !disposed && viewers.get(v.id) === v
```

## Public API changes (TranscriptService interface, :45-63)
```ts
snapshot(viewer?: ViewerId): TeamSnapshot
select(sel: TeamSelection, viewer?: ViewerId): Promise<TeamSnapshot>
getSelection(viewer?: ViewerId): TeamSelection
/** Drops a closed window's viewer; its session goes when no viewer is left. No-op for DEFAULT_VIEWER / unknown ids. */
releaseViewer(viewer: ViewerId): void
/** Viewers that currently show a session (for toast suppression). */
viewing(): { viewer: ViewerId; accountId: string; sessionId: string }[]
onTeam(cb: (s: TeamSnapshot, viewer: ViewerId) => void): () => void   // one call per viewer push
```
`viewer` defaults to `DEFAULT_VIEWER`. `snapshot` / `select` / `getSelection` create an unknown viewer on first use
(see A4). Everything else is unchanged.

## IPC changes
- **Viewer-scoped invoke channels** (names unchanged): `team:get-snapshot`, `transcripts:select`,
  `transcripts:get-selection`. `registerIpcHandlers(ipc, handlers, scope?)` gets an optional
  `scope: { handlers: ViewerHandlers; viewerOf(senderId: number): ViewerId }`. For those 3 channels it calls
  `scope.handlers[ch](scope.viewerOf(event.sender.id), ...args)`. Without `scope`, behaviour is exactly as today.
- **`team:changed`** is no longer broadcast. It is sent only to the viewer's window.
- **New invoke `attention:focus-item`** (`IPC.attentionFocusItem`): args `[itemId: string]` → `OkResult`. Main focuses the
  right window and sends it `attention:focus` (existing push).
- **New window channels** (registered by windowManager like the others): `WINDOW_IPC.getPrefs = 'window:get-prefs'`
  (→ `WindowPrefs`) and `WINDOW_IPC.setPrefs = 'window:set-prefs'` (`WindowPrefs` → `OkResult`).
  `WindowPrefs = { reopenOnStart: boolean }` in `src/shared/types.ts`.
- `ConsoleApi.attention.focusItem?(itemId): Promise<OkResult>` and `ConsoleApi.windows.getPrefs?()` / `setPrefs?(p)`
  are **optional**, so existing renderer test fakes still compile.

## Owned files
Main/shared/preload: `src/main/transcripts/viewer.ts` (new), `src/main/transcripts/transcriptService.ts`,
`src/main/windows/viewers.ts` (new), `src/main/windows/windowManager.ts`, `src/main/ipc/handlers.ts`,
`src/main/attention/notifier.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`.
Renderer (exact, minimal; coordinate with T32): `src/renderer/src/store/useAttentionStore.ts` (only the `step` function),
`src/renderer/src/components/accounts/ReopenWindowsToggle.tsx` (new),
`src/renderer/src/components/accounts/AppearanceRow.tsx` (one import + one JSX line).
No CSS changes. Not touched: `windowKinds.tsx`, `App.tsx`, `useConsoleStore.ts`.
Tests: `tests/main/transcripts/transcriptViewers.test.ts` (new), `tests/main/windows/viewers.test.ts` (new),
`tests/renderer/attentionRouting.test.ts` (new), `tests/renderer/reopenWindowsToggle.test.tsx` (new), plus additions in
`tests/main/windows/windowManager.test.ts`, `tests/main/ipcHandlers.test.ts`, `tests/main/attention/notifier.test.ts`,
`tests/shared/windowSpec.test.ts`, `tests/shared/ipcContract.test.ts`.

## Implementation notes (do them in order §A → §E)

### §A transcriptService.ts
- **A1** Create `viewer.ts` (content above). Import `DEFAULT_VIEWER`, `ViewerId` in transcriptService.ts and re-export
  both (`export { DEFAULT_VIEWER, type ViewerId } from './viewer'`).
- **A2** State (:177-186): remove `selection`, `selected`, `waitingForSession`. Add `sessions`, `viewers` (seed
  DEFAULT_VIEWER), `pendingTail` as a Map, `pushQueue`, and `let started = false`. `teamCbs` becomes
  `Set<(s: TeamSnapshot, v: ViewerId) => void>`. Add `fireTeam(s, v)` with the same try/catch as `fire`.
- **A3** Helpers: `pickKey(p)`, `isActive`, `isLiveViewer`, `viewersOf(s) = [...s.viewers].flatMap(id => viewers.get(id) ?? [])`.
- **A4** `viewerFor(id)`: get or create `{ id, selection: { mode: 'auto' }, session: null, waiting: false }`. If newly
  created and `started && !disposed`, run `bg(() => applyAuto(v))`. Used by public `snapshot` / `select` / `getSelection`.
- **A5** Snapshots (:240-276):
  - Split `currentSnapshot` into `sessionSnapshot(s: Session)` (the old capped body using `s.model`) and
    `emptySnapshot(waiting: boolean)`. `viewerSnapshot(v) = v.session ? sessionSnapshot(v.session) : emptySnapshot(v.waiting)`.
  - `pushNow(vs: Iterable<Viewer>)`: memo `Map<Session, TeamSnapshot>` so each session's snapshot is computed once per
    call (model.snapshot() clears dirty). For each live viewer: `pushQueue.delete(v.id)` and `fireTeam(snap, v.id)`.
    Clear `pushTimer` when `pushQueue` is empty.
  - `schedulePush(s)`: add `s.viewers` to `pushQueue`. If no timer is armed, arm one timer of `PUSH_MS` that calls
    `pushNow` with the viewers in the queue.
  - `afterIngest(s)`: `if (isActive(s) && s.model.isDirty()) schedulePush(s)`.
- **A6** Tail path (:281-429): rename the `sel: Selected` params to `Session`. Replace every `sel === selected` /
  `sel !== selected` with `isActive(sel)` / `!isActive(sel)` (lines :338, :344, :358, :368, :384, :388, :390, :414).
  - `enqueue(s, rec)` does `pendingTail.set(norm(rec.path), s)`.
  - The drain loop (:402-408) takes the first entry, deletes it, skips it if `!isActive(s)`, and otherwise runs `processFile(s, s.files.get(key))`.
- **A7** Selection (:432-501):
  - `attach(v, pick | null)`:
    1. Same key as `v.session` → `pushNow([v])`.
    2. Otherwise `detach(v)`. If `!pick` → `pushNow([v])`.
    3. If `sessions` already has the key → add the viewer and `pushNow([v])`. No load: lane tasks are serial, so an existing session is already loaded.
    4. Otherwise create the session, register it, run the old `switchTo` load body (each `selected !== sel` becomes `!isActive(sess)`), then `pushNow(viewersOf(sess))`.
  - `detach(v)`: unlink the viewer. When `s.viewers.size === 0`, delete `sessions[s.key]` and every `pendingTail` entry of that session.
  - `applyAuto(v, force = false, memo?)`: same logic as :470-492, using `v.selection` / `v.session` / `v.waiting`.
    After each await, bail out unless `isLiveViewer(v) && v.selection.mode === 'auto'`. Optional memo:
    `Map<string, ReturnType<pickAuto>>` keyed by `projectKey ?? ''`, shared within one repick pass.
  - `scheduleRepick()`: return if queued or no viewer is in auto mode. Otherwise one `bg` that loops
    `for (const v of [...viewers.values()]) if (v.selection.mode === 'auto') await applyAuto(v, false, memo)`.
- **A8** `syncRoots` (:683-685): for every session whose root is gone, `await attach(v, null)` for each of its viewers.
- **A9** `onFsEvent` (:688-722):
  - Registry branch: `bg(() => refreshRegistry(s))` for every session.
  - Transcript branch: find the session with
    `sessions.get(`${root.accountId}|${info.sessionId}|${norm(root.configDirAbs)}`)` instead of the `selected` compare
    (:712-715). Do NOT change the counter / sessions / fileChange logic.
- **A10** `pollOnce` (:725-745): `if (sessions.size === 0) return`, `pollTick++` once, then the old body for each
  `[...sessions.values()]` with `isActive` checks.
- **A11** Public (:761-858):
  - `start` sets `started = true` and runs `applyAuto(viewerFor(DEFAULT_VIEWER))`.
  - `snapshot(v = DEFAULT_VIEWER)` returns `viewerSnapshot(viewerFor(v))`.
  - `select(sel, v = DEFAULT_VIEWER)`: old logic (:772-789) on `viewerFor(v)`; session mode calls `attach`. Returns `viewerSnapshot`.
  - `getSelection(v)` returns `{ ...viewerFor(v).selection }`.
  - `refreshRoots`: auto re-pick per viewer, as in scheduleRepick.
  - `ingestHook`: every session with `pick.sessionId === e.sessionId` gets `applyHook`, `afterIngest`, and a `bg` process-all-files. Fallback (`scheduleSessions`) unchanged.
  - `releaseViewer(id)`: ignore DEFAULT_VIEWER and unknown ids. Otherwise `viewers.delete`, `pushQueue.delete`, `detach` (synchronous).
  - `viewing()`.
  - `dispose` clears `sessions`, `viewers`, `pendingTail`, `pushQueue`.
- **A12** `ingestLines` activity check (:338) uses `isActive(sel)`. Do NOT rename existing exported functions (`buildRoots`, `createChokidarWatchDir`).
- Risk: one missed `selected` check leaves an orphaned session parsing; the tests count readRange calls to catch it.
  Memory: up to 9 session models (main + 8 secondary windows), bounded by the window cap and released on close.

### §B contracts + windowManager
- **B1** `src/shared/ipc.ts`:
  - `IPC.attentionFocusItem: 'attention:focus-item'` (next to :108-110).
  - IpcInvokeMap entry `'attention:focus-item': { args: [itemId: string]; result: OkResult }`, and add it to `invokeChannelList` (:321-323).
  - `WINDOW_IPC` (:163-169) gets `getPrefs: 'window:get-prefs'` and `setPrefs: 'window:set-prefs'`.
  - ConsoleApi: `attention.focusItem?(itemId: string): Promise<OkResult>`, `windows.getPrefs?(): Promise<WindowPrefs>`, `windows.setPrefs?(p: WindowPrefs): Promise<OkResult>`.
- **B2** `src/shared/types.ts`: `export interface WindowPrefs { reopenOnStart: boolean }`.
- **B3** `src/preload/index.ts`: in attention (:130-136) add `focusItem: (id) => invoke(IPC.attentionFocusItem, id)`. In windows (:161-167) add
  `getPrefs: () => ipcRenderer.invoke(WINDOW_IPC.getPrefs)` and `setPrefs: (p) => ipcRenderer.invoke(WINDOW_IPC.setPrefs, p)`.
  No change for team:changed (the preload just listens).
- **B4** `windowManager.ts`:
  - deps (:43-51): add `onClosed?(w: ManagedWindow, spec: WindowSpec): void`. Call it first thing in the `'closed'` handler (:171), inside try/catch, before the `quitting` check.
- **B5** `focusProject(projectKey, sessionRef?: string)` (:59-60, :250-255): first a live `chat` entry with
  `spec.sessionRef === sessionRef` (when given), then the project window, then main. Keep `reveal`.
- **B6** `registerIpc` (:259-271): add `WINDOW_IPC.getPrefs → ({ reopenOnStart: state.reopenOnStart })` and
  `WINDOW_IPC.setPrefs`. setPrefs validates a plain object with a boolean `reopenOnStart` (else `{ok:false, reason:'invalid-args'}`),
  sets `state.reopenOnStart`, calls `saveNow()`, and returns `{ ok: true }`. persistence.ts already round-trips the flag.

### §C handlers + notifier
- **C1** `handlers.ts`:
  - Export `VIEWER_CHANNELS = ['team:get-snapshot', 'transcripts:select', 'transcripts:get-selection'] as const`, the
    `ViewerHandlers` type (`(viewer: string, ...IpcInvokeMap[C]['args']) => result | Promise<result>`), and
    `createViewerHandlers(t: Pick<TranscriptService, 'snapshot' | 'select' | 'getSelection'>)`. Its select validates with
    `isTeamSelection` and answers `structuredClone(EMPTY_TEAM_SNAPSHOT)` when invalid.
  - Keep the existing `createHandlers` transcripts entries (:358-364) unchanged (default viewer), so the current tests pass.
- **C2** `registerIpcHandlers(ipc, handlers = createHandlers(), scope?: { handlers: ViewerHandlers; viewerOf(senderId: number): string })`
  (:622-627): for channels in `VIEWER_CHANNELS` when `scope` is present, register
  `(event, ...args) => scoped(scope.viewerOf(senderIdOf(event)), ...args)`. `senderIdOf` reads `event?.sender?.id`
  when it is a number, else `-1`. Still exactly one `handle` per channel. Electron stays a type-only import (R-17 test).
- **C3** Attention:
  - `HandlerDeps.attention.focusItem?(itemId: string): OkResult`.
  - Real handler `'attention:focus-item'`: `str(id, 512) && id !== ''`, then `att.focusItem?.(id) ?? NOT_IMPLEMENTED`; otherwise `INVALID_ARGS`.
  - Mock (:616-618): same validation, answers `NOT_IMPLEMENTED`.
- **C4** `notifier.ts`: `NotifierDeps.isViewed?: (i: AttentionItem) => boolean`. Line :60 becomes
  `if (focused && (deps.isViewed ? deps.isViewed(i) : prefs.viewedProjectKey === i.projectKey)) return false`.

### §D main wiring
- **D1** New `src/main/windows/viewers.ts`:
  ```ts
  export const viewerIdOf = (senderId: number): ViewerId => `wc:${senderId}`
  export function createViewerRouter(get: () => { main(): ManagedWindow | undefined; all(): ManagedWindow[] } | undefined): {
    viewerOf(senderId: number): ViewerId          // main's senderId, a negative id, or no manager -> DEFAULT_VIEWER
    windowOf(viewer: ViewerId): ManagedWindow | undefined   // DEFAULT_VIEWER -> main(); 'wc:N' -> all().find(senderId === N)
    send(viewer: ViewerId, channel: string, payload: unknown): void   // no-op when gone / destroyed
    isShown(viewer: ViewerId): boolean            // window exists, !isDestroyed(), !isMinimized()
  }
  ```
- **D2** `index.ts`:
  - `const viewers = createViewerRouter(() => windows)` near :125.
  - :303 becomes `transcripts.onTeam((s, viewer) => viewers.send(viewer, IPC.teamChanged, s))`.
- **D3** Pull the notifier's `onFocusItem` body (:411-417) out into `routeAttentionFocus(itemId): OkResult`:
  - Look the item up in `hub.snapshot().items`.
  - Target = `windows?.focusProject(item.projectKey, `${item.accountId}|${item.sessionId}`)`, or `windows?.main()` when the item is unknown.
  - If there is no target or it is destroyed → `{ ok: false, reason: 'not-found' }`. Otherwise `target.send(IPC.attentionFocus, { itemId })` → `{ ok: true }`.
  - Use it for `onFocusItem` and for `attention.focusItem` in createHandlers deps (:550-558).
- **D4** Notifier deps: add `isViewed: (i) => transcripts.viewing().some((x) => x.accountId === i.accountId && x.sessionId === i.sessionId && viewers.isShown(x.viewer))`.
- **D5** `registerIpcHandlers(ipcMain, createHandlers({...}), { handlers: createViewerHandlers(transcripts), viewerOf: (id) => viewers.viewerOf(id) })`.
  Keep the `createHandlers({ version: app.getVersion(), ...` start: an existing regex test depends on it.
- **D6** `createWindowManager` deps (:577-600): add
  `onClosed: (w, spec) => { if (spec.kind !== 'main') transcripts.releaseViewer(viewerIdOf(w.senderId)) }`.

### §E renderer (exact list)
- **E1** `useAttentionStore.ts` `step` (:73-79): compute `id` as now. Then:
  `const route = window.api?.attention?.focusItem`. If `route` exists: `set({ focusedId: id })`, and
  `const r = await route(id).catch(() => null)`; if `r?.ok`, return. Otherwise fall back to `await get().focusItem(id)`.
  Nothing else in the file changes. `pushViewed` stays; main ignores it now.
- **E2** New `ReopenWindowsToggle.tsx`:
  - Reads `window.api?.windows?.getPrefs` in a `useEffect` (guard against setting state after unmount).
  - Renders `null` until loaded, or when getPrefs/setPrefs are missing.
  - Otherwise renders `<label className="ac-acc-sub"><input type="checkbox" .../> Reopen pop-out windows on start</label>`.
  - onChange: optimistic `setOn(v)`, then `setPrefs({ reopenOnStart: v })`; revert on `!ok` or rejection.
- **E3** `AppearanceRow.tsx`: import it and render `<ReopenWindowsToggle />` between the radiogroup `</div>` and the status `<p>`.

## Tests
All tests use neutral ids/names (fixtures acme/demo/other; viewer ids `'wc:2'`, `'wc:3'`). Any source-text test does
`.replace(/\r\n/g, '\n')` before matching (CRLF-safe).

1. `tests/main/transcripts/transcriptViewers.test.ts` (new). Copy `setup`/`boot`/`track` from
   `transcriptService.test.ts:43-108`. Collect `teams: Array<[TeamSnapshot, string]>` via `onTeam((s, v) => ...)`.
   Count reads with `fs.rangeCalls.filter((c) => norm(c.path) === norm(tree.paths.s4)).length`.
   - The default viewer behaves as before: boot → `snapshot()` is S1 and `getSelection()` is `{mode:'auto'}`.
   - Two viewers, two sessions: `select({mode:'session',accountId:'',sessionId:S4}, 'wc:2')` → `snapshot('wc:2')` is S4,
     `snapshot()` is still S1, and `getSelection()` is still auto. No push tagged `'main'` carries S4.
   - Shared session, no double parse: after 'wc:2' selects S4, the S4 readRange count is N. 'wc:3' selects S4 → the count
     is still N, and the returned snapshot is S4. `fs.append(tree.paths.s4, <line>)` + `emit('change', s4)` + flush(1000)
     → the count rises once (not twice), and both 'wc:2' and 'wc:3' get a push with the new content.
   - Release: `releaseViewer('wc:2')` while 'wc:3' still views S4 → tailing continues for 'wc:3'.
     `releaseViewer('wc:3')` → append + change + flush gives no new S4 readRange and no push tagged wc:2/wc:3;
     `viewing()` no longer lists them.
   - `releaseViewer(DEFAULT_VIEWER)` and unknown ids are no-ops (the main snapshot is still S1).
   - Auto per viewer (use the `execGit` from the existing project-key test at :520): 'wc:2'
     `select({mode:'auto', projectKey:'c:/users/u/other'})` → S4 while main stays S1. `onPtyChanged()` + flush keeps both.
   - A lazily created viewer: `snapshot('wc:9')` before any select returns empty. After flush(1500), a push tagged
     'wc:9' with S1 arrives (auto).
   - `ingestHook` for S4 while only 'wc:2' views it → the hook is applied (a 'wc:2' push after flush), and no 'main' push carries S4.
   - `viewing()` lists `{viewer, accountId, sessionId}` for each viewer that has a session.
   - After `dispose()`, no pushes.
2. The existing `tests/main/transcripts/transcriptService.test.ts` passes unchanged.
3. `tests/main/windows/viewers.test.ts` (new):
   - The router maps main's senderId and -1 to `'main'`, others to `'wc:N'`.
   - `windowOf` / `send` skip destroyed windows.
   - `isShown` is false when minimized.
   - Source-text check of `src/main/index.ts`: no `broadcast(IPC.teamChanged`; contains `createViewerHandlers(transcripts)`, `releaseViewer(` and `isViewed`.
4. `tests/main/windows/windowManager.test.ts` (add):
   - `onClosed` is called once with the closed secondary window's senderId and spec.
   - `focusProject(key, 'acc|sid')` prefers a matching chat window, then the project window, then main.
   - `window:get-prefs` returns `{reopenOnStart:true}`. `window:set-prefs({reopenOnStart:false})` → ok and the last
     saved state has `reopenOnStart:false`. Bad args → `invalid-args`.
5. `tests/main/ipcHandlers.test.ts` (add):
   - With scope: the 3 channels call the viewer handler with `viewerOf(event.sender.id)`; an event without sender gives `viewerOf(-1)`.
   - Invalid selection → empty snapshot, and select is not called.
   - Without scope: as today.
   - `attention:focus-item` validates (non-string / '' → invalid-args), delegates to `attention.focusItem`; the mock answers not-implemented.
6. `tests/main/attention/notifier.test.ts` (add):
   - `isViewed` true + focused → no toast.
   - `isViewed` true + not focused → toast.
   - When `isViewed` is given, `viewedProjectKey` is ignored.
   - The existing fallback tests still pass.
7. `tests/shared/windowSpec.test.ts`: update the `WINDOW_IPC` equality to include `getPrefs` / `setPrefs`.
   `tests/shared/ipcContract.test.ts`: `IPC.attentionFocusItem === 'attention:focus-item'`, it is an invoke channel and
   not a push channel, and the preload references `IPC.attentionFocusItem`, `WINDOW_IPC.getPrefs`, `WINDOW_IPC.setPrefs`.
8. `tests/renderer/attentionRouting.test.ts` (new):
   - With `api.attention.focusItem` resolving `{ok:true}`, `focusNext()` calls it with the first item id (inbox order),
     sets `focusedId`, and does NOT call `setProject` / `selectSession` locally.
   - With `{ok:false}` or a rejection, it falls back to local `focusItem`.
   - The existing `attentionStore.test.ts` focusNext tests (no api) stay green.
9. `tests/renderer/reopenWindowsToggle.test.tsx` (new):
   - The checkbox reflects `getPrefs`; clicking calls `setPrefs({reopenOnStart:false})`; it reverts on `{ok:false}`.
   - Renders nothing without `api.windows.getPrefs`.
   - AppearanceRow renders the toggle when the api exists.

## Acceptance
- All tests above pass, and every existing test is green (baseline: 109 files / 2433 tests). Run `npm test` 3x; no flaky file.
- `npm run typecheck` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and `npm run build` are green. No new dependencies.
- Manual check on the built app (two monitors), no real claude session started:
  - The main window on the 27" shows project A (auto). Pop out a chat for a session of project B to the 24" → the main
    window stays on A.
  - Open a project window for B → both windows update live, independently.
  - Close the pop-out → main is unaffected.
  - Ctrl+J in a chat window focuses the window of the needed item instead of switching the chat.
  - Uncheck "Reopen pop-out windows on start" in Accounts → Appearance, restart → only main opens.
- R-19: no code path in T36 sends to Claude or starts a session.

## Orchestrator-accepted defaults
- Toast suppression keeps the old "app focused" condition.
- Ctrl+J prefers a chat window for that exact session over the project window.
- A brand-new viewer starts in auto mode and gets a background pick before its first select.
