import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { ViewMutationRecord } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'
import { tStatic } from './i18n'

/**
 * ProseMirror node view that wraps fenced code blocks with a copy-to-clipboard
 * button. The code content keeps its default editable `<pre><code>` structure,
 * so Prism syntax-highlight decorations continue to work.
 */
class CodeBlockView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  private readonly button: HTMLButtonElement
  private readonly node: ProseNode
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null

  constructor(node: ProseNode) {
    this.node = node

    this.dom = document.createElement('div')
    this.dom.className = 'code-block-wrap'

    const pre = document.createElement('pre')
    this.contentDOM = document.createElement('code')
    pre.appendChild(this.contentDOM)
    this.dom.appendChild(pre)

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'code-copy-btn'
    this.button.textContent = tStatic('code.copy')
    this.button.setAttribute('contenteditable', 'false')
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => this.copy())
    this.dom.appendChild(this.button)
  }

  private copy(): void {
    void window.api.copyText(this.node.textContent)
    this.button.textContent = tStatic('code.copied')
    this.button.classList.add('copied')
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
    this.feedbackTimer = setTimeout(() => {
      this.button.textContent = tStatic('code.copy')
      this.button.classList.remove('copied')
      this.feedbackTimer = null
    }, 1500)
  }

  update(_node: ProseNode): boolean {
    // Keep the contentDOM; ProseMirror updates the text content itself.
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Ignore mutations outside the editable code content (our own DOM).
    return !this.contentDOM.contains(mutation.target as Node)
  }

  stopEvent(event: Event): boolean {
    return this.button.contains(event.target as Node)
  }

  destroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
  }
}

/** Milkdown plugin attaching the code block node view. */
export const codeBlockCopyPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('CODE_BLOCK_COPY'),
      props: {
        nodeViews: {
          code_block: (node: ProseNode) => new CodeBlockView(node)
        }
      }
    })
)
