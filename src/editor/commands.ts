import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

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
