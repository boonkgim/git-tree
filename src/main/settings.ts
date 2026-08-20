import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_DIFF_OPTIONS,
  DEFAULT_FILES_VIEW,
  DEFAULT_PANELS,
  type Settings
} from '@shared/types'

const MAX_RECENTS = 12

function defaults(): Settings {
  return {
    panels: { ...DEFAULT_PANELS },
    recents: [],
    window: { width: 1440, height: 900, maximized: false },
    diff: { ...DEFAULT_DIFF_OPTIONS },
    filesView: DEFAULT_FILES_VIEW
  }
}

/**
 * Persisted UI state. This lives in the OS application-data directory, never in
 * the repository being viewed — writing anything into the user's repository
 * would break the one invariant this app has.
 */
let settings: Settings = defaults()
let file = ''

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : fallback
}

/** Merges stored JSON over the defaults, ignoring anything malformed. */
function coerce(raw: unknown): Settings {
  const base = defaults()
  if (typeof raw !== 'object' || raw === null) return base
  const input = raw as Partial<Settings>

  if (input.panels) {
    base.panels = {
      historyHeight: clampNumber(input.panels.historyHeight, 120, 4000, base.panels.historyHeight),
      leftWidth: clampNumber(input.panels.leftWidth, 200, 4000, base.panels.leftWidth),
      filesHeight: clampNumber(input.panels.filesHeight, 80, 4000, base.panels.filesHeight)
    }
  }
  if (Array.isArray(input.recents)) {
    base.recents = input.recents.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS)
  }
  if (input.window) {
    base.window = {
      width: clampNumber(input.window.width, 640, 20000, base.window.width),
      height: clampNumber(input.window.height, 480, 20000, base.window.height),
      x: typeof input.window.x === 'number' ? input.window.x : undefined,
      y: typeof input.window.y === 'number' ? input.window.y : undefined,
      maximized: input.window.maximized === true
    }
  }
  if (input.diff) {
    base.diff = {
      context:
        input.diff.context === 'all'
          ? 'all'
          : clampNumber(input.diff.context, 0, 100000, base.diff.context as number),
      ignoreWhitespace: input.diff.ignoreWhitespace === true
    }
  }
  if (input.filesView === 'flat' || input.filesView === 'tree') base.filesView = input.filesView
  return base
}

export function loadSettings(): Settings {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    settings = coerce(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    settings = defaults()
  }
  return settings
}

export function getSettings(): Settings {
  return settings
}

/**
 * Writes through a temporary file and renames over the target, so a crash
 * mid-write leaves the previous settings intact instead of a truncated file.
 */
function persist(): void {
  if (!file) return
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8')
    renameSync(temp, file)
  } catch {
    // Persisting preferences is best-effort; failing to save a panel size must
    // never take the application down.
    try {
      if (existsSync(`${file}.tmp`)) unlinkSync(`${file}.tmp`)
    } catch {
      /* ignore */
    }
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  settings = coerce({ ...settings, ...patch })
  persist()
  return settings
}

export function rememberRepo(root: string): void {
  settings.recents = [root, ...settings.recents.filter((p) => p !== root)].slice(0, MAX_RECENTS)
  persist()
}

export function forgetRepo(root: string): void {
  settings.recents = settings.recents.filter((p) => p !== root)
  persist()
}
