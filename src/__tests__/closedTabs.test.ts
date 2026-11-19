import { describe, it, expect } from "vitest";
import { pushClosed, popClosed, isWorthReopening, CLOSED_TABS_CAP } from "../closedTabs";
import type { DocTab } from "../store/documentStore";

function tab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: "t1",
    title: "a.py",
    content: "x = 1\n",
    savedContent: "",
    filePath: "/src/a.py",
    eol: "crlf",
    savedEol: "lf",
    languageOverride: "Python",
    ...overrides,
  };
}

describe("closed tab stack", () => {
  it("reopens the most recent tab first, with unsaved content, path, line ending and language", () => {
    let stack = pushClosed([], tab({ title: "first.md", filePath: "/first.md" }));
    stack = pushClosed(stack, tab());

    const popped = popClosed(stack);
    expect(popped?.tab).toEqual({
      title: "a.py", content: "x = 1\n", savedContent: "", filePath: "/src/a.py",
      eol: "crlf", savedEol: "lf", languageOverride: "Python",
    });
    expect(popClosed(popped?.rest ?? [])?.tab.title).toBe("first.md");
  });

  it("is empty-safe", () => {
    expect(popClosed([])).toBeNull();
  });

  it("drops the oldest entries beyond the cap", () => {
    let stack = pushClosed([], tab({ title: "0" }));
    for (let i = 1; i <= CLOSED_TABS_CAP; i++) stack = pushClosed(stack, tab({ title: String(i) }));
    expect(stack).toHaveLength(CLOSED_TABS_CAP);
    expect(stack[0].title).toBe("1");
    expect(stack[stack.length - 1].title).toBe(String(CLOSED_TABS_CAP));
  });

  it("ignores untouched untitled tabs but keeps untitled drafts", () => {
    const blank = tab({ filePath: null, content: "" });
    expect(isWorthReopening(blank)).toBe(false);
    expect(pushClosed([], blank)).toEqual([]);
    expect(pushClosed([], tab({ filePath: null, content: "draft" }))).toHaveLength(1);
  });
});
