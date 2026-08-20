import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { applyClick, sameNode, selectionsEqual } from '@shared/selection'
import {
  DEFAULT_DIFF_OPTIONS,
  DEFAULT_FILES_VIEW,
  DEFAULT_PANELS,
  type ChangedFile,
  type ChangedFilesResult,
  type CommitDetail,
  type CommitSummary,
  type DiffOptions,
  type FilePatch,
  type FilesView,
  type GitTreeError,
  type HistoryNode,
  type PanelSizes,
  type RepoInfo,
  type Result,
  type Selection,
  type Settings,
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

  selectedPath: string | null
  patch: FilePatch | null
  patchLoading: boolean
  patchError: GitTreeError | null
  /** Set when the user asked for an over-sized patch anyway. */
  forcePatch: boolean

  detail: CommitDetail | null
  diff: DiffOptions
  /** Flat list or directory tree, in the changed-files panel. */
  filesView: FilesView
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
  selectedPath: null,
  patch: null,
  patchLoading: false,
  patchError: null,
  forcePatch: false,
  detail: null,
  diff: { ...DEFAULT_DIFF_OPTIONS },
  filesView: DEFAULT_FILES_VIEW
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

/* ----------------------------------------------------------------- reducer */

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'settings':
      return {
        ...state,
        settings: action.settings,
        diff: action.settings.diff,
        filesView: action.settings.filesView
      }

    case 'opening':
      return { ...state, opening: true, error: null }

    case 'opened':
      return {
        ...initialState,
        settings: state.settings,
        diff: state.diff,
        filesView: state.filesView,
        repo: action.repo,
        epoch: state.epoch + 1
      }

    case 'closed':
      return {
        ...initialState,
        settings: state.settings,
        diff: state.diff,
        filesView: state.filesView,
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
      return { ...state, parentIndex: action.index, patch: null, patchError: null, patchLoading: false }

    case 'files-start':
      return { ...state, filesLoading: true, filesError: null }

    case 'files': {
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
        forcePatch: false
      }
    }

    case 'files-error':
      return { ...state, filesLoading: false, filesError: action.error, files: null, patch: null }

    case 'select-file':
      return {
        ...state,
        selectedPath: action.path,
        patch: null,
        patchError: null,
        // A request still in flight for the previous file is abandoned by the
        // sequence check, so its loading state must not be left behind.
        patchLoading: false,
        forcePatch: false
      }

    case 'patch-start':
      return { ...state, patchLoading: true, patchError: null, forcePatch: action.force }

    case 'patch':
      return { ...state, patch: action.patch, patchLoading: false }

    case 'patch-error':
      return { ...state, patchLoading: false, patchError: action.error, patch: null }

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
  ensureLoaded: (lastVisible: number) => void
  selectFile: (path: string | null) => void
  setParentIndex: (index: number) => void
  setDiffOptions: (options: Partial<DiffOptions>) => void
  setFilesView: (view: FilesView) => void
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

  // First page and working-tree summary, as soon as a repository opens.
  useEffect(() => {
    const repo = state.repo
    if (!repo) return
    loadPage(repo.id, 0)
    void window.gitTree
      .statusSummary(repo.id)
      .then(unwrap)
      .then((working) => dispatch({ type: 'working', working }))
      .catch(() => dispatch({ type: 'working', working: emptySummary() }))
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
    const file = s.files?.files.find((f) => f.path === s.selectedPath)
    if (!s.repo || !s.selection || !file) return
    const seq = ++patchSeq.current
    dispatch({ type: 'patch-start', force })
    void window.gitTree
      .filePatch(
        s.repo.id,
        s.selection,
        s.parentIndex,
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
    if (!state.repo || !state.selection || !state.selectedPath) return
    if (state.patch || state.patchLoading || state.patchError) return
    if (!state.files?.files.some((f) => f.path === state.selectedPath)) return
    requestPatch(false)
  }, [
    state.repo,
    state.selection,
    state.selectedPath,
    state.files,
    state.patch,
    state.patchLoading,
    state.patchError,
    requestPatch
  ])

  /* -------- external change / menu -------- */
  useEffect(() => {
    const off = window.gitTree.onRepoChanged(({ id, reason }) => {
      const s = stateRef.current
      if (!s.repo || s.repo.id !== id) return
      if (reason === 'focus') {
        // Focus only re-reads the working tree; history cannot change without
        // something touching .git, which the watcher already covers.
        void window.gitTree
          .statusSummary(id)
          .then(unwrap)
          .then((working) => dispatch({ type: 'working', working }))
          .catch(() => undefined)
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
    })
    return off
  }, [openPicker, closeRepo, refresh, openPath])

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

  const setFilesView = useCallback((view: FilesView) => {
    dispatch({ type: 'files-view', view })
    void window.gitTree.setSettings({ filesView: view })
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
    ensureLoaded,
    selectFile: useCallback((path: string | null) => dispatch({ type: 'select-file', path }), []),
    setParentIndex: useCallback(
      (index: number) => dispatch({ type: 'parent-index', index }),
      []
    ),
    setDiffOptions,
    setFilesView,
    loadAnyway: useCallback(() => requestPatch(true), [requestPatch]),
    savePanels
  }
}

function emptySummary(): WorkingSummary {
  return { hasChanges: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
}

export { DEFAULT_PANELS }
