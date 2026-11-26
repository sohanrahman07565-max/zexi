import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import dotenv from 'dotenv';
import { hashPassword, verifyPassword } from './auth';

try {
  dotenv.config({ override: true });
} catch {}

export type TriggerType = 'hashtag' | 'slash' | 'normal';
export type OpenMode = 'browser' | 'webapp';
export type AdminRole = 'owner' | 'subadmin';

export interface AdminPermissions {
  files_view: boolean;
  files_add: boolean;
  files_edit: boolean;
  files_delete: boolean;
  links_view: boolean;
  links_add: boolean;
  links_edit: boolean;
  links_delete: boolean;
  messages_view: boolean;
  messages_edit: boolean;
  admins_manage: boolean;
  design_edit: boolean;
  settings_edit: boolean;
  cleanup_manage: boolean;
}

export interface AdminUser {
  id: string; // Telegram user id
  telegramId: string;
  name: string;
  username?: string;
  photoUrl?: string;
  role: AdminRole;
  passwordHash: string;
  permissions: AdminPermissions;
  enabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface ItemFileEntry {
  id?: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  uploadedFileId?: string;
  fileBase64?: string;
  fileType?: 'document' | 'photo' | 'video' | 'audio';
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
}

export interface ItemRecord {
  id: string;
  type: 'file' | 'link';
  name: string;
  triggers: string[];
  triggerType: TriggerType;
  rawKeyword: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  uploadedFileId?: string;
  fileBase64?: string;
  fileType?: 'document' | 'photo' | 'video' | 'audio';
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  files?: ItemFileEntry[];
  caption?: string;
  url?: string;
  openMode?: OpenMode;
  buttonText?: string;
  replyMessage?: string;
  isTextOnly?: boolean;
  fileEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'disabled';
  maintenance?: boolean;
  deliveryCount: number;
  inFiltersList?: boolean;
  retentionType?: 'permanent' | 'temporary';
  retentionDays?: number;
  expiresAt?: string;
  hasSetupVideo?: boolean;
  setupVideoUrl?: string;
  setupVideoTelegramFileId?: string;
  setupVideoType?: 'url' | 'upload';
  setupVideoFileName?: string;
  setupVideoButtonText?: string;
  setupResourceButtonText?: string;
  setupVideoMessage?: string;
}

export interface UploadedFileRecord {
  id: string;
  fileName: string;
  fileType: 'document' | 'photo' | 'video' | 'audio';
  mimeType: string;
  size: number;
  buffer: Buffer;
  createdAt: string;
}

export interface TemplateButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface MessageTemplate {
  key: string;
  name: string;
  description: string;
  content: string;
  variables: string[];
  mediaType?: 'none' | 'photo' | 'video';
  mediaUrl?: string;
  buttons?: TemplateButton[];
}

export interface DesignConfig {
  primaryColor: string;
  accentColor: string;
  backgroundStyle: 'cyber-grid' | 'light-rain' | 'particles' | 'digital-space' | 'neon-waves' | 'floating-orbs' | 'aurora' | 'cyber-lines';
  animationSpeed: number;
  animationOpacity: number;
  animationDensity: number;
  animationEnabled: boolean;
  cardStyle: 'glass' | 'solid' | 'bordered';
  borderRadius: 'small' | 'medium' | 'rounded' | 'full';
  loginTitle: string;
  loginSubtitle: string;
  loginLogoUrl: string;
  loginLogoSymbol?: string;
  loginIdLabel: string;
  loginIdPlaceholder?: string;
  loginPassLabel: string;
  loginPassPlaceholder?: string;
  loginButtonText: string;
  loginAccentColor?: string;
  buttonAnimationStyle?: 'orbit' | 'neon' | 'cyber' | 'typing' | 'ripple';
}

export interface TrackedMessage {
  messageId: number;
  timestamp: number;
}

export interface ForceSubChannel {
  id: string;
  name: string;
  chatId: string;
  inviteLink: string;
  requestInviteLink?: string;
  enabled?: boolean;
  isAutoDetected?: boolean;
  type?: 'channel' | 'supergroup' | 'group';
  username?: string;
  isAdmin?: boolean;
  detectedAt?: string;
}

export interface AllowedChatEntry {
  id: string;
  title?: string;
  type?: 'group' | 'supergroup' | 'channel' | 'private';
  addedAt: string;
  addedBy?: string;
}

export type BotOperationalMode = 'file_bot' | 'post_bot' | 'image_url_bot';

export interface ImageUrlBotLinkRecord {
  id: number;
  imageId: string;
  url: string;
  ownerTelegramId: number;
  caption: string | null;
  category: string;
  expiresAt: string | null;
  fileSize: number | null;
  createdAt: string;
  isDeleted: boolean;
}

export interface ImageUrlBotStoreData {
  nextLinkId: number;
  adminTelegramId?: string;
  adminUsername?: string;
  users: Record<string, {
    telegramId: number;
    username: string | null;
    firstName: string | null;
    joinedAt: string;
    lastActiveAt: string;
  }>;
  links: ImageUrlBotLinkRecord[];
  userSettings: Record<string, {
    defaultExpiry: string;
    notifyExpiry: boolean;
  }>;
  sessions: Record<string, {
    activeMessageId: number | null;
    state: string;
    tempData: Record<string, any>;
  }>;
}

export interface ModerationDurationPreset {
  label: string;
  value: string;
}

export interface BotSettings {
  botToken: string;
  botUsername: string;
  rootAdminId: string;
  botMode?: BotOperationalMode;
  postBotChannelId?: string;
  maxBotMessagesPerChat: number;
  dailyCleanupEnabled: boolean;
  cleanupAgeHours: number;
  autoDeleteDeliveryEnabled: boolean;
  deliveryTimeoutMinutes: number;
  autoDeleteNoticeEnabled: boolean;
  maintenanceMode?: boolean;
  maintenanceNotice?: string;
  forceSubEnabled?: boolean;
  forceJoinMode?: 'auto_join' | 'request_only';
  requiredChannels?: ForceSubChannel[];
  autoApproveJoinRequests?: boolean;
  antiForwardEnabled?: boolean;
  linkDeleteEnabled?: boolean;
  banEnabled?: boolean;
  muteEnabled?: boolean;
  cleanServiceEnabled?: boolean;
  welcomeMessageEnabled?: boolean;
  welcomeAutoDeleteEnabled?: boolean;
  welcomeAutoDeleteSeconds?: number;
  moderationDurations?: ModerationDurationPreset[];
  groupWarningLimit?: number;
  chatWhitelistEnabled?: boolean;
  allowedChats?: AllowedChatEntry[];
  guestLikesEnabled?: boolean;
  botStopped?: boolean;
}

export interface JoinRequestRecord {
  id: string; // `${chatId}_${userId}`
  chatId: string;
  chatUsername?: string;
  chatTitle?: string;
  userId: string;
  userName?: string;
  userUsername?: string;
  status: 'approved' | 'pending' | 'rejected';
  inviteLink?: string;
  createdAt: string;
  approvedAt?: string;
}

export interface ScheduledDeletion {
  id: string;
  chatId: string;
  messageId: number;
  companionNoticeId?: number;
  deleteAt: number; // timestamp in ms
  timeoutMinutes: number;
  itemTitle: string;
  createdAt: string;
}

export interface SessionRecord {
  token: string;
  adminId: string;
  role: AdminRole;
  botId?: string;
  expiresAt: number; // 12 hours from creation
}

export interface BotUserRecord {
  id: string; // telegram user id
  username?: string;
  firstName?: string;
  lastName?: string;
  firstSeenAt: string;
  lastActiveAt: string;
  isOnline?: boolean;
  interactionCount: number;
  isBanned?: boolean;
  bannedAt?: string;
  banUntil?: string;
  banChatId?: string;
  banReason?: string;
  isMuted?: boolean;
  mutedAt?: string;
  muteUntil?: string;
  muteChatId?: string;
  muteReason?: string;
  isAdmin?: boolean;
}

export interface GroupMemberModerationState {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  lastSeenAt: string;
  isBanned?: boolean;
  bannedAt?: string;
  banUntil?: string;
  banReason?: string;
  unbannedAt?: string;
  isMuted?: boolean;
  mutedAt?: string;
  muteUntil?: string;
  muteReason?: string;
}

export interface AdminReportMessageRef {
  chatId: string;
  messageId: number;
}

export interface UserReportRecord {
  id: string;
  reporterId: string;
  reporterName: string;
  reporterUsername?: string;
  reportedUserId: string;
  reportedUserName: string;
  reportedUserUsername?: string;
  chatId: string;
  chatTitle?: string;
  reason: string;
  originalMessageText?: string;
  reportedContent?: string;
  originalMessageId?: number;
  messageId?: number;
  adminReportMessageText?: string;
  adminMessages?: AdminReportMessageRef[];
  resolutionOutcome?: 'banned' | 'dismissed' | 'resolved';
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface FraudKeywordRule {
  id: string;
  keyword: string;
  matchType: 'contains' | 'exact' | 'regex';
  action: 'warn' | 'delete' | 'delete_and_warn' | 'mute' | 'ban' | 'reply_only';
  duration?: string; // Supports custom minutes/hours/days e.g. "30m", "2h", "1d" or "permanent"
  maxWarnings?: number; // e.g. 1 to 10 (default: 3)
  customMessage?: string;
  warningText?: string;
  mediaType?: 'none' | 'photo' | 'video' | 'voice' | 'audio' | 'text';
  mediaUrl?: string; // URL or Telegram file_id
  enabled: boolean;
  createdAt: string;
}

export interface BackupServerConfig {
  enabled: boolean;
  serverUrl: string;
  secretKey: string;
  role: 'primary' | 'backup';
  autoSyncOnSave: boolean;
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed' | 'idle' | 'in_progress';
  lastSyncMessage?: string;
  mirroredStats?: {
    itemsCount: number;
    usersCount: number;
    filesCount: number;
    reportsCount: number;
    rulesCount: number;
    templatesCount: number;
    lastSyncedAt: string;
  };
  failoverActive?: boolean;
}

export const DEFAULT_BACKUP_SERVER_CONFIG: BackupServerConfig = {
  enabled: false,
  serverUrl: '',
  secretKey: 'bsk_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
  role: 'primary',
  autoSyncOnSave: true,
  syncIntervalMinutes: 5,
  lastSyncStatus: 'idle',
  lastSyncMessage: 'No synchronization performed yet'
};

export interface ClonedBotRecord {
  id: string; // telegram bot id (numeric string or clone_<id>)
  token: string;
  name: string;
  username: string;
  status: 'active' | 'paused' | 'stopped';
  botMode?: BotOperationalMode;
  createdAt: string;
  createdBy?: string;
  ownerId?: string;
  ownerUsername?: string;
  filesCount?: number;
  usersCount?: number;
  adminUsername?: string;
  adminPassword?: string;
  panelUrl?: string;
}

export type KeyPoolMode = 'pool' | 'generator' | 'shared';
export type KeyGeneratorCharType = 'numbers' | 'letters_upper' | 'letters_mixed' | 'alphanumeric';

export interface KeyGeneratorConfig {
  prefix: string;
  length: number;
  charType: KeyGeneratorCharType;
}

export interface KeyPoolEntry {
  id: string;
  value: string;
  index: number;
  claimedBy?: string;
  claimedByUsername?: string;
  claimedAt?: string;
}

export interface KeyPoolRecord {
  id: string;
  mode?: KeyPoolMode;
  generatorConfig?: KeyGeneratorConfig | null;
  sharedText?: string;
  title: string;
  keys: KeyPoolEntry[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  expiresAt?: string | null;
  status: 'active' | 'disabled';
  totalClaims: number;
}

export interface FreeFireGuestAccountRecord {
  id: string;
  guestUid: string;
  guestPassword: string;
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastStatus?: 'ok' | 'auth_failed' | 'like_failed';
  lastMessage?: string;
}

export interface PendingModerationActionRecord {
  token: string;
  chatId: string | number;
  action: 'ban' | 'mute';
  targetId: string;
  targetName: string;
  targetUsername: string;
  reason?: string;
  adminId: string;
  stage: 'select_duration' | 'custom_keypad' | 'awaiting_reason' | 'confirm_reason';
  keypadDigits: string;
  keypadUnit: 'm' | 'h' | 'd';
  durationToken?: string;
  durationLabel?: string;
  isPermanent?: boolean;
  replyToMessageId?: number;
  promptMessageId?: number;
  createdAt: number;
}

export interface AppDatabase {
  items: ItemRecord[];
  templates: Record<string, MessageTemplate>;
  admins: AdminUser[];
  sessions: SessionRecord[];
  trackedMessages: Record<string, TrackedMessage[]>;
  scheduledDeletions?: ScheduledDeletion[];
  chatDeliveryMessages?: Record<string, number[]>;
  design: DesignConfig;
  settings: BotSettings;
  backupServer?: BackupServerConfig;
  clonedBots?: ClonedBotRecord[];
  addSessions?: Record<string, any>;
  pendingModerationActions?: Record<string, PendingModerationActionRecord>;
  botUsers?: Record<string, BotUserRecord>;
  groupModeration?: Record<string, Record<string, GroupMemberModerationState>>;
  reports?: UserReportRecord[];
  fraudRules?: FraudKeywordRule[];
  linkWarnings?: Record<string, number>;
  fraudWarnings?: Record<string, number>;
  detectedChannels?: ForceSubChannel[];
  joinRequests?: Record<string, JoinRequestRecord>;
  postBotPublishedPosts?: Record<string, any>;
  imageUrlBotData?: ImageUrlBotStoreData;
  keyPools?: KeyPoolRecord[];
  guestAccounts?: FreeFireGuestAccountRecord[];
  hourlyDeliveries?: Record<string, number>;
  uploadedFilesIndex?: Record<string, {
    id: string;
    fileName: string;
    fileType: 'document' | 'photo' | 'video' | 'audio';
    mimeType: string;
    size: number;
    base64?: string;
    createdAt: string;
  }>;
}

export const DEFAULT_TEMPLATES: Record<string, MessageTemplate> = {
  START_MESSAGE: {
    key: 'START_MESSAGE',
    name: 'Start / Welcome Message',
    description: 'Welcome message sent to users when they send /start to the bot in private chat with optional Photo or Video attachment',
    content: "👋 <b>Welcome, <code>{user_name}</code>!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> <code>{bot_name}</code>\n\n✨ <i>Send any configured trigger hashtag in your group or here to receive your files privately.</i>",
    variables: ['user_name', 'user_id', 'bot_name'],
    mediaType: 'none',
    mediaUrl: ''
  },
  GROUP_WELCOME_MESSAGE: {
    key: 'GROUP_WELCOME_MESSAGE',
    name: 'Welcome Message',
    description: 'Automatic welcome message sent in groups when a new member joins (or configured via /setwelcome)',
    content: "👋 <b>Welcome to the group, {first_name}!</b>\n\n👤 <b>Username:</b> {username}\n🆔 <b>User ID:</b> <code>{user_id}</code>",
    variables: ['username', 'first_name', 'first', 'last_name', 'last', 'user_id', 'id'],
    mediaType: 'none',
    mediaUrl: ''
  },
  GROUP_INFO_MESSAGE: {
    key: 'GROUP_INFO_MESSAGE',
    name: 'Group Info',
    description: 'Group details message sent when /info is used in a group',
    content: "ℹ️ <b>Group Information</b>\n\n🏷️ <b>Group Name:</b> {group_name}\n🆔 <b>Chat ID:</b> <code>{chat_id}</code>\n👥 <b>Members:</b> <code>{member_count}</code>\n\n🛡️ <b>Group Admins ({admin_count}):</b>\n{admins_list}",
    variables: ['chat_id', 'group_name', 'member_count', 'admins_list', 'admin_count']
  },
  DELIVERY_STATUS_MESSAGE: {
    key: 'DELIVERY_STATUS_MESSAGE',
    name: 'Delivery Progress Status Message',
    description: 'Temporary status message displayed while delivering a file or link; automatically deleted after delivery completes',
    content: '⏳ <b>Preparing Delivery...</b>\n<i>Fetching your requested file, please wait a moment.</i>',
    variables: ['user_name', 'name', 'type']
  },
  FILTERS_MESSAGE: {
    key: 'FILTERS_MESSAGE',
    name: 'Quick File Keywords (/filters)',
    description: 'Message sent when users or admins send /filters, /filter or #filters to view all one-tap copyable file triggers',
    content: "📁 <b>Quick File Keywords</b>\n<i>Tap any trigger below to copy and send it to receive the file privately:</i>\n\n{keywords}",
    variables: ['keywords', 'bot_name']
  },
  GROUP_FILE_REPLY: {
    key: 'GROUP_FILE_REPLY',
    name: 'Group File Reply',
    description: 'Message sent in the group replying to the user requesting a file',
    content: "📦 <b>File Ready for Delivery</b>\n<i>Tap the button below to receive your file in private DM.</i>",
    variables: ['user_name', 'user_id', 'trigger', 'file_name']
  },
  GROUP_LINK_REPLY: {
    key: 'GROUP_LINK_REPLY',
    name: 'Group Link Reply',
    description: 'Message sent in the group replying to the user requesting a link',
    content: "🔗 <b>Link Ready for Delivery</b>\n<i>Tap the button below to open your link in private DM.</i>",
    variables: ['user_name', 'user_id', 'trigger', 'title']
  },
  GET_FILE_BUTTON: {
    key: 'GET_FILE_BUTTON',
    name: 'Get File Button Text',
    description: 'Text of the inline deep-link button in the group for files',
    content: 'Get File Privately',
    variables: []
  },
  GET_LINK_BUTTON: {
    key: 'GET_LINK_BUTTON',
    name: 'Get Link Button Text',
    description: 'Text of the inline deep-link button in the group for links',
    content: 'Open Privately',
    variables: []
  },
  ADMIN_ADD_PROMPT: {
    key: 'ADMIN_ADD_PROMPT',
    name: 'Admin Add Prompt',
    description: 'Message displayed when admin types /add in Telegram',
    content: '📥 <b>Add File</b>\n\n<b>Step 1:</b> Please send the file you want to add:\n• Any document (<code>APK</code>, <code>ZIP</code>, <code>PDF</code>, etc.)\n• Photo · Video · Audio\n\n<i>Send <code>/cancel</code> anytime to abort.</i>',
    variables: []
  },
  ADMIN_SAVE_SUCCESS: {
    key: 'ADMIN_SAVE_SUCCESS',
    name: 'Admin Save Success',
    description: 'Message sent when content is saved successfully',
    content: '✅ <b>Saved Successfully!</b>\n• <b>Trigger:</b> <code>{trigger}</code>',
    variables: ['trigger', 'type', 'name']
  },
  PASSWORD_UPDATED: {
    key: 'PASSWORD_UPDATED',
    name: 'Password Updated',
    description: 'Message sent when password has been successfully updated',
    content: '✅ <b>Password Updated</b>\n<i>Your Admin Panel password has been changed. You can now log in securely.</i>',
    variables: []
  },
  CANCEL_MESSAGE: {
    key: 'CANCEL_MESSAGE',
    name: 'Operation Cancelled',
    description: 'Message sent when current interactive action is cancelled',
    content: '❌ <b>Operation Cancelled</b>\n<i>Current action has been aborted.</i>',
    variables: []
  },
  FILE_AUTO_DELETE_NOTICE: {
    key: 'FILE_AUTO_DELETE_NOTICE',
    name: 'File Auto-Delete Notice',
    description: 'Notice message notifying users that delivered file is temporary and will auto-destruct',
    content: '⏳ <b>Auto-Delete Notice</b>\n<i>This file will automatically disappear in <code>{timeout}</code> minutes. Please save or forward it now!</i>',
    variables: ['timeout', 'name']
  },
  ANTI_LINK_WARNING: {
    key: 'ANTI_LINK_WARNING',
    name: 'Anti-Link Group Warning',
    description: 'Warning message sent when a non-admin user posts an unauthorized link in group chat',
    content: '⚠️ <b>First Warning</b>\n<i>Links are not allowed in this group. Sharing another link will result in a ban.</i>',
    variables: ['user_name', 'user_id']
  },
  BAN_NOTICE: {
    key: 'BAN_NOTICE',
    name: 'User Ban Notice',
    description: 'Notification sent when a user reaches 3 strikes (link/forward spam or fraud words) and is automatically banned',
    content: '🚫 <b>USER AUTO-BANNED (Strike <code>{strikes}/{strikes}</code>)</b>\n\n👤 <b>User:</b> <code>{name}</code> (@{username} | <b>ID:</b> <code>{user_id}</code>)\n⚠️ <b>Reason:</b> Exceeded maximum <code>{strikes}</code>-strike warnings for unauthorized links / external forward spam.',
    variables: ['name', 'username', 'user_id', 'strikes']
  },
  FRAUD_KEYWORD_DEFAULT_REPLY: {
    key: 'FRAUD_KEYWORD_DEFAULT_REPLY',
    name: 'Restricted Word Auto-Reply / Warning',
    description: 'Auto-reply or warning sent when a user triggers a restricted keyword',
    content: '⚠️ <b>Warning <code>{user_name}</code> (<code>{warning_count}/{max_warnings}</code>):</b>\nProhibited content detected (<code>{keyword}</code>). <i>Continuing will result in a restriction from this chat.</i>',
    variables: ['user_name', 'user_id', 'keyword', 'warning_count', 'max_warnings', 'action']
  },
  FORCESUB_PROMPT: {
    key: 'FORCESUB_PROMPT',
    name: 'Force Sub / Mandatory Join Prompt',
    description: 'Main text displayed on the verification screen when a user has not joined all mandatory channels/groups',
    content: "🔒 <b>Channel Membership Required</b>\n\nTo use <code>{bot_name}</code> and access your requested content, please join our official channel(s) below:\n\n{channel_list}\n\n👇 <i>Tap the channel buttons below to join, then press <b>Verify / Try Again</b>.</i>",
    variables: ['channel_list', 'user_name', 'user_id', 'bot_name']
  }
};

export const DEFAULT_PERMISSIONS: AdminPermissions = {
  files_view: true,
  files_add: true,
  files_edit: true,
  files_delete: true,
  links_view: true,
  links_add: true,
  links_edit: true,
  links_delete: true,
  messages_view: true,
  messages_edit: true,
  admins_manage: true,
  design_edit: true,
  settings_edit: true,
  cleanup_manage: true,
};

export const DEFAULT_DESIGN: DesignConfig = {
  primaryColor: '#ef4444',
  accentColor: '#dc2626',
  backgroundStyle: 'cyber-grid',
  animationSpeed: 1.0,
  animationOpacity: 0.6,
  animationDensity: 50,
  animationEnabled: true,
  cardStyle: 'glass',
  borderRadius: 'rounded',
  loginTitle: 'ADMIN PANEL',
  loginSubtitle: 'SECURE ACCESS',
  loginLogoUrl: 'https://host.tscv.workers.dev/img/27e97803c2bf4c39',
  loginLogoSymbol: '惡',
  loginIdLabel: 'ADMIN NAME',
  loginIdPlaceholder: 'Enter admin name',
  loginPassLabel: 'PASSWORD',
  loginPassPlaceholder: 'Enter password',
  loginButtonText: 'SIGN IN',
  loginAccentColor: '#ef4444',
  buttonAnimationStyle: 'orbit'
};

export const DEFAULT_MODERATION_DURATIONS: ModerationDurationPreset[] = [
  { label: '1 Day', value: '1d' },
  { label: '5 Days', value: '5d' }
];

export function sanitizeModerationDurations(raw: any): ModerationDurationPreset[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_MODERATION_DURATIONS.map((d) => ({ ...d }));
  }
  const seen = new Set<string>();
  const result: ModerationDurationPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rawVal = String(item.value || '').trim().toLowerCase().replace(/\s+/g, '');
    const m = rawVal.match(/^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/);
    if (!m) continue;
    const num = parseFloat(m[1]);
    if (!Number.isFinite(num) || num <= 0) continue;
    const u = m[2];
    const shortUnit = u.startsWith('w') ? 'w' : u.startsWith('d') ? 'd' : u.startsWith('h') ? 'h' : u.startsWith('s') ? 's' : 'm';
    const compactVal = `${num}${shortUnit}`;
    if (seen.has(compactVal)) continue;
    seen.add(compactVal);
    const unitWord =
      shortUnit === 'w' ? (num === 1 ? 'Week' : 'Weeks') :
      shortUnit === 'd' ? (num === 1 ? 'Day' : 'Days') :
      shortUnit === 'h' ? (num === 1 ? 'Hour' : 'Hours') :
      shortUnit === 's' ? (num === 1 ? 'Second' : 'Seconds') :
      (num === 1 ? 'Minute' : 'Minutes');
    const cleanLabel = String(item.label || '').trim().slice(0, 28) || `${num} ${unitWord}`;
    result.push({ label: cleanLabel, value: compactVal });
    if (result.length >= 12) break;
  }
  return result;
}

export const DEFAULT_SETTINGS: BotSettings = {
  botToken: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: '',
  rootAdminId: process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '',
  botMode: 'file_bot',
  postBotChannelId: '',
  maxBotMessagesPerChat: 10,
  dailyCleanupEnabled: true,
  cleanupAgeHours: 24,
  autoDeleteDeliveryEnabled: true,
  deliveryTimeoutMinutes: 10,
  autoDeleteNoticeEnabled: false,
  maintenanceMode: false,
  forceSubEnabled: false,
  forceJoinMode: 'auto_join',
  autoApproveJoinRequests: true,
  antiForwardEnabled: false,
  linkDeleteEnabled: false,
  banEnabled: true,
  muteEnabled: true,
  cleanServiceEnabled: false,
  welcomeMessageEnabled: true,
  welcomeAutoDeleteEnabled: false,
  welcomeAutoDeleteSeconds: 60,
  moderationDurations: DEFAULT_MODERATION_DURATIONS.map((d) => ({ ...d })),
  groupWarningLimit: 3,
  requiredChannels: [],
  chatWhitelistEnabled: false,
  allowedChats: [],
  guestLikesEnabled: true,
  botStopped: false
};

// Local VPS persistence & file storage helpers (DATA_DIR, DATA_FILE_PATH, STORAGE_DIR)
export function resolveVpsDataDir(): string {
  const custom = (process.env.DATA_DIR || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'data');
}

export function resolveVpsStorageDir(): string {
  const custom = (process.env.STORAGE_DIR || '').trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'storage', 'files');
}

function sanitizeBotStorageId(botId: string = 'main'): string {
  const clean = String(botId || 'main').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || 'main';
}

function safeResolveInsideDir(baseDir: string, entryName: string): string | null {
  const clean = String(entryName || '').trim();
  if (!clean || clean.includes('..') || clean.includes('/') || clean.includes('\\') || !/^[a-zA-Z0-9._-]+$/.test(clean)) {
    return null;
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, clean);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

function getPrimaryDataFilePath(botId: string = 'main'): string {
  const safeId = sanitizeBotStorageId(botId);
  const suffix = safeId === 'main' ? '' : `_${safeId}`;
  const customFile = (process.env.DATA_FILE_PATH || '').trim();
  if (customFile) {
    try {
      const resolved = path.resolve(customFile);
      return suffix && resolved.endsWith('.json')
        ? resolved.replace(/\.json$/, `${suffix}.json`)
        : (suffix ? `${resolved}${suffix}.json` : resolved);
    } catch {}
  }
  return path.join(resolveVpsDataDir(), `store${suffix}.json`);
}

function getDataFileSearchPaths(botId: string = 'main'): string[] {
  const safeId = sanitizeBotStorageId(botId);
  const suffix = safeId === 'main' ? '' : `_${safeId}`;
  const primary = getPrimaryDataFilePath(safeId);
  const candidates = [
    primary,
    `${primary}.bak`,
    path.resolve(process.cwd(), 'data', `store${suffix}.json`),
    path.resolve(process.cwd(), 'data', `store${suffix}.json.bak`),
    path.resolve(process.cwd(), '.data', `store${suffix}.json`),
    `/tmp/tg_bot_store${suffix}.json`
  ];
  return Array.from(new Set(candidates));
}

export class SharedStorageService {
  private db: AppDatabase;
  private lastLoadedAt: number = 0;
  private hasInitialized = false;
  private triggerCache = new Map<string, ItemRecord>();
  private itemCache = new Map<string, ItemRecord>();
  private sortedActiveItemsNewestCache: ItemRecord[] | null = null;
  private sortedItemsChronoCache: ItemRecord[] | null = null;
  private invalidatedJoinRequestIds = new Set<string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private static claimedUpdatesMemory = new Map<string, number>();

  constructor(public readonly botId: string = 'main') {
    this.db = {
      items: [],
      templates: { ...DEFAULT_TEMPLATES },
      admins: [],
      sessions: [],
      trackedMessages: {},
      scheduledDeletions: [],
      uploadedFilesIndex: {},
      clonedBots: [],
      addSessions: {},
      botUsers: {},
      groupModeration: {},
      reports: [],
      fraudRules: [],
      linkWarnings: {},
      fraudWarnings: {},
      detectedChannels: [],
      joinRequests: {},
      postBotPublishedPosts: {},
      keyPools: [],
      guestAccounts: [],
      hourlyDeliveries: {},
      design: { ...DEFAULT_DESIGN },
      settings: { ...DEFAULT_SETTINGS },
      backupServer: { ...DEFAULT_BACKUP_SERVER_CONFIG }
    };
  }

  public getDataDir(): string {
    const primaryFile = getPrimaryDataFilePath(this.botId);
    const dir = path.dirname(primaryFile);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {}
    return dir;
  }

  public getStorageDir(): string {
    return resolveVpsStorageDir();
  }

  // Zero-latency in-memory item lookup: O(1) instant resolution for super-fast file delivery
  public resolveItemFast(cleanPayload: string): ItemRecord | null {
    if (!cleanPayload) return null;
    const p = cleanPayload.trim();
    if (!p) return null;

    // 1. Direct hit in item cache
    let it = this.itemCache.get(p) || null;
    if (it && it.status === 'active') return it;

    // 2. Normalize f_ or l_ prefixes
    const normalized = p.replace(/^(?:f_|l_)+/, '');
    it = this.itemCache.get(`f_${normalized}`) || this.itemCache.get(`l_${normalized}`) || this.itemCache.get(normalized) || null;
    if (it && it.status === 'active') return it;

    // 3. Trigger cache match
    const lower = p.toLowerCase();
    it = this.triggerCache.get(`slash:${lower.startsWith('/') ? lower : `/${lower}`}`) ||
         this.triggerCache.get(`hash:${lower.startsWith('#') ? lower : `#${lower}`}`) ||
         this.triggerCache.get(`normal:${lower}`) || null;
    if (it && it.status === 'active') return it;

    // 4. Quick in-memory list scan fallback
    for (const item of this.db.items) {
      if (item.status === 'active') {
        if (item.id === p || item.id === normalized || item.id === `f_${normalized}` || item.id === `l_${normalized}`) {
          return item;
        }
        if (item.rawKeyword && item.rawKeyword.toLowerCase() === lower) {
          return item;
        }
        if (Array.isArray(item.triggers) && item.triggers.some(t => t.trim().toLowerCase() === lower)) {
          return item;
        }
      }
    }

    return null;
  }

  public async resolveItemAnyStatus(cleanPayload: string): Promise<ItemRecord | null> {
    if (!cleanPayload) return null;
    const p = cleanPayload.trim();
    if (!p) return null;
    await this.loadLatest(false);
    this.checkAndCleanExpiredItemsSync();
    const normalized = p.replace(/^(?:f_|l_|t_)+/, '');
    const lower = p.toLowerCase();
    return (
      this.db.items.find((i) =>
        i.id === p ||
        i.id === normalized ||
        i.id === `f_${normalized}` ||
        i.id === `l_${normalized}` ||
        i.id === `t_${normalized}` ||
        (i.rawKeyword && i.rawKeyword.toLowerCase() === lower) ||
        (Array.isArray(i.triggers) &&
          i.triggers.some((t) => {
            const ct = t.trim().toLowerCase();
            return ct === lower || ct === `#${lower}` || ct === `/${lower}`;
          }))
      ) || null
    );
  }

  // Fast O(1) in-memory indexing for super-fast Telegram bot responses with strict trigger-type isolation
  private rebuildCache(): void {
    this.triggerCache.clear();
    this.itemCache.clear();
    this.sortedActiveItemsNewestCache = null;
    this.sortedItemsChronoCache = null;
    for (const item of this.db.items) {
      if (item.status === 'active') {
        this.itemCache.set(item.id, item);
        this.itemCache.set(`f_${item.id.replace(/^f_/, '')}`, item);
        this.itemCache.set(`l_${item.id.replace(/^l_/, '')}`, item);

        const tType: TriggerType = item.triggerType ||
          (item.triggers?.some(t => t.trim().startsWith('/')) ? 'slash' :
           (item.triggers?.some(t => t.trim().startsWith('#')) ? 'hashtag' : 'normal'));

        if (Array.isArray(item.triggers)) {
          for (const t of item.triggers) {
            const ct = t.trim().toLowerCase();
            if (!ct) continue;

            if (tType === 'slash' || ct.startsWith('/')) {
              // Slash command: strictly indexed under slash: and must start with '/'
              const slashKey = ct.startsWith('/') ? ct : `/${ct}`;
              this.triggerCache.set(`slash:${slashKey}`, item);
              const withoutBot = slashKey.replace(/@\w+$/, '');
              if (withoutBot !== slashKey) {
                this.triggerCache.set(`slash:${withoutBot}`, item);
              }
            } else if (tType === 'hashtag' || ct.startsWith('#')) {
              // Hashtag filter: strictly indexed under hash: and must start with '#'
              const hashKey = ct.startsWith('#') ? ct : `#${ct}`;
              this.triggerCache.set(`hash:${hashKey}`, item);
            } else {
              // Normal plain text: strictly indexed under norm: and must NOT start with '/' or '#'
              const normalKey = ct.replace(/^[/#!]+/, '').trim();
              if (normalKey) {
                this.triggerCache.set(`norm:${normalKey}`, item);
              }
            }
          }
        }
      }
    }

    // Pre-build chronological and newest-first active item indexes for instant /allfile rendering
    this.sortedItemsChronoCache = [...this.db.items].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      return (a.id || '').localeCompare(b.id || '');
    });

    this.sortedActiveItemsNewestCache = this.db.items
      .filter((item) => item && item.status !== 'disabled')
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
  }

  private activeLoadPromise: Promise<AppDatabase> | null = null;

  private buildSerializableSnapshot(): string {
    const cleanDb = {
      ...this.db,
      sessions: (this.db.sessions || []).filter((s) => s && s.expiresAt > Date.now())
    };
    return JSON.stringify(cleanDb, null, 2);
  }

  private async writeSnapshotAtomically(): Promise<boolean> {
    const primaryPath = getPrimaryDataFilePath(this.botId);
    // Never overwrite existing disk store before initial load from disk has completed
    if (!this.hasInitialized && fs.existsSync(primaryPath)) {
      return false;
    }
    const snapshot = this.buildSerializableSnapshot();
    const task = this.writeQueue.then(async () => {
      const dir = path.dirname(primaryPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const tmpPath = `${primaryPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        const fh = await fs.promises.open(tmpPath, 'w', 0o600);
        try {
          await fh.writeFile(snapshot, 'utf-8');
          await fh.sync();
        } finally {
          await fh.close();
        }
        // Preserve rolling valid backup before swapping primary store.json
        if (fs.existsSync(primaryPath)) {
          try {
            const stat = await fs.promises.stat(primaryPath);
            if (stat.size > 2) {
              const bakTmpPath = `${primaryPath}.bak.${process.pid}.tmp`;
              await fs.promises.copyFile(primaryPath, bakTmpPath);
              await fs.promises.rename(bakTmpPath, `${primaryPath}.bak`);
            }
          } catch {}
        }
        await fs.promises.rename(tmpPath, primaryPath);
      } catch (err) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        throw err;
      }
    });
    this.writeQueue = task.catch(() => {});
    try {
      await task;
      return true;
    } catch (err: any) {
      console.error(`[VPS Storage] Atomic save error (${this.botId}):`, err?.message || err);
      return false;
    }
  }

  // Graceful flush to ensure all in-flight changes are safely written to VPS disk
  public async flush(): Promise<void> {
    if (this.pendingPersistTimer) {
      clearTimeout(this.pendingPersistTimer);
      this.pendingPersistTimer = null;
    }
    await this.writeSnapshotAtomically();
  }

  // High-performance LRU / In-Memory Cache Layer
  private lruCache = new Map<string, { value: any; expiresAt: number; hitCount: number }>();
  private readonly MAX_LRU_ENTRIES = 1000;
  private blobStore = new Map<string, Map<string, any>>();
  private pendingPersistTimer: NodeJS.Timeout | null = null;
  private lastDiskCheck: number = 0;
  private revokedSessionTokens = new Set<string>();

  public getCached<T>(key: string): T | null {
    const entry = this.lruCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.lruCache.delete(key);
      return null;
    }
    entry.hitCount++;
    return entry.value as T;
  }

  public setCached<T>(key: string, value: T, ttlMs = 15000): void {
    if (this.lruCache.size >= this.MAX_LRU_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestHits = Infinity;
      for (const [k, v] of this.lruCache.entries()) {
        if (v.hitCount < oldestHits) {
          oldestHits = v.hitCount;
          oldestKey = k;
        }
      }
      if (oldestKey) this.lruCache.delete(oldestKey);
    }
    this.lruCache.set(key, { value, expiresAt: Date.now() + ttlMs, hitCount: 1 });
  }

  public invalidateCache(pattern?: string): void {
    if (!pattern) {
      this.lruCache.clear();
      return;
    }
    for (const k of this.lruCache.keys()) {
      if (k.startsWith(pattern) || k.includes(pattern)) {
        this.lruCache.delete(k);
      }
    }
  }

  public stopTimers(): void {
    if (this.pendingPersistTimer) {
      clearTimeout(this.pendingPersistTimer);
      this.pendingPersistTimer = null;
    }
    if (this.replicationDebounceTimer) {
      clearTimeout(this.replicationDebounceTimer);
      this.replicationDebounceTimer = null;
    }
  }

  public async clearMemoryCaches(): Promise<{
    clearedLruEntries: number;
    clearedBlobs: number;
    clearedMemoryFiles: number;
    prunedSessions: number;
  }> {
    const now = Date.now();
    const clearedLruEntries = this.lruCache.size;
    this.lruCache.clear();

    let clearedBlobs = 0;
    for (const m of this.blobStore.values()) {
      clearedBlobs += m.size;
    }
    this.blobStore.clear();

    const clearedMemoryFiles = SharedStorageService.uploadedFilesMemory.size;
    SharedStorageService.uploadedFilesMemory.clear();
    this.revokedSessionTokens.clear();

    const prevSessions = Array.isArray(this.db.sessions) ? this.db.sessions.length : 0;
    this.db.sessions = (this.db.sessions || []).filter(s => s && s.expiresAt > now);
    const prunedSessions = Math.max(0, prevSessions - this.db.sessions.length);

    this.rebuildCache();
    if (prunedSessions > 0) {
      await this.persist(false).catch(() => {});
    }

    return { clearedLruEntries, clearedBlobs, clearedMemoryFiles, prunedSessions };
  }

  // --- Hybrid In-Memory Cache Compatibility Layer ---
  // Maps storage keys efficiently in-memory so data retrieval remains instantaneous on VPS
  public async getBlob<T = any>(storeName: string, key: string): Promise<T | null> {
    const store = this.blobStore.get(storeName);
    if (store && store.has(key)) {
      return store.get(key) as T;
    }
    if (storeName === 'items') {
      const item = await this.getItem(key);
      return item as unknown as T;
    }
    if (storeName === 'users') {
      const user = await this.getUser(key);
      return user as unknown as T;
    }
    if (storeName === 'templates') {
      const tpl = await this.getTemplate(key);
      return tpl as unknown as T;
    }
    if (storeName === 'settings' && key === 'bot') {
      return (await this.getSettings()) as unknown as T;
    }
    return null;
  }

  public async setBlob(storeName: string, key: string, data: any): Promise<void> {
    if (!this.blobStore.has(storeName)) {
      this.blobStore.set(storeName, new Map());
    }
    this.blobStore.get(storeName)!.set(key, data);
    this.invalidateCache(`blob:${storeName}`);
  }

  public async deleteBlob(storeName: string, key: string): Promise<boolean> {
    const store = this.blobStore.get(storeName);
    if (store && store.has(key)) {
      store.delete(key);
      this.invalidateCache(`blob:${storeName}`);
      return true;
    }
    return false;
  }

  public async listBlobs(storeName: string): Promise<string[]> {
    const store = this.blobStore.get(storeName);
    if (store) {
      return Array.from(store.keys());
    }
    if (storeName === 'items') {
      return this.db.items.map(i => i.id);
    }
    if (storeName === 'users') {
      return Object.keys(this.db.botUsers || {});
    }
    return [];
  }

  // Background non-blocking local disk revalidation
  private async revalidateInBackground(): Promise<void> {
    const now = Date.now();
    if (now - this.lastDiskCheck < 20000) return;
    this.lastDiskCheck = now;

    try {
      const primaryPath = getPrimaryDataFilePath(this.botId);
      if (fs.existsSync(primaryPath)) {
        const stat = await fs.promises.stat(primaryPath).catch(() => null);
        if (stat && stat.mtimeMs > this.lastLoadedAt) {
          const raw = await fs.promises.readFile(primaryPath, 'utf-8').catch(() => null);
          if (raw && raw.trim().startsWith('{')) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              this.applyLoadedData(parsed);
              this.lastLoadedAt = stat.mtimeMs;
              this.rebuildCache();
              this.invalidateCache();
            }
          }
        }
      }
    } catch {}
  }

  private applyLoadedData(loadedData: Partial<AppDatabase>): void {
    const now = Date.now();
    // Preserve active non-expired in-memory sessions so cloud reloads never drop logged-in admins
    const mergedSessionsMap = new Map<string, SessionRecord>();
    for (const s of (this.db.sessions || [])) {
      if (s && s.token && s.expiresAt > now && !this.revokedSessionTokens.has(s.token)) {
        mergedSessionsMap.set(s.token, s);
      }
    }
    if (Array.isArray(loadedData.sessions)) {
      for (const s of loadedData.sessions) {
        if (s && s.token && s.expiresAt > now && !this.revokedSessionTokens.has(s.token)) {
          mergedSessionsMap.set(s.token, s);
        }
      }
    }

    const isMainBot = this.botId === 'main';
    const existingClonedBots = Array.isArray(this.db.clonedBots) ? this.db.clonedBots : [];
    const rawLoadedClonedBots = Array.isArray(loadedData.clonedBots) ? loadedData.clonedBots : existingClonedBots;
    const loadedClonedBots = rawLoadedClonedBots.filter(b => b && b.id && !SharedStorageService.isClonedBotDeleted(b.id));

    const cleanedLoadedTemplates = { ...(loadedData.templates || {}) };
    delete cleanedLoadedTemplates.WEB_CODE_MESSAGE;
    if (cleanedLoadedTemplates.GROUP_WELCOME_MESSAGE) {
      cleanedLoadedTemplates.GROUP_WELCOME_MESSAGE = {
        ...DEFAULT_TEMPLATES.GROUP_WELCOME_MESSAGE,
        ...cleanedLoadedTemplates.GROUP_WELCOME_MESSAGE,
        variables: DEFAULT_TEMPLATES.GROUP_WELCOME_MESSAGE.variables
      };
    }

    this.db = {
      items: Array.isArray(loadedData.items) ? loadedData.items : [],
      templates: { ...DEFAULT_TEMPLATES, ...cleanedLoadedTemplates },
      admins: Array.isArray(loadedData.admins) ? loadedData.admins : [],
      sessions: Array.from(mergedSessionsMap.values()),
      clonedBots: loadedClonedBots,
      trackedMessages: loadedData.trackedMessages || {},
      scheduledDeletions: Array.isArray(loadedData.scheduledDeletions) ? loadedData.scheduledDeletions : [],
      uploadedFilesIndex: loadedData.uploadedFilesIndex || {},
      addSessions: loadedData.addSessions || {},
      botUsers: loadedData.botUsers || {},
      groupModeration: loadedData.groupModeration || {},
      reports: Array.isArray(loadedData.reports) ? loadedData.reports : [],
      fraudRules: Array.isArray(loadedData.fraudRules) ? loadedData.fraudRules : [],
      linkWarnings: loadedData.linkWarnings || {},
      fraudWarnings: loadedData.fraudWarnings || {},
      detectedChannels: Array.isArray(loadedData.detectedChannels) ? loadedData.detectedChannels : [],
      joinRequests: (() => {
        const merged = { ...(loadedData.joinRequests || {}), ...(this.db.joinRequests || {}) };
        for (const invId of this.invalidatedJoinRequestIds) {
          delete merged[invId];
        }
        return merged;
      })(),
      postBotPublishedPosts: { ...(loadedData.postBotPublishedPosts || {}), ...(this.db.postBotPublishedPosts || {}) },
      imageUrlBotData: loadedData.imageUrlBotData || this.db.imageUrlBotData,
      keyPools: Array.isArray(loadedData.keyPools)
        ? loadedData.keyPools
        : (Array.isArray(this.db.keyPools) ? this.db.keyPools : []),
      guestAccounts: Array.isArray(loadedData.guestAccounts)
        ? loadedData.guestAccounts
        : (Array.isArray(this.db.guestAccounts) ? this.db.guestAccounts : []),
      hourlyDeliveries: (() => {
        const merged: Record<string, number> = {};
        const sources = [loadedData.hourlyDeliveries, this.db.hourlyDeliveries];
        for (const src of sources) {
          if (src && typeof src === 'object') {
            for (const [k, v] of Object.entries(src)) {
              const num = Number(v) || 0;
              if (num > 0) merged[k] = Math.max(merged[k] || 0, num);
            }
          }
        }
        return merged;
      })(),
      design: { ...DEFAULT_DESIGN, ...(loadedData.design || {}) },
      settings: {
        ...DEFAULT_SETTINGS,
        ...(loadedData.settings || {}),
        botToken: isMainBot
          ? ((() => {
              const envTok = String(process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
              const validEnvTok = envTok && !envTok.includes('your_telegram_bot_token') ? envTok : '';
              return validEnvTok || loadedData.settings?.botToken || '';
            })())
          : (loadedData.settings?.botToken || this.db.settings?.botToken || ''),
        rootAdminId: isMainBot
          ? (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || loadedData.settings?.rootAdminId || '')
          : (loadedData.settings?.rootAdminId || this.db.settings?.rootAdminId || ''),
        botMode: (
          loadedData.settings?.botMode === 'post_bot' || loadedData.settings?.botMode === 'image_url_bot'
            ? loadedData.settings.botMode
            : (this.db.settings?.botMode === 'post_bot' || this.db.settings?.botMode === 'image_url_bot'
                ? this.db.settings.botMode
                : 'file_bot')
        ),
        postBotChannelId: loadedData.settings?.postBotChannelId || this.db.settings?.postBotChannelId || '',
        autoDeleteNoticeEnabled: loadedData.settings?.autoDeleteNoticeEnabled ?? false,
        forceSubEnabled: loadedData.settings?.forceSubEnabled ?? false,
        forceJoinMode: loadedData.settings?.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join',
        autoApproveJoinRequests: loadedData.settings?.autoApproveJoinRequests ?? true,
        antiForwardEnabled: loadedData.settings?.antiForwardEnabled ?? false,
        linkDeleteEnabled: loadedData.settings?.linkDeleteEnabled ?? false,
        banEnabled: loadedData.settings?.banEnabled !== undefined ? Boolean(loadedData.settings.banEnabled) : true,
        muteEnabled: loadedData.settings?.muteEnabled !== undefined ? Boolean(loadedData.settings.muteEnabled) : true,
        cleanServiceEnabled: loadedData.settings?.cleanServiceEnabled ?? false,
        welcomeMessageEnabled: loadedData.settings?.welcomeMessageEnabled !== undefined ? Boolean(loadedData.settings.welcomeMessageEnabled) : true,
        welcomeAutoDeleteEnabled: loadedData.settings?.welcomeAutoDeleteEnabled ?? false,
        welcomeAutoDeleteSeconds: Math.max(1, Math.min(86400, Math.round(Number(loadedData.settings?.welcomeAutoDeleteSeconds) || 60))),
        moderationDurations: Array.isArray(loadedData.settings?.moderationDurations)
          ? sanitizeModerationDurations(loadedData.settings.moderationDurations)
          : DEFAULT_MODERATION_DURATIONS.map((d) => ({ ...d })),
        groupWarningLimit: Math.max(1, Math.min(100, Math.round(Number(loadedData.settings?.groupWarningLimit) || 3))),
        requiredChannels: Array.isArray(loadedData.settings?.requiredChannels) ? loadedData.settings.requiredChannels : [],
        chatWhitelistEnabled: loadedData.settings?.chatWhitelistEnabled ?? false,
        allowedChats: Array.isArray(loadedData.settings?.allowedChats) ? loadedData.settings.allowedChats : [],
        guestLikesEnabled: loadedData.settings?.guestLikesEnabled !== undefined ? Boolean(loadedData.settings.guestLikesEnabled) : true
      },
      backupServer: {
        ...DEFAULT_BACKUP_SERVER_CONFIG,
        ...(loadedData.backupServer || {})
      }
    };
  }

  // Blazing-fast In-Memory load with deduplicated cloud bootstrap
  public async loadLatest(force = false): Promise<AppDatabase> {
    const now = Date.now();

    // Fast Path: If already in memory and not cold boot, return immediately (0.01ms)
    if (this.lastLoadedAt > 0 && (!force || now - this.lastLoadedAt < 5000)) {
      if (now - this.lastDiskCheck > 30000) {
        this.revalidateInBackground().catch(() => {});
      }
      return this.db;
    }

    if (this.activeLoadPromise) {
      return this.activeLoadPromise;
    }

    this.activeLoadPromise = this.performLoadLatest().finally(() => {
      this.activeLoadPromise = null;
    });
    return this.activeLoadPromise;
  }

  private async performLoadLatest(): Promise<AppDatabase> {
    const primaryPath = getPrimaryDataFilePath(this.botId);
    let loadedData: Partial<AppDatabase> | null = null;
    let loadedFromLegacyPath: string | null = null;

    // Local VPS Store: prefer primary DATA_DIR/store.json, falling back cleanly to legacy .data/store.json for automatic migration
    for (const filePath of getDataFileSearchPaths(this.botId)) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = await fs.promises.readFile(filePath, 'utf-8');
          if (raw && raw.trim().startsWith('{')) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              loadedData = parsed;
              if (filePath !== primaryPath) {
                loadedFromLegacyPath = filePath;
              }
              console.log(`💾 [VPS Storage] Loaded local database (${this.botId}) from ${filePath}`);
              break;
            }
          }
        }
      } catch (err: any) {
        console.warn(`⚠️ [VPS Storage] Could not read store file ${filePath}:`, err?.message || err);
      }
    }

    if (loadedData) {
      this.applyLoadedData(loadedData);
    }

    // Ensure primary data & file storage directories exist, clean up orphan .tmp files, and migrate legacy snapshots
    try {
      const dataDir = path.dirname(primaryPath);
      if (!fs.existsSync(dataDir)) {
        await fs.promises.mkdir(dataDir, { recursive: true });
      }
      const storageDir = resolveVpsStorageDir();
      if (!fs.existsSync(storageDir)) {
        await fs.promises.mkdir(storageDir, { recursive: true });
      }
      const entries = await fs.promises.readdir(dataDir).catch(() => [] as string[]);
      const nowMs = Date.now();
      for (const name of entries) {
        if (name.endsWith('.tmp')) {
          const full = path.join(dataDir, name);
          const st = await fs.promises.stat(full).catch(() => null);
          if (st && nowMs - st.mtimeMs > 10000) {
            await fs.promises.unlink(full).catch(() => {});
          }
        }
      }
    } catch {}

    this.hasInitialized = true;

    try {
      if (loadedFromLegacyPath && !fs.existsSync(primaryPath)) {
        await this.writeSnapshotAtomically();
        console.log(`🔄 [VPS Storage] Migrated database (${this.botId}) from ${loadedFromLegacyPath} to ${primaryPath}`);
      }
    } catch {}

    // Ensure root admin from ADMIN_ID / ROOT_ADMIN_ID exists ONLY for primary main bot
    if (this.botId === 'main') {
      const rootId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || this.db.settings.rootAdminId || '').trim();
      const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ROOT_ADMIN_PASSWORD || '').trim();
      const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || 'Owner Admin').trim();

      if (rootId) {
        let rootAdmin = this.db.admins.find(a => a.id === rootId || a.telegramId === rootId);
        if (!rootAdmin && this.db.admins.length === 0) {
          const initPass = envAdminPassword || 'admin123';
          const defaultHash = await hashPassword(initPass);
          rootAdmin = {
            id: rootId,
            telegramId: rootId,
            name: envAdminName,
            role: 'owner',
            passwordHash: defaultHash,
            permissions: { ...DEFAULT_PERMISSIONS },
            enabled: true,
            createdAt: new Date().toISOString()
          };
          this.db.admins.push(rootAdmin);
          this.persist().catch(() => {});
        } else if (rootAdmin && envAdminPassword) {
          const matchesEnv = await verifyPassword(envAdminPassword, rootAdmin.passwordHash);
          if (!matchesEnv) {
            rootAdmin.passwordHash = await hashPassword(envAdminPassword);
            this.persist().catch(() => {});
            console.info('[Storage] Updated root admin password hash from ADMIN_PASSWORD environment variable.');
          }
        }
      }
    }

    this.lastLoadedAt = Date.now();
    this.lastDiskCheck = Date.now();
    this.rebuildCache();
    this.invalidateCache();
    return this.db;
  }

  // Alias for compatibility
  public async init(): Promise<void> {
    await this.loadLatest(true);
  }

  // Local VPS persistence: updates in-memory immediately & writes atomically to DATA_DIR
  public async persist(waitForDisk: boolean = false): Promise<boolean> {
    this.lastLoadedAt = Date.now();
    this.rebuildCache();
    this.invalidateCache();

    // Trigger debounced real-time replication to silent backup mirror if enabled
    if (
      this.db.backupServer?.enabled &&
      this.db.backupServer?.role === 'primary' &&
      this.db.backupServer?.autoSyncOnSave &&
      this.db.backupServer?.serverUrl
    ) {
      this.scheduleSilentReplication();
    }

    if (waitForDisk) {
      if (this.pendingPersistTimer) {
        clearTimeout(this.pendingPersistTimer);
        this.pendingPersistTimer = null;
      }
      return await this.writeSnapshotAtomically();
    }

    if (this.pendingPersistTimer) clearTimeout(this.pendingPersistTimer);
    this.pendingPersistTimer = setTimeout(() => {
      this.pendingPersistTimer = null;
      void this.writeSnapshotAtomically();
    }, 200);

    return true;
  }

  // --- Admins & Auth ---
  public async getAdmin(id: string): Promise<AdminUser | null> {
    await this.loadLatest(true);
    const cleanId = String(id).trim().replace(/^@/, '');
    const rootAdminId = (process.env.ROOT_ADMIN_ID || this.db.settings.rootAdminId || '').trim();
    const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();

    // 1. Direct match on id, telegramId, username, or name (case-insensitive)
    const directMatch = this.db.admins.find(a => 
      String(a.id).trim() === cleanId || 
      String(a.telegramId).trim() === cleanId ||
      (a.username && a.username.trim().toLowerCase() === cleanId.toLowerCase()) ||
      (a.name && a.name.trim().toLowerCase() === cleanId.toLowerCase())
    );
    if (directMatch) return directMatch;

    // 2. Normalized match (ignoring spaces & case e.g. "owneradmin", "admin", "owner")
    const cleanNormalized = cleanId.replace(/\s+/g, '').toLowerCase();
    const nameMatch = this.db.admins.find(a => 
      (a.username && a.username.replace(/\s+/g, '').toLowerCase() === cleanNormalized) ||
      (a.name && a.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized) ||
      (a.role === 'owner' && (cleanNormalized === 'admin' || cleanNormalized === 'owner' || cleanNormalized === 'owneradmin'))
    );
    if (nameMatch) return nameMatch;

    // 3. Match against configured environment variable ADMIN_NAME
    if (envAdminName) {
      const envNormalized = envAdminName.replace(/\s+/g, '').toLowerCase();
      if (cleanId.toLowerCase() === envAdminName.toLowerCase() || cleanNormalized === envNormalized) {
        const owner = this.db.admins.find(a => a.role === 'owner');
        if (owner) return owner;
      }
    }

    // 4. If matching the configured ROOT_ADMIN_ID and an owner exists
    if (rootAdminId && cleanId === rootAdminId) {
      const owner = this.db.admins.find(a => a.role === 'owner');
      if (owner) return owner;
    }

    return null;
  }

  public async getAdmins(): Promise<AdminUser[]> {
    await this.loadLatest(true);
    return this.db.admins;
  }

  public async saveAdmin(admin: AdminUser): Promise<boolean> {
    await this.loadLatest(true);
    const cleanId = String(admin.telegramId || admin.id).trim().replace(/^@/, '');
    
    // Find index by exact ID match
    const idx = this.db.admins.findIndex(a => 
      String(a.id).trim() === cleanId || 
      String(a.telegramId).trim() === cleanId
    );
    
    if (idx >= 0) {
      this.db.admins[idx] = { ...this.db.admins[idx], ...admin, id: cleanId, telegramId: cleanId };
    } else {
      // If owner claiming first owner record
      const ownerIdx = admin.role === 'owner' ? this.db.admins.findIndex(a => a.role === 'owner') : -1;
      if (ownerIdx >= 0) {
        this.db.admins[ownerIdx] = { ...this.db.admins[ownerIdx], ...admin, id: cleanId, telegramId: cleanId };
      } else {
        this.db.admins.push({ ...admin, id: cleanId, telegramId: cleanId });
      }
    }

    const ok = await this.persist();
    if (!ok) {
      console.error('[Storage] Failed to save admin record.');
      return false;
    }
    return true;
  }

  public async deleteAdmin(id: string): Promise<boolean> {
    await this.loadLatest(true);
    const cleanId = String(id).trim().replace(/^@/, '');
    const lenBefore = this.db.admins.length;
    this.db.admins = this.db.admins.filter(a => String(a.id).trim() !== cleanId && String(a.telegramId).trim() !== cleanId);
    if (this.db.admins.length !== lenBefore) {
      return await this.persist();
    }
    return false;
  }

  // --- Sessions (12-hour session lifetime) ---
  public async createSession(adminId: string, role: AdminRole, botId?: string): Promise<string> {
    await this.loadLatest(false);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
    
    // Purge expired sessions
    const now = Date.now();
    this.db.sessions = (this.db.sessions || []).filter(s => s.expiresAt > now);
    
    this.db.sessions.push({
      token,
      adminId,
      role,
      botId: botId || this.botId || 'main',
      expiresAt
    });

    await this.persist();
    return token;
  }

  public async createSessionWithToken(token: string, adminId: string, role: AdminRole, expiresAt?: number, botId?: string): Promise<void> {
    await this.loadLatest(false);
    const exp = expiresAt || (Date.now() + 12 * 60 * 60 * 1000);
    const now = Date.now();
    this.db.sessions = (this.db.sessions || []).filter(s => s.expiresAt > now && s.token !== token);
    this.db.sessions.push({
      token,
      adminId,
      role,
      botId: botId || this.botId || 'main',
      expiresAt: exp
    });
    await this.persist();
  }

  public async getSession(token: string): Promise<SessionRecord | null> {
    if (!token || this.revokedSessionTokens.has(token)) return null;
    await this.loadLatest(false);
    const now = Date.now();
    const session = (this.db.sessions || []).find(s => s.token === token && s.expiresAt > now);
    return session || null;
  }

  public async deleteSession(token: string): Promise<void> {
    if (!token) return;
    this.revokedSessionTokens.add(token);
    if (this.revokedSessionTokens.size > 500) {
      const first = this.revokedSessionTokens.values().next().value;
      if (first) this.revokedSessionTokens.delete(first);
    }
    this.db.sessions = (this.db.sessions || []).filter(s => s.token !== token);
    await this.persist();
  }

  // --- Items ---
  public async getItems(): Promise<ItemRecord[]> {
    await this.loadLatest(false);
    this.checkAndCleanExpiredItemsSync();
    if (!this.sortedItemsChronoCache) {
      this.rebuildCache();
    }
    return this.sortedItemsChronoCache || [];
  }

  // Zero-latency synchronous indexed item list (newest first) for /allfile & interactive pagination
  public getItemsFast(): ItemRecord[] {
    this.checkAndCleanExpiredItemsSync();
    if (!this.sortedActiveItemsNewestCache) {
      this.rebuildCache();
    }
    return this.sortedActiveItemsNewestCache || [];
  }

  // Zero-latency O(1) synchronous single-item lookup
  public getItemFast(id: string): ItemRecord | null {
    if (!id) return null;
    const cached = this.itemCache.get(id);
    if (cached && cached.status === 'active') {
      if (cached.retentionType === 'temporary' && cached.expiresAt && Date.now() >= new Date(cached.expiresAt).getTime()) {
        this.checkAndCleanExpiredItemsSync();
        return null;
      }
      return cached;
    }
    const item = this.db.items.find(i => i.id === id);
    if (item && item.retentionType === 'temporary' && item.expiresAt) {
      if (Date.now() >= new Date(item.expiresAt).getTime()) {
        this.checkAndCleanExpiredItemsSync();
        return null;
      }
    }
    return item || null;
  }

  public async getItem(id: string): Promise<ItemRecord | null> {
    await this.loadLatest(false);
    return this.getItemFast(id);
  }

  public async findItemByTrigger(trigger: string): Promise<ItemRecord | null> {
    const cleanTrigger = trigger.trim();
    if (!cleanTrigger) return null;
    const lowerTrigger = cleanTrigger.toLowerCase();

    const isSlash = cleanTrigger.startsWith('/');
    const isHashtag = cleanTrigger.startsWith('#');
    const isNormal = !isSlash && !isHashtag;

    // 1. Super-Fast O(1) Cache Lookup strictly isolated by trigger type
    let fastMatch: ItemRecord | undefined;

    if (isSlash) {
      const cleanSlash = lowerTrigger.replace(/@\w+$/, '');
      fastMatch = this.triggerCache.get(`slash:${lowerTrigger}`) || this.triggerCache.get(`slash:${cleanSlash}`);
    } else if (isHashtag) {
      fastMatch = this.triggerCache.get(`hash:${lowerTrigger}`);
    } else if (isNormal) {
      fastMatch = this.triggerCache.get(`norm:${lowerTrigger}`);
    }

    if (fastMatch && fastMatch.status === 'active') {
      if (fastMatch.retentionType === 'temporary' && fastMatch.expiresAt && Date.now() >= new Date(fastMatch.expiresAt).getTime()) {
        this.checkAndCleanExpiredItemsSync();
        return null;
      }
      return fastMatch;
    }

    // 2. Strict Fallback Scan in db.items if cache missed
    const matched = this.db.items.find(item => {
      if (item.status !== 'active' || !Array.isArray(item.triggers) || item.triggers.length === 0) return false;

      // 1. Slash Commands: MUST only match if incoming message starts with '/'
      if (isSlash) {
        const cleanSlash = lowerTrigger.replace(/@\w+$/, '');
        return item.triggers.some(t => {
          const ct = t.trim().toLowerCase();
          return ct.startsWith('/') && (ct === lowerTrigger || ct === cleanSlash);
        });
      }

      // 2. Hashtags: MUST only match if incoming message starts with '#'
      if (isHashtag) {
        return item.triggers.some(t => {
          const ct = t.trim().toLowerCase();
          return ct.startsWith('#') && ct === lowerTrigger;
        });
      }

      // 3. Normal Plain Text: MUST only match if incoming message is regular text without '/' or '#'
      if (isNormal) {
        return item.triggers.some(t => {
          const ct = t.trim().toLowerCase();
          if (ct.startsWith('#') || ct.startsWith('/')) return false;
          return ct === lowerTrigger;
        });
      }

      return false;
    });

    if (matched && matched.retentionType === 'temporary' && matched.expiresAt) {
      if (Date.now() >= new Date(matched.expiresAt).getTime()) {
        this.checkAndCleanExpiredItemsSync();
        return null;
      }
    }

    return matched || null;
  }

  public async findItemByTriggerAnyStatus(trigger: string): Promise<ItemRecord | null> {
    const cleanTrigger = trigger.trim();
    if (!cleanTrigger) return null;
    await this.loadLatest(false);
    this.checkAndCleanExpiredItemsSync();
    const lowerTrigger = cleanTrigger.toLowerCase();
    const isSlash = cleanTrigger.startsWith('/');
    const isHashtag = cleanTrigger.startsWith('#');
    const isNormal = !isSlash && !isHashtag;

    return (
      this.db.items.find((item) => {
        if (!Array.isArray(item.triggers) || item.triggers.length === 0) return false;
        if (isSlash) {
          const cleanSlash = lowerTrigger.replace(/@\w+$/, '');
          return item.triggers.some((t) => {
            const ct = t.trim().toLowerCase();
            return ct.startsWith('/') && (ct === lowerTrigger || ct === cleanSlash);
          });
        }
        if (isHashtag) {
          return item.triggers.some((t) => {
            const ct = t.trim().toLowerCase();
            return ct.startsWith('#') && ct === lowerTrigger;
          });
        }
        if (isNormal) {
          return item.triggers.some((t) => {
            const ct = t.trim().toLowerCase();
            if (ct.startsWith('#') || ct.startsWith('/')) return false;
            return ct === lowerTrigger;
          });
        }
        return false;
      }) || null
    );
  }

  public async saveItem(item: ItemRecord): Promise<boolean> {
    await this.loadLatest(true);
    // Sanitize item: never store massive base64 in store.json if file is already on disk
    const cleanItem = { ...item };
    if (cleanItem.uploadedFileId && cleanItem.fileBase64) {
      delete cleanItem.fileBase64;
    } else if (cleanItem.fileBase64 && cleanItem.fileBase64.length > 50000) {
      delete cleanItem.fileBase64;
    }
    // Synchronize caption and replyMessage so whatever is added via bot or admin panel is identical
    if (cleanItem.caption && !cleanItem.replyMessage) {
      cleanItem.replyMessage = cleanItem.caption;
    } else if (cleanItem.replyMessage && !cleanItem.caption) {
      cleanItem.caption = cleanItem.replyMessage;
    }
    if (cleanItem.buttonText) {
      cleanItem.buttonText = cleanItem.buttonText.trim();
    }
    if (!cleanItem.createdAt) {
      cleanItem.createdAt = new Date().toISOString();
    }
    const index = this.db.items.findIndex(i => i.id === cleanItem.id);
    if (index >= 0) {
      const prev = this.db.items[index];
      const setupVideoChanged = cleanItem.hasSetupVideo === false || (
        cleanItem.setupVideoUrl !== undefined && cleanItem.setupVideoUrl !== prev.setupVideoUrl
      );
      if (cleanItem.hasSetupVideo !== false && !cleanItem.setupVideoTelegramFileId && prev.setupVideoTelegramFileId && !setupVideoChanged) {
        cleanItem.setupVideoTelegramFileId = prev.setupVideoTelegramFileId;
      }
      if (cleanItem.hasSetupVideo !== false && !cleanItem.setupVideoUrl && prev.setupVideoUrl) {
        cleanItem.setupVideoUrl = prev.setupVideoUrl;
        cleanItem.setupVideoType = cleanItem.setupVideoType || prev.setupVideoType;
        cleanItem.setupVideoFileName = cleanItem.setupVideoFileName || prev.setupVideoFileName;
      }
      this.db.items[index] = { ...prev, ...cleanItem, updatedAt: new Date().toISOString() };
    } else {
      this.db.items.push(cleanItem);
    }
    this.rebuildCache();
    this.invalidateCache();
    return await this.persist(true);
  }

  public async deleteItem(id: string): Promise<boolean> {
    await this.loadLatest(true);
    const itemToDelete = this.db.items.find(i => i.id === id);
    const lenBefore = this.db.items.length;
    this.db.items = this.db.items.filter(i => i.id !== id);
    if (this.db.items.length !== lenBefore) {
      const uploadIds = new Set<string>();
      if (itemToDelete?.uploadedFileId) uploadIds.add(itemToDelete.uploadedFileId);
      if (itemToDelete?.setupVideoUrl && /^(?:upload|local|phone)_/i.test(itemToDelete.setupVideoUrl)) {
        uploadIds.add(itemToDelete.setupVideoUrl);
      }
      if (Array.isArray(itemToDelete?.files)) {
        for (const f of itemToDelete.files) {
          if (f.uploadedFileId) uploadIds.add(f.uploadedFileId);
        }
      }
      for (const uid of uploadIds) {
        this.deleteUploadedFile(uid).catch(() => {});
      }
      this.rebuildCache();
      this.invalidateCache();
      return await this.persist(true);
    }
    return false;
  }

  // Fast in-memory cleanup for temporary items whose expiration has passed
  public checkAndCleanExpiredItemsSync(): string[] {
    const now = Date.now();
    const expiredIds: string[] = [];
    const remainingItems: ItemRecord[] = [];

    for (const item of this.db.items) {
      if (item.retentionType === 'temporary' && item.expiresAt) {
        const expTime = new Date(item.expiresAt).getTime();
        if (!isNaN(expTime) && now >= expTime) {
          expiredIds.push(item.id);
          const uploadIds = new Set<string>();
          if (item.uploadedFileId) uploadIds.add(item.uploadedFileId);
          if (item.setupVideoUrl && /^(?:upload|local|phone)_/i.test(item.setupVideoUrl)) {
            uploadIds.add(item.setupVideoUrl);
          }
          if (Array.isArray(item.files)) {
            for (const f of item.files) {
              if (f.uploadedFileId) uploadIds.add(f.uploadedFileId);
            }
          }
          for (const uid of uploadIds) {
            this.deleteUploadedFile(uid).catch(() => {});
          }
          console.info(`[Storage] Expired temporary item "${item.name}" (${item.id}) reached expiration time. Auto-deleted.`);
          continue;
        }
      }
      remainingItems.push(item);
    }

    if (expiredIds.length > 0) {
      this.db.items = remainingItems;
      this.rebuildCache();
      this.invalidateCache('items');
      this.persist().catch(() => {});
    }
    return expiredIds;
  }

  // Auto-cleanup for temporary items whose lifespan/expiration has passed
  public async checkAndCleanExpiredItems(): Promise<string[]> {
    return this.checkAndCleanExpiredItemsSync();
  }

  public getLocalDayBounds(tzOffsetMinutes: number = 0): { startMs: number; endMs: number; clampedOffset: number } {
    const clampedOffset = Number.isFinite(tzOffsetMinutes)
      ? Math.max(-840, Math.min(840, Math.round(tzOffsetMinutes)))
      : 0;
    const localShiftMs = -clampedOffset * 60_000;
    const nowLocalMs = Date.now() + localShiftMs;
    const startMs = Math.floor(nowLocalMs / 86_400_000) * 86_400_000 - localShiftMs;
    const endMs = startMs + 86_400_000;
    return { startMs, endMs, clampedOffset };
  }

  private getDeliveryBucketKey(date: Date = new Date()): string {
    const mins = Math.floor(date.getUTCMinutes() / 15) * 15;
    const minStr = String(mins).padStart(2, '0');
    return `${date.toISOString().slice(0, 13)}:${minStr}`;
  }

  public async incrementItemDelivery(id: string): Promise<void> {
    const item = this.db.items.find(i => i.id === id);
    if (item) {
      item.deliveryCount = (item.deliveryCount || 0) + 1;
      if (!this.db.hourlyDeliveries) {
        this.db.hourlyDeliveries = {};
      }
      const bucketKey = this.getDeliveryBucketKey();
      this.db.hourlyDeliveries[bucketKey] = (this.db.hourlyDeliveries[bucketKey] || 0) + 1;

      const cutoffMs = Date.now() - 72 * 3600_000;
      for (const k of Object.keys(this.db.hourlyDeliveries)) {
        const parsedMs = Date.parse(`${k}:00.000Z`);
        if (!Number.isFinite(parsedMs) || parsedMs < cutoffMs) {
          delete this.db.hourlyDeliveries[k];
        }
      }

      this.invalidateCache('items');
      this.invalidateCache('stats');
      this.persist().catch(() => {});
    }
  }

  public async getTodayDeliveriesCount(tzOffsetMinutes: number = 0): Promise<number> {
    await this.loadLatest(false);
    const { startMs, endMs } = this.getLocalDayBounds(tzOffsetMinutes);
    const buckets = this.db.hourlyDeliveries || {};
    let total = 0;
    for (const [k, count] of Object.entries(buckets)) {
      const iso = k.length === 13 ? `${k}:00:00.000Z` : `${k}:00.000Z`;
      const bucketMs = Date.parse(iso);
      if (Number.isFinite(bucketMs) && bucketMs >= startMs && bucketMs < endMs) {
        total += Math.max(0, Number(count) || 0);
      }
    }
    return total;
  }

  // --- Templates ---
  public async getTemplates(): Promise<Record<string, MessageTemplate>> {
    await this.loadLatest(false);
    return { ...DEFAULT_TEMPLATES, ...(this.db.templates || {}) };
  }

  public async getTemplate(key: string): Promise<MessageTemplate> {
    await this.loadLatest(false);
    return this.db.templates[key] || DEFAULT_TEMPLATES[key] || {
      key,
      name: key,
      description: '',
      content: '',
      variables: []
    };
  }

  public async updateTemplate(
    key: string,
    content: string,
    extraFields?: {
      mediaType?: 'none' | 'photo' | 'video';
      mediaUrl?: string;
      buttons?: TemplateButton[];
    }
  ): Promise<boolean> {
    await this.loadLatest(true);
    if (this.db.templates[key]) {
      this.db.templates[key].content = content;
    } else if (DEFAULT_TEMPLATES[key]) {
      this.db.templates[key] = { ...DEFAULT_TEMPLATES[key], content };
    } else {
      this.db.templates[key] = {
        key,
        name: key,
        description: '',
        content,
        variables: []
      };
    }
    if (extraFields) {
      if (extraFields.mediaType !== undefined) {
        this.db.templates[key].mediaType = extraFields.mediaType;
      }
      if (extraFields.mediaUrl !== undefined) {
        this.db.templates[key].mediaUrl = extraFields.mediaUrl;
      }
      if (extraFields.buttons !== undefined) {
        this.db.templates[key].buttons = extraFields.buttons;
      }
    }
    return await this.persist();
  }

  public async resetTemplates(): Promise<boolean> {
    await this.loadLatest(true);
    this.db.templates = { ...DEFAULT_TEMPLATES };
    return await this.persist();
  }

  // --- Message Cleanup Tracking (10 messages limit) ---
  public async trackBotMessage(chatId: string | number, messageId: number): Promise<number | null> {
    await this.loadLatest(true);
    const chatKey = String(chatId);
    if (!this.db.trackedMessages[chatKey]) {
      this.db.trackedMessages[chatKey] = [];
    }
    const list = this.db.trackedMessages[chatKey];
    list.push({ messageId, timestamp: Date.now() });

    const maxLimit = this.db.settings.maxBotMessagesPerChat || 10;
    let messageIdToDelete: number | null = null;

    if (list.length > maxLimit) {
      const oldest = list.shift();
      if (oldest) {
        messageIdToDelete = oldest.messageId;
      }
    }
    await this.persist();
    return messageIdToDelete;
  }

  public async getMessagesOlderThan(hours: number): Promise<Array<{ chatId: string; messageId: number }>> {
    await this.loadLatest(true);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const toDelete: Array<{ chatId: string; messageId: number }> = [];

    for (const [chatId, messages] of Object.entries(this.db.trackedMessages)) {
      const remaining: TrackedMessage[] = [];
      for (const m of messages) {
        if (m.timestamp < cutoff) {
          toDelete.push({ chatId, messageId: m.messageId });
        } else {
          remaining.push(m);
        }
      }
      this.db.trackedMessages[chatId] = remaining;
    }
    await this.persist();
    return toDelete;
  }

  public async getTrackedCount(): Promise<number> {
    await this.loadLatest(false);
    return Object.values(this.db.trackedMessages).reduce((acc, list) => acc + list.length, 0);
  }

  // --- Bot Unique Users Tracking & Database Saving Middleware ---
  public async trackBotUser(user: {
    id: string | number;
    username?: string;
    firstName?: string;
    lastName?: string;
    is_bot?: boolean;
  }): Promise<BotUserRecord | null> {
    if (!user || !user.id) return null;
    const userId = String(user.id).trim();
    if (!userId) return null;

    // Filter out Telegram groups, supergroups, and channels (all have negative IDs)
    if (userId.startsWith('-') || Number(userId) <= 0) return null;

    // Filter out official Telegram system service accounts
    // 777000: Telegram Service Notifications
    // 1087968824: GroupAnonymousBot
    // 136817688: ChannelBot
    const SERVICE_IDS = ['777000', '1087968824', '136817688'];
    if (SERVICE_IDS.includes(userId)) return null;

    // Filter out accounts marked as bot
    if (user.is_bot) return null;

    // Check if this user has admin privileges
    const admins = await this.getAdmins();
    const settings = await this.getSettings();
    const rootAdminId = this.botId === 'main'
      ? String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim()
      : String(settings.rootAdminId || '').trim();
    const isAdmin = (Boolean(rootAdminId) && (userId === rootAdminId || rootAdminId.includes(userId))) ||
      admins.some(a => String(a.telegramId).trim() === userId || String(a.id).trim() === userId ||
        (user.username && a.username && a.username.replace(/^@+/, '').toLowerCase() === user.username.replace(/^@+/, '').toLowerCase()));

    // Exclude usernames ending with 'bot' (unless it's an authorized admin)
    const rawUsername = (user.username || '').replace(/^@+/, '').trim().toLowerCase();
    if (rawUsername.endsWith('bot') && !isAdmin) return null;

    await this.loadLatest(true);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    const now = new Date().toISOString();
    const cleanUsername = user.username
      ? `@${user.username.replace(/^@+/, '').trim()}`
      : undefined;
    const cleanFirstName = user.firstName ? String(user.firstName).trim() : undefined;
    const cleanLastName = user.lastName ? String(user.lastName).trim() : undefined;

    let record = this.db.botUsers[userId];
    if (record) {
      // User exists: update last active timestamp and live online status
      record.lastActiveAt = now;
      record.isOnline = true;
      record.interactionCount = (record.interactionCount || 0) + 1;
      if (cleanUsername) record.username = cleanUsername;
      if (cleanFirstName) record.firstName = cleanFirstName;
      if (cleanLastName) record.lastName = cleanLastName;
      if (isAdmin) record.isAdmin = true;
    } else {
      // User does NOT exist: save them instantly as a new real user
      record = {
        id: userId,
        username: cleanUsername,
        firstName: cleanFirstName || (isAdmin ? 'Admin' : undefined),
        lastName: cleanLastName,
        firstSeenAt: now,
        lastActiveAt: now,
        isOnline: true,
        interactionCount: 1,
        isAdmin: isAdmin
      };
      this.db.botUsers[userId] = record;
      console.info(`[Storage] Registered new human bot user: ${userId} (${record.username || record.firstName || 'User'})`);
    }

    this.invalidateCache('users');
    this.invalidateCache('stats');
    this.persist().catch(() => {});
    return record;
  }

  public async getTotalUserCount(): Promise<number> {
    const users = await this.getBotUsers();
    return users.length;
  }

  public async getUserStats(tzOffsetMinutes: number = 0): Promise<{
    totalUsers: number;
    onlineUsers: number;
    offlineUsers: number;
    todayJoinedUsers: number;
    bannedUsers: number;
  }> {
    const { startMs, endMs, clampedOffset } = this.getLocalDayBounds(tzOffsetMinutes);
    const cacheKey = `stats:users:${clampedOffset}`;
    const cached = this.getCached<{
      totalUsers: number;
      onlineUsers: number;
      offlineUsers: number;
      todayJoinedUsers: number;
      bannedUsers: number;
    }>(cacheKey);
    if (cached) return cached;

    const users = await this.getBotUsers();
    const onlineUsers = users.filter(u => u.isOnline).length;
    const offlineUsers = Math.max(0, users.length - onlineUsers);
    const bannedUsers = users.filter(u => Boolean(u.isBanned)).length;
    const todayJoinedUsers = users.filter((u) => {
      const t = u.firstSeenAt ? Date.parse(u.firstSeenAt) : NaN;
      return Number.isFinite(t) && t >= startMs && t < endMs;
    }).length;
    const stats = {
      totalUsers: users.length,
      onlineUsers,
      offlineUsers,
      todayJoinedUsers,
      bannedUsers
    };
    this.setCached(cacheKey, stats, 5000);
    return stats;
  }

  public async getBotUsers(): Promise<BotUserRecord[]> {
    const cached = this.getCached<BotUserRecord[]>('users:all');
    if (cached) return cached;

    if (!this.db.botUsers) this.db.botUsers = {};

    const admins = this.db.admins;
    const settings = this.db.settings;
    const rootAdminId = this.botId === 'main'
      ? String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim()
      : String(settings.rootAdminId || '').trim();

    const adminIds = new Set<string>();
    if (rootAdminId) adminIds.add(rootAdminId);
    for (const a of admins) {
      if (a.telegramId) adminIds.add(String(a.telegramId).trim());
      if (a.id) adminIds.add(String(a.id).trim());
    }

    // Clean up / Purge any non-human entries (groups, channels, service bots, or 3rd party bots) from database
    const SERVICE_IDS = ['777000', '1087968824', '136817688'];
    let changed = false;

    for (const [id, u] of Object.entries(this.db.botUsers)) {
      const strId = String(id).trim();
      const uname = (u.username || '').replace(/^@+/, '').trim().toLowerCase();
      const isAdminUser = adminIds.has(strId) || Boolean(u.isAdmin);
      const isInvalid = strId.startsWith('-') ||
        Number(strId) <= 0 ||
        SERVICE_IDS.includes(strId) ||
        Boolean((u as any).is_bot) ||
        (uname.endsWith('bot') && !isAdminUser);

      if (isInvalid) {
        delete this.db.botUsers[id];
        changed = true;
      }
    }

    // Ensure all registered admins are included in the user list even before initial telegram interaction
    const now = new Date().toISOString();

    for (const admin of admins) {
      const adminId = String(admin.telegramId || admin.id).trim();
      if (adminId && /^\d+$/.test(adminId) && !this.db.botUsers[adminId]) {
        const unameRaw = admin.username || admin.name;
        this.db.botUsers[adminId] = {
          id: adminId,
          username: unameRaw ? `@${unameRaw.replace(/^@+/, '').trim()}` : undefined,
          firstName: admin.name || 'Admin',
          firstSeenAt: admin.createdAt || now,
          lastActiveAt: admin.lastLoginAt || admin.createdAt || now,
          isOnline: admin.lastLoginAt ? (Date.now() - new Date(admin.lastLoginAt).getTime() < 15 * 60 * 1000) : false,
          interactionCount: 1,
          isAdmin: true
        };
        changed = true;
      }
    }

    if (rootAdminId && /^\d+$/.test(rootAdminId) && !this.db.botUsers[rootAdminId]) {
      this.db.botUsers[rootAdminId] = {
        id: rootAdminId,
        username: this.botId === 'main' && process.env.ADMIN_NAME
          ? `@${process.env.ADMIN_NAME.replace(/^@+/, '').trim()}`
          : undefined,
        firstName: this.botId === 'main' ? (process.env.ADMIN_NAME || 'Owner Admin') : 'Owner Admin',
        firstSeenAt: now,
        lastActiveAt: now,
        isOnline: true,
        interactionCount: 1,
        isAdmin: true
      };
      changed = true;
    }

    if (changed) {
      this.persist().catch(() => {});
    }

    const nowMs = Date.now();
    const sorted = Object.values(this.db.botUsers)
      .map((u) => {
        const lastActiveMs = u.lastActiveAt ? new Date(u.lastActiveAt).getTime() : 0;
        // User is considered online if active within last 10 minutes
        const isOnline = lastActiveMs > 0 && (nowMs - lastActiveMs < 10 * 60 * 1000);
        return {
          ...u,
          isOnline,
          isAdmin: adminIds.has(String(u.id).trim()) || Boolean(u.isAdmin)
        };
      })
      .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

    this.setCached('users:all', sorted, 10000);
    return sorted;
  }

  private pruneExpiredModerationStatuses(): boolean {
    if (!this.db.botUsers) return false;
    const now = Date.now();
    let changed = false;
    for (const u of Object.values(this.db.botUsers)) {
      if (!u) continue;
      if (u.isBanned && u.banUntil) {
        const exp = new Date(u.banUntil).getTime();
        if (Number.isFinite(exp) && now >= exp) {
          u.isBanned = false;
          delete u.bannedAt;
          delete u.banUntil;
          delete u.banChatId;
          delete u.banReason;
          changed = true;
        }
      }
      if (u.isMuted && u.muteUntil) {
        const exp = new Date(u.muteUntil).getTime();
        if (Number.isFinite(exp) && now >= exp) {
          u.isMuted = false;
          delete u.mutedAt;
          delete u.muteUntil;
          delete u.muteChatId;
          delete u.muteReason;
          changed = true;
        }
      }
    }
    if (changed) {
      this.invalidateCache('users:');
    }
    return changed;
  }

  public async isUserBanned(userId: string | number): Promise<boolean> {
    if (!userId) return false;
    await this.loadLatest(false);
    if (this.pruneExpiredModerationStatuses()) {
      this.persist().catch(() => {});
    }
    const cleanId = String(userId).trim();
    // 1. Direct key check
    const directUser = this.db.botUsers?.[cleanId];
    if (directUser !== undefined) {
      return Boolean(directUser.isBanned);
    }
    // 2. Check by username or ID across all registered records
    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    const allUsers = Object.values(this.db.botUsers || {});
    const match = allUsers.find(u => 
      String(u.id).trim() === cleanId || 
      (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername)
    );
    return Boolean(match?.isBanned);
  }

  public async getActiveBannedUsers(): Promise<BotUserRecord[]> {
    await this.loadLatest(false);
    if (this.pruneExpiredModerationStatuses()) {
      this.persist().catch(() => {});
    }
    return Object.values(this.db.botUsers || {})
      .filter((u) => Boolean(u && u.isBanned))
      .sort((a, b) => {
        const ta = new Date(a.bannedAt || a.lastActiveAt || 0).getTime();
        const tb = new Date(b.bannedAt || b.lastActiveAt || 0).getTime();
        return tb - ta;
      });
  }

  public async getActiveMutedUsers(): Promise<BotUserRecord[]> {
    await this.loadLatest(false);
    if (this.pruneExpiredModerationStatuses()) {
      this.persist().catch(() => {});
    }
    return Object.values(this.db.botUsers || {})
      .filter((u) => Boolean(u && u.isMuted))
      .sort((a, b) => {
        const ta = new Date(a.mutedAt || a.lastActiveAt || 0).getTime();
        const tb = new Date(b.mutedAt || b.lastActiveAt || 0).getTime();
        return tb - ta;
      });
  }

  public async getUser(userId: string | number): Promise<BotUserRecord | null> {
    if (!userId) return null;
    await this.loadLatest(false);
    if (this.pruneExpiredModerationStatuses()) {
      this.persist().catch(() => {});
    }
    const cleanId = String(userId).trim();
    if (this.db.botUsers?.[cleanId]) {
      return this.db.botUsers[cleanId];
    }
    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    const allUsers = Object.values(this.db.botUsers || {});
    const match = allUsers.find(u => 
      String(u.id).trim() === cleanId || 
      (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername)
    );
    return match || null;
  }

  public async toggleBanUser(userId: string | number): Promise<BotUserRecord | null> {
    if (!userId) return null;
    const cleanId = String(userId).trim();
    await this.loadLatest(true);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    // Safety constraint: Admins must NEVER be bannable!
    const admins = await this.getAdmins();
    const settings = await this.getSettings();
    const rootAdminId = this.botId === 'main'
      ? String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163')
      : String(settings.rootAdminId || '');
    const isAdmin = (Boolean(rootAdminId) && (cleanId === rootAdminId || rootAdminId.includes(cleanId))) ||
      admins.some(a => String(a.telegramId) === cleanId || String(a.id) === cleanId);
    if (isAdmin) {
      throw new Error('Administrators cannot be banned');
    }

    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    const matchingKeys = Object.keys(this.db.botUsers).filter(k => {
      const u = this.db.botUsers![k];
      return k === cleanId || 
             k.replace(/^@+/, '').toLowerCase() === cleanUsername ||
             String(u.id).trim() === cleanId || 
             (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername);
    });

    const now = new Date().toISOString();
    let user: BotUserRecord | null = null;

    if (matchingKeys.length === 0) {
      user = {
        id: cleanId,
        username: cleanId.startsWith('@') ? cleanId : undefined,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 0,
        isBanned: true,
        bannedAt: now
      };
      this.db.botUsers[cleanId] = user;
    } else {
      const targetBannedState = !Boolean(this.db.botUsers[matchingKeys[0]]?.isBanned);
      for (const k of matchingKeys) {
        const u = this.db.botUsers[k];
        u.isBanned = targetBannedState;
        if (targetBannedState) {
          u.bannedAt = now;
        } else {
          delete u.bannedAt;
          delete u.banUntil;
          delete u.banChatId;
          delete u.banReason;
          (u as any).bannedAt = undefined;
        }
        user = u;
      }
    }

    // When unbanned, completely clear any link warnings or fraud restrictions
    if (user && !user.isBanned) {
      delete user.bannedAt;
      delete user.banUntil;
      delete user.banChatId;
      delete user.banReason;
      (user as any).bannedAt = undefined;
      await this.resetUserLinkWarning(cleanId);
      await this.resetUserFraudWarning(cleanId);
      if (user.id) {
        await this.resetUserLinkWarning(user.id);
        await this.resetUserFraudWarning(user.id);
        if (this.db.botUsers[String(user.id).trim()]) {
          this.db.botUsers[String(user.id).trim()].isBanned = false;
          delete this.db.botUsers[String(user.id).trim()].bannedAt;
          delete this.db.botUsers[String(user.id).trim()].banUntil;
          delete this.db.botUsers[String(user.id).trim()].banChatId;
          delete this.db.botUsers[String(user.id).trim()].banReason;
          (this.db.botUsers[String(user.id).trim()] as any).bannedAt = undefined;
        }
      }
      if (user.username) {
        await this.resetUserLinkWarning(user.username);
        await this.resetUserFraudWarning(user.username);
      }
    }

    this.invalidateCache('users');
    this.invalidateCache('stats');
    await this.persist();
    return user;
  }

  // --- Design ---
  public async getDesign(): Promise<DesignConfig> {
    await this.loadLatest(false);
    // Auto-migrate legacy default logo asset if still stored
    if (
      !this.db.design.loginLogoUrl ||
      this.db.design.loginLogoUrl.includes('4fae5ca52db64590') ||
      this.db.design.loginLogoUrl.includes('f61e20b6c71945c4') ||
      this.db.design.loginLogoUrl.includes('df6c9e167caf42c6')
    ) {
      this.db.design.loginLogoUrl = 'https://host.tscv.workers.dev/img/27e97803c2bf4c39';
    }
    return this.db.design;
  }

  public async updateDesign(design: Partial<DesignConfig>): Promise<DesignConfig> {
    await this.loadLatest(true);
    this.db.design = { ...this.db.design, ...design };
    await this.persist();
    return this.db.design;
  }

  // --- Settings ---
  public async getSettings(): Promise<BotSettings> {
    await this.loadLatest(false);
    if (
      this.db.settings.botMode !== 'file_bot' &&
      this.db.settings.botMode !== 'post_bot' &&
      this.db.settings.botMode !== 'image_url_bot'
    ) {
      this.db.settings.botMode = 'file_bot';
    }
    if (this.db.settings.forceSubEnabled === undefined) {
      this.db.settings.forceSubEnabled = false;
    }
    if (this.db.settings.forceJoinMode !== 'auto_join' && this.db.settings.forceJoinMode !== 'request_only') {
      this.db.settings.forceJoinMode = 'auto_join';
    }
    if (this.db.settings.antiForwardEnabled === undefined) {
      this.db.settings.antiForwardEnabled = false;
    }
    if (this.db.settings.linkDeleteEnabled === undefined) {
      this.db.settings.linkDeleteEnabled = false;
    }
    if (this.db.settings.banEnabled === undefined) {
      this.db.settings.banEnabled = true;
    }
    if (this.db.settings.muteEnabled === undefined) {
      this.db.settings.muteEnabled = true;
    }
    if (this.db.settings.cleanServiceEnabled === undefined) {
      this.db.settings.cleanServiceEnabled = false;
    }
    if (this.db.settings.welcomeMessageEnabled === undefined) {
      this.db.settings.welcomeMessageEnabled = true;
    }
    if (this.db.settings.welcomeAutoDeleteEnabled === undefined) {
      this.db.settings.welcomeAutoDeleteEnabled = false;
    }
    if (this.db.settings.welcomeAutoDeleteSeconds === undefined || !Number.isFinite(Number(this.db.settings.welcomeAutoDeleteSeconds))) {
      this.db.settings.welcomeAutoDeleteSeconds = 60;
    }
    if (!Array.isArray(this.db.settings.moderationDurations)) {
      this.db.settings.moderationDurations = DEFAULT_MODERATION_DURATIONS.map((d) => ({ ...d }));
    }
    if (this.db.settings.groupWarningLimit === undefined || !Number.isFinite(Number(this.db.settings.groupWarningLimit))) {
      this.db.settings.groupWarningLimit = 3;
    }
    if (!Array.isArray(this.db.settings.requiredChannels)) {
      this.db.settings.requiredChannels = [];
    }
    if (this.db.settings.chatWhitelistEnabled === undefined) {
      this.db.settings.chatWhitelistEnabled = false;
    }
    if (!Array.isArray(this.db.settings.allowedChats)) {
      this.db.settings.allowedChats = [];
    }
    return this.db.settings;
  }

  public async updateSettings(settings: Partial<BotSettings>): Promise<BotSettings> {
    await this.loadLatest(true);
    const nextForceJoinMode: 'auto_join' | 'request_only' =
      settings.forceJoinMode !== undefined
        ? (settings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join')
        : (this.db.settings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join');
    const normalizeMode = (m: any): BotOperationalMode =>
      m === 'post_bot' ? 'post_bot' : (m === 'image_url_bot' ? 'image_url_bot' : 'file_bot');
    const nextBotMode: BotOperationalMode =
      settings.botMode !== undefined
        ? normalizeMode(settings.botMode)
        : normalizeMode(this.db.settings.botMode);
    this.db.settings = { 
      ...this.db.settings, 
      ...settings,
      botMode: nextBotMode,
      forceSubEnabled: settings.forceSubEnabled !== undefined ? Boolean(settings.forceSubEnabled) : (this.db.settings.forceSubEnabled ?? false),
      forceJoinMode: nextForceJoinMode,
      antiForwardEnabled: settings.antiForwardEnabled !== undefined ? Boolean(settings.antiForwardEnabled) : (this.db.settings.antiForwardEnabled ?? false),
      linkDeleteEnabled: settings.linkDeleteEnabled !== undefined ? Boolean(settings.linkDeleteEnabled) : (this.db.settings.linkDeleteEnabled ?? false),
      banEnabled: settings.banEnabled !== undefined ? Boolean(settings.banEnabled) : (this.db.settings.banEnabled ?? true),
      muteEnabled: settings.muteEnabled !== undefined ? Boolean(settings.muteEnabled) : (this.db.settings.muteEnabled ?? true),
      cleanServiceEnabled: settings.cleanServiceEnabled !== undefined ? Boolean(settings.cleanServiceEnabled) : (this.db.settings.cleanServiceEnabled ?? false),
      welcomeMessageEnabled: settings.welcomeMessageEnabled !== undefined ? Boolean(settings.welcomeMessageEnabled) : (this.db.settings.welcomeMessageEnabled ?? true),
      welcomeAutoDeleteEnabled: settings.welcomeAutoDeleteEnabled !== undefined ? Boolean(settings.welcomeAutoDeleteEnabled) : (this.db.settings.welcomeAutoDeleteEnabled ?? false),
      welcomeAutoDeleteSeconds: settings.welcomeAutoDeleteSeconds !== undefined
        ? Math.max(1, Math.min(86400, Math.round(Number(settings.welcomeAutoDeleteSeconds) || 60)))
        : Math.max(1, Math.min(86400, Math.round(Number(this.db.settings.welcomeAutoDeleteSeconds) || 60))),
      moderationDurations: settings.moderationDurations !== undefined && Array.isArray(settings.moderationDurations)
        ? sanitizeModerationDurations(settings.moderationDurations)
        : (Array.isArray(this.db.settings.moderationDurations)
            ? this.db.settings.moderationDurations
            : DEFAULT_MODERATION_DURATIONS.map((d) => ({ ...d }))),
      groupWarningLimit: settings.groupWarningLimit !== undefined
        ? Math.max(1, Math.min(100, Math.round(Number(settings.groupWarningLimit) || 3)))
        : Math.max(1, Math.min(100, Math.round(Number(this.db.settings.groupWarningLimit) || 3))),
      requiredChannels: settings.requiredChannels !== undefined && Array.isArray(settings.requiredChannels) 
        ? settings.requiredChannels 
        : (Array.isArray(this.db.settings.requiredChannels) ? this.db.settings.requiredChannels : []),
      chatWhitelistEnabled: settings.chatWhitelistEnabled !== undefined ? Boolean(settings.chatWhitelistEnabled) : (this.db.settings.chatWhitelistEnabled ?? false),
      allowedChats: settings.allowedChats !== undefined && Array.isArray(settings.allowedChats)
        ? settings.allowedChats
        : (Array.isArray(this.db.settings.allowedChats) ? this.db.settings.allowedChats : [])
    };
    await this.persist(true);
    return this.db.settings;
  }

  // --- Chat Whitelist / Ignore Guard ---
  private normalizeChatIdForWhitelist(chatId: string | number): string {
    return String(chatId || '').trim();
  }

  public async getAllowedChats(): Promise<AllowedChatEntry[]> {
    const s = await this.getSettings();
    return Array.isArray(s.allowedChats) ? s.allowedChats : [];
  }

  public async isChatWhitelisted(chatId: string | number, chatType?: string): Promise<boolean> {
    if (chatType === 'private') {
      return true;
    }
    const s = await this.getSettings();
    if (!s.chatWhitelistEnabled) {
      return true;
    }
    const cleanId = this.normalizeChatIdForWhitelist(chatId);
    if (!cleanId) return false;
    const list = Array.isArray(s.allowedChats) ? s.allowedChats : [];
    return list.some((entry) => {
      const entryId = String(entry?.id || '').trim();
      return entryId === cleanId;
    });
  }

  public async addAllowedChat(
    chatId: string | number,
    title?: string,
    type: AllowedChatEntry['type'] = 'supergroup',
    addedBy?: string,
    autoEnableWhitelist: boolean = true
  ): Promise<BotSettings> {
    await this.loadLatest(true);
    const cleanId = this.normalizeChatIdForWhitelist(chatId);
    if (!cleanId) return this.db.settings;
    const current = Array.isArray(this.db.settings.allowedChats) ? [...this.db.settings.allowedChats] : [];
    const idx = current.findIndex((c) => String(c.id).trim() === cleanId);
    const entry: AllowedChatEntry = {
      id: cleanId,
      title: title?.trim() || (idx >= 0 ? current[idx].title : undefined),
      type: type || (idx >= 0 ? current[idx].type : 'supergroup'),
      addedAt: idx >= 0 ? current[idx].addedAt : new Date().toISOString(),
      addedBy: addedBy || (idx >= 0 ? current[idx].addedBy : undefined)
    };
    if (idx >= 0) {
      current[idx] = entry;
    } else {
      current.push(entry);
    }
    this.db.settings = {
      ...this.db.settings,
      allowedChats: current,
      ...(autoEnableWhitelist ? { chatWhitelistEnabled: true } : {})
    };
    await this.persist(true);
    return this.db.settings;
  }

  public async removeAllowedChat(chatId: string | number): Promise<{ removed: boolean; settings: BotSettings }> {
    await this.loadLatest(true);
    const cleanId = this.normalizeChatIdForWhitelist(chatId);
    const current = Array.isArray(this.db.settings.allowedChats) ? this.db.settings.allowedChats : [];
    const filtered = current.filter((c) => String(c.id).trim() !== cleanId);
    const removed = filtered.length !== current.length;
    if (removed) {
      this.db.settings = {
        ...this.db.settings,
        allowedChats: filtered
      };
      await this.persist(true);
    }
    return { removed, settings: this.db.settings };
  }

  // --- Force Sub & Auto-Detected Channels ---
  public async getDetectedChannels(): Promise<ForceSubChannel[]> {
    await this.loadLatest(false);
    return Array.isArray(this.db.detectedChannels) ? this.db.detectedChannels : [];
  }

  public async registerDetectedChannel(channel: Partial<ForceSubChannel>): Promise<ForceSubChannel> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.detectedChannels)) {
      this.db.detectedChannels = [];
    }
    if (!Array.isArray(this.db.settings.requiredChannels)) {
      this.db.settings.requiredChannels = [];
    }

    const cleanChatId = String(channel.chatId || '').trim();
    if (!cleanChatId) throw new Error('Chat ID is required');

    // Check if channel already exists in detected list
    let existingDetected = this.db.detectedChannels.find(c => 
      c.chatId === cleanChatId || (channel.username && c.username && c.username.toLowerCase() === channel.username.toLowerCase())
    );

    const channelRecord: ForceSubChannel = {
      id: existingDetected?.id || channel.id || `ch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: channel.name?.trim() || existingDetected?.name || 'Telegram Channel',
      chatId: cleanChatId,
      inviteLink: channel.inviteLink?.trim() || existingDetected?.inviteLink || '',
      enabled: channel.enabled !== undefined ? channel.enabled : (existingDetected?.enabled ?? true),
      isAutoDetected: channel.isAutoDetected !== undefined ? channel.isAutoDetected : (existingDetected?.isAutoDetected ?? true),
      type: channel.type || existingDetected?.type || 'channel',
      username: channel.username || existingDetected?.username,
      isAdmin: channel.isAdmin !== undefined ? channel.isAdmin : true,
      detectedAt: existingDetected?.detectedAt || new Date().toISOString()
    };

    if (existingDetected) {
      Object.assign(existingDetected, channelRecord);
    } else {
      this.db.detectedChannels.push(channelRecord);
    }

    // Also synchronize into settings.requiredChannels so it displays in Force Sub settings seamlessly
    const reqIndex = this.db.settings.requiredChannels.findIndex(c => 
      c.chatId === cleanChatId || (channel.username && c.username && c.username.toLowerCase() === channel.username.toLowerCase())
    );
    if (reqIndex >= 0) {
      const prev = this.db.settings.requiredChannels[reqIndex];
      this.db.settings.requiredChannels[reqIndex] = {
        ...prev,
        ...channelRecord,
        enabled: channel.enabled !== undefined ? channel.enabled : (prev.enabled !== undefined ? prev.enabled : channelRecord.enabled)
      };
    } else {
      this.db.settings.requiredChannels.push(channelRecord);
    }

    await this.persist();
    return channelRecord;
  }

  public async updateChannelInviteLink(chatId: string, inviteLink: string, isRequestInviteLink: boolean = false): Promise<boolean> {
    if (!chatId || !inviteLink) return false;
    await this.loadLatest(true);
    let updated = false;
    const cleanId = String(chatId).trim();

    if (Array.isArray(this.db.settings?.requiredChannels)) {
      for (const ch of this.db.settings.requiredChannels) {
        if (String(ch.chatId).trim() === cleanId) {
          if (isRequestInviteLink) {
            ch.requestInviteLink = inviteLink;
          } else {
            ch.inviteLink = inviteLink;
          }
          updated = true;
        }
      }
    }
    if (Array.isArray(this.db.detectedChannels)) {
      for (const ch of this.db.detectedChannels) {
        if (String(ch.chatId).trim() === cleanId) {
          if (isRequestInviteLink) {
            ch.requestInviteLink = inviteLink;
          } else {
            ch.inviteLink = inviteLink;
          }
          updated = true;
        }
      }
    }

    if (updated) {
      this.invalidateCache('settings');
      await this.persist();
    }
    return updated;
  }

  public async toggleForceSubChannel(channelId: string, enabled?: boolean): Promise<ForceSubChannel | null> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.settings.requiredChannels)) {
      this.db.settings.requiredChannels = [];
    }
    const ch = this.db.settings.requiredChannels.find(c => c.id === channelId || c.chatId === channelId);
    if (!ch) return null;

    ch.enabled = enabled !== undefined ? enabled : !ch.enabled;

    // Also update in detectedChannels if present
    if (Array.isArray(this.db.detectedChannels)) {
      const det = this.db.detectedChannels.find(c => c.id === channelId || c.chatId === channelId);
      if (det) det.enabled = ch.enabled;
    }

    await this.persist();
    return ch;
  }

  public async removeForceSubChannel(channelId: string): Promise<boolean> {
    await this.loadLatest(true);
    if (Array.isArray(this.db.settings.requiredChannels)) {
      this.db.settings.requiredChannels = this.db.settings.requiredChannels.filter(c => c.id !== channelId && c.chatId !== channelId);
    }
    if (Array.isArray(this.db.detectedChannels)) {
      this.db.detectedChannels = this.db.detectedChannels.filter(c => c.id !== channelId && c.chatId !== channelId);
    }
    return await this.persist();
  }

  // --- Private Channel Join Requests & Auto-Approval ---
  public async recordJoinRequest(data: {
    chatId: string | number;
    chatUsername?: string;
    userId: string | number;
    chatTitle?: string;
    userName?: string;
    userUsername?: string;
    status?: 'approved' | 'pending' | 'rejected';
    inviteLink?: string;
    approvedAt?: string;
  }): Promise<JoinRequestRecord> {
    await this.loadLatest(false);
    if (!this.db.joinRequests) {
      this.db.joinRequests = {};
    }
    const cleanChatId = String(data.chatId || '').trim();
    const cleanUserId = String(data.userId || '').trim();
    if (!cleanChatId || !cleanUserId) {
      throw new Error('Both chatId and userId are required to record a join request');
    }

    const id = `${cleanChatId}_${cleanUserId}`;
    this.invalidatedJoinRequestIds.delete(id);
    const now = new Date().toISOString();
    const existing = this.db.joinRequests[id];
    const normalizedChatUsername = data.chatUsername
      ? `@${String(data.chatUsername).replace(/^@+/, '').trim()}`
      : existing?.chatUsername;

    const record: JoinRequestRecord = {
      id,
      chatId: cleanChatId,
      ...(normalizedChatUsername ? { chatUsername: normalizedChatUsername } : {}),
      chatTitle: data.chatTitle || existing?.chatTitle || '',
      userId: cleanUserId,
      userName: data.userName || existing?.userName || '',
      userUsername: data.userUsername || existing?.userUsername,
      status: data.status || existing?.status || 'pending',
      inviteLink: data.inviteLink || existing?.inviteLink,
      createdAt: data.status === 'pending' ? now : (existing?.createdAt || now),
      approvedAt: data.status === 'approved' ? (data.approvedAt || now) : (data.status === 'pending' ? undefined : existing?.approvedAt)
    };

    this.db.joinRequests[id] = record;
    await this.persist();
    return record;
  }

  private getMatchingJoinRequestKeys(
    chatId: string | number,
    userId: string | number,
    channelId?: string,
    channelUsername?: string,
    userUsername?: string
  ): string[] {
    if (!this.db.joinRequests) return [];
    const cleanUserId = String(userId || '').trim();
    const cleanUserUsername = String(userUsername || '').replace(/^@+/, '').toLowerCase().trim();
    if (!cleanUserId && !cleanUserUsername) return [];

    const rawChat = String(chatId || '').trim();
    const strippedChat = rawChat.replace(/^-100/, '').replace(/^-/, '').replace(/^@/, '').toLowerCase();
    const cleanUsername = channelUsername ? channelUsername.replace(/^@/, '').toLowerCase().trim() : '';

    const matchedKeys: string[] = [];
    for (const [key, req] of Object.entries(this.db.joinRequests)) {
      if (!req) continue;
      const reqUserId = String(req.userId || '').trim();
      const reqUserUsername = String(req.userUsername || '').replace(/^@+/, '').toLowerCase().trim();
      const matchesUser =
        (cleanUserId && reqUserId === cleanUserId) ||
        (cleanUserUsername && reqUserUsername && reqUserUsername === cleanUserUsername);
      if (!matchesUser) continue;

      const reqChat = String(req.chatId).trim();
      const strippedReqChat = reqChat.replace(/^-100/, '').replace(/^-/, '').replace(/^@/, '').toLowerCase();
      const reqChatUsername = String(req.chatUsername || '').replace(/^@+/, '').toLowerCase().trim();

      const matchesChat =
        reqChat === rawChat ||
        (strippedChat && (strippedReqChat === strippedChat || (reqChatUsername && reqChatUsername === strippedChat))) ||
        (channelId && (req.id.startsWith(channelId) || reqChat === channelId)) ||
        (cleanUsername && (
          reqChatUsername === cleanUsername ||
          reqChat.toLowerCase() === `@${cleanUsername}` ||
          reqChat.toLowerCase() === cleanUsername ||
          req.chatTitle?.toLowerCase() === cleanUsername
        ));

      if (matchesChat) {
        matchedKeys.push(key);
      }
    }
    return matchedKeys;
  }

  public async findJoinRequestRecord(
    chatId: string | number,
    userId: string | number,
    channelId?: string,
    channelUsername?: string,
    userUsername?: string
  ): Promise<JoinRequestRecord | null> {
    await this.loadLatest(false);
    const keys = this.getMatchingJoinRequestKeys(chatId, userId, channelId, channelUsername, userUsername);
    if (keys.length === 0 || !this.db.joinRequests) return null;

    let best: JoinRequestRecord | null = null;
    for (const k of keys) {
      const rec = this.db.joinRequests[k];
      if (!rec) continue;
      if (!best || new Date(rec.createdAt).getTime() >= new Date(best.createdAt).getTime()) {
        best = rec;
      }
    }
    return best;
  }

  public async invalidateJoinRequest(
    chatId: string | number,
    userId: string | number,
    channelId?: string,
    channelUsername?: string,
    userUsername?: string
  ): Promise<boolean> {
    await this.loadLatest(false);
    if (!this.db.joinRequests) return false;
    const keys = this.getMatchingJoinRequestKeys(chatId, userId, channelId, channelUsername, userUsername);
    if (keys.length === 0) return false;
    for (const k of keys) {
      delete this.db.joinRequests[k];
      this.invalidatedJoinRequestIds.add(k);
    }
    await this.persist();
    return true;
  }

  public async isJoinRequestApprovedOrPending(
    chatId: string | number,
    userId: string | number,
    channelId?: string,
    channelUsername?: string,
    userUsername?: string,
    options?: { pendingOnly?: boolean }
  ): Promise<boolean> {
    await this.loadLatest(false);
    if (!this.db.joinRequests) return false;
    const keys = this.getMatchingJoinRequestKeys(chatId, userId, channelId, channelUsername, userUsername);
    for (const k of keys) {
      const req = this.db.joinRequests[k];
      if (!req) continue;
      if (options?.pendingOnly) {
        if (req.status === 'pending') return true;
      } else {
        if (req.status === 'approved' || req.status === 'pending') return true;
      }
    }
    return false;
  }

  // --- Post Bot Published Posts Persistence ---
  public async getPostBotPublishedPosts(): Promise<Record<string, any>> {
    await this.loadLatest(false);
    return this.db.postBotPublishedPosts || {};
  }

  public async savePostBotPublishedPost(postId: string | number, postRecord: any): Promise<void> {
    await this.loadLatest(false);
    if (!this.db.postBotPublishedPosts) {
      this.db.postBotPublishedPosts = {};
    }
    this.db.postBotPublishedPosts[String(postId)] = postRecord;
    await this.persist();
  }

  // --- Image URL Bot Persistence ---
  public async getImageUrlBotData(): Promise<ImageUrlBotStoreData | undefined> {
    await this.loadLatest(false);
    return this.db.imageUrlBotData;
  }

  public async saveImageUrlBotData(data: ImageUrlBotStoreData): Promise<void> {
    await this.loadLatest(false);
    this.db.imageUrlBotData = data;
    await this.persist();
  }

  public async getJoinRequests(): Promise<JoinRequestRecord[]> {
    await this.loadLatest(false);
    if (!this.db.joinRequests) return [];
    return Object.values(this.db.joinRequests).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public async updateJoinRequestStatus(
    chatId: string | number,
    userId: string | number,
    status: 'approved' | 'rejected' | 'pending'
  ): Promise<JoinRequestRecord | null> {
    await this.loadLatest(true);
    if (!this.db.joinRequests) return null;

    const cleanChatId = String(chatId).trim();
    const cleanUserId = String(userId).trim();
    const id = `${cleanChatId}_${cleanUserId}`;

    let req = this.db.joinRequests[id];
    if (!req) {
      // Find matching user + chat
      const strippedChat = cleanChatId.replace(/^-100/, '').replace(/^-/, '');
      for (const item of Object.values(this.db.joinRequests)) {
        if (item.userId === cleanUserId && item.chatId.replace(/^-100/, '').replace(/^-/, '') === strippedChat) {
          req = item;
          break;
        }
      }
    }

    if (!req) return null;
    req.status = status;
    if (status === 'approved') {
      req.approvedAt = new Date().toISOString();
    }
    await this.persist();
    return req;
  }

  // --- Scheduled Message Deletion (10-minute Delivery Auto-Remove) ---
  public async scheduleMessageDeletion(data: {
    chatId: string | number;
    messageId: number;
    companionNoticeId?: number;
    timeoutMinutes?: number;
    timeoutSeconds?: number;
    itemTitle?: string;
  }): Promise<ScheduledDeletion> {
    await this.loadLatest(true);
    const configuredTimeout = this.db.settings?.deliveryTimeoutMinutes;
    const timeoutMins = (typeof data.timeoutMinutes === 'number' && data.timeoutMinutes > 0)
      ? data.timeoutMinutes
      : ((typeof configuredTimeout === 'number' && configuredTimeout > 0) ? configuredTimeout : 10);
    const hasSecondDelay = typeof data.timeoutSeconds === 'number' && data.timeoutSeconds > 0;
    const delayMs = hasSecondDelay ? Math.round(data.timeoutSeconds! * 1000) : timeoutMins * 60 * 1000;
    const deleteAt = Date.now() + delayMs;
    const record: ScheduledDeletion = {
      id: `sd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      chatId: String(data.chatId),
      messageId: data.messageId,
      companionNoticeId: data.companionNoticeId,
      deleteAt,
      timeoutMinutes: hasSecondDelay ? Number((data.timeoutSeconds! / 60).toFixed(2)) : timeoutMins,
      itemTitle: data.itemTitle || 'File',
      createdAt: new Date().toISOString()
    };

    if (!Array.isArray(this.db.scheduledDeletions)) {
      this.db.scheduledDeletions = [];
    }
    this.db.scheduledDeletions.push(record);
    await this.persist();
    return record;
  }

  public async getScheduledDeletions(): Promise<ScheduledDeletion[]> {
    await this.loadLatest(false);
    return Array.isArray(this.db.scheduledDeletions) ? this.db.scheduledDeletions : [];
  }

  public async popDueScheduledDeletions(): Promise<ScheduledDeletion[]> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.scheduledDeletions) || this.db.scheduledDeletions.length === 0) {
      return [];
    }

    const now = Date.now();
    const due: ScheduledDeletion[] = [];
    const remaining: ScheduledDeletion[] = [];

    for (const item of this.db.scheduledDeletions) {
      if (item.deleteAt <= now) {
        due.push(item);
      } else {
        remaining.push(item);
      }
    }

    if (due.length > 0) {
      this.db.scheduledDeletions = remaining;
      await this.persist();
    }

    return due;
  }

  public async removeScheduledDeletion(id: string): Promise<boolean> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.scheduledDeletions)) return false;
    const lenBefore = this.db.scheduledDeletions.length;
    this.db.scheduledDeletions = this.db.scheduledDeletions.filter(s => s.id !== id);
    if (this.db.scheduledDeletions.length !== lenBefore) {
      await this.persist();
      return true;
    }
    return false;
  }

  // --- Chat Delivery Messages Tracking (Fresh Chat / Previous Delivery Auto-Cleanup) ---
  public async recordChatDeliveryMessage(chatId: string | number, messageId: number): Promise<void> {
    await this.loadLatest(true);
    const key = String(chatId);
    if (!this.db.chatDeliveryMessages) {
      this.db.chatDeliveryMessages = {};
    }
    if (!Array.isArray(this.db.chatDeliveryMessages[key])) {
      this.db.chatDeliveryMessages[key] = [];
    }
    this.db.chatDeliveryMessages[key].push(messageId);
    // Keep at most 25 recent delivery IDs per chat
    if (this.db.chatDeliveryMessages[key].length > 25) {
      this.db.chatDeliveryMessages[key] = this.db.chatDeliveryMessages[key].slice(-25);
    }
    await this.persist();
  }

  public async getChatDeliveryMessages(chatId: string | number): Promise<number[]> {
    await this.loadLatest(false);
    const key = String(chatId);
    return this.db.chatDeliveryMessages?.[key] || [];
  }

  public async clearChatDeliveryMessages(chatId: string | number): Promise<number[]> {
    await this.loadLatest(true);
    const key = String(chatId);
    const recordedList = this.db.chatDeliveryMessages?.[key] ? [...this.db.chatDeliveryMessages[key]] : [];
    if (this.db.chatDeliveryMessages && this.db.chatDeliveryMessages[key]) {
      this.db.chatDeliveryMessages[key] = [];
    }
    await this.persist();
    return recordedList;
  }

  // --- Local VPS File Storage (STORAGE_DIR, default ./storage/files) ---
  private static uploadedFilesMemory = new Map<string, UploadedFileRecord>();

  private getUploadDirs(): string[] {
    const dirs: string[] = [resolveVpsStorageDir()];
    try {
      dirs.push(path.resolve(process.cwd(), 'storage', 'files'));
      dirs.push(path.resolve(process.cwd(), '.data', 'uploads'));
    } catch {}
    dirs.push('/tmp/tg_uploads');
    return Array.from(new Set(dirs));
  }

  private static readonly MAX_RAM_CACHE_BYTES = 25 * 1024 * 1024;

  public getPrimaryUploadDir(): string {
    const primary = resolveVpsStorageDir();
    try {
      if (!fs.existsSync(primary)) {
        fs.mkdirSync(primary, { recursive: true });
      }
      return primary;
    } catch {}
    for (const dir of this.getUploadDirs()) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
      } catch {}
    }
    return primary;
  }

  public getUploadedFilePath(fileId: string): string | null {
    if (!fileId) return null;
    for (const dir of this.getUploadDirs()) {
      try {
        const resolved = safeResolveInsideDir(dir, fileId);
        if (resolved && fs.existsSync(resolved)) {
          return resolved;
        }
      } catch {}
    }
    return null;
  }

  public async registerUploadedFileFromDisk(fileId: string, data: {
    fileName: string;
    fileType?: 'document' | 'photo' | 'video' | 'audio';
    mimeType?: string;
    size: number;
    bufferForSmallSync?: Buffer;
  }): Promise<void> {
    const cleanId = String(fileId).trim();
    const fType = data.fileType || 'document';
    const mime = data.mimeType || 'application/octet-stream';
    const createdAt = new Date().toISOString();
    const size = data.size;

    const meta = {
      id: cleanId,
      fileName: data.fileName,
      fileType: fType,
      mimeType: mime,
      size,
      createdAt
    };

    const primaryDir = this.getPrimaryUploadDir();
    const filePath = safeResolveInsideDir(primaryDir, cleanId);
    const metaPath = safeResolveInsideDir(primaryDir, `${cleanId}.meta.json`);
    if (filePath && metaPath && fs.existsSync(filePath)) {
      const tmpMetaPath = `${metaPath}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmpMetaPath, JSON.stringify(meta)).catch(() => {});
      await fs.promises.rename(tmpMetaPath, metaPath).catch(() => {});
    }

    if (data.bufferForSmallSync && size <= SharedStorageService.MAX_RAM_CACHE_BYTES) {
      SharedStorageService.uploadedFilesMemory.set(cleanId, {
        ...meta,
        buffer: data.bufferForSmallSync
      });
    }

    await this.loadLatest(true);
    if (!this.db.uploadedFilesIndex) {
      this.db.uploadedFilesIndex = {};
    }
    this.db.uploadedFilesIndex[cleanId] = meta;
    await this.persist(true);
  }

  public async saveUploadedFile(fileId: string, data: {
    buffer: Buffer;
    fileName: string;
    fileType?: 'document' | 'photo' | 'video' | 'audio';
    mimeType?: string;
  }): Promise<UploadedFileRecord> {
    const cleanId = String(fileId).trim();
    const fType = data.fileType || 'document';
    const mime = data.mimeType || 'application/octet-stream';
    const createdAt = new Date().toISOString();
    const size = data.buffer.length;

    const record: UploadedFileRecord = {
      id: cleanId,
      fileName: data.fileName,
      fileType: fType,
      mimeType: mime,
      size,
      buffer: data.buffer,
      createdAt
    };

    // 1. Cache files <= 25MB in static memory (large files stay streamed on disk to avoid OOM crashes)
    if (size <= SharedStorageService.MAX_RAM_CACHE_BYTES) {
      SharedStorageService.uploadedFilesMemory.set(cleanId, record);
    }

    // 2. Persist atomically directly to VPS STORAGE_DIR
    const meta = {
      id: cleanId,
      fileName: data.fileName,
      fileType: fType,
      mimeType: mime,
      size,
      createdAt
    };
    const primaryDir = this.getPrimaryUploadDir();
    const targetFilePath = safeResolveInsideDir(primaryDir, cleanId);
    const targetMetaPath = safeResolveInsideDir(primaryDir, `${cleanId}.meta.json`);
    if (!targetFilePath || !targetMetaPath) {
      throw new Error('Invalid file identifier');
    }
    await fs.promises.mkdir(primaryDir, { recursive: true });
    const tmpFilePath = `${targetFilePath}.${process.pid}.${Date.now()}.tmp`;
    const tmpMetaPath = `${targetMetaPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.promises.writeFile(tmpFilePath, data.buffer);
      await fs.promises.rename(tmpFilePath, targetFilePath);
      await fs.promises.writeFile(tmpMetaPath, JSON.stringify(meta));
      await fs.promises.rename(tmpMetaPath, targetMetaPath);
    } catch (err) {
      await fs.promises.unlink(tmpFilePath).catch(() => {});
      await fs.promises.unlink(tmpMetaPath).catch(() => {});
      throw err;
    }

    // 3. Keep index in local database (metadata only inside store.json)
    await this.loadLatest(true);
    if (!this.db.uploadedFilesIndex) {
      this.db.uploadedFilesIndex = {};
    }
    this.db.uploadedFilesIndex[cleanId] = meta;
    await this.persist(true);
    return record;
  }

  public async getUploadedFile(fileId: string): Promise<UploadedFileRecord | null> {
    if (!fileId) return null;
    const cleanId = String(fileId).trim();

    // 1. Check in-memory map
    if (SharedStorageService.uploadedFilesMemory.has(cleanId)) {
      return SharedStorageService.uploadedFilesMemory.get(cleanId)!;
    }

    // 2. Check disk in STORAGE_DIR and legacy upload directories
    for (const dir of this.getUploadDirs()) {
      try {
        const filePath = safeResolveInsideDir(dir, cleanId);
        const metaPath = safeResolveInsideDir(dir, `${cleanId}.meta.json`);
        if (filePath && fs.existsSync(filePath)) {
          const buffer = await fs.promises.readFile(filePath);
          let meta: any = {};
          if (metaPath && fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
            } catch {}
          }
          const rec: UploadedFileRecord = {
            id: cleanId,
            fileName: meta.fileName || 'file',
            fileType: meta.fileType || 'document',
            mimeType: meta.mimeType || 'application/octet-stream',
            size: buffer.length,
            buffer,
            createdAt: meta.createdAt || new Date().toISOString()
          };
          if (buffer.length <= SharedStorageService.MAX_RAM_CACHE_BYTES) {
            SharedStorageService.uploadedFilesMemory.set(cleanId, rec);
          }
          return rec;
        }
      } catch {
        // Continue
      }
    }

    // 3. Check db.uploadedFilesIndex legacy embedded base64
    await this.loadLatest(false);
    if (this.db.uploadedFilesIndex && this.db.uploadedFilesIndex[cleanId]) {
      const entry = this.db.uploadedFilesIndex[cleanId];
      if (entry.base64) {
        const buffer = Buffer.from(entry.base64, 'base64');
        const rec: UploadedFileRecord = {
          id: cleanId,
          fileName: entry.fileName,
          fileType: entry.fileType,
          mimeType: entry.mimeType,
          size: buffer.length,
          buffer,
          createdAt: entry.createdAt
        };
        SharedStorageService.uploadedFilesMemory.set(cleanId, rec);
        return rec;
      }
    }

    // 4. Check if an item in database has direct fileBase64
    for (const it of this.db.items) {
      if ((it.id === cleanId || it.uploadedFileId === cleanId || it.telegramFileId === cleanId) && it.fileBase64) {
        const buffer = Buffer.from(it.fileBase64, 'base64');
        const rec: UploadedFileRecord = {
          id: cleanId,
          fileName: it.fileName || it.name || 'file',
          fileType: it.fileType || 'document',
          mimeType: it.mimeType || 'application/octet-stream',
          size: buffer.length,
          buffer,
          createdAt: it.createdAt
        };
        SharedStorageService.uploadedFilesMemory.set(cleanId, rec);
        return rec;
      }
    }

    return null;
  }

  public async deleteUploadedFile(fileId: string): Promise<void> {
    if (!fileId) return;
    const cleanId = String(fileId).trim();
    SharedStorageService.uploadedFilesMemory.delete(cleanId);
    for (const dir of this.getUploadDirs()) {
      try {
        const filePath = safeResolveInsideDir(dir, cleanId);
        const metaPath = safeResolveInsideDir(dir, `${cleanId}.meta.json`);
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (metaPath && fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } catch {}
    }
    if (this.db.uploadedFilesIndex && this.db.uploadedFilesIndex[cleanId]) {
      delete this.db.uploadedFilesIndex[cleanId];
      await this.persist();
    }
  }

  // --- Bot Add Sessions (for /add interactive flow across serverless calls) ---
  public async getAddSession(fromId: string): Promise<any | null> {
    await this.loadLatest(false);
    return this.db.addSessions?.[fromId] || null;
  }

  public async saveAddSession(fromId: string, session: any): Promise<void> {
    await this.loadLatest(true);
    if (!this.db.addSessions) {
      this.db.addSessions = {};
    }
    this.db.addSessions[fromId] = session;
    await this.persist();
  }

  public async deleteAddSession(fromId: string): Promise<void> {
    await this.loadLatest(true);
    if (this.db.addSessions && this.db.addSessions[fromId]) {
      delete this.db.addSessions[fromId];
      await this.persist();
    }
  }

  // --- User Reports ---
  public async getReports(): Promise<UserReportRecord[]> {
    await this.loadLatest(true);
    return Array.isArray(this.db.reports) ? [...this.db.reports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : [];
  }

  public async saveReport(report: UserReportRecord): Promise<UserReportRecord> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.reports)) {
      this.db.reports = [];
    }
    const idx = this.db.reports.findIndex(r => r.id === report.id);
    if (idx >= 0) {
      this.db.reports[idx] = { ...this.db.reports[idx], ...report };
    } else {
      this.db.reports.unshift(report);
    }
    await this.persist();
    return report;
  }

  public async updateReportStatus(
    id: string,
    status: 'pending' | 'resolved' | 'dismissed',
    resolvedBy?: string,
    resolutionOutcome?: 'banned' | 'dismissed' | 'resolved'
  ): Promise<UserReportRecord | null> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.reports)) return null;
    const report = this.db.reports.find(r => r.id === id);
    if (report) {
      report.status = status;
      if (resolvedBy) report.resolvedBy = resolvedBy;
      if (resolutionOutcome) {
        report.resolutionOutcome = resolutionOutcome;
      } else if (status === 'dismissed') {
        report.resolutionOutcome = 'dismissed';
      }
      if (status === 'resolved' || status === 'dismissed') report.resolvedAt = new Date().toISOString();
      await this.persist();
      return report;
    }
    return null;
  }

  public async deleteReport(id: string): Promise<boolean> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.reports)) return false;
    const before = this.db.reports.length;
    this.db.reports = this.db.reports.filter(r => r.id !== id);
    if (this.db.reports.length !== before) {
      await this.persist();
      return true;
    }
    return false;
  }

  // --- Fraud & Restricted Keyword Rules ---
  public async getFraudRules(): Promise<FraudKeywordRule[]> {
    await this.loadLatest(false);
    const rules = Array.isArray(this.db.fraudRules) ? this.db.fraudRules : [];
    return [...rules].sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeB !== timeA) return timeB - timeA;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  public async saveFraudRule(rule: FraudKeywordRule): Promise<FraudKeywordRule> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.fraudRules)) {
      this.db.fraudRules = [];
    }
    const idx = this.db.fraudRules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      this.db.fraudRules[idx] = { ...this.db.fraudRules[idx], ...rule };
    } else {
      this.db.fraudRules.push(rule);
    }
    await this.persist();
    return rule;
  }

  public async deleteFraudRule(id: string): Promise<boolean> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.fraudRules)) return false;
    const before = this.db.fraudRules.length;
    this.db.fraudRules = this.db.fraudRules.filter(r => r.id !== id);
    if (this.db.fraudRules.length !== before) {
      await this.persist();
      return true;
    }
    return false;
  }

  // --- Group Link Warnings Tracking ---
  public async getUserLinkWarnings(chatOrUserId: string | number, maybeUserId?: string | number): Promise<number> {
    await this.loadLatest(false);
    const key = maybeUserId !== undefined ? `${chatOrUserId}_${maybeUserId}` : String(chatOrUserId);
    return this.db.linkWarnings?.[key] || 0;
  }

  public async incrementUserLinkWarning(chatOrUserId: string | number, maybeUserId?: string | number): Promise<number> {
    await this.loadLatest(true);
    if (!this.db.linkWarnings) {
      this.db.linkWarnings = {};
    }
    const key = maybeUserId !== undefined ? `${chatOrUserId}_${maybeUserId}` : String(chatOrUserId);
    const nextVal = (this.db.linkWarnings[key] || 0) + 1;
    this.db.linkWarnings[key] = nextVal;
    await this.persist();
    return nextVal;
  }

  public async resetUserLinkWarning(chatOrUserId: string | number, maybeUserId?: string | number): Promise<void> {
    await this.loadLatest(true);
    if (this.db.linkWarnings) {
      const key = maybeUserId !== undefined ? `${chatOrUserId}_${maybeUserId}` : String(chatOrUserId);
      delete this.db.linkWarnings[key];
      await this.persist();
    }
  }

  // --- Fraud & Keyword Rule Warnings ---
  public async getUserFraudWarnings(chatId: string | number, userId: string | number, ruleId?: string): Promise<number> {
    await this.loadLatest(false);
    const key = ruleId ? `${chatId}_${userId}_${ruleId}` : `${chatId}_${userId}`;
    return this.db.fraudWarnings?.[key] || 0;
  }

  public async incrementUserFraudWarning(chatId: string | number, userId: string | number, ruleId?: string): Promise<number> {
    await this.loadLatest(true);
    if (!this.db.fraudWarnings) {
      this.db.fraudWarnings = {};
    }
    const key = ruleId ? `${chatId}_${userId}_${ruleId}` : `${chatId}_${userId}`;
    const nextVal = (this.db.fraudWarnings[key] || 0) + 1;
    this.db.fraudWarnings[key] = nextVal;
    await this.persist();
    return nextVal;
  }

  public async resetUserFraudWarning(chatOrUserId: string | number, maybeUserId?: string | number, ruleId?: string): Promise<void> {
    await this.loadLatest(true);
    if (this.db.fraudWarnings) {
      if (maybeUserId !== undefined) {
        const key = ruleId ? `${chatOrUserId}_${maybeUserId}_${ruleId}` : `${chatOrUserId}_${maybeUserId}`;
        delete this.db.fraudWarnings[key];
        delete this.db.fraudWarnings[`${chatOrUserId}_${maybeUserId}`];
      } else {
        const target = String(chatOrUserId);
        for (const k of Object.keys(this.db.fraudWarnings)) {
          if (k.includes(target)) {
            delete this.db.fraudWarnings[k];
          }
        }
      }
      await this.persist();
    }
  }

  // --- User Lookup by ID or Username ---
  public async findUserByIdOrUsername(query: string): Promise<BotUserRecord | null> {
    await this.loadLatest(false);
    const clean = query.trim().replace(/^@+/, '').toLowerCase();
    if (!clean) return null;
    const users = Object.values(this.db.botUsers || {});
    const byId = users.find(u => String(u.id).trim() === clean || String(u.id).trim() === query.trim());
    if (byId) return byId;
    const byUsername = users.find(u => u.username && u.username.replace(/^@+/, '').toLowerCase() === clean);
    if (byUsername) return byUsername;
    const adminMatch = this.db.admins.find(a => 
      String(a.id).trim() === clean || 
      String(a.telegramId).trim() === clean || 
      (a.name && a.name.toLowerCase() === clean)
    );
    if (adminMatch) {
      return {
        id: adminMatch.telegramId || adminMatch.id,
        username: adminMatch.name.startsWith('@') ? adminMatch.name : undefined,
        firstName: adminMatch.name,
        firstSeenAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        interactionCount: 1,
        isAdmin: true
      };
    }
    return null;
  }

  public async setBotUserBanned(
    userId: string | number,
    isBanned: boolean,
    opts?: { chatId?: string; untilMs?: number; reason?: string; name?: string; username?: string }
  ): Promise<BotUserRecord | null> {
    if (!userId) return null;
    const cleanId = String(userId).trim();
    await this.loadLatest(true);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    if (isBanned) {
      const admins = await this.getAdmins();
      const settings = await this.getSettings();
      const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
      const isAdmin = cleanId === rootAdminId || rootAdminId.includes(cleanId) || admins.some(a => String(a.telegramId) === cleanId || String(a.id) === cleanId);
      if (isAdmin) {
        throw new Error('Administrators cannot be banned');
      }
    }

    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    const matchingKeys = Object.keys(this.db.botUsers).filter(k => {
      const u = this.db.botUsers![k];
      return k === cleanId || 
             k.replace(/^@+/, '').toLowerCase() === cleanUsername ||
             String(u.id).trim() === cleanId || 
             (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername);
    });

    const now = new Date().toISOString();
    const banUntilIso = isBanned && opts?.untilMs && opts.untilMs > Date.now()
      ? new Date(opts.untilMs).toISOString()
      : undefined;
    const formattedOptUsername = opts?.username
      ? `@${String(opts.username).replace(/^@+/, '').trim()}`
      : undefined;
    let user: BotUserRecord | null = null;

    if (matchingKeys.length === 0) {
      user = {
        id: cleanId,
        username: formattedOptUsername || (cleanId.startsWith('@') ? cleanId : undefined),
        firstName: opts?.name || undefined,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 0,
        isBanned: Boolean(isBanned),
        bannedAt: isBanned ? now : undefined,
        ...(banUntilIso ? { banUntil: banUntilIso } : {}),
        ...(isBanned && opts?.chatId ? { banChatId: String(opts.chatId) } : {}),
        ...(isBanned && opts?.reason ? { banReason: opts.reason } : {})
      };
      this.db.botUsers[cleanId] = user;
    } else {
      for (const k of matchingKeys) {
        const u = this.db.botUsers[k];
        if (!u.firstName && opts?.name) u.firstName = opts.name;
        if (!u.username && formattedOptUsername) u.username = formattedOptUsername;
        u.isBanned = Boolean(isBanned);
        if (isBanned) {
          u.bannedAt = now;
          if (banUntilIso) u.banUntil = banUntilIso;
          else delete u.banUntil;
          if (opts?.chatId) u.banChatId = String(opts.chatId);
          if (opts?.reason !== undefined) {
            if (opts.reason) u.banReason = opts.reason;
            else delete u.banReason;
          }
        } else {
          delete u.bannedAt;
          delete u.banUntil;
          delete u.banChatId;
          delete u.banReason;
          (u as any).bannedAt = undefined;
        }
        user = u;
      }
    }

    // When unbanned, completely clear any link warnings or fraud restrictions
    if (user && !isBanned) {
      delete user.bannedAt;
      delete user.banUntil;
      delete user.banChatId;
      delete user.banReason;
      (user as any).bannedAt = undefined;
      await this.resetUserLinkWarning(cleanId);
      await this.resetUserFraudWarning(cleanId);
      if (user.id) {
        await this.resetUserLinkWarning(user.id);
        await this.resetUserFraudWarning(user.id);
        if (this.db.botUsers[String(user.id).trim()]) {
          this.db.botUsers[String(user.id).trim()].isBanned = false;
          delete this.db.botUsers[String(user.id).trim()].bannedAt;
          delete this.db.botUsers[String(user.id).trim()].banUntil;
          delete this.db.botUsers[String(user.id).trim()].banChatId;
          delete this.db.botUsers[String(user.id).trim()].banReason;
          (this.db.botUsers[String(user.id).trim()] as any).bannedAt = undefined;
        }
      }
      if (user.username) {
        await this.resetUserLinkWarning(user.username);
        await this.resetUserFraudWarning(user.username);
      }
    }

    this.invalidateCache('users:');
    await this.persist();
    return user;
  }

  public async setBotUserMuted(
    userId: string | number,
    isMuted: boolean,
    opts?: { chatId?: string; untilMs?: number; reason?: string; name?: string; username?: string }
  ): Promise<BotUserRecord | null> {
    if (!userId) return null;
    const cleanId = String(userId).trim();
    await this.loadLatest(true);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    if (isMuted) {
      const admins = await this.getAdmins();
      const settings = await this.getSettings();
      const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
      const isAdmin = cleanId === rootAdminId || rootAdminId.includes(cleanId) || admins.some(a => String(a.telegramId) === cleanId || String(a.id) === cleanId);
      if (isAdmin) {
        throw new Error('Administrators cannot be muted');
      }
    }

    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    const matchingKeys = Object.keys(this.db.botUsers).filter(k => {
      const u = this.db.botUsers![k];
      return k === cleanId ||
             k.replace(/^@+/, '').toLowerCase() === cleanUsername ||
             String(u.id).trim() === cleanId ||
             (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername);
    });

    const now = new Date().toISOString();
    const muteUntilIso = isMuted && opts?.untilMs && opts.untilMs > Date.now()
      ? new Date(opts.untilMs).toISOString()
      : undefined;
    const formattedOptUsername = opts?.username
      ? `@${String(opts.username).replace(/^@+/, '').trim()}`
      : undefined;
    let user: BotUserRecord | null = null;

    if (matchingKeys.length === 0) {
      user = {
        id: cleanId,
        username: formattedOptUsername || (cleanId.startsWith('@') ? cleanId : undefined),
        firstName: opts?.name || undefined,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 0,
        isMuted: Boolean(isMuted),
        mutedAt: isMuted ? now : undefined,
        ...(muteUntilIso ? { muteUntil: muteUntilIso } : {}),
        ...(isMuted && opts?.chatId ? { muteChatId: String(opts.chatId) } : {}),
        ...(isMuted && opts?.reason ? { muteReason: opts.reason } : {})
      };
      this.db.botUsers[cleanId] = user;
    } else {
      for (const k of matchingKeys) {
        const u = this.db.botUsers[k];
        if (!u.firstName && opts?.name) u.firstName = opts.name;
        if (!u.username && formattedOptUsername) u.username = formattedOptUsername;
        u.isMuted = Boolean(isMuted);
        if (isMuted) {
          u.mutedAt = now;
          if (muteUntilIso) u.muteUntil = muteUntilIso;
          else delete u.muteUntil;
          if (opts?.chatId) u.muteChatId = String(opts.chatId);
          if (opts?.reason !== undefined) {
            if (opts.reason) u.muteReason = opts.reason;
            else delete u.muteReason;
          }
        } else {
          delete u.mutedAt;
          delete u.muteUntil;
          delete u.muteChatId;
          delete u.muteReason;
        }
        user = u;
      }
    }

    if (user && !isMuted && user.id && this.db.botUsers[String(user.id).trim()]) {
      const rec = this.db.botUsers[String(user.id).trim()];
      rec.isMuted = false;
      delete rec.mutedAt;
      delete rec.muteUntil;
      delete rec.muteChatId;
      delete rec.muteReason;
    }

    this.invalidateCache('users:');
    await this.persist();
    return user;
  }

  private pruneExpiredGroupModeration(chatId?: string): boolean {
    if (!this.db.groupModeration) return false;
    const now = Date.now();
    let changed = false;
    const targets = chatId
      ? (this.db.groupModeration[chatId] ? [this.db.groupModeration[chatId]] : [])
      : Object.values(this.db.groupModeration);

    for (const chatMap of targets) {
      if (!chatMap || typeof chatMap !== 'object') continue;
      for (const rec of Object.values(chatMap)) {
        if (!rec) continue;
        if (rec.isBanned && rec.banUntil) {
          const exp = new Date(rec.banUntil).getTime();
          if (Number.isFinite(exp) && now >= exp) {
            rec.isBanned = false;
            delete rec.bannedAt;
            delete rec.banUntil;
            delete rec.banReason;
            rec.unbannedAt = new Date(now).toISOString();
            changed = true;
          }
        }
        if (rec.isMuted && rec.muteUntil) {
          const exp = new Date(rec.muteUntil).getTime();
          if (Number.isFinite(exp) && now >= exp) {
            rec.isMuted = false;
            delete rec.mutedAt;
            delete rec.muteUntil;
            delete rec.muteReason;
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  public trackGroupMember(
    chatId: string | number,
    user: { id: string | number; username?: string; firstName?: string; lastName?: string }
  ): void {
    const cleanChatId = String(chatId || '').trim();
    const cleanUserId = String(user?.id || '').trim();
    if (!cleanChatId || !cleanUserId || !/^\d+$/.test(cleanUserId)) return;

    if (!this.db.groupModeration) this.db.groupModeration = {};
    if (!this.db.groupModeration[cleanChatId]) this.db.groupModeration[cleanChatId] = {};

    const now = new Date().toISOString();
    const existing = this.db.groupModeration[cleanChatId][cleanUserId];
    const cleanUsername = user.username ? `@${String(user.username).replace(/^@+/, '').trim()}` : undefined;

    if (!existing) {
      this.db.groupModeration[cleanChatId][cleanUserId] = {
        userId: cleanUserId,
        username: cleanUsername,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        lastSeenAt: now
      };
      this.persist().catch(() => {});
      return;
    }

    let profileChanged = false;
    if (cleanUsername && existing.username !== cleanUsername) {
      existing.username = cleanUsername;
      profileChanged = true;
    }
    if (user.firstName && existing.firstName !== user.firstName) {
      existing.firstName = user.firstName;
      profileChanged = true;
    }
    if (user.lastName && existing.lastName !== user.lastName) {
      existing.lastName = user.lastName;
      profileChanged = true;
    }
    const lastMs = existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    if (profileChanged || !lastMs || Date.now() - lastMs > 10 * 60 * 1000) {
      existing.lastSeenAt = now;
      this.persist().catch(() => {});
    }
  }

  public async setGroupMemberBanned(
    chatId: string | number,
    userId: string | number,
    isBanned: boolean,
    opts?: { untilMs?: number; reason?: string; name?: string; username?: string }
  ): Promise<GroupMemberModerationState | null> {
    const cleanChatId = String(chatId || '').trim();
    const cleanUserId = String(userId || '').trim();
    if (!cleanChatId || !cleanUserId) return null;

    await this.loadLatest(true);
    if (!this.db.groupModeration) this.db.groupModeration = {};
    if (!this.db.groupModeration[cleanChatId]) this.db.groupModeration[cleanChatId] = {};

    const now = new Date().toISOString();
    const banUntilIso = isBanned && opts?.untilMs && opts.untilMs > Date.now()
      ? new Date(opts.untilMs).toISOString()
      : undefined;
    const cleanUsername = opts?.username ? `@${String(opts.username).replace(/^@+/, '').trim()}` : undefined;

    const existing = this.db.groupModeration[cleanChatId][cleanUserId] || {
      userId: cleanUserId,
      lastSeenAt: now
    };
    if (opts?.name && !existing.firstName) existing.firstName = opts.name;
    if (cleanUsername && !existing.username) existing.username = cleanUsername;

    existing.isBanned = Boolean(isBanned);
    if (isBanned) {
      existing.bannedAt = now;
      delete existing.unbannedAt;
      if (banUntilIso) existing.banUntil = banUntilIso;
      else delete existing.banUntil;
      if (opts?.reason !== undefined) {
        if (opts.reason) existing.banReason = opts.reason;
        else delete existing.banReason;
      }
    } else {
      delete existing.bannedAt;
      delete existing.banUntil;
      delete existing.banReason;
      existing.unbannedAt = now;
    }

    this.db.groupModeration[cleanChatId][cleanUserId] = existing;
    await this.persist();
    return existing;
  }

  public async setGroupMemberMuted(
    chatId: string | number,
    userId: string | number,
    isMuted: boolean,
    opts?: { untilMs?: number; reason?: string; name?: string; username?: string }
  ): Promise<GroupMemberModerationState | null> {
    const cleanChatId = String(chatId || '').trim();
    const cleanUserId = String(userId || '').trim();
    if (!cleanChatId || !cleanUserId) return null;

    await this.loadLatest(true);
    if (!this.db.groupModeration) this.db.groupModeration = {};
    if (!this.db.groupModeration[cleanChatId]) this.db.groupModeration[cleanChatId] = {};

    const now = new Date().toISOString();
    const muteUntilIso = isMuted && opts?.untilMs && opts.untilMs > Date.now()
      ? new Date(opts.untilMs).toISOString()
      : undefined;
    const cleanUsername = opts?.username ? `@${String(opts.username).replace(/^@+/, '').trim()}` : undefined;

    const existing = this.db.groupModeration[cleanChatId][cleanUserId] || {
      userId: cleanUserId,
      lastSeenAt: now
    };
    if (opts?.name && !existing.firstName) existing.firstName = opts.name;
    if (cleanUsername && !existing.username) existing.username = cleanUsername;

    existing.isMuted = Boolean(isMuted);
    if (isMuted) {
      existing.mutedAt = now;
      if (muteUntilIso) existing.muteUntil = muteUntilIso;
      else delete existing.muteUntil;
      if (opts?.reason !== undefined) {
        if (opts.reason) existing.muteReason = opts.reason;
        else delete existing.muteReason;
      }
    } else {
      delete existing.mutedAt;
      delete existing.muteUntil;
      delete existing.muteReason;
    }

    this.db.groupModeration[cleanChatId][cleanUserId] = existing;
    await this.persist();
    return existing;
  }

  public async getGroupMemberModeration(
    chatId: string | number,
    userId: string | number
  ): Promise<GroupMemberModerationState | null> {
    const cleanChatId = String(chatId || '').trim();
    const cleanUserId = String(userId || '').trim();
    if (!cleanChatId || !cleanUserId) return null;
    await this.loadLatest(false);
    if (this.pruneExpiredGroupModeration(cleanChatId)) {
      this.persist().catch(() => {});
    }
    return this.db.groupModeration?.[cleanChatId]?.[cleanUserId] || null;
  }

  public async getGroupModerationSummary(chatId: string | number): Promise<{
    trackedTotal: number;
    bannedUsers: GroupMemberModerationState[];
    mutedUsers: GroupMemberModerationState[];
    unbannedCount: number;
  }> {
    const cleanChatId = String(chatId || '').trim();
    await this.loadLatest(false);
    if (cleanChatId && this.pruneExpiredGroupModeration(cleanChatId)) {
      this.persist().catch(() => {});
    }
    const members = Object.values((cleanChatId && this.db.groupModeration?.[cleanChatId]) || {});
    const bannedUsers = members
      .filter((m) => Boolean(m && m.isBanned))
      .sort((a, b) => new Date(b.bannedAt || b.lastSeenAt || 0).getTime() - new Date(a.bannedAt || a.lastSeenAt || 0).getTime());
    const mutedUsers = members
      .filter((m) => Boolean(m && m.isMuted))
      .sort((a, b) => new Date(b.mutedAt || b.lastSeenAt || 0).getTime() - new Date(a.mutedAt || a.lastSeenAt || 0).getTime());
    const unbannedCount = members.filter((m) => Boolean(m) && !m.isBanned).length;

    return {
      trackedTotal: members.length,
      bannedUsers,
      mutedUsers,
      unbannedCount
    };
  }

  public hasActiveBanInAnyGroup(userId: string | number): boolean {
    const cleanUserId = String(userId || '').trim();
    if (!cleanUserId || !this.db.groupModeration) return false;
    this.pruneExpiredGroupModeration();
    for (const chatMap of Object.values(this.db.groupModeration)) {
      const rec = chatMap?.[cleanUserId];
      if (rec?.isBanned) return true;
    }
    return false;
  }

  public async setBotUserAdmin(userId: string | number, isAdmin: boolean): Promise<BotUserRecord | null> {
    if (!userId) return null;
    const cleanId = String(userId).trim();
    const cleanUsername = cleanId.replace(/^@+/, '').toLowerCase();
    await this.loadLatest(true);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    const matchingKeys = Object.keys(this.db.botUsers).filter(k => {
      const u = this.db.botUsers![k];
      return k === cleanId ||
        k.replace(/^@+/, '').toLowerCase() === cleanUsername ||
        String(u.id).trim() === cleanId ||
        (u.username && u.username.replace(/^@+/, '').toLowerCase() === cleanUsername);
    });

    if (matchingKeys.length === 0) {
      return null;
    }

    let updatedUser: BotUserRecord | null = null;
    for (const k of matchingKeys) {
      this.db.botUsers[k].isAdmin = Boolean(isAdmin);
      updatedUser = this.db.botUsers[k];
    }

    await this.persist();
    return updatedUser;
  }

  // =========================================================================
  // BACKUP SERVER & LIVE MIRROR REPLICATION SYSTEM
  // =========================================================================
  private replicationDebounceTimer: any = null;

  public scheduleSilentReplication(): void {
    if (this.replicationDebounceTimer) {
      clearTimeout(this.replicationDebounceTimer);
    }
    this.replicationDebounceTimer = setTimeout(() => {
      this.replicateToBackupServer().catch(err => {
        console.warn('[BackupServer] Auto-replication notice:', err?.message || err);
      });
    }, 2500);
  }

  public async getBackupConfig(): Promise<BackupServerConfig> {
    await this.loadLatest(false);
    return this.db.backupServer || { ...DEFAULT_BACKUP_SERVER_CONFIG };
  }

  public async updateBackupConfig(partial: Partial<BackupServerConfig>): Promise<BackupServerConfig> {
    await this.loadLatest(true);
    this.db.backupServer = {
      ...(this.db.backupServer || DEFAULT_BACKUP_SERVER_CONFIG),
      ...partial
    };
    await this.persist();
    return this.db.backupServer;
  }

  public async getFullSnapshot(includeFiles = true): Promise<any> {
    await this.loadLatest(false);
    const snapshot: any = JSON.parse(JSON.stringify(this.db));

    if (includeFiles && this.db.uploadedFilesIndex) {
      for (const [id, meta] of Object.entries(this.db.uploadedFilesIndex)) {
        if (!meta.base64) {
          try {
            const rec = await this.getUploadedFile(id);
            if (rec && rec.buffer) {
              snapshot.uploadedFilesIndex[id].base64 = rec.buffer.toString('base64');
            }
          } catch {}
        }
      }
    }

    return snapshot;
  }

  public async restoreFromSnapshot(snapshot: any): Promise<{ restoredCounts: any }> {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Invalid snapshot payload');
    }

    await this.loadLatest(true);

    if (Array.isArray(snapshot.items)) this.db.items = snapshot.items;
    if (snapshot.templates && typeof snapshot.templates === 'object') this.db.templates = { ...DEFAULT_TEMPLATES, ...snapshot.templates };
    if (Array.isArray(snapshot.admins) && snapshot.admins.length > 0) this.db.admins = snapshot.admins;
    if (snapshot.design) this.db.design = { ...DEFAULT_DESIGN, ...snapshot.design };
    if (snapshot.settings) this.db.settings = { ...DEFAULT_SETTINGS, ...snapshot.settings };
    if (snapshot.botUsers) this.db.botUsers = { ...(this.db.botUsers || {}), ...snapshot.botUsers };
    if (Array.isArray(snapshot.reports)) this.db.reports = snapshot.reports;
    if (Array.isArray(snapshot.fraudRules)) this.db.fraudRules = snapshot.fraudRules;
    if (Array.isArray(snapshot.detectedChannels)) this.db.detectedChannels = snapshot.detectedChannels;

    let fileCount = 0;
    if (snapshot.uploadedFilesIndex && typeof snapshot.uploadedFilesIndex === 'object') {
      if (!this.db.uploadedFilesIndex) this.db.uploadedFilesIndex = {};
      for (const [fileId, fileData] of Object.entries(snapshot.uploadedFilesIndex as Record<string, any>)) {
        this.db.uploadedFilesIndex[fileId] = {
          id: fileData.id || fileId,
          fileName: fileData.fileName || 'file',
          fileType: fileData.fileType || 'document',
          mimeType: fileData.mimeType || 'application/octet-stream',
          size: fileData.size || 0,
          createdAt: fileData.createdAt || new Date().toISOString()
        };

        if (fileData.base64) {
          try {
            const buffer = Buffer.from(fileData.base64, 'base64');
            await this.saveUploadedFile(fileId, {
              buffer,
              fileName: fileData.fileName || 'file',
              fileType: fileData.fileType,
              mimeType: fileData.mimeType
            });
            fileCount++;
          } catch {}
        }
      }
    }

    const counts = {
      itemsCount: this.db.items.length,
      usersCount: Object.keys(this.db.botUsers || {}).length,
      filesCount: Object.keys(this.db.uploadedFilesIndex || {}).length,
      reportsCount: (this.db.reports || []).length,
      rulesCount: (this.db.fraudRules || []).length,
      restoredFilesWithBinary: fileCount
    };

    if (this.db.backupServer) {
      this.db.backupServer.lastSyncAt = new Date().toISOString();
      this.db.backupServer.lastSyncStatus = 'success';
      this.db.backupServer.lastSyncMessage = `Snapshot mirrored: ${counts.itemsCount} items, ${counts.filesCount} files, ${counts.usersCount} users.`;
      this.db.backupServer.mirroredStats = {
        ...counts,
        templatesCount: Object.keys(this.db.templates || {}).length,
        lastSyncedAt: new Date().toISOString()
      };
    }

    this.rebuildCache();
    this.invalidateCache();
    await this.persist();
    return { restoredCounts: counts };
  }

  public async replicateToBackupServer(targetUrl?: string, customSecretKey?: string): Promise<{ success: boolean; message: string; stats?: any }> {
    await this.loadLatest(false);
    const config = this.db.backupServer || DEFAULT_BACKUP_SERVER_CONFIG;
    const url = (targetUrl || config.serverUrl || '').trim().replace(/\/+$/, '');
    const secret = customSecretKey || config.secretKey;

    if (!url) {
      throw new Error('Designated backup server URL is not configured');
    }

    const snapshot = await this.getFullSnapshot(true);
    const stats = {
      itemsCount: snapshot.items?.length || 0,
      usersCount: Object.keys(snapshot.botUsers || {}).length,
      filesCount: Object.keys(snapshot.uploadedFilesIndex || {}).length,
      reportsCount: snapshot.reports?.length || 0,
      rulesCount: snapshot.fraudRules?.length || 0,
      templatesCount: Object.keys(snapshot.templates || {}).length,
      lastSyncedAt: new Date().toISOString()
    };

    config.lastSyncStatus = 'in_progress';
    config.lastSyncMessage = 'Syncing full database and file mirrors to backup server...';

    try {
      const endpoint = `${url}/api/backup-server/receive-mirror`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-replication-token': secret
        },
        body: JSON.stringify({
          source: 'primary',
          timestamp: stats.lastSyncedAt,
          stats,
          snapshot
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Backup server returned HTTP ${response.status}: ${errText.slice(0, 120)}`);
      }

      config.lastSyncStatus = 'success';
      config.lastSyncAt = stats.lastSyncedAt;
      config.lastSyncMessage = `Live mirror sync successful: ${stats.itemsCount} items, ${stats.filesCount} files, ${stats.usersCount} users.`;
      config.mirroredStats = stats;
      await this.persist();

      return {
        success: true,
        message: config.lastSyncMessage,
        stats
      };
    } catch (err: any) {
      config.lastSyncStatus = 'failed';
      config.lastSyncMessage = `Sync failed: ${err.message || 'Connection timeout or network failure'}`;
      await this.persist();
      throw err;
    }
  }

  // =========================================================================
  // LOCAL VPS PROCESS LEADER LOCKS & UPDATE DEDUPLICATION
  // =========================================================================

  public static hashToken(botToken: string): string {
    return crypto.createHash('sha256').update(String(botToken || '').trim()).digest('hex').slice(0, 20);
  }

  private getLocksDir(): string {
    const dir = path.join(resolveVpsDataDir(), '.locks');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {}
    return dir;
  }

  private static isLocalPidAlive(pid: number): boolean {
    if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err?.code === 'EPERM';
    }
  }

  // Local VPS Token Lock keyed by SHA-256 token hash
  public async tryClaimTokenLock(
    botToken: string,
    metadata: { instanceId: string; host: string; pid: number; botId: string; env: string; isPrimary?: boolean },
    ttlMs: number = 22000,
    options?: { forceReset?: boolean; isStartupBoot?: boolean }
  ): Promise<{
    acquired: boolean;
    overwrote?: { instanceId: string; env?: string; host?: string; botId?: string };
    conflict?: { instanceId: string; host: string; pid: number; botId: string; env: string; isPrimary?: boolean; heartbeat: number };
  }> {
    if (!botToken || !botToken.trim()) {
      return { acquired: false };
    }
    const tokenHash = SharedStorageService.hashToken(botToken);
    try {
      const lockPath = path.join(this.getLocksDir(), `token_${tokenHash}.json`);
      const now = Date.now();
      let existing: any = null;
      if (fs.existsSync(lockPath)) {
        try {
          existing = JSON.parse(await fs.promises.readFile(lockPath, 'utf-8'));
        } catch {
          existing = null;
        }
      }

      const isDifferentAliveInstance = Boolean(
        existing &&
        existing.instanceId &&
        existing.instanceId !== metadata.instanceId &&
        SharedStorageService.isLocalPidAlive(Number(existing.pid || 0)) &&
        (now - Number(existing.heartbeat || 0)) < ttlMs
      );

      if (isDifferentAliveInstance && !options?.forceReset) {
        return { acquired: false, conflict: existing };
      }

      const overwrote =
        isDifferentAliveInstance && options?.forceReset
          ? {
              instanceId: String(existing.instanceId || ''),
              env: existing.env,
              host: existing.host,
              botId: existing.botId
            }
          : undefined;

      const claimPayload = {
        ...metadata,
        tokenHash,
        heartbeat: now,
        updatedAt: new Date().toISOString()
      };

      await fs.promises.writeFile(lockPath, JSON.stringify(claimPayload), 'utf-8');
      return { acquired: true, overwrote };
    } catch {
      return { acquired: true };
    }
  }

  public async releaseTokenLock(botToken: string, instanceId: string): Promise<void> {
    if (!botToken || !botToken.trim()) return;
    const tokenHash = SharedStorageService.hashToken(botToken);
    try {
      const lockPath = path.join(this.getLocksDir(), `token_${tokenHash}.json`);
      if (fs.existsSync(lockPath)) {
        const raw = await fs.promises.readFile(lockPath, 'utf-8');
        const existing = JSON.parse(raw);
        if (existing?.instanceId === instanceId) {
          await fs.promises.unlink(lockPath).catch(() => {});
        }
      }
    } catch {}
  }

  // Local VPS Leader Lock for Telegram Polling
  public async tryClaimPollingLeader(
    instanceId: string,
    ttlMs: number = 10000,
    options?: { forceReset?: boolean; isPrimary?: boolean }
  ): Promise<{ isLeader: boolean; currentLeader: string }> {
    try {
      const leaderPath = path.join(this.getLocksDir(), 'polling_leader.json');
      const now = Date.now();
      let leader: any = null;
      if (fs.existsSync(leaderPath)) {
        try {
          leader = JSON.parse(await fs.promises.readFile(leaderPath, 'utf-8'));
        } catch {
          leader = null;
        }
      }

      const hasActiveOtherLeader = Boolean(
        !options?.forceReset &&
        leader &&
        leader.instanceId &&
        leader.instanceId !== instanceId &&
        SharedStorageService.isLocalPidAlive(Number(leader.pid || 0)) &&
        (now - Number(leader.heartbeat || 0)) < ttlMs
      );

      if (hasActiveOtherLeader) {
        return { isLeader: false, currentLeader: leader.instanceId };
      }

      const claimPayload = {
        instanceId,
        pid: process.pid,
        isPrimary: Boolean(options?.isPrimary),
        heartbeat: now,
        updatedAt: new Date().toISOString()
      };

      await fs.promises.writeFile(leaderPath, JSON.stringify(claimPayload), 'utf-8');
      return { isLeader: true, currentLeader: instanceId };
    } catch {
      return { isLeader: true, currentLeader: instanceId };
    }
  }

  public async renewPollingLeaderHeartbeat(instanceId: string): Promise<boolean> {
    try {
      const leaderPath = path.join(this.getLocksDir(), 'polling_leader.json');
      const payload = {
        instanceId,
        pid: process.pid,
        heartbeat: Date.now(),
        updatedAt: new Date().toISOString()
      };
      await fs.promises.writeFile(leaderPath, JSON.stringify(payload), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  public async releasePollingLeader(instanceId: string): Promise<void> {
    try {
      const leaderPath = path.join(this.getLocksDir(), 'polling_leader.json');
      if (fs.existsSync(leaderPath)) {
        const leader = JSON.parse(await fs.promises.readFile(leaderPath, 'utf-8'));
        if (leader?.instanceId === instanceId) {
          await fs.promises.unlink(leaderPath).catch(() => {});
        }
      }
    } catch {}
  }

  // Fast in-memory update deduplication claim across concurrent handlers
  public async claimDistributedTelegramUpdate(updateKey: string, _instanceId: string, ttlMs: number = 90000): Promise<boolean> {
    if (!updateKey) return true;
    const now = Date.now();
    const existingTs = SharedStorageService.claimedUpdatesMemory.get(updateKey);
    if (existingTs && (now - existingTs) < ttlMs) {
      return false;
    }
    SharedStorageService.claimedUpdatesMemory.set(updateKey, now);
    if (SharedStorageService.claimedUpdatesMemory.size > 5000) {
      for (const [k, ts] of SharedStorageService.claimedUpdatesMemory.entries()) {
        if (now - ts >= ttlMs) {
          SharedStorageService.claimedUpdatesMemory.delete(k);
        }
      }
    }
    return true;
  }

  // =========================================================================
  // CLONED BOTS REGISTRY & PERSISTENCE
  // =========================================================================
  private static deletedClonedBotIds = new Set<string>();

  public static markClonedBotDeleted(id: string): void {
    const clean = String(id || '').trim();
    if (!clean) return;
    const stripped = clean.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    this.deletedClonedBotIds.add(clean);
    if (stripped) {
      this.deletedClonedBotIds.add(stripped);
      this.deletedClonedBotIds.add(`clone_${stripped}`);
    }
  }

  public static unmarkClonedBotDeleted(id: string): void {
    const clean = String(id || '').trim();
    if (!clean) return;
    const stripped = clean.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    this.deletedClonedBotIds.delete(clean);
    if (stripped) {
      this.deletedClonedBotIds.delete(stripped);
      this.deletedClonedBotIds.delete(`clone_${stripped}`);
    }
  }

  public static isClonedBotDeleted(id: string): boolean {
    const clean = String(id || '').trim();
    if (!clean) return false;
    const stripped = clean.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    return this.deletedClonedBotIds.has(clean) || (stripped ? this.deletedClonedBotIds.has(stripped) : false);
  }

  public async getClonedBots(): Promise<ClonedBotRecord[]> {
    await this.loadLatest(false);
    return Array.isArray(this.db.clonedBots)
      ? this.db.clonedBots.filter(b => b && b.id && !SharedStorageService.isClonedBotDeleted(b.id))
      : [];
  }

  public async saveClonedBot(cloned: ClonedBotRecord): Promise<void> {
    if (!cloned || !cloned.id) return;
    SharedStorageService.unmarkClonedBotDeleted(cloned.id);
    await this.loadLatest(false);
    if (!Array.isArray(this.db.clonedBots)) {
      this.db.clonedBots = [];
    }
    const idx = this.db.clonedBots.findIndex(b => b.id === cloned.id);
    if (idx >= 0) {
      this.db.clonedBots[idx] = { ...this.db.clonedBots[idx], ...cloned };
    } else {
      this.db.clonedBots.push(cloned);
    }

    await this.persist(true);
  }

  public async deleteClonedBot(id: string): Promise<boolean> {
    if (!id) return false;
    const cleanId = String(id).trim();
    const stripped = cleanId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    const candidateIds = Array.from(new Set([cleanId, stripped, stripped ? `clone_${stripped}` : ''].filter(Boolean)));

    for (const cid of candidateIds) {
      SharedStorageService.markClonedBotDeleted(cid);
    }

    await this.loadLatest(false);
    const prevLen = Array.isArray(this.db.clonedBots) ? this.db.clonedBots.length : 0;
    if (Array.isArray(this.db.clonedBots)) {
      this.db.clonedBots = this.db.clonedBots.filter(b => {
        const bClean = String(b.id || '').trim();
        const bStripped = bClean.replace(/^clone_/i, '').replace(/[:_-]/g, '');
        return !candidateIds.includes(bClean) && !candidateIds.includes(bStripped);
      });
    }
    const removedLocally = Array.isArray(this.db.clonedBots) ? this.db.clonedBots.length !== prevLen : false;

    await this.persist(true);
    return removedLocally || candidateIds.length > 0;
  }

  // =========================================================================
  // KEY POOL BATCH STORAGE & SEQUENTIAL ONE-BY-ONE CLAIMING
  // =========================================================================

  private static normalizeKeyLines(rawLines: string[]): string[] {
    return (Array.isArray(rawLines) ? rawLines : [])
      .map((line) => String(line ?? '').trim())
      .filter((line) => line.length > 0);
  }

  public static normalizeGeneratorConfig(raw?: Partial<KeyGeneratorConfig> | null): KeyGeneratorConfig {
    const prefix = String(raw?.prefix ?? '').trim().slice(0, 32);
    const parsedLength = Math.round(Number(raw?.length) || 12);
    const length = Math.max(4, Math.min(64, Number.isFinite(parsedLength) ? parsedLength : 12));
    const rawType = String(raw?.charType ?? 'alphanumeric').trim().toLowerCase();
    const charType: KeyGeneratorCharType =
      rawType === 'numbers' || rawType === 'numeric' || rawType === 'digits'
        ? 'numbers'
        : rawType === 'letters_upper' || rawType === 'letters' || rawType === 'alpha' || rawType === 'uppercase'
        ? 'letters_upper'
        : rawType === 'letters_mixed' || rawType === 'mixed_letters'
        ? 'letters_mixed'
        : 'alphanumeric';
    return { prefix, length, charType };
  }

  private static generateRandomKeyBody(length: number, charType: KeyGeneratorCharType): string {
    const alphabets: Record<KeyGeneratorCharType, string> = {
      numbers: '0123456789',
      letters_upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      letters_mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    };
    const chars = alphabets[charType] || alphabets.alphanumeric;
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[crypto.randomInt(0, chars.length)];
    }
    return out;
  }

  private static generateUniqueKeyForPool(pool: KeyPoolRecord): string {
    const cfg = SharedStorageService.normalizeGeneratorConfig(pool.generatorConfig);
    const existingSet = new Set((pool.keys || []).map((k) => k.value));
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = `${cfg.prefix}${SharedStorageService.generateRandomKeyBody(cfg.length, cfg.charType)}`;
      if (!existingSet.has(candidate)) {
        return candidate;
      }
    }
    const extraSuffix = SharedStorageService.generateRandomKeyBody(4, cfg.charType);
    return `${cfg.prefix}${SharedStorageService.generateRandomKeyBody(cfg.length, cfg.charType)}${extraSuffix}`;
  }

  public static readonly EXPIRED_KEY_POOL_GRACE_MS = 30 * 1000;

  public checkAndCleanExpiredKeyPoolsSync(
    graceMs: number = SharedStorageService.EXPIRED_KEY_POOL_GRACE_MS
  ): string[] {
    if (!Array.isArray(this.db.keyPools) || this.db.keyPools.length === 0) {
      return [];
    }
    const now = Date.now();
    const removedIds: string[] = [];
    const remaining: KeyPoolRecord[] = [];

    for (const pool of this.db.keyPools) {
      if (pool && pool.expiresAt) {
        const expTs = Date.parse(pool.expiresAt);
        if (Number.isFinite(expTs) && now >= expTs + Math.max(0, graceMs)) {
          removedIds.push(pool.id);
          console.info(
            `[Storage (${this.botId})] Expired key link "${pool.title}" (${pool.id}) passed grace period. Auto-deleted.`
          );
          continue;
        }
      }
      if (pool) {
        remaining.push(pool);
      }
    }

    if (removedIds.length > 0) {
      this.db.keyPools = remaining;
      this.persist(false).catch(() => {});
    }
    return removedIds;
  }

  public async checkAndCleanExpiredKeyPools(
    graceMs: number = SharedStorageService.EXPIRED_KEY_POOL_GRACE_MS
  ): Promise<string[]> {
    await this.loadLatest(false);
    return this.checkAndCleanExpiredKeyPoolsSync(graceMs);
  }

  private static normalizeKeyPoolMode(rawMode?: string | null): KeyPoolMode {
    if (rawMode === 'generator') return 'generator';
    if (rawMode === 'shared') return 'shared';
    return 'pool';
  }

  public async getKeyPools(): Promise<KeyPoolRecord[]> {
    await this.loadLatest(false);
    this.checkAndCleanExpiredKeyPoolsSync();
    const list = Array.isArray(this.db.keyPools) ? this.db.keyPools : [];
    return [...list]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((pool) => {
        const mode = SharedStorageService.normalizeKeyPoolMode(pool.mode);
        return {
          ...pool,
          mode,
          generatorConfig: mode === 'generator' && pool.generatorConfig
            ? SharedStorageService.normalizeGeneratorConfig(pool.generatorConfig)
            : null,
          ...(mode === 'shared' ? { sharedText: String(pool.sharedText ?? '') } : {}),
          keys: Array.isArray(pool.keys) ? pool.keys.map((k) => ({ ...k })) : []
        };
      });
  }

  public async getKeyPool(id: string): Promise<KeyPoolRecord | null> {
    await this.loadLatest(false);
    this.checkAndCleanExpiredKeyPoolsSync();
    const cleanId = String(id || '').trim();
    if (!cleanId || !Array.isArray(this.db.keyPools)) return null;
    const found = this.db.keyPools.find((p) => p.id === cleanId);
    if (!found) return null;
    const mode = SharedStorageService.normalizeKeyPoolMode(found.mode);
    return {
      ...found,
      mode,
      generatorConfig: mode === 'generator' && found.generatorConfig
        ? SharedStorageService.normalizeGeneratorConfig(found.generatorConfig)
        : null,
      ...(mode === 'shared' ? { sharedText: String(found.sharedText ?? '') } : {}),
      keys: Array.isArray(found.keys) ? found.keys.map((k) => ({ ...k })) : []
    };
  }

  public async createKeyPool(input: {
    mode?: KeyPoolMode;
    generatorConfig?: Partial<KeyGeneratorConfig> | null;
    sharedText?: string;
    title?: string;
    keyLines?: string[];
    expiresAt?: string | null;
    createdBy?: string;
    status?: 'active' | 'disabled';
  }): Promise<KeyPoolRecord> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.keyPools)) {
      this.db.keyPools = [];
    }

    const mode: KeyPoolMode = SharedStorageService.normalizeKeyPoolMode(input.mode);
    const generatorConfig = mode === 'generator'
      ? SharedStorageService.normalizeGeneratorConfig(input.generatorConfig)
      : null;
    const cleanSharedText = mode === 'shared' ? String(input.sharedText ?? '').trim() : undefined;

    const lines = mode === 'pool' ? SharedStorageService.normalizeKeyLines(input.keyLines || []) : [];
    const nowIso = new Date().toISOString();

    let id = '';
    do {
      const rand = Math.random().toString(36).substring(2, 7);
      const timePart = Date.now().toString(36).slice(-4);
      id = `${rand}${timePart}`;
    } while (this.db.keyPools.some((p) => p.id === id));

    const keys: KeyPoolEntry[] = lines.map((val, idx) => ({
      id: `${id}_${idx}_${Math.random().toString(36).substring(2, 5)}`,
      value: val,
      index: idx
    }));

    let parsedExpiresAt: string | null = null;
    if (input.expiresAt) {
      const ts = Date.parse(String(input.expiresAt));
      if (Number.isFinite(ts)) {
        parsedExpiresAt = new Date(ts).toISOString();
      }
    }

    const sharedFirstLine = (cleanSharedText || '').split(/\r?\n/)[0]?.trim() || 'Text';
    const defaultTitle =
      mode === 'generator' && generatorConfig
        ? `Key Generator (${generatorConfig.prefix ? `${generatorConfig.prefix} · ` : ''}${generatorConfig.length} chars)`
        : mode === 'shared'
        ? `Text (${sharedFirstLine.slice(0, 24)}${sharedFirstLine.length > 24 ? '…' : ''})`
        : `Key Batch (${keys.length} ${keys.length === 1 ? 'Key' : 'Keys'})`;
    const cleanTitle = (input.title || '').trim() || defaultTitle;

    const record: KeyPoolRecord = {
      id,
      mode,
      generatorConfig,
      ...(mode === 'shared' ? { sharedText: cleanSharedText } : {}),
      title: cleanTitle,
      keys,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: input.createdBy ? String(input.createdBy).trim() : undefined,
      expiresAt: parsedExpiresAt,
      status: input.status === 'disabled' ? 'disabled' : 'active',
      totalClaims: 0
    };

    this.db.keyPools.unshift(record);
    await this.persist(true);
    return {
      ...record,
      keys: record.keys.map((k) => ({ ...k }))
    };
  }

  public async updateKeyPool(
    id: string,
    updates: {
      title?: string;
      keyLines?: string[];
      addKeyLines?: string[];
      generatorConfig?: Partial<KeyGeneratorConfig> | null;
      sharedText?: string;
      expiresAt?: string | null;
      status?: 'active' | 'disabled';
      resetClaims?: boolean;
    }
  ): Promise<KeyPoolRecord | null> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.keyPools)) return null;
    const idx = this.db.keyPools.findIndex((p) => p.id === String(id || '').trim());
    if (idx < 0) return null;

    const existing = this.db.keyPools[idx];
    const effectiveMode: KeyPoolMode = SharedStorageService.normalizeKeyPoolMode(existing.mode);
    const nowIso = new Date().toISOString();

    if (updates.title !== undefined) {
      const t = String(updates.title).trim();
      if (t) existing.title = t;
    }

    if (updates.status === 'active' || updates.status === 'disabled') {
      existing.status = updates.status;
    }

    if (updates.expiresAt !== undefined) {
      if (updates.expiresAt === null || updates.expiresAt === '') {
        existing.expiresAt = null;
      } else {
        const ts = Date.parse(String(updates.expiresAt));
        if (Number.isFinite(ts)) {
          existing.expiresAt = new Date(ts).toISOString();
        }
      }
    }

    if (effectiveMode === 'generator') {
      if (updates.generatorConfig) {
        existing.generatorConfig = SharedStorageService.normalizeGeneratorConfig({
          ...(existing.generatorConfig || {}),
          ...updates.generatorConfig
        });
      }
      if (updates.resetClaims) {
        existing.keys = [];
        existing.totalClaims = 0;
      }
    } else if (effectiveMode === 'shared') {
      if (updates.sharedText !== undefined) {
        const trimmed = String(updates.sharedText).trim();
        if (trimmed) {
          existing.sharedText = trimmed;
        }
      }
      if (updates.resetClaims) {
        existing.keys = [];
        existing.totalClaims = 0;
      }
    } else {
      if (Array.isArray(updates.keyLines)) {
        const nextLines = SharedStorageService.normalizeKeyLines(updates.keyLines);
        const claimedPool = updates.resetClaims
          ? []
          : (Array.isArray(existing.keys) ? existing.keys.filter((k) => Boolean(k.claimedBy)) : []);
        const usedClaimIds = new Set<string>();

        existing.keys = nextLines.map((val, newIdx) => {
          const matchedClaim = claimedPool.find((c) => !usedClaimIds.has(c.id) && c.value === val);
          if (matchedClaim) {
            usedClaimIds.add(matchedClaim.id);
            return {
              ...matchedClaim,
              index: newIdx
            };
          }
          return {
            id: `${existing.id}_${newIdx}_${Math.random().toString(36).substring(2, 5)}`,
            value: val,
            index: newIdx
          };
        });
      } else if (updates.resetClaims && Array.isArray(existing.keys)) {
        existing.keys = existing.keys.map((k, newIdx) => ({
          id: k.id,
          value: k.value,
          index: newIdx
        }));
        existing.totalClaims = 0;
      }

      if (Array.isArray(updates.addKeyLines) && updates.addKeyLines.length > 0) {
        const appendLines = SharedStorageService.normalizeKeyLines(updates.addKeyLines);
        const baseIndex = Array.isArray(existing.keys) ? existing.keys.length : 0;
        const newEntries: KeyPoolEntry[] = appendLines.map((val, offset) => ({
          id: `${existing.id}_${baseIndex + offset}_${Math.random().toString(36).substring(2, 5)}`,
          value: val,
          index: baseIndex + offset
        }));
        existing.keys = [...(existing.keys || []), ...newEntries];
      }
    }

    existing.updatedAt = nowIso;
    await this.persist(true);
    return {
      ...existing,
      mode: effectiveMode,
      generatorConfig: existing.generatorConfig ? SharedStorageService.normalizeGeneratorConfig(existing.generatorConfig) : null,
      ...(effectiveMode === 'shared' ? { sharedText: String(existing.sharedText ?? '') } : {}),
      keys: (existing.keys || []).map((k) => ({ ...k }))
    };
  }

  public async deleteKeyPool(id: string): Promise<boolean> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.keyPools)) return false;
    const cleanId = String(id || '').trim();
    const prevLen = this.db.keyPools.length;
    this.db.keyPools = this.db.keyPools.filter((p) => p.id !== cleanId);
    if (this.db.keyPools.length === prevLen) return false;
    await this.persist(true);
    return true;
  }

  public async claimNextKeyFromPool(
    poolId: string,
    userId: string,
    username?: string
  ): Promise<{
    status: 'claimed' | 'already_claimed' | 'sold_out' | 'expired' | 'disabled' | 'not_found';
    key?: KeyPoolEntry;
    pool?: KeyPoolRecord;
    remainingCount?: number;
    totalCount?: number;
  }> {
    await this.loadLatest(false);
    this.checkAndCleanExpiredKeyPoolsSync();
    const cleanPoolId = String(poolId || '').trim();
    const cleanUserId = String(userId || '').trim();
    const cleanUsername = username ? String(username).replace(/^@/, '').trim() : undefined;

    if (!cleanPoolId || !Array.isArray(this.db.keyPools)) {
      return { status: 'not_found' };
    }

    const pool = this.db.keyPools.find((p) => p.id === cleanPoolId);
    if (!pool) {
      return { status: 'not_found' };
    }

    const effectiveMode = SharedStorageService.normalizeKeyPoolMode(pool.mode);
    const isGeneratorMode = effectiveMode === 'generator';
    const isSharedMode = effectiveMode === 'shared';
    const totalCount = Array.isArray(pool.keys) ? pool.keys.length : 0;
    const remainingCountBefore = (isGeneratorMode || isSharedMode)
      ? -1
      : (Array.isArray(pool.keys) ? pool.keys.filter((k) => !k.claimedBy).length : 0);

    if (pool.status === 'disabled') {
      return {
        status: 'disabled',
        pool: { ...pool, mode: effectiveMode, keys: (pool.keys || []).map((k) => ({ ...k })) },
        remainingCount: remainingCountBefore,
        totalCount
      };
    }

    if (pool.expiresAt) {
      const expTs = Date.parse(pool.expiresAt);
      if (Number.isFinite(expTs) && Date.now() >= expTs) {
        return {
          status: 'expired',
          pool: { ...pool, mode: effectiveMode, keys: (pool.keys || []).map((k) => ({ ...k })) },
          remainingCount: remainingCountBefore,
          totalCount
        };
      }
    }

    if (isSharedMode) {
      const sharedVal = String(pool.sharedText ?? '').trim();
      if (!sharedVal) {
        return { status: 'not_found' };
      }
      if (!Array.isArray(pool.keys)) {
        pool.keys = [];
      }
      const claimedAtIso = new Date().toISOString();
      const targetUser = cleanUserId || 'unknown';
      const existingEntry = pool.keys.find((k) => String(k.claimedBy || '').trim() === targetUser);
      let entrySnapshot: KeyPoolEntry;
      if (existingEntry) {
        existingEntry.value = sharedVal;
        existingEntry.claimedAt = claimedAtIso;
        if (cleanUsername) existingEntry.claimedByUsername = cleanUsername;
        entrySnapshot = { ...existingEntry };
      } else {
        const newEntry: KeyPoolEntry = {
          id: `${pool.id}_${pool.keys.length}_${Math.random().toString(36).substring(2, 5)}`,
          value: sharedVal,
          index: pool.keys.length,
          claimedBy: targetUser,
          ...(cleanUsername ? { claimedByUsername: cleanUsername } : {}),
          claimedAt: claimedAtIso
        };
        if (pool.keys.length < 500) {
          pool.keys.push(newEntry);
        }
        entrySnapshot = { ...newEntry };
      }

      pool.totalClaims = (pool.totalClaims || 0) + 1;
      pool.updatedAt = claimedAtIso;

      const snapshotPool: KeyPoolRecord = {
        ...pool,
        mode: 'shared',
        generatorConfig: null,
        sharedText: sharedVal,
        keys: pool.keys.map((k) => ({ ...k }))
      };

      await this.persist(false);

      return {
        status: 'claimed',
        key: entrySnapshot,
        pool: snapshotPool,
        remainingCount: -1,
        totalCount: pool.keys.length
      };
    }

    if (cleanUserId && Array.isArray(pool.keys)) {
      const existingClaim = pool.keys.find((k) => String(k.claimedBy || '').trim() === cleanUserId);
      if (existingClaim) {
        return {
          status: 'already_claimed',
          key: { ...existingClaim },
          pool: { ...pool, mode: effectiveMode, keys: pool.keys.map((k) => ({ ...k })) },
          remainingCount: remainingCountBefore,
          totalCount
        };
      }
    }

    if (isGeneratorMode) {
      if (!Array.isArray(pool.keys)) {
        pool.keys = [];
      }
      const generatedValue = SharedStorageService.generateUniqueKeyForPool(pool);
      const claimedAtIso = new Date().toISOString();
      const newEntry: KeyPoolEntry = {
        id: `${pool.id}_${pool.keys.length}_${Math.random().toString(36).substring(2, 5)}`,
        value: generatedValue,
        index: pool.keys.length,
        claimedBy: cleanUserId || 'unknown',
        ...(cleanUsername ? { claimedByUsername: cleanUsername } : {}),
        claimedAt: claimedAtIso
      };
      pool.keys.push(newEntry);
      pool.totalClaims = (pool.totalClaims || 0) + 1;
      pool.updatedAt = claimedAtIso;

      const snapshotKey = { ...newEntry };
      const snapshotPool: KeyPoolRecord = {
        ...pool,
        mode: 'generator',
        generatorConfig: pool.generatorConfig ? SharedStorageService.normalizeGeneratorConfig(pool.generatorConfig) : null,
        keys: pool.keys.map((k) => ({ ...k }))
      };

      await this.persist(false);

      return {
        status: 'claimed',
        key: snapshotKey,
        pool: snapshotPool,
        remainingCount: -1,
        totalCount: snapshotPool.keys.length
      };
    }

    const nextKey = Array.isArray(pool.keys) ? pool.keys.find((k) => !k.claimedBy) : undefined;
    if (!nextKey) {
      return {
        status: 'sold_out',
        pool: { ...pool, keys: pool.keys.map((k) => ({ ...k })) },
        remainingCount: 0,
        totalCount
      };
    }

    // Mutate synchronously BEFORE awaiting persist() to prevent concurrent double-dispensing
    const claimedAtIso = new Date().toISOString();
    nextKey.claimedBy = cleanUserId || 'unknown';
    if (cleanUsername) {
      nextKey.claimedByUsername = cleanUsername;
    }
    nextKey.claimedAt = claimedAtIso;
    pool.totalClaims = (pool.totalClaims || 0) + 1;
    pool.updatedAt = claimedAtIso;

    const remainingCountAfter = pool.keys.filter((k) => !k.claimedBy).length;
    const snapshotKey = { ...nextKey };
    const snapshotPool: KeyPoolRecord = {
      ...pool,
      mode: 'pool',
      keys: pool.keys.map((k) => ({ ...k }))
    };

    await this.persist(false);

    return {
      status: 'claimed',
      key: snapshotKey,
      pool: snapshotPool,
      remainingCount: remainingCountAfter,
      totalCount
    };
  }

  // =========================================================================
  // FREE FIRE GUEST ACCOUNTS MANAGER (PERSISTED IN DATA_DIR)
  // =========================================================================
  public async getGuestAccounts(): Promise<FreeFireGuestAccountRecord[]> {
    await this.loadLatest(false);
    const list = Array.isArray(this.db.guestAccounts) ? this.db.guestAccounts : [];
    return list.map((acc) => ({
      ...acc,
      enabled: acc.enabled !== false
    }));
  }

  public async addGuestAccount(
    guestUid: string,
    guestPassword: string
  ): Promise<{ account: FreeFireGuestAccountRecord; updatedExisting: boolean; total: number }> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.guestAccounts)) {
      this.db.guestAccounts = [];
    }

    const cleanUid = String(guestUid || '').trim();
    const cleanPassword = String(guestPassword || '').trim();
    if (!cleanUid || !cleanPassword) {
      throw new Error('Guest UID and Guest Password are required');
    }

    const nowIso = new Date().toISOString();
    const existingIdx = this.db.guestAccounts.findIndex(
      (a) => String(a.guestUid || '').trim() === cleanUid
    );

    if (existingIdx >= 0) {
      const existing = this.db.guestAccounts[existingIdx];
      existing.guestUid = cleanUid;
      existing.guestPassword = cleanPassword;
      existing.enabled = existing.enabled !== false;
      existing.updatedAt = nowIso;
      delete existing.lastStatus;
      delete existing.lastMessage;
      await this.persist(true);
      return {
        account: { ...existing, enabled: existing.enabled !== false },
        updatedExisting: true,
        total: this.db.guestAccounts.length
      };
    }

    let id = '';
    do {
      const rand = Math.random().toString(36).substring(2, 7);
      const timePart = Date.now().toString(36).slice(-4);
      id = `ga_${rand}${timePart}`;
    } while (this.db.guestAccounts.some((a) => a.id === id));

    const record: FreeFireGuestAccountRecord = {
      id,
      guestUid: cleanUid,
      guestPassword: cleanPassword,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    this.db.guestAccounts.push(record);
    await this.persist(true);
    return {
      account: { ...record },
      updatedExisting: false,
      total: this.db.guestAccounts.length
    };
  }

  public async addGuestAccountsBatch(
    entries: Array<{ guestUid: string; guestPassword: string }>
  ): Promise<{
    addedCount: number;
    updatedCount: number;
    total: number;
    accounts: FreeFireGuestAccountRecord[];
  }> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.guestAccounts)) {
      this.db.guestAccounts = [];
    }

    const deduped = new Map<string, string>();
    for (const entry of entries || []) {
      const cleanUid = String(entry?.guestUid || '').trim();
      const cleanPassword = String(entry?.guestPassword || '').trim();
      if (!cleanUid || !cleanPassword) continue;
      deduped.set(cleanUid, cleanPassword);
    }

    if (deduped.size === 0) {
      throw new Error('No valid guest_uid and guest_password entries found');
    }

    const nowIso = new Date().toISOString();
    let addedCount = 0;
    let updatedCount = 0;
    const touchedAccounts: FreeFireGuestAccountRecord[] = [];

    for (const [cleanUid, cleanPassword] of deduped.entries()) {
      const existing = this.db.guestAccounts.find(
        (a) => String(a.guestUid || '').trim() === cleanUid
      );

      if (existing) {
        existing.guestUid = cleanUid;
        existing.guestPassword = cleanPassword;
        existing.enabled = existing.enabled !== false;
        existing.updatedAt = nowIso;
        delete existing.lastStatus;
        delete existing.lastMessage;
        updatedCount++;
        touchedAccounts.push({ ...existing, enabled: existing.enabled !== false });
      } else {
        let id = '';
        do {
          const rand = Math.random().toString(36).substring(2, 7);
          const timePart = Date.now().toString(36).slice(-4);
          id = `ga_${rand}${timePart}`;
        } while (this.db.guestAccounts.some((a) => a.id === id));

        const record: FreeFireGuestAccountRecord = {
          id,
          guestUid: cleanUid,
          guestPassword: cleanPassword,
          enabled: true,
          createdAt: nowIso,
          updatedAt: nowIso
        };
        this.db.guestAccounts.push(record);
        addedCount++;
        touchedAccounts.push({ ...record });
      }
    }

    await this.persist(true);
    return {
      addedCount,
      updatedCount,
      total: this.db.guestAccounts.length,
      accounts: touchedAccounts
    };
  }

  public async updateGuestAccount(
    id: string,
    updates: {
      guestUid?: string;
      guestPassword?: string;
      enabled?: boolean;
    }
  ): Promise<FreeFireGuestAccountRecord | null> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.guestAccounts)) return null;
    const cleanId = String(id || '').trim();
    const target = this.db.guestAccounts.find((a) => a.id === cleanId);
    if (!target) return null;

    const nowIso = new Date().toISOString();
    if (updates.guestUid !== undefined) {
      const cleanUid = String(updates.guestUid || '').trim();
      if (!cleanUid) {
        throw new Error('Guest UID cannot be empty');
      }
      const dup = this.db.guestAccounts.find(
        (a) => a.id !== cleanId && String(a.guestUid || '').trim() === cleanUid
      );
      if (dup) {
        throw new Error('Another guest account with this UID already exists');
      }
      target.guestUid = cleanUid;
    }
    if (updates.guestPassword !== undefined) {
      const cleanPass = String(updates.guestPassword || '').trim();
      if (cleanPass) {
        target.guestPassword = cleanPass;
        delete target.lastStatus;
        delete target.lastMessage;
      }
    }
    if (updates.enabled !== undefined) {
      target.enabled = Boolean(updates.enabled);
    }
    target.updatedAt = nowIso;
    await this.persist(true);
    return {
      ...target,
      enabled: target.enabled !== false
    };
  }

  public async deleteGuestAccount(id: string): Promise<{ deleted: boolean; total: number }> {
    await this.loadLatest(false);
    if (!Array.isArray(this.db.guestAccounts)) {
      return { deleted: false, total: 0 };
    }
    const cleanId = String(id || '').trim();
    const prevLen = this.db.guestAccounts.length;
    this.db.guestAccounts = this.db.guestAccounts.filter((a) => a.id !== cleanId);
    if (this.db.guestAccounts.length === prevLen) {
      return { deleted: false, total: this.db.guestAccounts.length };
    }
    await this.persist(true);
    return { deleted: true, total: this.db.guestAccounts.length };
  }

  public async updateGuestAccountStatuses(
    updates: Array<{
      id: string;
      status: 'ok' | 'auth_failed' | 'like_failed';
      message?: string;
      usedAt?: string;
    }>
  ): Promise<void> {
    if (!Array.isArray(updates) || updates.length === 0) return;
    await this.loadLatest(false);
    if (!Array.isArray(this.db.guestAccounts) || this.db.guestAccounts.length === 0) return;
    let changed = false;
    const nowIso = new Date().toISOString();
    for (const u of updates) {
      const target = this.db.guestAccounts.find((a) => a.id === u.id);
      if (target) {
        target.lastUsedAt = u.usedAt || nowIso;
        target.lastStatus = u.status;
        if (u.message) {
          target.lastMessage = u.message;
        } else {
          delete target.lastMessage;
        }
        changed = true;
      }
    }
    if (changed) {
      await this.persist(false);
    }
  }

  // =========================================================================
  // PERSISTENT MODERATION PICKER SESSIONS (SURVIVES SERVER / BOT RESTARTS)
  // =========================================================================
  public async savePendingModeration(record: PendingModerationActionRecord): Promise<void> {
    await this.loadLatest(false);
    if (!this.db.pendingModerationActions || typeof this.db.pendingModerationActions !== 'object') {
      this.db.pendingModerationActions = {};
    }
    const now = Date.now();
    for (const [k, v] of Object.entries(this.db.pendingModerationActions)) {
      if (!v || !v.createdAt || now - v.createdAt > 30 * 60 * 1000) {
        delete this.db.pendingModerationActions[k];
      }
    }
    this.db.pendingModerationActions[record.token] = { ...record };
    await this.persist(true);
  }

  public async getPendingModeration(token: string): Promise<PendingModerationActionRecord | null> {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return null;
    await this.loadLatest(false);
    const map = this.db.pendingModerationActions;
    if (!map || typeof map !== 'object') return null;
    const found = map[cleanToken];
    if (!found) return null;
    if (!found.createdAt || Date.now() - found.createdAt > 30 * 60 * 1000) {
      delete map[cleanToken];
      await this.persist(false).catch(() => {});
      return null;
    }
    return { ...found };
  }

  public async getAwaitingReasonModeration(
    chatId: string | number,
    adminId?: string | number,
    replyToMessageId?: number
  ): Promise<PendingModerationActionRecord | null> {
    await this.loadLatest(false);
    const map = this.db.pendingModerationActions;
    if (!map || typeof map !== 'object') return null;
    const cleanChatId = String(chatId ?? '').trim();
    const cleanAdminId = adminId !== undefined && adminId !== null ? String(adminId).trim() : '';
    const now = Date.now();
    let best: PendingModerationActionRecord | null = null;

    for (const entry of Object.values(map)) {
      if (!entry || !entry.createdAt || now - entry.createdAt > 30 * 60 * 1000) continue;
      if (entry.stage !== 'awaiting_reason') continue;
      if (String(entry.chatId ?? '').trim() !== cleanChatId) continue;

      if (replyToMessageId && entry.promptMessageId && Number(entry.promptMessageId) === Number(replyToMessageId)) {
        return { ...entry };
      }
      if (cleanAdminId && String(entry.adminId ?? '').trim() === cleanAdminId) {
        if (!best || entry.createdAt > best.createdAt) {
          best = { ...entry };
        }
      }
    }
    return best;
  }

  public async deletePendingModeration(token: string): Promise<void> {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return;
    await this.loadLatest(false);
    if (this.db.pendingModerationActions && this.db.pendingModerationActions[cleanToken]) {
      delete this.db.pendingModerationActions[cleanToken];
      await this.persist(true);
    }
  }
}

export const sharedStorage = new SharedStorageService('main');

// Storage Manager for Multi-Bot Isolation
export class StorageManager {
  private static instances = new Map<string, SharedStorageService>();

  public static getMainStorage(): SharedStorageService {
    return sharedStorage;
  }

  public static getStorage(botId: string = 'main'): SharedStorageService {
    const cleanId = (botId || 'main').trim();
    if (cleanId === 'main') {
      return sharedStorage;
    }
    let s = this.instances.get(cleanId);
    if (!s) {
      s = new SharedStorageService(cleanId);
      this.instances.set(cleanId, s);
      s.loadLatest(true).catch(() => {});
    }
    return s;
  }

  public static getLoadedStorageIds(): string[] {
    return ['main', ...Array.from(this.instances.keys())];
  }

  public static async flushAll(): Promise<void> {
    await Promise.allSettled([
      sharedStorage.flush(),
      ...Array.from(this.instances.values()).map((inst) => inst.flush())
    ]);
  }

  public static async destroyStorage(botId: string): Promise<void> {
    const cleanId = (botId || '').trim();
    if (!cleanId || cleanId === 'main') return;
    const stripped = cleanId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    const candidates = Array.from(new Set([cleanId, stripped, stripped ? `clone_${stripped}` : ''].filter(Boolean)));

    for (const cid of candidates) {
      const inst = this.instances.get(cid);
      if (inst) {
        inst.stopTimers();
        await inst.clearMemoryCaches().catch(() => {});
        this.instances.delete(cid);
      }
      for (const filePath of getDataFileSearchPaths(cid)) {
        try {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath).catch(() => {});
          }
          if (fs.existsSync(`${filePath}.bak`)) {
            await fs.promises.unlink(`${filePath}.bak`).catch(() => {});
          }
        } catch {}
      }
    }
  }

  public getMainStorage(): SharedStorageService {
    return StorageManager.getMainStorage();
  }

  public getStorage(botId: string = 'main'): SharedStorageService {
    return StorageManager.getStorage(botId);
  }
}

export const storageManager = new StorageManager();
export const storageContext = new AsyncLocalStorage<SharedStorageService>();

export const storage = new Proxy(sharedStorage, {
  get(target, prop, receiver) {
    const active = storageContext.getStore() || target;
    const val = Reflect.get(active, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(active);
    }
    return val;
  }
});
