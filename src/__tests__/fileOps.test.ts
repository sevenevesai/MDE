import { describe, it, expect } from "vitest";
import manifestSource from "../../public/manifest.webmanifest?raw";
import {
  looksBinary,
  MARKDOWN_EXTENSIONS,
  NotTextError,
  skipReason,
  SNIFF_LENGTH,
  TEXT_EXTENSIONS,
} from "../fileOps.types";

describe("looksBinary", () => {
  it("accepts ordinary text, including non-ASCII", () => {
    expect(looksBinary("# Title\n\nCafé — 日本語 ✓\n")).toBe(false);
    expect(looksBinary("")).toBe(false);
  });

  it("rejects a NUL in the head", () => {
    expect(looksBinary("\x89PNG\r\n\x1a\n\0\0\0\rIHDR")).toBe(true);
    expect(looksBinary("a".repeat(SNIFF_LENGTH - 1) + "\0")).toBe(true);
  });

  it("ignores a NUL past the sniffed head", () => {
    expect(looksBinary("a".repeat(SNIFF_LENGTH) + "\0")).toBe(false);
  });
});

describe("skipReason", () => {
  it("names binary files plainly and keeps other causes", () => {
    expect(skipReason(new NotTextError())).toBe("not a text file");
    expect(skipReason(new Error("os error 2"))).toBe("could not be read (os error 2)");
    expect(skipReason("denied")).toBe("could not be read (denied)");
  });
});

describe("PWA file handlers", () => {
  it("accept exactly the extensions the open pickers list", () => {
    const manifest = JSON.parse(manifestSource) as { file_handlers: { accept: Record<string, string[]> }[] };
    const accepted = manifest.file_handlers.flatMap((h) => Object.values(h.accept).flat()).sort();
    const picker = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS].map((e) => `.${e}`).sort();
    expect(accepted).toEqual(picker);
  });
});
