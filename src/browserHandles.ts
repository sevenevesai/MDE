/**
 * Browser-only registry mapping the app's file "paths" to File System Access handles, persisted
 * in IndexedDB (handles are structured-cloneable) so a restored tab still saves to its file.
 * Only fileOps.browser.ts uses the store; the exported pure helpers are unit-tested.
 */
import { basename, errorMessage } from "./fileOps.types";

export interface HandleEntry<H> {
  readonly path: string;
  /** null: a file that arrived without a handle. It holds its path so no other file takes it, and saves by download. */
  readonly handle: H | null;
  readonly lastUsed: number;
}

/** Entries kept, most recently used first; older paths fall back to download on save. */
export const MAX_ENTRIES = 50;

/**
 * Path for a file named `name`: the existing entry's path when `handle` is the same file,
 * else the bare name when free, else `(n)/name` with the smallest free n >= 2.
 * A null handle never matches an existing entry.
 */
export async function resolvePath<H>(
  entries: Iterable<HandleEntry<H>>,
  name: string,
  handle: H | null,
  isSame: (known: H, candidate: H) => Promise<boolean>,
): Promise<{ readonly path: string; readonly known: boolean }> {
  const taken = new Set<string>();
  for (const entry of entries) {
    taken.add(entry.path);
    if (handle !== null && entry.handle !== null && basename(entry.path) === name && (await isSame(entry.handle, handle))) {
      return { path: entry.path, known: true };
    }
  }
  if (!taken.has(name)) return { path: name, known: false };
  for (let n = 2; ; n++) {
    const path = `(${n})/${name}`;
    if (!taken.has(path)) return { path, known: false };
  }
}

/** Paths to drop so at most `max` entries remain, least recently used first. */
export function pathsToEvict<H>(entries: Iterable<HandleEntry<H>>, max: number): string[] {
  return [...entries].sort((a, b) => b.lastUsed - a.lastUsed).slice(max).map((e) => e.path);
}

// --- IndexedDB-backed store ---

type Entry = HandleEntry<FileSystemFileHandle>;

const DB_NAME = "mde-file-handles";
const STORE = "handles";
/** A lookup re-persists its recency at most this often; LRU order across reloads only needs to be coarse. */
const TOUCH_PERSIST_MS = 60_000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let entriesPromise: Promise<Map<string, Entry>> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Runs store mutations one at a time so concurrent opens cannot claim the same path. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    const unavailable = (err: unknown): void => {
      console.error(`File handle store unavailable; opened files will save by download after a reload: ${errorMessage(err)}`);
      resolve(null);
    };
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "path" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => unavailable(req.error);
    } catch (err) {
      unavailable(err); // indexedDB missing or blocked (e.g. some private modes)
    }
  });
  return dbPromise;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const handle = v.handle;
  return (
    typeof v.path === "string" &&
    typeof v.lastUsed === "number" &&
    (handle === null || (typeof handle === "object" && "kind" in handle && handle.kind === "file"))
  );
}

function entries(): Promise<Map<string, Entry>> {
  entriesPromise ??= (async () => {
    const map = new Map<string, Entry>();
    const db = await openDb();
    if (!db) return map;
    try {
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const raw of all) if (isEntry(raw)) map.set(raw.path, raw);
    } catch (err) {
      console.error(`Could not load remembered files: ${errorMessage(err)}`);
    }
    return map;
  })();
  return entriesPromise;
}

async function persist(put: readonly Entry[], remove: readonly string[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const entry of put) store.put(entry);
      for (const path of remove) store.delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.error(`Could not remember file handles; they will not survive a reload: ${errorMessage(err)}`);
  }
}

function sameEntry(known: FileSystemFileHandle, candidate: FileSystemFileHandle): Promise<boolean> {
  return known.isSameEntry(candidate).catch(() => false); // a stale handle cannot be the same file
}

function remember(name: string, handle: FileSystemFileHandle | null): Promise<string> {
  return serial(async () => {
    const map = await entries();
    const { path } = await resolvePath(map.values(), name, handle, sameEntry);
    const entry: Entry = { path, handle, lastUsed: Date.now() };
    map.set(path, entry);
    const evicted = pathsToEvict(map.values(), MAX_ENTRIES);
    for (const p of evicted) map.delete(p);
    await persist([entry], evicted);
    return path;
  });
}

/** Path for a handle from a picker, drop or launch; the same file always gets its existing path back. */
export function rememberHandle(handle: FileSystemFileHandle): Promise<string> {
  return remember(handle.name, handle);
}

/** Path for a file that arrived without a handle; never an existing entry's path. */
export function rememberUnlinked(name: string): Promise<string> {
  return remember(name, null);
}

/** The handle stored for `path` (null when none or unlinked); counts as a use for eviction. */
export function handleFor(path: string): Promise<FileSystemFileHandle | null> {
  return serial(async () => {
    const map = await entries();
    const entry = map.get(path);
    if (!entry) return null;
    const now = Date.now();
    const touched: Entry = { ...entry, lastUsed: now };
    map.set(path, touched);
    if (now - entry.lastUsed > TOUCH_PERSIST_MS) await persist([touched], []);
    return entry.handle;
  });
}
