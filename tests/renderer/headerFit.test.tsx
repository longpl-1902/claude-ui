// @vitest-environment jsdom
import './jestDom'
import { Profiler } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OVERFLOW_ORDER, TeamHeader } from '@renderer/components/team/TeamHeader'
import { MAX_REPLANS, neededWidth, planOverflow, useOverflowItems } from '@renderer/hooks/useOverflowItems'
import type { OverflowPlanInput } from '@renderer/hooks/useOverflowItems'
import { resetConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'
import { seedDemoTeam } from './seedTeam'

// T32 U4: the header row holds brand, project + session select, account chip, needs-you and one primary action
// ("+ New teammate" in demo); only that primary action may move into the "..." menu when the row is too narrow.
//
// Natural widths (px): the primary action, and the never-moved items (shrinkable ones use their minimum).
const NEW_W = 210
// demo header: brand 130, badge 70, repo min 80, picker min 160, back 80, chip min 120, needs wrapper 80, "..." min 44
const FIXED_SUM = 130 + 70 + 80 + 160 + 80 + 120 + 80 + 44
const FIXED_COUNT = 8
const FULL = FIXED_SUM + NEW_W + 12 * FIXED_COUNT // everything visible
const ONLY_MENU = FIXED_SUM + 12 * (FIXED_COUNT - 1) // the primary action moved into the menu

let width = 1920
let callbacks: Array<() => void> = []
const saved: Array<[object, string, PropertyDescriptor | undefined]> = []

function stub(proto: object, key: string, get: (this: HTMLElement) => number): void {
  saved.push([proto, key, Object.getOwnPropertyDescriptor(proto, key)])
  Object.defineProperty(proto, key, { configurable: true, get })
}

beforeEach(() => {
  width = 1920
  callbacks = []
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1920 })
  class MockRO {
    constructor(cb: () => void) {
      callbacks.push(cb)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockRO
  stub(Element.prototype, 'clientWidth', function () {
    return this.classList.contains('ac-header') || this.dataset.testHeader !== undefined ? width : 0
  })
  stub(HTMLElement.prototype, 'offsetWidth', function () {
    const oi = this.dataset.oi
    if (oi !== undefined) return oi === 'new' ? NEW_W : oi === 'note' && this.dataset.collapsed !== undefined ? 16 : oi === 'note' ? 150 : 0
    if (this.classList.contains('ac-header__brand')) return this.parentElement?.classList.contains('is-compact') ? 22 : 130
    if (this.classList.contains('ac-header__badge')) return 70
    if (this.classList.contains('ac-header__fixed')) return 80
    return 0
  })
  resetConsoleStore()
  window.localStorage.clear()
  seedDemoTeam()
  seedMockAccounts()
})
afterEach(() => {
  for (const [proto, key, d] of saved.splice(0)) {
    if (d) Object.defineProperty(proto, key, d)
    else delete (proto as Record<string, unknown>)[key]
  }
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  delete (window as unknown as { api?: unknown }).api
})

function resizeTo(w: number): void {
  width = w
  act(() => {
    for (const cb of callbacks) cb()
  })
}

const header = (): HTMLElement => document.querySelector('.ac-header') as HTMLElement
const newInRow = (): boolean => document.querySelector('.ac-header > [data-oi="new"]') !== null
const NEW_BTN = /^\+ New teammate$/

describe('planOverflow (pure)', () => {
  const base: OverflowPlanInput = {
    order: OVERFLOW_ORDER,
    widths: { new: NEW_W },
    fixed: FIXED_SUM,
    fixedCount: FIXED_COUNT,
    gap: 12,
    avail: 1920,
    moreInFixed: true
  }
  it('needs the full width with the primary action in the row and less once it is in the menu', () => {
    expect(neededWidth(base, 0)).toBe(FULL)
    expect(neededWidth(base, 1)).toBe(ONLY_MENU)
    expect(FULL).toBeGreaterThan(ONLY_MENU)
  })
  it('moves the primary action only when the row overflows', () => {
    expect(planOverflow({ ...base, avail: FULL })).toBe(0)
    expect(planOverflow({ ...base, avail: FULL - 1 })).toBe(1)
  })
  it('moves everything when even the last step does not fit', () => {
    expect(planOverflow({ ...base, avail: 300 })).toBe(OVERFLOW_ORDER.length)
  })
})

describe('T32 U4 header fit at real window widths', () => {
  it('1920: the primary action is in the row; the "..." menu is always there', () => {
    render(<TeamHeader />)
    resizeTo(1920)
    expect(newInRow()).toBe(true)
    expect(screen.getByRole('button', { name: NEW_BTN })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More header actions' })).toBeInTheDocument()
  })

  it('914: the primary action moves into the menu, the rest of the row stays', async () => {
    render(<TeamHeader />)
    resizeTo(914)
    expect(newInRow()).toBe(false)
    expect(screen.queryByRole('button', { name: NEW_BTN })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: NEW_BTN })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Extensions' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Accounts' })).toBeInTheDocument()
  })

  it('never moves the brand, badge, session picker, needs-you button or account chip (down to 600 px)', () => {
    const { container } = render(<TeamHeader />)
    for (const w of [1920, 1536, 1100, 914, 600]) {
      resizeTo(w)
      expect(container.querySelector('.ac-header__brand')).toBeInTheDocument()
      expect(screen.getByText(/DEMO/)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Session' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /need you/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Manage accounts/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'More header actions' })).toBeInTheDocument()
    }
  })

  it('subtracts the right padding reserved for the window controls', () => {
    render(<TeamHeader />)
    resizeTo(FULL + 20)
    expect(newInRow()).toBe(true)
    header().style.paddingRight = '140px'
    resizeTo(FULL + 20)
    expect(newInRow()).toBe(false)
  })

  it('an icon-only brand takes over when even the reduced row does not fit', () => {
    render(<TeamHeader />)
    resizeTo(ONLY_MENU - 30)
    expect(header()).toHaveClass('is-compact')
    resizeTo(1920)
    expect(header()).not.toHaveClass('is-compact')
  })
})

describe('T35 hysteresis', () => {
  it('hides as soon as it overflows but only returns the item with 24 px to spare', () => {
    render(<TeamHeader />)
    resizeTo(FULL - 1)
    expect(newInRow()).toBe(false)
    resizeTo(FULL + 23)
    expect(newInRow()).toBe(false)
    resizeTo(FULL + 24)
    expect(newInRow()).toBe(true)
    resizeTo(FULL + 5) // back inside the dead band: stays
    expect(newInRow()).toBe(true)
    resizeTo(FULL - 1)
    expect(newInRow()).toBe(false)
  })
})

describe('T35 overflow menu keyboard and ARIA', () => {
  async function openMenu(): Promise<HTMLElement> {
    render(<TeamHeader />)
    resizeTo(1000)
    const more = screen.getByRole('button', { name: 'More header actions' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    return more
  }

  it('focuses the first item on open; arrows wrap, Home/End jump', async () => {
    await openMenu()
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((m) => m.textContent)).toEqual([
      '+ New teammate',
      'Pause all',
      expect.stringMatching(/^Extensions/),
      expect.stringMatching(/^Accounts/)
    ])
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(items[3]).toHaveFocus() // wraps
    await userEvent.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(items[3]).toHaveFocus()
  })

  it('Escape closes the menu and returns focus to the button', async () => {
    const more = await openMenu()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveFocus()
  })

  it('ArrowDown on the closed button opens the menu', async () => {
    const more = await openMenu()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'true')
  })

  it('menu rows show the shortcut but keep it out of the accessible name', async () => {
    await openMenu()
    const ext = screen.getByRole('menuitem', { name: 'Extensions' })
    expect(ext).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+E')
    expect(ext).toHaveTextContent('Ctrl+Shift+E')
  })
})

// ---- T32 U1: the blank window at about 2400 CSS px ------------------------------------------------------------------

/** A header-like row whose natural widths make everything "just fit": the old hook re-planned on every commit. */
function Row({ onRender }: { onRender: () => void }): JSX.Element {
  const { containerRef, hidden, collapsed, compact } = useOverflowItems({
    order: ['note', 'a', 'new'],
    collapse: { note: 16 },
    fallbackNarrow: false
  })
  onRender()
  return (
    <header ref={containerRef} data-test-header="" className={compact ? 'is-compact' : ''}>
      <span data-fixed data-min="100">
        fixed
      </span>
      {collapsed.has('note') ? (
        <span data-oi="note" data-collapsed="">
          i
        </span>
      ) : (
        <span data-oi="note">older history not loaded</span>
      )}
      {!hidden.has('a') && <span data-oi="a">a</span>}
      {!hidden.has('new') && <span data-oi="new">new</span>}
    </header>
  )
}

describe('T32 U1: useOverflowItems never loops (blank window at 2400+ CSS px)', () => {
  // widths: fixed 100, note 150 (icon 16), a 0 -> use 'new' = 210. gap falls back to 12 (jsdom has no gap).
  const natural = (note: number): number => 100 + note + 210 + 12 * 2

  it('a collapsed item keeps its natural width, so the note does not flip between icon and text', () => {
    let renders = 0
    // 380: the icon form fits with room to spare (350 + 24 hysteresis <= 380), the text form (484) does not.
    width = 380
    const { container } = render(<Row onRender={() => renders++} />)
    resizeTo(380)
    resizeTo(380)
    const settled = renders
    expect(settled).toBeLessThanOrEqual(6)
    expect(container.querySelector('[data-oi="note"]')).toHaveAttribute('data-collapsed')
    // more resize events at the same width change nothing
    for (let i = 0; i < 5; i++) resizeTo(380)
    expect(renders).toBe(settled)
    expect(natural(150)).toBeGreaterThan(380)
  })

  it('wide (2560): everything fits, nothing hides, and the render count stays bounded', () => {
    let commits = 0
    width = 2560
    render(
      <Profiler id="row" onRender={() => commits++}>
        <TeamHeader />
      </Profiler>
    )
    for (let i = 0; i < 10; i++) resizeTo(2560)
    expect(commits).toBeLessThanOrEqual(4)
    expect(newInRow()).toBe(true)
    expect(header()).not.toHaveClass('is-compact')
  })

  it('exactly fitting widths are stable: no extra commits when the width does not change', () => {
    let commits = 0
    render(
      <Profiler id="row" onRender={() => commits++}>
        <TeamHeader />
      </Profiler>
    )
    for (const w of [FULL, FULL - 1, FULL, FULL + 24, FULL]) resizeTo(w)
    const after = commits
    for (let i = 0; i < 8; i++) resizeTo(FULL)
    expect(commits).toBe(after)
  })

  it('caps the commit-driven re-plans per frame', () => {
    expect(MAX_REPLANS).toBe(2)
  })
})
