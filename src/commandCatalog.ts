/**
 * Every app command once: its label, palette category, shortcut label and
 * availability. The menu bar and the command palette are both built from this
 * catalog, so a menu command is always in the palette and both show the same
 * chord. Shortcut labels describe bindings that live elsewhere (CodeMirror's
 * keymaps, App's shortcut registry); they must stay true to those.
 */
import type { Command } from "@codemirror/view";
import {
  undo, redo, moveLineUp, moveLineDown, copyLineDown, deleteLine, toggleComment,
  toggleBlockComment, indentMore, indentLess, selectAll, selectLine, addCursorAbove, addCursorBelow,
} from "@codemirror/commands";
import {
  openSearchPanel, findNext, findPrevious, gotoLine, selectNextOccurrence, selectSelectionMatches,
} from "@codemirror/search";
import {
  joinLines, sortLinesAscending, sortLinesDescending, uniqueLines,
  transformUpperCase, transformLowerCase, transformTitleCase,
} from "./editor/textCommands";
import { basename } from "./fileOps.types";
import type { EditorSettings } from "./settings";

/** Opens CodeMirror's search panel (which includes replace) with the replace field focused. */
export const openReplacePanel: Command = (view) => {
  if (!openSearchPanel(view)) return false;
  view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus();
  return true;
};

/** Commands that run a CodeMirror command on the active raw-mode editor. */
export const EDITOR_COMMANDS = {
  "edit.undo": undo,
  "edit.redo": redo,
  "edit.find": openSearchPanel,
  "edit.replace": openReplacePanel,
  "edit.findNext": findNext,
  "edit.findPrevious": findPrevious,
  "edit.gotoLine": gotoLine,
  "edit.moveLineUp": moveLineUp,
  "edit.moveLineDown": moveLineDown,
  "edit.duplicateLine": copyLineDown,
  "edit.deleteLine": deleteLine,
  "edit.toggleComment": toggleComment,
  "edit.toggleBlockComment": toggleBlockComment,
  "edit.indent": indentMore,
  "edit.outdent": indentLess,
  "edit.joinLines": joinLines,
  "edit.sortAsc": sortLinesAscending,
  "edit.sortDesc": sortLinesDescending,
  "edit.uniqueLines": uniqueLines,
  "edit.upperCase": transformUpperCase,
  "edit.lowerCase": transformLowerCase,
  "edit.titleCase": transformTitleCase,
  "sel.selectAll": selectAll,
  "sel.selectLine": selectLine,
  "sel.selectNext": selectNextOccurrence,
  "sel.selectAllOccurrences": selectSelectionMatches,
  "sel.cursorAbove": addCursorAbove,
  "sel.cursorBelow": addCursorBelow,
} as const satisfies Record<string, Command>;

export type EditorCommandId = keyof typeof EDITOR_COMMANDS;

/** Commands App implements itself. */
export type AppCommandId =
  | "file.new" | "file.open" | "file.reopenClosed" | "file.save" | "file.saveAs" | "file.autoSave"
  | "file.exportHtml" | "file.closeTab" | "file.clearRecent" | "file.toggleEol"
  | "edit.trimTrailing" | "edit.toggleCheckbox" | "edit.formatTable" | "edit.copyHtml"
  | "edit.copyForAI" | "edit.cleanPaste"
  | "view.palette" | "view.language" | "view.toggleMode" | "view.outline" | "view.diffUnsaved"
  | "view.wordWrap" | "view.whitespace" | "view.indent2" | "view.indent4" | "view.indent8"
  | "view.indentTabs" | "view.fontUp" | "view.fontDown" | "view.fontReset" | "view.nextTab" | "view.prevTab"
  | "help.updates" | "help.download" | "help.discord";

export type CommandId = EditorCommandId | AppCommandId;

export function isEditorCommand(id: CommandId): id is EditorCommandId {
  return Object.hasOwn(EDITOR_COMMANDS, id);
}

interface Keys {
  /** The label where the chord works: the desktop app, and the browser unless `browser` is set. */
  readonly label: string;
  /** The browser build's working alternate for a chord the browser keeps for itself. */
  readonly browser?: string;
  /** A markdown formatting chord takes this chord in markdown tabs. */
  readonly shadowedInMarkdown?: true;
}

type Availability = "markdown" | "file" | "tauri" | "browser";

interface CommandDef {
  /** Menu label. */
  readonly label: string;
  /** Palette prefix, e.g. "File" in "File: Save". */
  readonly category: string;
  /** Palette text after the category when the menu label alone needs context. */
  readonly paletteLabel?: string;
  readonly keys?: Keys;
  /** Available only for markdown tabs, tabs with a file, or one platform. */
  readonly when?: Availability;
}

const COMMANDS: Readonly<Record<CommandId, CommandDef>> = {
  "file.new": { label: "New Tab", category: "File", keys: { label: "Ctrl+N", browser: "Alt+N" } },
  "file.open": { label: "Open…", category: "File", keys: { label: "Ctrl+O" } },
  "file.reopenClosed": { label: "Reopen Closed Tab", category: "File", keys: { label: "Ctrl+Shift+T", browser: "Alt+Shift+T" } },
  "file.save": { label: "Save", category: "File", keys: { label: "Ctrl+S" } },
  "file.saveAs": { label: "Save As…", category: "File", keys: { label: "Ctrl+Shift+S" } },
  "file.autoSave": { label: "Auto-Save", category: "File", paletteLabel: "Toggle Auto-Save" },
  "file.exportHtml": { label: "Export HTML…", category: "Markdown", when: "markdown" },
  "file.closeTab": { label: "Close Tab", category: "File", keys: { label: "Ctrl+W", browser: "Alt+W" } },
  "file.clearRecent": { label: "Clear Recent", category: "File", paletteLabel: "Clear Recent Files" },
  "file.toggleEol": { label: "Toggle Line Endings (LF/CRLF)", category: "File" },

  "edit.undo": { label: "Undo", category: "Edit", keys: { label: "Ctrl+Z" } },
  "edit.redo": { label: "Redo", category: "Edit", keys: { label: "Ctrl+Y" } },
  "edit.find": { label: "Find…", category: "Edit", keys: { label: "Ctrl+F" } },
  "edit.replace": { label: "Replace…", category: "Edit", keys: { label: "Ctrl+H" } },
  "edit.findNext": { label: "Find Next", category: "Edit", keys: { label: "F3" } },
  "edit.findPrevious": { label: "Find Previous", category: "Edit", keys: { label: "Shift+F3" } },
  "edit.gotoLine": { label: "Go to Line…", category: "Edit", keys: { label: "Ctrl+G" } },
  "edit.moveLineUp": { label: "Move Line Up", category: "Edit", keys: { label: "Alt+↑" } },
  "edit.moveLineDown": { label: "Move Line Down", category: "Edit", keys: { label: "Alt+↓" } },
  "edit.duplicateLine": { label: "Duplicate Line", category: "Edit", keys: { label: "Shift+Alt+↓" } },
  "edit.deleteLine": { label: "Delete Line", category: "Edit", keys: { label: "Ctrl+Shift+K", shadowedInMarkdown: true } },
  "edit.toggleComment": { label: "Toggle Comment", category: "Edit", keys: { label: "Ctrl+/" } },
  "edit.toggleBlockComment": { label: "Toggle Block Comment", category: "Edit", keys: { label: "Shift+Alt+A" } },
  "edit.indent": { label: "Indent", category: "Edit", keys: { label: "Ctrl+]" } },
  "edit.outdent": { label: "Outdent", category: "Edit", keys: { label: "Ctrl+[" } },
  "edit.joinLines": { label: "Join Lines", category: "Edit" },
  "edit.sortAsc": { label: "Sort Lines Ascending", category: "Edit" },
  "edit.sortDesc": { label: "Sort Lines Descending", category: "Edit" },
  "edit.uniqueLines": { label: "Remove Duplicate Lines", category: "Edit" },
  "edit.trimTrailing": { label: "Trim Trailing Whitespace", category: "Edit" },
  "edit.upperCase": { label: "Upper Case", category: "Edit", paletteLabel: "Transform to Upper Case" },
  "edit.lowerCase": { label: "Lower Case", category: "Edit", paletteLabel: "Transform to Lower Case" },
  "edit.titleCase": { label: "Title Case", category: "Edit", paletteLabel: "Transform to Title Case" },
  "edit.toggleCheckbox": { label: "Toggle Checkbox", category: "Markdown", keys: { label: "Ctrl+Shift+9" }, when: "markdown" },
  "edit.formatTable": { label: "Format Table", category: "Markdown", when: "markdown" },
  "edit.copyHtml": { label: "Copy as HTML", category: "Markdown", when: "markdown" },
  "edit.copyForAI": { label: "Copy for AI", category: "AI", keys: { label: "Ctrl+Shift+A" } },
  "edit.cleanPaste": { label: "Clean AI Paste", category: "AI" },

  "sel.selectAll": { label: "Select All", category: "Selection", keys: { label: "Ctrl+A" } },
  "sel.selectLine": { label: "Select Line", category: "Selection", keys: { label: "Alt+L" } },
  "sel.selectNext": { label: "Select Next Occurrence", category: "Selection", keys: { label: "Ctrl+D" } },
  "sel.selectAllOccurrences": {
    label: "Select All Occurrences", category: "Selection", keys: { label: "Ctrl+Shift+L", shadowedInMarkdown: true },
  },
  "sel.cursorAbove": { label: "Add Cursor Above", category: "Selection", keys: { label: "Ctrl+Alt+↑" } },
  "sel.cursorBelow": { label: "Add Cursor Below", category: "Selection", keys: { label: "Ctrl+Alt+↓" } },

  "view.palette": { label: "Command Palette…", category: "View", keys: { label: "Ctrl+K" } },
  "view.language": { label: "Change Language…", category: "View" },
  "view.toggleMode": { label: "Toggle Raw/Visual Mode", category: "View", keys: { label: "Ctrl+E" } },
  "view.outline": { label: "Outline", category: "View", paletteLabel: "Toggle Outline Sidebar", keys: { label: "Ctrl+Shift+O" } },
  "view.diffUnsaved": { label: "Diff Unsaved Changes", category: "View", keys: { label: "Ctrl+Shift+D" }, when: "file" },
  "view.wordWrap": { label: "Word Wrap", category: "View", paletteLabel: "Toggle Word Wrap", keys: { label: "Ctrl+Alt+W" } },
  "view.whitespace": { label: "Show Whitespace", category: "View", paletteLabel: "Toggle Show Whitespace" },
  "view.indent2": { label: "Indent Using Spaces: 2", category: "View" },
  "view.indent4": { label: "Indent Using Spaces: 4", category: "View" },
  "view.indent8": { label: "Indent Using Spaces: 8", category: "View" },
  "view.indentTabs": { label: "Indent Using Tabs", category: "View" },
  "view.fontUp": { label: "Increase Font Size", category: "View", keys: { label: "Ctrl+=" } },
  "view.fontDown": { label: "Decrease Font Size", category: "View", keys: { label: "Ctrl+-" } },
  "view.fontReset": { label: "Reset Font Size", category: "View", keys: { label: "Ctrl+0" } },
  "view.nextTab": { label: "Next Tab", category: "View", keys: { label: "Ctrl+Tab", browser: "Alt+PageDown" } },
  "view.prevTab": { label: "Previous Tab", category: "View", keys: { label: "Ctrl+Shift+Tab", browser: "Alt+PageUp" } },

  "help.updates": { label: "Check for Updates…", category: "Help", when: "tauri" },
  "help.download": { label: "Download the Desktop App…", category: "Help", when: "browser" },
  "help.discord": { label: "Discord community", category: "Help" },
};

const RECENT = "recent";
const SEP = "-";
type Slot = CommandId | typeof RECENT | typeof SEP;

const MENU_LAYOUT: readonly { readonly label: string; readonly slots: readonly Slot[] }[] = [
  {
    label: "File",
    slots: [
      "file.new", "file.open", RECENT, "file.reopenClosed", SEP,
      "file.save", "file.saveAs", "file.autoSave", SEP,
      "file.exportHtml", SEP,
      "file.closeTab",
    ],
  },
  {
    label: "Edit",
    slots: [
      "edit.undo", "edit.redo", SEP,
      "edit.find", "edit.replace", "edit.findNext", "edit.findPrevious", "edit.gotoLine", SEP,
      "edit.moveLineUp", "edit.moveLineDown", "edit.duplicateLine", "edit.deleteLine",
      "edit.toggleComment", "edit.toggleBlockComment", "edit.indent", "edit.outdent", SEP,
      "edit.joinLines", "edit.sortAsc", "edit.sortDesc", "edit.uniqueLines", "edit.trimTrailing", SEP,
      "edit.upperCase", "edit.lowerCase", "edit.titleCase", SEP,
      "edit.toggleCheckbox", "edit.formatTable", "edit.copyHtml", SEP,
      "edit.copyForAI", "edit.cleanPaste",
    ],
  },
  {
    label: "Selection",
    slots: [
      "sel.selectAll", "sel.selectLine", SEP,
      "sel.selectNext", "sel.selectAllOccurrences", SEP,
      "sel.cursorAbove", "sel.cursorBelow",
    ],
  },
  {
    label: "View",
    slots: [
      "view.palette", "view.language", SEP,
      "view.toggleMode", "view.outline", "view.diffUnsaved", SEP,
      "view.wordWrap", "view.whitespace", SEP,
      "view.indent2", "view.indent4", "view.indent8", "view.indentTabs", SEP,
      "view.fontUp", "view.fontDown", "view.fontReset",
    ],
  },
  { label: "Help", slots: ["help.updates", "help.download", "help.discord"] },
];

export interface CommandContext {
  readonly tauri: boolean;
  /** The active tab is markdown. */
  readonly markdown: boolean;
  /** The active tab has a file path. */
  readonly hasFile: boolean;
  /** Toggle and choice commands currently on (shown with a check mark). */
  readonly checked: ReadonlySet<CommandId>;
}

export type CommandTarget =
  | { readonly kind: "command"; readonly id: CommandId }
  | { readonly kind: "recent"; readonly path: string };

export type MenuEntry =
  | {
      readonly kind: "item";
      readonly target: CommandTarget;
      readonly label: string;
      readonly shortcut?: string;
      readonly checked?: boolean;
    }
  | { readonly kind: "separator" };

export interface MenuModel {
  readonly label: string;
  readonly entries: readonly MenuEntry[];
}

export interface PaletteEntry {
  readonly key: string;
  readonly title: string;
  readonly shortcut?: string;
  readonly target: CommandTarget;
}

const INDENT_COMMANDS: Readonly<Record<number, CommandId>> = { 2: "view.indent2", 4: "view.indent4", 8: "view.indent8" };

/** The toggle and choice commands the settings turn on, for check marks. */
export function checkedCommands(
  settings: Pick<EditorSettings, "autoSave" | "showOutline" | "wordWrap" | "showWhitespace" | "indentSize" | "indentWithTabs">,
): ReadonlySet<CommandId> {
  const checked = new Set<CommandId>();
  if (settings.autoSave) checked.add("file.autoSave");
  if (settings.showOutline) checked.add("view.outline");
  if (settings.wordWrap) checked.add("view.wordWrap");
  if (settings.showWhitespace) checked.add("view.whitespace");
  const indent = settings.indentWithTabs ? "view.indentTabs" : INDENT_COMMANDS[settings.indentSize];
  if (indent) checked.add(indent);
  return checked;
}

/** The chord label to show for a command on this platform and tab, if any. */
export function shortcutLabel(id: CommandId, ctx: { readonly tauri: boolean; readonly markdown: boolean }): string | undefined {
  const keys = COMMANDS[id].keys;
  if (!keys || (keys.shadowedInMarkdown && ctx.markdown)) return undefined;
  return !ctx.tauri && keys.browser ? keys.browser : keys.label;
}

export function commandLabel(id: CommandId): string {
  return COMMANDS[id].label;
}

export function isAvailable(id: CommandId, ctx: CommandContext): boolean {
  switch (COMMANDS[id].when) {
    case undefined: return true;
    case "markdown": return ctx.markdown;
    case "file": return ctx.hasFile;
    case "tauri": return ctx.tauri;
    case "browser": return !ctx.tauri;
  }
}

function commandItem(id: CommandId, ctx: CommandContext): MenuEntry {
  return {
    kind: "item",
    target: { kind: "command", id },
    label: COMMANDS[id].label,
    shortcut: shortcutLabel(id, ctx),
    checked: ctx.checked.has(id) || undefined,
  };
}

/** Drop leading, trailing and doubled separators left behind by hidden commands. */
function tidySeparators(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "separator" && (out.length === 0 || out[out.length - 1].kind === "separator")) continue;
    out.push(entry);
  }
  if (out.length > 0 && out[out.length - 1].kind === "separator") out.pop();
  return out;
}

/** The menu bar for the current context; recent files sit in File after Open. */
export function buildMenus(ctx: CommandContext, recentFiles: readonly string[]): MenuModel[] {
  return MENU_LAYOUT.map(({ label, slots }) => {
    const entries: MenuEntry[] = [];
    for (const slot of slots) {
      if (slot === SEP) {
        entries.push({ kind: "separator" });
      } else if (slot === RECENT) {
        if (recentFiles.length === 0) continue;
        entries.push({ kind: "separator" });
        for (const path of recentFiles) entries.push({ kind: "item", target: { kind: "recent", path }, label: basename(path) });
        entries.push(commandItem("file.clearRecent", ctx), { kind: "separator" });
      } else if (isAvailable(slot, ctx)) {
        entries.push(commandItem(slot, ctx));
      }
    }
    return { label, entries: tidySeparators(entries) };
  }).filter((menu) => menu.entries.length > 0);
}

/** Every available command in catalog order, then one entry per recent file. */
export function buildPalette(ctx: CommandContext, recentFiles: readonly string[]): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const id of Object.keys(COMMANDS) as CommandId[]) {
    if (!isAvailable(id, ctx)) continue;
    if (id === "file.clearRecent" && recentFiles.length === 0) continue;
    const def = COMMANDS[id];
    entries.push({
      key: id,
      title: `${def.category}: ${def.paletteLabel ?? def.label}`,
      shortcut: shortcutLabel(id, ctx),
      target: { kind: "command", id },
    });
  }
  for (const path of recentFiles) {
    entries.push({ key: `recent:${path}`, title: `Open Recent: ${basename(path)}`, target: { kind: "recent", path } });
  }
  return entries;
}
