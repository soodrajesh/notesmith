# notesmith

A local-first Markdown notes app. Split-pane editor with live preview, notes stored in your browser, and optional two-way sync to a real folder of `.md` files on disk. No account, no server, no backend.

## Features

- **Split-pane editing** — CodeMirror editor on the left, rendered GitHub-flavored Markdown on the right (tables, task lists, code blocks). Toggle the preview off for full-width writing.
- **Local-first storage** — notes live in IndexedDB, so the app works offline and keeps no data on any server.
- **Folder sync** — link a local folder and every note is written out as a `.md` file. Existing `.md` files in that folder are imported on link, so you can keep editing the same notes in VS Code, Obsidian, or anything else.
- **Full-text search** — filter across note titles and bodies as you type.
- **Autosave** — edits persist after a short debounce; no save button.

## Folder sync notes

Sync uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), which currently means **Chrome or Edge**. In other browsers the app still works fully — notes just stay in IndexedDB.

Browsers don't allow silently reusing a folder across sessions, so after a page reload you'll see a **Reconnect folder** button to re-grant access in one click.

Sync is write-through: saving a note writes the file, renaming a note moves it, deleting a note removes it. Files are read from disk when you link or reconnect the folder — the app doesn't watch for external edits while it's open.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build
npm run lint
```

## Stack

React 19 · TypeScript · Vite · Dexie (IndexedDB) · CodeMirror 6 · react-markdown + remark-gfm

## License

MIT
