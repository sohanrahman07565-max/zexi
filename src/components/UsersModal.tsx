import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BotUserRecord, api } from '../lib/api';
import {
  Users,
  Search,
  X,
  ShieldCheck,
  ShieldOff,
  Ban,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Clock,
  Key,
  Copy,
  Check
} from 'lucide-react';
import { ALL_PERMISSIONS } from './MoreTab';

interface UsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUserUpdated?: () => void;
  currentUserRole?: 'owner' | 'subadmin';
  currentUserTelegramId?: string;
  initialTab?: 'active' | 'banned';
}

type AdminPreset = 'editor' | 'moderator' | 'full';

const buildPresetPermissions = (preset: AdminPreset): Record<string, boolean> => {
  const perms: Record<string, boolean> = {};
  ALL_PERMISSIONS.forEach((p) => {
    perms[p.key] = false;
  });
  if (preset === 'full') {
    ALL_PERMISSIONS.forEach((p) => {
      perms[p.key] = p.key !== 'admins_manage';
    });
    return perms;
  }
  if (preset === 'moderator') {
    perms.files_view = true;
    perms.links_view = true;
    perms.messages_view = true;
    perms.cleanup_manage = true;
    return perms;
  }
  // 'editor'
  perms.files_view = true;
  perms.files_add = true;
  perms.files_edit = true;
  perms.links_view = true;
  perms.links_add = true;
  perms.links_edit = true;
  perms.messages_view = true;
  return perms;
};

export const UsersModal: React.FC<UsersModalProps> = ({
  isOpen,
  onClose,
  onUserUpdated,
  currentUserRole,
  currentUserTelegramId,
  initialTab = 'active',
}) => {
  const [users, setUsers] = useState<BotUserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [userTab, setUserTab] = useState<'active' | 'banned'>(initialTab);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Owner Admin Grant state
  const [grantingUser, setGrantingUser] = useState<BotUserRecord | null>(null);
  const [grantPreset, setGrantPreset] = useState<AdminPreset>('editor');
  const [grantPermissions, setGrantPermissions] = useState<Record<string, boolean>>(() => buildPresetPermissions('editor'));
  const [grantPassword, setGrantPassword] = useState<string>('');
  const [grantSubmitting, setGrantSubmitting] = useState<boolean>(false);
  const [issuedCredentials, setIssuedCredentials] = useState<{
    userId: string;
    name: string;
    accessToken: string;
    generatedPassword?: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<'token' | 'password' | null>(null);

  const isOwner = currentUserRole === 'owner';

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
      setUserTab(initialTab);
      fetchUsers();
      setGrantingUser(null);
      setIssuedCredentials(null);
    }
  }, [isOpen, initialTab]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (grantingUser) {
          setGrantingUser(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, grantingUser]);

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

  const copyText = async (value: string, field: 'token' | 'password') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2000);
    } catch {}
  };

  const openGrantPanel = (user: BotUserRecord) => {
    setFeedback(null);
    setIssuedCredentials(null);
    setGrantingUser(user);
    setGrantPreset('editor');
    setGrantPermissions(buildPresetPermissions('editor'));
    setGrantPassword('');
  };

  const handleGrantAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantingUser) return;
    setGrantSubmitting(true);
    setFeedback(null);
    try {
      const fullName = [grantingUser.firstName, grantingUser.lastName].filter(Boolean).join(' ').trim();
      const displayName = fullName || grantingUser.username || `User ${grantingUser.id}`;
      const res = await api.grantAdmin(grantingUser.id, {
        name: displayName,
        username: grantingUser.username,
        password: grantPassword.trim() || undefined,
        role: 'subadmin',
        permissions: grantPermissions as any,
      });

      setUsers((prev) =>
        prev.map((u) => (u.id === grantingUser.id ? { ...u, isAdmin: true, isBanned: false } : u))
      );

      setIssuedCredentials({
        userId: grantingUser.id,
        name: displayName,
        accessToken: res.accessToken,
        generatedPassword: res.generatedPassword,
      });
      setGrantingUser(null);
      setFeedback({
        type: 'success',
        message: `${displayName} promoted to Sub-Admin with access token issued.`,
      });
      if (onUserUpdated) onUserUpdated();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to grant admin permissions' });
    } finally {
      setGrantSubmitting(false);
    }
  };

  const handleRevokeAdmin = async (user: BotUserRecord) => {
    if (!isOwner) return;
    try {
      setActionLoadingId(user.id);
      setFeedback(null);
      await api.revokeAdmin(user.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isAdmin: false } : u))
      );
      setFeedback({
        type: 'success',
        message: `Admin permissions revoked for user ${user.id}.`,
      });
      if (onUserUpdated) onUserUpdated();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to revoke admin permissions' });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleBan = async (user: BotUserRecord) => {
    if (user.isAdmin) {
      setFeedback({ type: 'error', message: 'Administrators cannot be banned' });
      return;
    }

    try {
      setActionLoadingId(user.id);
      setFeedback(null);
      const isCurrentlyBanned = Boolean(user.isBanned);
      const res = isCurrentlyBanned
        ? await api.unbanUser(user.id)
        : await api.toggleBanUser(user.id);
      
      // Update local state optimistically
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isBanned: res.user.isBanned, bannedAt: res.user.bannedAt } : u))
      );

      setFeedback({
        type: 'success',
        message: res.user.isBanned ? `User ${user.id} banned successfully` : `User ${user.id} unbanned successfully. Full access restored.`
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

  const activeCount = useMemo(() => users.filter((u) => !u.isBanned).length, [users]);
  const bannedCount = useMemo(() => users.filter((u) => Boolean(u.isBanned)).length, [users]);

  // Filtered users by Tab (Active vs Banned) and Search Query
  const filteredUsers = useMemo(() => {
    const tabFiltered = users.filter((u) => {
      if (userTab === 'banned') return Boolean(u.isBanned);
      return !u.isBanned;
    });

    const q = searchQuery.toLowerCase().trim();
    if (!q) return tabFiltered;
    return tabFiltered.filter((u) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const username = (u.username || '').toLowerCase();
      const id = String(u.id);
      return name.includes(q) || username.includes(q) || id.includes(q);
    });
  }, [users, userTab, searchQuery]);

  const onlineCount = useMemo(() => {
    return users.filter((u) => isUserOnline(u.lastActiveAt)).length;
  }, [users]);

  if (!isOpen) return null;

  const modalContent = (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-black/85 backdrop-blur-md animate-in fade-in duration-200 overscroll-contain select-none"
    >
      <div 
        className="w-full max-w-lg md:max-w-3xl lg:max-w-4xl max-h-[90dvh] flex flex-col rounded-3xl glass-water-card border border-white/20 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.95),0_0_40px_rgba(255,255,255,0.1)] overflow-hidden relative animate-in zoom-in-95 duration-200 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle top card border glow accent */}
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-[1.5px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)'
          }}
        />

        {/* Modal Header */}
        <div className="shrink-0 p-3.5 sm:p-5 border-b border-white/10 flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2.5 bg-white/[0.04]">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 text-white flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.15)] backdrop-blur-md shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white tracking-tight">Bot Users</h2>
                <span className="px-2 py-0.5 rounded-full bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 text-xs font-semibold">
                  {users.length}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-xs font-semibold flex items-center gap-1 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {onlineCount} Online
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 leading-snug">
                Manage all Telegram users who interacted with or used this bot
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
            {/* Sleek Single Toggle Button in Header Area */}
            <button
              type="button"
              onClick={() => setUserTab((prev) => (prev === 'active' ? 'banned' : 'active'))}
              title={`Currently viewing ${userTab === 'active' ? 'Active' : 'Banned'} users. Tap to switch.`}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-xs ${
                userTab === 'banned'
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.3)] hover:bg-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)] hover:bg-emerald-500/30'
              }`}
            >
              {userTab === 'active' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Active ({activeCount})</span>
                </>
              ) : (
                <>
                  <Ban className="w-3.5 h-3.5 text-rose-400" />
                  <span>Banned ({bannedCount})</span>
                </>
              )}
            </button>
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
            className={`shrink-0 px-4 py-2.5 text-xs flex items-center justify-between border-b ${
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

        {/* Newly Issued Admin Credentials Banner */}
        {issuedCredentials && (
          <div className="shrink-0 p-3.5 border-b border-amber-500/30 bg-amber-500/10 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <Key className="w-4 h-4 shrink-0" />
                <span>Admin Credentials Issued for {issuedCredentials.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setIssuedCredentials(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {issuedCredentials.generatedPassword && (
              <div className="flex items-center justify-between gap-2 bg-black/40 border border-white/10 rounded-xl px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-white/90 truncate">
                  Password: <strong>{issuedCredentials.generatedPassword}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => copyText(issuedCredentials.generatedPassword!, 'password')}
                  className="px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-semibold text-white flex items-center gap-1 cursor-pointer shrink-0"
                >
                  {copiedField === 'password' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedField === 'password' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 bg-black/40 border border-white/10 rounded-xl px-2.5 py-1.5">
              <span className="font-mono text-[11px] text-sky-300 truncate">
                Token: {issuedCredentials.accessToken}
              </span>
              <button
                type="button"
                onClick={() => copyText(issuedCredentials.accessToken, 'token')}
                className="px-2 py-0.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-[10px] font-semibold text-sky-200 flex items-center gap-1 cursor-pointer shrink-0"
              >
                {copiedField === 'token' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedField === 'token' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Owner Grant Admin Panel */}
        {grantingUser ? (
          <form onSubmit={handleGrantAdminSubmit} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div className="min-w-0">
                <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Grant Admin Access</span>
                </div>
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                  Promoting {[grantingUser.firstName, grantingUser.lastName].filter(Boolean).join(' ') || grantingUser.username || grantingUser.id} (ID: {grantingUser.id})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGrantingUser(null)}
                className="px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer"
              >
                Back
              </button>
            </div>

            {/* Quick Presets */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1.5">Permission Preset</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'editor', label: 'Editor' },
                  { id: 'moderator', label: 'Moderator' },
                  { id: 'full', label: 'Full Sub-Admin' },
                ] as { id: AdminPreset; label: string }[]).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setGrantPreset(preset.id);
                      setGrantPermissions(buildPresetPermissions(preset.id));
                    }}
                    className={`py-1.5 px-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                      grantPreset === preset.id
                        ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                        : 'bg-black/30 border-white/10 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Custom Password */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-300 block mb-1">
                Password <span className="text-zinc-500 font-normal">(optional — leave blank to auto-generate)</span>
              </label>
              <input
                type="text"
                value={grantPassword}
                onChange={(e) => setGrantPassword(e.target.value)}
                placeholder="Min 6 characters or leave blank"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white placeholder-white/35 focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Granular Permissions */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-300">Capabilities</span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {ALL_PERMISSIONS.filter((p) => grantPermissions[p.key]).length} / {ALL_PERMISSIONS.length} enabled
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {ALL_PERMISSIONS.map((p) => {
                  const checked = Boolean(grantPermissions[p.key]);
                  return (
                    <label
                      key={p.key}
                      className={`p-2 rounded-xl border flex items-start gap-2 cursor-pointer text-xs transition-colors ${
                        checked
                          ? 'bg-amber-500/10 border-amber-400/40 text-white'
                          : 'bg-black/30 border-white/10 text-zinc-400 hover:bg-white/5'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setGrantPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))
                        }
                        className="mt-0.5 rounded accent-amber-400 cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold leading-tight">{p.label}</div>
                        <div className="text-[10px] text-zinc-500 leading-tight mt-0.5">{p.category}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setGrantingUser(null)}
                className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={grantSubmitting}
                className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {grantSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>{grantSubmitting ? 'Granting...' : 'Grant Admin Access'}</span>
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Search Bar */}
            <div className="shrink-0 p-3 sm:p-4 border-b border-white/10 bg-white/[0.02]">
              <div className="relative">
                <Search className="w-4 h-4 text-white/50 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={userTab === 'banned' ? "Search banned users by Name, @username, or User ID..." : "Search active users by Name, @username, or User ID..."}
                  className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-black/30 border border-white/15 text-white placeholder-white/40 text-xs focus:outline-none focus:border-white/40 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Users List Body (Scrollable Middle Area) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-2.5 md:gap-3 content-start pb-4 sm:pb-5">
              {loading && users.length === 0 ? (
                <div className="md:col-span-2 flex flex-col items-center justify-center py-12 text-zinc-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-red-500 mb-2" />
                  <p className="text-xs">Loading bot users...</p>
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="md:col-span-2 flex flex-col items-center justify-center py-12 text-center text-zinc-400">
                  {userTab === 'banned' ? (
                    <Ban className="w-8 h-8 text-red-500/50 mb-2" />
                  ) : (
                    <Users className="w-8 h-8 text-zinc-600 mb-2" />
                  )}
                  <p className="text-sm font-semibold text-zinc-300">
                    {searchQuery
                      ? 'No matching users found'
                      : userTab === 'banned'
                        ? 'No banned users in the system'
                        : 'No active users found'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                    {searchQuery
                      ? 'Try searching with a different user ID, name, or username.'
                      : userTab === 'banned'
                        ? 'Users who reach 3 strikes or get manually restricted will appear here.'
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
                  const isSelfOwner = Boolean(currentUserTelegramId && String(user.id) === String(currentUserTelegramId));
                  const isProcessing = actionLoadingId === user.id;

                  return (
                    <div
                      key={user.id}
                      className={`p-3 sm:p-3.5 rounded-2xl glass-water-card card-interactive transition-all flex items-center justify-between gap-2.5 sm:gap-3 ${
                        isBanned
                          ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.25)]'
                          : isAdmin
                          ? 'border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                          : ''
                      }`}
                    >
                      {/* Left Side */}
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
                              {isSelfOwner ? 'Owner' : 'Admin'}
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
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-zinc-400 mt-0.5 font-mono">
                          <span className="text-zinc-300">ID: {user.id}</span>
                          <span>·</span>
                          <span className="text-red-400 font-sans truncate max-w-full">
                            {user.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : 'No @username'}
                          </span>
                        </div>

                        {/* Status Indicator */}
                        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2 mt-2">
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
                            <Clock className="w-3 h-3 text-zinc-600 shrink-0" />
                            <span>{formatRelativeTime(user.lastActiveAt)}</span>
                          </span>
                        </div>
                      </div>

                      {/* Right Side: Action Controls */}
                      <div className="shrink-0 pl-0 sm:pl-2 flex flex-col sm:flex-row items-end sm:items-center gap-1.5">
                        {isAdmin ? (
                          <>
                            <div
                              title="Administrators cannot be banned"
                              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-medium flex items-center gap-1.5 cursor-not-allowed select-none opacity-80"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>Protected</span>
                            </div>
                            {isOwner && !isSelfOwner && (
                              <button
                                type="button"
                                onClick={() => handleRevokeAdmin(user)}
                                disabled={isProcessing}
                                title="Revoke Admin Access"
                                className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-xs font-semibold flex items-center gap-1 cursor-pointer active:scale-95 disabled:opacity-50"
                              >
                                {isProcessing ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <>
                                    <ShieldOff className="w-3.5 h-3.5" />
                                    <span>Revoke</span>
                                  </>
                                )}
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            {isOwner && !isBanned && (
                              <button
                                type="button"
                                onClick={() => openGrantPanel(user)}
                                title="Promote this user to Sub-Admin"
                                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                                <span>Make Admin</span>
                              </button>
                            )}
                            <button
                              onClick={() => handleToggleBan(user)}
                              disabled={isProcessing}
                              className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 ${
                                isBanned
                                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30'
                                  : 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-600/30'
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
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Modal Footer (Pinned at bottom) */}
        <div className="shrink-0 p-3 sm:p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-end text-xs">
          <button
            onClick={onClose}
            className="tap px-4 py-2 rounded-xl text-white text-xs font-bold cursor-pointer border border-white/25"
            style={{
              background: 'linear-gradient(135deg, var(--a), var(--a2))',
              boxShadow: '0 8px 20px -4px color-mix(in srgb, var(--a) 55%, transparent)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
