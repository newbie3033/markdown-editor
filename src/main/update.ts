import { app, BrowserWindow, dialog, net, shell } from 'electron'
import { IPC, RELEASES_URL, REPOSITORY_URL, type UpdateInfo } from '../shared/ipc'
import { t } from './i18n'

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/newbie3033/markdown-editor/releases/latest'
const UPDATE_TIMEOUT_MS = 10_000
const PACKAGE_NAME = /^InkMark-[\w.+-]+\.(?:appimage|deb|dmg|exe|msi|pkg|rpm|zip|7z|tar\.gz|tar\.xz)$/i

interface Version {
  core: [number, number, number]
  prerelease: string[]
}

interface LatestReleaseResponse {
  tag_name?: unknown
  body?: unknown
  assets?: unknown
}

interface ReleaseAsset {
  name: string
  url: string
}

interface LatestRelease {
  version: string
  notes: string
  assets: ReleaseAsset[]
}

const linuxArtifactArchitectures: Record<string, [appImage: string, deb: string]> = {
  x64: ['x86_64', 'amd64'],
  arm64: ['aarch64', 'arm64'],
  arm: ['armv7l', 'armhf'],
  ia32: ['i686', 'i386']
}

const activeChecks = new WeakMap<BrowserWindow, Promise<void>>()
const availableReleases = new WeakMap<BrowserWindow, LatestRelease>()
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

function releaseAssets(value: unknown, tag: string): ReleaseAsset[] {
  if (!Array.isArray(value)) return []
  const prefix = `${REPOSITORY_URL}/releases/download/`
  const assets = new Map<string, ReleaseAsset>()
  for (const asset of value) {
    const name = asset?.name
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) continue
    const url = asset.browser_download_url
    if (url === `${prefix}${tag}/${name}` || url === `${prefix}${encodeURIComponent(tag)}/${encodeURIComponent(name)}`) {
      assets.set(name, { name, url })
    }
  }
  return [...assets.values()]
}

function recommendedPackage({ assets, version }: LatestRelease): string | null {
  const arch = process.arch
  let names: string[]
  switch (process.platform) {
    case 'win32': {
      const installer = `InkMark-Setup-${version}-${arch}.exe`
      const portable = `InkMark-${version}-portable-${arch}.exe`
      names = process.env['PORTABLE_EXECUTABLE_DIR']
        ? [portable, installer]
        : [installer, portable]
      break
    }
    case 'darwin':
      names = [`InkMark-${version}-${arch}.dmg`]
      break
    case 'linux': {
      const architectures = linuxArtifactArchitectures[arch]
      if (!architectures) return null
      const [appImageArch, debArch] = architectures
      const appImage = `InkMark-${version}-${appImageArch}.AppImage`
      const deb = `InkMark-${version}-${debArch}.deb`
      names = process.env['APPIMAGE'] ? [appImage, deb] : [deb, appImage]
      break
    }
    default:
      return null
  }

  return names.find(name => assets.some(asset => asset.name === name)) ?? null
}

async function latestRelease(): Promise<LatestRelease> {
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
    const tag = release.tag_name.trim()
    const version = tag.replace(/^v/, '')
    return {
      version,
      notes: typeof release.body === 'string' ? release.body : '',
      assets: releaseAssets(release.assets, tag)
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function openUpdateDownload(win: BrowserWindow, version: string, packageName: string): Promise<void> {
  const release = availableReleases.get(win)
  const asset = release?.version === version && release.assets.find(item => item.name === packageName)
  if (!asset) throw new Error('Update package is unavailable')
  await shell.openExternal(asset.url)
}

async function showMessage(
  win: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return win && !win.isDestroyed()
    ? dialog.showMessageBox(win, options)
    : dialog.showMessageBox(options)
}

async function runUpdateCheck(win: BrowserWindow, automatic: boolean): Promise<void> {
  try {
    const currentVersion = app.getVersion()
    const release = await latestRelease()
    if (win.isDestroyed()) return
    const comparison = compareVersions(release.version, currentVersion)
    if (comparison === null) throw new Error('The application version is invalid')

    if (comparison > 0) {
      availableReleases.set(win, release)
      const update: UpdateInfo = {
        currentVersion,
        version: release.version,
        notes: release.notes,
        packages: release.assets.map(asset => asset.name),
        recommendedPackage: recommendedPackage(release)
      }
      win.webContents.send(IPC.updateAvailable, update)
      return
    }

    availableReleases.delete(win)
    if (!automatic) {
      await showMessage(win, {
        type: 'info',
        buttons: [t('dialog.ok')],
        message: t('dialog.upToDateTitle'),
        detail: t('dialog.upToDateDetail').replace('{version}', currentVersion)
      })
    }
  } catch (error) {
    if (win.isDestroyed()) return
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
export function checkForUpdates(win: BrowserWindow, automatic: boolean): Promise<void> {
  if (automatic && automaticCheckStarted) return Promise.resolve()
  const activeCheck = activeChecks.get(win)
  if (activeCheck) return activeCheck
  if (automatic) automaticCheckStarted = true
  const check = runUpdateCheck(win, automatic).finally(() => {
    activeChecks.delete(win)
  })
  activeChecks.set(win, check)
  return check
}
