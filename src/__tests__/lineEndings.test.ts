import { describe, it, expect } from "vitest";
import { detectEol, toLf, withEol } from "../lineEndings";

describe("detectEol", () => {
  it("is lf for text without line breaks", () => {
    expect(detectEol("")).toBe("lf");
    expect(detectEol("single line")).toBe("lf");
  });

  it("is lf for LF-only text", () => {
    expect(detectEol("a\nb\nc\n")).toBe("lf");
  });

  it("is crlf for CRLF-only text", () => {
    expect(detectEol("a\r\nb\r\nc\r\n")).toBe("crlf");
  });

  it("follows the majority in mixed text", () => {
    expect(detectEol("a\r\nb\r\nc\nd")).toBe("crlf");
    expect(detectEol("a\r\nb\nc\nd")).toBe("lf");
  });

  it("is lf on a tie", () => {
    expect(detectEol("a\r\nb\nc")).toBe("lf");
  });

  it("counts a leading LF as bare", () => {
    expect(detectEol("\na\r\n")).toBe("lf");
  });
});

describe("toLf", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(toLf("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("leaves LF text unchanged", () => {
    expect(toLf("a\nb\n")).toBe("a\nb\n");
  });
});

describe("withEol", () => {
  it("returns LF text unchanged for lf", () => {
    expect(withEol("a\nb\n", "lf")).toBe("a\nb\n");
  });

  it("converts every LF to CRLF for crlf", () => {
    expect(withEol("a\nb\n\nc", "crlf")).toBe("a\r\nb\r\n\r\nc");
  });

  it("round-trips a CRLF file through toLf", () => {
    const original = "line one\r\nline two\r\n\r\nend\r\n";
    const eol = detectEol(original);
    expect(withEol(toLf(original), eol)).toBe(original);
  });
});
