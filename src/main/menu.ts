import { BaseWindow, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { IPC, REPOSITORY_URL, type Lang, type MenuAction } from '../shared/ipc'
import { getLocale, t } from './i18n'

let getWindowRef: () => BrowserWindow | null = () => null
let readOnlyMode = false

function send(action: MenuAction, win: BrowserWindow | BaseWindow | null | undefined): void {
  if (win && 'webContents' in win) {
    win.webContents.send(IPC.menuAction, action)
  }
}

export function setReadOnlyMode(value: boolean): void {
  if (readOnlyMode === value) return
  readOnlyMode = value
  rebuildMenu()
}

function buildTemplate(lang: Lang): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin'

  return [
    ...(isMac
      ? ([
          {
            label: 'InkMark',
            submenu: [
              { label: t('menu.about'), click: (_i, w) => send('about', w ?? getWindowRef()) },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.new'), accelerator: 'CmdOrCtrl+N', click: (_i, w) => send('new', w ?? getWindowRef()) },
        { label: t('menu.welcome'), click: (_i, w) => send('welcome', w ?? getWindowRef()) },
        { type: 'separator' },
        { label: t('menu.open'), accelerator: 'CmdOrCtrl+O', click: (_i, w) => send('open', w ?? getWindowRef()) },
        {
          label: t('menu.openFolder'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: (_i, w) => send('open-folder', w ?? getWindowRef())
        },
        {
          label: t('menu.searchFolder'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: (_i, w) => send('search-folder', w ?? getWindowRef())
        },
        { label: t('menu.closeFolder'), click: (_i, w) => send('close-folder', w ?? getWindowRef()) },
        { type: 'separator' },
        { label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: (_i, w) => send('save', w ?? getWindowRef()) },
        {
          label: t('menu.saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_i, w) => send('save-as', w ?? getWindowRef())
        },
        { type: 'separator' },
        { label: t('menu.exportHtml'), click: (_i, w) => send('export-html', w ?? getWindowRef()) },
        { label: t('menu.exportPdf'), click: (_i, w) => send('export-pdf', w ?? getWindowRef()) },
        { label: t('menu.print'), accelerator: 'CmdOrCtrl+P', click: (_i, w) => send('print', w ?? getWindowRef()) },
        { type: 'separator' },
        isMac
          ? { role: 'close' as const, label: t('menu.close') }
          : { role: 'quit' as const, label: t('menu.quit') }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
        { type: 'separator' },
        { label: t('menu.find'), accelerator: 'CmdOrCtrl+F', click: (_i, w) => send('find', w ?? getWindowRef()) }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.toggleSidebar'),
          accelerator: 'CmdOrCtrl+Shift+1',
          click: (_i, w) => send('toggle-sidebar', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleOutline'),
          accelerator: 'CmdOrCtrl+Shift+2',
          click: (_i, w) => send('toggle-outline', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleSource'),
          accelerator: 'CmdOrCtrl+/',
          click: (_i, w) => send('toggle-source', w ?? getWindowRef())
        },
        { type: 'separator' },
        {
          label: t('menu.theme'),
          submenu: [
            { label: t('menu.themeLight'), click: (_i, w) => send('theme-light', w ?? getWindowRef()) },
            { label: t('menu.themeDark'), click: (_i, w) => send('theme-dark', w ?? getWindowRef()) }
          ]
        },
        {
          label: t('menu.readOnlyMode'),
          type: 'checkbox',
          checked: readOnlyMode,
          click: (item, w) => send(item.checked ? 'mode-readonly' : 'mode-edit', w ?? getWindowRef())
        },
        {
          label: t('menu.language'),
          submenu: [
            {
              label: 'English',
              type: 'radio',
              checked: lang === 'en',
              click: (_i, w) => send('lang-en', w ?? getWindowRef())
            },
            {
              label: '中文',
              type: 'radio',
              checked: lang === 'zh',
              click: (_i, w) => send('lang-zh', w ?? getWindowRef())
            }
          ]
        },
        { type: 'separator' },
        {
          label: t('menu.actualSize'),
          accelerator: 'CmdOrCtrl+0',
          click: (_i, w) => send('zoom-reset', w ?? getWindowRef())
        },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+=',
          click: (_i, w) => send('zoom-in', w ?? getWindowRef())
        },
        {
          label: t('menu.zoomOut'),
          accelerator: 'CmdOrCtrl+-',
          click: (_i, w) => send('zoom-out', w ?? getWindowRef())
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.toggleFullscreen') },
        ...(isMac
          ? []
          : ([
              { type: 'separator' as const },
              { role: 'toggleDevTools' as const, label: t('menu.toggleDevTools') }
            ] satisfies MenuItemConstructorOptions[]))
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.repository'),
          click: () => void shell.openExternal(REPOSITORY_URL)
        },
        {
          label: t('menu.about'),
          click: (_i, w) => send('about', w ?? getWindowRef())
        }
      ]
    }
  ]
}

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  getWindowRef = getWindow
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(getLocale())))
}

export function rebuildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(getLocale())))
}
