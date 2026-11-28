import { memo } from 'react'
import type { OutlineItem } from '../lib/markdown'
import { useI18n } from '../lib/i18n'

interface OutlineProps {
  items: OutlineItem[]
  disabled: boolean
  onNavigate: (pos: number) => void
}

export const Outline = memo(function Outline({ items, disabled, onNavigate }: OutlineProps): React.JSX.Element {
  const { t } = useI18n()
  if (items.length === 0) {
    return <div className="tree-empty">{t('outline.empty')}</div>
  }
  return (
    <div className="outline">
      {items.map((item) => (
        <button
          key={item.pos}
          className="outline-item"
          disabled={disabled}
          style={{ paddingLeft: 8 + (item.level - 1) * 14 }}
          onClick={() => onNavigate(item.pos)}
          title={item.text}
        >
          <span className={`outline-bullet h${item.level}`}>H{item.level}</span>
          <span className="outline-text">{item.text}</span>
        </button>
      ))}
    </div>
  )
})
