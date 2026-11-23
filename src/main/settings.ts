import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lang } from '../shared/ipc'

interface AppSettings {
  locale?: Lang
  checkUpdatesOnStartup?: boolean
}

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

export function writeSettings(changes: AppSettings): void {
  const file = settingsPath()
  const temporaryFile = `${file}.tmp`
  writeFileSync(temporaryFile, JSON.stringify({ ...readSettings(), ...changes }, null, 2), 'utf8')
  renameSync(temporaryFile, file)
}
