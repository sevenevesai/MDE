/**
 * Diff view: compares the in-memory buffer against another version of the same
 * document (the file on disk, or the last saved baseline).
 *
 * `@codemirror/merge` is only ever reached through the memoized dynamic
 * `import()` below — the same pattern as MilkdownManager's `loadMilkdown()`.
 * A static import anywhere would pull the diff algorithm and merge chrome into
 * the startup chunk for a feature most sessions never open.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { mdeHighlightStyle } from "./theme";

/** `conflict`: buffer vs current disk content. `unsaved`: buffer vs last save. */
export type DiffMode = "conflict" | "unsaved";

// --- Pure helpers (unit-tested) ---

/** Labels for the two panes. Left is always the reference, right the buffer. */
export function diffPaneLabels(mode: DiffMode): { left: string; right: string } {
  return mode === "conflict"
    ? { left: "On disk", right: "Your version (unsaved)" }
    : { left: "Last saved", right: "Your version (unsaved)" };
}

/** The unsaved-diff command only makes sense for a tab backed by a real file. */
export function canDiffUnsaved(tab: { filePath: string | null }): boolean {
  return tab.filePath !== null;
}

export interface LineChangeSummary {
  added: number;
  removed: number;
  identical: boolean;
}

/**
 * Cheap line-level change summary for the overlay header, computed by trimming
 * the common prefix and suffix. It is an approximation — a change in the middle
 * counts as both an add and a remove, and it does not align moved blocks the
 * way the real diff does. Good enough for a "+3 / −1 lines" hint, and pure, so
 * the header costs nothing to render before the merge module has loaded.
 */
export function summarizeLineChanges(left: string, right: string): LineChangeSummary {
  if (left === right) return { added: 0, removed: 0, identical: true };

  const a = left.split("\n");
  const b = right.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;

  return {
    removed: a.length - start - end,
    added: b.length - start - end,
    identical: false,
  };
}

// --- Lazy module loading ---

type MergeModule = { MergeView: typeof import("@codemirror/merge").MergeView };

let mergeModule: Promise<MergeModule> | null = null;

/** Memoized dynamic import — the ONLY reference to `@codemirror/merge`. */
export function loadMerge(): Promise<MergeModule> {
  if (mergeModule) return mergeModule;
  mergeModule = import("@codemirror/merge").then((m) => ({ MergeView: m.MergeView }));
  return mergeModule;
}

// --- View construction ---

/**
 * Dark theme for the diff panes. `dark: true` also switches the merge
 * plugin's own chunk/gutter colors to its dark variants, which the light
 * defaults would otherwise render nearly invisible on #0d1117.
 */
const diffTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#0d1117", color: "#e6edf3", height: "100%" },
    ".cm-scroller": {
      fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
      fontSize: "13px",
      lineHeight: "1.6",
    },
    ".cm-content": { caretColor: "transparent" },
    ".cm-cursor, .cm-dropCursor": { display: "none" },
    ".cm-gutters": {
      backgroundColor: "#0d1117",
      color: "#484f58",
      border: "none",
      borderRight: "1px solid #30363d",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "#264f78" },
    // Chunk tints: the defaults are ~8% alpha and read as noise on this palette.
    "&.cm-merge-a .cm-changedLine, & .cm-deletedChunk": { backgroundColor: "rgba(248, 81, 73, 0.12)" },
    "&.cm-merge-b .cm-changedLine": { backgroundColor: "rgba(63, 185, 80, 0.12)" },
    "& .cm-collapsedLines": {
      color: "#8b949e",
      backgroundColor: "#161b22",
      borderTop: "1px solid #30363d",
      borderBottom: "1px solid #30363d",
    },
  },
  { dark: true },
);

const paneExtensions = [
  markdown({ base: markdownLanguage }),
  mdeHighlightStyle,
  diffTheme,
  EditorView.lineWrapping,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
];

export interface MountedDiff {
  destroy(): void;
}

/**
 * Build a read-only side-by-side merge view inside `parent`.
 * Computed once, on open — never on keystrokes.
 */
export async function mountDiffView(
  parent: HTMLElement,
  left: string,
  right: string,
): Promise<MountedDiff> {
  const { MergeView } = await loadMerge();
  const view = new MergeView({
    a: { doc: left, extensions: paneExtensions },
    b: { doc: right, extensions: paneExtensions },
    parent,
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  });
  view.dom.style.height = "100%";
  view.dom.style.overflow = "auto";
  return { destroy: () => view.destroy() };
}
