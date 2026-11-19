import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react'
import { ChatView } from '@renderer/components/chat/ChatView'
import { AgentGrid, DENSITY_EVENT, readDensity } from '@renderer/components/team/AgentGrid'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { OverlapBanner } from '@renderer/components/team/OverlapBanner'
import { SharedTaskList } from '@renderer/components/team/SharedTaskList'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { Timeline } from '@renderer/components/team/Timeline'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { ProjectRail } from '@renderer/components/rail/ProjectRail'
import { ProjectSwitcher } from '@renderer/components/rail/ProjectSwitcher'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { Splitter } from '@renderer/components/layout/Splitter'
import { trapTab } from '@renderer/components/ui/Dialog'
import { LEFT, RIGHT, usePanelWidths } from '@renderer/hooks/usePanelWidths'
import {
  CONSOLE_MIN,
  GRID_MIN,
  INSPECTOR_TOP_MIN,
  TIMELINE_OPEN_MIN_H,
  WORKTREES_MIN,
  gridWantHeight,
  usePanelHeights
} from '@renderer/hooks/usePanelHeights'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { useCenterView, useCenterViewShortcuts, useCenterViewStore } from '@renderer/store/useCenterViewStore'
import { useLayoutStore, useMaxWidth } from '@renderer/store/useLayoutStore'
import { useWindowsStore } from '@renderer/store/useWindowsStore'
import { chatSpecForCurrent } from '@renderer/windowActions'
import { ErrorBoundary } from '@renderer/components/ui/ErrorBoundary'
import './TeamView.css'

/** At or below this width the project rail, worktrees and tasks merge into a left drawer. */
const NARROW = 1100
/** Below 1440 CSS px the inspector is an overlay drawer (T32 U6). */
const INSPECTOR_OVERLAY = 1439
/** Below 1600 CSS px only one of the worktrees column and the inspector is docked at a time (T32 U6). */
const ONE_DOCK = 1599
/** Below 900 CSS px the agent grid is always compact (same query as AgentGrid). */
const GRID_NARROW = 899
/** At or below this width the project rail (T22) shows icons only. */
const COMPACT_RAIL = 1439

function TeamViewContent() {
  const narrow = useMaxWidth(NARROW)
  const inspectorOverlay = useMaxWidth(INSPECTOR_OVERLAY)
  const oneDock = useMaxWidth(ONE_DOCK)
  const compactRail = useMaxWidth(COMPACT_RAIL)
  const w = usePanelWidths()
  // T37: the timeline reports whether it is open; collapsed, its room goes to the console, and the grid default fits
  // up to 3 compact (2 comfortable) card rows.
  const [timelineOpen, setTimelineOpen] = useState(true)
  const gridNarrow = useMaxWidth(GRID_NARROW)
  const [density, setDensity] = useState(readDensity)
  useEffect(() => {
    const on = () => setDensity(readDensity())
    window.addEventListener(DENSITY_EVENT, on)
    return () => window.removeEventListener(DENSITY_EVENT, on)
  }, [])
  const agentCount = useConsoleStore((s) => s.team.agents.length)
  // Wide layout: columns fill the viewport, so panes are measured; otherwise the page scrolls.
  const hh = usePanelHeights(!narrow, {
    timelineOpen,
    gridWant: gridWantHeight(agentCount, gridNarrow ? 'compact' : density)
  })
  const leftCollapsed = useLayoutStore((s) => s.leftCollapsed)
  const rightCollapsed = useLayoutStore((s) => s.rightCollapsed)
  const toggleLeft = useLayoutStore((s) => s.toggleLeft)
  const toggleRight = useLayoutStore((s) => s.toggleRight)
  // Below ONE_DOCK only one of worktrees / inspector is docked; opening one folds the other. The user's own collapsed
  // flags (and their widths) stay as they are.
  const [lastDock, setLastDock] = useState<'left' | 'right'>('right')
  const prevCollapsed = useRef({ left: leftCollapsed, right: rightCollapsed })
  useEffect(() => {
    const p = prevCollapsed.current
    if (p.left && !leftCollapsed) setLastDock('left')
    if (p.right && !rightCollapsed) setLastDock('right')
    prevCollapsed.current = { left: leftCollapsed, right: rightCollapsed }
  }, [leftCollapsed, rightCollapsed])
  const sharedDock = oneDock && !inspectorOverlay && !leftCollapsed && !rightCollapsed
  const leftFolded = leftCollapsed || (sharedDock && lastDock === 'right')
  const rightFolded = rightCollapsed || (sharedDock && lastDock === 'left')
  const expandLeft = () => {
    if (leftCollapsed) toggleLeft()
    setLastDock('left')
  }
  const expandRight = () => {
    if (rightCollapsed) toggleRight()
    setLastDock('right')
  }
  const selectedAgentId = useConsoleStore((s) => s.selectedAgentId)
  const view = useCenterView()
  const setView = useCenterViewStore((s) => s.setView)
  const maximized = useCenterViewStore((s) => s.consoleMaximized)
  const setMaximized = useCenterViewStore((s) => s.setMaximized)
  useCenterViewShortcuts()
  const showMax = view === 'team' && maximized
  const onCenterKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && showMax && !e.defaultPrevented) {
      e.preventDefault()
      setMaximized(false)
    }
  }
  // Dragging the Chat tab out of the window pops the chat out into its own window, where it was dropped.
  const onChatTabDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData('application/x-agent-console-chat', '1')
    e.dataTransfer.effectAllowed = 'move'
  }
  const onChatTabDragEnd = (e: DragEvent<HTMLElement>) => {
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > window.innerWidth || e.clientY > window.innerHeight
    const spec = chatSpecForCurrent()
    if (outside && spec) void useWindowsStore.getState().open(spec, { x: e.screenX, y: e.screenY })
  }
  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = view === 'team' ? 'chat' : 'team'
    setView(next)
    document.getElementById(`ac-tab-${next}`)?.focus()
  }

  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const drawerToggle = useRef<HTMLButtonElement>(null)
  const prevSelected = useRef(selectedAgentId)

  // <1100 px: the rail and the worktrees/tasks column merge into one left drawer.
  const [leftOpen, setLeftOpen] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const leftToggle = useRef<HTMLButtonElement>(null)
  const closeLeft = () => {
    setLeftOpen(false)
    leftToggle.current?.focus()
  }
  useEffect(() => {
    if (!narrow) setLeftOpen(false)
  }, [narrow])
  useEffect(() => {
    if (leftOpen) leftRef.current?.focus()
  }, [leftOpen])
  const onLeftKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeLeft()
      return
    }
    trapTab(e, leftRef.current)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    drawerToggle.current?.focus()
  }
  // Selecting another agent opens the drawer on narrow windows.
  useEffect(() => {
    if (prevSelected.current !== selectedAgentId && inspectorOverlay) {
      setDrawerOpen(true)
      setLeftOpen(false)
    }
    prevSelected.current = selectedAgentId
  }, [selectedAgentId, inspectorOverlay])
  useEffect(() => {
    if (!inspectorOverlay) setDrawerOpen(false)
  }, [inspectorOverlay])
  useEffect(() => {
    if (drawerOpen) drawerRef.current?.focus()
  }, [drawerOpen])

  const onDrawerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDrawer()
      return
    }
    trapTab(e, drawerRef.current)
  }

  const colsStyle = { '--ac-left-w': `${w.left}px`, '--ac-right-w': `${w.right}px` } as CSSProperties
  const hv = hh.values

  const inspector = (
    <Inspector
      topHeight={hv.inspectorTop}
      splitter={
        <Splitter
          label="Resize inspector details"
          controls="ac-insp-top"
          side="top"
          value={hv.inspectorTop}
          min={INSPECTOR_TOP_MIN}
          max={hh.max('inspectorTop')}
          defaultValue={hh.def('inspectorTop')}
          onChange={(v) => hh.set('inspectorTop', v)}
        />
      }
    />
  )

  return (
    <div className="ac-team">
      <a className="ac-team__skip" href="#ac-agents">
        Skip to agents
      </a>
      <TeamHeader
        {...(narrow || inspectorOverlay
          ? {
              drawers: {
                ...(narrow
                  ? {
                      projects: {
                        open: leftOpen,
                        onClick: () => {
                          setLeftOpen((o) => !o)
                          setDrawerOpen(false)
                        },
                        buttonRef: leftToggle
                      }
                    }
                  : {}),
                inspector: { open: drawerOpen, onClick: () => setDrawerOpen((o) => !o), buttonRef: drawerToggle }
              }
            }
          : {})}
      />
      <ProjectSwitcher />
      <div className="ac-team__cols" style={colsStyle}>
        <div className="ac-team__rail-slot" data-compact={compactRail ? 'true' : 'false'}>
          {!narrow && <ProjectRail compact={compactRail} />}
        </div>
        {narrow ? (
          <>
            {leftOpen && (
              <>
                <div className="ac-team__scrim" onMouseDown={closeLeft} />
                <div
                  id="ac-left"
                  ref={leftRef}
                  className="ac-team__ldrawer"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Projects, worktrees and tasks"
                  tabIndex={-1}
                  onKeyDown={onLeftKey}
                >
                  <button type="button" className="ac-team__collapse" aria-label="Close projects drawer" onClick={closeLeft}>
                    {'×'}
                  </button>
                  <ProjectRail inDrawer onPicked={closeLeft} />
                  <div className="ac-team__ldrawer-body">
                    <WorktreeList />
                    <SharedTaskList />
                  </div>
                </div>
              </>
            )}
          </>
        ) : leftFolded ? (
          <aside id="ac-left" className="ac-team__strip ac-team__strip--left" aria-label="Worktrees and tasks">
            <button
              type="button"
              className="ac-team__strip-btn"
              aria-expanded={false}
              aria-controls="ac-left"
              aria-label="Expand worktrees panel"
              onClick={expandLeft}
            >
              {'›'}
            </button>
          </aside>
        ) : (
          <>
            <aside id="ac-left" className="ac-team__left" aria-label="Worktrees and tasks">
              <button
                type="button"
                className="ac-team__collapse"
                aria-expanded
                aria-controls="ac-left"
                aria-label="Collapse worktrees panel"
                onClick={toggleLeft}
              >
                {'‹'}
              </button>
              <div className="ac-team__body" ref={hh.bind('left')}>
                <div id="ac-pane-worktrees" className="ac-pane ac-pane--fixed" style={{ height: hv.worktrees }}>
                  <WorktreeList />
                </div>
                <Splitter
                  label="Resize worktrees panel (height)"
                  controls="ac-pane-worktrees"
                  side="top"
                  value={hv.worktrees}
                  min={WORKTREES_MIN}
                  max={hh.max('worktrees')}
                  defaultValue={hh.def('worktrees')}
                  onChange={(v) => hh.set('worktrees', v)}
                />
                <div className="ac-pane ac-pane--fill">
                  <SharedTaskList />
                </div>
              </div>
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
          </>
        )}
        <main
          className={`ac-team__center${view === 'chat' ? ' ac-team__center--chat' : ''}`}
          onKeyDown={onCenterKey}
        >
          <div className="ac-team__tabs" role="tablist" aria-label="Center view" onKeyDown={onTabKey}>
            {(['team', 'chat'] as const).map((v) => (
              <button
                key={v}
                id={`ac-tab-${v}`}
                type="button"
                role="tab"
                className="ac-team__tab"
                aria-selected={view === v}
                aria-controls="ac-center-panel"
                tabIndex={view === v ? 0 : -1}
                onClick={() => setView(v)}
                {...(v === 'chat' ? { draggable: true, onDragStart: onChatTabDragStart, onDragEnd: onChatTabDragEnd } : {})}
              >
                {v === 'team' ? 'Team' : 'Chat'}
              </button>
            ))}
          </div>
          {view === 'team' && !showMax && <OverlapBanner />}
          <div
            id="ac-center-panel"
            role="tabpanel"
            aria-labelledby={`ac-tab-${view}`}
            className="ac-team__panel"
            ref={hh.bind('center')}
          >
            {view === 'chat' ? (
              <ChatView />
            ) : showMax ? (
              <div className="ac-team__maxed">
                <LeadConsole />
              </div>
            ) : (
              <>
                <div id="ac-pane-grid" className="ac-pane ac-pane--fixed" style={{ height: hv.grid }}>
                  <div id="ac-agents">
                    <AgentGrid />
                  </div>
                </div>
                <Splitter
                  label="Resize agent grid"
                  controls="ac-pane-grid"
                  side="top"
                  value={hv.grid}
                  min={GRID_MIN}
                  max={hh.max('grid')}
                  defaultValue={hh.def('grid')}
                  onChange={(v) => hh.set('grid', v)}
                />
                <div className="ac-pane ac-pane--fill ac-pane--timeline" data-open={timelineOpen ? 'true' : 'false'}>
                  <Timeline defaultCollapsed={hh.centerHeight < TIMELINE_OPEN_MIN_H} onOpenChange={setTimelineOpen} />
                </div>
                <Splitter
                  label="Resize lead console"
                  controls="ac-pane-console"
                  side="bottom"
                  value={hv.console}
                  min={CONSOLE_MIN}
                  max={hh.max('console')}
                  defaultValue={hh.def('console')}
                  onChange={(v) => hh.set('console', v)}
                />
                <div
                  id="ac-pane-console"
                  className={timelineOpen ? 'ac-pane ac-pane--fixed' : 'ac-pane ac-pane--fill ac-pane--console-fill'}
                  {...(timelineOpen ? { style: { height: hv.console } } : {})}
                >
                  <LeadConsole />
                </div>
              </>
            )}
          </div>
        </main>
        {inspectorOverlay ? (
          <>
            {drawerOpen && (
              <>
                <div className="ac-team__scrim" onMouseDown={closeDrawer} />
                <div
                  id="ac-right"
                  ref={drawerRef}
                  className="ac-team__right ac-team__right--drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Agent inspector"
                  tabIndex={-1}
                  onKeyDown={onDrawerKey}
                >
                  <button type="button" className="ac-team__collapse" aria-label="Close inspector" onClick={closeDrawer}>
                    {'×'}
                  </button>
                  <div className="ac-team__body">{inspector}</div>
                </div>
              </>
            )}
          </>
        ) : rightFolded ? (
          <aside id="ac-right" className="ac-team__strip ac-team__strip--right" aria-label="Agent inspector">
            <button
              type="button"
              className="ac-team__strip-btn"
              aria-expanded={false}
              aria-controls="ac-right"
              aria-label="Expand inspector panel"
              onClick={expandRight}
            >
              {'‹'}
            </button>
          </aside>
        ) : (
          <>
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
              <button
                type="button"
                className="ac-team__collapse ac-team__collapse--right"
                aria-expanded
                aria-controls="ac-right"
                aria-label="Collapse inspector panel"
                onClick={toggleRight}
              >
                {'›'}
              </button>
              <div className="ac-team__body" ref={hh.bind('right')}>
                {inspector}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function TeamView() {
  return (
    <ErrorBoundary label="The team view">
      <TeamViewContent />
    </ErrorBoundary>
  )
}
