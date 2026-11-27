import type { MarkdownNode, RemarkParser } from '@milkdown/kit/transformer'
import { visit } from 'unist-util-visit'
import type { OutlineItem } from './markdown'

function headingText(node: MarkdownNode): string {
  if ((node.type === 'text' || node.type === 'inlineCode') && typeof node.value === 'string') {
    return node.value
  }
  return node.children?.map(headingText).join('') ?? ''
}

export function sourceOutline(parser: RemarkParser, source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  visit(parser.parse(source) as MarkdownNode, 'heading', (node: MarkdownNode) => {
    const pos = node.position?.start.offset
    if (pos !== undefined && typeof node.depth === 'number') {
      items.push({ text: headingText(node).trim(), level: node.depth, pos })
    }
  })
  return items
}

export function jumpToSourcePosition(textarea: HTMLTextAreaElement, pos: number, end = pos): void {
  const { paddingTop, paddingBottom, lineHeight } = getComputedStyle(textarea)
  // Measure with the same text wrapping as the editor, including long source lines.
  const measure = textarea.cloneNode(false) as HTMLTextAreaElement
  measure.tabIndex = -1
  measure.setAttribute('aria-hidden', 'true')
  Object.assign(measure.style, {
    position: 'absolute',
    visibility: 'hidden',
    overflow: 'hidden',
    width: `${textarea.clientWidth}px`,
    height: '0',
    minHeight: '0'
  })
  measure.value = `${textarea.value.slice(0, pos)}\u200b`
  textarea.after(measure)
  const top = measure.scrollHeight - parseFloat(paddingTop) - parseFloat(paddingBottom) - parseFloat(lineHeight)
  measure.remove()

  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(pos, end)
  textarea.scrollTop = top
}
