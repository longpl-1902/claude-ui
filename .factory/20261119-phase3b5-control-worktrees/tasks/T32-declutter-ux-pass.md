# T32 — Declutter / ease-of-use pass with the lead reviewer (user request, 2026-11-19)

User: "giao diện cũng cần bố trí sao cho người dùng dễ sử dụng mà không bị rối nhất" → the layout must be as easy and
uncluttered as possible.

Wave 13 (last). Process:
1. The UX "lead" reviewer runs the BUILT app on real data (read-only use: no prompts sent, no approvals, no installs)
   in dark and light theme at 1440×900 and 1100×700, using the windows-ui skill to screenshot every screen/state
   (Team with rail + inbox, empty states, Extensions, Accounts, dialogs). It writes a short, prioritized declutter list
   to ux-final.md (max ~15 items): duplicated info, low-value chrome, inconsistent spacing/typography, things that
   should be progressive-disclosure, confusing labels, scroll areas that fight each other, focus/keyboard snags.
2. Guiding rules: the "needs you" path is visible first; one primary action per area; secondary actions in an
   overflow menu or on hover/focus; consistent 4/8 px spacing scale and type scale; no nested scroll areas where one
   will do; empty states explain the next step in one line; no feature removed without the orchestrator's OK.
3. An implementer applies the agreed list (orchestrator approves the list first; disagreements resolved by one
   architect-vs-UX exchange), with tests for any behavioural change. Then the reviewer re-checks with screenshots.

## Owned files
Renderer components/CSS only (whatever the agreed list touches); no main/IPC changes unless trivial and listed.

## Acceptance
- ux-final.md items each marked done / rejected (with reason).
- Before/after screenshots kept in the scratchpad (not committed — they show private data).
- `npm test`, `npm run typecheck`, `npm run build` green.

## Addendum: responsive
Follow plan.md "Responsive (user request)" for every screen/component this task touches; include at least one narrow-width test case.

## Addendum: two monitors
The user uses a 27" (~2560x1440) and a 24" (~1920x1080) monitor. Review both monitor sizes and the multi-window flow from T34 (main window on one screen, Chat/Project window on the other).
