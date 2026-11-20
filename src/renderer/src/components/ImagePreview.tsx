import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'

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
  const [fit, setFit] = useState(1)
  const [zoom, setZoom] = useState<number | null>(null)
  const scale = zoom ?? fit
  const minimum = Math.min(fit, 0.125)

  useLayoutEffect(() => {
    const modal = dialog.current!
    const area = viewport.current!
    modal.showModal()
    const measure = (): void => {
      setFit(Math.min(1, area.clientWidth / image.width, area.clientHeight / image.height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => {
      observer.disconnect()
      modal.close()
    }
  }, [image])

  const changeZoom = (factor: number): void => {
    setZoom(value => Math.max(minimum, Math.min(8, (value ?? fit) * factor)))
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
        <button type="button" aria-label={t('status.zoomIn')} disabled={scale >= 8}
          onClick={() => changeZoom(1.5)}>＋</button>
        <button type="button" onClick={() => setZoom(null)}>{t('image.fit')}</button>
        <button type="button" aria-label={t('find.close')} onClick={onClose}>×</button>
      </div>
      <div className="image-preview-viewport" ref={viewport}>
        <img src={image.src} alt={image.alt} draggable={false}
          style={{ width: image.width * scale }} />
      </div>
    </dialog>
  )
}
