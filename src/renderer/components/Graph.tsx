import { useRef } from 'react'
import type { CommitSummary } from '@shared/types'
import {
  assignLanes,
  createLaneState,
  laneColour,
  workingInput,
  type GraphInput,
  type GraphRow,
  type LaneState
} from '@shared/graph'

/** Horizontal spacing between lanes, and the left inset of lane 0. */
const LANE_WIDTH = 14
const LANE_INSET = 11
/** Beyond this the gutter would crowd out the commit description. */
const MAX_LANES = 12

export function laneX(lane: number): number {
  return LANE_INSET + Math.min(lane, MAX_LANES - 1) * LANE_WIDTH
}

export function gutterWidth(maxLanes: number): number {
  return LANE_INSET + Math.min(Math.max(maxLanes, 1), MAX_LANES) * LANE_WIDTH
}

/**
 * Lane assignment for the loaded history, extended incrementally.
 *
 * Lanes depend on every commit above them, so recomputing the whole list each
 * time a page arrives would be quadratic. Instead the walk state is carried in
 * a ref and only the newly-arrived tail is processed.
 *
 * When the working tree is dirty its node leads the walk as a synthetic commit
 * parented on HEAD, which is what makes it branch off the checked-out commit
 * rather than off whatever tip happens to sit at the top of `--date-order`.
 * The returned rows line up with the history rows, working node included.
 */
export function useGraphRows(
  commits: CommitSummary[],
  epoch: number,
  workingHead: string | null
): GraphRow[] {
  const cache = useRef<{
    epoch: number
    workingHead: string | null
    state: LaneState
    rows: GraphRow[]
  }>({ epoch: -1, workingHead: null, state: createLaneState(), rows: [] })

  // The working node changes where every lane below it sits, so a new HEAD (or
  // the tree going clean) restarts the walk rather than extending it.
  if (cache.current.epoch !== epoch || cache.current.workingHead !== workingHead) {
    cache.current = { epoch, workingHead, state: createLaneState(), rows: [] }
    if (workingHead) {
      cache.current.rows = assignLanes([workingInput(workingHead)], cache.current.state)
    }
  }
  const offset = workingHead ? 1 : 0
  if (cache.current.rows.length < commits.length + offset) {
    const tail: GraphInput[] = commits.slice(cache.current.rows.length - offset)
    cache.current.rows = cache.current.rows.concat(assignLanes(tail, cache.current.state))
  }
  return cache.current.rows
}

interface CellProps {
  row: GraphRow | null
  height: number
  width: number
  selected: boolean
}

/**
 * One row of the graph.
 *
 * Drawing per row rather than as one tall SVG is what makes the graph
 * compatible with windowing: rows can be mounted and unmounted freely because
 * nothing spans them.
 */
export function GraphCell({ row, height, width, selected }: CellProps): JSX.Element {
  const mid = height / 2

  if (!row) return <svg className="graph-cell" width={width} height={height} aria-hidden="true" />

  return (
    <svg className="graph-cell" width={width} height={height} aria-hidden="true">
      {row.edges.map((edge, i) => {
        const x1 = laneX(edge.fromLane)
        const x2 = laneX(edge.toLane)
        const colour = laneColour(edge.colour)
        // An edge that starts at the dot begins at mid-height; a pass-through
        // edge spans the full row.
        const y1 = edge.fromLane === row.lane ? mid : 0
        const d =
          x1 === x2
            ? `M ${x1} ${y1} L ${x2} ${height}`
            : `M ${x1} ${y1} C ${x1} ${(y1 + height) / 2}, ${x2} ${(y1 + height) / 2}, ${x2} ${height}`
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={colour}
            strokeWidth={1.6}
            strokeDasharray={edge.dashed ? '3 2' : undefined}
          />
        )
      })}
      {/* Only drawn when a child above actually occupies this lane. */}
      {row.incoming && (
        <line
          x1={laneX(row.lane)}
          y1={0}
          x2={laneX(row.lane)}
          y2={mid}
          stroke={laneColour(row.colour)}
          strokeWidth={1.6}
          strokeDasharray={row.incomingDashed ? '3 2' : undefined}
        />
      )}
      {/* The working node is hollow, so it reads as not yet committed. */}
      <circle
        cx={laneX(row.lane)}
        cy={mid}
        r={4}
        fill={row.synthetic ? (selected ? '#ffffff' : 'var(--panel)') : laneColour(row.colour)}
        stroke={row.synthetic ? laneColour(row.colour) : selected ? '#ffffff' : 'var(--panel)'}
        strokeWidth={row.synthetic ? 1.8 : 1.4}
        strokeDasharray={row.synthetic ? '2.5 1.8' : undefined}
      />
    </svg>
  )
}
