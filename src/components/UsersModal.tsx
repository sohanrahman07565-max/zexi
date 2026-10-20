import React, { useState, useEffect, useMemo } from 'react';
import { BotUserRecord, api } from '../lib/api';
import {
  Users,
  Search,
  X,
  ShieldCheck,
  Ban,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Clock,
  Sparkles
} from 'lucide-react';

interface UsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserUpdated?: () => void;
}

export const UsersModal: React.FC<UsersModalProps> = ({ isOpen, onClose, onUserUpdated }) => {
  const [users, setUsers] = useState<BotUserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await api.getUsers();
      setUsers(data);
    } catch (err: any) {
      console.error('Failed to load users:', err);
      setFeedback({ type: 'error', message: err.message || 'Failed to load users' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Online status calculation: active within last 10 minutes
  const isUserOnline = (lastActiveAt?: string): boolean => {
    if (!lastActiveAt) return false;
    const diffMs = Date.now() - new Date(lastActiveAt).getTime();
    return diffMs < 10 * 60 * 1000; // 10 minutes window
  };

  const formatRelativeTime = (isoString?: string): string => {
    if (!isoString) return 'Inactive';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diffMs / (60 * 1000));
    if (minutes < 1) return 'Active just now';
    if (minutes < 60) return `Active ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Active ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `Active ${days}d ago`;
  };

  const handleToggleBan = async (user: BotUserRecord) => {
    if (user.isAdmin) {
      setFeedback({ type: 'error', message: 'Administrators cannot be banned' });
      return;
    }

    try {
      setActionLoadingId(user.id);
      setFeedback(null);
      const res = await api.toggleBanUser(user.id);
      
      // Update local state optimistically
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isBanned: res.user.isBanned, bannedAt: res.user.bannedAt } : u))
      );

      setFeedback({
        type: 'success',
        message: res.user.isBanned ? `User ${user.id} banned successfully` : `User ${user.id} unbanned successfully`
      });

      if (onUserUpdated) {
        onUserUpdated();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to update user ban status' });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const username = (u.username || '').toLowerCase();
      const id = String(u.id);
      return name.includes(q) || username.includes(q) || id.includes(q);
    });
  }, [users, searchQuery]);

  const onlineCount = useMemo(() => {
    return users.filter((u) => isUserOnline(u.lastActiveAt)).length;
  }, [users]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-3xl bg-[#0c0c13]/98 border border-red-500/25 shadow-[0_0_60px_-10px_rgba(239,68,68,0.3),0_20px_45px_rgba(0,0,0,0.9)] overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle top card border glow accent */}
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1.5px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, #ef4444, transparent)'
          }}
        />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800/80 flex items-center justify-between bg-[#0e0e16]/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center shadow-[0_0_15px_rgba(239,68,68,0.2)]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Bot Users</h2>
                <span className="px-2 py-0.5 rounded-full bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 text-xs font-semibold">
                  {users.length}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {onlineCount} Online
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage all Telegram users who interacted with or used this bot
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={fetchUsers}
              disabled={loading}
              title="Refresh list"
              className="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              title="Close modal"
              className="w-8 h-8 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`px-4 py-2.5 text-xs flex items-center justify-between border-b ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                : 'bg-red-500/10 text-red-300 border-red-500/20'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="p-3 sm:p-4 border-b border-zinc-800/80 bg-[#0a0a10]">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Name, @username, or User ID..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-[#13131c] border border-zinc-800 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 focus:shadow-[0_0_15px_rgba(239,68,68,0.25)] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Users List Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 min-h-[220px]">
          {loading && users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <RefreshCw className="w-6 h-6 animate-spin text-red-500 mb-2" />
              <p className="text-xs">Loading bot users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-400">
              <Users className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-sm font-semibold text-zinc-300">
                {searchQuery ? 'No matching users found' : 'No users have interacted yet'}
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                {searchQuery
                  ? 'Try searching with a different user ID, name, or username.'
                  : 'Users are automatically captured and listed here when they interact with or request files from the bot.'}
              </p>
            </div>
          ) : (
            filteredUsers.map((user) => {
              const online = isUserOnline(user.lastActiveAt);
              const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
              const displayName = fullName || user.username || `User ${user.id}`;
              const isBanned = Boolean(user.isBanned);
              const isAdmin = Boolean(user.isAdmin);
              const isProcessing = actionLoadingId === user.id;

              return (
                <div
                  key={user.id}
                  className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                    isBanned
                      ? 'bg-red-950/30 border-red-800/50 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
                      : isAdmin
                      ? 'bg-[#13131c] border-amber-500/35 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
                      : 'bg-[#13131c] border-zinc-800/90 hover:border-red-500/35 hover:shadow-[0_0_15px_rgba(239,68,68,0.12)]'
                  }`}
                >
                  {/* Left Side: Layout requirements */}
                  {/* - Top line: User's Name */}
                  {/* - Second line: User ID and Username (@username) */}
                  {/* - Status Indicator: Online / Offline status badge */}
                  <div className="min-w-0 flex-1">
                    {/* Top line: User's Name & Role Tags */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white truncate">
                        {displayName}
                      </span>

                      {/* Admin Tag */}
                      {isAdmin && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          Admin
                        </span>
                      )}

                      {/* Banned Badge */}
                      {isBanned && (
                        <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-semibold flex items-center gap-1">
                          <Ban className="w-3 h-3" />
                          Banned
                        </span>
                      )}
                    </div>

                    {/* Second line: User ID and Username (@username) */}
                    <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 font-mono">
                      <span className="text-zinc-300">ID: {user.id}</span>
                      <span>·</span>
                      <span className="text-red-400 font-sans">
                        {user.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : 'No @username'}
                      </span>
                    </div>

                    {/* Status Indicator: Online / Offline status badge */}
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                          online
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            online ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                          }`}
                        />
                        <span>{online ? 'Online' : 'Offline'}</span>
                      </span>

                      <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-600" />
                        <span>{formatRelativeTime(user.lastActiveAt)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Right Side: Action Control */}
                  {/* - Place a "Ban" / "Unban" toggle button on the right side of each user row */}
                  {/* - Important Constraint: Admins must NEVER be bannable (disabled or hidden for Admin accounts) */}
                  <div className="shrink-0 pl-2">
                    {isAdmin ? (
                      <div
                        title="Administrators cannot be banned"
                        className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-medium flex items-center gap-1.5 cursor-not-allowed select-none opacity-80"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                        <span>Protected</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleToggleBan(user)}
                        disabled={isProcessing}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 ${
                          isBanned
                            ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 hover:shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                        }`}
                      >
                        {isProcessing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : isBanned ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Unban</span>
                          </>
                        ) : (
                          <>
                            <Ban className="w-3.5 h-3.5" />
                            <span>Ban</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 border-t border-zinc-800/80 bg-[#0a0a10] flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-red-400" />
            <span>Automatic dynamic UID capture</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
