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
import { loadSettings, saveSettings, FONT_SIZE_MIN, FONT_SIZE_MAX, type EditorSettings, loadRecentFiles, addRecentFile, clearRecentFiles } from "./settings";
import { useToast, ToastContainer } from "./components/Toast";
import CommandPalette from "./components/CommandPalette";
import type { PaletteCommand } from "./commandPalette";
import { useDocumentStore, createNewTab, isModified, DEFAULT_CONTENT, type DocTab } from "./store/documentStore";
import { handleShortcuts, type Shortcut } from "./shortcuts";
import { copyHtml, exportHtml } from "./export";
import { buildCopyForAI, cleanAIText } from "./aiTools";
import { toggleCheckbox, formatTableAtCursor } from "./editor/commands";
import { saveSession, loadSession } from "./session";
import { decideReload, pathKey, FileWatcherManager } from "./fileWatcher";
import { checkForUpdates } from "./updater";
// --- DIFFWATCH ---
import DiffOverlay from "./components/DiffOverlay";
import { canDiffUnsaved, type DiffMode } from "./editor/diffView";
// --- /DIFFWATCH ---
// --- RAWNAV ---
import OutlineSidebar from "./components/OutlineSidebar";
import type { OutlineItem } from "./outline";
// --- /RAWNAV ---
// --- SLEEK ---
import EmptyState from "./components/EmptyState";
import { shouldShowEmptyState } from "./emptyState";
import { selectAutoSaveTargets } from "./autosave";
// --- /SLEEK ---

function App() {
  const { state, dispatch, getState, activeTab } = useDocumentStore();
  const { tabs, activeTabId } = state;

  const [mode, setMode] = useState<EditorMode>("raw");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo>({ line: 1, column: 1, wordCount: 0, charCount: 0 });
  const [settings, setSettings] = useState<EditorSettings>(loadSettings);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const { toasts, showToast, dismissToast } = useToast();

  const trackRecent = useCallback((path: string | null) => {
    if (path && isTauri) setRecentFiles(addRecentFile(path));
  }, []);

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

  // --- SLEEK ---
  const handleToggleAutoSave = useCallback(() => {
    updateSettings({ autoSave: !settings.autoSave });
  }, [settings.autoSave, updateSettings]);
  // --- /SLEEK ---

  useEffect(() => {
    editorManagerRef.current.setSettings(settings);
    editorManagerRef.current.updateSettings(settings);
  }, [settings]);

  // --- RAWNAV --- outline sidebar (raw mode only)

  const [outline, setOutline] = useState<OutlineItem[]>([]);

  const handleToggleOutline = useCallback(() => {
    const next = !settings.showOutline;
    updateSettings({ showOutline: next });
    if (next && mode === "visual") {
      showToast("Outline is available in raw mode", "info");
    }
  }, [settings.showOutline, updateSettings, mode, showToast]);

  const handleOutlineJump = useCallback((item: OutlineItem) => {
    editorManagerRef.current.jumpTo(item.from);
  }, []);

  // Subscribing emits the current outline; unsubscribing stops the manager
  // computing it at all, so a hidden sidebar costs nothing on the stats path.
  const outlineVisible = settings.showOutline && mode === "raw";
  useEffect(() => {
    const mgr = editorManagerRef.current;
    if (!outlineVisible) {
      mgr.setOnOutlineChange(null);
      setOutline([]);
      return;
    }
    mgr.setOnOutlineChange(setOutline);
    return () => mgr.setOnOutlineChange(null);
  }, [outlineVisible, activeTabId]);

  // --- /RAWNAV ---

  // --- External file changes (desktop): auto-reload clean tabs, flag conflicts ---

  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const conflictToastedRef = useRef(new Set<string>());
  const fileWatcherRef = useRef<FileWatcherManager | null>(null);

  const clearConflict = useCallback((tabId: string) => {
    conflictToastedRef.current.delete(tabId);
    setConflicts((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const applyDiskReload = useCallback((tab: DocTab, diskContent: string) => {
    // Managers first, then dispatch — same order as handleOpen, so EditorArea's
    // external-load detection sees editors already in sync and does no extra work.
    editorManagerRef.current.setContent(tab.id, diskContent);
    void milkdownManagerRef.current.setContent(tab.id, diskContent);
    dispatch({ type: "REPLACE_TAB", tabId: tab.id, patch: { content: diskContent, savedContent: diskContent } });
    clearConflict(tab.id);
  }, [dispatch, clearConflict]);

  const reconcileFile = useCallback(async (path: string) => {
    const key = pathKey(path);
    const affected = getState().tabs.filter((t) => t.filePath && pathKey(t.filePath) === key);
    if (affected.length === 0) return;

    let diskContent: string;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      diskContent = await readTextFile(path);
    } catch {
      // Deleted or unreadable: keep the buffer; a later save recreates the file.
      return;
    }

    for (const tab of affected) {
      // The store lags CodeMirror by a 100ms debounce — consult the live editor
      // content when the store looks clean, so keystrokes racing an external
      // write become a conflict instead of being silently reloaded over.
      const cmContent = editorManagerRef.current.getContent(tab.id);
      const content = isModified(tab) ? tab.content : (cmContent ?? tab.content);
      const decision = decideReload(diskContent, { content, savedContent: tab.savedContent });

      if (decision === "reload") {
        applyDiskReload(tab, diskContent);
        // --- DIFFWATCH: keyed per file so an agent rewriting it repeatedly
        // replaces the live toast instead of stacking a new one each time. ---
        showToast(`"${tab.title}" reloaded — file changed on disk`, "info", undefined, `reload:${key}`);
      } else if (decision === "conflict") {
        if (!conflictToastedRef.current.has(tab.id)) {
          conflictToastedRef.current.add(tab.id);
          showToast(`"${tab.title}" changed on disk and has unsaved edits`, "error");
        }
        setConflicts((prev) => (prev.has(tab.id) ? prev : new Set(prev).add(tab.id)));
      } else {
        // Disk went back to the saved baseline — any earlier conflict is moot.
        clearConflict(tab.id);
      }
    }
  }, [getState, applyDiskReload, clearConflict, showToast]);

  const reconcileRef = useRef(reconcileFile);
  reconcileRef.current = reconcileFile;

  const watchedPathsKey = tabs.map((t) => t.filePath).filter(Boolean).sort().join("\n");
  useEffect(() => {
    if (!isTauri) return;
    const mgr = (fileWatcherRef.current ??= new FileWatcherManager((p) => void reconcileRef.current(p)));
    void mgr.sync(getState().tabs.map((t) => t.filePath).filter((p): p is string => p !== null));
  }, [watchedPathsKey, getState]);

  useEffect(() => () => { fileWatcherRef.current?.dispose(); }, []);

  const handleConflictReload = useCallback(async () => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    const tab = currentTabs.find((t) => t.id === currentActiveId);
    if (!tab?.filePath) return;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const diskContent = await readTextFile(tab.filePath);
      applyDiskReload(tab, diskContent);
      showToast(`"${tab.title}" reloaded from disk`, "info");
    } catch (err) {
      showToast(`Failed to reload: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [getState, applyDiskReload, showToast]);

  const handleConflictKeep = useCallback(() => {
    clearConflict(getState().activeTabId);
    showToast("Keeping your version — saving will overwrite the file on disk", "info");
  }, [getState, clearConflict]);

  // --- DIFFWATCH: diff overlay (buffer vs disk / vs last save) ---

  const [diff, setDiff] = useState<{ mode: DiffMode; title: string; left: string; right: string } | null>(null);

  const closeDiff = useCallback(() => setDiff(null), []);

  /** Freshest buffer text: the store lags CodeMirror by the 100ms debounce. */
  const liveContent = useCallback((tab: DocTab) => {
    return editorManagerRef.current.getContent(tab.id) ?? tab.content;
  }, []);

  const handleDiffUnsaved = useCallback(() => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    const tab = currentTabs.find((t) => t.id === currentActiveId);
    if (!tab) return;
    setDiff({ mode: "unsaved", title: tab.title, left: tab.savedContent, right: liveContent(tab) });
  }, [getState, liveContent]);

  const handleDiffConflict = useCallback(async () => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    const tab = currentTabs.find((t) => t.id === currentActiveId);
    if (!tab?.filePath) return;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const diskContent = await readTextFile(tab.filePath);
      setDiff({ mode: "conflict", title: tab.title, left: diskContent, right: liveContent(tab) });
    } catch (err) {
      // Overlay stays closed — a diff against nothing would be a lie.
      showToast(`Failed to read file for diff: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [getState, liveContent, showToast]);

  const handleDiffError = useCallback((message: string) => {
    setDiff(null);
    showToast(message, "error");
  }, [showToast]);

  // --- /DIFFWATCH ---

  // --- SLEEK: idle auto-save to disk (Tauri only) ---

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAutoSave = useCallback(async () => {
    const { tabs: currentTabs } = getState();
    const candidates = currentTabs.map((t) => ({
      id: t.id,
      filePath: t.filePath,
      content: liveContent(t),
      savedContent: t.savedContent,
    }));
    const targets = selectAutoSaveTargets(candidates, conflictsRef.current, settingsRef.current.autoSave);
    for (const target of targets) {
      try {
        const ok = await saveFile(target.filePath, target.content);
        if (ok) {
          dispatch({ type: "MARK_SAVED", tabId: target.id });
        } else {
          showToast(`Auto-save failed for "${basename(target.filePath)}"`, "error", undefined, `autosave:${pathKey(target.filePath)}`);
        }
      } catch (err) {
        showToast(`Auto-save failed: ${err instanceof Error ? err.message : String(err)}`, "error", undefined, `autosave:${pathKey(target.filePath)}`);
      }
    }
  }, [getState, liveContent, dispatch, showToast]);

  // Piggybacks on the existing 100ms content-sync debounce (handleContentChange
  // already only fires post-debounce) — this just resets one timer, no
  // per-keystroke work of its own.
  const scheduleAutoSave = useCallback(() => {
    if (!isTauri) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!settingsRef.current.autoSave) return;
    autoSaveTimerRef.current = setTimeout(() => { void runAutoSave(); }, 1500);
  }, [runAutoSave]);

  // Toggling auto-save off cancels any pending save immediately.
  useEffect(() => {
    if (!settings.autoSave && autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, [settings.autoSave]);

  useEffect(() => () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
  }, []);

  const handleEditorContentChange = useCallback((tabId: string, value: string) => {
    handleContentChange(tabId, value);
    scheduleAutoSave();
  }, [handleContentChange, scheduleAutoSave]);

  // --- /SLEEK ---

  // --- Session persistence (hot exit) ---

  // On mount: restore the previous session's tabs — no prompts. Covers both
  // clean exit (exact snapshot) and crash (last 10s autosave).
  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    dispatch({ type: "SET_TABS", tabs: session.tabs });
    const active = session.tabs.some((t) => t.id === session.activeTabId)
      ? session.activeTabId
      : session.tabs[0].id;
    dispatch({ type: "SET_ACTIVE", id: active });

    // Files may have changed on disk while the app was closed — run the same
    // reconcile as a live watch event, after React commits the restored tabs.
    if (isTauri) {
      setTimeout(() => {
        for (const t of session.tabs) {
          if (t.filePath) void reconcileRef.current(t.filePath);
        }
      }, 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the session every 10s (crash safety).
  useEffect(() => {
    const interval = setInterval(() => {
      const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
      saveSession(currentTabs, currentActiveId);
    }, 10_000);
    return () => clearInterval(interval);
  }, [getState]);

  // --- File Operations ---

  const handleNew = useCallback(() => {
    dispatch({ type: "ADD_TAB", tab: createNewTab() });
  }, [dispatch]);

  const handleOpen = useCallback(async () => {
    try {
      const result = await openFile();
      if (!result) return;
      trackRecent(result.path);

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
  }, [dispatch, getState, showToast, trackRecent]);

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
        trackRecent(path);
        dispatch({
          type: "REPLACE_TAB",
          tabId: current.id,
          patch: { filePath: path, title: basename(path), savedContent: current.content },
        });
      }
    } catch (err) {
      showToast(`Failed to save: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [dispatch, getState, showToast, trackRecent]);

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
    clearConflict(id);
    dispatch({ type: "REMOVE_TAB", id });
  }, [dispatch, getState, clearConflict]);

  // --- Window close handler ---

  useEffect(() => {
    if (isTauri) {
      let unlisten: (() => void) | null = null;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        appWindow.onCloseRequested(() => {
          // Hot exit: persist everything, prompt for nothing. Dirty buffers
          // come back on the next launch via session restore.
          const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
          saveSession(currentTabs, currentActiveId);
        }).then((fn) => { unlisten = fn; });
      });
      return () => { unlisten?.(); };
    } else {
      const handler = (e: BeforeUnloadEvent) => {
        // Browsers can close without a final autosave tick — snapshot now.
        // The dirty prompt stays: browser file handles don't survive reload,
        // so a restored dirty tab can't save back to its original file.
        const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
        saveSession(currentTabs, currentActiveId);
        if (currentTabs.some(isModified)) {
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

  // --- Auto-update: silent check a few seconds after startup (never blocks launch) ---

  useEffect(() => {
    if (!isTauri) return;
    const id = setTimeout(() => {
      void checkForUpdates(showToast, { silent: true });
    }, 4000);
    return () => clearTimeout(id);
  }, [showToast]);

  const handleCopyForAI = useCallback(async () => {
    try {
      const payload = buildCopyForAI(activeTab.filePath ?? activeTab.title, activeTab.content);
      await navigator.clipboard.writeText(payload);
      showToast("Copied for AI", "info");
    } catch (err) {
      showToast(`Failed to copy: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab.filePath, activeTab.title, activeTab.content, showToast]);

  // --- Command Palette ---

  const handlePaletteClose = useCallback(() => {
    setPaletteOpen(false);
    // The palette input stole focus — hand it back to the editor.
    editorManagerRef.current.getActiveView()?.focus();
  }, []);

  // --- Keyboard Shortcuts (data-driven registry) ---

  useEffect(() => {
    const shortcuts: Shortcut[] = [
      { key: "k", ctrl: true, action: () => setPaletteOpen((o) => !o) },
      { key: "n", ctrl: true, action: handleNew },
      { key: "o", ctrl: true, action: handleOpen },
      { key: "S", ctrl: true, shift: true, action: handleSaveAs },
      { key: "s", ctrl: true, action: handleSave },
      { key: "w", ctrl: true, action: () => handleCloseTab(getState().activeTabId) },
      { key: "e", ctrl: true, action: handleToggleMode },
      { key: "A", ctrl: true, shift: true, action: handleCopyForAI },
      { key: "w", ctrl: true, alt: true, action: handleToggleWrap },
      { key: "W", ctrl: true, alt: true, action: handleToggleWrap },
      { key: "=", ctrl: true, action: handleFontSizeUp },
      { key: "+", ctrl: true, action: handleFontSizeUp },
      { key: "-", ctrl: true, action: handleFontSizeDown },
      { key: "0", ctrl: true, action: handleFontSizeReset },
      // --- DIFFWATCH --- (Ctrl+Shift+D: free in this registry and in the CM6 keymap)
      { key: "D", ctrl: true, shift: true, action: handleDiffUnsaved },
      // --- /DIFFWATCH ---
      // --- RAWNAV ---
      { key: "O", ctrl: true, shift: true, action: handleToggleOutline },
      // --- /RAWNAV ---
    ];

    const handler = (e: KeyboardEvent) => handleShortcuts(shortcuts, e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNew, handleOpen, handleSave, handleSaveAs, handleCloseTab, handleToggleMode,
      handleCopyForAI, handleToggleWrap, handleFontSizeUp, handleFontSizeDown,
      handleFontSizeReset, getState,
      handleDiffUnsaved /* --- DIFFWATCH --- */,
      handleToggleOutline /* RAWNAV */]);

  const getActiveView = useCallback(
    () => editorManagerRef.current.getActiveView(),
    []
  );

  const handleCopyHtml = useCallback(async () => {
    try {
      await copyHtml(activeTab.content);
      showToast("HTML copied to clipboard", "info");
    } catch (err) {
      showToast(`Failed to copy: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab.content, showToast]);

  const handleExportHtml = useCallback(async () => {
    try {
      await exportHtml(activeTab.content, activeTab.title);
    } catch (err) {
      showToast(`Failed to export: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [activeTab.content, activeTab.title, showToast]);

  const handleOpenRecent = useCallback(async (path: string) => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();

    const existing = currentTabs.find((t) => t.filePath === path);
    if (existing) {
      dispatch({ type: "SET_ACTIVE", id: existing.id });
      return;
    }

    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(path);
      const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
      trackRecent(path);

      const current = currentTabs.find((t) => t.id === currentActiveId);
      if (current && !current.filePath && !isModified(current) && current.content === DEFAULT_CONTENT) {
        editorManagerRef.current.setContent(current.id, content);
        dispatch({ type: "OPEN_FILE_INTO_CURRENT", tabId: current.id, name, content, path });
      } else {
        dispatch({ type: "ADD_TAB", tab: { id: `file-${Date.now()}`, title: name, content, savedContent: content, filePath: path } });
      }
    } catch (err) {
      showToast(`Failed to open: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [dispatch, getState, showToast, trackRecent]);

  const handleClearRecent = useCallback(() => {
    clearRecentFiles();
    setRecentFiles([]);
  }, []);

  const handleCheckUpdates = useCallback(() => {
    void checkForUpdates(showToast, { silent: false });
  }, [showToast]);

  // --- AI Tools ---

  const handleCleanPaste = useCallback(() => {
    const view = getActiveView();
    if (!view) return;
    const sel = view.state.selection.main;
    const hasSelection = sel.from !== sel.to;
    const from = hasSelection ? sel.from : 0;
    const to = hasSelection ? sel.to : view.state.doc.length;
    const { text, count } = cleanAIText(view.state.sliceDoc(from, to));
    if (count > 0) {
      view.dispatch({ changes: { from, to, insert: text } });
      showToast(`Cleaned ${count} characters`, "info");
    } else {
      showToast("Nothing to clean", "info");
    }
  }, [getActiveView, showToast]);

  const handleToggleCheckbox = useCallback(() => {
    const view = getActiveView();
    if (view) {
      toggleCheckbox(view);
      view.focus();
    }
  }, [getActiveView]);

  const handleFormatTable = useCallback(() => {
    const view = getActiveView();
    if (!view) return;
    if (formatTableAtCursor(view)) {
      view.focus();
    } else {
      showToast("Cursor is not in a table", "info");
    }
  }, [getActiveView, showToast]);

  const paletteCommands: PaletteCommand[] = [
    { id: "new", title: "File: New", shortcut: "Ctrl+N", action: handleNew },
    { id: "open", title: "File: Open…", shortcut: "Ctrl+O", action: handleOpen },
    { id: "save", title: "File: Save", shortcut: "Ctrl+S", action: handleSave },
    { id: "save-as", title: "File: Save As…", shortcut: "Ctrl+Shift+S", action: handleSaveAs },
    { id: "close-tab", title: "File: Close Tab", shortcut: "Ctrl+W", action: () => handleCloseTab(getState().activeTabId) },
    { id: "export-html", title: "File: Export HTML…", action: handleExportHtml },
    { id: "toggle-mode", title: "View: Toggle Raw/Visual Mode", shortcut: "Ctrl+E", action: handleToggleMode },
    { id: "toggle-wrap", title: "View: Toggle Word Wrap", shortcut: "Ctrl+Alt+W", action: handleToggleWrap },
    { id: "font-up", title: "View: Increase Font Size", shortcut: "Ctrl+=", action: handleFontSizeUp },
    { id: "font-down", title: "View: Decrease Font Size", shortcut: "Ctrl+-", action: handleFontSizeDown },
    { id: "font-reset", title: "View: Reset Font Size", shortcut: "Ctrl+0", action: handleFontSizeReset },
    { id: "copy-html", title: "Edit: Copy as HTML", action: handleCopyHtml },
    { id: "copy-ai", title: "AI: Copy for AI", shortcut: "Ctrl+Shift+A", action: handleCopyForAI },
    { id: "clean-paste", title: "AI: Clean AI Paste", action: handleCleanPaste },
    { id: "checkbox", title: "Edit: Toggle Checkbox", shortcut: "Ctrl+Shift+9", action: handleToggleCheckbox },
    { id: "format-table", title: "Edit: Format Table", action: handleFormatTable },
    ...(isTauri
      ? [{ id: "updates", title: "Help: Check for Updates…", action: handleCheckUpdates }]
      : []),
    ...recentFiles.map((p) => ({
      id: `recent:${p}`,
      title: `Open Recent: ${basename(p)}`,
      action: () => handleOpenRecent(p),
    })),
    // --- DIFFWATCH ---
    ...(canDiffUnsaved(activeTab)
      ? [{ id: "diff-unsaved", title: "Diff: Unsaved Changes vs Disk", shortcut: "Ctrl+Shift+D", action: handleDiffUnsaved }]
      : []),
    // --- /DIFFWATCH ---
    // --- RAWNAV ---
    { id: "toggle-outline", title: "View: Toggle Outline Sidebar (raw mode)", shortcut: "Ctrl+Shift+O", action: handleToggleOutline },
    // --- /RAWNAV ---
    // --- SLEEK ---
    ...(isTauri
      ? [{ id: "toggle-autosave", title: "Settings: Toggle Auto-Save", action: handleToggleAutoSave }]
      : []),
    // --- /SLEEK ---
  ];

  const menuActions = {
    onNew: handleNew,
    onCommandPalette: () => setPaletteOpen(true),
    onOpen: handleOpen,
    onSave: handleSave,
    onSaveAs: handleSaveAs,
    onExportHtml: handleExportHtml,
    onCloseTab: () => handleCloseTab(getState().activeTabId),
    onToggleMode: handleToggleMode,
    onToggleWrap: handleToggleWrap,
    onFontSizeUp: handleFontSizeUp,
    onFontSizeDown: handleFontSizeDown,
    onFontSizeReset: handleFontSizeReset,
    onCopyHtml: handleCopyHtml,
    onCopyForAI: handleCopyForAI,
    onCleanPaste: handleCleanPaste,
    onToggleCheckbox: handleToggleCheckbox,
    onFormatTable: handleFormatTable,
    onOpenRecent: handleOpenRecent,
    onClearRecent: handleClearRecent,
    onCheckUpdates: handleCheckUpdates,
    recentFiles,
    // --- RAWNAV ---
    onToggleOutline: handleToggleOutline,
    // --- /RAWNAV ---
    // --- SLEEK ---
    autoSave: settings.autoSave,
    onToggleAutoSave: handleToggleAutoSave,
    // --- /SLEEK ---
  };

  // --- SLEEK ---
  const showEmptyState = shouldShowEmptyState(activeTab);
  // --- /SLEEK ---

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
      {conflicts.has(activeTab.id) && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/40 border-b border-yellow-700/60 text-xs text-text-primary">
          <span className="flex-1 truncate">
            "{activeTab.title}" changed on disk — you also have unsaved edits.
          </span>
          <button
            onClick={handleConflictReload}
            className="shrink-0 px-2 py-0.5 rounded border border-yellow-700/60 hover:bg-bg-hover transition-colors"
          >
            Reload from disk
          </button>
          <button
            onClick={handleConflictKeep}
            className="shrink-0 px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            Keep my version
          </button>
          {/* --- DIFFWATCH --- */}
          <button
            onClick={handleDiffConflict}
            className="shrink-0 px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            View diff
          </button>
          {/* --- /DIFFWATCH --- */}
        </div>
      )}
      {/* --- RAWNAV --- row wrapper so the outline sidebar sits beside the editor */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <EditorArea
          activeTabId={activeTab.id}
          initialContent={activeTab.content}
          mode={mode}
          onChange={handleEditorContentChange}
          onCursorChange={setCursorInfo}
          editorManagerRef={editorManagerRef}
          milkdownManagerRef={milkdownManagerRef}
          overlay={showEmptyState && <EmptyState recentFiles={recentFiles} onOpenRecent={handleOpenRecent} />}
        />
        {outlineVisible && <OutlineSidebar items={outline} onJump={handleOutlineJump} />}
      </div>
      {/* --- /RAWNAV --- */}
      <StatusBar
        line={cursorInfo.line}
        column={cursorInfo.column}
        wordCount={cursorInfo.wordCount}
        charCount={cursorInfo.charCount}
        mode={mode}
        onToggleMode={handleToggleMode}
        wordWrap={settings.wordWrap}
        onToggleWrap={handleToggleWrap}
        fontSize={settings.fontSize}
      />
      {/* --- DIFFWATCH --- */}
      {diff && (
        <DiffOverlay
          mode={diff.mode}
          title={diff.title}
          left={diff.left}
          right={diff.right}
          onClose={closeDiff}
          onTakeDisk={handleConflictReload}
          onKeepMine={handleConflictKeep}
          onError={handleDiffError}
        />
      )}
      {/* --- /DIFFWATCH --- */}
      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={handlePaletteClose} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
