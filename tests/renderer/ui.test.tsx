// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@renderer/components/ui/Button'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { Avatar } from '@renderer/components/ui/Avatar'
import * as Icons from '@renderer/components/ui/Icons'
import {
  ACCOUNT_FALLBACK_COLOR,
  SEGMENT_COLORS,
  STATUS_META,
  TIMELINE_LEGEND,
  TOOL_COLORS,
  toolColor
} from '@renderer/theme/colors'

const rendererSrc = resolve(__dirname, '../../src/renderer/src')
const read = (rel: string) => readFileSync(resolve(rendererSrc, rel), 'utf8')

function token(css: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)
  return m?.[1]?.trim()
}

describe('R-06 StatusPill always pairs the color with a text label', () => {
  it.each([
    ['running', 'Running'],
    ['waiting', 'Waiting'],
    ['needs-you', 'Needs you'],
    ['done', 'Done']
  ] as const)('%s renders the label %s', (status, label) => {
    render(<StatusPill status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('the running pill has a pulsing dot, others do not', () => {
    const { container, rerender } = render(<StatusPill status="running" />)
    expect(container.querySelector('.ac-pill')).not.toBeNull()
    expect(container.querySelector('.ac-pulse')).not.toBeNull()
    rerender(<StatusPill status="done" />)
    expect(container.querySelector('.ac-pulse')).toBeNull()
  })

  it('the dot is aria-hidden', () => {
    const { container } = render(<StatusPill status="waiting" />)
    expect(container.querySelector('.ac-pill [aria-hidden="true"]')).not.toBeNull()
  })
})

describe('Button primitive', () => {
  it('defaults to type="button" and forwards onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toHaveAttribute('type', 'button')
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('lets callers override the type', () => {
    render(<Button type="submit">Send</Button>)
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit')
  })

  it('uses ac-btn ac-btn--<variant> ac-btn--<size> classes and forwards disabled', () => {
    render(
      <Button variant="primary" size="lg" disabled>
        Save
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveClass('ac-btn', 'ac-btn--primary', 'ac-btn--lg')
    expect(btn).toBeDisabled()
  })
})

describe('Avatar primitive', () => {
  it('renders its initials and is aria-hidden by default', () => {
    const { container } = render(<Avatar initials="AD" color="#8FB4FF" />)
    expect(screen.getByText('AD')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('is labelled when label is passed', () => {
    render(<Avatar initials="AD" color="#8FB4FF" label="api-designer" />)
    expect(screen.getByLabelText('api-designer')).toBeInTheDocument()
  })

  it('supports a 20px circle with 10px text', () => {
    render(<Avatar initials="AD" color="#8FB4FF" size={20} shape="circle" />)
    const el = screen.getByText('AD')
    expect(el.style.width).toBe('20px')
    expect(el.style.fontSize).toBe('10px')
    expect(el.style.borderRadius).toBe('50%')
  })
})

describe('Icons', () => {
  const names = [
    'TerminalIcon',
    'BranchIcon',
    'WarningIcon',
    'ChevronDownIcon',
    'ChevronLeftIcon',
    'FolderIcon',
    'RefreshIcon',
    'LockIcon',
    'CheckIcon'
  ] as const

  it.each(names)('%s renders an aria-hidden svg', (name) => {
    const Icon = (Icons as Record<string, ComponentType<{ size?: number; color?: string }>>)[name]!
    const { container } = render(<Icon size={20} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('theme/colors', () => {
  const tokens = read('styles/tokens.css')

  it('STATUS_META has labels and only running pulses', () => {
    expect(STATUS_META.running.label).toBe('Running')
    expect(STATUS_META.waiting.label).toBe('Waiting')
    expect(STATUS_META['needs-you'].label).toBe('Needs you')
    expect(STATUS_META.done.label).toBe('Done')
    expect(STATUS_META.running.pulse).toBe(true)
    expect(STATUS_META.waiting.pulse).toBe(false)
    expect(STATUS_META['needs-you'].pulse).toBe(false)
    expect(STATUS_META.done.pulse).toBe(false)
  })

  it('status colors equal the CSS tokens', () => {
    for (const [key, name] of [
      ['running', 'running'],
      ['waiting', 'waiting'],
      ['needs-you', 'needs-you'],
      ['done', 'done']
    ] as const) {
      expect(STATUS_META[key].color.toLowerCase()).toBe(token(tokens, `--ac-status-${name}`)!.toLowerCase())
      expect(STATUS_META[key].bg.toLowerCase()).toBe(token(tokens, `--ac-status-${name}-bg`)!.toLowerCase())
    }
  })

  it('segment colors equal the CSS tokens', () => {
    for (const kind of ['think', 'read', 'edit', 'bash', 'wait', 'error'] as const)
      expect(SEGMENT_COLORS[kind].toLowerCase()).toBe(token(tokens, `--ac-seg-${kind}`)!.toLowerCase())
  })

  it('tool colors', () => {
    expect(TOOL_COLORS['Done']).toBe('#5ED3A8')
    expect(toolColor('Edit')).toBe('#8FB4FF')
    expect(toolColor('Bash').toLowerCase()).toBe('#c49bff')
    expect(toolColor('NoSuchTool')).toBe('#A4AAB4')
  })

  it('legend and fallback account color', () => {
    expect(TIMELINE_LEGEND).toEqual([
      { label: 'Thinking', kind: 'think' },
      { label: 'Read / Grep', kind: 'read' },
      { label: 'Edit', kind: 'edit' },
      { label: 'Bash', kind: 'bash' },
      { label: 'Error', kind: 'error' }
    ])
    expect(ACCOUNT_FALLBACK_COLOR).toBe('#5C636E')
  })
})

describe('R-06 / R-18 design tokens and global styles', () => {
  const tokens = read('styles/tokens.css')
  const globalCss = read('styles/global.css')

  it('tokens.css defines the agreed custom properties', () => {
    const expected: Record<string, string> = {
      '--ac-bg-app': '#0E0F11',
      '--ac-bg-panel': '#121417',
      '--ac-bg-card': '#16181C',
      '--ac-bg-selected': '#1A2030',
      '--ac-border': '#23262C',
      '--ac-border-card': '#262A31',
      '--ac-text': '#E6E7EA',
      '--ac-accent': '#7AA7FF',
      '--ac-accent-2': '#8FB4FF',
      '--ac-status-running': '#F2A541',
      '--ac-status-waiting': '#8FB4FF',
      '--ac-status-needs-you': '#FF8A8A',
      '--ac-status-done': '#5ED3A8',
      '--ac-account-company': '#6E9BF0',
      '--ac-account-personal': '#F2A541',
      '--ac-warn-border': '#5A3E1E',
      '--ac-radius-card': '10px',
      '--ac-radius-pill': '999px'
    }
    for (const [name, value] of Object.entries(expected))
      expect(token(tokens, name)?.toLowerCase(), name).toBe(value.toLowerCase())
    for (const name of [
      '--ac-text-muted',
      '--ac-text-subtle',
      '--ac-text-dim',
      '--ac-text-faint',
      '--ac-font-ui',
      '--ac-font-mono',
      '--ac-seg-think',
      '--ac-danger-border',
      '--ac-flow-bg'
    ])
      expect(token(tokens, name), name).toBeDefined()
  })

  it('global.css has visible focus, a pulse and reduced-motion handling', () => {
    expect(globalCss).toMatch(/:focus-visible/)
    expect(globalCss).toMatch(/@keyframes\s+ac-pulse/)
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ac-pulse[\s\S]*animation:\s*none/)
  })

  it('main.tsx bundles Inter and JetBrains Mono locally', () => {
    const main = read('main.tsx')
    for (const f of [
      '@fontsource/inter/400.css',
      '@fontsource/inter/500.css',
      '@fontsource/inter/600.css',
      '@fontsource/inter/700.css',
      '@fontsource/jetbrains-mono/400.css',
      '@fontsource/jetbrains-mono/500.css',
      './styles/tokens.css',
      './styles/global.css'
    ])
      expect(main).toContain(f)
  })

  it('no renderer style or entry file references a remote URL', () => {
    for (const rel of ['styles/tokens.css', 'styles/global.css', 'main.tsx', 'components/ui/ui.css']) {
      const text = read(rel)
      expect(text, rel).not.toMatch(/https?:\/\//)
      expect(text, rel).not.toMatch(/fonts\.g/)
    }
  })
})
