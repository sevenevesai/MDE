import { useState, useRef, useEffect, useCallback } from "react";
import { isTauri } from "../platform";

interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

interface MenuProps {
  label: string;
  items: MenuEntry[];
  isOpen: boolean;
  onToggle: () => void;
  onHover: () => void;
  anyOpen: boolean;
}

function Menu({ label, items, isOpen, onToggle, onHover, anyOpen }: MenuProps) {
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
        <div className="absolute top-full left-0 mt-0 flex flex-col bg-bg-secondary border border-border rounded-b shadow-lg z-50 py-1 min-w-[200px]">
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="h-px bg-border mx-2 my-1" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  item.action();
                }}
                className="flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-left"
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-text-muted ml-6 text-[10px]">{item.shortcut}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export interface MenuActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHtml: () => void;
  onCloseTab: () => void;
  onToggleMode: () => void;
  onToggleWrap: () => void;
  onFontSizeUp: () => void;
  onFontSizeDown: () => void;
  onFontSizeReset: () => void;
  onCopyHtml: () => void;
  onOpenRecent: (path: string) => void;
  onClearRecent: () => void;
  onCheckUpdates: () => void;
  recentFiles: string[];
}

export default function MenuBar({ actions }: { actions: MenuActions }) {
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

  const act = (fn: () => void) => {
    close();
    fn();
  };

  const recentEntries: MenuEntry[] = actions.recentFiles.length > 0
    ? [
        { separator: true },
        ...actions.recentFiles.map((path) => ({
          label: path.replace(/\\/g, "/").split("/").pop() ?? path,
          shortcut: undefined,
          action: () => act(() => actions.onOpenRecent(path)),
          separator: false as const,
        })),
        { separator: true },
        { label: "Clear Recent", action: () => act(actions.onClearRecent), separator: false as const },
      ]
    : [];

  const fileItems: MenuEntry[] = [
    { label: "New", shortcut: "Ctrl+N", action: () => act(actions.onNew) },
    { label: "Open...", shortcut: "Ctrl+O", action: () => act(actions.onOpen) },
    ...recentEntries,
    { separator: true },
    { label: "Save", shortcut: "Ctrl+S", action: () => act(actions.onSave) },
    { label: "Save As...", shortcut: "Ctrl+Shift+S", action: () => act(actions.onSaveAs) },
    { separator: true },
    { label: "Export HTML...", action: () => act(actions.onExportHtml) },
    { separator: true },
    { label: "Close Tab", shortcut: "Ctrl+W", action: () => act(actions.onCloseTab) },
  ];

  const editItems: MenuEntry[] = [
    { label: "Toggle Mode", shortcut: "Ctrl+E", action: () => act(actions.onToggleMode) },
    { label: "Toggle Word Wrap", shortcut: "Ctrl+Alt+W", action: () => act(actions.onToggleWrap) },
    { separator: true },
    { label: "Copy as HTML", action: () => act(actions.onCopyHtml) },
    { separator: true },
    { label: "Increase Font Size", shortcut: "Ctrl+=", action: () => act(actions.onFontSizeUp) },
    { label: "Decrease Font Size", shortcut: "Ctrl+-", action: () => act(actions.onFontSizeDown) },
    { label: "Reset Font Size", shortcut: "Ctrl+0", action: () => act(actions.onFontSizeReset) },
  ];

  // "Check for Updates" only exists in the desktop app.
  const helpItems: MenuEntry[] = [
    { label: "Check for Updates…", action: () => act(actions.onCheckUpdates) },
  ];

  const anyOpen = openMenu !== null;

  return (
    <div ref={barRef} className="flex items-center h-full">
      <Menu
        label="File"
        items={fileItems}
        isOpen={openMenu === "file"}
        onToggle={() => setOpenMenu(openMenu === "file" ? null : "file")}
        onHover={() => setOpenMenu("file")}
        anyOpen={anyOpen}
      />
      <Menu
        label="Edit"
        items={editItems}
        isOpen={openMenu === "edit"}
        onToggle={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
        onHover={() => setOpenMenu("edit")}
        anyOpen={anyOpen}
      />
      {isTauri && (
        <Menu
          label="Help"
          items={helpItems}
          isOpen={openMenu === "help"}
          onToggle={() => setOpenMenu(openMenu === "help" ? null : "help")}
          onHover={() => setOpenMenu("help")}
          anyOpen={anyOpen}
        />
      )}
    </div>
  );
}
