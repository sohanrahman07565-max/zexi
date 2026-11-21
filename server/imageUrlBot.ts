import cron, { type ScheduledTask } from 'node-cron';
import {
  storage,
  StorageManager,
  type ImageUrlBotLinkRecord,
  type ImageUrlBotStoreData
} from './storage';

type CallTelegramApiFn = (method: string, body?: any, tokenOverride?: string) => Promise<any>;

const IMAGE_API_BASE = 'https://host.tscv.workers.dev';
const IMAGE_API_KEY = 'X5Lm9Q2aV7sR3T8kP1WcD6Y4ZbN';

let expiryCronTask: ScheduledTask | null = null;

function escapeHtml(value: any): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : `${date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      })} UTC`;
}

function boldUiText(text: string): string {
  return String(text)
    .split('\n')
    .map((line) => {
      if (!line.trim() || /<[^>]+>/.test(line)) return line;
      return `<b>${line}</b>`;
    })
    .join('\n');
}

function buttonIcon(text: string, style: string): string {
  const value = String(text).toLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/admin/, '🛡️'],
    [/user/, '👥'],
    [/broadcast/, '📢'],
    [/clean/, '🧹'],
    [/all links/, '🗂️'],
    [/upload/, '📤'],
    [/my links|link/, '🔗'],
    [/setting/, '⚙️'],
    [/help/, '💡'],
    [/back|go back/, '↩️'],
    [/cancel|no,/, '❌'],
    [/delete/, '🗑️'],
    [/copy/, '📋'],
    [/refresh/, '🔄'],
    [/expiry|never|day|custom|default/, '⏳'],
    [/skip/, '⏭️'],
    [/new/, '✨'],
    [/edit|change/, '✏️'],
    [/prev/, '◀️'],
    [/next/, '▶️']
  ];
  return matches.find(([pattern]) => pattern.test(value))?.[1] || ({ success: '✅', danger: '❌', primary: '▫️' }[style] || '▫️');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function btn(text: string, callbackData: string, style: 'primary' | 'success' | 'danger' = 'primary') {
  const safeStyle = ['primary', 'success', 'danger'].includes(style) ? style : 'primary';
  return {
    text: `${buttonIcon(text, safeStyle)} ${text}`,
    callback_data: callbackData,
    style: safeStyle
  };
}

function parseExpiry(input: string): string | null | undefined {
  const value = String(input || '').trim().toLowerCase();
  if (!value || value === 'never' || value === 'permanent') return null;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|d|day|days|w|week|weeks)$/);
  if (match) {
    const units: Record<string, number> = {
      m: 60000,
      min: 60000,
      h: 3600000,
      d: 86400000,
      day: 86400000,
      days: 86400000,
      w: 604800000,
      week: 604800000,
      weeks: 604800000
    };
    return new Date(Date.now() + Number(match[1]) * units[match[2]]).toISOString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) {
    return date.toISOString();
  }
  return undefined;
}

function expiryLabel(value: string | null | undefined): string {
  return value ? formatDate(value) : 'Permanent';
}

function uploadSummary(data: { url: string; caption?: string | null; expiresAt?: string | null }): string {
  return (
    `<b>✅ Your image is live</b>\n\n` +
    `🔗 <b>URL</b>\n<code>${escapeHtml(data.url)}</code>\n\n` +
    `📝 <b>Caption:</b> ${escapeHtml(data.caption || 'None')}\n` +
    `⏳ <b>Expires:</b> ${expiryLabel(data.expiresAt)}`
  );
}

async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`${IMAGE_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'X-API-Key': IMAGE_API_KEY,
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let body: any;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = raw;
  }
  if (!response.ok) {
    throw new Error(`${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function uploadImage(buffer: Buffer, filename: string, contentType?: string): Promise<{ imageId: string; url: string }> {
  const form = new FormData();
  const safeContentType = contentType?.startsWith('image/') ? contentType : 'image/jpeg';
  const safeFilename = /\.(png|jpe?g|gif|webp)$/i.test(filename) ? filename : `${filename}.jpg`;
  form.append('file', new Blob([new Uint8Array(buffer)], { type: safeContentType }), safeFilename);
  const body = await apiRequest('/upload', { method: 'POST', body: form });
  const imageId = body.id || body.image_id || body.imageId || body.key;
  const url = body.url || body.cdn_url || `${IMAGE_API_BASE}/img/${imageId}`;
  if (!imageId || !url) {
    throw new Error('Image API returned no image id or URL.');
  }
  return { imageId: String(imageId), url: String(url) };
}

async function deleteRemoteImage(imageId: string): Promise<any> {
  return apiRequest(`/delete/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
}

export class ImageUrlBotEngine {
  private static async loadStore(): Promise<ImageUrlBotStoreData> {
    const existing = await storage.getImageUrlBotData();
    return {
      nextLinkId: Number(existing?.nextLinkId) > 0 ? Number(existing?.nextLinkId) : 1,
      adminTelegramId: existing?.adminTelegramId,
      adminUsername: existing?.adminUsername,
      users: existing?.users && typeof existing.users === 'object' ? existing.users : {},
      links: Array.isArray(existing?.links) ? existing.links : [],
      userSettings: existing?.userSettings && typeof existing.userSettings === 'object' ? existing.userSettings : {},
      sessions: existing?.sessions && typeof existing.sessions === 'object' ? existing.sessions : {}
    };
  }

  private static async saveStore(store: ImageUrlBotStoreData): Promise<void> {
    await storage.saveImageUrlBotData(store);
  }

  private static getSession(store: ImageUrlBotStoreData, chatId: string | number) {
    const key = String(chatId);
    const existing = store.sessions[key];
    if (!existing) {
      return { activeMessageId: null as number | null, state: 'idle', tempData: {} as Record<string, any> };
    }
    return {
      activeMessageId: existing.activeMessageId ?? null,
      state: existing.state || 'idle',
      tempData: existing.tempData && typeof existing.tempData === 'object' ? existing.tempData : {}
    };
  }

  private static setSession(
    store: ImageUrlBotStoreData,
    chatId: string | number,
    patch: Partial<{ activeMessageId: number | null; state: string; tempData: Record<string, any> }>
  ) {
    const key = String(chatId);
    const current = this.getSession(store, key);
    const next = {
      activeMessageId: patch.activeMessageId !== undefined ? patch.activeMessageId : current.activeMessageId,
      state: patch.state !== undefined ? patch.state : current.state,
      tempData: patch.tempData !== undefined ? patch.tempData : current.tempData
    };
    store.sessions[key] = next;
    return next;
  }

  private static clearSession(store: ImageUrlBotStoreData, chatId: string | number) {
    return this.setSession(store, chatId, { state: 'idle', tempData: {} });
  }

  private static registerUser(store: ImageUrlBotStoreData, from: any): void {
    if (!from?.id) return;
    const key = String(from.id);
    const now = new Date().toISOString();
    const existing = store.users[key];
    store.users[key] = {
      telegramId: Number(from.id),
      username: from.username || existing?.username || null,
      firstName: from.first_name || existing?.firstName || null,
      joinedAt: existing?.joinedAt || now,
      lastActiveAt: now
    };
    if (!store.userSettings[key]) {
      store.userSettings[key] = { defaultExpiry: 'never', notifyExpiry: true };
    }
    if (!store.sessions[key]) {
      store.sessions[key] = { activeMessageId: null, state: 'idle', tempData: {} };
    }
  }

  public static async handleUpdate(
    update: any,
    _botId: string,
    deps: {
      callTelegramApi: CallTelegramApiFn;
      getBotToken: () => Promise<string>;
      isAuthorizedAdmin?: (uid: string, uname?: string) => Promise<boolean>;
    }
  ): Promise<void> {
    const { callTelegramApi, getBotToken } = deps;
    const store = await this.loadStore();
    let storeDirty = false;

    const commit = async () => {
      if (storeDirty) {
        await this.saveStore(store);
        storeDirty = false;
      }
    };

    const sendScreen = async (chatId: string | number, text: string, rows: any[][] = []) => {
      const session = this.getSession(store, chatId);
      const formatted = boldUiText(text);
      const extra: any = {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {})
      };

      if (session.activeMessageId) {
        const editRes = await callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: session.activeMessageId,
          text: formatted,
          ...extra
        }).catch(() => null);

        if (editRes?.ok) {
          return session.activeMessageId;
        }
        const desc = String(editRes?.description || '').toLowerCase();
        if (desc.includes('message is not modified')) {
          return session.activeMessageId;
        }
      }

      const sentRes = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: formatted,
        ...extra
      });
      if (sentRes?.ok && sentRes.result?.message_id) {
        this.setSession(store, chatId, { activeMessageId: sentRes.result.message_id });
        storeDirty = true;
      }
      return sentRes?.result?.message_id || null;
    };

    const sendFreshScreen = async (chatId: string | number, text: string, rows: any[][] = []) => {
      const formatted = boldUiText(text);
      const extra: any = {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {})
      };
      const sentRes = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: formatted,
        ...extra
      });
      if (sentRes?.ok && sentRes.result?.message_id) {
        this.setSession(store, chatId, { activeMessageId: sentRes.result.message_id });
        storeDirty = true;
      }
      return sentRes?.result?.message_id || null;
    };

    const deleteIncoming = async (msg: any) => {
      if (msg?.chat?.id && msg?.message_id) {
        await callTelegramApi('deleteMessage', {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        }).catch(() => {});
      }
    };

    const isAdminUser = async (from: any): Promise<boolean> => {
      if (!from?.id) return false;
      const uid = String(from.id).trim();
      const uname = String(from.username || '').replace(/^@+/, '').trim().toLowerCase();

      const storedIdRaw = String(store.adminTelegramId || '').trim();
      const storedUname = String(store.adminUsername || '').replace(/^@+/, '').trim().toLowerCase();

      const hydrateStoreAdmin = (matchedUsername?: string) => {
        if (/^\d+$/.test(uid) && store.adminTelegramId !== uid) {
          store.adminTelegramId = uid;
          storeDirty = true;
        }
        const effectiveUname = uname || (matchedUsername || '').replace(/^@+/, '').trim().toLowerCase();
        if (effectiveUname && store.adminUsername !== effectiveUname) {
          store.adminUsername = effectiveUname;
          storeDirty = true;
        }
      };

      if (storedIdRaw && storedIdRaw === uid) {
        hydrateStoreAdmin(storedUname);
        return true;
      }

      if (uname && ((storedUname && storedUname === uname) || (storedIdRaw && !/^\d+$/.test(storedIdRaw) && storedIdRaw.replace(/^@+/, '').toLowerCase() === uname))) {
        hydrateStoreAdmin(uname);
        return true;
      }

      if (deps.isAuthorizedAdmin) {
        try {
          if (await deps.isAuthorizedAdmin(uid, from.username)) {
            if (!storedIdRaw || (!/^\d+$/.test(storedIdRaw) && uname)) {
              hydrateStoreAdmin(uname);
            }
            return true;
          }
        } catch {}
      }

      // Direct fallback check against bot settings.rootAdminId and cloned bot record ownerId/ownerUsername
      try {
        const botSettings = await storage.getSettings();
        const rootRaw = String(botSettings?.rootAdminId || '').trim();
        if (rootRaw) {
          const rootEntries = rootRaw.split(',').map((s) => s.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);
          if (rootEntries.includes(uid.toLowerCase()) || (uname && rootEntries.includes(uname))) {
            hydrateStoreAdmin(uname);
            return true;
          }
        }
      } catch {}

      if (_botId && _botId !== 'main') {
        try {
          const mainStorage = StorageManager.getMainStorage();
          const cloned = await mainStorage.getClonedBots();
          const cleanBotKey = String(_botId).replace(/^clone_/i, '').replace(/[:_-]/g, '');
          const record = cloned.find((b) => String(b.id) === String(_botId) || String(b.id).replace(/^clone_/i, '').replace(/[:_-]/g, '') === cleanBotKey);
          if (record) {
            const recOwnerId = String(record.ownerId || '').trim();
            const recOwnerUname = String(record.ownerUsername || '').replace(/^@+/, '').trim().toLowerCase();
            if (
              (recOwnerId && recOwnerId === uid) ||
              (uname && ((recOwnerUname && recOwnerUname === uname) || (recOwnerId && recOwnerId.replace(/^@+/, '').toLowerCase() === uname)))
            ) {
              hydrateStoreAdmin(recOwnerUname || uname);
              return true;
            }
          }
        } catch {}
      }

      return false;
    };

    const mainMenuText = (from: any) => {
      const name = escapeHtml(from?.first_name || 'there');
      return `<b>🖼️ ImageLink Bot</b>\n\n👋 Welcome, ${name}!\n\n✨ Turn any Telegram photo into a clean, shareable URL.\n\n📦 Your uploads stay organized here, with optional expiry controls.`;
    };

    const mainMenuRows = (isAdmin = false) => [
      [btn('Upload Image', 'upload:start', 'success')],
      [btn('My Links', 'links:0')],
      [btn('Settings', 'settings'), btn('Help', 'help')],
      ...(isAdmin ? [[btn('Admin Panel', 'admin:panel')]] : [])
    ];

    const showMain = async (chatId: string | number, from: any, opts: { fresh?: boolean; incomingMsg?: any } = {}) => {
      this.clearSession(store, chatId);
      storeDirty = true;
      const isAdmin = await isAdminUser(from);
      if (opts.fresh && opts.incomingMsg) {
        await deleteIncoming(opts.incomingMsg);
      }
      if (opts.fresh) {
        await sendFreshScreen(chatId, mainMenuText(from), mainMenuRows(isAdmin));
      } else {
        await sendScreen(chatId, mainMenuText(from), mainMenuRows(isAdmin));
      }
    };

    const showUploadPhoto = async (chatId: string | number) => {
      this.setSession(store, chatId, { state: 'awaiting_photo', tempData: {} });
      storeDirty = true;
      await sendScreen(
        chatId,
        '<b>📤 Upload an image</b>\n\n📸 Send a photo here and I’ll turn it into a direct URL.',
        [[btn('Cancel', 'menu', 'danger')]]
      );
    };

    const showCaptionStep = async (chatId: string | number) => {
      this.setSession(store, chatId, { state: 'awaiting_caption' });
      storeDirty = true;
      await sendScreen(
        chatId,
        '<b>📝 Add a caption?</b>\n\n✍️ Send a short caption for this link, or skip it.',
        [[btn('Skip', 'caption:skip'), btn('Cancel', 'menu', 'danger')]]
      );
    };

    const showExpiryStep = async (chatId: string | number) => {
      this.setSession(store, chatId, { state: 'awaiting_expiry' });
      storeDirty = true;
      const defaultExpiry = store.userSettings[String(chatId)]?.defaultExpiry || 'never';
      const defaultButton =
        defaultExpiry === 'never'
          ? btn('Never', 'expiry:never')
          : btn(`Use Default (${defaultExpiry})`, 'expiry:default');
      await sendScreen(
        chatId,
        `<b>⏳ Set an expiry?</b>\n\n♾️ Permanent is the default. Choose a timer or enter a duration like <code>12h</code> or <code>30d</code>.\n\n⚙️ Personal default: <b>${escapeHtml(defaultExpiry)}</b>`,
        [
          [btn('1 Day', 'expiry:1d', 'success'), btn('3 Days', 'expiry:3d', 'success'), btn('7 Days', 'expiry:7d', 'success')],
          [defaultButton, btn('Custom', 'expiry:custom')],
          [btn('Cancel', 'menu', 'danger')]
        ]
      );
    };

    const finishUpload = async (chatId: string | number, data: { imageId: string; url: string; caption?: string | null; expiresAt?: string | null; fileSize?: number | null }) => {
      const linkId = store.nextLinkId++;
      const record: ImageUrlBotLinkRecord = {
        id: linkId,
        imageId: data.imageId,
        url: data.url,
        ownerTelegramId: Number(chatId),
        caption: data.caption || null,
        category: 'general',
        expiresAt: data.expiresAt || null,
        fileSize: data.fileSize ?? null,
        createdAt: new Date().toISOString(),
        isDeleted: false
      };
      store.links.unshift(record);
      this.clearSession(store, chatId);
      this.setSession(store, chatId, { tempData: { lastLinkId: linkId } });
      storeDirty = true;
      await sendScreen(
        chatId,
        uploadSummary(data),
        [
          [btn('Copy Link', `copy:${linkId}`)],
          [btn('Back to Menu', 'menu'), btn('Delete Now', `delete:${linkId}`, 'danger')]
        ]
      );
    };

    const linkForUser = (id: number, chatId: string | number): ImageUrlBotLinkRecord | undefined =>
      store.links.find((l) => l.id === id && String(l.ownerTelegramId) === String(chatId) && !l.isDeleted);

    const showLinks = async (chatId: string | number, page = 0) => {
      const activeLinks = store.links
        .filter((l) => String(l.ownerTelegramId) === String(chatId) && !l.isDeleted)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const count = activeLinks.length;
      const items = activeLinks.slice(page * 5, page * 5 + 5);
      const rows: any[][] = items.map((link) => [
        btn(`${(link.caption || 'Untitled').slice(0, 24)} · ${String(link.createdAt).slice(0, 10)}`, `link:${link.id}`)
      ]);
      const nav: any[] = [];
      if (page > 0) nav.push(btn('Prev', `links:${page - 1}`));
      if ((page + 1) * 5 < count) nav.push(btn('Next', `links:${page + 1}`));
      if (nav.length) rows.push(nav);
      rows.push([btn('Back to Menu', 'menu')]);
      await sendScreen(
        chatId,
        `<b>🔗 My Links</b>\n\n${count ? '📌 Select a link to view its details.' : '📭 No links here yet. Upload your first image to get started.'}`,
        rows
      );
    };

    const showLinkDetail = async (chatId: string | number, id: number) => {
      const link = linkForUser(id, chatId);
      if (!link) {
        await sendScreen(chatId, '<b>⚠️ Link unavailable</b>\n\n🗑️ It may have already been deleted.', [[btn('Back to List', 'links:0')]]);
        return;
      }
      await sendScreen(
        chatId,
        `<b>📄 Link details</b>\n\n🔗 <b>URL</b>\n<code>${escapeHtml(link.url)}</code>\n\n📝 <b>Caption:</b> ${escapeHtml(link.caption || 'None')}\n📅 <b>Uploaded:</b> ${formatDate(link.createdAt)}\n⏳ <b>Expires:</b> ${expiryLabel(link.expiresAt)}`,
        [
          [btn('Copy Link', `copy:${link.id}`)],
          [btn('Edit Caption', `editcaption:${link.id}`)],
          [btn('Change Expiry', `editexpiry:${link.id}`)],
          [btn('Delete', `deleteconfirm:${link.id}`, 'danger')],
          [btn('Back to List', 'links:0')]
        ]
      );
    };

    const showSettings = async (chatId: string | number) => {
      const settings = store.userSettings[String(chatId)] || { defaultExpiry: 'never', notifyExpiry: true };
      await sendScreen(
        chatId,
        `<b>⚙️ Settings</b>\n\n⏳ <b>Default expiry:</b> ${escapeHtml(settings.defaultExpiry)}\n🔔 <b>Notify on auto-delete:</b> ${settings.notifyExpiry ? 'ON' : 'OFF'}`,
        [
          [btn('Default Expiry', 'settings:expiry')],
          [btn(`Notify on Auto-Delete: ${settings.notifyExpiry ? 'ON' : 'OFF'}`, 'settings:notify')],
          [btn('Back', 'menu')]
        ]
      );
    };

    const showHelp = async (chatId: string | number) => {
      await sendScreen(
        chatId,
        '<b>💡 Help</b>\n\n📤 <b>Upload:</b> tap Upload Image, then send a photo.\n📝 <b>Caption:</b> add a label to each image if you want.\n⏳ <b>Expiry:</b> every image gets its own independent expiry choice.\n\n✨ The bot keeps your interface in one edited card so your chat stays clean.',
        [[btn('Back to Menu', 'menu')]]
      );
    };

    const showAdminPanel = async (chatId: string | number, fresh = false) => {
      const totalUsers = Object.keys(store.users).length;
      const activeLinks = store.links.filter((l) => !l.isDeleted);
      const deletedLinks = store.links.filter((l) => l.isDeleted);
      const expiringLinks = activeLinks.filter((l) => Boolean(l.expiresAt));
      const totalBytes = activeLinks.reduce((acc, l) => acc + (Number(l.fileSize) || 0), 0);
      const assignedAdmin = store.adminUsername
        ? `@${escapeHtml(store.adminUsername)}`
        : store.adminTelegramId
        ? `<code>${escapeHtml(store.adminTelegramId)}</code>`
        : 'Assigned Admin';

      const panelText =
        `<b>🛡️ ImageLink Admin Panel</b>\n\n` +
        `👤 <b>Assigned Admin:</b> ${assignedAdmin}\n` +
        `👥 <b>Total Users:</b> ${totalUsers}\n` +
        `🔗 <b>Active Links:</b> ${activeLinks.length}\n` +
        `⏳ <b>Expiring Links:</b> ${expiringLinks.length}\n` +
        `🗑️ <b>Deleted / Expired:</b> ${deletedLinks.length}\n` +
        `💾 <b>Active Storage:</b> ${formatBytes(totalBytes)}`;
      const panelRows = [
        [btn('All Links', 'admin:links:0'), btn('Users List', 'admin:users:0')],
        [btn('Clean Expired', 'admin:cleanup'), btn('Broadcast', 'admin:broadcast', 'success')],
        [btn('Refresh', 'admin:panel'), btn('Back to Menu', 'menu')]
      ];
      if (fresh) {
        await sendFreshScreen(chatId, panelText, panelRows);
      } else {
        await sendScreen(chatId, panelText, panelRows);
      }
    };

    const showAdminLinks = async (chatId: string | number, page = 0) => {
      const activeLinks = store.links
        .filter((l) => !l.isDeleted)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const count = activeLinks.length;
      const items = activeLinks.slice(page * 5, page * 5 + 5);
      const rows: any[][] = items.map((link) => {
        const owner = store.users[String(link.ownerTelegramId)];
        const ownerTag = owner?.username ? `@${owner.username}` : String(link.ownerTelegramId);
        return [
          btn(`#${link.id} · ${(link.caption || 'Untitled').slice(0, 16)} · ${ownerTag}`, `admin:link:${link.id}`)
        ];
      });
      const nav: any[] = [];
      if (page > 0) nav.push(btn('Prev', `admin:links:${page - 1}`));
      if ((page + 1) * 5 < count) nav.push(btn('Next', `admin:links:${page + 1}`));
      if (nav.length) rows.push(nav);
      rows.push([btn('Admin Panel', 'admin:panel'), btn('Back to Menu', 'menu')]);

      await sendScreen(
        chatId,
        `<b>🗂️ All Active Links (${count})</b>\n\n${count ? '📌 Select any link to inspect or delete it.' : '📭 No active links exist yet.'}`,
        rows
      );
    };

    const showAdminLinkDetail = async (chatId: string | number, id: number) => {
      const link = store.links.find((l) => l.id === id && !l.isDeleted);
      if (!link) {
        await sendScreen(
          chatId,
          '<b>⚠️ Link unavailable</b>\n\n🗑️ It may have already been deleted.',
          [[btn('Back to All Links', 'admin:links:0')]]
        );
        return;
      }
      const owner = store.users[String(link.ownerTelegramId)];
      const ownerLabel = owner?.username
        ? `@${escapeHtml(owner.username)} (<code>${escapeHtml(link.ownerTelegramId)}</code>)`
        : `<code>${escapeHtml(link.ownerTelegramId)}</code>`;

      await sendScreen(
        chatId,
        `<b>🛡️ Link #${link.id} Details</b>\n\n` +
          `👤 <b>Owner:</b> ${ownerLabel}\n` +
          `🔗 <b>URL</b>\n<code>${escapeHtml(link.url)}</code>\n\n` +
          `📝 <b>Caption:</b> ${escapeHtml(link.caption || 'None')}\n` +
          `📅 <b>Uploaded:</b> ${formatDate(link.createdAt)}\n` +
          `⏳ <b>Expires:</b> ${expiryLabel(link.expiresAt)}`,
        [
          [btn('Delete Link', `admin:del:${link.id}`, 'danger')],
          [btn('Back to All Links', 'admin:links:0'), btn('Admin Panel', 'admin:panel')]
        ]
      );
    };

    const showAdminUsers = async (chatId: string | number, page = 0) => {
      const users = Object.values(store.users).sort((a, b) =>
        String(b.lastActiveAt || b.joinedAt || '').localeCompare(String(a.lastActiveAt || a.joinedAt || ''))
      );
      const count = users.length;
      const items = users.slice(page * 8, page * 8 + 8);
      const linkCounts = new Map<string, number>();
      for (const l of store.links) {
        if (!l.isDeleted) {
          const k = String(l.ownerTelegramId);
          linkCounts.set(k, (linkCounts.get(k) || 0) + 1);
        }
      }

      const lines = items.map((u, idx) => {
        const serial = page * 8 + idx + 1;
        const uname = u.username ? `@${escapeHtml(u.username)}` : escapeHtml(u.firstName || 'User');
        const uploads = linkCounts.get(String(u.telegramId)) || 0;
        return `${serial}. ${uname} (<code>${escapeHtml(u.telegramId)}</code>) · <b>${uploads}</b> links`;
      });

      const nav: any[] = [];
      if (page > 0) nav.push(btn('Prev', `admin:users:${page - 1}`));
      if ((page + 1) * 8 < count) nav.push(btn('Next', `admin:users:${page + 1}`));
      const rows: any[][] = [];
      if (nav.length) rows.push(nav);
      rows.push([btn('Admin Panel', 'admin:panel'), btn('Back to Menu', 'menu')]);

      await sendScreen(
        chatId,
        `<b>👥 Registered Users (${count})</b>\n\n${lines.length ? lines.join('\n') : '📭 No users have interacted with this bot yet.'}`,
        rows
      );
    };

    const processPhoto = async (msg: any) => {
      const chatId = msg.chat.id;
      const from = msg.from;
      let session = this.getSession(store, chatId);
      if (session.state !== 'awaiting_photo') {
        session = this.setSession(store, chatId, { state: 'awaiting_photo', tempData: {} });
        storeDirty = true;
      }
      await deleteIncoming(msg);
      await sendScreen(chatId, '<b>⏫ Uploading…</b>\n\n🔄 Fetching the Telegram file and creating your URL.');

      try {
        let fileId = '';
        let fileName = `telegram-${from?.id || chatId}-${Date.now()}.jpg`;
        let mimeType = 'image/jpeg';

        if (Array.isArray(msg.photo) && msg.photo.length > 0) {
          const largest = msg.photo[msg.photo.length - 1];
          fileId = largest.file_id;
        } else if (msg.document && String(msg.document.mime_type || '').startsWith('image/')) {
          fileId = msg.document.file_id;
          fileName = msg.document.file_name || fileName;
          mimeType = msg.document.mime_type || mimeType;
        }

        if (!fileId) {
          throw new Error('No image file found in message.');
        }

        const fileInfo = await callTelegramApi('getFile', { file_id: fileId });
        const filePath = fileInfo?.result?.file_path;
        if (!fileInfo?.ok || !filePath) {
          throw new Error(fileInfo?.description || 'Failed to resolve Telegram file path.');
        }
        const token = await getBotToken();
        const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (!fileRes.ok) {
          throw new Error(`Telegram file download failed with ${fileRes.status}.`);
        }
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        const uploaded = await uploadImage(buffer, fileName, mimeType);
        this.setSession(store, chatId, {
          state: 'awaiting_caption',
          tempData: { ...session.tempData, ...uploaded, fileSize: buffer.length }
        });
        storeDirty = true;
        await showCaptionStep(chatId);
      } catch (error: any) {
        await sendScreen(
          chatId,
          `<b>⚠️ Upload failed</b>\n\n${escapeHtml(error?.message || error)}\n\n🔁 Try sending the photo again.`,
          [[btn('Try Again', 'upload:start', 'success'), btn('Back to Menu', 'menu')]]
        );
      }
    };

    try {
      // Handle callback queries
      if (update.callback_query) {
        const q = update.callback_query;
        const chatId = q.message?.chat?.id ?? q.from?.id;
        if (q.from) {
          this.registerUser(store, q.from);
          storeDirty = true;
        }
        await callTelegramApi('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
        if (!chatId) {
          await commit();
          return;
        }
        const data = String(q.data || '');

        if (data === 'menu') {
          await showMain(chatId, q.from);
        } else if (data === 'upload:start') {
          await showUploadPhoto(chatId);
        } else if (data === 'links:0') {
          await showLinks(chatId, 0);
        } else if (/^links:(\d+)$/.test(data)) {
          const page = Number(data.match(/^links:(\d+)$/)![1]);
          await showLinks(chatId, page);
        } else if (data === 'settings') {
          await showSettings(chatId);
        } else if (data === 'help') {
          await showHelp(chatId);
        } else if (data === 'caption:skip') {
          const session = this.getSession(store, chatId);
          this.setSession(store, chatId, { tempData: { ...session.tempData, caption: null } });
          storeDirty = true;
          await showExpiryStep(chatId);
        } else if (/^expiry:(.+)$/.test(data)) {
          const mode = data.match(/^expiry:(.+)$/)![1];
          const session = this.getSession(store, chatId);
          if (mode === 'custom') {
            this.setSession(store, chatId, { state: 'awaiting_expiry' });
            storeDirty = true;
            await sendScreen(
              chatId,
              '<b>🕒 Custom expiry</b>\n\n⌛ Send a duration like <code>12h</code>, <code>30d</code>, or an ISO date.',
              [[btn('Cancel', 'menu', 'danger')]]
            );
          } else {
            let value: string | null | undefined = mode === 'never' ? null : parseExpiry(mode);
            if (mode === 'default') {
              const defaultExpiry = store.userSettings[String(chatId)]?.defaultExpiry || 'never';
              value = defaultExpiry === 'never' ? null : parseExpiry(defaultExpiry);
            }
            const nextTemp = { ...session.tempData, expiresAt: value ?? null };
            this.setSession(store, chatId, { tempData: nextTemp });
            storeDirty = true;
            await finishUpload(chatId, nextTemp as any);
          }
        } else if (/^link:(\d+)$/.test(data)) {
          await showLinkDetail(chatId, Number(data.match(/^link:(\d+)$/)![1]));
        } else if (/^copy:(\d+)$/.test(data)) {
          const link = linkForUser(Number(data.match(/^copy:(\d+)$/)![1]), chatId);
          if (link) {
            await sendScreen(
              chatId,
              `<b>📋 Copy this URL</b>\n\n<code>${escapeHtml(link.url)}</code>`,
              [[btn('Back to Link', `link:${link.id}`)]]
            );
          }
        } else if (/^deleteconfirm:(\d+)$/.test(data)) {
          const id = Number(data.match(/^deleteconfirm:(\d+)$/)![1]);
          await sendScreen(
            chatId,
            '<b>🗑️ Delete this link?</b>\n\n⚠️ The remote image and saved record will be removed.',
            [[btn('Yes, Delete', `delete:${id}`, 'danger'), btn('No, Go Back', `link:${id}`)]]
          );
        } else if (/^delete:(\d+)$/.test(data)) {
          const id = Number(data.match(/^delete:(\d+)$/)![1]);
          const link = linkForUser(id, chatId);
          if (link) {
            try {
              await deleteRemoteImage(link.imageId);
            } catch {}
            link.isDeleted = true;
            storeDirty = true;
          }
          await sendScreen(
            chatId,
            '<b>🗑️ Link deleted</b>\n\n✅ The image is no longer available from this bot.',
            [[btn('Back to Menu', 'menu')]]
          );
        } else if (/^editcaption:(\d+)$/.test(data)) {
          const id = Number(data.match(/^editcaption:(\d+)$/)![1]);
          this.setSession(store, chatId, { state: 'awaiting_edit_caption', tempData: { linkId: id } });
          storeDirty = true;
          await sendScreen(
            chatId,
            '<b>✏️ Edit caption</b>\n\n📝 Send the new caption, or send <code>-</code> to clear it.',
            [[btn('Cancel', `link:${id}`)]]
          );
        } else if (/^editexpiry:(\d+)$/.test(data)) {
          const id = Number(data.match(/^editexpiry:(\d+)$/)![1]);
          this.setSession(store, chatId, { state: 'awaiting_edit_expiry', tempData: { linkId: id } });
          storeDirty = true;
          await sendScreen(
            chatId,
            '<b>⏳ Change expiry</b>\n\nChoose a new lifetime for this image.',
            [
              [btn('1 Day', 'seteditexpiry:1d'), btn('3 Days', 'seteditexpiry:3d'), btn('7 Days', 'seteditexpiry:7d')],
              [btn('Never', 'seteditexpiry:never'), btn('Custom', 'seteditexpiry:custom')],
              [btn('Cancel', `link:${id}`)]
            ]
          );
        } else if (/^seteditexpiry:(.+)$/.test(data)) {
          const mode = data.match(/^seteditexpiry:(.+)$/)![1];
          const session = this.getSession(store, chatId);
          const linkId = Number(session.tempData?.linkId || 0);
          if (mode === 'custom') {
            this.setSession(store, chatId, { state: 'awaiting_edit_expiry' });
            storeDirty = true;
            await sendScreen(
              chatId,
              '<b>🕒 Custom expiry</b>\n\n⌛ Send a duration like <code>12h</code>, <code>30d</code>, or an ISO date.',
              [[btn('Cancel', `link:${linkId}`)]]
            );
          } else {
            const link = linkForUser(linkId, chatId);
            if (link) {
              link.expiresAt = mode === 'never' ? null : (parseExpiry(mode) ?? null);
              storeDirty = true;
            }
            await showLinkDetail(chatId, linkId);
          }
        } else if (data === 'settings:notify') {
          const key = String(chatId);
          const cur = store.userSettings[key] || { defaultExpiry: 'never', notifyExpiry: true };
          store.userSettings[key] = { ...cur, notifyExpiry: !cur.notifyExpiry };
          storeDirty = true;
          await showSettings(chatId);
        } else if (data === 'settings:expiry') {
          this.setSession(store, chatId, { state: 'awaiting_default_expiry' });
          storeDirty = true;
          await sendScreen(
            chatId,
            '<b>⏳ Default expiry</b>\n\n⌛ Send <code>never</code>, <code>1d</code>, <code>3d</code>, or another duration.',
            [[btn('Cancel', 'settings')]]
          );
        } else if (data === 'admin:panel' || data.startsWith('admin:')) {
          if (!(await isAdminUser(q.from))) {
            await sendScreen(
              chatId,
              `<b>⛔ Access Denied</b>\n\n🔒 Only the assigned bot admin/owner can access the Admin Panel.\n\n🆔 Your ID: <code>${escapeHtml(q.from?.id || chatId)}</code>`,
              [[btn('Back to Menu', 'menu')]]
            );
          } else if (data === 'admin:panel') {
            this.clearSession(store, chatId);
            storeDirty = true;
            await showAdminPanel(chatId);
          } else if (/^admin:links:(\d+)$/.test(data)) {
            const page = Number(data.match(/^admin:links:(\d+)$/)![1]);
            await showAdminLinks(chatId, page);
          } else if (/^admin:link:(\d+)$/.test(data)) {
            const id = Number(data.match(/^admin:link:(\d+)$/)![1]);
            await showAdminLinkDetail(chatId, id);
          } else if (/^admin:del:(\d+)$/.test(data)) {
            const id = Number(data.match(/^admin:del:(\d+)$/)![1]);
            const link = store.links.find((l) => l.id === id && !l.isDeleted);
            if (link) {
              try {
                await deleteRemoteImage(link.imageId);
              } catch {}
              link.isDeleted = true;
              storeDirty = true;
            }
            await sendScreen(
              chatId,
              `<b>🗑️ Link #${id} Deleted</b>\n\n✅ The image record has been removed.`,
              [[btn('Back to All Links', 'admin:links:0'), btn('Admin Panel', 'admin:panel')]]
            );
          } else if (/^admin:users:(\d+)$/.test(data)) {
            const page = Number(data.match(/^admin:users:(\d+)$/)![1]);
            await showAdminUsers(chatId, page);
          } else if (data === 'admin:cleanup') {
            const nowMs = Date.now();
            let removed = 0;
            for (const link of store.links) {
              if (!link.isDeleted && link.expiresAt) {
                const expMs = new Date(link.expiresAt).getTime();
                if (Number.isFinite(expMs) && expMs <= nowMs) {
                  try {
                    await deleteRemoteImage(link.imageId);
                  } catch {}
                  link.isDeleted = true;
                  storeDirty = true;
                  removed++;
                }
              }
            }
            await sendScreen(
              chatId,
              `<b>🧹 Cleanup Complete</b>\n\n✅ Removed <b>${removed}</b> expired ${removed === 1 ? 'link' : 'links'}.`,
              [[btn('Admin Panel', 'admin:panel')]]
            );
          } else if (data === 'admin:broadcast') {
            this.setSession(store, chatId, { state: 'awaiting_admin_broadcast' });
            storeDirty = true;
            const userCount = Object.keys(store.users).length;
            await sendScreen(
              chatId,
              `<b>📢 Broadcast Message</b>\n\n👥 Recipients: <b>${userCount}</b> users\n\n✍️ Send the text message you want to broadcast to all bot users.`,
              [[btn('Cancel', 'admin:panel', 'danger')]]
            );
          }
        }

        await commit();
        return;
      }

      const msg = update.message || update.edited_message;
      if (!msg?.chat) return;
      if (msg.from) {
        this.registerUser(store, msg.from);
        storeDirty = true;
      }

      const chatId = msg.chat.id;
      const isPrivate = msg.chat.type === 'private';

      // Handle photos (and uncompressed image documents)
      if ((Array.isArray(msg.photo) && msg.photo.length > 0) || (msg.document && String(msg.document.mime_type || '').startsWith('image/'))) {
        if (isPrivate) {
          await processPhoto(msg);
          await commit();
        }
        return;
      }

      const rawText = typeof msg.text === 'string' ? msg.text : '';
      const text = rawText.trim();
      if (!text || !isPrivate) {
        await commit();
        return;
      }

      const cmdMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+|$)/);
      if (cmdMatch) {
        const cmd = cmdMatch[1].toLowerCase();
        if (cmd === 'start') {
          await showMain(chatId, msg.from, { fresh: true, incomingMsg: msg });
        } else if (cmd === 'admin') {
          await deleteIncoming(msg);
          if (await isAdminUser(msg.from)) {
            this.clearSession(store, chatId);
            storeDirty = true;
            await showAdminPanel(chatId, true);
          } else {
            await sendFreshScreen(
              chatId,
              `<b>⛔ Access Denied</b>\n\n🔒 Only the assigned bot admin/owner can open the Admin Panel.\n\n🆔 Your ID: <code>${escapeHtml(msg.from?.id || chatId)}</code>`,
              [[btn('Back to Menu', 'menu')]]
            );
          }
        } else if (cmd === 'upload') {
          await deleteIncoming(msg);
          await showUploadPhoto(chatId);
        } else if (cmd === 'links') {
          await deleteIncoming(msg);
          await showLinks(chatId, 0);
        } else if (cmd === 'settings') {
          await deleteIncoming(msg);
          await showSettings(chatId);
        } else if (cmd === 'help') {
          await deleteIncoming(msg);
          await showHelp(chatId);
        } else {
          await deleteIncoming(msg);
          await showMain(chatId, msg.from);
        }
        await commit();
        return;
      }

      // Interactive session text responses
      const session = this.getSession(store, chatId);
      await deleteIncoming(msg);

      if (session.state === 'awaiting_caption') {
        this.setSession(store, chatId, { tempData: { ...session.tempData, caption: text.slice(0, 200) } });
        storeDirty = true;
        await showExpiryStep(chatId);
      } else if (session.state === 'awaiting_expiry') {
        const expiresAt = parseExpiry(text);
        if (expiresAt === undefined) {
          await sendScreen(
            chatId,
            '<b>⚠️ Expiry not understood</b>\n\n⌛ Use a duration like <code>12h</code>, <code>30d</code>, or an ISO date.',
            [[btn('Try Again', 'expiry:custom'), btn('Cancel', 'menu', 'danger')]]
          );
        } else {
          await finishUpload(chatId, { ...(session.tempData as any), expiresAt });
        }
      } else if (session.state === 'awaiting_edit_caption') {
        const link = linkForUser(Number(session.tempData?.linkId || 0), chatId);
        if (link) {
          link.caption = text === '-' ? null : text.slice(0, 200);
          storeDirty = true;
        }
        await showLinkDetail(chatId, Number(session.tempData?.linkId || 0));
      } else if (session.state === 'awaiting_edit_expiry') {
        const linkId = Number(session.tempData?.linkId || 0);
        const expiresAt = parseExpiry(text);
        if (expiresAt === undefined) {
          await sendScreen(
            chatId,
            '<b>⚠️ Expiry not understood</b>\n\n⌛ Try <code>12h</code>, <code>30d</code>, or an ISO date.',
            [[btn('Cancel', `link:${linkId}`)]]
          );
        } else {
          const link = linkForUser(linkId, chatId);
          if (link) {
            link.expiresAt = expiresAt;
            storeDirty = true;
          }
          await showLinkDetail(chatId, linkId);
        }
      } else if (session.state === 'awaiting_default_expiry') {
        const value = text.toLowerCase() === 'never' ? 'never' : parseExpiry(text);
        if (value === undefined) {
          await sendScreen(
            chatId,
            '<b>⚠️ Expiry not understood</b>\n\n⌛ Try <code>never</code>, <code>1d</code>, or <code>30d</code>.',
            [[btn('Cancel', 'settings')]]
          );
        } else {
          const key = String(chatId);
          const cur = store.userSettings[key] || { defaultExpiry: 'never', notifyExpiry: true };
          store.userSettings[key] = { ...cur, defaultExpiry: text.toLowerCase() === 'never' ? 'never' : text };
          this.clearSession(store, chatId);
          storeDirty = true;
          await showSettings(chatId);
        }
      } else if (session.state === 'awaiting_admin_broadcast') {
        if (await isAdminUser(msg.from)) {
          const userIds = Object.keys(store.users);
          let sent = 0;
          let failed = 0;
          for (const targetUid of userIds) {
            try {
              const r = await callTelegramApi('sendMessage', {
                chat_id: targetUid,
                text: rawText
              });
              if (r?.ok) sent++;
              else failed++;
            } catch {
              failed++;
            }
          }
          this.clearSession(store, chatId);
          storeDirty = true;
          await sendScreen(
            chatId,
            `<b>📢 Broadcast Complete</b>\n\n✅ <b>Delivered:</b> ${sent}\n⚠️ <b>Failed:</b> ${failed}`,
            [[btn('Admin Panel', 'admin:panel'), btn('Back to Menu', 'menu')]]
          );
        } else {
          await showMain(chatId, msg.from);
        }
      } else {
        await showMain(chatId, msg.from);
      }

      await commit();
    } catch (err: any) {
      console.error('[ImageUrlBot] HandleUpdate error:', err?.message || err);
    }
  }

  public static async runExpirySweep(callTelegramApi: CallTelegramApiFn): Promise<void> {
    const nowMs = Date.now();
    const mainStorage = StorageManager.getMainStorage();
    const targets: Array<{ botId: string; storageInstance: ReturnType<typeof StorageManager.getStorage>; tokenOverride?: string }> = [];

    try {
      const mainSettings = await mainStorage.getSettings().catch(() => null);
      if (mainSettings?.botMode === 'image_url_bot' && !mainSettings?.botStopped) {
        targets.push({ botId: 'main', storageInstance: mainStorage });
      }
      const cloned = await mainStorage.getClonedBots().catch(() => []);
      for (const bot of cloned) {
        if (bot.status === 'stopped') continue;
        const cStorage = StorageManager.getStorage(bot.id);
        const cSettings = await cStorage.getSettings().catch(() => null);
        const effectiveMode = cSettings?.botMode || bot.botMode || 'file_bot';
        if (effectiveMode === 'image_url_bot' && bot.token) {
          targets.push({ botId: bot.id, storageInstance: cStorage, tokenOverride: bot.token });
        }
      }
    } catch {
      return;
    }

    for (const target of targets) {
      try {
        const store = await target.storageInstance.getImageUrlBotData();
        if (!store || !Array.isArray(store.links) || store.links.length === 0) continue;

        let changed = false;
        for (const link of store.links) {
          if (link.isDeleted || !link.expiresAt) continue;
          const expMs = new Date(link.expiresAt).getTime();
          if (Number.isNaN(expMs) || expMs > nowMs) continue;

          try {
            await deleteRemoteImage(link.imageId);
          } catch {}
          link.isDeleted = true;
          changed = true;

          const ownerSettings = store.userSettings?.[String(link.ownerTelegramId)];
          const shouldNotify = ownerSettings ? ownerSettings.notifyExpiry !== false : true;
          if (shouldNotify) {
            await callTelegramApi(
              'sendMessage',
              {
                chat_id: link.ownerTelegramId,
                text: `This link has expired and was removed: ${link.caption || 'untitled image'}`
              },
              target.tokenOverride
            ).catch(() => {});
          }
        }

        if (changed) {
          await target.storageInstance.saveImageUrlBotData(store);
        }
      } catch (err: any) {
        console.warn(`[ImageUrlBot:${target.botId}] Expiry sweep notice:`, err?.message || err);
      }
    }
  }

  public static startExpiryCron(callTelegramApi: CallTelegramApiFn): void {
    if (expiryCronTask) return;
    expiryCronTask = cron.schedule('*/5 * * * *', () => {
      void this.runExpirySweep(callTelegramApi);
    });
  }
}
