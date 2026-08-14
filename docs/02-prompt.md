# Build prompt: git-tree

Build the application described in `docs/01-brief.md`. Read that brief and look
at `docs/01-sourcetree-cropped.png` before you start — the screenshot is the
layout reference, not a pixel target.

Implement the whole thing. When you are done, the app should launch on a real
repository and be usable for browsing its history and diffs.

## What you are building

A desktop app for browsing diffs in a local Git repository.

It is strictly view-only. It must never mutate the repository: no staging,
committing, checkout, discard, stash, fetch, push, or any write to the working
tree, the index, or the object store. Every Git invocation must be a read.
Treat this as a hard invariant, not a preference.

## Stack — fixed, do not revisit

- Electron + React + TypeScript.
- Runs on Linux, Windows and macOS from one codebase.
- Fully offline. No network calls, no hosting-provider integration, no
  telemetry.

## Architecture

- All Git access happens in the main process. The renderer never touches the
  filesystem or spawns processes; it asks the main process over IPC and gets
  plain data back.
- Enable context isolation, disable node integration in the renderer, and
  expose a narrow, explicitly-typed preload API. No `remote`.
- Shell out to the user's installed `git` binary. It is the fastest, most
  correct source of truth for graph topology and diffs, and it handles the
  awkward cases (renames, submodules, huge files) that a pure-JS
  reimplementation gets wrong. Detect a missing or too-old `git` at startup and
  say so clearly instead of failing obscurely.
- Never interpolate user-controlled strings into a shell command line. Spawn
  `git` with an argument array, no shell.
- Parse Git output using machine-readable formats with explicit separators
  (`--porcelain`, `-z`, `--format` with unambiguous delimiters). Do not parse
  human-facing output; do not assume paths are free of spaces, quotes, newlines,
  or non-UTF-8 bytes.

## The four panels

Lay the window out as in the screenshot:

1. **History** — the commit graph and list, occupying the top region.
2. **Changed files** — the files touched by the current selection.
3. **Commit metadata** — hash, parents, author, date, refs, and the full commit
   message.
4. **Diff** — the diff for the selected file.

Panels 2–4 all reflect whatever is currently selected in panel 1. The user can
resize the panels, and the sizes persist across restarts.

## The selection model

This is the core behaviour of the app. Get it exactly right.

- Uncommitted changes appear as the newest node in the history list, above the
  most recent commit. It is an ordinary row in the list and participates in
  selection like any other.
- Selecting a single commit shows that commit's diff against its parent.
- Selecting the uncommitted-changes node shows the working tree against `HEAD`,
  with staged and unstaged changes both included.
- `Cmd/Ctrl+Click` adds a second item to the selection. The app then shows the
  diff between the two selected items. Selection order must not matter: picking
  A then B and picking B then A both show the older state as the "before" side.
- The uncommitted-changes node can be either half of that pair, diffed against
  any commit — not just `HEAD`.

Handle these cases explicitly and deliberately:

- A third `Cmd/Ctrl+Click`.
- `Cmd/Ctrl+Click` on an already-selected item.
- A plain click while two items are selected.
- A merge commit with multiple parents.
- The root commit, which has no parent.
- Two selected commits with no common ancestor.
- A clean working tree, where there is nothing uncommitted to show.
- A repository with no commits at all.

Whatever you decide for each, make it consistent and make it obvious to the user
what they are looking at. The diff panel should always make the comparison it is
showing unambiguous.

## Non-goals

Do not build: any write operation, remote operations, conflict resolution,
blame, search across history, settings UI beyond what persistence needs, or
multi-repository workspaces. Resist scope creep toward "a Git client" — this is
a diff viewer.

## Quality bar

- **Responsiveness.** Repositories with tens of thousands of commits must feel
  fine. Do not load the whole history into memory or the DOM at once. Long file
  lists and large diffs must not lock the UI.
- **Graceful degradation.** Binary files, images, very large files, files with
  no trailing newline, non-UTF-8 content, symlinks, and submodule entries must
  each produce something sensible rather than a crash or a wall of mojibake.
- **Honest errors.** Not a repository, unreadable repository, missing `git`,
  detached `HEAD`, a repository mid-rebase or mid-merge — each gets a clear
  message, not a silent empty panel.
- **Platform correctness.** Path separators, line endings, and case sensitivity
  differ across the three targets. Do not assume POSIX.

## Where the judgment is yours

The brief deliberately leaves these open. Make reasonable calls, and note the
significant ones in the README:

- How diffs are rendered — unified or side-by-side, syntax highlighting,
  intra-line highlighting, whitespace treatment, context expansion.
- How the graph is drawn — lanes, colours, merge edges, ref labels, ordering.
- How a repository gets opened — picker, CLI argument, recents, drag-and-drop.
- How and when the view refreshes when the repository changes on disk.
- Component structure, state management, styling approach, build tooling.

Prefer the boring, conventional choice. Prefer fewer dependencies.

## Deliverables

- A working Electron application, launchable with a single documented command.
- A `README.md` covering prerequisites, how to run in development, how to build
  distributables for all three platforms, and the notable design decisions you
  made from the list above.
- Tests where they carry weight: the Git output parsers and the
  selection-to-diff-command logic are the parts that will silently break. Test
  those. Do not chase coverage on trivial components.

## How to work

1. Before writing code, lay out your plan: the process/IPC boundary, the data
   shapes crossing it, the Git commands backing each panel, and the component
   tree. Show it to me.
2. Then build it, verifying as you go against this repository and at least one
   repository with a non-trivial branching history.
3. Run the app yourself before telling me it works. Report what you actually
   observed, including anything you could not get working.

Ask me about anything genuinely ambiguous rather than guessing at it. Anything
under "where the judgment is yours" is not ambiguous — decide it and move on.
