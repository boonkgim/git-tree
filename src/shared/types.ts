/**
 * The only data shapes that cross the main <-> renderer boundary.
 * Everything here is plain JSON: no handles, no functions, no Buffers.
 */

/* ---------------------------------------------------------------- selection */

/** A row in the history list: either a real commit or the synthetic working-tree node. */
export type HistoryNode = { kind: 'commit'; sha: string } | { kind: 'working' }

/**
 * What the user has picked in the history list.
 *
 * `anchor` is the pinned end of the comparison; `other` is the end that a
 * Ctrl/Cmd+Click moves. Storing it this way makes the selection inherently
 * order-insensitive: `resolveSelection` decides which end is "before".
 */
export interface Selection {
  anchor: HistoryNode
  other?: HistoryNode
}

/** Options that change how a diff is computed (never what it is compared against). */
export interface DiffOptions {
  /** Unified context lines. `'all'` means the whole file. */
  context: number | 'all'
  ignoreWhitespace: boolean
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = { context: 3, ignoreWhitespace: false }

/** How two endpoints relate to each other in the commit graph. */
export type Relation = 'ancestor' | 'divergent' | 'unrelated'

/**
 * A resolved comparison. Produced by `resolveSelection`, consumed by
 * `buildDiffArgs`. `base` is always the "before" side.
 */
export type DiffSpec =
  | { mode: 'commit'; base: string; target: string; parentIndex: number; parents: string[] }
  | { mode: 'root'; base: string; target: string }
  | { mode: 'working'; base: string; baseIsHead: boolean }
  | { mode: 'range'; base: string; target: string; relation: Relation }
  /** Nothing to show, with a reason the UI can display verbatim. */
  | { mode: 'empty'; reason: string }

/* ------------------------------------------------------------------- history */

export interface RefLabel {
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
  /** True when HEAD points at this ref. */
  isHead: boolean
}

/**
 * A branch, remote-tracking branch, or tag, as listed for the sidebar.
 *
 * `sha` is always a commit: an annotated tag is peeled before it gets here, so
 * the sidebar never has to care what kind of object a ref points at.
 */
export interface RefEntry {
  /** Display name: `main`, `origin/main`, `v1.2.0`. */
  name: string
  kind: 'branch' | 'remote' | 'tag'
  sha: string
  /** True for the branch HEAD points at. */
  isHead: boolean
  /** Short upstream name, for a local branch that has one. */
  upstream?: string
  /** Commits this branch has that its upstream does not, and the reverse. */
  ahead?: number
  behind?: number
  /** True when an upstream is configured but no longer exists. */
  upstreamGone?: boolean
  /** Committer date, or tagger date for an annotated tag. */
  date: string
  subject: string
}

export interface CommitSummary {
  sha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: string
  committerDate: string
  subject: string
  refs: RefLabel[]
}

export interface CommitDetail extends CommitSummary {
  committerName: string
  committerEmail: string
  /** Full commit message, subject and body. */
  body: string
}

export interface HistoryPage {
  rows: CommitSummary[]
  /** Offset the rows start at. */
  offset: number
  /** True when the log stream has been fully consumed. */
  done: boolean
  /** Total known so far; final once `done`. */
  loaded: number
}

/* ------------------------------------------------------------ working tree */

export interface WorkingSummary {
  hasChanges: boolean
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

/* ----------------------------------------------------------------- the repo */

export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | null

export interface RepoInfo {
  id: string
  /** Absolute path of the working-tree root (or the git dir for a bare repo). */
  root: string
  /** Basename, for the title bar. */
  name: string
  head: string | null
  /** Short branch name, or null when detached or unborn. */
  branch: string | null
  detached: boolean
  unborn: boolean
  bare: boolean
  operation: RepoOperation
  gitVersion: string
}

export interface GitTreeError {
  code:
    | 'GIT_MISSING'
    | 'GIT_TOO_OLD'
    | 'NOT_A_REPO'
    | 'UNREADABLE'
    | 'GIT_FAILED'
    | 'FORBIDDEN'
    | 'TIMEOUT'
    | 'TOO_LARGE'
    | 'NO_REPO'
  message: string
  detail?: string
}

/** Every IPC call returns this; the renderer never sees a thrown exception. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: GitTreeError }

/* ---------------------------------------------------------- changed files */

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unmerged'
  | 'untracked'
  /** In the working tree and unchanged. Only the all-files view produces these. */
  | 'clean'
  /** On disk and ignored by `.gitignore`. Only the all-files view produces these. */
  | 'ignored'
  | 'unknown'

export interface ChangedFile {
  path: string
  /** Set for renames and copies. */
  oldPath?: string
  status: FileStatus
  /** Similarity percentage for renames/copies. */
  score?: number
  insertions: number | null
  deletions: number | null
  binary: boolean
  /** True for files present on disk but not in the index. */
  untracked?: boolean
}

/**
 * Every file in the working tree, for the all-files view.
 *
 * The same `ChangedFile` shape as the comparison list, so one panel, one tree
 * builder and one diff request path serve both: a file that happens to be
 * modified carries the status `git status` gave it, and everything else is
 * `clean` or `ignored`.
 */
export interface WorkingFilesResult {
  files: ChangedFile[]
  /** True when files ignored by `.gitignore` are included. */
  includeIgnored: boolean
  notes: string[]
  truncated: boolean
}

export interface ChangedFilesResult {
  spec: DiffSpec
  /** Human-readable statement of exactly what is being compared. */
  label: string
  files: ChangedFile[]
  /** Non-fatal things the user should know (truncation, unrelated histories...). */
  notes: string[]
  truncated: boolean
}

/* -------------------------------------------------------------- file patch */

export type DiffLineType = 'context' | 'add' | 'del' | 'meta'

export interface DiffLine {
  type: DiffLineType
  /** Line number on the before side, null for added lines. */
  oldNumber: number | null
  /** Line number on the after side, null for deleted lines. */
  newNumber: number | null
  content: string
  /** True when the file has no trailing newline at this line. */
  noNewline?: boolean
  /**
   * Character ranges to emphasise, from the intra-line word diff.
   * Pairs of [start, end) offsets into `content`.
   */
  highlights?: Array<[number, number]>
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export type PatchKind =
  | 'text'
  /** Not a diff at all: the file as it stands on disk, shown as context lines. */
  | 'contents'
  | 'binary'
  | 'submodule'
  | 'empty'
  | 'too-large'
  | 'unmerged'
  | 'untracked-binary'

export interface FilePatch {
  path: string
  oldPath?: string
  kind: PatchKind
  status: FileStatus
  hunks: DiffHunk[]
  /** e.g. "100644 -> 100755", or "symlink". */
  modeChange?: string
  isSymlink: boolean
  /** Set when the raw bytes were not valid UTF-8 and were decoded lossily. */
  nonUtf8: boolean
  oldSize: number | null
  newSize: number | null
  /** Line counts for this file within this comparison. */
  insertions: number
  deletions: number
  notes: string[]
  /** True when `context` did not cover the whole file, so expansion is offered. */
  expandable: boolean
}

/* ------------------------------------------------------------ media preview */

/** What a previewable file is rendered as. */
export type MediaKind = 'image' | 'video' | 'audio'

/** One side of a comparison, ready to be handed to an <img>, <video> or <audio>. */
export interface MediaSide {
  /** False when the file does not exist on this side (added, or deleted). */
  present: boolean
  bytes: number | null
  /** `data:` URL of the bytes, or null when absent or over the preview limit. */
  dataUrl: string | null
}

export interface MediaPreview {
  path: string
  kind: MediaKind
  mime: string
  before: MediaSide
  after: MediaSide
  /** True when this is the file as it stands on disk rather than a comparison. */
  contents: boolean
  /** Why a side that exists is not being shown (too large, unreadable). */
  notes: string[]
}

/* ---------------------------------------------------------------- settings */

export interface PanelSizes {
  /** Width of the branch sidebar, in px. */
  sidebarWidth: number
  /** Height of the history panel, in px. */
  historyHeight: number
  /** Width of the left column (files + metadata), in px. */
  leftWidth: number
  /** Height of the changed-files panel within the left column, in px. */
  filesHeight: number
}

/** How the changed-file list is laid out: as git reported it, or grouped by directory. */
export type FilesView = 'flat' | 'tree'

export const DEFAULT_FILES_VIEW: FilesView = 'flat'

/**
 * Which files the panel lists: the ones this comparison touched, or everything
 * in the working tree the way an editor's project pane would show it.
 */
export type FilesScope = 'changed' | 'all'

export const DEFAULT_FILES_SCOPE: FilesScope = 'changed'

/**
 * Which panels are on screen.
 *
 * The diff has no entry: it is what the window is for, and it is what grows
 * when anything here is turned off. Sizes are kept separately in `PanelSizes`,
 * so a panel that is hidden and shown again comes back the size it was.
 */
export interface PanelVisibility {
  /** The branch sidebar. */
  refs: boolean
  /** The commit graph. */
  history: boolean
  /** The changed-files list. */
  files: boolean
  /** The commit details. */
  metadata: boolean
}

export type PanelKey = keyof PanelVisibility

/** The order panels are offered in, which is their order on screen. */
export const PANEL_KEYS: readonly PanelKey[] = ['refs', 'history', 'files', 'metadata']

/** What each panel is called, for menus, toggles and hide buttons. */
export const PANEL_LABELS: Record<PanelKey, string> = {
  refs: 'Branches',
  history: 'History',
  files: 'Changed files',
  metadata: 'Details'
}

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  refs: true,
  history: true,
  files: true,
  metadata: true
}

export interface Settings {
  panels: PanelSizes
  recents: string[]
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean }
  diff: DiffOptions
  filesView: FilesView
  /** Changed files only, or the whole working tree. */
  filesScope: FilesScope
  /** In the all-files view, whether `.gitignore`d files are listed too. */
  showIgnored: boolean
  /** Which panels are shown. */
  panelVisibility: PanelVisibility
  /**
   * What to put back when "focus the diff" is turned off, or null when it is
   * not on. Persisted so that quitting while focused and coming back still
   * restores the layout the user had rather than everything.
   */
  panelFocusRestore: PanelVisibility | null
}

export const DEFAULT_PANELS: PanelSizes = {
  sidebarWidth: 220,
  historyHeight: 320,
  leftWidth: 440,
  filesHeight: 260
}
