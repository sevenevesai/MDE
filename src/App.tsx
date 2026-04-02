import { useState, useCallback, useEffect, useRef } from "react";
import TitleBar from "./components/TitleBar";
import TabBar from "./components/TabBar";
import EditorArea, { type EditorMode } from "./components/EditorArea";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import { EditorManager, type CursorInfo } from "./editor/EditorManager";
import { MilkdownManager } from "./editor/MilkdownManager";
import { openFile, saveFile, saveFileAs, basename, confirmUnsaved } from "./fileOps.platform";
import { isTauri } from "./platform";
import { loadSettings, saveSettings, FONT_SIZE_MIN, FONT_SIZE_MAX, type EditorSettings } from "./settings";
import { useToast, ToastContainer } from "./components/Toast";
import { useDocumentStore, createNewTab, isModified, DEFAULT_CONTENT, type DocTab } from "./store/documentStore";
import { handleShortcuts, type Shortcut } from "./shortcuts";

function App() {
  const { state, dispatch, getState, activeTab } = useDocumentStore();
  const { tabs, activeTabId } = state;

  const [mode, setMode] = useState<EditorMode>("raw");
  const [cursorInfo, setCursorInfo] = useState<CursorInfo>({ line: 1, column: 1, wordCount: 0 });
  const [settings, setSettings] = useState<EditorSettings>(loadSettings);
  const { toasts, showToast, dismissToast } = useToast();

  const editorManagerRef = useRef(new EditorManager());
  const milkdownManagerRef = useRef(new MilkdownManager());

  const handleContentChange = useCallback((tabId: string, value: string) => {
    dispatch({ type: "UPDATE_CONTENT", tabId, content: value });
  }, [dispatch]);

  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "raw" ? "visual" : "raw"));
  }, []);

  // --- Settings ---

  const updateSettings = useCallback((patch: Partial<EditorSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      editorManagerRef.current.updateSettings(next);
      return next;
    });
  }, []);

  const handleToggleWrap = useCallback(() => {
    updateSettings({ wordWrap: !settings.wordWrap });
  }, [settings.wordWrap, updateSettings]);

  const handleFontSizeUp = useCallback(() => {
    if (settings.fontSize < FONT_SIZE_MAX) updateSettings({ fontSize: settings.fontSize + 1 });
  }, [settings.fontSize, updateSettings]);

  const handleFontSizeDown = useCallback(() => {
    if (settings.fontSize > FONT_SIZE_MIN) updateSettings({ fontSize: settings.fontSize - 1 });
  }, [settings.fontSize, updateSettings]);

  const handleFontSizeReset = useCallback(() => {
    updateSettings({ fontSize: 14 });
  }, [updateSettings]);

  useEffect(() => {
    editorManagerRef.current.setSettings(settings);
    editorManagerRef.current.updateSettings(settings);
  }, [settings]);

  // --- File Operations ---

  const handleNew = useCallback(() => {
    dispatch({ type: "ADD_TAB", tab: createNewTab() });
  }, [dispatch]);

  const handleOpen = useCallback(async () => {
    try {
      const result = await openFile();
      if (!result) return;

      const { tabs: currentTabs, activeTabId: currentActiveId } = getState();

      const existing = currentTabs.find((t) => t.filePath === result.path);
      if (existing) {
        dispatch({ type: "SET_ACTIVE", id: existing.id });
        return;
      }

      const current = currentTabs.find((t) => t.id === currentActiveId);
      if (current && !current.filePath && !isModified(current) && current.content === DEFAULT_CONTENT) {
        editorManagerRef.current.setContent(current.id, result.content);
        dispatch({
          type: "OPEN_FILE_INTO_CURRENT",
          tabId: current.id,
          name: result.name,
          content: result.content,
          path: result.path,
        });
        return;
      }

      const tab: DocTab = {
        id: `file-${Date.now()}`,
        title: result.name,
        content: result.content,
        savedContent: result.content,
        filePath: result.path,
      };
      dispatch({ type: "ADD_TAB", tab });
    } catch (err) {
      showToast(`Failed to open file: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [dispatch, getState, showToast]);

  const handleSave = useCallback(async () => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    const current = currentTabs.find((t) => t.id === currentActiveId);
    if (!current) return;

    try {
      if (current.filePath) {
        const ok = await saveFile(current.filePath, current.content);
        if (ok) {
          dispatch({ type: "MARK_SAVED", tabId: current.id });
        } else {
          showToast(`Failed to save "${current.title}"`, "error");
        }
      } else {
        await handleSaveAs();
      }
    } catch (err) {
      showToast(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [dispatch, getState, showToast]);

  const handleSaveAs = useCallback(async () => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    const current = currentTabs.find((t) => t.id === currentActiveId);
    if (!current) return;

    try {
      const path = await saveFileAs(current.content, current.title);
      if (path) {
        dispatch({
          type: "REPLACE_TAB",
          tabId: current.id,
          patch: { filePath: path, title: basename(path), savedContent: current.content },
        });
      }
    } catch (err) {
      showToast(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [dispatch, getState, showToast]);

  const handleCloseTab = useCallback(async (id: string) => {
    const { tabs: currentTabs } = getState();
    const target = currentTabs.find((t) => t.id === id);

    if (target && isModified(target)) {
      const action = await confirmUnsaved(target.title);
      if (action === "save") {
        if (target.filePath) {
          await saveFile(target.filePath, target.content);
        } else {
          const path = await saveFileAs(target.content, target.title);
          if (!path) return;
        }
      }
    }

    editorManagerRef.current.removeEditor(id);
    milkdownManagerRef.current.removeEditor(id);
    dispatch({ type: "REMOVE_TAB", id });
  }, [dispatch, getState]);

  // --- Window close handler ---

  useEffect(() => {
    if (isTauri) {
      let unlisten: (() => void) | null = null;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        appWindow.onCloseRequested(async (event) => {
          const unsavedTabs = getState().tabs.filter(isModified);
          if (unsavedTabs.length === 0) return;

          event.preventDefault();

          for (const tab of unsavedTabs) {
            const action = await confirmUnsaved(tab.title);
            if (action === "save") {
              if (tab.filePath) {
                await saveFile(tab.filePath, tab.content);
              } else {
                const path = await saveFileAs(tab.content, tab.title);
                if (!path) return;
              }
            }
          }

          await appWindow.destroy();
        }).then((fn) => { unlisten = fn; });
      });
      return () => { unlisten?.(); };
    } else {
      const handler = (e: BeforeUnloadEvent) => {
        if (getState().tabs.some(isModified)) {
          e.preventDefault();
        }
      };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [getState]);

  // --- Drag-and-drop file open ---

  useEffect(() => {
    if (isTauri) {
      let unlisten: (() => void) | null = null;
      Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/plugin-fs"),
      ]).then(([{ getCurrentWindow }, { readTextFile }]) => {
        const appWindow = getCurrentWindow();
        appWindow.onDragDropEvent(async (event) => {
          if (event.payload.type === "drop") {
            for (const path of event.payload.paths) {
              if (!path.match(/\.(md|markdown|mdx|txt|text)$/i)) continue;

              const existing = getState().tabs.find((t) => t.filePath === path);
              if (existing) {
                dispatch({ type: "SET_ACTIVE", id: existing.id });
                continue;
              }

              try {
                const content = await readTextFile(path);
                const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
                const tab: DocTab = {
                  id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  title: name,
                  content,
                  savedContent: content,
                  filePath: path,
                };
                dispatch({ type: "ADD_TAB", tab });
              } catch {
                // ignore unreadable files
              }
            }
          }
        }).then((fn) => { unlisten = fn; });
      });
      return () => { unlisten?.(); };
    } else {
      const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
      const handleDrop = async (e: DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (!files) return;
        for (const file of Array.from(files)) {
          if (!file.name.match(/\.(md|markdown|mdx|txt|text)$/i)) continue;
          const content = await file.text();
          const tab: DocTab = {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: file.name,
            content,
            savedContent: content,
            filePath: file.name,
          };
          dispatch({ type: "ADD_TAB", tab });
        }
      };
      window.addEventListener("dragover", handleDragOver);
      window.addEventListener("drop", handleDrop);
      return () => {
        window.removeEventListener("dragover", handleDragOver);
        window.removeEventListener("drop", handleDrop);
      };
    }
  }, [dispatch, getState]);

  // --- Open files from OS (double-click, second instance, file association) ---

  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    import("@tauri-apps/api/event").then(async ({ listen, emit }) => {
      unlisten = await listen<string[]>("open-files", async (event) => {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        for (const path of event.payload) {
          const { tabs: currentTabs } = getState();
          const existing = currentTabs.find((t) => t.filePath === path);
          if (existing) {
            dispatch({ type: "SET_ACTIVE", id: existing.id });
            continue;
          }

          try {
            const content = await readTextFile(path);
            const name = path.replace(/\\/g, "/").split("/").pop() ?? path;

            const singleEmpty = currentTabs.length === 1
              && !currentTabs[0].filePath
              && currentTabs[0].content === DEFAULT_CONTENT;

            if (singleEmpty) {
              const replaceId = currentTabs[0].id;
              editorManagerRef.current.setContent(replaceId, content);
              dispatch({
                type: "SET_TABS",
                tabs: [{ ...currentTabs[0], title: name, content, savedContent: content, filePath: path }],
              });
              dispatch({ type: "SET_ACTIVE", id: replaceId });
            } else {
              const tab: DocTab = {
                id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: name,
                content,
                savedContent: content,
                filePath: path,
              };
              dispatch({ type: "ADD_TAB", tab });
            }
          } catch {
            // ignore unreadable files
          }
        }
      });

      await emit("frontend-ready");
    });

    return () => { unlisten?.(); };
  }, [dispatch, getState]);

  // --- Keyboard Shortcuts (data-driven registry) ---

  useEffect(() => {
    const shortcuts: Shortcut[] = [
      { key: "n", ctrl: true, action: handleNew },
      { key: "o", ctrl: true, action: handleOpen },
      { key: "S", ctrl: true, shift: true, action: handleSaveAs },
      { key: "s", ctrl: true, action: handleSave },
      { key: "w", ctrl: true, action: () => handleCloseTab(getState().activeTabId) },
      { key: "e", ctrl: true, action: handleToggleMode },
      { key: "w", ctrl: true, alt: true, action: handleToggleWrap },
      { key: "W", ctrl: true, alt: true, action: handleToggleWrap },
      { key: "=", ctrl: true, action: handleFontSizeUp },
      { key: "+", ctrl: true, action: handleFontSizeUp },
      { key: "-", ctrl: true, action: handleFontSizeDown },
      { key: "0", ctrl: true, action: handleFontSizeReset },
    ];

    const handler = (e: KeyboardEvent) => handleShortcuts(shortcuts, e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleCloseTab, handleToggleMode,
      handleToggleWrap, handleFontSizeUp, handleFontSizeDown, handleFontSizeReset, getState]);

  const getActiveView = useCallback(
    () => editorManagerRef.current.getActiveView(),
    []
  );

  const menuActions = {
    onNew: handleNew,
    onOpen: handleOpen,
    onSave: handleSave,
    onSaveAs: handleSaveAs,
    onCloseTab: () => handleCloseTab(getState().activeTabId),
    onToggleMode: handleToggleMode,
    onToggleWrap: handleToggleWrap,
    onFontSizeUp: handleFontSizeUp,
    onFontSizeDown: handleFontSizeDown,
    onFontSizeReset: handleFontSizeReset,
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <TitleBar filePath={activeTab.filePath} title={activeTab.title} menuActions={menuActions} />
      <TabBar
        tabs={tabs.map((t) => ({ ...t, modified: isModified(t) }))}
        activeTabId={activeTabId}
        onSelectTab={(id) => dispatch({ type: "SET_ACTIVE", id })}
        onCloseTab={handleCloseTab}
      />
      {mode === "raw" && <Toolbar getView={getActiveView} />}
      <EditorArea
        activeTabId={activeTab.id}
        initialContent={activeTab.content}
        mode={mode}
        onChange={handleContentChange}
        onCursorChange={setCursorInfo}
        editorManagerRef={editorManagerRef}
        milkdownManagerRef={milkdownManagerRef}
      />
      <StatusBar
        line={cursorInfo.line}
        column={cursorInfo.column}
        wordCount={cursorInfo.wordCount}
        mode={mode}
        onToggleMode={handleToggleMode}
        wordWrap={settings.wordWrap}
        onToggleWrap={handleToggleWrap}
        fontSize={settings.fontSize}
      />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
