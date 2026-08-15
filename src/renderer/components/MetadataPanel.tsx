import type { AppApi } from '../state/store'

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'medium'
})

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </div>
  )
}

/**
 * Details of the current selection.
 *
 * There are three quite different things it can be describing — one commit, the
 * working tree, or a comparison between two nodes — and each gets its own
 * layout rather than a single shape with blank fields.
 */
export function MetadataPanel({ api }: { api: AppApi }): JSX.Element {
  const { state } = api
  const selection = state.selection
  const spec = state.files?.spec

  if (!selection) {
    return (
      <section className="panel panel-meta">
        <header className="panel-head">
          <span className="panel-title">Details</span>
        </header>
        <div className="meta-body dim">Nothing selected.</div>
      </section>
    )
  }

  const isPair = !!selection.other

  return (
    <section className="panel panel-meta">
      <header className="panel-head">
        <span className="panel-title">
          {isPair ? 'Comparison' : selection.anchor.kind === 'working' ? 'Uncommitted changes' : 'Commit'}
        </span>
      </header>
      <div className="meta-body">
        {state.files && <p className="comparison">{state.files.label}</p>}

        {isPair && (
          <p className="dim">
            Two items are selected. The panels show what changed between them; the older side is
            always the "before".
          </p>
        )}

        {!isPair && selection.anchor.kind === 'working' && state.working && (
          <>
            <Field label="Against">
              {state.repo?.unborn
                ? 'an empty repository (no commits yet)'
                : `HEAD${state.repo?.branch ? ` — ${state.repo.branch}` : ''}`}
            </Field>
            <Field label="Staged">{state.working.staged}</Field>
            <Field label="Unstaged">{state.working.unstaged}</Field>
            <Field label="Untracked">{state.working.untracked}</Field>
            {state.working.conflicted > 0 && (
              <Field label="Conflicted">{state.working.conflicted}</Field>
            )}
          </>
        )}

        {!isPair && selection.anchor.kind === 'commit' && state.detail && (
          <>
            <p className="commit-subject">{state.detail.subject || '(no message)'}</p>
            {state.detail.body.split('\n').slice(1).join('\n').trim() && (
              <pre className="commit-body">
                {state.detail.body.split('\n').slice(1).join('\n').trim()}
              </pre>
            )}
            <Field label="Commit">
              <span className="mono selectable">{state.detail.sha}</span>
            </Field>
            <Field label="Parents">
              {state.detail.parents.length === 0 ? (
                <span className="dim">none (root commit)</span>
              ) : (
                state.detail.parents.map((parent, i) => (
                  <span key={parent} className="mono selectable parent">
                    {parent.slice(0, 10)}
                    {i < state.detail!.parents.length - 1 ? ', ' : ''}
                  </span>
                ))
              )}
            </Field>
            <Field label="Author">
              {state.detail.authorName} &lt;{state.detail.authorEmail}&gt;
            </Field>
            <Field label="Date">{formatDate(state.detail.authorDate)}</Field>
            {(state.detail.committerName !== state.detail.authorName ||
              state.detail.committerEmail !== state.detail.authorEmail) && (
              <Field label="Committer">
                {state.detail.committerName} &lt;{state.detail.committerEmail}&gt; on{' '}
                {formatDate(state.detail.committerDate)}
              </Field>
            )}
            {state.detail.refs.length > 0 && (
              <Field label="Labels">
                {state.detail.refs.map((ref) => (
                  <span key={`${ref.kind}:${ref.name}`} className={`ref ref-${ref.kind}`}>
                    {ref.name}
                  </span>
                ))}
              </Field>
            )}
          </>
        )}

        {spec?.mode === 'commit' && spec.parents.length > 1 && (
          <p className="note">
            This is a merge commit with {spec.parents.length} parents. The diff shown is against
            parent {spec.parentIndex + 1}; use the selector in the diff panel to switch.
          </p>
        )}
      </div>
    </section>
  )
}
