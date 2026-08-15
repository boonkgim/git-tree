import type {
  ChangedFile,
  ChangedFilesResult,
  DiffOptions,
  DiffSpec,
  Selection
} from '@shared/types'
import { runGit } from './exec'
import { parseNameStatusZ, parseNumstatZ } from './parse'
import { haveCommonAncestor, isAncestor, type RepoSession } from './repo'
import { readStatus } from './status'
import {
  buildDiffArgs,
  describeSpec,
  resolveSelection,
  selectedNodes,
  type RepoFacts
} from './selection'

/** Files beyond this are dropped from the list; the UI says so explicitly. */
const MAX_FILES = 20_000

export function short(sha: string): string {
  return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 7) : sha
}

/**
 * Gathers every repository fact `resolveSelection` needs, so that the decision
 * itself can stay synchronous and pure.
 *
 * The ancestry questions are only asked when two commits are actually selected,
 * which keeps the common single-selection path down to one `git status` call.
 */
async function gatherFacts(session: RepoSession, selection: Selection): Promise<RepoFacts> {
  const nodes = selectedNodes(selection)
  const needsWorking = nodes.some((n) => n.kind === 'working')
  const commits = nodes.filter((n): n is { kind: 'commit'; sha: string } => n.kind === 'commit')

  const workingDirty = needsWorking ? (await readStatus(session.info.root)).summary.hasChanges : false

  // A commit the user clicked is always in the history buffer, but a stale
  // selection after a refresh might not be, so fall back to asking git.
  const parents = new Map<string, string[]>()
  for (const commit of commits) {
    if (session.log.has(commit.sha)) {
      parents.set(commit.sha, session.log.parentsOf(commit.sha))
    } else {
      const { stdout } = await runGit(session.info.root, [
        'rev-parse',
        `${commit.sha}^@`
      ]).catch(() => ({ stdout: '' }))
      parents.set(commit.sha, stdout.split('\n').map((s) => s.trim()).filter(Boolean))
    }
  }

  // Keyed both ways so the lookup cannot depend on argument order.
  const ancestry = new Map<string, boolean>()
  let common = false
  if (commits.length === 2 && commits[0].sha !== commits[1].sha) {
    const [a, b] = commits
    const ab = await isAncestor(session, a.sha, b.sha)
    const ba = ab ? false : await isAncestor(session, b.sha, a.sha)
    ancestry.set(`${a.sha}<${b.sha}`, ab)
    ancestry.set(`${b.sha}<${a.sha}`, ba)
    common = ab || ba || (await haveCommonAncestor(session, a.sha, b.sha))
  }

  return {
    head: session.info.head,
    emptyTree: session.emptyTree,
    parentsOf: (sha) => parents.get(sha) ?? [],
    dateOf: (sha) => session.log.dateOf(sha),
    isAncestor: (a, b) => ancestry.get(`${a}<${b}`) ?? false,
    haveCommonAncestor: () => common,
    workingDirty
  }
}

/** Resolves a selection into the comparison it means, plus its description. */
export async function resolve(
  session: RepoSession,
  selection: Selection,
  parentIndex: number
): Promise<{ spec: DiffSpec; label: string }> {
  const facts = await gatherFacts(session, selection)
  const spec = resolveSelection(selection, facts, parentIndex)
  const label = describeSpec(spec, { short, headSha: session.info.head })
  return { spec, label }
}

/**
 * The changed-files list for a comparison.
 *
 * `--name-status` and `--numstat` are asked for in parallel and merged by path:
 * name-status carries rename information, numstat carries line counts and — via
 * its `-` markers — tells us a file is binary without reading its contents.
 */
export async function changedFiles(
  session: RepoSession,
  selection: Selection,
  parentIndex: number,
  options: DiffOptions
): Promise<ChangedFilesResult> {
  const { spec, label } = await resolve(session, selection, parentIndex)
  const notes: string[] = []

  if (spec.mode === 'empty') {
    return { spec, label, files: [], notes, truncated: false }
  }
  if (spec.mode === 'range' && spec.relation === 'unrelated') {
    notes.push(
      'These commits share no common ancestor. The comparison below is a direct tree comparison, not a range of history.'
    )
  }
  if (spec.mode === 'range' && spec.relation === 'divergent') {
    notes.push(
      'Neither commit is an ancestor of the other. The older one by date is shown as the "before" side.'
    )
  }

  const cwd = session.info.root
  const [nameStatus, numstat] = await Promise.all([
    runGit(cwd, buildDiffArgs(spec, 'name-status', options)),
    runGit(cwd, buildDiffArgs(spec, 'numstat', options))
  ])

  const counts = new Map<string, { insertions: number | null; deletions: number | null; binary: boolean }>()
  for (const entry of parseNumstatZ(numstat.stdout)) {
    counts.set(entry.path, {
      insertions: entry.insertions,
      deletions: entry.deletions,
      binary: entry.binary
    })
  }

  const files: ChangedFile[] = parseNameStatusZ(nameStatus.stdout).map((entry) => {
    const count = counts.get(entry.path)
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      status: entry.status,
      score: entry.score,
      insertions: count?.insertions ?? null,
      deletions: count?.deletions ?? null,
      binary: count?.binary ?? false
    }
  })

  // Untracked files exist in no tree, so `git diff` cannot see them. They are
  // part of "uncommitted changes" as a user means it, so they are merged in.
  if (spec.mode === 'working') {
    const status = await readStatus(cwd)
    const known = new Set(files.map((f) => f.path))
    for (const entry of status.entries) {
      if (entry.untracked && !known.has(entry.path)) {
        files.push({
          path: entry.path,
          status: 'untracked',
          insertions: null,
          deletions: null,
          binary: false,
          untracked: true
        })
      } else if (entry.unmerged && !known.has(entry.path)) {
        files.push({
          path: entry.path,
          status: 'unmerged',
          insertions: null,
          deletions: null,
          binary: false
        })
      }
    }
    if (status.summary.conflicted > 0) {
      notes.push(
        `${status.summary.conflicted} file(s) have unresolved conflicts; their working-tree contents include conflict markers.`
      )
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  const truncated = files.length > MAX_FILES || nameStatus.truncated
  if (truncated) {
    notes.push(`Only the first ${MAX_FILES.toLocaleString()} files are listed.`)
  }

  return { spec, label, files: truncated ? files.slice(0, MAX_FILES) : files, notes, truncated }
}
