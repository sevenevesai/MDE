import { basename } from "../fileOps.platform";

const SHORTCUTS: Array<{ chord: string; label: string }> = [
  { chord: "Ctrl+K", label: "Command palette" },
  { chord: "Ctrl+E", label: "Toggle raw/visual mode" },
  { chord: "Ctrl+N", label: "New tab" },
  { chord: "Ctrl+O", label: "Open file" },
  { chord: "Ctrl+S", label: "Save" },
  { chord: "Ctrl+Shift+A", label: "Copy for AI" },
  { chord: "Ctrl+Shift+O", label: "Toggle outline" },
  { chord: "Ctrl+Shift+D", label: "Diff vs disk" },
];

const MAX_RECENT_SHOWN = 6;

interface EmptyStateProps {
  recentFiles: string[];
  onOpenRecent: (path: string) => void;
}

export default function EmptyState({ recentFiles, onOpenRecent }: EmptyStateProps) {
  const shown = recentFiles.slice(0, MAX_RECENT_SHOWN);

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-none flex flex-col items-center gap-6 text-center px-6 max-w-md">
        <div className="pointer-events-none text-sm font-medium text-text-muted tracking-wide">
          MDE
        </div>

        {shown.length > 0 && (
          <div className="pointer-events-auto flex flex-col gap-1 w-full">
            <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">Recent</div>
            {shown.map((path) => (
              <button
                key={path}
                type="button"
                title={path}
                onClick={() => onOpenRecent(path)}
                className="px-2 py-1 rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors truncate text-left"
              >
                {basename(path)}
              </button>
            ))}
          </div>
        )}

        <div className="pointer-events-none w-full">
          <div className="text-[10px] uppercase tracking-wide text-text-muted mb-2">Shortcuts</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-left">
            {SHORTCUTS.map((s) => (
              <div key={s.chord} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">{s.label}</span>
                <span className="text-text-muted font-mono text-[10px] shrink-0">{s.chord}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
