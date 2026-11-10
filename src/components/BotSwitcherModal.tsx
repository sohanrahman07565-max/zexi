import React, { useState, useEffect } from 'react';
import { BotInstance, api } from '../lib/api';
import { toast } from '../lib/toast';
import { 
  Bot, Check, Plus, Trash2, ExternalLink, RefreshCw, Loader2, 
  X, Shield, Radio, Sparkles, AlertCircle, Copy, CheckCircle2, ChevronRight
} from 'lucide-react';

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
  const [cloning, setCloning] = useState<boolean>(false);
  const [cloneError, setCloneError] = useState<string>('');
  
  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

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
      setCloneError('');
      setDeleteConfirmId(null);
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

    setCloning(true);
    setCloneError('');

    try {
      const newBot = await api.cloneBot(token);
      toast.success(`Bot @${newBot.username || newBot.name} cloned & activated successfully!`);
      setTokenInput('');
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
      setCloneError(err?.message || 'Failed to clone bot. Please verify the token.');
      toast.error(err?.message || 'Failed to clone bot');
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteBot = async (id: string) => {
    setDeleting(true);
    try {
      await api.deleteClonedBot(id);
      toast.success('Cloned bot removed successfully.');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md max-h-[92vh] flex flex-col rounded-3xl bg-[#0b0c14] border border-white/15 p-4 sm:p-5 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_30px_rgba(239,68,68,0.25)] text-white relative animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-500/25 to-rose-600/20 text-red-400 border border-red-500/30 flex items-center justify-center shrink-0 shadow-lg shadow-red-500/20">
              <Bot className="w-5 h-5 text-red-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white flex items-center gap-1.5 leading-tight">
                <span>Switch Telegram Bot</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-mono font-semibold border border-red-500/30">
                  {bots.length} Active
                </span>
              </h2>
              <p className="text-[11px] text-zinc-400 truncate">
                Isolated database for each bot instance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Bot List Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 pr-1">
          {/* Active Bot Summary Banner */}
          <div className="p-3 rounded-2xl bg-gradient-to-r from-red-950/40 via-red-900/20 to-zinc-900/50 border border-red-500/30 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-bold tracking-wider text-red-400">
                Active Dashboard Target
              </div>
              <div className="text-sm font-bold text-white truncate flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0" />
                <span className="truncate">
                  {bots.find(b => b.id === activeBotId)?.name || currentBotUsername || 'Primary Bot'}
                </span>
              </div>
            </div>
            <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/10 text-white/90 border border-white/15 font-mono shrink-0">
              ID: {activeBotId}
            </span>
          </div>

          {/* Bot Instance Cards */}
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-400">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
              <span className="text-xs">Loading bot fleet...</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-1">
                Connected Bots
              </div>

              {bots.map((bot) => {
                const isActive = bot.id === activeBotId;
                return (
                  <div
                    key={bot.id}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      isActive
                        ? 'bg-red-500/10 border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                        : 'bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]'
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
                            {bot.isMain && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold shrink-0">
                                Primary
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
                    <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-zinc-400">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-white">{bot.filesCount}</span> files
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-white">{bot.usersCount}</span> users
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-medium">Running Isolated</span>
                      </div>
                    </div>

                    {/* Inline Delete Confirmation */}
                    {deleteConfirmId === bot.id && (
                      <div className="mt-2.5 p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 space-y-2 animate-in fade-in duration-150">
                        <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                          <span>Stop &amp; Remove @{bot.username}?</span>
                        </div>
                        <p className="text-[11px] text-rose-200/80">
                          This will stop the runner process and unlink this bot from the panel.
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

          {/* Clone Bot Section */}
          <div className="pt-2">
            {!showCloneForm ? (
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

                {cloneError && (
                  <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[11px] text-rose-300 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{cloneError}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={cloning || !tokenInput.trim()}
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
};
