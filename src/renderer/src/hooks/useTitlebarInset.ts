import { useEffect } from 'react'

/** Width (CSS px) the native min/max/close overlay takes when the API is missing on Windows. */
export const WCO_FALLBACK_PX = 140
export const WCO_VAR = '--ac-wco-right'

interface WcoLike {
  visible?: boolean
  getTitlebarAreaRect?: () => { x: number; width: number }
  addEventListener?: (type: 'geometrychange', cb: () => void) => void
  removeEventListener?: (type: 'geometrychange', cb: () => void) => void
}

const wco = (): WcoLike | undefined => (navigator as unknown as { windowControlsOverlay?: WcoLike }).windowControlsOverlay

/** Space (CSS px) at the right edge of every header that the window controls cover. */
export function titlebarInset(): number {
  const o = wco()
  if (o && typeof o.getTitlebarAreaRect === 'function') {
    if (o.visible === false) return 0
    const r = o.getTitlebarAreaRect()
    if (r.width > 0) return Math.max(0, Math.round(window.innerWidth - (r.x + r.width)))
  }
  return /Windows/i.test(navigator.userAgent) ? WCO_FALLBACK_PX : 0
}

/** Writes --ac-wco-right on :root and keeps it current (geometrychange, resize). Safe to call from several headers. */
export function useTitlebarInset(): void {
  useEffect(() => {
    const root = document.documentElement
    const update = (): void => {
      const v = `${titlebarInset()}px`
      if (root.style.getPropertyValue(WCO_VAR) !== v) root.style.setProperty(WCO_VAR, v)
    }
    update()
    const o = wco()
    o?.addEventListener?.('geometrychange', update)
    window.addEventListener('resize', update)
    return () => {
      o?.removeEventListener?.('geometrychange', update)
      window.removeEventListener('resize', update)
    }
  }, [])
}
