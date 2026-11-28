const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const directoryEnv = 'INKMARK_PERFORMANCE_DIR'

function launch() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'inkmark-performance-')))
  const env = { ...process.env, [directoryEnv]: directory, INKMARK_SELFTEST: '0' }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  delete env.PORTABLE_EXECUTABLE_DIR
  try {
    const result = spawnSync(require('electron'), [__filename, '--headless', ...process.argv.slice(2)], {
      env,
      stdio: 'inherit',
      timeout: 180_000,
      windowsHide: true
    })
    if (result.error) throw result.error
    if (result.signal) throw new Error(`Electron exited with signal ${result.signal}`)
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
  }
}

const scenarios = [
  { name: 'Small Markdown', paragraphs: 100, inputLimit: 40, idleLimit: 100 },
  { name: 'Large Markdown', paragraphs: 5000, inputLimit: 45, idleLimit: 350 },
  {
    name: 'Large Markdown, preserve source spelling',
    paragraphs: 5000, preserve: true, inputLimit: 45, idleLimit: 1_600
  },
  {
    name: 'Large Markdown, HTML preview on',
    paragraphs: 5000, html: true, preview: true, inputLimit: 180, idleLimit: 350
  },
  { name: 'Large Markdown, HTML preview off', paragraphs: 5000, html: true, inputLimit: 45, idleLimit: 350 },
  { name: 'Large Markdown, source mode', paragraphs: 5000, source: true, inputLimit: 80, idleLimit: 350 }
]

// Use different candidate and committed text so the commit also edits the buffer.
const candidates = ['h', 'ha', 'han', '汗']
const cycles = 6
const marker = 'IME benchmark'

function makeFixture(scenario, directory) {
  const paragraphs = Array.from({ length: scenario.paragraphs }, (_, index) =>
    '段落 ' + index + ' The quick brown fox jumps over the lazy dog. 中文输入法性能测试。')
  const blocks = [marker]
  if (scenario.html) blocks.push('<div>HTML 预览</div>')
  blocks.push(...paragraphs)
  if (scenario.source) blocks.push('## Navigation target')
  if (scenario.preserve) blocks.push('+ _保留原有列表和强调写法_')
  const content = blocks.join('\n\n') + (scenario.preserve ? '\n\n' : '\n')
  const file = join(directory, `scenario-${scenarios.indexOf(scenario)}.md`)
  writeFileSync(file, content)
  return { file, content }
}

async function waitFor(description, check) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    if (await check()) return
    await delay(75)
  }
  throw new Error(`Timed out waiting for ${description}`)
}

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

async function measure(contents, scenario, { file, content }) {
  const js = (script) => contents.executeJavaScript(script, true)
  const selector = scenario.source ? '.source-editor' : '.ProseMirror'
  const visible = scenario.source ? 'editor.value.split("\\n", 1)[0]' : 'editor.firstElementChild.textContent'
  await js(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)})
    editor.focus()
    if (editor instanceof HTMLTextAreaElement) editor.setSelectionRange(${marker.length}, ${marker.length})
    else getSelection().collapse(editor.firstElementChild.firstChild, ${marker.length})
    const events = new AbortController()
    window.performanceInputEvents = events
    window.performanceCompositionUpdates = 0
    editor.addEventListener('compositionupdate', () => window.performanceCompositionUpdates++, { signal: events.signal })
    window.performanceLongTasks = []
    window.performanceObserver = new PerformanceObserver(list => {
      window.performanceLongTasks.push(...list.getEntries())
    })
    window.performanceObserver.observe({ entryTypes: ['longtask'] })
  })()`)
  await delay(100)

  const updates = []
  const commits = []
  const input = async (command, params, samples) => {
    const start = performance.now()
    await contents.debugger.sendCommand(command, params)
    // Wait for the renderer after its input handling and queued microtasks.
    await js('0')
    samples.push(performance.now() - start)
  }
  for (let index = 0; index < cycles; index++) {
    for (const text of candidates) {
      await input('Input.imeSetComposition', {
        text, selectionStart: text.length, selectionEnd: text.length
      }, updates)
    }
    await input('Input.insertText', { text: '汉' }, commits)
    if (index < cycles - 1) await delay(75)
  }

  const idleStart = await js('performance.now()')
  const expectedLine = marker + '汉'.repeat(cycles)
  const state = await js(`(() => {
    const editor = document.querySelector(${JSON.stringify(selector)})
    window.performanceInputEvents.abort()
    return { line: ${visible}, updates: window.performanceCompositionUpdates }
  })()`)
  if (state.line !== expectedLine || state.updates < updates.length) {
    throw new Error(`Unexpected IME result ${JSON.stringify(state)} (update P95 ${p95(updates).toFixed(1)} ms)`)
  }

  const expectedContent = expectedLine + content.slice(marker.length)
  await waitFor('the recovery draft with committed text and original formatting', async () => {
    const draft = await js('window.api.loadRecoveryDraft()')
    return draft?.filePath === file && draft.content === expectedContent &&
      draft.sourceMode === Boolean(scenario.source)
  })
  const idle = await js(`(() => {
    const observer = window.performanceObserver
    const tasks = [...window.performanceLongTasks, ...observer.takeRecords()]
    observer.disconnect()
    return Math.max(0, ...tasks.filter(task => task.startTime >= ${idleStart}).map(task => task.duration))
  })()`)
  return { update: p95(updates), commit: p95(commits), idle }
}

async function checkSourceUpdates(contents, file, content) {
  const js = (script) => contents.executeJavaScript(script, true)
  const counts = "document.querySelector('.status-counts').textContent"
  const target = "document.querySelector('.outline-item[title=\"Navigation target\"]')"
  await waitFor('the current source outline', () => js(`${target}?.disabled === false`))
  const before = await js(counts)
  await js("document.querySelector('.source-editor').setSelectionRange(0, 0)")
  await contents.debugger.sendCommand('Input.imeSetComposition', {
    text: '# pending', selectionStart: 9, selectionEnd: 9
  })
  await delay(650)
  if (!await js(`document.querySelector('.source-editor').value.startsWith('# pending') &&
    ${counts} === ${JSON.stringify(before)} && ${target}.disabled &&
    document.querySelectorAll('.outline-item').length === 1`)) {
    throw new Error('A pending composition should update only the source text')
  }

  const heading = '# 新标题\n\n'
  await contents.debugger.sendCommand('Input.insertText', { text: heading })
  contents.send('menu:action', 'save')
  const expected = heading + marker + '汉'.repeat(cycles) + content.slice(marker.length)
  await waitFor('Save to write the latest source', () => readFileSync(file, 'utf8') === expected)
  await waitFor('committed source statistics and headings', () => js(
    `${counts} !== ${JSON.stringify(before)} && document.querySelector('.outline-item[title="新标题"]') &&
      ${target}?.disabled === false`
  ))
  if (!await js(`(() => {
    ${target}.click()
    const field = document.querySelector('.source-editor')
    return field.selectionStart === field.value.lastIndexOf('## Navigation target')
  })()`)) throw new Error('Source outline navigated to a stale offset')
}

async function runSuite(app, contents, directory) {
  const js = (script) => contents.executeJavaScript(script, true)
  const send = (action) => contents.send('menu:action', action)
  await waitFor('the editor', () => js("Boolean(document.querySelector('.ProseMirror'))"))
  if (!await js("PerformanceObserver.supportedEntryTypes.includes('longtask')")) {
    throw new Error('This Electron build does not expose renderer long tasks')
  }
  contents.debugger.attach()
  const failures = []
  const rows = []
  console.log(`Electron ${process.versions.electron} on ${process.platform}/${process.arch}`)
  try {
    for (const scenario of scenarios) {
      console.log(`Measuring ${scenario.name}`)
      const fixture = makeFixture(scenario, directory)
      const { file, content } = fixture
      if (await js("Boolean(document.querySelector('.source-editor'))")) {
        send('toggle-source')
        await waitFor('visual mode', () => js("!document.querySelector('.source-editor')"))
      }
      send(scenario.preview ? 'render-html-on' : 'render-html-off')
      // Go through the desktop application's normal path authorization and open flow.
      app.emit('second-instance', null, [], directory, { openPath: file })
      await waitFor(file, () => js(`document.title.includes(${JSON.stringify(basename(file))}) &&
        document.querySelector('.ProseMirror')?.firstElementChild?.textContent === ${JSON.stringify(marker)}`))
      if (scenario.html) {
        await waitFor('the expected HTML preview state', () => js(
          `Boolean(document.querySelector('.ProseMirror .html-preview')) === ${Boolean(scenario.preview)}`
        ))
      }
      if (scenario.source) {
        send('toggle-source')
        await waitFor('source mode', () => js("Boolean(document.querySelector('.source-editor'))"))
      }

      const result = await measure(contents, scenario, fixture)
      if (scenario.source) await checkSourceUpdates(contents, file, content)
      rows.push({
        scenario: scenario.name,
        bytes: Buffer.byteLength(content),
        'IME update p95 (ms)': result.update.toFixed(1),
        'IME commit p95 (ms)': result.commit.toFixed(1),
        'idle long task max (ms)': result.idle.toFixed(1)
      })
      for (const [metric, value, limit] of [
        ['IME update p95', result.update, scenario.inputLimit],
        ['IME commit p95', result.commit, scenario.inputLimit],
        ['idle long task max', result.idle, scenario.idleLimit]
      ]) {
        if (value > limit) {
          failures.push(`${scenario.name}: ${metric} ${value.toFixed(1)} ms exceeded ${limit} ms`)
        }
      }
    }
  } finally {
    contents.debugger.detach()
  }
  console.table(rows)
  if (failures.length) throw new Error(failures.join('\n'))
}

function runElectron() {
  const directory = process.env[directoryEnv]
  if (!directory) throw new Error('Run this test through npm run test:perf')
  const { app, dialog } = require('electron')
  app.setPath('userData', directory)
  app.setPath('sessionData', directory)
  // Each generated fixture has its own draft assertions before it is discarded.
  dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  app.once('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false)
    win.webContents.once('did-finish-load', async () => {
      try {
        await runSuite(app, win.webContents, directory)
        app.exit(0)
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
  })
  require('../out/main/index.js')
}

if (process.versions.electron) runElectron()
else launch()
