import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { editorViewCtx, type Editor } from '@milkdown/kit/core'
import { getMarkdown, getHTML, replaceAll } from '@milkdown/kit/utils'
import type { MenuAction, SearchMode } from '../../shared/ipc'
const MarkdownEditor = lazy(() =>
  import('./components/MarkdownEditor').then((module) => ({ default: module.MarkdownEditor }))
)
import { Sidebar, type SidebarTab, type FolderState } from './components/Sidebar'
import { OutlinePanel } from './components/OutlinePanel'
import { StatusBar } from './components/StatusBar'
import { EditorContextMenu } from './components/EditorContextMenu'
import { FindBar } from './components/FindBar'
import { buildHtmlDocument, absolutizeUrls } from './lib/export'
import { appendImage } from './lib/commands'
import { findTextMatches, selectMatch } from './lib/search'
import { useResizableWidth } from './lib/useResizableWidth'
import {
  computeStats,
  dirNameFromPath,
  fileNameFromPath,
  filePathOf,
  isAbsolutePath,
  isImageFileName,
  isMarkdownFileName,
  type OutlineItem
} from './lib/markdown'
import { useI18n, welcomeMarkdown } from './lib/i18n'

type FileWithPath = File & { path?: string }

export default function App(): React.JSX.Element {
  const { t, lang, setLang, ready: localeReady } = useI18n()

  const [filePath, setFilePath] = useState<string | null>(null)
  const [folders, setFolders] = useState<FolderState[]>([])
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [markdown, setMarkdown] = useState<string>('')
  const [dirty, setDirty] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showOutline, setShowOutline] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files')
  const [findOpen, setFindOpen] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [zoomLevel, setZoomLevel] = useState(0)
  const zoomRef = useRef(0)
  const leftSidebar = useResizableWidth('inkmark.sidebarWidth')
  const outlineSidebar = useResizableWidth('inkmark.outlineWidth')

  const editorRef = useRef<Editor | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const markdownRef = useRef(markdown)
  markdownRef.current = markdown
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const welcomedRef = useRef(false)
  // The markdown listener fires asynchronously after programmatic document
  // replacements (open/new/close). Content-based comparison keeps those from
  // marking the document dirty: the listener echo equals the content we just
  // loaded, while real edits differ.
  const cleanContentRef = useRef<string | null>(null)
  // Content that must be displayed in the editor once it is ready. The editor
  // mounts lazily (Suspense), so a document opened right at startup can race
  // ahead of it; the pending content is applied on mount instead of being
  // lost (or worse, the welcome document clobbering the opened file).
  const pendingContentRef = useRef<string | null>(null)
  // Re-entrancy guard for the window-close confirmation flow.
  const closeRequestRef = useRef(false)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const stats = useMemo(() => computeStats(markdown), [markdown])
  const title = fileNameFromPath(filePath) || t('status.untitled')

  // Seed the initial document once the locale has been loaded. The welcome
  // page shows only on the very first launch (persisted in localStorage);
  // later launches start with a blank untitled document. File → Open Welcome
  // Page reopens it at any time.
  useEffect(() => {
    if (localeReady && !welcomedRef.current) {
      welcomedRef.current = true
      // If a document was already opened (e.g. "open with" at startup), never
      // clobber it with the welcome document.
      if (pendingContentRef.current === null) {
        const seen = window.localStorage.getItem('inkmark.welcomeSeen') === '1'
        const initial = seen ? '' : welcomeMarkdown(lang)
        if (!seen) window.localStorage.setItem('inkmark.welcomeSeen', '1')
        pendingContentRef.current = initial
        cleanContentRef.current = initial
        setMarkdown(initial)
        editorRef.current?.action(replaceAll(initial))
      }
    }
  }, [localeReady, lang])

  // Persist theme + window title + editor placeholder text.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.title = `${dirty ? '● ' : ''}${title}${readOnly ? t('status.readOnlySuffix') : ''} — InkMark`
    document.documentElement.style.setProperty('--editor-placeholder', `"${t('editor.placeholder')}"`)
  }, [theme, dirty, title, readOnly, t])

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

  const setReadOnlyMode = useCallback(
    (value: boolean) => {
      if (value && sourceMode) {
        // Sync the textarea content back and leave source mode first.
        editorRef.current?.action(replaceAll(markdownRef.current))
        setSourceMode(false)
      }
      setReadOnly(value)
      editorRef.current?.action((ctx) => {
        ctx.get(editorViewCtx).setProps({ editable: () => !value })
      })
      void window.api.setReadOnly(value)
    },
    [sourceMode]
  )

  // Resolve relative image links against the current document directory
  // by keeping a <base href="file://<doc dir>/"> element up to date.
  useEffect(() => {
    const existing = document.querySelector('base')
    if (filePath) {
      const dir = dirNameFromPath(filePath).replace(/\\/g, '/').replace(/\/+$/, '')
      const href = `file://${dir}/`
      if (existing) {
        existing.setAttribute('href', href)
      } else {
        const base = document.createElement('base')
        base.setAttribute('href', href)
        document.head.appendChild(base)
      }
    } else {
      existing?.remove()
    }
  }, [filePath])

  const normalizeMarkdown = (text: string): string =>
    text.replace(/\r\n/g, '\n').replace(/\n+$/, '')

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor
    // The editor mounts lazily: if a document was opened before it was ready,
    // apply the pending content now so the opened file actually displays.
    if (pendingContentRef.current !== null) {
      editor.action(replaceAll(pendingContentRef.current))
      pendingContentRef.current = null
      // Re-baseline from the editor's canonical serialization (the Milkdown
      // serializer normalizes e.g. `-` bullets to `*`), so later listener
      // echoes compare equal and the document does not open as "dirty".
      cleanContentRef.current = normalizeMarkdown(editor.action(getMarkdown()) ?? '')
    }
  }, [])

  const handleChange = useCallback((md: string) => {
    setMarkdown(md)
    // Content-based dirty state: serialization differences (trailing newline,
    // CRLF) must not count as edits, and transient echoes of programmatic
    // replacements (open/new/close, editor mount) that equal the clean
    // baseline must not leave a stale dirty flag behind.
    const clean = normalizeMarkdown(cleanContentRef.current ?? '')
    setDirty(normalizeMarkdown(md) !== clean)
  }, [])

  const handleOutline = useCallback((items: OutlineItem[]) => {
    setOutline(items)
  }, [])

  const isInsideAnyFolder = useCallback((path: string): boolean => {
    return foldersRef.current.some(
      (folder) => path.startsWith(folder.path + '/') || path.startsWith(folder.path + '\\')
    )
  }, [])

  const addToOpenFiles = useCallback((path: string) => {
    if (isInsideAnyFolder(path)) return
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }, [isInsideAnyFolder])

  const loadDocument = useCallback(
    async (path: string, content: string) => {
      setFilePath(path)
      setMarkdown(content)
      setDirty(false)
      addToOpenFiles(path)
      cleanContentRef.current = content
      pendingContentRef.current = content
      const editor = editorRef.current
      if (editor) {
        editor.action(replaceAll(content))
        pendingContentRef.current = null
        // Baseline against the editor's canonical serialization so the
        // debounced listener echo (which may normalize list markers etc.)
        // never marks a freshly opened file as dirty.
        cleanContentRef.current = normalizeMarkdown(editor.action(getMarkdown()) ?? content)
      }
    },
    [addToOpenFiles]
  )

  const openFile = useCallback(async () => {
    const result = await window.api.openFileDialog()
    if (!result.canceled && result.path && result.content != null) {
      await loadDocument(result.path, result.content)
    }
  }, [loadDocument])

  const openPath = useCallback(
    async (path: string) => {
      try {
        const content = await window.api.readFile(path)
        await loadDocument(path, content)
      } catch (error) {
        console.error('Failed to open file', error)
      }
    },
    [loadDocument]
  )

  const openFolder = useCallback(async (explicitPath?: string) => {
    let path = explicitPath
    if (!path) {
      const result = await window.api.openFolderDialog()
      if (result.canceled || !result.path) return
      path = result.path
    }
    const tree = await window.api.listMarkdown(path)
    setFolders((prev) =>
      prev.some((folder) => folder.path === path) ? prev : [...prev, { path, tree }]
    )
    // Files now covered by this folder no longer need to be listed as loose.
    setOpenFiles((prev) =>
      prev.filter((p) => !(p.startsWith(path + '/') || p.startsWith(path + '\\')))
    )
  }, [])

  const closeFolder = useCallback((path: string) => {
    setFolders((prev) => prev.filter((folder) => folder.path !== path))
    // Keep the current document reachable: it becomes a loose file.
    const current = filePathRef.current
    if (current && (current.startsWith(path + '/') || current.startsWith(path + '\\'))) {
      setOpenFiles((prev) => (prev.includes(current) ? prev : [...prev, current]))
    }
  }, [])

  const closeAllFolders = useCallback(() => {
    setFolders([])
  }, [])

  const openSearchResult = useCallback(
    async (path: string, matchIndex: number, query: string, mode: SearchMode = 'text') => {
      try {
        const content = await window.api.readFile(path)
        await loadDocument(path, content)
        if (matchIndex >= 0) {
          const editor = editorRef.current
          if (editor) {
            const matches = findTextMatches(editor, query, mode)
            const match = matches[matchIndex] ?? matches[matches.length - 1]
            if (match) selectMatch(editor, match)
          }
        }
      } catch (error) {
        console.error('Failed to open search result', error)
      }
    },
    [loadDocument]
  )

  const save = useCallback(async (saveAs = false) => {
    const content = editorRef.current?.action(getMarkdown()) ?? markdownRef.current
    const currentPath = filePathRef.current
    // Baseline against the canonical serialization of what will be saved, so
    // the document does not flip back to "dirty" right after saving.
    const canonical = normalizeMarkdown(content)
    if (!currentPath || saveAs) {
      const result = await window.api.saveFileDialog(currentPath, content)
      if (!result.canceled && result.path) {
        setFilePath(result.path)
        setDirty(false)
        cleanContentRef.current = canonical
      }
    } else {
      await window.api.writeFile(currentPath, content)
      setDirty(false)
      cleanContentRef.current = canonical
    }
  }, [])

  // The main process routes window closing through here: ask about unsaved
  // changes, then approve the close (or not).
  const handleCloseRequest = useCallback(async () => {
    if (closeRequestRef.current) return
    closeRequestRef.current = true
    try {
      if (!dirtyRef.current) {
        window.api.closeConfirmed()
        return
      }
      const name = fileNameFromPath(filePathRef.current) || t('status.untitled')
      const choice = await window.api.confirmSave(name)
      if (choice === 'cancel') return
      if (choice === 'save') {
        await save(false)
        // Save As may have been canceled — only close once actually saved.
        if (!filePathRef.current) return
      }
      window.api.closeConfirmed()
    } finally {
      closeRequestRef.current = false
    }
  }, [save, t])

  const closeFile = useCallback(
    async (path: string) => {
      const isCurrent = filePathRef.current === path
      if (isCurrent && dirtyRef.current) {
        const choice = await window.api.confirmSave(fileNameFromPath(path) || t('status.untitled'))
        if (choice === 'cancel') return
        if (choice === 'save') await save(false)
      }
      setOpenFiles((prev) => prev.filter((p) => p !== path))
      if (isCurrent) {
        // Close the document: reset to a new untitled document.
        setFilePath(null)
        setMarkdown('')
        setDirty(false)
        cleanContentRef.current = ''
        pendingContentRef.current = ''
        const editor = editorRef.current
        if (editor) {
          editor.action(replaceAll(''))
          cleanContentRef.current = normalizeMarkdown(editor.action(getMarkdown()) ?? '')
          pendingContentRef.current = null
        }
      }
    },
    [save, t]
  )

  const newDocument = useCallback(() => {
    setFilePath(null)
    setMarkdown('')
    setDirty(false)
    cleanContentRef.current = ''
    pendingContentRef.current = ''
    const editor = editorRef.current
    if (editor) {
      editor.action(replaceAll(''))
      cleanContentRef.current = normalizeMarkdown(editor.action(getMarkdown()) ?? '')
      pendingContentRef.current = null
    }
  }, [])

  // File → Open Welcome Page: show the welcome document as an untitled page.
  const showWelcome = useCallback(() => {
    const welcome = welcomeMarkdown(lang)
    setFilePath(null)
    setMarkdown(welcome)
    setDirty(false)
    cleanContentRef.current = welcome
    pendingContentRef.current = welcome
    const editor = editorRef.current
    if (editor) {
      editor.action(replaceAll(welcome))
      pendingContentRef.current = null
      cleanContentRef.current = normalizeMarkdown(editor.action(getMarkdown()) ?? welcome)
    }
  }, [lang])

  const buildDocumentHtml = useCallback(() => {
    const body = editorRef.current?.action(getHTML()) ?? ''
    const html = buildHtmlDocument(body, title)
    return absolutizeUrls(html, filePathRef.current ? dirNameFromPath(filePathRef.current) : null)
  }, [title])

  const exportHtml = useCallback(async () => {
    await window.api.exportHtml(title, buildDocumentHtml())
  }, [buildDocumentHtml, title])

  const exportPdf = useCallback(async () => {
    await window.api.exportPdf(title, buildDocumentHtml())
  }, [buildDocumentHtml, title])

  const print = useCallback(async () => {
    await window.api.exportPrint(buildDocumentHtml())
  }, [buildDocumentHtml])

  // Debug/self-test hook: expose the export-HTML builder to the headless
  // self-test so the PDF/HTML export path can be verified end to end.
  useEffect(() => {
    ;(window as unknown as { __inkmarkBuildExportHtml?: () => string }).__inkmarkBuildExportHtml =
      buildDocumentHtml
  }, [buildDocumentHtml])

  // Debug/self-test hook: current editor markdown (mirrors the dirty baseline
  // used by the dirty tracking).
  useEffect(() => {
    ;(window as unknown as { __inkmarkGetMarkdown?: () => string | null }).__inkmarkGetMarkdown = () =>
      editorRef.current?.action(getMarkdown()) ?? null
  }, [])

  const navigateOutline = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    // Fallback: find heading by its text content.
    const editorDom = document.querySelector('.milkdown .ProseMirror')
    if (editorDom) {
      const heading = Array.from(editorDom.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
        (h) => h.id === id || h.textContent?.trim() === id
      )
      heading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      const next = !prev
      // When leaving source mode, sync the textarea content into the editor.
      if (!next) {
        editorRef.current?.action(replaceAll(markdownRef.current))
      }
      return next
    })
  }, [])

  const handleMenuAction = useCallback(
    (action: MenuAction) => {
      switch (action) {
        case 'new':
          if (!readOnlyRef.current) newDocument()
          break
        case 'welcome':
          if (!readOnlyRef.current) showWelcome()
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
          setFindOpen(true)
          break
        case 'search-folder':
          setShowSidebar(true)
          setSidebarTab('search')
          break
        case 'toggle-source':
          toggleSourceMode()
          break
        case 'toggle-sidebar':
          setShowSidebar((v) => !v)
          break
        case 'toggle-outline':
          setShowOutline((v) => !v)
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
        case 'about':
          void window.api.showAbout()
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
      setLang,
      t
    ]
  )

  // Subscribe to native menu events, OS "open with" events, and window-close
  // requests. Readiness is announced only after the listeners exist so the
  // main process never drops a queued file path.
  useEffect(() => {
    const offMenu = window.api.onMenuAction(handleMenuAction)
    const offOpen = window.api.onOpenPath((path) => void openPath(path))
    const offClose = window.api.onCloseRequest(() => {
      void handleCloseRequest()
    })
    window.api.rendererReady()
    return () => {
      offMenu()
      offOpen()
      offClose()
    }
  }, [handleMenuAction, openPath, handleCloseRequest])

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
      for (const file of files) {
        const path = filePathOf(file)
        if (!path) continue
        if (isMarkdownFileName(file.name)) {
          void openPath(path)
          return
        }
        if (await window.api.pathIsDirectory(path)) {
          void openFolder(path)
          return
        }
      }
      void (async () => {
        const editor = editorRef.current
        if (!editor || readOnlyRef.current) return
        for (const file of files) {
          const path = filePathOf(file)
          if (!(file.type.startsWith('image/') || isImageFileName(file.name))) continue
          const result = await window.api.saveImage({
            sourcePath: path || null,
            data: path ? null : await file.arrayBuffer(),
            name: file.name,
            docPath: filePathRef.current
          })
          if (result) appendImage(editor, result.src)
        }
      })()
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [openPath])

  const onEditorContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (sourceMode || readOnly) return
      event.preventDefault()
      setCtxMenu({ x: event.clientX, y: event.clientY })
    },
    [sourceMode, readOnly]
  )

  const getDocPath = useCallback(() => filePathRef.current, [])
  const getEditor = useCallback(() => editorRef.current, [])

  // Smart hyperlink handling: http/https → external browser; local links are
  // resolved relative to the document and opened in the app (markdown) or with
  // the system default application. Works for plain clicks and Ctrl/Cmd+clicks.
  const handleLinkClick = useCallback(
    async (href: string) => {
      if (/^(https?:|mailto:)/i.test(href)) {
        await window.api.openExternal(href)
        return
      }
      if (href === '' || href.startsWith('#')) return

      let target = href
      if (target.startsWith('file://')) {
        try {
          target = decodeURIComponent(new URL(target).pathname)
          if (/^\/[A-Za-z]:/.test(target)) target = target.slice(1)
        } catch {
          return
        }
      }
      const clean = target.split('#')[0].split('?')[0]
      if (!clean) return

      let resolved = clean
      if (!isAbsolutePath(resolved)) {
        const dir = filePathRef.current ? dirNameFromPath(filePathRef.current) : null
        if (!dir) return
        resolved = `${dir}/${resolved}`
      }
      const exists = await window.api.pathExists(resolved)
      if (!exists) return
      if (isMarkdownFileName(resolved)) {
        await openPath(resolved)
      } else {
        await window.api.openLocalPath(resolved)
      }
    },
    [openPath]
  )

  const onEditorClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      event.preventDefault()
      void handleLinkClick(anchor.getAttribute('href') ?? '')
    },
    [handleLinkClick]
  )

  return (
    <div className="app">
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
          onCloseFolder={closeFolder}
          onCloseFile={(path) => void closeFile(path)}
          onOpenSearchResult={(path, index, query) => void openSearchResult(path, index, query)}
        />
      )}

      <main className="editor-area">
        {findOpen && (
          <FindBar
            getEditor={getEditor}
            sourceMode={sourceMode}
            sourceText={markdown}
            textareaRef={textareaRef}
            onClose={() => setFindOpen(false)}
          />
        )}
        <div
          className="editor-scroll"
          onClick={onEditorClick}
          onContextMenu={onEditorContextMenu}
          onScroll={() => setCtxMenu(null)}
        >
          {localeReady && (
            <div className={`wysiwyg-wrap${sourceMode ? ' hidden' : ''}`}>
              <Suspense fallback={<div className="editor-loading" />}>
                <MarkdownEditor
                  initialMarkdown={pendingContentRef.current ?? welcomeMarkdown(lang)}
                  onReady={handleEditorReady}
                  onChange={handleChange}
                  onOutline={handleOutline}
                  getDocPath={getDocPath}
                  isReadOnly={() => readOnlyRef.current}
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
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value)
                setDirty(true)
              }}
              spellCheck={false}
              autoFocus
            />
          )}
        </div>
        <StatusBar
          stats={stats}
          filePath={filePath}
          dirty={dirty}
          sourceMode={sourceMode}
          theme={theme}
          lang={lang}
          zoomLevel={zoomLevel}
          readOnly={readOnly}
          showSidebar={showSidebar}
          showOutline={showOutline}
          onToggleSidebar={() => setShowSidebar((v) => !v)}
          onToggleOutline={() => setShowOutline((v) => !v)}
          onToggleReadOnly={() => setReadOnlyMode(!readOnly)}
          onToggleSource={toggleSourceMode}
          onToggleTheme={() => setTheme((th) => (th === 'light' ? 'dark' : 'light'))}
          onToggleLang={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          onZoomIn={() => applyZoom(zoomRef.current + 0.5)}
          onZoomOut={() => applyZoom(zoomRef.current - 0.5)}
          onZoomReset={() => applyZoom(0)}
        />
      </main>

      {showOutline && (
        <OutlinePanel
          outline={outline}
          onNavigate={navigateOutline}
          width={outlineSidebar.width}
          onResizeStart={outlineSidebar.startResize}
          onResetWidth={outlineSidebar.resetWidth}
        />
      )}

      {ctxMenu && (
        <EditorContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          editor={editorRef.current}
          docPath={filePath}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
