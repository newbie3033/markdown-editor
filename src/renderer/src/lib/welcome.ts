import type { Lang } from '../../../shared/ipc'
import { formatShortcut } from './shortcuts'

type Feature = Record<Lang, [label: string, description: string]> & { path: string }
type Section = Record<Lang, string> & { features: Feature[] }

const sections: Section[] = [
  {
    en: 'Writing and formatting', zh: '写作与排版',
    features: [
      {
        path: 'M4 20l4-1L20 7l-4-4L4 15zM13 6l5 5',
        en: ['Editing modes', 'Write with live formatting or switch to source with `Ctrl+/`. Choose read-only or a default mode in View.'],
        zh: ['编辑模式', '边写边看排版效果。用 `Ctrl+/` 切换源码，可在「视图」切到只读或设置默认模式。']
      },
      {
        path: 'M4 5v14m8-14v14M4 12h8m4-3 3-2v12m-3 0h6',
        en: ['Text and headings', 'Use bold, italics, strikethrough, inline code, quotes and dividers. Set heading levels with `Ctrl+1` through `Ctrl+6`, or return to a paragraph with `Ctrl+0`.'],
        zh: ['文字与段落', '支持六级标题、粗体、斜体、删除线、行内代码、引用和分隔线。`Ctrl+1` 至 `Ctrl+6` 设置标题，`Ctrl+0` 恢复正文。']
      },
      {
        path: 'M3 5h18v14H3zM3 10h18M9 10v9',
        en: ['Lists and tables', 'Use numbered, bulleted or checkable task lists. Insert a table with `Ctrl+T` and set column alignment in Markdown.'],
        zh: ['列表与表格', '可插入有序、无序列表和可勾选的任务清单。`Ctrl+T` 插入表格，Markdown 表格支持列对齐。']
      },
      {
        path: 'M2 6h20v12H2zM5 10h1m3 0h1m3 0h1m3 0h1M7 14h10',
        en: ['Editing tools', 'Right-click to format text or insert links and images. Cut, copy, paste, select all, undo, redo or clear inline formatting.'],
        zh: ['编辑工具', '右键可插入格式、链接和图片，也可剪切、复制、粘贴。支持全选、撤销、重做和清除行内格式。']
      },
      {
        path: 'M3 4h18v12H9l-5 4v-4H3zM7 8h10m-10 4h6',
        en: ['Comments', 'Toggle an HTML comment on selected text with `Ctrl+Alt+/`. Edit comments in place. They are omitted from exports.'],
        zh: ['批注', '用 `Ctrl+Alt+/` 给选区添加或移除 HTML 注释。注释可在编辑器中修改，导出时自动隐藏。']
      },
      {
        path: 'M8 5H4v14h4m8-14h4v14h-4m-5-3 2-8',
        en: ['Source formatting', 'Switch views or edit a passage while preserving untouched Markdown, including list markers, table alignment and line endings.'],
        zh: ['源码保留', '切换视图或局部编辑时，保留未改动部分的 Markdown 写法，例如列表标记、表格对齐和换行。']
      }
    ]
  },
  {
    en: 'Images, code and diagrams', zh: '图片、代码与图表',
    features: [
      {
        path: 'M3 4h18v16H3zM4 17l5-5 4 3 3-5 5 7M7 8h1',
        en: ['Inserting images', 'Pick a file, paste a screenshot or drop an image. Imports go in the adjacent `assets/` folder. Images already under the document folder are linked in place.'],
        zh: ['插入图片', '可选取文件、粘贴截图或拖入图片。新导入的附件放在文档旁的 `assets/` 中，文档目录内已有的图片可直接使用相对路径。']
      },
      {
        path: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0M6 10h8m-4-4v8',
        en: ['Image preview', 'Use the image’s magnifier to zoom at the pointer, drag to pan or fit the image to the window. Remote images load on request.'],
        zh: ['图片预览', '点击图片上的放大图标，可用滚轮缩放、拖动平移或恢复适应窗口。网络图片由你决定是否加载。']
      },
      {
        path: 'M8 6l-6 6 6 6m8-12 6 6-6 6m-3-15-3 18',
        en: ['Code and HTML', 'Copy syntax-highlighted code blocks. Toggle HTML rendering for inline tags, collapsible sections and merged table cells. Inspect and edit the preview source.'],
        zh: ['代码与 HTML', '代码块支持语法高亮和一键复制。可开关 HTML 渲染，预览行内标签、可折叠内容或跨行跨列的表格，并查看和编辑源码。']
      },
      {
        path: 'M18 4H6l7 8-7 8h12',
        en: ['Math', 'Use `$…$` for inline equations and `$$…$$` for display equations, including multiline LaTeX.'],
        zh: ['数学公式', '用 `$…$` 排行内公式，`$$…$$` 排独立公式，支持多行 LaTeX。']
      },
      {
        path: 'M2 9h6v6H2zM16 2h6v6h-6zM16 16h6v6h-6zM8 12h4V5h4m-4 7v7h4',
        en: ['Mermaid diagrams', 'Draw flowcharts, sequence diagrams, Gantt charts and more. Change styles, edit or copy source, press `Esc` to finish editing, delete a diagram or save it as PNG.'],
        zh: ['Mermaid 图表', '绘制流程图、时序图、甘特图等。可切换风格、编辑或复制源码，按 `Esc` 返回预览，也可删除图表或另存为 PNG。']
      }
    ]
  },
  {
    en: 'Files and navigation', zh: '文件与导航',
    features: [
      {
        path: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8m-8 4h6',
        en: ['Opening and saving', 'Create, open, save, save as or reopen a recent document. Drop files or folders into the window, use your system’s Open With for files, or pass a path on the command line.'],
        zh: ['打开与保存', '新建、打开、保存、另存为，或从最近记录重开文档。Markdown、文本文件和文件夹均可拖入窗口，也可通过系统「打开方式」或命令行打开。']
      },
      {
        path: 'M3 6h7l2 2h9v11H3z',
        en: ['File sidebar', 'Browse several folders alongside individually opened files. Refresh a tree, close one file or folder, or close all folders.'],
        zh: ['文件侧栏', '同时浏览多个文件夹和单独打开的文档。可刷新文件树、单独关闭文件或文件夹，也可关闭全部文件夹。']
      },
      {
        path: 'M3 5h17M6 10h14M6 15h14M3 20h17',
        en: ['Outline and reading position', 'Jump to a heading in either view. The source outline updates as you type, and switching files or views remembers your place.'],
        zh: ['大纲与阅读位置', '点击标题即可在预览或源码中跳转。切换文档或视图时记住阅读位置，源码大纲也会随编辑更新。']
      },
      {
        path: 'M9 15l6-6M9 7l2-2a5 5 0 0 1 7 7l-2 2m-1 3-2 2a5 5 0 0 1-7-7l2-2',
        en: ['Links and anchors', 'Follow an anchor or jump to a heading in another Markdown file. Web links open in your browser and other local files in their default app.'],
        zh: ['链接与锚点', '跟随文内锚点或跳到另一篇 Markdown 的指定标题。网页用浏览器打开，其他本地文件用系统默认程序打开。']
      }
    ]
  },
  {
    en: 'Find and replace', zh: '查找与替换',
    features: [
      {
        path: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
        en: ['Find in a document', 'Select text and press `Ctrl+F` to search for it. Use `F3` and `Shift+F3` to move between matches.'],
        zh: ['文内查找', '选中文字后按 `Ctrl+F` 即可查找该词。`F3` 跳到下一处，`Shift+F3` 回到上一处。']
      },
      {
        path: 'M3 7h16l-4-4m4 4-4 4M21 17H5l4 4m-4-4 4-4',
        en: ['Replace and match options', 'Use `Ctrl+H` to replace one match or all. Both document and folder searches support match case, whole words and regular expressions.'],
        zh: ['替换与匹配', '`Ctrl+H` 可逐个或全部替换。文内查找和跨文件搜索都支持区分大小写、全词匹配及正则表达式。']
      },
      {
        path: 'M3 18V5h7l2 2h8v3M21 21l-4-4m1-3a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
        en: ['Search across files', 'Press `Ctrl+Shift+F` to search file names and contents across all open folders. Click a text match to open the file at that passage.'],
        zh: ['跨文件搜索', '用 `Ctrl+Shift+F` 同时查找所有已打开文件夹里的文件名和正文，点击正文结果直接定位到匹配处。']
      }
    ]
  },
  {
    en: 'Backups, recovery and export', zh: '备份、恢复与导出',
    features: [
      {
        path: 'M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5zM8 12l3 3 5-6',
        en: ['Backups and drafts', 'Saving keeps a backup of the previous version. Save, discard or cancel when closing edited work. After a crash, choose whether to restore the draft.'],
        zh: ['备份与草稿', '保存时备份上一版本。关闭有修改的文档前可保存、放弃或取消。意外退出后可选择恢复未保存的草稿。']
      },
      {
        path: 'M3 10a9 9 0 0 1 16-4l2 3m0-6v6h-6M21 14a9 9 0 0 1-16 4l-2-3m0 6v-6h6',
        en: ['External changes', 'Reload a changed file, keep your edits or save a copy. Locate a moved or renamed file while retaining the current edits.'],
        zh: ['外部变动', '文件被其他程序修改后，可重新加载、保留当前编辑或另存为。文件移动或更名后，可重新定位并保留当前修改。']
      },
      {
        path: 'M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5',
        en: ['Export and print', 'Use File to export editable Word (.docx), PDF or HTML, or print. HTML keeps remote image links. Word, PDF and print can download and embed the images.'],
        zh: ['导出与打印', '从「文件」菜单导出可编辑的 Word（.docx）、PDF 或 HTML，或直接打印。HTML 保留网络图片链接，Word、PDF 和打印可下载并嵌入图片。']
      }
    ]
  },
  {
    en: 'Workspace and maintenance', zh: '界面与维护',
    features: [
      {
        path: 'M3 4h18v16H3zM8 4v16m8-16v16',
        en: ['Panel layout', 'Show or hide the file and outline panels independently. Drag an edge to resize or double-click it to reset. Panel settings persist across launches.'],
        zh: ['侧栏布局', '文件侧栏和大纲可独立收起或展开。拖动边缘调整宽度，双击恢复默认宽度。下次启动会保留布局。']
      },
      {
        path: 'M12 2a10 10 0 1 0 10 10A8 8 0 0 1 12 2z',
        en: ['Appearance', 'Choose light, dark or system colors, switch between English and Chinese, zoom or enter full screen. Click the zoom percentage to return to 100%.'],
        zh: ['主题与显示', '可选浅色、深色或跟随系统，切换中英文、全屏或缩放。点击状态栏的缩放百分比恢复 100%。']
      },
      {
        path: 'M3 4h18v16H3zM3 15h18m-14 3h2m4 0h4',
        en: ['Status bar', 'See word, character and line counts and unsaved changes. Click the path to copy it. Right-click to choose items, or toggle source, read-only and sidebar views.'],
        zh: ['状态栏', '查看词数、字符数、行数和修改标记，点击文件路径即可复制。右键选择显示项目，也可在状态栏切换源码、只读和侧栏。']
      },
      {
        path: 'M3 7c0-5 18-5 18 0s-18 5-18 0zm0 0v10c0 5 18 5 18 0V7M3 12c0 5 18 5 18 0',
        en: ['Storage', 'Open Storage from Help to review disk usage and clear caches, logs, crash reports or backups by category. An active unsaved recovery draft is protected.'],
        zh: ['存储管理', '从「帮助」查看占用，按类清理缓存、日志、崩溃报告和旧备份，当前未保存的恢复草稿会受保护。']
      },
      {
        path: 'M20 9a8 8 0 1 0 0 6m0-12v6h-6m-2-1v5l3 2',
        en: ['Version and updates', 'Check the version, visit the source repository and check for updates manually or at startup. Read release notes and choose a package for your system.'],
        zh: ['版本与更新', '可查看当前版本、访问开源仓库，手动或在启动时检查更新。发现新版时可查看发行说明、选择适合系统的安装包。']
      }
    ]
  }
]

export function welcomeMarkdown(lang: Lang): string {
  const title = lang === 'zh' ? '欢迎使用 InkMark' : 'Welcome to InkMark'
  const footer = lang === 'zh' ? '可从 **帮助 → 打开欢迎页** 再次查看这份清单。' : 'Reopen this overview from **Help → Open Welcome Page**.'
  const content = sections.map(section => {
    const items = section.features.map(feature => {
      const [label, description] = feature[lang]
      return `- **${label}**${lang === 'zh' ? '　' : ' — '}${description}`
    })
    return `## ${section[lang]}\n\n${items.join('\n')}`
  })
  return formatShortcut([`# ${title}`, ...content, footer].join('\n\n') + '\n')
}

let iconMasks: Map<string, string> | undefined

export function getWelcomeIconMasks(): ReadonlyMap<string, string> {
  if (iconMasks) return iconMasks
  iconMasks = new Map()
  for (const { features } of sections) {
    for (const { en, zh, path } of features) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
      iconMasks.set(en[0], mask)
      iconMasks.set(zh[0], mask)
    }
  }
  return iconMasks
}
