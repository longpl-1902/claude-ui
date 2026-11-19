# Review round 2: FIX (1 item, T05)

Fix-round diff 68da493..HEAD (src, tests). `npm test` 1081/1081 green, `npm run typecheck` clean, working tree clean.
Real-data checks were read-only and printed only structure (counts and booleans, no content), using throwaway scripts in
the session scratchpad:

- **Main-file Agent results in multi-block tool_result lines.** The parser attaches `toolUseResult` to block 0 only. 34
  Agent results sit in a non-first block (lines with 2 to 10 blocks), so they have no `agentResult`. All 34 are
  async launches: their text starts "Async agent launched". 204 more main-file Agent calls have no `run_in_background`
  in the input but still have `status: async_launched`. The input flag is therefore not a reliable signal of a
  background launch.
- **Sub-file Agent results.** 19 are present, none has `toolUseResult`, and none is an async-launch text. These are sync
  completions, so the new fallback is right for them.
- **meta.parentAgentId.** 7 of 7 values match a sibling `agent-<id>.jsonl` id exactly, with no prefix. The fallback key
  is right.

I reproduced the regression with a throwaway vitest file in the scratchpad that imported src directly, without touching
the repo. The lead launches A and B in one assistant message, and the results come back as one line with 2 blocks. B
ended up with `finished: true` while its own Read tool was still open. B also got an "out" message reading "Async agent
launched successfully.".

## T01 - PASS

## T02 - PASS
- The input-derived `edit` counts work for Write, Edit, MultiEdit and NotebookEdit, and the input text is not copied
  (there is a test).
- A string `toolUseResult` that matches "rejected" now counts as an error.
- `[Request interrupted` now counts as interrupted. Both cases are tested.

## T03 - PASS
- The backfill now starts one byte early, and a line that begins exactly at the window edge is kept. There is a test for
  windows of 6 and 12 bytes.
- When `size == backfill + 1`, start is 0 and nothing is discarded, which is correct.

## T04 - PASS

## T05 - FIX
1. **[R-06/R-05, regression from round-1 item T05-5]** src/main/transcripts/sessionModel.ts:313-321. The new fallback
   records `status: 'completed'` for any non-error Agent result without `agentResult`, unless the input had
   `run_in_background`. On real main files this hits parallel launches (Agent results in block 1+ of a multi-block
   line, 34 cases, all async launches). Every second-and-later sub-agent launched in a parallel batch is therefore shown
   **Done from the moment it launches**, while it is still running. It also gets a bogus "out" message, "Async agent
   launched successfully…". In a live team, which is the main use case, most cards go wrong.
   - **Fix:** use `async_launched` when `info.background` is set OR the result summary matches
     `/^Async agent launched/i`. Use `completed` only otherwise. Optionally omit `text` for async launches, to match how
     a parent result is shown.
   - **Test:** a lead line with two Agent tool_uses that have no `run_in_background`. One tool_results line carries both
     blocks, `toolUseResult` `{agentId, status:'async_launched'}` applies to block 0, and both texts are "Async agent
     launched successfully.". The second sub-agent has an open tool and `runtime.finished` undefined, and its messages
     contain no "out" entry with that launch text. Keep the existing sub-file sync-completion test.

The other T05 round-1 items are verified fixed:
- **Naming (O-1).** The display name is `name ?? description ?? agentType`. The `byName` key for SendMessage still uses
  `name`/`agentType` plus agentId. Role is `agentType · model`, and the inspector no longer repeats the model.
- **Input-derived files (O-2).** These are gated on `!r.fileChange && !isError && !interrupted`, so there is no double
  counting when `toolUseResult` is present. As a bonus, multi-block main-file lines now count their non-first Edits.
  There is no explicit test asserting that a main-file Edit with both input and `toolUseResult` counts once (advisory).
  The code path is unambiguous.
- **Fork-copy skip.** A tool_use is skipped when it is owned by another agent, or when it is the agent's own spawning
  `meta.toolUseId`. Metas load before sub files at select time, so the rule works in both file orders, as the test
  shows.
- **parentAgentId fallback.** It applies only when the tool owner is unknown, and is tested.

## T06 - PASS
- Live sessions are ranked by transcript mtime, and registry stamps only break ties. Both cases are tested.
- When the pty's registry entry exists without its file, the result is `{pick:null, waitingForSession:true}`, even with a
  fresh session in the same cwd. This is tested.

## T07 - PASS

## T08 - PASS (advisory note)
- **Auto stickiness.** It applies only in auto mode and when `ptyHint() === null`. A pty therefore still wins and is
  the top tier. A manual pick returns early (`selection.mode !== 'auto'`). The pick switches when the current session
  leaves the registry, and this is tested.
- **Midnight timer.** It fires at local midnight + 1 s, pushes `counter.today()`, re-arms, is guarded after dispose and
  is cleared in `dispose`. It is tested across two days, including the post-dispose silence.
- **Snapshot caps.** They act on fresh arrays from `model.snapshot` (`activity.slice().map`), so the model is not
  mutated. The events cap of 150 is safe, because live status comes from `runtime`, not from events. The console cap is
  100.
- **Advisory (not blocking).** In a team of more than 12 agents, a *selected* finished sub-agent's Activity tab shows
  only its last 10 tool calls, and the main side does not know which agent is selected. That is surprising for "what did
  this agent do". Raising `LARGE_FINISHED_ACTIVITY_CAP` to about 25 still keeps a 55-agent push well under 500 kB. The
  proper fix is an on-demand per-agent detail request when an agent is selected, which belongs in Phase 3b. Record it
  as a known limitation if it is not changed.

## T09 - PASS
- Pause all and + New teammate are disabled in live mode with the title "Arrives in Phase 4", and enabled in demo mode.
  Both cases are tested.
- The repo element has the full title. At 1101px and wider: the repo is `flex:1 1 auto; min-width:120px`, the picker
  has `flex-shrink:3`, the spacer no longer grows, and the team span uses an ellipsis.

## T10 - PASS
- Message agent, Pause and Stop are disabled in live mode with titles for Phase 3b or 4, and enabled in demo mode.
  Both cases are tested.
- Activity wraps: the result and target have `overflow-wrap:anywhere`, and the list has `overflow-x:hidden` (a CSS
  test checks this).

## Criteria without implementation or test
- No new gaps. R-10 watch latency and manual step 6 (nothing under ~/.claude modified) are still manual.
- **Hard rules hold.** Nothing writes under ~/.claude. The allowlist and the no-credentials tests are unchanged and
  pass. The fixtures stay synthetic (`omitToolUseResult` and `subOkResult` use made-up text). My scans read structure
  only and printed counts.
