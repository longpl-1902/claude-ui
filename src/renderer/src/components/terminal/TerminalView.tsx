export interface TerminalViewProps {
  ptyId: string
  ariaLabel?: string
  className?: string
  interactive?: boolean // default true
}

/** Stub: the xterm-backed implementation replaces this body. */
export function TerminalView({ ptyId, ariaLabel }: TerminalViewProps): JSX.Element {
  return <div className="ac-term" data-pty-id={ptyId} role="region" aria-label={ariaLabel ?? 'Terminal'} />
}
