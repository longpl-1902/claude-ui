// @vitest-environment jsdom
import './jestDom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from '@renderer/components/inspector/Inspector'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'

beforeEach(() => resetConsoleStore())
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

const tab = (name: string) => screen.getByRole('tab', { name })

describe('R-11 Inspector header, stats and assigned task', () => {
  it('shows backend-impl by default', () => {
    render(<Inspector />)
    expect(screen.getByText('backend-impl')).toBeInTheDocument()
    expect(screen.getByText('Server + Revit export · Sonnet')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Elapsed')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('Tool calls')).toBeInTheDocument()
    expect(screen.getByText('17m 05s')).toBeInTheDocument()
    expect(screen.getByText('241k')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    expect(screen.getByText('Assigned task')).toBeInTheDocument()
    expect(screen.getByText('#3 Export endpoints')).toBeInTheDocument()
    expect(screen.getByText(/feat\/backend-auth/)).toBeInTheDocument()
  })

  it('follows the selection in the store', () => {
    render(<Inspector />)
    expect(screen.getByText('backend-impl')).toBeInTheDocument()
    act(() => useConsoleStore.getState().selectAgent('ui'))
    expect(screen.getByText('#4 Sheet panel UI')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
  })
})

describe('R-11 Inspector tabs', () => {
  it('has an accessible tablist with Activity selected by default', () => {
    render(<Inspector />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(tab('Activity')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Files')).toHaveAttribute('aria-selected', 'false')
    expect(tab('Messages')).toHaveAttribute('aria-selected', 'false')
    const panel = screen.getByRole('tabpanel')
    expect(tab('Activity').getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.id).not.toBe('')
  })

  it('Activity shows the events', () => {
    render(<Inspector />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('dotnet test --filter "Category=Export"')).toBeInTheDocument()
    expect(screen.getByText('src/Services/SheetExportService.cs')).toBeInTheDocument()
    expect(screen.getByText('10:44:10')).toBeInTheDocument()
  })

  it('Files tab shows paths with + and a real minus sign', async () => {
    render(<Inspector />)
    await userEvent.click(tab('Files'))
    expect(tab('Files')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('src/Services/SheetExportService.cs')).toBeInTheDocument()
    expect(screen.getByText('+96')).toBeInTheDocument()
    expect(screen.getByText('−20')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open full diff against main' })).toBeInTheDocument()
    expect(useConsoleStore.getState().inspectorTab).toBe('files')
  })

  it('Messages tab shows direction, peer and text', async () => {
    render(<Inspector />)
    await userEvent.click(tab('Messages'))
    expect(screen.getByText(/to lead/)).toBeInTheDocument()
    expect(screen.getByText(/Export endpoints compile against SheetDto v1/)).toBeInTheDocument()
  })

  it('an agent without files shows the empty state', async () => {
    useConsoleStore.getState().selectAgent('rev')
    render(<Inspector />)
    await userEvent.click(tab('Files'))
    expect(screen.getByText('No files changed yet.')).toBeInTheDocument()
  })

  it('a failed activity result is rendered with a failed class', async () => {
    useConsoleStore.getState().selectAgent('test')
    render(<Inspector />)
    const result = screen.getByText('FAIL · SheetDto_RoundTrip, Export_ToExcel')
    expect(result.closest('[class*="failed"]')).not.toBeNull()
    const ok = screen.getByText('46 passed')
    expect(ok.closest('[class*="failed"]')).toBeNull()
  })

  it('ArrowRight / ArrowLeft move between tabs with a roving tabindex', async () => {
    render(<Inspector />)
    expect(tab('Activity')).toHaveAttribute('tabindex', '0')
    expect(tab('Files')).toHaveAttribute('tabindex', '-1')
    tab('Activity').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tab('Files')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Files')).toHaveAttribute('tabindex', '0')
    expect(tab('Activity')).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowLeft}')
    expect(tab('Activity')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('R-11 Inspector actions', () => {
  it('has the four action buttons', () => {
    render(<Inspector />)
    for (const n of ['Message agent', 'Open worktree', 'Pause', 'Stop'])
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument()
  })

  it('Message agent sets the console draft to @name', async () => {
    render(
      <>
        <input id="ac-prompt" aria-label="Message the lead" />
        <Inspector />
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Message agent' }))
    expect(useConsoleStore.getState().consoleDraft).toBe('@backend-impl ')
  })

  it('Pause / Stop / Open worktree call window.api when present', async () => {
    const api = {
      agent: { pause: vi.fn().mockResolvedValue({ ok: false }), stop: vi.fn().mockResolvedValue({ ok: false }) },
      worktree: { openInEditor: vi.fn().mockResolvedValue({ ok: false }) }
    }
    ;(window as unknown as { api: unknown }).api = api
    render(<Inspector />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(api.agent.pause).toHaveBeenCalledWith('be')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.agent.stop).toHaveBeenCalledWith('be')
    await userEvent.click(screen.getByRole('button', { name: 'Open worktree' }))
    expect(api.worktree.openInEditor).toHaveBeenCalledTimes(1)
  })

  it('actions do not throw without window.api', async () => {
    render(<Inspector />)
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open worktree' }))
    expect(screen.getByText('backend-impl')).toBeInTheDocument()
  })
})
