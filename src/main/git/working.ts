import type { ChangedFile, FileStatus, WorkingFilesResult } from '@shared/types'
import { runGit } from './exec'
import { parseNumstatZ, splitNul, statusFromLetter } from './parse'
import type { RepoSession } from './repo'
import { readStatus } from './status'

/**
 * Files beyond this are dropped from the list; the UI says so explicitly.
 *
 * The same ceiling the changed-file list uses. It bites far more often here,
 * because a working tree with `node_modules` in it is a quarter of a million
 * files, which is exactly why ignored files are opt-in.
 */
const MAX_FILES = 20_000

/**
 * The single status to show for a working-tree file.
 *
 * `git status` reports two letters, one for the index and one for the working
 * tree, and a file can differ from both. The panel has one column, so the
 * working-tree letter wins: it describes the file as it is on disk, which is
 * what a project pane is a view of. A file staged and then left alone falls
 * back to the index letter rather than reading as unchanged.
 */
export function displayStatus(indexStatus: string, worktreeStatus: string): FileStatus {
  if (worktreeStatus !== '.' && worktreeStatus !== '') return statusFromLetter(worktreeStatus)
  if (indexStatus !== '.' && indexStatus !== '') return statusFromLetter(indexStatus)
  return 'clean'
}

/** `git ls-files` output as a de-duplicated list. Unmerged paths are listed once per stage. */
async function lsFiles(cwd: string, args: string[]): Promise<string[]> {
  const { stdout } = await runGit(cwd, ['ls-files', '-z', ...args])
  return [...new Set(splitNul(stdout).filter((path) => path !== ''))]
}

/**
 * Every file in the working tree, the way an editor's project pane lists them.
 *
 * This is deliberately *not* a diff. `git ls-files` is asked what is on disk —
 * tracked files plus untracked ones, and ignored ones when they are wanted —
 * and `git status` is asked which of those differ, so that the list is complete
 * and each row still carries the colour a reader expects. Files that differ
 * from nothing come back as `clean`, which no comparison ever produces.
 *
 * Ignored files are appended last and are the first thing dropped when the
 * ceiling is hit, so turning them on can never push a real file out of view.
 */
export async function workingFiles(
  session: RepoSession,
  includeIgnored: boolean
): Promise<WorkingFilesResult> {
  const cwd = session.info.root
  const notes: string[] = []

  if (session.info.bare) {
    return {
      files: [],
      includeIgnored,
      notes: ['This is a bare repository, so there is no working tree to list.'],
      truncated: false
    }
  }

  const [paths, status, ignoredPaths] = await Promise.all([
    lsFiles(cwd, ['--cached', '--others', '--exclude-standard']),
    readStatus(cwd),
    includeIgnored
      ? lsFiles(cwd, ['--others', '--ignored', '--exclude-standard'])
      : Promise.resolve([])
  ])

  const byPath = new Map(status.entries.map((entry) => [entry.path, entry]))

  // Line counts for the files that have them, so a modified row in this view
  // reads the same as it does in the comparison view. Against HEAD, because
  // that is what "uncommitted" means; an unborn branch has no HEAD to ask.
  const counts = new Map<string, { insertions: number | null; deletions: number | null; binary: boolean }>()
  if (session.info.head) {
    const numstat = await runGit(cwd, [
      'diff',
      '--numstat',
      '-z',
      '--no-color',
      'HEAD'
    ]).catch(() => null)
    for (const entry of numstat ? parseNumstatZ(numstat.stdout) : []) {
      counts.set(entry.path, {
        insertions: entry.insertions,
        deletions: entry.deletions,
        binary: entry.binary
      })
    }
  }

  const tracked: ChangedFile[] = paths.map((path) => {
    const entry = byPath.get(path)
    const count = counts.get(path)
    const fileStatus: FileStatus = entry
      ? entry.unmerged
        ? 'unmerged'
        : entry.untracked
          ? 'untracked'
          : displayStatus(entry.indexStatus, entry.worktreeStatus)
      : 'clean'
    return {
      path,
      status: fileStatus,
      insertions: count?.insertions ?? null,
      deletions: count?.deletions ?? null,
      binary: count?.binary ?? false,
      ...(entry?.untracked ? { untracked: true } : {})
    }
  })

  const ignored: ChangedFile[] = ignoredPaths.map((path) => ({
    path,
    status: 'ignored',
    insertions: null,
    deletions: null,
    binary: false
  }))

  const room = Math.max(0, MAX_FILES - tracked.length)
  const truncated = tracked.length + ignored.length > MAX_FILES
  const files = [...tracked.slice(0, MAX_FILES), ...ignored.slice(0, room)]

  if (truncated) {
    notes.push(
      `This working tree holds more than ${MAX_FILES.toLocaleString()} files; only the first ${MAX_FILES.toLocaleString()} are listed.`
    )
  }
  if (status.summary.conflicted > 0) {
    notes.push(
      `${status.summary.conflicted} file(s) have unresolved conflicts; their working-tree contents include conflict markers.`
    )
  }

  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  return { files, includeIgnored, notes, truncated }
}
