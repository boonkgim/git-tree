import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ChangedFile,
  DiffOptions,
  DiffSpec,
  FilePatch,
  PatchKind,
  Selection
} from '@shared/types'
import { mediaTypeForPath } from '@shared/media'
import { wordDiff } from '@shared/worddiff'
import { decodeUtf8, runGit } from './exec'
import { countChanges, parsePatch } from './parse'
import type { RepoSession } from './repo'
import { buildDiffArgs, buildUntrackedPatchArgs } from './selection'
import { resolve } from './files'
import { resolveInsideRoot } from '../open'

/**
 * Above this many bytes a patch is not worth rendering: the file is almost
 * certainly generated, and turning megabytes of text into DOM nodes would lock
 * the window. The user is told, and can ask for it anyway.
 */
const PATCH_SOFT_LIMIT = 2 * 1024 * 1024
const PATCH_HARD_LIMIT = 64 * 1024 * 1024

export interface PatchRequest {
  selection: Selection
  parentIndex: number
  file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>
  options: DiffOptions
  /** Set once the user has accepted the cost of a very large patch. */
  force?: boolean
}

/** Size of a file on disk, or null when it is not there. */
async function diskSize(cwd: string, relPath: string): Promise<number | null> {
  try {
    const { size } = await stat(join(cwd, relPath))
    return size
  } catch {
    return null
  }
}

/** Size of a blob at a revision, or null when it is absent there. */
async function blobSize(cwd: string, rev: string, path: string): Promise<number | null> {
  try {
    const { stdout } = await runGit(cwd, ['cat-file', '-s', `${rev}:${path}`])
    const size = Number.parseInt(stdout.trim(), 10)
    return Number.isNaN(size) ? null : size
  } catch {
    return null
  }
}

/**
 * Adds intra-line highlight ranges to runs of deleted lines immediately
 * followed by the same number of added lines. Restricting it to balanced runs
 * keeps the pairing unambiguous, which is what makes the highlighting readable
 * rather than arbitrary.
 */
function highlightPairs(hunks: FilePatch['hunks']): void {
  for (const hunk of hunks) {
    const lines = hunk.lines
    let i = 0
    while (i < lines.length) {
      if (lines[i].type !== 'del') {
        i++
        continue
      }
      let delEnd = i
      while (delEnd < lines.length && lines[delEnd].type === 'del') delEnd++
      let addEnd = delEnd
      while (addEnd < lines.length && lines[addEnd].type === 'add') addEnd++

      const delCount = delEnd - i
      const addCount = addEnd - delEnd
      if (delCount === addCount && delCount > 0 && delCount <= 200) {
        for (let k = 0; k < delCount; k++) {
          const before = lines[i + k]
          const after = lines[delEnd + k]
          const { del, add } = wordDiff(before.content, after.content)
          if (del.length) before.highlights = del
          if (add.length) after.highlights = add
        }
      }
      i = addEnd > i ? addEnd : i + 1
    }
  }
}

/**
 * The patch for one file within a comparison.
 *
 * Every degradation case ends up here, and each one produces a specific `kind`
 * that the renderer can state plainly rather than showing an empty pane.
 */
export async function filePatch(session: RepoSession, request: PatchRequest): Promise<FilePatch> {
  const cwd = session.info.root
  const { spec } = await resolve(session, request.selection, request.parentIndex)
  const { file, options } = request

  const base: FilePatch = {
    path: file.path,
    oldPath: file.oldPath,
    kind: 'empty',
    status: file.status,
    hunks: [],
    isSymlink: false,
    nonUtf8: false,
    oldSize: null,
    newSize: null,
    insertions: 0,
    deletions: 0,
    notes: [],
    expandable: options.context !== 'all'
  }

  const limit = request.force ? PATCH_HARD_LIMIT : PATCH_SOFT_LIMIT

  // A file the all-files view listed but this comparison never touched has no
  // diff to show, and "no changes" is a poor answer to a click in a project
  // pane. Show the file itself instead: the same reader, every line as context.
  //
  // This is decided before the comparison is: in a clean working tree the spec
  // is `empty`, and "there is nothing to compare" is not an answer to a click
  // on a file that is sitting right there on disk.
  if (file.status === 'clean' || file.status === 'ignored') {
    return fileContents(cwd, base, file.path, limit)
  }

  if (spec.mode === 'empty') {
    return { ...base, notes: [spec.reason] }
  }

  let stdout: string
  let nonUtf8 = false
  let truncated = false

  try {
    if (file.untracked) {
      // An untracked file is in no tree, so `git diff` has nothing to name it
      // with. `--no-index` compares it against /dev/null and exits 1 because
      // the two differ, which is the expected outcome here.
      const result = await runGit(cwd, buildUntrackedPatchArgs(file.path, options), {
        maxBuffer: limit,
        okExitCodes: [0, 1]
      })
      stdout = result.stdout
      nonUtf8 = result.nonUtf8
      truncated = result.truncated
    } else {
      const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
      const result = await runGit(cwd, buildDiffArgs(spec, 'patch', options, paths), {
        maxBuffer: limit
      })
      stdout = result.stdout
      nonUtf8 = result.nonUtf8
      truncated = result.truncated
    }
  } catch (e) {
    return {
      ...base,
      notes: [e instanceof Error ? e.message : String(e)]
    }
  }

  if (truncated) {
    return {
      ...base,
      kind: 'too-large',
      notes: [
        `This diff is larger than ${Math.round(limit / 1024 / 1024)} MB and was not rendered.`
      ]
    }
  }

  const parsed = parsePatch(stdout)
  const notes: string[] = []
  let kind: PatchKind = 'text'

  if (parsed.binary) {
    kind = file.untracked ? 'untracked-binary' : 'binary'
  } else if (parsed.submodule) {
    kind = 'submodule'
  } else if (parsed.hunks.length === 0) {
    kind = 'empty'
    if (parsed.headerOnly) {
      notes.push(
        file.status === 'renamed'
          ? 'The file was renamed; its contents are unchanged.'
          : 'The file metadata changed but its contents did not.'
      )
    } else if (options.ignoreWhitespace) {
      notes.push('Only whitespace changed, and whitespace is being ignored.')
    } else {
      notes.push('No textual changes in this comparison.')
    }
  }

  if (nonUtf8) {
    notes.push(
      'This file is not valid UTF-8. Invalid bytes are shown as \u{FFFD} so the rest stays readable.'
    )
  }
  if (parsed.isSymlink) {
    notes.push('This is a symbolic link; the diff shows the path it points at.')
  }
  if (kind === 'submodule') {
    notes.push('This is a submodule; only the commit it points at is recorded here.')
  }

  // Sizes are only worth fetching when there is nothing else to show.
  let oldSize: number | null = null
  let newSize: number | null = null
  if (kind === 'binary' || kind === 'untracked-binary') {
    oldSize = file.untracked ? null : await blobSize(cwd, spec.base, file.oldPath ?? file.path)
    newSize =
      spec.mode === 'working'
        ? await diskSize(cwd, file.path)
        : await blobSize(cwd, spec.target, file.path)
    notes.push(
      mediaTypeForPath(file.path)
        ? 'Binary file — shown below as a preview of each side, since a byte diff says nothing.'
        : 'Binary file — contents are not shown.'
    )
  }

  if (kind === 'text') highlightPairs(parsed.hunks)
  const { insertions, deletions } = countChanges(parsed.hunks)

  return {
    ...base,
    kind,
    hunks: parsed.hunks,
    modeChange: parsed.modeChange,
    isSymlink: parsed.isSymlink,
    nonUtf8,
    oldSize,
    newSize,
    notes,
    insertions,
    deletions,
    expandable: options.context !== 'all' && kind === 'text' && parsed.hunks.length > 0
  }
}

export type { DiffSpec }

/**
 * The working-tree file, rendered as a patch of nothing but context lines.
 *
 * Still a read of the file the user can already see in their editor, and still
 * bounded by the same size limit as a diff: a project pane must not be able to
 * turn a click on a 200 MB asset into a frozen window.
 */
async function fileContents(
  cwd: string,
  base: FilePatch,
  path: string,
  limit: number
): Promise<FilePatch> {
  const target = resolveInsideRoot(cwd, path)

  let bytes: Buffer
  let size: number | null
  try {
    size = await diskSize(cwd, path)
    if (size !== null && size > limit) {
      return {
        ...base,
        kind: 'too-large',
        newSize: size,
        notes: [
          `This file is larger than ${Math.round(limit / 1024 / 1024)} MB and was not rendered.`
        ]
      }
    }
    bytes = await readFile(target)
  } catch {
    return {
      ...base,
      notes: [`${path} could not be read from the working tree.`]
    }
  }

  const unchanged = 'Unchanged in this comparison — showing the file as it is on disk.'

  // A NUL in the first few kilobytes is what git itself treats as "binary", and
  // it is the only test that does not require decoding the whole file first.
  if (bytes.subarray(0, 8000).includes(0)) {
    return {
      ...base,
      kind: 'binary',
      newSize: size,
      notes: [
        unchanged,
        mediaTypeForPath(path)
          ? 'Binary file — shown below as a preview.'
          : 'Binary file — contents are not shown.'
      ]
    }
  }

  const { text, nonUtf8 } = decodeUtf8(bytes)
  // A trailing newline ends the last line rather than starting an empty one.
  const content = text.endsWith('\n') ? text.slice(0, -1) : text
  const lines = content === '' ? [] : content.split('\n')

  const notes = [unchanged]
  if (nonUtf8) {
    notes.push(
      'This file is not valid UTF-8. Invalid bytes are shown as \u{FFFD} so the rest stays readable.'
    )
  }

  return {
    ...base,
    kind: 'contents',
    newSize: size,
    hunks:
      lines.length === 0
        ? []
        : [
            {
              header: '',
              oldStart: 1,
              oldLines: lines.length,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map((line, i) => ({
                type: 'context' as const,
                oldNumber: i + 1,
                newNumber: i + 1,
                content: line
              }))
            }
          ],
    notes,
    nonUtf8,
    expandable: false
  }
}
