// @vitest-environment jsdom
import './jestDom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceRow } from '@renderer/components/accounts/AppearanceRow'
import { ReopenWindowsToggle } from '@renderer/components/accounts/ReopenWindowsToggle'

const setApi = (windows: unknown): void => void ((window as unknown as { api?: unknown }).api = windows === undefined ? undefined : { windows })
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('ReopenWindowsToggle', () => {
  it('reflects getPrefs, saves a change and reverts when main refuses', async () => {
    const getPrefs = vi.fn().mockResolvedValue({ reopenOnStart: true })
    const setPrefs = vi.fn().mockResolvedValue({ ok: true })
    setApi({ getPrefs, setPrefs })
    const user = userEvent.setup()
    render(<ReopenWindowsToggle />)
    const box = await screen.findByRole('checkbox', { name: /Reopen pop-out windows on start/ })
    expect(box).toBeChecked()
    await user.click(box)
    expect(setPrefs).toHaveBeenCalledWith({ reopenOnStart: false })
    await waitFor(() => expect(box).not.toBeChecked())

    setPrefs.mockResolvedValueOnce({ ok: false, reason: 'invalid-args' })
    await user.click(box)
    expect(setPrefs).toHaveBeenLastCalledWith({ reopenOnStart: true })
    await waitFor(() => expect(box).not.toBeChecked())
  })

  it('renders nothing without the windows prefs api', () => {
    setApi(undefined)
    const { container } = render(<ReopenWindowsToggle />)
    expect(container).toBeEmptyDOMElement()
    setApi({ getPrefs: vi.fn().mockResolvedValue({ reopenOnStart: true }) })
    const second = render(<ReopenWindowsToggle />)
    expect(second.container).toBeEmptyDOMElement()
  })

  it('AppearanceRow renders the toggle when the api exists', async () => {
    setApi({ getPrefs: vi.fn().mockResolvedValue({ reopenOnStart: false }), setPrefs: vi.fn().mockResolvedValue({ ok: true }) })
    render(<AppearanceRow />)
    expect(await screen.findByRole('checkbox', { name: /Reopen pop-out windows on start/ })).not.toBeChecked()
  })
})
