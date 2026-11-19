// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAttentionStore, useAttentionStore } from '@renderer/store/useAttentionStore'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { resetRailStore } from '@renderer/store/useRailStore'
import type { AttentionSnapshot } from '@shared/types'
import { NOW, item, project } from './attentionFixtures'

// T36: Ctrl+J asks main to route the jump to the window that shows the item.

const snap = (): AttentionSnapshot => ({
  items: [item('later', { sinceMs: NOW - 1000, projectKey: 'p-later' }), item('first', { sinceMs: NOW - 50_000, projectKey: 'p-first' })],
  projects: [project('d:/work/alpha')],
  updatedAt: ''
})

const realActions = (() => {
  const c = useConsoleStore.getState()
  return { navigate: c.navigate, setProject: c.setProject, selectSession: c.selectSession, selectAgent: c.selectAgent }
})()

function localSpies() {
  const setProject = vi.fn()
  const selectSession = vi.fn(async () => undefined)
  useConsoleStore.setState({ navigate: vi.fn(), setProject, selectSession, selectAgent: vi.fn() })
  return { setProject, selectSession }
}

beforeEach(() => {
  window.localStorage.clear()
  resetConsoleStore()
  useConsoleStore.setState(realActions)
  resetAttentionStore()
  resetRailStore()
  useAttentionStore.setState({ snapshot: snap() })
})
afterEach(() => {
  resetAttentionStore()
  delete (window as unknown as { api?: unknown }).api
})

describe('focusNext routed through main', () => {
  it('calls focusItem with the first item, sets focusedId and does not navigate locally', async () => {
    const focusItem = vi.fn().mockResolvedValue({ ok: true })
    ;(window as unknown as { api: unknown }).api = { attention: { focusItem } }
    const spies = localSpies()
    await useAttentionStore.getState().focusNext()
    expect(focusItem).toHaveBeenCalledWith('first')
    expect(useAttentionStore.getState().focusedId).toBe('first')
    expect(spies.setProject).not.toHaveBeenCalled()
    expect(spies.selectSession).not.toHaveBeenCalled()
  })

  it.each([
    ['{ok:false}', () => vi.fn().mockResolvedValue({ ok: false })],
    ['a rejection', () => vi.fn().mockRejectedValue(new Error('gone'))]
  ])('falls back to the local focus on %s', async (_name, make) => {
    const focusItem = make()
    ;(window as unknown as { api: unknown }).api = { attention: { focusItem } }
    const spies = localSpies()
    await useAttentionStore.getState().focusNext()
    expect(focusItem).toHaveBeenCalledWith('first')
    expect(spies.setProject).toHaveBeenCalledWith('p-first')
  })
})
