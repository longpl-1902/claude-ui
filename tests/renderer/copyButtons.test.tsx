// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesTab } from '@renderer/components/inspector/FilesTab'
import { WorktreeList } from '@renderer/components/team/WorktreeList'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'
import { mockTeamSnapshot } from '@shared/mock'
import type { Agent, SessionSummary, TeamSnapshot, WorkspaceSnapshot } from '@shared/types'

const ROOT = 'D:/repo'
const writeText = vi.fn()

beforeEach(() => {
  resetConsoleStore()
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

describe('copy buttons (X-I8)', () => {
  it('Files tab copies the full path while showing the shortened one', async () => {
    useConsoleStore.setState({ team: { ...useConsoleStore.getState().team, cwd: ROOT } })
    render(<FilesTab files={[{ path: 'D:/repo/src/deep/a.ts', added: 1, removed: 0 }]} />)
    await userEvent.click(screen.getByRole('button', { name: /^Copy path/ }))
    expect(writeText).toHaveBeenCalledWith('D:/repo/src/deep/a.ts')
  })

  it('WorktreeList copies branch and full path', async () => {
    const base = structuredClone(mockTeamSnapshot.agents[0]!) as Agent
    const team: TeamSnapshot = { ...structuredClone(mockTeamSnapshot), source: 'live', agents: [base] }
    useConsoleStore.setState({ team, liveTeam: team, teamMode: 'live' })
    const workspace: WorkspaceSnapshot = {
      root: ROOT,
      base: 'main',
      overlaps: [],
      updatedAt: '',
      worktrees: [
        { path: 'D:/repo-wt/feat-x', branch: 'feat/x', head: 'a', detached: false, isMain: false, ahead: 0, behind: 0, files: [], changedFiles: 0 }
      ]
    }
    useWorkspaceStore.setState({ watchedRoot: ROOT, workspace })
    render(<WorktreeList />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy branch feat/x' }))
    expect(writeText).toHaveBeenLastCalledWith('feat/x')
    await userEvent.click(screen.getByRole('button', { name: 'Copy path of feat/x' }))
    expect(writeText).toHaveBeenLastCalledWith('D:/repo-wt/feat-x')
  })

  it('Stop process dialog copies the pid and the session id', async () => {
    const base = structuredClone(mockTeamSnapshot.agents[0]!)
    const lead = { ...base, id: 'lead', name: 'lead', worktree: '', cwd: ROOT, runtime: { kind: 'lead', startedMs: 0, lastActivityMs: 0, openTools: [], lastTurn: 'assistant_end' } } as Agent
    const team: TeamSnapshot = { ...structuredClone(mockTeamSnapshot), source: 'live', sessionId: 'sess-9', cwd: ROOT, worktrees: [], tasks: [], overlaps: [], agents: [lead] }
    useConsoleStore.setState({ team, liveTeam: team, teamMode: 'live', selectedAgentId: 'lead' })
    const s: SessionSummary = {
      sessionId: 'sess-9', accountId: 'company', configDir: 'C:/c', projectDir: 'p', cwd: ROOT, title: 'T',
      project: { key: 'd:/repo', name: 'repo', root: ROOT, git: true }, mtimeMs: 1, sizeBytes: 1, live: true, registryPid: 4242
    }
    useConsoleStore.setState({ sessions: [s], projectKey: 'd:/repo' })
    ;(window as unknown as { api: unknown }).api = {
      control: { list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(), onStream: vi.fn() },
      session: { killExternal: vi.fn() },
      worktree: { openInEditor: vi.fn() }
    }
    render(<Inspector />)
    // T32 U15: Stop process... lives in the inspector's "..." menu.
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop process…' }))
    const dlg = screen.getByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Copy process id' }))
    expect(writeText).toHaveBeenLastCalledWith('4242')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Copy session id' }))
    expect(writeText).toHaveBeenLastCalledWith('sess-9')
    delete (window as unknown as { api?: unknown }).api
  })
})
