# T12 — Resizable left and right panels (user request, 2026-11-19)

User: "you should let user resize the left and right panel. dont let it hard" (the side columns must not have fixed widths).

## Behaviour (wide layout, viewport ≥1101px)
- Two vertical splitters in the Team view: between the left column and the center, and between the center and the
  right column (inspector). Dragging a splitter with the mouse/pen (pointer events + setPointerCapture) changes that
  side column's width live; the center takes the rest.
- Limits: left 180–480 px (default 240), right 280–640 px (default 360); the center never drops below 420 px — clamp
  the dragged width so center ≥ 420 (recompute on window resize too, shrinking side widths if needed).
- Keyboard + a11y: each splitter is a focusable `<div role="separator" aria-orientation="vertical" tabIndex=0
  aria-label="Resize worktrees panel" / "Resize inspector panel" aria-valuemin/max/now aria-controls=<column id>>`.
  ArrowLeft/ArrowRight move 16 px (Shift = 64 px), Home/End go to min/max, Enter or double-click resets to default.
  Visible focus ring; hover/drag shows an accent-coloured 2 px line; cursor `col-resize`; hit area ≥ 6 px wide.
  Honour prefers-reduced-motion (no transitions).
- While dragging, disable text selection (`user-select: none` on the body) and restore it after.
- Persist widths per viewer in localStorage key `ac.panelWidths` = `{ left, right }`; every read/write wrapped in
  try/catch; invalid/missing values fall back to defaults and are clamped.
- Narrow layouts (≤1100 px) keep the current stacking behaviour; splitters are hidden there and widths are ignored.
- Apply widths via CSS custom properties on `.ac-team__cols` (`--ac-left-w`, `--ac-right-w`) with
  `.ac-team__left { flex: 0 0 var(--ac-left-w) }` and `.ac-team__right { flex: 0 0 var(--ac-right-w) }` inside the
  ≥1101px media block only.

## Files (owned)
src/renderer/src/components/layout/Splitter.tsx (new), src/renderer/src/components/layout/splitter.css (new),
src/renderer/src/hooks/usePanelWidths.ts (new), src/renderer/src/screens/TeamView.tsx, src/renderer/src/screens/TeamView.css,
tests/renderer/splitter.test.tsx (new), tests/renderer/teamView.test.tsx (only if a case breaks).
Do NOT touch TeamHeader, the store, inspector or team components (T11 runs in parallel).

## Acceptance
- Tests: keyboard moves/clamps/resets and updates aria-valuenow; pointer drag (fireEvent pointerdown/move/up with
  clientX) changes the width and the CSS variable; center-min clamp; localStorage persistence + corrupt value fallback
  + throwing storage; splitters have role separator + labels; existing Team view tests still pass.
- `npm test`, `npm run typecheck`, `npm run build` green. No new dependencies.
