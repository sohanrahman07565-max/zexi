import React, { useState, useEffect, useRef } from 'react';
import { Send, RefreshCw, Settings, Bot, ChevronDown, Sparkles } from 'lucide-react';
import { AdminUser, DesignConfig } from '../lib/api';

interface DynamicIslandHeaderProps {
  currentTab: string;
  currentUser: AdminUser;
  design: DesignConfig;
  isBotConnected: boolean;
  botDisplayName: string;
  totalItems: number;
  totalUsers: number;
  onlineUsers: number;
  canSwitchBots?: boolean;
  onNavigateMore: () => void;
  onRefresh?: () => Promise<void> | void;
  onOpenBotSwitcher?: () => void;
}

const TAB_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  files: 'Files & Links',
  filters: 'Bot Filters',
  simulator: 'Group Simulator',
  design: 'App Design',
  more: 'More Options',
};

export const DynamicIslandHeader: React.FC<DynamicIslandHeaderProps> = ({
  currentTab,
  currentUser,
  design,
  isBotConnected,
  botDisplayName,
  totalItems,
  totalUsers,
  onlineUsers,
  canSwitchBots,
  onNavigateMore,
  onRefresh,
  onOpenBotSwitcher,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [morphPulse, setMorphPulse] = useState(false);
  const islandRef = useRef<HTMLDivElement | null>(null);

  const tabTitle = TAB_LABELS[currentTab] || 'More Options';
  const primaryColor = design.primaryColor || '#ef4444';
  const accentColor = design.accentColor || '#dc2626';

  // Trigger a subtle Dynamic Island pulse animation on tab changes
  useEffect(() => {
    setMorphPulse(true);
    const timer = window.setTimeout(() => setMorphPulse(false), 380);
    return () => window.clearTimeout(timer);
  }, [currentTab]);

  // Collapse Dynamic Island when clicking or tapping outside
  useEffect(() => {
    if (!expanded) return;
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (islandRef.current && !islandRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [expanded]);

  const handleRefreshClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      window.setTimeout(() => setRefreshing(false), 450);
    }
  };

  return (
    <header className="sticky top-1.5 z-30 mb-3 flex justify-center shrink-0 pointer-events-none">
      <div
        ref={islandRef}
        className={`pointer-events-auto relative overflow-hidden text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          expanded
            ? 'w-full rounded-[28px] px-3.5 py-3 shadow-[0_20px_48px_-12px_rgba(0,0,0,0.85)]'
            : morphPulse
            ? 'w-[96%] scale-[1.015] rounded-full px-3 py-2 shadow-[0_14px_34px_-10px_rgba(0,0,0,0.75)]'
            : 'w-full rounded-full px-3 py-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.72)]'
        }`}
        style={{
          background:
            'linear-gradient(155deg, rgba(16, 16, 22, 0.94) 0%, rgba(7, 7, 11, 0.97) 100%)',
          backdropFilter: 'blur(26px) saturate(180%)',
          WebkitBackdropFilter: 'blur(26px) saturate(180%)',
          border: expanded
            ? `1px solid ${primaryColor}55`
            : '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: expanded
            ? `0 20px 50px -12px rgba(0, 0, 0, 0.88), 0 0 28px -8px ${primaryColor}55, inset 0 1px 0 rgba(255, 255, 255, 0.16)`
            : `0 12px 32px -8px rgba(0, 0, 0, 0.72), 0 0 18px -10px ${primaryColor}45, inset 0 1px 0 rgba(255, 255, 255, 0.14)`,
        }}
      >
        {/* Subtle specular rim sheen sweep */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-24 island-rim-sheen"
          style={{
            background: `linear-gradient(90deg, transparent, ${primaryColor}22, rgba(255,255,255,0.12), transparent)`,
          }}
        />

        {/* Compact Top Pill Row */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label="Toggle Dynamic Island details"
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded((prev) => !prev);
            }
          }}
          className="relative z-10 flex items-center justify-between gap-2 cursor-pointer select-none"
        >
          {/* Left: Animated Avatar Notch + Morphing Title & Live Bot Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0 pr-1">
            <div
              className="relative w-8 h-8 rounded-full flex items-center justify-center text-white font-bold overflow-hidden shrink-0 border border-white/20"
              style={{
                background: `radial-gradient(circle at 30% 30%, ${primaryColor}50, ${accentColor}22)`,
                boxShadow: isBotConnected ? `0 0 14px -2px ${primaryColor}70` : undefined,
              }}
            >
              {design.loginLogoUrl ? (
                <>
                  <img
                    src={design.loginLogoUrl}
                    alt="Logo"
                    className="w-full h-full object-cover transition-transform duration-300"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                      const fallback = e.currentTarget.parentElement?.querySelector(
                        '.appbar-fallback'
                      ) as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  <div className="appbar-fallback hidden w-full h-full items-center justify-center text-white">
                    <Send className="w-3.5 h-3.5 text-white" />
                  </div>
                </>
              ) : (
                <Send className="w-3.5 h-3.5 text-white" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1
                  key={currentTab}
                  className="island-title-morph text-xs sm:text-[13px] font-bold tracking-tight text-white leading-tight truncate"
                >
                  {tabTitle}
                </h1>
                <ChevronDown
                  className={`w-3 h-3 text-zinc-400 shrink-0 transition-transform duration-300 ${
                    expanded ? 'rotate-180 text-white' : ''
                  }`}
                />
              </div>

              <div className="flex items-center gap-1.5 text-[10px] mt-0.5 min-w-0">
                {isBotConnected ? (
                  <>
                    <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
                      <span className="island-pulse-halo absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                    <span className="truncate font-medium text-zinc-300">
                      {botDisplayName || 'Bot'}
                    </span>
                    {/* Equalizer Waveform Indicator */}
                    <span
                      aria-hidden="true"
                      className="inline-flex items-end gap-[2px] h-2.5 shrink-0 ml-0.5"
                    >
                      <span
                        className="w-[2px] h-2 rounded-full island-bar-1"
                        style={{ backgroundColor: primaryColor }}
                      />
                      <span
                        className="w-[2px] h-2.5 rounded-full island-bar-2"
                        style={{ backgroundColor: '#34d399' }}
                      />
                      <span
                        className="w-[2px] h-1.5 rounded-full island-bar-3"
                        style={{ backgroundColor: accentColor }}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                    <span className="truncate font-medium text-zinc-400">Bot Offline</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Quick Live Status Pill + Role Chip */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="hidden xs:inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-semibold text-zinc-300 tabular-nums whitespace-nowrap shrink-0">
              <Sparkles className="w-2.5 h-2.5" style={{ color: primaryColor }} />
              {totalItems}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateMore();
              }}
              title={`Logged in as ${currentUser.role === 'owner' ? 'Owner' : 'Administrator'} (${currentUser.name})`}
              className="px-3 py-1 rounded-full border border-white/15 bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
            >
              {currentUser.role === 'owner' ? 'Owner' : 'Admin'}
            </button>
          </div>
        </div>

        {/* Expanded Dynamic Island Live Drawer */}
        {expanded && (
          <div className="relative z-10 mt-3 pt-2.5 border-t border-white/10 space-y-2.5 island-drawer-reveal">
            {/* Live Telemetry Grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.05] border border-white/10 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  Items
                </div>
                <div className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {totalItems}
                </div>
              </div>
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.05] border border-white/10 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  Users
                </div>
                <div className="text-sm font-bold text-white tabular-nums mt-0.5">
                  {totalUsers}
                </div>
              </div>
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.05] border border-white/10 text-center">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  Online
                </div>
                <div className="text-sm font-bold text-emerald-400 tabular-nums mt-0.5">
                  {onlineUsers}
                </div>
              </div>
            </div>

            {/* Island Quick Action Bar */}
            <div className="flex items-center gap-1.5">
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleRefreshClick}
                  className="flex-1 px-2.5 py-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer active:scale-95 transition-all"
                >
                  <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Sync Data</span>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                  onNavigateMore();
                }}
                className="flex-1 px-2.5 py-1.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer active:scale-95 transition-all"
              >
                <Settings className="w-3 h-3" />
                <span>Controls</span>
              </button>
              {canSwitchBots && onOpenBotSwitcher && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(false);
                    onOpenBotSwitcher();
                  }}
                  className="flex-1 px-2.5 py-1.5 rounded-xl border text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer active:scale-95 transition-all"
                  style={{
                    backgroundColor: `${primaryColor}24`,
                    borderColor: `${primaryColor}55`,
                  }}
                >
                  <Bot className="w-3 h-3" />
                  <span>Switch Bot</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
