import React from 'react';
import { Send, Bot, LogOut } from 'lucide-react';
import { AdminUser, DesignConfig } from '../lib/api';

interface DesktopSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: AdminUser;
  design: DesignConfig;
  isBotConnected: boolean;
  botDisplayName: string;
  totalItems: number;
  canSwitchBots?: boolean;
  onOpenBotSwitcher?: () => void;
  onLogout: () => void;
}

const NavIcons = {
  dashboard: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7.5" height="8.5" rx="2.2" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="2.2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2.2" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="2.2" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2.5 2.5 0 0 1 2.5-2.5h4.2l2 2.2H18.5A2.5 2.5 0 0 1 21 9.2v8.3a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V7z" />
    </svg>
  ),
  filters: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  ),
  design: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2.2-.9 2.2-2 0-.6-.2-1-.2-1.5 0-1 .8-1.7 1.8-1.7H18a3 3 0 0 0 3-3A9.5 9.5 0 0 0 12 3z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" />
      <circle cx="11.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="9.5" r="1" fill="currentColor" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
      <circle cx="6" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18" cy="12" r="1.8" />
    </svg>
  ),
};

const DesktopSidebarComponent: React.FC<DesktopSidebarProps> = ({
  currentTab,
  onSelectTab,
  currentUser,
  design,
  isBotConnected,
  botDisplayName,
  totalItems,
  canSwitchBots,
  onOpenBotSwitcher,
  onLogout,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Home', icon: NavIcons.dashboard },
    { id: 'files', label: 'Files', icon: NavIcons.files, badge: totalItems > 0 ? totalItems : undefined },
    { id: 'filters', label: 'Filters', icon: NavIcons.filters },
    { id: 'design', label: 'Design', icon: NavIcons.design },
    { id: 'more', label: 'More', icon: NavIcons.more },
  ];

  return (
    <aside
      aria-label="Desktop Navigation Sidebar"
      className="hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:w-64 xl:w-72 z-40 bg-[#080a16]/78 backdrop-blur-2xl border-r border-white/12 shadow-[8px_0_40px_-12px_rgba(0,0,0,0.75)] select-none"
    >
      {/* Top Brand Header */}
      <div className="p-5 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-[14px] flex items-center justify-center font-black text-base overflow-hidden shrink-0 border border-white/30"
            style={{
              background: 'linear-gradient(135deg, var(--a), var(--a2))',
              boxShadow:
                '0 8px 20px -4px color-mix(in srgb, var(--a) 60%, transparent), 0 1px 0 rgba(255,255,255,.5) inset',
            }}
          >
            {design.loginLogoUrl ? (
              <>
                <img
                  src={design.loginLogoUrl}
                  alt="Logo"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                    const fallback = e.currentTarget.parentElement?.querySelector(
                      '.sidebar-fallback'
                    ) as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div className="sidebar-fallback hidden w-full h-full items-center justify-center text-white">
                  <Send className="w-4 h-4 text-white" />
                </div>
              </>
            ) : (
              <Send className="w-4 h-4 text-white" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold tracking-tight text-white truncate">
              {design.loginTitle || 'ADMIN PANEL'}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/65 mt-0.5 min-w-0">
              {isBotConnected ? (
                <>
                  <span className="lg-dot" />
                  <span className="truncate">{botDisplayName || 'Bot Connected'}</span>
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
      </div>

      {/* Main Navigation Links */}
      <nav aria-label="Primary sections" className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`tap w-full px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-2.5 text-sm transition-all cursor-pointer border whitespace-nowrap ${
                isActive
                  ? 'text-white font-bold border-white/25 shadow-[0_8px_24px_-6px_color-mix(in_srgb,var(--a)_45%,transparent)]'
                  : 'text-white/65 hover:text-white font-semibold border-transparent hover:bg-white/[0.06]'
              }`}
              style={
                isActive
                  ? {
                      background:
                        'linear-gradient(135deg, color-mix(in srgb, var(--a) 28%, rgba(255,255,255,0.08)), color-mix(in srgb, var(--a2) 18%, rgba(255,255,255,0.04)))',
                    }
                  : undefined
              }
            >
              <span className="flex items-center gap-3 min-w-0">
                <span className={isActive ? 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.65)]' : 'text-white/65'}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.badge === 'number' && (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-mono tabular-nums shrink-0 ${
                    isActive
                      ? 'bg-white/20 text-white border border-white/25'
                      : 'bg-white/[0.08] text-white/70 border border-white/10'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Controls & Admin Profile */}
      <div className="p-3.5 border-t border-white/10 space-y-2.5">
        {canSwitchBots && onOpenBotSwitcher && (
          <button
            type="button"
            onClick={onOpenBotSwitcher}
            className="tap w-full px-3 py-2 rounded-xl border text-xs font-bold text-white flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer hover:brightness-110 transition-all"
            style={{
              background: 'color-mix(in srgb, var(--a) 18%, rgba(255,255,255,0.05))',
              borderColor: 'color-mix(in srgb, var(--a) 45%, transparent)',
            }}
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span>Switch Bot</span>
          </button>
        )}

        <div className="p-2.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55 truncate">
              {currentUser.role === 'owner' ? 'Owner' : 'Administrator'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign Out"
            aria-label="Sign Out"
            className="tap p-2 rounded-xl bg-rose-500/12 hover:bg-rose-500/25 border border-rose-400/25 text-rose-300 hover:text-rose-200 cursor-pointer shrink-0 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export const DesktopSidebar = React.memo(DesktopSidebarComponent);
