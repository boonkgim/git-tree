import { useRef } from 'react'
import type { CommitSummary } from '@shared/types'
import { assignLanes, createLaneState, laneColour, type GraphRow, type LaneState } from '@shared/graph'

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
 */
export function useGraphRows(commits: CommitSummary[], epoch: number): GraphRow[] {
  const cache = useRef<{ epoch: number; state: LaneState; rows: GraphRow[] }>({
    epoch: -1,
    state: createLaneState(),
    rows: []
  })

  if (cache.current.epoch !== epoch) {
    cache.current = { epoch, state: createLaneState(), rows: [] }
  }
  if (cache.current.rows.length < commits.length) {
    const tail = commits.slice(cache.current.rows.length)
    cache.current.rows = cache.current.rows.concat(assignLanes(tail, cache.current.state))
  }
  return cache.current.rows
}

interface CellProps {
  row: GraphRow | null
  height: number
  width: number
  /** The synthetic working-tree node, drawn hollow and joined to HEAD below. */
  working?: boolean
  /** Lane the row below sits in, used to join the working node to HEAD. */
  workingLane?: number
  selected: boolean
}

/**
 * One row of the graph.
 *
 * Drawing per row rather than as one tall SVG is what makes the graph
 * compatible with windowing: rows can be mounted and unmounted freely because
 * nothing spans them.
 */
export function GraphCell({
  row,
  height,
  width,
  working,
  workingLane = 0,
  selected
}: CellProps): JSX.Element {
  const mid = height / 2

  if (working) {
    const x = laneX(workingLane)
    return (
      <svg className="graph-cell" width={width} height={height} aria-hidden="true">
        <line
          x1={x}
          y1={mid}
          x2={x}
          y2={height}
          stroke={laneColour(0)}
          strokeWidth={1.6}
          strokeDasharray="3 2"
        />
        <circle
          cx={x}
          cy={mid}
          r={4}
          fill={selected ? '#ffffff' : 'var(--panel)'}
          stroke={laneColour(0)}
          strokeWidth={1.8}
          strokeDasharray="2.5 1.8"
        />
      </svg>
    )
  }

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
        return <path key={i} d={d} fill="none" stroke={colour} strokeWidth={1.6} />
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
        />
      )}
      <circle
        cx={laneX(row.lane)}
        cy={mid}
        r={4}
        fill={laneColour(row.colour)}
        stroke={selected ? '#ffffff' : 'var(--panel)'}
        strokeWidth={1.4}
      />
    </svg>
  )
}
