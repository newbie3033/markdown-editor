import createDOMPurify from 'dompurify'

const sourceSelector = 'span[data-type="html"]'
const commentSelector = 'span[data-type="html_comment"]'
const trustedAttribute = 'data-inkmark-generated'
const allowedStyles = new Set([
  'background-color', 'border-collapse', 'border-color', 'border-style', 'border-width',
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'height', 'line-height',
  'list-style-type', 'max-height', 'max-width', 'min-height', 'min-width', 'text-align',
  'text-decoration', 'vertical-align', 'white-space', 'width'
])

const sanitizer = createDOMPurify(window)
const generatedAttributes = new Map<string, Map<string, string>>()
const generatedElements = new WeakMap<Element, Map<string, string>>()
sanitizer.addHook('uponSanitizeElement', element => {
  if (!(element instanceof Element)) return
  const attributes = generatedAttributes.get(element.getAttribute(trustedAttribute) ?? '')
  if (attributes) generatedElements.set(element, attributes)
})
sanitizer.addHook('uponSanitizeAttribute', (element, attribute) => {
  const name = attribute.attrName
  if (name === trustedAttribute) {
    attribute.keepAttr = false
    return
  }
  // Application classes and data attributes also serve as editor control hooks.
  if (name === 'class' || name.startsWith('data-')) {
    attribute.keepAttr = generatedElements.get(element)?.get(name) === attribute.attrValue
  }
  if (name === 'name' && element.localName !== 'a' && element.localName !== 'details') {
    attribute.keepAttr = false
  }
  if (name === 'style') {
    const style = document.createElement('span').style
    style.cssText = attribute.attrValue
    for (const property of Array.from(style)) {
      if (!allowedStyles.has(property) || /url\s*\(|var\s*\(|\\/i.test(style.getPropertyValue(property))) {
        style.removeProperty(property)
      }
    }
    attribute.attrValue = style.cssText
    attribute.keepAttr = Boolean(attribute.attrValue)
  }
})

interface RenderedGroup {
  from: number
  to: number
  content: DocumentFragment
}

// The serializer emits trusted markup and inert spans for raw HTML tokens.
// Reassemble the tokens before parsing so inline tags can enclose Markdown and
// block tags can span several Markdown paragraphs. Template parsing stays inert.
export function renderHtmlGroups(source: DocumentFragment): RenderedGroup[] {
  const children = Array.from(source.childNodes)
  const includesHtml = children.map(node => node instanceof Element &&
    (node.matches(sourceSelector) || Boolean(node.querySelector(sourceSelector))))
  if (!includesHtml.some(Boolean)) return []

  const marker = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
  const template = document.createElement('template')
  generatedAttributes.clear()
  const serialized = children.map((node, index) => {
    const holder = document.createElement('template')
    holder.content.append(node.cloneNode(true))
    const values: string[] = []
    for (const comment of holder.content.querySelectorAll<HTMLElement>(commentSelector)) {
      comment.replaceWith((comment.dataset.leading ?? '') + (comment.dataset.trailing ?? ''))
    }
    for (const token of holder.content.querySelectorAll<HTMLElement>(sourceSelector)) {
      values.push(token.dataset.value ?? '')
      token.replaceWith(holder.content.ownerDocument.createComment(`${marker}:raw:${values.length - 1}`))
    }
    // Milkdown wraps block HTML in a synthetic paragraph to fit its inline schema.
    for (const paragraph of holder.content.querySelectorAll('p')) {
      const nodes = Array.from(paragraph.childNodes)
      const isToken = (child: ChildNode) =>
        child.nodeType === Node.COMMENT_NODE && child.nodeValue?.startsWith(`${marker}:raw:`)
      if (nodes.some(isToken) && nodes.every(child => isToken(child) ||
        (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()))) {
        paragraph.replaceWith(...nodes)
      }
    }
    for (const element of holder.content.querySelectorAll('*')) {
      const attributes = new Map(Array.from(element.attributes)
        .filter(attribute => attribute.name === 'class' || attribute.name.startsWith('data-'))
        .map(attribute => [attribute.name, attribute.value]))
      if (!attributes.size) continue
      const value = `${marker}:${generatedAttributes.size}`
      generatedAttributes.set(value, attributes)
      element.setAttribute(trustedAttribute, value)
    }
    const html = holder.innerHTML.replace(new RegExp(`<!--${marker}:raw:(\\d+)-->`, 'g'),
      (_match, token: string) => values[Number(token)])
    return `${html}<!--${marker}:end:${index}-->`
  })
  template.innerHTML = serialized.join('')

  const boundary = new RegExp(`^${marker}:end:(\\d+)$`)
  const groups: RenderedGroup[] = []
  let from = 0
  let pending = document.createElement('template')
  const finish = (to: number) => {
    if (includesHtml.slice(from, to).includes(true)) {
      const markers = pending.content.ownerDocument.createTreeWalker(pending.content, NodeFilter.SHOW_COMMENT)
      const comments: Node[] = []
      while (markers.nextNode()) comments.push(markers.currentNode)
      for (const comment of comments) comment.parentNode?.removeChild(comment)
      const content = sanitizer.sanitize(pending.innerHTML, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
        RETURN_DOM_FRAGMENT: true,
        FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'link', 'meta', 'object', 'script', 'style', 'template'],
        FORBID_ATTR: [
          'accesskey', 'autofocus', 'command', 'commandfor', 'contenteditable', 'download', 'form',
          'formaction', 'ping', 'popover', 'popovertarget', 'popovertargetaction', 'srcset', 'target'
        ],
        ADD_URI_SAFE_ATTR: ['data-value']
      })
      groups.push({ from, to, content })
    }
    from = to
    pending = document.createElement('template')
  }

  for (const node of Array.from(template.content.childNodes)) {
    const match = node.nodeType === Node.COMMENT_NODE && boundary.exec(node.nodeValue ?? '')
    if (match) finish(Number(match[1]) + 1)
    else pending.content.append(node)
  }
  if (from < children.length) finish(children.length)
  generatedAttributes.clear()
  return groups
}

export function renderDocumentHtml(source: DocumentFragment): void {
  const children = Array.from(source.childNodes)
  for (const { from, to, content } of renderHtmlGroups(source)) {
    children[from].before(content)
    for (const child of children.slice(from, to)) source.removeChild(child)
  }
}
