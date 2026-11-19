import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import './splitter.css'

interface SplitterProps {
  label: string
  controls: string
  value: number
  min: number
  max: number
  defaultValue: number
  /**
   * 'left'/'right': the controlled column is left/right of a vertical handle.
   * 'top'/'bottom': the controlled pane is above/below a horizontal handle.
   */
  side: 'left' | 'right' | 'top' | 'bottom'
  /** Defaults to 'vertical' (a column splitter); 'top'/'bottom' sides imply 'horizontal'. */
  orientation?: 'vertical' | 'horizontal'
  onChange: (next: number) => void
}

export function Splitter({
  label,
  controls,
  value,
  min,
  max,
  defaultValue,
  side,
  orientation,
  onChange
}: SplitterProps) {
  const horizontal = orientation === 'horizontal' || side === 'top' || side === 'bottom'
  // 'before': the controlled pane sits left of / above the handle.
  const before = side === 'left' || side === 'top'
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, value: 0 })
  const prevSelect = useRef('')

  const endDrag = () => {
    setDragging(false)
    document.body.style.userSelect = prevSelect.current
  }

  useEffect(
    () => () => {
      if (document.body.style.userSelect === 'none') document.body.style.userSelect = prevSelect.current
    },
    []
  )

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return
    start.current = { x: horizontal ? e.clientY : e.clientX, value }
    prevSelect.current = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* capture unsupported */
    }
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const delta = (horizontal ? e.clientY : e.clientX) - start.current.x
    onChange(start.current.value + (before ? delta : -delta))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    endDrag()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    // Moving the handle right/down grows a pane before it and shrinks one after it.
    const fwd = horizontal ? 'ArrowDown' : 'ArrowRight'
    const back = horizontal ? 'ArrowUp' : 'ArrowLeft'
    const grow = before ? fwd : back
    const shrink = before ? back : fwd
    let next: number | null = null
    if (e.key === grow) next = value + step
    else if (e.key === shrink) next = value - step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'Enter') next = defaultValue
    if (next === null) return
    e.preventDefault()
    onChange(next)
  }

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`ac-splitter${horizontal ? ' ac-splitter--h' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={() => dragging && endDrag()}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
    />
  )
}
