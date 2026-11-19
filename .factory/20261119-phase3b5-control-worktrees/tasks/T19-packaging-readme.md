# T19 - Windows packaging check and README

- Wave: 8
- Depends on: T13, T18
- Spec refs: R-20, spec Phase 6 "packaging for Windows, README with setup steps"
- Tests: tests/bundleCheck.test.ts

## Goal
Make the Windows installer build produce what `.github/workflows/release.yml` uploads (`dist/*.exe`,
`dist/*.blockmap`, `dist/latest.yml`) with the hook script shipped, and write the README.

## Owned files
- modify: electron-builder.yml
- modify: scripts/check-bundle.mjs
- modify: tests/bundleCheck.test.ts
- create: README.md

## Read-only context
- .github/workflows/release.yml, .github/workflows/ci.yml, package.json scripts, docs/spec.md
- src/renderer/src/hooks/useShortcuts.ts (SHORTCUTS table), plan.md Verified facts + Decisions

## Notes
- electron-builder.yml: keep T13's `extraResources`; add `publish: { provider: github, owner: longpl-1902, repo:
  claude-ui }` (required for `latest.yml`; `--publish never` in the workflow prevents uploads) and
  `nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true }`. Do not add signing.
- check-bundle.mjs: also verify `resources/hook/agent-console-hook.cjs` exists, is CommonJS (`require(`), and contains
  no `console.` calls and no `writeFile`; keep the React/CSP checks. Update the test accordingly.
- README.md (English, neutral examples `C:/Users/u/acme`): what it is; requirements (Windows 10/11, Node 22+ for dev
  and for hooks, Claude Code CLI installed and signed in, git, VS Code optional); install from Releases; dev setup
  (`npm ci`, `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm run package:win`); first run
  (Accounts: detect, link, sign in; folder rules; safety toggles); Team view (project/session pickers, live vs demo,
  resizable panels); controlled sessions (start/resume/continue/fork, model/mode, permissions, interrupt/stop; note
  that **the app never sends anything to Claude unless you press Send/Allow/etc.**); external sessions (read-only,
  Stop process with confirmation); hooks (what Install writes, preview, Uninstall, endpoint file location, Node
  requirement, async hooks); worktrees/overlaps/tasks/timeline; keyboard shortcuts table (copy SHORTCUTS); privacy
  (no tokens read; files read and written); troubleshooting (claude not found, node-pty, hooks show n/a, git slow);
  known limits (from plan Later).
- README also covers: project rail (badges, pins, mute), Needs-you inbox (what can be answered in-app vs external),
  notifications (toast/taskbar, Do-not-disturb, per-project mute), per-project view memory.
- Toasts in packaged builds need AppUserModelID = `appId` (T13 sets it); keep `appId` unchanged; README
  troubleshooting notes that dev builds may show toasts as "Electron".
- Manual (orchestrator): `npm run package:win -- --publish never` then check `dist/AgentConsole-Setup-<v>.exe`,
  `.blockmap`, `latest.yml`, and that `resources/hook/agent-console-hook.cjs` is inside the unpacked app
  (`dist/win-unpacked/resources/hook/`).

## Acceptance commands
- npm test -- tests/bundleCheck.test.ts
- npm run build
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.
