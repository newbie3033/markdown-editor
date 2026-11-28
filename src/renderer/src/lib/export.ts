import { renderDocumentHtml } from './documentHtml'
import { diagramCanvas } from './diagramPng'
import { wrapDocumentTables } from './documentTable'
import themeCss from '../styles/theme.css?raw'
import { renderDiagram, isMathLanguage, isMermaidLanguage } from './codeBlockCopy'
import { selfContainedKatexCss } from './katexExportCss'
import { renderMath } from './math'
import { getMermaidStyle, mermaidBackground } from './mermaidTheme'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function prepareBody(bodyHtml: string, renderHtml: boolean, format: 'html' | 'word'): Promise<HTMLTemplateElement> {
  const style = getMermaidStyle()
  const template = document.createElement('template')
  template.innerHTML = bodyHtml

  // Milkdown represents raw HTML as inert spans. Comments stay visible while
  // editing, but Typora-style exports must omit them entirely.
  const commentParagraphs = new Set<HTMLParagraphElement>()
  for (const commentNode of Array.from(
    template.content.querySelectorAll<HTMLElement>('[data-type="html_comment"]')
  )) {
    const paragraph = commentNode.closest('p')
    if (paragraph) commentParagraphs.add(paragraph)
    const whitespace = `${commentNode.dataset.leading ?? ''}${commentNode.dataset.trailing ?? ''}`
    if (whitespace) commentNode.replaceWith(document.createTextNode(whitespace))
    else commentNode.remove()
  }

  // Also remove native comment nodes in case a future serializer emits raw
  // HTML comments instead of Milkdown's inert span representation.
  const commentWalker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  while (commentWalker.nextNode()) comments.push(commentWalker.currentNode as Comment)
  for (const comment of comments) {
    const paragraph = comment.parentElement?.closest('p')
    if (paragraph) commentParagraphs.add(paragraph)
    comment.remove()
  }

  // CommonMark wraps block-level raw HTML in a paragraph for Milkdown's
  // inline schema. Remove that wrapper when comments were its only rendered
  // content, including empty mark wrappers left around a removed comment.
  const renderedElementSelector = [
    'img',
    'video',
    'audio',
    'canvas',
    'svg',
    'math',
    'iframe',
    'object',
    'embed',
    'input',
    'textarea',
    'select',
    'button',
    'br',
    'hr',
    'table',
    'pre',
    '[data-type="math_inline"]'
  ].join(',')
  for (const paragraph of commentParagraphs) {
    if (!paragraph.textContent?.trim() && !paragraph.querySelector(renderedElementSelector)) {
      paragraph.remove()
    }
  }

  if (renderHtml) renderDocumentHtml(template.content)
  if (format === 'html') wrapDocumentTables(template.content)

  for (const inlineMath of Array.from(
    template.content.querySelectorAll<HTMLElement>('span[data-type="math_inline"]')
  )) {
    const value = inlineMath.dataset.value ?? inlineMath.textContent ?? ''
    if (format === 'word') inlineMath.textContent = `$${value}$`
    else inlineMath.innerHTML = renderMath(value, false)
  }

  for (const pre of Array.from(template.content.querySelectorAll('pre[data-language]'))) {
    const language = pre.getAttribute('data-language') ?? ''
    const content = pre.querySelector('code')?.textContent ?? ''
    if (isMathLanguage(language)) {
      if (format === 'word') continue // Keep the editable LaTeX in the code block.
      const formula = document.createElement('div')
      formula.className = 'formula-export'
      formula.innerHTML = renderMath(content, true)
      pre.replaceWith(formula)
      continue
    }
    if (isMermaidLanguage(language)) {
      try {
        const { svg } = await renderDiagram(language, content, 'light', style)
        const diagram = document.createElement(format === 'word' ? 'p' : 'div')
        diagram.className = 'diagram-export'
        diagram.style.backgroundColor = mermaidBackground(style, 'light')
        diagram.innerHTML = svg
        if (format === 'word') {
          const vector = diagram.querySelector('svg')
          if (!vector) continue
          const canvas = await diagramCanvas(vector, diagram.style.backgroundColor)
          const image = document.createElement('img')
          image.src = canvas.toDataURL('image/png')
          image.alt = language
          diagram.replaceChildren(image)
        }
        pre.replaceWith(diagram)
      } catch {
        // Keep invalid diagram source readable in the exported document.
      }
    }
  }
  return template
}

export async function buildWordBody(bodyHtml: string, renderHtml: boolean): Promise<string> {
  const template = await prepareBody(bodyHtml, renderHtml, 'word')
  for (const item of template.content.querySelectorAll<HTMLElement>('li[data-item-type="task"]')) {
    const paragraph = item.querySelector(':scope > p') ?? item
    paragraph.prepend(item.dataset.checked === 'true' ? '☑ ' : '☐ ')
  }
  // WordprocessingML needs explicit line breaks to preserve multiline code.
  for (const pre of template.content.querySelectorAll('pre')) {
    const paragraph = document.createElement('p')
    for (const line of (pre.textContent ?? '').split('\n')) {
      if (paragraph.hasChildNodes()) paragraph.append(document.createElement('br'))
      const code = document.createElement('code')
      code.textContent = line
      paragraph.append(code)
    }
    pre.replaceWith(paragraph)
  }
  return template.innerHTML
}

export async function buildHtmlDocument(bodyHtml: string, title: string, renderHtml: boolean): Promise<string> {
  const safeTitle = escapeHtml(title)
  const template = await prepareBody(bodyHtml, renderHtml, 'html')
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: http: https: inkmark-asset:" />
<title>${safeTitle}</title>
<style>
${themeCss}
${selfContainedKatexCss}
</style>
</head>
<body class="export-page">
<main class="md-body">${template.innerHTML}</main>
</body>
</html>`
}
