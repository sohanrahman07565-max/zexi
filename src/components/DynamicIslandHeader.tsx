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
  const rawPrimary = design.primaryColor;
  const activeAccent =
    !rawPrimary || rawPrimary.toLowerCase() === '#ef4444' ? '#7c9cff' : rawPrimary;

  useEffect(() => {
    setMorphPulse(true);
    const timer = window.setTimeout(() => setMorphPulse(false), 380);
    return () => window.clearTimeout(timer);
  }, [currentTab]);

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
    <header className="sticky top-2 z-30 mb-3.5 flex justify-center shrink-0 pointer-events-none">
      <div
        ref={islandRef}
        className={`glass pointer-events-auto overflow-hidden text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
          expanded
            ? 'w-full rounded-[28px] px-3.5 py-3'
            : morphPulse
            ? 'w-[97%] scale-[1.012] rounded-[28px] px-3.5 py-2.5'
            : 'w-full rounded-[28px] px-3.5 py-2.5'
        }`}
      >
        {/* Specular rim sheen sweep */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-24 island-rim-sheen"
          style={{
            background: `linear-gradient(90deg, transparent, color-mix(in srgb, var(--a) 22%, transparent), rgba(255,255,255,0.14), transparent)`,
          }}
        />

        {/* Compact Liquid Glass Header Row */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label="Toggle Dynamic Island telemetry drawer"
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded((prev) => !prev);
            }
          }}
          className="relative z-10 flex items-center justify-between gap-2.5 cursor-pointer select-none"
        >
          {/* Left: Gradient Glass Logo + Gradient Title + Live Status Dot */}
          <div className="flex items-center gap-2.5 min-w-0 pr-1">
            <div
              className="w-[38px] h-[38px] rounded-[13px] flex items-center justify-center font-black text-base overflow-hidden shrink-0 border border-white/30"
              style={{
                background: 'linear-gradient(135deg, var(--a), var(--a2))',
                boxShadow: '0 8px 20px -4px color-mix(in srgb, var(--a) 60%, transparent), 0 1px 0 rgba(255,255,255,.5) inset',
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
                    <Send className="w-4 h-4 text-white" />
                  </div>
                </>
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1
                  key={currentTab}
                  className="island-title-morph text-[16px] font-extrabold tracking-tight leading-tight truncate bg-gradient-to-b from-white to-white/75 bg-clip-text text-transparent"
                >
                  {tabTitle}
                </h1>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-white/60 shrink-0 transition-transform duration-300 ${
                    expanded ? 'rotate-180 text-white' : ''
                  }`}
                />
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70 mt-0.5 min-w-0">
                {isBotConnected ? (
                  <>
                    <span className="lg-dot" />
                    <span className="truncate">{botDisplayName || 'Bot Connected'}</span>
                    <span
                      aria-hidden="true"
                      className="inline-flex items-end gap-[2px] h-2.5 shrink-0 ml-0.5"
                    >
                      <span
                        className="w-[2px] h-2 rounded-full island-bar-1"
                        style={{ backgroundColor: activeAccent }}
                      />
                      <span
                        className="w-[2px] h-2.5 rounded-full island-bar-2"
                        style={{ backgroundColor: '#34d399' }}
                      />
                      <span
                        className="w-[2px] h-1.5 rounded-full island-bar-3"
                        style={{ backgroundColor: '#c084fc' }}
                      />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-white/40 shrink-0" />
                    <span className="truncate">Bot Offline</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Live Item Count Pill + Owner/Admin Badge */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="hidden xs:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/8 border border-white/15 text-[10.5px] font-bold text-white/85 tabular-nums whitespace-nowrap shrink-0">
              <Sparkles className="w-2.5 h-2.5" style={{ color: activeAccent }} />
              {totalItems}
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateMore();
              }}
              title={`Logged in as ${currentUser.role === 'owner' ? 'Owner' : 'Administrator'} (${currentUser.name})`}
              className="lg-badge tap text-white cursor-pointer whitespace-nowrap shrink-0 hover:bg-white/15"
            >
              {currentUser.role === 'owner' ? 'Owner' : 'Admin'}
            </button>
          </div>
        </div>

        {/* Expanded Dynamic Island Live Telemetry Drawer */}
        {expanded && (
          <div className="relative z-10 mt-3 pt-3 border-t border-white/15 space-y-2.5 island-drawer-reveal">
            <div className="grid grid-cols-3 gap-2">
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.06] border border-white/15 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/55 font-bold">
                  Items
                </div>
                <div className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                  {totalItems}
                </div>
              </div>
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.06] border border-white/15 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/55 font-bold">
                  Users
                </div>
                <div className="text-sm font-extrabold text-white tabular-nums mt-0.5">
                  {totalUsers}
                </div>
              </div>
              <div className="px-2.5 py-2 rounded-2xl bg-white/[0.06] border border-white/15 text-center">
                <div className="text-[10px] uppercase tracking-wider text-white/55 font-bold">
                  Online
                </div>
                <div className="text-sm font-extrabold text-emerald-400 tabular-nums mt-0.5">
                  {onlineUsers}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleRefreshClick}
                  className="tap flex-1 px-2.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
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
                className="tap flex-1 px-2.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
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
                  className="tap flex-1 px-2.5 py-2 rounded-xl border text-white text-[11px] font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  style={{
                    background: 'color-mix(in srgb, var(--a) 22%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--a) 55%, transparent)',
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
