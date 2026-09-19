export type WorkspaceState = 'none' | 'open' | 'needs-permission';

export interface Tab {
  id: string;
  kind: 'note' | 'file';
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
  body: string;
  dirty: boolean;
}

const NOTE_PREFIX = 'note:';
const FILE_PREFIX = 'file:';

export const noteTabId = (noteId: string) => `${NOTE_PREFIX}${noteId}`;
export const fileTabId = (path: string) => `${FILE_PREFIX}${path}`;
export const noteIdOfTab = (tab: Tab) => tab.id.slice(NOTE_PREFIX.length);
export const isFileTabId = (id: string | null): id is string => !!id && id.startsWith(FILE_PREFIX);
export const pathOfTabId = (id: string) => id.slice(FILE_PREFIX.length);
