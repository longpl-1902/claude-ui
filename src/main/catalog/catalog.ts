import { isDeniedPath } from '../accounts/safeFs'

export type CatalogKind = 'skill' | 'agent' | 'command' | 'output-style'
/** Structurally equal to T23's CatalogItem. */
export interface CatalogItem {
  kind: CatalogKind
  name: string
  description?: string
  scope: 'user' | 'project' | 'plugin'
  plugin?: string
  path: string
  argumentHint?: string
  model?: string
}

export interface CatalogFs {
  readdir(p: string): Promise<{ name: string; isDir: boolean }[]>
  readHead(p: string, max: number): Promise<string | null>
  exists(p: string): Promise<boolean>
}

export const HEAD_BYTES = 8192
export const MAX_ITEMS = 500
export const MAX_DEPTH = 4
export const MAX_DESCRIPTION = 300

/** Leading `---` fenced `key: value` lines. Quotes stripped, never throws. */
export function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/)
    if (lines[0]?.trim() !== '---') return out
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      if (line.trim() === '---') break
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      if (!m) continue
      let v = m[2]!.trim()
      if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1)
      out[m[1]!] = v
    }
  } catch {
    /* tolerant */
  }
  return out
}

const isMd = (n: string): boolean => n.toLowerCase().endsWith('.md')

export function createCatalog(deps: { fs: CatalogFs; home: string; platform: NodeJS.Platform }): {
  list(o: { configDirAbs: string; projectRoot: string | null; plugins: { name: string; installPath: string }[] }): Promise<CatalogItem[]>
} {
  const { fs } = deps
  const sep = deps.platform === 'win32' ? String.fromCharCode(92) : '/'
  const join = (a: string, b: string): string => (a.endsWith('/') || a.endsWith(sep) ? a + b : a + sep + b)

  async function safeDir(p: string): Promise<{ name: string; isDir: boolean }[]> {
    if (isDeniedPath(p)) return []
    try {
      return (await fs.readdir(p)).slice().sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  async function head(p: string): Promise<Record<string, string> | null> {
    if (isDeniedPath(p)) return null
    try {
      const t = await fs.readHead(p, HEAD_BYTES)
      return t === null ? null : parseFrontmatter(t)
    } catch {
      return null
    }
  }

  async function mdFiles(dir: string, recursive: boolean): Promise<{ rel: string; path: string }[]> {
    const out: { rel: string; path: string }[] = []
    const walk = async (d: string, rel: string[], depth: number): Promise<void> => {
      for (const e of await safeDir(d)) {
        const full = join(d, e.name)
        if (e.isDir) {
          if (recursive && depth < MAX_DEPTH) await walk(full, [...rel, e.name], depth + 1)
        } else if (isMd(e.name) && !isDeniedPath(full)) out.push({ rel: [...rel, e.name.slice(0, -3)].join(':'), path: full })
      }
    }
    await walk(dir, [], 1)
    return out
  }

  async function scan(
    base: string,
    scope: CatalogItem['scope'],
    kinds: { skills: boolean; agents: 'deep' | 'flat'; commands: 'deep' | 'flat'; styles: boolean },
    plugin: string | undefined,
    push: (i: CatalogItem) => boolean
  ): Promise<void> {
    const mk = (kind: CatalogKind, fallback: string, path: string, fm: Record<string, string>): CatalogItem => {
      const name = fm.name && kind !== 'command' ? fm.name : fallback
      const item: CatalogItem = { kind, name: plugin ? `${plugin}:${name}` : name, scope, path }
      if (plugin) item.plugin = plugin
      if (fm.description) item.description = fm.description.slice(0, MAX_DESCRIPTION)
      const hint = fm['argument-hint'] ?? fm.argumentHint
      if (hint) item.argumentHint = hint
      if (fm.model) item.model = fm.model
      return item
    }
    if (kinds.skills) {
      for (const e of await safeDir(join(base, 'skills'))) {
        if (!e.isDir) continue
        const p = join(join(join(base, 'skills'), e.name), 'SKILL.md')
        const fm = await head(p)
        if (fm && !push(mk('skill', e.name, p, fm))) return
      }
    }
    for (const [kind, dirName, mode] of [
      ['agent', 'agents', kinds.agents],
      ['command', 'commands', kinds.commands]
    ] as const) {
      for (const f of await mdFiles(join(base, dirName), mode === 'deep')) {
        const fm = await head(f.path)
        if (fm && !push(mk(kind, f.rel, f.path, fm))) return
      }
    }
    if (kinds.styles) {
      for (const f of await mdFiles(join(base, 'output-styles'), false)) {
        const fm = await head(f.path)
        if (fm && !push(mk('output-style', f.rel, f.path, fm))) return
      }
    }
  }

  return {
    async list(o) {
      const items: CatalogItem[] = []
      const push = (i: CatalogItem): boolean => {
        if (items.length >= MAX_ITEMS) return false
        items.push(i)
        return items.length < MAX_ITEMS
      }
      const full = { skills: true, agents: 'deep', commands: 'deep', styles: true } as const
      await scan(o.configDirAbs, 'user', full, undefined, push)
      if (o.projectRoot) await scan(join(o.projectRoot, '.claude'), 'project', full, undefined, push)
      for (const pl of o.plugins) {
        if (items.length >= MAX_ITEMS) break
        await scan(pl.installPath, 'plugin', { skills: true, agents: 'flat', commands: 'flat', styles: false }, pl.name, push)
      }
      return items
    }
  }
}
