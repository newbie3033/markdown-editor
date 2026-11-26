import { DOMSerializer, type Node as ProseMirrorNode } from '@milkdown/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { TOGGLE_PREVIEW_SOURCE_EVENT } from './codeBlockCopy'
import { renderHtmlGroups } from './documentHtml'
import { renderMath } from './math'

const previewKey = new PluginKey<PreviewState>('documentHtmlPreview')

interface PreviewState {
  enabled: boolean
  sourceBlock: number | null
  decorations: DecorationSet
}

export function setHtmlPreview(transaction: Transaction, enabled: boolean): Transaction {
  return transaction.setMeta(previewKey, { enabled })
}

export function closeHtmlPreviewSource(transaction: Transaction): Transaction {
  return transaction.setMeta(previewKey, { sourceBlock: null })
}

function createDecorations(doc: ProseMirrorNode, sourceBlock: number | null): DecorationSet {
  let hasHtml = false
  doc.descendants(node => {
    if (node.type.name === 'html') hasHtml = true
    return !hasHtml
  })
  if (!hasHtml) return DecorationSet.empty

  const positions: number[] = []
  doc.forEach((_node, offset) => positions.push(offset))
  positions.push(doc.content.size)

  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const fragment = document.createDocumentFragment()
  serializer.serializeFragment(doc.content, undefined, fragment)
  const decorations: Decoration[] = []
  for (const { from, to, content } of renderHtmlGroups(fragment)) {
    const start = positions[from]
    const end = positions[to]
    const showSource = sourceBlock !== null && sourceBlock >= start && sourceBlock < end
    for (let index = from; index < to; index++) {
      decorations.push(Decoration.node(positions[index], positions[index + 1], {
        class: showSource ? 'html-preview-source' : 'html-preview-hidden'
      }))
    }
    if (showSource) continue

    for (const math of content.querySelectorAll<HTMLElement>('span[data-type="math_inline"]')) {
      math.innerHTML = renderMath(math.dataset.value ?? math.textContent ?? '', false)
    }
    const preview = document.createElement('div')
    preview.className = 'html-preview'
    preview.append(content)
    decorations.push(Decoration.widget(start, (view, getPos) => {
      preview.addEventListener(TOGGLE_PREVIEW_SOURCE_EVENT, () => {
        const position = getPos()
        if (position !== undefined) {
          view.dispatch(view.state.tr.setMeta(previewKey, { sourceBlock: position }))
        }
      })
      return preview
    }, {
      side: -1,
      key: `html-preview:${end - start}:${preview.innerHTML}`,
      stopEvent: () => true,
      ignoreSelection: true
    }))
  }
  return DecorationSet.create(doc, decorations)
}

export const htmlPreviewPlugin = $prose(() => new Plugin<PreviewState>({
  key: previewKey,
  state: {
    init: () => ({ enabled: false, sourceBlock: null, decorations: DecorationSet.empty }),
    apply(transaction, previous) {
      const update = transaction.getMeta(previewKey) as Partial<PreviewState> | undefined
      if (!update && !transaction.docChanged) return previous
      const enabled = update?.enabled ?? previous.enabled
      const mapped = previous.sourceBlock === null ? null : transaction.mapping.mapResult(previous.sourceBlock)
      let sourceBlock = mapped && !mapped.deleted ? mapped.pos : null
      if (update?.sourceBlock !== undefined) sourceBlock = update.sourceBlock
      if (!enabled) sourceBlock = null
      return {
        enabled,
        sourceBlock,
        decorations: enabled ? createDecorations(transaction.doc, sourceBlock) : DecorationSet.empty
      }
    }
  },
  props: {
    decorations(state) {
      return previewKey.getState(state)?.decorations
    },
    handleDOMEvents: {
      keydown(view, event) {
        if (event.key !== 'Escape' || previewKey.getState(view.state)?.sourceBlock == null) return false
        view.dispatch(closeHtmlPreviewSource(view.state.tr))
        return true
      }
    }
  }
}))
