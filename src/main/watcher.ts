import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

/**
 * Watches the parts of `.git` that change when history changes.
 *
 * Deliberately narrow: watching the working tree recursively is expensive on
 * large repositories and on platforms without native recursive watching, and it
 * would fire constantly during a build. Working-tree changes are instead picked
 * up when the window regains focus or when the user refreshes, which is
 * documented behaviour rather than an oversight.
 */
export class RepoWatcher {
  private watchers: FSWatcher[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    gitDir: string,
    private readonly onChange: () => void,
    private readonly debounceMs = 400
  ) {
    this.add(gitDir, false)
    this.add(path.join(gitDir, 'refs'), true)
  }

  private add(target: string, recursive: boolean): void {
    try {
      const watcher = watch(target, { recursive, persistent: false }, () => this.schedule())
      watcher.on('error', () => {
        /* a watcher dying must not take the app with it */
      })
      this.watchers.push(watcher)
    } catch {
      // Missing directory, or a platform that cannot watch recursively. The
      // focus-based refresh still covers the user.
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onChange()
    }, this.debounceMs)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const watcher of this.watchers) {
      try {
        watcher.close()
      } catch {
        /* ignore */
      }
    }
    this.watchers = []
  }
}
