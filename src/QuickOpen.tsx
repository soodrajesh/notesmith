import { useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from './files';

interface Props {
  files: TreeNode[];
  onPick: (node: TreeNode) => void;
  onClose: () => void;
}

/** Subsequence match, the way editor quick-open bars behave ("aps" hits "App.tsx"). */
function fuzzyScore(path: string, query: string): number {
  if (!query) return 0;
  const hay = path.toLowerCase();
  let i = 0;
  let score = 0;
  let streak = 0;
  for (const ch of query.toLowerCase()) {
    const found = hay.indexOf(ch, i);
    if (found < 0) return -1;
    streak = found === i ? streak + 1 : 0;
    score += streak;
    i = found + 1;
  }
  // Prefer shorter paths and matches in the basename.
  return score * 100 - path.length + (hay.lastIndexOf('/') < hay.indexOf(query[0].toLowerCase()) ? 50 : 0);
}

export default function QuickOpen({ files, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo(() => {
    if (!query.trim()) return files.slice(0, 50);
    return files
      .map((f) => ({ f, s: fuzzyScore(f.path, query.trim()) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((r) => r.f);
  }, [files, query]);

  useEffect(() => setIndex(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[index]) {
      e.preventDefault();
      onPick(results[index]);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Go to file…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul>
          {results.map((f, i) => (
            <li key={f.path}>
              <button
                className={i === index ? 'active' : ''}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(f)}
              >
                <span className="palette-name">{f.name}</span>
                <span className="palette-path">{f.path}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">No files match</li>}
        </ul>
      </div>
    </div>
  );
}
