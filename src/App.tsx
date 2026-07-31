import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from './Editor';
import FileTree from './FileTree';
import QuickOpen from './QuickOpen';
import FindInFiles from './FindInFiles';
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
  moveFile,
  moveFolder,
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
import { canFormat, formatCode } from './formatters';
import SettingsPanel from './SettingsPanel';
import { loadSettings, saveSettings, type Settings as SettingsType } from './settings';
import { loadSession, saveSession, type SessionTab } from './session';
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
  const [findFilesOpen, setFindFilesOpen] = useState(false);
  const [gotoLine, setGotoLine] = useState<{ line: number; token: number } | null>(null);
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
  const sessionRestored = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const allFiles = useMemo(() => flatten(tree), [tree]);

  // A note titled "main.tf" should edit as Terraform; untitled ones default to Markdown.
  const activeFilename = !active
    ? ''
    : active.kind === 'file' || active.name.includes('.')
      ? active.name
      : `${active.name}.md`;

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

      const session = await loadSession();
      if (session && session.tabs.length) {
        const restoredTabs: Tab[] = [];
        for (const st of session.tabs) {
          if (st.kind === 'note' && st.noteId) {
            const note = all.find((n) => n.id === st.noteId);
            if (note) {
              restoredTabs.push({
                id: `note:${note.id}`,
                kind: 'note',
                name: note.title || 'Untitled',
                body: note.body,
                dirty: false,
              });
            }
          } else if (st.kind === 'file' && st.handle && st.path) {
            try {
              const granted = (await st.handle.queryPermission({ mode: 'readwrite' })) === 'granted';
              if (granted) {
                const body = await readFile(st.handle);
                restoredTabs.push({
                  id: `file:${st.path}`,
                  kind: 'file',
                  name: st.path.split('/').pop() || st.path,
                  path: st.path,
                  handle: st.handle,
                  body,
                  dirty: false,
                });
              }
            } catch {
              /* handle stale or inaccessible — skip this tab */
            }
          }
        }
        if (restoredTabs.length) {
          setTabs(restoredTabs);
          const key = session.activeKey;
          const match = restoredTabs.find((t) =>
            t.kind === 'note' ? t.id.slice('note:'.length) === key : t.path === key,
          );
          setActiveId((match ?? restoredTabs[0]).id);
        }
      }
      sessionRestored.current = true;
    })();
  }, [refreshNotes, openNote, loadTree]);

  useEffect(() => {
    if (!sessionRestored.current) return;
    const timer = window.setTimeout(() => {
      const sessionTabs: SessionTab[] = tabs.map((t) =>
        t.kind === 'note'
          ? { kind: 'note', noteId: t.id.slice('note:'.length) }
          : { kind: 'file', path: t.path, handle: t.handle },
      );
      const activeTab = tabs.find((t) => t.id === activeId);
      const activeKey = activeTab
        ? activeTab.kind === 'note'
          ? activeTab.id.slice('note:'.length)
          : (activeTab.path ?? null)
        : null;
      saveSession({ tabs: sessionTabs, activeKey });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tabs, activeId]);

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

  const openFileAtLine = useCallback(
    async (node: TreeNode, line: number) => {
      await openFile(node);
      setActiveId(`file:${node.path}`);
      setGotoLine((prev) => ({ line, token: (prev?.token ?? 0) + 1 }));
    },
    [openFile],
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

  const handleFormat = useCallback(async () => {
    if (!active || !canFormat(activeFilename)) return;
    try {
      const formatted = await formatCode(activeFilename, active.body);
      if (formatted === active.body) return;
      const tabId = active.id;
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, body: formatted, dirty: t.kind === 'file' } : t)),
      );
      flash('Formatted');
    } catch {
      flash('Could not format — check for syntax errors');
    }
  }, [active, activeFilename, flash]);

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
    const hasDirty = tabs.some((t) => t.kind === 'file' && t.dirty);
    if (hasDirty && !confirm('Some open files have unsaved changes that will be lost. Close folder anyway?')) {
      return;
    }
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
    const openTab = tabs.find((t) => t.id === `file:${filePath}`);
    const warning = openTab?.dirty
      ? `${openTab.name} has unsaved changes that will be lost. Delete ${filePath}?`
      : `Delete ${filePath}?`;
    if (!confirm(warning)) return;
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
    const hasDirty = tabs.some((t) => t.path?.startsWith(dirPath) && t.dirty);
    const warning = hasDirty
      ? `Folder ${dirPath} has unsaved changes that will be lost. Delete folder and all contents?`
      : `Delete folder ${dirPath} and all contents?`;
    if (!confirm(warning)) return;
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

  const handleRenameFile = async (filePath: string) => {
    const node = getNodeByPath(filePath);
    if (!node || node.kind !== 'file') return;
    const oldName = node.name;
    const newName = prompt('Rename file:', oldName);
    if (!newName || newName === oldName) return;
    try {
      const parentPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
      const parentHandle = parentPath
        ? (getNodeByPath(parentPath)?.handle as FileSystemDirectoryHandle)
        : ((await readHandle()) as FileSystemDirectoryHandle);
      if (!parentHandle) return;
      await moveFile(node.handle as FileSystemFileHandle, parentHandle, newName);
      const rootHandle = (await readHandle()) || (tree[0]?.handle as FileSystemDirectoryHandle);
      const newTree = await readTree(rootHandle);
      setTree(newTree);

      const newPath = parentPath ? `${parentPath}/${newName}` : newName;
      const oldId = `file:${filePath}`;
      const newId = `file:${newPath}`;
      const newNode = getNodeByPath(newPath, newTree);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === oldId
            ? { ...t, id: newId, name: newName, path: newPath, handle: newNode?.handle as FileSystemFileHandle }
            : t,
        ),
      );
      setActiveId((cur) => (cur === oldId ? newId : cur));
      flash(`Renamed to ${newName}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not rename ${oldName}`);
    }
  };

  const handleRenameFolder = async (dirPath: string) => {
    const node = getNodeByPath(dirPath);
    if (!node || node.kind !== 'directory') return;
    const oldName = node.name;
    const newName = prompt('Rename folder:', oldName);
    if (!newName || newName === oldName) return;
    const hasDirty = tabs.some((t) => t.path?.startsWith(dirPath) && t.dirty);
    if (hasDirty && !confirm('Some open files in this folder have unsaved changes that will be lost. Continue renaming?')) {
      return;
    }
    try {
      const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
      const parentHandle = parentPath
        ? (getNodeByPath(parentPath)?.handle as FileSystemDirectoryHandle)
        : ((await readHandle()) as FileSystemDirectoryHandle);
      if (!parentHandle) return;
      await moveFolder(node.handle as FileSystemDirectoryHandle, parentHandle, newName);
      const rootHandle = (await readHandle()) || (tree[0]?.handle as FileSystemDirectoryHandle);
      const newTree = await readTree(rootHandle);
      setTree(newTree);
      setTabs((prev) => prev.filter((t) => !t.path?.startsWith(dirPath)));
      setActiveId((id) => (id?.startsWith(`file:${dirPath}`) ? null : id));
      flash(`Renamed to ${newName}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not rename ${oldName}`);
    }
  };

  const handleMoveEntry = async (
    srcPath: string,
    srcKind: 'file' | 'directory',
    destDirPath: string,
  ) => {
    if (srcPath === destDirPath) return;
    if (srcKind === 'directory' && (destDirPath === srcPath || destDirPath.startsWith(`${srcPath}/`))) {
      return flash('Cannot move a folder into itself');
    }
    const srcParentPath = srcPath.includes('/') ? srcPath.slice(0, srcPath.lastIndexOf('/')) : '';
    if (srcParentPath === destDirPath) return; // already in that folder

    const node = getNodeByPath(srcPath);
    const destNode = getNodeByPath(destDirPath);
    if (!node || !destNode || destNode.kind !== 'directory') return;
    const destHandle = destNode.handle as FileSystemDirectoryHandle;

    if (srcKind === 'directory') {
      const hasDirty = tabs.some((t) => t.path?.startsWith(srcPath) && t.dirty);
      if (hasDirty && !confirm('Some open files in this folder have unsaved changes that will be lost. Continue moving?')) {
        return;
      }
    }

    try {
      if (srcKind === 'file') {
        await moveFile(node.handle as FileSystemFileHandle, destHandle, node.name);
      } else {
        await moveFolder(node.handle as FileSystemDirectoryHandle, destHandle, node.name);
      }
      const rootHandle = (await readHandle()) || (tree[0]?.handle as FileSystemDirectoryHandle);
      const newTree = await readTree(rootHandle);
      setTree(newTree);

      const newPath = destDirPath ? `${destDirPath}/${node.name}` : node.name;
      if (srcKind === 'file') {
        const oldId = `file:${srcPath}`;
        const newId = `file:${newPath}`;
        const newNode = getNodeByPath(newPath, newTree);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === oldId
              ? { ...t, id: newId, name: node.name, path: newPath, handle: newNode?.handle as FileSystemFileHandle }
              : t,
          ),
        );
        setActiveId((cur) => (cur === oldId ? newId : cur));
      } else {
        setTabs((prev) => prev.filter((t) => !t.path?.startsWith(srcPath)));
        setActiveId((id) => (id?.startsWith(`file:${srcPath}`) ? null : id));
      }
      flash(`Moved ${node.name}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not move ${node.name}`);
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

  const exportNotes = async () => {
    const all = await db.notes.toArray();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notesmith-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Exported notes');
  };

  const importNotes = async (file: File) => {
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) throw new Error('not an array');
      let count = 0;
      for (const note of imported) {
        if (typeof note?.id !== 'string' || typeof note?.title !== 'string' || typeof note?.body !== 'string') continue;
        await db.notes.put(note);
        count++;
      }
      await refreshNotes();
      flash(`Imported ${count} note${count === 1 ? '' : 's'}`);
    } catch {
      flash('Could not import — invalid backup file');
    }
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

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Notes autosave, but file edits only persist on ⌘S — warn before losing unsaved file work.
  useEffect(() => {
    const hasDirtyFile = tabs.some((t) => t.dirty);
    if (!hasDirtyFile) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [tabs]);

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
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (allFiles.length) setFindFilesOpen(true);
      } else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleFormat();
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setFindFilesOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive, handleFormat, allFiles.length]);

  /* ── Render ────────────────────────────────────────────── */

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [notes, query]);

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
                onRenameFile={handleRenameFile}
                onRenameFolder={handleRenameFolder}
                onMoveEntry={handleMoveEntry}
              />
            </div>
          )}
        </div>

        <div className="section notes-section">
          <div className="section-head">
            <span>Notes</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button className="link" onClick={exportNotes} title="Export all notes to JSON">
                ⬇
              </button>
              <button className="link" onClick={() => importInputRef.current?.click()} title="Import notes from JSON">
                ⬆
              </button>
            </div>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importNotes(file);
              e.target.value = '';
            }}
          />
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
              {canFormat(activeFilename) && (
                <button onClick={handleFormat} title="⌥⇧F">
                  Format
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
                  dark={settings.theme !== 'light'}
                  gotoLine={gotoLine}
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
            <p className="hint">Open a folder, pick a note, press ⌘P to jump to a file, or ⌘⇧F to find in files</p>
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

      {findFilesOpen && (
        <FindInFiles
          files={allFiles}
          onPick={(node, line) => {
            setFindFilesOpen(false);
            openFileAtLine(node, line);
          }}
          onClose={() => setFindFilesOpen(false)}
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
| \`⌘⇧F\` | Find in files |
| \`⌘S\` | Save file |
| \`⌥⇧F\` | Format file |
| \`⌘D\` | Select next occurrence |
| \`⌘/\` | Toggle comment |
| \`⌘G\` | Go to line |
| \`⌘F\` | Find / replace |
| \`⌥↑\` / \`⌥↓\` | Move line |
| \`⌘⇧K\` | Delete line |

- [x] Write notes
- [ ] Open a folder and edit code
`;
