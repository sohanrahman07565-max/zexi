import React, { useState, useMemo } from 'react';
import { ItemRecord, BotSettings } from '../lib/api';
import { FileText, Link2, Hash, Users, Sparkles, Send, ShieldCheck, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { UsersModal } from './UsersModal';

interface DashboardTabProps {
  items: ItemRecord[];
  adminsCount: number;
  trackedCount: number;
  totalUsers?: number;
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
  settings,
  onNavigate,
  onOpenAddModal,
  onRefresh,
}) => {
  const [showUsersModal, setShowUsersModal] = useState<boolean>(false);

  const fileItems = useMemo(() => items.filter((i) => i.type === 'file'), [items]);
  const linkItems = useMemo(() => items.filter((i) => i.type === 'link'), [items]);
  const totalTriggers = useMemo(() => items.reduce((acc, i) => acc + (i.triggers?.length || 1), 0), [items]);
  const totalDeliveries = useMemo(() => items.reduce((acc, i) => acc + (i.deliveryCount || 0), 0), [items]);

  const hasToken = useMemo(() => settings?.hasToken || Boolean(settings?.botToken), [settings]);
  const botUsername = settings?.botUsername || 'Not connected';

  return (
    <div className="space-y-5 pb-28">
      {/* Bot Status Banner */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasToken ? 'bg-red-500/15 text-red-400 border border-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.25)]' : 'bg-zinc-800/80 text-zinc-400'}`}>
              <Send className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {hasToken ? `@${botUsername}` : 'Telegram Bot'}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <span className={`w-2 h-2 rounded-full ${hasToken ? 'bg-red-500 animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]' : 'bg-amber-400'}`} />
                  {hasToken ? 'Active' : 'Missing Token'}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Exact trigger group response · Deep-link private delivery
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('filters')}
            className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/25 text-xs font-medium flex items-center gap-1 transition-all cursor-pointer"
          >
            <span>Filters</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Simple Clean User Counter Card */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800/80 bg-[#0c0c13]/90 relative overflow-hidden">
        {/* Top: User Logo & Users Button */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div 
              onClick={() => setShowUsersModal(true)}
              className="w-8 h-8 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0 cursor-pointer hover:bg-red-500/25 transition-colors shadow-[0_0_12px_rgba(239,68,68,0.25)]"
            >
              <Users className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => setShowUsersModal(true)}
              className="px-2.5 py-1 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/25 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
            >
              <span>Users</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom: Counter */}
        <div>
          <span className="text-3xl font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(239,68,68,0.2)]">
            {Number(totalUsers).toLocaleString()}
          </span>
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
