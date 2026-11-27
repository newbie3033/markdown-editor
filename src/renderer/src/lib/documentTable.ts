import { $remark } from '@milkdown/kit/utils'
import type { Parent } from 'mdast'

const tablePart = /^<\/?(?:table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)(?=[\s/>])/i
const htmlTags = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][\w:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi

function restoreIndentedTableTags(node: Parent, source: string): void {
  let tableDepth = 0
  for (let index = 0; index < node.children.length; index++) {
    let child = node.children[index]
    const offset = child.position?.start.offset
    if (tableDepth > 0 && child.type === 'code' && offset !== undefined &&
      /^(?: {4}| {0,3}\t)/.test(source.slice(offset, offset + 4)) && tablePart.test(child.value.trimStart())) {
      // A blank line ends a CommonMark HTML block. Keep indented table
      // tags after it as markup while leaving actual fenced code intact.
      child = { type: 'html', value: child.value, position: child.position }
      node.children[index] = child
    }
    if (child.type === 'html') {
      for (const [, closing, name] of child.value.matchAll(htmlTags)) {
        if (name?.toLowerCase() === 'table') {
          tableDepth = closing ? Math.max(0, tableDepth - 1) : tableDepth + 1
        }
      }
    } else if ('children' in child) {
      restoreIndentedTableTags(child, source)
    }
  }
}

export const remarkTablePlugin = $remark(
  'remarkDocumentTable',
  () => () => (tree, file) => restoreIndentedTableTags(tree, String(file.value))
)

export function wrapDocumentTables(fragment: DocumentFragment): void {
  for (const table of fragment.querySelectorAll('table')) {
    if (table.parentElement?.closest('table')) continue
    const wrapper = table.ownerDocument.createElement('div')
    wrapper.className = 'tableWrapper'
    table.before(wrapper)
    wrapper.append(table)
  }
}
