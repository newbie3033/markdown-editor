import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../../shared/ipc'
import type { DocStats } from '../lib/markdown'
import { useI18n } from '../lib/i18n'
import { StatusBarMenu, type StatusBarMenuItem } from './StatusBarMenu'

type StatusBarItemId =
  | 'sidebar'
  | 'outline'
  | 'dirty'
  | 'path'
  | 'source'
  | 'theme'
  | 'lang'
  | 'zoom'
  | 'words'
  | 'chars'
  | 'lines'

const DEFAULT_VISIBLE: Record<StatusBarItemId, boolean> = {
  sidebar: true,
  outline: true,
  dirty: true,
  path: true,
  source: true,
  theme: true,
  lang: true,
  zoom: true,
  words: true,
  chars: true,
  lines: true
}

const STORAGE_KEY = 'inkmark.statusbarItems'

function loadVisibility(): Record<StatusBarItemId, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<StatusBarItemId, boolean>
    >
    return { ...DEFAULT_VISIBLE, ...saved }
  } catch {
    return { ...DEFAULT_VISIBLE }
  }
}

interface MenuItemDef {
  id: StatusBarItemId
  labelKey:
    | 'status.toggleSidebar'
    | 'status.toggleOutline'
    | 'status.dirtyIndicator'
    | 'status.filePathLabel'
    | 'status.sourceMode'
    | 'status.theme'
    | 'status.language'
    | 'status.zoomLabel'
    | 'status.words'
    | 'status.chars'
    | 'status.lines'
}

const MENU_ITEMS: MenuItemDef[] = [
  { id: 'sidebar', labelKey: 'status.toggleSidebar' },
  { id: 'outline', labelKey: 'status.toggleOutline' },
  { id: 'dirty', labelKey: 'status.dirtyIndicator' },
  { id: 'path', labelKey: 'status.filePathLabel' },
  { id: 'source', labelKey: 'status.sourceMode' },
  { id: 'theme', labelKey: 'status.theme' },
  { id: 'lang', labelKey: 'status.language' },
  { id: 'zoom', labelKey: 'status.zoomLabel' },
  { id: 'words', labelKey: 'status.words' },
  { id: 'chars', labelKey: 'status.chars' },
  { id: 'lines', labelKey: 'status.lines' }
]

interface StatusBarProps {
  stats: DocStats
  filePath: string | null
  dirty: boolean
  sourceMode: boolean
  theme: 'light' | 'dark'
  lang: Lang
  zoomLevel: number
  readOnly: boolean
  showSidebar: boolean
  showOutline: boolean
  onToggleSource: () => void
  onToggleTheme: () => void
  onToggleLang: () => void
  onToggleSidebar: () => void
  onToggleOutline: () => void
  onToggleReadOnly: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export function StatusBar({
  stats,
  filePath,
  dirty,
  sourceMode,
  theme,
  lang,
  zoomLevel,
  readOnly,
  showSidebar,
  showOutline,
  onToggleSource,
  onToggleTheme,
  onToggleLang,
  onToggleSidebar,
  onToggleOutline,
  onToggleReadOnly,
  onZoomIn,
  onZoomOut,
  onZoomReset
}: StatusBarProps): React.JSX.Element {
  const { t } = useI18n()
  const zoomPercent = Math.round(Math.pow(1.2, zoomLevel) * 100)
  const [visible, setVisible] = useState<Record<StatusBarItemId, boolean>>(loadVisibility)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const showToast = (kind: 'success' | 'error', text: string): void => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ kind, text })
    toastTimerRef.current = setTimeout(() => setToast(null), 1600)
  }

  const handleCopyPath = (): void => {
    if (!filePath) return
    try {
      window.api.copyText(filePath)
      showToast('success', t('status.copySuccess'))
    } catch {
      showToast('error', t('status.copyFail'))
    }
  }

  const toggleItem = (id: string): void => {
    const itemId = id as StatusBarItemId
    setVisible((prev) => {
      const next = { ...prev, [itemId]: !prev[itemId] }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const onContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  const menuItems: StatusBarMenuItem[] = MENU_ITEMS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
    visible: visible[item.id]
  }))

  return (
    <footer className="statusbar" onContextMenu={onContextMenu}>
      <div className="statusbar-left">
        {visible.sidebar && (
          <button
            className={`status-item status-btn toggle-sidebar-btn${showSidebar ? ' active' : ''}`}
            onClick={onToggleSidebar}
            title={t('status.toggleSidebar')}
          >
            📁
          </button>
        )}
        {visible.outline && (
          <button
            className={`status-item status-btn toggle-outline-btn${showOutline ? ' active' : ''}`}
            onClick={onToggleOutline}
            title={t('status.toggleOutline')}
          >
            ☰
          </button>
        )}
        {visible.dirty && <span className="status-item dirty-indicator">{dirty ? '●' : '○'}</span>}
        {visible.path && (
          <button
            className={`status-item status-path-btn${filePath ? '' : ' disabled'}`}
            onClick={handleCopyPath}
            title={filePath ? t('status.copyPath') : undefined}
          >
            {filePath ?? t('status.untitled')}
          </button>
        )}
      </div>
      <div className="statusbar-right">
        <button
          className={`status-item status-btn toggle-readonly-btn${readOnly ? ' active' : ''}`}
          onClick={onToggleReadOnly}
          title={readOnly ? t('status.editMode') : t('status.readOnly')}
        >
          {readOnly ? '🔒' : '✏️'}
        </button>
        {visible.source && (
          <button
            className={`status-item status-btn${sourceMode ? ' active' : ''}`}
            onClick={onToggleSource}
            title={t('status.sourceMode')}
          >
            {'</>'}
          </button>
        )}
        {visible.theme && (
          <button className="status-item status-btn" onClick={onToggleTheme} title={t('status.theme')}>
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        )}
        {visible.lang && (
          <button className="status-item status-btn" onClick={onToggleLang} title={t('status.language')}>
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        )}
        {visible.zoom && (
          <span className="status-zoom">
            <button className="status-btn zoom-out" onClick={onZoomOut} title={t('status.zoomOut')}>
              −
            </button>
            <button className="status-btn zoom-value" onClick={onZoomReset} title={t('status.zoomReset')}>
              {zoomPercent}%
            </button>
            <button className="status-btn zoom-in" onClick={onZoomIn} title={t('status.zoomIn')}>
              ＋
            </button>
          </span>
        )}
        {visible.words && (
          <span className="status-item">
            {stats.words} {t('status.words')}
          </span>
        )}
        {visible.chars && (
          <span className="status-item">
            {stats.characters} {t('status.chars')}
          </span>
        )}
        {visible.lines && (
          <span className="status-item">
            {stats.lines} {t('status.lines')}
          </span>
        )}
      </div>
      {toast && <div className={`status-toast ${toast.kind}`}>{toast.text}</div>}
      {menu && (
        <StatusBarMenu
          x={menu.x}
          y={menu.y}
          title={t('status.itemsTitle')}
          items={menuItems}
          onToggle={toggleItem}
          onClose={() => setMenu(null)}
        />
      )}
    </footer>
  )
}
