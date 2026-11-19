// @vitest-environment jsdom
import './jestDom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from '@renderer/components/ui/Dialog'

function Harness({ initialFocus }: { initialFocus?: () => HTMLElement | null }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Dialog
        open={open}
        title="Confirm thing"
        onClose={() => setOpen(false)}
        initialFocus={initialFocus}
        footer={<button>Done</button>}
      >
        <input aria-label="Name" />
        <button>Inner</button>
      </Dialog>
    </div>
  )
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="T" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a modal dialog labelled by its title and focuses the first control', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }))
    const dlg = screen.getByRole('dialog', { name: 'Confirm thing' })
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('honours initialFocus', async () => {
    render(<Harness initialFocus={() => document.querySelector<HTMLElement>('.ac-dialog__footer button')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
  })

  it('Esc closes and focus returns to the opener', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Inner' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus()
  })

  it('backdrop click closes, clicking inside does not', async () => {
    const onClose = vi.fn()
    const { container } = render(<Dialog open title="T" onClose={onClose}><button>x</button></Dialog>)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'x' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(container.querySelector('.ac-dialog__backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
