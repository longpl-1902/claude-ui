// T04 / R-17: hook settings installer (merge / unmerge / preview / apply). In-memory fs, synthetic paths.
import { describe, expect, it } from 'vitest'
import {
  HOOK_MARKER,
  buildHookEntry,
  createHookInstaller,
  hooksState,
  isOurHook,
  mergeHooks,
  unmergeHooks
} from '../../../src/main/hooks/hookInstaller'
import { HOOK_EVENTS } from '../../../src/main/hooks/hookPayload'

const NODE = 'C:/Program Files/nodejs/node.exe'
const SCRIPT = 'C:/Users/u/AppData/Roaming/agent-console/hook/agent-console-hook.cjs'
const ROOT = 'C:/Users/u/acme'
const SETTINGS = 'C:/Users/u/acme/.claude/settings.local.json'
const BAK = SETTINGS + '.agent-console.bak'
const entry = () => buildHookEntry(NODE, SCRIPT)
const text = (o: unknown): string => JSON.stringify(o, null, 2) + '\n'

function memFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const log: string[] = []
  return {
    files,
    log,
    fs: {
      async readText(p: string) { return files.has(p) ? files.get(p)! : null },
      async writeTextAtomic(p: string, t: string) { log.push(`write:${p}`); files.set(p, t) },
      async mkdirp(p: string) { log.push(`mkdir:${p}`) },
      async remove(p: string) { log.push(`remove:${p}`); files.delete(p) }
    }
  }
}
function installer(initial: Record<string, string> = {}) {
  const m = memFs(initial)
  let n = 0
  const inst = createHookInstaller({ fs: m.fs, newId: () => `p${++n}`, platform: 'win32' })
  return { ...m, inst }
}

describe('R-17 buildHookEntry / isOurHook', () => {
  it('R-17 entry is an async exec-form command hook, timeout 10', () => {
    expect(entry()).toEqual({ type: 'command', command: NODE, args: [SCRIPT], async: true, timeout: 10 })
  })
  it('R-17 isOurHook recognises our entry by the marker, not foreign hooks', () => {
    expect(HOOK_MARKER).toBe('agent-console-hook')
    expect(isOurHook(entry())).toBe(true)
    expect(isOurHook({ type: 'command', command: 'node C:/x/agent-console-hook.cjs' })).toBe(true)
    expect(isOurHook({ type: 'command', command: 'echo hi' })).toBe(false)
    expect(isOurHook({ type: 'command', command: 'node', args: ['other.cjs'] })).toBe(false)
    for (const v of [null, undefined, 'x', 3, {}, []]) expect(isOurHook(v)).toBe(false)
  })
})

describe('R-17 mergeHooks', () => {
  it('R-17 empty settings get one group per event with our entry and no matcher', () => {
    const out = mergeHooks({}, entry()) as any
    expect(Object.keys(out.hooks)).toEqual([...HOOK_EVENTS])
    for (const ev of HOOK_EVENTS) {
      expect(out.hooks[ev]).toEqual([{ hooks: [entry()] }])
      expect('matcher' in out.hooks[ev][0]).toBe(false)
    }
  })
  it('R-17 other keys and foreign hooks/groups are untouched; ours is appended', () => {
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] }
    const src = { permissions: { allow: ['Bash(npm test)'] }, model: 'opus', hooks: { PreToolUse: [foreign], Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }
    const out = mergeHooks(src, entry()) as any
    expect(out.permissions).toEqual(src.permissions)
    expect(out.model).toBe('opus')
    expect(out.hooks.PreToolUse[0]).toEqual(foreign)
    expect(out.hooks.PreToolUse[1]).toEqual({ hooks: [entry()] })
    expect(out.hooks.Stop[0]).toEqual(src.hooks.Stop[0])
    expect(out.hooks.Stop).toHaveLength(2)
    expect(Object.keys(out)).toEqual(['permissions', 'model', 'hooks'])
  })
  it('R-17 the input object is not mutated', () => {
    const src = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }
    const copy = JSON.parse(JSON.stringify(src))
    mergeHooks(src, entry())
    expect(src).toEqual(copy)
  })
  it('R-17 is idempotent', () => {
    const once = mergeHooks({}, entry())
    expect(mergeHooks(once, entry())).toEqual(once)
  })
  it('R-17 an outdated entry (old script path) is replaced, not duplicated', () => {
    const old = mergeHooks({}, buildHookEntry('C:/old/node.exe', 'C:/old/agent-console-hook.cjs'))
    const out = mergeHooks(old, entry()) as any
    for (const ev of HOOK_EVENTS) {
      const ours = out.hooks[ev].flatMap((g: any) => g.hooks).filter(isOurHook)
      expect(ours).toEqual([entry()])
    }
  })
})

describe('R-17 unmergeHooks', () => {
  it('R-17 removes only our hooks and keeps foreign ones', () => {
    const foreign = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] }
    const merged = mergeHooks({ hooks: { PreToolUse: [foreign] }, model: 'opus' }, entry())
    const out = unmergeHooks(merged) as any
    expect(out).toEqual({ hooks: { PreToolUse: [foreign] }, model: 'opus' })
  })
  it('R-17 groups with a foreign hook next to ours keep the foreign one', () => {
    const src = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }, entry()] }] } }
    expect((unmergeHooks(src) as any).hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'echo done' }] }])
  })
  it('R-17 empty groups, empty events and an empty hooks key are dropped', () => {
    expect(unmergeHooks(mergeHooks({}, entry()))).toEqual({})
    expect(unmergeHooks(mergeHooks({ model: 'x' }, entry()))).toEqual({ model: 'x' })
  })
  it('R-17 settings without hooks come back equal', () => {
    expect(unmergeHooks({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('R-17 hooksState', () => {
  it('R-17 null / no hooks -> not-installed', () => {
    expect(hooksState(null, entry())).toBe('not-installed')
    expect(hooksState({}, entry())).toBe('not-installed')
    expect(hooksState({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] } }, entry())).toBe('not-installed')
  })
  it('R-17 all 16 present and equal -> installed', () => {
    expect(hooksState(mergeHooks({}, entry()) as any, entry())).toBe('installed')
  })
  it('R-17 only some events -> partial', () => {
    const m = mergeHooks({}, entry()) as any
    delete m.hooks.Stop
    expect(hooksState(m, entry())).toBe('partial')
  })
  it('R-17 ours but a different command/args -> outdated', () => {
    const old = mergeHooks({}, buildHookEntry(NODE, 'C:/old/agent-console-hook.cjs')) as any
    expect(hooksState(old, entry())).toBe('outdated')
  })
  it('R-17 entry null (node missing) still reports not-installed / installed-ish without throwing', () => {
    expect(() => hooksState(mergeHooks({}, entry()) as any, null)).not.toThrow()
    expect(hooksState({}, null)).toBe('not-installed')
  })
})

describe('R-17 installer.read / settingsPathFor', () => {
  it('R-17 settingsPathFor joins <root>/.claude/settings.local.json', () => {
    const { inst } = installer()
    expect(inst.settingsPathFor(ROOT).replace(/\\/g, '/')).toBe(SETTINGS)
  })
  it('R-17 read: missing file, valid object, invalid json, non-object', async () => {
    expect(await installer().inst.read(ROOT)).toMatchObject({ text: null, json: null })
    expect((await installer({ [SETTINGS]: '{"a":1}' }).inst.read(ROOT)).json).toEqual({ a: 1 })
    expect((await installer({ [SETTINGS]: '{oops' }).inst.read(ROOT)).error).toBe('invalid-json')
    expect((await installer({ [SETTINGS]: '[1,2]' }).inst.read(ROOT)).error).toBe('not-object')
    expect((await installer({ [SETTINGS]: '"s"' }).inst.read(ROOT)).error).toBe('not-object')
  })
})

describe('R-17 installer.preview', () => {
  it('R-17 install on a missing file: before null, after = exact JSON text, notes and paths', async () => {
    const { inst } = installer()
    const p: any = await inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect(p.previewId).toBeTruthy()
    expect(p).toMatchObject({ action: 'install', before: null, scriptPath: SCRIPT })
    expect(p.settingsPath.replace(/\\/g, '/')).toBe(SETTINGS)
    expect(p.after).toBe(text(mergeHooks({}, entry())))
    expect(p.backupPath.replace(/\\/g, '/')).toBe(BAK)
    const notes = p.notes.join('\n')
    expect(notes).toContain('settings.local.json')
    expect(notes).toContain('agent-console-hook.cjs')
    expect(notes.toLowerCase()).toContain('asynchronously')
    expect(notes.toLowerCase()).toContain('restart')
  })
  it('R-17 install on an existing file: before is the current text verbatim, after merges', async () => {
    const cur = '{ "permissions": { "allow": ["Bash(ls)"] } }\n'
    const { inst } = installer({ [SETTINGS]: cur })
    const p: any = await inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect(p.before).toBe(cur)
    expect(p.after).toBe(text(mergeHooks({ permissions: { allow: ['Bash(ls)'] } }, entry())))
  })
  it('R-17 invalid JSON / non-object files are refused (never overwritten)', async () => {
    for (const [content, reason] of [['{oops', 'invalid-json'], ['[]', 'not-object']] as const) {
      const r: any = await installer({ [SETTINGS]: content }).inst.preview(ROOT, 'install', entry(), SCRIPT)
      expect(r.ok).toBe(false)
      expect(String(r.reason)).toContain(reason)
    }
  })
  it('R-17 install when already installed -> nothing-to-do', async () => {
    const { inst } = installer({ [SETTINGS]: text(mergeHooks({}, entry())) })
    const r: any = await inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect(r).toEqual({ ok: false, reason: 'nothing-to-do' })
  })
  it('R-17 uninstall when nothing of ours is there -> nothing-to-do', async () => {
    const r: any = await installer({ [SETTINGS]: '{"a":1}' }).inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    expect(r).toEqual({ ok: false, reason: 'nothing-to-do' })
    const r2: any = await installer().inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    expect(r2.ok).toBe(false)
  })
  it('R-17 preview never writes', async () => {
    const m = installer()
    await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect(m.log).toEqual([])
  })
})

describe('R-17 installer.apply', () => {
  it('R-17 install writes the previewed text and a one-time backup of the original', async () => {
    const cur = '{"model":"opus"}\n'
    const m = installer({ [SETTINGS]: cur })
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect(await m.inst.apply(p.previewId)).toEqual({ ok: true })
    expect(m.files.get(SETTINGS)).toBe(p.after)
    expect(m.files.get(BAK)).toBe(cur)
    expect(m.log.some((l) => l.startsWith('mkdir:') && l.includes('.claude'))).toBe(true)
  })
  it('R-17 a missing original writes the "file did not exist" marker backup', async () => {
    const m = installer()
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p.previewId)
    expect(JSON.parse(m.files.get(BAK)!)).toEqual({ agentConsoleBackup: 'file did not exist' })
  })
  it('R-17 the backup is written once; a second install after uninstall keeps the first backup', async () => {
    const cur = '{"model":"opus"}\n'
    const m = installer({ [SETTINGS]: cur })
    const p1: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p1.previewId)
    const p2: any = await m.inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    await m.inst.apply(p2.previewId)
    const writesBefore = m.log.filter((l) => l === `write:${BAK}`).length
    const p3: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p3.previewId)
    expect(m.files.get(BAK)).toBe(cur)
    expect(m.log.filter((l) => l === `write:${BAK}`).length).toBe(writesBefore)
  })
  it('R-17 refuses when the file changed since the preview and writes nothing', async () => {
    const m = installer({ [SETTINGS]: '{"a":1}\n' })
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    m.files.set(SETTINGS, '{"a":2}\n')
    m.log.length = 0
    expect(await m.inst.apply(p.previewId)).toEqual({ ok: false, reason: 'changed-since-preview' })
    expect(m.files.get(SETTINGS)).toBe('{"a":2}\n')
    expect(m.log.filter((l) => l.startsWith('write:'))).toEqual([])
  })
  it('R-17 refuses when a missing file appeared since the preview', async () => {
    const m = installer()
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    m.files.set(SETTINGS, '{"x":1}')
    expect(await m.inst.apply(p.previewId)).toEqual({ ok: false, reason: 'changed-since-preview' })
  })
  it('R-17 unknown preview ids are expired; previews are single-use', async () => {
    const m = installer()
    expect(await m.inst.apply('nope')).toEqual({ ok: false, reason: 'expired' })
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    expect((await m.inst.apply(p.previewId)).ok).toBe(true)
    expect(await m.inst.apply(p.previewId)).toEqual({ ok: false, reason: 'expired' })
  })
  it('R-17 a preview expires after 10 minutes', async () => {
    const { vi } = await import('vitest')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
      const m = installer()
      const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
      vi.setSystemTime(new Date('2026-11-19T10:10:01Z'))
      expect(await m.inst.apply(p.previewId)).toEqual({ ok: false, reason: 'expired' })
    } finally {
      vi.useRealTimers()
    }
  })
  it('R-17 uninstall removes only our hooks and keeps the rest', async () => {
    const foreign = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] }, model: 'opus' }
    const m = installer({ [SETTINGS]: text(mergeHooks(foreign, entry())) })
    const p: any = await m.inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    expect(JSON.parse(p.after)).toEqual(foreign)
    expect((await m.inst.apply(p.previewId)).ok).toBe(true)
    expect(JSON.parse(m.files.get(SETTINGS)!)).toEqual(foreign)
  })
  it('R-17 uninstalling a file WE created deletes it (after: null)', async () => {
    const m = installer()
    const p1: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p1.previewId)
    const p2: any = await m.inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    expect(p2.after).toBeNull()
    expect((await m.inst.apply(p2.previewId)).ok).toBe(true)
    expect(m.files.has(SETTINGS)).toBe(false)
    expect(m.log).toContain(`remove:${SETTINGS}`)
  })
  it('R-17 uninstalling from a pre-existing file that becomes empty writes {} instead of deleting', async () => {
    const m = installer({ [SETTINGS]: '{}\n' })
    const p1: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p1.previewId)
    const p2: any = await m.inst.preview(ROOT, 'uninstall', entry(), SCRIPT)
    expect(p2.after).toBe('{}\n')
    await m.inst.apply(p2.previewId)
    expect(m.files.get(SETTINGS)).toBe('{}\n')
  })
  it('R-17 writes only the settings file and its backup (nothing else under .claude)', async () => {
    const m = installer()
    const p: any = await m.inst.preview(ROOT, 'install', entry(), SCRIPT)
    await m.inst.apply(p.previewId)
    const written = m.log.filter((l) => l.startsWith('write:')).map((l) => l.slice(6))
    for (const w of written) expect([SETTINGS, BAK]).toContain(w.replace(/\\/g, '/'))
  })
})
