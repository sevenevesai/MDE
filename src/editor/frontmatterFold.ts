import { foldService } from "@codemirror/language";
import { frontmatterRange } from "../outline";

/**
 * The fold gutter only reads this far into the document when deciding whether
 * line 1 opens a foldable frontmatter block. Frontmatter larger than this is
 * highlighted but not foldable — a deliberate trade so the gutter never pays
 * for stringifying a large document.
 */
const MAX_FRONTMATTER_BYTES = 8192;

/**
 * Makes a YAML frontmatter block foldable from its opening `---` line.
 * lang-markdown contributes fold ranges for headings, lists and tables, and
 * lang-yaml for structures *inside* the frontmatter, but nothing folds the
 * block as a whole.
 */
export const frontmatterFold = foldService.of((state, lineStart) => {
  // Frontmatter is only valid at the very start of the document.
  if (lineStart !== 0) return null;
  const head = state.doc.sliceString(0, Math.min(state.doc.length, MAX_FRONTMATTER_BYTES));
  const range = frontmatterRange(head);
  // Fold from the end of the opening `---` through the closing one, leaving a
  // single `---…` line behind.
  return range && range.to > 3 ? { from: 3, to: range.to } : null;
});
