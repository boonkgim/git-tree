/**
 * Which changed files are worth showing rather than describing.
 *
 * A binary diff can only ever say "these bytes differ", which for an icon or a
 * screenshot is the one thing the reader already knew. The extension is the
 * only signal available before anything is read — git does not record a media
 * type — so this table is deliberately conservative: it lists the formats a
 * Chromium renderer displays natively, and anything not on it keeps the plain
 * binary summary rather than producing an empty frame.
 */

import type { MediaKind } from './types'

export interface MediaType {
  kind: MediaKind
  /** MIME type for the data URL. */
  mime: string
}

const IMAGES: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml'
}

const VIDEOS: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg'
}

const AUDIOS: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg'
}

/** The media type of a path, or null when it is not something to display. */
export function mediaTypeForPath(path: string): MediaType | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()

  const image = IMAGES[extension]
  if (image) return { kind: 'image', mime: image }
  const video = VIDEOS[extension]
  if (video) return { kind: 'video', mime: video }
  const audio = AUDIOS[extension]
  if (audio) return { kind: 'audio', mime: audio }
  return null
}
