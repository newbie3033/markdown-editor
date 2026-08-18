import katex from 'katex'
import remarkMath from 'remark-math'
import { visit } from 'unist-util-visit'
import type { Node } from '@milkdown/kit/transformer'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { nodeRule } from '@milkdown/kit/prose'
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule, $nodeSchema, $remark } from '@milkdown/kit/utils'

/**
 * remark-math only treats display-math fences as blocks when both `$$`
 * markers occupy their own lines. Accept the common compact forms too, while
 * leaving examples inside fenced code blocks untouched.
 */
export function normalizeDisplayMath(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const normalized: string[] = []
  let codeFence: { marker: '`' | '~'; length: number } | null = null
  let mathIndent: string | null = null

  for (const line of lines) {
    if (mathIndent !== null) {
      const closingIndex = line.lastIndexOf('$$')
      if (closingIndex < 0) {
        normalized.push(line)
        continue
      }

      const before = line.slice(0, closingIndex)
      const after = line.slice(closingIndex + 2)
      if (before.trim()) normalized.push(before)
      normalized.push(`${mathIndent}$$`)
      if (after.trim()) normalized.push(`${mathIndent}${after.trimStart()}`)
      mathIndent = null
      continue
    }

    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      const marker = fenceMatch[2][0] as '`' | '~'
      if (!codeFence) {
        codeFence = { marker, length: fenceMatch[2].length }
      } else if (
        codeFence.marker === marker &&
        fenceMatch[2].length >= codeFence.length &&
        fenceMatch[3].trim() === ''
      ) {
        codeFence = null
      }
      normalized.push(line)
      continue
    }
    if (codeFence) {
      normalized.push(line)
      continue
    }

    const opening = line.match(/^(\s*)\$\$(.*)$/)
    if (!opening) {
      normalized.push(line)
      continue
    }

    const indent = opening[1]
    const rest = opening[2]
    if (!rest.trim()) {
      normalized.push(line)
      mathIndent = indent
      continue
    }

    const closingIndex = rest.lastIndexOf('$$')
    normalized.push(`${indent}$$`)
    if (closingIndex >= 0) {
      const formula = rest.slice(0, closingIndex)
      const after = rest.slice(closingIndex + 2)
      if (formula.trim()) normalized.push(`${indent}${formula}`)
      normalized.push(`${indent}$$`)
      if (after.trim()) normalized.push(`${indent}${after.trimStart()}`)
    } else {
      normalized.push(`${indent}${rest}`)
      mathIndent = indent
    }
  }

  return normalized.join('\n')
}

/** Parse standard Markdown math syntax (`$...$` and `$$...$$`). */
export const remarkMathPlugin = $remark<'remarkMath', undefined>(
  'remarkMath',
  () => remarkMath
)

/** Keep block math in the editor's existing code-block model. */
export const remarkMathBlockPlugin = $remark(
  'remarkMathBlock',
  () => () => (tree: unknown) => {
    visit(
      tree as Node,
      'math',
      (
        node: Node & { value: string },
        index: number,
        parent: Node & { children: Node[] }
      ) => {
        if (index === null || !parent || typeof node.value !== 'string') return
        parent.children.splice(
          index,
          1,
          { type: 'code', lang: 'LaTeX', value: node.value } as Node
        )
      }
    )
  }
)

export const mathInlineSchema = $nodeSchema('math_inline', () => ({
  group: 'inline',
  inline: true,
  draggable: true,
  atom: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-type="math_inline"]',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }),
    },
  ],
  toDOM: (node) => {
    const dom = document.createElement('span')
    dom.dataset.type = 'math_inline'
    dom.dataset.value = String(node.attrs.value ?? '')
    dom.className = 'inkmark-math-inline'
    dom.innerHTML = renderMath(String(node.attrs.value ?? ''), false)
    return dom
  },
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => state.addNode(type, { value: node.value as string }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => state.addNode('inlineMath', undefined, node.attrs.value),
  },
}))

/** Serialize LaTeX blocks back to `$$...$$` instead of a fenced code block. */
export const latexCodeBlockSchema = codeBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const baseSchema = prev(ctx)
    return {
      ...baseSchema,
      toMarkdown: {
        match: baseSchema.toMarkdown.match,
        runner: (state, node) => {
          const language = String(node.attrs.language ?? '').toLowerCase()
          if (language === 'latex' || language === 'tex' || language === 'math') {
            state.addNode('math', undefined, node.content.firstChild?.text || '')
            return
          }
          baseSchema.toMarkdown.runner(state, node)
        },
      },
    }
  }
})

export const mathInlineInputRule = $inputRule((ctx) =>
  nodeRule(/(?:\$)([^$]+)(?:\$)$/, mathInlineSchema.type(ctx), {
    getAttr: (match) => ({ value: match[1] ?? '' }),
  })
)

export const mathBlockInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(/^\$\$[\s\n]$/, codeBlockSchema.type(ctx), () => ({
    language: 'LaTeX',
  }))
)

export function renderMath(value: string, displayMode: boolean): string {
  return katex.renderToString(value, {
    displayMode,
    throwOnError: false,
    trust: false,
  })
}
