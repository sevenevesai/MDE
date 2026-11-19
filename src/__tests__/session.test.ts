import { describe, it, expect, beforeEach } from "vitest";
import { saveSession, loadSession, clearSession } from "../session";
import { isModified, type DocTab } from "../store/documentStore";

function tab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: "t1",
    title: "a.md",
    content: "hello",
    savedContent: "hello",
    filePath: "C:\\docs\\a.md",
    eol: "lf",
    savedEol: "lf",
    languageOverride: null,
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

describe("sessions saved before line-ending support", () => {
  /** A tab as older versions stored it: no eol, savedEol or languageOverride. */
  function legacyTab(content: string, savedContent: string) {
    return { id: "t1", title: "a.md", content, savedContent, filePath: "C:\\docs\\a.md" };
  }

  it("restores a CRLF tab as LF text with a CRLF line ending, unmodified", () => {
    localStorage.setItem(
      "mde-session",
      JSON.stringify({ tabs: [legacyTab("one\r\ntwo\r\n", "one\r\ntwo\r\n")], activeTabId: "t1", timestamp: 1 }),
    );
    const restored = loadSession()?.tabs[0];
    expect(restored).toMatchObject({
      content: "one\ntwo\n", savedContent: "one\ntwo\n", eol: "crlf", savedEol: "crlf", languageOverride: null,
    });
    expect(restored && isModified(restored)).toBe(false);
  });

  it("detects from the saved text when the buffer was already normalised by the editor", () => {
    localStorage.setItem(
      "mde-session",
      JSON.stringify({ tabs: [legacyTab("one\ntwo\nthree", "one\r\ntwo\r\n")], activeTabId: "t1", timestamp: 1 }),
    );
    const restored = loadSession()?.tabs[0];
    expect(restored?.eol).toBe("crlf");
    expect(restored?.content).toBe("one\ntwo\nthree");
    expect(restored?.savedContent).toBe("one\ntwo\n");
  });

  it("keeps stored line endings and language overrides", () => {
    saveSession([tab({ eol: "crlf", savedEol: "lf", languageOverride: "Python" })], "t1");
    expect(loadSession()?.tabs[0]).toMatchObject({ eol: "crlf", savedEol: "lf", languageOverride: "Python" });
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
