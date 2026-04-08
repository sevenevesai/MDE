/** Crash recovery via localStorage. */

import type { DocTab } from "./store/documentStore";

const RECOVERY_KEY = "mde-recovery";
const RECOVERY_DIRTY_KEY = "mde-recovery-dirty";

interface RecoveryData {
  tabs: DocTab[];
  activeTabId: string;
  timestamp: number;
}

/** Save current tab state for crash recovery. */
export function saveRecovery(tabs: DocTab[], activeTabId: string): void {
  try {
    const data: RecoveryData = { tabs, activeTabId, timestamp: Date.now() };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(data));
    localStorage.setItem(RECOVERY_DIRTY_KEY, "1");
  } catch { /* ignore quota errors */ }
}

/** Mark recovery as clean (normal exit). */
export function clearRecovery(): void {
  try {
    localStorage.removeItem(RECOVERY_DIRTY_KEY);
    localStorage.removeItem(RECOVERY_KEY);
  } catch { /* ignore */ }
}

/** Check if there's unrecovered data from a crash. */
export function hasRecoveryData(): boolean {
  try {
    return localStorage.getItem(RECOVERY_DIRTY_KEY) === "1"
      && localStorage.getItem(RECOVERY_KEY) !== null;
  } catch {
    return false;
  }
}

/** Load recovery data. Returns null if none or invalid. */
export function loadRecovery(): RecoveryData | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const data: RecoveryData = JSON.parse(raw);
    // Only recover if data is less than 24 hours old
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) {
      clearRecovery();
      return null;
    }
    // Only recover tabs that have unsaved changes
    const unsaved = data.tabs.filter((t) => t.content !== t.savedContent);
    if (unsaved.length === 0) {
      clearRecovery();
      return null;
    }
    return data;
  } catch {
    clearRecovery();
    return null;
  }
}
