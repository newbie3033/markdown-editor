import { useEffect, useRef } from 'react'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { cursor } from '@milkdown/kit/plugin/cursor'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { indent } from '@milkdown/kit/plugin/indent'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload'
import { outline } from '@milkdown/kit/utils'
import { prism } from '@milkdown/plugin-prism'
import { codeBlockCopyPlugin } from '../lib/codeBlockCopy'
import { createTyporaKeymap } from '../lib/typoraKeymap'
import type { OutlineItem } from '../lib/markdown'
import { filePathOf, isImageFileName, isMarkdownFileName } from '../lib/markdown'

interface EditorProps {
  initialMarkdown: string
  onReady: (editor: Editor) => void
  onChange: (markdown: string) => void
  onOutline: (items: OutlineItem[]) => void
  /** Returns the path of the currently open document (or null). */
  getDocPath: () => string | null
  /** Called when a markdown file is dropped/pasted into the editor. */
  onOpenDocument: (path: string) => void
  /** Called when a folder is dropped into the editor. */
  onOpenFolder: (path: string) => void
  /** Whether the editor is in read-only mode (blocks image insertion). */
  isReadOnly: () => boolean
}

function InnerEditor({
  initialMarkdown,
  onReady,
  onChange,
  onOutline,
  getDocPath,
  onOpenDocument,
  onOpenFolder,
  isReadOnly
}: EditorProps): React.JSX.Element {
  const initialRef = useRef(initialMarkdown)
  const onReadyRef = useRef(onReady)
  const onChangeRef = useRef(onChange)
  const onOutlineRef = useRef(onOutline)
  const getDocPathRef = useRef(getDocPath)
  const onOpenDocumentRef = useRef(onOpenDocument)
  const onOpenFolderRef = useRef(onOpenFolder)
  const isReadOnlyRef = useRef(isReadOnly)
  onReadyRef.current = onReady
  onChangeRef.current = onChange
  onOutlineRef.current = onOutline
  getDocPathRef.current = getDocPath
  onOpenDocumentRef.current = onOpenDocument
  onOpenFolderRef.current = onOpenFolder
  isReadOnlyRef.current = isReadOnly

  const uploaderRef = useRef<Uploader | null>(null)
  if (!uploaderRef.current) {
    uploaderRef.current = async (files: FileList, schema) => {
      const nodes = []
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i)
        if (!file) continue
        const name = file.name
        const path = filePathOf(file)

        // Folders dropped into the editor are opened in the sidebar.
        if (path && (await window.api.pathIsDirectory(path))) {
          onOpenFolderRef.current(path)
          continue
        }

        // Markdown documents dropped/pasted into the editor are opened.
        if (path && isMarkdownFileName(name)) {
          onOpenDocumentRef.current(path)
          continue
        }

        if (!(file.type.startsWith('image/') || isImageFileName(name))) continue
        if (isReadOnlyRef.current()) continue

        const data = path ? null : await file.arrayBuffer()
        const result = await window.api.saveImage({
          sourcePath: path || null,
          data,
          name: file.name,
          docPath: getDocPathRef.current()
        })
        if (!result) continue
        const node = schema.nodes.image?.create({ src: result.src, alt: file.name })
        if (node) nodes.push(node)
      }
      return nodes
    }
  }

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, initialRef.current)
          ctx.set(editorViewOptionsCtx, {
            attributes: {
              class: 'md-body',
              spellcheck: 'false'
            }
          })
          ctx.update(uploadConfig.key, (prev) => ({
            ...prev,
            uploader: uploaderRef.current as Uploader,
            enableHtmlFileUploader: true
          }))
          ctx.get(listenerCtx).markdownUpdated((ctx, markdown) => {
            onChangeRef.current(markdown)
            onOutlineRef.current(outline()(ctx))
          })
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        // The upload plugin must be registered before the cursor plugin:
        // the drop indicator (cursor) intercepts drops, so file drops would
        // otherwise never reach the uploader.
        .use(upload)
        .use(cursor)
        .use(trailing)
        .use(indent)
        .use(listener)
        .use(codeBlockCopyPlugin)
        .use(prism)
        // Typora-style shortcuts (Ctrl+1..6 headings, Ctrl+K link, Ctrl+Shift+K
        // code fence, Ctrl+T table, Ctrl+Shift+I image, Ctrl+\\ clear format, …).
        .use(
          createTyporaKeymap({
            getDocPath: () => getDocPathRef.current(),
            isReadOnly: () => isReadOnlyRef.current()
          })
        ),
    []
  )

  const [loading, getInstance] = useInstance()

  useEffect(() => {
    if (!loading) {
      const editor = getInstance()
      if (editor) onReadyRef.current(editor)
    }
  }, [loading, getInstance])

  return <Milkdown />
}

export function MarkdownEditor(props: EditorProps): React.JSX.Element {
  return (
    <MilkdownProvider>
      <InnerEditor {...props} />
    </MilkdownProvider>
  )
}
