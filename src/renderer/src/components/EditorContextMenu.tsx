import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { editorStateCtx, editorViewCtx } from '@milkdown/kit/core'
import { useI18n } from '../lib/i18n'
import { runContextAction, type ContextMenuAction } from '../lib/commands'

interface EditorContextMenuProps {
  x: number
  y: number
  editor: Editor | null
  showPreviewSourceToggle: boolean
  previewSourceVisible: boolean
  onTogglePreviewSource: () => void
  ensureDocPath: () => Promise<string | null>
  onImageError: (error: unknown) => void
  onClose: () => void
}

interface Item {
  action: ContextMenuAction
  labelKey: 'ctx.copy' | 'ctx.cut' | 'ctx.paste' | 'ctx.h1' | 'ctx.h2' | 'ctx.h3' | 'ctx.bold' | 'ctx.italic' | 'ctx.strikethrough' | 'ctx.inlineCode' | 'ctx.link' | 'ctx.image' | 'ctx.quote' | 'ctx.codeBlock' | 'ctx.bulletList' | 'ctx.orderedList' | 'ctx.taskList' | 'ctx.table' | 'ctx.hr' | 'ctx.paragraph'
  shortcut?: string
}

const GROUPS: Item[][] = [
  [
    { action: 'copy', labelKey: 'ctx.copy', shortcut: 'Ctrl+C' },
    { action: 'cut', labelKey: 'ctx.cut', shortcut: 'Ctrl+X' },
    { action: 'paste', labelKey: 'ctx.paste', shortcut: 'Ctrl+V' }
  ],
  [
    { action: 'h1', labelKey: 'ctx.h1', shortcut: 'Ctrl+1' },
    { action: 'h2', labelKey: 'ctx.h2', shortcut: 'Ctrl+2' },
    { action: 'h3', labelKey: 'ctx.h3', shortcut: 'Ctrl+3' }
  ],
  [
    { action: 'bold', labelKey: 'ctx.bold', shortcut: 'Ctrl+B' },
    { action: 'italic', labelKey: 'ctx.italic', shortcut: 'Ctrl+I' },
    { action: 'strikethrough', labelKey: 'ctx.strikethrough', shortcut: 'Alt+Shift+5' },
    { action: 'inlineCode', labelKey: 'ctx.inlineCode', shortcut: 'Ctrl+Shift+`' }
  ],
  [
    { action: 'link', labelKey: 'ctx.link', shortcut: 'Ctrl+K' },
    { action: 'image', labelKey: 'ctx.image', shortcut: 'Ctrl+Shift+I' }
  ],
  [
    { action: 'quote', labelKey: 'ctx.quote', shortcut: 'Ctrl+Shift+Q' },
    { action: 'codeBlock', labelKey: 'ctx.codeBlock', shortcut: 'Ctrl+Shift+K' }
  ],
  [
    { action: 'bulletList', labelKey: 'ctx.bulletList', shortcut: 'Ctrl+Shift+]' },
    { action: 'orderedList', labelKey: 'ctx.orderedList', shortcut: 'Ctrl+Shift+[' },
    { action: 'taskList', labelKey: 'ctx.taskList' }
  ],
  [
    { action: 'table', labelKey: 'ctx.table', shortcut: 'Ctrl+T' },
    { action: 'hr', labelKey: 'ctx.hr' },
    { action: 'paragraph', labelKey: 'ctx.paragraph', shortcut: 'Ctrl+0' }
  ]
]

export function EditorContextMenu({
  x,
  y,
  editor,
  showPreviewSourceToggle,
  previewSourceVisible,
  onTogglePreviewSource,
  ensureDocPath,
  onImageError,
  onClose
}: EditorContextMenuProps): React.JSX.Element {
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement>(null)
  // Whether the editor selection is non-empty when the menu opened (drives
  // the disabled state of Copy / Cut).
  const [hasSelection, setHasSelection] = useState(false)

  useEffect(() => {
    if (!editor) return
    editor.action((ctx) => {
      setHasSelection(!ctx.get(editorStateCtx).selection.empty)
    })
  }, [editor, x, y])

  // Clamp the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }, [x, y])

  // Close on outside click / Escape / window blur.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onBlur = (): void => onClose()
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  const handleClick = async (item: Item): Promise<void> => {
    onClose()
    if (!editor) return

    if (item.action === 'copy' || item.action === 'cut') {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const { from, to } = state.selection
        const text = state.doc.textBetween(from, to, '\n', ' ')
        if (!text) return
        void window.api.copyText(text)
        if (item.action === 'cut') {
          view.dispatch(state.tr.deleteSelection().scrollIntoView())
          view.focus()
        }
      })
      return
    }

    if (item.action === 'paste') {
      const text = await window.api.readClipboardText()
      if (!text) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state } = view
        view.dispatch(state.tr.replaceSelectionWith(state.schema.text(text)).scrollIntoView())
        view.focus()
      })
      return
    }

    if (item.action === 'link') {
      const url = window.prompt(t('ctx.linkPrompt'), 'https://')
      if (url && url.trim()) {
        runContextAction(editor, 'link', { linkHref: url.trim() })
      }
      return
    }

    if (item.action === 'image') {
      void (async () => {
        try {
          const picked = await window.api.pickImage()
          if (picked.canceled || !picked.path) return
          const docPath = await ensureDocPath()
          if (!docPath) return
          const imported = await window.api.saveImage({ sourcePath: picked.path, docPath })
          if (imported) runContextAction(editor, 'image', { imageSrc: imported.src })
        } catch (error) {
          onImageError(error)
        }
      })()
      return
    }

    runContextAction(editor, item.action)
  }

  return (
    <div
      className="ctx-menu"
      ref={menuRef}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {showPreviewSourceToggle && (
        <div>
          <button
            className="ctx-item"
            onClick={() => {
              onClose()
              onTogglePreviewSource()
            }}
          >
            <span className="ctx-label">
              {t(previewSourceVisible ? 'ctx.hidePreviewSource' : 'ctx.showPreviewSource')}
            </span>
          </button>
          <div className="ctx-separator" />
        </div>
      )}
      {GROUPS.map((group, groupIndex) => (
        <div key={groupIndex}>
          {groupIndex > 0 && <div className="ctx-separator" />}
          {group.map((item) => (
            <button
              key={item.action}
              className="ctx-item"
              disabled={(item.action === 'copy' || item.action === 'cut') && !hasSelection}
              onClick={() => void handleClick(item)}
            >
              <span className="ctx-label">{t(item.labelKey)}</span>
              {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
