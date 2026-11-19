import { AgentGrid } from '@renderer/components/team/AgentGrid'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { OverlapBanner } from '@renderer/components/team/OverlapBanner'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { Timeline } from '@renderer/components/team/Timeline'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { Splitter } from '@renderer/components/layout/Splitter'
import { LEFT, RIGHT, usePanelWidths } from '@renderer/hooks/usePanelWidths'
import type { CSSProperties } from 'react'
import './TeamView.css'

export function TeamView() {
  const w = usePanelWidths()
  const colsStyle = { '--ac-left-w': `${w.left}px`, '--ac-right-w': `${w.right}px` } as CSSProperties
  return (
    <div className="ac-team">
      <a className="ac-team__skip" href="#ac-agents">
        Skip to agents
      </a>
      <TeamHeader />
      <div className="ac-team__cols" style={colsStyle}>
        <aside id="ac-left" className="ac-team__left" aria-label="Worktrees and tasks">
          <WorktreeList />
          <SharedTaskList />
        </aside>
        <Splitter
          label="Resize worktrees panel"
          controls="ac-left"
          side="left"
          value={w.left}
          min={LEFT.min}
          max={w.leftMax}
          defaultValue={LEFT.def}
          onChange={w.setLeft}
        />
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
        <Splitter
          label="Resize inspector panel"
          controls="ac-right"
          side="right"
          value={w.right}
          min={RIGHT.min}
          max={w.rightMax}
          defaultValue={RIGHT.def}
          onChange={w.setRight}
        />
        <div id="ac-right" className="ac-team__right">
          <Inspector />
        </div>
      </div>
    </div>
  )
}
