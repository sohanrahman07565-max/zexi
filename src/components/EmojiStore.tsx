import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, Copy, Check, Sparkles, X, ChevronRight, ChevronDown, Loader2,
  Trash2, Layers, Flame, FileText, CheckCircle2, ArrowRight, Bot, Smile,
  ThumbsUp, Lock, Plus, Pencil, Code2
} from 'lucide-react';
import { api, CustomEmojiRule, CustomEmojiSlotDef } from '../lib/api';
import { toast } from '../lib/toast';

interface EmojiStoreProps {
  onBack: () => void;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: any;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'bot',
    name: 'Telegram & Bot',
    icon: Bot,
    emojis: [
      '🤖', '🚀', '🔒', '📁', '📥', '📤', '⚡', '🔥', '💎', '👑',
      '🛡️', '📱', '🔗', '📢', '💬', '🎁', '🎯', '🔑', '🏆', '✨',
      '⏳', '⌛', '📌', '💡', '⚠️', '✅', '❌', '🚫', '💯', '🔔',
      '🔕', '📡', '🕹️', '🏷️', '🔖', '🌐', '⭐️', '🌟', '💥', '🎉'
    ]
  },
  {
    id: 'files',
    name: 'Files & Media',
    icon: FileText,
    emojis: [
      '📁', '📂', '📄', '📃', '📑', '📊', '📈', '📉', '🗂️', '🗃️',
      '💾', '💿', '📀', '🎥', '🎬', '📽️', '📸', '📷', '🔍', '🔎',
      '📦', '📬', '🏷️', '📜', '🗄️', '💼', '📚', '📖', '📝', '✏️',
      '🖋️', '🖊️', '📎', '🖇️', '📌', '📍', '✂️', '🗳️', '🗞️', '📰'
    ]
  },
  {
    id: 'badges',
    name: 'Badges & Icons',
    icon: CheckCircle2,
    emojis: [
      '✅', '❌', '⚠️', 'ℹ️', '⛔', '🚫', '💯', '🔘', '⚪', '⚫',
      '🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '🟩', '🟦', '🟧', '🟨',
      '🟪', '🟫', '⬛', '⬜', '💠', '🔷', '🔶', '🔹', '🔸', '⭕',
      '‼️', '⁉️', '❓', '❕', '❗', '❇️', '✳️', '❎', '☑️', '✔️'
    ]
  },
  {
    id: 'arrows',
    name: 'Arrows & Guides',
    icon: ArrowRight,
    emojis: [
      '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️',
      '🔄', '🔃', '🔀', '🔁', '🔂', '▶️', '⏩', '⏭️', '◀️', '⏪',
      '⏮️', '🔼', '🔽', '⏫', '⏬', '📍', '📌', '🧭', '🎯', '🔲',
      '🔳', '👉', '👈', '👆', '👇', '☝️', '🫵', '🔘', '🔚', '🔙'
    ]
  },
  {
    id: 'fire',
    name: 'Fire & Sparkles',
    icon: Flame,
    emojis: [
      '🔥', '💥', '💫', '⭐', '🌟', '✨', '⚡', '☄️', '🧨', '🎆',
      '🎇', '🎉', '🎊', '🎈', '🎂', '🥂', '🍻', '🍾', '🥳', '💃',
      '🕺', '🎁', '🏆', '🥇', '🥈', '🥉', '🎖️', '🎗️', '🎫', '🎟️',
      '👑', '💎', '💍', '🔮', '🎪', '🎭', '🎨', '🎰', '🎯', '🎳'
    ]
  },
  {
    id: 'faces',
    name: 'Faces & Reactions',
    icon: Smile,
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛',
      '😜', '🤪', '😝', '🤗', '🤫', '🤔', '🤐', '🤨', '😐', '😑',
      '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤',
      '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵',
      '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '🤖', '👻', '💀', '👾'
    ]
  },
  {
    id: 'hands',
    name: 'Hands & Gestures',
    icon: ThumbsUp,
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘',
      '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚',
      '🖐️', '🖖', '👋', '🤙', '💪', '🦾', '🖕', '✍️', '🙏', '🤝',
      '👏', '🙌', '👐', '🤲', '🫂', '🤝', '🦵', '🦶', '👂', '👃'
    ]
  },
  {
    id: 'security',
    name: 'Security & Access',
    icon: Lock,
    emojis: [
      '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️', '🛡️', '⚔️', '🗡️', '🏹',
      '⚖️', '🧭', '🚨', '🚔', '👮', '🕵️', '🎫', '📜', '🏷️', '🔖',
      '💼', '🧳', '🏢', '🏛️', '⚙️', '🛠️', '🔧', '🔨', '🪛', '🧲'
    ]
  },
  {
    id: 'tech',
    name: 'Tech & Devices',
    icon: Sparkles,
    emojis: [
      '💻', '🖥️', '🖨️', '⌨️', '🖱️', '💽', '💾', '💿', '📀', '📱',
      '📲', '☎️', '📞', '📟', '📠', '🔋', '🔌', '📡', '📺', '📻',
      '🎙️', '🎚️', '🎛️', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '💡',
      '🔦', '🕯️', '🪔', '🪙', '💎', '🧭', '🔭', '🔬', '🧯', '🧲'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols & Hearts',
    icon: Layers,
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
      '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
      '💯', '💢', '💥', '💫', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤'
    ]
  },
  {
    id: 'celebration',
    name: 'Celebration & Gifts',
    icon: Flame,
    emojis: [
      '🎉', '🎊', '🎈', '🎁', '🎀', '🪄', '🪅', '🪆', '🧧', '✉️',
      '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '📪', '📫',
      '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊',
      '📈', '📉', '🗒️', '🗓️', '📆', '📅', '📇', '🏆', '🥇', '🥈'
    ]
  }
];

function stripVs(emoji: string): string {
  return String(emoji || '').replace(/\uFE0F/g, '').trim();
}

function isValidTargetEmojiClient(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length > 32) return false;
  if (/[<>{}\r\n\s]/.test(trimmed)) return false;
  if (/^[\x00-\x7F]+$/.test(trimmed)) return false;
  return true;
}

function parseTgEmojiSnippet(raw: string): { emoji?: string; customEmojiId?: string } | null {
  const match = String(raw || '').trim().match(/^<tg-emoji\b[^>]*emoji-id=["'](\d{5,30})["'][^>]*>([\s\S]*?)<\/tg-emoji>$/i);
  if (!match) return null;
  return {
    customEmojiId: match[1],
    emoji: match[2].trim() || undefined
  };
}

export const EmojiStore: React.FC<EmojiStoreProps> = ({ onBack }) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [collectedEmojis, setCollectedEmojis] = useState<string>('');
  const [toastEmoji, setToastEmoji] = useState<string | null>(null);
  const [matrixTapMode, setMatrixTapMode] = useState<'copy' | 'map'>('copy');

  // Dynamic Custom Emoji Rules state
  const [showCustomEmojiPanel, setShowCustomEmojiPanel] = useState<boolean>(true);
  const [customSlots, setCustomSlots] = useState<CustomEmojiSlotDef[]>([]);
  const [rules, setRules] = useState<CustomEmojiRule[]>([]);
  const [loadingCustomEmojis, setLoadingCustomEmojis] = useState<boolean>(false);
  const [savingCustomEmojis, setSavingCustomEmojis] = useState<boolean>(false);

  // Add / Replace mapping form
  const [newEmoji, setNewEmoji] = useState<string>('');
  const [newCustomEmojiId, setNewCustomEmojiId] = useState<string>('');
  const [newLabel, setNewLabel] = useState<string>('');

  // List search & status filter
  const [ruleSearch, setRuleSearch] = useState<string>('');
  const [ruleFilter, setRuleFilter] = useState<'all' | 'active' | 'paused'>('all');

  // Inline edit state
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editEmoji, setEditEmoji] = useState<string>('');
  const [editCustomEmojiId, setEditCustomEmojiId] = useState<string>('');
  const [editLabel, setEditLabel] = useState<string>('');
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);

  const mapperTopRef = useRef<HTMLDivElement | null>(null);
  const emojiInputRef = useRef<HTMLInputElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    const loadCustom = async () => {
      setLoadingCustomEmojis(true);
      try {
        const res = await api.getCustomEmojis();
        if (!active) return;
        setCustomSlots(Array.isArray(res.slots) ? res.slots : []);
        setRules(Array.isArray(res.rules) ? res.rules : []);
      } catch (err: any) {
        if (active) {
          toast.error(err?.message || 'Failed to load custom emoji rules');
        }
      } finally {
        if (active) setLoadingCustomEmojis(false);
      }
    };
    loadCustom();
    return () => {
      active = false;
    };
  }, []);

  const persistRules = async (nextRules: CustomEmojiRule[], successMessage?: string): Promise<boolean> => {
    setSavingCustomEmojis(true);
    try {
      const res = await api.saveCustomEmojis(nextRules);
      setRules(Array.isArray(res.rules) ? res.rules : nextRules);
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save emoji mappings');
      return false;
    } finally {
      setSavingCustomEmojis(false);
    }
  };

  const existingMatchForNewEmoji = useMemo(() => {
    const norm = stripVs(newEmoji);
    if (!norm) return undefined;
    return rules.find((r) => stripVs(r.emoji) === norm);
  }, [newEmoji, rules]);

  const unmappedSuggestions = useMemo(() => {
    const mappedNorms = new Set(rules.map((r) => stripVs(r.emoji)));
    return customSlots.filter((slot) => !mappedNorms.has(stripVs(slot.fallback)));
  }, [customSlots, rules]);

  const activeCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules]);
  const pausedCount = rules.length - activeCount;

  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    return rules.filter((rule) => {
      if (ruleFilter === 'active' && !rule.enabled) return false;
      if (ruleFilter === 'paused' && rule.enabled) return false;
      if (!q) return true;
      return (
        rule.emoji.includes(q) ||
        rule.customEmojiId.toLowerCase().includes(q) ||
        (rule.label || '').toLowerCase().includes(q) ||
        (rule.slotKey || '').toLowerCase().includes(q)
      );
    });
  }, [rules, ruleSearch, ruleFilter]);

  const handleEmojiFieldChange = (raw: string) => {
    const parsed = parseTgEmojiSnippet(raw);
    if (parsed) {
      if (parsed.emoji) setNewEmoji(parsed.emoji);
      if (parsed.customEmojiId) setNewCustomEmojiId(parsed.customEmojiId);
      return;
    }
    setNewEmoji(raw);
  };

  const handleCustomIdFieldChange = (raw: string) => {
    const parsed = parseTgEmojiSnippet(raw);
    if (parsed) {
      if (parsed.emoji && !newEmoji.trim()) setNewEmoji(parsed.emoji);
      if (parsed.customEmojiId) setNewCustomEmojiId(parsed.customEmojiId);
      return;
    }
    setNewCustomEmojiId(raw.replace(/[^\d]/g, ''));
  };

  const handleAddOrReplaceRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmoji = newEmoji.trim();
    const customId = newCustomEmojiId.trim();
    const label = newLabel.trim();

    if (!isValidTargetEmojiClient(targetEmoji)) {
      toast.error('Enter a valid target emoji (e.g. ⚡, 🔥, 🛡️)');
      emojiInputRef.current?.focus();
      return;
    }
    if (!/^\d{5,30}$/.test(customId)) {
      toast.error('Custom Emoji ID must be 5–30 digits');
      idInputRef.current?.focus();
      return;
    }

    const norm = stripVs(targetEmoji);
    const matchedSlot = customSlots.find((s) => stripVs(s.fallback) === norm);
    const now = new Date().toISOString();
    const existingIdx = rules.findIndex((r) => stripVs(r.emoji) === norm);

    let nextRules: CustomEmojiRule[];
    if (existingIdx >= 0) {
      nextRules = rules.map((r, idx) =>
        idx === existingIdx
          ? {
              ...r,
              emoji: targetEmoji,
              customEmojiId: customId,
              enabled: true,
              label: label || r.label || matchedSlot?.label,
              updatedAt: now
            }
          : r
      );
    } else {
      const created: CustomEmojiRule = {
        id: `em_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        emoji: targetEmoji,
        customEmojiId: customId,
        enabled: true,
        ...(label || matchedSlot?.label ? { label: label || matchedSlot?.label } : {}),
        ...(matchedSlot?.key ? { slotKey: matchedSlot.key } : {}),
        updatedAt: now
      };
      nextRules = [created, ...rules];
    }

    const ok = await persistRules(
      nextRules,
      existingIdx >= 0 ? `Updated mapping for ${targetEmoji}` : `Mapped ${targetEmoji} → Custom Emoji`
    );
    if (ok) {
      setNewEmoji('');
      setNewCustomEmojiId('');
      setNewLabel('');
    }
  };

  const handleToggleRule = async (ruleId: string) => {
    const nextRules = rules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled, updatedAt: new Date().toISOString() } : r
    );
    const target = nextRules.find((r) => r.id === ruleId);
    await persistRules(nextRules, target?.enabled ? `Enabled ${target.emoji}` : `Paused ${target?.emoji || ''}`);
  };

  const handleDeleteRule = async (rule: CustomEmojiRule) => {
    const nextRules = rules.filter((r) => r.id !== rule.id);
    if (editingRuleId === rule.id) setEditingRuleId(null);
    await persistRules(nextRules, `Removed mapping for ${rule.emoji}`);
  };

  const startEditRule = (rule: CustomEmojiRule) => {
    setEditingRuleId(rule.id);
    setEditEmoji(rule.emoji);
    setEditCustomEmojiId(rule.customEmojiId);
    setEditLabel(rule.label || '');
  };

  const handleSaveEditRule = async (ruleId: string) => {
    const targetEmoji = editEmoji.trim();
    const customId = editCustomEmojiId.trim();
    const label = editLabel.trim();

    if (!isValidTargetEmojiClient(targetEmoji)) {
      toast.error('Enter a valid target emoji');
      return;
    }
    if (!/^\d{5,30}$/.test(customId)) {
      toast.error('Custom Emoji ID must be 5–30 digits');
      return;
    }

    const norm = stripVs(targetEmoji);
    const matchedSlot = customSlots.find((s) => stripVs(s.fallback) === norm);
    const now = new Date().toISOString();

    // Deduplicate if user renamed target emoji to collide with another existing rule
    const withoutCollision = rules.filter((r) => r.id === ruleId || stripVs(r.emoji) !== norm);
    const nextRules = withoutCollision.map((r) =>
      r.id === ruleId
        ? {
            id: r.id,
            emoji: targetEmoji,
            customEmojiId: customId,
            enabled: r.enabled,
            ...(label || matchedSlot?.label ? { label: label || matchedSlot?.label } : {}),
            ...(matchedSlot?.key ? { slotKey: matchedSlot.key } : {}),
            updatedAt: now
          }
        : r
    );

    const ok = await persistRules(nextRules, `Saved mapping for ${targetEmoji}`);
    if (ok) {
      setEditingRuleId(null);
    }
  };

  const handleCopySnippet = (rule: CustomEmojiRule) => {
    const snippet = `<tg-emoji emoji-id="${rule.customEmojiId}">${rule.emoji}</tg-emoji>`;
    navigator.clipboard.writeText(snippet);
    setCopiedRuleId(rule.id);
    setTimeout(() => {
      setCopiedRuleId((curr) => (curr === rule.id ? null : curr));
    }, 1800);
  };

  const prefillMapper = (emoji: string, suggestedLabel?: string) => {
    setShowCustomEmojiPanel(true);
    setNewEmoji(emoji);
    const existing = rules.find((r) => stripVs(r.emoji) === stripVs(emoji));
    if (existing) {
      setNewCustomEmojiId(existing.customEmojiId);
      setNewLabel(existing.label || suggestedLabel || '');
    } else {
      const slot = customSlots.find((s) => stripVs(s.fallback) === stripVs(emoji));
      setNewLabel(suggestedLabel || slot?.label || '');
    }
    mapperTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => idInputRef.current?.focus(), 180);
  };

  // Flattened all emojis
  const allEmojis = useMemo(() => {
    return Array.from(new Set(EMOJI_CATEGORIES.flatMap((c) => c.emojis)));
  }, []);

  // Filtered emojis based on active category & search
  const filteredEmojis = useMemo(() => {
    let list: string[] = [];
    if (activeCategory === 'all') {
      list = allEmojis;
    } else {
      const cat = EMOJI_CATEGORIES.find((c) => c.id === activeCategory);
      list = cat ? cat.emojis : allEmojis;
    }

    if (!search.trim()) return list;
    const q = search.trim();
    return list.filter((e) => e.includes(q));
  }, [activeCategory, search, allEmojis]);

  const mappedNormSet = useMemo(() => {
    return new Set(rules.filter((r) => r.enabled).map((r) => stripVs(r.emoji)));
  }, [rules]);

  const handleEmojiMatrixTap = (emoji: string) => {
    if (matrixTapMode === 'map') {
      prefillMapper(emoji);
      return;
    }
    navigator.clipboard.writeText(emoji);
    setToastEmoji(emoji);
    setCollectedEmojis((prev) => prev + emoji);
    setTimeout(() => {
      setToastEmoji((current) => (current === emoji ? null : current));
    }, 2000);
  };

  const copyCollected = () => {
    if (!collectedEmojis) return;
    navigator.clipboard.writeText(collectedEmojis);
    setToastEmoji(collectedEmojis);
    setTimeout(() => {
      setToastEmoji(null);
    }, 2000);
  };

  const mapFromCollector = () => {
    if (!collectedEmojis.trim()) return;
    const segmenter = typeof Intl !== 'undefined' && (Intl as any).Segmenter
      ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
      : null;
    const graphemes: string[] = segmenter
      ? Array.from(segmenter.segment(collectedEmojis.trim()), (s: any) => s.segment)
      : Array.from(collectedEmojis.trim());
    const lastEmoji = graphemes[graphemes.length - 1] || collectedEmojis.trim();
    prefillMapper(lastEmoji);
  };

  return (
    <div className="space-y-4 pb-28 md:pb-8">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to More"
            className="glass tap p-2 rounded-xl text-white/80 hover:text-white shrink-0"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
          </button>
          <span className="text-sm font-bold text-white flex items-center gap-1.5 truncate">
            <Sparkles className="w-4 h-4 text-pink-400 shrink-0" />
            <span className="truncate">Emoji Store</span>
          </span>
        </div>
        <span className="text-xs font-mono tabular-nums text-zinc-400 shrink-0">
          {rules.length} mapped · {allEmojis.length}+ library
        </span>
      </div>

      {/* Dynamic Custom Emoji Replacements */}
      <div ref={mapperTopRef} className="glass-panel rounded-2xl border border-indigo-500/25 overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowCustomEmojiPanel((prev) => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowCustomEmojiPanel((prev) => !prev);
            }
          }}
          className="w-full px-4 py-3.5 flex items-center justify-between gap-3 bg-zinc-900/70 hover:bg-zinc-900 cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">
                Dynamic Custom Emoji Replacements (&lt;tg-emoji&gt;)
              </div>
              <div className="text-[11px] text-zinc-400 truncate font-mono tabular-nums">
                {activeCount} active · {pausedCount} paused · Auto-applied to bot HTML messages
              </div>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform shrink-0 ${showCustomEmojiPanel ? 'rotate-180' : ''}`} />
        </div>

        {showCustomEmojiPanel && (
          <div className="p-4 border-t border-zinc-800 space-y-4 bg-zinc-950/60">
            {/* Add / Replace Mapping Form */}
            <form onSubmit={handleAddOrReplaceRule} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-[88px_1fr_1fr_auto] gap-2">
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Target Emoji</label>
                  <input
                    ref={emojiInputRef}
                    type="text"
                    value={newEmoji}
                    onChange={(e) => handleEmojiFieldChange(e.target.value)}
                    placeholder="⚡"
                    className="w-full h-9 px-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-center text-base text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Custom Emoji ID</label>
                  <input
                    ref={idInputRef}
                    type="text"
                    inputMode="numeric"
                    value={newCustomEmojiId}
                    onChange={(e) => handleCustomIdFieldChange(e.target.value)}
                    placeholder="5368324170671202286"
                    className="w-full h-9 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono tabular-nums text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Label (Optional)</label>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. API Bolt"
                    maxLength={64}
                    className="w-full h-9 px-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={savingCustomEmojis}
                    className="w-full sm:w-auto h-9 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {savingCustomEmojis ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>{existingMatchForNewEmoji ? 'Replace Mapping' : 'Add Mapping'}</span>
                  </button>
                </div>
              </div>

              {/* Quick Suggestions */}
              {unmappedSuggestions.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] text-zinc-500 mr-0.5">Quick pick:</span>
                  {unmappedSuggestions.slice(0, 14).map((slot) => (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => prefillMapper(slot.fallback, slot.label)}
                      title={`Fill ${slot.fallback} (${slot.label})`}
                      className="px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-indigo-500/60 hover:bg-zinc-800/80 text-xs text-zinc-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>{slot.fallback}</span>
                      <span className="text-[10px] text-zinc-400 hidden sm:inline">{slot.label.split('/')[0].trim()}</span>
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* Saved Mappings Toolbar & List */}
            {loadingCustomEmojis ? (
              <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Loading emoji mappings...</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {rules.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={ruleSearch}
                        onChange={(e) => setRuleSearch(e.target.value)}
                        placeholder="Filter mappings by emoji, label, or ID..."
                        className="w-full h-8 bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-8 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-400"
                      />
                      {ruleSearch && (
                        <button
                          type="button"
                          onClick={() => setRuleSearch('')}
                          aria-label="Clear filter"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-0.5 text-[11px]">
                      {(['all', 'active', 'paused'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setRuleFilter(tab)}
                          className={`px-2.5 py-1 rounded-lg capitalize font-medium cursor-pointer transition-colors ${
                            ruleFilter === tab
                              ? 'bg-indigo-500 text-white font-semibold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {rules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center space-y-1">
                    <div className="text-xs font-semibold text-zinc-200">No emoji mappings configured yet</div>
                    <div className="text-[11px] text-zinc-400">
                      Add any emoji and its Telegram custom_emoji_id above (use /emojiid in Telegram to grab IDs).
                    </div>
                  </div>
                ) : filteredRules.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-5 text-center text-xs text-zinc-400">
                    No mappings match the current filter.
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 divide-y divide-zinc-800/80 max-h-80 overflow-y-auto">
                    {filteredRules.map((rule) => {
                      const isEditing = editingRuleId === rule.id;
                      if (isEditing) {
                        return (
                          <div key={rule.id} className="p-3 bg-zinc-900/95 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[72px_1fr_1fr] gap-2">
                              <input
                                type="text"
                                value={editEmoji}
                                onChange={(e) => setEditEmoji(e.target.value)}
                                placeholder="⚡"
                                className="h-8 px-2 rounded-lg bg-zinc-950 border border-zinc-700 text-center text-base text-white focus:outline-none focus:border-indigo-400"
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                value={editCustomEmojiId}
                                onChange={(e) => setEditCustomEmojiId(e.target.value.replace(/[^\d]/g, ''))}
                                placeholder="Custom Emoji ID"
                                className="h-8 px-2.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-indigo-400"
                              />
                              <input
                                type="text"
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                placeholder="Label (optional)"
                                maxLength={64}
                                className="h-8 px-2.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-white focus:outline-none focus:border-indigo-400"
                              />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingRuleId(null)}
                                className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={savingCustomEmojis}
                                onClick={() => handleSaveEditRule(rule.id)}
                                className="px-3 py-1 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={rule.id}
                          className={`px-3 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 ${
                            rule.enabled ? '' : 'opacity-65'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-xl w-8 text-center shrink-0">{rule.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-xs text-white font-medium truncate">
                                <span className="truncate">{rule.label || `Emoji ${rule.emoji}`}</span>
                                <span className={`text-[11px] font-normal shrink-0 ${rule.enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                  · {rule.enabled ? 'Active' : 'Paused'}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono tabular-nums text-zinc-400 truncate">
                                ID {rule.customEmojiId}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={rule.enabled}
                              aria-label={rule.enabled ? `Pause ${rule.emoji}` : `Enable ${rule.emoji}`}
                              disabled={savingCustomEmojis}
                              onClick={() => handleToggleRule(rule.id)}
                              className={`w-9 h-5 rounded-full transition-colors p-0.5 cursor-pointer disabled:opacity-50 ${
                                rule.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
                              }`}
                            >
                              <span
                                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                                  rule.enabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopySnippet(rule)}
                              title="Copy <tg-emoji> HTML tag"
                              aria-label="Copy <tg-emoji> HTML tag"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                            >
                              {copiedRuleId === rule.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Code2 className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => startEditRule(rule)}
                              title="Edit mapping"
                              aria-label="Edit mapping"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              disabled={savingCustomEmojis}
                              onClick={() => handleDeleteRule(rule)}
                              title="Delete mapping"
                              aria-label="Delete mapping"
                              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search & Tap Mode Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emojis..."
            className="w-full bg-zinc-900 border border-zinc-700/80 rounded-xl py-2 pl-10 pr-10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-pink-500 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-0.5 text-[11px] shrink-0">
          <button
            type="button"
            onClick={() => setMatrixTapMode('copy')}
            className={`px-2.5 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              matrixTapMode === 'copy' ? 'bg-pink-500 text-white font-semibold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Tap: Copy
          </button>
          <button
            type="button"
            onClick={() => setMatrixTapMode('map')}
            className={`px-2.5 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
              matrixTapMode === 'map' ? 'bg-indigo-500 text-white font-semibold' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Tap: Map ID
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div
        data-no-tab-swipe="true"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs touch-pan-x"
      >
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`py-1.5 px-3 rounded-xl font-medium shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
            activeCategory === 'all'
              ? 'bg-pink-500 text-white shadow-md shadow-pink-500/20 font-bold'
              : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All ({allEmojis.length})</span>
        </button>

        {EMOJI_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`py-1.5 px-3 rounded-xl font-medium shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-pink-500 text-white shadow-md shadow-pink-500/20 font-bold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>

      {/* Emoji Matrix */}
      <div className="glass-panel rounded-2xl p-3.5 border border-zinc-800/80">
        <div className="grid grid-cols-5 min-[360px]:grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-14 gap-1.5 sm:gap-2">
          {filteredEmojis.map((emoji, index) => {
            const isMapped = mappedNormSet.has(stripVs(emoji));
            return (
              <button
                key={`${emoji}-${index}`}
                type="button"
                onClick={() => handleEmojiMatrixTap(emoji)}
                className={`h-12 rounded-xl bg-zinc-900/90 border text-2xl flex items-center justify-center transition-all active:scale-90 hover:scale-105 cursor-pointer shadow-xs group relative ${
                  isMapped
                    ? 'border-indigo-500/60 hover:border-indigo-400'
                    : 'border-zinc-800 hover:border-pink-500/60 hover:bg-zinc-800/90'
                }`}
                title={matrixTapMode === 'map' ? `Map custom ID for ${emoji}` : `Tap to copy ${emoji}`}
              >
                <span>{emoji}</span>
                {isMapped && (
                  <span
                    className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating Collector / Multi-Copy Box */}
      <div className="glass-panel rounded-2xl p-3 border border-zinc-800 bg-zinc-950/90 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Emoji Collector:</span>
          {collectedEmojis && (
            <button
              type="button"
              onClick={() => setCollectedEmojis('')}
              className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <div
            data-no-tab-swipe="true"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-base text-white tracking-widest min-h-10 flex items-center overflow-x-auto touch-pan-x"
          >
            {collectedEmojis || <span className="text-zinc-500 text-xs tracking-normal">Tap emojis above to collect...</span>}
          </div>

          <button
            type="button"
            onClick={mapFromCollector}
            disabled={!collectedEmojis}
            className="py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Map Last</span>
          </button>

          <button
            type="button"
            onClick={copyCollected}
            disabled={!collectedEmojis}
            className="py-2.5 px-4 rounded-xl bg-pink-500 hover:bg-pink-400 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-pink-500/20 transition-all active:scale-95 disabled:opacity-40 cursor-pointer shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy All</span>
          </button>
        </div>
      </div>

      {/* Floating Copy Toast */}
      {toastEmoji && (
        <div className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] md:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] truncate bg-zinc-900/95 text-white border border-pink-500/40 shadow-2xl px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Copied:</span>
          <span className="text-base">{toastEmoji}</span>
        </div>
      )}
    </div>
  );
};
