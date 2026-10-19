import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Home, FolderClosed, Filter, Palette, Menu } from 'lucide-react';

interface BottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  accentColor?: string;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  accentColor = '#ef4444'
}) => {
  const tabs = useMemo(
    () => [
      { id: 'dashboard', label: 'Dashboard', icon: Home },
      { id: 'files', label: 'Files', icon: FolderClosed },
      { id: 'filters', label: 'Filters', icon: Filter },
      { id: 'design', label: 'Design', icon: Palette },
      { id: 'more', label: 'More', icon: Menu }
    ],
    []
  );

  const activeIndex = tabs.findIndex((t) => t.id === currentTab);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  const tabCount = tabs.length;

  // Track gliding and morphing state for organic spring physics
  const [isGliding, setIsGliding] = useState(false);
  const [glideDir, setGlideDir] = useState<'left' | 'right' | null>(null);
  const [glideDistance, setGlideDistance] = useState(0);
  const prevIndexRef = useRef(safeIndex);
  const navContainerRef = useRef<HTMLElement | null>(null);

  // Dragging gesture state (free sliding without snapping or page changes until drop)
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragPosRef = useRef<number>(safeIndex);
  const isPointerDownRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const hasMovedRef = useRef(false);
  const justFinishedDragRef = useRef(false);

  // Trigger organic spring morph on tab change
  useEffect(() => {
    if (prevIndexRef.current !== safeIndex) {
      const dist = Math.abs(safeIndex - prevIndexRef.current);
      const dir = safeIndex > prevIndexRef.current ? 'right' : 'left';
      setGlideDir(dir);
      setGlideDistance(dist);
      setIsGliding(true);
      prevIndexRef.current = safeIndex;

      // Spring settles smoothly
      const animDuration = Math.min(480, Math.max(300, 270 + dist * 40));
      const timer = setTimeout(() => {
        setIsGliding(false);
        setGlideDir(null);
        setGlideDistance(0);
      }, animDuration);

      return () => clearTimeout(timer);
    }
  }, [safeIndex]);

  // Handle Tab Select (silent, zero vibration)
  const handleTabClick = (tabId: string) => {
    // If user just finished dragging, ignore the click to prevent double triggering
    if (justFinishedDragRef.current) {
      justFinishedDragRef.current = false;
      return;
    }
    if (tabId !== currentTab) {
      onSelectTab(tabId);
    }
  };

  // Helper to compute continuous tab position from clientX
  const calculatePositionFromClientX = (clientX: number): number => {
    if (!navContainerRef.current) return safeIndex;
    const rect = navContainerRef.current.getBoundingClientRect();
    const touchX = clientX - rect.left;
    const tabWidth = rect.width / tabCount;
    const rawPos = touchX / tabWidth - 0.5;
    return Math.max(0, Math.min(tabCount - 1, rawPos));
  };

  // Pointer / Touch Gesture Handlers (Release-to-Select Logic)
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    isPointerDownRef.current = true;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    hasMovedRef.current = false;
    dragPosRef.current = safeIndex;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isPointerDownRef.current) return;
    const dx = Math.abs(e.clientX - startXRef.current);
    const dy = Math.abs(e.clientY - startYRef.current);

    // Only engage drag mode if horizontal displacement exceeds threshold
    if (!hasMovedRef.current) {
      if (dx > 7 && dx > dy) {
        hasMovedRef.current = true;
        setIsDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
      } else {
        return;
      }
    }

    // While dragging: freely follow gesture, DO NOT change active tab or trigger page switch!
    const pos = calculatePositionFromClientX(e.clientX);
    dragPosRef.current = pos;
    setDragPosition(pos);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (hasMovedRef.current) {
      // Release-to-select (drop): switch tab only now upon release
      hasMovedRef.current = false;
      setIsDragging(false);
      justFinishedDragRef.current = true;
      setTimeout(() => {
        justFinishedDragRef.current = false;
      }, 120);

      const targetIndex = Math.max(
        0,
        Math.min(tabCount - 1, Math.round(dragPosRef.current))
      );
      setDragPosition(null);

      const targetTab = tabs[targetIndex];
      if (targetTab && targetTab.id !== currentTab) {
        onSelectTab(targetTab.id);
      }
    } else {
      setIsDragging(false);
      setDragPosition(null);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    isPointerDownRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (hasMovedRef.current) {
      hasMovedRef.current = false;
      setIsDragging(false);
      setDragPosition(null);
    }
  };

  // Compute organic spring duration based on travel distance
  const springDuration = isGliding
    ? Math.min(480, Math.max(300, 260 + glideDistance * 40))
    : 340;

  // Active indicator position: follows drag freely during gesture, snaps on release
  const displayPosition = isDragging && dragPosition !== null ? dragPosition : safeIndex;
  const nearestHoverIndex = isDragging && dragPosition !== null ? Math.round(displayPosition) : safeIndex;

  return (
    <div className="fixed bottom-3.5 sm:bottom-4 inset-x-3 sm:inset-x-0 z-40 max-w-[420px] mx-auto pointer-events-none">
      {/* Floating Capsule Container with dark/black background and glowing red outline */}
      <nav
        ref={navContainerRef}
        aria-label="Bottom Navigation"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="pointer-events-auto relative rounded-[28px] bg-[#07070a]/95 backdrop-blur-2xl border border-red-500/35 p-1.5 shadow-[0_12px_40px_-4px_rgba(0,0,0,0.9),0_0_24px_rgba(239,68,68,0.22),inset_0_1px_1px_rgba(255,255,255,0.14)] select-none transition-all duration-300 touch-pan-y"
      >
        {/* Subtle Ambient Red Glow under the floating bar */}
        <div
          className="absolute -bottom-2 inset-x-6 h-5 rounded-full blur-xl pointer-events-none -z-10"
          style={{ background: 'radial-gradient(ellipse at center, rgba(239,68,68,0.35) 0%, transparent 70%)' }}
        />

        {/* Tab Items Row with Sliding Indicator */}
        <div className="relative flex items-center justify-between w-full">
          {/* =========================================================================
              FLUID SPRING SLIDING & MORPHING INDICATOR
              Glides horizontally with silky physical spring dynamics and morphing stretch
              ========================================================================= */}
          <div
            className="absolute top-0 bottom-0 left-0 pointer-events-none z-0 will-change-transform"
            style={{
              width: `${100 / tabCount}%`,
              transform: `translateX(${displayPosition * 100}%)`,
              transition: isDragging
                ? 'none'
                : `transform ${springDuration}ms cubic-bezier(0.34, 1.42, 0.64, 1)`
            }}
          >
            {/* Surrounding Active Pill Capsule Glow with liquid stretch/squash morph */}
            <div
              className={`relative h-full mx-1 rounded-2xl bg-gradient-to-b from-red-500/24 via-red-600/14 to-red-950/25 border border-red-500/40 shadow-[0_0_18px_rgba(239,68,68,0.38),inset_0_1px_1px_rgba(255,255,255,0.25)] flex flex-col justify-end items-center pb-1 transition-transform duration-300 ${
                isDragging
                  ? 'scale-x-[1.08]'
                  : isGliding
                  ? glideDir === 'right'
                    ? 'scale-x-[1.14] skew-x-[-1.5deg]'
                    : 'scale-x-[1.14] skew-x-[1.5deg]'
                  : 'scale-x-100 skew-x-0'
              }`}
              style={{
                transformOrigin: isDragging
                  ? 'center center'
                  : glideDir === 'right'
                  ? 'left center'
                  : 'right center'
              }}
            >
              {/* Soft internal blur aura */}
              <div className="absolute inset-0 rounded-2xl bg-red-500/12 blur-sm -z-10" />

              {/* Vibrant Glowing Red Indicator Bar Underneath with liquid morphing length */}
              <div
                className={`h-[3px] rounded-full bg-gradient-to-r from-red-600 via-red-400 to-rose-500 shadow-[0_0_10px_#ef4444,0_0_20px_rgba(239,68,68,0.95)] transition-all duration-300 ease-out ${
                  isDragging || isGliding ? 'w-10 opacity-90' : 'w-7 opacity-100'
                }`}
              />
            </div>
          </div>

          {/* Interactive Navigation Items */}
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            const isHovered = isDragging && nearestHoverIndex === index;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabClick(tab.id)}
                className="relative z-10 flex-1 flex flex-col items-center justify-center py-2 px-1 rounded-2xl cursor-pointer transition-transform duration-150 active:scale-90 group focus:outline-none"
                aria-selected={isActive}
              >
                {/* Icon with active bright red glow and spring pop bounce */}
                <div className="relative flex items-center justify-center">
                  <Icon
                    className={`w-5 h-5 transition-all duration-300 ${
                      isActive
                        ? 'text-red-400 scale-110 drop-shadow-[0_0_10px_rgba(239,68,68,0.9)] animate-nav-spring'
                        : isHovered
                        ? 'text-zinc-200 scale-105'
                        : 'text-zinc-400 group-hover:text-zinc-200 group-hover:scale-105'
                    }`}
                  />
                  {isActive && (
                    <span className="absolute inset-0 bg-red-500/20 blur-md rounded-full pointer-events-none -z-10" />
                  )}
                </div>

                {/* Label with active highlighting */}
                <span
                  className={`text-[10px] mt-1 tracking-tight transition-colors duration-200 ${
                    isActive
                      ? 'text-white font-bold drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                      : isHovered
                      ? 'text-zinc-200 font-medium'
                      : 'text-zinc-400 group-hover:text-zinc-200 font-medium'
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

