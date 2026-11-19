import { describe, it, expect } from "vitest";
import { MAX_ENTRIES, pathsToEvict, resolvePath, type HandleEntry } from "../browserHandles";
import { basename } from "../fileOps.types";

/** Stand-in for a FileSystemFileHandle: same `file` means same file on disk. */
interface FakeHandle {
  readonly file: string;
}
const handle = (file: string): FakeHandle => ({ file });
const isSame = async (a: FakeHandle, b: FakeHandle): Promise<boolean> => a.file === b.file;
const entry = (path: string, h: FakeHandle | null, lastUsed = 0): HandleEntry<FakeHandle> => ({ path, handle: h, lastUsed });

describe("resolvePath", () => {
  it("uses the bare file name when no file of that name is known", async () => {
    expect(await resolvePath([], "README.md", handle("C:/a/README.md"), isSame)).toEqual({ path: "README.md", known: false });
  });

  it("gives the same file its existing path back", async () => {
    const entries = [entry("README.md", handle("C:/a/README.md")), entry("(2)/README.md", handle("C:/b/README.md"))];
    expect(await resolvePath(entries, "README.md", handle("C:/b/README.md"), isSame)).toEqual({ path: "(2)/README.md", known: true });
  });

  it("disambiguates a different file with a known name, keeping the real name as basename", async () => {
    const entries = [entry("README.md", handle("C:/a/README.md"))];
    const { path, known } = await resolvePath(entries, "README.md", handle("C:/b/README.md"), isSame);
    expect(path).toBe("(2)/README.md");
    expect(known).toBe(false);
    expect(basename(path)).toBe("README.md");
  });

  it("takes the smallest free number", async () => {
    const entries = [
      entry("notes.md", handle("1")),
      entry("(3)/notes.md", handle("3")),
    ];
    expect((await resolvePath(entries, "notes.md", handle("4"), isSame)).path).toBe("(2)/notes.md");
  });

  it("never matches a file that arrived without a handle", async () => {
    const entries = [entry("draft.md", null)];
    expect(await resolvePath(entries, "draft.md", null, isSame)).toEqual({ path: "(2)/draft.md", known: false });
    expect(await resolvePath(entries, "draft.md", handle("x"), isSame)).toEqual({ path: "(2)/draft.md", known: false });
  });

  it("only matches entries with the same file name", async () => {
    const entries = [entry("a.md", handle("same-file"))];
    expect(await resolvePath(entries, "b.md", handle("same-file"), isSame)).toEqual({ path: "b.md", known: false });
  });
});

describe("pathsToEvict", () => {
  it("keeps everything up to the limit", () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_, i) => entry(`${i}.md`, handle(`${i}`), i));
    expect(pathsToEvict(entries, MAX_ENTRIES)).toEqual([]);
  });

  it("drops the least recently used beyond the limit", () => {
    const entries = [entry("old.md", null, 1), entry("new.md", null, 30), entry("mid.md", null, 20), entry("older.md", null, 0)];
    expect(pathsToEvict(entries, 2).sort()).toEqual(["old.md", "older.md"]);
  });
});
