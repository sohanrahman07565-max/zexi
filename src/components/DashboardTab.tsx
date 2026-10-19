import React from 'react';
import { ItemRecord, BotSettings } from '../lib/api';
import { FileText, Link2, Hash, Users, Sparkles, Send, ShieldCheck, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react';

interface DashboardTabProps {
  items: ItemRecord[];
  adminsCount: number;
  trackedCount: number;
  totalUsers?: number;
  settings: BotSettings | null;
  onNavigate: (tab: string) => void;
  onOpenAddModal: (type: 'file' | 'link') => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  items,
  adminsCount,
  trackedCount,
  totalUsers = 0,
  settings,
  onNavigate,
  onOpenAddModal,
}) => {
  const fileItems = items.filter((i) => i.type === 'file');
  const linkItems = items.filter((i) => i.type === 'link');
  const totalTriggers = items.reduce((acc, i) => acc + (i.triggers?.length || 1), 0);
  const totalDeliveries = items.reduce((acc, i) => acc + (i.deliveryCount || 0), 0);

  const hasToken = settings?.hasToken || Boolean(settings?.botToken);
  const botUsername = settings?.botUsername || 'Not connected';

  return (
    <div className="space-y-5 pb-28">
      {/* Bot Status Banner */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasToken ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
              <Send className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {hasToken ? `@${botUsername}` : 'Telegram Bot'}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <span className={`w-2 h-2 rounded-full ${hasToken ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {hasToken ? 'Active' : 'Missing Token'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Exact trigger group response · Deep-link private delivery
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('filters')}
            className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-medium flex items-center gap-1 transition-all cursor-pointer"
          >
            <span>Filters</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Total User Count Highlight Metric Card (Requirement 5) */}
      <div className="glass-panel rounded-2xl p-4 border border-violet-500/30 bg-gradient-to-r from-violet-950/30 via-slate-900/60 to-slate-900/90 relative overflow-hidden shadow-lg shadow-violet-950/20">
        <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-violet-500/10 rounded-full blur-xl pointer-events-none" />
        <div className="flex items-center justify-between relative z-10">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-400 mb-1">
              <Users className="w-4 h-4" />
              <span>Total User Count</span>
            </div>
            <div className="text-3xl font-black text-white tracking-tight flex items-baseline gap-2">
              <span>{Number(totalUsers).toLocaleString()}</span>
              <span className="text-xs font-medium text-slate-400">unique users</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Total unique users who have interacted with or used this bot
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 shrink-0">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Files Card */}
        <div className="glass-panel rounded-2xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Files</span>
            <FileText className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-white">{fileItems.length}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>Documents, APKs, Media</span>
          </div>
        </div>

        {/* Links Card */}
        <div className="glass-panel rounded-2xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Links</span>
            <Link2 className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{linkItems.length}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>Browser &amp; Mini Apps</span>
          </div>
        </div>

        {/* Triggers / Filters Card */}
        <div 
          onClick={() => onNavigate('filters')}
          className="glass-panel rounded-2xl p-4 border border-slate-800/80 hover:border-amber-500/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium group-hover:text-amber-400 transition-colors">Filters / Triggers</span>
            <Hash className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalTriggers}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Exact match keywords</span>
            <span className="text-amber-400 font-medium">Manage →</span>
          </div>
        </div>

        {/* Deliveries Card */}
        <div className="glass-panel rounded-2xl p-4 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Deliveries</span>
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white">{totalDeliveries}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            Private transfers completed
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase px-1">
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => onOpenAddModal('file')}
            className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Add File</div>
              <div className="text-[11px] text-slate-400">Configure trigger</div>
            </div>
          </button>

          <button
            onClick={() => onOpenAddModal('link')}
            className="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Add Link</div>
              <div className="text-[11px] text-slate-400">Browser or WebApp</div>
            </div>
          </button>

          <button
            onClick={() => onNavigate('filters')}
            className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-left transition-all active:scale-[0.98] cursor-pointer flex items-center gap-3 col-span-2"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Hash className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-white">Manage All Filters</div>
              <div className="text-[11px] text-slate-400">Strict keyword delivery &amp; /filters list</div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Recent Configured Items */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
            Active Items ({items.length})
          </h3>
          <button
            onClick={() => onNavigate('files')}
            className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
          >
            View All
          </button>
        </div>

        {items.length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center border border-slate-800/80">
            <p className="text-xs text-slate-400">No items configured yet.</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Tap "Add File" or "Add Link" above, or send <code className="text-slate-300">/add</code> in Telegram.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                onClick={() => onNavigate('files')}
                className="glass-panel rounded-2xl p-3.5 border border-slate-800/80 hover:border-slate-700/80 transition-all flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.type === 'file' ? 'bg-sky-500/10 text-sky-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                    {item.type === 'file' ? <FileText className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{item.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                      <span className="font-mono text-sky-400 font-semibold">{item.triggers?.[0] || `#${item.rawKeyword}`}</span>
                      <span>·</span>
                      <span>{item.type === 'file' ? (item.fileName || 'Document') : (item.openMode === 'webapp' ? 'Telegram Mini App' : 'Browser Link')}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-2">
                  <span className="text-xs font-semibold text-slate-300">
                    {item.deliveryCount || 0}
                  </span>
                  <span className="text-[10px] text-slate-500 block">delivered</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Health / Summary */}
      <div className="glass-panel rounded-2xl p-4 border border-slate-800/80 text-xs text-slate-400 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-sky-400" /> Admin Accounts
          </span>
          <span className="text-white font-medium">{adminsCount} active</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
          <span>Tracked Bot Messages (10/chat limit)</span>
          <span className="text-white font-medium">{trackedCount} tracked</span>
        </div>
      </div>
    </div>
  );
};
