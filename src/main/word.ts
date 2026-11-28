import htmlToDocx from '@turbodocx/html-to-docx'
import sanitizeHtml from 'sanitize-html'

/** Only pass embedded images to the converter. File access and remote downloads
 * belong to the same capability-checked image pipeline used by other exports. */
export async function buildWordDocument(body: string, title: string, warnings: Set<string>): Promise<Buffer> {
  const html = sanitizeHtml(body, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'hr',
      'b', 'strong', 'i', 'em', 'u', 's', 'del', 'sub', 'sup', 'blockquote', 'pre', 'code',
      'a', 'img', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'
    ],
    allowedAttributes: {
      a: ['href'], img: ['src', 'alt', 'width', 'height'], ol: ['start'], span: ['style'],
      th: ['rowspan', 'colspan', 'style'], td: ['rowspan', 'colspan', 'style']
    },
    allowedStyles: {
      '*': { 'text-align': [/^(?:left|center|right)$/] },
      span: { 'font-family': [/^Courier New$/] }
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    transformTags: {
      code: sanitizeHtml.simpleTransform('span', { style: 'font-family: Courier New' }, false),
      img(tagName, attribs) {
        const { src = '', alt = '' } = attribs
        if (/^data:image\/(?:png|jpeg|gif|bmp|svg\+xml|webp|avif|x-icon);base64,/i.test(src)) {
          return { tagName, attribs }
        }
        if (src) warnings.add(src.startsWith('data:') ? alt || 'data:image' : src)
        return { tagName: 'span', attribs: {}, text: alt }
      }
    }
  })
  const result = await htmlToDocx(html || '<p></p>', null, {
    title,
    creator: 'InkMark',
    lastModifiedBy: 'InkMark',
    preprocessing: { skipHTMLMinify: true },
    imageProcessing: { svgHandling: 'native' }
  })
  if (Buffer.isBuffer(result)) return result
  return Buffer.from(result instanceof ArrayBuffer ? result : await result.arrayBuffer())
}
