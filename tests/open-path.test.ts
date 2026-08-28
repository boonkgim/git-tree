import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

vi.mock('electron', () => ({ shell: { openPath: async () => '' } }))

const { resolveInsideRoot } = await import('../src/main/open')

/**
 * The renderer names the path to open, so the containment check is the only
 * thing standing between a bad string and the desktop opening a file outside
 * the repository.
 */
describe('resolveInsideRoot', () => {
  const root = '/repos/demo'

  it('resolves a path in the working tree', () => {
    expect(resolveInsideRoot(root, 'src/main/open.ts')).toBe(resolve(root, 'src/main/open.ts'))
    expect(resolveInsideRoot(root, 'src')).toBe(resolve(root, 'src'))
    expect(resolveInsideRoot(root, '')).toBe(resolve(root))
  })

  it('allows a ".." that stays inside', () => {
    expect(resolveInsideRoot(root, 'src/../docs')).toBe(resolve(root, 'docs'))
  })

  it('refuses anything that leaves the root', () => {
    for (const bad of ['..', '../secrets', 'src/../../secrets', '/etc/passwd', 'a\0b']) {
      expect(() => resolveInsideRoot(root, bad)).toThrow(/outside the repository/)
    }
  })

  it('refuses a sibling directory with the root as a name prefix', () => {
    expect(() => resolveInsideRoot(root, '../demo-private/x')).toThrow(/outside the repository/)
  })
})
