import { sameNode, selectedNodes } from '@shared/selection'
import type { DiffOptions, DiffSpec, Selection } from '@shared/types'

/**
 * Everything `resolveSelection` needs to know about the repository, gathered by
 * the caller so that the decision itself stays a pure, testable function.
 */
export interface RepoFacts {
  /** Resolved HEAD sha, or null in a repository with no commits yet. */
  head: string | null
  /** The repository's empty tree object id (hash-algorithm dependent). */
  emptyTree: string
  /** Parents of a commit, from the history buffer. Empty for a root commit. */
  parentsOf(sha: string): string[]
  /** Committer date (ISO 8601), used only to order commits that are unrelated. */
  dateOf(sha: string): string | undefined
  /** `git merge-base --is-ancestor a b`. */
  isAncestor(a: string, b: string): boolean
  /** Whether `git merge-base a b` found anything. */
  haveCommonAncestor(a: string, b: string): boolean
  /** Whether there is anything uncommitted to show. */
  workingDirty: boolean
}

/** Which parent of a merge commit to diff against. Ignored for other commits. */
export type ParentIndex = number

/**
 * Maps a selection to the comparison it stands for.
 *
 * Order-insensitivity is a property of this function, not of the UI: the result
 * depends only on the *set* of selected nodes plus repository facts, so
 * selecting A then B and B then A produce an identical `DiffSpec`.
 *
 * The working tree, when selected, is always the "after" side — it is the state
 * that exists now, so treating it as newer than any commit is the only reading
 * that stays consistent when it is paired with an old commit.
 */
export function resolveSelection(
  selection: Selection,
  facts: RepoFacts,
  parentIndex: ParentIndex = 0
): DiffSpec {
  const nodes = selectedNodes(selection)

  if (nodes.length === 1) {
    const node = nodes[0]

    if (node.kind === 'working') {
      if (facts.head === null) {
        // Unborn HEAD: everything that exists is, by definition, new.
        return { mode: 'working', base: facts.emptyTree, baseIsHead: true }
      }
      if (!facts.workingDirty) {
        return { mode: 'empty', reason: 'The working tree is clean — nothing is uncommitted.' }
      }
      return { mode: 'working', base: facts.head, baseIsHead: true }
    }

    const parents = facts.parentsOf(node.sha)
    if (parents.length === 0) {
      return { mode: 'root', base: facts.emptyTree, target: node.sha }
    }
    const index = Math.min(Math.max(parentIndex, 0), parents.length - 1)
    return {
      mode: 'commit',
      base: parents[index],
      target: node.sha,
      parentIndex: index,
      parents
    }
  }

  const [a, b] = nodes

  // Working tree paired with a commit: the commit is always the "before" side.
  if (a.kind === 'working' || b.kind === 'working') {
    const commit = a.kind === 'working' ? b : a
    if (commit.kind === 'working') {
      // Both halves are the working tree; degenerate, treat as the single case.
      return resolveSelection({ anchor: a }, facts, parentIndex)
    }
    return { mode: 'working', base: commit.sha, baseIsHead: commit.sha === facts.head }
  }

  if (a.sha === b.sha) return resolveSelection({ anchor: a }, facts, parentIndex)

  // Topology first: if one is an ancestor of the other, that one is "before".
  if (facts.isAncestor(a.sha, b.sha)) {
    return { mode: 'range', base: a.sha, target: b.sha, relation: 'ancestor' }
  }
  if (facts.isAncestor(b.sha, a.sha)) {
    return { mode: 'range', base: b.sha, target: a.sha, relation: 'ancestor' }
  }

  // Neither reaches the other. Fall back to date, with a sha tie-break so the
  // answer is deterministic even for commits sharing a timestamp.
  const relation = facts.haveCommonAncestor(a.sha, b.sha) ? 'divergent' : 'unrelated'
  const dateA = facts.dateOf(a.sha) ?? ''
  const dateB = facts.dateOf(b.sha) ?? ''
  const aIsOlder = dateA === dateB ? a.sha < b.sha : dateA < dateB
  return aIsOlder
    ? { mode: 'range', base: a.sha, target: b.sha, relation }
    : { mode: 'range', base: b.sha, target: a.sha, relation }
}

export { sameNode, selectedNodes }

/* ------------------------------------------------------------- command build */

export type DiffFormat = 'name-status' | 'numstat' | 'patch'

/** A very large context count; git has no "infinite" spelling for -U. */
const WHOLE_FILE_CONTEXT = 1_000_000

/**
 * Turns a resolved comparison into a `git diff` argument array.
 *
 * The endpoint shape is the whole point: `working` mode passes a *single*
 * tree-ish, which is how git spells "compare this commit against the working
 * tree, staged and unstaged alike". Every other mode passes two.
 */
export function buildDiffArgs(
  spec: DiffSpec,
  format: DiffFormat,
  options: DiffOptions,
  paths: string[] = []
): string[] {
  if (spec.mode === 'empty') {
    throw new Error('buildDiffArgs called for an empty comparison')
  }

  const args = ['diff', '--no-ext-diff', '--no-textconv', '-M', '-C']

  if (options.ignoreWhitespace) args.push('--ignore-all-space')

  switch (format) {
    case 'name-status':
      args.push('--name-status', '-z')
      break
    case 'numstat':
      args.push('--numstat', '-z')
      break
    case 'patch':
      args.push(
        '--patch',
        `-U${options.context === 'all' ? WHOLE_FILE_CONTEXT : Math.max(0, options.context)}`
      )
      break
  }

  args.push(...diffEndpoints(spec))

  // `--` always, so a path that looks like a revision or an option is data.
  args.push('--', ...paths)
  return args
}

/** The revision arguments for a spec: one for the working tree, two otherwise. */
export function diffEndpoints(spec: DiffSpec): string[] {
  switch (spec.mode) {
    case 'working':
      return [spec.base]
    case 'commit':
    case 'root':
    case 'range':
      return [spec.base, spec.target]
    case 'empty':
      return []
  }
}

/**
 * Arguments for the patch of an untracked file, which by definition is in no
 * tree that `git diff` can name. `--no-index` compares two paths on disk and
 * exits 1 when they differ, which callers must accept as success.
 */
export function buildUntrackedPatchArgs(path: string, options: DiffOptions): string[] {
  const args = ['diff', '--no-index', '--no-ext-diff', '--no-textconv']
  if (options.ignoreWhitespace) args.push('--ignore-all-space')
  args.push(
    '--patch',
    `-U${options.context === 'all' ? WHOLE_FILE_CONTEXT : Math.max(0, options.context)}`,
    '--',
    '/dev/null',
    path
  )
  return args
}

/* ------------------------------------------------------------------- labels */

export interface LabelContext {
  /** Short sha renderer, so labels stay readable. */
  short(sha: string): string
  headSha: string | null
}

/**
 * A one-line statement of exactly what is being compared. The diff panel shows
 * this verbatim, so it must never be vague about which side is which.
 */
export function describeSpec(spec: DiffSpec, ctx: LabelContext): string {
  switch (spec.mode) {
    case 'empty':
      return spec.reason
    case 'root':
      return `Initial commit ${ctx.short(spec.target)} — every file added`
    case 'commit': {
      const parentLabel =
        spec.parents.length > 1
          ? `parent ${spec.parentIndex + 1} of ${spec.parents.length} (${ctx.short(spec.base)})`
          : ctx.short(spec.base)
      return `${parentLabel} → ${ctx.short(spec.target)}`
    }
    case 'working': {
      const base = spec.baseIsHead
        ? ctx.headSha
          ? `HEAD (${ctx.short(spec.base)})`
          : 'an empty repository'
        : ctx.short(spec.base)
      return `${base} → working tree (staged and unstaged)`
    }
    case 'range': {
      const suffix =
        spec.relation === 'unrelated'
          ? ' — no common ancestor, direct tree comparison'
          : spec.relation === 'divergent'
            ? ' — diverged branches, ordered by date'
            : ''
      return `${ctx.short(spec.base)} → ${ctx.short(spec.target)}${suffix}`
    }
  }
}
