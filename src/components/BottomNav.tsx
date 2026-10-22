import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Home, FolderClosed, Filter, Palette, Menu } from 'lucide-react';

interface BottomNavProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  accentColor?: string;
}

const BottomNavComponent: React.FC<BottomNavProps> = ({
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

  // Gliding and morphing spring states
  const [isGliding, setIsGliding] = useState(false);
  const [glideDir, setGlideDir] = useState<'left' | 'right' | null>(null);
  const [glideDistance, setGlideDistance] = useState(0);
  const prevIndexRef = useRef(safeIndex);
  const navContainerRef = useRef<HTMLElement | null>(null);

  // Dragging gesture state (smooth liquid dragging with release-to-select)
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragPosRef = useRef<number>(safeIndex);
  const isPointerDownRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const hasMovedRef = useRef(false);
  const justFinishedDragRef = useRef(false);

  // Trigger silky liquid spring morph on tab change
  useEffect(() => {
    if (prevIndexRef.current !== safeIndex) {
      const dist = Math.abs(safeIndex - prevIndexRef.current);
      const dir = safeIndex > prevIndexRef.current ? 'right' : 'left';
      setGlideDir(dir);
      setGlideDistance(dist);
      setIsGliding(true);
      prevIndexRef.current = safeIndex;

      const animDuration = Math.min(420, Math.max(260, 240 + dist * 35));
      const timer = setTimeout(() => {
        setIsGliding(false);
        setGlideDir(null);
        setGlideDistance(0);
      }, animDuration);

      return () => clearTimeout(timer);
    }
  }, [safeIndex]);

  const handleTabClick = (tabId: string) => {
    if (justFinishedDragRef.current) {
      justFinishedDragRef.current = false;
      return;
    }
    if (tabId !== currentTab) {
      onSelectTab(tabId);
    }
  };

  const calculatePositionFromClientX = (clientX: number): number => {
    if (!navContainerRef.current) return safeIndex;
    const rect = navContainerRef.current.getBoundingClientRect();
    const touchX = clientX - rect.left;
    const tabWidth = rect.width / tabCount;
    const rawPos = touchX / tabWidth - 0.5;
    return Math.max(0, Math.min(tabCount - 1, rawPos));
  };

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

    if (!hasMovedRef.current) {
      if (dx > 6 && dx > dy) {
        hasMovedRef.current = true;
        setIsDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
      } else {
        return;
      }
    }

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
      hasMovedRef.current = false;
      setIsDragging(false);
      justFinishedDragRef.current = true;
      setTimeout(() => {
        justFinishedDragRef.current = false;
      }, 100);

      const targetIndex = Math.max(0, Math.min(tabCount - 1, Math.round(dragPosRef.current)));
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

  const springDuration = isGliding
    ? Math.min(420, Math.max(260, 240 + glideDistance * 35))
    : 300;

  const displayPosition = isDragging && dragPosition !== null ? dragPosition : safeIndex;
  const nearestHoverIndex = isDragging && dragPosition !== null ? Math.round(displayPosition) : safeIndex;

  return (
    <div className="fixed bottom-3.5 sm:bottom-4 inset-x-3 sm:inset-x-0 z-40 max-w-[390px] mx-auto pointer-events-none">
      {/* Modern Liquid Capsule Navigation Bar */}
      <nav
        ref={navContainerRef}
        aria-label="Bottom Navigation"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="pointer-events-auto relative h-13 sm:h-14 rounded-full bg-[#07070b]/92 backdrop-blur-2xl border border-red-500/30 p-1.5 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.92),0_0_24px_rgba(239,68,68,0.22),inset_0_1px_1px_rgba(255,255,255,0.15)] select-none transition-all duration-300 touch-pan-y flex items-center"
      >
        {/* Ambient Red Glow under capsule */}
        <div
          className="absolute -bottom-2 inset-x-8 h-4 rounded-full blur-xl pointer-events-none -z-10"
          style={{ background: 'radial-gradient(ellipse at center, rgba(239,68,68,0.38) 0%, transparent 70%)' }}
        />

        {/* Tab Items Row with Sliding Liquid Capsule Bubble */}
        <div className="relative flex items-center justify-between w-full h-full">
          {/* =========================================================================
              FLUID LIQUID PILL / BUBBLE INDICATOR
              Morphs smoothly with fluid spring physics across tabs
              ========================================================================= */}
          <div
            className="absolute top-0 bottom-0 left-0 pointer-events-none z-0 will-change-transform flex items-center justify-center p-0.5"
            style={{
              width: `${100 / tabCount}%`,
              transform: `translate3d(${displayPosition * 100}%, 0, 0)`,
              transition: isDragging
                ? 'none'
                : `transform ${springDuration}ms cubic-bezier(0.34, 1.45, 0.64, 1)`
            }}
          >
            {/* Glowing Liquid Capsule Bubble */}
            <div
              className={`relative w-full h-full rounded-full bg-gradient-to-r from-red-600 via-rose-600 to-red-600 border border-red-400/50 shadow-[0_0_20px_rgba(239,68,68,0.65),inset_0_1px_1.5px_rgba(255,255,255,0.45)] transition-transform duration-250 ${
                isDragging
                  ? 'scale-x-[1.12] scale-y-[0.94]'
                  : isGliding
                  ? glideDir === 'right'
                    ? 'scale-x-[1.16] skew-x-[-2deg]'
                    : 'scale-x-[1.16] skew-x-[2deg]'
                  : 'scale-x-100 scale-y-100 skew-x-0'
              }`}
              style={{
                transformOrigin: isDragging
                  ? 'center center'
                  : glideDir === 'right'
                  ? 'left center'
                  : 'right center'
              }}
            >
              {/* Internal ambient aura */}
              <div className="absolute inset-0 rounded-full bg-red-400/20 blur-xs" />
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
                className="relative z-10 flex-1 h-full flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 active:scale-95 group focus:outline-none"
                aria-selected={isActive}
                title={tab.label}
              >
                {/* Active Inflated Pop Effect: Icon + Label seamlessly expand inside the liquid capsule */}
                <div
                  className={`flex items-center justify-center transition-all duration-250 ${
                    isActive
                      ? 'scale-105 gap-1.5'
                      : isHovered
                      ? 'scale-105'
                      : 'scale-100'
                  }`}
                >
                  <Icon
                    className={`w-4.5 h-4.5 transition-all duration-200 ${
                      isActive
                        ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                        : isHovered
                        ? 'text-zinc-200'
                        : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  />

                  {/* Inflated label only for active item inside liquid bubble */}
                  {isActive && (
                    <span className="text-[11px] font-bold text-white tracking-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in-95 duration-200">
                      {tab.label}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};

export const BottomNav = React.memo(BottomNavComponent);
