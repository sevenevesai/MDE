/** Persistent editor settings via localStorage. */

export interface EditorSettings {
  wordWrap: boolean;
  fontSize: number; // px
  /** Raw-mode heading outline sidebar. */
  showOutline: boolean;
  /** Idle auto-save to disk (Tauri only). */
  autoSave: boolean;
  /** Columns per indent level and tab stop; one of INDENT_SIZES. */
  indentSize: number;
  /** Indent with a tab character instead of `indentSize` spaces. */
  indentWithTabs: boolean;
  /** Render spaces and tabs as faint markers. */
  showWhitespace: boolean;
}

const STORAGE_KEY = "mde-settings";

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const INDENT_SIZES: readonly number[] = [2, 4, 8];

export const DEFAULTS: Readonly<EditorSettings> = {
  wordWrap: true,
  fontSize: 14,
  showOutline: false,
  autoSave: false,
  indentSize: 2,
  indentWithTabs: false,
  showWhitespace: false,
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Stored JSON is untrusted: every field falls back to its default when invalid. */
function sanitize(stored: unknown): EditorSettings {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return { ...DEFAULTS };
  const s = stored as Record<string, unknown>;
  const fontSize = s.fontSize;
  const indentSize = s.indentSize;
  return {
    wordWrap: bool(s.wordWrap, DEFAULTS.wordWrap),
    fontSize:
      typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize >= FONT_SIZE_MIN && fontSize <= FONT_SIZE_MAX
        ? fontSize
        : DEFAULTS.fontSize,
    showOutline: bool(s.showOutline, DEFAULTS.showOutline),
    autoSave: bool(s.autoSave, DEFAULTS.autoSave),
    indentSize: typeof indentSize === "number" && INDENT_SIZES.includes(indentSize) ? indentSize : DEFAULTS.indentSize,
    indentWithTabs: bool(s.indentWithTabs, DEFAULTS.indentWithTabs),
    showWhitespace: bool(s.showWhitespace, DEFAULTS.showWhitespace),
  };
}

export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    // Unreadable storage or corrupt JSON: start from defaults.
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
