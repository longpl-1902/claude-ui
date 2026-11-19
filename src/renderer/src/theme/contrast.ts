/** WCAG 2.x contrast helpers (used for the accent check and by the token contrast test). */

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex(rgb: readonly [number, number, number]): string {
  return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Blend `hex` toward `target` by `amount` (0..1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = parseHex(hex)
  const b = parseHex(target)
  if (!a || !b) return hex
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as [number, number, number])
}
