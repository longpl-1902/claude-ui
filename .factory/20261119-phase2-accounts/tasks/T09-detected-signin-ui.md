# T09 - Detected logins and the 3-step sign-in panel on real data

- Wave: 3
- Depends on: T01 (TerminalView props, api), T06 (store actions and signIn state)
- Spec refs: R-12 (detected and sign-in part); spec "Screen 2 → Detected logins, Sign-in flow panel, Privacy line"
- Tests: tests/renderer/accountsView.test.tsx (rewritten)

## Goal
The Detected logins section shows what main detected: the dir, the email and org, the source labels and the
warnings. It offers Use this / Sign in / "Linked as X". The sign-in panel is a real 3-step flow driven by the store
and the main pushes. It has Check now, Open browser again, Cancel, and a "Show terminal" toggle that embeds
`TerminalView` for the CLI's paste-code fallback. The privacy line stays.

## Owned files
- modify: src/renderer/src/components/accounts/DetectedLogins.tsx
- create: src/renderer/src/components/accounts/SignInPanel.tsx
- create: src/renderer/src/components/accounts/signIn.css
- modify: tests/renderer/accountsView.test.tsx (rewrite: static screen + detected + sign-in; REMOVE the card, rules, policy and default cases, because T10 re-covers them in accountsManage.test.tsx)

## Read-only context
- src/renderer/src/store/useConsoleStore.ts (T06), src/shared/types.ts, src/shared/ipc.ts
- src/renderer/src/components/terminal/TerminalView.tsx (import it; the T01 stub contract, T08 implements it in the same wave)
- src/renderer/src/screens/AccountsView.css (existing `ac-acc-*` classes; reuse, do not edit)
- docs/design/accounts.mockup.html

## Notes
- **Scan again** → `scanAccounts()`. Show a busy state (the button is disabled and labelled "Scanning…") until it resolves.
- **Empty state:** `accountsLoaded && detected.length === 0` → "No Claude config folders found. Sign in once with `claude` or add an account below." Before loading → "Looking for Claude config folders…".
- **Row:** `configDir` (mono). Signed in → `email · org` (just the email if there is no org). Not signed in → `exists === false` ? "Folder set but not created yet" : "Not signed in yet". Then `Found in: <sources joined by ', '>`. Each warning is an amber line with the warning icon (`role="note"`).
- **Action:** linked → the pill "Linked as <name>". Signed in and not linked → "Use this" → `linkDetected(configDir)`. Not signed in → "Sign in" → `startSignIn(configDir)`.
- **SignInPanel** (move it out of DetectedLogins.tsx). It is visible when `signIn.panelOpen`. Steps: 1 `Folder <configDir>`, 2 `Sign in on claude.ai`, 3 `Ready to use`. `waiting` → step 2 is current. `done` → all three are done. `error` → step 2 shows the error colour plus a message:
  - `login-exited` → "The sign-in process ended before finishing."
  - `pty-unavailable` → "Terminal support (node-pty) is not available."
  - `claude-not-found` → "Could not find the claude CLI."
  - anything else → "Sign-in failed (<reason>)."
- **Waiting body:** "Finish signing in your browser". The text: "Claude Code opened the sign-in page in your browser. This screen updates by itself when you are done." The command line `CLAUDE_CONFIG_DIR=<dir> claude auth login` (for the default `~/.claude`, just `claude auth login`). The buttons: **Check now** → `checkSignIn()`, **Open browser again** → `reopenSignIn()`, **Cancel** → `cancelSignIn()`, and **Show terminal / Hide terminal**. The toggle is enabled only with `signIn.ptyId`. It renders `<TerminalView ptyId={signIn.ptyId} ariaLabel="Sign-in terminal" />` inside the panel.
- **Done body:** "Signed in as <email>". Then "Saved as “<name>”." if a profile links this dir, else the "Use this" button for that dir. Then **Done** → `closeSignInPanel()`.
- **Error body:** the message plus "Try again" (`reopenSignIn()`) and "Cancel".
- Privacy line, verbatim: "Agent Console reads only the email and organization name. Login tokens stay where Claude Code stored them."
- Mock `@renderer/components/terminal/TerminalView` in the tests (`vi.mock`) with a simple div that echoes the ptyId.

### Tests (seed with `seedMockAccounts()` from tests/renderer/seedAccounts.ts, then add T01 fields where needed)
The static headings and privacy line. Detected rows: email · org, sources, a warning note, the not-created text. The loading and empty states. Scan again calls the api and shows the busy state. Use this calls linkDetected. Sign in opens the panel in waiting. Check now, Open browser again and Cancel call the right api. `applySignInStatus({step:'done', email})` → the done view and its text. The error view per reason. The terminal toggle is disabled without a ptyId and renders the mocked TerminalView with one.

## Acceptance commands
- npm test -- tests/renderer/accountsView.test.tsx
- npm test
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
