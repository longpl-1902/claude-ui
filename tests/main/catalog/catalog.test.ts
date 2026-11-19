import { describe, expect, it } from 'vitest'
import { createCatalog, parseFrontmatter, type CatalogFs } from '../../../src/main/catalog/catalog'

function memFs(files: Record<string, string>): CatalogFs & { heads: string[] } {
  const heads: string[] = []
  const dirs = new Map<string, Map<string, boolean>>()
  const add = (dir: string, name: string, isDir: boolean): void => {
    if (!dirs.has(dir)) dirs.set(dir, new Map())
    dirs.get(dir)!.set(name, isDir)
  }
  for (const p of Object.keys(files)) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) add(parts.slice(0, i).join('/'), parts[i]!, i < parts.length - 1)
  }
  return {
    heads,
    async readdir(p) {
      const d = dirs.get(p)
      if (!d) throw new Error('ENOENT')
      return [...d].map(([name, isDir]) => ({ name, isDir }))
    },
    async readHead(p, max) {
      heads.push(p)
      const t = files[p]
      return t === undefined ? null : t.slice(0, max)
    },
    async exists(p) {
      return p in files || dirs.has(p)
    }
  }
}
const fm = (o: Record<string, string>, body = 'body'): string => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body}`

describe('parseFrontmatter', () => {
  it('parses key/value, strips quotes, tolerates junk', () => {
    expect(parseFrontmatter('---\nname: "a b"\ndescription: \'d\'\nbad line\n---\nx: y')).toEqual({ name: 'a b', description: 'd' })
    expect(parseFrontmatter('no fence\nname: x')).toEqual({})
    expect(parseFrontmatter('')).toEqual({})
  })
})

describe('catalog.list', () => {
  const C = '/cfg'
  const P = '/proj'
  const files: Record<string, string> = {
    [`${C}/skills/alpha/SKILL.md`]: fm({ name: 'alpha', description: 'Alpha skill' }),
    [`${C}/skills/beta/SKILL.md`]: fm({ description: 'x'.repeat(400) }),
    [`${C}/skills/beta/notes.txt`]: 'ignored',
    [`${C}/agents/team/helper.md`]: fm({ name: 'helper', model: 'sonnet' }),
    [`${C}/commands/ops/deploy.md`]: fm({ description: 'Deploy', 'argument-hint': '[env]' }),
    [`${C}/commands/readme.txt`]: 'no',
    [`${C}/output-styles/terse.md`]: fm({ name: 'terse' }),
    [`${P}/.claude/skills/gamma/SKILL.md`]: fm({ name: 'gamma' }),
    [`${P}/.claude/commands/local.md`]: fm({}),
    '/plug/skills/ps/SKILL.md': fm({ name: 'ps' }),
    '/plug/commands/pc.md': fm({ description: 'PC' }),
    '/plug/agents/pa.md': fm({ name: 'pa' })
  }
  const make = (f: Record<string, string>) => {
    const fs = memFs(f)
    return { fs, cat: createCatalog({ fs, home: '/home/u', platform: 'linux' }) }
  }
  const plugins = [{ name: 'pl', installPath: '/plug' }]

  it('lists user, project and plugin items with scope/kind/name rules', async () => {
    const { cat } = make(files)
    const items = await cat.list({ configDirAbs: C, projectRoot: P, plugins })
    const key = items.map((i) => `${i.scope}/${i.kind}/${i.name}`).sort()
    expect(key).toEqual([
      'plugin/agent/pl:pa', 'plugin/command/pl:pc', 'plugin/skill/pl:ps',
      'project/command/local', 'project/skill/gamma',
      'user/agent/helper', 'user/command/ops:deploy', 'user/output-style/terse', 'user/skill/alpha', 'user/skill/beta'
    ])
    const dep = items.find((i) => i.name === 'ops:deploy')!
    expect(dep).toMatchObject({ description: 'Deploy', argumentHint: '[env]', path: `${C}/commands/ops/deploy.md` })
    expect(items.find((i) => i.name === 'helper')!.model).toBe('sonnet')
    expect(items.find((i) => i.name === 'pl:pa')!.plugin).toBe('pl')
    expect(items.find((i) => i.name === 'beta')!.description).toHaveLength(300)
  })

  it('reads only .md heads (8 KiB)', async () => {
    const { fs, cat } = make(files)
    await cat.list({ configDirAbs: C, projectRoot: null, plugins: [] })
    expect(fs.heads.length).toBeGreaterThan(0)
    expect(fs.heads.every((p) => p.endsWith('.md'))).toBe(true)
    const big = make({ [`${C}/skills/s/SKILL.md`]: `---\nname: s\n---\n${'z'.repeat(20000)}` })
    const calls: number[] = []
    const orig = big.fs.readHead
    big.fs.readHead = async (p, m) => (calls.push(m), orig(p, m))
    await big.cat.list({ configDirAbs: C, projectRoot: null, plugins: [] })
    expect(calls).toEqual([8192])
  })

  it('caps at 500 items, respects depth 4, and tolerates missing dirs', async () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 600; i++) many[`${C}/commands/c${i}.md`] = fm({})
    expect((await make(many).cat.list({ configDirAbs: C, projectRoot: null, plugins: [] })).length).toBe(500)
    const deep = make({
      [`${C}/commands/a/b/c/ok.md`]: fm({}),
      [`${C}/commands/a/b/c/d/too.md`]: fm({})
    })
    const names = (await deep.cat.list({ configDirAbs: C, projectRoot: null, plugins: [] })).map((i) => i.name)
    expect(names).toEqual(['a:b:c:ok'])
    expect(await make({}).cat.list({ configDirAbs: C, projectRoot: '/none', plugins: [{ name: 'x', installPath: '/nope' }] })).toEqual([])
  })
})
