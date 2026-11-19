import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOCK_SIGNED_IN_EMAIL, mockAccountsSnapshot, mockTeamSnapshot } from '@shared/mock'
import { deriveAllStatuses } from '@shared/status'
import { formatTokens, sumTokens, teamCounters } from '@shared/format'

const team = mockTeamSnapshot
const acc = mockAccountsSnapshot
const byId = (id: string) => team.agents.find((a) => a.id === id)!

describe('R-05 mock team snapshot: identity and shape', () => {
  it('has the mockup header data', () => {
    expect(team.repo).toBe('acme/sheet-automation')
    expect(team.teamName).toBe('sheet-export')
    expect(team.accountId).toBe('company')
    expect(team.now).toBe('2026-11-19T10:44:20.000Z')
    expect(team.timelineTicks).toEqual(['10:24', '10:29', '10:34', '10:39', 'now'])
  })

  it('has the 6 agents in order with unique ids', () => {
    expect(team.agents.map((a) => a.id)).toEqual(['lead', 'api', 'be', 'ui', 'test', 'rev'])
    expect(team.agents.map((a) => a.name)).toEqual([
      'lead',
      'api-designer',
      'backend-impl',
      'ui-builder',
      'test-writer',
      'reviewer'
    ])
    expect(new Set(team.agents.map((a) => a.id)).size).toBe(6)
  })

  it('copies agent details from the mockup', () => {
    const be = byId('be')
    expect(be.initials).toBe('BE')
    expect(be.avatarColor.toLowerCase()).toBe('#c49bff')
    expect(be.role).toBe('Server + Revit export')
    expect(be.model).toBe('Sonnet')
    expect(be.worktree).toBe('feat/backend-auth')
    expect(be.taskTitle).toBe('#3 Export endpoints')
    expect(be.current).toEqual({ tool: 'Bash', target: 'dotnet test --filter "Category=Export"' })
    expect(be.elapsedSec).toBe(1025)
    expect(be.tokens).toBe(241000)
    expect(be.toolCalls).toBe(31)
    expect(be.timeline[0]).toEqual({ kind: 'read', startPct: 4, widthPct: 8 })
    expect(be.timeline).toHaveLength(8)
    expect(be.files[0]).toEqual({ path: 'src/Services/SheetExportService.cs', added: 96, removed: 20 })
    expect(be.messages[0]).toMatchObject({ direction: 'out', peer: 'lead', time: '10:36' })
    expect(be.messages[0]!.text).toContain('Export endpoints compile against SheetDto v1')
    expect(be.activity[0]).toMatchObject({
      time: '10:44:10',
      tool: 'Bash',
      target: 'dotnet test --filter "Category=Export"'
    })

    expect(byId('lead').elapsedSec).toBe(1122)
    expect(byId('lead').tokens).toBe(412000)
    expect(byId('api').elapsedSec).toBe(1160)
    expect(byId('ui').elapsedSec).toBe(372)
    expect(byId('ui').tokens).toBe(58000)
    expect(byId('rev').current.tool).toBe('Done')
    expect(byId('rev').files).toEqual([])
    expect(byId('lead').messages[0]).toMatchObject({ direction: 'in', peer: 'api-designer' })
  })

  it('marks failed activity (result starting with FAIL) and only those', () => {
    const failed = byId('test').activity.find((a) => a.result.startsWith('FAIL'))
    expect(failed).toBeDefined()
    expect(failed!.failed).toBe(true)
    expect(failed!.result).toBe('FAIL · SheetDto_RoundTrip, Export_ToExcel')
    for (const agent of team.agents)
      for (const item of agent.activity)
        expect(Boolean(item.failed)).toBe(item.result.startsWith('FAIL'))
  })

  it('timeline segments stay within 0-100', () => {
    for (const agent of team.agents) {
      expect(agent.timeline.length).toBeGreaterThan(0)
      for (const s of agent.timeline) {
        expect(s.startPct).toBeGreaterThanOrEqual(0)
        expect(s.widthPct).toBeGreaterThan(0)
        expect(s.startPct + s.widthPct).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('R-05 mock team snapshot: referential invariants', () => {
  const ids = new Set(team.agents.map((a) => a.id))

  it('every worktree agentId exists', () => {
    for (const w of team.worktrees) for (const id of w.agentIds) expect(ids.has(id)).toBe(true)
  })

  it('every task ownerAgentId exists, task ids are unique', () => {
    for (const t of team.tasks) expect(ids.has(t.ownerAgentId)).toBe(true)
    expect(new Set(team.tasks.map((t) => t.id)).size).toBe(team.tasks.length)
  })

  it('every overlap agentId exists', () => {
    for (const o of team.overlaps) for (const id of o.agentIds) expect(ids.has(id)).toBe(true)
  })

  it('every event agentId exists and every agent has events', () => {
    for (const e of team.events) expect(ids.has(e.agentId)).toBe(true)
    for (const id of ids) expect(team.events.some((e) => e.agentId === id)).toBe(true)
  })

  it('every console line is from you or a known agent', () => {
    for (const l of team.console) expect(l.who === 'you' || ids.has(l.who)).toBe(true)
  })

  it('events have valid ISO timestamps, account and session ids; teammates have a parent and worktree', () => {
    for (const e of team.events) {
      expect(Number.isNaN(Date.parse(e.ts))).toBe(false)
      expect(e.accountId).toBe('company')
      expect(e.sessionId).toBe('sess-sheet-export')
    }
    for (const a of team.agents.filter((x) => x.id !== 'lead')) {
      const own = team.events.filter((e) => e.agentId === a.id)
      expect(own.some((e) => e.kind === 'spawn')).toBe(true)
      for (const e of own) {
        expect(e.parentAgentId).toBe('lead')
        expect(e.worktree).toBe(a.worktree)
      }
    }
    expect(team.events.some((e) => e.agentId === 'lead' && e.kind === 'spawn')).toBe(true)
  })

  it('encodes the specified final events', () => {
    const last = (id: string) => team.events.filter((e) => e.agentId === id).sort((a, b) => a.ts.localeCompare(b.ts)).at(-1)!
    expect(last('lead')).toMatchObject({ kind: 'tool_start', tool: 'SendMessage', ts: '2026-11-19T10:43:51.000Z' })
    expect(last('api')).toMatchObject({ kind: 'tool_start', tool: 'Edit', target: 'src/Api/SheetDto.cs', ts: '2026-11-19T10:44:02.000Z' })
    expect(last('be')).toMatchObject({ kind: 'tool_start', tool: 'Bash', ts: '2026-11-19T10:44:10.000Z' })
    expect(last('ui')).toMatchObject({ kind: 'status', result: 'blocked', ts: '2026-11-19T10:31:20.000Z' })
    expect(last('test')).toMatchObject({
      kind: 'error',
      ts: '2026-11-19T10:43:18.000Z',
      result: 'dotnet test exited 1 · 2 of 48 failed'
    })
    expect(last('rev')).toMatchObject({ kind: 'stop', ts: '2026-11-19T10:38:56.000Z' })
  })
})

describe('R-05 derived statuses and counters match the mockup', () => {
  it('deriveAllStatuses(mock) equals the mockup statuses', () => {
    expect(deriveAllStatuses(team)).toEqual({
      lead: 'running',
      api: 'running',
      be: 'running',
      ui: 'waiting',
      test: 'needs-you',
      rev: 'done'
    })
  })

  it('teamCounters gives 6 / 3 / 1 and tokens 1.12M', () => {
    const c = teamCounters(team)
    expect(c).toMatchObject({ agents: 6, running: 3, needsYou: 1 })
    expect(c.tokens).toBe(sumTokens(team.agents))
    expect(formatTokens(c.tokens)).toBe('1.12M')
  })
})

describe('R-05 mock team snapshot: worktrees, tasks, overlaps, console', () => {
  it('worktrees match the mockup', () => {
    expect(team.worktrees.map((w) => w.branch)).toEqual([
      'main',
      'feat/api-schema',
      'feat/backend-auth',
      'feat/ui-panel',
      'feat/tests'
    ])
    expect(team.worktrees[0]).toMatchObject({ path: '~/repos/sheet-automation', agentIds: ['lead', 'rev'], changedFiles: 0, ahead: 0 })
    expect(team.worktrees[1]).toMatchObject({ path: '.worktrees/api-schema', agentIds: ['api'], changedFiles: 3, ahead: 2 })
    expect(team.worktrees[2]).toMatchObject({ path: '.worktrees/backend', agentIds: ['be'], changedFiles: 3, ahead: 4 })
    expect(team.worktrees[3]).toMatchObject({ path: '.worktrees/ui-panel', agentIds: ['ui'], changedFiles: 1, ahead: 1 })
    expect(team.worktrees[4]).toMatchObject({
      path: '.worktrees/tests',
      agentIds: ['test'],
      changedFiles: 2,
      ahead: 0,
      overlapsWith: ['feat/api-schema']
    })
  })

  it('tasks match the mockup and titles carry no #n prefix', () => {
    expect(team.tasks).toHaveLength(6)
    expect(team.tasks.map((t) => t.title)).toEqual([
      'Define API contract',
      'Schema v2 for SheetDto',
      'Export endpoints',
      'Sheet panel UI',
      'Integration tests',
      'Review API contract'
    ])
    expect(team.tasks.map((t) => t.state)).toEqual(['done', 'in_progress', 'in_progress', 'blocked', 'failing', 'done'])
    expect(team.tasks.map((t) => t.ownerAgentId)).toEqual(['api', 'api', 'be', 'ui', 'test', 'rev'])
    expect(team.tasks[3]!.blockedBy).toBe(2)
    expect(team.tasks[4]!.failingCount).toBe(2)
    for (const t of team.tasks) expect(t.title.startsWith('#')).toBe(false)
  })

  it('has the single overlap', () => {
    expect(team.overlaps).toEqual([
      {
        path: 'src/Api/SheetDto.cs',
        agentIds: ['api', 'test'],
        worktrees: ['feat/api-schema', 'feat/tests']
      }
    ])
  })

  it('has the 7 console lines verbatim', () => {
    expect(team.console).toHaveLength(7)
    expect(team.console.map((l) => l.who)).toEqual(['you', 'lead', 'rev', 'api', 'test', 'lead', 'be'])
    expect(team.console[0]).toEqual({
      time: '10:24:00',
      who: 'you',
      text: 'Split sheet-export into API, backend, UI, tests + a reviewer. One worktree each.'
    })
    expect(team.console[1]!.text).toBe('Created team "sheet-export", 4 worktrees, 6 tasks')
    expect(team.console[6]!.text).toBe('Running export tests (31/48)…')
  })
})

describe('R-05 mock accounts snapshot', () => {
  it('has company and personal accounts per the mockup, without fake usage', () => {
    expect(acc.accounts.map((a) => a.id)).toEqual(['company', 'personal'])
    const [company, personal] = acc.accounts
    expect(company).toMatchObject({
      name: 'Company',
      color: '#6E9BF0',
      configDir: '~/.claude',
      email: 'you@company.com',
      signedIn: false,
      tokensToday: 1125000
    })
    expect(company!.plan).toBeUndefined()
    expect(personal).toMatchObject({
      name: 'Personal',
      color: '#F2A541',
      configDir: '~/.claude-personal',
      email: 'you@gmail.com',
      signedIn: false
    })
    expect(personal!.plan).toBeUndefined()
    expect(personal!.tokensToday).toBeUndefined()
    expect(JSON.stringify(acc)).not.toMatch(/"(pct|percent|usage)/i)
  })

  it('default / active account exist; rules reference accounts or ask', () => {
    const ids = acc.accounts.map((a) => a.id)
    expect(acc.defaultAccountId).toBe('company')
    expect(acc.activeAccountId).toBe('company')
    expect(ids).toContain(acc.defaultAccountId)
    expect(ids).toContain(acc.activeAccountId)
    for (const r of acc.rules) expect([...ids, 'ask']).toContain(r.accountId)
    for (const a of acc.accounts) for (const r of a.folderRules) expect([...ids, 'ask']).toContain(r.accountId)
  })

  it('has detected logins, rules, safety, policy and sessions', () => {
    expect(acc.detected).toHaveLength(2)
    expect(acc.detected[0]).toMatchObject({
      configDir: '~/.claude',
      email: 'you@company.com',
      org: '[COMPANY ORG]',
      signedIn: true,
      suggestedAccountId: 'company'
    })
    expect(acc.detected[0]!.linkedAccountId).toBeUndefined()
    expect(acc.detected[0]!.sources).toEqual(['VS Code extension', 'Claude Code CLI (default folder)'])
    expect(acc.detected[1]).toMatchObject({
      configDir: '~/.claude-personal',
      signedIn: false,
      suggestedAccountId: 'personal'
    })
    expect(acc.detected[1]!.sources).toEqual(['.vscode/settings.json in ~/code/personal/revit-playground'])

    expect(acc.rules).toEqual([
      { pattern: '~/work/acme/**', accountId: 'company', note: 'All company repos' },
      { pattern: '~/code/personal/**', accountId: 'personal', note: 'Side projects' },
      { pattern: 'anything else', accountId: 'ask', note: 'Prompt when opening a new folder' }
    ])
    expect(acc.safety).toEqual({
      warnPersonalInCompanyFolder: true,
      showAccountColorEdge: true,
      lockAccountOnTeamStart: true
    })
    expect(acc.limitPolicy).toBe('pause')
    expect(acc.sessions).toEqual([
      { teamName: 'sheet-export', path: '~/work/acme/sheet-automation', accountId: 'company', agentCount: 6 },
      { teamName: 'scratch', path: '~/code/personal/revit-playground', accountId: 'personal', agentCount: 1 }
    ])
  })

  it('MOCK_SIGNED_IN_EMAIL is the personal email', () => {
    expect(MOCK_SIGNED_IN_EMAIL).toBe('you@gmail.com')
  })
})

describe('R-17 shared modules are pure (no node / electron / network imports)', () => {
  const sharedDir = resolve(__dirname, '../../src/shared')
  const files = [
    'status.ts',
    'format.ts',
    ...readdirSync(join(sharedDir, 'mock')).map((f) => join('mock', f))
  ]

  it('lists the expected modules', () => {
    expect(files).toEqual(expect.arrayContaining(['status.ts', 'format.ts', join('mock', 'team.ts'), join('mock', 'accounts.ts'), join('mock', 'index.ts')]))
  })

  it.each(files)('%s has no forbidden imports', (f) => {
    const src = readFileSync(join(sharedDir, f), 'utf8')
    expect(src).not.toMatch(/from\s+['"](node:|electron|fs|path|child_process|net|http|https)/)
    expect(src).not.toMatch(/\bfetch\(|https?:\/\//)
  })
})
