import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  TranscriptAccessError,
  createTranscriptFs,
  isTranscriptReadable,
  nodeByteFs,
  transcriptNodeFs
} from '../../../src/main/transcripts/transcriptFs'
import { CREDENTIALS_BASENAME } from '../../fixtures/transcripts/trees'
import { createMemoryByteFs } from './memoryByteFs'

describe('R-02 isTranscriptReadable allowlist', () => {
  it.each([
    'C:/Users/u/.claude/projects/d--work-demo/11111111-aaaa.jsonl',
    'C:\\Users\\u\\.claude\\projects\\d--work-demo\\11111111-aaaa.jsonl',
    '/home/u/.claude/projects/p/s/subagents/agent-a1b2c3d4e5f6a7b81.jsonl',
    '/home/u/.claude/projects/p/s/subagents/agent-a1b2c3d4e5f6a7b81.meta.json',
    'C:/Users/u/.claude/sessions/4242.json',
    'C:\\Users\\u\\.claude\\sessions\\4242.json',
    'C:/Users/u/.claude/projects/p/UPPER.JSONL'
  ])('R-02 allows %s', (p) => {
    expect(isTranscriptReadable(p)).toBe(true)
  })

  it.each([
    'C:/Users/u/.claude/sessions/4242.deadbeef.key',
    'C:/Users/u/.claude/anything.key',
    `C:/Users/u/.claude/${CREDENTIALS_BASENAME}`,
    `C:/Users/u/.claude-acme/${CREDENTIALS_BASENAME.toUpperCase()}`,
    'C:/Users/u/.claude/projects/p/s/tool-results/out.txt',
    'C:/Users/u/.claude/settings.json',
    'C:/Users/u/.claude/projects/p/4242.json', // digits.json only counts inside a `sessions` folder
    'C:/Users/u/.claude/sessions/abc.json',
    'C:/Users/u/.claude/sessions/4242.json.bak',
    'C:/Users/u/.claude/projects/p/s/subagents/agent-x.prefix.json',
    'C:/Users/u/.claude/projects/p/file.jsonl.bak',
    'C:/Users/u/.claude/history.txt'
  ])('R-02 denies %s', (p) => {
    expect(isTranscriptReadable(p)).toBe(false)
  })
})

describe('R-02 createTranscriptFs', () => {
  const jsonlPath = 'C:/Users/u/.claude/projects/p/s.jsonl'
  const metaPath = 'C:/Users/u/.claude/projects/p/s/subagents/agent-a.meta.json'
  const regPath = 'C:/Users/u/.claude/sessions/4242.json'
  const keyPath = 'C:/Users/u/.claude/sessions/4242.deadbeef.key'
  const credPath = `C:/Users/u/.claude/${CREDENTIALS_BASENAME}`
  const mk = () => {
    const inner = createMemoryByteFs({ [jsonlPath]: 'hello\n', [metaPath]: '{"a":1}', [regPath]: '{"pid":1}', [keyPath]: 'FAKE-KEY', [credPath]: '{}' })
    return { inner, fs: createTranscriptFs(inner) }
  }

  it('R-02 passes allowlisted reads through', async () => {
    const { fs } = mk()
    expect((await fs.stat(jsonlPath))?.size).toBe(6)
    expect(new TextDecoder().decode(await fs.readRange(jsonlPath, 0, 5))).toBe('hello')
    expect(await fs.readText(metaPath)).toBe('{"a":1}')
    expect(await fs.readText(regPath)).toBe('{"pid":1}')
  })

  it.each([
    ['stat', (fs: ReturnType<typeof createTranscriptFs>, p: string) => fs.stat(p)],
    ['readRange', (fs: ReturnType<typeof createTranscriptFs>, p: string) => fs.readRange(p, 0, 10)],
    ['readText', (fs: ReturnType<typeof createTranscriptFs>, p: string) => fs.readText(p)]
  ])('R-02 %s on a .key or credentials file rejects with TranscriptAccessError and never reaches the inner fs', async (_n, call) => {
    for (const p of [keyPath, credPath]) {
      const { inner, fs } = mk()
      await expect(call(fs, p)).rejects.toBeInstanceOf(TranscriptAccessError)
      expect(inner.reads).not.toContain(p)
      expect(inner.rangeCalls).toHaveLength(0)
    }
  })

  it('R-02 readdir is allowed (names only) even for the registry directory', async () => {
    const { fs } = mk()
    const names = (await fs.readdir('C:/Users/u/.claude/sessions')).map((e) => e.name).sort()
    expect(names).toEqual(['4242.deadbeef.key', '4242.json'])
  })

  it('R-02 exposes no write methods', () => {
    const { fs } = mk()
    expect(Object.keys(fs).sort()).toEqual(['readRange', 'readText', 'readdir', 'stat'])
  })

  it('R-14 reading every allowlisted file never touches the secrets', async () => {
    const { inner, fs } = mk()
    for (const p of [jsonlPath, metaPath, regPath]) await fs.readText(p)
    expect(inner.reads.some((p) => p.endsWith('.key') || p.endsWith(CREDENTIALS_BASENAME))).toBe(false)
  })
})

describe('R-02 nodeByteFs (real temp dir, read only)', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tfs-test-'))
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'a.jsonl'), 'hello world')
    await writeFile(join(dir, 'a.meta.json'), '{"x":1}')
    await writeFile(join(dir, 'secret.key'), 'FAKE-KEY')
    await writeFile(join(dir, CREDENTIALS_BASENAME), '{}')
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('R-02 stat returns size and isFile; a missing file is null', async () => {
    const st = await nodeByteFs.stat(join(dir, 'a.jsonl'))
    expect(st?.size).toBe(11)
    expect(st?.isFile).toBe(true)
    expect(typeof st?.mtimeMs).toBe('number')
    expect(typeof st?.birthtimeMs).toBe('number')
    expect(await nodeByteFs.stat(join(dir, 'missing.jsonl'))).toBeNull()
  })

  it('R-02 readRange reads [start,end), clamps end to the size and returns empty past the end', async () => {
    const p = join(dir, 'a.jsonl')
    expect(new TextDecoder().decode(await nodeByteFs.readRange(p, 0, 5))).toBe('hello')
    expect(new TextDecoder().decode(await nodeByteFs.readRange(p, 6, 5000))).toBe('world')
    expect((await nodeByteFs.readRange(p, 11, 20)).length).toBe(0)
    expect((await nodeByteFs.readRange(p, 50, 60)).length).toBe(0)
  })

  it('R-02 readText and readdir work', async () => {
    expect(await nodeByteFs.readText(join(dir, 'a.meta.json'))).toBe('{"x":1}')
    const entries = await nodeByteFs.readdir(dir)
    const sub = entries.find((e) => e.name === 'sub')
    expect(sub?.isDirectory()).toBe(true)
    expect(entries.find((e) => e.name === 'a.jsonl')?.isFile()).toBe(true)
  })

  it('R-02 transcriptNodeFs refuses the .key and credentials files that really exist', async () => {
    await expect(transcriptNodeFs.readText(join(dir, 'secret.key'))).rejects.toBeInstanceOf(TranscriptAccessError)
    await expect(transcriptNodeFs.readRange(join(dir, CREDENTIALS_BASENAME), 0, 5)).rejects.toBeInstanceOf(TranscriptAccessError)
    expect(new TextDecoder().decode(await transcriptNodeFs.readRange(join(dir, 'a.jsonl'), 0, 5))).toBe('hello')
  })
})
