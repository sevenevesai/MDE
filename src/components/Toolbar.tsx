import { useCallback } from "react";
import type { EditorView } from "@codemirror/view";
import {
  toggleBold, toggleItalic, toggleStrikethrough, toggleInlineCode,
  insertLink, insertImage, toggleBulletList, toggleOrderedList,
  toggleBlockquote, insertCodeBlock, insertHorizontalRule, setHeading,
} from "../editor/commands";

interface ToolbarProps {
  getView: () => EditorView | null;
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  onClick: () => void;
}

function ToolbarButton({ label, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-7 min-w-7 px-1.5 flex items-center justify-center rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
    >
      {label}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

interface HeadingMenuProps {
  getView: () => EditorView | null;
}

function HeadingMenu({ getView }: HeadingMenuProps) {
  const run = useCallback(
    (level: number) => {
      const view = getView();
      if (view) {
        setHeading(view, level);
        view.focus();
      }
    },
    [getView]
  );

  return (
    <div className="relative group">
      <button
        className="h-7 px-1.5 flex items-center gap-1 rounded text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
        title="Heading level"
      >
        H
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" className="opacity-50">
          <path d="M0 0 L4 5 L8 0 Z" />
        </svg>
      </button>
      <div className="absolute top-full left-0 mt-1 hidden group-hover:flex flex-col bg-bg-secondary border border-border rounded shadow-lg z-50 py-1 min-w-[80px]">
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <button
            key={level}
            onClick={() => run(level)}
            className="px-3 py-1 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <span style={{ fontSize: `${1.3 - level * 0.1}em`, fontWeight: "bold" }}>
              H{level}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Toolbar({ getView }: ToolbarProps) {
  const exec = useCallback(
    (fn: (view: EditorView) => boolean) => {
      const view = getView();
      if (view) {
        fn(view);
        view.focus();
      }
    },
    [getView]
  );

  return (
    <div className="flex items-center h-8 px-2 gap-0.5 bg-bg-secondary border-b border-border shrink-0">
      <HeadingMenu getView={getView} />
      <Separator />
      <ToolbarButton label="B" title="Bold (Ctrl+B)" onClick={() => exec(toggleBold)} />
      <ToolbarButton label="I" title="Italic (Ctrl+I)" onClick={() => exec(toggleItalic)} />
      <ToolbarButton label="S" title="Strikethrough (Ctrl+Shift+X)" onClick={() => exec(toggleStrikethrough)} />
      <ToolbarButton label="<>" title="Inline Code (Ctrl+`)" onClick={() => exec(toggleInlineCode)} />
      <Separator />
      <ToolbarButton label="🔗" title="Link (Ctrl+K)" onClick={() => exec(insertLink)} />
      <ToolbarButton label="🖼" title="Image (Ctrl+Shift+K)" onClick={() => exec(insertImage)} />
      <Separator />
      <ToolbarButton label="•" title="Bullet List (Ctrl+Shift+8)" onClick={() => exec(toggleBulletList)} />
      <ToolbarButton label="1." title="Ordered List (Ctrl+Shift+7)" onClick={() => exec(toggleOrderedList)} />
      <ToolbarButton label="❝" title="Blockquote (Ctrl+Shift+.)" onClick={() => exec(toggleBlockquote)} />
      <Separator />
      <ToolbarButton label="```" title="Code Block (Ctrl+Shift+`)" onClick={() => exec(insertCodeBlock)} />
      <ToolbarButton label="—" title="Horizontal Rule" onClick={() => exec(insertHorizontalRule)} />
    </div>
  );
}
