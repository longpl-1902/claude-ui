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
      <a className="ac-team__skip" href="#ac-agents">
        Skip to agents
      </a>
      <TeamHeader />
      <div className="ac-team__cols">
        <aside className="ac-team__left" aria-label="Worktrees and tasks">
          <WorktreeList />
          <SharedTaskList />
        </aside>
        <main className="ac-team__center">
          <div className="ac-team__scroll">
            <OverlapBanner />
            <div id="ac-agents">
              <AgentGrid />
            </div>
            <Timeline />
          </div>
          <LeadConsole />
        </main>
        <div className="ac-team__right">
          <Inspector />
        </div>
      </div>
    </div>
  )
}
