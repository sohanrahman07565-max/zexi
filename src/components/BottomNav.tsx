import React, { useMemo } from 'react';
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

  return (
    <div className="fixed bottom-3.5 sm:bottom-4 inset-x-3 sm:inset-x-0 z-40 max-w-[420px] mx-auto pointer-events-none">
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

        {/* Tab Items Row with Rigid Fixed-Width Sliding Pill & Centered Active Indicator */}
        <div className="relative flex items-center w-full h-full">
          {/* =========================================================================
              RIGID FIXED-WIDTH ACTIVE INDICATOR PILL (Standard translateX, Zero Distortion)
              Maintains rigid shape and constant width at all times without squishing,
              shrinking, stretching, or shifting improperly to the side.
              ========================================================================= */}
          <div
            className="absolute top-1 bottom-1 left-0 pointer-events-none z-0 px-1"
            style={{
              width: '20%',
              transform: `translateX(${safeIndex * 100}%)`,
              transition: 'transform 240ms cubic-bezier(0.2, 0.8, 0.25, 1)',
              willChange: 'transform',
              boxSizing: 'border-box'
            }}
          >
            {/* Rigid Glowing Liquid Capsule Bubble */}
            <div className="relative w-full h-full rounded-2xl sm:rounded-3xl bg-gradient-to-r from-cyan-500/85 via-teal-400/90 to-sky-500/85 border border-cyan-300/60 shadow-[0_0_18px_rgba(6,182,212,0.65),inset_0_1px_2px_rgba(255,255,255,0.65)] flex items-center justify-center">
              {/* Active Indicator Ball/Glow at the bottom center of the active tab */}
              <div className="absolute bottom-1 w-3.5 h-1 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,1),0_0_12px_rgba(6,182,212,0.95)] pointer-events-none" />
            </div>
          </div>

          {/* Interactive Navigation Items with strictly uniform 20% width */}
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id !== currentTab) {
                    onSelectTab(tab.id);
                  }
                }}
                className="relative z-10 w-1/5 basis-1/5 shrink-0 h-full flex items-center justify-center rounded-2xl cursor-pointer group focus:outline-none min-w-0 px-0.5"
                aria-selected={isActive}
                title={tab.label}
              >
                {/* Vertical Stack: Icon above, Label strictly UNDERNEATH */}
                <div className="flex flex-col items-center justify-center gap-0.5 min-w-0">
                  <Icon
                    className={`w-5 h-5 transition-colors duration-150 shrink-0 ${
                      isActive
                        ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.9)]'
                        : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  />

                  {/* Label strictly positioned UNDERNEATH the icon */}
                  <span
                    className={`text-[10px] sm:text-[11px] tracking-tight transition-colors duration-150 leading-none truncate max-w-full ${
                      isActive
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
