# Verify round 1: PASS

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | pass (exit 0; main, preload, renderer built; warnings only: outDir outside project root, inlineDynamicImports deprecated) |
| Tests | `npm test` | pass: 14 files, 197 tests (same counts from PowerShell run) |
| Lint/typecheck | `npm run typecheck` | pass (tsconfig.node, tsconfig.web, tsconfig.tests) |
| Offline (R-18) | `grep -rnoE "https?://\|fonts\.g" out/ \| head -5` | 5 hits shown (output capped), none is a network fetch or font CDN. All are inert strings in bundled library code: `out/renderer/assets/addon-fit-*.js:11` `http://bellard.org/jslinux/` (xterm comment); `out/renderer/assets/index-*.js:641` `https://reactjs.org/docs/error-decoder.html?invariant=` (React error text); `index-*.js:764,772,777` `http://www.w3.org/...` (SVG/XML namespace URIs). No `fonts.g` hit. Fonts are bundled as `.woff2`/`.woff` assets. |

## Failures by task
None.

## Notes
- The R-18 grep is not empty: the 5 shown hits are namespace/doc strings in xterm and React, not requests. Whether that counts as a pass for R-18 is for the reviewer to decide. A stricter check would exclude `w3.org` and doc links.
- Run from Git Bash (`cd /d/personal/claude-ui`) and PowerShell (`D:\personal\claude-ui`): both gave 14 files / 197 tests passing.
