# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Dragging a row out started two competing drags, so whether a drop worked was a race.**
  Handing the drag to the main process starts an OS file drag, but the renderer's own drag was
  never cancelled, so both ran. Chromium's advertises its URL flavours (`_NETSCAPE_URL`,
  `text/x-moz-url`) and no `text/uri-list` at all, so an application looking for a file — which
  is what a terminal that pastes a path is doing — saw nothing it recognised whenever that one
  won. `dragstart` now calls `preventDefault`, as Electron's own guidance says to, leaving the
  file drag as the only one: the drop offers `text/uri-list` with a `file://` URI, the same
  shape a file manager provides.
- **A git that could not be started reached the panels as a bare `spawn ENOTCONN`.** `spawn`
  reports a failure to start two ways: asynchronously on the child's `error` event, and
  synchronously out of the call itself when the stdio pipes cannot be set up, which is what a
  machine short of file handles does. Only the first was being wrapped, so the second arrived in
  the UI as node's own message, with no binary name and nothing to act on. Both now become a
  proper error, and the out-of-file-handles codes say what actually went wrong.
- **A file list that failed to load was a dead end.** The fetch rules deliberately will not run
  while an error is set, and in the all-files scope nothing else was going to clear it, so the
  panel stayed empty until the whole repository was refreshed. The error state now carries a
  **Try again**.

### Added

- **An all-files scope in the changed-files panel**, the way an editor's project pane lists a
  project. **Changed** / **All** in the panel header switches between the files this comparison
  touched and every file in the working tree — tracked, untracked, and, behind the **!** button,
  the ones `.gitignore` excludes. In the All scope the list is a picture of the disk, so its
  statuses come from `git status` and its diffs are working-tree diffs; a file the working tree
  has not touched is shown as its own contents rather than as "no changes". The history selection
  is left alone and still drives the graph and the commit details. Ignored files are the first
  thing dropped at the 20,000-file ceiling, so turning them on cannot push a real file out of
  view. The scope and the ignored toggle are persisted with the other panel preferences.
- **Colour hints on file rows.** Each status now tints the file name as well as its badge —
  modified amber, added green, untracked olive, deleted red and struck through, renamed blue,
  conflicted red and bold — so an uncommitted change is visible without reading the letter.
  Ignored files, and directories holding nothing but ignored files, fade instead.
- **Dragging a file row out of the panel.** The main process turns the drag into an OS file drag,
  so dropping it on a terminal pastes that file's path and every other application receives it as
  the file it is. Folder rows drag out the same way. Nothing is copied, moved or written, and the path is checked against
  the repository root before it leaves, exactly as opening is.
- **Any panel but the diff can be hidden.** Each panel's header carries an × that puts it away;
  the title bar carries a toggle per panel, and **View** the same four as checkboxes, with
  `Ctrl/Cmd+B` for Branches and `Ctrl/Cmd+1` / `2` / `3` for History, Changed files and Details.
  **View → Focus the Diff** (`Ctrl/Cmd+Shift+D`) hides every other panel and puts back exactly
  what was there when pressed again. Hiding a panel takes its splitter with it and gives the
  space to what is left; which panels are shown is persisted separately from their sizes, so one
  that comes back comes back the size it was. Settings written by an earlier version keep their
  branch-sidebar choice.
- A **branch sidebar**: branches, remote-tracking branches and tags, grouped on `/` the way the
  changed-file tree groups directories, with the current branch marked and ahead/behind counts
  against the upstream as of your last fetch. Clicking one moves the history to the commit it
  points at — it checks nothing out; this application still only reads. A filter box narrows the
  list and `Enter` takes the first match, `Ctrl/Cmd+B` (or **View → Branches Sidebar**) hides the
  panel, and its width and visibility are persisted with the other panel sizes. Jumping to a ref
  whose tip is below the loaded history pages the walk in first, so it works at any depth.
- **Previews for images, video and audio in the diff panel.** Selecting a changed file whose
  format the renderer can draw shows the *before* and *after* versions stacked, before above after
  — with byte sizes, pixel dimensions and a chequerboard behind transparency — instead of the
  byte-count summary a binary diff used to give. Video and audio get the browser's own controls,
  an added or deleted file shows only the version that exists, and SVG is previewed as well as
  diffed as text. Sides are read with `git cat-file blob` (or from the
  working tree, for the "now" side) and capped at 8 MB each.
- **Opening changed files and folders on the desktop.** Double-clicking a file row in the
  changed-files panel opens the working-tree file with your default application; a folder row in
  the tree view carries a small button that opens that directory in your file manager. Opening is
  still not writing — the path is resolved against the repository root and refused if it lands
  outside it, and a file that exists only in the commit being shown says so instead of opening
  something else.
- A **Flat / Tree** toggle in the changed-files panel. Tree groups the files by directory, folds
  single-child directory chains into one row (`src/renderer/components`), counts the files inside
  a folded directory, and has ⊟ / ⊞ to fold or open everything. Folded directories are remembered
  by path across commits, and the selected file is revealed when the selection moves. The choice
  is persisted with the other preferences; flat, which is Git's own order, stays the default.
- `scripts/install-user.sh`, which installs git-tree for one user without root: the AppImage and
  the launcher go to `~/.local/lib/git-tree`, laid out as the package lays them out under `/opt`,
  with the command linked into `~/.local/bin` and the desktop entry and hicolor icons written to
  `~/.local/share`. The application appears in **Show Applications** exactly as the `.deb` makes
  it appear — the launcher entry never needed root, only the `/usr` paths did — so an unattended
  install (CI, or an agent working in this repository) no longer has to stop at a password
  prompt. `dpkg` does not track it; install one way or the other, not both.
- A command-line launcher: `/usr/bin/git-tree` now points at a wrapper that starts the app in
  its own session, so running `git-tree .` in a terminal returns to the prompt instead of
  holding the shell until the window is closed. Applies to the `.deb`; the AppImage, being a
  single portable file, is unchanged.
- An application icon (`build/icon.svg`, rasterised to `build/icons/`): the commit graph the app
  draws, in its own lane colours. Linux packages now install the full hicolor set, and the
  desktop entry carries `Keywords` so the app is findable by "git" or "diff" in a launcher.
- Open-source project files: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue and pull-request templates, and a GitHub Actions workflow running
  typecheck and tests on Linux, Windows and macOS.

## [0.1.0] - 2026-08-15

First release.

### Added

- Four-panel layout — commit graph, changed files, commit metadata, diff.
- Streaming `git log` with incremental graph lane assignment, virtualised rows, and history
  kept ahead of the viewport rather than loaded whole.
- An order-insensitive two-row selection model covering commits, the uncommitted-changes row,
  merge parents, root commits and unrelated histories, with the comparison stated in words.
- Unified diffs with intra-line word highlighting, adjustable context, whitespace-ignoring, and
  explicit handling of binary files, submodules, symlinks, mode changes, missing trailing
  newlines, non-UTF-8 bytes and oversized patches.
- A read-only guarantee enforced by a Git subcommand allowlist rather than by convention.
- Persisted panel sizes, window bounds, diff options and recent repositories, stored in the OS
  application-data directory.
- Linux (AppImage, `.deb`), Windows (NSIS) and macOS (dmg) packaging targets.

[Unreleased]: https://github.com/boonkgim/git-tree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/boonkgim/git-tree/releases/tag/v0.1.0
