import { describe, it, expect } from "vitest";
import { shouldShowEmptyState } from "../emptyState";

describe("shouldShowEmptyState", () => {
  it("shows for an untitled tab with no content", () => {
    expect(shouldShowEmptyState({ filePath: null, content: "" })).toBe(true);
  });

  it("hides once the buffer has content", () => {
    expect(shouldShowEmptyState({ filePath: null, content: "# Hello" })).toBe(false);
  });

  it("hides for a tab backed by a file, even if empty", () => {
    expect(shouldShowEmptyState({ filePath: "C:/docs/a.md", content: "" })).toBe(false);
  });

  it("hides for a file-backed tab with content", () => {
    expect(shouldShowEmptyState({ filePath: "C:/docs/a.md", content: "text" })).toBe(false);
  });
});
