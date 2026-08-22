# notesmith — Technical Architecture

A local-first code editor and Markdown notepad that runs entirely in the browser — no
account, no server, no backend. Two independent storage models coexist in one app:

- **Files** — a real folder on disk, opened and edited via the File System Access API
  (Chrome/Edge only).
- **Notes** — quick Markdown notes kept in IndexedDB (via Dexie), autosaved, full-text
  searchable, available in every browser.

Everything else — syntax highlighting for 144 languages, real client-side linting,
Prettier formatting, fuzzy file search — runs against whichever of the two is open in
the active tab. There is no server component at all; the only network call the app ever
makes is the optional Settings → Contact form, which posts cross-origin to a sibling
project's API.

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              User Browser                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  notesmith (React 19 SPA, single page, no routing)                │   │
│  │                                                                    │   │
│  │  ┌────────────┐  ┌───────────────────────────────────────────┐  │   │
│  │  │  Sidebar    │  │  Tabs → active Tab → Editor / Preview     │  │   │
│  │  │  ├ Files    │  │  ┌─────────────┐  ┌─────────────────┐    │  │   │
│  │  │  │ (tree)   │  │  │ CodeMirror 6│  │ Markdown preview │    │  │   │
│  │  │  └ Notes    │  │  │  + lint gut.│  │ (lazy, GFM)      │    │  │   │
│  │  │    (list)   │  │  └─────────────┘  └─────────────────┘    │  │   │
│  │  └────────────┘  └───────────────────────────────────────────┘  │   │
│  │        │                        │                                 │   │
│  │        ▼                        ▼                                 │   │
│  │  File System Access API   IndexedDB (Dexie, db "notesmith")       │   │
│  │  (real folder on disk)    ├─ notes      {id,title,body,...}       │   │
│  │                           └─ settings   workspaceDirHandle,       │   │
│  │                                         appSettings, session      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                        │                                  │
│                                        │ fetch() — only on explicit       │
│                                        │ "Send" in the Contact form       │
└────────────────────────────────────────┼──────────────────────────────────┘
                                          ▼
                          POST https://gogenops.com/api/contact
                          (cross-origin, shared backend — see
                          "Contact Form" below)
```

There is no `/api` directory, no server code, and (see [Deployment](#deployment)) no
`vercel.json` in this repo at all — it is a static Vite build served as-is.

## Storage Model 1: Files (File System Access API)

`src/files.ts` wraps the browser's File System Access API. This is the only storage
path that touches real files on disk, and it only works in Chromium browsers —
`fsSupported` gates the whole feature:

```typescript
export const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
```

Firefox and Safari never see the "Open folder…" button; `App.tsx` shows *"Opening
folders needs Chrome or Edge"* instead. `src/fs.d.ts` hand-declares the handle/
permission types (`FileSystemHandle.queryPermission`/`requestPermission`,
`window.showDirectoryPicker`) since TypeScript's own lib.dom.d.ts doesn't ship them yet.

### Permission model and the reconnect flow

The browser will not silently let a page keep write access to a folder across reloads —
every session has to re-establish permission. `App.tsx` handles the three possible
states as a `WorkspaceState`:

```typescript
type WorkspaceState = 'none' | 'open' | 'needs-permission';
```

1. **First open** — `pickWorkspace()` calls `showDirectoryPicker({ mode: 'readwrite' })`,
   confirms `requestPermission` was granted, then stores the `FileSystemDirectoryHandle`
   itself in IndexedDB (`db.settings.put({ key: 'workspaceDirHandle', value: handle })`
   — Chrome's IndexedDB implementation can structured-clone a directory handle, which is
   what makes any of this possible without re-picking every reload).
2. **Reload** — on boot, `restoreWorkspace()` reads that stored handle and calls
   `queryPermission({ mode: 'readwrite' })` **without** prompting (`hasWritePermission(handle, false)`).
   - Granted → tree loads silently, `workspace = 'open'`.
   - Not granted (the common case — Chrome revokes the grant on every fresh page load)
     → `workspace = 'needs-permission'`, and the sidebar shows a **"Reconnect folder"**
     button instead of the tree.
3. **Reconnect** — clicking that button calls `reconnectWorkspace()`, which retries
   `queryPermission` and then, if still not granted, calls `requestPermission` (which
   *can* prompt, because it's inside a user gesture — silent `queryPermission` calls
   outside a gesture never trigger the browser's permission UI). One click re-grants
   and reloads the tree.
4. **Close folder** — `closeWorkspace()` just deletes the `workspaceDirHandle` row;
   it does not touch anything on disk.

### Tree walking

`readTree()` recursively walks a `FileSystemDirectoryHandle` into a sorted `TreeNode[]`
(directories first, then alphabetical), with two hard caps to protect against pathological
folders (e.g. accidentally opening `~` or a repo with `node_modules` still present):

```typescript
const MAX_DEPTH = 6;
const MAX_ENTRIES = 4000;
```

It also skips dotfiles-as-directories and a fixed `SKIP_DIRS` set (`node_modules`, `.git`,
`dist`, `build`, `.next`, `.cache`, `.vercel`, `coverage`, `__pycache__`, `.venv`, `venv`,
`target`, `vendor`) — individual dotfiles like `.env` or `.gitignore` are still shown,
only dot-*directories* are hidden.

### Move/rename: copy-then-delete

The File System Access API has **no native move or rename**. `moveFile`/`moveFolder`
(used for rename, drag-and-drop, and the tree's rename actions) implement it as
copy-then-delete:

```typescript
export async function moveFile(src, destParent, destName) {
  if (await fileExists(destParent, destName)) {
    throw new Error(`"${destName}" already exists`);
  }
  await copyFile(src, destParent, destName);
  await deleteEntry(src);
}
```

The collision check exists because `getFileHandle(name, { create: true })` — the
primitive `copyFile` uses to create the destination — **silently reuses an existing file
of that name** rather than throwing. Without the `fileExists` guard up front, renaming
`b.txt` to an existing `a.txt` would quietly clobber `a.txt`'s contents. Folder move is
the same pattern recursively (`copyDir` walks and copies every child, then
`deleteEntryRecursive` removes the original tree). `deleteEntry`/`deleteEntryRecursive`
both depend on `FileSystemHandle.remove()`, which is why `App.tsx` shows *"Delete not
supported in this browser"* rather than failing silently on browsers that implement File
System Access but not the newer removal method.

### Binary files

`isBinary()` matches a fixed extension list (images, archives, audio/video, fonts,
compiled binaries, sqlite) and `openFile()` refuses to open a match, flashing
*"`<name>` is a binary file"* instead of trying to render binary bytes as text.

## Storage Model 2: Notes (Dexie / IndexedDB)

`src/db.ts` defines a Dexie database named `"notesmith"` with two tables:

```typescript
db.version(1).stores({
  notes: 'id, title, updatedAt',
  settings: 'key',
});

interface Note {
  id: string;        // crypto.randomUUID()
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}
```

`settings` is a generic key/value table reused for three unrelated things, keyed by
string:

| Key | Value | Written by |
| --- | --- | --- |
| `workspaceDirHandle` | `FileSystemDirectoryHandle` | `files.ts` (see above) |
| `appSettings` | `{ fontSize, tabWidth, theme }` | `settings.ts` |
| `session` | `{ tabs: SessionTab[], activeKey }` | `session.ts` |

There is no separate object store per concept — one `settings` table with a
discriminating key does the job, which keeps the schema at version 1 with no migrations
so far.

### Autosave (notes) vs. explicit save (files)

This is the sharpest asymmetry in the app and it's intentional, not an oversight:

- **Notes autosave** — every keystroke debounces a 500ms timer
  (`NOTE_AUTOSAVE_MS`) that writes `{ body, updatedAt }` to Dexie. There is no dirty
  flag, no save button, and no way to lose a note's content short of closing the tab
  inside that 500ms window.
- **Files require ⌘S** — editing a file tab only mutates in-memory `Tab.body` and sets
  `dirty: true`. Nothing touches disk until `saveActive()` runs (`⌘S` or the toolbar
  Save button), which calls `writeFile()` → `handle.createWritable()` → `write()` →
  `close()`.

A `beforeunload` handler only arms when at least one **file** tab is dirty:

```typescript
useEffect(() => {
  const hasDirtyFile = tabs.some((t) => t.dirty);
  if (!hasDirtyFile) return;
  const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}, [tabs]);
```

Notes never trigger this warning because they're never more than 500ms from being
persisted.

### Session restore

`session.ts` persists open tabs (400ms debounced, same `db.settings` table) as a list of
`SessionTab` — either `{ kind: 'note', noteId }` or `{ kind: 'file', path, handle }`. On
boot, `App.tsx` restores notes unconditionally (they're always readable) but for file
tabs it checks `handle.queryPermission({ mode: 'readwrite' }) === 'granted'` first and
silently drops any tab that fails — a stale or permission-revoked handle just doesn't
reappear rather than throwing. The previously-active tab is re-selected by matching
`activeKey` (note id, or file path) against the restored tab list.

### Export / import

`exportNotes()` dumps the entire `notes` table to a downloaded
`notesmith-backup-YYYY-MM-DD.json`. `importNotes()` parses that JSON, validates each
entry has string `id`/`title`/`body`, and `db.notes.put()`s it — `put` (not `add`) means
importing the same backup twice is idempotent, and importing a newer export of a note
that still exists locally overwrites it by id.

## Editor & Language Support

`src/Editor.tsx` wraps `@uiw/react-codemirror` (CodeMirror 6). Two things load
per-file, asynchronously, independent of each other:

1. **Syntax highlighting grammar** — `describeLanguage(filename)` in `src/lang.ts` calls
   `LanguageDescription.matchFilename()` against `@codemirror/language-data`'s catalog
   (144 languages) plus one hand-added entry:
   ```typescript
   const EXTRA = [
     LanguageDescription.of({
       name: 'Terraform',
       extensions: ['tf', 'tfvars', 'hcl', 'nomad'],
       load: () => import('codemirror-lang-hcl').then((m) => m.hcl()),
     }),
   ];
   ```
   `@codemirror/language-data` has no Terraform/HCL grammar, hence the extra entry —
   it's the one language CodeMirror's own catalog is missing that this repo cares about.
   Each grammar is itself lazy (`desc.load()` returns a promise), so switching tabs
   between a `.py` file and a `.rs` file only ever downloads the Python and Rust grammars,
   never both up front.
2. **Deep linter** (see next section) — resolved by extension via `lintKind()`.

A note titled `main.tf` is treated as a real Terraform file: `App.tsx` computes
`activeFilename` by appending `.md` only when the note's title has no dot at all, so
`main.tf` keeps its extension and gets the HCL grammar (but, per the linter table below,
only grammar-level syntax checking — `.tf` has no deep linter).

### Editor keymap

`src/Editor.tsx` layers a `Prec.high` keymap (`sublimeKeymap`) on top of CodeMirror's
`basicSetup`, giving Sublime/Notepad++-style bindings that aren't CodeMirror defaults:
`⌘D` select-next-occurrence, `⌘/` toggle comment, `⌘G` go to line, `⌘⇧K` delete line,
`⌥↑`/`⌥↓` move line, `⇧⌥↑`/`⇧⌥↓` duplicate line, `⌘]`/`⌘[` indent/outdent. App-level
shortcuts (`⌘S` save, `⌘P` quick-open, `⌘⇧F` find-in-files, `⌥⇧F` format) are wired in
`App.tsx`'s own `keydown` listener, not through CodeMirror.

## Linting Pipeline

`src/linters.ts` is the most substantial piece of logic in the app. Every deep linter is
**lazy-loaded and cached** via a shared `once()` helper — a memoizing wrapper so a
linter's dependency bundle is fetched at most once per session, on first use, not on
app boot:

```typescript
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}
```

`lintKind(filename)` maps an extension to one of eight buckets; everything not in the
table gets `'none'` and falls through to grammar-only checking:

| `LintKind` | Extensions | Linter | Notes |
| --- | --- | --- | --- |
| `js` | js, jsx, mjs, cjs | **ESLint** (`eslint-linter-browserify` + `@eslint/js` recommended config, `eqeqeq: 'warn'` added) | ESLint's own bundle is ~1.5MB; `loadEslint` only imports it once a JS/JSX file is actually linted |
| `ts` | ts, tsx, mts, cts | **Real TypeScript compiler** (`typescript` package, in-browser) | See below — this is a genuine single-file type-checking pass, not a grammar check |
| `json` | json, jsonc | Native `JSON.parse` | Parses V8's two error message formats (`at position N` / `at line L column C`) to place the diagnostic |
| `css` | css, scss, less | **css-tree** | Parse errors *and* per-declaration spec validation (`lexer.matchDeclaration`) — catches things like an invalid property value, not just malformed syntax |
| `html` | html, htm, vue | **HTMLHint** | `tagname-lowercase`, `tag-pair`, `id-unique`, `alt-require`, etc. — a fixed rule set |
| `yaml` | yaml, yml | **js-yaml** | `loadAll()` to also catch multi-document files; reports at the error's `mark` position |
| `markdown` | md, markdown | Hand-rolled | See below |
| `none` | everything else | — | Falls back to Lezer grammar error nodes (next section) |

Diagnostics are capped at `MAX_DIAGNOSTICS = 200` per file across every linter, so a
catastrophically broken file doesn't flood the gutter.

### TypeScript: a real single-file type-checker in the browser

This is deeper than the README lets on — it's not just syntax checking. `lintTs()`
builds an actual `ts.Program` in-memory:

- `loadTsLibs()` glob-imports every `lib.*.d.ts` shipped with the installed `typescript`
  package (`import.meta.glob('/node_modules/typescript/lib/lib.*.d.ts', { query: '?raw' })`),
  cached by filename so the full standard-library type definitions are available.
- A custom `CompilerHost` serves the edited file's text for one virtual entry path
  (`/__entry.tsx` or `/__entry.ts` depending on whether it's JSX), serves `lib.*.d.ts`
  content from the map above for anything else, and — critically —
  `resolveModuleNames: (names) => names.map(() => undefined)`, so **every `import` in the
  file resolves to nothing**. This checks the file in total isolation; it cannot see
  sibling files, `node_modules` types, or the real project's `tsconfig.json`.
- Compiler options: `target: ES2023`, `strict: true`, `jsx: ReactJSX` for `.tsx`,
  `skipLibCheck: true`.
- Because every import is unresolvable by design, a fixed `IGNORED_TS_CODES` set filters
  out the diagnostic codes that would otherwise fire on every single file with an
  import statement (module-not-found, JSX-runtime-not-found, and similar noise) —
  `{2307, 2306, 7016, 2792, 2686, 6059, 18028, 2582, 7026, 2875, 2503}`. Everything else
  (a real type error, a missing property, a wrong argument count) surfaces normally.

The upshot: opening a `.ts`/`.tsx` file in notesmith gets meaningful type errors for
self-contained code, but will not flag a genuinely broken cross-file reference or catch
what the *real* project's `tsconfig.json` would — there is no multi-file project graph.

### Markdown: hand-rolled, not a library

`lintMarkdown()` is plain string/regex logic, not a dependency — three checks, run
per-line while tracking fence state:

1. Unclosed code fence (\`\`\` or ~~~) — reported at the opening line if the file ends
   still inside one.
2. Hard tabs — flagged as a warning (Markdown indentation should be spaces).
3. A line containing `](` with no `[` anywhere on it — heuristic for a broken/truncated
   link, skipped while inside a fence so code samples containing `](` don't false-positive.

### Fallback: grammar-level syntax checking

For every extension without a deep linter (Python, Go, Rust, Shell, SQL, Dockerfile,
TOML, HCL/Terraform, …), `lintSyntax()` walks the CodeMirror/Lezer syntax tree produced
by that language's own grammar and turns every `node.type.isError` node into an "error"
diagnostic:

```typescript
tree.cursor().iterate((node) => {
  if (!node.type.isError) return;
  out.push({ ...span(view.state.doc, node.from, node.to), severity: 'error', message: 'Syntax error', source: 'syntax' });
});
```

This is real (it will catch a genuinely malformed Python file) but shallower than a real
linter — no style rules, no semantic checks, just "the parser couldn't make sense of
this". The status bar reflects which mode is active: **"Linting on"** vs. **"Syntax
check"**, driven by `hasDeepLinter(filename)`.

## Formatting

`src/formatters.ts` uses Prettier v3 standalone. `canFormat()` gates the toolbar's
Format button / `⌥⇧F` to a fixed extension list (js/jsx/ts/tsx/mjs/cjs, json/jsonc,
css/scss/less, html/htm, md/markdown, yaml/yml).

Unlike the linters, Prettier's plugins are **not** split per file type — `loadPrettier()`
`Promise.all`s every plugin (babel, estree, typescript, postcss, html, markdown, yaml)
together on first format, whichever file type triggered it. This is a real difference
from the linter architecture's per-type code-splitting described in the README, worth
knowing if bundle size on first format matters: the first `⌥⇧F` of a session, on any
supported file, pulls in the full Prettier plugin set.

`formatCode()` throws on a parse error (surfaced by `App.tsx` as "Could not format —
check for syntax errors"); on success, the tab body is replaced and marked dirty (for
file tabs) or left to the normal note-autosave path.

## `App.tsx`: known technical debt

`src/App.tsx` is a ~930-line monolith holding nearly all application state and
behavior in one component: the file tree, every tab, the active editor's wiring, quick
notes, settings, session restore, import/export, quick-open, find-in-files, and every
file-tree CRUD handler (create/delete/rename/move for files and folders). This is a
known, deliberate trade-off, not an oversight — the app grew feature-by-feature in this
file and a refactor (splitting file-tree operations, tab/session management, and
notes into their own hooks or modules) has not yet been scoped. Treat any new feature
here as adding to debt that will need paying down eventually; don't compound it by
routing unrelated concerns through unrelated state in this file if you can avoid it.

## Settings & Contact Form

`SettingsPanel.tsx` is a modal covering font size, tab width, and light/dark theme
(persisted via `settings.ts` → `db.settings` under key `appSettings`, applied by setting
`document.documentElement.dataset.theme`, which `App.css`'s `:root[data-theme=light]`
block reads). It also renders `ContactForm.tsx` — added inside this modal in the same
session that produced this document, specifically **inside Settings rather than a page
footer**, because the editor UI (sidebar + tabs + split editor/preview + status bar) is
already dense; there was no natural footer to add a form to without disrupting the
editing layout. It's collapsed by default (`expanded` state, starts `false`) so it costs
nothing visually until a visitor opens Settings and clicks "Contact me".

### Cross-origin POST, not a local API route

```typescript
const CONTACT_ENDPOINT = 'https://gogenops.com/api/contact';
```

This project has no backend of its own, so the form posts cross-origin to
`gogenops.com/api/contact` — a shared contact endpoint the maintainer already runs for
several other sites, which owns the actual mail-sending credentials. The receiving
route's origin allowlist (`gogenops` repo, `api/_lib/allowedOrigins.ts`) explicitly
authorizes both of this app's live origins:

```typescript
'https://irajeshsood.com':           'irajeshsood.com',
'https://mynotesmith.vercel.app':    'notesmith',
```

`https://irajeshsood.com` covers requests from the `irajeshsood.com/notesmith/`
deployment (the rewrite is same-origin from the browser's perspective, so `Origin:
https://irajeshsood.com` is what the gogenops endpoint sees) — the same allowlist entry
already used by `rajeshsood-portfolio`. `mynotesmith.vercel.app` is listed separately
because this repo is *also* directly live at that domain; without its own entry, a
visitor there would be rejected by the backend's origin check. A request from an
unlisted origin (e.g. `localhost` during `npm run dev`, or a Vercel preview URL) is
silently rejected by the backend — the form will show *"Could not reach the server"* or
a generic error, which is correct/expected behavior in local dev, not a bug to chase.

The form itself has a hidden honeypot field (`company`, off-screen via CSS, `tabIndex={-1}`,
never visible or reachable by keyboard) submitted alongside the real fields — a bot
filling every input will fill it, giving the backend a free signal to drop the submission
server-side. `window.gtag?.('event', 'contact_submit', ...)` fires only after a
confirmed-ok response, feeding the same GA4 property described below.

## Deployment

### Live at two origins from one build

```
mynotesmith.vercel.app          — direct Vercel deployment, this repo's own domain
irajeshsood.com/notesmith/      — proxied via a rewrite in the irajeshsood.com project
                                   (rajeshsood-portfolio), same static build
```

`vite.config.ts` sets `base: './'` — every asset reference in the built `index.html` is
relative, not root-absolute (`./assets/index-XXXX.js` rather than `/assets/index-XXXX.js`).
This is what makes the same build work whether it's served from the domain root
(`mynotesmith.vercel.app/`) or from a subpath (`irajeshsood.com/notesmith/`) — an
absolute `/assets/...` reference would 404 once the app is one path segment deep on the
second origin. The commit history confirms this was a deliberate fix (`"Use relative
asset paths so the app works from any subpath"`), not an accident of the Vite default.

The service worker (`public/sw.js`) matches by path segment, not a leading-slash prefix,
for the same reason:

```javascript
// Match by segment rather than a leading-slash prefix so this still works when the app is
// served from a subpath (e.g. irajeshsood.com/notesmith/) instead of the origin root.
if (url.pathname.includes('/assets/')) { /* cache-first */ }
```

and it's registered with a relative path too (`main.tsx`: `navigator.serviceWorker.register('./sw.js')`).

### No `vercel.json` — the only one of the maintainer's tools without one

This repo has **zero platform configuration**: no `vercel.json`, no CSP headers, no
custom redirects/rewrites, no cron config. It is deployed as a plain static Vite build
on Vercel's zero-config defaults (`npm run build` → serve `dist/`). This is notable
specifically because it's the outlier among the maintainer's other small React tools,
which typically carry at least a `vercel.json` for headers/CSP. Two concrete
consequences:

- **No CSP** means nothing in-platform restricts the Contact form's cross-origin
  `fetch()` to `gogenops.com` — it works precisely because there's no `connect-src`
  directive to permit. If a CSP is ever added here, it must explicitly allow `connect-src
  https://gogenops.com` or the form will start failing silently in browsers that enforce
  it.
- **No security headers** (`X-Frame-Options`, `X-Content-Type-Options`, etc.) are set at
  all — whatever Vercel's own defaults provide is all this app has.

### PWA

`public/manifest.webmanifest` (`display: standalone`, dark theme color `#16181d`,
192/512px icons, one marked `maskable`) plus `public/sw.js` make the app installable.
The service worker's caching strategy is intentionally asymmetric:

- **`/assets/...`** (Vite's content-hashed JS/CSS) — cache-first. Safe because a given
  hashed URL's content never changes; a rebuild produces new hashes, not new content at
  the old URL.
- **Everything else** (the app shell — `index.html`, `manifest.webmanifest`) — network-first
  with a cache fallback only on fetch failure, so a new deploy is visible on next load
  instead of being masked by a stale cached shell; offline installs still get *something*
  cached to fall back to.

### Analytics: one GA4 property, two origins, hostname-gated

`index.html` loads a single GA4 measurement ID (`G-LSL40CXDZK`, shared with
`irajeshsood.com`) but only actually configures/fires it when
`location.hostname === 'irajeshsood.com'`:

```javascript
if (location.hostname === 'irajeshsood.com') {
  gtag('config', 'G-LSL40CXDZK', {
    anonymize_ip: true,
    send_page_view: true,
    page_location: /* URL with query string stripped */,
  });
}
```

Without this gate, the *separate* `mynotesmith.vercel.app` deployment (plus every Vercel
preview build, which shares the same static HTML) would also report into
`irajeshsood.com`'s GA4 property, corrupting that site's traffic numbers with unrelated
visits. The same pattern is used elsewhere by the maintainer (gogenops.com sharing one
GA4 ID across its landing page and calculator sub-apps).

## Known Gotchas

- **File System Access API is Chrome/Edge only, with no fallback UI degradation beyond
  hiding the feature.** Firefox and Safari (including all of iOS) never see "Open
  folder…"; there is no polyfill and none is planned — those browsers get Notes only.
- **Permission is never durable across a reload** — this is a browser security property,
  not a bug in this app, but it means every fresh session that had a folder open will
  show "Reconnect folder" rather than the tree, even though the handle itself is still
  in IndexedDB. Don't "fix" this by trying to auto-request permission on boot — an
  unprompted `requestPermission()` call outside a user gesture is ignored by the browser
  anyway.
- **Rename/move is copy-then-delete, not atomic.** A crash or permission revocation
  mid-operation could theoretically leave both the copy and the original — the existing
  `fileExists`/`dirExists` collision guards prevent silent overwrite, but there's no
  rollback if the delete step itself fails after a successful copy.
- **TypeScript linting checks one file in isolation.** It has no access to the rest of
  the project, `node_modules` types, or the real `tsconfig.json` — a file that's
  perfectly valid in its real project (because of a path alias, a global type, or a
  sibling import) can show phantom-looking errors here, and conversely a file that's
  broken *only* because of a cross-file issue will look clean.
- **Prettier's plugin bundle is not code-split per file type**, unlike every linter —
  the first format of a session loads all seven plugins (babel, estree, typescript,
  postcss, html, markdown, yaml) regardless of which one file type triggered it.
- **Notes and files have asymmetric persistence guarantees.** Notes autosave every
  500ms with no dirty indicator or save button; files require explicit `⌘S` and warn on
  tab close/reload only when a *file* tab (never a note) is dirty. This is intentional
  (see [Storage Model 2](#storage-model-2-notes-dexie--indexeddb)) but worth remembering
  before "fixing" the apparent inconsistency.
- **The Contact form's cross-origin POST depends entirely on a *different* repo's origin
  allowlist.** Adding a new deployment domain for this app (a custom domain, a new
  preview alias treated as production) requires a corresponding change in
  `gogenops/api/_lib/allowedOrigins.ts`, not anything in this repo — there is nothing
  here that will surface that dependency if it's missed beyond the form failing at
  runtime.
- **No CSP anywhere in this app** — see [Deployment](#deployment). Any future
  `vercel.json` added here must explicitly allow the Contact form's cross-origin fetch.
- **`App.tsx` is a single ~930-line component holding nearly all state** — see
  [`App.tsx`: known technical debt](#apptsx-known-technical-debt) above. Not a gotcha to
  fix opportunistically; a real refactor is the right eventual answer, not yet scoped.

## Future Enhancements

- [ ] Refactor `App.tsx` into smaller pieces (file-tree operations, tab/session
      management, notes CRUD as separate hooks/modules) — the flagged technical debt above
- [ ] Code-split Prettier's plugin bundle per file type, matching the linter architecture
- [ ] Offline-first precache of the app shell (currently network-first with cache
      fallback only — a first-ever offline load with no prior cache has nothing to serve)
- [ ] Expand the deep-linter set (Python, Go, Rust currently only get Lezer grammar
      error checking, not real linting)
- [ ] A conflict/undo story for the copy-then-delete move implementation
- [ ] Some fallback story for non-Chromium browsers beyond "Files just isn't available"
      (e.g. a read-only `<input type="file" webkitdirectory>` import path)
