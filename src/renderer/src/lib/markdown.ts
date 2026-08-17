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

const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** Rough, Typora-like word count: CJK chars each count as one word. */
export function countWords(text: string): number {
  let cjk = 0
  let latinWords = 0
  for (const ch of text) {
    if (CJK.test(ch)) cjk += 1
  }
  const withoutCjk = text.replace(new RegExp(CJK, 'g'), ' ')
  const tokens = withoutCjk.match(/[A-Za-z0-9_'-]+/g)
  if (tokens) latinWords = tokens.length
  return cjk + latinWords
}

export function computeStats(markdown: string): DocStats {
  const lines = markdown.length === 0 ? 0 : markdown.split('\n').length
  return {
    words: countWords(markdown),
    characters: markdown.length,
    lines
  }
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
