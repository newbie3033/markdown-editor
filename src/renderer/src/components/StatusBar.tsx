import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../../shared/ipc'
import type { DocStats } from '../lib/markdown'
import { useI18n } from '../lib/i18n'
import { StatusBarMenu, type StatusBarMenuItem } from './StatusBarMenu'

const chineseNumbers = new Intl.NumberFormat('zh-CN')
const englishNumbers = new Intl.NumberFormat('en-US')

const iconPaths = {
  files: 'M3 6h7l2 2h9v11H3z',
  outline: 'M3 5h17M6 10h14M6 15h14M3 20h17',
  locked: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3',
  edit: 'm4 16 11-11 4 4L8 20l-5 1z M13 7l4 4',
  source: 'm7 7-5 5 5 5m10-10 5 5-5 5m-4-13-3 20',
  moon: 'M20 15A8 8 0 0 1 9 4a8.5 8.5 0 1 0 11 11z',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'
}

function StatusIcon({ name }: { name: keyof typeof iconPaths }): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={iconPaths[name]} />
    </svg>
  )
}

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
  const numberFormat = lang === 'zh' ? chineseNumbers : englishNumbers
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

  const handleCopyPath = async (): Promise<void> => {
    if (!filePath) return
    try {
      await window.api.copyText(filePath)
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
            aria-pressed={showSidebar}
            title={t('status.toggleSidebar')}
          >
            <StatusIcon name="files" />
          </button>
        )}
        {visible.outline && (
          <button
            className={`status-item status-btn toggle-outline-btn${showOutline ? ' active' : ''}`}
            onClick={onToggleOutline}
            aria-pressed={showOutline}
            title={t('status.toggleOutline')}
          >
            <StatusIcon name="outline" />
          </button>
        )}
        {visible.dirty && <span className="status-item dirty-indicator">{dirty ? '●' : '○'}</span>}
        {visible.path && (
          <button
            className={`status-item status-path-btn${filePath ? '' : ' disabled'}`}
            onClick={() => void handleCopyPath()}
            title={filePath ? t('status.copyPath') : undefined}
          >
            {filePath ?? t('status.untitled')}
          </button>
        )}
      </div>
      <div className="statusbar-right">
        <button
          className={`status-item status-btn toggle-readonly-btn${readOnly ? ' active' : ''}`}
          aria-pressed={readOnly}
          onClick={onToggleReadOnly}
          title={readOnly ? t('status.editMode') : t('status.readOnly')}
        >
          <StatusIcon name={readOnly ? 'locked' : 'edit'} />
        </button>
        {visible.source && (
          <button
            className={`status-item status-btn${sourceMode ? ' active' : ''}`}
            onClick={onToggleSource}
            aria-pressed={sourceMode}
            title={t('status.sourceMode')}
          >
            <StatusIcon name="source" />
          </button>
        )}
        {visible.theme && (
          <button className="status-item status-btn" onClick={onToggleTheme} title={t('status.theme')}>
            <StatusIcon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
        )}
        {visible.lang && (
          <button className="status-item status-btn" onClick={onToggleLang} title={t('status.language')}>
            {lang === 'zh' ? 'EN' : '中'}
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
              +
            </button>
          </span>
        )}
        {(visible.words || visible.chars || visible.lines) && (
          <div className="status-counts">
            {visible.words && <span><b>{numberFormat.format(stats.words)}</b> {t('status.words')}</span>}
            {visible.chars && (
              <span title={t('status.characterHint')}>
                <b>{numberFormat.format(stats.characters)}</b> {t('status.chars')}
              </span>
            )}
            {visible.lines && <span><b>{numberFormat.format(stats.lines)}</b> {t('status.lines')}</span>}
          </div>
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
