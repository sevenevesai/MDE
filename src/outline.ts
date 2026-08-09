/**
 * Pure structural analysis of a markdown document: the ATX heading outline and
 * the YAML frontmatter block.
 *
 * Both are single-pass line scans with no syntax-tree access — they run on the
 * editor's 250ms debounced stats path and on the raw-mode fold service, so they
 * must stay cheap on very large documents.
 */

export interface OutlineItem {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Heading text, with the leading `#`s and any closing `#`s stripped. */
  text: string;
  /** 1-based line number — the same convention as CodeMirror's `doc.line(n)`. */
  line: number;
  /** 0-based character offset of the start of the heading line. */
  from: number;
}

/** Visit every line as (text, from, to, lineNumber). Returning false stops the scan. */
function eachLine(
  content: string,
  fn: (text: string, from: number, to: number, line: number) => boolean | void,
): void {
  const len = content.length;
  let pos = 0;
  let line = 0;
  for (;;) {
    const nl = content.indexOf("\n", pos);
    const eol = nl === -1 ? len : nl;
    // Worktrees and Windows files carry CRLF; the trailing \r is not content.
    const to = eol > pos && content.charCodeAt(eol - 1) === 13 ? eol - 1 : eol;
    line++;
    if (fn(content.slice(pos, to), pos, to, line) === false) return;
    if (nl === -1) return;
    pos = nl + 1;
  }
}

/**
 * Character range of the YAML frontmatter block, or null when there is none.
 * Frontmatter is only valid when line 1 is exactly `---` and a later line
 * closes it with exactly `---` (the delimiter @lezer/yaml's frontmatter grammar
 * recognises). `from` is 0; `to` is the end of the closing delimiter line,
 * excluding its line break.
 */
export function frontmatterRange(content: string): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  eachLine(content, (text, _from, to, line) => {
    if (line === 1) return text === "---" ? undefined : false;
    if (text === "---") {
      range = { from: 0, to };
      return false;
    }
  });
  return range;
}

/** Strip a heading's trailing closing sequence (`## foo ##` → `foo`). */
function headingText(rest: string): string {
  const trimmed = rest.trim();
  const closing = /(^|\s)#+$/.exec(trimmed);
  return closing ? trimmed.slice(0, closing.index).trim() : trimmed;
}

/**
 * Headings of a markdown document, in document order.
 *
 * ATX headings only (`# …` through `###### …`) — setext headings (`===`/`---`
 * underlines) are deliberately out of scope. Headings inside fenced code blocks
 * and inside YAML frontmatter are skipped, as are lines indented four or more
 * spaces (CommonMark indented code).
 */
export function extractOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const frontmatter = frontmatterRange(content);
  const skipThrough = frontmatter ? frontmatter.to : -1;

  let fenceChar = 0; // 0 = not inside a fenced code block
  let fenceLen = 0;

  eachLine(content, (text, from, _to, line) => {
    if (from <= skipThrough) return;

    let i = 0;
    while (text.charCodeAt(i) === 32) i++;
    if (i > 3) return; // indented code block

    const code = text.charCodeAt(i);

    if (code === 96 /* ` */ || code === 126 /* ~ */) {
      let n = i;
      while (text.charCodeAt(n) === code) n++;
      const runLen = n - i;
      if (runLen < 3) return;
      if (fenceChar === 0) {
        // A backtick fence's info string may not contain a backtick.
        if (code === 96 && text.indexOf("`", n) !== -1) return;
        fenceChar = code;
        fenceLen = runLen;
      } else if (code === fenceChar && runLen >= fenceLen && text.slice(n).trim() === "") {
        fenceChar = 0;
        fenceLen = 0;
      }
      return;
    }

    if (fenceChar !== 0) return;
    if (code !== 35 /* # */) return;

    let h = i;
    while (text.charCodeAt(h) === 35) h++;
    const level = h - i;
    if (level > 6) return;
    const after = text.charCodeAt(h);
    // `#hashtag` is not a heading — the marker must be followed by space or EOL.
    if (h < text.length && after !== 32 && after !== 9) return;

    items.push({
      level: level as OutlineItem["level"],
      text: headingText(text.slice(h)),
      line,
      from,
    });
  });

  return items;
}
