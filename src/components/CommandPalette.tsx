import { useState, useEffect, useRef } from "react";
import { filterByFuzzy, type PaletteCommand } from "../commandPalette";

interface CommandPaletteProps {
  open: boolean;
  commands: readonly PaletteCommand[];
  onClose: () => void;
}

export default function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh query and selection each time the palette opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  const filtered = filterByFuzzy(commands, query, (c) => c.title);
  const cursor = Math.min(selected, Math.max(0, filtered.length - 1));

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor, query]);

  if (!open) return null;

  const run = (cmd: PaletteCommand) => {
    onClose();
    cmd.action();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length) setSelected((cursor + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length) setSelected((cursor - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40" onMouseDown={onClose}>
      <div
        className="mx-auto mt-[12vh] w-[520px] max-w-[90vw] bg-bg-secondary border border-border rounded-lg shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          spellCheck={false}
          className="w-full px-3 py-2.5 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none border-b border-border"
        />
        <div ref={listRef} className="max-h-[45vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => run(cmd)}
              onMouseMove={() => setSelected(i)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors ${
                i === cursor ? "bg-bg-hover text-text-primary" : "text-text-secondary"
              }`}
            >
              <span className="truncate">{cmd.title}</span>
              {cmd.shortcut && (
                <span className="text-text-muted ml-6 text-[10px] shrink-0">{cmd.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
