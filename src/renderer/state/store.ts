import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { mediaTypeForPath } from '@shared/media'
import { applyClick, sameNode, selectionsEqual } from '@shared/selection'
import {
  DEFAULT_DIFF_OPTIONS,
  DEFAULT_FILES_SCOPE,
  DEFAULT_FILES_VIEW,
  DEFAULT_PANELS,
  DEFAULT_PANEL_VISIBILITY,
  PANEL_KEYS,
  type ChangedFile,
  type ChangedFilesResult,
  type CommitDetail,
  type CommitSummary,
  type DiffOptions,
  type FilePatch,
  type FilesScope,
  type FilesView,
  type GitTreeError,
  type HistoryNode,
  type MediaPreview,
  type PanelKey,
  type PanelSizes,
  type PanelVisibility,
  type RefEntry,
  type RepoInfo,
  type Result,
  type Selection,
  type Settings,
  type WorkingFilesResult,
  type WorkingSummary
} from '@shared/types'

const PAGE_SIZE = 1000

/**
 * How far ahead of the viewport history is kept loaded.
 *
 * The whole log is already buffered in the main process, so a page is just a
 * slice; the reason not to pull all of it at once is renderer memory on a
 * repository with hundreds of thousands of commits. Staying this far ahead
 * means scrolling never waits, while memory stays bounded by where the user
 * has actually been.
 */
const PREFETCH_ROWS = 5000

/**
 * How many pages a jump to a ref will pull in before giving up.
 *
 * Comfortably past `LogStream`'s own 200,000-commit ceiling, so it only ever
 * fires if paging somehow stops making progress: a bound that stops a loop
 * spinning, not one the user can reach.
 */
const MAX_JUMP_PAGES = 400

/* ------------------------------------------------------------------- state */

export interface State {
  settings: Settings | null
  repo: RepoInfo | null
  /** A fatal, repository-level problem. Panels are hidden while this is set. */
  error: GitTreeError | null
  opening: boolean

  commits: CommitSummary[]
  historyDone: boolean
  /** Bumped whenever history is rebuilt, so derived caches can reset. */
  epoch: number
  loadingPage: boolean

  working: WorkingSummary | null
  selection: Selection | null
  /** Which parent of a merge commit to compare against. */
  parentIndex: number

  files: ChangedFilesResult | null
  filesLoading: boolean
  filesError: GitTreeError | null

  /** Every file on disk, for the all-files scope. Null until it is asked for. */
  workingFiles: WorkingFilesResult | null
  workingFilesLoading: boolean
  workingFilesError: GitTreeError | null

  selectedPath: string | null
  patch: FilePatch | null
  patchLoading: boolean
  patchError: GitTreeError | null
  /** Set when the user asked for an over-sized patch anyway. */
  forcePatch: boolean

  /** Both sides of the selected file, when it is an image, video or sound. */
  media: MediaPreview | null
  mediaLoading: boolean
  mediaError: GitTreeError | null

  detail: CommitDetail | null
  diff: DiffOptions
  /** Flat list or directory tree, in the changed-files panel. */
  filesView: FilesView
  /** Files this comparison touched, or every file in the working tree. */
  filesScope: FilesScope
  /** Whether the all-files scope lists `.gitignore`d files too. */
  showIgnored: boolean

  /** Branches, remote-tracking branches and tags, for the sidebar. */
  refs: RefEntry[]
  refsError: GitTreeError | null
  /** Which panels are on screen. */
  panelVisibility: PanelVisibility
  /** What "focus the diff" will put back, or null when it is not on. */
  panelFocusRestore: PanelVisibility | null
  /** Why the last jump to a ref did not go anywhere. Cleared by the next one. */
  jumpNote: string | null
  /** Why the last "open in default application" did nothing. Cleared by the next one. */
  openNote: string | null
}

const initialState: State = {
  settings: null,
  repo: null,
  error: null,
  opening: false,
  commits: [],
  historyDone: false,
  epoch: 0,
  loadingPage: false,
  working: null,
  selection: null,
  parentIndex: 0,
  files: null,
  filesLoading: false,
  filesError: null,
  workingFiles: null,
  workingFilesLoading: false,
  workingFilesError: null,
  selectedPath: null,
  patch: null,
  patchLoading: false,
  patchError: null,
  forcePatch: false,
  media: null,
  mediaLoading: false,
  mediaError: null,
  detail: null,
  diff: { ...DEFAULT_DIFF_OPTIONS },
  filesView: DEFAULT_FILES_VIEW,
  filesScope: DEFAULT_FILES_SCOPE,
  showIgnored: false,
  refs: [],
  refsError: null,
  panelVisibility: { ...DEFAULT_PANEL_VISIBILITY },
  panelFocusRestore: null,
  jumpNote: null,
  openNote: null
}

type Action =
  | { type: 'settings'; settings: Settings }
  | { type: 'opening' }
  | { type: 'opened'; repo: RepoInfo }
  | { type: 'closed' }
  | { type: 'error'; error: GitTreeError }
  | { type: 'page-start' }
  | { type: 'page'; commits: CommitSummary[]; offset: number; done: boolean }
  | { type: 'working'; working: WorkingSummary }
  | { type: 'select'; node: HistoryNode; additive: boolean }
  | { type: 'select-exact'; selection: Selection }
  | { type: 'parent-index'; index: number }
  | { type: 'files-start' }
  | { type: 'files'; files: ChangedFilesResult }
  | { type: 'files-error'; error: GitTreeError }
  | { type: 'select-file'; path: string | null }
  | { type: 'patch-start'; force: boolean }
  | { type: 'patch'; patch: FilePatch }
  | { type: 'patch-error'; error: GitTreeError }
  | { type: 'detail'; detail: CommitDetail | null }
  | { type: 'diff-options'; options: Partial<DiffOptions> }
  | { type: 'files-view'; view: FilesView }
  | { type: 'files-scope'; scope: FilesScope }
  | { type: 'show-ignored'; show: boolean }
  | { type: 'working-files-start' }
  | { type: 'working-files'; files: WorkingFilesResult }
  | { type: 'working-files-error'; error: GitTreeError }
  | { type: 'working-files-stale' }
  | { type: 'files-retry' }
  | { type: 'refs'; refs: RefEntry[] }
  | { type: 'refs-error'; error: GitTreeError }
  | { type: 'visibility'; visibility: PanelVisibility; focusRestore: PanelVisibility | null }
  | { type: 'jump-note'; note: string | null }
  | { type: 'open-note'; note: string | null }
  | { type: 'media-start' }
  | { type: 'media'; media: MediaPreview }
  | { type: 'media-error'; error: GitTreeError }

/* --------------------------------------------------------------- selectors */

/**
 * The file list the panel is showing.
 *
 * Everything downstream of a file click — the patch, the media preview, the
 * arrow keys — reads the list through this rather than through `state.files`,
 * so the two scopes cannot drift apart into two half-wired code paths.
 */
export function activeFiles(state: State): ChangedFile[] {
  return state.filesScope === 'all'
    ? (state.workingFiles?.files ?? [])
    : (state.files?.files ?? [])
}

/** The working tree against HEAD, which is what the all-files scope compares. */
const WORKING_SELECTION: Selection = { anchor: { kind: 'working' } }

/**
 * The comparison a file click resolves against.
 *
 * In the all-files scope the list is a picture of the disk and the statuses on
 * it are working-tree statuses, so its diffs have to be working-tree diffs too;
 * showing a file marked "modified" against a commit from last March would be
 * a row and a panel disagreeing about what they mean. A file the working tree
 * has not touched is shown as its own contents, which `filePatch` handles.
 */
function activeSelection(state: State): Selection | null {
  return state.filesScope === 'all' ? WORKING_SELECTION : state.selection
}

/** Merges only ever have a parent to choose in the comparison scope. */
function activeParentIndex(state: State): number {
  return state.filesScope === 'all' ? 0 : state.parentIndex
}

/* ----------------------------------------------------------------- reducer */

/** Dropping a preview is what makes the next one be fetched. */
const noMedia = { media: null, mediaLoading: false, mediaError: null } as const

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'settings':
      return {
        ...state,
        settings: action.settings,
        diff: action.settings.diff,
        filesView: action.settings.filesView,
        filesScope: action.settings.filesScope,
        showIgnored: action.settings.showIgnored,
        panelVisibility: action.settings.panelVisibility,
        panelFocusRestore: action.settings.panelFocusRestore
      }

    case 'opening':
      return { ...state, opening: true, error: null }

    case 'opened':
      return {
        ...initialState,
        settings: state.settings,
        diff: state.diff,
        filesView: state.filesView,
        filesScope: state.filesScope,
        showIgnored: state.showIgnored,
        panelVisibility: state.panelVisibility,
        panelFocusRestore: state.panelFocusRestore,
        // Refreshing the repository already open re-reads the refs, so keeping
        // the old list until the new one lands means the sidebar does not blink
        // empty every time something touches .git. A *different* repository has
        // to start empty, because its refs are not these.
        refs: state.repo?.id === action.repo.id ? state.refs : [],
        repo: action.repo,
        epoch: state.epoch + 1
      }

    case 'closed':
      return {
        ...initialState,
        settings: state.settings,
        diff: state.diff,
        filesView: state.filesView,
        filesScope: state.filesScope,
        showIgnored: state.showIgnored,
        panelVisibility: state.panelVisibility,
        panelFocusRestore: state.panelFocusRestore,
        epoch: state.epoch + 1
      }

    case 'error':
      return { ...state, error: action.error, opening: false }

    case 'page-start':
      return { ...state, loadingPage: true }

    case 'page': {
      // Ignore a page that no longer lines up, which happens when a refresh
      // lands while an older request is in flight.
      if (action.offset !== state.commits.length) return { ...state, loadingPage: false }
      return {
        ...state,
        commits: [...state.commits, ...action.commits],
        historyDone: action.done,
        loadingPage: false
      }
    }

    case 'working':
      return { ...state, working: action.working }

    case 'select': {
      const selection = applyClick(state.selection, action.node, action.additive)
      // Re-selecting what is already selected must not restart every query.
      if (selectionsEqual(selection, state.selection)) return state
      return { ...state, selection, parentIndex: 0, detail: null }
    }

    case 'select-exact':
      return { ...state, selection: action.selection, parentIndex: 0, detail: null }

    case 'parent-index':
      return {
        ...state,
        parentIndex: action.index,
        patch: null,
        patchError: null,
        patchLoading: false,
        ...noMedia
      }

    case 'files-start':
      return { ...state, filesLoading: true, filesError: null }

    case 'files': {
      // The comparison is still read in the all-files scope — the metadata
      // panel names it — but it is not what the panel is listing there, so it
      // must not move the selection out from under the list that is.
      if (state.filesScope !== 'changed') {
        return { ...state, files: action.files, filesLoading: false }
      }
      // Keep the user on the same file across refreshes when it still exists.
      const stillThere =
        state.selectedPath && action.files.files.some((f) => f.path === state.selectedPath)
      const selectedPath = stillThere ? state.selectedPath : (action.files.files[0]?.path ?? null)
      return {
        ...state,
        files: action.files,
        filesLoading: false,
        selectedPath,
        patch: stillThere ? state.patch : null,
        forcePatch: false,
        // The file may be the same name at different content, so a preview is
        // always re-read; a text file simply never asks for one.
        ...noMedia
      }
    }

    case 'files-error':
      return {
        ...state,
        filesLoading: false,
        filesError: action.error,
        files: null,
        // Same reasoning as above: a comparison that failed says nothing about
        // the file the all-files scope is showing.
        ...(state.filesScope === 'changed' ? { patch: null, ...noMedia } : {})
      }

    case 'select-file':
      return {
        ...state,
        selectedPath: action.path,
        patch: null,
        patchError: null,
        // A request still in flight for the previous file is abandoned by the
        // sequence check, so its loading state must not be left behind.
        patchLoading: false,
        forcePatch: false,
        ...noMedia
      }

    case 'patch-start':
      return { ...state, patchLoading: true, patchError: null, forcePatch: action.force }

    case 'patch':
      return { ...state, patch: action.patch, patchLoading: false }

    case 'patch-error':
      return { ...state, patchLoading: false, patchError: action.error, patch: null }

    case 'media-start':
      return { ...state, mediaLoading: true, mediaError: null }

    case 'media':
      return { ...state, media: action.media, mediaLoading: false }

    case 'media-error':
      return { ...state, mediaLoading: false, mediaError: action.error, media: null }

    case 'detail':
      return { ...state, detail: action.detail }

    case 'diff-options':
      // Dropping the patch is what makes it be fetched again under the new
      // options; the fetch rule is "selected file, but no patch".
      return {
        ...state,
        diff: { ...state.diff, ...action.options },
        patch: null,
        patchError: null,
        patchLoading: false
      }

    case 'files-view':
      // Purely a way of drawing the same list: nothing is re-queried, and the
      // selected file stays selected across the switch.
      return { ...state, filesView: action.view }

    case 'files-scope':
      if (action.scope === state.filesScope) return state
      // The two scopes answer different questions, so the same file means a
      // different diff on either side of the switch: the comparison's patch in
      // one, the uncommitted one in the other. The selection is kept — it is
      // usually the file the user is reading — and the patch is dropped, which
      // is what makes it be fetched again under the new rule.
      return {
        ...state,
        filesScope: action.scope,
        patch: null,
        patchError: null,
        patchLoading: false,
        forcePatch: false,
        ...noMedia
      }

    case 'show-ignored':
      if (action.show === state.showIgnored) return state
      // Dropping the list is what makes it be read again with the new flag.
      return { ...state, showIgnored: action.show, workingFiles: null, workingFilesError: null }

    case 'working-files-start':
      return { ...state, workingFilesLoading: true, workingFilesError: null }

    case 'working-files': {
      // Same rule as the comparison list: stay on the file the user is reading
      // when it survived, otherwise fall to the top of the list.
      const stillThere =
        state.selectedPath && action.files.files.some((f) => f.path === state.selectedPath)
      const selectedPath = stillThere ? state.selectedPath : (action.files.files[0]?.path ?? null)
      if (state.filesScope !== 'all') {
        return { ...state, workingFiles: action.files, workingFilesLoading: false }
      }
      return {
        ...state,
        workingFiles: action.files,
        workingFilesLoading: false,
        selectedPath,
        patch: stillThere ? state.patch : null,
        forcePatch: false,
        ...noMedia
      }
    }

    case 'files-retry':
      // Same shape as the stale case: dropping the error is what lets the
      // comparison's fetch rule run again.
      return { ...state, filesError: null, files: null }

    case 'working-files-stale':
      // Dropping the list is what makes it be read again; see the fetch rule.
      return { ...state, workingFiles: null, workingFilesError: null }

    case 'working-files-error':
      return {
        ...state,
        workingFilesLoading: false,
        workingFilesError: action.error,
        workingFiles: null,
        ...(state.filesScope === 'all' ? { patch: null, ...noMedia } : {})
      }

    case 'refs':
      return { ...state, refs: action.refs, refsError: null }

    case 'refs-error':
      return { ...state, refs: [], refsError: action.error }

    case 'visibility':
      return {
        ...state,
        panelVisibility: action.visibility,
        panelFocusRestore: action.focusRestore
      }

    case 'jump-note':
      if (state.jumpNote === action.note) return state
      return { ...state, jumpNote: action.note }

    case 'open-note':
      if (state.openNote === action.note) return state
      return { ...state, openNote: action.note }
  }
}

/* ------------------------------------------------------------------- rows */

export type Row = { kind: 'working' } | { kind: 'commit'; commit: CommitSummary }

/* -------------------------------------------------------------------- hook */

function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value
  throw Object.assign(new Error(result.error.message), { info: result.error })
}

function asError(e: unknown): GitTreeError {
  const info = (e as { info?: GitTreeError })?.info
  if (info) return info
  return { code: 'GIT_FAILED', message: e instanceof Error ? e.message : String(e) }
}

export interface AppApi {
  state: State
  /** True when the working-tree row should appear at the top of the history. */
  hasWorkingRow: boolean
  rowCount: number
  rowAt: (index: number) => Row | null
  indexOfNode: (node: HistoryNode) => number
  isSelected: (node: HistoryNode) => boolean
  isAnchor: (node: HistoryNode) => boolean

  openPicker: () => void
  openPath: (path: string) => void
  closeRepo: () => void
  refresh: () => void
  forget: (path: string) => void

  click: (node: HistoryNode, additive: boolean) => void
  /** Moves the history to a ref's tip commit and selects it. */
  jumpToRef: (entry: RefEntry) => void
  /** Shows or hides one panel. */
  setPanelVisible: (panel: PanelKey, visible: boolean) => void
  togglePanel: (panel: PanelKey) => void
  /** Hides every panel but the diff, or puts back what was there before. */
  focusDiff: () => void
  ensureLoaded: (lastVisible: number) => void
  selectFile: (path: string | null) => void
  setParentIndex: (index: number) => void
  setDiffOptions: (options: Partial<DiffOptions>) => void
  setFilesView: (view: FilesView) => void
  /** Switches the panel between this comparison's files and every file on disk. */
  setFilesScope: (scope: FilesScope) => void
  /** Reads the file list again after one that failed. */
  retryFiles: () => void
  /** In the all-files scope, whether `.gitignore`d files are listed too. */
  setShowIgnored: (show: boolean) => void
  /**
   * Hands a working-tree file to the OS as a drag, so it can be dropped on a
   * terminal — which pastes its path — or on any other application.
   */
  startDrag: (relativePath: string) => void
  /** Opens a working-tree file or folder with the desktop's default application. */
  openInWorkingTree: (relativePath: string) => void
  loadAnyway: () => void
  savePanels: (panels: PanelSizes) => void
}

export function useGitTree(): AppApi {
  const [state, dispatch] = useReducer(reducer, initialState)

  const stateRef = useRef(state)
  stateRef.current = state

  // Request sequencing: a slow response for an old selection must never
  // overwrite a newer one.
  const filesSeq = useRef(0)
  const patchSeq = useRef(0)
  const pageSeq = useRef(0)
  const jumpSeq = useRef(0)
  const mediaSeq = useRef(0)
  const workingFilesSeq = useRef(0)

  /* -------- settings -------- */
  useEffect(() => {
    void window.gitTree.getSettings().then((result) => {
      if (result.ok) dispatch({ type: 'settings', settings: result.value })
    })
  }, [])

  /* -------- opening -------- */
  const openPath = useCallback((path: string) => {
    dispatch({ type: 'opening' })
    void window.gitTree
      .openRepo(path)
      .then(unwrap)
      .then((repo) => dispatch({ type: 'opened', repo }))
      .catch((e) => dispatch({ type: 'error', error: asError(e) }))
  }, [])

  const openPicker = useCallback(() => {
    void window.gitTree
      .pickRepo()
      .then(unwrap)
      .then((path) => {
        if (path) openPath(path)
      })
      .catch((e) => dispatch({ type: 'error', error: asError(e) }))
  }, [openPath])

  const closeRepo = useCallback(() => dispatch({ type: 'closed' }), [])

  const forget = useCallback((path: string) => {
    void window.gitTree.forgetRepo(path).then((result) => {
      if (result.ok) dispatch({ type: 'settings', settings: result.value })
    })
  }, [])

  const refresh = useCallback(() => {
    const repo = stateRef.current.repo
    if (!repo) return
    void window.gitTree
      .refreshRepo(repo.id)
      .then(unwrap)
      .then((info) => dispatch({ type: 'opened', repo: info }))
      .catch((e) => dispatch({ type: 'error', error: asError(e) }))
  }, [])

  // A repository named on the command line opens itself once the bridge is up.
  useEffect(() => {
    void window.gitTree.initialRepo().then((result) => {
      if (result.ok && result.value) openPath(result.value)
    })
  }, [openPath])

  /* -------- history paging -------- */
  const loadPage = useCallback((repoId: string, offset: number) => {
    const seq = ++pageSeq.current
    dispatch({ type: 'page-start' })
    void window.gitTree
      .historyPage(repoId, offset, PAGE_SIZE)
      .then(unwrap)
      .then((page) => {
        if (seq !== pageSeq.current) return
        dispatch({ type: 'page', commits: page.rows, offset: page.offset, done: page.done })
      })
      .catch((e) => dispatch({ type: 'error', error: asError(e) }))
  }, [])

  // First page, working-tree summary and ref list, as soon as a repository
  // opens. The refs are re-read on every refresh too, because a fetch or a
  // branch created outside the app is exactly the change the sidebar is for.
  useEffect(() => {
    const repo = state.repo
    if (!repo) return
    loadPage(repo.id, 0)
    void window.gitTree
      .statusSummary(repo.id)
      .then(unwrap)
      .then((working) => dispatch({ type: 'working', working }))
      .catch(() => dispatch({ type: 'working', working: emptySummary() }))
    void window.gitTree
      .listRefs(repo.id)
      .then(unwrap)
      .then((refs) => dispatch({ type: 'refs', refs }))
      .catch((e) => dispatch({ type: 'refs-error', error: asError(e) }))
  }, [state.repo, state.epoch, loadPage])

  const lastVisibleRef = useRef(0)

  const ensureLoaded = useCallback(
    (lastVisible: number) => {
      lastVisibleRef.current = lastVisible
      const s = stateRef.current
      if (!s.repo || s.historyDone || s.loadingPage) return
      if (s.commits.length < lastVisible + PREFETCH_ROWS) loadPage(s.repo.id, s.commits.length)
    },
    [loadPage]
  )

  // Keep pulling pages until the buffer is far enough ahead of the viewport.
  // Without this the list would only grow when the user scrolls, which makes
  // the scrollbar lie about how much history there is.
  useEffect(() => {
    const s = state
    if (!s.repo || s.historyDone || s.loadingPage) return
    if (s.commits.length < lastVisibleRef.current + PREFETCH_ROWS) {
      loadPage(s.repo.id, s.commits.length)
    }
  }, [state.repo, state.commits, state.historyDone, state.loadingPage, loadPage])

  /**
   * The one place panel visibility changes, so the focus-restore memory can
   * never drift from what is on screen.
   */
  const applyVisibility = useCallback(
    (visibility: PanelVisibility, focusRestore: PanelVisibility | null) => {
      dispatch({ type: 'visibility', visibility, focusRestore })
      void window.gitTree.setSettings({
        panelVisibility: visibility,
        panelFocusRestore: focusRestore
      })
    },
    []
  )

  const setPanelVisible = useCallback(
    (panel: PanelKey, visible: boolean) => {
      const current = stateRef.current
      if (current.panelVisibility[panel] === visible) return
      // Touching a panel by hand ends focus mode: the layout the user is
      // building now is the one to come back to, not the stale one.
      applyVisibility({ ...current.panelVisibility, [panel]: visible }, null)
    },
    [applyVisibility]
  )

  const togglePanel = useCallback(
    (panel: PanelKey) => setPanelVisible(panel, !stateRef.current.panelVisibility[panel]),
    [setPanelVisible]
  )

  const focusDiff = useCallback(() => {
    const current = stateRef.current
    const anyShown = PANEL_KEYS.some((key) => current.panelVisibility[key])
    if (anyShown) {
      applyVisibility({ refs: false, history: false, files: false, metadata: false }, current.panelVisibility)
      return
    }
    // Nothing was remembered when the panels went away one at a time, so
    // leaving focus mode means showing them all rather than nothing at all.
    applyVisibility(current.panelFocusRestore ?? { ...DEFAULT_PANEL_VISIBILITY }, null)
  }, [applyVisibility])

  /* -------- jumping to a ref -------- */

  /**
   * Pages history in until `index` is addressable, or gives up.
   *
   * A ref tip can sit far below what the renderer has paged in, and
   * `scrollToIndex` cannot reach a row that does not exist yet. Requesting the
   * same offset the background prefetch is already fetching is harmless: the
   * reducer drops any page whose offset no longer matches the list length, so
   * the loser of that race is discarded rather than appended twice.
   */
  const loadThrough = useCallback(
    async (repoId: string, index: number, seq: number): Promise<'ok' | 'short' | 'stale'> => {
      for (let guard = 0; guard < MAX_JUMP_PAGES; guard++) {
        const s = stateRef.current
        if (s.repo?.id !== repoId || seq !== jumpSeq.current) return 'stale'
        if (s.commits.length > index) return 'ok'
        if (s.historyDone) return 'short'
        const page = await window.gitTree.historyPage(repoId, s.commits.length, PAGE_SIZE).then(unwrap)
        dispatch({ type: 'page', commits: page.rows, offset: page.offset, done: page.done })
        // `stateRef` is only current after a render, so the next iteration has
        // to start on a later task or it would re-request the same offset.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return 'short'
    },
    []
  )

  const jumpToRef = useCallback(
    (entry: RefEntry) => {
      const repo = stateRef.current.repo
      if (!repo) return
      const seq = ++jumpSeq.current
      dispatch({ type: 'jump-note', note: null })
      void (async () => {
        try {
          const index = await window.gitTree.historyIndexOf(repo.id, entry.sha).then(unwrap)
          if (seq !== jumpSeq.current) return
          if (index < 0) {
            dispatch({
              type: 'jump-note',
              note: `${entry.name} points at a commit that is not in the loaded history.`
            })
            return
          }
          const loaded = await loadThrough(repo.id, index, seq)
          if (loaded === 'stale') return
          if (loaded === 'short') {
            dispatch({
              type: 'jump-note',
              note: `Could not load enough history to reach ${entry.name}.`
            })
            return
          }
          dispatch({
            type: 'select-exact',
            selection: { anchor: { kind: 'commit', sha: entry.sha } }
          })
        } catch (e) {
          if (seq === jumpSeq.current) {
            dispatch({ type: 'jump-note', note: asError(e).message })
          }
        }
      })()
    },
    [loadThrough]
  )

  /* -------- default selection -------- */
  useEffect(() => {
    const s = stateRef.current
    // Wait for the working-tree summary before choosing: picking HEAD just
    // because status had not answered yet would make the default depend on
    // which query happened to finish first.
    if (!s.repo || s.selection || !s.working) return
    if (s.working.hasChanges) {
      dispatch({ type: 'select-exact', selection: { anchor: { kind: 'working' } } })
      return
    }
    // Prefer HEAD over the newest commit by date: with a detached HEAD, or a
    // branch that is behind another, "the top row" is not where the user is.
    const head = s.repo.head
    const target = (head && s.commits.some((c) => c.sha === head) ? head : s.commits[0]?.sha) ?? null
    if (target) {
      dispatch({ type: 'select-exact', selection: { anchor: { kind: 'commit', sha: target } } })
    }
  }, [state.commits, state.working, state.repo])

  // A selection pointing at a working row that is no longer dirty would show an
  // empty panel, so it falls back to HEAD.
  useEffect(() => {
    const s = stateRef.current
    if (!s.repo || !s.selection || !s.working) return
    if (s.working.hasChanges) return
    const usesWorking =
      s.selection.anchor.kind === 'working' || s.selection.other?.kind === 'working'
    if (!usesWorking) return
    const headSha = s.repo.head
    const target =
      (headSha && s.commits.some((c) => c.sha === headSha) ? headSha : s.commits[0]?.sha) ?? null
    if (target) {
      dispatch({ type: 'select-exact', selection: { anchor: { kind: 'commit', sha: target } } })
    }
  }, [state.working, state.commits])

  /* -------- changed files -------- */
  useEffect(() => {
    const { repo, selection, parentIndex, diff } = state
    if (!repo || !selection) return
    const seq = ++filesSeq.current
    dispatch({ type: 'files-start' })
    void window.gitTree
      .changedFiles(repo.id, selection, parentIndex, diff)
      .then(unwrap)
      .then((files) => {
        if (seq === filesSeq.current) dispatch({ type: 'files', files })
      })
      .catch((e) => {
        if (seq === filesSeq.current) dispatch({ type: 'files-error', error: asError(e) })
      })
  }, [state.repo, state.selection, state.parentIndex, state.diff, state.epoch])

  /* -------- every file on disk -------- */

  // Stated as a condition on the state rather than as a reaction, for the same
  // reason the patch rule is: if the all-files scope is showing and there is no
  // list, no error and nothing in flight, read one. Anything that invalidates
  // the list — a refresh, the ignored toggle, the repository changing on disk —
  // does so by setting it back to null.
  useEffect(() => {
    if (!state.repo || state.filesScope !== 'all') return
    if (state.workingFiles || state.workingFilesLoading || state.workingFilesError) return
    const seq = ++workingFilesSeq.current
    dispatch({ type: 'working-files-start' })
    void window.gitTree
      .workingFiles(state.repo.id, state.showIgnored)
      .then(unwrap)
      .then((files) => {
        if (seq === workingFilesSeq.current) dispatch({ type: 'working-files', files })
      })
      .catch((e) => {
        if (seq === workingFilesSeq.current)
          dispatch({ type: 'working-files-error', error: asError(e) })
      })
  }, [
    state.repo,
    state.filesScope,
    state.showIgnored,
    state.workingFiles,
    state.workingFilesLoading,
    state.workingFilesError
  ])

  /* -------- commit metadata -------- */
  useEffect(() => {
    const { repo, selection } = state
    if (!repo || !selection) return
    const node = selection.other ? null : selection.anchor
    if (!node || node.kind !== 'commit') {
      dispatch({ type: 'detail', detail: null })
      return
    }
    let cancelled = false
    void window.gitTree
      .commitDetail(repo.id, node.sha)
      .then(unwrap)
      .then((detail) => {
        if (!cancelled) dispatch({ type: 'detail', detail })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'detail', detail: null })
      })
    return () => {
      cancelled = true
    }
  }, [state.repo, state.selection, state.epoch])

  /* -------- the selected file's patch -------- */
  const requestPatch = useCallback((force: boolean) => {
    const s = stateRef.current
    const file = activeFiles(s).find((f) => f.path === s.selectedPath)
    const selection = activeSelection(s)
    if (!s.repo || !selection || !file) return
    const seq = ++patchSeq.current
    dispatch({ type: 'patch-start', force })
    void window.gitTree
      .filePatch(
        s.repo.id,
        selection,
        activeParentIndex(s),
        {
          path: file.path,
          oldPath: file.oldPath,
          status: file.status,
          untracked: file.untracked
        } as Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>,
        s.diff,
        force
      )
      .then(unwrap)
      .then((patch: FilePatch) => {
        if (seq === patchSeq.current) dispatch({ type: 'patch', patch })
      })
      .catch((e) => {
        if (seq === patchSeq.current) dispatch({ type: 'patch-error', error: asError(e) })
      })
  }, [])

  // One rule, stated once: if a file is selected and there is no patch, no
  // error and nothing in flight, fetch it. Expressing it as a condition on the
  // state rather than as a reaction to a particular action means no ordering of
  // clicks, refreshes and in-flight responses can leave the panel empty.
  useEffect(() => {
    if (!state.repo || !activeSelection(state) || !state.selectedPath) return
    if (state.patch || state.patchLoading || state.patchError) return
    if (!activeFiles(state).some((f) => f.path === state.selectedPath)) return
    requestPatch(false)
  }, [
    state.repo,
    state.selection,
    state.selectedPath,
    state.files,
    state.workingFiles,
    state.filesScope,
    state.patch,
    state.patchLoading,
    state.patchError,
    requestPatch
  ])

  /* -------- the selected file's preview, when it is media -------- */

  // Stated the same way as the patch rule: if the selected file is something
  // that can be displayed and there is no preview, no error and nothing in
  // flight, fetch it. A text file never matches, so nothing extra is read for
  // the overwhelmingly common case.
  useEffect(() => {
    const selection = activeSelection(state)
    if (!state.repo || !selection || !state.selectedPath) return
    if (state.media || state.mediaLoading || state.mediaError) return
    if (!mediaTypeForPath(state.selectedPath)) return
    const file = activeFiles(state).find((f) => f.path === state.selectedPath)
    if (!file) return

    const seq = ++mediaSeq.current
    dispatch({ type: 'media-start' })
    void window.gitTree
      .mediaPreview(state.repo.id, selection, activeParentIndex(state), {
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        untracked: file.untracked
      })
      .then(unwrap)
      .then((media: MediaPreview) => {
        if (seq === mediaSeq.current) dispatch({ type: 'media', media })
      })
      .catch((e) => {
        if (seq === mediaSeq.current) dispatch({ type: 'media-error', error: asError(e) })
      })
  }, [
    state.repo,
    state.selection,
    state.parentIndex,
    state.selectedPath,
    state.files,
    state.workingFiles,
    state.filesScope,
    state.media,
    state.mediaLoading,
    state.mediaError
  ])

  /* -------- external change / menu -------- */
  useEffect(() => {
    const off = window.gitTree.onRepoChanged(({ id, reason }) => {
      const s = stateRef.current
      if (!s.repo || s.repo.id !== id) return
      if (reason === 'focus') {
        // Focus only re-reads the working tree; history cannot change without
        // something touching .git, which the watcher already covers. The
        // all-files list *is* the working tree, though, so it goes stale for
        // exactly the same reason the summary does.
        void window.gitTree
          .statusSummary(id)
          .then(unwrap)
          .then((working) => dispatch({ type: 'working', working }))
          .catch(() => undefined)
        if (s.filesScope === 'all') dispatch({ type: 'working-files-stale' })
        return
      }
      refresh()
    })
    return off
  }, [refresh])

  useEffect(() => {
    const off = window.gitTree.onMenu((command, argument) => {
      if (command === 'menu:open-repo') openPicker()
      else if (command === 'menu:close-repo') closeRepo()
      else if (command === 'menu:refresh') refresh()
      else if (command === 'menu:open-path' && argument) openPath(argument)
      else if (command === 'menu:toggle-panel' && argument) togglePanel(argument as PanelKey)
      else if (command === 'menu:focus-diff') focusDiff()
    })
    return off
  }, [openPicker, closeRepo, refresh, openPath, togglePanel, focusDiff])

  /* -------- derived -------- */
  const hasWorkingRow = state.working?.hasChanges ?? false
  const rowCount = state.commits.length + (hasWorkingRow ? 1 : 0)

  const rowAt = useCallback(
    (index: number): Row | null => {
      if (hasWorkingRow) {
        if (index === 0) return { kind: 'working' }
        const commit = state.commits[index - 1]
        return commit ? { kind: 'commit', commit } : null
      }
      const commit = state.commits[index]
      return commit ? { kind: 'commit', commit } : null
    },
    [hasWorkingRow, state.commits]
  )

  const shaIndex = useMemo(() => {
    const map = new Map<string, number>()
    state.commits.forEach((commit, i) => map.set(commit.sha, i))
    return map
  }, [state.commits])

  const indexOfNode = useCallback(
    (node: HistoryNode): number => {
      if (node.kind === 'working') return hasWorkingRow ? 0 : -1
      const found = shaIndex.get(node.sha)
      if (found === undefined) return -1
      return found + (hasWorkingRow ? 1 : 0)
    },
    [shaIndex, hasWorkingRow]
  )

  const isSelected = useCallback(
    (node: HistoryNode): boolean => {
      const selection = state.selection
      if (!selection) return false
      if (sameNode(selection.anchor, node)) return true
      return selection.other ? sameNode(selection.other, node) : false
    },
    [state.selection]
  )

  const isAnchor = useCallback(
    (node: HistoryNode): boolean =>
      !!state.selection?.other && sameNode(state.selection.anchor, node),
    [state.selection]
  )

  const savePanels = useCallback((panels: PanelSizes) => {
    void window.gitTree.setSettings({ panels })
  }, [])

  const setDiffOptions = useCallback((options: Partial<DiffOptions>) => {
    dispatch({ type: 'diff-options', options })
    const next = { ...stateRef.current.diff, ...options }
    void window.gitTree.setSettings({ diff: next })
  }, [])

  // Opening is the only thing the application asks the desktop to do with a
  // file. It always acts on the working tree — the version on disk now — since
  // that is the only version there is a path to; a file that exists only in the
  // commit being shown says so rather than opening the wrong thing.
  const openInWorkingTree = useCallback((relativePath: string) => {
    const repo = stateRef.current.repo
    if (!repo) return
    dispatch({ type: 'open-note', note: null })
    void window.gitTree
      .openInWorkingTree(repo.id, relativePath)
      .then(unwrap)
      .catch((e) => dispatch({ type: 'open-note', note: asError(e).message }))
  }, [])

  const setFilesView = useCallback((view: FilesView) => {
    dispatch({ type: 'files-view', view })
    void window.gitTree.setSettings({ filesView: view })
  }, [])

  const setFilesScope = useCallback((scope: FilesScope) => {
    dispatch({ type: 'files-scope', scope })
    void window.gitTree.setSettings({ filesScope: scope })
  }, [])

  // A failed read leaves an error behind, and the fetch rules deliberately will
  // not run while one is set; without this the panel would be a dead end until
  // the whole repository was refreshed. Clearing the error is what re-runs them.
  const retryFiles = useCallback(() => {
    const s = stateRef.current
    if (s.filesScope === 'all') dispatch({ type: 'working-files-stale' })
    else dispatch({ type: 'files-retry' })
  }, [])

  const setShowIgnored = useCallback((show: boolean) => {
    dispatch({ type: 'show-ignored', show })
    void window.gitTree.setSettings({ showIgnored: show })
  }, [])

  // Fire-and-forget: the drag is already underway in the renderer, and the OS
  // takes it over from the main process. Nothing here can fail usefully.
  const startDrag = useCallback((relativePath: string) => {
    const repo = stateRef.current.repo
    if (repo) window.gitTree.startDrag(repo.id, relativePath)
  }, [])

  return {
    state,
    hasWorkingRow,
    rowCount,
    rowAt,
    indexOfNode,
    isSelected,
    isAnchor,
    openPicker,
    openPath,
    closeRepo,
    refresh,
    forget,
    click: useCallback(
      (node: HistoryNode, additive: boolean) => dispatch({ type: 'select', node, additive }),
      []
    ),
    jumpToRef,
    setPanelVisible,
    togglePanel,
    focusDiff,
    ensureLoaded,
    selectFile: useCallback((path: string | null) => dispatch({ type: 'select-file', path }), []),
    setParentIndex: useCallback(
      (index: number) => dispatch({ type: 'parent-index', index }),
      []
    ),
    setDiffOptions,
    setFilesView,
    setFilesScope,
    retryFiles,
    setShowIgnored,
    startDrag,
    openInWorkingTree,
    loadAnyway: useCallback(() => requestPatch(true), [requestPatch]),
    savePanels
  }
}

function emptySummary(): WorkingSummary {
  return { hasChanges: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
}

export { DEFAULT_PANELS }
