# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
