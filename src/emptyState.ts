/** Pure visibility rule for the empty-tab overlay (see EmptyState.tsx). */

export interface EmptyStateTab {
  filePath: string | null;
  content: string;
}

/** Shown only for a fresh untitled tab with no content typed yet. */
export function shouldShowEmptyState(tab: EmptyStateTab): boolean {
  return tab.filePath === null && tab.content === "";
}
