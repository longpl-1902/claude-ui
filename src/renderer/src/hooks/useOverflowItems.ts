import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** Extra room (px) an item needs before it comes back, so items do not flicker in/out while resizing. */
export const OVERFLOW_HYSTERESIS = 24
/** Width reserved for the "..." button once anything is hidden. */
export const OVERFLOW_MORE_WIDTH = 44
/** Width of the brand once its title is dropped (icon only). */
export const BRAND_COMPACT_WIDTH = 22

export interface OverflowPlanInput {
  /** Item ids, first = first to go. */
  order: readonly string[]
  /** Natural width of each item (px); 0 / missing = not rendered. */
  widths: Readonly<Record<string, number>>
  /** Ids that shrink to this width instead of moving into the menu; the shrink takes one step of its own. */
  collapse?: Readonly<Record<string, number>>
  /** Total width of the never-moved items (at their minimum) and how many there are. */
  fixed: number
  fixedCount: number
  gap: number
  /** Content-box width of the container. */
  avail: number
  moreWidth?: number
}

/** Width the row needs when the first `k` steps are applied. */
export function neededWidth(inp: OverflowPlanInput, k: number): number {
  const collapse = inp.collapse ?? {}
  let total = inp.fixed
  let count = inp.fixedCount
  let anyHidden = false
  inp.order.forEach((id, i) => {
    const w = inp.widths[id] ?? 0
    if (w <= 0) return
    const step = i < k
    if (step && collapse[id] !== undefined) {
      total += collapse[id]
      count += 1
    } else if (step) {
      anyHidden = true
    } else {
      total += w
      count += 1
    }
  })
  if (anyHidden) {
    total += inp.moreWidth ?? OVERFLOW_MORE_WIDTH
    count += 1
  }
  return total + inp.gap * Math.max(0, count - 1)
}

/** Smallest k (0..order.length) whose layout fits `limit`; order.length when even that does not fit. */
function smallestFit(inp: OverflowPlanInput, limit: number): number {
  for (let k = 0; k <= inp.order.length; k++) if (neededWidth(inp, k) <= limit) return k
  return inp.order.length
}

/**
 * How many steps of `order` to apply. With `prevK` the result has hysteresis: it grows as soon as the row overflows,
 * but only shrinks again once the freed items fit with `hysteresis` px to spare.
 */
export function planOverflow(inp: OverflowPlanInput, prevK = 0, hysteresis = OVERFLOW_HYSTERESIS): number {
  const tight = smallestFit(inp, inp.avail)
  const loose = smallestFit(inp, inp.avail - hysteresis)
  return Math.max(tight, Math.min(prevK, loose))
}

export interface OverflowState {
  /** Steps applied (0 = everything visible). */
  k: number
  /** True when even with everything moved the row overflows: the brand drops its title. */
  compact: boolean
}

export interface UseOverflowOptions {
  order: readonly string[]
  /** Ids of items that are not rendered right now (width 0). */
  absent?: readonly string[]
  collapse?: Readonly<Record<string, number>>
  /** Used when nothing can be measured (no layout): true = move every item into the menu. */
  fallbackNarrow: boolean
}

export interface UseOverflowResult {
  containerRef: RefObject<HTMLElement>
  hidden: ReadonlySet<string>
  collapsed: ReadonlySet<string>
  compact: boolean
}

const px = (v: string | undefined): number => {
  const n = Number.parseFloat(v ?? '')
  return Number.isFinite(n) ? n : 0
}

/**
 * Measure-based overflow for a one-row header. Overflowable children carry `data-oi="<id>"`; never-moved children carry
 * `data-fixed` (optionally `data-min="<px>"` for items that shrink, `data-brand` for the brand).
 */
export function useOverflowItems(opts: UseOverflowOptions): UseOverflowResult {
  const containerRef = useRef<HTMLElement>(null)
  const widths = useRef<Record<string, number>>({})
  const brandFull = useRef(0)
  const [state, setState] = useState<OverflowState>({ k: opts.fallbackNarrow ? opts.order.length : 0, compact: false })
  const stateRef = useRef(state)
  stateRef.current = state
  const optsRef = useRef(opts)
  optsRef.current = opts

  const measure = useCallback((): void => {
    const el = containerRef.current
    if (!el) return
    const o = optsRef.current
    const prev = stateRef.current
    const apply = (next: OverflowState): void => {
      if (next.k !== prev.k || next.compact !== prev.compact) {
        stateRef.current = next
        setState(next)
      }
    }
    const cs = getComputedStyle(el)
    const avail = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
    if (el.clientWidth <= 0 || avail <= 0) {
      apply({ k: o.fallbackNarrow ? o.order.length : 0, compact: false })
      return
    }
    const gapRaw = px(cs.columnGap) || px(cs.gap)
    const gap = gapRaw > 0 ? gapRaw : 12

    el.querySelectorAll<HTMLElement>('[data-oi]').forEach((n) => {
      const w = n.offsetWidth
      if (w > 0) widths.current[n.dataset.oi ?? ''] = w
    })
    const w: Record<string, number> = { ...widths.current }
    for (const id of o.absent ?? []) w[id] = 0

    let fixed = 0
    let fixedCount = 0
    el.querySelectorAll<HTMLElement>('[data-fixed]').forEach((n) => {
      const min = n.dataset.min !== undefined ? px(n.dataset.min) : 0
      let width = min > 0 ? min : n.offsetWidth
      if (n.dataset.brand !== undefined) {
        if (!prev.compact && n.offsetWidth > 0) brandFull.current = n.offsetWidth
        width = prev.compact ? BRAND_COMPACT_WIDTH : n.offsetWidth
      }
      fixed += width
      fixedCount += 1
    })

    const base: OverflowPlanInput = {
      order: o.order,
      widths: w,
      ...(o.collapse ? { collapse: o.collapse } : {}),
      fixed,
      fixedCount,
      gap,
      avail
    }
    // Full-width brand: what the row needs if the brand shows its title.
    const brandDelta = prev.compact && brandFull.current > 0 ? brandFull.current - BRAND_COMPACT_WIDTH : 0
    const full: OverflowPlanInput = { ...base, fixed: fixed + brandDelta }
    const slack = prev.compact ? OVERFLOW_HYSTERESIS : 0
    const max = o.order.length
    const needCompact = neededWidth(full, max) > avail - slack
    const input = needCompact ? { ...base, fixed: fixed - (prev.compact ? 0 : Math.max(0, brandFull.current - BRAND_COMPACT_WIDTH)) } : full
    apply({ k: planOverflow(input, prev.k), compact: needCompact })
  }, [])

  // Every commit: item labels / counts change widths without the container resizing.
  useLayoutEffect(() => {
    measure()
  })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    void document.fonts?.ready?.then(() => measure())
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const hidden = new Set<string>()
  const collapsed = new Set<string>()
  opts.order.forEach((id, i) => {
    if (i >= state.k) return
    if (opts.collapse?.[id] !== undefined) collapsed.add(id)
    else hidden.add(id)
  })
  return { containerRef, hidden, collapsed, compact: state.compact }
}
