# Orchestrator findings, round 1 (from launching the built app)

Read together with review-1.md. All items are FIX.

## T01
1. BLANK WINDOW: `npm run build` run from a lowercase-drive cwd (Git Bash `cd /d/personal/claude-ui`, cwd `d:\...`) bundles React twice into out/renderer/assets/index-*.js (14 `__SECRET_INTERNALS` hits vs 4 when built from `D:\`). Renderer then throws "Cannot read properties of null (reading 'useCallback')" and the window is blank. Same root cause as the vitest issue fixed by scripts/vitest.mjs. `dev`, `build`, `preview`, `package:win` must all produce one React regardless of cwd case (e.g. same canonical-cwd wrapper for electron-vite, and/or resolve.dedupe ['react','react-dom'] in electron.vite.config.ts). Add a test or check script that fails if the built bundle contains React twice.
2. ELECTRON_RUN_AS_NODE: shells spawned from VS Code / Claude Code inherit `ELECTRON_RUN_AS_NODE=1`, so `npm run dev` / `preview` start Electron as plain Node and crash ("Cannot read properties of undefined (reading 'whenReady')"). dev/preview scripts must delete ELECTRON_RUN_AS_NODE from the env before launching Electron (cross-platform, no new deps if possible).
3. Electron binary missing after the first install (node_modules/electron/dist absent → "Electron uninstall"). Verify a clean `npm ci` downloads it (electron postinstall runs); if anything in the setup skips scripts, fix it. Report what you found.

## T10
4. Team view overflows the window height at 1936x1064: the whole page scrolls, so the lead console prompt input and the inspector's Pause / Stop buttons are cut off below the fold. The app shell should fill the viewport (100vh) with the columns scrolling internally (left list, center, inspector body), keeping the header, the console prompt and the inspector actions visible, as in docs/design/team-view.mockup.html.
