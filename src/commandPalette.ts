/** Pure logic for the command palette: command shape + fuzzy filtering. */

export interface PaletteCommand {
  id: string;
  title: string;
  shortcut?: string;
  action: () => void;
}

/**
 * Subsequence fuzzy match. Returns a cost (lower = better) or null when the
 * query is not a subsequence of the text. Cheap heuristics, not Sublime's
 * algorithm: consecutive matches and word-start matches are cheap, gaps are
 * expensive, and shorter titles win ties.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;

  let cost = 0;
  let pos = -1;
  for (const ch of q) {
    const idx = t.indexOf(ch, pos + 1);
    if (idx === -1) return null;
    if (idx === pos + 1) {
      // consecutive run — free
    } else if (idx === 0 || !/[a-z0-9]/.test(t[idx - 1])) {
      cost += 1; // jump to a word start — cheap
    } else {
      cost += idx - pos; // gap penalty
    }
    pos = idx;
  }
  return cost + t.length * 0.01;
}

/** Filter and rank items by fuzzy match against the query (stable for ties). */
export function filterByFuzzy<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.item);
}
