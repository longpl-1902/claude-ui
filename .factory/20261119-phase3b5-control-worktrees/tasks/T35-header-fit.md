# T35 — Header never overflows (user-confirmed bug on the 24" monitor, 2026-11-19)

User: "khi bật app trên 24 inch bị tràn thật" — on the 24" screen the header overflows (Pause all / account chip cut).
Runs right after T31 (theme), before T34.

## Behaviour
- Measure-based overflow: a ResizeObserver on the header measures available width vs. the natural width of each
  item; items are moved into the existing "…" overflow menu in this priority order until everything fits:
  1 "older history not loaded" note (→ becomes a small info icon with tooltip first), 2 Tokens (session), 3 Tokens
  today, 4 counters (agents / running / needs-you-in-session), 5 Hooks, 6 Extensions, 7 Pause all in <project>,
  8 + New session. Never moved: brand (may shrink to icon), team title (ellipsis, min ~120 px), LIVE/DEMO badge,
  session picker (shrinks, min ~160 px), "● N need you", account chip (ellipsis, min ~120 px).
- Hysteresis (~24 px) so items don't flicker in/out while resizing; recompute on font/zoom/DPI change.
- Overflow menu items keep their full labels + keyboard access; the "…" button shows a dot when it contains an
  item with a non-zero count.
- No horizontal page scroll at any width ≥ 900 px; header stays one row.

## Owned files
src/renderer/src/components/team/TeamHeader.tsx, a new src/renderer/src/hooks/useOverflowItems.ts, the header CSS
(after T31 merged — use its tokens), tests/renderer/headerFit.test.tsx (+ minimal updates to header tests).

## Acceptance
- Tests (mock ResizeObserver + element widths): at 1366 / 1536 / 1920 px the visible set matches the priority order and
  the sum fits; hysteresis; overflow menu contains exactly the hidden items; "never moved" items always present.
- Built app checked by the orchestrator at 1536 and 1920 px windows (screenshots): nothing clipped.
- `npm test`, `npm run typecheck`, `npm run build` green.
