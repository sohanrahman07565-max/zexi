import React, { useMemo, useState, useRef, useCallback } from 'react';
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

  // Real-time Drag State
  const [isDragging, setIsDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; initialIndex: number; hasMoved: boolean } | null>(null);

  // Active visual position (smooth float during drag, integer index when settled)
  const currentVisualIndex = isDragging && dragIndex !== null ? dragIndex : safeIndex;
  const highlightedIndex = Math.max(0, Math.min(tabCount - 1, Math.round(currentVisualIndex)));

  // Pointer Down (Mouse or Touch)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only capture primary button / touch
    if (e.button !== 0) return;

    const container = containerRef.current;
    if (!container) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    dragStartRef.current = {
      startX: e.clientX,
      initialIndex: safeIndex,
      hasMoved: false
    };
  }, [safeIndex]);

  // Pointer Move (Smooth 60/120fps live tracking)
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !containerRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.startX;

    // Threshold to distinguish intentional drag from a stationary tap
    if (!dragStartRef.current.hasMoved) {
      if (Math.abs(deltaX) > 4) {
        dragStartRef.current.hasMoved = true;
        setIsDragging(true);
      } else {
        return;
      }
    }

    const containerWidth = containerRef.current.getBoundingClientRect().width || 1;
    const tabWidth = containerWidth / tabCount;
    const indexOffset = deltaX / tabWidth;
    const rawIndex = dragStartRef.current.initialIndex + indexOffset;

    // Gentle elastic clamp at edges
    const clampedIndex = Math.max(-0.15, Math.min(tabCount - 1 + 0.15, rawIndex));
    setDragIndex(clampedIndex);
  }, [tabCount]);

  // Pointer Up / Snap to Nearest Tab
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;

    const hadMoved = dragStartRef.current.hasMoved;
    const finalDragIndex = dragIndex;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}

    dragStartRef.current = null;
    setIsDragging(false);
    setDragIndex(null);

    // If user dragged, park/snap seamlessly onto the nearest tab
    if (hadMoved && finalDragIndex !== null) {
      const targetIndex = Math.max(0, Math.min(tabCount - 1, Math.round(finalDragIndex)));
      const targetTab = tabs[targetIndex];
      if (targetTab && targetTab.id !== currentTab) {
        onSelectTab(targetTab.id);
      }
    }
  }, [dragIndex, tabCount, tabs, currentTab, onSelectTab]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragStartRef.current = null;
    setIsDragging(false);
    setDragIndex(null);
  }, []);

  return (
    <div className="fixed bottom-3.5 sm:bottom-4 inset-x-3 sm:inset-x-0 z-40 max-w-[420px] mx-auto pointer-events-none select-none">
      {/* Modern Liquid Capsule Navigation Bar */}
      <nav
        aria-label="Bottom Navigation"
        className="pointer-events-auto relative h-16 sm:h-[68px] rounded-full bg-[#070b12]/92 backdrop-blur-2xl border border-cyan-500/25 p-1.5 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.92),0_0_24px_rgba(6,182,212,0.22),inset_0_1px_1.5px_rgba(255,255,255,0.15)] select-none flex items-center"
      >
        {/* Ambient Cyan/Aqua Glow under capsule */}
        <div
          className="absolute -bottom-2 inset-x-8 h-4 rounded-full blur-xl pointer-events-none -z-10"
          style={{ background: 'radial-gradient(ellipse at center, rgba(6,182,212,0.38) 0%, transparent 70%)' }}
        />

        {/* Tab Items Row with Interactive Draggable Glowing Pill */}
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="relative flex items-center w-full h-full touch-none cursor-grab active:cursor-grabbing"
        >
          {/* =========================================================================
              DRAGGABLE FLUID SLIDING PILL (Clean Glowing Liquid Container)
              Follows touch/cursor in real-time, snaps to nearest tab on release.
              White horizontal dash/line removed per specification.
              ========================================================================= */}
          <div
            className="absolute top-1 bottom-1 left-0 pointer-events-none z-0 px-0.5"
            style={{
              width: '20%',
              transform: `translateX(${currentVisualIndex * 100}%)`,
              transition: isDragging ? 'none' : 'transform 340ms cubic-bezier(0.34, 1.4, 0.64, 1)',
              willChange: 'transform',
              boxSizing: 'border-box'
            }}
          >
            {/* Clean Glowing Fluid Pill without any underlying white line */}
            <div
              className={`relative w-full h-full rounded-2xl sm:rounded-3xl bg-gradient-to-r from-cyan-500/90 via-teal-400/95 to-sky-500/90 border border-cyan-300/70 shadow-[0_0_22px_rgba(6,182,212,0.7),inset_0_1.5px_2.5px_rgba(255,255,255,0.75)] flex items-center justify-center transition-all ${
                isDragging
                  ? 'scale-x-[1.06] scale-y-[1.03] shadow-[0_0_28px_rgba(6,182,212,0.9),inset_0_1.5px_2.5px_rgba(255,255,255,0.9)] brightness-110'
                  : 'scale-x-[1.03] scale-y-[1.02]'
              }`}
            >
              {/* Subtle Soft Specular Top Reflection for Liquid 3D Depth */}
              <div className="absolute top-0.5 inset-x-3 h-1 rounded-full bg-white/40 blur-[0.5px] pointer-events-none" />
            </div>
          </div>

          {/* Navigation Items (Buttons also support direct tap) */}
          {tabs.map((tab, idx) => {
            const Icon = tab.icon;
            const isTabActive = currentTab === tab.id;
            const isVisualFocus = isDragging ? highlightedIndex === idx : isTabActive;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={(e) => {
                  // Only handle tap if not dragging
                  if (dragStartRef.current?.hasMoved) return;
                  if (tab.id !== currentTab) {
                    onSelectTab(tab.id);
                  }
                }}
                className="relative z-10 w-1/5 basis-1/5 shrink-0 h-full flex items-center justify-center rounded-2xl cursor-pointer group focus:outline-none min-w-0 px-0.5 active:scale-95 transition-transform duration-150"
                aria-selected={isTabActive}
                title={tab.label}
              >
                {/* Vertical Stack: Icon above, Label underneath with dynamic illumination */}
                <div
                  className={`flex flex-col items-center justify-center gap-0.5 min-w-0 transition-transform duration-200 ${
                    isVisualFocus ? 'scale-105' : 'scale-100 group-hover:scale-105'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 transition-all duration-200 shrink-0 ${
                      isVisualFocus
                        ? 'text-white scale-110 drop-shadow-[0_0_10px_rgba(255,255,255,0.95)]'
                        : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  />

                  <span
                    className={`text-[10px] sm:text-[11px] tracking-tight transition-all duration-200 leading-none truncate max-w-full ${
                      isVisualFocus
                        ? 'text-white font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]'
                        : 'text-zinc-400 group-hover:text-zinc-300 font-medium'
                    }`}
                  >
                    {tab.label}
                  </span>
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
