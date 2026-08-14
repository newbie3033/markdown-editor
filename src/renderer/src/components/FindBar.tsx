import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@milkdown/kit/core'
import type { SearchMode } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'
import { findInString, findTextMatches, selectMatch } from '../lib/search'
import { SearchModeToggle } from './SearchModeToggle'

interface FindBarProps {
  getEditor: () => Editor | null
  sourceMode: boolean
  sourceText: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onClose: () => void
}

export function FindBar({
  getEditor,
  sourceMode,
  sourceText,
  textareaRef,
  onClose
}: FindBarProps): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('text')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    if (!query.trim()) return []
    if (sourceMode) return findInString(sourceText, query, mode)
    const editor = getEditor()
    return editor ? findTextMatches(editor, query, mode) : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, sourceMode, sourceText, getEditor])

  const selectAt = (index: number, focus: boolean): void => {
    if (matches.length === 0) return
    const wrapped = ((index % matches.length) + matches.length) % matches.length
    setCurrent(wrapped)
    const match = matches[wrapped]
    if (sourceMode) {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.setSelectionRange(match.from, match.to)
      if (focus) {
        textarea.focus()
        const line = sourceText.slice(0, match.from).split('\n').length - 1
        textarea.scrollTop = Math.max(0, line * 23 - textarea.clientHeight / 3)
      }
    } else {
      const editor = getEditor()
      if (editor) selectMatch(editor, match, focus)
    }
  }

  // Auto-select the first match while typing (without stealing focus).
  useEffect(() => {
    setCurrent(0)
    if (matches.length > 0) selectAt(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, sourceMode, sourceText])

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      selectAt(event.shiftKey ? current - 1 : current + 1, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const countLabel = query.trim()
    ? matches.length === 0
      ? t('find.noMatch')
      : `${current + 1}/${matches.length}`
    : ''

  return (
    <div className="findbar">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={t('find.placeholder')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      <SearchModeToggle mode={mode} onChange={setMode} />
      <span className="find-count">{countLabel}</span>
      <button className="find-btn" onClick={() => selectAt(current - 1, true)} title={t('find.prev')}>
        ▲
      </button>
      <button className="find-btn" onClick={() => selectAt(current + 1, true)} title={t('find.next')}>
        ▼
      </button>
      <button className="find-btn" onClick={onClose} title={t('find.close')}>
        ✕
      </button>
    </div>
  )
}
