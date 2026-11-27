import { app, BrowserWindow, ipcMain, protocol, screen, shell } from 'electron'
import { isAbsolute, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { IPC } from '../shared/ipc'
import { grantDirectoryAccess, grantDocumentAccess, registerLocalProtocols, registerIpc } from './ipc'
import { buildMenu, rebuildMenu } from './menu'
import { initLocale } from './i18n'
import { checkForUpdates } from './update'

// Portable mode (Windows portable exe): the launcher sets
// PORTABLE_EXECUTABLE_DIR to the directory of the exe. Keep all app data in a
// folder next to the executable so nothing is written to the host machine.
const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
if (portableDir) {
  app.setPath('userData', join(portableDir, 'InkMarkData'))
}
const selfTestUserData = process.env['INKMARK_SELFTEST_USER_DATA']
const selfTestEnabled = !app.isPackaged && process.env['INKMARK_SELFTEST'] === '1'
if (selfTestEnabled && selfTestUserData) {
  app.setPath('userData', selfTestUserData)
}

// Register before app readiness so relative URLs resolve with normal web URL
// semantics. The handler itself is installed after Electron is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'inkmark-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  },
  {
    scheme: 'inkmark-export',
    privileges: { standard: true, secure: true }
  }
])

let mainWindow: BrowserWindow | null = null

interface OpenTarget {
  path: string
  isDirectory: boolean
  fromHistory?: boolean
}

// Hold launch targets until the renderer has registered its IPC listeners.
const pendingOpenPaths: OpenTarget[] = []
let rendererReady = false
let rendererGone = false
let pendingUpdateCheck = false
// Set right before a close that the renderer already approved; the window's
// 'close' handler must not intercept it again.
let forceClose = false

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])

function isMarkdownPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return false
  return MARKDOWN_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

function getOpenTarget(path: string): OpenTarget | undefined {
  try {
    const stat = statSync(path, { throwIfNoEntry: false })
    if (stat?.isDirectory()) return { path, isDirectory: true }
    if (stat?.isFile() && isMarkdownPath(path)) return { path, isDirectory: false }
  } catch {
    // An inaccessible path cannot be opened.
  }
  return undefined
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function trustedDevelopmentRendererUrl(value: string | undefined): string | null {
  if (app.isPackaged || !value) return null
  try {
    const url = new URL(value)
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    return ['http:', 'https:'].includes(url.protocol) && localHosts.has(url.hostname)
      ? url.href
      : null
  } catch {
    return null
  }
}

function createWindow(): void {
  rendererReady = false
  rendererGone = false
  const defaultWidth = 1120
  const defaultHeight = 760
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(defaultWidth, workArea.width)
  const height = Math.min(defaultHeight, workArea.height)
  const needsFit = width < defaultWidth || height < defaultHeight

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(840, width),
    minHeight: Math.min(480, height),
    ...(needsFit && {
      x: workArea.x + Math.floor((workArea.width - width) / 2),
      y: workArea.y + Math.floor((workArea.height - height) / 2)
    }),
    show: false,
    title: 'InkMark',
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload can only enable synthetic drop paths when the main
      // process has independently approved development self-test mode.
      additionalArguments: [
        selfTestEnabled ? '--inkmark-selftest-authorized' : '--inkmark-selftest-disabled'
      ],
      // Skip loading the spellchecker dictionary at startup.
      spellcheck: false
    }
  })

  if (process.platform === 'linux') mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Closing the window is routed through the renderer: it asks about
  // unsaved changes and replies with app:close-confirmed when it is safe.
  mainWindow.on('close', (event) => {
    // Before renderer readiness there is no volatile editor state yet; after a
    // renderer crash there is no live process that can answer the close IPC
    // (the recovery draft remains available for the next launch).
    if (forceClose || !rendererReady || rendererGone) return
    event.preventDefault()
    mainWindow?.webContents.send(IPC.requestClose)
  })

  mainWindow.webContents.on('render-process-gone', () => {
    rendererGone = true
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    forceClose = false
    rendererGone = false
  })

  // Self-test harness (headless verification), only when INKMARK_SELFTEST=1.
  if (selfTestEnabled) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void import('./selftest').then(({ runSelfTest }) => runSelfTest(mainWindow as BrowserWindow))
      }, 2000)
    })
  }

  // The editor never needs to navigate its privileged renderer away from the
  // packaged application page.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // Open only explicitly allow-listed external protocols in the system
  // browser. Deny every attempted child window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const developmentUrl = trustedDevelopmentRendererUrl(process.env['ELECTRON_RENDERER_URL'])
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function requestUpdateCheck(): void {
  if (mainWindow && rendererReady && !rendererGone) {
    void checkForUpdates(mainWindow, false)
    return
  }
  pendingUpdateCheck = true
  if (!mainWindow) createWindow()
}

function sendOpenPath(target: OpenTarget): void {
  const { path, isDirectory, fromHistory } = target
  if (isDirectory) grantDirectoryAccess(path)
  else if (!fromHistory) grantDocumentAccess(path)
  const win = mainWindow
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    if (rendererReady) {
      win.webContents.send(IPC.openPath, path, isDirectory, fromHistory)
      return
    }
  } else if (app.isReady()) {
    createWindow()
  }
  // Window not created or renderer still loading: queue for the ready signal.
  if (!pendingOpenPaths.some((pending) => pending.path === path)) pendingOpenPaths.push(target)
}

function targetFromArgv(): OpenTarget | undefined {
  // The default Electron executable includes the app entry point in argv.
  let parsingOptions = true
  for (const arg of process.argv.slice(process.defaultApp ? 2 : 1)) {
    if (parsingOptions && arg === '--') {
      parsingOptions = false
      continue
    }
    if (!arg || (parsingOptions && arg.startsWith('-'))) continue
    const target = getOpenTarget(resolve(arg))
    if (target) return target
  }
  return undefined
}

const initialTarget = targetFromArgv()
// Resolve relative arguments in the launching process, using its working directory.
const gotSingleInstanceLock = app.requestSingleInstanceLock({ openPath: initialTarget?.path ?? null })

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, _argv, _workingDirectory, data) => {
    const path = data && typeof data === 'object' && 'openPath' in data ? data.openPath : undefined
    const target = typeof path === 'string' && isAbsolute(path) ? getOpenTarget(path) : undefined
    if (target) sendOpenPath(target)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    initLocale(rebuildMenu)
    registerLocalProtocols()
    registerIpc(() => mainWindow)
    buildMenu(() => mainWindow, requestUpdateCheck, path => {
      sendOpenPath({ path, isDirectory: false, fromHistory: true })
    })

    // The renderer reports when its IPC listeners are registered; flush any
    // "open with" paths that were queued while the window was starting.
    ipcMain.on(IPC.rendererReady, (event) => {
      const current = mainWindow
      if (
        !current ||
        event.sender !== current.webContents ||
        event.senderFrame !== current.webContents.mainFrame
      ) return
      const wasReady = rendererReady
      rendererReady = true
      rendererGone = false
      for (const { path, isDirectory, fromHistory } of pendingOpenPaths.splice(0)) {
        current.webContents.send(IPC.openPath, path, isDirectory, fromHistory)
      }
      if (pendingUpdateCheck) {
        pendingUpdateCheck = false
        void checkForUpdates(current, false)
      } else if (!wasReady && app.isPackaged) {
        void checkForUpdates(current, true)
      }
    })

    // The renderer finished its unsaved-changes handling (saved or discarded);
    // now the close is approved and must not be intercepted again.
    ipcMain.on(IPC.closeConfirmed, (event) => {
      const win = mainWindow
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      ) return
      forceClose = true
      win.close()
    })

    createWindow()

    if (initialTarget) sendOpenPath(initialTarget)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('open-file', (event, path) => {
    event.preventDefault()
    const target = getOpenTarget(path)
    if (target) sendOpenPath(target)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
