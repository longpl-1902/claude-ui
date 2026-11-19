# Review round 2: PASS

Re-review of the round-1 fixes (review-1.md, orchestrator-findings-1.md). Diff `git diff 5393fec..HEAD` (25 files, fix merges 1ad4b74..df9d1a1). Verify-2 PASS. Re-run here: typecheck pass, `npm test` 15 files / 210 tests pass, `node scripts/check-bundle.mjs` on the current out/ prints OK (run from a lowercase `d:\` cwd), and `out/renderer/index.html` has 0 `localhost` hits.

## T01 - PASS
- Review item 1 (R-18, dev CSP shipped): resolved. `src/renderer/index.html:7` now has `connect-src 'self'`. `scripts/devCsp.ts` adds `ws://localhost:* http://localhost:*` through a `transformIndexHtml` plugin with `apply: 'serve'`, so it runs under `electron-vite dev` only. `preview` and `build` use the built file and the strict policy. The transform throws if the CSP meta is missing, so it cannot fail silently.
- Review item 2 (R-18 test): resolved. `tests/sanity.test.ts` checks that the CSP equals the production string exactly. It also tests the transform output, that the rest of the document is unchanged, `apply === 'serve'`, and the throw. `scripts/check-bundle.mjs` checks the built output too, and `npm run build` now runs it.
- Review item 3 (vite/client types): resolved. `src/renderer/src/env.d.ts` was added.
- Orchestrator item 1 (React bundled twice): resolved. `scripts/electron-vite.mjs` sets the cwd to its canonical spelling, and `electron.vite.config.ts` adds `resolve.dedupe: ['react','react-dom']`. `check-bundle.mjs` fails the build if it does not find exactly one `.Suspense=` definition. If React's output shape ever changes, the count drops to 0 and the build fails, so the check fails closed. `tests/bundleCheck.test.ts` covers one copy, two copies minified, copies split across chunks, and a localhost CSP. `package:win` now goes through `npm run build`, so packaging gets the same checks.
- Orchestrator item 2 (ELECTRON_RUN_AS_NODE): resolved. The variable is deleted from `process.env` before the electron-vite CLI is imported in the same process, and electron-vite starts Electron with that env. It works on every platform and adds no dependency. Verify-2 launched `preview` with `ELECTRON_RUN_AS_NODE=1` set, with no renderer errors.
- Orchestrator item 3 (Electron binary): resolved and explained. electron@45.4.1 has no `scripts` (no postinstall). Its `index.js` downloads the binary lazily, and electron-vite reads `path.txt` directly, so it never triggers that download. For `dev` and `preview`, the wrapper runs `node_modules/electron/install.js` with `process.execPath` and `spawnSync`. That call uses an argument array with no shell and no user input, and the script is the package's own local installer. It exits non-zero with a clear message if the binary is still missing.
- Safety of the wrappers: `vitest.mjs` and `electron-vite.mjs` only chdir to `realpathSync.native(cwd)`, rewrite argv and import a fixed bin path under node_modules. There is no shell, no interpolation and no swallowed errors. The new scripts are typechecked through `tsconfig.node.json`.

## T03 - PASS
- Item 1: `.ac-pill` is now `500 11px` with `padding: 3px 8px`, which matches the mockup.
- Item 2: Avatar accepts `size={20}` with 10px text. A test was added.

## T06 - PASS
- Item 1: the header chip uses `size={20}` in a circle. A test checks the 20px size.
- Item 2: the separator has `aria-hidden="true"` and uses the token `--ac-text-sep`. A test was added. The token is about 3.8:1 on #121417, which is fine for a separator marked decorative.

## T07 - PASS
- Item 1: the `@ts-ignore` is gone, and the CSS import now type-checks through vite/client.
- Item 2: the card uses `aria-labelledby` pointing at the name, and `aria-describedby` pointing at role, status, tool and target, and meta (worktree, elapsed, tokens, calls). R-10 content is now announced. The existing name-based queries still pass. Non-blocking: no test asserts the accessible description.

## T08 - PASS
- Item 1: `Inspector.tsx` gets the path from `team.worktrees.find(w => w.branch === agent.worktree)?.path`. If nothing matches, the button is `disabled` with a title and the click handler is guarded, so nothing is called.
- Item 2: the test asserts `toHaveBeenCalledWith('.worktrees/backend')`. A second test covers the disabled case (button disabled, title set, API not called).
- Non-blocking: the fix commit reformatted `Inspector.tsx` to double quotes and semicolons, which does not match the rest of the codebase. There is no formatter config enforcing either style, so this is not a FIX. Restoring the original style would shrink the diff.

## T09 - PASS
- Item 1: the radios are now native `<input type="radio" name="ac-acc-limit">` inside labels, so the browser gives one Tab stop and arrow-key selection. The input is visually hidden but still focusable, and the label shows a focus ring through `:has(:focus-visible)`. A new test checks that ArrowDown and ArrowUp change both selection and focus.

## T10 - PASS
- Orchestrator item 4 (viewport overflow): resolved for the wide layout (at least 1101px). `.ac-team` is `100vh` with `overflow: hidden`, and the columns use `nowrap`. The left column scrolls. In the center, the scroll area wraps the overlap banner, the agent grid and the timeline, and LeadConsole stays fixed below it (`flex-shrink: 0`). In the Inspector, only the tabpanel scrolls; the header, stats, task, tabs and actions stay visible. The duplicate padding, border and background of the nested `.insp` are cancelled inside `.ac-team__right`. At 1100px and below, the page goes back to stacked columns with normal page scroll. That matches R-14's collapse.
- Non-blocking: at the 600px minimum window height, the Inspector's fixed parts (header, stats, task, tabs, actions) could exceed the column and be clipped. Check this during the manual R-14 resize pass.

## T02 / T04 / T05 - PASS (unchanged since round 1)

## Still manual before sign-off
- R-14: resize below 1100px and below 700px, and check the 600px minimum height.
- R-16: compare side by side with the mockups.
- R-18: run the packaged or preview app with the network disabled. Verify-2 did not re-run the offline grep of `out/`, but the CSP and localhost checks are now automated in check-bundle.
