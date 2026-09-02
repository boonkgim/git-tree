import { describe, expect, it } from 'vitest'
import { ALLOWED_SUBCOMMANDS, assertReadOnly, decodeUtf8 } from '../src/main/git/exec'
import { buildDiffArgs, buildUntrackedPatchArgs } from '../src/main/git/selection'
import { DEFAULT_DIFF_OPTIONS, type DiffSpec } from '../src/shared/types'

/**
 * The application's one hard invariant is that it never writes to the
 * repository. These tests are what make that a checkable claim: if someone adds
 * a mutating command, the guard has to be edited deliberately and these fail.
 */
describe('read-only guard', () => {
  const mutating = [
    ['commit', '-m', 'x'],
    ['add', '.'],
    ['checkout', 'main'],
    ['switch', 'main'],
    ['restore', '.'],
    ['reset', '--hard'],
    ['push', 'origin', 'main'],
    ['fetch'],
    ['pull'],
    ['stash'],
    ['clean', '-fd'],
    ['gc'],
    ['update-ref', 'refs/heads/x', 'HEAD'],
    ['rebase', 'main'],
    ['merge', 'topic'],
    ['cherry-pick', 'abc'],
    ['apply', 'p.patch'],
    ['worktree', 'add', '/tmp/x']
  ]

  it.each(mutating)('refuses git %s', (...args) => {
    expect(() => assertReadOnly(args)).toThrow(/only performs reads|Refusing/)
  })

  it('refuses hash-object -w, which would write to the object store', () => {
    expect(() => assertReadOnly(['hash-object', '-w', '-t', 'tree', '--stdin'])).toThrow(/Refusing/)
  })

  it('allows hash-object without -w, which only computes an id', () => {
    expect(() => assertReadOnly(['hash-object', '-t', 'tree', '--stdin'])).not.toThrow()
  })

  it('refuses arguments that would run an external program', () => {
    expect(() => assertReadOnly(['diff', '--ext-diff', 'HEAD'])).toThrow(/Refusing/)
    expect(() => assertReadOnly(['diff', '--textconv', 'HEAD'])).toThrow(/Refusing/)
    expect(() => assertReadOnly(['log', '--output=/tmp/x'])).toThrow(/Refusing/)
  })

  it('refuses arguments that would reach the network', () => {
    expect(() => assertReadOnly(['rev-list', '--upload-pack=evil', 'HEAD'])).toThrow(/Refusing/)
  })

  it('refuses an unexpected git-level option', () => {
    expect(() => assertReadOnly(['--exec-path=/tmp', 'log'])).toThrow(/git-level option/)
  })

  it('accepts -c pairs before the subcommand', () => {
    expect(() => assertReadOnly(['-c', 'color.ui=false', 'log'])).not.toThrow()
  })

  it('does not mistake a pathspec for a flag', () => {
    // A file really can be called "--ext-diff"; after `--` it is data.
    expect(() => assertReadOnly(['diff', 'HEAD', '--', '--ext-diff'])).not.toThrow()
    expect(() => assertReadOnly(['log', '--', '--upload-pack'])).not.toThrow()
  })

  it('refuses an empty argument list', () => {
    expect(() => assertReadOnly([])).toThrow(/no subcommand/)
  })

  it('only allows subcommands that read', () => {
    expect(ALLOWED_SUBCOMMANDS).toEqual([...ALLOWED_SUBCOMMANDS].sort())
    for (const subcommand of ALLOWED_SUBCOMMANDS) {
      expect(['commit', 'add', 'push', 'checkout', 'reset']).not.toContain(subcommand)
    }
  })
})

describe('every generated diff command is safe', () => {
  const specs: DiffSpec[] = [
    { mode: 'commit', base: 'aaa', target: 'bbb', parentIndex: 0, parents: ['aaa'] },
    { mode: 'root', base: 'empty', target: 'bbb' },
    { mode: 'working', base: 'HEADSHA', baseIsHead: true },
    { mode: 'range', base: 'aaa', target: 'bbb', relation: 'ancestor' }
  ]

  it.each(specs.map((s) => [s.mode, s] as const))(
    'passes the guard and disables external programs for %s',
    (_mode, spec) => {
      for (const format of ['name-status', 'numstat', 'patch'] as const) {
        const args = buildDiffArgs(spec, format, DEFAULT_DIFF_OPTIONS, ['some file.txt'])
        expect(() => assertReadOnly(args)).not.toThrow()
        expect(args).toContain('--no-ext-diff')
        expect(args).toContain('--no-textconv')
        // Pathspecs must always be behind `--`.
        expect(args.indexOf('--')).toBeGreaterThan(-1)
        expect(args.slice(args.indexOf('--') + 1)).toEqual(['some file.txt'])
      }
    }
  )

  it('guards the untracked-file patch command too', () => {
    const args = buildUntrackedPatchArgs('weird name.txt', DEFAULT_DIFF_OPTIONS)
    expect(() => assertReadOnly(args)).not.toThrow()
    expect(args).toContain('--no-index')
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['/dev/null', 'weird name.txt'])
  })
})

describe('output decoding', () => {
  it('decodes valid UTF-8 without flagging it', () => {
    const result = decodeUtf8(Buffer.from('héllo — ok', 'utf8'))
    expect(result).toEqual({ text: 'héllo — ok', nonUtf8: false })
  })

  it('flags invalid bytes instead of throwing', () => {
    const result = decodeUtf8(Buffer.from([0x61, 0xff, 0xfe, 0x62]))
    expect(result.nonUtf8).toBe(true)
    expect(result.text).toContain('�')
    expect(result.text.startsWith('a')).toBe(true)
  })
})

describe('the all-files listing runs only reads', () => {
  const invocations = [
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard'],
    ['diff', '--numstat', '-z', '--no-color', 'HEAD']
  ]
  for (const args of invocations) {
    it(`allows ${args.join(' ')}`, () => {
      expect(() => assertReadOnly(args)).not.toThrow()
    })
  }
})
