// Shared IPC contract between the Electron main process, preload script and
// the renderer. Types are erased at build time; only the string constants and
// shapes are shared.

export type Lang = 'en' | 'zh'

export interface FileResult {
  path?: string
  content?: string
  version?: FileVersion
  canceled: boolean
}

export interface SaveResult {
  path?: string
  version?: FileVersion
  canceled: boolean
}

export interface FileVersion {
  mtimeMs: number
  size: number
  sha256: string
}

export interface ReadFileResult {
  content: string
  version: FileVersion
}

export interface WriteFileResult {
  version?: FileVersion
  conflict: boolean
}

export interface RecoveryDraft {
  filePath: string | null
  content: string
  cleanContent: string
  fileVersion: FileVersion | null
  sourceMode: boolean
  updatedAt: number
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

/** VS Code-style search options. All default to false. */
export interface SearchFlags {
  /** Match character case exactly (default: case-insensitive). */
  caseSensitive?: boolean
  /** Match whole words only (default: match substrings). */
  wholeWord?: boolean
  /** Treat the query as a regular expression (default: literal text). */
  regex?: boolean
}

/**
 * Compile a search query into a RegExp, VS Code style.
 * - literal mode (regex=false): special characters are escaped
 * - regex mode (regex=true): the query is used as a raw pattern
 * - caseSensitive=false adds the `i` flag
 * - wholeWord=true wraps the pattern in Unicode-aware word-boundary
 *   lookarounds (letters, digits and underscores count as word characters)
 * Returns null for empty queries or invalid regexes.
 */
export function compileSearchRegex(query: string, flags: SearchFlags = {}): RegExp | null {
  const q = query.trim()
  if (!q) return null
  try {
    let pattern = flags.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (flags.wholeWord) {
      pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`
    }
    const parts = ['g', 'm', 'u']
    if (!flags.caseSensitive) parts.push('i')
    return new RegExp(pattern, parts.join(''))
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
  | 'replace'
  | 'search-folder'
  | 'toggle-source'
  | 'toggle-sidebar'
  | 'toggle-articles'
  | 'toggle-file-tree'
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
  showError: 'app:show-error',
  copyText: 'clipboard:write-text',
  readClipboardText: 'clipboard:read-text',
  loadRecoveryDraft: 'recovery:load',
  saveRecoveryDraft: 'recovery:save',
  clearRecoveryDraft: 'recovery:clear',
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
  readFile(path: string): Promise<ReadFileResult>
  writeFile(path: string, content: string, expectedVersion?: FileVersion | null): Promise<WriteFileResult>
  openFolderDialog(): Promise<FolderResult>
  listMarkdown(folderPath: string): Promise<FileEntry[]>
  exportHtml(defaultName: string, html: string): Promise<SaveResult>
  exportPdf(defaultName: string, html: string): Promise<SaveResult>
  exportPrint(html: string): Promise<void>
  saveImage(payload: SaveImagePayload): Promise<SaveImageResult | null>
  pickImage(): Promise<PickImageResult>
  searchFiles(folderPath: string, query: string, flags?: SearchFlags): Promise<FileSearchResult[]>
  confirmSave(fileName: string): Promise<SaveChoice>
  showError(message: string, detail?: string): Promise<void>
  openExternal(url: string): Promise<void>
  openLocalPath(path: string): Promise<string>
  pathExists(path: string): Promise<boolean>
  pathIsDirectory(path: string): Promise<boolean>
  getPathForFile(file: File): string
  getZoom(): Promise<number>
  setZoom(level: number): Promise<void>
  showAbout(): Promise<void>
  setReadOnly(value: boolean): Promise<void>
  copyText(text: string): Promise<void>
  readClipboardText(): Promise<string>
  loadRecoveryDraft(): Promise<RecoveryDraft | null>
  saveRecoveryDraft(draft: RecoveryDraft): Promise<void>
  clearRecoveryDraft(): Promise<void>
  getLocale(): Promise<Lang>
  setLocale(lang: Lang): Promise<void>
  onMenuAction(callback: (action: MenuAction) => void): () => void
  onOpenPath(callback: (path: string) => void): () => void
  onCloseRequest(callback: () => void): () => void
  closeConfirmed(): void
  rendererReady(): void
}
