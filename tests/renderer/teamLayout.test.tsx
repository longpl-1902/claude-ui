// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamView } from '@renderer/screens/TeamView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { seedDemoTeam } from './seedTeam'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open() {}
    write() {}
    dispose() {}
    loadAddon() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const KEY = 'ac.panelHeights'
const setSize = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h })
}
const sep = (name: string) => screen.getByRole('separator', { name })
const now = (el: HTMLElement) => Number(el.getAttribute('aria-valuenow'))
const grid = () => sep('Resize agent grid')
const cons = () => sep('Resize lead console')
const wt = () => sep('Resize worktrees panel (height)')
const insp = () => sep('Resize inspector details')

function mockMatchMedia(width: number) {
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity)
    return {
      matches: width <= max,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null
    }
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  resetConsoleStore()
  seedDemoTeam()
  resetLayoutStore()
  window.localStorage.clear()
  setSize(1600, 1000)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.style.userSelect = ''
})

describe('TeamView horizontal splitters', () => {
  it('renders all four labelled horizontal separators', () => {
    render(<TeamView />)
    const expected: [HTMLElement, string][] = [
      [grid(), 'ac-pane-grid'],
      [cons(), 'ac-pane-console'],
      [wt(), 'ac-pane-worktrees'],
      [insp(), 'ac-insp-top']
    ]
    for (const [el, id] of expected) {
      expect(el).toHaveAttribute('aria-orientation', 'horizontal')
      expect(el).toHaveAttribute('tabindex', '0')
      expect(el).toHaveAttribute('aria-controls', id)
      expect(document.getElementById(id)).not.toBeNull()
    }
    // the column splitters are still there
    expect(sep('Resize worktrees panel')).toHaveAttribute('aria-orientation', 'vertical')
    expect(sep('Resize inspector panel')).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('uses the documented defaults and mins', () => {
    render(<TeamView />) // no ResizeObserver in jsdom: container = window.innerHeight (1000)
    // T37: the grid default fits 2 comfortable card rows of the demo team (44 + 2 * 128), capped at 40 % of the column;
    // the console takes what the grid and a 150 px timeline leave, mins 96 / 300
    expect(now(grid())).toBe(300)
    expect(grid()).toHaveAttribute('aria-valuemin', '96')
    expect(now(cons())).toBe(538)
    expect(cons()).toHaveAttribute('aria-valuemin', '300')
    expect(now(wt())).toBe(500)
    expect(wt()).toHaveAttribute('aria-valuemin', '80')
    expect(now(insp())).toBe(260)
    expect(insp()).toHaveAttribute('aria-valuemin', '120')
    expect(document.getElementById('ac-pane-grid')!.style.height).toBe('300px')
  })

  it('keyboard: arrows, Shift, Home/End, Enter and double-click reset', () => {
    render(<TeamView />)
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(now(grid())).toBe(316)
    fireEvent.keyDown(grid(), { key: 'ArrowUp', shiftKey: true })
    expect(now(grid())).toBe(252)
    fireEvent.keyDown(grid(), { key: 'Home' })
    expect(now(grid())).toBe(96)
    fireEvent.keyDown(grid(), { key: 'ArrowUp' })
    expect(now(grid())).toBe(96)
    fireEvent.keyDown(grid(), { key: 'Enter' })
    expect(now(grid())).toBe(300)
    fireEvent.keyDown(grid(), { key: 'End' })
    // growing the grid pushes the console down to its minimum
    expect(now(grid())).toBe(1000 - 12 - 60 - 300)
    expect(now(cons())).toBe(300)
    fireEvent.doubleClick(grid())
    expect(now(grid())).toBe(300)
    fireEvent.keyDown(cons(), { key: 'Enter' })
    expect(now(cons())).toBe(538)

    // the console handle sits above its pane: ArrowUp grows it
    fireEvent.keyDown(cons(), { key: 'ArrowUp' })
    expect(now(cons())).toBe(554)
    fireEvent.keyDown(cons(), { key: 'ArrowDown', shiftKey: true })
    expect(now(cons())).toBe(490)
    expect(document.getElementById('ac-pane-console')!.style.height).toBe('490px')

    fireEvent.keyDown(insp(), { key: 'ArrowDown' })
    expect(now(insp())).toBe(276)
    fireEvent.keyDown(wt(), { key: 'ArrowUp', shiftKey: true })
    expect(now(wt())).toBe(436)
  })

  it('drags with clientY', () => {
    render(<TeamView />)
    fireEvent.pointerDown(grid(), { clientY: 500, button: 0, pointerId: 1 })
    expect(document.body.style.userSelect).toBe('none')
    fireEvent.pointerMove(grid(), { clientY: 440, pointerId: 1 })
    expect(now(grid())).toBe(240)
    fireEvent.pointerUp(grid(), { pointerId: 1 })
    expect(document.body.style.userSelect).toBe('')

    fireEvent.pointerDown(cons(), { clientY: 700, button: 0, pointerId: 2 })
    fireEvent.pointerMove(cons(), { clientY: 650, pointerId: 2 })
    expect(now(cons())).toBe(588)
    fireEvent.pointerUp(cons(), { pointerId: 2 })
  })

  it('persists heights and restores them', () => {
    const { unmount } = render(<TeamView />)
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(insp(), { key: 'ArrowDown' })
    const stored = JSON.parse(window.localStorage.getItem(KEY)!)
    expect(stored).toEqual({ grid: 364, inspectorTop: 276 })
    unmount()
    render(<TeamView />)
    expect(now(grid())).toBe(364)
    expect(now(insp())).toBe(276)
    expect(now(cons())).toBe(538)
  })

  it.each(['not json', 'null', '[]', '{"grid":"x","console":null}'])('falls back to defaults for %s', (raw) => {
    window.localStorage.setItem(KEY, raw)
    render(<TeamView />)
    expect(now(grid())).toBe(300)
    expect(now(cons())).toBe(538)
  })

  it('survives a throwing storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<TeamView />)
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(now(grid())).toBe(316)
  })

  it('clamps to the measured container so the other panes keep their minimums', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: (e: unknown[]) => void
        constructor(cb: (e: unknown[]) => void) {
          this.cb = cb
        }
        observe(el: Element) {
          const h = el.id === 'ac-center-panel' ? 500 : 400
          this.cb([{ contentRect: { height: h } }])
        }
        disconnect() {}
        unobserve() {}
      }
    )
    window.localStorage.setItem(KEY, JSON.stringify({ grid: 9999, console: 9999, worktrees: 9999, inspectorTop: 9999 }))
    render(<TeamView />)
    // center panel 500: room = 500 - 12 - 60 = 428; console <= 428 - 96, grid keeps its min
    expect(now(cons())).toBe(332)
    expect(now(grid())).toBe(96)
    expect(grid()).toHaveAttribute('aria-valuemax', '128')
    // left 400: worktrees <= 400 - 6 - 80
    expect(now(wt())).toBe(314)
    // right 400: inspector top <= 400 - 6 - 120
    expect(now(insp())).toBe(274)
    fireEvent.keyDown(cons(), { key: 'Home' })
    expect(now(cons())).toBe(300)
    fireEvent.keyDown(grid(), { key: 'End' })
    expect(now(grid())).toBe(128)
  })
})

describe('column collapse', () => {
  it('collapses the left column into a strip and hides its splitter', async () => {
    render(<TeamView />)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse worktrees panel' }))
    const expand = screen.getByRole('button', { name: 'Expand worktrees panel' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('separator', { name: 'Resize worktrees panel' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Worktrees' })).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('ac.collapsed')!)).toEqual({
      leftCollapsed: true,
      rightCollapsed: false
    })
    await userEvent.click(expand)
    expect(screen.getByRole('heading', { name: 'Worktrees' })).toBeInTheDocument()
  })

  it('collapses the right column and persists it', async () => {
    render(<TeamView />)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse inspector panel' }))
    expect(screen.queryByRole('separator', { name: 'Resize inspector panel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand inspector panel' })).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(window.localStorage.getItem('ac.collapsed')!).rightCollapsed).toBe(true)
  })

  it('mounts the project rail in the first column', () => {
    const { container } = render(<TeamView />)
    const slot = container.querySelector('.ac-team__cols')!.firstElementChild!
    expect(slot).toHaveClass('ac-team__rail-slot')
    expect(within(slot as HTMLElement).getByRole('navigation', { name: 'Projects' })).toBeInTheDocument()
  })
})

describe('narrow window (matchMedia)', () => {
  beforeEach(() => {
    setSize(900, 700)
    mockMatchMedia(900)
  })

  it('turns the inspector into a drawer and keeps horizontal splitters', async () => {
    render(<TeamView />)
    expect(screen.queryByRole('complementary', { name: 'Agent inspector' })).toBeNull()
    expect(screen.queryByRole('separator', { name: 'Resize inspector panel' })).toBeNull()
    expect(grid()).toBeInTheDocument()
    expect(cons()).toBeInTheDocument()
    // The worktrees column merged into the left drawer (T22), so it is not inline any more.
    expect(screen.queryByRole('separator', { name: 'Resize worktrees panel (height)' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Projects' })).toBeNull()

    const toggle = screen.getByRole('button', { name: 'Inspector' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    const drawer = screen.getByRole('dialog', { name: 'Agent inspector' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveFocus()
    expect(within(drawer).getByText('Assigned task')).toBeInTheDocument()
    expect(within(drawer).getByRole('separator', { name: 'Resize inspector details' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Agent inspector' })).toBeNull()
    expect(toggle).toHaveFocus()
  })

  it('T32 U11: the Projects and Inspector toggles are header buttons; nothing floats over the content', () => {
    const { container } = render(<TeamView />)
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).getByRole('button', { name: 'Projects' })).toHaveAttribute('title', expect.stringContaining('Ctrl+B'))
    expect(within(header).getByRole('button', { name: 'Inspector' })).toHaveAttribute('title', expect.stringContaining('Ctrl+I'))
    expect(container.querySelector('.ac-team__drawer-toggle, .ac-team__ldrawer-toggle')).toBeNull()
    for (const file of ['screens/TeamView.css', 'components/rail/rail.css']) {
      const css = readFileSync(resolve(__dirname, '../../src/renderer/src', file), 'utf8')
      expect(css).not.toMatch(/drawer-toggle/)
    }
  })

  it('T32 U11: the Projects button opens the left drawer and focus returns to it on Escape', async () => {
    render(<TeamView />)
    const toggle = screen.getByRole('button', { name: 'Projects' })
    await userEvent.click(toggle)
    expect(screen.getByRole('dialog', { name: 'Projects, worktrees and tasks' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Projects, worktrees and tasks' })).toBeNull()
    expect(toggle).toHaveFocus()
  })

  it('opens the drawer when another agent is selected', () => {
    render(<TeamView />)
    expect(screen.queryByRole('dialog', { name: 'Agent inspector' })).toBeNull()
    act(() => useConsoleStore.getState().selectAgent('lead'))
    expect(screen.getByRole('dialog', { name: 'Agent inspector' })).toBeInTheDocument()
  })

  it('horizontal splitters still work and there is no inspector column', () => {
    const { container } = render(<TeamView />)
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(now(grid())).toBe(Math.round(700 * 0.4) + 16)
    expect(container.querySelector('.ac-team__right:not(.ac-team__right--drawer)')).toBeNull()
  })
})
