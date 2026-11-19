// T21 / R-24: attention prefs persisted in <userData>/attention-prefs.json.
// SIGNATURE ASSUMPTION (the T21 Notes name no API for prefs.ts):
//   createAttentionPrefs({ filePath, fs: { readText(p): Promise<string | null>; writeTextAtomic(p, t): Promise<void>; mkdirp(p): Promise<void> } })
//     -> { load(): Promise<AttentionPrefs>; save(p: AttentionPrefs): Promise<{ ok: boolean; reason?: string }>; get(): AttentionPrefs }
import { describe, expect, it } from 'vitest'
import { createAttentionPrefs } from '../../../src/main/attention/prefs'

const FILE = 'C:/Users/u/AppData/Roaming/agent-console/attention-prefs.json'
const DEFAULTS = { mutedProjects: [], dnd: false, notifyErrors: false }

function setup(initial?: string) {
  const files = new Map<string, string>(initial === undefined ? [] : [[FILE, initial]])
  const writes: { path: string; text: string }[] = []
  const fs = {
    readText: async (p: string) => files.get(p) ?? null,
    writeTextAtomic: async (p: string, t: string) => { writes.push({ path: p, text: t }); files.set(p, t) },
    mkdirp: async (_p: string) => {}
  }
  return { prefs: createAttentionPrefs({ filePath: FILE, fs } as never), files, writes }
}

describe('R-24 prefs load', () => {
  it('R-24 a missing file gives the defaults and writes nothing', async () => {
    const s = setup()
    expect(await s.prefs.load()).toEqual(DEFAULTS)
    expect(s.writes).toEqual([])
    expect(s.prefs.get()).toEqual(DEFAULTS)
  })
  it('R-24 a valid file is loaded (including viewedProjectKey)', async () => {
    const s = setup(JSON.stringify({ mutedProjects: ['c:/users/u/acme'], dnd: true, notifyErrors: true, viewedProjectKey: 'c:/users/u/beta' }))
    expect(await s.prefs.load()).toEqual({ mutedProjects: ['c:/users/u/acme'], dnd: true, notifyErrors: true, viewedProjectKey: 'c:/users/u/beta' })
    expect(s.prefs.get().dnd).toBe(true)
  })
  it('R-24 corrupt JSON -> defaults', async () => {
    expect(await setup('{not json').prefs.load()).toEqual(DEFAULTS)
    expect(await setup('').prefs.load()).toEqual(DEFAULTS)
    expect(await setup('[]').prefs.load()).toEqual(DEFAULTS)
    expect(await setup('null').prefs.load()).toEqual(DEFAULTS)
  })
  it('R-24 schema violations -> defaults (wrong types, non-string array items, too many items)', async () => {
    for (const bad of [
      { mutedProjects: 'x', dnd: false, notifyErrors: false },
      { mutedProjects: [1, 2], dnd: false, notifyErrors: false },
      { mutedProjects: [], dnd: 'yes', notifyErrors: false },
      { mutedProjects: Array.from({ length: 201 }, (_, i) => `p${i}`), dnd: false, notifyErrors: false }
    ]) {
      expect(await setup(JSON.stringify(bad)).prefs.load()).toEqual(DEFAULTS)
    }
  })
  it('R-24 unknown keys are dropped', async () => {
    const loaded: any = await setup(JSON.stringify({ ...DEFAULTS, extra: 'x', __proto__: { a: 1 } })).prefs.load()
    expect('extra' in loaded).toBe(false)
  })
})

describe('R-24 prefs save', () => {
  it('R-24 save writes the JSON atomically to the prefs file and get() reflects it', async () => {
    const s = setup()
    const p = { mutedProjects: ['c:/users/u/acme'], dnd: true, notifyErrors: false }
    expect((await s.prefs.save(p)).ok).toBe(true)
    expect(s.writes).toHaveLength(1)
    expect(s.writes[0]!.path.replace(/\\/g, '/')).toBe(FILE)
    expect(JSON.parse(s.writes[0]!.text)).toEqual(p)
    expect(s.prefs.get()).toEqual(p)
  })
  it('R-24 a save followed by a fresh load round-trips', async () => {
    const s = setup()
    const p = { mutedProjects: ['a', 'b'], dnd: false, notifyErrors: true, viewedProjectKey: 'a' }
    await s.prefs.save(p)
    const again = createAttentionPrefs({ filePath: FILE, fs: { readText: async (x: string) => s.files.get(x) ?? null, writeTextAtomic: async () => {}, mkdirp: async () => {} } } as never)
    expect(await again.load()).toEqual(p)
  })
  it('R-24 invalid prefs are rejected and nothing is written', async () => {
    const s = setup()
    for (const bad of [{ mutedProjects: [1], dnd: false, notifyErrors: false }, { mutedProjects: [], dnd: 1, notifyErrors: false }, null, 'x']) {
      expect((await s.prefs.save(bad as never)).ok).toBe(false)
    }
    expect(s.writes).toEqual([])
    expect(s.prefs.get()).toEqual(DEFAULTS)
  })
  it('R-24 only the prefs file is ever written (nothing under a Claude config dir)', async () => {
    const s = setup()
    await s.prefs.save({ mutedProjects: [], dnd: true, notifyErrors: false })
    for (const w of s.writes) expect(w.path.replace(/\\/g, '/')).not.toMatch(/\.claude/)
  })
})
