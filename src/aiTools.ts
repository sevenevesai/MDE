/**
 * Pure helpers for AI-workflow features: building a copy-for-AI payload,
 * cleaning pasted text, and reformatting markdown pipe tables.
 * These functions are side-effect free and unit tested in aiTools.test.ts.
 */

// ─── Copy for AI ────────────────────────────────────────

/** Length of the longest run of consecutive backticks in the text. */
function longestBacktickRun(text: string): number {
  let max = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "`") {
      run++;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

/**
 * Build an AI-friendly representation of a document: the file path (or title)
 * on the first line, then the content inside a fenced ```markdown block. The
 * fence is always longer than the longest backtick run in the content so an
 * embedded code fence can't terminate the block early.
 */
export function buildCopyForAI(pathOrTitle: string, content: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return `${pathOrTitle}\n${fence}markdown\n${content}\n${fence}`;
}

// ─── Clean AI Paste ─────────────────────────────────────

export interface CleanResult {
  text: string;
  count: number;
}

// Characters cleaned by cleanAIText, referenced by escape to stay legible:
// U+200B/C/D zero-width, U+FEFF BOM, U+00A0 NBSP, U+2018/19 & U+201C/D curly quotes.
const DIRTY_CHARS = /[​‌‍﻿ ‘’“”]/g;

/**
 * Conservatively clean text pasted from AI tools / word processors: strip
 * zero-width characters (and BOM), convert non-breaking spaces to regular
 * spaces, and normalize curly quotes to straight quotes. Returns the cleaned
 * text and the number of characters replaced or removed.
 */
export function cleanAIText(input: string): CleanResult {
  let count = 0;
  const text = input.replace(DIRTY_CHARS, (ch) => {
    count++;
    switch (ch) {
      case " ":
        return " ";
      case "‘":
      case "’":
        return "'";
      case "“":
      case "”":
        return '"';
      default: // U+200B/C/D and U+FEFF strip to nothing
        return "";
    }
  });
  return { text, count };
}

// ─── Table formatter ────────────────────────────────────

type ColumnAlign = "left" | "right" | "center" | "none";

/** Split a table row into trimmed cells, tolerating optional outer pipes. */
function parseRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** True when every cell of the line is a markdown alignment marker (---, :--, --:, :-:). */
export function isSeparatorRow(line: string): boolean {
  const cells = parseRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignOf(cell: string): ColumnAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/** Display width in code points (handles surrogate pairs; not East-Asian width). */
function width(cell: string): number {
  return [...cell].length;
}

function pad(cell: string, w: number, align: ColumnAlign): string {
  const gap = w - width(cell);
  if (gap <= 0) return cell;
  if (align === "right") return " ".repeat(gap) + cell;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + cell + " ".repeat(gap - left);
  }
  return cell + " ".repeat(gap); // left / none
}

function separatorCell(align: ColumnAlign, w: number): string {
  switch (align) {
    case "center":
      return ":" + "-".repeat(w - 2) + ":";
    case "left":
      return ":" + "-".repeat(w - 1);
    case "right":
      return "-".repeat(w - 1) + ":";
    default:
      return "-".repeat(w);
  }
}

/**
 * Reformat a pipe table: pad every cell to its column's max width and normalize
 * the alignment row. The second line is treated as the alignment row. Columns
 * have a minimum width of 3 so alignment markers stay valid.
 */
export function formatTable(src: string): string {
  const rows = src.split("\n").map(parseRow);
  const colCount = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const cells = r.slice();
    while (cells.length < colCount) cells.push("");
    return cells;
  });

  const SEP = 1; // alignment row
  const aligns: ColumnAlign[] = norm[SEP].map(alignOf);
  while (aligns.length < colCount) aligns.push("none");

  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let w = 3; // minimum so alignment markers stay valid
    norm.forEach((row, ri) => {
      if (ri === SEP) return;
      w = Math.max(w, width(row[c]));
    });
    widths.push(w);
  }

  return norm
    .map((row, ri) => {
      const cells =
        ri === SEP
          ? widths.map((w, c) => separatorCell(aligns[c], w))
          : row.map((cell, c) => pad(cell, widths[c], aligns[c]));
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
}
