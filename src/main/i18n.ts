import { app } from 'electron'
import type { Lang } from '../shared/ipc'
import { readSettings, writeSettings } from './settings'

const messages = {
  en: {
    'menu.file': 'File',
    'menu.new': 'New',
    'menu.welcome': 'Open Welcome Page',
    'menu.open': 'Open…',
    'menu.openFolder': 'Open Folder…',
    'menu.searchFolder': 'Search in Folder…',
    'menu.closeFolder': 'Close All Folders',
    'menu.save': 'Save',
    'menu.saveAs': 'Save As…',
    'menu.exportHtml': 'Export as HTML…',
    'menu.exportPdf': 'Export as PDF…',
    'menu.print': 'Print…',
    'menu.close': 'Close',
    'menu.quit': 'Quit',
    'menu.edit': 'Edit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select All',
    'menu.find': 'Find',
    'menu.replace': 'Replace',
    'menu.view': 'View',
    'menu.toggleSidebar': 'Toggle Sidebar',
    'menu.toggleArticles': 'Articles',
    'menu.toggleFileTree': 'File Tree',
    'menu.toggleOutline': 'Toggle Outline',
    'menu.toggleSource': 'Toggle Source Code Mode',
    'menu.theme': 'Theme',
    'menu.mermaidStyle': 'Mermaid Style',
    'menu.mermaidSoft': 'Soft Light / Dark',
    'menu.mermaidBlue': 'Classic Blue',
    'menu.themeSystem': 'Follow system',
    'menu.themeLight': 'Light',
    'menu.themeDark': 'Dark',
    'menu.language': 'Language',
    'menu.actualSize': 'Actual Size',
    'menu.zoomIn': 'Zoom In',
    'menu.zoomOut': 'Zoom Out',
    'menu.toggleFullscreen': 'Toggle Full Screen',
    'menu.toggleDevTools': 'Toggle Developer Tools',
    'menu.help': 'Help',
    'menu.checkForUpdates': 'Check for Updates…',
    'menu.checkUpdatesOnStartup': 'Automatically Check for Updates on Startup',
    'menu.about': 'About InkMark',
    'menu.editMode': 'Edit Mode',
    'menu.readOnlyMode': 'Read-only Mode',
    'menu.defaultMode': 'Default Mode',
    'menu.repository': 'Open Source Repository',
    'menu.storage': 'Storage…',
    'dialog.openFile': 'Open Markdown File',
    'dialog.saveFile': 'Save Markdown File',
    'dialog.openFolder': 'Open Folder',
    'dialog.exportDiagramPng': 'Save diagram as PNG',
    'dialog.exportHtml': 'Export as HTML',
    'dialog.exportPdf': 'Export as PDF',
    'dialog.pickImage': 'Choose an image',
    'filter.markdown': 'Markdown',
    'filter.allFiles': 'All Files',
    'filter.html': 'HTML',
    'filter.pdf': 'PDF',
    'filter.images': 'Images',
    'dialog.save': 'Save',
    'dialog.dontSave': "Don't Save",
    'dialog.cancel': 'Cancel',
    'dialog.unsavedTitle': 'Save changes?',
    'dialog.unsavedDetail': '"{name}" has unsaved changes.',
    'dialog.reload': 'Reload',
    'dialog.keepEditing': 'Keep Editing',
    'dialog.externalChangedTitle': 'File changed on disk',
    'dialog.externalChangedDetail': '"{name}" was changed by another application.',
    'dialog.restore': 'Restore Draft',
    'dialog.discardDraft': 'Discard Draft',
    'dialog.recoveryTitle': 'Recover unsaved changes?',
    'dialog.recoveryDetail': 'An unsaved draft of "{name}" from {time} was found.',
    'dialog.errorTitle': 'InkMark Error',
    'dialog.exportWarningsTitle': 'Export completed with image warnings',
    'dialog.exportWarningsDetail': '{count} image(s) could not be included:',
    'dialog.remoteHtmlTitle': 'Exported HTML contains remote images',
    'dialog.remoteHtmlDetail': '{count} remote image(s) remain external and will need a network connection when the HTML is opened.',
    'dialog.remotePdfTitle': 'Remote images will be downloaded',
    'dialog.remotePdfDetail': 'PDF/print export will contact {count} remote image URL(s) and embed the results. Failed downloads will be omitted.',
    'dialog.aboutMessage': 'InkMark — a Typora-style Markdown editor',
    'dialog.aboutDetail': 'Version {version}\nRepository: https://github.com/newbie3033/markdown-editor',
    'dialog.openRepo': 'Open repository',
    'dialog.cleanStorage': 'Clean',
    'dialog.cleanStorageTitle': 'Clean selected storage?',
    'dialog.cleanStorageDetail': 'The following InkMark data will be permanently deleted:',
    'dialog.cleanStorageRecoveryWarning': 'The recovery draft contains unsaved work and cannot be restored after cleaning.',
    'storage.cache': 'Cache',
    'storage.logs': 'Logs',
    'storage.crashReports': 'Crash reports',
    'storage.backups': 'Previous-version backups',
    'storage.recovery': 'Recovery draft',
    'dialog.upToDateTitle': 'InkMark is up to date',
    'dialog.upToDateDetail': 'You are using the latest version ({version}).',
    'dialog.updateCheckFailedTitle': 'Could not check for updates',
    'dialog.updateCheckFailedDetail': 'Check your network connection, or open the Release page to check manually.',
    'dialog.openReleases': 'Open Release page',
    'dialog.ok': 'OK'
  },
  zh: {
    'menu.file': '文件',
    'menu.new': '新建',
    'menu.welcome': '打开欢迎页',
    'menu.open': '打开…',
    'menu.openFolder': '打开文件夹…',
    'menu.searchFolder': '在文件夹中搜索…',
    'menu.closeFolder': '关闭全部文件夹',
    'menu.save': '保存',
    'menu.saveAs': '另存为…',
    'menu.exportHtml': '导出为 HTML…',
    'menu.exportPdf': '导出为 PDF…',
    'menu.print': '打印…',
    'menu.close': '关闭',
    'menu.quit': '退出',
    'menu.edit': '编辑',
    'menu.undo': '撤销',
    'menu.redo': '重做',
    'menu.cut': '剪切',
    'menu.copy': '复制',
    'menu.paste': '粘贴',
    'menu.selectAll': '全选',
    'menu.find': '查找',
    'menu.replace': '替换',
    'menu.view': '视图',
    'menu.toggleSidebar': '切换侧边栏',
    'menu.toggleArticles': '文章',
    'menu.toggleFileTree': '文件树',
    'menu.toggleOutline': '切换大纲',
    'menu.toggleSource': '切换源码模式',
    'menu.theme': '主题',
    'menu.mermaidStyle': 'Mermaid 风格',
    'menu.mermaidSoft': '柔和浅深色',
    'menu.mermaidBlue': '经典蓝色',
    'menu.themeSystem': '跟随系统',
    'menu.themeLight': '浅色',
    'menu.themeDark': '深色',
    'menu.language': '语言 / Language',
    'menu.actualSize': '实际大小',
    'menu.zoomIn': '放大',
    'menu.zoomOut': '缩小',
    'menu.toggleFullscreen': '切换全屏',
    'menu.toggleDevTools': '切换开发者工具',
    'menu.help': '帮助',
    'menu.checkForUpdates': '检查更新…',
    'menu.checkUpdatesOnStartup': '启动时自动检查更新',
    'menu.about': '关于 InkMark',
    'menu.editMode': '编辑模式',
    'menu.readOnlyMode': '只读模式',
    'menu.defaultMode': '默认模式',
    'menu.repository': '开源仓库',
    'menu.storage': '存储空间…',
    'dialog.openFile': '打开 Markdown 文件',
    'dialog.saveFile': '保存 Markdown 文件',
    'dialog.openFolder': '打开文件夹',
    'dialog.exportDiagramPng': '将图表保存为 PNG',
    'dialog.exportHtml': '导出为 HTML',
    'dialog.exportPdf': '导出为 PDF',
    'dialog.pickImage': '选择图片',
    'filter.markdown': 'Markdown',
    'filter.allFiles': '所有文件',
    'filter.html': 'HTML',
    'filter.pdf': 'PDF',
    'filter.images': '图片',
    'dialog.save': '保存',
    'dialog.dontSave': '不保存',
    'dialog.cancel': '取消',
    'dialog.unsavedTitle': '是否保存更改？',
    'dialog.unsavedDetail': '“{name}” 有尚未保存的更改。',
    'dialog.reload': '重新载入',
    'dialog.keepEditing': '继续编辑',
    'dialog.externalChangedTitle': '磁盘上的文件已更改',
    'dialog.externalChangedDetail': '“{name}” 已被其他应用修改。',
    'dialog.restore': '恢复草稿',
    'dialog.discardDraft': '丢弃草稿',
    'dialog.recoveryTitle': '是否恢复未保存内容？',
    'dialog.recoveryDetail': '发现“{name}”在 {time} 的未保存草稿。',
    'dialog.errorTitle': 'InkMark 错误',
    'dialog.exportWarningsTitle': '导出完成，但部分图片存在问题',
    'dialog.exportWarningsDetail': '有 {count} 张图片未能包含在导出文件中：',
    'dialog.remoteHtmlTitle': '导出的 HTML 包含远程图片',
    'dialog.remoteHtmlDetail': '有 {count} 张远程图片仍使用外部链接，打开 HTML 时需要网络连接。',
    'dialog.remotePdfTitle': '即将下载远程图片',
    'dialog.remotePdfDetail': '导出 PDF/打印时将访问 {count} 个远程图片地址并嵌入结果，下载失败的图片会被跳过。',
    'dialog.aboutMessage': 'InkMark — 一款 Typora 风格的 Markdown 编辑器',
    'dialog.aboutDetail': '版本 {version}\n开源仓库：https://github.com/newbie3033/markdown-editor',
    'dialog.openRepo': '打开开源仓库',
    'dialog.cleanStorage': '清理',
    'dialog.cleanStorageTitle': '清理所选空间？',
    'dialog.cleanStorageDetail': '以下 InkMark 数据将被永久删除：',
    'dialog.cleanStorageRecoveryWarning': '恢复草稿包含未保存的内容，清理后将无法恢复。',
    'storage.cache': '缓存',
    'storage.logs': '日志',
    'storage.crashReports': '崩溃报告',
    'storage.backups': '历史版本备份',
    'storage.recovery': '恢复草稿',
    'dialog.upToDateTitle': 'InkMark 已是最新版本',
    'dialog.upToDateDetail': '当前使用的已是最新版本（{version}）。',
    'dialog.updateCheckFailedTitle': '无法检查更新',
    'dialog.updateCheckFailedDetail': '请检查网络连接，或打开 Release 页面手动查看。',
    'dialog.openReleases': '打开 Release 页面',
    'dialog.ok': '确定'
  }
} as const

export type MessageKey = keyof (typeof messages)['en']

let currentLocale: Lang = 'en'
let onLocaleChanged: (() => void) | null = null

function systemLocale(): Lang {
  const locale = app.getLocale() ?? 'en'
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function loadLocale(): Lang {
  const { locale } = readSettings()
  return locale === 'en' || locale === 'zh' ? locale : systemLocale()
}

export function initLocale(onChange: () => void): Lang {
  onLocaleChanged = onChange
  currentLocale = loadLocale()
  return currentLocale
}

export function getLocale(): Lang {
  return currentLocale
}

export function setLocale(lang: Lang): void {
  if (lang !== 'en' && lang !== 'zh') return
  currentLocale = lang
  try {
    writeSettings({ locale: lang })
  } catch {
    // Persisting settings is best-effort.
  }
  onLocaleChanged?.()
}

export function t(key: MessageKey): string {
  return messages[currentLocale][key]
}
