import { useCallback, useMemo, useRef, useState } from 'react';
import {
  closeWorkspace,
  createFile,
  createFolder,
  deleteEntry,
  deleteEntryRecursive,
  moveFile,
  moveFolder,
  pickWorkspace,
  readTree,
  reconnectWorkspace,
  type TreeNode,
} from '../files';
import { findNode, flattenFiles, joinPath, parentPath } from '../treeUtils';
import { fileTabId, type WorkspaceState } from '../types';
import type { TabsApi } from './useTabs';

type TabOps = Pick<
  TabsApi,
  'tabs' | 'hasDirtyUnder' | 'dropFileTabsUnder' | 'dropAllFileTabs' | 'retargetFileTab'
>;

/**
 * The opened folder: its tree plus every create/rename/move/delete against it. The root handle is
 * held in a ref and every mutation re-reads the whole tree from it, so a change made deep in the
 * tree can never replace the view with just that subfolder.
 */
export function useWorkspace(tabOps: TabOps, flash: (msg: string) => void) {
  const { tabs, hasDirtyUnder, dropFileTabsUnder, dropAllFileTabs, retargetFileTab } = tabOps;

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [dirName, setDirName] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceState>('none');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<FileSystemDirectoryHandle | null>(null);

  const allFiles = useMemo(() => flattenFiles(tree), [tree]);

  const loadTree = useCallback(async (handle: FileSystemDirectoryHandle) => {
    rootRef.current = handle;
    setDirName(handle.name);
    setTree(await readTree(handle));
    setWorkspace('open');
  }, []);

  const refreshTree = useCallback(async (): Promise<TreeNode[]> => {
    if (!rootRef.current) return [];
    const next = await readTree(rootRef.current);
    setTree(next);
    return next;
  }, []);

  /** '' is the workspace root. */
  const dirHandleOf = (dirPath: string): FileSystemDirectoryHandle | null => {
    if (dirPath === '') return rootRef.current;
    const node = findNode(tree, dirPath);
    return node?.kind === 'directory' ? (node.handle as FileSystemDirectoryHandle) : null;
  };

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const openFolder = async () => {
    let handle: FileSystemDirectoryHandle | null = null;
    try {
      handle = await pickWorkspace();
    } catch {
      return flash('Folder selection cancelled');
    }
    if (!handle) return;
    await loadTree(handle);
    flash(`Opened ${handle.name}`);
  };

  const reconnect = async () => {
    const handle = await reconnectWorkspace();
    if (!handle) return flash('Permission denied');
    await loadTree(handle);
  };

  const closeFolder = async () => {
    const hasDirty = tabs.some((t) => t.kind === 'file' && t.dirty);
    if (hasDirty && !confirm('Some open files have unsaved changes that will be lost. Close folder anyway?')) {
      return;
    }
    await closeWorkspace();
    rootRef.current = null;
    setTree([]);
    setDirName('');
    setWorkspace('none');
    dropAllFileTabs();
  };

  const handleCreateFile = async (dirPath: string) => {
    const name = prompt('New file name:');
    if (!name) return;
    try {
      const dir = dirHandleOf(dirPath);
      if (!dir) return;
      await createFile(dir, name);
      await refreshTree();
      flash(`Created ${name}`);
    } catch {
      flash(`Could not create file: ${name}`);
    }
  };

  const handleCreateFolder = async (dirPath: string) => {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      const dir = dirHandleOf(dirPath);
      if (!dir) return;
      await createFolder(dir, name);
      await refreshTree();
      flash(`Created folder ${name}`);
    } catch {
      flash(`Could not create folder: ${name}`);
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    const openTab = tabs.find((t) => t.id === fileTabId(filePath));
    const warning = openTab?.dirty
      ? `${openTab.name} has unsaved changes that will be lost. Delete ${filePath}?`
      : `Delete ${filePath}?`;
    if (!confirm(warning)) return;
    try {
      const node = findNode(tree, filePath);
      if (!node || node.kind !== 'file') return;
      await deleteEntry(node.handle);
      dropFileTabsUnder(filePath);
      await refreshTree();
      flash(`Deleted ${filePath}`);
    } catch {
      flash(`Could not delete ${filePath}`);
    }
  };

  const handleDeleteFolder = async (dirPath: string) => {
    const warning = hasDirtyUnder(dirPath)
      ? `Folder ${dirPath} has unsaved changes that will be lost. Delete folder and all contents?`
      : `Delete folder ${dirPath} and all contents?`;
    if (!confirm(warning)) return;
    try {
      const node = findNode(tree, dirPath);
      if (!node || node.kind !== 'directory') return;
      await deleteEntryRecursive(node.handle);
      dropFileTabsUnder(dirPath);
      await refreshTree();
      flash(`Deleted folder ${dirPath}`);
    } catch {
      flash(`Could not delete folder ${dirPath}`);
    }
  };

  const handleRenameFile = async (filePath: string) => {
    const node = findNode(tree, filePath);
    if (!node || node.kind !== 'file') return;
    const oldName = node.name;
    const newName = prompt('Rename file:', oldName);
    if (!newName || newName === oldName) return;
    try {
      const parent = parentPath(filePath);
      const parentHandle = dirHandleOf(parent);
      if (!parentHandle) return;
      await moveFile(node.handle as FileSystemFileHandle, parentHandle, newName);
      const newTree = await refreshTree();
      const newPath = joinPath(parent, newName);
      retargetFileTab(filePath, {
        path: newPath,
        name: newName,
        handle: findNode(newTree, newPath)?.handle as FileSystemFileHandle | undefined,
      });
      flash(`Renamed to ${newName}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not rename ${oldName}`);
    }
  };

  const handleRenameFolder = async (dirPath: string) => {
    const node = findNode(tree, dirPath);
    if (!node || node.kind !== 'directory') return;
    const oldName = node.name;
    const newName = prompt('Rename folder:', oldName);
    if (!newName || newName === oldName) return;
    if (
      hasDirtyUnder(dirPath) &&
      !confirm('Some open files in this folder have unsaved changes that will be lost. Continue renaming?')
    ) {
      return;
    }
    try {
      const parentHandle = dirHandleOf(parentPath(dirPath));
      if (!parentHandle) return;
      await moveFolder(node.handle as FileSystemDirectoryHandle, parentHandle, newName);
      await refreshTree();
      dropFileTabsUnder(dirPath);
      flash(`Renamed to ${newName}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not rename ${oldName}`);
    }
  };

  const handleMoveEntry = async (srcPath: string, srcKind: 'file' | 'directory', destDirPath: string) => {
    if (srcPath === destDirPath) return;
    if (srcKind === 'directory' && (destDirPath === srcPath || destDirPath.startsWith(`${srcPath}/`))) {
      return flash('Cannot move a folder into itself');
    }
    if (parentPath(srcPath) === destDirPath) return; // already in that folder

    const node = findNode(tree, srcPath);
    const destHandle = dirHandleOf(destDirPath);
    if (!node || !destHandle) return;

    if (
      srcKind === 'directory' &&
      hasDirtyUnder(srcPath) &&
      !confirm('Some open files in this folder have unsaved changes that will be lost. Continue moving?')
    ) {
      return;
    }

    try {
      if (srcKind === 'file') {
        await moveFile(node.handle as FileSystemFileHandle, destHandle, node.name);
      } else {
        await moveFolder(node.handle as FileSystemDirectoryHandle, destHandle, node.name);
      }
      const newTree = await refreshTree();
      const newPath = joinPath(destDirPath, node.name);
      if (srcKind === 'file') {
        retargetFileTab(srcPath, {
          path: newPath,
          name: node.name,
          handle: findNode(newTree, newPath)?.handle as FileSystemFileHandle | undefined,
        });
      } else {
        dropFileTabsUnder(srcPath);
      }
      flash(`Moved ${node.name}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : `Could not move ${node.name}`);
    }
  };

  return {
    tree,
    dirName,
    workspace,
    setWorkspace,
    expanded,
    allFiles,
    loadTree,
    toggleDir,
    openFolder,
    reconnect,
    closeFolder,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFile,
    handleDeleteFolder,
    handleRenameFile,
    handleRenameFolder,
    handleMoveEntry,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
