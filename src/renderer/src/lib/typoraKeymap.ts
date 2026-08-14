import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { type Ctx, type MilkdownPlugin } from '@milkdown/kit/ctx'
import {
  createCodeBlockCommand,
  insertImageCommand,
  liftListItemCommand,
  toggleInlineCodeCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { keymap } from '@milkdown/prose/keymap'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { $prose } from '@milkdown/kit/utils'
import { applyLinkToCtx } from './commands'
import { tStatic } from './i18n'

export interface TyporaKeymapOptions {
  /** Path of the currently open document (used to store picked images). */
  getDocPath: () => string | null
  /** Whether the editor is in read-only mode (blocks image insertion). */
  isReadOnly: () => boolean
}

/**
 * Typora-compatible keyboard shortcuts on top of Milkdown's defaults.
 *
 *   Ctrl+1..6      headings 1-6      Ctrl+Shift+K  code fence
 *   Ctrl+0         paragraph         Ctrl+Shift+Q  blockquote
 *   Ctrl+= / Ctrl+- increase/decrease heading level
 *   Ctrl+Shift+`   inline code       Alt+Shift+5   strikethrough
 *   Ctrl+K         hyperlink         Ctrl+Shift+I  insert image
 *   Ctrl+Shift+[ / Ctrl+Shift+]      ordered / unordered list
 *   Ctrl+T         table             Ctrl+\\     clear format
 *
 * The keymap plugin is appended after the presets; none of these keys collide
 * with Milkdown's default bindings (Mod-b, Mod-i, Mod-e, Mod-Alt-*, …).
 */
export function createTyporaKeymap(options: TyporaKeymapOptions): MilkdownPlugin {
  return $prose((ctx: Ctx) => {
    const commands = ctx.get(commandsCtx)

    const headingLevelAt = (state: EditorState): number => {
      const $pos = state.doc.resolve(state.selection.from)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth)
        if (node.type.name === 'heading' && typeof node.attrs.level === 'number') {
          return node.attrs.level
        }
      }
      return 0
    }

    const isListItem = (state: EditorState): boolean => {
      const $pos = state.doc.resolve(state.selection.from)
      for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type.name === 'list_item') return true
      }
      return false
    }

    // Like Typora: block conversions lift the item out of its list first so a
    // paragraph/heading never has to live inside a list.
    const liftListItem = (state: EditorState): void => {
      if (isListItem(state)) commands.call(liftListItemCommand.key)
    }

    const toParagraph = (state: EditorState): boolean => {
      liftListItem(state)
      return commands.call(turnIntoTextCommand.key)
    }

    const wrapHeading = (level: number) => (state: EditorState): boolean => {
      liftListItem(state)
      return commands.call(wrapInHeadingCommand.key, level)
    }

    const increaseHeading = (state: EditorState): boolean => {
      liftListItem(state)
      return commands.call(wrapInHeadingCommand.key, Math.min(6, headingLevelAt(state) + 1))
    }

    const decreaseHeading = (state: EditorState): boolean => {
      const level = headingLevelAt(state)
      if (level > 1) {
        liftListItem(state)
        return commands.call(wrapInHeadingCommand.key, level - 1)
      }
      return toParagraph(state)
    }

    const linkShortcut = (): boolean => {
      const href = window.prompt(tStatic('ctx.linkPrompt'), 'https://')
      if (!href || !href.trim()) return false
      applyLinkToCtx(ctx, href.trim())
      return true
    }

    const clearFormat = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      const { from, to } = state.selection
      let tr = state.tr
      let changed = false
      for (const markType of Object.values(state.schema.marks)) {
        if (state.doc.rangeHasMark(from, to, markType)) {
          tr = tr.removeMark(from, to, markType)
          changed = true
        }
      }
      if (!changed) return false
      if (dispatch) dispatch(tr.scrollIntoView())
      return true
    }

    const imageShortcut = (): boolean => {
      if (options.isReadOnly()) return false
      void (async () => {
        const picked = await window.api.pickImage()
        if (picked.canceled || !picked.path) return
        const name = picked.path.split(/[\\/]/).pop() ?? 'image.png'
        const result = await window.api.saveImage({
          sourcePath: picked.path,
          name,
          docPath: options.getDocPath()
        })
        if (result) {
          ctx.get(commandsCtx).call(insertImageCommand.key, { src: result.src })
          ctx.get(editorViewCtx).focus()
        }
      })()
      return true
    }

    return keymap({
      'Mod-1': wrapHeading(1),
      'Mod-2': wrapHeading(2),
      'Mod-3': wrapHeading(3),
      'Mod-4': wrapHeading(4),
      'Mod-5': wrapHeading(5),
      'Mod-6': wrapHeading(6),
      'Mod-0': toParagraph,
      'Mod-=': increaseHeading,
      'Mod--': decreaseHeading,
      'Shift-Mod-k': () => commands.call(createCodeBlockCommand.key, ''),
      'Shift-Mod-q': () => commands.call(wrapInBlockquoteCommand.key),
      'Shift-Mod-`': () => commands.call(toggleInlineCodeCommand.key),
      'Alt-Shift-5': () => commands.call(toggleStrikethroughCommand.key),
      'Mod-k': linkShortcut,
      'Shift-Mod-[': () => commands.call(wrapInOrderedListCommand.key),
      'Shift-Mod-]': () => commands.call(wrapInBulletListCommand.key),
      'Mod-t': () => commands.call(insertTableCommand.key, { row: 3, col: 3 }),
      'Mod-\\': clearFormat,
      'Shift-Mod-i': imageShortcut
    })
  })
}
