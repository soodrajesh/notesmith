import { db } from './db';

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
