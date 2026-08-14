import type { Editor } from '@milkdown/kit/core'
import { editorStateCtx, editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/prose/state'
import { compileSearchRegex, type SearchMode } from '../../../shared/ipc'

export interface TextMatch {
  from: number
  to: number
}

/**
 * Find all case-insensitive occurrences of `query` in the editor document.
 * Supports plain text, wildcard (`*`/`?`) and regex modes.
 */
export function findTextMatches(editor: Editor, query: string, mode: SearchMode = 'text'): TextMatch[] {
  const regex = compileSearchRegex(query, mode)
  if (!regex) return []
  const matches: TextMatch[] = []
  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text ?? ''
      if (!text) return
      const re = compileSearchRegex(query, mode)
      if (!re) return
      let execResult: RegExpExecArray | null
      while ((execResult = re.exec(text)) !== null) {
        matches.push({ from: pos + execResult.index, to: pos + execResult.index + execResult[0].length })
        if (execResult[0].length === 0) re.lastIndex += 1
      }
    })
  })
  return matches
}

/** Select (and scroll to) a match inside the editor. */
export function selectMatch(editor: Editor, match: TextMatch, focus = true): void {
  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    const view = ctx.get(editorViewCtx)
    const selection = TextSelection.create(state.doc, match.from, match.to)
    // Focus first so the DOM selection is reflected immediately.
    if (focus) view.focus()
    view.dispatch(state.tr.setSelection(selection).scrollIntoView())
  })
}

/** Find all occurrences in a plain string (source mode). */
export function findInString(text: string, query: string, mode: SearchMode = 'text'): TextMatch[] {
  const regex = compileSearchRegex(query, mode)
  if (!regex) return []
  const matches: TextMatch[] = []
  let execResult: RegExpExecArray | null
  while ((execResult = regex.exec(text)) !== null) {
    matches.push({ from: execResult.index, to: execResult.index + execResult[0].length })
    if (execResult[0].length === 0) regex.lastIndex += 1
  }
  return matches
}
