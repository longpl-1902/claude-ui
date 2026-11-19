// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamView } from '@renderer/screens/TeamView'
import {
  CONSOLE_MIN,
  GRID_HEAD_H,
  GRID_MIN,
  GRID_ROW_COMFORTABLE_H,
  GRID_ROW_COMPACT_H,
  HANDLE_H,
  TIMELINE_COLLAPSED_H,
  TIMELINE_MIN,
  fitHeights,
  gridWantHeight
} from '@renderer/hooks/usePanelHeights'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { seedDemoTeam } from './seedTeam'

const KEY = 'ac.panelHeights'
const src = (p: string): string => readFileSync(resolve(__dirname, '../../src/renderer/src', p), 'utf8')

describe('T37 grid default and minimum', () => {
  it('one compact row plus the header fits inside the minimum', () => {
    expect(GRID_HEAD_H + GRID_ROW_COMPACT_H).toBeLessThanOrEqual(GRID_MIN)
  })

  it('wants up to 3 compact rows or 2 comfortable rows, fewer when there are fewer agents', () => {
    expect(gridWantHeight(10, 'compact')).toBe(GRID_HEAD_H + 3 * GRID_ROW_COMPACT_H)
    expect(gridWantHeight(10, 'comfortable')).toBe(GRID_HEAD_H + 2 * GRID_ROW_COMFORTABLE_H)
    expect(gridWantHeight(1, 'compact')).toBe(GRID_HEAD_H + GRID_ROW_COMPACT_H)
    expect(gridWantHeight(1, 'comfortable')).toBe(GRID_HEAD_H + GRID_ROW_COMFORTABLE_H)
    expect(gridWantHeight(0, 'compact')).toBe(GRID_HEAD_H)
  })

  it('the default grid is the wanted height (capped at 40 %), so 3 compact rows need no inner scroll', () => {
    const h = { center: 900, left: 900, right: 900 }
    const v = fitHeights({}, h, { gridWant: gridWantHeight(8, 'compact') })
    expect(v.grid).toBe(gridWantHeight(8, 'compact'))
    // a short column caps it at 40 % but never below the one-row minimum
    const short = fitHeights({}, { center: 300, left: 300, right: 300 }, { gridWant: 500 })
    expect(short.grid).toBeGreaterThanOrEqual(GRID_MIN)
    expect(short.grid).toBeLessThanOrEqual(Math.max(GRID_MIN, Math.round(300 * 0.4)))
  })

  it('keeps the dragged size over the content-fit default', () => {
    const v = fitHeights({ grid: 220 }, { center: 900, left: 900, right: 900 }, { gridWant: 176 })
    expect(v.grid).toBe(220)
  })
})

describe('T37 collapsed timeline gives its room to the console', () => {
  const h = { center: 900, left: 900, right: 900 }
  it.each([
    [{}, 900],
    [{ grid: 176 }, 900],
    [{ grid: 176, console: 320 }, 900],
    [{ grid: 500 }, 700],
    [{ grid: 9999, console: 9999 }, 600]
  ])('%j at %i px: grid + console + two handles + the strip fill the column exactly', (raw, center) => {
    const hh = { center, left: center, right: center }
    const v = fitHeights(raw, hh, { timelineOpen: false })
    expect(v.grid + v.console + 2 * HANDLE_H + TIMELINE_COLLAPSED_H).toBe(center)
    expect(v.grid).toBeGreaterThanOrEqual(GRID_MIN)
    expect(v.console).toBeGreaterThanOrEqual(CONSOLE_MIN)
  })

  it('an open timeline still leaves it its minimum; the stored console height is untouched', () => {
    const open = fitHeights({ grid: 176, console: 320 }, h)
    expect(open.console).toBe(320)
    expect(open.grid + open.console + 2 * HANDLE_H + TIMELINE_MIN).toBeLessThanOrEqual(900)
    const shut = fitHeights({ grid: 176, console: 320 }, h, { timelineOpen: false })
    expect(shut.console).toBe(900 - 2 * HANDLE_H - TIMELINE_COLLAPSED_H - 176)
    expect(shut.console).toBeGreaterThan(open.console)
  })

  it('the console minimum leaves the log some lines under the header, toolbar, tabs and composer', () => {
    // header + toolbar + tabs about 110 px and the composer about 110 px
    expect(CONSOLE_MIN - 220).toBeGreaterThanOrEqual(64)
  })
})

describe('T37 TeamView with a collapsed timeline', () => {
  beforeEach(() => {
    resetConsoleStore()
    seedDemoTeam()
    resetLayoutStore()
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1920 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 1000 })
    // the live timeline has the collapse toggle; the demo one does not
    useConsoleStore.setState((s) => ({ team: { ...s.team, source: 'live' }, teamMode: 'live' }))
  })
  afterEach(() => vi.restoreAllMocks())

  const consolePane = (): HTMLElement => document.getElementById('ac-pane-console')!
  const gridSep = (): HTMLElement => screen.getByRole('separator', { name: 'Resize agent grid' })
  const consSep = (): HTMLElement => screen.getByRole('separator', { name: 'Resize lead console' })

  it('console pane stops being a fixed height; the strip is its own height; splitters keep working', async () => {
    render(<TeamView />)
    const timelinePane = document.querySelector('.ac-pane--timeline') as HTMLElement
    expect(timelinePane).toHaveAttribute('data-open', 'true')
    expect(consolePane().style.height).not.toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Collapse timeline' }))
    expect(timelinePane).toHaveAttribute('data-open', 'false')
    expect(consolePane().style.height).toBe('')
    expect(consolePane()).toHaveClass('ac-pane--fill')
    // the console edge is the grid edge now
    const grid0 = Number(gridSep().getAttribute('aria-valuenow'))
    const cons0 = Number(consSep().getAttribute('aria-valuenow'))
    expect(grid0 + cons0 + 2 * HANDLE_H + TIMELINE_COLLAPSED_H).toBe(1000)
    fireEvent.keyDown(consSep(), { key: 'ArrowUp' })
    expect(Number(consSep().getAttribute('aria-valuenow'))).toBe(cons0 + 16)
    expect(Number(gridSep().getAttribute('aria-valuenow'))).toBe(grid0 - 16)
    // reopening restores the fixed console pane and the stored console size is unchanged
    await userEvent.click(screen.getByRole('button', { name: 'Expand timeline' }))
    expect(timelinePane).toHaveAttribute('data-open', 'true')
    expect(consolePane().style.height).not.toBe('')
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, number>
    expect(stored.console).toBeUndefined()
  })

  it('css: the collapsed timeline pane does not grow and the console pane fills (no dead gap)', () => {
    const css = src('screens/TeamView.css').replace(/\r\n/g, '\n')
    expect(css).toMatch(/\.ac-pane--timeline\[data-open='false'\]\s*\{[^}]*flex:\s*0 0 auto/)
    expect(css).toMatch(/#ac-pane-console\.ac-pane--console-fill\s*\{[^}]*min-height:\s*300px/)
  })
})

describe('T37 lead console css', () => {
  const center = (): string => src('components/team/teamCenter.css').replace(/\r\n/g, '\n')
  it('header, toolbar and filter tabs are compact (4 px / 8 px scale) and never shrink under the log', () => {
    const c = center()
    expect(c).toMatch(/\.ac-tc-console__bar\s*\{[^}]*flex:\s*none;[^}]*padding:\s*4px 8px/)
    expect(c).toMatch(/\.ac-tc-ctl\s*\{[^}]*flex:\s*none;[^}]*padding:\s*4px 8px/)
    expect(c).toMatch(/\.ac-tc-chips\s*\{[^}]*flex:\s*none;[^}]*padding:\s*4px 8px/)
  })
})
