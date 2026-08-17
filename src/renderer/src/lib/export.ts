import themeCss from '../styles/theme.css?raw'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildHtmlDocument(bodyHtml: string, title: string): string {
  const safeTitle = escapeHtml(title)
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: inkmark-asset:" />
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
