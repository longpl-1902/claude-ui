# T11 — Organize sessions by git project (user request, 2026-11-19)

User feedback: "put all session chat in one screen is not appropriate and very hard to manage task. you should organize
it by git project". The flat session picker mixes every project (hawee-shop-revit, sdlc-kit, claude-ui…).

## Goal
The Team view is scoped to one **git project** at a time:
Header: `[Project ▾]  [Session ▾]` — pick the project first, then a session inside it.

## Behaviour
1. **Project identity (main).** For each SessionSummary with a `cwd`, resolve the git project:
   `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` → the main repo root is the parent of the common
   dir when it ends in `.git` (this maps linked worktrees such as `D:/personal/claude-ui-wt/T01` and
   `.claude/worktrees/*` to the main repo `D:/personal/claude-ui`). Not a git repo / git fails / cwd missing on disk →
   the project is the cwd itself (non-git folder). No cwd → the encoded projectDir.
   - Add to `SessionSummary`: `project?: { key: string; name: string; root: string; git: boolean }`.
     `key` = normalized root (forward slashes, lower-cased on win32), `name` = basename of root, `root` = display path.
   - Shell out with `execFile('git', [...], { timeout: 3000, windowsHide: true })`, async, cached per normalized cwd
     (cache invalidated only on app restart). Never block the session list: sessions without a resolved project yet get
     a provisional project from the cwd and are re-pushed when git answers. Never write anything.
2. **Selection.** `TeamSelection` auto mode gains an optional project: `{ mode: 'auto'; projectKey?: string }`.
   `pickAuto` filters candidates to that project when `projectKey` is set (same order as now: app's pty in that project
   → most recent live by transcript mtime → newest in 24 h; if the project has no session in 24 h, the newest session
   of that project regardless of age). With no `projectKey`, behaviour is unchanged.
3. **Renderer.**
   - Store: `projectKey: string | null`, `setProject(key)`; derived `projects` list = group `sessions` by
     `project.key`, each with `name`, `root`, `liveCount`, `lastActivityMs` (max mtime), sorted by lastActivityMs desc.
   - Initial project: the remembered one (localStorage `ac.projectKey`, wrapped in try/catch) if it still exists,
     else the project of the current auto pick, else the most recently active project.
   - Header: a **Project** `<select aria-label="Project">` showing `name · N live` (or `name` when none live), full
     root in `title`; then the **Session** select filtered to that project's sessions, label without the project name
     (`title · age · live`). "Auto (latest)" = `{mode:'auto', projectKey}`.
   - Changing project selects `{mode:'auto', projectKey}` and remembers the key.
   - Header stays one row at ≥1101px (project select shrinks with ellipsis before the chip; repo/team title keeps
     its tooltip).
4. **Edge cases.** Sessions with different accounts in the same repo stay in the same project. A project that
   disappears from the list keeps showing until another is chosen. Demo mode hides both pickers as today.

## Owned files
src/main/transcripts/projectResolver.ts (new), src/main/transcripts/sessionIndex.ts, src/main/transcripts/transcriptService.ts,
src/shared/types.ts, src/main/ipc/handlers.ts (only if selection validation needs projectKey),
src/renderer/src/store/useConsoleStore.ts, src/renderer/src/components/team/TeamHeader.tsx, teamLeft.css,
tests: tests/main/transcripts/{projectResolver,sessionIndex,transcriptService}.test.ts, tests/main/ipcHandlers.test.ts,
tests/renderer/{store.test.ts,teamLive.test.tsx,teamSections.test.tsx}.

## Acceptance
- projectResolver tests with an injected exec: worktree path → main root; plain repo; non-git → cwd; git error/timeout →
  cwd; cache hit does not re-exec; Windows case/slash normalization.
- pickAuto with projectKey: filters correctly, pty-in-project wins, falls back to newest in project beyond 24 h.
- Store/header tests: grouping + sorting + live counts; initial project choice order; changing project selects auto
  with that key and stores it; session select lists only that project; one-row CSS rule kept.
- `npm test`, `npm run typecheck`, `npm run build` all green. No new dependencies.
