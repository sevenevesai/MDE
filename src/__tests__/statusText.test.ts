import { describe, it, expect } from "vitest";
import { selectionSummary, indentLabel } from "../statusText";

describe("selectionSummary", () => {
  it("counts cursors when there are several", () => {
    expect(selectionSummary(3, 0)).toBe("3 selections");
    expect(selectionSummary(2, 40)).toBe("2 selections");
  });

  it("counts selected characters for one selection", () => {
    expect(selectionSummary(1, 128)).toBe("128 selected");
  });

  it("is empty for a plain cursor", () => {
    expect(selectionSummary(1, 0)).toBeNull();
  });
});

describe("indentLabel", () => {
  it("names spaces or tabs with the width", () => {
    expect(indentLabel({ indentSize: 2, indentWithTabs: false })).toBe("Spaces: 2");
    expect(indentLabel({ indentSize: 4, indentWithTabs: true })).toBe("Tabs: 4");
  });
});
