import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { foldable, ensureSyntaxTree } from "@codemirror/language";
import { rawLanguage } from "../EditorManager";

/**
 * Fold ranges for raw mode. Heading-section folding comes from lang-markdown's
 * own fold service; these tests pin that it survives the yamlFrontmatter
 * wrapping, and cover the frontmatter range we add ourselves.
 */

function stateFor(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: rawLanguage });
  // Fold services read the syntax tree; make sure the whole doc is parsed.
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** Fold range offered on `lineNumber`, or null. */
function foldAt(doc: string, lineNumber: number) {
  const state = stateFor(doc);
  const line = state.doc.line(lineNumber);
  return foldable(state, line.from, line.to);
}

/** The text a fold on `lineNumber` would hide. */
function foldedText(doc: string, lineNumber: number): string | null {
  const range = foldAt(doc, lineNumber);
  return range ? doc.slice(range.from, range.to) : null;
}

describe("heading folding", () => {
  it("folds a section up to the next heading of the same level", () => {
    const doc = "# One\n\nbody\n\n# Two\n\nmore";
    expect(foldedText(doc, 1)).toBe("\n\nbody");
  });

  it("swallows nested deeper headings", () => {
    const doc = "# One\n\na\n\n## Sub\n\nb\n\n# Two";
    expect(foldedText(doc, 1)).toBe("\n\na\n\n## Sub\n\nb");
  });

  it("stops at a higher-level heading", () => {
    const doc = "## Sub\n\na\n\n# Top\n\nb";
    expect(foldedText(doc, 1)).toBe("\n\na");
  });

  it("folds the last section to the end of the document", () => {
    const doc = "# One\n\nbody\n\n# Last\n\ntail";
    expect(foldedText(doc, 5)).toBe("\n\ntail");
  });

  it("excludes trailing blank lines from the range", () => {
    const doc = "# One\n\nbody\n\n\n\n# Two";
    expect(foldedText(doc, 1)).toBe("\n\nbody");
  });

  it("offers nothing on a heading with an empty section", () => {
    const doc = "# One\n# Two\n";
    expect(foldAt(doc, 1)).toBeNull();
  });

  it("offers nothing on an ordinary paragraph line", () => {
    expect(foldAt("# One\n\njust text\n", 3)).toBeNull();
  });

  it("does not treat a # inside a fenced code block as a heading", () => {
    const doc = "# One\n\n```\n# fake\nstill code\n```\n\ntail";
    // The whole document is one section, so folding line 1 keeps the fence.
    expect(foldedText(doc, 1)).toBe("\n\n```\n# fake\nstill code\n```\n\ntail");
    expect(foldAt(doc, 4)).toBeNull();
  });

  it("still folds headings that follow YAML frontmatter", () => {
    const doc = "---\ntitle: Doc\n---\n\n# One\n\nbody\n\n# Two";
    expect(foldedText(doc, 5)).toBe("\n\nbody");
  });
});

describe("frontmatter folding", () => {
  it("folds the whole block from the opening delimiter", () => {
    const doc = "---\ntitle: Doc\ntags: [a, b]\n---\n\n# Heading";
    expect(foldedText(doc, 1)).toBe("\ntitle: Doc\ntags: [a, b]\n---");
  });

  it("folds an empty block", () => {
    expect(foldedText("---\n---\n# H", 1)).toBe("\n---");
  });

  it("offers nothing when the block is never closed", () => {
    expect(foldAt("---\ntitle: Doc\n\n# Heading", 1)).toBeNull();
  });

  it("offers nothing for a --- that is not on line 1", () => {
    expect(foldAt("# Heading\n\n---\ntitle: not frontmatter\n---", 3)).toBeNull();
  });

  it("leaves a mid-document thematic break alone", () => {
    expect(foldAt("intro\n\n---\n\ntail", 3)).toBeNull();
  });
});
