import type { CommitDetail } from '@shared/types'
import { GitError, runGit } from './exec'
import { DETAIL_FORMAT, parseCommitDetail } from './parse'
import type { RepoSession } from './repo'

/**
 * Full metadata for one commit.
 *
 * `-s` suppresses the diff, `-z` terminates the record, and the message body is
 * the last field of the format so a message containing our separators cannot
 * shift any other column.
 */
export async function commitDetail(session: RepoSession, sha: string): Promise<CommitDetail> {
  const { stdout } = await runGit(session.info.root, [
    'show',
    '-s',
    '--decorate=full',
    '-z',
    `--format=${DETAIL_FORMAT}`,
    sha
  ])
  const detail = parseCommitDetail(stdout)
  if (!detail) {
    throw new GitError({ code: 'GIT_FAILED', message: `Could not read commit ${sha}.` })
  }
  return detail
}
