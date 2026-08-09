import type { OutlineItem } from "../outline";

interface OutlineSidebarProps {
  items: OutlineItem[];
  onJump: (item: OutlineItem) => void;
}

// Indent per heading level. Level 1 sits flush; deeper levels step in.
const INDENT_PX = 10;

/**
 * Raw-mode document outline: every ATX heading, click to jump.
 * Deliberately not driven by cursor position — highlighting the current section
 * would re-render this list on every keystroke.
 */
export default function OutlineSidebar({ items, onJump }: OutlineSidebarProps) {
  return (
    <aside className="w-60 shrink-0 flex flex-col border-l border-border bg-bg-secondary overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted border-b border-border">
        Outline
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-text-muted italic">No headings</div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {items.map((item) => (
            <button
              key={`${item.line}:${item.from}`}
              onClick={() => onJump(item)}
              title={item.text || `Heading ${item.level}`}
              className="block w-full text-left px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors truncate"
              style={{ paddingLeft: 12 + (item.level - 1) * INDENT_PX }}
            >
              {item.text || <span className="text-text-muted">(untitled)</span>}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
