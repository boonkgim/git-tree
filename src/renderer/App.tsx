import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PANELS, type PanelSizes } from '@shared/types'
import { DiffPanel } from './components/DiffPanel'
import { FilesPanel } from './components/FilesPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { MetadataPanel } from './components/MetadataPanel'
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

      <div className="layout">
        <div className="row-history" style={{ height: panels.historyHeight }}>
          <HistoryPanel api={api} />
        </div>

        <Splitter
          orientation="horizontal"
          value={panels.historyHeight}
          min={140}
          max={Math.max(200, window.innerHeight - 260)}
          onChange={(historyHeight) => setPanels((p) => ({ ...p, historyHeight }))}
          onCommit={(historyHeight) => persistPanels({ historyHeight })}
        />

        <div className="row-bottom">
          <div className="column-left" style={{ width: panels.leftWidth }}>
            <div className="left-files" style={{ height: panels.filesHeight }}>
              <FilesPanel api={api} />
            </div>
            <Splitter
              orientation="horizontal"
              value={panels.filesHeight}
              min={80}
              max={Math.max(120, window.innerHeight - 400)}
              onChange={(filesHeight) => setPanels((p) => ({ ...p, filesHeight }))}
              onCommit={(filesHeight) => persistPanels({ filesHeight })}
            />
            <div className="left-meta">
              <MetadataPanel api={api} />
            </div>
          </div>

          <Splitter
            orientation="vertical"
            value={panels.leftWidth}
            min={220}
            max={Math.max(300, window.innerWidth - 360)}
            onChange={(leftWidth) => setPanels((p) => ({ ...p, leftWidth }))}
            onCommit={(leftWidth) => persistPanels({ leftWidth })}
          />

          <div className="column-right">
            <DiffPanel api={api} />
          </div>
        </div>
      </div>
    </div>
  )
}
