import React, { useMemo } from 'react';

interface BottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  accentColor?: string;
}

const NavIcons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7.5" height="8.5" rx="2.2" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="2.2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2.2" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="2.2" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2.5 2.5 0 0 1 2.5-2.5h4.2l2 2.2H18.5A2.5 2.5 0 0 1 21 9.2v8.3a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V7z" />
    </svg>
  ),
  filters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  ),
  design: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2.2-.9 2.2-2 0-.6-.2-1-.2-1.5 0-1 .8-1.7 1.8-1.7H18a3 3 0 0 0 3-3A9.5 9.5 0 0 0 12 3z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" />
      <circle cx="11.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="9.5" r="1" fill="currentColor" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  ),
};

const BottomNavComponent: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
}) => {
  const tabs = useMemo(
    () => [
      { id: 'dashboard', label: 'Home', icon: NavIcons.dashboard },
      { id: 'files', label: 'Files', icon: NavIcons.files },
      { id: 'filters', label: 'Filters', icon: NavIcons.filters },
      { id: 'design', label: 'Design', icon: NavIcons.design },
      { id: 'more', label: 'More', icon: NavIcons.more },
    ],
    []
  );

  const activeIndex = tabs.findIndex((t) => t.id === currentTab);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;

  return (
    <div className="lg-nav-shell">
      <nav
        aria-label="Bottom Navigation"
        className="lg-nav"
      >
        {/* Sliding Liquid Glass Pill */}
        <div
          className="lg-pill"
          style={{
            transform: `translateX(${safeIndex * 100}%)`,
          }}
        />

        {tabs.map((tab) => {
          const isTabActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              onClick={() => {
                if (tab.id !== currentTab) {
                  onSelectTab(tab.id);
                }
              }}
              aria-selected={isTabActive}
              title={tab.label}
              className={`lg-nb ${isTabActive ? 'on' : ''}`}
            >
              {tab.icon}
              <span className="truncate max-w-full">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export const BottomNav = React.memo(BottomNavComponent);
