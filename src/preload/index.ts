import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type FileResult,
  type FolderResult,
  type SaveResult,
  type FileEntry,
  type MenuAction,
  type InkMarkApi,
  type Lang,
  type SaveImagePayload,
  type SaveImageResult,
  type PickImageResult,
  type FileSearchResult,
  type SaveChoice,
  type SearchFlags
} from '../shared/ipc'

const api: InkMarkApi = {
  openFileDialog: (): Promise<FileResult> => ipcRenderer.invoke(IPC.openFileDialog),

  saveFileDialog: (defaultPath: string | null, content: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.saveFileDialog, defaultPath, content),

  readFile: (path: string): Promise<string> => ipcRenderer.invoke(IPC.readFile, path),

  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.writeFile, path, content),

  openFolderDialog: (): Promise<FolderResult> => ipcRenderer.invoke(IPC.openFolderDialog),

  listMarkdown: (folderPath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke(IPC.listMarkdown, folderPath),

  exportHtml: (defaultName: string, html: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.exportHtml, defaultName, html),

  exportPdf: (defaultName: string, html: string): Promise<SaveResult> =>
    ipcRenderer.invoke(IPC.exportPdf, defaultName, html),

  exportPrint: (html: string): Promise<void> => ipcRenderer.invoke(IPC.exportPrint, html),

  saveImage: (payload: SaveImagePayload): Promise<SaveImageResult | null> =>
    ipcRenderer.invoke(IPC.saveImage, payload),

  pickImage: (): Promise<PickImageResult> => ipcRenderer.invoke(IPC.pickImage),

  searchFiles: (folderPath: string, query: string, flags?: SearchFlags): Promise<FileSearchResult[]> =>
    ipcRenderer.invoke(IPC.searchFiles, folderPath, query, flags),

  confirmSave: (fileName: string): Promise<SaveChoice> => ipcRenderer.invoke(IPC.confirmSave, fileName),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  openLocalPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openLocalPath, path),

  pathExists: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.pathExists, path),

  pathIsDirectory: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.pathIsDirectory, path),

  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  getZoom: (): Promise<number> => ipcRenderer.invoke(IPC.getZoom),

  setZoom: (level: number): Promise<void> => ipcRenderer.invoke(IPC.setZoom, level),

  showAbout: (): Promise<void> => ipcRenderer.invoke(IPC.showAbout),

  setReadOnly: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.setReadOnly, value),

  copyText: (text: string): void => {
    clipboard.writeText(text)
  },

  readClipboardText: (): string => {
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  },

  getLocale: (): Promise<Lang> => ipcRenderer.invoke(IPC.getLocale),

  setLocale: (lang: Lang): Promise<void> => ipcRenderer.invoke(IPC.setLocale, lang),

  onMenuAction: (callback: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: MenuAction): void =>
      callback(action)
    ipcRenderer.on(IPC.menuAction, listener)
    return () => ipcRenderer.removeListener(IPC.menuAction, listener)
  },

  onOpenPath: (callback: (path: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on(IPC.openPath, listener)
    return () => ipcRenderer.removeListener(IPC.openPath, listener)
  },

  onCloseRequest: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.requestClose, listener)
    return () => ipcRenderer.removeListener(IPC.requestClose, listener)
  },

  closeConfirmed: (): void => {
    ipcRenderer.send(IPC.closeConfirmed)
  },

  rendererReady: (): void => {
    ipcRenderer.send(IPC.rendererReady)
  }
}

contextBridge.exposeInMainWorld('api', api)
