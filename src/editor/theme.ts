import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * MDE dark theme — matches the app's color palette.
 * bg-primary: #0d1117, bg-secondary: #161b22, accent: #58a6ff
 */
export const mdeEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#0d1117",
      color: "#e6edf3",
      fontSize: "14px",
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    },
    ".cm-content": {
      caretColor: "#58a6ff",
      padding: "16px 0",
      lineHeight: "1.7",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#58a6ff",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#264f78",
    },
    ".cm-panels": {
      backgroundColor: "#161b22",
      color: "#e6edf3",
      fontSize: "13px",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid #30363d",
    },
    ".cm-panels.cm-panels-bottom": {
      borderTop: "1px solid #30363d",
    },
    // Search panel styling
    ".cm-search": {
      padding: "6px 8px",
      display: "flex",
      flexWrap: "wrap",
      gap: "4px",
      alignItems: "center",
    },
    ".cm-search input, .cm-search select": {
      backgroundColor: "#0d1117",
      color: "#e6edf3",
      border: "1px solid #30363d",
      borderRadius: "4px",
      padding: "3px 8px",
      fontSize: "12px",
      outline: "none",
    },
    ".cm-search input:focus": {
      borderColor: "#58a6ff",
    },
    ".cm-search button": {
      backgroundColor: "#21262d",
      color: "#e6edf3",
      border: "1px solid #30363d",
      borderRadius: "4px",
      padding: "3px 10px",
      fontSize: "12px",
      cursor: "pointer",
    },
    ".cm-search button:hover": {
      backgroundColor: "#30363d",
    },
    ".cm-search label": {
      fontSize: "12px",
      color: "#8b949e",
      display: "flex",
      alignItems: "center",
      gap: "4px",
    },
    ".cm-search label input[type=checkbox]": {
      accentColor: "#58a6ff",
    },
    ".cm-search .cm-button": {
      backgroundImage: "none",
    },
    ".cm-panel.cm-search [name=close]": {
      color: "#8b949e",
      cursor: "pointer",
      padding: "0 4px",
      fontSize: "16px",
    },
    ".cm-panel.cm-search [name=close]:hover": {
      color: "#e6edf3",
    },
    ".cm-searchMatch": {
      backgroundColor: "#e2c08d55",
      outline: "1px solid #e2c08d77",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#264f78",
    },
    ".cm-activeLine": {
      backgroundColor: "#161b2266",
    },
    ".cm-selectionMatch": {
      backgroundColor: "#3fb95044",
    },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#30363d",
      outline: "1px solid #484f58",
    },
    ".cm-gutters": {
      backgroundColor: "#0d1117",
      color: "#484f58",
      border: "none",
      paddingRight: "8px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#161b2266",
      color: "#8b949e",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#1c2128",
      border: "1px solid #30363d",
      color: "#8b949e",
    },
    ".cm-tooltip": {
      backgroundColor: "#161b22",
      border: "1px solid #30363d",
      color: "#e6edf3",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": {
      borderTopColor: "#30363d",
      borderBottomColor: "#30363d",
    },
    ".cm-tooltip .cm-tooltip-arrow:after": {
      borderTopColor: "#161b22",
      borderBottomColor: "#161b22",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "#264f78",
        color: "#e6edf3",
      },
    },
    // Minimap container styling
    ".cm-minimap": {
      backgroundColor: "#0d1117",
    },
    ".cm-minimap .cm-minimap-overlay": {
      backgroundColor: "rgba(88, 166, 255, 0.08)",
      borderLeft: "2px solid rgba(88, 166, 255, 0.3)",
    },
    // Scrollbar inside editor
    ".cm-scroller": {
      overflow: "auto",
      scrollbarWidth: "thin",
      scrollbarColor: "#484f58 transparent",
    },
  },
  { dark: true }
);

/**
 * Syntax highlighting for markdown content — GitHub-dark inspired.
 */
export const mdeHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    // Headings
    { tag: tags.heading1, color: "#79c0ff", fontWeight: "bold", fontSize: "1.4em" },
    { tag: tags.heading2, color: "#79c0ff", fontWeight: "bold", fontSize: "1.25em" },
    { tag: tags.heading3, color: "#79c0ff", fontWeight: "bold", fontSize: "1.1em" },
    { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#79c0ff", fontWeight: "bold" },

    // Emphasis
    { tag: tags.emphasis, color: "#e6edf3", fontStyle: "italic" },
    { tag: tags.strong, color: "#e6edf3", fontWeight: "bold" },
    { tag: tags.strikethrough, color: "#8b949e", textDecoration: "line-through" },

    // Code
    { tag: tags.monospace, color: "#a5d6ff", fontFamily: "inherit" },

    // Links
    { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
    { tag: tags.url, color: "#58a6ff" },

    // Lists
    { tag: tags.list, color: "#ff7b72" },

    // Quotes
    { tag: tags.quote, color: "#8b949e", fontStyle: "italic" },

    // Separators (---)
    { tag: tags.separator, color: "#30363d" },

    // Meta / processing instructions (front matter, etc.)
    { tag: tags.meta, color: "#d2a8ff" },
    { tag: tags.processingInstruction, color: "#d2a8ff" },

    // Markup punctuation (# for headings, ** for bold, etc.)
    { tag: tags.contentSeparator, color: "#30363d" },

    // Generic comment
    { tag: tags.comment, color: "#484f58" },

    // Inline code content / string content
    { tag: tags.string, color: "#a5d6ff" },

    // Numbers
    { tag: tags.number, color: "#79c0ff" },

    // Keywords in fenced code blocks
    { tag: tags.keyword, color: "#ff7b72" },
    { tag: tags.definition(tags.variableName), color: "#ffa657" },
    { tag: tags.variableName, color: "#ffa657" },
    { tag: tags.typeName, color: "#79c0ff" },
    { tag: tags.propertyName, color: "#79c0ff" },
    { tag: tags.operator, color: "#ff7b72" },
    { tag: tags.bool, color: "#79c0ff" },
    { tag: tags.null, color: "#79c0ff" },
    { tag: tags.function(tags.variableName), color: "#d2a8ff" },
  ])
);
