/** Data-driven keyboard shortcut registry. */

export interface Shortcut {
  /** KeyboardEvent.key, or with `physical`, KeyboardEvent.code. */
  key: string;
  /**
   * Match the physical key. Needed for Alt chords: on macOS Option+letter types
   * a character (Option+N is a dead key), so `key` never equals the letter.
   */
  physical?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
}

export function handleShortcuts(shortcuts: readonly Shortcut[], e: KeyboardEvent): void {
  const ctrl = e.ctrlKey || e.metaKey;

  for (const s of shortcuts) {
    const ctrlMatch = s.ctrl ? ctrl : !ctrl;
    const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
    const altMatch = s.alt ? e.altKey : !e.altKey;
    const keyMatch = s.physical ? e.code === s.key : e.key === s.key;

    if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
      e.preventDefault();
      s.action();
      return;
    }
  }
}
