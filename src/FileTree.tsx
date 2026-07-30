import { useState } from 'react';
import type { TreeNode } from './files';

interface Props {
  nodes: TreeNode[];
  expanded: Set<string>;
  activePath: string | null;
  depth?: number;
  onToggleDir: (path: string) => void;
  onOpenFile: (node: TreeNode) => void;
  onCreateFile?: (dirPath: string) => void;
  onCreateFolder?: (dirPath: string) => void;
  onDeleteFile?: (filePath: string) => void;
  onDeleteFolder?: (dirPath: string) => void;
}

export default function FileTree({
  nodes,
  expanded,
  activePath,
  depth = 0,
  onToggleDir,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onDeleteFolder,
}: Props) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  return (
    <ul className="tree">
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        const isHovered = hoveredPath === node.path;

        return (
          <li key={node.path}>
            <div
              className="tree-item"
              onMouseEnter={() => setHoveredPath(node.path)}
              onMouseLeave={() => setHoveredPath(null)}
            >
              <button
                className={`tree-row${node.path === activePath ? ' active' : ''}`}
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() =>
                  node.kind === 'directory' ? onToggleDir(node.path) : onOpenFile(node)
                }
                title={node.path}
              >
                <span className="tree-caret">
                  {node.kind === 'directory' ? (isOpen ? '▾' : '▸') : ''}
                </span>
                <span className="tree-name">{node.name}</span>
              </button>
              {isHovered && (
                <div className="tree-actions">
                  {node.kind === 'directory' && (
                    <>
                      <button
                        className="tree-action"
                        title="New file"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateFile?.(node.path);
                        }}
                      >
                        +f
                      </button>
                      <button
                        className="tree-action"
                        title="New folder"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateFolder?.(node.path);
                        }}
                      >
                        +d
                      </button>
                    </>
                  )}
                  <button
                    className="tree-action delete"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.kind === 'directory') {
                        onDeleteFolder?.(node.path);
                      } else {
                        onDeleteFile?.(node.path);
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            {node.kind === 'directory' && isOpen && node.children && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                expanded={expanded}
                activePath={activePath}
                depth={depth + 1}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onDeleteFile={onDeleteFile}
                onDeleteFolder={onDeleteFolder}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
