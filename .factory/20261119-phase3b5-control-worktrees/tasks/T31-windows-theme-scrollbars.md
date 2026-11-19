# T31 — Follow the Windows theme, nicer scrollbars, window chrome (user request, 2026-11-19)

User: "giao diện sẽ theo theme window. tôi thấy scroll chưa đẹp lắm." → the UI follows the Windows theme (light/dark +
accent) and scrollbars must look good.

Wave 12 (after all feature waves) — this task is the single owner of all renderer CSS/colour files in its wave.

## Behaviour
1. **Light + dark themes.** Keep the spec's dark tokens as the dark theme; add a light theme with equivalent roles
   (bg app / panel / card, borders, text, muted, accent, status colours running/waiting/needs-you/done, account
   colours) — every text/background pair ≥ 4.5:1 (UI icons/borders ≥ 3:1) in BOTH themes; status colours stay paired
   with text labels. Implement as CSS custom properties on `:root` (dark) and `:root[data-theme="light"]`.
2. **Follow Windows.** Main: `nativeTheme.shouldUseDarkColors` + `nativeTheme.on('updated')` → push `theme:changed`
   ({ mode: 'light'|'dark', accent: '#RRGGBB'|null, highContrast: boolean }) to the renderer; renderer sets
   `data-theme` on <html>. Accent: `systemPreferences.getAccentColor()` on win32 (RRGGBBAA → #RRGGBB), listen to
   `accent-color-changed`; use it for `--ac-accent` only if it meets 3:1 against the panel bg in the current theme,
   else keep the default accent. Windows high contrast (`nativeTheme.shouldUseHighContrastColors`) → honour
   `forced-colors` (no custom colours that break it). Settings toggle in the app: Theme = System (default) / Light /
   Dark, persisted (localStorage, try/catch) — "System" follows Windows live.
3. **Window chrome.** `BrowserWindow`: `backgroundColor` per theme at creation (no white flash), `titleBarStyle:
   'hidden'` + `titleBarOverlay: { color, symbolColor, height: 36 }` updated on theme change via
   `win.setTitleBarOverlay`; on Windows 11 `backgroundMaterial: 'mica'` (feature-detect; fall back silently) with the
   app background slightly translucent only where readable. The header becomes the drag region
   (`-webkit-app-region: drag`; all buttons/inputs `no-drag`); keep keyboard focus order intact.
4. **Scrollbars.** One global style (`::-webkit-scrollbar` family + `scrollbar-color/width` for future-proofing): thin
   (8 px), rounded thumb, transparent track, thumb colour from tokens at low contrast that strengthens on hover/active;
   no arrow buttons; overlay-like look inside panels (padding so content isn't hidden); horizontal bars only where
   horizontal scroll is legitimate (terminal). Respect forced-colors (use system scrollbars there).
5. **Sweep hard-coded colours.** Replace hex/rgb literals in renderer .tsx/.ts/.css (≈48 found: src/renderer/src/**
   outside tokens.css, plus src/renderer/src/theme/colors.ts) with tokens; xterm theme (TerminalView) follows the
   theme too (ITheme from tokens, updated live).
6. **Mockup fidelity** stays for dark; light is a faithful counterpart (same layout/spacing).

## Owned files
src/renderer/src/styles/{tokens,global}.css, src/renderer/src/theme/**, every renderer .css/.tsx that contains
hard-coded colours (colour edits only), src/renderer/src/components/terminal/TerminalView.tsx (theme only),
src/main/theme.ts (new), main window creation in src/main/index.ts (window options + theme wiring only),
src/shared/ipc.ts + src/shared/types.ts + src/preload/index.ts (theme channel only), a small Theme setting control
(placed where T32/the Accounts or settings area agrees — default: Accounts screen "Appearance" row + Ctrl+Shift+L
cycles System/Light/Dark), tests: tests/renderer/theme.test.tsx (new), tests/main/theme.test.ts (new), contract case.

## Acceptance
- Tests: token contrast checker over both themes (compute WCAG ratios from the token values → all text pairs ≥ 4.5);
  no hex literals left in renderer components (grep test, allow-list tokens.css/theme files); theme push updates
  data-theme; accent fallback when contrast is too low; persisted override; xterm theme switches.
- Built app checked on real Windows in light and dark (toggle Windows setting or the in-app override): screenshots,
  no white flash, title bar matches, scrollbars thin and readable.
- `npm test`, `npm run typecheck`, `npm run build` green. No new dependencies.
