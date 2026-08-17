import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'

const ASSET_ORIGIN = 'inkmark-asset://local'

function encodePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

/** Convert legacy absolute local sources for display without changing Markdown. */
export function renderImageSource(src: string): string {
  if (/^file:/i.test(src)) {
    try {
      const url = new URL(src)
      if (!url.hostname || url.hostname === 'localhost') return `${ASSET_ORIGIN}${url.pathname}`
    } catch {
      return src
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(src)) return `${ASSET_ORIGIN}/${encodePath(src)}`
  // In a local relative filename, URL syntax characters are literal path
  // characters. Encode them only in the DOM URL; keep the model/Markdown
  // untouched for readability and portability.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return src.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\?/g, '%3F')
  }
  return src
}

class ImageView {
  readonly dom: HTMLImageElement

  constructor(node: ProseNode) {
    this.dom = document.createElement('img')
    this.updateAttributes(node)
  }

  private updateAttributes(node: ProseNode): void {
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : ''
    this.dom.src = renderImageSource(src)
    this.dom.alt = alt
    if (title) this.dom.title = title
    else this.dom.removeAttribute('title')
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'image') return false
    this.updateAttributes(node)
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }
}

/** Render local images through the constrained protocol while preserving src in the model. */
export const localImageViewPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('INKMARK_LOCAL_IMAGE_VIEW'),
      props: {
        nodeViews: {
          image: (node: ProseNode) => new ImageView(node)
        }
      }
    })
)
