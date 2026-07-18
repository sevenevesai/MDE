import { describe, it, expect, vi } from "vitest";
import type { WatchEvent, UnwatchFn } from "@tauri-apps/plugin-fs";
import { decideReload, pathKey, FileWatcherManager, type WatchFn } from "../fileWatcher";

describe("decideReload", () => {
  it("ignores the echo of our own save (disk == savedContent)", () => {
    expect(decideReload("abc", { content: "abc", savedContent: "abc" })).toBe("ignore");
    expect(decideReload("abc", { content: "abc DIRTY", savedContent: "abc" })).toBe("ignore");
  });

  it("reloads a clean buffer when disk changed", () => {
    expect(decideReload("new disk", { content: "old", savedContent: "old" })).toBe("reload");
  });

  it("re-baselines when an external write matches the dirty buffer exactly", () => {
    expect(decideReload("edited", { content: "edited", savedContent: "original" })).toBe("reload");
  });

  it("flags a conflict when both buffer and disk diverged", () => {
    expect(decideReload("disk version", { content: "my version", savedContent: "original" })).toBe("conflict");
  });
});

describe("pathKey", () => {
  it("normalizes separators and case", () => {
    expect(pathKey("C:\\Docs\\Note.md")).toBe(pathKey("c:/docs/note.md"));
  });

  it("distinguishes different files", () => {
    expect(pathKey("C:\\a.md")).not.toBe(pathKey("C:\\b.md"));
  });
});

/** Test double: records watched dirs, lets the test fire events into them. */
function fakeWatcher() {
  const watched = new Map<string, (event: WatchEvent) => void>();
  const unwatched: string[] = [];
  const watchFn: WatchFn = (paths, cb) => {
    const dir = paths as string;
    watched.set(dir, cb);
    const unwatch: UnwatchFn = () => {
      watched.delete(dir);
      unwatched.push(dir);
    };
    return Promise.resolve(unwatch);
  };
  const fire = (dir: string, paths: string[]) => {
    watched.get(dir)?.({ type: "any", paths, attrs: null });
  };
  return { watchFn, watched, unwatched, fire };
}

describe("FileWatcherManager", () => {
  it("watches the parent directory once for multiple files", async () => {
    const { watchFn, watched } = fakeWatcher();
    const mgr = new FileWatcherManager(() => {}, watchFn);
    await mgr.sync(["C:\\docs\\a.md", "C:\\docs\\b.md"]);
    expect([...watched.keys()]).toEqual(["C:\\docs"]);
  });

  it("reports changes only for watched files, with original paths", async () => {
    const { watchFn, fire } = fakeWatcher();
    const changed = vi.fn();
    const mgr = new FileWatcherManager(changed, watchFn);
    await mgr.sync(["C:\\docs\\a.md"]);

    fire("C:\\docs", ["C:\\docs\\other.md"]);
    expect(changed).not.toHaveBeenCalled();

    // Event paths may differ in case/separators from the open-file path.
    fire("C:\\docs", ["c:/DOCS/A.MD"]);
    expect(changed).toHaveBeenCalledExactlyOnceWith("C:\\docs\\a.md");
  });

  it("reconciles every watched file in the directory on a pathless event", async () => {
    const { watchFn, fire } = fakeWatcher();
    const changed = vi.fn();
    const mgr = new FileWatcherManager(changed, watchFn);
    await mgr.sync(["C:\\docs\\a.md", "C:\\docs\\b.md"]);

    fire("C:\\docs", []);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledWith("C:\\docs\\a.md");
    expect(changed).toHaveBeenCalledWith("C:\\docs\\b.md");
  });

  it("unwatches a directory when its last file closes, keeps shared dirs", async () => {
    const { watchFn, watched, unwatched } = fakeWatcher();
    const mgr = new FileWatcherManager(() => {}, watchFn);
    await mgr.sync(["C:\\docs\\a.md", "C:\\other\\c.md"]);
    expect(watched.size).toBe(2);

    await mgr.sync(["C:\\docs\\a.md"]);
    expect(unwatched).toEqual(["C:\\other"]);
    expect([...watched.keys()]).toEqual(["C:\\docs"]);
  });

  it("updates the file filter when the open set in a dir changes", async () => {
    const { watchFn, fire } = fakeWatcher();
    const changed = vi.fn();
    const mgr = new FileWatcherManager(changed, watchFn);
    await mgr.sync(["C:\\docs\\a.md"]);
    await mgr.sync(["C:\\docs\\b.md"]);

    fire("C:\\docs", ["C:\\docs\\a.md"]);
    expect(changed).not.toHaveBeenCalled();
    fire("C:\\docs", ["C:\\docs\\b.md"]);
    expect(changed).toHaveBeenCalledExactlyOnceWith("C:\\docs\\b.md");
  });

  it("ignores paths without a parent directory (browser filenames)", async () => {
    const { watchFn, watched } = fakeWatcher();
    const mgr = new FileWatcherManager(() => {}, watchFn);
    await mgr.sync(["note.md"]);
    expect(watched.size).toBe(0);
  });

  it("stops reporting after dispose", async () => {
    const { watchFn, watched } = fakeWatcher();
    const changed = vi.fn();
    const mgr = new FileWatcherManager(changed, watchFn);
    await mgr.sync(["C:\\docs\\a.md"]);
    const cb = watched.get("C:\\docs");
    mgr.dispose();

    // Fire via the captured callback — dispose already unregistered it.
    cb?.({ type: "any", paths: ["C:\\docs\\a.md"], attrs: null });
    expect(changed).not.toHaveBeenCalled();
  });

  it("survives a watch function that rejects", async () => {
    const watchFn: WatchFn = () => Promise.reject(new Error("gone"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mgr = new FileWatcherManager(() => {}, watchFn);
    await expect(mgr.sync(["C:\\gone\\a.md"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
