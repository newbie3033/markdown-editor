import themeCss from '../styles/theme.css?raw'
import { getRenderedDiagramSvg, isMathLanguage, isMermaidLanguage } from './codeBlockCopy'
import { selfContainedKatexCss } from './katexExportCss'
import { renderMath } from './math'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function addRenderedPreviews(bodyHtml: string): string {
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

  for (const inlineMath of Array.from(
    template.content.querySelectorAll<HTMLElement>('span[data-type="math_inline"]')
  )) {
    const value = inlineMath.dataset.value ?? inlineMath.textContent ?? ''
    inlineMath.innerHTML = renderMath(value, false)
  }

  for (const pre of Array.from(template.content.querySelectorAll('pre[data-language]'))) {
    const language = pre.getAttribute('data-language') ?? ''
    const content = pre.querySelector('code')?.textContent ?? ''
    if (isMathLanguage(language)) {
      const formula = document.createElement('div')
      formula.className = 'formula-export'
      formula.innerHTML = renderMath(content, true)
      pre.replaceWith(formula)
      continue
    }
    if (isMermaidLanguage(language)) {
      const svg = getRenderedDiagramSvg(language, content)
      if (!svg) continue
      const diagram = document.createElement('div')
      diagram.className = 'diagram-export'
      diagram.innerHTML = svg
      pre.replaceWith(diagram)
    }
  }
  return template.innerHTML
}

export function buildHtmlDocument(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtml(title)
  const renderedBody = addRenderedPreviews(bodyHtml)
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
<main class="md-body">${renderedBody}</main>
</body>
</html>`
}
