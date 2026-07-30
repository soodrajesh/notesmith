import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter } from '@codemirror/lint';
import { indentUnit } from '@codemirror/language';
import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  indentLess,
  indentMore,
  moveLineDown,
  moveLineUp,
  toggleComment,
} from '@codemirror/commands';
import { gotoLine, selectNextOccurrence } from '@codemirror/search';
import { describeLanguage } from './lang';
import { lintExtension } from './linters';

/** Editing shortcuts Sublime Text and Notepad++ users expect to just work. */
const sublimeKeymap = Prec.high(
  keymap.of([
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    { key: 'Mod-/', run: toggleComment, preventDefault: true },
    { key: 'Mod-g', run: gotoLine, preventDefault: true },
    { key: 'Mod-Shift-k', run: deleteLine, preventDefault: true },
    { key: 'Alt-ArrowUp', run: moveLineUp, preventDefault: true },
    { key: 'Alt-ArrowDown', run: moveLineDown, preventDefault: true },
    { key: 'Shift-Alt-ArrowUp', run: copyLineUp, preventDefault: true },
    { key: 'Shift-Alt-ArrowDown', run: copyLineDown, preventDefault: true },
    { key: 'Mod-]', run: indentMore, preventDefault: true },
    { key: 'Mod-[', run: indentLess, preventDefault: true },
  ]),
);

interface Props {
  filename: string;
  value: string;
  wrap: boolean;
  dark: boolean;
  onChange: (value: string) => void;
  onCursor?: (line: number, col: number) => void;
}

export default function Editor({ filename, value, wrap, dark, onChange, onCursor }: Props) {
  const [langExt, setLangExt] = useState<Extension | null>(null);

  // Grammars are code-split; load the one matching this file, ignoring stale resolutions.
  useEffect(() => {
    const desc = describeLanguage(filename);
    if (!desc) {
      setLangExt(null);
      return;
    }
    let cancelled = false;
    desc
      .load()
      .then((support) => {
        if (!cancelled) setLangExt(support);
      })
      .catch(() => {
        if (!cancelled) setLangExt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [filename]);

  const extensions = useMemo(() => {
    const list: Extension[] = [
      sublimeKeymap,
      indentUnit.of('  '),
      lintGutter(),
      lintExtension(filename),
      EditorView.updateListener.of((u) => {
        if (!onCursor || !u.selectionSet) return;
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        onCursor(line.number, head - line.from + 1);
      }),
    ];
    if (langExt) list.push(langExt);
    if (wrap) list.push(EditorView.lineWrapping);
    return list;
  }, [filename, langExt, wrap, onCursor]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={dark ? oneDark : 'light'}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        highlightSelectionMatches: true,
        searchKeymap: true,
      }}
    />
  );
}
