import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { shell } from 'electron'
import { GitError } from './git/exec'

/**
 * Hands a path inside the working tree to the desktop's default handler.
 *
 * This is the only place the application asks the operating system to act on a
 * file, so the containment check lives here: the path always arrives from the
 * renderer, which is never trusted with a filesystem path. Anything that does
 * not resolve to somewhere under the repository root is refused outright,
 * which also rules out the `..` and absolute-path forms.
 *
 * Opening is still not writing: `shell.openPath` launches whatever application
 * the desktop has registered for the file, exactly as a double-click in a file
 * manager would. Nothing here touches the repository.
 */
export async function openInWorkingTree(root: string, relativePath: string): Promise<void> {
  const target = resolveInsideRoot(root, relativePath)
  const label = relativePath || '.'

  let directory = false
  try {
    directory = (await stat(target)).isDirectory()
    await access(target, constants.R_OK)
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException)?.code === 'ENOENT'
    throw new GitError({
      code: 'UNREADABLE',
      message: missing
        ? `${label} is not in the working tree — it exists only in the commit being shown.`
        : `${label} could not be read.`,
      detail: target
    })
  }

  const failure = await shell.openPath(target)
  if (failure) {
    throw new GitError({
      code: 'UNREADABLE',
      message: `No application is registered to open ${directory ? 'the folder ' : ''}${label}.`,
      detail: failure
    })
  }
}

/**
 * Resolves `relativePath` against `root` and refuses anything that escapes it.
 * Symlinks are followed by the OS afterwards; the check is on the path the
 * renderer named, which is the part a caller controls.
 */
export function resolveInsideRoot(root: string, relativePath: string): string {
  const base = resolve(root)
  const target = resolve(join(base, relativePath))
  const inside = relative(base, target)
  const escapes =
    isAbsolute(relativePath) ||
    relativePath.includes('\0') ||
    isAbsolute(inside) ||
    inside === '..' ||
    inside.startsWith(`..${sep}`)
  if (escapes) {
    throw new GitError({ code: 'FORBIDDEN', message: 'That path is outside the repository.' })
  }
  return target
}
