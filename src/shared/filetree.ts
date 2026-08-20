/**
 * Grouping the changed-file list by directory.
 *
 * The flat list is the honest one — it is exactly what Git reported, in Git's
 * order — but on a change that spans forty files in a dozen directories the
 * shared prefixes are most of the pixels and none of the information. This
 * turns the same list into a tree and flattens it straight back out into rows,
 * because the panel is windowed: the renderer needs an addressable array, not a
 * nested structure it would have to walk on every scroll.
 */

import type { ChangedFile } from './types'

export type FileTreeRow =
  | {
      kind: 'dir'
      /** Full path of the directory, used as its collapse key. */
      path: string
      /** What to show: several segments when a single-child chain was folded. */
      label: string
      depth: number
      collapsed: boolean
      /** Files anywhere beneath it, shown while it is collapsed. */
      fileCount: number
    }
  | { kind: 'file'; depth: number; file: ChangedFile; name: string }

interface DirNode {
  name: string
  path: string
  dirs: Map<string, DirNode>
  files: Array<{ file: ChangedFile; name: string }>
}

function newDir(name: string, path: string): DirNode {
  return { name, path, dirs: new Map(), files: [] }
}

/** Byte-ish ordering, so the result does not depend on the user's locale. */
function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function countFiles(node: DirNode): number {
  let total = node.files.length
  for (const dir of node.dirs.values()) total += countFiles(dir)
  return total
}

function build(files: ChangedFile[]): DirNode {
  const root = newDir('', '')
  for (const file of files) {
    // Git always reports '/'-separated paths, on Windows too.
    const segments = file.path.split('/').filter((s) => s !== '')
    const name = segments.pop() ?? file.path
    let node = root
    for (const segment of segments) {
      const path = node.path ? `${node.path}/${segment}` : segment
      let next = node.dirs.get(segment)
      if (!next) {
        next = newDir(segment, path)
        node.dirs.set(segment, next)
      }
      node = next
    }
    node.files.push({ file, name })
  }
  return root
}

function emit(
  node: DirNode,
  depth: number,
  collapsed: ReadonlySet<string>,
  out: FileTreeRow[]
): void {
  const dirs = [...node.dirs.values()].sort(byName)
  for (const dir of dirs) {
    // Fold a chain of directories that each hold nothing but the next one into
    // a single `src/renderer/components` row. Repositories are full of these,
    // and a row per empty level is indentation bought with no information.
    let last = dir
    let label = dir.name
    while (last.files.length === 0 && last.dirs.size === 1) {
      const [only] = last.dirs.values()
      label += `/${only.name}`
      last = only
    }
    // The key is the deepest folded segment, so a chain keeps one stable key
    // whether or not the fold happens to apply on the next comparison.
    const isCollapsed = collapsed.has(last.path)
    out.push({
      kind: 'dir',
      path: last.path,
      label,
      depth,
      collapsed: isCollapsed,
      fileCount: countFiles(last)
    })
    if (!isCollapsed) emit(last, depth + 1, collapsed, out)
  }
  for (const entry of [...node.files].sort(byName)) {
    out.push({ kind: 'file', depth, file: entry.file, name: entry.name })
  }
}

/**
 * The visible rows for the tree view, in display order: directories before
 * files at each level, both alphabetical. Files under a collapsed directory are
 * absent rather than hidden, so the row count is the scroll height.
 */
export function buildFileTreeRows(
  files: ChangedFile[],
  collapsed: ReadonlySet<string> = new Set()
): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  emit(build(files), 0, collapsed, rows)
  return rows
}

/** Every directory key in the tree, for "collapse all". */
export function allDirPaths(files: ChangedFile[]): string[] {
  return buildFileTreeRows(files).flatMap((row) => (row.kind === 'dir' ? [row.path] : []))
}

/** The folded directory keys that contain `path`, for revealing a file. */
export function ancestorDirPaths(files: ChangedFile[], path: string): string[] {
  const out: string[] = []
  for (const row of buildFileTreeRows(files)) {
    if (row.kind !== 'dir') continue
    if (path === row.path || path.startsWith(`${row.path}/`)) out.push(row.path)
  }
  return out
}
