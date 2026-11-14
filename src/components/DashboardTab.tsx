import React, { useState, useMemo, useEffect } from 'react';
import { ItemRecord, BotSettings, api } from '../lib/api';
import { FileText, Link2, Hash, Users, Sparkles, ArrowUpRight } from 'lucide-react';
import { UsersModal } from './UsersModal';
import { useCountUp } from '../hooks/useCountUp';

interface DashboardTabProps {
  items: ItemRecord[];
  adminsCount: number;
  trackedCount: number;
  totalUsers?: number;
  onlineUsers?: number;
  offlineUsers?: number;
  settings: BotSettings | null;
  onNavigate: (tab: string) => void;
  onOpenAddModal?: (type: 'file' | 'link') => void;
  onRefresh?: () => void;
}

const DashboardTabComponent: React.FC<DashboardTabProps> = ({
  items,
  totalUsers = 0,
  onlineUsers = 0,
  offlineUsers = 0,
  onNavigate,
  onRefresh,
}) => {
  const [showUsersModal, setShowUsersModal] = useState<boolean>(false);
  const [liveTotal, setLiveTotal] = useState<number>(totalUsers);
  const [liveOnline, setLiveOnline] = useState<number>(onlineUsers);
  const [liveOffline, setLiveOffline] = useState<number>(offlineUsers);

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

  const targetOnlinePercent = liveTotal > 0 ? Math.min(100, Math.round((liveOnline / liveTotal) * 100)) : 0;

  // Animated count-up values
  const animatedTotal = useCountUp(liveTotal, 620);
  const animatedOnline = useCountUp(liveOnline, 620);
  const animatedOffline = useCountUp(liveOffline, 620);
  const animatedPercent = useCountUp(targetOnlinePercent, 700);
  const animatedFiles = useCountUp(fileItems.length, 550);
  const animatedLinks = useCountUp(linkItems.length, 550);
  const animatedTriggers = useCountUp(totalTriggers, 550);
  const animatedDeliveries = useCountUp(totalDeliveries, 650);

  const ringCircumference = 276.46;
  const ringOffset = ringCircumference * (1 - targetOnlinePercent / 100);

  return (
    <div className="space-y-4 pb-28">
      {/* Liquid Glass Hero Telemetry Card + Circular SVG Ring + Live Marquee */}
      <div
        className="glass lg-hero lg-rise space-y-3.5 text-white"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowUsersModal(true)}
            className="lg-chip tap cursor-pointer hover:bg-white/15"
            title="Open Users Management"
          >
            <Users className="w-3.5 h-3.5 text-white/90" />
            <span>Bot Users</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-white/75" />
          </button>

          <button
            type="button"
            onClick={() => setShowUsersModal(true)}
            className="lg-badge tap cursor-pointer hover:bg-white/15"
            title="Real-time live user activity"
          >
            <span className="lg-dot" />
            <span className="text-white">Live</span>
          </button>
        </div>

        {/* Split Stats + Circular SVG Online Progress Ring */}
        <div
          onClick={() => setShowUsersModal(true)}
          className="flex items-center justify-between gap-3 cursor-pointer"
          title="Tap to inspect active and offline bot users"
        >
          <div className="min-w-0">
            <div className="lg-big">{animatedTotal.toLocaleString()}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 mt-1.5">
              Total Users
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2.5 tabular-nums">
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/35 text-[12.5px] font-bold text-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.16)]">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399] animate-pulse shrink-0" />
                <span>{animatedOnline.toLocaleString()} Online</span>
              </span>
              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-400/35 text-[12.5px] font-bold text-rose-300 shadow-[0_0_16px_rgba(244,63,94,0.16)]">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_#f43f5e] shrink-0" />
                <span>{animatedOffline.toLocaleString()} Offline</span>
              </span>
            </div>
          </div>

          <div className="lg-ring shrink-0">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <defs>
                <linearGradient id="lg-ring-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#34d3ee" />
                  <stop offset="50%" stopColor="var(--a)" />
                  <stop offset="100%" stopColor="var(--a2)" />
                </linearGradient>
              </defs>
              <circle className="trk" cx="50" cy="50" r="44" />
              <circle
                className="bar"
                cx="50"
                cy="50"
                r="44"
                style={{ strokeDashoffset: ringOffset }}
              />
            </svg>
            <div className="absolute text-center pointer-events-none">
              <b className="block text-[17px] font-extrabold text-white tabular-nums leading-tight">
                {animatedPercent}%
              </b>
              <span className="block text-[9.5px] font-bold uppercase tracking-wider text-white/60 mt-0.5">
                Online
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

      {/* KPI 2x2 Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Files */}
        <button
          type="button"
          onClick={() => onNavigate('files')}
          className="glass tap lg-rise rounded-[22px] p-4 text-left flex flex-col gap-1.5 cursor-pointer"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <div
            className="lg-tile"
            style={{
              background: 'color-mix(in srgb, #60a5fa 22%, rgba(255,255,255,.06))',
              '--c': 'rgba(96,165,250,0.45)',
            } as React.CSSProperties}
          >
            <FileText className="w-4 h-4 text-sky-300" />
          </div>
          <div className="text-[24px] font-extrabold tracking-tight text-white tabular-nums leading-tight mt-0.5">
            {animatedFiles}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/60">
            Files
          </div>
        </button>

        {/* Links */}
        <button
          type="button"
          onClick={() => onNavigate('files')}
          className="glass tap lg-rise rounded-[22px] p-4 text-left flex flex-col gap-1.5 cursor-pointer"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <div
            className="lg-tile"
            style={{
              background: 'color-mix(in srgb, #c084fc 22%, rgba(255,255,255,.06))',
              '--c': 'rgba(192,132,252,0.45)',
            } as React.CSSProperties}
          >
            <Link2 className="w-4 h-4 text-purple-300" />
          </div>
          <div className="text-[24px] font-extrabold tracking-tight text-white tabular-nums leading-tight mt-0.5">
            {animatedLinks}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/60">
            Links
          </div>
        </button>

        {/* Filters */}
        <button
          type="button"
          onClick={() => onNavigate('filters')}
          className="glass tap lg-rise rounded-[22px] p-4 text-left flex flex-col gap-1.5 cursor-pointer"
          style={{ '--i': 3 } as React.CSSProperties}
        >
          <div
            className="lg-tile"
            style={{
              background: 'color-mix(in srgb, #f472b6 22%, rgba(255,255,255,.06))',
              '--c': 'rgba(244,114,182,0.45)',
            } as React.CSSProperties}
          >
            <Hash className="w-4 h-4 text-pink-300" />
          </div>
          <div className="text-[24px] font-extrabold tracking-tight text-white tabular-nums leading-tight mt-0.5">
            {animatedTriggers}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/60 flex items-center justify-between w-full">
            <span>Filters</span>
            <span className="text-[10px] text-white/50">Manage →</span>
          </div>
        </button>

        {/* Deliveries */}
        <div
          className="glass tap lg-rise rounded-[22px] p-4 text-left flex flex-col gap-1.5"
          style={{ '--i': 4 } as React.CSSProperties}
        >
          <div
            className="lg-tile"
            style={{
              background: 'color-mix(in srgb, #34d3ee 22%, rgba(255,255,255,.06))',
              '--c': 'rgba(52,211,238,0.45)',
            } as React.CSSProperties}
          >
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </div>
          <div className="text-[24px] font-extrabold tracking-tight text-white tabular-nums leading-tight mt-0.5">
            {animatedDeliveries.toLocaleString()}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-white/60">
            Deliveries
          </div>
        </div>
      </div>
    </div>
  );
};

export const DashboardTab = React.memo(DashboardTabComponent);
