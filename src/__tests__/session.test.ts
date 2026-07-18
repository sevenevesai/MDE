import { describe, it, expect, beforeEach } from "vitest";
import { saveSession, loadSession, clearSession } from "../session";
import type { DocTab } from "../store/documentStore";

function tab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: "t1",
    title: "a.md",
    content: "hello",
    savedContent: "hello",
    filePath: "C:\\docs\\a.md",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("session round trip", () => {
  it("restores tabs and active tab exactly as saved", () => {
    const tabs = [tab(), tab({ id: "t2", title: "b.md", content: "dirty", filePath: null })];
    saveSession(tabs, "t2");

    const loaded = loadSession();
    expect(loaded?.tabs).toEqual(tabs);
    expect(loaded?.activeTabId).toBe("t2");
  });

  it("preserves dirty buffers (content != savedContent)", () => {
    saveSession([tab({ content: "edited", savedContent: "original" })], "t1");
    const loaded = loadSession();
    expect(loaded?.tabs[0].content).toBe("edited");
    expect(loaded?.tabs[0].savedContent).toBe("original");
  });

  it("clearSession removes the snapshot", () => {
    saveSession([tab()], "t1");
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

describe("malformed data", () => {
  it("returns null when nothing is stored", () => {
    expect(loadSession()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("mde-session", "{not json");
    expect(loadSession()).toBeNull();
  });

  it("returns null for an empty tab list", () => {
    localStorage.setItem("mde-session", JSON.stringify({ tabs: [], activeTabId: "x", timestamp: 1 }));
    expect(loadSession()).toBeNull();
  });

  it("returns null when a tab is missing required fields", () => {
    localStorage.setItem(
      "mde-session",
      JSON.stringify({ tabs: [{ id: "t1", title: "a.md" }], activeTabId: "t1", timestamp: 1 })
    );
    expect(loadSession()).toBeNull();
  });
});

describe("legacy crash-recovery migration", () => {
  it("falls back to pre-1.2 recovery data and removes the legacy keys", () => {
    const tabs = [tab({ content: "unsaved work", savedContent: "old" })];
    localStorage.setItem("mde-recovery", JSON.stringify({ tabs, activeTabId: "t1", timestamp: 1 }));
    localStorage.setItem("mde-recovery-dirty", "1");

    const loaded = loadSession();
    expect(loaded?.tabs[0].content).toBe("unsaved work");
    expect(localStorage.getItem("mde-recovery")).toBeNull();
    expect(localStorage.getItem("mde-recovery-dirty")).toBeNull();
  });

  it("prefers the new session key over legacy data", () => {
    saveSession([tab({ id: "new" })], "new");
    localStorage.setItem("mde-recovery", JSON.stringify({ tabs: [tab({ id: "old" })], activeTabId: "old", timestamp: 1 }));
    expect(loadSession()?.tabs[0].id).toBe("new");
  });
});
