// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamView } from '@renderer/screens/TeamView'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedDemoTeam } from './seedTeam'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open() {}
    write() {}
    dispose() {}
    loadAddon() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

beforeEach(() => {
  resetConsoleStore()
  seedDemoTeam()
})

describe('R-15 TeamView smoke', () => {
  it('renders the key texts from every section', () => {
    const { container } = render(<TeamView />)
    expect(screen.getByText('Agent Console')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Worktrees' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shared tasks' })).toBeInTheDocument()
    expect(container).toHaveTextContent('File overlap:')
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    for (const name of ['lead', 'api-designer', 'backend-impl', 'ui-builder', 'test-writer', 'reviewer'])
      expect(screen.getAllByText(name).length).toBeGreaterThan(0)
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Lead console')).toBeInTheDocument()
    expect(screen.getByText('Assigned task')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Message agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('shows every status with its text label', () => {
    render(<TeamView />)
    // 3 running cards, plus the running pill in the inspector for the selected (running) agent.
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('Waiting').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Needs you').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(1)
  })

  it('has the 3-column landmarks', () => {
    render(<TeamView />)
    expect(screen.getByRole('complementary', { name: 'Worktrees and tasks' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Agent inspector' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('clicking the ui-builder card shows its task in the inspector', async () => {
    render(<TeamView />)
    const inspector = screen.getByRole('complementary', { name: 'Agent inspector' })
    expect(within(inspector).getByText('#3 Export endpoints')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /ui-builder/ }))
    expect(useConsoleStore.getState().selectedAgentId).toBe('ui')
    expect(within(inspector).getByText('#4 Sheet panel UI')).toBeInTheDocument()
  })

  it('has a Skip to agents link as the first focusable element targeting #ac-agents', () => {
    const { container } = render(<TeamView />)
    const link = screen.getByRole('link', { name: 'Skip to agents' })
    expect(link).toHaveAttribute('href', '#ac-agents')
    expect(container.querySelector('#ac-agents')).not.toBeNull()
    expect(container.querySelector('#ac-agents')).toContainElement(screen.getByRole('heading', { name: 'Team' }))
    const focusable = container.querySelector('a[href], button')
    expect(focusable).toBe(link)
  })
})

describe('R-14 responsive CSS (static check; visual check is manual)', () => {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/screens/TeamView.css'), 'utf8')

  it('keeps the 240 / 560 / 360 flex-basis values and wraps', () => {
    expect(css).toMatch(/flex:\s*1\s+1\s+240px/)
    expect(css).toMatch(/flex:\s*999\s+1\s+560px/)
    expect(css).toMatch(/flex:\s*1\s+1\s+360px/)
    expect(css).toMatch(/flex-wrap:\s*wrap/)
  })

  it('has narrow-window breakpoints at 1100px and 760px', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*1100px\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/)
  })
})
