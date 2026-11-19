import type { CursorInfo } from "../editor/EditorManager";
import type { Eol } from "../lineEndings";
import { selectionSummary } from "../statusText";

interface StatusBarProps {
  cursor: CursorInfo;
  languageLabel: string;
  onPickLanguage: () => void;
  eol: Eol;
  onToggleEol: () => void;
  indentLabel: string;
  onPickIndent: () => void;
  /** null when the tab's language has no visual mode. */
  mode: "raw" | "visual" | null;
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

const chip = "px-1.5 py-0.5 rounded whitespace-nowrap hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer";

export default function StatusBar({
  cursor, languageLabel, onPickLanguage, eol, onToggleEol, indentLabel, onPickIndent,
  mode, onToggleMode, wordWrap, onToggleWrap, fontSize,
}: StatusBarProps) {
  const selection = selectionSummary(cursor.selectionCount, cursor.selectionLength);
  return (
    <div className="flex items-center justify-between gap-3 h-6 px-3 bg-bg-secondary border-t border-border text-xs text-text-muted select-none shrink-0">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden whitespace-nowrap">
        <span>Ln {cursor.line}, Col {cursor.column}</span>
        {selection && <span className="text-text-secondary">{selection}</span>}
        <span>{cursor.wordCount} words</span>
        <span title="Approximate: characters ÷ 4">≈{formatTokens(cursor.charCount)} tokens</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onPickIndent} className={chip} title="Indentation">
          {indentLabel}
        </button>
        <button onClick={onToggleEol} className={chip} title="Line endings: click to switch between LF and CRLF">
          {eol === "crlf" ? "CRLF" : "LF"}
        </button>
        <button onClick={onPickLanguage} className={`${chip} max-w-28 truncate`} title="Change language">
          {languageLabel}
        </button>
        <span className="hidden md:inline px-1">{fontSize}px</span>
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
        {mode && (
          <button
            onClick={onToggleMode}
            className="ml-1 uppercase tracking-wider text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-accent transition-colors cursor-pointer"
            title="Toggle editor mode (Ctrl+E)"
          >
            {mode}
          </button>
        )}
      </div>
    </div>
  );
}
