import type {
  CommitDetail,
  CommitSummary,
  DiffHunk,
  DiffLine,
  FileStatus,
  RefLabel,
  WorkingSummary
} from '@shared/types'

/* ------------------------------------------------------------------ helpers */

const UNIT = '\x1f'
const NUL = '\0'

/**
 * Splits NUL-terminated output into records. Git's `-z` modes terminate every
 * field, so the final element after a split is an empty string we drop; some
 * commands separate rather than terminate, so a trailing non-empty record is
 * kept.
 */
export function splitNul(text: string): string[] {
  if (text === '') return []
  const parts = text.split(NUL)
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

/* ------------------------------------------------------------ log / commits */

/**
 * The `--format` string used for the history stream. The one free-text field
 * (`%s`) is deliberately last: if a subject somehow contained our unit
 * separator, the extra pieces are rejoined instead of shifting every column.
 */
export const LOG_FORMAT = [
  '%H', // sha
  '%P', // parents, space separated
  '%an',
  '%ae',
  '%aI', // author date, strict ISO 8601
  '%cI', // committer date
  '%D', // ref decorations (full paths, with --decorate=full)
  '%s' // subject -- must stay last
].join(UNIT)

/** Same fields plus committer identity and the full message body, again last. */
export const DETAIL_FORMAT = [
  '%H',
  '%P',
  '%an',
  '%ae',
  '%aI',
  '%cI',
  '%D',
  '%cn',
  '%ce',
  '%s',
  '%B' // body -- must stay last
].join(UNIT)

/**
 * Turns `refs/heads/main`, `HEAD -> refs/heads/main`, `tag: refs/tags/v1` and
 * the abbreviated equivalents into labels the UI can render.
 */
export function parseRefDecoration(decoration: string): RefLabel[] {
  const trimmed = decoration.trim()
  if (!trimmed) return []

  const labels: RefLabel[] = []
  // Ref names cannot contain spaces, so ", " is an unambiguous separator.
  for (const rawPart of trimmed.split(', ')) {
    let part = rawPart.trim()
    if (!part) continue

    let isHead = false
    if (part.startsWith('HEAD -> ')) {
      isHead = true
      part = part.slice('HEAD -> '.length)
    } else if (part === 'HEAD') {
      labels.push({ name: 'HEAD', kind: 'head', isHead: true })
      continue
    }

    let isTag = false
    if (part.startsWith('tag: ')) {
      isTag = true
      part = part.slice('tag: '.length)
    }

    if (part.startsWith('refs/tags/')) {
      labels.push({ name: part.slice('refs/tags/'.length), kind: 'tag', isHead: false })
    } else if (part.startsWith('refs/remotes/')) {
      labels.push({ name: part.slice('refs/remotes/'.length), kind: 'remote', isHead })
    } else if (part.startsWith('refs/heads/')) {
      labels.push({ name: part.slice('refs/heads/'.length), kind: 'branch', isHead })
    } else if (part.startsWith('refs/')) {
      labels.push({ name: part, kind: 'branch', isHead })
    } else {
      // Abbreviated decoration (no --decorate=full); classify by shape.
      labels.push({ name: part, kind: isTag ? 'tag' : 'branch', isHead })
    }
  }
  return labels
}

/**
 * Splits a record into exactly `count` fields, folding any surplus separators
 * back into the last field.
 */
function fields(record: string, count: number): string[] {
  const parts = record.split(UNIT)
  if (parts.length <= count) {
    while (parts.length < count) parts.push('')
    return parts
  }
  return [...parts.slice(0, count - 1), parts.slice(count - 1).join(UNIT)]
}

function toSummary(record: string): CommitSummary | null {
  if (!record) return null
  const [sha, parents, authorName, authorEmail, authorDate, committerDate, refs, subject] = fields(
    record,
    8
  )
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) return null
  return {
    sha,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    authorDate,
    committerDate,
    subject,
    refs: parseRefDecoration(refs)
  }
}

/** Parses a chunk of `git log -z --format=LOG_FORMAT` output. */
export function parseLogRecords(text: string): CommitSummary[] {
  const out: CommitSummary[] = []
  for (const record of splitNul(text)) {
    const commit = toSummary(record)
    if (commit) out.push(commit)
  }
  return out
}

/** Parses a single `git show -s --format=DETAIL_FORMAT` record. */
export function parseCommitDetail(text: string): CommitDetail | null {
  const record = splitNul(text)[0] ?? text
  if (!record) return null
  const [
    sha,
    parents,
    authorName,
    authorEmail,
    authorDate,
    committerDate,
    refs,
    committerName,
    committerEmail,
    subject,
    body
  ] = fields(record, 11)
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) return null
  return {
    sha,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    authorDate,
    committerDate,
    subject,
    refs: parseRefDecoration(refs),
    committerName,
    committerEmail,
    body: body.replace(/\n+$/, '')
  }
}

/* -------------------------------------------------------------- name-status */

export interface NameStatusEntry {
  status: FileStatus
  path: string
  oldPath?: string
  score?: number
}

/** Maps git's single-letter status to something the UI can name. */
export function statusFromLetter(letter: string): FileStatus {
  switch (letter) {
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

/**
 * Parses `git diff --name-status -z`.
 *
 * Layout is `STATUS\0path\0`, except renames and copies which carry a
 * similarity score and two paths: `R096\0old\0new\0`.
 */
export function parseNameStatusZ(text: string): NameStatusEntry[] {
  const tokens = splitNul(text)
  const out: NameStatusEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const raw = tokens[i++]
    if (!raw) continue
    const letter = raw[0]
    const status = statusFromLetter(letter)
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[i++]
      const path = tokens[i++]
      if (path === undefined) break
      const score = Number.parseInt(raw.slice(1), 10)
      out.push({ status, path, oldPath, score: Number.isNaN(score) ? undefined : score })
    } else {
      const path = tokens[i++]
      if (path === undefined) break
      out.push({ status, path })
    }
  }
  return out
}

/* ------------------------------------------------------------------ numstat */

export interface NumstatEntry {
  path: string
  oldPath?: string
  insertions: number | null
  deletions: number | null
  binary: boolean
}

/**
 * Parses `git diff --numstat -z`.
 *
 * Normal records are `ins\tdel\tpath\0`. For renames and copies the path part
 * is empty and two further NUL-terminated paths follow: `ins\tdel\t\0old\0new\0`.
 * Binary files report `-` for both counts.
 */
export function parseNumstatZ(text: string): NumstatEntry[] {
  const tokens = splitNul(text)
  const out: NumstatEntry[] = []
  let i = 0
  while (i < tokens.length) {
    const record = tokens[i++]
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue

    const added = record.slice(0, firstTab)
    const removed = record.slice(firstTab + 1, secondTab)
    let path = record.slice(secondTab + 1)
    let oldPath: string | undefined

    if (path === '') {
      oldPath = tokens[i++]
      path = tokens[i++] ?? ''
      if (!path) break
    }

    const binary = added === '-' || removed === '-'
    out.push({
      path,
      oldPath,
      binary,
      insertions: binary ? null : Number.parseInt(added, 10),
      deletions: binary ? null : Number.parseInt(removed, 10)
    })
  }
  return out
}

/* ------------------------------------------------------- status porcelain v2 */

export interface StatusEntry {
  path: string
  oldPath?: string
  /** Index (staged) status letter, '.' when unchanged. */
  indexStatus: string
  /** Working-tree (unstaged) status letter, '.' when unchanged. */
  worktreeStatus: string
  untracked: boolean
  unmerged: boolean
  /** Octal mode in the working tree, when git reports one. */
  worktreeMode?: string
}

export interface PorcelainStatus {
  entries: StatusEntry[]
  summary: WorkingSummary
  branch: string | null
  oid: string | null
  detached: boolean
}

/**
 * Parses `git status --porcelain=v2 -z -uall --branch`.
 *
 * Record kinds: `# ` headers, `1 ` ordinary, `2 ` renamed/copied (which carries
 * one extra NUL-terminated path), `u ` unmerged, `? ` untracked, `! ` ignored.
 */
export function parsePorcelainV2(text: string): PorcelainStatus {
  const tokens = splitNul(text)
  const entries: StatusEntry[] = []
  let branch: string | null = null
  let oid: string | null = null
  let detached = false

  let i = 0
  while (i < tokens.length) {
    const record = tokens[i++]
    if (!record) continue

    if (record.startsWith('# ')) {
      const [key, ...valueParts] = record.slice(2).split(' ')
      const value = valueParts.join(' ')
      if (key === 'branch.head') {
        if (value === '(detached)') detached = true
        else branch = value
      } else if (key === 'branch.oid') {
        oid = value === '(initial)' ? null : value
      }
      continue
    }

    if (record.startsWith('? ')) {
      entries.push({
        path: record.slice(2),
        indexStatus: '.',
        worktreeStatus: '?',
        untracked: true,
        unmerged: false
      })
      continue
    }

    if (record.startsWith('! ')) continue // ignored; we never ask for these

    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const isRename = record.startsWith('2 ')
      const parts = record.slice(2).split(' ')
      const xy = parts[0] ?? '..'
      const worktreeMode = parts[4]
      const pathIndex = isRename ? 8 : 7
      const path = parts.slice(pathIndex).join(' ')
      const oldPath = isRename ? tokens[i++] : undefined
      entries.push({
        path,
        oldPath,
        indexStatus: xy[0] ?? '.',
        worktreeStatus: xy[1] ?? '.',
        untracked: false,
        unmerged: false,
        worktreeMode
      })
      continue
    }

    if (record.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      //   0     1     2    3    4    5    6    7    8     9
      const parts = record.slice(2).split(' ')
      const xy = parts[0] ?? 'UU'
      entries.push({
        path: parts.slice(9).join(' '),
        indexStatus: xy[0] ?? 'U',
        worktreeStatus: xy[1] ?? 'U',
        untracked: false,
        unmerged: true,
        worktreeMode: parts[5]
      })
      continue
    }
  }

  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0
  for (const e of entries) {
    if (e.unmerged) conflicted++
    else if (e.untracked) untracked++
    else {
      if (e.indexStatus !== '.') staged++
      if (e.worktreeStatus !== '.') unstaged++
    }
  }

  return {
    entries,
    branch,
    oid,
    detached,
    summary: {
      staged,
      unstaged,
      untracked,
      conflicted,
      hasChanges: staged + unstaged + untracked + conflicted > 0
    }
  }
}

/* ------------------------------------------------------------------- patches */

export interface ParsedPatch {
  hunks: DiffHunk[]
  binary: boolean
  submodule: boolean
  modeChange?: string
  isSymlink: boolean
  /** True when the patch had a header but produced no hunks (e.g. pure rename). */
  headerOnly: boolean
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/**
 * Parses a unified diff for a single file into structured hunks.
 *
 * Deliberately tolerant: git emits several header shapes (new file, deleted
 * file, mode change, rename, binary, submodule) and unknown ones are simply
 * skipped rather than treated as content.
 */
export function parsePatch(text: string): ParsedPatch {
  const result: ParsedPatch = {
    hunks: [],
    binary: false,
    submodule: false,
    isSymlink: false,
    headerOnly: false
  }
  if (!text) return result

  const lines = text.split('\n')
  let oldMode: string | undefined
  let newMode: string | undefined
  let current: DiffHunk | null = null
  let oldNumber = 0
  let newNumber = 0
  let sawHeader = false

  for (const line of lines) {
    if (current === null) {
      // -- header region ---------------------------------------------------
      if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
        sawHeader = true
        continue
      }
      if (line.startsWith('old mode ')) {
        oldMode = line.slice('old mode '.length).trim()
        continue
      }
      if (line.startsWith('new mode ')) {
        newMode = line.slice('new mode '.length).trim()
        continue
      }
      if (line.startsWith('new file mode ')) {
        newMode = line.slice('new file mode '.length).trim()
        continue
      }
      if (line.startsWith('deleted file mode ')) {
        oldMode = line.slice('deleted file mode '.length).trim()
        continue
      }
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        result.binary = true
        continue
      }
      if (line.startsWith('index ')) {
        // `index <old>..<new> <mode>` -- the mode is only present when unchanged.
        const mode = line.trim().split(' ')[2]
        if (mode) {
          oldMode ??= mode
          newMode ??= mode
        }
        continue
      }
    }

    const hunkMatch = HUNK_RE.exec(line)
    if (hunkMatch) {
      const oldStart = Number.parseInt(hunkMatch[1], 10)
      const oldLines = hunkMatch[2] === undefined ? 1 : Number.parseInt(hunkMatch[2], 10)
      const newStart = Number.parseInt(hunkMatch[3], 10)
      const newLines = hunkMatch[4] === undefined ? 1 : Number.parseInt(hunkMatch[4], 10)
      current = {
        header: hunkMatch[5].trim(),
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: []
      }
      result.hunks.push(current)
      oldNumber = oldStart
      newNumber = newStart
      continue
    }

    if (current === null) continue

    // -- hunk body -----------------------------------------------------------
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" refers to the line just emitted.
      const last = current.lines[current.lines.length - 1]
      if (last) last.noNewline = true
      continue
    }

    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      current.lines.push({ type: 'add', oldNumber: null, newNumber: newNumber++, content })
    } else if (marker === '-') {
      current.lines.push({ type: 'del', oldNumber: oldNumber++, newNumber: null, content })
    } else if (marker === ' ') {
      current.lines.push({ type: 'context', oldNumber: oldNumber++, newNumber: newNumber++, content })
    } else if (line === '') {
      // A trailing empty string from the final split; ignore.
      continue
    } else {
      // Anything else ends the hunk body (e.g. the next file's header).
      current = null
    }

    if (content.startsWith('Subproject commit ')) result.submodule = true
  }

  if (oldMode || newMode) {
    if (oldMode === '120000' || newMode === '120000') result.isSymlink = true
    if (oldMode && newMode && oldMode !== newMode) result.modeChange = `${oldMode} → ${newMode}`
  }
  result.headerOnly = sawHeader && result.hunks.length === 0 && !result.binary

  return result
}

/** Numbers every line of a patch that has already been split into hunks. */
export function countChanges(hunks: DiffHunk[]): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') insertions++
      else if (line.type === 'del') deletions++
    }
  }
  return { insertions, deletions }
}

export type { DiffHunk, DiffLine }
