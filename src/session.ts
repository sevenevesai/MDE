/**
 * Session persistence (hot exit) via localStorage.
 *
 * One snapshot serves both cases: the 10s autosave covers crashes, the
 * close-time save makes exit promptless — dirty buffers simply come back on
 * the next launch. There is deliberately no expiry: restoring old unsaved
 * work always beats dropping it.
 */
import type { DocTab } from "./store/documentStore";
import { detectEol, toLf, type Eol } from "./lineEndings";

const SESSION_KEY = "mde-session";
// Pre-1.2 crash-recovery keys — read once as a fallback, then removed.
const LEGACY_RECOVERY_KEY = "mde-recovery";
const LEGACY_DIRTY_KEY = "mde-recovery-dirty";

export interface SessionData {
  tabs: DocTab[];
  activeTabId: string;
  timestamp: number;
}

export function saveSession(tabs: readonly DocTab[], activeTabId: string): void {
  try {
    const data: SessionData = { tabs: [...tabs], activeTabId, timestamp: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch { /* quota — losing a snapshot is acceptable */ }
}

const isEol = (v: unknown): v is Eol => v === "lf" || v === "crlf";

/**
 * A stored tab, upgraded to the current shape; null when a required field is
 * missing. Sessions written before line-ending support have no `eol` and may
 * hold CRLF text: the ending is detected (from the saved text, which mirrors
 * the file) and the text normalised, so they restore instead of being dropped.
 */
function restoreTab(t: unknown): DocTab | null {
  if (typeof t !== "object" || t === null) return null;
  const tab = t as Record<string, unknown>;
  const { id, title, content, savedContent, filePath } = tab;
  if (typeof id !== "string" || typeof title !== "string") return null;
  if (typeof content !== "string" || typeof savedContent !== "string") return null;
  if (filePath !== null && typeof filePath !== "string") return null;

  const detected = detectEol(savedContent.includes("\n") ? savedContent : content);
  const eol = isEol(tab.eol) ? tab.eol : detected;
  return {
    id,
    title,
    content: toLf(content),
    savedContent: toLf(savedContent),
    filePath,
    eol,
    savedEol: isEol(tab.savedEol) ? tab.savedEol : eol,
    languageOverride: typeof tab.languageOverride === "string" ? tab.languageOverride : null,
  };
}

/** Load the last session. Returns null if none or malformed. */
export function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LEGACY_RECOVERY_KEY);
    localStorage.removeItem(LEGACY_RECOVERY_KEY);
    localStorage.removeItem(LEGACY_DIRTY_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { tabs, activeTabId, timestamp } = data as Record<string, unknown>;
    if (!Array.isArray(tabs) || tabs.length === 0) return null;
    if (typeof activeTabId !== "string") return null;
    const restored = tabs.map(restoreTab);
    if (restored.some((t) => t === null)) return null;
    return {
      tabs: restored.filter((t): t is DocTab => t !== null),
      activeTabId,
      timestamp: typeof timestamp === "number" ? timestamp : 0,
    };
  } catch {
    return null; // unreadable storage or corrupt JSON: start with a fresh tab
  }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable: nothing to clear */ }
}
