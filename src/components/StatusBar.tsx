import { languageName } from '../lang';
import { hasDeepLinter } from '../linters';

interface Props {
  filename: string;
  cursor: { line: number; col: number };
  dirty: boolean;
  status: string;
}

export default function StatusBar({ filename, cursor, dirty, status }: Props) {
  return (
    <footer className="statusbar">
      <span>{languageName(filename)}</span>
      <span>
        Ln {cursor.line}, Col {cursor.col}
      </span>
      <span>{hasDeepLinter(filename) ? 'Linting on' : 'Syntax check'}</span>
      <span className="spacer" />
      {dirty && <span className="unsaved">Unsaved — ⌘S</span>}
      {status && <span className="flash">{status}</span>}
    </footer>
  );
}
