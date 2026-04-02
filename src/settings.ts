/** Persistent editor settings via localStorage. */

export interface EditorSettings {
  wordWrap: boolean;
  fontSize: number; // px
}

const STORAGE_KEY = "mde-settings";

const DEFAULTS: EditorSettings = {
  wordWrap: true,
  fontSize: 14,
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
