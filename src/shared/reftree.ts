/**
 * Turning the flat ref list into the rows the sidebar draws.
 *
 * Ref names are already a path — `feature/login`, `origin/release/2.1` — so the
 * sidebar groups them the same way the changed-file panel groups directories,
 * for the same reason: on a repository with sixty branches the shared prefixes
 * are most of the pixels and none of the information. As with the file tree the
 * result is a flat array rather than a nested structure, because the panel is
 * windowed and the renderer needs something it can address by index.
 */

import type { RefEntry } from './types'

export type RefSection = 'branch' | 'remote' | 'tag'

/** The order sections appear in, and what they are called. */
export const REF_SECTIONS: ReadonlyArray<{ section: RefSection; label: string }> = [
  { section: 'branch', label: 'Branches' },
  { section: 'remote', label: 'Remotes' },
  { section: 'tag', label: 'Tags' }
]

export type RefTreeRow =
  | {
      kind: 'section'
      section: RefSection
      /** Collapse key, unique across the whole tree. */
      key: string
      label: string
      collapsed: boolean
      /** Refs anywhere beneath it. */
      count: number
    }
  | {
      kind: 'group'
      section: RefSection
      key: string
      /** What to show: several segments when a single-child chain was folded. */
      label: string
      depth: number
      collapsed: boolean
      count: number
    }
  | {
      kind: 'ref'
      section: RefSection
      key: string
      entry: RefEntry
      /** The last segment; the rest of the name is spent on indentation. */
      label: string
      depth: number
    }

interface Node {
  name: string
  /** Path within the section, e.g. `feature/login`. */
  path: string
  groups: Map<string, Node>
  refs: RefEntry[]
}

function newNode(name: string, path: string): Node {
  return { name, path, groups: new Map(), refs: [] }
}

/** Byte-ish ordering, so the result does not depend on the user's locale. */
function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function countRefs(node: Node): number {
  let total = node.refs.length
  for (const group of node.groups.values()) total += countRefs(group)
  return total
}

/** The collapse key for a section, or for a group within one. */
export function sectionKey(section: RefSection): string {
  return `${section}:`
}

export function groupKey(section: RefSection, path: string): string {
  return `${section}:${path}`
}

function build(entries: readonly RefEntry[]): Node {
  const root = newNode('', '')
  for (const entry of entries) {
    const segments = entry.name.split('/').filter((s) => s !== '')
    // A ref name never ends in a slash, so there is always a last segment.
    segments.pop()
    let node = root
    for (const segment of segments) {
      const path = node.path ? `${node.path}/${segment}` : segment
      let next = node.groups.get(segment)
      if (!next) {
        next = newNode(segment, path)
        node.groups.set(segment, next)
      }
      node = next
    }
    node.refs.push(entry)
  }
  return root
}

function emit(
  node: Node,
  section: RefSection,
  depth: number,
  collapsed: ReadonlySet<string>,
  out: RefTreeRow[]
): void {
  const groups = [...node.groups.values()].sort(byName)
  for (const group of groups) {
    // Fold a chain of groups that each hold nothing but the next one into a
    // single `release/candidates` row, exactly as the file tree does.
    let last = group
    let label = group.name
    while (last.refs.length === 0 && last.groups.size === 1) {
      const [only] = last.groups.values()
      label += `/${only.name}`
      last = only
    }
    const key = groupKey(section, last.path)
    const isCollapsed = collapsed.has(key)
    out.push({
      kind: 'group',
      section,
      key,
      label,
      depth,
      collapsed: isCollapsed,
      count: countRefs(last)
    })
    if (!isCollapsed) emit(last, section, depth + 1, collapsed, out)
  }
  for (const entry of [...node.refs].sort(byName)) {
    const segments = entry.name.split('/')
    out.push({
      kind: 'ref',
      section,
      key: `${section}:${entry.name}`,
      entry,
      label: segments[segments.length - 1] || entry.name,
      depth
    })
  }
}

/**
 * The visible rows, in display order.
 *
 * A section with nothing in it is left out entirely rather than shown as a
 * header over nothing: a repository with no tags should not spend a row saying
 * so, and while a filter is running an empty section would read as a match.
 */
export function buildRefTreeRows(
  entries: readonly RefEntry[],
  collapsed: ReadonlySet<string> = new Set()
): RefTreeRow[] {
  const rows: RefTreeRow[] = []
  for (const { section, label } of REF_SECTIONS) {
    const mine = entries.filter((entry) => entry.kind === section)
    if (mine.length === 0) continue
    const key = sectionKey(section)
    const isCollapsed = collapsed.has(key)
    rows.push({ kind: 'section', section, key, label, collapsed: isCollapsed, count: mine.length })
    if (!isCollapsed) emit(build(mine), section, 0, collapsed, rows)
  }
  return rows
}

/**
 * Case-insensitive substring match on the ref name.
 *
 * Deliberately not a fuzzy match: the names being searched are short and
 * structured, and a fuzzy match on `main` that also returns `my-first-branch`
 * costs more attention than it saves.
 */
export function filterRefs(entries: readonly RefEntry[], query: string): RefEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle))
}

/** Every group and section key, for "collapse all". */
export function allRefGroupKeys(entries: readonly RefEntry[]): string[] {
  return buildRefTreeRows(entries).flatMap((row) => (row.kind === 'ref' ? [] : [row.key]))
}
