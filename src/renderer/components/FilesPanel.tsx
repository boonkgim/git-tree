import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { allDirPaths, ancestorDirPaths, buildFileTreeRows } from '@shared/filetree'
import type { ChangedFile, FileStatus } from '@shared/types'
import type { AppApi } from '../state/store'
import { VirtualList } from './VirtualList'

const ROW_HEIGHT = 22
/** Indentation per tree level, in px. */
const INDENT = 13

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

function rowTitle(file: ChangedFile): string {
  return file.oldPath
    ? `${file.oldPath} → ${file.path}${file.score ? ` (${file.score}% similar)` : ''}`
    : file.path
}

function Counts({ file }: { file: ChangedFile }): JSX.Element {
  if (file.binary) return <span className="counts dim">bin</span>
  return (
    <span className="counts">
      {file.insertions ? <span className="plus">+{file.insertions}</span> : null}
      {file.deletions ? <span className="minus">−{file.deletions}</span> : null}
    </span>
  )
}

function FileRow({
  file,
  /** The part of the path to show; the tree view has already spent the rest on indentation. */
  name,
  showDir,
  indent,
  selected,
  onSelect,
  onOpen
}: {
  file: ChangedFile
  name: string
  showDir: boolean
  indent: number
  selected: boolean
  onSelect: (path: string) => void
  onOpen: (path: string) => void
}): JSX.Element {
  const { dir } = splitPath(file.path)

  return (
    <div
      className={`frow${selected ? ' selected' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + indent }}
      onMouseDown={() => onSelect(file.path)}
      onDoubleClick={() => onOpen(file.path)}
      title={`${rowTitle(file)}\nDouble-click to open in the default application`}
    >
      <span className={`status status-${file.status}`} title={STATUS_TITLE[file.status]}>
        {STATUS_LETTER[file.status]}
      </span>
      <span className="fpath">
        {showDir && dir && <span className="dim">{dir}</span>}
        <span className="fname">{name}</span>
        {file.oldPath && <span className="dim renamed-from"> ← {file.oldPath}</span>}
      </span>
      <Counts file={file} />
    </div>
  )
}

/** A small folder glyph, drawn rather than typed so it looks the same everywhere. */
function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        d="M1.4 12.4V3.6h4.2l1.4 1.6h7.6v7.2z"
      />
    </svg>
  )
}

function DirRow({
  path,
  label,
  depth,
  collapsed,
  fileCount,
  onToggle,
  onOpen
}: {
  path: string
  label: string
  depth: number
  collapsed: boolean
  fileCount: number
  onToggle: () => void
  onOpen: (path: string) => void
}): JSX.Element {
  return (
    <div
      className={`frow drow${collapsed ? ' collapsed' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
      onMouseDown={onToggle}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
    >
      <span className="twisty">{collapsed ? '▸' : '▾'}</span>
      <span className="dname">{label}</span>
      {collapsed && <span className="counts dim">{fileCount}</span>}
      <button
        type="button"
        className="open-folder"
        title={`Open ${path} in the default file manager`}
        aria-label={`Open ${path} in the default file manager`}
        // The row itself folds on mouse-down, so the button has to claim the
        // event before that happens.
        onMouseDown={(event) => {
          event.stopPropagation()
          event.preventDefault()
        }}
        onClick={(event) => {
          event.stopPropagation()
          onOpen(path)
        }}
      >
        <FolderIcon />
      </button>
    </div>
  )
}

/** The files touched by whatever is selected in the history. */
export function FilesPanel({ api }: { api: AppApi }): JSX.Element {
  const { state, selectFile, setFilesView, openInWorkingTree } = api
  const files = state.files?.files ?? []
  const tree = state.filesView === 'tree'

  // Which directories are folded shut. Keyed by path, so it survives switching
  // commits: the directories a user has chosen to ignore are usually the same
  // ones in the next comparison.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const toggleDir = useCallback((path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  const rows = useMemo(
    () => (tree ? buildFileTreeRows(files, collapsed) : []),
    [tree, files, collapsed]
  )

  // Reveal the selected file when the *selection* moves, but never in reaction
  // to the collapsed set itself — otherwise collapsing the directory the
  // selected file sits in would spring straight back open.
  const revealedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!tree || !state.selectedPath) return
    if (revealedFor.current === state.selectedPath) return
    revealedFor.current = state.selectedPath
    const ancestors = ancestorDirPaths(files, state.selectedPath)
    if (ancestors.length === 0) return
    setCollapsed((previous) => {
      if (!ancestors.some((dir) => previous.has(dir))) return previous
      const next = new Set(previous)
      for (const dir of ancestors) next.delete(dir)
      return next
    })
  }, [tree, state.selectedPath, files])

  const selectedIndex = useMemo(() => {
    if (!state.selectedPath) return null
    if (!tree) return files.findIndex((file) => file.path === state.selectedPath)
    return rows.findIndex((row) => row.kind === 'file' && row.file.path === state.selectedPath)
  }, [tree, rows, files, state.selectedPath])

  // The file rows the arrow keys walk, in the order they are painted: in tree
  // view that skips directory rows and anything folded away inside them.
  const filePaths = useMemo(
    () =>
      tree
        ? rows.flatMap((row) => (row.kind === 'file' ? [row.file.path] : []))
        : files.map((file) => file.path),
    [tree, rows, files]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (filePaths.length === 0) return
      event.preventDefault()
      const down = event.key === 'ArrowDown'
      const current = state.selectedPath ? filePaths.indexOf(state.selectedPath) : -1
      // With nothing selected — or with the selected file hidden inside a folded
      // directory — the first press lands on the near end of the list.
      const next =
        current === -1
          ? down
            ? 0
            : filePaths.length - 1
          : Math.min(Math.max(current + (down ? 1 : -1), 0), filePaths.length - 1)
      selectFile(filePaths[next])
    },
    [filePaths, state.selectedPath, selectFile]
  )

  const anyExpanded = useMemo(
    () => (tree ? rows.some((row) => row.kind === 'dir' && !row.collapsed) : false),
    [tree, rows]
  )

  const toggleAll = useCallback(() => {
    setCollapsed(anyExpanded ? new Set(allDirPaths(files)) : new Set())
  }, [anyExpanded, files])

  const renderFlatRow = useCallback(
    (index: number) => {
      const file = files[index]
      if (!file) return null
      return (
        <FileRow
          key={file.path}
          file={file}
          name={splitPath(file.path).name}
          showDir
          indent={0}
          selected={file.path === state.selectedPath}
          onSelect={selectFile}
          onOpen={openInWorkingTree}
        />
      )
    },
    [files, state.selectedPath, selectFile, openInWorkingTree]
  )

  const renderTreeRow = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return null
      if (row.kind === 'dir') {
        return (
          <DirRow
            key={`d:${row.path}`}
            path={row.path}
            label={row.label}
            depth={row.depth}
            collapsed={row.collapsed}
            fileCount={row.fileCount}
            onToggle={() => toggleDir(row.path)}
            onOpen={openInWorkingTree}
          />
        )
      }
      return (
        <FileRow
          key={`f:${row.file.path}`}
          file={row.file}
          name={row.name}
          showDir={false}
          indent={row.depth * INDENT}
          selected={row.file.path === state.selectedPath}
          onSelect={selectFile}
          onOpen={openInWorkingTree}
        />
      )
    },
    [rows, state.selectedPath, selectFile, toggleDir, openInWorkingTree]
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
        <div className="grow" />

        {tree && files.length > 0 && (
          <button
            type="button"
            className="link dim icon-button"
            onClick={toggleAll}
            title={anyExpanded ? 'Collapse all folders' : 'Expand all folders'}
          >
            {anyExpanded ? '⊟' : '⊞'}
          </button>
        )}

        <div className="segmented" role="group" aria-label="Changed-file layout">
          <button
            type="button"
            className={tree ? '' : 'on'}
            aria-pressed={!tree}
            onClick={() => setFilesView('flat')}
            title="One row per file, in git's order"
          >
            Flat
          </button>
          <button
            type="button"
            className={tree ? 'on' : ''}
            aria-pressed={tree}
            onClick={() => setFilesView('tree')}
            title="Grouped by directory"
          >
            Tree
          </button>
        </div>
      </header>
      {state.files?.notes.map((note) => (
        <p className="note" key={note}>
          {note}
        </p>
      ))}
      {state.openNote && <p className="note">{state.openNote}</p>}
      <div className="files-body" tabIndex={0} onKeyDown={onKeyDown}>
        <VirtualList
          count={tree ? rows.length : files.length}
          rowHeight={ROW_HEIGHT}
          scrollToIndex={selectedIndex}
          empty={empty}
        >
          {tree ? renderTreeRow : renderFlatRow}
        </VirtualList>
      </div>
    </section>
  )
}
