import { describe, it, expect } from "vitest";
import { extractOutline, frontmatterRange } from "../outline";

const titles = (md: string) => extractOutline(md).map((h) => `${h.level}:${h.text}`);

describe("extractOutline", () => {
  it("returns nothing for an empty or heading-free document", () => {
    expect(extractOutline("")).toEqual([]);
    expect(extractOutline("just a paragraph\n\nand another")).toEqual([]);
  });

  it("extracts all six ATX levels in document order", () => {
    const md = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six";
    expect(titles(md)).toEqual(["1:One", "2:Two", "3:Three", "4:Four", "5:Five", "6:Six"]);
  });

  it("reports 1-based line numbers and the offset of the heading line", () => {
    const md = "intro\n\n## Section\ntext";
    const [heading] = extractOutline(md);
    expect(heading.line).toBe(3);
    expect(md.slice(heading.from, heading.from + 10)).toBe("## Section");
  });

  it("handles CRLF documents", () => {
    const md = "# One\r\n\r\ntext\r\n## Two\r\n";
    const items = extractOutline(md);
    expect(titles(md)).toEqual(["1:One", "2:Two"]);
    expect(items[1].line).toBe(4);
    expect(md.slice(items[1].from, items[1].from + 5)).toBe("## Tw");
  });

  it("ignores headings inside backtick fences", () => {
    const md = "# Real\n\n```\n# Fake\n## Also fake\n```\n\n## Real Too";
    expect(titles(md)).toEqual(["1:Real", "2:Real Too"]);
  });

  it("ignores headings inside tilde fences and fences with info strings", () => {
    const md = "~~~\n# Fake\n~~~\n\n```md\n### Fake\n```\n\n# Real";
    expect(titles(md)).toEqual(["1:Real"]);
  });

  it("only closes a fence with the same marker, at least as long, and bare", () => {
    const md = "````\n# Fake\n```\n# Still fake\n````\n# Real";
    expect(titles(md)).toEqual(["1:Real"]);
  });

  it("treats an unclosed fence as running to the end of the document", () => {
    expect(titles("# Real\n\n```\n# Fake\n\n## Fake too")).toEqual(["1:Real"]);
  });

  it("requires a space after the marker and at most six #", () => {
    expect(titles("#hashtag\n####### seven\n# ok")).toEqual(["1:ok"]);
  });

  it("accepts a bare marker as an empty heading", () => {
    expect(titles("#\n## ")).toEqual(["1:", "2:"]);
  });

  it("allows up to three leading spaces but not four", () => {
    expect(titles("   # indented\n    # code")).toEqual(["1:indented"]);
  });

  it("strips a closing marker sequence", () => {
    expect(titles("## Title ##\n## Trailing# \n## Hash ###hash")).toEqual([
      "2:Title",
      "2:Trailing#",
      "2:Hash ###hash",
    ]);
  });

  it("skips comments inside YAML frontmatter", () => {
    const md = "---\ntitle: Doc\n# not a heading\n---\n\n# Real";
    expect(titles(md)).toEqual(["1:Real"]);
  });

  it("does not treat an unclosed leading --- as frontmatter", () => {
    expect(titles("---\n# Heading")).toEqual(["1:Heading"]);
  });

  it("stays cheap on a large document", () => {
    const md = Array.from({ length: 50_000 }, (_, i) =>
      i % 100 === 0 ? `## Section ${i}` : "body text on an ordinary line"
    ).join("\n");
    const started = performance.now();
    const items = extractOutline(md);
    expect(items).toHaveLength(500);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("frontmatterRange", () => {
  it("finds a delimited block at the top of the document", () => {
    const md = "---\ntitle: Doc\n---\n\n# Heading";
    expect(frontmatterRange(md)).toEqual({ from: 0, to: md.indexOf("\n\n# Heading") });
  });

  it("ends at the first closing delimiter", () => {
    const md = "---\na: 1\n---\nbody\n---\nmore";
    expect(frontmatterRange(md)).toEqual({ from: 0, to: 12 });
    expect(md.slice(0, 12)).toBe("---\na: 1\n---");
  });

  it("excludes the CR of a CRLF line ending", () => {
    const md = "---\r\ntitle: Doc\r\n---\r\n# Heading";
    const range = frontmatterRange(md);
    expect(range).not.toBeNull();
    expect(md.slice(range!.to, range!.to + 2)).toBe("\r\n");
  });

  it("returns null without an opening or closing delimiter", () => {
    expect(frontmatterRange("# Heading\n---\na: 1\n---")).toBeNull();
    expect(frontmatterRange("---\ntitle: Doc\n")).toBeNull();
    expect(frontmatterRange("")).toBeNull();
    expect(frontmatterRange("--- \na: 1\n---")).toBeNull();
  });

  it("allows an empty block", () => {
    expect(frontmatterRange("---\n---\n# H")).toEqual({ from: 0, to: 7 });
  });
});
