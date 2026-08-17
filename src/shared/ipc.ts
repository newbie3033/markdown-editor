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
  conflict?: boolean
}

export interface FileVersion {
  mtimeMs: number
  size: number
  sha256: string
  /** Preserve a UTF-8 BOM when overwriting an existing document. */
  utf8Bom?: boolean
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
  /** Raw bytes of a clipboard image, which has no stable source path. */
  data?: ArrayBuffer
  /** An OS-backed image explicitly selected or dropped by the user. */
  sourcePath?: string
  /** Original file name, used for clipboard image data. */
  name?: string
  /** Path of the current document, used to resolve the assets directory. */
  docPath: string
}

export interface SaveImageResult {
  /** Portable src to insert into Markdown, relative to the document. */
  src: string
}

export interface PickImageResult {
  path?: string
  canceled: boolean
}

export interface DroppedPathResult {
  path: string
  isDirectory: boolean
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

export interface RegexTextSegment {
  text: string
  /** Offset added to each match (for ProseMirror text-node positions). */
  offset: number
}

export interface TextRange {
  from: number
  to: number
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
  if (!q || q.length > 256) return null
  try {
    if (flags.regex) {
      // Regexes run against user files and the active document. Reject the
      // most common exponential-backtracking shapes instead of allowing one
      // query to freeze the Electron main/renderer thread.
      const structural = q
        .replace(/\\./g, '')
        .replace(/\[(?:\\.|[^\]])*\]/g, '')
      if (
        /\([^)]*(?:\*|\+|\{\d+(?:,\d*)?\})[^)]*\)(?:\*|\+|\{\d+(?:,\d*)?\})/.test(structural) ||
        /(?:\.\*){2,}|(?:\.\+){2,}|\\[1-9]/.test(structural)
      ) {
        return null
      }
    }
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
  authorizeDroppedPath: 'file:authorize-dropped-path',
  documentBaseUrl: 'file:document-base-url',
  readFile: 'file:read',
  writeFile: 'file:write',
  watchFile: 'file:watch',
  fileChanged: 'file:changed',
  confirmExternalChange: 'file:confirm-external-change',
  openFolderDialog: 'folder:open-dialog',
  listMarkdown: 'folder:list-markdown',
  exportHtml: 'export:html',
  exportPdf: 'export:pdf',
  exportPrint: 'export:print',
  saveImage: 'image:save',
  pickImage: 'image:pick',
  searchFiles: 'search:files',
  findRegexMatches: 'search:regex-matches',
  releaseDocumentAccess: 'file:release-access',
  releaseDirectoryAccess: 'folder:release-access',
  confirmSave: 'app:confirm-save',
  showError: 'app:show-error',
  copyText: 'clipboard:write-text',
  readClipboardText: 'clipboard:read-text',
  loadRecoveryDraft: 'recovery:load',
  saveRecoveryDraft: 'recovery:save',
  clearRecoveryDraft: 'recovery:clear',
  confirmRecovery: 'recovery:confirm',
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
export type RecoveryChoice = 'restore' | 'discard'
export type ExternalChangeChoice = 'reload' | 'saveAs' | 'keep'

/** Open-source repository URL (shown in the About dialog and Help menu). */
export const REPOSITORY_URL = 'https://github.com/newbie3033/markdown-editor'

export interface InkMarkApi {
  openFileDialog(): Promise<FileResult>
  saveFileDialog(
    defaultPath: string | null,
    content: string,
    expectedVersion?: FileVersion | null
  ): Promise<SaveResult>
  authorizeDroppedFile(file: File): Promise<DroppedPathResult | null>
  /** Test harness only; throws unless INKMARK_SELFTEST=1. */
  queueSelfTestDroppedPath(path: string): void
  readFile(path: string): Promise<ReadFileResult>
  getDocumentBaseUrl(path: string): Promise<string>
  writeFile(path: string, content: string, expectedVersion?: FileVersion | null): Promise<WriteFileResult>
  watchFile(path: string | null): Promise<void>
  confirmExternalChange(fileName: string, dirty: boolean): Promise<ExternalChangeChoice>
  openFolderDialog(): Promise<FolderResult>
  listMarkdown(folderPath: string): Promise<FileEntry[]>
  exportHtml(defaultName: string, html: string, documentPath: string | null): Promise<SaveResult>
  exportPdf(defaultName: string, html: string, documentPath: string | null): Promise<SaveResult>
  exportPrint(html: string, documentPath: string | null): Promise<void>
  saveImage(payload: SaveImagePayload): Promise<SaveImageResult | null>
  pickImage(): Promise<PickImageResult>
  searchFiles(folderPath: string, query: string, flags?: SearchFlags): Promise<FileSearchResult[]>
  findRegexMatches(segments: RegexTextSegment[], query: string, flags?: SearchFlags): Promise<TextRange[]>
  releaseDocumentAccess(path: string): Promise<void>
  releaseDirectoryAccess(path: string): Promise<void>
  confirmSave(fileName: string): Promise<SaveChoice>
  showError(message: string, detail?: string): Promise<void>
  openExternal(url: string): Promise<void>
  openLocalPath(path: string): Promise<string>
  pathExists(path: string): Promise<boolean>
  pathIsDirectory(path: string): Promise<boolean>
  getZoom(): Promise<number>
  setZoom(level: number): Promise<void>
  showAbout(): Promise<void>
  setReadOnly(value: boolean): Promise<void>
  copyText(text: string): Promise<void>
  readClipboardText(): Promise<string>
  loadRecoveryDraft(): Promise<RecoveryDraft | null>
  saveRecoveryDraft(draft: RecoveryDraft): Promise<void>
  clearRecoveryDraft(): Promise<void>
  confirmRecovery(fileName: string, updatedAt: number): Promise<RecoveryChoice>
  getLocale(): Promise<Lang>
  setLocale(lang: Lang): Promise<void>
  onMenuAction(callback: (action: MenuAction) => void): () => void
  onOpenPath(callback: (path: string) => void): () => void
  onFileChanged(callback: (path: string) => void): () => void
  onCloseRequest(callback: () => void): () => void
  closeConfirmed(): void
  rendererReady(): void
}
