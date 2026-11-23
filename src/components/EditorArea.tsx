import { useEffect, useRef, useState } from "react";
import { EditorManager, type CursorInfo } from "../editor/EditorManager";
import { MilkdownManager } from "../editor/MilkdownManager";

export type EditorMode = "raw" | "visual";

interface EditorAreaProps {
  activeTabId: string;
  initialContent: string;
  /** The active tab's language id (see editor/language.ts). */
  languageId: string;
  /** The mode to show: always "raw" for languages without a visual mode. */
  mode: EditorMode;
  onChange: (tabId: string, value: string) => void;
  onCursorChange: (info: CursorInfo) => void;
  editorManagerRef: React.MutableRefObject<EditorManager>;
  milkdownManagerRef: React.MutableRefObject<MilkdownManager>;
  /** --- SLEEK: rendered above the editor containers (e.g. the empty-tab overlay). */
  overlay?: React.ReactNode;
}

export default function EditorArea({
  activeTabId,
  initialContent,
  languageId,
  mode,
  onChange,
  onCursorChange,
  editorManagerRef,
  milkdownManagerRef,
  overlay,
}: EditorAreaProps) {
  const cmContainerRef = useRef<HTMLDivElement>(null);
  const mdContainerRef = useRef<HTMLDivElement>(null);

  const prevModeRef = useRef(mode);
  const prevTabIdRef = useRef(activeTabId);

  // --- SLEEK: mode-toggle crossfade. Bumped only when `modeChanged` below is
  // true (a rare user action, not per-keystroke) — a fresh key remounts the
  // overlay div so its CSS animation restarts.
  const [modeFadeKey, setModeFadeKey] = useState(0);

  // Attach managers on mount
  useEffect(() => {
    const cmMgr = editorManagerRef.current;
    const mdMgr = milkdownManagerRef.current;
    if (cmContainerRef.current) cmMgr.attach(cmContainerRef.current);
    if (mdContainerRef.current) mdMgr.attach(mdContainerRef.current);
    return () => {
      cmMgr.detach();
      mdMgr.detach();
    };
  }, [editorManagerRef, milkdownManagerRef]);

  // Keep callbacks current
  useEffect(() => {
    editorManagerRef.current.setOnChange(onChange);
    milkdownManagerRef.current.setOnChange(onChange);
  }, [onChange, editorManagerRef, milkdownManagerRef]);

  useEffect(() => {
    editorManagerRef.current.setOnCursorChange(onCursorChange);
    milkdownManagerRef.current.setOnCursorChange(onCursorChange);
  }, [onCursorChange, editorManagerRef, milkdownManagerRef]);

  // Handle mode switching and tab switching
  useEffect(() => {
    const prevMode = prevModeRef.current;
    const prevTab = prevTabIdRef.current;
    prevModeRef.current = mode;
    prevTabIdRef.current = activeTabId;

    const cmMgr = editorManagerRef.current;
    const mdMgr = milkdownManagerRef.current;

    const modeChanged = prevMode !== mode && prevTab === activeTabId;

    // Never write `initialContent` into an existing editor here: it is the store's copy,
    // which trails the editor by the content-sync debounce, so writing it back erases
    // keystrokes typed since the sync. Loads into an open tab go through the managers
    // directly (App's loadIntoTab).
    if (mode === "raw") {
      // Activate CodeMirror
      if (modeChanged) {
        // visual → raw: sync content from Milkdown to CM
        // Uses getContentForRawSync to avoid false "modified" from normalization
        const markdown = mdMgr.getContentForRawSync(activeTabId) ?? initialContent;
        cmMgr.setContent(activeTabId, markdown);
      }
      cmMgr.activate(activeTabId, initialContent, languageId);
    } else {
      // Activate Milkdown — get the freshest content from CM
      const content = modeChanged
        ? (cmMgr.getContent(activeTabId) ?? initialContent)
        : initialContent;

      // Milkdown activate is async — it shows the wrapper first, then creates
      // the editor. On first activation for a tab, it creates with `content`.
      // On subsequent activations with same tab, the editor already exists.
      (async () => {
        if (modeChanged && mdMgr.getMarkdown(activeTabId) !== undefined) {
          // Editor exists but content changed — recreate with fresh content
          await mdMgr.setContent(activeTabId, content);
        }
        await mdMgr.activate(activeTabId, content);
      })();
    }

    // --- SLEEK: crossfade the newly-shown container on a mode switch only.
    if (modeChanged) setModeFadeKey((k) => k + 1);
    // languageId is deliberately not a dependency: it matters only when activate() creates an
    // editor; a change on an existing one goes through the effect below.
  }, [activeTabId, initialContent, mode, editorManagerRef, milkdownManagerRef]);

  // A language change on the shown tab (override, or Save As to another extension).
  // A tab switch needs nothing: activate() creates editors with their language.
  const prevLanguageRef = useRef({ tabId: activeTabId, languageId });
  useEffect(() => {
    const prev = prevLanguageRef.current;
    prevLanguageRef.current = { tabId: activeTabId, languageId };
    if (prev.tabId === activeTabId && prev.languageId !== languageId) {
      void editorManagerRef.current.setLanguage(activeTabId, languageId);
    }
  }, [activeTabId, languageId, editorManagerRef]);

  return (
    <div className="flex-1 overflow-hidden relative">
      {/* CodeMirror container (raw mode) */}
      <div
        ref={cmContainerRef}
        className="h-full w-full absolute inset-0"
        style={{ display: mode === "raw" ? "block" : "none" }}
      />
      {/* Milkdown container (visual mode) */}
      <div
        ref={mdContainerRef}
        className="h-full w-full absolute inset-0 overflow-auto"
        style={{ display: mode === "visual" ? "block" : "none" }}
      />
      {/* --- SLEEK: mode-toggle crossfade scrim — remounted via key, never touches the editor containers above */}
      {modeFadeKey > 0 && (
        <div key={modeFadeKey} className="mode-fade-overlay absolute inset-0 bg-bg-primary pointer-events-none" />
      )}
      {overlay}
    </div>
  );
}
