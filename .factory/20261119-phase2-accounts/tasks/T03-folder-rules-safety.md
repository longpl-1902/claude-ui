# T03 - Shared folder-rule matcher and launch safety check

- Wave: 1
- Depends on: none
- Spec refs: R-07, R-08; spec "Accounts → Folder rules", "Account safety"
- Tests: tests/shared/folderRules.test.ts, tests/shared/safety.test.ts

## Goal
Pure TS (no Node/DOM imports) used by main and renderer: glob → regexp, first-match-wins folder
resolution with an "ask" fallback, and `checkLaunch` for the lock and personal-in-company warnings.

## Owned files
- create: src/shared/folderRules.ts
- create: src/shared/safety.ts
- create: tests/shared/folderRules.test.ts
- create: tests/shared/safety.test.ts

## Read-only context
- src/shared/types.ts (FolderRule, SafetySettings, RunningSession)
- .factory/20261119-phase2-accounts/tasks/T01-contract-config.md (FolderResolution, LaunchCheck, LaunchWarning, LaunchBlock, AccountKind - added by T01 in the same wave)

## Notes
To stay independent of T01 in wave 1, declare the result types **locally and structurally identical** to T01's
(`FolderResolution`, `LaunchCheck`, `LaunchWarning`, `LaunchBlock`) and export them from these modules with the
same names; T07 imports from `@shared/types` and the structures must be assignable both ways. Do not edit types.ts.

### folderRules.ts
```ts
export interface MatchOptions { home: string; caseInsensitive: boolean }
export function normalizeFolder(p: string, o: MatchOptions): string     // expand leading ~ with o.home, '\\'→'/', collapse '//', strip trailing '/', lowercase if caseInsensitive
export function globToRegExp(pattern: string, o: MatchOptions): RegExp | null   // null for empty/whitespace patterns
export function matchFolder(rules: readonly FolderRule[], folder: string, o: MatchOptions): FolderResolution
export function isFallbackPattern(p: string): boolean   // 'anything else' (case-insensitive) or '*' alone → true; such rules are skipped by matchFolder
```
Glob semantics (pattern normalized like a folder first):
- `**` = zero or more whole segments; `a/**` matches `a` itself and anything below; `**/x/**` matches any `x` segment.
- `*` = any chars within one segment; `?` = one non-`/` char; all other regex chars escaped.
- A pattern with no `*`/`?` is a prefix: matches the folder itself and descendants (`D:/work` matches `D:/work/x`, not `D:/workshop`).
- Anchored full-match against the normalized folder.
- `matchFolder`: first rule (array order) whose regexp matches → `{ accountId: rule.accountId, ruleIndex: i, pattern: rule.pattern }`; a matching rule whose `accountId === 'ask'` returns `accountId: 'ask'` with its index; none → `{ accountId: 'ask', ruleIndex: -1 }`.

### safety.ts
```ts
export interface SafetyProfile { id: string; kind?: 'company' | 'personal' }
export interface SafetySession { path: string; accountId: string }        // running sessions only
export interface CheckLaunchInput {
  folder: string; accountId: string; profiles: readonly SafetyProfile[]; rules: readonly FolderRule[];
  safety: SafetySettings; sessions: readonly SafetySession[]; match: MatchOptions
}
export function checkLaunch(i: CheckLaunchInput): LaunchCheck
export function isSameOrNested(a: string, b: string, o: MatchOptions): boolean
```
Order of checks:
1. accountId not in profiles → `{ allowed: false, blockedReason: 'unknown-account' }`.
2. `safety.lockAccountOnTeamStart` and some session with `isSameOrNested(session.path, folder)` and a different accountId → `blockedReason: 'account-locked'`.
3. Warning `'personal-in-company-folder'` when `safety.warnPersonalInCompanyFolder`, the launching profile's kind is `'personal'`, and `matchFolder(rules, folder)` resolves to a profile whose kind is `'company'`.
4. Otherwise allowed. `matched` is always the `matchFolder` result. Warnings do not block (the caller requires `confirmed`).

### Tests (minimum)
folderRules: `~/work/acme/**` matches `C:\Users\u\work\acme` and `.../acme/repo/src`, not `.../acmex`; case-insensitive vs sensitive; `*` stays in a segment; `?`; `**/company-*/**`; plain prefix; regex chars in pattern (`a+b (1)`); first match wins with overlapping rules; `ask` rule; fallback rule skipped; empty rules → ask/-1; empty pattern ignored.
safety: each block and warning path, toggles off disable them, nested session paths both directions, unknown account, no kind → no warning, company account in company folder → no warning.

## Acceptance commands
- npm test -- tests/shared/folderRules.test.ts tests/shared/safety.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
