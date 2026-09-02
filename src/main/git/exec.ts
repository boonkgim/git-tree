import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { GitTreeError } from '@shared/types'

/**
 * Subcommands this application is allowed to run. Every one of these is a read.
 *
 * This list is the mechanism that enforces the "never mutate the repository"
 * invariant: it is checked before spawn, so a bug elsewhere cannot turn into a
 * write. Adding to it is a deliberate act, not an accident.
 */
export const ALLOWED_SUBCOMMANDS = Object.freeze([
  'cat-file',
  'check-ignore',
  'diff',
  'diff-tree',
  'for-each-ref',
  'hash-object',
  'log',
  'ls-files',
  'merge-base',
  'rev-list',
  'rev-parse',
  'show',
  'status',
  'symbolic-ref',
  'var',
  'version'
])

/**
 * Arguments refused for every subcommand. These either run an arbitrary
 * program, write a file, or reach the network.
 */
const FORBIDDEN_ARGS = ['--exec', '--upload-pack', '--receive-pack', '--ext-diff', '--textconv', '--output']

/** Arguments refused only for particular subcommands. */
const FORBIDDEN_PER_SUBCOMMAND: Record<string, string[]> = {
  // `-w` writes the object into the store. Note that `-w` means
  // `--ignore-all-space` for diff, which is why this is not a global rule.
  'hash-object': ['-w', '--stdin-paths', '--path'],
  'cat-file': ['--filters', '--batch-command']
}

/**
 * Config forced onto every invocation:
 *  - no pager (we are not a terminal)
 *  - no colour escape codes in output we have to parse
 *  - no path quoting, so `-z` output is raw bytes we can split reliably
 *  - no external diff driver and no textconv filter, so git never executes a
 *    program the user configured on our behalf
 */
const FORCED_CONFIG = [
  '--no-pager',
  '-c',
  'color.ui=false',
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.external=',
  '-c',
  'diff.noprefix=false',
  // A user with commit.gpgsign / log.showSignature would otherwise get
  // signature verification output interleaved into what we parse.
  '-c',
  'log.showSignature=false'
]

export class GitError extends Error {
  readonly info: GitTreeError
  constructor(info: GitTreeError) {
    super(info.message)
    this.name = 'GitError'
    this.info = info
  }
}

export interface RunOptions {
  /** Bytes of stdout to accept before aborting. */
  maxBuffer?: number
  /** Milliseconds before the child is killed. */
  timeout?: number
  /** Written to the child's stdin, then closed. */
  stdin?: string
  /**
   * Exit codes to treat as success in addition to 0. `git diff --no-index`
   * exits 1 when the files differ, which is the normal case for us.
   */
  okExitCodes?: number[]
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
  /** True when stdout was not valid UTF-8 and was decoded with replacements. */
  nonUtf8: boolean
  /** True when output hit `maxBuffer` and was cut short. */
  truncated: boolean
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024
const DEFAULT_TIMEOUT = 30_000

/**
 * Rejects anything that is not a plain read. Exported for tests: the invariant
 * is only worth anything if it is checked.
 */
export function assertReadOnly(args: readonly string[]): void {
  // Walk past any git-level options to find the subcommand. `-c key=value`
  // takes a separate value argument, so it has to be skipped in pairs.
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-c' || args[i] === '--git-dir' || args[i] === '--work-tree') {
      i += 2
      continue
    }
    throw new GitError({
      code: 'FORBIDDEN',
      message: `Refusing unexpected git-level option "${args[i]}".`
    })
  }

  const subcommand = args[i]
  if (!subcommand) {
    throw new GitError({ code: 'FORBIDDEN', message: 'Refusing to run git with no subcommand.' })
  }
  if (!ALLOWED_SUBCOMMANDS.includes(subcommand)) {
    throw new GitError({
      code: 'FORBIDDEN',
      message: `Refusing to run "git ${subcommand}": this application only performs reads.`
    })
  }

  // Only inspect arguments before `--`; after it, everything is a pathspec and
  // a file legitimately named "--exec" must not trip the guard.
  const rest = args.slice(i + 1)
  const dashDash = rest.indexOf('--')
  const flags = dashDash === -1 ? rest : rest.slice(0, dashDash)
  const forbidden = [...FORBIDDEN_ARGS, ...(FORBIDDEN_PER_SUBCOMMAND[subcommand] ?? [])]
  for (const arg of flags) {
    const name = arg.split('=')[0]
    if (forbidden.includes(name)) {
      throw new GitError({
        code: 'FORBIDDEN',
        message: `Refusing "git ${subcommand} ${name}": it could write to the repository or run an external program.`
      })
    }
  }
}

/**
 * Environment for every child. `GIT_OPTIONAL_LOCKS=0` matters more than it
 * looks: without it `git status` refreshes and rewrites the index, which would
 * be a write to the repository.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_PAGER = 'cat'
  env.GIT_ASKPASS = ''
  env.LC_ALL = 'C.UTF-8'
  delete env.GIT_CONFIG_PARAMETERS
  delete env.GIT_EXTERNAL_DIFF
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  return env
}

/** Decodes as UTF-8, falling back to a lossy decode and reporting that it did. */
export function decodeUtf8(buf: Buffer): { text: string; nonUtf8: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), nonUtf8: false }
  } catch {
    return { text: new TextDecoder('utf-8').decode(buf), nonUtf8: true }
  }
}

/** Path to the git binary. Overridable for tests only. */
let gitBinary = 'git'
export function setGitBinary(path: string): void {
  gitBinary = path
}

/**
 * Runs git in `cwd` with an explicit argument array. Never a shell, never an
 * interpolated command line, so paths and refs containing spaces, quotes, or
 * shell metacharacters are simply data.
 */
export async function runGit(
  cwd: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const { stdout, stderr, code, truncated } = await runGitBuffer(cwd, args, options)
  const { text, nonUtf8 } = decodeUtf8(stdout)
  return { stdout: text, stderr, code, nonUtf8, truncated }
}

/** What `runGitBuffer` resolves with: the same run, with stdout left as bytes. */
/**
 * Turns a failure to *start* git into something the UI can show.
 *
 * `spawn` reports these two ways: asynchronously on the child's `error` event
 * when the executable cannot be run, and synchronously — straight out of the
 * call — when the stdio pipes themselves cannot be set up, which is what a
 * machine short of file descriptors does. Both land here so that neither can
 * reach a panel as a bare `spawn ENOTCONN`.
 *
 * Exported for tests: the synchronous half cannot be reached through `runGit`,
 * which builds the spawn options itself, so the mapping is checked directly.
 */
export function spawnError(e: NodeJS.ErrnoException): GitError {
  if (e.code === 'ENOENT') {
    return new GitError({
      code: 'GIT_MISSING',
      message: 'Could not find the "git" command.',
      detail: 'Install Git and make sure it is on your PATH, then reopen the repository.'
    })
  }
  return new GitError({
    code: 'GIT_FAILED',
    message: `Could not run git: ${e.message}`,
    detail:
      e.code === 'EMFILE' || e.code === 'ENFILE' || e.code === 'ENOTCONN'
        ? 'The machine ran out of file handles to start the process with. Closing some applications and trying again usually clears it.'
        : undefined
  })
}

export interface RawResult {
  stdout: Buffer
  stderr: string
  code: number
  truncated: boolean
}

/**
 * The same run as `runGit`, with stdout handed back as bytes.
 *
 * `cat-file blob` on an image is the case this exists for: decoding those bytes
 * as UTF-8 would corrupt them, and the caller wants the file, not text.
 */
export function runGitBuffer(
  cwd: string,
  args: string[],
  options: RunOptions = {}
): Promise<RawResult> {
  assertReadOnly(args)

  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  const okCodes = options.okExitCodes ?? [0]
  const full = [...FORCED_CONFIG, ...args]

  return new Promise<RawResult>((resolve, reject) => {
    // `spawn` can throw here rather than emit: creating the stdio pipes is done
    // synchronously, so a machine out of file handles fails before there is a
    // child to attach a listener to. Inside a promise executor that would
    // reject with the raw `spawn ENOTCONN`, which says nothing to anyone.
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(gitBinary, full, {
        cwd,
        env: childEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      reject(spawnError(e as NodeJS.ErrnoException))
      return
    }

    const out: Buffer[] = []
    const err: Buffer[] = []
    let outBytes = 0
    let truncated = false
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new GitError({
          code: 'TIMEOUT',
          message: `git ${args[0]} took longer than ${Math.round(timeout / 1000)}s and was stopped.`
        })
      )
    }, timeout)

    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(spawnError(e))
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return
      outBytes += chunk.length
      if (outBytes > maxBuffer) {
        truncated = true
        out.push(chunk.subarray(0, chunk.length - (outBytes - maxBuffer)))
        child.kill('SIGKILL')
        return
      }
      out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      // stderr is only ever shown to the user, so a small cap is plenty.
      if (err.length < 64) err.push(chunk)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = Buffer.concat(out)
      const stderr = Buffer.concat(err).toString('utf8').trim()
      const exit = code ?? 0

      if (truncated || okCodes.includes(exit)) {
        resolve({ stdout, stderr, code: exit, truncated })
        return
      }
      reject(
        new GitError({
          code: 'GIT_FAILED',
          message: stderr.split('\n')[0] || `git ${args[0]} exited with code ${exit}.`,
          detail: stderr || undefined
        })
      )
    })

    if (options.stdin !== undefined) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}

/**
 * Spawns git for streaming consumption. Same guard, same environment, but the
 * caller reads stdout incrementally instead of waiting for the process to end.
 */
export function spawnGit(cwd: string, args: string[]) {
  assertReadOnly(args)
  try {
    return spawn(gitBinary, [...FORCED_CONFIG, ...args], {
      cwd,
      env: childEnv(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (e) {
    throw spawnError(e as NodeJS.ErrnoException)
  }
}

/** Normalises anything thrown inside the main process into a `GitTreeError`. */
export function toGitTreeError(e: unknown): GitTreeError {
  if (e instanceof GitError) return e.info
  if (e instanceof Error) return { code: 'GIT_FAILED', message: e.message }
  return { code: 'GIT_FAILED', message: String(e) }
}
