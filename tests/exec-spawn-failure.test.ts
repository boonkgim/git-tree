import { describe, expect, it } from 'vitest'
import { runGit, setGitBinary, spawnError } from '../src/main/git/exec'

/**
 * `spawn` reports a failure to start two ways: asynchronously on the child's
 * `error` event when the binary cannot be run, and synchronously out of the
 * call itself when the stdio pipes cannot be set up, which is what a machine
 * short of file handles does. Node spells the second one as a bare
 * `spawn ENOTCONN`, with no binary name and nothing a reader can act on, so
 * both have to arrive as a GitTreeError instead.
 */
describe('a git that cannot be started', () => {
  it('reports a missing binary as GIT_MISSING, not as a raw spawn error', async () => {
    setGitBinary('git-that-does-not-exist-anywhere')
    try {
      await runGit(process.cwd(), ['status'])
      expect.unreachable('should have rejected')
    } catch (e) {
      const info = (e as { info?: { code: string; message: string } }).info
      expect(info?.code).toBe('GIT_MISSING')
      expect(info?.message).not.toMatch(/^spawn /)
    } finally {
      setGitBinary('git')
    }
  })

  it('maps a missing binary to GIT_MISSING', () => {
    const error = spawnError(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))
    expect(error.info.code).toBe('GIT_MISSING')
  })

  it('never lets a bare "spawn CODE" through as the message', () => {
    for (const code of ['ENOTCONN', 'EMFILE', 'ENFILE', 'EPERM', 'EAGAIN']) {
      const error = spawnError(Object.assign(new Error(`spawn ${code}`), { code }))
      expect(error.info.code).toBe('GIT_FAILED')
      expect(error.info.message).toBe(`Could not run git: spawn ${code}`)
      expect(error.info.message).not.toMatch(/^spawn /)
    }
  })

  it('explains the out-of-file-handles cases, which say nothing on their own', () => {
    for (const code of ['ENOTCONN', 'EMFILE', 'ENFILE']) {
      const error = spawnError(Object.assign(new Error(`spawn ${code}`), { code }))
      expect(error.info.detail).toMatch(/file handles/)
    }
    // Anything else gets no invented explanation.
    const other = spawnError(Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }))
    expect(other.info.detail).toBeUndefined()
  })
})
