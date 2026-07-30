import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from './Editor';
import FileTree from './FileTree';
import QuickOpen from './QuickOpen';
import { db, newNote, type Note } from './db';
import {
  closeWorkspace,
  createFile,
  createFolder,
  deleteEntry,
  deleteEntryRecursive,
  fsSupported,
  hasStoredWorkspace,
  isBinary,
  pickWorkspace,
  readFile,
  readTree,
  reconnectWorkspace,
  restoreWorkspace,
  writeFile,
  type TreeNode,
} from './files';
import { languageName } from './lang';
import { hasDeepLinter } from './linters';
import SettingsPanel from './SettingsPanel';
import { loadSettings, saveSettings, type Settings as SettingsType } from './settings';
import './App.css';

type WorkspaceState = 'none' | 'open' | 'needs-permission';

interface Tab {
  id: string;
  kind: 'note' | 'file';
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
  body: string;
  dirty: boolean;
}

const NOTE_AUTOSAVE_MS = 500;

function flatten(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n);
    else if (n.children) flatten(n.children, out);
  }
  return out;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [dirName, setDirName] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceState>('none');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [preview, setPreview] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [status, setStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SettingsType>({
    fontSize: 13,
    tabWidth: 2,
    theme: 'dark',
  });

  const noteTimer = useRef<number | null>(null);
  const booted = useRef(false);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const allFiles = useMemo(() => flatten(tree), [tree]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(''), 2500);
  }, []);

  const refreshNotes = useCallback(async () => {
    const all = await db.notes.orderBy('updatedAt').reverse().toArray();
    setNotes(all);
    return all;
  }, []);

  const openNote = useCallback((note: Note) => {
    const id = `note:${note.id}`;
    setTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [...prev, { id, kind: 'note', name: note.title || 'Untitled', body: note.body, dirty: false }],
    );
    setActiveId(id);
  }, []);

  const loadTree = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setDirName(handle.name);
    setTree(await readTree(handle));
    setWorkspace('open');
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const stored = await loadSettings();
      setSettings(stored);

      let all = await refreshNotes();
      if (all.length === 0) {
        const first = newNote('Welcome');
        first.body = WELCOME;
        await db.notes.add(first);
        all = await refreshNotes();
      }
      openNote(all[0]);

      if (fsSupported) {
        const restored = await restoreWorkspace();
        if (restored) await loadTree(restored);
        else if (await hasStoredWorkspace()) setWorkspace('needs-permission');
      }
    })();
  }, [refreshNotes, openNote, loadTree]);

  /* ── Files ─────────────────────────────────────────────── */

  const openFile = useCallback(
    async (node: TreeNode) => {
      const id = `file:${node.path}`;
      if (tabs.some((t) => t.id === id)) return setActiveId(id);
      if (isBinary(node.name)) return flash(`${node.name} is a binary file`);

      try {
        const handle = node.handle as FileSystemFileHandle;
        const body = await readFile(handle);
        setTabs((prev) => [
          ...prev,
          { id, kind: 'file', name: node.name, path: node.path, handle, body, dirty: false },
        ]);
        setActiveId(id);
      } catch {
        flash(`Could not open ${node.name}`);
      }
    },
    [tabs, flash],
  );

  const saveActive = useCallback(async () => {
    if (!active || active.kind !== 'file' || !active.handle) return;
    try {
      await writeFile(active.handle, active.body);
      setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, dirty: false } : t)));
      flash(`Saved ${active.name}`);
    } catch {
      flash(`Could not save ${active.name}`);
    }
  }, [active, flash]);

  const openFolder = async () => {
    let handle: FileSystemDirectoryHandle | null = null;
    try {
      handle = await pickWorkspace();
    } catch {
      return flash('Folder selection cancelled');
    }
    if (!handle) return;
    await loadTree(handle);
    flash(`Opened ${handle.name}`);
  };

  const reconnect = async () => {
    const handle = await reconnectWorkspace();
    if (!handle) return flash('Permission denied');
    await loadTree(handle);
  };

  const closeFolder = async () => {
    await closeWorkspace();
    setTree([]);
    setDirName('');
    setWorkspace('none');
    setTabs((prev) => prev.filter((t) => t.kind !== 'file'));
    setActiveId((id) => (id?.startsWith('file:') ? null : id));
  };

  const readHandle = useCallback(async () => {
    const row = await db.settings.get('workspaceDirHandle');
    return (row?.value as FileSystemDirectoryHandle) ?? null;
  }, []);

  const updateSettings = async (newSettings: SettingsType) => {
    setSettings(newSettings);
    await saveSettings(newSettings);
  };

  const getNodeByPath = (path: string, nodes: TreeNode[] = tree): TreeNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = getNodeByPath(path, node.children);
        if (found) return found;
      }
    }
    return null;
  };

  const handleCreateFile = async (dirPath: string) => {
    const name = prompt('New file name:');
    if (!name) return;
    try {
      const node = getNodeByPath(dirPath);
      if (!node || node.kind !== 'directory') return;
      const handle = node.handle as FileSystemDirectoryHandle;
      await createFile(handle, name);
      const newTree = await readTree(handle);
      setTree(newTree);
      flash(`Created ${name}`);
    } catch {
      flash(`Could not create file: ${name}`);
    }
  };

  const handleCreateFolder = async (dirPath: string) => {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      const node = getNodeByPath(dirPath);
      if (!node || node.kind !== 'directory') return;
      const handle = node.handle as FileSystemDirectoryHandle;
      await createFolder(handle, name);
      const newTree = await readTree(handle);
      setTree(newTree);
      flash(`Created folder ${name}`);
    } catch {
      flash(`Could not create folder: ${name}`);
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    if (!confirm(`Delete ${filePath}?`)) return;
    try {
      const node = getNodeByPath(filePath);
      if (!node || node.kind !== 'file') return;
      await deleteEntry(node.handle);
      const id = `file:${filePath}`;
      setTabs((prev) => prev.filter((t) => t.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
      const root = await readTree(
        (await readHandle()) || (tree[0]?.handle as FileSystemDirectoryHandle),
      );
      setTree(root);
      flash(`Deleted ${filePath}`);
    } catch {
      flash(`Could not delete ${filePath}`);
    }
  };

  const handleDeleteFolder = async (dirPath: string) => {
    if (!confirm(`Delete folder ${dirPath} and all contents?`)) return;
    try {
      const node = getNodeByPath(dirPath);
      if (!node || node.kind !== 'directory') return;
      await deleteEntryRecursive(node.handle);
      setTabs((prev) => prev.filter((t) => !t.path?.startsWith(dirPath)));
      setActiveId((id) => (id?.startsWith(`file:${dirPath}`) ? null : id));
      const root = await readTree(
        (await readHandle()) || (tree[0]?.handle as FileSystemDirectoryHandle),
      );
      setTree(root);
      flash(`Deleted folder ${dirPath}`);
    } catch {
      flash(`Could not delete folder ${dirPath}`);
    }
  };

  /* ── Editing ───────────────────────────────────────────── */

  const onBodyChange = (value: string) => {
    if (!active) return;
    const tab = active;
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, body: value, dirty: t.kind === 'file' } : t)),
    );

    if (tab.kind !== 'note') return;
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    const noteId = tab.id.slice('note:'.length);
    noteTimer.current = window.setTimeout(async () => {
      await db.notes.update(noteId, { body: value, updatedAt: Date.now() });
      await refreshNotes();
    }, NOTE_AUTOSAVE_MS);
  };

  const renameNote = (value: string) => {
    if (!active || active.kind !== 'note') return;
    const tab = active;
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, name: value } : t)));
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    const noteId = tab.id.slice('note:'.length);
    noteTimer.current = window.setTimeout(async () => {
      await db.notes.update(noteId, { title: value, updatedAt: Date.now() });
      await refreshNotes();
    }, NOTE_AUTOSAVE_MS);
  };

  const createNote = async () => {
    const note = newNote();
    await db.notes.add(note);
    await refreshNotes();
    openNote(note);
  };

  const deleteNote = async (note: Note) => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    await db.notes.delete(note.id);
    const id = `note:${note.id}`;
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    await refreshNotes();
  };

  const closeTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab?.dirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) return;
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
      return next;
    });
  };

  // Each tab mounts a fresh editor at the top, so drop the previous tab's position.
  useEffect(() => setCursor({ line: 1, col: 1 }), [activeId]);

  /* ── Shortcuts ─────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActive();
      } else if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) {
        e.preventDefault();
        if (allFiles.length) setPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive, allFiles.length]);

  /* ── Render ────────────────────────────────────────────── */

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

  // A note titled "main.tf" should edit as Terraform; untitled ones default to Markdown.
  const activeFilename = !active
    ? ''
    : active.kind === 'file' || active.name.includes('.')
      ? active.name
      : `${active.name}.md`;
  const isMarkdown = /\.(md|markdown)$/i.test(activeFilename);
  const showPreview = preview && isMarkdown;
  const activePath = active?.kind === 'file' ? (active.path ?? null) : null;

  return (
    <>
      <style>{`
        :root {
          --editor-font-size: ${settings.fontSize}px;
          --tab-width: ${settings.tabWidth};
        }
      `}</style>
      <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>notesmith</h1>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="link" onClick={() => setShowSettings(!showSettings)} title="Settings">
              ⚙
            </button>
            <button className="primary" onClick={createNote} title="New note">
              +
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span>{workspace === 'open' ? dirName : 'Files'}</span>
            {workspace === 'open' && (
              <button className="link" onClick={closeFolder} title="Close folder">
                ×
              </button>
            )}
          </div>
          {!fsSupported && <p className="hint">Opening folders needs Chrome or Edge</p>}
          {fsSupported && workspace === 'none' && (
            <button className="wide" onClick={openFolder}>
              Open folder…
            </button>
          )}
          {fsSupported && workspace === 'needs-permission' && (
            <button className="wide" onClick={reconnect}>
              Reconnect folder
            </button>
          )}
          {workspace === 'open' && (
            <div className="tree-wrap">
              <FileTree
                nodes={tree}
                expanded={expanded}
                activePath={activePath}
                onToggleDir={(path) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(path)) next.add(path);
                    return next;
                  })
                }
                onOpenFile={openFile}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onDeleteFile={handleDeleteFile}
                onDeleteFolder={handleDeleteFolder}
              />
            </div>
          )}
        </div>

        <div className="section notes-section">
          <div className="section-head">
            <span>Notes</span>
          </div>
          <input
            className="search"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="note-list">
            {filteredNotes.map((note) => (
              <li key={note.id}>
                <button
                  className={`note-item${activeId === `note:${note.id}` ? ' active' : ''}`}
                  onClick={() => openNote(note)}
                >
                  <span className="note-title">{note.title || 'Untitled'}</span>
                </button>
                <button className="delete" onClick={() => deleteNote(note)} title="Delete">
                  ×
                </button>
              </li>
            ))}
            {filteredNotes.length === 0 && <li className="empty">No matches</li>}
          </ul>
        </div>
      </aside>

      <main className="main">
        <div className="tabs">
          {tabs.map((tab) => (
            <div key={tab.id} className={`tab${tab.id === activeId ? ' active' : ''}`}>
              <button className="tab-label" onClick={() => setActiveId(tab.id)} title={tab.path ?? tab.name}>
                {tab.dirty && <span className="dot" />}
                {tab.name}
              </button>
              <button className="tab-close" onClick={() => closeTab(tab.id)} title="Close">
                ×
              </button>
            </div>
          ))}
        </div>

        {active ? (
          <>
            <header className="toolbar">
              {active.kind === 'note' ? (
                <input
                  className="title-input"
                  value={active.name}
                  onChange={(e) => renameNote(e.target.value)}
                />
              ) : (
                <span className="path-label">{active.path}</span>
              )}
              {isMarkdown && (
                <button onClick={() => setPreview((p) => !p)}>
                  {preview ? 'Hide preview' : 'Show preview'}
                </button>
              )}
              {active.kind === 'file' && (
                <button onClick={saveActive} disabled={!active.dirty}>
                  Save
                </button>
              )}
            </header>

            <div className={showPreview ? 'panes' : 'panes single'}>
              <div className="pane editor">
                <Editor
                  key={active.id}
                  filename={activeFilename}
                  value={active.body}
                  wrap={isMarkdown}
                  onChange={onBodyChange}
                  onCursor={(line, col) => setCursor({ line, col })}
                />
              </div>
              {showPreview && (
                <div className="pane preview markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.body}</ReactMarkdown>
                </div>
              )}
            </div>

            <footer className="statusbar">
              <span>{languageName(activeFilename)}</span>
              <span>
                Ln {cursor.line}, Col {cursor.col}
              </span>
              <span>
                {hasDeepLinter(activeFilename) ? 'Linting on' : 'Syntax check'}
              </span>
              <span className="spacer" />
              {active.dirty && <span className="unsaved">Unsaved — ⌘S</span>}
              {status && <span className="flash">{status}</span>}
            </footer>
          </>
        ) : (
          <div className="blank">
            <p>No file open</p>
            <p className="hint">Open a folder, pick a note, or press ⌘P to jump to a file</p>
          </div>
        )}
      </main>

      {paletteOpen && (
        <QuickOpen
          files={allFiles}
          onPick={(node) => {
            setPaletteOpen(false);
            openFile(node);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onChange={updateSettings}
        />
      )}
    </div>
    </>
  );
}

const WELCOME = `# Welcome to notesmith

A local-first editor. Notes live in your browser; **Open folder…** edits real files on disk.

## Editor

- Syntax highlighting for 100+ languages, picked from the file extension
- Real linting for JavaScript (ESLint), JSON, CSS, HTML, YAML and Markdown
- Every other language gets grammar-level syntax error checking

## Shortcuts

| Key | Action |
| --- | --- |
| \`⌘P\` | Go to file |
| \`⌘S\` | Save file |
| \`⌘D\` | Select next occurrence |
| \`⌘/\` | Toggle comment |
| \`⌘G\` | Go to line |
| \`⌘F\` | Find / replace |
| \`⌥↑\` / \`⌥↓\` | Move line |
| \`⌘⇧K\` | Delete line |

- [x] Write notes
- [ ] Open a folder and edit code
`;
