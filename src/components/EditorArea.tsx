import { useEffect, useRef } from "react";
import { EditorManager, type CursorInfo } from "../editor/EditorManager";
import { MilkdownManager } from "../editor/MilkdownManager";

export type EditorMode = "raw" | "visual";

interface EditorAreaProps {
  activeTabId: string;
  initialContent: string;
  mode: EditorMode;
  onChange: (tabId: string, value: string) => void;
  onCursorChange: (info: CursorInfo) => void;
  editorManagerRef: React.MutableRefObject<EditorManager>;
  milkdownManagerRef: React.MutableRefObject<MilkdownManager>;
}

export default function EditorArea({
  activeTabId,
  initialContent,
  mode,
  onChange,
  onCursorChange,
  editorManagerRef,
  milkdownManagerRef,
}: EditorAreaProps) {
  const cmContainerRef = useRef<HTMLDivElement>(null);
  const mdContainerRef = useRef<HTMLDivElement>(null);

  const prevModeRef = useRef(mode);
  const prevTabIdRef = useRef(activeTabId);
  const prevContentRef = useRef(initialContent);

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
    const prevContent = prevContentRef.current;
    prevModeRef.current = mode;
    prevTabIdRef.current = activeTabId;
    prevContentRef.current = initialContent;

    const cmMgr = editorManagerRef.current;
    const mdMgr = milkdownManagerRef.current;

    const modeChanged = prevMode !== mode && prevTab === activeTabId;
    // Detect external content load (file opened into existing tab)
    const contentLoadedExternally = prevTab === activeTabId && !modeChanged
      && prevContent !== initialContent
      && initialContent !== (cmMgr.getContent(activeTabId) ?? "");

    if (mode === "raw") {
      // Activate CodeMirror
      if (modeChanged) {
        // visual → raw: sync content from Milkdown to CM
        // Uses getContentForRawSync to avoid false "modified" from normalization
        const markdown = mdMgr.getContentForRawSync(activeTabId) ?? initialContent;
        cmMgr.setContent(activeTabId, markdown);
      } else if (contentLoadedExternally) {
        // File was opened into this tab — sync CM with new content
        cmMgr.setContent(activeTabId, initialContent);
      }
      cmMgr.activate(activeTabId, initialContent);
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
  }, [activeTabId, initialContent, mode, editorManagerRef, milkdownManagerRef]);

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
    </div>
  );
}
