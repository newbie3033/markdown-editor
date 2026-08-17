import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { tStatic } from './i18n'

const ASSET_ORIGIN = 'inkmark-asset://local'
const REMOTE_IMAGE_CACHE_LIMIT = 16
const remoteImageCache = new Map<string, string>()

function cacheRemoteImage(src: string, dataUrl: string): void {
  remoteImageCache.delete(src)
  remoteImageCache.set(src, dataUrl)
  while (remoteImageCache.size > REMOTE_IMAGE_CACHE_LIMIT) {
    const oldest = remoteImageCache.keys().next().value
    if (!oldest) break
    remoteImageCache.delete(oldest)
  }
}

function encodePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

export function isRemoteImageSource(src: string): boolean {
  return /^https?:\/\//i.test(src.trim())
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
  readonly dom: HTMLElement
  private readonly image: HTMLImageElement
  private readonly remotePanel: HTMLSpanElement
  private readonly remoteMessage: HTMLSpanElement
  private readonly remoteButton: HTMLButtonElement
  private currentSrc = ''
  private loadingSrc = ''
  private failedSrc = ''
  private loadedRemoteSource = ''
  private requestId = 0

  constructor(node: ProseNode) {
    this.dom = document.createElement('span')
    this.dom.className = 'inkmark-image-view'
    this.image = document.createElement('img')
    this.image.draggable = false

    this.remotePanel = document.createElement('span')
    this.remotePanel.className = 'inkmark-remote-image'
    this.remoteMessage = document.createElement('span')
    this.remoteMessage.className = 'inkmark-remote-image-message'
    this.remoteButton = document.createElement('button')
    this.remoteButton.type = 'button'
    this.remoteButton.className = 'inkmark-remote-image-button'
    this.remoteButton.addEventListener('mousedown', (event) => event.preventDefault())
    this.remoteButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void this.loadRemoteImage()
    })
    this.remotePanel.append(this.remoteMessage, this.remoteButton)
    this.dom.append(this.image, this.remotePanel)
    this.updateAttributes(node)
  }

  private showRemotePlaceholder(src: string): void {
    this.image.hidden = true
    this.image.removeAttribute('src')
    this.remotePanel.hidden = false
    this.remoteMessage.textContent =
      this.failedSrc === src ? tStatic('image.remoteFailed') : tStatic('image.remoteBlocked')
    this.remoteButton.textContent = tStatic(
      this.loadingSrc === src
        ? 'image.loadingRemote'
        : this.failedSrc === src
          ? 'image.retryRemote'
          : 'image.loadRemote'
    )
    this.remoteButton.disabled = this.loadingSrc === src
    this.remotePanel.title = src
  }

  private showRemoteImage(src: string, dataUrl: string): void {
    this.image.hidden = false
    this.image.src = dataUrl
    this.remotePanel.hidden = true
    this.remotePanel.title = ''
    this.loadedRemoteSource = src
  }

  private updateAttributes(node: ProseNode): void {
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
    const title = typeof node.attrs.title === 'string' ? node.attrs.title : ''
    this.image.alt = alt
    if (title) this.image.title = title
    else this.image.removeAttribute('title')

    if (src !== this.currentSrc) {
      this.requestId += 1
      this.currentSrc = src
      this.loadingSrc = ''
      this.failedSrc = ''
      this.loadedRemoteSource = ''
    }

    if (isRemoteImageSource(src)) {
      const cached = remoteImageCache.get(src)
      if (cached) {
        this.showRemoteImage(src, cached)
      } else if (this.loadingSrc === src) {
        this.showRemotePlaceholder(src)
      } else if (this.loadedRemoteSource === src && this.image.src) {
        this.remotePanel.hidden = true
      } else {
        this.showRemotePlaceholder(src)
      }
      return
    }

    this.loadingSrc = ''
    this.failedSrc = ''
    this.loadedRemoteSource = ''
    this.remotePanel.hidden = true
    this.image.hidden = false
    this.image.src = renderImageSource(src)
  }

  private async loadRemoteImage(): Promise<void> {
    const src = this.currentSrc
    if (!isRemoteImageSource(src) || this.loadingSrc === src) return
    const requestId = ++this.requestId
    this.loadingSrc = src
    this.failedSrc = ''
    this.showRemotePlaceholder(src)
    try {
      const result = await window.api.loadRemoteImage(src)
      if (requestId !== this.requestId || this.currentSrc !== src) return
      cacheRemoteImage(src, result.dataUrl)
      this.loadingSrc = ''
      this.failedSrc = ''
      this.showRemoteImage(src, result.dataUrl)
    } catch {
      if (requestId !== this.requestId || this.currentSrc !== src) return
      this.loadingSrc = ''
      this.failedSrc = src
      this.showRemotePlaceholder(src)
    }
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

  destroy(): void {
    this.requestId += 1
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
