import { useCallback, useMemo, useRef } from 'react'
import type { HistoryNode, RefLabel } from '@shared/types'
import type { AppApi } from '../state/store'
import { GraphCell, gutterWidth, useGraphRows } from './Graph'
import { VirtualList } from './VirtualList'

export const HISTORY_ROW_HEIGHT = 26

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

function RefChip({ label }: { label: RefLabel }): JSX.Element {
  return (
    <span className={`ref ref-${label.kind}${label.isHead ? ' ref-current' : ''}`} title={label.name}>
      {label.kind === 'tag' ? '⌂ ' : '⑂ '}
      {label.name}
    </span>
  )
}

/**
 * The commit graph and list.
 *
 * Uncommitted changes are the first row and behave like any other: they can be
 * clicked, Ctrl/Cmd+clicked, and reached with the arrow keys, because the brief
 * asks for them to be "just the last node in the history".
 */
export function HistoryPanel({ api }: { api: AppApi }): JSX.Element {
  const { state, rowAt, rowCount, hasWorkingRow, isSelected, isAnchor, click, ensureLoaded } = api
  const graphRows = useGraphRows(state.commits, state.epoch)
  const listRef = useRef<HTMLDivElement>(null)

  const width = useMemo(() => {
    let max = 1
    // Sampling the loaded rows keeps the gutter stable while scrolling instead
    // of shifting every time a wider section comes into view.
    for (const row of graphRows) if (row.width > max) max = row.width
    return gutterWidth(max)
  }, [graphRows])

  const onRowClick = useCallback(
    (node: HistoryNode, event: React.MouseEvent) => {
      click(node, event.metaKey || event.ctrlKey)
    },
    [click]
  )

  const focusedIndex = state.selection ? api.indexOfNode(state.selection.anchor) : -1

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const next = Math.min(
        Math.max(focusedIndex + (event.key === 'ArrowDown' ? 1 : -1), 0),
        rowCount - 1
      )
      const row = rowAt(next)
      if (!row) return
      click(row.kind === 'working' ? { kind: 'working' } : { kind: 'commit', sha: row.commit.sha }, false)
    },
    [focusedIndex, rowCount, rowAt, click]
  )

  const renderRow = useCallback(
    (index: number) => {
      const row = rowAt(index)
      if (!row) {
        return (
          <div className="hrow hrow-placeholder" key={`placeholder-${index}`} style={{ height: HISTORY_ROW_HEIGHT }}>
            <span className="dim">Loading…</span>
          </div>
        )
      }

      if (row.kind === 'working') {
        const node: HistoryNode = { kind: 'working' }
        const selected = isSelected(node)
        const w = state.working
        const parts = [
          w?.staged ? `${w.staged} staged` : null,
          w?.unstaged ? `${w.unstaged} unstaged` : null,
          w?.untracked ? `${w.untracked} untracked` : null,
          w?.conflicted ? `${w.conflicted} conflicted` : null
        ].filter(Boolean)
        return (
          <div
            key="working"
            className={`hrow hrow-working${selected ? ' selected' : ''}${isAnchor(node) ? ' anchor' : ''}`}
            style={{ height: HISTORY_ROW_HEIGHT }}
            onMouseDown={(e) => onRowClick(node, e)}
            role="row"
            aria-selected={selected}
          >
            <div className="hgraph" style={{ width }}>
              <GraphCell
                row={null}
                working
                workingLane={graphRows[0]?.lane ?? 0}
                height={HISTORY_ROW_HEIGHT}
                width={width}
                selected={selected}
              />
            </div>
            <div className="hdesc">
              <span className="ref ref-working">Uncommitted changes</span>
              <span className="dim">{parts.join(' · ') || 'no changes'}</span>
            </div>
            <div className="hsha dim">—</div>
            <div className="hauthor dim">—</div>
            <div className="hdate dim">now</div>
          </div>
        )
      }

      const commit = row.commit
      const node: HistoryNode = { kind: 'commit', sha: commit.sha }
      const selected = isSelected(node)
      const graphIndex = hasWorkingRow ? index - 1 : index
      return (
        <div
          key={commit.sha}
          className={`hrow${selected ? ' selected' : ''}${isAnchor(node) ? ' anchor' : ''}`}
          style={{ height: HISTORY_ROW_HEIGHT }}
          onMouseDown={(e) => onRowClick(node, e)}
          role="row"
          aria-selected={selected}
          title={commit.subject}
        >
          <div className="hgraph" style={{ width }}>
            <GraphCell
              row={graphRows[graphIndex] ?? null}
              height={HISTORY_ROW_HEIGHT}
              width={width}
              selected={selected}
            />
          </div>
          <div className="hdesc">
            {commit.refs.map((label) => (
              <RefChip key={`${label.kind}:${label.name}`} label={label} />
            ))}
            {commit.parents.length > 1 && <span className="merge-badge">merge</span>}
            <span className="subject">{commit.subject || '(no message)'}</span>
          </div>
          <div className="hsha mono">{commit.sha.slice(0, 7)}</div>
          <div className="hauthor">{commit.authorName}</div>
          <div className="hdate">{formatDate(commit.committerDate)}</div>
        </div>
      )
    },
    [rowAt, isSelected, isAnchor, onRowClick, width, graphRows, hasWorkingRow, state.working]
  )

  return (
    <section className="panel panel-history">
      <header className="panel-head">
        <span className="panel-title">History</span>
        <span className="dim">
          {state.commits.length.toLocaleString()} commit{state.commits.length === 1 ? '' : 's'}
          {state.historyDone ? '' : state.loadingPage ? ' · loading more…' : ' · more below'}
        </span>
        <div className="grow" />
        <span className="columns-legend">
          <span className="hsha">Commit</span>
          <span className="hauthor">Author</span>
          <span className="hdate">Date</span>
        </span>
      </header>
      <div ref={listRef} className="history-body" tabIndex={0} onKeyDown={onKeyDown} role="grid">
        <VirtualList
          count={rowCount}
          rowHeight={HISTORY_ROW_HEIGHT}
          onReachEnd={ensureLoaded}
          scrollToIndex={focusedIndex}
          empty={
            state.repo?.unborn ? (
              <p>
                This repository has no commits yet. Anything in the working tree shows up as
                uncommitted changes.
              </p>
            ) : (
              <p>No commits to show.</p>
            )
          }
        >
          {renderRow}
        </VirtualList>
      </div>
    </section>
  )
}
