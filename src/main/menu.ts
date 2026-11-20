import { BaseWindow, BrowserWindow, Menu, MenuItemConstructorOptions, nativeTheme, shell } from 'electron'
import { DEFAULT_MERMAID_STYLE, IPC, MERMAID_STYLES, REPOSITORY_URL, type AppMenuItem, type Lang, type MenuAction, type MermaidStyle } from '../shared/ipc'
import { getLocale, t } from './i18n'
import { checkForUpdates } from './update'

let getWindowRef: () => BrowserWindow | null = () => null
let readOnlyMode = false
let defaultReadOnly = false
let mermaidStyle = DEFAULT_MERMAID_STYLE

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

export function setDefaultReadOnly(value: boolean): void {
  if (defaultReadOnly === value) return
  defaultReadOnly = value
  rebuildMenu()
}

export function setMermaidStyle(value: MermaidStyle): void {
  if (mermaidStyle === value) return
  mermaidStyle = value
  rebuildMenu()
}

function buildTemplate(lang: Lang): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin'
  const modifier = isMac ? 'Command' : 'Ctrl'

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
        { label: t('menu.new'), accelerator: `${modifier}+N`, click: (_i, w) => send('new', w ?? getWindowRef()) },
        { label: t('menu.welcome'), click: (_i, w) => send('welcome', w ?? getWindowRef()) },
        { type: 'separator' },
        { label: t('menu.open'), accelerator: `${modifier}+O`, click: (_i, w) => send('open', w ?? getWindowRef()) },
        {
          label: t('menu.openFolder'),
          accelerator: `${modifier}+Shift+O`,
          click: (_i, w) => send('open-folder', w ?? getWindowRef())
        },
        {
          label: t('menu.searchFolder'),
          accelerator: `${modifier}+Shift+F`,
          click: (_i, w) => send('search-folder', w ?? getWindowRef())
        },
        { label: t('menu.closeFolder'), click: (_i, w) => send('close-folder', w ?? getWindowRef()) },
        { type: 'separator' },
        { label: t('menu.save'), accelerator: `${modifier}+S`, click: (_i, w) => send('save', w ?? getWindowRef()) },
        {
          label: t('menu.saveAs'),
          accelerator: `${modifier}+Shift+S`,
          click: (_i, w) => send('save-as', w ?? getWindowRef())
        },
        { type: 'separator' },
        { label: t('menu.exportHtml'), click: (_i, w) => send('export-html', w ?? getWindowRef()) },
        { label: t('menu.exportPdf'), click: (_i, w) => send('export-pdf', w ?? getWindowRef()) },
        { label: t('menu.print'), accelerator: `${modifier}+P`, click: (_i, w) => send('print', w ?? getWindowRef()) },
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
        { label: t('menu.find'), accelerator: `${modifier}+F`, click: (_i, w) => send('find', w ?? getWindowRef()) },
        { label: t('menu.replace'), accelerator: `${modifier}+H`, enabled: !readOnlyMode, click: (_i, w) => send('replace', w ?? getWindowRef()) }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.toggleOutline'),
          accelerator: `${modifier}+Shift+1`,
          click: (_i, w) => send('toggle-outline', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleArticles'),
          accelerator: `${modifier}+Shift+2`,
          click: (_i, w) => send('toggle-articles', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleFileTree'),
          accelerator: `${modifier}+Shift+3`,
          click: (_i, w) => send('toggle-file-tree', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleSidebar'),
          accelerator: `${modifier}+Shift+L`,
          click: (_i, w) => send('toggle-sidebar', w ?? getWindowRef())
        },
        {
          label: t('menu.toggleSource'),
          accelerator: `${modifier}+/`,
          click: (_i, w) => send('toggle-source', w ?? getWindowRef())
        },
        { type: 'separator' },
        {
          id: 'theme-settings',
          label: t('menu.theme'),
          submenu: [
            ...(['system', 'light', 'dark'] as const).map(theme => ({
              label: t(({ system: 'menu.themeSystem', light: 'menu.themeLight', dark: 'menu.themeDark' } as const)[theme]),
              type: 'radio' as const,
              checked: nativeTheme.themeSource === theme,
              click: (_item: Electron.MenuItem, win: BrowserWindow | BaseWindow | undefined) =>
                send(`theme-${theme}`, win ?? getWindowRef())
            }))
          ]
        },
        {
          id: 'mermaid-style-settings',
          label: t('menu.mermaidStyle'),
          submenu: MERMAID_STYLES.map(style => ({
            label: style === 'soft' ? t('menu.mermaidSoft')
              : style === 'classic-blue' ? t('menu.mermaidBlue')
              : style === 'github' ? 'GitHub'
              : style.charAt(0).toUpperCase() + style.slice(1),
            type: 'radio',
            checked: mermaidStyle === style,
            click: (_item, win) => send(`mermaid-style-${style}`, win ?? getWindowRef())
          }))
        },
        {
          id: 'read-only-mode',
          label: t('menu.readOnlyMode'),
          type: 'checkbox',
          checked: readOnlyMode,
          click: (item, w) => send(item.checked ? 'mode-readonly' : 'mode-edit', w ?? getWindowRef())
        },
        {
          id: 'default-mode',
          label: t('menu.defaultMode'),
          submenu: [
            {
              id: 'default-mode-edit',
              label: t('menu.editMode'),
              type: 'radio',
              checked: !defaultReadOnly,
              click: (_item, win) => send('default-mode-edit', win ?? getWindowRef())
            },
            {
              id: 'default-mode-readonly',
              label: t('menu.readOnlyMode'),
              type: 'radio',
              checked: defaultReadOnly,
              click: (_item, win) => send('default-mode-readonly', win ?? getWindowRef())
            }
          ]
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
          accelerator: `${modifier}+Shift+0`,
          click: (_i, w) => send('zoom-reset', w ?? getWindowRef())
        },
        {
          label: t('menu.zoomIn'),
          accelerator: `${modifier}+Shift+=`,
          click: (_i, w) => send('zoom-in', w ?? getWindowRef())
        },
        {
          label: t('menu.zoomOut'),
          accelerator: `${modifier}+Shift+-`,
          click: (_i, w) => send('zoom-out', w ?? getWindowRef())
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.toggleFullscreen') },
        ...(isMac
          ? []
          : ([
              { type: 'separator' as const },
              // Explicit accelerator: keep the default Ctrl+Shift+I free for
              // the Typora-style "insert image" shortcut.
              { role: 'toggleDevTools' as const, accelerator: 'F12', label: t('menu.toggleDevTools') }
            ] satisfies MenuItemConstructorOptions[]))
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.checkForUpdates'),
          click: () => void checkForUpdates(getWindowRef(), false)
        },
        { type: 'separator' },
        {
          label: t('menu.repository'),
          click: () => void shell.openExternal(REPOSITORY_URL)
        },
        {
          label: t('menu.storage'),
          click: (_i, w) => send('storage', w ?? getWindowRef())
        },
        { type: 'separator' },
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
  rebuildMenu()
}

export function rebuildMenu(): void {
  const menu = Menu.buildFromTemplate(buildTemplate(getLocale()))
  Menu.setApplicationMenu(menu)
  const win = getWindowRef()
  if (process.platform === 'linux' && win && !win.isDestroyed()) {
    win.setMenuBarVisibility(false)
    win.webContents.send(IPC.appMenuUpdated, describeMenu(menu))
  }
}

function describeMenu(menu: Menu, keepOpen = false): AppMenuItem[] {
  return menu.items.filter(item => item.visible).map(item => ({
    id: item.commandId,
    label: item.label,
    type: item.type,
    enabled: item.enabled,
    checked: item.checked,
    accelerator: item.accelerator ?? undefined,
    keepOpen,
    children: item.submenu && describeMenu(
      item.submenu,
      item.id === 'theme-settings' || item.id === 'mermaid-style-settings'
    )
  }))
}

export function getAppMenu(): AppMenuItem[] | null {
  const menu = Menu.getApplicationMenu()
  return process.platform === 'linux' && menu ? describeMenu(menu) : null
}

export function activateAppMenu(id: number, win: BrowserWindow): void {
  if (process.platform !== 'linux') return
  function activate(menu: Menu): boolean {
    for (const item of menu.items) {
      if (!item.visible || !item.enabled) continue
      if (item.submenu) {
        if (activate(item.submenu)) return true
      } else if (item.commandId === id && item.type !== 'separator') {
        item.click(undefined, win, win.webContents)
        return true
      }
    }
    return false
  }
  const menu = Menu.getApplicationMenu()
  if (menu) activate(menu)
}
