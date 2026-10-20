import React, { useState, useMemo } from 'react';
import { 
  Search, Copy, Check, Sparkles, X, ChevronLeft, 
  Trash2, Layers, Flame, FileText, CheckCircle2, ArrowRight, Bot, Smile, ThumbsUp, Lock
} from 'lucide-react';

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

export const EmojiStore: React.FC<EmojiStoreProps> = ({ onBack }) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [copiedEmoji, setCopiedEmoji] = useState<string | null>(null);
  const [collectedEmojis, setCollectedEmojis] = useState<string>('');
  const [toastEmoji, setToastEmoji] = useState<string | null>(null);

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

    // Search query matching
    const q = search.trim();
    return list.filter((e) => e.includes(q));
  }, [activeCategory, search, allEmojis]);

  const handleCopy = (emoji: string) => {
    navigator.clipboard.writeText(emoji);
    setCopiedEmoji(emoji);
    setToastEmoji(emoji);
    setCollectedEmojis((prev) => prev + emoji);

    setTimeout(() => {
      setCopiedEmoji(null);
    }, 1200);

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

  return (
    <div className="space-y-4 pb-28">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Menu</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-pink-400" />
            <span>Emoji Store</span>
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-semibold border border-pink-500/30">
            {allEmojis.length}+ Emojis
          </span>
        </div>
      </div>

      {/* Description banner */}
      <div className="glass-panel rounded-2xl p-3.5 border border-pink-500/20 bg-gradient-to-r from-pink-500/10 via-zinc-900 to-indigo-500/10 text-xs text-zinc-300 space-y-1">
        <p className="font-semibold text-white flex items-center gap-1.5">
          <span>💡 One-Tap Copy</span>
        </p>
        <p className="text-[11px] text-zinc-400">
          Tap any emoji to copy it to your clipboard immediately. Use these to style your bot messages, buttons, and trigger keywords.
        </p>
      </div>

      {/* Search Input */}
      <div className="relative">
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
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
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
        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
          {filteredEmojis.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              onClick={() => handleCopy(emoji)}
              className="h-12 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-pink-500/60 hover:bg-zinc-800/90 text-2xl flex items-center justify-center transition-all active:scale-90 hover:scale-105 cursor-pointer shadow-xs group relative"
              title={`Tap to copy ${emoji}`}
            >
              <span>{emoji}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Floating Collector / Multi-Copy Box */}
      <div className="glass-panel rounded-2xl p-3 border border-zinc-800 bg-zinc-950/90 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Emoji Collector:</span>
          {collectedEmojis && (
            <button
              onClick={() => setCollectedEmojis('')}
              className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-base text-white tracking-widest min-h-10 flex items-center overflow-x-auto">
            {collectedEmojis || <span className="text-zinc-500 text-xs tracking-normal">Tap emojis above to collect...</span>}
          </div>

          <button
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
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-zinc-900/95 text-white border border-pink-500/40 shadow-2xl px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Copied:</span>
          <span className="text-base">{toastEmoji}</span>
        </div>
      )}
    </div>
  );
};
