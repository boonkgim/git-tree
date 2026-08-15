import { describe, expect, it } from 'vitest'
import {
  countChanges,
  parseCommitDetail,
  parseLogRecords,
  parseNameStatusZ,
  parseNumstatZ,
  parsePatch,
  parsePorcelainV2,
  parseRefDecoration,
  splitNul,
  DETAIL_FORMAT,
  LOG_FORMAT
} from '../src/main/git/parse'

const US = '\x1f'
const NUL = '\0'

/** Builds a log record the way `git log -z --format=LOG_FORMAT` would. */
function logRecord(fields: string[]): string {
  return fields.join(US)
}

describe('splitNul', () => {
  it('drops the trailing empty piece from NUL-terminated output', () => {
    expect(splitNul(`a${NUL}b${NUL}`)).toEqual(['a', 'b'])
  })
  it('keeps a final record that has no terminator', () => {
    expect(splitNul(`a${NUL}b`)).toEqual(['a', 'b'])
  })
  it('returns nothing for empty output', () => {
    expect(splitNul('')).toEqual([])
  })
})

describe('the log format keeps free text last', () => {
  it('ends with the subject, so extra separators cannot shift a column', () => {
    expect(LOG_FORMAT.endsWith('%s')).toBe(true)
    expect(DETAIL_FORMAT.endsWith('%B')).toBe(true)
  })
})

describe('parseLogRecords', () => {
  const record = logRecord([
    'd3065a19c29ec4c2d70e2b17ebf94cc5bae98594',
    '49ac405ed9a94e0a53fa184d04f1145081f2f8c5',
    'Khur Boon Kgim',
    'ada@example.com',
    '2026-08-15T07:22:08+08:00',
    '2026-08-15T07:22:08+08:00',
    'HEAD -> refs/heads/main',
    'Add build prompt for the git-tree app'
  ])

  it('parses a record', () => {
    const [commit] = parseLogRecords(`${record}${NUL}`)
    expect(commit.sha).toBe('d3065a19c29ec4c2d70e2b17ebf94cc5bae98594')
    expect(commit.parents).toEqual(['49ac405ed9a94e0a53fa184d04f1145081f2f8c5'])
    expect(commit.authorName).toBe('Khur Boon Kgim')
    expect(commit.subject).toBe('Add build prompt for the git-tree app')
    expect(commit.refs).toEqual([{ name: 'main', kind: 'branch', isHead: true }])
  })

  it('parses several records separated by NUL', () => {
    expect(parseLogRecords(`${record}${NUL}${record}${NUL}`)).toHaveLength(2)
  })

  it('handles a root commit, which has no parents', () => {
    const root = logRecord(['a'.repeat(40), '', 'A', 'a@b', 'd', 'd', '', 'first'])
    expect(parseLogRecords(root)[0].parents).toEqual([])
  })

  it('handles a merge commit with several parents', () => {
    const merge = logRecord([
      'a'.repeat(40),
      `${'b'.repeat(40)} ${'c'.repeat(40)} ${'d'.repeat(40)}`,
      'A',
      'a@b',
      'd',
      'd',
      '',
      'octopus'
    ])
    expect(parseLogRecords(merge)[0].parents).toHaveLength(3)
  })

  it('keeps a subject that contains the unit separator intact', () => {
    const weird = logRecord(['a'.repeat(40), '', 'A', 'a@b', 'd', 'd', '', `odd${US}subject`])
    expect(parseLogRecords(weird)[0].subject).toBe(`odd${US}subject`)
  })

  it('keeps quotes, tabs and non-ASCII in a subject', () => {
    const subject = 'fix "quoting"\tand ümlauts — 日本語'
    const weird = logRecord(['a'.repeat(40), '', 'A', 'a@b', 'd', 'd', '', subject])
    expect(parseLogRecords(weird)[0].subject).toBe(subject)
  })

  it('ignores anything that is not a commit record', () => {
    expect(parseLogRecords(`${NUL}garbage${NUL}`)).toEqual([])
    expect(parseLogRecords('')).toEqual([])
  })
})

describe('parseRefDecoration', () => {
  it('is empty when a commit carries no refs', () => {
    expect(parseRefDecoration('')).toEqual([])
    expect(parseRefDecoration('   ')).toEqual([])
  })

  it('classifies branches, remotes and tags from full ref paths', () => {
    expect(
      parseRefDecoration(
        'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.2.0, refs/heads/topic'
      )
    ).toEqual([
      { name: 'main', kind: 'branch', isHead: true },
      { name: 'origin/main', kind: 'remote', isHead: false },
      { name: 'v1.2.0', kind: 'tag', isHead: false },
      { name: 'topic', kind: 'branch', isHead: false }
    ])
  })

  it('recognises a detached HEAD', () => {
    expect(parseRefDecoration('HEAD, refs/tags/v1')).toEqual([
      { name: 'HEAD', kind: 'head', isHead: true },
      { name: 'v1', kind: 'tag', isHead: false }
    ])
  })

  it('falls back gracefully on abbreviated decoration', () => {
    expect(parseRefDecoration('HEAD -> main, tag: v1')).toEqual([
      { name: 'main', kind: 'branch', isHead: true },
      { name: 'v1', kind: 'tag', isHead: false }
    ])
  })
})

describe('parseCommitDetail', () => {
  it('keeps a multi-line body, including blank lines', () => {
    const body = 'Subject line\n\nA paragraph.\n\nCo-Authored-By: Someone <a@b>'
    const record = [
      'a'.repeat(40),
      'b'.repeat(40),
      'Author',
      'a@b',
      '2024-01-01T00:00:00Z',
      '2024-01-02T00:00:00Z',
      'refs/heads/main',
      'Committer',
      'c@d',
      'Subject line',
      body
    ].join(US)
    const detail = parseCommitDetail(`${record}${NUL}`)
    expect(detail?.body).toBe(body)
    expect(detail?.committerName).toBe('Committer')
    expect(detail?.subject).toBe('Subject line')
  })

  it('returns null for unusable output', () => {
    expect(parseCommitDetail('')).toBeNull()
    expect(parseCommitDetail('not a commit')).toBeNull()
  })
})

describe('parseNameStatusZ', () => {
  it('parses simple statuses', () => {
    expect(parseNameStatusZ(`A${NUL}docs/01-brief.md${NUL}M${NUL}README.md${NUL}D${NUL}old.txt${NUL}`)).toEqual([
      { status: 'added', path: 'docs/01-brief.md' },
      { status: 'modified', path: 'README.md' },
      { status: 'deleted', path: 'old.txt' }
    ])
  })

  it('parses a rename, which carries a score and two paths', () => {
    expect(
      parseNameStatusZ(`R096${NUL}.claude/skills/db/SKILL.md${NUL}.claude/skills/code-db/SKILL.md${NUL}`)
    ).toEqual([
      {
        status: 'renamed',
        oldPath: '.claude/skills/db/SKILL.md',
        path: '.claude/skills/code-db/SKILL.md',
        score: 96
      }
    ])
  })

  it('parses a copy the same way', () => {
    expect(parseNameStatusZ(`C75${NUL}a.txt${NUL}b.txt${NUL}`)).toEqual([
      { status: 'copied', oldPath: 'a.txt', path: 'b.txt', score: 75 }
    ])
  })

  it('parses type changes and unmerged entries', () => {
    expect(parseNameStatusZ(`T${NUL}link${NUL}U${NUL}conflict.txt${NUL}`)).toEqual([
      { status: 'typechange', path: 'link' },
      { status: 'unmerged', path: 'conflict.txt' }
    ])
  })

  it('handles paths containing spaces, quotes and newlines', () => {
    const path = 'dir with spaces/od"d\nname.txt'
    expect(parseNameStatusZ(`M${NUL}${path}${NUL}`)).toEqual([{ status: 'modified', path }])
  })

  it('handles non-ASCII paths', () => {
    expect(parseNameStatusZ(`A${NUL}src/日本語/ünïcode.ts${NUL}`)[0].path).toBe(
      'src/日本語/ünïcode.ts'
    )
  })

  it('is empty for an empty diff', () => {
    expect(parseNameStatusZ('')).toEqual([])
  })

  it('does not invent an entry from a truncated record', () => {
    expect(parseNameStatusZ(`R100${NUL}only-one-path`)).toEqual([])
  })
})

describe('parseNumstatZ', () => {
  it('parses line counts', () => {
    expect(parseNumstatZ(`11\t0\tdocs/01-brief.md${NUL}145\t2\tdocs/02-prompt.md${NUL}`)).toEqual([
      { path: 'docs/01-brief.md', oldPath: undefined, insertions: 11, deletions: 0, binary: false },
      { path: 'docs/02-prompt.md', oldPath: undefined, insertions: 145, deletions: 2, binary: false }
    ])
  })

  it('parses the rename form, where the path field is empty and two paths follow', () => {
    expect(parseNumstatZ(`2\t2\t${NUL}old/SKILL.md${NUL}new/SKILL.md${NUL}`)).toEqual([
      { path: 'new/SKILL.md', oldPath: 'old/SKILL.md', insertions: 2, deletions: 2, binary: false }
    ])
  })

  it('reports a binary file rather than pretending it has line counts', () => {
    expect(parseNumstatZ(`-\t-\timage.png${NUL}`)).toEqual([
      { path: 'image.png', oldPath: undefined, insertions: null, deletions: null, binary: true }
    ])
  })

  it('handles a path containing a tab', () => {
    expect(parseNumstatZ(`1\t1\tweird\tname.txt${NUL}`)[0].path).toBe('weird\tname.txt')
  })

  it('is empty for an empty diff', () => {
    expect(parseNumstatZ('')).toEqual([])
  })
})

describe('parsePorcelainV2', () => {
  it('reads the branch header', () => {
    const out = `# branch.oid d3065a19${NUL}# branch.head main${NUL}# branch.upstream origin/main${NUL}`
    const status = parsePorcelainV2(out)
    expect(status.branch).toBe('main')
    expect(status.oid).toBe('d3065a19')
    expect(status.detached).toBe(false)
  })

  it('recognises a detached HEAD and an unborn branch', () => {
    expect(parsePorcelainV2(`# branch.head (detached)${NUL}`).detached).toBe(true)
    expect(parsePorcelainV2(`# branch.oid (initial)${NUL}`).oid).toBeNull()
  })

  it('parses ordinary entries and splits staged from unstaged', () => {
    const out =
      `1 M. N... 100644 100644 100644 aaa bbb staged.txt${NUL}` +
      `1 .M N... 100644 100644 100644 aaa bbb unstaged.txt${NUL}` +
      `1 MM N... 100644 100644 100644 aaa bbb both.txt${NUL}`
    const status = parsePorcelainV2(out)
    expect(status.summary).toMatchObject({ staged: 2, unstaged: 2, hasChanges: true })
    expect(status.entries.map((e) => e.path)).toEqual(['staged.txt', 'unstaged.txt', 'both.txt'])
  })

  it('parses a rename entry, whose original path is a separate record', () => {
    const out = `2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt${NUL}old name.txt${NUL}`
    const status = parsePorcelainV2(out)
    expect(status.entries[0]).toMatchObject({ path: 'new name.txt', oldPath: 'old name.txt' })
  })

  it('parses untracked and unmerged entries', () => {
    const out =
      `? untracked file.txt${NUL}` +
      `u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt${NUL}`
    const status = parsePorcelainV2(out)
    expect(status.summary).toMatchObject({ untracked: 1, conflicted: 1, hasChanges: true })
    expect(status.entries[0].path).toBe('untracked file.txt')
    expect(status.entries[1]).toMatchObject({ path: 'conflict.txt', unmerged: true })
  })

  it('ignores ignored-file records', () => {
    expect(parsePorcelainV2(`! node_modules/x${NUL}`).entries).toEqual([])
  })

  it('reports a clean tree', () => {
    expect(parsePorcelainV2(`# branch.head main${NUL}`).summary).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      hasChanges: false
    })
  })
})

describe('parsePatch', () => {
  it('parses hunks and numbers both sides', () => {
    const patch = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,4 @@ section heading',
      ' one',
      '-two',
      '+TWO',
      '+two and a half',
      ' three',
      ''
    ].join('\n')
    const parsed = parsePatch(patch)
    expect(parsed.hunks).toHaveLength(1)
    const [hunk] = parsed.hunks
    expect(hunk).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, header: 'section heading' })
    expect(hunk.lines.map((l) => [l.type, l.oldNumber, l.newNumber, l.content])).toEqual([
      ['context', 1, 1, 'one'],
      ['del', 2, null, 'two'],
      ['add', null, 2, 'TWO'],
      ['add', null, 3, 'two and a half'],
      ['context', 3, 4, 'three']
    ])
    expect(countChanges(parsed.hunks)).toEqual({ insertions: 2, deletions: 1 })
  })

  it('handles a hunk header with implicit single-line counts', () => {
    const parsed = parsePatch(['@@ -5 +7 @@', '-a', '+b'].join('\n'))
    expect(parsed.hunks[0]).toMatchObject({ oldStart: 5, oldLines: 1, newStart: 7, newLines: 1 })
  })

  it('parses several hunks in one file', () => {
    const parsed = parsePatch(
      ['@@ -1,1 +1,1 @@', '-a', '+b', '@@ -10,1 +10,1 @@', '-c', '+d'].join('\n')
    )
    expect(parsed.hunks).toHaveLength(2)
    expect(parsed.hunks[1].oldStart).toBe(10)
  })

  it('marks a missing trailing newline against the line it belongs to', () => {
    const parsed = parsePatch(
      ['@@ -1 +1 @@', '-old', '\\ No newline at end of file', '+new'].join('\n')
    )
    expect(parsed.hunks[0].lines[0].noNewline).toBe(true)
    expect(parsed.hunks[0].lines[1].noNewline).toBeUndefined()
  })

  it('recognises a binary file instead of producing garbage', () => {
    const parsed = parsePatch(
      ['diff --git a/i.png b/i.png', 'index 1..2 100644', 'Binary files a/i.png and b/i.png differ'].join('\n')
    )
    expect(parsed.binary).toBe(true)
    expect(parsed.hunks).toEqual([])
  })

  it('recognises a literal binary patch', () => {
    expect(parsePatch('diff --git a/i.png b/i.png\nGIT binary patch\nliteral 12\n').binary).toBe(true)
  })

  it('reports a mode change', () => {
    const parsed = parsePatch(
      ['diff --git a/s.sh b/s.sh', 'old mode 100644', 'new mode 100755'].join('\n')
    )
    expect(parsed.modeChange).toBe('100644 → 100755')
  })

  it('recognises a symlink', () => {
    const parsed = parsePatch(
      ['diff --git a/l b/l', 'new file mode 120000', '@@ -0,0 +1 @@', '+target/path'].join('\n')
    )
    expect(parsed.isSymlink).toBe(true)
  })

  it('recognises a submodule pointer change', () => {
    const parsed = parsePatch(
      [
        'diff --git a/sub b/sub',
        'index aaa..bbb 160000',
        '--- a/sub',
        '+++ b/sub',
        '@@ -1 +1 @@',
        '-Subproject commit aaaaaaa',
        '+Subproject commit bbbbbbb'
      ].join('\n')
    )
    expect(parsed.submodule).toBe(true)
  })

  it('flags a header with no hunks, such as a pure rename', () => {
    const parsed = parsePatch(
      [
        'diff --git a/a.txt b/b.txt',
        'similarity index 100%',
        'rename from a.txt',
        'rename to b.txt'
      ].join('\n')
    )
    expect(parsed.headerOnly).toBe(true)
    expect(parsed.hunks).toEqual([])
  })

  it('produces nothing from empty input rather than throwing', () => {
    expect(parsePatch('')).toMatchObject({ hunks: [], binary: false, headerOnly: false })
  })

  it('does not treat a following file header as diff content', () => {
    const parsed = parsePatch(
      ['@@ -1 +1 @@', '-a', '+b', 'diff --git a/other b/other', '@@ -1 +1 @@', '-c', '+d'].join('\n')
    )
    expect(parsed.hunks).toHaveLength(2)
    expect(parsed.hunks[0].lines).toHaveLength(2)
  })
})
