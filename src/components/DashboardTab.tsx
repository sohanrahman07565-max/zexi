import React, { useState, useMemo, useEffect } from 'react';
import { ItemRecord, BotSettings, api } from '../lib/api';
import { FileText, Link2, Hash, Users, Sparkles, Send, ShieldCheck, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { UsersModal } from './UsersModal';

interface DashboardTabProps {
  items: ItemRecord[];
  adminsCount: number;
  trackedCount: number;
  totalUsers?: number;
  onlineUsers?: number;
  offlineUsers?: number;
  settings: BotSettings | null;
  onNavigate: (tab: string) => void;
  onOpenAddModal: (type: 'file' | 'link') => void;
  onRefresh?: () => void;
}

const DashboardTabComponent: React.FC<DashboardTabProps> = ({
  items,
  adminsCount,
  trackedCount,
  totalUsers = 0,
  onlineUsers = 0,
  offlineUsers = 0,
  settings,
  onNavigate,
  onOpenAddModal,
  onRefresh,
}) => {
  const [showUsersModal, setShowUsersModal] = useState<boolean>(false);
  const [liveTotal, setLiveTotal] = useState<number>(totalUsers);
  const [liveOnline, setLiveOnline] = useState<number>(onlineUsers);
  const [liveOffline, setLiveOffline] = useState<number>(offlineUsers);

  // Sync state whenever parent props update
  useEffect(() => {
    setLiveTotal(totalUsers);
    setLiveOnline(onlineUsers);
    setLiveOffline(offlineUsers);
  }, [totalUsers, onlineUsers, offlineUsers]);

  // Real-time automatic polling every 4 seconds for live user activity
  useEffect(() => {
    let isMounted = true;

    const pollLiveStats = async () => {
      try {
        const stats = await api.getStats();
        if (isMounted && stats) {
          setLiveTotal(stats.totalUsers || 0);
          setLiveOnline(stats.onlineUsers || 0);
          setLiveOffline(stats.offlineUsers || 0);
        }
      } catch {
        // Silently continue on background poll
      }
    };

    // Immediate initial poll to ensure latest stats on tab mount
    pollLiveStats();
    const interval = setInterval(pollLiveStats, 4000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const fileItems = useMemo(() => items.filter((i) => i.type === 'file'), [items]);
  const linkItems = useMemo(() => items.filter((i) => i.type === 'link'), [items]);
  const totalTriggers = useMemo(() => items.reduce((acc, i) => acc + (i.triggers?.length || 1), 0), [items]);
  const totalDeliveries = useMemo(() => items.reduce((acc, i) => acc + (i.deliveryCount || 0), 0), [items]);

  const hasToken = useMemo(() => settings?.hasToken || Boolean(settings?.botToken), [settings]);
  const botUsername = settings?.botUsername || 'Not connected';

  const onlinePercent = liveTotal > 0 ? Math.round((liveOnline / liveTotal) * 100) : 0;
  const offlinePercent = liveTotal > 0 ? Math.round((liveOffline / liveTotal) * 100) : 0;

  return (
    <div className="space-y-5 pb-28">
      {/* Sleek Compact Real-Time User Counter Card */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 relative overflow-hidden group hover:border-red-500/30 transition-all shadow-[0_10px_25px_-15px_rgba(0,0,0,0.7)]">
        {/* Subtle ambient background glow */}
        <div className="absolute -top-10 -right-10 w-28 h-28 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none transition-opacity duration-500" />
        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Top: User Logo, Users Modal trigger & Real-time Pulsing Badge */}
        <div className="flex items-center justify-between mb-2.5 relative z-10">
          <div className="flex items-center gap-2">
            <div 
              onClick={() => setShowUsersModal(true)}
              title="Open Users Management"
              className="w-7 h-7 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 cursor-pointer hover:bg-red-500/25 transition-colors shadow-[0_0_10px_rgba(239,68,68,0.2)]"
            >
              <Users className="w-3.5 h-3.5" />
            </div>
            <button
              type="button"
              onClick={() => setShowUsersModal(true)}
              className="px-2 py-0.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/25 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer active:scale-95 shadow-xs"
            >
              <span>Bot Users</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          {/* Real-time live activity pill */}
          <div 
            onClick={() => setShowUsersModal(true)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.12)] cursor-pointer hover:bg-emerald-500/20 transition-all"
            title="Real-time live user activity"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
          </div>
        </div>

        {/* Content Row: Total Users on Left & Sleek Side-by-Side Online/Offline indicators on Right */}
        <div className="flex items-end justify-between gap-3 relative z-10">
          <div 
            onClick={() => setShowUsersModal(true)}
            className="cursor-pointer group/total"
            title="Click to view all users"
          >
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight font-mono leading-none drop-shadow-[0_0_12px_rgba(239,68,68,0.25)]">
              {Number(liveTotal).toLocaleString()}
            </div>
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mt-1.5 flex items-center gap-1 group-hover/total:text-zinc-300 transition-colors">
              <span>Total Users</span>
            </div>
          </div>

          {/* Sleek Side-by-Side Online / Offline Indicator Capsule */}
          <div 
            onClick={() => setShowUsersModal(true)}
            className="flex items-center gap-2.5 p-1.5 px-3 rounded-xl bg-zinc-900/90 border border-zinc-800/90 cursor-pointer hover:border-zinc-700 hover:bg-zinc-900 transition-all active:scale-[0.98] shadow-sm"
            title="Click to view detailed user status breakdown"
          >
            {/* Online Indicator */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
              </span>
              <span className="text-xs font-black text-emerald-400 font-mono tracking-tight">
                {Number(liveOnline).toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider">
                Online
              </span>
            </div>

            {/* Subtle Divider */}
            <span className="w-px h-3.5 bg-zinc-700/80" />

            {/* Offline Indicator */}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex rounded-full h-2 w-2 bg-zinc-500 shadow-[0_0_4px_rgba(161,161,170,0.4)]" />
              <span className="text-xs font-black text-zinc-300 font-mono tracking-tight">
                {Number(liveOffline).toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Offline
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Users Management Modal */}
      <UsersModal
        isOpen={showUsersModal}
        onClose={() => setShowUsersModal(false)}
        onUserUpdated={onRefresh}
      />

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Files Card */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 hover:border-red-500/30 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium">Files</span>
            <FileText className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold text-white">{fileItems.length}</div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
            <span>Documents, APKs, Media</span>
          </div>
        </div>

        {/* Links Card */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 hover:border-red-500/30 transition-all">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium">Links</span>
            <Link2 className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-white">{linkItems.length}</div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
            <span>Browser &amp; Mini Apps</span>
          </div>
        </div>

        {/* Triggers / Filters Card */}
        <div 
          onClick={() => onNavigate('filters')}
          className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 hover:border-red-500/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium group-hover:text-red-400 transition-colors">Filters / Triggers</span>
            <Hash className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalTriggers}</div>
          <div className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between">
            <span>Exact match keywords</span>
            <span className="text-red-400 font-medium">Manage →</span>
          </div>
        </div>

        {/* Deliveries Card */}
        <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90">
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium">Deliveries</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalDeliveries}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Private transfers completed
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-zinc-400 tracking-wider uppercase px-1">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => onOpenAddModal('file')}
            className="p-3.5 rounded-2xl bg-[#0c0c13]/90 border border-zinc-800/90 hover:border-red-500/40 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0 border border-red-500/25">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Add File</div>
              <div className="text-[11px] text-zinc-400">Configure trigger</div>
            </div>
          </button>

          <button
            onClick={() => onOpenAddModal('link')}
            className="p-3.5 rounded-2xl bg-[#0c0c13]/90 border border-zinc-800/90 hover:border-red-500/40 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/25">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Add Link</div>
              <div className="text-[11px] text-zinc-400">Browser or WebApp</div>
            </div>
          </button>

          <button
            onClick={() => onNavigate('filters')}
            className="p-3 rounded-2xl bg-[#0c0c13]/90 border border-zinc-800/90 hover:border-red-500/40 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3 col-span-2"
          >
            <div className="w-9 h-9 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0 border border-red-500/25">
              <Hash className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-white">Manage All Filters</div>
              <div className="text-[11px] text-zinc-400">Strict keyword delivery &amp; /filters list</div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* Recent Configured Items */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-zinc-400 tracking-wider uppercase">
            Active Items ({items.length})
          </h3>
          <button
            onClick={() => onNavigate('files')}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            View All
          </button>
        </div>

        {items.length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center border border-zinc-800/80 bg-[#0c0c13]/90">
            <p className="text-xs text-zinc-400">No items configured yet.</p>
            <p className="text-[11px] text-zinc-500 mt-1">
              Tap "Add File" or "Add Link" above, or send <code className="text-zinc-300">/add</code> in Telegram.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                onClick={() => onNavigate('files')}
                className="glass-panel rounded-2xl p-3.5 border border-zinc-800/80 bg-[#0c0c13]/90 hover:border-red-500/40 transition-all flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'file' ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'}`}>
                    {item.type === 'file' ? <FileText className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{item.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5">
                      <span className="font-mono text-red-400 font-semibold">{item.triggers?.[0] || `#${item.rawKeyword}`}</span>
                      <span>·</span>
                      <span>{item.type === 'file' ? (item.fileName || 'Document') : (item.openMode === 'webapp' ? 'Telegram Mini App' : 'Browser Link')}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-2">
                  <span className="text-xs font-semibold text-zinc-300">
                    {item.deliveryCount || 0}
                  </span>
                  <span className="text-[10px] text-zinc-500 block">delivered</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Health / Summary */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 text-xs text-zinc-400 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-red-400" /> Admin Accounts
          </span>
          <span className="text-white font-medium">{adminsCount} active</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60">
          <span>Tracked Bot Messages (10/chat limit)</span>
          <span className="text-white font-medium">{trackedCount} tracked</span>
        </div>
      </div>
    </div>
  );
};

export const DashboardTab = React.memo(DashboardTabComponent);
