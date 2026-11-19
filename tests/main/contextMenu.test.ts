import { describe, expect, it, vi } from 'vitest'
import { buildContextMenu, registerContextMenu } from '../../src/main/contextMenu'
import type { ContextParams } from '../../src/main/contextMenu'
import { createHandlers, registerIpcHandlers } from '../../src/main/ipc/handlers'
import { safeExternalUrl } from '../../src/shared/externalUrl'
import { INVOKE_CHANNELS } from '../../src/shared/ipc'

const flags = { canCut: false, canCopy: false, canPaste: false, canSelectAll: true }
const params = (over: Partial<ContextParams> = {}): ContextParams => ({
  isEditable: false,
  selectionText: '',
  linkURL: '',
  editFlags: flags,
  ...over
})
const labels = (p: ContextParams) => buildContextMenu(p).map((i) => ('label' in i ? i.label : '---'))

describe('T33 context menu items follow params.editFlags', () => {
  it('editable field: Cut/Copy/Paste/Select all, enabled per flag', () => {
    const items = buildContextMenu(
      params({ isEditable: true, editFlags: { canCut: true, canCopy: false, canPaste: true, canSelectAll: true } })
    )
    const by = Object.fromEntries(items.filter((i) => 'role' in i).map((i) => [(i as { label: string }).label, (i as { enabled: boolean }).enabled]))
    expect(by).toEqual({ Cut: true, Copy: false, Paste: true, 'Select all': true })
  })

  it('read-only selection: Copy + Select all, no Cut/Paste', () => {
    expect(labels(params({ selectionText: 'abc', editFlags: { ...flags, canCopy: true } }))).toEqual(['Copy', 'Select all'])
  })

  it('a safe link adds "Copy link" with the validated URL', () => {
    const items = buildContextMenu(params({ linkURL: 'https://example.com/a', selectionText: 'x', editFlags: { ...flags, canCopy: true } }))
    expect(items[0]).toMatchObject({ label: 'Copy link', action: 'copy-link', url: 'https://example.com/a' })
  })

  it('a javascript: or file: link gets no Copy link', () => {
    expect(labels(params({ linkURL: 'javascript:alert(1)' }))).not.toContain('Copy link')
    expect(labels(params({ linkURL: 'file:///C:/x' }))).not.toContain('Copy link')
  })

  it('nothing selectable gives no menu', () => {
    expect(buildContextMenu(params({ editFlags: { ...flags, canSelectAll: false } }))).toEqual([])
  })

  it('registerContextMenu pops up the built menu and Copy link writes the clipboard', () => {
    let handler: (e: unknown, p: ContextParams) => void = () => {}
    const popup = vi.fn()
    let template: Array<Record<string, unknown>> = []
    const writeClipboard = vi.fn()
    registerContextMenu(
      { on: (_ev, cb) => void (handler = cb) },
      { buildMenu: (t) => ((template = t), { popup }), writeClipboard }
    )
    handler({}, params({ linkURL: 'https://example.com/' }))
    expect(popup).toHaveBeenCalledTimes(1)
    ;(template[0]!.click as () => void)()
    expect(writeClipboard).toHaveBeenCalledWith('https://example.com/')
    handler({}, params({ editFlags: { ...flags, canSelectAll: false } }))
    expect(popup).toHaveBeenCalledTimes(1)
  })
})

describe('T33 app:open-external', () => {
  it('safeExternalUrl accepts only plain http/https', () => {
    expect(safeExternalUrl('https://example.com/x?y=1')).toBe('https://example.com/x?y=1')
    expect(safeExternalUrl('http://localhost:3000')).toBe('http://localhost:3000/')
    for (const bad of ['javascript:alert(1)', 'file:///C:/a', 'data:text/html,hi', 'ftp://x.y', 'https://u:p@x.y', '//x.y', '', 'https://x.y/a b', 5, null])
      expect(safeExternalUrl(bad)).toBeNull()
  })

  it('is a registered invoke channel and only opens validated URLs', async () => {
    expect(INVOKE_CHANNELS).toContain('app:open-external')
    const openExternal = vi.fn(async () => {})
    const handle = vi.fn()
    registerIpcHandlers({ handle } as never, createHandlers({ openExternal }))
    const fn = handle.mock.calls.find((c) => c[0] === 'app:open-external')![1] as (e: unknown, u: unknown) => Promise<unknown>
    expect(await fn({}, 'javascript:alert(1)')).toEqual({ ok: false, reason: 'invalid-args' })
    expect(await fn({}, 42)).toEqual({ ok: false, reason: 'invalid-args' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(await fn({}, 'https://example.com')).toEqual({ ok: true })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
  })
})
