interface StatusBarProps {
  line: number;
  column: number;
  wordCount: number;
  charCount: number;
  mode: "raw" | "visual";
  onToggleMode: () => void;
  wordWrap: boolean;
  onToggleWrap: () => void;
  fontSize: number;
}

/** Estimated token count (chars ÷ 4), abbreviated to e.g. "12.4k" at ≥10k. */
function formatTokens(chars: number): string {
  const tokens = Math.round(chars / 4);
  return tokens >= 10000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

export default function StatusBar({
  line, column, wordCount, charCount, mode, onToggleMode, wordWrap, onToggleWrap, fontSize,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between h-6 px-3 bg-bg-secondary border-t border-border text-xs text-text-muted select-none shrink-0">
      <div className="flex items-center gap-4">
        <span>Ln {line}, Col {column}</span>
        <span>{wordCount} words</span>
        <span title="Approximate: characters ÷ 4">≈{formatTokens(charCount)} tokens</span>
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
