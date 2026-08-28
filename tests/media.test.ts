import { describe, expect, it } from 'vitest'
import { mediaTypeForPath } from '../src/shared/media'

/**
 * The extension table decides whether a binary file is displayed or merely
 * described, so its edges matter: a dotfile is not an extension, and a format
 * the renderer cannot draw must not produce an empty frame.
 */
describe('mediaTypeForPath', () => {
  it('recognises images, video and sound', () => {
    expect(mediaTypeForPath('docs/shot.png')).toEqual({ kind: 'image', mime: 'image/png' })
    expect(mediaTypeForPath('a/b/Photo.JPEG')).toEqual({ kind: 'image', mime: 'image/jpeg' })
    expect(mediaTypeForPath('build/icon.svg')).toEqual({ kind: 'image', mime: 'image/svg+xml' })
    expect(mediaTypeForPath('demo.webm')).toEqual({ kind: 'video', mime: 'video/webm' })
    expect(mediaTypeForPath('sfx/ping.mp3')).toEqual({ kind: 'audio', mime: 'audio/mpeg' })
  })

  it('declines everything it cannot draw', () => {
    for (const path of [
      'src/main.ts',
      'README',
      'archive.tar.gz',
      'scan.tiff',
      'photo.heic',
      'a/b.psd'
    ]) {
      expect(mediaTypeForPath(path)).toBeNull()
    }
  })

  it('does not treat a leading dot as an extension', () => {
    expect(mediaTypeForPath('.png')).toBeNull()
    expect(mediaTypeForPath('dir/.gitignore')).toBeNull()
  })

  it('is not fooled by a directory name that has an extension', () => {
    expect(mediaTypeForPath('assets.png/readme.txt')).toBeNull()
    expect(mediaTypeForPath('assets.png/logo.gif')).toEqual({ kind: 'image', mime: 'image/gif' })
  })
})
