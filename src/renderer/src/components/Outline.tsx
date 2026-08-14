import type { OutlineItem } from '../lib/markdown'
import { useI18n } from '../lib/i18n'

interface OutlineProps {
  items: OutlineItem[]
  onNavigate: (id: string) => void
}

export function Outline({ items, onNavigate }: OutlineProps): React.JSX.Element {
  const { t } = useI18n()
  if (items.length === 0) {
    return <div className="tree-empty">{t('outline.empty')}</div>
  }
  return (
    <div className="outline">
      {items.map((item, index) => (
        <button
          key={`${item.id}-${index}`}
          className="outline-item"
          style={{ paddingLeft: 8 + (item.level - 1) * 14 }}
          onClick={() => onNavigate(item.id)}
          title={item.text}
        >
          <span className={`outline-bullet h${item.level}`}>H{item.level}</span>
          <span className="outline-text">{item.text}</span>
        </button>
      ))}
    </div>
  )
}
