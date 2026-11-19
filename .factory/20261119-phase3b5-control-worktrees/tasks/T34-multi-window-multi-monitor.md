# T34 — Multiple windows across two monitors (user request, 2026-11-19)

User: "tôi thường sử dụng 2 màn hình. 1 cái 27 inch, cái 24 inch" — they work on two monitors (27" ≈ 2560×1440 and
24" ≈ 1920×1080, possibly different Windows scaling). Make it easy to spread the app over both.

Wave 12b — runs AFTER T31 (theme, which also edits window creation) and BEFORE T32 (declutter review).

## Behaviour
1. **Pop-out windows.** Besides the main window, the user can open secondary windows of two kinds:
   - **Chat window** for one session (`kind: 'chat', projectKey, sessionRef`): the T33 Chat view + composer only.
   - **Project window** (`kind: 'project', projectKey`): the full Team view pinned to that project (no project rail;
     header shows the project; the needs-you button still opens the global inbox).
   Open via: a "Open in new window" button in the Chat tab header and in the project rail context menu, Ctrl+Shift+N
   (current project/chat), and dragging the Chat tab out of the tab strip (dragend outside the window → pop out).
   Closing a secondary window never stops sessions. Max 8 secondary windows.
2. **One source of truth.** Main process owns all data; every window subscribes to the same pushes. Answering a
   permission, sending a message or switching state in one window updates all others (stores re-hydrate from IPC;
   R-19 unchanged — no window sends anything without an explicit user action in THAT window). A controlled session's
   composer draft lives per window.
3. **Window placement memory.** Persist per window (main + each secondary, keyed by kind+projectKey(+session)) in
   userData `windows.json`: displayId, bounds, maximized, zoom. On start, restore main + the secondary windows that
   were open at quit (setting "Reopen windows on start", default on). Validate against `screen.getAllDisplays()`: if
   the saved display is gone or bounds are off-screen, move the window to the primary display's work area (keep size
   if it fits, else 90 %). Listen to `screen` 'display-removed' / 'display-metrics-changed' and rescue windows live.
4. **Mixed DPI.** Use Electron per-monitor DPI awareness (default); never hard-code px for window sizes in DIP math
   beyond min sizes; ensure layout breakpoints use CSS px so moving a window between a 100 % and a 125/150 % monitor
   re-lays out correctly; no blurry canvas (timeline draws with devicePixelRatio).
5. **Notifications & focus.** A toast click / Ctrl+J focuses the window that shows that project (project window first,
   else main, switching main to that project); flashFrame/overlay applies to that window; the taskbar overlay count
   stays on the main window.
6. **Window menu / switcher.** Ctrl+K switcher (T22) lists open windows too ("Window: Chat · acme / lead"); a small
   "Windows" section in the ? help lists shortcuts. Ctrl+W closes a secondary window (never the main one without the
   normal close).

## Owned files
src/main/windows/ (new: windowManager.ts, placement.ts, persistence), main window creation in src/main/index.ts
(window creation/restore only — coordinate with T31's theme/titlebar options, keep them), IPC channels
`window:open`, `window:list`, `window:focus`, push `window:changed` (src/shared/ipc.ts, types, preload, handlers),
renderer entry routing by window kind (src/renderer/src/main.tsx/App.tsx window-kind switch only), Chat-tab "open in
new window" button + drag-out handler (T33 files: the tab strip + ChatView header only), rail context-menu item
(T22 file: one menu item only), tests: tests/main/windows/{placement,windowManager}.test.ts,
tests/renderer/windowKinds.test.tsx, contract cases.

## Acceptance
- placement tests: restore on same display; display removed → moved to primary work area; partially off-screen →
  clamped; size larger than work area → 90 %; mixed scale factors handled (bounds are DIP).
- windowManager tests (fake BrowserWindow + screen): open/focus/dedupe by key, max 8, persistence on move/close,
  reopen-on-start, close secondary keeps sessions.
- Renderer: window kind routing renders Chat-only / Project-pinned views; actions in one window reflected via pushes.
- Built app checked on the user's two monitors (manual): pop a chat to the 24" screen, restart → reopens there;
  unplug/disable the second monitor → window comes back to the primary.
- `npm test`, `npm run typecheck`, `npm run build` green. No new dependencies.
