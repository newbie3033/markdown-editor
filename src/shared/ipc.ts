// Shared IPC contract between the Electron main process, preload script and
// the renderer. Types are erased at build time; only the string constants and
// shapes are shared.

export type Lang = 'en' | 'zh'

export interface FileResult {
  path?: string
  content?: string
  canceled: boolean
}

export interface SaveResult {
  path?: string
  canceled: boolean
}

export interface FolderResult {
  path?: string
  canceled: boolean
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntry[]
}

export interface SaveImagePayload {
  /** Absolute path of the source file (drag-drop from the OS), if available. */
  sourcePath?: string | null
  /** Raw bytes of the image (clipboard paste), if there is no source path. */
  data?: ArrayBuffer | null
  /** Original file name, used as the saved file name. */
  name: string
  /** Path of the current document, used to resolve the assets directory. */
  docPath: string | null
}

export interface SaveImageResult {
  /** src to insert into the editor (relative to the doc, or absolute). */
  src: string
}

export interface PickImageResult {
  path?: string
  canceled: boolean
}

export interface SearchMatch {
  /** 1-based line number. */
  line: number
  /** Trimmed, truncated line text around the match. */
  text: string
  /** Index of this match within the file (0-based, in document order). */
  globalIndex: number
}

export interface FileSearchResult {
  path: string
  name: string
  nameMatch: boolean
  totalMatches: number
  matches: SearchMatch[]
}

export type SearchMode = 'text' | 'wildcard' | 'regex'

/**
 * Compile a search query into a case-insensitive RegExp.
 * - text: literal text (regex special characters escaped)
 * - wildcard: `*` matches any characters, `?` matches a single character
 * - regex: raw JavaScript regular expression (`g` + `i` + `m` flags)
 * Returns null for empty queries or invalid regexes.
 */
export function compileSearchRegex(query: string, mode: SearchMode): RegExp | null {
  const q = query.trim()
  if (!q) return null
  try {
    if (mode === 'regex') {
      return new RegExp(q, 'gim')
    }
    if (mode === 'wildcard') {
      const escaped = q
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      return new RegExp(escaped, 'gi')
    }
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  } catch {
    return null
  }
}

export type MenuAction =
  | 'new'
  | 'welcome'
  | 'open'
  | 'open-folder'
  | 'close-folder'
  | 'save'
  | 'save-as'
  | 'export-html'
  | 'export-pdf'
  | 'print'
  | 'find'
  | 'search-folder'
  | 'toggle-source'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'theme-light'
  | 'theme-dark'
  | 'lang-en'
  | 'lang-zh'
  | 'mode-edit'
  | 'mode-readonly'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'about'

export const IPC = {
  openFileDialog: 'file:open-dialog',
  saveFileDialog: 'file:save-dialog',
  readFile: 'file:read',
  writeFile: 'file:write',
  openFolderDialog: 'folder:open-dialog',
  listMarkdown: 'folder:list-markdown',
  exportHtml: 'export:html',
  exportPdf: 'export:pdf',
  exportPrint: 'export:print',
  saveImage: 'image:save',
  pickImage: 'image:pick',
  searchFiles: 'search:files',
  confirmSave: 'app:confirm-save',
  openExternal: 'app:open-external',
  openLocalPath: 'app:open-local-path',
  pathExists: 'app:path-exists',
  pathIsDirectory: 'app:path-is-directory',
  getZoom: 'app:get-zoom',
  setZoom: 'app:set-zoom',
  showAbout: 'app:show-about',
  setReadOnly: 'app:set-read-only',
  getLocale: 'app:get-locale',
  setLocale: 'app:set-locale',
  menuAction: 'menu:action',
  openPath: 'file:open-path',
  // Renderer announces that its IPC listeners are registered; the main
  // process then flushes queued "open with" paths (no lost messages).
  rendererReady: 'app:renderer-ready',
  // Main asks the renderer to confirm closing the window (unsaved changes);
  // the renderer replies with closeConfirmed once it is safe to close.
  requestClose: 'app:request-close',
  closeConfirmed: 'app:close-confirmed'
} as const

export type SaveChoice = 'save' | 'discard' | 'cancel'

/** Open-source repository URL (shown in the About dialog and Help menu). */
export const REPOSITORY_URL = 'https://github.com/newbie3033/markdown-editor'

export interface InkMarkApi {
  openFileDialog(): Promise<FileResult>
  saveFileDialog(defaultPath: string | null, content: string): Promise<SaveResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  openFolderDialog(): Promise<FolderResult>
  listMarkdown(folderPath: string): Promise<FileEntry[]>
  exportHtml(defaultName: string, html: string): Promise<SaveResult>
  exportPdf(defaultName: string, html: string): Promise<SaveResult>
  exportPrint(html: string): Promise<void>
  saveImage(payload: SaveImagePayload): Promise<SaveImageResult | null>
  pickImage(): Promise<PickImageResult>
  searchFiles(folderPath: string, query: string, mode?: SearchMode): Promise<FileSearchResult[]>
  confirmSave(fileName: string): Promise<SaveChoice>
  openExternal(url: string): Promise<void>
  openLocalPath(path: string): Promise<string>
  pathExists(path: string): Promise<boolean>
  pathIsDirectory(path: string): Promise<boolean>
  getPathForFile(file: File): string
  getZoom(): Promise<number>
  setZoom(level: number): Promise<void>
  showAbout(): Promise<void>
  setReadOnly(value: boolean): Promise<void>
  copyText(text: string): void
  getLocale(): Promise<Lang>
  setLocale(lang: Lang): Promise<void>
  onMenuAction(callback: (action: MenuAction) => void): () => void
  onOpenPath(callback: (path: string) => void): () => void
  onCloseRequest(callback: () => void): () => void
  closeConfirmed(): void
  rendererReady(): void
}
