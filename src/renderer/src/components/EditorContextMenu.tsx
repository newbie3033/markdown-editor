import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Editor } from '@milkdown/kit/core'
import { useI18n } from '../lib/i18n'
import { runContextAction, type ContextMenuAction } from '../lib/commands'

interface EditorContextMenuProps {
  x: number
  y: number
  editor: Editor | null
  docPath: string | null
  onClose: () => void
}

interface Item {
  action: ContextMenuAction
  labelKey: 'ctx.h1' | 'ctx.h2' | 'ctx.h3' | 'ctx.bold' | 'ctx.italic' | 'ctx.strikethrough' | 'ctx.inlineCode' | 'ctx.link' | 'ctx.image' | 'ctx.quote' | 'ctx.codeBlock' | 'ctx.bulletList' | 'ctx.orderedList' | 'ctx.taskList' | 'ctx.table' | 'ctx.hr' | 'ctx.paragraph'
  shortcut?: string
}

const GROUPS: Item[][] = [
  [
    { action: 'h1', labelKey: 'ctx.h1', shortcut: 'Ctrl+1' },
    { action: 'h2', labelKey: 'ctx.h2', shortcut: 'Ctrl+2' },
    { action: 'h3', labelKey: 'ctx.h3', shortcut: 'Ctrl+3' }
  ],
  [
    { action: 'bold', labelKey: 'ctx.bold', shortcut: 'Ctrl+B' },
    { action: 'italic', labelKey: 'ctx.italic', shortcut: 'Ctrl+I' },
    { action: 'strikethrough', labelKey: 'ctx.strikethrough' },
    { action: 'inlineCode', labelKey: 'ctx.inlineCode' }
  ],
  [
    { action: 'link', labelKey: 'ctx.link', shortcut: 'Ctrl+K' },
    { action: 'image', labelKey: 'ctx.image' }
  ],
  [
    { action: 'quote', labelKey: 'ctx.quote' },
    { action: 'codeBlock', labelKey: 'ctx.codeBlock' }
  ],
  [
    { action: 'bulletList', labelKey: 'ctx.bulletList' },
    { action: 'orderedList', labelKey: 'ctx.orderedList' },
    { action: 'taskList', labelKey: 'ctx.taskList' }
  ],
  [
    { action: 'table', labelKey: 'ctx.table' },
    { action: 'hr', labelKey: 'ctx.hr' },
    { action: 'paragraph', labelKey: 'ctx.paragraph' }
  ]
]

export function EditorContextMenu({
  x,
  y,
  editor,
  docPath,
  onClose
}: EditorContextMenuProps): React.JSX.Element {
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement>(null)

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

  const handleClick = (item: Item): void => {
    onClose()
    if (!editor) return

    if (item.action === 'link') {
      const url = window.prompt(t('ctx.linkPrompt'), 'https://')
      if (url && url.trim()) {
        runContextAction(editor, 'link', { linkHref: url.trim() })
      }
      return
    }

    if (item.action === 'image') {
      void (async () => {
        const picked = await window.api.pickImage()
        if (picked.canceled || !picked.path) return
        const name = picked.path.split(/[\\/]/).pop() ?? 'image.png'
        const result = await window.api.saveImage({
          sourcePath: picked.path,
          name,
          docPath
        })
        if (result) {
          runContextAction(editor, 'image', { imageSrc: result.src })
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
      {GROUPS.map((group, groupIndex) => (
        <div key={groupIndex}>
          {groupIndex > 0 && <div className="ctx-separator" />}
          {group.map((item) => (
            <button key={item.action} className="ctx-item" onClick={() => handleClick(item)}>
              <span className="ctx-label">{t(item.labelKey)}</span>
              {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
