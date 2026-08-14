import { useEffect, useLayoutEffect, useRef } from 'react'

export interface StatusBarMenuItem {
  id: string
  label: string
  visible: boolean
}

interface StatusBarMenuProps {
  x: number
  y: number
  title: string
  items: StatusBarMenuItem[]
  onToggle: (id: StatusBarMenuItem['id']) => void
  onClose: () => void
}

export function StatusBarMenu({
  x,
  y,
  title,
  items,
  onToggle,
  onClose
}: StatusBarMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Clamp the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }, [x, y])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onBlur = (): void => onClose()
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [onClose])

  return (
    <div
      className="statusbar-menu"
      ref={menuRef}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="menu-title">{title}</div>
      {items.map((item) => (
        <button key={item.id} className="menu-item" onClick={() => onToggle(item.id)}>
          <span className={`menu-check${item.visible ? ' checked' : ''}`}>
            {item.visible ? '✓' : ''}
          </span>
          <span className="menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  )
}
