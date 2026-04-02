import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  insertImage,
  setHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleBlockquote,
  insertCodeBlock,
  insertHorizontalRule,
} from "../commands";

/** Create a minimal EditorView with given doc and optional selection. */
function makeView(doc: string, from?: number, to?: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: from !== undefined
      ? EditorSelection.single(from, to ?? from)
      : EditorSelection.single(0),
  });
  return new EditorView({ state });
}

/** Get the doc text and selection from a view after a command runs. */
function result(view: EditorView) {
  const doc = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  return { doc, from, to, selected: view.state.sliceDoc(from, to) };
}

// ─── Bold ───────────────────────────────────────────────

describe("toggleBold", () => {
  it("wraps selected text with **", () => {
    const view = makeView("hello world", 6, 11);
    toggleBold(view);
    const r = result(view);
    expect(r.doc).toBe("hello **world**");
    expect(r.selected).toBe("world");
  });

  it("inserts placeholder when no selection", () => {
    const view = makeView("hello ", 6);
    toggleBold(view);
    const r = result(view);
    expect(r.doc).toBe("hello **text**");
    expect(r.selected).toBe("text");
  });

  it("unwraps already-bold text", () => {
    const view = makeView("hello **world**", 8, 13);
    toggleBold(view);
    const r = result(view);
    expect(r.doc).toBe("hello world");
    expect(r.selected).toBe("world");
  });
});

// ─── Italic ─────────────────────────────────────────────

describe("toggleItalic", () => {
  it("wraps selected text with *", () => {
    const view = makeView("hello world", 6, 11);
    toggleItalic(view);
    const r = result(view);
    expect(r.doc).toBe("hello *world*");
    expect(r.selected).toBe("world");
  });

  it("unwraps already-italic text", () => {
    const view = makeView("hello *world*", 7, 12);
    toggleItalic(view);
    const r = result(view);
    expect(r.doc).toBe("hello world");
    expect(r.selected).toBe("world");
  });
});

// ─── Strikethrough ──────────────────────────────────────

describe("toggleStrikethrough", () => {
  it("wraps selected text with ~~", () => {
    const view = makeView("hello world", 6, 11);
    toggleStrikethrough(view);
    const r = result(view);
    expect(r.doc).toBe("hello ~~world~~");
    expect(r.selected).toBe("world");
  });

  it("unwraps already-strikethrough text", () => {
    const view = makeView("hello ~~world~~", 8, 13);
    toggleStrikethrough(view);
    const r = result(view);
    expect(r.doc).toBe("hello world");
    expect(r.selected).toBe("world");
  });
});

// ─── Inline Code ────────────────────────────────────────

describe("toggleInlineCode", () => {
  it("wraps selected text with backticks", () => {
    const view = makeView("use foo here", 4, 7);
    toggleInlineCode(view);
    const r = result(view);
    expect(r.doc).toBe("use `foo` here");
    expect(r.selected).toBe("foo");
  });

  it("unwraps already-code text", () => {
    const view = makeView("use `foo` here", 5, 8);
    toggleInlineCode(view);
    const r = result(view);
    expect(r.doc).toBe("use foo here");
    expect(r.selected).toBe("foo");
  });
});

// ─── Links ──────────────────────────────────────────────

describe("insertLink", () => {
  it("wraps selected text as link text, selects url placeholder", () => {
    const view = makeView("click here", 6, 10);
    insertLink(view);
    const r = result(view);
    expect(r.doc).toBe("click [here](url)");
    expect(r.selected).toBe("url");
  });

  it("inserts full link template with no selection", () => {
    const view = makeView("hello ", 6);
    insertLink(view);
    const r = result(view);
    expect(r.doc).toBe("hello [text](url)");
    expect(r.selected).toBe("text");
  });
});

// ─── Image ──────────────────────────────────────────────

describe("insertImage", () => {
  it("inserts image template with placeholder", () => {
    const view = makeView("", 0);
    insertImage(view);
    const r = result(view);
    expect(r.doc).toBe("![alt text](url)");
    expect(r.selected).toBe("alt text");
  });

  it("uses selected text as alt text", () => {
    const view = makeView("my photo", 0, 8);
    insertImage(view);
    const r = result(view);
    expect(r.doc).toBe("![my photo](url)");
    expect(r.selected).toBe("my photo");
  });
});

// ─── Headings ───────────────────────────────────────────

describe("setHeading", () => {
  it("adds H1 prefix", () => {
    const view = makeView("Title", 0, 5);
    setHeading(view, 1);
    expect(result(view).doc).toBe("# Title");
  });

  it("adds H3 prefix", () => {
    const view = makeView("Section", 0, 7);
    setHeading(view, 3);
    expect(result(view).doc).toBe("### Section");
  });

  it("toggles off existing heading of same level", () => {
    const view = makeView("## Title", 0, 8);
    setHeading(view, 2);
    expect(result(view).doc).toBe("Title");
  });

  it("replaces heading level (H1 -> H2)", () => {
    const view = makeView("# Title", 0, 7);
    setHeading(view, 2);
    expect(result(view).doc).toBe("## Title");
  });

  it("replaces heading level (H3 -> H1)", () => {
    const view = makeView("### Title", 0, 9);
    setHeading(view, 1);
    expect(result(view).doc).toBe("# Title");
  });
});

// ─── Bullet List ────────────────────────────────────────

describe("toggleBulletList", () => {
  it("adds bullet prefix to a line", () => {
    const view = makeView("item one", 0, 8);
    toggleBulletList(view);
    expect(result(view).doc).toBe("- item one");
  });

  it("removes bullet prefix (toggle off)", () => {
    const view = makeView("- item one", 0, 10);
    toggleBulletList(view);
    expect(result(view).doc).toBe("item one");
  });

  it("handles multiple lines", () => {
    const view = makeView("apple\nbanana\ncherry", 0, 19);
    toggleBulletList(view);
    expect(result(view).doc).toBe("- apple\n- banana\n- cherry");
  });
});

// ─── Ordered List ───────────────────────────────────────

describe("toggleOrderedList", () => {
  it("adds numbered prefix to lines", () => {
    const view = makeView("apple\nbanana\ncherry", 0, 19);
    toggleOrderedList(view);
    expect(result(view).doc).toBe("1. apple\n2. banana\n3. cherry");
  });

  it("removes numbered prefix (toggle off)", () => {
    const view = makeView("1. apple\n2. banana", 0, 18);
    toggleOrderedList(view);
    expect(result(view).doc).toBe("apple\nbanana");
  });
});

// ─── Blockquote ─────────────────────────────────────────

describe("toggleBlockquote", () => {
  it("adds blockquote prefix", () => {
    const view = makeView("some text", 0, 9);
    toggleBlockquote(view);
    expect(result(view).doc).toBe("> some text");
  });

  it("removes blockquote prefix (toggle off)", () => {
    const view = makeView("> some text", 0, 11);
    toggleBlockquote(view);
    expect(result(view).doc).toBe("some text");
  });

  it("handles multiple lines", () => {
    const view = makeView("line one\nline two", 0, 17);
    toggleBlockquote(view);
    expect(result(view).doc).toBe("> line one\n> line two");
  });
});

// ─── Code Block ─────────────────────────────────────────

describe("insertCodeBlock", () => {
  it("inserts code block on empty line", () => {
    const view = makeView("", 0);
    insertCodeBlock(view);
    expect(result(view).doc).toBe("```\n\n```\n");
  });

  it("inserts code block after non-empty line", () => {
    const view = makeView("some text", 5);
    insertCodeBlock(view);
    expect(result(view).doc).toBe("some text\n```\n\n```\n");
  });
});

// ─── Horizontal Rule ────────────────────────────────────

describe("insertHorizontalRule", () => {
  it("inserts --- on empty line", () => {
    const view = makeView("", 0);
    insertHorizontalRule(view);
    expect(result(view).doc).toBe("---\n");
  });

  it("inserts --- after non-empty line", () => {
    const view = makeView("paragraph", 5);
    insertHorizontalRule(view);
    expect(result(view).doc).toBe("paragraph\n---\n");
  });
});
