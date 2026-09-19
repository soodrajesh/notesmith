import { db, type Note } from './db';
import { readFile } from './files';
import { fileTabId, noteIdOfTab, noteTabId, type Tab } from './types';

export interface SessionTab {
  kind: 'note' | 'file';
  noteId?: string;
  path?: string;
  handle?: FileSystemFileHandle;
}

export interface Session {
  tabs: SessionTab[];
  activeKey: string | null;
}

export async function loadSession(): Promise<Session | null> {
  const stored = await db.settings.get('session');
  return (stored?.value as Session) ?? null;
}

export async function saveSession(session: Session): Promise<void> {
  await db.settings.put({ key: 'session', value: session });
}

/** What gets persisted: notes by id, files by path + handle, and which tab was focused. */
export function snapshotSession(tabs: Tab[], activeId: string | null): Session {
  const activeTab = tabs.find((t) => t.id === activeId);
  return {
    tabs: tabs.map((t) =>
      t.kind === 'note'
        ? { kind: 'note', noteId: noteIdOfTab(t) }
        : { kind: 'file', path: t.path, handle: t.handle },
    ),
    activeKey: activeTab ? (activeTab.kind === 'note' ? noteIdOfTab(activeTab) : (activeTab.path ?? null)) : null,
  };
}

/**
 * Rebuilds tabs from a saved session. Notes are always readable; file tabs come back only when
 * the browser still grants read/write on their handle, otherwise they're silently dropped.
 */
export async function restoreSessionTabs(
  session: Session,
  notes: Note[],
): Promise<{ tabs: Tab[]; activeId: string } | null> {
  const tabs: Tab[] = [];
  for (const st of session.tabs) {
    if (st.kind === 'note' && st.noteId) {
      const note = notes.find((n) => n.id === st.noteId);
      if (note) {
        tabs.push({
          id: noteTabId(note.id),
          kind: 'note',
          name: note.title || 'Untitled',
          body: note.body,
          dirty: false,
        });
      }
    } else if (st.kind === 'file' && st.handle && st.path) {
      try {
        if ((await st.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') continue;
        tabs.push({
          id: fileTabId(st.path),
          kind: 'file',
          name: st.path.split('/').pop() || st.path,
          path: st.path,
          handle: st.handle,
          body: await readFile(st.handle),
          dirty: false,
        });
      } catch {
        /* handle stale or inaccessible — skip this tab */
      }
    }
  }
  if (!tabs.length) return null;
  const match = tabs.find((t) =>
    t.kind === 'note' ? noteIdOfTab(t) === session.activeKey : t.path === session.activeKey,
  );
  return { tabs, activeId: (match ?? tabs[0]).id };
}
