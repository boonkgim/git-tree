import { describe, expect, it } from 'vitest'
import {
  assignLanes,
  createLaneState,
  laneColour,
  workingInput,
  type GraphInput
} from '../src/shared/graph'

/** Rows in `--date-order`: a commit always appears before its parents. */
function lanes(commits: GraphInput[]): number[] {
  return assignLanes(commits, createLaneState()).map((r) => r.lane)
}

describe('assignLanes', () => {
  it('keeps a linear history in one lane', () => {
    expect(
      lanes([
        { sha: 'c', parents: ['b'] },
        { sha: 'b', parents: ['a'] },
        { sha: 'a', parents: [] }
      ])
    ).toEqual([0, 0, 0])
  })

  it('gives a second tip its own lane', () => {
    //  tip1   tip2
    //     \   /
    //      base
    const rows = assignLanes(
      [
        { sha: 'tip1', parents: ['base'] },
        { sha: 'tip2', parents: ['base'] },
        { sha: 'base', parents: [] }
      ],
      createLaneState()
    )
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0])
    // The second tip has no child above it, so nothing should be drawn upward.
    expect(rows[1].incoming).toBe(false)
    expect(rows[0].incoming).toBe(false)
  })

  it('opens a lane for a merge commit`s second parent', () => {
    const rows = assignLanes(
      [
        { sha: 'merge', parents: ['main', 'side'] },
        { sha: 'main', parents: ['base'] },
        { sha: 'side', parents: ['base'] },
        { sha: 'base', parents: [] }
      ],
      createLaneState()
    )
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0])
    // The merge row emits one edge per parent.
    expect(rows[0].edges).toHaveLength(2)
    expect(rows[1].incoming).toBe(true)
    expect(rows[2].incoming).toBe(true)
  })

  it('handles an octopus merge', () => {
    const rows = assignLanes(
      [
        { sha: 'octo', parents: ['p1', 'p2', 'p3'] },
        { sha: 'p1', parents: [] },
        { sha: 'p2', parents: [] },
        { sha: 'p3', parents: [] }
      ],
      createLaneState()
    )
    expect(rows[0].edges).toHaveLength(3)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 2])
  })

  it('frees a lane once its branch reaches a root', () => {
    const rows = assignLanes(
      [
        { sha: 'tip', parents: ['root'] },
        { sha: 'other', parents: [] },
        { sha: 'root', parents: [] }
      ],
      createLaneState()
    )
    // `other` is a separate root, so it takes lane 1 and releases it at once.
    expect(rows[1].lane).toBe(1)
    expect(rows[2].lane).toBe(0)
  })

  it('continues across incremental calls exactly as it would in one pass', () => {
    const commits: GraphInput[] = [
      { sha: 'merge', parents: ['main', 'side'] },
      { sha: 'main', parents: ['base'] },
      { sha: 'side', parents: ['base'] },
      { sha: 'base', parents: ['root'] },
      { sha: 'root', parents: [] }
    ]
    const whole = assignLanes(commits, createLaneState())

    const state = createLaneState()
    const piecewise = [
      ...assignLanes(commits.slice(0, 2), state),
      ...assignLanes(commits.slice(2), state)
    ]
    expect(piecewise).toEqual(whole)
  })

  it('reports a width wide enough for every lane it used', () => {
    const rows = assignLanes(
      [
        { sha: 'a', parents: ['x'] },
        { sha: 'b', parents: ['y'] },
        { sha: 'c', parents: ['z'] }
      ],
      createLaneState()
    )
    expect(rows[2].width).toBeGreaterThanOrEqual(3)
  })

  it('produces no rows for an empty history', () => {
    expect(assignLanes([], createLaneState())).toEqual([])
  })
})

describe('the working-tree node', () => {
  it('branches off HEAD rather than off the newest commit', () => {
    //  working        feature
    //        \        /
    //         head (checked out, but not the top of --date-order)
    const rows = assignLanes(
      [
        workingInput('head'),
        { sha: 'feature', parents: ['base'] },
        { sha: 'head', parents: ['base'] },
        { sha: 'base', parents: [] }
      ],
      createLaneState()
    )
    const [working, feature, head] = rows
    expect(working.synthetic).toBe(true)
    // The working node holds a lane of its own down to HEAD; the unrelated tip
    // above HEAD is pushed aside instead of being joined to.
    expect(feature.lane).not.toBe(working.lane)
    expect(head.lane).toBe(working.lane)
    expect(head.incoming).toBe(true)
    expect(head.incomingDashed).toBe(true)
  })

  it('draws the whole stretch down to HEAD dashed, and nothing below it', () => {
    const rows = assignLanes(
      [
        workingInput('head'),
        { sha: 'feature', parents: ['base'] },
        { sha: 'head', parents: ['base'] },
        { sha: 'base', parents: [] }
      ],
      createLaneState()
    )
    const [working, feature, head] = rows
    // The working node's edge, and its continuation past the unrelated tip.
    expect(working.edges.every((e) => e.dashed)).toBe(true)
    expect(feature.edges.filter((e) => e.dashed)).toHaveLength(1)
    // Below HEAD the lane carries real history again.
    expect(head.edges.some((e) => e.dashed)).toBe(false)
  })

  it('keeps a real branch built on HEAD solid', () => {
    //  working   tip
    //        \   |
    //         head
    const rows = assignLanes(
      [
        workingInput('head'),
        { sha: 'tip', parents: ['head'] },
        { sha: 'head', parents: [] }
      ],
      createLaneState()
    )
    const [, tip, head] = rows
    // `tip` commits into the same lane, so from there down it is history.
    expect(tip.edges.every((e) => !e.dashed)).toBe(true)
    expect(head.incoming).toBe(true)
    expect(head.incomingDashed).toBe(false)
  })

  it('marks only the working node as synthetic', () => {
    const rows = assignLanes(
      [workingInput('head'), { sha: 'head', parents: [] }],
      createLaneState()
    )
    expect(rows.map((r) => r.synthetic)).toEqual([true, false])
  })
})

describe('laneColour', () => {
  it('wraps around the palette rather than running out', () => {
    expect(laneColour(0)).toBe(laneColour(8))
    expect(laneColour(3)).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
