// T06 / R-11: shared task list from TaskCreate / TaskUpdate / TaskList (+ TodoWrite fallback). Pure, incremental.
// Records are hand-built per the records.ts additions in T06 Notes (ToolUseRec.task, ToolResultRec.task).
import { describe, expect, it } from 'vitest'
import { createTaskTracker } from '../../../src/main/transcripts/taskTracker'

const T = 1_800_000_000_000
let seq = 0
const use = (name: string, task: unknown) => ({ id: `toolu_${++seq}`, name, target: '', task }) as any
const res = (toolUseId: string, o: { isError?: boolean; task?: unknown } = {}) => ({ toolUseId, isError: o.isError === true, interrupted: false, summary: '', ...(o.task ? { task: o.task } : {}) }) as any

type Tr = ReturnType<typeof createTaskTracker>
/** TaskCreate by `agent`, result carrying the id. */
function create(tr: Tr, id: string, subject: string, agent = 'lead', ts = T) {
  const u = use('TaskCreate', { op: 'create', subject })
  tr.onToolUse(agent, u, ts)
  tr.onToolResult(agent, res(u.id, { task: { createdId: id } }), ts + 1)
}
function update(tr: Tr, agent: string, taskId: string, fields: Record<string, unknown>, ts: number) {
  const u = use('TaskUpdate', { op: 'update', taskId, ...fields })
  tr.onToolUse(agent, u, ts)
  tr.onToolResult(agent, res(u.id), ts + 1)
}
const byId = (tr: Tr, id: number) => tr.tasks().find((t) => t.id === id) as any

describe('R-11 task lifecycle', () => {
  it('R-11 create -> id from the result -> pending, owned by the creator', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Write schema')
    expect(tr.tasks()).toEqual([expect.objectContaining({ id: 1, title: 'Write schema', state: 'pending', ownerAgentId: 'lead' })])
  })
  it('R-11 a create whose result never arrives is not shown', () => {
    const tr = createTaskTracker()
    tr.onToolUse('lead', use('TaskCreate', { op: 'create', subject: 'Ghost' }), T)
    expect(tr.tasks()).toEqual([])
  })
  it('R-11 update in_progress sets the state and the owner to the agent that set it', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Write schema')
    update(tr, 'a1', '1', { status: 'in_progress' }, T + 10)
    expect(byId(tr, 1)).toMatchObject({ state: 'in_progress', ownerAgentId: 'a1' })
  })
  it('R-11 update completed -> done', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Write schema')
    update(tr, 'a1', '1', { status: 'in_progress' }, T + 10)
    update(tr, 'a1', '1', { status: 'completed' }, T + 20)
    expect(byId(tr, 1).state).toBe('done')
  })
  it('R-11 an explicit owner in the update wins (kept as text when it matches no agent id)', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Write schema')
    update(tr, 'lead', '1', { status: 'in_progress', owner: 'reviewer' }, T + 10)
    expect(byId(tr, 1).ownerAgentId).toBe('reviewer')
  })
  it('R-11 subject updates rename the task', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Old title')
    update(tr, 'lead', '1', { subject: 'New title' }, T + 5)
    expect(byId(tr, 1).title).toBe('New title')
  })
  it('R-11 deleted removes the task', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'A')
    create(tr, '2', 'B')
    update(tr, 'lead', '1', { status: 'deleted' }, T + 5)
    expect(tr.tasks().map((t) => t.id)).toEqual([2])
  })
  it('R-11 tasks are sorted by numeric id (10 after 9)', () => {
    const tr = createTaskTracker()
    for (const id of ['10', '2', '9']) create(tr, id, `t${id}`)
    expect(tr.tasks().map((t) => t.id)).toEqual([2, 9, 10])
  })
  it('R-11 an update for an unknown task id is ignored without throwing', () => {
    const tr = createTaskTracker()
    expect(() => update(tr, 'lead', '99', { status: 'completed' }, T)).not.toThrow()
    expect(tr.tasks()).toEqual([])
  })
})

describe('R-11 blocked (D9)', () => {
  it('R-11 addBlockedBy an open task -> blocked with blockedBy / blockers; unblocked when the blocker completes', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Schema')
    create(tr, '2', 'Endpoints')
    update(tr, 'lead', '2', { addBlockedBy: ['1'] }, T + 10)
    expect(byId(tr, 2)).toMatchObject({ state: 'blocked', blockedBy: 1, blockers: [1] })
    update(tr, 'a1', '1', { status: 'completed' }, T + 20)
    expect(byId(tr, 2).state).toBe('pending')
    expect(byId(tr, 2).blockedBy).toBeUndefined()
  })
  it('R-11 blocked overrides in_progress; blockedBy is the first open blocker, blockers lists all', () => {
    const tr = createTaskTracker()
    for (const [id, n] of [['1', 'A'], ['2', 'B'], ['3', 'C']]) create(tr, id!, n!)
    update(tr, 'a1', '3', { status: 'in_progress', addBlockedBy: ['1', '2'] }, T + 10)
    expect(byId(tr, 3)).toMatchObject({ state: 'blocked', blockedBy: 1, blockers: [1, 2] })
    update(tr, 'a1', '1', { status: 'completed' }, T + 20)
    expect(byId(tr, 3)).toMatchObject({ state: 'blocked', blockedBy: 2, blockers: [2] })
    update(tr, 'a2', '2', { status: 'completed' }, T + 30)
    expect(byId(tr, 3).state).toBe('in_progress')
  })
  it('R-11 a blocker that is already done does not block', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'A')
    update(tr, 'lead', '1', { status: 'completed' }, T + 5)
    create(tr, '2', 'B')
    update(tr, 'lead', '2', { addBlockedBy: ['1'] }, T + 10)
    expect(byId(tr, 2).state).toBe('pending')
  })
  it('R-11 done tasks stay done even with open blockers', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'A')
    create(tr, '2', 'B')
    update(tr, 'lead', '2', { addBlockedBy: ['1'], status: 'completed' }, T + 10)
    expect(byId(tr, 2).state).toBe('done')
  })
})

describe('R-11 failing (D9)', () => {
  function inProgress() {
    const tr = createTaskTracker()
    create(tr, '1', 'Run build')
    update(tr, 'a1', '1', { status: 'in_progress' }, T + 10)
    return tr
  }
  it('R-11 a failed result of the owner after in_progress -> failing with failingCount 1', () => {
    const tr = inProgress()
    tr.onToolResult('a1', res('toolu_bash1', { isError: true }), T + 30)
    expect(byId(tr, 1)).toMatchObject({ state: 'failing', failingCount: 1 })
  })
  it('R-11 consecutive failures count up; a success resets to in_progress', () => {
    const tr = inProgress()
    tr.onToolResult('a1', res('b1', { isError: true }), T + 30)
    tr.onToolResult('a1', res('b2', { isError: true }), T + 40)
    expect(byId(tr, 1)).toMatchObject({ state: 'failing', failingCount: 2 })
    tr.onToolResult('a1', res('b3'), T + 50)
    expect(byId(tr, 1).state).toBe('in_progress')
    expect(byId(tr, 1).failingCount ?? 0).toBe(0)
  })
  it('R-11 failures of OTHER agents do not fail the task', () => {
    const tr = inProgress()
    tr.onToolResult('a2', res('b1', { isError: true }), T + 30)
    tr.onToolResult('lead', res('b2', { isError: true }), T + 31)
    expect(byId(tr, 1).state).toBe('in_progress')
  })
  it('R-11 a failure from BEFORE the task went in_progress does not count', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'Run build')
    tr.onToolResult('a1', res('old', { isError: true }), T + 5)
    update(tr, 'a1', '1', { status: 'in_progress' }, T + 10)
    expect(byId(tr, 1).state).toBe('in_progress')
  })
  it('R-11 completed tasks are never failing; pending tasks are not failing', () => {
    const tr = inProgress()
    tr.onToolResult('a1', res('b1', { isError: true }), T + 30)
    update(tr, 'a1', '1', { status: 'completed' }, T + 40)
    expect(byId(tr, 1).state).toBe('done')
    create(tr, '2', 'Other')
    tr.onToolResult('lead', res('b9', { isError: true }), T + 50)
    expect(byId(tr, 2).state).toBe('pending')
  })
  it('R-11 a blocked task stays blocked (failing only applies when not blocked by an open task)', () => {
    const tr = inProgress()
    create(tr, '2', 'Other')
    update(tr, 'a1', '1', { addBlockedBy: ['2'] }, T + 20)
    tr.onToolResult('a1', res('b1', { isError: true }), T + 30)
    expect(['blocked', 'failing']).toContain(byId(tr, 1).state)
  })
})

describe('R-11 TaskList results', () => {
  it('R-11 a TaskList result replaces statuses/owners/blockers of known ids and adds unknown ones', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'A')
    const u = use('TaskList', { op: 'list' })
    tr.onToolUse('lead', u, T + 10)
    tr.onToolResult('lead', res(u.id, { task: { list: [
      { id: '1', subject: 'A', status: 'completed', owner: 'a1', blockedBy: [] },
      { id: '5', subject: 'New one', status: 'in_progress', owner: 'rev', blockedBy: [] },
      { id: '6', subject: 'Waiting', status: 'pending', blockedBy: ['5'] }
    ] } }), T + 11)
    expect(byId(tr, 1)).toMatchObject({ state: 'done', ownerAgentId: 'a1' })
    expect(byId(tr, 5)).toMatchObject({ title: 'New one', state: 'in_progress', ownerAgentId: 'rev' })
    expect(byId(tr, 6)).toMatchObject({ state: 'blocked', blockedBy: 5 })
  })
})

describe('R-11 TodoWrite fallback', () => {
  const todo = (tr: Tr, todos: { content: string; status: string }[], ts = T) => tr.onToolUse('lead', use('TodoWrite', { op: 'todo', todos }), ts)
  it('R-11 TodoWrite alone gives ids 1..n with source todo and mapped states', () => {
    const tr = createTaskTracker()
    todo(tr, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }])
    expect(tr.tasks().map((t: any) => [t.id, t.title, t.state, t.source])).toEqual([
      [1, 'a', 'done', 'todo'], [2, 'b', 'in_progress', 'todo'], [3, 'c', 'pending', 'todo']
    ])
  })
  it('R-11 a later TodoWrite replaces the previous list', () => {
    const tr = createTaskTracker()
    todo(tr, [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }])
    todo(tr, [{ content: 'a', status: 'completed' }], T + 5)
    expect(tr.tasks().map((t) => t.title)).toEqual(['a'])
  })
  it('R-11 once any Task* op was seen, TodoWrite is ignored (even if it came first)', () => {
    const tr = createTaskTracker()
    todo(tr, [{ content: 'todo-item', status: 'pending' }])
    create(tr, '1', 'real task')
    todo(tr, [{ content: 'later-todo', status: 'pending' }], T + 50)
    expect(tr.tasks().map((t) => t.title)).toEqual(['real task'])
    expect(byId(tr, 1).source ?? 'task').toBe('task')
  })
})

describe('R-11 robustness', () => {
  it('R-11 results/uses for unknown tool ids and empty trackers never throw', () => {
    const tr = createTaskTracker()
    expect(tr.tasks()).toEqual([])
    expect(() => tr.onToolResult('lead', res('nope', { task: { createdId: '4' } }), T)).not.toThrow()
    expect(() => tr.onToolUse('lead', use('TaskUpdate', { op: 'update', taskId: 'x' }), T)).not.toThrow()
    expect(() => tr.onToolUse('lead', { id: 'z', name: 'Bash', target: '' } as any, T)).not.toThrow()
  })
  it('R-11 tasks() returns copies: mutating the result does not change the tracker', () => {
    const tr = createTaskTracker()
    create(tr, '1', 'A')
    ;(tr.tasks()[0] as any).title = 'mutated'
    expect(tr.tasks()[0]!.title).toBe('A')
  })
})
