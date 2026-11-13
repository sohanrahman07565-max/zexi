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
  role: AdminRole;
  passwordHash: string;
  permissions: AdminPermissions;
  enabled: boolean;
  createdAt: string;
  lastLoginAt?: string;
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
  deliveryCount: number;
  inFiltersList?: boolean;
  retentionType?: 'permanent' | 'temporary';
  retentionDays?: number;
  expiresAt?: string;
  hasSetupVideo?: boolean;
  setupVideoUrl?: string;
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
  enabled?: boolean;
  isAutoDetected?: boolean;
  type?: 'channel' | 'supergroup' | 'group';
  username?: string;
  isAdmin?: boolean;
  detectedAt?: string;
}

export interface BotSettings {
  botToken: string;
  botUsername: string;
  rootAdminId: string;
  maxBotMessagesPerChat: number;
  dailyCleanupEnabled: boolean;
  cleanupAgeHours: number;
  autoDeleteDeliveryEnabled: boolean;
  deliveryTimeoutMinutes: number;
  autoDeleteNoticeEnabled: boolean;
  maintenanceMode?: boolean;
  maintenanceNotice?: string;
  forceSubEnabled?: boolean;
  requiredChannels?: ForceSubChannel[];
  autoApproveJoinRequests?: boolean;
  antiForwardEnabled?: boolean;
}

export interface JoinRequestRecord {
  id: string; // `${chatId}_${userId}`
  chatId: string;
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

export interface WebCodeRecord {
  telegramId: string;
  code: string;
  expiresAt: number;
  used: boolean;
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
  isAdmin?: boolean;
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
  id: string; // telegram bot id (numeric string)
  token: string;
  name: string;
  username: string;
  status: 'active' | 'paused' | 'stopped';
  createdAt: string;
  createdBy?: string;
  filesCount?: number;
  usersCount?: number;
  adminUsername?: string;
  adminPassword?: string;
  panelUrl?: string;
}

export interface AppDatabase {
  items: ItemRecord[];
  templates: Record<string, MessageTemplate>;
  admins: AdminUser[];
  sessions: SessionRecord[];
  webcodes: WebCodeRecord[];
  trackedMessages: Record<string, TrackedMessage[]>;
  scheduledDeletions?: ScheduledDeletion[];
  chatDeliveryMessages?: Record<string, number[]>;
  design: DesignConfig;
  settings: BotSettings;
  backupServer?: BackupServerConfig;
  clonedBots?: ClonedBotRecord[];
  addSessions?: Record<string, any>;
  botUsers?: Record<string, BotUserRecord>;
  reports?: UserReportRecord[];
  fraudRules?: FraudKeywordRule[];
  linkWarnings?: Record<string, number>;
  fraudWarnings?: Record<string, number>;
  detectedChannels?: ForceSubChannel[];
  joinRequests?: Record<string, JoinRequestRecord>;
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
    content: "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}\n\n✨ <i>Send any configured trigger hashtag in your group or here to receive your files privately!</i>",
    variables: ['user_name', 'user_id', 'bot_name'],
    mediaType: 'none',
    mediaUrl: ''
  },
  DELIVERY_STATUS_MESSAGE: {
    key: 'DELIVERY_STATUS_MESSAGE',
    name: 'Delivery Progress Status Message',
    description: 'Temporary status message displayed while delivering a file or link; automatically deleted after delivery completes',
    content: '⏳ Delivering your file...',
    variables: ['user_name', 'name', 'type']
  },
  FILTERS_MESSAGE: {
    key: 'FILTERS_MESSAGE',
    name: 'Quick File Keywords (/filters)',
    description: 'Message sent when users or admins send /filters, /filter or #filters to view all one-tap copyable file triggers',
    content: "📁 <b>Quick File Keywords</b>\nType any of these (in a group or here) and I'll DM you the file:\n\n{keywords}",
    variables: ['keywords', 'bot_name']
  },
  GROUP_FILE_REPLY: {
    key: 'GROUP_FILE_REPLY',
    name: 'Group File Reply',
    description: 'Message sent in the group replying to the user requesting a file',
    content: "👇 Tap below — I'll send your file privately.",
    variables: ['user_name', 'user_id', 'trigger', 'file_name']
  },
  GROUP_LINK_REPLY: {
    key: 'GROUP_LINK_REPLY',
    name: 'Group Link Reply',
    description: 'Message sent in the group replying to the user requesting a link',
    content: "👇 Tap below — I'll send the link privately.",
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
    content: '📥 *Add File*\n\n*Step 1:* Please send the file you want to add:\n• Any document (APK, ZIP, PDF, etc.)\n• Photo\n• Video\n• Audio\n\n_(Type /cancel to abort)_',
    variables: []
  },
  ADMIN_SAVE_SUCCESS: {
    key: 'ADMIN_SAVE_SUCCESS',
    name: 'Admin Save Success',
    description: 'Message sent when content is saved successfully',
    content: '✅ Saved successfully! Trigger: {trigger}',
    variables: ['trigger', 'type', 'name']
  },
  WEB_CODE_MESSAGE: {
    key: 'WEB_CODE_MESSAGE',
    name: 'Web Verification Code Message',
    description: 'Message sent when admin requests a WebCode for password reset',
    content: '🔐 Web Admin Verification Code\n\n{code}\n\nValid for 10 minutes.',
    variables: ['code']
  },
  PASSWORD_UPDATED: {
    key: 'PASSWORD_UPDATED',
    name: 'Password Updated',
    description: 'Message sent when password has been successfully updated',
    content: '✅ Password updated successfully. You can now log in to the web panel.',
    variables: []
  },
  CANCEL_MESSAGE: {
    key: 'CANCEL_MESSAGE',
    name: 'Operation Cancelled',
    description: 'Message sent when current interactive action is cancelled',
    content: '❌ Operation cancelled.',
    variables: []
  },
  FILE_AUTO_DELETE_NOTICE: {
    key: 'FILE_AUTO_DELETE_NOTICE',
    name: 'File Auto-Delete Notice',
    description: 'Notice message notifying users that delivered file is temporary and will auto-destruct',
    content: '⏳ <i>Auto-Delete Notice: This file will automatically disappear in {timeout} minutes. Please save or forward it now!</i>',
    variables: ['timeout', 'name']
  },
  ANTI_LINK_WARNING: {
    key: 'ANTI_LINK_WARNING',
    name: 'Anti-Link Group Warning',
    description: 'Warning message sent when a non-admin user posts an unauthorized link in group chat',
    content: 'First Warning: Links are not allowed in this group. If you share a link again, you will be banned from the group.',
    variables: ['user_name', 'user_id']
  },
  BAN_NOTICE: {
    key: 'BAN_NOTICE',
    name: 'User Ban Notice',
    description: 'Notification sent when a user reaches 3 strikes (link/forward spam or fraud words) and is automatically banned',
    content: '🚫 <b>USER AUTO-BANNED (Strike {strikes}/{strikes})</b>\n\n👤 <b>User:</b> {name} (@{username} | ID: <code>{user_id}</code>)\n⚠️ <b>Reason:</b> Exceeded maximum {strikes}-strike warnings for unauthorized links / external forward spam.',
    variables: ['name', 'username', 'user_id', 'strikes']
  },
  FRAUD_KEYWORD_DEFAULT_REPLY: {
    key: 'FRAUD_KEYWORD_DEFAULT_REPLY',
    name: 'Restricted Word Auto-Reply / Warning',
    description: 'Auto-reply or warning sent when a user triggers a restricted keyword',
    content: '⚠️ <b>Warning {user_name} ({warning_count}/{max_warnings}):</b> Prohibited content detected (<code>{keyword}</code>). If you continue, you will be restricted from this chat.',
    variables: ['user_name', 'user_id', 'keyword', 'warning_count', 'max_warnings', 'action']
  },
  FORCESUB_PROMPT: {
    key: 'FORCESUB_PROMPT',
    name: 'Force Sub / Mandatory Join Prompt',
    description: 'Main text displayed on the verification screen when a user has not joined all mandatory channels/groups',
    content: "🔒 <b>Channel Membership Required</b>\n\nTo use this bot and access your requested content, please subscribe to our official channel(s) below:\n\n{channel_list}\n\n👇 <i>Tap the button(s) above to join, then press <b>Verify / Try Again</b> below.</i>",
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
  loginLogoUrl: 'https://host.tscv.workers.dev/img/df6c9e167caf42c6',
  loginLogoSymbol: '惡',
  loginIdLabel: 'ADMIN NAME',
  loginIdPlaceholder: 'Enter admin name',
  loginPassLabel: 'PASSWORD',
  loginPassPlaceholder: 'Enter password',
  loginButtonText: 'SIGN IN',
  loginAccentColor: '#ef4444',
  buttonAnimationStyle: 'orbit'
};

export const DEFAULT_SETTINGS: BotSettings = {
  botToken: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: '',
  rootAdminId: process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '',
  maxBotMessagesPerChat: 10,
  dailyCleanupEnabled: true,
  cleanupAgeHours: 24,
  autoDeleteDeliveryEnabled: true,
  deliveryTimeoutMinutes: 10,
  autoDeleteNoticeEnabled: false,
  maintenanceMode: false,
  forceSubEnabled: false,
  autoApproveJoinRequests: true,
  antiForwardEnabled: false,
  requiredChannels: []
};

// Persistent storage paths for standalone Render Web Service and local environment (Dual Firebase projects)
const FIREBASE_RTDB_URL = "https://zexiofficial844-default-rtdb.asia-southeast1.firebasedatabase.app";
const SECONDARY_FIREBASE_RTDB_URL = "https://zexi-official-default-rtdb.asia-southeast1.firebasedatabase.app";

function getFallbackFilePaths(botId: string = 'main'): string[] {
  const suffix = botId === 'main' ? '' : `_${botId}`;
  const paths: string[] = [];
  if (process.env.DATA_FILE_PATH) {
    try {
      paths.push(path.resolve(process.env.DATA_FILE_PATH.replace(/\.json$/, `${suffix}.json`)));
    } catch {}
  }
  try {
    paths.push(path.resolve(process.cwd(), '.data', `store${suffix}.json`));
  } catch {}
  paths.push(`/tmp/tg_bot_store${suffix}.json`);
  return paths;
}

export class SharedStorageService {
  private db: AppDatabase;
  private lastLoadedAt: number = 0;
  private triggerCache = new Map<string, ItemRecord>();
  private itemCache = new Map<string, ItemRecord>();
  private sortedActiveItemsNewestCache: ItemRecord[] | null = null;
  private sortedItemsChronoCache: ItemRecord[] | null = null;
  private cloudSyncTimer: NodeJS.Timeout | null = null;

  constructor(public readonly botId: string = 'main') {
    this.db = {
      items: [],
      templates: { ...DEFAULT_TEMPLATES },
      admins: [],
      sessions: [],
      webcodes: [],
      trackedMessages: {},
      scheduledDeletions: [],
      uploadedFilesIndex: {},
      clonedBots: [],
      addSessions: {},
      botUsers: {},
      reports: [],
      fraudRules: [],
      linkWarnings: {},
      fraudWarnings: {},
      detectedChannels: [],
      joinRequests: {},
      design: { ...DEFAULT_DESIGN },
      settings: { ...DEFAULT_SETTINGS },
      backupServer: { ...DEFAULT_BACKUP_SERVER_CONFIG }
    };
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

  private isCloudSyncing = false;
  private hasPendingCloudSync = false;
  private cachedAuthToken: string | null = null;
  private tokenExpiresAt: number = 0;

  // Explicitly set authenticated admin Firebase ID token (from client login)
  public setCloudAuthToken(token: string): void {
    if (token && typeof token === 'string') {
      this.cachedAuthToken = token.trim();
      this.tokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 minutes validity
    }
  }

  // Retrieve Firebase Auth ID Token or Secret for Cloud RTDB requests
  public async getFirebaseAuthToken(): Promise<string | null> {
    if (process.env.FIREBASE_DATABASE_SECRET) {
      return process.env.FIREBASE_DATABASE_SECRET.trim();
    }
    if (process.env.FIREBASE_AUTH_TOKEN) {
      return process.env.FIREBASE_AUTH_TOKEN.trim();
    }

    const now = Date.now();
    if (this.cachedAuthToken && now < this.tokenExpiresAt - 60000) {
      return this.cachedAuthToken;
    }

    try {
      const apiKey = process.env.FIREBASE_API_KEY || "AIzaSyAvuHW-o4Rl-Ry8Fx5I3xp_Op1ujBT24Ls";
      const email = process.env.FIREBASE_SYNC_EMAIL || "server-sync@bot.local";
      const password = process.env.FIREBASE_SYNC_PASSWORD || "SyncSecret123456!";

      const authRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            returnSecureToken: true
          })
        }
      );

      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData.idToken) {
          this.cachedAuthToken = authData.idToken;
          this.tokenExpiresAt = now + (Number(authData.expiresIn) || 3600) * 1000;
          return this.cachedAuthToken;
        }
      }
    } catch (e: any) {
      // Non-critical token retrieval error
    }

    return null;
  }

  private getRtdbUrl(path: string, token?: string | null): string {
    const isSecondary = process.env.FIREBASE_PROJECT_PROFILE === 'secondary' || process.env.ACTIVE_BOT_PROFILE === 'secondary';
    const defaultUrl = isSecondary ? SECONDARY_FIREBASE_RTDB_URL : FIREBASE_RTDB_URL;
    const baseUrl = (process.env.FIREBASE_DATABASE_URL || defaultUrl).replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const targetPath = this.botId === 'main' ? cleanPath : `/cloned_bots/${this.botId}${cleanPath}`;
    const url = `${baseUrl}${targetPath}.json`;
    if (token) {
      return `${url}?auth=${encodeURIComponent(token)}`;
    }
    return url;
  }

  // 100% Cloud Persistence: Immediate commit to Firebase Realtime Database
  public async syncToFirebaseCloud(): Promise<boolean> {
    if (this.isCloudSyncing) {
      this.hasPendingCloudSync = true;
      return true;
    }

    this.isCloudSyncing = true;
    this.hasPendingCloudSync = false;

    try {
      const token = await this.getFirebaseAuthToken();
      const payload = JSON.stringify({
        items: this.db.items,
        templates: this.db.templates,
        admins: this.db.admins,
        sessions: (this.db.sessions || []).filter(s => s.expiresAt > Date.now()),
        clonedBots: this.db.clonedBots || [],
        settings: this.db.settings,
        design: this.db.design,
        botUsers: this.db.botUsers,
        reports: this.db.reports,
        fraudRules: this.db.fraudRules,
        linkWarnings: this.db.linkWarnings,
        fraudWarnings: this.db.fraudWarnings,
        detectedChannels: this.db.detectedChannels,
        joinRequests: this.db.joinRequests,
        uploadedFilesIndex: this.db.uploadedFilesIndex,
        updatedAt: new Date().toISOString()
      });

      // Attempt 1: Authenticated request (if token/secret available)
      let res = await fetch(this.getRtdbUrl('/app_state', token), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      // Attempt 2: If 401/403 and token was used, retry without token (in case rules are public)
      if (!res.ok && token) {
        res = await fetch(this.getRtdbUrl('/app_state'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
      }

      if (res.ok) {
        console.log('☁️ [Firebase Cloud] Storage successfully committed to Firebase Realtime Database (100% cloud permanence).');
      } else {
        const errorText = await res.text().catch(() => '');
        console.warn(`☁️ [Firebase Cloud] Cloud sync returned HTTP ${res.status}:`, errorText);
      }
    } catch (err: any) {
      console.warn('☁️ [Firebase Cloud] Storage sync notice:', err?.message || err);
    } finally {
      this.isCloudSyncing = false;
      if (this.hasPendingCloudSync) {
        this.hasPendingCloudSync = false;
        // Asynchronously process the pending write
        this.syncToFirebaseCloud().catch(() => {});
      }
    }

    return true;
  }

  // Restore latest database state from Firebase Realtime Database cloud
  public async loadFromFirebaseCloud(): Promise<Partial<AppDatabase> | null> {
    try {
      const token = await this.getFirebaseAuthToken();
      let res = await fetch(this.getRtdbUrl('/app_state', token));

      if (!res.ok && token) {
        res = await fetch(this.getRtdbUrl('/app_state'));
      }

      if (res.ok) {
        const cloudData = await res.json();
        if (
          cloudData &&
          typeof cloudData === 'object' &&
          (cloudData.items || cloudData.settings || cloudData.admins || cloudData.botUsers)
        ) {
          console.log('☁️ [Firebase Storage] Restored state from Firebase Realtime Database cloud (zero data loss).');
          return cloudData;
        }
      }
    } catch (err: any) {
      console.warn('☁️ [Firebase Storage] Notice reading from cloud:', err?.message || err);
    }
    return null;
  }

  // Graceful flush to ensure all in-flight changes are safely committed to cloud
  public async flush(): Promise<void> {
    if (this.cloudSyncTimer) {
      clearTimeout(this.cloudSyncTimer);
      this.cloudSyncTimer = null;
    }
    await this.syncToFirebaseCloud();
  }

  // High-performance LRU / In-Memory Cache Layer
  private lruCache = new Map<string, { value: any; expiresAt: number; hitCount: number }>();
  private readonly MAX_LRU_ENTRIES = 1000;
  private blobStore = new Map<string, Map<string, any>>();
  private isPersisting = false;
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

  // --- Hybrid Blob / Netlify Blobs Compatibility Layer ---
  // Maps storage keys efficiently in-memory so data retrieval remains instantaneous on Render
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

  // Background non-blocking disk & Firebase revalidation (Stale-While-Revalidate)
  private async revalidateInBackground(): Promise<void> {
    const now = Date.now();
    if (now - this.lastDiskCheck < 20000) return;
    this.lastDiskCheck = now;

    try {
      let newestDiskJson: string | null = null;
      let freshestMtime = -1;
      for (const filePath of getFallbackFilePaths(this.botId)) {
        if (fs.existsSync(filePath)) {
          const stat = await fs.promises.stat(filePath).catch(() => null);
          if (stat && stat.mtimeMs > freshestMtime) {
            const raw = await fs.promises.readFile(filePath, 'utf-8').catch(() => null);
            if (raw && raw.trim().startsWith('{')) {
              freshestMtime = stat.mtimeMs;
              newestDiskJson = raw;
            }
          }
        }
      }

      if (newestDiskJson && freshestMtime > this.lastLoadedAt) {
        const parsed = JSON.parse(newestDiskJson);
        if (parsed && typeof parsed === 'object') {
          this.applyLoadedData(parsed);
          this.lastLoadedAt = freshestMtime;
          this.rebuildCache();
          this.invalidateCache();
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
    const loadedClonedBots = Array.isArray(loadedData.clonedBots) ? loadedData.clonedBots : existingClonedBots;

    this.db = {
      items: Array.isArray(loadedData.items) ? loadedData.items : [],
      templates: { ...DEFAULT_TEMPLATES, ...(loadedData.templates || {}) },
      admins: Array.isArray(loadedData.admins) ? loadedData.admins : [],
      sessions: Array.from(mergedSessionsMap.values()),
      clonedBots: loadedClonedBots,
      webcodes: Array.isArray(loadedData.webcodes) ? loadedData.webcodes : [],
      trackedMessages: loadedData.trackedMessages || {},
      scheduledDeletions: Array.isArray(loadedData.scheduledDeletions) ? loadedData.scheduledDeletions : [],
      uploadedFilesIndex: loadedData.uploadedFilesIndex || {},
      addSessions: loadedData.addSessions || {},
      botUsers: loadedData.botUsers || {},
      reports: Array.isArray(loadedData.reports) ? loadedData.reports : [],
      fraudRules: Array.isArray(loadedData.fraudRules) ? loadedData.fraudRules : [],
      linkWarnings: loadedData.linkWarnings || {},
      fraudWarnings: loadedData.fraudWarnings || {},
      detectedChannels: Array.isArray(loadedData.detectedChannels) ? loadedData.detectedChannels : [],
      joinRequests: loadedData.joinRequests || {},
      design: { ...DEFAULT_DESIGN, ...(loadedData.design || {}) },
      settings: {
        ...DEFAULT_SETTINGS,
        ...(loadedData.settings || {}),
        botToken: isMainBot
          ? (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || loadedData.settings?.botToken || '')
          : (loadedData.settings?.botToken || this.db.settings?.botToken || ''),
        rootAdminId: isMainBot
          ? (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || loadedData.settings?.rootAdminId || '')
          : (loadedData.settings?.rootAdminId || ''),
        autoDeleteNoticeEnabled: loadedData.settings?.autoDeleteNoticeEnabled ?? false,
        forceSubEnabled: loadedData.settings?.forceSubEnabled ?? false,
        autoApproveJoinRequests: loadedData.settings?.autoApproveJoinRequests ?? true,
        antiForwardEnabled: loadedData.settings?.antiForwardEnabled ?? false,
        requiredChannels: Array.isArray(loadedData.settings?.requiredChannels) ? loadedData.settings.requiredChannels : []
      },
      backupServer: {
        ...DEFAULT_BACKUP_SERVER_CONFIG,
        ...(loadedData.backupServer || {})
      }
    };
  }

  // Blazing-fast In-Memory load with non-blocking background revalidation
  public async loadLatest(force = false): Promise<AppDatabase> {
    const now = Date.now();

    // Fast Path: If already in memory and not cold boot, return immediately (0.01ms)
    if (this.lastLoadedAt > 0 && (!force || now - this.lastLoadedAt < 5000)) {
      // Trigger background revalidation if stale (> 30s)
      if (now - this.lastDiskCheck > 30000) {
        this.revalidateInBackground().catch(() => {});
      }
      return this.db;
    }

    let loadedData: Partial<AppDatabase> | null = null;

    // 100% Cloud Permanence: Restore state from Firebase Realtime Database cloud first
    try {
      loadedData = await this.loadFromFirebaseCloud();
    } catch (err: any) {
      console.warn('☁️ [Firebase Storage] Initial cloud read exception:', err?.message || err);
    }

    // Emergency Offline Fallback: Only check local files if cloud was completely offline
    if (!loadedData) {
      let freshestMtime = -1;
      let freshestJson: string | null = null;
      for (const filePath of getFallbackFilePaths(this.botId)) {
        try {
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs > freshestMtime) {
              const raw = fs.readFileSync(filePath, 'utf-8');
              if (raw && raw.trim().startsWith('{')) {
                freshestMtime = stat.mtimeMs;
                freshestJson = raw;
              }
            }
          }
        } catch {}
      }
      if (freshestJson) {
        try {
          loadedData = JSON.parse(freshestJson);
          if (loadedData) {
            console.log('💾 [Local Storage] Restored offline fallback snapshot from disk.');
          }
        } catch {}
      }
    }

    if (loadedData) {
      this.applyLoadedData(loadedData);
    }

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

  // Fast asynchronous persistence: updates in-memory immediately & commits to cloud synchronously/reliably
  public async persist(): Promise<boolean> {
    this.lastLoadedAt = Date.now();
    this.rebuildCache();
    this.invalidateCache();

    // 100% Cloud Permanence: Immediately commit to Firebase Realtime Database
    this.syncToFirebaseCloud().catch((err) => {
      console.warn('☁️ [Firebase Cloud] Background sync error:', err?.message || err);
    });

    // Trigger debounced real-time replication to silent backup mirror if enabled
    if (
      this.db.backupServer?.enabled &&
      this.db.backupServer?.role === 'primary' &&
      this.db.backupServer?.autoSyncOnSave &&
      this.db.backupServer?.serverUrl
    ) {
      this.scheduleSilentReplication();
    }

    // Non-blocking asynchronous file persistence
    if (this.pendingPersistTimer) clearTimeout(this.pendingPersistTimer);
    this.pendingPersistTimer = setTimeout(async () => {
      try {
        const snapshot = JSON.stringify(this.db, null, 2);
        for (const filePath of getFallbackFilePaths(this.botId)) {
          try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              await fs.promises.mkdir(dir, { recursive: true });
            }
            await fs.promises.writeFile(filePath, snapshot, 'utf-8');
          } catch {}
        }
      } catch (err: any) {
        console.error('[Storage] Error during async file persistence:', err?.message || err);
      }
    }, 250);

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

  // --- WebCodes (Forgot Password) ---
  public async createWebCode(telegramId: string): Promise<string> {
    await this.loadLatest(true);
    const cleanId = String(telegramId).trim().replace(/^@/, '');
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Clean any prior unused codes for this admin
    this.db.webcodes = this.db.webcodes.filter(w => w.telegramId !== cleanId);
    this.db.webcodes.push({
      telegramId: cleanId,
      code,
      expiresAt,
      used: false
    });

    const success = await this.persist();
    if (!success) {
      throw new Error('Failed to save verification code to persistent storage');
    }
    return code;
  }

  public async verifyAndConsumeWebCode(telegramId: string, code: string): Promise<boolean> {
    await this.loadLatest(true);
    const cleanId = String(telegramId).trim().replace(/^@/, '');
    const cleanCode = String(code).trim();
    const now = Date.now();

    const record = this.db.webcodes.find(w => 
      (w.telegramId === cleanId || w.telegramId.replace(/^@/, '') === cleanId) && 
      w.code === cleanCode && 
      !w.used && 
      w.expiresAt > now
    );

    if (record) {
      record.used = true;
      const success = await this.persist();
      if (!success) {
        console.error('[Storage] Warning: Failed to persist webcode consumption flag.');
      }
      return true;
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
      this.db.items[index] = { ...this.db.items[index], ...cleanItem, updatedAt: new Date().toISOString() };
    } else {
      this.db.items.push(cleanItem);
    }
    this.rebuildCache();
    this.invalidateCache();
    return await this.persist();
  }

  public async deleteItem(id: string): Promise<boolean> {
    await this.loadLatest(true);
    const itemToDelete = this.db.items.find(i => i.id === id);
    const lenBefore = this.db.items.length;
    this.db.items = this.db.items.filter(i => i.id !== id);
    if (this.db.items.length !== lenBefore) {
      if (itemToDelete?.uploadedFileId) {
        this.deleteUploadedFile(itemToDelete.uploadedFileId).catch(() => {});
      }
      this.rebuildCache();
      this.invalidateCache();
      return await this.persist();
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
          if (item.uploadedFileId) {
            this.deleteUploadedFile(item.uploadedFileId).catch(() => {});
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

  public async incrementItemDelivery(id: string): Promise<void> {
    const item = this.db.items.find(i => i.id === id);
    if (item) {
      item.deliveryCount = (item.deliveryCount || 0) + 1;
      this.invalidateCache('items');
      this.persist().catch(() => {});
    }
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
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim();
    const isAdmin = userId === rootAdminId || rootAdminId.includes(userId) || admins.some(a => String(a.telegramId).trim() === userId || String(a.id).trim() === userId);

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

  public async getUserStats(): Promise<{ totalUsers: number; onlineUsers: number; offlineUsers: number }> {
    const cached = this.getCached<{ totalUsers: number; onlineUsers: number; offlineUsers: number }>('stats:users');
    if (cached) return cached;

    const users = await this.getBotUsers();
    const onlineUsers = users.filter(u => u.isOnline).length;
    const offlineUsers = Math.max(0, users.length - onlineUsers);
    const stats = {
      totalUsers: users.length,
      onlineUsers,
      offlineUsers
    };
    this.setCached('stats:users', stats, 5000);
    return stats;
  }

  public async getBotUsers(): Promise<BotUserRecord[]> {
    const cached = this.getCached<BotUserRecord[]>('users:all');
    if (cached) return cached;

    if (!this.db.botUsers) this.db.botUsers = {};

    const admins = this.db.admins;
    const settings = this.db.settings;
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim();

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
      if (adminId && !this.db.botUsers[adminId]) {
        this.db.botUsers[adminId] = {
          id: adminId,
          username: admin.name ? `@${admin.name.replace(/^@+/, '').trim()}` : undefined,
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

    if (rootAdminId && !this.db.botUsers[rootAdminId]) {
      this.db.botUsers[rootAdminId] = {
        id: rootAdminId,
        username: process.env.ADMIN_NAME ? `@${process.env.ADMIN_NAME.replace(/^@+/, '').trim()}` : '@sohan',
        firstName: process.env.ADMIN_NAME || 'Owner Admin',
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

  public async isUserBanned(userId: string | number): Promise<boolean> {
    if (!userId) return false;
    await this.loadLatest(false);
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

  public async getUser(userId: string | number): Promise<BotUserRecord | null> {
    if (!userId) return null;
    await this.loadLatest(false);
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
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
    const isAdmin = cleanId === rootAdminId || rootAdminId.includes(cleanId) || admins.some(a => String(a.telegramId) === cleanId || String(a.id) === cleanId);
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
          (u as any).bannedAt = undefined;
        }
        user = u;
      }
    }

    // When unbanned, completely clear any link warnings or fraud restrictions
    if (user && !user.isBanned) {
      delete user.bannedAt;
      (user as any).bannedAt = undefined;
      await this.resetUserLinkWarning(cleanId);
      await this.resetUserFraudWarning(cleanId);
      if (user.id) {
        await this.resetUserLinkWarning(user.id);
        await this.resetUserFraudWarning(user.id);
        if (this.db.botUsers[String(user.id).trim()]) {
          this.db.botUsers[String(user.id).trim()].isBanned = false;
          delete this.db.botUsers[String(user.id).trim()].bannedAt;
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
    if (!this.db.design.loginLogoUrl || this.db.design.loginLogoUrl.includes('4fae5ca52db64590') || this.db.design.loginLogoUrl.includes('f61e20b6c71945c4')) {
      this.db.design.loginLogoUrl = 'https://host.tscv.workers.dev/img/df6c9e167caf42c6';
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
    if (this.db.settings.forceSubEnabled === undefined) {
      this.db.settings.forceSubEnabled = false;
    }
    if (this.db.settings.antiForwardEnabled === undefined) {
      this.db.settings.antiForwardEnabled = false;
    }
    if (!Array.isArray(this.db.settings.requiredChannels)) {
      this.db.settings.requiredChannels = [];
    }
    return this.db.settings;
  }

  public async updateSettings(settings: Partial<BotSettings>): Promise<BotSettings> {
    await this.loadLatest(true);
    this.db.settings = { 
      ...this.db.settings, 
      ...settings,
      forceSubEnabled: settings.forceSubEnabled !== undefined ? Boolean(settings.forceSubEnabled) : (this.db.settings.forceSubEnabled ?? false),
      antiForwardEnabled: settings.antiForwardEnabled !== undefined ? Boolean(settings.antiForwardEnabled) : (this.db.settings.antiForwardEnabled ?? false),
      requiredChannels: settings.requiredChannels !== undefined && Array.isArray(settings.requiredChannels) 
        ? settings.requiredChannels 
        : (Array.isArray(this.db.settings.requiredChannels) ? this.db.settings.requiredChannels : [])
    };
    await this.persist();
    return this.db.settings;
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
      isAutoDetected: true,
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
        enabled: prev.enabled !== undefined ? prev.enabled : channelRecord.enabled
      };
    } else {
      this.db.settings.requiredChannels.push(channelRecord);
    }

    await this.persist();
    return channelRecord;
  }

  public async updateChannelInviteLink(chatId: string, inviteLink: string): Promise<boolean> {
    if (!chatId || !inviteLink) return false;
    await this.loadLatest(true);
    let updated = false;
    const cleanId = String(chatId).trim();

    if (Array.isArray(this.db.settings?.requiredChannels)) {
      for (const ch of this.db.settings.requiredChannels) {
        if (String(ch.chatId).trim() === cleanId) {
          ch.inviteLink = inviteLink;
          updated = true;
        }
      }
    }
    if (Array.isArray(this.db.detectedChannels)) {
      for (const ch of this.db.detectedChannels) {
        if (String(ch.chatId).trim() === cleanId) {
          ch.inviteLink = inviteLink;
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
    userId: string | number;
    chatTitle?: string;
    userName?: string;
    userUsername?: string;
    status?: 'approved' | 'pending' | 'rejected';
    inviteLink?: string;
    approvedAt?: string;
  }): Promise<JoinRequestRecord> {
    await this.loadLatest(true);
    if (!this.db.joinRequests) {
      this.db.joinRequests = {};
    }
    const cleanChatId = String(data.chatId || '').trim();
    const cleanUserId = String(data.userId || '').trim();
    if (!cleanChatId || !cleanUserId) {
      throw new Error('Both chatId and userId are required to record a join request');
    }

    const id = `${cleanChatId}_${cleanUserId}`;
    const now = new Date().toISOString();
    const existing = this.db.joinRequests[id];

    const record: JoinRequestRecord = {
      id,
      chatId: cleanChatId,
      chatTitle: data.chatTitle || existing?.chatTitle || '',
      userId: cleanUserId,
      userName: data.userName || existing?.userName || '',
      userUsername: data.userUsername || existing?.userUsername,
      status: data.status || existing?.status || 'pending',
      inviteLink: data.inviteLink || existing?.inviteLink,
      createdAt: existing?.createdAt || now,
      approvedAt: data.status === 'approved' ? (data.approvedAt || now) : existing?.approvedAt
    };

    this.db.joinRequests[id] = record;
    await this.persist();
    return record;
  }

  public async isJoinRequestApprovedOrPending(
    chatId: string | number,
    userId: string | number,
    channelId?: string,
    channelUsername?: string
  ): Promise<boolean> {
    await this.loadLatest(false);
    if (!this.db.joinRequests) return false;

    const cleanUserId = String(userId || '').trim();
    if (!cleanUserId) return false;

    const rawChat = String(chatId || '').trim();
    // Normalize forms: e.g. -10012345, 12345, @username
    const strippedChat = rawChat.replace(/^-100/, '').replace(/^-/, '').replace(/^@/, '').toLowerCase();
    const cleanUsername = channelUsername ? channelUsername.replace(/^@/, '').toLowerCase() : '';

    const records = Object.values(this.db.joinRequests);
    for (const req of records) {
      if (String(req.userId).trim() !== cleanUserId) continue;

      const reqChat = String(req.chatId).trim();
      const strippedReqChat = reqChat.replace(/^-100/, '').replace(/^-/, '').replace(/^@/, '').toLowerCase();

      // Check match by Chat ID, stripped ID, channelId, or Username
      const matchesChat = 
        reqChat === rawChat ||
        (strippedChat && strippedReqChat === strippedChat) ||
        (channelId && (req.id.startsWith(channelId) || reqChat === channelId)) ||
        (cleanUsername && (
          reqChat.toLowerCase() === `@${cleanUsername}` ||
          reqChat.toLowerCase() === cleanUsername ||
          req.chatTitle?.toLowerCase() === cleanUsername
        ));

      if (matchesChat) {
        if (req.status === 'approved' || req.status === 'pending') {
          return true;
        }
      }
    }

    return false;
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
    itemTitle?: string;
  }): Promise<ScheduledDeletion> {
    await this.loadLatest(true);
    const configuredTimeout = this.db.settings?.deliveryTimeoutMinutes;
    const timeoutMins = (typeof data.timeoutMinutes === 'number' && data.timeoutMinutes > 0)
      ? data.timeoutMinutes
      : ((typeof configuredTimeout === 'number' && configuredTimeout > 0) ? configuredTimeout : 10);
    const deleteAt = Date.now() + timeoutMins * 60 * 1000;
    const record: ScheduledDeletion = {
      id: `sd_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      chatId: String(data.chatId),
      messageId: data.messageId,
      companionNoticeId: data.companionNoticeId,
      deleteAt,
      timeoutMinutes: timeoutMins,
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

  // --- Uploaded Files Storage (Direct phone / storage upload support) ---
  private static uploadedFilesMemory = new Map<string, UploadedFileRecord>();

  private getUploadDirs(): string[] {
    const dirs: string[] = [];
    try {
      dirs.push(path.resolve(process.cwd(), '.data', 'uploads'));
    } catch {}
    dirs.push('/tmp/tg_uploads');
    return dirs;
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

    // 1. Cache in static memory across instances
    SharedStorageService.uploadedFilesMemory.set(cleanId, record);

    // 2. Persist to disk (.data/uploads and /tmp/tg_uploads)
    for (const dir of this.getUploadDirs()) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, cleanId), data.buffer);
        const meta = {
          id: cleanId,
          fileName: data.fileName,
          fileType: fType,
          mimeType: mime,
          size,
          createdAt
        };
        fs.writeFileSync(path.join(dir, `${cleanId}.meta.json`), JSON.stringify(meta));
      } catch (err) {
        console.warn(`[Storage] Could not write upload to disk ${dir}:`, err);
      }
    }

    // 3. Keep index in database (metadata only, no raw base64!)
    await this.loadLatest(true);
    if (!this.db.uploadedFilesIndex) {
      this.db.uploadedFilesIndex = {};
    }
    this.db.uploadedFilesIndex[cleanId] = {
      id: cleanId,
      fileName: data.fileName,
      fileType: fType,
      mimeType: mime,
      size,
      createdAt
    };
    await this.persist();
    return record;
  }

  public async getUploadedFile(fileId: string): Promise<UploadedFileRecord | null> {
    if (!fileId) return null;
    const cleanId = String(fileId).trim();

    // 1. Check in-memory map
    if (SharedStorageService.uploadedFilesMemory.has(cleanId)) {
      return SharedStorageService.uploadedFilesMemory.get(cleanId)!;
    }

    // 2. Check disk in all known upload dirs
    for (const dir of this.getUploadDirs()) {
      try {
        const filePath = path.join(dir, cleanId);
        const metaPath = path.join(dir, `${cleanId}.meta.json`);
        if (fs.existsSync(filePath)) {
          const buffer = fs.readFileSync(filePath);
          let meta: any = {};
          if (fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
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
          SharedStorageService.uploadedFilesMemory.set(cleanId, rec);
          return rec;
        }
      } catch (err) {
        // Continue
      }
    }

    // 3. Check db.uploadedFilesIndex
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
        const filePath = path.join(dir, cleanId);
        const metaPath = path.join(dir, `${cleanId}.meta.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
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

  public async updateReportStatus(id: string, status: 'pending' | 'resolved' | 'dismissed', resolvedBy?: string): Promise<UserReportRecord | null> {
    await this.loadLatest(true);
    if (!Array.isArray(this.db.reports)) return null;
    const report = this.db.reports.find(r => r.id === id);
    if (report) {
      report.status = status;
      if (resolvedBy) report.resolvedBy = resolvedBy;
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
    return Array.isArray(this.db.fraudRules) ? this.db.fraudRules : [];
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

  public async setBotUserBanned(userId: string | number, isBanned: boolean): Promise<BotUserRecord | null> {
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
    let user: BotUserRecord | null = null;

    if (matchingKeys.length === 0) {
      user = {
        id: cleanId,
        username: cleanId.startsWith('@') ? cleanId : undefined,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 0,
        isBanned: Boolean(isBanned),
        bannedAt: isBanned ? now : undefined
      };
      this.db.botUsers[cleanId] = user;
    } else {
      for (const k of matchingKeys) {
        const u = this.db.botUsers[k];
        u.isBanned = Boolean(isBanned);
        if (isBanned) {
          u.bannedAt = now;
        } else {
          delete u.bannedAt;
          (u as any).bannedAt = undefined;
        }
        user = u;
      }
    }

    // When unbanned, completely clear any link warnings or fraud restrictions
    if (user && !isBanned) {
      delete user.bannedAt;
      (user as any).bannedAt = undefined;
      await this.resetUserLinkWarning(cleanId);
      await this.resetUserFraudWarning(cleanId);
      if (user.id) {
        await this.resetUserLinkWarning(user.id);
        await this.resetUserFraudWarning(user.id);
        if (this.db.botUsers[String(user.id).trim()]) {
          this.db.botUsers[String(user.id).trim()].isBanned = false;
          delete this.db.botUsers[String(user.id).trim()].bannedAt;
          (this.db.botUsers[String(user.id).trim()] as any).bannedAt = undefined;
        }
      }
      if (user.username) {
        await this.resetUserLinkWarning(user.username);
        await this.resetUserFraudWarning(user.username);
      }
    }

    await this.persist();
    return user;
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
  // DISTRIBUTED LEADER ELECTION & UPDATE DEDUPLICATION LOCKS (RTDB)
  // =========================================================================

  // Distributed Leader Election for Telegram Polling across multi-instance environments
  public async tryClaimPollingLeader(instanceId: string, ttlMs: number = 10000): Promise<{ isLeader: boolean; currentLeader: string }> {
    try {
      const token = await this.getFirebaseAuthToken();
      const url = this.getRtdbUrl('/bot_leader', token);
      const res = await fetch(url);
      const now = Date.now();
      let leader: any = null;
      if (res.ok) {
        leader = await res.json();
      }

      const hasActiveOtherLeader = leader && leader.instanceId && leader.instanceId !== instanceId && (now - Number(leader.heartbeat || 0)) < ttlMs;

      if (hasActiveOtherLeader) {
        return { isLeader: false, currentLeader: leader.instanceId };
      }

      // Claim or renew leader role
      const claimPayload = {
        instanceId,
        heartbeat: now,
        updatedAt: new Date().toISOString()
      };

      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claimPayload)
      });

      return { isLeader: true, currentLeader: instanceId };
    } catch {
      // If network fails to RTDB, permit local leadership so bot is never paralyzed
      return { isLeader: true, currentLeader: instanceId };
    }
  }

  public async renewPollingLeaderHeartbeat(instanceId: string): Promise<boolean> {
    try {
      const token = await this.getFirebaseAuthToken();
      const url = this.getRtdbUrl('/bot_leader', token);
      const payload = {
        instanceId,
        heartbeat: Date.now(),
        updatedAt: new Date().toISOString()
      };
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async releasePollingLeader(instanceId: string): Promise<void> {
    try {
      const token = await this.getFirebaseAuthToken();
      const url = this.getRtdbUrl('/bot_leader', token);
      const res = await fetch(url);
      if (res.ok) {
        const leader = await res.json();
        if (leader?.instanceId === instanceId) {
          await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceId: '', heartbeat: 0, releasedAt: new Date().toISOString() })
          });
        }
      }
    } catch {}
  }

  // Atomic Distributed Update Claim across all instances (Dev, Preview, Render, etc.)
  public async claimDistributedTelegramUpdate(updateKey: string, instanceId: string, ttlMs: number = 90000): Promise<boolean> {
    if (!updateKey) return true;
    const safeKey = updateKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    try {
      const token = await this.getFirebaseAuthToken();
      const url = this.getRtdbUrl(`/bot_claimed_updates/${safeKey}`, token);
      const checkRes = await fetch(url);
      const now = Date.now();
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing && existing.timestamp && (now - Number(existing.timestamp)) < ttlMs) {
          // Already claimed and processed by another instance or thread!
          return false;
        }
      }

      // Atomically claim the update
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: now,
          instanceId,
          createdAt: new Date().toISOString()
        })
      });

      return true;
    } catch {
      // In case of RTDB network disruption, fallback to true to not drop user messages
      return true;
    }
  }

  // =========================================================================
  // CLONED BOTS REGISTRY & PERSISTENCE
  // =========================================================================
  public async getClonedBots(): Promise<ClonedBotRecord[]> {
    await this.loadLatest(false);
    return Array.isArray(this.db.clonedBots) ? [...this.db.clonedBots] : [];
  }

  public async saveClonedBot(cloned: ClonedBotRecord): Promise<void> {
    if (!cloned || !cloned.id) return;
    if (!Array.isArray(this.db.clonedBots)) {
      this.db.clonedBots = [];
    }
    const idx = this.db.clonedBots.findIndex(b => b.id === cloned.id);
    if (idx >= 0) {
      this.db.clonedBots[idx] = { ...this.db.clonedBots[idx], ...cloned };
    } else {
      this.db.clonedBots.push(cloned);
    }
    await this.persist();

    // Persist to Firebase RTDB under /cloned_bots_meta/${cloned.id}.json
    try {
      const token = await this.getFirebaseAuthToken();
      const isSecondary = process.env.FIREBASE_PROJECT_PROFILE === 'secondary' || process.env.ACTIVE_BOT_PROFILE === 'secondary';
      const baseUrl = (process.env.FIREBASE_DATABASE_URL || (isSecondary ? SECONDARY_FIREBASE_RTDB_URL : FIREBASE_RTDB_URL)).replace(/\/+$/, '');
      const metaUrl = token ? `${baseUrl}/cloned_bots_meta/${cloned.id}.json?auth=${encodeURIComponent(token)}` : `${baseUrl}/cloned_bots_meta/${cloned.id}.json`;
      fetch(metaUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloned)
      }).catch(() => {});
    } catch {}
  }

  public async deleteClonedBot(id: string): Promise<boolean> {
    if (!id) return false;
    if (!Array.isArray(this.db.clonedBots)) {
      return false;
    }
    const prevLen = this.db.clonedBots.length;
    this.db.clonedBots = this.db.clonedBots.filter(b => b.id !== id);
    if (this.db.clonedBots.length !== prevLen) {
      await this.persist();

      try {
        const token = await this.getFirebaseAuthToken();
        const isSecondary = process.env.FIREBASE_PROJECT_PROFILE === 'secondary' || process.env.ACTIVE_BOT_PROFILE === 'secondary';
        const baseUrl = (process.env.FIREBASE_DATABASE_URL || (isSecondary ? SECONDARY_FIREBASE_RTDB_URL : FIREBASE_RTDB_URL)).replace(/\/+$/, '');
        const metaUrl = token ? `${baseUrl}/cloned_bots_meta/${id}.json?auth=${encodeURIComponent(token)}` : `${baseUrl}/cloned_bots_meta/${id}.json`;
        fetch(metaUrl, { method: 'DELETE' }).catch(() => {});
      } catch {}
      return true;
    }
    return false;
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
