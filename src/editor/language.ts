import { Prec, type Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import {
  toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode,
  insertLink, insertImage, toggleBulletList, toggleOrderedList,
  toggleBlockquote, insertCodeBlock, setHeading, toggleCheckbox,
} from "./commands";
import { frontmatterFold } from "./frontmatterFold";
import { mdeFrontmatterHighlight } from "./theme";

/**
 * Per-tab editor languages. An id is "markdown", "plain", or the `name` of a
 * @codemirror/language-data description ("Python", "JSON", ...). language-data's
 * own "Markdown" entry is folded into "markdown" so markdown files always get
 * MDE's frontmatter-aware stack and formatting chords.
 */

export const MARKDOWN_LANGUAGE = "markdown";
export const PLAIN_LANGUAGE = "plain";

export interface LanguageOption {
  readonly id: string;
  readonly label: string;
}

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown", "mdx"]);
// language-data claims `.text` for LaTeX; these stay plain text.
const PLAIN_EXTENSIONS: ReadonlySet<string> = new Set(["txt", "text", "log"]);
const UNTITLED_NAME = /^untitled(-\d+)?$/i;
const DATA_MARKDOWN_NAME = "Markdown";

/**
 * Raw-mode markdown language stack. Leading `---` frontmatter is parsed as YAML
 * and the rest as markdown; yamlFrontmatter passes the markdown support
 * extensions through, so lang-markdown's heading-section fold service survives
 * the wrapping. `frontmatterFold` adds the one range neither language provides.
 * Exported so tests can exercise the exact configuration the editor runs.
 */
export const rawLanguage: Extension = [
  yamlFrontmatter({
    content: markdown({ base: markdownLanguage, codeLanguages: languages }),
  }),
  frontmatterFold,
];

const markdownFormattingKeymap: readonly KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-`", run: toggleInlineCode },
  // Ctrl+K belongs to the app-level command palette.
  { key: "Mod-Shift-l", run: insertLink },
  { key: "Mod-Shift-k", run: insertImage },
  { key: "Mod-Shift-8", run: toggleBulletList },
  { key: "Mod-Shift-7", run: toggleOrderedList },
  { key: "Mod-Shift-9", run: toggleCheckbox },
  { key: "Mod-Shift-.", run: toggleBlockquote },
  { key: "Mod-Shift-`", run: insertCodeBlock },
  { key: "Mod-1", run: (v) => setHeading(v, 1) },
  { key: "Mod-2", run: (v) => setHeading(v, 2) },
  { key: "Mod-3", run: (v) => setHeading(v, 3) },
  { key: "Mod-4", run: (v) => setHeading(v, 4) },
];

/**
 * Everything markdown-specific in raw mode. Synchronous so a markdown tab is
 * highlighted from its first paint. The formatting chords sit at high
 * precedence because they deliberately shadow generic bindings (Mod-i
 * selectParentSyntax, Mod-Shift-k deleteLine, Mod-Shift-l selectSelectionMatches).
 */
export const markdownLanguageExtension: Extension = [
  rawLanguage,
  mdeFrontmatterHighlight,
  Prec.high(keymap.of(markdownFormattingKeymap)),
];

function descriptionFor(id: string): LanguageDescription | undefined {
  if (id === DATA_MARKDOWN_NAME) return undefined;
  return languages.find((d) => d.name === id);
}

function idOf(desc: LanguageDescription): string {
  return desc.name === DATA_MARKDOWN_NAME ? MARKDOWN_LANGUAGE : desc.name;
}

/**
 * Language id for a file name or path. No name, or an untitled name without an
 * extension, is markdown; other names without a recognised language are plain.
 */
export function detectLanguage(fileName: string | null): string {
  if (!fileName) return MARKDOWN_LANGUAGE;
  const base = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (MARKDOWN_EXTENSIONS.has(ext)) return MARKDOWN_LANGUAGE;
  if (!ext && UNTITLED_NAME.test(base)) return MARKDOWN_LANGUAGE;

  // Whole-name patterns (CMakeLists.txt, Dockerfile) outrank the plain-text extensions.
  const byName = languages.find((d) => d.filename?.test(base));
  if (byName) return idOf(byName);
  if (PLAIN_EXTENSIONS.has(ext)) return PLAIN_LANGUAGE;

  const byExtension =
    LanguageDescription.matchFilename(languages, base) ??
    LanguageDescription.matchFilename(languages, base.toLowerCase());
  return byExtension ? idOf(byExtension) : PLAIN_LANGUAGE;
}

export function isMarkdownLanguage(id: string): boolean {
  return id === MARKDOWN_LANGUAGE;
}

export function languageLabel(id: string): string {
  if (id === MARKDOWN_LANGUAGE) return "Markdown";
  return descriptionFor(id)?.name ?? "Plain Text";
}

let languageList: readonly LanguageOption[] | null = null;

/** Markdown, Plain Text, then every language-data language by name. */
export function listLanguages(): readonly LanguageOption[] {
  languageList ??= [
    { id: MARKDOWN_LANGUAGE, label: "Markdown" },
    { id: PLAIN_LANGUAGE, label: "Plain Text" },
    ...languages
      .filter((d) => d.name !== DATA_MARKDOWN_NAME)
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ id: name, label: name })),
  ];
  return languageList;
}

/**
 * The editor extension for a language id. Markdown and plain resolve
 * immediately; other languages load their parser chunk. Unknown ids are plain.
 */
export async function loadLanguageExtension(id: string): Promise<Extension> {
  if (id === MARKDOWN_LANGUAGE) return markdownLanguageExtension;
  const desc = descriptionFor(id);
  if (!desc) return [];
  return desc.load();
}
