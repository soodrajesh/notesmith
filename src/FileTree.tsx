import type { TreeNode } from './files';

interface Props {
  nodes: TreeNode[];
  expanded: Set<string>;
  activePath: string | null;
  depth?: number;
  onToggleDir: (path: string) => void;
  onOpenFile: (node: TreeNode) => void;
}

export default function FileTree({
  nodes,
  expanded,
  activePath,
  depth = 0,
  onToggleDir,
  onOpenFile,
}: Props) {
  return (
    <ul className="tree">
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path);
        return (
          <li key={node.path}>
            <button
              className={`tree-row${node.path === activePath ? ' active' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => (node.kind === 'directory' ? onToggleDir(node.path) : onOpenFile(node))}
              title={node.path}
            >
              <span className="tree-caret">
                {node.kind === 'directory' ? (isOpen ? '▾' : '▸') : ''}
              </span>
              <span className="tree-name">{node.name}</span>
            </button>
            {node.kind === 'directory' && isOpen && node.children && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                expanded={expanded}
                activePath={activePath}
                depth={depth + 1}
                onToggleDir={onToggleDir}
                onOpenFile={onOpenFile}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
