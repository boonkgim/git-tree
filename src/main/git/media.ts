import { readFile, stat } from 'node:fs/promises'
import type { ChangedFile, MediaPreview, MediaSide, Selection } from '@shared/types'
import { mediaTypeForPath } from '@shared/media'
import { GitError, runGit, runGitBuffer } from './exec'
import { resolve } from './files'
import type { RepoSession } from './repo'
import { resolveInsideRoot } from '../open'

/**
 * The most an image, video or sound is inlined at.
 *
 * The bytes cross the IPC boundary as a `data:` URL, so they are held twice —
 * once in each process — and base64 adds a third. Eight megabytes covers every
 * icon, screenshot and short clip a repository realistically carries; past that
 * the panel says how big the file is instead, which is what it did before
 * previews existed.
 */
const PREVIEW_LIMIT = 8 * 1024 * 1024

const ABSENT: MediaSide = { present: false, bytes: null, dataUrl: null }

export interface MediaRequest {
  selection: Selection
  parentIndex: number
  file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>
}

/**
 * Both sides of a comparison for one media file, ready to be displayed.
 *
 * "Before" is the file as of the base of the comparison and "after" is the file
 * as of its target — for a comparison against the working tree, that is what is
 * on disk now. A side the file does not exist on comes back absent rather than
 * empty, so an added or deleted image reads as one picture and a statement,
 * not as a broken frame.
 */
export async function mediaPreview(
  session: RepoSession,
  request: MediaRequest
): Promise<MediaPreview> {
  const { file } = request
  const type = mediaTypeForPath(file.path)
  if (!type) {
    throw new GitError({
      code: 'UNREADABLE',
      message: `${file.path} is not a format this application can display.`
    })
  }

  const cwd = session.info.root
  const { spec } = await resolve(session, request.selection, request.parentIndex)
  const notes: string[] = []

  const before =
    spec.mode === 'empty' || file.untracked || file.status === 'added'
      ? ABSENT
      : await sideAt(cwd, spec.base, file.oldPath ?? file.path, type.mime, notes, 'Before')

  const after =
    spec.mode === 'empty' || file.status === 'deleted'
      ? ABSENT
      : spec.mode === 'working'
        ? await sideOnDisk(cwd, file.path, type.mime, notes)
        : await sideAt(cwd, spec.target, file.path, type.mime, notes, 'After')

  return { path: file.path, kind: type.kind, mime: type.mime, before, after, notes }
}

/** One side, read out of the object store at `rev`. */
async function sideAt(
  cwd: string,
  rev: string,
  path: string,
  mime: string,
  notes: string[],
  label: string
): Promise<MediaSide> {
  const bytes = await blobSize(cwd, rev, path)
  if (bytes === null) return ABSENT
  if (bytes > PREVIEW_LIMIT) {
    notes.push(overLimit(label, bytes))
    return { present: true, bytes, dataUrl: null }
  }

  try {
    const { stdout } = await runGitBuffer(cwd, ['cat-file', 'blob', `${rev}:${path}`], {
      maxBuffer: PREVIEW_LIMIT
    })
    return { present: true, bytes, dataUrl: toDataUrl(mime, stdout) }
  } catch {
    notes.push(`${label}: this version could not be read out of the repository.`)
    return { present: true, bytes, dataUrl: null }
  }
}

/** One side, read from the working tree — the only place "now" exists. */
async function sideOnDisk(
  cwd: string,
  path: string,
  mime: string,
  notes: string[]
): Promise<MediaSide> {
  // The path comes from git's own file list, but this reads the filesystem, so
  // it is held to the same containment rule as everything else that does.
  const full = resolveInsideRoot(cwd, path)
  let bytes: number
  try {
    bytes = (await stat(full)).size
  } catch {
    return ABSENT
  }
  if (bytes > PREVIEW_LIMIT) {
    notes.push(overLimit('After', bytes))
    return { present: true, bytes, dataUrl: null }
  }
  try {
    return { present: true, bytes, dataUrl: toDataUrl(mime, await readFile(full)) }
  } catch {
    notes.push('After: this file could not be read from the working tree.')
    return { present: true, bytes, dataUrl: null }
  }
}

function overLimit(label: string, bytes: number): string {
  return `${label}: ${Math.round(bytes / 1024 / 1024)} MB is over the ${
    PREVIEW_LIMIT / 1024 / 1024
  } MB preview limit, so it is not shown.`
}

function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
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