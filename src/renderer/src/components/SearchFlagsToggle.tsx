import type { SearchFlags } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'

export type SearchFlagKey = 'caseSensitive' | 'wholeWord' | 'regex'

interface SearchFlagsToggleProps {
  flags: SearchFlags
  /** Toggle a single flag; the parent applies it as a functional state
   *  update so rapid consecutive clicks never clobber each other. */
  onToggle: (key: SearchFlagKey) => void
}

/**
 * VS Code-style search options: match case (Aa), match whole word (ab) and
 * regular expression (.*) toggle buttons.
 */
export function SearchFlagsToggle({ flags, onToggle }: SearchFlagsToggleProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="search-mode-toggle">
      <button
        className={`mode-btn${flags.caseSensitive ? ' active' : ''}`}
        title={t('search.matchCaseTip')}
        onClick={() => onToggle('caseSensitive')}
      >
        {t('search.matchCase')}
      </button>
      <button
        className={`mode-btn ww${flags.wholeWord ? ' active' : ''}`}
        title={t('search.wholeWordTip')}
        onClick={() => onToggle('wholeWord')}
      >
        {t('search.wholeWord')}
      </button>
      <button
        className={`mode-btn${flags.regex ? ' active' : ''}`}
        title={t('search.regexTip')}
        onClick={() => onToggle('regex')}
      >
        {t('search.regex')}
      </button>
    </div>
  )
}
