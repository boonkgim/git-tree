import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RepoInfo, RepoOperation } from '@shared/types'
import { GitError, runGit } from './exec'
import { requireGit } from './version'
import { LogStream } from './log-stream'

/**
 * The well-known empty tree for SHA-1 repositories. Only used if asking git for
 * it fails; SHA-256 repositories have a different one, which is why we ask.
 */
const SHA1_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface RepoSession {
  info: RepoInfo
  /** Absolute path to the .git directory. */
  gitDir: string
  emptyTree: string
  log: LogStream
  /** Memoised `merge-base` answers; commits are immutable so this is safe. */
  ancestry: Map<string, boolean>
}

const sessions = new Map<string, RepoSession>()

export function getSession(id: string): RepoSession {
  const session = sessions.get(id)
  if (!session) {
    throw new GitError({
      code: 'NO_REPO',
      message: 'That repository is no longer open. Open it again to continue.'
    })
  }
  return session
}

export function allSessions(): RepoSession[] {
  return [...sessions.values()]
}

/** Detects an interrupted operation from the marker files git leaves behind. */
export function detectOperation(gitDir: string): RepoOperation {
  if (existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply')))
    return 'rebase'
  if (existsSync(path.join(gitDir, 'MERGE_HEAD'))) return 'merge'
  if (existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  if (existsSync(path.join(gitDir, 'REVERT_HEAD'))) return 'revert'
  if (existsSync(path.join(gitDir, 'BISECT_LOG'))) return 'bisect'
  return null
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await runGit(cwd, args)).stdout.trim()
  } catch {
    return null
  }
}

/**
 * Asks the repository for its own empty tree id rather than assuming SHA-1.
 * `hash-object` without `-w` only computes the id; it writes nothing.
 */
async function resolveEmptyTree(cwd: string): Promise<string> {
  const value = await tryGit(cwd, ['hash-object', '-t', 'tree', '--stdin'])
  return value && /^[0-9a-f]{40,64}$/.test(value) ? value : SHA1_EMPTY_TREE
}

/**
 * Opens a repository, accepting any path inside it. Every failure mode gets a
 * specific message: this is the point where a user finds out something is wrong
 * and vague errors here are expensive.
 */
export async function openRepo(requestedPath: string): Promise<RepoInfo> {
  const version = await requireGit()

  const start = path.resolve(requestedPath)
  if (!existsSync(start)) {
    throw new GitError({
      code: 'NOT_A_REPO',
      message: `There is nothing at ${start}.`
    })
  }

  let gitDir: string
  try {
    gitDir = (await runGit(start, ['rev-parse', '--absolute-git-dir'])).stdout.trim()
  } catch (e) {
    const detail = e instanceof GitError ? e.info.detail : undefined
    if (detail && /dubious ownership|detected dubious/i.test(detail)) {
      throw new GitError({
        code: 'UNREADABLE',
        message: 'Git refuses to read this repository because it is owned by another user.',
        detail: `Run: git config --global --add safe.directory ${start}`
      })
    }
    if (detail && /permission denied/i.test(detail)) {
      throw new GitError({
        code: 'UNREADABLE',
        message: `Cannot read ${start}: permission denied.`
      })
    }
    throw new GitError({
      code: 'NOT_A_REPO',
      message: `${start} is not inside a Git repository.`,
      detail
    })
  }

  const bare = (await tryGit(start, ['rev-parse', '--is-bare-repository'])) === 'true'
  const root = bare ? gitDir : ((await tryGit(start, ['rev-parse', '--show-toplevel'])) ?? start)

  const head = await tryGit(root, ['rev-parse', '--verify', 'HEAD'])
  const branch = await tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const emptyTree = await resolveEmptyTree(root)

  const id = createHash('sha1').update(root).digest('hex').slice(0, 16)
  const info: RepoInfo = {
    id,
    root,
    name: path.basename(root) || root,
    head,
    branch,
    detached: head !== null && branch === null,
    unborn: head === null,
    bare,
    operation: detectOperation(gitDir),
    gitVersion: version.raw
  }

  sessions.get(id)?.log.dispose()
  sessions.set(id, {
    info,
    gitDir,
    emptyTree,
    log: new LogStream(root),
    ancestry: new Map()
  })

  return info
}

/**
 * Restarts the history stream after the repository changed on disk, keeping the
 * same session id so the renderer's selection survives.
 */
export async function refreshSession(id: string): Promise<RepoInfo> {
  const session = getSession(id)
  const { root, gitDir } = { root: session.info.root, gitDir: session.gitDir }

  session.info.head = await tryGit(root, ['rev-parse', '--verify', 'HEAD'])
  session.info.branch = await tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
  session.info.detached = session.info.head !== null && session.info.branch === null
  session.info.unborn = session.info.head === null
  session.info.operation = detectOperation(gitDir)

  session.ancestry.clear()
  session.log.dispose()
  session.log = new LogStream(root)

  return session.info
}

export function closeAll(): void {
  for (const session of sessions.values()) session.log.dispose()
  sessions.clear()
}

/** `git merge-base --is-ancestor`, memoised per session. */
export async function isAncestor(
  session: RepoSession,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  const key = `${ancestor}<${descendant}`
  const cached = session.ancestry.get(key)
  if (cached !== undefined) return cached
  const result = await runGit(
    session.info.root,
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { okExitCodes: [0, 1] }
  )
  const value = result.code === 0
  session.ancestry.set(key, value)
  return value
}

/** True when the two commits share any ancestor at all. */
export async function haveCommonAncestor(
  session: RepoSession,
  a: string,
  b: string
): Promise<boolean> {
  try {
    const result = await runGit(session.info.root, ['merge-base', a, b], { okExitCodes: [0, 1] })
    return result.code === 0 && result.stdout.trim().length > 0
  } catch {
    return false
  }
}

export { SHA1_EMPTY_TREE }
