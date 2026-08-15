# Contributing to git-tree

Thanks for taking a look. This is a small project with a narrow scope, so the most useful
thing you can do before writing code is open an issue describing what you want to change.

## The one invariant

**git-tree never writes to a repository.** Not to the working tree, not to the index, not to
the object store, not to refs or the reflog. This is not a preference that can be traded away
for a feature; it is the reason the app is safe to point at a repository you care about.

It is enforced in `src/main/git/exec.ts`, which is the only place in the codebase that spawns a
process. It allowlists Git subcommands, refuses write-capable flags, forces `--no-ext-diff`,
`--no-textconv` and `diff.external=` so Git never runs a program from the repository's own
configuration, and sets `GIT_OPTIONAL_LOCKS=0` so even `git status` does not rewrite the index.
`tests/exec-guard.test.ts` asserts all of it.

A change that needs a new Git subcommand must add it to the allowlist **and** add a test
showing the new command is a read. A change that needs to write is out of scope.

## Getting set up

```bash
npm install
npm run dev                                       # opens the repository picker
GIT_TREE_REPO=/path/to/repository npm run dev     # opens a repository straight away
```

You need Node.js 20 or newer and Git 2.11 or newer on your `PATH`.

## Before you open a pull request

```bash
npm run typecheck   # both TypeScript projects
npm test            # unit tests
```

Both run in CI on Linux, Windows and macOS. Please make sure they pass locally first.

## What a good change looks like

- **Tests where things break silently.** The existing suite is concentrated on parsers, the
  selection model, the exec guard and graph lane assignment — the places where a bug produces
  plausible-looking wrong output rather than a crash. New parsing or selection logic should
  come with tests in the same spirit.
- **No Git command built as a string.** Always an argument array through `exec.ts`, always
  `shell: false`. Paths and refs containing spaces, quotes or shell metacharacters must stay
  data.
- **Machine-readable Git output only.** `-z`, `--porcelain=v2`, `--format` with `%x1f`
  separators and any free-text field last. Do not parse human-facing output.
- **Nothing crosses the process boundary that should not.** The renderer has
  `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`, and no filesystem or
  process access. It asks the main process over IPC and gets plain JSON back. Every IPC call
  returns a `Result` rather than rejecting, so failures surface as a message instead of a blank
  panel.
- **Match the surrounding style.** Two-space indent, no semicolons, and the comment density
  already in the file. There is no linter; `.editorconfig` covers the mechanical part.
- **Degrade explicitly, never blankly.** If the app cannot show something — a binary file, a
  huge patch, undecodable bytes — it should say so in the panel rather than render nothing.

## Scope

Deliberately out of scope: any write operation, network or hosting-provider integration,
telemetry, and syntax highlighting (see the "Design decisions" section of the README for the
reasoning on the last one).

Known gaps that would make good contributions are listed under "Known limitations" in the
README — in particular, the Windows and macOS builds have not been exercised, and there is no
application icon.

## Reporting bugs

Open an issue with the Git version, the OS, and the repository shape that triggered it
(shallow, worktree, submodule, detached `HEAD`, SHA-256, and so on). A repository you can share
helps, but a description of its shape is usually enough.

For anything security-sensitive, see [SECURITY.md](SECURITY.md) instead.

## Licence

By contributing you agree that your contributions are licensed under the MIT License that
covers this project.
