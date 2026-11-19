import { safeExternalUrl } from '@shared/externalUrl'

export interface ContextParams {
  isEditable: boolean
  selectionText: string
  linkURL: string
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

export type MenuItemSpec =
  | { type: 'separator' }
  | { label: string; role: 'cut' | 'copy' | 'paste' | 'selectAll'; enabled: boolean }
  | { label: string; enabled: true; action: 'copy-link'; url: string }

/** Standard edit menu from webContents 'context-menu' params. Empty when there is nothing to offer. */
export function buildContextMenu(params: ContextParams): MenuItemSpec[] {
  const f = params.editFlags
  const items: MenuItemSpec[] = []
  const link = params.linkURL ? safeExternalUrl(params.linkURL) : null
  if (link) items.push({ label: 'Copy link', enabled: true, action: 'copy-link', url: link })
  const hasSelection = params.selectionText.trim().length > 0
  if (params.isEditable) {
    if (items.length) items.push({ type: 'separator' })
    items.push(
      { label: 'Cut', role: 'cut', enabled: f.canCut },
      { label: 'Copy', role: 'copy', enabled: f.canCopy },
      { label: 'Paste', role: 'paste', enabled: f.canPaste },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll }
    )
  } else if (hasSelection) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: 'Copy', role: 'copy', enabled: f.canCopy }, { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll })
  } else if (!link && f.canSelectAll) {
    items.push({ label: 'Select all', role: 'selectAll', enabled: true })
  }
  return items
}

export interface ContextMenuHost {
  on(event: 'context-menu', cb: (e: unknown, params: ContextParams) => void): unknown
}
export interface ContextMenuDeps {
  buildMenu(template: Array<Record<string, unknown>>): { popup(): void }
  writeClipboard(text: string): void
}

/** Registers the right-click menu. No spellcheck service is involved. */
export function registerContextMenu(contents: ContextMenuHost, deps: ContextMenuDeps): void {
  contents.on('context-menu', (_e, params) => {
    const specs = buildContextMenu(params)
    if (specs.length === 0) return
    const template = specs.map((s): Record<string, unknown> => {
      if ('type' in s) return { type: 'separator' }
      if ('action' in s) return { label: s.label, click: () => deps.writeClipboard(s.url) }
      return { label: s.label, role: s.role, enabled: s.enabled }
    })
    deps.buildMenu(template).popup()
  })
}
