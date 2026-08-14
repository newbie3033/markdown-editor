// Self-test harness for headless verification.
// Only runs when INKMARK_SELFTEST=1 is set; results are logged to stderr.

import { app, clipboard, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC, REPOSITORY_URL } from '../shared/ipc'

const TEST_DIR = '/tmp/inkmark-selftest'
const results: string[] = []

function check(name: string, ok: boolean, extra = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + String(extra).slice(0, 300) : ''}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runSelfTest(win: BrowserWindow): Promise<void> {
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code, true)
  win.webContents.on('console-message', (_event: unknown, levelOrMessage: unknown, message: unknown) => {
    const text =
      typeof levelOrMessage === 'string' ? levelOrMessage : typeof message === 'string' ? message : ''
    if (text) console.log('[renderer]', String(text).slice(0, 400))
  })
  try {
    // Detect a startup "open with" file argument BEFORE TEST_DIR is wiped
    // (the file must exist at app launch; the wipe happens right after).
    const startupPath = process.argv
      .slice(1)
      .find(
        (arg) =>
          !arg.startsWith('-') &&
          existsSync(arg) &&
          /\.(md|markdown|mdown|mkd|mdwn|txt)$/i.test(arg)
      )
    await fs.rm(TEST_DIR, { recursive: true, force: true })
    await fs.mkdir(join(TEST_DIR, 'docs'), { recursive: true })
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    await fs.writeFile(join(TEST_DIR, 'source.png'), png)
    await fs.writeFile(join(TEST_DIR, 'docs', 'drop-test.md'), '# Dropped Document\n\nHello from drop test.')

    // Wait for the editor to mount (also a rough startup-time metric).
    const startedAt = Date.now()
    let mounted = false
    let mountMs = -1
    for (let i = 0; i < 40; i++) {
      mounted = (await js(`!!document.querySelector('.ProseMirror h1')`)) === true
      if (mounted) {
        mountMs = Date.now() - startedAt
        break
      }
      await sleep(250)
    }
    check('editor mounted', mounted)
    console.log('[SELFTEST] INFO editor mounted in ~' + mountMs + 'ms')

    // 0c. Startup "open with": a markdown file passed on the command line must
    // be displayed (not the welcome doc) and must not be marked dirty.
    if (startupPath) {
      await sleep(600)
      const startup = (await js(`(async () => ({
        h1: document.querySelector('.ProseMirror h1')?.textContent,
        title: document.title,
        dirtyIndicator: document.querySelector('.statusbar-left .dirty-indicator')?.textContent?.trim(),
        markdown: window.__inkmarkGetMarkdown()
      }))()`)) as { h1?: string | null; title?: string; dirtyIndicator?: string | null; markdown?: string | null }
      check(
        'startup file content displayed',
        startup?.h1 === 'Startup File',
        JSON.stringify(startup)
      )
      check(
        'startup file opens clean (not dirty)',
        startup?.dirtyIndicator === '○' && !(startup?.title ?? '').startsWith('●'),
        JSON.stringify(startup)
      )
    }

    // 0b. Checkbox styling: CSS-drawn checkmark (no text glyph).
    const checkboxStyle = (await js(`(async () => {
      const li = document.querySelector('.md-body li[data-item-type="task"][data-checked="true"]')
      if (!li) return { ok: false }
      const st = getComputedStyle(li, '::after')
      return {
        ok: true,
        content: st.content,
        borderRightWidth: st.borderRightWidth,
        transformed: st.transform !== 'none'
      }
    })()`)) as { ok?: boolean; content?: string; borderRightWidth?: string; transformed?: boolean }
    check(
      'checkbox uses css-drawn checkmark',
      checkboxStyle?.ok === true &&
        !(checkboxStyle?.content ?? '').includes('✓') &&
        checkboxStyle?.borderRightWidth === '2px' &&
        checkboxStyle?.transformed === true,
      JSON.stringify(checkboxStyle)
    )

    // 1. Locale roundtrip.
    const locale = (await js(`window.api.getLocale()`)) as string
    check('getLocale', locale === 'en' || locale === 'zh', locale)
    await js(`window.api.setLocale('zh')`)
    const localeZh = (await js(`window.api.getLocale()`)) as string
    check('setLocale zh', localeZh === 'zh', localeZh)
    await js(`window.api.setLocale(${JSON.stringify(locale)})`)

    // 2. saveImage from a source path (document open → assets/<name>).
    const saved = (await js(
      `window.api.saveImage({ sourcePath: '/tmp/inkmark-selftest/source.png', name: 'src.png', docPath: '/tmp/inkmark-selftest/docs/doc.md' })`
    )) as { src: string } | null
    check('saveImage(sourcePath)', saved?.src === 'assets/src.png', JSON.stringify(saved))
    const exists1 = await fs
      .access(join(TEST_DIR, 'docs', 'assets', 'src.png'))
      .then(() => true)
      .catch(() => false)
    check('image saved next to doc', exists1)

    // 3. saveImage from raw data (no doc → absolute file URL).
    const saved2 = (await js(
      `window.api.saveImage({ data: Uint8Array.from([137,80,78,71,13,10,26,10]).buffer, name: 'p.png', docPath: null })`
    )) as { src: string } | null
    check('saveImage(data)', typeof saved2?.src === 'string' && saved2.src.includes('p.png'), JSON.stringify(saved2))

    // 4. Context menu opens on right click; clicking 分割线 (hr) inserts an hr.
    const menuInfo = (await js(`(async () => {
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }))
      await new Promise(r => setTimeout(r, 500))
      const menu = document.querySelector('.ctx-menu')
      if (!menu) return { ok: false }
      const labels = Array.from(menu.querySelectorAll('.ctx-item .ctx-label')).map(e => e.textContent)
      const hrBtn = Array.from(menu.querySelectorAll('.ctx-item')).find(b => b.textContent.includes('分割线'))
      const before = !!document.querySelector('.ProseMirror hr')
      if (hrBtn) hrBtn.click()
      await new Promise(r => setTimeout(r, 400))
      return {
        ok: true,
        labels: labels.slice(0, 6),
        before,
        after: !!document.querySelector('.ProseMirror hr'),
        menuClosed: !document.querySelector('.ctx-menu')
      }
    })()`)) as { ok?: boolean; labels?: string[]; before?: boolean; after?: boolean; menuClosed?: boolean }
    check('context menu opens', menuInfo?.ok === true, JSON.stringify(menuInfo?.labels))
    check('context menu hr command', menuInfo?.before === false && menuInfo?.after === true)
    check('context menu closes after click', menuInfo?.menuClosed === true)

    // 5. Paste an image file into the editor.
    const paste = (await js(`(async () => {
      const bytes = Uint8Array.from([137,80,78,71,13,10,26,10])
      const file = new File([bytes], 'pasted.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 1500))
      const img = document.querySelector('.ProseMirror img')
      const dirty = document.querySelector('.statusbar-left .dirty-indicator')?.textContent
      return { imgSrc: img ? img.getAttribute('src') : null, dirty }
    })()`)) as { imgSrc?: string | null; dirty?: string | null }
    check(
      'paste image inserted',
      typeof paste?.imgSrc === 'string' && paste.imgSrc.includes('pasted.png'),
      String(paste?.imgSrc)
    )
    check('listener fires (dirty dot)', paste?.dirty?.trim() === '●', String(paste?.dirty))

    // 6. Drop a .md document onto the editor → it opens.
    const drop = (await js(`(async () => {
      const file = new File(['# Dropped Document'], 'drop-test.md', { type: 'text/markdown' })
      Object.defineProperty(file, 'path', { value: '/tmp/inkmark-selftest/docs/drop-test.md' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const pm = document.querySelector('.ProseMirror')
      const r = pm.getBoundingClientRect()
      const cx = r.left + Math.min(200, r.width / 2)
      const cy = r.top + 10
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clientX', { value: cx })
      Object.defineProperty(ev, 'clientY', { value: cy })
      pm.dispatchEvent(ev)
      await new Promise(r => setTimeout(r, 1500))
      return {
        heading: document.querySelector('.ProseMirror h1')?.textContent,
        dirty: document.querySelector('.dirty-indicator')?.textContent?.trim()
      }
    })()`)) as { heading?: string | null; dirty?: string | null }
    check('drop md opens document', drop?.heading === 'Dropped Document', String(drop?.heading))
    check('opened file is not dirty', drop?.dirty === '○', String(drop?.dirty))

    // 7. Drop an image onto the editor (doc is now open) → assets/<name> relative.
    const dropImg = (await js(`(async () => {
      const file = new File([], 'dropped.png', { type: 'image/png' })
      Object.defineProperty(file, 'path', { value: '/tmp/inkmark-selftest/source.png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const pm = document.querySelector('.ProseMirror')
      const r = pm.getBoundingClientRect()
      const cx = r.left + Math.min(200, r.width / 2)
      const cy = r.top + 10
      const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      Object.defineProperty(ev, 'clientX', { value: cx })
      Object.defineProperty(ev, 'clientY', { value: cy })
      pm.dispatchEvent(ev)
      await new Promise(r => setTimeout(r, 1500))
      const srcs = Array.from(document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)'))
        .map(i => i.getAttribute('src'))
      return { srcs }
    })()`)) as { srcs?: Array<string | null> }
    check(
      'drop image inserted (relative src)',
      Array.isArray(dropImg?.srcs) && dropImg.srcs.some((s) => s?.includes('assets/dropped.png')),
      JSON.stringify(dropImg?.srcs)
    )
    const exists2 = await fs
      .access(join(TEST_DIR, 'docs', 'assets', 'dropped.png'))
      .then(() => true)
      .catch(() => false)
    check('dropped image saved to assets dir', exists2)

    // 8. The relative src actually renders (via the <base> element).
    const rendered = (await js(`(async () => {
      const img = Array.from(document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)'))
        .find(i => (i.getAttribute('src') || '').includes('dropped.png'))
      if (!img) return false
      await new Promise(r => setTimeout(r, 1000))
      return img.complete && img.naturalWidth > 0
    })()`)) as boolean
    check('relative image renders via base href', rendered === true)

    // 9. Window-level drop of a .md file outside the editor.
    const dropWindow = (await js(`(async () => {
      const file = new File(['# Window Drop'], 'win-drop.md', { type: 'text/markdown' })
      Object.defineProperty(file, 'path', { value: '/tmp/inkmark-selftest/docs/drop-test.md' })
      const dt = new DataTransfer()
      dt.items.add(file)
      document.querySelector('.statusbar').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 1500))
      return { heading: document.querySelector('.ProseMirror h1')?.textContent }
    })()`)) as { heading?: string | null }
    check('window-level drop opens md', dropWindow?.heading === 'Dropped Document', String(dropWindow?.heading))

    // 9b. Code block copy-to-clipboard button.
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'code-test.md'),
      '# Code Test\n\n```js\nconsole.log("hi")\n```\n'
    )
    win.webContents.send(IPC.openPath, `${TEST_DIR}/docs/code-test.md`)
    await sleep(1000)
    const codeCopy = (await js(`(async () => {
      const wrap = document.querySelector('.code-block-wrap')
      const btn = document.querySelector('.code-copy-btn')
      const token = document.querySelector('.code-block-wrap .token')
      if (!wrap || !btn) return { ok: false }
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      return { ok: true, label: btn.textContent, hasToken: !!token }
    })()`)) as { ok?: boolean; label?: string | null; hasToken?: boolean }
    check('code block has copy button', codeCopy?.ok === true, JSON.stringify(codeCopy))
    const clipText = clipboard.readText()
    check(
      'copy button writes code to clipboard',
      clipText.includes('console.log("hi")'),
      JSON.stringify(clipText)
    )
    check('copy button shows feedback', codeCopy?.label === '已复制', String(codeCopy?.label))
    check('prism highlighting preserved', codeCopy?.hasToken === true, String(codeCopy?.hasToken))

    // 10. Folder-wide keyword search (content + filename).
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'search-test.md'),
      '# Keyword Alpha\n\nhello world\n\nfoo bar\n\nHELLO again\n'
    )
    const searchRes = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'hello')`
    )) as Array<{ path: string; name: string; nameMatch: boolean; matches: unknown[] }>
    check(
      'search files by content',
      Array.isArray(searchRes) &&
        searchRes.some((r) => r.name === 'search-test.md' && r.matches.length === 2) &&
        searchRes.every((r) => r.matches.length > 0),
      JSON.stringify(searchRes?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const searchName = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'search-test')`
    )) as Array<{ path: string; name: string; nameMatch: boolean }>
    check(
      'search files by name',
      Array.isArray(searchName) && searchName.some((r) => r.nameMatch && r.path.endsWith('search-test.md')),
      JSON.stringify(searchName?.map((r) => r.name))
    )

    const wildcardName = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'search-*', 'wildcard')`
    )) as Array<{ name: string; nameMatch: boolean }>
    check(
      'wildcard filename search',
      Array.isArray(wildcardName) && wildcardName.some((r) => r.name === 'search-test.md' && r.nameMatch),
      JSON.stringify(wildcardName?.map((r) => r.name))
    )
    const wildcardContent = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'h*llo', 'wildcard')`
    )) as Array<{ name: string; matches: unknown[] }>
    check(
      'wildcard content search',
      Array.isArray(wildcardContent) &&
        wildcardContent.some((r) => r.name === 'search-test.md' && r.matches.length === 2),
      JSON.stringify(wildcardContent?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const regexContent = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', '^foo', 'regex')`
    )) as Array<{ name: string; matches: unknown[] }>
    check(
      'regex content search (line anchor)',
      Array.isArray(regexContent) &&
        regexContent.some((r) => r.name === 'search-test.md' && r.matches.length === 1),
      JSON.stringify(regexContent?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const invalidRegex = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', '([unclosed', 'regex')`
    )) as unknown[]
    check('invalid regex returns empty', Array.isArray(invalidRegex) && invalidRegex.length === 0)

    // 11. UI flow: open the folder in the app, switch to the search tab, type a
    // query, click a match → opens the file and jumps to the match.
    const originalShowOpen = dialog.showOpenDialog.bind(dialog)
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [`${TEST_DIR}/docs`]
    })) as typeof dialog.showOpenDialog
    try {
      win.webContents.send(IPC.menuAction, 'open-folder')
      await sleep(800)
    } finally {
      dialog.showOpenDialog = originalShowOpen
    }
    win.webContents.send(IPC.menuAction, 'search-folder')
    await sleep(400)
    const uiSearch = (await js(`(async () => {
      const input = document.querySelector('.search-input')
      if (!input) return { ok: false }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 1400))
      const hits = Array.from(document.querySelectorAll('.search-hit'))
      const firstHit = hits.find(h => h.textContent.includes('hello world'))
      if (!firstHit) return { ok: true, hits: hits.length, labels: hits.slice(0, 3).map(h => h.textContent) }
      firstHit.click()
      await new Promise(r => setTimeout(r, 1200))
      const sel = window.getSelection()?.toString() ?? ''
      const h1 = document.querySelector('.ProseMirror h1')?.textContent
      return { ok: true, hits: hits.length, sel, h1 }
    })()`)) as { ok?: boolean; hits?: number; labels?: string[]; sel?: string; h1?: string | null }
    check(
      'search panel shows results',
      uiSearch?.ok === true && (uiSearch.hits ?? 0) >= 2,
      JSON.stringify({ ok: uiSearch?.ok, hits: uiSearch?.hits, labels: uiSearch?.labels })
    )
    check(
      'search result opens + jumps to match',
      uiSearch?.h1 === 'Keyword Alpha' && uiSearch?.sel?.toLowerCase() === 'hello',
      JSON.stringify({ h1: uiSearch?.h1, sel: uiSearch?.sel })
    )

    const regexUi = (await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.search-panel .mode-btn'))
      buttons[2]?.click()
      await new Promise(r => setTimeout(r, 300))
      const input = document.querySelector('.search-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'h.llo')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 1200))
      const files = Array.from(document.querySelectorAll('.search-file-name')).map(e => e.textContent)
      return { files }
    })()`)) as { files?: string[] }
    check(
      'search UI regex mode',
      Array.isArray(regexUi?.files) && regexUi.files.includes('search-test.md'),
      JSON.stringify(regexUi?.files)
    )
    // Back to text mode for later tests.
    await js(`(Array.from(document.querySelectorAll('.search-panel .mode-btn'))[0]?.click(), true)`)

    // 12. In-document find bar: count matches, Enter navigates and selects.
    win.webContents.send(IPC.menuAction, 'find')
    await sleep(400)
    const find = (await js(`(async () => {
      const input = document.querySelector('.findbar input')
      if (!input) return { ok: false }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      const count1 = document.querySelector('.find-count')?.textContent
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise(r => setTimeout(r, 400))
      const count2 = document.querySelector('.find-count')?.textContent
      const sel2 = window.getSelection()?.toString() ?? ''
      return { ok: true, count1: count1?.trim(), count2: count2?.trim(), sel2: sel2.toLowerCase() }
    })()`)) as { ok?: boolean; count1?: string; count2?: string; sel2?: string }
    check(
      'find bar counts matches',
      find?.ok === true && find?.count1 === '1/2',
      JSON.stringify(find)
    )
    check(
      'find bar Enter navigates to next match',
      find?.ok === true && find?.count2 === '2/2' && find?.sel2 === 'hello',
      JSON.stringify(find)
    )
    const findWildcard = (await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.findbar .mode-btn'))
      buttons[1]?.click()
      await new Promise(r => setTimeout(r, 200))
      const input = document.querySelector('.findbar input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'h*llo')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
      const count = document.querySelector('.find-count')?.textContent?.trim()
      return { count }
    })()`)) as { count?: string }
    check(
      'find bar wildcard mode',
      findWildcard?.count === '1/2',
      JSON.stringify(findWildcard)
    )

    // Close the find bar.
    await js(`(document.querySelector('.findbar .find-btn:last-child')?.click(), true)`)

    // 12c. Status bar zoom display.
    const zoomInitial = (await js(`document.querySelector('.zoom-value')?.textContent`)) as string | null
    check('status bar shows zoom', zoomInitial === '100%', String(zoomInitial))
    const zoomIn = (await js(`(async () => {
      document.querySelector('.zoom-in')?.click()
      await new Promise(r => setTimeout(r, 400))
      return document.querySelector('.zoom-value')?.textContent
    })()`)) as string | null
    check('zoom in updates display', zoomIn === '110%', String(zoomIn))
    win.webContents.send(IPC.menuAction, 'zoom-reset')
    await sleep(400)
    const zoomReset = (await js(`document.querySelector('.zoom-value')?.textContent`)) as string | null
    check('zoom reset via menu action', zoomReset === '100%', String(zoomReset))
    win.webContents.send(IPC.menuAction, 'zoom-out')
    await sleep(400)
    const zoomOut = (await js(`document.querySelector('.zoom-value')?.textContent`)) as string | null
    check('zoom out via menu action', zoomOut === '91%', String(zoomOut))
    win.webContents.send(IPC.menuAction, 'zoom-reset')
    await sleep(400)

    // 12d. Sidebar toggle icons and drag-resize.
    const toggleIcons = (await js(`(async () => {
      const left = '.app > aside.sidebar:not(.outline-sidebar)'
      const outline = '.app > aside.sidebar.outline-sidebar'
      const beforeSidebar = !!document.querySelector(left)
      const beforeOutline = !!document.querySelector(outline)
      document.querySelector('.toggle-sidebar-btn')?.click()
      await new Promise(r => setTimeout(r, 300))
      const afterSidebar = !!document.querySelector(left)
      document.querySelector('.toggle-sidebar-btn')?.click()
      await new Promise(r => setTimeout(r, 300))
      const restoredSidebar = !!document.querySelector(left)
      document.querySelector('.toggle-outline-btn')?.click()
      await new Promise(r => setTimeout(r, 300))
      const afterOutline = !!document.querySelector(outline)
      document.querySelector('.toggle-outline-btn')?.click()
      await new Promise(r => setTimeout(r, 300))
      const restoredOutline = !!document.querySelector(outline)
      return { beforeSidebar, afterSidebar, restoredSidebar, beforeOutline, afterOutline, restoredOutline }
    })()`)) as {
      beforeSidebar?: boolean; afterSidebar?: boolean; restoredSidebar?: boolean
      beforeOutline?: boolean; afterOutline?: boolean; restoredOutline?: boolean
    }
    check(
      'sidebar toggle icon works',
      toggleIcons?.beforeSidebar === true && toggleIcons?.afterSidebar === false && toggleIcons?.restoredSidebar === true,
      JSON.stringify(toggleIcons)
    )
    check(
      'outline toggle icon works',
      toggleIcons?.beforeOutline === true && toggleIcons?.afterOutline === false && toggleIcons?.restoredOutline === true,
      JSON.stringify(toggleIcons)
    )

    const resizeLeft = (await js(`(async () => {
      const sidebar = document.querySelector('.app > aside.sidebar:not(.outline-sidebar)')
      const handle = sidebar?.querySelector('.resize-handle')
      if (!sidebar || !handle) return { ok: false }
      const before = sidebar.getBoundingClientRect().width
      const rect = handle.getBoundingClientRect()
      const x = rect.left + 3
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: 200 }))
      await new Promise(r => setTimeout(r, 50))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 120, clientY: 200 }))
      await new Promise(r => setTimeout(r, 50))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x + 120, clientY: 200 }))
      await new Promise(r => setTimeout(r, 200))
      return { ok: true, before, after: sidebar.getBoundingClientRect().width }
    })()`)) as { ok?: boolean; before?: number; after?: number }
    check(
      'left sidebar drag resize',
      resizeLeft?.ok === true &&
        (resizeLeft.after ?? 0) >= (resizeLeft.before ?? 0) + 100 &&
        (resizeLeft.after ?? 0) <= 620,
      JSON.stringify(resizeLeft)
    )
    const resetLeft = (await js(`(async () => {
      const handle = document.querySelector('.app > aside.sidebar:not(.outline-sidebar) .resize-handle')
      handle?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await new Promise(r => setTimeout(r, 250))
      const w = document.querySelector('.app > aside.sidebar:not(.outline-sidebar)')?.getBoundingClientRect().width
      return { w }
    })()`)) as { w?: number }
    check('sidebar dblclick resets width', Math.abs((resetLeft?.w ?? 0) - 260) < 2, JSON.stringify(resetLeft))

    const resizeOutline = (await js(`(async () => {
      const sidebar = document.querySelector('.app > aside.sidebar.outline-sidebar')
      const handle = sidebar?.querySelector('.resize-handle')
      if (!sidebar || !handle) return { ok: false }
      const before = sidebar.getBoundingClientRect().width
      const rect = handle.getBoundingClientRect()
      const x = rect.left + 3
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: 200 }))
      await new Promise(r => setTimeout(r, 50))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x - 100, clientY: 200 }))
      await new Promise(r => setTimeout(r, 50))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x - 100, clientY: 200 }))
      await new Promise(r => setTimeout(r, 200))
      return { ok: true, before, after: sidebar.getBoundingClientRect().width }
    })()`)) as { ok?: boolean; before?: number; after?: number }
    check(
      'outline sidebar drag resize',
      resizeOutline?.ok === true &&
        (resizeOutline.after ?? 0) >= (resizeOutline.before ?? 0) + 80 &&
        (resizeOutline.after ?? 0) <= 620,
      JSON.stringify(resizeOutline)
    )

    // 12e. Status bar context menu: show/hide items.
    const menuOpen = (await js(`(async () => {
      document.querySelector('.statusbar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 700 }))
      await new Promise(r => setTimeout(r, 400))
      const items = Array.from(document.querySelectorAll('.statusbar-menu .menu-item')).map(e => e.textContent || '')
      return { ok: !!document.querySelector('.statusbar-menu'), n: items.length }
    })()`)) as { ok?: boolean; n?: number }
    check(
      'status bar context menu opens',
      menuOpen?.ok === true && (menuOpen?.n ?? 0) >= 10,
      JSON.stringify(menuOpen)
    )
    const toggleWords = (await js(`(async () => {
      const item = Array.from(document.querySelectorAll('.statusbar-menu .menu-item')).find(e => (e.textContent || '').includes('词') && !(e.textContent || '').includes('字符'))
      if (!item) return { ok: false }
      item.click()
      await new Promise(r => setTimeout(r, 300))
      const right = document.querySelector('.statusbar-right')?.textContent ?? ''
      return {
        ok: true,
        wordsHidden: !right.includes('词'),
        menuStill: !!document.querySelector('.statusbar-menu'),
        checked: !!item.querySelector('.menu-check.checked')
      }
    })()`)) as { ok?: boolean; wordsHidden?: boolean; menuStill?: boolean; checked?: boolean }
    check(
      'menu toggle hides words',
      toggleWords?.ok === true && toggleWords?.wordsHidden === true && toggleWords?.menuStill === true && toggleWords?.checked === false,
      JSON.stringify(toggleWords)
    )
    const toggleBack = (await js(`(async () => {
      const item = Array.from(document.querySelectorAll('.statusbar-menu .menu-item')).find(e => (e.textContent || '').includes('词') && !(e.textContent || '').includes('字符'))
      if (!item) return { ok: false }
      item.click()
      await new Promise(r => setTimeout(r, 300))
      const right = document.querySelector('.statusbar-right')?.textContent ?? ''
      return { ok: true, wordsVisible: right.includes('词') }
    })()`)) as { ok?: boolean; wordsVisible?: boolean }
    check(
      'menu toggle restores words',
      toggleBack?.ok === true && toggleBack?.wordsVisible === true,
      JSON.stringify(toggleBack)
    )
    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await sleep(300)
    const menuGone = (await js(`!document.querySelector('.statusbar-menu')`)) as boolean
    check('status bar menu closes on escape', menuGone === true)

    // 12f. Read-only / edit mode.
    const ro1 = (await js(`(async () => {
      document.querySelector('.toggle-readonly-btn')?.click()
      await new Promise(r => setTimeout(r, 400))
      return {
        editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
        title: document.title,
        btn: document.querySelector('.toggle-readonly-btn')?.textContent
      }
    })()`)) as { editable?: string | null; title?: string; btn?: string | null }
    check(
      'read-only disables editor',
      ro1?.editable === 'false' && ro1?.btn === '🔒',
      JSON.stringify(ro1)
    )
    check('read-only title suffix', (ro1?.title ?? '').includes('只读'), String(ro1?.title))
    const ro2 = (await js(`(async () => {
      document.querySelector('.ProseMirror').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }))
      await new Promise(r => setTimeout(r, 400))
      return { menu: !!document.querySelector('.ctx-menu') }
    })()`)) as { menu?: boolean }
    check('context menu suppressed in read-only', ro2?.menu === false)
    win.webContents.send(IPC.menuAction, 'mode-edit')
    await sleep(400)
    const ro3 = (await js(`document.querySelector('.ProseMirror')?.getAttribute('contenteditable')`)) as string | null
    check('mode-edit restores editing', ro3 === 'true', String(ro3))

    // 13. Export HTML/PDF end to end (save dialogs stubbed).
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'export-test.md'),
      '# Export Test\n\n![img](assets/dropped.png)\n'
    )
    win.webContents.send(IPC.openPath, `${TEST_DIR}/docs/export-test.md`)
    await sleep(1200)
    const EXPORT_DIR = join(TEST_DIR, 'export')
    await fs.mkdir(EXPORT_DIR, { recursive: true })
    const originalShowSave = dialog.showSaveDialog.bind(dialog)
    dialog.showSaveDialog = (async (_win, options) => ({
      canceled: false,
      filePath: join(EXPORT_DIR, basename(options?.defaultPath ?? 'document.html'))
    })) as typeof dialog.showSaveDialog
    try {
      const html = (await js(`window.__inkmarkBuildExportHtml()`)) as string
      check(
        'export html built (content + absolutized image)',
        typeof html === 'string' &&
          html.includes('class="md-body"') &&
          html.includes('file:///tmp/inkmark-selftest/docs/assets/dropped.png') &&
          html.includes('rotate(45deg)'),
        `len=${html?.length ?? 0}`
      )
      await js(`window.api.exportHtml('test-doc', ${JSON.stringify(html)})`)
      const htmlFile = join(EXPORT_DIR, 'test-doc.html')
      const htmlContent = await fs.readFile(htmlFile, 'utf8').catch(() => '')
      check(
        'export html file written',
        htmlContent.length > 0 && htmlContent.includes('class="md-body"'),
        `len=${htmlContent.length}`
      )
      await js(`window.api.exportPdf('test-doc', ${JSON.stringify(html)})`)
      const pdfBuf = await fs.readFile(join(EXPORT_DIR, 'test-doc.pdf')).catch(() => null)
      check(
        'export pdf file written',
        pdfBuf != null &&
          pdfBuf.length > 1000 &&
          pdfBuf.subarray(0, 4).toString() === '%PDF',
        `len=${pdfBuf?.length ?? 0} header=${pdfBuf?.subarray(0, 8).toString() ?? ''}`
      )
    } finally {
      dialog.showSaveDialog = originalShowSave
    }

    // 13b. Status bar path copy → clipboard + toast feedback.
    const pathCopy = (await js(`(async () => {
      const btn = document.querySelector('.status-path-btn')
      if (!btn) return { ok: false }
      const shown = btn.textContent?.trim()
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      const toastText = document.querySelector('.status-toast')?.textContent?.trim()
      await new Promise(r => setTimeout(r, 1800))
      const toastGone = !document.querySelector('.status-toast')
      return { ok: true, shown, toastText, toastGone }
    })()`)) as { ok?: boolean; shown?: string | null; toastText?: string | null; toastGone?: boolean }
    const copiedPath = clipboard.readText()
    check(
      'status path click copies path',
      pathCopy?.ok === true && copiedPath === pathCopy?.shown && copiedPath.endsWith('export-test.md'),
      JSON.stringify({ shown: pathCopy?.shown, copied: copiedPath })
    )
    check(
      'copy toast shows and hides',
      pathCopy?.toastText === '路径已复制 ✓' && pathCopy?.toastGone === true,
      JSON.stringify(pathCopy)
    )

    // 13c. About dialog: version info + repository link.
    let aboutUrl: string | null = null
    const originalOpenExternal2 = shell.openExternal.bind(shell)
    shell.openExternal = (async (url: string) => {
      aboutUrl = url
    }) as typeof shell.openExternal
    const originalShowMessageBox2 = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (async () => ({
      response: 0,
      checkboxChecked: false
    })) as unknown as typeof dialog.showMessageBox
    try {
      win.webContents.send(IPC.menuAction, 'about')
      await sleep(700)
    } finally {
      dialog.showMessageBox = originalShowMessageBox2
      shell.openExternal = originalOpenExternal2
    }
    check('about dialog opens repository', aboutUrl === REPOSITORY_URL, String(aboutUrl))

    // 14. Multiple open folders + cross-folder search + per-folder close.
    await fs.mkdir(join(TEST_DIR, 'docs2'), { recursive: true })
    await fs.writeFile(join(TEST_DIR, 'docs2', 'second.md'), '# Second Folder File\n')
    const originalShowOpen2 = dialog.showOpenDialog.bind(dialog)
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [join(TEST_DIR, 'docs2')]
    })) as typeof dialog.showOpenDialog
    try {
      win.webContents.send(IPC.menuAction, 'open-folder')
      await sleep(900)
    } finally {
      dialog.showOpenDialog = originalShowOpen2
    }
    // Back to the files tab (the folder list lives there).
    await js(
      `(Array.from(document.querySelectorAll('.sidebar-tabs .tab')).find(b => (b.textContent || '').includes('文件'))?.click(), true)`
    )
    await sleep(300)
    const folderCount = (await js(`document.querySelectorAll('.folder-root').length`)) as number
    check('multiple folders open simultaneously', folderCount === 2, String(folderCount))

    // Cross-folder search before closing the second folder.
    win.webContents.send(IPC.menuAction, 'search-folder')
    await sleep(400)
    const multiSearch = (await js(`(async () => {
      const input = document.querySelector('.search-input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'second')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 1200))
      const files = Array.from(document.querySelectorAll('.search-file-name')).map(e => e.textContent)
      return { files }
    })()`)) as { files?: string[] }
    check(
      'search across multiple folders',
      Array.isArray(multiSearch?.files) && multiSearch.files.includes('second.md'),
      JSON.stringify(multiSearch?.files)
    )

    // Back to the files tab and close the second folder.
    await js(
      `(Array.from(document.querySelectorAll('.sidebar-tabs .tab')).find(b => (b.textContent || '').includes('文件'))?.click(), true)`
    )
    await sleep(300)
    const closeOneFolder = (await js(`(async () => {
      const roots = document.querySelectorAll('.folder-root')
      if (roots.length < 2) return { ok: false, n: roots.length }
      roots[1].querySelector('.icon-btn').click()
      await new Promise(r => setTimeout(r, 500))
      return { ok: true, n: document.querySelectorAll('.folder-root').length }
    })()`)) as { ok?: boolean; n?: number }
    check('close one folder keeps the other', closeOneFolder?.ok === true && closeOneFolder?.n === 1, JSON.stringify(closeOneFolder))

    // 14b. Drag-drop a FOLDER onto the window → opens in the sidebar.
    await fs.mkdir(join(TEST_DIR, 'docs3'), { recursive: true })
    await fs.writeFile(join(TEST_DIR, 'docs3', 'third.md'), '# Third Folder File\n')
    const folderDrop = (await js(`(async () => {
      const before = document.querySelectorAll('.folder-root').length
      const file = new File([], 'docs3', { type: '' })
      Object.defineProperty(file, 'path', { value: '/tmp/inkmark-selftest/docs3' })
      const dt = new DataTransfer()
      dt.items.add(file)
      document.querySelector('.statusbar').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 1200))
      const after = document.querySelectorAll('.folder-root').length
      const found = Array.from(document.querySelectorAll('.folder-header .folder-name')).some(e => e.textContent === 'docs3')
      return { before, after, found }
    })()`)) as { before?: number; after?: number; found?: boolean }
    check(
      'drop folder opens it in sidebar',
      folderDrop?.before === 1 && folderDrop?.after === 2 && folderDrop?.found === true,
      JSON.stringify(folderDrop)
    )
    const webUtilsAvailable = (await js(`typeof window.api.getPathForFile === 'function'`)) as boolean
    check('webUtils.getPathForFile exposed', webUtilsAvailable === true)
    // Close the dropped folder again to keep later assertions clean.
    await js(`(async () => {
      const roots = document.querySelectorAll('.folder-root')
      if (roots.length >= 2) roots[1].querySelector('.icon-btn').click()
      return true
    })()`)
    await sleep(300)

    // 15. Open Files list: loose file, dirty close → Save / Discard / Cancel.
    await fs.writeFile(join(TEST_DIR, 'loose.md'), '# Loose File\n\nsome content\n')
    win.webContents.send(IPC.openPath, join(TEST_DIR, 'loose.md'))
    await sleep(1000)
    const looseListed = (await js(`(async () => {
      const rows = Array.from(document.querySelectorAll('.loose-row'))
      return { n: rows.length, names: rows.map(r => (r.textContent || '').trim()) }
    })()`)) as { n?: number; names?: string[] }
    check(
      'loose file listed in Open Files',
      (looseListed?.n ?? 0) >= 1 && (looseListed?.names ?? []).some((n) => n.includes('loose.md')),
      JSON.stringify(looseListed)
    )

    const insertHr = `(async () => {
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 }))
      await new Promise(r => setTimeout(r, 300))
      const hrBtn = Array.from(document.querySelectorAll('.ctx-item')).find(b => (b.textContent || '').includes('分割线'))
      hrBtn?.click()
      await new Promise(r => setTimeout(r, 400))
      return document.querySelector('.statusbar-left .dirty-indicator')?.textContent?.trim()
    })()`
    const dirtyDot = (await js(insertHr)) as string | undefined
    check('loose file made dirty (hr insert)', dirtyDot === '●', String(dirtyDot))

    const originalShowMessageBox = dialog.showMessageBox.bind(dialog)
    // Cancel keeps the file open.
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    const closeCancel = (await js(`(async () => {
      const row = Array.from(document.querySelectorAll('.loose-row')).find(r => (r.textContent || '').includes('loose.md'))
      const btn = row?.querySelector('.icon-btn')
      if (!btn) return { ok: false }
      btn.click()
      await new Promise(r => setTimeout(r, 700))
      return {
        ok: true,
        listed: Array.from(document.querySelectorAll('.loose-row')).some(r => (r.textContent || '').includes('loose.md')),
        h1: document.querySelector('.ProseMirror h1')?.textContent
      }
    })()`)) as { ok?: boolean; listed?: boolean; h1?: string | null }
    check(
      'close file → cancel keeps it open',
      closeCancel?.ok === true && closeCancel?.listed === true && closeCancel?.h1 === 'Loose File',
      JSON.stringify(closeCancel)
    )
    // Discard closes and resets the editor.
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    const closeDiscard = (await js(`(async () => {
      const row = Array.from(document.querySelectorAll('.loose-row')).find(r => (r.textContent || '').includes('loose.md'))
      row?.querySelector('.icon-btn').click()
      await new Promise(r => setTimeout(r, 700))
      return {
        listed: Array.from(document.querySelectorAll('.loose-row')).some(r => (r.textContent || '').includes('loose.md')),
        h1: document.querySelector('.ProseMirror h1')?.textContent
      }
    })()`)) as { listed?: boolean; h1?: string | null }
    check(
      'close file → discard resets editor',
      closeDiscard?.listed === false && closeDiscard?.h1 == null,
      JSON.stringify(closeDiscard)
    )
    // Save writes changes then closes.
    win.webContents.send(IPC.openPath, join(TEST_DIR, 'loose.md'))
    await sleep(800)
    await js(insertHr)
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    const closeSave = (await js(`(async () => {
      const row = Array.from(document.querySelectorAll('.loose-row')).find(r => (r.textContent || '').includes('loose.md'))
      row?.querySelector('.icon-btn').click()
      await new Promise(r => setTimeout(r, 800))
      return {
        listed: Array.from(document.querySelectorAll('.loose-row')).some(r => (r.textContent || '').includes('loose.md')),
        h1: document.querySelector('.ProseMirror h1')?.textContent
      }
    })()`)) as { listed?: boolean; h1?: string | null }
    const savedContent = await fs.readFile(join(TEST_DIR, 'loose.md'), 'utf8').catch(() => '')
    check(
      'close file → save writes changes',
      closeSave?.listed === false && savedContent.includes('***'),
      JSON.stringify({ listed: closeSave?.listed, saved: savedContent.slice(0, 80) })
    )
    check(
      'close file → save resets editor',
      closeSave?.h1 == null,
      String(closeSave?.h1)
    )
    dialog.showMessageBox = originalShowMessageBox

    // 16. Hyperlinks: web link → external browser; local link → open in app;
    // ctrl+click also navigates.
    await fs.writeFile(join(TEST_DIR, 'docs', 'link-target.md'), '# Target File\n\nYou reached the target.\n')
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'link-test.md'),
      '# Link Test\n\n[local](link-target.md)\n\n[web](https://example.com/inkmark-test)\n'
    )
    win.webContents.send(IPC.openPath, join(TEST_DIR, 'docs', 'link-test.md'))
    await sleep(1000)

    let openedUrl: string | null = null
    const originalOpenExternal = shell.openExternal.bind(shell)
    shell.openExternal = (async (url: string) => {
      openedUrl = url
    }) as typeof shell.openExternal
    const webClick = (await js(`(async () => {
      const a = Array.from(document.querySelectorAll('.ProseMirror a')).find(a => (a.getAttribute('href') || '').startsWith('https://'))
      if (!a) return { ok: false }
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 500))
      return { ok: true }
    })()`)) as { ok?: boolean }
    check(
      'click http link opens external browser',
      webClick?.ok === true && openedUrl === 'https://example.com/inkmark-test',
      String(openedUrl)
    )
    const localClick = (await js(`(async () => {
      const a = Array.from(document.querySelectorAll('.ProseMirror a')).find(a => (a.getAttribute('href') || '').includes('link-target'))
      if (!a) return { ok: false, h1: document.querySelector('.ProseMirror h1')?.textContent }
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await new Promise(r => setTimeout(r, 900))
      return { ok: true, h1: document.querySelector('.ProseMirror h1')?.textContent }
    })()`)) as { ok?: boolean; h1?: string | null }
    check(
      'click local link opens its content',
      localClick?.ok === true && localClick?.h1 === 'Target File',
      String(localClick?.h1)
    )
    win.webContents.send(IPC.openPath, join(TEST_DIR, 'docs', 'link-test.md'))
    await sleep(800)
    const ctrlClick = (await js(`(async () => {
      const a = Array.from(document.querySelectorAll('.ProseMirror a')).find(a => (a.getAttribute('href') || '').includes('link-target'))
      if (!a) return { ok: false }
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
      await new Promise(r => setTimeout(r, 900))
      return { ok: true, h1: document.querySelector('.ProseMirror h1')?.textContent }
    })()`)) as { ok?: boolean; h1?: string | null }
    check(
      'ctrl+click local link jumps',
      ctrlClick?.ok === true && ctrlClick?.h1 === 'Target File',
      String(ctrlClick?.h1)
    )
    shell.openExternal = originalOpenExternal

    // 17. Welcome page: first launch only, reopenable via File menu.
    await js(`localStorage.setItem('inkmark.welcomeSeen', '1'); true`)
    win.webContents.reload()
    let remounted = false
    for (let i = 0; i < 24; i++) {
      await sleep(250)
      try {
        remounted = (await js(`!!document.querySelector('.ProseMirror')`)) === true
      } catch {
        remounted = false
      }
      if (remounted) break
    }
    check('renderer remounted after reload', remounted)
    await sleep(600)
    const blankH1 = (await js(`document.querySelector('.ProseMirror h1')?.textContent ?? null`)) as string | null
    check('welcome page only on first launch', blankH1 == null, String(blankH1))
    win.webContents.send(IPC.menuAction, 'welcome')
    await sleep(900)
    const welcomeH1 = (await js(`document.querySelector('.ProseMirror h1')?.textContent ?? null`)) as string | null
    check(
      'menu item reopens welcome page',
      (welcomeH1 ?? '').includes('InkMark'),
      String(welcomeH1)
    )

    // 18. Closing the whole window with unsaved changes must prompt:
    // Cancel keeps the window open, Discard closes it.
    const dirtyBeforeClose = (await js(insertHr)) as string | undefined
    check('window close test: doc is dirty', dirtyBeforeClose === '●', String(dirtyBeforeClose))
    const originalCloseMessageBox = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (async () => ({
      response: 2,
      checkboxChecked: false
    })) as unknown as typeof dialog.showMessageBox
    win.close()
    await sleep(900)
    check('window close → cancel keeps window open', !win.isDestroyed())
    dialog.showMessageBox = (async () => ({
      response: 1,
      checkboxChecked: false
    })) as unknown as typeof dialog.showMessageBox
    // Keep the app alive after the window is gone so the results can be
    // printed; window-all-closed would otherwise quit before app.exit().
    app.removeAllListeners('window-all-closed')
    win.close()
    await sleep(900)
    check('window close → discard closes window', win.isDestroyed())
    dialog.showMessageBox = originalCloseMessageBox

  } catch (error) {
    check('selftest crashed', false, error instanceof Error ? error.message : String(error))
  } finally {
    for (const line of results) console.log('[SELFTEST]', line)
    app.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
  }
}
