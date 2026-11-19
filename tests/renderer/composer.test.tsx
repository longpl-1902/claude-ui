// @vitest-environment jsdom
import './jestDom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Composer } from '@renderer/components/chat/Composer'
import type { ComposerProps } from '@renderer/components/chat/Composer'

function Host(p: Partial<ComposerProps> & { initial?: string }) {
  const [v, setV] = useState(p.initial ?? '')
  return <Composer value={v} onChange={setV} onSend={() => {}} target="to lead" {...p} />
}
const box = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

describe('T33 composer', () => {
  it('never sends on mount, typing or paste (R-19)', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="draft" />)
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.type(box(), ' more')
    await userEvent.paste('pasted\ntext\n')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Enter sends exactly once', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hello" />)
    box().focus()
    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter inserts a newline and does not send', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} />)
    await userEvent.type(box(), 'a{Shift>}{Enter}{/Shift}b')
    expect(box().value).toBe('a\nb')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('empty or whitespace text does not send', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="   " />)
    box().focus()
    await userEvent.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('the Send button sends once', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hi" />)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Enter during IME composition does not send', () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="x" />)
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Esc blurs the field', async () => {
    render(<Host />)
    box().focus()
    expect(box()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(box()).not.toHaveFocus()
  })

  it('disabled: no input, no send, shows the reason', () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hi" disabled disabledReason="Runs in a terminal" />)
    expect(box()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByText('Runs in a terminal')).toBeInTheDocument()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows target and state, starts at 2 rows, and exposes the T28 slots', () => {
    const onPaste = vi.fn()
    render(
      <Host
        target="to @alice"
        stateLabel="busy"
        toolbar={<button>tb</button>}
        beforeInput={<div>chips</div>}
        suggestions={<div>popover</div>}
        onPaste={onPaste}
      />
    )
    expect(screen.getByText('to @alice')).toBeInTheDocument()
    expect(screen.getByText('busy')).toBeInTheDocument()
    for (const t of ['tb', 'chips', 'popover']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(box().rows).toBe(2)
    fireEvent.paste(box(), { clipboardData: { getData: () => 'x', files: [], items: [] } })
    expect(onPaste).toHaveBeenCalledTimes(1)
  })

  it('height is capped to about 40 percent of the view and then scrolls', () => {
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    const sh = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    render(<Host initial={'l\n'.repeat(60)} />)
    expect(box().style.height).toBe('200px')
    expect(box().style.overflowY).toBe('auto')
    sh.mockRestore()
    ch.mockRestore()
  })
})
