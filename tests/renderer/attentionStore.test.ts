// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAttentionStore, sortItems, useAttentionStore } from '@renderer/store/useAttentionStore'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { resetRailStore, useRailStore } from '@renderer/store/useRailStore'
import { useSwitcherStore } from '@renderer/store/useSwitcherStore'
import type { AttentionSnapshot } from '@shared/types'
import { NOW, item, project } from './attentionFixtures'

const snap = (over: Partial<AttentionSnapshot> = {}): AttentionSnapshot => ({
  items: [],
  projects: [project('d:/work/alpha'), project('d:/work/beta')],
  updatedAt: '',
  ...over
})

function fakeApi() {
  let onChanged: ((s: AttentionSnapshot) => void) | undefined
  let onFocus: ((e: { itemId: string }) => void) | undefined
  const off = vi.fn()
  const api = {
    get: vi.fn().mockResolvedValue(snap()),
    getPrefs: vi.fn().mockResolvedValue({ mutedProjects: [], dnd: false, notifyErrors: false }),
    setPrefs: vi.fn().mockResolvedValue({ ok: true }),
    onChanged: vi.fn((cb) => {
      onChanged = cb
      return off
    }),
    onFocus: vi.fn((cb) => {
      onFocus = cb
      return off
    })
  }
  ;(window as unknown as { api: unknown }).api = { attention: api }
  return { api, off, push: (s: AttentionSnapshot) => onChanged!(s), focus: (id: string) => onFocus!({ itemId: id }) }
}

const realActions = (() => {
  const c = useConsoleStore.getState()
  return { navigate: c.navigate, setProject: c.setProject, selectSession: c.selectSession, selectAgent: c.selectAgent }
})()

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  window.localStorage.clear()
  resetConsoleStore()
  useConsoleStore.setState(realActions)
  resetAttentionStore()
  resetRailStore()
  useSwitcherStore.setState({ isOpen: false })
})
afterEach(() => {
  resetAttentionStore()
  delete (window as unknown as { api?: unknown }).api
})

describe('useAttentionStore init', () => {
  it('loads the snapshot and prefs, applies pushes, and unsubscribes', async () => {
    const f = fakeApi()
    const off = useAttentionStore.getState().init()
    await flush()
    expect(f.api.get).toHaveBeenCalled()
    expect(useAttentionStore.getState().snapshot.projects).toHaveLength(2)
    f.push(snap({ items: [item('i1')] }))
    expect(useAttentionStore.getState().snapshot.items).toHaveLength(1)
    off()
    expect(f.off).toHaveBeenCalledTimes(2)
  })

  it('a second init shares the subscription (rail and header both call it)', () => {
    const f = fakeApi()
    const a = useAttentionStore.getState().init()
    const b = useAttentionStore.getState().init()
    expect(f.api.onChanged).toHaveBeenCalledTimes(1)
    a()
    expect(f.off).not.toHaveBeenCalled()
    b()
    expect(f.off).toHaveBeenCalledTimes(2)
  })

  it('is safe without window.api', () => {
    expect(() => useAttentionStore.getState().init()()).not.toThrow()
  })

  it('pushes the viewed project to main when it changes', async () => {
    const f = fakeApi()
    useAttentionStore.getState().init()
    await flush()
    useConsoleStore.setState({ projectKey: 'd:/work/alpha' })
    expect(f.api.setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ viewedProjectKey: 'd:/work/alpha' }))
    useConsoleStore.setState({ projectKey: 'd:/work/beta' })
    expect(f.api.setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ viewedProjectKey: 'd:/work/beta' }))
  })

  it('a notification click (onFocus) runs focusItem', async () => {
    const f = fakeApi()
    useAttentionStore.getState().init()
    useAttentionStore.setState({ snapshot: snap({ items: [item('n1', { projectKey: 'd:/work/beta' })] }) })
    const setProject = vi.fn()
    useConsoleStore.setState({ setProject })
    f.focus('n1')
    await flush()
    expect(setProject).toHaveBeenCalledWith('d:/work/beta')
  })
})

describe('pins, mute, DND', () => {
  it('keeps pins in the order they were made and persists them', () => {
    const s = useAttentionStore.getState()
    s.pin('b')
    s.pin('a')
    s.pin('b')
    expect(useAttentionStore.getState().pins).toEqual(['b', 'a'])
    expect(JSON.parse(window.localStorage.getItem('ac.pinnedProjects')!)).toEqual(['b', 'a'])
    useAttentionStore.getState().unpin('b')
    expect(useAttentionStore.getState().pins).toEqual(['a'])
  })

  it('survives unavailable storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => useAttentionStore.getState().pin('a')).not.toThrow()
    expect(useAttentionStore.getState().pins).toEqual(['a'])
    spy.mockRestore()
  })

  it('mute and DND write the full prefs through setPrefs', async () => {
    const f = fakeApi()
    useAttentionStore.getState().mute('a', true)
    await flush()
    expect(f.api.setPrefs).toHaveBeenLastCalledWith({ mutedProjects: ['a'], dnd: false, notifyErrors: false })
    useAttentionStore.getState().setDnd(true)
    await flush()
    expect(f.api.setPrefs).toHaveBeenLastCalledWith({ mutedProjects: ['a'], dnd: true, notifyErrors: false })
    useAttentionStore.getState().mute('a', false)
    expect(useAttentionStore.getState().prefs.mutedProjects).toEqual([])
  })
})

describe('focusItem', () => {
  function setup(over: Parameters<typeof item>[1] = {}) {
    const calls: string[] = []
    const navigate = vi.fn(() => void calls.push('navigate'))
    const setProject = vi.fn(() => void calls.push('setProject'))
    const selectSession = vi.fn(async () => void calls.push('selectSession'))
    const selectAgent = vi.fn(() => void calls.push('selectAgent'))
    useConsoleStore.setState({ navigate, setProject, selectSession, selectAgent, screen: 'accounts', projectKey: 'd:/work/alpha' })
    useAttentionStore.setState({ snapshot: snap({ items: [item('x1', over)] }) })
    return { calls, navigate, setProject, selectSession, selectAgent }
  }

  it('F4: navigates to the team screen first, then project, session, agent', async () => {
    const m = setup({ projectKey: 'd:/work/beta', sessionId: 's9', agentId: 'ag1' })
    await useAttentionStore.getState().focusItem('x1')
    expect(m.calls).toEqual(['navigate', 'setProject', 'selectSession', 'selectAgent'])
    expect(m.navigate).toHaveBeenCalledWith('team')
    expect(m.setProject).toHaveBeenCalledWith('d:/work/beta')
    expect(m.selectSession).toHaveBeenCalledWith({ mode: 'session', accountId: 'acc1', sessionId: 's9' })
    expect(m.selectAgent).toHaveBeenCalledWith('ag1')
  })

  it('does not re-select a session that is already viewed, nor the same project', async () => {
    const m = setup()
    useConsoleStore.setState({ selection: { mode: 'session', accountId: 'acc1', sessionId: 's1' } })
    await useAttentionStore.getState().focusItem('x1')
    expect(m.setProject).not.toHaveBeenCalled()
    expect(m.selectSession).not.toHaveBeenCalled()
    expect(m.selectAgent).toHaveBeenCalledWith('lead')
  })

  it('ignores unknown ids', async () => {
    const m = setup()
    await useAttentionStore.getState().focusItem('nope')
    expect(m.navigate).not.toHaveBeenCalled()
  })
})

describe('focusNext / focusPrev', () => {
  it('walks blocked items oldest first, then ready items, and wraps', async () => {
    const setProject = vi.fn()
    useConsoleStore.setState({ navigate: vi.fn(), setProject, selectSession: vi.fn(async () => undefined), selectAgent: vi.fn() })
    const items = [
      item('idle1', { severity: 'idle', sinceMs: NOW - 99_000_000, projectKey: 'p-idle' }),
      item('new', { sinceMs: NOW - 1000, projectKey: 'p-new' }),
      item('old', { sinceMs: NOW - 50_000, projectKey: 'p-old' })
    ]
    expect(sortItems(items).map((i) => i.id)).toEqual(['old', 'new', 'idle1'])
    useAttentionStore.setState({ snapshot: snap({ items }) })
    const s = useAttentionStore.getState()
    await s.focusNext()
    await s.focusNext()
    await s.focusNext()
    await s.focusNext()
    expect(setProject.mock.calls.map((c) => c[0])).toEqual(['p-old', 'p-new', 'p-idle', 'p-old'])
    await s.focusPrev()
    expect(setProject.mock.calls.at(-1)![0]).toBe('p-idle')
  })

  it('does nothing without items', async () => {
    const navigate = vi.fn()
    useConsoleStore.setState({ navigate })
    await useAttentionStore.getState().focusNext()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('goToPinned / switcher', () => {
  it('Ctrl+1..9 target: goToPinned uses the fixed pin order and skips missing projects', () => {
    const setProject = vi.fn()
    const navigate = vi.fn()
    useConsoleStore.setState({ setProject, navigate, projectKey: 'd:/work/alpha' })
    useAttentionStore.setState({ snapshot: snap(), pins: ['d:/work/beta', 'gone', 'd:/work/alpha'] })
    expect(useRailStore.getState().goToPinned(1)).toBe(true)
    expect(setProject).toHaveBeenLastCalledWith('d:/work/beta')
    expect(navigate).toHaveBeenCalledWith('team')
    expect(useRailStore.getState().goToPinned(2)).toBe(true) // alpha is already current: no setProject
    expect(setProject).toHaveBeenCalledTimes(1)
    expect(useRailStore.getState().goToPinned(3)).toBe(false)
  })

  it('useSwitcherStore.open() opens on any screen', () => {
    useConsoleStore.setState({ screen: 'accounts' })
    useSwitcherStore.getState().open()
    expect(useSwitcherStore.getState().isOpen).toBe(true)
    expect(useConsoleStore.getState().screen).toBe('team')
    useSwitcherStore.getState().close()
    expect(useSwitcherStore.getState().isOpen).toBe(false)
  })

  it('persists the rail width choice', () => {
    useRailStore.getState().setExpanded(false)
    expect(window.localStorage.getItem('ac.railExpanded')).toBe('false')
  })
})
