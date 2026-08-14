import { useCallback, useRef, useState } from 'react'

const MIN_WIDTH = 160
const MAX_WIDTH = 620

/**
 * Draggable sidebar width with localStorage persistence.
 * `direction` is +1 for handles on the right edge (drag right = wider)
 * and -1 for handles on the left edge (drag left = wider).
 */
export function useResizableWidth(
  storageKey: string,
  initialWidth = 260
): {
  width: number
  startResize: (event: React.MouseEvent, direction: 1 | -1) => void
  resetWidth: () => void
} {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number.parseInt(localStorage.getItem(storageKey) ?? '', 10)
      if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved
    } catch {
      // localStorage unavailable — fall back to the default.
    }
    return initialWidth
  })

  const widthRef = useRef(width)
  widthRef.current = width
  const initialRef = useRef(initialWidth)

  const startResize = useCallback(
    (event: React.MouseEvent, direction: 1 | -1) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = widthRef.current
      document.body.classList.add('resizing')

      const onMove = (ev: MouseEvent): void => {
        const next = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX) * direction)
        )
        setWidth(next)
      }
      const onUp = (): void => {
        try {
          localStorage.setItem(storageKey, String(widthRef.current))
        } catch {
          // ignore
        }
        document.body.classList.remove('resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [storageKey]
  )

  const resetWidth = useCallback(() => {
    setWidth(initialRef.current)
    try {
      localStorage.setItem(storageKey, String(initialRef.current))
    } catch {
      // ignore
    }
  }, [storageKey])

  return { width, startResize, resetWidth }
}
