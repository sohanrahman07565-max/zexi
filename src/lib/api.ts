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
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'disabled';
  deliveryCount: number;
  inFiltersList?: boolean;
  retentionType?: 'permanent' | 'temporary';
  retentionDays?: number;
  expiresAt?: string;
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
  botTokenMasked?: string;
  hasToken?: boolean;
}

export const api = {
  async getMe(): Promise<{ admin: AdminUser } | null> {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async login(telegramId: string, password: string):Promise<{ success: boolean; admin: AdminUser; error?: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ telegramId, username: telegramId, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  async validateCredentials(username: string, password: string): Promise<{ valid: boolean }> {
    try {
      const res = await fetch('/api/auth/validate-credentials', {
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
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
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
    const res = await fetch('/api/items', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch items');
    return await res.json();
  },

  async createItem(item: Partial<ItemRecord>): Promise<{ success: boolean; item: ItemRecord }> {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create item');
    return data;
  },

  async updateItem(id: string, item: Partial<ItemRecord>): Promise<{ success: boolean; item: ItemRecord }> {
    const res = await fetch(`/api/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(item)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update item');
    return data;
  },

  async deleteItem(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/items/${id}`, {
      method: 'DELETE',
      credentials: 'include'
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
    const res = await fetch('/api/items/upload', {
      method: 'POST',
      headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: isFormData ? payload : JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload file');
    return data;
  },

  // Templates
  async getTemplates(): Promise<Record<string, MessageTemplate>> {
    const res = await fetch('/api/templates', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load templates');
    return await res.json();
  },

  async updateTemplate(
    key: string,
    content: string,
    extra?: { mediaType?: 'none' | 'photo' | 'video'; mediaUrl?: string; buttons?: TemplateButton[] }
  ): Promise<{ success: boolean; template?: MessageTemplate }> {
    const res = await fetch(`/api/templates/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ content, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update template');
    return data;
  },

  async resetTemplates(): Promise<any> {
    const res = await fetch('/api/templates-reset', {
      method: 'PUT',
      credentials: 'include'
    });
    return await res.json();
  },

  async getStats(): Promise<{
    totalUsers: number;
    totalDeliveries: number;
    totalTriggers: number;
    totalItems: number;
    trackedCount: number;
    adminsCount: number;
  }> {
    const res = await fetch('/api/stats', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load stats');
    return await res.json();
  },

  // Admins
  async getAdmins(): Promise<Omit<AdminUser, 'passwordHash'>[]> {
    const res = await fetch('/api/admins', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load admins');
    return await res.json();
  },

  async createAdmin(payload: any): Promise<any> {
    const res = await fetch('/api/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create admin');
    return data;
  },

  async updateAdmin(id: string, payload: any): Promise<any> {
    const res = await fetch(`/api/admins/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update admin');
    return data;
  },

  async deleteAdmin(id: string): Promise<any> {
    const res = await fetch(`/api/admins/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete admin');
    return data;
  },

  // Design
  async getDesign(): Promise<DesignConfig> {
    const res = await fetch('/api/design', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load design');
    return await res.json();
  },

  async updateDesign(design: Partial<DesignConfig>): Promise<{ success: boolean; design: DesignConfig }> {
    const res = await fetch('/api/design', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(design)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update design');
    return data;
  },

  // Settings
  async getSettings(): Promise<BotSettings> {
    const res = await fetch('/api/settings', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load settings');
    return await res.json();
  },

  async updateSettings(settings: Partial<BotSettings>): Promise<{ success: boolean; settings: BotSettings }> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update settings');
    return data;
  },

  async setWebhook(appUrl: string): Promise<any> {
    const res = await fetch('/api/bot/set-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ appUrl })
    });
    return await res.json();
  },

  async getBotInfo(): Promise<any> {
    const res = await fetch('/api/bot/info', { credentials: 'include' });
    return await res.json();
  },

  // Cleanup
  async getCleanupStatus(): Promise<any> {
    const res = await fetch('/api/cleanup/status', { credentials: 'include' });
    return await res.json();
  },

  async runCleanup(hours?: number): Promise<any> {
    const res = await fetch('/api/cleanup/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ hours })
    });
    return await res.json();
  },

  // Simulator
  async simulate(input: string, chatType: 'group' | 'private' = 'group'): Promise<any> {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ input, chatType })
    });
    return await res.json();
  }
};
