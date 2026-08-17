# InkMark

A **Typora-style** WYSIWYG Markdown editor for the desktop. Write Markdown and watch
it render inline as you type — no separate preview pane, just like Typora.

Built with **Electron + React + Milkdown** (a ProseMirror-based WYSIWYG Markdown
engine), packaged for Windows, macOS, and Linux with **electron-builder**.

## Features

- **WYSIWYG editing** — Markdown syntax renders inline (`**bold**` → **bold**,
  `# Heading` → a real heading, tables, task lists, blockquotes, fenced code
  blocks with syntax highlighting). Code blocks show a **copy button** that
  copies the code to the clipboard.
- **Source code mode** — toggle with `Ctrl+/` to see and edit raw Markdown.
- **Images: paste & drag-drop** — paste a screenshot or drop an image file to
  insert it. Images are kept in the document's `assets/` folder and Markdown
  stores a portable relative path; files already below the document directory
  are referenced relatively without duplication. An untitled document asks to
  be saved first.
- **Documents: drag to open** — drop a `.md`/`.markdown`/`.txt` file anywhere in
  the window (or into the editor) to open it; drop a **folder** to open it in
  the sidebar. Paths are resolved via Electron's `webUtils.getPathForFile`.
- **Right-click context menu** — **Copy / Cut / Paste** (disabled when there
  is no selection), plus insert headings, bold/italic/strikethrough, inline
  code, links, images, quotes, code blocks, bullet/ordered/task lists, tables,
  and horizontal rules with one click.
- **Keyword search** — `Ctrl+Shift+F` searches file names and content across
  all open folders (click a result to open the file and jump to the match);
  `Ctrl+F` opens an in-document find bar with next/previous navigation and
  `Ctrl+H` adds **find & replace** (replace one or all, F3/Shift+F3 to jump).
  Both searches offer **VS Code-style options**: match case (**Aa**), match
  whole word (**ab**, Unicode-aware) and regular expression (**.***) toggles.
- **Multiple folders + Open Files** — open several folders side by side in the
  sidebar (each closeable independently); individually opened files are listed
  under *Open Files* and can be closed (removed) at any time. Newly saved
  documents appear in the sidebar automatically — under *Open Files*, or in
  the folder tree when saved into an open folder. Closing a file with unsaved
  changes prompts **Save / Don't Save / Cancel** in a native dialog.
- **Smart hyperlinks** — clicking an `http(s)://` link opens it in the system
  browser; clicking a local link (relative to the document) opens the target
  file directly in InkMark (or with the system default app for other types);
  Ctrl/Cmd+click also navigates.
- **File explorer sidebar** — open a folder and browse all `.md` files
  (`Ctrl+Shift+O`). The file and outline sidebars are **drag-resizable**
  (double-click the edge to reset) and can be toggled with the 📁 / ☰ icons in
  the status bar (or `Ctrl+Shift+1` / `Ctrl+Shift+2`); widths and open/closed
  state persist across sessions.
- **Outline sidebar** — a live table of contents that scrolls to headings.
- **Edit / Read-only modes** — toggle via the ✏️/🔒 status bar button or
  *View → Read-only Mode*: read-only disables editing (typing, context-menu
  inserts, image drops) while navigation/search/export keep working; the window
  title shows a “（只读）” suffix.
- **Open / Save / Save As / New** — standard file operations (`Ctrl+O`, `Ctrl+S`,
  `Ctrl+Shift+S`, `Ctrl+N`).
- **Safe saves and crash recovery** — document writes use a flushed temporary
  file plus atomic rename, saves are serialized, and changes made by another
  program are detected both before replacement and by a live file watcher.
  The previous revision is kept privately under Electron's `userData/backups`
  directory. Unsaved work is periodically stored in a private
  `recovery-draft.json`; startup verifies it against the disk file and asks
  before restoring it, while a successful save clears it immediately.
- **Bounded file access** — renderer file operations are limited to files and
  folders the user selected, opened through the OS, or dragged into the app.
  Large files/images and expensive regex shapes are rejected before they can
  exhaust the Electron main process.
- **Private-by-default documents** — remote HTTP(S) images are not loaded from
  opened or exported Markdown. This prevents a document from silently pinging
  a tracking server.
- **Predictable and safe image paths** — local images are imported to the
  adjacent `assets/` folder and rendered through a capability-checked custom
  protocol instead of direct `file://` access. Clipboard images use the same
  managed attachment flow.
- **Export** — HTML, PDF, and Print, with local images embedded so exported
  documents do not depend on paths from the source machine.
- **中文 / English UI** — switch via *View → Language* or the status bar button;
  the choice persists and the app follows the system language on first launch.
- **Light & dark themes** — Typora/GitHub-inspired styling.
- **Status bar** — word / character / line counts, language/theme/source-mode
  toggles, and the current **zoom level** with − / ＋ controls (click the
  percentage to reset to 100%). The **file path is click-to-copy** with a small
  success/failure toast. **Right-click the status bar** for a menu of checkboxes
  to show/hide each item (persisted across sessions).
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

# Windows: NSIS installer + portable single-exe
npm run build:win

# macOS: .dmg
npm run build:mac

# Unpacked directory (fast local check, no installer)
npm run build:unpack
```

Artifacts are written to `dist/`. The app icon lives at `build/icon.png`.

### GitHub Releases

Pushing a semantic-version tag such as `v1.0.2` starts `.github/workflows/release.yml`.
It builds Linux (AppImage/deb), Windows (NSIS/portable), and macOS (Intel/Apple
Silicon) packages, then attaches them to the GitHub Release for that tag. The
tag version is used as the packaged application version, so it does not need to
be edited manually in `package.json` before releasing.

```bash
git tag v1.0.2
git push origin v1.0.2
```

The Help menu links to the open-source repository
(https://github.com/newbie3033/markdown-editor), and *Help → About* shows the
version with a one-click button to open the repository.

| Platform | Artifacts |
| -------- | --------- |
| Linux    | `InkMark-1.0.0-x86_64.AppImage`, `InkMark-1.0.0-amd64.deb` |
| Windows  | `InkMark-Setup-1.0.0-x64.exe` (NSIS installer), `InkMark-1.0.0-portable-x64.exe` (portable single-exe, no install) |
| macOS    | `InkMark-1.0.0-<arch>.dmg` |

### Release artifacts & Git LFS

Release artifacts are versioned in this repository via **Git LFS** so every
tag ships with its binaries. `.gitattributes` routes the binaries
(`*.exe`, `*.AppImage`, `*.deb`, `*.dmg`, …) to LFS storage; the
repository stores small pointer files while the binaries live on the LFS
server. This keeps `git clone`/`git fetch` fast while `git lfs pull` fetches
the binaries on demand.

```bash
# one-time per machine
git lfs install

# fetch the binaries for the current checkout
git lfs pull

# show which files are stored as LFS pointers
git lfs ls-files
```

`git lfs install` installs the clean/smudge filter hooks into the repository,
so building and committing new artifacts (`dist/`) automatically stores them
through LFS. If `git-lfs` is not on your `PATH`, install it from
<https://git-lfs.com> or `apt install git-lfs` before cloning.

### Portable behavior (Windows)

The portable exe writes **nothing to the host**: it self-extracts to a temp
folder (removed on exit) and keeps all app data (settings, images) in an
`InkMarkData/` folder next to the exe — `PORTABLE_EXECUTABLE_DIR` is respected
by the main process. Put the exe on a USB stick and settings travel with it.

### Platform notes

- **Windows from Linux/macOS — no Wine, no system packages.** Both the NSIS
  installer and the portable exe cross-build natively. The project ships a
  custom NSIS script in `build/nsis/` (a copy of electron-builder's own
  template: the uninstaller is written at install time via `WriteUninstaller`
  and all template includes are absolute paths), which makes electron-builder
  skip its Wine-based uninstaller pre-extraction step. Refresh the copy from
  `node_modules/app-builder-lib/templates/nsis` when upgrading electron-builder.
  Code signing is not configured; the packages are unsigned.
- **Linux (AppImage sandbox):** some distributions (notably Ubuntu 24.04 with
  `kernel.apparmor_restrict_unprivileged_userns=1`) block the Chromium sandbox.
  If the app fails to start from an AppImage, run it with `--no-sandbox`, or
  install the `.deb` (which configures the setuid `chrome-sandbox` helper).
- **macOS:** `build:mac` must be run on macOS (dmg creation is macOS-only).

## Keyboard shortcuts

Typora-compatible shortcut layout (macOS uses Cmd/Option equivalents).

### File & view

| Action                        | Shortcut              |
| ----------------------------- | --------------------- |
| New / Open / Save             | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` |
| Save As                       | `Ctrl+Shift+S`        |
| Open Folder                   | `Ctrl+Shift+O`        |
| Find in document              | `Ctrl+F`              |
| Find & replace                | `Ctrl+H`              |
| Search in folder              | `Ctrl+Shift+F`        |
| Source code mode              | `Ctrl+/`              |
| Toggle outline                | `Ctrl+Shift+1`        |
| Articles (file list)          | `Ctrl+Shift+2`        |
| File tree                     | `Ctrl+Shift+3`        |
| Toggle sidebar                | `Ctrl+Shift+L`        |
| Zoom in / out / actual size   | `Ctrl+Shift+=` / `Ctrl+Shift+-` / `Ctrl+Shift+0` |
| Fullscreen / DevTools         | `F11` / `F12`          |

### Editing

| Action                        | Shortcut              |
| ----------------------------- | --------------------- |
| Headings 1-6                  | `Ctrl+1` … `Ctrl+6`   |
| Paragraph                     | `Ctrl+0`              |
| Increase / decrease heading   | `Ctrl+=` / `Ctrl+-`   |
| Bold / Italic                 | `Ctrl+B` / `Ctrl+I`   |
| Strikethrough / inline code   | `Alt+Shift+5` / `Ctrl+Shift+`` |
| Hyperlink / image             | `Ctrl+K` / `Ctrl+Shift+I` |
| Blockquote / code fence       | `Ctrl+Shift+Q` / `Ctrl+Shift+K` |
| Ordered / unordered list      | `Ctrl+Shift+[` / `Ctrl+Shift+]` |
| Table / clear format          | `Ctrl+T` / `Ctrl+\\`   |
| Undo / Redo                   | `Ctrl+Z` / `Ctrl+Shift+Z` |

The Milkdown defaults (e.g. `Ctrl+E` inline code, `Ctrl+Alt+1..6` headings)
remain available as alternative bindings.

## License

MIT
