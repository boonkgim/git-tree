import { app, BrowserWindow, Menu, shell, session as electronSession } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allSessions, closeAll, getSession } from './git/repo'
import { registerIpc } from './ipc'
import { getSettings, loadSettings, updateSettings } from './settings'
import { RepoWatcher } from './watcher'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** Host:port of the Vite dev server, so its HMR socket survives the net block. */
function devServerOrigin(): string | null {
  const url = process.env['ELECTRON_RENDERER_URL']
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function matchesHost(url: string, host: string): boolean {
  try {
    return new URL(url).host === host
  } catch {
    return false
  }
}

let mainWindow: BrowserWindow | null = null
const watchers = new Map<string, RepoWatcher>()

/**
 * The repository to open on start-up, from the environment or the command line.
 *
 * The environment variable exists because in development the process is started
 * by electron-vite, whose own CLI consumes unrecognised flags before they ever
 * reach us. `GIT_TREE_REPO=/path npm run dev` sidesteps that entirely.
 */
function initialRepo(argv: string[]): string | null {
  const fromEnv = process.env['GIT_TREE_REPO']
  if (fromEnv) {
    const resolved = path.resolve(fromEnv)
    if (existsSync(resolved)) return resolved
  }
  // A positional argument only means "open this repository" in a packaged
  // binary. In development the process is started as `electron .`, where that
  // `.` is the application directory, so honouring it would silently open the
  // wrong repository every time. `--repo=` stays explicit enough to trust
  // either way.
  return repoFromArgv(argv, app.isPackaged)
}

/**
 * Repository path given on the command line, if any.
 *
 * Counting positions is not reliable here: in development argv contains the
 * entry script, and Electron's own flags (`--remote-debugging-port`, and
 * whatever a user adds) sit anywhere among the arguments. So instead every
 * non-flag argument is tested, the entry script is skipped, and the first thing
 * that actually exists on disk wins.
 */
function repoFromArgv(argv: string[], allowPositional = true): string | null {
  const entry = argv.find((a) => a.endsWith('.js') || a.endsWith('.cjs') || a.endsWith('.mjs'))
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--repo=')) return arg.slice('--repo='.length)
    if (arg.startsWith('-')) continue
    if (!allowPositional) continue
    if (arg === entry) continue
    if (arg === '.') return process.cwd()
    const resolved = path.resolve(arg)
    if (existsSync(resolved)) return resolved
  }
  return null
}

/**
 * A repository named on the command line, handed to the renderer when it asks.
 *
 * Pull rather than push: sending it on `did-finish-load` races a page that has
 * already finished loading, and the resulting failure is a silent empty window.
 */
let pendingRepo: string | null = null

export function takePendingRepo(): string | null {
  const value = pendingRepo
  pendingRepo = null
  return value
}

/** Starts (or restarts) the `.git` watcher for an open repository. */
export function watchRepo(id: string): void {
  watchers.get(id)?.dispose()
  const repo = getSession(id)
  watchers.set(
    id,
    new RepoWatcher(repo.gitDir, () => {
      mainWindow?.webContents.send('repo:changed', { id, reason: 'git-directory' })
    })
  )
}

function createWindow(): void {
  const settings = getSettings()

  mainWindow = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    x: settings.window.x,
    y: settings.window.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f6f6f6',
    title: 'git-tree',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.cjs'),
      // The renderer is untrusted by construction: it never gets Node, never
      // gets the filesystem, and can only reach the explicit preload surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  if (settings.window.maximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const saveBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getNormalBounds()
    updateSettings({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: mainWindow.isMaximized()
      }
    })
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
  mainWindow.on('close', saveBounds)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // The working tree is not watched, so this is how edits made outside the app
  // find their way into the view.
  mainWindow.on('focus', () => {
    for (const repo of allSessions()) {
      mainWindow?.webContents.send('repo:changed', { id: repo.info.id, reason: 'focus' })
    }
  })

  // This app has nothing to navigate to. Anything trying to is a bug or worse.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void mainWindow.loadURL(devServer)
  else void mainWindow.loadFile(path.join(dirname, '../renderer/index.html'))
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-repo')
        },
        {
          label: 'Close Repository',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:close-repo')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu:refresh')
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Single instance: a second launch focuses the existing window and opens the
// repository it was given, rather than starting a competing process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const repo = repoFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (repo) mainWindow.webContents.send('menu:open-path', repo)
      else if (mainWindow.isVisible()) mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    loadSettings()

    // Nothing in this application talks to the network. Blocking it outright
    // means a mistake cannot quietly turn into a request.
    const devOrigin = app.isPackaged ? null : devServerOrigin()
    electronSession.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        callback({ cancel: !(devOrigin !== null && matchesHost(details.url, devOrigin)) })
      }
    )

    registerIpc()
    buildMenu()
    createWindow()

    pendingRepo = initialRepo(process.argv)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    for (const watcher of watchers.values()) watcher.dispose()
    watchers.clear()
    closeAll()
  })
}
