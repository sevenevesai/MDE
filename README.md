# MDE

Lightweight markdown editor. Desktop app + [browser version](https://seveneves.ai/mde/app/).

## Download

Installers for Windows, macOS, and Linux: [Releases](https://github.com/sevenevesai/MDE/releases/latest)

## Features

- **Dual mode** — raw markdown with syntax highlighting, or WYSIWYG visual editing (`Ctrl+E` to toggle)
- **Tabs** — multiple documents, undo/scroll position preserved per tab
- **Minimap** — document overview sidebar
- **Formatting toolbar** — bold, italic, headings, links, lists, code blocks
- **File associations** — double-click `.md` files to open in MDE
- **Single instance** — new files open as tabs, not new windows
- **Settings** — word wrap, font size, persisted across sessions
- **Drag and drop** — drop `.md` files onto the window

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New tab |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save as |
| `Ctrl+W` | Close tab |
| `Ctrl+E` | Toggle raw/visual mode |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+K` | Insert link |
| `Ctrl+1`–`4` | Heading 1–4 |
| `Ctrl+=` / `Ctrl+-` | Font size |
| `Ctrl+Alt+W` | Toggle word wrap |

## Tech Stack

- [Tauri 2](https://tauri.app) — Rust backend, ~13 MB binary
- [React](https://react.dev) + TypeScript
- [CodeMirror 6](https://codemirror.net) — raw editor with markdown highlighting
- [Milkdown](https://milkdown.dev) (Crepe) — WYSIWYG editor
- [Tailwind CSS](https://tailwindcss.com)

## Build

```
npm install
npm run tauri build      # desktop installer
npm run build:web        # static site → dist-web/
```

Requires [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs).

## License

MIT
