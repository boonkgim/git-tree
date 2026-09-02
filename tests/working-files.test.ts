import { describe, expect, it } from 'vitest'
import { displayStatus } from '../src/main/git/working'

/**
 * `git status --porcelain=v2` reports two letters per file, and the all-files
 * panel has one column to show them in. These pin down which one wins.
 */
describe('displayStatus', () => {
  it('is clean when neither side has moved', () => {
    expect(displayStatus('.', '.')).toBe('clean')
  })

  it('prefers the working tree, which is what is on disk now', () => {
    expect(displayStatus('.', 'M')).toBe('modified')
    expect(displayStatus('.', 'D')).toBe('deleted')
    expect(displayStatus('.', 'T')).toBe('typechange')
  })

  it('falls back to the index for a file that was staged and then left alone', () => {
    expect(displayStatus('A', '.')).toBe('added')
    expect(displayStatus('M', '.')).toBe('modified')
  })

  it('still prefers the working tree when both sides moved differently', () => {
    // Staged as new, then edited again on disk: the disk copy is what a click
    // on the row will show, so the row says modified.
    expect(displayStatus('A', 'M')).toBe('modified')
  })

  it('treats an empty letter the way it treats an unchanged one', () => {
    expect(displayStatus('', '')).toBe('clean')
    expect(displayStatus('M', '')).toBe('modified')
  })
})
