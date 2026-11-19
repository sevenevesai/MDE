import { describe, it, expect, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
  sortLinesAscending,
  sortLinesDescending,
  uniqueLines,
  joinLines,
  transformUpperCase,
  transformLowerCase,
  transformTitleCase,
  trimTrailingWhitespace,
} from "../textCommands";

const views: EditorView[] = [];

// A live view schedules a layout measure that jsdom cannot perform (no Range.getClientRects).
afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
});

/** A view over `doc` with the given [anchor, head] ranges (default: one cursor at 0). */
function makeView(doc: string, ranges: [number, number][] = [[0, 0]]): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))),
    extensions: [EditorState.allowMultipleSelections.of(true), history()],
  });
  const view = new EditorView({ state });
  views.push(view);
  return view;
}

const docOf = (view: EditorView): string => view.state.doc.toString();
const rangesOf = (view: EditorView): [number, number][] =>
  view.state.selection.ranges.map((r) => [r.anchor, r.head]);

/** Runs `command`, asserting it reports no change and leaves the state untouched. */
function expectNoop(view: EditorView, command: (v: EditorView) => boolean) {
  const before = view.state;
  expect(command(view)).toBe(false);
  expect(view.state).toBe(before);
}

/** One undo must restore the original document. */
function expectSingleUndo(view: EditorView, original: string) {
  undo(view);
  expect(docOf(view)).toBe(original);
}

describe("sortLinesAscending", () => {
  it("sorts the whole document when the selection is empty", () => {
    const view = makeView("banana\napple\ncherry");
    expect(sortLinesAscending(view)).toBe(true);
    expect(docOf(view)).toBe("apple\nbanana\ncherry");
    expectSingleUndo(view, "banana\napple\ncherry");
  });

  it("leaves a final newline at the end", () => {
    const view = makeView("b\na\n");
    sortLinesAscending(view);
    expect(docOf(view)).toBe("a\nb\n");
  });

  it("orders numbers naturally", () => {
    const view = makeView("item10\nitem2\nitem1");
    sortLinesAscending(view);
    expect(docOf(view)).toBe("item1\nitem2\nitem10");
  });

  it("keeps each cursor on its line number in whole-document mode", () => {
    const view = makeView("b\na\nc", [[2, 2]]); // line 2, column 0
    sortLinesAscending(view);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
  });

  it("sorts only the lines touched by the selection and selects them", () => {
    const doc = "z\ncc\nbb\naa\ny";
    // From inside line 2 to inside line 4.
    const view = makeView(doc, [[3, 10]]);
    sortLinesAscending(view);
    expect(docOf(view)).toBe("z\naa\nbb\ncc\ny");
    expect(rangesOf(view)).toEqual([[2, 10]]);
  });

  it("ignores a line the selection only reaches at column 0", () => {
    const view = makeView("c\nb\na\n", [[0, 4]]);
    sortLinesAscending(view);
    expect(docOf(view)).toBe("b\nc\na\n");
  });

  it("sorts each selected block independently in one transaction", () => {
    const doc = "b\na\nx\nd\nc";
    const view = makeView(doc, [[0, 3], [6, 9]]);
    sortLinesAscending(view);
    expect(docOf(view)).toBe("a\nb\nx\nc\nd");
    expect(view.state.selection.ranges).toHaveLength(2);
    expectSingleUndo(view, doc);
  });

  it("merges ranges that share a line into one block", () => {
    // "c" on line 1, and from "x" on line 1 to the end of line 3.
    const view = makeView("c x\nb\na", [[0, 1], [2, 7]]);
    sortLinesAscending(view);
    expect(docOf(view)).toBe("a\nb\nc x");
  });

  it("does nothing when the lines are already sorted", () => {
    expectNoop(makeView("a\nb\nc"), sortLinesAscending);
    expectNoop(makeView(""), sortLinesAscending);
  });
});

describe("sortLinesDescending", () => {
  it("sorts the whole document in reverse order", () => {
    const view = makeView("a\nc\nb\n");
    expect(sortLinesDescending(view)).toBe(true);
    expect(docOf(view)).toBe("c\nb\na\n");
  });

  it("does nothing when already descending", () => {
    expectNoop(makeView("c\nb\na"), sortLinesDescending);
  });
});

describe("uniqueLines", () => {
  it("keeps the first occurrence of each line, in order", () => {
    const view = makeView("b\na\nb\nc\na");
    expect(uniqueLines(view)).toBe(true);
    expect(docOf(view)).toBe("b\na\nc");
    expectSingleUndo(view, "b\na\nb\nc\na");
  });

  it("compares lines exactly", () => {
    expectNoop(makeView("a\nA\na "), uniqueLines);
  });

  it("only dedupes inside the selected lines", () => {
    const view = makeView("x\nx\ny\ny", [[4, 7]]);
    uniqueLines(view);
    expect(docOf(view)).toBe("x\nx\ny");
  });
});

describe("joinLines", () => {
  it("joins the selected lines with single spaces, keeping the first indent", () => {
    const doc = "head\n  foo\n     bar  \n\nbaz\ntail";
    const view = makeView(doc, [[5, 24]]);
    expect(joinLines(view)).toBe(true);
    expect(docOf(view)).toBe("head\n  foo bar baz\ntail");
    expectSingleUndo(view, doc);
  });

  it("joins the whole document when the selection is empty", () => {
    const view = makeView("a\nb\nc\n");
    joinLines(view);
    expect(docOf(view)).toBe("a b c\n");
  });

  it("does nothing for a selection inside one line", () => {
    expectNoop(makeView("one two\nthree", [[0, 3]]), joinLines);
  });
});

describe("case transforms", () => {
  it("uppercases the selection and keeps it selected", () => {
    const view = makeView("hello world", [[0, 5]]);
    expect(transformUpperCase(view)).toBe(true);
    expect(docOf(view)).toBe("HELLO world");
    expect(rangesOf(view)).toEqual([[0, 5]]);
  });

  it("uppercases the word under an empty cursor without moving it", () => {
    const view = makeView("hello world", [[8, 8]]);
    transformUpperCase(view);
    expect(docOf(view)).toBe("hello WORLD");
    expect(rangesOf(view)).toEqual([[8, 8]]);
  });

  it("transforms the word under every cursor in one transaction", () => {
    const view = makeView("one two three", [[1, 1], [9, 9]]);
    transformUpperCase(view);
    expect(docOf(view)).toBe("ONE two THREE");
    expect(rangesOf(view)).toEqual([[1, 1], [9, 9]]);
    expectSingleUndo(view, "one two three");
  });

  it("handles two cursors in the same word", () => {
    const view = makeView("alpha beta", [[1, 1], [3, 3]]);
    transformUpperCase(view);
    expect(docOf(view)).toBe("ALPHA beta");
  });

  it("keeps the selection covering text whose length changes", () => {
    const view = makeView("straße x", [[0, 6]]);
    transformUpperCase(view);
    expect(docOf(view)).toBe("STRASSE x");
    expect(rangesOf(view)).toEqual([[0, 7]]);
  });

  it("lowercases", () => {
    const view = makeView("MiXeD Case", [[0, 10]]);
    expect(transformLowerCase(view)).toBe(true);
    expect(docOf(view)).toBe("mixed case");
  });

  it("title-cases words, keeping apostrophes and digits inside words", () => {
    const view = makeView("the QUICK brown fox's tail-end 3rd_place", [[0, 40]]);
    expect(transformTitleCase(view)).toBe(true);
    expect(docOf(view)).toBe("The Quick Brown Fox's Tail-End 3rd_Place");
  });

  it("does nothing when the text already has that case", () => {
    expectNoop(makeView("HELLO", [[0, 5]]), transformUpperCase);
    expectNoop(makeView("Title Case", [[0, 10]]), transformTitleCase);
  });

  it("does nothing when an empty cursor is not on a word", () => {
    expectNoop(makeView("a   b", [[2, 2]]), transformUpperCase);
  });
});

describe("trimTrailingWhitespace", () => {
  it("strips trailing spaces and tabs from every line", () => {
    const doc = "a  \nb\t\n  c\n   \nd";
    const view = makeView(doc);
    expect(trimTrailingWhitespace(view)).toBe(true);
    expect(docOf(view)).toBe("a\nb\n  c\n\nd");
    expectSingleUndo(view, doc);
  });

  it("acts on the whole document even with a selection", () => {
    const view = makeView("a \nb ", [[0, 1]]);
    trimTrailingWhitespace(view);
    expect(docOf(view)).toBe("a\nb");
  });

  it("keeps a cursor inside trailing whitespace on its line", () => {
    const view = makeView("ab   \ncd", [[5, 5]]); // end of line 1
    trimTrailingWhitespace(view);
    const head = view.state.selection.main.head;
    expect(head).toBe(2);
    expect(view.state.doc.lineAt(head).number).toBe(1);
  });

  it("does nothing when no line has trailing whitespace", () => {
    expectNoop(makeView("a\n  b\nc"), trimTrailingWhitespace);
  });
});
