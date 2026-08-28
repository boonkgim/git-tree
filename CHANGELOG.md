# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
