import { SHORTCUTS } from '../../hooks/useShortcuts'
import { useConsoleStore } from '../../store/useConsoleStore'
import { Dialog } from './Dialog'

const listStyle = { display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' } as const
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', minWidth: 0 } as const
const kbdStyle = {
  flex: '0 0 auto',
  fontFamily: 'var(--ac-font-mono)',
  fontSize: 12,
  padding: '2px 6px',
  border: '1px solid var(--ac-border-card)',
  borderRadius: 4,
  background: 'var(--ac-bg-card)'
} as const

/** Help overlay listing every shortcut; opened with `?`, closed with Esc. */
export function ShortcutsHelp(): JSX.Element | null {
  const open = useConsoleStore((s) => s.shortcutsOpen)
  const setOpen = useConsoleStore((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <ul style={listStyle} aria-label="Keyboard shortcuts">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} style={rowStyle}>
            <kbd style={kbdStyle}>{s.keys}</kbd>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{s.action}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
