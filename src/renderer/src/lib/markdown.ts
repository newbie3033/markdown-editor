export interface OutlineItem {
  text: string
  level: number
  id: string
}

export interface DocStats {
  words: number
  characters: number
  lines: number
}

export function headingIdFromText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, '-')
}

const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const word = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['_’-][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Each CJK character counts as one word, alongside words in other scripts. */
export function countWords(text: string): number {
  let words = 0
  const remaining = text.replace(cjkCharacter, () => {
    words++
    return ' '
  })
  for (const _ of remaining.matchAll(word)) words++
  return words
}

export function computeStats(markdown: string): DocStats {
  let characters = 0
  let lines = 0
  if (markdown) {
    for (const line of markdown.split(/\r\n|[\n\r]/)) {
      lines++
      // Most prose has one visible character per UTF-16 unit. Only use
      // Unicode segmentation where a line can contain composite graphemes.
      if (/^[\x20-\x7e\t\u4e00-\u9fff]*$/.test(line)) characters += line.length
      else for (const _ of graphemes.segment(line)) characters++
    }
  }
  return { words: countWords(markdown), characters, lines }
}

export function fileNameFromPath(path: string | null): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

export function dirNameFromPath(path: string): string {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return lastSep > 0 ? path.slice(0, lastSep) : path
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.avif'
])

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name))
}

export function isImageFileName(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name))
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Resolve and authorize an OS-backed dropped file in the preload. Keeping
 * webUtils out of the renderer prevents arbitrary strings from being treated
 * as user-approved filesystem paths.
 */
export async function authorizeDroppedFile(
  file: File
): Promise<{ path: string; isDirectory: boolean; url?: string } | null> {
  try {
    return await window.api.authorizeDroppedFile(file)
  } catch {
    return null
  }
}
