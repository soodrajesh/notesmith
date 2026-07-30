import { db } from './db';

const HANDLE_KEY = 'workspaceDirHandle';

export const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: TreeNode[];
}

/** Directories that would flood the tree and are never worth editing. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '.vercel',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'vendor',
]);

const MAX_DEPTH = 6;
const MAX_ENTRIES = 4000;

async function hasWritePermission(handle: FileSystemDirectoryHandle, prompt: boolean) {
  const opts = { mode: 'readwrite' } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!prompt) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  const row = await db.settings.get(HANDLE_KEY);
  return (row?.value as FileSystemDirectoryHandle) ?? null;
}

export async function restoreWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  if (!fsSupported) return null;
  const handle = await readHandle();
  if (!handle) return null;
  return (await hasWritePermission(handle, false)) ? handle : null;
}

export async function hasStoredWorkspace(): Promise<boolean> {
  return (await readHandle()) !== null;
}

export async function reconnectWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await readHandle();
  if (!handle) return null;
  return (await hasWritePermission(handle, true)) ? handle : null;
}

export async function pickWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (!(await hasWritePermission(handle, true))) return null;
  await db.settings.put({ key: HANDLE_KEY, value: handle });
  return handle;
}

export async function closeWorkspace(): Promise<void> {
  await db.settings.delete(HANDLE_KEY);
}

/** Walks the folder into a sorted tree, skipping build/vendor dirs. */
export async function readTree(
  dir: FileSystemDirectoryHandle,
  prefix = '',
  depth = 0,
  budget = { count: 0 },
): Promise<TreeNode[]> {
  if (depth >= MAX_DEPTH || budget.count >= MAX_ENTRIES) return [];
  const nodes: TreeNode[] = [];

  for await (const entry of dir.values()) {
    if (budget.count >= MAX_ENTRIES) break;
    if (entry.name.startsWith('.') && entry.kind === 'directory') continue;
    if (entry.kind === 'directory' && SKIP_DIRS.has(entry.name)) continue;
    budget.count++;

    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const handle = entry as FileSystemDirectoryHandle;
      nodes.push({
        name: entry.name,
        path,
        kind: 'directory',
        handle,
        children: await readTree(handle, path, depth + 1, budget),
      });
    } else {
      nodes.push({ name: entry.name, path, kind: 'file', handle: entry as FileSystemFileHandle });
    }
  }

  nodes.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1,
  );
  return nodes;
}

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|zip|gz|tar|bz2|7z|rar|mp[34]|wav|ogg|mov|avi|mkv|woff2?|ttf|otf|eot|exe|dll|so|dylib|class|jar|wasm|db|sqlite3?)$/i;

export function isBinary(name: string): boolean {
  return BINARY_EXT.test(name);
}

export async function readFile(handle: FileSystemFileHandle): Promise<string> {
  return (await handle.getFile()).text();
}

export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function createFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle> {
  return dirHandle.getFileHandle(name, { create: true });
}

export async function createFolder(
  dirHandle: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return dirHandle.getDirectoryHandle(name, { create: true });
}

export async function deleteEntry(handle: FileSystemHandle): Promise<void> {
  if (!('remove' in handle)) throw new Error('Delete not supported in this browser');
  await (handle as any).remove();
}

export async function deleteEntryRecursive(handle: FileSystemHandle): Promise<void> {
  if (!('remove' in handle)) throw new Error('Delete not supported in this browser');
  await (handle as any).remove({ recursive: true });
}
