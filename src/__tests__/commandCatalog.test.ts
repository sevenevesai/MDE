import { describe, it, expect, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { search } from "@codemirror/search";
import {
  buildMenus, buildPalette, shortcutLabel, isEditorCommand, openReplacePanel, checkedCommands,
  type CommandContext, type CommandId, type MenuEntry,
} from "../commandCatalog";

const ctx = (patch: Partial<CommandContext> = {}): CommandContext => ({
  tauri: true, markdown: true, hasFile: true, checked: new Set(), ...patch,
});

const ids = (entries: readonly MenuEntry[]): string[] =>
  entries.flatMap((e) => (e.kind === "item" && e.target.kind === "command" ? [e.target.id] : []));

describe("shortcutLabel", () => {
  it("shows the browser alternate for chords the browser reserves", () => {
    for (const [id, desktop, browser] of [
      ["file.new", "Ctrl+N", "Alt+N"],
      ["file.closeTab", "Ctrl+W", "Alt+W"],
      ["file.reopenClosed", "Ctrl+Shift+T", "Alt+Shift+T"],
      ["view.nextTab", "Ctrl+Tab", "Alt+PageDown"],
      ["view.prevTab", "Ctrl+Shift+Tab", "Alt+PageUp"],
    ] as const) {
      expect(shortcutLabel(id, { tauri: true, markdown: true })).toBe(desktop);
      expect(shortcutLabel(id, { tauri: false, markdown: true })).toBe(browser);
    }
  });

  it("keeps ordinary chords on both platforms", () => {
    expect(shortcutLabel("file.save", { tauri: false, markdown: true })).toBe("Ctrl+S");
    expect(shortcutLabel("sel.selectNext", { tauri: false, markdown: false })).toBe("Ctrl+D");
  });

  it("omits chords a markdown formatting chord shadows, only in markdown tabs", () => {
    expect(shortcutLabel("edit.deleteLine", { tauri: true, markdown: true })).toBeUndefined();
    expect(shortcutLabel("edit.deleteLine", { tauri: true, markdown: false })).toBe("Ctrl+Shift+K");
    expect(shortcutLabel("sel.selectAllOccurrences", { tauri: true, markdown: true })).toBeUndefined();
    expect(shortcutLabel("sel.selectAllOccurrences", { tauri: true, markdown: false })).toBe("Ctrl+Shift+L");
  });
});

describe("buildMenus", () => {
  it("has File, Edit, Selection, View and Help menus on both platforms", () => {
    expect(buildMenus(ctx(), []).map((m) => m.label)).toEqual(["File", "Edit", "Selection", "View", "Help"]);
    expect(buildMenus(ctx({ tauri: false }), []).map((m) => m.label)).toEqual(["File", "Edit", "Selection", "View", "Help"]);
  });

  it("offers updates (desktop) or the download page (browser), and Discord in both", () => {
    const help = (c: CommandContext) => ids(buildMenus(c, []).find((m) => m.label === "Help")?.entries ?? []);
    expect(help(ctx())).toEqual(["help.updates", "help.discord"]);
    expect(help(ctx({ tauri: false }))).toEqual(["help.download", "help.discord"]);
  });

  it("hides markdown commands for other languages", () => {
    const markdownOnly: CommandId[] = ["edit.toggleCheckbox", "edit.formatTable", "edit.copyHtml", "file.exportHtml"];
    const all = (c: CommandContext) => buildMenus(c, []).flatMap((m) => ids(m.entries));
    for (const id of markdownOnly) {
      expect(all(ctx())).toContain(id);
      expect(all(ctx({ markdown: false }))).not.toContain(id);
    }
    expect(all(ctx({ markdown: false }))).toContain("edit.copyForAI");
  });

  it("never leaves leading, trailing or doubled separators", () => {
    for (const c of [ctx(), ctx({ markdown: false, hasFile: false, tauri: false })]) {
      for (const menu of buildMenus(c, ["/a.md"])) {
        const kinds = menu.entries.map((e) => e.kind);
        expect(kinds[0]).toBe("item");
        expect(kinds[kinds.length - 1]).toBe("item");
        expect(kinds.join(",")).not.toContain("separator,separator");
      }
    }
  });

  it("lists recent files in File with a Clear Recent entry", () => {
    const file = buildMenus(ctx(), ["C:\\docs\\a.md"])[0];
    const recent = file.entries.find((e) => e.kind === "item" && e.target.kind === "recent");
    expect(recent).toMatchObject({ label: "a.md", target: { kind: "recent", path: "C:\\docs\\a.md" } });
    expect(ids(file.entries)).toContain("file.clearRecent");
    expect(ids(buildMenus(ctx(), [])[0].entries)).not.toContain("file.clearRecent");
  });

  it("marks checked commands", () => {
    const view = buildMenus(ctx({ checked: new Set<CommandId>(["view.wordWrap"]) }), [])[3];
    const wrap = view.entries.find((e) => e.kind === "item" && e.target.kind === "command" && e.target.id === "view.wordWrap");
    expect(wrap).toMatchObject({ checked: true });
  });
});

describe("checkedCommands", () => {
  const settings = { autoSave: false, showOutline: false, wordWrap: true, showWhitespace: false, indentSize: 4, indentWithTabs: false };

  it("checks the on toggles and the indentation in use", () => {
    expect([...checkedCommands(settings)].sort()).toEqual(["view.indent4", "view.wordWrap"]);
    expect(checkedCommands({ ...settings, indentWithTabs: true, autoSave: true })).toEqual(
      new Set(["view.indentTabs", "view.wordWrap", "file.autoSave"]),
    );
  });
});

describe("buildPalette", () => {
  it("contains every menu command, on every platform and language", () => {
    for (const c of [ctx(), ctx({ tauri: false }), ctx({ markdown: false }), ctx({ hasFile: false })]) {
      const palette = new Set(buildPalette(c, ["a.md"]).map((e) => e.key));
      for (const menu of buildMenus(c, ["a.md"])) {
        for (const id of ids(menu.entries)) expect(palette).toContain(id);
      }
    }
  });

  it("titles entries with their category and shows the platform's chord", () => {
    const entries = buildPalette(ctx({ tauri: false }), []);
    expect(entries.find((e) => e.key === "file.new")).toMatchObject({ title: "File: New Tab", shortcut: "Alt+N" });
    expect(entries.find((e) => e.key === "view.wordWrap")?.title).toBe("View: Toggle Word Wrap");
  });

  it("adds one entry per recent file", () => {
    const entries = buildPalette(ctx(), ["/x/notes.md"]);
    expect(entries.at(-1)).toMatchObject({ title: "Open Recent: notes.md", target: { kind: "recent", path: "/x/notes.md" } });
  });
});

describe("editor commands", () => {
  const views: EditorView[] = [];
  afterEach(() => views.splice(0).forEach((v) => v.destroy()));

  it("separates CodeMirror commands from app commands", () => {
    expect(isEditorCommand("sel.selectNext")).toBe(true);
    expect(isEditorCommand("file.save")).toBe(false);
  });

  it("Replace opens the search panel with the replace field focused", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc: "abc", extensions: [search()] }), parent });
    views.push(view);
    expect(openReplacePanel(view)).toBe(true);
    const replace = view.dom.querySelector(".cm-search input[name=replace]");
    expect(replace).not.toBeNull();
    expect(document.activeElement).toBe(replace);
    parent.remove();
  });
});
