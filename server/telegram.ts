import { storage, ItemRecord, TriggerType, OpenMode, ScheduledDeletion } from './storage';
import { hashPassword } from '../netlify/functions/lib/auth';

// In-memory conversation state for interactive private chat commands (like /add)
interface AddSession {
  stage: 
    | 'awaiting_content'
    | 'awaiting_file_content'
    | 'awaiting_link_url'
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
    | 'awaiting_caption';
  type?: 'file' | 'link';
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
}

const activeAddSessions: Map<string, AddSession> = new Map();
const activeEditSessions: Map<string, { templateKey: string }> = new Map();

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

export function getItemPayload(item: ItemRecord): string {
  if (item.id.startsWith('f_') || item.id.startsWith('l_')) {
    return item.id;
  }
  return `${item.type === 'file' ? 'f_' : 'l_'}${item.id}`;
}

export class TelegramService {
  private static async getBotToken(): Promise<string> {
    const settings = await storage.getSettings();
    return settings.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  public static async callTelegramApi(method: string, payload: Record<string, any>): Promise<any> {
    const token = await this.getBotToken();
    if (!token) {
      console.warn(`[Telegram] Skipping ${method}: No TELEGRAM_BOT_TOKEN configured.`);
      return { ok: false, description: 'No bot token configured' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
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
      update.channel_post?.from ||
      update.edited_channel_post?.from ||
      update.shipping_query?.from ||
      update.pre_checkout_query?.from ||
      update.poll_answer?.user ||
      update.my_chat_member?.from ||
      update.chat_member?.from ||
      update.chat_join_request?.from ||
      update.message_reaction?.user ||
      update.message?.forward_from;

    if (rawUser && rawUser.id) {
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
      return {
        id: chat.id,
        username: chat.username ? `@${chat.username.replace(/^@+/, '').trim()}` : undefined,
        firstName: chat.first_name,
        lastName: chat.last_name
      };
    }

    return null;
  }

  // Process incoming webhook or polling update
  public static async handleUpdate(update: any): Promise<void> {
    if (!update) return;

    // 1. AUTOMATIC UNIQUE UID TRACKING & DATABASE SAVING (Requirement 1 & 2):
    // Intercept every incoming update (message, command like /start, callback query, etc.) from any user.
    // Extract their Telegram User ID, First Name, Last Name, and @username.
    // Immediately check if this User ID exists in the database. If not, save instantly; if so, update lastActive and online status.
    const userPayload = this.extractUserFromUpdate(update);
    const fromId = userPayload?.id ? String(userPayload.id).trim() : '';

    if (userPayload && userPayload.id) {
      try {
        await storage.trackBotUser({
          id: userPayload.id,
          username: userPayload.username,
          firstName: userPayload.firstName,
          lastName: userPayload.lastName
        });
      } catch (err: any) {
        console.warn('[Telegram] User tracking error:', err.message || err);
      }
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

    // Handle Inline Button Clicks (Callback queries from /add flow)
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
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim();
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
  // GROUP MESSAGE HANDLING (EXACT TRIGGER MATCHING & STRICT GROUP PRIVACY)
  // =========================================================================
  private static async handleGroupMessage(message: any, text: string): Promise<void> {
    if (!text && !message.document && !message.photo && !message.video && !message.audio) return;

    const fromId = String(message.from?.id || '');

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

    const isAdminCommand =
      isAddCommand ||
      isCancelCommand ||
      isWebCodeCommand ||
      isSetPasswordCommand ||
      isSetStartMsgCommand ||
      isSetStartMediaCommand ||
      isClearStartMediaCommand ||
      isCleanupCommand ||
      isAdminListCommand;

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
      const template = templates.GROUP_FILE_REPLY || { content: "👇 Tap below — I'll send your file privately." };
      const buttonTemplate = templates.GET_FILE_BUTTON || { content: '🔒 Get File Privately' };

      const replyText = template.content
        .replace('{user_name}', userName)
        .replace('{user_id}', userId)
        .replace('{trigger}', text)
        .replace('{file_name}', matchedItem.fileName || matchedItem.name);

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const res = await this.callTelegramApi('sendMessage', {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: replyText,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: (buttonTemplate.content || 'Get File Privately').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s🔒]+/u, '').trim() || 'Get File Privately',
                url: deepLink,
                style: 'primary'
              }
            ]
          ]
        }
      });

      if (res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
    } else if (matchedItem.type === 'link') {
      const template = templates.GROUP_LINK_REPLY || { content: "👇 Tap below — I'll send the link privately." };
      const buttonTemplate = templates.GET_LINK_BUTTON || { content: 'Open Privately' };

      const replyText = template.content
        .replace('{user_name}', userName)
        .replace('{user_id}', userId)
        .replace('{trigger}', text)
        .replace('{title}', matchedItem.name);

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const res = await this.callTelegramApi('sendMessage', {
        chat_id: message.chat.id,
        reply_to_message_id: message.message_id,
        text: replyText,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: (buttonTemplate.content || 'Open Privately').replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\s🔒]+/u, '').trim() || 'Open Privately',
                url: deepLink,
                style: 'primary'
              }
            ]
          ]
        }
      });

      if (res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
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

    // Check if user is in an active /editthismessage session
    const editSession = activeEditSessions.get(fromId);
    if (editSession && text) {
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
      if (rawPayload) {
        await this.handleDeepLinkDelivery(chatId, rawPayload);
        return;
      } else {
        const templates = await storage.getTemplates();
        const startTemplate = templates.START_MESSAGE;
        let startMsg = startTemplate?.content || "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}\n\n✨ <i>Send any hashtag (e.g., #box, #crack) in your group or here to receive your files privately!</i>";
        
        // Comprehensive Username & Name variables
        const cleanUsername = message.from?.username ? `@${message.from.username.replace(/^@+/, '')}` : '';
        const userDisplayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || cleanUsername || 'User';
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
          .replace(/@@([a-zA-Z0-9_]+)/g, '@$1'); // Avoid double @@

        const mediaType = startTemplate?.mediaType || 'none';
        const mediaUrl = startTemplate?.mediaUrl?.trim();

        // User Requirement: Completely remove the two inline buttons from the bottom of the start/welcome message.
        // The start message displays only the media (photo/video) and formatted caption text with the @username placeholder, without any attached inline buttons below it.
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
                // If a real Telegram file_id was returned, cache it in template for fast future sends
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
        return;
      }
    }

    // 2b. Filters command (/filters, /filter) - Strictly requires '/' prefix
    const isFilters = /^\/(?:filters|filter)(?:@\w+)?$/i.test(text.trim());
    if (isFilters) {
      await this.handleFiltersCommand(chatId, message.message_id, false);
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
        await this.handleDeepLinkDelivery(chatId, payload);
        return;
      }
    }

    // Other private text: silent or minimal response
  }

  // =========================================================================
  // PRIVATE DELIVERY FLOW
  // =========================================================================
  private static async handleDeepLinkDelivery(chatId: string | number, rawPayload: string): Promise<void> {
    if (!rawPayload) return;

    // Automatically register recipient UID whenever a user receives/takes anything from the bot
    if (chatId) {
      try {
        await storage.trackBotUser({ id: chatId });
      } catch (err: any) {
        console.warn('[Telegram] User tracking in delivery error:', err.message || err);
      }
    }

    // Deduplication check for retried webhooks
    if (isDuplicateDelivery(chatId, rawPayload)) {
      console.info('[Telegram] Skipping duplicate delivery for chat:', chatId, 'payload:', rawPayload);
      return;
    }

    // Force reload latest data from persistent storage (Netlify Blobs / disk)
    await storage.loadLatest(true);

    const cleanPayload = rawPayload.trim();
    const normalizedId = cleanPayload.replace(/^(?:f_|l_)+/, '');

    // Resolve item using raw payload, prefixed, normalized ID, or trigger match
    let item: ItemRecord | null = await storage.getItem(cleanPayload);
    if (!item) {
      item = await storage.getItem(`f_${normalizedId}`);
    }
    if (!item) {
      item = await storage.getItem(`l_${normalizedId}`);
    }
    if (!item) {
      item = await storage.getItem(normalizedId);
    }
    if (!item) {
      item = await storage.findItemByTrigger(cleanPayload);
    }
    if (!item && !cleanPayload.startsWith('#')) {
      item = await storage.findItemByTrigger(`#${cleanPayload}`);
    }
    if (!item && !cleanPayload.startsWith('/')) {
      item = await storage.findItemByTrigger(`/${cleanPayload}`);
    }
    if (!item) {
      const allItems = await storage.getItems();
      item = allItems.find(i => 
        i.id === cleanPayload || 
        i.id === normalizedId || 
        i.id === `f_${normalizedId}` || 
        i.id === `l_${normalizedId}` ||
        i.rawKeyword === cleanPayload ||
        i.triggers.includes(cleanPayload)
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

    // 1. Progress indicator: ONLY send temporary status for files that need transfer
    let deliveryStatusMsgId: number | null = null;
    if (item.type === 'file') {
      try {
        const templates = await storage.getTemplates();
        let statusText = templates.DELIVERY_STATUS_MESSAGE?.content || '⏳ Delivering your file...';
        statusText = statusText
          .replace(/\{name\}/g, item.fileName || item.name || '')
          .replace(/\{type\}/g, item.type || 'file');

        // Send appropriate chat action (uploading)
        const chatAction = item.fileType === 'video' ? 'upload_video' : item.fileType === 'photo' ? 'upload_photo' : 'upload_document';
        this.callTelegramApi('sendChatAction', {
          chat_id: chatId,
          action: chatAction
        }).catch(() => {});

        const statusRes = await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: statusText
        });

        if (statusRes.ok && statusRes.result?.message_id) {
          deliveryStatusMsgId = statusRes.result.message_id;
        }
      } catch (statusErr) {
        console.warn('[Telegram] Could not send initial delivery progress message:', statusErr);
      }
    } else {
      // For links: send typing action, deliver directly without temporary placeholder
      this.callTelegramApi('sendChatAction', {
        chat_id: chatId,
        action: 'typing'
      }).catch(() => {});
    }

    try {
      if (item.type === 'file') {
        // RULE 6 & 7:
        // If admin adds ONLY file: send ONLY the file! No extra text!
        // If admin adds file + custom caption: send ONLY file + exact caption!
        const caption = item.caption ? item.caption : undefined;
        let fileIdOrUrl = item.telegramFileId || item.url;

        // Check if this item has an uploaded file buffer in persistent storage
        const uploadRef = item.uploadedFileId || item.telegramFileId || item.id;
        let uploadedFile = uploadRef ? await storage.getUploadedFile(uploadRef) : null;
        if (!uploadedFile && item.id) {
          uploadedFile = await storage.getUploadedFile(item.id);
        }
        if (!uploadedFile && item.telegramFileId) {
          uploadedFile = await storage.getUploadedFile(item.telegramFileId);
        }

        // Check if item has fileBase64 stored directly on record
        if (!uploadedFile && item.fileBase64) {
          try {
            const buf = Buffer.from(item.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            uploadedFile = {
              id: item.uploadedFileId || item.id,
              fileName: item.fileName || item.name || 'file',
              fileType: item.fileType || 'document',
              mimeType: item.mimeType || 'application/octet-stream',
              size: buf.length,
              buffer: buf,
              createdAt: item.createdAt
            };
          } catch {}
        }

        // If local data URI is present in url, extract buffer
        if (!uploadedFile && item.url && item.url.startsWith('data:')) {
          try {
            const matches = item.url.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              const buf = Buffer.from(matches[2], 'base64');
              uploadedFile = {
                id: item.id,
                fileName: item.fileName || item.name,
                fileType: item.fileType || 'document',
                mimeType: matches[1],
                size: buf.length,
                buffer: buf,
                createdAt: item.createdAt
              };
            }
          } catch {}
        }

        const isLocalIdentifier = Boolean(fileIdOrUrl && (
          fileIdOrUrl.startsWith('upload_') || 
          fileIdOrUrl.startsWith('local_') || 
          fileIdOrUrl.startsWith('phone_')
        ));

        let res: any = null;

        // Priority 1: If it's a local upload ID and we have the uploaded file buffer, deliver directly via multipart!
        if (isLocalIdentifier && uploadedFile) {
          console.info('[Telegram] Delivering uploaded file directly via multipart buffer to chat:', chatId, 'file:', uploadedFile.fileName);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption);
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
              ...(caption ? { caption } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {})
              });
            }
          } else if (item.fileType === 'video') {
            res = await this.callTelegramApi('sendVideo', {
              chat_id: chatId,
              video: fileIdOrUrl,
              ...(caption ? { caption } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {})
              });
            }
          } else if (item.fileType === 'audio') {
            res = await this.callTelegramApi('sendAudio', {
              chat_id: chatId,
              audio: fileIdOrUrl,
              ...(caption ? { caption } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {})
              });
            }
          } else {
            res = await this.callTelegramApi('sendDocument', {
              chat_id: chatId,
              document: fileIdOrUrl,
              ...(caption ? { caption } : {})
            });
          }

          // Fallback if Telegram API rejected remote file_id (e.g. invalid/mock/expired) but we have the local uploaded file
          if ((!res || !res.ok) && uploadedFile) {
            console.warn('[Telegram] Remote file_id rejected by Telegram, falling back to direct buffer delivery:', res?.description);
            res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption);
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
        } else if (uploadedFile) {
          // Priority 3: No fileIdOrUrl specified but uploadedFile buffer is available
          console.info('[Telegram] Delivering uploaded file directly to chat:', chatId);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption);
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
            try {
              const settings = await storage.getSettings();
              const autoDeleteEnabled = settings.autoDeleteDeliveryEnabled !== false;
              const timeoutMinutes = settings.deliveryTimeoutMinutes || 10;

              if (autoDeleteEnabled) {
                // Persist scheduled deletion record so it survives restarts (completely silent, no notice message to anyone)
                const sched = await storage.scheduleMessageDeletion({
                  chatId: String(chatId),
                  messageId: deliveredMessageId,
                  timeoutMinutes,
                  itemTitle: item.fileName || item.name || 'file'
                });

                // Arm immediate in-memory timer
                TelegramService.armScheduledDeletionTimer(sched);
                console.info(`[Telegram] Armed ${timeoutMinutes}-minute auto-delete timer for delivered file message ${deliveredMessageId} in chat ${chatId} (Silent: no notice message sent)`);
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
        const rawButtonText = item.buttonText || (item.openMode === 'webapp' ? 'Launch App' : 'Open Link');
        const buttonText = rawButtonText.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim() || 'Open Link';

        const isHttps = /^https:\/\//i.test(item.url || '');
        const canUseWebApp = item.openMode === 'webapp' && isHttps;

        const inlineButton: any = { text: buttonText, style: 'primary' };
        if (canUseWebApp) {
          inlineButton.web_app = { url: item.url };
        } else {
          inlineButton.url = item.url;
        }

        let res = await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: messageText,
          reply_markup: {
            inline_keyboard: [[inlineButton]]
          }
        });

        // If Telegram rejected web_app button, fallback immediately to regular url button
        if ((!res || !res.ok) && canUseWebApp) {
          console.warn('[Telegram] web_app button delivery rejected, falling back to regular url:', res?.description);
          res = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: messageText,
            reply_markup: {
              inline_keyboard: [[{ text: buttonText, url: item.url, style: 'primary' }]]
            }
          });
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered link privately to chat:', chatId, 'item:', item.id);
          await storage.incrementItemDelivery(item.id);
        } else {
          console.warn('[Telegram] Telegram link delivery API failed, sending fallback text:', res?.description);
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `${messageText}\n\n👉 ${item.url}`
          });
          await storage.incrementItemDelivery(item.id);
        }
      }
    } finally {
      // 2. Automatically delete the temporary delivery status message once delivery completes
      if (deliveryStatusMsgId) {
        try {
          await this.callTelegramApi('deleteMessage', {
            chat_id: chatId,
            message_id: deliveryStatusMsgId
          });
          console.info('[Telegram] Deleted temporary delivery progress message:', deliveryStatusMsgId);
        } catch (delErr) {
          console.warn('[Telegram] Could not delete delivery progress message:', delErr);
        }
      }
    }
  }

  // =========================================================================
  // QUICK FILE KEYWORDS / FILTERS COMMAND (/filters, /filter, #filters)
  // =========================================================================
  private static async handleFiltersCommand(chatId: number | string, messageId?: number, isGroup: boolean = false): Promise<void> {
    await storage.loadLatest(true);
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
          // STRICT RULE: Only valid hashtags starting with '#' (e.g., #box, #crack). Ignore/reject slash commands or plain text!
          if (clean.startsWith('#') && clean.length > 1) {
            hashtags.push(clean);
          }
        }
      }
    }

    const uniqueTags = Array.from(new Set(hashtags)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

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
      `📥 <b>What would you like to add?</b>\n\nChoose an option below or send your <b>File</b> or <b>Web Link (URL)</b> directly:\n• <b>File:</b> Document, Photo, Video, Audio, APK, ZIP\n• <b>Link:</b> Website URL (https://...)`,
      {
        inline_keyboard: [
          [
            { text: 'Add File', callback_data: 'add_choose_file', style: 'primary' },
            { text: 'Add Link', callback_data: 'add_choose_link', style: 'primary' }
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

    // Stage 1: Awaiting Content Choice (Detects File or Link)
    if (session.stage === 'awaiting_content') {
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
        '📥 Please send the <b>File</b> you want to add or send a <b>Web Link (URL)</b> starting with http:// or https:// (or type /cancel to abort):',
        {
          inline_keyboard: [
            [
              { text: 'Add File', callback_data: 'add_choose_file', style: 'primary' },
              { text: 'Add Link', callback_data: 'add_choose_link', style: 'primary' }
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
      session.buttonText = customBtn ? customBtn.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim() : 'Open Link';
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
        await this.finalizeAndSaveItem(fromId, chatId, session);
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
      await this.finalizeAndSaveItem(fromId, chatId, session);
      return;
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
    const id = `${isFile ? 'f_' : 'l_'}${Date.now().toString(36)}`;
    const retentionType = session.retentionType || 'permanent';
    const retentionDays = retentionType === 'temporary' ? (session.retentionDays || 7) : undefined;
    const expiresAt = retentionType === 'temporary'
      ? new Date(Date.now() + (retentionDays || 7) * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const inFiltersList = session.inFiltersList === true;
    const openMode: OpenMode = session.openMode || 'browser';

    let newItem: ItemRecord;

    if (isFile) {
      const fileName = session.fileData?.fileName || 'Uploaded File';
      newItem = {
        id,
        type: 'file',
        name: fileName,
        triggers,
        triggerType,
        rawKeyword,
        inFiltersList,
        telegramFileId: session.fileData?.fileId,
        telegramFileUniqueId: session.fileData?.fileUniqueId,
        fileType: session.fileData?.fileType || 'document',
        fileName,
        fileSize: session.fileData?.fileSize || 0,
        mimeType: session.fileData?.mimeType || 'application/octet-stream',
        caption: session.caption || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        deliveryCount: 0,
        retentionType,
        retentionDays,
        expiresAt
      };
    } else {
      const url = session.linkData?.url || 'https://';
      const name = session.linkData?.name || `Link (${rawKeyword})`;
      const defaultBtn = openMode === 'webapp' ? 'Launch App' : 'Open Link';
      const rawBtn = session.buttonText || session.linkData?.buttonText || defaultBtn;
      const buttonText = rawBtn.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim() || 'Open Link';
      const defaultReply = `🔗 Here is your requested link: ${url}`;
      const replyMessage = session.replyMessage || session.linkData?.replyMessage || defaultReply;
      newItem = {
        id,
        type: 'link',
        name,
        url,
        openMode,
        buttonText,
        replyMessage,
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
        expiresAt
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

    const deliveryDesc = isFile
      ? 'Direct Telegram Document / Media File'
      : (openMode === 'webapp' ? 'Telegram Mini App (Embedded)' : 'Standard Web Browser');

    const successText = `✅ <b>Success! Your ${isFile ? 'file' : 'link'} has been saved successfully.</b>\n\n📋 <b>Configuration Details:</b>\n• Type: <b>${isFile ? '📁 File' : '🔗 Web Link'}</b>\n• Name: <b>${newItem.name}</b>\n• Trigger: <code>${primaryTrigger}</code> (${triggerType})\n• Public Filters: <b>${filterStatus}</b>\n• Delivery Mode: <b>${deliveryDesc}</b>\n• Retention: <b>${retentionDesc}</b>\n\n🔗 <b>Direct Link:</b>\n${deepLink}\n\n💡 <i>Type <code>${primaryTrigger}</code> in any group or here to test delivery!</i>`;

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

    await this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id });

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

    // Step 1: Trigger Type Selection (#, /, or normal)
    if (data === 'add_kw_hashtag' || data === 'add_kw_slash' || data === 'add_kw_normal') {
      if (session) {
        session.triggerType = data === 'add_kw_hashtag' ? 'hashtag' : data === 'add_kw_slash' ? 'slash' : 'normal';
        session.stage = 'awaiting_trigger_name';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        const promptExample = session.triggerType === 'hashtag'
          ? 'e.g., #box or #crack'
          : session.triggerType === 'slash'
          ? 'e.g., /download or /play'
          : 'e.g., box or tutorial';

        const stepHeader = session.type === 'file' ? 'Step 2/4' : 'Step 2/7';

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>${stepHeader}: Trigger Name</b>\nPlease enter the trigger keyword for this ${session.type === 'file' ? 'file' : 'link'} (${promptExample}):`,
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
        await this.finalizeAndSaveItem(fromId, chatId, session);
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
          text: `ℹ️ <b>How to Use This Bot:</b>\n\n• Type any file hashtag (e.g. <code>#box</code>, <code>#crack</code>) in your group or here to receive your file privately.\n• All files are delivered securely and privately in direct message.\n• Type <code>/filters</code> anytime to see the full list of available file hashtags.\n• To open public links, tap the button provided in group responses.`,
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
    caption?: string
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

      // 3. Periodic sweep every 30 seconds for bulletproof reliability
      setInterval(() => {
        TelegramService.processDueScheduledDeletions().catch(err => {
          console.warn('[Telegram] Interval auto-delete worker error:', err);
        });
        storage.checkAndCleanExpiredItems().catch(err => {
          console.warn('[Storage] Interval expired items cleanup error:', err);
        });
      }, 30 * 1000);
    } catch (err: any) {
      console.warn('[Telegram] Could not initialize scheduled deletion worker:', err);
    }
  }

  public static armScheduledDeletionTimer(sched: ScheduledDeletion): void {
    if (this.activeTimers.has(sched.id)) return;
    const remainingMs = Math.max(0, sched.deleteAt - Date.now());

    const timer = setTimeout(async () => {
      this.activeTimers.delete(sched.id);
      await this.executeScheduledDeletion(sched);
    }, remainingMs);

    this.activeTimers.set(sched.id, timer);
  }

  public static async executeScheduledDeletion(sched: ScheduledDeletion): Promise<void> {
    try {
      console.info(`[Telegram] Auto-deleting delivered file message ${sched.messageId} in chat ${sched.chatId} after ${sched.timeoutMinutes}m timeout`);
      
      // Delete the delivered file message
      await this.callTelegramApi('deleteMessage', {
        chat_id: sched.chatId,
        message_id: sched.messageId
      });

      // Also delete the companion self-destruct notice if one was sent
      if (sched.companionNoticeId) {
        await this.callTelegramApi('deleteMessage', {
          chat_id: sched.chatId,
          message_id: sched.companionNoticeId
        });
      }
    } catch (err: any) {
      console.warn(`[Telegram] Error auto-deleting message ${sched.messageId}:`, err.message);
    } finally {
      await storage.removeScheduledDeletion(sched.id);
    }
  }

  public static async processDueScheduledDeletions(): Promise<number> {
    try {
      const due = await storage.popDueScheduledDeletions();
      let count = 0;
      for (const sched of due) {
        await this.executeScheduledDeletion(sched);
        count++;
      }
      return count;
    } catch (err: any) {
      console.warn('[Telegram] Error in processDueScheduledDeletions:', err);
      return 0;
    }
  }

  // =========================================================================
  // TELEGRAM POLLING & WEBHOOK HYBRID WORKER
  // =========================================================================
  private static pollingActive = false;
  private static pollingOffset = 0;

  public static async initPollingWorker(): Promise<void> {
    if (this.pollingActive) return;

    const token = await this.getBotToken();
    if (!token) {
      console.info('[Telegram] No bot token configured, polling worker waiting.');
      return;
    }

    try {
      const webhookInfo = await this.callTelegramApi('getWebhookInfo', {});
      if (webhookInfo?.result?.url) {
        console.info(`[Telegram] Webhook is active (${webhookInfo.result.url}). Webhook ingress handles updates.`);
        return;
      }
    } catch (err: any) {
      console.warn('[Telegram] Could not check webhook status:', err.message);
    }

    this.pollingActive = true;
    console.info('[Telegram] Starting background polling worker for live updates.');
    this.runPollingLoop().catch((err) => {
      console.warn('[Telegram] Polling loop stopped:', err);
      this.pollingActive = false;
    });
  }

  public static stopPolling(): void {
    this.pollingActive = false;
  }

  private static async runPollingLoop(): Promise<void> {
    while (this.pollingActive) {
      try {
        const res = await this.callTelegramApi('getUpdates', {
          offset: this.pollingOffset,
          timeout: 20,
          allowed_updates: [
            'message', 'edited_message', 'channel_post', 'edited_channel_post',
            'inline_query', 'chosen_inline_result', 'callback_query',
            'my_chat_member', 'chat_member', 'chat_join_request'
          ]
        });

        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
            try {
              await this.handleUpdate(update);
            } catch (updateErr) {
              console.error('[Telegram Polling] Error handling update:', updateErr);
            }
          }
        }
      } catch (err: any) {
        if (err.message && err.message.includes('409')) {
          console.info('[Telegram Polling] Webhook set; stopping polling loop.');
          this.pollingActive = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
}
