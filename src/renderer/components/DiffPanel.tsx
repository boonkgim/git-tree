import { useCallback, useMemo, useState } from 'react'
import { mediaTypeForPath } from '@shared/media'
import type { DiffHunk, DiffLine, FilePatch, MediaPreview, MediaSide } from '@shared/types'
import type { AppApi } from '../state/store'
import { VirtualList } from './VirtualList'

const ROW_HEIGHT = 18

type DiffRow = { kind: 'hunk'; hunk: DiffHunk } | { kind: 'line'; line: DiffLine }

/** Flattens hunks into a single addressable row list for windowing. */
function flatten(patch: FilePatch | null): DiffRow[] {
  if (!patch) return []
  const rows: DiffRow[] = []
  for (const hunk of patch.hunks) {
    rows.push({ kind: 'hunk', hunk })
    for (const line of hunk.lines) rows.push({ kind: 'line', line })
  }
  return rows
}

/**
 * Splits a line into plain and emphasised segments using the ranges the word
 * diff produced. Ranges are non-overlapping and sorted, so one pass is enough.
 */
function segments(line: DiffLine): Array<{ text: string; strong: boolean }> {
  const ranges = line.highlights
  if (!ranges || ranges.length === 0) return [{ text: line.content, strong: false }]

  const out: Array<{ text: string; strong: boolean }> = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) out.push({ text: line.content.slice(cursor, start), strong: false })
    out.push({ text: line.content.slice(start, end), strong: true })
    cursor = end
  }
  if (cursor < line.content.length) out.push({ text: line.content.slice(cursor), strong: false })
  return out
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * One side of a media file. Image dimensions are read off the element once it
 * has loaded, because they are the thing a reader is usually comparing.
 *
 * Only a side that exists is ever rendered: an added file has no "before" to
 * draw, and an empty frame beside the new picture would be a placeholder for
 * something that was never there.
 */
function MediaPane({
  label,
  side,
  media
}: {
  label: string
  side: MediaSide
  media: MediaPreview
}): JSX.Element {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  return (
    <figure className="media-pane">
      <figcaption className="media-label">
        <span className="dim">{label}</span>
        {side.present && <span className="mono">{formatBytes(side.bytes)}</span>}
        {size && (
          <span className="mono dim">
            {size.width} × {size.height}
          </span>
        )}
      </figcaption>

      {!side.dataUrl ? (
        <p className="dim media-absent">Not shown.</p>
      ) : media.kind === 'image' ? (
        <div className="media-frame">
          <img
            src={side.dataUrl}
            alt={`${label}: ${media.path}`}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              })
            }
          />
        </div>
      ) : media.kind === 'video' ? (
        <div className="media-frame">
          <video
            src={side.dataUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) =>
              setSize({
                width: event.currentTarget.videoWidth,
                height: event.currentTarget.videoHeight
              })
            }
          />
        </div>
      ) : (
        <audio src={side.dataUrl} controls preload="metadata" />
      )}
    </figure>
  )
}

/**
 * The diff for the selected file.
 *
 * Unified rather than side-by-side: it wastes no horizontal space on a panel
 * that already shares the window with three others, and it is the layout most
 * people read diffs in. Intra-line highlighting supplies the precision that
 * side-by-side would otherwise give.
 */
export function DiffPanel({ api }: { api: AppApi }): JSX.Element {
  const { state, setParentIndex, setDiffOptions, loadAnyway } = api
  const patch = state.patch
  const rows = useMemo(() => flatten(patch), [patch])
  const spec = state.files?.spec

  // A displayable file gets its two sides shown instead of — or, for an SVG,
  // above — the textual diff. `state.media` can belong to the file that was
  // selected a moment ago, so it is matched against the current path.
  const mediaType = state.selectedPath ? mediaTypeForPath(state.selectedPath) : null
  const media = state.media?.path === state.selectedPath ? state.media : null
  const previewing = mediaType !== null && (media !== null || state.mediaLoading)
  const binary = patch?.kind === 'binary' || patch?.kind === 'untracked-binary'

  const renderRow = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return null
      if (row.kind === 'hunk') {
        return (
          <div className="dline dline-hunk" style={{ height: ROW_HEIGHT }} key={`h${index}`}>
            <span className="dnum dnum-old" />
            <span className="dnum dnum-new" />
            <span className="dtext">
              @@ −{row.hunk.oldStart},{row.hunk.oldLines} +{row.hunk.newStart},{row.hunk.newLines} @@
              {row.hunk.header ? ` ${row.hunk.header}` : ''}
            </span>
          </div>
        )
      }
      const { line } = row
      return (
        <div className={`dline dline-${line.type}`} style={{ height: ROW_HEIGHT }} key={`l${index}`}>
          <span className="dnum dnum-old">{line.oldNumber ?? ''}</span>
          <span className="dnum dnum-new">{line.newNumber ?? ''}</span>
          <span className="dmark">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>
          <span className="dtext">
            {segments(line).map((segment, i) =>
              segment.strong ? (
                <mark key={i} className="intraline">
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              )
            )}
            {line.noNewline && <span className="no-newline"> ⏎ no newline at end of file</span>}
          </span>
        </div>
      )
    },
    [rows]
  )

  const contextValue = state.diff.context === 'all' ? 'all' : String(state.diff.context)

  return (
    <section className="panel panel-diff">
      <header className="panel-head">
        <span className="panel-title">Diff</span>
        <span className="comparison-inline" title={state.files?.label}>
          {state.files?.label ?? ''}
        </span>
        <div className="grow" />

        {spec?.mode === 'commit' && spec.parents.length > 1 && (
          <label className="control">
            Parent
            <select
              value={state.parentIndex}
              onChange={(e) => setParentIndex(Number(e.target.value))}
            >
              {spec.parents.map((parent, i) => (
                <option key={parent} value={i}>
                  {i + 1}: {parent.slice(0, 7)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="control">
          Context
          <select
            value={contextValue}
            onChange={(e) =>
              setDiffOptions({
                context: e.target.value === 'all' ? 'all' : Number(e.target.value)
              })
            }
          >
            <option value="3">3</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="all">Whole file</option>
          </select>
        </label>

        <label className="control control-check">
          <input
            type="checkbox"
            checked={state.diff.ignoreWhitespace}
            onChange={(e) => setDiffOptions({ ignoreWhitespace: e.target.checked })}
          />
          Ignore whitespace
        </label>
      </header>

      {state.selectedPath && (
        <div className="diff-file">
          <span className="mono">{state.selectedPath}</span>
          {patch?.oldPath && <span className="dim"> ← {patch.oldPath}</span>}
          {patch?.modeChange && <span className="chip">mode {patch.modeChange}</span>}
          {patch?.isSymlink && <span className="chip">symlink</span>}
          {patch?.kind === 'submodule' && <span className="chip">submodule</span>}
          {patch && patch.kind === 'text' && (
            <span className="counts">
              {patch.insertions > 0 && <span className="plus">+{patch.insertions}</span>}
              {patch.deletions > 0 && <span className="minus">−{patch.deletions}</span>}
            </span>
          )}
        </div>
      )}

      {patch?.notes.map((note) => (
        <p className="note" key={note}>
          {note}
        </p>
      ))}

      {state.patchError && <p className="error-text">{state.patchError.message}</p>}

      {patch?.kind === 'too-large' && (
        <p className="note">
          <button type="button" onClick={loadAnyway}>
            Show it anyway
          </button>
        </p>
      )}

      {binary && !previewing && (
        <div className="binary-info">
          <div>Before: {formatBytes(patch.oldSize)}</div>
          <div>After: {formatBytes(patch.newSize)}</div>
        </div>
      )}

      {mediaType && state.mediaError && (
        <p className="error-text">{state.mediaError.message}</p>
      )}

      {previewing && (
        <div className={`media-body${binary ? ' media-only' : ''}`}>
          {media ? (
            <>
              {media.notes.map((note) => (
                <p className="note" key={note}>
                  {note}
                </p>
              ))}
              <div className="media-sides">
                {media.before.present && (
                  <MediaPane
                    label={media.after.present ? 'Before' : 'Deleted — the last version'}
                    side={media.before}
                    media={media}
                  />
                )}
                {media.after.present && (
                  <MediaPane
                    label={media.before.present ? 'After' : 'Added — there is no earlier version'}
                    side={media.after}
                    media={media}
                  />
                )}
                {!media.before.present && !media.after.present && (
                  <p className="dim">Nothing to preview in this comparison.</p>
                )}
              </div>
            </>
          ) : (
            <p className="dim">Reading preview…</p>
          )}
        </div>
      )}

      {!(previewing && binary) && (
        <VirtualList
          count={rows.length}
          rowHeight={ROW_HEIGHT}
          className="diff-body"
          empty={
            state.patchLoading ? (
              <p className="dim">Reading diff…</p>
            ) : !state.selectedPath ? (
              <p className="dim">Select a file to see its diff.</p>
            ) : patch ? null : (
              <p className="dim">No diff to show.</p>
            )
          }
        >
          {renderRow}
        </VirtualList>
      )}
    </section>
  )
}
