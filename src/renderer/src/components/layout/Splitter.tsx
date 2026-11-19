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
  /** 'left': the controlled column is left of the handle; 'right': right of it. */
  side: 'left' | 'right'
  onChange: (next: number) => void
}

export function Splitter({ label, controls, value, min, max, defaultValue, side, onChange }: SplitterProps) {
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
    start.current = { x: e.clientX, value }
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
    const dx = e.clientX - start.current.x
    onChange(start.current.value + (side === 'left' ? dx : -dx))
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
    // Moving the handle right grows a left column and shrinks a right one.
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
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
      aria-orientation="vertical"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className={`ac-splitter${dragging ? ' is-dragging' : ''}`}
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
