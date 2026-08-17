import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
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
  type SaveImagePayload,
  type SaveImageResult,
  type SaveResult,
  type SearchMatch,
  type SearchFlags,
  type WriteFileResult
} from '../shared/ipc'
import { getLocale, setLocale, t } from './i18n'
import { setReadOnlyMode } from './menu'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])

const MAX_SEARCH_FILES = 300
const MAX_MATCHES_PER_FILE = 60
const RECOVERY_FILE = 'recovery-draft.json'

const isMarkdown = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extname(name).toLowerCase())

function isAllowedExternalUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

async function readUtf8(path: string): Promise<string> {
  return fs.readFile(path, 'utf8')
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function toFileVersion(stat: { mtimeMs: number; size: number }, hash: string): FileVersion {
  return { mtimeMs: stat.mtimeMs, size: stat.size, sha256: hash }
}

async function readDocument(path: string): Promise<ReadFileResult> {
  const handle = await fs.open(path, 'r')
  try {
    const data = await handle.readFile()
    const version = toFileVersion(await handle.stat(), sha256(data))
    return { content: data.toString('utf8'), version }
  } finally {
    await handle.close()
  }
}

/**
 * Durably replace a file without truncating the previous version first.
 * The temporary file lives beside the target so the final rename stays on
 * the same filesystem and is atomic on supported local filesystems.
 */
async function atomicWriteFile(
  path: string,
  data: string | Uint8Array,
  createMode?: number
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
    return toFileVersion(await fs.stat(targetPath), sha256(data))
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
      typeof version.sha256 === 'string')
  return (
    (typeof draft.filePath === 'string' || draft.filePath === null) &&
    typeof draft.content === 'string' &&
    typeof draft.cleanContent === 'string' &&
    validVersion &&
    typeof draft.sourceMode === 'boolean' &&
    typeof draft.updatedAt === 'number'
  )
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

  const results: FileSearchResult[] = []
  for (const file of files) {
    const name = basename(file)
    const nameRegex = compileSearchRegex(query, flags)
    const nameMatch = nameRegex?.test(name) ?? false
    let content = ''
    try {
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

async function listMarkdownRecursive(dir: string, depth: number): Promise<FileEntry[]> {
  if (depth > 24) return []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const children = await listMarkdownRecursive(fullPath, depth + 1)
      // Only include directories that (transitively) contain markdown files.
      if (children.length > 0) {
        result.push({ name: entry.name, path: fullPath, type: 'directory', children })
      }
    } else if (entry.isFile() && isMarkdown(entry.name)) {
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

function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return `file://${normalized}`
  return `file:///${normalized}`
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
  const name = sanitizeFileName(payload.name)
  const buffer = payload.sourcePath
    ? await fs.readFile(payload.sourcePath)
    : payload.data
      ? Buffer.from(payload.data)
      : null
  if (!buffer) return null

  if (payload.docPath) {
    // Save next to the document (Typora-like): <doc dir>/assets/<name>.
    const docDir = dirname(payload.docPath)
    const targetDir = join(docDir, 'assets')
    await fs.mkdir(targetDir, { recursive: true })
    const targetName = await writeUniqueFile(targetDir, name, buffer)
    return { src: `assets/${targetName.replace(/\\/g, '/')}` }
  }

  // No document yet: store under the app data directory and use an absolute URL.
  const targetDir = join(app.getPath('userData'), 'images')
  await fs.mkdir(targetDir, { recursive: true })
  const targetName = await writeUniqueFile(targetDir, name, buffer)
  return { src: toFileUrl(join(targetDir, targetName)) }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  let recoveryQueue: Promise<void> = Promise.resolve()
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
    const { content, version } = await readDocument(path)
    return { path, content, version, canceled: false }
  })

  handle(
    IPC.saveFileDialog,
    async (_event, defaultPath: string | null, content: string): Promise<SaveResult> => {
      const win = getWindow()
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
      const version = await atomicWriteFile(result.filePath, content)
      return { path: result.filePath, version, canceled: false }
    }
  )

  handle(IPC.readFile, async (_event, path: string): Promise<ReadFileResult> => readDocument(path))

  handle(IPC.writeFile, async (
    _event,
    path: string,
    content: string,
    expectedVersion?: FileVersion | null
  ): Promise<WriteFileResult> => {
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
    return { conflict: false, version: await atomicWriteFile(path, content) }
  })

  handle(IPC.openFolderDialog, async () => {
    const win = getWindow()
    const options = {
      title: t('dialog.openFolder'),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { path: result.filePaths[0], canceled: false }
  })

  handle(IPC.listMarkdown, async (_event, folderPath: string): Promise<FileEntry[]> =>
    listMarkdownRecursive(folderPath, 0)
  )

  handle(IPC.exportHtml, async (_event, defaultName: string, html: string): Promise<SaveResult> => {
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
    return { path: result.filePath, version, canceled: false }
  })

  handle(IPC.exportPdf, async (_event, defaultName: string, html: string): Promise<SaveResult> => {
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
      webPreferences: { sandbox: true, offscreen: true }
    })
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const data = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      })
      const version = await atomicWriteFile(result.filePath, data)
      return { path: result.filePath, version, canceled: false }
    } finally {
      pdfWindow.destroy()
    }
  })

  handle(IPC.exportPrint, async (_event, html: string): Promise<void> => {
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true }
    })
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    printWindow.webContents.print(
      { printBackground: true, silent: false },
      (_success: boolean, failureReason: string) => {
        if (failureReason) console.error('Print failed:', failureReason)
        printWindow.destroy()
      }
    )
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
    return { path: result.filePaths[0], canceled: false }
  })

  handle(
    IPC.searchFiles,
    async (_event, folderPath: string, query: string, flags: SearchFlags = {}): Promise<FileSearchResult[]> =>
      searchFiles(folderPath, query, flags)
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
      const parsed = JSON.parse(await fs.readFile(recoveryPath(), 'utf8')) as unknown
      return isRecoveryDraft(parsed) ? parsed : null
    } catch {
      return null
    }
  })

  handle(IPC.saveRecoveryDraft, async (_event, draft: RecoveryDraft): Promise<void> => {
    if (!isRecoveryDraft(draft)) throw new TypeError('Invalid recovery draft')
    await queueRecovery(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await atomicWriteFile(recoveryPath(), JSON.stringify(draft), 0o600)
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

  handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    if (isAllowedExternalUrl(url)) {
      await shell.openExternal(url)
    }
  })

  handle(IPC.openLocalPath, async (_event, path: string): Promise<string> =>
    shell.openPath(path)
  )

  handle(IPC.pathExists, async (_event, path: string): Promise<boolean> => existsSync(path))

  handle(IPC.pathIsDirectory, async (_event, path: string): Promise<boolean> => {
    try {
      return statSync(path).isDirectory()
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
