## What this changes

<!-- One or two sentences. Link the issue it addresses, if there is one. -->

## Why

<!-- What was wrong or missing. If this is a design decision the README discusses,
     say how this squares with the reasoning there. -->

## How it was verified

<!-- Which repository shape you tried it against, and what you looked at. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Tests added or updated for behaviour that could break silently (parsers, selection,
      graph lanes, the exec guard)
- [ ] **No new write path.** If this adds a Git subcommand to the allowlist in
      `src/main/git/exec.ts`, there is a test in `tests/exec-guard.test.ts` showing it is a read
- [ ] No Git command is built as a shell string; every spawn goes through `exec.ts` with an
      argument array
- [ ] Any new Git output is parsed in a machine format (`-z`, `--porcelain=v2`, `--format`),
      not human-facing output
