import type { RefEntry } from '@shared/types'
import { runGit } from './exec'

/**
 * Fields asked of `for-each-ref`, in order. `%1f` separates them and `%00`
 * separates records, so a ref name or subject containing whitespace, quotes or
 * newlines stays one field.
 *
 * `creatordate` rather than `committerdate` because an annotated tag is a tag
 * object with no committer; creatordate is the tagger date there and the
 * committer date everywhere else.
 */
const REF_FORMAT = [
  '%(refname)',
  '%(objecttype)',
  // The two `*` fields are set only for an annotated tag: what it points at,
  // already peeled.
  '%(*objecttype)',
  '%(objectname)',
  '%(*objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(creatordate:iso-strict)',
  '%(contents:subject)'
].join('%1f')

const UNIT = '\x1f'

/** `[ahead 2, behind 1]`, `[ahead 3]`, `[behind 4]`, `[gone]`, or empty. */
function parseTrack(track: string): Pick<RefEntry, 'ahead' | 'behind' | 'upstreamGone'> {
  if (/\[gone\]/.test(track)) return { upstreamGone: true }
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : undefined,
    behind: behind ? Number(behind[1]) : undefined
  }
}

function classify(refname: string): { kind: RefEntry['kind']; name: string } | null {
  if (refname.startsWith('refs/heads/')) {
    return { kind: 'branch', name: refname.slice('refs/heads/'.length) }
  }
  if (refname.startsWith('refs/remotes/')) {
    return { kind: 'remote', name: refname.slice('refs/remotes/'.length) }
  }
  if (refname.startsWith('refs/tags/')) {
    return { kind: 'tag', name: refname.slice('refs/tags/'.length) }
  }
  return null
}

export function parseRefRecords(text: string): RefEntry[] {
  const out: RefEntry[] = []
  for (const record of text.split('\0')) {
    // `for-each-ref` ends each record with a newline of its own, which the NUL
    // split leaves at the front of the next one.
    const trimmed = record.replace(/^\n+/, '')
    if (!trimmed) continue
    const fields = trimmed.split(UNIT)
    if (fields.length < 10) continue
    const [refname, objectType, peeledType, objectName, peeled, head, upstream, track, date, subject] =
      fields

    const classified = classify(refname)
    if (!classified) continue

    // An annotated tag resolves through its peeled commit. A tag pointing at a
    // tree or a blob — annotated or not — has no commit anywhere in it, so it
    // is left out rather than shown as a row that cannot be jumped to.
    const sha = objectType === 'tag' ? peeled : objectName
    const type = objectType === 'tag' ? peeledType : objectType
    if (type !== 'commit') continue
    if (!/^[0-9a-f]{4,64}$/i.test(sha)) continue

    out.push({
      name: classified.name,
      kind: classified.kind,
      sha,
      isHead: head.trim() === '*',
      upstream: upstream || undefined,
      ...parseTrack(track),
      date,
      subject
    })
  }
  return out
}

/**
 * Every branch, remote-tracking branch and tag in the repository.
 *
 * `refs/remotes/<remote>/HEAD` is dropped: it is a symbolic pointer at another
 * row in the same list, so showing it would mean the same commit twice under
 * two names that are not both real branches.
 */
export async function listRefs(cwd: string): Promise<RefEntry[]> {
  const result = await runGit(cwd, [
    'for-each-ref',
    `--format=${REF_FORMAT}%00`,
    'refs/heads',
    'refs/remotes',
    'refs/tags'
  ])
  return parseRefRecords(result.stdout).filter(
    (entry) => !(entry.kind === 'remote' && entry.name.endsWith('/HEAD'))
  )
}
