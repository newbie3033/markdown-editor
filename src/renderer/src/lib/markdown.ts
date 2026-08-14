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

type FileWithPath = File & { path?: string }

/**
 * Resolve the filesystem path of a dropped file. Prefers the official
 * `webUtils.getPathForFile` API (the `File.path` augmentation was removed in
 * newer Electron versions) and falls back to the legacy property.
 * Returns '' for clipboard-only files (no filesystem backing).
 */
export function filePathOf(file: File): string {
  try {
    const resolved = window.api.getPathForFile(file)
    if (resolved) return resolved
  } catch {
    // getPathForFile unavailable — fall through to the legacy property.
  }
  return (file as FileWithPath).path ?? ''
}
