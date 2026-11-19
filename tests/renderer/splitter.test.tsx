// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Splitter } from '@renderer/components/layout/Splitter'
import { fitWidths } from '@renderer/hooks/usePanelWidths'
import { TeamView } from '@renderer/screens/TeamView'
import { resetConsoleStore } from '@renderer/store/useConsoleStore'
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

const KEY = 'ac.panelWidths'
const setViewport = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}
const left = () => screen.getByRole('separator', { name: 'Resize worktrees panel' })
const right = () => screen.getByRole('separator', { name: 'Resize inspector panel' })
const cols = () => document.querySelector('.ac-team__cols') as HTMLElement
const now = (el: HTMLElement) => Number(el.getAttribute('aria-valuenow'))

beforeEach(() => {
  resetConsoleStore()
  seedDemoTeam()
  window.localStorage.clear()
  setViewport(1600)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.style.userSelect = ''
})

describe('Splitter a11y', () => {
  it('renders two labelled vertical separators with value attributes', () => {
    render(<TeamView />)
    for (const [el, min, max, val, id] of [
      [left(), 180, 480, 240, 'ac-left'],
      [right(), 280, 640, 360, 'ac-right']
    ] as const) {
      expect(el).toHaveAttribute('aria-orientation', 'vertical')
      expect(el).toHaveAttribute('tabindex', '0')
      expect(el).toHaveAttribute('aria-valuemin', String(min))
      expect(el).toHaveAttribute('aria-valuemax', String(max))
      expect(el).toHaveAttribute('aria-valuenow', String(val))
      expect(el).toHaveAttribute('aria-controls', id)
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(cols().style.getPropertyValue('--ac-left-w')).toBe('240px')
    expect(cols().style.getPropertyValue('--ac-right-w')).toBe('360px')
  })
})

describe('keyboard', () => {
  it('moves, clamps and resets the left panel', () => {
    render(<TeamView />)
    fireEvent.keyDown(left(), { key: 'ArrowRight' })
    expect(now(left())).toBe(256)
    fireEvent.keyDown(left(), { key: 'ArrowRight', shiftKey: true })
    expect(now(left())).toBe(320)
    fireEvent.keyDown(left(), { key: 'ArrowLeft' })
    expect(now(left())).toBe(304)
    fireEvent.keyDown(left(), { key: 'End' })
    expect(now(left())).toBe(480)
    fireEvent.keyDown(left(), { key: 'ArrowRight' })
    expect(now(left())).toBe(480)
    fireEvent.keyDown(left(), { key: 'Home' })
    expect(now(left())).toBe(180)
    fireEvent.keyDown(left(), { key: 'ArrowLeft' })
    expect(now(left())).toBe(180)
    fireEvent.keyDown(left(), { key: 'Enter' })
    expect(now(left())).toBe(240)
    expect(cols().style.getPropertyValue('--ac-left-w')).toBe('240px')
  })

  it('right splitter: ArrowLeft grows, double-click resets', () => {
    render(<TeamView />)
    fireEvent.keyDown(right(), { key: 'ArrowLeft' })
    expect(now(right())).toBe(376)
    fireEvent.keyDown(right(), { key: 'ArrowRight', shiftKey: true })
    expect(now(right())).toBe(312)
    fireEvent.keyDown(right(), { key: 'End' })
    expect(now(right())).toBe(640)
    fireEvent.doubleClick(right())
    expect(now(right())).toBe(360)
    expect(cols().style.getPropertyValue('--ac-right-w')).toBe('360px')
  })
})

describe('pointer drag', () => {
  it('drags the left splitter and restores user-select', () => {
    render(<TeamView />)
    fireEvent.pointerDown(left(), { clientX: 240, button: 0, pointerId: 1 })
    expect(document.body.style.userSelect).toBe('none')
    fireEvent.pointerMove(left(), { clientX: 300, pointerId: 1 })
    expect(now(left())).toBe(300)
    expect(cols().style.getPropertyValue('--ac-left-w')).toBe('300px')
    fireEvent.pointerUp(left(), { clientX: 300, pointerId: 1 })
    expect(document.body.style.userSelect).toBe('')
    fireEvent.pointerMove(left(), { clientX: 400, pointerId: 1 })
    expect(now(left())).toBe(300)
  })

  it('dragging the right splitter left widens the right panel, clamped', () => {
    render(<TeamView />)
    fireEvent.pointerDown(right(), { clientX: 1000, button: 0, pointerId: 1 })
    fireEvent.pointerMove(right(), { clientX: 940, pointerId: 1 })
    expect(now(right())).toBe(420)
    fireEvent.pointerMove(right(), { clientX: 100, pointerId: 1 })
    expect(now(right())).toBe(640)
    fireEvent.pointerUp(right(), { pointerId: 1 })
  })
})

describe('center minimum', () => {
  // T32 U6: below 1440 px the inspector is a drawer, so the two-column limit is exercised on the pure fit function.
  it('limits the dragged width so the center keeps 420px', () => {
    const w = fitWidths({ left: 240, right: 640 }, 1200) // avail = 1200 - 420 - 12 = 768
    expect(w).toEqual({ left: 240, right: 528 })
    expect(w.left + w.right).toBeLessThanOrEqual(768)
  })

  it('shrinks side widths when the window shrinks', () => {
    setViewport(1800)
    window.localStorage.setItem(KEY, JSON.stringify({ left: 480, right: 640 }))
    render(<TeamView />)
    expect(now(left()) + now(right())).toBe(1120)
    const w = fitWidths({ left: 480, right: 640 }, 1200)
    expect(w.left + w.right).toBeLessThanOrEqual(768)
    expect(w.left).toBeGreaterThanOrEqual(180)
    expect(w.right).toBeGreaterThanOrEqual(280)
  })

  it('below 1440 px the inspector is a drawer opened from the header, not a docked column', () => {
    setViewport(1200)
    render(<TeamView />)
    expect(screen.queryByRole('separator', { name: 'Resize inspector panel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('separator', { name: 'Resize worktrees panel' })).toBeInTheDocument()
  })

  it('between 1440 and 1599 px only one of worktrees / inspector is docked; opening one folds the other', () => {
    setViewport(1500)
    render(<TeamView />)
    expect(screen.queryByRole('separator', { name: 'Resize worktrees panel' })).toBeNull()
    expect(screen.getByRole('separator', { name: 'Resize inspector panel' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand worktrees panel' }))
    expect(screen.getByRole('separator', { name: 'Resize worktrees panel' })).toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize inspector panel' })).toBeNull()
    // The user's own widths are untouched by the folding.
    expect(JSON.parse(window.localStorage.getItem('ac.collapsed') ?? '{}')).not.toMatchObject({ rightCollapsed: true })
  })

  it('at 1600 px and wider both columns are docked', () => {
    setViewport(1600)
    render(<TeamView />)
    expect(left()).toBeInTheDocument()
    expect(right()).toBeInTheDocument()
  })
})

describe('persistence', () => {
  it('writes widths to localStorage and restores them', () => {
    const { unmount } = render(<TeamView />)
    fireEvent.keyDown(left(), { key: 'ArrowRight', shiftKey: true })
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ left: 304, right: 360 })
    unmount()
    render(<TeamView />)
    expect(now(left())).toBe(304)
  })

  it.each(['not json', '{"left":"x","right":null}', 'null', '[]'])('falls back to defaults for %s', (raw) => {
    window.localStorage.setItem(KEY, raw)
    render(<TeamView />)
    expect(now(left())).toBe(240)
    expect(now(right())).toBe(360)
  })

  it('clamps out-of-range stored values', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ left: 9999, right: 1 }))
    render(<TeamView />)
    expect(now(left())).toBe(480)
    expect(now(right())).toBe(280)
  })

  it('survives a throwing storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<TeamView />)
    expect(now(left())).toBe(240)
    fireEvent.keyDown(left(), { key: 'ArrowRight' })
    expect(now(left())).toBe(256)
  })
})

describe('Splitter unit', () => {
  it('ignores unrelated keys', () => {
    const onChange = vi.fn()
    render(
      <Splitter label="x" controls="y" value={10} min={0} max={20} defaultValue={5} side="left" onChange={onChange} />
    )
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Splitter horizontal unit', () => {
  const setup = (side: 'top' | 'bottom', value = 100) => {
    const onChange = vi.fn()
    render(
      <Splitter
        label="h"
        controls="y"
        value={value}
        min={50}
        max={300}
        defaultValue={120}
        side={side}
        onChange={onChange}
      />
    )
    return { el: screen.getByRole('separator'), onChange }
  }

  it('is a horizontal separator with a row-resize class', () => {
    const { el } = setup('top')
    expect(el).toHaveAttribute('aria-orientation', 'horizontal')
    expect(el.className).toContain('ac-splitter--h')
  })

  it('side=top: ArrowDown grows, ArrowUp shrinks, Shift is 64, Home/End/Enter', () => {
    const { el, onChange } = setup('top')
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(116)
    fireEvent.keyDown(el, { key: 'ArrowUp', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(36)
    fireEvent.keyDown(el, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(50)
    fireEvent.keyDown(el, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(300)
    fireEvent.keyDown(el, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(120)
    onChange.mockClear()
    fireEvent.keyDown(el, { key: 'ArrowLeft' })
    fireEvent.keyDown(el, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('side=bottom: ArrowUp grows, ArrowDown shrinks', () => {
    const { el, onChange } = setup('bottom')
    fireEvent.keyDown(el, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(116)
    fireEvent.keyDown(el, { key: 'ArrowDown', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(36)
  })

  it('drags with clientY and resets on double click', () => {
    const top = setup('top')
    fireEvent.pointerDown(top.el, { clientY: 200, clientX: 0, button: 0, pointerId: 1 })
    fireEvent.pointerMove(top.el, { clientY: 230, clientX: 999, pointerId: 1 })
    expect(top.onChange).toHaveBeenLastCalledWith(130)
    fireEvent.pointerUp(top.el, { pointerId: 1 })
    fireEvent.doubleClick(top.el)
    expect(top.onChange).toHaveBeenLastCalledWith(120)
  })

  it('side=bottom: dragging up grows', () => {
    const { el, onChange } = setup('bottom')
    fireEvent.pointerDown(el, { clientY: 200, button: 0, pointerId: 1 })
    fireEvent.pointerMove(el, { clientY: 170, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(130)
    fireEvent.pointerUp(el, { pointerId: 1 })
  })

  it('orientation=horizontal works with side left/right', () => {
    const onChange = vi.fn()
    render(
      <Splitter label="o" controls="y" value={10} min={0} max={20} defaultValue={5} side="left" orientation="horizontal" onChange={onChange} />
    )
    const el = screen.getByRole('separator')
    expect(el).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(26)
  })
})
