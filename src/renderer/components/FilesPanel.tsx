import { useCallback } from 'react'
import type { ChangedFile, FileStatus } from '@shared/types'
import type { AppApi } from '../state/store'
import { VirtualList } from './VirtualList'

const ROW_HEIGHT = 22

const STATUS_LETTER: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unmerged: 'U',
  untracked: '?',
  unknown: '·'
}

const STATUS_TITLE: Record<FileStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type changed',
  unmerged: 'Unresolved conflict',
  untracked: 'Untracked',
  unknown: 'Changed'
}

function splitPath(path: string): { dir: string; name: string } {
  // Paths from git are always '/'-separated regardless of platform, so this is
  // safe on Windows too.
  const index = path.lastIndexOf('/')
  return index === -1
    ? { dir: '', name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}

function FileRow({
  file,
  selected,
  onSelect
}: {
  file: ChangedFile
  selected: boolean
  onSelect: (path: string) => void
}): JSX.Element {
  const { dir, name } = splitPath(file.path)
  const renamedFrom = file.oldPath ? splitPath(file.oldPath) : null

  return (
    <div
      className={`frow${selected ? ' selected' : ''}`}
      style={{ height: ROW_HEIGHT }}
      onMouseDown={() => onSelect(file.path)}
      title={
        renamedFrom
          ? `${file.oldPath} → ${file.path}${file.score ? ` (${file.score}% similar)` : ''}`
          : file.path
      }
    >
      <span className={`status status-${file.status}`} title={STATUS_TITLE[file.status]}>
        {STATUS_LETTER[file.status]}
      </span>
      <span className="fpath">
        {dir && <span className="dim">{dir}</span>}
        <span className="fname">{name}</span>
        {renamedFrom && <span className="dim renamed-from"> ← {file.oldPath}</span>}
      </span>
      {file.binary ? (
        <span className="counts dim">bin</span>
      ) : (
        <span className="counts">
          {file.insertions ? <span className="plus">+{file.insertions}</span> : null}
          {file.deletions ? <span className="minus">−{file.deletions}</span> : null}
        </span>
      )}
    </div>
  )
}

/** The files touched by whatever is selected in the history. */
export function FilesPanel({ api }: { api: AppApi }): JSX.Element {
  const { state, selectFile } = api
  const files = state.files?.files ?? []

  const renderRow = useCallback(
    (index: number) => {
      const file = files[index]
      if (!file) return null
      return (
        <FileRow
          key={file.path}
          file={file}
          selected={file.path === state.selectedPath}
          onSelect={selectFile}
        />
      )
    },
    [files, state.selectedPath, selectFile]
  )

  const empty = state.filesError ? (
    <p className="error-text">{state.filesError.message}</p>
  ) : state.filesLoading ? (
    <p className="dim">Reading…</p>
  ) : state.files?.spec.mode === 'empty' ? (
    <p className="dim">{state.files.label}</p>
  ) : (
    <p className="dim">No files changed in this comparison.</p>
  )

  return (
    <section className="panel panel-files">
      <header className="panel-head">
        <span className="panel-title">Changed files</span>
        <span className="dim">
          {files.length.toLocaleString()}
          {state.files?.truncated ? '+' : ''}
        </span>
      </header>
      {state.files?.notes.map((note) => (
        <p className="note" key={note}>
          {note}
        </p>
      ))}
      <VirtualList count={files.length} rowHeight={ROW_HEIGHT} empty={empty}>
        {renderRow}
      </VirtualList>
    </section>
  )
}
