import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@milkdown/kit/core'
import type { SearchFlags } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'
import {
  findInStringAsync,
  findTextMatchesAsync,
  replaceAllInString,
  replaceAllMatchesInEditor,
  replaceMatchInEditor,
  replaceRangeInString,
  selectMatch
} from '../lib/search'
import { SearchFlagsToggle } from './SearchFlagsToggle'

interface FindBarProps {
  getEditor: () => Editor | null
  sourceMode: boolean
  sourceText: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onClose: () => void
  /** Whether the replace row is visible (opened via Ctrl+H). */
  replaceOpen: boolean
  onToggleReplace: () => void
  /** Applies replaced text in source mode (updates the document state). */
  onSourceReplace: (text: string) => void
}

export function FindBar({
  getEditor,
  sourceMode,
  sourceText,
  textareaRef,
  onClose,
  replaceOpen,
  onToggleReplace,
  onSourceReplace
}: FindBarProps): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [flags, setFlags] = useState<SearchFlags>({})
  const [replacement, setReplacement] = useState('')
  const [current, setCurrent] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const currentRef = useRef(0)
  currentRef.current = current

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Focus the replace input when the replace row opens (Ctrl+H).
  useEffect(() => {
    if (replaceOpen) replaceInputRef.current?.focus()
  }, [replaceOpen])

  const [matches, setMatches] = useState<Array<{ from: number; to: number }>>([])

  useEffect(() => {
    let canceled = false
    const updateMatches = async (): Promise<void> => {
      if (!query.trim()) {
        setMatches([])
        return
      }
      setMatches([])
      try {
        const editor = getEditor()
        const next = sourceMode
          ? await findInStringAsync(sourceText, query, flags)
          : editor
            ? await findTextMatchesAsync(editor, query, flags)
            : []
        if (!canceled) setMatches(next)
      } catch (error) {
        console.error('Search failed', error)
        if (!canceled) setMatches([])
      }
    }
    void updateMatches()
    return () => {
      canceled = true
    }
  }, [query, flags, sourceMode, sourceText, getEditor])

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

  const selectAtRef = useRef(selectAt)
  selectAtRef.current = selectAt

  // F3 / Shift+F3: find next / previous while the find bar is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'F3') {
        event.preventDefault()
        selectAtRef.current(currentRef.current + (event.shiftKey ? -1 : 1), true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Auto-select the first match while typing (without stealing focus).
  useEffect(() => {
    setCurrent(0)
    if (matches.length > 0) selectAt(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, query, flags, sourceMode, sourceText])

  const replaceCurrent = (): void => {
    if (!query.trim() || matches.length === 0) return
    const match = matches[((current % matches.length) + matches.length) % matches.length]
    if (sourceMode) {
      const next = replaceRangeInString(sourceText, match, replacement)
      onSourceReplace(next)
      const textarea = textareaRef.current
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(match.from + replacement.length, match.from + replacement.length)
      }
    } else {
      const editor = getEditor()
      if (editor) replaceMatchInEditor(editor, match, replacement)
    }
  }

  const replaceAll = (): void => {
    if (!query.trim() || matches.length === 0) return
    if (sourceMode) {
      onSourceReplace(replaceAllInString(sourceText, matches, replacement))
    } else {
      const editor = getEditor()
      if (editor) replaceAllMatchesInEditor(editor, matches, replacement)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      selectAt(event.shiftKey ? current - 1 : current + 1, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const handleReplaceKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      replaceCurrent()
    }
  }

  const countLabel = query.trim()
    ? matches.length === 0
      ? t('find.noMatch')
      : `${current + 1}/${matches.length}`
    : ''

  return (
    <div className="findbar">
      <div className="findbar-main">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={t('find.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
        />
        <SearchFlagsToggle
          flags={flags}
          onToggle={(key) => setFlags((prev) => ({ ...prev, [key]: !prev[key] }))}
        />
        <button
          className={'find-btn replace-toggle' + (replaceOpen ? ' active' : '')}
          onClick={onToggleReplace}
          title={t('find.replaceToggle')}
        >
          ⇄
        </button>
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
      {replaceOpen && (
        <div className="findbar-replace">
          <input
            ref={replaceInputRef}
            type="text"
            value={replacement}
            placeholder={t('find.replaceWith')}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={handleReplaceKeyDown}
            spellCheck={false}
          />
          <button
            className="replace-btn"
            onClick={replaceCurrent}
            disabled={matches.length === 0}
            title={t('find.replace')}
          >
            {t('find.replace')}
          </button>
          <button
            className="replace-btn"
            onClick={replaceAll}
            disabled={matches.length === 0}
            title={t('find.replaceAll')}
          >
            {t('find.replaceAll')}
          </button>
        </div>
      )}
    </div>
  )
}
