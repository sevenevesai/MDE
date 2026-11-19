/**
 * Pure decisions behind App's single document-opening path: which tab each
 * opened file lands in, and how failures are reported.
 */
import { DEFAULT_CONTENT, isModified, type DocTab } from "./store/documentStore";
import type { FileResult, SkippedFile } from "./fileOps.types";
import { basename, errorMessage } from "./fileOps.types";

export type OpenStep =
  /** Already open: just show it. */
  | { readonly kind: "focus"; readonly tabId: string }
  /** Already open, clean: replace its text with the fresh read, then show it. */
  | { readonly kind: "refresh"; readonly tabId: string; readonly file: FileResult }
  /** Already open with unsaved edits the fresh read must not overwrite: show it and say so. */
  | { readonly kind: "focus-dirty"; readonly tabId: string; readonly title: string }
  /** Load into the active tab, an untouched untitled one. */
  | { readonly kind: "reuse"; readonly tabId: string; readonly file: FileResult }
  | { readonly kind: "add"; readonly file: FileResult };

export interface OpenOptions {
  /**
   * Refresh an already-open clean tab from the fresh read. The browser needs it:
   * a pre-handle session can hold a stale tab under the same bare-name path as a
   * newly opened, different file.
   */
  readonly refreshOpen: boolean;
}

function isBlankUntitled(tab: DocTab): boolean {
  return tab.filePath === null && !isModified(tab) && tab.content === DEFAULT_CONTENT;
}

/**
 * One step per distinct path, in order. Only the first new file may reuse the
 * active tab, and a path repeated within the batch opens once.
 */
export function planOpen(
  tabs: readonly DocTab[],
  activeTabId: string,
  files: readonly FileResult[],
  options: OpenOptions,
): OpenStep[] {
  const steps: OpenStep[] = [];
  const seen = new Set<string>();
  const active = tabs.find((t) => t.id === activeTabId);
  let reusable = active !== undefined && isBlankUntitled(active) ? active : null;

  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);

    const existing = tabs.find((t) => t.filePath === file.path);
    if (existing) {
      if (!options.refreshOpen) steps.push({ kind: "focus", tabId: existing.id });
      else if (isModified(existing)) steps.push({ kind: "focus-dirty", tabId: existing.id, title: existing.title });
      else steps.push({ kind: "refresh", tabId: existing.id, file });
    } else if (reusable) {
      steps.push({ kind: "reuse", tabId: reusable.id, file });
      reusable = null;
    } else {
      steps.push({ kind: "add", file });
    }
  }
  return steps;
}

/** A complete, user-presentable sentence for a file a batch did not load. */
export function skippedMessage(skipped: SkippedFile): string {
  return `Cannot open "${skipped.name}": ${skipped.reason}`;
}

const MAX_FAILURES_SHOWN = 3;

/** One toast for every failure of a batch; null when nothing failed. */
export function failureToast(failures: readonly string[]): string | null {
  if (failures.length === 0) return null;
  const shown = failures.slice(0, MAX_FAILURES_SHOWN).join(" · ");
  const more = failures.length - MAX_FAILURES_SHOWN;
  return more > 0 ? `${shown} · and ${more} more` : shown;
}

/** Read each path; a failure becomes a message instead of aborting the batch. */
export async function readPaths(
  paths: readonly string[],
  read: (path: string) => Promise<FileResult>,
): Promise<{ files: FileResult[]; failures: string[] }> {
  const files: FileResult[] = [];
  const failures: string[] = [];
  for (const path of paths) {
    try {
      files.push(await read(path));
    } catch (err) {
      const message = errorMessage(err);
      failures.push(message.includes(basename(path)) ? message : `Cannot open "${basename(path)}": ${message}`);
    }
  }
  return { files, failures };
}
