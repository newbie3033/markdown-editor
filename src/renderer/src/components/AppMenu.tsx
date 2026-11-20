import { useEffect, useRef, useState } from 'react'
import type { AppMenuItem } from '../../../shared/ipc'
import { formatShortcut } from '../lib/shortcuts'

function MenuItems({ items, activate }: {
  items: AppMenuItem[]
  activate: (id: number) => void
}): React.JSX.Element {
  return (
    <ul className="app-menu-items">
      {items.map(item => (
        <li key={item.id}>
          {item.type === 'separator' ? <hr /> : item.children ? (
            <details>
              <summary>{item.label}</summary>
              <MenuItems items={item.children} activate={activate} />
            </details>
          ) : (
            <button type="button" disabled={!item.enabled} onClick={() => activate(item.id)}>
              <span className="app-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
              <span>{item.label}</span>
              {item.accelerator && <kbd>{formatShortcut(item.accelerator)}</kbd>}
            </button>
          )}
        </li>
      ))}
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
      bar.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus()
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
        <div key={item.id} className="app-menu-group">
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
              <MenuItems items={item.children} activate={id => {
                setOpen(null)
                void window.api.activateAppMenu(id)
              }} />
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
