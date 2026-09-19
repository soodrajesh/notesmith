import { useMemo, useRef, useState } from 'react';
import type { Note } from '../db';
import { noteTabId } from '../types';

interface Props {
  notes: Note[];
  activeId: string | null;
  onOpen: (note: Note) => void;
  onDelete: (note: Note) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export default function NotesSection({ notes, activeId, onOpen, onDelete, onExport, onImport }: Props) {
  const [query, setQuery] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }, [notes, query]);

  return (
    <div className="section notes-section">
      <div className="section-head">
        <span>Notes</span>
        <div className="button-row tight">
          <button className="link" onClick={onExport} title="Export all notes to JSON" aria-label="Export all notes to JSON">
            ⬇
          </button>
          <button
            className="link"
            onClick={() => importInput.current?.click()}
            title="Import notes from JSON"
            aria-label="Import notes from JSON"
          >
            ⬆
          </button>
        </div>
      </div>
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        name="import-notes-file"
        aria-label="Import notes file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = '';
        }}
      />
      <input
        className="search"
        name="search-notes"
        placeholder="Search notes…"
        aria-label="Search notes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="note-list">
        {filtered.map((note) => (
          <li key={note.id}>
            <button
              className={`note-item${activeId === noteTabId(note.id) ? ' active' : ''}`}
              onClick={() => onOpen(note)}
            >
              <span className="note-title">{note.title || 'Untitled'}</span>
            </button>
            <button
              className="delete"
              onClick={() => onDelete(note)}
              title="Delete"
              aria-label={`Delete ${note.title || 'Untitled'}`}
            >
              ×
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="empty">No matches</li>}
      </ul>
    </div>
  );
}
