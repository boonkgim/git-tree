import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  count: number
  rowHeight: number
  /** Rendered for each visible index. */
  children: (index: number) => ReactNode
  /** Extra rows rendered above and below the viewport. */
  overscan?: number
  /** Called with the last visible index, for incremental loading. */
  onReachEnd?: (lastVisible: number) => void
  /** Scrolls this index into view when it changes. */
  scrollToIndex?: number | null
  className?: string
  /** Rendered instead of rows when `count` is zero. */
  empty?: ReactNode
}

/**
 * A fixed-row-height windowing list.
 *
 * Only the visible rows exist in the DOM, which is what lets a 200,000-commit
 * history and a 50,000-line diff scroll at the same speed as a short one. Fixed
 * heights are the reason it can stay this small: no measurement, no cache, no
 * layout thrash.
 */
export function VirtualList({
  count,
  rowHeight,
  children,
  overscan = 12,
  onReachEnd,
  scrollToIndex,
  className,
  empty
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visible = Math.ceil((viewport || 400) / rowHeight) + overscan * 2
  const end = Math.min(count, start + visible)

  useEffect(() => {
    if (onReachEnd && count > 0) onReachEnd(end)
  }, [end, count, onReachEnd])

  useEffect(() => {
    const element = ref.current
    if (!element || scrollToIndex == null || scrollToIndex < 0) return
    const top = scrollToIndex * rowHeight
    const bottom = top + rowHeight
    if (top < element.scrollTop) element.scrollTop = top
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight
    }
  }, [scrollToIndex, rowHeight])

  const rows: ReactNode[] = []
  for (let i = start; i < end; i++) rows.push(children(i))

  return (
    <div ref={ref} className={`vlist ${className ?? ''}`} onScroll={onScroll}>
      {count === 0 && empty ? (
        <div className="vlist-empty">{empty}</div>
      ) : (
        <div className="vlist-spacer" style={{ height: count * rowHeight }}>
          <div className="vlist-window" style={{ transform: `translateY(${start * rowHeight}px)` }}>
            {rows}
          </div>
        </div>
      )}
    </div>
  )
}
