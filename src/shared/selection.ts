import type { HistoryNode, Selection } from './types'

/**
 * The selection model, independent of both the UI and of git.
 *
 * `applyClick` decides what the user's click means; `resolveSelection` (in the
 * main process) decides what the resulting selection compares. Keeping them
 * apart is what lets the click rules be tested without a window and the
 * comparison rules be tested without a repository.
 */

export function sameNode(a: HistoryNode, b: HistoryNode): boolean {
  if (a.kind === 'working' || b.kind === 'working') return a.kind === b.kind
  return a.sha === b.sha
}

/** The selected nodes, de-duplicated, as a stable array of one or two items. */
export function selectedNodes(selection: Selection): HistoryNode[] {
  const { anchor, other } = selection
  if (!other || sameNode(anchor, other)) return [anchor]
  return [anchor, other]
}

export function selectionsEqual(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b) return a === b
  const left = selectedNodes(a)
  const right = selectedNodes(b)
  if (left.length !== right.length) return false
  return left.every((node, i) => sameNode(node, right[i]))
}

/**
 * How a click changes the selection.
 *
 * The rules, and why:
 *  - A plain click always collapses to that one row. Anything else would let a
 *    stray click silently keep an old comparison alive.
 *  - Ctrl/Cmd+Click on a new row sets the *second* end, leaving the anchor
 *    pinned. A third such click therefore sweeps the second end around a fixed
 *    reference point, which is what people want when comparing several commits
 *    against one.
 *  - Ctrl/Cmd+Click on an already-selected row removes it, and the survivor
 *    becomes the anchor.
 *  - The selection is never empty; removing the last row is a no-op.
 */
export function applyClick(
  selection: Selection | null,
  node: HistoryNode,
  additive: boolean
): Selection {
  if (!additive || !selection) return { anchor: node }

  const { anchor, other } = selection

  if (sameNode(node, anchor)) {
    return other ? { anchor: other } : selection
  }
  if (other && sameNode(node, other)) {
    return { anchor }
  }
  return { anchor, other: node }
}
