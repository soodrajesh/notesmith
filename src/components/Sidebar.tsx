import type { Note } from '../db';
import type { TreeNode } from '../files';
import type { WorkspaceApi } from '../hooks/useWorkspace';
import FilesSection from './FilesSection';
import NotesSection from './NotesSection';

interface Props {
  ws: WorkspaceApi;
  notes: Note[];
  activeId: string | null;
  activePath: string | null;
  onOpenFile: (node: TreeNode) => void;
  onOpenNote: (note: Note) => void;
  onCreateNote: () => void;
  onDeleteNote: (note: Note) => void;
  onExportNotes: () => void;
  onImportNotes: (file: File) => void;
  onToggleSettings: () => void;
}

/** Feather "settings" icon (MIT) — an SVG scales predictably, unlike the ⚙ glyph, whose size depends on the font. */
function GearIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function Sidebar(props: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>notesmith</h1>
        <div className="button-row">
          <button className="link icon-btn" onClick={props.onToggleSettings} title="Settings" aria-label="Settings">
            <GearIcon />
          </button>
          <button className="primary icon-btn" onClick={props.onCreateNote} title="New note" aria-label="New note">
            +
          </button>
        </div>
      </div>

      <FilesSection ws={props.ws} activePath={props.activePath} onOpenFile={props.onOpenFile} />
      <NotesSection
        notes={props.notes}
        activeId={props.activeId}
        onOpen={props.onOpenNote}
        onDelete={props.onDeleteNote}
        onExport={props.onExportNotes}
        onImport={props.onImportNotes}
      />
    </aside>
  );
}
