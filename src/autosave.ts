/** Pure idle-autosave target selection (see App.tsx SLEEK autosave block). */

export interface AutoSaveCandidate {
  id: string;
  filePath: string | null;
  content: string;
  savedContent: string;
}

export interface AutoSaveTarget {
  id: string;
  filePath: string;
  content: string;
}

/**
 * Tabs eligible for an idle auto-save: has a file on disk, has unsaved edits,
 * and isn't flagged as conflicting with an external change (auto-saving over
 * a known external change would clobber it silently).
 */
export function selectAutoSaveTargets(
  tabs: readonly AutoSaveCandidate[],
  conflicts: ReadonlySet<string>,
  autoSaveEnabled: boolean
): AutoSaveTarget[] {
  if (!autoSaveEnabled) return [];
  const targets: AutoSaveTarget[] = [];
  for (const t of tabs) {
    if (t.filePath === null) continue;
    if (t.content === t.savedContent) continue;
    if (conflicts.has(t.id)) continue;
    targets.push({ id: t.id, filePath: t.filePath, content: t.content });
  }
  return targets;
}
