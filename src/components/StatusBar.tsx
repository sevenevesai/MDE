interface StatusBarProps {
  line: number;
  column: number;
  wordCount: number;
  mode: "raw" | "visual";
  onToggleMode: () => void;
  wordWrap: boolean;
  onToggleWrap: () => void;
  fontSize: number;
}

export default function StatusBar({
  line, column, wordCount, mode, onToggleMode, wordWrap, onToggleWrap, fontSize,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between h-6 px-3 bg-bg-secondary border-t border-border text-xs text-text-muted select-none shrink-0">
      <div className="flex items-center gap-4">
        <span>Ln {line}, Col {column}</span>
        <span>{wordCount} words</span>
      </div>
      <div className="flex items-center gap-3">
        <span>{fontSize}px</span>
        <button
          onClick={onToggleWrap}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wider transition-colors cursor-pointer ${
            wordWrap
              ? "bg-accent/20 text-accent"
              : "bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
          }`}
          title="Toggle word wrap (Ctrl+Alt+W)"
        >
          WRAP
        </button>
        <span className="text-text-muted">Markdown</span>
        <button
          onClick={onToggleMode}
          className="uppercase tracking-wider text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-accent transition-colors cursor-pointer"
          title="Toggle editor mode (Ctrl+E)"
        >
          {mode}
        </button>
      </div>
    </div>
  );
}
