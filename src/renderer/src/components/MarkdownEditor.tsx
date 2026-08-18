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
import { prism, prismConfig } from '@milkdown/plugin-prism'
import mermaidGrammar from 'refractor/mermaid'
import latexGrammar from 'refractor/latex'
import { codeBlockCopyPlugin } from '../lib/codeBlockCopy'
import { localImageViewPlugin } from '../lib/imageView'
import { createTyporaKeymap } from '../lib/typoraKeymap'
import {
  latexCodeBlockSchema,
  mathBlockInputRule,
  mathInlineInputRule,
  mathInlineSchema,
  normalizeDisplayMath,
  remarkMathBlockPlugin,
  remarkMathPlugin
} from '../lib/math'
import type { OutlineItem } from '../lib/markdown'
import { authorizeDroppedFile, isImageFileName, isMarkdownFileName } from '../lib/markdown'

interface EditorProps {
  initialMarkdown: string
  onReady: (editor: Editor) => void
  onChange: (markdown: string) => void
  onOutline: (items: OutlineItem[]) => void
  /** Saves an untitled document before creating a relative image asset. */
  ensureDocPath: () => Promise<string | null>
  /** Called when a markdown file is dropped/pasted into the editor. */
  onOpenDocument: (path: string) => void
  /** Called when a folder is dropped into the editor. */
  onOpenFolder: (path: string) => void
  /** Whether the editor is in read-only mode (blocks image insertion). */
  isReadOnly: () => boolean
  onImageError: (error: unknown) => void
}

function InnerEditor({
  initialMarkdown,
  onReady,
  onChange,
  onOutline,
  ensureDocPath,
  onOpenDocument,
  onOpenFolder,
  isReadOnly,
  onImageError
}: EditorProps): React.JSX.Element {
  const initialRef = useRef(initialMarkdown)
  const onReadyRef = useRef(onReady)
  const onChangeRef = useRef(onChange)
  const onOutlineRef = useRef(onOutline)
  const ensureDocPathRef = useRef(ensureDocPath)
  const onOpenDocumentRef = useRef(onOpenDocument)
  const onOpenFolderRef = useRef(onOpenFolder)
  const isReadOnlyRef = useRef(isReadOnly)
  const onImageErrorRef = useRef(onImageError)
  onReadyRef.current = onReady
  onChangeRef.current = onChange
  onOutlineRef.current = onOutline
  ensureDocPathRef.current = ensureDocPath
  onOpenDocumentRef.current = onOpenDocument
  onOpenFolderRef.current = onOpenFolder
  isReadOnlyRef.current = isReadOnly
  onImageErrorRef.current = onImageError

  const uploaderRef = useRef<Uploader | null>(null)
  if (!uploaderRef.current) {
    uploaderRef.current = async (files: FileList, schema) => {
      const nodes = []
      for (let i = 0; i < files.length; i++) {
        const file = files.item(i)
        if (!file) continue
        const name = file.name
        const dropped = await authorizeDroppedFile(file)
        const path = dropped?.path ?? ''

        // Folders dropped into the editor are opened in the sidebar.
        if (dropped?.isDirectory) {
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

        try {
          const docPath = await ensureDocPathRef.current()
          if (!docPath) continue
          const result = await window.api.saveImage(
            dropped?.path
              ? { sourcePath: dropped.path, docPath }
              : { data: await file.arrayBuffer(), name: file.name, docPath }
          )
          const src = result?.src
          if (!src) continue
          const node = schema.nodes.image?.create({ src, alt: file.name })
          if (node) nodes.push(node)
        } catch (error) {
          onImageErrorRef.current(error)
        }
      }
      return nodes
    }
  }

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, normalizeDisplayMath(initialRef.current))
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
        .use(remarkMathPlugin)
        .use(remarkMathBlockPlugin)
        .use(mathInlineSchema)
        .use(mathInlineInputRule)
        .use(mathBlockInputRule)
        .use(latexCodeBlockSchema)
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
        .use(localImageViewPlugin)
        .config((ctx) => {
          ctx.update(prismConfig.key, (prev) => ({
            ...prev,
            configureRefractor: (instance) => {
              const configured = prev.configureRefractor(instance) ?? instance
              if (!configured.registered('mermaid')) configured.register(mermaidGrammar)
              if (!configured.registered('latex')) configured.register(latexGrammar)
              configured.alias('mermaid', [
                'flowchart',
                'graph',
                'sequence',
                'sequencediagram',
                'class',
                'classdiagram',
                'state',
                'statediagram',
                'er',
                'erdiagram',
                'gantt',
                'pie',
                'journey',
                'mindmap',
                'timeline',
                'gitgraph',
                'quadrantchart',
                'xychart',
                'block',
                'sankey',
                'packet',
                'requirement',
                'c4context'
              ])
              configured.alias('latex', 'LaTeX')
              return configured
            }
          }))
        })
        .use(prism)
        // Typora-style shortcuts (Ctrl+1..6 headings, Ctrl+K link, Ctrl+Shift+K
        // code fence, Ctrl+T table, Ctrl+Shift+I image, Ctrl+\\ clear format, …).
        .use(
          createTyporaKeymap({
            isReadOnly: () => isReadOnlyRef.current(),
            ensureDocPath: () => ensureDocPathRef.current(),
            onImageError: (error) => onImageErrorRef.current(error)
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
