import { Fragment, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PANELS,
  PANEL_KEYS,
  PANEL_LABELS,
  type PanelSizes,
  type PanelVisibility
} from '@shared/types'
import { DiffPanel } from './components/DiffPanel'
import { FilesPanel } from './components/FilesPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { MetadataPanel } from './components/MetadataPanel'
import { RefsPanel } from './components/RefsPanel'
import { Splitter } from './components/Splitter'
import { Welcome } from './components/Welcome'
import { useGitTree } from './state/store'

/** Sentences for the states a repository can be in that the user should know about. */
function repoNotice(api: ReturnType<typeof useGitTree>): string | null {
  const repo = api.state.repo
  if (!repo) return null
  if (repo.operation === 'rebase') return 'A rebase is in progress in this repository.'
  if (repo.operation === 'merge') return 'A merge is in progress; some files may have conflicts.'
  if (repo.operation === 'cherry-pick') return 'A cherry-pick is in progress.'
  if (repo.operation === 'revert') return 'A revert is in progress.'
  if (repo.operation === 'bisect') return 'A bisect is in progress.'
  if (repo.bare) return 'This is a bare repository, so there is no working tree to compare against.'
  if (repo.detached) return `HEAD is detached at ${repo.head?.slice(0, 7) ?? 'an unknown commit'}.`
  return null
}

interface Pane {
  key: string
  visible: boolean
  /**
   * `fill` is set for the last visible pane, which takes whatever space the
   * ones before it left; every other pane is drawn at its stored size.
   */
  render: (fill: boolean) => JSX.Element
  /** The splitter that resizes this pane, when one follows it. */
  splitter?: JSX.Element
}

/**
 * Lays panes out along a flex container, putting a splitter between each
 * adjacent visible pair.
 *
 * Hiding a panel has to take its splitter with it. A splitter resizes the pane
 * before it by giving space to the pane after it, so with nothing visible on
 * the far side there is nothing for it to do — it would be a drag handle
 * pulling against the window edge. Keeping that rule here means the four
 * places panels can be hidden cannot each get it subtly wrong.
 */
function Panes({ panes }: { panes: Pane[] }): JSX.Element {
  const shown = panes.filter((pane) => pane.visible)
  return (
    <>
      {shown.map((pane, index) => {
        const last = index === shown.length - 1
        return (
          <Fragment key={pane.key}>
            {pane.render(last)}
            {!last && pane.splitter}
          </Fragment>
        )
      })}
    </>
  )
}

/** The titlebar toggles, which are also the only way a hidden panel comes back. */
function PanelToggles({
  visibility,
  onToggle
}: {
  visibility: PanelVisibility
  onToggle: (panel: (typeof PANEL_KEYS)[number]) => void
}): JSX.Element {
  return (
    <div className="segmented panel-toggles" role="group" aria-label="Panels">
      {PANEL_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={visibility[key] ? 'on' : ''}
          aria-pressed={visibility[key]}
          onClick={() => onToggle(key)}
          title={`${visibility[key] ? 'Hide' : 'Show'} the ${PANEL_LABELS[key]} panel`}
        >
          {PANEL_LABELS[key]}
        </button>
      ))}
    </div>
  )
}

export function App(): JSX.Element {
  const api = useGitTree()
  const { state } = api

  // Panel sizes live here so dragging stays at 60fps without a round trip to
  // the main process; they are persisted only when a drag ends.
  const [panels, setPanels] = useState<PanelSizes>(DEFAULT_PANELS)
  useEffect(() => {
    if (state.settings) setPanels(state.settings.panels)
  }, [state.settings])

  // A splitter's `onCommit` fires after its final `onChange` has been applied,
  // so persisting must read the newest sizes rather than the ones captured when
  // the drag began.
  const panelsRef = useRef(panels)
  panelsRef.current = panels
  // The committed value comes from the splitter itself, so it is correct even
  // when the last render has not landed yet; the other two sizes are not being
  // dragged, so reading them from the ref is safe.
  const persistPanels = (patch: Partial<PanelSizes>): void =>
    api.savePanels({ ...panelsRef.current, ...patch })

  useEffect(() => {
    document.title = state.repo ? `${state.repo.name} — git-tree` : 'git-tree'
  }, [state.repo])

  if (!state.repo) return <Welcome api={api} />

  const notice = repoNotice(api)
  const shown = state.panelVisibility
  const focused = PANEL_KEYS.every((key) => !shown[key])

  const leftColumn: Pane[] = [
    {
      key: 'files',
      visible: shown.files,
      render: (fill) => (
        <div
          className={`left-files${fill ? ' fill' : ''}`}
          style={fill ? undefined : { height: panels.filesHeight }}
        >
          <FilesPanel api={api} />
        </div>
      ),
      splitter: (
        <Splitter
          orientation="horizontal"
          value={panels.filesHeight}
          min={80}
          max={Math.max(120, window.innerHeight - 400)}
          onChange={(filesHeight) => setPanels((p) => ({ ...p, filesHeight }))}
          onCommit={(filesHeight) => persistPanels({ filesHeight })}
        />
      )
    },
    {
      key: 'metadata',
      visible: shown.metadata,
      render: () => (
        <div className="left-meta">
          <MetadataPanel api={api} />
        </div>
      )
    }
  ]

  const bottomRow: Pane[] = [
    {
      key: 'left',
      // The column is only there for what is inside it.
      visible: shown.files || shown.metadata,
      render: () => (
        <div className="column-left" style={{ width: panels.leftWidth }}>
          <Panes panes={leftColumn} />
        </div>
      ),
      splitter: (
        <Splitter
          orientation="vertical"
          value={panels.leftWidth}
          min={220}
          max={Math.max(300, window.innerWidth - 360)}
          onChange={(leftWidth) => setPanels((p) => ({ ...p, leftWidth }))}
          onCommit={(leftWidth) => persistPanels({ leftWidth })}
        />
      )
    },
    {
      key: 'diff',
      // The diff is what the window is for; it is never hidden.
      visible: true,
      render: () => (
        <div className="column-right">
          <DiffPanel api={api} />
        </div>
      )
    }
  ]

  const layoutRows: Pane[] = [
    {
      key: 'history',
      visible: shown.history,
      render: () => (
        <div className="row-history" style={{ height: panels.historyHeight }}>
          <HistoryPanel api={api} />
        </div>
      ),
      splitter: (
        <Splitter
          orientation="horizontal"
          value={panels.historyHeight}
          min={140}
          max={Math.max(200, window.innerHeight - 260)}
          onChange={(historyHeight) => setPanels((p) => ({ ...p, historyHeight }))}
          onCommit={(historyHeight) => persistPanels({ historyHeight })}
        />
      )
    },
    {
      key: 'bottom',
      visible: true,
      render: () => (
        <div className="row-bottom">
          <Panes panes={bottomRow} />
        </div>
      )
    }
  ]

  const workspace: Pane[] = [
    {
      key: 'refs',
      visible: shown.refs,
      render: () => (
        <div className="column-sidebar" style={{ width: panels.sidebarWidth }}>
          <RefsPanel api={api} />
        </div>
      ),
      splitter: (
        <Splitter
          orientation="vertical"
          value={panels.sidebarWidth}
          min={160}
          max={Math.max(200, window.innerWidth - 480)}
          onChange={(sidebarWidth) => setPanels((p) => ({ ...p, sidebarWidth }))}
          onCommit={(sidebarWidth) => persistPanels({ sidebarWidth })}
        />
      )
    },
    {
      key: 'layout',
      visible: true,
      render: () => (
        <div className="layout">
          <Panes panes={layoutRows} />
        </div>
      )
    }
  ]

  return (
    <div className="app">
      <div className="titlebar">
        <strong>{state.repo.name}</strong>
        <span className="dim mono">{state.repo.root}</span>
        <span className="chip">
          {state.repo.unborn
            ? 'no commits'
            : state.repo.detached
              ? `detached @ ${state.repo.head?.slice(0, 7)}`
              : (state.repo.branch ?? 'unknown')}
        </span>
        <div className="grow" />
        <span className="dim small">read-only</span>
        <PanelToggles visibility={shown} onToggle={api.togglePanel} />
        <button
          type="button"
          className={focused ? 'on' : ''}
          aria-pressed={focused}
          onClick={api.focusDiff}
          title="Give the diff the whole window, or put the panels back (Ctrl/Cmd+Shift+D)"
        >
          Focus diff
        </button>
        <button type="button" onClick={api.refresh} title="Refresh (F5)">
          Refresh
        </button>
        <button type="button" onClick={api.openPicker} title="Open another repository (Ctrl/Cmd+O)">
          Open…
        </button>
        <button type="button" onClick={api.closeRepo}>
          Close
        </button>
      </div>

      {notice && <div className="banner">{notice}</div>}
      {state.error && (
        <div className="banner banner-error">
          <strong>{state.error.message}</strong>
          {state.error.detail ? ` ${state.error.detail}` : ''}
        </div>
      )}

      <div className="workspace">
        <Panes panes={workspace} />
      </div>
    </div>
  )
}
