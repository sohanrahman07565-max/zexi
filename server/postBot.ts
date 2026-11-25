import { storage } from './storage';

type CallTelegramApiFn = (method: string, body?: any, tokenOverride?: string) => Promise<any>;
type IsAdminFn = (userId: string, username?: string) => Promise<boolean>;

interface PostDraft {
  phase: string;
  type: string;
  fileId: string | null;
  fileName?: string;
  caption: string;
  entities: any[];
  buttons: Array<{ text: string; url: string; row: number; style?: string }>;
  active: { text: string; url: string; row: number; style?: string } | null;
  editIndex: number | null;
  wizardId: number | null;
  userIds: number[];
  targetMessageId: number | null;
  originalType: string | null;
  originalFileId: string | null;
}

const MAX_BUTTONS = 40;
const MAX_ROWS = 8;
const MAX_PER_ROW = 8;

const drafts = new Map<string, PostDraft>();

function fresh(): PostDraft {
  return {
    phase: 'idle',
    type: 'text',
    fileId: null,
    caption: '',
    entities: [],
    buttons: [],
    active: null,
    editIndex: null,
    wizardId: null,
    userIds: [],
    targetMessageId: null,
    originalType: null,
    originalFileId: null
  };
}

function draftKey(botId: string, uid: string | number): string {
  return `${botId}:${String(uid)}`;
}

function getDraft(botId: string, uid: string | number): PostDraft {
  const k = draftKey(botId, uid);
  if (!drafts.has(k)) drafts.set(k, fresh());
  return drafts.get(k)!;
}

function resetDraft(botId: string, uid: string | number): void {
  drafts.set(draftKey(botId, uid), fresh());
}

function baseKeys() {
  return { inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]] };
}

function validUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function grouped(buttons: Array<{ text: string; url: string; row: number; style?: string }>) {
  const m = new Map<number, any[]>();
  for (const b of buttons) {
    if (!m.has(b.row)) m.set(b.row, []);
    const button: any = { text: b.text, url: b.url };
    if (b.style && b.style !== 'default') button.style = b.style;
    m.get(b.row)!.push(button);
  }
  return [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k)!);
}

function listButtons(d: PostDraft): string {
  return d.buttons.length
    ? d.buttons.map((b, i) => `${i + 1}. [Row ${b.row}] ${b.text}\n   ${b.url}`).join('\n')
    : '(No buttons added yet)';
}

function editKeys(d: PostDraft) {
  const rows: any[][] = [
    [
      { text: 'Edit media', callback_data: 'edit_media' },
      { text: 'Edit caption/text', callback_data: 'edit_caption' }
    ],
    [{ text: 'Add button', callback_data: 'add_button' }]
  ];
  d.buttons.forEach((b, i) =>
    rows.push([
      { text: `Edit ${i + 1}: ${b.text}`.slice(0, 60), callback_data: `edit_button:${i}` },
      { text: 'Delete', callback_data: `delete_button:${i}` }
    ])
  );
  rows.push([{ text: 'Back to preview', callback_data: 'preview' }]);
  rows.push([
    { text: 'Delete draft', callback_data: 'delete_draft' },
    { text: 'Cancel', callback_data: 'cancel' }
  ]);
  return { inline_keyboard: rows };
}

function styleKeyboard(markup: any) {
  if (!markup || !Array.isArray(markup.inline_keyboard)) return markup;
  markup.inline_keyboard = markup.inline_keyboard.map((row: any[]) =>
    row.map((button: any) => {
      const action = String(button.callback_data || '').toLowerCase();
      const label = String(button.text || '').toLowerCase();
      let style = button.style || 'primary';
      if (!button.style && (action.includes('cancel') || action.includes('delete') || label.includes('cancel') || label.includes('delete'))) {
        style = 'danger';
      } else if (!button.style && (action === 'publish' || label.includes('publish') || label.includes('confirm'))) {
        style = 'success';
      }
      return { ...button, style };
    })
  );
  return markup;
}

const PASSIVE_AUTO_ENTITY_TYPES = new Set([
  'url',
  'mention',
  'hashtag',
  'cashtag',
  'bot_command',
  'email',
  'phone_number'
]);

const PROTECTED_ENTITY_TYPES = new Set(['code', 'pre', 'text_link']);

function sanitizeTelegramEntities(entities: any): any[] {
  if (!Array.isArray(entities)) return [];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const e of entities) {
    if (!e || typeof e.type !== 'string' || !Number.isFinite(Number(e.offset)) || Number(e.length) <= 0) {
      continue;
    }
    const clean: any = {
      type: String(e.type),
      offset: Math.max(0, Number(e.offset)),
      length: Number(e.length)
    };
    if (typeof e.url === 'string' && e.url.trim()) clean.url = e.url.trim();
    if (typeof e.language === 'string' && e.language.trim()) clean.language = e.language.trim();
    if (typeof e.custom_emoji_id === 'string' && e.custom_emoji_id.trim()) clean.custom_emoji_id = e.custom_emoji_id.trim();
    if (e.user && typeof e.user === 'object') clean.user = e.user;
    const key = `${clean.type}:${clean.offset}:${clean.length}:${clean.url || ''}:${clean.language || ''}:${clean.custom_emoji_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function isAllowedEntityUrl(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/^tg:\/\//i.test(s)) return true;
  return validUrl(s);
}

export interface ParsedFormattedPost {
  text: string;
  entities: any[];
}

interface ParsedPlainSegment extends ParsedFormattedPost {
  outPos: number[];
}

function parsePlainSegmentWithMarkup(
  raw: string,
  allowHtmlAndMarkdown: boolean
): ParsedPlainSegment {
  const outPos = new Array<number>(raw.length + 1);
  if (!raw || !allowHtmlAndMarkdown) {
    for (let k = 0; k <= raw.length; k++) outPos[k] = k;
    return { text: raw, entities: [], outPos };
  }

  const hasAnyHtmlTags = /<\/?(?:a|code|pre|b|strong|i|em|u|ins|s|strike|del|tg-spoiler|blockquote)\b[^>]*>/i.test(raw);
  outPos[0] = 0;

  const fillRangeLinear = (rawStart: number, rawEnd: number, outStart: number, outEnd: number) => {
    const rawLen = Math.max(1, rawEnd - rawStart);
    const outLen = Math.max(0, outEnd - outStart);
    for (let p = rawStart; p <= rawEnd; p++) {
      if (p === rawStart) {
        outPos[p] = outStart;
      } else if (p === rawEnd) {
        outPos[p] = outEnd;
      } else {
        outPos[p] = outStart + Math.floor(((p - rawStart) * outLen) / rawLen);
      }
    }
  };

  const fillConst = (rawStart: number, rawEnd: number, outVal: number) => {
    for (let p = rawStart; p <= rawEnd; p++) {
      outPos[p] = outVal;
    }
  };

  // Recursive inline/block parser that emits plain text, exact UTF-16 Telegram MessageEntity offsets,
  // and monotonic boundary offset mapping back to `raw`.
  const parseSpan = (input: string, rawBase: number, startOffset: number): { text: string; entities: any[] } => {
    let out = '';
    const ents: any[] = [];
    let i = 0;

    while (i < input.length) {
      const rest = input.slice(i);
      const tokenRawStart = rawBase + i;
      const curOut = startOffset + out.length;

      // 1. Fenced triple-backtick code block: ```lang\n...\n``` or ```...```
      const preFenceMatch = rest.match(/^```(?:([a-zA-Z0-9_+-]+)[ \t]*\n)?([\s\S]+?)```/);
      if (preFenceMatch) {
        const lang = preFenceMatch[1] ? preFenceMatch[1].trim() : undefined;
        let codeBody = preFenceMatch[2];
        const prefixLen = preFenceMatch[0].indexOf(codeBody);
        let leadingTrim = 0;
        if (codeBody.startsWith('\n') && !lang) {
          codeBody = codeBody.slice(1);
          leadingTrim = 1;
        }
        if (codeBody.endsWith('\n')) codeBody = codeBody.slice(0, -1);
        const innerRawStart = tokenRawStart + prefixLen + leadingTrim;
        const innerRawEnd = innerRawStart + codeBody.length;
        const tokenRawEnd = tokenRawStart + preFenceMatch[0].length;
        const offset = curOut;
        fillConst(tokenRawStart, innerRawStart, offset);
        out += codeBody;
        fillRangeLinear(innerRawStart, innerRawEnd, offset, offset + codeBody.length);
        fillConst(innerRawEnd, tokenRawEnd, offset + codeBody.length);
        if (codeBody.length > 0) {
          ents.push({
            type: 'pre',
            offset,
            length: codeBody.length,
            ...(lang ? { language: lang } : {})
          });
        }
        i += preFenceMatch[0].length;
        continue;
      }

      // 2. Inline code backticks: `code`
      const inlineCodeMatch = rest.match(/^`([^`\n]+)`/);
      if (inlineCodeMatch) {
        const body = inlineCodeMatch[1];
        const offset = curOut;
        const tokenRawEnd = tokenRawStart + inlineCodeMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 1, offset);
        out += body;
        fillRangeLinear(tokenRawStart + 1, tokenRawStart + 1 + body.length, offset, offset + body.length);
        fillConst(tokenRawStart + 1 + body.length, tokenRawEnd, offset + body.length);
        if (body.length > 0) {
          ents.push({ type: 'code', offset, length: body.length });
        }
        i += inlineCodeMatch[0].length;
        continue;
      }

      // 3. HTML <pre>...</pre> and <code>...</code> (non-nested inside code)
      const htmlPreMatch = rest.match(/^<pre(?:\s+class=(?:"language-([^"]+)"|'language-([^']+)'))?\s*>([\s\S]*?)<\/pre>/i);
      if (htmlPreMatch) {
        const lang = (htmlPreMatch[1] || htmlPreMatch[2] || '').trim() || undefined;
        const innerRaw = htmlPreMatch[3];
        const openEnd = htmlPreMatch[0].indexOf(innerRaw);
        const inner = decodeBasicHtmlEntities(innerRaw.replace(/^<code>([\s\S]*)<\/code>$/i, '$1'));
        const offset = curOut;
        const tokenRawEnd = tokenRawStart + htmlPreMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + openEnd, offset);
        out += inner;
        fillRangeLinear(tokenRawStart + openEnd, tokenRawStart + openEnd + innerRaw.length, offset, offset + inner.length);
        fillConst(tokenRawStart + openEnd + innerRaw.length, tokenRawEnd, offset + inner.length);
        if (inner.length > 0) {
          ents.push({
            type: 'pre',
            offset,
            length: inner.length,
            ...(lang ? { language: lang } : {})
          });
        }
        i += htmlPreMatch[0].length;
        continue;
      }

      const htmlCodeMatch = rest.match(/^<code\s*>([\s\S]*?)<\/code>/i);
      if (htmlCodeMatch) {
        const innerRaw = htmlCodeMatch[1];
        const openEnd = htmlCodeMatch[0].indexOf(innerRaw);
        const inner = decodeBasicHtmlEntities(innerRaw);
        const offset = curOut;
        const tokenRawEnd = tokenRawStart + htmlCodeMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + openEnd, offset);
        out += inner;
        fillRangeLinear(tokenRawStart + openEnd, tokenRawStart + openEnd + innerRaw.length, offset, offset + inner.length);
        fillConst(tokenRawStart + openEnd + innerRaw.length, tokenRawEnd, offset + inner.length);
        if (inner.length > 0) {
          ents.push({ type: 'code', offset, length: inner.length });
        }
        i += htmlCodeMatch[0].length;
        continue;
      }

      // 4. HTML <a href="...">Click Here</a>
      const htmlLinkMatch = rest.match(/^<a\s+href=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/a>/i);
      if (htmlLinkMatch) {
        const rawHref = decodeBasicHtmlEntities((htmlLinkMatch[1] || htmlLinkMatch[2] || '').trim());
        if (isAllowedEntityUrl(rawHref)) {
          const offset = curOut;
          const openTagLen = htmlLinkMatch[0].indexOf('>') + 1;
          const innerRaw = htmlLinkMatch[3];
          const tokenRawEnd = tokenRawStart + htmlLinkMatch[0].length;
          fillConst(tokenRawStart, tokenRawStart + openTagLen, offset);
          const nested = parseSpan(innerRaw, tokenRawStart + openTagLen, offset);
          out += nested.text;
          ents.push(...nested.entities);
          fillConst(tokenRawStart + openTagLen + innerRaw.length, tokenRawEnd, offset + nested.text.length);
          if (nested.text.length > 0) {
            ents.push({ type: 'text_link', offset, length: nested.text.length, url: rawHref });
          }
          i += htmlLinkMatch[0].length;
          continue;
        }
      }

      // 5. Other HTML formatting tags (<b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>, <tg-spoiler>, <blockquote>)
      const htmlTagMatch = rest.match(
        /^<(b|strong|i|em|u|ins|s|strike|del|tg-spoiler|blockquote)\s*>([\s\S]*?)<\/\1\s*>/i
      );
      if (htmlTagMatch) {
        const tag = htmlTagMatch[1].toLowerCase();
        const typeMap: Record<string, string> = {
          b: 'bold',
          strong: 'bold',
          i: 'italic',
          em: 'italic',
          u: 'underline',
          ins: 'underline',
          s: 'strikethrough',
          strike: 'strikethrough',
          del: 'strikethrough',
          'tg-spoiler': 'spoiler',
          blockquote: 'blockquote'
        };
        const entityType = typeMap[tag];
        const offset = curOut;
        const openTagLen = htmlTagMatch[0].indexOf('>') + 1;
        const innerRaw = htmlTagMatch[2];
        const tokenRawEnd = tokenRawStart + htmlTagMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + openTagLen, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + openTagLen, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + openTagLen + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (entityType && nested.text.length > 0) {
          ents.push({ type: entityType, offset, length: nested.text.length });
        }
        i += htmlTagMatch[0].length;
        continue;
      }

      // 6. Markdown hyperlink: [Click Here](https://...)
      const mdLinkMatch = rest.match(/^\[([^\]\n]+)\]\(((?:https?:\/\/|tg:\/\/)[^\s)]+)\)/);
      if (mdLinkMatch && isAllowedEntityUrl(mdLinkMatch[2])) {
        const offset = curOut;
        const innerRaw = mdLinkMatch[1];
        const tokenRawEnd = tokenRawStart + mdLinkMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 1, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + 1, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + 1 + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (nested.text.length > 0) {
          ents.push({ type: 'text_link', offset, length: nested.text.length, url: mdLinkMatch[2].trim() });
        }
        i += mdLinkMatch[0].length;
        continue;
      }

      // 7. Markdown inline styles: **bold**, __italic__, ~~strike~~, ||spoiler||
      const mdBoldMatch = rest.match(/^\*\*([^\n*](?:[\s\S]*?[^\n*])?)\*\*/);
      if (mdBoldMatch) {
        const offset = curOut;
        const innerRaw = mdBoldMatch[1];
        const tokenRawEnd = tokenRawStart + mdBoldMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 2, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + 2, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + 2 + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (nested.text.length > 0) {
          ents.push({ type: 'bold', offset, length: nested.text.length });
        }
        i += mdBoldMatch[0].length;
        continue;
      }

      const mdItalicMatch = rest.match(/^__([^\n_](?:[\s\S]*?[^\n_])?)__/);
      if (mdItalicMatch) {
        const offset = curOut;
        const innerRaw = mdItalicMatch[1];
        const tokenRawEnd = tokenRawStart + mdItalicMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 2, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + 2, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + 2 + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (nested.text.length > 0) {
          ents.push({ type: 'italic', offset, length: nested.text.length });
        }
        i += mdItalicMatch[0].length;
        continue;
      }

      const mdStrikeMatch = rest.match(/^~~([^\n~](?:[\s\S]*?[^\n~])?)~~/);
      if (mdStrikeMatch) {
        const offset = curOut;
        const innerRaw = mdStrikeMatch[1];
        const tokenRawEnd = tokenRawStart + mdStrikeMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 2, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + 2, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + 2 + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (nested.text.length > 0) {
          ents.push({ type: 'strikethrough', offset, length: nested.text.length });
        }
        i += mdStrikeMatch[0].length;
        continue;
      }

      const mdSpoilerMatch = rest.match(/^\|\|([^\n|](?:[\s\S]*?[^\n|])?)\|\|/);
      if (mdSpoilerMatch) {
        const offset = curOut;
        const innerRaw = mdSpoilerMatch[1];
        const tokenRawEnd = tokenRawStart + mdSpoilerMatch[0].length;
        fillConst(tokenRawStart, tokenRawStart + 2, offset);
        const nested = parseSpan(innerRaw, tokenRawStart + 2, offset);
        out += nested.text;
        ents.push(...nested.entities);
        fillConst(tokenRawStart + 2 + innerRaw.length, tokenRawEnd, offset + nested.text.length);
        if (nested.text.length > 0) {
          ents.push({ type: 'spoiler', offset, length: nested.text.length });
        }
        i += mdSpoilerMatch[0].length;
        continue;
      }

      if (hasAnyHtmlTags) {
        const htmlCharRef = rest.match(/^(&amp;|&lt;|&gt;|&quot;|&#39;)/);
        if (htmlCharRef) {
          const decoded = decodeBasicHtmlEntities(htmlCharRef[1]);
          out += decoded;
          fillRangeLinear(tokenRawStart, tokenRawStart + htmlCharRef[1].length, curOut, curOut + decoded.length);
          i += htmlCharRef[1].length;
          continue;
        }
      }

      outPos[tokenRawStart] = curOut;
      out += input[i];
      outPos[tokenRawStart + 1] = curOut + 1;
      i += 1;
    }

    return { text: out, entities: ents };
  };

  const result = parseSpan(raw, 0, 0);
  outPos[raw.length] = result.text.length;
  return { ...result, outPos };
}

export function normalizePostFormatting(rawText: string, incomingEntities?: any[]): ParsedFormattedPost {
  const cleanText = typeof rawText === 'string' ? rawText : '';
  const cleanIncoming = sanitizeTelegramEntities(incomingEntities);

  const hasMarkupSyntax =
    /`[^`\n]+`|```[\s\S]+?```|\[[^\]\n]+\]\((?:https?:\/\/|tg:\/\/)[^\s)]+\)|<(?:a\s+href=|code>|pre(?:\s+class=|\/?>)|b>|strong>|i>|em>|u>|ins>|s>|strike>|del>|tg-spoiler>|blockquote>)/i.test(
      cleanText
    );

  // If no markup syntax is present at all, preserve ALL native Telegram entities as-is cleanly.
  if (!hasMarkupSyntax) {
    return {
      text: cleanText,
      entities: cleanIncoming
    };
  }

  // Keep non-passive native entities that might coexist (excluding passive auto-detected URLs
  // that Telegram creates on raw [Click Here](https://...) or <a href="..."> inputs).
  const richIncoming = cleanIncoming.filter((e) => !PASSIVE_AUTO_ENTITY_TYPES.has(e.type));

  if (richIncoming.length === 0) {
    const parsed = parsePlainSegmentWithMarkup(cleanText, true);
    return {
      text: parsed.text,
      entities: sanitizeTelegramEntities(parsed.entities)
    };
  }

  // If the incoming message ALREADY uses native Telegram code/pre/text_link entities covering the
  // rich sections, do not strip backticks/tags inside those protected entities; only parse outside them.
  const protectedRanges = richIncoming
    .filter((e) => PROTECTED_ENTITY_TYPES.has(e.type))
    .map((e) => ({ start: Math.max(0, e.offset), end: Math.min(cleanText.length, e.offset + e.length) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping protected ranges
  const mergedProtected: Array<{ start: number; end: number }> = [];
  for (const r of protectedRanges) {
    const last = mergedProtected[mergedProtected.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      mergedProtected.push({ ...r });
    }
  }

  // Split text into protected (verbatim) and unprotected (parse markup) chunks, mapping UTF-16 offsets
  const chunks: Array<{ start: number; end: number; protected: boolean }> = [];
  let cursor = 0;
  for (const pr of mergedProtected) {
    if (pr.start > cursor) chunks.push({ start: cursor, end: pr.start, protected: false });
    chunks.push({ start: pr.start, end: pr.end, protected: true });
    cursor = pr.end;
  }
  if (cursor < cleanText.length) {
    chunks.push({ start: cursor, end: cleanText.length, protected: false });
  }

  let builtText = '';
  const builtEntities: any[] = [];
  const globalOutPos = new Array<number>(cleanText.length + 1).fill(0);

  for (const ch of chunks) {
    const slice = cleanText.slice(ch.start, ch.end);
    const outStart = builtText.length;
    if (ch.protected) {
      builtText += slice;
      for (let p = 0; p <= slice.length; p++) {
        globalOutPos[ch.start + p] = outStart + p;
      }
    } else {
      const parsed = parsePlainSegmentWithMarkup(slice, true);
      builtText += parsed.text;
      for (let p = 0; p <= slice.length; p++) {
        globalOutPos[ch.start + p] = outStart + (parsed.outPos[p] ?? parsed.text.length);
      }
      for (const e of parsed.entities) {
        builtEntities.push({ ...e, offset: e.offset + outStart });
      }
    }
  }
  globalOutPos[cleanText.length] = builtText.length;

  // Remap ALL native rich entities (text_link, code, pre, bold, italic, custom_emoji, blockquote, etc.)
  for (const e of richIncoming) {
    const rawStart = Math.max(0, Math.min(cleanText.length, e.offset));
    const rawEnd = Math.max(rawStart, Math.min(cleanText.length, e.offset + e.length));
    const mappedStart = globalOutPos[rawStart];
    const mappedEnd = globalOutPos[rawEnd];
    if (mappedStart !== undefined && mappedEnd !== undefined && mappedEnd > mappedStart) {
      builtEntities.push({ ...e, offset: mappedStart, length: mappedEnd - mappedStart });
    }
  }

  return {
    text: builtText,
    entities: sanitizeTelegramEntities(builtEntities)
  };
}

export class PostBotEngine {
  public static async handleUpdate(
    update: any,
    botId: string,
    deps: {
      callTelegramApi: CallTelegramApiFn;
      isAuthorizedAdmin: IsAdminFn;
    }
  ): Promise<void> {
    const { callTelegramApi, isAuthorizedAdmin } = deps;

    const sendMessage = async (chatId: string | number, text: string, opts: any = {}) => {
      const res = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: null,
        ...opts
      });
      if (!res?.ok) {
        throw new Error(res?.description || 'sendMessage failed');
      }
      return res.result;
    };

    const editMessageText = async (text: string, opts: any = {}) => {
      const res = await callTelegramApi('editMessageText', {
        text,
        parse_mode: null,
        ...opts
      });
      if (!res?.ok) {
        throw new Error(res?.description || 'editMessageText failed');
      }
      return res.result;
    };

    const delMsg = async (chat: string | number, id: number): Promise<boolean> => {
      try {
        const res = await callTelegramApi('deleteMessage', { chat_id: chat, message_id: id });
        return Boolean(res?.ok);
      } catch (e: any) {
        console.warn(`Could not delete message ${id}: ${e?.message || e}`);
        return false;
      }
    };

    const clearReplies = async (chat: string | number, d: PostDraft) => {
      const ids = [...new Set(d.userIds)];
      const failed: number[] = [];
      for (const id of ids) {
        if (!(await delMsg(chat, id))) failed.push(id);
      }
      d.userIds = failed;
    };

    const wizard = async (
      chat: string | number,
      d: PostDraft,
      text: string,
      markup: any = baseKeys(),
      entities?: any[]
    ) => {
      markup = styleKeyboard(markup);
      const cleanEntities = sanitizeTelegramEntities(entities);
      const entityOpt = cleanEntities.length ? { entities: cleanEntities } : {};
      if (!d.wizardId) {
        const m = await sendMessage(chat, text, {
          ...entityOpt,
          reply_markup: markup,
          link_preview_options: { is_disabled: true }
        });
        d.wizardId = m.message_id;
        return;
      }
      const opts = {
        chat_id: chat,
        message_id: d.wizardId,
        ...entityOpt,
        reply_markup: markup,
        link_preview_options: { is_disabled: true }
      };
      try {
        await editMessageText(text, opts);
      } catch (e: any) {
        const message = String(e?.message || '').toLowerCase();
        if (message.includes('message is not modified')) return;
        const m = await sendMessage(chat, text, {
          ...entityOpt,
          reply_markup: markup,
          link_preview_options: { is_disabled: true }
        });
        d.wizardId = m.message_id;
      }
    };

    const askMedia = async (chat: string | number, d: PostDraft, editing = false) => {
      d.phase = 'media';
      const text = editing
        ? 'EDIT ATTACHMENT\n\nSend a photo, video, document (including APK/ZIP), audio, animation, or text-only post. Or skip to keep no attachment.'
        : "STEP 1 — ATTACHMENT (OPTIONAL)\n\nSend a photo, video, document (including APK/ZIP), audio, animation, or text-only post. If you don't want to attach anything, tap Skip.";
      await wizard(chat, d, text, {
        inline_keyboard: [
          [{ text: '⏭️ Skip attachment', callback_data: 'skip_media', style: 'primary' }],
          [
            { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' },
            { text: 'Cancel', callback_data: 'cancel', style: 'danger' }
          ]
        ]
      });
    };

    const askCaption = async (chat: string | number, d: PostDraft) => {
      d.phase = 'caption';
      await wizard(chat, d, 'STEP 2 — CAPTION\n\nSend caption text, or tap Skip caption to leave it empty.', {
        inline_keyboard: [
          [{ text: 'Skip caption', callback_data: 'skip_caption', style: 'primary' }],
          [
            { text: 'Edit post', callback_data: 'edit_menu' },
            { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' }
          ],
          [{ text: 'Cancel', callback_data: 'cancel', style: 'danger' }]
        ]
      });
    };

    const askButtonText = async (chat: string | number, d: PostDraft) => {
      if (d.buttons.length >= MAX_BUTTONS) return preview(chat, d);
      d.phase = 'button_text';
      d.active = { text: '', url: '', row: 1 };
      await wizard(chat, d, `STEP 3 — BUTTON TEXT\n\nSend the text for button ${d.buttons.length + 1}.`, {
        inline_keyboard: [
          [{ text: 'Skip buttons / Preview', callback_data: 'preview', style: 'primary' }],
          [
            { text: 'Edit post', callback_data: 'edit_menu' },
            { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' }
          ],
          [{ text: 'Cancel', callback_data: 'cancel', style: 'danger' }]
        ]
      });
    };

    const askButtonColor = async (chat: string | number, d: PostDraft, editing = false) => {
      d.phase = editing ? 'edit_button_style' : 'button_color';
      const current = editing ? (d.editIndex !== null ? d.buttons[d.editIndex]?.style : undefined) || 'default' : d.active?.style || 'default';
      const rows = [
        [{ text: `⚪ Default${current === 'default' ? ' ✓' : ''}`, callback_data: 'btnstyle:default' }],
        [{ text: `🔵 Blue${current === 'primary' ? ' ✓' : ''}`, callback_data: 'btnstyle:primary' }],
        [{ text: `🟢 Green${current === 'success' ? ' ✓' : ''}`, callback_data: 'btnstyle:success' }],
        [{ text: `🔴 Red${current === 'danger' ? ' ✓' : ''}`, callback_data: 'btnstyle:danger' }],
        [{ text: 'Cancel', callback_data: 'cancel', style: 'danger' }]
      ];
      await wizard(
        chat,
        d,
        editing
          ? 'EDIT BUTTON COLOR\n\nChoose a color for this button:'
          : 'STEP 4 — BUTTON COLOR\n\nWhich button color do you want? Choose one:',
        { inline_keyboard: rows }
      );
    };

    const askUrl = async (chat: string | number, d: PostDraft) => {
      d.phase = 'button_url';
      await wizard(
        chat,
        d,
        `STEP 5 — BUTTON URL\n\nButton: ${d.active?.text || ''}\nColor: ${d.active?.style || 'default'}\n\nSend an http:// or https:// URL.`,
        {
          inline_keyboard: [
            [{ text: 'Back', callback_data: 'add_button', style: 'primary' }],
            [
              { text: 'Edit post', callback_data: 'edit_menu' },
              { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel', style: 'danger' }]
          ]
        }
      );
    };

    const askRow = async (chat: string | number, d: PostDraft) => {
      d.phase = 'row';
      const previous = d.buttons.length ? d.buttons[d.buttons.length - 1].row : 1;
      const rows: any[][] = [[{ text: `Use row ${previous}`, callback_data: `setrow:${previous}` }]];
      if (previous < MAX_ROWS) rows.push([{ text: `Create row ${previous + 1}`, callback_data: `setrow:${previous + 1}` }]);
      if (previous !== 1) rows.push([{ text: 'Use row 1', callback_data: 'setrow:1' }]);
      rows.push([
        { text: 'Edit post', callback_data: 'edit_menu' },
        { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' }
      ]);
      rows.push([{ text: 'Cancel', callback_data: 'cancel', style: 'danger' }]);
      await wizard(chat, d, 'STEP 5 — BUTTON ROW\n\nChoose a row. Buttons in the same row appear side by side.', {
        inline_keyboard: rows
      });
    };

    const askMore = async (chat: string | number, d: PostDraft) => {
      d.phase = 'more';
      await wizard(chat, d, `BUTTON SAVED\n\n${d.buttons.length} button(s) added. Add another button or preview the post.`, {
        inline_keyboard: [
          [{ text: 'Add another button', callback_data: 'add_button' }],
          [{ text: 'Preview post', callback_data: 'preview' }],
          [{ text: 'Manage buttons', callback_data: 'edit_menu' }],
          [{ text: 'Cancel', callback_data: 'cancel' }]
        ]
      });
    };

    const preview = async (chat: string | number, d: PostDraft) => {
      d.phase = 'preview';
      const typeMap: Record<string, string> = {
        photo: 'Photo',
        video: 'Video',
        document: 'Document',
        audio: 'Audio',
        animation: 'Animation',
        text: 'Text'
      };
      const type = typeMap[d.type] || 'Attachment';
      const headerPrefix = `POST PREVIEW\n\nType: ${type}\n\nCaption / text:\n`;
      const footerSuffix = `\n\nButtons:\n${listButtons(d)}\n\nConfirm to publish or edit any part.`;
      let captionDisplay = d.caption || '(Empty)';
      const maxCaptionDisplayLen = Math.max(80, 4050 - headerPrefix.length - footerSuffix.length);
      if (d.caption && captionDisplay.length > maxCaptionDisplayLen) {
        captionDisplay = `${captionDisplay.slice(0, maxCaptionDisplayLen - 1)}…`;
      }
      const visibleCaptionLen = d.caption ? Math.min(d.caption.length, captionDisplay.endsWith('…') && d.caption.length > captionDisplay.length ? captionDisplay.length - 1 : captionDisplay.length) : 0;
      const previewEntities = d.caption
        ? sanitizeTelegramEntities(d.entities)
            .map((e) => {
              const clampedEnd = Math.min(e.offset + e.length, visibleCaptionLen);
              const clampedLen = clampedEnd - e.offset;
              return clampedLen > 0 ? { ...e, offset: e.offset + headerPrefix.length, length: clampedLen } : null;
            })
            .filter(Boolean)
        : [];
      const text = `${headerPrefix}${captionDisplay}${footerSuffix}`;
      const rows = grouped(d.buttons);
      rows.push([{ text: 'CONFIRM & PUBLISH', callback_data: 'publish' }]);
      rows.push([
        { text: 'Edit post / buttons', callback_data: 'edit_menu' },
        { text: 'Add button', callback_data: 'add_button' }
      ]);
      rows.push([
        { text: 'Delete draft', callback_data: 'delete_draft', style: 'danger' },
        { text: 'Cancel', callback_data: 'cancel', style: 'danger' }
      ]);
      await wizard(chat, d, text, { inline_keyboard: rows }, previewEntities);
    };

    const getActiveChannel = async (): Promise<{ activeChannel: string; legacyChannelId: string }> => {
      const settings = await storage.getSettings();
      const legacyChannelId = (process.env.CHANNEL_ID || '').trim();
      const activeChannel =
        (settings.postBotChannelId || '').trim() ||
        legacyChannelId ||
        (settings.requiredChannels?.find((c) => c.enabled !== false && c.chatId)?.chatId || '').trim();
      return { activeChannel, legacyChannelId };
    };

    const answerCallback = async (qid: string, opts: { text?: string; show_alert?: boolean } = {}) => {
      await callTelegramApi('answerCallbackQuery', {
        callback_query_id: qid,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.show_alert ? { show_alert: true } : {})
      }).catch(() => {});
    };

    const publish = async (chat: string | number, uid: string | number, qid: string) => {
      const d = getDraft(botId, uid);
      if (d.type === 'text' && !d.caption.trim()) {
        return answerCallback(qid, { text: 'Post text cannot be empty.', show_alert: true });
      }
      const { activeChannel } = await getActiveChannel();
      if (!activeChannel) {
        return answerCallback(qid, {
          text: 'No posting channel connected. Use /setchannel and forward a channel post first.',
          show_alert: true
        });
      }

      await answerCallback(qid, { text: d.targetMessageId ? 'Updating post...' : 'Publishing...' });
      const markup = d.buttons.length ? { inline_keyboard: grouped(d.buttons) } : undefined;
      const cleanEntities = sanitizeTelegramEntities(d.entities);
      const entities = cleanEntities.length ? cleanEntities : undefined;
      let sent: any;
      let postId = d.targetMessageId;

      if (postId) {
        if (d.type === 'text' && d.originalType === 'text') {
          const res = await callTelegramApi('editMessageText', {
            chat_id: activeChannel,
            message_id: postId,
            text: d.caption,
            parse_mode: null,
            entities,
            reply_markup: markup,
            link_preview_options: { is_disabled: true }
          });
          if (!res?.ok) throw new Error(res?.description || 'Failed to update text post');
        } else if (d.type !== 'text' && d.originalType !== 'text') {
          if (d.fileId !== d.originalFileId || d.type !== d.originalType) {
            const media = {
              type: d.type,
              media: d.fileId,
              caption: d.caption || undefined,
              caption_entities: entities
            };
            const res = await callTelegramApi('editMessageMedia', {
              chat_id: activeChannel,
              message_id: postId,
              media,
              reply_markup: markup
            });
            if (!res?.ok) throw new Error(res?.description || 'Failed to update media post');
          } else {
            const res = await callTelegramApi('editMessageCaption', {
              chat_id: activeChannel,
              message_id: postId,
              caption: d.caption || '',
              parse_mode: null,
              caption_entities: entities,
              reply_markup: markup
            });
            if (!res?.ok) throw new Error(res?.description || 'Failed to update post caption');
          }
        } else {
          return sendMessage(
            chat,
            'Telegram cannot convert an existing text message into a media post (or media post into text) while keeping the same message. The original post was not changed. Create a new post for that format change.',
            { reply_to_message_id: d.wizardId || undefined }
          );
        }
        await storage.savePostBotPublishedPost(postId, {
          messageId: postId,
          type: d.type,
          fileId: d.fileId,
          caption: d.caption,
          entities: d.entities || [],
          buttons: d.buttons || [],
          updatedAt: new Date().toISOString()
        });
      } else {
        if (d.type === 'photo') {
          const res = await callTelegramApi('sendPhoto', {
            chat_id: activeChannel,
            photo: d.fileId,
            caption: d.caption || undefined,
            parse_mode: null,
            caption_entities: entities,
            reply_markup: markup
          });
          if (!res?.ok) throw new Error(res?.description || 'sendPhoto failed');
          sent = res.result;
        } else if (d.type === 'video') {
          const res = await callTelegramApi('sendVideo', {
            chat_id: activeChannel,
            video: d.fileId,
            caption: d.caption || undefined,
            parse_mode: null,
            caption_entities: entities,
            reply_markup: markup
          });
          if (!res?.ok) throw new Error(res?.description || 'sendVideo failed');
          sent = res.result;
        } else if (d.type === 'document') {
          const res = await callTelegramApi('sendDocument', {
            chat_id: activeChannel,
            document: d.fileId,
            caption: d.caption || undefined,
            parse_mode: null,
            caption_entities: entities,
            reply_markup: markup
          });
          if (!res?.ok) throw new Error(res?.description || 'sendDocument failed');
          sent = res.result;
        } else if (d.type === 'audio') {
          const res = await callTelegramApi('sendAudio', {
            chat_id: activeChannel,
            audio: d.fileId,
            caption: d.caption || undefined,
            parse_mode: null,
            caption_entities: entities,
            reply_markup: markup
          });
          if (!res?.ok) throw new Error(res?.description || 'sendAudio failed');
          sent = res.result;
        } else if (d.type === 'animation') {
          const res = await callTelegramApi('sendAnimation', {
            chat_id: activeChannel,
            animation: d.fileId,
            caption: d.caption || undefined,
            parse_mode: null,
            caption_entities: entities,
            reply_markup: markup
          });
          if (!res?.ok) throw new Error(res?.description || 'sendAnimation failed');
          sent = res.result;
        } else {
          const res = await callTelegramApi('sendMessage', {
            chat_id: activeChannel,
            text: d.caption,
            parse_mode: null,
            entities,
            reply_markup: markup,
            link_preview_options: { is_disabled: true }
          });
          if (!res?.ok) throw new Error(res?.description || 'sendMessage failed');
          sent = res.result;
        }

        const publishedId = Number(sent.message_id);
        postId = publishedId;
        await storage.savePostBotPublishedPost(publishedId, {
          messageId: publishedId,
          type: d.type,
          fileId: d.fileId,
          caption: d.caption,
          entities: d.entities || [],
          buttons: d.buttons || [],
          createdAt: new Date().toISOString()
        });
      }

      await clearReplies(chat, d);
      const wizardId = d.wizardId;
      if (wizardId) await delMsg(chat, wizardId);
      await sendMessage(
        chat,
        d.targetMessageId
          ? '✅ Published post updated. Use /editposts to edit it again.'
          : '✅ Post published. Use /editposts to edit it later.'
      );
      resetDraft(botId, uid);
    };

    // =========================================================================
    // HANDLE INCOMING MESSAGE
    // =========================================================================
    if (update.message) {
      const m = update.message;
      const fromId = String(m.from?.id || '');
      const senderUsername = m.from?.username;
      const chat = m.chat?.id;
      if (!m.from || !chat) return;

      const isAllowed = await isAuthorizedAdmin(fromId, senderUsername);
      const text = typeof m.text === 'string' ? m.text : null;

      // Forwarded channel post handler for /setchannel
      // Only treat as channel connect when not actively composing/editing a post draft
      const currentDraft = getDraft(botId, fromId);
      const isDraftTextOrMediaInput =
        currentDraft.phase === 'media' ||
        currentDraft.phase === 'caption' ||
        currentDraft.phase === 'edit_caption';
      const forwardedChannel =
        (m.forward_from_chat && m.forward_from_chat.type === 'channel' ? m.forward_from_chat : null) ||
        (m.forward_origin?.type === 'channel' && m.forward_origin?.chat ? m.forward_origin.chat : null);

      if (forwardedChannel && isAllowed && !isDraftTextOrMediaInput) {
        const channelId = String(forwardedChannel.id);
        try {
          const meRes = await callTelegramApi('getMe', {});
          const botUserId = meRes?.result?.id;
          const memRes = botUserId
            ? await callTelegramApi('getChatMember', { chat_id: forwardedChannel.id, user_id: botUserId })
            : null;
          const member = memRes?.result;
          if (!member || !['administrator', 'creator'].includes(member.status)) {
            await sendMessage(chat, '❌ এই চ্যানেলে বট Admin নয়। আগে Admin করে আবার চ্যানেলের পোস্ট Forward করো।');
            return;
          }
          await storage.updateSettings({ postBotChannelId: channelId });
          if (currentDraft.phase === 'awaiting_channel_forward') {
            currentDraft.phase = 'idle';
          }
          await sendMessage(
            chat,
            `✅ Private channel connected!\nName: ${forwardedChannel.title || 'Private channel'}\nID: ${channelId}\n\nPosts will now be delivered to this channel (saved to local VPS storage, or set CHANNEL_ID=${channelId} in .env).`
          );
          return;
        } catch (e: any) {
          console.error('Private channel connect failed:', e?.message || e);
          await sendMessage(chat, '❌ চ্যানেল যাচাই করা যায়নি। বট Admin কি না এবং পোস্টটি Forward করা হয়েছে কি না নিশ্চিত করো।');
          return;
        }
      }

      if (text) {
        const trimmed = text.trim();

        if (/^\/setchannel(?:@\w+)?$/i.test(trimmed)) {
          if (!isAllowed) return;
          getDraft(botId, fromId).phase = 'awaiting_channel_forward';
          await sendMessage(
            chat,
            '🔗 প্রাইভেট চ্যানেল Connect করতে:\n\n1) চ্যানেলে এই বটকে Admin করো (Post Messages permission চালু রাখো)।\n2) চ্যানেলের যেকোনো একটি পোস্ট সরাসরি এই বটের ইনবক্সে Forward করো।\n3) বট চ্যানেল শনাক্ত করে Connect করবে।\n\nআগের CHANNEL_ID সিস্টেমও থাকবে।'
          );
          return;
        }

        if (/^\/channelstatus(?:@\w+)?$/i.test(trimmed)) {
          if (!isAllowed) return;
          const { activeChannel, legacyChannelId } = await getActiveChannel();
          await sendMessage(
            chat,
            `📣 বর্তমান পোস্টিং চ্যানেল: ${activeChannel || 'সেট করা নেই'}\nLegacy CHANNEL_ID: ${legacyChannelId || 'সেট করা নেই'}`
          );
          return;
        }

        if (/^\/editposts(?:@\w+)?$/i.test(trimmed)) {
          if (m.chat.type !== 'private' || !isAllowed) return;
          const publishedPosts = await storage.getPostBotPublishedPosts();
          const items = Object.values(publishedPosts)
            .sort((a: any, b: any) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))
            .slice(0, 20);
          if (!items.length) {
            await sendMessage(
              chat,
              'এখনো এই বটের মাধ্যমে প্রকাশিত কোনো পোস্টের তালিকা নেই। নতুন পোস্ট করার পর থেকে পোস্টগুলো এখানে দেখা যাবে।'
            );
            return;
          }
          const rows = items.map((p: any) => [
            {
              text: `✏️ ${String(p.caption || p.type || 'Post').replace(/\s+/g, ' ').slice(0, 42)} · #${p.messageId}`,
              callback_data: `posted_edit:${p.messageId}`
            }
          ]);
          await sendMessage(chat, 'যে পোস্টটি Edit করতে চাও সেটি নির্বাচন করো:', {
            reply_markup: { inline_keyboard: rows }
          });
          return;
        }

        if (/^\/start(?:@\w+)?$/i.test(trimmed)) {
          if (m.chat.type !== 'private') return;
          if (!isAllowed) {
            await sendMessage(chat, 'Access denied. Ask the owner to add your numeric Telegram user ID to ADMIN_IDS.');
            return;
          }
          await sendMessage(
            chat,
            '✨ Welcome to Post Maker!\n\nTurn your ideas into beautiful Telegram channel posts with media, text, and custom URL buttons. Preview everything before publishing.\n\nReady to create something? Tap below to get started.',
            {
              reply_markup: {
                inline_keyboard: [[{ text: '✍️ Create New Post', callback_data: 'new_post', style: 'primary' }]]
              }
            }
          );
          await delMsg(chat, m.message_id);
          return;
        }

        if (/^\/help(?:@\w+)?$/i.test(trimmed)) {
          if (!isAllowed) return;
          await sendMessage(
            chat,
            `HELP — TELEGRAM INLINE POST MAKER

COMMANDS
/newpost — start a post
/skip — skip an empty media caption
/cancel — cancel the current draft
/editposts — edit a previously published post
/help — show this guide

WORKFLOW
1. Send /newpost.
2. Send a photo/video with an optional caption, or send text for a text-only post.
3. If media has no caption, send a caption or /skip.
4. Enter button text, then its http(s) URL.
5. Choose the button row.
6. Add more buttons or open Preview.
7. Confirm & Publish.

EDIT / DELETE
Use Edit post / buttons to change media, caption/text, or each button's text and URL. Delete individual buttons or delete the whole draft.

MESSAGE CLEANUP
The bot edits one main wizard message as steps advance. After processing your reply, it attempts to delete your reply. Telegram may reject deletion in some cases, so cleanup is best-effort.

SETUP
Set BOT_TOKEN from @BotFather, CHANNEL_ID to your channel username or private numeric ID, and ADMIN_IDS to your numeric Telegram user ID. Add the bot as channel admin with Post Messages permission. Keep .env private. Drafts are in memory and disappear on restart. Run one polling instance per token.`
          );
          return;
        }

        if (/^\/newpost(?:@\w+)?$/i.test(trimmed)) {
          if (m.chat.type !== 'private' || !isAllowed) return;
          resetDraft(botId, fromId);
          await askMedia(chat, getDraft(botId, fromId));
          await delMsg(chat, m.message_id);
          return;
        }

        if (/^\/cancel(?:@\w+)?$/i.test(trimmed)) {
          if (m.chat.type !== 'private' || !isAllowed) return;
          const d = getDraft(botId, fromId);
          await clearReplies(chat, d);
          const id = d.wizardId;
          resetDraft(botId, fromId);
          if (id) {
            try {
              await editMessageText('Draft cancelled. Send /newpost to start again.', {
                chat_id: chat,
                message_id: id,
                reply_markup: { inline_keyboard: [[{ text: 'Create new post', callback_data: 'new_post', style: 'primary' }]] }
              });
            } catch {
              await sendMessage(chat, 'Draft cancelled. Send /newpost to start again.');
            }
          } else {
            await sendMessage(chat, 'Draft cancelled. Send /newpost to start again.');
          }
          return;
        }

        if (/^\/skip(?:@\w+)?$/i.test(trimmed)) {
          if (m.chat.type !== 'private' || !isAllowed) return;
          const d = getDraft(botId, fromId);
          if (d.phase === 'media') {
            d.type = 'text';
            d.fileId = null;
            d.caption = '';
            d.entities = [];
            return askCaption(chat, d);
          }
          if (d.phase !== 'caption') return;
          await clearReplies(chat, d);
          d.caption = '';
          d.entities = [];
          return askButtonText(chat, d);
        }

        if (trimmed.startsWith('/')) return;
      }

      if (m.chat.type !== 'private' || !isAllowed) return;
      const d = getDraft(botId, fromId);
      if (m.message_id) d.userIds.push(m.message_id);

      try {
        if (d.phase === 'media') {
          if (m.photo) {
            const parsed = normalizePostFormatting(m.caption || '', m.caption_entities);
            d.type = 'photo';
            d.fileId = m.photo[m.photo.length - 1].file_id;
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : d.caption ? askButtonText(chat, d) : askCaption(chat, d);
          }
          if (m.video) {
            const parsed = normalizePostFormatting(m.caption || '', m.caption_entities);
            d.type = 'video';
            d.fileId = m.video.file_id;
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : d.caption ? askButtonText(chat, d) : askCaption(chat, d);
          }
          if (m.document) {
            const parsed = normalizePostFormatting(m.caption || '', m.caption_entities);
            d.type = 'document';
            d.fileId = m.document.file_id;
            d.fileName = m.document.file_name || 'attachment';
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : d.caption ? askButtonText(chat, d) : askCaption(chat, d);
          }
          if (m.audio) {
            const parsed = normalizePostFormatting(m.caption || '', m.caption_entities);
            d.type = 'audio';
            d.fileId = m.audio.file_id;
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : d.caption ? askButtonText(chat, d) : askCaption(chat, d);
          }
          if (m.animation) {
            const parsed = normalizePostFormatting(m.caption || '', m.caption_entities);
            d.type = 'animation';
            d.fileId = m.animation.file_id;
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : d.caption ? askButtonText(chat, d) : askCaption(chat, d);
          }
          if (text && text.trim()) {
            const parsed = normalizePostFormatting(text, m.entities);
            d.type = 'text';
            d.caption = parsed.text;
            d.entities = parsed.entities;
            await clearReplies(chat, d);
            return d.targetMessageId ? preview(chat, d) : askButtonText(chat, d);
          }
          await clearReplies(chat, d);
          return wizard(chat, d, 'STEP 1 — MEDIA OR TEXT\n\nSend a photo, video, or text-only post.');
        }

        if (d.phase === 'caption') {
          const parsed = text ? normalizePostFormatting(text, m.entities) : { text: '', entities: [] };
          const maxLen = d.type === 'text' ? 4096 : 1024;
          if (!parsed.text || parsed.text.length > maxLen) {
            await clearReplies(chat, d);
            return wizard(chat, d, `STEP 2 — CAPTION\n\nSend caption text up to ${maxLen} characters, or use /skip.`);
          }
          d.caption = parsed.text;
          d.entities = parsed.entities;
          await clearReplies(chat, d);
          return askButtonText(chat, d);
        }

        if (d.phase === 'button_text') {
          if (!text || !text.trim() || text.trim().length > 64) {
            await clearReplies(chat, d);
            return wizard(chat, d, 'STEP 3 — BUTTON TEXT\n\nButton text must be 1–64 characters. Try again.');
          }
          if (!d.active) d.active = { text: '', url: '', row: 1 };
          d.active.text = text.trim();
          d.active.style = 'default';
          await clearReplies(chat, d);
          return askButtonColor(chat, d);
        }

        if (d.phase === 'button_url') {
          if (!text || !validUrl(text.trim())) {
            await clearReplies(chat, d);
            return wizard(chat, d, `STEP 4 — BUTTON URL\n\nButton: ${d.active?.text || ''}\n\nSend a valid http(s) URL.`);
          }
          if (!d.active) d.active = { text: 'Button', url: '', row: 1 };
          d.active.url = text.trim();
          await clearReplies(chat, d);
          return askRow(chat, d);
        }

        if (d.phase === 'edit_caption') {
          const limit = d.type === 'text' ? 4096 : 1024;
          const parsed = text ? normalizePostFormatting(text, m.entities) : { text: '', entities: [] };
          if (!parsed.text || parsed.text.length > limit) {
            await clearReplies(chat, d);
            return wizard(chat, d, `EDIT CAPTION / TEXT\n\nSend text up to ${limit} characters.`);
          }
          d.caption = parsed.text;
          d.entities = parsed.entities;
          await clearReplies(chat, d);
          return preview(chat, d);
        }

        if (d.phase === 'edit_button_text') {
          if (!text || !text.trim() || text.trim().length > 64 || d.editIndex === null || !d.buttons[d.editIndex]) {
            await clearReplies(chat, d);
            return wizard(chat, d, 'EDIT BUTTON TEXT\n\nSend text between 1 and 64 characters.');
          }
          d.buttons[d.editIndex].text = text.trim();
          d.editIndex = null;
          await clearReplies(chat, d);
          return preview(chat, d);
        }

        if (d.phase === 'edit_button_url') {
          if (!text || !validUrl(text.trim()) || d.editIndex === null || !d.buttons[d.editIndex]) {
            await clearReplies(chat, d);
            return wizard(chat, d, 'EDIT BUTTON URL\n\nSend a valid http(s) URL.');
          }
          d.buttons[d.editIndex].url = text.trim();
          d.editIndex = null;
          await clearReplies(chat, d);
          return preview(chat, d);
        }
      } catch (e: any) {
        console.error('[PostBot] Message handler:', e?.message || e);
        await clearReplies(chat, d);
        await wizard(chat, d, 'An error occurred. Check the terminal log or use /cancel.');
      }
      return;
    }

    // =========================================================================
    // HANDLE CALLBACK QUERY
    // =========================================================================
    if (update.callback_query) {
      const q = update.callback_query;
      const uid = q.from?.id;
      const chat = q.message && q.message.chat?.id;
      const data = q.data || '';

      if (!uid || !chat || q.message?.chat?.type !== 'private') {
        return answerCallback(q.id, { text: 'Access denied.', show_alert: true });
      }
      const isAllowed = await isAuthorizedAdmin(String(uid), q.from?.username);
      if (!isAllowed) {
        return answerCallback(q.id, { text: 'Access denied.', show_alert: true });
      }

      const d = getDraft(botId, uid);
      try {
        if (data.startsWith('posted_edit:')) {
          const id = data.slice('posted_edit:'.length);
          const publishedPosts = await storage.getPostBotPublishedPosts();
          const p = publishedPosts[id];
          if (!p) return answerCallback(q.id, { text: 'Post record not found.', show_alert: true });
          await answerCallback(q.id);
          resetDraft(botId, uid);
          const edit = getDraft(botId, uid);
          edit.targetMessageId = Number(p.messageId);
          edit.originalType = p.type;
          edit.originalFileId = p.fileId || null;
          edit.type = p.type;
          edit.fileId = p.fileId || null;
          edit.caption = p.caption || '';
          edit.entities = Array.isArray(p.entities) ? p.entities : [];
          edit.buttons = Array.isArray(p.buttons) ? p.buttons : [];
          return preview(chat, edit);
        }
        if (data === 'new_post') {
          await answerCallback(q.id);
          resetDraft(botId, uid);
          return askMedia(chat, getDraft(botId, uid));
        }
        if (data === 'skip_media') {
          if (d.phase !== 'media') return answerCallback(q.id, { text: 'This step is no longer active.' });
          await answerCallback(q.id);
          d.type = 'text';
          d.fileId = null;
          d.caption = '';
          d.entities = [];
          return askCaption(chat, d);
        }
        if (data === 'skip_caption') {
          if (d.phase !== 'caption') return answerCallback(q.id, { text: 'This step is no longer active.' });
          await answerCallback(q.id);
          await clearReplies(chat, d);
          d.caption = '';
          d.entities = [];
          return askButtonText(chat, d);
        }
        if (data === 'edit_menu') {
          await answerCallback(q.id);
          return wizard(chat, d, `EDIT MENU\n\nChoose what to edit or delete.\n\nButtons:\n${listButtons(d)}`, editKeys(d));
        }
        if (data === 'edit_media') {
          await answerCallback(q.id);
          d.caption = '';
          d.entities = [];
          d.fileId = null;
          d.type = 'text';
          return askMedia(chat, d, true);
        }
        if (data === 'edit_caption') {
          await answerCallback(q.id);
          d.phase = 'edit_caption';
          return wizard(chat, d, `EDIT CAPTION / TEXT\n\nCurrent:\n${d.caption || '(Empty)'}\n\nSend replacement text.`);
        }
        if (data === 'add_button') {
          await answerCallback(q.id);
          return askButtonText(chat, d);
        }
        if (data === 'preview') {
          await answerCallback(q.id);
          return preview(chat, d);
        }
        if (data.startsWith('edit_button:')) {
          const i = Number(data.split(':')[1]);
          if (!d.buttons[i]) return answerCallback(q.id, { text: 'Button not found.', show_alert: true });
          await answerCallback(q.id);
          return wizard(chat, d, `EDIT BUTTON ${i + 1}\n\n${d.buttons[i].text}\n${d.buttons[i].url}`, {
            inline_keyboard: [
              [
                { text: 'Edit text', callback_data: `edit_text:${i}` },
                { text: 'Edit URL', callback_data: `edit_url:${i}` }
              ],
              [{ text: 'Change color', callback_data: `edit_style:${i}` }],
              [{ text: 'Delete button', callback_data: `delete_button:${i}` }],
              [{ text: 'Back', callback_data: 'edit_menu' }]
            ]
          });
        }
        if (data.startsWith('edit_text:')) {
          const i = Number(data.split(':')[1]);
          if (!d.buttons[i]) return answerCallback(q.id, { text: 'Button not found.' });
          d.editIndex = i;
          d.phase = 'edit_button_text';
          await answerCallback(q.id);
          return wizard(chat, d, 'EDIT BUTTON TEXT\n\nSend the replacement text.');
        }
        if (data.startsWith('edit_url:')) {
          const i = Number(data.split(':')[1]);
          if (!d.buttons[i]) return answerCallback(q.id, { text: 'Button not found.' });
          d.editIndex = i;
          d.phase = 'edit_button_url';
          await answerCallback(q.id);
          return wizard(chat, d, 'EDIT BUTTON URL\n\nSend the replacement URL.');
        }
        if (data.startsWith('edit_style:')) {
          const i = Number(data.split(':')[1]);
          if (!d.buttons[i]) return answerCallback(q.id, { text: 'Button not found.' });
          d.editIndex = i;
          await answerCallback(q.id);
          return askButtonColor(chat, d, true);
        }
        if (data.startsWith('btnstyle:')) {
          const style = data.slice('btnstyle:'.length);
          if (!['default', 'primary', 'success', 'danger'].includes(style)) {
            return answerCallback(q.id, { text: 'Invalid color.' });
          }
          if (d.phase === 'edit_button_style' && d.editIndex !== null && d.buttons[d.editIndex]) {
            d.buttons[d.editIndex].style = style;
            d.editIndex = null;
            await answerCallback(q.id, { text: 'Button color updated.' });
            return preview(chat, d);
          }
          if (d.phase !== 'button_color' || !d.active) {
            return answerCallback(q.id, { text: 'This step is no longer active.' });
          }
          d.active.style = style;
          await answerCallback(q.id);
          return askUrl(chat, d);
        }
        if (data.startsWith('delete_button:')) {
          const i = Number(data.split(':')[1]);
          if (!d.buttons[i]) return answerCallback(q.id, { text: 'Button not found.' });
          d.buttons.splice(i, 1);
          await answerCallback(q.id, { text: 'Button deleted.' });
          return preview(chat, d);
        }
        if (data.startsWith('setrow:')) {
          const row = Number(data.split(':')[1]);
          if (!d.active || !d.active.url || row < 1 || row > MAX_ROWS) {
            return answerCallback(q.id, { text: 'Complete button text and URL first.', show_alert: true });
          }
          if (d.buttons.filter((b) => b.row === row).length >= MAX_PER_ROW) {
            return answerCallback(q.id, { text: 'This row is full.', show_alert: true });
          }
          d.active.row = row;
          d.buttons.push(d.active);
          d.active = null;
          await answerCallback(q.id);
          return askMore(chat, d);
        }
        if (data === 'delete_draft' || data === 'cancel') {
          const id = d.wizardId;
          await clearReplies(chat, d);
          resetDraft(botId, uid);
          await answerCallback(q.id, { text: data === 'cancel' ? 'Cancelled' : 'Draft deleted.' });
          try {
            if (id) {
              await editMessageText(
                data === 'cancel' ? 'Draft cancelled. Send /newpost to start again.' : 'Draft deleted. Send /newpost to start again.',
                {
                  chat_id: chat,
                  message_id: id,
                  reply_markup: { inline_keyboard: [[{ text: 'Create new post', callback_data: 'new_post', style: 'primary' }]] }
                }
              );
              return;
            }
          } catch {}
          await sendMessage(chat, 'Draft cleared. Send /newpost to start again.');
          return;
        }
        if (data === 'publish') {
          return publish(chat, uid, q.id);
        }
        return answerCallback(q.id, { text: 'Unknown action.' });
      } catch (e: any) {
        console.error('[PostBot] Callback error:', e?.message || e);
        await answerCallback(q.id, {
          text: 'Action failed. Check bot logs and channel permissions.',
          show_alert: true
        });
      }
    }
  }
}
