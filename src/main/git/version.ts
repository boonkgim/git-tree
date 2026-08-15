import { GitError, runGit } from './exec'

/** Oldest git we can rely on: `status --porcelain=v2` landed in 2.11. */
export const MINIMUM_GIT = [2, 11, 0] as const

export interface GitVersion {
  raw: string
  parts: [number, number, number]
}

export function parseGitVersion(output: string): GitVersion | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output)
  if (!match) return null
  return {
    raw: output.trim(),
    parts: [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      match[3] ? Number.parseInt(match[3], 10) : 0
    ]
  }
}

export function isAtLeast(parts: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const a = parts[i] ?? 0
    const b = minimum[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

let cached: GitVersion | null = null

/**
 * Resolves the installed git once per run. A missing or ancient git is the
 * single most likely reason this app fails on a new machine, so it is checked
 * up front and reported in plain language rather than surfacing later as an
 * unexplained empty panel.
 */
export async function requireGit(): Promise<GitVersion> {
  if (cached) return cached

  let output: string
  try {
    // `--version` is a git-level option, so it is spelled as a subcommand here.
    output = (await runGit(process.cwd(), ['version'], { timeout: 10_000 })).stdout
  } catch (e) {
    if (e instanceof GitError && e.info.code === 'GIT_MISSING') throw e
    throw new GitError({
      code: 'GIT_MISSING',
      message: 'Could not run the "git" command.',
      detail: e instanceof Error ? e.message : String(e)
    })
  }

  const version = parseGitVersion(output)
  if (!version) {
    throw new GitError({
      code: 'GIT_TOO_OLD',
      message: `Could not understand the output of "git --version": ${output.trim()}`
    })
  }
  if (!isAtLeast(version.parts, MINIMUM_GIT)) {
    throw new GitError({
      code: 'GIT_TOO_OLD',
      message: `git ${version.parts.join('.')} is too old; this app needs ${MINIMUM_GIT.join('.')} or newer.`,
      detail: 'Upgrade git, or point PATH at a newer installation.'
    })
  }

  cached = version
  return version
}
