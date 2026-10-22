import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampToViewport } from "../menuPosition";

interface Tab {
  id: string;
  title: string;
  modified: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onMoveTab: (id: string, toIndex: number) => void;
  onCloseOthers: (id: string) => void;
  onCopyPath: (id: string) => void;
}

const DRAG_THRESHOLD_PX = 5;

export default function TabBar({
  tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, onMoveTab, onCloseOthers, onCopyPath,
}: TabBarProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; overIndex: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Pointer events, not HTML5 DnD: Tauri's dragDropEnabled window setting swallows in-page drags on Windows.
  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const startX = e.clientX;
    let active = false;
    let over = -1;

    const indexAt = (x: number): number => {
      const tabEls = Array.from(stripRef.current?.children ?? []).slice(0, tabs.length);
      const i = tabEls.findIndex((c) => x < c.getBoundingClientRect().right);
      return i < 0 ? tabEls.length - 1 : i;
    };
    const onMove = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      active = true;
      over = indexAt(ev.clientX);
      setDrag({ id, overIndex: over });
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDrag(null);
      if (active && ev.type === "pointerup" && over >= 0) onMoveTab(id, over);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div
      ref={stripRef}
      className="flex items-end h-9 bg-bg-primary border-b border-border overflow-x-auto shrink-0"
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onNewTab();
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isDragging = drag?.id === tab.id;
        const isDropTarget = drag !== null && drag.overIndex === index && !isDragging;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onPointerDown={(e) => startDrag(e, tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id: tab.id, x: e.clientX, y: e.clientY });
            }}
            className={`group flex items-center gap-2 h-full px-4 cursor-pointer select-none border-r border-border text-sm transition-colors duration-150 ${
              isActive
                ? "bg-bg-secondary text-text-primary border-t-2 border-t-accent"
                : "text-text-secondary hover:bg-bg-tertiary"
            } ${isDragging ? "opacity-50" : ""} ${isDropTarget ? "ring-1 ring-inset ring-accent" : ""}`}
          >
            <span className="truncate max-w-40">
              {tab.modified && <span className="text-accent mr-1">●</span>}
              {tab.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="ml-1 opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary hover:scale-110 transition duration-150"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="1" y1="1" x2="7" y2="7" />
                <line x1="7" y1="1" x2="1" y2="7" />
              </svg>
            </button>
          </div>
        );
      })}
      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          canCloseOthers={tabs.length > 1}
          onCloseOthers={() => onCloseOthers(menu.id)}
          onCopyPath={() => onCopyPath(menu.id)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TabContextMenuProps {
  x: number;
  y: number;
  canCloseOthers: boolean;
  onCloseOthers: () => void;
  onCopyPath: () => void;
  onDismiss: () => void;
}

function TabContextMenu({ x, y, canCloseOthers, onCloseOthers, onCopyPath, onDismiss }: TabContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  // Measure after layout and clamp so the menu stays fully inside the window.
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(clampToViewport(x, y, width, height, window.innerWidth, window.innerHeight));
  }, [x, y]);

  const item = "w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-bg-tertiary disabled:text-text-muted disabled:hover:bg-transparent";
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onDismiss}
        onContextMenu={(e) => { e.preventDefault(); onDismiss(); }}
      />
      <div
        ref={menuRef}
        className="fixed z-50 min-w-40 py-1 bg-bg-secondary border border-border rounded shadow-lg"
        style={pos}
      >
        <button className={item} disabled={!canCloseOthers} onClick={() => { onDismiss(); onCloseOthers(); }}>
          Close Others
        </button>
        <button className={item} onClick={() => { onDismiss(); onCopyPath(); }}>
          Copy Path
        </button>
      </div>
    </>
  );
}
