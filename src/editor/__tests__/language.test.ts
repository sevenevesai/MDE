import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { language } from "@codemirror/language";
import {
  detectLanguage,
  isMarkdownLanguage,
  languageLabel,
  listLanguages,
  loadLanguageExtension,
} from "../language";

describe("detectLanguage", () => {
  it("treats a missing name and untitled names as markdown", () => {
    expect(detectLanguage(null)).toBe("markdown");
    expect(detectLanguage("")).toBe("markdown");
    expect(detectLanguage("Untitled")).toBe("markdown");
    expect(detectLanguage("Untitled-3")).toBe("markdown");
    expect(detectLanguage("Untitled-3.md")).toBe("markdown");
  });

  it("maps markdown extensions to markdown, case-insensitively", () => {
    expect(detectLanguage("notes.md")).toBe("markdown");
    expect(detectLanguage("README.MD")).toBe("markdown");
    expect(detectLanguage("post.markdown")).toBe("markdown");
    expect(detectLanguage("page.mdx")).toBe("markdown");
    expect(detectLanguage("old.mkd")).toBe("markdown");
  });

  it("maps text and log extensions to plain text", () => {
    expect(detectLanguage("todo.txt")).toBe("plain");
    expect(detectLanguage("readme.text")).toBe("plain");
    expect(detectLanguage("server.log")).toBe("plain");
  });

  it("maps unknown extensions and other extensionless names to plain text", () => {
    expect(detectLanguage("archive.xyz123")).toBe("plain");
    expect(detectLanguage("LICENSE")).toBe("plain");
    expect(detectLanguage(".gitignore")).toBe("plain");
  });

  it("maps code extensions to their language-data name", () => {
    expect(detectLanguage("main.py")).toBe("Python");
    expect(detectLanguage("data.json")).toBe("JSON");
    expect(detectLanguage("app.ts")).toBe("TypeScript");
    expect(detectLanguage("MAIN.RS")).toBe("Rust");
  });

  it("uses only the base name of a path", () => {
    expect(detectLanguage("C:\\work\\src.d\\lib.rs")).toBe("Rust");
    expect(detectLanguage("/home/me/notes.v2/todo.txt")).toBe("plain");
    expect(detectLanguage("/repo/docs.py/README.md")).toBe("markdown");
  });

  it("recognises whole-filename patterns, even over the plain-text extensions", () => {
    expect(detectLanguage("Dockerfile")).toBe("Dockerfile");
    expect(detectLanguage("/proj/CMakeLists.txt")).toBe("CMake");
  });
});

describe("isMarkdownLanguage", () => {
  it("is true only for the markdown id", () => {
    expect(isMarkdownLanguage("markdown")).toBe(true);
    expect(isMarkdownLanguage("plain")).toBe(false);
    expect(isMarkdownLanguage("Python")).toBe(false);
  });
});

describe("languageLabel", () => {
  it("labels the built-in ids and language-data names", () => {
    expect(languageLabel("markdown")).toBe("Markdown");
    expect(languageLabel("plain")).toBe("Plain Text");
    expect(languageLabel("Python")).toBe("Python");
  });

  it("labels an unknown id as plain text, matching how it loads", () => {
    expect(languageLabel("Klingon")).toBe("Plain Text");
  });
});

describe("listLanguages", () => {
  const list = listLanguages();

  it("starts with Markdown and Plain Text", () => {
    expect(list[0]).toEqual({ id: "markdown", label: "Markdown" });
    expect(list[1]).toEqual({ id: "plain", label: "Plain Text" });
  });

  it("lists the language-data languages after them, sorted by name", () => {
    const rest = list.slice(2).map((l) => l.label);
    expect(rest.length).toBeGreaterThan(50);
    expect(rest).toContain("Python");
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  });

  it("offers markdown exactly once and has unique ids", () => {
    const ids = list.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.filter((l) => l.label === "Markdown")).toHaveLength(1);
  });

  it("labels every entry the same way languageLabel does", () => {
    for (const entry of list) expect(languageLabel(entry.id)).toBe(entry.label);
  });
});

describe("loadLanguageExtension", () => {
  async function topLanguage(id: string): Promise<string | null> {
    const state = EditorState.create({ doc: "", extensions: await loadLanguageExtension(id) });
    return state.facet(language)?.name ?? null;
  }

  it("loads a language-data parser", async () => {
    expect(await topLanguage("Python")).toBe("python");
  });

  it("gives plain text no language", async () => {
    expect(await topLanguage("plain")).toBeNull();
  });

  it("falls back to plain text for an unknown id", async () => {
    expect(await topLanguage("Klingon")).toBeNull();
  });

  it("gives markdown a markdown-aware parser", async () => {
    const state = EditorState.create({ doc: "# Title", extensions: await loadLanguageExtension("markdown") });
    expect(state.facet(language)).not.toBeNull();
  });
});
