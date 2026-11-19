// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControlSessionInfo } from '@shared/types'
import { ShortcutsHelp } from '@renderer/components/ui/ShortcutsHelp'
import { SHORTCUTS, setShortcutBridge, useShortcuts } from '@renderer/hooks/useShortcuts'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { resetLayoutStore, useLayoutStore } from '@renderer/store/useLayoutStore'
import { seedDemoTeam } from './seedTeam'

function Harness({ disabledPrompt = false }: { disabledPrompt?: boolean }) {
  useShortcuts()
  return (
    <div>
      <input id="ac-prompt" aria-label="Message the lead" disabled={disabledPrompt} />
      <input aria-label="other field" />
      <button type="button">btn</button>
      <ShortcutsHelp />
    </div>
  )
}

const s = () => useConsoleStore.getState()
const key = (k: string, init: KeyboardEventInit = {}, target: Element | Window = document.body) =>
  fireEvent.keyDown(target, { key: k, ...init })

const control = (over: Partial<ControlSessionInfo> = {}): ControlSessionInfo =>
  ({
    id: 'c1',
    accountId: 'a',
    cwd: '/r',
    state: 'busy',
    permissionMode: 'default',
    slashCommands: [],
    pendingPermissions: 0,
    queuedTurns: 0,
    sessionId: 's1',
    ...over
  }) as ControlSessionInfo

let api: { control: { interrupt: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } }

beforeEach(() => {
  resetConsoleStore()
  resetLayoutStore()
  seedDemoTeam()
  useControlStore.setState({ sessions: [], streams: {} })
  setShortcutBridge({})
  api = { control: { interrupt: vi.fn().mockResolvedValue({ ok: true }), send: vi.fn().mockResolvedValue({ ok: true }) } }
  ;(window as unknown as { api: unknown }).api = api
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  setShortcutBridge({})
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 })
})

describe('R-20 / D12 global shortcuts', () => {
  it('Ctrl+L focuses the prompt, also from another input', () => {
    render(<Harness />)
    screen.getByLabelText('other field').focus()
    key('l', { ctrlKey: true }, screen.getByLabelText('other field'))
    expect(screen.getByLabelText('Message the lead')).toHaveFocus()
  })

  it('Ctrl+L does nothing when the prompt is disabled', () => {
    render(<Harness disabledPrompt />)
    key('l', { ctrlKey: true })
    expect(screen.getByLabelText('Message the lead')).not.toHaveFocus()
  })

  it('Ctrl+Shift+T / Ctrl+Shift+A navigate Team / Accounts', () => {
    render(<Harness />)
    key('A', { ctrlKey: true, shiftKey: true })
    expect(s().screen).toBe('accounts')
    key('T', { ctrlKey: true, shiftKey: true })
    expect(s().screen).toBe('team')
  })

  it('Ctrl+B / Ctrl+I toggle the left and right column', () => {
    render(<Harness />)
    key('b', { ctrlKey: true })
    expect(useLayoutStore.getState().leftCollapsed).toBe(true)
    key('i', { ctrlKey: true })
    expect(useLayoutStore.getState().rightCollapsed).toBe(true)
    key('b', { ctrlKey: true })
    key('i', { ctrlKey: true })
    expect(useLayoutStore.getState().leftCollapsed).toBe(false)
    expect(useLayoutStore.getState().rightCollapsed).toBe(false)
  })

  it('Ctrl+` toggles the raw terminal', () => {
    render(<Harness />)
    key('`', { ctrlKey: true })
    expect(s().rawTerminalOpen).toBe(true)
    key('`', { ctrlKey: true })
    expect(s().rawTerminalOpen).toBe(false)
  })

  it('Alt+Up / Alt+Down select the previous / next agent and wrap', () => {
    render(<Harness />)
    const ids = s().team.agents.map((a) => a.id)
    useConsoleStore.setState({ selectedAgentId: ids[0]! })
    key('ArrowDown', { altKey: true })
    expect(s().selectedAgentId).toBe(ids[1])
    key('ArrowUp', { altKey: true })
    key('ArrowUp', { altKey: true })
    expect(s().selectedAgentId).toBe(ids.at(-1))
  })

  it('Ctrl+. interrupts the bound controlled session only when it is busy, and never sends', () => {
    useConsoleStore.setState({ teamMode: 'live', team: { ...s().team, sessionId: 's1' } })
    render(<Harness />)
    useControlStore.setState({ sessions: [control({ state: 'idle' })] })
    key('.', { ctrlKey: true })
    expect(api.control.interrupt).not.toHaveBeenCalled()
    act(() => useControlStore.setState({ sessions: [control({ state: 'busy' })] }))
    key('.', { ctrlKey: true })
    expect(api.control.interrupt).toHaveBeenCalledWith('c1')
    expect(api.control.interrupt).toHaveBeenCalledTimes(1)
    expect(api.control.send).not.toHaveBeenCalled()
  })

  it('Ctrl+. is a no-op for a session that is not bound to the viewed team', () => {
    useConsoleStore.setState({ teamMode: 'live', team: { ...s().team, sessionId: 'other' } })
    useControlStore.setState({ sessions: [control({ state: 'busy' })] })
    render(<Harness />)
    key('.', { ctrlKey: true })
    expect(api.control.interrupt).not.toHaveBeenCalled()
  })

  it('calls the injected T22 actions: Ctrl+K, Ctrl+1..9, Ctrl+J, Ctrl+Shift+J', () => {
    const b = { openSwitcher: vi.fn(), goToPinned: vi.fn(), focusNext: vi.fn(), focusPrev: vi.fn() }
    setShortcutBridge(b)
    render(<Harness />)
    key('k', { ctrlKey: true })
    key('3', { ctrlKey: true })
    key('j', { ctrlKey: true })
    key('J', { ctrlKey: true, shiftKey: true })
    expect(b.openSwitcher).toHaveBeenCalledTimes(1)
    expect(b.goToPinned).toHaveBeenCalledWith(3)
    expect(b.focusNext).toHaveBeenCalledTimes(1)
    expect(b.focusPrev).toHaveBeenCalledTimes(1)
  })

  it('does not swallow Ctrl+K / Ctrl+1 when nothing is bound', () => {
    render(<Harness />)
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('ignores every shortcut while an IME composition is active', () => {
    render(<Harness />)
    key('b', { ctrlKey: true, isComposing: true })
    key('?', { isComposing: true })
    key('ArrowDown', { altKey: true, isComposing: true })
    expect(useLayoutStore.getState().leftCollapsed).toBe(false)
    expect(s().shortcutsOpen).toBe(false)
  })
})

describe('typing in inputs', () => {
  it('does not trigger ? or Alt+Arrow inside a text input', () => {
    render(<Harness />)
    const input = screen.getByLabelText('other field')
    const before = s().selectedAgentId
    key('?', {}, input)
    key('ArrowDown', { altKey: true }, input)
    expect(s().shortcutsOpen).toBe(false)
    expect(s().selectedAgentId).toBe(before)
  })

  it('still lets the documented Ctrl combos through inside an input', () => {
    render(<Harness />)
    const input = screen.getByLabelText('other field')
    key('b', { ctrlKey: true }, input)
    expect(useLayoutStore.getState().leftCollapsed).toBe(true)
  })

  it('leaves plain Ctrl combos to the terminal but keeps Ctrl+`', () => {
    render(
      <div className="xterm">
        <textarea aria-label="term" />
        <Harness />
      </div>
    )
    const term = screen.getByLabelText('term')
    key('b', { ctrlKey: true }, term)
    expect(useLayoutStore.getState().leftCollapsed).toBe(false)
    key('`', { ctrlKey: true }, term)
    expect(s().rawTerminalOpen).toBe(true)
  })
})

describe('shortcut help', () => {
  it('opens with ? and closes with Esc', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    key('?', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    key('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc inside the dialog closes it too', () => {
    render(<Harness />)
    key('?')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists every shortcut, including the T22 and T33 keys', () => {
    render(<Harness />)
    key('?')
    for (const sc of SHORTCUTS) {
      expect(screen.getByText(sc.keys, { selector: 'kbd' })).toBeInTheDocument()
      expect(screen.getByText(sc.action)).toBeInTheDocument()
    }
    const keys = SHORTCUTS.map((x) => x.keys).join(' | ')
    for (const k of ['Ctrl+K', 'Ctrl+1', 'Ctrl+J', 'Ctrl+Shift+J', 'Ctrl+L', 'Ctrl+B', 'Ctrl+I', 'Ctrl+.', 'Alt+Up', 'Ctrl+Shift+C', 'Ctrl+Shift+M', '?']) {
      expect(keys).toContain(k)
    }
  })

  it('narrow window (900 px): help still opens, lists everything and Ctrl+I still works', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 })
    window.dispatchEvent(new Event('resize'))
    render(<Harness />)
    key('?')
    const list = screen.getByRole('list', { name: 'Keyboard shortcuts' })
    expect(list.querySelectorAll('li')).toHaveLength(SHORTCUTS.length)
    // Rows wrap instead of overflowing horizontally.
    expect((list.querySelector('li') as HTMLElement).style.flexWrap).toBe('wrap')
    key('Escape')
    key('i', { ctrlKey: true })
    expect(useLayoutStore.getState().rightCollapsed).toBe(true)
  })
})
