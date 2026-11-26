import { sanitizeButtonLabel, isValidCustomEmojiId, extractExplicitButtonEmojiFromRaw } from './customEmoji';

export type InlineButtonActionType = 'url' | 'callback';
export type InlineButtonStyle = 'primary' | 'success' | 'danger' | 'secondary';
export type InlineButtonPlacement = 'start_welcome' | 'force_sub' | 'both' | 'none';

export interface InlineButtonConfig {
  key: string;
  name: string;
  text: string;
  emoji?: string;
  customEmojiId?: string;
  actionType: InlineButtonActionType;
  url?: string;
  callbackData?: string;
  callbackResponse?: string;
  actionLocked?: boolean;
  actionDescription?: string;
  category: string;
  style?: InlineButtonStyle;
  enabled: boolean;
  isCustom?: boolean;
  deleted?: boolean;
  placement?: InlineButtonPlacement;
  defaultName?: string;
  defaultText?: string;
  defaultEmoji?: string;
  defaultCustomEmojiId?: string;
  defaultActionType?: InlineButtonActionType;
  defaultUrl?: string;
  defaultCallbackData?: string;
  defaultStyle?: InlineButtonStyle;
  updatedAt?: string;
}

export function extractCustomEmojiId(raw: unknown): string {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (/^\d{5,30}$/.test(str)) return str;
  const tagMatch = str.match(/emoji-id=["']?(\d{5,30})["']?/i);
  if (tagMatch && isValidCustomEmojiId(tagMatch[1])) {
    return tagMatch[1];
  }
  return '';
}

export function isValidInlineButtonUrl(raw: unknown): boolean {
  const str = String(raw || '').trim();
  if (!str) return false;
  if (/^(javascript|data|vbscript|file):/i.test(str)) return false;
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(str)) return true;
  if (/^tg:\/\/[^\s]+$/i.test(str)) return true;
  return false;
}

export function sanitizeInlineButtonStyle(raw: unknown, fallback: InlineButtonStyle = 'primary'): InlineButtonStyle {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'primary' || val === 'success' || val === 'danger' || val === 'secondary') {
    return val;
  }
  return fallback;
}

export function sanitizeInlineButtonPlacement(raw: unknown, fallback: InlineButtonPlacement = 'start_welcome'): InlineButtonPlacement {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'start_welcome' || val === 'force_sub' || val === 'both' || val === 'none') {
    return val;
  }
  return fallback;
}

function defBtn(
  key: string,
  name: string,
  text: string,
  emoji: string,
  actionType: InlineButtonActionType,
  actionValue: string,
  category: string,
  style: InlineButtonStyle,
  actionDescription: string
): InlineButtonConfig {
  return {
    key,
    name,
    text,
    emoji,
    customEmojiId: '',
    actionType,
    url: actionType === 'url' ? actionValue : '',
    callbackData: actionType === 'callback' ? actionValue : '',
    actionLocked: true,
    actionDescription,
    category,
    style,
    enabled: true,
    isCustom: false,
    deleted: false,
    defaultName: name,
    defaultText: text,
    defaultEmoji: emoji,
    defaultCustomEmojiId: '',
    defaultActionType: actionType,
    defaultUrl: actionType === 'url' ? actionValue : '',
    defaultCallbackData: actionType === 'callback' ? actionValue : '',
    defaultStyle: style
  };
}

export const DEFAULT_INLINE_BUTTONS: Record<string, InlineButtonConfig> = {
  // Delivery & Group
  group_get_file: defBtn(
    'group_get_file',
    'Get File Button (Group Reply)',
    'Get File Privately',
    '📁',
    'url',
    'https://t.me/{bot}?start={payload}',
    'Delivery & Group',
    'primary',
    'Opens private bot DM deep-link to deliver the requested file'
  ),
  group_get_text: defBtn(
    'group_get_text',
    'View Message Button (Group Reply)',
    'View Message Privately',
    '💬',
    'url',
    'https://t.me/{bot}?start={payload}',
    'Delivery & Group',
    'primary',
    'Opens private bot DM deep-link to display the text item'
  ),
  group_get_link: defBtn(
    'group_get_link',
    'Open Link Button (Group Reply)',
    'Open Privately',
    '🔗',
    'url',
    'https://t.me/{bot}?start={payload}',
    'Delivery & Group',
    'primary',
    'Opens private bot DM deep-link to deliver the requested link'
  ),
  delivery_open_link: defBtn(
    'delivery_open_link',
    'Open Link Button (Private DM)',
    'Open Link',
    '🌐',
    'url',
    '{item_url}',
    'Delivery & Group',
    'primary',
    'Opens the configured target URL when delivering a link in DM'
  ),
  delivery_launch_webapp: defBtn(
    'delivery_launch_webapp',
    'Launch Mini App Button (Private DM)',
    'Launch App',
    '📱',
    'url',
    '{item_url}',
    'Delivery & Group',
    'primary',
    'Launches the configured URL inside Telegram Mini App'
  ),
  admin_dm_open_bot: defBtn(
    'admin_dm_open_bot',
    'Open Bot in Private DM (Admin Notice)',
    'Open Bot in Private DM',
    '🔐',
    'url',
    'https://t.me/{bot}?start=admin',
    'Delivery & Group',
    'primary',
    'Directs admins from group chat to the bot private inbox'
  ),

  // Force Subscribe
  forcesub_join_channel: defBtn(
    'forcesub_join_channel',
    'Join Channel Button (Force Sub)',
    'Join Channel {n}',
    '📢',
    'url',
    '{channel_invite_link}',
    'Force Subscribe',
    'primary',
    'Opens the required channel invite link ({n} inserts channel number, {name} inserts channel title)'
  ),
  forcesub_join_group: defBtn(
    'forcesub_join_group',
    'Join Group Button (Force Sub)',
    'Join Group {n}',
    '👥',
    'url',
    '{group_invite_link}',
    'Force Subscribe',
    'primary',
    'Opens the required group invite link ({n} inserts group number, {name} inserts group title)'
  ),
  forcesub_verify: defBtn(
    'forcesub_verify',
    'Verify / Try Again Button (Force Sub)',
    'Verify / Try Again ✅',
    '🔄',
    'callback',
    'forcesub_verify:{payload}',
    'Force Subscribe',
    'success',
    'Re-checks user membership across all required channels/groups and resumes action'
  ),

  // Setup Video
  sv_watch_button: defBtn(
    'sv_watch_button',
    'Setup Video Menu Button',
    'Setup Video',
    '🎬',
    'callback',
    'sv_vid_{item_id}',
    'Setup Video',
    'primary',
    'Plays or sends the configured setup tutorial video for the item'
  ),
  sv_get_file_button: defBtn(
    'sv_get_file_button',
    'Setup Menu: Get File Button',
    'Get File',
    '📁',
    'callback',
    'sv_item_{item_id}',
    'Setup Video',
    'primary',
    'Delivers the item file(s) from the Setup Video menu'
  ),
  sv_open_link_button: defBtn(
    'sv_open_link_button',
    'Setup Menu: Open Link Button',
    'Open Link',
    '🔗',
    'callback',
    'sv_item_{item_id}',
    'Setup Video',
    'primary',
    'Delivers the item link from the Setup Video menu'
  ),
  sv_watch_external: defBtn(
    'sv_watch_external',
    'Watch External Video URL Button',
    'Watch Setup Video',
    '▶️',
    'url',
    '{setup_video_url}',
    'Setup Video',
    'primary',
    'Opens an external setup video URL (e.g. YouTube or MP4 link)'
  ),
  sv_back_button: defBtn(
    'sv_back_button',
    'Setup Video Back Button',
    'Back',
    '⬅️',
    'callback',
    'sv_menu_{item_id}',
    'Setup Video',
    'primary',
    'Returns to the Setup Video & Resource menu'
  ),

  // Free Fire & Key Tools
  ff_guild_info: defBtn(
    'ff_guild_info',
    'Free Fire: Guild Info Button',
    'Guild Info',
    '🛡',
    'callback',
    'guild_{uid}',
    'Free Fire & Keys',
    'primary',
    'Loads Free Fire guild details for the queried player UID'
  ),
  ff_leader_info: defBtn(
    'ff_leader_info',
    'Free Fire: Leader Info Button',
    'Leader Info',
    '👑',
    'callback',
    'leader_{guild_id}',
    'Free Fire & Keys',
    'primary',
    'Loads the guild leader profile from Guild Info view'
  ),
  ff_player_info: defBtn(
    'ff_player_info',
    'Free Fire: Player Info Button',
    'Player Info',
    '👤',
    'callback',
    'player_{uid}',
    'Free Fire & Keys',
    'primary',
    'Returns back to the Free Fire player profile view'
  ),
  key_copy_button: defBtn(
    'key_copy_button',
    'Claimed Key: Copy Key Button',
    'Copy Key',
    '📋',
    'callback',
    'copy_key:{pool_id}',
    'Free Fire & Keys',
    'primary',
    'Copies or sends the claimed license/access key cleanly'
  ),

  // Admin & Navigation
  add_file_choice: defBtn(
    'add_file_choice',
    '/add Wizard: Add File(s)',
    'Add File(s)',
    '📁',
    'callback',
    'add_choose_file',
    'Admin & Navigation',
    'primary',
    'Starts adding single or multiple files in /add wizard'
  ),
  add_link_choice: defBtn(
    'add_link_choice',
    '/add Wizard: Add Link',
    'Add Link',
    '🔗',
    'callback',
    'add_choose_link',
    'Admin & Navigation',
    'primary',
    'Starts adding a web link trigger in /add wizard'
  ),
  add_text_choice: defBtn(
    'add_text_choice',
    '/add Wizard: Add Text',
    'Add Text',
    '💬',
    'callback',
    'add_choose_text',
    'Admin & Navigation',
    'primary',
    'Starts adding a custom text trigger in /add wizard'
  ),
  add_cancel: defBtn(
    'add_cancel',
    '/add Wizard: Cancel Button',
    'Cancel',
    '❌',
    'callback',
    'cancel_add',
    'Admin & Navigation',
    'danger',
    'Aborts the current /add setup wizard'
  ),
  add_back: defBtn(
    'add_back',
    '/add Wizard: Back Button',
    'Back',
    '⬅️',
    'callback',
    'add_back',
    'Admin & Navigation',
    'primary',
    'Navigates back to the previous step in /add wizard'
  ),
  add_test_delivery: defBtn(
    'add_test_delivery',
    '/add Complete: Test Delivery Button',
    'Test Delivery',
    '🧪',
    'callback',
    'test_delivery_{item_id}',
    'Admin & Navigation',
    'primary',
    'Runs a live delivery test right after creating an item'
  ),
  fl_prev: defBtn(
    'fl_prev',
    '/allfiles: Previous Page',
    'Prev',
    '⬅️',
    'callback',
    'fl_p:{page}',
    'Admin & Navigation',
    'primary',
    'Navigates to the previous page in /allfiles list'
  ),
  fl_next: defBtn(
    'fl_next',
    '/allfiles: Next Page',
    'Next',
    '➡️',
    'callback',
    'fl_p:{page}',
    'Admin & Navigation',
    'primary',
    'Navigates to the next page in /allfiles list'
  ),
  fl_refresh: defBtn(
    'fl_refresh',
    '/allfiles: Refresh List',
    'Refresh',
    '🔄',
    'callback',
    'fl_p:{page}',
    'Admin & Navigation',
    'primary',
    'Refreshes the /allfiles list page'
  ),
  fl_close: defBtn(
    'fl_close',
    '/allfiles: Close List',
    'Close',
    '✖️',
    'callback',
    'fl_close',
    'Admin & Navigation',
    'danger',
    'Closes the /allfiles inline panel'
  ),
  fl_copy_link: defBtn(
    'fl_copy_link',
    'File Detail: Copy Link',
    'Copy Link',
    '🔗',
    'callback',
    'fl_copy:{item_id}',
    'Admin & Navigation',
    'success',
    'Copies or sends the direct deep-link for the selected item'
  ),
  fl_open_link: defBtn(
    'fl_open_link',
    'File Detail: Open Link',
    'Open Link',
    '↗️',
    'url',
    '{deep_link}',
    'Admin & Navigation',
    'success',
    'Opens the item deep-link directly'
  ),
  fl_back_list: defBtn(
    'fl_back_list',
    'File Detail: Back to List',
    'Back to File List',
    '⬅️',
    'callback',
    'fl_p:{page}',
    'Admin & Navigation',
    'primary',
    'Returns to the /allfiles list page'
  ),

  // Moderation & Clone
  mod_temp: defBtn(
    'mod_temp',
    'Moderation: Custom Temp Duration',
    'Temp',
    '⏱',
    'callback',
    'modt:{token}',
    'Moderation & Clone',
    'primary',
    'Opens the interactive keypad for custom ban/mute duration'
  ),
  mod_perm: defBtn(
    'mod_perm',
    'Moderation: Permanent Action',
    'Permanent',
    '♾️',
    'callback',
    'moda:{token}:perm',
    'Moderation & Clone',
    'danger',
    'Applies a permanent ban or mute duration'
  ),
  mod_cancel: defBtn(
    'mod_cancel',
    'Moderation: Cancel Action',
    'Cancel',
    '❌',
    'callback',
    'modc:{token}',
    'Moderation & Clone',
    'danger',
    'Cancels the pending moderation action'
  ),
  mod_confirm_reason: defBtn(
    'mod_confirm_reason',
    'Moderation: Confirm Reason',
    'Confirm Reason',
    '✅',
    'callback',
    'modr:{token}',
    'Moderation & Clone',
    'success',
    'Confirms moderation reason and executes ban/mute'
  ),
  report_ban_user: defBtn(
    'report_ban_user',
    'Report Alert: Ban User',
    'Ban User',
    '🚫',
    'callback',
    'admin_ban_user:{uid}:{report_id}',
    'Moderation & Clone',
    'danger',
    'Bans the reported user from the admin report alert'
  ),
  report_dismiss: defBtn(
    'report_dismiss',
    'Report Alert: Dismiss',
    'Dismiss',
    '❎',
    'callback',
    'admin_dismiss_report:{report_id}',
    'Moderation & Clone',
    'primary',
    'Dismisses the report from the admin report alert'
  ),
  clone_assign_self: defBtn(
    'clone_assign_self',
    '/clone Wizard: Assign Myself',
    'Assign Myself',
    '👤',
    'callback',
    'clone_admin_self:{uid}',
    'Moderation & Clone',
    'primary',
    'Assigns the current admin as owner of the cloned file bot'
  ),
  clone_cancel: defBtn(
    'clone_cancel',
    '/clone Wizard: Cancel',
    'Cancel',
    '❌',
    'callback',
    'clone_cancel:{uid}',
    'Moderation & Clone',
    'danger',
    'Cancels the /clone file bot setup wizard'
  ),
  more_back: defBtn(
    'more_back',
    '/more Menu: Back Button',
    'Back',
    '⬅️',
    'callback',
    'more:v:{target}',
    'Moderation & Clone',
    'primary',
    'Navigates back in the /more Telegram admin menu'
  ),
  more_close: defBtn(
    'more_close',
    '/more Menu: Close Button',
    'Close',
    '✖️',
    'callback',
    'more:close',
    'Moderation & Clone',
    'danger',
    'Closes the /more Telegram admin menu'
  )
};

export function cloneDefaultInlineButtons(): Record<string, InlineButtonConfig> {
  const out: Record<string, InlineButtonConfig> = {};
  for (const [k, v] of Object.entries(DEFAULT_INLINE_BUTTONS)) {
    out[k] = { ...v };
  }
  return out;
}

export function sanitizeInlineButtonRecord(
  raw: any,
  fallbackKey?: string
): InlineButtonConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || fallbackKey || '').trim();
  if (!key) return null;

  const def = DEFAULT_INLINE_BUTTONS[key];
  const isCustom = def ? false : Boolean(raw.isCustom ?? true);

  const name = String(raw.name || def?.name || key).trim().slice(0, 80) || key;
  const rawInputText = typeof raw.text === 'string' ? raw.text : (def?.text || name);
  const explicitFromText = extractExplicitButtonEmojiFromRaw(rawInputText);
  const rawText = explicitFromText ? explicitFromText.strippedText : sanitizeButtonLabel(rawInputText);
  const text = rawText.slice(0, 100) || def?.text || name;
  const emoji = raw.emoji !== undefined
    ? String(raw.emoji).trim().slice(0, 16)
    : (explicitFromText ? '' : (def?.emoji || '').trim().slice(0, 16));
  const customEmojiId = explicitFromText
    ? explicitFromText.customEmojiId
    : extractCustomEmojiId(raw.customEmojiId !== undefined ? raw.customEmojiId : def?.customEmojiId);

  const actionType: InlineButtonActionType = def
    ? def.actionType
    : (raw.actionType === 'callback' ? 'callback' : 'url');

  const url = def
    ? (def.url || '')
    : (actionType === 'url' ? String(raw.url || '').trim().slice(0, 500) : '');

  const callbackData = def
    ? (def.callbackData || '')
    : (actionType === 'callback' ? String(raw.callbackData || '').trim().slice(0, 64) : '');

  const callbackResponse = !def && actionType === 'callback'
    ? String(raw.callbackResponse || '').trim().slice(0, 190)
    : undefined;

  const style = sanitizeInlineButtonStyle(raw.style, def?.style || 'primary');
  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
  const deleted = def ? Boolean(raw.deleted) : false;
  const placement = def
    ? undefined
    : sanitizeInlineButtonPlacement(raw.placement, 'start_welcome');

  return {
    key,
    name,
    text,
    emoji,
    customEmojiId,
    actionType,
    url,
    callbackData,
    ...(callbackResponse !== undefined ? { callbackResponse } : {}),
    actionLocked: def ? true : false,
    actionDescription: def?.actionDescription || String(raw.actionDescription || '').trim().slice(0, 160),
    category: def ? def.category : (String(raw.category || 'Custom Buttons').trim().slice(0, 48) || 'Custom Buttons'),
    style,
    enabled: deleted ? false : enabled,
    isCustom,
    deleted,
    ...(placement ? { placement } : {}),
    ...(def
      ? {
          defaultName: def.defaultName,
          defaultText: def.defaultText,
          defaultEmoji: def.defaultEmoji,
          defaultCustomEmojiId: def.defaultCustomEmojiId,
          defaultActionType: def.defaultActionType,
          defaultUrl: def.defaultUrl,
          defaultCallbackData: def.defaultCallbackData,
          defaultStyle: def.defaultStyle
        }
      : {}),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
  };
}

export function hasLeadingOrTrailingEmoji(raw: string): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  const leadingRe =
    /^(?:[\u2600-\u27BF]|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E|\u200D(?:[\u2600-\u27BF]|\p{Extended_Pictographic}))*/u;
  const trailingRe =
    /(?:[\u2600-\u27BF]|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E|\u200D(?:[\u2600-\u27BF]|\p{Extended_Pictographic}))*$/u;
  return leadingRe.test(trimmed) || trailingRe.test(trimmed);
}

export function composeTelegramInlineButton(
  cfg: InlineButtonConfig | null | undefined,
  runtime: {
    url?: string;
    callback_data?: string;
    web_app?: { url: string };
    copy_text?: { text: string };
    textOverride?: string;
    styleOverride?: InlineButtonStyle;
    dynamicVars?: Record<string, string>;
    forceInclude?: boolean;
  } = {}
): Record<string, any> | null {
  if (!cfg) return null;
  if (!runtime.forceInclude && (cfg.deleted || cfg.enabled === false)) {
    return null;
  }

  let baseText = (runtime.textOverride !== undefined ? runtime.textOverride : (cfg.text || cfg.defaultText || cfg.name || 'Button')).trim();
  if (runtime.dynamicVars) {
    for (const [k, v] of Object.entries(runtime.dynamicVars)) {
      baseText = baseText.replace(new RegExp(`\\{${k}\\}`, 'gi'), v);
    }
  }

  const explicitFromRaw = extractExplicitButtonEmojiFromRaw(baseText);
  const cfgCleanText = sanitizeButtonLabel(cfg.text || '');
  const sanitizedBase = explicitFromRaw
    ? (explicitFromRaw.strippedText || cfgCleanText || cfg.defaultText || cfg.name || 'Button')
    : (sanitizeButtonLabel(baseText) || cfg.defaultText || cfg.name || 'Button');

  const isOverriddenWithOwnEmoji = Boolean(
    !explicitFromRaw &&
    runtime.textOverride !== undefined &&
    sanitizedBase !== cfgCleanText &&
    hasLeadingOrTrailingEmoji(sanitizedBase)
  );

  const emoji = (cfg.emoji || '').trim();
  const customEmojiId = explicitFromRaw
    ? explicitFromRaw.customEmojiId
    : (isOverriddenWithOwnEmoji ? '' : extractCustomEmojiId(cfg.customEmojiId));
  const hasValidCustomEmoji = isValidCustomEmojiId(customEmojiId);

  let finalText = sanitizedBase;
  if (
    !explicitFromRaw &&
    !isOverriddenWithOwnEmoji &&
    !hasValidCustomEmoji &&
    emoji &&
    !finalText.startsWith(emoji) &&
    !finalText.endsWith(emoji) &&
    !hasLeadingOrTrailingEmoji(finalText)
  ) {
    finalText = `${emoji} ${finalText}`.trim();
  }
  finalText = sanitizeButtonLabel(finalText) || sanitizedBase;

  const effectiveStyle = runtime.styleOverride || cfg.style || cfg.defaultStyle;
  const btn: Record<string, any> = {
    text: finalText,
    ...(effectiveStyle ? { style: effectiveStyle } : {})
  };

  if (hasValidCustomEmoji) {
    btn.icon_custom_emoji_id = customEmojiId;
  }

  if (runtime.copy_text) {
    btn.copy_text = runtime.copy_text;
  } else if (runtime.web_app) {
    btn.web_app = runtime.web_app;
  } else if (runtime.url) {
    btn.url = runtime.url;
  } else if (runtime.callback_data) {
    btn.callback_data = runtime.callback_data;
  } else if (cfg.actionType === 'url' && cfg.url && isValidInlineButtonUrl(cfg.url)) {
    btn.url = cfg.url;
  } else if (cfg.actionType === 'callback' && cfg.callbackData) {
    btn.callback_data = cfg.callbackData;
  } else {
    return null;
  }

  return btn;
}
