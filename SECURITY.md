# Security Policy

## Supported versions

git-tree is pre-1.0. Only the latest release on `main` receives fixes.

| Version | Supported |
|---|---|
| 0.1.x   | ✅ |
| < 0.1   | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub:
[**Security → Report a vulnerability**](https://github.com/boonkgim/git-tree/security/advisories/new).
That opens a private advisory visible only to you and the maintainers.

Include what you can:

- what an attacker can do, and what they need to already control to do it
- the steps or the repository shape that reproduces it
- your OS, Git version, and git-tree version

You should get a first response within about a week. This is a small
volunteer-maintained project, so please allow reasonable time for a fix before
disclosing publicly.

## What counts as a vulnerability here

git-tree opens a local Git repository and shells out to your own `git`. The
threat model is **a repository you do not fully trust** — one you cloned to look
at. The interesting failures are therefore:

- **Any write to the repository.** The app is view-only, enforced by a Git
  subcommand allowlist in `src/main/git/exec.ts`. A path that mutates the
  working tree, the index, the object store, refs or the reflog is a bug of the
  highest severity here, even if it needs an unusual repository to trigger.
- **Code execution driven by repository content or configuration.** Git can be
  told to run external programs (`diff.external`, `textconv`, ext-diff drivers)
  from a repository's own config or attributes. `exec.ts` forces these off; a
  way around that is a vulnerability.
- **Argument injection.** No Git command is built as a shell string, and every
  spawn uses an argument array with `shell: false`. A path or ref that escapes
  being treated as data is a vulnerability.
- **Renderer escape.** The renderer runs with `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`, a `default-src 'self'` CSP, blocked
  navigation and a network block. Anything that gets filesystem, process or
  network access into the renderer, or widens the preload bridge beyond its
  declared surface, is a vulnerability.
- **Path traversal or data exfiltration** — reading or reporting anything
  outside the repository the user opened.

## Not vulnerabilities

- Crashes or ugly output on a malformed repository, with no write and no code
  execution. Please open a normal issue for those.
- Vulnerabilities in Git itself. Report those to the Git project; if git-tree
  makes one reachable that would not otherwise be, that part is ours.
- The absence of code signing on packaged builds. It is a known gap, listed in
  the README.
