import { describe, it, expect } from "vitest";
import { selectAutoSaveTargets, type AutoSaveCandidate } from "../autosave";

const tab = (patch: Partial<AutoSaveCandidate>): AutoSaveCandidate => ({
  id: "t1",
  filePath: "C:/docs/a.md",
  content: "changed",
  savedContent: "saved",
  ...patch,
});

describe("selectAutoSaveTargets", () => {
  it("returns nothing when auto-save is disabled, even with dirty file-backed tabs", () => {
    expect(selectAutoSaveTargets([tab({})], new Set(), false)).toEqual([]);
  });

  it("selects a dirty file-backed tab when enabled", () => {
    const targets = selectAutoSaveTargets([tab({})], new Set(), true);
    expect(targets).toEqual([{ id: "t1", filePath: "C:/docs/a.md", content: "changed" }]);
  });

  it("skips untitled tabs (no filePath)", () => {
    const targets = selectAutoSaveTargets([tab({ filePath: null })], new Set(), true);
    expect(targets).toEqual([]);
  });

  it("skips clean tabs (content === savedContent)", () => {
    const targets = selectAutoSaveTargets([tab({ content: "same", savedContent: "same" })], new Set(), true);
    expect(targets).toEqual([]);
  });

  it("skips tabs flagged as conflicting with an external change", () => {
    const targets = selectAutoSaveTargets([tab({ id: "t1" })], new Set(["t1"]), true);
    expect(targets).toEqual([]);
  });

  it("selects only the eligible tabs out of a mixed set", () => {
    const tabs = [
      tab({ id: "dirty", filePath: "a.md" }),
      tab({ id: "clean", filePath: "b.md", content: "x", savedContent: "x" }),
      tab({ id: "untitled", filePath: null }),
      tab({ id: "conflicted", filePath: "c.md" }),
    ];
    const targets = selectAutoSaveTargets(tabs, new Set(["conflicted"]), true);
    expect(targets.map((t) => t.id)).toEqual(["dirty"]);
  });
});
