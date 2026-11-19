import { describe, expect, it } from 'vitest'
import { THEME_IPC, WINDOW_IPC } from '../../src/shared/ipc'
import { parseOpenRequest, parseWindowSpec, specFromSearch, specToQuery, windowKey } from '../../src/shared/windowSpec'

describe('window specs and channels', () => {
  it('window channels follow the naming pattern and stay apart from the theme channels', () => {
    expect(WINDOW_IPC).toEqual({ open: 'window:open', list: 'window:list', focus: 'window:focus', close: 'window:close', changed: 'window:changed' })
    for (const c of Object.values(WINDOW_IPC)) expect(c).toMatch(/^window:[a-z-]+$/)
    expect(Object.values(THEME_IPC)).not.toContain(WINDOW_IPC.changed)
  })

  it('validates specs and drops extra fields', () => {
    expect(parseWindowSpec({ kind: 'project', projectKey: 'acme', evil: 1 })).toEqual({ kind: 'project', projectKey: 'acme' })
    expect(parseWindowSpec({ kind: 'chat', projectKey: 'acme', sessionRef: 'a|s' })).toEqual({ kind: 'chat', projectKey: 'acme', sessionRef: 'a|s' })
    expect(parseWindowSpec({ kind: 'chat', projectKey: 'acme', sessionRef: 'nosep' })).toBeNull()
    expect(parseWindowSpec({ kind: 'project', projectKey: '' })).toBeNull()
    expect(parseWindowSpec({ kind: 'project', projectKey: 'a\u0000b' })).toBeNull()
    expect(parseWindowSpec({ kind: 'project', projectKey: 'x'.repeat(5000) })).toBeNull()
    expect(parseWindowSpec(null)).toBeNull()
    expect(parseWindowSpec('project')).toBeNull()
  })

  it('validates open requests', () => {
    expect(parseOpenRequest({ spec: { kind: 'project', projectKey: 'acme' }, at: { x: 10.4, y: 5 } })).toEqual({
      spec: { kind: 'project', projectKey: 'acme' },
      at: { x: 10, y: 5 }
    })
    expect(parseOpenRequest({ spec: { kind: 'project', projectKey: 'acme' }, at: { x: '1', y: 2 } })).toBeNull()
    expect(parseOpenRequest({ spec: { kind: 'project', projectKey: 'acme' }, at: { x: 1e9, y: 2 } })).toBeNull()
    expect(parseOpenRequest({})).toBeNull()
  })

  it('keys are stable and the query round-trips', () => {
    const chat = { kind: 'chat', projectKey: 'c:/users/u/acme', sessionRef: 'a|s1' } as const
    expect(windowKey({ kind: 'main' })).toBe('main')
    expect(windowKey(chat)).toBe('chat:c:/users/u/acme:a|s1')
    const q = new URLSearchParams(specToQuery(chat)).toString()
    expect(specFromSearch(`?${q}`)).toEqual(chat)
    expect(specFromSearch('')).toEqual({ kind: 'main' })
    expect(specFromSearch('?kind=chat&projectKey=acme')).toEqual({ kind: 'main' })
  })
})
