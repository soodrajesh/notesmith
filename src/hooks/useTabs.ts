import { useCallback, useEffect, useMemo, useState } from 'react';
import { isBinary, readFile, writeFile, type TreeNode } from '../files';
import { canFormat, formatCode } from '../formatters';
import type { Note } from '../db';
import { isUnder } from '../treeUtils';
import { fileTabId, isFileTabId, noteTabId, pathOfTabId, type Tab } from '../types';

export function useTabs(flash: (msg: string) => void) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [gotoLine, setGotoLine] = useState<{ line: number; token: number } | null>(null);

  const active = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  // A note titled "main.tf" should edit as Terraform; untitled ones default to Markdown.
  const activeFilename = !active
    ? ''
    : active.kind === 'file' || active.name.includes('.')
      ? active.name
      : `${active.name}.md`;

  const openNote = useCallback((note: Note) => {
    const id = noteTabId(note.id);
    setTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [...prev, { id, kind: 'note', name: note.title || 'Untitled', body: note.body, dirty: false }],
    );
    setActiveId(id);
  }, []);

  /** Resolves true once the file is open and active; false if it's binary or unreadable. */
  const openFile = useCallback(
    async (node: TreeNode) => {
      const id = fileTabId(node.path);
      if (tabs.some((t) => t.id === id)) {
        setActiveId(id);
        return true;
      }
      if (isBinary(node.name)) {
        flash(`${node.name} is a binary file`);
        return false;
      }
      try {
        const handle = node.handle as FileSystemFileHandle;
        const body = await readFile(handle);
        setTabs((prev) => [
          ...prev,
          { id, kind: 'file', name: node.name, path: node.path, handle, body, dirty: false },
        ]);
        setActiveId(id);
        return true;
      } catch {
        flash(`Could not open ${node.name}`);
        return false;
      }
    },
    [tabs, flash],
  );

  const openFileAtLine = useCallback(
    async (node: TreeNode, line: number) => {
      if (!(await openFile(node))) return;
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

  const formatActive = useCallback(async () => {
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

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab?.dirty && !confirm(`${tab.name} has unsaved changes. Close anyway?`)) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      setActiveId((cur) => (cur === id ? (next[next.length - 1]?.id ?? null) : cur));
    },
    [tabs],
  );

  /** Updates a tab's text; file tabs become dirty, notes are persisted separately by the caller. */
  const setActiveBody = useCallback(
    (value: string) => {
      if (!active) return;
      setTabs((prev) =>
        prev.map((t) => (t.id === active.id ? { ...t, body: value, dirty: t.kind === 'file' } : t)),
      );
    },
    [active],
  );

  const renameActiveNote = useCallback(
    (name: string) => {
      if (!active || active.kind !== 'note') return;
      setTabs((prev) => prev.map((t) => (t.id === active.id ? { ...t, name } : t)));
    },
    [active],
  );

  const removeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  /** Drops every file tab at or under `path` (a deleted/renamed/moved file or folder). */
  const dropFileTabsUnder = useCallback((path: string) => {
    setTabs((prev) => prev.filter((t) => !(t.path && isUnder(t.path, path))));
    setActiveId((cur) => (isFileTabId(cur) && isUnder(pathOfTabId(cur), path) ? null : cur));
  }, []);

  const dropAllFileTabs = useCallback(() => {
    setTabs((prev) => prev.filter((t) => t.kind !== 'file'));
    setActiveId((cur) => (isFileTabId(cur) ? null : cur));
  }, []);

  /** Points an open file tab at its new path/handle after a rename or move. */
  const retargetFileTab = useCallback(
    (oldPath: string, next: { path: string; name: string; handle?: FileSystemFileHandle }) => {
      const oldId = fileTabId(oldPath);
      const newId = fileTabId(next.path);
      setTabs((prev) => prev.map((t) => (t.id === oldId ? { ...t, id: newId, ...next } : t)));
      setActiveId((cur) => (cur === oldId ? newId : cur));
    },
    [],
  );

  const hasDirtyUnder = useCallback(
    (path: string) => tabs.some((t) => t.dirty && t.path && isUnder(t.path, path)),
    [tabs],
  );

  // Notes autosave, but file edits only persist on ⌘S — warn before losing unsaved file work.
  useEffect(() => {
    if (!tabs.some((t) => t.dirty)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [tabs]);

  return {
    tabs,
    setTabs,
    activeId,
    setActiveId,
    active,
    activeFilename,
    gotoLine,
    openNote,
    openFile,
    openFileAtLine,
    saveActive,
    formatActive,
    closeTab,
    setActiveBody,
    renameActiveNote,
    removeTab,
    dropFileTabsUnder,
    dropAllFileTabs,
    retargetFileTab,
    hasDirtyUnder,
  };
}

export type TabsApi = ReturnType<typeof useTabs>;
