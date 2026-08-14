import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx, commandsCtx } from '@milkdown/kit/core'
import { callCommand } from '@milkdown/kit/utils'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'

export type ContextMenuAction =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'image'
  | 'quote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'table'
  | 'hr'
  | 'paragraph'

function focusEditor(editor: Editor): void {
  editor.action((ctx) => {
    ctx.get(editorViewCtx).focus()
  })
}

/** Insert an image block at the end of the document (used for window-level drops). */
export function appendImage(editor: Editor, src: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { image, paragraph } = state.schema.nodes
    if (!image || !paragraph) return
    const img = image.create({ src })
    const para = paragraph.create(null, img)
    view.dispatch(state.tr.insert(state.doc.content.size, para).scrollIntoView())
  })
  focusEditor(editor)
}

function applyLink(editor: Editor, href: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const { from, to, empty } = state.selection
    const linkType = state.schema.marks.link
    if (!linkType) return
    const linkMark = linkType.create({ href })
    if (!empty) {
      // Wrap the current selection in the link mark (toggling if already linked).
      const hasLink = state.doc.rangeHasMark(from, to, linkType)
      const tr = hasLink
        ? state.tr.removeMark(from, to, linkMark)
        : state.tr.addMark(from, to, linkMark)
      view.dispatch(tr.scrollIntoView())
      return
    }
    // Empty selection: insert the URL text and link it.
    const tr = state.tr
    tr.insertText(href, from)
    tr.addMark(from, from + href.length, linkMark)
    view.dispatch(tr.scrollIntoView())
  })
  focusEditor(editor)
}

function applyTaskList(editor: Editor): void {
  editor.action((ctx) => {
    const commands = ctx.get(commandsCtx)
    commands.call(wrapInBulletListCommand.key)
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const $pos = state.doc.resolve(state.selection.from)
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name === 'list_item') {
        const tr = state.tr.setNodeMarkup($pos.before(depth), null, {
          ...node.attrs,
          checked: false
        })
        view.dispatch(tr.scrollIntoView())
        return
      }
    }
  })
  focusEditor(editor)
}

export function runContextAction(
  editor: Editor,
  action: ContextMenuAction,
  options: { linkHref?: string; imageSrc?: string } = {}
): void {
  switch (action) {
    case 'h1':
      editor.action(callCommand(wrapInHeadingCommand.key, 1))
      break
    case 'h2':
      editor.action(callCommand(wrapInHeadingCommand.key, 2))
      break
    case 'h3':
      editor.action(callCommand(wrapInHeadingCommand.key, 3))
      break
    case 'bold':
      editor.action(callCommand(toggleStrongCommand.key))
      break
    case 'italic':
      editor.action(callCommand(toggleEmphasisCommand.key))
      break
    case 'strikethrough':
      editor.action(callCommand(toggleStrikethroughCommand.key))
      break
    case 'inlineCode':
      editor.action(callCommand(toggleInlineCodeCommand.key))
      break
    case 'quote':
      editor.action(callCommand(wrapInBlockquoteCommand.key))
      break
    case 'codeBlock':
      editor.action(callCommand(createCodeBlockCommand.key, ''))
      break
    case 'bulletList':
      editor.action(callCommand(wrapInBulletListCommand.key))
      break
    case 'orderedList':
      editor.action(callCommand(wrapInOrderedListCommand.key))
      break
    case 'table':
      editor.action(callCommand(insertTableCommand.key, { row: 3, col: 3 }))
      break
    case 'hr':
      editor.action(callCommand(insertHrCommand.key))
      break
    case 'paragraph':
      editor.action(callCommand(turnIntoTextCommand.key))
      break
    case 'link':
      if (options.linkHref) {
        applyLink(editor, options.linkHref)
      }
      break
    case 'image':
      if (options.imageSrc) {
        editor.action(callCommand(insertImageCommand.key, { src: options.imageSrc }))
        focusEditor(editor)
      }
      break
    case 'taskList':
      applyTaskList(editor)
      return
  }
  focusEditor(editor)
}
