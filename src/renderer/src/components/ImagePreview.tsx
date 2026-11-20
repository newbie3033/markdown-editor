import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'

const MAX_ZOOM = 8

interface ZoomAnchor {
  x: number
  y: number
  clientX: number
  clientY: number
}

export interface PreviewImage {
  src: string
  alt: string
  width: number
  height: number
}

export function ImagePreview({ image, onClose }: {
  image: PreviewImage
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLImageElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const [panning, setPanning] = useState(false)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState<{ scale: number; anchor?: ZoomAnchor } | null>(null)
  const fit = size ? Math.min(1, size.width / image.width, size.height / image.height) : 1
  const scale = zoom?.scale ?? fit
  const minimum = Math.min(fit, 0.125)
  const canPan = size !== null && (image.width * scale > size.width || image.height * scale > size.height)

  useLayoutEffect(() => {
    const modal = dialog.current!
    const area = viewport.current!
    modal.showModal()
    const measure = (): void => {
      const width = area.clientWidth
      const height = area.clientHeight
      setSize(value => value?.width === width && value.height === height ? value : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => {
      observer.disconnect()
      modal.close()
    }
  }, [image])

  const changeZoom = useCallback((factor: number, anchor?: ZoomAnchor): void => {
    setZoom(value => {
      const current = value?.scale ?? fit
      const next = Math.max(minimum, Math.min(MAX_ZOOM, current * factor))
      return next === current ? value : { scale: next, anchor }
    })
  }, [fit, minimum])

  useLayoutEffect(() => {
    const area = viewport.current!
    const img = preview.current!
    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY === 0 || event.shiftKey) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.clientHeight : 1
      const rect = img.getBoundingClientRect()
      const { clientX, clientY } = event
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      const anchor = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y, clientX, clientY } : undefined
      changeZoom(Math.exp(-event.deltaY * unit * 0.0025), anchor)
    }
    area.addEventListener('wheel', onWheel, { passive: false })
    return () => area.removeEventListener('wheel', onWheel)
  }, [changeZoom])

  useLayoutEffect(() => {
    const area = viewport.current!
    if (!zoom) {
      area.scrollTo(0, 0)
      return
    }
    if (!zoom.anchor) return
    const { x, y, clientX, clientY } = zoom.anchor
    const rect = preview.current!.getBoundingClientRect()
    area.scrollLeft += rect.left + x * rect.width - clientX
    area.scrollTop += rect.top + y * rect.height - clientY
  }, [zoom])

  const endDrag = (pointerId: number): void => {
    if (drag.current?.pointerId !== pointerId) return
    drag.current = null
    setPanning(false)
  }

  return (
    <dialog ref={dialog} className="image-preview" aria-label={t('image.preview')}
      onCancel={onClose}
      onClick={event => { if (event.target === dialog.current) onClose() }}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === '+' || event.key === '=') changeZoom(1.5)
        else if (event.key === '-') changeZoom(1 / 1.5)
        else if (event.key === '0') setZoom(null)
        else return
        event.preventDefault()
      }}
    >
      <div className="image-preview-controls">
        <button type="button" aria-label={t('status.zoomOut')} disabled={scale <= minimum}
          onClick={() => changeZoom(1 / 1.5)}>−</button>
        <output>{Math.round(scale * 100)}%</output>
        <button type="button" aria-label={t('status.zoomIn')} disabled={scale >= MAX_ZOOM}
          onClick={() => changeZoom(1.5)}>＋</button>
        <button type="button" onClick={() => setZoom(null)}>{t('image.fit')}</button>
        <button type="button" aria-label={t('find.close')} onClick={onClose}>×</button>
      </div>
      <div className="image-preview-viewport" ref={viewport}
        data-pannable={canPan || undefined}
        data-panning={panning || undefined}
        onPointerDown={event => {
          if (event.button !== 0 || event.target !== preview.current || !canPan || drag.current) return
          const area = event.currentTarget
          area.setPointerCapture(event.pointerId)
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: area.scrollLeft,
            top: area.scrollTop
          }
          setPanning(true)
        }}
        onPointerMove={event => {
          const start = drag.current
          if (start?.pointerId !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX
          event.currentTarget.scrollTop = start.top + start.y - event.clientY
        }}
        onPointerUp={event => endDrag(event.pointerId)}
        onPointerCancel={event => endDrag(event.pointerId)}
        onLostPointerCapture={event => endDrag(event.pointerId)}
      >
        <img ref={preview} src={image.src} alt={image.alt} draggable={false}
          style={{ width: image.width * scale }} />
      </div>
    </dialog>
  )
}
