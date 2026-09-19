import FileTree from '../FileTree';
import { fsSupported, type TreeNode } from '../files';
import type { WorkspaceApi } from '../hooks/useWorkspace';

interface Props {
  ws: WorkspaceApi;
  activePath: string | null;
  onOpenFile: (node: TreeNode) => void;
}

export default function FilesSection({ ws, activePath, onOpenFile }: Props) {
  const { workspace } = ws;
  return (
    <div className="section">
      <div className="section-head">
        <span>{workspace === 'open' ? ws.dirName : 'Files'}</span>
        {workspace === 'open' && (
          <button className="link" onClick={ws.closeFolder} title="Close folder" aria-label="Close folder">
            ×
          </button>
        )}
      </div>
      {!fsSupported && <p className="hint">Opening folders needs Chrome or Edge</p>}
      {fsSupported && workspace === 'none' && (
        <button className="wide" onClick={ws.openFolder}>
          Open folder…
        </button>
      )}
      {fsSupported && workspace === 'needs-permission' && (
        <button className="wide" onClick={ws.reconnect}>
          Reconnect folder
        </button>
      )}
      {workspace === 'open' && (
        <div className="tree-wrap">
          <FileTree
            nodes={ws.tree}
            expanded={ws.expanded}
            activePath={activePath}
            onToggleDir={ws.toggleDir}
            onOpenFile={onOpenFile}
            onCreateFile={ws.handleCreateFile}
            onCreateFolder={ws.handleCreateFolder}
            onDeleteFile={ws.handleDeleteFile}
            onDeleteFolder={ws.handleDeleteFolder}
            onRenameFile={ws.handleRenameFile}
            onRenameFolder={ws.handleRenameFolder}
            onMoveEntry={ws.handleMoveEntry}
          />
        </div>
      )}
    </div>
  );
}
