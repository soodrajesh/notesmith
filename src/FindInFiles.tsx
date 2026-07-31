import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from './files';
import { isBinary, readFile } from './files';

interface FileMatch {
  node: TreeNode;
  line: number;
  text: string;
}

interface Props {
  files: TreeNode[];
  onPick: (node: TreeNode, line: number) => void;
  onClose: () => void;
}

const MAX_FILES = 500;
const MAX_MATCHES = 200;

export default function FindInFiles({ files, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FileMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    const myId = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const needle = q.toLowerCase();
      const results: FileMatch[] = [];
      const candidates = files.filter((f) => !isBinary(f.name)).slice(0, MAX_FILES);
      for (const node of candidates) {
        if (requestId.current !== myId) return; // superseded by a newer search
        if (results.length >= MAX_MATCHES) break;
        try {
          const text = await readFile(node.handle as FileSystemFileHandle);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              results.push({ node, line: i + 1, text: lines[i].trim().slice(0, 160) });
              if (results.length >= MAX_MATCHES) break;
            }
          }
        } catch {
          /* unreadable file, skip */
        }
      }
      if (requestId.current === myId) {
        setMatches(results);
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, files]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Find in files…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <ul>
          {matches.map((m, i) => (
            <li key={`${m.node.path}:${m.line}:${i}`}>
              <button onClick={() => onPick(m.node, m.line)}>
                <span className="palette-name">
                  {m.node.name}:{m.line}
                </span>
                <span className="palette-path">{m.text}</span>
              </button>
            </li>
          ))}
          {searching && <li className="palette-empty">Searching…</li>}
          {!searching && query.trim() && matches.length === 0 && (
            <li className="palette-empty">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
