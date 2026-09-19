import { useEffect, useRef } from 'react';
import { db, newNote, type Note } from '../db';
import { fsSupported, hasStoredWorkspace, restoreWorkspace } from '../files';
import { loadSession, restoreSessionTabs, saveSession, snapshotSession } from '../session';
import { loadSettings, type Settings } from '../settings';
import type { Tab, WorkspaceState } from '../types';
import { WELCOME } from '../welcome';

const SESSION_SAVE_MS = 400;

interface Deps {
  tabs: Tab[];
  activeId: string | null;
  refreshNotes: () => Promise<Note[]>;
  openNote: (note: Note) => void;
  loadTree: (handle: FileSystemDirectoryHandle) => Promise<void>;
  setWorkspace: (state: WorkspaceState) => void;
  setSettings: (settings: Settings) => void;
  setTabs: (tabs: Tab[]) => void;
  setActiveId: (id: string) => void;
}

/** One-time startup (settings, notes, folder, last session's tabs), then keeps the session saved as tabs change. */
export function useBoot(deps: Deps) {
  const { tabs, activeId } = deps;
  const booted = useRef(false);
  const sessionRestored = useRef(false);

  // Latest callbacks without re-running startup when their identities change.
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const d = latest.current;
      d.setSettings(await loadSettings());

      let all = await d.refreshNotes();
      if (all.length === 0) {
        const first = newNote('Welcome');
        first.body = WELCOME;
        await db.notes.add(first);
        all = await d.refreshNotes();
      }
      d.openNote(all[0]);

      if (fsSupported) {
        const restored = await restoreWorkspace();
        if (restored) await d.loadTree(restored);
        else if (await hasStoredWorkspace()) d.setWorkspace('needs-permission');
      }

      const session = await loadSession();
      const restoredSession = session && (await restoreSessionTabs(session, all));
      if (restoredSession) {
        d.setTabs(restoredSession.tabs);
        d.setActiveId(restoredSession.activeId);
      }
      sessionRestored.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!sessionRestored.current) return;
    const timer = window.setTimeout(() => saveSession(snapshotSession(tabs, activeId)), SESSION_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [tabs, activeId]);
}
