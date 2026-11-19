import { describe, expect, it, vi } from 'vitest'
import { createProjectResolver, rootFromCommonDir, type ExecFn } from '../../../src/main/transcripts/projectResolver'

// The exec function is always injected: these tests never start git.
const ok = (stdout: string): ExecFn => vi.fn(async () => ({ stdout }))
const fail = (): ExecFn => vi.fn(async () => Promise.reject(new Error('not a git repository')))

describe('P3-T11 projectResolver', () => {
  it('a plain repo resolves to its root (parent of the .git common dir)', async () => {
    const exec = ok('D:/personal/claude-ui/.git\n')
    const r = createProjectResolver({ exec, platform: 'win32' })
    expect(await r.resolve('D:\\personal\\claude-ui')).toEqual({ key: 'd:/personal/claude-ui', name: 'claude-ui', root: 'D:/personal/claude-ui', git: true })
    expect(exec).toHaveBeenCalledWith(
      'git',
      ['-C', 'D:\\personal\\claude-ui', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 3000, windowsHide: true }
    )
  })

  it('a linked worktree maps to the main repo root', async () => {
    const r = createProjectResolver({ exec: ok('D:/personal/claude-ui/.git\r\n'), platform: 'win32' })
    const p = await r.resolve('D:/personal/claude-ui-wt/T01')
    expect(p).toMatchObject({ key: 'd:/personal/claude-ui', name: 'claude-ui', git: true })
    expect((await r.resolve('D:/personal/claude-ui/.claude/worktrees/x')).key).toBe('d:/personal/claude-ui')
  })

  it('a non-git folder is its own project', async () => {
    const r = createProjectResolver({ exec: fail(), platform: 'win32' })
    expect(await r.resolve('C:\\Users\\u\\notes')).toEqual({ key: 'c:/users/u/notes', name: 'notes', root: 'C:/Users/u/notes', git: false })
  })

  it('a git error or timeout falls back to the cwd, never rejects', async () => {
    const timeout = Object.assign(new Error('killed'), { killed: true, code: null })
    const r = createProjectResolver({ exec: vi.fn(async () => Promise.reject(timeout)), platform: 'win32' })
    expect((await r.resolve('D:/x/y')).git).toBe(false)
  })

  it('unexpected output (no .git suffix, empty) falls back to the cwd', async () => {
    expect((await createProjectResolver({ exec: ok('D:/repo/.git/modules/sub\n'), platform: 'win32' }).resolve('D:/repo/sub')).key).toBe('d:/repo/sub')
    expect((await createProjectResolver({ exec: ok(''), platform: 'win32' }).resolve('D:/repo')).git).toBe(false)
    expect(rootFromCommonDir('')).toBeNull()
  })

  it('caches per normalized cwd: a repeat (any case or slash style) does not exec again; in-flight calls are shared', async () => {
    const exec = ok('D:/personal/claude-ui/.git')
    const onResolved = vi.fn()
    const r = createProjectResolver({ exec, platform: 'win32', onResolved })
    const [a, b] = await Promise.all([r.resolve('D:\\Personal\\Claude-UI-wt\\T01'), r.resolve('d:/personal/claude-ui-wt/t01/')])
    expect(a).toBe(b)
    expect(exec).toHaveBeenCalledTimes(1)
    await r.resolve('d:/PERSONAL/claude-ui-wt/T01')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(r.cached('D:/personal/claude-ui-wt/T01')).toBe(a)
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('cached() is undefined before git answered and never execs', () => {
    const exec = ok('x')
    const r = createProjectResolver({ exec, platform: 'win32' })
    expect(r.cached('D:/a')).toBeUndefined()
    expect(exec).not.toHaveBeenCalled()
  })

  it('keys keep their case on linux; win32 lower-cases and unifies slashes', async () => {
    const lin = createProjectResolver({ exec: ok('/Home/U/Repo/.git'), platform: 'linux' })
    expect((await lin.resolve('/Home/U/Repo/wt')).key).toBe('/Home/U/Repo')
    const win = createProjectResolver({ exec: ok('D:\\Repo\\.git'), platform: 'win32' })
    expect((await win.resolve('D:\\Repo\\wt')).key).toBe('d:/repo')
  })

  it('provisional: cwd without git, or the encoded project dir when there is no cwd', () => {
    const r = createProjectResolver({ exec: fail(), platform: 'win32' })
    expect(r.provisional('D:\\work\\demo', 'd--work-demo')).toEqual({ key: 'd:/work/demo', name: 'demo', root: 'D:/work/demo', git: false })
    expect(r.provisional(undefined, 'd--work-demo')).toEqual({ key: 'd--work-demo', name: 'd--work-demo', root: 'd--work-demo', git: false })
  })
})
