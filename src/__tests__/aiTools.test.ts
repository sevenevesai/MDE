import { describe, it, expect } from "vitest";
import { buildCopyForAI, cleanAIText, formatTable, isSeparatorRow } from "../aiTools";

// ─── Copy for AI ────────────────────────────────────────

describe("buildCopyForAI", () => {
  it("puts the path first, then a fenced markdown block", () => {
    expect(buildCopyForAI("/docs/notes.md", "hello world")).toBe(
      "/docs/notes.md\n```markdown\nhello world\n```"
    );
  });

  it("uses a tab title when there is no path", () => {
    expect(buildCopyForAI("Untitled-1.md", "content")).toBe(
      "Untitled-1.md\n```markdown\ncontent\n```"
    );
  });

  it("grows the fence past an embedded triple-backtick block", () => {
    const content = "```\ncode\n```";
    expect(buildCopyForAI("t.md", content)).toBe(
      "t.md\n````markdown\n```\ncode\n```\n````"
    );
  });

  it("grows the fence past a four-backtick run", () => {
    const content = "a ```` b";
    expect(buildCopyForAI("t.md", content)).toBe(
      "t.md\n`````markdown\na ```` b\n`````"
    );
  });
});

// ─── Clean AI Paste ─────────────────────────────────────

describe("cleanAIText", () => {
  it("strips zero-width characters", () => {
    const r = cleanAIText("a​b‌c‍d﻿e");
    expect(r.text).toBe("abcde");
    expect(r.count).toBe(4);
  });

  it("converts non-breaking spaces to regular spaces", () => {
    const r = cleanAIText("a b");
    expect(r.text).toBe("a b");
    expect(r.count).toBe(1);
  });

  it("normalizes curly quotes to straight quotes", () => {
    const r = cleanAIText("‘x’ “y”");
    expect(r.text).toBe("'x' \"y\"");
    expect(r.count).toBe(4);
  });

  it("reports nothing to clean for already-clean text", () => {
    const r = cleanAIText("plain 'text' with \"quotes\"");
    expect(r.text).toBe("plain 'text' with \"quotes\"");
    expect(r.count).toBe(0);
  });
});

// ─── Table separator detection ──────────────────────────

describe("isSeparatorRow", () => {
  it("recognizes alignment rows", () => {
    expect(isSeparatorRow("| --- | :--: | ---: |")).toBe(true);
    expect(isSeparatorRow("|:-|")).toBe(true);
  });

  it("rejects content rows", () => {
    expect(isSeparatorRow("| a | b |")).toBe(false);
    expect(isSeparatorRow("| 1 | 2 |")).toBe(false);
  });
});

// ─── Table formatter ────────────────────────────────────

describe("formatTable", () => {
  it("pads cells to the per-column max width", () => {
    const src = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(formatTable(src)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |"
    );
  });

  it("preserves and normalizes column alignment", () => {
    const src = "| Name | Age |\n| :--- | ---: |\n| Al | 3 |";
    expect(formatTable(src)).toBe(
      "| Name | Age |\n| :--- | --: |\n| Al   |   3 |"
    );
  });

  it("centers content for a centered column", () => {
    const src = "| h |\n| :-: |\n| xx |";
    expect(formatTable(src)).toBe(
      "|  h  |\n| :-: |\n| xx  |"
    );
  });

  it("aligns unicode content by code point count", () => {
    const src = "| café | x |\n| --- | --- |\n| naïve | y |";
    expect(formatTable(src)).toBe(
      "| café  | x   |\n| ----- | --- |\n| naïve | y   |"
    );
  });

  it("normalizes tables written without outer pipes", () => {
    const src = "a | b\n--- | ---\nlong | y";
    expect(formatTable(src)).toBe(
      "| a    | b   |\n| ---- | --- |\n| long | y   |"
    );
  });
});
