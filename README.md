# git-tree

A desktop viewer for the history and diffs of a local Git repository. Four panels — commit
graph, changed files, commit metadata, diff — laid out like SourceTree.

It is **view-only**. It never stages, commits, checks out, discards, stashes, fetches, pushes,
or writes anything to your working tree, index, or object store.

![git-tree showing uncommitted changes against HEAD](docs/02-git-tree-screenshot.png)
*git-tree with the uncommitted-changes row selected. The layout follows
`docs/01-sourcetree-cropped.png`.*

---

## Prerequisites

- **Node.js 20 or newer** (developed on 24) and npm, to build and run.
- **Git 2.11 or newer** on your `PATH`. The app shells out to your own `git`; if it is missing
  or too old you get a plain message saying so at start-up rather than an empty window.
- Linux, Windows, or macOS.

## Running it

```bash
npm install
npm run dev                                       # opens the repository picker
GIT_TREE_REPO=/path/to/repository npm run dev     # opens a repository straight away
```

(The environment variable is used in development because `electron-vite` consumes unrecognised
command-line flags before they reach the app.)

Once built, the packaged binary takes a path directly:

```bash
git-tree /path/to/repository
git-tree .
```

A repository can also be opened from **File → Open Repository…** (`Ctrl/Cmd+O`), from the
recent list on the welcome screen, or by dropping a folder onto the window. Any path *inside* a
repository works — it is resolved with `git rev-parse --show-toplevel`.

Other commands:

```bash
npm test          # unit tests
npm run typecheck # both TypeScript projects
npm run build     # bundle main, preload and renderer into out/
```

## Building distributables

```bash
npm run build:linux   # AppImage + .deb   -> release/
npm run build:win     # NSIS installer    -> release/
npm run build:mac     # .dmg              -> release/
npm run build:all     # all three
```

Two things to set before publishing: the `.deb` `maintainer` in `electron-builder.yml` is a
placeholder, and no application icon is bundled, so the packaged app uses Electron's default.

electron-builder only cross-builds so far in practice: Windows and macOS targets are best built
on their own platforms (macOS in particular requires macOS for signing). Linux was the platform
this was developed and packaged on.

## Using it

| Action | Result |
|---|---|
| Click a commit | Its diff against its parent |
| Click **Uncommitted changes** | The working tree against `HEAD`, staged *and* unstaged |
| `Ctrl/Cmd+Click` a second row | The diff between the two selected rows |
| `Ctrl/Cmd+Click` a selected row | Removes it from the selection |
| Click, plain | Collapses back to a single selection |
| `↑` / `↓` | Move the selection |
| `F5` | Refresh |

The diff panel always states the comparison it is showing in words, so it is never ambiguous
which side is "before".

---

## Design decisions

The brief left these open. Here is what was chosen and why.

### The selection model

**The pair is order-insensitive.** Selecting A then B and B then A produce the same diff. Which
side is "before" is decided by topology first — `git merge-base --is-ancestor` — and only falls
back to commit date when neither commit reaches the other. That case is labelled *"diverged
branches, ordered by date"*, and commits with no common ancestor at all are labelled *"no common
ancestor, direct tree comparison"*, because a plain diff between them is still meaningful even
though a range is not.

**The working tree is always the newer side.** Pairing it with any commit shows that commit →
the working tree. It represents the state that exists *now*, so treating it as older than a
2019 commit would be the only reading that is never useful.

**A third `Ctrl/Cmd+Click` keeps the anchor pinned** and moves the other end. The anchor is
marked with a yellow bar. This makes sweeping several commits against one fixed reference the
natural gesture, which is the common reason to keep clicking.

**The selection is never empty.** `Ctrl/Cmd+Click`ing the only selected row is a no-op, because
an empty selection would just blank three panels.

**A merge commit defaults to its first parent**, labelled `parent 1 of N`, with a selector in the
diff header to switch. Combined (`-c`) diffs were left out: they are hard to read and easy to
misinterpret, and picking a parent answers "what did this merge bring in" more directly.

**The root commit is diffed against the empty tree**, so it shows as every file added. The empty
tree's id is asked of the repository via `git hash-object -t tree --stdin` rather than hard-coded,
so SHA-256 repositories work too. (`hash-object` without `-w` computes an id and writes nothing.)

**The uncommitted-changes row is hidden when the working tree is clean**, matching SourceTree. If
it was selected and the tree becomes clean, the selection falls back to `HEAD`.

**With a clean tree the default selection is `HEAD`**, not the newest commit by date — with a
detached `HEAD`, or a branch behind another, the top row is not where you are.

### The diff

**Unified, not side-by-side.** The diff panel already shares the window with three others;
spending half its width on a second gutter is a poor trade. **Intra-line word highlighting** on
paired −/+ lines supplies the precision side-by-side would have given, and it is skipped when
two lines are too dissimilar for it to be anything but noise.

**No syntax highlighting.** It would mean a large dependency and a lot of per-line work for a
panel that must stay fast on a 60,000-line file. Diff colouring already carries the meaning that
matters here.

**Context is adjustable** (3 / 10 / 25 / whole file) by re-running the diff with a different
`-U`, and whitespace can be ignored (`--ignore-all-space`). Both are per-session and persisted.

**Degradation is explicit, never blank.** Binary files report their sizes; submodules show the
commit they point at with a chip; symlinks say they are symlinks and show the target; mode
changes show `100644 → 100755`; a missing trailing newline is marked on its line; non-UTF-8 bytes
are decoded lossily with a warning strip so the rest of the file stays readable; patches over
2 MB are withheld behind a "Show it anyway" button.

**Untracked files are included** in uncommitted changes, because that is what "uncommitted" means
to a person. They are in no tree, so `git diff` cannot name them; their patches come from
`git diff --no-index -- /dev/null <path>`.

### The graph

Lanes are assigned by the conventional algorithm: each open lane expects a particular commit; a
commit takes the lane that expected it or opens a new one, hands it to its first parent, and
places extra parents into found-or-new lanes. Colour follows the lane, so a branch keeps one
colour along its first-parent chain. It runs over `--date-order`, which guarantees a commit is
emitted before its parents. Lanes are computed **incrementally** — recomputing the whole list
each time a page arrives would be quadratic. The gutter is capped at 12 lanes so a wide merge
cannot crowd out the commit messages.

### Loading and refreshing

**One streaming `git log` per repository.** Paging with `--skip` costs a re-walk from the tips on
every page, which is exactly what makes large repositories feel bad. Instead one process walks
the history once into a buffer in the main process while the renderer reads slices out of it.

**History is kept 5,000 rows ahead of the viewport**, not loaded whole: the DOM only ever holds
the visible rows, and renderer memory stays bounded by where you have actually scrolled. The
main-process buffer is capped at 200,000 commits.

**Only `.git` is watched** (debounced 400 ms), plus a re-read of the working-tree status when the
window regains focus, plus `F5`. Watching the whole working tree recursively is expensive on
large repositories and fires constantly during a build; this is a deliberate trade, not an
oversight. Selection survives a refresh.

**Panel sizes, window bounds, diff options and the recent list** persist to `settings.json` in
the OS application-data directory — never inside the repository being viewed.

---

## How it is put together

```
src/main/      git access, IPC, window, settings, watcher
src/preload/   the one narrow bridge the renderer is given
src/renderer/  React UI; no filesystem, no processes
src/shared/    types and pure logic used by both sides
```

- **All Git access is in the main process.** The renderer has `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, no `remote`, a `default-src 'self'` CSP, blocked
  navigation, and a network block that cancels every outbound request. It asks over IPC and gets
  plain JSON back.
- **Every IPC call returns a `Result`**, never a rejected promise, so a failure surfaces as a
  message instead of a blank panel.
- **No `git` command is ever built as a string.** `src/main/git/exec.ts` is the only place a
  process is spawned, always with an argument array and `shell: false`, so paths and refs
  containing spaces, quotes, or shell metacharacters are simply data.
- **Output is parsed only in machine formats** — `-z`, `--porcelain=v2`, `--format` with
  `%x1f` separators and the one free-text field last. Filenames containing spaces, quotes,
  newlines, or non-UTF-8 bytes are handled, not assumed away.

### How "never writes" is enforced

Not by convention. `exec.ts` **allowlists the subcommand** before spawning — `log`, `show`,
`diff`, `diff-tree`, `status`, `rev-parse`, `rev-list`, `merge-base`, `cat-file`, `hash-object`,
`for-each-ref`, `symbolic-ref`, `var`, `check-ignore`, `version` — and refuses everything else.
It additionally refuses `hash-object -w`, `--ext-diff`, `--textconv`, `--output`, `--upload-pack`
and friends, forces `--no-ext-diff --no-textconv` and `diff.external=` so git never runs a program
you configured on its behalf, and sets **`GIT_OPTIONAL_LOCKS=0`**, without which `git status`
would refresh and rewrite your index.

`tests/exec-guard.test.ts` asserts all of it. The invariant was also checked empirically: a full
session — every selection case, every file type — leaves the refs, reflog, index (bytes *and*
mtime), object store, every file under `.git`, and the working tree byte-for-byte identical.

## Tests

```bash
npm test
```

134 tests, concentrated where things break silently rather than spread for coverage:

- **`parse.test.ts`** — every `git` output parser: log records with multi-parent commits and
  separators inside subjects, `--name-status -z` including the `R096 old new` rename form,
  `--numstat -z` including its different rename form and binary `-` markers, `--porcelain=v2`
  ordinary/renamed/unmerged/untracked records, and unified patches (hunk headers, mode changes,
  `\ No newline`, binary markers, submodules).
- **`selection.test.ts`** — the selection model end to end: every case in the table above, both
  click orders producing identical results, merge parents, root commits, unrelated histories,
  working ± commit, empty repositories, and the exact argv each produces.
- **`exec-guard.test.ts`** — the read-only allowlist, and that every generated diff command
  carries the flags that keep it a read.
- **`graph.test.ts`** — lane assignment for linear, forked, merged and octopus histories, and
  that incremental assignment matches a single pass.
- **`worddiff.test.ts`** — intra-line highlighting, including giving up on unrelated lines.

## Known limitations

- Images in binary files are reported by size, not previewed.
- Working-tree changes are picked up on window focus or `F5`, not watched live (see above).
- Combined diffs for merge commits are not offered; pick a parent instead.
- One repository per window.
- No application icon is bundled yet; packaged builds show Electron's default.
- Developed and packaged on Linux. The code avoids POSIX assumptions — git reports paths with
  `/` separators on every platform and that is what the UI splits on, and no command is ever
  built as a shell string — but Windows and macOS builds have not been exercised here. The one
  place worth watching is the untracked-file diff, which relies on git accepting `/dev/null` as
  a path under `--no-index`; that is a documented git idiom on Windows too, but untested.
