import { EditorSelection, type ChangeSet, type EditorState, type SelectionRange, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Language-agnostic text commands (sort, dedupe, join, case, trim). Each runs
 * as one transaction, so one undo reverts it, and returns false without
 * dispatching when it would change nothing.
 */

// History merges adjacent changes made within 500ms unless the user event is
// non-joinable; a distinct event keeps every command its own undo step.
const USER_EVENT = "input.transform";

/** A run of whole lines: start of its first line to end of its last. */
interface LineBlock {
  readonly from: number;
  readonly to: number;
}

interface Replacement {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

function wholeDocumentBlock(doc: Text): LineBlock {
  // A final newline leaves an empty last line; keeping it out stops sorts from hoisting it.
  const lastNumber = doc.lines > 1 && doc.line(doc.lines).length === 0 ? doc.lines - 1 : doc.lines;
  return { from: 0, to: doc.line(lastNumber).to };
}

function rangeBlock(doc: Text, range: SelectionRange): LineBlock {
  const first = doc.lineAt(range.from);
  let last = doc.lineAt(range.to);
  // A selection that ends at column 0 does not touch that line.
  if (range.to === last.from && last.number > first.number) last = doc.line(last.number - 1);
  return { from: first.from, to: last.to };
}

/** Line blocks of the non-empty ranges; ranges sharing a line share a block. */
function selectedBlocks(state: EditorState): LineBlock[] {
  const blocks: LineBlock[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    const block = rangeBlock(state.doc, range);
    const prev = blocks[blocks.length - 1];
    if (prev && block.from <= prev.to) {
      blocks[blocks.length - 1] = { from: prev.from, to: Math.max(prev.to, block.to) };
    } else {
      blocks.push(block);
    }
  }
  return blocks;
}

/** Keep each cursor on its line number and column, clamped to the new document. */
function cursorsByLine(state: EditorState, newDoc: Text): EditorSelection {
  const ranges = state.selection.ranges.map((range) => {
    const line = state.doc.lineAt(range.head);
    const target = newDoc.line(Math.min(line.number, newDoc.lines));
    return EditorSelection.cursor(target.from + Math.min(range.head - line.from, target.length));
  });
  return EditorSelection.create(ranges, state.selection.mainIndex);
}

/** Each non-empty range selects its whole (rewritten) block; cursors are mapped. */
function blockSelection(state: EditorState, blocks: readonly LineBlock[], changes: ChangeSet): EditorSelection {
  const ranges = state.selection.ranges.map((range) => {
    if (range.empty) return range.map(changes);
    const block = blocks.find((b) => b.from <= range.from && range.from <= b.to);
    if (!block) return range.map(changes);
    const from = changes.mapPos(block.from, -1);
    const to = changes.mapPos(block.to, 1);
    return range.anchor > range.head ? EditorSelection.range(to, from) : EditorSelection.range(from, to);
  });
  return EditorSelection.create(ranges, state.selection.mainIndex);
}

/**
 * Rewrite the lines touched by the selection — or, when every range is empty,
 * the whole document — one block at a time.
 */
function transformLines(view: EditorView, transform: (lines: string[]) => string[]): boolean {
  const { state } = view;
  const wholeDocument = state.selection.ranges.every((r) => r.empty);
  const blocks = wholeDocument ? [wholeDocumentBlock(state.doc)] : selectedBlocks(state);

  const replacements: Replacement[] = [];
  for (const block of blocks) {
    const before = state.sliceDoc(block.from, block.to);
    const after = transform(before.split(state.lineBreak)).join(state.lineBreak);
    if (after !== before) replacements.push({ from: block.from, to: block.to, insert: after });
  }
  if (replacements.length === 0) return false;

  const changes = state.changes(replacements);
  view.dispatch({
    changes,
    selection: wholeDocument ? cursorsByLine(state, changes.apply(state.doc)) : blockSelection(state, blocks, changes),
    userEvent: USER_EVENT,
  });
  return true;
}

const lineCollator = new Intl.Collator(undefined, { numeric: true });

export function sortLinesAscending(view: EditorView): boolean {
  return transformLines(view, (lines) => [...lines].sort(lineCollator.compare));
}

export function sortLinesDescending(view: EditorView): boolean {
  return transformLines(view, (lines) => [...lines].sort((a, b) => lineCollator.compare(b, a)));
}

/** Drop repeated lines, keeping each line's first occurrence in place. */
export function uniqueLines(view: EditorView): boolean {
  return transformLines(view, (lines) => {
    const seen = new Set<string>();
    return lines.filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  });
}

/**
 * Join the lines into one, separated by single spaces. The first line keeps its
 * indentation; blank lines and the whitespace around each break are dropped.
 */
export function joinLines(view: EditorView): boolean {
  return transformLines(view, (lines) => {
    if (lines.length < 2) return lines;
    const first = lines[0];
    const indent = first.slice(0, first.length - first.trimStart().length);
    return [indent + lines.map((line) => line.trim()).filter((line) => line).join(" ")];
  });
}

/** Selected ranges, or the word under each empty cursor; overlaps merged, in document order. */
function caseTargets(state: EditorState): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    const span = range.empty ? state.wordAt(range.head) : range;
    if (span) spans.push({ from: span.from, to: span.to });
  }
  spans.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && span.from < prev.to) prev.to = Math.max(prev.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Case mapping can change length ("ß" → "SS"), so positions inside a rewritten
 * span keep their offset from its start, clamped to the new text.
 */
function transformCase(view: EditorView, transform: (text: string) => string): boolean {
  const { state } = view;
  const replacements: Replacement[] = [];
  for (const span of caseTargets(state)) {
    const before = state.sliceDoc(span.from, span.to);
    const after = transform(before);
    if (after !== before) replacements.push({ from: span.from, to: span.to, insert: after });
  }
  if (replacements.length === 0) return false;

  const changes = state.changes(replacements);
  const mapPos = (pos: number): number => {
    const hit = replacements.find((r) => r.from <= pos && pos <= r.to);
    if (!hit) return changes.mapPos(pos);
    const start = changes.mapPos(hit.from, -1);
    return start + (pos === hit.to ? hit.insert.length : Math.min(pos - hit.from, hit.insert.length));
  };
  const ranges = state.selection.ranges.map((r) => EditorSelection.range(mapPos(r.anchor), mapPos(r.head)));
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    userEvent: USER_EVENT,
  });
  return true;
}

export function transformUpperCase(view: EditorView): boolean {
  return transformCase(view, (text) => text.toUpperCase());
}

export function transformLowerCase(view: EditorView): boolean {
  return transformCase(view, (text) => text.toLowerCase());
}

/** Capitalise the first letter of every word and lowercase the rest; apostrophes stay inside words. */
export function transformTitleCase(view: EditorView): boolean {
  return transformCase(view, (text) =>
    text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase()),
  );
}

/** Strip trailing whitespace from every line of the document; cursors stay on their lines. */
export function trimTrailingWhitespace(view: EditorView): boolean {
  const { state } = view;
  const deletions: { from: number; to: number }[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const trailing = /\s+$/.exec(line.text);
    if (trailing) deletions.push({ from: line.from + trailing.index, to: line.to });
  }
  if (deletions.length === 0) return false;
  view.dispatch({ changes: deletions, userEvent: USER_EVENT });
  return true;
}
