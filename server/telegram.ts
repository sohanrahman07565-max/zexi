import { AsyncLocalStorage } from 'node:async_hooks';
import { storage, ItemRecord, TriggerType, OpenMode, ScheduledDeletion, ForceSubChannel, StorageManager, storageContext, ClonedBotRecord } from './storage';
import { hashPassword } from './auth';

export const botTokenContext = new AsyncLocalStorage<string>();

// In-memory conversation state for interactive private chat commands (like /add)
interface AddSession {
  stage: 
    | 'awaiting_content'
    | 'awaiting_file_content'
    | 'awaiting_link_url'
    | 'awaiting_text_content'
    | 'awaiting_trigger_type'
    | 'awaiting_trigger_name'
    | 'awaiting_keyword_type'
    | 'awaiting_hashtag'
    | 'awaiting_filter_choice'
    | 'awaiting_delivery_type'
    | 'awaiting_link_reply_message'
    | 'awaiting_link_button_text'
    | 'awaiting_retention_choice'
    | 'awaiting_retention_days'
    | 'awaiting_setup_video_choice'
    | 'awaiting_setup_video'
    | 'awaiting_caption';
  type?: 'file' | 'link';
  isTextOnly?: boolean;
  textResponse?: string;
  fileName?: string;
  fileData?: {
    fileId: string;
    fileUniqueId?: string;
    fileType: 'document' | 'photo' | 'video' | 'audio';
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
  };
  linkData?: {
    url: string;
    name?: string;
    openMode?: OpenMode;
    buttonText?: string;
    replyMessage?: string;
  };
  triggerType?: TriggerType;
  rawKeyword?: string;
  trigger?: string;
  hashtag?: string;
  inFiltersList?: boolean;
  openMode?: OpenMode;
  caption?: string;
  replyMessage?: string;
  buttonText?: string;
  retentionType?: 'permanent' | 'temporary';
  retentionDays?: number;
  setupMessageId?: number;
  lastPromptMessageId?: number;
  hasSetupVideo?: boolean;
  setupVideoUrl?: string;
  setupVideoType?: 'url' | 'upload';
  setupVideoFileName?: string;
}

const activeAddSessions: Map<string, AddSession> = new Map();
const activeEditSessions: Map<string, { templateKey: string }> = new Map();
const activeSetChannelSessions: Map<string, { timestamp: number }> = new Map();

// Deduplication map to prevent repeated deliveries from retried webhooks
const recentDeliveries = new Map<string, number>();

function isDuplicateDelivery(chatId: string | number, payload: string): boolean {
  const key = `${chatId}_${payload}`;
  const now = Date.now();
  const lastTime = recentDeliveries.get(key);
  if (lastTime && now - lastTime < 1000) {
    return true;
  }
  recentDeliveries.set(key, now);
  if (recentDeliveries.size > 200) {
    for (const [k, time] of recentDeliveries.entries()) {
      if (now - time > 15000) recentDeliveries.delete(k);
    }
  }
  return false;
}

// Unique process instance identifier for distributed leader election and update locking
export const BOT_INSTANCE_ID = 'inst_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();

// In-flight update lock set to prevent parallel concurrent execution of the same update
const inFlightUpdateKeys = new Set<string>();

// Processed update keys with timestamp for local cache deduplication (2 minutes window)
const processedUpdateKeys = new Map<string, number>();

function extractUpdateKeys(update: any, botId: string = 'main'): string[] {
  if (!update) return [];
  const keys: string[] = [];

  if (update.update_id !== undefined && update.update_id !== null) {
    keys.push(`${botId}_uid_${update.update_id}`);
  }

  const msg = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
  if (msg?.message_id && msg?.chat?.id) {
    keys.push(`${botId}_msg_${msg.chat.id}_${msg.message_id}`);

    // Command & text-level active debounce to prevent rapid double-processing of identical message
    const txt = (msg.text || msg.caption || '').trim();
    if (txt && msg.from?.id) {
      const cleanSnippet = txt.slice(0, 32).toLowerCase();
      keys.push(`${botId}_deb_${msg.chat.id}_${msg.from.id}_${cleanSnippet}`);
    }
  }

  if (update.callback_query?.id) {
    keys.push(`${botId}_cb_${update.callback_query.id}`);
  }

  return keys;
}

// Super-fast 0ms latency update deduplication: eliminates delay before replying to users
function claimExclusiveTelegramUpdate(update: any, botId: string = 'main'): { allowed: boolean; keys: string[] } {
  if (!update) return { allowed: false, keys: [] };
  const now = Date.now();

  // Prune entries older than 2 minutes
  if (processedUpdateKeys.size > 2000) {
    for (const [k, time] of processedUpdateKeys.entries()) {
      if (now - time > 120000) processedUpdateKeys.delete(k);
    }
  }

  const keys = extractUpdateKeys(update, botId);
  if (keys.length === 0) return { allowed: true, keys: [] };

  // 1. In-flight check: if any key is currently running, drop immediately (0ms)
  for (const k of keys) {
    if (inFlightUpdateKeys.has(k)) {
      return { allowed: false, keys };
    }
  }

  // 2. Local deduplication check (processed within TTL window) (0ms)
  for (const k of keys) {
    const lastSeen = processedUpdateKeys.get(k);
    if (lastSeen) {
      const ttl = k.includes('_cb_act_') ? 300 : k.includes('_deb_') ? 1500 : 90000;
      if (now - lastSeen < ttl) {
        return { allowed: false, keys };
      }
    }
  }

  // Mark all keys as in-flight and processed immediately (zero lag)
  for (const k of keys) {
    inFlightUpdateKeys.add(k);
    processedUpdateKeys.set(k, now);
  }

  // 3. Asynchronously record distributed update claim in background without blocking message response
  const primaryKey = keys[0];
  storage.claimDistributedTelegramUpdate(primaryKey, BOT_INSTANCE_ID, 90000).catch(() => {});

  return { allowed: true, keys };
}

function releaseExclusiveTelegramUpdate(keys: string[]): void {
  for (const k of keys) {
    inFlightUpdateKeys.delete(k);
  }
}

export function getItemPayload(item: ItemRecord): string {
  if (item.id.startsWith('f_') || item.id.startsWith('l_')) {
    return item.id;
  }
  return `${item.type === 'file' ? 'f_' : 'l_'}${item.id}`;
}

export class TelegramService {
  private static forceSubCache = new Map<string, { allJoined: boolean; unjoinedChannels: ForceSubChannel[]; expiresAt: number }>();

  public static invalidateForceSubCache(userId?: string | number): void {
    if (!userId) {
      this.forceSubCache.clear();
      return;
    }
    const uid = String(userId).trim();
    for (const k of this.forceSubCache.keys()) {
      if (k.endsWith(`_${uid}`)) this.forceSubCache.delete(k);
    }
  }

  public static async getBotToken(): Promise<string> {
    const ctxToken = botTokenContext.getStore();
    if (ctxToken) {
      return String(ctxToken).trim().replace(/^["']|["']$/g, '');
    }

    const activeBotId = (storage as any)?.botId || 'main';
    if (activeBotId !== 'main') {
      const settings = await storage.getSettings().catch(() => ({} as any));
      if (settings?.botToken) {
        return String(settings.botToken).trim().replace(/^["']|["']$/g, '');
      }
      const mainStorage = StorageManager.getMainStorage();
      const cloned = await mainStorage.getClonedBots().catch(() => []);
      const found = cloned.find(b => b.id === activeBotId);
      if (found?.token) {
        return String(found.token).trim().replace(/^["']|["']$/g, '');
      }
      return '';
    }

    const envToken = (
      process.env.BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.TG_BOT_TOKEN ||
      process.env.BOT_API_TOKEN ||
      process.env.TOKEN ||
      ''
    ).trim().replace(/^["']|["']$/g, '');
    if (envToken) return envToken;
    const settings = await storage.getSettings().catch(() => ({} as any));
    return (settings?.botToken || '').trim().replace(/^["']|["']$/g, '');
  }

  public static async callTelegramApi(method: string, payload: Record<string, any>, tokenOverride?: string): Promise<any> {
    const rawToken = tokenOverride || botTokenContext.getStore() || await this.getBotToken();
    const token = (rawToken || '').trim().replace(/^["']|["']$/g, '');
    if (!token) {
      console.warn(`[Telegram] Skipping ${method}: No TELEGRAM_BOT_TOKEN configured.`);
      return { ok: false, description: 'No bot token configured' };
    }

    // Ensure HTML parse mode by default for text/message methods if not explicitly specified
    if (!payload.parse_mode && (method === 'sendMessage' || method === 'editMessageText' || method === 'sendPhoto' || method === 'sendVideo' || method === 'sendDocument' || method === 'sendAudio' || method === 'sendAnimation' || method === 'sendVoice')) {
      payload.parse_mode = 'HTML';
    }

    // Adaptive timeout: for long-polling (getUpdates), allow payload.timeout + 15s. Standard calls allow 15s.
    const timeoutSeconds = method === 'getUpdates'
      ? (Number(payload?.timeout) || 10) + 15
      : 15;

    const executeRequest = async (reqPayload: Record<string, any>): Promise<any> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
          signal: controller.signal
        });
        return await res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    };

    try {
      let currentPayload: Record<string, any> = { ...payload };
      let data = await executeRequest(currentPayload);

      // Chained error-resilient fallback retries (handles combined parse_mode, reply_to_message_id, thread_id, and inline style rejections)
      for (let retryPass = 0; retryPass < 4 && data && !data.ok; retryPass++) {
        const desc = typeof data.description === 'string' ? data.description.toLowerCase() : '';
        let modified = false;

        if (currentPayload.parse_mode && (desc.includes('parse entities') || desc.includes("can't parse"))) {
          console.warn(`[Telegram] ${method} failed with entity parsing (${data.description}). Retrying without parse_mode...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.parse_mode;
          currentPayload = nextPayload;
          modified = true;
        } else if (currentPayload.reply_to_message_id && (desc.includes('replied') || desc.includes('reply'))) {
          console.warn(`[Telegram] ${method} failed with reply_to_message_id (${data.description}). Retrying without reply_to_message_id...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.reply_to_message_id;
          currentPayload = nextPayload;
          modified = true;
        } else if (currentPayload.message_thread_id && desc.includes('thread')) {
          console.warn(`[Telegram] ${method} failed with message_thread_id (${data.description}). Retrying without message_thread_id...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.message_thread_id;
          currentPayload = nextPayload;
          modified = true;
        } else if (Array.isArray(currentPayload?.reply_markup?.inline_keyboard)) {
          const hasStyle = currentPayload.reply_markup.inline_keyboard.some((row: any[]) =>
            Array.isArray(row) && row.some((btn: any) => btn && typeof btn === 'object' && 'style' in btn)
          );
          if (hasStyle) {
            const strippedKeyboard = currentPayload.reply_markup.inline_keyboard.map((row: any[]) =>
              Array.isArray(row)
                ? row.map((btn: any) => {
                    if (!btn || typeof btn !== 'object') return btn;
                    const { style, ...rest } = btn;
                    return rest;
                  })
                : row
            );
            currentPayload = {
              ...currentPayload,
              reply_markup: { ...currentPayload.reply_markup, inline_keyboard: strippedKeyboard }
            };
            modified = true;
          }
        }

        if (!modified) break;
        data = await executeRequest(currentPayload);
      }

      return data;
    } catch (err: any) {
      if (method === 'getUpdates' && (err.name === 'AbortError' || err.message?.includes('aborted'))) {
        // Normal long-poll cycle completion; return empty updates cleanly without logging error
        return { ok: true, result: [] };
      }
      console.error(`[Telegram] API error calling ${method}:`, err);
      return { ok: false, description: err.message };
    }
  }

  // Edit an existing message in-place or send a new one if editing is not possible
  public static async editOrSendMessage(
    chatId: string | number,
    text: string,
    options: {
      messageId?: number;
      replyMarkup?: any;
      parseMode?: 'HTML' | 'Markdown';
    } = {}
  ): Promise<any> {
    const parse_mode = options.parseMode || 'HTML';
    if (options.messageId) {
      const editRes = await this.callTelegramApi('editMessageText', {
        chat_id: chatId,
        message_id: options.messageId,
        text,
        parse_mode,
        reply_markup: options.replyMarkup
      });
      if (editRes && editRes.ok) return editRes;
    }
    return await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode,
      reply_markup: options.replyMarkup
    });
  }

  public static async getBotUsername(): Promise<string> {
    const settings = await storage.getSettings();
    if (settings.botUsername) return settings.botUsername;

    const me = await this.callTelegramApi('getMe', {});
    if (me.ok && me.result?.username) {
      await storage.updateSettings({ botUsername: me.result.username });
      return me.result.username;
    }
    return 'YourBot';
  }

  // Helper to send or edit bot prompt during setup to keep conversation inside a single dynamic message bubble
  public static async sendOrEditSetupPrompt(
    chatId: string | number,
    text: string,
    replyMarkup?: any,
    session?: AddSession
  ): Promise<number | null> {
    if (session?.lastPromptMessageId) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: session.lastPromptMessageId,
          text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
        if (editRes && editRes.ok) {
          return session.lastPromptMessageId;
        }
      } catch (err) {
        // Fall back to deleting old prompt and sending fresh prompt below
      }

      // If in-place edit failed, cleanly delete the old prompt so there is never more than 1 chat bubble
      try {
        await this.callTelegramApi('deleteMessage', {
          chat_id: chatId,
          message_id: session.lastPromptMessageId
        });
      } catch {}
    }

    const sendRes = await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });

    if (sendRes && sendRes.ok && sendRes.result?.message_id) {
      if (session) {
        session.lastPromptMessageId = sendRes.result.message_id;
      }
      return sendRes.result.message_id;
    }
    return null;
  }

  // Helper to delete user's intermediate input messages to keep conversation clean
  public static async deleteUserMessage(chatId: string | number, messageId?: number): Promise<void> {
    if (!messageId) return;
    try {
      await this.callTelegramApi('deleteMessage', {
        chat_id: chatId,
        message_id: messageId
      });
    } catch {}
  }

  // Track and enforce message limit per chat (10 messages max)
  private static async trackAndLimitMessage(chatId: string | number, messageId: number): Promise<void> {
    const oldestIdToDelete = await storage.trackBotMessage(chatId, messageId);
    if (oldestIdToDelete) {
      await this.callTelegramApi('deleteMessage', {
        chat_id: chatId,
        message_id: oldestIdToDelete
      });
    }
  }

  // Comprehensive extraction of Telegram User from ANY update type
  public static extractUserFromUpdate(update: any): {
    id: string | number;
    username?: string;
    firstName?: string;
    lastName?: string;
  } | null {
    if (!update) return null;

    const rawUser = 
      update.message?.from || 
      update.edited_message?.from || 
      update.callback_query?.from ||
      update.inline_query?.from ||
      update.chosen_inline_result?.from ||
      update.shipping_query?.from ||
      update.pre_checkout_query?.from ||
      update.poll_answer?.user ||
      update.my_chat_member?.from ||
      update.chat_member?.from ||
      update.chat_join_request?.from ||
      update.message_reaction?.user ||
      update.message?.forward_from;

    const SERVICE_IDS = ['777000', '1087968824', '136817688'];

    if (rawUser && rawUser.id) {
      const rawIdStr = String(rawUser.id).trim();
      const rawUsername = (rawUser.username || '').toLowerCase().trim();

      // Exclude negative IDs (groups/supergroups/channels)
      if (rawIdStr.startsWith('-') || Number(rawIdStr) <= 0) {
        return null;
      }
      // Exclude Telegram service accounts
      if (SERVICE_IDS.includes(rawIdStr)) {
        return null;
      }
      // Exclude Telegram bots
      if (rawUser.is_bot || rawUsername.endsWith('bot')) {
        return null;
      }

      return {
        id: rawUser.id,
        username: rawUser.username ? `@${rawUser.username.replace(/^@+/, '').trim()}` : undefined,
        firstName: rawUser.first_name,
        lastName: rawUser.last_name
      };
    }

    // Fallback: If sent in a private chat, chat object contains user info
    const chat = update.message?.chat || update.edited_message?.chat || update.callback_query?.message?.chat;
    if (chat && chat.type === 'private' && chat.id) {
      const chatIdStr = String(chat.id).trim();
      const chatUsername = (chat.username || '').toLowerCase().trim();

      if (
        !chatIdStr.startsWith('-') &&
        Number(chatIdStr) > 0 &&
        !SERVICE_IDS.includes(chatIdStr) &&
        !chatUsername.endsWith('bot')
      ) {
        return {
          id: chat.id,
          username: chat.username ? `@${chat.username.replace(/^@+/, '').trim()}` : undefined,
          firstName: chat.first_name,
          lastName: chat.last_name
        };
      }
    }

    return null;
  }

  public static escapeHtml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Dynamically resolve placeholders inside Maintenance Notice:
  // Supports Telegram Username (@username, {username}), User ID ({user_id}, {id}), Bot Name ({bot_name}, {bot}), and Name ({name}, {user_name})
  public static resolveMaintenanceNotice(
    template: string,
    userPayload: { id: string | number; username?: string; firstName?: string; lastName?: string } | null,
    fromId: string,
    botUsername: string
  ): string {
    if (!template) return '⚠️ Bot is currently under maintenance. Please try again later.';

    const rawUsername = userPayload?.username?.replace(/^@+/, '').trim() || '';
    const userMention = rawUsername ? `@${rawUsername}` : (userPayload?.firstName || 'User');
    const userDisplayName = [userPayload?.firstName, userPayload?.lastName].filter(Boolean).join(' ') || (rawUsername ? `@${rawUsername}` : 'User');
    const firstName = userPayload?.firstName || (rawUsername ? `@${rawUsername}` : 'User');
    const resolvedUserId = String(fromId || userPayload?.id || '').trim() || 'Unknown';
    const cleanBotUsername = (botUsername || '').replace(/^@+/, '').trim() || 'Bot';
    const botMention = `@${cleanBotUsername}`;

    let result = template;

    // 1. Bracketed tags (case-insensitive)
    result = result.replace(/\{@?username\}/gi, userMention);
    result = result.replace(/\{user_id\}|\{userid\}|\{id\}|\{chat_id\}|\{chatid\}/gi, resolvedUserId);
    result = result.replace(/\{bot_name\}|\{botname\}|\{bot\}|\{bot_username\}|\{@bot_name\}|\{@bot\}/gi, botMention);
    result = result.replace(/\{name\}|\{user_name\}|\{fullname\}/gi, userDisplayName);
    result = result.replace(/\{first_name\}|\{firstname\}/gi, firstName);

    // 2. Exact word tokens (e.g. @username without brackets)
    result = result.replace(/(^|\s)@username\b/gi, `$1${userMention}`);
    result = result.replace(/(^|\s)@bot_name\b/gi, `$1${botMention}`);
    result = result.replace(/(^|\s)@bot\b/gi, `$1${botMention}`);

    // Prevent duplicate @@ if template had @@username
    result = result.replace(/@@+([a-zA-Z0-9_]+)/g, '@$1');

    return result.trim();
  }

  // Process incoming webhook or polling update
  public static async handleUpdate(update: any, tokenOverride?: string, botId: string = 'main'): Promise<void> {
    if (!update) return;

    if (tokenOverride && !botTokenContext.getStore()) {
      return botTokenContext.run(tokenOverride, () => this.handleUpdate(update, undefined, botId));
    }

    // Strict multi-instance atomic deduplication: prevents duplicate execution and double replies (0ms instant)
    const { allowed, keys } = claimExclusiveTelegramUpdate(update, botId);
    if (!allowed) {
      return;
    }

    try {
      // Ignore edited messages for commands and general replies to prevent double replies on edit
      if (update.edited_message && !update.message) {
        const fromId = String(update.edited_message.from?.id || '');
        const isInInteractiveSession = activeAddSessions.has(fromId) || activeEditSessions.has(fromId);
        if (!isInInteractiveSession) {
          return;
        }
      }

      // 1. AUTOMATIC UNIQUE UID TRACKING & DATABASE SAVING (Requirement 1 & 2):
      // Intercept every incoming update (message, command like /start, callback query, etc.) from any user.
      // Extract their Telegram User ID, First Name, Last Name, and @username.
      // Immediately track in the background without blocking the bot's instant response.
      const userPayload = this.extractUserFromUpdate(update);
      const fromId = userPayload?.id ? String(userPayload.id).trim() : '';

      if (userPayload && userPayload.id) {
        storage.trackBotUser({
          id: userPayload.id,
          username: userPayload.username,
          firstName: userPayload.firstName,
          lastName: userPayload.lastName
        }).catch(() => {});
      }

      // Auto-Deletion Check: Process any past-due message deletions promptly
      TelegramService.processDueScheduledDeletions().catch(() => {});

      // Auto-detection of channels & groups where bot is added or active
      if (update.my_chat_member) {
        this.handleMyChatMemberUpdate(update.my_chat_member).catch((err) =>
          console.warn('[Telegram] Error in handleMyChatMemberUpdate:', err)
        );
      }
      // Handle Chat Join Request for Private Channels/Groups
      if (update.chat_join_request) {
        await this.handleChatJoinRequest(update.chat_join_request);
        return;
      }

      // Ban Enforcement: check if user is restricted by administrator
      if (fromId) {
        const isBanned = await storage.isUserBanned(fromId);
        if (isBanned) {
          console.warn(`[Telegram] Blocked request from banned user: ${fromId}`);
          if (update.callback_query) {
            await this.callTelegramApi('answerCallbackQuery', {
              callback_query_id: update.callback_query.id,
              text: '⛔ Your account has been restricted by an administrator.',
              show_alert: true
            });
            return;
          }
          if (update.message?.chat?.type === 'private') {
            await this.callTelegramApi('sendMessage', {
              chat_id: update.message.chat.id,
              text: '⛔ <b>Access Restricted</b>\n\nYour Telegram account has been banned from using this bot by an administrator.',
              parse_mode: 'HTML'
            });
          }
          return;
        }
      }

      // Maintenance Mode Enforcement:
      // When Maintenance Mode is ON, block responses to general commands, trigger keywords, and /start command.
      // Immediately reply with customized notice supporting dynamic variables (@username, {user_id}, {bot_name}, {name}).
      // Ensure admins can still access and use admin triggers/commands if needed.
      const settings = await storage.getSettings();
      if (settings.maintenanceMode) {
        const isAdmin = await this.isAuthorizedAdmin(fromId);
        if (!isAdmin) {
          const rawNotice = settings.maintenanceNotice?.trim() || '⚠️ Bot is currently under maintenance. Please try again later.';
          const botUsername = await this.getBotUsername();
          const parsedNotice = this.resolveMaintenanceNotice(rawNotice, userPayload, fromId, botUsername);

          if (update.callback_query) {
            await this.callTelegramApi('answerCallbackQuery', {
              callback_query_id: update.callback_query.id,
              text: parsedNotice.replace(/<[^>]+>/g, '').slice(0, 200), // strip HTML tags for alert popup (max 200 chars)
              show_alert: true
            });
            return;
          }

          const msg = update.message || update.edited_message;
          if (msg?.chat) {
            if (msg.chat.type === 'private') {
              await this.callTelegramApi('sendMessage', {
                chat_id: msg.chat.id,
                text: parsedNotice,
                parse_mode: 'HTML'
              });
            } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
              const txt = (msg.text || msg.caption || '').trim();
              // In groups, only respond if someone addressed the bot or used a slash command
              if (txt.startsWith('/') || (botUsername && txt.toLowerCase().includes(`@${botUsername.toLowerCase()}`))) {
                await this.sendAutoDeletingNotice(msg.chat.id, parsedNotice, 6000, msg.message_id);
              }
            }
          }
          return;
        }
      }

      // Handle Inline Button Clicks (Callback queries from /add flow and setup video navigation)
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
        return;
      }

      // Support both new messages and edited messages during interactive setup
      const message = update.message || update.edited_message;
      if (!message) return;

      const chat = message.chat;
      const isGroup = chat.type === 'group' || chat.type === 'supergroup';
      const isPrivate = chat.type === 'private';
      const text = (message.text || message.caption || '').trim();

      if (isGroup) {
        await this.handleGroupMessage(message, text);
      } else if (isPrivate) {
        await this.handlePrivateMessage(message, text);
      }
    } finally {
      releaseExclusiveTelegramUpdate(keys);
    }
  }

  // In-memory cache for group admin statuses: `${chatId}:${userId}` -> { isAdmin: boolean, expiresAt: number }
  private static groupAdminCache: Map<string, { isAdmin: boolean; expiresAt: number }> = new Map();

  public static async isGroupAdminOrCreator(chatId: string | number, userId: string | number): Promise<boolean> {
    if (!chatId || !userId) return false;
    const cleanChatId = String(chatId).trim();
    const cleanUserId = String(userId).trim();

    // 1. First check if user is a bot system owner/admin
    const isBotAdmin = await this.isAuthorizedAdmin(cleanUserId);
    if (isBotAdmin) return true;

    // 2. Check local in-memory cache (valid for 60 seconds)
    const cacheKey = `${cleanChatId}:${cleanUserId}`;
    const now = Date.now();
    const cached = this.groupAdminCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.isAdmin;
    }

    // 3. Query Telegram getChatMember
    try {
      const res = await this.callTelegramApi('getChatMember', {
        chat_id: /^-?\d+$/.test(cleanChatId) ? Number(cleanChatId) : cleanChatId,
        user_id: Number(cleanUserId) || cleanUserId
      });

      if (res && res.ok && res.result) {
        const status = String(res.result.status || '').toLowerCase();
        const isAdmin = status === 'administrator' || status === 'creator';
        this.groupAdminCache.set(cacheKey, { isAdmin, expiresAt: now + 60000 });
        return isAdmin;
      }
    } catch (err: any) {
      console.warn(`[Telegram] Error querying getChatMember for admin check in chat ${cleanChatId}:`, err?.message || err);
    }

    return false;
  }

  // =========================================================================
  // ADMIN AUTHORIZATION & AUTO-DELETING NOTICES (STRICT GROUP PRIVACY)
  // =========================================================================
  public static async isAuthorizedAdmin(fromId: string | number): Promise<boolean> {
    if (!fromId) return false;
    const cleanId = String(fromId).trim();
    await storage.loadLatest(false);
    const admins = await storage.getAdmins();
    const settings = await storage.getSettings();
    const rootAdminId = String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || settings.rootAdminId || '8153757163').trim();
    if (cleanId === rootAdminId || rootAdminId.includes(cleanId)) return true;
    const admin = await storage.getAdmin(cleanId);
    if (admin && admin.enabled) return true;
    if (admins.some(a => String(a.telegramId) === cleanId || String(a.id) === cleanId)) return true;
    if (admins.length === 0) return true;
    return false;
  }

  public static async sendAutoDeletingNotice(
    chatId: string | number,
    text: string,
    delayMs: number = 3500,
    replyToMessageId?: number,
    replyMarkup?: any
  ): Promise<void> {
    try {
      const params: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      };
      if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
      if (replyMarkup) params.reply_markup = replyMarkup;

      const res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok && res.result?.message_id) {
        const msgId = res.result.message_id;
        setTimeout(() => {
          TelegramService.deleteUserMessage(chatId, msgId).catch(() => {});
        }, delayMs);
      }
    } catch (err) {
      console.warn('[Telegram] Auto-deleting notice error:', err);
    }
  }

  // =========================================================================
  // MANDATORY CHANNEL JOIN (FORCE SUB) SYSTEM & AUTO-DETECTION
  // =========================================================================

  // Auto-register and verify a channel or group where the bot is present/added
  public static async registerDetectedChat(chat: any, isExplicitAdmin?: boolean): Promise<ForceSubChannel | null> {
    if (!chat || !chat.id) return null;
    const chatId = String(chat.id).trim();
    const chatType = chat.type || 'channel';
    if (chatType === 'private') return null;

    try {
      let title = chat.title || chat.username || `Chat ${chatId}`;
      let username = chat.username ? `@${chat.username.replace(/^@/, '')}` : undefined;
      let inviteLink = chat.invite_link || '';

      if (!inviteLink && username) {
        inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
      }

      let isAdmin = isExplicitAdmin ?? false;
      try {
        const me = await this.callTelegramApi('getMe', {});
        const botId = me.result?.id;
        if (botId) {
          const memberRes = await this.callTelegramApi('getChatMember', {
            chat_id: chat.id,
            user_id: botId
          });
          if (memberRes && memberRes.ok && memberRes.result) {
            const st = memberRes.result.status;
            isAdmin = st === 'administrator' || st === 'creator';
          }
        }
      } catch {}

      if (!inviteLink && isAdmin) {
        try {
          const exportRes = await this.callTelegramApi('exportChatInviteLink', { chat_id: chat.id });
          if (exportRes && exportRes.ok && exportRes.result) {
            inviteLink = exportRes.result;
          }
        } catch {}
      }

      if (!inviteLink) {
        try {
          const fullChat = await this.callTelegramApi('getChat', { chat_id: chat.id });
          if (fullChat && fullChat.ok && fullChat.result) {
            title = fullChat.result.title || title;
            if (fullChat.result.username) username = `@${fullChat.result.username.replace(/^@/, '')}`;
            inviteLink = fullChat.result.invite_link || (username ? `https://t.me/${username.replace(/^@/, '')}` : '');
          }
        } catch {}
      }

      const registered = await storage.registerDetectedChannel({
        chatId,
        name: title,
        inviteLink,
        username,
        type: chatType as any,
        isAdmin,
        enabled: true
      });
      return registered;
    } catch (err: any) {
      console.warn('[Telegram] registerDetectedChat error for', chatId, err?.message);
      return null;
    }
  }

  // Handle bot being added or removed from channels/groups (my_chat_member updates)
  public static async handleMyChatMemberUpdate(myChatMember: any): Promise<void> {
    const chat = myChatMember.chat;
    const newMember = myChatMember.new_chat_member;
    if (!chat || !chat.id) return;

    const status = newMember?.status;
    const isAdmin = status === 'administrator' || status === 'creator';

    if (isAdmin || status === 'member') {
      await this.registerDetectedChat(chat, isAdmin);
      console.info(`[Telegram] Bot added/promoted in ${chat.type} "${chat.title}" (${chat.id})`);
    } else if (status === 'left' || status === 'kicked') {
      console.info(`[Telegram] Bot left/removed from ${chat.type} "${chat.title}" (${chat.id})`);
      await storage.removeForceSubChannel(String(chat.id));
    }
  }

  // Handle incoming ChatJoinRequest for private channels/groups (auto-approval & seamless verification)
  public static async handleChatJoinRequest(cjr: any): Promise<void> {
    if (!cjr || !cjr.chat || !cjr.from) return;

    const chat = cjr.chat;
    const from = cjr.from;
    const chatId = String(chat.id || '');
    const chatTitle = chat.title || 'Private Channel/Group';
    const userId = String(from.id || cjr.user_chat_id || '');
    const userName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.first_name || 'User';
    const userUsername = from.username ? `@${from.username.replace(/^@+/, '')}` : undefined;
    const inviteLink = cjr.invite_link?.invite_link;

    console.info(`[ForceSub] Received ChatJoinRequest from user ${userId} (${userName} / ${userUsername || 'no_user'}) for chat "${chatTitle}" (${chatId})`);

    // 1. Auto-detect & register this channel in system if not yet registered
    try {
      await this.registerDetectedChat(chat);
    } catch (err: any) {
      console.warn('[ForceSub] Error registering detected chat from join request:', err?.message);
    }

    // 2. Track user in bot database
    try {
      await storage.trackBotUser({
        id: userId,
        username: userUsername,
        firstName: from.first_name,
        lastName: from.last_name
      });
    } catch {}

    // 3. Record the join request in persistent storage
    try {
      await storage.recordJoinRequest({
        chatId,
        chatTitle,
        userId,
        userName,
        userUsername,
        status: 'pending',
        inviteLink
      });
    } catch (err: any) {
      console.warn('[ForceSub] Error recording join request:', err?.message);
    }

    // 4. Auto-Approve the Join Request if autoApproveJoinRequests !== false
    const settings = await storage.getSettings();
    const shouldAutoApprove = settings.autoApproveJoinRequests !== false;

    if (shouldAutoApprove) {
      try {
        console.info(`[ForceSub] Auto-approving join request for user ${userId} in chat ${chatId}...`);
        const approveRes = await this.callTelegramApi('approveChatJoinRequest', {
          chat_id: chat.id,
          user_id: from.id
        });

        const isSuccess = approveRes && (
          approveRes.ok || 
          approveRes.description?.includes('USER_ALREADY_PARTICIPANT') ||
          approveRes.description?.includes('ALREADY_PARTICIPANT') ||
          approveRes.description?.includes('HIDE_REQUESTER_MISSING')
        );

        if (isSuccess) {
          console.info(`[ForceSub] ✅ Join request approved successfully for user ${userId} in "${chatTitle}"`);
          await storage.updateJoinRequestStatus(chatId, userId, 'approved');

          // Send an instant confirmation DM to user if possible
          try {
            const noticeRes = await this.callTelegramApi('sendMessage', {
              chat_id: from.id,
              text: `✅ <b>Join Request Approved!</b>\n\nYour request to join <b>${this.escapeHtml(chatTitle)}</b> has been automatically approved!\n\n👇 You can now return to the bot and tap <b>Verify / Try Again</b> to unlock your requested files immediately.`,
              parse_mode: 'HTML'
            });
            if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
              await storage.recordChatDeliveryMessage(from.id, noticeRes.result.message_id);
            }
          } catch {}
        } else {
          console.warn(`[ForceSub] Telegram approveChatJoinRequest response for user ${userId}:`, approveRes?.description || approveRes);
          // If approval couldn't immediately complete (e.g. rights), keep pending so user still passes force sub
          await storage.updateJoinRequestStatus(chatId, userId, 'pending');
        }
      } catch (approveErr: any) {
        console.error(`[ForceSub] Exception while approving join request for user ${userId}:`, approveErr?.message || approveErr);
      }
    }
  }

  // Actively sync and auto-detect all channels and groups where the bot is currently an administrator
  public static async syncAdminChannels(): Promise<ForceSubChannel[]> {
    await storage.loadLatest(false);
    const settings = await storage.getSettings();
    const existing = Array.isArray(settings.requiredChannels) ? [...settings.requiredChannels] : [];
    const detected = await storage.getDetectedChannels();

    const candidates = new Map<string, Partial<ForceSubChannel>>();
    for (const ch of [...existing, ...detected]) {
      if (ch.chatId) candidates.set(String(ch.chatId), ch);
    }

    const me = await this.callTelegramApi('getMe', {});
    const botId = me.result?.id;

    const syncedList: ForceSubChannel[] = [];

    for (const [rawChatId, info] of candidates.entries()) {
      let targetChat: string | number = rawChatId;
      if (/^-?\d+$/.test(rawChatId)) {
        targetChat = Number(rawChatId);
      } else if (!rawChatId.startsWith('@') && !rawChatId.startsWith('-')) {
        targetChat = '@' + rawChatId;
      }

      try {
        const chatRes = await this.callTelegramApi('getChat', { chat_id: targetChat });
        if (chatRes && chatRes.ok && chatRes.result) {
          const chat = chatRes.result;
          let isAdmin = false;

          if (botId) {
            try {
              const memberRes = await this.callTelegramApi('getChatMember', {
                chat_id: targetChat,
                user_id: botId
              });
              if (memberRes && memberRes.ok && memberRes.result) {
                const st = memberRes.result.status;
                isAdmin = st === 'administrator' || st === 'creator';
              }
            } catch {}
          }

          let inviteLink = chat.invite_link || info.inviteLink || '';
          const username = chat.username ? `@${chat.username.replace(/^@/, '')}` : (info.username || undefined);
          if (!inviteLink && username) {
            inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
          }

          if (!inviteLink && isAdmin) {
            try {
              const renewed = await this.generateOrRenewInviteLink(targetChat, chat.title);
              if (renewed) {
                inviteLink = renewed;
              }
            } catch {}
          }

          const reg = await storage.registerDetectedChannel({
            id: info.id,
            chatId: String(chat.id),
            name: chat.title || info.name || 'Telegram Channel',
            inviteLink,
            username,
            type: chat.type as any,
            isAdmin,
            enabled: info.enabled !== undefined ? info.enabled : true
          });
          syncedList.push(reg);
        }
      } catch (err: any) {
        console.warn(`[SyncChannels] Chat ${rawChatId} check failed:`, err?.message);
        if (info.name && info.chatId) {
          syncedList.push({
            id: info.id || `ch_${Date.now()}`,
            name: info.name,
            chatId: info.chatId,
            inviteLink: info.inviteLink || '',
            enabled: info.enabled !== false,
            type: info.type || 'channel',
            username: info.username,
            isAdmin: info.isAdmin
          });
        }
      }
    }

    const updatedSettings = await storage.getSettings();
    return updatedSettings.requiredChannels || syncedList;
  }

  // Auto-generate or renew fresh invite links using Telegram API createChatInviteLink
  public static async generateOrRenewInviteLink(
    chatId: string | number,
    channelName?: string
  ): Promise<string | null> {
    const rawChat = String(chatId).trim();
    if (!rawChat) return null;
    const targetChat = /^-?\d+$/.test(rawChat) ? Number(rawChat) : (rawChat.startsWith('@') ? rawChat : `@${rawChat}`);

    try {
      const createRes = await this.callTelegramApi('createChatInviteLink', {
        chat_id: targetChat,
        name: `ForceSub - ${(channelName || 'AutoRenew').slice(0, 20)}`,
        creates_join_request: false
      });
      if (createRes && createRes.ok && createRes.result?.invite_link) {
        const newLink = createRes.result.invite_link;
        await storage.updateChannelInviteLink(rawChat, newLink);
        return newLink;
      }
    } catch (err: any) {
      console.warn(`[Telegram] createChatInviteLink failed for ${rawChat}:`, err?.message || err);
    }

    try {
      const expRes = await this.callTelegramApi('exportChatInviteLink', { chat_id: targetChat });
      if (expRes && expRes.ok && expRes.result) {
        const newLink = expRes.result;
        await storage.updateChannelInviteLink(rawChat, newLink);
        return newLink;
      }
    } catch (expErr: any) {
      console.warn(`[Telegram] exportChatInviteLink failed for ${rawChat}:`, expErr?.message || expErr);
    }

    return null;
  }

  // Forward-based Private Channel / Group Setup handler
  public static async handleForwardedChannelSetup(
    fromId: string,
    replyChatId: string | number,
    forwardChat: any
  ): Promise<void> {
    const rawChatId = String(forwardChat.id);
    const chatTitle = forwardChat.title || forwardChat.username || 'Private Channel';
    const chatType = forwardChat.type || (rawChatId.startsWith('-100') ? 'channel' : 'group');
    const username = forwardChat.username ? `@${forwardChat.username.replace(/^@/, '')}` : undefined;

    // Send processing status
    const statusMsg = await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `🔄 <b>Detected forwarded post from:</b> <i>${this.escapeHtml(chatTitle)}</i>\n` +
            `Connecting private channel and generating fresh invite link...`,
      parse_mode: 'HTML'
    });

    // Generate or renew invite link using createChatInviteLink
    let inviteLink = await this.generateOrRenewInviteLink(rawChatId, chatTitle);
    if (!inviteLink && username) {
      inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
    }

    // Check bot administrator status in the channel
    let isAdminInChat = false;
    try {
      const me = await this.callTelegramApi('getMe', {});
      const botId = me.result?.id;
      if (botId) {
        const memRes = await this.callTelegramApi('getChatMember', {
          chat_id: /^-?\d+$/.test(rawChatId) ? Number(rawChatId) : rawChatId,
          user_id: botId
        });
        if (memRes && memRes.ok && memRes.result) {
          const st = memRes.result.status;
          isAdminInChat = st === 'administrator' || st === 'creator';
        }
      }
    } catch {}

    // Register channel into storage (both detectedChannels and settings.requiredChannels)
    const channelRecord = await storage.registerDetectedChannel({
      chatId: rawChatId,
      name: chatTitle,
      inviteLink: inviteLink || '',
      username,
      type: chatType as any,
      isAdmin: isAdminInChat,
      enabled: true
    });

    // Ensure forceSubEnabled is turned on
    await storage.updateSettings({ forceSubEnabled: true });

    const responseText = 
      `✅ <b>Private Channel Connected Successfully via Forward!</b>\n\n` +
      `📢 <b>Channel Name:</b> <b>${this.escapeHtml(channelRecord.name)}</b>\n` +
      `🆔 <b>Chat ID:</b> <code>${channelRecord.chatId}</code>\n` +
      `🏷️ <b>Type:</b> <code>${channelRecord.type || 'channel'}</code>\n` +
      (channelRecord.inviteLink ? `🔗 <b>Invite Link:</b> ${channelRecord.inviteLink}\n` : '') +
      (isAdminInChat
        ? `👑 <b>Bot Status:</b> Administrator (Active & Verified) ✅\n`
        : `⚠️ <b>Important Note:</b> Please ensure you add this bot as an <b>Administrator</b> in this channel with invite permissions so force-subscription checks and member auto-approvals succeed.\n`
      ) +
      `\n✨ <i>Added to Force Sub channels with toggle ON. You can manage or toggle it anytime from the Admin Panel or with <code>/disconnect ${channelRecord.chatId}</code>.</i>`;

    if (statusMsg?.result?.message_id) {
      try {
        await this.callTelegramApi('editMessageText', {
          chat_id: replyChatId,
          message_id: statusMsg.result.message_id,
          text: responseText,
          parse_mode: 'HTML'
        });
        return;
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: responseText,
      parse_mode: 'HTML'
    });
  }

  // Admin /connect Command: Connect channel/group by ID or Username
  public static async handleConnectCommand(
    fromId: string,
    replyChatId: string | number,
    text: string,
    fallbackChatId?: string | number
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ You are not authorized to use admin commands.'
      });
      return;
    }

    const match = text.match(/^\/(?:connect|addchannel|setchannel)(?:@\w+)?(?:\s+(.+))?$/i);
    const rawTarget = match?.[1]?.trim() || (fallbackChatId ? String(fallbackChatId) : '');
    if (!rawTarget) {
      activeSetChannelSessions.set(fromId, { timestamp: Date.now() });
      const botName = await this.getBotUsername();
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: `📢 <b>Connect Private Channel / Group</b>\n\n` +
              `• <b>Please now forward any post or message from your private channel directly here!</b>\n` +
              `• <i>(Ensure @${botName || 'this bot'} is added as an <b>Administrator</b> in that channel first!)</i>\n` +
              `• The bot will automatically detect the chat ID, title, and create a fresh invite link for force-subscription.\n\n` +
              `💡 <i>Or connect by channel ID/username directly: <code>/setchannel -1001234567890</code> or <code>/setchannel @mychannel</code></i>\n\n` +
              `Type <code>/cancel</code> to abort.`,
        parse_mode: 'HTML'
      });
      return;
    }

    activeSetChannelSessions.delete(fromId);

    let target = rawTarget;
    let inviteLink = '';
    if (target.startsWith('https://t.me/')) {
      if (target.includes('/+')) {
        inviteLink = target;
      } else {
        target = '@' + target.replace('https://t.me/', '').replace(/\/.*$/, '');
      }
    } else if (target.startsWith('t.me/')) {
      if (target.includes('/+')) {
        inviteLink = 'https://' + target;
      } else {
        target = '@' + target.replace('t.me/', '').replace(/\/.*$/, '');
      }
    } else if (!target.startsWith('@') && !target.startsWith('-') && !/^\d+$/.test(target)) {
      target = '@' + target;
    }

    const queryChat = /^-?\d+$/.test(target) ? Number(target) : target;

    let chatTitle = String(rawTarget);
    let chatType: 'channel' | 'supergroup' | 'group' = String(target).startsWith('-100') ? 'supergroup' : 'channel';
    let username = target.startsWith('@') ? target : undefined;
    let resolvedChatId = String(target);

    try {
      const chatRes = await this.callTelegramApi('getChat', { chat_id: queryChat });
      if (chatRes && chatRes.ok && chatRes.result) {
        const c = chatRes.result;
        chatTitle = c.title || c.username || chatTitle;
        chatType = c.type || chatType;
        if (c.username) username = `@${c.username.replace(/^@/, '')}`;
        resolvedChatId = String(c.id);
        if (c.invite_link) inviteLink = c.invite_link;
        if (!inviteLink && username) {
          inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
        }
      }
    } catch (err: any) {
      console.warn('[Telegram] /connect getChat error:', err?.message);
    }

    // If still no invite link, try auto-generating or exporting
    if (!inviteLink) {
      try {
        const fresh = await this.generateOrRenewInviteLink(resolvedChatId, chatTitle);
        if (fresh) {
          inviteLink = fresh;
        }
      } catch {}
    }
    if (!inviteLink && username) {
      inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
    }

    // Register channel into storage (both detectedChannels and settings.requiredChannels)
    const channelRecord = await storage.registerDetectedChannel({
      chatId: resolvedChatId,
      name: chatTitle,
      inviteLink,
      username,
      type: chatType,
      isAdmin: true,
      enabled: true
    });

    // Ensure forceSubEnabled is turned on
    await storage.updateSettings({ forceSubEnabled: true });

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `✅ <b>Channel Successfully Connected!</b>\n\n` +
            `📢 <b>Name:</b> ${this.escapeHtml(channelRecord.name)}\n` +
            `🆔 <b>Chat ID:</b> <code>${channelRecord.chatId}</code>\n` +
            `🏷️ <b>Type:</b> <code>${channelRecord.type || 'channel'}</code>\n` +
            (channelRecord.inviteLink ? `🔗 <b>Invite Link:</b> ${channelRecord.inviteLink}\n` : '') +
            `\n✨ <i>Added to Force Sub channels with toggle ON. You can manage or delete it anytime from the Admin Panel or with <code>/disconnect ${channelRecord.chatId}</code>.</i>`,
      parse_mode: 'HTML'
    });
  }

  // Admin /disconnect Command: Disconnect channel/group by ID or Username
  public static async handleDisconnectCommand(
    fromId: string,
    replyChatId: string | number,
    text: string,
    fallbackChatId?: string | number
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ You are not authorized to use admin commands.'
      });
      return;
    }

    const match = text.match(/^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+(.+))?$/i);
    const rawTarget = match?.[1]?.trim() || (fallbackChatId ? String(fallbackChatId) : '');
    if (!rawTarget) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: `ℹ️ <b>Disconnect Channel / Group</b>\n\nUsage: <code>/disconnect &lt;channel_id_or_username&gt;</code>\n\nExample: <code>/disconnect @mychannel</code> or <code>/disconnect -1001234567890</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    const cleanTarget = rawTarget.replace(/^https:\/\/t\.me\//, '@').replace(/^t\.me\//, '@');
    await storage.removeForceSubChannel(cleanTarget);

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `🗑️ <b>Channel Disconnected!</b>\n\nThe channel/group <code>${this.escapeHtml(cleanTarget)}</code> has been removed from Force Sub.`,
      parse_mode: 'HTML'
    });
  }

  // Restores banned user access across all connected channels and groups in Telegram
  public static async unbanUserInConnectedChats(userId: string | number): Promise<void> {
    try {
      const cleanTarget = String(userId).trim().replace(/^@+/, '');
      let targetNumericId = Number(cleanTarget);

      // If userId was a username, resolve their numeric Telegram ID from storage
      if (isNaN(targetNumericId) || !targetNumericId) {
        const found = await storage.findUserByIdOrUsername(cleanTarget);
        if (found && found.id && !isNaN(Number(found.id))) {
          targetNumericId = Number(found.id);
        }
      }

      if (!targetNumericId) return;

      const settings = await storage.getSettings();
      const detected = await storage.getDetectedChannels();
      const candidateChats = new Set<string | number>();

      for (const ch of [...(settings.requiredChannels || []), ...detected]) {
        if (ch.chatId) candidateChats.add(ch.chatId);
      }

      for (const chat of candidateChats) {
        try {
          const targetChat = /^-?\d+$/.test(String(chat)) ? Number(chat) : String(chat);
          await this.callTelegramApi('unbanChatMember', {
            chat_id: targetChat,
            user_id: targetNumericId,
            only_if_banned: true
          });
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[Telegram] unbanUserInConnectedChats error for ${userId}:`, err?.message || err);
    }
  }

  public static async checkUserForceSub(
    userId: string | number
  ): Promise<{ allJoined: boolean; unjoinedChannels: ForceSubChannel[] }> {
    try {
      const settings = await storage.getSettings();
      if (!settings.forceSubEnabled || !settings.requiredChannels || settings.requiredChannels.length === 0) {
        return { allJoined: true, unjoinedChannels: [] };
      }

      const activeChannels = settings.requiredChannels.filter(c => c.enabled !== false);
      if (activeChannels.length === 0) {
        return { allJoined: true, unjoinedChannels: [] };
      }

      const cleanUserId = String(userId).trim();
      if (!cleanUserId) return { allJoined: true, unjoinedChannels: [] };

      const botScopeId = (storage as any)?.botId || 'main';
      const cacheKey = `${botScopeId}_${cleanUserId}`;
      const cached = this.forceSubCache.get(cacheKey);
      if (cached && cached.allJoined && Date.now() < cached.expiresAt) {
        return { allJoined: true, unjoinedChannels: [] };
      }

      // Exempt authorized administrators from force sub verification
      const isAdmin = await this.isAuthorizedAdmin(cleanUserId);
      if (isAdmin) {
        return { allJoined: true, unjoinedChannels: [] };
      }

      const numericUserId = Number(cleanUserId) || cleanUserId;

      // Parallelize channel membership checks for near-zero latency
      const checks = await Promise.all(activeChannels.map(async (channel) => {
        let rawChatId = (channel.chatId || '').trim();
        if (!rawChatId) return null;

        if (rawChatId.startsWith('https://t.me/')) {
          rawChatId = '@' + rawChatId.replace('https://t.me/', '').replace(/\/.*$/, '').replace(/^\+/, '');
        } else if (rawChatId.startsWith('t.me/')) {
          rawChatId = '@' + rawChatId.replace('t.me/', '').replace(/\/.*$/, '').replace(/^\+/, '');
        } else if (!rawChatId.startsWith('@') && !rawChatId.startsWith('-') && !/^\d+$/.test(rawChatId)) {
          rawChatId = '@' + rawChatId;
        }

        const targetChat = /^-?\d+$/.test(rawChatId) ? Number(rawChatId) : rawChatId;
        let isMember = false;

        try {
          const res = await this.callTelegramApi('getChatMember', {
            chat_id: targetChat,
            user_id: numericUserId
          });
          if (res && res.ok && res.result) {
            const status = res.result.status;
            isMember = status === 'creator' || status === 'administrator' || status === 'member' || (status === 'restricted' && res.result.is_member !== false);
          }
        } catch (err: any) {
          console.warn(`[ForceSub] Error querying getChatMember for ${cleanUserId} in ${targetChat}:`, err?.message);
        }

        if (!isMember) {
          const hasJoinRequest = await storage.isJoinRequestApprovedOrPending(
            String(targetChat),
            String(cleanUserId),
            channel.id,
            channel.username
          );
          if (hasJoinRequest) {
            isMember = true;
          } else {
            try {
              const approveRes = await this.callTelegramApi('approveChatJoinRequest', {
                chat_id: targetChat,
                user_id: numericUserId
              });
              if (approveRes && (
                approveRes.ok || 
                approveRes.description?.includes('USER_ALREADY_PARTICIPANT') ||
                approveRes.description?.includes('ALREADY_PARTICIPANT')
              )) {
                isMember = true;
                storage.recordJoinRequest({
                  chatId: String(targetChat),
                  chatTitle: channel.name,
                  userId: String(cleanUserId),
                  status: 'approved'
                }).catch(() => {});
              }
            } catch {}
          }
        }

        return isMember ? null : channel;
      }));

      const unjoined = checks.filter((c): c is ForceSubChannel => c !== null);
      const result = {
        allJoined: unjoined.length === 0,
        unjoinedChannels: unjoined
      };

      if (result.allJoined) {
        this.forceSubCache.set(cacheKey, { ...result, expiresAt: Date.now() + 15000 });
      }
      return result;
    } catch (err: any) {
      console.error('[ForceSub] Unexpected error in checkUserForceSub:', err);
      return { allJoined: true, unjoinedChannels: [] };
    }
  }

  public static async sendForceSubPrompt(
    chatId: string | number,
    unjoinedChannels: ForceSubChannel[],
    targetPayload: string = 'start',
    messageIdToEdit?: number,
    userInfo?: { id?: string | number; firstName?: string; first_name?: string; lastName?: string; last_name?: string; username?: string; [key: string]: any }
  ): Promise<void> {
    const keyboardRows: any[][] = [];

    // Channel Join Buttons: Grid layout with 2 buttons per row
    const channelButtons: any[] = [];
    for (let i = 0; i < unjoinedChannels.length; i++) {
      const ch = unjoinedChannels[i];
      let channelUrl = ch.inviteLink ? ch.inviteLink.trim() : '';

      // Auto-renew missing or expired invite link via Telegram API createChatInviteLink
      if (!channelUrl && ch.chatId) {
        try {
          const freshLink = await this.generateOrRenewInviteLink(ch.chatId, ch.name);
          if (freshLink) {
            channelUrl = freshLink;
            ch.inviteLink = freshLink;
          }
        } catch {}
      }

      if (!channelUrl) {
        if (ch.chatId && ch.chatId.startsWith('@')) {
          channelUrl = `https://t.me/${ch.chatId.slice(1)}`;
        } else {
          channelUrl = 'https://t.me';
        }
      }
      channelButtons.push({
        text: `📢 ${ch.name}`,
        url: channelUrl,
        style: 'primary'
      });
    }

    // Chunk channel buttons into pairs of 2 per row
    for (let i = 0; i < channelButtons.length; i += 2) {
      keyboardRows.push(channelButtons.slice(i, i + 2));
    }

    // "Verify / Try Again" callback button: Full width prominent button
    keyboardRows.push([
      {
        text: '🔄 Verify / Try Again ✅',
        callback_data: `forcesub_verify:${targetPayload || 'start'}`,
        style: 'success'
      }
    ]);

    // Dynamic unjoined channels enumeration for {channel_list} placeholder
    const channelNames = unjoinedChannels
      .map((c, i) => `  🔹 ${i + 1}. <b>${c.name}</b>`)
      .join('\n');

    // Load Editable Message Template from storage (Requirement 2)
    const templates = await storage.getTemplates();
    const template = templates['FORCESUB_PROMPT'];
    const botName = await this.getBotUsername();

    let promptText = template?.content || (
      `🔒 <b>Channel Membership Required</b>\n\n` +
      `To use this bot and access your requested content, please subscribe to our official channel(s) below:\n\n` +
      `{channel_list}\n\n` +
      `👇 <i>Tap the button(s) above to join, then press <b>Verify / Try Again</b> below.</i>`
    );

    let userMention = '';
    let userDisplayName = '';
    const userId = String(userInfo?.id || chatId);

    const rawFirstName = userInfo?.first_name || userInfo?.firstName;
    const rawLastName = userInfo?.last_name || userInfo?.lastName;
    const rawUsername = userInfo?.username;

    if (rawUsername) {
      userMention = `@${String(rawUsername).replace(/^@+/, '').trim()}`;
    }
    if (rawFirstName) {
      userDisplayName = [rawFirstName, rawLastName].filter(Boolean).join(' ').trim();
    }

    if (!userMention || !userDisplayName) {
      try {
        const storedUser = await storage.getUser(userId);
        if (storedUser) {
          if (!userMention && storedUser.username) {
            userMention = `@${storedUser.username.replace(/^@+/, '').trim()}`;
          }
          if (!userDisplayName && storedUser.firstName) {
            userDisplayName = [storedUser.firstName, storedUser.lastName].filter(Boolean).join(' ').trim();
          }
        }
      } catch {}
    }

    // Dynamic real name: prioritize user's actual real name (e.g. "Sohan"), then username, then ID
    const realUserName = userDisplayName || userMention || `User`;
    const dynamicUserName = realUserName;

    promptText = promptText
      .replace(/\{channel_list\}/gi, channelNames)
      .replace(/\{user_name\}|\{@?username\}|\{name\}|\{user\}|\{first_name\}/gi, realUserName)
      .replace(/\{user_id\}|\{userid\}|\{id\}/gi, userId)
      .replace(/\{bot_name\}|\{botname\}|\{bot\}/gi, `@${botName.replace(/^@/, '')}`)
      .replace(/(^|\s)@username\b/gi, `$1${userMention || realUserName}`)
      .replace(/Hey Friend/gi, `Hey ${realUserName}`)
      .replace(/\bFriend\b/gi, realUserName);

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text: promptText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        });
        if (editRes && editRes.ok) return;
        // If Telegram returns "message is not modified", the content is already up-to-date.
        // We MUST NOT send a new message, which would clutter and spam the user's chat!
        return;
      } catch {
        return;
      }
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: promptText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  }

  // =========================================================================
  // OFFICIAL SOURCE & BROADCAST WHITELIST VERIFIER
  // Whitelist channel posts, automatic forwards from linked channels,
  // connected official force-sub channels, and group administrators.
  // =========================================================================
  private static async isOfficialOrAdminMessage(message: any, fromId: string): Promise<boolean> {
    // 1. Automatic forwards from linked official channel into group (Telegram official flag)
    if (message.is_automatic_forward === true) {
      return true;
    }

    // 2. Telegram internal system bots / channel accounts
    const senderUserId = String(message.from?.id || '');
    if (senderUserId === '777000' || senderUserId === '1087968824' || senderUserId === '136817688') {
      return true;
    }

    // 3. Sender is a channel or anonymous admin
    if (message.sender_chat) {
      // If posted as the group itself (anonymous admin)
      if (message.chat?.id && String(message.sender_chat.id) === String(message.chat.id)) {
        return true;
      }
      // If sender_chat is any channel post sent to group
      if (message.sender_chat.type === 'channel') {
        return true;
      }
    }

    // 4. Check connected official channels in database
    const settings = await storage.getSettings();
    const detectedChannels = await storage.getDetectedChannels();
    const connectedIds = new Set<string>();
    const connectedUsernames = new Set<string>();

    if (Array.isArray(settings.requiredChannels)) {
      for (const ch of settings.requiredChannels) {
        if (ch.chatId) connectedIds.add(String(ch.chatId).trim());
        if (ch.id) connectedIds.add(String(ch.id).trim());
        if (ch.username) connectedUsernames.add(ch.username.replace(/^@+/, '').toLowerCase().trim());
      }
    }
    if (Array.isArray(detectedChannels)) {
      for (const ch of detectedChannels) {
        if (ch.chatId) connectedIds.add(String(ch.chatId).trim());
        if (ch.id) connectedIds.add(String(ch.id).trim());
        if (ch.username) connectedUsernames.add(ch.username.replace(/^@+/, '').toLowerCase().trim());
      }
    }

    // Check if sender_chat matches connected official channels
    if (message.sender_chat) {
      const senderId = String(message.sender_chat.id);
      const senderUser = message.sender_chat.username ? message.sender_chat.username.replace(/^@+/, '').toLowerCase() : '';
      if (connectedIds.has(senderId) || (senderUser && connectedUsernames.has(senderUser))) {
        return true;
      }
    }

    // Check if forward source is an official connected channel
    const fwdChat = message.forward_from_chat || message.forward_origin?.chat;
    if (fwdChat) {
      const fwdId = String(fwdChat.id);
      const fwdUser = fwdChat.username ? fwdChat.username.replace(/^@+/, '').toLowerCase() : '';
      if (connectedIds.has(fwdId) || (fwdUser && connectedUsernames.has(fwdUser))) {
        return true;
      }
    }

    // 5. Authorized administrator & Telegram group admin/creator check
    if (fromId) {
      const isSystemAdmin = await this.isAuthorizedAdmin(fromId);
      if (isSystemAdmin) {
        return true;
      }
      if (message.chat?.id) {
        const isGroupAdmin = await this.isGroupAdminOrCreator(message.chat.id, fromId);
        if (isGroupAdmin) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // GROUP MESSAGE HANDLING (EXACT TRIGGER MATCHING & STRICT GROUP PRIVACY)
  // =========================================================================
  private static async handleGroupMessage(message: any, text: string): Promise<void> {
    const fromId = String(message.from?.id || '');

    // =========================================================================
    // ADVANCED ANTI-SPAM & LINK/FORWARD PROTECTION SYSTEM
    // 1. Whitelist Channel Posts / Allow Official Broadcasts & Admins
    // 2. Block User Links & Forwards
    // 3. 3-Strike Warning & Auto-Ban System
    // =========================================================================
    const isOfficial = await this.isOfficialOrAdminMessage(message, fromId);

    if (!isOfficial) {
      const isForwarded = Boolean(
        message.forward_origin || 
        message.forward_from || 
        message.forward_from_chat || 
        message.forward_sender_name || 
        message.forward_date
      );

      const hasLinkEntity = (message.entities || []).some(
        (e: any) => e.type === 'url' || e.type === 'text_link'
      ) || (message.caption_entities || []).some(
        (e: any) => e.type === 'url' || e.type === 'text_link'
      );
      const linkRegex = /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)[^\s]+/i;
      const domainRegex = /\b[a-zA-Z0-9-]+\.(?:com|org|net|io|me|co|app|xyz|site|online|top|info|biz|ru|cn|in|de|uk|us|ca)\b/i;
      const combinedText = `${text || ''} ${message.caption || ''}`;
      const containsLink = hasLinkEntity || linkRegex.test(combinedText) || domainRegex.test(combinedText);

      if (isForwarded || containsLink) {
        // Instantly delete the offending message
        if (message.message_id) {
          await this.deleteUserMessage(message.chat.id, message.message_id);
        }

        if (fromId) {
          // Increment strike warning counter in storage
          const warningCount = await storage.incrementUserLinkWarning(message.chat.id, fromId);

          const userObj = message.from || {};
          const firstName = (userObj.first_name || '').trim();
          const lastName = (userObj.last_name || '').trim();
          const realName = (firstName + (lastName ? ' ' + lastName : '')).trim() || userObj.username || 'User';
          const userMention = userObj.username ? `@${userObj.username}` : `<b>${this.escapeHtml(realName)}</b>`;

          const violationType = (containsLink && isForwarded)
            ? 'links and forwarded messages'
            : containsLink
              ? 'links'
              : 'forwarded messages from external sources';

          if (warningCount === 1) {
            // 1st violation: Warning 1/3
            const warningText = `⚠️ <b>Strike [1/3] Warning</b> | ${userMention}\n\n` +
              `🚫 Sharing ${violationType} is strictly prohibited in this group.\n` +
              `📌 <i>Your message has been deleted. You have 2 warnings remaining before an automatic ban.</i>`;
            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: warningText,
              parse_mode: 'HTML'
            });
          } else if (warningCount === 2) {
            // 2nd violation: Warning 2/3 (Final warning)
            const warningText = `⚠️ <b>Strike [2/3] Warning — FINAL WARNING</b> | ${userMention}\n\n` +
              `🚫 Sharing ${violationType} is prohibited!\n` +
              `🚨 <b>CRITICAL:</b> You have 1 warning remaining. Your NEXT violation will result in an IMMEDIATE AUTO-BAN!`;
            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: warningText,
              parse_mode: 'HTML'
            });
          } else {
            // 3rd violation: Auto-ban user
            try {
              await this.callTelegramApi('banChatMember', {
                chat_id: message.chat.id,
                user_id: Number(fromId) || fromId
              });
            } catch (banErr) {
              console.warn('[Anti-Spam] banChatMember error on 3rd strike:', banErr);
            }

            await storage.setBotUserBanned(fromId, true);
            await storage.resetUserLinkWarning(message.chat.id, fromId);

            // Dynamic customizable Ban Notice template (supports {name}, {username}, {user_id}, {strikes})
            const templates = await storage.getTemplates();
            const banTemplate = templates.BAN_NOTICE?.content ||
              '🚫 <b>USER AUTO-BANNED (Strike {strikes}/{strikes})</b>\n\n👤 <b>User:</b> {name} (@{username} | ID: <code>{user_id}</code>)\n⚠️ <b>Reason:</b> Exceeded maximum {strikes}-strike warnings for unauthorized links / external forward spam.';

            const cleanUsername = userObj.username ? userObj.username.replace(/^@+/, '') : '';
            const banNotice = banTemplate
              .replace(/{name}/g, TelegramService.escapeHtml(realName))
              .replace(/{user_name}/g, TelegramService.escapeHtml(realName))
              .replace(/{username}/g, cleanUsername ? TelegramService.escapeHtml(cleanUsername) : 'N/A')
              .replace(/{user_id}/g, String(fromId))
              .replace(/{strikes}/g, '3');

            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: banNotice,
              parse_mode: 'HTML'
            });
          }
        }
        return;
      }
    }

    if (!text && !message.document && !message.photo && !message.video && !message.audio) return;

    // 1. Check if user is inside an active /add session in group
    let addSession = activeAddSessions.get(fromId);
    if (!addSession) {
      addSession = await storage.getAddSession(fromId);
      if (addSession) activeAddSessions.set(fromId, addSession);
    }
    if (addSession) {
      // Cleanly delete the input message from the public group
      if (message.message_id) {
        await this.deleteUserMessage(message.chat.id, message.message_id);
      }
      // Route the setup interaction strictly to the admin's private DM (fromId)
      await this.handleActiveAddSessionMessage(message, fromId, fromId, text, addSession);
      return;
    }

    // 2. Identify Admin Commands in group
    const isAddCommand = /^\/add(?:@\w+)?(?:\s+|$)/i.test(text);
    const isCancelCommand = /^\/cancel(?:@\w+)?(?:\s+|$)/i.test(text);
    const isWebCodeCommand = /^\/webcode(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetPasswordCommand = /^\/setpassword(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetStartMsgCommand = /^\/(?:setstartmsg|startmsg)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetStartMediaCommand = /^\/setstartmedia(?:@\w+)?(?:\s+|$)/i.test(text);
    const isClearStartMediaCommand = /^\/clearstartmedia(?:@\w+)?(?:\s+|$)/i.test(text);
    const isCleanupCommand = /^\/cleanup(?:@\w+)?(?:\s+|$)/i.test(text);
    const isAdminListCommand = /^\/(?:admins?|users?)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isConnectCommand = /^\/(?:connect|addchannel)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isDisconnectCommand = /^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+|$)/i.test(text);

    const isAdminCommand =
      isAddCommand ||
      isCancelCommand ||
      isWebCodeCommand ||
      isSetPasswordCommand ||
      isSetStartMsgCommand ||
      isSetStartMediaCommand ||
      isClearStartMediaCommand ||
      isCleanupCommand ||
      isAdminListCommand ||
      isConnectCommand ||
      isDisconnectCommand;

    if (isAdminCommand) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);

      // Immediately delete the admin command message from the group so group chat remains clean
      if (message.message_id) {
        await this.deleteUserMessage(message.chat.id, message.message_id);
      }

      // If user is NOT an authorized administrator:
      if (!isAdmin) {
        // STRICT PRIVACY: Never reveal admin panel responses or operational output in groups
        console.warn(`[Telegram] Unauthorized admin command rejected in group from: ${fromId}`);
        return;
      }

      // User IS an authorized administrator!
      // Deliver the command panel / response ONLY to the admin in PRIVATE DM (chat_id: fromId)
      const botUsername = await this.getBotUsername();
      const cleanBot = botUsername.replace(/^@/, '');

      const executeWithPrivateDelivery = async (commandFn: () => Promise<void>, noticeText: string) => {
        try {
          await commandFn();
          // Instantly auto-deleting public notice (disappears after 3.5 seconds)
          await this.sendAutoDeletingNotice(
            message.chat.id,
            `🔒 <i>${noticeText}</i>`,
            3500
          );
        } catch (err: any) {
          console.warn('[Telegram] Private admin command delivery failed (chat may not be started):', err);
          // If the bot cannot DM the user (never sent /start), send an auto-deleting notice with a direct link
          await this.sendAutoDeletingNotice(
            message.chat.id,
            `⚠️ <b>Admin Privacy:</b> Please start the bot in private chat to receive admin commands.`,
            6000,
            undefined,
            {
              inline_keyboard: [
                [{ text: 'Open Bot in Private DM', url: `https://t.me/${cleanBot}?start=admin`, style: 'primary' }]
              ]
            }
          );
        }
      };

      if (isAddCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleAddCommand(fromId, fromId, message, text);
          },
          `Admin setup wizard opened in your private messages (@${message.from?.username || message.from?.first_name || 'Admin'}).`
        );
        return;
      }

      if (isCancelCommand) {
        await executeWithPrivateDelivery(
          async () => {
            const addSession = activeAddSessions.get(fromId) || await storage.getAddSession(fromId);
            activeAddSessions.delete(fromId);
            await storage.deleteAddSession(fromId);
            activeEditSessions.delete(fromId);
            const templates = await storage.getTemplates();
            const cancelMsg = templates.CANCEL_MESSAGE?.content || '❌ Operation cancelled.';
            if (addSession?.lastPromptMessageId) {
              try {
                await this.callTelegramApi('editMessageText', {
                  chat_id: fromId,
                  message_id: addSession.lastPromptMessageId,
                  text: cancelMsg,
                  parse_mode: 'HTML'
                });
                return;
              } catch {}
            }
            await this.callTelegramApi('sendMessage', { chat_id: fromId, text: cancelMsg });
          },
          'Operation cancelled in your private messages.'
        );
        return;
      }

      if (isWebCodeCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleWebCodeCommand(fromId, fromId);
          },
          'One-time web login code sent to your private messages.'
        );
        return;
      }

      if (isSetPasswordCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleSetPasswordCommand(fromId, fromId, text);
          },
          'Password update processed in your private messages.'
        );
        return;
      }

      if (isSetStartMsgCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleSetStartMessageCommand(fromId, fromId, text, message);
          },
          'Start message configuration updated in private messages.'
        );
        return;
      }

      if (isSetStartMediaCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleSetStartMediaCommand(fromId, fromId, text, message);
          },
          'Start media updated in private messages.'
        );
        return;
      }

      if (isClearStartMediaCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleClearStartMediaCommand(fromId, fromId);
          },
          'Start media cleared in private messages.'
        );
        return;
      }

      if (isCleanupCommand) {
        await executeWithPrivateDelivery(
          async () => {
            const toDelete = await storage.getMessagesOlderThan(24);
            let deletedCount = 0;
            for (const item of toDelete) {
              const res = await this.callTelegramApi('deleteMessage', {
                chat_id: item.chatId,
                message_id: item.messageId
              });
              if (res.ok) deletedCount++;
            }
            await this.callTelegramApi('sendMessage', {
              chat_id: fromId,
              text: `🧹 <b>Cleanup Complete</b>\n\nCleaned up ${deletedCount} old tracked messages.`,
              parse_mode: 'HTML'
            });
          },
          'Cleanup executed. Report sent to private messages.'
        );
        return;
      }

      if (isAdminListCommand) {
        await executeWithPrivateDelivery(
          async () => {
            const admins = await storage.getAdmins();
            const settings = await storage.getSettings();
            const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
            const totalUsers = await storage.getTotalUserCount();
            const msg = `🛡️ <b>Administrators (${admins.length})</b>\nRoot ID: <code>${rootAdminId}</code>\nTotal Bot Users: <b>${totalUsers}</b>`;
            await this.callTelegramApi('sendMessage', { chat_id: fromId, text: msg, parse_mode: 'HTML' });
          },
          'Admin list sent to your private messages.'
        );
        return;
      }

      if (isConnectCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleConnectCommand(fromId, fromId, text, message.chat.id);
          },
          'Channel connection processed. Details sent to your private messages.'
        );
        return;
      }

      if (isDisconnectCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleDisconnectCommand(fromId, fromId, text, message.chat.id);
          },
          'Channel disconnection processed. Details sent to your private messages.'
        );
        return;
      }
    }

    // =========================================================================
    // MODERATION, BAN/UNBAN, REPORT & ANTI-FRAUD IN GROUPS
    // =========================================================================

    // Admin /clone command in groups: /clone <bot_token>
    const groupCloneMatch = text.match(/^\/clone(?:@\w+)?(?:\s+(.+))?$/i);
    if (groupCloneMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (isAdmin) {
        const tokenArg = groupCloneMatch[1]?.trim();
        if (!tokenArg) {
          await this.sendAutoDeletingNotice(
            message.chat.id,
            `ℹ️ <b>How to Clone Bot:</b>\nType <code>/clone &lt;bot_token&gt;</code>\nExample: <code>/clone 123456789:ABCdef...</code>`,
            7000,
            message.message_id
          );
          return;
        }

        const result = await TelegramBotManager.cloneBot(tokenArg, fromId);
        if (!result.success) {
          const errText = result.error === 'Already this bot is already running.' 
            ? '❌ <b>Already this bot is already running.</b>' 
            : `❌ <b>Failed to Clone Bot:</b> ${result.error || 'Invalid token'}`;
          await this.sendAutoDeletingNotice(
            message.chat.id,
            errText,
            8000,
            message.message_id
          );
          return;
        }

        const bot = result.bot!;
        await this.sendAutoDeletingNotice(
          message.chat.id,
          `🤖 <b>Bot Cloned Successfully:</b> @${bot.username}\n` +
          `• <b>Panel URL:</b> <a href="${bot.panelUrl}">${bot.panelUrl}</a>\n` +
          `• <b>Admin:</b> <code>${bot.adminUsername}</code> | <b>Pass:</b> <code>${bot.adminPassword}</code>`,
          20000,
          message.message_id
        );
        return;
      }
    }

    // 1. /ban Command: Admin replies /ban or runs /ban <user_id_or_username>
    const banMatch = text.match(/^\/ban(?:@\w+)?(?:\s+(.+))?$/i);
    if (banMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (isAdmin) {
        let targetId = '';
        let targetName = '';
        let targetUsername = '';

        if (message.reply_to_message?.from) {
          const targetUser = message.reply_to_message.from;
          targetId = String(targetUser.id);
          targetName = targetUser.first_name || targetUser.username || 'User';
          targetUsername = targetUser.username ? `@${targetUser.username.replace(/^@/, '')}` : '';
        } else if (banMatch[1]?.trim()) {
          const query = banMatch[1].trim();
          const found = await storage.findUserByIdOrUsername(query);
          if (found) {
            targetId = String(found.id);
            targetName = found.firstName || found.username || 'User';
            targetUsername = found.username ? `@${found.username.replace(/^@/, '')}` : '';
          } else {
            targetId = query.replace(/^@/, '');
            targetName = query;
            targetUsername = query.startsWith('@') ? query : '';
          }
        }

        if (targetId) {
          try {
            await this.callTelegramApi('banChatMember', {
              chat_id: message.chat.id,
              user_id: Number(targetId) || targetId
            });
          } catch (e) {
            console.warn('[Telegram] banChatMember error:', e);
          }
          await storage.setBotUserBanned(targetId, true);

          const userDisplay = targetUsername ? `${targetName} (${targetUsername})` : targetName;
          await this.callTelegramApi('sendMessage', {
            chat_id: message.chat.id,
            text: `OK Boss. ${userDisplay} has been successfully banned.`,
            reply_to_message_id: message.message_id
          });
          if (message.message_id) {
            setTimeout(() => {
              TelegramService.deleteUserMessage(message.chat.id, message.message_id).catch(() => {});
            }, 3000);
          }
          return;
        }
      }
    }

    // 2. /unban Command: Admin runs /unban <user_id_or_username> or replies /unban
    const unbanMatch = text.match(/^\/unban(?:@\w+)?(?:\s+(.+))?$/i);
    if (unbanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (isAdmin) {
        let targetId = '';
        let targetName = '';
        let targetUsername = '';

        if (message.reply_to_message?.from) {
          const targetUser = message.reply_to_message.from;
          targetId = String(targetUser.id);
          targetName = targetUser.first_name || targetUser.username || 'User';
          targetUsername = targetUser.username ? `@${targetUser.username.replace(/^@/, '')}` : '';
        } else if (unbanMatch[1]?.trim()) {
          const query = unbanMatch[1].trim();
          const found = await storage.findUserByIdOrUsername(query);
          if (found) {
            targetId = String(found.id);
            targetName = found.firstName || found.username || 'User';
            targetUsername = found.username ? `@${found.username.replace(/^@/, '')}` : '';
          } else {
            targetId = query.replace(/^@/, '');
            targetName = query;
            targetUsername = query.startsWith('@') ? query : '';
          }
        }

        if (targetId) {
          try {
            await this.callTelegramApi('unbanChatMember', {
              chat_id: message.chat.id,
              user_id: Number(targetId) || targetId,
              only_if_banned: true
            });
          } catch (e) {
            console.warn('[Telegram] unbanChatMember error in group:', e);
          }
          await storage.setBotUserBanned(targetId, false);
          await storage.resetUserLinkWarning(message.chat.id, targetId);
          await storage.resetUserFraudWarning(message.chat.id, targetId);
          TelegramService.unbanUserInConnectedChats(targetId).catch(() => {});

          const userDisplay = targetUsername ? `${targetName} (${targetUsername})` : targetName;
          await this.callTelegramApi('sendMessage', {
            chat_id: message.chat.id,
            text: `✅ <b>OK Boss. ${userDisplay} has been successfully unbanned.</b>`,
            parse_mode: 'HTML',
            reply_to_message_id: message.message_id
          });
          if (message.message_id) {
            setTimeout(() => {
              TelegramService.deleteUserMessage(message.chat.id, message.message_id).catch(() => {});
            }, 3000);
          }
          return;
        } else {
          await this.callTelegramApi('sendMessage', {
            chat_id: message.chat.id,
            text: `ℹ️ <b>How to Unban:</b>\nReply to any user's message with <code>/unban</code>, or type <code>/unban &lt;user_id_or_username&gt;</code>.`,
            parse_mode: 'HTML',
            reply_to_message_id: message.message_id
          });
          return;
        }
      }
    }

    // 3. /report Command: User replies to a message with /report <reason>, or sends /report <@username_or_id> <reason>
    const reportMatch = text.match(/^\/report(?:@\w+)?(?:\s+(.+))?$/i);
    if (reportMatch || text.trim().toLowerCase().startsWith('/report')) {
      let targetUser: any = null;
      let reason = reportMatch?.[1]?.trim() || '';
      let reportedContent = '';
      let messageId: number | undefined = undefined;

      if (message.reply_to_message) {
        targetUser = message.reply_to_message.from || message.reply_to_message.sender_chat;
        messageId = message.reply_to_message.message_id;
        reportedContent = message.reply_to_message.text || message.reply_to_message.caption || '[Attachment/Media]';
        if (!reason) reason = 'Inappropriate content / violation';
      } else if (reportMatch?.[1]?.trim()) {
        const parts = reportMatch[1].trim().split(/\s+/);
        const query = parts[0];
        reason = parts.slice(1).join(' ').trim() || 'Inappropriate behavior / violation';
        const found = await storage.findUserByIdOrUsername(query);
        if (found) {
          targetUser = {
            id: found.id,
            first_name: found.firstName || found.username || 'User',
            username: found.username ? found.username.replace(/^@+/, '') : undefined
          };
        } else {
          targetUser = {
            id: query.replace(/^@+/, ''),
            first_name: query,
            username: query.startsWith('@') ? query.replace(/^@+/, '') : undefined
          };
        }
        reportedContent = reason;
      }

      if (!targetUser) {
        if (message.message_id) {
          await this.deleteUserMessage(message.chat.id, message.message_id);
        }
        await this.sendAutoDeletingNotice(
          message.chat.id,
          'ℹ️ <b>How to Report:</b> Reply to the message you want to report with <code>/report &lt;reason&gt;</code>, or send <code>/report &lt;@username_or_id&gt; &lt;reason&gt;</code>.',
          6000
        );
        return;
      }

      const reporter = message.from || {};
      const targetUserId = String(targetUser.id || '');
      const targetUserName = targetUser.first_name || targetUser.title || targetUser.username || 'User';
      const targetUserUsername = targetUser.username;

      const report = await storage.saveReport({
        id: `rep_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        reporterId: String(reporter.id || ''),
        reporterName: reporter.first_name || reporter.username || 'User',
        reporterUsername: reporter.username,
        reportedUserId: targetUserId,
        reportedUserName: targetUserName,
        reportedUserUsername: targetUserUsername,
        reason,
        chatId: String(message.chat.id),
        chatTitle: message.chat.title || 'Group',
        messageId,
        reportedContent: reportedContent || reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Forward report instantly to all bot admins via private DM
      const admins = await storage.getAdmins();
      const settings = await storage.getSettings();
      const adminTargetIds = new Set<string>();
      if (settings.rootAdminId) adminTargetIds.add(String(settings.rootAdminId).trim());
      if (process.env.ADMIN_ID) adminTargetIds.add(String(process.env.ADMIN_ID).trim());
      if (process.env.ROOT_ADMIN_ID) adminTargetIds.add(String(process.env.ROOT_ADMIN_ID).trim());
      for (const a of admins) {
        if (a.telegramId) adminTargetIds.add(String(a.telegramId).trim());
        if (a.id && /^\d+$/.test(String(a.id))) adminTargetIds.add(String(a.id).trim());
      }

      const adminReportMsg = 
        `🚨 <b>New User Report Filed</b>\n\n` +
        `👤 <b>Reported User:</b> ${targetUserName} (${targetUserUsername ? '@' + targetUserUsername : `ID: <code>${targetUserId}</code>`})\n` +
        `🆔 <b>User ID:</b> <code>${targetUserId}</code>\n` +
        `📢 <b>Reported By:</b> ${reporter.first_name || 'User'} (${reporter.username ? '@' + reporter.username : `ID: <code>${reporter.id}</code>`})\n` +
        `👥 <b>Chat / Source:</b> ${message.chat.title || 'Group'} (<code>${message.chat.id}</code>)\n` +
        `📝 <b>Reason:</b> <i>${this.escapeHtml(reason)}</i>\n` +
        `💬 <b>Content Snippet:</b>\n<blockquote>${this.escapeHtml(reportedContent.slice(0, 300))}</blockquote>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🚫 Ban User', callback_data: `admin_ban_user:${targetUserId}:${report.id}`, style: 'danger' },
            { text: 'Dismiss', callback_data: `admin_dismiss_report:${report.id}`, style: 'primary' }
          ]
        ]
      };

      for (const adminId of adminTargetIds) {
        try {
          await this.callTelegramApi('sendMessage', {
            chat_id: adminId,
            text: adminReportMsg,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (e) {
          console.warn(`[Telegram] Failed to notify admin ${adminId} of report:`, e);
        }
      }

      // Delete the /report command message from the group
      if (message.message_id) {
        await this.deleteUserMessage(message.chat.id, message.message_id);
      }
      // Send auto-deleting confirmation notice
      await this.sendAutoDeletingNotice(
        message.chat.id,
        '✅ <i>Report received and forwarded to administrators for review.</i>',
        4000
      );
      return;
    }


    // 4. Check /allfile or /allfiles command in groups early so built-in file list triggers reliably
    const earlyAllFileCmd = this.parseAllFileCommand(text);
    if (earlyAllFileCmd.matched) {
      await this.handleFilesListCommand(
        fromId,
        message.chat.id,
        earlyAllFileCmd.page,
        message.message_id,
        true,
        undefined,
        message.message_thread_id
      );
      return;
    }

    // 5. Fraud Protection & Custom Word Filter Rules
    const fraudRules = await storage.getFraudRules();
    const activeFraudRules = fraudRules.filter(r => r.enabled);
    if (activeFraudRules.length > 0) {
      const isSystemAdmin = await this.isAuthorizedAdmin(fromId);
      const isGroupAdmin = message.chat?.id ? await this.isGroupAdminOrCreator(message.chat.id, fromId) : false;
      const isAdmin = isSystemAdmin || isGroupAdmin;
      if (!isAdmin) {
        const lowerText = text.toLowerCase();
        for (const rule of activeFraudRules) {
          let matched = false;
          const kw = rule.keyword.trim().toLowerCase();
          if (rule.matchType === 'exact') {
            matched = lowerText === kw;
          } else if (rule.matchType === 'regex') {
            try {
              const reg = new RegExp(rule.keyword, 'i');
              matched = reg.test(text);
            } catch {}
          } else {
            // Default: contains
            matched = lowerText.includes(kw);
          }

          if (matched) {
            const action = rule.action || 'delete_and_warn';
            const maxWarnings = rule.maxWarnings && rule.maxWarnings > 0 ? rule.maxWarnings : 3;
            const duration = rule.duration || 'permanent';
            const isReplyOnly = action === 'reply_only';

            // Delete offending message only when configured (NEVER delete on reply_only or warn)
            const shouldDeleteMessage =
              action === 'delete' || action === 'delete_and_warn' || action === 'mute' || action === 'ban';
            if (shouldDeleteMessage && message.message_id) {
              await this.deleteUserMessage(message.chat.id, message.message_id);
            }

            // Increment and evaluate warning count ONLY for warning/penalty rules (skip on reply_only & delete)
            let currentWarnings = 0;
            let isFinalThreshold = false;
            if (!isReplyOnly && action !== 'delete') {
              currentWarnings = await storage.incrementUserFraudWarning(message.chat.id, fromId, rule.id);
              isFinalThreshold = currentWarnings >= maxWarnings;
            }

            let actionDescription = 'Warning issued';
            if (isReplyOnly) {
              actionDescription = 'Reply sent';
            } else if (action === 'delete') {
              actionDescription = 'Message deleted';
            } else if (action === 'mute') {
              actionDescription = isFinalThreshold ? `Muted (${duration})` : `Warning (${currentWarnings}/${maxWarnings})`;
            } else if (action === 'ban') {
              actionDescription = isFinalThreshold ? `Banned (${duration})` : `Warning (${currentWarnings}/${maxWarnings})`;
            }

            // If threshold reached and action is mute or ban, execute penalty
            if (!isReplyOnly && isFinalThreshold && (action === 'mute' || action === 'ban')) {
              let durationSec = 0;
              const durLower = (duration || '').trim().toLowerCase();
              if (durLower && durLower !== 'permanent') {
                const match = durLower.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
                if (match) {
                  const val = parseFloat(match[1]);
                  const unit = match[2] || 'm';
                  if (unit.startsWith('h')) durationSec = Math.round(val * 3600);
                  else if (unit.startsWith('d')) durationSec = Math.round(val * 86400);
                  else durationSec = Math.round(val * 60); // default minutes
                } else if (durLower === '1h') durationSec = 3600;
                else if (durLower === '6h') durationSec = 6 * 3600;
                else if (durLower === '24h') durationSec = 24 * 3600;
                else if (durLower === '7d') durationSec = 7 * 86400;
                else if (durLower === '30d') durationSec = 30 * 86400;
              }

              const untilDate = durationSec > 0 ? Math.floor(Date.now() / 1000) + durationSec : undefined;

              if (action === 'mute') {
                try {
                  await this.callTelegramApi('restrictChatMember', {
                    chat_id: message.chat.id,
                    user_id: Number(fromId) || fromId,
                    permissions: {
                      can_send_messages: false,
                      can_send_audios: false,
                      can_send_documents: false,
                      can_send_photos: false,
                      can_send_videos: false,
                      can_send_video_notes: false,
                      can_send_voice_notes: false,
                      can_send_polls: false,
                      can_send_other_messages: false,
                      can_add_web_page_previews: false
                    },
                    ...(untilDate ? { until_date: untilDate } : {})
                  });
                } catch (e) {
                  console.warn('[Telegram] Error muting user for fraud keyword:', e);
                }
              } else if (action === 'ban') {
                try {
                  await this.callTelegramApi('banChatMember', {
                    chat_id: message.chat.id,
                    user_id: Number(fromId) || fromId,
                    ...(untilDate ? { until_date: untilDate } : {})
                  });
                } catch (e) {
                  console.warn('[Telegram] Error banning user for fraud keyword:', e);
                }
                await storage.setBotUserBanned(fromId, true);
              }

              // Reset warnings after enforcing final punishment
              await storage.resetUserFraudWarning(message.chat.id, fromId, rule.id);
            }

            // Send notification / warning / Rose-style media+caption reply
            if (action !== 'delete') {
              const hasMedia = Boolean(
                rule.mediaUrl &&
                rule.mediaType &&
                rule.mediaType !== 'text' &&
                rule.mediaType !== 'none'
              );
              const customMsgRaw = (rule.customMessage || rule.warningText || '').trim();
              const templates = await storage.getTemplates();
              const defaultTpl = isReplyOnly
                ? (hasMedia ? '' : '💬 Hello {user_name}, please check this regarding <code>{keyword}</code>.')
                : (templates.FRAUD_KEYWORD_DEFAULT_REPLY?.content ||
                  '⚠️ <b>Warning ({warning_count}/{max_warnings}):</b> Prohibited content detected.\nUser: {user_name} (ID: <code>{user_id}</code>)\nAction taken: {action}');

              const rawMessage = customMsgRaw || defaultTpl;
              const formattedReply = rawMessage
                .replace(/\{user_name\}/g, this.escapeHtml(message.from?.first_name || 'User'))
                .replace(/\{user_id\}/g, fromId)
                .replace(/\{keyword\}/g, this.escapeHtml(rule.keyword))
                .replace(/\{warning_count\}/g, String(currentWarnings))
                .replace(/\{max_warnings\}/g, String(maxWarnings))
                .replace(/\{action\}/g, actionDescription)
                .replace(/\{duration\}/g, duration);

              // Quote-reply directly to the user's message whenever it wasn't deleted (e.g. reply_only or warn)
              const quoteReplyId = !shouldDeleteMessage && message.message_id ? Number(message.message_id) : undefined;
              const threadId = message.message_thread_id ? Number(message.message_thread_id) : undefined;

              if (hasMedia && rule.mediaUrl) {
                const mediaRes = await TelegramService.sendBroadcastMessage({
                  chatId: message.chat.id,
                  message: formattedReply || undefined,
                  mediaType: rule.mediaType as any,
                  mediaUrl: rule.mediaUrl,
                  replyToMessageId: quoteReplyId,
                  threadId
                });

                // Cache newly assigned Telegram file_id back to rule for instant future replies
                if (mediaRes.ok && mediaRes.fileId && rule.mediaUrl !== mediaRes.fileId) {
                  storage.saveFraudRule({ ...rule, mediaUrl: mediaRes.fileId }).catch(() => {});
                }

                // Fallback to text reply if media dispatch failed and we have reply text
                if (!mediaRes.ok && formattedReply) {
                  console.warn('[Telegram] Fraud rule media reply failed, falling back to text:', mediaRes.description);
                  await this.callTelegramApi('sendMessage', {
                    chat_id: message.chat.id,
                    text: formattedReply,
                    parse_mode: 'HTML',
                    ...(quoteReplyId ? { reply_to_message_id: quoteReplyId } : {}),
                    ...(threadId ? { message_thread_id: threadId } : {})
                  });
                }
              } else if (formattedReply) {
                const sendRes = await this.callTelegramApi('sendMessage', {
                  chat_id: message.chat.id,
                  text: formattedReply,
                  parse_mode: 'HTML',
                  ...(quoteReplyId ? { reply_to_message_id: quoteReplyId } : {}),
                  ...(threadId ? { message_thread_id: threadId } : {})
                });
                if (!sendRes?.ok && quoteReplyId) {
                  await this.callTelegramApi('sendMessage', {
                    chat_id: message.chat.id,
                    text: formattedReply,
                    parse_mode: 'HTML',
                    ...(threadId ? { message_thread_id: threadId } : {})
                  });
                }
              }
            }
            return;
          }
        }
      }
    }

    // Multi-Language Translation Trigger in Groups (Method A: `tran bd|ind|eng` | Method B: `/translate bd|ind|eng`, `/bd`, `/ind`, `/eng`)
    if (await this.handleTranslationCommand(message, text, true)) {
      return;
    }

    // Check /filters command in groups (strictly requires '/' prefix)
    const isFilters = /^\/(?:filters|filter)(?:@\w+)?$/i.test(text.trim());
    if (isFilters) {
      await this.handleFiltersCommand(message.chat.id, message.message_id, true);
      return;
    }

    // EXACT TRIGGER MATCHING: Look up item where triggers includes exact text
    const matchedItem = await storage.findItemByTrigger(text);
    if (!matchedItem) {
      // RULE: If not configured, DO NOTHING! Bot remains completely silent!
      return;
    }

    const templates = await storage.getTemplates();
    const botUsername = await this.getBotUsername();
    const userName = message.from?.first_name || message.from?.username || 'User';
    const userId = String(message.from?.id || '');

    if (matchedItem.type === 'file') {
      const isTextOnly = Boolean(matchedItem.isTextOnly || matchedItem.fileEnabled === false);
      const template = isTextOnly
        ? { content: "👇 Tap below — I'll send the message privately." }
        : (templates.GROUP_FILE_REPLY || { content: "👇 Tap below — I'll send your file privately." });
      const buttonTemplate = isTextOnly
        ? { content: '💬 View Message Privately' }
        : (templates.GET_FILE_BUTTON || { content: '🔒 Get File Privately' });

      const replyText = template.content
        .replace('{user_name}', userName)
        .replace('{user_id}', userId)
        .replace('{trigger}', text)
        .replace('{file_name}', matchedItem.fileName || matchedItem.name);

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const buttonText = buttonTemplate.content?.trim() || (isTextOnly ? '💬 View Message Privately' : '📁 Get File Privately');
      const keyboard = [[{ text: buttonText, url: deepLink, style: 'primary' }]];

      const res = await this.sendGroupTriggerReply(
        message.chat.id,
        replyText,
        keyboard,
        message.message_id,
        message.message_thread_id
      );

      if (res && res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
    } else if (matchedItem.type === 'link') {
      const template = templates.GROUP_LINK_REPLY || { content: "👇 Tap below — I'll send the link privately." };
      const buttonTemplate = templates.GET_LINK_BUTTON || { content: '🔗 Open Privately' };

      const replyText = template.content
        .replace('{user_name}', userName)
        .replace('{user_id}', userId)
        .replace('{trigger}', text)
        .replace('{title}', matchedItem.name);

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const buttonText = buttonTemplate.content?.trim() || '🔗 Open Privately';
      const keyboard = [[{ text: buttonText, url: deepLink, style: 'primary' }]];

      const res = await this.sendGroupTriggerReply(
        message.chat.id,
        replyText,
        keyboard,
        message.message_id,
        message.message_thread_id
      );

      if (res && res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
    }
  }

  // Robust error-resilient sender for group trigger replies
  private static async sendGroupTriggerReply(
    chatId: string | number,
    text: string,
    inlineKeyboard: any[][],
    replyToMessageId?: number,
    threadId?: number
  ): Promise<any> {
    const params: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    };
    if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
    if (threadId) params.message_thread_id = threadId;

    let res = await this.callTelegramApi('sendMessage', params);
    if (res && res.ok) return res;

    // Retry 1: If failed with reply_to_message_id (e.g. original message deleted or permission restricted), try without it
    if (params.reply_to_message_id) {
      console.warn(`[Telegram Group] Reply with reply_to_message_id failed (${res?.description}), retrying without reply_to_message_id...`);
      delete params.reply_to_message_id;
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    // Retry 2: If failed with message_thread_id, try without it
    if (params.message_thread_id) {
      console.warn(`[Telegram Group] Reply with message_thread_id failed (${res?.description}), retrying without message_thread_id...`);
      delete params.message_thread_id;
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    // Retry 3: Remove custom style property if Telegram server rejected unknown field
    try {
      const cleanButtons = inlineKeyboard.map(row =>
        row.map(btn => {
          const { style, ...rest } = btn;
          return rest;
        })
      );
      params.reply_markup = { inline_keyboard: cleanButtons };
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    } catch {}

    // Retry 4: Plain text fallback if HTML parse mode or characters failed
    if (params.parse_mode) {
      delete params.parse_mode;
      params.text = text.replace(/<[^>]+>/g, '');
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    console.warn(`[Telegram Group] Group message delivery failed after retries:`, res?.description);
    return res;
  }

  // =========================================================================
  // WELCOME / START MESSAGE DISPATCHER
  // =========================================================================
  public static async sendStartWelcomeMessage(
    chatId: string | number,
    fromId: string,
    message?: any
  ): Promise<void> {
    const templates = await storage.getTemplates();
    const startTemplate = templates.START_MESSAGE;
    let startMsg = startTemplate?.content || "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}\n\n✨ <i>Send any configured trigger hashtag in your group or here to receive your files privately!</i>";
    
    // Comprehensive Username & Name variables
    const cleanUsername = message?.from?.username ? `@${message.from.username.replace(/^@+/, '')}` : '';
    const userDisplayName = [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ') || cleanUsername || 'User';
    const userMention = cleanUsername || userDisplayName;
    const botUsername = await this.getBotUsername();
    const formattedBotName = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'the bot';

    // Replace all variations of @username, username, user_name, user_id, bot_name
    startMsg = startMsg
      .replace(/@?\{@?username\}/gi, userMention)
      .replace(/@username\b/gi, userMention)
      .replace(/\{user_name\}/gi, userDisplayName)
      .replace(/\{name\}/gi, userDisplayName)
      .replace(/\{user\}/gi, userDisplayName)
      .replace(/\{user_id\}/gi, String(fromId))
      .replace(/\{userId\}/gi, String(fromId))
      .replace(/\{id\}/gi, String(fromId))
      .replace(/@?\{@?bot_name\}/gi, formattedBotName)
      .replace(/@?\{@?bot_username\}/gi, formattedBotName)
      .replace(/Hey Friend/gi, `Hey ${userDisplayName}`)
      .replace(/\bFriend\b/gi, userDisplayName)
      .replace(/@@([a-zA-Z0-9_]+)/g, '@$1'); // Avoid double @@

    const mediaType = startTemplate?.mediaType || 'none';
    const mediaUrl = startTemplate?.mediaUrl?.trim();
    const replyMarkup = undefined;

    let sent = false;

    // Check if media is a locally stored uploaded file buffer
    const isLocalUpload = Boolean(mediaUrl && (
      mediaUrl.startsWith('upload_') ||
      mediaUrl.startsWith('local_') ||
      mediaUrl.startsWith('phone_')
    ));

    if (isLocalUpload && mediaUrl) {
      try {
        const up = await storage.getUploadedFile(mediaUrl);
        if (up && up.buffer) {
          const res = await TelegramService.uploadAndDeliverDirectly(chatId, {
            buffer: up.buffer,
            fileName: up.fileName || (mediaType === 'video' ? 'welcome.mp4' : 'welcome.jpg'),
            mimeType: up.mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg'),
            fileType: mediaType === 'video' ? 'video' : 'photo'
          }, startMsg);
          if (res && res.ok) {
            sent = true;
            const realFileId = (res.result?.photo && res.result.photo[res.result.photo.length - 1]?.file_id) ||
              res.result?.video?.file_id ||
              res.result?.document?.file_id;
            if (realFileId) {
              await storage.updateTemplate('START_MESSAGE', startTemplate.content, {
                mediaType: mediaType,
                mediaUrl: realFileId
              });
            }
          }
        }
      } catch (localErr) {
        console.warn('[Telegram] Local upload delivery for start message error:', localErr);
      }
    }

    // 1. Photo support: sendPhoto with formatted HTML caption
    if (!sent && mediaUrl && (mediaType === 'photo' || (mediaType !== 'video' && /\.(jpe?g|png|webp|gif)$/i.test(mediaUrl)))) {
      const res = await this.callTelegramApi('sendPhoto', {
        chat_id: chatId,
        photo: mediaUrl,
        caption: startMsg,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
      if (res.ok) {
        sent = true;
      } else {
        console.warn('[Telegram] sendPhoto failed for /start, falling back to sendMessage:', res.description);
      }
    } else if (!sent && mediaUrl && (mediaType === 'video' || /\.(mp4|mov|webm|m4v)$/i.test(mediaUrl))) {
      // 2. Video support: sendVideo with formatted HTML caption
      const res = await this.callTelegramApi('sendVideo', {
        chat_id: chatId,
        video: mediaUrl,
        caption: startMsg,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
      if (res.ok) {
        sent = true;
      } else {
        console.warn('[Telegram] sendVideo failed for /start, falling back to sendMessage:', res.description);
      }
    }

    // 3. Fallback or Standard text message
    if (!sent) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: startMsg,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  }

  // =========================================================================
  // PRIVATE MESSAGE HANDLING
  // =========================================================================
  private static async handlePrivateMessage(message: any, text: string): Promise<void> {
    const fromId = String(message.from?.id || '');
    const chatId = message.chat.id;

    // 1. Check if user is replying to a message with /editthismessage
    if (text.startsWith('/editthismessage')) {
      await this.handleEditThisMessageCommand(message);
      return;
    }

    // Check if user is in an active /editthismessage session (allow built-in slash commands to bypass cleanly)
    const editSession = activeEditSessions.get(fromId);
    if (editSession && text && !/^\/(?:cancel|start|filters?|allfiles?)(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
      await storage.updateTemplate(editSession.templateKey, text);
      activeEditSessions.delete(fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `✅ Template for "${editSession.templateKey}" updated successfully!`
      });
      return;
    }

    // 2. Start command / Deep linking: /start <payload> (supports /start <payload>, /start@BotUsername <payload>)
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
    if (startMatch) {
      const rawPayload = startMatch[1]?.trim();

      // Mandatory Channel Join (Force Sub) Check
      const forceCheck = await this.checkUserForceSub(fromId);
      if (!forceCheck.allJoined) {
        await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, rawPayload || 'start', undefined, message?.from);
        return;
      }

      if (rawPayload) {
        // Bypass duplicate force-sub check for zero-latency instant file delivery
        await this.handleDeepLinkDelivery(chatId, rawPayload, { skipForceSubCheck: true });
        return;
      } else {
        await this.sendStartWelcomeMessage(chatId, fromId, message);
        return;
      }
    }

    // Admin /clone command in private chat: /clone <bot_token>
    const cloneMatch = text.match(/^\/clone(?:@\w+)?(?:\s+(.+))?$/i);
    if (cloneMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <i>Access Denied. Only authorized administrators can clone bots.</i>',
          parse_mode: 'HTML'
        });
        return;
      }

      const tokenArg = cloneMatch[1]?.trim();
      if (!tokenArg) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Clone Telegram Bot:</b>\n\n1. Open @BotFather on Telegram and create a new bot using <code>/newbot</code>\n2. Copy the HTTP API Token\n3. Send the command here:\n<code>/clone &lt;your_bot_token&gt;</code>\n\n<i>The new bot will automatically start with its own isolated database for files and users.</i>`,
          parse_mode: 'HTML'
        });
        return;
      }

      const result = await TelegramBotManager.cloneBot(tokenArg, fromId);
      if (!result.success) {
        const errorMsg = result.error === 'Already this bot is already running.'
          ? '❌ <b>Already this bot is already running.</b>'
          : `❌ <b>Failed to Clone Bot:</b>\n${result.error || 'Invalid bot token or failed to verify with Telegram.'}`;
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: errorMsg,
          parse_mode: 'HTML'
        });
        return;
      }

      const bot = result.bot!;
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `🤖 <b>Bot Cloned & Activated Successfully!</b>\n\n` +
          `• <b>Bot Name:</b> ${bot.name}\n` +
          `• <b>Username:</b> @${bot.username}\n` +
          `• <b>Bot ID:</b> <code>${bot.id}</code>\n` +
          `• <b>Status:</b> 🟢 Active & Polling\n\n` +
          `🔐 <b>Dedicated Sub-Admin Credentials:</b>\n` +
          `• <b>Panel URL:</b> <a href="${bot.panelUrl}">${bot.panelUrl}</a>\n` +
          `• <b>Admin Username:</b> <code>${bot.adminUsername}</code>\n` +
          `• <b>Admin Password:</b> <code>${bot.adminPassword}</code>\n\n` +
          `✅ <i>This bot is completely isolated with its own private database. The sub-admin can log into the dedicated panel to manage files, filters, and settings independently!</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // Admin /ban command in private chat
    const privBanMatch = text.match(/^\/ban(?:@\w+)?(?:\s+(.+))?$/i);
    if (privBanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (isAdmin && privBanMatch[1]?.trim()) {
        const query = privBanMatch[1].trim();
        const found = await storage.findUserByIdOrUsername(query);
        const targetId = found ? String(found.id) : query.replace(/^@/, '');
        const targetName = found ? (found.firstName || found.username || 'User') : query;
        const targetUsername = found?.username ? `@${found.username.replace(/^@/, '')}` : (query.startsWith('@') ? query : '');
        await storage.setBotUserBanned(targetId, true);
        const userDisplay = targetUsername ? `${targetName} (${targetUsername})` : targetName;
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `OK Boss. ${userDisplay} has been successfully banned.`
        });
        return;
      }
    }

    // Admin /unban command in private chat
    const privUnbanMatch = text.match(/^\/unban(?:@\w+)?(?:\s+(.+))?$/i);
    if (privUnbanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (isAdmin) {
        const query = privUnbanMatch[1]?.trim();
        if (!query) {
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `ℹ️ <b>How to Unban:</b>\nType <code>/unban &lt;user_id_or_username&gt;</code>\nExample: <code>/unban 123456789</code> or <code>/unban @john_doe</code>`,
            parse_mode: 'HTML'
          });
          return;
        }

        const found = await storage.findUserByIdOrUsername(query);
        const targetId = found ? String(found.id) : query.replace(/^@/, '');
        const targetName = found ? (found.firstName || found.username || 'User') : query;
        const targetUsername = found?.username ? `@${found.username.replace(/^@/, '')}` : (query.startsWith('@') ? query : '');
        
        await storage.setBotUserBanned(targetId, false);
        await storage.resetUserLinkWarning(targetId);
        await storage.resetUserFraudWarning(targetId);
        TelegramService.unbanUserInConnectedChats(targetId).catch(() => {});

        const userDisplay = targetUsername ? `${targetName} (${targetUsername})` : targetName;
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `✅ <b>OK Boss. ${userDisplay} has been successfully unbanned.</b>`,
          parse_mode: 'HTML'
        });
        return;
      }
    }

    // /report command in private chat
    const privReportMatch = text.match(/^\/report(?:@\w+)?(?:\s+(.+))?$/i);
    if (privReportMatch) {
      const query = privReportMatch[1]?.trim();
      if (!query) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Report:</b>\nSend <code>/report &lt;@username_or_id&gt; &lt;reason&gt;</code>\nExample: <code>/report @spammer Violating community rules</code>`,
          parse_mode: 'HTML'
        });
        return;
      }

      const parts = query.split(/\s+/);
      const targetQuery = parts[0];
      const reason = parts.slice(1).join(' ').trim() || 'Inappropriate behavior / violation';
      const found = await storage.findUserByIdOrUsername(targetQuery);
      
      const targetUserId = found ? String(found.id) : targetQuery.replace(/^@+/, '');
      const targetUserName = found ? (found.firstName || found.username || 'User') : targetQuery;
      const targetUserUsername = found?.username ? found.username.replace(/^@+/, '') : (targetQuery.startsWith('@') ? targetQuery.replace(/^@+/, '') : undefined);

      const reporter = message.from || {};
      const report = await storage.saveReport({
        id: `rep_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        reporterId: String(reporter.id || fromId),
        reporterName: reporter.first_name || reporter.username || 'User',
        reporterUsername: reporter.username,
        reportedUserId: targetUserId,
        reportedUserName: targetUserName,
        reportedUserUsername: targetUserUsername,
        reason,
        chatId: String(chatId),
        chatTitle: 'Direct Message',
        reportedContent: reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Forward to all admin inboxes
      const admins = await storage.getAdmins();
      const settings = await storage.getSettings();
      const adminTargetIds = new Set<string>();
      if (settings.rootAdminId) adminTargetIds.add(String(settings.rootAdminId).trim());
      if (process.env.ROOT_ADMIN_ID) adminTargetIds.add(String(process.env.ROOT_ADMIN_ID).trim());
      for (const a of admins) {
        if (a.telegramId) adminTargetIds.add(String(a.telegramId).trim());
        if (a.id && /^\d+$/.test(String(a.id))) adminTargetIds.add(String(a.id).trim());
      }

      const adminReportMsg = 
        `🚨 <b>New User Report Filed (DM)</b>\n\n` +
        `👤 <b>Reported User:</b> ${targetUserName} (${targetUserUsername ? '@' + targetUserUsername : `ID: <code>${targetUserId}</code>`})\n` +
        `🆔 <b>User ID:</b> <code>${targetUserId}</code>\n` +
        `📢 <b>Reported By:</b> ${reporter.first_name || 'User'} (${reporter.username ? '@' + reporter.username : `ID: <code>${reporter.id}</code>`})\n` +
        `💬 <b>Direct Message Report</b>\n` +
        `📝 <b>Reason:</b> <i>${this.escapeHtml(reason)}</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🚫 Ban User', callback_data: `admin_ban_user:${targetUserId}:${report.id}` },
            { text: 'Dismiss', callback_data: `admin_dismiss_report:${report.id}` }
          ]
        ]
      };

      for (const adminId of adminTargetIds) {
        try {
          await this.callTelegramApi('sendMessage', {
            chat_id: adminId,
            text: adminReportMsg,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (e) {
          console.warn(`[Telegram] Failed to notify admin ${adminId} of DM report:`, e);
        }
      }

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '✅ <i>Report received and forwarded to administrators for review.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    // Forward-based Private Channel / Group Setup:
    // STRICT REQUIREMENT: Private channel connection must happen EXPLICITLY only when
    // the admin sends the /setchannel (or /connect) command first, followed by forwarding a message from that channel.
    // When an admin is in an /add session, forwarded content MUST be processed as content to save, NEVER as channel connection!
    const forwardChat = message.forward_from_chat ||
      (message.forward_origin && (message.forward_origin.chat || message.forward_origin.sender_chat));

    if (forwardChat && forwardChat.id) {
      if (activeSetChannelSessions.has(fromId)) {
        activeSetChannelSessions.delete(fromId);
        const isAdmin = await this.isAuthorizedAdmin(fromId);
        if (isAdmin) {
          await this.handleForwardedChannelSetup(fromId, chatId, forwardChat);
          return;
        }
      }
      // If NOT in a /setchannel session, DO NOT connect channel!
      // Forwarded messages continue to /add session or normal content processing below!
    }

    // Admin /connect, /addchannel, or /setchannel command
    if (/^\/(?:connect|addchannel|setchannel)(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleConnectCommand(fromId, chatId, text);
      return;
    }

    // Admin /disconnect or /removechannel command
    if (/^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleDisconnectCommand(fromId, chatId, text);
      return;
    }

    // 2a. Multi-Language Translation Trigger in Private Chat (`tran bd|ind|eng`, `/translate bd|ind|eng`, `/bd`, `/ind`, `/eng`)
    if (await this.handleTranslationCommand(message, text, false)) {
      return;
    }

    // 2b. Filters command (/filters, /filter) - Strictly requires '/' prefix
    const isFilters = /^\/(?:filters|filter)(?:@\w+)?$/i.test(text.trim());
    if (isFilters) {
      await this.handleFiltersCommand(chatId, message.message_id, false);
      return;
    }

    // 2c. File listing command (/allfile, /allfiles — defaults to Page 1 with zero arguments required)
    const allFileCmd = this.parseAllFileCommand(text);
    if (allFileCmd.matched) {
      await this.handleFilesListCommand(
        fromId,
        chatId,
        allFileCmd.page,
        message.message_id,
        false,
        undefined,
        message.message_thread_id
      );
      return;
    }

    // 3. Command: /setstartmsg or /startmsg
    if (text.startsWith('/setstartmsg') || text.startsWith('/startmsg')) {
      await this.handleSetStartMessageCommand(fromId, chatId, text, message);
      return;
    }

    // 3b. Command: /setstartmedia or /clearstartmedia
    if (text.startsWith('/setstartmedia')) {
      await this.handleSetStartMediaCommand(fromId, chatId, text, message);
      return;
    }
    if (text === '/clearstartmedia') {
      await this.handleClearStartMediaCommand(fromId, chatId);
      return;
    }

    // 4. Command: /webcode
    if (text === '/webcode') {
      await this.handleWebCodeCommand(fromId, chatId);
      return;
    }

    // 5. Command: /setpassword
    if (text.startsWith('/setpassword')) {
      await this.handleSetPasswordCommand(fromId, chatId, text);
      return;
    }

    // 6. Command: /add (strictly requires '/' prefix)
    const isAddCommand = /^\/add(?:@\w+)?(?:\s+|$)/i.test(text);
    if (isAddCommand) {
      await this.handleAddCommand(fromId, chatId, message, text);
      return;
    }

    // 7. Command: /cancel (strictly requires '/' prefix)
    if (text === '/cancel' || text.startsWith('/cancel')) {
      activeSetChannelSessions.delete(fromId);
      const addSession = activeAddSessions.get(fromId) || await storage.getAddSession(fromId);
      activeAddSessions.delete(fromId);
      await storage.deleteAddSession(fromId);
      activeEditSessions.delete(fromId);

      await this.deleteUserMessage(chatId, message?.message_id);

      const templates = await storage.getTemplates();
      const cancelMsg = templates.CANCEL_MESSAGE?.content || '❌ Operation cancelled.';

      if (addSession?.lastPromptMessageId) {
        try {
          const editRes = await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: addSession.lastPromptMessageId,
            text: cancelMsg,
            parse_mode: 'HTML'
          });
          if (editRes && editRes.ok) return;
        } catch {}
      }

      await this.callTelegramApi('sendMessage', { chat_id: chatId, text: cancelMsg });
      return;
    }

    // 7. Check if user is inside an interactive /add session
    let addSession = activeAddSessions.get(fromId);
    if (!addSession) {
      addSession = await storage.getAddSession(fromId);
      if (addSession) {
        activeAddSessions.set(fromId, addSession);
      }
    }
    if (addSession) {
      await this.handleActiveAddSessionMessage(message, fromId, chatId, text, addSession);
      return;
    }

    // 8. If text matches a configured trigger in private chat: deliver directly!
    if (text) {
      const matchedItem = await storage.findItemByTrigger(text);
      if (matchedItem) {
        const payload = getItemPayload(matchedItem);

        // Check Force Sub
        const forceCheck = await this.checkUserForceSub(fromId);
        if (!forceCheck.allJoined) {
          await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, payload, undefined, message?.from);
          return;
        }

        await this.handleDeepLinkDelivery(chatId, payload);
        return;
      }
    }

    // Check Force Sub on any other direct user interactions in private chat
    const generalForceCheck = await this.checkUserForceSub(fromId);
    if (!generalForceCheck.allJoined) {
      await this.sendForceSubPrompt(chatId, generalForceCheck.unjoinedChannels, 'start', undefined, message?.from);
      return;
    }
  }

  // =========================================================================
  // MULTI-LANGUAGE TRANSLATION SYSTEM (BD -> bn, IND -> hi, ENG -> en)
  // =========================================================================
  private static parseTranslationTrigger(text: string): {
    targetCode: 'bn' | 'hi' | 'en';
    label: string;
    inlineText: string;
  } | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    let rawLang = '';
    let inlineText = '';

    // Method A: `tran bd`, `tran ind`, `tran eng` (also supports optional inline text)
    const methodAMatch = trimmed.match(/^tran(?:slate)?\s+(bd|bn|bangla|bengali|ind|hi|hindi|eng|en|english)(?:\s+([\s\S]+))?$/i);
    if (methodAMatch) {
      rawLang = methodAMatch[1].toLowerCase();
      inlineText = (methodAMatch[2] || '').trim();
    } else {
      // Method B: `/translate bd|ind|eng`, `/bd`, `/ind`, `/eng` (including @botusername suffix)
      const methodBCmdMatch = trimmed.match(/^\/translate(?:@\w+)?\s+(bd|bn|bangla|bengali|ind|hi|hindi|eng|en|english)(?:\s+([\s\S]+))?$/i);
      if (methodBCmdMatch) {
        rawLang = methodBCmdMatch[1].toLowerCase();
        inlineText = (methodBCmdMatch[2] || '').trim();
      } else {
        const methodBShortMatch = trimmed.match(/^\/(bd|ind|eng)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
        if (methodBShortMatch) {
          rawLang = methodBShortMatch[1].toLowerCase();
          inlineText = (methodBShortMatch[2] || '').trim();
        }
      }
    }

    if (!rawLang) return null;

    if (rawLang === 'bd' || rawLang === 'bn' || rawLang === 'bangla' || rawLang === 'bengali') {
      return { targetCode: 'bn', label: '🇧🇩 Bengali (BD)', inlineText };
    }
    if (rawLang === 'ind' || rawLang === 'hi' || rawLang === 'hindi') {
      return { targetCode: 'hi', label: '🇮🇳 Hindi (IND)', inlineText };
    }
    if (rawLang === 'eng' || rawLang === 'en' || rawLang === 'english') {
      return { targetCode: 'en', label: '🇬🇧 English (ENG)', inlineText };
    }

    return null;
  }

  private static translationCache = new Map<string, { text: string; expiresAt: number }>();

  private static splitTextChunks(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let cut = remaining.lastIndexOf('\n', maxLen);
      if (cut < Math.floor(maxLen * 0.4)) {
        cut = remaining.lastIndexOf(' ', maxLen);
      }
      if (cut < Math.floor(maxLen * 0.4)) {
        cut = maxLen;
      }
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).replace(/^\s+/, '');
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
  }

  private static async translateWithGoogleClient(
    chunk: string,
    targetCode: 'bn' | 'hi' | 'en',
    client: 'at' | 'it' | 'gtx'
  ): Promise<{ ok: boolean; text?: string; retryable?: boolean; status?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const userAgent =
        client === 'gtx'
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          : 'GoogleTranslate/6.29.59279 (Linux; U; Android 11; Pixel 5)';
      const url = `https://translate.googleapis.com/translate_a/single?client=${client}&dt=t`;
      const body = new URLSearchParams({ sl: 'auto', tl: targetCode, q: chunk }).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
        },
        body,
        signal: controller.signal
      });
      if (!res.ok) {
        return { ok: false, retryable: res.status === 429 || res.status >= 500, status: res.status };
      }
      const data: any = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const joined = data[0]
          .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
          .join('')
          .trim();
        if (joined) return { ok: true, text: joined };
      }
      return { ok: false, retryable: false, status: res.status };
    } catch (err: any) {
      return { ok: false, retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private static async translateWithMyMemoryChunk(
    chunk: string,
    targetCode: 'bn' | 'hi' | 'en'
  ): Promise<string | null> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=autodetect|${encodeURIComponent(targetCode)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
            continue;
          }
          return null;
        }
        if (!res.ok) return null;

        const data: any = await res.json();
        const responseStatus = Number(data?.responseStatus);
        const details = String(data?.responseDetails || '').toUpperCase();
        const translated = typeof data?.responseData?.translatedText === 'string'
          ? data.responseData.translatedText.trim()
          : '';

        // Same language selected (e.g. translating English text to ENG) -> source text is already in target language
        if (details.includes('SELECT TWO DISTINCT LANGUAGES')) {
          return chunk;
        }

        const isErrorBanner =
          !translated ||
          translated.toUpperCase().includes('MYMEMORY WARNING') ||
          translated.toUpperCase().includes('QUERY LENGTH LIMIT') ||
          translated.toUpperCase().includes('INVALID LANGUAGE PAIR') ||
          translated.toUpperCase().includes('PLEASE SELECT TWO DISTINCT LANGUAGES');

        if (responseStatus === 200 && !isErrorBanner) {
          return translated;
        }
        return null;
      } catch {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
          continue;
        }
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  private static async translateText(sourceText: string, targetCode: 'bn' | 'hi' | 'en'): Promise<string | null> {
    const cleanText = sourceText.trim();
    if (!cleanText) return null;

    const cacheKey = `${targetCode}:${cleanText}`;
    const cached = this.translationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }

    const rememberResult = (val: string) => {
      if (this.translationCache.size >= 300) {
        const oldestKey = this.translationCache.keys().next().value;
        if (oldestKey) this.translationCache.delete(oldestKey);
      }
      this.translationCache.set(cacheKey, { text: val, expiresAt: Date.now() + 10 * 60 * 1000 });
      return val;
    };

    // Tier 1: Google Translate POST with client rotation (at -> it -> gtx) + exponential backoff
    try {
      const googleChunks = this.splitTextChunks(cleanText, 4000);
      const translatedChunks: string[] = [];
      let allGoogleSucceeded = true;

      for (const chunk of googleChunks) {
        const clients: Array<'at' | 'it' | 'gtx'> = ['at', 'it', 'gtx'];
        let chunkResult: string | null = null;

        for (let i = 0; i < clients.length; i++) {
          const client = clients[i];
          for (let attempt = 0; attempt < 2; attempt++) {
            const res = await this.translateWithGoogleClient(chunk, targetCode, client);
            if (res.ok && res.text) {
              chunkResult = res.text;
              break;
            }
            if (!res.retryable) break;
            if (attempt === 0) {
              const backoffMs = 200 * Math.pow(2, i) + Math.floor(Math.random() * 120);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
          if (chunkResult) break;
        }

        if (!chunkResult) {
          allGoogleSucceeded = false;
          break;
        }
        translatedChunks.push(chunkResult);
      }

      if (allGoogleSucceeded && translatedChunks.length > 0) {
        return rememberResult(translatedChunks.join('\n'));
      }
    } catch (err: any) {
      console.warn('[Translate] Google pipeline notice:', err?.message || err);
    }

    // Tier 2: Chunked MyMemory API fallback (up to 450 chars per chunk)
    try {
      const mmChunks = this.splitTextChunks(cleanText, 450);
      const translatedChunks: string[] = [];
      let allMmSucceeded = true;

      for (const chunk of mmChunks) {
        const translatedChunk = await this.translateWithMyMemoryChunk(chunk, targetCode);
        if (!translatedChunk) {
          allMmSucceeded = false;
          break;
        }
        translatedChunks.push(translatedChunk);
      }

      if (allMmSucceeded && translatedChunks.length > 0) {
        return rememberResult(translatedChunks.join('\n'));
      }
    } catch (err: any) {
      console.warn('[Translate] Fallback MyMemory notice:', err?.message || err);
    }

    return null;
  }

  private static async handleTranslationCommand(message: any, text: string, isGroup: boolean): Promise<boolean> {
    const parsed = this.parseTranslationTrigger(text);
    if (!parsed) return false;

    const chatId = message.chat?.id;
    if (!chatId) return true;

    const replied = message.reply_to_message;
    const targetSourceText = (replied?.text || replied?.caption || parsed.inlineText || '').trim();

    if (!targetSourceText) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `ℹ️ <b>Translation Usage:</b>\nReply to any text message with:\n• <code>tran bd</code> / <code>tran ind</code> / <code>tran eng</code>\n• <code>/bd</code> / <code>/ind</code> / <code>/eng</code>\n• <code>/translate bd</code> / <code>/translate ind</code> / <code>/translate eng</code>`,
        parse_mode: 'HTML',
        reply_to_message_id: message.message_id,
        ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
      });
      return true;
    }

    this.callTelegramApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

    const translated = await this.translateText(targetSourceText, parsed.targetCode);
    if (!translated) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ Translation service is temporarily busy. Please try again in a moment.',
        parse_mode: 'HTML',
        reply_to_message_id: replied?.message_id || message.message_id,
        ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
      });
      return true;
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `🌐 <b>Translated (${parsed.label}):</b>\n\n${this.escapeHtml(translated)}`,
      parse_mode: 'HTML',
      reply_to_message_id: replied?.message_id || message.message_id,
      ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
    });
    return true;
  }

  // =========================================================================
  // PRIVATE DELIVERY FLOW (ZERO-LATENCY INSTANT DISPATCH)
  // =========================================================================
  public static async handleDeepLinkDelivery(
    chatId: string | number,
    rawPayload: string,
    options: { includeBackButton?: boolean; messageIdToEdit?: number; skipForceSubCheck?: boolean } = {}
  ): Promise<void> {
    if (!rawPayload) return;

    // Asynchronously record recipient UID without blocking delivery response
    const strChatId = String(chatId || '').trim();
    if (strChatId && !strChatId.startsWith('-') && Number(strChatId) > 0) {
      storage.trackBotUser({ id: chatId }).catch(() => {});
    }

    // Deduplication check for retried webhooks
    if (isDuplicateDelivery(chatId, rawPayload)) {
      console.info('[Telegram] Skipping duplicate delivery for chat:', chatId, 'payload:', rawPayload);
      return;
    }

    // Mandatory Channel Join (Force Sub) Check (skipped when just verified by /start caller)
    if (!options?.skipForceSubCheck) {
      const forceCheck = await this.checkUserForceSub(chatId);
      if (!forceCheck.allJoined) {
        await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, rawPayload);
        return;
      }
    }

    const cleanPayload = rawPayload.trim();
    const normalizedId = cleanPayload.replace(/^(?:f_|l_)+/, '');

    // Super-fast 0ms in-memory item resolution
    let item: ItemRecord | null = (storage as any).resolveItemFast ? (storage as any).resolveItemFast(cleanPayload) : null;
    if (!item) {
      const allItems = await storage.getItems();
      const lowerClean = cleanPayload.toLowerCase();
      item = allItems.find(i =>
        i.id === cleanPayload ||
        i.id === normalizedId ||
        i.id === `f_${normalizedId}` ||
        i.id === `l_${normalizedId}` ||
        (i.rawKeyword && i.rawKeyword.toLowerCase() === lowerClean) ||
        (Array.isArray(i.triggers) && i.triggers.some(t => t.trim().toLowerCase() === lowerClean || t.trim().toLowerCase() === `#${lowerClean}` || t.trim().toLowerCase() === `/${lowerClean}`))
      ) || null;
    }

    if (!item || item.status !== 'active') {
      console.warn('[Telegram] Item not found or inactive for payload:', cleanPayload);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Requested item not found or is no longer active.'
      });
      return;
    }

    // SETUP VIDEO SYSTEM (Admin Panel & Bot Delivery)
    const isSetupVideoActive = Boolean(item.hasSetupVideo === true && item.setupVideoUrl && String(item.setupVideoUrl).trim().length > 0);

    if (!options?.includeBackButton && isSetupVideoActive) {
      await this.sendSetupVideoMenu(chatId, item, options?.messageIdToEdit);
      return;
    }

    const backKeyboard = (options?.includeBackButton && isSetupVideoActive) ? {
      inline_keyboard: [
        [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
      ]
    } : undefined;

    const isTextOnlyItem = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));

    // Delete previous interactive menu message in background if editing is requested
    if (options?.messageIdToEdit) {
      this.callTelegramApi('deleteMessage', {
        chat_id: chatId,
        message_id: options.messageIdToEdit
      }).catch(() => {});
    }

    // Immediately send "⏳ Delivering your file..." notice and capture its promise for cleanup in finally
    const deliveringMsgPromise =
      item.type === 'file' && !isTextOnlyItem && !options?.messageIdToEdit
        ? this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: '⏳ Delivering your file...'
          }).catch(() => null)
        : null;

    // Trigger instant chat action in background (zero blocking)
    const chatAction = item.type === 'file' && !isTextOnlyItem
      ? (item.fileType === 'video' ? 'upload_video' : item.fileType === 'photo' ? 'upload_photo' : 'upload_document')
      : 'typing';
    this.callTelegramApi('sendChatAction', {
      chat_id: chatId,
      action: chatAction
    }).catch(() => {});

    try {
      if (isTextOnlyItem) {
        const messageText = item.replyMessage || item.caption || item.name;
        let res: any = null;

        if (options?.messageIdToEdit) {
          try {
            res = await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: options.messageIdToEdit,
              text: messageText,
              parse_mode: 'HTML',
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res || !res.ok) {
              res = await this.callTelegramApi('editMessageText', {
                chat_id: chatId,
                message_id: options.messageIdToEdit,
                text: messageText,
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } catch {}
        }

        if (!res || !res.ok) {
          res = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML',
            ...(backKeyboard ? { reply_markup: backKeyboard } : {})
          });
          if (!res || !res.ok) {
            res = await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: messageText,
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
          }
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered Only-Text response to chat:', chatId, 'item:', item.id);
          storage.incrementItemDelivery(item.id).catch(() => {});

          const deliveredMessageId = res.result?.message_id;
          if (deliveredMessageId) {
            storage.recordChatDeliveryMessage(chatId, deliveredMessageId).catch(() => {});

            try {
              const settings = await storage.getSettings();
              const autoDeleteEnabled = settings.autoDeleteDeliveryEnabled !== false;
              const timeoutMinutes = settings.deliveryTimeoutMinutes || 10;

              let companionNoticeId: number | undefined = undefined;
              if (autoDeleteEnabled && settings.autoDeleteNoticeEnabled) {
                const noticeRes = await this.callTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ <i>This message will automatically self-destruct in ${timeoutMinutes} ${timeoutMinutes === 1 ? 'minute' : 'minutes'}.</i>`,
                  parse_mode: 'HTML'
                });
                if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
                  companionNoticeId = Number(noticeRes.result.message_id);
                  storage.recordChatDeliveryMessage(chatId, companionNoticeId).catch(() => {});
                }
              }

              if (autoDeleteEnabled) {
                const sched = await storage.scheduleMessageDeletion({
                  chatId: String(chatId),
                  messageId: deliveredMessageId,
                  companionNoticeId,
                  timeoutMinutes,
                  itemTitle: item.name || 'text message'
                });
                TelegramService.armScheduledDeletionTimer(sched);
              }
            } catch (schedErr) {
              console.warn('[Telegram] Could not schedule message auto-delete for text:', schedErr);
            }
          }
        } else {
          console.warn('[Telegram] Only-Text delivery failed:', res?.description);
        }
      } else if (item.type === 'file') {
        const caption = item.caption ? item.caption : undefined;
        let fileIdOrUrl = item.telegramFileId || item.url;

        const isLocalIdentifier = Boolean(fileIdOrUrl && (
          fileIdOrUrl.startsWith('upload_') || 
          fileIdOrUrl.startsWith('local_') || 
          fileIdOrUrl.startsWith('phone_')
        ));

        // Helper to lazily load uploaded buffer ONLY if needed (eliminates latency when telegramFileId is already cached)
        const loadUploadedFileBuffer = async () => {
          const uploadRef = item!.uploadedFileId || item!.telegramFileId || item!.id;
          let uf = uploadRef ? await storage.getUploadedFile(uploadRef) : null;
          if (!uf && item!.id) {
            uf = await storage.getUploadedFile(item!.id);
          }
          if (!uf && item!.telegramFileId) {
            uf = await storage.getUploadedFile(item!.telegramFileId);
          }
          if (!uf && item!.fileBase64) {
            try {
              const buf = Buffer.from(item!.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
              uf = {
                id: item!.uploadedFileId || item!.id,
                fileName: item!.fileName || item!.name || 'file',
                fileType: item!.fileType || 'document',
                mimeType: item!.mimeType || 'application/octet-stream',
                size: buf.length,
                buffer: buf,
                createdAt: item!.createdAt
              };
            } catch {}
          }
          if (!uf && item!.url && item!.url.startsWith('data:')) {
            try {
              const matches = item!.url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                const buf = Buffer.from(matches[2], 'base64');
                uf = {
                  id: item!.id,
                  fileName: item!.fileName || item!.name,
                  fileType: item!.fileType || 'document',
                  mimeType: matches[1],
                  size: buf.length,
                  buffer: buf,
                  createdAt: item!.createdAt
                };
              }
            } catch {}
          }
          return uf;
        };

        let uploadedFile = (isLocalIdentifier || !fileIdOrUrl) ? await loadUploadedFileBuffer() : null;

        let res: any = null;

        // Priority 1: If it's a local upload ID and we have the uploaded file buffer, deliver directly via multipart!
        if (isLocalIdentifier && uploadedFile) {
          console.info('[Telegram] Delivering uploaded file directly via multipart buffer to chat:', chatId, 'file:', uploadedFile.fileName);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
          if (res && res.ok) {
            // Save newly assigned Telegram file_id to item for fast future caching
            const realFileId = res.result?.document?.file_id || 
              (res.result?.photo && res.result.photo[res.result.photo.length - 1]?.file_id) ||
              res.result?.video?.file_id ||
              res.result?.audio?.file_id;
            if (realFileId) {
              item.telegramFileId = realFileId;
              item.uploadedFileId = uploadedFile.id;
              await storage.saveItem(item);
              console.info('[Telegram] Cached real Telegram file_id into item:', realFileId);
            }
          }
        } else if (fileIdOrUrl && !isLocalIdentifier) {
          // Priority 2: Try Telegram API with remote file_id or URL
          if (item.fileType === 'photo') {
            res = await this.callTelegramApi('sendPhoto', {
              chat_id: chatId,
              photo: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else if (item.fileType === 'video') {
            res = await this.callTelegramApi('sendVideo', {
              chat_id: chatId,
              video: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else if (item.fileType === 'audio') {
            res = await this.callTelegramApi('sendAudio', {
              chat_id: chatId,
              audio: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else {
            res = await this.callTelegramApi('sendDocument', {
              chat_id: chatId,
              document: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
          }

          // Fallback if Telegram API rejected remote file_id, lazily load local uploaded buffer if available
          if (!res || !res.ok) {
            if (!uploadedFile) {
              uploadedFile = await loadUploadedFileBuffer();
            }
            if (uploadedFile) {
              console.warn('[Telegram] Remote file_id rejected by Telegram, falling back to direct buffer delivery:', res?.description);
              res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
              if (res && res.ok) {
                const realFileId = res.result?.document?.file_id || 
                  (res.result?.photo && res.result.photo[res.result.photo.length - 1]?.file_id) ||
                  res.result?.video?.file_id ||
                  res.result?.audio?.file_id;
                if (realFileId) {
                  item.telegramFileId = realFileId;
                  item.uploadedFileId = uploadedFile.id;
                  storage.saveItem(item).catch(() => {});
                }
              }
            }
          }
        } else if (uploadedFile) {
          // Priority 3: No fileIdOrUrl specified but uploadedFile buffer is available
          console.info('[Telegram] Delivering uploaded file directly to chat:', chatId);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
          if (res && res.ok) {
            const realFileId = res.result?.document?.file_id || 
              (res.result?.photo && res.result.photo[res.result.photo.length - 1]?.file_id) ||
              res.result?.video?.file_id ||
              res.result?.audio?.file_id;
            if (realFileId) {
              item.telegramFileId = realFileId;
              item.uploadedFileId = uploadedFile.id;
              await storage.saveItem(item);
            }
          }
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered file privately to chat:', chatId, 'item:', item.id);
          await storage.incrementItemDelivery(item.id);

          // =========================================================================
          // 10-MINUTE DELIVERY TIMEOUT & AUTO-REMOVE (SELF-DESTRUCT)
          // =========================================================================
          const deliveredMessageId = res.result?.message_id;
          if (deliveredMessageId) {
            // Fresh Chat: Record the delivered file message for auto-cleanup on future delivery
            await storage.recordChatDeliveryMessage(chatId, deliveredMessageId);

            try {
              const settings = await storage.getSettings();
              const autoDeleteEnabled = settings.autoDeleteDeliveryEnabled !== false;
              const timeoutMinutes = settings.deliveryTimeoutMinutes || 10;

              let companionNoticeId: number | undefined = undefined;
              if (autoDeleteEnabled && settings.autoDeleteNoticeEnabled) {
                const noticeRes = await this.callTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ <i>This file will automatically self-destruct in ${timeoutMinutes} ${timeoutMinutes === 1 ? 'minute' : 'minutes'}. Please save or forward it now.</i>`,
                  parse_mode: 'HTML'
                });
                if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
                  companionNoticeId = Number(noticeRes.result.message_id);
                  await storage.recordChatDeliveryMessage(chatId, companionNoticeId);
                }
              }

              if (autoDeleteEnabled) {
                // Persist scheduled deletion record so it strictly survives restarts and process crashes
                const sched = await storage.scheduleMessageDeletion({
                  chatId: String(chatId),
                  messageId: deliveredMessageId,
                  companionNoticeId,
                  timeoutMinutes,
                  itemTitle: item.fileName || item.name || 'file'
                });

                // Arm immediate in-memory timer
                TelegramService.armScheduledDeletionTimer(sched);
                console.info(`[Telegram] Armed ${timeoutMinutes}-minute auto-delete timer for delivered file message ${deliveredMessageId} in chat ${chatId}`);
              }
            } catch (schedErr) {
              console.warn('[Telegram] Could not schedule message auto-delete:', schedErr);
            }
          }
        } else {
          console.warn('[Telegram] Telegram file delivery failed for item:', item.id, 'error:', res?.description);
          const errorDetail = res?.description || (isLocalIdentifier && !uploadedFile ? 'Uploaded file data is not stored or has expired' : 'File identifier could not be verified by Telegram');
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `⚠️ Could not deliver "${item.fileName || item.name}".\n\nTelegram notice: ${errorDetail}.\nTip: Re-upload this file in the Admin Panel.`
          });
        }
      } else if (item.type === 'link') {
        const messageText = item.replyMessage || `🔗 ${item.name}`;
        const buttonText = (item.buttonText && item.buttonText.trim()) || (item.openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link');

        const isHttps = /^https:\/\//i.test(item.url || '');
        const canUseWebApp = item.openMode === 'webapp' && isHttps;

        const inlineButton: any = { text: buttonText, style: 'primary' };
        if (canUseWebApp) {
          inlineButton.web_app = { url: item.url };
        } else {
          inlineButton.url = item.url;
        }

        const linkKeyboardRows: any[][] = [[inlineButton]];
        if (options?.includeBackButton && isSetupVideoActive) {
          linkKeyboardRows.push([{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]);
        }

        let res: any = null;
        if (options?.messageIdToEdit) {
          try {
            res = await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: options.messageIdToEdit,
              text: messageText,
              reply_markup: {
                inline_keyboard: linkKeyboardRows
              }
            });
          } catch {}
        }

        if (!res || !res.ok) {
          res = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: messageText,
            reply_markup: {
              inline_keyboard: linkKeyboardRows
            }
          });
        }

        // If Telegram rejected web_app button, fallback immediately to regular url button
        if ((!res || !res.ok) && canUseWebApp) {
          console.warn('[Telegram] web_app button delivery rejected, falling back to regular url:', res?.description);
          const fallbackRows: any[][] = [[{ text: buttonText, url: item.url, style: 'primary' }]];
          if (options?.includeBackButton && isSetupVideoActive) {
            fallbackRows.push([{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]);
          }
          if (options?.messageIdToEdit) {
            try {
              res = await this.callTelegramApi('editMessageText', {
                chat_id: chatId,
                message_id: options.messageIdToEdit,
                text: messageText,
                reply_markup: {
                  inline_keyboard: fallbackRows
                }
              });
            } catch {}
          }
          if (!res || !res.ok) {
            res = await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: messageText,
              reply_markup: {
                inline_keyboard: fallbackRows
              }
            });
          }
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered link privately to chat:', chatId, 'item:', item.id);
          await storage.incrementItemDelivery(item.id);
          if (res.result?.message_id) {
            await storage.recordChatDeliveryMessage(chatId, res.result.message_id);
          }
        } else {
          console.warn('[Telegram] Telegram link delivery API failed, sending fallback text:', res?.description);
          const fallbackRes = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `${messageText}\n\n👉 ${item.url}`
          });
          if (fallbackRes && fallbackRes.ok && fallbackRes.result?.message_id) {
            await storage.recordChatDeliveryMessage(chatId, fallbackRes.result.message_id);
          }
          await storage.incrementItemDelivery(item.id);
        }
      }
    } catch (err: any) {
      console.error('[Telegram] Error in delivery execution:', err?.message || err);
    } finally {
      if (deliveringMsgPromise) {
        try {
          const statusRes = await deliveringMsgPromise;
          const statusMsgId = statusRes?.ok ? Number(statusRes.result?.message_id) : undefined;
          if (statusMsgId) {
            await this.callTelegramApi('deleteMessage', {
              chat_id: chatId,
              message_id: statusMsgId
            }).catch(() => {});
          }
        } catch {}
      }
    }
  }

  // =========================================================================
  // SETUP VIDEO SYSTEM (Two-Button Interactive Menu & Video Delivery)
  // =========================================================================
  public static async sendSetupVideoMenu(
    chatId: string | number,
    item: ItemRecord,
    messageIdToEdit?: number
  ): Promise<void> {
    const defaultText = `🎬 <b>Setup Video & Resource Menu</b>\n\n📦 <b>${item.name}</b>\n\nChoose an option below to watch the setup tutorial or access your ${item.type === 'file' ? 'file' : 'link'}:`;
    const text = item.setupVideoMessage?.trim() || defaultText;
    const keyboard = {
      inline_keyboard: [
        [
          { text: item.setupVideoButtonText?.trim() || '🎬 Setup Video', callback_data: `sv_vid_${item.id}`, style: 'primary' },
          { text: item.setupResourceButtonText?.trim() || (item.type === 'file' ? '📁 Get File' : '🔗 Open Link'), callback_data: `sv_item_${item.id}`, style: 'primary' }
        ]
      ]
    };

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        if (editRes && editRes.ok) return;
        // If edit failed (for example, previous message was media), delete it before sending fresh message
        await this.callTelegramApi('deleteMessage', {
          chat_id: chatId,
          message_id: messageIdToEdit
        }).catch(() => {});
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  public static async deliverSetupVideo(
    chatId: string | number,
    item: ItemRecord,
    messageIdToEdit?: number
  ): Promise<void> {
    const backKeyboard = {
      inline_keyboard: [
        [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
      ]
    };

    if (!item.setupVideoUrl) {
      if (messageIdToEdit) {
        try {
          const editRes = await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: messageIdToEdit,
            text: `⚠️ No setup video configured for "${item.name}".`,
            reply_markup: backKeyboard
          });
          if (editRes && editRes.ok) return;
        } catch {}
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `⚠️ No setup video configured for "${item.name}".`,
        reply_markup: backKeyboard
      });
      return;
    }

    const caption = `🎬 <b>Setup Video:</b> ${item.name}`;

    // 1. Check if setup video is stored as an uploaded file
    const isUpload = Boolean(
      item.setupVideoType === 'upload' ||
      item.setupVideoUrl.startsWith('upload_') ||
      item.setupVideoUrl.startsWith('local_') ||
      item.setupVideoUrl.startsWith('phone_')
    );

    let uploadedVideo = isUpload ? await storage.getUploadedFile(item.setupVideoUrl) : null;
    if (!uploadedVideo && item.setupVideoFileName) {
      uploadedVideo = await storage.getUploadedFile(item.setupVideoFileName);
    }

    if (uploadedVideo && uploadedVideo.buffer) {
      if (messageIdToEdit) {
        try {
          await this.callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageIdToEdit });
        } catch {}
      }
      const res = await TelegramService.uploadAndDeliverDirectly(chatId, {
        buffer: uploadedVideo.buffer,
        fileName: uploadedVideo.fileName || 'setup_video.mp4',
        mimeType: uploadedVideo.mimeType || 'video/mp4',
        fileType: 'video'
      }, caption, backKeyboard);

      if (res && res.ok) return;
    }

    // 2. If it's a URL or fileId: try sendVideo if it's direct video file or fileId
    const isExternalUrl = /^https?:\/\//i.test(item.setupVideoUrl);
    const isDirectVideoExt = /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(item.setupVideoUrl);

    if (!isExternalUrl || isDirectVideoExt) {
      if (messageIdToEdit) {
        try {
          await this.callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageIdToEdit });
        } catch {}
      }
      let res = await this.callTelegramApi('sendVideo', {
        chat_id: chatId,
        video: item.setupVideoUrl,
        caption,
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      });

      if (res && res.ok) return;
    }

    // 3. If external web link (e.g. YouTube, tutorial URL): edit existing message in place seamlessly!
    const videoButtonRow: any[] = [];
    if (isExternalUrl) {
      videoButtonRow.push({ text: '▶️ Watch Setup Video', url: item.setupVideoUrl, style: 'primary' });
    }
    const inlineKeyboard = [
      ...(videoButtonRow.length > 0 ? [videoButtonRow] : []),
      [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
    ];
    const textMsg = `🎬 <b>Setup Video Tutorial</b>\n\n📦 <b>${item.name}</b>\n\n${item.setupVideoUrl}`;

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text: textMsg,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
        if (editRes && editRes.ok) return;
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: textMsg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  }

  // =========================================================================
  // BROADCAST NOTIFICATION SYSTEM (Rich Media: Photo, Video, Audio, Voice, Text)
  // =========================================================================
  public static async sendBroadcastMessage(params: {
    chatId: string | number;
    message?: string;
    mediaType: 'text' | 'photo' | 'video' | 'audio' | 'voice';
    mediaUrl?: string; // URL, Telegram file_id, or local upload_*/local_* identifier
    fileBuffer?: Buffer;
    fileName?: string;
    mimeType?: string;
    pinMessage?: boolean;
    replyToMessageId?: number;
    threadId?: number;
  }): Promise<{ ok: boolean; messageId?: number; fileId?: string; description?: string }> {
    const token = await this.getBotToken();
    if (!token) return { ok: false, description: 'No bot token configured' };

    const chatId = String(params.chatId);
    const captionRaw = params.message?.trim() || undefined;
    const caption = captionRaw && captionRaw.length > 1024 ? `${captionRaw.slice(0, 1020)}...` : captionRaw;
    const mediaType = params.mediaType || 'text';
    const replyToMessageId = params.replyToMessageId ? Number(params.replyToMessageId) : undefined;
    const threadId = params.threadId ? Number(params.threadId) : undefined;

    // 1. Text-Only Message
    if (mediaType === 'text') {
      let res = await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: params.message || '',
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        ...(threadId ? { message_thread_id: threadId } : {})
      });
      if ((!res || !res.ok) && replyToMessageId) {
        res = await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: params.message || '',
          parse_mode: 'HTML',
          ...(threadId ? { message_thread_id: threadId } : {})
        });
      }
      if (res && res.ok && params.pinMessage && res.result?.message_id) {
        await this.callTelegramApi('pinChatMessage', {
          chat_id: chatId,
          message_id: res.result.message_id
        }).catch(() => {});
      }
      return { ok: Boolean(res && res.ok), messageId: res?.result?.message_id, description: res?.description };
    }

    // Resolve locally uploaded media buffer if mediaUrl points to a local upload identifier (upload_*, local_*, phone_*)
    let fileBuffer = params.fileBuffer;
    let fileName = params.fileName;
    let mimeType = params.mimeType;
    const isLocalMediaId = Boolean(
      params.mediaUrl &&
      (params.mediaUrl.startsWith('upload_') ||
        params.mediaUrl.startsWith('local_') ||
        params.mediaUrl.startsWith('phone_'))
    );

    if (!fileBuffer && isLocalMediaId && params.mediaUrl) {
      try {
        const uploaded = await storage.getUploadedFile(params.mediaUrl);
        if (uploaded && uploaded.buffer) {
          fileBuffer = uploaded.buffer;
          fileName = fileName || uploaded.fileName;
          mimeType = mimeType || uploaded.mimeType;
        }
      } catch (lookupErr) {
        console.warn('[Telegram] Failed to load local media buffer for rule/broadcast:', lookupErr);
      }
    }

    // 2. Media via existing Telegram file_id or external URL
    if (params.mediaUrl && !isLocalMediaId && !fileBuffer) {
      let method = 'sendPhoto';
      let field = 'photo';
      if (mediaType === 'video') {
        method = 'sendVideo';
        field = 'video';
      } else if (mediaType === 'audio') {
        method = 'sendAudio';
        field = 'audio';
      } else if (mediaType === 'voice') {
        method = 'sendVoice';
        field = 'voice';
      }

      const basePayload: Record<string, any> = {
        chat_id: chatId,
        [field]: params.mediaUrl,
        ...(caption ? { caption, parse_mode: 'HTML' } : {}),
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        ...(threadId ? { message_thread_id: threadId } : {})
      };

      let res = await this.callTelegramApi(method, basePayload);
      // Retry without reply_to_message_id if Telegram rejected the quoted message
      if ((!res || !res.ok) && replyToMessageId) {
        const retryPayload = { ...basePayload };
        delete retryPayload.reply_to_message_id;
        res = await this.callTelegramApi(method, retryPayload);
      }
      // Retry without parse_mode if HTML tags failed to parse
      if ((!res || !res.ok) && caption) {
        const plainPayload: Record<string, any> = {
          chat_id: chatId,
          [field]: params.mediaUrl,
          caption: caption.replace(/<[^>]+>/g, ''),
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
          ...(threadId ? { message_thread_id: threadId } : {})
        };
        res = await this.callTelegramApi(method, plainPayload);
      }

      if (res && res.ok && params.pinMessage && res.result?.message_id) {
        await this.callTelegramApi('pinChatMessage', {
          chat_id: chatId,
          message_id: res.result.message_id
        }).catch(() => {});
      }

      if (res && res.ok) {
        const fileId = res.result?.photo ? res.result.photo[res.result.photo.length - 1]?.file_id :
          res.result?.video?.file_id || res.result?.audio?.file_id || res.result?.voice?.file_id;
        return { ok: true, messageId: res.result?.message_id, fileId, description: res.description };
      }

      // Check if local uploaded buffer exists under this key as last-resort fallback
      try {
        const uploaded = await storage.getUploadedFile(params.mediaUrl);
        if (uploaded && uploaded.buffer) {
          fileBuffer = uploaded.buffer;
          fileName = fileName || uploaded.fileName;
          mimeType = mimeType || uploaded.mimeType;
        }
      } catch {}

      if (!fileBuffer) {
        return { ok: false, messageId: res?.result?.message_id, description: res?.description };
      }
    }

    // 3. Media via uploaded Buffer (multipart FormData)
    if (fileBuffer) {
      let normalizedBuf: Buffer;
      if (Buffer.isBuffer(fileBuffer)) {
        normalizedBuf = fileBuffer;
      } else if ((fileBuffer as any)?.data) {
        normalizedBuf = Buffer.from((fileBuffer as any).data);
      } else if (typeof fileBuffer === 'string') {
        normalizedBuf = Buffer.from(fileBuffer, 'base64');
      } else {
        normalizedBuf = Buffer.from(fileBuffer);
      }

      let method = 'sendPhoto';
      let fieldName = 'photo';
      if (mediaType === 'video') {
        method = 'sendVideo';
        fieldName = 'video';
      } else if (mediaType === 'audio') {
        method = 'sendAudio';
        fieldName = 'audio';
      } else if (mediaType === 'voice') {
        method = 'sendVoice';
        fieldName = 'voice';
      }

      const sendMultipart = async (useReply: boolean, useHtml: boolean) => {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        if (caption) {
          formData.append('caption', useHtml ? caption : caption.replace(/<[^>]+>/g, ''));
          if (useHtml) formData.append('parse_mode', 'HTML');
        }
        if (useReply && replyToMessageId) {
          formData.append('reply_to_message_id', String(replyToMessageId));
        }
        if (threadId) {
          formData.append('message_thread_id', String(threadId));
        }

        const blob = new Blob([new Uint8Array(normalizedBuf)] as any, {
          type: mimeType || (mediaType === 'photo' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : mediaType === 'voice' ? 'audio/ogg' : 'audio/mpeg')
        });
        formData.append(fieldName, blob, fileName || (mediaType === 'photo' ? 'photo.jpg' : mediaType === 'video' ? 'video.mp4' : mediaType === 'voice' ? 'voice.ogg' : 'audio.mp3'));

        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          body: formData
        });
        return await res.json();
      };

      try {
        let data = await sendMultipart(true, true);
        if (!data.ok && replyToMessageId) {
          data = await sendMultipart(false, true);
        }
        if (!data.ok && caption) {
          data = await sendMultipart(Boolean(replyToMessageId), false);
        }
        if (data.ok && params.pinMessage && data.result?.message_id) {
          await this.callTelegramApi('pinChatMessage', {
            chat_id: chatId,
            message_id: data.result.message_id
          }).catch(() => {});
        }
        const fileId = data.result?.photo ? data.result.photo[data.result.photo.length - 1]?.file_id :
          data.result?.video?.file_id || data.result?.audio?.file_id || data.result?.voice?.file_id;

        return { ok: Boolean(data.ok), messageId: data.result?.message_id, fileId, description: data.description };
      } catch (err: any) {
        return { ok: false, description: err.message };
      }
    }

    return { ok: false, description: 'No media or message content specified' };
  }

  // =========================================================================
  // QUICK FILE KEYWORDS / FILTERS COMMAND (/filters, /filter, #filters)
  // =========================================================================
  private static async handleFiltersCommand(chatId: number | string, messageId?: number, isGroup: boolean = false): Promise<void> {
    await storage.loadLatest(false);
    const items = await storage.getItems();
    const templates = await storage.getTemplates();
    const botUsername = await this.getBotUsername();

    // STRICT RULE: Only include active items explicitly added to the filters list (inFiltersList === true)
    const filterItems = items.filter(item => item.status === 'active' && item.inFiltersList === true);

    const hashtags: string[] = [];
    for (const item of filterItems) {
      if (Array.isArray(item.triggers) && item.triggers.length > 0) {
        for (const trg of item.triggers) {
          const clean = trg.trim();
          // STRICT RULE: Only valid hashtags starting with '#'. Ignore/reject slash commands or plain text!
          if (clean.startsWith('#') && clean.length > 1) {
            hashtags.push(clean);
          }
        }
      }
    }

    // Strictly sequential chronological order (FIFO): first added hashtag stays at the very top position
    const uniqueTags = Array.from(new Set(hashtags));

    let formattedKeywords = '';
    if (uniqueTags.length === 0) {
      formattedKeywords = '<i>(No file hashtags added to public filters yet)</i>';
    } else {
      // Monospaced <code>#keyword</code> allows ONE-TAP COPY on mobile Telegram!
      formattedKeywords = uniqueTags.map((tag) => `<code>${tag}</code>`).join('\n');
    }

    const defaultTpl = "📁 <b>Quick File Keywords</b>\nType any of these (in a group or here) and I'll DM you the file:\n\n{keywords}";
    const tplContent = templates.FILTERS_MESSAGE?.content || defaultTpl;

    const formattedBotName = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'Bot';
    const messageText = tplContent
      .replace(/\{keywords\}/g, formattedKeywords)
      .replace(/\{bot_name\}/g, formattedBotName);

    // User request: No inline buttons under filter keywords
    const params: any = {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML'
    };

    if (isGroup && messageId) {
      params.reply_to_message_id = messageId;
    }

    const res = await this.callTelegramApi('sendMessage', params);
    if (res.ok && res.result?.message_id && isGroup) {
      await this.trackAndLimitMessage(Number(chatId), res.result.message_id);
    }
  }

  // =========================================================================
  // INTERACTIVE FILE LISTING & LINK COPYING COMMAND (/allfile, /allfiles)
  // =========================================================================
  private static parseAllFileCommand(rawText: string): { matched: boolean; page: number } {
    const cleaned = String(rawText || '')
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
      .trim();
    const match = cleaned.match(/^\/allfiles?(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
    if (!match) {
      return { matched: false, page: 1 };
    }
    const argText = (match[1] || '').trim();
    const numMatch = argText.match(/\d+/);
    const page = numMatch ? Math.max(1, parseInt(numMatch[0], 10) || 1) : 1;
    return { matched: true, page };
  }

  private static buildFilesListView(requestedPage: number = 1): {
    text: string;
    inlineKeyboard: any[][];
    totalItems: number;
    page: number;
    totalPages: number;
  } {
    // Instant O(1) pre-sorted & pre-indexed retrieval from memory (zero DB/cloud lag)
    const activeItems = storage.getItemsFast();

    const pageSize = 10;
    const totalItems = activeItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safeReqPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
    const page = Math.min(Math.max(1, safeReqPage), totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageItems = activeItems.slice(startIdx, startIdx + pageSize);

    if (totalItems === 0) {
      return {
        text: '📁 <b>No files found in the database.</b>',
        inlineKeyboard: [
          [
            { text: '🔄 Refresh', callback_data: 'fl_p:1', style: 'primary' },
            { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
          ]
        ],
        totalItems: 0,
        page: 1,
        totalPages: 1
      };
    }

    const fileCount = activeItems.filter((i) => i.type === 'file' && !i.isTextOnly && i.fileEnabled !== false).length;
    const linkCount = activeItems.filter((i) => i.type === 'link').length;
    const textCount = totalItems - fileCount - linkCount;

    const summaryParts = [
      fileCount > 0 ? `📁 ${fileCount} Files` : null,
      linkCount > 0 ? `🔗 ${linkCount} Links` : null,
      textCount > 0 ? `💬 ${textCount} Text` : null
    ].filter(Boolean);

    const text =
      `📂 <b>All Stored Files &amp; Links (${totalItems})</b>\n` +
      `<i>${summaryParts.join(' • ')}</i>\n` +
      `📄 Page <b>${page}</b> of <b>${totalPages}</b>\n\n` +
      `👇 <i>Tap any item below to view details &amp; copy its link:</i>`;

    const rows: any[][] = pageItems.map((item, idx) => {
      const num = startIdx + idx + 1;
      const isTextOnly = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));
      const icon =
        item.type === 'link'
          ? '🔗'
          : isTextOnly
          ? '💬'
          : item.fileType === 'video'
          ? '🎥'
          : item.fileType === 'photo'
          ? '🖼️'
          : item.fileType === 'audio'
          ? '🎵'
          : '📄';
      const rawTitle = (item.fileName || item.name || item.rawKeyword || 'Untitled')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled';
      const shortTitle = rawTitle.length > 42 ? `${rawTitle.slice(0, 39)}...` : rawTitle;
      const fullCb = `fl_v:${item.id}:${page}`;
      const cbData = Buffer.byteLength(fullCb, 'utf8') <= 64
        ? fullCb
        : `fl_v:${item.id}`.slice(0, 64);
      return [{ text: `${num}. ${icon} ${shortTitle}`, callback_data: cbData, style: 'primary' }];
    });

    if (totalPages > 1) {
      const navRow: any[] = [];
      if (page > 1) {
        navRow.push({ text: '⬅️ Prev', callback_data: `fl_p:${page - 1}`, style: 'primary' });
      }
      navRow.push({ text: `📄 ${page} / ${totalPages}`, callback_data: 'fl_noop', style: 'primary' });
      if (page < totalPages) {
        navRow.push({ text: 'Next ➡️', callback_data: `fl_p:${page + 1}`, style: 'primary' });
      }
      rows.push(navRow);
    }

    rows.push([
      { text: '🔄 Refresh', callback_data: `fl_p:${page}`, style: 'primary' },
      { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
    ]);

    return { text, inlineKeyboard: rows, totalItems, page, totalPages };
  }

  private static async buildFileDetailView(item: ItemRecord, returnPage: number = 1): Promise<{
    text: string;
    deepLink: string;
    primaryKeyboard: any[][];
    fallbackKeyboard: any[][];
  }> {
    const botUsername = await this.getBotUsername();
    const cleanBotUsername = botUsername.replace(/^@/, '').trim();
    const payload = getItemPayload(item);
    const deepLink = cleanBotUsername
      ? `https://t.me/${cleanBotUsername}?start=${payload}`
      : `?start=${payload}`;

    const isTextOnly = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));
    const typeLabel =
      item.type === 'link'
        ? '🔗 Link'
        : isTextOnly
        ? '💬 Text Message'
        : item.fileType === 'video'
        ? '🎥 Video'
        : item.fileType === 'photo'
        ? '🖼️ Photo'
        : item.fileType === 'audio'
        ? '🎵 Audio'
        : '📄 Document / File';

    const title = (item.fileName || item.name || 'Untitled').trim();
    const triggerList = Array.isArray(item.triggers) && item.triggers.length > 0
      ? item.triggers.slice(0, 5).map((t) => `<code>${this.escapeHtml(t)}</code>`).join(', ')
      : '<i>None</i>';

    const text =
      `📦 <b>${this.escapeHtml(title)}</b>\n\n` +
      `• <b>Type:</b> ${typeLabel}\n` +
      `• <b>Triggers:</b> ${triggerList}\n` +
      `• <b>Deliveries:</b> ${item.deliveryCount || 0}\n\n` +
      `🔗 <b>Direct Start Link:</b>\n<code>${this.escapeHtml(deepLink)}</code>\n\n` +
      `👇 <i>Tap <b>🔗 Copy Link</b> below to copy and share:</i>`;

    const copyBtnPrimary: any = cleanBotUsername
      ? { text: '🔗 Copy Link', copy_text: { text: deepLink }, style: 'success' }
      : { text: '🔗 Copy Link', callback_data: `fl_copy:${item.id}`, style: 'success' };

    const actionRowFallback: any[] = [
      { text: '🔗 Copy Link', callback_data: `fl_copy:${item.id}`, style: 'success' },
      ...(cleanBotUsername ? [{ text: '↗️ Open Link', url: deepLink, style: 'success' }] : [])
    ];

    const primaryKeyboard: any[][] = [
      [copyBtnPrimary],
      [
        { text: '📋 Send Copyable Link', callback_data: `fl_copy:${item.id}`, style: 'success' },
        ...(cleanBotUsername ? [{ text: '↗️ Open Link', url: deepLink, style: 'success' }] : [])
      ],
      [
        { text: '⬅️ Back to File List', callback_data: `fl_p:${returnPage}`, style: 'primary' },
        { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
      ]
    ];

    const fallbackKeyboard: any[][] = [
      actionRowFallback,
      [
        { text: '⬅️ Back to File List', callback_data: `fl_p:${returnPage}`, style: 'primary' },
        { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
      ]
    ];

    return { text, deepLink, primaryKeyboard, fallbackKeyboard };
  }

  private static async handleFilesListCommand(
    _fromId: string,
    chatId: number | string,
    page: number = 1,
    replyToMessageId?: number,
    _isGroup: boolean = false,
    editMessageId?: number,
    threadId?: number
  ): Promise<void> {
    try {
      // Ensure database cache is initialized (0.01ms no-op when already warm in memory)
      await storage.loadLatest(false);
      if (storage.getItemsFast().length === 0) {
        await storage.loadLatest(true).catch(() => {});
      }
      const view = this.buildFilesListView(page);

      if (editMessageId) {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: editMessageId,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: view.inlineKeyboard }
        });

        if (editRes?.ok) {
          return;
        }

        const desc = String(editRes?.description || '').toLowerCase();
        // Telegram returns "message is not modified" if Refresh/page is already identical; ignore cleanly
        if (desc.includes('not modified')) {
          return;
        }

        console.warn('[Telegram] /allfile editMessageText notice:', editRes?.description || 'unknown error');
        // If message can't be edited (e.g., too old or deleted), deliver updated page cleanly via sendMessage
        const fallbackSendParams: any = {
          chat_id: chatId,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: view.inlineKeyboard }
        };
        if (threadId) fallbackSendParams.message_thread_id = threadId;
        await this.callTelegramApi('sendMessage', fallbackSendParams);
        return;
      }

      const params: any = {
        chat_id: chatId,
        text: view.text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: view.inlineKeyboard }
      };
      if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
      if (threadId) params.message_thread_id = threadId;

      const res = await this.callTelegramApi('sendMessage', params);
      if (!res?.ok && params.reply_to_message_id) {
        delete params.reply_to_message_id;
        await this.callTelegramApi('sendMessage', params);
      }
    } catch (err: any) {
      console.error('[Telegram] /allfile command error:', err?.message || err);
      const errParams: any = {
        chat_id: chatId,
        text: '❌ Unable to load the file list right now. Please try again in a moment.'
      };
      if (replyToMessageId && !editMessageId) errParams.reply_to_message_id = replyToMessageId;
      if (threadId) errParams.message_thread_id = threadId;
      await this.callTelegramApi('sendMessage', errParams).catch(() => {});
    }
  }

  // =========================================================================
  // ADMIN COMMANDS
  // =========================================================================
  private static async handleWebCodeCommand(fromId: string, chatId: string | number): Promise<void> {
    await storage.loadLatest(true);
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = (process.env.ROOT_ADMIN_ID || settings.rootAdminId || '').trim();
    const isRoot = rootAdminId && rootAdminId === fromId;
    const isFirstAdmin = (await storage.getAdmins()).length === 0;

    if (!admin && !isRoot && !isFirstAdmin) {
      console.warn('[Telegram] /webcode rejected: sender not authorized telegramId:', fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Access denied. You are not a registered administrator.'
      });
      return;
    }

    try {
      const code = await storage.createWebCode(fromId);
      console.info('[Telegram] /webcode generated successfully for telegramId:', fromId);
      const templates = await storage.getTemplates();
      const tpl = templates.WEB_CODE_MESSAGE?.content || '🔐 Web Admin Verification Code\n\n{code}\n\nValid for 10 minutes.';
      const reply = tpl.replace('{code}', code);

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: reply
      });
    } catch (err: any) {
      console.error('[Telegram] Failed to generate/save webcode for telegramId:', fromId, err?.message);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Storage error generating verification code. Please try again.'
      });
    }
  }

  private static async handleSetPasswordCommand(fromId: string, chatId: string | number, text: string): Promise<void> {
    await storage.loadLatest(true);
    const settings = await storage.getSettings();
    const admin = await storage.getAdmin(fromId);
    const rootAdminId = (process.env.ROOT_ADMIN_ID || settings.rootAdminId || '').trim();
    const isRoot = rootAdminId && rootAdminId === fromId;
    const isFirstAdmin = (await storage.getAdmins()).length === 0;

    if (!isRoot && !admin && !isFirstAdmin) {
      console.warn('[Telegram] /setpassword rejected: unauthorized sender telegramId:', fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Access denied. You must be an authorized admin to use /setpassword.'
      });
      return;
    }

    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ Usage: /setpassword <new_password>'
      });
      return;
    }

    const newPassword = parts.slice(1).join(' ').trim();
    if (newPassword.length < 6) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Password must be at least 6 characters.'
      });
      return;
    }

    const hash = await hashPassword(newPassword);

    let saved = false;
    if (admin) {
      admin.id = fromId;
      admin.telegramId = fromId;
      admin.passwordHash = hash;
      saved = await storage.saveAdmin(admin);
    } else {
      // Create owner admin entry
      saved = await storage.saveAdmin({
        id: fromId,
        telegramId: fromId,
        name: 'Owner Admin',
        role: 'owner',
        passwordHash: hash,
        permissions: {
          files_view: true, files_add: true, files_edit: true, files_delete: true,
          links_view: true, links_add: true, links_edit: true, links_delete: true,
          messages_view: true, messages_edit: true, admins_manage: true,
          design_edit: true, settings_edit: true, cleanup_manage: true
        },
        enabled: true,
        createdAt: new Date().toISOString()
      });
      if (isFirstAdmin || isRoot) {
        await storage.updateSettings({ rootAdminId: fromId });
      }
    }

    if (!saved) {
      console.error('[Telegram] Failed to save password for admin telegramId:', fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Storage error: Failed to update password in persistent storage. Please try again.'
      });
      return;
    }

    console.info('[Telegram] /setpassword successfully updated and saved for admin telegramId:', fromId);
    const templates = await storage.getTemplates();
    const tpl = templates.PASSWORD_UPDATED?.content || '✅ Password updated successfully. You can now log in to the web panel.';
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: tpl
    });
  }

  private static extractMediaFromMessage(msg: any): {
    fileId: string;
    fileUniqueId: string;
    fileType: 'document' | 'photo' | 'video' | 'audio';
    fileName: string;
    fileSize: number;
    mimeType: string;
  } | null {
    if (!msg) return null;
    if (msg.document) {
      return {
        fileId: msg.document.file_id,
        fileUniqueId: msg.document.file_unique_id,
        fileType: 'document',
        fileName: msg.document.file_name || 'document',
        fileSize: msg.document.file_size || 0,
        mimeType: msg.document.mime_type || ''
      };
    }
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      return {
        fileId: largest.file_id,
        fileUniqueId: largest.file_unique_id,
        fileType: 'photo',
        fileName: 'photo.jpg',
        fileSize: largest.file_size || 0,
        mimeType: 'image/jpeg'
      };
    }
    if (msg.video) {
      return {
        fileId: msg.video.file_id,
        fileUniqueId: msg.video.file_unique_id,
        fileType: 'video',
        fileName: msg.video.file_name || 'video.mp4',
        fileSize: msg.video.file_size || 0,
        mimeType: msg.video.mime_type || 'video/mp4'
      };
    }
    if (msg.audio) {
      return {
        fileId: msg.audio.file_id,
        fileUniqueId: msg.audio.file_unique_id,
        fileType: 'audio',
        fileName: msg.audio.file_name || 'audio.mp3',
        fileSize: msg.audio.file_size || 0,
        mimeType: msg.audio.mime_type || 'audio/mpeg'
      };
    }
    return null;
  }

  private static async handleAddCommand(
    fromId: string,
    chatId: string | number,
    message?: any,
    text?: string
  ): Promise<void> {
    await storage.loadLatest(true);
    const admins = await storage.getAdmins();
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
    const isRoot = fromId === rootAdminId || rootAdminId.includes(fromId) || admin?.role === 'owner';
    const hasPermission = isRoot || Boolean(admin?.permissions?.files_add) || admins.some(a => String(a.telegramId) === fromId || String(a.id) === fromId) || admins.length === 0;

    if (!hasPermission) {
      if (String(chatId).startsWith('-')) {
        return;
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `❌ Access Denied: You are not an authorized administrator.\nYour Telegram ID: <code>${fromId}</code>\nPlease ask an administrator to add your ID or sign in via web.`,
        parse_mode: 'HTML'
      });
      return;
    }

    // Delete the /add command message cleanly so chat remains uncluttered
    if (message?.message_id) {
      await this.deleteUserMessage(chatId, message.message_id);
    }

    // Ensure any channel connection session is cleared so /add strictly processes content
    activeSetChannelSessions.delete(fromId);

    const replyMsg = message?.reply_to_message;
    const media = this.extractMediaFromMessage(message) || (replyMsg ? this.extractMediaFromMessage(replyMsg) : null);
    const rawInput = (text || message?.caption || replyMsg?.text || replyMsg?.caption || '').trim();
    const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);

    if (media) {
      const sessionData: AddSession = {
        stage: 'awaiting_trigger_type',
        type: 'file',
        fileData: media,
        caption: (message?.caption && !/^(?:\/|#)?(?:add)/i.test(message.caption) ? message.caption : replyMsg?.caption) || undefined
      };

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `✅ <b>File Received:</b> <i>${media.fileName}</i>\n\n<b>Step 1/4: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
        {
          inline_keyboard: [
            [
              { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
              { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
              { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        sessionData
      );
      if (promptId) sessionData.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, sessionData);
      await storage.saveAddSession(fromId, sessionData);
      return;
    }

    if (urlMatch && !/^\/add(?:@\w+)?$/i.test(text?.trim() || '')) {
      const sessionData: AddSession = {
        stage: 'awaiting_trigger_type',
        type: 'link',
        linkData: {
          url: urlMatch[0]
        }
      };

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `✅ <b>Link Received:</b> <code>${urlMatch[0]}</code>\n\n<b>Step 1/7: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
        {
          inline_keyboard: [
            [
              { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
              { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
              { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        sessionData
      );
      if (promptId) sessionData.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, sessionData);
      await storage.saveAddSession(fromId, sessionData);
      return;
    }

    // Command Entry: When an admin types /add, the bot asks what they want to add
    const sessionData: AddSession = { stage: 'awaiting_content' };
    const promptId = await TelegramService.sendOrEditSetupPrompt(
      chatId,
      `📥 <b>What would you like to add?</b>\n\nChoose an option below or send your content directly:\n• <b>File:</b> Document, Photo, Video, Audio, APK, ZIP\n• <b>Link:</b> Website URL (https://...)\n• <b>Text Response:</b> Custom text / message`,
      {
        inline_keyboard: [
          [
            { text: '📁 Add File', callback_data: 'add_choose_file', style: 'primary' },
            { text: '🔗 Add Link', callback_data: 'add_choose_link', style: 'primary' },
            { text: '💬 Add Text', callback_data: 'add_choose_text', style: 'primary' }
          ],
          [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
        ]
      },
      sessionData
    );
    if (promptId) sessionData.lastPromptMessageId = promptId;
    activeAddSessions.set(fromId, sessionData);
    await storage.saveAddSession(fromId, sessionData);
  }

  private static async handleActiveAddSessionMessage(
    message: any,
    fromId: string,
    chatId: string | number,
    text: string,
    session: AddSession
  ): Promise<void> {
    // Automatically delete user's intermediate input message so chat remains in a single dynamic bubble
    if (message?.message_id) {
      await this.deleteUserMessage(chatId, message.message_id);
    }

    const rawInput = text.trim();

    // Stage 1: Awaiting Content Choice (Detects File, Link, or Pure Text)
    if (session.stage === 'awaiting_content') {
      const media = this.extractMediaFromMessage(message);
      if (media) {
        session.type = 'file';
        session.fileData = media;
        session.isTextOnly = false;
        if (message.caption) {
          session.caption = message.caption;
        }
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>File Received:</b> <i>${media.fileName}</i>\n\n<b>Step 1/4: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        session.type = 'link';
        session.linkData = { url: urlMatch[0] };
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>Link Received:</b> <code>${urlMatch[0]}</code>\n\n<b>Step 1/7: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      // If user typed normal text (no file and no URL), automatically treat it as a Text Response!
      if (rawInput) {
        session.type = 'file';
        session.isTextOnly = true;
        session.caption = rawInput;
        session.textResponse = rawInput;
        session.fileName = 'Text: ' + (rawInput.slice(0, 25).replace(/\n/g, ' '));
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>Text Response Received:</b>\n<i>${rawInput.slice(0, 100)}${rawInput.length > 100 ? '...' : ''}</i>\n\n<b>Step 1/4: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '📥 Please send the <b>File</b>, <b>Web Link (URL)</b>, or enter a <b>Text Message</b> to deliver (or type /cancel to abort):',
        {
          inline_keyboard: [
            [
              { text: '📁 Add File', callback_data: 'add_choose_file', style: 'primary' },
              { text: '🔗 Add Link', callback_data: 'add_choose_link', style: 'primary' },
              { text: '💬 Add Text', callback_data: 'add_choose_text', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 1a: Explicitly awaiting file content (PATH A)
    if (session.stage === 'awaiting_file_content') {
      const media = this.extractMediaFromMessage(message);
      if (media) {
        session.type = 'file';
        session.fileData = media;
        if (message.caption) {
          session.caption = message.caption;
        }
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>File Received:</b> <i>${media.fileName}</i>\n\n<b>Step 1/4: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '❌ No file detected. Please send a Document, Photo, Video, or Audio, or type /cancel to abort.',
        {
          inline_keyboard: [
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 1b: Explicitly awaiting link URL (PATH B)
    if (session.stage === 'awaiting_link_url') {
      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        session.type = 'link';
        session.linkData = { url: urlMatch[0] };
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>Link Received:</b> <code>${urlMatch[0]}</code>\n\n<b>Step 1/7: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '❌ Invalid URL. Please send a valid web link starting with https:// or http:// (or type /cancel):',
        {
          inline_keyboard: [
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 1c: Explicitly awaiting text content (PATH C)
    if (session.stage === 'awaiting_text_content') {
      if (rawInput) {
        session.type = 'file';
        session.isTextOnly = true;
        session.caption = rawInput;
        session.textResponse = rawInput;
        session.fileName = 'Text: ' + (rawInput.slice(0, 25).replace(/\n/g, ' '));
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>Text Response Received:</b>\n<i>${rawInput.slice(0, 100)}${rawInput.length > 100 ? '...' : ''}</i>\n\n<b>Step 1/4: Trigger Type Selection</b>\nChoose whether the trigger will be a Hashtag (#), Slash Command (/), or Normal Text:`,
          {
            inline_keyboard: [
              [
                { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
                { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
                { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '❌ Please send a valid text message (or type /cancel to abort):',
        {
          inline_keyboard: [
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage: Awaiting trigger type button selection
    if (session.stage === 'awaiting_trigger_type' || session.stage === 'awaiting_keyword_type') {
      const stepHeader = session.type === 'file' ? 'Step 1/4' : 'Step 1/7';
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>${stepHeader}:</b> Please choose a trigger type using the buttons below:`,
        {
          inline_keyboard: [
            [
              { text: 'Hashtag (#)', callback_data: 'add_kw_hashtag', style: 'primary' },
              { text: 'Slash Command (/)', callback_data: 'add_kw_slash', style: 'primary' },
              { text: 'Normal Text', callback_data: 'add_kw_normal', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 2: Awaiting Trigger Name
    if (session.stage === 'awaiting_trigger_name' || session.stage === 'awaiting_hashtag') {
      const cleanInput = rawInput.trim();
      const rawKeyword = cleanInput.replace(/^[#/]+/, '').trim();
      if (!rawKeyword) {
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          '❌ Please enter a valid trigger keyword name (or send /cancel to abort):',
          {
            inline_keyboard: [
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      const triggerType = session.triggerType || 'hashtag';
      const formattedTrigger = triggerType === 'hashtag'
        ? `#${rawKeyword}`
        : triggerType === 'slash'
        ? `/${rawKeyword}`
        : rawKeyword;

      session.rawKeyword = rawKeyword;
      session.trigger = formattedTrigger;
      session.hashtag = formattedTrigger;
      session.stage = 'awaiting_filter_choice';

      // Step 3: Filter List Visibility
      const stepHeader = session.type === 'file' ? 'Step 3/4' : 'Step 3/7';
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>${stepHeader}: Filter List Visibility</b>\nDo you want to add <code>${formattedTrigger}</code> to the public /filters list?`,
        {
          inline_keyboard: [
            [
              { text: '1. Yes, Add to Filters', callback_data: 'add_filter_yes', style: 'success' },
              { text: '2. No, Keep Hidden', callback_data: 'add_filter_no', style: 'danger' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 3: Awaiting filter choice text fallback
    if (session.stage === 'awaiting_filter_choice') {
      const lower = rawInput.toLowerCase();
      if (lower === '1' || lower === 'yes' || lower.includes('add')) {
        session.inFiltersList = true;
      } else if (lower === '2' || lower === 'no' || lower.includes('hidden') || lower.includes('keep')) {
        session.inFiltersList = false;
      } else {
        const stepHeader = session.type === 'file' ? 'Step 3/4' : 'Step 3/7';
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `<b>${stepHeader}:</b> Do you want to add <code>${session.trigger || session.rawKeyword}</code> to the public /filters list?`,
          {
            inline_keyboard: [
              [
                { text: '1. Yes, Add to Filters', callback_data: 'add_filter_yes', style: 'success' },
                { text: '2. No, Keep Hidden', callback_data: 'add_filter_no', style: 'danger' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      // FILE ADD FLOW: Completely skip Delivery Mode! Files are direct Telegram Document/Media files.
      if (session.type === 'file') {
        session.openMode = 'browser';
        session.stage = 'awaiting_retention_choice';

        // Step 4/4: Storage Duration for Files
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `<b>Step 4/4: Storage Duration</b>\nChoose storage duration for this file:\n• <b>Permanent</b> — file and its filters remain indefinitely\n• <b>Temporary</b> — auto-deleted with its filters after the chosen days`,
          {
            inline_keyboard: [
              [
                { text: 'Permanent', callback_data: 'add_ret_perm', style: 'primary' },
                { text: 'Temporary', callback_data: 'add_ret_temp', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      // LINK ADD FLOW: Proceed to Step 4/7 Delivery Type
      session.stage = 'awaiting_delivery_type';

      // Step 4/7: Delivery Type (Only for Links)
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>Step 4/7: Delivery Type</b>\nChoose delivery type when triggered:\n• <b>Telegram Mini App</b> — opens embedded inside Telegram\n• <b>Web Browser / Direct</b> — opens in standard browser or direct Telegram chat`,
        {
          inline_keyboard: [
            [
              { text: 'Telegram Mini App', callback_data: 'add_delivery_webapp', style: 'primary' },
              { text: 'Web Browser / Direct', callback_data: 'add_delivery_browser', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 4: Awaiting delivery type text fallback (Only for Links)
    if (session.stage === 'awaiting_delivery_type') {
      const lower = rawInput.toLowerCase();
      if (lower.includes('mini') || lower.includes('app') || lower.includes('web app')) {
        session.openMode = 'webapp';
      } else {
        session.openMode = 'browser';
      }

      // Mandatory Customization for Links: Private Delivery Message Text & Open Button Text
      session.stage = 'awaiting_link_reply_message';

      const defaultReplyMsg = `🔗 Here is your requested link: ${session.linkData?.url || ''}`;
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>Step 5/7: Private Delivery Message</b>\nEnter the message text to send privately along with this link, or tap <b>Use Default</b> below:\n\nDefault: <code>${defaultReplyMsg}</code>`,
        {
          inline_keyboard: [
            [{ text: 'Use Default Message', callback_data: 'add_link_default_msg', style: 'primary' }],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 5 (Link Mandatory Step 1): Awaiting Private Delivery Message Text
    if (session.stage === 'awaiting_link_reply_message') {
      const customReply = rawInput.trim();
      const defaultReplyMsg = `🔗 Here is your requested link: ${session.linkData?.url || ''}`;
      session.replyMessage = customReply || defaultReplyMsg;
      if (session.linkData) session.linkData.replyMessage = session.replyMessage;
      session.stage = 'awaiting_link_button_text';

      // Step 6: Open Button Text
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>Step 6/7: Open Button Text</b>\nEnter the inline button text to open the link, or tap <b>Use Default</b> below:\n\nDefault: <code>Open Link</code>`,
        {
          inline_keyboard: [
            [{ text: 'Use Default', callback_data: 'add_link_default_btn', style: 'primary' }],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 6 (Link Mandatory Step 2): Awaiting Open Button Text
    if (session.stage === 'awaiting_link_button_text') {
      const customBtn = rawInput.trim();
      session.buttonText = customBtn ? customBtn.trim() : 'Open Link';
      if (session.linkData) session.linkData.buttonText = session.buttonText;
      session.stage = 'awaiting_retention_choice';

      // Step 7: Storage Duration for Link
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `<b>Step 7/7: Storage Duration</b>\nChoose storage duration for this link:\n• <b>Permanent</b> — link and its filters remain indefinitely\n• <b>Temporary</b> — auto-deleted with its filters after the chosen days`,
        {
          inline_keyboard: [
            [
              { text: 'Permanent', callback_data: 'add_ret_perm', style: 'primary' },
              { text: 'Temporary', callback_data: 'add_ret_temp', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }

    // Stage 5: Awaiting retention choice text fallback
    if (session.stage === 'awaiting_retention_choice') {
      const lower = rawInput.toLowerCase();
      if (lower === 'permanent' || lower === 'p' || lower.includes('perm')) {
        session.retentionType = 'permanent';
        session.retentionDays = undefined;
        await this.promptSetupVideoChoice(fromId, chatId, session);
        return;
      } else if (lower === 'temporary' || lower === 't' || lower.includes('temp')) {
        session.retentionType = 'temporary';
        session.stage = 'awaiting_retention_days';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `⏳ <b>Auto-Deletion Duration:</b>\nPlease select or enter how many days to keep this ${session.type === 'file' ? 'file' : 'link'}:`,
          {
            inline_keyboard: [
              [
                { text: '1 Day', callback_data: 'add_days_1', style: 'primary' },
                { text: '7 Days', callback_data: 'add_days_7', style: 'primary' },
                { text: '30 Days', callback_data: 'add_days_30', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      } else {
        const stepHeader = session.type === 'file' ? 'Step 4/4' : 'Step 7/7';
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `<b>${stepHeader}: Storage Duration</b>\nDo you want this ${session.type === 'file' ? 'file' : 'link'} to be Permanent or Temporary?`,
          {
            inline_keyboard: [
              [
                { text: 'Permanent', callback_data: 'add_ret_perm', style: 'primary' },
                { text: 'Temporary', callback_data: 'add_ret_temp', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }
    }

    // Stage 5b: Awaiting retention days
    if (session.stage === 'awaiting_retention_days') {
      const days = parseInt(rawInput, 10);
      if (isNaN(days) || days < 1) {
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          '❌ Please enter a valid number of days (e.g., 7 or 30):',
          {
            inline_keyboard: [
              [
                { text: '1 Day', callback_data: 'add_days_1', style: 'primary' },
                { text: '7 Days', callback_data: 'add_days_7', style: 'primary' },
                { text: '30 Days', callback_data: 'add_days_30', style: 'primary' }
              ],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) session.lastPromptMessageId = promptId;
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);
        return;
      }

      session.retentionType = 'temporary';
      session.retentionDays = days;
      await this.promptSetupVideoChoice(fromId, chatId, session);
      return;
    }

    // Stage 6: Awaiting setup video decision (Yes / No)
    if (session.stage === 'awaiting_setup_video_choice') {
      const lower = rawInput.toLowerCase();
      if (lower === '1' || lower === 'yes' || lower === 'y' || lower.includes('add')) {
        session.hasSetupVideo = true;
        session.stage = 'awaiting_setup_video';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `🎬 <b>Send Setup Video</b>\n\nPlease provide your setup video tutorial. You can:\n• Send/upload a video directly from your phone/gallery\n• Forward a video from any chat or channel\n• Send a video URL link (e.g. YouTube or direct MP4 link)\n\n<i>Or send /skip to finish without a video, or /cancel to abort.</i>`,
          {
            inline_keyboard: [
              [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) {
          session.lastPromptMessageId = promptId;
          await storage.saveAddSession(fromId, session);
        }
        return;
      } else {
        session.hasSetupVideo = false;
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }
    }

    // Stage 7: Awaiting setup video file, forwarded message, or URL
    if (session.stage === 'awaiting_setup_video') {
      const lower = rawInput.toLowerCase();
      if (lower === '/skip' || lower === 'skip') {
        session.hasSetupVideo = false;
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Direct video message or forwarded video
      if (message.video) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = message.video.file_id;
        session.setupVideoType = 'upload';
        session.setupVideoFileName = message.video.file_name || 'setup_video.mp4';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Video sent as document
      if (message.document && (message.document.mime_type?.startsWith('video/') || /\.(mp4|mov|mkv|avi|webm)$/i.test(message.document.file_name || ''))) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = message.document.file_id;
        session.setupVideoType = 'upload';
        session.setupVideoFileName = message.document.file_name || 'setup_video.mp4';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Web URL link (YouTube, Vimeo, MP4, etc.)
      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = urlMatch[0];
        session.setupVideoType = 'url';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '❌ Invalid input. Please send/forward a video file, or send a valid URL starting with http:// or https:// (or tap Skip Video below):',
        {
          inline_keyboard: [
            [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        session
      );
      if (promptId) session.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, session);
      await storage.saveAddSession(fromId, session);
      return;
    }
  }

  // Prompt admin for Setup Video choice during /add wizard
  private static async promptSetupVideoChoice(
    fromId: string,
    chatId: string | number,
    session: AddSession
  ): Promise<void> {
    session.stage = 'awaiting_setup_video_choice';
    activeAddSessions.set(fromId, session);
    await storage.saveAddSession(fromId, session);

    const promptId = await TelegramService.sendOrEditSetupPrompt(
      chatId,
      `🎬 <b>Setup Video Configuration</b>\n\nDo you want to add a setup video? (Yes / No)\n\n<i>When enabled, users will see an interactive menu with [ 🎬 Setup Video ] and [ ${session.type === 'file' ? '📁 Get File' : '🔗 Open Link'} ] buttons.</i>`,
      {
        inline_keyboard: [
          [
            { text: '1. Yes, Add Setup Video', callback_data: 'add_sv_yes', style: 'success' },
            { text: '2. No, Skip (Direct Delivery)', callback_data: 'add_sv_no', style: 'primary' }
          ],
          [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
        ]
      },
      session
    );
    if (promptId) {
      session.lastPromptMessageId = promptId;
      await storage.saveAddSession(fromId, session);
    }
  }

  // Final Step: Save item (File or Link) and notify user with summary & test button
  private static async finalizeAndSaveItem(
    fromId: string,
    chatId: string | number,
    session: AddSession
  ): Promise<void> {
    const rawKeyword = session.rawKeyword || (session.trigger ? session.trigger.replace(/^[#/]+/, '') : 'item');
    const triggerType: TriggerType = session.triggerType || 'hashtag';
    const primaryTrigger = session.trigger || (
      triggerType === 'hashtag' ? `#${rawKeyword}` : triggerType === 'slash' ? `/${rawKeyword}` : rawKeyword
    );
    const triggers = [primaryTrigger];

    await storage.loadLatest(true);
    const isFile = session.type === 'file';
    const isTextOnly = Boolean(session.isTextOnly || (!session.fileData && isFile));
    const id = `${isFile ? (isTextOnly ? 't_' : 'f_') : 'l_'}${Date.now().toString(36)}`;
    const retentionType = session.retentionType || 'permanent';
    const retentionDays = retentionType === 'temporary' ? (session.retentionDays || 7) : undefined;
    const expiresAt = retentionType === 'temporary'
      ? new Date(Date.now() + (retentionDays || 7) * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const inFiltersList = session.inFiltersList === true;
    const openMode: OpenMode = session.openMode || 'browser';

    const hasSetupVideo = Boolean(session.hasSetupVideo && session.setupVideoUrl);
    const setupVideoUrl = hasSetupVideo ? session.setupVideoUrl : undefined;
    const setupVideoType = hasSetupVideo ? (session.setupVideoType || 'url') : undefined;
    const setupVideoFileName = hasSetupVideo ? session.setupVideoFileName : undefined;
    const setupVideoButtonText = hasSetupVideo ? '🎬 Setup Video' : undefined;
    const setupResourceButtonText = hasSetupVideo ? (isFile ? (isTextOnly ? '💬 View Message' : '📁 Get File') : '🔗 Open Link') : undefined;

    let newItem: ItemRecord;

    if (isFile && isTextOnly) {
      const textContent = session.textResponse || session.caption || rawKeyword;
      const cleanSnippet = textContent.replace(/\n/g, ' ').trim();
      const textTitle = session.fileName || `Text: ${cleanSnippet.slice(0, 25)}${cleanSnippet.length > 25 ? '...' : ''}`;
      newItem = {
        id,
        type: 'file',
        name: textTitle,
        triggers,
        triggerType,
        rawKeyword,
        inFiltersList,
        isTextOnly: true,
        fileEnabled: false,
        caption: session.caption || session.textResponse || undefined,
        replyMessage: session.caption || session.textResponse || undefined,
        buttonText: '💬 View Message',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        deliveryCount: 0,
        retentionType,
        retentionDays,
        expiresAt,
        hasSetupVideo,
        setupVideoUrl,
        setupVideoType,
        setupVideoFileName,
        setupVideoButtonText,
        setupResourceButtonText
      };
    } else if (isFile) {
      const fileName = session.fileData?.fileName || 'Uploaded File';
      newItem = {
        id,
        type: 'file',
        name: fileName,
        triggers,
        triggerType,
        rawKeyword,
        inFiltersList,
        isTextOnly: false,
        fileEnabled: true,
        telegramFileId: session.fileData?.fileId,
        telegramFileUniqueId: session.fileData?.fileUniqueId,
        fileType: session.fileData?.fileType || 'document',
        fileName,
        fileSize: session.fileData?.fileSize || 0,
        mimeType: session.fileData?.mimeType || 'application/octet-stream',
        caption: session.caption || undefined,
        replyMessage: session.caption || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        deliveryCount: 0,
        retentionType,
        retentionDays,
        expiresAt,
        hasSetupVideo,
        setupVideoUrl,
        setupVideoType,
        setupVideoFileName,
        setupVideoButtonText,
        setupResourceButtonText
      };
    } else {
      const url = session.linkData?.url || 'https://';
      const name = session.linkData?.name || `Link (${rawKeyword})`;
      const defaultBtn = openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link';
      const rawBtn = session.buttonText || session.linkData?.buttonText || defaultBtn;
      const buttonText = (rawBtn && rawBtn.trim()) ? rawBtn.trim() : defaultBtn;
      const defaultReply = `🔗 Here is your requested link: ${url}`;
      const replyMessage = session.replyMessage || session.linkData?.replyMessage || session.caption || defaultReply;
      newItem = {
        id,
        type: 'link',
        name,
        url,
        openMode,
        buttonText,
        replyMessage,
        caption: replyMessage,
        triggers,
        triggerType,
        rawKeyword,
        inFiltersList,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        deliveryCount: 0,
        retentionType,
        retentionDays,
        expiresAt,
        hasSetupVideo,
        setupVideoUrl,
        setupVideoType,
        setupVideoFileName,
        setupVideoButtonText,
        setupResourceButtonText
      };
    }

    await storage.saveItem(newItem);

    const botUsername = await this.getBotUsername();
    const cleanBot = botUsername.replace(/^@/, '');
    const payload = getItemPayload(newItem);
    const deepLink = `https://t.me/${cleanBot}?start=${payload}`;

    const retentionDesc = retentionType === 'temporary'
      ? `Temporary (${retentionDays} days — auto-deleted upon expiry)`
      : 'Permanent (never deleted)';

    const filterStatus = inFiltersList
      ? 'Yes (Visible in /filters list)'
      : 'No (Hidden from public /filters)';

    const typeDesc = isFile ? (isTextOnly ? '💬 Text Response' : '📁 File') : '🔗 Web Link';

    const deliveryDesc = isFile
      ? (isTextOnly ? 'Direct Text Message Response' : 'Direct Telegram Document / Media File')
      : (openMode === 'webapp' ? 'Telegram Mini App (Embedded)' : 'Standard Web Browser');

    const setupVideoDesc = hasSetupVideo
      ? `🎬 Enabled (${setupVideoType === 'url' ? 'URL Link' : 'Uploaded Video'})`
      : 'None (Direct Delivery)';

    const successText = `✅ <b>Success! Your ${typeDesc} has been saved successfully.</b>\n\n📋 <b>Configuration Details:</b>\n• Type: <b>${typeDesc}</b>\n• Name: <b>${newItem.name}</b>\n• Trigger: <code>${primaryTrigger}</code> (${triggerType})\n• Public Filters: <b>${filterStatus}</b>\n• Delivery Mode: <b>${deliveryDesc}</b>\n• Retention: <b>${retentionDesc}</b>\n• Setup Video: <b>${setupVideoDesc}</b>\n\n🔗 <b>Direct Link:</b>\n${deepLink}\n\n💡 <i>Type <code>${primaryTrigger}</code> in any group or here to test delivery!</i>`;

    const successMarkup = {
      inline_keyboard: [
        [
          { text: 'Test Delivery', callback_data: `test_delivery_${newItem.id}`, style: 'primary' }
        ]
      ]
    };

    // Update in-place inside the single dynamic message bubble
    if (session.lastPromptMessageId && chatId) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: session.lastPromptMessageId,
          text: successText,
          parse_mode: 'HTML',
          reply_markup: successMarkup
        });
        if (editRes && editRes.ok) {
          activeAddSessions.delete(fromId);
          await storage.deleteAddSession(fromId);
          return;
        }
      } catch {}

      // Fallback: delete old prompt cleanly so no extra bubbles remain
      try {
        await this.callTelegramApi('deleteMessage', {
          chat_id: chatId,
          message_id: session.lastPromptMessageId
        });
      } catch {}
    }

    activeAddSessions.delete(fromId);
    await storage.deleteAddSession(fromId);

    // If edit wasn't possible, send final confirmation
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: successText,
      parse_mode: 'HTML',
      reply_markup: successMarkup
    });
  }

  // =========================================================================
  // CALLBACK QUERY HANDLING (Inline Buttons)
  // =========================================================================
  private static async handleCallbackQuery(cb: any): Promise<void> {
    const fromId = String(cb.from?.id || '');
    const data = cb.data;
    const chatId = cb.message?.chat?.id;

    // MANDATORY FORCE SUB VERIFICATION CALLBACK
    if (data && data.startsWith('forcesub_verify:')) {
      const targetPayload = data.substring('forcesub_verify:'.length).trim() || 'start';
      const forceCheck = await this.checkUserForceSub(fromId);

      if (!forceCheck.allJoined) {
        // Display Telegram pop-up alert: "Please join all channels or groups to use this bot."
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Please join all channels or groups to use this bot.',
          show_alert: true
        });
        if (chatId && cb.message?.message_id) {
          await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, targetPayload, cb.message.message_id, cb.from);
        }
        return;
      }

      // User has joined all required channels!
      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: '✅ Membership verified! Unlocking access...',
        show_alert: false
      });

      // Cleanly remove the force-sub prompt message
      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('deleteMessage', {
            chat_id: chatId,
            message_id: cb.message.message_id
          });
        } catch {}
      }

      if (targetPayload && targetPayload !== 'start') {
        await this.handleDeepLinkDelivery(chatId, targetPayload);
      } else {
        await this.sendStartWelcomeMessage(chatId, fromId, cb.message);
      }
      return;
    }

    // ADMIN ACTION ON USER REPORT: Ban User
    if (data && data.startsWith('admin_ban_user:')) {
      const parts = data.split(':');
      const targetUserId = parts[1];
      const reportId = parts[2];
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (!isAdmin) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Unauthorized: Only admins can perform this action.',
          show_alert: true
        });
        return;
      }

      await storage.setBotUserBanned(targetUserId, true);
      if (reportId) {
        await storage.updateReportStatus(reportId, 'resolved', fromId);
      }

      const allReports = await storage.getReports();
      const report = allReports.find(r => r.id === reportId);
      if (report && report.chatId) {
        try {
          await this.callTelegramApi('banChatMember', {
            chat_id: report.chatId,
            user_id: Number(targetUserId) || targetUserId
          });
        } catch (e) {
          console.warn('[Telegram] banChatMember error:', e);
        }
      }

      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `User ${targetUserId} has been banned.`,
        show_alert: false
      });

      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: `${cb.message.text || ''}\n\n<b>🔨 Resolved:</b> User was BANNED by Admin.`,
            parse_mode: 'HTML'
          });
        } catch {}
      }
      return;
    }

    // ADMIN ACTION ON USER REPORT: Dismiss Report
    if (data && data.startsWith('admin_dismiss_report:')) {
      const parts = data.split(':');
      const reportId = parts[1];
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (!isAdmin) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Unauthorized.',
          show_alert: true
        });
        return;
      }

      if (reportId) {
        await storage.updateReportStatus(reportId, 'dismissed', fromId);
      }

      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Report dismissed.',
        show_alert: false
      });

      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: `${cb.message.text || ''}\n\n<b>✅ Report Dismissed</b> by Admin.`,
            parse_mode: 'HTML'
          });
        } catch {}
      }
      return;
    }

    // INTERACTIVE FILE LISTING & LINK COPYING CALLBACKS (/allfile, /allfiles)
    if (data && (data.startsWith('fl_p:') || data.startsWith('fl_v:') || data.startsWith('fl_copy:') || data === 'fl_close' || data === 'fl_noop')) {
      const msgId = cb.message?.message_id;
      const threadId = cb.message?.message_thread_id;
      const isGroupChat = cb.message?.chat?.type === 'group' || cb.message?.chat?.type === 'supergroup';

      if (data === 'fl_noop') {
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        return;
      }

      if (data === 'fl_close') {
        // Respond immediately to dismiss button loading indicator and delete list message
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Closed' }).catch(() => {});
        if (chatId && msgId) {
          await this.callTelegramApi('deleteMessage', {
            chat_id: chatId,
            message_id: msgId
          }).catch(() => {});
        }
        return;
      }

      if (data.startsWith('fl_p:')) {
        const rawPageStr = data.slice('fl_p:'.length).trim();
        const parsedPage = parseInt(rawPageStr, 10);
        const targetPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
        // Immediately answer callback query (non-blocking) so Prev / Next / Back / Refresh never hangs
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        if (chatId) {
          await this.handleFilesListCommand(
            fromId,
            chatId,
            targetPage,
            undefined,
            isGroupChat,
            msgId,
            threadId
          );
        }
        return;
      }

      if (data.startsWith('fl_v:')) {
        const rawRest = data.slice('fl_v:'.length);
        const lastColonIdx = rawRest.lastIndexOf(':');
        const itemId = lastColonIdx > 0 ? rawRest.slice(0, lastColonIdx) : rawRest;
        const returnPage = lastColonIdx > 0 ? Math.max(1, parseInt(rawRest.slice(lastColonIdx + 1), 10) || 1) : 1;

        let item = storage.getItemFast(itemId);
        if (!item) {
          await storage.loadLatest(false);
          item = storage.getItemFast(itemId);
        }
        if (!item) {
          await this.callTelegramApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ File or link no longer exists.',
            show_alert: true
          });
          return;
        }

        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        const detail = await this.buildFileDetailView(item, returnPage);
        if (chatId && msgId) {
          const editRes = await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: detail.text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: detail.primaryKeyboard }
          });
          if (!editRes?.ok) {
            await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: msgId,
              text: detail.text,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: detail.fallbackKeyboard }
            });
          }
        }
        return;
      }

      if (data.startsWith('fl_copy:')) {
        const itemId = data.slice('fl_copy:'.length).trim();
        let item = storage.getItemFast(itemId);
        if (!item) {
          await storage.loadLatest(false);
          item = storage.getItemFast(itemId);
        }

        if (!item) {
          await this.callTelegramApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ File or link no longer exists.',
            show_alert: true
          });
          return;
        }

        const detail = await this.buildFileDetailView(item, 1);
        this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🔗 Link ready to copy!',
          show_alert: false
        }).catch(() => {});

        if (chatId) {
          const title = (item.fileName || item.name || 'File').trim();
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `🔗 <b>${this.escapeHtml(title)}</b>\n\nTap below to copy link:\n<code>${this.escapeHtml(detail.deepLink)}</code>`,
            parse_mode: 'HTML',
            ...(threadId ? { message_thread_id: threadId } : {})
          });
        }
        return;
      }
    }

    await this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id });

    // SETUP VIDEO NAVIGATION:
    // [ 🎬 Setup Video ] button tap
    if (data?.startsWith('sv_vid_')) {
      const itemId = data.replace('sv_vid_', '').trim();
      const item = await storage.getItem(itemId);
      if (item && chatId) {
        await this.deliverSetupVideo(chatId, item, cb.message?.message_id);
      }
      return;
    }

    // [ 📁 File / Link ] button tap
    if (data?.startsWith('sv_item_')) {
      const itemId = data.replace('sv_item_', '').trim();
      if (chatId) {
        await this.handleDeepLinkDelivery(chatId, itemId, {
          includeBackButton: true,
          messageIdToEdit: cb.message?.message_id
        });
      }
      return;
    }

    // [ ⬅️ Back ] button tap returning to setup menu
    if (data?.startsWith('sv_menu_')) {
      const itemId = data.replace('sv_menu_', '').trim();
      const item = await storage.getItem(itemId);
      if (item && chatId) {
        await this.sendSetupVideoMenu(chatId, item, cb.message?.message_id);
      }
      return;
    }

    // Cancel Button
    if (data === 'cancel_add') {
      const msgId = cb.message?.message_id;
      activeAddSessions.delete(fromId);
      await storage.deleteAddSession(fromId);
      if (chatId && msgId) {
        try {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: '❌ <b>Setup Cancelled.</b> Operation aborted.',
            parse_mode: 'HTML'
          });
          return;
        } catch {}
      }
      if (chatId) {
        await this.callTelegramApi('sendMessage', { chat_id: chatId, text: '❌ Operation cancelled.' });
      }
      return;
    }

    let session = activeAddSessions.get(fromId);
    if (!session) {
      session = await storage.getAddSession(fromId);
      if (session) activeAddSessions.set(fromId, session);
    }

    const msgId = cb.message?.message_id;
    if (session && msgId) {
      session.lastPromptMessageId = msgId;
    }

    // PATH Selection Callbacks: Add File or Add Link
    if (data === 'add_choose_file') {
      if (session) {
        session.type = 'file';
        session.stage = 'awaiting_file_content';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            '📤 Please send the <b>File</b> you want to add (Document, Photo, Video, or Audio):\n\n<i>Or send /cancel to abort.</i>',
            {
              inline_keyboard: [
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    if (data === 'add_choose_link') {
      if (session) {
        session.type = 'link';
        session.stage = 'awaiting_link_url';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            '🔗 Please enter or paste the <b>Web Link (URL)</b> you want to add (e.g., https://example.com):\n\n<i>Or send /cancel to abort.</i>',
            {
              inline_keyboard: [
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    if (data === 'add_choose_text') {
      if (session) {
        session.type = 'file';
        session.isTextOnly = true;
        session.stage = 'awaiting_text_content';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            '💬 Please enter the <b>Text Message</b> you want the bot to deliver when triggered:\n\n<i>You can use bold, italic, links, and HTML tags. Or send /cancel to abort.</i>',
            {
              inline_keyboard: [
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 1: Trigger Type Selection (#, /, or normal)
    if (data === 'add_kw_hashtag' || data === 'add_kw_slash' || data === 'add_kw_normal') {
      if (session) {
        session.triggerType = data === 'add_kw_hashtag' ? 'hashtag' : data === 'add_kw_slash' ? 'slash' : 'normal';
        session.stage = 'awaiting_trigger_name';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        const promptHint = session.triggerType === 'hashtag'
          ? 'starting with #'
          : session.triggerType === 'slash'
          ? 'starting with /'
          : 'plain text keyword';

        const stepHeader = session.type === 'file' ? 'Step 2/4' : 'Step 2/7';

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>${stepHeader}: Trigger Name</b>\nPlease enter the trigger keyword for this ${session.type === 'file' ? 'file' : 'link'} (${promptHint}):`,
            {
              inline_keyboard: [
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 3: Filter List Visibility Selection (Yes/No)
    if (data === 'add_filter_yes' || data === 'add_filter_no') {
      if (session) {
        session.inFiltersList = (data === 'add_filter_yes');

        // FILE ADD FLOW: Completely skip Delivery Mode! Files are direct Telegram Document/Media files.
        if (session.type === 'file') {
          session.openMode = 'browser';
          session.stage = 'awaiting_retention_choice';
          activeAddSessions.set(fromId, session);
          await storage.saveAddSession(fromId, session);

          if (chatId) {
            const promptId = await TelegramService.sendOrEditSetupPrompt(
              chatId,
              `<b>Step 4/4: Storage Duration</b>\nChoose storage duration for this file:\n• <b>Permanent</b> — file and its filters remain indefinitely\n• <b>Temporary</b> — auto-deleted with its filters after chosen days`,
              {
                inline_keyboard: [
                  [
                    { text: 'Permanent', callback_data: 'add_ret_perm', style: 'primary' },
                    { text: 'Temporary', callback_data: 'add_ret_temp', style: 'primary' }
                  ],
                  [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
                ]
              },
              session
            );
            if (promptId) {
              session.lastPromptMessageId = promptId;
              await storage.saveAddSession(fromId, session);
            }
          }
          return;
        }

        // LINK ADD FLOW: Proceed to Step 4/7 Delivery Type
        session.stage = 'awaiting_delivery_type';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        // Step 4 Prompt: Delivery Type (Only for Links)
        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>Step 4/7: Delivery Type</b>\nChoose delivery type when triggered:\n• <b>Telegram Mini App</b> — opens embedded inside Telegram\n• <b>Web Browser / Direct</b> — opens in standard browser or direct Telegram chat`,
            {
              inline_keyboard: [
                [
                  { text: 'Telegram Mini App', callback_data: 'add_delivery_webapp', style: 'primary' },
                  { text: 'Web Browser / Direct', callback_data: 'add_delivery_browser', style: 'primary' }
                ],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 4: Delivery Type Selection (Mini App vs Browser/Direct) - ONLY FOR LINKS
    if (data === 'add_delivery_webapp' || data === 'add_delivery_browser') {
      if (session) {
        session.openMode = (data === 'add_delivery_webapp' ? 'webapp' : 'browser');

        // Mandatory Customization for Links
        session.stage = 'awaiting_link_reply_message';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        const defaultReplyMsg = `🔗 Here is your requested link: ${session.linkData?.url || ''}`;
        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>Step 5/7: Private Delivery Message</b>\nEnter the message text to send privately along with this link, or tap <b>Use Default</b> below:\n\nDefault: <code>${defaultReplyMsg}</code>`,
            {
              inline_keyboard: [
                [{ text: 'Use Default Message', callback_data: 'add_link_default_msg', style: 'primary' }],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 5 (Link Mandatory Step 1): Default Private Delivery Message selection
    if (data === 'add_link_default_msg') {
      if (session) {
        session.replyMessage = `🔗 Here is your requested link: ${session.linkData?.url || ''}`;
        session.caption = session.replyMessage;
        if (session.linkData) session.linkData.replyMessage = session.replyMessage;
        session.stage = 'awaiting_link_button_text';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        // Step 6 Prompt: Open Button Text
        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>Step 6/7: Open Button Text</b>\nEnter the inline button text to open the link, or tap <b>Use Default</b> below:\n\nDefault: <code>Open Link</code>`,
            {
              inline_keyboard: [
                [{ text: 'Use Default', callback_data: 'add_link_default_btn', style: 'primary' }],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 6 (Link Mandatory Step 2): Default Open Button Text selection
    if (data === 'add_link_default_btn') {
      if (session) {
        session.buttonText = 'Open Link';
        if (session.linkData) session.linkData.buttonText = session.buttonText;
        session.stage = 'awaiting_retention_choice';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        // Step 7 Prompt: Storage Duration
        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>Step 7/7: Storage Duration</b>\nChoose storage duration for this link:\n• <b>Permanent</b> — link and its filters remain indefinitely\n• <b>Temporary</b> — auto-deleted with its filters after chosen days`,
            {
              inline_keyboard: [
                [
                  { text: 'Permanent', callback_data: 'add_ret_perm', style: 'primary' },
                  { text: 'Temporary', callback_data: 'add_ret_temp', style: 'primary' }
                ],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 5: Storage Duration Selection (Permanent vs Temporary)
    if (data === 'add_ret_perm') {
      if (session) {
        session.retentionType = 'permanent';
        session.retentionDays = undefined;
        await this.promptSetupVideoChoice(fromId, chatId, session);
      }
      return;
    }

    if (data === 'add_ret_temp') {
      if (session) {
        session.retentionType = 'temporary';
        session.stage = 'awaiting_retention_days';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `⏳ <b>Auto-Deletion Duration:</b>\nPlease select or enter how many days to keep this ${session.type === 'file' ? 'file' : 'link'}:`,
            {
              inline_keyboard: [
                [
                  { text: '1 Day', callback_data: 'add_days_1', style: 'primary' },
                  { text: '7 Days', callback_data: 'add_days_7', style: 'primary' },
                  { text: '30 Days', callback_data: 'add_days_30', style: 'primary' }
                ],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    // Step 5b: Quick days selection
    if (data.startsWith('add_days_')) {
      if (session) {
        const days = parseInt(data.replace('add_days_', ''), 10) || 7;
        session.retentionType = 'temporary';
        session.retentionDays = days;
        await this.promptSetupVideoChoice(fromId, chatId, session);
      }
      return;
    }

    // Setup Video Selection Callbacks
    if (data === 'add_sv_yes') {
      if (session) {
        session.hasSetupVideo = true;
        session.stage = 'awaiting_setup_video';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `🎬 <b>Send Setup Video</b>\n\nPlease provide your setup video tutorial. You can:\n• Send/upload a video directly from your phone/gallery\n• Forward a video from any chat or channel\n• Send a video URL link (e.g. YouTube or direct MP4 link)\n\n<i>Or send /skip to finish without a video, or /cancel to abort.</i>`,
            {
              inline_keyboard: [
                [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
                [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
              ]
            },
            session
          );
          if (promptId) {
            session.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, session);
          }
        }
      }
      return;
    }

    if (data === 'add_sv_no') {
      if (session) {
        session.hasSetupVideo = false;
        await this.finalizeAndSaveItem(fromId, chatId, session);
      }
      return;
    }

    // Start Message Inline Action Callbacks
    if (data === 'bot_view_filters') {
      await this.handleFiltersCommand(chatId, undefined, false);
      return;
    }

    if (data === 'bot_view_rules') {
      if (chatId) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Use This Bot:</b>\n\n• Type any file hashtag in your group or here to receive your file privately.\n• All files are delivered securely and privately in direct message.\n• Type <code>/filters</code> anytime to see the full list of available file hashtags.\n• To open public links, tap the button provided in group responses.`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // Direct trigger test delivery callback
    if (data.startsWith('test_delivery_')) {
      const itemId = data.replace('test_delivery_', '').trim();
      const item = await storage.getItem(itemId);
      if (!item) {
        if (chatId) {
          await this.callTelegramApi('sendMessage', { chat_id: chatId, text: '❌ File not found.' });
        }
        return;
      }
      if (chatId) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '🚀 Testing delivery: Sending file now...',
          parse_mode: 'HTML'
        });
        const payload = getItemPayload(item);
        await this.handleDeepLinkDelivery(chatId, payload);
      }
      return;
    }
  }

  // =========================================================================
  // /setstartmsg and /startmsg COMMAND (with Media Support)
  // =========================================================================
  private static async handleSetStartMessageCommand(
    fromId: string,
    chatId: string | number,
    text: string,
    message?: any
  ): Promise<void> {
    await storage.loadLatest(true);
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '1192931448');
    const isRoot = fromId === rootAdminId || rootAdminId.includes(fromId);
    const hasPermission = isRoot || Boolean(admin?.permissions?.messages_edit);

    if (!isRoot && (!admin || !hasPermission)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ You are not authorized to edit message templates.'
      });
      return;
    }

    // Check if message itself or replied message contains a Photo or Video
    let detectedMediaType: 'none' | 'photo' | 'video' | undefined = undefined;
    let detectedMediaUrl: string | undefined = undefined;
    const mediaMsg = (message?.reply_to_message?.photo || message?.reply_to_message?.video || message?.reply_to_message?.animation)
      ? message.reply_to_message
      : (message?.photo || message?.video || message?.animation)
      ? message
      : null;

    if (mediaMsg?.photo && Array.isArray(mediaMsg.photo) && mediaMsg.photo.length > 0) {
      detectedMediaType = 'photo';
      detectedMediaUrl = mediaMsg.photo[mediaMsg.photo.length - 1].file_id;
    } else if (mediaMsg?.video) {
      detectedMediaType = 'video';
      detectedMediaUrl = mediaMsg.video.file_id;
    } else if (mediaMsg?.animation) {
      detectedMediaType = 'video';
      detectedMediaUrl = mediaMsg.animation.file_id;
    }

    // Extract new content after command: /setstartmsg <new text> or /startmsg <new text>
    const match = text.match(/^\/(?:setstartmsg|startmsg)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
    const newContent = match && match[1] ? match[1].trim() : (mediaMsg?.caption?.replace(/^\/(?:setstartmsg|startmsg)(?:@\w+)?\s*/i, '').trim() || '');

    const templates = await storage.getTemplates();
    const currentTemplate = templates.START_MESSAGE;

    if (!newContent && !detectedMediaUrl) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `ℹ️ <b>Start Message Configuration</b>\n\n<b>Current text:</b>\n${currentTemplate?.content || '(default)'}\n\n<b>Attached media:</b> ${currentTemplate?.mediaUrl ? `${currentTemplate.mediaType?.toUpperCase()} (active)` : 'None (text-only)'}\n\n<b>Usage:</b>\n• Send <code>/setstartmsg &lt;new message&gt;</code> to change text.\n• Reply to any Photo/Video with <code>/setstartmsg &lt;caption&gt;</code> to attach media!\n• Send <code>/setstartmedia &lt;url or file_id&gt;</code> to set media.\n• Send <code>/clearstartmedia</code> to remove media.\n\n<b>Placeholders:</b>\n• <code>{user_name}</code> - User's name\n• <code>{user_id}</code> - User's ID\n• <code>{bot_name}</code> - Bot username`,
        parse_mode: 'HTML'
      });
      return;
    }

    const finalContent = newContent || currentTemplate?.content || "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}";
    const extra: any = {};
    if (detectedMediaUrl) {
      extra.mediaType = detectedMediaType;
      extra.mediaUrl = detectedMediaUrl;
    }

    await storage.updateTemplate('START_MESSAGE', finalContent, extra);
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Start Message Template Updated!</b>\n\n${detectedMediaUrl ? `📸 <i>Attached ${detectedMediaType?.toUpperCase()} to welcome message!</i>\n\n` : ''}<b>New Caption:</b>\n${finalContent}\n\nUsers who send <code>/start</code> will now receive this message with media!`,
      parse_mode: 'HTML'
    });
  }

  // /setstartmedia <url_or_file_id> [photo|video]
  private static async handleSetStartMediaCommand(
    fromId: string,
    chatId: string | number,
    text: string,
    message?: any
  ): Promise<void> {
    await storage.loadLatest(true);
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '1192931448');
    const isRoot = fromId === rootAdminId || rootAdminId.includes(fromId);
    const hasPermission = isRoot || Boolean(admin?.permissions?.messages_edit);

    if (!isRoot && (!admin || !hasPermission)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ You are not authorized to edit message templates.'
      });
      return;
    }

    const match = text.match(/^\/setstartmedia(?:@\w+)?(?:\s+(\S+))?(?:\s+(photo|video))?$/i);
    let targetUrl = match && match[1] ? match[1].trim() : '';
    let targetType: 'photo' | 'video' = (match && match[2]?.toLowerCase() === 'video') ? 'video' : 'photo';

    // If no URL typed, check if replied to media
    if (!targetUrl && message?.reply_to_message) {
      const rep = message.reply_to_message;
      if (rep.photo && Array.isArray(rep.photo) && rep.photo.length > 0) {
        targetUrl = rep.photo[rep.photo.length - 1].file_id;
        targetType = 'photo';
      } else if (rep.video || rep.animation) {
        targetUrl = (rep.video || rep.animation).file_id;
        targetType = 'video';
      }
    }

    if (!targetUrl) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ Please provide a media URL or file ID, or reply to a photo/video message with <code>/setstartmedia</code>.\n\nExample:\n<code>/setstartmedia https://example.com/banner.jpg</code>',
        parse_mode: 'HTML'
      });
      return;
    }

    if (/\.(mp4|mov|webm|m4v)$/i.test(targetUrl)) {
      targetType = 'video';
    }

    const templates = await storage.getTemplates();
    const currentContent = templates.START_MESSAGE?.content || "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}";

    await storage.updateTemplate('START_MESSAGE', currentContent, {
      mediaType: targetType,
      mediaUrl: targetUrl
    });

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Start Message Media Configured!</b>\n\n• Type: <b>${targetType.toUpperCase()}</b>\n• Media: <code>${targetUrl.slice(0, 50)}${targetUrl.length > 50 ? '...' : ''}</code>\n\nThe bot will now send this media above the welcome text when users start the bot.`,
      parse_mode: 'HTML'
    });
  }

  // /clearstartmedia
  private static async handleClearStartMediaCommand(
    fromId: string,
    chatId: string | number
  ): Promise<void> {
    await storage.loadLatest(true);
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '1192931448');
    const isRoot = fromId === rootAdminId || rootAdminId.includes(fromId);
    const hasPermission = isRoot || Boolean(admin?.permissions?.messages_edit);

    if (!isRoot && (!admin || !hasPermission)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ You are not authorized to edit message templates.'
      });
      return;
    }

    const templates = await storage.getTemplates();
    const currentContent = templates.START_MESSAGE?.content || "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}";

    await storage.updateTemplate('START_MESSAGE', currentContent, {
      mediaType: 'none',
      mediaUrl: ''
    });

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: '✅ Media attachment removed from Start Message. Welcome message is now text-only.'
    });
  }

  // =========================================================================
  // /editthismessage COMMAND
  // =========================================================================
  private static async handleEditThisMessageCommand(message: any): Promise<void> {
    const fromId = String(message.from?.id || '');
    const chatId = message.chat.id;
    const replyTo = message.reply_to_message;

    if (!replyTo) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ Reply to any bot message with /editthismessage to edit its template or text.'
      });
      return;
    }

    await storage.loadLatest(true);
    const admin = await storage.getAdmin(fromId);
    const settings = await storage.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '1192931448');
    const isRoot = fromId === rootAdminId || rootAdminId.includes(fromId);
    const hasPermission = isRoot || Boolean(admin?.permissions?.messages_edit);

    if (!isRoot && (!admin || !hasPermission)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ You are not authorized to edit message templates.'
      });
      return;
    }

    const templates = await storage.getTemplates();
    const replyText = replyTo.text || '';
    let templateKey = 'GROUP_FILE_REPLY';

    if (templates.START_MESSAGE && (replyText.includes('Welcome') || replyText.includes(templates.START_MESSAGE.content.slice(0, 15)))) {
      templateKey = 'START_MESSAGE';
    } else if (templates.GROUP_LINK_REPLY && replyText.includes(templates.GROUP_LINK_REPLY.content.slice(0, 15))) {
      templateKey = 'GROUP_LINK_REPLY';
    } else if (templates.CANCEL_MESSAGE && replyText.includes(templates.CANCEL_MESSAGE.content.slice(0, 15))) {
      templateKey = 'CANCEL_MESSAGE';
    }

      activeEditSessions.set(fromId, { templateKey });

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✏️ Editing template: *${templateKey}*\n\nCurrent text:\n"${replyTo.text || ''}"\n\nPlease send the new text for this template (or /cancel):`,
      parse_mode: 'Markdown'
    });
  }

  // Upload file from phone/storage buffer to Telegram servers and return real Telegram file_id
  public static async uploadFileToTelegram(
    fileBuffer: Buffer,
    fileName: string,
    fileType: 'document' | 'photo' | 'video' | 'audio' = 'document',
    caption?: string,
    candidateChatId?: string | number,
    mimeType?: string
  ): Promise<{ ok: boolean; fileId?: string; fileUniqueId?: string; error?: string }> {
    const token = await this.getBotToken();
    if (!token) {
      return { ok: false, error: 'No Telegram Bot Token configured. Set bot token in Settings first.' };
    }

    try {
      const settings = await storage.getSettings();
      const candidateChats: string[] = [];
      if (candidateChatId) candidateChats.push(String(candidateChatId).trim());
      if (settings.rootAdminId) candidateChats.push(String(settings.rootAdminId).trim());
      if (process.env.ROOT_ADMIN_ID) candidateChats.push(String(process.env.ROOT_ADMIN_ID).trim());

      const targetChatId = candidateChats.find(c => Boolean(c));
      if (!targetChatId) {
        return { ok: false, error: 'Root Admin Telegram ID is required to register media file_id with Telegram bot.' };
      }

      const method = fileType === 'photo' 
        ? 'sendPhoto' 
        : fileType === 'video' 
        ? 'sendVideo' 
        : fileType === 'audio' 
        ? 'sendAudio' 
        : 'sendDocument';

      const fieldName = fileType === 'photo' 
        ? 'photo' 
        : fileType === 'video' 
        ? 'video' 
        : fileType === 'audio' 
        ? 'audio' 
        : 'document';

      const formData = new FormData();
      formData.append('chat_id', targetChatId);
      formData.append('disable_notification', 'true');
      if (caption) formData.append('caption', caption);

      const computedMime = mimeType || (fileType === 'photo' ? 'image/jpeg' : fileType === 'video' ? 'video/mp4' : fileType === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
      const uint8 = new Uint8Array(fileBuffer);
      const blob = new Blob([uint8], { type: computedMime });
      formData.append(fieldName, blob, fileName);

      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!data.ok) {
        console.warn(`[Telegram] Direct media upload failed:`, data.description);
        return { ok: false, error: data.description || 'Failed to upload media to Telegram' };
      }

      let fileId = '';
      let fileUniqueId = '';
      const msg = data.result;

      if (msg.document) {
        fileId = msg.document.file_id;
        fileUniqueId = msg.document.file_unique_id;
      } else if (msg.photo && msg.photo.length > 0) {
        const largest = msg.photo[msg.photo.length - 1];
        fileId = largest.file_id;
        fileUniqueId = largest.file_unique_id;
      } else if (msg.video) {
        fileId = msg.video.file_id;
        fileUniqueId = msg.video.file_unique_id;
      } else if (msg.audio) {
        fileId = msg.audio.file_id;
        fileUniqueId = msg.audio.file_unique_id;
      }

      return {
        ok: true,
        fileId,
        fileUniqueId
      };
    } catch (err: any) {
      console.error('[Telegram] Error in uploadFileToTelegram:', err);
      return { ok: false, error: err.message };
    }
  }

  // Directly deliver an uploaded file buffer to a specific chat using Telegram multipart/form-data
  public static async uploadAndDeliverDirectly(
    chatId: string | number,
    uploadedFile: { buffer: Buffer; fileName: string; mimeType: string; fileType: 'document' | 'photo' | 'video' | 'audio' },
    caption?: string,
    replyMarkup?: any
  ): Promise<any> {
    const token = await this.getBotToken();
    if (!token) {
      return { ok: false, description: 'No bot token configured. Set bot token in Settings.' };
    }

    const method = uploadedFile.fileType === 'photo'
      ? 'sendPhoto'
      : uploadedFile.fileType === 'video'
      ? 'sendVideo'
      : uploadedFile.fileType === 'audio'
      ? 'sendAudio'
      : 'sendDocument';

    const fieldName = uploadedFile.fileType === 'photo'
      ? 'photo'
      : uploadedFile.fileType === 'video'
      ? 'video'
      : uploadedFile.fileType === 'audio'
      ? 'audio'
      : 'document';

    let buf: Buffer;
    if (Buffer.isBuffer(uploadedFile.buffer)) {
      buf = uploadedFile.buffer;
    } else if ((uploadedFile.buffer as any)?.data) {
      buf = Buffer.from((uploadedFile.buffer as any).data);
    } else if (typeof uploadedFile.buffer === 'string') {
      buf = Buffer.from(uploadedFile.buffer, 'base64');
    } else {
      buf = Buffer.from(uploadedFile.buffer);
    }

    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    if (caption) formData.append('caption', caption);
    if (replyMarkup) formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));

    const blob = new Blob([new Uint8Array(buf)] as any, { type: uploadedFile.mimeType || 'application/octet-stream' });
    formData.append(fieldName, blob, uploadedFile.fileName || 'file');

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        body: formData
      });
      let data = await res.json();
      
      // If photo/video/audio method failed, retry automatically as sendDocument!
      if (!data.ok && method !== 'sendDocument') {
        console.warn(`[Telegram] ${method} returned error (${data.description}), falling back to sendDocument...`);
        const docFormData = new FormData();
        docFormData.append('chat_id', String(chatId));
        if (caption) docFormData.append('caption', caption);
        if (replyMarkup) docFormData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
        docFormData.append('document', blob, uploadedFile.fileName || 'file');
        const docRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: 'POST',
          body: docFormData
        });
        data = await docRes.json();
      }

      return data;
    } catch (err: any) {
      console.error('[Telegram] uploadAndDeliverDirectly fetch error:', err);
      return { ok: false, description: err.message };
    }
  }

  // =========================================================================
  // 10-MINUTE DELIVERY TIMEOUT & AUTO-DELETION WORKER
  // =========================================================================
  private static deletionWorkerStarted = false;
  private static activeTimers = new Map<string, NodeJS.Timeout>();

  public static async initScheduledDeletionWorker(): Promise<void> {
    if (this.deletionWorkerStarted) return;
    this.deletionWorkerStarted = true;

    try {
      // 1. Process any past-due deletions on startup (delivered file auto-destruct)
      await this.processDueScheduledDeletions();

      // Clean up any temporary files whose expiration days have passed
      await storage.checkAndCleanExpiredItems().catch(err => {
        console.warn('[Storage] Startup expired items cleanup error:', err);
      });

      // 2. Arm timers for all remaining scheduled deletions from persistent storage
      const pending = await storage.getScheduledDeletions();
      for (const sched of pending) {
        this.armScheduledDeletionTimer(sched);
      }
      console.info(`[Telegram] Initialized scheduled auto-delete worker. (${pending.length} pending file self-destruct timers restored)`);

      // 3. Periodic sweep every 15 seconds for strict timing
      setInterval(() => {
        TelegramService.processDueScheduledDeletions().catch(err => {
          console.warn('[Telegram] Interval auto-delete worker error:', err);
        });
        storage.checkAndCleanExpiredItems().catch(err => {
          console.warn('[Storage] Interval expired items cleanup error:', err);
        });
      }, 15 * 1000);
    } catch (err: any) {
      console.warn('[Telegram] Could not initialize scheduled deletion worker:', err);
    }
  }

  public static armScheduledDeletionTimer(sched: ScheduledDeletion): void {
    if (this.activeTimers.has(sched.id)) return;
    const remainingMs = Math.max(0, sched.deleteAt - Date.now());
    const safeDelay = Math.min(remainingMs, 2147483647); // Max safe setTimeout delay

    const timer = setTimeout(async () => {
      this.activeTimers.delete(sched.id);
      try {
        await this.executeScheduledDeletion(sched);
      } catch (err: any) {
        console.warn(`[Telegram] Scheduled deletion execution error for ${sched.id}:`, err?.message || err);
      }
    }, safeDelay);

    this.activeTimers.set(sched.id, timer);
  }

  public static cancelActiveTimersForChat(chatId: string | number): void {
    const key = String(chatId);
    for (const [id, timer] of this.activeTimers.entries()) {
      if (id.includes(key)) {
        clearTimeout(timer);
        this.activeTimers.delete(id);
      }
    }
  }

  public static async executeScheduledDeletion(sched: ScheduledDeletion): Promise<void> {
    try {
      console.info(`[Telegram] Auto-deleting delivered file message ${sched.messageId} in chat ${sched.chatId} after ${sched.timeoutMinutes}m timeout`);
      
      const targetChatId = /^-?\d+$/.test(String(sched.chatId)) ? Number(sched.chatId) : String(sched.chatId);
      const targetMsgId = Number(sched.messageId);

      // Delete the delivered file message safely
      if (targetChatId && targetMsgId) {
        const res = await this.callTelegramApi('deleteMessage', {
          chat_id: targetChatId,
          message_id: targetMsgId
        });
        if (!res.ok) {
          console.info(`[Telegram] Scheduled deleteMessage result: ${res?.description || 'already removed'}`);
        }
      }

      // Also delete companion notice if one was sent
      if (targetChatId && sched.companionNoticeId) {
        await this.callTelegramApi('deleteMessage', {
          chat_id: targetChatId,
          message_id: Number(sched.companionNoticeId)
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`[Telegram] Error auto-deleting message ${sched.messageId}:`, err?.message || err);
    } finally {
      try {
        await storage.removeScheduledDeletion(sched.id);
      } catch (remErr: any) {
        console.warn(`[Telegram] Error removing scheduled deletion ${sched.id}:`, remErr?.message);
      }
    }
  }

  public static async processDueScheduledDeletions(): Promise<number> {
    try {
      const due = await storage.popDueScheduledDeletions();
      let count = 0;
      for (const sched of due) {
        try {
          await this.executeScheduledDeletion(sched);
          count++;
        } catch (itemErr: any) {
          console.warn('[Telegram] Individual scheduled deletion failed:', itemErr?.message);
        }
      }
      return count;
    } catch (err: any) {
      console.warn('[Telegram] Error in processDueScheduledDeletions:', err);
      return 0;
    }
  }

  // =========================================================================
  // TELEGRAM POLLING & WEBHOOK HYBRID WORKER WITH LEADER ELECTION
  // =========================================================================
  private static pollingActive = false;
  private static pollingOffset = 0;
  private static isInitializing = false;
  private static isLoopRunning = false;
  private static isLeader = false;
  private static leaderCheckTimer: any = null;

  public static async initPollingWorker(): Promise<void> {
    if (this.leaderCheckTimer) {
      console.info('[Telegram] Polling leader supervisor is already initialized. Skipping redundant startup.');
      return;
    }

    // If server is designated as a silent backup mirror (and failover is not active), stay dormant
    try {
      const backupConfig = await storage.getBackupConfig();
      if (backupConfig?.role === 'backup' && !backupConfig?.failoverActive) {
        console.info('[Telegram] Server is running in Silent Backup Mirror mode. Bot listener is dormant awaiting failover signal.');
        return;
      }
    } catch {}

    const token = await this.getBotToken();
    if (!token) {
      console.info('[Telegram] No bot token configured, polling worker waiting.');
      return;
    }

    // Verify Telegram connection & ensure username is saved
    try {
      const me = await this.callTelegramApi('getMe', {});
      if (me?.ok && me.result) {
        console.info(`[Telegram] Connection verified for @${me.result.username || 'Bot'} (ID: ${me.result.id})`);
        const settings = await storage.getSettings();
        if (!settings.botUsername || settings.botUsername !== me.result.username) {
          await storage.updateSettings({ botUsername: me.result.username || '' });
        }
      }
    } catch (e: any) {
      console.warn('[Telegram] Could not verify bot profile on worker init:', e?.message || e);
    }

    // Leader election loop: checks every 4 seconds to guarantee EXACTLY ONE worker polls across Dev, Preview, and external hosts
    const checkLeadershipAndRun = async () => {
      try {
        const claimResult = await storage.tryClaimPollingLeader(BOT_INSTANCE_ID, 12000);
        if (claimResult.isLeader) {
          if (!this.isLeader) {
            console.info(`[Telegram] Instance ${BOT_INSTANCE_ID} elected as PRIMARY active bot listener.`);
            this.isLeader = true;
          }
          if (!this.pollingActive) {
            this.pollingActive = true;
            this.startPollingLoop();
          }
        } else {
          if (this.isLeader) {
            console.warn(`[Telegram] Leadership yielded to ${claimResult.currentLeader}. Halting local polling loop.`);
            this.isLeader = false;
          }
          if (this.pollingActive) {
            this.stopPolling();
          }
        }
      } catch (err: any) {
        console.warn('[Telegram] Leader check warning:', err?.message || err);
      }
    };

    // Run first check immediately, then schedule every 4 seconds
    await checkLeadershipAndRun();
    this.leaderCheckTimer = setInterval(checkLeadershipAndRun, 4000);

    // Cleanly release leadership lock on process termination
    const onExit = async () => {
      if (this.isLeader) {
        try {
          await storage.releasePollingLeader(BOT_INSTANCE_ID);
        } catch {}
      }
    };
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
    process.once('beforeExit', onExit);
  }

  public static isPollingActive(): boolean {
    return this.pollingActive && this.isLeader;
  }

  public static stopPolling(): void {
    this.pollingActive = false;
  }

  public static async releaseLeaderLock(): Promise<void> {
    this.pollingActive = false;
    this.isLeader = false;
    try {
      await storage.releasePollingLeader(BOT_INSTANCE_ID);
    } catch {}
  }

  private static startPollingLoop(): void {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;
    this.runPollingLoop().catch((err) => {
      this.isLoopRunning = false;
      console.warn('[Telegram Polling] Polling loop caught error, auto-recovering in 2s...', err?.message || err);
      setTimeout(() => {
        if (this.pollingActive && this.isLeader) {
          this.startPollingLoop();
        }
      }, 2000);
    });
  }

  private static async runPollingLoop(): Promise<void> {
    try {
      // Clear any stale webhook and DROP all pending backlogged updates to start clean
      try {
        const webhookInfo = await this.callTelegramApi('getWebhookInfo', {});
        if (webhookInfo?.result?.url) {
          console.info(`[Telegram Polling] Found active webhook (${webhookInfo.result.url}). Deleting webhook and dropping pending updates...`);
          await this.callTelegramApi('deleteWebhook', { drop_pending_updates: true });
        }
      } catch (err: any) {
        console.warn('[Telegram Polling] Webhook cleanup check:', err?.message || err);
      }

      // Initialize pollingOffset to latest update_id so old queued messages are flushed immediately
      if (this.pollingOffset === 0) {
        try {
          const peek = await this.callTelegramApi('getUpdates', { offset: -1, limit: 1 });
          if (peek?.ok && Array.isArray(peek.result) && peek.result.length > 0) {
            this.pollingOffset = peek.result[0].update_id + 1;
            console.info(`[Telegram Polling] Advanced initial polling offset to ${this.pollingOffset} to discard stale backlog.`);
          }
        } catch {}
      }

      while (this.pollingActive && this.isLeader) {
        try {
          const res = await this.callTelegramApi('getUpdates', {
            offset: this.pollingOffset,
            timeout: 10,
            allowed_updates: [
              'message', 'edited_message', 'channel_post', 'edited_channel_post',
              'inline_query', 'chosen_inline_result', 'callback_query',
              'my_chat_member', 'chat_member', 'chat_join_request'
            ]
          });

          if (!this.pollingActive || !this.isLeader) {
            break;
          }

          if (res && res.ok && Array.isArray(res.result)) {
            for (const update of res.result) {
              this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
              try {
                await this.handleUpdate(update);
              } catch (updateErr: any) {
                console.error('[Telegram Polling] Error handling update:', updateErr?.message || updateErr);
              }
            }
          }
        } catch (err: any) {
          if (err?.message && err.message.includes('409')) {
            console.warn('[Telegram Polling] 409 Conflict: another instance is active. Yielding leadership for 6s...');
            this.isLeader = false;
            await new Promise((r) => setTimeout(r, 6000));
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } finally {
      this.isLoopRunning = false;
    }
  }
}

export class ClonedBotRunner {
  private isRunning: boolean = false;
  private isLoopActive: boolean = false;
  private pollingOffset: number = 0;
  private lastPollAt: number = Date.now();
  private abortController: AbortController | null = null;

  constructor(public readonly bot: ClonedBotRecord) {}

  public isAlive(): boolean {
    return this.isRunning && this.isLoopActive && (Date.now() - this.lastPollAt < 90000);
  }

  public async start(): Promise<void> {
    if (this.isRunning && this.isLoopActive) return;
    this.isRunning = true;
    this.lastPollAt = Date.now();
    this.abortController = new AbortController();

    console.info(`[ClonedBot ${this.bot.id}] Starting isolated runner for @${this.bot.username}...`);

    try {
      await TelegramService.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, this.bot.token);
    } catch {}

    this.launchLoop();
  }

  private launchLoop(): void {
    if (!this.isRunning || this.isLoopActive) return;
    this.isLoopActive = true;
    this.runLoop()
      .catch(err => {
        console.warn(`[ClonedBot ${this.bot.id}] Runner error:`, err?.message || err);
      })
      .finally(() => {
        this.isLoopActive = false;
        if (this.isRunning) {
          setTimeout(() => {
            if (this.isRunning) {
              this.launchLoop();
            }
          }, 2000);
        }
      });
  }

  public stop(): void {
    this.isRunning = false;
    this.isLoopActive = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.info(`[ClonedBot ${this.bot.id}] Runner stopped.`);
  }

  private async runLoop(): Promise<void> {
    const botStorage = StorageManager.getStorage(this.bot.id);
    try {
      await botStorage.init();
    } catch (initErr: any) {
      console.warn(`[ClonedBot ${this.bot.id}] Storage init notice:`, initErr?.message || initErr);
    }

    if (this.pollingOffset === 0) {
      try {
        const peek = await TelegramService.callTelegramApi('getUpdates', { offset: -1, limit: 1 }, this.bot.token);
        if (peek?.ok && Array.isArray(peek.result) && peek.result.length > 0) {
          this.pollingOffset = peek.result[0].update_id + 1;
        }
      } catch {}
    }

    while (this.isRunning) {
      try {
        this.lastPollAt = Date.now();
        const res = await TelegramService.callTelegramApi('getUpdates', {
          offset: this.pollingOffset,
          timeout: 10,
          allowed_updates: [
            'message', 'edited_message', 'channel_post', 'edited_channel_post',
            'inline_query', 'chosen_inline_result', 'callback_query',
            'my_chat_member', 'chat_member', 'chat_join_request'
          ]
        }, this.bot.token);
        this.lastPollAt = Date.now();

        if (!this.isRunning) break;

        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
            try {
              await storageContext.run(botStorage, async () => {
                await botTokenContext.run(this.bot.token, async () => {
                  await TelegramService.handleUpdate(update, this.bot.token, this.bot.id);
                });
              });
            } catch (err: any) {
              console.error(`[ClonedBot ${this.bot.id}] Update error:`, err?.message || err);
            }
          }
        } else if (res && res.description && String(res.description).includes('409')) {
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (err: any) {
        if (!this.isRunning) break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
}

export class TelegramBotManager {
  private static runners: Map<string, ClonedBotRunner> = new Map();
  private static watchdogTimer: NodeJS.Timeout | null = null;

  public static async verifyBotToken(token: string): Promise<{ ok: boolean; info?: any; error?: string }> {
    try {
      const clean = token.trim().replace(/^["']|["']$/g, '');
      const res = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
      const data = await res.json();
      if (data?.ok && data.result) {
        return { ok: true, info: data.result };
      }
      return { ok: false, error: data?.description || 'Invalid bot token' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error verifying bot token' };
    }
  }

  public static ensureBotRunning(bot: ClonedBotRecord): void {
    if (!bot || bot.status === 'stopped') return;
    const existing = this.runners.get(bot.id);
    if (!existing || !existing.isAlive()) {
      this.startBotInstance(bot);
    }
  }

  private static startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(async () => {
      try {
        const mainStorage = StorageManager.getMainStorage();
        const bots = await mainStorage.getClonedBots().catch(() => []);
        for (const bot of bots) {
          if (bot.status !== 'stopped') {
            const runner = this.runners.get(bot.id);
            if (!runner || !runner.isAlive()) {
              console.info(`[Watchdog] Reviving polling runner for cloned bot @${bot.username} (${bot.id})...`);
              this.startBotInstance(bot);
            }
          }
        }
      } catch (err: any) {
        console.warn('[Watchdog] Cloned bot watchdog notice:', err?.message || err);
      }
    }, 30000);
  }

  public static async initAllBots(): Promise<void> {
    try {
      const mainStorage = StorageManager.getMainStorage();
      const bots = await mainStorage.getClonedBots();
      console.info(`[TelegramBotManager] Initializing ${bots.length} cloned bots...`);
      for (const bot of bots) {
        if (bot.status !== 'stopped') {
          this.startBotInstance(bot);
        }
      }
      this.startWatchdog();
    } catch (err: any) {
      console.error('[TelegramBotManager] Error initializing cloned bots:', err?.message || err);
    }
  }

  public static getActiveBaseUrl(customBase?: string): string {
    if (customBase && typeof customBase === 'string' && customBase.startsWith('http')) {
      return customBase.trim().replace(/\/+$/, '');
    }
    const envUrl = 
      process.env.BASE_URL ||
      process.env.APP_URL || 
      process.env.RENDER_EXTERNAL_URL ||
      (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '') ||
      process.env.URL ||
      'https://ais-pre-5pmvaj2s66z7xu34aogymi-761412699643.asia-east1.run.app';
    return envUrl.trim().replace(/\/+$/, '');
  }

  public static startBotInstance(bot: ClonedBotRecord): void {
    if (this.runners.has(bot.id)) {
      this.runners.get(bot.id)?.stop();
    }
    const runner = new ClonedBotRunner(bot);
    this.runners.set(bot.id, runner);
    runner.start().catch(() => {});
  }

  public static async cloneBot(token: string, createdBy?: string, customBaseUrl?: string): Promise<{ success: boolean; bot?: ClonedBotRecord; error?: string }> {
    const cleanToken = token.trim().replace(/^["']|["']$/g, '');
    const verification = await this.verifyBotToken(cleanToken);
    if (!verification.ok || !verification.info) {
      return { success: false, error: verification.error || 'Invalid bot token' };
    }

    const info = verification.info;
    const botId = `clone_${info.id}`;

    // 1. Check if token matches main bot's active token
    const mainBotToken = await TelegramService.getBotToken();
    if (cleanToken && mainBotToken && cleanToken === mainBotToken) {
      return { success: false, error: 'Already this bot is already running.' };
    }

    // 2. Check if token or bot ID is already in cloned bots registry
    const mainStorage = StorageManager.getMainStorage();
    const existing = await mainStorage.getClonedBots();
    const foundExisting = existing.find((b: ClonedBotRecord) => b.token === cleanToken || b.id === botId);
    if (foundExisting) {
      return { success: false, error: 'Already this bot is already running.' };
    }

    // 3. Generate unique sub-admin credentials and full active web app panel URL
    const cleanUsername = info.username ? info.username.toLowerCase().replace(/[^a-z0-9_]/g, '') : `bot_${info.id}`;
    const adminUsername = `admin_${cleanUsername}`;
    const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    const numPart = Math.floor(100 + Math.random() * 900);
    const adminPassword = `Zexi#${randPart}${numPart}`;
    const baseDomain = this.getActiveBaseUrl(customBaseUrl);
    const panelUrl = `${baseDomain}/panel?bot_id=${botId}`;

    const newBot: ClonedBotRecord = {
      id: botId,
      token: cleanToken,
      name: info.first_name || 'Cloned Bot',
      username: info.username || '',
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: createdBy || 'admin',
      filesCount: 0,
      usersCount: 0,
      adminUsername,
      adminPassword,
      panelUrl
    };

    await mainStorage.saveClonedBot(newBot);

    // Initialize isolated storage for this cloned bot
    const botStorage = StorageManager.getStorage(botId);
    await botStorage.init();
    await botStorage.updateSettings({
      botToken: cleanToken,
      botUsername: info.username || ''
    });

    // 4. Create and register the dedicated Sub-Admin account strictly inside isolated bot storage
    const subAdminAccount = {
      id: `adm_${info.id}`,
      telegramId: String(info.id),
      name: `${info.first_name || 'Bot'} Administrator`,
      username: adminUsername,
      role: 'owner' as const, // Owner of this isolated cloned bot instance
      passwordHash: await hashPassword(adminPassword),
      permissions: {
        files_view: true, files_add: true, files_edit: true, files_delete: true,
        links_view: true, links_add: true, links_edit: true, links_delete: true,
        messages_view: true, messages_edit: true, admins_manage: false,
        design_edit: true, settings_edit: true, cleanup_manage: true
      },
      status: 'active' as const,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    // Save strictly in cloned bot's isolated storage (never pollute mainStorage.admins!)
    await botStorage.saveAdmin(subAdminAccount);
    await botStorage.syncToFirebaseCloud();

    // Commit sub-admin record directly into Firebase Realtime Database under isolated paths
    try {
      const rtdbToken = await mainStorage.getFirebaseAuthToken();
      const isSecondary = process.env.FIREBASE_PROJECT_PROFILE === 'secondary' || process.env.ACTIVE_BOT_PROFILE === 'secondary';
      const baseUrl = (process.env.FIREBASE_DATABASE_URL || (isSecondary ? 'https://zexi-official-default-rtdb.asia-southeast1.firebasedatabase.app' : 'https://zexiofficial844-default-rtdb.asia-southeast1.firebasedatabase.app')).replace(/\/+$/, '');
      
      const subAdminData = {
        botId,
        botName: newBot.name,
        botUsername: newBot.username,
        adminUsername,
        adminPassword,
        status: 'active',
        enabled: true,
        permissions: subAdminAccount.permissions,
        createdAt: newBot.createdAt,
        panelUrl
      };

      // Store under /cloned_bots/{bot_id}/sub_admins
      const botSubAdminUrl = rtdbToken 
        ? `${baseUrl}/cloned_bots/${botId}/sub_admins/${adminUsername}.json?auth=${encodeURIComponent(rtdbToken)}`
        : `${baseUrl}/cloned_bots/${botId}/sub_admins/${adminUsername}.json`;
      fetch(botSubAdminUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subAdminData)
      }).catch(() => {});

      // Store under global /sub_admins/{bot_id}
      const globalSubAdminUrl = rtdbToken
        ? `${baseUrl}/sub_admins/${botId}.json?auth=${encodeURIComponent(rtdbToken)}`
        : `${baseUrl}/sub_admins/${botId}.json`;
      fetch(globalSubAdminUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subAdminData)
      }).catch(() => {});
    } catch (e: any) {
      console.warn('[TelegramBotManager] Error writing sub-admin to Firebase RTDB:', e?.message || e);
    }

    this.startBotInstance(newBot);
    console.info(`[TelegramBotManager] Cloned bot @${newBot.username} (${newBot.id}) started and sub-admin ${adminUsername} registered successfully!`);
    return { success: true, bot: newBot };
  }

  public static async deleteClonedBot(id: string): Promise<boolean> {
    if (id === 'main') return false;
    if (this.runners.has(id)) {
      this.runners.get(id)?.stop();
      this.runners.delete(id);
    }
    const mainStorage = StorageManager.getMainStorage();
    await mainStorage.deleteClonedBot(id);
    return true;
  }

  public static async getAllBots(): Promise<Array<{
    id: string;
    name: string;
    username: string;
    isMain: boolean;
    status: 'active' | 'stopped';
    filesCount: number;
    usersCount: number;
    createdAt?: string;
    adminUsername?: string;
    adminPassword?: string;
    panelUrl?: string;
  }>> {
    const mainStorage = StorageManager.getMainStorage();
    const mainSettings = await mainStorage.getSettings().catch(() => ({} as any));
    const mainItems = await mainStorage.getItems().catch(() => []);
    const mainUsers = await mainStorage.getBotUsers().catch(() => []);

    const list: any[] = [{
      id: 'main',
      name: mainSettings.botUsername ? `@${mainSettings.botUsername}` : 'Main Bot',
      username: mainSettings.botUsername || '',
      isMain: true,
      status: 'active',
      filesCount: mainItems.length,
      usersCount: mainUsers.length
    }];

    const cloned = await mainStorage.getClonedBots().catch(() => []);
    for (const c of cloned) {
      const cStorage = StorageManager.getStorage(c.id);
      const cItems = await cStorage.getItems().catch(() => []);
      const cUsers = await cStorage.getBotUsers().catch(() => []);
      list.push({
        id: c.id,
        name: c.name || `@${c.username}`,
        username: c.username,
        isMain: false,
        status: this.runners.has(c.id) ? 'active' : (c.status || 'active'),
        filesCount: cItems.length,
        usersCount: cUsers.length,
        createdAt: c.createdAt,
        adminUsername: c.adminUsername,
        adminPassword: c.adminPassword,
        panelUrl: (c.panelUrl && c.panelUrl.startsWith('http'))
          ? c.panelUrl
          : `${this.getActiveBaseUrl()}${c.panelUrl || `/panel?bot_id=${c.id}`}`
      });
    }

    return list;
  }
}
