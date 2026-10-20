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
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'disabled';
  deliveryCount: number;
  inFiltersList?: boolean;
  retentionType?: 'permanent' | 'temporary';
  retentionDays?: number;
  expiresAt?: string;
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
  interactionCount: number;
  isBanned?: boolean;
  bannedAt?: string;
}

export interface AppDatabase {
  items: ItemRecord[];
  templates: Record<string, MessageTemplate>;
  admins: AdminUser[];
  sessions: SessionRecord[];
  webcodes: WebCodeRecord[];
  trackedMessages: Record<string, TrackedMessage[]>;
  scheduledDeletions?: ScheduledDeletion[];
  design: DesignConfig;
  settings: BotSettings;
  addSessions?: Record<string, any>;
  botUsers?: Record<string, BotUserRecord>;
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
    content: '🔒 Get File Privately',
    variables: []
  },
  GET_LINK_BUTTON: {
    key: 'GET_LINK_BUTTON',
    name: 'Get Link Button Text',
    description: 'Text of the inline deep-link button in the group for links',
    content: '🔒 Open Privately',
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
  loginLogoUrl: 'https://host.tscv.workers.dev/img/4fae5ca52db64590',
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
  autoDeleteNoticeEnabled: false
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
      design: { ...DEFAULT_DESIGN },
      settings: { ...DEFAULT_SETTINGS }
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
        design: { ...DEFAULT_DESIGN, ...(loadedData.design || {}) },
        settings: {
          ...DEFAULT_SETTINGS,
          ...(loadedData.settings || {}),
          botToken: process.env.TELEGRAM_BOT_TOKEN || loadedData.settings?.botToken || '',
          rootAdminId: process.env.ROOT_ADMIN_ID || loadedData.settings?.rootAdminId || '',
          autoDeleteNoticeEnabled: loadedData.settings?.autoDeleteNoticeEnabled ?? false
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

  // --- Bot Unique Users Tracking ---
  public async trackBotUser(user: {
    id: string | number;
    username?: string;
    firstName?: string;
    lastName?: string;
  }): Promise<void> {
    if (!user || !user.id) return;
    const userId = String(user.id).trim();
    if (!userId) return;

    await this.loadLatest(false);
    if (!this.db.botUsers) {
      this.db.botUsers = {};
    }

    const now = new Date().toISOString();
    const existing = this.db.botUsers[userId];
    if (existing) {
      existing.lastActiveAt = now;
      existing.interactionCount = (existing.interactionCount || 1) + 1;
      if (user.username) existing.username = user.username;
      if (user.firstName) existing.firstName = user.firstName;
      if (user.lastName) existing.lastName = user.lastName;
    } else {
      this.db.botUsers[userId] = {
        id: userId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 1
      };
    }
    await this.persist();
  }

  public async getTotalUserCount(): Promise<number> {
    await this.loadLatest(false);
    if (!this.db.botUsers) return 0;
    return Object.keys(this.db.botUsers).length;
  }

  public async getBotUsers(): Promise<BotUserRecord[]> {
    await this.loadLatest(false);
    if (!this.db.botUsers) return [];
    return Object.values(this.db.botUsers).sort((a, b) => 
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    );
  }

  public async isUserBanned(userId: string | number): Promise<boolean> {
    if (!userId) return false;
    await this.loadLatest(false);
    return Boolean(this.db.botUsers?.[String(userId).trim()]?.isBanned);
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

    let user = this.db.botUsers[cleanId];
    if (!user) {
      const now = new Date().toISOString();
      user = {
        id: cleanId,
        firstSeenAt: now,
        lastActiveAt: now,
        interactionCount: 0,
        isBanned: true,
        bannedAt: now
      };
      this.db.botUsers[cleanId] = user;
    } else {
      user.isBanned = !user.isBanned;
      user.bannedAt = user.isBanned ? new Date().toISOString() : undefined;
    }
    await this.persist();
    return user;
  }

  // --- Design ---
  public async getDesign(): Promise<DesignConfig> {
    await this.loadLatest(false);
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
    return this.db.settings;
  }

  public async updateSettings(settings: Partial<BotSettings>): Promise<BotSettings> {
    await this.loadLatest(true);
    this.db.settings = { ...this.db.settings, ...settings };
    await this.persist();
    return this.db.settings;
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
}

export const sharedStorage = new SharedStorageService();
