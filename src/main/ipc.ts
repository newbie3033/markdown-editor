import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import {
  existsSync,
  promises as fs,
  realpathSync,
  statSync,
  watch,
  type FSWatcher,
  type Stats
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  IPC,
  REPOSITORY_URL,
  compileSearchRegex,
  type FileEntry,
  type FileResult,
  type FileSearchResult,
  type FileVersion,
  type ReadFileResult,
  type RecoveryDraft,
  type DroppedPathResult,
  type SaveImagePayload,
  type SaveImageResult,
  type SaveResult,
  type SearchMatch,
  type SearchFlags,
  type RegexTextSegment,
  type TextRange,
  type WriteFileResult
} from '../shared/ipc'
import { getLocale, setLocale, t } from './i18n'
import { setReadOnlyMode } from './menu'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])

const MAX_SEARCH_FILES = 300
const MAX_MATCHES_PER_FILE = 60
const MAX_IN_DOCUMENT_MATCHES = 10_000
const REGEX_TIMEOUT_MS = 1_000
const MAX_TREE_ENTRIES = 5000
const MAX_SEARCH_FILE_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_OPEN_FILE_BYTES = 64 * 1024 * 1024
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_EXPORT_IMAGE_BYTES = 128 * 1024 * 1024
const MAX_RECOVERY_CONTENT_BYTES = MAX_OPEN_FILE_BYTES
const MAX_RECOVERY_FILE_BYTES = MAX_OPEN_FILE_BYTES * 2 + 1024 * 1024
const RECOVERY_FILE = 'recovery-draft.json'
const BACKUP_DIR = 'backups'
const ASSET_ORIGIN = 'inkmark-asset://local'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

const grantedFiles = new Set<string>()
const grantedDirectories = new Set<string>()
const documentAssetDirectories = new Map<string, string>()
const documentImageGrants = new Map<string, Set<string>>()
const pendingExportDocuments = new Map<string, string>()

function canonicalPath(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch {
    try {
      return join(realpathSync.native(dirname(absolute)), basename(absolute))
    } catch {
      return absolute
    }
  }
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function grantFileAccess(path: string): void {
  grantedFiles.add(canonicalPath(path))
}

export function grantDocumentAccess(path: string): void {
  const canonical = canonicalPath(path)
  grantedFiles.add(canonical)
  // Clipboard images are written beneath this document-specific directory.
  // Opening a loose document must not authorize its entire parent directory.
  documentAssetDirectories.set(canonical, canonicalPath(join(dirname(canonical), 'assets')))
}

export function grantDirectoryAccess(path: string): void {
  grantedDirectories.add(canonicalPath(path))
}

function releaseDocumentAccess(path: string): void {
  const canonical = canonicalPath(path)
  grantedFiles.delete(canonical)
  documentAssetDirectories.delete(canonical)
  documentImageGrants.delete(canonical)
}

function releaseDirectoryAccess(path: string): void {
  grantedDirectories.delete(canonicalPath(path))
}

function assertPathAccess(path: string): string {
  if (typeof path !== 'string' || !path) throw new TypeError('Invalid filesystem path')
  const canonical = canonicalPath(path)
  if (
    !grantedFiles.has(canonical) &&
    !Array.from(grantedDirectories).some((root) => isWithin(canonical, root)) &&
    !Array.from(documentAssetDirectories.values()).some((root) => isWithin(canonical, root)) &&
    !Array.from(documentImageGrants.values()).some((paths) => paths.has(canonical))
  ) {
    throw new Error('Filesystem path was not authorized by the user')
  }
  return canonical
}

function pathToAssetUrl(path: string): string {
  return pathToFileURL(path).href.replace(/^file:\/\//, ASSET_ORIGIN)
}

function assetUrlToPath(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'inkmark-asset:' || url.hostname !== 'local') {
    throw new Error('Invalid local asset URL')
  }
  const fileUrl = new URL('file:///')
  fileUrl.pathname = url.pathname
  return fileURLToPath(fileUrl)
}

function localImagePath(value: string, documentPath: string): string | null {
  const src = value.trim()
  if (!src || /^(?:data:|https?:|blob:|#)/i.test(src)) return null
  try {
    if (src.startsWith('inkmark-asset:')) return assetUrlToPath(src)
    if (src.startsWith('file:')) return fileURLToPath(src)
  } catch {
    return null
  }
  let decoded = src
  try {
    decoded = decodeURIComponent(src)
  } catch {
    // Keep a literal percent sequence if the Markdown contains invalid URL encoding.
  }
  if (/^[A-Za-z]:[\\/]/.test(decoded) || isAbsolute(decoded)) return canonicalPath(decoded)
  return canonicalPath(resolve(dirname(documentPath), decoded.replace(/\\/g, sep)))
}

/** Grant only local image files explicitly referenced by the opened Markdown. */
function grantReferencedImages(documentPath: string, content: string): void {
  const canonicalDocument = canonicalPath(documentPath)
  const grants = new Set<string>()
  const sources: string[] = []
  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g
  const htmlImage = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  for (const match of content.matchAll(markdownImage)) sources.push(match[1] ?? match[2] ?? '')
  for (const match of content.matchAll(htmlImage)) sources.push(match[1] ?? '')
  for (const src of sources) {
    const path = localImagePath(src, documentPath)
    if (path && IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) grants.add(canonicalPath(path))
  }
  documentImageGrants.set(canonicalDocument, grants)
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function assertTextPayload(value: unknown, label: string, maxBytes = MAX_OPEN_FILE_BYTES): string {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${label}`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${label} is too large`)
  return value
}

const isMarkdown = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extname(name).toLowerCase())

function isAllowedExternalUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

async function readHandleSnapshot(
  handle: FileHandle,
  maxBytes: number
): Promise<{ data: Buffer; stat: Stats }> {
  const before = await handle.stat()
  if (before.size > maxBytes) throw new Error(`File is too large (${before.size} bytes)`)
  const data = Buffer.allocUnsafe(before.size)
  let offset = 0
  while (offset < data.length) {
    const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  const after = await handle.stat()
  if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('File changed while it was being read')
  }
  return { data, stat: after }
}

async function readUtf8(path: string): Promise<string> {
  const handle = await fs.open(path, 'r')
  try {
    return decodeUtf8Document((await readHandleSnapshot(handle, MAX_SEARCH_FILE_BYTES)).data).content
  } finally {
    await handle.close()
  }
}

function hasUtf8Bom(data: Uint8Array): boolean {
  return data.byteLength >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
}

function decodeUtf8Document(data: Uint8Array): { content: string; utf8Bom: boolean } {
  const utf8Bom = hasUtf8Bom(data)
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(
      utf8Bom ? data.subarray(3) : data
    )
    return { content, utf8Bom }
  } catch {
    throw new Error('The file is not valid UTF-8 and cannot be opened safely')
  }
}

function encodeDocument(content: string, utf8Bom = false): Buffer {
  const body = Buffer.from(content, 'utf8')
  return utf8Bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function toFileVersion(
  stat: { mtimeMs: number; size: number },
  hash: string,
  utf8Bom?: boolean
): FileVersion {
  return { mtimeMs: stat.mtimeMs, size: stat.size, sha256: hash, utf8Bom }
}

async function readDocument(path: string): Promise<ReadFileResult> {
  const handle = await fs.open(path, 'r')
  try {
    const { data, stat } = await readHandleSnapshot(handle, MAX_OPEN_FILE_BYTES)
    const decoded = decodeUtf8Document(data)
    const version = toFileVersion(stat, sha256(data), decoded.utf8Bom)
    const content = decoded.content
    grantReferencedImages(path, content)
    return { content, version }
  } finally {
    await handle.close()
  }
}

class FileConflictError extends Error {}

async function currentVersion(path: string): Promise<FileVersion | null> {
  try {
    const handle = await fs.open(path, 'r')
    try {
      const stat = await handle.stat()
      if (stat.size > MAX_OPEN_FILE_BYTES) {
        // Size/mtime still provide a bounded baseline for a native-dialog
        // overwrite without reading an arbitrarily large target into memory.
        const prefix = Buffer.allocUnsafe(Math.min(3, stat.size))
        if (prefix.byteLength > 0) await handle.read(prefix, 0, prefix.byteLength, 0)
        return toFileVersion(stat, '<large-file>', hasUtf8Bom(prefix))
      }
      const { data } = await readHandleSnapshot(handle, MAX_OPEN_FILE_BYTES)
      return toFileVersion(stat, sha256(data), hasUtf8Bom(data))
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function sameVersion(left: FileVersion | null, right: FileVersion | null): boolean {
  return (
    left?.mtimeMs === right?.mtimeMs &&
    left?.size === right?.size &&
    left?.sha256 === right?.sha256
  )
}

/**
 * Durably replace a file without truncating the previous version first.
 * The temporary file lives beside the target so the final rename stays on
 * the same filesystem and is atomic on supported local filesystems.
 */
async function atomicWriteFile(
  path: string,
  data: string | Uint8Array,
  createMode?: number,
  expectedVersion?: FileVersion | null,
  createBackup = false
): Promise<FileVersion> {
  // Preserve the behavior of saving through a symlink: replace its target,
  // rather than replacing the symlink itself.
  const targetPath = await fs.realpath(path).catch(() => path)
  const existing = await fs.stat(targetPath).catch(() => null)
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.inkmark-${process.pid}-${randomUUID()}.tmp`
  )
  let renamed = false

  try {
    const handle = await fs.open(tempPath, 'wx', existing?.mode ?? createMode)
    try {
      if (typeof data === 'string') await handle.writeFile(data, 'utf8')
      else await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }

    // Check as late as possible, after the replacement has been fully
    // flushed but before it becomes visible. This substantially narrows the
    // check/write race with other editors.
    if (expectedVersion !== undefined) {
      const current = await currentVersion(targetPath)
      if (!sameVersion(current, expectedVersion)) throw new FileConflictError()
    }

    if (createBackup && existing && existing.size <= MAX_OPEN_FILE_BYTES) {
      try {
        const backupDir = join(app.getPath('userData'), BACKUP_DIR)
        await fs.mkdir(backupDir, { recursive: true })
        const backupId = sha256(targetPath)
        const backupName = `${backupId}.bak`
        const previous = await fs.readFile(targetPath)
        await atomicWriteFile(join(backupDir, backupName), previous, 0o600)
        await fs.chmod(join(backupDir, backupName), 0o600).catch(() => undefined)
        await atomicWriteFile(
          join(backupDir, `${backupId}.json`),
          JSON.stringify({ path: targetPath, backedUpAt: Date.now() }),
          0o600
        )
        await fs.chmod(join(backupDir, `${backupId}.json`), 0o600).catch(() => undefined)
      } catch (error) {
        // A backup is defense-in-depth; failure must not prevent an otherwise
        // safe atomic save to the user's chosen document.
        console.warn('Failed to create previous-version backup', error)
      }
    }

    await fs.rename(tempPath, targetPath)
    renamed = true

    // Persist the directory entry where the platform supports syncing a
    // directory handle. Windows commonly rejects this, so it is best-effort.
    try {
      const dirHandle = await fs.open(dirname(targetPath), 'r')
      try {
        await dirHandle.sync()
      } finally {
        await dirHandle.close()
      }
    } catch {
      // The file contents were already flushed and renamed successfully.
    }
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    return toFileVersion(await fs.stat(targetPath), sha256(bytes), hasUtf8Bom(bytes))
  } finally {
    if (!renamed) await fs.unlink(tempPath).catch(() => undefined)
  }
}

function recoveryPath(): string {
  return join(app.getPath('userData'), RECOVERY_FILE)
}

function isRecoveryDraft(value: unknown): value is RecoveryDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<RecoveryDraft>
  const version = draft.fileVersion
  const validVersion =
    version === null ||
    (!!version &&
      typeof version.mtimeMs === 'number' &&
      typeof version.size === 'number' &&
      typeof version.sha256 === 'string' &&
      (version.utf8Bom === undefined || typeof version.utf8Bom === 'boolean'))
  const contentBytes = typeof draft.content === 'string' ? Buffer.byteLength(draft.content) : Infinity
  const cleanBytes =
    typeof draft.cleanContent === 'string' ? Buffer.byteLength(draft.cleanContent) : Infinity
  return (
    (typeof draft.filePath === 'string' || draft.filePath === null) &&
    typeof draft.content === 'string' &&
    typeof draft.cleanContent === 'string' &&
    validVersion &&
    typeof draft.sourceMode === 'boolean' &&
    typeof draft.updatedAt === 'number' &&
    contentBytes <= MAX_RECOVERY_CONTENT_BYTES &&
    cleanBytes <= MAX_RECOVERY_CONTENT_BYTES &&
    contentBytes + cleanBytes <= MAX_RECOVERY_FILE_BYTES
  )
}

const REGEX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')

function makeRegex(query, flags) {
  let pattern = query.trim()
  if (flags.wholeWord) {
    pattern = '(?<![\\p{L}\\p{N}_])(?:' + pattern + ')(?![\\p{L}\\p{N}_])'
  }
  const parts = ['g', 'm', 'u']
  if (!flags.caseSensitive) parts.push('i')
  return new RegExp(pattern, parts.join(''))
}

function ranges() {
  const output = []
  for (const segment of workerData.segments) {
    const regex = makeRegex(workerData.query, workerData.flags)
    let match
    while (output.length < workerData.maxMatches && (match = regex.exec(segment.text)) !== null) {
      output.push({ from: segment.offset + match.index, to: segment.offset + match.index + match[0].length })
      if (match[0].length === 0) regex.lastIndex += 1
    }
    if (output.length >= workerData.maxMatches) break
  }
  return output
}

function files() {
  const output = []
  for (const file of workerData.files) {
    const nameMatch = makeRegex(workerData.query, workerData.flags).test(file.name)
    const regex = makeRegex(workerData.query, workerData.flags)
    const matches = []
    let totalMatches = 0
    let line = 1
    let lineStart = 0
    let scanIndex = 0
    let match
    while (totalMatches < workerData.maxDocumentMatches && (match = regex.exec(file.content)) !== null) {
      if (matches.length < workerData.maxMatchesPerFile) {
        const index = match.index
        while (scanIndex < index) {
          const newline = file.content.indexOf('\n', scanIndex)
          if (newline === -1 || newline >= index) break
          line += 1
          lineStart = newline + 1
          scanIndex = newline + 1
        }
        scanIndex = index
        let lineEnd = file.content.indexOf('\n', index)
        if (lineEnd === -1) lineEnd = file.content.length
        matches.push({
          line,
          text: file.content.slice(lineStart, lineEnd).trim().slice(0, 120),
          globalIndex: totalMatches
        })
      }
      totalMatches += 1
      if (match[0].length === 0) regex.lastIndex += 1
    }
    if (nameMatch || matches.length > 0) {
      output.push({ path: file.path, name: file.name, nameMatch, totalMatches, matches })
    }
  }
  return output
}

try {
  parentPort.postMessage(workerData.kind === 'ranges' ? ranges() : files())
} catch (error) {
  throw error
}
`

function runRegexWorker<Result>(workerData: Record<string, unknown>): Promise<Result> {
  return new Promise((resolveWorker, rejectWorker) => {
    const worker = new Worker(REGEX_WORKER_SOURCE, { eval: true, workerData })
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      finish(() => {
        void worker.terminate()
        rejectWorker(new Error('Regular expression search timed out'))
      })
    }, REGEX_TIMEOUT_MS)
    worker.once('message', (result: Result) => finish(() => resolveWorker(result)))
    worker.once('error', (error) => finish(() => rejectWorker(error)))
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => rejectWorker(new Error('Regular expression worker stopped')))
    })
  })
}

async function findRegexMatches(
  segments: RegexTextSegment[],
  query: string,
  flags: SearchFlags
): Promise<TextRange[]> {
  if (!flags.regex || !compileSearchRegex(query, flags)) return []
  if (!Array.isArray(segments) || segments.length > MAX_IN_DOCUMENT_MATCHES) {
    throw new TypeError('Invalid search segments')
  }
  let totalBytes = 0
  for (const segment of segments) {
    if (
      !segment ||
      typeof segment.text !== 'string' ||
      typeof segment.offset !== 'number' ||
      !Number.isSafeInteger(segment.offset) ||
      segment.offset < 0
    ) throw new TypeError('Invalid search segment')
    totalBytes += Buffer.byteLength(segment.text)
    if (totalBytes > MAX_OPEN_FILE_BYTES) throw new Error('Search document is too large')
  }
  return runRegexWorker<TextRange[]>({
    kind: 'ranges',
    segments,
    query: query.trim(),
    flags,
    maxMatches: MAX_IN_DOCUMENT_MATCHES
  })
}

/** Walk a directory and collect markdown file paths (flat list, budget-capped). */
async function collectMarkdownFiles(
  dir: string,
  depth: number,
  acc: string[]
): Promise<void> {
  if (depth > 24 || acc.length >= MAX_SEARCH_FILES) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (acc.length >= MAX_SEARCH_FILES) return
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdownFiles(fullPath, depth + 1, acc)
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      acc.push(fullPath)
    }
  }
}

async function searchFiles(
  folderPath: string,
  query: string,
  flags: SearchFlags = {}
): Promise<FileSearchResult[]> {
  const regex = compileSearchRegex(query, flags)
  if (!regex) return []

  const files: string[] = []
  await collectMarkdownFiles(folderPath, 0, files)

  if (flags.regex) {
    const workerFiles: Array<{ path: string; name: string; content: string }> = []
    let searchedBytes = 0
    for (const file of files) {
      try {
        const stat = await fs.stat(file)
        if (stat.size > MAX_SEARCH_FILE_BYTES || searchedBytes + stat.size > MAX_SEARCH_TOTAL_BYTES) {
          continue
        }
        const content = await readUtf8(file)
        searchedBytes += Buffer.byteLength(content)
        workerFiles.push({ path: file, name: basename(file), content })
      } catch {
        // Skip unreadable and non-UTF-8 files.
      }
    }
    return runRegexWorker<FileSearchResult[]>({
      kind: 'files',
      files: workerFiles,
      query: query.trim(),
      flags,
      maxMatchesPerFile: MAX_MATCHES_PER_FILE,
      maxDocumentMatches: MAX_IN_DOCUMENT_MATCHES
    })
  }

  const results: FileSearchResult[] = []
  let searchedBytes = 0
  for (const file of files) {
    const name = basename(file)
    const nameRegex = compileSearchRegex(query, flags)
    const nameMatch = nameRegex?.test(name) ?? false
    let content = ''
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_SEARCH_FILE_BYTES || searchedBytes + stat.size > MAX_SEARCH_TOTAL_BYTES) {
        continue
      }
      searchedBytes += stat.size
      content = await readUtf8(file)
    } catch {
      // Skip unreadable files.
    }
    const matches: SearchMatch[] = []
    const contentRegex = compileSearchRegex(query, flags)
    let globalIndex = 0
    let execResult: RegExpExecArray | null
    while (
      contentRegex &&
      matches.length < MAX_MATCHES_PER_FILE &&
      (execResult = contentRegex.exec(content)) !== null
    ) {
      const index = execResult.index
      const lineStart = content.lastIndexOf('\n', index) + 1
      let lineEnd = content.indexOf('\n', index)
      if (lineEnd === -1) lineEnd = content.length
      const lineText = content.slice(lineStart, lineEnd).trim().slice(0, 120)
      const line = content.slice(0, index).split('\n').length
      matches.push({ line, text: lineText, globalIndex })
      globalIndex += 1
      // Guard against zero-length matches (e.g. `x*`) looping forever.
      if (execResult[0].length === 0) contentRegex.lastIndex += 1
    }
    if (nameMatch || matches.length > 0) {
      results.push({ path: file, name, nameMatch, totalMatches: globalIndex, matches })
      if (results.length >= MAX_SEARCH_FILES) break
    }
  }
  return results
}

async function listMarkdownRecursive(
  dir: string,
  depth: number,
  budget: { count: number } = { count: 0 }
): Promise<FileEntry[]> {
  if (depth > 24 || budget.count >= MAX_TREE_ENTRIES) return []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const result: FileEntry[] = []
  for (const entry of entries) {
    if (budget.count >= MAX_TREE_ENTRIES) break
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const children = await listMarkdownRecursive(fullPath, depth + 1, budget)
      // Only include directories that (transitively) contain markdown files.
      if (children.length > 0) {
        budget.count += 1
        result.push({ name: entry.name, path: fullPath, type: 'directory', children })
      }
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      budget.count += 1
      result.push({ name: entry.name, path: fullPath, type: 'file' })
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return result
}

function exportFileName(path: string | null, fallback: string, ext: string): string {
  if (path) {
    const base = basename(path, extname(path))
    return `${base}${ext}`
  }
  return `${fallback}${ext}`
}

/**
 * Serve local images through a constrained web-like origin. Unlike file://,
 * every request is checked against the filesystem capabilities granted by an
 * opened document, folder, picker, or drop operation.
 */
export function registerLocalProtocols(): void {
  protocol.handle('inkmark-asset', async (request) => {
    try {
      const path = assertPathAccess(assetUrlToPath(request.url))
      const ext = extname(path).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(ext)) return new Response('Unsupported image type', { status: 415 })
      const stat = await fs.stat(path)
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) {
        return new Response('Image unavailable', { status: 404 })
      }
      return net.fetch(pathToFileURL(path).href)
    } catch {
      return new Response('Image unavailable', { status: 404 })
    }
  })

  protocol.handle('inkmark-export', (request) => {
    const url = new URL(request.url)
    const id = url.hostname === 'document' ? url.pathname.slice(1) : ''
    const html = id ? pendingExportDocuments.get(id) : undefined
    if (!html) return new Response('Export document unavailable', { status: 404 })
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src data: inkmark-asset:"
      }
    })
  })
}

async function loadExportDocument(window: BrowserWindow, html: string): Promise<void> {
  const id = randomUUID()
  pendingExportDocuments.set(id, html)
  try {
    await window.loadURL(`inkmark-export://document/${id}`)
  } finally {
    pendingExportDocuments.delete(id)
  }
}

async function embedLocalImages(
  html: string,
  documentPath: string | null
): Promise<{ html: string; warnings: string[] }> {
  const sourcePattern = /(\bsrc=")([^"]+)(")/g
  const matches = Array.from(html.matchAll(sourcePattern))
  const replacements = new Map<string, string>()
  let totalBytes = 0
  const warnings = new Set<string>()

  for (const match of matches) {
    const encodedSrc = match[2]
    if (replacements.has(encodedSrc)) continue
    const src = decodeHtmlAttribute(encodedSrc)
    if (/^(?:data:|https?:|blob:)/i.test(src)) continue
    if (!documentPath && !/^(?:file:|inkmark-asset:|[A-Za-z]:[\\/]|\/)/i.test(src)) continue
    try {
      const path = documentPath
        ? localImagePath(src, documentPath)
        : src.startsWith('inkmark-asset:')
          ? assetUrlToPath(src)
          : src.startsWith('file:')
            ? fileURLToPath(src)
            : canonicalPath(src)
      if (!path) {
        warnings.add(src)
        continue
      }
      const authorized = assertPathAccess(path)
      const ext = extname(authorized).toLowerCase()
      const mime = IMAGE_MIME_TYPES[ext]
      if (!mime) {
        warnings.add(src)
        continue
      }
      const handle = await fs.open(authorized, 'r')
      let data: Buffer
      try {
        data = (await readHandleSnapshot(handle, MAX_IMAGE_BYTES)).data
      } finally {
        await handle.close()
      }
      if (totalBytes + data.byteLength > MAX_EXPORT_IMAGE_BYTES) {
        warnings.add(src)
        continue
      }
      totalBytes += data.byteLength
      replacements.set(encodedSrc, `data:${mime};base64,${data.toString('base64')}`)
    } catch {
      warnings.add(src)
    }
  }

  return {
    html: html.replace(sourcePattern, (whole, prefix: string, src: string, suffix: string) => {
      const embedded = replacements.get(src)
      return embedded ? `${prefix}${embedded}${suffix}` : whole
    }),
    warnings: Array.from(warnings)
  }
}

/** Resolve local image references to the constrained protocol for PDF/Print. */
async function routeLocalImages(
  html: string,
  documentPath: string | null
): Promise<{ html: string; warnings: string[] }> {
  const sourcePattern = /(\bsrc=")([^"]+)(")/g
  const replacements = new Map<string, string>()
  const warnings = new Set<string>()

  for (const match of html.matchAll(sourcePattern)) {
    const encodedSrc = match[2]
    if (replacements.has(encodedSrc)) continue
    const src = decodeHtmlAttribute(encodedSrc)
    if (/^(?:data:|https?:|blob:)/i.test(src)) continue
    if (!documentPath && !/^(?:file:|inkmark-asset:|[A-Za-z]:[\\/]|\/)/i.test(src)) continue
    try {
      const path = documentPath
        ? localImagePath(src, documentPath)
        : src.startsWith('inkmark-asset:')
          ? assetUrlToPath(src)
          : src.startsWith('file:')
            ? fileURLToPath(src)
            : canonicalPath(src)
      if (!path) {
        warnings.add(src)
        continue
      }
      const authorized = assertPathAccess(path)
      if (!IMAGE_EXTENSIONS.has(extname(authorized).toLowerCase())) {
        warnings.add(src)
        continue
      }
      const stat = await fs.stat(authorized)
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) {
        warnings.add(src)
        continue
      }
      replacements.set(encodedSrc, pathToAssetUrl(authorized))
    } catch {
      warnings.add(src)
    }
  }

  return {
    html: html.replace(sourcePattern, (whole, prefix: string, src: string, suffix: string) => {
      const routed = replacements.get(src)
      return routed ? `${prefix}${routed}${suffix}` : whole
    }),
    warnings: Array.from(warnings)
  }
}

async function showExportWarnings(win: BrowserWindow | null, warnings: string[]): Promise<void> {
  if (warnings.length === 0) return
  const visible = warnings.slice(0, 10).map((value) => `• ${value.slice(0, 240)}`).join('\n')
  const remaining = warnings.length > 10 ? `\n… +${warnings.length - 10}` : ''
  const options = {
    type: 'warning' as const,
    buttons: [t('dialog.ok')],
    defaultId: 0,
    message: t('dialog.exportWarningsTitle'),
    detail: `${t('dialog.exportWarningsDetail').replace('{count}', String(warnings.length))}\n${visible}${remaining}`
  }
  if (win) await dialog.showMessageBox(win, options)
  else await dialog.showMessageBox(options)
}

function sanitizeFileName(name: string): string {
  const base = basename(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return base || 'image.png'
}

async function writeUniqueFile(dir: string, name: string, data: Uint8Array): Promise<string> {
  const ext = extname(name)
  const stem = basename(name, ext) || 'image'
  let candidate = name
  let counter = 1
  while (true) {
    try {
      await fs.writeFile(join(dir, candidate), data, { flag: 'wx', flush: true })
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      candidate = `${stem}-${counter}${ext}`
      counter += 1
    }
  }
}

async function saveImage(payload: SaveImagePayload): Promise<SaveImageResult | null> {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Invalid image payload')
  }
  const hasData = payload.data instanceof ArrayBuffer
  const hasSource = typeof payload.sourcePath === 'string' && payload.sourcePath.length > 0
  if (hasData === hasSource) throw new TypeError('Provide exactly one image source')
  if (!payload.docPath) throw new Error('Save the document before inserting images')

  const documentPath = assertPathAccess(payload.docPath)
  const docDir = dirname(documentPath)
  let name: string
  let buffer: Buffer
  if (hasSource) {
    const sourcePath = assertPathAccess(payload.sourcePath as string)
    try {
      name = sanitizeFileName(basename(sourcePath))
      if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) throw new Error('Unsupported image type')
      const sourceStat = await fs.stat(sourcePath)
      if (!sourceStat.isFile()) throw new Error('Image source is not a regular file')
      if (sourceStat.size > MAX_IMAGE_BYTES) throw new Error('Image is too large')
      const existingRelative = relative(docDir, sourcePath)
      if (existingRelative && !existingRelative.startsWith('..') && !isAbsolute(existingRelative)) {
        const grants = documentImageGrants.get(documentPath) ?? new Set<string>()
        grants.add(sourcePath)
        documentImageGrants.set(documentPath, grants)
        return { src: existingRelative.split(sep).join('/') }
      }
      const handle = await fs.open(sourcePath, 'r')
      try {
        buffer = (await readHandleSnapshot(handle, MAX_IMAGE_BYTES)).data
      } finally {
        await handle.close()
      }
    } finally {
      // Picker/drop grants are single-use. Relative images keep a narrower,
      // document-scoped grant; copied images need no source grant afterward.
      grantedFiles.delete(sourcePath)
    }
  } else {
    if (typeof payload.name !== 'string') throw new TypeError('Invalid clipboard image name')
    name = sanitizeFileName(payload.name)
    if ((payload.data as ArrayBuffer).byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large')
    buffer = Buffer.from(payload.data as ArrayBuffer)
  }
  if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new Error('Unsupported image type')
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('Image is too large')

  // Save next to the document (Typora-like): <doc dir>/assets/<name>.
  const configuredTargetDir = join(docDir, 'assets')
  await fs.mkdir(configuredTargetDir, { recursive: true })
  // Re-resolve after mkdir so a replaced/symlinked assets directory cannot
  // redirect the write outside the document's granted asset capability.
  const targetDir = assertPathAccess(configuredTargetDir)
  const targetName = await writeUniqueFile(targetDir, name, buffer)
  return { src: `assets/${targetName.replace(/\\/g, '/')}` }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  let recoveryQueue: Promise<void> = Promise.resolve()
  let watchedFile: FSWatcher | null = null
  let watchedPath: string | null = null
  let watchTimer: NodeJS.Timeout | null = null
  const queueRecovery = (task: () => Promise<void>): Promise<void> => {
    const run = recoveryQueue.then(task, task)
    recoveryQueue = run.catch(() => undefined)
    return run
  }

  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    const win = getWindow()
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    ) {
      throw new Error('Rejected IPC request from an untrusted renderer')
    }
  }

  const handle = <Args extends unknown[], Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
  ): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertTrustedSender(event)
      return listener(event, ...(args as Args))
    })
  }

  handle(IPC.openFileDialog, async (): Promise<FileResult> => {
    const win = getWindow()
    const options = {
      title: t('dialog.openFile'),
      filters: [
        { name: t('filter.markdown'), extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdwn', 'txt'] },
        { name: t('filter.allFiles'), extensions: ['*'] }
      ],
      properties: ['openFile'] as Array<'openFile'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = result.filePaths[0]
    grantDocumentAccess(path)
    try {
      const { content, version } = await readDocument(path)
      return { path, content, version, canceled: false }
    } catch (error) {
      releaseDocumentAccess(path)
      throw error
    }
  })

  handle(
    IPC.saveFileDialog,
    async (
      _event,
      defaultPath: string | null,
      content: string,
      expectedVersion?: FileVersion | null
    ): Promise<SaveResult> => {
      const win = getWindow()
      content = assertTextPayload(content, 'document')
      const options = {
        title: t('dialog.saveFile'),
        defaultPath: defaultPath ?? 'untitled.md',
        filters: [
          { name: t('filter.markdown'), extensions: ['md', 'markdown', 'txt'] },
          { name: t('filter.allFiles'), extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { canceled: true }
      const path = result.filePath
      const selectedCurrentPath = defaultPath != null && canonicalPath(defaultPath) === canonicalPath(path)
      // For a different target, the native dialog has already asked for
      // overwrite consent; snapshot its state now to catch changes occurring
      // after that confirmation and before the final rename.
      const baseline = selectedCurrentPath ? expectedVersion : await currentVersion(path)
      try {
        const version = await atomicWriteFile(
          path,
          encodeDocument(content, expectedVersion?.utf8Bom === true),
          undefined,
          baseline,
          true
        )
        grantDocumentAccess(path)
        grantReferencedImages(path, content)
        return { path, version, canceled: false, conflict: false }
      } catch (error) {
        if (error instanceof FileConflictError) return { path, canceled: false, conflict: true }
        throw error
      }
    }
  )

  handle(IPC.authorizeDroppedPath, async (_event, path: string): Promise<DroppedPathResult> => {
    const canonical = canonicalPath(path)
    const stat = await fs.stat(canonical)
    if (stat.isDirectory()) grantDirectoryAccess(canonical)
    else if (isMarkdown(basename(canonical))) grantDocumentAccess(canonical)
    else grantFileAccess(canonical)
    return {
      path: canonical,
      isDirectory: stat.isDirectory()
    }
  })

  handle(IPC.documentBaseUrl, async (_event, path: string): Promise<string> => {
    const documentPath = assertPathAccess(path)
    return pathToAssetUrl(dirname(documentPath) + sep)
  })

  handle(IPC.readFile, async (_event, path: string): Promise<ReadFileResult> => {
    const authorized = assertPathAccess(path)
    grantDocumentAccess(authorized)
    return readDocument(authorized)
  })

  handle(IPC.writeFile, async (
    _event,
    path: string,
    content: string,
    expectedVersion?: FileVersion | null
  ): Promise<WriteFileResult> => {
    path = assertPathAccess(path)
    content = assertTextPayload(content, 'document')
    if (expectedVersion) {
      const current = await readDocument(path).then((result) => result.version).catch(() => null)
      if (
        !current ||
        current.mtimeMs !== expectedVersion.mtimeMs ||
        current.size !== expectedVersion.size ||
        current.sha256 !== expectedVersion.sha256
      ) {
        return { conflict: true }
      }
    }
    try {
      const version = await atomicWriteFile(
        path,
        encodeDocument(content, expectedVersion?.utf8Bom === true),
        undefined,
        expectedVersion,
        true
      )
      grantReferencedImages(path, content)
      return {
        conflict: false,
        version
      }
    } catch (error) {
      if (error instanceof FileConflictError) return { conflict: true }
      throw error
    }
  })

  handle(IPC.watchFile, async (_event, path: string | null): Promise<void> => {
    watchedFile?.close()
    watchedFile = null
    watchedPath = null
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = null
    if (!path) return
    const canonical = assertPathAccess(path)
    watchedPath = canonical
    watchedFile = watch(dirname(canonical), { persistent: false }, (_eventType, fileName) => {
      if (fileName && String(fileName) !== basename(canonical)) return
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(() => {
        const win = getWindow()
        if (win && watchedPath) win.webContents.send(IPC.fileChanged, watchedPath)
      }, 250)
    })
    watchedFile.on('error', () => {
      watchedFile?.close()
      watchedFile = null
    })
  })

  handle(IPC.openFolderDialog, async () => {
    const win = getWindow()
    const options = {
      title: t('dialog.openFolder'),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    grantDirectoryAccess(result.filePaths[0])
    return { path: result.filePaths[0], canceled: false }
  })

  handle(IPC.releaseDocumentAccess, async (_event, path: string): Promise<void> => {
    releaseDocumentAccess(path)
  })

  handle(IPC.releaseDirectoryAccess, async (_event, path: string): Promise<void> => {
    releaseDirectoryAccess(path)
  })

  handle(IPC.listMarkdown, async (_event, folderPath: string): Promise<FileEntry[]> =>
    listMarkdownRecursive(assertPathAccess(folderPath), 0)
  )

  handle(IPC.exportHtml, async (
    _event,
    defaultName: string,
    html: string,
    documentPath: string | null
  ): Promise<SaveResult> => {
    html = assertTextPayload(html, 'HTML export')
    if (documentPath) documentPath = assertPathAccess(documentPath)
    const embedded = await embedLocalImages(html, documentPath)
    html = embedded.html
    const win = getWindow()
    const options = {
      title: t('dialog.exportHtml'),
      defaultPath: exportFileName(defaultName, 'document', '.html'),
      filters: [{ name: t('filter.html'), extensions: ['html'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }
    const version = await atomicWriteFile(result.filePath, html)
    await showExportWarnings(win, embedded.warnings)
    return { path: result.filePath, version, canceled: false }
  })

  handle(IPC.exportPdf, async (
    _event,
    defaultName: string,
    html: string,
    documentPath: string | null
  ): Promise<SaveResult> => {
    html = assertTextPayload(html, 'PDF export')
    if (documentPath) documentPath = assertPathAccess(documentPath)
    const routed = await routeLocalImages(html, documentPath)
    html = routed.html
    const win = getWindow()
    const options = {
      title: t('dialog.exportPdf'),
      defaultPath: exportFileName(defaultName, 'document', '.pdf'),
      filters: [{ name: t('filter.pdf'), extensions: ['pdf'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true }

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, offscreen: true, javascript: false }
    })
    try {
      await loadExportDocument(pdfWindow, html)
      const data = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      })
      const version = await atomicWriteFile(result.filePath, data)
      await showExportWarnings(win, routed.warnings)
      return { path: result.filePath, version, canceled: false }
    } finally {
      pdfWindow.destroy()
    }
  })

  handle(IPC.exportPrint, async (
    _event,
    html: string,
    documentPath: string | null
  ): Promise<void> => {
    html = assertTextPayload(html, 'print document')
    if (documentPath) documentPath = assertPathAccess(documentPath)
    const routed = await routeLocalImages(html, documentPath)
    html = routed.html
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: false }
    })
    try {
      await loadExportDocument(printWindow, html)
      await new Promise<void>((resolvePrint, rejectPrint) => {
        printWindow.webContents.print(
          { printBackground: true, silent: false },
          (success: boolean, failureReason: string) => {
            if (success) resolvePrint()
            else rejectPrint(new Error(failureReason || 'Print failed'))
          }
        )
      })
      await showExportWarnings(getWindow(), routed.warnings)
    } finally {
      printWindow.destroy()
    }
  })

  handle(IPC.saveImage, async (_event, payload: SaveImagePayload): Promise<SaveImageResult | null> =>
    saveImage(payload)
  )

  handle(IPC.pickImage, async () => {
    const win = getWindow()
    const options = {
      title: t('dialog.pickImage'),
      filters: [
        {
          name: t('filter.images'),
          extensions: Array.from(IMAGE_EXTENSIONS).map((ext) => ext.slice(1))
        }
      ],
      properties: ['openFile'] as Array<'openFile'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const path = canonicalPath(result.filePaths[0])
    grantFileAccess(path)
    return { path, canceled: false }
  })

  handle(
    IPC.searchFiles,
    async (_event, folderPath: string, query: string, flags: SearchFlags = {}): Promise<FileSearchResult[]> => {
      if (typeof query !== 'string' || !flags || typeof flags !== 'object') {
        throw new TypeError('Invalid search request')
      }
      return searchFiles(assertPathAccess(folderPath), query, flags)
    }
  )

  handle(
    IPC.findRegexMatches,
    async (
      _event,
      segments: RegexTextSegment[],
      query: string,
      flags: SearchFlags = {}
    ): Promise<TextRange[]> => {
      if (typeof query !== 'string' || !flags || typeof flags !== 'object') {
        throw new TypeError('Invalid search request')
      }
      return findRegexMatches(segments, query, flags)
    }
  )

  handle(IPC.confirmSave, async (_event, fileName: string) => {
    const win = getWindow()
    const options = {
      type: 'warning' as const,
      buttons: [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')],
      defaultId: 0,
      cancelId: 2,
      message: t('dialog.unsavedTitle'),
      detail: t('dialog.unsavedDetail').replace('{name}', fileName || 'Untitled')
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return (['save', 'discard', 'cancel'] as const)[result.response]
  })

  handle(IPC.confirmExternalChange, async (_event, fileName: string, dirty: boolean) => {
    const win = getWindow()
    const options = {
      type: 'warning' as const,
      buttons: [t('dialog.reload'), t('menu.saveAs'), t('dialog.keepEditing')],
      defaultId: dirty ? 2 : 0,
      cancelId: 2,
      message: t('dialog.externalChangedTitle'),
      detail: t('dialog.externalChangedDetail').replace('{name}', fileName)
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return (['reload', 'saveAs', 'keep'] as const)[result.response]
  })

  handle(IPC.showError, async (_event, message: string, detail?: string): Promise<void> => {
    const win = getWindow()
    const options = {
      type: 'error' as const,
      buttons: [t('dialog.ok')],
      defaultId: 0,
      message: message || t('dialog.errorTitle'),
      detail: detail?.slice(0, 2000)
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  })

  handle(IPC.copyText, async (_event, text: string): Promise<void> => {
    clipboard.writeText(text)
  })

  handle(IPC.readClipboardText, async (): Promise<string> => {
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  })

  handle(IPC.loadRecoveryDraft, async (): Promise<RecoveryDraft | null> => {
    await recoveryQueue
    try {
      const handle = await fs.open(recoveryPath(), 'r')
      let data: Buffer
      try {
        data = (await readHandleSnapshot(handle, MAX_RECOVERY_FILE_BYTES)).data
      } finally {
        await handle.close()
      }
      const parsed = JSON.parse(decodeUtf8Document(data).content) as unknown
      if (!isRecoveryDraft(parsed)) return null
      if (parsed.filePath) grantDocumentAccess(parsed.filePath)
      return parsed
    } catch {
      return null
    }
  })

  handle(IPC.saveRecoveryDraft, async (_event, draft: RecoveryDraft): Promise<void> => {
    if (!isRecoveryDraft(draft)) throw new TypeError('Invalid recovery draft')
    const canonicalFilePath = draft.filePath ? assertPathAccess(draft.filePath) : null
    const serialized = JSON.stringify({ ...draft, filePath: canonicalFilePath })
    if (Buffer.byteLength(serialized) > MAX_RECOVERY_FILE_BYTES) {
      throw new Error('Recovery draft is too large')
    }
    await queueRecovery(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await atomicWriteFile(recoveryPath(), serialized, 0o600)
      await fs.chmod(recoveryPath(), 0o600).catch(() => undefined)
    })
  })

  handle(IPC.clearRecoveryDraft, async (): Promise<void> => {
    await queueRecovery(async () => {
      await fs.unlink(recoveryPath()).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    })
  })

  handle(IPC.confirmRecovery, async (_event, fileName: string, updatedAt: number) => {
    const win = getWindow()
    const when = new Date(updatedAt).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en-US')
    const options = {
      type: 'question' as const,
      buttons: [t('dialog.restore'), t('dialog.discardDraft')],
      defaultId: 0,
      cancelId: 0,
      message: t('dialog.recoveryTitle'),
      detail: t('dialog.recoveryDetail')
        .replace('{name}', fileName)
        .replace('{time}', when)
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return (['restore', 'discard'] as const)[result.response]
  })

  handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    if (isAllowedExternalUrl(url)) {
      await shell.openExternal(url)
    }
  })

  handle(IPC.openLocalPath, async (_event, path: string): Promise<string> =>
    shell.openPath(assertPathAccess(path))
  )

  handle(IPC.pathExists, async (_event, path: string): Promise<boolean> => {
    try {
      return existsSync(assertPathAccess(path))
    } catch {
      return false
    }
  })

  handle(IPC.pathIsDirectory, async (_event, path: string): Promise<boolean> => {
    try {
      return statSync(assertPathAccess(path)).isDirectory()
    } catch {
      return false
    }
  })

  handle(IPC.getZoom, async (): Promise<number> => {
    return getWindow()?.webContents.getZoomLevel() ?? 0
  })

  handle(IPC.setZoom, async (_event, level: number): Promise<void> => {
    const clamped = Math.min(3, Math.max(-3, level))
    getWindow()?.webContents.setZoomLevel(clamped)
  })

  handle(IPC.showAbout, async (): Promise<void> => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      buttons: [t('dialog.openRepo'), t('dialog.ok')],
      defaultId: 1,
      cancelId: 1,
      message: t('dialog.aboutMessage'),
      detail: t('dialog.aboutDetail').replace('{version}', app.getVersion())
    }
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (result.response === 0) {
      await shell.openExternal(REPOSITORY_URL)
    }
  })

  handle(IPC.setReadOnly, async (_event, value: boolean): Promise<void> => {
    setReadOnlyMode(value)
  })

  handle(IPC.getLocale, () => getLocale())

  handle(IPC.setLocale, (_event, lang: 'en' | 'zh') => {
    setLocale(lang)
  })
}
