import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  StorageCategory,
  StorageCategoryId,
  StorageStats
} from '../../../shared/ipc'
import { useI18n, type MessageKey } from '../lib/i18n'

interface StorageManagerProps {
  open: boolean
  protectRecovery: boolean
  onClose: () => void
}

const CATEGORY_COPY: Record<
  StorageCategoryId,
  { name: MessageKey; description: MessageKey; mark: string }
> = {
  application: {
    name: 'storage.application.name',
    description: 'storage.application.description',
    mark: 'A'
  },
  cache: {
    name: 'storage.cache.name',
    description: 'storage.cache.description',
    mark: 'C'
  },
  logs: {
    name: 'storage.logs.name',
    description: 'storage.logs.description',
    mark: 'L'
  },
  crashReports: {
    name: 'storage.crashReports.name',
    description: 'storage.crashReports.description',
    mark: '!'
  },
  backups: {
    name: 'storage.backups.name',
    description: 'storage.backups.description',
    mark: 'B'
  },
  recovery: {
    name: 'storage.recovery.name',
    description: 'storage.recovery.description',
    mark: 'R'
  },
  preferences: {
    name: 'storage.preferences.name',
    description: 'storage.preferences.description',
    mark: 'S'
  }
}

function formatBytes(bytes: number, lang: 'en' | 'zh'): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2
  }).format(value)} ${units[unit]}`
}

export function StorageManager({
  open,
  protectRecovery,
  onClose
}: StorageManagerProps): React.JSX.Element | null {
  const { t, lang } = useI18n()
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [selected, setSelected] = useState<Set<StorageCategoryId>>(new Set())
  const [loading, setLoading] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [notice, setNotice] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const next = await window.api.getStorageStats()
      setStats(next)
      setSelected((current) => {
        const available = new Set(
          next.categories
            .filter((category) => category.cleanable && category.bytes > 0)
            .map((category) => category.id)
        )
        return new Set(Array.from(current).filter((id) => available.has(id)))
      })
    } catch (error) {
      await window.api.showError(t('storage.error'), String(error)).catch(() => undefined)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    void loadStats()
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)
  }, [open, loadStats])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !cleaning) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, cleaning, onClose])

  useEffect(() => {
    if (!protectRecovery) return
    setSelected((current) => {
      if (!current.has('recovery')) return current
      const next = new Set(current)
      next.delete('recovery')
      return next
    })
  }, [protectRecovery])

  const isSelectable = useCallback(
    (category: StorageCategory) =>
      category.cleanable &&
      category.bytes > 0 &&
      !(category.id === 'recovery' && protectRecovery),
    [protectRecovery]
  )

  const selectable = useMemo(
    () => stats?.categories.filter(isSelectable).map((category) => category.id) ?? [],
    [stats, isSelectable]
  )
  const selectedBytes = useMemo(
    () =>
      stats?.categories
        .filter((category) => selected.has(category.id))
        .reduce((sum, category) => sum + category.bytes, 0) ?? 0,
    [stats, selected]
  )

  const toggleCategory = (category: StorageCategory): void => {
    if (!isSelectable(category)) return
    setNotice('')
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(category.id)) next.delete(category.id)
      else next.add(category.id)
      return next
    })
  }

  const toggleAll = (): void => {
    setNotice('')
    setSelected((current) =>
      selectable.length > 0 && selectable.every((id) => current.has(id))
        ? new Set()
        : new Set(selectable)
    )
  }

  const cleanSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    setCleaning(true)
    setNotice('')
    try {
      const result = await window.api.cleanStorage(Array.from(selected))
      if (result.canceled) return
      setStats(result.stats)
      setSelected(new Set())
      setNotice(
        t(result.failed.length > 0 ? 'storage.cleanPartial' : 'storage.cleaned', {
          size: formatBytes(result.freedBytes, lang)
        })
      )
    } catch (error) {
      await window.api.showError(t('storage.error'), String(error)).catch(() => undefined)
    } finally {
      setCleaning(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="storage-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !cleaning) onClose()
      }}
    >
      <section
        className="storage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-dialog-title"
      >
        <header className="storage-header">
          <div>
            <h2 id="storage-dialog-title">{t('storage.title')}</h2>
            <p>{t('storage.subtitle')}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="storage-close"
            aria-label={t('storage.close')}
            disabled={cleaning}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="storage-summary">
          <div>
            <span>{t('storage.total')}</span>
            <strong>{formatBytes(stats?.totalBytes ?? 0, lang)}</strong>
          </div>
          <div>
            <span>{t('storage.cleanable')}</span>
            <strong>{formatBytes(stats?.cleanableBytes ?? 0, lang)}</strong>
          </div>
        </div>

        <div className="storage-section-title">
          <h3>{t('storage.categories')}</h3>
          <button type="button" disabled={loading || cleaning || selectable.length === 0} onClick={toggleAll}>
            {selectable.length > 0 && selectable.every((id) => selected.has(id))
              ? t('storage.clearSelection')
              : t('storage.selectAll')}
          </button>
        </div>

        <div className="storage-list" aria-busy={loading}>
          {loading && !stats ? (
            <div className="storage-loading">
              <span className="storage-spinner" />
              {t('storage.scanning')}
            </div>
          ) : (
            stats?.categories.map((category) => {
              const copy = CATEGORY_COPY[category.id]
              const disabled = !isSelectable(category)
              const recoveryProtected = category.id === 'recovery' && protectRecovery
              const percentage = stats.totalBytes > 0
                ? Math.max(category.bytes > 0 ? 1 : 0, (category.bytes / stats.totalBytes) * 100)
                : 0
              return (
                <label
                  key={category.id}
                  className={`storage-row${disabled ? ' disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(category.id)}
                    disabled={disabled || cleaning}
                    onChange={() => toggleCategory(category)}
                  />
                  <span className={`storage-mark storage-mark-${category.id}`}>{copy.mark}</span>
                  <span className="storage-category-copy">
                    <span className="storage-category-line">
                      <strong>{t(copy.name)}</strong>
                      <span>{formatBytes(category.bytes, lang)}</span>
                    </span>
                    <span className="storage-description">
                      {recoveryProtected ? t('storage.currentDraft') : t(copy.description)}
                    </span>
                    <span className="storage-meter" aria-hidden="true">
                      <span style={{ width: `${percentage}%` }} />
                    </span>
                    <span className="storage-meta">
                      {t('storage.files', { n: category.files })}
                      {!category.cleanable && <em>{t('storage.keep')}</em>}
                    </span>
                  </span>
                </label>
              )
            })
          )}
        </div>

        <footer className="storage-footer">
          <div className="storage-footer-status" role="status">
            {notice || (selected.size > 0
              ? t('storage.selected', { size: formatBytes(selectedBytes, lang) })
              : '')}
          </div>
          <button type="button" className="storage-secondary" disabled={loading || cleaning} onClick={() => void loadStats()}>
            {t('storage.refresh')}
          </button>
          <button
            type="button"
            className="storage-primary"
            disabled={selected.size === 0 || loading || cleaning}
            onClick={() => void cleanSelected()}
          >
            {t('storage.cleanSelected')}
          </button>
        </footer>
      </section>
    </div>
  )
}
