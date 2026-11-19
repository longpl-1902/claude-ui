// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControlSessionInfo, ControlStreamEvent, PermissionPrompt } from '@shared/types'
import {
  selectControlForSession,
  selectDraftControl,
  selectPendingPermissionCount,
  useControlStore
} from '@renderer/store/useControlStore'

const s = () => useControlStore.getState()

function info(over: Partial<ControlSessionInfo> = {}): ControlSessionInfo {
  return {
    id: 'c1',
    accountId: 'a1',
    cwd: '/p',
    state: 'idle',
    permissionMode: 'default',
    slashCommands: [],
    pendingPermissions: 0,
    queuedTurns: 0,
    ...over
  }
}
const prompt = (requestId: string): PermissionPrompt => ({
  requestId,
  toolName: 'Bash',
  displayName: 'Bash',
  inputPreview: 'ls',
  receivedAt: '2026-01-01T00:00:00Z'
})

function mockApi() {
  const control = {
    start: vi.fn(async () => ({ ok: true, controlId: 'c1' })),
    send: vi.fn(async () => ({ ok: true })),
    interrupt: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    answer: vi.fn(async () => ({ ok: true })),
    setModel: vi.fn(async () => ({ ok: true })),
    setMode: vi.fn(async () => ({ ok: true })),
    list: vi.fn(async () => [info()]),
    getStream: vi.fn(async () => null),
    onChanged: vi.fn(() => vi.fn()),
    onStream: vi.fn(() => vi.fn())
  }
  const team = { pauseAll: vi.fn(async () => ({ ok: true })) }
  ;(window as unknown as { api: unknown }).api = { control, team }
  return { control, team }
}

beforeEach(() => {
  useControlStore.setState({ sessions: [], streams: {}, error: undefined, startForm: { open: false } })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('stream reducer', () => {
  it('typing replaces text and typing-clear removes it', () => {
    s().applyStream([
      { controlId: 'c1', kind: 'typing', messageId: 'm', text: 'a' },
      { controlId: 'c1', kind: 'typing', messageId: 'm', text: 'ab' }
    ])
    expect(s().streams.c1!.typing).toEqual({ messageId: 'm', text: 'ab' })
    s().applyStream([{ controlId: 'c1', kind: 'typing-clear' }])
    expect(s().streams.c1!.typing).toBeUndefined()
  })

  it('permissions append, dedupe by requestId, and resolve', () => {
    s().applyStream([
      { controlId: 'c1', kind: 'permission', prompt: prompt('r1') },
      { controlId: 'c1', kind: 'permission', prompt: prompt('r1') },
      { controlId: 'c1', kind: 'permission', prompt: prompt('r2') }
    ])
    expect(s().streams.c1!.permissions.map((p) => p.requestId)).toEqual(['r1', 'r2'])
    s().applyStream([{ controlId: 'c1', kind: 'permission-resolved', requestId: 'r1' }])
    expect(s().streams.c1!.permissions.map((p) => p.requestId)).toEqual(['r2'])
  })

  it('turn-end clears typing/thinking and adds notices', () => {
    s().applyStream([
      { controlId: 'c1', kind: 'thinking', active: true },
      { controlId: 'c1', kind: 'typing', messageId: 'm', text: 'x' },
      { controlId: 'c1', kind: 'turn-end', result: 'interrupted' }
    ])
    expect(s().streams.c1!.typing).toBeUndefined()
    expect(s().streams.c1!.thinking).toBe(false)
    expect(s().streams.c1!.notices.at(-1)).toMatchObject({ level: 'info', text: 'Interrupted' })
    s().applyStream([{ controlId: 'c1', kind: 'turn-end', result: 'error', text: 'boom' }])
    expect(s().streams.c1!.notices.at(-1)).toMatchObject({ level: 'error', text: 'boom' })
  })

  it('caps notices at 20', () => {
    const evs: ControlStreamEvent[] = Array.from({ length: 30 }, (_, i) => ({
      controlId: 'c1',
      kind: 'notice',
      level: 'info',
      text: `n${i}`
    }))
    s().applyStream(evs)
    const n = s().streams.c1!.notices
    expect(n).toHaveLength(20)
    expect(n[0]!.text).toBe('n10')
    expect(n[19]!.text).toBe('n29')
  })

  it('applySessions drops streams of removed sessions', () => {
    s().applySessions([info({ id: 'c1' }), info({ id: 'c2' })])
    s().applyStream([
      { controlId: 'c1', kind: 'thinking', active: true },
      { controlId: 'c2', kind: 'thinking', active: true }
    ])
    s().applySessions([info({ id: 'c2' })])
    expect(Object.keys(s().streams)).toEqual(['c2'])
  })
})

describe('selectors', () => {
  it('finds control by sessionId, newest draft, and pending permission count', () => {
    s().applySessions([
      info({ id: 'c1', sessionId: 'S1' }),
      info({ id: 'd1', state: 'draft' }),
      info({ id: 'd2', state: 'draft' }),
      info({ id: 'c3', pendingPermissions: 2 })
    ])
    expect(selectControlForSession('S1')(s())?.id).toBe('c1')
    expect(selectControlForSession(undefined)(s())).toBeUndefined()
    expect(selectDraftControl(s())?.id).toBe('d2')
    expect(selectPendingPermissionCount(s())).toBe(2)
    s().applyStream([{ controlId: 'c1', kind: 'permission', prompt: prompt('r') }])
    expect(selectPendingPermissionCount(s())).toBe(3)
  })
})

describe('init and actions', () => {
  it('init subscribes, loads the list, and unsubscribes', async () => {
    const { control } = mockApi()
    const offA = vi.fn()
    const offB = vi.fn()
    control.onChanged.mockReturnValue(offA)
    control.onStream.mockReturnValue(offB)
    const off = s().init()
    await vi.waitFor(() => expect(s().sessions).toHaveLength(1))
    off()
    expect(offA).toHaveBeenCalled()
    expect(offB).toHaveBeenCalled()
  })

  it('forwards actions to window.api', async () => {
    const { control } = mockApi()
    await s().start({ cwd: '/p', accountId: 'a1' })
    await s().interrupt('c1')
    await s().stop('c1')
    await s().answer('c1', 'r', { behavior: 'allow' })
    await s().setModel('c1', 'opus')
    await s().setMode('c1', 'plan')
    expect(control.start).toHaveBeenCalledWith({ cwd: '/p', accountId: 'a1' })
    expect(control.interrupt).toHaveBeenCalledWith('c1')
    expect(control.stop).toHaveBeenCalledWith('c1')
    expect(control.answer).toHaveBeenCalledWith('c1', 'r', { behavior: 'allow' })
    expect(control.setModel).toHaveBeenCalledWith('c1', 'opus')
    expect(control.setMode).toHaveBeenCalledWith('c1', 'plan')
  })

  it('interruptAll interrupts busy sessions, calls team.pauseAll and returns the count', async () => {
    const { control, team } = mockApi()
    s().applySessions([info({ id: 'a', state: 'busy' }), info({ id: 'b', state: 'idle' }), info({ id: 'c', state: 'busy' })])
    expect(await s().interruptAll()).toBe(2)
    expect(control.interrupt).toHaveBeenCalledTimes(2)
    expect(team.pauseAll).toHaveBeenCalledTimes(1)
  })

  it('actions are harmless without window.api', async () => {
    expect(await s().send('c1', 'hi')).toMatchObject({ ok: false })
    expect(await s().start({ cwd: '/p', accountId: 'a' })).toMatchObject({ ok: false })
    expect(() => s().init()()).not.toThrow()
  })

  it('records an error when an IPC call rejects', async () => {
    const { control } = mockApi()
    control.stop.mockRejectedValueOnce(new Error('nope'))
    expect(await s().stop('c1')).toMatchObject({ ok: false })
    expect(s().error).toBe('nope')
  })
})

describe('start form flag', () => {
  it('opens and closes without any IPC', () => {
    const { control } = mockApi()
    s().openStartForm({ cwd: '/p', accountId: 'a1' })
    expect(s().startForm).toEqual({ open: true, cwd: '/p', accountId: 'a1' })
    s().openStartForm()
    expect(s().startForm).toEqual({ open: true })
    s().closeStartForm()
    expect(s().startForm).toEqual({ open: false })
    for (const fn of Object.values(control)) expect(fn).not.toHaveBeenCalled()
  })
})

describe('R-19 no autonomous sends', () => {
  it('only send() calls control.send; init and every other action never send or start', async () => {
    const { control } = mockApi()
    const off = s().init()
    await vi.waitFor(() => expect(control.list).toHaveBeenCalled())
    s().applySessions([info({ id: 'c1', state: 'busy' })])
    s().applyStream([{ controlId: 'c1', kind: 'turn-end', result: 'success' }])
    s().openStartForm({ cwd: '/p' })
    s().closeStartForm()
    await s().interrupt('c1')
    await s().stop('c1')
    await s().interruptAll()
    await s().answer('c1', 'r', { behavior: 'deny' })
    await s().setModel('c1', null)
    await s().setMode('c1', 'auto')
    off()
    expect(control.send).not.toHaveBeenCalled()
    expect(control.start).not.toHaveBeenCalled()
    await s().send('c1', 'hello')
    expect(control.send).toHaveBeenCalledTimes(1)
    expect(control.send).toHaveBeenCalledWith('c1', 'hello')
  })
})
