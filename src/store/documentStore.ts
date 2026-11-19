import { useReducer, useCallback, useRef } from "react";
import { detectEol, toLf, type Eol } from "../lineEndings";
import { detectLanguage } from "../editor/language";

/**
 * One open document. `content` and `savedContent` always hold LF-only text (the
 * editors' native form); `eol` is the line ending the file is written with.
 * A pure line-ending switch counts as an unsaved change through `savedEol`, so
 * `isModified` stays the single dirty test.
 */
export interface DocTab {
  id: string;
  title: string;
  content: string;
  savedContent: string;
  filePath: string | null;
  eol: Eol;
  /** The line ending the file on disk was last read or written with. */
  savedEol: Eol;
  /** A language id chosen by the user; null follows the file name. */
  languageOverride: string | null;
}

/** File text as the store holds it: LF content plus the detected line ending. */
export interface DiskText {
  readonly content: string;
  readonly eol: Eol;
}

/** Normalise text read from disk; every read goes through here so the store only ever sees LF. */
export function fromDisk(text: string): DiskText {
  return { content: toLf(text), eol: detectEol(text) };
}

export const DEFAULT_CONTENT = "";

let tabCounter = 1;

export function createNewTab(): DocTab {
  const id = `untitled-${Date.now()}-${tabCounter}`;
  const title = `Untitled-${tabCounter}.md`;
  tabCounter++;
  return {
    id, title, content: DEFAULT_CONTENT, savedContent: DEFAULT_CONTENT, filePath: null,
    eol: "lf", savedEol: "lf", languageOverride: null,
  };
}

/** A fresh tab for a file read from disk. */
export function tabFromFile(file: { readonly path: string; readonly name: string; readonly content: string }): DocTab {
  const { content, eol } = fromDisk(file.content);
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: file.name,
    content,
    savedContent: content,
    filePath: file.path,
    eol,
    savedEol: eol,
    languageOverride: null,
  };
}

export function isModified(tab: DocTab): boolean {
  return tab.content !== tab.savedContent || tab.eol !== tab.savedEol;
}

/** The tab's editor language: the user's override, else detected from its path or title. */
export function tabLanguage(tab: Pick<DocTab, "languageOverride" | "filePath" | "title">): string {
  return tab.languageOverride ?? detectLanguage(tab.filePath ?? tab.title);
}

/** Id of the tab `delta` steps from the active one, wrapping around. */
export function adjacentTabId(tabs: readonly DocTab[], activeId: string, delta: number): string {
  const idx = tabs.findIndex((t) => t.id === activeId);
  if (idx < 0 || tabs.length === 0) return activeId;
  return tabs[(idx + delta + tabs.length) % tabs.length].id;
}

// --- State ---

export interface DocState {
  tabs: DocTab[];
  activeTabId: string;
}

function createInitialState(): DocState {
  const tab = createNewTab();
  return { tabs: [tab], activeTabId: tab.id };
}

// --- Actions ---

type DocAction =
  | { type: "ADD_TAB"; tab: DocTab }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "UPDATE_CONTENT"; tabId: string; content: string }
  /** `content`/`eol` are what was written: edits made while the write ran stay unsaved. */
  | { type: "MARK_SAVED"; tabId: string; content: string; eol: Eol }
  | { type: "REPLACE_TAB"; tabId: string; patch: Partial<DocTab> }
  | { type: "SET_TABS"; tabs: DocTab[] }
  | { type: "MOVE_TAB"; id: string; toIndex: number }
  | { type: "REMOVE_TAB"; id: string; replacement?: DocTab }
  /**
   * Load file text into an existing tab as its clean, saved state (open into the
   * current tab, refresh, reload from disk). A different path drops the language
   * override: it belonged to the previous file.
   */
  | { type: "LOAD_FILE"; tabId: string; name: string; path: string; text: DiskText }
  | { type: "SET_EOL"; tabId: string; eol: Eol }
  | { type: "SET_LANGUAGE"; tabId: string; languageOverride: string | null };

function mapTab(state: DocState, tabId: string, update: (t: DocTab) => DocTab): DocState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? update(t) : t)) };
}

export function docReducer(state: DocState, action: DocAction): DocState {
  switch (action.type) {
    case "ADD_TAB":
      return {
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
      };

    case "SET_ACTIVE":
      return { ...state, activeTabId: action.id };

    case "UPDATE_CONTENT":
      return mapTab(state, action.tabId, (t) => ({ ...t, content: action.content }));

    case "MARK_SAVED":
      return mapTab(state, action.tabId, (t) => ({ ...t, savedContent: action.content, savedEol: action.eol }));

    case "REPLACE_TAB":
      return mapTab(state, action.tabId, (t) => ({ ...t, ...action.patch }));

    case "SET_TABS":
      return { ...state, tabs: action.tabs };

    case "LOAD_FILE":
      return mapTab(state, action.tabId, (t) => ({
        ...t,
        title: action.name,
        filePath: action.path,
        content: action.text.content,
        savedContent: action.text.content,
        eol: action.text.eol,
        savedEol: action.text.eol,
        languageOverride: t.filePath === action.path ? t.languageOverride : null,
      }));

    case "SET_EOL":
      return mapTab(state, action.tabId, (t) => ({ ...t, eol: action.eol }));

    case "SET_LANGUAGE":
      return mapTab(state, action.tabId, (t) => ({ ...t, languageOverride: action.languageOverride }));

    case "MOVE_TAB": {
      const from = state.tabs.findIndex((t) => t.id === action.id);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(action.toIndex, state.tabs.length - 1));
      if (to === from) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...state, tabs };
    }

    case "REMOVE_TAB": {
      if (state.tabs.length <= 1) {
        const tab = action.replacement ?? createNewTab();
        return { tabs: [tab], activeTabId: tab.id };
      }
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      const next = state.tabs.filter((t) => t.id !== action.id);
      const newActive = state.activeTabId === action.id
        ? next[Math.min(idx, next.length - 1)].id
        : state.activeTabId;
      return { tabs: next, activeTabId: newActive };
    }

    default:
      return state;
  }
}

// --- Hook ---

export function useDocumentStore() {
  const [state, dispatch] = useReducer(docReducer, undefined, createInitialState);

  // Snapshot ref — always current, no stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  return { state, dispatch, getState, activeTab };
}
