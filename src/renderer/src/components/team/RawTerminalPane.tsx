import { useEffect, useRef } from 'react'
import './teamCenter.css'

export function RawTerminalPane(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    let term: { dispose(): void } | undefined
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css')
      ])
      if (disposed || !host.current) return
      const t = new Terminal({
        theme: { background: '#0B0C0E', foreground: '#E6E7EA' },
        fontFamily: 'JetBrains Mono',
        fontSize: 12,
        disableStdin: true
      })
      const fit = new FitAddon()
      t.loadAddon(fit)
      t.open(host.current)
      try {
        fit.fit()
      } catch {
        // host not measurable (e.g. jsdom)
      }
      t.write('Agent Console raw terminal (placeholder)\r\nThe live lead session terminal arrives in Phase 2.\r\n')
      term = t
    })()
    return () => {
      disposed = true
      term?.dispose()
    }
  }, [])
  return (
    <div className="ac-tc-raw">
      <p className="ac-tc-raw__fallback">Raw terminal: placeholder until Phase 2</p>
      <div ref={host} className="ac-tc-raw__term" aria-hidden="true" />
    </div>
  )
}
