import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import {
  IPC,
  REPOSITORY_URL,
  compileSearchRegex,
  type FileEntry,
  type FileResult,
  type FileSearchResult,
  type SaveImagePayload,
  type SaveImageResult,
  type SaveResult,
  type SearchMatch,
  type SearchFlags
} from '../shared/ipc'
import { getLocale, setLocale, t } from './i18n'
import { setReadOnlyMode } from './menu'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'])

const MAX_SEARCH_FILES = 300
const MAX_MATCHES_PER_FILE = 60

const isMarkdown = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extname(name).toLowerCase())

async function readUtf8(path: string): Promise<string> {
  return fs.readFile(path, 'utf8')
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

async function uniqueFileName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = basename(name, ext) || 'image'
  let candidate = name
  let counter = 1
  while (true) {
    try {
      await fs.access(join(dir, candidate))
      candidate = `${stem}-${counter}${ext}`
      counter += 1
    } catch {
      return candidate
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
    const targetName = await uniqueFileName(targetDir, name)
    await fs.writeFile(join(targetDir, targetName), buffer)
    return { src: `assets/${targetName.replace(/\\/g, '/')}` }
  }

  // No document yet: store under the app data directory and use an absolute URL.
  const targetDir = join(app.getPath('userData'), 'images')
  await fs.mkdir(targetDir, { recursive: true })
  const targetName = await uniqueFileName(targetDir, name)
  await fs.writeFile(join(targetDir, targetName), buffer)
  return { src: toFileUrl(join(targetDir, targetName)) }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.openFileDialog, async (): Promise<FileResult> => {
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
    const content = await readUtf8(path)
    return { path, content, canceled: false }
  })

  ipcMain.handle(
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
      await fs.writeFile(result.filePath, content, 'utf8')
      return { path: result.filePath, canceled: false }
    }
  )

  ipcMain.handle(IPC.readFile, async (_event, path: string): Promise<string> => readUtf8(path))

  ipcMain.handle(IPC.writeFile, async (_event, path: string, content: string): Promise<void> => {
    await fs.writeFile(path, content, 'utf8')
  })

  ipcMain.handle(IPC.openFolderDialog, async () => {
    const win = getWindow()
    const options = {
      title: t('dialog.openFolder'),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    return { path: result.filePaths[0], canceled: false }
  })

  ipcMain.handle(IPC.listMarkdown, async (_event, folderPath: string): Promise<FileEntry[]> =>
    listMarkdownRecursive(folderPath, 0)
  )

  ipcMain.handle(IPC.exportHtml, async (_event, defaultName: string, html: string): Promise<SaveResult> => {
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
    await fs.writeFile(result.filePath, html, 'utf8')
    return { path: result.filePath, canceled: false }
  })

  ipcMain.handle(IPC.exportPdf, async (_event, defaultName: string, html: string): Promise<SaveResult> => {
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
      await fs.writeFile(result.filePath, data)
      return { path: result.filePath, canceled: false }
    } finally {
      pdfWindow.destroy()
    }
  })

  ipcMain.handle(IPC.exportPrint, async (_event, html: string): Promise<void> => {
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

  ipcMain.handle(IPC.saveImage, async (_event, payload: SaveImagePayload): Promise<SaveImageResult | null> =>
    saveImage(payload)
  )

  ipcMain.handle(IPC.pickImage, async () => {
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

  ipcMain.handle(
    IPC.searchFiles,
    async (_event, folderPath: string, query: string, flags: SearchFlags = {}): Promise<FileSearchResult[]> =>
      searchFiles(folderPath, query, flags)
  )

  ipcMain.handle(IPC.confirmSave, async (_event, fileName: string) => {
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

  ipcMain.handle(IPC.openExternal, async (_event, url: string): Promise<void> => {
    if (/^(https?:|mailto:)/i.test(url)) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC.openLocalPath, async (_event, path: string): Promise<string> =>
    shell.openPath(path)
  )

  ipcMain.handle(IPC.pathExists, async (_event, path: string): Promise<boolean> => existsSync(path))

  ipcMain.handle(IPC.pathIsDirectory, async (_event, path: string): Promise<boolean> => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle(IPC.getZoom, async (): Promise<number> => {
    return getWindow()?.webContents.getZoomLevel() ?? 0
  })

  ipcMain.handle(IPC.setZoom, async (_event, level: number): Promise<void> => {
    const clamped = Math.min(3, Math.max(-3, level))
    getWindow()?.webContents.setZoomLevel(clamped)
  })

  ipcMain.handle(IPC.showAbout, async (): Promise<void> => {
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

  ipcMain.handle(IPC.setReadOnly, async (_event, value: boolean): Promise<void> => {
    setReadOnlyMode(value)
  })

  ipcMain.handle(IPC.getLocale, () => getLocale())

  ipcMain.handle(IPC.setLocale, (_event, lang: 'en' | 'zh') => {
    setLocale(lang)
  })
}
