export interface CustomEmojiSlotDef {
  key: string;
  fallback: string;
  label: string;
}

export interface CustomEmojiRule {
  id: string;
  emoji: string;
  customEmojiId: string;
  enabled: boolean;
  label?: string;
  slotKey?: string;
  updatedAt?: string;
}

export const CUSTOM_EMOJI_SLOTS: CustomEmojiSlotDef[] = [
  { key: 'fire', fallback: '🔥', label: 'Fire Header' },
  { key: 'diamond', fallback: '💎', label: 'Diamond / Profile' },
  { key: 'bolt', fallback: '⚡', label: 'Bolt / API' },
  { key: 'id', fallback: '🆔', label: 'UID / ID' },
  { key: 'user', fallback: '👤', label: 'Player / User' },
  { key: 'tag', fallback: '🏷', label: 'Name / Tag' },
  { key: 'globe', fallback: '🌍', label: 'Region / Globe' },
  { key: 'star', fallback: '⭐', label: 'Level / Star' },
  { key: 'like', fallback: '👍', label: 'Likes / Thumbs Up' },
  { key: 'rank', fallback: '🔰', label: 'Battle Royale Rank' },
  { key: 'swords', fallback: '⚔️', label: 'Clash Squad' },
  { key: 'shield', fallback: '🛡', label: 'Shield / Bancheck' },
  { key: 'money', fallback: '💰', label: 'Price / Valuation' },
  { key: 'package', fallback: '📦', label: 'Package / Version' },
  { key: 'calendar', fallback: '📅', label: 'Created Date' },
  { key: 'clock', fallback: '🕒', label: 'Last Login / Time' },
  { key: 'chat', fallback: '💬', label: 'Bio / Message' },
  { key: 'sparkles', fallback: '✨', label: 'Sparkles / Footer' },
  { key: 'heart_black', fallback: '🖤', label: 'Black Heart' },
  { key: 'check', fallback: '✅', label: 'Success / Check' },
  { key: 'cross', fallback: '❌', label: 'Error / Cross' },
  { key: 'warning', fallback: '⚠️', label: 'Warning' },
  { key: 'ban', fallback: '🚫', label: 'Banned' },
  { key: 'siren', fallback: '🚨', label: 'Ban Alert' },
  { key: 'pin', fallback: '📌', label: 'Pin / Type' },
  { key: 'hourglass', fallback: '⏳', label: 'Loading / Duration' },
  { key: 'memo', fallback: '📝', label: 'Reason / Note' },
  { key: 'plus', fallback: '➕', label: 'Likes Added' },
  { key: 'search', fallback: '🔍', label: 'Search / Checking' },
  { key: 'loading', fallback: '🔄', label: 'Syncing' },
  { key: 'info', fallback: 'ℹ️', label: 'Info' },
  { key: 'lock', fallback: '🔒', label: 'Locked / Private' },
  { key: 'mute', fallback: '🔇', label: 'Muted' },
  { key: 'crown', fallback: '👑', label: 'Leader / Owner' },
  { key: 'users', fallback: '👥', label: 'Members' },
  { key: 'wave', fallback: '👋', label: 'Welcome' },
  { key: 'robot', fallback: '🤖', label: 'Bot' },
  { key: 'link', fallback: '🔗', label: 'Link' },
  { key: 'folder', fallback: '📁', label: 'Files' },
  { key: 'trophy', fallback: '🏆', label: 'Trophy / Rank' },
  { key: 'crystal', fallback: '💠', label: 'Points / Tier' }
];

const SLOT_BY_KEY = new Map<string, CustomEmojiSlotDef>();
const SLOT_BY_EMOJI = new Map<string, CustomEmojiSlotDef>();

export function stripVariationSelector(s: string): string {
  return String(s || '').replace(/[\uFE0E\uFE0F]/g, '');
}

for (const slot of CUSTOM_EMOJI_SLOTS) {
  SLOT_BY_KEY.set(slot.key.toLowerCase(), slot);
  SLOT_BY_EMOJI.set(slot.fallback, slot);
  SLOT_BY_EMOJI.set(stripVariationSelector(slot.fallback), slot);
}

export function isValidCustomEmojiId(value: unknown): value is string {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const s = String(value).trim();
  return /^\d{5,30}$/.test(s);
}

export function isValidTargetEmoji(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return false;
  if (/[<>{}\r\n\s]/.test(trimmed)) return false;
  if (/^[\x00-\x7F]+$/.test(trimmed)) return false;
  return true;
}

function makeStableRuleId(emoji: string): string {
  const hex = Buffer.from(stripVariationSelector(emoji), 'utf8').toString('hex').slice(0, 24);
  return `em_${hex || Date.now().toString(36)}`;
}

export function sanitizeCustomEmojiMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || '').trim();
    const id = String(v ?? '').trim();
    if (!key || !isValidCustomEmojiId(id)) continue;
    if (key.length > 64 || /[<>{}\r\n]/.test(key)) continue;
    const normKey = /^[a-z0-9_]+$/i.test(key) ? key.toLowerCase() : stripVariationSelector(key);
    if (!normKey) continue;
    cleaned[normKey] = id;
  }
  return cleaned;
}

export function sanitizeCustomEmojiRules(rawRules: unknown): CustomEmojiRule[] {
  if (!Array.isArray(rawRules)) return [];
  const byNormEmoji = new Map<string, CustomEmojiRule>();

  for (const rawItem of rawRules) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const customEmojiId = String(item.customEmojiId ?? item.emojiId ?? '').trim();
    if (!isValidCustomEmojiId(customEmojiId)) continue;

    const rawSlotKey = typeof item.slotKey === 'string' ? item.slotKey.trim().toLowerCase() : '';
    const slotFromKey = rawSlotKey ? SLOT_BY_KEY.get(rawSlotKey) : undefined;

    let targetEmoji = typeof item.emoji === 'string' ? item.emoji.trim() : '';
    if (!targetEmoji && slotFromKey) {
      targetEmoji = slotFromKey.fallback;
    }
    if (!targetEmoji) continue;

    // Resolve legacy ASCII slot key passed in emoji field if it maps to a known slot
    if (/^[a-z0-9_]+$/i.test(targetEmoji)) {
      const resolvedSlot = SLOT_BY_KEY.get(targetEmoji.toLowerCase());
      if (!resolvedSlot) continue;
      targetEmoji = resolvedSlot.fallback;
    }

    if (!isValidTargetEmoji(targetEmoji)) continue;

    const norm = stripVariationSelector(targetEmoji);
    const slotKeyMatchesEmoji = Boolean(slotFromKey && stripVariationSelector(slotFromKey.fallback) === norm);
    const matchedSlot = (slotKeyMatchesEmoji ? slotFromKey : undefined) || SLOT_BY_EMOJI.get(targetEmoji) || SLOT_BY_EMOJI.get(norm);
    const label = typeof item.label === 'string' && item.label.trim()
      ? item.label.trim().slice(0, 64)
      : matchedSlot?.label;
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim().slice(0, 64)
      : makeStableRuleId(targetEmoji);

    byNormEmoji.set(norm, {
      id,
      emoji: targetEmoji,
      customEmojiId,
      enabled: item.enabled !== false,
      ...(label ? { label } : {}),
      ...(matchedSlot?.key ? { slotKey: matchedSlot.key } : {}),
      updatedAt: typeof item.updatedAt === 'string' && item.updatedAt.trim()
        ? item.updatedAt.trim()
        : new Date().toISOString()
    });
  }

  return Array.from(byNormEmoji.values());
}

export function mergeCustomEmojiRules(
  rawRules: unknown,
  legacyMap?: Record<string, string> | null
): CustomEmojiRule[] {
  if (Array.isArray(rawRules)) {
    return sanitizeCustomEmojiRules(rawRules);
  }

  const cleanedMap = sanitizeCustomEmojiMap(legacyMap);
  const migrated = new Map<string, CustomEmojiRule>();

  for (const [rawKey, customEmojiId] of Object.entries(cleanedMap)) {
    const slot = SLOT_BY_KEY.get(rawKey.toLowerCase()) || SLOT_BY_EMOJI.get(rawKey) || SLOT_BY_EMOJI.get(stripVariationSelector(rawKey));
    const emoji = slot ? slot.fallback : rawKey;
    if (!isValidTargetEmoji(emoji)) continue;
    const norm = stripVariationSelector(emoji);
    migrated.set(norm, {
      id: makeStableRuleId(emoji),
      emoji,
      customEmojiId,
      enabled: true,
      ...(slot?.label ? { label: slot.label } : {}),
      ...(slot?.key ? { slotKey: slot.key } : {}),
      updatedAt: new Date().toISOString()
    });
  }

  return Array.from(migrated.values());
}

export function buildCustomEmojiMapFromRules(rules: CustomEmojiRule[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rule of sanitizeCustomEmojiRules(rules)) {
    if (!rule.enabled) continue;
    const norm = stripVariationSelector(rule.emoji);
    if (norm) {
      map[norm] = rule.customEmojiId;
    }
    const slot = rule.slotKey
      ? SLOT_BY_KEY.get(rule.slotKey.toLowerCase())
      : (SLOT_BY_EMOJI.get(rule.emoji) || SLOT_BY_EMOJI.get(norm));
    if (slot?.key) {
      map[slot.key] = rule.customEmojiId;
    }
  }
  return map;
}

export function getEnvCustomEmojiMap(): Record<string, string> {
  const result: Record<string, string> = {};

  const rawJson = (process.env.CUSTOM_EMOJI_MAP || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      Object.assign(result, sanitizeCustomEmojiMap(parsed));
    } catch {
      // Ignore malformed CUSTOM_EMOJI_MAP env JSON
    }
  }

  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.startsWith('CUSTOM_EMOJI_') || envKey === 'CUSTOM_EMOJI_MAP') continue;
    const slotKey = envKey.slice('CUSTOM_EMOJI_'.length).trim().toLowerCase();
    if (!slotKey || !envVal) continue;
    const cleanId = String(envVal).trim().replace(/^["']|["']$/g, '');
    if (isValidCustomEmojiId(cleanId)) {
      result[slotKey] = cleanId;
    }
  }

  return result;
}

export function getEffectiveCustomEmojiMap(
  settingsMap?: Record<string, string> | null,
  settingsRules?: CustomEmojiRule[] | null
): Record<string, string> {
  const envMap = getEnvCustomEmojiMap();

  if (Array.isArray(settingsRules)) {
    const cleanRules = sanitizeCustomEmojiRules(settingsRules);
    for (const rule of cleanRules) {
      if (!rule.enabled) {
        delete envMap[rule.emoji];
        delete envMap[stripVariationSelector(rule.emoji)];
        if (rule.slotKey) delete envMap[rule.slotKey];
        const matchedSlot = SLOT_BY_EMOJI.get(rule.emoji) || SLOT_BY_EMOJI.get(stripVariationSelector(rule.emoji));
        if (matchedSlot?.key) delete envMap[matchedSlot.key];
      }
    }
    return {
      ...envMap,
      ...buildCustomEmojiMapFromRules(cleanRules)
    };
  }

  const storedMap = sanitizeCustomEmojiMap(settingsMap);
  return {
    ...envMap,
    ...storedMap
  };
}

function escapeEmojiFallbackHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function lookupCustomEmojiId(
  slotOrEmoji: string,
  customMap?: Record<string, string> | null
): string | undefined {
  if (!customMap) return undefined;
  const raw = String(slotOrEmoji || '').trim();
  if (!raw) return undefined;

  const lower = raw.toLowerCase();
  const stripped = stripVariationSelector(raw);
  const slotByKey = SLOT_BY_KEY.get(lower);
  const slotByEmoji = SLOT_BY_EMOJI.get(raw) || SLOT_BY_EMOJI.get(stripped);

  const candidates = [
    raw,
    lower,
    stripped,
    slotByKey?.key,
    slotByKey?.fallback,
    slotByKey ? stripVariationSelector(slotByKey.fallback) : undefined,
    slotByEmoji?.key,
    slotByEmoji?.fallback,
    slotByEmoji ? stripVariationSelector(slotByEmoji.fallback) : undefined
  ].filter((c): c is string => Boolean(c));

  for (const key of candidates) {
    const id = customMap[key];
    if (isValidCustomEmojiId(id)) {
      return id.trim();
    }
  }

  // Fallback: match by variation-selector-stripped key across arbitrary user-added emojis
  for (const [k, v] of Object.entries(customMap)) {
    if (stripVariationSelector(k) === stripped && isValidCustomEmojiId(v)) {
      return v.trim();
    }
  }

  return undefined;
}

/**
 * Formats a single custom emoji slot into Telegram HTML:
 * `<tg-emoji emoji-id="ID">FALLBACK_EMOJI</tg-emoji>` when configured,
 * or the clean fallback emoji otherwise.
 */
export function formatCustomEmoji(
  slotOrEmoji: string,
  fallbackEmoji?: string,
  customMap?: Record<string, string> | null
): string {
  const slotDef =
    SLOT_BY_KEY.get(String(slotOrEmoji || '').trim().toLowerCase()) ||
    SLOT_BY_EMOJI.get(String(slotOrEmoji || '').trim()) ||
    SLOT_BY_EMOJI.get(stripVariationSelector(String(slotOrEmoji || '').trim()));

  const resolvedFallback =
    fallbackEmoji !== undefined && fallbackEmoji !== ''
      ? fallbackEmoji
      : (slotDef?.fallback || slotOrEmoji);

  const customId =
    lookupCustomEmojiId(slotOrEmoji, customMap) ||
    (fallbackEmoji ? lookupCustomEmojiId(fallbackEmoji, customMap) : undefined);

  if (customId) {
    return `<tg-emoji emoji-id="${customId}">${escapeEmojiFallbackHtml(resolvedFallback)}</tg-emoji>`;
  }
  return resolvedFallback;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildEmojiMatchPattern(normEmoji: string): string {
  const codepoints = Array.from(normEmoji);
  return codepoints
    .map((cp) => {
      const esc = escapeRegExp(cp);
      // Consume optional U+FE0E/U+FE0F atomically (cannot backtrack to split ZWJ/modifier sequences)
      if (cp === '\u200D' || cp === '\u20E3' || /^[\u{1F3FB}-\u{1F3FF}]$/u.test(cp)) {
        return esc;
      }
      return `${esc}(?:[\\uFE0E\\uFE0F]|(?![\\uFE0E\\uFE0F]))`;
    })
    .join('');
}

function buildNormalizedEmojiMap(customMap?: Record<string, string> | null): Map<string, string> {
  // Keyed by variation-selector-stripped emoji -> custom_emoji_id
  const normalizedReplacements = new Map<string, string>();
  if (!customMap) return normalizedReplacements;

  for (const [rawKey, rawId] of Object.entries(customMap)) {
    if (!isValidCustomEmojiId(rawId)) continue;
    const cleanId = rawId.trim();
    const slot = SLOT_BY_KEY.get(rawKey.toLowerCase());
    if (slot) {
      const norm = stripVariationSelector(slot.fallback);
      if (norm) normalizedReplacements.set(norm, cleanId);
    } else if (!/^[a-z0-9_]+$/i.test(rawKey) && isValidTargetEmoji(rawKey)) {
      const norm = stripVariationSelector(rawKey.trim());
      if (norm) normalizedReplacements.set(norm, cleanId);
    }
  }
  return normalizedReplacements;
}

function buildEmojiRegex(
  customMap?: Record<string, string> | null,
  globalFlag: boolean = true
): { regex: RegExp; normalizedReplacements: Map<string, string> } | null {
  const normalizedReplacements = buildNormalizedEmojiMap(customMap);
  if (normalizedReplacements.size === 0) return null;

  const sortedNormEmojis = Array.from(normalizedReplacements.keys()).sort(
    (a, b) => Array.from(b).length - Array.from(a).length || b.length - a.length
  );
  if (sortedNormEmojis.length === 0) return null;

  const alternation = sortedNormEmojis.map((e) => buildEmojiMatchPattern(e)).join('|');
  const pattern = `(?<!\\u200D)(?:${alternation})(?![\\u200D\\u20E3\\u{1F3FB}-\\u{1F3FF}])`;
  return {
    regex: new RegExp(pattern, globalFlag ? 'gu' : 'u'),
    normalizedReplacements
  };
}

/**
 * Applies configured custom emoji IDs across an HTML bot message safely without
 * altering HTML tags, attributes, `<code>`/`<pre>` blocks, or existing `<tg-emoji>` tags.
 * Supports ANY mapped target emoji (variation-selector tolerant) and `{emoji:key|fallback}` tokens.
 */
export function applyCustomEmojisToHtml(
  html: string,
  customMap?: Record<string, string> | null
): string {
  if (!html || typeof html !== 'string') return html;

  const hasEmojiPlaceholders = /\{emoji:[a-z0-9_]+(?:\|[^}]*)?\}/i.test(html);
  const compiled = buildEmojiRegex(customMap, true);
  const emojiRegex = compiled?.regex || null;
  const normalizedReplacements = compiled?.normalizedReplacements || new Map<string, string>();

  if (!hasEmojiPlaceholders && normalizedReplacements.size === 0) {
    return html;
  }

  const tokenRegex = /\{emoji:([a-z0-9_]+)(?:\|([^}]*))?\}/gi;

  // Split into HTML tags vs text segments
  const parts = html.split(/(<[^>]+>)/g);
  let tgEmojiDepth = 0;
  let codeDepth = 0;
  let preDepth = 0;
  let anchorDepth = 0;

  return parts
    .map((part) => {
      if (!part) return part;

      if (part.startsWith('<') && part.endsWith('>')) {
        const lower = part.toLowerCase();
        if (/^<tg-emoji\b/.test(lower) && !/\/>$/.test(lower)) {
          tgEmojiDepth++;
        } else if (/^<\/tg-emoji\s*>/.test(lower)) {
          tgEmojiDepth = Math.max(0, tgEmojiDepth - 1);
        } else if (/^<code\b/.test(lower) && !/\/>$/.test(lower)) {
          codeDepth++;
        } else if (/^<\/code\s*>/.test(lower)) {
          codeDepth = Math.max(0, codeDepth - 1);
        } else if (/^<pre\b/.test(lower) && !/\/>$/.test(lower)) {
          preDepth++;
        } else if (/^<\/pre\s*>/.test(lower)) {
          preDepth = Math.max(0, preDepth - 1);
        } else if (/^<a\b/.test(lower) && !/\/>$/.test(lower)) {
          anchorDepth++;
        } else if (/^<\/a\s*>/.test(lower)) {
          anchorDepth = Math.max(0, anchorDepth - 1);
        }
        return part;
      }

      if (tgEmojiDepth > 0 || codeDepth > 0 || preDepth > 0 || anchorDepth > 0) {
        return part;
      }

      const replacePlainEmojis = (segment: string): string => {
        if (!emojiRegex || !segment) return segment;
        emojiRegex.lastIndex = 0;
        return segment.replace(emojiRegex, (matchedEmoji) => {
          const customId = normalizedReplacements.get(stripVariationSelector(matchedEmoji));
          if (!customId) return matchedEmoji;
          return `<tg-emoji emoji-id="${customId}">${escapeEmojiFallbackHtml(matchedEmoji)}</tg-emoji>`;
        });
      };

      if (!hasEmojiPlaceholders) {
        return replacePlainEmojis(part);
      }

      // Single-pass: expand {emoji:key|fallback} tokens without re-processing their output
      let out = '';
      let lastIdx = 0;
      tokenRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = tokenRegex.exec(part)) !== null) {
        if (match.index > lastIdx) {
          out += replacePlainEmojis(part.slice(lastIdx, match.index));
        }
        out += formatCustomEmoji(match[1], match[2], customMap);
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < part.length) {
        out += replacePlainEmojis(part.slice(lastIdx));
      }
      return out;
    })
    .join('');
}

/**
 * Attaches Telegram `custom_emoji` entities for non-HTML / entity-formatted messages
 * without mutating `text` or shifting any existing entity UTF-16 offsets.
 */
export function applyCustomEmojisToEntities<T extends Record<string, any>>(
  text: string,
  existingEntities?: T[] | null,
  customMap?: Record<string, string> | null
): { entities: T[]; addedCount: number } {
  const baseEntities = Array.isArray(existingEntities) ? existingEntities.map((e) => ({ ...e })) : [];
  if (!text || typeof text !== 'string') {
    return { entities: baseEntities, addedCount: 0 };
  }

  const compiled = buildEmojiRegex(customMap, true);
  if (!compiled) {
    return { entities: baseEntities, addedCount: 0 };
  }

  const protectedTypes = new Set(['custom_emoji', 'code', 'pre', 'url', 'text_link']);
  const protectedRanges = baseEntities
    .filter((e) => e && typeof e.type === 'string' && protectedTypes.has(e.type) && Number.isFinite(e.offset) && Number(e.length) > 0)
    .map((e) => ({ start: Number(e.offset), end: Number(e.offset) + Number(e.length) }));

  const added: any[] = [];
  compiled.regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = compiled.regex.exec(text)) !== null) {
    const start = match.index;
    const length = match[0].length;
    const end = start + length;
    const customEmojiId = compiled.normalizedReplacements.get(stripVariationSelector(match[0]));
    if (!customEmojiId || length <= 0) continue;

    const overlapsProtected = protectedRanges.some((r) => r.start < end && r.end > start);
    if (overlapsProtected) continue;

    added.push({
      type: 'custom_emoji',
      offset: start,
      length,
      custom_emoji_id: customEmojiId
    });
  }

  if (added.length === 0) {
    return { entities: baseEntities, addedCount: 0 };
  }

  const combined = [...baseEntities, ...added].sort((a: any, b: any) => (a.offset ?? 0) - (b.offset ?? 0));
  return { entities: combined as T[], addedCount: added.length };
}

export function stripCustomEmojiTags(html: string): string {
  if (!html || typeof html !== 'string') return html;
  return html.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1');
}

/**
 * Ensures inline/reply keyboard button labels never contain `<tg-emoji>` HTML markup
 * or raw `{emoji:key}` placeholders, preserving clean Unicode fallback text compatible
 * with Telegram Bot API button `text`.
 */
export function sanitizeButtonLabel(label: string): string {
  if (typeof label !== 'string') return '';
  let out = stripCustomEmojiTags(label);
  out = out.replace(/<\/?tg-emoji\b[^>]*>/gi, '');
  out = out.replace(/&lt;tg-emoji\b[\s\S]*?&gt;([\s\S]*?)&lt;\/tg-emoji&gt;/gi, '$1');
  out = out.replace(/&lt;\/?tg-emoji\b[\s\S]*?&gt;/gi, '');
  out = out.replace(/\{emoji:([a-z0-9_]+)(?:\|([^}]*))?\}/gi, (_match, rawKey, rawFallback) => {
    if (typeof rawFallback === 'string' && rawFallback.trim()) {
      return rawFallback.trim();
    }
    const slot = SLOT_BY_KEY.get(String(rawKey || '').trim().toLowerCase());
    return slot?.fallback || '';
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}

export interface TelegramButtonLike {
  text: string;
  icon_custom_emoji_id?: string;
  style?: string;
  [key: string]: any;
}

function extractButtonEmojiMatch(
  cleanText: string,
  customMap?: Record<string, string> | null
): { customEmojiId: string; strippedText: string; matchedEmoji: string } | null {
  if (!cleanText || !customMap) return null;
  const compiled = buildEmojiRegex(customMap, false);
  if (!compiled) return null;

  const match = compiled.regex.exec(cleanText);
  if (!match || typeof match.index !== 'number') return null;

  const matchedEmoji = match[0];
  const customEmojiId = compiled.normalizedReplacements.get(stripVariationSelector(matchedEmoji));
  if (!customEmojiId) return null;

  const before = cleanText.slice(0, match.index);
  const after = cleanText.slice(match.index + matchedEmoji.length);
  const needsSpace =
    before.length > 0 &&
    after.length > 0 &&
    !/\s$/.test(before) &&
    !/^\s/.test(after) &&
    !/[([{"'“‘]$/.test(before) &&
    !/^[)\]}"'.,!?:;”’]/.test(after);
  const remainder = `${before}${needsSpace ? ' ' : ''}${after}`.replace(/\s{2,}/g, ' ').trim();

  return {
    customEmojiId,
    matchedEmoji,
    strippedText: remainder || matchedEmoji
  };
}

/**
 * Builds an InlineKeyboardButton object, sanitizing `<tg-emoji>` tags and automatically
 * attaching `icon_custom_emoji_id` when the button label contains any mapped emoji in
 * Emoji Store (at start, middle, or end), removing that matched Unicode emoji from `text`.
 */
export function buildInlineKeyboardButton<T extends Record<string, any>>(
  btn: T,
  customMap?: Record<string, string> | null
): T {
  if (!btn || typeof btn !== 'object') return btn;
  if (typeof btn.text !== 'string') return btn;

  const cleanText = sanitizeButtonLabel(btn.text);
  const existingIconId = typeof btn.icon_custom_emoji_id === 'string' ? btn.icon_custom_emoji_id.trim() : '';
  if (isValidCustomEmojiId(existingIconId)) {
    return {
      ...btn,
      text: cleanText,
      icon_custom_emoji_id: existingIconId
    };
  }

  const matched = extractButtonEmojiMatch(cleanText, customMap);
  if (matched) {
    return {
      ...btn,
      text: matched.strippedText,
      icon_custom_emoji_id: matched.customEmojiId
    };
  }

  if ('icon_custom_emoji_id' in btn) {
    const { icon_custom_emoji_id: _unused, ...rest } = btn as any;
    return { ...rest, text: cleanText } as T;
  }

  return { ...btn, text: cleanText };
}

/**
 * Builds a KeyboardButton (string or object), sanitizing `<tg-emoji>` tags and automatically
 * upgrading to a KeyboardButton object with `icon_custom_emoji_id` when mapped in Emoji Store.
 */
export function buildReplyKeyboardButton<T extends string | Record<string, any>>(
  btn: T,
  customMap?: Record<string, string> | null
): T extends string ? string | TelegramButtonLike : T {
  if (typeof btn === 'string') {
    const cleanText = sanitizeButtonLabel(btn);
    const matched = extractButtonEmojiMatch(cleanText, customMap);
    if (matched) {
      return {
        text: matched.strippedText,
        icon_custom_emoji_id: matched.customEmojiId
      } as any;
    }
    return cleanText as any;
  }

  if (!btn || typeof btn !== 'object' || typeof btn.text !== 'string') {
    return btn as any;
  }

  return buildInlineKeyboardButton(btn, customMap) as any;
}

/**
 * Convenience button builder for both InlineKeyboardButton and KeyboardButton inputs.
 */
export function buildTelegramButton<T extends string | Record<string, any>>(
  btnOrText: T,
  customMap?: Record<string, string> | null
): T extends string ? string | TelegramButtonLike : T {
  if (typeof btnOrText === 'string') {
    return buildReplyKeyboardButton(btnOrText, customMap);
  }
  return buildInlineKeyboardButton(btnOrText, customMap) as any;
}

/**
 * Sanitizes all `text` fields inside `reply_markup.inline_keyboard` and `reply_markup.keyboard`
 * so raw `<tg-emoji>` tags are never sent in Telegram button labels, preserves any existing
 * `icon_custom_emoji_id`, and optionally attaches `icon_custom_emoji_id` from `customMap`.
 */
export function sanitizeReplyMarkupForTelegram<T>(
  replyMarkup: T,
  customMap?: Record<string, string> | null
): T {
  if (!replyMarkup) return replyMarkup;

  const isString = typeof replyMarkup === 'string';
  let parsed: any = replyMarkup;
  if (isString) {
    try {
      parsed = JSON.parse(replyMarkup as unknown as string);
    } catch {
      return replyMarkup;
    }
  }

  if (!parsed || typeof parsed !== 'object') return replyMarkup;

  const next: any = { ...parsed };
  if (Array.isArray(parsed.inline_keyboard)) {
    next.inline_keyboard = parsed.inline_keyboard.map((row: any) =>
      Array.isArray(row)
        ? row.map((btn: any) => buildInlineKeyboardButton(btn, customMap))
        : row
    );
  }
  if (Array.isArray(parsed.keyboard)) {
    next.keyboard = parsed.keyboard.map((row: any) =>
      Array.isArray(row)
        ? row.map((btn: any) => buildReplyKeyboardButton(btn, customMap))
        : row
    );
  }

  return isString ? (JSON.stringify(next) as unknown as T) : next;
}

export const applyCustomEmojisToReplyMarkup = sanitizeReplyMarkupForTelegram;

export function replyMarkupHasIconCustomEmoji(replyMarkup: any): boolean {
  if (!replyMarkup) return false;
  let parsed: any = replyMarkup;
  if (typeof replyMarkup === 'string') {
    try {
      parsed = JSON.parse(replyMarkup);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== 'object') return false;

  const checkRows = (rows: any): boolean =>
    Array.isArray(rows) &&
    rows.some(
      (row: any) =>
        Array.isArray(row) &&
        row.some((btn: any) => btn && typeof btn === 'object' && typeof btn.icon_custom_emoji_id === 'string' && btn.icon_custom_emoji_id.length > 0)
    );

  return checkRows(parsed.inline_keyboard) || checkRows(parsed.keyboard);
}

export function stripIconCustomEmojiFromReplyMarkup<T>(
  replyMarkup: T,
  fallbackReplyMarkup?: any
): T {
  const source = fallbackReplyMarkup || replyMarkup;
  if (!source) return source as T;

  const isString = typeof source === 'string';
  let parsed: any = source;
  if (isString) {
    try {
      parsed = JSON.parse(source as unknown as string);
    } catch {
      return source as T;
    }
  }
  if (!parsed || typeof parsed !== 'object') return source as T;

  let currentParsed: any = replyMarkup;
  if (typeof replyMarkup === 'string') {
    try {
      currentParsed = JSON.parse(replyMarkup);
    } catch {
      currentParsed = null;
    }
  }

  const preserveStyleFromCurrent = (rowsKey: 'inline_keyboard' | 'keyboard', rows: any[]): any[] =>
    rows.map((row: any, rIdx: number) =>
      Array.isArray(row)
        ? row.map((btn: any, bIdx: number) => {
            if (!btn || typeof btn !== 'object') return btn;
            const { icon_custom_emoji_id: _removed, ...rest } = btn;
            if (currentParsed && Array.isArray(currentParsed[rowsKey]?.[rIdx])) {
              const currBtn = currentParsed[rowsKey][rIdx][bIdx];
              if (currBtn && typeof currBtn === 'object' && !('style' in currBtn) && 'style' in rest) {
                const { style: _strippedStyle, ...withoutStyle } = rest;
                return withoutStyle;
              }
            }
            return rest;
          })
        : row
    );

  const next: any = { ...parsed };
  if (Array.isArray(parsed.inline_keyboard)) {
    next.inline_keyboard = preserveStyleFromCurrent('inline_keyboard', parsed.inline_keyboard);
  }
  if (Array.isArray(parsed.keyboard)) {
    next.keyboard = preserveStyleFromCurrent('keyboard', parsed.keyboard);
  }

  return isString ? (JSON.stringify(next) as unknown as T) : next;
}
