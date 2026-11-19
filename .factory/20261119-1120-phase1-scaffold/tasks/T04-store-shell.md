# T04 - Zustand store, app shell, screen layout and section stubs

- Wave: 3
- Depends on: T01, T02, T03
- Spec refs: R-07, R-13, R-14
- Tests: tests/renderer/store.test.ts

## Goal
Deliver four pieces:
- The single Zustand store that holds all renderer state, seeded from the mock snapshots.
- An App shell that switches between the Team view and Accounts screens.
- The Team view 3-column responsive layout.
- Compiling stubs for every section component that wave 4 fills in.

After this task the app runs and shows the layout with placeholder sections.

## Owned files
- create: src/renderer/src/store/useConsoleStore.ts
- modify: src/renderer/src/App.tsx
- create: src/renderer/src/screens/TeamView.tsx, src/renderer/src/screens/TeamView.css
- create: src/renderer/src/screens/AccountsView.tsx (stub; T09 replaces it)
- create (stubs only): src/renderer/src/components/team/TeamHeader.tsx, WorktreeList.tsx, SharedTaskList.tsx, OverlapBanner.tsx, AgentGrid.tsx, Timeline.tsx, LeadConsole.tsx
- create (stub only): src/renderer/src/components/inspector/Inspector.tsx
- create: tests/renderer/store.test.ts

## Read-only context
- src/shared/types.ts, src/shared/status.ts, src/shared/format.ts, src/shared/mock/index.ts
- src/renderer/src/theme/colors.ts, src/renderer/src/components/ui/*
- docs/design/team-view.mockup.html lines 381, 410-412, 448, 538 (page, column and flex-basis styles), 662-691 (selection and tab state logic)
- docs/design/accounts.mockup.html lines 589-650 (sign-in flow and default/limit state logic)

## Notes
### Store API (`src/renderer/src/store/useConsoleStore.ts`)
Wave 4 and 5 code against this API. Do not rename anything.
```ts
export type Screen = 'team' | 'accounts';
export type InspectorTab = 'activity' | 'files' | 'messages';
export interface SignInState { step: SignInStep; configDir?: string; panelOpen: boolean }
export interface ConsoleState {
  screen: Screen;
  team: TeamSnapshot; accounts: AccountsSnapshot;
  selectedAgentId: string;            // initial 'be' (mockup line 665)
  inspectorTab: InspectorTab;         // initial 'activity'
  rawTerminalOpen: boolean;           // initial false
  consoleDraft: string;
  signIn: SignInState;                // initial { step: 'none', panelOpen: false }
  navigate(screen: Screen): void;
  selectAgent(id: string): void;      // ignores unknown ids
  setInspectorTab(tab: InspectorTab): void;
  toggleRawTerminal(): void;
  setConsoleDraft(text: string): void;
  submitConsole(): void;              // trims; if non-empty appends {time: HH:MM:SS local, who: 'you', text} to team.console, clears draft; also calls window.api?.agent.sendMessage('lead' or the @mentioned agent id, text) fire-and-forget
  hydrateTeam(s: TeamSnapshot): void;
  hydrateAccounts(s: AccountsSnapshot): void;
  setDefaultAccount(id: string): void;
  linkDetected(configDir: string): void;   // sets detected.linkedAccountId = suggestedAccountId and that account.signedIn = true
  startSignIn(configDir: string): void;    // signIn = { step: 'waiting', configDir, panelOpen: true }
  finishSignIn(): void;                    // step 'done'; detected entry: signedIn true, email MOCK_SIGNED_IN_EMAIL, linkedAccountId = suggested; account.signedIn = true
  cancelSignIn(): void;                    // { step: 'none', panelOpen: false }
  closeSignInPanel(): void;                // panelOpen false (step stays)
  setLimitPolicy(p: LimitPolicy): void;
  toggleSafety(key: keyof SafetySettings): void;
}
export const useConsoleStore: UseBoundStore<StoreApi<ConsoleState>>;
export function resetConsoleStore(): void;  // restore initial state; tests call it in beforeEach
// Selectors return stable references (store slices), safe for useConsoleStore(selector):
export const selectSelectedAgent: (s: ConsoleState) => Agent;   // falls back to agents[0]
export const selectActiveAccount: (s: ConsoleState) => AccountView;  // accounts.activeAccountId
// Hooks for derived values (memoised on s.team, never return new objects from a raw selector):
export function useAgentStatuses(): Record<string, AgentStatus>;  // useMemo(deriveAllStatuses(team))
export function useTeamCounters(): { agents: number; running: number; needsYou: number; tokens: number };
```
- Deep-clone the mock snapshots for the initial state with `structuredClone`, so tests that mutate state cannot leak into the mocks.
- All updates must be immutable.
- Mention parsing in submitConsole: if the text starts with `@name `, look up the agent by name (for example `@ui-builder`). Otherwise send to 'lead'.

### App.tsx
- `const screen = useConsoleStore(s => s.screen)`.
- Render `<TeamView/>` or `<AccountsView/>`.
- In a `useEffect`, call `window.api?.team.getSnapshot().then(hydrateTeam).catch(() => {})` and the same for accounts. Guard with `if (!window.api) return`.
- Also set `document.title = 'Agent Console'`.

### TeamView layout (mockup lines 381-614)
```tsx
<div className="ac-team">
  <TeamHeader/>
  <div className="ac-team__cols">
    <aside className="ac-team__left" aria-label="Worktrees and tasks"><WorktreeList/><SharedTaskList/></aside>
    <main className="ac-team__center"><OverlapBanner/><AgentGrid/><Timeline/><LeadConsole/></main>
    <aside className="ac-team__right" aria-label="Agent inspector"><Inspector/></aside>
  </div>
</div>
```
CSS in TeamView.css:
- `.ac-team`: min-height 100vh, flex column.
- `.ac-team__cols`: flex, flex-wrap, flex 1, min-height 0.
- left: `flex: 1 1 240px`, max-width 100%, border-right, bg-panel, padding 16, flex column, gap 22.
- center: `flex: 999 1 560px`, min-width 0, padding 20, flex column, gap 20.
- right: `flex: 1 1 360px`, border-left, bg-panel, padding 18, flex column, gap 16.

### AccountsView stub
`export function AccountsView()` renders `<main><h1>Claude accounts</h1><button onClick={() => navigate('team')}>Team view</button></main>`.

### Section stub contract
These are the exact paths and named exports. Each takes no props, reads the store itself, and returns `<section data-stub="<Name>" />`.
- components/team/TeamHeader.tsx: `export function TeamHeader()`
- components/team/WorktreeList.tsx: `export function WorktreeList()`
- components/team/SharedTaskList.tsx: `export function SharedTaskList()`
- components/team/OverlapBanner.tsx: `export function OverlapBanner()`
- components/team/AgentGrid.tsx: `export function AgentGrid()`
- components/team/Timeline.tsx: `export function Timeline()`
- components/team/LeadConsole.tsx: `export function LeadConsole()`
- components/inspector/Inspector.tsx: `export function Inspector()`
- screens/AccountsView.tsx: `export function AccountsView()`

Wave-4 tasks replace these bodies and may add their own internal files.

### store.test.ts (node env is fine; no DOM needed)
Cover the following:
- Initial screen is 'team', selected agent is 'be', tab is 'activity'.
- `navigate('accounts')`, then back.
- `selectAgent('test')` changes `selectSelectedAgent`; an unknown id is ignored.
- `setInspectorTab` and `toggleRawTerminal`.
- `submitConsole` with an empty draft does nothing; 'hello' appends one line with who 'you' and clears the draft.
- `setDefaultAccount('personal')`.
- `linkDetected('~/.claude')` gives the company account signedIn true and linkedAccountId 'company'.
- Sign-in flow: start, then finish, gives the personal account signedIn and the detected entry email 'you@gmail.com'; start, then cancel, resets.
- `setLimitPolicy('wait')` and `toggleSafety`.
- `resetConsoleStore()` restores the initial state, and the mocks are not mutated.

## Acceptance commands
- npm test -- tests/renderer/store.test.ts
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass.
- `npm run dev` shows the header stub and three columns (manual).
- Only owned files changed.
