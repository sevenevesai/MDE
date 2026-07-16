import { useReducer, useCallback, useRef } from "react";

export interface DocTab {
  id: string;
  title: string;
  content: string;
  savedContent: string;
  filePath: string | null;
}

export const DEFAULT_CONTENT = "";

let tabCounter = 1;

export function createNewTab(): DocTab {
  const id = `untitled-${Date.now()}-${tabCounter}`;
  const title = `Untitled-${tabCounter}.md`;
  tabCounter++;
  return { id, title, content: DEFAULT_CONTENT, savedContent: DEFAULT_CONTENT, filePath: null };
}

export function isModified(tab: DocTab): boolean {
  return tab.content !== tab.savedContent;
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
  | { type: "MARK_SAVED"; tabId: string }
  | { type: "REPLACE_TAB"; tabId: string; patch: Partial<DocTab> }
  | { type: "SET_TABS"; tabs: DocTab[] }
  | { type: "REMOVE_TAB"; id: string; replacement?: DocTab }
  | { type: "OPEN_FILE_INTO_CURRENT"; tabId: string; name: string; content: string; path: string };

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
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, content: action.content } : t
        ),
      };

    case "MARK_SAVED":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, savedContent: t.content } : t
        ),
      };

    case "REPLACE_TAB":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, ...action.patch } : t
        ),
      };

    case "SET_TABS":
      return { ...state, tabs: action.tabs };

    case "OPEN_FILE_INTO_CURRENT":
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId
            ? { ...t, title: action.name, content: action.content, savedContent: action.content, filePath: action.path }
            : t
        ),
      };

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
