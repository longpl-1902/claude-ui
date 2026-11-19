// T21 / R-24, F2: OS toasts, taskbar flash and overlay count for NEW blocked items. All platform calls are fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNotifier } from '../../../src/main/attention/notifier'

const T0 = Date.parse('2026-11-19T10:00:00Z')
const PROJ = 'c:/users/u/acme'
const PROJ2 = 'c:/users/u/beta'

let n = 0
const item = (over: Record<string, unknown> = {}): any => ({
  id: `i${++n}`, kind: 'permission', severity: 'blocked', projectKey: PROJ, projectName: 'acme', accountId: 'acme', sessionId: 'S1', agentId: 'lead', agentName: 'Lead',
  detail: 'Bash: npm test', sinceMs: T0, external: true, ...over
})
const snap = (items: any[]): any => ({ items, projects: [], updatedAt: new Date(T0).toISOString() })

function setup(o: { focused?: boolean; prefs?: Record<string, unknown> } = {}) {
  const state = { focused: o.focused ?? false, prefs: { mutedProjects: [] as string[], dnd: false, notifyErrors: false, viewedProjectKey: undefined as string | undefined, ...(o.prefs ?? {}) } }
  const show = vi.fn((_n: { title: string; body: string; onClick: () => void }) => {})
  const flash = vi.fn((_on: boolean) => {})
  const overlay = vi.fn((_c: number) => {})
  const onFocusItem = vi.fn((_id: string) => {})
  const nt = createNotifier({ show, flash, overlay, isFocusedAndVisible: () => state.focused, prefs: () => state.prefs as never, onFocusItem } as never)
  return { nt, state, show, flash, overlay, onFocusItem }
}

beforeEach(() => {
  n = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())
const advance = (ms: number): void => void vi.setSystemTime(Date.now() + ms)

describe('R-24 toasts for new items', () => {
  it('R-24 a new permission item gets one toast: "<project> - <agent> needs permission: <detail>"', () => {
    const s = setup()
    s.nt.update(snap([item()]))
    expect(s.show).toHaveBeenCalledTimes(1)
    const t = s.show.mock.calls[0]![0]
    expect(t.body).toContain('acme')
    expect(t.body).toContain('Lead')
    expect(t.body).toContain('needs permission')
    expect(t.body).toContain('Bash: npm test')
    expect(typeof t.title).toBe('string')
  })
  it('R-24 the same item on later updates never toasts again', () => {
    const s = setup()
    const it1 = item()
    s.nt.update(snap([it1]))
    advance(10_000)
    s.nt.update(snap([it1]))
    advance(10_000)
    s.nt.update(snap([it1, item()]))
    expect(s.show).toHaveBeenCalledTimes(2)
  })
  it('R-24 an item that vanishes and returns with the same id is not announced again', () => {
    const s = setup()
    const it1 = item()
    s.nt.update(snap([it1]))
    s.nt.update(snap([]))
    advance(10_000)
    s.nt.update(snap([it1]))
    expect(s.show).toHaveBeenCalledTimes(1)
  })
  it('R-24 question, plan and input items toast; api-error only when notifyErrors is on', () => {
    for (const kind of ['question', 'plan', 'input']) {
      const s = setup()
      s.nt.update(snap([item({ kind })]))
      expect(s.show, kind).toHaveBeenCalledTimes(1)
    }
    const off = setup()
    off.nt.update(snap([item({ kind: 'api-error' })]))
    expect(off.show).not.toHaveBeenCalled()
    const on = setup({ prefs: { notifyErrors: true } })
    on.nt.update(snap([item({ kind: 'api-error' })]))
    expect(on.show).toHaveBeenCalledTimes(1)
  })
  it('R-24 the detail is cut to 80 characters', () => {
    const s = setup()
    s.nt.update(snap([item({ detail: 'd'.repeat(300) })]))
    const body = s.show.mock.calls[0]![0].body
    expect(body).not.toContain('d'.repeat(81))
    expect(body).toContain('d'.repeat(60))
  })
  it('R-24 clicking a toast focuses that item', () => {
    const s = setup()
    const it1 = item()
    s.nt.update(snap([it1]))
    s.show.mock.calls[0]![0].onClick()
    expect(s.onFocusItem).toHaveBeenCalledWith(it1.id)
  })
  it('F1 a toast never offers Allow: the payload is only title, body and onClick', () => {
    const s = setup()
    s.nt.update(snap([item({ toolName: 'Bash', input: 'rm -rf build', controlId: 'c1', requestId: 'r1' })]))
    expect(Object.keys(s.show.mock.calls[0]![0]).sort()).toEqual(['body', 'onClick', 'title'])
  })
})

describe('R-24 suppression rules', () => {
  it('R-24 muted projects get no toast; other projects still do', () => {
    const s = setup({ prefs: { mutedProjects: [PROJ] } })
    s.nt.update(snap([item(), item({ projectKey: PROJ2, projectName: 'beta' })]))
    expect(s.show).toHaveBeenCalledTimes(1)
    expect(s.show.mock.calls[0]![0].body).toContain('beta')
  })
  it('R-24 Do-not-disturb suppresses toasts', () => {
    const s = setup({ prefs: { dnd: true } })
    s.nt.update(snap([item()]))
    expect(s.show).not.toHaveBeenCalled()
  })
  it('R-24 no toast when the window is focused AND the item is in the viewed project', () => {
    const s = setup({ focused: true, prefs: { viewedProjectKey: PROJ } })
    s.nt.update(snap([item()]))
    expect(s.show).not.toHaveBeenCalled()
  })
  it('R-24 focused but another project is viewed -> toast; unfocused with the project viewed -> toast', () => {
    const a = setup({ focused: true, prefs: { viewedProjectKey: PROJ2 } })
    a.nt.update(snap([item()]))
    expect(a.show).toHaveBeenCalledTimes(1)
    const b = setup({ focused: false, prefs: { viewedProjectKey: PROJ } })
    b.nt.update(snap([item()]))
    expect(b.show).toHaveBeenCalledTimes(1)
  })
  it('R-24 at most one toast per 3 s; the rest are summarised as "+N more"', () => {
    const s = setup()
    s.nt.update(snap([item(), item({ agentName: 'rev' }), item({ agentName: 'qa' })]))
    expect(s.show).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(s.show.mock.calls)).toContain('+2 more')
  })
  it('R-24 after 3 s a newly arrived item may toast again', () => {
    const s = setup()
    s.nt.update(snap([item()]))
    advance(1000)
    s.nt.update(snap([item()]))
    expect(s.show).toHaveBeenCalledTimes(1)
    advance(2500)
    s.nt.update(snap([item()]))
    expect(s.show.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('F2 idle items are quiet', () => {
  const idle = (over: Record<string, unknown> = {}) => item({ kind: 'input', severity: 'idle', detail: 'idle_prompt', ...over })
  it('F2 an idle item never toasts by default', () => {
    const s = setup()
    s.nt.update(snap([idle()]))
    expect(s.show).not.toHaveBeenCalled()
  })
  it('F2 an idle item never flashes the taskbar and the overlay stays at 0', () => {
    const s = setup()
    s.nt.update(snap([idle(), idle()]))
    expect(s.flash.mock.calls.some((c) => c[0] === true)).toBe(false)
    expect(s.overlay).toHaveBeenLastCalledWith(0)
  })
  it('F2 idle items next to blocked ones do not change the count', () => {
    const s = setup()
    s.nt.update(snap([idle(), item(), idle()]))
    expect(s.overlay).toHaveBeenLastCalledWith(1)
  })
})

describe('F2 notifyIdle pref', () => {
  const idle = (over: Record<string, unknown> = {}) => item({ kind: 'input', severity: 'idle', detail: 'Ready for your next prompt', ...over })
  it('F2 with notifyIdle on an idle item toasts once; still no flash and overlay stays 0', () => {
    const s = setup({ prefs: { notifyIdle: true } })
    s.nt.update(snap([idle()]))
    expect(s.show).toHaveBeenCalledTimes(1)
    expect(s.show.mock.calls[0]![0].body).toContain('acme')
    expect(s.flash.mock.calls.some((c) => c[0] === true)).toBe(false)
    expect(s.overlay).toHaveBeenLastCalledWith(0)
  })
  it('F2 notifyIdle still respects dnd and muted projects', () => {
    const a = setup({ prefs: { notifyIdle: true, dnd: true } })
    a.nt.update(snap([idle()]))
    expect(a.show).not.toHaveBeenCalled()
    const b = setup({ prefs: { notifyIdle: true, mutedProjects: [PROJ] } })
    b.nt.update(snap([idle()]))
    expect(b.show).not.toHaveBeenCalled()
  })
})

describe('R-24 flash and overlay', () => {
  it('R-24 overlay shows the number of blocked items and 0 clears it', () => {
    const s = setup()
    s.nt.update(snap([item(), item(), item({ kind: 'question' })]))
    expect(s.overlay).toHaveBeenLastCalledWith(3)
    s.nt.update(snap([]))
    expect(s.overlay).toHaveBeenLastCalledWith(0)
  })
  it('R-24 flash(true) while blocked items exist and the window is not focused', () => {
    const s = setup({ focused: false })
    s.nt.update(snap([item()]))
    expect(s.flash).toHaveBeenLastCalledWith(true)
  })
  it('R-24 flash stops (false) when the window gets focus or the items are gone', () => {
    const s = setup({ focused: false })
    const it1 = item()
    s.nt.update(snap([it1]))
    s.state.focused = true
    s.nt.update(snap([it1]))
    expect(s.flash).toHaveBeenLastCalledWith(false)
    s.state.focused = false
    s.nt.update(snap([it1]))
    expect(s.flash).toHaveBeenLastCalledWith(true)
    s.nt.update(snap([]))
    expect(s.flash).toHaveBeenLastCalledWith(false)
  })
  it('R-24 a muted project does not flash', () => {
    const s = setup({ prefs: { mutedProjects: [PROJ] } })
    s.nt.update(snap([item()]))
    expect(s.flash.mock.calls.some((c) => c[0] === true)).toBe(false)
  })
  it('R-24 an empty first update calls neither show nor flash(true)', () => {
    const s = setup()
    s.nt.update(snap([]))
    expect(s.show).not.toHaveBeenCalled()
    expect(s.flash.mock.calls.some((c) => c[0] === true)).toBe(false)
    expect(s.overlay).toHaveBeenLastCalledWith(0)
  })
})
