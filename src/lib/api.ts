export type TriggerType = 'hashtag' | 'slash' | 'normal';
export type OpenMode = 'browser' | 'webapp';

export interface AdminUser {
  id: string;
  telegramId: string;
  name: string;
  role: 'owner' | 'subadmin';
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
  autoDeleteDeliveryEnabled?: boolean;
  deliveryTimeoutMinutes?: number;
  autoDeleteNoticeEnabled?: boolean;
  maintenanceMode?: boolean;
  maintenanceNotice?: string;
  botTokenMasked?: string;
  hasToken?: boolean;
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
  action: 'delete' | 'warn' | 'delete_and_warn' | 'mute' | 'ban';
  duration?: 'permanent' | '1h' | '6h' | '24h' | '7d' | '30d';
  maxWarnings?: number;
  customMessage?: string;
  warningText?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video' | 'audio' | 'voice' | 'text' | 'none';
  enabled: boolean;
  createdAt: string;
}

const TOKEN_KEY = 'tg_admin_token';

function getStoredToken(): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return localStorage.getItem(TOKEN_KEY);
    }
  } catch {}
  return null;
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });
}

export const api = {
  setToken(token: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(TOKEN_KEY, token);
      }
    } catch {}
  },

  getToken(): string | null {
    return getStoredToken();
  },

  clearToken(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {}
  },

  async getMe(): Promise<{ admin: AdminUser } | null> {
    try {
      const res = await authFetch('/api/auth/me');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async login(telegramId: string, password: string): Promise<{ success: boolean; admin: AdminUser; token?: string; error?: string }> {
    const res = await authFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, username: telegramId, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    if (data.token) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(TOKEN_KEY, data.token);
        }
      } catch {}
    }
    return data;
  },

  async firebaseLogin(payload: { idToken?: string; email?: string | null; displayName?: string | null; password?: string }): Promise<{ success: boolean; admin: AdminUser; token?: string; error?: string }> {
    const res = await authFetch('/api/auth/firebase-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Firebase authentication failed');
    if (data.token) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(TOKEN_KEY, data.token);
        }
      } catch {}
    }
    return data;
  },

  async telegramLogin(tgUser: any): Promise<{ success: boolean; admin: AdminUser; token?: string; error?: string }> {
    const res = await authFetch('/api/auth/telegram-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tgUser)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Telegram authentication failed');
    if (data.token) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(TOKEN_KEY, data.token);
        }
      } catch {}
    }
    return data;
  },

  async validateCredentials(username: string, password: string): Promise<{ valid: boolean }> {
    try {
      const res = await authFetch('/api/auth/validate-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, telegramId: username, password })
      });
      if (!res.ok) return { valid: false };
      return await res.json();
    } catch {
      return { valid: false };
    }
  },

  async logout(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {}
    await authFetch('/api/auth/logout', { method: 'POST' });
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

  async uploadFile(payload: FormData | {
    fileName: string;
    fileType: 'document' | 'photo' | 'video' | 'audio';
    fileBase64?: string;
    caption?: string;
  }): Promise<{ success: boolean; fileId: string; uploadedFileId?: string; fileUniqueId?: string; fileName: string; fileSize: number; warning?: string }> {
    const isFormData = payload instanceof FormData;
    const res = await authFetch('/api/items/upload', {
      method: 'POST',
      headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
      body: isFormData ? payload : JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload file');
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
  }
};
