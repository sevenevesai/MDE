/**
 * External-change handling for open files (desktop only).
 *
 * Watches the PARENT DIRECTORY of each open file rather than the file itself:
 * editors and agents often save via write-temp-then-rename, which replaces the
 * inode and silently kills a file-level watch. Directory events are filtered
 * back to the open files, and every event is handled by re-reading the file
 * and comparing content — idempotent, so spurious events are harmless.
 */
import type { WatchEvent, UnwatchFn, DebouncedWatchOptions } from "@tauri-apps/plugin-fs";

export type ReloadDecision = "ignore" | "reload" | "conflict";

/**
 * Decide how to reconcile an open tab with the content found on disk.
 * - disk == savedContent: the echo of our own save (or a no-op write) — ignore.
 * - disk == buffer: an external writer landed the exact text already in the
 *   buffer — "reload" just re-baselines savedContent, nothing visible changes.
 * - clean buffer: safe to auto-reload.
 * - otherwise both sides diverged from the last common baseline — conflict,
 *   the user decides.
 */
export function decideReload(
  diskContent: string,
  tab: { readonly content: string; readonly savedContent: string },
): ReloadDecision {
  if (diskContent === tab.savedContent) return "ignore";
  if (diskContent === tab.content) return "reload";
  if (tab.content === tab.savedContent) return "reload";
  return "conflict";
}

/**
 * Separator-normalized, lowercased comparison key. Lowercasing is technically
 * wrong on case-sensitive filesystems, but a false match only triggers an
 * extra reconcile pass, which reads the file and no-ops.
 */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/** Parent directory, or "" when the path has no separators (browser filenames). */
function parentDir(p: string): string {
  const idx = p.replace(/\\/g, "/").lastIndexOf("/");
  return idx <= 0 ? "" : p.slice(0, idx);
}

export type WatchFn = (
  paths: string | string[],
  cb: (event: WatchEvent) => void,
  options?: DebouncedWatchOptions,
) => Promise<UnwatchFn>;

interface DirWatch {
  /** pathKey(file) -> original path, for every open file in this directory. */
  files: Map<string, string>;
  unwatch: UnwatchFn | null;
  disposed: boolean;
}

const DEBOUNCE_MS = 400;

export class FileWatcherManager {
  private dirs = new Map<string, DirWatch>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private onFileChanged: (path: string) => void,
    private watchFn?: WatchFn,
  ) {}

  /** Reconcile the watched directory set with the currently open file paths. */
  sync(paths: readonly string[]): Promise<void> {
    // Serialized: overlapping syncs would race the async watch setup.
    this.queue = this.queue.then(() => this.doSync(paths));
    return this.queue;
  }

  dispose(): void {
    for (const dw of this.dirs.values()) {
      dw.disposed = true;
      dw.unwatch?.();
    }
    this.dirs.clear();
  }

  private async doSync(paths: readonly string[]): Promise<void> {
    const wanted = new Map<string, { dir: string; files: Map<string, string> }>();
    for (const p of paths) {
      const dir = parentDir(p);
      if (!dir) continue;
      const key = pathKey(dir);
      let entry = wanted.get(key);
      if (!entry) {
        entry = { dir, files: new Map() };
        wanted.set(key, entry);
      }
      entry.files.set(pathKey(p), p);
    }

    for (const [key, dw] of this.dirs) {
      const entry = wanted.get(key);
      if (entry) {
        dw.files = entry.files;
      } else {
        dw.disposed = true;
        dw.unwatch?.();
        this.dirs.delete(key);
      }
    }

    for (const [key, entry] of wanted) {
      if (this.dirs.has(key)) continue;
      const dw: DirWatch = { files: entry.files, unwatch: null, disposed: false };
      this.dirs.set(key, dw);
      try {
        const watchFn = this.watchFn ?? (await loadWatch());
        const unwatch = await watchFn(entry.dir, (event) => this.handleEvent(dw, event), {
          delayMs: DEBOUNCE_MS,
        });
        if (dw.disposed) unwatch();
        else dw.unwatch = unwatch;
      } catch (err) {
        // Non-fatal degradation: the files in this directory simply behave as
        // before file-watching existed. Logged, not toasted — it can fire for
        // every open file in a vanished directory.
        console.warn(`MDE: cannot watch ${entry.dir}`, err);
        if (this.dirs.get(key) === dw) this.dirs.delete(key);
      }
    }
  }

  private handleEvent(dw: DirWatch, event: WatchEvent): void {
    if (dw.disposed) return;
    const hits = event.paths.length > 0
      ? event.paths.map(pathKey).filter((k) => dw.files.has(k)).map((k) => dw.files.get(k)!)
      : [...dw.files.values()]; // pathless event — reconcile everything (cheap, idempotent)
    for (const p of new Set(hits)) this.onFileChanged(p);
  }
}

let watchImport: Promise<WatchFn> | null = null;
function loadWatch(): Promise<WatchFn> {
  if (!watchImport) {
    watchImport = import("@tauri-apps/plugin-fs").then((m) => m.watch);
  }
  return watchImport;
}
