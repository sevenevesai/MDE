/**
 * Line-ending helpers for the file read/write boundary. CodeMirror normalises
 * every line break to "\n" on load, so a file's original convention has to be
 * detected before the text enters the editor and restored on save.
 */

export type Eol = "lf" | "crlf";

/** "crlf" when CRLF breaks outnumber bare LF breaks; "lf" otherwise (including no breaks). */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) crlf++;
    else lf++;
  }
  return crlf > lf ? "crlf" : "lf";
}

/** Normalise CRLF and lone CR breaks to LF. */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Convert LF-only text to the given line ending. */
export function withEol(text: string, eol: Eol): string {
  return eol === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}
