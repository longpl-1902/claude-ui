# Review round 1: FIX

Base 5a26f5b, diff `git diff 5a26f5b...HEAD` (77 files). Verify-1 PASS (build, 197/197 tests, typecheck).

## T01 - FIX
1. [R-18] The packaged app ships the dev CSP. `src/renderer/index.html:7` is the only CSP, and the build copies it unchanged: `out/renderer/index.html:7` contains `connect-src 'self' ws://localhost:* http://localhost:*`. R-18 says localhost connect is allowed in dev only. Correct: `index.html` carries the production CSP with `connect-src 'self'`. Add a small renderer plugin in `electron.vite.config.ts` (`apply: 'serve'` plus `transformIndexHtml`) that appends `ws://localhost:* http://localhost:*` to connect-src only under `npm run dev`. Then `npm run build` must produce an `out/renderer/index.html` with no `localhost`.
2. [R-18 test] `tests/sanity.test.ts:17` strips `http://localhost` before checking, so it passes on the leak above. Correct: assert that the source CSP's `connect-src` is exactly `'self'`. Unit-test the dev plugin's transform so it adds localhost only in serve mode, for example by exporting the transform function from a small module the config imports.
3. [Shortcuts, enables the T07 fix] There is no Vite client typing for the web tsconfig, which is why T07 needed `@ts-ignore`. Correct: add `src/renderer/src/env.d.ts` with `/// <reference types="vite/client" />`. It is already inside the `tsconfig.web.json` include `src/renderer/src/**/*`.
- Window security is fine:
  - contextIsolation is on, nodeIntegration is off, sandbox and webSecurity are on.
  - `setWindowOpenHandler` denies, and `will-navigate` blocks any URL other than the current one.
  - The dev URL is used only when `!app.isPackaged`, and production uses `loadFile`.
  - The preload bundle requires only `"electron"` and exposes only typed `invoke` / `on` wrappers over channel constants. It does not expose raw `ipcRenderer`.

## T02 - PASS

## T03 - FIX
1. [R-16 vs team-view.mockup.html:470,557] The StatusPill typography differs from the mockup. `ui.css` `.ac-pill` uses `font: 600 12px` and `padding: 3px 10px`, and the mockup pill is 11px, weight 500, padding 3px 8px. Correct: match the mockup values.
2. [R-16 vs team-view.mockup.html:392] Avatar cannot render the header chip's 20 px avatar. `Avatar.tsx:6` restricts `size` to `30 | 40`. Correct: add `20` to the union, with font-size 10px for that size, so T06 can use it.

## T04 - PASS

## T05 - PASS

## T06 - FIX
1. [R-16] `TeamHeader.tsx:35` uses a 30 px avatar inside a chip with `min-height: 32px`, but the mockup has a 20 px circle with 10 px text. Correct: `size={20}`, which needs T03 item 2.
2. [Accessibility: contrast and decorative text] The header separator is the hard-coded `#5C636E` (`teamLeft.css:5`). That is 3.16:1 on `#121417`, below the spec's 4.5:1, and the separator is not marked decorative. Correct: give the separator span (`TeamHeader.tsx:26`) `aria-hidden="true"`, as `AccountsHeader.tsx` already does, and use a token instead of the raw hex.

## T07 - FIX
1. [Shortcuts] `RawTerminalPane.tsx:14` uses `// @ts-ignore` on `import('@xterm/xterm/css/xterm.css')`. Correct: remove the `@ts-ignore` once T01 item 3 lands. The CSS import then type-checks through `vite/client`.
2. [Accessibility, R-10] `AgentCard.tsx:20` sets `aria-label` to "name, status". That replaces the button's whole content for screen readers, so they never hear the current tool call, target, worktree, tokens or call count, which R-10 requires the card to show. Correct: drop the `aria-label`, so the visible text is the accessible name. Or keep a short name with `aria-labelledby` and point `aria-describedby` at the tool and meta spans. Update the tests that query by name.

## T08 - FIX
1. [R-11, IPC interface `worktree:open-in-editor(path)`] `Inspector.tsx:117` passes `agent.worktree`, which is a branch name (`types.ts:47`, for example `feat/backend-auth`), as the path. Phase 2 would then run `code feat/backend-auth`. Correct: resolve the path with `team.worktrees.find(w => w.branch === agent.worktree)?.path`. If no worktree matches, disable the button or skip the call.
2. [Tests] `tests/renderer/inspector.test.tsx:141` asserts only `toHaveBeenCalledTimes(1)`, which is why item 1 slipped through. Correct: `toHaveBeenCalledWith('.worktrees/backend')`.

## T09 - FIX
1. [Accessibility: keyboard navigable] `AccountPolicies.tsx:36-50` uses `role="radiogroup"` with `role="radio"` buttons. All three are separate Tab stops and arrow keys do nothing, which breaks the ARIA radio pattern that the roles announce. Correct: either use native `<input type="radio" name="limit">` inside styled labels, or add a roving tabindex (only the checked radio is `tabIndex=0`) with ArrowUp/Down/Left/Right selecting and focusing. Add a test that ArrowDown moves the selection.

## T10 - PASS

## Judgements on the orchestrator's questions
- **R-18 grep hits in out/:** acceptable. They are the React error-decoder URL, xterm comments (bellard.org, term.js) and SVG/XML/MathML namespace URIs. None is fetched, and there is no `fonts.g` or CDN asset. The only real R-18 hit is `index.html` `localhost` (T01 item 1).
- **Console log capped at 280px:** acceptable. It keeps the center column bounded and matches the raw terminal height.
- **tests/renderer/jestDom.ts:** acceptable to keep. It is harmless and still imported by 7 files. The comment in `vitest.config.mts` (which says files import `@testing-library/jest-dom/vitest`) is stale. Optional cleanup, not a FIX.
- **Focus-visible, reduced motion, tokens, fonts and the Inspector tabs** are all fine:
  - Global `:focus-visible` outline.
  - `prefers-reduced-motion` stops the pulse and transitions.
  - Token hex values match the spec.
  - Fonts come from local @fontsource.
  - The Inspector tabs have a roving tabindex with arrow keys.
  - The Team view has a skip link.
  - The faint tokens #7F8691 and #858C97 are at least 4.8:1 on their backgrounds.
- **Tests:** they are behavioural (store transitions, clicks, IPC call args, status rules) and none are skipped. Gaps: the openInEditor argument (T08 item 2), the CSP leak (T01 item 2), and there is no radio keyboard test (T09).
- **Manual criteria still open:** R-14 (resize), R-16 (side-by-side visual check), and R-18 (run the built app with the network disabled).
