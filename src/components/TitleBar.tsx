import { getCurrentWindow } from "@tauri-apps/api/window";
import MenuBar, { type MenuActions } from "./MenuBar";

const appWindow = getCurrentWindow();

interface TitleBarProps {
  filePath: string | null;
  title: string;
  menuActions: MenuActions;
}

export default function TitleBar({ filePath, title, menuActions }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-9 bg-bg-secondary border-b border-border select-none shrink-0"
    >
      {/* Left: App name + menus + filename */}
      <div data-tauri-drag-region className="flex items-center h-full min-w-0">
        <span className="text-xs font-semibold text-text-secondary tracking-wide pl-3 pr-2 shrink-0">
          MDE
        </span>
        <MenuBar actions={menuActions} />
        <span className="text-text-muted text-xs mx-2 shrink-0">—</span>
        <span className="text-xs text-text-secondary truncate pr-2" title={filePath ?? title}>
          {filePath ?? title}
        </span>
      </div>

      {/* Window controls */}
      <div className="flex h-full shrink-0">
        <button
          onClick={() => appWindow.minimize()}
          className="h-full w-11 flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="h-full w-11 flex items-center justify-center text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="h-full w-11 flex items-center justify-center text-text-secondary hover:bg-[#c42b1c] hover:text-white transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
