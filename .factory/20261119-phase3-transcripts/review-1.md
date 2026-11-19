# Review round 1: FIX

Base 8403fdd..HEAD (src, tests). `npm test` 1054/1054 green, `npm run typecheck` clean.
Real-data checks were run read-only and printed only structure (key presence and counts, no content), using
throwaway scripts in the session scratchpad. These checks found one wrong verified fact, which is the root cause
of O-2:

- **Fact 10 does not hold for sub-agent files.** Across 273 `subagents/agent-*.jsonl` files, `toolUseResult` is **never an
  object**. Write had 663 results with none and 20 with a string (errors only). Edit had 541 with none and 47 with a
  string. Bash had 6540 with none. Agent had 15 with none. The main files do carry it. The fixture builders always
  attach `toolUseResult`, so the tests could not catch this.
- **Registry stamps.** `statusUpdatedAt` and `updatedAt` change only when the status changes. One live session showed
  `statusUpdatedAt` 2401 s ago with its transcript mtime 147 s ago. The other showed 134 s and 3 s. Transcript mtime is
  the real activity signal, which explains O-3.
- **Metas** carry `parentAgentId` (7 of 7 metas with spawnDepth 2), `isFork` (8) and `stoppedByUser`. None of the
  facts mention them.
- **isFork sub files** repeat exactly one `tool_use` id and one `message.id` from the main file (5 of 8): the spawning
  `Agent` call. Uuids never overlap.

## T01 - PASS

## T02 - FIX
1. [R-06/O-2, fact 10 wrong for sub files] `parseToolUse` (src/main/transcripts/parseLine.ts:126-157) drops the Edit and
   Write input, and sub-agent results have no `toolUseResult`, so `fileChange` can never be set for a sub-agent.
   - **Fix:** add `ToolUseRec.edit?: { added: number; removed: number; kind: 'create' | 'update' | 'unknown' }` (records.ts),
     computed from the input:
     - Write: `added` = number of lines in `content`, `removed` = 0, kind `unknown`.
     - Edit: `removed` = number of lines in `old_string`, `added` = number of lines in `new_string`.
     - MultiEdit: the sum over `edits[]`.
     - NotebookEdit: the lines in `new_source`.
   - **Test:** parseLine cases for the Write, Edit and MultiEdit inputs give the expected counts. Do not copy the text.
2. [fact 10] Line 286: `isError` ignores a string `toolUseResult` that contains "rejected" (the case is in the verified
   facts). Line 287: a `tool_result` whose text starts `[Request interrupted` is not marked `interrupted`.
   - **Fix:** set `isError` when `/rejected/i` matches a string `toolUseResult`, and set `interrupted` when the first
     line of the content starts with `[Request interrupted`.
   - **Test:** both cases.

## T03 - FIX
1. [R-03 backfill] src/main/transcripts/tailer.ts:254-255: `discarding = start > 0` drops a whole valid line when
   `start` lands just after a `\n`.
   - **Fix:** start at `size - backfill - 1` and discard through the first newline, so a line that begins exactly at
     the window edge is kept.
   - **Test:** a window that starts exactly on a line boundary keeps that line.

## T04 - PASS
The quiet-tool heuristic is absent, as the user decided. needs-you comes only from registry waiting,
AskUserQuestion or ExitPlanMode, and API errors.

## T05 - FIX
1. [O-1] src/main/transcripts/sessionModel.ts:412 and :540. Today `nameOf` = `meta.name ?? meta.agentType`, so all 55
   cards read "general-purpose".
   - **Fix:** display name = `meta.name ?? meta.description ?? meta.agentType ?? 'agent'`. Role = `agentType`, plus
     ` · <model>` when it is known. Initials come from the display name. Keep `byName` (line 413) keyed on `meta.name`
     and agentId for SendMessage resolution. Do not key it on the description.
   - **Test:** two sub-agents with the same agentType and different descriptions get different `name` and `initials`.
     Each `role` equals its agentType.
2. [O-2, R-06] Lines 272-288: files are taken only from `r.fileChange`. These are absent in sub-agent files (see the
   finding above).
   - **Fix:** keep the tool_use's `edit` (T02) in `ToolInfo`. On a non-error `tool_result` with no `fileChange`, add
     `info.edit` to `a.files[filePath]`. Set the activity result to `+a −r` as well.
   - **Test:** fixture sub-agent lines with **no `toolUseResult`** (one Write create and one Edit) produce two files on
     that sub-agent with the right +/- counts. An errored Edit (string `toolUseResult`, `is_error`) adds nothing.
3. [R-05, fork copies] Lines 248-251: a fork sub file repeats its spawning `Agent` tool_use, which has a new uuid and the
   same id. `toolOwner.set(tu.id, fork)` then overwrites the real owner. This has two effects:
   - The fork's parent falls back to the lead even when a sibling spawned it.
   - The fork keeps an open "Agent" tool that never closes, so it shows "running tool Agent".

   **Fix:** when `toolOwner.get(tu.id)` is another agent, skip the tool_use. Do not take ownership, open the tool,
   count it or add activity.
   **Test:** a nested fork whose file repeats the parent's Agent tool_use keeps `parentId` = that parent, has
   `openTools` = [] and `toolCalls` excludes it.
4. [R-05] Lines 371-372: there is no fallback when the spawning tool_use is outside the backfill window, or is one of
   the 2 cases where it is missing.
   - **Fix:** parse `meta.parentAgentId` in `parseSubagentMeta` (line 37). Use it when `toolOwner` has no owner and
     that agent exists. Only then fall back to the lead.
   - **Test:** a meta with `parentAgentId` and an unknown toolUseId nests under that agent.
5. [R-06, nested agents] Line 289: a nested agent's Agent `tool_result` (in a sub file) has no `toolUseResult`, so
   `agentResults` is never set. That loses the "out" message and the parent-completed signal.
   - **Fix:** when a non-error result closes an `Agent` tool_use with no `agentResult`, record it under the tool id.
     Use status `completed` unless the input had `run_in_background` (then `async_launched`). Use the result summary
     as `text`.
   - **Test:** a sub-agent spawns a nested agent. The result has no `toolUseResult`. The nested agent gets an "out"
     message and `finished`.

## T06 - FIX
1. [O-3, user decision "best available"] src/main/transcripts/sessionIndex.ts:242-243 orders live sessions by
   `statusUpdatedAt ?? updatedAt`. Those stamps change only on a status change (verified above), so a session that has
   been busy for a long time looks old.
   - **Fix:** order the live entries by their transcript `mtimeMs` from `scanAll`, newest first. Use
     `max(statusUpdatedAt, updatedAt)` only as a tie-breaker.
   - **Test:** replace the test at tests/main/transcripts/sessionIndex.test.ts:150. Two live sessions: A has the newer
     statusUpdatedAt and the older mtime, B has the newer mtime. The pick is B.
2. [R-08 pty rule] Lines 222-226: when the registry has the pty's pid but its transcript is not written yet, the code
   falls through to the cwd and mtime match. If a VS Code session is active in the same folder, the app shows that
   session.
   - **Fix:** when a registry entry for `pty.pid` exists and its file does not, return `null`, so the state is
     waiting-for-session.
   - **Test:** pty registry entry present, no file, and another fresh session in the same cwd: the result is
     `{pick: null, waitingForSession: true}`.

## T07 - PASS

## T08 - FIX
1. [R-10 auto stability] src/main/transcripts/transcriptService.ts:389-409: every registry change calls `applyAuto`.
   With T06-1 this follows whichever live session wrote last. Two active sessions (CLI plus VS Code) make the view flip
   back and forth. Each flip re-backfills up to 16 MiB per file across every sub-agent file.
   - **Fix:** in auto mode, keep the current pick while it is still live and no higher tier exists (a pty pick).
     Switch when the current session stops being live, a pty appears or exits, or nothing is selected.
   - **Test:** session A is selected and live, then B's registry entry changes and B's mtime becomes newer: there is no
     switch. When A's pid dies, the view switches to B.
2. [R-09 day rollover] Lines 423-430: `usage:changed` fires only after file activity. If the app is open across
   midnight with no activity, the Accounts card keeps showing yesterday's total as "today".
   - **Fix:** arm a timer for the next local midnight, plus 1 s, that fires `counter.today()` and re-arms itself.
     Clear it in `dispose`.
   - **Test:** fake timers cross midnight, and a push arrives with the new `day` and empty `byAccount`.
3. (advisory, not blocking) Snapshot size. 55 agents × 150 activity items plus messages, as a full snapshot at 4 Hz,
   is much more than the plan's "about 10 agents, under 300 kB". Measure one snapshot with `JSON.stringify(...).length`
   on a large session. If it is over about 500 kB, cap activity for finished agents (for example 30) in the snapshot.

## T09 - FIX
1. [O-5] src/renderer/src/components/team/TeamHeader.tsx:128-133: "Pause all" and "+ New teammate" are active in live
   mode and do nothing.
   - **Fix:** in live mode (`teamMode === 'live'`), set `disabled` with `title="Arrives in Phase 3b/4"`. Keep the demo
     behaviour.
   - **Test:** live mode, both buttons disabled with a title. Demo mode, both enabled.
2. [O-6] Lines 57-61 and teamLeft.css:4/11, plus the 1101px block: `.ac-header__repo` has no grow and no tooltip. The
   picker and the chip shrink at the same rate, and the spacer takes the free space, so "team: …" truncates early.
   - **Fix:** `title={\`${team.repo} / team: ${team.teamName}\`}` on `.ac-header__repo`. At ≥1101px give it
     `flex: 1 1 auto; min-width: 120px`, the team span `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
     min-width:0`, and the picker `flex-shrink: 3`. Drop the spacer's grow in that block, or give the repo a larger
     grow.
   - **Test:** the repo element has the full title text.

## T10 - FIX
1. [O-4] src/renderer/src/components/inspector/inspector.css:54: `.insp-event__result` (long Bash output or errors) has
   no wrapping.
   - **Fix:** add `overflow-wrap: anywhere; word-break: break-word; min-width: 0` there, and `overflow-x: hidden` on
     `.insp-activity` (line 44). Line 51 already wraps the command.
   - **Test:** a CSS presence check, as other CSS tests in the repo do, or manual.
2. [O-5] src/renderer/src/components/inspector/Inspector.tsx:139-165: Message agent, Pause and Stop are active in live
   mode, including on Done agents.
   - **Fix:** when `live`, set `disabled` with `title="Arrives in Phase 3b"` (Message) or `"Arrives in Phase 4"`
     (Pause/Stop). Keep the demo behaviour.
   - **Test:** an inspectorLive case where all three are disabled with titles, and a demo case where they are enabled.

## Criteria without implementation or test
- R-06 sub-agent changed files: implemented only for lines that carry `toolUseResult`. Fixtures do not model real
  sub-agent lines (T05-2).
- R-10 watch latency and manual step 6 (nothing under ~/.claude modified) are still manual and open.
- Privacy checks pass: the allowlist refuses `.key` and credentials files (tested), the fs interface has no write
  methods, the recording-fs test shows zero writes, and the fixtures use synthetic paths and ids.
