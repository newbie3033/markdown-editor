import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { RELEASES_URL, type UpdateInfo } from '../../../shared/ipc'
import { useI18n } from '../lib/i18n'

const releaseMarkdown = new Marked({
  gfm: true,
  renderer: {
    html: () => '',
    // Link to images so opening the dialog does not fetch remote content.
    image(token) {
      const tokens = token.tokens.length ? token.tokens : [{ type: 'text', raw: token.href, text: token.href }]
      return this.link({ ...token, type: 'link', tokens })
    }
  }
})

function renderReleaseNotes(notes: string): string | null {
  if (!notes.trim()) return null
  let html: string
  try {
    html = releaseMarkdown.parse(notes, { async: false })
  } catch {
    return null
  }
  const content = DOMPurify.sanitize(html, {
    RETURN_DOM: true,
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
    ],
    ALLOWED_ATTR: ['align', 'checked', 'disabled', 'href', 'start', 'title', 'type'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false
  })
  if (!(content instanceof HTMLElement)) return null
  for (const link of content.querySelectorAll('a[href]')) {
    const url = URL.parse(link.getAttribute('href') ?? '', RELEASES_URL)
    if (!url || !['https:', 'http:', 'mailto:'].includes(url.protocol)) {
      link.removeAttribute('href')
      continue
    }
    link.setAttribute('href', url.href)
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  return content.innerHTML.trim() || null
}

export function UpdateDialog({ update, onClose }: {
  update: UpdateInfo
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [openingDownload, setOpeningDownload] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = choice && update.packages.includes(choice) ? choice : update.recommendedPackage ?? ''
  const notesHtml = useMemo(() => renderReleaseNotes(update.notes), [update.notes])

  useLayoutEffect(() => {
    const modal = dialog.current!
    modal.showModal()
    return () => modal.close()
  }, [])

  const openDownload = async (): Promise<void> => {
    if (!selected || openingDownload) return
    setOpeningDownload(true)
    setFailed(false)
    try {
      await window.api.openUpdateDownload(update.version, selected)
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setOpeningDownload(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="update-dialog"
      aria-labelledby="update-title"
      onCancel={event => {
        event.preventDefault()
        if (!openingDownload) onClose()
      }}
    >
      <header>
        <h2 id="update-title">{t('update.title')}</h2>
        <p>{t('update.currentVersion', { version: update.currentVersion })}</p>
        <p>{t('update.latestVersion', { version: update.version })}</p>
      </header>
      <section aria-labelledby="update-notes-title" className="update-notes">
        <h3 id="update-notes-title">{t('update.notes')}</h3>
        {notesHtml ? (
          <div className="update-notes-content" tabIndex={0} dangerouslySetInnerHTML={{ __html: notesHtml }} />
        ) : (
          <div className="update-notes-content">{t('update.notesMissing')}</div>
        )}
      </section>
      {update.packages.length > 0 ? (
        <div className="update-packages">
          <label htmlFor="update-package">{t('update.package')}</label>
          <select
            id="update-package"
            value={selected}
            onChange={event => setChoice(event.currentTarget.value)}
            disabled={openingDownload}
          >
            {!update.recommendedPackage && <option value="" disabled>{t('update.choosePackage')}</option>}
            {update.recommendedPackage && (
              <option value={update.recommendedPackage}>
                {t('update.recommendedPackage', { name: update.recommendedPackage })}
              </option>
            )}
            {update.packages.filter(name => name !== update.recommendedPackage).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      ) : <p className="update-packages">{t('update.packagesMissing')}</p>}
      {failed && <p className="update-error" role="alert">{t('update.openDownloadFailed')}</p>}
      <footer>
        <button type="button" disabled={openingDownload} onClick={onClose}>{t('update.later')}</button>
        {update.packages.length > 0 ? (
          <button type="button" className="update-primary" disabled={openingDownload || !selected} onClick={() => void openDownload()}>
            {t(openingDownload ? 'update.openingDownload' : 'update.download')}
          </button>
        ) : (
          <button type="button" className="update-primary" onClick={() => void window.api.openExternal(RELEASES_URL)}>
            {t('update.openRelease')}
          </button>
        )}
      </footer>
    </dialog>
  )
}
