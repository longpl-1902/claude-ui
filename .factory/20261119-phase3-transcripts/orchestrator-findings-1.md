# Orchestrator findings — built app on real transcripts (npm run preview), 2026-11-19

Screenshots taken locally, not committed (they show private session content).

Works:
- Auto-pick found a live session; the session picker lists ~titles · project · age · "live" across projects.
- Selecting this build session showed 55 agents (lead + every sub-agent), lead Running with its real current tool,
  sub-agents Done, counters and tokens (5.84M) correct-looking; lead console streams live, newest last.
- Inspector: lead Activity (tool + result lines), Messages (prompts sent to sub-agents, with ids/times), Files (+/− counts)
  work for the lead. Sub-agent selection works and shows "Assigned task" = the Agent call description.
- Accounts card: "Tokens used today 9.41M +311.38M cached".

Bugs (FIX):
- O-1 Sub-agent cards are indistinguishable: name and role both "general-purpose" (subagent_type) for all 55. Name must be
  the Agent call `description` (e.g. "Implementer T03 design system", already known — shown as Assigned task), role =
  subagent_type (+ model if known); avatar initials from the description.
- O-2 Files tab misses sub-agent edits: a sub-agent with 8 Write (create) + 1 Edit calls in its Activity shows
  "No file changes from Edit/Write yet". Write-create results (and Edit results inside sub-agent transcripts) must count.
  Add a fixture test with a sub-agent Write create + Edit.
- O-3 Auto-pick chose a live session "1m ago" over a live session "just now" (both live, neither the app's pty).
  Among live sessions pick the most recent activity (check the rule + test).
- O-4 Inspector Activity overflows horizontally (long Bash commands/results produce a horizontal scrollbar). Wrap / break
  long words (overflow-wrap:anywhere) and keep the list vertical-only.
- O-5 Actions in live mode: Pause / Stop / Message agent are enabled but do nothing (and enabled on Done agents). Disable them
  in live mode with a title explaining when they arrive (Phase 3b/4); keep demo behaviour. "Pause all" / "+ New teammate"
  in the header likewise.
- O-6 Team name in header truncates very early ("team: Claude in Chrom") while the right side has space; give the team
  title a title tooltip and let it take more width (shrink the picker first).

Notes:
- Worktree line shows "HEAD" for this session (real gitBranch value) — fine for now, Phase 5 does worktrees.
- Manual still open: fs.watch latency on a fresh session, nothing under ~/.claude modified (plan manual steps).
