# notesmith

**Live:** [notesmith-app.vercel.app](https://notesmith-app.vercel.app)

A local-first code editor and Markdown notepad that runs entirely in the browser. Open a real folder from your disk, edit files with syntax highlighting and linting, or keep quick notes in browser storage. No account, no server, no backend.

## Features

### Editor

- Split-pane Markdown editing with live GitHub-flavored preview (tables, task lists, code blocks)
- Syntax highlighting for 144 languages — Python, Go, Rust, TypeScript, Java, C/C++, Shell, SQL, Docker, YAML, TOML, **Terraform/HCL**, and more — lazily loaded per file type
- Tabs, a file tree, fuzzy "go to file", find & replace, code folding, multi-cursor, autocomplete, bracket matching
- Status bar showing language, cursor position, and lint mode

### Linting

Real linters, running client-side:

| Language | Linter |
| --- | --- |
| JavaScript / JSX | ESLint (`eslint:recommended` + `eqeqeq`) |
| JSON | Native parser with position mapping |
| CSS / SCSS / LESS | css-tree — parse errors plus spec validation of every property/value |
| HTML / Vue | HTMLHint |
| YAML | js-yaml |
| Markdown | Unclosed fences, hard tabs, malformed links |

Every other language falls back to **grammar-level syntax checking** from its Lezer parser, so a broken Python or Rust file still shows an error marker.

Linter bundles are code-split and fetched on first use, so opening a `.py` file never downloads ESLint.

### Storage

- **Files** — open a folder and edit real files on disk via the File System Access API. `⌘S` saves; tabs show a dot while unsaved.
- **Notes** — quick notes kept in IndexedDB, autosaved, full-text searchable. Name a note `main.tf` and it edits as Terraform.

## Shortcuts

| Key | Action |
| --- | --- |
| `⌘P` | Go to file |
| `⌘S` | Save file |
| `⌘F` | Find / replace |
| `⌘D` | Select next occurrence |
| `⌘/` | Toggle comment |
| `⌘G` | Go to line |
| `⌥↑` / `⌥↓` | Move line up / down |
| `⇧⌥↑` / `⇧⌥↓` | Duplicate line up / down |
| `⌘⇧K` | Delete line |
| `⌘]` / `⌘[` | Indent / outdent |

## Browser support

Opening folders uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), which currently means **Chrome or Edge**. Everything else — notes, editing, highlighting, linting — works in any modern browser.

Browsers won't silently reuse a folder across sessions, so after a reload you'll see a **Reconnect folder** button to re-grant access in one click.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
npm run preview  # serve the production build
npm run lint
```

## Stack

React 19 · TypeScript · Vite · CodeMirror 6 · Dexie (IndexedDB) · ESLint · css-tree · HTMLHint · js-yaml · react-markdown

## License

MIT
