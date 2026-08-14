import themeCss from '../styles/theme.css?raw'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Rewrite relative src/href attributes to absolute file:// URLs so that
 * exported HTML/PDF files can resolve images and links that are stored
 * relative to the document directory.
 */
export function absolutizeUrls(html: string, docDir: string | null): string {
  if (!docDir) return html
  const baseDir = docDir.replace(/\\/g, '/')
  return html.replace(
    /((?:src|href)=")([^"]*)(")/g,
    (match, prefix: string, url: string, suffix: string) => {
      if (!url) return match
      // Keep absolute URLs, schemes, anchors and root-relative paths untouched.
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(url)) return match
      const upCount = (url.match(/^(?:\.\.\/)+/) ?? [''])[0].split('/').length - 1
      const rest = url.replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '')
      const parts = baseDir.split('/')
      const trimmed = parts.slice(0, Math.max(0, parts.length - upCount))
      const resolved = [...trimmed, rest].join('/')
      const fileUrl = resolved.startsWith('/') ? `file://${resolved}` : `file:///${resolved}`
      return `${prefix}${fileUrl}${suffix}`
    }
  )
}

export function buildHtmlDocument(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtml(title)
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle}</title>
<style>
${themeCss}
</style>
</head>
<body class="export-page">
<main class="md-body">${bodyHtml}</main>
</body>
</html>`
}
