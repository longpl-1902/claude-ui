# T10 - Account cards, add/edit account, folder rules editor, policies, running now

- Wave: 4
- Depends on: T06 (store), T07 (real main behaviour, for the manual check), T09 (accountsView.test.tsx rewritten, so its card/policy cases are gone)
- Spec refs: R-12 (management part); spec "Screen 2 → Account cards, Folder rules table, Safety toggles, usage-limit policy, Running now"
- Tests: tests/renderer/accountsManage.test.tsx

## Goal
Every management part of the Accounts screen works on real data and persists through IPC. That covers the
account cards (with "+ Add account" and an inline Rename & color editor that includes the kind), the ordered
folder rules table with the fixed "Ask me" fallback row, the safety toggles, the usage-limit policy, and the
Running now list.

## Owned files
- modify: src/renderer/src/components/accounts/AccountCards.tsx
- create: src/renderer/src/components/accounts/AccountEditor.tsx
- modify: src/renderer/src/components/accounts/FolderRules.tsx
- modify: src/renderer/src/components/accounts/AccountPolicies.tsx
- modify: src/renderer/src/components/accounts/RunningNow.tsx
- create: src/renderer/src/components/accounts/manage.css
- create: tests/renderer/accountsManage.test.tsx

## Read-only context
- src/renderer/src/store/useConsoleStore.ts (T06), src/shared/types.ts, src/shared/accountsDefaults.ts
- src/renderer/src/screens/AccountsView.css (existing classes), docs/design/accounts.mockup.html
- src/renderer/src/components/ui/*

## Notes
- **AccountCards:**
  - The header shows the name and email (no email → "Not signed in"). The Default badge stays. A Locked badge (lock icon, "In use by a running session") appears when `locked`. A kind tag reads "Company" or "Personal" when set.
  - Fields: the Plan row only when `plan !== undefined` (in Phase 2 it never is). Status "Signed in" or "Not connected". The config folder, plus "(default folder)" when `isDefaultDir`.
  - The usage block always shows "Tokens used today" with `formatTokens(tokensToday)`, or **"—"** when it is undefined. Delete the "Usage not available" and "Sign in ... to see usage" texts. No percentages.
  - Buttons: Set as default (disabled when it is the default). Sign in again → `startSignIn(configDir)` (disabled when `locked`). Rename & color → opens AccountEditor inline in the card. Remove → `removeProfile(id)` after `window.confirm`.
  - "+ Add account" card or button → AccountEditor in create mode.
  - Empty accounts → "No accounts yet. Use a detected login above, or add one."
- **AccountEditor** `{ mode: 'create' | 'edit'; initial?: AccountView; onClose(): void }`:
  - Fields: name (required, ≤40), color swatches from ACCOUNT_COLORS plus a hex input validated `/^#[0-9a-f]{6}$/i`, and kind as a radio (Company / Personal / Not set).
  - configDir: editable in create mode only, default `~/.claude-<slug(name)>`. Below it, the hint "Folder is created by Claude Code when you sign in."
  - Save → `saveProfile(...)`. Show `reason` inline on `ok:false`.
- **FolderRules:**
  - Columns: Folder pattern / Account / Note, plus actions (Move up, Move down, Remove), each an aria-labelled icon button.
  - The rows are `accounts.rules` in order. The final fixed row reads "Anything else" → "Ask me" with the note "Prompt when opening a new folder". It is not editable or removable.
  - "+ Add rule" opens an inline form: pattern (required), account select (the accounts plus "Ask me"), and note. Submit → `setRules([...rules, rule])`. Reorder and remove also go through `setRules`.
  - A helper line under the title reads "First match wins. Patterns: `~/work/**`, `D:/code/*/client`, plain folder = that folder and below."
- **AccountPolicies:**
  - The toggles call `toggleSafety(key)` (already wired to the api by T06). Keep the labels from the spec.
  - Limit policy radios → `setLimitPolicy`. The "Switch account" option shows the note "Only for personal folders. Applies once usage data is available (Phase 3)."
- **RunningNow:**
  - Lists `accounts.sessions` with the folder, the account chip and its color, and the agent count.
  - Empty → "No sessions running. Start one from the lead console's Raw terminal."

### Tests (seed with `seedMockAccounts()`, then override fields)
Cards: tokens "—" when undefined and the formatted value when set; no plan row without a plan; the Locked badge disables Sign in again; Set as default calls the api; Add account → editor → saveProfile with the kind and color; validation errors; Remove with confirm. Rules: the fallback row is always last and not removable; add, move up/down and remove call `setRules` with the right order. Policies: toggles and radios call the api. Running now: list and empty state. Also restore the Phase 1 card/rules/policy/default assertions that T09 removed from accountsView.test.tsx (as far as they still apply).

### Manual (after merge, `npm run dev`)
Add a personal account, rename it, change its color, add a rule, reorder it, restart the app → everything persisted (from `<userData>/accounts.json`).

## Acceptance commands
- npm test -- tests/renderer/accountsManage.test.tsx
- npm test
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass
- Only owned files changed
