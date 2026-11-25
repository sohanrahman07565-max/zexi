import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BotInstance, BotOperationalMode, api } from '../lib/api';
import { toast } from '../lib/toast';
import { 
  Bot, Check, Plus, Trash2, ExternalLink, RefreshCw, Loader2, 
  X, Shield, Sparkles, AlertCircle, Copy, Play, Square, RotateCcw,
  FolderOpen, FileEdit, Image as ImageIcon, ChevronDown, SlidersHorizontal
} from 'lucide-react';

function getModeLabel(mode?: BotOperationalMode): string {
  if (mode === 'post_bot') return 'Post Bot';
  if (mode === 'image_url_bot') return 'Image URL Bot';
  return 'File Bot';
}

interface BotSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBotSwitched: (botId: string) => void;
  currentBotUsername?: string;
}

export const BotSwitcherModal: React.FC<BotSwitcherModalProps> = ({
  isOpen,
  onClose,
  onBotSwitched,
  currentBotUsername
}) => {
  const [bots, setBots] = useState<BotInstance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeBotId, setActiveBotId] = useState<string>(() => api.getActiveBotId());
  
  // Clone bot form state
  const [showCloneForm, setShowCloneForm] = useState<boolean>(false);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [cloneMode, setCloneMode] = useState<BotOperationalMode | null>(null);
  const [cloning, setCloning] = useState<boolean>(false);
  const [cloneError, setCloneError] = useState<string>('');
  
  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [lifecycleBusy, setLifecycleBusy] = useState<string | null>(null);
  const [openModeMenuId, setOpenModeMenuId] = useState<string | null>(null);

  const loadBots = async () => {
    setLoading(true);
    try {
      const list = await api.getBots();
      setBots(list);
      setActiveBotId(api.getActiveBotId());
    } catch (err: any) {
      console.error('Error fetching bots list:', err);
      toast.error('Failed to load bots: ' + (err?.message || 'Network error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadBots();
      setShowCloneForm(false);
      setTokenInput('');
      setCloneMode(null);
      setCloneError('');
      setDeleteConfirmId(null);
      setOpenModeMenuId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectBot = (bot: BotInstance) => {
    if (bot.id === activeBotId) {
      onClose();
      return;
    }
    api.setActiveBotId(bot.id);
    setActiveBotId(bot.id);
    toast.success(`Switched to ${bot.name || `@${bot.username}`}! Isolated database loaded.`);
    onBotSwitched(bot.id);
    onClose();
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = tokenInput.trim();
    if (!token) {
      setCloneError('Please enter a valid Telegram Bot Token from @BotFather');
      return;
    }
    if (!cloneMode) {
      setCloneError('Please choose a Bot Mode (File Bot, Post Bot, or Image URL Bot) before cloning.');
      return;
    }

    setCloning(true);
    setCloneError('');

    try {
      const newBot = await api.cloneBot(token, undefined, cloneMode);
      const modeLabel = getModeLabel(cloneMode);
      toast.success(`Bot @${newBot.username || newBot.name} cloned & activated in ${modeLabel} mode!`);
      setTokenInput('');
      setCloneMode(null);
      setShowCloneForm(false);
      await loadBots();
      // Automatically switch to the newly cloned bot
      if (newBot?.id) {
        api.setActiveBotId(newBot.id);
        setActiveBotId(newBot.id);
        onBotSwitched(newBot.id);
      }
    } catch (err: any) {
      console.error('Error cloning bot:', err);
      const isDuplicate = err?.message && (
        err.message.includes('already running') ||
        err.message.includes('Already this bot is already running')
      );
      const formattedError = isDuplicate 
        ? 'Already this bot is already running.' 
        : (err?.message || 'Failed to clone bot. Please verify the token.');
      setCloneError(formattedError);
      toast.error(formattedError);
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteBot = async (id: string) => {
    setDeleting(true);
    try {
      await api.deleteClonedBot(id);
      toast.success('Cloned bot terminated & removed completely.');
      setDeleteConfirmId(null);
      if (activeBotId === id) {
        api.setActiveBotId('main');
        setActiveBotId('main');
        onBotSwitched('main');
      }
      await loadBots();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove bot');
    } finally {
      setDeleting(false);
    }
  };

  const handleChangeBotMode = async (bot: BotInstance, nextMode: BotOperationalMode) => {
    const busyKey = `${bot.id}:mode`;
    setLifecycleBusy(busyKey);
    setOpenModeMenuId(null);
    try {
      const res = await api.changeBotMode(bot.id, nextMode);
      toast.success(res.message || `Switched to ${getModeLabel(nextMode)}`);
      setBots((prev) => prev.map((b) => (b.id === bot.id ? { ...b, botMode: nextMode } : b)));
      if (bot.id === activeBotId) {
        onBotSwitched(bot.id);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to switch bot mode');
    } finally {
      setLifecycleBusy(null);
    }
  };

  const handleBotLifecycle = async (bot: BotInstance, action: 'start' | 'stop' | 'restart' | 'clean-memory') => {
    const busyKey = `${bot.id}:${action}`;
    setLifecycleBusy(busyKey);
    try {
      if (action === 'start') {
        const res = await api.startBot(bot.id);
        toast.success(res.message || 'Bot started!');
      } else if (action === 'stop') {
        const res = await api.stopBot(bot.id);
        toast.success(res.message || 'Bot stopped!');
      } else if (action === 'restart') {
        const res = await api.restartBot(bot.id);
        toast.success(res.message || 'Bot restarted!');
      } else {
        const res = await api.cleanBotMemory(bot.id);
        toast.success(res.message || 'Bot memory cleaned!');
      }
      if (action !== 'clean-memory') {
        await loadBots();
        if (bot.id === activeBotId) {
          onBotSwitched(bot.id);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || `Failed to ${action} bot`);
    } finally {
      setLifecycleBusy(null);
    }
  };

  const modalContent = (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div 
        className="w-full max-w-md md:max-w-3xl max-h-[90dvh] flex flex-col rounded-3xl glass-water-card border border-white/20 p-4 sm:p-5 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_30px_rgba(239,68,68,0.25)] text-white relative animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className="lg-tile w-10 h-10 rounded-2xl text-white shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--a), var(--a2))',
                '--c': 'rgba(124,156,255,0.45)',
              } as React.CSSProperties}
            >
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-white flex items-center flex-wrap gap-1.5 leading-tight">
                <span>Switch Telegram Bot</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/90 font-mono font-semibold border border-white/20 shrink-0">
                  {bots.filter(b => b.status !== 'stopped').length}/{bots.length} Running
                </span>
              </h2>
              <p className="text-[11px] text-white/60 truncate">
                Isolated database for each bot instance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="tap w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Bot List Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 pr-1">
          {/* Active Bot Summary Banner */}
          <div className="glass p-3 rounded-2xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold tracking-wider" style={{ color: 'var(--a3)' }}>
                Active Dashboard Target
              </div>
              <div className="text-sm font-bold text-white truncate flex items-center gap-1.5 mt-0.5">
                <span className="lg-dot shrink-0" />
                <span className="truncate">
                  {bots.find(b => b.id === activeBotId)?.name || currentBotUsername || 'Primary Bot'}
                </span>
              </div>
            </div>
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/10 text-white/90 border border-white/15 font-mono shrink-0">
              ID: {activeBotId === 'main' ? 'main' : activeBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '')}
            </span>
          </div>

          {/* Bot Instance Cards */}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
              <span className="text-xs">Loading bot fleet...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 md:gap-3">
              <div className="md:col-span-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                Connected Bots
              </div>

              {bots.map((bot) => {
                const isActive = bot.id === activeBotId;
                return (
                  <div
                    key={bot.id}
                    className={`p-3.5 rounded-2xl border transition-all card-interactive ${
                      isActive
                        ? 'bg-red-500/15 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.25)] backdrop-blur-xl'
                        : 'glass-water-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-red-500 text-white shadow-md shadow-red-500/40'
                            : 'bg-white/10 text-zinc-300'
                        }`}>
                          <Bot className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
                            <span className="truncate">{bot.name}</span>
                            {bot.isMain ? (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold shrink-0">
                                Primary
                              </span>
                            ) : (
                              <span className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold shrink-0 ${
                                bot.botMode === 'post_bot'
                                  ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                                  : bot.botMode === 'image_url_bot'
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                    : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                              }`}>
                                {getModeLabel(bot.botMode)}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-400 truncate flex items-center gap-1 mt-0.5">
                            {bot.username ? (
                              <a
                                href={`https://t.me/${bot.username.replace(/^@/, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-400 hover:underline flex items-center gap-0.5 truncate"
                                onClick={(e) => e.stopPropagation()}
                              >
                                @{bot.username.replace(/^@/, '')}
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                              </a>
                            ) : (
                              <span>No username set</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Action: Active Check or Switch Button */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isActive ? (
                          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                            <Check className="w-3.5 h-3.5" />
                            <span>Active</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSelectBot(bot)}
                            className="px-3 py-1 rounded-xl bg-white/10 hover:bg-red-500 text-white text-xs font-semibold border border-white/20 hover:border-red-500 transition-all cursor-pointer active:scale-95 shadow-sm"
                          >
                            Switch
                          </button>
                        )}

                        {/* Delete Button for Cloned Bots */}
                        {!bot.isMain && (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(bot.id)}
                            title="Remove cloned bot"
                            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer border border-white/10 hover:border-rose-500/30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Stats & Meta Footer */}
                    <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between flex-wrap gap-2 text-[11px] text-white/60">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-white">{bot.filesCount}</span> files
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-white">{bot.usersCount}</span> users
                        </span>
                      </div>
                      {bot.status === 'stopped' ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          <span className="text-[10px] text-rose-400 font-medium">Stopped</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-[10px] text-emerald-400 font-medium">
                            {bot.isMain ? 'Running' : 'Running Isolated'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Runtime Lifecycle & Memory Controls */}
                    <div className="mt-2 pt-2 border-t border-white/5 grid grid-cols-3 gap-1.5">
                      {bot.status === 'stopped' ? (
                        <button
                          type="button"
                          disabled={lifecycleBusy !== null}
                          onClick={() => handleBotLifecycle(bot, 'start')}
                          className="min-w-0 py-1.5 px-1 min-[360px]:px-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[9.5px] min-[360px]:text-[10px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {lifecycleBusy === `${bot.id}:start` ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Play className="w-3 h-3 shrink-0" />}
                          <span className="truncate">Start</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={lifecycleBusy !== null}
                          onClick={() => handleBotLifecycle(bot, 'stop')}
                          className="min-w-0 py-1.5 px-1 min-[360px]:px-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[9.5px] min-[360px]:text-[10px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {lifecycleBusy === `${bot.id}:stop` ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Square className="w-3 h-3 shrink-0" />}
                          <span className="truncate">Stop</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={lifecycleBusy !== null}
                        onClick={() => handleBotLifecycle(bot, 'restart')}
                        className="min-w-0 py-1.5 px-1 min-[360px]:px-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[9.5px] min-[360px]:text-[10px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {lifecycleBusy === `${bot.id}:restart` ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <RotateCcw className="w-3 h-3 shrink-0" />}
                        <span className="truncate">Restart</span>
                      </button>

                      {bot.isMain ? (
                        <button
                          type="button"
                          disabled={lifecycleBusy !== null}
                          onClick={() => handleBotLifecycle(bot, 'clean-memory')}
                          className="min-w-0 py-1.5 px-1 min-[360px]:px-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[9.5px] min-[360px]:text-[10px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {lifecycleBusy === `${bot.id}:clean-memory` ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : <Sparkles className="w-3 h-3 shrink-0" />}
                          <span className="truncate">Clean Mem</span>
                        </button>
                      ) : (
                        <div className="relative min-w-0">
                          <button
                            type="button"
                            disabled={lifecycleBusy !== null}
                            onClick={() => setOpenModeMenuId((prev) => (prev === bot.id ? null : bot.id))}
                            className="w-full min-w-0 py-1.5 px-1 min-[360px]:px-2 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/30 text-[9.5px] min-[360px]:text-[10px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                          >
                            {lifecycleBusy === `${bot.id}:mode` ? (
                              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            ) : (
                              <SlidersHorizontal className="w-3 h-3 shrink-0" />
                            )}
                            <span className="truncate">Mode Change</span>
                            <ChevronDown className={`w-2.5 h-2.5 shrink-0 transition-transform ${openModeMenuId === bot.id ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Mode Change Dropdown Panel for Cloned Bot */}
                    {!bot.isMain && openModeMenuId === bot.id && (
                      <div className="mt-2 p-2 rounded-xl bg-black/50 border border-violet-500/30 space-y-1.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-200/80">
                            Select Operational Mode
                          </span>
                          <span className="text-[10px] text-white/50">
                            Current: {getModeLabel(bot.botMode)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <button
                            type="button"
                            disabled={lifecycleBusy !== null}
                            onClick={() => handleChangeBotMode(bot, 'file_bot')}
                            className={`p-2 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-50 ${
                              (bot.botMode || 'file_bot') === 'file_bot'
                                ? 'bg-sky-500/20 border-sky-400/50 text-white'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10.5px] font-bold flex items-center gap-1 min-w-0">
                                <FolderOpen className="w-3 h-3 text-sky-400 shrink-0" />
                                <span className="truncate">File Bot</span>
                              </span>
                              {(bot.botMode || 'file_bot') === 'file_bot' && (
                                <Check className="w-3 h-3 text-sky-400 shrink-0" />
                              )}
                            </div>
                            <p className="text-[9px] text-white/55 mt-0.5 leading-tight">
                              Files &amp; filters
                            </p>
                          </button>

                          <button
                            type="button"
                            disabled={lifecycleBusy !== null}
                            onClick={() => handleChangeBotMode(bot, 'post_bot')}
                            className={`p-2 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-50 ${
                              bot.botMode === 'post_bot'
                                ? 'bg-violet-500/25 border-violet-400/60 text-white'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10.5px] font-bold flex items-center gap-1 min-w-0">
                                <FileEdit className="w-3 h-3 text-violet-400 shrink-0" />
                                <span className="truncate">Post Bot</span>
                              </span>
                              {bot.botMode === 'post_bot' && (
                                <Check className="w-3 h-3 text-violet-400 shrink-0" />
                              )}
                            </div>
                            <p className="text-[9px] text-white/55 mt-0.5 leading-tight">
                              Post &amp; buttons
                            </p>
                          </button>

                          <button
                            type="button"
                            disabled={lifecycleBusy !== null}
                            onClick={() => handleChangeBotMode(bot, 'image_url_bot')}
                            className={`p-2 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-50 ${
                              bot.botMode === 'image_url_bot'
                                ? 'bg-emerald-500/25 border-emerald-400/60 text-white'
                                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10.5px] font-bold flex items-center gap-1 min-w-0">
                                <ImageIcon className="w-3 h-3 text-emerald-400 shrink-0" />
                                <span className="truncate">Image URL</span>
                              </span>
                              {bot.botMode === 'image_url_bot' && (
                                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                              )}
                            </div>
                            <p className="text-[9px] text-white/55 mt-0.5 leading-tight">
                              Photo to URL
                            </p>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Dedicated Sub-Admin Panel Credentials ONLY for File Bot mode (never Post Bot / Image URL Bot) */}
                    {!bot.isMain && (!bot.botMode || bot.botMode === 'file_bot') && (bot.panelUrl || bot.adminPassword) && (() => {
                      const cleanBotId = String(bot.adminUsername || bot.id || '').replace(/^clone_/i, '').replace(/[:_-]/g, '');
                      const base = typeof window !== 'undefined' ? window.location.origin : '';
                      const rawUrl = bot.panelUrl || `/panel?bot_id=${cleanBotId}`;
                      const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${base}${rawUrl}`;
                      return (
                        <div className="mt-2.5 p-2.5 rounded-xl bg-white/[0.04] border border-white/15 space-y-1.5 text-[11px]">
                          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/70">
                            <span>Sub-Admin Panel Credentials</span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(`Panel URL: ${fullUrl}\nBot ID: ${cleanBotId}\nPassword: ${bot.adminPassword || 'secret'}`);
                                toast.success('Sub-Admin credentials copied!');
                              }}
                              className="text-red-400 hover:text-red-300 flex items-center gap-1 cursor-pointer transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </button>
                          </div>
                          <div className="space-y-0.5 font-mono text-[10px] text-white/90">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-white/50 shrink-0">URL:</span>
                              <a 
                                href={fullUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="text-sky-300 hover:underline min-w-0 flex-1 text-right truncate select-all"
                              >
                                {fullUrl}
                              </a>
                            </div>
                            <div className="flex items-center justify-between gap-2 min-w-0">
                              <span className="text-white/50 shrink-0">Bot ID:</span>
                              <span className="text-red-300 font-bold select-all break-all text-right">{cleanBotId}</span>
                            </div>
                            {bot.adminPassword && (
                              <div className="flex items-center justify-between gap-2 min-w-0">
                                <span className="text-white/50 shrink-0">Pass:</span>
                                <span className="text-amber-300 font-bold select-all break-all text-right">{bot.adminPassword}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Inline Delete Confirmation */}
                    {deleteConfirmId === bot.id && (
                      <div className="mt-2.5 p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                          <span>Stop &amp; Remove @{bot.username}?</span>
                        </div>
                        <p className="text-[11px] text-rose-200/80">
                          This will immediately stop polling, terminate the bot instance, and purge its isolated storage.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => handleDeleteBot(bot.id)}
                            className="flex-1 py-1 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            <span>Confirm Remove</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(null)}
                            className="py-1 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Clone Bot Section: Available strictly on Primary Main Bot panel */}
          <div className="pt-2">
            {activeBotId !== 'main' ? (
              <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 text-center text-xs text-white/50 flex items-center justify-center gap-2">
                <Shield className="w-4 h-4 text-white/40" />
                <span>Cloned Bot Panel Mode · Isolated File &amp; Setting Access</span>
              </div>
            ) : !showCloneForm ? (
              <button
                type="button"
                onClick={() => setShowCloneForm(true)}
                className="w-full py-3 px-4 rounded-2xl border border-dashed border-red-500/40 bg-red-500/5 hover:bg-red-500/10 text-red-400 hover:text-red-300 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
              >
                <Plus className="w-4 h-4" />
                <span>+ Clone New Bot Instance</span>
              </button>
            ) : (
              <form 
                onSubmit={handleCloneSubmit}
                className="p-3.5 rounded-2xl bg-zinc-900/80 border border-white/15 space-y-3 animate-in fade-in duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-red-400" />
                    <span>Clone Telegram Bot</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCloneForm(false);
                      setCloneError('');
                    }}
                    className="text-[11px] text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>

                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Enter the API token from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-400 underline font-semibold">@BotFather</a>. The system will spin up an isolated runner with its own private database.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">
                    Telegram Bot Token
                  </label>
                  <input
                    type="text"
                    required
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                    className="w-full px-3 py-2 rounded-xl bg-black/60 border border-white/20 text-xs font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider flex items-center justify-between">
                    <span>Choose Bot Mode</span>
                    {!cloneMode && (
                      <span className="text-[9.5px] font-normal text-amber-300/90 normal-case">
                        Required
                      </span>
                    )}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCloneMode('file_bot');
                        if (cloneError.includes('Bot Mode')) setCloneError('');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        cloneMode === 'file_bot'
                          ? 'bg-sky-500/20 border-sky-400/60 text-white shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                          : 'bg-black/40 hover:bg-white/[0.06] border-white/15 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <FolderOpen className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span>File Bot</span>
                        </span>
                        {cloneMode === 'file_bot' && (
                          <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-snug">
                        File delivery &amp; indexing mode
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCloneMode('post_bot');
                        if (cloneError.includes('Bot Mode')) setCloneError('');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        cloneMode === 'post_bot'
                          ? 'bg-violet-500/20 border-violet-400/60 text-white shadow-[0_0_15px_rgba(167,139,250,0.2)]'
                          : 'bg-black/40 hover:bg-white/[0.06] border-white/15 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <FileEdit className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          <span>Post Bot</span>
                        </span>
                        {cloneMode === 'post_bot' && (
                          <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-snug">
                        Channel post &amp; inline buttons
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCloneMode('image_url_bot');
                        if (cloneError.includes('Bot Mode')) setCloneError('');
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        cloneMode === 'image_url_bot'
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-white shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                          : 'bg-black/40 hover:bg-white/[0.06] border-white/15 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>Image URL Bot</span>
                        </span>
                        {cloneMode === 'image_url_bot' && (
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-1 leading-snug">
                        Photo-to-URL &amp; auto-expiry
                      </p>
                    </button>
                  </div>
                </div>

                {cloneError && (
                  <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[11px] text-rose-300 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{cloneError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={cloning || !tokenInput.trim() || !cloneMode}
                    className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-red-500/30 flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {cloning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Verifying &amp; Launching...</span>
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5" />
                        <span>Verify &amp; Clone Bot</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="pt-1 text-[10px] text-zinc-500 text-center">
                  💡 You can also clone directly in Telegram using: <code className="text-zinc-300">/clone &lt;token&gt;</code>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400 shrink-0">
          <span className="truncate">Files and users are kept strictly isolated.</span>
          <button
            type="button"
            onClick={loadBots}
            className="flex items-center gap-1 text-zinc-300 hover:text-white cursor-pointer transition-colors shrink-0 ml-2"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
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
