import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Lang } from '../../../shared/ipc'

const dict = {
  en: {
    'files.openFolder': 'Open Folder',
    'files.closeFolder': 'Close folder',
    'files.openFiles': 'Open Files',
    'files.closeFile': 'Close file',
    'files.empty': 'Open a folder to browse your notes',
    'files.noMarkdown': 'No markdown files found',
    'outline.title': 'Outline',
    'outline.empty': 'No headings yet',
    'status.untitled': 'Untitled',
    'status.words': 'words',
    'status.chars': 'chars',
    'status.lines': 'lines',
    'status.sourceMode': 'Toggle source code mode (Ctrl+/)',
    'status.theme': 'Toggle theme',
    'status.language': 'Switch language',
    'status.zoomIn': 'Zoom in',
    'status.zoomOut': 'Zoom out',
    'status.zoomReset': 'Reset zoom',
    'status.toggleSidebar': 'Toggle file sidebar',
    'status.toggleOutline': 'Toggle outline',
    'editor.placeholder': 'Type here…',
    'ctx.copy': 'Copy',
    'ctx.cut': 'Cut',
    'ctx.paste': 'Paste',
    'ctx.h1': 'Heading 1',
    'ctx.h2': 'Heading 2',
    'ctx.h3': 'Heading 3',
    'ctx.bold': 'Bold',
    'ctx.italic': 'Italic',
    'ctx.strikethrough': 'Strikethrough',
    'ctx.inlineCode': 'Inline Code',
    'ctx.link': 'Link',
    'ctx.image': 'Image',
    'ctx.quote': 'Quote',
    'ctx.codeBlock': 'Code Block',
    'ctx.bulletList': 'Bullet List',
    'ctx.orderedList': 'Ordered List',
    'ctx.taskList': 'Task List',
    'ctx.table': 'Table',
    'ctx.hr': 'Horizontal Rule',
    'ctx.paragraph': 'Paragraph',
    'ctx.linkPrompt': 'Enter link URL:',
    'ctx.linkPlaceholder': 'https://example.com',
    'tabs.files': 'Files',
    'tabs.search': 'Search',
    'search.placeholder': 'Search file names and content…',
    'search.noFolder': 'Open a folder first to search',
    'search.noQuery': 'Type a keyword to search',
    'search.noResults': 'No results',
    'search.matches': '{n} matches',
    'search.nameBadge': 'name',
    'search.matchCase': 'Aa',
    'search.matchCaseTip': 'Match Case',
    'search.wholeWord': 'ab',
    'search.wholeWordTip': 'Match Whole Word',
    'search.regex': '.*',
    'search.regexTip': 'Use Regular Expression',
    'find.placeholder': 'Find…',
    'find.noMatch': 'No matches',
    'find.next': 'Next (Enter)',
    'find.prev': 'Previous (Shift+Enter)',
    'find.close': 'Close (Esc)',
    'find.replaceToggle': 'Replace (Ctrl+H)',
    'find.replaceWith': 'Replace with…',
    'find.replace': 'Replace',
    'find.replaceAll': 'Replace all',
    'code.copy': 'Copy',
    'code.copied': 'Copied',
    'status.copyPath': 'Copy file path',
    'status.copySuccess': 'Path copied ✓',
    'status.copyFail': 'Copy failed',
    'status.dirtyIndicator': 'Dirty indicator',
    'status.filePathLabel': 'File path',
    'status.zoomLabel': 'Zoom',
    'status.itemsTitle': 'Status bar items',
    'status.readOnly': 'Read-only mode',
    'status.editMode': 'Edit mode',
    'status.readOnlySuffix': ' (read-only)',
    'error.saveFailed': 'Could not save the document. Your edits are still open.',
    'error.fileChanged': 'The file changed on disk. It was not overwritten; use Save As or reopen it.',
    'error.openFailed': 'Could not open the requested file or folder.',
    'error.exportFailed': 'Could not export or print the document.',
    'error.imageFailed': 'Could not insert the image.',
    'error.recoveryFailed': 'Crash recovery could not be updated.'
  },
  zh: {
    'files.openFolder': '打开文件夹',
    'files.closeFolder': '关闭文件夹',
    'files.openFiles': '打开的文件',
    'files.closeFile': '关闭文件',
    'files.empty': '打开文件夹以浏览你的笔记',
    'files.noMarkdown': '未找到 Markdown 文件',
    'outline.title': '大纲',
    'outline.empty': '暂无标题',
    'status.untitled': '未命名',
    'status.words': '词',
    'status.chars': '字符',
    'status.lines': '行',
    'status.sourceMode': '切换源码模式（Ctrl+/）',
    'status.theme': '切换主题',
    'status.language': '切换语言',
    'status.zoomIn': '放大',
    'status.zoomOut': '缩小',
    'status.zoomReset': '重置缩放',
    'status.toggleSidebar': '切换文件侧边栏',
    'status.toggleOutline': '切换大纲栏',
    'editor.placeholder': '在这里开始输入…',
    'ctx.copy': '复制',
    'ctx.cut': '剪切',
    'ctx.paste': '粘贴',
    'ctx.h1': '一级标题',
    'ctx.h2': '二级标题',
    'ctx.h3': '三级标题',
    'ctx.bold': '加粗',
    'ctx.italic': '斜体',
    'ctx.strikethrough': '删除线',
    'ctx.inlineCode': '行内代码',
    'ctx.link': '链接',
    'ctx.image': '图片',
    'ctx.quote': '引用',
    'ctx.codeBlock': '代码块',
    'ctx.bulletList': '无序列表',
    'ctx.orderedList': '有序列表',
    'ctx.taskList': '任务列表',
    'ctx.table': '表格',
    'ctx.hr': '分割线',
    'ctx.paragraph': '正文',
    'ctx.linkPrompt': '请输入链接地址：',
    'ctx.linkPlaceholder': 'https://example.com',
    'tabs.files': '文件',
    'tabs.search': '搜索',
    'search.placeholder': '搜索文件名和内容…',
    'search.noFolder': '请先打开文件夹再搜索',
    'search.noQuery': '输入关键词开始搜索',
    'search.noResults': '无结果',
    'search.matches': '{n} 处匹配',
    'search.nameBadge': '文件名',
    'search.matchCase': 'Aa',
    'search.matchCaseTip': '区分大小写',
    'search.wholeWord': 'ab',
    'search.wholeWordTip': '全字匹配',
    'search.regex': '.*',
    'search.regexTip': '使用正则表达式',
    'find.placeholder': '查找…',
    'find.noMatch': '无匹配',
    'find.next': '下一个（Enter）',
    'find.prev': '上一个（Shift+Enter）',
    'find.close': '关闭（Esc）',
    'find.replaceToggle': '替换（Ctrl+H）',
    'find.replaceWith': '替换为…',
    'find.replace': '替换',
    'find.replaceAll': '全部替换',
    'code.copy': '复制',
    'code.copied': '已复制',
    'status.copyPath': '复制文件路径',
    'status.copySuccess': '路径已复制 ✓',
    'status.copyFail': '复制失败',
    'status.dirtyIndicator': '修改标记',
    'status.filePathLabel': '文件路径',
    'status.zoomLabel': '缩放',
    'status.itemsTitle': '状态栏项目',
    'status.readOnly': '只读模式',
    'status.editMode': '编辑模式',
    'status.readOnlySuffix': '（只读）',
    'error.saveFailed': '无法保存文档，当前编辑内容仍保留在窗口中。',
    'error.fileChanged': '文件已被其他程序修改，因此没有覆盖。请另存为或重新打开文件。',
    'error.openFailed': '无法打开指定的文件或文件夹。',
    'error.exportFailed': '无法导出或打印文档。',
    'error.imageFailed': '无法插入图片。',
    'error.recoveryFailed': '无法更新崩溃恢复草稿。'
  }
} as const

export type MessageKey = keyof (typeof dict)['en']

const WELCOME_EN = `# Welcome to InkMark

A **Typora-style** WYSIWYG Markdown editor.

## Features

- Write Markdown and see it rendered *inline*, just like Typora
- \`Ctrl+/\` toggles source code mode
- \`Ctrl+Shift+1\` / \`Ctrl+Shift+2\` / \`Ctrl+Shift+3\` toggle the outline, articles and file tree panels (\`Ctrl+Shift+L\` toggles the sidebar)
- Paste or drag an **image** to insert it next to your document
- Drag a \`.md\` file anywhere into the window to open it
- **Right-click** in the editor for quick formatting
- \`Ctrl+F\` finds in the document, \`Ctrl+H\` finds and replaces, \`Ctrl+Shift+F\` searches the folder
- **File → Export as PDF/HTML** to share your notes

> Tip: open a folder with \`Ctrl+Shift+O\` to browse your notes.

\`\`\`js
console.log("Hello, InkMark!")
\`\`\`

- [x] Task lists work
- [ ] And so do links: [Milkdown](https://milkdown.dev)
`

const WELCOME_ZH = `# 欢迎使用 InkMark

一款 **Typora 风格**的所见即所得 Markdown 编辑器。

## 功能特性

- 边写边渲染，和 Typora 一样所见即所得
- \`Ctrl+/\` 切换源码模式
- \`Ctrl+Shift+1\` / \`Ctrl+Shift+2\` / \`Ctrl+Shift+3\` 切换大纲、文章与文件树（\`Ctrl+Shift+L\` 切换侧边栏）
- 粘贴或拖入**图片**即可插入到文档旁边
- 将 \`.md\` 文件拖入窗口任意位置即可打开
- 在编辑器中**右键**可快捷插入格式
- \`Ctrl+F\` 文档内查找，\`Ctrl+H\` 查找并替换，\`Ctrl+Shift+F\` 文件夹关键词搜索
- **文件 → 导出为 PDF/HTML** 分享你的笔记

> 提示：按 \`Ctrl+Shift+O\` 打开文件夹浏览笔记。

\`\`\`js
console.log("你好，InkMark！")
\`\`\`

- [x] 任务列表可用
- [ ] 链接也一样：[Milkdown](https://milkdown.dev)
`

export function welcomeMarkdown(lang: Lang): string {
  return lang === 'zh' ? WELCOME_ZH : WELCOME_EN
}

// Static translation for non-React contexts (e.g. ProseMirror node views).
let activeLang: Lang = 'en'

export function setActiveLang(lang: Lang): void {
  activeLang = lang
}

export function tStatic(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = dict[activeLang][key]
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(replacement))
    }
  }
  return text
}

interface I18nValue {
  lang: Lang
  ready: boolean
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>('en')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.api.getLocale().then((locale) => {
      if (mounted) {
        setLangState(locale)
        setActiveLang(locale)
        setReady(true)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      ready,
      setLang: (next: Lang) => {
        setLangState(next)
        setActiveLang(next)
        void window.api.setLocale(next)
      },
      t: (key: MessageKey, params?: Record<string, string | number>) => {
        let text: string = dict[lang][key]
        if (params) {
          for (const [name, replacement] of Object.entries(params)) {
            text = text.replace(`{${name}}`, String(replacement))
          }
        }
        return text
      }
    }),
    [lang, ready]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
