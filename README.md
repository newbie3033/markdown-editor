# InkMark

A **Typora-style** WYSIWYG Markdown editor for the desktop. Write Markdown and watch
it render inline as you type — no separate preview pane, just like Typora.

Built with **Electron + React + Milkdown** (a ProseMirror-based WYSIWYG Markdown
engine), packaged for Windows, macOS, and Linux with **electron-builder**.

## Features

- **WYSIWYG editing** — Markdown syntax renders inline (`**bold**` → **bold**,
  `# Heading` → a real heading, tables, task lists, blockquotes, fenced code
  blocks with syntax highlighting).
- **Source code mode** — toggle with `Ctrl+/` to see and edit raw Markdown.
- **Images: paste & drag-drop** — paste a screenshot or drop an image file to
  copy it next to the document (`<doc dir>/assets/`) and insert a relative
  reference; without an open document the image is stored in the app data
  folder. Relative paths resolve correctly in the editor and in HTML/PDF
  exports.
- **Documents: drag to open** — drop a `.md`/`.markdown`/`.txt` file anywhere in
  the window (or into the editor) to open it.
- **Right-click context menu** — insert headings, bold/italic/strikethrough,
  inline code, links, images, quotes, code blocks, bullet/ordered/task lists,
  tables, and horizontal rules with one click.
- **Keyword search** — `Ctrl+Shift+F` searches file names and content across
  all open folders (click a result to open the file and jump to the match);
  `Ctrl+F` opens an in-document find bar with next/previous navigation. Both
  searches support three modes: **Text** (literal), **Wildcard** (`*` any
  characters, `?` one character) and **Regex** (JavaScript regular expressions,
  case-insensitive, multiline).
- **Multiple folders + Open Files** — open several folders side by side in the
  sidebar (each closeable independently); individually opened files are listed
  under *Open Files* and can be closed (removed) at any time. Closing a file
  with unsaved changes prompts **Save / Don't Save / Cancel** in a native
  dialog.
- **Smart hyperlinks** — clicking an `http(s)://` link opens it in the system
  browser; clicking a local link (relative to the document) opens the target
  file directly in InkMark (or with the system default app for other types);
  Ctrl/Cmd+click also navigates.
- **File explorer sidebar** — open a folder and browse all `.md` files
  (`Ctrl+Shift+O`).
- **Outline sidebar** — a live table of contents that scrolls to headings.
- **Open / Save / Save As / New** — standard file operations (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`, `Ctrl+N`).
- **Export** — HTML, PDF, and Print (with relative images/links rewritten to
  absolute paths).
- **中文 / English UI** — switch via *View → Language* or the status bar button;
  the choice persists and the app follows the system language on first launch.
- **Light & dark themes** — Typora/GitHub-inspired styling.
- **Status bar** — word / character / line counts, language/theme/source-mode
  toggles, and the current **zoom level** with − / ＋ controls (click the
  percentage to reset to 100%).
- **Single-instance + "open with"** — double-click a `.md` file or open from the
  terminal (`inkmark file.md`).

## Tech stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Shell      | [Electron](https://www.electronjs.org/)                       |
| UI         | [React 19](https://react.dev/) + TypeScript                   |
| Editor     | [Milkdown 7](https://milkdown.dev/) + ProseMirror             |
| Highlight  | `@milkdown/plugin-prism` (refractor)                          |
| Build      | [electron-vite](https://electron-vite.org/)                   |
| Packaging  | [electron-builder](https://www.electron.build/)               |

## Project structure

```
src/
├── main/                 # Electron main process
│   ├── index.ts          #   window, lifecycle, single-instance
│   ├── menu.ts           #   native application menu (localized)
│   ├── i18n.ts           #   main-process strings + locale persistence
│   ├── ipc.ts            #   file dialogs, read/write, images, export, PDF
│   └── selftest.ts       #   headless self-test (INKMARK_SELFTEST=1)
├── preload/              # contextBridge API (window.api)
├── shared/ipc.ts         # IPC contract shared by all three processes
└── renderer/             # React UI
    └── src/
        ├── App.tsx       #   state + layout coordinator
        ├── components/   #   MarkdownEditor, FilePanel, OutlinePanel,
        │                 #   EditorContextMenu, StatusBar
        ├── lib/          #   i18n, commands, markdown stats, HTML export
        └── styles/       #   Typora-like light/dark theme
```

## Development

Requirements: Node.js 20+ and npm.

## Self-contained build environment

Building never installs anything on the host machine. All downloads (Electron
runtime archives, electron-builder toolchains, npm cache) live inside the
project and are git-ignored:

| What                          | Where (project-local)              |
| ----------------------------- | ---------------------------------- |
| Electron runtime archives     | `.cache/electron` (via `electronDownload.cache`) |
| electron-builder toolchains   | `ELECTRON_BUILDER_CACHE="$PWD/.cache/electron-builder"` |
| npm cache                     | `npm_config_cache="$PWD/.npm-cache"` |

The only prerequisites are Node.js 20+ and npm already present on the machine.
On a fresh clone, run the build with the `ELECTRON_BUILDER_CACHE` /
`npm_config_cache` env vars above (or any writable dir); everything else is
downloaded into the project automatically. The Windows build needs **no Wine**,
no NSIS installation, and no system packages.

```bash
npm install

# run in dev mode (hot reload)
npm run dev

# typecheck main/preload and renderer
npm run typecheck

# production build (outputs to out/)
npm run build

# headless self-test (image paste/drop, md drop, context menu, i18n, …)
INKMARK_SELFTEST=1 npx electron . --no-sandbox --user-data-dir=./.tmp-selftest
```

> If the Electron binary download hangs behind a proxy, set
> `ELECTRON_GET_USE_PROXY=true` plus `HTTPS_PROXY` / `HTTP_PROXY` before
> installing.

## Packaging

```bash
# Linux: AppImage + .deb
npm run build:linux

# Windows: portable single-exe (no installer)
npm run build:win

# macOS: .dmg
npm run build:mac

# Unpacked directory (fast local check, no installer)
npm run build:unpack
```

Artifacts are written to `dist/`. The app icon lives at `build/icon.png`.

| Platform | Artifacts |
| -------- | --------- |
| Linux    | `InkMark-1.0.0-x86_64.AppImage`, `InkMark-1.0.0-amd64.deb` |
| Windows  | `InkMark-1.0.0-portable-x64.exe` — portable single-exe, no install |
| macOS    | `InkMark-1.0.0-<arch>.dmg` |

### Portable behavior (Windows)

The portable exe writes **nothing to the host**: it self-extracts to a temp
folder (removed on exit) and keeps all app data (settings, images) in an
`InkMarkData/` folder next to the exe — `PORTABLE_EXECUTABLE_DIR` is respected
by the main process. Put the exe on a USB stick and settings travel with it.

### Platform notes

- **Windows from Linux/macOS — no Wine, no NSIS setup.** Only the portable
  target is built, which uses electron-builder's built-in portable template and
  never needs Wine. Code signing is not configured; the exe is unsigned.
- **Linux (AppImage sandbox):** some distributions (notably Ubuntu 24.04 with
  `kernel.apparmor_restrict_unprivileged_userns=1`) block the Chromium sandbox.
  If the app fails to start from an AppImage, run it with `--no-sandbox`, or
  install the `.deb` (which configures the setuid `chrome-sandbox` helper).
- **macOS:** `build:mac` must be run on macOS (dmg creation is macOS-only).

## Keyboard shortcuts

| Action                  | Shortcut              |
| ----------------------- | --------------------- |
| New / Open / Save       | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` |
| Save As                 | `Ctrl+Shift+S`        |
| Open Folder             | `Ctrl+Shift+O`        |
| Find in document        | `Ctrl+F`              |
| Search in folder        | `Ctrl+Shift+F`        |
| Source code mode        | `Ctrl+/`              |
| Toggle file sidebar     | `Ctrl+Shift+1`        |
| Toggle outline          | `Ctrl+Shift+2`        |
| Bold / Italic           | `Ctrl+B` / `Ctrl+I`   |
| Zoom in / out / reset   | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Undo / Redo             | `Ctrl+Z` / `Ctrl+Shift+Z` |

## License

MIT
