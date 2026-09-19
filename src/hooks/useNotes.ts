import { useCallback, useEffect, useRef, useState } from 'react';
import { db, newNote, type Note } from '../db';

const NOTE_AUTOSAVE_MS = 500;

type NotePatch = Partial<Pick<Note, 'title' | 'body'>>;

/**
 * Quick notes live in IndexedDB. Edits are debounced per note (not globally), and title/body edits
 * to the same note are merged — otherwise switching notes or renaming mid-debounce would silently
 * cancel the earlier note's pending save.
 */
export function useNotes(flash: (msg: string) => void) {
  const [notes, setNotes] = useState<Note[]>([]);
  const pending = useRef(new Map<string, { timer: number; patch: NotePatch }>());

  const refreshNotes = useCallback(async () => {
    const all = await db.notes.orderBy('updatedAt').reverse().toArray();
    setNotes(all);
    return all;
  }, []);

  const scheduleSave = useCallback(
    (id: string, patch: NotePatch) => {
      const prev = pending.current.get(id);
      if (prev) window.clearTimeout(prev.timer);
      const merged = { ...prev?.patch, ...patch };
      const timer = window.setTimeout(async () => {
        pending.current.delete(id);
        await db.notes.update(id, { ...merged, updatedAt: Date.now() });
        await refreshNotes();
      }, NOTE_AUTOSAVE_MS);
      pending.current.set(id, { timer, patch: merged });
    },
    [refreshNotes],
  );

  /** Writes anything still waiting on the debounce — used when the page is being hidden or closed. */
  const flushPending = useCallback(() => {
    for (const [id, { timer, patch }] of pending.current) {
      window.clearTimeout(timer);
      void db.notes.update(id, { ...patch, updatedAt: Date.now() });
    }
    pending.current.clear();
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPending);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPending);
    };
  }, [flushPending]);

  const createNote = useCallback(async (title?: string) => {
    const note = newNote(title);
    await db.notes.add(note);
    await refreshNotes();
    return note;
  }, [refreshNotes]);

  const removeNote = useCallback(
    async (id: string) => {
      const queued = pending.current.get(id);
      if (queued) window.clearTimeout(queued.timer);
      pending.current.delete(id);
      await db.notes.delete(id);
      await refreshNotes();
    },
    [refreshNotes],
  );

  const exportNotes = useCallback(async () => {
    const all = await db.notes.toArray();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notesmith-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Exported notes');
  }, [flash]);

  const importNotes = useCallback(
    async (file: File) => {
      try {
        const imported = JSON.parse(await file.text());
        if (!Array.isArray(imported)) throw new Error('not an array');
        let count = 0;
        const now = Date.now();
        for (const note of imported) {
          if (typeof note?.id !== 'string' || typeof note?.title !== 'string' || typeof note?.body !== 'string') continue;
          // updatedAt is the index the note list sorts on — a backup missing it would import but never show.
          await db.notes.put({
            id: note.id,
            title: note.title,
            body: note.body,
            createdAt: typeof note.createdAt === 'number' ? note.createdAt : now,
            updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : now,
          });
          count++;
        }
        await refreshNotes();
        flash(`Imported ${count} note${count === 1 ? '' : 's'}`);
      } catch {
        flash('Could not import — invalid backup file');
      }
    },
    [flash, refreshNotes],
  );

  return { notes, refreshNotes, scheduleSave, createNote, removeNote, exportNotes, importNotes };
}
