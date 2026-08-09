import { describe, it, expect } from "vitest";
import { canDiffUnsaved, diffPaneLabels, mountDiffView, summarizeLineChanges } from "../diffView";

describe("summarizeLineChanges", () => {
  it("reports identical documents", () => {
    expect(summarizeLineChanges("a\nb", "a\nb")).toEqual({ added: 0, removed: 0, identical: true });
    expect(summarizeLineChanges("", "")).toEqual({ added: 0, removed: 0, identical: true });
  });

  it("counts appended lines as additions only", () => {
    expect(summarizeLineChanges("a\nb", "a\nb\nc")).toEqual({ added: 1, removed: 0, identical: false });
  });

  it("counts deleted lines as removals only", () => {
    expect(summarizeLineChanges("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1, identical: false });
  });

  it("counts an edited line as one removed and one added", () => {
    expect(summarizeLineChanges("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1, identical: false });
  });

  it("handles a leading insertion without miscounting the shared tail", () => {
    expect(summarizeLineChanges("b\nc", "a\nb\nc")).toEqual({ added: 1, removed: 0, identical: false });
  });

  it("handles one side being empty", () => {
    expect(summarizeLineChanges("", "a\nb")).toEqual({ added: 2, removed: 1, identical: false });
    expect(summarizeLineChanges("a\nb", "")).toEqual({ added: 1, removed: 2, identical: false });
  });

  it("never reports negative counts", () => {
    const s = summarizeLineChanges("a\na\na", "a\na");
    expect(s.added).toBeGreaterThanOrEqual(0);
    expect(s.removed).toBeGreaterThanOrEqual(0);
  });
});

describe("diffPaneLabels", () => {
  it("names the reference side per mode and always labels the buffer on the right", () => {
    expect(diffPaneLabels("conflict").left).toBe("On disk");
    expect(diffPaneLabels("unsaved").left).toBe("Last saved");
    expect(diffPaneLabels("conflict").right).toBe(diffPaneLabels("unsaved").right);
  });
});

describe("canDiffUnsaved", () => {
  it("requires a file-backed tab", () => {
    expect(canDiffUnsaved({ filePath: "C:\\notes.md" })).toBe(true);
    expect(canDiffUnsaved({ filePath: null })).toBe(false);
  });
});

describe("mountDiffView", () => {
  it("lazily loads @codemirror/merge and builds two read-only panes", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const mounted = await mountDiffView(parent, "a\nb\nc", "a\nB\nc");
    expect(parent.querySelector(".cm-mergeView")).not.toBeNull();
    expect(parent.querySelectorAll(".cm-editor")).toHaveLength(2);
    expect(parent.querySelectorAll(".cm-content[contenteditable=true]")).toHaveLength(0);

    mounted.destroy();
    expect(parent.querySelector(".cm-mergeView")).toBeNull();
    parent.remove();
  });
});
