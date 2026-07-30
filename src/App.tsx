import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { db, newNote, type Note } from './db';
import {
  deleteNoteFromDisk,
  exportAll,
  fsSupported,
  importFolder,
  pickSyncFolder,
  reconnectSyncFolder,
  restoreSyncFolder,
  unlinkSyncFolder,
  writeNoteToDisk,
} from './fsSync';
import './App.css';

type SyncState = 'off' | 'linked' | 'needs-permission';

const AUTOSAVE_MS = 500;

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('off');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState(true);
  const saveTimer = useRef<number | null>(null);
  const booted = useRef(false);

  const refresh = useCallback(async () => {
    const all = await db.notes.orderBy('updatedAt').reverse().toArray();
    setNotes(all);
    return all;
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      let all = await refresh();
      if (all.length === 0) {
        const first = newNote('Welcome');
        first.body = WELCOME;
        await db.notes.add(first);
        all = await refresh();
      }
      setActiveId(all[0]?.id ?? null);

      if (fsSupported) {
        const restored = await restoreSyncFolder();
        if (restored) {
          setDir(restored);
          setSyncState('linked');
        } else if (await db.settings.get('syncDirHandle')) {
          setSyncState('needs-permission');
        }
      }
    })();
  }, [refresh]);

  const active = notes.find((n) => n.id === activeId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(''), 2500);
  };

  const persist = useCallback(
    async (id: string, patch: Partial<Note>) => {
      await db.notes.update(id, { ...patch, updatedAt: Date.now() });
      const all = await refresh();
      const saved = all.find((n) => n.id === id);
      if (saved && dir) await writeNoteToDisk(dir, saved).catch(() => flash('Disk write failed'));
    },
    [dir, refresh],
  );

  const onBodyChange = (value: string) => {
    if (!active) return;
    const id = active.id;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body: value } : n)));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(id, { body: value }), AUTOSAVE_MS);
  };

  const onTitleChange = (value: string) => {
    if (!active) return;
    const id = active.id;
    const oldTitle = active.title;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title: value } : n)));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (dir && oldTitle !== value) await deleteNoteFromDisk(dir, oldTitle);
      await persist(id, { title: value });
    }, AUTOSAVE_MS);
  };

  const createNote = async () => {
    const note = newNote();
    await db.notes.add(note);
    await refresh();
    setActiveId(note.id);
  };

  const deleteNote = async (note: Note) => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    await db.notes.delete(note.id);
    if (dir) await deleteNoteFromDisk(dir, note.title);
    const all = await refresh();
    if (activeId === note.id) setActiveId(all[0]?.id ?? null);
  };

  const linkFolder = async () => {
    let handle: FileSystemDirectoryHandle | null = null;
    try {
      handle = await pickSyncFolder();
    } catch {
      return flash('Folder selection cancelled');
    }
    if (!handle) return;
    setDir(handle);
    setSyncState('linked');
    const imported = await importFolder(handle);
    const exported = await exportAll(handle);
    await refresh();
    flash(`Synced — imported ${imported}, wrote ${exported}`);
  };

  const reconnect = async () => {
    const handle = await reconnectSyncFolder();
    if (!handle) return flash('Permission denied');
    setDir(handle);
    setSyncState('linked');
    await importFolder(handle);
    await refresh();
    flash('Reconnected to folder');
  };

  const unlink = async () => {
    await unlinkSyncFolder();
    setDir(null);
    setSyncState('off');
    flash('Folder unlinked — notes stay in this browser');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>notesmith</h1>
          <button className="primary" onClick={createNote} title="New note">
            +
          </button>
        </div>

        <input
          className="search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="note-list">
          {filtered.map((note) => (
            <li key={note.id}>
              <button
                className={note.id === activeId ? 'note-item active' : 'note-item'}
                onClick={() => setActiveId(note.id)}
              >
                <span className="note-title">{note.title || 'Untitled'}</span>
                <span className="note-date">{new Date(note.updatedAt).toLocaleDateString()}</span>
              </button>
              <button className="delete" onClick={() => deleteNote(note)} title="Delete">
                ×
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="empty">No matches</li>}
        </ul>

        <div className="sync">
          {!fsSupported && <p className="hint">Folder sync needs Chrome or Edge</p>}
          {fsSupported && syncState === 'off' && (
            <button onClick={linkFolder}>Link a folder</button>
          )}
          {fsSupported && syncState === 'needs-permission' && (
            <button onClick={reconnect}>Reconnect folder</button>
          )}
          {fsSupported && syncState === 'linked' && (
            <>
              <p className="hint">Syncing to {dir?.name}</p>
              <button onClick={unlink}>Unlink</button>
            </>
          )}
        </div>
      </aside>

      <main className="main">
        {active ? (
          <>
            <header className="toolbar">
              <input
                className="title-input"
                value={active.title}
                onChange={(e) => onTitleChange(e.target.value)}
              />
              <button onClick={() => setPreview((p) => !p)}>
                {preview ? 'Hide preview' : 'Show preview'}
              </button>
            </header>

            <div className={preview ? 'panes' : 'panes single'}>
              <div className="pane editor">
                <CodeMirror
                  value={active.body}
                  height="100%"
                  theme={oneDark}
                  extensions={[markdown(), EditorView.lineWrapping]}
                  onChange={onBodyChange}
                  basicSetup={{ lineNumbers: false, foldGutter: false }}
                />
              </div>
              {preview && (
                <div className="pane preview markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.body}</ReactMarkdown>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="blank">No note selected</div>
        )}
        {status && <div className="status">{status}</div>}
      </main>
    </div>
  );
}

const WELCOME = `# Welcome to notesmith

A local-first Markdown notes app. Everything lives in your browser — no account, no server.

## Try it

- Type on the left, see it rendered on the right
- **Link a folder** in the sidebar to sync notes as real \`.md\` files on disk
- Search across every note from the sidebar

## Markdown works

| Feature | Supported |
| --- | --- |
| Tables | yes |
| Task lists | yes |

- [x] Write notes
- [ ] Sync to disk

\`\`\`js
console.log('code blocks too');
\`\`\`
`;
