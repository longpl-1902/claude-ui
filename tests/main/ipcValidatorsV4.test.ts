// T01: validators + mock stubs added to handlers.ts for contract v4 (R-01, R-19).
import { describe, expect, it } from 'vitest'
import * as H from '../../src/main/ipc/handlers'

const h = H as any
const ok = { cwd: 'C:/Users/u/acme', accountId: 'acme' }

describe('R-01 isControlStartRequest', () => {
  it('R-01 accepts the minimal request and every optional field', () => {
    expect(h.isControlStartRequest(ok)).toBe(true)
    expect(h.isControlStartRequest({ ...ok, confirmed: true, model: 'opus', permissionMode: 'plan' })).toBe(true)
    expect(h.isControlStartRequest({ ...ok, resume: { kind: 'continue' } })).toBe(true)
    expect(h.isControlStartRequest({ ...ok, resume: { kind: 'resume', sessionId: 'abc', fork: true } })).toBe(true)
  })
  it('R-01 rejects non-objects, missing/overlong strings and bad enums', () => {
    for (const v of [null, undefined, 1, 'x', [], {}, { cwd: 'C:/x' }, { accountId: 'a' }]) expect(h.isControlStartRequest(v)).toBe(false)
    expect(h.isControlStartRequest({ ...ok, cwd: 'x'.repeat(1025) })).toBe(false)
    expect(h.isControlStartRequest({ ...ok, permissionMode: 'bypassPermissions' })).toBe(false)
    expect(h.isControlStartRequest({ ...ok, permissionMode: 'manual' })).toBe(false)
    expect(h.isControlStartRequest({ ...ok, confirmed: 'yes' })).toBe(false)
  })
  it('R-01 model must match ^[A-Za-z0-9._\[\]-]{1,64}$', () => {
    for (const m of ['opus', 'claude-sonnet-4.5', 'sonnet[1m]', 'a'.repeat(64)]) expect(h.isControlStartRequest({ ...ok, model: m })).toBe(true)
    for (const m of ['', 'a'.repeat(65), 'bad model', 'x;rm', '--flag ', 'a/b']) expect(h.isControlStartRequest({ ...ok, model: m })).toBe(false)
  })
  it('R-01 resume shape is checked', () => {
    for (const r of [{ kind: 'resume' }, { kind: 'resume', sessionId: 5 }, { kind: 'other' }, 'continue', { kind: 'resume', sessionId: 'a', fork: 'y' }]) {
      expect(h.isControlStartRequest({ ...ok, resume: r })).toBe(false)
    }
  })
})

describe('R-01 isPermissionAnswer', () => {
  it('R-01 accepts allow/deny with optional message and scope', () => {
    expect(h.isPermissionAnswer({ behavior: 'allow' })).toBe(true)
    expect(h.isPermissionAnswer({ behavior: 'allow', scope: 'session' })).toBe(true)
    expect(h.isPermissionAnswer({ behavior: 'deny', message: 'no' })).toBe(true)
  })
  it('R-01 rejects other behaviors, scopes and non-string messages', () => {
    for (const v of [null, 'allow', {}, { behavior: 'maybe' }, { behavior: 'allow', scope: 'forever' }, { behavior: 'deny', message: 3 }, { behavior: 'deny', message: 'x'.repeat(5000) }]) {
      expect(h.isPermissionAnswer(v)).toBe(false)
    }
  })
})

describe('R-01 isKillExternalRequest', () => {
  const good = { accountId: 'acme', sessionId: '11111111-aaaa-4bbb-8ccc-000000000001', pid: 4242 }
  it('R-01 accepts a positive integer pid and short strings', () => expect(h.isKillExternalRequest(good)).toBe(true))
  it('R-01 rejects non-positive / fractional / string pids and long strings', () => {
    for (const pid of [0, -1, 1.5, '4242', NaN, Infinity]) expect(h.isKillExternalRequest({ ...good, pid })).toBe(false)
    expect(h.isKillExternalRequest({ ...good, sessionId: 'x'.repeat(1025) })).toBe(false)
    expect(h.isKillExternalRequest({ accountId: 'a' })).toBe(false)
    expect(h.isKillExternalRequest(null)).toBe(false)
  })
})

describe('R-01 isAttentionPrefs', () => {
  const good = { mutedProjects: ['c:/users/u/acme'], dnd: false, notifyErrors: true }
  it('R-01 accepts the prefs shape with optional viewedProjectKey', () => {
    expect(h.isAttentionPrefs(good)).toBe(true)
    expect(h.isAttentionPrefs({ ...good, viewedProjectKey: 'c:/users/u/acme' })).toBe(true)
  })
  it('R-01 rejects non-string array items, > 200 items and wrong types', () => {
    expect(h.isAttentionPrefs({ ...good, mutedProjects: [1] })).toBe(false)
    expect(h.isAttentionPrefs({ ...good, mutedProjects: Array.from({ length: 201 }, (_, i) => `p${i}`) })).toBe(false)
    expect(h.isAttentionPrefs({ ...good, dnd: 'no' })).toBe(false)
    expect(h.isAttentionPrefs({ ...good, notifyErrors: undefined })).toBe(false)
    expect(h.isAttentionPrefs(null)).toBe(false)
  })
})

describe('R-01 / R-19 mock v4 handlers never start anything', () => {
  const handlers = (): any => H.createHandlers() as any
  it('R-19 control:start returns ok:false for good and bad args; control:list is empty; get-stream null', async () => {
    const hs = handlers()
    expect((await hs['control:start']({}, ok)).ok).toBe(false)
    const bad = await hs['control:start']({}, { nope: 1 })
    expect(bad).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await hs['control:list']({})).toEqual([])
    expect(await hs['control:get-stream']({}, 'c1')).toBeNull()
  })
  it('R-01 git / hooks / attention stubs', async () => {
    const hs = handlers()
    const snap = await hs['git:watch']({}, 'C:/Users/u/acme')
    expect(snap).toMatchObject({ root: 'C:/Users/u/acme', base: null, worktrees: [], overlaps: [] })
    expect(snap.updatedAt).toBe(new Date(0).toISOString())
    expect(await hs['git:compare']({}, 'C:/Users/u/acme', 'a.ts')).toEqual([])
    expect(await hs['hooks:status']({}, null)).toMatchObject({ state: 'unavailable', reason: 'not-implemented' })
    expect((await hs['hooks:apply']({}, 'p1')).ok).toBe(false)
    expect((await hs['attention:get']({})).items).toEqual([])
    expect(await hs['attention:get-prefs']({})).toEqual({ mutedProjects: [], dnd: false, notifyErrors: false })
    expect((await hs['attention:set-prefs']({}, { mutedProjects: [], dnd: false, notifyErrors: false })).ok).toBe(false)
  })
})
