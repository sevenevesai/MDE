import { describe, it, expect } from "vitest";
import { planOpen, failureToast, readPaths, skippedMessage } from "../openPlan";
import type { DocTab } from "../store/documentStore";
import type { FileResult } from "../fileOps.types";

function tab(overrides: Partial<DocTab> = {}): DocTab {
  return {
    id: "t1", title: "Untitled-1.md", content: "", savedContent: "", filePath: null,
    eol: "lf", savedEol: "lf", languageOverride: null,
    ...overrides,
  };
}

const file = (path: string): FileResult => ({ path, name: path.split("/").pop() ?? path, content: "text" });
const desktop = { refreshOpen: false };
const browser = { refreshOpen: true };

describe("planOpen", () => {
  it("loads the first file into a blank untitled active tab and adds the rest", () => {
    const steps = planOpen([tab()], "t1", [file("/a.md"), file("/b.py")], desktop);
    expect(steps.map((s) => s.kind)).toEqual(["reuse", "add"]);
    expect(steps[0]).toMatchObject({ tabId: "t1", file: { path: "/a.md" } });
  });

  it("never reuses a tab with content, a path or unsaved edits", () => {
    for (const active of [tab({ content: "x", savedContent: "x" }), tab({ filePath: "/z.md" }), tab({ eol: "crlf" })]) {
      expect(planOpen([active], "t1", [file("/a.md")], desktop).map((s) => s.kind)).toEqual(["add"]);
    }
  });

  it("focuses an already-open path on the desktop", () => {
    const open = tab({ id: "o", filePath: "/a.md", content: "old", savedContent: "old" });
    expect(planOpen([tab(), open], "t1", [file("/a.md")], desktop)).toEqual([{ kind: "focus", tabId: "o" }]);
  });

  it("refreshes an already-open clean tab in the browser", () => {
    const open = tab({ id: "o", filePath: "notes.md", content: "stale", savedContent: "stale" });
    const fresh = file("notes.md");
    expect(planOpen([open], "o", [fresh], browser)).toEqual([{ kind: "refresh", tabId: "o", file: fresh }]);
  });

  it("does not overwrite unsaved edits in the browser", () => {
    const open = tab({ id: "o", title: "notes.md", filePath: "notes.md", content: "mine", savedContent: "old" });
    expect(planOpen([open], "o", [file("notes.md")], browser)).toEqual([
      { kind: "focus-dirty", tabId: "o", title: "notes.md" },
    ]);
  });

  it("opens a path repeated within one batch once", () => {
    const steps = planOpen([tab({ content: "x", savedContent: "x" })], "t1", [file("/a.md"), file("/a.md")], desktop);
    expect(steps).toHaveLength(1);
  });
});

describe("failure reporting", () => {
  it("formats skipped files as sentences", () => {
    expect(skippedMessage({ name: "photo.png", reason: "not a text file" })).toBe('Cannot open "photo.png": not a text file');
  });

  it("coalesces failures into one toast, capped", () => {
    expect(failureToast([])).toBeNull();
    expect(failureToast(["a"])).toBe("a");
    expect(failureToast(["a", "b", "c", "d", "e"])).toBe("a · b · c · and 2 more");
  });

  it("collects read failures without aborting the batch", async () => {
    const read = async (path: string): Promise<FileResult> => {
      if (path.endsWith(".png")) throw new Error(`Cannot open "${path.slice(1)}": not a text file`);
      if (path.endsWith(".gone")) throw new Error("No such file");
      return file(path);
    };
    const result = await readPaths(["/a.md", "/b.png", "/c.gone"], read);
    expect(result.files.map((f) => f.path)).toEqual(["/a.md"]);
    expect(result.failures).toEqual(['Cannot open "b.png": not a text file', 'Cannot open "c.gone": No such file']);
  });
});
