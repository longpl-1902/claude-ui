import { useEffect, useRef } from 'react'
import './terminal.css'

export interface TerminalViewProps {
  ptyId: string
  ariaLabel?: string
  className?: string
  interactive?: boolean // default true
}

/** Attaches an xterm to a main-process pty by id. Unmounting never kills the pty. */
export function TerminalView({ ptyId, ariaLabel, className, interactive = true }: TerminalViewProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = host.current
    const api = window.api
    if (!container || !api?.pty) return
    const pty = api.pty
    container.removeAttribute('data-exited')
    let disposed = false
    const cleanups: Array<() => void> = []

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css')
      ])
      if (disposed) return
      const term = new Terminal({
        theme: { background: '#0B0C0E', foreground: '#E6E7EA' },
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: 12,
        disableStdin: !interactive,
        scrollback: 5000,
        convertEol: false
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(container)
      cleanups.push(() => term.dispose())

      // Subscribe before reading the buffer so no output is lost; hold live data until the buffer is written.
      let ready = false
      // Each push carries `end`, its offset after the chunk; drop or trim whatever the buffer already contains.
      let bufferEnd = 0
      const pending: Array<{ data: string; end: number }> = []
      const writeChunk = (data: string, end: number): void => {
        if (end <= bufferEnd) return
        const start = end - data.length
        term.write(start < bufferEnd ? data.slice(bufferEnd - start) : data)
        bufferEnd = end
      }
      cleanups.push(
        pty.onData((e) => {
          if (e.ptyId !== ptyId) return
          if (ready) writeChunk(e.data, e.end)
          else pending.push({ data: e.data, end: e.end })
        })
      )
      cleanups.push(
        pty.onExit((e) => {
          if (e.ptyId !== ptyId) return
          term.write(`\r\n[process exited with code ${e.exitCode}]\r\n`)
          container.setAttribute('data-exited', 'true')
        })
      )
      if (interactive) {
        const sub = term.onData((d) => void pty.write(ptyId, d))
        cleanups.push(() => sub?.dispose?.())
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      const doFit = (): void => {
        try {
          fit.fit()
          void pty.resize(ptyId, term.cols, term.rows)
        } catch {
          // host not measurable (e.g. jsdom)
        }
      }
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(doFit, 50)
        })
        ro.observe(container)
        cleanups.push(() => {
          ro.disconnect()
          if (timer) clearTimeout(timer)
        })
      }
      doFit()

      try {
        const buf = await pty.getBuffer(ptyId)
        if (disposed) return
        if (buf?.data) term.write(buf.data)
        bufferEnd = buf?.end ?? 0
      } catch {
        // no buffer available
      }
      ready = true
      for (const c of pending) writeChunk(c.data, c.end)
      pending.length = 0
    })()

    return () => {
      disposed = true
      for (const c of cleanups.splice(0).reverse()) {
        try {
          c()
        } catch {
          // already disposed
        }
      }
    }
  }, [ptyId, interactive])

  return (
    <div
      ref={host}
      className={['ac-term', className].filter(Boolean).join(' ')}
      data-pty-id={ptyId}
      role="region"
      aria-label={ariaLabel ?? 'Terminal'}
    />
  )
}
