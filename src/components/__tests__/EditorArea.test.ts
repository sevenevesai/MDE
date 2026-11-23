import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import EditorArea from "../EditorArea";
import { EditorManager } from "../../editor/EditorManager";
import { MilkdownManager } from "../../editor/MilkdownManager";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TAB = "tab-1";

let host: HTMLElement;
let root: Root;
let editorManagerRef: { current: EditorManager };
let milkdownManagerRef: { current: MilkdownManager };
let onChange: ReturnType<typeof vi.fn<(tabId: string, value: string) => void>>;

/** Render EditorArea in raw mode the way App does: `initialContent` is the store's copy of the tab. */
function render(storeContent: string) {
  act(() => {
    root.render(createElement(EditorArea, {
      activeTabId: TAB,
      initialContent: storeContent,
      languageId: "markdown",
      mode: "raw",
      onChange,
      onCursorChange: () => {},
      editorManagerRef,
      milkdownManagerRef,
    }));
  });
}

function view(): EditorView {
  const v = editorManagerRef.current.getActiveView();
  if (!v) throw new Error("no active editor");
  return v;
}

function type(text: string) {
  const v = view();
  const { head } = v.state.selection.main;
  v.dispatch({
    changes: { from: head, insert: text },
    selection: EditorSelection.cursor(head + text.length),
    userEvent: "input.type",
  });
}

beforeEach(() => {
  // Only the content-sync debounce; a faked animation frame would run CodeMirror's
  // layout measure, which jsdom cannot do.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // jsdom has no canvas and logs on every getContext call; the minimap copes with null.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  editorManagerRef = { current: new EditorManager() };
  milkdownManagerRef = { current: new MilkdownManager() };
  onChange = vi.fn<(tabId: string, value: string) => void>();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("EditorArea raw mode", () => {
  it("keeps a keystroke typed while the store catches up with the editor", () => {
    render("w\nnext line");
    view().dispatch({ selection: EditorSelection.cursor(1) });

    type("i");
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith(TAB, "wi\nnext line");

    // The user types before React commits the synced text: the store now trails the editor.
    type("t");
    render("wi\nnext line");

    expect(view().state.doc.toString()).toBe("wit\nnext line");
    type("h");
    expect(view().state.doc.toString()).toBe("with\nnext line");
  });
});
