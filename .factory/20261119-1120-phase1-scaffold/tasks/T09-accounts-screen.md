# T09 - Accounts screen (all sections) and its smoke test

- Wave: 5
- Depends on: T04
- Spec refs: R-12, R-13, R-15, R-16, R-17
- Tests: tests/renderer/accountsView.test.tsx

## Goal
Replace the AccountsView stub with the full Accounts screen, built from the store. It covers:
- The header with the back link.
- The intro.
- Detected logins and the sign-in flow panel.
- The privacy line.
- Account cards.
- The folder rules table.
- Safety toggles.
- The usage-limit policy.
- Running now.

Everything runs on mock state, with no file or network access.

## Owned files
- modify: src/renderer/src/screens/AccountsView.tsx
- create: src/renderer/src/screens/AccountsView.css
- create: src/renderer/src/components/accounts/AccountsHeader.tsx
- create: src/renderer/src/components/accounts/DetectedLogins.tsx (includes the sign-in flow panel and the privacy line)
- create: src/renderer/src/components/accounts/AccountCards.tsx
- create: src/renderer/src/components/accounts/FolderRules.tsx
- create: src/renderer/src/components/accounts/AccountPolicies.tsx (Safety and "When an account hits its usage limit")
- create: src/renderer/src/components/accounts/RunningNow.tsx
- create: tests/renderer/accountsView.test.tsx

## Read-only context
- docs/design/accounts.mockup.html:
  - 372-376 (link and button css)
  - 378-389 (header)
  - 391-396 (main width 1120 and intro)
  - 398-435 (detected logins)
  - 437-475 (sign-in flow)
  - 477-480 (privacy line)
  - 483-522 (account cards)
  - 524-550 (folder rules)
  - 552-569 (safety and limit policy)
  - 571-584 (running now)
  - 589-664 (state logic: stepState, accounts mapping, limit opts text)
- docs/spec.md, section "Screen 2: Accounts"
- src/renderer/src/store/useConsoleStore.ts, src/renderer/src/components/ui/*, src/renderer/src/theme/colors.ts, src/shared/format.ts

## Notes
- Keep `export function AccountsView()` with no props. Its layout is `<div className="ac-accounts">` containing `<AccountsHeader/>` and a `<main>` with max-width 1120, centered, padding `28px 20px 48px`, gap 32.
- **AccountsHeader**:
  - The 3px top border uses the active account color.
  - A `<button>` styled as a link: ChevronLeft and "Team view", calling `navigate('team')`.
  - A '/' separator, then "Accounts" (700, 15px), a spacer, and the Button accent2 "+ Add account" (no-op).
- Intro:
  - h1 "Claude accounts" (24px).
  - The paragraph from mockup line 395, verbatim.
- **DetectedLogins**: a panel with bg-panel and radius 12.
  - Header: h2 "Detected logins", the subtitle "Found on this computer from the VS Code extension and the Claude Code CLI", and the Button secondary "Scan again" with RefreshIcon (no-op).
  - Each detected row:
    - A FolderIcon tile.
    - The configDir in mono 13px 500.
    - The "who" line: `{email} · {org}` when signedIn; otherwise "Folder set in VS Code, not signed in yet" in warn text.
    - `Found in: {sources.join(', ')}`.
  - Row action:
    - If linkedAccountId is set: a green pill with CheckIcon, "Linked as {account name}".
    - Else if signedIn: Button accent2 "Use this", calling `linkDetected(configDir)`.
    - Else: Button warn "Sign in", calling `startSignIn(configDir)`.
  - Sign-in panel, shown when `signIn.panelOpen && signIn.step !== 'none'`. It has warn border and flow bg.
    - Three steps: `Folder {configDir}`, "Sign in on claude.ai" and "Ready to use", separated by '—'.
    - Step ring and fill colors follow `stepState` at mockup lines 608-613 (current step index is 1 while waiting, 3 when done).
    - Mark the current step with `aria-current="step"`, inside an `<ol>`.
    - While waiting:
      - Title "Finish signing in your browser".
      - The text from line 452.
      - A mono command box `CLAUDE_CONFIG_DIR={configDir} claude  ›  /login`.
      - Buttons: warn "Check now" (`finishSignIn`), secondary "Open browser again" (no-op) and ghost "Cancel" (`cancelSignIn`).
    - When done:
      - A check circle.
      - "Signed in as {email}".
      - "Saved as “{account name}”. Folders under {that account's first rule pattern without /**}/ will use it."
      - A "Done" button (`closeSignInPanel`).
    - The panel has `aria-live="polite"`.
  - Privacy line, with LockIcon, verbatim: "Agent Console reads only the email and organization name. Login tokens stay where Claude Code stored them."
- **AccountCards**: a grid of `repeat(auto-fit, minmax(320px, 1fr))`, gap 16.
  - Each card: border in the account color if it is the default, otherwise border-card. Radius 12, padding 20.
    - Header: a circle avatar (40) with the initial, the name, the email, and a "Default" badge when it is the default.
    - Field grid:
      - "Plan", ONLY when `plan` is defined (spec: hide when unavailable).
      - "Status": "Signed in" (done color) or "Not connected" (muted).
      - "Config folder" (mono, full row).
  - Usage, per the SPEC GAP in plan.md: NO percentage bars.
    - If signedIn and `tokensToday` is defined: "Tokens used today" with `formatTokens(tokensToday)`.
    - If signedIn without a value: "Usage not available".
    - If not signedIn: "Sign in from Detected logins above to see usage."
  - Buttons:
    - "Set as default" (`setDefaultAccount`; disabled when it is already the default).
    - "Sign in again" (calls `startSignIn(configDir)`).
    - "Rename & color" (no-op).
- **FolderRules**:
  - h2 "Pick the account by folder" with the hint "First matching rule wins when you open a repo or start a team".
  - A real `<table>` (min-width 560, in an overflow-x wrapper) with headers "Folder pattern", "Account" and "Note".
  - The account cell shows a colored dot and the name. 'ask' shows "Ask me" with `ACCOUNT_FALLBACK_COLOR`.
  - The Button dashed "+ Add rule" is a no-op.
- **AccountPolicies**: a two-card grid.
  - **Safety**: three real checkboxes, bound to `safety` and `toggleSafety`, labelled with the texts from lines 555-557 verbatim. accent-color is #8FB4FF.
  - **When an account hits its usage limit**: a `role="radiogroup"` with three options (texts from lines 641-643). Each is a `role="radio"` with `aria-checked`, or a real input radio styled to match.
    - Selected styling: border #8FB4FF, bg-selected, ring and dot.
    - Selecting calls `setLimitPolicy`.
- **RunningNow**:
  - h2 "Running now".
  - Rows: a colored dot, the team name (500), the path in mono, a spacer, and `{account name} · {n} agent(s)`.
- Styles go in AccountsView.css with `ac-acc-` prefixed classes.
- Test (jsdom). Call `resetConsoleStore()`, set the screen to accounts, and render `<AccountsView/>`.
  - Expect the texts 'Claude accounts', 'Detected logins', '~/.claude', '~/.claude-personal', 'Use this', 'Sign in', the privacy line, 'Company', 'Personal', 'Default', 'Pick the account by folder', '~/work/hicas/**', 'Ask me', 'Safety', 'Pause the team and ask me', 'Running now', 'sheet-export' and '6 agents'.
  - No element text matches /\d+%/ (no fake percentages).
  - Click 'Use this': 'Linked as Company' appears.
  - Click 'Sign in': 'Finish signing in your browser' appears. Then 'Check now': 'Signed in as you@gmail.com' appears. Then 'Done': the panel is gone.
  - Click 'Wait for the reset, then resume': its aria-checked is true.
  - Toggle the first Safety checkbox: the store value flips.
  - Click 'Team view': the store screen is 'team'.

## Acceptance commands
- npm test -- tests/renderer/accountsView.test.tsx
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass.
- A manual visual check against accounts.mockup.html at 1440 width is noted in the report.
- Only owned files changed.
