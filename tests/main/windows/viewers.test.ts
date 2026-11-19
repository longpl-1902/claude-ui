import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_VIEWER } from '../../../src/main/transcripts/viewer'
import { createViewerRouter, viewerIdOf } from '../../../src/main/windows/viewers'
import type { ManagedWindow } from '../../../src/main/windows/windowManager'

function win(senderId: number) {
  const w = { id: senderId - 100, senderId, destroyed: false, minimized: false, sent: [] as Array<[string, unknown]> }
  const api = {
    id: w.id,
    senderId,
    isDestroyed: () => w.destroyed,
    isMinimized: () => w.minimized,
    send: (c: string, p: unknown) => void w.sent.push([c, p])
  } as unknown as ManagedWindow
  return { w, api }
}

function setup() {
  const main = win(11)
  const pop = win(12)
  const wm = { main: () => main.api, all: () => [main.api, pop.api] }
  return { main, pop, router: createViewerRouter(() => wm) }
}

describe('viewer router', () => {
  it('maps main, negative ids and a missing manager to the default viewer; others to wc:N', () => {
    const { router } = setup()
    expect(router.viewerOf(11)).toBe(DEFAULT_VIEWER)
    expect(router.viewerOf(-1)).toBe(DEFAULT_VIEWER)
    expect(router.viewerOf(12)).toBe('wc:12')
    expect(viewerIdOf(12)).toBe('wc:12')
    expect(createViewerRouter(() => undefined).viewerOf(12)).toBe(DEFAULT_VIEWER)
  })

  it('windowOf and send reach the right window and skip destroyed ones', () => {
    const { router, main, pop } = setup()
    expect(router.windowOf(DEFAULT_VIEWER)).toBe(main.api)
    expect(router.windowOf('wc:12')).toBe(pop.api)
    expect(router.windowOf('wc:99')).toBeUndefined()
    expect(router.windowOf('other')).toBeUndefined()
    router.send('wc:12', 'team:changed', { a: 1 })
    expect(pop.w.sent).toEqual([['team:changed', { a: 1 }]])
    expect(main.w.sent).toEqual([])
    pop.w.destroyed = true
    router.send('wc:12', 'team:changed', { a: 2 })
    expect(pop.w.sent).toHaveLength(1)
    expect(() => router.send('wc:99', 'x', 1)).not.toThrow()
  })

  it('isShown is false when the window is missing, destroyed or minimized', () => {
    const { router, pop } = setup()
    expect(router.isShown('wc:12')).toBe(true)
    pop.w.minimized = true
    expect(router.isShown('wc:12')).toBe(false)
    pop.w.minimized = false
    pop.w.destroyed = true
    expect(router.isShown('wc:12')).toBe(false)
    expect(router.isShown('wc:99')).toBe(false)
  })

  it('a send that throws does not propagate', () => {
    const w = { id: 1, senderId: 5, isDestroyed: () => false, isMinimized: () => false, send: vi.fn(() => { throw new Error('gone') }) } as unknown as ManagedWindow
    const r = createViewerRouter(() => ({ main: () => w, all: () => [w] }))
    expect(() => r.send(DEFAULT_VIEWER, 'x', 1)).not.toThrow()
  })
})

describe('main/index.ts wiring (T36)', () => {
  const src = readFileSync(resolve(__dirname, '../../../src/main/index.ts'), 'utf8').replace(/\r\n/g, '\n')
  it('team:changed is no longer broadcast; viewers, release and isViewed are wired', () => {
    expect(src).not.toContain('broadcast(IPC.teamChanged')
    expect(src).toContain('createViewerHandlers(transcripts)')
    expect(src).toContain('releaseViewer(')
    expect(src).toContain('isViewed')
  })
})
