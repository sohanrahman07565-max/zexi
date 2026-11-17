import React, { useMemo, useState, useRef, useCallback } from 'react';

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
  const tabCount = tabs.length;

  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLElement>(null);
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initialIndex: number;
    targetTabId: string | null;
    hasMoved: boolean;
    captured: boolean;
  } | null>(null);
  const lastTapSwitchAtRef = useRef<number>(0);

  const currentVisualIndex = isDragging && dragIndex !== null ? dragIndex : safeIndex;
  const highlightedIndex = Math.max(0, Math.min(tabCount - 1, Math.round(currentVisualIndex)));

  const resolveTabFromPoint = useCallback(
    (clientX: number, target?: EventTarget | null): string | null => {
      if (target instanceof Element) {
        const btn = target.closest<HTMLElement>('[data-tab-id]');
        const id = btn?.getAttribute('data-tab-id');
        if (id) return id;
      }
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const innerWidth = Math.max(1, rect.width - 12);
      const relX = Math.max(0, Math.min(innerWidth - 1, clientX - rect.left - 6));
      const idx = Math.max(0, Math.min(tabCount - 1, Math.floor((relX / innerWidth) * tabCount)));
      return tabs[idx]?.id || null;
    },
    [tabCount, tabs]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!containerRef.current) return;

      const targetTabId = resolveTabFromPoint(e.clientX, e.target);
      dragStartRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        initialIndex: safeIndex,
        targetTabId,
        hasMoved: false,
        captured: false,
      };
    },
    [safeIndex, resolveTabFromPoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragStartRef.current;
      if (!drag || drag.pointerId !== e.pointerId || !containerRef.current) return;

      const deltaX = e.clientX - drag.startX;
      const deltaY = e.clientY - drag.startY;

      if (!drag.hasMoved) {
        // Ignore minor touch micro-jitter; only engage sliding drag once horizontal intent is clear
        if (Math.abs(deltaX) > 8 && Math.abs(deltaX) >= Math.abs(deltaY)) {
          drag.hasMoved = true;
          setIsDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.captured = true;
          } catch {}
        } else {
          return;
        }
      }

      const rect = containerRef.current.getBoundingClientRect();
      const innerWidth = Math.max(1, rect.width - 12);
      const tabWidth = innerWidth / tabCount;
      const rawIndex = drag.initialIndex + deltaX / tabWidth;
      const clampedIndex = Math.max(-0.1, Math.min(tabCount - 1 + 0.1, rawIndex));
      setDragIndex(clampedIndex);
    },
    [tabCount]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragStartRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const hadMoved = drag.hasMoved;
      const targetTabId = drag.targetTabId;
      const wasCaptured = drag.captured;
      const finalDragIndex = dragIndex;

      if (wasCaptured) {
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {}
      }

      dragStartRef.current = null;
      setIsDragging(false);
      setDragIndex(null);

      if (hadMoved && finalDragIndex !== null) {
        const targetIndex = Math.max(0, Math.min(tabCount - 1, Math.round(finalDragIndex)));
        const targetTab = tabs[targetIndex];
        if (targetTab && targetTab.id !== currentTab) {
          lastTapSwitchAtRef.current = Date.now();
          onSelectTab(targetTab.id);
        }
        return;
      }

      // Simple tap / click without horizontal drag -> switch tab immediately
      const tappedId = resolveTabFromPoint(e.clientX, e.target) || targetTabId;
      if (tappedId && tappedId !== currentTab) {
        lastTapSwitchAtRef.current = Date.now();
        onSelectTab(tappedId);
      }
    },
    [dragIndex, tabCount, tabs, currentTab, onSelectTab, resolveTabFromPoint]
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragStartRef.current;
    if (drag?.captured) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
    dragStartRef.current = null;
    setIsDragging(false);
    setDragIndex(null);
  }, []);

  return (
    <div className="lg-nav-shell">
      <nav
        ref={containerRef}
        aria-label="Bottom Navigation"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="lg-nav"
      >
        {/* Sliding Liquid Glass Pill */}
        <div
          className={`lg-pill ${isDragging ? 'drag' : ''}`}
          style={{
            transform: isDragging
              ? `translateX(${currentVisualIndex * 100}%) scale(1.12, 1.06)`
              : `translateX(${currentVisualIndex * 100}%)`,
          }}
        />

        {tabs.map((tab, idx) => {
          const isTabActive = currentTab === tab.id;
          const isVisualFocus = isDragging ? highlightedIndex === idx : isTabActive;

          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              onClick={() => {
                if (Date.now() - lastTapSwitchAtRef.current < 350) return;
                if (tab.id !== currentTab) {
                  onSelectTab(tab.id);
                }
              }}
              aria-selected={isTabActive}
              title={tab.label}
              className={`lg-nb ${isVisualFocus ? 'on' : ''}`}
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
