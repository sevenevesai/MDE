import { describe, it, expect } from "vitest";
import { createNewTab, isModified, docReducer, type DocTab, type DocState } from "../documentStore";

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
});

describe("isModified", () => {
  it("returns false when content equals savedContent", () => {
    const tab: DocTab = {
      id: "test",
      title: "test.md",
      content: "hello",
      savedContent: "hello",
      filePath: null,
    };
    expect(isModified(tab)).toBe(false);
  });

  it("returns true when content differs from savedContent", () => {
    const tab: DocTab = {
      id: "test",
      title: "test.md",
      content: "hello world",
      savedContent: "hello",
      filePath: null,
    };
    expect(isModified(tab)).toBe(true);
  });

  it("returns false for a freshly created tab", () => {
    expect(isModified(createNewTab())).toBe(false);
  });
});

// ─── Reducer ────────────────────────────────────────────

function makeTab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: overrides.id ?? "tab-1",
    title: overrides.title ?? "test.md",
    content: overrides.content ?? "",
    savedContent: overrides.savedContent ?? "",
    filePath: overrides.filePath ?? null,
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
    it("sets savedContent to current content", () => {
      const tab = makeTab({ content: "edited", savedContent: "original" });
      const state = makeState({ tabs: [tab] });

      const next = docReducer(state, { type: "MARK_SAVED", tabId: "tab-1" });
      expect(next.tabs[0].savedContent).toBe("edited");
      expect(isModified(next.tabs[0])).toBe(false);
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

  describe("OPEN_FILE_INTO_CURRENT", () => {
    it("replaces current tab with file data", () => {
      const state = makeState();
      const next = docReducer(state, {
        type: "OPEN_FILE_INTO_CURRENT",
        tabId: "tab-1",
        name: "readme.md",
        content: "# Hello",
        path: "/docs/readme.md",
      });

      expect(next.tabs[0].title).toBe("readme.md");
      expect(next.tabs[0].content).toBe("# Hello");
      expect(next.tabs[0].savedContent).toBe("# Hello");
      expect(next.tabs[0].filePath).toBe("/docs/readme.md");
      expect(isModified(next.tabs[0])).toBe(false);
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
