import { useEffect, useRef, useState } from 'react'
import type { FileSearchResult, SearchMode } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'
import { SearchModeToggle } from './SearchModeToggle'

interface SearchPanelProps {
  folderPaths: string[]
  onOpenResult: (path: string, matchIndex: number, query: string, mode: SearchMode) => void
}

export function SearchPanel({ folderPaths, onOpenResult }: SearchPanelProps): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('text')
  const [results, setResults] = useState<FileSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q || folderPaths.length === 0) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void Promise.all(folderPaths.map((folder) => window.api.searchFiles(folder, q, mode)))
        .then((perFolder) =>
          perFolder
            .flat()
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        )
        .then((merged) => setResults(merged))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, mode, folderPaths])

  const trimmed = query.trim()

  return (
    <div className="search-panel">
      <div className="search-bar">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
          spellCheck={false}
        />
        <SearchModeToggle mode={mode} onChange={setMode} />
      </div>
      <div className="sidebar-scroll">
        {folderPaths.length === 0 ? (
          <div className="tree-empty">{t('search.noFolder')}</div>
        ) : !trimmed ? (
          <div className="tree-empty">{t('search.noQuery')}</div>
        ) : searching && results.length === 0 ? (
          <div className="tree-empty">…</div>
        ) : results.length === 0 ? (
          <div className="tree-empty">{t('search.noResults')}</div>
        ) : (
          <div className="search-results">
            {results.map((result) => (
              <div key={result.path} className="search-file">
                <button
                  className="search-file-header"
                  title={result.path}
                  onClick={() =>
                    onOpenResult(result.path, result.matches[0]?.globalIndex ?? -1, trimmed, mode)
                  }
                >
                  <span className="tree-icon">📄</span>
                  <span className="search-file-name">{result.name}</span>
                  {result.nameMatch && <span className="search-badge">{t('search.nameBadge')}</span>}
                  <span className="search-count">{t('search.matches', { n: result.totalMatches })}</span>
                </button>
                {result.matches.slice(0, 15).map((match) => (
                  <button
                    key={`${match.globalIndex}-${match.line}`}
                    className="search-hit"
                    onClick={() => onOpenResult(result.path, match.globalIndex, trimmed, mode)}
                  >
                    <span className="search-line">{match.line}</span>
                    <span className="search-text">{match.text}</span>
                  </button>
                ))}
                {result.matches.length > 15 && (
                  <div className="search-more">
                    {t('search.matches', { n: result.totalMatches })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
