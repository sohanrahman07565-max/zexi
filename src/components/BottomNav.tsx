import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  const currentTabRef = useRef(currentTab);
  currentTabRef.current = currentTab;

  const navRef = useRef<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndexFloat, setDragIndexFloat] = useState<number | null>(null);
  const [dragHoveredTabId, setDragHoveredTabId] = useState<string | null>(null);

  const gestureRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    dragging: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    dragging: false,
  });
  const suppressNextClickRef = useRef(false);

  const resolveMetrics = useCallback(
    (clientX: number) => {
      const navEl = navRef.current;
      if (!navEl) return null;
      const rect = navEl.getBoundingClientRect();
      const computed = window.getComputedStyle(navEl);
      const padLeft = parseFloat(computed.paddingLeft) || 6;
      const padRight = parseFloat(computed.paddingRight) || 6;
      const innerWidth = Math.max(1, rect.width - padLeft - padRight);
      const slotWidth = innerWidth / tabs.length;
      const relX = clientX - (rect.left + padLeft);

      const clampedFloat = Math.max(0, Math.min(tabs.length - 1, relX / slotWidth - 0.5));
      const hoveredIdx = Math.max(0, Math.min(tabs.length - 1, Math.round(clampedFloat)));
      return { clampedFloat, hoveredIdx };
    },
    [tabs.length]
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g.active || (g.pointerId !== null && e.pointerId !== g.pointerId)) return;

      const deltaX = e.clientX - g.startX;
      const deltaY = e.clientY - g.startY;

      if (!g.dragging) {
        // Require a clear drag distance before switching from tap mode to slide mode
        if (Math.abs(deltaX) < 7 && Math.abs(deltaY) < 7) return;
        // If user moved predominantly horizontally, enter pill drag mode
        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          g.dragging = true;
          setIsDragging(true);
          try {
            if (navRef.current && g.pointerId !== null && !navRef.current.hasPointerCapture(g.pointerId)) {
              navRef.current.setPointerCapture(g.pointerId);
            }
          } catch {}
        } else {
          // Vertical move outside bar — abort drag cleanly without blocking taps
          g.active = false;
          g.pointerId = null;
          return;
        }
      }

      const metrics = resolveMetrics(e.clientX);
      if (!metrics) return;
      setDragIndexFloat(metrics.clampedFloat);
      const hoveredTab = tabs[metrics.hoveredIdx];
      if (hoveredTab) {
        setDragHoveredTabId(hoveredTab.id);
      }
    };

    const finishPointer = (e: PointerEvent, isCancel: boolean) => {
      const g = gestureRef.current;
      if (!g.active || (g.pointerId !== null && e.pointerId !== g.pointerId)) return;

      const wasDragging = g.dragging;
      const capturedId = g.pointerId;
      g.active = false;
      g.pointerId = null;
      g.dragging = false;

      if (wasDragging) {
        if (!isCancel) {
          const metrics = resolveMetrics(e.clientX);
          if (metrics) {
            const targetTab = tabs[metrics.hoveredIdx];
            if (targetTab && targetTab.id !== currentTabRef.current) {
              onSelectTab(targetTab.id);
            }
          }
        }
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 120);
      }

      setIsDragging(false);
      setDragIndexFloat(null);
      setDragHoveredTabId(null);

      try {
        if (navRef.current && capturedId !== null && navRef.current.hasPointerCapture(capturedId)) {
          navRef.current.releasePointerCapture(capturedId);
        }
      } catch {}
    };

    const handlePointerUp = (e: PointerEvent) => finishPointer(e, false);
    const handlePointerCancel = (e: PointerEvent) => finishPointer(e, true);

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [onSelectTab, resolveMetrics, tabs]);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gestureRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    };
  };

  const pillTranslatePct =
    isDragging && dragIndexFloat !== null ? dragIndexFloat * 100 : safeIndex * 100;

  return (
    <div className="lg-nav-shell md:hidden">
      <nav
        ref={navRef}
        aria-label="Bottom Navigation"
        onPointerDown={handlePointerDown}
        className="lg-nav"
      >
        {/* Sliding Liquid Glass Pill */}
        <div
          className={`lg-pill ${isDragging ? 'drag' : ''}`}
          style={{
            transform: `translateX(${pillTranslatePct}%)`,
          }}
        />

        {tabs.map((tab) => {
          const isTabActive = currentTab === tab.id;
          const isVisuallyHighlighted =
            isDragging && dragHoveredTabId ? dragHoveredTabId === tab.id : isTabActive;

          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              onClick={() => {
                if (suppressNextClickRef.current) return;
                if (tab.id !== currentTab) {
                  onSelectTab(tab.id);
                }
              }}
              aria-selected={isTabActive}
              title={tab.label}
              className={`lg-nb ${isVisuallyHighlighted ? 'on' : ''}`}
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
