import { describe, expect, it } from 'vitest'
import { tokenize, wordDiff } from '../src/shared/worddiff'

/** Applies the ranges so assertions read as the text that gets highlighted. */
function highlighted(line: string, ranges: Array<[number, number]>): string[] {
  return ranges.map(([start, end]) => line.slice(start, end))
}

describe('tokenize', () => {
  it('splits into words, whitespace runs and single symbols', () => {
    expect(tokenize('a.b c').map((t) => t.text)).toEqual(['a', '.', 'b', ' ', 'c'])
  })
  it('records where each token starts', () => {
    expect(tokenize('ab cd')[2]).toEqual({ text: 'cd', start: 3 })
  })
})

describe('wordDiff', () => {
  it('highlights nothing when the lines are identical', () => {
    expect(wordDiff('same', 'same')).toEqual({ del: [], add: [] })
  })

  it('highlights only the word that changed', () => {
    const before = 'const timeout = 30'
    const after = 'const timeout = 60'
    const { del, add } = wordDiff(before, after)
    expect(highlighted(before, del)).toEqual(['30'])
    expect(highlighted(after, add)).toEqual(['60'])
  })

  it('highlights an inserted argument without touching the rest', () => {
    const before = 'call(a, b)'
    const after = 'call(a, c, b)'
    const { add } = wordDiff(before, after)
    expect(highlighted(after, add).join('')).toContain('c')
    expect(highlighted(after, add).join('')).not.toContain('call')
  })

  it('gives up on lines that are unrelated, where highlighting would be noise', () => {
    expect(wordDiff('import fs from "fs"', 'export default function thing() {}')).toEqual({
      del: [],
      add: []
    })
  })

  it('merges adjacent changed tokens into one range', () => {
    const before = 'x = 1'
    const after = 'x = 22'
    const { add } = wordDiff(before, after)
    expect(add).toHaveLength(1)
  })

  it('stays cheap on very long lines instead of building a huge table', () => {
    const long = 'a '.repeat(5000)
    const started = Date.now()
    expect(wordDiff(long, `${long}b`)).toEqual({ del: [], add: [] })
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('handles an empty line on either side', () => {
    expect(wordDiff('', 'added')).toEqual({ del: [], add: [] })
    expect(wordDiff('removed', '')).toEqual({ del: [], add: [] })
  })
})
