// @vitest-environment jsdom
import './jestDom'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@renderer/components/ui/ErrorBoundary'
import { midEllipsis } from '@renderer/components/ui/midEllipsis'
import { classifyLine } from '@renderer/components/team/LeadConsole'
import { describe as describeExt } from '@renderer/components/extensions/describe'
import { WCO_FALLBACK_PX, WCO_VAR, titlebarInset, useTitlebarInset } from '@renderer/hooks/useTitlebarInset'
import {
  CONSOLE_MIN,
  GRID_MIN,
  HANDLE_H,
  TIMELINE_MIN,
  fitHeights
} from '@renderer/hooks/usePanelHeights'

describe('T32 U1: error boundary', () => {
  let explode = true
  function Bomb(): JSX.Element {
    if (explode) throw new Error('boom: bad layout')
    return <p>all good</p>
  }
  beforeEach(() => {
    explode = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows one line with the error and a Reload view button instead of an empty window', async () => {
    render(
      <ErrorBoundary label="The team view">
        <Bomb />
      </ErrorBoundary>
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The team view hit an error: boom: bad layout')
    explode = false
    await userEvent.click(screen.getByRole('button', { name: 'Reload view' }))
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not touch a healthy tree', () => {
    explode = false
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('a throwing screen leaves the rest of the app alone (the boundary sits inside the screen)', () => {
    function Shell(): JSX.Element {
      const [n] = useState(0)
      return (
        <div>
          <span>shell {n}</span>
          <ErrorBoundary>
            <Bomb />
          </ErrorBoundary>
        </div>
      )
    }
    render(<Shell />)
    expect(screen.getByText('shell 0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload view' })).toBeInTheDocument()
  })
})

describe('T32 U2: window controls inset (--ac-wco-right)', () => {
  const setUa = (ua: string): void => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
  }
  const setWco = (wco: unknown): void => {
    Object.defineProperty(navigator, 'windowControlsOverlay', { configurable: true, value: wco })
  }
  const original = navigator.userAgent
  function Probe(): null {
    useTitlebarInset()
    return null
  }
  afterEach(() => {
    setUa(original)
    delete (navigator as unknown as { windowControlsOverlay?: unknown }).windowControlsOverlay
    document.documentElement.style.removeProperty(WCO_VAR)
  })
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1536 })
  })

  it('reads the title-bar area rect and listens to geometrychange', () => {
    let rect = { x: 0, width: 1396 }
    const listeners: Array<() => void> = []
    setWco({
      visible: true,
      getTitlebarAreaRect: () => rect,
      addEventListener: (_t: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => undefined
    })
    render(<Probe />)
    expect(document.documentElement.style.getPropertyValue(WCO_VAR)).toBe('140px')
    rect = { x: 0, width: 1436 }
    listeners.forEach((cb) => cb())
    expect(document.documentElement.style.getPropertyValue(WCO_VAR)).toBe('100px')
  })

  it('falls back to 140 px on Windows without the API, and 0 elsewhere', () => {
    setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Electron/30')
    expect(titlebarInset()).toBe(WCO_FALLBACK_PX)
    setUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
    expect(titlebarInset()).toBe(0)
  })

  it('is 0 when the overlay is not visible', () => {
    setWco({ visible: false, getTitlebarAreaRect: () => ({ x: 0, width: 100 }) })
    expect(titlebarInset()).toBe(0)
  })
})

describe('T32 U4/U8/U12 helpers', () => {
  it('midEllipsis keeps the start and the end', () => {
    expect(midEllipsis('Implement X-T34', 14)).toMatch(/^Implem.*T34$/)
    expect(midEllipsis('Implement X-T34', 14)).toContain('…')
    expect(midEllipsis('lead', 14)).toBe('lead')
    expect(midEllipsis('Implement X-T34', 14).length).toBeLessThanOrEqual(14)
  })

  it('classifyLine: every tool (PowerShell, SubagentHandback, MCP) and a bare "done" is a tool line', () => {
    const line = (text: string, who = 'lead') => ({ time: '10:00:00', who, text })
    expect(classifyLine(line('PowerShell $w = "C:/Users/u/x"'))).toBe('tool')
    expect(classifyLine(line('SubagentHandback {"status":"done"}'))).toBe('tool')
    expect(classifyLine(line('mcp__acme__search q'))).toBe('tool')
    expect(classifyLine(line('done'))).toBe('tool')
    // prose is still a message, including a capitalised first word and the user's own lines
    expect(classifyLine(line('Implement the plan first, then test.'))).toBe('message')
    expect(classifyLine(line('Done with the first pass'))).toBe('message')
    expect(classifyLine(line('PowerShell is not installed', 'you'))).toBe('message')
    expect(classifyLine(line('API error: overloaded'))).toBe('error')
  })

  it('describe() turns a bare YAML block indicator into "No description"', () => {
    expect(describeExt('>-')).toBe('No description')
    expect(describeExt('|')).toBe('No description')
    expect(describeExt('Real text')).toBe('Real text')
    expect(describeExt(undefined)).toBeUndefined()
  })
})

describe('T32 U5: the center column fits without scrolling', () => {
  // The panel (grid, timeline, console) is measured, not the whole column. Sum of rows + 2 handles must fit.
  for (const [w, h, panel] of [
    [1100, 700, 700 - 64 - 40 - 40],
    [1536, 864, 864 - 64 - 40 - 40],
    [2560, 1440, 1440 - 64 - 40 - 40]
  ] as const) {
    it(`${w}x${h}: grid + timeline + console + handles <= the panel, mins respected`, () => {
      const v = fitHeights({}, { center: panel, left: panel, right: panel })
      expect(v.grid + v.console + TIMELINE_MIN + 2 * HANDLE_H).toBeLessThanOrEqual(panel)
      expect(v.grid).toBeGreaterThanOrEqual(GRID_MIN)
      expect(v.console).toBeGreaterThanOrEqual(CONSOLE_MIN)
      expect(v.grid).toBeLessThanOrEqual(Math.max(GRID_MIN, Math.round(panel * 0.4)))
    })
  }

  it('keeps the sizes the user dragged (persisted values win while they fit)', () => {
    const v = fitHeights({ grid: 200, console: 300 }, { center: 900, left: 900, right: 900 })
    expect(v.grid).toBe(200)
    expect(v.console).toBe(300)
  })
})
