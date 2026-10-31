import { getStore } from '@netlify/blobs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
  action: 'warn' | 'delete' | 'delete_and_warn' | 'mute' | 'ban';
  duration?: 'permanent' | '1h' | '6h' | '24h' | '7d' | '30d';
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
    content: "👋 <b>Welcome {user_name}!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> {bot_name}\n\n✨ <i>Send any hashtag (e.g., #box, #crack) in your group or here to receive your files privately!</i>",
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
  loginLogoUrl: 'https://host.tscv.workers.dev/img/f61e20b6c71945c4',
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
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  botUsername: '',
  rootAdminId: process.env.ROOT_ADMIN_ID || '',
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

const BLOB_STORE_NAME = 'tg-bot-data';
const BLOB_STORE_KEY = 'app_db';

// Fallback paths for local development or non-Netlify environments
function getFallbackFilePaths(): string[] {
  const paths: string[] = [];
  try {
    paths.push(path.resolve(process.cwd(), '.data', 'store.json'));
  } catch {}
  paths.push('/tmp/tg_bot_store.json');
  return paths;
}

export class SharedStorageService {
  private db: AppDatabase;
  private blobStoreInstance: any = null;
  private lastLoadedAt: number = 0;

  constructor() {
    this.db = {
      items: [],
      templates: { ...DEFAULT_TEMPLATES },
      admins: [],
      sessions: [],
      webcodes: [],
      trackedMessages: {},
      scheduledDeletions: [],
      uploadedFilesIndex: {},
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

  // Obtains the Netlify Blobs store instance using strong consistency
  private async getBlobStore() {
    if (this.blobStoreInstance) return this.blobStoreInstance;
    try {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

      if (token && siteID) {
        this.blobStoreInstance = getStore({
          name: BLOB_STORE_NAME,
          siteID,
          token,
          consistency: 'strong'
        });
      } else {
        // Standard Netlify Functions runtime configuration
        this.blobStoreInstance = getStore({
          name: BLOB_STORE_NAME,
          consistency: 'strong'
        });
      }
      return this.blobStoreInstance;
    } catch (err: any) {
      // Netlify Blobs environment is not available in local dev/testing
      return null;
    }
  }

  // Always loads the freshest data to ensure serverless functions never rely on stale in-memory state
  public async loadLatest(force = true): Promise<AppDatabase> {
    const now = Date.now();
    // Cache for at most 500ms within a single function invocation, but reload on force or across invocations
    if (!force && this.lastLoadedAt > 0 && now - this.lastLoadedAt < 500) {
      return this.db;
    }

    let loadedData: Partial<AppDatabase> | null = null;

    // 1. Try reading from Netlify Blobs
    try {
      const store = await this.getBlobStore();
      if (store) {
        const raw = await store.get(BLOB_STORE_KEY, { type: 'json', consistency: 'strong' });
        if (raw && typeof raw === 'object') {
          loadedData = raw as Partial<AppDatabase>;
        }
      }
    } catch (err: any) {
      // Expected fallback when testing outside Netlify runtime
    }

    // 2. Fallback to local files if Netlify Blobs did not yield data
    if (!loadedData) {
      let freshestMtime = -1;
      let freshestJson: string | null = null;
      for (const filePath of getFallbackFilePaths()) {
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
        } catch {}
      }
    }

    if (loadedData) {
      this.db = {
        items: Array.isArray(loadedData.items) ? loadedData.items : [],
        templates: { ...DEFAULT_TEMPLATES, ...(loadedData.templates || {}) },
        admins: Array.isArray(loadedData.admins) ? loadedData.admins : [],
        sessions: Array.isArray(loadedData.sessions) ? loadedData.sessions : [],
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
          botToken: process.env.TELEGRAM_BOT_TOKEN || loadedData.settings?.botToken || '',
          rootAdminId: process.env.ROOT_ADMIN_ID || loadedData.settings?.rootAdminId || '',
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

    // Ensure root admin from ROOT_ADMIN_ID exists in admin list if configured
    const rootId = (process.env.ROOT_ADMIN_ID || this.db.settings.rootAdminId || '').trim();
    const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ROOT_ADMIN_PASSWORD || '').trim();

    if (rootId) {
      let rootAdmin = this.db.admins.find(a => a.id === rootId || a.telegramId === rootId);
      if (!rootAdmin && this.db.admins.length === 0) {
        // Bootstrap root admin with password from env or default
        const initPass = envAdminPassword || 'admin123';
        const defaultHash = await hashPassword(initPass);
        rootAdmin = {
          id: rootId,
          telegramId: rootId,
          name: 'Owner Admin',
          role: 'owner',
          passwordHash: defaultHash,
          permissions: { ...DEFAULT_PERMISSIONS },
          enabled: true,
          createdAt: new Date().toISOString()
        };
        this.db.admins.push(rootAdmin);
        await this.persist();
      } else if (rootAdmin && envAdminPassword) {
        // If an explicit ADMIN_PASSWORD is set in environment variables, ensure the root owner matches it
        const matchesEnv = await verifyPassword(envAdminPassword, rootAdmin.passwordHash);
        if (!matchesEnv) {
          rootAdmin.passwordHash = await hashPassword(envAdminPassword);
          await this.persist();
          console.info('[Storage] Updated root admin password hash from ADMIN_PASSWORD environment variable.');
        }
      }
    }

    this.lastLoadedAt = Date.now();
    return this.db;
  }

  // Alias for compatibility
  public async init(): Promise<void> {
    await this.loadLatest(true);
  }

  // Persists the current database to Netlify Blobs and disk fallback
  public async persist(): Promise<boolean> {
    let savedToBlobs = false;
    let savedToFile = false;

    // 1. Write to Netlify Blobs with strong consistency
    try {
      const store = await this.getBlobStore();
      if (store) {
        await store.setJSON(BLOB_STORE_KEY, this.db);
        savedToBlobs = true;
      }
    } catch (err: any) {
      // Ignored if local dev without Blobs
    }

    // 2. Also write to all local persistent files as fallback
    for (const filePath of getFallbackFilePaths()) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(this.db, null, 2), 'utf-8');
        savedToFile = true;
      } catch (err: any) {
        // Read-only filesystem in Lambda is expected, continue to next path
      }
    }

    if (!savedToBlobs && !savedToFile) {
      console.error('[Storage] Error: Persistence failed on all storage mechanisms.');
      return false;
    }

    this.lastLoadedAt = Date.now();

    // Trigger debounced real-time replication to silent backup mirror if enabled
    if (
      this.db.backupServer?.enabled &&
      this.db.backupServer?.role === 'primary' &&
      this.db.backupServer?.autoSyncOnSave &&
      this.db.backupServer?.serverUrl
    ) {
      this.scheduleSilentReplication();
    }

    return true;
  }

  // --- Admins & Auth ---
  public async getAdmin(id: string): Promise<AdminUser | null> {
    await this.loadLatest(true);
    const cleanId = String(id).trim().replace(/^@/, '');
    const rootAdminId = (process.env.ROOT_ADMIN_ID || this.db.settings.rootAdminId || '').trim();
    const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();

    // 1. Direct match on id, telegramId, or name (case-insensitive)
    const directMatch = this.db.admins.find(a => 
      String(a.id).trim() === cleanId || 
      String(a.telegramId).trim() === cleanId ||
      (a.name && a.name.trim().toLowerCase() === cleanId.toLowerCase())
    );
    if (directMatch) return directMatch;

    // 2. Normalized match (ignoring spaces & case e.g. "owneradmin", "admin", "owner")
    const cleanNormalized = cleanId.replace(/\s+/g, '').toLowerCase();
    const nameMatch = this.db.admins.find(a => 
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
  public async createSession(adminId: string, role: AdminRole): Promise<string> {
    await this.loadLatest(true);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
    
    // Purge expired sessions
    const now = Date.now();
    this.db.sessions = this.db.sessions.filter(s => s.expiresAt > now);
    
    this.db.sessions.push({
      token,
      adminId,
      role,
      expiresAt
    });

    await this.persist();
    return token;
  }

  public async getSession(token: string): Promise<SessionRecord | null> {
    await this.loadLatest(false);
    const now = Date.now();
    const session = this.db.sessions.find(s => s.token === token && s.expiresAt > now);
    return session || null;
  }

  public async deleteSession(token: string): Promise<void> {
    await this.loadLatest(true);
    this.db.sessions = this.db.sessions.filter(s => s.token !== token);
    await this.persist();
  }

  // --- Items ---
  public async getItems(): Promise<ItemRecord[]> {
    await this.checkAndCleanExpiredItems();
    await this.loadLatest(false);
    return this.db.items;
  }

  public async getItem(id: string): Promise<ItemRecord | null> {
    await this.loadLatest(false);
    const item = this.db.items.find(i => i.id === id);
    if (item && item.retentionType === 'temporary' && item.expiresAt) {
      if (Date.now() >= new Date(item.expiresAt).getTime()) {
        await this.checkAndCleanExpiredItems();
        return null;
      }
    }
    return item || null;
  }

  public async findItemByTrigger(trigger: string): Promise<ItemRecord | null> {
    await this.loadLatest(false);
    const cleanTrigger = trigger.trim();
    if (!cleanTrigger) return null;
    const lowerTrigger = cleanTrigger.toLowerCase();

    const isHashtag = cleanTrigger.startsWith('#');
    const isSlash = cleanTrigger.startsWith('/');

    const matched = this.db.items.find(item => {
      if (item.status !== 'active' || !Array.isArray(item.triggers) || item.triggers.length === 0) return false;

      // 1. Hashtag Commands (e.g., #box, #crack)
      // Must ONLY match items with triggers that explicitly start with '#'
      if (isHashtag) {
        return item.triggers.some(t => {
          const ct = t.trim().toLowerCase();
          return ct.startsWith('#') && ct === lowerTrigger;
        });
      }

      // 2. Slash Commands (e.g., /box)
      // Must ONLY match items with triggers that explicitly start with '/'
      if (isSlash) {
        const cleanSlash = lowerTrigger.replace(/@\w+$/, '');
        return item.triggers.some(t => {
          const ct = t.trim().toLowerCase();
          return ct.startsWith('/') && (ct === lowerTrigger || ct === cleanSlash);
        });
      }

      // 3. Normal Plain Text
      // Must NEVER match hashtag triggers or slash commands!
      return item.triggers.some(t => {
        const ct = t.trim().toLowerCase();
        // Ignore any hashtag or slash command trigger
        if (ct.startsWith('#') || ct.startsWith('/')) return false;
        return ct === lowerTrigger;
      });
    });

    if (matched && matched.retentionType === 'temporary' && matched.expiresAt) {
      if (Date.now() >= new Date(matched.expiresAt).getTime()) {
        await this.checkAndCleanExpiredItems();
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
    const index = this.db.items.findIndex(i => i.id === cleanItem.id);
    if (index >= 0) {
      this.db.items[index] = { ...this.db.items[index], ...cleanItem, updatedAt: new Date().toISOString() };
    } else {
      this.db.items.push(cleanItem);
    }
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
      return await this.persist();
    }
    return false;
  }

  // Auto-cleanup for temporary items whose lifespan/expiration has passed
  public async checkAndCleanExpiredItems(): Promise<string[]> {
    await this.loadLatest(true);
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
      await this.persist();
    }
    return expiredIds;
  }

  public async incrementItemDelivery(id: string): Promise<void> {
    await this.loadLatest(true);
    const item = this.db.items.find(i => i.id === id);
    if (item) {
      item.deliveryCount = (item.deliveryCount || 0) + 1;
      await this.persist();
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
  }): Promise<BotUserRecord | null> {
    if (!user || !user.id) return null;
    const userId = String(user.id).trim();
    if (!userId) return null;

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

    // Check if this user has admin privileges
    const admins = await this.getAdmins();
    const settings = await this.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim();
    const isAdmin = userId === rootAdminId || rootAdminId.includes(userId) || admins.some(a => String(a.telegramId).trim() === userId || String(a.id).trim() === userId);

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
      // User does NOT exist: save them instantly as a new user
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
      console.info(`[Storage] Registered new bot user: ${userId} (${record.username || record.firstName || 'User'})`);
    }

    await this.persist();
    return record;
  }

  public async getTotalUserCount(): Promise<number> {
    const users = await this.getBotUsers();
    return users.length;
  }

  public async getUserStats(): Promise<{ totalUsers: number; onlineUsers: number; offlineUsers: number }> {
    const users = await this.getBotUsers();
    const onlineUsers = users.filter(u => u.isOnline).length;
    const offlineUsers = Math.max(0, users.length - onlineUsers);
    return {
      totalUsers: users.length,
      onlineUsers,
      offlineUsers
    };
  }

  public async getBotUsers(): Promise<BotUserRecord[]> {
    await this.loadLatest(true);
    if (!this.db.botUsers) this.db.botUsers = {};

    const admins = await this.getAdmins();
    const settings = await this.getSettings();
    const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163').trim();

    const adminIds = new Set<string>();
    if (rootAdminId) adminIds.add(rootAdminId);
    for (const a of admins) {
      if (a.telegramId) adminIds.add(String(a.telegramId).trim());
      if (a.id) adminIds.add(String(a.id).trim());
    }

    // Requirement 2: Ensure all registered admins are included in the user list even before initial telegram interaction
    let changed = false;
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
      await this.persist();
    }

    const nowMs = Date.now();
    return Object.values(this.db.botUsers)
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

    await this.persist();
    return user;
  }

  // --- Design ---
  public async getDesign(): Promise<DesignConfig> {
    await this.loadLatest(false);
    // Auto-migrate legacy default logo asset if still stored
    if (!this.db.design.loginLogoUrl || this.db.design.loginLogoUrl.includes('4fae5ca52db64590')) {
      this.db.design.loginLogoUrl = 'https://host.tscv.workers.dev/img/f61e20b6c71945c4';
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
    const timeoutMins = data.timeoutMinutes && data.timeoutMinutes > 0 ? data.timeoutMinutes : 10;
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

    // Also include any message IDs currently in scheduledDeletions for this chat
    const scheduledMsgIds: number[] = [];
    if (Array.isArray(this.db.scheduledDeletions)) {
      const remaining: ScheduledDeletion[] = [];
      for (const item of this.db.scheduledDeletions) {
        if (String(item.chatId) === key) {
          scheduledMsgIds.push(item.messageId);
          if (item.companionNoticeId) scheduledMsgIds.push(item.companionNoticeId);
        } else {
          remaining.push(item);
        }
      }
      this.db.scheduledDeletions = remaining;
    }

    await this.persist();

    // Return unique message IDs that need deletion
    const allMsgIds = Array.from(new Set([...recordedList, ...scheduledMsgIds])).filter(Boolean);
    return allMsgIds;
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

    // 4. Try persisting to Netlify Blobs if available
    try {
      const store = await this.getBlobStore();
      if (store) {
        await store.set(`upload_${cleanId}`, data.buffer, {
          metadata: {
            fileName: data.fileName,
            fileType: fType,
            mimeType: mime
          }
        });
      }
    } catch (err) {
      // Blobs optional
    }

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

    // 5. Check Netlify Blobs
    try {
      const store = await this.getBlobStore();
      if (store) {
        const blobData = await store.get(`upload_${cleanId}`, { type: 'arrayBuffer' });
        if (blobData) {
          const buffer = Buffer.from(blobData);
          const meta = (await store.getMetadata(`upload_${cleanId}`)) || {};
          const rec: UploadedFileRecord = {
            id: cleanId,
            fileName: meta.metadata?.fileName || 'file',
            fileType: meta.metadata?.fileType || 'document',
            mimeType: meta.metadata?.mimeType || 'application/octet-stream',
            size: buffer.length,
            buffer,
            createdAt: new Date().toISOString()
          };
          SharedStorageService.uploadedFilesMemory.set(cleanId, rec);
          return rec;
        }
      }
    } catch {}

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
}

export const sharedStorage = new SharedStorageService();
