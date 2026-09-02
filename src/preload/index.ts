import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ChangedFile,
  ChangedFilesResult,
  CommitDetail,
  DiffOptions,
  FilePatch,
  HistoryPage,
  MediaPreview,
  RefEntry,
  RepoInfo,
  Result,
  Selection,
  Settings,
  WorkingFilesResult,
  WorkingSummary
} from '@shared/types'

/**
 * The entire surface the renderer is given. Every method is a request for data;
 * there is no path here that reaches the filesystem, spawns a process, or lets
 * the renderer name a git command of its own.
 */
const api = {
  /** A repository named on the command line, or null. Answers once. */
  initialRepo: (): Promise<Result<string | null>> => ipcRenderer.invoke('repo:initial'),
  pickRepo: (): Promise<Result<string | null>> => ipcRenderer.invoke('repo:pick'),
  openRepo: (path: string): Promise<Result<RepoInfo>> => ipcRenderer.invoke('repo:open', path),
  refreshRepo: (id: string): Promise<Result<RepoInfo>> => ipcRenderer.invoke('repo:refresh', id),
  forgetRepo: (root: string): Promise<Result<Settings>> => ipcRenderer.invoke('repo:forget', root),

  historyPage: (id: string, offset: number, limit: number): Promise<Result<HistoryPage>> =>
    ipcRenderer.invoke('history:page', id, offset, limit),

  listRefs: (id: string): Promise<Result<RefEntry[]>> => ipcRenderer.invoke('refs:list', id),

  /** Where a commit sits in the history walk, or -1 if it is not in it. */
  historyIndexOf: (id: string, sha: string): Promise<Result<number>> =>
    ipcRenderer.invoke('history:index-of', id, sha),

  statusSummary: (id: string): Promise<Result<WorkingSummary>> =>
    ipcRenderer.invoke('status:summary', id),

  commitDetail: (id: string, sha: string): Promise<Result<CommitDetail>> =>
    ipcRenderer.invoke('commit:detail', id, sha),

  changedFiles: (
    id: string,
    selection: Selection,
    parentIndex: number,
    options: DiffOptions
  ): Promise<Result<ChangedFilesResult>> =>
    ipcRenderer.invoke('diff:files', id, selection, parentIndex, options),

  /**
   * Every file in the working tree, for the project-pane view. Takes no
   * selection: it is a picture of the disk, not of a comparison.
   */
  workingFiles: (id: string, includeIgnored: boolean): Promise<Result<WorkingFilesResult>> =>
    ipcRenderer.invoke('files:working', id, includeIgnored),

  filePatch: (
    id: string,
    selection: Selection,
    parentIndex: number,
    file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>,
    options: DiffOptions,
    force = false
  ): Promise<Result<FilePatch>> =>
    ipcRenderer.invoke('diff:file', id, selection, parentIndex, file, options, force),

  /**
   * The filesystem path of a dropped folder. `File.path` was removed from
   * Electron, so this is the supported way to resolve one, and it stays in the
   * preload because the renderer must never be handed filesystem access.
   */
  pathForDroppedFile: (file: File): string | null => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },

  /** Both sides of an image, video or sound file, as `data:` URLs. */
  mediaPreview: (
    id: string,
    selection: Selection,
    parentIndex: number,
    file: Pick<ChangedFile, 'path' | 'oldPath' | 'status' | 'untracked'>
  ): Promise<Result<MediaPreview>> =>
    ipcRenderer.invoke('diff:media', id, selection, parentIndex, file),

  /**
   * Opens a path inside the working tree with the desktop's default
   * application. `relativePath` is relative to the repository root; the main
   * process refuses anything that resolves outside it.
   */
  openInWorkingTree: (id: string, relativePath: string): Promise<Result<null>> =>
    ipcRenderer.invoke('open:working-tree', id, relativePath),

  /**
   * Hands an in-progress drag over to the OS as a file drag, so a row can be
   * dropped on a terminal — which pastes its path — or on any other
   * application. Fire-and-forget on purpose: `startDrag` has to run while the
   * renderer's `dragstart` handler is still on the stack, and awaiting a reply
   * would be too late. `relativePath` is checked against the repository root in
   * the main process, exactly as opening is.
   */
  startDrag: (id: string, relativePath: string): void => {
    ipcRenderer.send('drag:start', id, relativePath)
  },

  getSettings: (): Promise<Result<Settings>> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Result<Settings>> =>
    ipcRenderer.invoke('settings:set', patch),

  /** Repository changed on disk, or the window regained focus. */
  onRepoChanged: (fn: (payload: { id: string; reason: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { id: string; reason: string }): void => fn(payload)
    ipcRenderer.on('repo:changed', listener)
    return () => ipcRenderer.removeListener('repo:changed', listener)
  },

  /** Menu commands, forwarded so the renderer owns all UI decisions. */
  onMenu: (fn: (command: string, argument?: string) => void): (() => void) => {
    const channels = [
      'menu:open-repo',
      'menu:close-repo',
      'menu:refresh',
      'menu:open-path',
      'menu:toggle-panel',
      'menu:focus-diff'
    ]
    const listeners = channels.map((channel) => {
      const listener = (_e: unknown, argument?: string): void => fn(channel, argument)
      ipcRenderer.on(channel, listener)
      return [channel, listener] as const
    })
    return () => {
      for (const [channel, listener] of listeners) ipcRenderer.removeListener(channel, listener)
    }
  }
}

export type GitTreeApi = typeof api

contextBridge.exposeInMainWorld('gitTree', api)
