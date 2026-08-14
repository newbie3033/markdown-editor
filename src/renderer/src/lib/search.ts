import type { Editor } from '@milkdown/kit/core'
import { editorStateCtx, editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/prose/state'
import { compileSearchRegex, type SearchFlags } from '../../../shared/ipc'

export interface TextMatch {
  from: number
  to: number
}

/**
 * Find all occurrences of `query` in the editor document, VS Code style
 * (case-sensitive / whole-word / regex options via `flags`).
 */
export function findTextMatches(editor: Editor, query: string, flags: SearchFlags = {}): TextMatch[] {
  const regex = compileSearchRegex(query, flags)
  if (!regex) return []
  const matches: TextMatch[] = []
  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    state.doc.descendants((node, pos) => {
      if (!node.isText) return
      const text = node.text ?? ''
      if (!text) return
      const re = compileSearchRegex(query, flags)
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
export function findInString(text: string, query: string, flags: SearchFlags = {}): TextMatch[] {
  const regex = compileSearchRegex(query, flags)
  if (!regex) return []
  const matches: TextMatch[] = []
  let execResult: RegExpExecArray | null
  while ((execResult = regex.exec(text)) !== null) {
    matches.push({ from: execResult.index, to: execResult.index + execResult[0].length })
    if (execResult[0].length === 0) regex.lastIndex += 1
  }
  return matches
}

/** Replace a single match inside the editor (positions are ProseMirror positions). */
export function replaceMatchInEditor(editor: Editor, match: TextMatch, replacement: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    const tr = state.tr.replaceWith(match.from, match.to, state.schema.text(replacement))
    view.dispatch(tr.scrollIntoView())
  })
}

/** Replace all matches inside the editor with a single transaction. */
export function replaceAllMatchesInEditor(
  editor: Editor,
  matches: TextMatch[],
  replacement: string
): void {
  if (matches.length === 0) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { state } = view
    let tr = state.tr
    const text = state.schema.text(replacement)
    // Replace from the end so earlier positions stay valid.
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      tr = tr.replaceWith(matches[i].from, matches[i].to, text)
    }
    view.dispatch(tr.scrollIntoView())
  })
}

/** Replace a single match in a plain string (source mode). */
export function replaceRangeInString(text: string, match: TextMatch, replacement: string): string {
  return text.slice(0, match.from) + replacement + text.slice(match.to)
}

/** Replace all matches in a plain string (source mode). */
export function replaceAllInString(
  text: string,
  matches: TextMatch[],
  replacement: string
): string {
  let out = text
  // Replace from the end so earlier offsets stay valid.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    out = out.slice(0, matches[i].from) + replacement + out.slice(matches[i].to)
  }
  return out
}
