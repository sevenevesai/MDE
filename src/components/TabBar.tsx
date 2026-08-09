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
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  return (
    <div className="flex items-end h-9 bg-bg-primary border-b border-border overflow-x-auto shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            className={`group flex items-center gap-2 h-full px-4 cursor-pointer border-r border-border text-sm transition-colors duration-150 ${
              isActive
                ? "bg-bg-secondary text-text-primary border-t-2 border-t-accent"
                : "text-text-secondary hover:bg-bg-tertiary"
            }`}
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
    </div>
  );
}
