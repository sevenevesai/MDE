import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import TitleBar from "./components/TitleBar";
import TabBar from "./components/TabBar";
import EditorArea, { type EditorMode } from "./components/EditorArea";
import Toolbar from "./components/Toolbar";
import StatusBar from "./components/StatusBar";
import { EditorManager, type CursorInfo } from "./editor/EditorManager";
import { MilkdownManager } from "./editor/MilkdownManager";
import {
  openFiles, readFile, readIfPermitted, saveFile, saveFileAs, basename, confirmUnsaved,
  filesFromDrop, onLaunchFiles, canSaveInPlace, type FileResult,
} from "./fileOps.platform";
import { errorMessage } from "./fileOps.types";
import { isTauri } from "./platform";
import { loadSettings, saveSettings, FONT_SIZE_MIN, FONT_SIZE_MAX, type EditorSettings, loadRecentFiles, addRecentFile, clearRecentFiles } from "./settings";
import { useToast, ToastContainer } from "./components/Toast";
import CommandPalette from "./components/CommandPalette";
import type { PaletteCommand } from "./commandPalette";
import {
  useDocumentStore, createNewTab, isModified, adjacentTabId, tabFromFile, tabLanguage, fromDisk,
  type DocTab, type DiskText,
} from "./store/documentStore";
import { handleShortcuts, type Shortcut } from "./shortcuts";
import { copyHtml, exportHtml } from "./export";
import { buildCopyForAI, cleanAIText, fenceInfoFor } from "./aiTools";
import { toggleCheckbox, formatTableAtCursor } from "./editor/commands";
import { trimTrailingWhitespace, countMarkdownHardBreaks } from "./editor/textCommands";
import { isMarkdownLanguage, languageLabel } from "./editor/language";
import { languageChoices } from "./languageChoices";
import { toLf, withEol } from "./lineEndings";
import { saveSession, loadSession } from "./session";
import { decideReload, pathKey, FileWatcherManager } from "./fileWatcher";
import { checkForUpdates } from "./updater";
import { planOpen, readPaths, failureToast, skippedMessage } from "./openPlan";
import { pushClosed, popClosed, type ClosedTab } from "./closedTabs";
import {
  buildMenus, buildPalette, checkedCommands, commandLabel, isEditorCommand, EDITOR_COMMANDS,
  type AppCommandId, type CommandId, type CommandTarget,
} from "./commandCatalog";
import { indentLabel } from "./statusText";
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

import DiscordNudge from "./components/DiscordNudge";
import { DISCORD_APP_URL, openDiscord } from "./discordNudge";

const DESKTOP_DOWNLOAD_URL = "https://seveneves.ai/mde/";

/** Shown when a browser save had no file handle and fell back to a download. */
function downloadNotice(name: string): string {
  // Browsers without a save picker download on Save As too, so linking is not an option there.
  const canLink = "showSaveFilePicker" in window;
  return `Downloaded a copy of "${name}". This tab is not linked to a file on disk${canLink ? " — use Save As to link it." : "."}`;
}

type PaletteView = "commands" | "language" | "indent";

function App() {
  const { state, dispatch, getState, activeTab } = useDocumentStore();
  const { tabs, activeTabId } = state;

  const [mode, setMode] = useState<EditorMode>("raw");
  const [palette, setPalette] = useState<PaletteView | null>(null);
  const [cursorInfo, setCursorInfo] = useState<CursorInfo>({ line: 1, column: 1, wordCount: 0, charCount: 0, selectionCount: 1, selectionLength: 0 });
  const [settings, setSettings] = useState<EditorSettings>(loadSettings);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const { toasts, showToast, dismissToast } = useToast();

  // Visual mode exists only for markdown; other languages always show raw, without
  // touching the user's mode preference.
  const { languageOverride: activeOverride, filePath: activeFilePath, title: activeTitle } = activeTab;
  // Memoized: App re-renders on every cursor move, and detection scans the language list.
  const activeLanguage = useMemo(
    () => tabLanguage({ languageOverride: activeOverride, filePath: activeFilePath, title: activeTitle }),
    [activeOverride, activeFilePath, activeTitle],
  );
  const activeIsMarkdown = isMarkdownLanguage(activeLanguage);
  const effectiveMode: EditorMode = activeIsMarkdown ? mode : "raw";
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** The active tab, whether it is markdown, and whether CodeMirror is the editor showing it. */
  const activeContext = useCallback(() => {
    const s = getState();
    const tab = s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0];
    const markdown = isMarkdownLanguage(tabLanguage(tab));
    return { tab, markdown, raw: !markdown || modeRef.current === "raw" };
  }, [getState]);

  const trackRecent = useCallback(async (path: string) => {
    try {
      // Browser: only files with a stored handle can be reopened from the list.
      if (isTauri || (await canSaveInPlace(path))) setRecentFiles(addRecentFile(path));
    } catch (err) {
      console.warn(`Could not add "${path}" to recent files:`, err);
    }
  }, []);

  const editorManagerRef = useRef(new EditorManager());
  const milkdownManagerRef = useRef(new MilkdownManager());

  const handleContentChange = useCallback((tabId: string, value: string) => {
    dispatch({ type: "UPDATE_CONTENT", tabId, content: value });
  }, [dispatch]);

  const handleToggleMode = useCallback(() => {
    const { tab, markdown } = activeContext();
    if (!markdown) {
      showToast(`Visual mode is for Markdown files — "${tab.title}" is ${languageLabel(tabLanguage(tab))}`, "info", undefined, "visual-mode");
      return;
    }
    setMode((prev) => (prev === "raw" ? "visual" : "raw"));
  }, [activeContext, showToast]);

  useEffect(() => {
    const mgr = editorManagerRef.current;
    mgr.setOnLanguageError((_tabId, languageId, err) => {
      showToast(`Could not load ${languageLabel(languageId)} highlighting: ${errorMessage(err)}`, "error", undefined, `language:${languageId}`);
    });
    return () => mgr.setOnLanguageError(null);
  }, [showToast]);

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

  // --- RAWNAV --- outline sidebar (markdown tabs in raw mode only)

  const [outline, setOutline] = useState<OutlineItem[]>([]);

  const handleToggleOutline = useCallback(() => {
    const next = !settings.showOutline;
    updateSettings({ showOutline: next });
    const { markdown, raw } = activeContext();
    if (next && !(markdown && raw)) {
      showToast("The outline shows for Markdown files in raw mode", "info");
    }
  }, [settings.showOutline, updateSettings, activeContext, showToast]);

  const handleOutlineJump = useCallback((item: OutlineItem) => {
    editorManagerRef.current.jumpTo(item.from);
  }, []);

  // Subscribing emits the current outline; unsubscribing stops the manager
  // computing it at all, so a hidden sidebar costs nothing on the stats path.
  // Markdown only: a `#` line in Python or YAML is a comment, not a heading.
  const outlineVisible = settings.showOutline && activeIsMarkdown && effectiveMode === "raw";
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

  // --- External file changes: auto-reload clean tabs, flag conflicts ---

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

  /** Replace a tab's text with file text as its clean, saved state. */
  const loadIntoTab = useCallback((tabId: string, name: string, path: string, text: DiskText) => {
    // Managers first, then dispatch, so EditorArea's external-load detection sees
    // editors already in sync and does no extra work.
    editorManagerRef.current.setContent(tabId, text.content);
    void milkdownManagerRef.current.setContent(tabId, text.content);
    dispatch({ type: "LOAD_FILE", tabId, name, path, text });
    clearConflict(tabId);
  }, [dispatch, clearConflict]);

  const applyDiskReload = useCallback((tab: DocTab, text: DiskText) => {
    if (tab.filePath) loadIntoTab(tab.id, tab.title, tab.filePath, text);
  }, [loadIntoTab]);

  /**
   * Freshest buffer text. CodeMirror leads the store by its 100ms debounce, but
   * only while it is the editor showing the tab: in visual mode Milkdown is live
   * and CodeMirror holds a stale copy.
   */
  const liveContent = useCallback((tab: DocTab): string => {
    const { tab: active, raw } = activeContext();
    if (tab.id !== active.id || !raw) return tab.content;
    return editorManagerRef.current.getContent(tab.id) ?? tab.content;
  }, [activeContext]);

  const reconcileFile = useCallback(async (path: string) => {
    const key = pathKey(path);
    const isAffected = (t: DocTab) => t.filePath !== null && pathKey(t.filePath) === key;
    if (!getState().tabs.some(isAffected)) return;

    // null: deleted, unreadable, or (browser) not readable without a prompt. Keep
    // the buffer; a later save recreates the file.
    const raw = await readIfPermitted(path);
    if (raw === null) return;
    const disk = fromDisk(raw);

    for (const tab of getState().tabs.filter(isAffected)) {
      // Live editor text, so keystrokes racing an external write become a
      // conflict instead of being silently reloaded over.
      const decision = decideReload(disk.content, { content: liveContent(tab), savedContent: tab.savedContent });

      if (decision === "reload") {
        applyDiskReload(tab, disk);
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
  }, [getState, applyDiskReload, clearConflict, showToast, liveContent]);

  const reconcileRef = useRef(reconcileFile);
  reconcileRef.current = reconcileFile;

  // Desktop: watch the folders of open files.
  const watchedPathsKey = tabs.map((t) => t.filePath).filter(Boolean).sort().join("\n");
  useEffect(() => {
    if (!isTauri) return;
    const mgr = (fileWatcherRef.current ??= new FileWatcherManager((p) => void reconcileRef.current(p)));
    void mgr.sync(getState().tabs.map((t) => t.filePath).filter((p): p is string => p !== null));
  }, [watchedPathsKey, getState]);

  useEffect(() => () => { fileWatcherRef.current?.dispose(); }, []);

  // Browser: no watcher exists, so re-check open files whenever the user comes back to the app.
  useEffect(() => {
    if (isTauri) return;
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const paths = new Set(getState().tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
        await Promise.all([...paths].map((p) => reconcileRef.current(p)));
      } finally {
        running = false;
      }
    };
    const onReturn = () => void check();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [getState]);

  // Take the tab id explicitly: the full-window diff can outlive a tab switch,
  // so "the active tab" is not necessarily the one the user was looking at.
  const handleConflictReload = useCallback(async (tabId: string) => {
    const tab = getState().tabs.find((t) => t.id === tabId);
    if (!tab?.filePath) return;
    try {
      const file = await readFile(tab.filePath);
      applyDiskReload(tab, fromDisk(file.content));
      showToast(`"${tab.title}" reloaded from disk`, "info");
    } catch (err) {
      showToast(`Failed to reload: ${errorMessage(err)}`, "error");
    }
  }, [getState, applyDiskReload, showToast]);

  const handleConflictKeep = useCallback((tabId: string) => {
    clearConflict(tabId);
    showToast("Keeping your version — saving will overwrite the file on disk", "info");
  }, [clearConflict, showToast]);

  // --- DIFFWATCH: diff overlay (buffer vs disk / vs last save) ---

  const [diff, setDiff] = useState<{ tabId: string; mode: DiffMode; title: string; left: string; right: string } | null>(null);

  const closeDiff = useCallback(() => setDiff(null), []);

  const handleDiffUnsaved = useCallback(() => {
    const { tab } = activeContext();
    setDiff({ tabId: tab.id, mode: "unsaved", title: tab.title, left: tab.savedContent, right: liveContent(tab) });
  }, [activeContext, liveContent]);

  const handleDiffConflict = useCallback(async () => {
    const { tab } = activeContext();
    if (!tab.filePath) return;
    try {
      const file = await readFile(tab.filePath);
      setDiff({ tabId: tab.id, mode: "conflict", title: tab.title, left: toLf(file.content), right: liveContent(tab) });
    } catch (err) {
      // Overlay stays closed — a diff against nothing would be a lie.
      showToast(`Failed to read file for diff: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, liveContent, showToast]);

  const handleDiffError = useCallback((message: string) => {
    setDiff(null);
    showToast(message, "error");
  }, [showToast]);

  // --- /DIFFWATCH ---

  // --- SLEEK: idle auto-save to disk (desktop, and browser files with a handle) ---

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
      eol: t.eol,
      savedEol: t.savedEol,
    }));
    const targets = selectAutoSaveTargets(candidates, conflictsRef.current, settingsRef.current.autoSave);
    for (const target of targets) {
      const toastKey = `autosave:${pathKey(target.filePath)}`;
      try {
        // Never auto-save by download: a browser tab without a file handle is skipped.
        if (!(await canSaveInPlace(target.filePath))) continue;
        const ok = await saveFile(target.filePath, withEol(target.content, target.eol));
        if (ok) {
          dispatch({ type: "MARK_SAVED", tabId: target.id, content: target.content, eol: target.eol });
        } else {
          const hint = isTauri ? "" : " — save it once with Ctrl+S to allow writing";
          showToast(`Auto-save failed for "${basename(target.filePath)}"${hint}`, "error", undefined, toastKey);
        }
      } catch (err) {
        showToast(`Auto-save failed: ${errorMessage(err)}`, "error", undefined, toastKey);
      }
    }
  }, [getState, liveContent, dispatch, showToast]);

  // Piggybacks on the existing 100ms content-sync debounce (handleContentChange
  // already only fires post-debounce) — this just resets one timer, no
  // per-keystroke work of its own.
  const scheduleAutoSave = useCallback(() => {
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
    // reconcile as a live change, after React commits the restored tabs.
    setTimeout(() => {
      for (const t of session.tabs) {
        if (t.filePath) void reconcileRef.current(t.filePath);
      }
    }, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave the session every 10s (crash safety).
  useEffect(() => {
    const interval = setInterval(() => {
      const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
      saveSession(currentTabs, currentActiveId);
    }, 10_000);
    return () => clearInterval(interval);
  }, [getState]);

  // --- Opening documents: every entry point funnels into openDocuments ---

  const openDocuments = useCallback((files: readonly FileResult[], failures: readonly string[] = []) => {
    const { tabs: currentTabs, activeTabId: currentActiveId } = getState();
    let focusId: string | null = null;
    for (const step of planOpen(currentTabs, currentActiveId, files, { refreshOpen: !isTauri })) {
      switch (step.kind) {
        case "focus":
          focusId = step.tabId;
          break;
        case "focus-dirty":
          focusId = step.tabId;
          showToast(`"${step.title}" is already open with unsaved changes — showing your version`, "info");
          break;
        case "refresh":
        case "reuse":
          loadIntoTab(step.tabId, step.file.name, step.file.path, fromDisk(step.file.content));
          focusId = step.tabId;
          break;
        case "add": {
          const tab = tabFromFile(step.file);
          dispatch({ type: "ADD_TAB", tab });
          focusId = tab.id;
          break;
        }
      }
    }
    if (focusId) dispatch({ type: "SET_ACTIVE", id: focusId });
    for (const file of files) void trackRecent(file.path);
    const failureText = failureToast(failures);
    if (failureText) showToast(failureText, "error", undefined, "open-failures");
  }, [getState, dispatch, loadIntoTab, showToast, trackRecent]);

  const openDocumentsRef = useRef(openDocuments);
  openDocumentsRef.current = openDocuments;

  /** Desktop paths (drop, OS launch): read each, report the unreadable ones. */
  const openPaths = useCallback(async (paths: readonly string[]) => {
    const { files, failures } = await readPaths(paths, readFile);
    openDocumentsRef.current(files, failures);
  }, []);

  const handleNew = useCallback(() => {
    dispatch({ type: "ADD_TAB", tab: createNewTab() });
  }, [dispatch]);

  const handleOpen = useCallback(async () => {
    try {
      const { files, skipped } = await openFiles();
      openDocuments(files, skipped.map(skippedMessage));
    } catch (err) {
      showToast(`Failed to open file: ${errorMessage(err)}`, "error");
    }
  }, [openDocuments, showToast]);

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      // Browser: may ask for permission, which is why this runs straight from the click.
      openDocuments([await readFile(path)]);
    } catch (err) {
      showToast(errorMessage(err), "error");
    }
  }, [openDocuments, showToast]);

  const handleClearRecent = useCallback(() => {
    clearRecentFiles();
    setRecentFiles([]);
  }, []);

  // --- Saving ---

  const handleSaveAs = useCallback(async () => {
    const { tab: current } = activeContext();
    try {
      const path = await saveFileAs(withEol(current.content, current.eol), current.title);
      if (!path) return;
      void trackRecent(path);
      dispatch({
        type: "REPLACE_TAB",
        tabId: current.id,
        patch: {
          filePath: path,
          title: basename(path),
          savedContent: current.content,
          savedEol: current.eol,
          // The new name decides the language, as when a different file is loaded.
          languageOverride: path === current.filePath ? current.languageOverride : null,
        },
      });
      if (!(await canSaveInPlace(path))) showToast(downloadNotice(basename(path)), "info");
    } catch (err) {
      showToast(`Failed to save: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, dispatch, showToast, trackRecent]);

  const handleSave = useCallback(async () => {
    const { tab: current } = activeContext();
    if (!current.filePath) {
      await handleSaveAs();
      return;
    }
    try {
      const inPlace = await canSaveInPlace(current.filePath);
      const ok = await saveFile(current.filePath, withEol(current.content, current.eol));
      if (!ok) {
        showToast(`Failed to save "${current.title}"`, "error");
        return;
      }
      dispatch({ type: "MARK_SAVED", tabId: current.id, content: current.content, eol: current.eol });
      if (!inPlace) showToast(downloadNotice(current.title), "info");
    } catch (err) {
      showToast(`Failed to save: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, dispatch, showToast, handleSaveAs]);

  // --- Closing and reopening tabs ---

  const closedTabsRef = useRef<readonly ClosedTab[]>([]);

  /** Resolves true when the tab was closed, false when the user cancelled or the save failed. */
  const handleCloseTab = useCallback(async (id: string): Promise<boolean> => {
    const target = getState().tabs.find((t) => t.id === id);
    if (!target) return false;
    let closing = target;

    if (isModified(target)) {
      const action = await confirmUnsaved(target.title);
      if (action === "cancel") return false;
      if (action === "save") {
        const text = withEol(target.content, target.eol);
        try {
          if (target.filePath) {
            if (!(await saveFile(target.filePath, text))) {
              showToast(`Failed to save "${target.title}" — tab left open`, "error");
              return false;
            }
          } else {
            const path = await saveFileAs(text, target.title);
            if (!path) return false;
            closing = { ...closing, filePath: path, title: basename(path) };
          }
        } catch (err) {
          showToast(`Failed to save "${target.title}" — tab left open: ${errorMessage(err)}`, "error");
          return false;
        }
        closing = { ...closing, savedContent: target.content, savedEol: target.eol };
      }
    }

    closedTabsRef.current = pushClosed(closedTabsRef.current, closing);
    editorManagerRef.current.removeEditor(id);
    milkdownManagerRef.current.removeEditor(id);
    clearConflict(id);
    dispatch({ type: "REMOVE_TAB", id });
    return true;
  }, [dispatch, getState, clearConflict, showToast]);

  const handleCloseOthers = useCallback(async (keepId: string) => {
    dispatch({ type: "SET_ACTIVE", id: keepId });
    for (const t of getState().tabs) {
      if (t.id !== keepId && !(await handleCloseTab(t.id))) return;
    }
  }, [dispatch, getState, handleCloseTab]);

  const handleReopenClosed = useCallback(() => {
    const popped = popClosed(closedTabsRef.current);
    if (!popped) {
      showToast("No closed tabs to reopen", "info");
      return;
    }
    closedTabsRef.current = popped.rest;
    const { tab } = popped;
    const open = tab.filePath === null ? undefined : getState().tabs.find((t) => t.filePath === tab.filePath);
    if (open) {
      dispatch({ type: "SET_ACTIVE", id: open.id });
      showToast(`"${open.title}" is already open`, "info");
      return;
    }
    dispatch({ type: "ADD_TAB", tab: { ...tab, id: `reopened-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } });
    // The file may have changed since the tab was closed.
    const path = tab.filePath;
    if (path) setTimeout(() => void reconcileRef.current(path), 0);
  }, [dispatch, getState, showToast]);

  const handleCopyPath = useCallback(async (id: string) => {
    const tab = getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (!tab.filePath) {
      showToast(`"${tab.title}" is unsaved — no path to copy`, "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(tab.filePath);
      showToast("Path copied", "info");
    } catch (err) {
      showToast(`Copy failed: ${errorMessage(err)}`, "error");
    }
  }, [getState, showToast]);

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
        // The dirty prompt stays even though file handles survive a reload
        // (IndexedDB): write permission usually does not, and a cleared or
        // private-mode store loses the handles too, so a restored dirty tab may
        // not be able to save back to its file.
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

  // --- Browser tab title ---

  const activeModified = isModified(activeTab);
  useEffect(() => {
    if (isTauri) return;
    document.title = `${activeModified ? "● " : ""}${activeTab.title} — MDE`;
  }, [activeTab.title, activeModified]);

  // --- Drag-and-drop file open ---

  useEffect(() => {
    if (isTauri) {
      let unlisten: (() => void) | null = null;
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === "drop") void openPaths(event.payload.paths);
        }).then((fn) => { unlisten = fn; });
      });
      return () => { unlisten?.(); };
    } else {
      const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
      const handleDrop = (e: DragEvent) => {
        e.preventDefault();
        if (!e.dataTransfer) return;
        // Synchronously: drop data is readable only while the event dispatches.
        filesFromDrop(e.dataTransfer).then(
          ({ files, skipped }) => openDocumentsRef.current(files, skipped.map(skippedMessage)),
          (err: unknown) => showToast(errorMessage(err), "error"),
        );
      };
      window.addEventListener("dragover", handleDragOver);
      window.addEventListener("drop", handleDrop);
      return () => {
        window.removeEventListener("dragover", handleDragOver);
        window.removeEventListener("drop", handleDrop);
      };
    }
  }, [openPaths, showToast]);

  // --- Open files from the OS (double-click, second instance, file association, PWA launch) ---

  useEffect(() => {
    if (!isTauri) {
      onLaunchFiles((batch) => openDocumentsRef.current(batch.files, batch.skipped.map(skippedMessage)));
      return;
    }

    let unlisten: (() => void) | null = null;

    import("@tauri-apps/api/event").then(async ({ listen, emit }) => {
      unlisten = await listen<string[]>("open-files", (event) => void openPaths(event.payload));
      await emit("frontend-ready");
    });

    return () => { unlisten?.(); };
  }, [openPaths]);

  // --- Auto-update: silent check a few seconds after startup (never blocks launch) ---

  useEffect(() => {
    if (!isTauri) return;
    const id = setTimeout(() => {
      void checkForUpdates(showToast, { silent: true });
    }, 4000);
    return () => clearTimeout(id);
  }, [showToast]);

  // --- Editor commands ---

  /**
   * Run `fn` on the active CodeMirror view and hand focus back to the editor
   * unless the command focused its own panel (find, go to line). Visual mode
   * shows Milkdown, where CodeMirror commands cannot act.
   */
  const withRawEditor = useCallback((label: string, fn: (view: EditorView, markdown: boolean) => void) => {
    const view = editorManagerRef.current.getActiveView();
    if (!view) return;
    const { raw, markdown } = activeContext();
    if (!raw) {
      showToast(`${label.replace(/…$/, "")} works in raw mode — press Ctrl+E to switch`, "info", undefined, "raw-only");
      return;
    }
    fn(view, markdown);
    if (!view.dom.contains(document.activeElement)) view.focus();
  }, [activeContext, showToast]);

  const handleTrimTrailing = useCallback(() => {
    withRawEditor("Trim Trailing Whitespace", (view, markdown) => {
      const hardBreaks = markdown ? countMarkdownHardBreaks(view.state.doc) : 0;
      if (!trimTrailingWhitespace(view)) {
        showToast("No trailing whitespace to trim", "info");
      } else if (hardBreaks > 0) {
        const s = hardBreaks === 1 ? "" : "s";
        showToast(`Trimmed trailing whitespace, including ${hardBreaks} Markdown line break${s} (two trailing spaces). Ctrl+Z restores them.`, "info");
      }
    });
  }, [withRawEditor, showToast]);

  const handleCleanPaste = useCallback(() => {
    withRawEditor("Clean AI Paste", (view) => {
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
    });
  }, [withRawEditor, showToast]);

  const handleFormatTable = useCallback(() => {
    withRawEditor("Format Table", (view) => {
      if (!formatTableAtCursor(view)) showToast("Cursor is not in a table", "info");
    });
  }, [withRawEditor, showToast]);

  const handleCopyForAI = useCallback(async () => {
    const { tab } = activeContext();
    try {
      const payload = buildCopyForAI(tab.filePath ?? tab.title, liveContent(tab), fenceInfoFor(tabLanguage(tab)));
      await navigator.clipboard.writeText(payload);
      showToast("Copied for AI", "info");
    } catch (err) {
      showToast(`Failed to copy: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, liveContent, showToast]);

  const handleCopyHtml = useCallback(async () => {
    try {
      await copyHtml(liveContent(activeContext().tab));
      showToast("HTML copied to clipboard", "info");
    } catch (err) {
      showToast(`Failed to copy: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, liveContent, showToast]);

  const handleExportHtml = useCallback(async () => {
    const { tab } = activeContext();
    try {
      await exportHtml(liveContent(tab), tab.title);
    } catch (err) {
      showToast(`Failed to export: ${errorMessage(err)}`, "error");
    }
  }, [activeContext, liveContent, showToast]);

  const handleToggleEol = useCallback(() => {
    const { tab } = activeContext();
    dispatch({ type: "SET_EOL", tabId: tab.id, eol: tab.eol === "crlf" ? "lf" : "crlf" });
  }, [activeContext, dispatch]);

  const modalOpenRef = useRef(false);
  modalOpenRef.current = palette !== null || diff !== null;

  const switchTab = useCallback((delta: number) => {
    // A modal surface is up: switching tabs underneath it is invisible (diff)
    // or steals focus from its input (palette).
    if (modalOpenRef.current) return;
    const s = getState();
    dispatch({ type: "SET_ACTIVE", id: adjacentTabId(s.tabs, s.activeTabId, delta) });
  }, [dispatch, getState]);

  // --- Command dispatch: menus, palette and shortcuts all run commands by id ---

  const appCommands: Record<AppCommandId, () => void> = {
    "file.new": handleNew,
    "file.open": () => void handleOpen(),
    "file.reopenClosed": handleReopenClosed,
    "file.save": () => void handleSave(),
    "file.saveAs": () => void handleSaveAs(),
    "file.autoSave": handleToggleAutoSave,
    "file.exportHtml": () => void handleExportHtml(),
    "file.closeTab": () => void handleCloseTab(getState().activeTabId),
    "file.clearRecent": handleClearRecent,
    "file.toggleEol": handleToggleEol,
    "edit.trimTrailing": handleTrimTrailing,
    "edit.toggleCheckbox": () => withRawEditor("Toggle Checkbox", (view) => { toggleCheckbox(view); }),
    "edit.formatTable": handleFormatTable,
    "edit.copyHtml": () => void handleCopyHtml(),
    "edit.copyForAI": () => void handleCopyForAI(),
    "edit.cleanPaste": handleCleanPaste,
    "view.palette": () => setPalette((p) => (p === "commands" ? null : "commands")),
    "view.language": () => setPalette("language"),
    "view.toggleMode": handleToggleMode,
    "view.outline": handleToggleOutline,
    "view.diffUnsaved": handleDiffUnsaved,
    "view.wordWrap": handleToggleWrap,
    "view.whitespace": () => updateSettings({ showWhitespace: !settings.showWhitespace }),
    "view.indent2": () => updateSettings({ indentSize: 2, indentWithTabs: false }),
    "view.indent4": () => updateSettings({ indentSize: 4, indentWithTabs: false }),
    "view.indent8": () => updateSettings({ indentSize: 8, indentWithTabs: false }),
    "view.indentTabs": () => updateSettings({ indentWithTabs: true }),
    "view.fontUp": handleFontSizeUp,
    "view.fontDown": handleFontSizeDown,
    "view.fontReset": handleFontSizeReset,
    "view.nextTab": () => switchTab(1),
    "view.prevTab": () => switchTab(-1),
    "help.updates": () => void checkForUpdates(showToast, { silent: false }),
    "help.download": () => { window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener"); },
    "help.discord": () => { openDiscord(DISCORD_APP_URL).catch(() => showToast("Could not open the Discord link.", "error")); },
  };
  const appCommandsRef = useRef(appCommands);
  appCommandsRef.current = appCommands;

  const runCommand = useCallback((id: CommandId) => {
    if (isEditorCommand(id)) {
      const command = EDITOR_COMMANDS[id];
      withRawEditor(commandLabel(id), (view) => { command(view); });
    } else {
      appCommandsRef.current[id]();
    }
  }, [withRawEditor]);

  const runTarget = useCallback((target: CommandTarget) => {
    if (target.kind === "command") runCommand(target.id);
    else void handleOpenRecent(target.path);
  }, [runCommand, handleOpenRecent]);

  // --- Command Palette ---

  const handlePaletteClose = useCallback(() => {
    setPalette(null);
    // The palette input stole focus — hand it back to the editor.
    editorManagerRef.current.getActiveView()?.focus();
  }, []);

  // --- Keyboard Shortcuts (data-driven registry) ---
  // Chords CodeMirror binds itself (Ctrl+F, Ctrl+D, Alt+↑ …) are not repeated here.

  useEffect(() => {
    const on = (id: CommandId) => () => runCommand(id);
    const shortcuts: Shortcut[] = [
      { key: "k", ctrl: true, action: on("view.palette") },
      { key: "n", ctrl: true, action: on("file.new") },
      { key: "o", ctrl: true, action: on("file.open") },
      { key: "S", ctrl: true, shift: true, action: on("file.saveAs") },
      { key: "s", ctrl: true, action: on("file.save") },
      { key: "w", ctrl: true, action: on("file.closeTab") },
      { key: "T", ctrl: true, shift: true, action: on("file.reopenClosed") },
      { key: "h", ctrl: true, action: on("edit.replace") },
      { key: "e", ctrl: true, action: on("view.toggleMode") },
      { key: "A", ctrl: true, shift: true, action: on("edit.copyForAI") },
      { key: "w", ctrl: true, alt: true, action: on("view.wordWrap") },
      { key: "W", ctrl: true, alt: true, action: on("view.wordWrap") },
      { key: "=", ctrl: true, action: on("view.fontUp") },
      { key: "+", ctrl: true, action: on("view.fontUp") },
      { key: "-", ctrl: true, action: on("view.fontDown") },
      { key: "0", ctrl: true, action: on("view.fontReset") },
      { key: "Tab", ctrl: true, action: on("view.nextTab") },
      { key: "Tab", ctrl: true, shift: true, action: on("view.prevTab") },
      { key: "PageDown", ctrl: true, action: on("view.nextTab") },
      { key: "PageUp", ctrl: true, action: on("view.prevTab") },
      // --- DIFFWATCH --- (Ctrl+Shift+D: free in this registry and in the CM6 keymap)
      { key: "D", ctrl: true, shift: true, action: on("view.diffUnsaved") },
      // --- /DIFFWATCH ---
      // --- RAWNAV ---
      { key: "O", ctrl: true, shift: true, action: on("view.outline") },
      // --- /RAWNAV ---
      // A normal browser tab cannot intercept Ctrl+N/W/T/Tab/PageUp/PageDown; these
      // alternates are the labels commandCatalog shows in the browser build.
      ...(isTauri ? [] : [
        { key: "KeyN", physical: true, alt: true, action: on("file.new") },
        { key: "KeyW", physical: true, alt: true, action: on("file.closeTab") },
        { key: "KeyT", physical: true, alt: true, shift: true, action: on("file.reopenClosed") },
        { key: "PageDown", physical: true, alt: true, action: on("view.nextTab") },
        { key: "PageUp", physical: true, alt: true, action: on("view.prevTab") },
      ]),
    ];

    const handler = (e: KeyboardEvent) => handleShortcuts(shortcuts, e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [runCommand]);

  const getActiveView = useCallback(
    () => editorManagerRef.current.getActiveView(),
    []
  );

  // --- Menus and palette, built from the command catalog ---

  const commandContext = useMemo(() => ({
    tauri: isTauri,
    markdown: activeIsMarkdown,
    hasFile: canDiffUnsaved({ filePath: activeFilePath }),
    checked: checkedCommands(settings),
  }), [activeIsMarkdown, activeFilePath, settings]);

  const menus = useMemo(() => buildMenus(commandContext, recentFiles), [commandContext, recentFiles]);

  const paletteCommands = ((): PaletteCommand[] => {
    if (palette === "commands") {
      return buildPalette(commandContext, recentFiles).map((entry) => ({
        id: entry.key,
        title: entry.title,
        shortcut: entry.shortcut,
        action: () => runTarget(entry.target),
      }));
    }
    if (palette === "language") {
      return languageChoices(activeTab).map((choice) => ({
        id: `lang:${choice.key}`,
        title: choice.title,
        detail: choice.current ? "current" : undefined,
        action: () => dispatch({ type: "SET_LANGUAGE", tabId: activeTab.id, languageOverride: choice.override }),
      }));
    }
    if (palette === "indent") {
      const choices: CommandId[] = ["view.indent2", "view.indent4", "view.indent8", "view.indentTabs"];
      return choices.map((id) => ({
        id,
        title: commandLabel(id),
        detail: commandContext.checked.has(id) ? "current" : undefined,
        action: () => runCommand(id),
      }));
    }
    return [];
  })();

  const palettePlaceholder =
    palette === "language" ? "Select a language…" : palette === "indent" ? "Select indentation…" : "Type a command…";

  // --- SLEEK ---
  const showEmptyState = shouldShowEmptyState(activeTab);
  // --- /SLEEK ---

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
      <TitleBar filePath={activeTab.filePath} title={activeTab.title} menu={{ menus, onSelect: runTarget }} />
      <TabBar
        tabs={tabs.map((t) => ({ ...t, modified: isModified(t) }))}
        activeTabId={activeTabId}
        onSelectTab={(id) => dispatch({ type: "SET_ACTIVE", id })}
        onCloseTab={handleCloseTab}
        onNewTab={handleNew}
        onMoveTab={(id, toIndex) => dispatch({ type: "MOVE_TAB", id, toIndex })}
        onCloseOthers={handleCloseOthers}
        onCopyPath={handleCopyPath}
      />
      {effectiveMode === "raw" && activeIsMarkdown && <Toolbar getView={getActiveView} />}
      {conflicts.has(activeTab.id) && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/40 border-b border-yellow-700/60 text-xs text-text-primary">
          <span className="flex-1 truncate">
            "{activeTab.title}" changed on disk — you also have unsaved edits.
          </span>
          <button
            onClick={() => void handleConflictReload(activeTab.id)}
            className="shrink-0 px-2 py-0.5 rounded border border-yellow-700/60 hover:bg-bg-hover transition-colors"
          >
            Reload from disk
          </button>
          <button
            onClick={() => handleConflictKeep(activeTab.id)}
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
          languageId={activeLanguage}
          mode={effectiveMode}
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
        cursor={cursorInfo}
        languageLabel={languageLabel(activeLanguage)}
        onPickLanguage={() => setPalette("language")}
        eol={activeTab.eol}
        onToggleEol={handleToggleEol}
        indentLabel={indentLabel(settings)}
        onPickIndent={() => setPalette("indent")}
        mode={activeIsMarkdown ? effectiveMode : null}
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
          onTakeDisk={() => void handleConflictReload(diff.tabId)}
          onKeepMine={() => handleConflictKeep(diff.tabId)}
          onError={handleDiffError}
        />
      )}
      {/* --- /DIFFWATCH --- */}
      <CommandPalette
        key={palette ?? "closed"}
        open={palette !== null}
        commands={paletteCommands}
        onClose={handlePaletteClose}
        placeholder={palettePlaceholder}
      />
      <DiscordNudge onError={(text) => showToast(text, "error")} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
