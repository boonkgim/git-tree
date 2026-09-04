/**
 * Lane assignment for the commit graph.
 *
 * The algorithm is the conventional one: keep a set of open lanes, each one
 * "expecting" a particular commit. When a commit arrives, it takes the lane
 * that expected it (or opens a new one), then hands that lane to its first
 * parent and places any remaining parents into found-or-new lanes.
 *
 * It runs incrementally over the log in `--date-order`, which guarantees a
 * commit is always emitted before its parents, so a lane is always claimed
 * before it is filled.
 */

export interface GraphInput {
  sha: string
  parents: string[]
  /**
   * The working-tree node rather than a real commit. It is fed through the
   * same walk so its line branches off the commit it sits on — HEAD — instead
   * of whatever happens to be at the top of the log.
   */
  synthetic?: boolean
}

/** Sha used for the synthetic working-tree node; never a real object name. */
export const WORKING_SHA = ':working:'

/** The working-tree node as a graph input, parented on HEAD. */
export function workingInput(head: string): GraphInput {
  return { sha: WORKING_SHA, parents: [head], synthetic: true }
}

/** An edge passing through a row, drawn as a vertical or diagonal line. */
export interface GraphEdge {
  /** Lane the edge occupies above this row. */
  fromLane: number
  /** Lane the edge occupies below this row. */
  toLane: number
  /** Colour index, tied to the lane the edge belongs to. */
  colour: number
  /** Drawn dashed: this stretch of lane is the working tree, not history. */
  dashed: boolean
}

export interface GraphRow {
  /** Lane the commit's dot sits in. */
  lane: number
  /** Colour index for the dot. */
  colour: number
  /** Edges crossing this row, including the ones touching the dot. */
  edges: GraphEdge[]
  /** Total lanes in use at this row, for sizing the gutter. */
  width: number
  /**
   * True when a child above already occupied this lane. A branch tip has no
   * child, so drawing a line up out of it would invent an edge.
   */
  incoming: boolean
  /** The incoming line is the working-tree connector, so it is dashed. */
  incomingDashed: boolean
  /** This row is the working-tree node, drawn hollow. */
  synthetic: boolean
}

/** Mutable state carried between incremental calls. */
export interface LaneState {
  /** For each lane index, the sha it is waiting for, or null when free. */
  lanes: (string | null)[]
  /** Colour assigned to each lane, kept stable while the lane stays open. */
  colours: number[]
  /** Next colour to hand out. */
  nextColour: number
  /**
   * Lanes whose current occupant is still the working-tree connector, i.e. the
   * stretch between the working node and the commit it is waiting for.
   */
  dashed: Set<number>
}

export function createLaneState(): LaneState {
  return { lanes: [], colours: [], nextColour: 0, dashed: new Set() }
}

function claimLane(state: LaneState, sha: string): number {
  const existing = state.lanes.indexOf(sha)
  if (existing !== -1) return existing
  const free = state.lanes.indexOf(null)
  if (free !== -1) {
    state.lanes[free] = sha
    state.colours[free] = state.nextColour++
    state.dashed.delete(free)
    return free
  }
  state.lanes.push(sha)
  state.colours.push(state.nextColour++)
  return state.lanes.length - 1
}

/** Drops trailing free lanes so the gutter does not grow forever. */
function trim(state: LaneState): void {
  while (state.lanes.length > 0 && state.lanes[state.lanes.length - 1] === null) {
    state.dashed.delete(state.lanes.length - 1)
    state.lanes.pop()
    state.colours.pop()
  }
}

/**
 * Assigns lanes to a run of commits, mutating `state` so the next chunk can
 * continue where this one stopped.
 */
export function assignLanes(commits: readonly GraphInput[], state: LaneState): GraphRow[] {
  const rows: GraphRow[] = []

  for (const commit of commits) {
    // Whether some child already reserved this lane decides if the dot has a
    // line coming into it from above.
    const incoming = state.lanes.indexOf(commit.sha) !== -1
    const lane = claimLane(state, commit.sha)
    const colour = state.colours[lane]
    // A dot lands on the lane, so the working connector stops here: the line
    // above it is still dashed, everything below is real history.
    const incomingDashed = incoming && state.dashed.delete(lane)

    // Lanes above this row, before the commit reassigns anything.
    const before = state.lanes.slice()
    const beforeColours = state.colours.slice()
    const beforeDashed = new Set(state.dashed)

    if (commit.parents.length === 0) {
      state.lanes[lane] = null
    } else {
      // The first parent inherits this lane, and with it the colour, so a
      // branch keeps one colour along its whole first-parent chain.
      const [first, ...rest] = commit.parents
      const firstExisting = state.lanes.indexOf(first)
      if (firstExisting !== -1 && firstExisting !== lane) {
        // The first parent is already expected elsewhere; this lane ends here.
        state.lanes[lane] = null
      } else {
        state.lanes[lane] = first
      }
      for (const parent of rest) claimLane(state, parent)
      // The working node marks the lanes it hands a commit to, so the stretch
      // down to that commit reads as pending rather than as history. A real
      // commit feeding the same lane clears the mark: from there down the lane
      // carries a committed branch, which is drawn solid.
      for (const parent of commit.parents) {
        const parentLane = state.lanes.indexOf(parent)
        if (parentLane === -1) continue
        if (commit.synthetic) state.dashed.add(parentLane)
        else state.dashed.delete(parentLane)
      }
    }

    trim(state)

    const edges: GraphEdge[] = []
    // Continuations: a lane that was open above and is still open below.
    for (let i = 0; i < before.length; i++) {
      const expected = before[i]
      if (expected === null || i === lane) continue
      const below = state.lanes.indexOf(expected)
      if (below !== -1)
        edges.push({
          fromLane: i,
          toLane: below,
          colour: beforeColours[i],
          dashed: beforeDashed.has(i) && state.dashed.has(below)
        })
    }
    // The commit's own outgoing edges, one per parent.
    for (const parent of commit.parents) {
      const below = state.lanes.indexOf(parent)
      if (below !== -1)
        edges.push({
          fromLane: lane,
          toLane: below,
          colour: state.colours[below],
          dashed: state.dashed.has(below)
        })
    }

    rows.push({
      lane,
      colour,
      edges,
      incoming,
      incomingDashed,
      synthetic: commit.synthetic === true,
      width: Math.max(state.lanes.length, before.length, lane + 1)
    })
  }

  return rows
}

/** Palette index -> CSS colour. Chosen to stay distinguishable side by side. */
export const LANE_COLOURS = [
  '#2f7ed8',
  '#e07a1f',
  '#3ba55d',
  '#c0392b',
  '#8e5bd0',
  '#0f9bab',
  '#c2185b',
  '#7a8b1f'
]

export function laneColour(index: number): string {
  return LANE_COLOURS[index % LANE_COLOURS.length]
}
