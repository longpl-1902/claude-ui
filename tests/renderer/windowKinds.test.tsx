// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '@renderer/components/chat/ChatView'
import { ProjectRail } from '@renderer/components/rail/ProjectRail'
import { ProjectSwitcher } from '@renderer/components/rail/ProjectSwitcher'
import { handleShortcut, SHORTCUTS, setShortcutBridge } from '@renderer/hooks/useShortcuts'
import { resetAttentionStore, useAttentionStore } from '@renderer/store/useAttentionStore'
import { resetCenterViewStore } from '@renderer/store/useCenterViewStore'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useSwitcherStore } from '@renderer/store/useSwitcherStore'
import { useWindowsStore } from '@renderer/store/useWindowsStore'
import { chatSpecForCurrent, currentPopOutSpec, getWindowSpec } from '@renderer/windowActions'
import { ChatWindow, guardSecondaryStorage } from '@renderer/windowKinds'
import { mockTeamSnapshot } from '@shared/mock'
import type { SessionSummary, WindowInfo } from '@shared/types'
import { project } from './attentionFixtures'

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

const KEY = 'c:/users/u/acme'
const sessions = [
  { sessionId: 's1', accountId: 'a1', configDir: '', projectDir: 'x', title: 'lead', mtimeMs: 1, sizeBytes: 1, live: true, project: { key: KEY, name: 'acme', root: 'C:/Users/u/acme', git: true } }
] as unknown as SessionSummary[]

const api = { open: vi.fn(), list: vi.fn(), focus: vi.fn(), close: vi.fn(), onChanged: vi.fn() }

function seedLive(): void {
  const t = { ...structuredClone(mockTeamSnapshot), source: 'live' as const, sessionId: 's1', accountId: 'a1', teamName: 'lead', console: [] }
  useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live', sessions, projectKey: KEY })
}

beforeEach(() => {
  window.localStorage.clear()
  resetConsoleStore()
  resetCenterViewStore()
  resetAttentionStore()
  useWindowsStore.setState({ list: [] })
  useSwitcherStore.setState({ isOpen: false })
  api.open.mockReset().mockResolvedValue({ ok: true, id: 5 })
  api.close.mockReset().mockResolvedValue({ ok: true })
  api.list.mockReset().mockResolvedValue([])
  api.onChanged.mockReset().mockReturnValue(() => undefined)
  ;(window as unknown as { api: unknown }).api = { windows: api }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  setShortcutBridge({})
})

describe('window kind from the URL', () => {
  it('main by default, chat / project from the query, malformed falls back to main', () => {
    expect(getWindowSpec('')).toEqual({ kind: 'main' })
    expect(getWindowSpec(`?kind=project&projectKey=${encodeURIComponent(KEY)}`)).toEqual({ kind: 'project', projectKey: KEY })
    expect(getWindowSpec(`?kind=chat&projectKey=${encodeURIComponent(KEY)}&sessionRef=${encodeURIComponent('a1|s1')}`)).toEqual({
      kind: 'chat',
      projectKey: KEY,
      sessionRef: 'a1|s1'
    })
    expect(getWindowSpec('?kind=chat&projectKey=acme')).toEqual({ kind: 'main' })
  })
})

describe('chat window', () => {
  it('renders only the chat (no project rail, no tab strip) and selects its own session once known', () => {
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const setProject = vi.fn()
    useConsoleStore.setState({ selectSession, setProject, sessions, projectKey: KEY })
    render(<ChatWindow spec={{ kind: 'chat', projectKey: KEY, sessionRef: 'a1|s1' }} />)
    expect(screen.getByRole('region', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(selectSession).toHaveBeenCalledWith({ mode: 'session', accountId: 'a1', sessionId: 's1' })
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull() // already popped out
  })

  it('waits until the session list contains the session', () => {
    const selectSession = vi.fn().mockResolvedValue(undefined)
    useConsoleStore.setState({ selectSession, sessions: [], projectKey: KEY })
    render(<ChatWindow spec={{ kind: 'chat', projectKey: KEY, sessionRef: 'a1|s1' }} />)
    expect(selectSession).not.toHaveBeenCalled()
    act(() => useConsoleStore.setState({ sessions }))
    expect(selectSession).toHaveBeenCalledTimes(1)
  })
})

describe('opening windows', () => {
  it('the Chat header button opens a chat window for the live session and nothing else', async () => {
    seedLive()
    render(<ChatView />)
    await userEvent.click(screen.getByRole('button', { name: 'Open in new window' }))
    expect(api.open).toHaveBeenCalledWith({ spec: { kind: 'chat', projectKey: KEY, sessionRef: 'a1|s1' } })
  })

  it('no pop-out button in demo mode', () => {
    useConsoleStore.setState({ teamMode: 'demo' })
    render(<ChatView />)
    expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull()
  })

  it('the rail context menu opens a project window', async () => {
    useAttentionStore.setState({ snapshot: { items: [], projects: [project(KEY)], updatedAt: '' }, pins: [] })
    useConsoleStore.setState({ sessions: [], projectKey: null })
    render(<ProjectRail />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /^acme,/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open in new window' }))
    expect(api.open).toHaveBeenCalledWith({ spec: { kind: 'project', projectKey: KEY } })
  })

  it('pop-out spec: chat while the Chat tab is on, else the project', () => {
    seedLive()
    expect(currentPopOutSpec()).toEqual({ kind: 'project', projectKey: KEY })
    expect(chatSpecForCurrent()).toEqual({ kind: 'chat', projectKey: KEY, sessionRef: 'a1|s1' })
    useConsoleStore.setState({ teamMode: 'demo' })
    expect(chatSpecForCurrent()).toBeNull()
  })

  it('a failed open (no api / rejected) is just false', async () => {
    delete (window as unknown as { api?: unknown }).api
    expect(await useWindowsStore.getState().open({ kind: 'project', projectKey: KEY })).toBe(false)
    ;(window as unknown as { api: unknown }).api = { windows: { ...api, open: vi.fn().mockRejectedValue(new Error('x')) } }
    expect(await useWindowsStore.getState().open({ kind: 'project', projectKey: KEY })).toBe(false)
  })
})

describe('shortcuts', () => {
  const key = (init: KeyboardEventInit, target?: HTMLElement) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    Object.defineProperty(e, 'target', { value: target ?? document.body })
    return handleShortcut(e)
  }

  it('Ctrl+Shift+N pops out; Ctrl+W closes only where a close action is installed', () => {
    const popOut = vi.fn()
    const closeWindow = vi.fn()
    setShortcutBridge({ popOut })
    expect(key({ key: 'N', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(popOut).toHaveBeenCalledTimes(1)
    expect(key({ key: 'w', ctrlKey: true })).toBe(false) // main window: normal close only
    setShortcutBridge({ popOut, closeWindow })
    expect(key({ key: 'w', ctrlKey: true })).toBe(true)
    expect(closeWindow).toHaveBeenCalledTimes(1)
    const ta = document.createElement('textarea')
    expect(key({ key: 'w', ctrlKey: true }, ta)).toBe(false)
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  it('both shortcuts are listed in the help and do not collide with existing keys', () => {
    const keys = SHORTCUTS.map((s) => s.keys)
    expect(keys).toContain('Ctrl+Shift+N')
    expect(keys).toContain('Ctrl+W')
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('switcher and shared state', () => {
  it('Ctrl+K lists open windows and Enter focuses the window', async () => {
    useConsoleStore.setState({ sessions, projectKey: KEY })
    const list: WindowInfo[] = [
      { id: 1, key: 'main', spec: { kind: 'main' }, focused: true },
      { id: 7, key: `chat:${KEY}:a1|s1`, spec: { kind: 'chat', projectKey: KEY, sessionRef: 'a1|s1' }, focused: false }
    ]
    render(<ProjectSwitcher />)
    act(() => useWindowsStore.getState().setList(list))
    act(() => useSwitcherStore.getState().open())
    await userEvent.type(screen.getByRole('combobox'), 'window')
    const opt = screen.getByRole('option', { name: /Window: Chat · acme \/ lead/ })
    expect(opt).toBeInTheDocument()
    await userEvent.click(opt)
    expect(api.focus).toHaveBeenCalledWith(7)
  })

  it('window:changed pushes update every window store (subscribe, no duplicate sessions)', () => {
    let push: ((l: WindowInfo[]) => void) | undefined
    api.onChanged.mockImplementation((cb: (l: WindowInfo[]) => void) => {
      push = cb
      return () => undefined
    })
    const off = useWindowsStore.getState().init()
    act(() => push?.([{ id: 1, key: 'main', spec: { kind: 'main' }, focused: true }]))
    expect(useWindowsStore.getState().list).toHaveLength(1)
    off()
  })
})

describe('storage guard in secondary windows', () => {
  it('does not overwrite the main window project / view choices but keeps other settings', () => {
    const orig = Storage.prototype.setItem
    try {
      guardSecondaryStorage()
      window.localStorage.setItem('ac.projectKey', 'other')
      window.localStorage.setItem('ac.viewState', '{}')
      window.localStorage.setItem('ac.density', 'compact')
      expect(window.localStorage.getItem('ac.projectKey')).toBeNull()
      expect(window.localStorage.getItem('ac.viewState')).toBeNull()
      expect(window.localStorage.getItem('ac.density')).toBe('compact')
    } finally {
      Storage.prototype.setItem = orig
    }
  })
})
