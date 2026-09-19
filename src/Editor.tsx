import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { oneDarkHighlightStyle, oneDarkTheme } from '@codemirror/theme-one-dark';
import { lintGutter } from '@codemirror/lint';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
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

/**
 * One Dark's coral (#e06c75) is 4.1–4.4:1 against its own backgrounds, just under the 4.5:1 WCAG AA
 * minimum for text. Rather than layering a second highlight style on top (whose CSS would tie with
 * the original's), rebuild One Dark's own style with the coral swapped for a lighter one.
 */
const ONE_DARK_CORAL = '#e06c75';
const ACCESSIBLE_CORAL = '#f28b94';
const oneDarkAccessible: Extension = [
  oneDarkTheme,
  syntaxHighlighting(
    HighlightStyle.define(
      oneDarkHighlightStyle.specs.map((spec) =>
        spec.color === ONE_DARK_CORAL ? { ...spec, color: ACCESSIBLE_CORAL } : spec,
      ),
    ),
  ),
];

interface Props {
  filename: string;
  value: string;
  wrap: boolean;
  dark: boolean;
  /** Bump `token` (even for a repeated line) to force scrolling/selecting again. */
  gotoLine?: { line: number; token: number } | null;
  onChange: (value: string) => void;
  onCursor?: (line: number, col: number) => void;
}

export default function Editor({ filename, value, wrap, dark, gotoLine, onChange, onCursor }: Props) {
  const [langExt, setLangExt] = useState<Extension | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    if (!gotoLine) return;
    const view = cmRef.current?.view;
    if (!view) return;
    const clamped = Math.max(1, Math.min(gotoLine.line, view.state.doc.lines));
    const line = view.state.doc.line(clamped);
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    view.focus();
  }, [gotoLine]);

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
      // The editing surface is a role="textbox" element and needs an accessible name.
      EditorView.contentAttributes.of({ 'aria-label': `Editor for ${filename || 'note'}` }),
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
      ref={cmRef}
      value={value}
      height="100%"
      theme={dark ? oneDarkAccessible : 'light'}
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
