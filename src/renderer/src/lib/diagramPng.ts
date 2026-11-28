// Size the bitmap from the diagram's own coordinate system, independent of the
// editor viewport. Bound the canvas allocation for unusually large diagrams.
export async function diagramCanvas(svg: SVGSVGElement, background: string): Promise<HTMLCanvasElement> {
  const { width, height } = svg.viewBox.baseVal
  if (!(width > 0 && height > 0)) throw new Error('Invalid SVG dimensions')
  const padding = 16
  const fullWidth = width + 2 * padding
  const fullHeight = height + 2 * padding
  const scale = Math.min(2, 8192 / Math.max(fullWidth, fullHeight), Math.sqrt(8_000_000 / (fullWidth * fullHeight)))

  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('width', String(width * scale))
  copy.setAttribute('height', String(height * scale))
  copy.style.maxWidth = 'none'
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy))
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(fullWidth * scale)
  canvas.height = Math.ceil(fullHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, padding * scale, padding * scale, width * scale, height * scale)
  return canvas
}

export async function diagramPng(svg: SVGSVGElement, background: string): Promise<ArrayBuffer> {
  const canvas = await diagramCanvas(svg, background)
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png')
  })
  return png.arrayBuffer()
}
