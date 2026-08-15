import { useCallback, useRef } from 'react'

interface Props {
  orientation: 'horizontal' | 'vertical'
  /** Current size of the panel being resized, in px. */
  value: number
  onChange: (value: number) => void
  /** Called once when the drag ends, for persistence. */
  onCommit?: (value: number) => void
  min: number
  max: number
  /** Set when dragging down/right should *decrease* the value. */
  invert?: boolean
}

/**
 * A draggable divider. `horizontal` means the divider itself is a horizontal
 * bar, so dragging it changes a height.
 */
export function Splitter({
  orientation,
  value,
  onChange,
  onCommit,
  min,
  max,
  invert = false
}: Props): JSX.Element {
  const state = useRef({ value, min, max, invert })
  state.current = { value, min, max, invert }

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const start = orientation === 'horizontal' ? event.clientY : event.clientX
      const startValue = state.current.value
      const target = event.currentTarget
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Capture is an optimisation, not a requirement: the move and up
        // listeners below are on `window`, so the drag works without it.
      }

      // The drag's own running total. Reading the rendered value here would be
      // wrong: React can batch the last move and the release into one update,
      // so at pointerup the rendered value may still be one move behind.
      let latest = startValue

      const move = (e: PointerEvent): void => {
        const current = orientation === 'horizontal' ? e.clientY : e.clientX
        const delta = (current - start) * (state.current.invert ? -1 : 1)
        latest = Math.min(
          Math.max(startValue + delta, state.current.min),
          Math.max(state.current.min, state.current.max)
        )
        onChange(latest)
      }
      const up = (): void => {
        try {
          target.releasePointerCapture?.(event.pointerId)
        } catch {
          /* nothing was captured */
        }
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        onCommit?.(latest)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [orientation, onChange, onCommit]
  )

  // Keyboard resizing, so the layout is not mouse-only.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 8
      const keys =
        orientation === 'horizontal' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
      if (!keys.includes(event.key)) return
      event.preventDefault()
      const direction = event.key === keys[0] ? -1 : 1
      const next = Math.min(Math.max(value + direction * step * (invert ? -1 : 1), min), max)
      onChange(next)
      onCommit?.(next)
    },
    [orientation, value, min, max, invert, onChange, onCommit]
  )

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      tabIndex={0}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
