import { describe, it, expect } from "vitest";
import {
  createNewTab, isModified, adjacentTabId, docReducer, fromDisk, tabFromFile, tabLanguage,
  type DocTab, type DocState,
} from "../documentStore";

function makeTab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: "tab-1",
    title: "test.md",
    content: "",
    savedContent: "",
    filePath: null,
    eol: "lf",
    savedEol: "lf",
    languageOverride: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<DocState> = {}): DocState {
  const tab = makeTab();
  return {
    tabs: [tab],
    activeTabId: tab.id,
    ...overrides,
  };
}

// ─── Utility Functions ──────────────────────────────────

describe("createNewTab", () => {
  it("creates a tab with unique id", () => {
    const tab1 = createNewTab();
    const tab2 = createNewTab();
    expect(tab1.id).not.toBe(tab2.id);
  });

  it("creates a tab with incrementing title", () => {
    const tab1 = createNewTab();
    const tab2 = createNewTab();
    // Titles should contain different numbers
    expect(tab1.title).toMatch(/^Untitled-\d+\.md$/);
    expect(tab2.title).toMatch(/^Untitled-\d+\.md$/);
    expect(tab1.title).not.toBe(tab2.title);
  });

  it("creates a tab with empty content", () => {
    const tab = createNewTab();
    expect(tab.content).toBe("");
    expect(tab.savedContent).toBe("");
    expect(tab.filePath).toBeNull();
  });

  it("uses LF line endings and no language override", () => {
    const tab = createNewTab();
    expect(tab.eol).toBe("lf");
    expect(tab.savedEol).toBe("lf");
    expect(tab.languageOverride).toBeNull();
  });
});

describe("fromDisk / tabFromFile", () => {
  it("normalises CRLF text to LF and remembers the line ending", () => {
    expect(fromDisk("a\r\nb\r\n")).toEqual({ content: "a\nb\n", eol: "crlf" });
    expect(fromDisk("a\nb")).toEqual({ content: "a\nb", eol: "lf" });
  });

  it("builds a clean tab from a file", () => {
    const tab = tabFromFile({ path: "/docs/a.py", name: "a.py", content: "x = 1\r\n" });
    expect(tab).toMatchObject({
      title: "a.py", filePath: "/docs/a.py", content: "x = 1\n", savedContent: "x = 1\n",
      eol: "crlf", savedEol: "crlf", languageOverride: null,
    });
    expect(isModified(tab)).toBe(false);
  });
});

describe("tabLanguage", () => {
  const base = { languageOverride: null, filePath: null, title: "Untitled-1.md" };

  it("detects from the path, then the title", () => {
    expect(tabLanguage({ ...base, filePath: "/src/app.json", title: "app.json" })).toBe("JSON");
    expect(tabLanguage(base)).toBe("markdown");
    expect(tabLanguage({ ...base, title: "notes.py" })).toBe("Python");
  });

  it("prefers the override", () => {
    expect(tabLanguage({ ...base, filePath: "/src/app.json", languageOverride: "Python" })).toBe("Python");
  });
});

describe("isModified", () => {
  it("returns false when content equals savedContent", () => {
    expect(isModified(makeTab({ content: "hello", savedContent: "hello" }))).toBe(false);
  });

  it("returns true when content differs from savedContent", () => {
    expect(isModified(makeTab({ content: "hello world", savedContent: "hello" }))).toBe(true);
  });

  it("returns true when only the line ending changed", () => {
    expect(isModified(makeTab({ content: "a", savedContent: "a", eol: "crlf", savedEol: "lf" }))).toBe(true);
  });

  it("returns false for a freshly created tab", () => {
    expect(isModified(createNewTab())).toBe(false);
  });
});

describe("adjacentTabId", () => {
  const tabs = ["a", "b", "c"].map((id) => makeTab({ id }));

  it("moves forward and backward", () => {
    expect(adjacentTabId(tabs, "a", 1)).toBe("b");
    expect(adjacentTabId(tabs, "c", -1)).toBe("b");
  });

  it("wraps at both ends", () => {
    expect(adjacentTabId(tabs, "c", 1)).toBe("a");
    expect(adjacentTabId(tabs, "a", -1)).toBe("c");
  });

  it("returns the active id when it is unknown", () => {
    expect(adjacentTabId(tabs, "zzz", 1)).toBe("zzz");
  });
});

// ─── Reducer ────────────────────────────────────────────

describe("docReducer", () => {
  describe("ADD_TAB", () => {
    it("adds a new tab and makes it active", () => {
      const state = makeState();
      const newTab = makeTab({ id: "tab-2", title: "new.md" });
      const next = docReducer(state, { type: "ADD_TAB", tab: newTab });

      expect(next.tabs).toHaveLength(2);
      expect(next.activeTabId).toBe("tab-2");
      expect(next.tabs[1]).toBe(newTab);
    });
  });

  describe("MOVE_TAB", () => {
    const three = () => makeState({
      tabs: [makeTab({ id: "a" }), makeTab({ id: "b" }), makeTab({ id: "c" })],
      activeTabId: "b",
    });
    const ids = (s: DocState) => s.tabs.map((t) => t.id);

    it("moves a tab forward and backward without changing the active tab", () => {
      expect(ids(docReducer(three(), { type: "MOVE_TAB", id: "a", toIndex: 2 }))).toEqual(["b", "c", "a"]);
      expect(ids(docReducer(three(), { type: "MOVE_TAB", id: "c", toIndex: 0 }))).toEqual(["c", "a", "b"]);
      expect(docReducer(three(), { type: "MOVE_TAB", id: "a", toIndex: 2 }).activeTabId).toBe("b");
    });

    it("clamps an out-of-range index", () => {
      expect(ids(docReducer(three(), { type: "MOVE_TAB", id: "a", toIndex: 99 }))).toEqual(["b", "c", "a"]);
      expect(ids(docReducer(three(), { type: "MOVE_TAB", id: "c", toIndex: -5 }))).toEqual(["c", "a", "b"]);
    });

    it("returns the same state for an unknown id or no-op move", () => {
      const s = three();
      expect(docReducer(s, { type: "MOVE_TAB", id: "zzz", toIndex: 0 })).toBe(s);
      expect(docReducer(s, { type: "MOVE_TAB", id: "b", toIndex: 1 })).toBe(s);
    });
  });

  describe("SET_ACTIVE", () => {
    it("changes the active tab id", () => {
      const tab1 = makeTab({ id: "tab-1" });
      const tab2 = makeTab({ id: "tab-2" });
      const state = makeState({ tabs: [tab1, tab2], activeTabId: "tab-1" });

      const next = docReducer(state, { type: "SET_ACTIVE", id: "tab-2" });
      expect(next.activeTabId).toBe("tab-2");
      expect(next.tabs).toBe(state.tabs); // tabs unchanged
    });
  });

  describe("UPDATE_CONTENT", () => {
    it("updates content for the specified tab", () => {
      const state = makeState();
      const next = docReducer(state, { type: "UPDATE_CONTENT", tabId: "tab-1", content: "new content" });

      expect(next.tabs[0].content).toBe("new content");
      expect(next.tabs[0].savedContent).toBe(""); // unchanged
    });

    it("does not affect other tabs", () => {
      const tab1 = makeTab({ id: "tab-1", content: "original" });
      const tab2 = makeTab({ id: "tab-2", content: "other" });
      const state = makeState({ tabs: [tab1, tab2] });

      const next = docReducer(state, { type: "UPDATE_CONTENT", tabId: "tab-1", content: "changed" });
      expect(next.tabs[0].content).toBe("changed");
      expect(next.tabs[1].content).toBe("other");
    });
  });

  describe("MARK_SAVED", () => {
    it("records the written content and line ending as saved", () => {
      const tab = makeTab({ content: "edited", savedContent: "original", eol: "crlf" });
      const state = makeState({ tabs: [tab] });

      const next = docReducer(state, { type: "MARK_SAVED", tabId: "tab-1", content: "edited", eol: "crlf" });
      expect(next.tabs[0].savedContent).toBe("edited");
      expect(next.tabs[0].savedEol).toBe("crlf");
      expect(isModified(next.tabs[0])).toBe(false);
    });

    it("leaves edits made during the write unsaved", () => {
      const tab = makeTab({ content: "edited more", savedContent: "original" });
      const next = docReducer(makeState({ tabs: [tab] }), { type: "MARK_SAVED", tabId: "tab-1", content: "edited", eol: "lf" });
      expect(next.tabs[0].savedContent).toBe("edited");
      expect(isModified(next.tabs[0])).toBe(true);
    });
  });

  describe("SET_EOL", () => {
    it("makes a clean tab saveable, and switching back makes it clean again", () => {
      const state = makeState({ tabs: [makeTab({ content: "a\nb", savedContent: "a\nb" })] });
      const crlf = docReducer(state, { type: "SET_EOL", tabId: "tab-1", eol: "crlf" });
      expect(crlf.tabs[0].eol).toBe("crlf");
      expect(crlf.tabs[0].content).toBe("a\nb");
      expect(isModified(crlf.tabs[0])).toBe(true);

      const back = docReducer(crlf, { type: "SET_EOL", tabId: "tab-1", eol: "lf" });
      expect(isModified(back.tabs[0])).toBe(false);
    });
  });

  describe("SET_LANGUAGE", () => {
    it("sets and clears the override", () => {
      const set = docReducer(makeState(), { type: "SET_LANGUAGE", tabId: "tab-1", languageOverride: "Python" });
      expect(set.tabs[0].languageOverride).toBe("Python");
      const cleared = docReducer(set, { type: "SET_LANGUAGE", tabId: "tab-1", languageOverride: null });
      expect(cleared.tabs[0].languageOverride).toBeNull();
    });
  });

  describe("REPLACE_TAB", () => {
    it("patches the specified tab", () => {
      const state = makeState();
      const next = docReducer(state, {
        type: "REPLACE_TAB",
        tabId: "tab-1",
        patch: { filePath: "/path/to/file.md", title: "file.md" },
      });

      expect(next.tabs[0].filePath).toBe("/path/to/file.md");
      expect(next.tabs[0].title).toBe("file.md");
    });
  });

  describe("SET_TABS", () => {
    it("replaces all tabs", () => {
      const state = makeState();
      const newTabs = [makeTab({ id: "new-1" }), makeTab({ id: "new-2" })];

      const next = docReducer(state, { type: "SET_TABS", tabs: newTabs });
      expect(next.tabs).toBe(newTabs);
      expect(next.activeTabId).toBe("tab-1"); // activeTabId unchanged
    });
  });

  describe("LOAD_FILE", () => {
    it("loads file data into the tab as its clean state", () => {
      const state = makeState({ tabs: [makeTab({ content: "draft", eol: "crlf" })] });
      const next = docReducer(state, {
        type: "LOAD_FILE",
        tabId: "tab-1",
        name: "readme.md",
        path: "/docs/readme.md",
        text: fromDisk("# Hello\r\n"),
      });

      expect(next.tabs[0]).toMatchObject({
        title: "readme.md", filePath: "/docs/readme.md",
        content: "# Hello\n", savedContent: "# Hello\n", eol: "crlf", savedEol: "crlf",
      });
      expect(isModified(next.tabs[0])).toBe(false);
    });

    it("keeps the language override for the same file and drops it for another", () => {
      const state = makeState({ tabs: [makeTab({ filePath: "/a.txt", languageOverride: "Python" })] });
      const same = docReducer(state, { type: "LOAD_FILE", tabId: "tab-1", name: "a.txt", path: "/a.txt", text: fromDisk("x") });
      expect(same.tabs[0].languageOverride).toBe("Python");
      const other = docReducer(state, { type: "LOAD_FILE", tabId: "tab-1", name: "b.txt", path: "/b.txt", text: fromDisk("x") });
      expect(other.tabs[0].languageOverride).toBeNull();
    });
  });

  describe("REMOVE_TAB", () => {
    it("removes a tab and selects the next one", () => {
      const tab1 = makeTab({ id: "tab-1" });
      const tab2 = makeTab({ id: "tab-2" });
      const tab3 = makeTab({ id: "tab-3" });
      const state = makeState({ tabs: [tab1, tab2, tab3], activeTabId: "tab-2" });

      const next = docReducer(state, { type: "REMOVE_TAB", id: "tab-2" });
      expect(next.tabs).toHaveLength(2);
      expect(next.tabs.find((t) => t.id === "tab-2")).toBeUndefined();
      // Should select tab-3 (was at index 2, now at index 1 = min(1, 1))
      expect(next.activeTabId).toBe("tab-3");
    });

    it("selects previous tab when removing the last tab in the list", () => {
      const tab1 = makeTab({ id: "tab-1" });
      const tab2 = makeTab({ id: "tab-2" });
      const state = makeState({ tabs: [tab1, tab2], activeTabId: "tab-2" });

      const next = docReducer(state, { type: "REMOVE_TAB", id: "tab-2" });
      expect(next.tabs).toHaveLength(1);
      expect(next.activeTabId).toBe("tab-1");
    });

    it("does not change active tab when removing a non-active tab", () => {
      const tab1 = makeTab({ id: "tab-1" });
      const tab2 = makeTab({ id: "tab-2" });
      const state = makeState({ tabs: [tab1, tab2], activeTabId: "tab-1" });

      const next = docReducer(state, { type: "REMOVE_TAB", id: "tab-2" });
      expect(next.activeTabId).toBe("tab-1");
    });

    it("creates a new untitled tab when removing the last remaining tab", () => {
      const state = makeState();
      const next = docReducer(state, { type: "REMOVE_TAB", id: "tab-1" });

      expect(next.tabs).toHaveLength(1);
      expect(next.tabs[0].id).not.toBe("tab-1"); // new tab
      expect(next.tabs[0].filePath).toBeNull();
      expect(next.tabs[0].content).toBe("");
      expect(next.activeTabId).toBe(next.tabs[0].id);
    });

    it("uses replacement tab when provided and removing last tab", () => {
      const state = makeState();
      const replacement = makeTab({ id: "replacement", title: "Fresh.md" });

      const next = docReducer(state, { type: "REMOVE_TAB", id: "tab-1", replacement });
      expect(next.tabs).toHaveLength(1);
      expect(next.tabs[0].id).toBe("replacement");
      expect(next.activeTabId).toBe("replacement");
    });
  });
});
