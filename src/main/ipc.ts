import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
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
  WorkingSummary
} from '@shared/types'
import { toGitTreeError } from './git/exec'
import { changedFiles } from './git/files'
import { mediaPreview } from './git/media'
import { filePatch } from './git/patch'
import { listRefs } from './git/refs'
import { getSession, openRepo, refreshSession } from './git/repo'
import { readSummary } from './git/status'
import { commitDetail } from './git/detail'
import { openInWorkingTree } from './open'
import { forgetRepo, getSettings, rememberRepo, updateSettings } from './settings'
import { takePendingRepo, watchRepo } from './index'

/**
 * Wraps a handler so the renderer always receives a `Result` and never an
 * exception. An unexplained rejected promise in the renderer would surface as a
 * blank panel, which is exactly the failure mode the brief calls out.
 */
function handle<Args extends unknown[], T>(
  channel: string,
  fn: (...args: Args) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...(args as Args)) }
    } catch (e) {
      return { ok: false, error: toGitTreeError(e) }
    }
  })
}

export function registerIpc(): void {
  // Asked for once on start-up; returns a path given on the command line.
  handle('repo:initial', (): string | null => takePendingRepo())

  handle('repo:pick', async (): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(window, {
      title: 'Open Repository',
      properties: ['openDirectory'],
      buttonLabel: 'Open'
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  handle('repo:open', async (repoPath: string): Promise<RepoInfo> => {
    const info = await openRepo(repoPath)
    rememberRepo(info.root)
    watchRepo(info.id)
    return info
  })

  handle('repo:refresh', async (id: string): Promise<RepoInfo> => refreshSession(id))

  handle('repo:forget', (root: string): Settings => {
    forgetRepo(root)
    return getSettings()
  })

  handle(
    'history:page',
    async (id: string, offset: number, limit: number): Promise<HistoryPage> =>
      getSession(id).log.page(Math.max(0, offset | 0), Math.min(Math.max(1, limit | 0), 5000))
  )

  handle('refs:list', async (id: string): Promise<RefEntry[]> => listRefs(getSession(id).info.root))

  // The index a commit sits at in the history walk, so the sidebar can scroll
  // to a ref tip the renderer has not paged in yet. -1 when it is not there.
  handle(
    'history:index-of',
    async (id: string, sha: string): Promise<number> => getSession(id).log.indexOf(sha)
  )

  handle(
    'status:summary',
    async (id: string): Promise<WorkingSummary> => readSummary(getSession(id).info.root)
  )

  handle(
    'commit:detail',
    async (id: string, sha: string): Promise<CommitDetail> => commitDetail(getSession(id), sha)
  )

  handle(
    'diff:files',
    async (
      id: string,
      selection: Selection,
      parentIndex: number,
      options: DiffOptions
    ): Promise<ChangedFilesResult> =>
      changedFiles(getSession(id), selection, parentIndex, options)
  )

  handle(
    'diff:file',
    async (
      id: string,
      selection: Selection,
      parentIndex: number,
      file: Parameters<typeof filePatch>[1]['file'],
      options: DiffOptions,
      force: boolean
    ): Promise<FilePatch> =>
      filePatch(getSession(id), { selection, parentIndex, file, options, force })
  )

  // Both sides of an image, video or sound file, as data URLs. Only ever asked
  // for a path the renderer has already recognised as displayable.
  handle(
    'diff:media',
    async (
      id: string,
      selection: Selection,
      parentIndex: number,
      file: Parameters<typeof mediaPreview>[1]['file']
    ): Promise<MediaPreview> =>
      mediaPreview(getSession(id), { selection, parentIndex, file })
  )

  // A file or folder from the changed-files panel, handed to the desktop's
  // default application. The path is relative to the repository root and is
  // validated against it before anything is opened.
  handle(
    'open:working-tree',
    async (id: string, relativePath: string): Promise<null> => {
      await openInWorkingTree(getSession(id).info.root, relativePath)
      return null
    }
  )

  handle('settings:get', (): Settings => getSettings())
  handle('settings:set', (patch: Partial<Settings>): Settings => updateSettings(patch))
}
