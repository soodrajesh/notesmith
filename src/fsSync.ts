import { db, safeFileName, type Note } from './db';

const HANDLE_KEY = 'syncDirHandle';

export const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  const row = await db.settings.get(HANDLE_KEY);
  return (row?.value as FileSystemDirectoryHandle) ?? null;
}

async function hasWritePermission(handle: FileSystemDirectoryHandle, prompt: boolean) {
  const opts = { mode: 'readwrite' } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!prompt) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/** Returns a previously-linked folder only if permission is still granted without prompting. */
export async function restoreSyncFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!fsSupported) return null;
  const handle = await readHandle();
  if (!handle) return null;
  return (await hasWritePermission(handle, false)) ? handle : null;
}

/** Re-prompts for permission on a stored handle; used after a page reload. */
export async function reconnectSyncFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await readHandle();
  if (!handle) return null;
  return (await hasWritePermission(handle, true)) ? handle : null;
}

export async function pickSyncFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (!(await hasWritePermission(handle, true))) return null;
  await db.settings.put({ key: HANDLE_KEY, value: handle });
  return handle;
}

export async function unlinkSyncFolder(): Promise<void> {
  await db.settings.delete(HANDLE_KEY);
}

export async function writeNoteToDisk(handle: FileSystemDirectoryHandle, note: Note) {
  const fileHandle = await handle.getFileHandle(safeFileName(note.title), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(note.body);
  await writable.close();
}

export async function deleteNoteFromDisk(handle: FileSystemDirectoryHandle, title: string) {
  await handle.removeEntry(safeFileName(title)).catch(() => {});
}

/** Pulls every .md file in the folder into IndexedDB, replacing notes with the same filename. */
export async function importFolder(handle: FileSystemDirectoryHandle): Promise<number> {
  const existing = await db.notes.toArray();
  const byFile = new Map(existing.map((n) => [safeFileName(n.title), n]));
  const now = Date.now();
  let count = 0;

  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    const body = await file.text();
    const title = entry.name.replace(/\.md$/, '');
    const match = byFile.get(entry.name);

    if (match) {
      await db.notes.update(match.id, { body, updatedAt: file.lastModified || now });
    } else {
      await db.notes.add({
        id: crypto.randomUUID(),
        title,
        body,
        createdAt: file.lastModified || now,
        updatedAt: file.lastModified || now,
      });
    }
    count++;
  }
  return count;
}

export async function exportAll(handle: FileSystemDirectoryHandle): Promise<number> {
  const notes = await db.notes.toArray();
  for (const note of notes) await writeNoteToDisk(handle, note);
  return notes.length;
}
