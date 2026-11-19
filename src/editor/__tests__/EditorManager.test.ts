import { describe, it, expect, afterEach, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { indentMore } from "@codemirror/commands";
import { indentUnit, language } from "@codemirror/language";
import { EditorManager, type CursorInfo } from "../EditorManager";
import { loadLanguageExtension } from "../language";
import { DEFAULTS } from "../../settings";

vi.mock("../language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../language")>();
  return { ...actual, loadLanguageExtension: vi.fn(actual.loadLanguageExtension) };
});

let mgr: EditorManager;
let container: HTMLElement;

function setup(): EditorManager {
  // jsdom has no canvas and logs on every getContext call; the minimap copes with null.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  mgr = new EditorManager();
  container = document.createElement("div");
  document.body.appendChild(container);
  mgr.attach(container);
  return mgr;
}

afterEach(() => {
  mgr.detach();
  container.remove();
  vi.restoreAllMocks();
});

/** Dispatch a keydown through the editor's keymaps; true when a binding handled it. */
function pressMod(view: EditorView, key: string, shift = false): boolean {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey: shift, cancelable: true });
  return runScopeHandlers(view, event, "editor");
}

function select(view: EditorView, ...ranges: [number, number][]) {
  view.dispatch({ selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h))) });
}

const languageName = (view: EditorView): string | null => view.state.facet(language)?.name ?? null;

describe("multi-cursor", () => {
  it("keeps several selection ranges", () => {
    const view = setup().ensureEditor("t", "foo bar foo");
    select(view, [0, 0], [8, 8]);
    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it("adds the next occurrence on Mod-d", () => {
    const view = setup().ensureEditor("t", "foo bar foo");
    select(view, [0, 3]);
    expect(pressMod(view, "d")).toBe(true);
    expect(view.state.selection.ranges.map((r) => [r.from, r.to])).toEqual([[0, 3], [8, 11]]);
  });
});

describe("per-tab language", () => {
  it("defaults to markdown with the formatting chords", () => {
    const view = setup().ensureEditor("t", "hello");
    select(view, [0, 5]);
    expect(pressMod(view, "b")).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello**");
  });

  it("gives a non-markdown tab no markdown chords", async () => {
    const view = setup().ensureEditor("t", "hello", "JSON");
    select(view, [0, 5]);
    expect(pressMod(view, "b")).toBe(false);
    expect(view.state.doc.toString()).toBe("hello");
    await vi.waitFor(() => expect(languageName(view)).toBe("json"));
  });

  it("switches language, adding and removing the markdown chords", async () => {
    const m = setup();
    const view = m.ensureEditor("t", "hello");
    expect(await m.setLanguage("t", "plain")).toBe(true);
    select(view, [0, 5]);
    expect(pressMod(view, "b")).toBe(false);

    expect(await m.setLanguage("t", "Python")).toBe(true);
    expect(languageName(view)).toBe("python");

    expect(await m.setLanguage("t", "markdown")).toBe(true);
    select(view, [0, 5]);
    expect(pressMod(view, "b")).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello**");
  });

  it("drops a parser load that a later request superseded", async () => {
    const m = setup();
    const view = m.ensureEditor("t", "{}");
    const slow = m.setLanguage("t", "JSON");
    const fast = m.setLanguage("t", "plain");
    expect(await fast).toBe(true);
    expect(await slow).toBe(false);
    expect(languageName(view)).toBeNull();
  });

  it("drops a parser load for a tab closed while it loaded", async () => {
    const m = setup();
    m.ensureEditor("t", "fn main() {}");
    const pending = m.setLanguage("t", "Rust");
    m.removeEditor("t");
    expect(await pending).toBe(false);
  });

  it("does nothing for a tab that does not exist", async () => {
    expect(await setup().setLanguage("missing", "Python")).toBe(false);
  });

  it("reports a failed load and keeps the current language", async () => {
    const m = setup();
    const view = m.ensureEditor("t", "x = 1");
    await m.setLanguage("t", "Python");
    const onError = vi.fn();
    m.setOnLanguageError(onError);
    const failure = new Error("chunk failed");
    vi.mocked(loadLanguageExtension).mockRejectedValueOnce(failure);

    expect(await m.setLanguage("t", "Rust")).toBe(false);
    expect(onError).toHaveBeenCalledWith("t", "Rust", failure);
    expect(languageName(view)).toBe("python");
  });
});

describe("keymap", () => {
  it("opens go-to-line on Mod-g", () => {
    const view = setup().ensureEditor("t", "a\nb\nc");
    expect(pressMod(view, "g")).toBe(true);
    expect(view.dom.querySelector("input[name=line]")).not.toBeNull();
  });
});

describe("selection stats", () => {
  it("reports range count and total selected length", () => {
    const m = setup();
    const view = m.ensureEditor("t", "hello brave new world");
    const infos: CursorInfo[] = [];
    m.setOnCursorChange((info) => infos.push(info));

    select(view, [0, 5], [12, 15]);
    expect(infos.at(-1)).toMatchObject({ selectionCount: 2, selectionLength: 8, line: 1 });

    select(view, [3, 3]);
    expect(infos.at(-1)).toMatchObject({ selectionCount: 1, selectionLength: 0, column: 4 });
  });
});

describe("indent and whitespace settings", () => {
  it("indents with the configured number of spaces", () => {
    const m = setup();
    const view = m.ensureEditor("t", "x");
    m.updateSettings({ ...DEFAULTS, indentSize: 4 });
    expect(view.state.facet(indentUnit)).toBe("    ");
    expect(view.state.tabSize).toBe(4);
    indentMore(view);
    expect(view.state.doc.toString()).toBe("    x");
  });

  it("indents with a tab when indentWithTabs is on, tab stops following indentSize", () => {
    const m = setup();
    const view = m.ensureEditor("t", "x");
    m.updateSettings({ ...DEFAULTS, indentSize: 8, indentWithTabs: true });
    expect(view.state.tabSize).toBe(8);
    indentMore(view);
    expect(view.state.doc.toString()).toBe("\tx");
  });

  it("applies the current settings to editors created later", () => {
    const m = setup();
    m.updateSettings({ ...DEFAULTS, indentSize: 8 });
    const view = m.ensureEditor("t", "x");
    expect(view.state.facet(indentUnit)).toBe("        ");
  });

  it("marks whitespace only while showWhitespace is on", () => {
    const m = setup();
    const view = m.ensureEditor("t", "a b");
    expect(view.contentDOM.querySelector(".cm-highlightSpace")).toBeNull();
    m.updateSettings({ ...DEFAULTS, showWhitespace: true });
    expect(view.contentDOM.querySelector(".cm-highlightSpace")).not.toBeNull();
    m.updateSettings({ ...DEFAULTS, showWhitespace: false });
    expect(view.contentDOM.querySelector(".cm-highlightSpace")).toBeNull();
  });
});
