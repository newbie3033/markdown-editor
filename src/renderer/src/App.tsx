import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { editorViewCtx, parserCtx, remarkCtx, serializerCtx, type Editor } from '@milkdown/kit/core'
import { DOMSerializer, type Node as ProseMirrorNode } from '@milkdown/prose/model'
import { AllSelection } from '@milkdown/prose/state'
import type { RemarkParser } from '@milkdown/kit/transformer'
import { getMarkdown, getHTML, replaceAll as replaceAllRaw } from '@milkdown/kit/utils'
import { DEFAULT_MERMAID_STYLE, DEFAULT_RENDER_HTML, isMermaidStyle, type FileVersion, type MenuAction, type SearchFlags, type ThemePreference, type UpdateInfo } from '../../shared/ipc'
const MarkdownEditor = lazy(() =>
  import('./components/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor }))
)
import { ImagePreview, type PreviewImage } from './components/ImagePreview'
import { Sidebar, type SidebarTab, type FolderState } from './components/Sidebar'
import { OutlinePanel } from './components/OutlinePanel'
import { AppMenu } from './components/AppMenu'
import { StatusBar } from './components/StatusBar'
import { EditorContextMenu } from './components/EditorContextMenu'
import { FindBar } from './components/FindBar'
import { StorageManager } from './components/StorageManager'
import { UpdateDialog } from './components/UpdateDialog'
import { closeHtmlPreviewSource } from './lib/htmlPreview'
import { buildHtmlDocument } from './lib/export'
import { appendImage } from './lib/commands'
import { findInStringAsync, findTextMatchesAsync, getEditorDocument, selectMatch } from './lib/search'
import { useResizableWidth } from './lib/useResizableWidth'
import { usePersistentBoolean } from './lib/usePersistentBoolean'
import {
  computeStats,
  authorizeDroppedFile,
  dirNameFromPath,
  fileNameFromPath,
  isAbsolutePath,
  isImageFileName,
  isMarkdownFileName,
  type OutlineItem
} from './lib/markdown'
import { useI18n, welcomeMarkdown } from './lib/i18n'
import { DELETE_MERMAID_EVENT, TOGGLE_PREVIEW_SOURCE_EVENT } from './lib/codeBlockCopy'
import { normalizeDisplayMath } from './lib/math'
import { normalizeTextareaLineEndings, preserveMarkdownSource } from './lib/markdownSource'
import { jumpToSourcePosition, sourceOutline } from './lib/sourceOutline'

type SaveOutcome = 'saved' | 'canceled' | 'failed' | 'stale'

const replaceAll = (markdown: string) => replaceAllRaw(normalizeDisplayMath(markdown))

// String length is available without encoding or scanning the input buffer.
const LARGE_SOURCE_LENGTH = 64 * 1024

const isInFolder = (path: string, folder: string): boolean => {
  const separator = window.api.platform === 'win32' ? '\\' : '/'
  return path.startsWith(folder.endsWith(separator) ? folder : folder + separator)
}

function scrollToDocumentAnchor(editor: HTMLElement, id: string): void {
  const target = Array.from(editor.querySelectorAll<HTMLElement>('[id], a[name]'))
    .find(element => (element.id === id || element.getAttribute('name') === id) &&
      !element.closest('.html-preview-hidden'))
  if (!target) return
  for (let parent = target.parentElement; parent && parent !== editor; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.querySelector(':scope > summary')?.contains(target)) {
      parent.open = true
    }
  }
  target.scrollIntoView({ behavior: 'instant', block: 'start' })
}

function decodeLinkPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function setDocumentBase(href: string): void {
  const existing = document.querySelector('base')
  if (existing) {
    existing.href = href
  } else {
    const base = document.createElement('base')
    base.href = href
    document.head.appendChild(base)
  }
}

const sameFileVersion = (left: FileVersion | null, right: FileVersion | null): boolean =>
  left?.mtimeMs === right?.mtimeMs &&
  left?.size === right?.size &&
  left?.sha256 === right?.sha256

export default function App(): React.JSX.Element {
  const { t, lang, setLang, ready: localeReady } = useI18n()

  const [filePath, setFilePath] = useState<string | null>(null)
  const [missingPath, setMissingPath] = useState<string | null>(null)
  const [folders, setFolders] = useState<FolderState[]>([])
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [markdown, setMarkdown] = useState<string>('')
  const [analysisMarkdown, setAnalysisMarkdown] = useState('')
  const [dirty, setDirty] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [renderHtml, setRenderHtml] = useState(DEFAULT_RENDER_HTML)
  const renderHtmlChanged = useRef(false)
  // Panel visibility persists across sessions (same as the panel widths).
  const [showSidebar, setShowSidebar] = usePersistentBoolean('inkmark.showSidebar', true)
  const [showOutline, setShowOutline] = usePersistentBoolean('inkmark.showOutline', true)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files')
  const [findOpen, setFindOpen] = useState(false)
  const [findQueryRequest, setFindQueryRequest] = useState<{
    id: number
    text: string
  } | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [defaultReadOnly, setDefaultReadOnly] = usePersistentBoolean('inkmark.defaultReadOnly', false)
  const [readOnly, setReadOnly] = useState(defaultReadOnly)
  const [mermaidStyle, setMermaidStyle] = useState(() => {
    const saved = localStorage.getItem('inkmark.mermaidStyle')
    return isMermaidStyle(saved) ? saved : DEFAULT_MERMAID_STYLE
  })
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('inkmark.theme')
    return saved === 'dark' || saved === 'light' ? saved : 'system'
  })
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [sourceParser, setSourceParser] = useState<RemarkParser | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    previewSourceTarget: HTMLElement | null
    readOnlySelection?: string
  } | null>(null)
  const [zoomLevel, setZoomLevel] = useState(0)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null)
  useEffect(() => setPreviewImage(null), [filePath, sourceMode])
  const [storageOpen, setStorageOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const zoomRef = useRef(0)
  const leftSidebar = useResizableWidth('inkmark.sidebarWidth')
  const outlineSidebar = useResizableWidth('inkmark.outlineWidth')

  const editorRef = useRef<Editor | null>(null)
  const findDocumentListener = useRef<(() => void) | null>(null)
  const compositionStart = useRef<ProseMirrorNode | string | null>(null)
  const editorScrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const readingPositions = useRef({ visual: new Map<string, number>(), source: new Map<string, number>() })
  const documentLoadRef = useRef<symbol | null>(null)
  const markdownRef = useRef(markdown)
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const fileVersionRef = useRef<FileVersion | null>(null)
  const foldersRef = useRef(folders)
  const folderScans = useRef(new Map<string, symbol>())
  foldersRef.current = folders
  const openFilesRef = useRef(openFiles)
  openFilesRef.current = openFiles
  const welcomedRef = useRef(false)
  const recoveryStartedRef = useRef(false)
  const cleanContentRef = useRef('')
  const visualSourceRef = useRef({
    source: '',
    baseline: '',
    doc: null as ProseMirrorNode | null,
    content: ''
  })
  // Content that must be displayed in the editor once it is ready. The editor
  // mounts lazily (Suspense), so a document opened right at startup can race
  // ahead of it; the pending content is applied on mount instead of being
  // lost (or worse, the welcome document clobbering the opened file).
  const pendingContentRef = useRef<string | null>(null)
  // Re-entrancy guard for the window-close confirmation flow.
  const closeRequestRef = useRef(false)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const sourceModeRef = useRef(sourceMode)
  // Serialize saves so two rapid Ctrl+S actions can never write the same file
  // concurrently. Each queued save reads the latest editor content when it
  // actually begins.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const externalPromptRef = useRef(false)
  const ignoredExternalVersionRef = useRef<string | null>(null)
  const recoveryErrorShownRef = useRef(false)
  const recoveryTimerRef = useRef<number | null>(null)
  const analysisTimer = useRef<number | undefined>(undefined)

  const stats = useMemo(() => computeStats(analysisMarkdown), [analysisMarkdown])
  const sourceMarkdown = sourceMode ? markdown : null
  const sourceText = useMemo(() => normalizeTextareaLineEndings(sourceMarkdown ?? ''), [sourceMarkdown])
  const outlineMarkdown = sourceMode && showOutline ? analysisMarkdown : null
  const sourceHeadings = useMemo(() => sourceParser && outlineMarkdown !== null
    ? sourceOutline(sourceParser, normalizeTextareaLineEndings(outlineMarkdown)) : [],
    [outlineMarkdown, sourceParser])
  const activeOutline = sourceMode ? sourceHeadings : outline
  const title = fileNameFromPath(filePath) || t('status.untitled')

  const refreshAnalysis = useCallback((content: string, defer: boolean) => {
    window.clearTimeout(analysisTimer.current)
    if (!defer) {
      setAnalysisMarkdown(content)
      return
    }
    if (compositionStart.current !== null) return
    analysisTimer.current = window.setTimeout(() => {
      if (sourceModeRef.current && compositionStart.current === null && markdownRef.current === content) {
        setAnalysisMarkdown(content)
      }
    }, 500)
  }, [])

  useEffect(() => () => window.clearTimeout(analysisTimer.current), [])

  const updateMarkdown = useCallback((content: string, deferAnalysis = false) => {
    markdownRef.current = content
    setMarkdown(content)
    refreshAnalysis(content, deferAnalysis)
  }, [refreshAnalysis])

  const syncVisualEditor = useCallback((content: string) => {
    compositionStart.current = null
    const editor = editorRef.current
    if (!editor) {
      pendingContentRef.current = content
      return
    }
    editor.action((ctx) => {
      replaceAll(content)(ctx)
      const doc = ctx.get(editorViewCtx).state.doc
      visualSourceRef.current = {
        source: content,
        baseline: ctx.get(serializerCtx)(doc),
        doc,
        content
      }
    })
    pendingContentRef.current = null
  }, [])

  const cancelRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current === null) return
    window.clearTimeout(recoveryTimerRef.current)
    recoveryTimerRef.current = null
  }, [])

  const setDocumentContent = useCallback((content: string) => {
    cancelRecoveryTimer()
    updateMarkdown(content)
    syncVisualEditor(content)
  }, [cancelRecoveryTimer, syncVisualEditor, updateMarkdown])

  const rememberReadingPosition = useCallback(() => {
    const path = filePathRef.current
    if (!path) return
    const source = sourceModeRef.current
    const scroller = source ? textareaRef.current : editorScrollRef.current
    const positions = source ? readingPositions.current.source : readingPositions.current.visual
    if (scroller) positions.set(path, scroller.scrollTop)
  }, [])

  const restoreReadingPosition = useCallback(() => {
    const path = filePathRef.current
    const source = sourceModeRef.current
    const scroller = source ? textareaRef.current : editorScrollRef.current
    const positions = source ? readingPositions.current.source : readingPositions.current.visual
    if (scroller) scroller.scrollTop = path ? positions.get(path) ?? 0 : 0
  }, [])

  // Recover the last unsaved revision before accepting queued "open with"
  // paths. A subsequently opened file will go through the normal save/discard
  // confirmation instead of silently replacing the recovered buffer.
  useEffect(() => {
    if (!localeReady || recoveryStartedRef.current) return
    recoveryStartedRef.current = true
    void window.api
      .loadRecoveryDraft()
      .then(async (draft) => {
        if (!draft || draft.content === draft.cleanContent) return
        if (draft.filePath) {
          try {
            const disk = await window.api.readFile(draft.filePath)
            // A successful save may have beaten the asynchronous draft
            // cleanup during a crash. Never resurrect content already on disk.
            if (disk.content === draft.content) {
              await window.api.clearRecoveryDraft()
              return
            }
          } catch {
            // Missing/unreadable originals still benefit from draft recovery.
          }
        }
        const name = fileNameFromPath(draft.filePath) || t('status.untitled')
        const choice = await window.api.confirmRecovery(name, draft.updatedAt)
        if (choice === 'discard') {
          await window.api.clearRecoveryDraft()
          return
        }
        welcomedRef.current = true
        setFilePath(draft.filePath)
        filePathRef.current = draft.filePath
        fileVersionRef.current = draft.fileVersion
        cleanContentRef.current = draft.cleanContent
        setDocumentContent(draft.content)
        setSourceMode(draft.sourceMode)
        sourceModeRef.current = draft.sourceMode
        setOpenFiles(draft.filePath ? [draft.filePath] : [])
        setDirty(true)
      })
      .catch((error) => {
        console.error('Failed to load recovery draft', error)
        void window.api.showError(t('error.recoveryFailed'), String(error))
      })
      .finally(() => setRecoveryReady(true))
  }, [localeReady, setDocumentContent, t])

  // Seed the initial document once locale and crash recovery have completed. The welcome
  // page shows only on the very first launch (persisted in localStorage);
  // later launches start with a blank untitled document. File → Open Welcome
  // Page reopens it at any time.
  useEffect(() => {
    if (localeReady && recoveryReady && !welcomedRef.current) {
      welcomedRef.current = true
      // If a document was already opened (e.g. "open with" at startup), never
      // clobber it with the welcome document.
      if (pendingContentRef.current === null) {
        const seen = window.localStorage.getItem('inkmark.welcomeSeen') === '1'
        const initial = seen ? '' : welcomeMarkdown(lang)
        if (!seen) window.localStorage.setItem('inkmark.welcomeSeen', '1')
        cleanContentRef.current = initial
        setDocumentContent(initial)
      }
    }
  }, [localeReady, recoveryReady, lang, setDocumentContent])

  useEffect(() => {
    document.documentElement.dataset.mermaidStyle = mermaidStyle
    localStorage.setItem('inkmark.mermaidStyle', mermaidStyle)
    void window.api.setMermaidStyle(mermaidStyle)
  }, [mermaidStyle])

  useEffect(() => {
    localStorage.setItem('inkmark.theme', theme)
    void window.api.setTheme(theme)
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (system.matches ? 'dark' : 'light') : theme
    }
    applyTheme()
    system.addEventListener('change', applyTheme)
    return () => system.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    void window.api.setDefaultReadOnly(defaultReadOnly)
  }, [defaultReadOnly])

  useEffect(() => {
    void window.api.setReadOnly(readOnly)
  }, [readOnly])

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${title}${readOnly ? t('status.readOnlySuffix') : ''}`
    document.documentElement.style.setProperty('--editor-placeholder', `"${t('editor.placeholder')}"`)
  }, [dirty, title, readOnly, t])

  // Zoom: read the initial level from the main process; all changes flow
  // through applyZoom so the status bar stays in sync.
  useEffect(() => {
    void window.api.getZoom().then((level) => {
      zoomRef.current = level
      setZoomLevel(level)
    })
  }, [])

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(3, Math.max(-3, next))
    zoomRef.current = clamped
    setZoomLevel(clamped)
    void window.api.setZoom(clamped)
  }, [])

  // Focus the editor (or the source-mode textarea) and show the caret.
  const focusEditor = useCallback(() => {
    if (sourceModeRef.current) {
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus({ preventScroll: true })
        textarea.setSelectionRange(0, 0)
      }
      return
    }
    editorRef.current?.action((ctx) => {
      ctx.get(editorViewCtx).focus()
    })
  }, [])

  const displayDocument = useCallback((content: string, focus: boolean) => {
    // The controlled textarea needs its new value before it can be scrolled.
    if (sourceModeRef.current) flushSync(() => setDocumentContent(content))
    else setDocumentContent(content)
    if (focus) focusEditor()
    restoreReadingPosition()
  }, [focusEditor, restoreReadingPosition, setDocumentContent])

  const changeSourceMode = useCallback((value: boolean) => {
    rememberReadingPosition()
    compositionStart.current = null
    refreshAnalysis(markdownRef.current, false)
    sourceModeRef.current = value
    flushSync(() => setSourceMode(value))
    restoreReadingPosition()
  }, [refreshAnalysis, rememberReadingPosition, restoreReadingPosition])

  const setReadOnlyMode = useCallback(
    (value: boolean) => {
      if (value && sourceModeRef.current) {
        // Sync the textarea content back and leave source mode first.
        syncVisualEditor(markdownRef.current)
        changeSourceMode(false)
      }
      setCtxMenu(null)
      if (value) setReplaceOpen(false)
      setReadOnly(value)
      editorRef.current?.action((ctx) => {
        ctx.get(editorViewCtx).setProps({ editable: () => !value })
      })
    },
    [changeSourceMode, syncVisualEditor]
  )

  // Resolve relative local resources through the main process's constrained
  // custom protocol. Markdown keeps portable paths; Chromium never receives
  // direct file:// access.
  const updateDocumentBase = useCallback(async (path: string | null): Promise<void> => {
    if (path) {
      const href = await window.api.getDocumentBaseUrl(path)
      if (filePathRef.current !== path) return
      setDocumentBase(href)
    } else {
      document.querySelector('base')?.remove()
    }
  }, [])

  useEffect(() => {
    void updateDocumentBase(filePath).catch((error) =>
      console.error('Failed to update document base URL', error)
    )
  }, [filePath, updateDocumentBase])

  const getActiveContent = useCallback((visualDoc?: ProseMirrorNode): string => {
    if (sourceModeRef.current) return markdownRef.current
    return editorRef.current?.action((ctx) => {
      const doc = visualDoc ?? ctx.get(editorViewCtx).state.doc
      const snapshot = visualSourceRef.current
      if (doc === snapshot.doc) return snapshot.content

      const serialize = ctx.get(serializerCtx)
      const parse = ctx.get(parserCtx)
      const edited = serialize(doc)
      let expected: string | undefined
      const content = preserveMarkdownSource(snapshot.source, snapshot.baseline, edited, (candidate) => {
        try {
          expected ??= serialize(parse(normalizeDisplayMath(edited)))
          return serialize(parse(normalizeDisplayMath(candidate))) === expected
        } catch {
          return false
        }
      })
      snapshot.doc = doc
      snapshot.content = content
      return content
    }) ?? markdownRef.current
  }, [])

  const hasUnsavedChanges = useCallback((): boolean => {
    return getActiveContent() !== cleanContentRef.current
  }, [getActiveContent])

  const updateEditedContent = useCallback((content: string, deferAnalysis = false) => {
    updateMarkdown(content, deferAnalysis)
    setDirty(content !== cleanContentRef.current)
  }, [updateMarkdown])

  const updateTextareaContent = useCallback((value: string) => {
    const source = markdownRef.current
    const content = preserveMarkdownSource(
      source,
      normalizeTextareaLineEndings(source),
      value,
      (candidate) => normalizeTextareaLineEndings(candidate) === value
    )
    const beforeComposition = compositionStart.current
    updateEditedContent(content, content.length >= LARGE_SOURCE_LENGTH ||
      (typeof beforeComposition === 'string' && beforeComposition.length >= LARGE_SOURCE_LENGTH))
  }, [updateEditedContent])

  const clearRecoveryDraft = useCallback(async (): Promise<void> => {
    try {
      await window.api.clearRecoveryDraft()
      recoveryErrorShownRef.current = false
    } catch (error) {
      console.error('Failed to clear recovery draft', error)
      if (!recoveryErrorShownRef.current) {
        recoveryErrorShownRef.current = true
        await window.api.showError(t('error.recoveryFailed'), String(error)).catch(() => undefined)
      }
    }
  }, [t])

  const reportSaveError = useCallback(async (message: string, error?: unknown): Promise<void> => {
    try {
      await window.api.showError(
        message,
        error == null ? undefined : error instanceof Error ? error.message : String(error)
      )
    } catch (reportError) {
      console.error('Failed to show save error', reportError)
    }
  }, [])

  const reportOpenError = useCallback(
    (error: unknown): void => {
      void reportSaveError(t('error.openFailed'), error)
    },
    [reportSaveError, t]
  )

  const persistRecoveryDraft = useCallback(async (): Promise<void> => {
    const source = sourceModeRef.current

    try {
      const checkpoint = compositionStart.current
      const content = typeof checkpoint === 'string' ? checkpoint : getActiveContent(checkpoint ?? undefined)
      // The live editor may already contain the next, uncommitted candidate.
      if (!source && checkpoint === null) updateEditedContent(content)
      if (content === cleanContentRef.current) {
        await clearRecoveryDraft()
        return
      }
      await window.api.saveRecoveryDraft({
        filePath: filePathRef.current,
        content,
        cleanContent: cleanContentRef.current,
        fileVersion: fileVersionRef.current,
        sourceMode: source,
        updatedAt: Date.now()
      })
      recoveryErrorShownRef.current = false
    } catch (error) {
      console.error('Failed to save recovery draft', error)
      if (!recoveryErrorShownRef.current) {
        recoveryErrorShownRef.current = true
        void window.api.showError(t('error.recoveryFailed'), String(error))
      }
    }
  }, [clearRecoveryDraft, getActiveContent, t, updateEditedContent])

  const scheduleRecoveryDraft = useCallback(() => {
    cancelRecoveryTimer()
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null
      void persistRecoveryDraft()
    }, 500)
  }, [cancelRecoveryTimer, persistRecoveryDraft])

  useEffect(() => {
    if (!recoveryReady) return
    scheduleRecoveryDraft()
    return cancelRecoveryTimer
  }, [cancelRecoveryTimer, filePath, recoveryReady, scheduleRecoveryDraft, sourceMarkdown])

  // Even during a long composition, persist the last committed revision.
  useEffect(() => {
    if (!recoveryReady) return
    const timer = window.setInterval(() => void persistRecoveryDraft(), 5_000)
    return () => window.clearInterval(timer)
  }, [recoveryReady, persistRecoveryDraft])

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    const parser = editor.action((ctx) => ctx.get(remarkCtx))
    setSourceParser(() => parser)
    syncVisualEditor(pendingContentRef.current ?? markdownRef.current)
  }, [syncVisualEditor])

  const handleChange = useCallback((doc: ProseMirrorNode) => {
    findDocumentListener.current?.()
    if (sourceModeRef.current || doc === visualSourceRef.current.doc) return
    setDirty(true)
    scheduleRecoveryDraft()
  }, [scheduleRecoveryDraft])

  const handleOutline = useCallback((items: OutlineItem[]) => {
    setOutline(items)
  }, [])

  const isInsideAnyFolder = useCallback((path: string): boolean => {
    return foldersRef.current.some((folder) => isInFolder(path, folder.path))
  }, [])

  const addToOpenFiles = useCallback((path: string) => {
    if (isInsideAnyFolder(path)) return
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }, [isInsideAnyFolder])

  const scanFolder = useCallback(async (path: string, open = false) => {
    const request = Symbol()
    folderScans.current.set(path, request)
    try {
      const tree = await window.api.listMarkdown(path)
      if (folderScans.current.get(path) !== request) return
      setFolders((prev) => {
        if (open && !prev.some((folder) => folder.path === path)) return [...prev, { path, tree }]
        return prev.map((folder) => folder.path === path ? { path, tree } : folder)
      })
      if (open) setOpenFiles((prev) => prev.filter((entry) => !isInFolder(entry, path)))
    } catch (error) {
      if (folderScans.current.get(path) === request) throw error
    } finally {
      if (folderScans.current.get(path) === request) folderScans.current.delete(path)
    }
  }, [])

  const checkDocumentPath = useCallback(async (path: string) => {
    const exists = await window.api.pathExists(path)
    if (filePathRef.current === path) setMissingPath(exists ? null : path)
    return exists
  }, [])

  const refreshFolder = useCallback(async (path: string) => {
    const current = filePathRef.current
    try {
      await Promise.all([
        scanFolder(path),
        current && isInFolder(current, path) && checkDocumentPath(current)
      ])
    } catch (error) {
      await reportSaveError(t('files.refreshFailed'), error)
    }
  }, [checkDocumentPath, reportSaveError, scanFolder, t])

  const performSave = useCallback(
    async (saveAs = false): Promise<SaveOutcome> => {
      const content = getActiveContent()
      const currentPath = filePathRef.current

      try {
        if (!currentPath || saveAs) {
          const result = await window.api.saveFileDialog(
            currentPath,
            content,
            currentPath ? fileVersionRef.current : null
          )
          if (result.canceled || !result.path) return 'canceled'
          if (result.conflict) {
            await reportSaveError(t('error.fileChanged'))
            return 'failed'
          }

          const savedPath = result.path
          const isNewPath = savedPath !== currentPath
          setFilePath(savedPath)
          filePathRef.current = savedPath
          fileVersionRef.current = result.version ?? null
          cleanContentRef.current = content
          setMissingPath(null)

          if (isNewPath) {
            if (missingPath && missingPath === currentPath) {
              setOpenFiles((prev) => prev.filter((path) => path !== currentPath))
              void window.api.releaseDocumentAccess(missingPath).catch(console.error)
            }
            addToOpenFiles(savedPath)
          }
          if (isNewPath || savedPath === missingPath) {
            for (const folder of foldersRef.current) {
              if (isInFolder(savedPath, folder.path)) {
                void scanFolder(folder.path).catch((error) => console.error('Failed to refresh folder', error))
              }
            }
          }
        } else {
          const result = await window.api.writeFile(currentPath, content, fileVersionRef.current)
          if (result.conflict) {
            await reportSaveError(t('error.fileChanged'))
            return 'failed'
          }
          fileVersionRef.current = result.version ?? null
          cleanContentRef.current = content
        }

        // An edit may have arrived while the asynchronous disk write was in
        // progress. Only report clean when the current buffer still equals the
        // exact content that was persisted.
        const stillCurrent = getActiveContent() === content
        setDirty(!stillCurrent)
        if (stillCurrent) {
          if (compositionStart.current !== null) {
            compositionStart.current = sourceModeRef.current ? content : getEditorDocument(editorRef.current)
          }
          await clearRecoveryDraft()
        }
        ignoredExternalVersionRef.current = null
        return stillCurrent ? 'saved' : 'stale'
      } catch (error) {
        console.error('Failed to save file', error)
        await reportSaveError(t('error.saveFailed'), error)
        return 'failed'
      }
    },
    [addToOpenFiles, clearRecoveryDraft, getActiveContent, missingPath, reportSaveError, scanFolder, t]
  )

  const save = useCallback(
    (saveAs = false): Promise<SaveOutcome> => {
      const run = saveQueueRef.current.then(() => performSave(saveAs))
      saveQueueRef.current = run.then(
        () => undefined,
        () => undefined
      )
      return run
    },
    [performSave]
  )

  const ensureDocumentPath = useCallback(async (): Promise<string | null> => {
    if (filePathRef.current) {
      await updateDocumentBase(filePathRef.current)
      return filePathRef.current
    }
    const outcome = await save(false)
    const path = outcome === 'saved' || outcome === 'stale' ? filePathRef.current : null
    if (path) await updateDocumentBase(path)
    return path
  }, [save, updateDocumentBase])

  const confirmBeforeReplace = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedChanges()) {
      await clearRecoveryDraft()
      return true
    }
    while (hasUnsavedChanges()) {
      const name = fileNameFromPath(filePathRef.current) || t('status.untitled')
      const choice = await window.api.confirmSave(name)
      if (choice === 'cancel') return false
      if (choice === 'discard') {
        cancelRecoveryTimer()
        await clearRecoveryDraft()
        return true
      }
      const outcome = await save(false)
      if (outcome === 'canceled' || outcome === 'failed') return false
      // If another edit arrived while saving, loop and ask about that newer
      // unsaved revision instead of discarding it during the transition.
    }
    await clearRecoveryDraft()
    return true
  }, [cancelRecoveryTimer, clearRecoveryDraft, hasUnsavedChanges, save, t])

  const rememberOpenedFile = useCallback((path: string) => {
    void window.api.recordRecentFile(path).catch(console.error)
  }, [])

  const loadDocument = useCallback(
    async (path: string, content: string, version: FileVersion) => {
      const load = Symbol()
      documentLoadRef.current = load
      const previousPath = filePathRef.current
      const href = await window.api.getDocumentBaseUrl(path)
      if (documentLoadRef.current !== load || filePathRef.current !== previousPath) return

      rememberReadingPosition()
      setMissingPath(null)
      setFilePath(path)
      filePathRef.current = path
      fileVersionRef.current = version
      ignoredExternalVersionRef.current = null
      setDocumentBase(href)
      cleanContentRef.current = content
      setDirty(false)
      addToOpenFiles(path)
      rememberOpenedFile(path)
      displayDocument(content, true)
      return load
    },
    [addToOpenFiles, displayDocument, rememberOpenedFile, rememberReadingPosition]
  )

  const locateDocument = useCallback(async () => {
    const original = filePathRef.current
    if (!original || original !== missingPath) return
    try {
      const result = await window.api.openFileDialog()
      if (result.canceled || !result.path || !result.version || result.content == null) return
      const { path, content, version } = result
      await saveQueueRef.current
      const releaseUnusedSelection = () => {
        if (path !== filePathRef.current && !openFilesRef.current.includes(path)) {
          void window.api.releaseDocumentAccess(path).catch(console.error)
        }
      }
      if (original !== filePathRef.current) {
        releaseUnusedSelection()
        return
      }
      const buffer = getActiveContent()
      const keepEdits = buffer !== cleanContentRef.current
      if (keepEdits && content !== cleanContentRef.current && content !== buffer) {
        releaseUnusedSelection()
        await reportSaveError(t('files.locateConflict'))
        return
      }
      // A rename keeps the editor instance, selection and undo history intact.
      // A clean buffer can also adopt a newer revision of the located file.
      if (!keepEdits && buffer !== content) setDocumentContent(content)
      cleanContentRef.current = content
      fileVersionRef.current = version
      ignoredExternalVersionRef.current = null
      filePathRef.current = path
      setFilePath(path)
      setDirty(keepEdits && buffer !== content)
      setMissingPath(null)
      rememberOpenedFile(path)
      if (path !== original) {
        setOpenFiles((prev) => prev.filter((entry) => entry !== original))
        addToOpenFiles(path)
        await window.api.releaseDocumentAccess(original)
      }
    } catch (error) {
      await reportSaveError(t('error.openFailed'), error)
    }
  }, [addToOpenFiles, getActiveContent, missingPath, rememberOpenedFile, reportSaveError, setDocumentContent, t])

  const openFile = useCallback(async () => {
    try {
      const result = await window.api.openFileDialog()
      if (!result.canceled && result.path && result.content != null) {
        if (!(await confirmBeforeReplace())) {
          if (result.path !== filePathRef.current && !openFilesRef.current.includes(result.path)) {
            await window.api.releaseDocumentAccess(result.path).catch(() => undefined)
          }
          return
        }
        // The selected file may be the current document and may just have been
        // saved by the confirmation flow, so read it again after confirmation.
        const latest = await window.api.readFile(result.path)
        await loadDocument(latest.path, latest.content, latest.version)
      }
    } catch (error) {
      console.error('Failed to open file', error)
      await reportSaveError(t('error.openFailed'), error)
    }
  }, [confirmBeforeReplace, loadDocument, reportSaveError, t])

  const openPath = useCallback(
    async (path: string, fromHistory = false, anchor?: string) => {
      try {
        if (!(await confirmBeforeReplace())) {
          if (!fromHistory && path !== filePathRef.current && !openFilesRef.current.includes(path)) {
            await window.api.releaseDocumentAccess(path).catch(() => undefined)
          }
          return
        }
        const result = fromHistory ? await window.api.readRecentFile(path) : await window.api.readFile(path)
        const load = await loadDocument(result.path, result.content, result.version)
        if (anchor && load && documentLoadRef.current === load && filePathRef.current === result.path) {
          const editor = editorRef.current?.action(ctx => ctx.get(editorViewCtx).dom)
          if (editor) scrollToDocumentAnchor(editor, anchor)
        }
      } catch (error) {
        console.error('Failed to open file', error)
        await reportSaveError(t('error.openFailed'), error)
      }
    },
    [confirmBeforeReplace, loadDocument, reportSaveError, t]
  )

  const openFolder = useCallback(async (explicitPath?: string) => {
    try {
      let path = explicitPath
      if (!path) {
        const result = await window.api.openFolderDialog()
        if (result.canceled || !result.path) return
        path = result.path
      }
      await scanFolder(path, true)
    } catch (error) {
      console.error('Failed to open folder', error)
      await reportSaveError(t('error.openFailed'), error)
    }
  }, [reportSaveError, scanFolder, t])

  const closeFolder = useCallback((path: string) => {
    folderScans.current.delete(path)
    setFolders((prev) => prev.filter((folder) => folder.path !== path))
    void window.api.releaseDirectoryAccess(path).catch((error) =>
      console.error('Failed to release folder access', error)
    )
    // Keep the current document reachable: it becomes a loose file.
    const current = filePathRef.current
    if (current && isInFolder(current, path)) {
      setOpenFiles((prev) => (prev.includes(current) ? prev : [...prev, current]))
    }
  }, [])

  const closeAllFolders = useCallback(() => {
    folderScans.current.clear()
    const current = filePathRef.current
    if (current) setOpenFiles((prev) => (prev.includes(current) ? prev : [...prev, current]))
    for (const folder of foldersRef.current) {
      void window.api.releaseDirectoryAccess(folder.path).catch((error) =>
        console.error('Failed to release folder access', error)
      )
    }
    setFolders([])
  }, [])

  const openSearchResult = useCallback(
    async (path: string, matchIndex: number, query: string, flags: SearchFlags = {}) => {
      try {
        if (!(await confirmBeforeReplace())) return
        const result = await window.api.readFile(path)
        const load = await loadDocument(result.path, result.content, result.version)
        if (!load || matchIndex < 0) return

        const textarea = textareaRef.current
        const editor = editorRef.current
        const doc = getEditorDocument(editor)
        const matches = textarea
          ? await findInStringAsync(textarea.value, query, flags)
          : doc ? await findTextMatchesAsync(doc, query, flags) : []
        const match = matches[matchIndex] ?? matches[matches.length - 1]
        if (!match || documentLoadRef.current !== load || filePathRef.current !== result.path ||
          textareaRef.current !== textarea || markdownRef.current !== result.content) return
        if (textarea) jumpToSourcePosition(textarea, match.from, match.to)
        else if (editor && getEditorDocument(editorRef.current) === doc) selectMatch(editor, match)
      } catch (error) {
        console.error('Failed to open search result', error)
        await reportSaveError(t('error.openFailed'), error)
      }
    },
    [confirmBeforeReplace, loadDocument, reportSaveError, t]
  )

  const handleExternalFileChange = useCallback(async () => {
    const path = filePathRef.current
    if (!path || externalPromptRef.current) return
    externalPromptRef.current = true
    try {
      const latest = await window.api.readFile(path)
      if (filePathRef.current !== path) return
      setMissingPath(null)
      if (sameFileVersion(latest.version, fileVersionRef.current)) return
      const signature = `${latest.version.mtimeMs}:${latest.version.size}:${latest.version.sha256}`
      if (ignoredExternalVersionRef.current === signature) return

      const choice = await window.api.confirmExternalChange(
        fileNameFromPath(path),
        hasUnsavedChanges()
      )
      if (filePathRef.current !== path) return
      if (choice === 'reload') {
        ignoredExternalVersionRef.current = null
        await clearRecoveryDraft()
        await loadDocument(path, latest.content, latest.version)
      } else if (choice === 'saveAs') {
        const outcome = await save(true)
        if (outcome === 'canceled' || outcome === 'failed') {
          ignoredExternalVersionRef.current = signature
        }
      } else {
        // Keep the old expected version so a later Ctrl+S still refuses to
        // overwrite the external revision.
        ignoredExternalVersionRef.current = signature
      }
    } catch (error) {
      if (filePathRef.current !== path || !(await checkDocumentPath(path))) return
      console.error('Failed to inspect externally changed file', error)
      await reportSaveError(t('error.openFailed'), error)
    } finally {
      externalPromptRef.current = false
    }
  }, [checkDocumentPath, clearRecoveryDraft, hasUnsavedChanges, loadDocument, reportSaveError, save, t])

  useEffect(() => {
    void window.api.watchFile(filePath).catch((error) =>
      console.error('Failed to watch current file', error)
    )
  }, [filePath])

  // The main process routes window closing through here: ask about unsaved
  // changes, then approve the close (or not).
  const handleCloseRequest = useCallback(async () => {
    if (closeRequestRef.current) return
    closeRequestRef.current = true
    try {
      if (await confirmBeforeReplace()) window.api.closeConfirmed()
    } finally {
      closeRequestRef.current = false
    }
  }, [confirmBeforeReplace])

  const closeFile = useCallback(
    async (path: string) => {
      const isCurrent = filePathRef.current === path
      if (isCurrent && !(await confirmBeforeReplace())) return
      setOpenFiles((prev) => prev.filter((p) => p !== path))
      await window.api.releaseDocumentAccess(path).catch((error) =>
        console.error('Failed to release document access', error)
      )
      if (filePathRef.current === path) {
        // Close the document: reset to a new untitled document.
        rememberReadingPosition()
        setFilePath(null)
        filePathRef.current = null
        fileVersionRef.current = null
        setDirty(false)
        cleanContentRef.current = ''
        displayDocument('', false)
      }
    },
    [confirmBeforeReplace, displayDocument, rememberReadingPosition]
  )

  const newDocument = useCallback(async () => {
    if (!(await confirmBeforeReplace())) return
    rememberReadingPosition()
    setFilePath(null)
    filePathRef.current = null
    fileVersionRef.current = null
    setDirty(false)
    cleanContentRef.current = ''
    displayDocument('', true)
  }, [confirmBeforeReplace, displayDocument, rememberReadingPosition])

  // File → Open Welcome Page: show the welcome document as an untitled page.
  const showWelcome = useCallback(async () => {
    if (!(await confirmBeforeReplace())) return
    const welcome = welcomeMarkdown(lang)
    rememberReadingPosition()
    setFilePath(null)
    filePathRef.current = null
    fileVersionRef.current = null
    setDirty(false)
    cleanContentRef.current = welcome
    displayDocument(welcome, true)
  }, [confirmBeforeReplace, displayDocument, lang, rememberReadingPosition])

  const buildDocumentHtml = useCallback(() => {
    const body = editorRef.current?.action(ctx => {
      if (!sourceModeRef.current) return getHTML()(ctx)
      const doc = ctx.get(parserCtx)(normalizeDisplayMath(markdownRef.current))
      const container = document.createElement('div')
      container.append(DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content))
      return container.innerHTML
    }) ?? ''
    return buildHtmlDocument(body, title, renderHtml)
  }, [renderHtml, title])

  const exportHtml = useCallback(async () => {
    try {
      const path = filePathRef.current
      await window.api.exportHtml(title, await buildDocumentHtml(), path)
    } catch (error) {
      await reportSaveError(t('error.exportFailed'), error)
    }
  }, [buildDocumentHtml, reportSaveError, t, title])

  const exportPdf = useCallback(async () => {
    try {
      const path = filePathRef.current
      await window.api.exportPdf(title, await buildDocumentHtml(), path)
    } catch (error) {
      await reportSaveError(t('error.exportFailed'), error)
    }
  }, [buildDocumentHtml, reportSaveError, t, title])

  const print = useCallback(async () => {
    try {
      const path = filePathRef.current
      await window.api.exportPrint(await buildDocumentHtml(), path)
    } catch (error) {
      await reportSaveError(t('error.exportFailed'), error)
    }
  }, [buildDocumentHtml, reportSaveError, t])

  // Debug/self-test hook: expose the export-HTML builder to the headless
  // self-test so the PDF/HTML export path can be verified end to end.
  useEffect(() => {
    ;(window as unknown as { __inkmarkBuildExportHtml?: () => Promise<string> }).__inkmarkBuildExportHtml =
      buildDocumentHtml
  }, [buildDocumentHtml])

  // Debug/self-test hook: current Milkdown serialization.
  useEffect(() => {
    ;(window as unknown as { __inkmarkGetMarkdown?: () => string | null }).__inkmarkGetMarkdown = () =>
      editorRef.current?.action(getMarkdown()) ?? null
  }, [])

  // Debug/self-test hook: select the whole document (used to exercise the
  // context-menu copy/cut flow headlessly).
  useEffect(() => {
    ;(window as unknown as { __inkmarkSelectAll?: () => void }).__inkmarkSelectAll = () => {
      editorRef.current?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const selection = new AllSelection(state.doc)
        view.dispatch(state.tr.setSelection(selection))
        view.focus()
      })
    }
  }, [])

  const navigateOutline = useCallback((pos: number) => {
    if (sourceModeRef.current) {
      const textarea = textareaRef.current
      if (textarea && analysisMarkdown === markdownRef.current) jumpToSourcePosition(textarea, pos)
      return
    }
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (pos >= view.state.doc.content.size || view.state.doc.nodeAt(pos)?.type.name !== 'heading') return
      const heading = view.nodeDOM(pos)
      if (!(heading instanceof HTMLElement)) return
      if (heading.closest('.html-preview-hidden') && heading.id) {
        scrollToDocumentAnchor(view.dom, heading.id)
      } else {
        heading.scrollIntoView({ behavior: 'instant', block: 'start' })
      }
    })
  }, [analysisMarkdown])

  const toggleSourceMode = useCallback(() => {
    const next = !sourceModeRef.current
    // Snapshot pending visual edits synchronously before switching views.
    if (next) updateEditedContent(getActiveContent())
    else syncVisualEditor(markdownRef.current)
    changeSourceMode(next)
  }, [changeSourceMode, getActiveContent, syncVisualEditor, updateEditedContent])

  const getFocusedEditorSelection = useCallback((): string | null => {
    if (sourceModeRef.current) {
      const textarea = textareaRef.current
      if (!textarea || document.activeElement !== textarea) return null
      const { selectionStart, selectionEnd } = textarea
      if (selectionStart === selectionEnd) return null
      return textarea.value.slice(selectionStart, selectionEnd)
    }

    let selectedText: string | null = null
    editorRef.current?.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { selection, doc } = view.state
      if (!view.hasFocus() || selection.empty) return
      selectedText = doc.textBetween(selection.from, selection.to, '\n')
    })
    return selectedText
  }, [])

  const handleMenuAction = useCallback(
    (action: MenuAction) => {
      switch (action) {
        case 'new':
          if (!readOnlyRef.current) void newDocument()
          break
        case 'welcome':
          if (!readOnlyRef.current) void showWelcome()
          break
        case 'open':
          void openFile()
          break
        case 'open-folder':
          void openFolder()
          break
        case 'close-folder':
          closeAllFolders()
          break
        case 'save':
          if (!readOnlyRef.current) void save(false)
          break
        case 'save-as':
          if (!readOnlyRef.current) void save(true)
          break
        case 'export-html':
          void exportHtml()
          break
        case 'export-pdf':
          void exportPdf()
          break
        case 'print':
          void print()
          break
        case 'find':
          if (findOpen) {
            const selectedText = getFocusedEditorSelection()
            if (selectedText) {
              setFindQueryRequest((previous) => ({
                id: (previous?.id ?? 0) + 1,
                text: selectedText
              }))
            }
          } else {
            setFindQueryRequest(null)
          }
          setFindOpen(true)
          break
        case 'replace':
          if (readOnlyRef.current) break
          if (!findOpen) setFindQueryRequest(null)
          setFindOpen(true)
          setReplaceOpen(true)
          break
        case 'search-folder':
          setShowSidebar(true)
          setSidebarTab('search')
          break
        case 'render-html-on':
        case 'render-html-off':
          renderHtmlChanged.current = true
          setRenderHtml(action === 'render-html-on')
          break
        case 'toggle-source':
          toggleSourceMode()
          break
        case 'toggle-sidebar':
          setShowSidebar((v) => !v)
          break
        case 'toggle-articles':
          // Typora "Articles" (Ctrl+Shift+2): open files + folder trees share
          // one panel in InkMark, so show that panel on the files tab and
          // toggle it off when it is already showing this view.
          if (showSidebar && sidebarTab === 'files') {
            setShowSidebar(false)
          } else {
            setSidebarTab('files')
            setShowSidebar(true)
          }
          break
        case 'toggle-file-tree':
          // Typora "File Tree" (Ctrl+Shift+3): same panel/tab in InkMark.
          if (showSidebar && sidebarTab === 'files') {
            setShowSidebar(false)
          } else {
            setSidebarTab('files')
            setShowSidebar(true)
          }
          break
        case 'toggle-outline':
          setShowOutline((v) => !v)
          break
        case 'mermaid-style-soft':
        case 'mermaid-style-classic-blue':
        case 'mermaid-style-github':
        case 'mermaid-style-default':
        case 'mermaid-style-base': {
          const style = action.slice('mermaid-style-'.length)
          if (isMermaidStyle(style)) setMermaidStyle(style)
          break
        }
        case 'theme-system':
          setTheme('system')
          break
        case 'theme-light':
          setTheme('light')
          break
        case 'theme-dark':
          setTheme('dark')
          break
        case 'lang-en':
          setLang('en')
          break
        case 'lang-zh':
          setLang('zh')
          break
        case 'mode-readonly':
          setReadOnlyMode(true)
          break
        case 'mode-edit':
          setReadOnlyMode(false)
          break
        case 'default-mode-edit':
          setDefaultReadOnly(false)
          break
        case 'default-mode-readonly':
          setDefaultReadOnly(true)
          break
        case 'about':
          void window.api.showAbout()
          break
        case 'storage':
          setStorageOpen(true)
          break
        case 'zoom-in':
          applyZoom(zoomRef.current + 0.5)
          break
        case 'zoom-out':
          applyZoom(zoomRef.current - 0.5)
          break
        case 'zoom-reset':
          applyZoom(0)
          break
      }
    },
    [
      newDocument,
      showWelcome,
      openFile,
      openFolder,
      closeFolder,
      closeAllFolders,
      save,
      exportHtml,
      exportPdf,
      print,
      toggleSourceMode,
      applyZoom,
      setReadOnlyMode,
      setDefaultReadOnly,
      setLang,
      showSidebar,
      sidebarTab,
      findOpen,
      getFocusedEditorSelection,
      t
    ]
  )

  useEffect(() => {
    if (!recoveryReady) return
    let active = true
    void window.api.getRenderHtml().then(enabled => {
      if (active && !renderHtmlChanged.current) setRenderHtml(enabled)
    })
    return () => { active = false }
  }, [recoveryReady])

  // Subscribe to native menu events, OS "open with" events, and window-close
  // requests. Readiness is announced only after the listeners exist so the
  // main process never drops a queued path.
  useEffect(() => {
    if (!recoveryReady) return
    const offMenu = window.api.onMenuAction(handleMenuAction)
    const offOpen = window.api.onOpenPath((path, isDirectory, fromHistory) => {
      if (isDirectory) {
        setShowSidebar(true)
        setSidebarTab('files')
        void openFolder(path)
      } else {
        void openPath(path, fromHistory)
      }
    })
    const offFileChanged = window.api.onFileChanged(() => {
      void handleExternalFileChange()
    })
    const offClose = window.api.onCloseRequest(() => {
      void handleCloseRequest()
    })
    const offUpdate = window.api.onUpdateAvailable(setUpdate)
    window.api.rendererReady()
    return () => {
      offMenu()
      offOpen()
      offFileChanged()
      offClose()
      offUpdate()
    }
  }, [recoveryReady, handleMenuAction, openFolder, openPath, setShowSidebar, handleCloseRequest, handleExternalFileChange])

  // Window-level drag & drop: open .md documents and append images dropped
  // outside of the editor.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    const onDrop = async (event: DragEvent): Promise<void> => {
      event.preventDefault()
      const target = event.target as HTMLElement | null
      // Drops inside the editor are handled by the Milkdown upload plugin.
      if (target?.closest('.ProseMirror')) return

      const files = Array.from(event.dataTransfer?.files ?? [])
      const dropped = await Promise.all(
        files.map(async (file) => ({ file, authorized: await authorizeDroppedFile(file) }))
      )
      for (const { file, authorized } of dropped) {
        const path = authorized?.path ?? ''
        if (isMarkdownFileName(file.name)) {
          if (!path) continue
          void openPath(path)
          return
        }
        if (authorized?.isDirectory) {
          void openFolder(path)
          return
        }
      }
      void (async () => {
        const editor = editorRef.current
        if (!editor || readOnlyRef.current) return
        const images = dropped.filter(
          ({ file }) => file.type.startsWith('image/') || isImageFileName(file.name)
        )
        if (images.length === 0) return
        let clipboardDocPath: string | null = null
        for (const { file, authorized } of images) {
          try {
            clipboardDocPath ??= await ensureDocumentPath()
            if (!clipboardDocPath) return
            const result = await window.api.saveImage(
              authorized?.path
                ? { sourcePath: authorized.path, docPath: clipboardDocPath }
                : {
                    data: await file.arrayBuffer(),
                    name: file.name,
                    docPath: clipboardDocPath
                  }
            )
            if (result) appendImage(editor, result.src)
          } catch (error) {
            await reportSaveError(t('error.imageFailed'), error)
          }
        }
      })()
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [ensureDocumentPath, openFolder, openPath, reportSaveError, t])

  const onEditorContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const position = { x: event.clientX, y: event.clientY }
      if (readOnly) {
        if (sourceMode) {
          const textarea = textareaRef.current
          if (!textarea || event.target !== textarea) return

          event.preventDefault()
          const readOnlySelection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
          setCtxMenu({ ...position, previewSourceTarget: null, readOnlySelection })
          return
        }
        const editorDom = editorRef.current?.action((ctx) => ctx.get(editorViewCtx).dom)
        if (!editorDom?.contains(event.target as Node)) return

        event.preventDefault()
        // Read-only text selection lives in the DOM and may differ from the editor state.
        const selection = window.getSelection()
        const readOnlySelection = selection &&
          editorDom.contains(selection.anchorNode) && editorDom.contains(selection.focusNode)
          ? selection.toString()
          : ''
        setCtxMenu({ ...position, previewSourceTarget: null, readOnlySelection })
        return
      }
      if (sourceMode) return
      event.preventDefault()
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.code-block-wrap[data-preview-kind], .html-preview, .html-preview-source')
        : null
      setCtxMenu({ ...position, previewSourceTarget: target })
    },
    [sourceMode, readOnly]
  )

  const subscribeToDocument = useCallback((listener: () => void) => {
    findDocumentListener.current = listener
    return () => { findDocumentListener.current = null }
  }, [])

  // Smart hyperlink handling: http/https → external browser; local links are
  // resolved relative to the document and opened in the app (markdown) or with
  // the system default application. Works for plain clicks and Ctrl/Cmd+clicks.
  const handleLinkClick = useCallback(
    async (href: string) => {
      if (/^(https?:|mailto:)/i.test(href)) {
        await window.api.openExternal(href)
        return
      }
      if (href === '#') return
      if (href.startsWith('#')) {
        const id = decodeLinkPart(href.slice(1))
        const editor = editorRef.current?.action(ctx => ctx.get(editorViewCtx).dom)
        if (editor && id) scrollToDocumentAnchor(editor, id)
        return
      }
      if (href === '') return

      const fragmentIndex = href.indexOf('#')
      const anchor = fragmentIndex < 0 ? undefined : decodeLinkPart(href.slice(fragmentIndex + 1))
      let target = (fragmentIndex < 0 ? href : href.slice(0, fragmentIndex)).split('?')[0]
      if (target.startsWith('file://')) {
        try {
          target = decodeURIComponent(new URL(target).pathname)
          if (/^\/[A-Za-z]:/.test(target)) target = target.slice(1)
        } catch {
          return
        }
      } else {
        target = decodeLinkPart(target)
      }
      if (!target) return

      let resolved = target
      if (!isAbsolutePath(resolved)) {
        const dir = filePathRef.current ? dirNameFromPath(filePathRef.current) : null
        if (!dir) return
        resolved = `${dir}/${resolved}`
      }
      if (!(await window.api.pathExists(resolved))) return
      if (isMarkdownFileName(resolved)) {
        await openPath(resolved, false, anchor)
      } else {
        await window.api.openLocalPath(resolved)
      }
    },
    [openPath]
  )

  const onEditorClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null
      const imageView = target?.closest('.inkmark-image-view')
      if (imageView && target?.closest('.inkmark-image-zoom')) {
        const image = imageView.querySelector('img')
        if (image?.naturalWidth && !image.hidden) {
          event.preventDefault()
          setPreviewImage({
            src: image.currentSrc || image.src,
            alt: image.alt,
            width: image.naturalWidth,
            height: image.naturalHeight
          })
          return
        }
      }
      const taskItem = target?.closest?.('li[data-item-type="task"]') as HTMLLIElement | null
      if (taskItem && !readOnlyRef.current && !sourceModeRef.current) {
        const box = getComputedStyle(taskItem, '::before')
        const rect = taskItem.getBoundingClientRect()
        const left = rect.left + parseFloat(box.left)
        const top = rect.top + parseFloat(box.top)
        const right = left + parseFloat(box.width) + parseFloat(box.borderLeftWidth) + parseFloat(box.borderRightWidth)
        const bottom = top + parseFloat(box.height) + parseFloat(box.borderTopWidth) + parseFloat(box.borderBottomWidth)
        if (event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom) {
          const editor = editorRef.current
          if (editor) {
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const pos = view.posAtDOM(taskItem, 0) - 1
              const node = view.state.doc.nodeAt(pos)
              if (node?.type.name !== 'list_item' || typeof node.attrs.checked !== 'boolean') return
              view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: !node.attrs.checked
              }))
            })
            event.preventDefault()
            return
          }
        }
      }
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      event.preventDefault()
      void handleLinkClick(anchor.getAttribute('href') ?? '').catch(reportOpenError)
    },
    [handleLinkClick, reportOpenError]
  )

  return (
    <div className="app">
      <AppMenu />
      {showSidebar && (
        <Sidebar
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          folders={folders}
          openFiles={openFiles}
          activePath={filePath}
          width={leftSidebar.width}
          onResizeStart={leftSidebar.startResize}
          onResetWidth={leftSidebar.resetWidth}
          onOpenFile={(path) => void openPath(path)}
          onOpenFolder={() => void openFolder()}
          onRefreshFolder={(path) => void refreshFolder(path)}
          onCloseFolder={closeFolder}
          onCloseFile={(path) => void closeFile(path)}
          onOpenSearchResult={(path, index, query, flags) =>
            void openSearchResult(path, index, query, flags)}
          onSearchError={reportOpenError}
        />
      )}

      <main className="editor-area">
        {filePath && missingPath === filePath && (
          <div className="missing-document">
            <span role="status">{t('files.missingDocument', { name: title })}</span>
            <button onClick={() => void locateDocument()}>{t('files.locate')}</button>
            <button onClick={() => void save(true)}>{t('files.saveAs')}</button>
          </div>
        )}
        {findOpen && (
          <FindBar
            editor={editorRef.current}
            subscribeToDocument={subscribeToDocument}
            sourceMode={sourceMode}
            sourceText={sourceText}
            textareaRef={textareaRef}
            replaceOpen={!readOnly && replaceOpen}
            onToggleReplace={readOnly ? undefined : () => setReplaceOpen((v) => !v)}
            onSourceReplace={updateTextareaContent}
            queryRequest={findQueryRequest}
            onClose={() => {
              setFindOpen(false)
              setFindQueryRequest(null)
            }}
          />
        )}
        <div
          className="editor-scroll"
          ref={editorScrollRef}
          onClick={onEditorClick}
          onContextMenu={onEditorContextMenu}
          onScroll={() => setCtxMenu(null)}
          onCompositionStart={() => {
            compositionStart.current = sourceModeRef.current ? markdownRef.current : getEditorDocument(editorRef.current)
          }}
          onCompositionEnd={() => {
            compositionStart.current = null
            if (sourceModeRef.current) {
              const content = markdownRef.current
              refreshAnalysis(content, content.length >= LARGE_SOURCE_LENGTH)
            }
            scheduleRecoveryDraft()
          }}
        >
          {localeReady && recoveryReady && (
            <div className={`wysiwyg-wrap${sourceMode ? ' hidden' : ''}`}>
              <Suspense fallback={<div className="editor-loading" />}>
                <MarkdownEditor
                  initialMarkdown={pendingContentRef.current ?? welcomeMarkdown(lang)}
                  renderHtml={renderHtml}
                  onReady={handleEditorReady}
                  onChange={handleChange}
                  onOutline={handleOutline}
                  ensureDocPath={ensureDocumentPath}
                  isReadOnly={() => readOnlyRef.current}
                  onImageError={(error) => {
                    void reportSaveError(t('error.imageFailed'), error)
                  }}
                  onOpenDocument={(path) => void openPath(path)}
                  onOpenFolder={(path) => void openFolder(path)}
                />
              </Suspense>
            </div>
          )}
          {sourceMode && (
            <textarea
              ref={textareaRef}
              className="source-editor"
              value={sourceText}
              readOnly={readOnly}
              onChange={(event) => updateTextareaContent(event.target.value)}
              spellCheck={false}
              autoFocus
            />
          )}
        </div>
      </main>

      {showOutline && (
        <OutlinePanel
          outline={activeOutline}
          pending={sourceMode && analysisMarkdown !== markdown}
          onNavigate={navigateOutline}
          width={outlineSidebar.width}
          onResizeStart={outlineSidebar.startResize}
          onResetWidth={outlineSidebar.resetWidth}
        />
      )}

      <StatusBar
        stats={stats}
        filePath={filePath}
        dirty={dirty}
        sourceMode={sourceMode}
        lang={lang}
        zoomLevel={zoomLevel}
        readOnly={readOnly}
        showSidebar={showSidebar}
        showOutline={showOutline}
        onToggleSidebar={() => setShowSidebar((v) => !v)}
        onToggleOutline={() => setShowOutline((v) => !v)}
        onToggleReadOnly={() => setReadOnlyMode(!readOnly)}
        onToggleSource={toggleSourceMode}
        onZoomIn={() => applyZoom(zoomRef.current + 0.5)}
        onZoomOut={() => applyZoom(zoomRef.current - 0.5)}
        onZoomReset={() => applyZoom(0)}
      />
      {previewImage && <ImagePreview image={previewImage} onClose={() => setPreviewImage(null)} />}
        {ctxMenu && (
          <EditorContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            editor={editorRef.current}
            readOnlySelection={ctxMenu.readOnlySelection}
            showPreviewSourceToggle={Boolean(ctxMenu.previewSourceTarget)}
            previewSourceVisible={ctxMenu.previewSourceTarget?.dataset.sourceVisible === 'true' ||
              ctxMenu.previewSourceTarget?.classList.contains('html-preview-source') === true}
            onTogglePreviewSource={() => {
              const target = ctxMenu.previewSourceTarget
              if (target?.classList.contains('html-preview-source')) {
                editorRef.current?.action(ctx => {
                  const view = ctx.get(editorViewCtx)
                  view.dispatch(closeHtmlPreviewSource(view.state.tr))
                })
              } else target?.dispatchEvent(new Event(TOGGLE_PREVIEW_SOURCE_EVENT))
            }}
            onDeleteMermaid={ctxMenu.previewSourceTarget?.dataset.previewKind === 'mermaid' ? () => {
              ctxMenu.previewSourceTarget?.dispatchEvent(new Event(DELETE_MERMAID_EVENT))
            } : undefined}
            ensureDocPath={ensureDocumentPath}
            onImageError={(error) => {
              void reportSaveError(t('error.imageFailed'), error)
            }}
            onClose={() => setCtxMenu(null)}
          />
        )}
      <StorageManager
        open={storageOpen}
        protectRecovery={dirty}
        onClose={() => setStorageOpen(false)}
      />
      {update && (
        <UpdateDialog key={update.version} update={update} onClose={() => setUpdate(null)} />
      )}
    </div>
  )
}
