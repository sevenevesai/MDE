import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { formatTable, isSeparatorRow } from "../aiTools";

/**
 * Markdown formatting commands for CodeMirror.
 * Each command wraps or prefixes the selection with markdown syntax.
 */

/** Wrap selection with a marker (e.g. ** for bold, * for italic) */
function wrapSelection(view: EditorView, marker: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  // Check if already wrapped — unwrap if so
  const beforeStart = Math.max(0, from - marker.length);
  const afterEnd = Math.min(state.doc.length, to + marker.length);
  const before = state.sliceDoc(beforeStart, from);
  const after = state.sliceDoc(to, afterEnd);

  if (before === marker && after === marker) {
    // Unwrap
    view.dispatch({
      changes: [
        { from: beforeStart, to: from, insert: "" },
        { from: to, to: afterEnd, insert: "" },
      ],
      selection: EditorSelection.single(beforeStart, beforeStart + selected.length),
    });
    return true;
  }

  // Wrap
  const insert = `${marker}${selected || "text"}${marker}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: selected
      ? EditorSelection.single(from + marker.length, from + marker.length + selected.length)
      : EditorSelection.single(from + marker.length, from + marker.length + 4), // select "text"
  });
  return true;
}

/** Prefix line(s) with a string (e.g. "# " for heading, "> " for quote) */
function prefixLines(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i);
    const text = line.text;

    // Check if already prefixed — toggle off
    if (text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      // Remove existing heading prefixes if adding a heading
      if (prefix.startsWith("#")) {
        const headingMatch = text.match(/^#{1,6}\s/);
        if (headingMatch) {
          changes.push({ from: line.from, to: line.from + headingMatch[0].length, insert: prefix });
          continue;
        }
      }
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  view.dispatch({ changes });
  return true;
}

/** Insert a snippet at cursor (e.g. link, image, code block) */
function insertSnippet(view: EditorView, before: string, placeholder: string, after: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  const content = selected || placeholder;
  const insert = `${before}${content}${after}`;

  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.single(from + before.length, from + before.length + content.length),
  });
  return true;
}

/** Insert a block element (code block, horizontal rule) on its own line */
function insertBlock(view: EditorView, block: string): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);

  // If current line is not empty, insert after it
  const insertAt = line.text.trim() === "" ? line.from : line.to;
  const prefix = line.text.trim() === "" ? "" : "\n";

  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: `${prefix}${block}\n` },
  });
  return true;
}

// --- Public commands ---

export function toggleBold(view: EditorView): boolean {
  return wrapSelection(view, "**");
}

export function toggleItalic(view: EditorView): boolean {
  return wrapSelection(view, "*");
}

export function toggleStrikethrough(view: EditorView): boolean {
  return wrapSelection(view, "~~");
}

export function toggleInlineCode(view: EditorView): boolean {
  return wrapSelection(view, "`");
}

export function insertLink(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);

  if (selected) {
    // Wrap selected text as link text
    const insert = `[${selected}](url)`;
    view.dispatch({
      changes: { from, to, insert },
      // Select "url" for easy replacement
      selection: EditorSelection.single(from + selected.length + 3, from + selected.length + 6),
    });
  } else {
    return insertSnippet(view, "[", "text", "](url)");
  }
  return true;
}

export function insertImage(view: EditorView): boolean {
  return insertSnippet(view, "![", "alt text", "](url)");
}

export function setHeading(view: EditorView, level: number): boolean {
  const prefix = "#".repeat(level) + " ";
  return prefixLines(view, prefix);
}

export function toggleBulletList(view: EditorView): boolean {
  return prefixLines(view, "- ");
}

export function toggleOrderedList(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i);
    const text = line.text;
    const num = i - fromLine.number + 1;

    // Check if already a numbered list item
    const match = text.match(/^\d+\.\s/);
    if (match) {
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    } else {
      changes.push({ from: line.from, to: line.from, insert: `${num}. ` });
    }
  }

  view.dispatch({ changes });
  return true;
}

export function toggleBlockquote(view: EditorView): boolean {
  return prefixLines(view, "> ");
}

export function insertCodeBlock(view: EditorView): boolean {
  return insertBlock(view, "```\n\n```");
}

export function insertHorizontalRule(view: EditorView): boolean {
  return insertBlock(view, "---");
}

/** Transform a single line for the checkbox toggle. */
function toggleCheckboxLine(text: string): string {
  if (text.trim() === "") return text; // leave blank lines untouched

  // Existing checkbox — flip its state.
  const checkbox = text.match(/^(\s*)([-*]|\d+\.)\s+\[([ xX])\]\s*(.*)$/);
  if (checkbox) {
    const [, indent, marker, mark, rest] = checkbox;
    const next = mark === " " ? "x" : " ";
    return rest ? `${indent}${marker} [${next}] ${rest}` : `${indent}${marker} [${next}]`;
  }

  // List item without a checkbox — insert an unchecked box.
  const item = text.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (item) {
    const [, indent, marker, rest] = item;
    return rest ? `${indent}${marker} [ ] ${rest}` : `${indent}${marker} [ ]`;
  }

  // Plain line — turn into an unchecked list item.
  const plain = text.match(/^(\s*)(.*)$/)!;
  const [, indent, rest] = plain;
  return `${indent}- [ ] ${rest}`;
}

/**
 * Toggle GitHub task-list checkboxes across the selected lines:
 * `- [ ]` ⇄ `- [x]`, plain list items gain a `[ ]`, and other lines become
 * unchecked list items. Supports -, * and ordered (1.) list markers.
 */
export function toggleCheckbox(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);

  const changes: { from: number; to: number; insert: string }[] = [];
  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i);
    const next = toggleCheckboxLine(line.text);
    if (next !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: next });
    }
  }
  if (changes.length === 0) return false;

  view.dispatch({ changes });
  return true;
}

/**
 * If the cursor sits inside a pipe table, reformat it in place (pad columns,
 * normalize the alignment row). Returns false when the cursor isn't in a table
 * so the caller can surface a no-op message.
 */
export function formatTableAtCursor(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;

  const isTableLine = (n: number): boolean => {
    if (n < 1 || n > state.doc.lines) return false;
    const text = state.doc.line(n).text;
    return text.includes("|") && text.trim() !== "";
  };

  const cursorLine = state.doc.lineAt(pos).number;
  if (!isTableLine(cursorLine)) return false;

  let start = cursorLine;
  let end = cursorLine;
  while (isTableLine(start - 1)) start--;
  while (isTableLine(end + 1)) end++;

  // A table needs a header plus an alignment row as its second line.
  if (end - start < 1 || !isSeparatorRow(state.doc.line(start + 1).text)) return false;

  const from = state.doc.line(start).from;
  const to = state.doc.line(end).to;
  const src = state.sliceDoc(from, to);
  const formatted = formatTable(src);
  if (formatted !== src) {
    view.dispatch({ changes: { from, to, insert: formatted } });
  }
  return true;
}
