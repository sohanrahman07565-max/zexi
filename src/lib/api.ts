export type TriggerType = 'hashtag' | 'slash' | 'normal';
export type OpenMode = 'browser' | 'webapp';
export type BotOperationalMode = 'file_bot' | 'post_bot';

export interface AdminUser {
  id: string;
  telegramId: string;
  name: string;
  username?: string;
  photoUrl?: string;
  role: 'owner' | 'subadmin';
  botId?: string;
  enabled?: boolean;
  lastLoginAt?: string;
  permissions: {
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
  };
}

export interface ItemRecord {
  id: string;
  type: 'file' | 'link';
  name: string;
  triggers: string[];
  triggerType: 'hashtag' | 'slash' | 'normal';
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
  openMode?: 'browser' | 'webapp';
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
  setupVideoTelegramFileId?: string;
  setupVideoType?: 'url' | 'upload';
  setupVideoFileName?: string;
  setupVideoButtonText?: string;
  setupResourceButtonText?: string;
  setupVideoMessage?: string;
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
  chatId: string;
  title?: string;
  type?: 'group' | 'supergroup' | 'channel';
  username?: string;
  addedAt: string;
  addedBy?: string;
}

export interface BotSettings {
  botToken: string;
  botUsername: string;
  rootAdminId: string;
  maxBotMessagesPerChat: number;
  dailyCleanupEnabled: boolean;
  cleanupAgeHours: number;
  autoDeleteDeliveryEnabled?: boolean;
  deliveryTimeoutMinutes?: number;
  autoDeleteNoticeEnabled?: boolean;
  maintenanceMode?: boolean;
  maintenanceNotice?: string;
  botTokenMasked?: string;
  hasToken?: boolean;
  isConnected?: boolean;
  forceSubEnabled?: boolean;
  forceJoinMode?: 'auto_join' | 'request_only';
  requiredChannels?: ForceSubChannel[];
  autoApproveJoinRequests?: boolean;
  antiForwardEnabled?: boolean;
  linkDeleteEnabled?: boolean;
  botMode?: BotOperationalMode;
  chatWhitelistEnabled?: boolean;
  allowedChats?: AllowedChatEntry[];
  botStopped?: boolean;
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
  isAdmin?: boolean;
}

export interface UserReportRecord {
  id: string;
  reporterId: string;
  reporterName?: string;
  reporterUsername?: string;
  reportedUserId: string;
  reportedUserName?: string;
  reportedUserUsername?: string;
  reason: string;
  chatId?: string;
  chatTitle?: string;
  messageId?: number;
  reportedContent?: string;
  createdAt: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface FraudKeywordRule {
  id: string;
  keyword: string;
  matchType: 'contains' | 'exact' | 'regex';
  action: 'delete' | 'warn' | 'delete_and_warn' | 'mute' | 'ban' | 'reply_only';
  duration?: string; // Custom minutes/hours e.g. "30m", "2h", "1d" or "permanent"
  maxWarnings?: number;
  customMessage?: string;
  warningText?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'voice' | 'text' | 'none';
  enabled: boolean;
  createdAt: string;
}

export interface BotInstance {
  id: string;
  name: string;
  username: string;
  isMain: boolean;
  status: 'active' | 'stopped';
  botMode?: BotOperationalMode;
  filesCount: number;
  usersCount: number;
  createdAt?: string;
  ownerId?: string;
  ownerUsername?: string;
  adminUsername?: string;
  adminPassword?: string;
  panelUrl?: string;
}

const TOKEN_KEY = 'tg_admin_token';
const BOT_ID_KEY = 'tg_active_bot_id';
let memoryTokenFallback: string | null = null;
let memoryBotIdFallback: string | null = null;

export function getUrlBotId(): string | null {
  try {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlBotId = (urlParams.get('bot_id') || urlParams.get('botId') || '').trim();
      return urlBotId || null;
    }
  } catch {}
  return null;
}

export function getActiveBotId(): string {
  const urlBotId = getUrlBotId();
  if (urlBotId) {
    memoryBotIdFallback = urlBotId;
    try { window.localStorage?.setItem(BOT_ID_KEY, urlBotId); } catch {}
    try { window.sessionStorage?.setItem(BOT_ID_KEY, urlBotId); } catch {}
    return urlBotId;
  }
  const hasToken = Boolean(getStoredToken());
  if (!hasToken) {
    memoryBotIdFallback = 'main';
    return 'main';
  }
  try {
    const stored = window.localStorage?.getItem(BOT_ID_KEY) || window.sessionStorage?.getItem(BOT_ID_KEY);
    if (stored) {
      memoryBotIdFallback = stored;
      return stored;
    }
  } catch {}
  return memoryBotIdFallback || 'main';
}

export function setActiveBotId(botId: string): void {
  const cleanId = (botId || 'main').trim() || 'main';
  memoryBotIdFallback = cleanId;
  try { window.localStorage?.setItem(BOT_ID_KEY, cleanId); } catch {}
  try { window.sessionStorage?.setItem(BOT_ID_KEY, cleanId); } catch {}
}

function getStoredToken(): string | null {
  if (memoryTokenFallback) return memoryTokenFallback;
  try {
    if (typeof window !== 'undefined') {
      const t = window.localStorage?.getItem(TOKEN_KEY) || window.sessionStorage?.getItem(TOKEN_KEY);
      if (t) {
        memoryTokenFallback = t;
        return t;
      }
    }
  } catch {}
  return null;
}

function storeToken(token: string): void {
  memoryTokenFallback = token;
  try { window.localStorage?.setItem(TOKEN_KEY, token); } catch {}
  try { window.sessionStorage?.setItem(TOKEN_KEY, token); } catch {}
}

function wipeLocalAuthStorage(): void {
  memoryTokenFallback = null;
  const urlBotId = getUrlBotId();
  memoryBotIdFallback = urlBotId || 'main';
  try {
    window.localStorage?.removeItem(TOKEN_KEY);
    if (!urlBotId) {
      window.localStorage?.removeItem(BOT_ID_KEY);
    }
  } catch {}
  try {
    window.sessionStorage?.clear();
    if (urlBotId) {
      window.sessionStorage?.setItem(BOT_ID_KEY, urlBotId);
    }
  } catch {}
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const activeBotId = getActiveBotId();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('x-bot-id')) {
    headers.set('x-bot-id', activeBotId);
  }
  const isAuthOrStatus = url.includes('/api/auth/') || url.includes('/api/bot/info');
  return fetch(url, {
    ...options,
    headers,
    cache: isAuthOrStatus ? 'no-store' : options.cache,
    credentials: 'include'
  });
}

export const api = {
  setToken(token: string): void {
    storeToken(token);
  },

  getToken(): string | null {
    return getStoredToken();
  },

  clearToken(): void {
    wipeLocalAuthStorage();
  },

  async getMe(): Promise<{ admin: AdminUser; botId?: string } | null> {
    try {
      const res = await authFetch('/api/auth/me');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async getAuthAvatarBlobUrl(): Promise<string | null> {
    try {
      const res = await authFetch('/api/auth/avatar');
      if (res.status !== 200) return null;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return null;
      const blob = await res.blob();
      if (!blob || blob.size === 0) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },

  async login(telegramId: string, password: string): Promise<{ success: boolean; admin: AdminUser; token?: string; botId?: string; error?: string }> {
    const activeBotId = getActiveBotId();
    const res = await authFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, username: telegramId, password, bot_id: activeBotId })
    });
    const data = await res.json();
    if (!res.ok) {
      const err: any = new Error(data.error || 'Login failed');
      err.field = data.field;
      throw err;
    }
    if (data.token) {
      storeToken(data.token);
    }
    if (data.botId) {
      setActiveBotId(data.botId);
    }
    return data;
  },

  async firebaseLogin(payload: { idToken?: string; email?: string | null; displayName?: string | null; password?: string }): Promise<{ success: boolean; admin: AdminUser; token?: string; botId?: string; error?: string }> {
    const res = await authFetch('/api/auth/firebase-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const err: any = new Error(data.error || 'Firebase authentication failed');
      err.field = data.field;
      throw err;
    }
    if (data.token) {
      storeToken(data.token);
    }
    if (data.botId) {
      setActiveBotId(data.botId);
    }
    return data;
  },

  async telegramLogin(tgUser: any): Promise<{ success: boolean; admin: AdminUser; token?: string; botId?: string; error?: string }> {
    const res = await authFetch('/api/auth/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgUser)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Telegram authentication failed');
    if (data.token) {
      storeToken(data.token);
    }
    if (data.botId) {
      setActiveBotId(data.botId);
    }
    return data;
  },

  async tmaLogin(initData: string): Promise<{ success: boolean; admin: AdminUser; token?: string; botId?: string; error?: string }> {
    const urlBotId = getUrlBotId();
    const res = await authFetch('/api/auth/tma', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tma-init-data': initData
      },
      body: JSON.stringify({
        initData,
        ...(urlBotId ? { bot_id: urlBotId } : {})
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Telegram Mini App authentication failed');
    if (data.token) {
      storeToken(data.token);
    }
    if (data.botId) {
      setActiveBotId(data.botId);
    }
    return data;
  },

  async validateCredentials(username: string, password: string): Promise<{ valid: boolean }> {
    try {
      const activeBotId = getActiveBotId();
      const res = await authFetch('/api/auth/validate-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, telegramId: username, password, bot_id: activeBotId })
      });
      if (!res.ok) return { valid: false };
      return await res.json();
    } catch {
      return { valid: false };
    }
  },

  async logout(): Promise<void> {
    const previousToken = getStoredToken();
    const activeBotId = getActiveBotId();
    try {
      const headers = new Headers({ 'x-bot-id': activeBotId });
      if (previousToken) {
        headers.set('Authorization', `Bearer ${previousToken}`);
      }
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers,
        cache: 'no-store',
        credentials: 'include',
        keepalive: true
      }).catch(() => {});
    } finally {
      wipeLocalAuthStorage();
    }
  },

  async forgotPassword(telegramId: string, code: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, code, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password reset failed');
    return data;
  },

  async setupOwner(telegramId: string, name: string, password: string): Promise<any> {
    const res = await fetch('/api/auth/setup-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, name, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Owner setup failed');
    return data;
  },

  async getLoginDesign(): Promise<any> {
    const res = await fetch('/api/auth/login-design');
    return await res.json();
  },

  // Items
  async getItems(): Promise<ItemRecord[]> {
    const res = await authFetch('/api/items');
    if (!res.ok) throw new Error('Failed to fetch items');
    return await res.json();
  },

  async createItem(item: Partial<ItemRecord>): Promise<{ success: boolean; item: ItemRecord }> {
    const res = await authFetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create item');
    return data;
  },

  async updateItem(id: string, item: Partial<ItemRecord>): Promise<{ success: boolean; item: ItemRecord }> {
    const res = await authFetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update item');
    return data;
  },

  async deleteItem(id: string): Promise<{ success: boolean }> {
    const res = await authFetch(`/api/items/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete item');
    return data;
  },

  async uploadFile(
    payload: FormData | {
      fileName: string;
      fileType: 'document' | 'photo' | 'video' | 'audio';
      fileBase64?: string;
      caption?: string;
    },
    onProgress?: (percent: number, loadedBytes: number, totalBytes: number) => void
  ): Promise<{ success: boolean; fileId: string; uploadedFileId?: string; fileUniqueId?: string; fileName: string; fileSize: number; warning?: string }> {
    const parseResponseSafe = async (res: Response, fallbackMsg: string): Promise<any> => {
      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        if (res.status === 413) {
          return { error: 'Payload too large for gateway (HTTP 413)' };
        }
        const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return { error: stripped ? `${fallbackMsg} (HTTP ${res.status}): ${stripped.slice(0, 140)}` : `${fallbackMsg} (HTTP ${res.status})` };
      }
    };

    const uploadViaChunks = async (
      fileBlob: Blob,
      fileName: string,
      fileType: string,
      caption: string | undefined,
      chunkSizeBytes: number
    ) => {
      const totalSize = fileBlob.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / chunkSizeBytes));
      const mimeType = fileBlob.type || 'application/octet-stream';

      const initRes = await authFetch('/api/items/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          fileSize: totalSize,
          mimeType,
          fileType,
          totalChunks,
          chunkSize: chunkSizeBytes
        })
      });
      const initData = await parseResponseSafe(initRes, 'Failed to initialize upload');
      if (!initRes.ok || !initData?.uploadId) {
        throw new Error(initData?.error || 'Failed to initialize chunked upload');
      }

      const uploadId = String(initData.uploadId);

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSizeBytes;
        const end = Math.min(totalSize, start + chunkSizeBytes);
        const chunkSlice = fileBlob.slice(start, end);

        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const chunkRes = await authFetch(
              `/api/items/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${i}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunkSlice
              }
            );
            const chunkData = await parseResponseSafe(chunkRes, `Chunk ${i + 1}/${totalChunks} failed`);
            if (!chunkRes.ok) {
              throw new Error(chunkData?.error || `Chunk ${i + 1}/${totalChunks} failed (HTTP ${chunkRes.status})`);
            }
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }
        }
        if (lastErr) {
          throw lastErr;
        }
        if (onProgress) {
          const pct = Math.min(95, Math.round(((i + 1) / totalChunks) * 95));
          onProgress(pct, end, totalSize);
        }
      }

      const completeRes = await authFetch('/api/items/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          fileName,
          fileType,
          mimeType,
          fileSize: totalSize,
          totalChunks,
          caption
        })
      });
      const completeData = await parseResponseSafe(completeRes, 'Failed to finalize upload');
      if (!completeRes.ok) {
        throw new Error(completeData?.error || 'Failed to finalize upload');
      }
      if (onProgress) {
        onProgress(100, totalSize, totalSize);
      }
      return completeData;
    };

    const isFormData = payload instanceof FormData;
    if (isFormData) {
      const rawFile = payload.get('file');
      const fileName = String(payload.get('fileName') || (rawFile instanceof File ? rawFile.name : 'file'));
      const fileType = String(payload.get('fileType') || 'document');
      const rawCaption = payload.get('caption');
      const caption = typeof rawCaption === 'string' && rawCaption ? rawCaption : undefined;

      const DIRECT_THRESHOLD = 4 * 1024 * 1024; // Use chunked upload above 4MB to avoid reverse-proxy 413/timeout
      if (rawFile instanceof Blob && rawFile.size > DIRECT_THRESHOLD) {
        return await uploadViaChunks(rawFile, fileName, fileType, caption, 4 * 1024 * 1024);
      }

      const res = await authFetch('/api/items/upload', {
        method: 'POST',
        body: payload
      });
      if (res.status === 413 && rawFile instanceof Blob) {
        // Fallback to 1MB chunks if a strict proxy rejects even <= 4MB direct uploads
        return await uploadViaChunks(rawFile, fileName, fileType, caption, 1024 * 1024);
      }
      const data = await parseResponseSafe(res, 'Failed to upload file');
      if (!res.ok) throw new Error(data?.error || 'Failed to upload file');
      if (onProgress && rawFile instanceof Blob) {
        onProgress(100, rawFile.size, rawFile.size);
      }
      return data;
    }

    const res = await authFetch('/api/items/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseResponseSafe(res, 'Failed to upload file');
    if (!res.ok) throw new Error(data?.error || 'Failed to upload file');
    return data;
  },

  // Templates
  async getTemplates(): Promise<Record<string, MessageTemplate>> {
    const res = await authFetch('/api/templates');
    if (!res.ok) throw new Error('Failed to load templates');
    return await res.json();
  },

  async updateTemplate(
    key: string,
    content: string,
    extra?: { mediaType?: 'none' | 'photo' | 'video'; mediaUrl?: string; buttons?: TemplateButton[] }
  ): Promise<{ success: boolean; template?: MessageTemplate }> {
    const res = await authFetch(`/api/templates/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update template');
    return data;
  },

  async resetTemplates(): Promise<any> {
    const res = await authFetch('/api/templates-reset', {
      method: 'PUT'
    });
    return await res.json();
  },

  async getStats(): Promise<{
    totalUsers: number;
    onlineUsers: number;
    offlineUsers: number;
    totalDeliveries: number;
    totalTriggers: number;
    totalItems: number;
    trackedCount: number;
    adminsCount: number;
  }> {
    const res = await authFetch('/api/stats');
    if (!res.ok) throw new Error('Failed to load stats');
    return await res.json();
  },

  // Admins
  async getAdmins(): Promise<Omit<AdminUser, 'passwordHash'>[]> {
    const res = await authFetch('/api/admins');
    if (!res.ok) throw new Error('Failed to load admins');
    return await res.json();
  },

  async createAdmin(payload: any): Promise<any> {
    const res = await authFetch('/api/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create admin');
    return data;
  },

  async updateAdmin(id: string, payload: any): Promise<any> {
    const res = await authFetch(`/api/admins/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update admin');
    return data;
  },

  async deleteAdmin(id: string): Promise<any> {
    const res = await authFetch(`/api/admins/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete admin');
    return data;
  },

  async generateAdminToken(id: string): Promise<{ success: boolean; accessToken: string; botId: string }> {
    const res = await authFetch(`/api/admins/${encodeURIComponent(id)}/token`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate access token');
    return data;
  },

  async grantAdmin(
    userId: string,
    payload: {
      name?: string;
      username?: string;
      password?: string;
      role?: 'owner' | 'subadmin';
      permissions?: Partial<AdminUser['permissions']>;
    }
  ): Promise<{ success: boolean; admin: AdminUser; accessToken: string; generatedPassword?: string }> {
    const res = await authFetch(`/api/users/${encodeURIComponent(userId)}/grant-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to grant admin permissions');
    return data;
  },

  async revokeAdmin(userId: string): Promise<{ success: boolean; message?: string }> {
    const res = await authFetch(`/api/users/${encodeURIComponent(userId)}/revoke-admin`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to revoke admin permissions');
    return data;
  },

  // Design
  async getDesign(): Promise<DesignConfig> {
    const res = await authFetch('/api/design');
    if (!res.ok) throw new Error('Failed to load design');
    return await res.json();
  },

  async updateDesign(design: Partial<DesignConfig>): Promise<{ success: boolean; design: DesignConfig }> {
    const res = await authFetch('/api/design', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(design)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update design');
    return data;
  },

  // Settings
  async getSettings(): Promise<BotSettings> {
    const res = await authFetch('/api/settings');
    if (!res.ok) throw new Error('Failed to load settings');
    return await res.json();
  },

  async updateSettings(settings: Partial<BotSettings>): Promise<{ success: boolean; settings: BotSettings }> {
    const res = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update settings');
    return data;
  },

  async syncChannels(): Promise<{ success: boolean; channels: ForceSubChannel[]; message: string }> {
    const res = await authFetch('/api/settings/sync-channels', {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to auto-detect channels');
    return data;
  },

  async toggleChannel(channelId: string, enabled?: boolean): Promise<{ success: boolean; channel: ForceSubChannel }> {
    const res = await authFetch('/api/settings/toggle-channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, enabled })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to toggle channel');
    return data;
  },

  async getJoinRequests(): Promise<{ success: boolean; requests: JoinRequestRecord[] }> {
    const res = await authFetch('/api/settings/join-requests');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch join requests');
    return data;
  },

  async approveJoinRequest(chatId: string, userId: string): Promise<{ success: boolean; result: any }> {
    const res = await authFetch('/api/settings/approve-join-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, userId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to approve join request');
    return data;
  },

  // Chat Whitelist / Ignore Management
  async getChatWhitelist(): Promise<{ success: boolean; chatWhitelistEnabled: boolean; allowedChats: AllowedChatEntry[] }> {
    const res = await authFetch('/api/chat-whitelist');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch chat whitelist');
    return data;
  },

  async toggleChatWhitelist(enabled: boolean): Promise<{ success: boolean; chatWhitelistEnabled: boolean; allowedChats: AllowedChatEntry[] }> {
    const res = await authFetch('/api/chat-whitelist/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update chat whitelist mode');
    return data;
  },

  async addAllowedChat(payload: {
    chatId: string;
    title?: string;
    type?: 'group' | 'supergroup' | 'channel';
    username?: string;
  }): Promise<{ success: boolean; chatWhitelistEnabled: boolean; allowedChats: AllowedChatEntry[] }> {
    const res = await authFetch('/api/chat-whitelist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add chat to whitelist');
    return data;
  },

  async removeAllowedChat(chatId: string): Promise<{ success: boolean; chatWhitelistEnabled: boolean; allowedChats: AllowedChatEntry[] }> {
    const res = await authFetch(`/api/chat-whitelist/${encodeURIComponent(chatId)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove chat from whitelist');
    return data;
  },

  async setWebhook(appUrl: string): Promise<any> {
    const res = await authFetch('/api/bot/set-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appUrl })
    });
    return await res.json();
  },

  async getBotInfo(): Promise<any> {
    const res = await authFetch('/api/bot/info');
    return await res.json();
  },

  // Cleanup
  async getCleanupStatus(): Promise<any> {
    const res = await authFetch('/api/cleanup/status');
    return await res.json();
  },

  async runCleanup(hours?: number): Promise<any> {
    const res = await authFetch('/api/cleanup/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours })
    });
    return await res.json();
  },

  // Simulator
  async simulate(input: string, chatType: 'group' | 'private' = 'group'): Promise<any> {
    const res = await authFetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, chatType })
    });
    return await res.json();
  },

  // Users Management
  async getUsers(): Promise<BotUserRecord[]> {
    const res = await authFetch('/api/users');
    if (!res.ok) throw new Error('Failed to load users');
    return await res.json();
  },

  async toggleBanUser(userId: string): Promise<{ success: boolean; user: BotUserRecord }> {
    const res = await authFetch(`/api/users/${userId}/ban`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update ban status');
    return data;
  },

  // Broadcast System
  async sendBroadcast(payload: FormData | {
    message?: string;
    mediaType: 'text' | 'photo' | 'video' | 'audio' | 'voice';
    mediaUrl?: string;
    pinMessage?: boolean;
  }): Promise<{ success: boolean; total: number; sent: number; failed: number; message: string }> {
    const isFormData = payload instanceof FormData;
    const res = await authFetch('/api/broadcast', {
      method: 'POST',
      ...(isFormData ? { body: payload } : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send broadcast');
    return data;
  },

  async sendTestBroadcast(payload: FormData | {
    message?: string;
    mediaType: 'text' | 'photo' | 'video' | 'audio' | 'voice';
    mediaUrl?: string;
    pinMessage?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    const isFormData = payload instanceof FormData;
    const res = await authFetch('/api/broadcast/test', {
      method: 'POST',
      ...(isFormData ? { body: payload } : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send test broadcast');
    return data;
  },

  async unbanUser(userId: string): Promise<{ success: boolean; user: BotUserRecord }> {
    const res = await authFetch(`/api/users/${userId}/unban`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to unban user');
    return data;
  },

  // Reports API
  async getReports(): Promise<UserReportRecord[]> {
    const res = await authFetch('/api/reports');
    if (!res.ok) throw new Error('Failed to load reports');
    return await res.json();
  },

  async updateReport(id: string, payload: { status: 'pending' | 'resolved' | 'dismissed'; banUser?: boolean }): Promise<{ success: boolean; report: UserReportRecord }> {
    const res = await authFetch(`/api/reports/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update report');
    return data;
  },

  async deleteReport(id: string): Promise<{ success: boolean }> {
    const res = await authFetch(`/api/reports/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete report');
    return data;
  },

  // Fraud Rules API
  async getFraudRules(): Promise<FraudKeywordRule[]> {
    const res = await authFetch('/api/fraud-rules');
    if (!res.ok) throw new Error('Failed to load fraud rules');
    return await res.json();
  },

  async createFraudRule(payload: Partial<FraudKeywordRule>): Promise<{ success: boolean; rule: FraudKeywordRule }> {
    const res = await authFetch('/api/fraud-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create fraud rule');
    return data;
  },

  async updateFraudRule(id: string, payload: Partial<FraudKeywordRule>): Promise<{ success: boolean; rule: FraudKeywordRule }> {
    const res = await authFetch(`/api/fraud-rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update fraud rule');
    return data;
  },

  async deleteFraudRule(id: string): Promise<{ success: boolean }> {
    const res = await authFetch(`/api/fraud-rules/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete fraud rule');
    return data;
  },

  // Backup Server API
  async getBackupServerStatus(): Promise<{
    config: {
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
    };
    localStats: {
      itemsCount: number;
      usersCount: number;
      filesCount: number;
      reportsCount: number;
      rulesCount: number;
      templatesCount: number;
      channelsCount: number;
    };
    serverTime: string;
  }> {
    const res = await authFetch('/api/backup-server/status');
    if (!res.ok) throw new Error('Failed to load backup server status');
    return await res.json();
  },

  async updateBackupServerConfig(config: any): Promise<{ success: boolean; config: any }> {
    const res = await authFetch('/api/backup-server/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update backup server configuration');
    return data;
  },

  async syncNowBackupServer(): Promise<{ success: boolean; message: string; stats?: any }> {
    const res = await authFetch('/api/backup-server/sync-now', {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to trigger backup server sync');
    return data;
  },

  async testBackupServerConnection(serverUrl?: string, secretKey?: string): Promise<{ success: boolean; message: string; latencyMs?: number; backupServerRole?: string }> {
    const res = await authFetch('/api/backup-server/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, secretKey })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connection test failed');
    return data;
  },

  async switchBackupServerRole(role?: 'primary' | 'backup'): Promise<{ success: boolean; message: string; config: any }> {
    const res = await authFetch('/api/backup-server/failover/switch-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to switch server role');
    return data;
  },

  async restoreBackupSnapshot(snapshot: any): Promise<{ success: boolean; message: string; counts: any }> {
    const res = await authFetch('/api/backup-server/restore-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore snapshot');
    return data;
  },

  async getFirebaseRules(): Promise<{
    success: boolean;
    rtdbRules: any;
    rtdbRulesFormatted: string;
    authorizedAdmins: string[];
    publicAccessBlocked: boolean;
    backendSyncSecured: boolean;
    primaryProject: string;
    secondaryProject: string;
  }> {
    const res = await authFetch('/api/firebase-rules');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch Firebase rules');
    return data;
  },

  getActiveBotId(): string {
    return getActiveBotId();
  },

  setActiveBotId(botId: string): void {
    setActiveBotId(botId);
  },

  async getBots(): Promise<BotInstance[]> {
    const res = await authFetch('/api/bots');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch bots');
    return data.bots || [];
  },

  async cloneBot(token: string, owner?: string, botMode: BotOperationalMode = 'file_bot'): Promise<any> {
    const cleanOwner = owner?.trim();
    const res = await authFetch('/api/bots/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token.trim(),
        botMode,
        ...(cleanOwner ? { owner: cleanOwner } : {})
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clone bot');
    return data.bot;
  },

  async changeBotMode(id: string, botMode: BotOperationalMode): Promise<{ ok: boolean; botId: string; botMode: BotOperationalMode; message: string }> {
    const res = await authFetch(`/api/bots/${encodeURIComponent(id)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botMode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to change bot mode');
    return data;
  },

  async deleteClonedBot(id: string): Promise<boolean> {
    const res = await authFetch(`/api/bots/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete bot');
    return Boolean(data.ok);
  },

  async startBot(id: string): Promise<{ ok: boolean; status: string; message: string }> {
    const res = await authFetch(`/api/bots/${encodeURIComponent(id)}/start`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start bot');
    return data;
  },

  async stopBot(id: string): Promise<{ ok: boolean; status: string; message: string }> {
    const res = await authFetch(`/api/bots/${encodeURIComponent(id)}/stop`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to stop bot');
    return data;
  },

  async restartBot(id: string): Promise<{ ok: boolean; status: string; message: string }> {
    const res = await authFetch(`/api/bots/${encodeURIComponent(id)}/restart`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restart bot');
    return data;
  },

  async cleanBotMemory(id: string): Promise<{
    ok: boolean;
    clearedRuntimeEntries: number;
    clearedStorageEntries: number;
    rssMb: number;
    heapUsedMb: number;
    message: string;
  }> {
    const res = await authFetch(`/api/bots/${encodeURIComponent(id)}/clean-memory`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to clean bot memory');
    return data;
  }
};
