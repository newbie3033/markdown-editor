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
