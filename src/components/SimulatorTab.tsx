import React, { useState } from 'react';
import { api, ItemRecord } from '../lib/api';
import { 
  Send, Sparkles, AlertCircle, Lock, Globe, Smartphone, FileText, 
  ArrowRight, ShieldCheck, CheckCircle2, CornerDownRight, MessageSquare,
  Copy, Check, Hash, Play, Clock
} from 'lucide-react';

interface SimulatorTabProps {
  initialTrigger?: string;
  items: ItemRecord[];
}

export const SimulatorTab: React.FC<SimulatorTabProps> = ({ initialTrigger = '#ff', items }) => {
  const [inputText, setInputText] = useState(initialTrigger);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeScreen, setActiveScreen] = useState<'group' | 'private'>('group');
  const [isDelivering, setIsDelivering] = useState(false);

  const [copiedSimTag, setCopiedSimTag] = useState<string | null>(null);

  const startPrivateDelivery = () => {
    setActiveScreen('private');
    setIsDelivering(true);
    setTimeout(() => {
      setIsDelivering(false);
    }, 1100);
  };

  const handleSimulate = async (triggerToTest?: string) => {
    const textToTest = triggerToTest !== undefined ? triggerToTest : inputText;
    if (!textToTest.trim()) return;

    setLoading(true);
    try {
      const res = await api.simulate(textToTest, 'group');
      setSimulationResult(res);
      setActiveScreen('group');
    } catch (err: any) {
      console.error('Simulation error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Quick preset triggers for convenience
  const samplePresets = [
    '/filters',
    '/add',
    '#driver',
    '#ff',
    '#carrom',
    '#144',
    '#rapidcore',
    'ff',
    'hello'
  ];

  return (
    <div className="space-y-4 pb-24">
      {/* Simulator Intro Card */}
      <div className="glass-panel rounded-2xl p-4 border border-zinc-800 space-y-2">
        <div className="flex items-center gap-2 text-red-400 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-4 h-4" /> Live Telegram Exact-Trigger Simulator
        </div>
        <p className="text-xs text-zinc-400">
          Tests real configured triggers against group matching rules. If a trigger is unconfigured (e.g. <code className="text-zinc-300">ff</code> vs <code className="text-zinc-300">#ff</code>), the bot remains completely silent.
        </p>

        {/* Quick Chips */}
        <div className="pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-zinc-500">Quick tests:</span>
          {samplePresets.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setInputText(preset);
                handleSimulate(preset);
              }}
              className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-red-500/50 text-zinc-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSimulate()}
            placeholder="Type group message (e.g. #ff, /ff, ff, #ai)..."
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/40 transition-colors font-mono"
          />
        </div>
        <button
          onClick={() => handleSimulate()}
          disabled={loading || !inputText.trim()}
          className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>Test</span>
              <Send className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Chat Simulation Window */}
      {simulationResult && (
        <div className="space-y-3">
          {/* Header tabs inside simulator */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              {activeScreen === 'group' ? '👥 Group Chat Simulation' : '🔒 Private Chat Delivery'}
            </span>
            <div className="flex gap-1 bg-zinc-900 p-0.5 rounded-lg text-[11px] border border-zinc-800">
              <button
                onClick={() => setActiveScreen('group')}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  activeScreen === 'group' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400'
                }`}
              >
                Group Chat
              </button>
              {simulationResult.matched && !simulationResult.isFilters && (
                <button
                  onClick={() => startPrivateDelivery()}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    activeScreen === 'private' ? 'bg-red-500/20 text-sky-300 font-medium' : 'text-zinc-400'
                  }`}
                >
                  Private Bot Chat
                </button>
              )}
            </div>
          </div>

          {/* Telegram Phone Screen Frame */}
          <div className="glass-panel rounded-3xl p-4 sm:p-5 border border-zinc-800/90 shadow-2xl bg-gradient-to-b from-zinc-950 to-zinc-900/90 min-h-[320px] flex flex-col justify-between">
            {/* Top Bar inside simulated chat */}
            <div className="flex items-center gap-2.5 pb-3 border-b border-zinc-800/80 mb-4">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                {activeScreen === 'group' ? '👥' : '🤖'}
              </div>
              <div>
                <div className="text-xs font-semibold text-white">
                  {activeScreen === 'group' ? 'Telegram Group: Gamers Community' : 'Private Bot: File Delivery'}
                </div>
                <div className="text-[10px] text-zinc-400">
                  {activeScreen === 'group' ? '2,480 members' : 'bot'}
                </div>
              </div>
            </div>

            {/* Chat Body */}
            <div className="space-y-4 flex-1">
              {activeScreen === 'group' ? (
                <>
                  {/* User Trigger Message */}
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-xs bg-sky-600 px-3.5 py-2 text-white shadow-md">
                      <div className="text-xs font-mono font-medium">{simulationResult.input}</div>
                      <div className="text-[9px] text-sky-200 text-right mt-0.5">12:30 PM</div>
                    </div>
                  </div>

                  {/* Bot Response or Silence */}
                  {simulationResult.matched ? (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-zinc-800/95 border border-zinc-700/80 p-3 text-white shadow-md space-y-2.5">
                        {/* Reply Quote Header */}
                        <div className="p-2 rounded-xl bg-zinc-900/80 border-l-2 border-sky-400 text-[11px] text-zinc-300">
                          <div className="text-red-400 font-semibold text-[10px]">SimulatedUser</div>
                          <div className="font-mono text-zinc-400 truncate">{simulationResult.input}</div>
                        </div>

                        {/* Bot Reply Text */}
                        <div className="text-xs text-zinc-100 whitespace-pre-wrap font-sans">
                          {simulationResult.botResponse?.text}
                        </div>

                        {/* Interactive One-Tap Copy Chips in Simulator */}
                        {simulationResult.isFilters && simulationResult.keywords?.length > 0 && (
                          <div className="pt-2.5 border-t border-zinc-700/60 space-y-2">
                            <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                              <span className="flex items-center gap-1 text-red-400 font-medium">
                                <Sparkles className="w-3 h-3" /> One-tap copy tags:
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                {simulationResult.keywords.length} active
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1.5 bg-zinc-900/90 rounded-xl border border-zinc-700/60">
                              {simulationResult.keywords.map((kw: string) => {
                                const isCopied = copiedSimTag === kw;
                                return (
                                  <div
                                    key={kw}
                                    className="flex items-center bg-zinc-800 border border-zinc-700 hover:border-red-500/50 rounded-lg overflow-hidden group shadow-xs"
                                  >
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await navigator.clipboard.writeText(kw);
                                        setCopiedSimTag(kw);
                                        setTimeout(() => setCopiedSimTag((prev) => (prev === kw ? null : prev)), 1500);
                                      }}
                                      title={`Tap to copy ${kw}`}
                                      className={`px-2 py-1 text-xs font-mono flex items-center gap-1 transition-all cursor-pointer ${
                                        isCopied ? 'bg-emerald-500/20 text-emerald-300' : 'text-sky-300 hover:text-white'
                                      }`}
                                    >
                                      {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                                      <span>{kw}</span>
                                      {isCopied && <span className="text-[10px] text-emerald-400 font-sans font-semibold">Copied!</span>}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setInputText(kw);
                                        handleSimulate(kw);
                                      }}
                                      title={`Test ${kw} trigger`}
                                      className="px-1.5 py-1 text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700/60 transition-colors border-l border-zinc-700 cursor-pointer"
                                    >
                                      <Play className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Deep Link Buttons & Interactive Inline Buttons */}
                        {simulationResult.botResponse?.buttons?.map((btn: any, idx: number) => {
                          const rawText = btn.text || '';
                          const isTagBtn = rawText.startsWith('📥 ');
                          const tag = isTagBtn ? rawText.replace(/^📥\s*/, '') : '';
                          // Completely remove any leading bullet emojis, dots, or icons (such as 🔵, 🔴, etc.)
                          const cleanText = rawText
                            .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{200D}🔴🔵🟢🟡🟣⚫⚪🔘❌✅⭕🛑🔹🔷🔸🔶▪️▫️•🔒📥\s]+/gu, '')
                            .replace(/[🔴🔵🟢🟡🟣⚫⚪🔘❌✅⭕🛑🔹🔷🔸🔶▪️▫️]/gu, '')
                            .trim() || rawText;

                          const textLower = cleanText.toLowerCase();
                          const isDanger = btn.style === 'danger' || /cancel|delete|remove|block|reject|stop/i.test(textLower);
                          const isSuccess = btn.style === 'success' || (!isDanger && /start|confirm|approve|yes/i.test(textLower));

                          return (
                            <button
                              key={idx}
                              onClick={() => {
                                if (isTagBtn && tag) {
                                  setInputText(tag);
                                  handleSimulate(tag);
                                } else if (isDanger) {
                                  alert('Operation cancelled.');
                                } else {
                                  startPrivateDelivery();
                                }
                              }}
                              className={`w-full py-2.5 px-3.5 rounded-xl text-white text-xs font-semibold flex items-center justify-center active:scale-[0.98] transition-all cursor-pointer shadow-md ${
                                isDanger
                                  ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30 border border-red-500'
                                  : isSuccess
                                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30 border border-emerald-500'
                                  : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30 border border-blue-500'
                              }`}
                            >
                              <span>{cleanText}</span>
                            </button>
                          );
                        })}

                        <div className="text-[9px] text-zinc-400 text-right">12:30 PM</div>
                      </div>
                    </div>
                  ) : (
                    /* SILENCE */
                    <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 text-center space-y-1.5 my-6">
                      <div className="text-xs font-semibold text-zinc-300 flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-zinc-500" />
                        <span>Bot remains silent (No response)</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 max-w-sm mx-auto">
                        Because <code className="text-red-400 font-mono font-semibold">{simulationResult.input}</code> is not configured as an exact trigger. The bot never responds to unmatched text in groups.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                /* Private Chat View */
                <div className="space-y-3">
                  <div className="text-center text-[10px] text-zinc-500 py-1">
                    Deep link activated: /start {simulationResult.botResponse?.buttons?.[0]?.deepLinkPayload}
                  </div>

                  {isDelivering ? (
                    <div className="flex justify-start animate-in fade-in duration-150">
                      <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-zinc-800/95 border border-red-500/40 p-3 text-sky-300 shadow-md flex items-center gap-2.5 text-xs">
                        <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
                        <span className="font-medium">⏳ Delivering your file...</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {simulationResult.item?.type === 'file' ? (
                        <div className="space-y-2">
                          <div className="flex justify-start animate-in fade-in duration-200">
                            <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-zinc-800/95 border border-zinc-700/80 p-3 text-white shadow-md space-y-2">
                              {/* File Card */}
                              <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                                  <FileText className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-white truncate">
                                    {simulationResult.privateDeliveryPreview?.fileName || simulationResult.item?.name}
                                  </div>
                                  <div className="text-[10px] text-zinc-400">
                                    Telegram {simulationResult.privateDeliveryPreview?.fileType || 'Document'}
                                  </div>
                                </div>
                              </div>

                              {/* 10-Minute Auto-Destruct Timer Badge */}
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-mono">
                                <Clock className="w-3.5 h-3.5 text-rose-400 animate-pulse shrink-0" />
                                <span className="font-semibold">Auto-removes in 10:00 (10-Minute Timeout)</span>
                              </div>

                              {/* Caption if configured */}
                              {simulationResult.privateDeliveryPreview?.caption ? (
                                <div className="text-xs text-zinc-200 whitespace-pre-wrap">
                                  {simulationResult.privateDeliveryPreview.caption}
                                </div>
                              ) : (
                                <div className="text-[10px] text-zinc-500 italic">
                                  (No caption configured — file delivered alone without extra text)
                                </div>
                              )}

                              <div className="text-[9px] text-zinc-400 text-right">12:30 PM</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Link delivery */
                        <div className="flex justify-start animate-in fade-in duration-200">
                          <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-zinc-800/95 border border-zinc-700/80 p-3 text-white shadow-md space-y-2">
                            {simulationResult.privateDeliveryPreview?.replyMessage && (
                              <div className="text-xs text-zinc-200">
                                {simulationResult.privateDeliveryPreview.replyMessage}
                              </div>
                            )}

                            {/* Configured Link button */}
                            <a
                              href={simulationResult.privateDeliveryPreview?.url || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center transition-all block text-center shadow-md shadow-blue-600/30 border border-blue-500"
                            >
                              <span>
                                {(simulationResult.privateDeliveryPreview?.buttonText || (simulationResult.privateDeliveryPreview?.openMode === 'webapp' ? 'Launch Mini App' : 'Open Link'))
                                  .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{200D}🔴🔵🟢🟡🟣⚫⚪🔘❌✅⭕🛑🔹🔷🔸🔶▪️▫️•📱🌐🛠️\s]+/gu, '')
                                  .replace(/[🔴🔵🟢🟡🟣⚫⚪🔘❌✅⭕🛑🔹🔷🔸🔶▪️▫️]/gu, '')
                                  .trim() || 'Open Link'}
                              </span>
                            </a>

                            <div className="text-[9px] text-zinc-400 text-right">12:30 PM</div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      onClick={() => startPrivateDelivery()}
                      className="text-xs text-red-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      🔄 Replay Delivery
                    </button>
                    <span className="text-zinc-600">•</span>
                    <button
                      onClick={() => setActiveScreen('group')}
                      className="text-xs text-zinc-400 hover:text-zinc-300 font-medium flex items-center gap-1 cursor-pointer"
                    >
                      ← Back to Group Chat
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom simulated input bar */}
            <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
                Verified exact matching
              </span>
              <span>Telegram Group Environment</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
