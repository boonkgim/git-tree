import type { AppApi } from '../state/store'

/** Shown when no repository is open: pick one, or reopen a recent one. */
export function Welcome({ api }: { api: AppApi }): JSX.Element {
  const recents = api.state.settings?.recents ?? []

  return (
    <div
      className="welcome"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        const path = file ? window.gitTree.pathForDroppedFile(file) : null
        if (path) api.openPath(path)
      }}
    >
      <div className="welcome-card">
        <h1>git-tree</h1>
        <p className="dim">
          A read-only viewer for the history and diffs of a local Git repository. It never writes to
          your repository.
        </p>
        <button type="button" className="primary" onClick={api.openPicker}>
          Open a repository…
        </button>
        <p className="dim small">
          Or drop a folder here, or start the app with a path: <code>git-tree /path/to/repo</code>
        </p>

        {recents.length > 0 && (
          <>
            <h2>Recent</h2>
            <ul className="recents">
              {recents.map((path) => (
                <li key={path}>
                  <button type="button" className="link" onClick={() => api.openPath(path)}>
                    {path}
                  </button>
                  <button
                    type="button"
                    className="link dim remove"
                    title="Remove from this list"
                    onClick={() => api.forget(path)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {api.state.error && (
          <div className="error-box">
            <strong>{api.state.error.message}</strong>
            {api.state.error.detail && <p className="small">{api.state.error.detail}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
