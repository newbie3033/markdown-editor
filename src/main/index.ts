import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { buildMenu, rebuildMenu } from './menu'
import { initLocale } from './i18n'

// Portable mode (Windows portable exe): the launcher sets
// PORTABLE_EXECUTABLE_DIR to the directory of the exe. Keep all app data in a
// folder next to the executable so nothing is written to the host machine.
const portableDir = process.env['PORTABLE_EXECUTABLE_DIR']
if (portableDir) {
  app.setPath('userData', join(portableDir, 'InkMarkData'))
}

let mainWindow: BrowserWindow | null = null

// "Open with" paths that arrive before the renderer has registered its IPC
// listeners. They are flushed when the renderer announces readiness, so
// startup file arguments are never silently dropped.
const pendingOpenPaths: string[] = []
let rendererReady = false
// Set right before a close that the renderer already approved; the window's
// 'close' handler must not intercept it again.
let forceClose = false

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.txt'])

function isMarkdownPath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return false
  return MARKDOWN_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

function createWindow(): void {
  rendererReady = false
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'InkMark',
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Skip loading the spellchecker dictionary at startup.
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Closing the window is routed through the renderer: it asks about
  // unsaved changes and replies with app:close-confirmed when it is safe.
  mainWindow.on('close', (event) => {
    if (forceClose) return
    event.preventDefault()
    mainWindow?.webContents.send(IPC.requestClose)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    forceClose = false
  })

  // Self-test harness (headless verification), only when INKMARK_SELFTEST=1.
  if (process.env['INKMARK_SELFTEST'] === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void import('./selftest').then(({ runSelfTest }) => runSelfTest(mainWindow as BrowserWindow))
      }, 2000)
    })
  }

  // Open external links in the system browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendOpenPath(path: string): void {
  const win = mainWindow
  if (win && rendererReady) {
    // Renderer listeners are up: deliver directly.
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send(IPC.openPath, path)
    return
  }
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else if (app.isReady()) {
    createWindow()
  }
  // Window not created or renderer still loading: queue for the ready signal.
  if (!pendingOpenPaths.includes(path)) pendingOpenPaths.push(path)
}

function pathFromArgv(): string | null {
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith('-')) continue
    if (existsSync(arg) && isMarkdownPath(arg)) return arg
  }
  return null
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const path = argv.find((arg) => isMarkdownPath(arg) && existsSync(arg))
    if (path) sendOpenPath(path)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    initLocale(rebuildMenu)
    registerIpc(() => mainWindow)
    buildMenu(() => mainWindow)

    // The renderer reports when its IPC listeners are registered; flush any
    // "open with" paths that were queued while the window was starting.
    ipcMain.on(IPC.rendererReady, () => {
      rendererReady = true
      const win = mainWindow
      if (!win) return
      for (const path of pendingOpenPaths.splice(0)) {
        win.webContents.send(IPC.openPath, path)
      }
    })

    // The renderer finished its unsaved-changes handling (saved or discarded);
    // now the close is approved and must not be intercepted again.
    ipcMain.on(IPC.closeConfirmed, () => {
      const win = mainWindow
      if (!win) return
      forceClose = true
      win.close()
    })

    createWindow()

    const initialPath = pathFromArgv()
    if (initialPath) sendOpenPath(initialPath)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('open-file', (event, path) => {
    event.preventDefault()
    sendOpenPath(path)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
