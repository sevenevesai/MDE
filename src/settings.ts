/** Persistent editor settings via localStorage. */

export interface EditorSettings {
  wordWrap: boolean;
  fontSize: number; // px
  /** Raw-mode heading outline sidebar. */
  showOutline: boolean;
  /** Idle auto-save to disk (Tauri only). */
  autoSave: boolean;
}

const STORAGE_KEY = "mde-settings";

const DEFAULTS: EditorSettings = {
  wordWrap: true,
  fontSize: 14,
  showOutline: false,
  autoSave: false,
};

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: EditorSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;

// --- Recent Files ---

const RECENT_KEY = "mde-recent-files";
const MAX_RECENT = 10;

export function loadRecentFiles(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

export function addRecentFile(path: string): string[] {
  const recent = loadRecentFiles().filter((p) => p !== path);
  recent.unshift(path);
  const trimmed = recent.slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
  return trimmed;
}

export function clearRecentFiles(): void {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}
