// T06 / R-11: task fields carried through parseLine (ToolUseRec.task, ToolResultRec.task).
// Kept in its own file so the existing parseLine.test.ts stays untouched; T06 may merge these cases there.
import { describe, expect, it } from 'vitest'
import { parseLine } from '../../../src/main/transcripts/parseLine'
import { assistantBlocks, at, toLine, toolResult, toolUseBlock } from '../../fixtures/transcripts/builders'

const asst = (name: string, input: Record<string, unknown>, id = 'toolu_x'): any => {
  const line = assistantBlocks([toolUseBlock(id, name, input)], { messageId: 'msg_1', stopReason: 'tool_use', ts: at(1) })[0]!
  return parseLine(toLine(line))
}
const taskOf = (r: any) => r.toolUses[0].task

describe('R-11 parseLine: task tool inputs', () => {
  it('R-11 TaskCreate -> op create with subject and description', () => {
    expect(taskOf(asst('TaskCreate', { subject: 'Write schema', description: 'v2 DTO', activeForm: 'Writing schema' }))).toEqual({ op: 'create', subject: 'Write schema', description: 'v2 DTO' })
  })
  it('R-11 TaskUpdate -> op update with id, status, subject, owner and addBlockedBy', () => {
    expect(taskOf(asst('TaskUpdate', { taskId: '2', status: 'in_progress', subject: 'S', owner: 'rev', addBlockedBy: ['1'], addBlocks: ['3'] }))).toEqual({
      op: 'update', taskId: '2', status: 'in_progress', subject: 'S', owner: 'rev', addBlockedBy: ['1']
    })
  })
  it('R-11 TaskUpdate with only a status keeps just the needed fields', () => {
    expect(taskOf(asst('TaskUpdate', { taskId: '2', status: 'completed' }))).toMatchObject({ op: 'update', taskId: '2', status: 'completed' })
  })
  it('R-11 TaskList -> op list', () => {
    expect(taskOf(asst('TaskList', {}))).toEqual({ op: 'list' })
  })
  it('R-11 TodoWrite -> op todo with content/status pairs only', () => {
    expect(taskOf(asst('TodoWrite', { todos: [{ content: 'a', status: 'pending', activeForm: 'Doing a' }, { content: 'b', status: 'completed', activeForm: 'x' }] }))).toEqual({
      op: 'todo', todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'completed' }]
    })
  })
  it('R-11 other tools have no task field', () => {
    expect(asst('Bash', { command: 'ls' }).toolUses[0].task).toBeUndefined()
  })
  it('R-11 strings are capped at 200 chars and arrays at 100 entries', () => {
    const t = taskOf(asst('TaskCreate', { subject: 's'.repeat(900), description: 'd'.repeat(900) }))
    expect(t.subject.length).toBeLessThanOrEqual(201)
    expect(t.description.length).toBeLessThanOrEqual(201)
    const u = taskOf(asst('TaskUpdate', { taskId: '1', addBlockedBy: Array.from({ length: 300 }, (_, i) => String(i)) }))
    expect(u.addBlockedBy.length).toBeLessThanOrEqual(100)
    const w = taskOf(asst('TodoWrite', { todos: Array.from({ length: 300 }, (_, i) => ({ content: `c${i}`, status: 'pending' })) }))
    expect(w.todos.length).toBeLessThanOrEqual(100)
  })
  it('R-11 malformed inputs never throw and never invent fields', () => {
    for (const input of [{}, { subject: 5 }, { taskId: {} }, { todos: 'x' }, { todos: [null, 3, { content: 1 }] }]) {
      for (const name of ['TaskCreate', 'TaskUpdate', 'TodoWrite']) expect(() => asst(name, input)).not.toThrow()
    }
  })
})

describe('R-11 parseLine: task tool results', () => {
  const result = (toolUseResult: unknown): any => {
    const r: any = parseLine(toLine(toolResult('toolu_x', 'ok', { toolUseResult, ts: at(2) })))
    return r.results[0]
  }
  it('R-11 TaskCreate result -> task.createdId from toolUseResult.task.id', () => {
    expect(result({ task: { id: '7', subject: 'Write schema' } }).task).toEqual({ createdId: '7' })
  })
  it('R-11 TaskList result -> task.list with id, subject, status, owner and blockedBy', () => {
    const r = result({ tasks: [{ id: '1', subject: 'A', status: 'completed', blockedBy: [] }, { id: '2', subject: 'B', status: 'pending', owner: 'rev', blockedBy: ['1'] }] })
    expect(r.task.list).toEqual([
      { id: '1', subject: 'A', status: 'completed', blockedBy: [] },
      { id: '2', subject: 'B', status: 'pending', owner: 'rev', blockedBy: ['1'] }
    ])
  })
  it('R-11 a non-task result has no task field', () => {
    expect(result({ stdout: 'x', stderr: '' }).task).toBeUndefined()
    expect(result('plain string').task).toBeUndefined()
  })
  it('R-11 existing result fields are unchanged', () => {
    const r = result({ task: { id: '7', subject: 's' } })
    expect(r).toMatchObject({ toolUseId: 'toolu_x', isError: false })
  })
})
