import { useEffect, useRef, useState } from "react";
import { diffPaneLabels, mountDiffView, summarizeLineChanges, type DiffMode } from "../editor/diffView";

export interface DiffOverlayProps {
  mode: DiffMode;
  /** Tab title, for the header. */
  title: string;
  /** Reference side: disk content (conflict) or savedContent (unsaved). */
  left: string;
  /** The current buffer. */
  right: string;
  onClose: () => void;
  /** Conflict mode only — the existing "Reload from disk" path. */
  onTakeDisk?: () => void;
  /** Conflict mode only — the existing "Keep my version" path. */
  onKeepMine?: () => void;
  /** Loading the merge module failed; the host surfaces this as a toast. */
  onError: (message: string) => void;
}

/**
 * Full-window read-only diff over the active tab. Mounted only while open, so
 * the diff is computed once per open and never on a keystroke.
 */
export default function DiffOverlay({
  mode,
  title,
  left,
  right,
  onClose,
  onTakeDisk,
  onKeepMine,
  onError,
}: DiffOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  const labels = diffPaneLabels(mode);
  const summary = summarizeLineChanges(left, right);

  useEffect(() => {
    let disposed = false;
    let mounted: { destroy(): void } | null = null;
    const parent = containerRef.current;
    if (!parent) return;

    setLoading(true);
    mountDiffView(parent, left, right)
      .then((m) => {
        if (disposed) { m.destroy(); return; }
        mounted = m;
        setLoading(false);
      })
      .catch((err) => {
        if (disposed) return;
        onError(`Failed to load diff view: ${err instanceof Error ? err.message : String(err)}`);
      });

    return () => {
      disposed = true;
      mounted?.destroy();
    };
  }, [left, right, onError]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg-primary">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg-secondary text-xs">
        <span className="font-medium truncate">
          {mode === "conflict" ? "Conflict" : "Unsaved changes"} — {title}
        </span>
        <span className="shrink-0 text-text-secondary">
          {summary.identical
            ? "no differences"
            : `+${summary.added} / −${summary.removed} lines`}
        </span>
        <span className="flex-1" />
        {mode === "conflict" ? (
          <>
            <button
              onClick={() => { onClose(); onTakeDisk?.(); }}
              className="shrink-0 px-2 py-0.5 rounded border border-yellow-700/60 hover:bg-bg-hover transition-colors"
            >
              Take disk version
            </button>
            <button
              onClick={() => { onClose(); onKeepMine?.(); }}
              className="shrink-0 px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              Keep my version
            </button>
          </>
        ) : (
          <button
            onClick={onClose}
            className="shrink-0 px-2 py-0.5 rounded border border-border text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            Close
          </button>
        )}
      </div>
      <div className="flex px-3 py-1 border-b border-border text-[11px] text-text-secondary">
        <span className="flex-1 truncate">{labels.left}</span>
        <span className="flex-1 truncate">{labels.right}</span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-text-secondary">
            Loading diff…
          </div>
        )}
      </div>
      <div className="px-3 py-1 border-t border-border text-[11px] text-text-muted">
        Read-only · Esc to close
      </div>
    </div>
  );
}
