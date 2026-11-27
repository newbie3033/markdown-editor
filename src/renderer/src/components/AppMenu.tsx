import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AppMenuItem } from '../../../shared/ipc'
import { formatShortcut } from '../lib/shortcuts'

const MENU_MIN_WIDTH = 240
const VIEWPORT_MARGIN = 8
const SUBMENU_GAP = 4

function SubmenuPopup({ anchor, id, items, activate, close }: {
  anchor: HTMLButtonElement
  id: string
  items: AppMenuItem[]
  activate: (item: AppMenuItem) => void
  close: () => void
}): React.JSX.Element {
  const popup = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const panel = popup.current
    const parent = anchor.closest('.app-menu-popup, .app-menu-submenu')
    if (!panel || !parent) return

    const position = (): void => {
      const bounds = parent.getBoundingClientRect()
      const trigger = anchor.getBoundingClientRect()
      if (trigger.bottom <= bounds.top || trigger.top >= bounds.bottom) {
        close()
        return
      }

      const rightSpace = window.innerWidth - bounds.right - SUBMENU_GAP - VIEWPORT_MARGIN
      const leftSpace = bounds.left - SUBMENU_GAP - VIEWPORT_MARGIN
      const openRight = rightSpace >= MENU_MIN_WIDTH || rightSpace >= leftSpace
      const availableWidth = openRight ? rightSpace : leftSpace
      panel.style.maxWidth = `${availableWidth}px`
      panel.style.minWidth = `${Math.min(MENU_MIN_WIDTH, availableWidth)}px`

      const { width, height } = panel.getBoundingClientRect()
      const left = openRight ? bounds.right + SUBMENU_GAP : bounds.left - SUBMENU_GAP - width
      const top = Math.min(trigger.top, window.innerHeight - height - VIEWPORT_MARGIN)
      panel.style.left = `${left}px`
      panel.style.top = `${Math.max(VIEWPORT_MARGIN, top)}px`
    }

    position()
    const observer = new ResizeObserver(position)
    observer.observe(parent)
    observer.observe(panel)
    parent.addEventListener('scroll', position)
    window.addEventListener('resize', position)
    return () => {
      observer.disconnect()
      parent.removeEventListener('scroll', position)
      window.removeEventListener('resize', position)
    }
  }, [anchor, close, items])

  useLayoutEffect(() => {
    const panel = popup.current
    const first = panel?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    const target = first ?? panel
    target?.focus({ preventScroll: true })
  }, [])

  return (
    <div id={id} ref={popup} tabIndex={-1} className="app-menu-submenu" onKeyDown={event => {
      if (event.key !== 'Escape' && event.key !== 'ArrowLeft') return
      event.preventDefault()
      event.stopPropagation()
      close()
      anchor.focus({ preventScroll: true })
    }}>
      <MenuItems items={items} activate={activate} />
    </div>
  )
}

function MenuItems({ items, activate }: {
  items: AppMenuItem[]
  activate: (item: AppMenuItem) => void
}): React.JSX.Element {
  const [open, setOpen] = useState<{ index: number; anchor: HTMLButtonElement } | null>(null)
  const submenuId = useId()
  const close = useCallback(() => setOpen(null), [])

  return (
    <ul className="app-menu-items">
      {items.map((item, index) => {
        const expanded = open?.index === index
        return (
          <li key={`${index}:${item.label}`}>
            {item.type === 'separator' ? <hr /> : item.children ? (
              <>
                <button
                  type="button"
                  disabled={!item.enabled}
                  aria-expanded={expanded}
                  aria-controls={expanded ? submenuId : undefined}
                  onClick={event => {
                    if (expanded) {
                      event.currentTarget.focus({ preventScroll: true })
                      setOpen(null)
                    } else {
                      setOpen({ index, anchor: event.currentTarget })
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key !== 'ArrowRight') return
                    event.preventDefault()
                    setOpen({ index, anchor: event.currentTarget })
                  }}
                >
                  <span className="app-menu-check" aria-hidden="true" />
                  <span className="app-menu-item-label">{item.label}</span>
                  <span className="app-menu-submenu-arrow" aria-hidden="true">›</span>
                </button>
                {expanded && (
                  <SubmenuPopup
                    anchor={open.anchor}
                    id={submenuId}
                    items={item.children}
                    activate={activate}
                    close={close}
                  />
                )}
              </>
            ) : (
              <button type="button" title={item.toolTip} disabled={!item.enabled} onClick={() => activate(item)}>
                <span className="app-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
                <span className="app-menu-item-label">{item.label}</span>
                {item.accelerator && <kbd>{formatShortcut(item.accelerator)}</kbd>}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function AppMenu(): React.JSX.Element | null {
  const [items, setItems] = useState<AppMenuItem[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const bar = useRef<HTMLElement>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.onAppMenuUpdated(setItems)
    void window.api.getAppMenu().then(value => { if (active) setItems(value) })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (open === null) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !bar.current?.contains(event.target)) setOpen(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      bar.current?.querySelector<HTMLButtonElement>('.app-menu-group > button[aria-expanded="true"]')?.focus()
      setOpen(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!items) return null
  return (
    <nav ref={bar} className="app-menubar">
      {items.map((item, index) => (
        <div key={`${index}:${item.label}`} className="app-menu-group">
          <button type="button" aria-expanded={open === index}
            onMouseDown={event => event.preventDefault()}
            onClick={() => setOpen(open === index ? null : index)}
            onMouseEnter={() => { if (open !== null) setOpen(index) }}>
            {item.label}
          </button>
          {open === index && item.children && (
            <div className="app-menu-popup" onMouseDown={event => {
              // Keep the editor selection available for Cut, Copy and Paste.
              if (event.target instanceof Element && event.target.closest('button')) event.preventDefault()
            }}>
              <MenuItems items={item.children} activate={item => {
                if (!item.keepOpen) setOpen(null)
                void window.api.activateAppMenu(item.id)
              }} />
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
