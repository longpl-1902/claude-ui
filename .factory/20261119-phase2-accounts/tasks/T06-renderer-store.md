# T06 - Renderer store on real accounts data, App subscriptions, header chip

- Wave: 2
- Depends on: T01 (ConsoleApi v2, SignInStatus, EMPTY_ACCOUNTS_SNAPSHOT)
- Spec refs: R-11; spec "Screen 1 header account chip", "Screen 2"
- Tests: tests/renderer/store.test.ts, tests/renderer/app.test.tsx, tests/renderer/teamSections.test.tsx

## Goal
The store stops seeding fake account data. It starts from `EMPTY_ACCOUNTS_SNAPSHOT`, hydrates over IPC, and
applies `accounts:changed` and `accounts:sign-in-status` pushes. Account actions call `window.api` (with
optimistic local updates where noted). The header chip shows the real active account, or "No account".
Team and agent data stay mock.

## Owned files
- modify: src/renderer/src/store/useConsoleStore.ts
- modify: src/renderer/src/App.tsx
- modify: src/renderer/src/components/team/TeamHeader.tsx
- create: tests/renderer/seedAccounts.ts (helper: `seedMockAccounts()` = `useConsoleStore.getState().hydrateAccounts(structuredClone(mockAccountsSnapshot))`)
- modify: tests/renderer/store.test.ts
- modify: tests/renderer/app.test.tsx
- modify: tests/renderer/teamSections.test.tsx
- modify (beforeEach seed line ONLY, only if they fail): tests/renderer/accountsView.test.tsx, tests/renderer/teamView.test.tsx, tests/renderer/teamCenter.test.tsx, tests/renderer/inspector.test.tsx

## Read-only context
- src/shared/ipc.ts, src/shared/types.ts, src/shared/accountsDefaults.ts (T01)
- src/renderer/src/components/accounts/*.tsx (current consumers of the store; T09 and T10 rewrite them. Keep the selectors they use compiling, or change them minimally so that typecheck passes)

## Notes
### Store shape (T08, T09 and T10 code against this; keep the names exact)
```ts
accounts: AccountsSnapshot            // initial structuredClone(EMPTY_ACCOUNTS_SNAPSHOT)
accountsLoaded: boolean               // false until the first hydrate
accountsError?: string
signIn: { step: SignInStep; configDir?: string; panelOpen: boolean; email?: string; org?: string; ptyId?: string; reason?: string }
leadPty: { ptyId?: string; folder?: string; accountId?: string }   // survives RawTerminalPane unmount
hydrateAccounts(s: AccountsSnapshot): void        // sets accountsLoaded true
refreshAccounts(): Promise<void>                  // api.accounts.getSnapshot
scanAccounts(): Promise<void>                     // api.accounts.scan → hydrate
setDefaultAccount(id): void                       // optimistic + api.setDefault
linkDetected(configDir): Promise<OkWithId>        // api.accounts.linkDetected({ configDir })
saveProfile(p: ProfileInput): Promise<OkWithId>
removeProfile(id): Promise<OkResult>
setRules(rules: FolderRule[]): void               // optimistic + api.setRules
setLimitPolicy(p): void                           // optimistic + api.setLimitPolicy
toggleSafety(key): void                           // optimistic + api.setSafety(next whole object)
startSignIn(configDir): Promise<void>             // panelOpen, step 'waiting'; api.startSignIn; {ok:false} → step 'error', reason
checkSignIn(): Promise<void>                      // api.checkSignIn(current dir) → applySignInStatus
reopenSignIn(): Promise<void>                     // api.reopenSignIn(current dir)
cancelSignIn(): Promise<void>                     // api.cancelSignIn, then reset to { step:'none', panelOpen:false }
closeSignInPanel(): void
applySignInStatus(s: SignInStatus): void          // ignored unless s.configDir === signIn.configDir (samePath not needed: main echoes the same string)
setLeadPty(p: { ptyId?: string; folder?: string; accountId?: string }): void
```
- Remove the `MOCK_SIGNED_IN_EMAIL` usage. Keep `finishSignIn` only as a deprecated alias of `checkSignIn`, because the current DetectedLogins.tsx (owned by T09) still calls it. T09 removes that call. Do not edit the accounts components. `linkDetected` no longer mutates locally; main pushes `accounts:changed`.
- Every api call is guarded: `window.api` missing → no-op (local optimistic updates still apply), and a rejected promise sets `accountsError` and never throws.
- `selectActiveAccount(s): AccountView | undefined`: `activeAccountId`, else `defaultAccountId`, else undefined. Never use the non-null `[0]!`.
- `resetConsoleStore()` resets to the empty accounts snapshot (team stays mock).

### App.tsx
On mount, `if (window.api)`: get the team snapshot (unchanged), `refreshAccounts()`, subscribe `accounts.onChanged(hydrateAccounts)` and `accounts.onSignInStatus(applySignInStatus)`, and unsubscribe on unmount. A missing `onChanged` in a partial test mock must not crash (guard with optional chaining).

### TeamHeader.tsx
A real account → as now. Undefined → the chip reads "No account" (aria-label `Account: none. Manage accounts`), a neutral avatar "?", and the top border `var(--ac-border)`. A locked account (`locked`) shows a small lock icon in the chip with `title="Account locked while a session runs"`.

### Tests
- store.test: the initial accounts equal EMPTY_ACCOUNTS_SNAPSHOT and accountsLoaded is false. Hydrate sets loaded. Each action calls the right api method with a `vi.fn()` api on `window.api`, including the optimistic updates. A rejected api sets accountsError. applySignInStatus for a matching dir vs another dir. cancelSignIn resets. selectActiveAccount fallbacks and undefined.
- app.test: hydrates from the api mock, subscribes, and unsubscribes on unmount. Push callback → store updated. Navigation via the chip after `seedMockAccounts()`.
- teamSections.test: chip with seeded mock (existing cases) + "No account" case + locked icon.
- Run the full `npm test` and add `seedMockAccounts()` to the beforeEach of any other renderer test that now fails because of the empty seed. Change nothing else in those files.

## Acceptance commands
- npm test
- npm run typecheck

## Done when
- All acceptance commands pass (full suite green)
- Only owned files changed
