import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { $inputRule, $nodeSchema, $prose, $remark, $useKeymap } from '@milkdown/kit/utils'

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
}

const COMMENT_NODE_TYPE = 'htmlComment'
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

interface HtmlTag {
  end: number
  name: string | null
  closing: boolean
  selfClosing: boolean
}

/** Read one HTML tag while respecting quoted attribute values. */
function readHtmlTag(value: string, start: number): HtmlTag | null {
  let quote: '"' | "'" | null = null
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== '>') continue

    const body = value.slice(start + 1, index)
    const match = /^\s*(\/?)\s*([A-Za-z][\w:-]*)/.exec(body)
    return {
      end: index + 1,
      name: match?.[2]?.toLowerCase() ?? null,
      closing: match?.[1] === '/',
      selfClosing: /\/\s*$/.test(body)
    }
  }
  return null
}

function startsHtmlTag(value: string, start: number): boolean {
  const rest = value.slice(start)
  return /^<\/?[A-Za-z]/.test(rest) || /^<![A-Za-z]/.test(rest) || rest.startsWith('<?')
}

/** Find an actual HTML comment, excluding attribute strings and raw-text elements. */
function findHtmlCommentStart(value: string, from: number): number {
  const lower = value.toLowerCase()
  let offset = from
  let rawTextTag: string | null = null

  while (offset < value.length) {
    if (rawTextTag) {
      const closingPrefix = `</${rawTextTag}`
      let closing = lower.indexOf(closingPrefix, offset)
      while (closing >= 0) {
        const boundary = value[closing + closingPrefix.length] ?? ''
        if (!boundary || /[\s/>]/.test(boundary)) break
        closing = lower.indexOf(closingPrefix, closing + closingPrefix.length)
      }
      if (closing < 0) return -1
      const tag = readHtmlTag(value, closing)
      if (!tag) return -1
      rawTextTag = null
      offset = tag.end
      continue
    }

    if (value.startsWith('<!--', offset)) return offset

    if (value.startsWith('<![CDATA[', offset)) {
      const end = value.indexOf(']]>', offset + 9)
      if (end < 0) return -1
      offset = end + 3
      continue
    }

    if (value[offset] === '<') {
      if (!startsHtmlTag(value, offset)) {
        offset += 1
        continue
      }
      const tag = readHtmlTag(value, offset)
      if (!tag) {
        // A real tag prefix without `>` consumes the remainder. Comment-like
        // text can still be part of an unfinished quoted attribute value.
        return -1
      }
      if (tag.name && !tag.closing && !tag.selfClosing && RAW_TEXT_TAGS.has(tag.name)) {
        rawTextTag = tag.name
      }
      offset = tag.end
      continue
    }

    offset += 1
  }

  return -1
}

/** Split every real comment range while preserving all surrounding raw HTML. */
export function splitHtmlComments(value: string): MarkdownAstNode[] {
  const nodes: MarkdownAstNode[] = []
  let offset = 0

  while (offset < value.length) {
    const start = findHtmlCommentStart(value, offset)
    if (start < 0) break

    const prefix = value.slice(offset, start)
    const leadingWhitespace = /\s*$/.exec(prefix)?.[0] ?? ''
    const visiblePrefix = prefix.slice(0, prefix.length - leadingWhitespace.length)
    if (visiblePrefix) nodes.push({ type: 'html', value: visiblePrefix })
    const commentStart = start - leadingWhitespace.length

    const closing = value.indexOf('-->', start + 4)
    const end = closing < 0 ? value.length : closing + 3
    nodes.push({ type: COMMENT_NODE_TYPE, value: value.slice(commentStart, end) })
    offset = end

    // An unclosed HTML comment consumes the remainder of the raw HTML node.
    if (closing < 0) return nodes
  }

  const remainder = value.slice(offset)
  if (remainder) {
    const last = nodes.at(-1)
    if (/^\s+$/.test(remainder) && last?.type === COMMENT_NODE_TYPE) {
      last.value = `${last.value ?? ''}${remainder}`
    } else {
      nodes.push({ type: 'html', value: remainder })
    }
  }

  return nodes
}

function splitCommentsInTree(node: MarkdownAstNode): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    splitCommentsInTree(child)
    if (child.type !== 'html' || typeof child.value !== 'string') return [child]
    return splitHtmlComments(child.value)
  })
}

/** Turn comment ranges into their own nodes after CommonMark parses raw HTML. */
export const remarkHtmlCommentPlugin = $remark(
  'remarkHtmlComment',
  () => () => (tree: unknown) => splitCommentsInTree(tree as MarkdownAstNode)
)

/** Text used by headings and the outline must not include comment bodies. */
export function textWithoutHtmlComments(node: ProseMirrorNode): string {
  let text = ''
  node.descendants((child) => {
    if (child.type.name === 'html_comment') return false
    if (child.isText) text += child.text ?? ''
    return true
  })
  return text
}

export function outlineWithoutHtmlComments(doc: ProseMirrorNode): Array<{
  text: string
  level: number
  id: string
}> {
  const result: Array<{ text: string; level: number; id: string }> = []
  doc.descendants((node) => {
    if (node.type.name === 'heading' && typeof node.attrs.level === 'number') {
      result.push({
        text: textWithoutHtmlComments(node).trim(),
        level: node.attrs.level,
        id: String(node.attrs.id ?? '')
      })
      return false
    }
    return true
  })
  return result
}

/** An editable inline node that preserves the complete `<!-- ... -->` source. */
export const htmlCommentSchema = $nodeSchema('html_comment', () => ({
  group: 'inline',
  inline: true,
  isolating: true,
  content: 'text*',
  marks: '',
  whitespace: 'pre' as const,
  attrs: {
    leading: { default: '' },
    trailing: { default: '' },
    closed: { default: true }
  },
  parseDOM: [
    {
      tag: 'span[data-type="html_comment"]',
      contentElement: '.md-comment-content',
      getAttrs: (dom) => ({
        leading: (dom as HTMLElement).dataset.leading ?? '',
        trailing: (dom as HTMLElement).dataset.trailing ?? '',
        closed: (dom as HTMLElement).dataset.closed !== 'false'
      }),
      preserveWhitespace: 'full' as const
    }
  ],
  toDOM: (node) => {
    const leading = String(node.attrs.leading ?? '')
    const trailing = String(node.attrs.trailing ?? '')
    const closed = node.attrs.closed !== false
    const children: unknown[] = [
      [
        'span',
        { class: 'md-comment-delimiter', contenteditable: 'false' },
        `${leading}<!--`
      ],
      ['span', { class: 'md-comment-content' }, 0]
    ]
    if (closed) {
      children.push([
        'span',
        { class: 'md-comment-delimiter', contenteditable: 'false' },
        `-->${trailing}`
      ])
    }
    return [
      'span',
      {
        'data-type': 'html_comment',
        'data-leading': leading,
        'data-trailing': trailing,
        'data-closed': String(closed),
        class: 'md-comment'
      },
      ...children
    ]
  },
  parseMarkdown: {
    match: (node) => node.type === COMMENT_NODE_TYPE,
    runner: (state, node, type) => {
      const source = typeof node.value === 'string' ? node.value : ''
      const opening = source.indexOf('<!--')
      const closing = opening < 0 ? -1 : source.indexOf('-->', opening + 4)
      const leading = opening < 0 ? '' : source.slice(0, opening)
      const closed = closing >= 0
      const trailing = closed ? source.slice(closing + 3) : ''
      const contentStart = opening < 0 ? 0 : opening + 4
      const contentEnd = closed ? closing : source.length
      const content = source.slice(contentStart, contentEnd)
      const children = content ? [state.schema.text(content)] : undefined

      // Build the inline node in one step. ParserState.closeNode() resets all
      // active marks, which would otherwise truncate surrounding emphasis or links.
      state.addNode(type, { leading, trailing, closed }, children)
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html_comment',
    runner: (state, node) => {
      const leading = String(node.attrs.leading ?? '')
      const trailing = String(node.attrs.trailing ?? '')
      const closed = node.attrs.closed !== false
      state.addNode(
        'html',
        undefined,
        `${leading}<!--${node.textContent}${closed ? `-->${trailing}` : ''}`
      )
    }
  }
}))

function isEscaped(value: string, offset: number): boolean {
  let slashes = 0
  for (let index = offset - 1; index >= 0 && value[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}

/**
 * Whether a comment opener starts in normal Markdown text. Incomplete code
 * spans and HTML attributes have not become ProseMirror marks/nodes yet, so
 * they need a small lexical guard before the input rule runs.
 */
function isOrdinaryMarkdownText(value: string): boolean {
  let codeFenceLength = 0
  let inHtmlTag = false
  let quote: '"' | "'" | null = null

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (!inHtmlTag && char === '`' && !isEscaped(value, index)) {
      let end = index + 1
      while (value[end] === '`') end += 1
      const length = end - index
      if (codeFenceLength === 0) codeFenceLength = length
      else if (codeFenceLength === length) codeFenceLength = 0
      index = end - 1
      continue
    }

    if (codeFenceLength > 0) continue

    if (inHtmlTag) {
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        inHtmlTag = false
      }
      continue
    }

    if (char === '<' && startsHtmlTag(value, index)) inHtmlTag = true
  }

  return codeFenceLength === 0 && !inHtmlTag
}

/** Recognize a user-typed opener without adding a closing delimiter. */
export const htmlCommentInputRule = $inputRule((ctx) => {
  const type = htmlCommentSchema.type(ctx)
  return new InputRule(/<!--$/, (state, _match, start, end) => {
    const { $from } = state.selection
    if ($from.parent.type.name === 'html_comment') return null

    const parentStart = $from.start()
    const openingOffset = Math.max(0, start - parentStart)
    const parentText = $from.parent.textBetween(0, $from.parent.content.size)
    if (isEscaped(parentText, openingOffset)) return null

    const textBeforeOpening = parentText.slice(0, openingOffset)
    if (!isOrdinaryMarkdownText(textBeforeOpening)) return null

    const marks = state.storedMarks ?? $from.marks()
    const node = type.create({ leading: '', trailing: '', closed: false }, undefined, marks)
    const transaction = state.tr.replaceRangeWith(start, end, node)
    return transaction.setSelection(TextSelection.create(transaction.doc, start + 1))
  })
})

/** Consume a user-typed `-->` inside an open comment and close that node. */
export const htmlCommentClosePlugin = $prose(
  () =>
    new Plugin({
      props: {
        handleTextInput(view, from, to, text): boolean {
          if (text !== '>' || from !== to || !view.state.selection.empty) return false

          const { $from } = view.state.selection
          const depth = commentDepthAt($from)
          if (depth < 0) return false

          const comment = $from.node(depth)
          if (comment.attrs.closed !== false || $from.parentOffset < 2) return false
          if ($from.parent.textBetween($from.parentOffset - 2, $from.parentOffset) !== '--') {
            return false
          }

          const nodeStart = $from.before(depth)
          const transaction = view.state.tr
            .delete(from - 2, from)
            .setNodeMarkup(nodeStart, undefined, { ...comment.attrs, closed: true })
          const closedNode = transaction.doc.nodeAt(nodeStart)
          if (!closedNode) return false

          transaction.setSelection(
            TextSelection.near(transaction.doc.resolve(nodeStart + closedNode.nodeSize), 1)
          )
          view.dispatch(transaction.scrollIntoView())
          return true
        }
      }
    })
)

function commentDepthAt(position: TextSelection['$from']): number {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type.name === 'html_comment') return depth
  }
  return -1
}

export const htmlCommentKeymap = $useKeymap('htmlComment', {
  InsertNewline: {
    shortcuts: ['Enter', 'Shift-Enter'],
    priority: 100,
    command:
      () =>
      (state, dispatch): boolean => {
        const { $from, $to, from, to } = state.selection
        const fromDepth = commentDepthAt($from)
        const toDepth = commentDepthAt($to)
        if (
          fromDepth < 0 ||
          toDepth < 0 ||
          $from.before(fromDepth) !== $to.before(toDepth)
        ) {
          return false
        }
        if (dispatch) dispatch(state.tr.insertText('\n', from, to).scrollIntoView())
        return true
      }
  },
  MoveBefore: {
    shortcuts: 'ArrowLeft',
    priority: 100,
    command:
      () =>
      (state, dispatch): boolean => {
        const { $from, empty } = state.selection
        const depth = commentDepthAt($from)
        if (!empty || depth < 0 || $from.parentOffset !== 0) return false
        if (dispatch) {
          const target = state.doc.resolve($from.before(depth))
          dispatch(state.tr.setSelection(TextSelection.near(target, -1)).scrollIntoView())
        }
        return true
      }
  },
  MoveAfter: {
    shortcuts: 'ArrowRight',
    priority: 100,
    command:
      () =>
      (state, dispatch): boolean => {
        const { $from, empty } = state.selection
        const depth = commentDepthAt($from)
        if (!empty || depth < 0 || $from.parentOffset !== $from.parent.content.size) return false
        if (dispatch) {
          const target = state.doc.resolve($from.after(depth))
          dispatch(state.tr.setSelection(TextSelection.near(target, 1)).scrollIntoView())
        }
        return true
      }
  }
})
