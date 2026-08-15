import type { WorkingSummary } from '@shared/types'
import { runGit } from './exec'
import { parsePorcelainV2, type PorcelainStatus } from './parse'

/**
 * Reads the working tree state.
 *
 * `--porcelain=v2 -z` is the only status format that is safe to parse: paths
 * are raw bytes between NULs, so spaces, quotes and newlines in filenames are
 * not a problem. `-uall` lists untracked files individually rather than
 * collapsing whole directories, which the changed-files panel needs.
 *
 * The `GIT_OPTIONAL_LOCKS=0` set in `exec.ts` is what keeps this a pure read:
 * without it, status refreshes and rewrites the index.
 */
export async function readStatus(cwd: string): Promise<PorcelainStatus> {
  const { stdout } = await runGit(cwd, [
    'status',
    '--porcelain=v2',
    '-z',
    '-uall',
    '--branch',
    '--no-renames'
  ])
  return parsePorcelainV2(stdout)
}

/**
 * A cheap-to-render summary for the history row and the metadata panel.
 * Renames are disabled in `readStatus` so counts stay a simple tally of files.
 */
export async function readSummary(cwd: string): Promise<WorkingSummary> {
  return (await readStatus(cwd)).summary
}
