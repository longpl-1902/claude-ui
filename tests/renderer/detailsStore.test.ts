// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ControlDetails } from '@shared/types'
import { selectCommands, useDetailsStore } from '@renderer/store/useDetailsStore'

const s = () => useDetailsStore.getState()
const ok = async () => ({ ok: true })

function det(over: Partial<ControlDetails> = {}): ControlDetails {
  return {
    controlId: 'c1',
    commands: [],
    agents: [],
    models: [],
    availableOutputStyles: [],
    mcp: [],
    tools: [],
    sessionCostUsd: 0,
    userTurns: [],
    checkpointing: true,
    ...over
  }
}

function mockApi() {
  let pushed: ((d: ControlDetails) => void) | undefined
  const control = {
    send: vi.fn(ok),
    start: vi.fn(ok),
    details: vi.fn(async () => det({ title: 't' })),
    sendRich: vi.fn(ok),
    refreshContext: vi.fn(ok),
    mcpToggle: vi.fn(ok),
    mcpReconnect: vi.fn(ok),
    fileSuggestions: vi.fn(async (_id: string | null, _cwd: string, q: string) => [{ path: q }]),
    rewindPreview: vi.fn(async () => ({ canRewind: true, filesChanged: ['a'], insertions: 1, deletions: 0 })),
    rewind: vi.fn(ok),
    forkAt: vi.fn(async () => ({ ok: true, controlId: 'c2' })),
    setEffort: vi.fn(ok),
    setOutputStyle: vi.fn(ok),
    rename: vi.fn(ok),
    getPlan: vi.fn(async () => ({ exists: true, content: 'p' })),
    onDetails: vi.fn((cb: (d: ControlDetails) => void) => {
      pushed = cb
      return vi.fn()
    })
  }
  ;(window as unknown as { api: unknown }).api = { control }
  return { control, push: (d: ControlDetails) => pushed?.(d) }
}

beforeEach(() => {
  useDetailsStore.setState({ byControl: {} })
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { api?: unknown }).api
})

describe('details store', () => {
  it('load stores details and init applies pushes', async () => {
    const { control, push } = mockApi()
    const off = s().init()
    await s().load('c1')
    expect(s().byControl.c1!.title).toBe('t')
    push(det({ controlId: 'c9', sessionCostUsd: 2 }))
    expect(s().byControl.c9!.sessionCostUsd).toBe(2)
    off()
    expect(control.send).not.toHaveBeenCalled()
    expect(control.start).not.toHaveBeenCalled()
    expect(control.sendRich).not.toHaveBeenCalled()
  })

  it('read/refresh/preview actions never send or start', async () => {
    const { control } = mockApi()
    await s().load('c1')
    await s().refreshContext('c1')
    await s().rewindPreview('c1', 'u1')
    await s().getPlan('c1')
    await s().setEffort('c1', 'high')
    await s().setOutputStyle('c1', 'concise')
    await s().rename('c1', 'x')
    await s().mcpToggle('c1', 'm', false)
    await s().mcpReconnect('c1', 'm')
    expect(control.send).not.toHaveBeenCalled()
    expect(control.sendRich).not.toHaveBeenCalled()
    expect(control.start).not.toHaveBeenCalled()
    expect(control.forkAt).not.toHaveBeenCalled()
    expect(control.rewind).not.toHaveBeenCalled()
    expect(control.setEffort).toHaveBeenCalledWith('c1', 'high')
    expect(control.mcpToggle).toHaveBeenCalledWith('c1', 'm', false)
  })

  it('rewind, forkAt and sendRich only call IPC when invoked explicitly', async () => {
    const { control } = mockApi()
    expect(await s().forkAt('c1', 'u1')).toEqual({ ok: true, controlId: 'c2' })
    await s().rewind('c1', 'u1')
    const img = { mediaType: 'image/png' as const, dataBase64: 'AA' }
    await s().sendRich('c1', 'hi', [img])
    expect(control.sendRich).toHaveBeenCalledWith('c1', 'hi', [img])
    expect(control.send).not.toHaveBeenCalled()
  })

  it('falls back safely without window.api', async () => {
    expect(await s().sendRich('c1', 'x', [])).toEqual({ ok: false, reason: 'unavailable' })
    expect(await s().load('c1')).toBeNull()
    expect(await s().getPlan('c1')).toEqual({ exists: false })
    expect((await s().rewindPreview('c1', 'u')).canRewind).toBe(false)
  })

  it('fileSuggestions debounces 120ms and latest wins', async () => {
    const { control } = mockApi()
    const p1 = s().fileSuggestions('c1', '/p', 'a')
    await vi.advanceTimersByTimeAsync(60)
    const p2 = s().fileSuggestions('c1', '/p', 'ab')
    await vi.advanceTimersByTimeAsync(119)
    expect(control.fileSuggestions).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(control.fileSuggestions).toHaveBeenCalledTimes(1)
    expect(control.fileSuggestions).toHaveBeenCalledWith('c1', '/p', 'ab')
    expect(await p1).toEqual([])
    expect(await p2).toEqual([{ path: 'ab' }])
  })
})

describe('selectCommands', () => {
  it('returns builtin fallback when details are absent', () => {
    const names = selectCommands('nope')(s()).map((c) => c.name)
    for (const n of ['help', 'clear', 'compact', 'model', 'cost', 'context', 'mcp', 'agents', 'memory', 'review', 'init'])
      expect(names).toContain(n)
    expect(selectCommands(undefined)(s())).toHaveLength(11)
  })

  it('merges details commands with builtins, deduped, details win', () => {
    useDetailsStore.setState({
      byControl: {
        c1: det({
          commands: [
            { name: 'help', description: 'custom help', source: 'user' },
            { name: 'deploy', description: 'd', source: 'project' }
          ]
        })
      }
    })
    const list = selectCommands('c1')(s())
    expect(list.filter((c) => c.name === 'help')).toHaveLength(1)
    expect(list.find((c) => c.name === 'help')!.description).toBe('custom help')
    expect(list.some((c) => c.name === 'deploy')).toBe(true)
    expect(list.some((c) => c.name === 'init')).toBe(true)
  })
})
