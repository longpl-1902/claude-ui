import { describe, expect, it } from 'vitest'
import {
  classifyTranscriptPath,
  encodeProjectDir,
  isEncodedTruncated,
  parseRegistryEntry,
  projectsRoot,
  sameProjectDir,
  sessionsRegistryDir
} from '../../../src/main/transcripts/layout'
import { registryEntry } from '../../fixtures/transcripts/builders'

const fwd = (p: string): string => p.replace(/\\/g, '/')

describe('R-02 encodeProjectDir', () => {
  it.each([
    ['d:\\personal\\claude-ui', 'd--personal-claude-ui'],
    ['D:\\personal', 'D--personal'],
    ['C:\\Users\\u\\my.app v2', 'C--Users-u-my-app-v2'],
    ['/home/u/proj', '-home-u-proj'],
    ['C:\\Users\\u\\café', 'C--Users-u-caf-']
  ])('R-02 %s -> %s (every non-alphanumeric char becomes "-", case preserved)', (cwd, expected) => {
    expect(encodeProjectDir(cwd)).toBe(expected)
  })

  it('R-02 names up to 200 chars are exact and reliable', () => {
    const enc = encodeProjectDir('a'.repeat(200))
    expect(enc).toBe('a'.repeat(200))
    expect(isEncodedTruncated(enc)).toBe(false)
  })

  it('R-02 longer names keep the first 200 chars plus "-" and are flagged unreliable', () => {
    const enc = encodeProjectDir('b'.repeat(250))
    expect(enc.startsWith('b'.repeat(200))).toBe(true)
    expect(enc.length).toBe(201)
    expect(enc.endsWith('-')).toBe(true)
    expect(isEncodedTruncated(enc)).toBe(true)
  })

  it('R-02 isEncodedTruncated is a plain length > 200 check', () => {
    expect(isEncodedTruncated('x'.repeat(201))).toBe(true)
    expect(isEncodedTruncated('x'.repeat(10))).toBe(false)
  })
})

describe('R-02 sameProjectDir', () => {
  it('R-02 is case-insensitive on win32 and darwin only', () => {
    expect(sameProjectDir('d--personal', 'D--personal', 'win32')).toBe(true)
    expect(sameProjectDir('d--personal', 'D--personal', 'darwin')).toBe(true)
    expect(sameProjectDir('d--personal', 'D--personal', 'linux')).toBe(false)
    expect(sameProjectDir('d--personal', 'd--personal', 'linux')).toBe(true)
    expect(sameProjectDir('d--personal', 'd--other', 'win32')).toBe(false)
  })
})

describe('R-02 roots', () => {
  it('R-02 projectsRoot and sessionsRegistryDir join the right folder', () => {
    expect(fwd(projectsRoot('C:/Users/u/.claude'))).toBe('C:/Users/u/.claude/projects')
    expect(fwd(sessionsRegistryDir('C:/Users/u/.claude'))).toBe('C:/Users/u/.claude/sessions')
  })
})

describe('R-02 classifyTranscriptPath', () => {
  const root = 'C:/Users/u/.claude-acme/projects'
  const S = '11111111-aaaa-4bbb-8ccc-000000000001'
  const A = 'a1b2c3d4e5f6a7b81'

  it('R-02 main transcript', () => {
    expect(classifyTranscriptPath(`${root}/d--work-demo/${S}.jsonl`, root)).toEqual({ kind: 'main', projectDir: 'd--work-demo', sessionId: S })
  })

  it('R-02 sub-agent transcript carries ids and the meta path', () => {
    const c = classifyTranscriptPath(`${root}/d--work-demo/${S}/subagents/agent-${A}.jsonl`, root) as any
    expect(c).toMatchObject({ kind: 'subagent', projectDir: 'd--work-demo', sessionId: S, agentId: A })
    expect(fwd(c.metaPath)).toBe(`${root}/d--work-demo/${S}/subagents/agent-${A}.meta.json`)
  })

  it('R-02 meta file', () => {
    expect(classifyTranscriptPath(`${root}/d--work-demo/${S}/subagents/agent-${A}.meta.json`, root)).toEqual({
      kind: 'meta',
      projectDir: 'd--work-demo',
      sessionId: S,
      agentId: A
    })
  })

  it('R-02 sub-agent files in nested subdirectories under subagents/ are found', () => {
    const c = classifyTranscriptPath(`${root}/d--work-demo/${S}/subagents/workflows/agent-deep0000.jsonl`, root) as any
    expect(c).toMatchObject({ kind: 'subagent', sessionId: S, agentId: 'deep0000' })
  })

  it('R-02 is separator-agnostic and tolerates a trailing slash on the root', () => {
    const win = `C:\\Users\\u\\.claude-acme\\projects\\d--work-demo\\${S}\\subagents\\agent-${A}.jsonl`
    expect(classifyTranscriptPath(win, 'C:\\Users\\u\\.claude-acme\\projects\\')).toMatchObject({ kind: 'subagent', agentId: A })
    expect(classifyTranscriptPath(`${root}/d--work-demo/${S}.jsonl`, `${root}/`)).toMatchObject({ kind: 'main' })
    expect(classifyTranscriptPath(`C:\\Users\\u\\.claude-acme\\projects\\d--work-demo\\${S}.jsonl`, root)).toMatchObject({ kind: 'main' })
  })

  it.each([
    ['tool results', `${root}/d--work-demo/${S}/tool-results/out-1.txt`],
    ['memory', `${root}/d--work-demo/memory/MEMORY.md`],
    ['prefix json', `${root}/d--work-demo/${S}/subagents/agent-${A}.prefix.json`],
    ['non-agent file under subagents', `${root}/d--work-demo/${S}/subagents/notes.jsonl`],
    ['file directly in the root', `${root}/stray.jsonl`],
    ['outside the root', `C:/Users/u/.claude-other/projects/d--work-demo/${S}.jsonl`],
    ['a sibling dir that merely shares the prefix', `C:/Users/u/.claude-acme/projects-old/d--work-demo/${S}.jsonl`],
    ['a non-jsonl main file', `${root}/d--work-demo/${S}.txt`]
  ])('R-02 %s -> null', (_n, p) => {
    expect(classifyTranscriptPath(p, root)).toBeNull()
  })
})

describe('R-02 parseRegistryEntry', () => {
  it('R-02 copies only the whitelisted fields (never the socket path or other extras)', () => {
    const e = parseRegistryEntry(JSON.stringify(registryEntry({ status: 'waiting', waitingFor: 'dialog open' }))) as any
    expect(e).toEqual({
      pid: 4242,
      sessionId: '11111111-aaaa-4bbb-8ccc-000000000001',
      cwd: 'd:\\work\\demo',
      status: 'waiting',
      waitingFor: 'dialog open',
      startedAt: expect.any(Number),
      updatedAt: expect.any(Number),
      statusUpdatedAt: expect.any(Number),
      name: 'demo session'
    })
    for (const bad of ['messagingSocketPath', 'kind', 'entrypoint', 'version']) expect(e).not.toHaveProperty(bad)
  })

  it('R-02 an unknown status becomes undefined; busy/idle/waiting are kept', () => {
    expect((parseRegistryEntry(JSON.stringify(registryEntry({ status: 'exploding' }))) as any).status).toBeUndefined()
    for (const s of ['busy', 'idle', 'waiting']) expect((parseRegistryEntry(JSON.stringify(registryEntry({ status: s }))) as any).status).toBe(s)
  })

  it('R-02 optional fields may be missing', () => {
    const e = parseRegistryEntry(JSON.stringify({ pid: 7, sessionId: 's-1', cwd: 'd:\\x' })) as any
    expect(e).toMatchObject({ pid: 7, sessionId: 's-1', cwd: 'd:\\x' })
    expect(e.waitingFor).toBeUndefined()
  })

  it.each([
    ['bad json', '{nope'],
    ['empty', ''],
    ['not an object', '[1]'],
    ['missing pid', JSON.stringify({ sessionId: 's', cwd: 'x' })],
    ['missing sessionId', JSON.stringify({ pid: 3, cwd: 'x' })],
    ['pid is a string', JSON.stringify({ pid: '3', sessionId: 's', cwd: 'x' })]
  ])('R-02 %s -> null', (_n, text) => {
    expect(parseRegistryEntry(text)).toBeNull()
  })
})
