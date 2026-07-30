import Dexie, { type EntityTable } from 'dexie';

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

const db = new Dexie('notesmith') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  settings: EntityTable<Setting, 'key'>;
};

db.version(1).stores({
  notes: 'id, title, updatedAt',
  settings: 'key',
});

export { db };

export function newNote(title = 'Untitled'): Note {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    body: `# ${title}\n\n`,
    createdAt: now,
    updatedAt: now,
  };
}

export function safeFileName(title: string): string {
  const cleaned = title.replace(/[/\\?%*:|"<>]/g, '-').trim();
  return `${cleaned || 'untitled'}.md`;
}
