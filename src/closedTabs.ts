/** Pure stack behind Reopen Closed Tab. In memory only: it does not survive a restart. */
import type { DocTab } from "./store/documentStore";

/** Everything needed to bring a closed tab back, unsaved edits included. */
export type ClosedTab = Omit<DocTab, "id">;

export const CLOSED_TABS_CAP = 20;

/** An untitled tab nobody typed into is not worth reopening. */
export function isWorthReopening(tab: DocTab): boolean {
  return tab.filePath !== null || tab.content !== "";
}

/** The stack with `tab` on top, oldest entries dropped beyond `cap`. Unchanged when the tab is not worth reopening. */
export function pushClosed(stack: readonly ClosedTab[], tab: DocTab, cap: number = CLOSED_TABS_CAP): readonly ClosedTab[] {
  if (!isWorthReopening(tab)) return stack;
  const { id: _id, ...closed } = tab;
  return [...stack, closed].slice(-cap);
}

/** The most recently closed tab and the rest of the stack, or null when empty. */
export function popClosed(stack: readonly ClosedTab[]): { readonly tab: ClosedTab; readonly rest: readonly ClosedTab[] } | null {
  if (stack.length === 0) return null;
  return { tab: stack[stack.length - 1], rest: stack.slice(0, -1) };
}
