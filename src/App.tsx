import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import Editor from './Editor';
import FindInFiles from './FindInFiles';
import QuickOpen from './QuickOpen';
import SettingsPanel from './SettingsPanel';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import TabBar from './components/TabBar';
import Toolbar from './components/Toolbar';
import type { Note } from './db';
import { canFormat } from './formatters';
import { useBoot } from './hooks/useBoot';
import { useFlash } from './hooks/useFlash';
import { useNotes } from './hooks/useNotes';
import { useSettings } from './hooks/useSettings';
import { useShortcuts } from './hooks/useShortcuts';
import { useTabs } from './hooks/useTabs';
import { useWorkspace } from './hooks/useWorkspace';
import { noteIdOfTab, noteTabId } from './types';
import './App.css';

const MarkdownPreview = lazy(() => import('./MarkdownPreview'));

const START_CURSOR = { line: 1, col: 1 };

export default function App() {
  const { status, flash } = useFlash();
  const { settings, setSettings, updateSettings, showSettings, setShowSettings } = useSettings();
  const notesApi = useNotes(flash);
  const tabsApi = useTabs(flash);
  const ws = useWorkspace(tabsApi, flash);

  const { active, activeId, activeFilename } = tabsApi;
  const { openNote, removeTab } = tabsApi;
  const { scheduleSave, createNote, removeNote } = notesApi;

  const [preview, setPreview] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [findFilesOpen, setFindFilesOpen] = useState(false);
  const [cursor, setCursor] = useState(START_CURSOR);

  useBoot({
    tabs: tabsApi.tabs,
    activeId,
    refreshNotes: notesApi.refreshNotes,
    openNote,
    loadTree: ws.loadTree,
    setWorkspace: ws.setWorkspace,
    setSettings,
    setTabs: tabsApi.setTabs,
    setActiveId: tabsApi.setActiveId,
  });

  // Each tab mounts a fresh editor at the top, so drop the previous tab's position.
  useEffect(() => setCursor(START_CURSOR), [activeId]);

  const closeOverlays = useCallback(() => {
    setPaletteOpen(false);
    setFindFilesOpen(false);
  }, []);
  const openQuickOpen = useCallback(() => setPaletteOpen(true), []);
  const openFindInFiles = useCallback(() => setFindFilesOpen(true), []);

  useShortcuts({
    hasFiles: ws.allFiles.length > 0,
    onSave: tabsApi.saveActive,
    onFormat: tabsApi.formatActive,
    onQuickOpen: openQuickOpen,
    onFindInFiles: openFindInFiles,
    onEscape: closeOverlays,
  });

  const onBodyChange = (value: string) => {
    if (!active) return;
    tabsApi.setActiveBody(value);
    if (active.kind === 'note') scheduleSave(noteIdOfTab(active), { body: value });
  };

  const renameNote = (value: string) => {
    if (!active || active.kind !== 'note') return;
    tabsApi.renameActiveNote(value);
    scheduleSave(noteIdOfTab(active), { title: value });
  };

  const handleCreateNote = async () => openNote(await createNote());

  const handleDeleteNote = async (note: Note) => {
    if (!confirm(`Delete "${note.title}"?`)) return;
    await removeNote(note.id);
    removeTab(noteTabId(note.id));
  };

  const onCursor = useCallback((line: number, col: number) => setCursor({ line, col }), []);

  const isMarkdown = /\.(md|markdown)$/i.test(activeFilename);
  const showPreview = preview && isMarkdown;
  const activePath = active?.kind === 'file' ? (active.path ?? null) : null;

  return (
    <div className="app">
      <Sidebar
        ws={ws}
        notes={notesApi.notes}
        activeId={activeId}
        activePath={activePath}
        onOpenFile={tabsApi.openFile}
        onOpenNote={openNote}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onExportNotes={notesApi.exportNotes}
        onImportNotes={notesApi.importNotes}
        onToggleSettings={() => setShowSettings((v) => !v)}
      />

      <main className="main">
        <TabBar tabs={tabsApi.tabs} activeId={activeId} onSelect={tabsApi.setActiveId} onClose={tabsApi.closeTab} />

        {active ? (
          <>
            <Toolbar
              tab={active}
              isMarkdown={isMarkdown}
              previewOn={preview}
              formattable={canFormat(activeFilename)}
              onRename={renameNote}
              onTogglePreview={() => setPreview((p) => !p)}
              onFormat={tabsApi.formatActive}
              onSave={tabsApi.saveActive}
            />

            <div className={showPreview ? 'panes' : 'panes single'}>
              <div className="pane editor">
                <Editor
                  key={active.id}
                  filename={activeFilename}
                  value={active.body}
                  wrap={isMarkdown}
                  dark={settings.theme !== 'light'}
                  gotoLine={tabsApi.gotoLine}
                  onChange={onBodyChange}
                  onCursor={onCursor}
                />
              </div>
              {showPreview && (
                <div className="pane preview markdown">
                  <Suspense fallback={null}>
                    <MarkdownPreview body={active.body} />
                  </Suspense>
                </div>
              )}
            </div>

            <StatusBar filename={activeFilename} cursor={cursor} dirty={active.dirty} status={status} />
          </>
        ) : (
          <div className="blank">
            <p>No file open</p>
            <p className="hint">Open a folder, pick a note, press ⌘P to jump to a file, or ⌘⇧F to find in files</p>
          </div>
        )}
      </main>

      {paletteOpen && (
        <QuickOpen
          files={ws.allFiles}
          onPick={(node) => {
            setPaletteOpen(false);
            tabsApi.openFile(node);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {findFilesOpen && (
        <FindInFiles
          files={ws.allFiles}
          onPick={(node, line) => {
            setFindFilesOpen(false);
            tabsApi.openFileAtLine(node, line);
          }}
          onClose={() => setFindFilesOpen(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} onChange={updateSettings} />
      )}
    </div>
  );
}
