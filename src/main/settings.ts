import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { DEFAULT_RENDER_HTML, type Lang } from '../shared/ipc'

interface AppSettings {
  locale?: Lang
  renderHtml?: boolean
  checkUpdatesOnStartup?: boolean
  recentFiles?: string[]
}

const MAX_RECENT_FILES = 20

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings(): AppSettings {
  try {
    const settings: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) return settings as AppSettings
  } catch {
    // Missing or malformed settings use the defaults.
  }
  return {}
}

export function htmlRenderingEnabled(): boolean {
  const { renderHtml } = readSettings()
  return typeof renderHtml === 'boolean' ? renderHtml : DEFAULT_RENDER_HTML
}

export function getRecentFiles(): string[] {
  const { recentFiles } = readSettings()
  if (!Array.isArray(recentFiles)) return []
  return [...new Set(recentFiles.filter(path => typeof path === 'string' && isAbsolute(path)))].slice(0, MAX_RECENT_FILES)
}

export function recordRecentFile(path: string): boolean {
  const recentFiles = getRecentFiles()
  if (recentFiles[0] === path) return false
  const next = [path, ...recentFiles.filter(entry => entry !== path)].slice(0, MAX_RECENT_FILES)
  try {
    writeSettings({ recentFiles: next })
    return true
  } catch (error) {
    console.warn('Could not save recent files', error)
    return false
  }
}

export function writeSettings(changes: AppSettings): void {
  const file = settingsPath()
  const temporaryFile = `${file}.tmp`
  writeFileSync(temporaryFile, JSON.stringify({ ...readSettings(), ...changes }, null, 2), 'utf8')
  renameSync(temporaryFile, file)
}
