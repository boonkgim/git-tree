import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { allDirPaths, ancestorDirPaths, buildFileTreeRows } from '@shared/filetree'
import type { ChangedFile, FileStatus } from '@shared/types'
import { activeFiles, type AppApi } from '../state/store'
import { HidePanel } from './HidePanel'
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
  clean: '·',
  ignored: '!',
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
  clean: 'Unchanged since the last commit',
  ignored: 'Ignored by .gitignore',
  unknown: 'Changed'
}

/** A file that is only on disk in some other revision cannot be dragged out. */
function onDisk(file: ChangedFile): boolean {
  return file.status !== 'deleted'
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
  const name = file.oldPath
    ? `${file.oldPath} → ${file.path}${file.score ? ` (${file.score}% similar)` : ''}`
    : file.path
  return `${name}\n${STATUS_TITLE[file.status]}`
}

function Counts({ file }: { file: ChangedFile }): JSX.Element | null {
  if (file.binary) return <span className="counts dim">bin</span>
  if (file.insertions === null && file.deletions === null) return null
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
  onOpen,
  onDrag,
  absolutePath
}: {
  file: ChangedFile
  name: string
  showDir: boolean
  indent: number
  selected: boolean
  onSelect: (path: string) => void
  onOpen: (path: string) => void
  onDrag: (path: string) => void
  absolutePath: (path: string) => string
}): JSX.Element {
  const { dir } = splitPath(file.path)
  const draggable = onDisk(file)

  return (
    <div
      className={`frow f-${file.status}${selected ? ' selected' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + indent }}
      onMouseDown={() => onSelect(file.path)}
      onDoubleClick={() => onOpen(file.path)}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return
        // The main process takes the drag over as an OS file drag, which is
        // what makes a terminal paste the path on drop. These types are set
        // first so that a target which never sees that hand-over — a plain
        // text field, an editor that only reads the clipboard flavour — still
        // gets the same path rather than nothing.
        const absolute = absolutePath(file.path)
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('text/plain', absolute)
        event.dataTransfer.setData('text/uri-list', `file://${encodeURI(absolute)}`)
        onDrag(file.path)
      }}
      title={`${rowTitle(file)}\nDouble-click to open in the default application${
        draggable ? '\nDrag onto a terminal to paste its path' : ''
      }`}
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
  ignored,
  fileCount,
  onToggle,
  onOpen,
  onDrag,
  absolutePath
}: {
  path: string
  label: string
  depth: number
  collapsed: boolean
  ignored: boolean
  fileCount: number
  onToggle: () => void
  onOpen: (path: string) => void
  onDrag: (path: string) => void
  absolutePath: (path: string) => string
}): JSX.Element {
  return (
    <div
      className={`frow drow${collapsed ? ' collapsed' : ''}${ignored ? ' dir-ignored' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
      onMouseDown={onToggle}
      // A directory is a path like any other, so it drags out like any other.
      // Folding happens on mouse-down and dragging begins after it, so the two
      // gestures do not compete: a drag leaves the row folded as it found it.
      draggable
      onDragStart={(event) => {
        const absolute = absolutePath(path)
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData('text/plain', absolute)
        event.dataTransfer.setData('text/uri-list', `file://${encodeURI(absolute)}`)
        onDrag(path)
      }}
      title={`${collapsed ? `Expand ${label}` : `Collapse ${label}`}${
        ignored ? '\nEverything in here is ignored by .gitignore' : ''
      }\nDrag onto a terminal to paste its path`}
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

/**
 * The files touched by whatever is selected in the history, or — in the
 * all-files scope — every file in the working tree, the way an editor's project
 * pane lists them.
 */
export function FilesPanel({ api }: { api: AppApi }): JSX.Element {
  const {
    state,
    selectFile,
    setFilesView,
    setFilesScope,
    setShowIgnored,
    openInWorkingTree,
    startDrag,
    absolutePath,
    retryFiles
  } = api
  const all = state.filesScope === 'all'
  const files = activeFiles(state)
  const tree = state.filesView === 'tree'

  const loading = all ? state.workingFilesLoading : state.filesLoading
  const error = all ? state.workingFilesError : state.filesError
  const notes = (all ? state.workingFiles?.notes : state.files?.notes) ?? []
  const truncated = (all ? state.workingFiles?.truncated : state.files?.truncated) ?? false

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
          onDrag={startDrag}
          absolutePath={absolutePath}
        />
      )
    },
    [files, state.selectedPath, selectFile, openInWorkingTree, startDrag, absolutePath]
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
            ignored={row.ignored}
            fileCount={row.fileCount}
            onToggle={() => toggleDir(row.path)}
            onOpen={openInWorkingTree}
            onDrag={startDrag}
            absolutePath={absolutePath}
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
          onDrag={startDrag}
          absolutePath={absolutePath}
        />
      )
    },
    [rows, state.selectedPath, selectFile, toggleDir, openInWorkingTree, startDrag, absolutePath]
  )

  const empty = error ? (
    <div className="files-error">
      <p className="error-text">{error.message}</p>
      {error.detail && <p className="dim small">{error.detail}</p>}
      <button type="button" onClick={retryFiles}>
        Try again
      </button>
    </div>
  ) : loading ? (
    <p className="dim">Reading…</p>
  ) : all ? (
    <p className="dim">This working tree has no files in it.</p>
  ) : state.files?.spec.mode === 'empty' ? (
    <p className="dim">{state.files.label}</p>
  ) : (
    <p className="dim">No files changed in this comparison.</p>
  )

  return (
    <section className="panel panel-files">
      <header className="panel-head">
        <span className="panel-title">{all ? 'All files' : 'Changed files'}</span>
        <span className="dim">
          {files.length.toLocaleString()}
          {truncated ? '+' : ''}
        </span>
        <div className="grow" />

        {all && (
          <button
            type="button"
            className={`link icon-button${state.showIgnored ? ' on' : ' dim'}`}
            aria-pressed={state.showIgnored}
            onClick={() => setShowIgnored(!state.showIgnored)}
            title={
              state.showIgnored
                ? 'Stop listing files ignored by .gitignore'
                : 'List files ignored by .gitignore too'
            }
          >
            !
          </button>
        )}

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

        <div className="segmented" role="group" aria-label="Which files are listed">
          <button
            type="button"
            className={all ? '' : 'on'}
            aria-pressed={!all}
            onClick={() => setFilesScope('changed')}
            title="Only the files this comparison touched"
          >
            Changed
          </button>
          <button
            type="button"
            className={all ? 'on' : ''}
            aria-pressed={all}
            onClick={() => setFilesScope('all')}
            title="Every file in the working tree, including untracked ones"
          >
            All
          </button>
        </div>

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
        <HidePanel api={api} panel="files" />
      </header>
      {notes.map((note) => (
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
