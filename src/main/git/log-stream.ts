import type { ChildProcess } from 'node:child_process'
import type { CommitSummary, GitTreeError, HistoryPage } from '@shared/types'
import { spawnGit, toGitTreeError } from './exec'
import { LOG_FORMAT, parseLogRecords } from './parse'

/**
 * Upper bound on commits held in memory. A 200k-commit history is roughly
 * 40 MB of summaries, which is the point where holding more stops being a
 * reasonable trade for a viewer.
 */
const MAX_COMMITS = 200_000

/**
 * A `git log` process read incrementally.
 *
 * Paging with `--skip` costs a re-walk from the tips on every page, which is
 * exactly the thing that makes large repositories feel bad. Instead one process
 * walks the history once while the renderer reads slices out of the buffer as
 * they arrive, so scrolling stays O(1) no matter how deep the user goes.
 */
export class LogStream {
  private readonly commits: CommitSummary[] = []
  private readonly bySha = new Map<string, CommitSummary>()
  /** Position of each commit in the walk, so a ref tip can be scrolled to. */
  private readonly indexBySha = new Map<string, number>()
  private child: ChildProcess | null = null
  private decoder = new TextDecoder('utf-8')
  private pending = ''
  private finished = false
  private failure: GitTreeError | null = null
  private waiters: Array<() => void> = []
  private disposed = false

  constructor(private readonly cwd: string) {
    this.start()
  }

  private start(): void {
    try {
      this.child = spawnGit(this.cwd, [
        'log',
        '--all',
        '--date-order',
        '--decorate=full',
        '-z',
        `--format=${LOG_FORMAT}`
      ])
    } catch (e) {
      this.fail(toGitTreeError(e))
      return
    }

    const stderr: string[] = []
    this.child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32) stderr.push(chunk.toString('utf8'))
    })

    this.child.stdout?.on('data', (chunk: Buffer) => this.consume(chunk))
    this.child.on('error', (e) => this.fail(toGitTreeError(e)))
    this.child.on('close', (code) => {
      // Flush whatever is left; the final record has no trailing NUL.
      this.flush(this.decoder.decode())
      if (this.pending) {
        this.append(parseLogRecords(this.pending))
        this.pending = ''
      }
      if (code !== 0 && code !== null && !this.disposed && this.commits.length === 0) {
        const message = stderr.join('').trim().split('\n')[0]
        // An empty repository is not an error; git log simply has nothing.
        if (message && !/does not have any commits yet|unknown revision/i.test(message)) {
          this.fail({ code: 'GIT_FAILED', message })
          return
        }
      }
      this.finished = true
      this.wake()
    })
  }

  private consume(chunk: Buffer): void {
    if (this.commits.length >= MAX_COMMITS) {
      this.finished = true
      this.stopChild()
      this.wake()
      return
    }
    this.flush(this.decoder.decode(chunk, { stream: true }))
  }

  private flush(text: string): void {
    if (!text) return
    this.pending += text
    const lastNul = this.pending.lastIndexOf('\0')
    if (lastNul === -1) return
    const complete = this.pending.slice(0, lastNul + 1)
    this.pending = this.pending.slice(lastNul + 1)
    const parsed = parseLogRecords(complete)
    if (parsed.length) {
      this.append(parsed)
      this.wake()
    }
  }

  private append(commits: CommitSummary[]): void {
    for (const commit of commits) {
      if (!this.bySha.has(commit.sha)) this.indexBySha.set(commit.sha, this.commits.length)
      this.bySha.set(commit.sha, commit)
      this.commits.push(commit)
    }
  }

  private fail(error: GitTreeError): void {
    this.failure = error
    this.finished = true
    this.wake()
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve()
  }

  private stopChild(): void {
    if (!this.child) return
    this.child.stdout?.destroy()
    this.child.kill('SIGKILL')
    this.child = null
  }

  /** Waits until `count` commits are buffered, or the walk ends. */
  private async waitFor(count: number): Promise<void> {
    while (this.commits.length < count && !this.finished && !this.failure) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  async page(offset: number, limit: number): Promise<HistoryPage> {
    await this.waitFor(offset + limit)
    if (this.failure) throw Object.assign(new Error(this.failure.message), { info: this.failure })
    const rows = this.commits.slice(offset, offset + limit)
    return {
      rows,
      offset,
      // `done` means "there is nothing after this page", not merely that the
      // walk has ended: when the whole log is already buffered, every page but
      // the last still has more behind it.
      done: this.finished && offset + rows.length >= this.commits.length,
      loaded: this.commits.length
    }
  }

  /** Parents of a commit, if it has been buffered. Empty for anything unknown. */
  parentsOf(sha: string): string[] {
    return this.bySha.get(sha)?.parents ?? []
  }

  dateOf(sha: string): string | undefined {
    return this.bySha.get(sha)?.committerDate
  }

  has(sha: string): boolean {
    return this.bySha.has(sha)
  }

  /**
   * Position of a commit in the walk, or -1 when it is not in it.
   *
   * A ref tip can be anywhere in a history the renderer has only paged the
   * front of, so this waits for the walk to reach it rather than answering from
   * what happens to be buffered. `-1` is a real answer: a ref can point at a
   * commit that `--all` does not reach, and the walk stops at `MAX_COMMITS`.
   */
  async indexOf(sha: string): Promise<number> {
    while (!this.finished && !this.failure && !this.indexBySha.has(sha)) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    if (this.failure) throw Object.assign(new Error(this.failure.message), { info: this.failure })
    return this.indexBySha.get(sha) ?? -1
  }

  get error(): GitTreeError | null {
    return this.failure
  }

  dispose(): void {
    this.disposed = true
    this.stopChild()
    this.finished = true
    this.wake()
  }
}
