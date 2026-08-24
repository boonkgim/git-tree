import { describe, expect, it } from 'vitest'
import { allRefGroupKeys, buildRefTreeRows, filterRefs, groupKey, sectionKey } from '../src/shared/reftree'
import { parseRefRecords } from '../src/main/git/refs'
import type { RefEntry } from '../src/shared/types'

function ref(name: string, kind: RefEntry['kind'] = 'branch', extra: Partial<RefEntry> = {}): RefEntry {
  return {
    name,
    kind,
    sha: 'a'.repeat(40),
    isHead: false,
    date: '2026-01-01T00:00:00+00:00',
    subject: 'x',
    ...extra
  }
}

/** `kind:label` for each row, which is all these tests care about. */
function shape(entries: RefEntry[], collapsed?: ReadonlySet<string>): string[] {
  return buildRefTreeRows(entries, collapsed).map((row) =>
    row.kind === 'ref' ? `ref:${row.label}@${row.depth}` : `${row.kind}:${row.label}@${'depth' in row ? row.depth : '-'}`
  )
}

describe('ref tree', () => {
  it('groups sections in a fixed order and leaves empty ones out', () => {
    const rows = buildRefTreeRows([ref('main'), ref('v1', 'tag')])
    expect(rows.map((r) => (r.kind === 'section' ? r.label : null)).filter(Boolean)).toEqual([
      'Branches',
      'Tags'
    ])
  })

  it('has no rows at all for a repository with no refs', () => {
    expect(buildRefTreeRows([])).toEqual([])
  })

  it('nests names on slashes', () => {
    expect(shape([ref('main'), ref('feature/login'), ref('feature/signup')])).toEqual([
      'section:Branches@-',
      'group:feature@0',
      'ref:login@1',
      'ref:signup@1',
      'ref:main@0'
    ])
  })

  it('folds a chain of single-child groups into one row', () => {
    expect(shape([ref('release/candidate/2.1')])).toEqual([
      'section:Branches@-',
      'group:release/candidate@0',
      'ref:2.1@1'
    ])
  })

  it('stops folding where a group holds a ref of its own', () => {
    expect(shape([ref('release/2.0'), ref('release/candidate/2.1')])).toEqual([
      'section:Branches@-',
      'group:release@0',
      'group:candidate@1',
      'ref:2.1@2',
      'ref:2.0@1'
    ])
  })

  it('hides everything under a collapsed group but keeps its count', () => {
    const entries = [ref('main'), ref('feature/login'), ref('feature/signup')]
    const rows = buildRefTreeRows(entries, new Set([groupKey('branch', 'feature')]))
    expect(rows.map((r) => (r.kind === 'ref' ? r.label : r.label))).toEqual([
      'Branches',
      'feature',
      'main'
    ])
    const group = rows.find((r) => r.kind === 'group')
    expect(group && group.kind === 'group' && group.count).toBe(2)
  })

  it('hides a whole section when its header is collapsed', () => {
    const rows = buildRefTreeRows([ref('main')], new Set([sectionKey('branch')]))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('section')
  })

  it('keys groups per section, so origin/feature and feature collapse apart', () => {
    const keys = allRefGroupKeys([ref('feature/a'), ref('origin/feature/b', 'remote')])
    expect(keys).toEqual(['branch:', 'branch:feature', 'remote:', 'remote:origin/feature'])
  })

  it('orders refs and groups by name, not by the order git listed them', () => {
    expect(shape([ref('zeta'), ref('alpha')])).toEqual([
      'section:Branches@-',
      'ref:alpha@0',
      'ref:zeta@0'
    ])
  })
})

describe('filterRefs', () => {
  const entries = [ref('main'), ref('feature/login'), ref('origin/main', 'remote'), ref('v1.0', 'tag')]

  it('matches anywhere in the name, ignoring case', () => {
    expect(filterRefs(entries, 'MAIN').map((e) => e.name)).toEqual(['main', 'origin/main'])
    expect(filterRefs(entries, 'log').map((e) => e.name)).toEqual(['feature/login'])
  })

  it('returns everything for an empty or blank query', () => {
    expect(filterRefs(entries, '')).toHaveLength(4)
    expect(filterRefs(entries, '   ')).toHaveLength(4)
  })

  it('returns nothing rather than everything when there is no match', () => {
    expect(filterRefs(entries, 'nope')).toEqual([])
  })
})

/* ------------------------------------------------------------------ parsing */

const UNIT = '\x1f'

function record(fields: string[]): string {
  return `${fields.join(UNIT)}\0`
}

describe('parseRefRecords', () => {
  const commit = '9b1fe87961811f06936384eb1e83357247740d33'
  const tagObject = 'd11ab8451df0d63a1a4dff437cc37db008455f64'

  it('reads a local branch with its upstream and tracking counts', () => {
    const [entry] = parseRefRecords(
      record([
        'refs/heads/main',
        'commit',
        '',
        commit,
        '',
        '*',
        'origin/main',
        '[ahead 2, behind 1]',
        '2026-08-21T06:00:40+08:00',
        'Add a flat/tree toggle'
      ])
    )
    expect(entry).toMatchObject({
      name: 'main',
      kind: 'branch',
      sha: commit,
      isHead: true,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      subject: 'Add a flat/tree toggle'
    })
    expect(entry.upstreamGone).toBeUndefined()
  })

  it('reads ahead-only and behind-only tracking', () => {
    const fields = (track: string): string[] => [
      'refs/heads/x',
      'commit',
      '',
      commit,
      '',
      ' ',
      'origin/x',
      track,
      '2026-08-21T06:00:40+08:00',
      's'
    ]
    expect(parseRefRecords(record(fields('[ahead 3]')))[0]).toMatchObject({
      ahead: 3,
      behind: undefined
    })
    expect(parseRefRecords(record(fields('[behind 4]')))[0]).toMatchObject({
      ahead: undefined,
      behind: 4
    })
    expect(parseRefRecords(record(fields('[gone]')))[0]).toMatchObject({ upstreamGone: true })
  })

  it('peels an annotated tag to the commit it points at', () => {
    const [entry] = parseRefRecords(
      record([
        'refs/tags/v1',
        'tag',
        'commit',
        tagObject,
        commit,
        ' ',
        '',
        '',
        '2026-08-21T06:00:40+08:00',
        'annotated one'
      ])
    )
    expect(entry).toMatchObject({ name: 'v1', kind: 'tag', sha: commit, isHead: false })
  })

  it('drops a tag that does not point at a commit', () => {
    expect(
      parseRefRecords(
        record(['refs/tags/blobby', 'blob', '', tagObject, '', ' ', '', '', '2026-01-01T00:00:00+00:00', ''])
      )
    ).toEqual([])
  })

  it('drops an annotated tag whose target is not a commit', () => {
    expect(
      parseRefRecords(
        record([
          'refs/tags/treeish',
          'tag',
          'tree',
          tagObject,
          '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
          ' ',
          '',
          '',
          '2026-01-01T00:00:00+00:00',
          'points at a tree'
        ])
      )
    ).toEqual([])
  })

  it('keeps a subject containing the field and record separators intact', () => {
    // git cannot emit these inside a field, but a corrupt record must not be
    // able to smuggle one ref into another's fields.
    const [entry] = parseRefRecords(
      `${record([
        'refs/remotes/origin/main',
        'commit',
        '',
        commit,
        '',
        ' ',
        '',
        '',
        '2026-08-21T06:00:40+08:00',
        'subject with spaces, and a comma'
      ])}`
    )
    expect(entry).toMatchObject({
      name: 'origin/main',
      kind: 'remote',
      subject: 'subject with spaces, and a comma'
    })
  })

  it('skips the newline git puts between records, and short records', () => {
    const text = `${record(['refs/heads/a', 'commit', '', commit, '', ' ', '', '', 'd', 's'])}\n${record([
      'refs/heads/b',
      'commit',
      '',
      commit,
      '',
      ' ',
      '',
      '',
      'd',
      's'
    ])}\ntruncated${UNIT}record`
    expect(parseRefRecords(text).map((e) => e.name)).toEqual(['a', 'b'])
  })

  it('ignores refs outside heads, remotes and tags', () => {
    expect(
      parseRefRecords(record(['refs/stash', 'commit', '', commit, '', ' ', '', '', 'd', 's']))
    ).toEqual([])
  })
})
