/**
 * Session persistence (hot exit) via localStorage.
 *
 * One snapshot serves both cases: the 10s autosave covers crashes, the
 * close-time save makes exit promptless — dirty buffers simply come back on
 * the next launch. There is deliberately no expiry: restoring old unsaved
 * work always beats dropping it.
 */
import type { DocTab } from "./store/documentStore";

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

function isValidTab(t: unknown): t is DocTab {
  if (typeof t !== "object" || t === null) return false;
  const tab = t as Record<string, unknown>;
  return typeof tab.id === "string"
    && typeof tab.title === "string"
    && typeof tab.content === "string"
    && typeof tab.savedContent === "string"
    && (tab.filePath === null || typeof tab.filePath === "string");
}

/** Load the last session. Returns null if none or malformed. */
export function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LEGACY_RECOVERY_KEY);
    localStorage.removeItem(LEGACY_RECOVERY_KEY);
    localStorage.removeItem(LEGACY_DIRTY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;
    if (!data.tabs.every(isValidTab)) return null;
    if (typeof data.activeTabId !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
