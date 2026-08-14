import type { SearchMode } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'

interface SearchModeToggleProps {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
}

const MODES: Array<{ id: SearchMode; labelKey: 'search.mode.text' | 'search.mode.wildcard' | 'search.mode.regex'; tipKey: 'search.mode.textTip' | 'search.mode.wildcardTip' | 'search.mode.regexTip' }> = [
  { id: 'text', labelKey: 'search.mode.text', tipKey: 'search.mode.textTip' },
  { id: 'wildcard', labelKey: 'search.mode.wildcard', tipKey: 'search.mode.wildcardTip' },
  { id: 'regex', labelKey: 'search.mode.regex', tipKey: 'search.mode.regexTip' }
]

export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="search-mode-toggle">
      {MODES.map((item) => (
        <button
          key={item.id}
          className={`mode-btn${mode === item.id ? ' active' : ''}`}
          title={t(item.tipKey)}
          onClick={() => onChange(item.id)}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  )
}
