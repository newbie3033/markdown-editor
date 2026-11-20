import { diffChars, diffLines, type Change } from 'diff'

interface Replacement {
  from: number
  to: number
  text: string
}

function replacements(changes: Change[]): Replacement[] {
  const result: Replacement[] = []
  let offset = 0
  let pending: Replacement | undefined
  for (const change of changes) {
    if (change.added || change.removed) {
      if (!pending) {
        pending = { from: offset, to: offset, text: '' }
        result.push(pending)
      }
      if (change.added) pending.text += change.value
      else pending.to = offset + change.value.length
    } else {
      pending = undefined
    }
    if (!change.added) offset += change.value.length
  }
  return result
}

function merge(
  baseline: string,
  sourceChanges: Change[],
  editChanges: Change[],
  includeBoundaries: boolean
): string {
  const edits = replacements(editChanges)
  let firstEdit = 0
  const preserved = replacements(sourceChanges).filter((source) => {
    // At character boundaries an insertion can coexist with a neighboring
    // replacement. At line granularity, prefer the editor for touching hunks.
    while (edits[firstEdit] && edits[firstEdit].to < source.from) firstEdit++
    for (let index = firstEdit; index < edits.length; index++) {
      const edit = edits[index]
      if (edit.from > source.to) break
      if (includeBoundaries) return false
      if (edit.from === edit.to && source.from === source.to && edit.from === source.from) return false
      if (edit.from < source.to && source.from < edit.to) return false
    }
    return true
  })
  const patches = [...preserved, ...edits].sort((a, b) => a.from - b.from || a.to - b.to)
  const parts: string[] = []
  let offset = 0
  for (const patch of patches) {
    parts.push(baseline.slice(offset, patch.from), patch.text)
    offset = patch.to
  }
  parts.push(baseline.slice(offset))
  return parts.join('')
}

/**
 * Carry original Markdown spelling forward when the visual editor changes its
 * document. Both diffs use the same serialized baseline, so only overlapping
 * edits need to take precedence over the source spelling.
 */
export function preserveMarkdownSource(
  source: string,
  baseline: string,
  edited: string,
  equivalent: (candidate: string) => boolean
): string {
  if (edited === baseline) return source
  if (source === baseline) return edited

  // Keep a uniform line-ending style for inserted lines too. Comparing LF
  // strings also avoids treating every line as a formatter change.
  let newline = '\n'
  if (source.includes('\r') && !/(?<!\r)\n/.test(source)) {
    if (!/\r(?!\n)/.test(source)) newline = '\r\n'
    else if (!source.includes('\r\n')) newline = '\r'
  }
  const sourceText = newline === '\n' ? source : normalizeTextareaLineEndings(source)
  const restoreLineEndings = (text: string) => newline === '\n' ? text : text.replace(/\n/g, newline)
  if (sourceText === baseline) return restoreLineEndings(edited)

  const diffFunctions: Array<(before: string, after: string, options: { timeout: number }) => Change[] | undefined> = [
    diffChars, diffLines
  ]
  for (const diff of diffFunctions) {
    const sourceChanges = diff(baseline, sourceText, { timeout: 40 })
    const editChanges = diff(baseline, edited, { timeout: 40 })
    if (!sourceChanges || !editChanges) continue
    const candidate = merge(baseline, sourceChanges, editChanges, diff === diffLines)
    if (candidate === edited || equivalent(candidate)) return restoreLineEndings(candidate)
  }
  return restoreLineEndings(edited)
}

export const normalizeTextareaLineEndings = (text: string): string => text.replace(/\r\n?/g, '\n')
