/** Data-driven keyboard shortcut registry. */

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
}

export function handleShortcuts(shortcuts: Shortcut[], e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;

  for (const s of shortcuts) {
    const ctrlMatch = s.ctrl ? ctrl : !ctrl;
    const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
    const altMatch = s.alt ? e.altKey : !e.altKey;

    if (ctrlMatch && shiftMatch && altMatch && e.key === s.key) {
      e.preventDefault();
      s.action();
      return;
    }
  }
}
