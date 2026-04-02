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

export interface DocTab {
  id: string;
  title: string;
  content: string;
  savedContent: string;
  filePath: string | null;
}

const DEFAULT_CONTENT = "";

let tabCounter = 1;

function createNewTab(): DocTab {
  const id = `untitled-${Date.now()}-${tabCounter}`;
  const title = `Untitled-${tabCounter}.md`;
  tabCounter++;
  return { id, title, content: DEFAULT_CONTENT, savedContent: DEFAULT_CONTENT, filePath: null };
}

function isModified(tab: DocTab): boolean {
  return tab.content !== tab.savedContent;
}

function App() {
  const [tabs, setTabs] = useState<DocTab[]>(() => [createNewTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [mode, setMode] = useState<EditorMode>("raw");
  const [cursorInfo, setCursorInfo] = useState<CursorInfo>({ line: 1, column: 1, wordCount: 0 });
  const [settings, setSettings] = useState<EditorSettings>(loadSettings);

  const editorManagerRef = useRef(new EditorManager());
  const milkdownManagerRef = useRef(new MilkdownManager());

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const handleContentChange = useCallback((tabId: string, value: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, content: value } : t))
    );
  }, []);

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

  // Apply settings to EditorManager on mount
  useEffect(() => {
    editorManagerRef.current.setSettings(settings);
    editorManagerRef.current.updateSettings(settings);
  }, [settings]);

  // --- File Operations ---

  const handleNew = useCallback(() => {
    const tab = createNewTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleOpen = useCallback(async () => {
    const result = await openFile();
    if (!result) return;

    const existing = tabsRef.current.find((t) => t.filePath === result.path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    const current = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (current && !current.filePath && !isModified(current) && current.content === DEFAULT_CONTENT) {
      editorManagerRef.current.setContent(current.id, result.content);
      setTabs((prev) =>
        prev.map((t) =>
          t.id === current.id
            ? { ...t, title: result.name, content: result.content, savedContent: result.content, filePath: result.path }
            : t
        )
      );
      return;
    }

    const tab: DocTab = {
      id: `file-${Date.now()}`,
      title: result.name,
      content: result.content,
      savedContent: result.content,
      filePath: result.path,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleSave = useCallback(async () => {
    const current = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (!current) return;

    if (current.filePath) {
      const ok = await saveFile(current.filePath, current.content);
      if (ok) {
        setTabs((prev) =>
          prev.map((t) => (t.id === current.id ? { ...t, savedContent: t.content } : t))
        );
      }
    } else {
      await handleSaveAs();
    }
  }, []);

  const handleSaveAs = useCallback(async () => {
    const current = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    if (!current) return;

    const path = await saveFileAs(current.content, current.title);
    if (path) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === current.id
            ? { ...t, filePath: path, title: basename(path), savedContent: t.content }
            : t
        )
      );
    }
  }, []);

  const handleCloseTab = useCallback(async (id: string) => {
    const currentTabs = tabsRef.current;
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

    if (currentTabs.length <= 1) {
      const tab = createNewTab();
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }

    const idx = currentTabs.findIndex((t) => t.id === id);
    const next = currentTabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabIdRef.current === id) {
      setActiveTabId(next[Math.min(idx, next.length - 1)].id);
    }
  }, []);

  // --- Window close handler ---

  useEffect(() => {
    if (isTauri) {
      // Tauri: intercept window close to check for unsaved changes
      let unlisten: (() => void) | null = null;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        appWindow.onCloseRequested(async (event) => {
          const unsavedTabs = tabsRef.current.filter(isModified);
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
      // Browser: use beforeunload
      const handler = (e: BeforeUnloadEvent) => {
        const hasUnsaved = tabsRef.current.some(isModified);
        if (hasUnsaved) {
          e.preventDefault();
        }
      };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, []);

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

              const existing = tabsRef.current.find((t) => t.filePath === path);
              if (existing) {
                setActiveTabId(existing.id);
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
                setTabs((prev) => [...prev, tab]);
                setActiveTabId(tab.id);
              } catch {
                // ignore unreadable files
              }
            }
          }
        }).then((fn) => { unlisten = fn; });
      });
      return () => { unlisten?.(); };
    } else {
      // Browser: handle native file drop on the window
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
          setTabs((prev) => [...prev, tab]);
          setActiveTabId(tab.id);
        }
      };
      window.addEventListener("dragover", handleDragOver);
      window.addEventListener("drop", handleDrop);
      return () => {
        window.removeEventListener("dragover", handleDragOver);
        window.removeEventListener("drop", handleDrop);
      };
    }
  }, []);

  // --- Open files from OS (double-click, second instance, file association) ---

  useEffect(() => {
    if (!isTauri) return;

    let unlisten: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<string[]>("open-files", async (event) => {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        for (const path of event.payload) {
          const existing = tabsRef.current.find((t) => t.filePath === path);
          if (existing) {
            setActiveTabId(existing.id);
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
            setTabs((prev) => [...prev, tab]);
            setActiveTabId(tab.id);
          } catch {
            // ignore unreadable files
          }
        }
      }).then((fn) => { unlisten = fn; });
    });

    return () => { unlisten?.(); };
  }, []);

  // --- Keyboard Shortcuts ---

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "n") {
        e.preventDefault();
        handleNew();
      } else if (ctrl && e.key === "o") {
        e.preventDefault();
        handleOpen();
      } else if (ctrl && e.shiftKey && e.key === "S") {
        e.preventDefault();
        handleSaveAs();
      } else if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (ctrl && e.key === "w") {
        e.preventDefault();
        handleCloseTab(activeTabIdRef.current);
      } else if (ctrl && e.key === "e") {
        e.preventDefault();
        handleToggleMode();
      } else if (ctrl && e.altKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        handleToggleWrap();
      } else if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        handleFontSizeUp();
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        handleFontSizeDown();
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        handleFontSizeReset();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleCloseTab, handleToggleMode,
      handleToggleWrap, handleFontSizeUp, handleFontSizeDown, handleFontSizeReset]);

  const getActiveView = useCallback(
    () => editorManagerRef.current.getActiveView(),
    []
  );

  const menuActions = {
    onNew: handleNew,
    onOpen: handleOpen,
    onSave: handleSave,
    onSaveAs: handleSaveAs,
    onCloseTab: () => handleCloseTab(activeTabIdRef.current),
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
        onSelectTab={setActiveTabId}
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
    </div>
  );
}

export default App;
