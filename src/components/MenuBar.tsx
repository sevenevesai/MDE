import { useState, useRef, useEffect, useCallback } from "react";
import type { CommandTarget, MenuEntry, MenuModel } from "../commandCatalog";

interface MenuProps {
  label: string;
  entries: readonly MenuEntry[];
  isOpen: boolean;
  onToggle: () => void;
  onHover: () => void;
  anyOpen: boolean;
  onSelect: (target: CommandTarget) => void;
}

function Menu({ label, entries, isOpen, onToggle, onHover, anyOpen, onSelect }: MenuProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        onMouseEnter={() => anyOpen && onHover()}
        className={`h-full px-2.5 text-xs transition-colors ${
          isOpen
            ? "bg-bg-hover text-text-primary"
            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        }`}
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-enter absolute top-full left-0 mt-0 flex flex-col bg-bg-secondary border border-border rounded-b shadow-lg z-50 py-1 min-w-[220px] max-h-[calc(100vh-3rem)] overflow-y-auto">
          {entries.map((entry, i) =>
            entry.kind === "separator" ? (
              <div key={i} className="h-px bg-border mx-2 my-1 shrink-0" />
            ) : (
              <button
                key={i}
                onClick={() => onSelect(entry.target)}
                title={entry.target.kind === "recent" ? entry.target.path : undefined}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-left shrink-0"
              >
                <span className="w-3 shrink-0 text-accent">{entry.checked ? "✓" : ""}</span>
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.shortcut && (
                  <span className="text-text-muted ml-6 text-[10px] shrink-0">{entry.shortcut}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export interface MenuBarProps {
  menus: readonly MenuModel[];
  onSelect: (target: CommandTarget) => void;
}

export default function MenuBar({ menus, onSelect }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpenMenu(null), []);

  // Close menu on click outside
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        close();
      }
    };
    // Use timeout so the current click event doesn't immediately close
    const id = setTimeout(() => window.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", handler);
    };
  }, [openMenu, close]);

  // Close on Escape
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openMenu, close]);

  const anyOpen = openMenu !== null;

  return (
    <div ref={barRef} className="flex items-center h-full">
      {menus.map((menu) => (
        <Menu
          key={menu.label}
          label={menu.label}
          entries={menu.entries}
          isOpen={openMenu === menu.label}
          onToggle={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
          onHover={() => setOpenMenu(menu.label)}
          anyOpen={anyOpen}
          onSelect={(target) => {
            close();
            onSelect(target);
          }}
        />
      ))}
    </div>
  );
}
