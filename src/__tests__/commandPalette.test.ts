import { describe, it, expect } from "vitest";
import { fuzzyScore, filterByFuzzy } from "../commandPalette";

describe("fuzzyScore", () => {
  it("matches case-insensitively", () => {
    expect(fuzzyScore("SAVE", "File: Save")).not.toBeNull();
    expect(fuzzyScore("save", "FILE: SAVE")).not.toBeNull();
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "File: Save")).toBeNull();
    expect(fuzzyScore("file", "Edit: Format Table")).toBeNull();
  });

  it("matches everything on an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("scores an exact word lower (better) than a scattered subsequence", () => {
    const exact = fuzzyScore("save", "File: Save")!;
    const scattered = fuzzyScore("save", "Set Available Version Everywhere")!;
    expect(exact).toBeLessThan(scattered);
  });

  it("prefers shorter titles when match quality is equal", () => {
    expect(fuzzyScore("save", "File: Save")!).toBeLessThan(fuzzyScore("save", "File: Save As…")!);
  });
});

describe("filterByFuzzy", () => {
  const titles = [
    "File: New",
    "File: Open…",
    "File: Save",
    "File: Save As…",
    "AI: Copy for AI",
    "AI: Clean AI Paste",
    "Edit: Format Table",
  ];

  it("returns all items in original order for an empty query", () => {
    expect(filterByFuzzy(titles, "", (t) => t)).toEqual(titles);
  });

  it("drops non-matches and ranks best match first", () => {
    const result = filterByFuzzy(titles, "save", (t) => t);
    expect(result).toEqual(["File: Save", "File: Save As…"]);
  });

  it("ranks a word-start match above a mid-word match", () => {
    const result = filterByFuzzy(titles, "ai", (t) => t);
    expect(result[0]).toBe("AI: Copy for AI");
    expect(result).toContain("AI: Clean AI Paste");
  });

  it("supports abbreviation-style queries across words", () => {
    // "fsa" fits both Save entries equally — the shorter title wins the tie.
    expect(filterByFuzzy(titles, "fsa", (t) => t)).toEqual(["File: Save", "File: Save As…"]);
    // A second "s" only exists in "Save As".
    expect(filterByFuzzy(titles, "fsas", (t) => t)).toEqual(["File: Save As…"]);
  });
});
