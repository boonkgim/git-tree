import { useCallback, useMemo, useState } from 'react'
import { allRefGroupKeys, buildRefTreeRows, filterRefs, type RefTreeRow } from '@shared/reftree'
import type { RefEntry } from '@shared/types'
import type { AppApi } from '../state/store'
import { HidePanel } from './HidePanel'
import { VirtualList } from './VirtualList'

const ROW_HEIGHT = 22
/** Indentation per tree level, in px. Matches the changed-files tree. */
const INDENT = 13

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

function refTitle(entry: RefEntry): string {
  const lines = [entry.name, `${entry.sha.slice(0, 7)} · ${formatDate(entry.date)}`]
  if (entry.subject) lines.push(entry.subject)
  if (entry.upstreamGone) lines.push(`upstream ${entry.upstream ?? ''} is gone`.trim())
  else if (entry.upstream) lines.push(`tracks ${entry.upstream}`)
  return lines.join('\n')
}

/**
 * Ahead/behind against the upstream, when there is one.
 *
 * Git reports this from the last fetch, not from the network — nothing here
 * reaches out to a remote — so it is as current as the user's own `git fetch`.
 */
function Track({ entry }: { entry: RefEntry }): JSX.Element | null {
  if (entry.upstreamGone) {
    return (
      <span className="track gone" title={`Upstream ${entry.upstream ?? ''} no longer exists`}>
        gone
      </span>
    )
  }
  if (!entry.ahead && !entry.behind) return null
  return (
    <span className="track">
      {entry.ahead ? <span className="ahead">↑{entry.ahead}</span> : null}
      {entry.behind ? <span className="behind">↓{entry.behind}</span> : null}
    </span>
  )
}

/**
 * Branches, remote-tracking branches and tags, with the tree nested on `/` the
 * way the changed-file panel nests directories.
 *
 * Clicking a ref moves the history to the commit it points at. It does not
 * check anything out: this application only ever reads, so "jump to a branch"
 * means the view goes there, not the working tree.
 */
export function RefsPanel({ api }: { api: AppApi }): JSX.Element {
  const { state, jumpToRef } = api
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => filterRefs(state.refs, query), [state.refs, query])
  const filtering = query.trim().length > 0

  // A filtered list is already short, and leaving a match hidden inside a
  // collapsed group would make the search look like it had failed.
  const rows = useMemo(
    () => buildRefTreeRows(filtered, filtering ? new Set() : collapsed),
    [filtered, filtering, collapsed]
  )

  const anyExpanded = rows.some((row) => row.kind !== 'ref' && !row.collapsed)

  const toggleAll = useCallback(() => {
    setCollapsed(anyExpanded ? new Set(allRefGroupKeys(state.refs)) : new Set())
  }, [anyExpanded, state.refs])

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Every ref at the selected commit is marked, not just one: several branches
  // and tags pointing at the same commit is normal, and picking one of them to
  // highlight would be arbitrary.
  const selectedSha =
    state.selection && !state.selection.other && state.selection.anchor.kind === 'commit'
      ? state.selection.anchor.sha
      : null

  const onFilterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setQuery('')
        return
      }
      if (event.key !== 'Enter') return
      // Enter takes the first match, so filtering to one branch and pressing
      // Enter is the whole interaction.
      const first = rows.find((row): row is Extract<RefTreeRow, { kind: 'ref' }> => row.kind === 'ref')
      if (first) jumpToRef(first.entry)
    },
    [rows, jumpToRef]
  )

  const renderRow = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return null

      if (row.kind === 'section') {
        return (
          <div
            key={row.key}
            className={`rrow rsection${row.collapsed ? ' collapsed' : ''}`}
            style={{ height: ROW_HEIGHT }}
            onMouseDown={() => toggle(row.key)}
            title={row.collapsed ? `Expand ${row.label}` : `Collapse ${row.label}`}
          >
            <span className="twisty">{row.collapsed ? '▸' : '▾'}</span>
            <span className="rsection-label">{row.label}</span>
            <span className="counts dim">{row.count}</span>
          </div>
        )
      }

      if (row.kind === 'group') {
        return (
          <div
            key={row.key}
            className={`rrow rgroup${row.collapsed ? ' collapsed' : ''}`}
            style={{ height: ROW_HEIGHT, paddingLeft: 8 + (row.depth + 1) * INDENT }}
            onMouseDown={() => toggle(row.key)}
            title={row.collapsed ? `Expand ${row.label}` : `Collapse ${row.label}`}
          >
            <span className="twisty">{row.collapsed ? '▸' : '▾'}</span>
            <span className="dname">{row.label}</span>
            {row.collapsed && <span className="counts dim">{row.count}</span>}
          </div>
        )
      }

      const entry = row.entry
      const atSelection = selectedSha === entry.sha
      return (
        <div
          key={row.key}
          className={`rrow rref${atSelection ? ' selected' : ''}${entry.isHead ? ' head' : ''}`}
          style={{ height: ROW_HEIGHT, paddingLeft: 8 + (row.depth + 1) * INDENT }}
          onMouseDown={() => jumpToRef(entry)}
          title={refTitle(entry)}
          role="button"
        >
          <span className={`rdot rdot-${entry.kind}`} aria-hidden="true" />
          <span className="rname">{row.label}</span>
          {entry.isHead && (
            <span className="rhead-badge" title="HEAD is on this branch">
              HEAD
            </span>
          )}
          <Track entry={entry} />
        </div>
      )
    },
    [rows, toggle, jumpToRef, selectedSha]
  )

  const empty = state.refsError ? (
    <p className="error-text">{state.refsError.message}</p>
  ) : filtering ? (
    <p>Nothing matches “{query}”.</p>
  ) : (
    <p>This repository has no branches or tags.</p>
  )

  return (
    <section className="panel panel-refs">
      <header className="panel-head">
        <span className="panel-title">Branches</span>
        <div className="grow" />
        {state.refs.length > 0 && (
          <button
            type="button"
            className="link dim icon-button"
            onClick={toggleAll}
            title={anyExpanded ? 'Collapse all' : 'Expand all'}
          >
            {anyExpanded ? '⊟' : '⊞'}
          </button>
        )}
        <HidePanel api={api} panel="refs" />
      </header>
      <div className="ref-filter">
        <input
          type="search"
          value={query}
          placeholder="Filter branches…"
          aria-label="Filter branches, remotes and tags"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onFilterKeyDown}
        />
      </div>
      {state.jumpNote && <p className="note">{state.jumpNote}</p>}
      <VirtualList count={rows.length} rowHeight={ROW_HEIGHT} empty={empty}>
        {renderRow}
      </VirtualList>
    </section>
  )
}
