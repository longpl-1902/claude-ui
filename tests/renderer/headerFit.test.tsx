// @vitest-environment jsdom
import './jestDom'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OVERFLOW_ORDER, TeamHeader } from '@renderer/components/team/TeamHeader'
import { neededWidth, planOverflow } from '@renderer/hooks/useOverflowItems'
import type { OverflowPlanInput } from '@renderer/hooks/useOverflowItems'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'
import { seedDemoTeam } from './seedTeam'

// Natural widths (px) of the overflowable items and of the never-moved ones. The shrinkable ones use their minimum.
const OI: Record<string, number> = {
  note: 150,
  tokens: 80,
  tokensToday: 100,
  counters: 130,
  hooks: 100,
  extensions: 80,
  pause: 150,
  new: 210
}
// demo header: brand 130, repo min 120, badge 70, picker min 160, back 80, chip min 120, needs 80, is-needs 100
const FIXED_SUM = 130 + 120 + 70 + 160 + 80 + 120 + 80 + 100

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
    return this.classList.contains('ac-header') ? width : 0
  })
  stub(HTMLElement.prototype, 'offsetWidth', function () {
    const oi = this.dataset.oi
    if (oi !== undefined) return oi === 'note' && this.classList.contains('ac-header__note--icon') ? 16 : (OI[oi] ?? 0)
    if (this.classList.contains('ac-header__brand')) return this.parentElement?.classList.contains('is-compact') ? 22 : 130
    if (this.classList.contains('ac-header__badge')) return 70
    if (this.classList.contains('ac-header__fixed')) return 80
    if (this.classList.contains('is-needs')) return 100
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

const NAMES: Record<string, RegExp> = {
  pause: /^Pause all/,
  new: /^\+ New/,
  hooks: /^Hooks:/,
  extensions: /^Extensions$/
}

/** Overflowable ids currently shown in the header row itself (not in the menu). */
function visibleIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.ac-header [data-oi]'))
    .map((n) => n.dataset.oi ?? '')
    .filter((id) => id !== 'note')
}
const header = (): HTMLElement => document.querySelector('.ac-header') as HTMLElement
const hiddenIds = (container: HTMLElement): string[] => OVERFLOW_ORDER.filter((id) => id !== 'note' && !visibleIds(container).includes(id))

describe('planOverflow (pure)', () => {
  const base: OverflowPlanInput = {
    order: OVERFLOW_ORDER,
    widths: OI,
    collapse: { note: 16 },
    fixed: FIXED_SUM,
    fixedCount: 8,
    gap: 12,
    avail: 1920
  }
  it('needs 1878 px with everything visible and less each step', () => {
    expect(neededWidth({ ...base, widths: { ...OI, note: 0 } }, 0)).toBe(FIXED_SUM + 850 + 12 * 14)
    let prev = Infinity
    for (let k = 1; k <= OVERFLOW_ORDER.length; k++) {
      const n = neededWidth({ ...base, widths: { ...OI, note: 0 } }, k)
      expect(n).toBeLessThan(prev)
      prev = n
    }
  })
  it('collapses the note to an icon before moving anything', () => {
    // 1 step: only the note shrinks (150 -> 16); nothing is hidden yet.
    const withNote = { ...base, avail: 1800 }
    expect(neededWidth(withNote, 0)).toBeGreaterThan(1800)
    expect(neededWidth(withNote, 1)).toBeLessThanOrEqual(neededWidth(withNote, 0) - 134)
    expect(planOverflow({ ...base, avail: neededWidth(base, 1) }, 0)).toBe(1)
  })
  it('moves everything when even the last step does not fit', () => {
    expect(planOverflow({ ...base, avail: 300 })).toBe(OVERFLOW_ORDER.length)
  })
})

describe('T35 header fit at real window widths', () => {
  it('1920: everything fits, no overflow menu', () => {
    const { container } = render(<TeamHeader />)
    resizeTo(1920)
    expect(hiddenIds(container)).toEqual([])
    expect(screen.queryByRole('button', { name: 'More header actions' })).toBeNull()
    expect(screen.getByRole('button', { name: NAMES.pause! })).toBeInTheDocument()
    expect(screen.getByText(/Tokens today/)).toBeInTheDocument()
  })

  it('1536: tokens, tokens today, counters and Hooks move; Extensions, Pause and New stay', async () => {
    const { container } = render(<TeamHeader />)
    resizeTo(1536)
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks'])
    expect(visibleIds(container)).toEqual(['pause', 'new', 'extensions'])
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([expect.stringMatching(NAMES.hooks!)])
    expect(menu).toHaveTextContent(/Tokens/)
    expect(menu).toHaveTextContent(/agents/)
    expect(within(menu).queryByRole('menuitem', { name: NAMES.pause! })).toBeNull()
  })

  it('1366: only + New stays in the row; the other six are in the menu', async () => {
    const { container } = render(<TeamHeader />)
    resizeTo(1366)
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks', 'extensions', 'pause'])
    expect(visibleIds(container)).toEqual(['new'])
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    const names = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((m) => m.textContent)
    expect(names).toEqual(['Pause all', expect.stringMatching(/^Hooks:/), 'Extensions'])
  })

  it('the hidden set follows the priority order at every width and the visible row always fits', () => {
    const { container } = render(<TeamHeader />)
    let prevHidden = 0
    for (let w = 1920; w >= 900; w -= 20) {
      resizeTo(w)
      const hidden = hiddenIds(container)
      // hidden is always a prefix of the priority list (note excluded: it shrinks instead)
      expect(hidden).toEqual(OVERFLOW_ORDER.filter((id) => id !== 'note').slice(0, hidden.length))
      expect(hidden.length).toBeGreaterThanOrEqual(prevHidden)
      prevHidden = hidden.length
      const visibleSum = visibleIds(container).reduce((n, id) => n + (OI[id] ?? 0), 0)
      const moreCount = hidden.length > 0 ? 1 : 0
      const count = 8 + visibleIds(container).length + moreCount
      const total = FIXED_SUM + visibleSum + (moreCount ? 44 : 0) + 12 * (count - 1)
      // once even everything moved does not fit, the fixed part is what overflows (brand drops its title)
      if (hidden.length < 7) expect(total).toBeLessThanOrEqual(w)
    }
    expect(hiddenIds(container)).toHaveLength(7)
  })

  it('never moves the brand, title, badge, session picker, need-you button, session counter or account chip', () => {
    const { container } = render(<TeamHeader />)
    for (const w of [1920, 1536, 1366, 1100, 900]) {
      resizeTo(w)
      expect(container.querySelector('.ac-header__brand')).toBeInTheDocument()
      expect(container.querySelector('.ac-header__team')).toBeInTheDocument()
      expect(screen.getByText(/DEMO/)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Session' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /need you/ })).toBeInTheDocument()
      expect(container.querySelector('.is-needs')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Manage accounts/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Back to live' })).toBeInTheDocument()
    }
  })

  it('subtracts the right padding reserved for the window controls', () => {
    const { container } = render(<TeamHeader />)
    header().style.paddingRight = '140px'
    resizeTo(1536)
    // content box 1396 px: needs the 1366 layout's neighbour (k=6: 1384 <= 1396)
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks', 'extensions'])
  })

  it('collapses the history note to an info icon with a tooltip before hiding anything', () => {
    useConsoleStore.setState({ team: { ...useConsoleStore.getState().team, historyTruncated: true } })
    const { container } = render(<TeamHeader />)
    resizeTo(2100)
    expect(screen.getByText('older history not loaded')).toBeInTheDocument()
    // 1878 + 150 + 12 = 2040 with the note; icon form = 1878 + 16 + 12 = 1906
    resizeTo(1910)
    expect(screen.queryByText('older history not loaded')).toBeNull()
    expect(screen.getByRole('img', { name: 'Older history not loaded' })).toHaveAttribute('title', 'older history not loaded')
    expect(hiddenIds(container)).toEqual([])
  })

  it('shows a dot on the "..." button when a hidden item has a non-zero count', () => {
    render(<TeamHeader />)
    resizeTo(1536)
    const more = screen.getByRole('button', { name: 'More header actions' })
    const hasDot = more.querySelector('.ac-header__more-dot') !== null
    const store = useConsoleStore.getState().team
    expect(hasDot).toBe(store.agents.length > 0)
  })
})

describe('T35 hysteresis', () => {
  it('hides as soon as it overflows but only returns an item with 24 px to spare', () => {
    const { container } = render(<TeamHeader />)
    resizeTo(1536) // Hooks and above hidden (k=5 needs 1476; k=4 needs 1588)
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks'])
    resizeTo(1600) // k=4 would fit (1588) but not with 24 px slack
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks'])
    resizeTo(1611)
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks'])
    resizeTo(1612) // 1588 + 24
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters'])
    resizeTo(1590) // back inside the dead band: stays
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters'])
    resizeTo(1587) // really overflows
    expect(hiddenIds(container)).toEqual(['tokens', 'tokensToday', 'counters', 'hooks'])
  })
})

describe('T35 overflow menu keyboard and ARIA', () => {
  async function openMenu(): Promise<HTMLElement> {
    render(<TeamHeader />)
    resizeTo(1366)
    const more = screen.getByRole('button', { name: 'More header actions' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    return more
  }

  it('focuses the first item on open, arrows skip disabled items and wrap, Home/End jump', async () => {
    await openMenu()
    const menu = screen.getByRole('menu')
    const pause = within(menu).getByRole('menuitem', { name: 'Pause all' })
    const ext = within(menu).getByRole('menuitem', { name: 'Extensions' })
    expect(within(menu).getByRole('menuitem', { name: /^Hooks:/ })).toBeDisabled() // demo
    expect(pause).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(ext).toHaveFocus() // Hooks (disabled) skipped
    await userEvent.keyboard('{ArrowDown}')
    expect(pause).toHaveFocus() // wraps
    await userEvent.keyboard('{ArrowUp}')
    expect(ext).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(pause).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(ext).toHaveFocus()
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

  it('closes when the window grows until nothing is hidden', async () => {
    await openMenu()
    resizeTo(1920)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More header actions' })).toBeNull()
  })
})
