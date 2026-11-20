import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { ViewMutationRecord } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'
import { tStatic } from './i18n'
import { diagramPng } from './diagramPng'
import { renderMath } from './math'

export const TOGGLE_PREVIEW_SOURCE_EVENT = 'inkmark-toggle-preview-source'

const MERMAID_LANGUAGES = new Set([
  'mermaid',
  'flowchart',
  'graph',
  'sequence',
  'sequencediagram',
  'class',
  'classdiagram',
  'state',
  'statediagram',
  'er',
  'erdiagram',
  'gantt',
  'pie',
  'journey',
  'mindmap',
  'timeline',
  'gitgraph',
  'quadrantchart',
  'xychart',
  'block',
  'sankey',
  'packet',
  'requirement',
  'c4context',
])

let mermaidRenderId = 0
type DiagramTheme = 'light' | 'dark'
let configuredTheme: DiagramTheme | undefined
let renderQueue = Promise.resolve()

// Mermaid configuration is global. Keep each theme change and its render
// together so a light export can run while a dark editor preview is pending.
export function renderDiagram(language: string, content: string, theme: DiagramTheme) {
  const render = renderQueue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    if (configuredTheme !== theme) {
      const dark = theme === 'dark'
      const ink = dark ? '#acd6ff' : '#174c78'
      const outline = dark ? '#345575' : '#bdd4e8'
      const paper = dark ? '#0d1117' : '#ffffff'
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        htmlLabels: false,
        themeCSS: `
          .node rect.label-container { rx: 12px; ry: 12px; }
          .node polygon.label-container { fill: ${dark ? '#14273a' : '#f4f9ff'}; }
          .node .label text, .node .label tspan[font-weight="normal"],
          .edgeLabel tspan[font-weight="normal"] { font-weight: 600; }
          .edgeLabel text { paint-order: stroke; stroke: ${paper}; stroke-width: 4px; stroke-linejoin: round; }
          .edgeLabel .label rect { rx: 8px; ry: 8px; }
        `,
        themeVariables: {
          darkMode: dark, background: paper,
          fontFamily: 'system-ui, sans-serif', fontSize: '14px',
          primaryColor: dark ? '#102e49' : '#e6f3ff',
          secondaryColor: dark ? '#162638' : '#f3f8fc',
          tertiaryColor: dark ? '#282c42' : '#f3f1fa',
          primaryTextColor: ink, secondaryTextColor: ink, tertiaryTextColor: ink,
          textColor: ink, primaryBorderColor: outline,
          lineColor: dark ? '#7494af' : '#7390a7',
          edgeLabelBackground: paper,
          clusterBkg: dark ? '#18232b' : '#f6f9fa',
          clusterBorder: dark ? '#43525e' : '#c8d4d9',
          actorTextColor: ink, signalTextColor: ink, signalColor: ink,
        },
        flowchart: { htmlLabels: false, curve: 'linear', nodeSpacing: 36, rankSpacing: 48, padding: 12 },
      })
      configuredTheme = theme
    }
    return mermaid.render(`inkmark-mermaid-${++mermaidRenderId}`, normalizeMermaidSource(language, content))
  })
  renderQueue = render.then(() => {}, () => {})
  return render
}

export function isMermaidLanguage(language: string): boolean {
  return MERMAID_LANGUAGES.has(language.trim().toLowerCase())
}

/** Mermaid does not interpret the commonly used `\n` label escape itself. */
function mermaidDiagramType(content: string): string {
  const lines = content.split(/\r?\n/)
  let inFrontmatter = lines[0]?.trim() === '---'
  for (let index = inFrontmatter ? 1 : 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false
      continue
    }
    if (!line || line.startsWith('%%')) continue
    return line.match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() ?? ''
  }
  return ''
}

function isEscapedAt(value: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}

function normalizeFlowchartLabelLine(line: string): string {
  const trimmed = line.trimStart()
  if (/^(?:click|style|classDef|linkStyle|class)\b/.test(trimmed) || trimmed.startsWith('%%')) {
    return line
  }

  let quoted = false
  let bracketDepth = 0
  let edgeLabel = false
  let result = ''
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (!quoted && bracketDepth === 0 && !edgeLabel && line.startsWith('%%', index)) {
      result += line.slice(index)
      break
    }
    if (
      char === '\\' &&
      line[index + 1] === 'n' &&
      !isEscapedAt(line, index) &&
      (quoted || bracketDepth > 0 || edgeLabel)
    ) {
      result += '<br/>'
      index += 1
      continue
    }
    if (char === '"' && !isEscapedAt(line, index)) {
      quoted = !quoted
    } else if (!quoted) {
      if (char === '[' || char === '(' || char === '{') bracketDepth += 1
      if ((char === ']' || char === ')' || char === '}') && bracketDepth > 0) bracketDepth -= 1
      if (char === '|' && bracketDepth === 0) edgeLabel = !edgeLabel
    }
    result += char
  }
  return result
}

/** Accept `\n` only inside flowchart node/edge/subgraph label delimiters. */
export function normalizeMermaidSource(language: string, content: string): string {
  const normalizedLanguage = language.trim().toLowerCase()
  const isFlowchart = normalizedLanguage === 'flowchart' ||
    normalizedLanguage === 'graph' ||
    (normalizedLanguage === 'mermaid' && /^(?:flowchart|graph)$/.test(mermaidDiagramType(content)))
  if (!isFlowchart) return content
  return content.split('\n').map(normalizeFlowchartLabelLine).join('\n')
}

export function isMathLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase()
  return normalized === 'latex' || normalized === 'tex' || normalized === 'math'
}

/**
 * ProseMirror node view that wraps fenced code blocks with a copy-to-clipboard
 * button. The code content keeps its default editable `<pre><code>` structure,
 * so Prism syntax-highlight decorations continue to work.
 */
class CodeBlockView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  private readonly button: HTMLButtonElement
  private readonly savePngButton: HTMLButtonElement
  private savingPng = false
  private readonly source: HTMLPreElement
  private readonly preview: HTMLDivElement
  private node: ProseNode
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null
  private previewGeneration = 0
  private sourceVisible = false
  private readonly themeObserver: MutationObserver

  constructor(node: ProseNode) {
    this.node = node

    this.dom = document.createElement('div')
    this.dom.className = 'code-block-wrap'

    this.source = document.createElement('pre')
    this.contentDOM = document.createElement('code')
    this.source.appendChild(this.contentDOM)
    this.dom.appendChild(this.source)

    this.preview = document.createElement('div')
    this.preview.className = 'diagram-preview'
    this.preview.hidden = true
    this.preview.setAttribute('contenteditable', 'false')
    this.dom.appendChild(this.preview)

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'code-copy-btn'
    this.button.textContent = tStatic('code.copy')
    this.button.setAttribute('contenteditable', 'false')
    this.button.addEventListener('mousedown', (event) => event.preventDefault())
    this.button.addEventListener('click', () => this.copy())
    this.savePngButton = document.createElement('button')
    this.savePngButton.type = 'button'
    this.savePngButton.className = 'diagram-png-btn'
    this.savePngButton.textContent = tStatic('code.savePng')
    this.savePngButton.hidden = true
    this.savePngButton.addEventListener('mousedown', event => event.preventDefault())
    this.savePngButton.addEventListener('click', () => void this.savePng())
    const tools = document.createElement('div')
    tools.className = 'code-block-tools'
    tools.contentEditable = 'false'
    tools.append(this.button, this.savePngButton)
    this.dom.prepend(tools)
    this.dom.addEventListener(TOGGLE_PREVIEW_SOURCE_EVENT, this.togglePreviewSource)

    this.themeObserver = new MutationObserver(() => this.renderPreview())
    this.renderPreview()
  }

  private readonly togglePreviewSource = (): void => {
    if (!this.dom.dataset.previewKind) return
    this.sourceVisible = !this.sourceVisible
    this.dom.dataset.sourceVisible = String(this.sourceVisible)
  }

  private setPreviewKind(kind: 'math' | 'mermaid' | null): void {
    if (!kind) {
      delete this.dom.dataset.previewKind
      delete this.dom.dataset.sourceVisible
      return
    }
    this.dom.dataset.previewKind = kind
    this.dom.dataset.sourceVisible = String(this.sourceVisible)
  }

  private async savePng(): Promise<void> {
    const svg = this.preview.querySelector('svg')
    if (!svg || this.savingPng) return
    this.savingPng = true
    this.savePngButton.disabled = true
    try {
      const png = await diagramPng(svg, getComputedStyle(this.preview).backgroundColor)
      await window.api.exportDiagramPng(png)
    } catch (error) {
      await window.api.showError(tStatic('code.pngFailed'), error instanceof Error ? error.message : String(error))
    } finally {
      this.savingPng = false
      this.savePngButton.disabled = this.savePngButton.hidden
    }
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

  private renderPreview(): void {
    const language = String(this.node.attrs.language ?? '')
    const content = this.node.textContent
    this.savePngButton.hidden = true
    const generation = ++this.previewGeneration
    if (this.previewTimer) {
      clearTimeout(this.previewTimer)
      this.previewTimer = null
    }
    const keepDiagram = isMermaidLanguage(language) && !!this.preview.querySelector('svg')
    this.themeObserver.disconnect()
    this.preview.hidden = true
    this.preview.className = 'diagram-preview'
    if (!keepDiagram) this.preview.replaceChildren()

    if (isMathLanguage(language) && content.trim()) {
      this.setPreviewKind('math')
      this.preview.classList.add('formula-preview')
      this.preview.hidden = false
      try {
        this.preview.innerHTML = renderMath(content, true)
      } catch (error) {
        this.preview.classList.add('diagram-error')
        this.preview.textContent = String(error)
      }
      return
    }

    if (!isMermaidLanguage(language) || !content.trim()) {
      this.setPreviewKind(null)
      return
    }

    this.setPreviewKind('mermaid')
    this.preview.classList.add('mermaid-preview')
    this.preview.hidden = false
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    if (!keepDiagram) this.preview.textContent = tStatic('code.renderingDiagram')
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null
      void this.renderMermaid(language, content, generation)
    }, 180)
  }

  private async renderMermaid(
    language: string,
    content: string,
    generation: number
  ): Promise<void> {
    try {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
      const result = await renderDiagram(language, content, theme)
      if (generation !== this.previewGeneration) return
      this.preview.replaceChildren()
      const svg = document.createElement('div')
      svg.innerHTML = result.svg
      this.preview.appendChild(svg)
      this.savePngButton.hidden = false
      this.savePngButton.disabled = this.savingPng
      result.bindFunctions?.(this.preview)
    } catch (error) {
      if (generation !== this.previewGeneration) return
      this.preview.classList.add('diagram-error')
      this.preview.textContent = `${tStatic('code.diagramError')}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'code_block') return false
    const changed = node.attrs.language !== this.node.attrs.language || !node.content.eq(this.node.content)
    this.node = node
    if (changed) this.renderPreview()
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Ignore mutations outside the editable code content (our own DOM).
    return !this.contentDOM.contains(mutation.target as Node)
  }

  stopEvent(event: Event): boolean {
    return this.button.contains(event.target as Node) || this.savePngButton.contains(event.target as Node)
  }

  destroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
    if (this.previewTimer) clearTimeout(this.previewTimer)
    this.previewGeneration += 1
    this.themeObserver.disconnect()
    this.dom.removeEventListener(TOGGLE_PREVIEW_SOURCE_EVENT, this.togglePreviewSource)
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
