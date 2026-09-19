import { useEffect } from 'react';

interface Shortcuts {
  hasFiles: boolean;
  onSave: () => void;
  onFormat: () => void;
  onQuickOpen: () => void;
  onFindInFiles: () => void;
  onEscape: () => void;
}

/** App-level shortcuts; editing shortcuts (⌘D, ⌘/, ⌘G…) live in the editor's own keymap. */
export function useShortcuts({ hasFiles, onSave, onFormat, onQuickOpen, onFindInFiles, onEscape }: Shortcuts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        onSave();
      } else if (mod && key === 'p' && !e.shiftKey) {
        e.preventDefault();
        if (hasFiles) onQuickOpen();
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        if (hasFiles) onFindInFiles();
      } else if (e.altKey && e.shiftKey && key === 'f') {
        e.preventDefault();
        onFormat();
      } else if (e.key === 'Escape') {
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasFiles, onSave, onFormat, onQuickOpen, onFindInFiles, onEscape]);
}
