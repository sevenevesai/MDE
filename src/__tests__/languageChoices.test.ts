import { describe, it, expect } from "vitest";
import { languageChoices } from "../languageChoices";

describe("languageChoices", () => {
  it("offers auto-detect with the detected language first, current without an override", () => {
    const choices = languageChoices({ languageOverride: null, filePath: "/src/app.json", title: "app.json" });
    expect(choices[0]).toEqual({ key: "auto", title: "Auto-detect (JSON)", current: true, override: null });
    expect(choices.filter((c) => c.current)).toHaveLength(1);
    expect(choices.some((c) => c.title === "Python" && c.override === "Python")).toBe(true);
  });

  it("marks the override as current", () => {
    const choices = languageChoices({ languageOverride: "Python", filePath: null, title: "Untitled-1.md" });
    expect(choices[0]).toMatchObject({ title: "Auto-detect (Markdown)", current: false });
    expect(choices.filter((c) => c.current).map((c) => c.key)).toEqual(["Python"]);
  });
});
