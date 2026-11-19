# Review round 2: FIX (two one-line items, no behaviour bugs)

Fix diff c9d06e2..HEAD (batches A/B/C plus 8e358ca). `npm test` 601/601 pass and `npm run typecheck` is clean (reviewer ran both). No GUI run, no real login, no rebuild.

The hard rules still hold. The only new write is `accounts.json.corrupt-<ts>`, made through the same `WriteFs` in userData. No new fs paths, no credential reads, and only `email` and `org` are read (`baselineEmail` stays in memory and is never logged). `noCredentials.test.ts` reads every src file with `readFileSync`, so FolderRules.tsx is still scanned even though git treats it as binary (see T10-1).

## Round-1 items

- **T05-1 PASS.** `validateAccountsFile` now returns `lossy` for a non-object, a version other than 1, or any dropped profile or rule. `loadAccountsFile` copies the original text to `.corrupt-<ts>` and sets `recoveredFrom`. A failed backup is reported as a warning. There are tests for the `{version:2}` load-then-save case, a dropped entry, and a clean file that gets no copy.
- **T06-1 PASS, with a gap** (see T06 below). The chip CSS truncates: chip `flex 0 1 320px`, `min-width: 0` and `overflow: hidden`, and the email shrinks first (`flex 1 1 0`). `title` holds "name · email". The orchestrator confirmed one header row in the live app.
- **T06-2 PASS.** `writeOptimistic` covers both `!ok` and a rejected call: it calls `refreshAccounts()` and then sets `accountsError` again after hydrate. `AccountsView` shows the error in a `role="alert"` banner with a Dismiss button. Store tests cover setRules returning `{ok:false}` and setLimitPolicy rejecting.
- **T06-3 PASS.** `finishSignIn` is removed.
- **T07-1 PASS.** The baseline-email rule is right. With no email at baseline, any email means done. With an email at baseline, done needs exit 0 or a different email. The mtime path was removed, so the CLI writing `.claude.json` at startup cannot complete the sign-in early. Tested: same email plus a bump stays waiting, then exit 0 gives done.
- **T07-2 PASS.** The `dirty` flag re-runs `evaluate` from `finally`. A re-run after a terminal step returns early. The test injects a change in the middle of an evaluate.
- **T07-3 PASS.** `displayDir` returns null for a relative path. `saveProfile` and `linkDetected` return `invalid-folder`, and whitespace-only input still gets `invalid-args`. The editor maps the reason to plain words. Tested, including that nothing is written.
- **T07-4 PASS.** `signIn.onStatus` with `done` emits `changed`. Tested through the watcher path.
- **T07-5 PASS.** Check and spawn now run in one `serial` block, using `checkWith(f)` on the loaded file. `pty.spawnClaude` does not touch the accounts queue, so this cannot deadlock. `emitChanged` runs after the serial block. There is a concurrency test where the second launch gets `account-locked` and spawn is called once.
- **T08-1 PASS.** The select sits inside `.ac-tc-raw__row` with a visible `<label htmlFor>`. Tested. The orchestrator confirmed a single-line select in the live app.
- **T08-2 PASS.** The offset protocol is consistent end to end:
  - `ptyManager` keeps a running `total` in UTF-16 units, and it keeps counting past the ring trim (tested).
  - `snapshot()` returns `{data, end}`.
  - The `onData` callback carries `end`, and `index.ts` coalescing concatenates the data and keeps the last `end`, so `end - data.length` is still the start of the chunk.
  - `TerminalView` drops a push with `end <= bufferEnd` and slices a straddling chunk, both for pending and live data. A failed `getBuffer` falls back to `bufferEnd = 0`, which writes everything.
  - The IPC result type, the mock handler and preload are all updated. There are no other `pty:data` consumers.
  - The test covers a fully duplicated chunk, a straddling chunk and a new chunk.
- **T09-1 PASS.** `aria-live` moved to the step titles, and the panel root has none. Tested.
- **T09-2 PASS.** The account is matched by `configDir` first, with `linkedAccountId` as the fallback. Tested with no detected rows.
- **T10-1 PASS.** The header button is wired through the `adding` state in `AccountsView`, and the "+ Add another account" button is gone. The editor focuses Name on create, and the empty state is its own column block. Two "+ Add account" buttons in the empty state are acceptable. The mockup (line 388) only draws the populated screen, with the header button, and has no empty state. Round 1 itself asked for an empty-state button that appears only when the list is empty. With accounts present there is exactly one button (tested).
- **T10-2 PASS, with a hygiene defect** (see T10 below). Row keys are stable: a (pattern, accountId) signature pool reuses keys and handles duplicates. After a move, focus goes to the same action, or to the opposite one when the row reaches an edge. Focus returns to "+ Add rule" on cancel and on submit.
- **T10-3 PASS.** The alert is hosted in `AccountsView`.

## T01-T04, T05, T07, T08, T09 - PASS

## T06 - FIX
1. [R-11 / round-1 T06-1, a11y] The chip `aria-label` is still `Account: <name>. Manage accounts` (`src/renderer/src/components/team/TeamHeader.tsx:32`). The aria-label replaces the visible text, so screen readers never hear the email, which is now often cut off visually. **Correct:** use `Account: ${name}${email ? ` (${email})` : ''}. Manage accounts`, and assert it in the existing `teamSections` chip test.

## T10 - FIX
1. [Repo hygiene / review-ability] `src/renderer/src/components/accounts/FolderRules.tsx` contains one literal NUL byte: the signature separator in `` `${r.pattern}<NUL>${r.accountId}` `` (around line 27). Because of it, git treats the file as binary (`git ls-files --eol` shows `-text`). Diffs show "Bin", eol normalisation is skipped (the file is committed with CRLF while every other file in the index is LF), and grep tools skip it. **Correct:** use the escape sequence `\u0000` (or `'\n'`) in the source instead of the raw byte. Then save the file with LF so `git ls-files --eol` shows `i/lf` and `git diff` shows text.

## Non-blocking notes (no fix needed this phase)
- When a lossy `accounts.json` is never changed, `loadAccountsFile` makes a new `.corrupt-<ts>` copy on every app start, because the file stays lossy until the first save. This is harmless and stays within the allowed names, but copies can pile up. A later phase could skip the copy when the newest `.corrupt-` copy has the same content.
- `hydrateAccounts` clears `accountsError`, so any `changed` push hides the banner. This is acceptable.
- Two tests are weak:
  - The empty-state test does not count buttons.
  - The FolderRules focus test accepts either Move up or Move down.

## Coverage
Every R-01..R-15 is implemented and tested. Still manual: a real `claude auth login` (R-10), and the R-14 mtime check on VS Code and Claude settings.
