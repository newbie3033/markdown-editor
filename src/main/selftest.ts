// Self-test harness for headless verification.
// Only runs when INKMARK_SELFTEST=1 is set; results are logged to stderr.

import { app, BrowserWindow, clipboard, dialog, Menu, shell } from 'electron'
import { appendFileSync, existsSync, promises as fs, writeFileSync, writeSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { IPC, REPOSITORY_URL } from '../shared/ipc'
import { grantDirectoryAccess } from './ipc'

const TEST_DIR = '/tmp/inkmark-selftest'
const results: string[] = []

function check(name: string, ok: boolean, extra = ''): void {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + String(extra).slice(0, 300) : ''}`
  results.push(line)
  try {
    appendFileSync(join(TEST_DIR, 'progress.log'), `[SELFTEST] ${line}\n`, 'utf8')
  } catch {
    // The test directory is created at the beginning of the run.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runSelfTest(win: BrowserWindow): Promise<void> {
  let keepAliveWindow: BrowserWindow | null = null
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code, true)
  const realShowMessageBox = dialog.showMessageBox.bind(dialog)
  // Most feature tests intentionally move between documents. Default those
  // incidental unsaved-change prompts to "Don't Save"; dedicated tests below
  // override this stub to exercise Save / Cancel explicitly.
  dialog.showMessageBox = (async () => ({
    response: 1,
    checkboxChecked: false
  })) as unknown as typeof dialog.showMessageBox
  win.webContents.on('console-message', (details) => {
    const text = details.message
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
    grantDirectoryAccess(TEST_DIR)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    await fs.writeFile(join(TEST_DIR, 'source.png'), png)
    await fs.writeFile(join(TEST_DIR, 'source # 中文.png'), png)
    const specialDocDir = join(TEST_DIR, 'docs # 中文')
    const specialDocPath = join(specialDocDir, 'special.md')
    await fs.mkdir(join(specialDocDir, 'assets'), { recursive: true })
    await fs.writeFile(join(specialDocDir, 'assets', 'pic.png'), png)
    await fs.writeFile(specialDocPath, '# Special Path\n\n![pic](assets/pic.png)\n')
    await fs.writeFile(join(TEST_DIR, 'docs', 'drop-test.md'), '# Dropped Document\n\nHello from drop test.')
    await fs.writeFile(join(TEST_DIR, 'docs', 'conflict.md'), '# Original\n')

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
    const csp = (await js(
      `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`
    )) as string
    check(
      'remote document images blocked by CSP',
      csp.includes("img-src 'self' data: inkmark-asset:") &&
        !/img-src[^;]*(?:https?:|file:)/.test(csp),
      csp
    )

    // 0d. Menu accelerators follow the Typora layout: zoom uses the Shift
    // variants (freeing Ctrl+0/=/- for paragraph / heading level), panel keys
    // are Ctrl+Shift+1/2/3/L, Ctrl+H opens replace, and Ctrl+Shift+I is free
    // for "insert image" (DevTools moved to F12).
    const accelerators: Record<string, string> = {}
    const collect = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.accelerator) accelerators[item.accelerator] = item.label
        if (item.submenu) collect(item.submenu.items)
      }
    }
    collect(Menu.getApplicationMenu()?.items ?? [])
    check(
      'menu zoom keys shifted (Typora layout)',
      accelerators['CmdOrCtrl+Shift+0'] !== undefined &&
        accelerators['CmdOrCtrl+Shift+='] !== undefined &&
        accelerators['CmdOrCtrl+Shift+-'] !== undefined &&
        accelerators['CmdOrCtrl+0'] === undefined &&
        accelerators['CmdOrCtrl+='] === undefined,
      JSON.stringify(Object.keys(accelerators).sort())
    )
    check(
      'menu panel keys Ctrl+Shift+1/2/3/L',
      accelerators['CmdOrCtrl+Shift+1'] !== undefined &&
        accelerators['CmdOrCtrl+Shift+2'] !== undefined &&
        accelerators['CmdOrCtrl+Shift+3'] !== undefined &&
        accelerators['CmdOrCtrl+Shift+L'] !== undefined
    )
    check('menu replace Ctrl+H', accelerators['CmdOrCtrl+H'] !== undefined)
    check(
      'devtools freed Ctrl+Shift+I',
      accelerators['CmdOrCtrl+Shift+I'] === undefined && accelerators['F12'] !== undefined
    )

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
    // The checks below intentionally locate visible menu labels. Keep both the
    // renderer and main-process menus in one deterministic locale even when a
    // fresh Electron profile defaults to English.
    win.webContents.send(IPC.menuAction, 'lang-zh')
    await sleep(500)

    // 1b. Versioned writes must reject an external modification instead of
    // overwriting it, and recovery snapshots must round-trip and clear.
    const conflictPath = join(TEST_DIR, 'docs', 'conflict.md')
    const beforeExternal = (await js(
      `window.api.readFile(${JSON.stringify(conflictPath)})`
    )) as { version?: { mtimeMs: number; size: number; sha256: string } }
    await sleep(20)
    await fs.writeFile(conflictPath, '# External Change\n')
    const conflictResult = (await js(
      `window.api.writeFile(${JSON.stringify(conflictPath)}, '# InkMark Change\\n', ${JSON.stringify(beforeExternal.version)})`
    )) as { conflict?: boolean }
    const afterConflict = await fs.readFile(conflictPath, 'utf8')
    check(
      'external modification is not overwritten',
      conflictResult?.conflict === true && afterConflict === '# External Change\n',
      JSON.stringify(conflictResult)
    )

    const saveAsConflictPath = join(TEST_DIR, 'docs', 'save-as-conflict.md')
    await fs.writeFile(saveAsConflictPath, '# Save As Original\n')
    const saveAsBefore = (await js(
      `window.api.readFile(${JSON.stringify(saveAsConflictPath)})`
    )) as { version: { mtimeMs: number; size: number; sha256: string } }
    await fs.writeFile(saveAsConflictPath, '# Save As External\n')
    const originalEarlySaveDialog = dialog.showSaveDialog.bind(dialog)
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: saveAsConflictPath
    })) as typeof dialog.showSaveDialog
    let saveAsConflict: { conflict?: boolean } | null = null
    try {
      saveAsConflict = (await js(
        `window.api.saveFileDialog(${JSON.stringify(saveAsConflictPath)}, ${JSON.stringify('# Overwrite\n')}, ${JSON.stringify(saveAsBefore.version)})`
      )) as { conflict?: boolean }
    } finally {
      dialog.showSaveDialog = originalEarlySaveDialog
    }
    check(
      'save as detects external modification',
      saveAsConflict?.conflict === true &&
        (await fs.readFile(saveAsConflictPath, 'utf8')) === '# Save As External\n',
      JSON.stringify(saveAsConflict)
    )

    const deniedPath = join('/tmp', `inkmark-not-authorized-${process.pid}.md`)
    await fs.writeFile(deniedPath, '# denied\n')
    const denied = (await js(
      `window.api.readFile(${JSON.stringify(deniedPath)}).then(() => false, () => true)`
    )) as boolean
    await fs.unlink(deniedPath)
    check('filesystem capability rejects unapproved path', denied === true)

    const releasablePath = join('/tmp', `inkmark-release-${process.pid}.png`)
    await fs.writeFile(releasablePath, png)
    const released = (await js(`(async () => {
      window.api.queueSelfTestDroppedPath(${JSON.stringify(releasablePath)})
      const file = new File([], 'release.png', { type: 'image/png' })
      const granted = await window.api.authorizeDroppedFile(file)
      await window.api.releaseDocumentAccess(granted.path)
      return window.api.pathExists(granted.path)
    })()`)) as boolean
    await fs.unlink(releasablePath)
    check('closing a loose capability revokes file access', released === false)

    const unsafeRegex = (await js(
      `window.api.searchFiles(${JSON.stringify(TEST_DIR)}, '(a+)+$', { regex: true })`
    )) as unknown[]
    check('unsafe search regex rejected', Array.isArray(unsafeRegex) && unsafeRegex.length === 0)

    const catastrophicRegex = (await js(`(async () => {
      const started = Date.now()
      const rejected = await window.api.findRegexMatches(
        [{ text: 'a'.repeat(40) + '!', offset: 0 }],
        '(a|aa)+$',
        { regex: true }
      ).then(() => false, () => true)
      return { rejected, elapsed: Date.now() - started }
    })()`)) as { rejected: boolean; elapsed: number }
    check(
      'catastrophic regex is terminated off the UI thread',
      catastrophicRegex.rejected && catastrophicRegex.elapsed < 2500,
      JSON.stringify(catastrophicRegex)
    )

    const bomPath = join(TEST_DIR, 'docs', 'bom.md')
    await fs.writeFile(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# BOM\n')]))
    const bomRead = (await js(`window.api.readFile(${JSON.stringify(bomPath)})`)) as {
      content: string
      version: { utf8Bom?: boolean }
    }
    await js(
      `window.api.writeFile(${JSON.stringify(bomPath)}, '# BOM saved\\n', ${JSON.stringify(bomRead.version)})`
    )
    const bomSaved = await fs.readFile(bomPath)
    check(
      'UTF-8 BOM is preserved across save',
      bomRead.content === '# BOM\n' &&
        bomRead.version.utf8Bom === true &&
        bomSaved.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    )

    const invalidUtf8Path = join(TEST_DIR, 'docs', 'invalid-utf8.md')
    await fs.writeFile(invalidUtf8Path, Buffer.from([0x23, 0x20, 0xff, 0x0a]))
    const invalidUtf8Rejected = (await js(
      `window.api.readFile(${JSON.stringify(invalidUtf8Path)}).then(() => false, () => true)`
    )) as boolean
    check('invalid UTF-8 is rejected instead of replaced', invalidUtf8Rejected)

    const draft = {
      filePath: null,
      content: '# Recovered',
      cleanContent: '',
      fileVersion: null,
      sourceMode: true,
      updatedAt: Date.now()
    }
    await js(`window.api.saveRecoveryDraft(${JSON.stringify(draft)})`)
    const loadedDraft = (await js(`window.api.loadRecoveryDraft()`)) as typeof draft | null
    check('recovery draft round-trip', loadedDraft?.content === draft.content && loadedDraft?.sourceMode === true)
    await js(`window.api.clearRecoveryDraft()`)
    const clearedDraft = await js(`window.api.loadRecoveryDraft()`)
    check('recovery draft clears', clearedDraft === null)

    const recoveryEscalationRejected = (await js(`window.api.saveRecoveryDraft({
      filePath: ${JSON.stringify(join('/tmp', `inkmark-recovery-denied-${process.pid}.md`))},
      content: '# denied',
      cleanContent: '',
      fileVersion: null,
      sourceMode: true,
      updatedAt: Date.now()
    }).then(() => false, () => true)`)) as boolean
    check('recovery draft cannot grant an unauthorized path', recoveryEscalationRejected)

    // 2. OS-backed files yield only a capability-backed path. They are copied
    // into assets later, after a document path is available.
    const specialImagePath = join(TEST_DIR, 'source # 中文.png')
    const authorizedImage = (await js(`(async () => {
      window.api.queueSelfTestDroppedPath(${JSON.stringify(specialImagePath)})
      return window.api.authorizeDroppedFile(new File([], 'source # 中文.png', { type: 'image/png' }))
    })()`)) as { path?: string; url?: string } | null
    check(
      'local image authorization does not expose file URL',
      authorizedImage?.path === specialImagePath && authorizedImage.url === undefined,
      JSON.stringify(authorizedImage)
    )

    // 3. Clipboard/raw image data also goes beside the saved document.
    const saved2 = (await js(
      `window.api.saveImage({ data: Uint8Array.from([137,80,78,71,13,10,26,10]).buffer, name: 'p.png', docPath: '/tmp/inkmark-selftest/docs/doc.md' })`
    )) as { src: string } | null
    check('saveImage(data)', saved2?.src === 'assets/p.png', JSON.stringify(saved2))

    const oversizedImage = join(TEST_DIR, 'docs', 'too-large.png')
    await fs.writeFile(oversizedImage, Buffer.alloc(0))
    await fs.truncate(oversizedImage, 32 * 1024 * 1024 + 1)
    const oversizedRejected = (await js(
      `window.api.saveImage({ sourcePath: ${JSON.stringify(oversizedImage)}, docPath: '/tmp/inkmark-selftest/docs/doc.md' }).then(() => false, () => true)`
    )) as boolean
    check('same-directory image is validated before direct linking', oversizedRejected)

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

    // 4b. Context-menu clipboard: Copy / Cut / Paste.
    await js(`(window.__inkmarkSelectAll(), true)`)
    await sleep(300)
    const copyMenu = (await js(`(async () => {
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }))
      await new Promise(r => setTimeout(r, 400))
      const labels = Array.from(document.querySelectorAll('.ctx-menu .ctx-item .ctx-label')).map(e => e.textContent)
      const copyBtn = Array.from(document.querySelectorAll('.ctx-item')).find(b => (b.textContent || '').startsWith('复制'))
      const disabled = copyBtn?.disabled
      if (copyBtn) copyBtn.click()
      await new Promise(r => setTimeout(r, 300))
      return { labels: labels.slice(0, 3), disabled }
    })()`)) as { labels?: string[]; disabled?: boolean }
    check(
      'context menu shows clipboard items',
      JSON.stringify(copyMenu?.labels) === JSON.stringify(['复制', '剪切', '粘贴']),
      JSON.stringify(copyMenu?.labels)
    )
    check('copy enabled with selection', copyMenu?.disabled === false)
    const copiedText = clipboard.readText()
    check('context menu copy writes selection', copiedText.includes('InkMark'), JSON.stringify(copiedText))
    const cutMenu = (await js(`(async () => {
      window.__inkmarkSelectAll()
      await new Promise(r => setTimeout(r, 200))
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }))
      await new Promise(r => setTimeout(r, 400))
      const cutBtn = Array.from(document.querySelectorAll('.ctx-item')).find(b => (b.textContent || '').startsWith('剪切'))
      if (!cutBtn) return { ok: false }
      cutBtn.click()
      await new Promise(r => setTimeout(r, 400))
      return { ok: true, md: window.__inkmarkGetMarkdown() }
    })()`)) as { ok?: boolean; md?: string | null }
    check(
      'context menu cut removes selection',
      cutMenu?.ok === true && (cutMenu?.md ?? '').trim() === '',
      JSON.stringify(cutMenu?.md)
    )
    check('context menu cut copies selection', clipboard.readText().includes('InkMark'))
    const copyDisabled = (await js(`(async () => {
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }))
      await new Promise(r => setTimeout(r, 400))
      const copyBtn = Array.from(document.querySelectorAll('.ctx-item')).find(b => (b.textContent || '').startsWith('复制'))
      const disabled = copyBtn?.disabled ?? null
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      return { disabled }
    })()`)) as { disabled?: boolean | null }
    check('copy disabled without selection', copyDisabled?.disabled === true)
    clipboard.writeText('# Pasted Heading')
    const pasteMenu = (await js(`(async () => {
      const pm = document.querySelector('.ProseMirror')
      pm.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 260 }))
      await new Promise(r => setTimeout(r, 400))
      const pasteBtn = Array.from(document.querySelectorAll('.ctx-item')).find(b => (b.textContent || '').startsWith('粘贴'))
      if (!pasteBtn) return { ok: false }
      pasteBtn.click()
      await new Promise(r => setTimeout(r, 500))
      return { ok: true, md: window.__inkmarkGetMarkdown() }
    })()`)) as { ok?: boolean; md?: string | null }
    check(
      'context menu paste inserts clipboard text',
      pasteMenu?.ok === true && (pasteMenu?.md ?? '').includes('# Pasted Heading'),
      JSON.stringify(pasteMenu?.md)
    )

    // 5. Paste an image file into the editor.
    const originalPasteSaveDialog = dialog.showSaveDialog.bind(dialog)
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: join(TEST_DIR, 'docs', 'paste-doc.md')
    })) as typeof dialog.showSaveDialog
    let paste: { imgSrc?: string | null; dirty?: string | null; path?: string; rendered?: boolean } | null = null
    try {
      paste = (await js(`(async () => {
        const bytes = Uint8Array.from(${JSON.stringify(Array.from(png))})
        const file = new File([bytes], 'pasted.png', { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const pm = document.querySelector('.ProseMirror')
        pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        await new Promise(r => setTimeout(r, 1500))
        const img = document.querySelector('.ProseMirror img')
        const dirty = document.querySelector('.statusbar-left .dirty-indicator')?.textContent
        const path = document.querySelector('.status-path-btn')?.textContent || ''
        return { imgSrc: img ? img.getAttribute('src') : null, dirty, path, rendered: !!img && img.complete && img.naturalWidth > 0 }
      })()`)) as { imgSrc?: string | null; dirty?: string | null; path?: string; rendered?: boolean }
    } finally {
      dialog.showSaveDialog = originalPasteSaveDialog
    }
    check(
      'clipboard image saves document and uses relative asset',
      paste?.imgSrc === 'assets/pasted.png' &&
        paste?.path === join(TEST_DIR, 'docs', 'paste-doc.md') &&
        paste?.rendered === true,
      String(paste?.imgSrc)
    )
    check('listener fires (dirty dot)', paste?.dirty?.trim() === '●', String(paste?.dirty))

    // 6. Drop a .md document onto the editor → it opens.
    const drop = (await js(`(async () => {
      window.api.queueSelfTestDroppedPath('/tmp/inkmark-selftest/docs/drop-test.md')
      const file = new File(['# Dropped Document'], 'drop-test.md', { type: 'text/markdown' })
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

    // 7. Dropped local images are imported and Markdown stays portable.
    const dropImg = (await js(`(async () => {
      window.api.queueSelfTestDroppedPath('/tmp/inkmark-selftest/source # 中文.png')
      const file = new File([], 'source # 中文.png', { type: 'image/png' })
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
      return { srcs, markdown: window.__inkmarkGetMarkdown() }
    })()`)) as { srcs?: Array<string | null>; markdown?: string }
    check(
      'drop image imported with relative asset path',
      Array.isArray(dropImg?.srcs) &&
        dropImg.srcs.some((s) => s === 'assets/source %23 中文.png') &&
        dropImg.markdown?.includes('assets/source # 中文.png') === true &&
        existsSync(join(TEST_DIR, 'docs', 'assets', 'source # 中文.png')),
      JSON.stringify(dropImg)
    )

    // 8. The imported relative URL actually renders through the custom protocol.
    const rendered = (await js(`(async () => {
      const img = Array.from(document.querySelectorAll('.ProseMirror img:not(.ProseMirror-separator)'))
        .find(i => (i.getAttribute('src') || '').includes('source'))
      if (!img) return false
      await new Promise(r => setTimeout(r, 1000))
      return img.complete && img.naturalWidth > 0
    })()`)) as boolean
    check('custom-protocol image renders', rendered === true)

    win.webContents.send(IPC.openPath, specialDocPath)
    await sleep(1400)
    const specialPathRender = (await js(`(async () => {
      const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)')
      await new Promise(r => setTimeout(r, 700))
      return {
        base: document.querySelector('base')?.href || '',
        rendered: !!img && img.complete && img.naturalWidth > 0
      }
    })()`)) as { base?: string; rendered?: boolean }
    check(
      'relative image renders from special-character document path',
      specialPathRender?.base ===
        pathToFileURL(specialDocDir + '/').href.replace(/^file:\/\//, 'inkmark-asset://local') &&
        specialPathRender?.rendered === true,
      JSON.stringify(specialPathRender)
    )

    // Legacy file:// references render through the node view, but serialize
    // back to their original Markdown instead of leaking the custom scheme.
    const legacyUrl = pathToFileURL(specialImagePath).href
    const legacyDocPath = join(TEST_DIR, 'docs', 'legacy-image.md')
    await fs.writeFile(legacyDocPath, `# Legacy\n\n![legacy](${legacyUrl})\n`)
    win.webContents.send(IPC.openPath, legacyDocPath)
    await sleep(1200)
    const legacyRender = (await js(`(async () => {
      const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)')
      await new Promise(r => setTimeout(r, 500))
      return {
        src: img?.getAttribute('src') || '',
        rendered: !!img && img.complete && img.naturalWidth > 0,
        markdown: window.__inkmarkGetMarkdown()
      }
    })()`)) as { src?: string; rendered?: boolean; markdown?: string }
    check(
      'legacy file URL renders without changing Markdown',
      legacyRender?.src?.startsWith('inkmark-asset://local/') === true &&
        legacyRender.rendered === true &&
        legacyRender.markdown?.includes(legacyUrl) === true,
      JSON.stringify(legacyRender)
    )

    // 9. Window-level drop of a .md file outside the editor.
    const dropWindow = (await js(`(async () => {
      window.api.queueSelfTestDroppedPath('/tmp/inkmark-selftest/docs/drop-test.md')
      const file = new File(['# Window Drop'], 'win-drop.md', { type: 'text/markdown' })
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

    // 9c. Math and Mermaid previews keep their Markdown representation while
    // rendering inline in the WYSIWYG editor.
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'diagram-test.md'),
      [
        '# Diagram Test',
        '',
        'Inline math: $E = mc^2$.',
        '',
        '$$\\begin{bmatrix} X \\\\ Y \\\\ Z \\end{bmatrix}$$',
        '',
        '$$p_i = \\begin{cases}',
        '1, & r_i \\le c \\\\',
        '0, & r_i > c',
        '\\end{cases}$$',
        '',
        '## Formula Tail',
        '',
        '```mermaid',
        'flowchart LR',
        '  A[Start] --> B["Done\\nNext line"]',
        '```',
        ''
      ].join('\n')
    )
    win.webContents.send(IPC.openPath, `${TEST_DIR}/docs/diagram-test.md`)
    const diagrams = (await js(`(async () => {
      for (let i = 0; i < 40; i += 1) {
        const rendered = document.querySelector('.inkmark-math-inline .katex') &&
          document.querySelector('.formula-preview .katex') &&
          document.querySelector('.mermaid-preview svg')
        if (rendered) break
        await new Promise(r => setTimeout(r, 250))
      }
      return {
        inline: !!document.querySelector('.inkmark-math-inline .katex'),
        block: !!document.querySelector('.formula-preview .katex'),
        blockCount: document.querySelectorAll('.formula-preview .katex').length,
        mermaid: !!document.querySelector('.mermaid-preview svg'),
        mermaidNewline: !!document.querySelector('.mermaid-preview svg br') &&
          !document.querySelector('.mermaid-preview svg')?.textContent?.includes('\\n'),
        formulaTail: Array.from(document.querySelectorAll('.ProseMirror h2'))
          .some(heading => heading.textContent === 'Formula Tail'),
        sourcesHidden: Array.from(document.querySelectorAll('.code-block-wrap[data-preview-kind]'))
          .every(wrap => getComputedStyle(wrap.querySelector('pre')).display === 'none'),
        markdown: window.__inkmarkGetMarkdown()
      }
    })()`)) as {
      inline?: boolean
      block?: boolean
      blockCount?: number
      mermaid?: boolean
      mermaidNewline?: boolean
      formulaTail?: boolean
      sourcesHidden?: boolean
      markdown?: string
    }
    check('inline math renders with KaTeX', diagrams?.inline === true, JSON.stringify(diagrams))
    check(
      'compact and multiline block math render with KaTeX',
      diagrams?.block === true && diagrams.blockCount === 2 && diagrams.formulaTail === true,
      JSON.stringify(diagrams)
    )
    check('Mermaid flowchart renders as SVG', diagrams?.mermaid === true, JSON.stringify(diagrams))
    check('Mermaid escaped newline renders as a line break', diagrams?.mermaidNewline === true)
    check('math and Mermaid editable source is hidden by default', diagrams?.sourcesHidden === true)
    check(
      'math and Mermaid Markdown round-trip',
      diagrams?.markdown?.includes('$E = mc^2$') === true &&
        diagrams.markdown.includes('$$') &&
        diagrams.markdown.includes('```mermaid') &&
        diagrams.markdown.includes('Done\\nNext line'),
      diagrams?.markdown ?? ''
    )
    const previewSourceToggle = (await js(`(async () => {
      const preview = document.querySelector('.formula-preview')
      const wrap = preview?.closest('.code-block-wrap')
      if (!preview || !wrap) return { ok: false }
      preview.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 320, clientY: 260
      }))
      await new Promise(r => setTimeout(r, 300))
      const show = Array.from(document.querySelectorAll('.ctx-item'))
        .find(item => item.textContent.includes('显示可编辑源码'))
      if (!show) return { ok: false, showFound: false }
      show.click()
      await new Promise(r => setTimeout(r, 200))
      const revealed = wrap.dataset.sourceVisible === 'true' &&
        getComputedStyle(wrap.querySelector('pre')).display !== 'none'

      preview.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 320, clientY: 260
      }))
      await new Promise(r => setTimeout(r, 300))
      const hide = Array.from(document.querySelectorAll('.ctx-item'))
        .find(item => item.textContent.includes('隐藏可编辑源码'))
      if (hide) hide.click()
      await new Promise(r => setTimeout(r, 200))
      return {
        ok: true,
        showFound: true,
        revealed,
        hideFound: !!hide,
        hiddenAgain: wrap.dataset.sourceVisible === 'false' &&
          getComputedStyle(wrap.querySelector('pre')).display === 'none'
      }
    })()`)) as {
      ok?: boolean
      showFound?: boolean
      revealed?: boolean
      hideFound?: boolean
      hiddenAgain?: boolean
    }
    check(
      'preview context menu toggles editable source',
      previewSourceToggle?.ok === true &&
        previewSourceToggle.revealed === true &&
        previewSourceToggle.hideFound === true &&
        previewSourceToggle.hiddenAgain === true,
      JSON.stringify(previewSourceToggle)
    )
    const diagramHtml = (await js(`window.__inkmarkBuildExportHtml()`)) as string
    check(
      'HTML export renders inline and block math with embedded KaTeX fonts',
      diagramHtml.includes('class="formula-export"') &&
        diagramHtml.includes('data-type="math_inline"') &&
        diagramHtml.includes('class="katex"') &&
        diagramHtml.includes('data:font/woff2;base64,') &&
        !diagramHtml.includes('url(fonts/'),
      `len=${diagramHtml.length}`
    )
    check(
      'HTML export includes rendered Mermaid SVG',
      diagramHtml.includes('class="diagram-export"') && diagramHtml.includes('<svg'),
      `len=${diagramHtml.length}`
    )

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

    const regexName = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'search-.*', { regex: true })`
    )) as Array<{ name: string; nameMatch: boolean }>
    check(
      'regex filename search',
      Array.isArray(regexName) && regexName.some((r) => r.name === 'search-test.md' && r.nameMatch),
      JSON.stringify(regexName?.map((r) => r.name))
    )
    const caseSensitive = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'hello', { caseSensitive: true })`
    )) as Array<{ name: string; matches: unknown[] }>
    check(
      'case-sensitive content search',
      Array.isArray(caseSensitive) &&
        caseSensitive.some((r) => r.name === 'search-test.md' && r.matches.length === 1),
      JSON.stringify(caseSensitive?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const wholeWord = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', 'hell', { wholeWord: true })`
    )) as Array<{ name: string; matches: unknown[] }>
    check(
      'whole-word content search',
      Array.isArray(wholeWord) && wholeWord.length === 0,
      JSON.stringify(wholeWord?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const regexContent = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', '^foo', { regex: true })`
    )) as Array<{ name: string; matches: unknown[] }>
    check(
      'regex content search (line anchor)',
      Array.isArray(regexContent) &&
        regexContent.some((r) => r.name === 'search-test.md' && r.matches.length === 1),
      JSON.stringify(regexContent?.map((r) => ({ name: r.name, matches: r.matches.length })))
    )
    const invalidRegex = (await js(
      `window.api.searchFiles('/tmp/inkmark-selftest/docs', '([unclosed', { regex: true })`
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
    // Turn the regex toggle back off for later tests.
    await js(`(Array.from(document.querySelectorAll('.search-panel .mode-btn'))[2]?.click(), true)`)

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
    // VS Code-style options: Aa (case), ab (whole word), .* (regex).
    const findCase = (await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.findbar .mode-btn'))
      buttons[0]?.click()
      await new Promise(r => setTimeout(r, 200))
      const input = document.querySelector('.findbar input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
      return { count: document.querySelector('.find-count')?.textContent?.trim() }
    })()`)) as { count?: string }
    check('find bar case-sensitive (Aa)', findCase?.count === '1/1', JSON.stringify(findCase))
    const findWholeWord = (await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.findbar .mode-btn'))
      buttons[0]?.click()
      buttons[1]?.click()
      await new Promise(r => setTimeout(r, 200))
      const input = document.querySelector('.findbar input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'hell')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
      buttons[1]?.click()
      await new Promise(r => setTimeout(r, 400))
      const without = document.querySelector('.find-count')?.textContent?.trim()
      buttons[1]?.click()
      await new Promise(r => setTimeout(r, 400))
      return {
        with: document.querySelector('.find-count')?.textContent?.trim(),
        without
      }
    })()`)) as { with?: string; without?: string }
    check(
      'find bar whole-word (ab)',
      findWholeWord?.with === '无匹配' && findWholeWord?.without === '1/2',
      JSON.stringify(findWholeWord)
    )
    const findRegex = (await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.findbar .mode-btn'))
      buttons[2]?.click()
      await new Promise(r => setTimeout(r, 200))
      const input = document.querySelector('.findbar input')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'h.llo')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
      const count = document.querySelector('.find-count')?.textContent?.trim()
      buttons[2]?.click()
      await new Promise(r => setTimeout(r, 400))
      return { count }
    })()`)) as { count?: string }
    check('find bar regex (.*)', findRegex?.count === '1/2', JSON.stringify(findRegex))
    // Leave all toggles off for the replace tests.
    await js(`(async () => {
      const buttons = Array.from(document.querySelectorAll('.findbar .mode-btn'))
      if (buttons[0]?.classList.contains('active')) buttons[0].click()
      if (buttons[1]?.classList.contains('active')) buttons[1].click()
      if (buttons[2]?.classList.contains('active')) buttons[2].click()
      return true
    })()`)

    // Close the find bar.
    await js(`(document.querySelector('.findbar .find-btn:last-child')?.click(), true)`)

    // 12b. Find & replace: the Ctrl+H menu action opens the replace row;
    // replace one occurrence, then replace all.
    win.webContents.send(IPC.menuAction, 'replace')
    await sleep(400)
    const replaceUi = (await js(`(async () => {
      const input = document.querySelector('.findbar input')
      const repInput = document.querySelector('.findbar .findbar-replace input')
      if (!input || !repInput) return { ok: false }
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, 'hello')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(repInput, 'WORLD')
      repInput.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 600))
      const count = document.querySelector('.find-count')?.textContent?.trim()
      const one = document.querySelector('.findbar-replace .replace-btn')
      if (!one) return { ok: false }
      one.click()
      await new Promise(r => setTimeout(r, 700))
      const afterOne = window.__inkmarkGetMarkdown()
      const allBtn = Array.from(document.querySelectorAll('.findbar-replace .replace-btn'))[1]
      allBtn?.click()
      await new Promise(r => setTimeout(r, 700))
      return { ok: true, count, afterOne, afterAll: window.__inkmarkGetMarkdown() }
    })()`)) as { ok?: boolean; count?: string; afterOne?: string | null; afterAll?: string | null }
    check(
      'replace row opens via Ctrl+H action',
      replaceUi?.ok === true && replaceUi?.count === '1/2',
      JSON.stringify({ ok: replaceUi?.ok, count: replaceUi?.count })
    )
    check(
      'replace one occurrence',
      (replaceUi?.afterOne ?? '').includes('WORLD world') &&
        (replaceUi?.afterOne ?? '').includes('HELLO again'),
      JSON.stringify(replaceUi?.afterOne)
    )
    check(
      'replace all occurrences',
      (replaceUi?.afterAll ?? '').includes('WORLD world') &&
        (replaceUi?.afterAll ?? '').includes('WORLD again') &&
        !(replaceUi?.afterAll ?? '').toLowerCase().includes('hello'),
      JSON.stringify(replaceUi?.afterAll)
    )

    // 12c. Typora-style editor keymaps (Ctrl+1..6 headings, Ctrl+0 paragraph,
    // Ctrl+=/- heading level, Ctrl+Shift+K code fence, Ctrl+Shift+Q quote,
    // Ctrl+Shift+[ / ] lists, Ctrl+T table). Each block-level shortcut is
    // preceded by Ctrl+0 so every command runs on a plain paragraph.
    const press = async (key: string, ctrl = true, shift = false): Promise<void> => {
      await js(`(async () => {
        const pm = document.querySelector('.ProseMirror')
        pm.focus()
        pm.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true, cancelable: true }))
        await new Promise(r => setTimeout(r, 300))
        return true
      })()`)
    }
    const h1Count = async (): Promise<number> =>
      (await js(`document.querySelectorAll('.ProseMirror h1').length`)) as number
    await press('1')
    check('Ctrl+1 heading', (await h1Count()) === 2, String(await h1Count()))
    await press('0')
    check('Ctrl+0 paragraph', (await h1Count()) === 1, String(await h1Count()))
    await press('=')
    check('Ctrl+= increase heading', (await h1Count()) === 2, String(await h1Count()))
    await press('-')
    check('Ctrl+- decrease heading', (await h1Count()) === 1, String(await h1Count()))
    await press('[', true, true)
    check(
      'Ctrl+Shift+[ ordered list',
      (await js(`!!document.querySelector('.ProseMirror ol')`)) === true
    )
    await press('0')
    await press(']', true, true)
    check(
      'Ctrl+Shift+] bullet list',
      (await js(`!!document.querySelector('.ProseMirror ul')`)) === true
    )
    await press('0')
    await press('q', true, true)
    check(
      'Ctrl+Shift+Q blockquote',
      (await js(`!!document.querySelector('.ProseMirror blockquote')`)) === true
    )
    await press('0')
    await press('k', true, true)
    check(
      'Ctrl+Shift+K code fence',
      (await js(`!!document.querySelector('.ProseMirror pre')`)) === true
    )
    await press('0')
    await press('t')
    check(
      'Ctrl+T table',
      (await js(`!!document.querySelector('.ProseMirror table')`)) === true
    )
    // Close the find bar again (it was reopened by the replace action).
    await js(`(document.querySelector('.findbar .find-btn:last-child')?.click(), true)`)
    await sleep(200)

    // 12d. New document: focus moves to the editor and the caret is shown.
    await js(`(document.querySelector('.zoom-in')?.focus(), true)`)
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(500)
    const afterNew = (await js(`(async () => {
      const pm = document.querySelector('.ProseMirror')
      return {
        isPm: document.activeElement === pm,
        h1Gone: !document.querySelector('.ProseMirror h1')
      }
    })()`)) as { isPm?: boolean; h1Gone?: boolean }
    check('new document focuses editor', afterNew?.isPm === true, JSON.stringify(afterNew))
    check('new document clears content', afterNew?.h1Gone === true)
    // Source mode variant: the textarea gets the caret instead.
    win.webContents.send(IPC.menuAction, 'toggle-source')
    await sleep(400)
    await js(`(document.querySelector('.zoom-in')?.focus(), true)`)
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(400)
    const srcFocus = (await js(
      `document.activeElement === document.querySelector('.source-editor')`
    )) as boolean
    check('new document focuses source editor', srcFocus === true)
    win.webContents.send(IPC.menuAction, 'toggle-source')
    await sleep(400)

    // 12e. Status bar zoom display.
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
    await fs.mkdir(join(TEST_DIR, 'docs', 'assets'), { recursive: true })
    await fs.writeFile(join(TEST_DIR, 'docs', 'assets', 'export.png'), png)
    await fs.writeFile(
      join(TEST_DIR, 'docs', 'export-test.md'),
      '# Export Test\n\nInline: $E = mc^2$.\n\n$$\\frac{a}{b} = \\sqrt{x}$$\n\n![img](assets/export.png)\n'
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
        'export html built with portable source before main-process embedding',
        typeof html === 'string' &&
          html.includes('class="md-body"') &&
          html.includes('src="assets/export.png"') &&
          html.includes('class="formula-export"') &&
          html.includes('data:font/woff2;base64,') &&
          !html.includes('url(fonts/') &&
          html.includes('rotate(45deg)'),
        `len=${html?.length ?? 0}`
      )
      await js(`window.api.exportHtml('test-doc', ${JSON.stringify(html)}, ${JSON.stringify(join(TEST_DIR, 'docs', 'export-test.md'))})`)
      const htmlFile = join(EXPORT_DIR, 'test-doc.html')
      const htmlContent = await fs.readFile(htmlFile, 'utf8').catch(() => '')
      check(
        'export html embeds local image',
        htmlContent.length > 0 &&
          htmlContent.includes('class="md-body"') &&
          htmlContent.includes('class="formula-export"') &&
          htmlContent.includes('data:font/woff2;base64,') &&
          htmlContent.includes('src="data:image/png;base64,'),
        `len=${htmlContent.length}`
      )
      await js(`window.api.exportPdf('test-doc', ${JSON.stringify(html)}, ${JSON.stringify(join(TEST_DIR, 'docs', 'export-test.md'))})`)
      const pdfBuf = await fs.readFile(join(EXPORT_DIR, 'test-doc.pdf')).catch(() => null)
      check(
        'export pdf file written',
        pdfBuf != null &&
          pdfBuf.length > 1000 &&
          pdfBuf.subarray(0, 4).toString() === '%PDF',
        `len=${pdfBuf?.length ?? 0} header=${pdfBuf?.subarray(0, 8).toString() ?? ''}`
      )

      // A realistic large image must not be expanded into a data: navigation
      // URL for PDF. The hidden export page loads it through inkmark-asset.
      const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><metadata>${'x'.repeat(4 * 1024 * 1024)}</metadata><rect width="120" height="80" fill="#4a90e2"/></svg>`
      await fs.writeFile(join(TEST_DIR, 'docs', 'assets', 'large.svg'), largeSvg)
      const largeHtml = html.replace('assets/export.png', 'assets/large.svg')
      await js(`window.api.exportPdf('large-image-doc', ${JSON.stringify(largeHtml)}, ${JSON.stringify(join(TEST_DIR, 'docs', 'export-test.md'))})`)
      const largePdf = await fs.readFile(join(EXPORT_DIR, 'large-image-doc.pdf')).catch(() => null)
      check(
        'export pdf handles large local image without data URL navigation',
        largePdf != null && largePdf.length > 1000 && largePdf.subarray(0, 4).toString() === '%PDF',
        `len=${largePdf?.length ?? 0}`
      )

      const missingHtml = html.replace('assets/export.png', 'assets/no-longer-exists.png')
      const previousMessageBox = dialog.showMessageBox
      let missingImageWarning = false
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args[args.length - 1] as { type?: string; detail?: string }
        if (options?.type === 'warning' && options.detail?.includes('no-longer-exists.png')) {
          missingImageWarning = true
        }
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      try {
        await js(`window.api.exportPdf('missing-image-doc', ${JSON.stringify(missingHtml)}, ${JSON.stringify(join(TEST_DIR, 'docs', 'export-test.md'))})`)
      } finally {
        dialog.showMessageBox = previousMessageBox
      }
      const missingPdf = await fs.readFile(join(EXPORT_DIR, 'missing-image-doc.pdf')).catch(() => null)
      check(
        'export pdf tolerates missing local image',
        missingPdf != null && missingPdf.length > 1000 && missingPdf.subarray(0, 4).toString() === '%PDF',
        `len=${missingPdf?.length ?? 0}`
      )
      check('export reports missing local images to the user', missingImageWarning)
    } finally {
      dialog.showSaveDialog = originalShowSave
    }

    // 13a. Remote images are opt-in in the editor, retained in HTML, and
    // fetched/embedded for PDF export.
    let remoteRequestCount = 0
    const remoteServer = createServer((_request, response) => {
      remoteRequestCount += 1
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.byteLength })
      response.end(png)
    })
    await new Promise<void>((resolve, reject) => {
      remoteServer.once('error', reject)
      remoteServer.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = remoteServer.address()
      if (!address || typeof address === 'string') throw new Error('Remote self-test server has no port')
      const remoteUrl = `http://127.0.0.1:${address.port}/remote.png`
      const remoteDocPath = join(TEST_DIR, 'docs', 'remote-test.md')
      await fs.writeFile(remoteDocPath, `# Remote Test\n\n![remote](${remoteUrl})\n`)
      win.webContents.send(IPC.openPath, remoteDocPath)
      await sleep(1000)
      const blockedRemote = (await js(`(async () => {
        const panel = document.querySelector('.inkmark-remote-image')
        const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)')
        return {
          blocked: !!panel && (img?.hidden ?? false),
          requests: ${JSON.stringify(remoteRequestCount)},
          markdown: window.__inkmarkGetMarkdown()
        }
      })()`)) as { blocked?: boolean; requests?: number; markdown?: string }
      check(
        'remote image is blocked until explicitly loaded',
        blockedRemote?.blocked === true && blockedRemote.requests === 0 && blockedRemote.markdown?.includes(remoteUrl) === true,
        JSON.stringify(blockedRemote)
      )

      const loadedRemote = (await js(`(async () => {
        document.querySelector('.inkmark-remote-image-button')?.click()
        for (let i = 0; i < 40; i += 1) {
          await new Promise(r => setTimeout(r, 100))
          const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)')
          if (img?.src.startsWith('data:image/png;base64,') && img.naturalWidth > 0) {
            return {
              loaded: true,
              src: img.src,
              panelHidden: document.querySelector('.inkmark-remote-image')?.hasAttribute('hidden') === true,
              markdown: window.__inkmarkGetMarkdown()
            }
          }
        }
        const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)')
        return {
          loaded: false,
          src: img?.src || '',
          panelHidden: document.querySelector('.inkmark-remote-image')?.hasAttribute('hidden') === true,
          markdown: window.__inkmarkGetMarkdown()
        }
      })()`)) as { loaded?: boolean; src?: string; panelHidden?: boolean; markdown?: string }
      check(
        'explicit remote image load uses a validated data URL',
        loadedRemote?.loaded === true &&
          loadedRemote.panelHidden === true &&
          loadedRemote.markdown?.includes(remoteUrl) === true &&
          remoteRequestCount === 1,
        JSON.stringify({ ...loadedRemote, requests: remoteRequestCount })
      )

      const remoteOriginalShowSave = dialog.showSaveDialog.bind(dialog)
      dialog.showSaveDialog = (async (_win, options) => ({
        canceled: false,
        filePath: join(EXPORT_DIR, basename(options?.defaultPath ?? 'document.html'))
      })) as typeof dialog.showSaveDialog
      try {
        const remoteHtml = (await js(`window.__inkmarkBuildExportHtml()`)) as string
        await js(`window.api.exportHtml('remote-test', ${JSON.stringify(remoteHtml)}, ${JSON.stringify(remoteDocPath)})`)
        const remoteHtmlContent = await fs.readFile(join(EXPORT_DIR, 'remote-test.html'), 'utf8')
        check(
          'HTML export retains remote image URL without fetching it',
          remoteHtmlContent.includes(remoteUrl) &&
            remoteHtmlContent.includes('img-src data: http: https:') &&
            remoteRequestCount === 1,
          JSON.stringify({ requests: remoteRequestCount, len: remoteHtmlContent.length })
        )

        await js(`window.api.exportPdf('remote-test', ${JSON.stringify(remoteHtml)}, ${JSON.stringify(remoteDocPath)})`)
        const remotePdf = await fs.readFile(join(EXPORT_DIR, 'remote-test.pdf')).catch(() => null)
        check(
          'PDF export fetches and embeds remote image',
          remotePdf != null && remotePdf.length > 1000 && remotePdf.subarray(0, 4).toString() === '%PDF' && remoteRequestCount === 2,
          JSON.stringify({ requests: remoteRequestCount, len: remotePdf?.length ?? 0 })
        )
      } finally {
        dialog.showSaveDialog = remoteOriginalShowSave
      }
    } finally {
      await new Promise<void>((resolve) => remoteServer.close(() => resolve()))
    }

    // Restore the export document for the following status-bar assertions.
    win.webContents.send(IPC.openPath, join(TEST_DIR, 'docs', 'export-test.md'))
    await sleep(800)

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
      window.api.queueSelfTestDroppedPath('/tmp/inkmark-selftest/docs3')
      const file = new File([], 'docs3', { type: '' })
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
    const droppedAuthorizationAvailable = (await js(
      `typeof window.api.authorizeDroppedFile === 'function'`
    )) as boolean
    check('dropped files use preload authorization', droppedAuthorizationAvailable === true)
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

    // 15b. Saving a new document lists it in the sidebar: outside any open
    // folder as a loose file, inside an open folder in its (refreshed) tree.
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(400)
    const originalShowSave3 = dialog.showSaveDialog.bind(dialog)
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: join(TEST_DIR, 'saved-new.md')
    })) as typeof dialog.showSaveDialog
    try {
      win.webContents.send(IPC.menuAction, 'save')
      await sleep(900)
    } finally {
      dialog.showSaveDialog = originalShowSave3
    }
    const savedLoose = (await js(
      `Array.from(document.querySelectorAll('.loose-row')).some(r => (r.textContent || '').includes('saved-new.md'))`
    )) as boolean
    check('saved new document listed as loose file', savedLoose === true)
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(400)
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: join(TEST_DIR, 'docs', 'saved-in-folder.md')
    })) as typeof dialog.showSaveDialog
    try {
      win.webContents.send(IPC.menuAction, 'save')
      await sleep(1200)
    } finally {
      dialog.showSaveDialog = originalShowSave3
    }
    const savedInTree = (await js(
      `Array.from(document.querySelectorAll('.tree .tree-name')).some(n => n.textContent === 'saved-in-folder.md')`
    )) as boolean
    check('saved document appears in open folder tree', savedInTree === true)

    // 15c. Source mode must save the textarea buffer itself (not the hidden
    // Milkdown document), and New must respect Cancel/Discard.
    win.webContents.send(IPC.menuAction, 'toggle-source')
    await sleep(300)
    const sourceValue = '# Source Mode Save\n\nexact textarea revision\n'
    await js(`(() => {
      const textarea = document.querySelector('.source-editor')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, ${JSON.stringify(sourceValue)})
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(650)
    win.webContents.send(IPC.menuAction, 'save')
    await sleep(900)
    const sourceSaved = await fs.readFile(join(TEST_DIR, 'docs', 'saved-in-folder.md'), 'utf8').catch(() => '')
    check('source mode saves textarea content', sourceSaved === sourceValue, JSON.stringify(sourceSaved))
    const recoveryAfterSave = await js(`window.api.loadRecoveryDraft()`)
    check('successful save clears recovery draft immediately', recoveryAfterSave === null)
    const backupName = `${createHash('sha256').update(join(TEST_DIR, 'docs', 'saved-in-folder.md')).digest('hex')}.bak`
    const backupExists = await fs
      .access(join(app.getPath('userData'), 'backups', backupName))
      .then(() => true)
      .catch(() => false)
    check('save keeps a private previous-version backup', backupExists)

    const originalExternalDialog = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (async () => ({
      response: 0,
      checkboxChecked: false
    })) as unknown as typeof dialog.showMessageBox
    await fs.writeFile(join(TEST_DIR, 'docs', 'saved-in-folder.md'), '# Reloaded External Revision\n')
    await sleep(1200)
    const reloadedExternal = (await js(
      `document.querySelector('.source-editor')?.value === '# Reloaded External Revision\\n'`
    )) as boolean
    check('external file watcher can reload changed document', reloadedExternal === true)
    dialog.showMessageBox = originalExternalDialog

    await js(`(() => {
      const textarea = document.querySelector('.source-editor')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(textarea, textarea.value + 'unsaved-after-save')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    const originalGuardDialog = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(500)
    const keptAfterCancel = (await js(
      `document.querySelector('.source-editor')?.value.endsWith('unsaved-after-save') === true`
    )) as boolean
    check('new document → cancel keeps source edits', keptAfterCancel === true)
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox
    win.webContents.send(IPC.menuAction, 'new')
    await sleep(500)
    const clearedAfterDiscard = (await js(`document.querySelector('.source-editor')?.value === ''`)) as boolean
    check('new document → discard clears source edits', clearedAfterDiscard === true)
    dialog.showMessageBox = originalGuardDialog
    win.webContents.send(IPC.menuAction, 'toggle-source')
    await sleep(300)

    // Portable relative assets require an untitled document to be saved. If
    // that Save As is cancelled, no image is inserted or copied.
    const originalImageSaveDialog = dialog.showSaveDialog.bind(dialog)
    let imageSaveDialogCalled = false
    dialog.showSaveDialog = (async () => ({
      canceled: (imageSaveDialogCalled = true),
      filePath: ''
    })) as typeof dialog.showSaveDialog
    try {
      await js(`(async () => {
        window.api.queueSelfTestDroppedPath('/tmp/inkmark-selftest/source # 中文.png')
        const file = new File([], 'source # 中文.png', { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)
        const pm = document.querySelector('.ProseMirror')
        const r = pm.getBoundingClientRect()
        const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
        Object.defineProperty(ev, 'clientX', { value: r.left + Math.min(100, r.width / 2) })
        Object.defineProperty(ev, 'clientY', { value: r.top + 10 })
        pm.dispatchEvent(ev)
        return true
      })()`)
      await sleep(1500)
    } finally {
      dialog.showSaveDialog = originalImageSaveDialog
    }
    const untitledDrop = (await js(`(() => {
      const src = Array.from(document.querySelectorAll('.ProseMirror img'))
        .map(i => i.getAttribute('src') || '')
        .find(src => src.includes('source')) || ''
      return { src, path: document.querySelector('.status-path-btn')?.textContent || '' }
    })()`)) as { src?: string; path?: string }
    check(
      'untitled local image drop stops when document save is canceled',
      untitledDrop?.src === '' &&
        untitledDrop?.path === '未命名' &&
        (imageSaveDialogCalled as boolean) === true,
      JSON.stringify(untitledDrop)
    )

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
    // 16c. Panel open/close state persists across restarts: hide both panels,
    // then verify they stay hidden after the renderer reload below.
    win.webContents.send(IPC.menuAction, 'toggle-sidebar')
    await sleep(300)
    win.webContents.send(IPC.menuAction, 'toggle-outline')
    await sleep(300)
    const panelsHidden = (await js(`(async () => ({
      sidebar: !!document.querySelector('.app > aside.sidebar:not(.outline-sidebar)'),
      outline: !!document.querySelector('.app > aside.sidebar.outline-sidebar')
    }))()`)) as { sidebar?: boolean; outline?: boolean }
    check(
      'panels hidden before reload',
      panelsHidden?.sidebar === false && panelsHidden?.outline === false,
      JSON.stringify(panelsHidden)
    )
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
    const panelsAfter = (await js(`(async () => ({
      sidebar: !!document.querySelector('.app > aside.sidebar:not(.outline-sidebar)'),
      outline: !!document.querySelector('.app > aside.sidebar.outline-sidebar')
    }))()`)) as { sidebar?: boolean; outline?: boolean }
    check(
      'panel visibility persists after reload',
      panelsAfter?.sidebar === false && panelsAfter?.outline === false,
      JSON.stringify(panelsAfter)
    )
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
    // Keep a second native window alive after the tested window is gone.
    // Otherwise Electron can terminate before the awaited close and finally
    // block run, hiding failures behind a successful process exit.
    keepAliveWindow = new BrowserWindow({ show: false })
    win.close()
    await sleep(900)
    check('window close → discard closes window', win.isDestroyed())
    dialog.showMessageBox = originalCloseMessageBox

  } catch (error) {
    check('selftest crashed', false, error instanceof Error ? error.message : String(error))
  } finally {
    dialog.showMessageBox = realShowMessageBox
    const output = results.map((line) => `[SELFTEST] ${line}`).join('\n') + '\n'
    writeFileSync(join(TEST_DIR, 'results.log'), output, 'utf8')
    writeSync(process.stderr.fd, output)
    keepAliveWindow?.hide()
    app.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)
  }
}
