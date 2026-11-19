# T03 - Design tokens, bundled fonts, global styles, UI primitives

- Wave: 2
- Depends on: T01
- Spec refs: R-06, R-18
- Tests: tests/renderer/ui.test.tsx

## Goal
Create the visual foundation every screen uses:
- CSS custom-property tokens taken from the spec and mockups.
- Locally bundled Inter and JetBrains Mono.
- Global reset with focus and reduced-motion handling.
- A TS color map for data-driven colors.
- Four primitives: Button, StatusPill, Avatar and Icons.

## Owned files
- create: src/renderer/src/styles/tokens.css
- create: src/renderer/src/styles/global.css
- create: src/renderer/src/theme/colors.ts
- create: src/renderer/src/components/ui/Button.tsx, StatusPill.tsx, Avatar.tsx, Icons.tsx, ui.css
- create: tests/renderer/ui.test.tsx
- modify: src/renderer/src/main.tsx (add imports only)

## Read-only context
- docs/spec.md, section "Design tokens"
- docs/design/team-view.mockup.html lines 372-379 (global CSS: pulse keyframes, .ac-btn hover, .ac-card hover), lines 383-408 (header buttons and chip styles), 620-627 (ST status meta, TOOL colors, SEG colors)
- docs/design/accounts.mockup.html lines 372-376, 388 (primary button #8FB4FF)
- src/shared/types.ts

## Notes
- **Fonts (R-18).** In main.tsx, import `@fontsource/inter/400.css`, `500.css`, `600.css` and `700.css`, plus `@fontsource/jetbrains-mono/400.css` and `500.css`, then `./styles/tokens.css` and `./styles/global.css`, all before App. No Google Fonts or any remote URL.
- **tokens.css** (`:root`). Use these names exactly, because other tasks reference them:
  - Backgrounds:
    - `--ac-bg-app: #0E0F11`
    - `--ac-bg-panel: #121417`
    - `--ac-bg-card: #16181C`
    - `--ac-bg-console: #0B0C0E`
    - `--ac-bg-inset: #0E0F11`
    - `--ac-bg-btn: #1A1D22`
    - `--ac-bg-btn-hover: #242830`
    - `--ac-bg-selected: #1A2030`
  - Borders:
    - `--ac-border: #23262C`
    - `--ac-border-card: #262A31`
    - `--ac-border-btn: #2E323A`
    - `--ac-border-inset: #1F2227`
    - `--ac-border-hover: #4A5160`
    - `--ac-border-dashed: #3A3F48`
  - Text:
    - `--ac-text: #E6E7EA`
    - `--ac-text-muted: #A4AAB4`
    - `--ac-text-subtle: #8E95A0`
    - `--ac-text-soft: #C9CDD4`
    - `--ac-text-code: #D5D8DE`
    - `--ac-text-branch: #A9B4C6`
    - `--ac-text-dim: #858C97` (mockup #7D848F, nudged for contrast)
    - `--ac-text-faint: #7F8691` (mockup #6E7580)
    - `--ac-text-sep: #6B727D` (mockup #5C636E; decorative separators only)
  - Accent:
    - `--ac-accent: #7AA7FF`
    - `--ac-accent-hover: #A9C6FF`
    - `--ac-accent-2: #8FB4FF` (Accounts primary buttons)
  - Status (each with a `-bg` pill background):
    - running `#F2A541` / `#2E2415`
    - waiting `#8FB4FF` / `#18213A`
    - needs-you `#FF8A8A` / `#361A1C`
    - done `#5ED3A8` / `#14302A`
    - Names: `--ac-status-running`, `--ac-status-running-bg`, and so on for each status.
  - Accounts: `--ac-account-company: #6E9BF0` and `--ac-account-personal: #F2A541`.
  - Warning: `--ac-warn-bg: #2A1F14`, `--ac-warn-border: #5A3E1E`, `--ac-warn-text: #F5C98A`, and `--ac-flow-bg: #1D1812` (sign-in panel).
  - Danger: `--ac-danger-border: #5A2A2A`.
  - Segments:
    - `--ac-seg-think: #3A4150`
    - `--ac-seg-read: #5C6370`
    - `--ac-seg-edit: #6E9BF0`
    - `--ac-seg-bash: #A77FEF`
    - `--ac-seg-wait: #252930`
    - `--ac-seg-error: #FF8A8A`
  - Radii: `--ac-radius-control: 8px`, `--ac-radius-sm: 6px`, `--ac-radius-card: 10px`, `--ac-radius-panel: 12px`, `--ac-radius-pill: 999px`.
  - Fonts: `--ac-font-ui: Inter, system-ui, sans-serif` and `--ac-font-mono: 'JetBrains Mono', ui-monospace, monospace`.
- **global.css**:
  - `html, body, #root { height: 100% }`.
  - body: margin 0, background `--ac-bg-app`, color `--ac-text`, font `--ac-font-ui` at 14px, antialiased.
  - `*, *::before, *::after { box-sizing: border-box }`.
  - Links use `--ac-accent`, and `--ac-accent-hover` on hover.
  - `:focus-visible { outline: 2px solid var(--ac-accent); outline-offset: 2px }`.
  - `.ac-mono { font-family: var(--ac-font-mono) }`.
  - `@keyframes ac-pulse`, copied from mockup line 375, plus `.ac-pulse { animation: ac-pulse 1.6s infinite }`.
  - `@media (prefers-reduced-motion: reduce) { .ac-pulse { animation: none } * { transition: none !important } }`.
  - `.ac-visually-hidden` utility.
  - `h1, h2, h3, p { margin: 0 }`.
- **theme/colors.ts**: export the following.
  - `STATUS_META: Record<AgentStatus, { label: string; color: string; bg: string; pulse: boolean }>`. Labels are 'Running', 'Waiting', 'Needs you' and 'Done'. Only running pulses.
  - `TOOL_COLORS: Record<string, string>`, from mockup line 626, plus `Done: '#5ED3A8'`.
  - `toolColor(tool)`, with default '#A4AAB4'.
  - `SEGMENT_COLORS: Record<ActivityKind, string>`.
  - `TIMELINE_LEGEND: { label: string; kind: ActivityKind }[]`: Thinking/think, 'Read / Grep'/read, Edit/edit, Bash/bash, Error/error.
  - `ACCOUNT_FALLBACK_COLOR = '#5C636E'` (the "Ask me" dot).
  - Hex values must equal the tokens.
- **Primitives.** Props are fixed; screen tasks depend on them.
  - `Button({ variant?: 'secondary' | 'primary' | 'accent2' | 'warn' | 'danger' | 'ghost' | 'dashed' | 'icon', size?: 'sm' | 'md' | 'lg', ...ButtonHTMLAttributes })`.
    - Always renders `<button type="button">` unless a type is passed.
    - Heights: sm 32px, md 36px, lg 40px.
    - Variants:
      - secondary: bg-btn, border-btn border, hover bg-btn-hover.
      - primary: bg accent, text #0E0F11, weight 600.
      - accent2: bg #8FB4FF.
      - warn: bg #F2A541, dark text.
      - danger: bg-btn with danger border and needs-you text.
      - ghost: transparent bg.
      - dashed: dashed border-dashed.
      - icon: 28x28, radius 6.
    - Classes are `ac-btn ac-btn--<variant> ac-btn--<size>`.
  - `StatusPill({ status: AgentStatus })`: renders a span `.ac-pill` with a dot (`.ac-pulse` when running) and the text label. The text label is always present (R-06). The dot is `aria-hidden`.
  - `Avatar({ initials: string; color: string; size?: 30 | 40; shape?: 'rounded' | 'circle' })`: rounded radius 8 at 30px, 10 at 40px. Dark text #0E0F11, weight 700. `aria-hidden` by default. Pass `label` to make it labelled.
  - `Icons.tsx`: named exports TerminalIcon, BranchIcon, WarningIcon, ChevronDownIcon, ChevronLeftIcon, FolderIcon, RefreshIcon, LockIcon, CheckIcon. Each takes `{ size?: number; color?: string }`. Copy the SVG paths from the mockups: team-view lines 385, 395, 421 and 451; accounts lines 382, 405, 414, 423 and 478. All `aria-hidden="true"`, with stroke `currentColor` by default.
- ui.css holds the primitive styles only.
- **Test** (jsdom docblock):
  - StatusPill renders 'Running', 'Waiting', 'Needs you' and 'Done'.
  - The running pill has an `.ac-pulse` dot.
  - Button defaults to `type="button"` and forwards onClick.
  - Avatar renders its initials.

## Acceptance commands
- npm test -- tests/renderer/ui.test.tsx
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass.
- `out/renderer` contains `.woff2` files and no `fonts.googleapis` / `fonts.gstatic` strings. Check with grep and report the result.
- Only owned files changed.
