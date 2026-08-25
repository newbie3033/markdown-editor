import { app, BrowserWindow, dialog, net, shell } from 'electron'
import { RELEASES_URL } from '../shared/ipc'
import { t } from './i18n'

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/newbie3033/markdown-editor/releases/latest'
const UPDATE_TIMEOUT_MS = 10_000

interface Version {
  core: [number, number, number]
  prerelease: string[]
}

interface LatestReleaseResponse {
  tag_name?: unknown
}

let activeCheck: Promise<void> | null = null
let automaticCheckStarted = false

function parseVersion(value: string): Version | null {
  const match = value.trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  )
  if (!match) return null
  const core = match.slice(1, 4).map(Number) as [number, number, number]
  if (core.some((part) => !Number.isSafeInteger(part))) return null
  return {
    core,
    prerelease: match[4]?.split('.') ?? []
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  }
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a > b ? 1 : -1
  }
  return 0
}

/** Compare two semantic versions. Returns null when either value is invalid. */
export function compareVersions(leftValue: string, rightValue: string): number | null {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) return null
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] > right.core[index] ? 1 : -1
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

async function latestReleaseVersion(): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS)
  try {
    const response = await net.fetch(LATEST_RELEASE_API_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `InkMark/${app.getVersion()}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
    const contentLength = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      throw new Error('GitHub response is too large')
    }
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) {
      throw new Error('GitHub response is too large')
    }
    const release = JSON.parse(body) as LatestReleaseResponse
    if (typeof release.tag_name !== 'string' || !parseVersion(release.tag_name)) {
      throw new Error('The latest release has an invalid version tag')
    }
    return release.tag_name.replace(/^v/, '')
  } finally {
    clearTimeout(timeout)
  }
}

async function showMessage(
  win: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options)
}

async function runUpdateCheck(win: BrowserWindow | null, automatic: boolean): Promise<void> {
  try {
    const currentVersion = app.getVersion()
    const latestVersion = await latestReleaseVersion()
    const comparison = compareVersions(latestVersion, currentVersion)
    if (comparison === null) throw new Error('The application version is invalid')

    if (comparison > 0) {
      if (automatic && (!win || win.isDestroyed())) return
      const result = await showMessage(win, {
        type: 'info',
        buttons: [t('dialog.downloadUpdate'), t('dialog.later')],
        defaultId: 0,
        cancelId: 1,
        message: t('dialog.updateAvailableTitle'),
        detail: t('dialog.updateAvailableDetail')
          .replace('{current}', currentVersion)
          .replace('{latest}', latestVersion)
      })
      if (result.response === 0) await shell.openExternal(RELEASES_URL)
      return
    }

    if (!automatic) {
      await showMessage(win, {
        type: 'info',
        buttons: [t('dialog.ok')],
        message: t('dialog.upToDateTitle'),
        detail: t('dialog.upToDateDetail').replace('{version}', currentVersion)
      })
    }
  } catch (error) {
    if (automatic) {
      console.warn('Automatic update check failed', error)
      return
    }
    await showMessage(win, {
      type: 'warning',
      buttons: [t('dialog.openReleases'), t('dialog.cancel')],
      defaultId: 0,
      cancelId: 1,
      message: t('dialog.updateCheckFailedTitle'),
      detail: t('dialog.updateCheckFailedDetail')
    }).then(async (result) => {
      if (result.response === 0) await shell.openExternal(RELEASES_URL)
    })
  }
}

/**
 * Check GitHub Releases, coalescing automatic/manual requests that overlap.
 * Automatic checks stay silent unless a newer version is available.
 */
export function checkForUpdates(win: BrowserWindow | null, automatic: boolean): Promise<void> {
  if (automatic && automaticCheckStarted) return Promise.resolve()
  if (activeCheck) return activeCheck
  if (automatic) automaticCheckStarted = true
  const check = runUpdateCheck(win, automatic).finally(() => {
    if (activeCheck === check) activeCheck = null
  })
  activeCheck = check
  return check
}
