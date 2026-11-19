import { AgentGrid } from '@renderer/components/team/AgentGrid'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { OverlapBanner } from '@renderer/components/team/OverlapBanner'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { Timeline } from '@renderer/components/team/Timeline'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { Inspector } from '@renderer/components/inspector/Inspector'
import './TeamView.css'

export function TeamView() {
  return (
    <div className="ac-team">
      <TeamHeader />
      <div className="ac-team__cols">
        <aside className="ac-team__left" aria-label="Worktrees and tasks">
          <WorktreeList />
          <SharedTaskList />
        </aside>
        <main className="ac-team__center">
          <OverlapBanner />
          <AgentGrid />
          <Timeline />
          <LeadConsole />
        </main>
        <aside className="ac-team__right" aria-label="Agent inspector">
          <Inspector />
        </aside>
      </div>
    </div>
  )
}
