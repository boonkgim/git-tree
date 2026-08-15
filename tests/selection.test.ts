import { describe, expect, it } from 'vitest'
import {
  buildDiffArgs,
  describeSpec,
  resolveSelection,
  type RepoFacts
} from '../src/main/git/selection'
import { applyClick, selectedNodes, selectionsEqual } from '../src/shared/selection'
import { DEFAULT_DIFF_OPTIONS, type HistoryNode, type Selection } from '../src/shared/types'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * A small synthetic history:
 *
 *   root -- a -- b -- merge      (merge's parents are b and side)
 *            \-- side ----/
 *
 * plus `alien`, which shares no ancestry with anything.
 */
const PARENTS: Record<string, string[]> = {
  root: [],
  a: ['root'],
  b: ['a'],
  side: ['a'],
  merge: ['b', 'side'],
  alien: []
}

const DATES: Record<string, string> = {
  root: '2024-01-01T00:00:00Z',
  a: '2024-01-02T00:00:00Z',
  b: '2024-01-03T00:00:00Z',
  side: '2024-01-04T00:00:00Z',
  merge: '2024-01-05T00:00:00Z',
  alien: '2024-01-06T00:00:00Z'
}

/** Ancestry by walking the synthetic parent table. */
function ancestorOf(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  const stack = [...(PARENTS[descendant] ?? [])]
  const seen = new Set<string>()
  while (stack.length) {
    const sha = stack.pop() as string
    if (sha === ancestor) return true
    if (seen.has(sha)) continue
    seen.add(sha)
    stack.push(...(PARENTS[sha] ?? []))
  }
  return false
}

function facts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    head: 'merge',
    emptyTree: EMPTY_TREE,
    parentsOf: (sha) => PARENTS[sha] ?? [],
    dateOf: (sha) => DATES[sha],
    isAncestor: ancestorOf,
    haveCommonAncestor: (x, y) =>
      ['root', 'a', 'b', 'side', 'merge'].includes(x) && ['root', 'a', 'b', 'side', 'merge'].includes(y),
    workingDirty: true,
    ...overrides
  }
}

const commit = (sha: string): HistoryNode => ({ kind: 'commit', sha })
const working: HistoryNode = { kind: 'working' }

describe('resolveSelection — a single item', () => {
  it('diffs a commit against its parent', () => {
    expect(resolveSelection({ anchor: commit('b') }, facts())).toEqual({
      mode: 'commit',
      base: 'a',
      target: 'b',
      parentIndex: 0,
      parents: ['a']
    })
  })

  it('diffs the root commit against the empty tree, since it has no parent', () => {
    expect(resolveSelection({ anchor: commit('root') }, facts())).toEqual({
      mode: 'root',
      base: EMPTY_TREE,
      target: 'root'
    })
  })

  it('defaults a merge commit to its first parent', () => {
    expect(resolveSelection({ anchor: commit('merge') }, facts())).toMatchObject({
      mode: 'commit',
      base: 'b',
      parentIndex: 0,
      parents: ['b', 'side']
    })
  })

  it('follows the requested parent of a merge commit', () => {
    expect(resolveSelection({ anchor: commit('merge') }, facts(), 1)).toMatchObject({
      base: 'side',
      parentIndex: 1
    })
  })

  it('clamps an out-of-range parent index rather than producing a bad revision', () => {
    expect(resolveSelection({ anchor: commit('merge') }, facts(), 9)).toMatchObject({
      base: 'side',
      parentIndex: 1
    })
    expect(resolveSelection({ anchor: commit('b') }, facts(), 5)).toMatchObject({
      base: 'a',
      parentIndex: 0
    })
  })

  it('diffs the working tree against HEAD, staged and unstaged together', () => {
    expect(resolveSelection({ anchor: working }, facts())).toEqual({
      mode: 'working',
      base: 'merge',
      baseIsHead: true
    })
  })

  it('says so plainly when the working tree is clean', () => {
    const spec = resolveSelection({ anchor: working }, facts({ workingDirty: false }))
    expect(spec.mode).toBe('empty')
    expect(spec).toMatchObject({ reason: expect.stringContaining('clean') })
  })

  it('compares against the empty tree in a repository with no commits', () => {
    expect(resolveSelection({ anchor: working }, facts({ head: null }))).toEqual({
      mode: 'working',
      base: EMPTY_TREE,
      baseIsHead: true
    })
  })
})

describe('resolveSelection — two items', () => {
  it('puts the ancestor on the "before" side', () => {
    expect(resolveSelection({ anchor: commit('a'), other: commit('b') }, facts())).toEqual({
      mode: 'range',
      base: 'a',
      target: 'b',
      relation: 'ancestor'
    })
  })

  it('gives the same answer whichever order the two were picked in', () => {
    const forwards = resolveSelection({ anchor: commit('a'), other: commit('merge') }, facts())
    const backwards = resolveSelection({ anchor: commit('merge'), other: commit('a') }, facts())
    expect(forwards).toEqual(backwards)
    expect(forwards).toMatchObject({ base: 'a', target: 'merge' })
  })

  it('orders diverged branches by date and says they diverged', () => {
    const forwards = resolveSelection({ anchor: commit('b'), other: commit('side') }, facts())
    const backwards = resolveSelection({ anchor: commit('side'), other: commit('b') }, facts())
    expect(forwards).toEqual(backwards)
    expect(forwards).toEqual({ mode: 'range', base: 'b', target: 'side', relation: 'divergent' })
  })

  it('still compares commits with no common ancestor, and labels them unrelated', () => {
    const spec = resolveSelection({ anchor: commit('alien'), other: commit('b') }, facts())
    expect(spec).toMatchObject({ mode: 'range', relation: 'unrelated' })
    expect(resolveSelection({ anchor: commit('b'), other: commit('alien') }, facts())).toEqual(spec)
  })

  it('breaks a date tie deterministically, in both orders', () => {
    const tied = facts({ dateOf: () => '2024-01-01T00:00:00Z' })
    const forwards = resolveSelection({ anchor: commit('b'), other: commit('side') }, tied)
    const backwards = resolveSelection({ anchor: commit('side'), other: commit('b') }, tied)
    expect(forwards).toEqual(backwards)
  })

  it('treats the working tree as the newer side of any pair', () => {
    expect(resolveSelection({ anchor: working, other: commit('a') }, facts())).toEqual({
      mode: 'working',
      base: 'a',
      baseIsHead: false
    })
    expect(resolveSelection({ anchor: commit('a'), other: working }, facts())).toEqual({
      mode: 'working',
      base: 'a',
      baseIsHead: false
    })
  })

  it('marks the base as HEAD when the working tree is paired with HEAD itself', () => {
    expect(resolveSelection({ anchor: working, other: commit('merge') }, facts())).toMatchObject({
      baseIsHead: true
    })
  })

  it('collapses a pair that names the same commit twice', () => {
    expect(resolveSelection({ anchor: commit('b'), other: commit('b') }, facts())).toMatchObject({
      mode: 'commit',
      base: 'a',
      target: 'b'
    })
  })
})

describe('selectedNodes', () => {
  it('de-duplicates a selection naming the same node twice', () => {
    expect(selectedNodes({ anchor: working, other: working })).toHaveLength(1)
    expect(selectedNodes({ anchor: commit('a'), other: commit('a') })).toHaveLength(1)
    expect(selectedNodes({ anchor: commit('a'), other: commit('b') })).toHaveLength(2)
  })
})

describe('buildDiffArgs', () => {
  const options = DEFAULT_DIFF_OPTIONS

  it('passes two endpoints for a commit comparison', () => {
    const spec = resolveSelection({ anchor: commit('b') }, facts())
    expect(buildDiffArgs(spec, 'name-status', options)).toEqual([
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      '-C',
      '--name-status',
      '-z',
      'a',
      'b',
      '--'
    ])
  })

  it('passes a single endpoint for the working tree, which is how git means "vs the working tree"', () => {
    const spec = resolveSelection({ anchor: working }, facts())
    const args = buildDiffArgs(spec, 'name-status', options)
    expect(args.slice(args.indexOf('-z') + 1)).toEqual(['merge', '--'])
  })

  it('asks for the requested amount of context', () => {
    const spec = resolveSelection({ anchor: commit('b') }, facts())
    expect(buildDiffArgs(spec, 'patch', { ...options, context: 25 })).toContain('-U25')
    expect(buildDiffArgs(spec, 'patch', { ...options, context: 'all' })).toContain('-U1000000')
  })

  it('adds the whitespace flag only when asked', () => {
    const spec = resolveSelection({ anchor: commit('b') }, facts())
    expect(buildDiffArgs(spec, 'patch', options)).not.toContain('--ignore-all-space')
    expect(buildDiffArgs(spec, 'patch', { ...options, ignoreWhitespace: true })).toContain(
      '--ignore-all-space'
    )
  })

  it('refuses to build a command for an empty comparison', () => {
    expect(() => buildDiffArgs({ mode: 'empty', reason: 'x' }, 'patch', options)).toThrow()
  })
})

describe('describeSpec — the panel must never be ambiguous', () => {
  const ctx = { short: (sha: string) => sha.slice(0, 7), headSha: 'merge' }

  it('names the parent of a merge commit', () => {
    const spec = resolveSelection({ anchor: commit('merge') }, facts(), 1)
    expect(describeSpec(spec, ctx)).toContain('parent 2 of 2')
  })

  it('calls out an initial commit', () => {
    expect(describeSpec(resolveSelection({ anchor: commit('root') }, facts()), ctx)).toMatch(
      /Initial commit/
    )
  })

  it('says the working tree includes staged and unstaged changes', () => {
    expect(describeSpec(resolveSelection({ anchor: working }, facts()), ctx)).toMatch(
      /working tree \(staged and unstaged\)/
    )
  })

  it('warns when two commits share no ancestor', () => {
    const spec = resolveSelection({ anchor: commit('alien'), other: commit('b') }, facts())
    expect(describeSpec(spec, ctx)).toMatch(/no common ancestor/)
  })
})

/* ------------------------------------------------------------------------ */

describe('click behaviour', () => {
  const a = commit('a')
  const b = commit('b')
  const c = commit('side')

  it('a plain click selects exactly one row', () => {
    expect(applyClick(null, a, false)).toEqual({ anchor: a })
    expect(applyClick({ anchor: a, other: b }, c, false)).toEqual({ anchor: c })
  })

  it('Ctrl/Cmd+Click adds a second item', () => {
    expect(applyClick({ anchor: a }, b, true)).toEqual({ anchor: a, other: b })
  })

  it('a third Ctrl/Cmd+Click keeps the anchor and moves the other end', () => {
    const two: Selection = { anchor: a, other: b }
    expect(applyClick(two, c, true)).toEqual({ anchor: a, other: c })
  })

  it('Ctrl/Cmd+Click on a selected row removes it and the survivor becomes the anchor', () => {
    expect(applyClick({ anchor: a, other: b }, a, true)).toEqual({ anchor: b })
    expect(applyClick({ anchor: a, other: b }, b, true)).toEqual({ anchor: a })
  })

  it('never empties the selection', () => {
    expect(applyClick({ anchor: a }, a, true)).toEqual({ anchor: a })
  })

  it('treats the two orders of the same pair as one selection', () => {
    expect(selectionsEqual({ anchor: a, other: b }, { anchor: a, other: b })).toBe(true)
    expect(selectionsEqual({ anchor: a, other: b }, { anchor: b, other: a })).toBe(false)
    expect(selectionsEqual({ anchor: a }, { anchor: a, other: b })).toBe(false)
  })

  it('treats the working row like any other row', () => {
    expect(applyClick({ anchor: working }, a, true)).toEqual({ anchor: working, other: a })
    expect(applyClick({ anchor: a, other: working }, working, true)).toEqual({ anchor: a })
  })
})
