import type { OutlineItem } from '../lib/markdown'
import { useI18n } from '../lib/i18n'
import { Outline } from './Outline'

interface OutlinePanelProps {
  outline: OutlineItem[]
  onNavigate: (id: string) => void
  width: number
  onResizeStart: (event: React.MouseEvent, direction: 1 | -1) => void
  onResetWidth: () => void
}

export function OutlinePanel({
  outline,
  onNavigate,
  width,
  onResizeStart,
  onResetWidth
}: OutlinePanelProps): React.JSX.Element {
  const { t } = useI18n()
  return (
    <aside className="sidebar outline-sidebar" style={{ width }}>
      <div className="sidebar-toolbar">
        <span className="panel-title">{t('outline.title')}</span>
      </div>
      <div className="sidebar-scroll">
        <Outline items={outline} onNavigate={onNavigate} />
      </div>
      <div
        className="resize-handle left"
        onMouseDown={(event) => onResizeStart(event, -1)}
        onDoubleClick={onResetWidth}
        title={t('status.toggleOutline')}
      />
    </aside>
  )
}
