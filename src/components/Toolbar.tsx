import type { Tab } from '../types';

interface Props {
  tab: Tab;
  isMarkdown: boolean;
  previewOn: boolean;
  formattable: boolean;
  onRename: (name: string) => void;
  onTogglePreview: () => void;
  onFormat: () => void;
  onSave: () => void;
}

export default function Toolbar({ tab, isMarkdown, previewOn, formattable, onRename, onTogglePreview, onFormat, onSave }: Props) {
  return (
    <header className="toolbar">
      {tab.kind === 'note' ? (
        <input className="title-input" name="note-title" aria-label="Note title" value={tab.name} onChange={(e) => onRename(e.target.value)} />
      ) : (
        <span className="path-label">{tab.path}</span>
      )}
      {isMarkdown && <button onClick={onTogglePreview}>{previewOn ? 'Hide preview' : 'Show preview'}</button>}
      {formattable && (
        <button onClick={onFormat} title="⌥⇧F">
          Format
        </button>
      )}
      {tab.kind === 'file' && (
        <button onClick={onSave} disabled={!tab.dirty}>
          Save
        </button>
      )}
    </header>
  );
}
