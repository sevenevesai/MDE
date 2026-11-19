/** Pure text for the status bar (see StatusBar.tsx). */

/** "3 selections" with multiple cursors, "128 selected" for one non-empty selection, else null. */
export function selectionSummary(selectionCount: number, selectionLength: number): string | null {
  if (selectionCount > 1) return `${selectionCount} selections`;
  return selectionLength > 0 ? `${selectionLength} selected` : null;
}

/** "Spaces: 2" or "Tabs: 4" (tab width). */
export function indentLabel(settings: { readonly indentSize: number; readonly indentWithTabs: boolean }): string {
  return `${settings.indentWithTabs ? "Tabs" : "Spaces"}: ${settings.indentSize}`;
}
