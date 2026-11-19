import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { storage, ItemRecord, TriggerType, OpenMode, ScheduledDeletion, ForceSubChannel, StorageManager, storageContext, ClonedBotRecord, SharedStorageService, AdminUser, BotOperationalMode } from './storage';
import { hashPassword, signSessionToken } from './auth';
import { PostBotEngine } from './postBot';

export const botTokenContext = new AsyncLocalStorage<string>();
export const botIdContext = new AsyncLocalStorage<string>();
export const senderUsernameContext = new AsyncLocalStorage<string>();

interface CloneSession {
  token: string;
  botInfo: any;
  chatId: string;
  createdBy: string;
  createdAt: number;
  stage: 'awaiting_mode' | 'awaiting_owner';
  botMode?: BotOperationalMode;
  promptMessageId?: number;
}

// In-memory conversation state for interactive private chat commands (like /add)
interface AddFileEntry {
  fileId: string;
  fileUniqueId?: string;
  fileType: 'document' | 'photo' | 'video' | 'audio';
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  caption?: string;
}

interface AddSession {
  stage: 
    | 'awaiting_content'
    | 'awaiting_file_content'
    | 'awaiting_link_url'
    | 'awaiting_text_content'
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
    | 'awaiting_setup_video_choice'
    | 'awaiting_setup_video'
    | 'awaiting_caption';
  type?: 'file' | 'link';
  isTextOnly?: boolean;
  textResponse?: string;
  fileName?: string;
  fileData?: AddFileEntry;
  filesData?: AddFileEntry[];
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
  hasSetupVideo?: boolean;
  setupVideoUrl?: string;
  setupVideoType?: 'url' | 'upload';
  setupVideoFileName?: string;
}

const activeAddSessions: Map<string, AddSession> = new Map();
const addSessionLocks: Map<string, Promise<void>> = new Map();
async function withAddSessionLock<T>(fromId: string, fn: () => Promise<T>): Promise<T> {
  const prev = addSessionLocks.get(fromId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.catch(() => {}).then(() => current);
  addSessionLocks.set(fromId, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (addSessionLocks.get(fromId) === chained) {
      addSessionLocks.delete(fromId);
    }
  }
}

const activeEditSessions: Map<string, { templateKey: string }> = new Map();
const activeSetChannelSessions: Map<string, { timestamp: number }> = new Map();
const activeCloneSessions: Map<string, CloneSession> = new Map();

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

// Unique process instance identifier for distributed leader election and update locking
export const BOT_INSTANCE_ID = 'inst_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();

// Global singleton active bot map (keyed by canonical botId: 'main' or normalized numeric clone ID)
export interface ActiveBotHandle {
  botId: string;
  token: string;
  stop: (options?: { dropPendingUpdates?: boolean }) => Promise<void>;
  isAlive: () => boolean;
}
export const activeBots: Record<string, ActiveBotHandle> = {};

// Per-bot async startup/stop mutex to prevent concurrent duplicate launches
const botLifecycleLocks = new Map<string, Promise<void>>();
async function withBotLifecycleLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = botLifecycleLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => {}).then(() => current);
  botLifecycleLocks.set(key, chained);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (botLifecycleLocks.get(key) === chained) {
      botLifecycleLocks.delete(key);
    }
  }
}

export interface BotLockConflict {
  botId: string;
  reason: 'local_process_lock' | 'remote_instance_lock' | 'external_webhook_active' | 'telegram_409_conflict';
  holder: string;
  message: string;
  detectedAt: string;
  detectedAtMs: number;
}

interface HeldBotLockEntry {
  token: string;
  tokenHash: string;
  botId: string;
  lockPath: string;
  timer: NodeJS.Timeout;
}

/**
 * Multi-layer Singleton Lock for Telegram bot polling instances:
 * 1) Local OS PID lockfile in os.tmpdir() (prevents duplicate local Node processes/restarts)
 * 2) Cross-server Firebase RTDB token lock (/bot_token_locks/<sha256>) (prevents Render + Dev/Preview dual polling)
 * 3) Telegram API getWebhookInfo & getUpdates probe (catches unknown external pollers/webhooks via 409)
 */
export class BotSingletonLock {
  private static heldLocks = new Map<string, HeldBotLockEntry>();
  private static conflicts = new Map<string, BotLockConflict>();
  private static readonly LOCAL_STALE_MS = 35000;
  private static readonly RTDB_TTL_MS = 22000;
  private static readonly HEARTBEAT_INTERVAL_MS = 6000;

  public static isPrimaryProdHost(): boolean {
    return Boolean(
      process.env.RENDER ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.RENDER_SERVICE_ID ||
      process.env.NODE_ENV === 'production'
    );
  }

  private static getEnvLabel(): string {
    if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_ID) {
      return `render(${process.env.RENDER_EXTERNAL_HOSTNAME || os.hostname()})`;
    }
    return `${process.env.NODE_ENV || 'development'}(${os.hostname()})`;
  }

  private static getLockFilePath(tokenHash: string): string {
    return path.join(os.tmpdir(), `tg_bot_singleton_${tokenHash}.lock`);
  }

  private static isPidAlive(pid: number): boolean {
    if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      // On Linux containers, guard against recycled low PIDs owned by init/shells rather than Node.js
      try {
        const cmdlinePath = `/proc/${pid}/cmdline`;
        if (fs.existsSync(cmdlinePath)) {
          const cmd = fs.readFileSync(cmdlinePath, 'utf8').replace(/\0/g, ' ').trim().toLowerCase();
          if (cmd && !cmd.includes('node') && !cmd.includes('tsx') && !cmd.includes('bun') && !cmd.includes('npm')) {
            return false;
          }
        }
      } catch {}
      return true;
    } catch (err: any) {
      // EPERM means process exists but owned by another user
      return err?.code === 'EPERM';
    }
  }

  public static recordConflict(
    botId: string,
    reason: BotLockConflict['reason'],
    holder: string,
    message: string
  ): BotLockConflict {
    const conflict: BotLockConflict = {
      botId,
      reason,
      holder,
      message,
      detectedAt: new Date().toISOString(),
      detectedAtMs: Date.now()
    };
    this.conflicts.set(botId, conflict);
    return conflict;
  }

  public static clearConflict(botId: string): void {
    this.conflicts.delete(botId);
  }

  public static getConflict(botId: string): Omit<BotLockConflict, 'detectedAtMs'> | null {
    const c = this.conflicts.get(botId);
    if (!c) return null;
    const { detectedAtMs: _ignored, ...pub } = c;
    return pub;
  }

  public static getAllConflicts(): Record<string, Omit<BotLockConflict, 'detectedAtMs'>> {
    const out: Record<string, Omit<BotLockConflict, 'detectedAtMs'>> = {};
    for (const [id, c] of this.conflicts.entries()) {
      const { detectedAtMs: _ignored, ...pub } = c;
      out[id] = pub;
    }
    return out;
  }

  public static hasRecentConflict(botId: string, withinMs: number = 60000): boolean {
    const c = this.conflicts.get(botId);
    if (!c) return false;
    return (Date.now() - c.detectedAtMs) < withinMs;
  }

  public static isHoldingLock(token: string): boolean {
    if (!token) return false;
    const tokenHash = SharedStorageService.hashToken(token);
    return this.heldLocks.has(tokenHash);
  }

  private static writeLocalLockPayload(lockPath: string, tokenHash: string, botId: string, exclusive: boolean): void {
    const payload = JSON.stringify({
      tokenHash,
      botId,
      pid: process.pid,
      instanceId: BOT_INSTANCE_ID,
      host: os.hostname(),
      env: this.getEnvLabel(),
      isPrimary: this.isPrimaryProdHost(),
      heartbeat: Date.now(),
      startedAt: new Date().toISOString()
    });
    fs.writeFileSync(lockPath, payload, exclusive ? { flag: 'wx', mode: 0o600 } : { flag: 'w', mode: 0o600 });
  }

  private static handleExitIfConfigured(botId: string, reason: string): void {
    if (botId === 'main') return;
    if (process.env.EXIT_ON_BOT_CONFLICT === 'true') {
      console.error(`🛑 [BotSingletonLock] EXIT_ON_BOT_CONFLICT=true — exiting process due to conflict on bot "${botId}" (${reason}).`);
      setTimeout(() => process.exit(1), 150);
    }
  }

  public static async acquire(
    token: string,
    botId: string,
    opts?: { probeTelegram?: boolean; isStartupBoot?: boolean; forcePrimaryReset?: boolean }
  ): Promise<{ ok: true; tokenHash: string } | { ok: false; conflict: BotLockConflict }> {
    const cleanToken = String(token || '').trim().replace(/^["']|["']$/g, '');
    if (!cleanToken) {
      const conflict = this.recordConflict(botId, 'local_process_lock', 'missing_token', 'Bot token is missing.');
      return { ok: false, conflict };
    }

    const isMain = botId === 'main';
    const isPrimaryProd = this.isPrimaryProdHost();
    const forceReset = isMain || Boolean(opts?.forcePrimaryReset);
    const tokenHash = SharedStorageService.hashToken(cleanToken);
    const lockPath = this.getLockFilePath(tokenHash);
    const alreadyHeld = this.heldLocks.get(tokenHash);

    // 1. Check / acquire local OS PID lockfile
    try {
      if (fs.existsSync(lockPath)) {
        let existing: any = null;
        try {
          existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch {
          existing = null;
        }

        const existingPid = Number(existing?.pid || 0);
        const sameProcess =
          existing &&
          (existingPid === process.pid ||
            existingPid === process.ppid ||
            existing.instanceId === BOT_INSTANCE_ID);
        let aliveOther =
          existing &&
          !sameProcess &&
          this.isPidAlive(existingPid) &&
          (Date.now() - Number(existing.heartbeat || 0)) < this.LOCAL_STALE_MS;

        // Allow brief exit grace period when dev/tsx restarts cleanly
        if (aliveOther && (isMain || opts?.isStartupBoot)) {
          await new Promise((r) => setTimeout(r, 300));
          aliveOther =
            this.isPidAlive(existingPid) &&
            fs.existsSync(lockPath) &&
            (Date.now() - Number(existing.heartbeat || 0)) < this.LOCAL_STALE_MS;
        }

        if (aliveOther && !(isMain && isPrimaryProd)) {
          const holder = `PID ${existing.pid} (${existing.instanceId || 'local'}) on ${existing.host || os.hostname()}`;
          const message = `Local process lock conflict for bot "${botId}": already polling in ${holder}. Refusing duplicate background listener.`;
          console.error(`\n❌ [BotSingletonLock] LOCAL PROCESS LOCK CONFLICT [${botId}]\n   Holder: ${holder}\n   Lockfile: ${lockPath}\n   Action: Halted conflicting bot listener.\n`);
          const conflict = this.recordConflict(botId, 'local_process_lock', holder, message);
          this.handleExitIfConfigured(botId, 'local_process_lock');
          return { ok: false, conflict };
        }

        if (!sameProcess) {
          try { fs.unlinkSync(lockPath); } catch {}
        }
      }

      if (!alreadyHeld) {
        try {
          this.writeLocalLockPayload(lockPath, tokenHash, botId, true);
        } catch (err: any) {
          if (err?.code === 'EEXIST') {
            let racer: any = null;
            try { racer = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
            const racerPid = Number(racer?.pid || 0);
            const racerIsOtherAlive =
              racer &&
              racerPid !== process.pid &&
              racerPid !== process.ppid &&
              racer.instanceId !== BOT_INSTANCE_ID &&
              this.isPidAlive(racerPid);
            if (racerIsOtherAlive && !(isMain && isPrimaryProd)) {
              const holder = `PID ${racer.pid} (${racer.instanceId || 'local'})`;
              const message = `Local startup lock race detected for bot "${botId}": lock claimed by ${holder}.`;
              console.error(`\n❌ [BotSingletonLock] LOCAL STARTUP RACE CONFLICT [${botId}]\n   Claimed by: ${holder}\n   Action: Terminated duplicate startup.\n`);
              const conflict = this.recordConflict(botId, 'local_process_lock', holder, message);
              this.handleExitIfConfigured(botId, 'local_process_lock');
              return { ok: false, conflict };
            }
            this.writeLocalLockPayload(lockPath, tokenHash, botId, false);
          } else {
            throw err;
          }
        }
      } else {
        this.writeLocalLockPayload(lockPath, tokenHash, botId, false);
      }
    } catch (fsErr: any) {
      console.warn(`[BotSingletonLock] Local lockfile notice (${lockPath}):`, fsErr?.message || fsErr);
    }

    // 2. Check / claim distributed cross-server Firebase RTDB lock
    // Primary main bot cleanly resets/acquires the primary lock rather than halting its own startup.
    const meta = {
      instanceId: BOT_INSTANCE_ID,
      host: os.hostname(),
      pid: process.pid,
      botId,
      env: this.getEnvLabel(),
      isPrimary: isPrimaryProd
    };

    const mainStorage = StorageManager.getMainStorage();
    const rtdbClaim = await mainStorage.tryClaimTokenLock(cleanToken, meta, this.RTDB_TTL_MS, {
      forceReset,
      isStartupBoot: opts?.isStartupBoot
    });
    if (rtdbClaim.acquired && rtdbClaim.overwrote) {
      console.info(
        `🔄 [BotSingletonLock] Primary lock reset for "${botId}" (cleared prior holder: ${rtdbClaim.overwrote.env || rtdbClaim.overwrote.host || rtdbClaim.overwrote.instanceId}).`
      );
    }
    if (!rtdbClaim.acquired && rtdbClaim.conflict) {
      if (!alreadyHeld) {
        try { fs.unlinkSync(lockPath); } catch {}
      }
      const c = rtdbClaim.conflict;
      const holder = `${c.env || c.host} (PID ${c.pid}, ${c.instanceId})`;
      const message = `Cross-server singleton lock conflict for bot "${botId}": already active on ${holder}. Dual polling blocked to prevent duplicate replies.`;
      console.error(`\n❌ [BotSingletonLock] CROSS-SERVER TOKEN CONFLICT [${botId}]\n   Active Instance: ${holder}\n   Token Hash: ${tokenHash}\n   Action: Blocking conflicting bot listener in this process.\n`);
      const conflict = this.recordConflict(botId, 'remote_instance_lock', holder, message);
      this.handleExitIfConfigured(botId, 'remote_instance_lock');
      return { ok: false, conflict };
    }

    // 3. Probe Telegram API for an active external webhook or live 409 getUpdates conflict
    // Main bot clears stale webhooks unconditionally in runPollingLoop via deleteWebhook, so it does not halt here.
    if (opts?.probeTelegram !== false && !isMain) {
      // 3a. External reachable webhook check (prevents stealing a live external webhook handler)
      try {
        const whInfo = await TelegramService.callTelegramApi('getWebhookInfo', {}, cleanToken);
        const whUrl = String(whInfo?.result?.url || '').trim();
        if (whInfo?.ok && whUrl) {
          let ownHost = '';
          let whHost = '';
          try { ownHost = new URL(TelegramBotManager.getActiveBaseUrl()).hostname.toLowerCase(); } catch {}
          try { whHost = new URL(whUrl).hostname.toLowerCase(); } catch {}
          if (whHost && whHost !== ownHost && process.env.TAKEOVER_EXTERNAL_WEBHOOK !== 'true') {
            let externalReachable = false;
            try {
              const probeCtrl = new AbortController();
              const probeTimer = setTimeout(() => probeCtrl.abort(), 2500);
              const probeRes = await fetch(whUrl, { method: 'HEAD', signal: probeCtrl.signal }).catch(() => null);
              clearTimeout(probeTimer);
              const contentType = String(probeRes?.headers?.get('content-type') || '').toLowerCase();
              // Ignore 404 or HTML SPA catch-all responses; only treat genuine webhook endpoints (2xx / 405 non-HTML) as active
              if (probeRes && ((probeRes.status >= 200 && probeRes.status < 300) || probeRes.status === 405) && !contentType.includes('text/html')) {
                externalReachable = true;
              }
            } catch {}

            if (externalReachable) {
              if (!alreadyHeld) {
                try { fs.unlinkSync(lockPath); } catch {}
              }
              await mainStorage.releaseTokenLock(cleanToken, BOT_INSTANCE_ID).catch(() => {});
              const holder = `Webhook ${whUrl}`;
              const message = `Webhook conflict for bot "${botId}": reachable external webhook active at ${whUrl}. Refusing to override live webhook with polling.`;
              console.error(`\n❌ [BotSingletonLock] LIVE WEBHOOK CONFLICT [${botId}]\n   Active Webhook: ${whUrl}\n   Action: Polling aborted to protect live webhook host.\n`);
              const conflict = this.recordConflict(botId, 'external_webhook_active', holder, message);
              this.handleExitIfConfigured(botId, 'external_webhook_active');
              return { ok: false, conflict };
            }
          }
        }
      } catch {}

      // 3b. Telegram getUpdates 409 session conflict probe (skipped on initial startup boot to avoid rolling-deploy false positives)
      if (!opts?.isStartupBoot) {
        try {
          const probeRes = await TelegramService.callTelegramApi('getUpdates', { offset: -1, limit: 1, timeout: 0 }, cleanToken);
          const probeDesc = String(probeRes?.description || '').toLowerCase();
          if (
            probeRes &&
            !probeRes.ok &&
            (probeRes.error_code === 409 || probeDesc.includes('409') || probeDesc.includes('terminated by other getupdates'))
          ) {
            if (!alreadyHeld) {
              try { fs.unlinkSync(lockPath); } catch {}
            }
            await mainStorage.releaseTokenLock(cleanToken, BOT_INSTANCE_ID).catch(() => {});
            const holder = 'Telegram remote poller (409 Conflict)';
            const message = `Telegram 409 session conflict for bot "${botId}": ${probeRes.description || 'another instance is actively polling this token'}.`;
            console.error(`\n❌ [BotSingletonLock] TELEGRAM 409 SESSION CONFLICT [${botId}]\n   Telegram Response: ${probeRes.description || '409 Conflict'}\n   Token Hash: ${tokenHash}\n   Action: Terminating conflicting bot startup immediately.\n`);
            const conflict = this.recordConflict(botId, 'telegram_409_conflict', holder, message);
            this.handleExitIfConfigured(botId, 'telegram_409_conflict');
            return { ok: false, conflict };
          }
        } catch {}
      }
    }

    // 4. Register / refresh heartbeat timer keeping BOTH local lockfile and RTDB lock alive
    if (alreadyHeld) {
      clearInterval(alreadyHeld.timer);
    }
    const timer = setInterval(() => {
      try {
        this.writeLocalLockPayload(lockPath, tokenHash, botId, false);
      } catch {}
      StorageManager.getMainStorage()
        .tryClaimTokenLock(cleanToken, meta, this.RTDB_TTL_MS, { forceReset: isMain && isPrimaryProd })
        .catch(() => {});
    }, this.HEARTBEAT_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.heldLocks.set(tokenHash, {
      token: cleanToken,
      tokenHash,
      botId,
      lockPath,
      timer
    });
    this.clearConflict(botId);
    console.info(`🔒 [BotSingletonLock] Lock acquired for bot "${botId}" (hash: ${tokenHash}, PID: ${process.pid}, env: ${this.getEnvLabel()}).`);
    return { ok: true, tokenHash };
  }

  public static async release(tokenOrHash: string, _botId?: string): Promise<void> {
    if (!tokenOrHash) return;
    const isHash = /^[a-f0-9]{20}$/i.test(tokenOrHash);
    const tokenHash = isHash ? tokenOrHash : SharedStorageService.hashToken(tokenOrHash);
    const entry = this.heldLocks.get(tokenHash);
    if (entry) {
      clearInterval(entry.timer);
      this.heldLocks.delete(tokenHash);
      try {
        if (fs.existsSync(entry.lockPath)) {
          fs.unlinkSync(entry.lockPath);
        }
      } catch {}
      await StorageManager.getMainStorage().releaseTokenLock(entry.token, BOT_INSTANCE_ID).catch(() => {});
    } else if (!isHash) {
      const lockPath = this.getLockFilePath(tokenHash);
      try {
        if (fs.existsSync(lockPath)) {
          const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          if (Number(existing?.pid) === process.pid) {
            fs.unlinkSync(lockPath);
          }
        }
      } catch {}
      await StorageManager.getMainStorage().releaseTokenLock(tokenOrHash, BOT_INSTANCE_ID).catch(() => {});
    }
  }

  public static async releaseAll(): Promise<void> {
    const entries = Array.from(this.heldLocks.values());
    this.heldLocks.clear();
    await Promise.allSettled(
      entries.map(async (entry) => {
        clearInterval(entry.timer);
        try {
          if (fs.existsSync(entry.lockPath)) {
            fs.unlinkSync(entry.lockPath);
          }
        } catch {}
        await StorageManager.getMainStorage().releaseTokenLock(entry.token, BOT_INSTANCE_ID).catch(() => {});
      })
    );
  }

  public static releaseAllSync(): void {
    for (const entry of this.heldLocks.values()) {
      clearInterval(entry.timer);
      try {
        if (fs.existsSync(entry.lockPath)) {
          fs.unlinkSync(entry.lockPath);
        }
      } catch {}
    }
    this.heldLocks.clear();
  }
}

// In-flight update lock set to prevent parallel concurrent execution of the same update
const inFlightUpdateKeys = new Set<string>();

// Processed update keys with timestamp for local cache deduplication (2 minutes window)
const processedUpdateKeys = new Map<string, number>();

function extractUpdateKeys(update: any, botId: string = 'main'): string[] {
  if (!update) return [];
  const keys: string[] = [];

  if (update.update_id !== undefined && update.update_id !== null) {
    keys.push(`${botId}_uid_${update.update_id}`);
  }

  const msg = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
  if (msg?.message_id && msg?.chat?.id) {
    keys.push(`${botId}_msg_${msg.chat.id}_${msg.message_id}`);

    // Command & text-level active debounce to prevent rapid double-processing of identical message
    const txt = (msg.text || msg.caption || '').trim();
    if (txt && msg.from?.id) {
      const cleanSnippet = txt.slice(0, 32).toLowerCase();
      keys.push(`${botId}_deb_${msg.chat.id}_${msg.from.id}_${cleanSnippet}`);
    }
  }

  if (update.callback_query?.id) {
    keys.push(`${botId}_cb_${update.callback_query.id}`);
  }

  return keys;
}

// Super-fast 0ms latency update deduplication: eliminates delay before replying to users
function claimExclusiveTelegramUpdate(update: any, botId: string = 'main'): { allowed: boolean; keys: string[] } {
  if (!update) return { allowed: false, keys: [] };
  const now = Date.now();

  // Prune entries older than 2 minutes
  if (processedUpdateKeys.size > 2000) {
    for (const [k, time] of processedUpdateKeys.entries()) {
      if (now - time > 120000) processedUpdateKeys.delete(k);
    }
  }

  const keys = extractUpdateKeys(update, botId);
  if (keys.length === 0) return { allowed: true, keys: [] };

  // 1. In-flight check: if any key is currently running, drop immediately (0ms)
  for (const k of keys) {
    if (inFlightUpdateKeys.has(k)) {
      return { allowed: false, keys };
    }
  }

  // 2. Local deduplication check (processed within TTL window) (0ms)
  for (const k of keys) {
    const lastSeen = processedUpdateKeys.get(k);
    if (lastSeen) {
      const ttl = k.includes('_cb_act_') ? 300 : k.includes('_deb_') ? 1500 : 90000;
      if (now - lastSeen < ttl) {
        return { allowed: false, keys };
      }
    }
  }

  // Mark all keys as in-flight and processed immediately (zero lag)
  for (const k of keys) {
    inFlightUpdateKeys.add(k);
    processedUpdateKeys.set(k, now);
  }

  // 3. Asynchronously record distributed update claim in background without blocking message response
  const primaryKey = keys[0];
  storage.claimDistributedTelegramUpdate(primaryKey, BOT_INSTANCE_ID, 90000).catch(() => {});

  return { allowed: true, keys };
}

function releaseExclusiveTelegramUpdate(keys: string[]): void {
  for (const k of keys) {
    inFlightUpdateKeys.delete(k);
  }
}

export function getItemPayload(item: ItemRecord): string {
  if (item.id.startsWith('f_') || item.id.startsWith('l_')) {
    return item.id;
  }
  return `${item.type === 'file' ? 'f_' : 'l_'}${item.id}`;
}

export class TelegramService {
  private static forceSubCache = new Map<string, { allJoined: boolean; unjoinedChannels: ForceSubChannel[]; expiresAt: number }>();

  public static invalidateForceSubCache(userId?: string | number): void {
    if (!userId) {
      this.forceSubCache.clear();
      return;
    }
    const uid = String(userId).trim();
    for (const k of this.forceSubCache.keys()) {
      if (k.endsWith(`_${uid}`)) this.forceSubCache.delete(k);
    }
  }

  public static async getBotToken(): Promise<string> {
    const ctxToken = botTokenContext.getStore();
    if (ctxToken) {
      return String(ctxToken).trim().replace(/^["']|["']$/g, '');
    }

    const activeBotId = (storage as any)?.botId || 'main';
    if (activeBotId !== 'main') {
      const settings = await storage.getSettings().catch(() => ({} as any));
      if (settings?.botToken) {
        return String(settings.botToken).trim().replace(/^["']|["']$/g, '');
      }
      const mainStorage = StorageManager.getMainStorage();
      const cloned = await mainStorage.getClonedBots().catch(() => []);
      const found = cloned.find(b => b.id === activeBotId);
      if (found?.token) {
        return String(found.token).trim().replace(/^["']|["']$/g, '');
      }
      return '';
    }

    const envToken = (
      process.env.BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.TG_BOT_TOKEN ||
      process.env.BOT_API_TOKEN ||
      process.env.TOKEN ||
      ''
    ).trim().replace(/^["']|["']$/g, '');
    if (envToken) return envToken;
    const settings = await storage.getSettings().catch(() => ({} as any));
    return (settings?.botToken || '').trim().replace(/^["']|["']$/g, '');
  }

  public static async callTelegramApi(
    method: string,
    payload: Record<string, any>,
    tokenOverride?: string,
    externalSignal?: AbortSignal
  ): Promise<any> {
    if (externalSignal?.aborted) {
      return { ok: false, aborted: true, description: 'Aborted' };
    }

    const rawToken = tokenOverride || botTokenContext.getStore() || await this.getBotToken();
    const token = (rawToken || '').trim().replace(/^["']|["']$/g, '');
    if (!token) {
      console.warn(`[Telegram] Skipping ${method}: No TELEGRAM_BOT_TOKEN configured.`);
      return { ok: false, description: 'No bot token configured' };
    }

    // Ensure HTML parse mode by default for text/message methods if not explicitly specified
    if (!payload.parse_mode && (method === 'sendMessage' || method === 'editMessageText' || method === 'sendPhoto' || method === 'sendVideo' || method === 'sendDocument' || method === 'sendAudio' || method === 'sendAnimation' || method === 'sendVoice')) {
      payload.parse_mode = 'HTML';
    }

    // Adaptive timeout: for long-polling (getUpdates), allow payload.timeout + 15s. Standard calls allow 15s.
    const timeoutSeconds = method === 'getUpdates'
      ? (Number(payload?.timeout) || 10) + 15
      : 15;

    const executeRequest = async (reqPayload: Record<string, any>): Promise<any> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      const onExternalAbort = () => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          clearTimeout(timeoutId);
          throw new DOMException('Aborted', 'AbortError');
        }
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
          signal: controller.signal
        });
        return await res.json();
      } finally {
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }
    };

    try {
      let currentPayload: Record<string, any> = { ...payload };
      let data = await executeRequest(currentPayload);

      // Chained error-resilient fallback retries (handles combined parse_mode, reply_to_message_id, thread_id, and inline style rejections)
      for (let retryPass = 0; retryPass < 4 && data && !data.ok; retryPass++) {
        const desc = typeof data.description === 'string' ? data.description.toLowerCase() : '';
        let modified = false;

        // CRITICAL: Never strip `style` or retry when message content/markup is unchanged ("message is not modified")
        // or when the target message/chat/callback no longer exists.
        if (
          desc.includes('not modified') ||
          desc.includes('message to edit not found') ||
          desc.includes('message_id_invalid') ||
          desc.includes('query is too old') ||
          desc.includes('chat not found')
        ) {
          break;
        }

        if (currentPayload.parse_mode && (desc.includes('parse entities') || desc.includes("can't parse"))) {
          console.warn(`[Telegram] ${method} failed with entity parsing (${data.description}). Retrying without parse_mode...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.parse_mode;
          currentPayload = nextPayload;
          modified = true;
        } else if (currentPayload.reply_to_message_id && (desc.includes('replied') || desc.includes('reply'))) {
          console.warn(`[Telegram] ${method} failed with reply_to_message_id (${data.description}). Retrying without reply_to_message_id...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.reply_to_message_id;
          currentPayload = nextPayload;
          modified = true;
        } else if (currentPayload.message_thread_id && desc.includes('thread')) {
          console.warn(`[Telegram] ${method} failed with message_thread_id (${data.description}). Retrying without message_thread_id...`);
          const nextPayload = { ...currentPayload };
          delete nextPayload.message_thread_id;
          currentPayload = nextPayload;
          modified = true;
        } else if (
          Array.isArray(currentPayload?.reply_markup?.inline_keyboard) &&
          (desc.includes('style') || desc.includes('reply_markup') || desc.includes('button') || desc.includes('keyboard'))
        ) {
          const hasStyle = currentPayload.reply_markup.inline_keyboard.some((row: any[]) =>
            Array.isArray(row) && row.some((btn: any) => btn && typeof btn === 'object' && 'style' in btn)
          );
          if (hasStyle) {
            const strippedKeyboard = currentPayload.reply_markup.inline_keyboard.map((row: any[]) =>
              Array.isArray(row)
                ? row.map((btn: any) => {
                    if (!btn || typeof btn !== 'object') return btn;
                    const { style, ...rest } = btn;
                    return rest;
                  })
                : row
            );
            currentPayload = {
              ...currentPayload,
              reply_markup: { ...currentPayload.reply_markup, inline_keyboard: strippedKeyboard }
            };
            modified = true;
          }
        }

        if (!modified) break;
        data = await executeRequest(currentPayload);
      }

      return data;
    } catch (err: any) {
      if (method === 'getUpdates' && (err.name === 'AbortError' || err.message?.includes('aborted'))) {
        // Normal long-poll cycle completion; return empty updates cleanly without logging error
        return { ok: true, result: [] };
      }
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
        if (editRes && typeof editRes.description === 'string' && editRes.description.toLowerCase().includes('message is not modified')) {
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
      update.shipping_query?.from ||
      update.pre_checkout_query?.from ||
      update.poll_answer?.user ||
      update.my_chat_member?.from ||
      update.chat_member?.from ||
      update.chat_join_request?.from ||
      update.message_reaction?.user ||
      update.message?.forward_from;

    const SERVICE_IDS = ['777000', '1087968824', '136817688'];

    if (rawUser && rawUser.id) {
      const rawIdStr = String(rawUser.id).trim();
      const rawUsername = (rawUser.username || '').toLowerCase().trim();

      // Exclude negative IDs (groups/supergroups/channels)
      if (rawIdStr.startsWith('-') || Number(rawIdStr) <= 0) {
        return null;
      }
      // Exclude Telegram service accounts
      if (SERVICE_IDS.includes(rawIdStr)) {
        return null;
      }
      // Exclude Telegram bots
      if (rawUser.is_bot || rawUsername.endsWith('bot')) {
        return null;
      }

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
      const chatIdStr = String(chat.id).trim();
      const chatUsername = (chat.username || '').toLowerCase().trim();

      if (
        !chatIdStr.startsWith('-') &&
        Number(chatIdStr) > 0 &&
        !SERVICE_IDS.includes(chatIdStr) &&
        !chatUsername.endsWith('bot')
      ) {
        return {
          id: chat.id,
          username: chat.username ? `@${chat.username.replace(/^@+/, '').trim()}` : undefined,
          firstName: chat.first_name,
          lastName: chat.last_name
        };
      }
    }

    return null;
  }

  public static escapeHtml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  public static formatCode(value: string | number | undefined | null): string {
    return `<code>${this.escapeHtml(String(value ?? ''))}</code>`;
  }

  public static formatBold(value: string | number | undefined | null): string {
    return `<b>${this.escapeHtml(String(value ?? ''))}</b>`;
  }

  public static formatItalic(value: string | number | undefined | null): string {
    return `<i>${this.escapeHtml(String(value ?? ''))}</i>`;
  }

  public static formatHeader(title: string, icon?: string): string {
    return `${icon ? `${icon} ` : ''}<b>${this.escapeHtml(title)}</b>`;
  }

  public static formatField(
    label: string,
    value: string | number | undefined | null,
    options?: { icon?: string; code?: boolean; rawHtmlValue?: boolean }
  ): string {
    const valStr = String(value ?? '');
    const formattedValue = options?.rawHtmlValue
      ? valStr
      : options?.code !== false
      ? `<code>${this.escapeHtml(valStr)}</code>`
      : this.escapeHtml(valStr);
    return `• ${options?.icon ? `${options.icon} ` : ''}<b>${this.escapeHtml(label)}:</b> ${formattedValue}`;
  }

  public static formatNotice(icon: string, title: string, body?: string): string {
    return `${icon} <b>${this.escapeHtml(title)}</b>${body ? `\n<i>${this.escapeHtml(body)}</i>` : ''}`;
  }

  public static formatUserIdentity(name?: string, username?: string, id?: string | number): string {
    const cleanName = (name || '').trim();
    const cleanUsername = (username || '').replace(/^@+/, '').trim();
    const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
    const primary = cleanName ? `<code>${this.escapeHtml(cleanName)}</code>` : (cleanUsername ? `<code>@${this.escapeHtml(cleanUsername)}</code>` : '<code>User</code>');
    const extras: string[] = [];
    if (cleanUsername && (!cleanName || cleanName.replace(/^@+/, '').toLowerCase() !== cleanUsername.toLowerCase())) {
      extras.push(`@${this.escapeHtml(cleanUsername)}`);
    }
    if (cleanId) {
      extras.push(`<b>ID:</b> <code>${this.escapeHtml(cleanId)}</code>`);
    }
    return extras.length > 0 ? `${primary} (${extras.join(' | ')})` : primary;
  }

  // Dynamically resolve placeholders inside Maintenance Notice:
  // Supports Telegram Username (@username, {username}), User ID ({user_id}, {id}), Bot Name ({bot_name}, {bot}), and Name ({name}, {user_name})
  public static resolveMaintenanceNotice(
    template: string,
    userPayload: { id: string | number; username?: string; firstName?: string; lastName?: string } | null,
    fromId: string,
    botUsername: string
  ): string {
    if (!template) return '⚠️ <b>Maintenance Notice</b>\n<i>Bot is currently under maintenance. Please try again later.</i>';

    const rawUsername = userPayload?.username?.replace(/^@+/, '').trim() || '';
    const userMention = rawUsername ? `@${rawUsername}` : (userPayload?.firstName || 'User');
    const userDisplayName = [userPayload?.firstName, userPayload?.lastName].filter(Boolean).join(' ') || (rawUsername ? `@${rawUsername}` : 'User');
    const firstName = userPayload?.firstName || (rawUsername ? `@${rawUsername}` : 'User');
    const resolvedUserId = String(fromId || userPayload?.id || '').trim() || 'Unknown';
    const cleanBotUsername = (botUsername || '').replace(/^@+/, '').trim() || 'Bot';
    const botMention = `@${cleanBotUsername}`;

    let result = template;

    // 1. Bracketed tags (case-insensitive)
    result = result.replace(/\{@?username\}/gi, userMention);
    result = result.replace(/\{user_id\}|\{userid\}|\{id\}|\{chat_id\}|\{chatid\}/gi, resolvedUserId);
    result = result.replace(/\{bot_name\}|\{botname\}|\{bot\}|\{bot_username\}|\{@bot_name\}|\{@bot\}/gi, botMention);
    result = result.replace(/\{name\}|\{user_name\}|\{fullname\}/gi, userDisplayName);
    result = result.replace(/\{first_name\}|\{firstname\}/gi, firstName);

    // 2. Exact word tokens (e.g. @username without brackets)
    result = result.replace(/(^|\s)@username\b/gi, `$1${userMention}`);
    result = result.replace(/(^|\s)@bot_name\b/gi, `$1${botMention}`);
    result = result.replace(/(^|\s)@bot\b/gi, `$1${botMention}`);

    // Prevent duplicate @@ if template had @@username
    result = result.replace(/@@+([a-zA-Z0-9_]+)/g, '@$1');

    return result.trim();
  }

  // Process incoming webhook or polling update
  public static async handleUpdate(update: any, tokenOverride?: string, botId: string = 'main'): Promise<void> {
    if (!update) return;

    const canonicalBotId = String(botId || 'main').trim() || 'main';

    // Hard lifecycle guard: halt all processing immediately for deleted or stopped bots
    if (canonicalBotId !== 'main') {
      if (TelegramBotManager.isBotDeleted(canonicalBotId) || TelegramBotManager.isBotStopped(canonicalBotId)) {
        return;
      }
    } else if (TelegramService.isManuallyStopped()) {
      return;
    }

    const expectedStorage = StorageManager.getStorage(canonicalBotId);
    if (storageContext.getStore() !== expectedStorage) {
      return storageContext.run(expectedStorage, () => this.handleUpdate(update, tokenOverride, canonicalBotId));
    }
    if (botIdContext.getStore() !== canonicalBotId) {
      return botIdContext.run(canonicalBotId, () => this.handleUpdate(update, tokenOverride, canonicalBotId));
    }
    if (tokenOverride && botTokenContext.getStore() !== tokenOverride) {
      return botTokenContext.run(tokenOverride, () => this.handleUpdate(update, undefined, canonicalBotId));
    }

    // Strict multi-instance atomic deduplication: prevents duplicate execution and double replies (0ms instant)
    const { allowed, keys } = claimExclusiveTelegramUpdate(update, botId);
    if (!allowed) {
      return;
    }

    try {
      // Ignore edited messages for commands and general replies to prevent double replies on edit
      if (update.edited_message && !update.message) {
        const fromId = String(update.edited_message.from?.id || '');
        const isInInteractiveSession = activeAddSessions.has(fromId) || activeEditSessions.has(fromId) || activeCloneSessions.has(fromId);
        if (!isInInteractiveSession) {
          return;
        }
      }

      // 0. GLOBAL CHAT WHITELIST / IGNORE MIDDLEWARE GUARD
      // Inspect target chat BEFORE tracking, my_chat_member auto-detection, chat_join_request,
      // callback queries, force-sub prompts, or any command handling.
      const targetChat =
        update.message?.chat ||
        update.edited_message?.chat ||
        update.channel_post?.chat ||
        update.edited_channel_post?.chat ||
        update.callback_query?.message?.chat ||
        update.my_chat_member?.chat ||
        update.chat_member?.chat ||
        update.chat_join_request?.chat;

      if (targetChat && targetChat.id !== undefined && targetChat.type !== 'private') {
        const isAllowed = await storage.isChatWhitelisted(targetChat.id, targetChat.type);
        if (!isAllowed) {
          // Never drop incoming chat_join_request or chat_member updates when Force Sub is active or chat matches a Force Sub channel
          let allowForceSubEvent = false;
          if (update.chat_join_request || update.chat_member) {
            const s = await storage.getSettings().catch(() => null);
            const targetIdStr = String(targetChat.id || '').trim();
            const targetUname = String(targetChat.username || '').replace(/^@+/, '').toLowerCase().trim();
            const inRequired = (s?.requiredChannels || []).some((ch) => {
              const cId = String(ch.chatId || '').trim();
              const cUname = String(ch.username || '').replace(/^@+/, '').toLowerCase().trim();
              return cId === targetIdStr || (targetUname && (cUname === targetUname || cId.replace(/^@+/, '').toLowerCase() === targetUname));
            });
            allowForceSubEvent = Boolean(s?.forceSubEnabled || inRequired);
          }
          if (!allowForceSubEvent) {
            // Strict silent ignore: zero replies, zero auto-detection, zero force-sub prompts, even for admins
            return;
          }
        }
      }

      // 1. AUTOMATIC UNIQUE UID TRACKING & DATABASE SAVING (Requirement 1 & 2):
      // Intercept every incoming update (message, command like /start, callback query, etc.) from any user.
      // Extract their Telegram User ID, First Name, Last Name, and @username.
      // Immediately track in the background without blocking the bot's instant response.
      const userPayload = this.extractUserFromUpdate(update);
      const fromId = userPayload?.id ? String(userPayload.id).trim() : '';

      if (userPayload && userPayload.id) {
        storage.trackBotUser({
          id: userPayload.id,
          username: userPayload.username,
          firstName: userPayload.firstName,
          lastName: userPayload.lastName
        }).catch(() => {});
      }

      // Auto-Deletion Check: Process any past-due message deletions promptly
      TelegramService.processDueScheduledDeletions().catch(() => {});

      // Auto-detection of channels & groups where bot is added or active
      if (update.my_chat_member) {
        this.handleMyChatMemberUpdate(update.my_chat_member).catch((err) =>
          console.warn('[Telegram] Error in handleMyChatMemberUpdate:', err)
        );
      }
      // Handle Chat Join Request for Private Channels/Groups
      if (update.chat_join_request) {
        await this.handleChatJoinRequest(update.chat_join_request);
        return;
      }
      // Handle real-time channel/group member status updates (leaves, kicks, approvals)
      if (update.chat_member) {
        await this.handleChatMemberUpdate(update.chat_member);
        return;
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
              text: `⛔ <b>Access Restricted</b>\n\n<i>Your Telegram account (<code>${this.escapeHtml(fromId)}</code>) has been banned from using this bot by an administrator.</i>`,
              parse_mode: 'HTML'
            });
          }
          return;
        }
      }

      const senderUname = (
        userPayload?.username ||
        update.message?.from?.username ||
        update.edited_message?.from?.username ||
        update.callback_query?.from?.username ||
        ''
      ).replace(/^@+/, '').trim().toLowerCase();

      await senderUsernameContext.run(senderUname, async () => {
        // Maintenance Mode Enforcement:
        // When Maintenance Mode is ON, block responses to general commands, trigger keywords, and /start command.
        // Immediately reply with customized notice supporting dynamic variables (@username, {user_id}, {bot_name}, {name}).
        // Ensure admins can still access and use admin triggers/commands if needed.
        const settings = await storage.getSettings();
        if (settings.maintenanceMode) {
          const isAdmin = await this.isAuthorizedAdmin(fromId, senderUname);
          if (!isAdmin) {
            const rawNotice = settings.maintenanceNotice?.trim() || '⚠️ Bot is currently under maintenance. Please try again later.';
            const botUsername = await this.getBotUsername();
            const parsedNotice = this.resolveMaintenanceNotice(rawNotice, userPayload, fromId, botUsername);

            if (update.callback_query) {
              await this.callTelegramApi('answerCallbackQuery', {
                callback_query_id: update.callback_query.id,
                text: parsedNotice.replace(/<[^>]+>/g, '').slice(0, 200), // strip HTML tags for alert popup (max 200 chars)
                show_alert: true
              });
              return;
            }

            const msg = update.message || update.edited_message;
            if (msg?.chat) {
              if (msg.chat.type === 'private') {
                await this.callTelegramApi('sendMessage', {
                  chat_id: msg.chat.id,
                  text: parsedNotice,
                  parse_mode: 'HTML'
                });
              } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
                const txt = (msg.text || msg.caption || '').trim();
                // In groups, only respond if someone addressed the bot or used a slash command
                if (txt.startsWith('/') || (botUsername && txt.toLowerCase().includes(`@${botUsername.toLowerCase()}`))) {
                  await this.sendAutoDeletingNotice(msg.chat.id, parsedNotice, 6000, msg.message_id);
                }
              }
            }
            return;
          }
        }

        // Operational Mode Dispatch: Post Bot Mode delegates directly to PostBotEngine
        if (settings.botMode === 'post_bot') {
          await PostBotEngine.handleUpdate(update, botId, {
            callTelegramApi: (method, body, tkn) => this.callTelegramApi(method, body, tkn),
            isAuthorizedAdmin: (uid, uname) => this.isAuthorizedAdmin(uid, uname)
          });
          return;
        }

        // Handle Inline Button Clicks (Callback queries from /add flow and setup video navigation)
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
      });
    } finally {
      releaseExclusiveTelegramUpdate(keys);
    }
  }

  // In-memory cache for group admin statuses: `${botScope}:${chatId}:${userId}` -> { isAdmin: boolean, expiresAt: number }
  private static groupAdminCache: Map<string, { isAdmin: boolean; expiresAt: number }> = new Map();

  private static isMainBotContext(): boolean {
    const mainStorage = StorageManager.getMainStorage();
    const currentStorage = storageContext.getStore() || mainStorage;
    const activeBotId = String(botIdContext.getStore() || currentStorage?.botId || (storage as any)?.botId || 'main').trim() || 'main';
    return currentStorage === mainStorage && activeBotId === 'main';
  }

  public static async isGroupAdminOrCreator(chatId: string | number, userId: string | number): Promise<boolean> {
    if (!chatId || !userId) return false;
    const cleanChatId = String(chatId).trim();
    const cleanUserId = String(userId).trim();

    // 1. First check if user is a bot system owner/admin
    const isBotAdmin = await this.isAuthorizedAdmin(cleanUserId);
    if (isBotAdmin) return true;

    // 2. Check local in-memory cache scoped per bot
    const botScope = String((storage as any)?.botId || 'main').trim() || 'main';
    const cacheKey = `${botScope}:${cleanChatId}:${cleanUserId}`;
    const now = Date.now();
    const cached = this.groupAdminCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.isAdmin;
    }

    const numericChatId = /^-?\d+$/.test(cleanChatId) ? Number(cleanChatId) : cleanChatId;
    const numericUserId = Number(cleanUserId) || cleanUserId;

    // 3. Query Telegram getChatMember
    try {
      const res = await this.callTelegramApi('getChatMember', {
        chat_id: numericChatId,
        user_id: numericUserId
      });

      if (res && res.ok && res.result) {
        const status = String(res.result.status || '').toLowerCase();
        const isAdmin = status === 'administrator' || status === 'creator';
        this.groupAdminCache.set(cacheKey, {
          isAdmin,
          expiresAt: now + (isAdmin ? 60000 : 10000)
        });
        return isAdmin;
      }
    } catch (err: any) {
      console.warn(`[Telegram] Error querying getChatMember for admin check in chat ${cleanChatId}:`, err?.message || err);
    }

    // 4. Fallback: Query Telegram getChatAdministrators so verified group admins are never missed
    try {
      const adminsRes = await this.callTelegramApi('getChatAdministrators', {
        chat_id: numericChatId
      });
      if (adminsRes && adminsRes.ok && Array.isArray(adminsRes.result)) {
        let matched = false;
        for (const member of adminsRes.result) {
          const memberId = String(member?.user?.id || '').trim();
          if (memberId) {
            this.groupAdminCache.set(`${botScope}:${cleanChatId}:${memberId}`, {
              isAdmin: true,
              expiresAt: now + 60000
            });
            if (memberId === cleanUserId) {
              matched = true;
            }
          }
        }
        return matched;
      }
    } catch (err: any) {
      console.warn(`[Telegram] Fallback getChatAdministrators error for chat ${cleanChatId}:`, err?.message || err);
    }

    return false;
  }

  // =========================================================================
  // ADMIN AUTHORIZATION & AUTO-DELETING NOTICES (STRICT GROUP PRIVACY)
  // =========================================================================
  public static async isAuthorizedAdmin(fromId: string | number, fromUsername?: string): Promise<boolean> {
    if (!fromId) return false;
    const cleanId = String(fromId).trim();
    const rawUname = (fromUsername || senderUsernameContext.getStore() || '').replace(/^@+/, '').trim().toLowerCase();

    await storage.loadLatest(false);
    const admins = await storage.getAdmins();
    const settings = await storage.getSettings();
    const isMainBot = this.isMainBotContext();

    const rootAdminId = isMainBot
      ? String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || settings.rootAdminId || '8153757163').trim()
      : String(settings.rootAdminId || '').trim();

    if (rootAdminId && (cleanId === rootAdminId || rootAdminId.split(',').map((s) => s.trim()).includes(cleanId))) {
      return true;
    }

    const admin = await storage.getAdmin(cleanId);
    if (admin && admin.enabled) return true;

    if (admins.some((a) => a.enabled !== false && (String(a.telegramId).trim() === cleanId || String(a.id).trim() === cleanId))) {
      return true;
    }

    // Support @username-assigned cloned bot owners and auto-bind numeric Telegram User ID on first contact
    if (rawUname) {
      const matchedByUsername = admins.find((a) => {
        if (a.enabled === false) return false;
        const aUname = (a.username || '').replace(/^@+/, '').trim().toLowerCase();
        const aName = (a.name || '').replace(/^@+/, '').trim().toLowerCase();
        const aTg = (a.telegramId || '').replace(/^@+/, '').trim().toLowerCase();
        return aUname === rawUname || aName === rawUname || aTg === rawUname;
      });
      if (matchedByUsername) {
        if (/^\d+$/.test(cleanId) && !/^\d+$/.test(String(matchedByUsername.telegramId || ''))) {
          matchedByUsername.telegramId = cleanId;
          await storage.saveAdmin(matchedByUsername).catch(() => {});
          if (matchedByUsername.role === 'owner' && !/^\d+$/.test(String(settings.rootAdminId || ''))) {
            await storage.updateSettings({ rootAdminId: cleanId }).catch(() => {});
          }
        }
        return true;
      }
      if (!isMainBot && rootAdminId.replace(/^@+/, '').toLowerCase() === rawUname) {
        if (/^\d+$/.test(cleanId)) {
          await storage.updateSettings({ rootAdminId: cleanId }).catch(() => {});
        }
        return true;
      }
    }

    if (isMainBot && !rootAdminId && admins.length === 0) return true;
    return false;
  }

  public static async isOwnerAdmin(fromId: string | number, fromUsername?: string): Promise<boolean> {
    if (!fromId) return false;
    const cleanId = String(fromId).trim();
    const rawUname = (fromUsername || senderUsernameContext.getStore() || '').replace(/^@+/, '').trim().toLowerCase();

    await storage.loadLatest(false);
    const admins = await storage.getAdmins();
    const settings = await storage.getSettings();
    const isMainBot = this.isMainBotContext();

    const rootAdminRaw = isMainBot
      ? String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || settings.rootAdminId || '8153757163').trim()
      : String(settings.rootAdminId || '').trim();
    const rootIds = rootAdminRaw.split(',').map(s => s.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean);

    if (rootIds.includes(cleanId.toLowerCase()) || (rawUname && rootIds.includes(rawUname))) {
      return true;
    }

    const ownerRecord = admins.find(a =>
      a.enabled !== false &&
      a.role === 'owner' &&
      (
        String(a.telegramId || '').trim() === cleanId ||
        String(a.id || '').trim() === cleanId ||
        (rawUname && (
          String(a.username || '').replace(/^@+/, '').trim().toLowerCase() === rawUname ||
          String(a.name || '').replace(/^@+/, '').trim().toLowerCase() === rawUname
        ))
      )
    );
    return Boolean(ownerRecord);
  }

  private static async sendAdminHelpGuide(chatId: number | string, _fromId: string): Promise<void> {
    const isMainBot = this.isMainBotContext();
    const botUsername = await this.getBotUsername();
    const botLabel = botUsername ? `@${botUsername.replace(/^@/, '')}` : (isMainBot ? 'Main Bot' : 'Cloned Bot');

    const lines: string[] = [
      `🛡️ <b>ADMINISTRATOR COMMAND GUIDE</b>`,
      `🤖 <b>Active Bot:</b> ${this.escapeHtml(botLabel)}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📁 <b>CONTENT &amp; FILE MANAGEMENT</b>`,
      `• <code>/add</code> — Start interactive wizard to add Files, Links, or Text`,
      `• <code>/allfiles</code> — Browse &amp; copy links for stored files/links`,
      `• <code>/cancel</code> — Cancel active setup wizard (${isMainBot ? '/add, /clone, /setchannel' : '/add, /setchannel'})`,
      `• <code>/editthismessage</code> — Reply to a bot message to edit its template`,
      `• <code>/cleanup</code> — Remove tracked old bot messages (24h+)`,
      ``,
      `📢 <b>FORCE SUBSCRIBE &amp; CHANNELS</b>`,
      `• <code>/connect &lt;id_or_@user&gt;</code> — Connect channel/group to Force Sub`,
      `• <code>/setchannel</code> — Forward a private channel post to connect`,
      `• <code>/disconnect &lt;id_or_@user&gt;</code> — Remove channel from Force Sub`,
      ``,
      `🛡️ <b>CHAT WHITELIST &amp; IGNORE GUARD</b>`,
      `• <code>/allowchat [chat_id] [name]</code> — Whitelist group/channel &amp; enable guard`,
      `• <code>/ignorechat [chat_id]</code> — Remove chat from whitelist (ignore it)`,
      `• <code>/allowedchats</code> — View whitelisted chats &amp; guard status`,
      ``,
      `🔨 <b>MODERATION &amp; ACCESS CONTROL</b>`,
      `• <code>/linkdelete [on|off]</code> — Toggle unauthorized link deletion in groups`,
      `• <code>/ban &lt;id_or_@user&gt;</code> — Ban user (or reply <code>/ban</code> in group)`,
      `• <code>/unban &lt;id_or_@user&gt;</code> — Unban user &amp; clear warnings`,
      `• <code>/grantadmin &lt;id_or_@user&gt; [full|editor|moderator]</code> — <i>(Owner)</i> Promote user to Admin &amp; issue token`,
      `• <code>/revokeadmin &lt;id_or_@user&gt;</code> — <i>(Owner)</i> Revoke Admin permissions`,
      `• <code>/admins</code> — View admin count, root ID &amp; total bot users`,
      ``,
      `⚙️ <b>BOT CUSTOMIZATION &amp; PANEL LOGIN</b>`,
      `• <code>/setstartmsg &lt;text&gt;</code> — Update <code>/start</code> welcome message`,
      `• <code>/setstartmedia &lt;url|file_id&gt;</code> — Attach photo/video to <code>/start</code>`,
      `• <code>/clearstartmedia</code> — Remove media from <code>/start</code> message`,
      `• <code>/setpassword &lt;password&gt;</code> — Set/change Web Panel password`,
      `• <code>/broadcast</code> · <code>/settings</code> — Panel broadcast &amp; filter guide`,
      ...(isMainBot ? [`• <code>/clone &lt;bot_token&gt;</code> — Clone an isolated bot instance`] : []),
      ``,
      `🤖 <b>BOT LIFECYCLE &amp; MEMORY CONTROL</b>`,
      `• <code>/botstatus</code> — Check live polling status &amp; RAM usage`,
      `• <code>/botrestart${isMainBot ? ' [bot_id]' : ''}</code> — Restart bot listener &amp; flush caches`,
      `• <code>/botstop${isMainBot ? ' [bot_id]' : ''}</code> — Stop bot polling listener`,
      ...(isMainBot ? [`• <code>/botstart [bot_id]</code> — Start a stopped bot instance`] : []),
      `• <code>/memclean</code> — Purge runtime caches &amp; free server memory`,
      ``,
      `👥 <b>PUBLIC GROUP COMMANDS (ALL USERS)</b>`,
      `• <code>/u &lt;uid&gt;</code> or <code>/uid &lt;uid&gt;</code> — Free Fire profile &amp; Guild checker`,
      `• <code>/filters</code> — List public <code>#hashtag</code> keywords`,
      `• <code>/translate &lt;bd|ind|eng&gt;</code> — Translate text or replied messages`,
      `• <code>/report &lt;@user_or_id&gt; &lt;reason&gt;</code> — Report a user to admins`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🔒 <i>Admin commands are restricted to authorized owners/sub-admins and delivered privately. Manage broadcasts, fraud rules &amp; advanced settings in the Web Admin Panel.</i>`
    ];

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML'
    });
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
  // MANDATORY CHANNEL JOIN (FORCE SUB) SYSTEM & AUTO-DETECTION
  // =========================================================================

  // Auto-register and verify a channel or group where the bot is present/added
  public static async registerDetectedChat(chat: any, isExplicitAdmin?: boolean): Promise<ForceSubChannel | null> {
    if (!chat || !chat.id) return null;
    const chatId = String(chat.id).trim();
    const chatType = chat.type || 'channel';
    if (chatType === 'private') return null;

    try {
      let title = chat.title || chat.username || `Chat ${chatId}`;
      let username = chat.username ? `@${chat.username.replace(/^@/, '')}` : undefined;
      let inviteLink = chat.invite_link || '';

      if (!inviteLink && username) {
        inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
      }

      let isAdmin = isExplicitAdmin ?? false;
      try {
        const me = await this.callTelegramApi('getMe', {});
        const botId = me.result?.id;
        if (botId) {
          const memberRes = await this.callTelegramApi('getChatMember', {
            chat_id: chat.id,
            user_id: botId
          });
          if (memberRes && memberRes.ok && memberRes.result) {
            const st = memberRes.result.status;
            isAdmin = st === 'administrator' || st === 'creator';
          }
        }
      } catch {}

      if (!inviteLink && isAdmin) {
        try {
          const exportRes = await this.callTelegramApi('exportChatInviteLink', { chat_id: chat.id });
          if (exportRes && exportRes.ok && exportRes.result) {
            inviteLink = exportRes.result;
          }
        } catch {}
      }

      if (!inviteLink) {
        try {
          const fullChat = await this.callTelegramApi('getChat', { chat_id: chat.id });
          if (fullChat && fullChat.ok && fullChat.result) {
            title = fullChat.result.title || title;
            if (fullChat.result.username) username = `@${fullChat.result.username.replace(/^@/, '')}`;
            inviteLink = fullChat.result.invite_link || (username ? `https://t.me/${username.replace(/^@/, '')}` : '');
          }
        } catch {}
      }

      const registered = await storage.registerDetectedChannel({
        chatId,
        name: title,
        inviteLink,
        username,
        type: chatType as any,
        isAdmin,
        enabled: true
      });
      return registered;
    } catch (err: any) {
      console.warn('[Telegram] registerDetectedChat error for', chatId, err?.message);
      return null;
    }
  }

  // Handle bot being added or removed from channels/groups (my_chat_member updates)
  public static async handleMyChatMemberUpdate(myChatMember: any): Promise<void> {
    const chat = myChatMember.chat;
    const newMember = myChatMember.new_chat_member;
    if (!chat || !chat.id) return;

    const status = newMember?.status;
    const isAdmin = status === 'administrator' || status === 'creator';

    if (isAdmin || status === 'member') {
      await this.registerDetectedChat(chat, isAdmin);
      console.info(`[Telegram] Bot added/promoted in ${chat.type} "${chat.title}" (${chat.id})`);
    } else if (status === 'left' || status === 'kicked') {
      console.info(`[Telegram] Bot left/removed from ${chat.type} "${chat.title}" (${chat.id})`);
      await storage.removeForceSubChannel(String(chat.id));
    }
  }

  // Ultra-fast per-bot in-memory cache of incoming chat_join_request events for instant 0ms Request Only verification
  private static pendingJoinRequestCache: Map<
    string,
    Map<string, { chatId: string; chatUsername?: string; userId: string; userUsername?: string; createdAt: number }>
  > = new Map();

  private static recordCachedPendingJoinRequest(
    botScopeId: string,
    data: { chatId: string; chatUsername?: string; userId: string; userUsername?: string }
  ): void {
    const scope = String(botScopeId || 'main').trim() || 'main';
    let map = this.pendingJoinRequestCache.get(scope);
    if (!map) {
      map = new Map();
      this.pendingJoinRequestCache.set(scope, map);
    }
    const cleanChatId = String(data.chatId || '').trim();
    const cleanUserId = String(data.userId || '').trim();
    if (!cleanChatId || !cleanUserId) return;
    map.set(`${cleanChatId}_${cleanUserId}`, {
      chatId: cleanChatId,
      chatUsername: data.chatUsername ? data.chatUsername.replace(/^@+/, '').toLowerCase().trim() : undefined,
      userId: cleanUserId,
      userUsername: data.userUsername ? data.userUsername.replace(/^@+/, '').toLowerCase().trim() : undefined,
      createdAt: Date.now()
    });
  }

  public static clearCachedPendingJoinRequest(
    botScopeId: string,
    channel: Partial<ForceSubChannel> | string,
    userId: string | number,
    userUsername?: string,
    resolvedChatId?: string
  ): void {
    const scope = String(botScopeId || 'main').trim() || 'main';
    const map = this.pendingJoinRequestCache.get(scope);
    if (!map || map.size === 0) return;

    const cleanUserId = String(userId || '').trim();
    const cleanUserUname = String(userUsername || '').replace(/^@+/, '').toLowerCase().trim();
    const chObj = typeof channel === 'string' ? { chatId: channel, id: channel, username: undefined } : channel;
    const candidateChats = [
      String(chObj.chatId || '').trim(),
      resolvedChatId ? String(resolvedChatId).trim() : '',
      String(chObj.id || '').trim()
    ].filter(Boolean);
    const strippedCandidates = candidateChats.map(c => c.replace(/^-100/, '').replace(/^-/, '').replace(/^@+/, '').toLowerCase());
    const cleanChanUname = String(chObj.username || '').replace(/^@+/, '').toLowerCase().trim();

    for (const [k, entry] of Array.from(map.entries())) {
      const userMatch =
        (cleanUserId && entry.userId === cleanUserId) ||
        (cleanUserUname && entry.userUsername && entry.userUsername === cleanUserUname);
      if (!userMatch) continue;

      const entryChatStripped = entry.chatId.replace(/^-100/, '').replace(/^-/, '').replace(/^@+/, '').toLowerCase();
      const chatMatch =
        candidateChats.includes(entry.chatId) ||
        strippedCandidates.includes(entryChatStripped) ||
        (entry.chatUsername && (strippedCandidates.includes(entry.chatUsername) || (cleanChanUname && entry.chatUsername === cleanChanUname)));
      if (chatMatch) {
        map.delete(k);
      }
    }
  }

  public static async handleChatMemberUpdate(chatMember: any): Promise<void> {
    if (!chatMember || !chatMember.chat) return;
    const chat = chatMember.chat;
    const memberInfo = chatMember.new_chat_member;
    const memberUser = memberInfo?.user || chatMember.from;
    if (!memberUser?.id) return;

    const chatId = String(chat.id || '').trim();
    const chatUsername = chat.username ? `@${String(chat.username).replace(/^@+/, '')}` : undefined;
    const userId = String(memberUser.id).trim();
    const userUsername = memberUser.username ? String(memberUser.username).replace(/^@+/, '') : undefined;
    const newStatus = String(memberInfo?.status || '').trim();
    const botScopeId = String((storage as any)?.botId || 'main').trim() || 'main';

    this.invalidateForceSubCache(userId);

    if (newStatus === 'left' || newStatus === 'kicked') {
      this.clearCachedPendingJoinRequest(botScopeId, { chatId, username: chatUsername }, userId, userUsername, chatId);
      await storage.invalidateJoinRequest(chatId, userId, undefined, chatUsername, userUsername).catch(() => false);
      console.info(`[ForceSub] ChatMember ${newStatus} in ${chatId} for user ${userId}; cleared cached verification.`);
    } else if (
      newStatus === 'member' ||
      newStatus === 'administrator' ||
      newStatus === 'creator' ||
      (newStatus === 'restricted' && memberInfo?.is_member !== false)
    ) {
      this.clearCachedPendingJoinRequest(botScopeId, { chatId, username: chatUsername }, userId, userUsername, chatId);
      await storage.updateJoinRequestStatus(chatId, userId, 'approved').catch(() => null);
    }
  }

  private static hasCachedPendingJoinRequest(
    botScopeId: string,
    channel: ForceSubChannel,
    userId: string,
    userUsername?: string,
    resolvedChatId?: string,
    maxAgeMs?: number
  ): boolean {
    const scope = String(botScopeId || 'main').trim() || 'main';
    const map = this.pendingJoinRequestCache.get(scope);
    if (!map || map.size === 0) return false;

    const cleanUserId = String(userId || '').trim();
    const cleanUserUname = String(userUsername || '').replace(/^@+/, '').toLowerCase().trim();
    const candidateChats = [
      String(channel.chatId || '').trim(),
      resolvedChatId ? String(resolvedChatId).trim() : '',
      String(channel.id || '').trim()
    ].filter(Boolean);
    const strippedCandidates = candidateChats.map(c => c.replace(/^-100/, '').replace(/^-/, '').replace(/^@+/, '').toLowerCase());
    const cleanChanUname = String(channel.username || '').replace(/^@+/, '').toLowerCase().trim();
    const now = Date.now();

    for (const [key, entry] of Array.from(map.entries())) {
      const userMatch =
        (cleanUserId && entry.userId === cleanUserId) ||
        (cleanUserUname && entry.userUsername && entry.userUsername === cleanUserUname);
      if (!userMatch) continue;

      const entryChatStripped = entry.chatId.replace(/^-100/, '').replace(/^-/, '').replace(/^@+/, '').toLowerCase();
      const chatMatch =
        candidateChats.includes(entry.chatId) ||
        strippedCandidates.includes(entryChatStripped) ||
        (entry.chatUsername && (strippedCandidates.includes(entry.chatUsername) || (cleanChanUname && entry.chatUsername === cleanChanUname)));
      if (chatMatch) {
        if (maxAgeMs && now - entry.createdAt > maxAgeMs) {
          map.delete(key);
          continue;
        }
        return true;
      }
    }
    return false;
  }

  // Handle incoming ChatJoinRequest for private channels/groups (auto-approval & seamless verification)
  public static async handleChatJoinRequest(cjr: any): Promise<void> {
    if (!cjr || !cjr.chat || !cjr.from) return;

    const chat = cjr.chat;
    const from = cjr.from;
    const chatId = String(chat.id || '');
    const chatUsername = chat.username ? `@${String(chat.username).replace(/^@+/, '')}` : undefined;
    const chatTitle = chat.title || 'Private Channel/Group';
    const userId = String(from.id || cjr.user_chat_id || '');
    const userName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.first_name || 'User';
    const userUsername = from.username ? `@${from.username.replace(/^@+/, '')}` : undefined;
    const inviteLink = cjr.invite_link?.invite_link;
    const botScopeId = String((storage as any)?.botId || 'main').trim() || 'main';

    console.info(`[ForceSub] Received ChatJoinRequest from user ${userId} (${userName} / ${userUsername || 'no_user'}) for chat "${chatTitle}" (${chatId})`);

    // 1. Immediately cache in memory for 0ms instant Request Only verification
    this.recordCachedPendingJoinRequest(botScopeId, {
      chatId,
      chatUsername,
      userId,
      userUsername
    });
    this.invalidateForceSubCache(userId);

    // 2. Immediately persist the join request in storage before slow network calls
    try {
      await storage.recordJoinRequest({
        chatId,
        chatUsername,
        chatTitle,
        userId,
        userName,
        userUsername,
        status: 'pending',
        inviteLink
      });
    } catch (err: any) {
      console.warn('[ForceSub] Error recording join request:', err?.message);
    }

    // 3. Track user in bot database
    try {
      await storage.trackBotUser({
        id: userId,
        username: userUsername,
        firstName: from.first_name,
        lastName: from.last_name
      });
    } catch {}

    // 4. Auto-detect & register this channel if not already present in requiredChannels
    try {
      const curSettings = await storage.getSettings();
      const alreadyRegistered = (curSettings.requiredChannels || []).some(
        c => String(c.chatId || '').trim() === chatId || (chatUsername && String(c.username || '').toLowerCase() === chatUsername.toLowerCase())
      );
      if (!alreadyRegistered) {
        await this.registerDetectedChat(chat);
      }
    } catch (err: any) {
      console.warn('[ForceSub] Error checking/registering detected chat from join request:', err?.message);
    }

    // 5. Auto-Approve Join Request ONLY in Auto Join mode when autoApproveJoinRequests !== false
    // In Request Only mode, keep the join request in the pending list so the Verify button checks pending requests directly.
    const settings = await storage.getSettings();
    const forceJoinMode = settings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join';
    const shouldAutoApprove = forceJoinMode !== 'request_only' && settings.autoApproveJoinRequests !== false;

    if (shouldAutoApprove) {
      try {
        console.info(`[ForceSub] Auto-approving join request for user ${userId} in chat ${chatId}...`);
        const approveRes = await this.callTelegramApi('approveChatJoinRequest', {
          chat_id: chat.id,
          user_id: from.id
        });

        const isSuccess = approveRes && (
          approveRes.ok || 
          approveRes.description?.includes('USER_ALREADY_PARTICIPANT') ||
          approveRes.description?.includes('ALREADY_PARTICIPANT') ||
          approveRes.description?.includes('HIDE_REQUESTER_MISSING')
        );

        if (isSuccess) {
          console.info(`[ForceSub] ✅ Join request approved successfully for user ${userId} in "${chatTitle}"`);
          await storage.updateJoinRequestStatus(chatId, userId, 'approved');

          // Send an instant confirmation DM to user if possible
          try {
            const noticeRes = await this.callTelegramApi('sendMessage', {
              chat_id: from.id,
              text: `✅ <b>Join Request Approved!</b>\n\nYour request to join <b>${this.escapeHtml(chatTitle)}</b> has been automatically approved!\n\n👇 You can now return to the bot and tap <b>Verify / Try Again</b> to unlock your requested files immediately.`,
              parse_mode: 'HTML'
            });
            if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
              await storage.recordChatDeliveryMessage(from.id, noticeRes.result.message_id);
            }
          } catch {}
        } else {
          console.warn(`[ForceSub] Telegram approveChatJoinRequest response for user ${userId}:`, approveRes?.description || approveRes);
          // If approval couldn't immediately complete (e.g. rights), keep pending so user still passes force sub
          await storage.updateJoinRequestStatus(chatId, userId, 'pending');
        }
      } catch (approveErr: any) {
        console.error(`[ForceSub] Exception while approving join request for user ${userId}:`, approveErr?.message || approveErr);
      }
    }
  }

  // Actively sync and auto-detect all channels and groups where the bot is currently an administrator
  public static async syncAdminChannels(): Promise<ForceSubChannel[]> {
    await storage.loadLatest(false);
    const settings = await storage.getSettings();
    const existing = Array.isArray(settings.requiredChannels) ? [...settings.requiredChannels] : [];
    const detected = await storage.getDetectedChannels();

    const candidates = new Map<string, Partial<ForceSubChannel>>();
    for (const ch of [...existing, ...detected]) {
      if (ch.chatId) candidates.set(String(ch.chatId), ch);
    }

    const me = await this.callTelegramApi('getMe', {});
    const botId = me.result?.id;

    const syncedList: ForceSubChannel[] = [];

    for (const [rawChatId, info] of candidates.entries()) {
      let targetChat: string | number = rawChatId;
      if (/^-?\d+$/.test(rawChatId)) {
        targetChat = Number(rawChatId);
      } else if (!rawChatId.startsWith('@') && !rawChatId.startsWith('-')) {
        targetChat = '@' + rawChatId;
      }

      try {
        const chatRes = await this.callTelegramApi('getChat', { chat_id: targetChat });
        if (chatRes && chatRes.ok && chatRes.result) {
          const chat = chatRes.result;
          let isAdmin = false;

          if (botId) {
            try {
              const memberRes = await this.callTelegramApi('getChatMember', {
                chat_id: targetChat,
                user_id: botId
              });
              if (memberRes && memberRes.ok && memberRes.result) {
                const st = memberRes.result.status;
                isAdmin = st === 'administrator' || st === 'creator';
              }
            } catch {}
          }

          let inviteLink = chat.invite_link || info.inviteLink || '';
          const username = chat.username ? `@${chat.username.replace(/^@/, '')}` : (info.username || undefined);
          if (!inviteLink && username) {
            inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
          }

          if (!inviteLink && isAdmin) {
            try {
              const renewed = await this.generateOrRenewInviteLink(targetChat, chat.title);
              if (renewed) {
                inviteLink = renewed;
              }
            } catch {}
          }

          const reg = await storage.registerDetectedChannel({
            id: info.id,
            chatId: String(chat.id),
            name: chat.title || info.name || 'Telegram Channel',
            inviteLink,
            username,
            type: chat.type as any,
            isAdmin,
            enabled: info.enabled !== undefined ? info.enabled : true
          });
          syncedList.push(reg);
        }
      } catch (err: any) {
        console.warn(`[SyncChannels] Chat ${rawChatId} check failed:`, err?.message);
        if (info.name && info.chatId) {
          syncedList.push({
            id: info.id || `ch_${Date.now()}`,
            name: info.name,
            chatId: info.chatId,
            inviteLink: info.inviteLink || '',
            enabled: info.enabled !== false,
            type: info.type || 'channel',
            username: info.username,
            isAdmin: info.isAdmin
          });
        }
      }
    }

    const updatedSettings = await storage.getSettings();
    return updatedSettings.requiredChannels || syncedList;
  }

  // Auto-generate or renew fresh invite links using Telegram API createChatInviteLink
  public static async generateOrRenewInviteLink(
    chatId: string | number,
    channelName?: string,
    options?: { createsJoinRequest?: boolean }
  ): Promise<string | null> {
    const rawChat = String(chatId).trim();
    if (!rawChat) return null;
    const targetChat = /^-?\d+$/.test(rawChat) ? Number(rawChat) : (rawChat.startsWith('@') ? rawChat : `@${rawChat}`);

    let createsJoinRequest = options?.createsJoinRequest;
    if (createsJoinRequest === undefined) {
      const settings = await storage.getSettings();
      createsJoinRequest = settings.forceJoinMode === 'request_only';
    }

    try {
      const createRes = await this.callTelegramApi('createChatInviteLink', {
        chat_id: targetChat,
        name: `${createsJoinRequest ? 'Request' : 'ForceSub'} - ${(channelName || 'AutoRenew').slice(0, 20)}`,
        creates_join_request: Boolean(createsJoinRequest)
      });
      if (createRes && createRes.ok && createRes.result?.invite_link) {
        const newLink = createRes.result.invite_link;
        await storage.updateChannelInviteLink(rawChat, newLink, Boolean(createsJoinRequest));
        return newLink;
      }
    } catch (err: any) {
      console.warn(`[Telegram] createChatInviteLink failed for ${rawChat}:`, err?.message || err);
    }

    if (!createsJoinRequest) {
      try {
        const expRes = await this.callTelegramApi('exportChatInviteLink', { chat_id: targetChat });
        if (expRes && expRes.ok && expRes.result) {
          const newLink = expRes.result;
          await storage.updateChannelInviteLink(rawChat, newLink, false);
          return newLink;
        }
      } catch (expErr: any) {
        console.warn(`[Telegram] exportChatInviteLink failed for ${rawChat}:`, expErr?.message || expErr);
      }
    }

    return null;
  }

  // Forward-based Private Channel / Group Setup handler
  public static async handleForwardedChannelSetup(
    fromId: string,
    replyChatId: string | number,
    forwardChat: any
  ): Promise<void> {
    const rawChatId = String(forwardChat.id);
    const chatTitle = forwardChat.title || forwardChat.username || 'Private Channel';
    const chatType = forwardChat.type || (rawChatId.startsWith('-100') ? 'channel' : 'group');
    const username = forwardChat.username ? `@${forwardChat.username.replace(/^@/, '')}` : undefined;

    // Send processing status
    const statusMsg = await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `🔄 <b>Detected forwarded post from:</b> <i>${this.escapeHtml(chatTitle)}</i>\n` +
            `Connecting private channel and generating fresh invite link...`,
      parse_mode: 'HTML'
    });

    // Generate or renew invite link using createChatInviteLink
    let inviteLink = await this.generateOrRenewInviteLink(rawChatId, chatTitle);
    if (!inviteLink && username) {
      inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
    }

    // Check bot administrator status in the channel
    let isAdminInChat = false;
    try {
      const me = await this.callTelegramApi('getMe', {});
      const botId = me.result?.id;
      if (botId) {
        const memRes = await this.callTelegramApi('getChatMember', {
          chat_id: /^-?\d+$/.test(rawChatId) ? Number(rawChatId) : rawChatId,
          user_id: botId
        });
        if (memRes && memRes.ok && memRes.result) {
          const st = memRes.result.status;
          isAdminInChat = st === 'administrator' || st === 'creator';
        }
      }
    } catch {}

    // Register channel into storage (both detectedChannels and settings.requiredChannels)
    const channelRecord = await storage.registerDetectedChannel({
      chatId: rawChatId,
      name: chatTitle,
      inviteLink: inviteLink || '',
      username,
      type: chatType as any,
      isAdmin: isAdminInChat,
      enabled: true
    });

    // Ensure forceSubEnabled is turned on
    await storage.updateSettings({ forceSubEnabled: true });

    const responseText = 
      `✅ <b>Private Channel Connected via Forward</b>\n\n` +
      `• 📢 <b>Channel Name:</b> <code>${this.escapeHtml(channelRecord.name)}</code>\n` +
      `• 🆔 <b>Chat ID:</b> <code>${this.escapeHtml(channelRecord.chatId)}</code>\n` +
      `• 🏷️ <b>Type:</b> <code>${this.escapeHtml(channelRecord.type || 'channel')}</code>\n` +
      (channelRecord.inviteLink ? `• 🔗 <b>Invite Link:</b> <code>${this.escapeHtml(channelRecord.inviteLink)}</code>\n` : '') +
      (isAdminInChat
        ? `• 👑 <b>Bot Status:</b> <code>Administrator (Active &amp; Verified)</code> ✅\n`
        : `\n⚠️ <b>Important Note:</b> Please add this bot as an <b>Administrator</b> in this channel with invite permissions so force-subscription checks and auto-approvals succeed.\n`
      ) +
      `\n✨ <i>Added to Force Sub channels with toggle ON. Manage anytime in the Admin Panel or run <code>/disconnect ${this.escapeHtml(channelRecord.chatId)}</code>.</i>`;

    if (statusMsg?.result?.message_id) {
      try {
        await this.callTelegramApi('editMessageText', {
          chat_id: replyChatId,
          message_id: statusMsg.result.message_id,
          text: responseText,
          parse_mode: 'HTML'
        });
        return;
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: responseText,
      parse_mode: 'HTML'
    });
  }

  // Admin /connect Command: Connect channel/group by ID or Username
  public static async handleConnectCommand(
    fromId: string,
    replyChatId: string | number,
    text: string,
    fallbackChatId?: string | number
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to use admin commands.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    const match = text.match(/^\/(?:connect|addchannel|setchannel)(?:@\w+)?(?:\s+(.+))?$/i);
    const rawTarget = match?.[1]?.trim() || (fallbackChatId ? String(fallbackChatId) : '');
    if (!rawTarget) {
      activeSetChannelSessions.set(fromId, { timestamp: Date.now() });
      const botName = await this.getBotUsername();
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: `📢 <b>Connect Private Channel / Group</b>\n\n` +
              `• <b>Please now forward any post or message from your private channel directly here!</b>\n` +
              `• <i>(Ensure @${botName || 'this bot'} is added as an <b>Administrator</b> in that channel first!)</i>\n` +
              `• The bot will automatically detect the chat ID, title, and create a fresh invite link for force-subscription.\n\n` +
              `💡 <i>Or connect by channel ID/username directly: <code>/setchannel -1001234567890</code> or <code>/setchannel @mychannel</code></i>\n\n` +
              `Type <code>/cancel</code> to abort.`,
        parse_mode: 'HTML'
      });
      return;
    }

    activeSetChannelSessions.delete(fromId);

    let target = rawTarget;
    let inviteLink = '';
    if (target.startsWith('https://t.me/')) {
      if (target.includes('/+')) {
        inviteLink = target;
      } else {
        target = '@' + target.replace('https://t.me/', '').replace(/\/.*$/, '');
      }
    } else if (target.startsWith('t.me/')) {
      if (target.includes('/+')) {
        inviteLink = 'https://' + target;
      } else {
        target = '@' + target.replace('t.me/', '').replace(/\/.*$/, '');
      }
    } else if (!target.startsWith('@') && !target.startsWith('-') && !/^\d+$/.test(target)) {
      target = '@' + target;
    }

    const queryChat = /^-?\d+$/.test(target) ? Number(target) : target;

    let chatTitle = String(rawTarget);
    let chatType: 'channel' | 'supergroup' | 'group' = String(target).startsWith('-100') ? 'supergroup' : 'channel';
    let username = target.startsWith('@') ? target : undefined;
    let resolvedChatId = String(target);

    try {
      const chatRes = await this.callTelegramApi('getChat', { chat_id: queryChat });
      if (chatRes && chatRes.ok && chatRes.result) {
        const c = chatRes.result;
        chatTitle = c.title || c.username || chatTitle;
        chatType = c.type || chatType;
        if (c.username) username = `@${c.username.replace(/^@/, '')}`;
        resolvedChatId = String(c.id);
        if (c.invite_link) inviteLink = c.invite_link;
        if (!inviteLink && username) {
          inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
        }
      }
    } catch (err: any) {
      console.warn('[Telegram] /connect getChat error:', err?.message);
    }

    // If still no invite link, try auto-generating or exporting
    if (!inviteLink) {
      try {
        const fresh = await this.generateOrRenewInviteLink(resolvedChatId, chatTitle);
        if (fresh) {
          inviteLink = fresh;
        }
      } catch {}
    }
    if (!inviteLink && username) {
      inviteLink = `https://t.me/${username.replace(/^@/, '')}`;
    }

    // Register channel into storage (both detectedChannels and settings.requiredChannels)
    const channelRecord = await storage.registerDetectedChannel({
      chatId: resolvedChatId,
      name: chatTitle,
      inviteLink,
      username,
      type: chatType,
      isAdmin: true,
      enabled: true
    });

    // Ensure forceSubEnabled is turned on
    await storage.updateSettings({ forceSubEnabled: true });

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `✅ <b>Channel Connected!</b>\n\n` +
            `• 📢 <b>Name:</b> <code>${this.escapeHtml(channelRecord.name)}</code>\n` +
            `• 🆔 <b>Chat ID:</b> <code>${this.escapeHtml(channelRecord.chatId)}</code>\n` +
            `• 🏷️ <b>Type:</b> <code>${this.escapeHtml(channelRecord.type || 'channel')}</code>\n` +
            (channelRecord.inviteLink ? `• 🔗 <b>Invite Link:</b> <code>${this.escapeHtml(channelRecord.inviteLink)}</code>\n` : '') +
            `\n✨ <i>Added to Force Sub channels with toggle ON. Manage anytime in the Admin Panel or run <code>/disconnect ${this.escapeHtml(channelRecord.chatId)}</code>.</i>`,
      parse_mode: 'HTML'
    });
  }

  // Admin /disconnect Command: Disconnect channel/group by ID or Username
  public static async handleDisconnectCommand(
    fromId: string,
    replyChatId: string | number,
    text: string,
    fallbackChatId?: string | number
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to use admin commands.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    const match = text.match(/^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+(.+))?$/i);
    const rawTarget = match?.[1]?.trim() || (fallbackChatId ? String(fallbackChatId) : '');
    if (!rawTarget) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: `ℹ️ <b>Disconnect Channel / Group</b>\n\nUsage: <code>/disconnect &lt;channel_id_or_username&gt;</code>\n\nExample: <code>/disconnect @mychannel</code> or <code>/disconnect -1001234567890</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    const cleanTarget = rawTarget.replace(/^https:\/\/t\.me\//, '@').replace(/^t\.me\//, '@');
    await storage.removeForceSubChannel(cleanTarget);

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text: `🗑️ <b>Channel Disconnected!</b>\n\nThe channel/group <code>${this.escapeHtml(cleanTarget)}</code> has been removed from Force Sub.`,
      parse_mode: 'HTML'
    });
  }

  // Restores banned user access across all connected channels and groups in Telegram
  public static async unbanUserInConnectedChats(userId: string | number): Promise<void> {
    try {
      const cleanTarget = String(userId).trim().replace(/^@+/, '');
      let targetNumericId = Number(cleanTarget);

      // If userId was a username, resolve their numeric Telegram ID from storage
      if (isNaN(targetNumericId) || !targetNumericId) {
        const found = await storage.findUserByIdOrUsername(cleanTarget);
        if (found && found.id && !isNaN(Number(found.id))) {
          targetNumericId = Number(found.id);
        }
      }

      if (!targetNumericId) return;

      const settings = await storage.getSettings();
      const detected = await storage.getDetectedChannels();
      const candidateChats = new Set<string | number>();

      for (const ch of [...(settings.requiredChannels || []), ...detected]) {
        if (ch.chatId) candidateChats.add(ch.chatId);
      }

      for (const chat of candidateChats) {
        try {
          const targetChat = /^-?\d+$/.test(String(chat)) ? Number(chat) : String(chat);
          await this.callTelegramApi('unbanChatMember', {
            chat_id: targetChat,
            user_id: targetNumericId,
            only_if_banned: true
          });
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[Telegram] unbanUserInConnectedChats error for ${userId}:`, err?.message || err);
    }
  }

  public static async checkUserForceSub(
    userId: string | number,
    username?: string,
    options?: { forceFresh?: boolean; allowCache?: boolean }
  ): Promise<{ allJoined: boolean; unjoinedChannels: ForceSubChannel[]; mode?: 'auto_join' | 'request_only' }> {
    try {
      const settings = await storage.getSettings();
      const forceJoinMode: 'auto_join' | 'request_only' =
        settings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join';

      if (!settings.forceSubEnabled || !settings.requiredChannels || settings.requiredChannels.length === 0) {
        return { allJoined: true, unjoinedChannels: [], mode: forceJoinMode };
      }

      const activeChannels = settings.requiredChannels.filter(c => c.enabled !== false);
      if (activeChannels.length === 0) {
        return { allJoined: true, unjoinedChannels: [], mode: forceJoinMode };
      }

      const cleanUserId = String(userId).trim();
      if (!cleanUserId) return { allJoined: true, unjoinedChannels: [], mode: forceJoinMode };

      const botScopeId = (storage as any)?.botId || 'main';
      const cacheKey = `${botScopeId}_${forceJoinMode}_${cleanUserId}`;
      if (options?.allowCache && !options?.forceFresh) {
        const cached = this.forceSubCache.get(cacheKey);
        if (cached && cached.allJoined && Date.now() < cached.expiresAt) {
          return { allJoined: true, unjoinedChannels: [], mode: forceJoinMode };
        }
      }

      let effectiveUsername = String(username || '').replace(/^@+/, '').toLowerCase().trim();
      if (!effectiveUsername) {
        try {
          const trackedUser = await storage.getUser(cleanUserId);
          if (trackedUser?.username) {
            effectiveUsername = String(trackedUser.username).replace(/^@+/, '').toLowerCase().trim();
          }
        } catch {}
      }

      // Exempt authorized administrators from force sub verification
      const isAdmin = await this.isAuthorizedAdmin(cleanUserId, effectiveUsername);
      if (isAdmin) {
        return { allJoined: true, unjoinedChannels: [], mode: forceJoinMode };
      }

      const numericUserId = Number(cleanUserId) || cleanUserId;

      // Parallelize live channel membership / pending join-request verification (never rely solely on stale cache)
      const checks = await Promise.all(activeChannels.map(async (channel) => {
        let rawChatId = (channel.chatId || '').trim();
        if (!rawChatId) return null;

        if (rawChatId.startsWith('https://t.me/')) {
          rawChatId = '@' + rawChatId.replace('https://t.me/', '').replace(/\/.*$/, '').replace(/^\+/, '');
        } else if (rawChatId.startsWith('t.me/')) {
          rawChatId = '@' + rawChatId.replace('t.me/', '').replace(/\/.*$/, '').replace(/^\+/, '');
        } else if (!rawChatId.startsWith('@') && !rawChatId.startsWith('-') && !/^\d+$/.test(rawChatId)) {
          rawChatId = '@' + rawChatId;
        }

        const targetChat = /^-?\d+$/.test(rawChatId) ? Number(rawChatId) : rawChatId;
        let isMember = false;
        let memberStatus = '';

        // 1. Live channel membership query via Telegram getChatMember
        try {
          const res = await this.callTelegramApi('getChatMember', {
            chat_id: targetChat,
            user_id: numericUserId
          });
          if (res && res.ok && res.result) {
            memberStatus = String(res.result.status || '').trim();
            isMember =
              memberStatus === 'creator' ||
              memberStatus === 'administrator' ||
              memberStatus === 'member' ||
              (memberStatus === 'restricted' && res.result.is_member !== false);
          }
        } catch (err: any) {
          console.warn(`[ForceSub] Error querying getChatMember for ${cleanUserId} in ${targetChat}:`, err?.message);
        }

        // If user is banned/removed ('kicked'), purge all cached/stored verification immediately and fail
        if (memberStatus === 'kicked') {
          this.clearCachedPendingJoinRequest(String(botScopeId), channel, cleanUserId, effectiveUsername, String(targetChat));
          await storage.invalidateJoinRequest(
            String(targetChat),
            cleanUserId,
            channel.id,
            channel.username || (typeof targetChat === 'string' && targetChat.startsWith('@') ? targetChat : undefined),
            effectiveUsername
          ).catch(() => false);
          return channel;
        }

        // 2. Live fallback handling when user is not currently a channel member
        if (!isMember) {
          let resolvedChatId = String(targetChat);
          let resolvedUsername = channel.username;
          if (typeof targetChat === 'string' && targetChat.startsWith('@')) {
            try {
              const chatInfo = await this.callTelegramApi('getChat', { chat_id: targetChat });
              if (chatInfo?.ok && chatInfo.result?.id) {
                resolvedChatId = String(chatInfo.result.id);
              }
              if (chatInfo?.ok && chatInfo.result?.username && !resolvedUsername) {
                resolvedUsername = `@${String(chatInfo.result.username).replace(/^@+/, '')}`;
              }
            } catch {}
          }

          if (forceJoinMode === 'request_only') {
            const chanUsername = resolvedUsername || (typeof targetChat === 'string' && targetChat.startsWith('@') ? targetChat : undefined);
            const storedRecord = await storage.findJoinRequestRecord(
              resolvedChatId || String(targetChat),
              cleanUserId,
              channel.id,
              chanUsername,
              effectiveUsername
            );

            if (storedRecord) {
              if (storedRecord.status === 'pending') {
                isMember = true;
              } else {
                // If status was 'approved' but live getChatMember said 'left', they left the channel after approval!
                // If status was 'rejected', their request was dismissed/declined!
                this.clearCachedPendingJoinRequest(String(botScopeId), channel, cleanUserId, effectiveUsername, resolvedChatId);
                await storage.invalidateJoinRequest(
                  resolvedChatId || String(targetChat),
                  cleanUserId,
                  channel.id,
                  chanUsername,
                  effectiveUsername
                ).catch(() => false);
                isMember = false;
              }
            } else {
              // No record in persistent storage: only accept an immediate in-flight chat_join_request within 10s while DB persists
              const hasFreshInFlight = this.hasCachedPendingJoinRequest(
                String(botScopeId),
                channel,
                cleanUserId,
                effectiveUsername,
                resolvedChatId,
                10000
              );
              isMember = hasFreshInFlight;
            }
          } else if (forceJoinMode === 'auto_join') {
            // Live getChatMember confirmed user is NOT a member (e.g. 'left')
            // Only approve if an active pending join request exists right now and Telegram approves it live
            if (settings.autoApproveJoinRequests !== false) {
              try {
                const approveRes = await this.callTelegramApi('approveChatJoinRequest', {
                  chat_id: targetChat,
                  user_id: numericUserId
                });
                if (approveRes && approveRes.ok) {
                  isMember = true;
                  storage.recordJoinRequest({
                    chatId: resolvedChatId || String(targetChat),
                    chatUsername: resolvedUsername,
                    chatTitle: channel.name,
                    userId: cleanUserId,
                    userUsername: effectiveUsername || undefined,
                    status: 'approved'
                  }).catch(() => {});
                }
              } catch {}
            }

            if (!isMember) {
              // Invalidate any stale approved/pending record since live getChatMember confirmed they are not in the channel
              this.clearCachedPendingJoinRequest(String(botScopeId), channel, cleanUserId, effectiveUsername, resolvedChatId);
              await storage.invalidateJoinRequest(
                resolvedChatId || String(targetChat),
                cleanUserId,
                channel.id,
                resolvedUsername || (typeof targetChat === 'string' && targetChat.startsWith('@') ? targetChat : undefined),
                effectiveUsername
              ).catch(() => false);
            }
          }
        }

        return isMember ? null : channel;
      }));

      const unjoined = checks.filter((c): c is ForceSubChannel => c !== null);
      const result = {
        allJoined: unjoined.length === 0,
        unjoinedChannels: unjoined,
        mode: forceJoinMode
      };

      if (result.allJoined) {
        this.forceSubCache.set(cacheKey, { ...result, expiresAt: Date.now() + 15000 });
      } else {
        this.invalidateForceSubCache(cleanUserId);
      }
      return result;
    } catch (err: any) {
      console.error('[ForceSub] Unexpected error in checkUserForceSub:', err);
      return { allJoined: true, unjoinedChannels: [], mode: 'auto_join' };
    }
  }

  public static async sendForceSubPrompt(
    chatId: string | number,
    unjoinedChannels: ForceSubChannel[],
    targetPayload: string = 'start',
    messageIdToEdit?: number,
    userInfo?: { id?: string | number; firstName?: string; first_name?: string; lastName?: string; last_name?: string; username?: string; [key: string]: any }
  ): Promise<void> {
    const settings = await storage.getSettings();
    const isRequestOnly = settings.forceJoinMode === 'request_only';
    const keyboardRows: any[][] = [];

    // Channel Join / Request Buttons: Grid layout with 2 buttons per row
    const channelButtons: any[] = [];
    for (let i = 0; i < unjoinedChannels.length; i++) {
      const ch = unjoinedChannels[i];
      let channelUrl = '';

      if (isRequestOnly) {
        channelUrl = ch.requestInviteLink ? ch.requestInviteLink.trim() : '';
        if (!channelUrl && ch.chatId) {
          try {
            const reqLink = await this.generateOrRenewInviteLink(ch.chatId, ch.name, { createsJoinRequest: true });
            if (reqLink) {
              channelUrl = reqLink;
              ch.requestInviteLink = reqLink;
            }
          } catch {}
        }
        if (!channelUrl && ch.inviteLink) {
          channelUrl = ch.inviteLink.trim();
        }
      } else {
        channelUrl = ch.inviteLink ? ch.inviteLink.trim() : '';
        // Auto-renew missing or expired invite link via Telegram API createChatInviteLink
        if (!channelUrl && ch.chatId) {
          try {
            const freshLink = await this.generateOrRenewInviteLink(ch.chatId, ch.name, { createsJoinRequest: false });
            if (freshLink) {
              channelUrl = freshLink;
              ch.inviteLink = freshLink;
            }
          } catch {}
        }
      }

      if (!channelUrl) {
        if (ch.chatId && ch.chatId.startsWith('@')) {
          channelUrl = `https://t.me/${ch.chatId.slice(1)}`;
        } else {
          channelUrl = 'https://t.me';
        }
      }
      channelButtons.push({
        text: `Join Channel ${i + 1}`,
        url: channelUrl,
        style: 'primary'
      });
    }

    // Chunk channel buttons into pairs of 2 per row
    for (let i = 0; i < channelButtons.length; i += 2) {
      keyboardRows.push(channelButtons.slice(i, i + 2));
    }

    // "Verify / Try Again" callback button: Full width prominent button
    keyboardRows.push([
      {
        text: '🔄 Verify / Try Again ✅',
        callback_data: `forcesub_verify:${targetPayload || 'start'}`,
        style: 'success'
      }
    ]);

    // Dynamic unjoined channels enumeration for {channel_list} placeholder
    const channelNames = unjoinedChannels
      .map((c, i) => `  🔹 <b>Channel ${i + 1}:</b> <code>${this.escapeHtml(c.name)}</code>`)
      .join('\n');

    // Load Editable Message Template from storage (Requirement 2)
    const templates = await storage.getTemplates();
    const template = templates['FORCESUB_PROMPT'];
    const botName = await this.getBotUsername();

    const legacyAutoJoinPrompt =
      `🔒 <b>Channel Membership Required</b>\n\n` +
      `To use this bot and access your requested content, please subscribe to our official channel(s) below:\n\n` +
      `{channel_list}\n\n` +
      `👇 <i>Tap the button(s) above to join, then press <b>Verify / Try Again</b> below.</i>`;

    const defaultAutoJoinPrompt =
      `🔒 <b>Channel Membership Required</b>\n\n` +
      `To use <code>{bot_name}</code> and access your requested content, please join our official channel(s) below:\n\n` +
      `{channel_list}\n\n` +
      `👇 <i>Tap the channel buttons below to join, then press <b>Verify / Try Again</b>.</i>`;

    const defaultRequestOnlyPrompt =
      `🔒 <b>Join Request Required</b>\n\n` +
      `To use <code>{bot_name}</code> and access your requested content, please send a join request to our official channel(s) below first:\n\n` +
      `{channel_list}\n\n` +
      `👇 <i>Tap the channel buttons below to send your join request, then press <b>Verify / Try Again</b>.</i>`;

    const trimmedTemplate = template?.content?.trim() || '';
    const isUsingDefaultTemplate =
      !trimmedTemplate ||
      trimmedTemplate === defaultAutoJoinPrompt.trim() ||
      trimmedTemplate === legacyAutoJoinPrompt.trim();
    let promptText = isUsingDefaultTemplate
      ? (isRequestOnly ? defaultRequestOnlyPrompt : defaultAutoJoinPrompt)
      : trimmedTemplate;

    let userMention = '';
    let userDisplayName = '';
    const userId = String(userInfo?.id || chatId);

    const rawFirstName = userInfo?.first_name || userInfo?.firstName;
    const rawLastName = userInfo?.last_name || userInfo?.lastName;
    const rawUsername = userInfo?.username;

    if (rawUsername) {
      userMention = `@${String(rawUsername).replace(/^@+/, '').trim()}`;
    }
    if (rawFirstName) {
      userDisplayName = [rawFirstName, rawLastName].filter(Boolean).join(' ').trim();
    }

    if (!userMention || !userDisplayName) {
      try {
        const storedUser = await storage.getUser(userId);
        if (storedUser) {
          if (!userMention && storedUser.username) {
            userMention = `@${storedUser.username.replace(/^@+/, '').trim()}`;
          }
          if (!userDisplayName && storedUser.firstName) {
            userDisplayName = [storedUser.firstName, storedUser.lastName].filter(Boolean).join(' ').trim();
          }
        }
      } catch {}
    }

    // Dynamic real name: prioritize user's actual real name (e.g. "Sohan"), then username, then ID
    const realUserName = userDisplayName || userMention || 'User';
    const safeUserName = this.escapeHtml(realUserName);
    const safeUserMention = this.escapeHtml(userMention || realUserName);
    const safeUserId = this.escapeHtml(userId);
    const safeBotMention = this.escapeHtml(`@${botName.replace(/^@/, '')}`);

    promptText = promptText
      .replace(/\{channel_list\}/gi, channelNames)
      .replace(/\{user_name\}|\{@?username\}|\{name\}|\{user\}|\{first_name\}/gi, safeUserName)
      .replace(/\{user_id\}|\{userid\}|\{id\}/gi, safeUserId)
      .replace(/\{bot_name\}|\{botname\}|\{bot\}/gi, safeBotMention)
      .replace(/(^|\s)@username\b/gi, `$1${safeUserMention}`)
      .replace(/Hey Friend/gi, `Hey ${safeUserName}`)
      .replace(/\bFriend\b/gi, safeUserName);

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text: promptText,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboardRows }
        });
        if (editRes && editRes.ok) return;
        // If Telegram returns "message is not modified", the content is already up-to-date.
        // We MUST NOT send a new message, which would clutter and spam the user's chat!
        return;
      } catch {
        return;
      }
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: promptText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  }

  // =========================================================================
  // OFFICIAL SOURCE & BROADCAST WHITELIST VERIFIER
  // Whitelist channel posts, automatic forwards from linked channels,
  // connected official force-sub channels, and group administrators.
  // =========================================================================
  private static async isOfficialOrAdminMessage(message: any, fromId: string): Promise<boolean> {
    // 1. Automatic forwards from linked official channel into group (Telegram official flag)
    if (message.is_automatic_forward === true) {
      return true;
    }

    // 2. Telegram internal system bots / channel accounts
    const senderUserId = String(message.from?.id || '');
    if (senderUserId === '777000' || senderUserId === '1087968824' || senderUserId === '136817688') {
      return true;
    }

    // 3. Sender is a channel or anonymous admin
    if (message.sender_chat) {
      // If posted as the group itself (anonymous admin)
      if (message.chat?.id && String(message.sender_chat.id) === String(message.chat.id)) {
        return true;
      }
      // If sender_chat is any channel post sent to group
      if (message.sender_chat.type === 'channel') {
        return true;
      }
    }

    // 4. Check connected official channels in database
    const settings = await storage.getSettings();
    const detectedChannels = await storage.getDetectedChannels();
    const connectedIds = new Set<string>();
    const connectedUsernames = new Set<string>();

    if (Array.isArray(settings.requiredChannels)) {
      for (const ch of settings.requiredChannels) {
        if (ch.chatId) connectedIds.add(String(ch.chatId).trim());
        if (ch.id) connectedIds.add(String(ch.id).trim());
        if (ch.username) connectedUsernames.add(ch.username.replace(/^@+/, '').toLowerCase().trim());
      }
    }
    if (Array.isArray(detectedChannels)) {
      for (const ch of detectedChannels) {
        if (ch.chatId) connectedIds.add(String(ch.chatId).trim());
        if (ch.id) connectedIds.add(String(ch.id).trim());
        if (ch.username) connectedUsernames.add(ch.username.replace(/^@+/, '').toLowerCase().trim());
      }
    }

    // Check if sender_chat matches connected official channels
    if (message.sender_chat) {
      const senderId = String(message.sender_chat.id);
      const senderUser = message.sender_chat.username ? message.sender_chat.username.replace(/^@+/, '').toLowerCase() : '';
      if (connectedIds.has(senderId) || (senderUser && connectedUsernames.has(senderUser))) {
        return true;
      }
    }

    // Check if forward source is an official connected channel
    const fwdChat = message.forward_from_chat || message.forward_origin?.chat;
    if (fwdChat) {
      const fwdId = String(fwdChat.id);
      const fwdUser = fwdChat.username ? fwdChat.username.replace(/^@+/, '').toLowerCase() : '';
      if (connectedIds.has(fwdId) || (fwdUser && connectedUsernames.has(fwdUser))) {
        return true;
      }
    }

    // 5. Authorized administrator & Telegram group admin/creator check
    if (fromId) {
      const isSystemAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (isSystemAdmin) {
        return true;
      }
      if (message.chat?.id) {
        const isGroupAdmin = await this.isGroupAdminOrCreator(message.chat.id, fromId);
        if (isGroupAdmin) {
          return true;
        }
      }
    }

    return false;
  }

  // =========================================================================
  // GROUP MESSAGE HANDLING (EXACT TRIGGER MATCHING & STRICT GROUP PRIVACY)
  // =========================================================================
  private static async handleGroupMessage(message: any, text: string): Promise<void> {
    const fromId = String(message.from?.id || '');

    // =========================================================================
    // ADVANCED ANTI-SPAM & LINK/FORWARD PROTECTION SYSTEM
    // 1. Whitelist Channel Posts / Allow Official Broadcasts & Verified Group Admins
    // 2. Delete Unauthorized Links only when Link Delete is ON; Block Forwards only when Anti-Forward is ON
    // 3. 3-Strike Warning & Auto-Ban System
    // =========================================================================
    const isOfficial = await this.isOfficialOrAdminMessage(message, fromId);
    const groupSettings = await storage.getSettings();
    const shouldBlockLinks = Boolean(groupSettings.linkDeleteEnabled);
    const shouldBlockForwards = Boolean(groupSettings.antiForwardEnabled);

    if (!isOfficial && (shouldBlockLinks || shouldBlockForwards)) {
      const isForwarded = shouldBlockForwards && Boolean(
        message.forward_origin || 
        message.forward_from || 
        message.forward_from_chat || 
        message.forward_sender_name || 
        message.forward_date
      );

      let containsLink = false;
      if (shouldBlockLinks) {
        const hasLinkEntity = (message.entities || []).some(
          (e: any) => e.type === 'url' || e.type === 'text_link'
        ) || (message.caption_entities || []).some(
          (e: any) => e.type === 'url' || e.type === 'text_link'
        );
        const linkRegex = /(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)[^\s]+/i;
        const domainRegex = /\b[a-zA-Z0-9-]+\.(?:com|org|net|io|me|co|app|xyz|site|online|top|info|biz|ru|cn|in|de|uk|us|ca)\b/i;
        const combinedText = `${text || ''} ${message.caption || ''}`;
        containsLink = hasLinkEntity || linkRegex.test(combinedText) || domainRegex.test(combinedText);
      }

      if (isForwarded || containsLink) {
        // Instantly delete the offending message
        if (message.message_id) {
          await this.deleteUserMessage(message.chat.id, message.message_id);
        }

        if (fromId) {
          // Increment strike warning counter in storage
          const warningCount = await storage.incrementUserLinkWarning(message.chat.id, fromId);

          const userObj = message.from || {};
          const firstName = (userObj.first_name || '').trim();
          const lastName = (userObj.last_name || '').trim();
          const realName = (firstName + (lastName ? ' ' + lastName : '')).trim() || userObj.username || 'User';
          const userMention = userObj.username ? `<code>@${this.escapeHtml(userObj.username)}</code>` : `<code>${this.escapeHtml(realName)}</code>`;

          const violationType = (containsLink && isForwarded)
            ? 'links and forwarded messages'
            : containsLink
              ? 'links'
              : 'forwarded messages from external sources';

          if (warningCount === 1) {
            // 1st violation: Warning 1/3
            const warningText = `⚠️ <b>Strike [<code>1/3</code>] Warning</b> | ${userMention}\n\n` +
              `🚫 <b>Violation:</b> Sharing <code>${violationType}</code> is strictly prohibited in this group.\n` +
              `📌 <i>Your message has been deleted. You have <code>2</code> warnings remaining before an automatic ban.</i>`;
            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: warningText,
              parse_mode: 'HTML'
            });
          } else if (warningCount === 2) {
            // 2nd violation: Warning 2/3 (Final warning)
            const warningText = `⚠️ <b>Strike [<code>2/3</code>] Warning — FINAL WARNING</b> | ${userMention}\n\n` +
              `🚫 <b>Violation:</b> Sharing <code>${violationType}</code> is prohibited!\n` +
              `🚨 <b>CRITICAL:</b> You have <code>1</code> warning remaining. Your NEXT violation will result in an <b>IMMEDIATE AUTO-BAN</b>!`;
            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: warningText,
              parse_mode: 'HTML'
            });
          } else {
            // 3rd violation: Auto-ban user
            try {
              await this.callTelegramApi('banChatMember', {
                chat_id: message.chat.id,
                user_id: Number(fromId) || fromId
              });
            } catch (banErr) {
              console.warn('[Anti-Spam] banChatMember error on 3rd strike:', banErr);
            }

            await storage.setBotUserBanned(fromId, true);
            await storage.resetUserLinkWarning(message.chat.id, fromId);

            // Dynamic customizable Ban Notice template (supports {name}, {username}, {user_id}, {strikes})
            const templates = await storage.getTemplates();
            const banTemplate = templates.BAN_NOTICE?.content ||
              '🚫 <b>USER AUTO-BANNED (Strike <code>{strikes}/{strikes}</code>)</b>\n\n👤 <b>User:</b> <code>{name}</code> (@{username} | <b>ID:</b> <code>{user_id}</code>)\n⚠️ <b>Reason:</b> Exceeded maximum <code>{strikes}</code>-strike warnings for unauthorized links / external forward spam.';

            const cleanUsername = userObj.username ? userObj.username.replace(/^@+/, '') : '';
            const banNotice = banTemplate
              .replace(/{name}/g, TelegramService.escapeHtml(realName))
              .replace(/{user_name}/g, TelegramService.escapeHtml(realName))
              .replace(/{username}/g, cleanUsername ? TelegramService.escapeHtml(cleanUsername) : 'N/A')
              .replace(/{user_id}/g, TelegramService.escapeHtml(String(fromId)))
              .replace(/{strikes}/g, '3');

            await this.callTelegramApi('sendMessage', {
              chat_id: message.chat.id,
              text: banNotice,
              parse_mode: 'HTML'
            });
          }
        }
        return;
      }
    }

    if (!text && !message.document && !message.photo && !message.video && !message.audio) return;

    // 0. Check /allfile or /allfiles command (STRICTLY ADMIN-ONLY)
    const earlyAllFileCmd = this.parseAllFileCommand(text);
    if (earlyAllFileCmd.matched) {
      const isBotAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isBotAdmin) {
        if (!isOfficial && message.message_id) {
          await this.deleteUserMessage(message.chat.id, message.message_id);
        }
        await this.sendAutoDeletingNotice(
          message.chat.id,
          '🔒 <b>Access Restricted:</b> <i>The <code>/allfiles</code> command is restricted to authorized administrators only.</i>',
          4000
        );
        return;
      }
      await this.handleFilesListCommand(
        fromId,
        message.chat.id,
        earlyAllFileCmd.page,
        message.message_id,
        true,
        undefined,
        message.message_thread_id
      );
      return;
    }

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

    // 2. Identify Admin Commands in group (strictly restricted to authorized admins & private DM delivery)
    const isAddCommand = /^\/add(?:@\w+)?(?:\s+|$)/i.test(text);
    const isCancelCommand = /^\/cancel(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetPasswordCommand = /^\/setpassword(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetStartMsgCommand = /^\/(?:setstartmsg|startmsg)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSetStartMediaCommand = /^\/setstartmedia(?:@\w+)?(?:\s+|$)/i.test(text);
    const isClearStartMediaCommand = /^\/clearstartmedia(?:@\w+)?(?:\s+|$)/i.test(text);
    const isCleanupCommand = /^\/cleanup(?:@\w+)?(?:\s+|$)/i.test(text);
    const isAdminListCommand = /^\/(?:admins?|users?)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isConnectCommand = /^\/(?:connect|addchannel|setchannel)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isDisconnectCommand = /^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isAllowChatCommand = /^\/allowchat(?:@\w+)?(?:\s+|$)/i.test(text);
    const isIgnoreChatCommand = /^\/ignorechat(?:@\w+)?(?:\s+|$)/i.test(text);
    const isAllowedChatsCommand = /^\/(?:allowedchats|whitelistedchats)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isCloneCommand = /^\/clone(?:@\w+)?(?:\s+|$)/i.test(text);
    const isBroadcastCommand = /^\/broadcast(?:@\w+)?(?:\s+|$)/i.test(text);
    const isLinkDeleteCommand = /^\/linkdelete(?:@\w+)?(?:\s+|$)/i.test(text);
    const isSettingsCommand = /^\/(?:settings|config|setfilter|addfilter|delfilter|delfile|delete|del|editthismessage)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isBotLifecycleCommand = /^\/(?:botstart|startbot|botstop|stopbot|botrestart|restartbot|botstatus|memclean|cleanmemory|clearcache)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isGrantRevokeCommand = /^\/(?:grantadmin|promote|addadmin|revokeadmin|demote|removeadmin|deladmin)(?:@\w+)?(?:\s+|$)/i.test(text);
    const isHelpCommand = /^\/help(?:@\w+)?(?:\s+|$)/i.test(text);

    const isAdminCommand =
      isAddCommand ||
      isCancelCommand ||
      isSetPasswordCommand ||
      isSetStartMsgCommand ||
      isSetStartMediaCommand ||
      isClearStartMediaCommand ||
      isCleanupCommand ||
      isAdminListCommand ||
      isConnectCommand ||
      isDisconnectCommand ||
      isAllowChatCommand ||
      isIgnoreChatCommand ||
      isAllowedChatsCommand ||
      isCloneCommand ||
      isBroadcastCommand ||
      isLinkDeleteCommand ||
      isSettingsCommand ||
      isBotLifecycleCommand ||
      isGrantRevokeCommand ||
      isHelpCommand;

    if (isAdminCommand) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);

      // Admin Protection Rule: Never delete messages sent by verified group admins or official accounts
      if (!isOfficial && message.message_id) {
        await this.deleteUserMessage(message.chat.id, message.message_id);
      }

      // If user is NOT an authorized administrator:
      if (!isAdmin) {
        console.warn(`[Telegram] Unauthorized admin command rejected in group from: ${fromId}`);
        if (isHelpCommand) {
          await this.sendAutoDeletingNotice(
            message.chat.id,
            '🔒 <b>Access Restricted:</b> <i>The <code>/help</code> command is restricted to bot administrators only.</i>',
            4000
          );
        } else if (isCloneCommand) {
          await this.sendAutoDeletingNotice(
            message.chat.id,
            '🔒 <b>Access Restricted:</b> <i>The <code>/clone</code> command is restricted to authorized administrators only.</i>',
            4000
          );
        }
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
            `⚠️ <b>Admin Privacy Notice</b>\n<i>Please start the bot in private chat to receive admin commands.</i>`,
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

      if (isBotLifecycleCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleBotLifecycleCommand(fromId, fromId, text);
          },
          'Bot control result sent to your private messages.'
        );
        return;
      }

      if (isGrantRevokeCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleOwnerGrantRevokeCommand(fromId, fromId, text, message);
          },
          'Admin permission update sent to your private messages.'
        );
        return;
      }

      if (isHelpCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.sendAdminHelpGuide(fromId, fromId);
          },
          'Admin command guide sent to your private messages.'
        );
        return;
      }

      if (isLinkDeleteCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleLinkDeleteToggleCommand(fromId, text);
          },
          'Link Delete setting updated in your private messages.'
        );
        return;
      }

      if (isCloneCommand) {
        if (!this.isMainBotContext()) {
          await this.sendAutoDeletingNotice(
            message.chat.id,
            '⛔ <b>Command Disabled:</b> <i>The <code>/clone</code> command is disabled inside cloned bot instances and only works on the main primary bot.</i>',
            5000
          );
          return;
        }
        const groupCloneMatch = text.match(/^\/clone(?:@\w+)?(?:\s+(.+))?$/i);
        const tokenArg = groupCloneMatch?.[1]?.trim();
        await executeWithPrivateDelivery(
          async () => {
            if (!tokenArg) {
              await this.callTelegramApi('sendMessage', {
                chat_id: fromId,
                text: `ℹ️ <b>How to Clone Telegram Bot</b>\n\n1. Open <code>@BotFather</code> on Telegram and create a new bot using <code>/newbot</code>\n2. Copy the HTTP API Token\n3. Send the command here:\n<code>/clone &lt;your_bot_token&gt;</code>\n\n<i>You will then select the Bot Mode and assign the official Owner User ID or @username.</i>`,
                parse_mode: 'HTML'
              });
              return;
            }

            const check = await TelegramBotManager.validateCloneToken(tokenArg);
            if (!check.ok || !check.info) {
              const errText = check.error === 'Already this bot is already running.'
                ? '❌ <b>Already Running:</b> <i>This bot instance is already active.</i>'
                : `❌ <b>Failed to Clone Bot:</b>\n<code>${this.escapeHtml(check.error || 'Invalid token')}</code>`;
              await this.callTelegramApi('sendMessage', {
                chat_id: fromId,
                text: errText,
                parse_mode: 'HTML'
              });
              return;
            }

            const dmSession: CloneSession = {
              token: check.cleanToken!,
              botInfo: check.info,
              chatId: String(fromId),
              createdBy: fromId,
              createdAt: Date.now(),
              stage: 'awaiting_mode'
            };

            const promptRes = await this.callTelegramApi('sendMessage', {
              chat_id: fromId,
              text:
                `🤖 <b>Bot Token Verified:</b> <code>@${this.escapeHtml(check.info.username || check.info.first_name || 'Bot')}</code>\n\n` +
                `⚙️ <b>Choose Bot Mode for this clone:</b>\n\n` +
                `• 📁 <b>File Bot</b> — Standard file delivery, filters &amp; indexing mode\n` +
                `• 📝 <b>Post Bot</b> — Channel post maker, inline buttons &amp; post editing mode`,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '📁 File Bot', callback_data: `clone_mode:${fromId}:file_bot`, style: 'primary' },
                    { text: '📝 Post Bot', callback_data: `clone_mode:${fromId}:post_bot`, style: 'success' }
                  ],
                  [{ text: '❌ Cancel', callback_data: `clone_cancel:${fromId}`, style: 'danger' }]
                ]
              }
            });
            if (promptRes?.ok && promptRes.result?.message_id) {
              dmSession.promptMessageId = promptRes.result.message_id;
            }
            activeCloneSessions.set(fromId, dmSession);
          },
          'Bot cloning workflow continued in your private messages.'
        );
        return;
      }

      if (isBroadcastCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.callTelegramApi('sendMessage', {
              chat_id: fromId,
              text:
                `📢 <b>Broadcast &amp; Mass Messaging</b>\n\n` +
                `For rich media formatting, targeted delivery &amp; delivery analytics, please use the <b>Broadcast</b> tool inside the Web Admin Panel.\n\n` +
                `💡 <i>Tip: Check <code>/admins</code> for total user reach.</i>`,
              parse_mode: 'HTML'
            });
          },
          'Broadcast instructions sent to your private messages.'
        );
        return;
      }

      if (isSettingsCommand) {
        await executeWithPrivateDelivery(
          async () => {
            if (/^\/editthismessage/i.test(text)) {
              await this.callTelegramApi('sendMessage', {
                chat_id: fromId,
                text: 'ℹ️ <b>Template Editor</b>\n<i>Reply directly to a bot message in this private chat with <code>/editthismessage</code> to edit its template.</i>',
                parse_mode: 'HTML'
              });
              return;
            }
            await this.callTelegramApi('sendMessage', {
              chat_id: fromId,
              text:
                `⚙️ <b>Bot Settings &amp; Filter Configuration</b>\n\n` +
                `• Add files, links, or triggers: <code>/add</code>\n` +
                `• Manage Force Subscribe channels: <code>/connect</code> / <code>/disconnect</code>\n` +
                `• Manage Group whitelist guard: <code>/allowchat</code> / <code>/ignorechat</code>\n` +
                `• Full Settings, Design &amp; Fraud Filter controls: Open the Web Admin Panel.`,
              parse_mode: 'HTML'
            });
          },
          'Settings &amp; filter guide sent to your private messages.'
        );
        return;
      }

      if (isAddCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleAddCommand(fromId, fromId, message, text);
          },
          `Admin setup wizard opened in your private messages (<code>${this.escapeHtml(message.from?.username ? `@${message.from.username}` : (message.from?.first_name || 'Admin'))}</code>).`
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
            activeCloneSessions.delete(fromId);
            const templates = await storage.getTemplates();
            const cancelMsg = templates.CANCEL_MESSAGE?.content || '❌ <b>Operation Cancelled</b>\n<i>Current action has been aborted.</i>';
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
            await this.callTelegramApi('sendMessage', { chat_id: fromId, text: cancelMsg, parse_mode: 'HTML' });
          },
          'Operation cancelled in your private messages.'
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
              text: `🧹 <b>Cleanup Complete</b>\n\n• <b>Removed Messages:</b> <code>${deletedCount}</code>`,
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
            const msg =
              `🛡️ <b>Administrators Overview</b>\n\n` +
              `• 👮 <b>Total Admins:</b> <code>${admins.length}</code>\n` +
              `• 🆔 <b>Root ID:</b> <code>${this.escapeHtml(rootAdminId)}</code>\n` +
              `• 👥 <b>Total Bot Users:</b> <code>${totalUsers}</code>`;
            await this.callTelegramApi('sendMessage', { chat_id: fromId, text: msg, parse_mode: 'HTML' });
          },
          'Admin list sent to your private messages.'
        );
        return;
      }

      if (isConnectCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleConnectCommand(fromId, fromId, text, message.chat.id);
          },
          'Channel connection processed. Details sent to your private messages.'
        );
        return;
      }

      if (isDisconnectCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleDisconnectCommand(fromId, fromId, text, message.chat.id);
          },
          'Channel disconnection processed. Details sent to your private messages.'
        );
        return;
      }

      if (isAllowChatCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleAllowChatCommand(fromId, fromId, text, message.chat);
          },
          'Chat whitelist updated. Confirmation sent to your private messages.'
        );
        return;
      }

      if (isIgnoreChatCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleIgnoreChatCommand(fromId, fromId, text, message.chat);
          },
          'Chat removed from whitelist. Confirmation sent to your private messages.'
        );
        return;
      }

      if (isAllowedChatsCommand) {
        await executeWithPrivateDelivery(
          async () => {
            await this.handleAllowedChatsCommand(fromId, fromId);
          },
          'Whitelisted chat list sent to your private messages.'
        );
        return;
      }
    }

    // =========================================================================
    // MODERATION, BAN/UNBAN, REPORT & ANTI-FRAUD IN GROUPS
    // =========================================================================

    // Pending /clone owner assignment reply in group chat (main primary bot & authorized admin only)
    const pendingGroupClone = activeCloneSessions.get(fromId);
    if (pendingGroupClone && pendingGroupClone.chatId === String(message.chat.id) && (text || message.reply_to_message?.from) && !text.startsWith('/')) {
      if (!this.isMainBotContext()) {
        activeCloneSessions.delete(fromId);
      } else {
        const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
        if (isAdmin) {
          await this.completeInteractiveClone(message.chat.id, fromId, pendingGroupClone, text, message, true);
          return;
        }
      }
    }

    // 1. /ban Command (Admins Only): Admin replies /ban or runs /ban <user_id_or_username>
    const banMatch = text.match(/^\/ban(?:@\w+)?(?:\s+(.+))?$/i);
    if (banMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        if (!isOfficial && message.message_id) await this.deleteUserMessage(message.chat.id, message.message_id);
        return;
      }
      let targetId = '';
      let targetName = '';
      let targetUsername = '';

      if (message.reply_to_message?.from) {
        const targetUser = message.reply_to_message.from;
        targetId = String(targetUser.id);
        targetName = targetUser.first_name || targetUser.username || 'User';
        targetUsername = targetUser.username ? `@${targetUser.username.replace(/^@/, '')}` : '';
      } else if (banMatch[1]?.trim()) {
        const query = banMatch[1].trim();
        const found = await storage.findUserByIdOrUsername(query);
        if (found) {
          targetId = String(found.id);
          targetName = found.firstName || found.username || 'User';
          targetUsername = found.username ? `@${found.username.replace(/^@/, '')}` : '';
        } else {
          targetId = query.replace(/^@/, '');
          targetName = query;
          targetUsername = query.startsWith('@') ? query : '';
        }
      }

      if (targetId) {
        try {
          await this.callTelegramApi('banChatMember', {
            chat_id: message.chat.id,
            user_id: Number(targetId) || targetId
          });
        } catch (e) {
          console.warn('[Telegram] banChatMember error:', e);
        }
        await storage.setBotUserBanned(targetId, true);

        const userIdentity = this.formatUserIdentity(targetName, targetUsername, targetId);
        await this.callTelegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: `🚫 <b>User Banned</b>\n\n• 👤 <b>User:</b> ${userIdentity}\n<i>Access revoked by administrator.</i>`,
          parse_mode: 'HTML',
          reply_to_message_id: message.message_id
        });
        if (!isOfficial && message.message_id) {
          setTimeout(() => {
            TelegramService.deleteUserMessage(message.chat.id, message.message_id).catch(() => {});
          }, 3000);
        }
      }
      return;
    }

    // 2. /unban Command (Admins Only): Admin runs /unban <user_id_or_username> or replies /unban
    const unbanMatch = text.match(/^\/unban(?:@\w+)?(?:\s+(.+))?$/i);
    if (unbanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        if (!isOfficial && message.message_id) await this.deleteUserMessage(message.chat.id, message.message_id);
        return;
      }
      let targetId = '';
      let targetName = '';
      let targetUsername = '';

      if (message.reply_to_message?.from) {
        const targetUser = message.reply_to_message.from;
        targetId = String(targetUser.id);
        targetName = targetUser.first_name || targetUser.username || 'User';
        targetUsername = targetUser.username ? `@${targetUser.username.replace(/^@/, '')}` : '';
      } else if (unbanMatch[1]?.trim()) {
        const query = unbanMatch[1].trim();
        const found = await storage.findUserByIdOrUsername(query);
        if (found) {
          targetId = String(found.id);
          targetName = found.firstName || found.username || 'User';
          targetUsername = found.username ? `@${found.username.replace(/^@/, '')}` : '';
        } else {
          targetId = query.replace(/^@/, '');
          targetName = query;
          targetUsername = query.startsWith('@') ? query : '';
        }
      }

      if (targetId) {
        try {
          await this.callTelegramApi('unbanChatMember', {
            chat_id: message.chat.id,
            user_id: Number(targetId) || targetId,
            only_if_banned: true
          });
        } catch (e) {
          console.warn('[Telegram] unbanChatMember error in group:', e);
        }
        await storage.setBotUserBanned(targetId, false);
        await storage.resetUserLinkWarning(message.chat.id, targetId);
        await storage.resetUserFraudWarning(message.chat.id, targetId);
        TelegramService.unbanUserInConnectedChats(targetId).catch(() => {});

        const userIdentity = this.formatUserIdentity(targetName, targetUsername, targetId);
        await this.callTelegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: `✅ <b>User Unbanned</b>\n\n• 👤 <b>User:</b> ${userIdentity}\n<i>Warnings cleared and access restored.</i>`,
          parse_mode: 'HTML',
          reply_to_message_id: message.message_id
        });
        if (!isOfficial && message.message_id) {
          setTimeout(() => {
            TelegramService.deleteUserMessage(message.chat.id, message.message_id).catch(() => {});
          }, 3000);
        }
        return;
      } else {
        await this.callTelegramApi('sendMessage', {
          chat_id: message.chat.id,
          text: `ℹ️ <b>How to Unban</b>\nReply to any user's message with <code>/unban</code>, or run <code>/unban &lt;user_id_or_username&gt;</code>.`,
          parse_mode: 'HTML',
          reply_to_message_id: message.message_id
        });
        return;
      }
    }

    // 3. /report Command: User replies to a message with /report <reason>, or sends /report <@username_or_id> <reason>
    const reportMatch = text.match(/^\/report(?:@\w+)?(?:\s+(.+))?$/i);
    if (reportMatch || text.trim().toLowerCase().startsWith('/report')) {
      let targetUser: any = null;
      let reason = reportMatch?.[1]?.trim() || '';
      let reportedContent = '';
      let messageId: number | undefined = undefined;

      if (message.reply_to_message) {
        targetUser = message.reply_to_message.from || message.reply_to_message.sender_chat;
        messageId = message.reply_to_message.message_id;
        reportedContent = message.reply_to_message.text || message.reply_to_message.caption || '[Attachment/Media]';
        if (!reason) reason = 'Inappropriate content / violation';
      } else if (reportMatch?.[1]?.trim()) {
        const parts = reportMatch[1].trim().split(/\s+/);
        const query = parts[0];
        reason = parts.slice(1).join(' ').trim() || 'Inappropriate behavior / violation';
        const found = await storage.findUserByIdOrUsername(query);
        if (found) {
          targetUser = {
            id: found.id,
            first_name: found.firstName || found.username || 'User',
            username: found.username ? found.username.replace(/^@+/, '') : undefined
          };
        } else {
          targetUser = {
            id: query.replace(/^@+/, ''),
            first_name: query,
            username: query.startsWith('@') ? query.replace(/^@+/, '') : undefined
          };
        }
        reportedContent = reason;
      }

      if (!targetUser) {
        if (!isOfficial && message.message_id) {
          await this.deleteUserMessage(message.chat.id, message.message_id);
        }
        await this.sendAutoDeletingNotice(
          message.chat.id,
          'ℹ️ <b>How to Report</b>\nReply to the message you want to report with <code>/report &lt;reason&gt;</code>, or send <code>/report &lt;@username_or_id&gt; &lt;reason&gt;</code>.',
          6000
        );
        return;
      }

      const reporter = message.from || {};
      const targetUserId = String(targetUser.id || '');
      const targetUserName = targetUser.first_name || targetUser.title || targetUser.username || 'User';
      const targetUserUsername = targetUser.username;

      const report = await storage.saveReport({
        id: `rep_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        reporterId: String(reporter.id || ''),
        reporterName: reporter.first_name || reporter.username || 'User',
        reporterUsername: reporter.username,
        reportedUserId: targetUserId,
        reportedUserName: targetUserName,
        reportedUserUsername: targetUserUsername,
        reason,
        chatId: String(message.chat.id),
        chatTitle: message.chat.title || 'Group',
        messageId,
        reportedContent: reportedContent || reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Forward report instantly to all bot admins via private DM
      const admins = await storage.getAdmins();
      const settings = await storage.getSettings();
      const adminTargetIds = new Set<string>();
      if (settings.rootAdminId) adminTargetIds.add(String(settings.rootAdminId).trim());
      if (process.env.ADMIN_ID) adminTargetIds.add(String(process.env.ADMIN_ID).trim());
      if (process.env.ROOT_ADMIN_ID) adminTargetIds.add(String(process.env.ROOT_ADMIN_ID).trim());
      for (const a of admins) {
        if (a.telegramId) adminTargetIds.add(String(a.telegramId).trim());
        if (a.id && /^\d+$/.test(String(a.id))) adminTargetIds.add(String(a.id).trim());
      }

      const adminReportMsg = 
        `🚨 <b>New User Report Filed</b>\n\n` +
        `• 👤 <b>Reported User:</b> ${this.formatUserIdentity(targetUserName, targetUserUsername, targetUserId)}\n` +
        `• 📢 <b>Reported By:</b> ${this.formatUserIdentity(reporter.first_name || 'User', reporter.username, reporter.id)}\n` +
        `• 👥 <b>Chat / Source:</b> <code>${this.escapeHtml(message.chat.title || 'Group')}</code> (<code>${this.escapeHtml(String(message.chat.id))}</code>)\n` +
        `• 📝 <b>Reason:</b> <i>${this.escapeHtml(reason)}</i>\n` +
        `💬 <b>Content Snippet:</b>\n<blockquote>${this.escapeHtml(reportedContent.slice(0, 300))}</blockquote>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🚫 Ban User', callback_data: `admin_ban_user:${targetUserId}:${report.id}`, style: 'danger' },
            { text: 'Dismiss', callback_data: `admin_dismiss_report:${report.id}`, style: 'primary' }
          ]
        ]
      };

      for (const adminId of adminTargetIds) {
        try {
          await this.callTelegramApi('sendMessage', {
            chat_id: adminId,
            text: adminReportMsg,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (e) {
          console.warn(`[Telegram] Failed to notify admin ${adminId} of report:`, e);
        }
      }

      // Delete the /report command message from the group only for non-admin members
      if (!isOfficial && message.message_id) {
        await this.deleteUserMessage(message.chat.id, message.message_id);
      }
      // Send auto-deleting confirmation notice
      await this.sendAutoDeletingNotice(
        message.chat.id,
        '✅ <i>Report received and forwarded to administrators for review.</i>',
        4000
      );
      return;
    }


    // 4. Fraud Protection & Custom Word Filter Rules (Strictly exempt verified group admins & official channels)
    const fraudRules = await storage.getFraudRules();
    const activeFraudRules = fraudRules.filter(r => r.enabled);
    if (activeFraudRules.length > 0) {
      if (!isOfficial) {
        const lowerText = text.toLowerCase();
        for (const rule of activeFraudRules) {
          let matched = false;
          const kw = rule.keyword.trim().toLowerCase();
          if (rule.matchType === 'exact') {
            matched = lowerText === kw;
          } else if (rule.matchType === 'regex') {
            try {
              const reg = new RegExp(rule.keyword, 'i');
              matched = reg.test(text);
            } catch {}
          } else {
            // Default: contains
            matched = lowerText.includes(kw);
          }

          if (matched) {
            const action = rule.action || 'delete_and_warn';
            const maxWarnings = rule.maxWarnings && rule.maxWarnings > 0 ? rule.maxWarnings : 3;
            const duration = rule.duration || 'permanent';
            const isReplyOnly = action === 'reply_only';

            // Delete offending message only when configured (NEVER delete on reply_only or warn)
            const shouldDeleteMessage =
              action === 'delete' || action === 'delete_and_warn' || action === 'mute' || action === 'ban';
            if (shouldDeleteMessage && message.message_id) {
              await this.deleteUserMessage(message.chat.id, message.message_id);
            }

            // Increment and evaluate warning count ONLY for warning/penalty rules (skip on reply_only & delete)
            let currentWarnings = 0;
            let isFinalThreshold = false;
            if (!isReplyOnly && action !== 'delete') {
              currentWarnings = await storage.incrementUserFraudWarning(message.chat.id, fromId, rule.id);
              isFinalThreshold = currentWarnings >= maxWarnings;
            }

            let actionDescription = 'Warning issued';
            if (isReplyOnly) {
              actionDescription = 'Reply sent';
            } else if (action === 'delete') {
              actionDescription = 'Message deleted';
            } else if (action === 'mute') {
              actionDescription = isFinalThreshold ? `Muted (${duration})` : `Warning (${currentWarnings}/${maxWarnings})`;
            } else if (action === 'ban') {
              actionDescription = isFinalThreshold ? `Banned (${duration})` : `Warning (${currentWarnings}/${maxWarnings})`;
            }

            // If threshold reached and action is mute or ban, execute penalty
            if (!isReplyOnly && isFinalThreshold && (action === 'mute' || action === 'ban')) {
              let durationSec = 0;
              const durLower = (duration || '').trim().toLowerCase();
              if (durLower && durLower !== 'permanent') {
                const match = durLower.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
                if (match) {
                  const val = parseFloat(match[1]);
                  const unit = match[2] || 'm';
                  if (unit.startsWith('h')) durationSec = Math.round(val * 3600);
                  else if (unit.startsWith('d')) durationSec = Math.round(val * 86400);
                  else durationSec = Math.round(val * 60); // default minutes
                } else if (durLower === '1h') durationSec = 3600;
                else if (durLower === '6h') durationSec = 6 * 3600;
                else if (durLower === '24h') durationSec = 24 * 3600;
                else if (durLower === '7d') durationSec = 7 * 86400;
                else if (durLower === '30d') durationSec = 30 * 86400;
              }

              const untilDate = durationSec > 0 ? Math.floor(Date.now() / 1000) + durationSec : undefined;

              if (action === 'mute') {
                try {
                  await this.callTelegramApi('restrictChatMember', {
                    chat_id: message.chat.id,
                    user_id: Number(fromId) || fromId,
                    permissions: {
                      can_send_messages: false,
                      can_send_audios: false,
                      can_send_documents: false,
                      can_send_photos: false,
                      can_send_videos: false,
                      can_send_video_notes: false,
                      can_send_voice_notes: false,
                      can_send_polls: false,
                      can_send_other_messages: false,
                      can_add_web_page_previews: false
                    },
                    ...(untilDate ? { until_date: untilDate } : {})
                  });
                } catch (e) {
                  console.warn('[Telegram] Error muting user for fraud keyword:', e);
                }
              } else if (action === 'ban') {
                try {
                  await this.callTelegramApi('banChatMember', {
                    chat_id: message.chat.id,
                    user_id: Number(fromId) || fromId,
                    ...(untilDate ? { until_date: untilDate } : {})
                  });
                } catch (e) {
                  console.warn('[Telegram] Error banning user for fraud keyword:', e);
                }
                await storage.setBotUserBanned(fromId, true);
              }

              // Reset warnings after enforcing final punishment
              await storage.resetUserFraudWarning(message.chat.id, fromId, rule.id);
            }

            // Send notification / warning / Rose-style media+caption reply
            if (action !== 'delete') {
              const hasMedia = Boolean(
                rule.mediaUrl &&
                rule.mediaType &&
                rule.mediaType !== 'text' &&
                rule.mediaType !== 'none'
              );
              const customMsgRaw = (rule.customMessage || rule.warningText || '').trim();
              const templates = await storage.getTemplates();
              const defaultTpl = isReplyOnly
                ? (hasMedia ? '' : '💬 Hello <code>{user_name}</code>, please check this regarding <code>{keyword}</code>.')
                : (templates.FRAUD_KEYWORD_DEFAULT_REPLY?.content ||
                  '⚠️ <b>Warning (<code>{warning_count}/{max_warnings}</code>):</b> Prohibited content detected.\n• 👤 <b>User:</b> <code>{user_name}</code> (<b>ID:</b> <code>{user_id}</code>)\n• 🛡️ <b>Action:</b> <code>{action}</code>');

              const rawMessage = customMsgRaw || defaultTpl;
              const formattedReply = rawMessage
                .replace(/\{user_name\}/g, this.escapeHtml(message.from?.first_name || 'User'))
                .replace(/\{user_id\}/g, this.escapeHtml(fromId))
                .replace(/\{keyword\}/g, this.escapeHtml(rule.keyword))
                .replace(/\{warning_count\}/g, String(currentWarnings))
                .replace(/\{max_warnings\}/g, String(maxWarnings))
                .replace(/\{action\}/g, this.escapeHtml(actionDescription))
                .replace(/\{duration\}/g, this.escapeHtml(duration));

              // Quote-reply directly to the user's message whenever it wasn't deleted (e.g. reply_only or warn)
              const quoteReplyId = !shouldDeleteMessage && message.message_id ? Number(message.message_id) : undefined;
              const threadId = message.message_thread_id ? Number(message.message_thread_id) : undefined;

              if (hasMedia && rule.mediaUrl) {
                const mediaRes = await TelegramService.sendBroadcastMessage({
                  chatId: message.chat.id,
                  message: formattedReply || undefined,
                  mediaType: rule.mediaType as any,
                  mediaUrl: rule.mediaUrl,
                  replyToMessageId: quoteReplyId,
                  threadId
                });

                // Cache newly assigned Telegram file_id back to rule for instant future replies
                if (mediaRes.ok && mediaRes.fileId && rule.mediaUrl !== mediaRes.fileId) {
                  storage.saveFraudRule({ ...rule, mediaUrl: mediaRes.fileId }).catch(() => {});
                }

                // Fallback to text reply if media dispatch failed and we have reply text
                if (!mediaRes.ok && formattedReply) {
                  console.warn('[Telegram] Fraud rule media reply failed, falling back to text:', mediaRes.description);
                  await this.callTelegramApi('sendMessage', {
                    chat_id: message.chat.id,
                    text: formattedReply,
                    parse_mode: 'HTML',
                    ...(quoteReplyId ? { reply_to_message_id: quoteReplyId } : {}),
                    ...(threadId ? { message_thread_id: threadId } : {})
                  });
                }
              } else if (formattedReply) {
                const sendRes = await this.callTelegramApi('sendMessage', {
                  chat_id: message.chat.id,
                  text: formattedReply,
                  parse_mode: 'HTML',
                  ...(quoteReplyId ? { reply_to_message_id: quoteReplyId } : {}),
                  ...(threadId ? { message_thread_id: threadId } : {})
                });
                if (!sendRes?.ok && quoteReplyId) {
                  await this.callTelegramApi('sendMessage', {
                    chat_id: message.chat.id,
                    text: formattedReply,
                    parse_mode: 'HTML',
                    ...(threadId ? { message_thread_id: threadId } : {})
                  });
                }
              }
            }
            return;
          }
        }
      }
    }

    // Multi-Language Translation Trigger in Groups (Method A: `tran bd|ind|eng` | Method B: `/translate bd|ind|eng`, `/bd`, `/ind`, `/eng`)
    if (await this.handleTranslationCommand(message, text, true)) {
      return;
    }

    // Free Fire UID Checker (/u <uid> or /uid <uid>) in Groups
    const groupFfCmd = this.parseFreeFireUidCommand(text);
    if (groupFfCmd.matched) {
      await this.handleFreeFireUidCommand(
        message.chat.id,
        groupFfCmd.uid,
        message.message_id,
        true,
        message.message_thread_id
      );
      return;
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
      const isTextOnly = Boolean(matchedItem.isTextOnly || matchedItem.fileEnabled === false);
      const template = isTextOnly
        ? { content: "💬 <b>Message Ready for Delivery</b>\n<i>Tap the button below to view your message in private DM.</i>" }
        : (templates.GROUP_FILE_REPLY || { content: "📦 <b>File Ready for Delivery</b>\n<i>Tap the button below to receive your file in private DM.</i>" });
      const buttonTemplate = isTextOnly
        ? { content: '💬 View Message Privately' }
        : (templates.GET_FILE_BUTTON || { content: '🔒 Get File Privately' });

      const replyText = template.content
        .replace('{user_name}', this.escapeHtml(userName))
        .replace('{user_id}', this.escapeHtml(userId))
        .replace('{trigger}', this.escapeHtml(text))
        .replace('{file_name}', this.escapeHtml(matchedItem.fileName || matchedItem.name));

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const buttonText = buttonTemplate.content?.trim() || (isTextOnly ? '💬 View Message Privately' : '📁 Get File Privately');
      const keyboard = [[{ text: buttonText, url: deepLink, style: 'primary' }]];

      const res = await this.sendGroupTriggerReply(
        message.chat.id,
        replyText,
        keyboard,
        message.message_id,
        message.message_thread_id
      );

      if (res && res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
    } else if (matchedItem.type === 'link') {
      const template = templates.GROUP_LINK_REPLY || { content: "🔗 <b>Link Ready for Delivery</b>\n<i>Tap the button below to open your link in private DM.</i>" };
      const buttonTemplate = templates.GET_LINK_BUTTON || { content: '🔗 Open Privately' };

      const replyText = template.content
        .replace('{user_name}', this.escapeHtml(userName))
        .replace('{user_id}', this.escapeHtml(userId))
        .replace('{trigger}', this.escapeHtml(text))
        .replace('{title}', this.escapeHtml(matchedItem.name));

      const cleanBotUsername = botUsername.replace(/^@/, '');
      const payload = getItemPayload(matchedItem);
      const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

      const buttonText = buttonTemplate.content?.trim() || '🔗 Open Privately';
      const keyboard = [[{ text: buttonText, url: deepLink, style: 'primary' }]];

      const res = await this.sendGroupTriggerReply(
        message.chat.id,
        replyText,
        keyboard,
        message.message_id,
        message.message_thread_id
      );

      if (res && res.ok && res.result?.message_id) {
        await this.trackAndLimitMessage(message.chat.id, res.result.message_id);
      }
    }
  }

  // Robust error-resilient sender for group trigger replies
  private static async sendGroupTriggerReply(
    chatId: string | number,
    text: string,
    inlineKeyboard: any[][],
    replyToMessageId?: number,
    threadId?: number
  ): Promise<any> {
    const params: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard }
    };
    if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
    if (threadId) params.message_thread_id = threadId;

    let res = await this.callTelegramApi('sendMessage', params);
    if (res && res.ok) return res;

    // Retry 1: If failed with reply_to_message_id (e.g. original message deleted or permission restricted), try without it
    if (params.reply_to_message_id) {
      console.warn(`[Telegram Group] Reply with reply_to_message_id failed (${res?.description}), retrying without reply_to_message_id...`);
      delete params.reply_to_message_id;
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    // Retry 2: If failed with message_thread_id, try without it
    if (params.message_thread_id) {
      console.warn(`[Telegram Group] Reply with message_thread_id failed (${res?.description}), retrying without message_thread_id...`);
      delete params.message_thread_id;
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    // Retry 3: Remove custom style property if Telegram server rejected unknown field
    try {
      const cleanButtons = inlineKeyboard.map(row =>
        row.map(btn => {
          const { style, ...rest } = btn;
          return rest;
        })
      );
      params.reply_markup = { inline_keyboard: cleanButtons };
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    } catch {}

    // Retry 4: Plain text fallback if HTML parse mode or characters failed
    if (params.parse_mode) {
      delete params.parse_mode;
      params.text = text.replace(/<[^>]+>/g, '');
      res = await this.callTelegramApi('sendMessage', params);
      if (res && res.ok) return res;
    }

    console.warn(`[Telegram Group] Group message delivery failed after retries:`, res?.description);
    return res;
  }

  // =========================================================================
  // WELCOME / START MESSAGE DISPATCHER
  // =========================================================================
  public static async sendStartWelcomeMessage(
    chatId: string | number,
    fromId: string,
    message?: any
  ): Promise<void> {
    const templates = await storage.getTemplates();
    const startTemplate = templates.START_MESSAGE;
    let startMsg = startTemplate?.content || "👋 <b>Welcome, <code>{user_name}</code>!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> <code>{bot_name}</code>\n\n✨ <i>Send any configured trigger hashtag in your group or here to receive your files privately.</i>";
    
    // Comprehensive Username & Name variables
    const cleanUsername = message?.from?.username ? `@${message.from.username.replace(/^@+/, '')}` : '';
    const userDisplayName = [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ') || cleanUsername || 'User';
    const userMention = cleanUsername || userDisplayName;
    const botUsername = await this.getBotUsername();
    const formattedBotName = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'the bot';
    const safeUserDisplayName = this.escapeHtml(userDisplayName);
    const safeUserMention = this.escapeHtml(userMention);
    const safeFromId = this.escapeHtml(String(fromId));
    const safeBotName = this.escapeHtml(formattedBotName);

    // Replace all variations of @username, username, user_name, user_id, bot_name
    startMsg = startMsg
      .replace(/@?\{@?username\}/gi, safeUserMention)
      .replace(/@username\b/gi, safeUserMention)
      .replace(/\{user_name\}/gi, safeUserDisplayName)
      .replace(/\{name\}/gi, safeUserDisplayName)
      .replace(/\{user\}/gi, safeUserDisplayName)
      .replace(/\{user_id\}/gi, safeFromId)
      .replace(/\{userId\}/gi, safeFromId)
      .replace(/\{id\}/gi, safeFromId)
      .replace(/@?\{@?bot_name\}/gi, safeBotName)
      .replace(/@?\{@?bot_username\}/gi, safeBotName)
      .replace(/Hey Friend/gi, `Hey ${safeUserDisplayName}`)
      .replace(/\bFriend\b/gi, safeUserDisplayName)
      .replace(/@@([a-zA-Z0-9_]+)/g, '@$1'); // Avoid double @@

    const mediaType = startTemplate?.mediaType || 'none';
    const mediaUrl = startTemplate?.mediaUrl?.trim();
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
  }

  // =========================================================================
  // INTERACTIVE CLONE COMPLETION (OWNER ASSIGNMENT + BOT ID CREDENTIALS)
  // =========================================================================
  private static async completeInteractiveClone(
    chatId: number | string,
    fromId: string,
    session: CloneSession,
    rawText: string,
    message: any,
    isGroup: boolean
  ): Promise<void> {
    const trimmed = (rawText || '').trim();

    if (session.stage === 'awaiting_mode') {
      const lower = trimmed.toLowerCase();
      let selectedMode: BotOperationalMode | null = null;
      if (/^(?:1|file|file\s*bot)$/i.test(lower)) {
        selectedMode = 'file_bot';
      } else if (/^(?:2|post|post\s*bot)$/i.test(lower)) {
        selectedMode = 'post_bot';
      }
      if (!selectedMode) {
        const modePrompt =
          `⚙️ <b>Select Bot Mode First</b>\n\n` +
          `Tap one of the buttons below or reply with <code>File Bot</code> or <code>Post Bot</code>:`;
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: modePrompt,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📁 File Bot', callback_data: `clone_mode:${fromId}:file_bot`, style: 'primary' },
                { text: '📝 Post Bot', callback_data: `clone_mode:${fromId}:post_bot`, style: 'success' }
              ],
              [{ text: '❌ Cancel', callback_data: `clone_cancel:${fromId}`, style: 'danger' }]
            ]
          }
        });
        return;
      }
      session.botMode = selectedMode;
      session.stage = 'awaiting_owner';
      activeCloneSessions.set(fromId, session);
      const modeLabel = selectedMode === 'post_bot' ? '📝 Post Bot' : '📁 File Bot';
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `✅ <b>Mode Selected:</b> <code>${this.escapeHtml(modeLabel)}</code>\n\n` +
          `👤 <b>Assign Clone Owner</b>\n<i>Reply with the Telegram User ID or Username of the new Owner for this cloned bot.</i>\n\n` +
          `• <b>Examples:</b> <code>123456789</code> or <code>@username</code>`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Cancel', callback_data: `clone_cancel:${fromId}`, style: 'danger' }]]
        }
      });
      return;
    }

    let ownerId = '';
    let ownerUsername = '';

    if (/^\d{4,20}$/.test(trimmed)) {
      ownerId = trimmed;
    } else if (/^(?:me|self)$/i.test(trimmed)) {
      ownerId = fromId;
      ownerUsername = (message?.from?.username || '').replace(/^@+/, '').trim();
    } else if (/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{3,32})\/?$/i.test(trimmed)) {
      const m = trimmed.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{3,32})\/?$/i);
      ownerUsername = (m?.[1] || '').trim();
    } else if (/^@[a-zA-Z0-9_]{3,32}$/.test(trimmed)) {
      ownerUsername = trimmed.replace(/^@+/, '').trim();
    } else if (/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(trimmed)) {
      ownerUsername = trimmed;
    } else if (!trimmed && message?.forward_from && !message.forward_from.is_bot) {
      ownerId = String(message.forward_from.id || '').trim();
      ownerUsername = (message.forward_from.username || '').replace(/^@+/, '').trim();
    } else if (message?.reply_to_message?.from && !message.reply_to_message.from.is_bot && (!trimmed || /^(?:this|him|her|owner)$/i.test(trimmed))) {
      ownerId = String(message.reply_to_message.from.id || '').trim();
      ownerUsername = (message.reply_to_message.from.username || '').replace(/^@+/, '').trim();
    }

    if (!ownerId && !ownerUsername) {
      const invalidMsg = `⚠️ <b>Invalid Owner Format</b>\n\nPlease reply with a valid <b>Telegram User ID</b> (e.g. <code>123456789</code>) or <b>Username</b> (e.g. <code>@username</code>).\n\n<i>Send <code>/cancel</code> to abort.</i>`;
      if (isGroup) {
        await this.sendAutoDeletingNotice(chatId, invalidMsg, 8000, message?.message_id);
      } else {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: invalidMsg,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: `clone_cancel:${fromId}`, style: 'danger' }]]
          }
        });
      }
      return;
    }

    activeCloneSessions.delete(fromId);
    const selectedMode: BotOperationalMode = session.botMode === 'post_bot' ? 'post_bot' : 'file_bot';

    const statusNotice = await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `⏳ <b>Finalizing Bot Clone...</b>\n<i>Configuring <code>@${this.escapeHtml(session.botInfo.username || session.botInfo.first_name || 'Bot')}</code> and assigning Owner.</i>`,
      parse_mode: 'HTML'
    });

    const result = await TelegramBotManager.cloneBot(
      session.token,
      fromId,
      undefined,
      { ownerId: ownerId || undefined, ownerUsername: ownerUsername || undefined },
      selectedMode
    );

    if (statusNotice?.ok && statusNotice.result?.message_id) {
      await this.deleteUserMessage(chatId, statusNotice.result.message_id);
    }

    if (!result.success || !result.bot) {
      const errorMsg = result.error === 'Already this bot is already running.'
        ? '❌ <b>Already Running:</b> <i>This bot instance is already active.</i>'
        : `❌ <b>Failed to Clone Bot</b>\n<code>${this.escapeHtml(result.error || 'Unknown error occurred.')}</code>`;
      if (isGroup) {
        await this.sendAutoDeletingNotice(chatId, errorMsg, 8000);
      } else {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: errorMsg,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    const bot = result.bot;
    const ownerDisplay = bot.ownerUsername && bot.ownerId && bot.ownerId !== bot.ownerUsername
      ? `<code>@${this.escapeHtml(bot.ownerUsername)}</code> (<code>${this.escapeHtml(bot.ownerId)}</code>)`
      : (bot.ownerUsername ? `<code>@${this.escapeHtml(bot.ownerUsername)}</code>` : `<code>${this.escapeHtml(bot.ownerId || fromId)}</code>`);
    const modeDisplay = (bot.botMode || selectedMode) === 'post_bot' ? '📝 Post Bot' : '📁 File Bot';

    const cleanBotId = String(bot.id).replace(/^clone_/i, '').replace(/[:_-]/g, '');
    const successText =
      `✅ <b>Telegram Bot Successfully Cloned</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• 🤖 <b>Bot Name:</b> <code>${this.escapeHtml(bot.name)}</code>\n` +
      `• 🔗 <b>Bot Username:</b> <code>@${this.escapeHtml(bot.username)}</code>\n` +
      `• ⚙️ <b>Mode:</b> <code>${this.escapeHtml(modeDisplay)}</code>\n` +
      `• 👑 <b>Official Owner:</b> ${ownerDisplay}\n` +
      `• 📡 <b>Status:</b> <code>Active &amp; Polling</code> 🟢\n\n` +
      `🔐 <b>Sub-Admin Panel Credentials</b>\n` +
      `• 🌐 <b>Panel URL:</b> <code>${this.escapeHtml(bot.panelUrl || 'N/A')}</code>\n` +
      `• 🆔 <b>Bot ID:</b> <code>${this.escapeHtml(cleanBotId)}</code>\n` +
      `• 🔑 <b>Password:</b> <code>${this.escapeHtml(bot.adminPassword || 'N/A')}</code>\n\n` +
      `<i>The assigned Owner can log in to the web panel using the Bot ID and Password above.</i>`;

    if (isGroup) {
      if (message?.message_id) {
        await this.deleteUserMessage(chatId, message.message_id);
      }
      if (session.promptMessageId) {
        await this.deleteUserMessage(chatId, session.promptMessageId);
      }
      const dmRes = await this.callTelegramApi('sendMessage', {
        chat_id: fromId,
        text: successText,
        parse_mode: 'HTML'
      });
      if (dmRes?.ok) {
        await this.sendAutoDeletingNotice(
          chatId,
          `✅ <b>Bot Cloned:</b> <code>@${this.escapeHtml(bot.username)}</code>\n• <b>Owner:</b> ${ownerDisplay}\n<i>Panel credentials sent to your private DM.</i>`,
          7000
        );
      } else {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: successText,
          parse_mode: 'HTML'
        });
      }
    } else {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: successText,
        parse_mode: 'HTML'
      });
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

    // Check if user is in an active /editthismessage session (allow built-in slash commands to bypass cleanly)
    const editSession = activeEditSessions.get(fromId);
    if (editSession && text && !/^\/(?:cancel|start|filters?|allfiles?|u|uid)(?:@\w+)?(?:\s|$)/i.test(text.trim())) {
      await storage.updateTemplate(editSession.templateKey, text);
      activeEditSessions.delete(fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `✅ <b>Template Updated</b>\n\n• <b>Template:</b> <code>${this.escapeHtml(editSession.templateKey)}</code>\n<i>Saved successfully and now active.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // 2. Start command / Deep linking: /start <payload> (supports /start <payload>, /start@BotUsername <payload>)
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
    if (startMatch) {
      const rawPayload = startMatch[1]?.trim();

      // Mandatory Channel Join (Force Sub) live check
      const forceCheck = await this.checkUserForceSub(fromId, message?.from?.username, { forceFresh: true });
      if (!forceCheck.allJoined) {
        await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, rawPayload || 'start', undefined, message?.from);
        return;
      }

      if (rawPayload) {
        // Bypass duplicate force-sub check for zero-latency instant file delivery
        await this.handleDeepLinkDelivery(chatId, rawPayload, { skipForceSubCheck: true });
        return;
      } else {
        await this.sendStartWelcomeMessage(chatId, fromId, message);
        return;
      }
    }

    // Admin /help command in private chat (Admins Only)
    if (/^\/help(?:@\w+)?(?:\s+|$)/i.test(text.trim())) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>The <code>/help</code> command is restricted to authorized administrators only.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.sendAdminHelpGuide(chatId, fromId);
      return;
    }

    // Admin /clone command in private chat: /clone <bot_token> (Main primary bot & authorized admins only)
    const cloneMatch = text.match(/^\/clone(?:@\w+)?(?:\s+(.+))?$/i);
    if (cloneMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can clone bots.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      if (!this.isMainBotContext()) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Command Disabled</b>\n<i>The <code>/clone</code> command is completely disabled inside cloned bot instances and only works on the main primary bot.</i>',
          parse_mode: 'HTML'
        });
        return;
      }

      const tokenArg = cloneMatch[1]?.trim();
      if (!tokenArg) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Clone Telegram Bot</b>\n\n1. Open <code>@BotFather</code> on Telegram and create a new bot using <code>/newbot</code>\n2. Copy the HTTP API Token\n3. Send the command here:\n<code>/clone &lt;your_bot_token&gt;</code>\n\n<i>You will then select the Bot Mode and assign the official Owner User ID or @username.</i>`,
          parse_mode: 'HTML'
        });
        return;
      }

      const check = await TelegramBotManager.validateCloneToken(tokenArg);
      if (!check.ok || !check.info) {
        const errorMsg = check.error === 'Already this bot is already running.'
          ? '❌ <b>Already Running:</b> <i>This bot instance is already active.</i>'
          : `❌ <b>Failed to Clone Bot</b>\n<code>${this.escapeHtml(check.error || 'Invalid bot token or failed to verify with Telegram.')}</code>`;
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: errorMsg,
          parse_mode: 'HTML'
        });
        return;
      }

      const session: CloneSession = {
        token: check.cleanToken!,
        botInfo: check.info,
        chatId: String(chatId),
        createdBy: fromId,
        createdAt: Date.now(),
        stage: 'awaiting_mode'
      };

      const promptRes = await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `🤖 <b>Bot Token Verified:</b> <code>@${this.escapeHtml(check.info.username || check.info.first_name || 'Bot')}</code>\n\n` +
          `⚙️ <b>Choose Bot Mode for this clone:</b>\n\n` +
          `• 📁 <b>File Bot</b> — Standard file delivery, filters &amp; indexing mode\n` +
          `• 📝 <b>Post Bot</b> — Channel post maker, inline buttons &amp; post editing mode`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📁 File Bot', callback_data: `clone_mode:${fromId}:file_bot`, style: 'primary' },
              { text: '📝 Post Bot', callback_data: `clone_mode:${fromId}:post_bot`, style: 'success' }
            ],
            [{ text: '❌ Cancel', callback_data: `clone_cancel:${fromId}`, style: 'danger' }]
          ]
        }
      });
      if (promptRes?.ok && promptRes.result?.message_id) {
        session.promptMessageId = promptRes.result.message_id;
      }
      activeCloneSessions.set(fromId, session);
      return;
    }

    // Admin /ban command in private chat
    const privBanMatch = text.match(/^\/ban(?:@\w+)?(?:\s+(.+))?$/i);
    if (privBanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can use <code>/ban</code>.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      if (!privBanMatch[1]?.trim()) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Ban</b>\nSend <code>/ban &lt;user_id_or_username&gt;</code>`,
          parse_mode: 'HTML'
        });
        return;
      }
      const query = privBanMatch[1].trim();
      const found = await storage.findUserByIdOrUsername(query);
      const targetId = found ? String(found.id) : query.replace(/^@/, '');
      const targetName = found ? (found.firstName || found.username || 'User') : query;
      const targetUsername = found?.username ? `@${found.username.replace(/^@/, '')}` : (query.startsWith('@') ? query : '');
      await storage.setBotUserBanned(targetId, true);
      const userIdentity = this.formatUserIdentity(targetName, targetUsername, targetId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `🚫 <b>User Banned</b>\n\n• 👤 <b>User:</b> ${userIdentity}\n<i>Access revoked by administrator.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // Admin /unban command in private chat
    const privUnbanMatch = text.match(/^\/unban(?:@\w+)?(?:\s+(.+))?$/i);
    if (privUnbanMatch) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can use <code>/unban</code>.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      const query = privUnbanMatch[1]?.trim();
      if (!query) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Unban</b>\nType <code>/unban &lt;user_id_or_username&gt;</code>\n<b>Example:</b> <code>/unban 123456789</code> or <code>/unban @john_doe</code>`,
          parse_mode: 'HTML'
        });
        return;
      }

      const found = await storage.findUserByIdOrUsername(query);
      const targetId = found ? String(found.id) : query.replace(/^@/, '');
      const targetName = found ? (found.firstName || found.username || 'User') : query;
      const targetUsername = found?.username ? `@${found.username.replace(/^@/, '')}` : (query.startsWith('@') ? query : '');
      
      await storage.setBotUserBanned(targetId, false);
      await storage.resetUserLinkWarning(targetId);
      await storage.resetUserFraudWarning(targetId);
      TelegramService.unbanUserInConnectedChats(targetId).catch(() => {});

      const userIdentity = this.formatUserIdentity(targetName, targetUsername, targetId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `✅ <b>User Unbanned</b>\n\n• 👤 <b>User:</b> ${userIdentity}\n<i>Warnings cleared and access restored.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // /report command in private chat
    const privReportMatch = text.match(/^\/report(?:@\w+)?(?:\s+(.+))?$/i);
    if (privReportMatch) {
      const query = privReportMatch[1]?.trim();
      if (!query) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `ℹ️ <b>How to Report</b>\nSend <code>/report &lt;@username_or_id&gt; &lt;reason&gt;</code>\n<b>Example:</b> <code>/report @spammer Violating community rules</code>`,
          parse_mode: 'HTML'
        });
        return;
      }

      const parts = query.split(/\s+/);
      const targetQuery = parts[0];
      const reason = parts.slice(1).join(' ').trim() || 'Inappropriate behavior / violation';
      const found = await storage.findUserByIdOrUsername(targetQuery);
      
      const targetUserId = found ? String(found.id) : targetQuery.replace(/^@+/, '');
      const targetUserName = found ? (found.firstName || found.username || 'User') : targetQuery;
      const targetUserUsername = found?.username ? found.username.replace(/^@+/, '') : (targetQuery.startsWith('@') ? targetQuery.replace(/^@+/, '') : undefined);

      const reporter = message.from || {};
      const report = await storage.saveReport({
        id: `rep_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
        reporterId: String(reporter.id || fromId),
        reporterName: reporter.first_name || reporter.username || 'User',
        reporterUsername: reporter.username,
        reportedUserId: targetUserId,
        reportedUserName: targetUserName,
        reportedUserUsername: targetUserUsername,
        reason,
        chatId: String(chatId),
        chatTitle: 'Direct Message',
        reportedContent: reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Forward to all admin inboxes
      const admins = await storage.getAdmins();
      const settings = await storage.getSettings();
      const adminTargetIds = new Set<string>();
      if (settings.rootAdminId) adminTargetIds.add(String(settings.rootAdminId).trim());
      if (process.env.ROOT_ADMIN_ID) adminTargetIds.add(String(process.env.ROOT_ADMIN_ID).trim());
      for (const a of admins) {
        if (a.telegramId) adminTargetIds.add(String(a.telegramId).trim());
        if (a.id && /^\d+$/.test(String(a.id))) adminTargetIds.add(String(a.id).trim());
      }

      const adminReportMsg = 
        `🚨 <b>New User Report Filed (DM)</b>\n\n` +
        `• 👤 <b>Reported User:</b> ${this.formatUserIdentity(targetUserName, targetUserUsername, targetUserId)}\n` +
        `• 📢 <b>Reported By:</b> ${this.formatUserIdentity(reporter.first_name || 'User', reporter.username, reporter.id)}\n` +
        `• 💬 <b>Source:</b> <code>Direct Message</code>\n` +
        `• 📝 <b>Reason:</b> <i>${this.escapeHtml(reason)}</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🚫 Ban User', callback_data: `admin_ban_user:${targetUserId}:${report.id}` },
            { text: 'Dismiss', callback_data: `admin_dismiss_report:${report.id}` }
          ]
        ]
      };

      for (const adminId of adminTargetIds) {
        try {
          await this.callTelegramApi('sendMessage', {
            chat_id: adminId,
            text: adminReportMsg,
            parse_mode: 'HTML',
            reply_markup: keyboard
          });
        } catch (e) {
          console.warn(`[Telegram] Failed to notify admin ${adminId} of DM report:`, e);
        }
      }

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '✅ <b>Report Submitted</b>\n<i>Your report has been forwarded to administrators for review.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    // Forward-based Private Channel / Group Setup:
    // STRICT REQUIREMENT: Private channel connection must happen EXPLICITLY only when
    // the admin sends the /setchannel (or /connect) command first, followed by forwarding a message from that channel.
    // When an admin is in an /add session, forwarded content MUST be processed as content to save, NEVER as channel connection!
    const forwardChat = message.forward_from_chat ||
      (message.forward_origin && (message.forward_origin.chat || message.forward_origin.sender_chat));

    if (forwardChat && forwardChat.id) {
      if (activeSetChannelSessions.has(fromId)) {
        activeSetChannelSessions.delete(fromId);
        const isAdmin = await this.isAuthorizedAdmin(fromId);
        if (isAdmin) {
          await this.handleForwardedChannelSetup(fromId, chatId, forwardChat);
          return;
        }
      }
      // If NOT in a /setchannel session, DO NOT connect channel!
      // Forwarded messages continue to /add session or normal content processing below!
    }

    // Admin /connect, /addchannel, or /setchannel command
    if (/^\/(?:connect|addchannel|setchannel)(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleConnectCommand(fromId, chatId, text);
      return;
    }

    // Admin /disconnect or /removechannel command
    if (/^\/(?:disconnect|removechannel)(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleDisconnectCommand(fromId, chatId, text);
      return;
    }

    // Admin /allowchat, /ignorechat, /allowedchats commands in Private DM
    if (/^\/allowchat(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleAllowChatCommand(fromId, chatId, text);
      return;
    }
    if (/^\/ignorechat(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleIgnoreChatCommand(fromId, chatId, text);
      return;
    }
    if (/^\/(?:allowedchats|whitelistedchats)(?:@\w+)?(?:\s+.*)?$/i.test(text.trim())) {
      await this.handleAllowedChatsCommand(fromId, chatId);
      return;
    }

    // 2a. Multi-Language Translation Trigger in Private Chat (`tran bd|ind|eng`, `/translate bd|ind|eng`, `/bd`, `/ind`, `/eng`)
    if (await this.handleTranslationCommand(message, text, false)) {
      return;
    }

    // 2b. Filters command (/filters, /filter) - Strictly requires '/' prefix
    const isFilters = /^\/(?:filters|filter)(?:@\w+)?$/i.test(text.trim());
    if (isFilters) {
      await this.handleFiltersCommand(chatId, message.message_id, false);
      return;
    }

    // 2c. File listing command (/allfile, /allfiles — STRICTLY ADMIN-ONLY)
    const allFileCmd = this.parseAllFileCommand(text);
    if (allFileCmd.matched) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>The <code>/allfiles</code> command is restricted to authorized administrators only.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.handleFilesListCommand(
        fromId,
        chatId,
        allFileCmd.page,
        message.message_id,
        false,
        undefined,
        message.message_thread_id
      );
      return;
    }

    // 2d. Free Fire UID Checker command (/u <uid> or /uid <uid>) in Private Chat
    const privFfCmd = this.parseFreeFireUidCommand(text);
    if (privFfCmd.matched) {
      await this.handleFreeFireUidCommand(
        chatId,
        privFfCmd.uid,
        message.message_id,
        false,
        message.message_thread_id
      );
      return;
    }

    // 3. Command: /setstartmsg or /startmsg
    if (/^\/(?:setstartmsg|startmsg)(?:@\w+)?(?:\s|$)/i.test(text)) {
      await this.handleSetStartMessageCommand(fromId, chatId, text, message);
      return;
    }

    // 3b. Command: /setstartmedia or /clearstartmedia
    if (/^\/setstartmedia(?:@\w+)?(?:\s|$)/i.test(text)) {
      await this.handleSetStartMediaCommand(fromId, chatId, text, message);
      return;
    }
    if (/^\/clearstartmedia(?:@\w+)?(?:\s|$)/i.test(text)) {
      await this.handleClearStartMediaCommand(fromId, chatId);
      return;
    }

    // 4. Command: /setpassword
    if (/^\/setpassword(?:@\w+)?(?:\s|$)/i.test(text)) {
      await this.handleSetPasswordCommand(fromId, chatId, text);
      return;
    }

    // 5b. Additional Admin Commands in Private DM (/cleanup, /admins, /users, /broadcast, /settings, etc.)
    if (/^\/cleanup(?:@\w+)?(?:\s|$)/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can use <code>/cleanup</code>.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
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
        chat_id: chatId,
        text: `🧹 <b>Cleanup Complete</b>\n\n• <b>Removed Messages:</b> <code>${deletedCount}</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (/^\/(?:admins?|users?)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can view admin stats.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      const admins = await storage.getAdmins();
      const settings = await storage.getSettings();
      const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');
      const totalUsers = await storage.getTotalUserCount();
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `🛡️ <b>Administrators Overview</b>\n\n` +
          `• 👮 <b>Total Admins:</b> <code>${admins.length}</code>\n` +
          `• 🆔 <b>Root ID:</b> <code>${this.escapeHtml(rootAdminId)}</code>\n` +
          `• 👥 <b>Total Bot Users:</b> <code>${totalUsers}</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (/^\/broadcast(?:@\w+)?(?:\s|$)/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Broadcasting is restricted to authorized administrators only.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `📢 <b>Broadcast &amp; Mass Messaging</b>\n\n` +
          `Use the <b>Broadcast</b> feature inside the Web Admin Panel to send rich announcements, media, and targeted messages to all bot users.`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (/^\/(?:settings|config|setfilter|addfilter|delfilter|delfile|delete|del)(?:@\w+)?(?:\s|$)/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Configuration commands are restricted to authorized administrators only.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `⚙️ <b>Settings &amp; Management Guide</b>\n\n` +
          `• Add files, links, or triggers: <code>/add</code>\n` +
          `• Manage Force Sub channels: <code>/connect</code> / <code>/disconnect</code>\n` +
          `• Manage Chat Whitelist: <code>/allowchat</code> / <code>/ignorechat</code>\n` +
          `• Full Settings, Filter Rules &amp; File Deletion: Open the Web Admin Panel.\n\n` +
          `<i>Send <code>/help</code> to view the complete admin command guide.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // 5c. Bot Lifecycle & Memory Control Commands in Private DM (/botstart, /botstop, /botrestart, /botstatus, /memclean)
    if (/^\/(?:botstart|startbot|botstop|stopbot|botrestart|restartbot|botstatus|memclean|cleanmemory|clearcache)(?:@\w+)?(?:\s+|$)/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Bot lifecycle and memory commands are restricted to authorized administrators only.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.handleBotLifecycleCommand(fromId, chatId, text);
      return;
    }

    // 5c-bis. Link Delete On/Off Command (/linkdelete [on|off]) in Private DM
    if (/^\/linkdelete(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, message.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can configure Link Delete.</i>',
          parse_mode: 'HTML'
        });
        return;
      }
      await this.handleLinkDeleteToggleCommand(chatId, text);
      return;
    }

    // 5d. Owner-Only Admin Promotion / Revocation Commands (/grantadmin, /promote, /addadmin, /revokeadmin, /demote)
    if (/^\/(?:grantadmin|promote|addadmin|revokeadmin|demote|removeadmin|deladmin)(?:@\w+)?(?:\s+|$)/i.test(text)) {
      await this.handleOwnerGrantRevokeCommand(fromId, chatId, text, message);
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
      activeSetChannelSessions.delete(fromId);
      activeCloneSessions.delete(fromId);
      const addSession = activeAddSessions.get(fromId) || await storage.getAddSession(fromId);
      activeAddSessions.delete(fromId);
      await storage.deleteAddSession(fromId);
      activeEditSessions.delete(fromId);

      await this.deleteUserMessage(chatId, message?.message_id);

      const templates = await storage.getTemplates();
      const cancelMsg = templates.CANCEL_MESSAGE?.content || '❌ <b>Operation Cancelled</b>\n<i>Current action has been aborted.</i>';

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

      await this.callTelegramApi('sendMessage', { chat_id: chatId, text: cancelMsg, parse_mode: 'HTML' });
      return;
    }

    // 7a. Check if user is completing an interactive /clone owner assignment (Main bot & authorized admin only)
    const pendingClone = activeCloneSessions.get(fromId);
    if (pendingClone && !text.startsWith('/')) {
      if (!this.isMainBotContext() || !(await this.isAuthorizedAdmin(fromId, message.from?.username))) {
        activeCloneSessions.delete(fromId);
      } else {
        await this.completeInteractiveClone(chatId, fromId, pendingClone, text, message, false);
        return;
      }
    }

    // 7b. Check if user is inside an interactive /add session
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

        // Live Force Sub Check
        const forceCheck = await this.checkUserForceSub(fromId, message?.from?.username, { forceFresh: true });
        if (!forceCheck.allJoined) {
          await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, payload, undefined, message?.from);
          return;
        }

        await this.handleDeepLinkDelivery(chatId, payload, { skipForceSubCheck: true });
        return;
      }
    }

    // Live Force Sub check on any other direct user interactions in private chat
    const generalForceCheck = await this.checkUserForceSub(fromId, message?.from?.username, { forceFresh: true });
    if (!generalForceCheck.allJoined) {
      await this.sendForceSubPrompt(chatId, generalForceCheck.unjoinedChannels, 'start', undefined, message?.from);
      return;
    }
  }

  // =========================================================================
  // MULTI-LANGUAGE TRANSLATION SYSTEM (BD -> bn, IND -> hi, ENG -> en)
  // =========================================================================
  private static parseTranslationTrigger(text: string): {
    targetCode: 'bn' | 'hi' | 'en';
    label: string;
    inlineText: string;
  } | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;

    let rawLang = '';
    let inlineText = '';

    // Method A: `tran bd`, `translate eng`, `tr bn` (also supports optional inline text)
    const methodAMatch = trimmed.match(/^(?:tran(?:slate)?|tr)\s+(bd|bn|bangla|bengali|ind|hi|hindi|eng|en|english)(?:\s+([\s\S]+))?$/i);
    if (methodAMatch) {
      rawLang = methodAMatch[1].toLowerCase();
      inlineText = (methodAMatch[2] || '').trim();
    } else {
      // Method B: `/translate bd|ind|eng`, `/tran bd|ind|eng` (including @botusername suffix)
      const methodBCmdMatch = trimmed.match(/^\/(?:translate|tran)(?:@\w+)?\s+(bd|bn|bangla|bengali|ind|hi|hindi|eng|en|english)(?:\s+([\s\S]+))?$/i);
      if (methodBCmdMatch) {
        rawLang = methodBCmdMatch[1].toLowerCase();
        inlineText = (methodBCmdMatch[2] || '').trim();
      } else {
        // Method C: `/bd`, `/bn`, `/ind`, `/hi`, `/eng`, `/en`, `/bangla`, `/bengali`, `/hindi`, `/english`
        const methodBShortMatch = trimmed.match(/^\/(bd|bn|bangla|bengali|ind|hi|hindi|eng|en|english)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
        if (methodBShortMatch) {
          rawLang = methodBShortMatch[1].toLowerCase();
          inlineText = (methodBShortMatch[2] || '').trim();
        }
      }
    }

    if (!rawLang) return null;

    if (rawLang === 'bd' || rawLang === 'bn' || rawLang === 'bangla' || rawLang === 'bengali') {
      return { targetCode: 'bn', label: '🇧🇩 Bengali (BD)', inlineText };
    }
    if (rawLang === 'ind' || rawLang === 'hi' || rawLang === 'hindi') {
      return { targetCode: 'hi', label: '🇮🇳 Hindi (IND)', inlineText };
    }
    if (rawLang === 'eng' || rawLang === 'en' || rawLang === 'english') {
      return { targetCode: 'en', label: '🇬🇧 English (ENG)', inlineText };
    }

    return null;
  }

  private static translationCache = new Map<string, { text: string; expiresAt: number }>();

  // Unambiguous Romanized Bengali (Banglish) vocabulary for instant zero-false-positive detection
  private static readonly BANGLISH_CORE_WORDS = new Set<string>([
    'tumi', 'ami', 'apni', 'tui', 'tomar', 'amar', 'apnar', 'tor', 'amader', 'tomader', 'apnader',
    'amake', 'tomake', 'apnake', 'toke', 'oke', 'take', 'kake', 'amra', 'tomra', 'apnara', 'ora', 'tara',
    'kemon', 'kmn', 'acho', 'achi', 'achen', 'ache', 'achho', 'achhi', 'achhe', 'achhen', 'aso', 'asi', 'asen',
    'bhalo', 'valo', 'vlo', 'bhalobashi', 'valobashi', 'valobasi', 'kharap', 'sundor', 'onek', 'ektu', 'ekta', 'akta',
    'duita', 'tinta', 'charte', 'kothay', 'kothai', 'kotha', 'keno', 'kno', 'kobe', 'kemne', 'kivabe', 'kibhabe',
    'korcho', 'korchi', 'korbo', 'korben', 'korte', 'korle', 'korlen', 'korlam', 'kortesi', 'kortese', 'korche',
    'korso', 'korsi', 'korse', 'korsen', 'korecho', 'korechi', 'koreche', 'korechen', 'koro',
    'hobe', 'hochhe', 'hocche', 'hoise', 'hoice', 'hoilo', 'hoyeche', 'hoy', 'hoye', 'hobena',
    'jabo', 'jachhi', 'jacchi', 'jaitesi', 'jaitese', 'jao', 'jabe', 'jaben', 'jabona', 'gelam', 'geche', 'gese', 'gelo',
    'asho', 'ashbo', 'asbo', 'ashchi', 'aschi', 'ashtesi', 'ashtese', 'aslam', 'ashe', 'ashbe',
    'ekhon', 'ekhn', 'akhn', 'akhon', 'ekhono', 'akhono', 'tokhon', 'jokhon', 'kokhon',
    'ajke', 'kalke', 'khabo', 'khacho', 'khacchi', 'khaisi', 'khao', 'khete', 'khabar', 'khabona', 'bhat', 'vat',
    'lagbe', 'lagbena', 'lage', 'bujhlam', 'bujhchi', 'bujho', 'bujhte', 'bujhina',
    'janina', 'jano', 'jani', 'obostha', 'obosta', 'khobor', 'shokal', 'bikel', 'sondha',
    'taka', 'poisha', 'kichu', 'kisu', 'kichhu', 'nai', 'noi', 'chilo', 'chilam', 'chile', 'chilen',
    'dorkar', 'shob', 'shobai', 'sobai', 'shomoy', 'somoy', 'barite', 'ghore', 'desh', 'bangla', 'bangladesh',
    'naki', 'ebong', 'kintu', 'jodi', 'tahole', 'tarpor', 'ekhane', 'okhane', 'sekhane', 'shekhane',
    'sheta', 'seta', 'eta', 'ota', 'jeta', 'shei', 'bhaiya', 'vaiya', 'dada', 'apu',
    'parbo', 'parchi', 'parina', 'parbona', 'paro', 'paren', 'parbe',
    'dekhbo', 'dekhchi', 'dekho', 'dekhen', 'dekhsi', 'dekhlam', 'dekhechi',
    'bolo', 'bolcho', 'bolchi', 'bolbo', 'bolben', 'bolsi', 'bollam', 'bolechi',
    'shuno', 'suno', 'shuncho', 'shunchi', 'dilam', 'dao', 'dibo', 'disi', 'dise', 'diyechi',
    'nilam', 'nibo', 'nisi', 'nise', 'niyechi', 'pabo', 'pailam', 'paisi', 'paisen', 'peyechi',
    'shotti', 'sotti', 'mittha', 'bhul', 'vul', 'thakbo', 'thako', 'thakbe', 'thakbena',
    'brishti', 'bristi', 'khela', 'ghumabo', 'bondhu', 'jonno', 'jonyo', 'theke', 'shathe', 'asole', 'ekdom'
  ]);

  // Distinct Romanized Hindi (Hinglish) markers
  private static readonly HINGLISH_CORE_WORDS = new Set<string>([
    'kaise', 'kaisa', 'kaisi', 'kya', 'haal', 'hain', 'hoon', 'hun', 'tum', 'tumhara', 'tumhari',
    'mera', 'meri', 'tera', 'teri', 'karna', 'raha', 'rahi', 'rahe', 'nahi', 'nhi',
    'achha', 'accha', 'bahut', 'bohot', 'yaar', 'abhi', 'kahan', 'kidhar', 'kyun', 'kyu',
    'kaun', 'kitna', 'batao', 'samjhe', 'samjha', 'pyar', 'duniya', 'paise', 'matlab'
  ]);

  // Normalize frequent BD chat shorthands into clearer phonetic Banglish for accurate transliteration
  private static readonly BANGLISH_SHORTHAND_MAP: Record<string, string> = {
    kmn: 'kemon',
    vlo: 'bhalo',
    valo: 'bhalo',
    valobashi: 'bhalobashi',
    valobasi: 'bhalobashi',
    ekhn: 'ekhon',
    akhn: 'ekhon',
    akhon: 'ekhon',
    ekhono: 'ekhono',
    akhono: 'ekhono',
    kisu: 'kichu',
    kichhu: 'kichu',
    hoise: 'hoyeche',
    hoice: 'hoyeche',
    hoilo: 'holo',
    disi: 'diyechi',
    dise: 'diyeche',
    nisi: 'niyechi',
    nise: 'niyeche',
    asi: 'achi',
    aso: 'acho',
    asen: 'achen',
    kortesi: 'korchi',
    kortese: 'korche',
    jaitesi: 'jachhi',
    jaitese: 'jachhe',
    ashtesi: 'aschhi',
    ashtese: 'aschhe',
    ashbo: 'asbo',
    vai: 'bhai',
    vaiya: 'bhaiya',
    vul: 'bhul',
    vat: 'bhat',
    vabe: 'bhabe',
    kivabe: 'kibhabe',
    kn: 'keno',
    kno: 'keno',
    gese: 'geche',
    paisi: 'peyechi',
    paisen: 'peyechhen',
    khaisi: 'kheyechi',
    bolsi: 'bolechi',
    dekhsi: 'dekhechi',
    korso: 'korecho',
    korsen: 'korechen',
    korsi: 'korechi',
    korse: 'koreche',
    parina: 'pari na',
    parbona: 'parbo na',
    janina: 'jani na',
    bujhina: 'bujhi na',
    khabona: 'khabo na',
    jabona: 'jabo na',
    korbona: 'korbo na',
    hobena: 'hobe na',
    lagbena: 'lagbe na',
    thakbena: 'thakbe na'
  };

  private static detectPhoneticIndic(text: string): {
    isBanglish: boolean;
    isHinglish: boolean;
    hasBengaliScript: boolean;
    hasDevanagariScript: boolean;
    hasLatin: boolean;
  } {
    const hasBengaliScript = /[\u0980-\u09FF]/.test(text);
    const hasDevanagariScript = /[\u0900-\u097F]/.test(text);
    const stripped = text
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/@\w+/g, ' ')
      .replace(/#\w+/g, ' ');
    const hasLatin = /[a-zA-Z]/.test(stripped);
    if (!hasLatin) {
      return { isBanglish: false, isHinglish: false, hasBengaliScript, hasDevanagariScript, hasLatin };
    }

    const words = stripped.toLowerCase().match(/[a-z]+/g) || [];
    let banglishHits = 0;
    let hinglishHits = 0;

    for (const w of words) {
      if (this.BANGLISH_CORE_WORDS.has(w)) {
        banglishHits += 2;
      } else if (w === 'vai' || w === 'mon' || w === 'thik') {
        banglishHits += 1;
      } else if (/(?:tesi|tese|chhi|chho|chhe)$/.test(w) && w.length >= 5) {
        banglishHits += 2;
      }
      if (this.HINGLISH_CORE_WORDS.has(w)) {
        hinglishHits += 2;
      }
    }

    // Also detect classic Bengali negation clause "<verb> na" (e.g. "jabo na", "khai na", "kori na")
    if (/\b(?:jabo|khabo|korbo|parbo|bolbo|dekhbo|ashbo|thakbo|hobe|lagbe|pari|jani|bujhi|kori|khai|jai|bol|dekh)\s+na\b/i.test(stripped)) {
      banglishHits += 2;
    }

    const isBanglish = !hasBengaliScript && !hasDevanagariScript && banglishHits >= 2 && banglishHits > hinglishHits;
    const isHinglish = !hasBengaliScript && !hasDevanagariScript && !isBanglish && hinglishHits >= 2;

    return { isBanglish, isHinglish, hasBengaliScript, hasDevanagariScript, hasLatin };
  }

  private static normalizeBanglishShorthand(text: string): string {
    // Protect URLs, @mentions, and #hashtags while normalizing casual Banglish words
    const tokens = text.split(/(https?:\/\/\S+|@\w+|#\w+)/gi);
    return tokens
      .map((seg, idx) => {
        if (idx % 2 === 1) return seg;
        return seg.replace(/\b[a-zA-Z]+\b/g, (word) => {
          const replacement = this.BANGLISH_SHORTHAND_MAP[word.toLowerCase()];
          return replacement || word;
        });
      })
      .join('');
  }

  private static async requestGoogleInputTools(text: string, itc: 'bn-t-i0-und' | 'hi-t-i0-und'): Promise<string | null> {
    const clean = text.trim();
    if (!clean) return text;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const url = `https://inputtools.google.com/request?text=${encodeURIComponent(clean)}&itc=${itc}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      if (data?.[0] !== 'SUCCESS' || !Array.isArray(data?.[1])) return null;
      const converted = data[1]
        .map((item: any) => {
          const candidate = Array.isArray(item?.[1]) && typeof item[1][0] === 'string' ? item[1][0] : '';
          return candidate || (typeof item?.[0] === 'string' ? item[0] : '');
        })
        .join(' ')
        .trim();
      return converted || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static async transliteratePhoneticText(text: string, itc: 'bn-t-i0-und' | 'hi-t-i0-und'): Promise<string | null> {
    const lines = text.split('\n');
    const convertedLines: string[] = [];
    let anyConverted = false;

    for (const line of lines) {
      if (!line.trim() || !/[a-zA-Z]/.test(line)) {
        convertedLines.push(line);
        continue;
      }

      // Split around URLs, @mentions, #hashtags, and non-Latin punctuation so formatting stays intact
      const parts = line.split(/(https?:\/\/\S+|@\w+|#\w+|[^a-zA-Z\s]+)/gi);
      const outParts: string[] = [];

      for (const part of parts) {
        if (!part) continue;
        if (/^(?:https?:\/\/\S+|@\w+|#\w+)$/i.test(part) || !/[a-zA-Z]/.test(part)) {
          outParts.push(part);
          continue;
        }
        const leadWs = part.match(/^\s*/)?.[0] || '';
        const trailWs = part.match(/\s*$/)?.[0] || '';
        const core = part.trim();
        if (!core) {
          outParts.push(part);
          continue;
        }

        const subChunks = this.splitTextChunks(core, 280);
        const convertedChunks: string[] = [];
        for (const sub of subChunks) {
          const conv = await this.requestGoogleInputTools(sub, itc);
          if (conv && conv !== sub) {
            anyConverted = true;
            convertedChunks.push(conv);
          } else {
            convertedChunks.push(sub);
          }
        }
        outParts.push(leadWs + convertedChunks.join(' ') + trailWs);
      }

      convertedLines.push(outParts.join(''));
    }

    return anyConverted ? convertedLines.join('\n') : null;
  }

  private static isVirtuallyUnchanged(input: string, output: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF\u0900-\u097F]+/g, '');
    const a = norm(input);
    const b = norm(output);
    return Boolean(a && b && a === b);
  }

  private static splitTextChunks(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxLen) {
      let cut = remaining.lastIndexOf('\n', maxLen);
      if (cut < Math.floor(maxLen * 0.4)) {
        cut = remaining.lastIndexOf(' ', maxLen);
      }
      if (cut < Math.floor(maxLen * 0.4)) {
        cut = maxLen;
      }
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).replace(/^\s+/, '');
    }
    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
  }

  private static async translateWithGoogleClient(
    chunk: string,
    targetCode: 'bn' | 'hi' | 'en',
    client: 'at' | 'it' | 'gtx',
    sourceLang: string = 'auto'
  ): Promise<{ ok: boolean; text?: string; detectedLang?: string; retryable?: boolean; status?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const userAgent =
        client === 'gtx'
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          : 'GoogleTranslate/6.29.59279 (Linux; U; Android 11; Pixel 5)';
      const url = `https://translate.googleapis.com/translate_a/single?client=${client}&dt=t`;
      const body = new URLSearchParams({ sl: sourceLang, tl: targetCode, q: chunk }).toString();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
        },
        body,
        signal: controller.signal
      });
      if (!res.ok) {
        return { ok: false, retryable: res.status === 429 || res.status >= 500, status: res.status };
      }
      const data: any = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const joined = data[0]
          .map((seg: any) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
          .join('')
          .trim();
        const detectedLang = typeof data[2] === 'string' ? data[2].toLowerCase() : undefined;
        if (joined) return { ok: true, text: joined, detectedLang };
      }
      return { ok: false, retryable: false, status: res.status };
    } catch (err: any) {
      return { ok: false, retryable: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private static async translateWithGooglePipeline(
    text: string,
    targetCode: 'bn' | 'hi' | 'en',
    sourceLang: string = 'auto'
  ): Promise<{ text: string; detectedLang?: string } | null> {
    const lines = text.split('\n');
    const outLines: string[] = [];
    let firstDetectedLang: string | undefined;

    for (const line of lines) {
      if (!line.trim()) {
        outLines.push('');
        continue;
      }

      const googleChunks = this.splitTextChunks(line, 4000);
      const translatedChunks: string[] = [];

      for (const chunk of googleChunks) {
        const clients: Array<'at' | 'it' | 'gtx'> = ['at', 'it', 'gtx'];
        let chunkResult: { text: string; detectedLang?: string } | null = null;

        for (let i = 0; i < clients.length; i++) {
          const client = clients[i];
          for (let attempt = 0; attempt < 2; attempt++) {
            const res = await this.translateWithGoogleClient(chunk, targetCode, client, sourceLang);
            if (res.ok && res.text) {
              chunkResult = { text: res.text, detectedLang: res.detectedLang };
              break;
            }
            if (!res.retryable) break;
            if (attempt === 0) {
              const backoffMs = 200 * Math.pow(2, i) + Math.floor(Math.random() * 120);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
          if (chunkResult) break;
        }

        if (!chunkResult) {
          return null;
        }
        if (!firstDetectedLang && chunkResult.detectedLang) {
          firstDetectedLang = chunkResult.detectedLang;
        }
        translatedChunks.push(chunkResult.text);
      }

      outLines.push(translatedChunks.join(' '));
    }

    const joined = outLines.join('\n').trim();
    return joined ? { text: joined, detectedLang: firstDetectedLang } : null;
  }

  private static async translateWithMyMemoryChunk(
    chunk: string,
    targetCode: 'bn' | 'hi' | 'en',
    sourceLang: string = 'autodetect'
  ): Promise<string | null> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetCode)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
            continue;
          }
          return null;
        }
        if (!res.ok) return null;

        const data: any = await res.json();
        const responseStatus = Number(data?.responseStatus);
        const details = String(data?.responseDetails || '').toUpperCase();
        const translated = typeof data?.responseData?.translatedText === 'string'
          ? data.responseData.translatedText.trim()
          : '';

        // Same language selected (e.g. translating English text to ENG) -> source text is already in target language
        if (details.includes('SELECT TWO DISTINCT LANGUAGES')) {
          return chunk;
        }

        const isErrorBanner =
          !translated ||
          translated.toUpperCase().includes('MYMEMORY WARNING') ||
          translated.toUpperCase().includes('QUERY LENGTH LIMIT') ||
          translated.toUpperCase().includes('INVALID LANGUAGE PAIR') ||
          translated.toUpperCase().includes('PLEASE SELECT TWO DISTINCT LANGUAGES');

        if (responseStatus === 200 && !isErrorBanner) {
          return translated;
        }
        return null;
      } catch {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * Math.pow(2, attempt)));
          continue;
        }
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  private static async translateText(sourceText: string, targetCode: 'bn' | 'hi' | 'en'): Promise<string | null> {
    const cleanText = sourceText.trim();
    if (!cleanText) return null;

    const cacheKey = `v2:${targetCode}:${cleanText}`;
    const cached = this.translationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.text;
    }

    const rememberResult = (val: string) => {
      if (this.translationCache.size >= 300) {
        const oldestKey = this.translationCache.keys().next().value;
        if (oldestKey) this.translationCache.delete(oldestKey);
      }
      this.translationCache.set(cacheKey, { text: val, expiresAt: Date.now() + 10 * 60 * 1000 });
      return val;
    };

    const phoneticInfo = this.detectPhoneticIndic(cleanText);
    let workingText = cleanText;
    let effectiveSourceLang: string = 'auto';
    let transliteratedLocally = false;

    // 1. Pre-detect phonetic Bengali written in English letters (Banglish)
    if (phoneticInfo.isBanglish) {
      const normalized = this.normalizeBanglishShorthand(cleanText);
      const transliteratedBn = await this.transliteratePhoneticText(normalized, 'bn-t-i0-und');
      if (transliteratedBn && /[\u0980-\u09FF]/.test(transliteratedBn)) {
        if (targetCode === 'bn') {
          return rememberResult(transliteratedBn);
        }
        workingText = transliteratedBn;
        effectiveSourceLang = 'bn';
        transliteratedLocally = true;
      }
    }

    // Tier 1: Google Translate POST with client rotation (at -> it -> gtx) + exponential backoff
    try {
      const primaryResult = await this.translateWithGooglePipeline(workingText, targetCode, effectiveSourceLang);
      if (primaryResult?.text) {
        // Safety net: if source was Latin-script Banglish/Hinglish not caught by lexicon,
        // Google often detects 'bn'/'hi' while echoing the original Latin words unchanged.
        if (
          !transliteratedLocally &&
          phoneticInfo.hasLatin &&
          !phoneticInfo.hasBengaliScript &&
          !phoneticInfo.hasDevanagariScript &&
          this.isVirtuallyUnchanged(cleanText, primaryResult.text)
        ) {
          if (primaryResult.detectedLang === 'bn') {
            const normalized = this.normalizeBanglishShorthand(cleanText);
            const fallbackBn = await this.transliteratePhoneticText(normalized, 'bn-t-i0-und');
            if (fallbackBn && /[\u0980-\u09FF]/.test(fallbackBn)) {
              if (targetCode === 'bn') {
                return rememberResult(fallbackBn);
              }
              const retranslated = await this.translateWithGooglePipeline(fallbackBn, targetCode, 'bn');
              if (retranslated?.text) {
                return rememberResult(retranslated.text);
              }
              workingText = fallbackBn;
              effectiveSourceLang = 'bn';
            }
          } else if (primaryResult.detectedLang === 'hi' || phoneticInfo.isHinglish) {
            const fallbackHi = await this.transliteratePhoneticText(cleanText, 'hi-t-i0-und');
            if (fallbackHi && /[\u0900-\u097F]/.test(fallbackHi)) {
              if (targetCode === 'hi') {
                return rememberResult(fallbackHi);
              }
              const retranslated = await this.translateWithGooglePipeline(fallbackHi, targetCode, 'hi');
              if (retranslated?.text) {
                return rememberResult(retranslated.text);
              }
              workingText = fallbackHi;
              effectiveSourceLang = 'hi';
            }
          }
        }

        // Only return primaryResult if we didn't fall through after upgrading workingText
        if (effectiveSourceLang === 'auto' || transliteratedLocally) {
          return rememberResult(primaryResult.text);
        }
      }
    } catch (err: any) {
      console.warn('[Translate] Google pipeline notice:', err?.message || err);
    }

    // Tier 2: Chunked MyMemory API fallback (up to 450 chars per chunk)
    try {
      const mmSourceLang = effectiveSourceLang === 'auto' ? 'autodetect' : effectiveSourceLang;
      const mmChunks = this.splitTextChunks(workingText, 450);
      const translatedChunks: string[] = [];
      let allMmSucceeded = true;

      for (const chunk of mmChunks) {
        const translatedChunk = await this.translateWithMyMemoryChunk(chunk, targetCode, mmSourceLang);
        if (!translatedChunk) {
          allMmSucceeded = false;
          break;
        }
        translatedChunks.push(translatedChunk);
      }

      if (allMmSucceeded && translatedChunks.length > 0) {
        return rememberResult(translatedChunks.join('\n'));
      }
    } catch (err: any) {
      console.warn('[Translate] Fallback MyMemory notice:', err?.message || err);
    }

    return null;
  }

  private static async handleTranslationCommand(message: any, text: string, isGroup: boolean): Promise<boolean> {
    const parsed = this.parseTranslationTrigger(text);
    if (!parsed) return false;

    const chatId = message.chat?.id;
    if (!chatId) return true;

    const replied = message.reply_to_message;
    const targetSourceText = (parsed.inlineText || replied?.text || replied?.caption || '').trim();

    if (!targetSourceText) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `ℹ️ <b>Translation Usage:</b>\nReply to any text message with:\n• <code>tran bd</code> / <code>tran ind</code> / <code>tran eng</code>\n• <code>/bd</code> / <code>/ind</code> / <code>/eng</code>\n• <code>/translate bd</code> / <code>/translate ind</code> / <code>/translate eng</code>`,
        parse_mode: 'HTML',
        reply_to_message_id: message.message_id,
        ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
      });
      return true;
    }

    this.callTelegramApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

    const translated = await this.translateText(targetSourceText, parsed.targetCode);
    if (!translated) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ Translation service is temporarily busy. Please try again in a moment.',
        parse_mode: 'HTML',
        reply_to_message_id: replied?.message_id || message.message_id,
        ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
      });
      return true;
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: this.escapeHtml(translated),
      parse_mode: 'HTML',
      reply_to_message_id: replied?.message_id || message.message_id,
      ...(isGroup && message.message_thread_id ? { message_thread_id: message.message_thread_id } : {})
    });
    return true;
  }

  // =========================================================================
  // PRIVATE DELIVERY FLOW (ZERO-LATENCY INSTANT DISPATCH)
  // =========================================================================
  public static async handleDeepLinkDelivery(
    chatId: string | number,
    rawPayload: string,
    options: { includeBackButton?: boolean; messageIdToEdit?: number; skipForceSubCheck?: boolean } = {}
  ): Promise<void> {
    if (!rawPayload) return;

    // Asynchronously record recipient UID without blocking delivery response
    const strChatId = String(chatId || '').trim();
    if (strChatId && !strChatId.startsWith('-') && Number(strChatId) > 0) {
      storage.trackBotUser({ id: chatId }).catch(() => {});
    }

    // Deduplication check for retried webhooks
    if (isDuplicateDelivery(chatId, rawPayload)) {
      console.info('[Telegram] Skipping duplicate delivery for chat:', chatId, 'payload:', rawPayload);
      return;
    }

    // Mandatory Channel Join (Force Sub) live check (skipped when just verified by /start or forcesub_verify caller)
    if (!options?.skipForceSubCheck) {
      const forceCheck = await this.checkUserForceSub(chatId, undefined, { forceFresh: true });
      if (!forceCheck.allJoined) {
        await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, rawPayload);
        return;
      }
    }

    const cleanPayload = rawPayload.trim();
    const normalizedId = cleanPayload.replace(/^(?:f_|l_)+/, '');

    // Super-fast 0ms in-memory item resolution
    let item: ItemRecord | null = (storage as any).resolveItemFast ? (storage as any).resolveItemFast(cleanPayload) : null;
    if (!item) {
      const allItems = await storage.getItems();
      const lowerClean = cleanPayload.toLowerCase();
      item = allItems.find(i =>
        i.id === cleanPayload ||
        i.id === normalizedId ||
        i.id === `f_${normalizedId}` ||
        i.id === `l_${normalizedId}` ||
        (i.rawKeyword && i.rawKeyword.toLowerCase() === lowerClean) ||
        (Array.isArray(i.triggers) && i.triggers.some(t => t.trim().toLowerCase() === lowerClean || t.trim().toLowerCase() === `#${lowerClean}` || t.trim().toLowerCase() === `/${lowerClean}`))
      ) || null;
    }

    if (!item || item.status !== 'active') {
      console.warn('[Telegram] Item not found or inactive for payload:', cleanPayload);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Item Not Found</b>\n<i>The requested file or link is no longer active.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    // SETUP VIDEO SYSTEM (Admin Panel & Bot Delivery)
    const isSetupVideoActive = Boolean(item.hasSetupVideo === true && item.setupVideoUrl && String(item.setupVideoUrl).trim().length > 0);

    if (!options?.includeBackButton && isSetupVideoActive) {
      await this.sendSetupVideoMenu(chatId, item, options?.messageIdToEdit);
      return;
    }

    const backKeyboard = (options?.includeBackButton && isSetupVideoActive) ? {
      inline_keyboard: [
        [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
      ]
    } : undefined;

    const isTextOnlyItem = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));

    // Delete previous interactive menu message in background if editing is requested
    if (options?.messageIdToEdit) {
      this.callTelegramApi('deleteMessage', {
        chat_id: chatId,
        message_id: options.messageIdToEdit
      }).catch(() => {});
    }

    // Immediately send "⏳ Preparing Delivery..." notice and capture its promise for cleanup in finally
    const deliveringMsgPromise =
      item.type === 'file' && !isTextOnlyItem && !options?.messageIdToEdit
        ? this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: '⏳ <b>Preparing Delivery...</b>\n<i>Fetching your requested file, please wait a moment.</i>',
            parse_mode: 'HTML'
          }).catch(() => null)
        : null;

    // Trigger instant chat action in background (zero blocking)
    const chatAction = item.type === 'file' && !isTextOnlyItem
      ? (item.fileType === 'video' ? 'upload_video' : item.fileType === 'photo' ? 'upload_photo' : 'upload_document')
      : 'typing';
    this.callTelegramApi('sendChatAction', {
      chat_id: chatId,
      action: chatAction
    }).catch(() => {});

    try {
      if (isTextOnlyItem) {
        const messageText = item.replyMessage || item.caption || item.name;
        let res: any = null;

        if (options?.messageIdToEdit) {
          try {
            res = await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: options.messageIdToEdit,
              text: messageText,
              parse_mode: 'HTML',
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res || !res.ok) {
              res = await this.callTelegramApi('editMessageText', {
                chat_id: chatId,
                message_id: options.messageIdToEdit,
                text: messageText,
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } catch {}
        }

        if (!res || !res.ok) {
          res = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML',
            ...(backKeyboard ? { reply_markup: backKeyboard } : {})
          });
          if (!res || !res.ok) {
            res = await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: messageText,
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
          }
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered Only-Text response to chat:', chatId, 'item:', item.id);
          storage.incrementItemDelivery(item.id).catch(() => {});

          const deliveredMessageId = res.result?.message_id;
          if (deliveredMessageId) {
            storage.recordChatDeliveryMessage(chatId, deliveredMessageId).catch(() => {});

            try {
              const settings = await storage.getSettings();
              const autoDeleteEnabled = settings.autoDeleteDeliveryEnabled !== false;
              const timeoutMinutes = settings.deliveryTimeoutMinutes || 10;

              let companionNoticeId: number | undefined = undefined;
              if (autoDeleteEnabled && settings.autoDeleteNoticeEnabled) {
                const noticeRes = await this.callTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ <i>This message will automatically self-destruct in ${timeoutMinutes} ${timeoutMinutes === 1 ? 'minute' : 'minutes'}.</i>`,
                  parse_mode: 'HTML'
                });
                if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
                  companionNoticeId = Number(noticeRes.result.message_id);
                  storage.recordChatDeliveryMessage(chatId, companionNoticeId).catch(() => {});
                }
              }

              if (autoDeleteEnabled) {
                const sched = await storage.scheduleMessageDeletion({
                  chatId: String(chatId),
                  messageId: deliveredMessageId,
                  companionNoticeId,
                  timeoutMinutes,
                  itemTitle: item.name || 'text message'
                });
                TelegramService.armScheduledDeletionTimer(sched);
              }
            } catch (schedErr) {
              console.warn('[Telegram] Could not schedule message auto-delete for text:', schedErr);
            }
          }
        } else {
          console.warn('[Telegram] Only-Text delivery failed:', res?.description);
        }
      } else if (item.type === 'file') {
        const caption = item.caption ? item.caption : undefined;
        let fileIdOrUrl = item.telegramFileId || item.url;

        const isLocalIdentifier = Boolean(fileIdOrUrl && (
          fileIdOrUrl.startsWith('upload_') || 
          fileIdOrUrl.startsWith('local_') || 
          fileIdOrUrl.startsWith('phone_')
        ));

        // Helper to lazily load uploaded buffer ONLY if needed (eliminates latency when telegramFileId is already cached)
        const loadUploadedFileBuffer = async () => {
          const uploadRef = item!.uploadedFileId || item!.telegramFileId || item!.id;
          let uf = uploadRef ? await storage.getUploadedFile(uploadRef) : null;
          if (!uf && item!.id) {
            uf = await storage.getUploadedFile(item!.id);
          }
          if (!uf && item!.telegramFileId) {
            uf = await storage.getUploadedFile(item!.telegramFileId);
          }
          if (!uf && item!.fileBase64) {
            try {
              const buf = Buffer.from(item!.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
              uf = {
                id: item!.uploadedFileId || item!.id,
                fileName: item!.fileName || item!.name || 'file',
                fileType: item!.fileType || 'document',
                mimeType: item!.mimeType || 'application/octet-stream',
                size: buf.length,
                buffer: buf,
                createdAt: item!.createdAt
              };
            } catch {}
          }
          if (!uf && item!.url && item!.url.startsWith('data:')) {
            try {
              const matches = item!.url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                const buf = Buffer.from(matches[2], 'base64');
                uf = {
                  id: item!.id,
                  fileName: item!.fileName || item!.name,
                  fileType: item!.fileType || 'document',
                  mimeType: matches[1],
                  size: buf.length,
                  buffer: buf,
                  createdAt: item!.createdAt
                };
              }
            } catch {}
          }
          return uf;
        };

        let uploadedFile = (isLocalIdentifier || !fileIdOrUrl) ? await loadUploadedFileBuffer() : null;

        let res: any = null;

        // Priority 1: If it's a local upload ID and we have the uploaded file buffer, deliver directly via multipart!
        if (isLocalIdentifier && uploadedFile) {
          console.info('[Telegram] Delivering uploaded file directly via multipart buffer to chat:', chatId, 'file:', uploadedFile.fileName);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
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
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else if (item.fileType === 'video') {
            res = await this.callTelegramApi('sendVideo', {
              chat_id: chatId,
              video: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else if (item.fileType === 'audio') {
            res = await this.callTelegramApi('sendAudio', {
              chat_id: chatId,
              audio: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
            if (!res.ok) {
              res = await this.callTelegramApi('sendDocument', {
                chat_id: chatId,
                document: fileIdOrUrl,
                ...(caption ? { caption } : {}),
                ...(backKeyboard ? { reply_markup: backKeyboard } : {})
              });
            }
          } else {
            res = await this.callTelegramApi('sendDocument', {
              chat_id: chatId,
              document: fileIdOrUrl,
              ...(caption ? { caption } : {}),
              ...(backKeyboard ? { reply_markup: backKeyboard } : {})
            });
          }

          // Fallback if Telegram API rejected remote file_id, lazily load local uploaded buffer if available
          if (!res || !res.ok) {
            if (!uploadedFile) {
              uploadedFile = await loadUploadedFileBuffer();
            }
            if (uploadedFile) {
              console.warn('[Telegram] Remote file_id rejected by Telegram, falling back to direct buffer delivery:', res?.description);
              res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
              if (res && res.ok) {
                const realFileId = res.result?.document?.file_id || 
                  (res.result?.photo && res.result.photo[res.result.photo.length - 1]?.file_id) ||
                  res.result?.video?.file_id ||
                  res.result?.audio?.file_id;
                if (realFileId) {
                  item.telegramFileId = realFileId;
                  item.uploadedFileId = uploadedFile.id;
                  storage.saveItem(item).catch(() => {});
                }
              }
            }
          }
        } else if (uploadedFile) {
          // Priority 3: No fileIdOrUrl specified but uploadedFile buffer is available
          console.info('[Telegram] Delivering uploaded file directly to chat:', chatId);
          res = await TelegramService.uploadAndDeliverDirectly(chatId, uploadedFile, caption, backKeyboard);
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
            // Fresh Chat: Record the delivered file message for auto-cleanup on future delivery
            await storage.recordChatDeliveryMessage(chatId, deliveredMessageId);

            try {
              const settings = await storage.getSettings();
              const autoDeleteEnabled = settings.autoDeleteDeliveryEnabled !== false;
              const timeoutMinutes = settings.deliveryTimeoutMinutes || 10;

              let companionNoticeId: number | undefined = undefined;
              if (autoDeleteEnabled && settings.autoDeleteNoticeEnabled) {
                const noticeRes = await this.callTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ <i>This file will automatically self-destruct in ${timeoutMinutes} ${timeoutMinutes === 1 ? 'minute' : 'minutes'}. Please save or forward it now.</i>`,
                  parse_mode: 'HTML'
                });
                if (noticeRes && noticeRes.ok && noticeRes.result?.message_id) {
                  companionNoticeId = Number(noticeRes.result.message_id);
                  await storage.recordChatDeliveryMessage(chatId, companionNoticeId);
                }
              }

              if (autoDeleteEnabled) {
                // Persist scheduled deletion record so it strictly survives restarts and process crashes
                const sched = await storage.scheduleMessageDeletion({
                  chatId: String(chatId),
                  messageId: deliveredMessageId,
                  companionNoticeId,
                  timeoutMinutes,
                  itemTitle: item.fileName || item.name || 'file'
                });

                // Arm immediate in-memory timer
                TelegramService.armScheduledDeletionTimer(sched);
                console.info(`[Telegram] Armed ${timeoutMinutes}-minute auto-delete timer for delivered file message ${deliveredMessageId} in chat ${chatId}`);
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
            text: `⚠️ <b>Delivery Failed</b>\n\n• 📁 <b>File:</b> <code>${this.escapeHtml(item.fileName || item.name || 'File')}</code>\n• ℹ️ <b>Notice:</b> <code>${this.escapeHtml(errorDetail)}</code>\n\n💡 <i>Tip: Re-upload this file in the Admin Panel.</i>`,
            parse_mode: 'HTML'
          });
        }
      } else if (item.type === 'link') {
        const messageText = item.replyMessage || `🔗 <b>${this.escapeHtml(item.name)}</b>`;
        const buttonText = (item.buttonText && item.buttonText.trim()) || (item.openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link');

        const isHttps = /^https:\/\//i.test(item.url || '');
        const canUseWebApp = item.openMode === 'webapp' && isHttps;

        const inlineButton: any = { text: buttonText, style: 'primary' };
        if (canUseWebApp) {
          inlineButton.web_app = { url: item.url };
        } else {
          inlineButton.url = item.url;
        }

        const linkKeyboardRows: any[][] = [[inlineButton]];
        if (options?.includeBackButton && isSetupVideoActive) {
          linkKeyboardRows.push([{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]);
        }

        let res: any = null;
        if (options?.messageIdToEdit) {
          try {
            res = await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: options.messageIdToEdit,
              text: messageText,
              reply_markup: {
                inline_keyboard: linkKeyboardRows
              }
            });
          } catch {}
        }

        if (!res || !res.ok) {
          res = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: messageText,
            reply_markup: {
              inline_keyboard: linkKeyboardRows
            }
          });
        }

        // If Telegram rejected web_app button, fallback immediately to regular url button
        if ((!res || !res.ok) && canUseWebApp) {
          console.warn('[Telegram] web_app button delivery rejected, falling back to regular url:', res?.description);
          const fallbackRows: any[][] = [[{ text: buttonText, url: item.url, style: 'primary' }]];
          if (options?.includeBackButton && isSetupVideoActive) {
            fallbackRows.push([{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]);
          }
          if (options?.messageIdToEdit) {
            try {
              res = await this.callTelegramApi('editMessageText', {
                chat_id: chatId,
                message_id: options.messageIdToEdit,
                text: messageText,
                reply_markup: {
                  inline_keyboard: fallbackRows
                }
              });
            } catch {}
          }
          if (!res || !res.ok) {
            res = await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: messageText,
              reply_markup: {
                inline_keyboard: fallbackRows
              }
            });
          }
        }

        if (res && res.ok) {
          console.info('[Telegram] Successfully delivered link privately to chat:', chatId, 'item:', item.id);
          await storage.incrementItemDelivery(item.id);
          if (res.result?.message_id) {
            await storage.recordChatDeliveryMessage(chatId, res.result.message_id);
          }
        } else {
          console.warn('[Telegram] Telegram link delivery API failed, sending fallback text:', res?.description);
          const fallbackRes = await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `${messageText}\n\n👉 ${item.url}`
          });
          if (fallbackRes && fallbackRes.ok && fallbackRes.result?.message_id) {
            await storage.recordChatDeliveryMessage(chatId, fallbackRes.result.message_id);
          }
          await storage.incrementItemDelivery(item.id);
        }
      }
    } catch (err: any) {
      console.error('[Telegram] Error in delivery execution:', err?.message || err);
    } finally {
      if (deliveringMsgPromise) {
        try {
          const statusRes = await deliveringMsgPromise;
          const statusMsgId = statusRes?.ok ? Number(statusRes.result?.message_id) : undefined;
          if (statusMsgId) {
            await this.callTelegramApi('deleteMessage', {
              chat_id: chatId,
              message_id: statusMsgId
            }).catch(() => {});
          }
        } catch {}
      }
    }
  }

  // =========================================================================
  // SETUP VIDEO SYSTEM (Two-Button Interactive Menu & Video Delivery)
  // =========================================================================
  public static async sendSetupVideoMenu(
    chatId: string | number,
    item: ItemRecord,
    messageIdToEdit?: number
  ): Promise<void> {
    const defaultText = `🎬 <b>Setup Video &amp; Resource Menu</b>\n\n• 📦 <b>Item:</b> <code>${this.escapeHtml(item.name)}</code>\n\n<i>Choose an option below to watch the setup tutorial or access your ${item.type === 'file' ? 'file' : 'link'}:</i>`;
    const text = item.setupVideoMessage?.trim() || defaultText;
    const keyboard = {
      inline_keyboard: [
        [
          { text: item.setupVideoButtonText?.trim() || '🎬 Setup Video', callback_data: `sv_vid_${item.id}`, style: 'primary' },
          { text: item.setupResourceButtonText?.trim() || (item.type === 'file' ? '📁 Get File' : '🔗 Open Link'), callback_data: `sv_item_${item.id}`, style: 'primary' }
        ]
      ]
    };

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text,
          parse_mode: 'HTML',
          reply_markup: keyboard
        });
        if (editRes && editRes.ok) return;
        // If edit failed (for example, previous message was media), delete it before sending fresh message
        await this.callTelegramApi('deleteMessage', {
          chat_id: chatId,
          message_id: messageIdToEdit
        }).catch(() => {});
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  public static async deliverSetupVideo(
    chatId: string | number,
    item: ItemRecord,
    messageIdToEdit?: number
  ): Promise<void> {
    const backKeyboard = {
      inline_keyboard: [
        [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
      ]
    };

    if (!item.setupVideoUrl) {
      const noVidText = `⚠️ <b>No Setup Video</b>\n<i>No setup video configured for <code>${this.escapeHtml(item.name)}</code>.</i>`;
      if (messageIdToEdit) {
        try {
          const editRes = await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: messageIdToEdit,
            text: noVidText,
            parse_mode: 'HTML',
            reply_markup: backKeyboard
          });
          if (editRes && editRes.ok) return;
        } catch {}
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: noVidText,
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      });
      return;
    }

    const caption = `🎬 <b>Setup Video:</b> <code>${this.escapeHtml(item.name)}</code>`;

    // 1. If we already have a cached permanent Telegram file_id for this video, use it first
    const isRemoteFileId = (val?: string) => Boolean(
      val &&
      !val.startsWith('upload_') &&
      !val.startsWith('local_') &&
      !val.startsWith('phone_') &&
      !/^https?:\/\//i.test(val)
    );

    if (isRemoteFileId(item.setupVideoTelegramFileId)) {
      if (messageIdToEdit) {
        try {
          await this.callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageIdToEdit });
        } catch {}
      }
      const tgRes = await this.callTelegramApi('sendVideo', {
        chat_id: chatId,
        video: item.setupVideoTelegramFileId,
        caption,
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      });
      if (tgRes && tgRes.ok) return;

      const docFallback = await this.callTelegramApi('sendDocument', {
        chat_id: chatId,
        document: item.setupVideoTelegramFileId,
        caption,
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      });
      if (docFallback && docFallback.ok) return;
    }

    // 2. Check if setup video is stored as an uploaded file (disk or Firebase RTDB / chunked RTDB)
    const isUpload = Boolean(
      item.setupVideoType === 'upload' ||
      item.setupVideoUrl.startsWith('upload_') ||
      item.setupVideoUrl.startsWith('local_') ||
      item.setupVideoUrl.startsWith('phone_')
    );

    let uploadedVideo = isUpload ? await storage.getUploadedFile(item.setupVideoUrl) : null;
    if (!uploadedVideo && item.setupVideoFileName) {
      uploadedVideo = await storage.getUploadedFile(item.setupVideoFileName);
    }

    if (uploadedVideo && uploadedVideo.buffer) {
      if (messageIdToEdit) {
        try {
          await this.callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageIdToEdit });
        } catch {}
      }
      const res = await TelegramService.uploadAndDeliverDirectly(chatId, {
        buffer: uploadedVideo.buffer,
        fileName: uploadedVideo.fileName || 'setup_video.mp4',
        mimeType: uploadedVideo.mimeType || 'video/mp4',
        fileType: 'video'
      }, caption, backKeyboard);

      if (res && res.ok) {
        // Persist Telegram's returned file_id without erasing setupVideoUrl so video survives any future update/restart
        const cachedTgId =
          res.result?.video?.file_id ||
          res.result?.document?.file_id ||
          res.result?.animation?.file_id;
        if (cachedTgId && cachedTgId !== item.setupVideoTelegramFileId) {
          item.setupVideoTelegramFileId = cachedTgId;
          await storage.saveItem(item).catch(() => {});
        }
        return;
      }
    }

    // 3. If it's a URL or fileId: try sendVideo if it's direct video file or fileId
    const isExternalUrl = /^https?:\/\//i.test(item.setupVideoUrl);
    const isDirectVideoExt = /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(item.setupVideoUrl);

    if (!isUpload && (!isExternalUrl || isDirectVideoExt)) {
      if (messageIdToEdit) {
        try {
          await this.callTelegramApi('deleteMessage', { chat_id: chatId, message_id: messageIdToEdit });
        } catch {}
      }
      const res = await this.callTelegramApi('sendVideo', {
        chat_id: chatId,
        video: item.setupVideoUrl,
        caption,
        parse_mode: 'HTML',
        reply_markup: backKeyboard
      });

      if (res && res.ok) return;
    }

    // 3. If external web link (e.g. YouTube, tutorial URL): edit existing message in place seamlessly!
    const videoButtonRow: any[] = [];
    if (isExternalUrl) {
      videoButtonRow.push({ text: '▶️ Watch Setup Video', url: item.setupVideoUrl, style: 'primary' });
    }
    const inlineKeyboard = [
      ...(videoButtonRow.length > 0 ? [videoButtonRow] : []),
      [{ text: '⬅️ Back', callback_data: `sv_menu_${item.id}`, style: 'primary' }]
    ];
    const textMsg = `🎬 <b>Setup Video Tutorial</b>\n\n• 📦 <b>Item:</b> <code>${this.escapeHtml(item.name)}</code>\n• 🔗 <b>URL:</b> <code>${this.escapeHtml(item.setupVideoUrl)}</code>`;

    if (messageIdToEdit) {
      try {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: messageIdToEdit,
          text: textMsg,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
        if (editRes && editRes.ok) return;
      } catch {}
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: textMsg,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  }

  // =========================================================================
  // BROADCAST NOTIFICATION SYSTEM (Rich Media: Photo, Video, Audio, Voice, Text)
  // =========================================================================
  public static async sendBroadcastMessage(params: {
    chatId: string | number;
    message?: string;
    mediaType: 'text' | 'photo' | 'video' | 'audio' | 'voice';
    mediaUrl?: string; // URL, Telegram file_id, or local upload_*/local_* identifier
    fileBuffer?: Buffer;
    fileName?: string;
    mimeType?: string;
    pinMessage?: boolean;
    replyToMessageId?: number;
    threadId?: number;
  }): Promise<{ ok: boolean; messageId?: number; fileId?: string; description?: string }> {
    const token = await this.getBotToken();
    if (!token) return { ok: false, description: 'No bot token configured' };

    const chatId = String(params.chatId);
    const captionRaw = params.message?.trim() || undefined;
    const caption = captionRaw && captionRaw.length > 1024 ? `${captionRaw.slice(0, 1020)}...` : captionRaw;
    const mediaType = params.mediaType || 'text';
    const replyToMessageId = params.replyToMessageId ? Number(params.replyToMessageId) : undefined;
    const threadId = params.threadId ? Number(params.threadId) : undefined;

    // 1. Text-Only Message
    if (mediaType === 'text') {
      let res = await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: params.message || '',
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        ...(threadId ? { message_thread_id: threadId } : {})
      });
      if ((!res || !res.ok) && replyToMessageId) {
        res = await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: params.message || '',
          parse_mode: 'HTML',
          ...(threadId ? { message_thread_id: threadId } : {})
        });
      }
      if (res && res.ok && params.pinMessage && res.result?.message_id) {
        await this.callTelegramApi('pinChatMessage', {
          chat_id: chatId,
          message_id: res.result.message_id
        }).catch(() => {});
      }
      return { ok: Boolean(res && res.ok), messageId: res?.result?.message_id, description: res?.description };
    }

    // Resolve locally uploaded media buffer if mediaUrl points to a local upload identifier (upload_*, local_*, phone_*)
    let fileBuffer = params.fileBuffer;
    let fileName = params.fileName;
    let mimeType = params.mimeType;
    const isLocalMediaId = Boolean(
      params.mediaUrl &&
      (params.mediaUrl.startsWith('upload_') ||
        params.mediaUrl.startsWith('local_') ||
        params.mediaUrl.startsWith('phone_'))
    );

    if (!fileBuffer && isLocalMediaId && params.mediaUrl) {
      try {
        const uploaded = await storage.getUploadedFile(params.mediaUrl);
        if (uploaded && uploaded.buffer) {
          fileBuffer = uploaded.buffer;
          fileName = fileName || uploaded.fileName;
          mimeType = mimeType || uploaded.mimeType;
        }
      } catch (lookupErr) {
        console.warn('[Telegram] Failed to load local media buffer for rule/broadcast:', lookupErr);
      }
    }

    // 2. Media via existing Telegram file_id or external URL
    if (params.mediaUrl && !isLocalMediaId && !fileBuffer) {
      let method = 'sendPhoto';
      let field = 'photo';
      if (mediaType === 'video') {
        method = 'sendVideo';
        field = 'video';
      } else if (mediaType === 'audio') {
        method = 'sendAudio';
        field = 'audio';
      } else if (mediaType === 'voice') {
        method = 'sendVoice';
        field = 'voice';
      }

      const basePayload: Record<string, any> = {
        chat_id: chatId,
        [field]: params.mediaUrl,
        ...(caption ? { caption, parse_mode: 'HTML' } : {}),
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        ...(threadId ? { message_thread_id: threadId } : {})
      };

      let res = await this.callTelegramApi(method, basePayload);
      // Retry without reply_to_message_id if Telegram rejected the quoted message
      if ((!res || !res.ok) && replyToMessageId) {
        const retryPayload = { ...basePayload };
        delete retryPayload.reply_to_message_id;
        res = await this.callTelegramApi(method, retryPayload);
      }
      // Retry without parse_mode if HTML tags failed to parse
      if ((!res || !res.ok) && caption) {
        const plainPayload: Record<string, any> = {
          chat_id: chatId,
          [field]: params.mediaUrl,
          caption: caption.replace(/<[^>]+>/g, ''),
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
          ...(threadId ? { message_thread_id: threadId } : {})
        };
        res = await this.callTelegramApi(method, plainPayload);
      }

      if (res && res.ok && params.pinMessage && res.result?.message_id) {
        await this.callTelegramApi('pinChatMessage', {
          chat_id: chatId,
          message_id: res.result.message_id
        }).catch(() => {});
      }

      if (res && res.ok) {
        const fileId = res.result?.photo ? res.result.photo[res.result.photo.length - 1]?.file_id :
          res.result?.video?.file_id || res.result?.audio?.file_id || res.result?.voice?.file_id;
        return { ok: true, messageId: res.result?.message_id, fileId, description: res.description };
      }

      // Check if local uploaded buffer exists under this key as last-resort fallback
      try {
        const uploaded = await storage.getUploadedFile(params.mediaUrl);
        if (uploaded && uploaded.buffer) {
          fileBuffer = uploaded.buffer;
          fileName = fileName || uploaded.fileName;
          mimeType = mimeType || uploaded.mimeType;
        }
      } catch {}

      if (!fileBuffer) {
        return { ok: false, messageId: res?.result?.message_id, description: res?.description };
      }
    }

    // 3. Media via uploaded Buffer (multipart FormData)
    if (fileBuffer) {
      let normalizedBuf: Buffer;
      if (Buffer.isBuffer(fileBuffer)) {
        normalizedBuf = fileBuffer;
      } else if ((fileBuffer as any)?.data) {
        normalizedBuf = Buffer.from((fileBuffer as any).data);
      } else if (typeof fileBuffer === 'string') {
        normalizedBuf = Buffer.from(fileBuffer, 'base64');
      } else {
        normalizedBuf = Buffer.from(fileBuffer);
      }

      let method = 'sendPhoto';
      let fieldName = 'photo';
      if (mediaType === 'video') {
        method = 'sendVideo';
        fieldName = 'video';
      } else if (mediaType === 'audio') {
        method = 'sendAudio';
        fieldName = 'audio';
      } else if (mediaType === 'voice') {
        method = 'sendVoice';
        fieldName = 'voice';
      }

      const sendMultipart = async (useReply: boolean, useHtml: boolean) => {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        if (caption) {
          formData.append('caption', useHtml ? caption : caption.replace(/<[^>]+>/g, ''));
          if (useHtml) formData.append('parse_mode', 'HTML');
        }
        if (useReply && replyToMessageId) {
          formData.append('reply_to_message_id', String(replyToMessageId));
        }
        if (threadId) {
          formData.append('message_thread_id', String(threadId));
        }

        const blob = new Blob([new Uint8Array(normalizedBuf)] as any, {
          type: mimeType || (mediaType === 'photo' ? 'image/jpeg' : mediaType === 'video' ? 'video/mp4' : mediaType === 'voice' ? 'audio/ogg' : 'audio/mpeg')
        });
        formData.append(fieldName, blob, fileName || (mediaType === 'photo' ? 'photo.jpg' : mediaType === 'video' ? 'video.mp4' : mediaType === 'voice' ? 'voice.ogg' : 'audio.mp3'));

        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          body: formData
        });
        return await res.json();
      };

      try {
        let data = await sendMultipart(true, true);
        if (!data.ok && replyToMessageId) {
          data = await sendMultipart(false, true);
        }
        if (!data.ok && caption) {
          data = await sendMultipart(Boolean(replyToMessageId), false);
        }
        if (data.ok && params.pinMessage && data.result?.message_id) {
          await this.callTelegramApi('pinChatMessage', {
            chat_id: chatId,
            message_id: data.result.message_id
          }).catch(() => {});
        }
        const fileId = data.result?.photo ? data.result.photo[data.result.photo.length - 1]?.file_id :
          data.result?.video?.file_id || data.result?.audio?.file_id || data.result?.voice?.file_id;

        return { ok: Boolean(data.ok), messageId: data.result?.message_id, fileId, description: data.description };
      } catch (err: any) {
        return { ok: false, description: err.message };
      }
    }

    return { ok: false, description: 'No media or message content specified' };
  }

  // =========================================================================
  // FREE FIRE UID CHECKER (/u <uid>, /uid <uid>) & GUILD INFO CHECKER
  // =========================================================================
  private static freeFirePlayerCache: Map<string, { data: any; fetchedAt: number }> = new Map();
  private static freeFireGuildCache: Map<string, { guild: ReturnType<typeof TelegramService.extractGuildInfo>; sourceUid: string; playerData: any }> = new Map();

  public static parseFreeFireUidCommand(rawText: string): { matched: boolean; uid: string | null } {
    const cleaned = String(rawText || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0]/g, ' ')
      .trim();
    const match = cleaned.match(/^\/(?:u|uid)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
    if (!match) {
      return { matched: false, uid: null };
    }
    const arg = (match[1] || '').trim();
    const uidMatch = arg.match(/^(\d+)$/);
    return {
      matched: true,
      uid: uidMatch ? uidMatch[1] : null
    };
  }

  private static isPresentValue(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') {
      const t = val.trim();
      return Boolean(t) && t.toLowerCase() !== 'none' && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'n/a';
    }
    return true;
  }

  private static cleanFfSignature(sig: string): string {
    const stripped = String(sig || '')
      .replace(/\[(?:[0-9a-fA-F]{6}|[bciuhs]|\/[bciuhs])\]/gi, '')
      .trim();
    return stripped || String(sig || '').trim();
  }

  private static async setBotReaction(chatId: number | string, messageId: number | undefined, emoji: string): Promise<void> {
    if (!messageId) return;
    try {
      await this.callTelegramApi('setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }]
      });
    } catch {}
  }

  private static buildLoadingProgressText(percent: number, statusText: string): string {
    const safePct = Math.min(100, Math.max(0, percent));
    const totalBlocks = 10;
    const filledBlocks = Math.round((safePct / 100) * totalBlocks);
    const bar = '█'.repeat(filledBlocks) + '▒'.repeat(totalBlocks - filledBlocks);
    return (
      `🔄 <b>FETCHING INFO 📊</b>\n` +
      `<code>${safePct}% [${bar}]</code>\n` +
      `<i>${this.escapeHtml(statusText)}</i>`
    );
  }

  public static async fetchFreeFirePlayer(uid: string, forceRefresh: boolean = false): Promise<any | null> {
    const cleanUid = String(uid || '').trim();
    if (!/^\d+$/.test(cleanUid)) return null;

    const cached = this.freeFirePlayerCache.get(cleanUid);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      return cached.data;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 16000);
      const res = await fetch(`https://auraffxserverinfocheckerapi.onrender.com/api/player?uid=${encodeURIComponent(cleanUid)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return null;
      }

      const json: any = await res.json().catch(() => null);
      if (!json || json.success === false || json.error) {
        return null;
      }

      const playerObj = json.player && typeof json.player === 'object' && !json.player.error ? json.player : json;
      const hasIdentity = Boolean(
        this.isPresentValue(playerObj?.name) ||
        this.isPresentValue(json?.name) ||
        this.isPresentValue(playerObj?.uid) ||
        this.isPresentValue(json?.uid)
      );
      if (!hasIdentity) {
        return null;
      }

      if (this.freeFirePlayerCache.size > 200) {
        const oldestKey = this.freeFirePlayerCache.keys().next().value;
        if (oldestKey) this.freeFirePlayerCache.delete(oldestKey);
      }
      this.freeFirePlayerCache.set(cleanUid, { data: json, fetchedAt: Date.now() });
      return json;
    } catch (err: any) {
      console.warn(`[FreeFireUID] Fetch error for UID ${cleanUid}:`, err?.message || err);
      return null;
    }
  }

  public static extractGuildInfo(apiData: any): {
    hasGuild: boolean;
    name?: string;
    id?: string;
    level?: string | number;
    memberCount?: string | number;
    capacity?: string | number;
    leaderName?: string;
    leaderUid?: string;
    leaderFallback?: any;
    summaryHtml: string;
  } {
    const p = apiData?.player && typeof apiData.player === 'object' ? apiData.player : apiData;
    const raw = apiData?.raw && typeof apiData.raw === 'object' ? apiData.raw : {};
    let parsedRawData: any = null;
    const rawDataStr = apiData?.raw_data || p?.raw_data || raw?.raw_data;
    if (typeof rawDataStr === 'string' && rawDataStr.trim().startsWith('{')) {
      try {
        parsedRawData = JSON.parse(rawDataStr);
      } catch {}
    } else if (rawDataStr && typeof rawDataStr === 'object') {
      parsedRawData = rawDataStr;
    }

    const guildObj =
      (p?.guild && typeof p.guild === 'object' ? p.guild : null) ||
      (apiData?.guild && typeof apiData.guild === 'object' ? apiData.guild : null) ||
      (parsedRawData?.GuildInfo && typeof parsedRawData.GuildInfo === 'object' ? parsedRawData.GuildInfo : null) ||
      {};

    const name = guildObj.name || guildObj.GuildName || apiData?.guild_name || raw?.guild_name;
    const id = guildObj.id || guildObj.GuildID || apiData?.guild_id || raw?.guild_id;
    const level = guildObj.level ?? guildObj.GuildLevel ?? apiData?.guild_level ?? raw?.guild_level;
    const memberCount = guildObj.member_count ?? guildObj.GuildMember ?? apiData?.guild_member ?? raw?.guild_member;
    const capacity = guildObj.capacity ?? guildObj.GuildCapacity ?? apiData?.guild_capacity ?? raw?.guild_capacity;
    const leaderName = guildObj.leader_name || apiData?.guild_leader_name || raw?.guild_leader_name;
    const leaderUid = guildObj.leader_uid || guildObj.owner_id || guildObj.GuildOwner || apiData?.guild_leader_uid || apiData?.guild_owner_id || raw?.guild_leader_uid;

    const exists = Boolean(this.isPresentValue(name) || (this.isPresentValue(id) && String(id).trim() !== '0'));
    if (!exists) {
      return {
        hasGuild: false,
        summaryHtml: 'ℹ️ <i>No guild found in this account.</i>'
      };
    }

    const membersStr = this.isPresentValue(memberCount)
      ? `${memberCount}${this.isPresentValue(capacity) ? `/${capacity}` : ''}`
      : 'N/A';

    const htmlLines: string[] = [
      '🛡 <b>GUILD INFORMATION</b>',
      '━━━━━━━━━━━━━━━━━━━━',
      ...(this.isPresentValue(name) ? [`🏷 <b>Guild Name:</b> ${this.escapeHtml(String(name))}`] : []),
      ...(this.isPresentValue(id) ? [`🆔 <b>Guild ID:</b> <code>${this.escapeHtml(String(id))}</code>`] : []),
      ...(this.isPresentValue(level) ? [`⭐ <b>Guild Level:</b> Lv. ${this.escapeHtml(String(level))}`] : []),
      `👥 <b>Members:</b> ${this.escapeHtml(membersStr)}`
    ];
    if (this.isPresentValue(leaderName) || this.isPresentValue(leaderUid)) {
      const leaderLabel = this.isPresentValue(leaderName)
        ? `${this.escapeHtml(String(leaderName))}${this.isPresentValue(leaderUid) ? ` (<code>${this.escapeHtml(String(leaderUid))}</code>)` : ''}`
        : `<code>${this.escapeHtml(String(leaderUid))}</code>`;
      htmlLines.push(`👑 <b>Leader:</b> ${leaderLabel}`);
    }

    const leaderFallback = (this.isPresentValue(leaderUid) || this.isPresentValue(leaderName))
      ? {
          uid: leaderUid ? String(leaderUid) : 'Unknown',
          name: leaderName ? String(leaderName) : 'Guild Leader',
          level: guildObj.leader_level ?? raw?.guild_leader_level ?? 'N/A',
          likes: guildObj.leader_likes ?? raw?.guild_leader_likes ?? '0',
          region: guildObj.leader_region ?? raw?.guild_leader_region,
          br_rank: guildObj.leader_br_rank ?? raw?.guild_leader_br_rank,
          br_rank_point: guildObj.leader_br_points ?? raw?.guild_leader_br_points,
          cs_rank: guildObj.leader_cs_rank ?? raw?.guild_leader_cs_rank,
          cs_rank_point: guildObj.leader_cs_points ?? raw?.guild_leader_cs_points,
          exp: guildObj.leader_exp ?? raw?.guild_leader_exp ?? 0,
          created_at: guildObj.leader_created_at ?? raw?.guild_leader_created_at,
          last_login: guildObj.leader_last_login ?? raw?.guild_leader_last_login,
          release_version: raw?.guild_leader_release_version
        }
      : undefined;

    return {
      hasGuild: true,
      name: this.isPresentValue(name) ? String(name) : undefined,
      id: this.isPresentValue(id) ? String(id) : undefined,
      level: this.isPresentValue(level) ? level : undefined,
      memberCount: this.isPresentValue(memberCount) ? memberCount : undefined,
      capacity: this.isPresentValue(capacity) ? capacity : undefined,
      leaderName: this.isPresentValue(leaderName) ? String(leaderName) : undefined,
      leaderUid: this.isPresentValue(leaderUid) ? String(leaderUid) : undefined,
      leaderFallback,
      summaryHtml: htmlLines.join('\n')
    };
  }

  public static formatGuildInfoMessage(
    guild: ReturnType<typeof TelegramService.extractGuildInfo>,
    playerUid: string
  ): string {
    return [
      guild.summaryHtml,
      '━━━━━━━━━━━━━━━━━━━━',
      `🆔 <b>Player UID:</b> <code>${this.escapeHtml(playerUid)}</code>`,
      '⚡ <b>FREE FIRE PROFILE SYSTEM</b>',
      '✨ Powered by Zexi Team'
    ].join('\n');
  }

  public static formatFreeFirePlayerMessage(
    apiData: any,
    fallbackUid: string,
    headerTitle: string = '🔥 <b>FREE FIRE PLAYER PROFILE</b>'
  ): string {
    const p = apiData?.player && typeof apiData.player === 'object' && !apiData.player.error ? apiData.player : apiData;

    const uid = String(p?.uid || apiData?.uid || fallbackUid).trim();
    const name = this.isPresentValue(p?.name) ? String(p.name) : (this.isPresentValue(apiData?.name) ? String(apiData.name) : 'Unknown');
    const level = this.isPresentValue(p?.level ?? apiData?.level) ? (p?.level ?? apiData?.level) : 0;
    const rawExp = p?.exp ?? apiData?.exp;
    const exp = this.isPresentValue(rawExp) ? String(rawExp) : '0';
    const likes = this.isPresentValue(p?.likes ?? apiData?.likes) ? (p?.likes ?? apiData?.likes) : '0';

    const regionFlag = this.isPresentValue(p?.region_flag || apiData?.region_flag) ? String(p?.region_flag || apiData?.region_flag).trim() : '';
    const regionName = this.isPresentValue(p?.region_name || apiData?.region_name) ? String(p?.region_name || apiData?.region_name).trim() : '';
    const regionCode = this.isPresentValue(p?.region || apiData?.region) ? String(p?.region || apiData?.region).trim() : '';
    const regionTextRaw = regionName && regionCode && regionName.toLowerCase() !== regionCode.toLowerCase()
      ? `${regionName} (${regionCode})`
      : (regionName || regionCode || 'Unknown');
    const regionDisplay = `${regionFlag ? `${regionFlag} ` : ''}${this.escapeHtml(regionTextRaw)}`;

    const br = p?.battle_royale || apiData?.battle_royale;
    const cs = p?.clash_squad || apiData?.clash_squad;
    const brRankRaw = this.isPresentValue(br?.tier)
      ? String(br.tier)
      : (this.isPresentValue(p?.br_rank || apiData?.br_rank) ? String(p?.br_rank || apiData?.br_rank) : 'Unranked');
    const brPointsRaw = this.isPresentValue(br?.points)
      ? br.points
      : (this.isPresentValue(p?.br_rank_point ?? apiData?.br_rank_point) ? (p?.br_rank_point ?? apiData?.br_rank_point) : 0);

    const csRankRaw = this.isPresentValue(cs?.tier)
      ? String(cs.tier)
      : (this.isPresentValue(p?.cs_rank || apiData?.cs_rank) ? String(p?.cs_rank || apiData?.cs_rank) : 'Unranked');
    const csPointsRaw = this.isPresentValue(cs?.points)
      ? cs.points
      : (this.isPresentValue(p?.cs_rank_point ?? apiData?.cs_rank_point)
          ? (p?.cs_rank_point ?? apiData?.cs_rank_point)
          : (this.isPresentValue(cs?.peak_points) ? cs.peak_points : 0));

    const honorScoreRaw = p?.honor_score ?? apiData?.honor_score ?? p?.credit_score ?? apiData?.credit_score ?? 100;
    const rawAccountStatus = p?.account_status || apiData?.account_status || p?.status || apiData?.status_text;
    const accountStatus = this.isPresentValue(rawAccountStatus)
      ? String(rawAccountStatus)
      : (Number(honorScoreRaw) >= 90 ? 'Active' : 'Restricted');

    const valuation = p?.valuation || apiData?.valuation;
    const accountTier = this.isPresentValue(valuation?.rarity_tier)
      ? String(valuation.rarity_tier)
      : (this.isPresentValue(p?.tier || apiData?.tier) ? String(p?.tier || apiData?.tier) : 'Standard');
    const gameVersion = this.isPresentValue(p?.release_version || apiData?.release_version || apiData?.most_recent_ob)
      ? String(p?.release_version || apiData?.release_version || apiData?.most_recent_ob)
      : 'Unknown';

    const createdAt = this.isPresentValue(p?.created_at || apiData?.created_at) ? String(p?.created_at || apiData?.created_at) : 'Unknown';
    const lastLogin = this.isPresentValue(p?.last_login || apiData?.last_login) ? String(p?.last_login || apiData?.last_login) : 'Unknown';

    const rawSig = this.isPresentValue(p?.signature || apiData?.signature) ? String(p?.signature || apiData?.signature) : '';
    const cleanBio = rawSig ? this.cleanFfSignature(rawSig).slice(0, 300) : 'No bio set';

    return [
      headerTitle,
      '━━━━━━━━━━━━━━━━━━━━',
      '👤 <b>PLAYER IDENTITY</b>',
      `🆔 <b>UID:</b> <code>${this.escapeHtml(uid)}</code>`,
      `🏷 <b>Name:</b> ${this.escapeHtml(name)}`,
      `🌍 <b>Region:</b> ${regionDisplay}`,
      `⭐ <b>Level:</b> ${this.escapeHtml(String(level))} <code>(${this.escapeHtml(exp)} EXP)</code>`,
      `👍 <b>Likes:</b> ${this.escapeHtml(String(likes))}`,
      '━━━━━━━━━━━━━━━━━━━━',
      '🏆 <b>RANK INFORMATION</b>',
      `🔰 <b>Battle Royale:</b> ${this.escapeHtml(brRankRaw)}`,
      `└ 💠 <b>Points:</b> ${this.escapeHtml(String(brPointsRaw))}`,
      `⚔️ <b>Clash Squad:</b> ${this.escapeHtml(csRankRaw)}`,
      `└ 💠 <b>Points:</b> ${this.escapeHtml(String(csPointsRaw))}`,
      '━━━━━━━━━━━━━━━━━━━━',
      '💎 <b>ACCOUNT INFORMATION</b>',
      `🟢 <b>Status:</b> ${this.escapeHtml(accountStatus)}`,
      `🛡 <b>Honer score:</b> ${this.escapeHtml(String(honorScoreRaw))}/100`,
      `💠 <b>Account Tier:</b> ${this.escapeHtml(accountTier)}`,
      `📦 <b>Game Version:</b> ${this.escapeHtml(gameVersion)}`,
      '━━━━━━━━━━━━━━━━━━━━',
      `📅 <b>Created:</b> ${this.escapeHtml(createdAt)}`,
      `🕒 <b>Last Login:</b> ${this.escapeHtml(lastLogin)}`,
      '━━━━━━━━━━━━━━━━━━━━',
      '💬 <b>PLAYER BIO</b>',
      `<blockquote>${this.escapeHtml(cleanBio)}</blockquote>`,
      '━━━━━━━━━━━━━━━━━━━━',
      '⚡ <b>FREE FIRE PROFILE SYSTEM</b>',
      '✨ Powered by Zexi Team'
    ].join('\n');
  }

  private static async handleFreeFireUidCommand(
    chatId: number | string,
    uid: string | null,
    messageId?: number,
    isGroup: boolean = false,
    threadId?: number
  ): Promise<void> {
    if (!uid) {
      this.setBotReaction(chatId, messageId, '😢').catch(() => {});
      const usageParams: any = {
        chat_id: chatId,
        text: '⚠️ <b>Please provide a valid Free Fire UID.</b>\nExample: <code>/u 8674177274</code>',
        parse_mode: 'HTML'
      };
      if (isGroup && messageId) usageParams.reply_to_message_id = messageId;
      if (threadId) usageParams.message_thread_id = threadId;
      const usageRes = await this.callTelegramApi('sendMessage', usageParams);
      if (isGroup && usageRes?.ok && usageRes.result?.message_id) {
        await this.trackAndLimitMessage(Number(chatId), usageRes.result.message_id);
      }
      return;
    }

    // 1. Immediately react to user's command message with thinking emoji (🤔)
    this.setBotReaction(chatId, messageId, '🤔').catch(() => {});

    // 2. Send initial 0% loading progress message immediately
    const loadingParams: any = {
      chat_id: chatId,
      text: this.buildLoadingProgressText(0, 'Connecting to secure server...'),
      parse_mode: 'HTML'
    };
    if (isGroup && messageId) loadingParams.reply_to_message_id = messageId;
    if (threadId) loadingParams.message_thread_id = threadId;

    let loadingMsgId: number | undefined;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    try {
      const fetchPromise = this.fetchFreeFirePlayer(uid, true);
      const initRes = await this.callTelegramApi('sendMessage', loadingParams);
      if (initRes?.ok && initRes.result?.message_id) {
        loadingMsgId = initRes.result.message_id;
        if (isGroup) {
          this.trackAndLimitMessage(Number(chatId), loadingMsgId!).catch(() => {});
        }
      }

      // 3. Animate progress smoothly while fetching API data
      const progressSteps: Array<[number, string]> = [
        [25, 'Verifying player UID...'],
        [50, 'Fetching profile stats...'],
        [75, 'Decoding account & rank info...']
      ];

      for (const [pct, label] of progressSteps) {
        await sleep(260);
        if (loadingMsgId) {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: loadingMsgId,
            text: this.buildLoadingProgressText(pct, label),
            parse_mode: 'HTML'
          }).catch(() => {});
        }
      }

      const data = await fetchPromise;
      if (!data) {
        // Error state: react with sad/error emoji (😢) and show clean error message
        await this.setBotReaction(chatId, messageId, '😢');
        const errHtml = '❌ <b>Player not found or API service is busy.</b> Please try again later.';
        if (loadingMsgId) {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: loadingMsgId,
            text: errHtml,
            parse_mode: 'HTML'
          }).catch(async () => {
            const errParams: any = { chat_id: chatId, text: errHtml, parse_mode: 'HTML' };
            if (isGroup && messageId) errParams.reply_to_message_id = messageId;
            if (threadId) errParams.message_thread_id = threadId;
            await this.callTelegramApi('sendMessage', errParams);
          });
        } else {
          const errParams: any = { chat_id: chatId, text: errHtml, parse_mode: 'HTML' };
          if (isGroup && messageId) errParams.reply_to_message_id = messageId;
          if (threadId) errParams.message_thread_id = threadId;
          await this.callTelegramApi('sendMessage', errParams);
        }
        return;
      }

      // Complete bar at 100% briefly before displaying final profile
      if (loadingMsgId) {
        await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: loadingMsgId,
          text: this.buildLoadingProgressText(100, 'Profile data loaded!'),
          parse_mode: 'HTML'
        }).catch(() => {});
        await sleep(200);
      }

      const formattedText = this.formatFreeFirePlayerMessage(data, uid);
      const replyMarkup = {
        inline_keyboard: [
          [{ text: '🛡 Check Guild Info', callback_data: `guild_${uid}`, style: 'primary' }]
        ]
      };

      // Update reaction to success emoji (💯)
      await this.setBotReaction(chatId, messageId, '💯');

      if (loadingMsgId) {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: loadingMsgId,
          text: formattedText,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
        if (editRes?.ok) return;
      }

      const sendParams: any = {
        chat_id: chatId,
        text: formattedText,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      };
      if (isGroup && messageId) sendParams.reply_to_message_id = messageId;
      if (threadId) sendParams.message_thread_id = threadId;

      const sentRes = await this.callTelegramApi('sendMessage', sendParams);
      if (isGroup && sentRes?.ok && sentRes.result?.message_id) {
        await this.trackAndLimitMessage(Number(chatId), sentRes.result.message_id);
      }
    } catch (err: any) {
      console.error('[FreeFireUID] Command handler error:', err?.message || err);
      await this.setBotReaction(chatId, messageId, '😢');
      const errHtml = '❌ <b>Player not found or API service is busy.</b> Please try again later.';
      if (loadingMsgId) {
        await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: loadingMsgId,
          text: errHtml,
          parse_mode: 'HTML'
        }).catch(() => {});
      } else {
        const errParams: any = { chat_id: chatId, text: errHtml, parse_mode: 'HTML' };
        if (isGroup && messageId) errParams.reply_to_message_id = messageId;
        if (threadId) errParams.message_thread_id = threadId;
        await this.callTelegramApi('sendMessage', errParams).catch(() => {});
      }
    }
  }

  // =========================================================================
  // QUICK FILE KEYWORDS / FILTERS COMMAND (/filters, /filter, #filters)
  // =========================================================================
  private static async handleFiltersCommand(chatId: number | string, messageId?: number, isGroup: boolean = false): Promise<void> {
    await storage.loadLatest(false);
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
          // STRICT RULE: Only valid hashtags starting with '#'. Ignore/reject slash commands or plain text!
          if (clean.startsWith('#') && clean.length > 1) {
            hashtags.push(clean);
          }
        }
      }
    }

    // Strictly sequential chronological order (FIFO): first added hashtag stays at the very top position
    const uniqueTags = Array.from(new Set(hashtags));

    let formattedKeywords = '';
    if (uniqueTags.length === 0) {
      formattedKeywords = '<i>(No file hashtags added to public filters yet)</i>';
    } else {
      // Monospaced <code>#keyword</code> allows ONE-TAP COPY on mobile Telegram!
      formattedKeywords = uniqueTags.map((tag) => `<code>${tag}</code>`).join('\n');
    }

    const defaultTpl = "📁 <b>Quick File Keywords</b>\n<i>Tap any trigger below to copy and send it to receive the file privately:</i>\n\n{keywords}";
    const tplContent = templates.FILTERS_MESSAGE?.content || defaultTpl;

    const formattedBotName = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'Bot';
    const messageText = tplContent
      .replace(/\{keywords\}/g, formattedKeywords)
      .replace(/\{bot_name\}/g, this.escapeHtml(formattedBotName));

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
  // INTERACTIVE FILE LISTING & LINK COPYING COMMAND (/allfile, /allfiles)
  // =========================================================================
  private static truncateUtf8Bytes(input: string, maxBytes: number): string {
    if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
    let out = '';
    for (const ch of input) {
      if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) break;
      out += ch;
    }
    return out;
  }

  public static parseAllFileCommand(rawText: string): { matched: boolean; page: number } {
    const cleaned = String(rawText || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00A0]/g, ' ')
      .trim();
    const match = cleaned.match(/^\/allfiles?(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
    if (!match) {
      return { matched: false, page: 1 };
    }
    const argText = (match[1] || '').trim();
    const numMatch = argText.match(/\d+/);
    const page = numMatch ? Math.max(1, parseInt(numMatch[0], 10) || 1) : 1;
    return { matched: true, page };
  }

  public static buildFilesListView(requestedPage: number = 1): {
    text: string;
    inlineKeyboard: any[][];
    totalItems: number;
    page: number;
    totalPages: number;
  } {
    // Instant O(1) pre-sorted & pre-indexed retrieval from memory (zero DB/cloud lag)
    const activeItems = storage.getItemsFast();

    const pageSize = 10;
    const totalItems = activeItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safeReqPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
    const page = Math.min(Math.max(1, safeReqPage), totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageItems = activeItems.slice(startIdx, startIdx + pageSize);

    if (totalItems === 0) {
      return {
        text: '📁 <b>No files found in the database.</b>',
        inlineKeyboard: [
          [
            { text: '🔄 Refresh', callback_data: 'fl_p:1', style: 'primary' },
            { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
          ]
        ],
        totalItems: 0,
        page: 1,
        totalPages: 1
      };
    }

    const fileCount = activeItems.filter((i) => i.type === 'file' && !i.isTextOnly && i.fileEnabled !== false).length;
    const linkCount = activeItems.filter((i) => i.type === 'link').length;
    const textCount = totalItems - fileCount - linkCount;

    const summaryParts = [
      fileCount > 0 ? `📁 ${fileCount} Files` : null,
      linkCount > 0 ? `🔗 ${linkCount} Links` : null,
      textCount > 0 ? `💬 ${textCount} Text` : null
    ].filter(Boolean);

    const text =
      `📂 <b>All Stored Files &amp; Links (${totalItems})</b>\n` +
      `<i>${summaryParts.join(' • ')}</i>\n` +
      `📄 Page <b>${page}</b> of <b>${totalPages}</b>\n\n` +
      `👇 <i>Tap any item below to view details &amp; copy its link:</i>`;

    const rows: any[][] = pageItems.map((item, idx) => {
      const num = startIdx + idx + 1;
      const isTextOnly = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));
      const icon =
        item.type === 'link'
          ? '🔗'
          : isTextOnly
          ? '💬'
          : item.fileType === 'video'
          ? '🎥'
          : item.fileType === 'photo'
          ? '🖼️'
          : item.fileType === 'audio'
          ? '🎵'
          : '📄';
      const rawTitle = (item.fileName || item.name || item.rawKeyword || 'Untitled')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled';
      const shortTitle = rawTitle.length > 42 ? `${rawTitle.slice(0, 39)}...` : rawTitle;
      const fullCb = `fl_v:${item.id}:${page}`;
      const cbData = Buffer.byteLength(fullCb, 'utf8') <= 64
        ? fullCb
        : this.truncateUtf8Bytes(`fl_v:${item.id}`, 64);
      return [{ text: `${num}. ${icon} ${shortTitle}`, callback_data: cbData, style: 'primary' }];
    });

    if (totalPages > 1) {
      const navRow: any[] = [];
      if (page > 1) {
        navRow.push({ text: '⬅️ Prev', callback_data: `fl_p:${page - 1}`, style: 'primary' });
      }
      navRow.push({ text: `📄 ${page} / ${totalPages}`, callback_data: 'fl_noop', style: 'primary' });
      if (page < totalPages) {
        navRow.push({ text: 'Next ➡️', callback_data: `fl_p:${page + 1}`, style: 'primary' });
      }
      rows.push(navRow);
    }

    rows.push([
      { text: '🔄 Refresh', callback_data: `fl_p:${page}`, style: 'primary' },
      { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
    ]);

    return { text, inlineKeyboard: rows, totalItems, page, totalPages };
  }

  private static async buildFileDetailView(item: ItemRecord, returnPage: number = 1): Promise<{
    text: string;
    deepLink: string;
    primaryKeyboard: any[][];
    fallbackKeyboard: any[][];
  }> {
    const botUsername = await this.getBotUsername();
    const cleanBotUsername = botUsername.replace(/^@/, '').trim();
    const payload = getItemPayload(item);
    const deepLink = cleanBotUsername
      ? `https://t.me/${cleanBotUsername}?start=${payload}`
      : `?start=${payload}`;

    const isTextOnly = Boolean(item.isTextOnly || (item.type === 'file' && item.fileEnabled === false));
    const typeLabel =
      item.type === 'link'
        ? '🔗 Link'
        : isTextOnly
        ? '💬 Text Message'
        : item.fileType === 'video'
        ? '🎥 Video'
        : item.fileType === 'photo'
        ? '🖼️ Photo'
        : item.fileType === 'audio'
        ? '🎵 Audio'
        : '📄 Document / File';

    const title = (item.fileName || item.name || 'Untitled').trim();
    const triggerList = Array.isArray(item.triggers) && item.triggers.length > 0
      ? item.triggers.slice(0, 5).map((t) => `<code>${this.escapeHtml(t)}</code>`).join(', ')
      : '<i>None</i>';

    const text =
      `📦 <b>${this.escapeHtml(title)}</b>\n\n` +
      `• <b>Type:</b> ${typeLabel}\n` +
      `• <b>Triggers:</b> ${triggerList}\n` +
      `• <b>Deliveries:</b> ${item.deliveryCount || 0}\n\n` +
      `🔗 <b>Direct Start Link:</b>\n<code>${this.escapeHtml(deepLink)}</code>\n\n` +
      `👇 <i>Tap <b>🔗 Copy Link</b> below to copy and share:</i>`;

    const copyBtnPrimary: any = cleanBotUsername
      ? { text: '🔗 Copy Link', copy_text: { text: deepLink }, style: 'success' }
      : { text: '🔗 Copy Link', callback_data: `fl_copy:${item.id}`, style: 'success' };

    const actionRowFallback: any[] = [
      { text: '🔗 Copy Link', callback_data: `fl_copy:${item.id}`, style: 'success' },
      ...(cleanBotUsername ? [{ text: '↗️ Open Link', url: deepLink, style: 'success' }] : [])
    ];

    const primaryKeyboard: any[][] = [
      [copyBtnPrimary],
      [
        { text: '📋 Send Copyable Link', callback_data: `fl_copy:${item.id}`, style: 'success' },
        ...(cleanBotUsername ? [{ text: '↗️ Open Link', url: deepLink, style: 'success' }] : [])
      ],
      [
        { text: '⬅️ Back to File List', callback_data: `fl_p:${returnPage}`, style: 'primary' },
        { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
      ]
    ];

    const fallbackKeyboard: any[][] = [
      actionRowFallback,
      [
        { text: '⬅️ Back to File List', callback_data: `fl_p:${returnPage}`, style: 'primary' },
        { text: '✖️ Close', callback_data: 'fl_close', style: 'danger' }
      ]
    ];

    return { text, deepLink, primaryKeyboard, fallbackKeyboard };
  }

  private static async handleLinkDeleteToggleCommand(chatId: number | string, text: string): Promise<void> {
    const arg = text.replace(/^\/linkdelete(?:@\w+)?/i, '').trim().toLowerCase();
    const current = await storage.getSettings();
    let nextValue = Boolean(current.linkDeleteEnabled);

    if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') {
      nextValue = true;
    } else if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') {
      nextValue = false;
    } else if (!arg || arg === 'toggle') {
      nextValue = !nextValue;
    } else {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `🔗 <b>Link Delete Setting</b>\n\n` +
          `• Current Status: <b>${nextValue ? '🟢 ON (Deleting unauthorized links)' : '⚪ OFF (Links permitted)'}</b>\n\n` +
          `Usage: <code>/linkdelete on</code> or <code>/linkdelete off</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    await storage.updateSettings({ linkDeleteEnabled: nextValue });
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: nextValue
        ? `🔗 <b>Link Delete is now ON</b>\n\nUnauthorized links sent by non-admin members in groups/chats will be automatically detected and deleted. Group administrators remain strictly protected.`
        : `🔗 <b>Link Delete is now OFF</b>\n\nLinks sent in groups/chats are permitted to remain in the chat.`,
      parse_mode: 'HTML'
    });
  }

  private static async handleFilesListCommand(
    _fromId: string,
    chatId: number | string,
    page: number = 1,
    replyToMessageId?: number,
    _isGroup: boolean = false,
    editMessageId?: number,
    threadId?: number
  ): Promise<void> {
    try {
      if (_fromId && !(await this.isAuthorizedAdmin(_fromId))) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '⛔ <b>Access Denied:</b> The <code>/allfiles</code> command is restricted to authorized administrators only.',
          parse_mode: 'HTML'
        }).catch(() => {});
        return;
      }
      // Ensure database cache is initialized (0.01ms no-op when already warm in memory)
      await storage.loadLatest(false);
      if (storage.getItemsFast().length === 0) {
        await storage.loadLatest(true).catch(() => {});
      }
      const view = this.buildFilesListView(page);

      if (editMessageId) {
        const editRes = await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: editMessageId,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: view.inlineKeyboard }
        });

        if (editRes?.ok) {
          return;
        }

        const desc = String(editRes?.description || '').toLowerCase();
        // Telegram returns "message is not modified" if Refresh/page is already identical; preserve existing styled markup cleanly
        if (desc.includes('not modified')) {
          return;
        }

        console.warn('[Telegram] /allfile editMessageText notice:', editRes?.description || 'unknown error');
        // If message can't be edited (e.g., too old or deleted), deliver updated page cleanly via sendMessage
        const fallbackSendParams: any = {
          chat_id: chatId,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: view.inlineKeyboard }
        };
        if (threadId) fallbackSendParams.message_thread_id = threadId;
        await this.callTelegramApi('sendMessage', fallbackSendParams);
        return;
      }

      const params: any = {
        chat_id: chatId,
        text: view.text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: view.inlineKeyboard }
      };
      if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
      if (threadId) params.message_thread_id = threadId;

      let res = await this.callTelegramApi('sendMessage', params);
      if (!res?.ok && params.reply_to_message_id) {
        delete params.reply_to_message_id;
        res = await this.callTelegramApi('sendMessage', params);
      }
      if (!res?.ok) {
        console.warn('[Telegram] /allfile sendMessage fallback triggered:', res?.description || 'unknown error');
        const strippedKeyboard = view.inlineKeyboard.map((row: any[]) =>
          row.map((btn: any) => {
            const { style, ...rest } = btn;
            return rest;
          })
        );
        const safeParams: any = {
          chat_id: chatId,
          text: view.text,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: strippedKeyboard }
        };
        if (threadId) safeParams.message_thread_id = threadId;
        await this.callTelegramApi('sendMessage', safeParams);
      }
    } catch (err: any) {
      console.error('[Telegram] /allfile command error:', err?.message || err);
      const errParams: any = {
        chat_id: chatId,
        text: '❌ <b>Load Error</b>\n<i>Unable to load the file list right now. Please try again in a moment.</i>',
        parse_mode: 'HTML'
      };
      if (replyToMessageId && !editMessageId) errParams.reply_to_message_id = replyToMessageId;
      if (threadId) errParams.message_thread_id = threadId;
      await this.callTelegramApi('sendMessage', errParams).catch(() => {});
    }
  }

  // =========================================================================
  // CHAT WHITELIST / IGNORE COMMANDS (/allowchat, /ignorechat, /allowedchats)
  // =========================================================================
  private static async handleAllowChatCommand(
    fromId: string,
    replyChatId: number | string,
    text: string,
    contextChat?: any
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can manage the chat whitelist.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    const rawArgs = text.replace(/^\/allowchat(?:@\w+)?/i, '').trim();
    let targetChatId = '';
    let customLabel = '';

    if (rawArgs) {
      const tokens = rawArgs.split(/\s+/);
      targetChatId = tokens[0].trim();
      customLabel = tokens.slice(1).join(' ').trim();
    } else if (contextChat && contextChat.id && contextChat.type !== 'private') {
      targetChatId = String(contextChat.id).trim();
      customLabel = contextChat.title || contextChat.username || '';
    }

    if (!targetChatId || !/^-?\d+$/.test(targetChatId)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text:
          `ℹ️ <b>Allow / Whitelist Chat Usage</b>\n\n` +
          `Send: <code>/allowchat &lt;chat_id&gt; [optional name]</code>\n` +
          `Example: <code>/allowchat -1001234567890 VIP Group</code>\n\n` +
          `<i>Note: Adding a chat ID automatically enables strict Whitelist mode so all unlisted groups/channels are silently ignored.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    let resolvedTitle = customLabel;
    let resolvedType: 'group' | 'supergroup' | 'channel' = 'supergroup';
    let resolvedUsername: string | undefined;

    try {
      const chatRes = await this.callTelegramApi('getChat', { chat_id: Number(targetChatId) });
      if (chatRes?.ok && chatRes.result) {
        resolvedTitle = resolvedTitle || chatRes.result.title || chatRes.result.username || '';
        if (chatRes.result.type === 'group' || chatRes.result.type === 'channel' || chatRes.result.type === 'supergroup') {
          resolvedType = chatRes.result.type;
        }
        if (chatRes.result.username) {
          resolvedUsername = `@${String(chatRes.result.username).replace(/^@/, '')}`;
        }
      }
    } catch {}

    const updatedSettings = await storage.addAllowedChat(
      targetChatId,
      resolvedTitle || `Chat ${targetChatId}`,
      resolvedType,
      fromId,
      true
    );
    const list = Array.isArray(updatedSettings.allowedChats) ? updatedSettings.allowedChats : [];

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text:
        `✅ <b>Chat Added to Whitelist</b>\n\n` +
        `• 🏷️ <b>Title:</b> <code>${this.escapeHtml(resolvedTitle || `Chat ${targetChatId}`)}</code>\n` +
        `• 🆔 <b>Chat ID:</b> <code>${this.escapeHtml(targetChatId)}</code>\n` +
        `• 🛡️ <b>Strict Whitelist Guard:</b> <code>Active</code> 🟢\n` +
        `• 📊 <b>Total Allowed Chats:</b> <code>${list.length}</code>`,
      parse_mode: 'HTML'
    });
  }

  private static async handleIgnoreChatCommand(
    fromId: string,
    replyChatId: number | string,
    text: string,
    contextChat?: any
  ): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ <b>Access Denied</b>\n<i>Only authorized administrators can manage the chat whitelist.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    const rawArg = text.replace(/^\/ignorechat(?:@\w+)?/i, '').trim().split(/\s+/)[0] || '';
    const targetChatId = rawArg || (contextChat && contextChat.type !== 'private' ? String(contextChat.id) : '');

    if (!targetChatId || !/^-?\d+$/.test(targetChatId)) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text:
          `ℹ️ <b>Ignore / Remove Chat Usage</b>\n\n` +
          `Send: <code>/ignorechat &lt;chat_id&gt;</code>\n` +
          `Example: <code>/ignorechat -1001234567890</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    const removal = await storage.removeAllowedChat(targetChatId);
    const remainingList = Array.isArray(removal.settings?.allowedChats) ? removal.settings.allowedChats : [];
    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text:
        `🔇 <b>Chat Removed from Whitelist</b>\n\n` +
        `• 🆔 <b>Chat ID:</b> <code>${this.escapeHtml(targetChatId)}</code>\n` +
        `• 📊 <b>Remaining Allowed Chats:</b> <code>${remainingList.length}</code>\n\n` +
        `<i>When Strict Whitelist Guard is active, the bot will now completely ignore all activity in this chat.</i>`,
      parse_mode: 'HTML'
    });
  }

  private static async handleAllowedChatsCommand(fromId: string, replyChatId: number | string): Promise<void> {
    const isAdmin = await this.isAuthorizedAdmin(fromId);
    if (!isAdmin) {
      await this.callTelegramApi('sendMessage', {
        chat_id: replyChatId,
        text: '⛔ <b>Access Denied</b>',
        parse_mode: 'HTML'
      });
      return;
    }

    const settings = await storage.getSettings();
    const list = await storage.getAllowedChats();
    const statusLabel = settings.chatWhitelistEnabled ? '🟢 <code>ENABLED (Strict Ignore Active)</code>' : '⚪ <code>DISABLED (Allow All Chats)</code>';

    const lines = list.length > 0
      ? list.map((c, idx) => `${idx + 1}. <code>${this.escapeHtml(c.title || 'Chat')}</code> — <code>${this.escapeHtml(c.id)}</code>`).join('\n')
      : '<i>No whitelisted chat IDs configured yet.</i>';

    await this.callTelegramApi('sendMessage', {
      chat_id: replyChatId,
      text:
        `🛡️ <b>Chat Whitelist Status</b>\n` +
        `• <b>Guard:</b> ${statusLabel}\n` +
        `• <b>Whitelisted Chats (<code>${list.length}</code>):</b>\n\n` +
        `${lines}\n\n` +
        `<i>Commands:</i>\n<code>/allowchat &lt;chat_id&gt; [name]</code>\n<code>/ignorechat &lt;chat_id&gt;</code>`,
      parse_mode: 'HTML'
    });
  }

  // =========================================================================
  // ADMIN COMMANDS
  // =========================================================================
  private static async handleSetPasswordCommand(fromId: string, chatId: string | number, text: string): Promise<void> {
    const isAuthorized = await this.isAuthorizedAdmin(fromId);
    if (!isAuthorized) {
      console.warn('[Telegram] /setpassword rejected: unauthorized sender telegramId:', fromId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Access Denied</b>\n<i>You must be an authorized admin to use <code>/setpassword</code>.</i>',
        parse_mode: 'HTML'
      });
      return;
    }
    await storage.loadLatest(true);
    const settings = await storage.getSettings();
    const admin = await storage.getAdmin(fromId);
    const isMainBot = this.isMainBotContext();
    const rootAdminId = isMainBot
      ? String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || settings.rootAdminId || '8153757163').trim()
      : String(settings.rootAdminId || '').trim();
    const isRoot = Boolean(rootAdminId && (fromId === rootAdminId || rootAdminId.split(',').map(s => s.trim()).includes(fromId)));
    const isFirstAdmin = isMainBot && !rootAdminId && (await storage.getAdmins()).length === 0;

    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ <b>Usage</b>\n<code>/setpassword &lt;new_password&gt;</code>',
        parse_mode: 'HTML'
      });
      return;
    }

    const newPassword = parts.slice(1).join(' ').trim();
    if (newPassword.length < 6) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Invalid Password</b>\n<i>Password must be at least <code>6</code> characters long.</i>',
        parse_mode: 'HTML'
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
        text: '❌ <b>Storage Error</b>\n<i>Failed to update password in persistent storage. Please try again.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    console.info('[Telegram] /setpassword successfully updated and saved for admin telegramId:', fromId);
    const templates = await storage.getTemplates();
    const tpl = templates.PASSWORD_UPDATED?.content || '✅ <b>Password Updated</b>\n<i>Your Admin Panel password has been changed. You can now log in securely.</i>';
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: tpl,
      parse_mode: 'HTML'
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

  private static formatFileSizeCompact(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private static getFileTypeEmoji(fileType?: string): string {
    if (fileType === 'photo') return '🖼️';
    if (fileType === 'video') return '🎬';
    if (fileType === 'audio') return '🎵';
    return '📄';
  }

  private static appendFileToSession(session: AddSession, media: AddFileEntry): boolean {
    if (!Array.isArray(session.filesData)) {
      session.filesData = session.fileData ? [session.fileData] : [];
    }
    const alreadyExists = session.filesData.some((f) =>
      (media.fileUniqueId && f.fileUniqueId && f.fileUniqueId === media.fileUniqueId) ||
      f.fileId === media.fileId
    );
    if (!alreadyExists) {
      session.filesData.push(media);
    }
    session.fileData = session.filesData[0];
    session.type = 'file';
    session.isTextOnly = false;
    return !alreadyExists;
  }

  private static buildMultiFileCollectorPrompt(session: AddSession): { text: string; replyMarkup: any } {
    const files = Array.isArray(session.filesData) && session.filesData.length > 0
      ? session.filesData
      : (session.fileData ? [session.fileData] : []);

    if (files.length === 0) {
      return {
        text: `📤 <b>Send File(s) — Multi-File Mode</b>\n\nPlease send one or more files (Document, Photo, Video, Audio, APK, or ZIP).\n<i>You can send multiple files one-by-one or as an album, then tap Done when finished.</i>`,
        replyMarkup: {
          inline_keyboard: [
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        }
      };
    }

    const maxPreview = 12;
    const displayStart = files.length > maxPreview ? files.length - maxPreview : 0;
    const lines = files.slice(displayStart).map((f, idx) => {
      const num = displayStart + idx + 1;
      const emoji = this.getFileTypeEmoji(f.fileType);
      const name = this.escapeHtml(f.fileName || `File ${num}`);
      const sizeStr = f.fileSize ? ` (<code>${this.formatFileSizeCompact(f.fileSize)}</code>)` : '';
      return `${num}. ${emoji} <code>${name}</code>${sizeStr}`;
    });
    const prefixNotice = displayStart > 0 ? `<i>...plus ${displayStart} earlier file${displayStart === 1 ? '' : 's'}</i>\n` : '';

    return {
      text:
        `📦 <b>Files Collected (${files.length})</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `${prefixNotice}${lines.join('\n')}\n\n` +
        `➕ <i>Send more files (or an album) to keep adding to this batch, or tap <b>✅ Done — Continue</b> below to configure triggers &amp; save all ${files.length} file${files.length === 1 ? '' : 's'}.</i>`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: `✅ Done — Continue (${files.length} ${files.length === 1 ? 'File' : 'Files'})`, callback_data: 'add_files_done', style: 'success' }],
          [
            { text: '🗑️ Remove Last', callback_data: 'add_files_pop', style: 'primary' },
            { text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }
          ]
        ]
      }
    };
  }

  private static async promptTriggerTypeStep(
    fromId: string,
    chatId: string | number,
    session: AddSession
  ): Promise<void> {
    const filesCount = session.type === 'file' && !session.isTextOnly
      ? (session.filesData?.length || (session.fileData ? 1 : 0))
      : 0;
    const isLink = session.type === 'link';
    const stepHeader = isLink ? 'Step 1/7' : 'Step 1/4';
    const headerLine = isLink
      ? `✅ <b>Link Received:</b> <code>${this.escapeHtml(session.linkData?.url || '')}</code>`
      : session.isTextOnly
      ? `✅ <b>Text Response Ready</b>`
      : filesCount > 1
      ? `📦 <b>Batch Ready:</b> <code>${filesCount} Files</code>`
      : `✅ <b>File Received:</b> <code>${this.escapeHtml(session.filesData?.[0]?.fileName || session.fileData?.fileName || 'File')}</code>`;

    session.stage = 'awaiting_trigger_type';
    const promptId = await TelegramService.sendOrEditSetupPrompt(
      chatId,
      `${headerLine}\n\n<b>${stepHeader}: Trigger Type Selection</b>\n<i>Choose whether the trigger will be a Hashtag (<code>#</code>), Slash Command (<code>/</code>), or Normal Text:</i>`,
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
  }

  private static async handleAddCommand(
    fromId: string,
    chatId: string | number,
    message?: any,
    text?: string
  ): Promise<void> {
    const isAuthorized = await this.isAuthorizedAdmin(fromId, message?.from?.username);
    const admin = await storage.getAdmin(fromId);
    const hasPermission = isAuthorized && (!admin || admin.role === 'owner' || admin.permissions?.files_add !== false);

    if (!hasPermission) {
      if (String(chatId).startsWith('-')) {
        return;
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `⛔ <b>Access Denied</b>\n<i>You are not an authorized administrator.</i>\n• 🆔 <b>Your Telegram ID:</b> <code>${this.escapeHtml(fromId)}</code>\n<i>Ask an administrator to add your ID or sign in via web.</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    // Delete the /add command message cleanly so chat remains uncluttered
    if (message?.message_id) {
      await this.deleteUserMessage(chatId, message.message_id);
    }

    await withAddSessionLock(fromId, async () => {
      // Ensure any channel connection session is cleared so /add strictly processes content
      activeSetChannelSessions.delete(fromId);

      const replyMsg = message?.reply_to_message;
      const media = this.extractMediaFromMessage(message) || (replyMsg ? this.extractMediaFromMessage(replyMsg) : null);
      const rawInput = (text || message?.caption || replyMsg?.text || replyMsg?.caption || '').trim();
      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);

      if (media) {
        const cleanCaption = (message?.caption && !/^(?:\/|#)?(?:add)/i.test(message.caption) ? message.caption : replyMsg?.caption) || undefined;
        const entry: AddFileEntry = { ...media, caption: cleanCaption };
        const sessionData: AddSession = {
          stage: 'awaiting_file_content',
          type: 'file',
          isTextOnly: false,
          fileData: entry,
          filesData: [entry],
          caption: cleanCaption
        };

        const collector = this.buildMultiFileCollectorPrompt(sessionData);
        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          collector.text,
          collector.replyMarkup,
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

        await this.promptTriggerTypeStep(fromId, chatId, sessionData);
        return;
      }

      // Command Entry: When an admin types /add, the bot asks what they want to add
      const sessionData: AddSession = { stage: 'awaiting_content', filesData: [] };
      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        `📥 <b>What would you like to add?</b>\n\nChoose an option below or send your content directly:\n• <b>File(s):</b> Send 1 or multiple Documents, Photos, Videos, Audio, APKs, ZIPs\n• <b>Link:</b> Website URL (https://...)\n• <b>Text Response:</b> Custom text / message`,
        {
          inline_keyboard: [
            [
              { text: '📁 Add File(s)', callback_data: 'add_choose_file', style: 'primary' },
              { text: '🔗 Add Link', callback_data: 'add_choose_link', style: 'primary' },
              { text: '💬 Add Text', callback_data: 'add_choose_text', style: 'primary' }
            ],
            [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
          ]
        },
        sessionData
      );
      if (promptId) sessionData.lastPromptMessageId = promptId;
      activeAddSessions.set(fromId, sessionData);
      await storage.saveAddSession(fromId, sessionData);
    });
  }

  private static async handleActiveAddSessionMessage(
    message: any,
    fromId: string,
    chatId: string | number,
    text: string,
    _initialSession: AddSession
  ): Promise<void> {
    // Automatically delete user's intermediate input message so chat remains in a single dynamic bubble
    if (message?.message_id) {
      await this.deleteUserMessage(chatId, message.message_id);
    }

    await withAddSessionLock(fromId, async () => {
      let session = activeAddSessions.get(fromId);
      if (!session) {
        session = await storage.getAddSession(fromId);
        if (session) activeAddSessions.set(fromId, session);
      }
      if (!session) return;

      const rawInput = text.trim();

      // Stage 1: Awaiting Content Choice (Detects File, Link, or Pure Text)
      if (session.stage === 'awaiting_content') {
        const media = this.extractMediaFromMessage(message);
        if (media) {
          const fileCaption = message.caption && !/^(?:\/|#)?(?:add)/i.test(message.caption) ? message.caption : undefined;
          const entry: AddFileEntry = { ...media, caption: fileCaption };
          this.appendFileToSession(session, entry);
          if (fileCaption && !session.caption) {
            session.caption = fileCaption;
          }
          session.stage = 'awaiting_file_content';

          const collector = this.buildMultiFileCollectorPrompt(session);
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            collector.text,
            collector.replyMarkup,
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
          await this.promptTriggerTypeStep(fromId, chatId, session);
          return;
        }

        // If user typed normal text (no file and no URL), automatically treat it as a Text Response!
        if (rawInput) {
          session.type = 'file';
          session.isTextOnly = true;
          session.caption = rawInput;
          session.textResponse = rawInput;
          session.fileName = 'Text: ' + (rawInput.slice(0, 25).replace(/\n/g, ' '));
          session.stage = 'awaiting_trigger_type';

          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `✅ <b>Text Response Received:</b>\n<blockquote>${this.escapeHtml(rawInput.slice(0, 100))}${rawInput.length > 100 ? '...' : ''}</blockquote>\n\n<b>Step 1/4: Trigger Type Selection</b>\n<i>Choose whether the trigger will be a Hashtag (<code>#</code>), Slash Command (<code>/</code>), or Normal Text:</i>`,
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
          '📥 Please send one or more <b>Files</b>, a <b>Web Link (URL)</b>, or enter a <b>Text Message</b> to deliver (or type /cancel to abort):',
          {
            inline_keyboard: [
              [
                { text: '📁 Add File(s)', callback_data: 'add_choose_file', style: 'primary' },
                { text: '🔗 Add Link', callback_data: 'add_choose_link', style: 'primary' },
                { text: '💬 Add Text', callback_data: 'add_choose_text', style: 'primary' }
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

      // Stage 1a: Explicitly awaiting file content (PATH A - Multi-File Batch & Sequence Support)
      if (session.stage === 'awaiting_file_content') {
        const media = this.extractMediaFromMessage(message);
        if (media) {
          const fileCaption = message.caption && !/^(?:\/|#)?(?:add)/i.test(message.caption) ? message.caption : undefined;
          const entry: AddFileEntry = { ...media, caption: fileCaption };
          this.appendFileToSession(session, entry);
          if (fileCaption && !session.caption) {
            session.caption = fileCaption;
          }

          const collector = this.buildMultiFileCollectorPrompt(session);
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            collector.text,
            collector.replyMarkup,
            session
          );
          if (promptId) session.lastPromptMessageId = promptId;
          activeAddSessions.set(fromId, session);
          await storage.saveAddSession(fromId, session);
          return;
        }

        const existingCount = Array.isArray(session.filesData) && session.filesData.length > 0
          ? session.filesData.length
          : (session.fileData ? 1 : 0);

        const lowerCmd = rawInput.toLowerCase();
        if (existingCount > 0 && (lowerCmd === '/done' || lowerCmd === 'done' || lowerCmd === 'next' || lowerCmd === 'finish')) {
          await this.promptTriggerTypeStep(fromId, chatId, session);
          return;
        }

        if (existingCount > 0) {
          const collector = this.buildMultiFileCollectorPrompt(session);
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `${collector.text}\n\n💡 <i>Send more files or tap <b>✅ Done — Continue</b> (or send <code>done</code>).</i>`,
            collector.replyMarkup,
            session
          );
          if (promptId) session.lastPromptMessageId = promptId;
          activeAddSessions.set(fromId, session);
          await storage.saveAddSession(fromId, session);
          return;
        }

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          '❌ <b>No File Detected</b>\n<i>Please send one or more Documents, Photos, Videos, or Audio files, or send <code>/cancel</code> to abort.</i>',
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
          `✅ <b>Link Received:</b> <code>${this.escapeHtml(urlMatch[0])}</code>\n\n<b>Step 1/7: Trigger Type Selection</b>\n<i>Choose whether the trigger will be a Hashtag (<code>#</code>), Slash Command (<code>/</code>), or Normal Text:</i>`,
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
        '❌ <b>Invalid URL</b>\n<i>Please send a valid web link starting with <code>https://</code> or <code>http://</code> (or send <code>/cancel</code>).</i>',
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

    // Stage 1c: Explicitly awaiting text content (PATH C)
    if (session.stage === 'awaiting_text_content') {
      if (rawInput) {
        session.type = 'file';
        session.isTextOnly = true;
        session.caption = rawInput;
        session.textResponse = rawInput;
        session.fileName = 'Text: ' + (rawInput.slice(0, 25).replace(/\n/g, ' '));
        session.stage = 'awaiting_trigger_type';

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `✅ <b>Text Response Received:</b>\n<blockquote>${this.escapeHtml(rawInput.slice(0, 100))}${rawInput.length > 100 ? '...' : ''}</blockquote>\n\n<b>Step 1/4: Trigger Type Selection</b>\n<i>Choose whether the trigger will be a Hashtag (<code>#</code>), Slash Command (<code>/</code>), or Normal Text:</i>`,
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
        '❌ Please send a valid text message (or type /cancel to abort):',
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
      session.buttonText = customBtn ? customBtn.trim() : 'Open Link';
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
        await this.promptSetupVideoChoice(fromId, chatId, session);
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
      await this.promptSetupVideoChoice(fromId, chatId, session);
      return;
    }

    // Stage 6: Awaiting setup video decision (Yes / No)
    if (session.stage === 'awaiting_setup_video_choice') {
      const lower = rawInput.toLowerCase();
      if (lower === '1' || lower === 'yes' || lower === 'y' || lower.includes('add')) {
        session.hasSetupVideo = true;
        session.stage = 'awaiting_setup_video';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        const promptId = await TelegramService.sendOrEditSetupPrompt(
          chatId,
          `🎬 <b>Send Setup Video</b>\n\nPlease provide your setup video tutorial. You can:\n• Send/upload a video directly from your phone/gallery\n• Forward a video from any chat or channel\n• Send a video URL link (e.g. YouTube or direct MP4 link)\n\n<i>Or send /skip to finish without a video, or /cancel to abort.</i>`,
          {
            inline_keyboard: [
              [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
              [{ text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }]
            ]
          },
          session
        );
        if (promptId) {
          session.lastPromptMessageId = promptId;
          await storage.saveAddSession(fromId, session);
        }
        return;
      } else {
        session.hasSetupVideo = false;
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }
    }

    // Stage 7: Awaiting setup video file, forwarded message, or URL
    if (session.stage === 'awaiting_setup_video') {
      const lower = rawInput.toLowerCase();
      if (lower === '/skip' || lower === 'skip') {
        session.hasSetupVideo = false;
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Direct video message or forwarded video
      if (message.video) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = message.video.file_id;
        session.setupVideoType = 'upload';
        session.setupVideoFileName = message.video.file_name || 'setup_video.mp4';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Video sent as document
      if (message.document && (message.document.mime_type?.startsWith('video/') || /\.(mp4|mov|mkv|avi|webm)$/i.test(message.document.file_name || ''))) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = message.document.file_id;
        session.setupVideoType = 'upload';
        session.setupVideoFileName = message.document.file_name || 'setup_video.mp4';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      // Web URL link (YouTube, Vimeo, MP4, etc.)
      const urlMatch = rawInput.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        session.hasSetupVideo = true;
        session.setupVideoUrl = urlMatch[0];
        session.setupVideoType = 'url';
        await this.finalizeAndSaveItem(fromId, chatId, session);
        return;
      }

      const promptId = await TelegramService.sendOrEditSetupPrompt(
        chatId,
        '❌ Invalid input. Please send/forward a video file, or send a valid URL starting with http:// or https:// (or tap Skip Video below):',
        {
          inline_keyboard: [
            [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
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
    });
  }

  // Prompt admin for Setup Video choice during /add wizard
  private static async promptSetupVideoChoice(
    fromId: string,
    chatId: string | number,
    session: AddSession
  ): Promise<void> {
    session.stage = 'awaiting_setup_video_choice';
    activeAddSessions.set(fromId, session);
    await storage.saveAddSession(fromId, session);

    const promptId = await TelegramService.sendOrEditSetupPrompt(
      chatId,
      `🎬 <b>Setup Video Configuration</b>\n\nDo you want to add a setup video? (Yes / No)\n\n<i>When enabled, users will see an interactive menu with [ 🎬 Setup Video ] and [ ${session.type === 'file' ? '📁 Get File' : '🔗 Open Link'} ] buttons.</i>`,
      {
        inline_keyboard: [
          [
            { text: '1. Yes, Add Setup Video', callback_data: 'add_sv_yes', style: 'success' },
            { text: '2. No, Skip (Direct Delivery)', callback_data: 'add_sv_no', style: 'primary' }
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

  // Final Step: Save item(s) (Single or Batch Files, Text, or Link) and notify user with summary & test button
  private static async finalizeAndSaveItem(
    fromId: string,
    chatId: string | number,
    session: AddSession
  ): Promise<void> {
    const rawKeyword = session.rawKeyword || (session.trigger ? session.trigger.replace(/^[#/]+/, '') : 'item');
    const triggerType: TriggerType = session.triggerType || 'hashtag';
    const formatTrigger = (kw: string) =>
      triggerType === 'hashtag' ? `#${kw}` : triggerType === 'slash' ? `/${kw}` : kw;
    const primaryTrigger = session.trigger || formatTrigger(rawKeyword);
    const triggers = [primaryTrigger];

    await storage.loadLatest(true);
    const isFile = session.type === 'file';
    const collectedFiles = isFile && !session.isTextOnly
      ? (Array.isArray(session.filesData) && session.filesData.length > 0
          ? session.filesData
          : (session.fileData ? [session.fileData] : []))
      : [];
    const isTextOnly = Boolean(session.isTextOnly || (isFile && collectedFiles.length === 0));
    const baseTimestamp = Date.now().toString(36);
    const retentionType = session.retentionType || 'permanent';
    const retentionDays = retentionType === 'temporary' ? (session.retentionDays || 7) : undefined;
    const expiresAt = retentionType === 'temporary'
      ? new Date(Date.now() + (retentionDays || 7) * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const inFiltersList = session.inFiltersList === true;
    const openMode: OpenMode = session.openMode || 'browser';

    const hasSetupVideo = Boolean(session.hasSetupVideo && session.setupVideoUrl);
    const setupVideoUrl = hasSetupVideo ? session.setupVideoUrl : undefined;
    const setupVideoTelegramFileId = (hasSetupVideo && setupVideoUrl && !/^https?:\/\//i.test(setupVideoUrl) && !setupVideoUrl.startsWith('upload_') && !setupVideoUrl.startsWith('local_') && !setupVideoUrl.startsWith('phone_'))
      ? setupVideoUrl
      : undefined;
    const setupVideoType = hasSetupVideo ? (session.setupVideoType || 'url') : undefined;
    const setupVideoFileName = hasSetupVideo ? session.setupVideoFileName : undefined;
    const setupVideoButtonText = hasSetupVideo ? '🎬 Setup Video' : undefined;
    const setupResourceButtonText = hasSetupVideo ? (isFile ? (isTextOnly ? '💬 View Message' : '📁 Get File') : '🔗 Open Link') : undefined;

    const savedItems: ItemRecord[] = [];

    if (isFile && isTextOnly) {
      const textContent = session.textResponse || session.caption || rawKeyword;
      const cleanSnippet = textContent.replace(/\n/g, ' ').trim();
      const textTitle = session.fileName || `Text: ${cleanSnippet.slice(0, 25)}${cleanSnippet.length > 25 ? '...' : ''}`;
      const newItem: ItemRecord = {
        id: `t_${baseTimestamp}`,
        type: 'file',
        name: textTitle,
        triggers,
        triggerType,
        rawKeyword,
        inFiltersList,
        isTextOnly: true,
        fileEnabled: false,
        caption: session.caption || session.textResponse || undefined,
        replyMessage: session.caption || session.textResponse || undefined,
        buttonText: '💬 View Message',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active',
        deliveryCount: 0,
        retentionType,
        retentionDays,
        expiresAt,
        hasSetupVideo,
        setupVideoUrl,
        setupVideoTelegramFileId,
        setupVideoType,
        setupVideoFileName,
        setupVideoButtonText,
        setupResourceButtonText
      };
      await storage.saveItem(newItem);
      savedItems.push(newItem);
    } else if (isFile) {
      const nameCounts = new Map<string, number>();
      for (const f of collectedFiles) {
        const key = (f.fileName || 'Uploaded File').trim();
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
      }
      const seenNames = new Map<string, number>();

      for (let i = 0; i < collectedFiles.length; i++) {
        const entry = collectedFiles[i];
        const baseName = (entry.fileName || 'Uploaded File').trim();
        const totalWithSameName = nameCounts.get(baseName) || 1;
        const seenIdx = (seenNames.get(baseName) || 0) + 1;
        seenNames.set(baseName, seenIdx);
        const itemName = totalWithSameName > 1 ? `${baseName} (${seenIdx})` : baseName;

        const itemKeyword = collectedFiles.length > 1 && i > 0 ? `${rawKeyword}${i + 1}` : rawKeyword;
        const itemTrigger = formatTrigger(itemKeyword);
        const itemId = collectedFiles.length > 1 ? `f_${baseTimestamp}_${i + 1}` : `f_${baseTimestamp}`;
        const itemCaption = entry.caption || session.caption || undefined;

        const newItem: ItemRecord = {
          id: itemId,
          type: 'file',
          name: itemName,
          triggers: [itemTrigger],
          triggerType,
          rawKeyword: itemKeyword,
          inFiltersList,
          isTextOnly: false,
          fileEnabled: true,
          telegramFileId: entry.fileId,
          telegramFileUniqueId: entry.fileUniqueId,
          fileType: entry.fileType || 'document',
          fileName: entry.fileName || itemName,
          fileSize: entry.fileSize || 0,
          mimeType: entry.mimeType || 'application/octet-stream',
          caption: itemCaption,
          replyMessage: itemCaption,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
          deliveryCount: 0,
          retentionType,
          retentionDays,
          expiresAt,
          hasSetupVideo,
          setupVideoUrl,
          setupVideoTelegramFileId,
          setupVideoType,
          setupVideoFileName,
          setupVideoButtonText,
          setupResourceButtonText
        };
        await storage.saveItem(newItem);
        savedItems.push(newItem);
      }
    } else {
      const url = session.linkData?.url || 'https://';
      const name = session.linkData?.name || `Link (${rawKeyword})`;
      const defaultBtn = openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link';
      const rawBtn = session.buttonText || session.linkData?.buttonText || defaultBtn;
      const buttonText = (rawBtn && rawBtn.trim()) ? rawBtn.trim() : defaultBtn;
      const defaultReply = `🔗 Here is your requested link: ${url}`;
      const replyMessage = session.replyMessage || session.linkData?.replyMessage || session.caption || defaultReply;
      const newItem: ItemRecord = {
        id: `l_${baseTimestamp}`,
        type: 'link',
        name,
        url,
        openMode,
        buttonText,
        replyMessage,
        caption: replyMessage,
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
        expiresAt,
        hasSetupVideo,
        setupVideoUrl,
        setupVideoTelegramFileId,
        setupVideoType,
        setupVideoFileName,
        setupVideoButtonText,
        setupResourceButtonText
      };
      await storage.saveItem(newItem);
      savedItems.push(newItem);
    }

    const botUsername = await this.getBotUsername();
    const cleanBot = botUsername.replace(/^@/, '');

    const retentionDesc = retentionType === 'temporary'
      ? `Temporary (${retentionDays} days — auto-deleted upon expiry)`
      : 'Permanent (never deleted)';

    const filterStatus = inFiltersList
      ? 'Yes (Visible in /filters list)'
      : 'No (Hidden from public /filters)';

    const typeDesc = isFile
      ? (isTextOnly ? '💬 Text Response' : savedItems.length > 1 ? `📦 Batch (${savedItems.length} Files)` : '📁 File')
      : '🔗 Web Link';

    const deliveryDesc = isFile
      ? (isTextOnly ? 'Direct Text Message Response' : 'Direct Telegram Document / Media File')
      : (openMode === 'webapp' ? 'Telegram Mini App (Embedded)' : 'Standard Web Browser');

    const setupVideoDesc = hasSetupVideo
      ? `🎬 Enabled (${setupVideoType === 'url' ? 'URL Link' : 'Uploaded Video'})`
      : 'None (Direct Delivery)';

    const primarySaved = savedItems[0];
    let successText: string;

    if (savedItems.length === 1) {
      const payload = getItemPayload(primarySaved);
      const deepLink = `https://t.me/${cleanBot}?start=${payload}`;
      successText =
        `✅ <b>Saved Successfully</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• 🏷️ <b>Type:</b> <code>${this.escapeHtml(typeDesc)}</code>\n` +
        `• 📦 <b>Name:</b> <code>${this.escapeHtml(primarySaved.name)}</code>\n` +
        `• 🎯 <b>Trigger:</b> <code>${this.escapeHtml(primaryTrigger)}</code> (<code>${this.escapeHtml(triggerType)}</code>)\n` +
        `• 📁 <b>Public Filters:</b> <code>${this.escapeHtml(filterStatus)}</code>\n` +
        `• 📡 <b>Delivery Mode:</b> <code>${this.escapeHtml(deliveryDesc)}</code>\n` +
        `• ⏳ <b>Retention:</b> <code>${this.escapeHtml(retentionDesc)}</code>\n` +
        `• 🎬 <b>Setup Video:</b> <code>${this.escapeHtml(setupVideoDesc)}</code>\n\n` +
        `🔗 <b>Direct Link:</b>\n<code>${this.escapeHtml(deepLink)}</code>\n\n` +
        `💡 <i>Type <code>${this.escapeHtml(primaryTrigger)}</code> in any group or here to test delivery!</i>`;
    } else {
      const maxSummaryItems = 12;
      const itemLines = savedItems.slice(0, maxSummaryItems).map((it, idx) => {
        const p = getItemPayload(it);
        const link = `https://t.me/${cleanBot}?start=${p}`;
        const trig = it.triggers?.[0] || primaryTrigger;
        return `${idx + 1}. ${this.getFileTypeEmoji(it.fileType)} <code>${this.escapeHtml(it.name)}</code> — <code>${this.escapeHtml(trig)}</code>\n   🔗 <code>${this.escapeHtml(link)}</code>`;
      });
      const overflowNote = savedItems.length > maxSummaryItems
        ? `\n<i>...and ${savedItems.length - maxSummaryItems} more saved files (view all via /allfile or Admin Panel)</i>`
        : '';

      successText =
        `✅ <b>Saved ${savedItems.length} Files Successfully</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `• 🏷️ <b>Type:</b> <code>${this.escapeHtml(typeDesc)}</code>\n` +
        `• 🎯 <b>Triggers:</b> <code>${this.escapeHtml(primaryTrigger)}</code> → <code>${this.escapeHtml(savedItems[savedItems.length - 1].triggers?.[0] || '')}</code> (<code>${this.escapeHtml(triggerType)}</code>)\n` +
        `• 📁 <b>Public Filters:</b> <code>${this.escapeHtml(filterStatus)}</code>\n` +
        `• ⏳ <b>Retention:</b> <code>${this.escapeHtml(retentionDesc)}</code>\n` +
        `• 🎬 <b>Setup Video:</b> <code>${this.escapeHtml(setupVideoDesc)}</code>\n\n` +
        `${itemLines.join('\n')}${overflowNote}\n\n` +
        `💡 <i>Type any trigger above in group/DM or check /allfile!</i>`;
    }

    const successMarkup = {
      inline_keyboard: [
        [
          {
            text: savedItems.length > 1 ? 'Test First Delivery' : 'Test Delivery',
            callback_data: `test_delivery_${primarySaved.id}`,
            style: 'primary'
          }
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

    // FREE FIRE CHECK GUILD INFO CALLBACK (guild_<uid>) — No alert popups; toggles cleanly to Check Leader Info
    if (data && /^guild_(\d+)$/i.test(data)) {
      const uidMatch = data.match(/^guild_(\d+)$/i);
      const targetUid = uidMatch ? uidMatch[1] : '';
      await this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
      try {
        const playerData = await this.fetchFreeFirePlayer(targetUid);
        if (!playerData) {
          if (chatId && cb.message?.message_id) {
            await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: cb.message.message_id,
              text: '❌ <b>Player not found or API service is busy.</b> Please try again later.',
              parse_mode: 'HTML'
            }).catch(() => {});
          }
          return;
        }

        const guild = this.extractGuildInfo(playerData);
        if (!guild.hasGuild) {
          if (chatId && cb.message?.message_id) {
            const noGuildText = [
              this.formatFreeFirePlayerMessage(playerData, targetUid),
              '',
              'ℹ️ <i>No guild found in this account.</i>'
            ].join('\n');
            await this.callTelegramApi('editMessageText', {
              chat_id: chatId,
              message_id: cb.message.message_id,
              text: noGuildText,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🛡 Check Guild Info', callback_data: `guild_${targetUid}`, style: 'primary' }]
                ]
              }
            }).catch(() => {});
          }
          return;
        }

        const guildKey = guild.id || guild.leaderUid || targetUid;
        if (this.freeFireGuildCache.size > 200) {
          const oldest = this.freeFireGuildCache.keys().next().value;
          if (oldest) this.freeFireGuildCache.delete(oldest);
        }
        this.freeFireGuildCache.set(guildKey, { guild, sourceUid: targetUid, playerData });

        if (chatId && cb.message?.message_id) {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: this.formatGuildInfoMessage(guild, targetUid),
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👑 Check Leader Info', callback_data: `leader_${guildKey}`, style: 'primary' }]
              ]
            }
          }).catch(() => {});
        }
      } catch (err: any) {
        console.warn('[FreeFireUID] Guild callback error:', err?.message || err);
      }
      return;
    }

    // FREE FIRE CHECK GUILD LEADER INFO CALLBACK (leader_<guild_id>) — Fetches leader profile & toggles back to Check Guild Info
    if (data && /^leader_(.+)$/i.test(data)) {
      const leaderMatch = data.match(/^leader_(.+)$/i);
      const guildKey = leaderMatch ? leaderMatch[1].trim() : '';
      await this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
      try {
        let cachedEntry = this.freeFireGuildCache.get(guildKey);
        if (!cachedEntry) {
          const msgText = String(cb.message?.text || '');
          const playerUidFromMsg = msgText.match(/Player UID:\s*(\d+)/i)?.[1] || msgText.match(/UID:\s*(\d+)/i)?.[1];
          if (playerUidFromMsg) {
            const pData = await this.fetchFreeFirePlayer(playerUidFromMsg);
            if (pData) {
              const extracted = this.extractGuildInfo(pData);
              if (extracted.hasGuild) {
                cachedEntry = { guild: extracted, sourceUid: playerUidFromMsg, playerData: pData };
                this.freeFireGuildCache.set(guildKey, cachedEntry);
              }
            }
          }
        }

        if (!cachedEntry) {
          return;
        }

        const { guild, sourceUid } = cachedEntry;
        const leaderUid = guild.leaderUid || sourceUid;
        const liveLeaderData = leaderUid && /^\d+$/.test(leaderUid)
          ? await this.fetchFreeFirePlayer(leaderUid)
          : null;
        const leaderPayload = liveLeaderData || guild.leaderFallback;

        if (chatId && cb.message?.message_id && leaderPayload) {
          const leaderProfileHtml = this.formatFreeFirePlayerMessage(
            leaderPayload,
            leaderUid,
            '👑 <b>GUILD LEADER PROFILE</b>'
          );
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: leaderProfileHtml,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛡 Check Guild Info', callback_data: `guild_${sourceUid}`, style: 'primary' }]
              ]
            }
          }).catch(() => {});
        }
      } catch (err: any) {
        console.warn('[FreeFireUID] Leader callback error:', err?.message || err);
      }
      return;
    }

    // SELECT BOT MODE DURING INTERACTIVE CLONE WIZARD
    if (data && data.startsWith('clone_mode:')) {
      if (!this.isMainBotContext()) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Cloning is only available on the main primary bot.',
          show_alert: true
        });
        return;
      }
      const parts = data.split(':');
      const targetAdminId = parts[1]?.trim() || fromId;
      const chosenMode: BotOperationalMode = parts[2] === 'post_bot' ? 'post_bot' : 'file_bot';
      if (targetAdminId !== fromId && !(await this.isAuthorizedAdmin(fromId, cb.from?.username))) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Only the admin who started cloning can select the mode.',
          show_alert: true
        });
        return;
      }
      const session = activeCloneSessions.get(targetAdminId) || activeCloneSessions.get(fromId);
      if (!session) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Clone session expired. Send /clone <token> again.',
          show_alert: true
        });
        return;
      }
      session.botMode = chosenMode;
      session.stage = 'awaiting_owner';
      activeCloneSessions.set(targetAdminId, session);
      const modeLabel = chosenMode === 'post_bot' ? '📝 Post Bot' : '📁 File Bot';

      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `Mode set: ${chosenMode === 'post_bot' ? 'Post Bot' : 'File Bot'}`
      });

      if (chatId && cb.message?.message_id) {
        await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text:
            `🤖 <b>Bot Token Verified:</b> <code>@${this.escapeHtml(session.botInfo?.username || session.botInfo?.first_name || 'Bot')}</code>\n` +
            `⚙️ <b>Selected Mode:</b> <code>${this.escapeHtml(modeLabel)}</code>\n\n` +
            `👤 <b>Assign Clone Owner</b>\n<i>Reply with the Telegram User ID or Username of the new Owner for this cloned bot.</i>\n\n` +
            `• <b>Examples:</b> <code>123456789</code> or <code>@username</code>`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: `clone_cancel:${targetAdminId}`, style: 'danger' }]]
          }
        }).catch(() => {});
      }
      return;
    }

    // CANCEL INTERACTIVE BOT CLONE OWNER PROMPT
    if (data && data.startsWith('clone_cancel:')) {
      const targetAdminId = data.slice('clone_cancel:'.length).trim();
      if (targetAdminId && targetAdminId !== fromId && !(await this.isAuthorizedAdmin(fromId, cb.from?.username))) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Only the admin who started cloning can cancel this.',
          show_alert: true
        });
        return;
      }
      activeCloneSessions.delete(targetAdminId || fromId);
      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Bot cloning cancelled.'
      });
      if (chatId && cb.message?.message_id) {
        await this.callTelegramApi('editMessageText', {
          chat_id: chatId,
          message_id: cb.message.message_id,
          text: '❌ <i>Bot cloning cancelled.</i>',
          parse_mode: 'HTML'
        }).catch(() => {});
      }
      return;
    }

    // MANDATORY FORCE SUB VERIFICATION CALLBACK
    if (data && data.startsWith('forcesub_verify:')) {
      const targetPayload = data.substring('forcesub_verify:'.length).trim() || 'start';
      this.invalidateForceSubCache(fromId);
      const forceCheck = await this.checkUserForceSub(fromId, cb.from?.username, { forceFresh: true });
      const isRequestOnly = forceCheck.mode === 'request_only';

      if (!forceCheck.allJoined) {
        // Display Telegram pop-up alert prompting user to join or send join request first
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: isRequestOnly
            ? 'Please send a join request to the channel first.'
            : 'Please join all channels or groups to use this bot.',
          show_alert: true
        });
        if (chatId && cb.message?.message_id) {
          await this.sendForceSubPrompt(chatId, forceCheck.unjoinedChannels, targetPayload, cb.message.message_id, cb.from);
        }
        return;
      }

      // User has joined / sent join requests for all required channels!
      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: isRequestOnly
          ? '✅ Join request verified! Unlocking access...'
          : '✅ Membership verified! Unlocking access...',
        show_alert: false
      });

      // Cleanly remove the force-sub prompt message
      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('deleteMessage', {
            chat_id: chatId,
            message_id: cb.message.message_id
          });
        } catch {}
      }

      if (targetPayload && targetPayload !== 'start') {
        await this.handleDeepLinkDelivery(chatId, targetPayload, { skipForceSubCheck: true });
      } else {
        await this.sendStartWelcomeMessage(chatId, fromId, cb.message);
      }
      return;
    }

    // ADMIN ACTION ON USER REPORT: Ban User
    if (data && data.startsWith('admin_ban_user:')) {
      const parts = data.split(':');
      const targetUserId = parts[1];
      const reportId = parts[2];
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (!isAdmin) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Unauthorized: Only admins can perform this action.',
          show_alert: true
        });
        return;
      }

      await storage.setBotUserBanned(targetUserId, true);
      if (reportId) {
        await storage.updateReportStatus(reportId, 'resolved', fromId);
      }

      const allReports = await storage.getReports();
      const report = allReports.find(r => r.id === reportId);
      if (report && report.chatId) {
        try {
          await this.callTelegramApi('banChatMember', {
            chat_id: report.chatId,
            user_id: Number(targetUserId) || targetUserId
          });
        } catch (e) {
          console.warn('[Telegram] banChatMember error:', e);
        }
      }

      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `User ${targetUserId} has been banned.`,
        show_alert: false
      });

      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: `${cb.message.text || ''}\n\n<b>🔨 Resolved:</b> User was BANNED by Admin.`,
            parse_mode: 'HTML'
          });
        } catch {}
      }
      return;
    }

    // ADMIN ACTION ON USER REPORT: Dismiss Report
    if (data && data.startsWith('admin_dismiss_report:')) {
      const parts = data.split(':');
      const reportId = parts[1];
      const isAdmin = await this.isAuthorizedAdmin(fromId);
      if (!isAdmin) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'Unauthorized.',
          show_alert: true
        });
        return;
      }

      if (reportId) {
        await storage.updateReportStatus(reportId, 'dismissed', fromId);
      }

      await this.callTelegramApi('answerCallbackQuery', {
        callback_query_id: cb.id,
        text: 'Report dismissed.',
        show_alert: false
      });

      if (chatId && cb.message?.message_id) {
        try {
          await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: cb.message.message_id,
            text: `${cb.message.text || ''}\n\n<b>✅ Report Dismissed</b> by Admin.`,
            parse_mode: 'HTML'
          });
        } catch {}
      }
      return;
    }

    // INTERACTIVE FILE LISTING & LINK COPYING CALLBACKS (/allfile, /allfiles - ADMIN ONLY)
    if (data && (data.startsWith('fl_p:') || data.startsWith('fl_v:') || data.startsWith('fl_copy:') || data === 'fl_close' || data === 'fl_noop')) {
      const isAdmin = await this.isAuthorizedAdmin(fromId, cb.from?.username);
      if (!isAdmin) {
        await this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⛔ Access Denied: File list retrieval is restricted to administrators only.',
          show_alert: true
        }).catch(() => {});
        return;
      }
      const msgId = cb.message?.message_id;
      const threadId = cb.message?.message_thread_id;
      const isGroupChat = cb.message?.chat?.type === 'group' || cb.message?.chat?.type === 'supergroup';

      if (data === 'fl_noop') {
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        return;
      }

      if (data === 'fl_close') {
        // Respond immediately to dismiss button loading indicator and delete list message
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Closed' }).catch(() => {});
        if (chatId && msgId) {
          await this.callTelegramApi('deleteMessage', {
            chat_id: chatId,
            message_id: msgId
          }).catch(() => {});
        }
        return;
      }

      if (data.startsWith('fl_p:')) {
        const rawPageStr = data.slice('fl_p:'.length).trim();
        const parsedPage = parseInt(rawPageStr, 10);
        const targetPage = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
        // Immediately answer callback query (non-blocking) so Prev / Next / Back / Refresh never hangs
        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        if (chatId) {
          await this.handleFilesListCommand(
            fromId,
            chatId,
            targetPage,
            undefined,
            isGroupChat,
            msgId,
            threadId
          );
        }
        return;
      }

      if (data.startsWith('fl_v:')) {
        const rawRest = data.slice('fl_v:'.length);
        const lastColonIdx = rawRest.lastIndexOf(':');
        const itemId = lastColonIdx > 0 ? rawRest.slice(0, lastColonIdx) : rawRest;
        const returnPage = lastColonIdx > 0 ? Math.max(1, parseInt(rawRest.slice(lastColonIdx + 1), 10) || 1) : 1;

        let item = storage.getItemFast(itemId);
        if (!item) {
          await storage.loadLatest(false);
          item = storage.getItemFast(itemId);
        }
        if (!item) {
          await this.callTelegramApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ File or link no longer exists.',
            show_alert: true
          });
          return;
        }

        this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
        const detail = await this.buildFileDetailView(item, returnPage);
        if (chatId && msgId) {
          const editRes = await this.callTelegramApi('editMessageText', {
            chat_id: chatId,
            message_id: msgId,
            text: detail.text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: detail.primaryKeyboard }
          });
          if (!editRes?.ok) {
            const editDesc = String(editRes?.description || '').toLowerCase();
            if (!editDesc.includes('not modified')) {
              await this.callTelegramApi('editMessageText', {
                chat_id: chatId,
                message_id: msgId,
                text: detail.text,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: detail.fallbackKeyboard }
              });
            }
          }
        }
        return;
      }

      if (data.startsWith('fl_copy:')) {
        const itemId = data.slice('fl_copy:'.length).trim();
        let item = storage.getItemFast(itemId);
        if (!item) {
          await storage.loadLatest(false);
          item = storage.getItemFast(itemId);
        }

        if (!item) {
          await this.callTelegramApi('answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ File or link no longer exists.',
            show_alert: true
          });
          return;
        }

        const detail = await this.buildFileDetailView(item, 1);
        this.callTelegramApi('answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🔗 Link ready to copy!',
          show_alert: false
        }).catch(() => {});

        if (chatId) {
          const title = (item.fileName || item.name || 'File').trim();
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: `🔗 <b>${this.escapeHtml(title)}</b>\n\nTap below to copy link:\n<code>${this.escapeHtml(detail.deepLink)}</code>`,
            parse_mode: 'HTML',
            ...(threadId ? { message_thread_id: threadId } : {})
          });
        }
        return;
      }
    }

    await this.callTelegramApi('answerCallbackQuery', { callback_query_id: cb.id });

    // SETUP VIDEO NAVIGATION:
    // [ 🎬 Setup Video ] button tap
    if (data?.startsWith('sv_vid_')) {
      const itemId = data.replace('sv_vid_', '').trim();
      const item = await storage.getItem(itemId);
      if (item && chatId) {
        await this.deliverSetupVideo(chatId, item, cb.message?.message_id);
      }
      return;
    }

    // [ 📁 File / Link ] button tap
    if (data?.startsWith('sv_item_')) {
      const itemId = data.replace('sv_item_', '').trim();
      if (chatId) {
        await this.handleDeepLinkDelivery(chatId, itemId, {
          includeBackButton: true,
          messageIdToEdit: cb.message?.message_id
        });
      }
      return;
    }

    // [ ⬅️ Back ] button tap returning to setup menu
    if (data?.startsWith('sv_menu_')) {
      const itemId = data.replace('sv_menu_', '').trim();
      const item = await storage.getItem(itemId);
      if (item && chatId) {
        await this.sendSetupVideoMenu(chatId, item, cb.message?.message_id);
      }
      return;
    }

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
            text: '❌ <b>Setup Cancelled</b>\n<i>Current operation has been aborted.</i>',
            parse_mode: 'HTML'
          });
          return;
        } catch {}
      }
      if (chatId) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '❌ <b>Operation Cancelled</b>\n<i>Current action has been aborted.</i>',
          parse_mode: 'HTML'
        });
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
      await withAddSessionLock(fromId, async () => {
        const curSession = activeAddSessions.get(fromId) || session;
        if (!curSession) return;
        curSession.type = 'file';
        curSession.isTextOnly = false;
        curSession.filesData = curSession.filesData || [];
        curSession.stage = 'awaiting_file_content';
        activeAddSessions.set(fromId, curSession);
        await storage.saveAddSession(fromId, curSession);

        if (chatId) {
          const collector = this.buildMultiFileCollectorPrompt(curSession);
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            collector.text,
            collector.replyMarkup,
            curSession
          );
          if (promptId) {
            curSession.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, curSession);
          }
        }
      });
      return;
    }

    if (data === 'add_files_done') {
      await withAddSessionLock(fromId, async () => {
        const curSession = activeAddSessions.get(fromId) || session;
        if (!curSession) return;
        const files = Array.isArray(curSession.filesData) && curSession.filesData.length > 0
          ? curSession.filesData
          : (curSession.fileData ? [curSession.fileData] : []);
        if (files.length === 0) {
          if (chatId) {
            const collector = this.buildMultiFileCollectorPrompt(curSession);
            await TelegramService.sendOrEditSetupPrompt(
              chatId,
              collector.text,
              collector.replyMarkup,
              curSession
            );
          }
          return;
        }
        if (chatId) {
          await this.promptTriggerTypeStep(fromId, chatId, curSession);
        }
      });
      return;
    }

    if (data === 'add_files_pop') {
      await withAddSessionLock(fromId, async () => {
        const curSession = activeAddSessions.get(fromId) || session;
        if (!curSession) return;
        if (Array.isArray(curSession.filesData) && curSession.filesData.length > 0) {
          curSession.filesData.pop();
        }
        curSession.fileData = curSession.filesData?.[0];
        activeAddSessions.set(fromId, curSession);
        await storage.saveAddSession(fromId, curSession);

        if (chatId) {
          const collector = this.buildMultiFileCollectorPrompt(curSession);
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            collector.text,
            collector.replyMarkup,
            curSession
          );
          if (promptId) {
            curSession.lastPromptMessageId = promptId;
            await storage.saveAddSession(fromId, curSession);
          }
        }
      });
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

    if (data === 'add_choose_text') {
      if (session) {
        session.type = 'file';
        session.isTextOnly = true;
        session.stage = 'awaiting_text_content';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            '💬 Please enter the <b>Text Message</b> you want the bot to deliver when triggered:\n\n<i>You can use bold, italic, links, and HTML tags. Or send /cancel to abort.</i>',
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

        const promptHint = session.triggerType === 'hashtag'
          ? 'starting with #'
          : session.triggerType === 'slash'
          ? 'starting with /'
          : 'plain text keyword';

        const stepHeader = session.type === 'file' ? 'Step 2/4' : 'Step 2/7';

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `<b>${stepHeader}: Trigger Name</b>\nPlease enter the trigger keyword for this ${session.type === 'file' ? 'file' : 'link'} (${promptHint}):`,
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
        session.caption = session.replyMessage;
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
        await this.promptSetupVideoChoice(fromId, chatId, session);
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
        await this.promptSetupVideoChoice(fromId, chatId, session);
      }
      return;
    }

    // Setup Video Selection Callbacks
    if (data === 'add_sv_yes') {
      if (session) {
        session.hasSetupVideo = true;
        session.stage = 'awaiting_setup_video';
        activeAddSessions.set(fromId, session);
        await storage.saveAddSession(fromId, session);

        if (chatId) {
          const promptId = await TelegramService.sendOrEditSetupPrompt(
            chatId,
            `🎬 <b>Send Setup Video</b>\n\nPlease provide your setup video tutorial. You can:\n• Send/upload a video directly from your phone/gallery\n• Forward a video from any chat or channel\n• Send a video URL link (e.g. YouTube or direct MP4 link)\n\n<i>Or send /skip to finish without a video, or /cancel to abort.</i>`,
            {
              inline_keyboard: [
                [{ text: 'Skip Video', callback_data: 'add_sv_no', style: 'primary' }],
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

    if (data === 'add_sv_no') {
      if (session) {
        session.hasSetupVideo = false;
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
          text: `ℹ️ <b>How to Use This Bot</b>\n\n• Type any file hashtag in your group or here to receive your file privately.\n• All files are delivered securely in direct message.\n• Run <code>/filters</code> anytime to view all available file hashtags.\n• Tap the inline button in group replies to open public links.`,
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
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: '❌ <b>File Not Found</b>\n<i>This item no longer exists in storage.</i>',
            parse_mode: 'HTML'
          });
        }
        return;
      }
      if (chatId) {
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '🚀 <b>Testing Delivery...</b>\n<i>Dispatching item now.</i>',
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
    const isAuthorized = await this.isAuthorizedAdmin(fromId, message?.from?.username);
    const admin = await storage.getAdmin(fromId);
    const hasPermission = isAuthorized && (!admin || admin.role === 'owner' || admin.permissions?.messages_edit !== false);

    if (!hasPermission) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to edit message templates.</i>',
        parse_mode: 'HTML'
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
        text: `ℹ️ <b>Start Message Configuration</b>\n\n<b>Current text:</b>\n<blockquote>${currentTemplate?.content || '(default)'}</blockquote>\n\n• 🖼️ <b>Attached media:</b> <code>${currentTemplate?.mediaUrl ? `${currentTemplate.mediaType?.toUpperCase()} (active)` : 'None (text-only)'}</code>\n\n<b>Usage:</b>\n• Send <code>/setstartmsg &lt;new message&gt;</code> to change text.\n• Reply to any Photo/Video with <code>/setstartmsg &lt;caption&gt;</code> to attach media.\n• Send <code>/setstartmedia &lt;url or file_id&gt;</code> to set media.\n• Send <code>/clearstartmedia</code> to remove media.\n\n<b>Placeholders:</b>\n• <code>{user_name}</code> — User's name\n• <code>{user_id}</code> — User's ID\n• <code>{bot_name}</code> — Bot username`,
        parse_mode: 'HTML'
      });
      return;
    }

    const finalContent = newContent || currentTemplate?.content || "👋 <b>Welcome, <code>{user_name}</code>!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> <code>{bot_name}</code>";
    const extra: any = {};
    if (detectedMediaUrl) {
      extra.mediaType = detectedMediaType;
      extra.mediaUrl = detectedMediaUrl;
    }

    await storage.updateTemplate('START_MESSAGE', finalContent, extra);
    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Start Message Template Updated</b>\n\n${detectedMediaUrl ? `📸 <i>Attached <code>${detectedMediaType?.toUpperCase()}</code> to welcome message!</i>\n\n` : ''}<b>New Caption:</b>\n${finalContent}\n\n<i>Users who send <code>/start</code> will now receive this message.</i>`,
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
    const isAuthorized = await this.isAuthorizedAdmin(fromId, message?.from?.username);
    const admin = await storage.getAdmin(fromId);
    const hasPermission = isAuthorized && (!admin || admin.role === 'owner' || admin.permissions?.messages_edit !== false);

    if (!hasPermission) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to edit message templates.</i>',
        parse_mode: 'HTML'
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
        text: '❌ <b>Missing Media</b>\n<i>Please provide a media URL or file ID, or reply to a photo/video with <code>/setstartmedia</code>.</i>\n\n<b>Example:</b>\n<code>/setstartmedia https://example.com/banner.jpg</code>',
        parse_mode: 'HTML'
      });
      return;
    }

    if (/\.(mp4|mov|webm|m4v)$/i.test(targetUrl)) {
      targetType = 'video';
    }

    const templates = await storage.getTemplates();
    const currentContent = templates.START_MESSAGE?.content || "👋 <b>Welcome, <code>{user_name}</code>!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> <code>{bot_name}</code>";

    await storage.updateTemplate('START_MESSAGE', currentContent, {
      mediaType: targetType,
      mediaUrl: targetUrl
    });

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Start Message Media Configured</b>\n\n• 🏷️ <b>Type:</b> <code>${targetType.toUpperCase()}</code>\n• 🔗 <b>Media:</b> <code>${this.escapeHtml(targetUrl.slice(0, 50))}${targetUrl.length > 50 ? '...' : ''}</code>\n\n<i>This media will appear above the welcome text when users start the bot.</i>`,
      parse_mode: 'HTML'
    });
  }

  // /clearstartmedia
  private static async handleClearStartMediaCommand(
    fromId: string,
    chatId: string | number
  ): Promise<void> {
    const isAuthorized = await this.isAuthorizedAdmin(fromId);
    const admin = await storage.getAdmin(fromId);
    const hasPermission = isAuthorized && (!admin || admin.role === 'owner' || admin.permissions?.messages_edit !== false);

    if (!hasPermission) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to edit message templates.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    const templates = await storage.getTemplates();
    const currentContent = templates.START_MESSAGE?.content || "👋 <b>Welcome, <code>{user_name}</code>!</b>\n\n🆔 <b>User ID:</b> <code>{user_id}</code>\n🤖 <b>Bot:</b> <code>{bot_name}</code>";

    await storage.updateTemplate('START_MESSAGE', currentContent, {
      mediaType: 'none',
      mediaUrl: ''
    });

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: '✅ <b>Start Media Removed</b>\n<i>The welcome message is now text-only.</i>',
      parse_mode: 'HTML'
    });
  }

  // =========================================================================
  // /editthismessage COMMAND
  // =========================================================================
  private static async handleEditThisMessageCommand(message: any): Promise<void> {
    const fromId = String(message.from?.id || '');
    const chatId = message.chat.id;
    const replyTo = message.reply_to_message;

    const isAuthorized = await this.isAuthorizedAdmin(fromId, message.from?.username);
    const admin = await storage.getAdmin(fromId);
    const hasPermission = isAuthorized && (!admin || admin.role === 'owner' || admin.permissions?.messages_edit !== false);

    if (!hasPermission) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Access Denied</b>\n<i>You are not authorized to edit message templates.</i>',
        parse_mode: 'HTML'
      });
      return;
    }

    if (!replyTo) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ <b>Template Editor</b>\n<i>Reply to any bot message with <code>/editthismessage</code> to edit its template or text.</i>',
        parse_mode: 'HTML'
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
      text: `✏️ <b>Editing Template:</b> <code>${this.escapeHtml(templateKey)}</code>\n\n<b>Current text:</b>\n<blockquote>${this.escapeHtml(replyTo.text || '')}</blockquote>\n\n<i>Send the new text for this template (or send <code>/cancel</code> to abort):</i>`,
      parse_mode: 'HTML'
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
    caption?: string,
    replyMarkup?: any
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
    if (replyMarkup) formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));

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
        if (replyMarkup) docFormData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
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

      // 3. Periodic sweep every 15 seconds for strict timing
      setInterval(() => {
        TelegramService.processDueScheduledDeletions().catch(err => {
          console.warn('[Telegram] Interval auto-delete worker error:', err);
        });
        storage.checkAndCleanExpiredItems().catch(err => {
          console.warn('[Storage] Interval expired items cleanup error:', err);
        });
      }, 15 * 1000);
    } catch (err: any) {
      console.warn('[Telegram] Could not initialize scheduled deletion worker:', err);
    }
  }

  public static armScheduledDeletionTimer(sched: ScheduledDeletion): void {
    if (this.activeTimers.has(sched.id)) return;
    const remainingMs = Math.max(0, sched.deleteAt - Date.now());
    const safeDelay = Math.min(remainingMs, 2147483647); // Max safe setTimeout delay

    const timer = setTimeout(async () => {
      this.activeTimers.delete(sched.id);
      try {
        await this.executeScheduledDeletion(sched);
      } catch (err: any) {
        console.warn(`[Telegram] Scheduled deletion execution error for ${sched.id}:`, err?.message || err);
      }
    }, safeDelay);

    this.activeTimers.set(sched.id, timer);
  }

  public static cancelActiveTimersForChat(chatId: string | number): void {
    const key = String(chatId);
    for (const [id, timer] of this.activeTimers.entries()) {
      if (id.includes(key)) {
        clearTimeout(timer);
        this.activeTimers.delete(id);
      }
    }
  }

  public static async executeScheduledDeletion(sched: ScheduledDeletion): Promise<void> {
    try {
      console.info(`[Telegram] Auto-deleting delivered file message ${sched.messageId} in chat ${sched.chatId} after ${sched.timeoutMinutes}m timeout`);
      
      const targetChatId = /^-?\d+$/.test(String(sched.chatId)) ? Number(sched.chatId) : String(sched.chatId);
      const targetMsgId = Number(sched.messageId);

      // Delete the delivered file message safely
      if (targetChatId && targetMsgId) {
        const res = await this.callTelegramApi('deleteMessage', {
          chat_id: targetChatId,
          message_id: targetMsgId
        });
        if (!res.ok) {
          console.info(`[Telegram] Scheduled deleteMessage result: ${res?.description || 'already removed'}`);
        }
      }

      // Also delete companion notice if one was sent
      if (targetChatId && sched.companionNoticeId) {
        await this.callTelegramApi('deleteMessage', {
          chat_id: targetChatId,
          message_id: Number(sched.companionNoticeId)
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`[Telegram] Error auto-deleting message ${sched.messageId}:`, err?.message || err);
    } finally {
      try {
        await storage.removeScheduledDeletion(sched.id);
      } catch (remErr: any) {
        console.warn(`[Telegram] Error removing scheduled deletion ${sched.id}:`, remErr?.message);
      }
    }
  }

  public static async processDueScheduledDeletions(): Promise<number> {
    try {
      const due = await storage.popDueScheduledDeletions();
      let count = 0;
      for (const sched of due) {
        try {
          await this.executeScheduledDeletion(sched);
          count++;
        } catch (itemErr: any) {
          console.warn('[Telegram] Individual scheduled deletion failed:', itemErr?.message);
        }
      }
      return count;
    } catch (err: any) {
      console.warn('[Telegram] Error in processDueScheduledDeletions:', err);
      return 0;
    }
  }

  // =========================================================================
  // TELEGRAM POLLING & WEBHOOK HYBRID WORKER WITH LEADER ELECTION & LIFECYCLE
  // =========================================================================
  private static pollingActive = false;
  private static manuallyStopped = false;
  private static pollingOffset = 0;
  private static isInitializing = false;
  private static isLoopRunning = false;
  private static isLeader = false;
  private static leaderCheckTimer: any = null;
  private static pollingAbortController: AbortController | null = null;
  private static pollingRestartTimer: NodeJS.Timeout | null = null;
  private static pollingEpoch: number = 0;
  private static activePollingPromise: Promise<void> | null = null;

  public static isManuallyStopped(): boolean {
    return this.manuallyStopped;
  }

  public static async initPollingWorker(): Promise<void> {
    if (this.leaderCheckTimer) {
      console.info('[Telegram] Polling leader supervisor is already initialized. Skipping redundant startup.');
      return;
    }

    // If server is designated as a silent backup mirror (and failover is not active), stay dormant
    try {
      const backupConfig = await storage.getBackupConfig();
      if (backupConfig?.role === 'backup' && !backupConfig?.failoverActive) {
        console.info('[Telegram] Server is running in Silent Backup Mirror mode. Bot listener is dormant awaiting failover signal.');
        return;
      }
    } catch {}

    const mainStorage = StorageManager.getMainStorage();
    const initSettings = await mainStorage.getSettings().catch(() => ({} as any));
    if (initSettings?.botStopped) {
      this.manuallyStopped = true;
      console.info('[Telegram] Main bot is configured as stopped (botStopped=true). Staying dormant until started.');
      return;
    }

    const token = await this.getBotToken();
    if (!token) {
      console.info('[Telegram] No bot token configured, polling worker waiting.');
      return;
    }

    // Primary main bot cleanly acquires/resets the primary lock without halting on cross-server false positives
    BotSingletonLock.clearConflict('main');
    const lockRes = await BotSingletonLock.acquire(token, 'main', {
      probeTelegram: false,
      forcePrimaryReset: true,
      isStartupBoot: true
    });
    if (!lockRes.ok) {
      this.pollingActive = false;
      this.isLeader = false;
      this.isLoopRunning = false;
      delete activeBots['main'];
      console.error(`[Telegram] Main bot startup halted safely: ${lockRes.conflict.message}`);
      return;
    }

    // Verify Telegram connection & ensure username is saved
    try {
      const me = await this.callTelegramApi('getMe', {});
      if (me?.ok && me.result) {
        console.info(`[Telegram] Connection verified for @${me.result.username || 'Bot'} (ID: ${me.result.id})`);
        if (!initSettings.botUsername || initSettings.botUsername !== me.result.username) {
          await mainStorage.updateSettings({ botUsername: me.result.username || '' });
        }
      }
    } catch (e: any) {
      console.warn('[Telegram] Could not verify bot profile on worker init:', e?.message || e);
    }

    let isInitialBootClaim = true;
    // Leader election loop: checks every 4 seconds; primary boot immediately claims/resets leadership cleanly
    const checkLeadershipAndRun = async () => {
      try {
        if (this.manuallyStopped) {
          if (this.pollingActive || this.isLoopRunning) {
            await this.stopPollingAsync();
          }
          if (this.isLeader) {
            this.isLeader = false;
            await storage.releasePollingLeader(BOT_INSTANCE_ID).catch(() => {});
          }
          return;
        }

        const isPrimaryProd = BotSingletonLock.isPrimaryProdHost();
        const forceReset = isInitialBootClaim && (isPrimaryProd || BotSingletonLock.isHoldingLock(token));
        isInitialBootClaim = false;

        const claimResult = await storage.tryClaimPollingLeader(BOT_INSTANCE_ID, 12000, {
          forceReset,
          isPrimary: isPrimaryProd
        });
        if (claimResult.isLeader) {
          if (!this.isLeader) {
            console.info(`[Telegram] Instance ${BOT_INSTANCE_ID} elected as PRIMARY active bot listener.`);
            this.isLeader = true;
          }
          if (!this.pollingActive) {
            this.pollingActive = true;
          }
          if (!this.isLoopRunning && !this.activePollingPromise) {
            this.startPollingLoop();
          }
        } else {
          if (this.isLeader) {
            console.warn(`[Telegram] Leadership yielded to ${claimResult.currentLeader}. Halting local polling loop.`);
            this.isLeader = false;
          }
          if (this.pollingActive || this.isLoopRunning) {
            await this.stopPollingAsync();
          }
        }
      } catch (err: any) {
        console.warn('[Telegram] Leader check warning:', err?.message || err);
      }
    };

    // Run first check immediately, then schedule every 4 seconds
    await checkLeadershipAndRun();
    if (!this.leaderCheckTimer && !this.manuallyStopped) {
      this.leaderCheckTimer = setInterval(checkLeadershipAndRun, 4000);
    }

    // Cleanly release leadership & singleton locks on process termination
    const onExit = async () => {
      if (this.isLeader) {
        try {
          await storage.releasePollingLeader(BOT_INSTANCE_ID);
        } catch {}
      }
      await BotSingletonLock.releaseAll().catch(() => {});
    };
    process.once('SIGINT', onExit);
    process.once('SIGTERM', onExit);
    process.once('beforeExit', onExit);
  }

  public static isPollingActive(): boolean {
    return !this.manuallyStopped && this.pollingActive && this.isLeader;
  }

  public static stopPolling(): void {
    this.pollingEpoch += 1;
    this.pollingActive = false;
    this.isLoopRunning = false;
    if (this.pollingRestartTimer) {
      clearTimeout(this.pollingRestartTimer);
      this.pollingRestartTimer = null;
    }
    if (this.pollingAbortController) {
      try {
        this.pollingAbortController.abort();
      } catch {}
      this.pollingAbortController = null;
    }
    delete activeBots['main'];
  }

  public static async stopPollingAsync(options?: { dropPendingUpdates?: boolean }): Promise<void> {
    const runningPromise = this.activePollingPromise;
    this.stopPolling();
    if (runningPromise) {
      await Promise.race([
        runningPromise.catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 2500))
      ]);
    }
    this.activePollingPromise = null;
    this.isLoopRunning = false;
    const token = await this.getBotToken().catch(() => '');
    if (token) {
      await BotSingletonLock.release(token, 'main').catch(() => {});
      if (options?.dropPendingUpdates) {
        this.pollingOffset = 0;
        await this.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, token).catch(() => {});
      }
    } else if (options?.dropPendingUpdates) {
      this.pollingOffset = 0;
    }
  }

  public static async releaseLeaderLock(): Promise<void> {
    await this.stopPollingAsync();
    this.isLeader = false;
    try {
      await storage.releasePollingLeader(BOT_INSTANCE_ID);
    } catch {}
    const token = await this.getBotToken().catch(() => '');
    if (token) {
      await BotSingletonLock.release(token, 'main').catch(() => {});
    }
  }

  public static async stopBot(persist: boolean = true): Promise<void> {
    return withBotLifecycleLock('main', async () => {
      this.manuallyStopped = true;
      if (this.leaderCheckTimer) {
        clearInterval(this.leaderCheckTimer);
        this.leaderCheckTimer = null;
      }
      await this.stopPollingAsync({ dropPendingUpdates: true });
      this.isLeader = false;
      await StorageManager.getMainStorage().releasePollingLeader(BOT_INSTANCE_ID).catch(() => {});
      const token = await this.getBotToken().catch(() => '');
      if (token) {
        await BotSingletonLock.release(token, 'main').catch(() => {});
      }
      if (persist) {
        await StorageManager.getMainStorage().updateSettings({ botStopped: true }).catch(() => {});
      }
      console.info('[Telegram] Main bot polling stopped and all timers/listeners/locks cleared.');
    });
  }

  public static async startBot(): Promise<boolean> {
    return withBotLifecycleLock('main', async () => {
      const token = await this.getBotToken().catch(() => '');
      if (!token) {
        console.warn('[Telegram] Cannot start main bot: no bot token configured.');
        return false;
      }

      // Stop any existing main polling instance or conflicting activeBots entry sharing this token
      if (activeBots['main']) {
        await activeBots['main'].stop({ dropPendingUpdates: false }).catch(() => {});
        delete activeBots['main'];
      }
      for (const [k, handle] of Object.entries(activeBots)) {
        if (k !== 'main' && handle.token === token) {
          await handle.stop({ dropPendingUpdates: false }).catch(() => {});
          delete activeBots[k];
        }
      }
      await this.stopPollingAsync({ dropPendingUpdates: false });

      // Clear stale manual conflict notice and reset primary lock synchronously
      BotSingletonLock.clearConflict('main');
      const lockRes = await BotSingletonLock.acquire(token, 'main', { probeTelegram: false, forcePrimaryReset: true });
      if (!lockRes.ok) {
        this.pollingActive = false;
        this.isLeader = false;
        this.isLoopRunning = false;
        console.error(`[Telegram] Main bot start blocked by singleton lock: ${lockRes.conflict.message}`);
        return false;
      }

      this.manuallyStopped = false;
      this.pollingOffset = 0;
      await StorageManager.getMainStorage().updateSettings({ botStopped: false }).catch(() => {});

      if (!this.leaderCheckTimer) {
        await this.initPollingWorker();
        return !BotSingletonLock.getConflict('main') && (this.pollingActive || !this.manuallyStopped);
      }
      const claimResult = await StorageManager.getMainStorage()
        .tryClaimPollingLeader(BOT_INSTANCE_ID, 12000, { forceReset: true, isPrimary: BotSingletonLock.isPrimaryProdHost() })
        .catch(() => ({ isLeader: true }));
      if (claimResult.isLeader) {
        this.isLeader = true;
        this.pollingActive = true;
        this.startPollingLoop();
      }
      console.info('[Telegram] Main bot polling started cleanly (singleton lock verified).');
      return true;
    });
  }

  public static async restartBot(): Promise<{ ok: boolean; cleaned: Awaited<ReturnType<typeof TelegramService.cleanBotMemory>> }> {
    await this.stopBot(false);
    const cleaned = await this.cleanBotMemory();
    await new Promise((r) => setTimeout(r, 350));
    const ok = await this.startBot();
    if (ok) {
      console.info('[Telegram] Main bot restarted cleanly.');
    }
    return { ok, cleaned };
  }

  public static async cleanBotMemory(targetStorage?: any): Promise<{
    clearedRuntimeEntries: number;
    clearedStorageEntries: number;
    rssMb: number;
    heapUsedMb: number;
  }> {
    const now = Date.now();
    let expiredProcessedCleared = 0;
    for (const [k, ts] of processedUpdateKeys.entries()) {
      if (now - ts > 120000) {
        processedUpdateKeys.delete(k);
        expiredProcessedCleared++;
      }
    }

    const runtimeCount =
      activeAddSessions.size +
      activeEditSessions.size +
      activeSetChannelSessions.size +
      activeCloneSessions.size +
      recentDeliveries.size +
      expiredProcessedCleared +
      this.forceSubCache.size +
      this.groupAdminCache.size +
      this.freeFirePlayerCache.size +
      this.freeFireGuildCache.size;

    activeAddSessions.clear();
    activeEditSessions.clear();
    activeSetChannelSessions.clear();
    activeCloneSessions.clear();
    recentDeliveries.clear();
    // Preserve inFlightUpdateKeys and recent (<2m) processedUpdateKeys to block duplicate update replay on restart
    this.forceSubCache.clear();
    this.groupAdminCache.clear();
    this.freeFirePlayerCache.clear();
    this.freeFireGuildCache.clear();

    let clearedStorageEntries = 0;
    const storagesToClean = targetStorage
      ? [targetStorage]
      : StorageManager.getLoadedStorageIds().map(id => StorageManager.getStorage(id));

    for (const st of storagesToClean) {
      if (st && typeof st.clearMemoryCaches === 'function') {
        const res = await st.clearMemoryCaches().catch(() => null);
        if (res) {
          clearedStorageEntries +=
            (res.clearedLruEntries || 0) +
            (res.clearedBlobs || 0) +
            (res.clearedMemoryFiles || 0) +
            (res.prunedSessions || 0);
        }
      }
    }

    try {
      if (typeof (global as any).gc === 'function') {
        (global as any).gc();
      }
    } catch {}

    const mem = process.memoryUsage();
    return {
      clearedRuntimeEntries: runtimeCount,
      clearedStorageEntries,
      rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10
    };
  }

  private static async handleBotLifecycleCommand(
    fromId: string,
    chatId: string | number,
    text: string
  ): Promise<void> {
    const cleanText = text.trim();
    const match = cleanText.match(/^\/(botstart|startbot|botstop|stopbot|botrestart|restartbot|botstatus|memclean|cleanmemory|clearcache)(?:@\w+)?(?:\s+(.+))?$/i);
    if (!match) return;

    const cmd = match[1].toLowerCase();
    const arg = (match[2] || '').trim().replace(/^clone_/i, '').replace(/[:_-]/g, '');
    const currentStorage = storage;
    const currentBotId = (currentStorage as any)?.botId || 'main';
    const targetBotId = (currentBotId === 'main' && arg) ? arg : currentBotId;

    if (cmd === 'memclean' || cmd === 'cleanmemory' || cmd === 'clearcache') {
      const stats = await TelegramBotManager.cleanMemory(targetBotId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `🧹 <b>Memory &amp; Cache Cleaned</b>\n\n` +
          `• 🤖 <b>Scope:</b> <code>${this.escapeHtml(targetBotId)}</code>\n` +
          `• 🗑️ <b>Runtime Caches Purged:</b> <code>${stats.clearedRuntimeEntries}</code>\n` +
          `• 📦 <b>Storage Cache Entries Cleared:</b> <code>${stats.clearedStorageEntries}</code>\n` +
          `• 📊 <b>Memory Usage:</b> <code>${stats.heapUsedMb} MB</code> heap · <code>${stats.rssMb} MB</code> RSS`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (cmd === 'botstatus') {
      const mem = process.memoryUsage();
      const rssMb = Math.round((mem.rss / (1024 * 1024)) * 10) / 10;
      const heapMb = Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10;
      const isMain = targetBotId === 'main';
      const isRunning = isMain
        ? (!this.manuallyStopped && (this.pollingActive || Boolean(this.leaderCheckTimer)))
        : TelegramBotManager.isBotActivelyRunning(targetBotId);
      const items = await StorageManager.getStorage(targetBotId).getItems().catch(() => []);
      const allBots = isMain ? await TelegramBotManager.getAllBots().catch(() => []) : [];
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `📊 <b>BOT RUNTIME STATUS</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `• 🤖 <b>Bot ID:</b> <code>${this.escapeHtml(targetBotId)}</code>\n` +
          `• 📡 <b>State:</b> ${isRunning ? '🟢 <code>Running</code>' : '🔴 <code>Stopped</code>'}\n` +
          `• 📁 <b>Stored Items:</b> <code>${items.length}</code>\n` +
          (isMain ? `• 🧬 <b>Fleet Size:</b> <code>${allBots.length} bot(s)</code>\n` : '') +
          `• 🧠 <b>Memory:</b> <code>${heapMb} MB</code> heap · <code>${rssMb} MB</code> RSS\n` +
          `• ⏱️ <b>Uptime:</b> <code>${Math.floor(process.uptime())}s</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (cmd === 'botstop' || cmd === 'stopbot') {
      if (targetBotId !== 'main' && currentBotId === 'main') {
        const ok = await TelegramBotManager.stopBot(targetBotId);
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: ok
            ? `⏹️ <b>Cloned Bot Stopped</b>\n\nBot <code>${this.escapeHtml(targetBotId)}</code> polling listener has been stopped. It will ignore updates until started again.`
            : `❌ Could not find bot <code>${this.escapeHtml(targetBotId)}</code>.`,
          parse_mode: 'HTML'
        });
        return;
      }
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `⏹️ <b>Stopping Bot Listener...</b>\n\nPolling for <code>${this.escapeHtml(targetBotId)}</code> is now halting. Re-enable anytime from the Web Admin Panel${currentBotId === 'main' ? ' or via /botstart on main panel' : ''}.`,
        parse_mode: 'HTML'
      });
      await TelegramBotManager.stopBot(targetBotId);
      return;
    }

    if (cmd === 'botstart' || cmd === 'startbot') {
      const ok = await TelegramBotManager.startBot(targetBotId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: ok
          ? `▶️ <b>Bot Started</b>\n\nBot <code>${this.escapeHtml(targetBotId)}</code> is now 🟢 active and polling.`
          : `❌ Could not start bot <code>${this.escapeHtml(targetBotId)}</code>.`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (cmd === 'botrestart' || cmd === 'restartbot') {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `🔄 <b>Restarting Bot &amp; Cleaning Caches...</b>\nTarget: <code>${this.escapeHtml(targetBotId)}</code>`,
        parse_mode: 'HTML'
      });
      const ok = await TelegramBotManager.restartBot(targetBotId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: ok
          ? `✅ <b>Restart Complete!</b>\n\nBot <code>${this.escapeHtml(targetBotId)}</code> is online with freshly cleared runtime caches.`
          : `❌ Failed to restart bot <code>${this.escapeHtml(targetBotId)}</code>.`,
        parse_mode: 'HTML'
      }).catch(() => {});
      return;
    }
  }

  private static async handleOwnerGrantRevokeCommand(
    fromId: string,
    chatId: string | number,
    text: string,
    message?: any
  ): Promise<void> {
    const isOwner = await this.isOwnerAdmin(fromId, message?.from?.username);
    if (!isOwner) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Owner Access Required:</b> Only the primary Bot Owner can grant or revoke administrator permissions.',
        parse_mode: 'HTML'
      });
      return;
    }

    const match = text.trim().match(/^\/(grantadmin|promote|addadmin|revokeadmin|demote|removeadmin|deladmin)(?:@\w+)?(?:\s+(.+))?$/i);
    if (!match) return;

    const cmd = match[1].toLowerCase();
    const isGrant = cmd === 'grantadmin' || cmd === 'promote' || cmd === 'addadmin';
    const rawArgs = (match[2] || '').trim().split(/\s+/).filter(Boolean);

    let targetId = '';
    let targetUsername = '';
    let targetName = '';
    let preset = 'editor';

    if (message?.reply_to_message?.from) {
      const repliedUser = message.reply_to_message.from;
      targetId = String(repliedUser.id);
      targetUsername = repliedUser.username ? String(repliedUser.username).replace(/^@+/, '') : '';
      targetName = [repliedUser.first_name, repliedUser.last_name].filter(Boolean).join(' ').trim() || (targetUsername ? `@${targetUsername}` : `User ${targetId}`);
      if (rawArgs[0] && ['full', 'editor', 'moderator'].includes(rawArgs[0].toLowerCase())) {
        preset = rawArgs[0].toLowerCase();
      }
    } else if (rawArgs.length > 0) {
      const targetQuery = rawArgs[0];
      if (rawArgs[1] && ['full', 'editor', 'moderator'].includes(rawArgs[1].toLowerCase())) {
        preset = rawArgs[1].toLowerCase();
      }
      const foundUser = await storage.findUserByIdOrUsername(targetQuery).catch(() => null);
      if (foundUser) {
        targetId = String(foundUser.id).trim();
        targetUsername = foundUser.username ? String(foundUser.username).replace(/^@+/, '') : '';
        targetName = [foundUser.firstName, foundUser.lastName].filter(Boolean).join(' ').trim() || (targetUsername ? `@${targetUsername}` : `User ${targetId}`);
      } else {
        targetId = targetQuery.replace(/^@+/, '').trim();
        targetUsername = targetQuery.startsWith('@') ? targetId : '';
        targetName = targetUsername ? `@${targetUsername}` : `Admin ${targetId}`;
      }
    }

    if (!targetId) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: isGrant
          ? `ℹ️ <b>Grant Admin Usage:</b>\n<code>/grantadmin &lt;user_id_or_@username&gt; [full|editor|moderator]</code>\nOr reply to a user's message with <code>/grantadmin [full|editor|moderator]</code>`
          : `ℹ️ <b>Revoke Admin Usage:</b>\n<code>/revokeadmin &lt;user_id_or_@username&gt;</code>\nOr reply to a user's message with <code>/revokeadmin</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    const currentBotId = (storage as any)?.botId || 'main';

    if (isGrant) {
      const presetPerms = preset === 'full'
        ? {
            files_view: true, files_add: true, files_edit: true, files_delete: true,
            links_view: true, links_add: true, links_edit: true, links_delete: true,
            messages_view: true, messages_edit: true, admins_manage: false,
            design_edit: true, settings_edit: true, cleanup_manage: true
          }
        : preset === 'moderator'
        ? {
            files_view: true, files_add: false, files_edit: false, files_delete: false,
            links_view: true, links_add: false, links_edit: false, links_delete: false,
            messages_view: true, messages_edit: false, admins_manage: false,
            design_edit: false, settings_edit: false, cleanup_manage: true
          }
        : {
            files_view: true, files_add: true, files_edit: true, files_delete: false,
            links_view: true, links_add: true, links_edit: true, links_delete: false,
            messages_view: true, messages_edit: true, admins_manage: false,
            design_edit: false, settings_edit: false, cleanup_manage: false
          };

      const existingAdmin = await storage.getAdmin(targetId);
      const generatedPassword = existingAdmin?.passwordHash ? undefined : `Zexi#${crypto.randomBytes(4).toString('hex')}`;
      const passwordHash = existingAdmin?.passwordHash || await hashPassword(generatedPassword!);

      const adminRecord: AdminUser = {
        id: existingAdmin?.id || targetId,
        telegramId: targetId,
        name: targetName,
        username: targetUsername || existingAdmin?.username,
        role: existingAdmin?.role === 'owner' ? 'owner' : 'subadmin',
        passwordHash,
        permissions: presetPerms,
        enabled: true,
        createdAt: existingAdmin?.createdAt || new Date().toISOString(),
        lastLoginAt: existingAdmin?.lastLoginAt
      };

      await storage.saveAdmin(adminRecord);
      await storage.setBotUserAdmin(targetId, true).catch(() => {});

      const rawToken = await storage.createSession(adminRecord.id, adminRecord.role, currentBotId);
      const accessToken = signSessionToken(rawToken);
      const grantedCount = Object.values(presetPerms).filter(Boolean).length;

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text:
          `✅ <b>Administrator Granted</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 <b>Admin:</b> ${this.escapeHtml(adminRecord.name)}\n` +
          `🆔 <b>ID:</b> <code>${this.escapeHtml(adminRecord.telegramId)}</code>\n` +
          (adminRecord.username ? `🔗 <b>Username:</b> @${this.escapeHtml(adminRecord.username)}\n` : '') +
          `🛡️ <b>Preset:</b> <code>${this.escapeHtml(preset)}</code> (${grantedCount}/14 capabilities)\n` +
          (generatedPassword ? `🔐 <b>Panel Password:</b> <code>${this.escapeHtml(generatedPassword)}</code>\n` : '') +
          `🎫 <b>Session Access Token:</b>\n<code>${this.escapeHtml(accessToken)}</code>\n\n` +
          `<i>This user can now authenticate seamlessly via Telegram Mini App or Web Panel.</i>`,
        parse_mode: 'HTML'
      });

      if (/^\d+$/.test(targetId) && targetId !== fromId) {
        this.callTelegramApi('sendMessage', {
          chat_id: targetId,
          text:
            `🎉 <b>You Have Been Granted Administrator Access!</b>\n\n` +
            `The Owner has promoted you to <b>Sub-Admin</b> (<code>${this.escapeHtml(preset)}</code>).\n` +
            (generatedPassword ? `🔐 <b>Web Panel Password:</b> <code>${this.escapeHtml(generatedPassword)}</code>\n` : '') +
            `Run <code>/help</code> to view your admin commands or open the Admin Panel Mini App.`,
          parse_mode: 'HTML'
        }).catch(() => {});
      }
      return;
    }

    // Revoke admin permissions
    const admins = await storage.getAdmins();
    const cleanTarget = targetId.replace(/^@+/, '').toLowerCase();
    const matched = admins.find(a =>
      String(a.id).trim() === targetId ||
      String(a.telegramId).trim() === targetId ||
      (a.username && a.username.replace(/^@+/, '').toLowerCase() === cleanTarget)
    );

    if (matched && (matched.role === 'owner' || String(matched.id) === String(fromId) || String(matched.telegramId) === String(fromId))) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⛔ <b>Protected Account:</b> Cannot revoke Owner administrator permissions.',
        parse_mode: 'HTML'
      });
      return;
    }

    if (matched) {
      await storage.deleteAdmin(matched.id);
    }
    await storage.setBotUserAdmin(targetId, false).catch(() => {});

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `🗑️ <b>Administrator Revoked:</b> <code>${this.escapeHtml(matched?.name || targetName)}</code> (<code>${this.escapeHtml(targetId)}</code>) no longer has admin access.`,
      parse_mode: 'HTML'
    });
  }

  private static startPollingLoop(): void {
    if (this.isLoopRunning || this.activePollingPromise || this.manuallyStopped || !this.pollingActive || !this.isLeader) {
      return;
    }
    this.pollingEpoch += 1;
    const myEpoch = this.pollingEpoch;
    this.isLoopRunning = true;

    this.getBotToken().then((token) => {
      if (this.pollingEpoch !== myEpoch || this.manuallyStopped) return;
      activeBots['main'] = {
        botId: 'main',
        token: token || '',
        stop: (opts) => this.stopPollingAsync(opts),
        isAlive: () => !this.manuallyStopped && this.pollingActive && this.isLoopRunning
      };
    }).catch(() => {});

    const loopPromise = this.runPollingLoop(myEpoch).catch((err) => {
      if (this.pollingEpoch !== myEpoch) return;
      console.warn('[Telegram Polling] Polling loop caught error, auto-recovering in 2s...', err?.message || err);
      if (this.pollingRestartTimer) clearTimeout(this.pollingRestartTimer);
      this.pollingRestartTimer = setTimeout(() => {
        this.pollingRestartTimer = null;
        if (this.pollingEpoch === myEpoch && !this.manuallyStopped && this.pollingActive && this.isLeader) {
          this.startPollingLoop();
        }
      }, 2000);
    });
    this.activePollingPromise = loopPromise;
  }

  private static async runPollingLoop(myEpoch: number): Promise<void> {
    this.pollingAbortController = new AbortController();
    const signal = this.pollingAbortController.signal;
    try {
      // Unconditionally clear any webhook and drop all queued pending updates before polling
      try {
        await this.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, undefined, signal);
        console.info('[Telegram Polling] Cleared webhook & dropped pending updates before starting polling loop.');
      } catch (err: any) {
        if (signal.aborted || myEpoch !== this.pollingEpoch) return;
        console.warn('[Telegram Polling] Webhook cleanup notice:', err?.message || err);
      }

      // Initialize pollingOffset to latest update_id so old queued messages are flushed immediately
      if (this.pollingOffset === 0 && !this.manuallyStopped && myEpoch === this.pollingEpoch && !signal.aborted) {
        try {
          const peek = await this.callTelegramApi('getUpdates', { offset: -1, limit: 1 }, undefined, signal);
          if (peek?.ok && Array.isArray(peek.result) && peek.result.length > 0) {
            this.pollingOffset = peek.result[0].update_id + 1;
            console.info(`[Telegram Polling] Advanced initial polling offset to ${this.pollingOffset} to discard stale backlog.`);
          }
        } catch {}
      }

      let consecutive409s = 0;
      while (myEpoch === this.pollingEpoch && !this.manuallyStopped && this.pollingActive && this.isLeader && !signal.aborted) {
        try {
          const res = await this.callTelegramApi('getUpdates', {
            offset: this.pollingOffset,
            timeout: 10,
            allowed_updates: [
              'message', 'edited_message', 'channel_post', 'edited_channel_post',
              'inline_query', 'chosen_inline_result', 'callback_query',
              'my_chat_member', 'chat_member', 'chat_join_request'
            ]
          }, undefined, signal);

          if (myEpoch !== this.pollingEpoch || this.manuallyStopped || !this.pollingActive || !this.isLeader || signal.aborted) {
            break;
          }

          if (res && res.ok && Array.isArray(res.result)) {
            consecutive409s = 0;
            for (const update of res.result) {
              if (myEpoch !== this.pollingEpoch || this.manuallyStopped || !this.pollingActive || !this.isLeader || signal.aborted) {
                break;
              }
              this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
              try {
                await this.handleUpdate(update);
              } catch (updateErr: any) {
                console.error('[Telegram Polling] Error handling update:', updateErr?.message || updateErr);
              }
            }
          } else if (res && !res.ok) {
            const desc = String(res.description || '').toLowerCase();
            if (res.error_code === 409 || desc.includes('409') || desc.includes('terminated by other getupdates')) {
              consecutive409s++;
              if (consecutive409s < 4) {
                console.warn(`⏳ [Telegram Polling] Transient 409 during handoff (${consecutive409s}/4), retrying in 2.5s...`);
                await new Promise((r) => setTimeout(r, 2500));
                continue;
              }
              console.error(`\n❌ [BotSingletonLock] TELEGRAM 409 SESSION CONFLICT MID-RUN [main]\n   Telegram Response: ${res.description || '409 Conflict'}\n   Action: Pausing polling listener until conflict clears.\n`);
              BotSingletonLock.recordConflict('main', 'telegram_409_conflict', 'remote_poller', String(res.description || '409 Conflict: terminated by other getUpdates request'));
              const activeToken = await this.getBotToken().catch(() => '');
              if (activeToken) {
                await BotSingletonLock.release(activeToken, 'main').catch(() => {});
              }
              this.isLeader = false;
              this.pollingActive = false;
              if (!BotSingletonLock.isPrimaryProdHost() && this.leaderCheckTimer) {
                clearInterval(this.leaderCheckTimer);
                this.leaderCheckTimer = null;
              }
              this.stopPolling();
              break;
            }
          }
        } catch (err: any) {
          if (myEpoch !== this.pollingEpoch || this.manuallyStopped || signal.aborted) break;
          const errMsg = String(err?.message || '').toLowerCase();
          if (errMsg.includes('409') || errMsg.includes('terminated by other getupdates')) {
            consecutive409s++;
            if (consecutive409s < 4) {
              console.warn(`⏳ [Telegram Polling] Transient 409 exception during handoff (${consecutive409s}/4), retrying in 2.5s...`);
              await new Promise((r) => setTimeout(r, 2500));
              continue;
            }
            console.error(`\n❌ [BotSingletonLock] TELEGRAM 409 SESSION CONFLICT [main]\n   Error: ${err?.message || err}\n   Action: Pausing polling listener until conflict clears.\n`);
            BotSingletonLock.recordConflict('main', 'telegram_409_conflict', 'remote_poller', String(err?.message || '409 Conflict'));
            const activeToken = await this.getBotToken().catch(() => '');
            if (activeToken) {
              await BotSingletonLock.release(activeToken, 'main').catch(() => {});
            }
            this.isLeader = false;
            this.pollingActive = false;
            if (!BotSingletonLock.isPrimaryProdHost() && this.leaderCheckTimer) {
              clearInterval(this.leaderCheckTimer);
              this.leaderCheckTimer = null;
            }
            this.stopPolling();
            break;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    } finally {
      if (this.pollingEpoch === myEpoch) {
        this.isLoopRunning = false;
        this.activePollingPromise = null;
        delete activeBots['main'];
      }
    }
  }
}

export class ClonedBotRunner {
  private isRunning: boolean = false;
  private isStarting: boolean = false;
  private isLoopActive: boolean = false;
  private pollingOffset: number = 0;
  private lastPollAt: number = Date.now();
  private abortController: AbortController | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private loopEpoch: number = 0;
  private activeLoopPromise: Promise<void> | null = null;

  constructor(public readonly bot: ClonedBotRecord) {}

  public isAlive(): boolean {
    if (!this.isRunning || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
      return false;
    }
    if (this.isStarting) return true;
    return this.isLoopActive && (Date.now() - this.lastPollAt < 90000);
  }

  public async start(opts?: { isStartupBoot?: boolean }): Promise<boolean> {
    if (TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
      return false;
    }
    if (this.isRunning && (this.isStarting || this.isLoopActive)) {
      return true;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.isRunning = true;
    this.isStarting = true;
    this.pollingOffset = 0;
    this.lastPollAt = Date.now();
    this.abortController = new AbortController();

    console.info(`[ClonedBot ${this.bot.id}] Acquiring singleton lock for @${this.bot.username}...`);
    const lockRes = await BotSingletonLock.acquire(this.bot.token, this.bot.id, {
      probeTelegram: true,
      isStartupBoot: opts?.isStartupBoot
    });
    if (!lockRes.ok) {
      this.isRunning = false;
      this.isStarting = false;
      this.isLoopActive = false;
      console.error(`[ClonedBot ${this.bot.id}] Startup aborted safely due to singleton lock conflict: ${lockRes.conflict.message}`);
      return false;
    }

    try {
      await TelegramService.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, this.bot.token, this.abortController.signal);
    } catch {}

    if (!this.isRunning || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
      this.isStarting = false;
      await BotSingletonLock.release(this.bot.token, this.bot.id).catch(() => {});
      return false;
    }

    this.launchLoop();
    return true;
  }

  private launchLoop(): void {
    if (
      !this.isRunning ||
      this.isLoopActive ||
      this.activeLoopPromise ||
      TelegramBotManager.isBotDeleted(this.bot.id) ||
      TelegramBotManager.isBotStopped(this.bot.id)
    ) {
      this.isStarting = false;
      return;
    }
    this.loopEpoch += 1;
    const myEpoch = this.loopEpoch;
    this.isLoopActive = true;
    this.isStarting = false;

    const p = this.runLoop(myEpoch)
      .catch(err => {
        if (this.loopEpoch === myEpoch) {
          console.warn(`[ClonedBot ${this.bot.id}] Runner error:`, err?.message || err);
        }
      })
      .finally(() => {
        if (this.loopEpoch !== myEpoch) return;
        this.isLoopActive = false;
        this.activeLoopPromise = null;
        if (
          this.isRunning &&
          !TelegramBotManager.isBotDeleted(this.bot.id) &&
          !TelegramBotManager.isBotStopped(this.bot.id)
        ) {
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (
              this.loopEpoch === myEpoch &&
              this.isRunning &&
              !TelegramBotManager.isBotDeleted(this.bot.id) &&
              !TelegramBotManager.isBotStopped(this.bot.id)
            ) {
              this.launchLoop();
            }
          }, 2000);
        }
      });
    this.activeLoopPromise = p;
  }

  public async stop(options?: { dropPendingUpdates?: boolean }): Promise<void> {
    this.loopEpoch += 1;
    this.isRunning = false;
    this.isStarting = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }
    const loopPromise = this.activeLoopPromise;
    if (loopPromise) {
      await Promise.race([
        loopPromise.catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 2500))
      ]);
    }
    this.isLoopActive = false;
    this.activeLoopPromise = null;
    this.pollingOffset = 0;
    if (this.bot.token) {
      await BotSingletonLock.release(this.bot.token, this.bot.id).catch(() => {});
      if (options?.dropPendingUpdates) {
        await TelegramService.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, this.bot.token).catch(() => {});
      }
    }
    console.info(`[ClonedBot ${this.bot.id}] Runner stopped cleanly.`);
  }

  private async runLoop(myEpoch: number): Promise<void> {
    const signal = this.abortController?.signal;
    const botStorage = StorageManager.getStorage(this.bot.id);
    try {
      await botStorage.init();
      await botStorage.loadLatest(true).catch(() => {});
      if (myEpoch !== this.loopEpoch || !this.isRunning || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
        return;
      }
      const st = await botStorage.getSettings();
      if (!st.botToken || st.botToken !== this.bot.token || (!st.botUsername && this.bot.username)) {
        await botStorage.updateSettings({
          botToken: this.bot.token,
          botUsername: st.botUsername || this.bot.username || ''
        });
      }
    } catch (initErr: any) {
      console.warn(`[ClonedBot ${this.bot.id}] Storage init notice:`, initErr?.message || initErr);
    }

    if (this.pollingOffset === 0 && myEpoch === this.loopEpoch && this.isRunning && !signal?.aborted && !TelegramBotManager.isBotDeleted(this.bot.id)) {
      try {
        const peek = await TelegramService.callTelegramApi('getUpdates', { offset: -1, limit: 1 }, this.bot.token, signal);
        if (peek?.ok && Array.isArray(peek.result) && peek.result.length > 0) {
          this.pollingOffset = peek.result[0].update_id + 1;
        }
      } catch {}
    }

    let consecutive409s = 0;
    while (myEpoch === this.loopEpoch && this.isRunning && !signal?.aborted && !TelegramBotManager.isBotDeleted(this.bot.id) && !TelegramBotManager.isBotStopped(this.bot.id)) {
      try {
        this.lastPollAt = Date.now();
        const res = await TelegramService.callTelegramApi('getUpdates', {
          offset: this.pollingOffset,
          timeout: 10,
          allowed_updates: [
            'message', 'edited_message', 'channel_post', 'edited_channel_post',
            'inline_query', 'chosen_inline_result', 'callback_query',
            'my_chat_member', 'chat_member', 'chat_join_request'
          ]
        }, this.bot.token, signal);
        this.lastPollAt = Date.now();

        if (myEpoch !== this.loopEpoch || !this.isRunning || signal?.aborted || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
          break;
        }

        if (res && res.ok && Array.isArray(res.result)) {
          consecutive409s = 0;
          for (const update of res.result) {
            if (myEpoch !== this.loopEpoch || !this.isRunning || signal?.aborted || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
              break;
            }
            this.pollingOffset = Math.max(this.pollingOffset, update.update_id + 1);
            try {
              await storageContext.run(botStorage, async () => {
                await botTokenContext.run(this.bot.token, async () => {
                  await TelegramService.handleUpdate(update, this.bot.token, this.bot.id);
                });
              });
            } catch (err: any) {
              console.error(`[ClonedBot ${this.bot.id}] Update error:`, err?.message || err);
            }
          }
        } else if (res && !res.ok) {
          const desc = String(res.description || '').toLowerCase();
          if (res.error_code === 409 || desc.includes('409') || desc.includes('terminated by other getupdates')) {
            consecutive409s++;
            if (consecutive409s < 4) {
              console.warn(`⏳ [ClonedBot ${this.bot.id}] Transient 409 during handoff (${consecutive409s}/4), retrying in 2.5s...`);
              await new Promise(r => setTimeout(r, 2500));
              continue;
            }
            console.error(`\n❌ [BotSingletonLock] TELEGRAM 409 SESSION CONFLICT MID-RUN [${this.bot.id} @${this.bot.username}]\n   Telegram Response: ${res.description || '409 Conflict'}\n   Action: Terminating conflicting cloned bot runner safely.\n`);
            BotSingletonLock.recordConflict(this.bot.id, 'telegram_409_conflict', 'remote_poller', String(res.description || '409 Conflict'));
            this.isRunning = false;
            this.isStarting = false;
            await BotSingletonLock.release(this.bot.token, this.bot.id).catch(() => {});
            TelegramBotManager.cleanupConflictedRunner(this.bot.id);
            if (process.env.EXIT_ON_BOT_CONFLICT === 'true') {
              setTimeout(() => process.exit(1), 150);
            }
            break;
          }
        }
      } catch (err: any) {
        if (myEpoch !== this.loopEpoch || !this.isRunning || signal?.aborted || TelegramBotManager.isBotDeleted(this.bot.id) || TelegramBotManager.isBotStopped(this.bot.id)) {
          break;
        }
        const errMsg = String(err?.message || '').toLowerCase();
        if (errMsg.includes('409') || errMsg.includes('terminated by other getupdates')) {
          consecutive409s++;
          if (consecutive409s < 4) {
            console.warn(`⏳ [ClonedBot ${this.bot.id}] Transient 409 exception during handoff (${consecutive409s}/4), retrying in 2.5s...`);
            await new Promise(r => setTimeout(r, 2500));
            continue;
          }
          console.error(`\n❌ [BotSingletonLock] TELEGRAM 409 SESSION CONFLICT [${this.bot.id} @${this.bot.username}]\n   Error: ${err?.message || err}\n   Action: Terminating conflicting cloned bot runner safely.\n`);
          BotSingletonLock.recordConflict(this.bot.id, 'telegram_409_conflict', 'remote_poller', String(err?.message || '409 Conflict'));
          this.isRunning = false;
          this.isStarting = false;
          await BotSingletonLock.release(this.bot.token, this.bot.id).catch(() => {});
          TelegramBotManager.cleanupConflictedRunner(this.bot.id);
          if (process.env.EXIT_ON_BOT_CONFLICT === 'true') {
            setTimeout(() => process.exit(1), 150);
          }
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
}

export class TelegramBotManager {
  private static runners: Map<string, ClonedBotRunner> = new Map();
  private static watchdogTimer: NodeJS.Timeout | null = null;
  private static deletedBotIds: Set<string> = new Set();
  private static stoppedBotIds: Set<string> = new Set();

  private static normalizeBotKey(id: string): string {
    return String(id || '').trim().replace(/^clone_/i, '').replace(/[:_-]/g, '');
  }

  public static isBotDeleted(id: string): boolean {
    if (!id || id === 'main') return false;
    const clean = String(id).trim();
    const norm = this.normalizeBotKey(clean);
    return this.deletedBotIds.has(clean) || (norm ? this.deletedBotIds.has(norm) : false);
  }

  public static isBotStopped(id: string): boolean {
    if (!id) return false;
    if (id === 'main') return TelegramService.isManuallyStopped();
    const clean = String(id).trim();
    const norm = this.normalizeBotKey(clean);
    return this.stoppedBotIds.has(clean) || (norm ? this.stoppedBotIds.has(norm) : false);
  }

  public static isBotActivelyRunning(id: string): boolean {
    if (id === 'main') return TelegramService.isPollingActive();
    if (this.isBotDeleted(id) || this.isBotStopped(id)) return false;
    const norm = this.normalizeBotKey(id);
    for (const [key, runner] of this.runners.entries()) {
      if (key === id || this.normalizeBotKey(key) === norm) {
        return runner.isAlive();
      }
    }
    return false;
  }

  public static async verifyBotToken(token: string): Promise<{ ok: boolean; info?: any; error?: string }> {
    try {
      const clean = token.trim().replace(/^["']|["']$/g, '');
      const res = await fetch(`https://api.telegram.org/bot${clean}/getMe`);
      const data = await res.json();
      if (data?.ok && data.result) {
        return { ok: true, info: data.result };
      }
      return { ok: false, error: data?.description || 'Invalid bot token' };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error verifying bot token' };
    }
  }

  public static cleanupConflictedRunner(id: string): void {
    const cleanNorm = this.normalizeBotKey(id);
    for (const key of Array.from(this.runners.keys())) {
      if (key === id || (cleanNorm && this.normalizeBotKey(key) === cleanNorm)) {
        this.runners.delete(key);
      }
    }
    if (cleanNorm && activeBots[cleanNorm]) {
      delete activeBots[cleanNorm];
    }
    if (activeBots[id]) {
      delete activeBots[id];
    }
  }

  public static ensureBotRunning(bot: ClonedBotRecord): void {
    if (!bot || bot.status === 'stopped' || this.isBotDeleted(bot.id) || this.isBotStopped(bot.id)) return;
    if (BotSingletonLock.hasRecentConflict(bot.id, 60000)) return;
    const norm = this.normalizeBotKey(bot.id);
    const existing =
      this.runners.get(bot.id) ||
      Array.from(this.runners.entries()).find(([k]) => this.normalizeBotKey(k) === norm)?.[1];
    if (!existing || !existing.isAlive()) {
      void this.startBotInstance(bot);
    }
  }

  private static startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(async () => {
      try {
        const mainStorage = StorageManager.getMainStorage();
        await mainStorage.loadLatest(false).catch(() => {});
        let bots = await mainStorage.getClonedBots().catch(() => []);
        if (bots.length === 0) {
          await mainStorage.loadLatest(true).catch(() => {});
          bots = await mainStorage.getClonedBots().catch(() => []);
        }
        const activeRegistryNorms = new Set<string>();
        for (const bot of bots) {
          if (this.isBotDeleted(bot.id)) continue;
          const norm = this.normalizeBotKey(bot.id);
          activeRegistryNorms.add(bot.id);
          if (norm) activeRegistryNorms.add(norm);
          if (bot.status === 'stopped') {
            this.stoppedBotIds.add(bot.id);
            for (const [k, r] of Array.from(this.runners.entries())) {
              if (k === bot.id || this.normalizeBotKey(k) === norm) {
                await r.stop({ dropPendingUpdates: true }).catch(() => {});
                this.runners.delete(k);
              }
            }
            if (norm && activeBots[norm]) {
              await activeBots[norm].stop({ dropPendingUpdates: true }).catch(() => {});
              delete activeBots[norm];
            }
          } else if (!this.isBotStopped(bot.id)) {
            if (BotSingletonLock.hasRecentConflict(bot.id, 60000)) {
              continue;
            }
            const runner =
              this.runners.get(bot.id) ||
              Array.from(this.runners.entries()).find(([k]) => this.normalizeBotKey(k) === norm)?.[1];
            if (!runner || !runner.isAlive()) {
              console.info(`[Watchdog] Checking/reviving polling runner for cloned bot @${bot.username} (${bot.id})...`);
              await this.startBotInstance(bot);
            }
          }
        }
        // Clean up any orphaned runners not in active registry
        for (const [runnerId, runner] of Array.from(this.runners.entries())) {
          const norm = this.normalizeBotKey(runnerId);
          if ((!activeRegistryNorms.has(runnerId) && !activeRegistryNorms.has(norm)) || this.isBotDeleted(runnerId)) {
            console.info(`[Watchdog] Shutting down orphaned runner (${runnerId})...`);
            await runner.stop({ dropPendingUpdates: true }).catch(() => {});
            this.runners.delete(runnerId);
            if (norm) delete activeBots[norm];
          }
        }
      } catch (err: any) {
        console.warn('[Watchdog] Cloned bot watchdog notice:', err?.message || err);
      }
    }, 30000);
  }

  public static async initAllBots(): Promise<void> {
    try {
      // Ensure primary main bot polling worker is initialized alongside cloned fleet (idempotent if already initialized)
      await TelegramService.initPollingWorker().catch(() => {});

      const mainStorage = StorageManager.getMainStorage();
      await mainStorage.init().catch(() => {});
      await mainStorage.loadLatest(true).catch(() => {});
      const mainToken = (await TelegramService.getBotToken().catch(() => '')).trim();
      const bots = await mainStorage.getClonedBots();
      console.info(`[TelegramBotManager] Initializing ${bots.length} cloned bots...`);
      for (const bot of bots) {
        if (this.isBotDeleted(bot.id)) continue;
        if (mainToken && String(bot.token || '').trim() === mainToken) {
          console.warn(`[TelegramBotManager] Skipping cloned bot "${bot.id}" because its token matches the primary main bot token.`);
          continue;
        }
        if (bot.status === 'stopped') {
          this.stoppedBotIds.add(bot.id);
        } else {
          this.stoppedBotIds.delete(bot.id);
          BotSingletonLock.clearConflict(bot.id);
          const ok = await this.startBotInstance(bot, { isStartupBoot: true });
          if (!ok && !this.isBotDeleted(bot.id) && !this.isBotStopped(bot.id)) {
            // Schedule a clean retry after rolling-deploy lock TTL settles so startup never leaves active clones stranded
            setTimeout(() => {
              if (!this.isBotDeleted(bot.id) && !this.isBotStopped(bot.id) && !this.isBotActivelyRunning(bot.id)) {
                BotSingletonLock.clearConflict(bot.id);
                void this.startBotInstance(bot, { isStartupBoot: true });
              }
            }, 8000);
          }
        }
      }
      this.startWatchdog();
    } catch (err: any) {
      console.error('[TelegramBotManager] Error initializing cloned bots:', err?.message || err);
    }
  }

  public static getActiveBaseUrl(customBase?: string): string {
    if (customBase && typeof customBase === 'string' && customBase.startsWith('http')) {
      return customBase.trim().replace(/\/+$/, '');
    }
    const envUrl = 
      process.env.BASE_URL ||
      process.env.APP_URL || 
      process.env.RENDER_EXTERNAL_URL ||
      (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '') ||
      process.env.URL ||
      'https://ais-pre-5pmvaj2s66z7xu34aogymi-761412699643.asia-east1.run.app';
    return envUrl.trim().replace(/\/+$/, '');
  }

  public static async startBotInstance(bot: ClonedBotRecord, opts?: { isStartupBoot?: boolean }): Promise<boolean> {
    if (this.isBotDeleted(bot.id) || this.isBotStopped(bot.id) || bot.status === 'stopped') {
      return false;
    }
    const cleanNorm = this.normalizeBotKey(bot.id) || bot.id;
    return withBotLifecycleLock(`clone:${cleanNorm}`, async () => {
      if (this.isBotDeleted(bot.id) || this.isBotStopped(bot.id) || bot.status === 'stopped') {
        return false;
      }

      // Stop and destroy ANY existing active runner / handle matching this bot ID or token before launching
      for (const [key, existingRunner] of Array.from(this.runners.entries())) {
        const sameId = key === bot.id || this.normalizeBotKey(key) === cleanNorm;
        const sameToken = Boolean(bot.token && existingRunner.bot?.token === bot.token);
        if (sameId || sameToken) {
          console.info(`[BotSingleton] Stopping existing runner (${key}) before launching ${bot.id}...`);
          await existingRunner.stop({ dropPendingUpdates: false }).catch(() => {});
          this.runners.delete(key);
        }
      }
      for (const [activeKey, handle] of Object.entries(activeBots)) {
        const sameId = activeKey === bot.id || activeKey === cleanNorm;
        const sameToken = Boolean(bot.token && handle.token === bot.token);
        if (sameId || sameToken) {
          await handle.stop({ dropPendingUpdates: false }).catch(() => {});
          delete activeBots[activeKey];
        }
      }

      const runner = new ClonedBotRunner(bot);
      this.runners.set(bot.id, runner);
      activeBots[cleanNorm] = {
        botId: bot.id,
        token: bot.token,
        stop: (stopOpts) => runner.stop(stopOpts),
        isAlive: () => runner.isAlive()
      };
      const started = await runner.start(opts).catch(() => false);
      if (!started) {
        this.runners.delete(bot.id);
        delete activeBots[cleanNorm];
        return false;
      }
      return true;
    });
  }

  public static async stopBot(id: string): Promise<boolean> {
    if (!id || id === 'main') {
      await TelegramService.stopBot(true);
      return true;
    }

    const mainStorage = StorageManager.getMainStorage();
    const bots = await mainStorage.getClonedBots().catch(() => []);
    const cleanNorm = this.normalizeBotKey(id);
    const target = bots.find(b => b.id === id || this.normalizeBotKey(b.id) === cleanNorm);
    const targetId = target?.id || id;
    const lockKey = cleanNorm || targetId;

    return withBotLifecycleLock(`clone:${lockKey}`, async () => {
      this.stoppedBotIds.add(targetId);
      if (cleanNorm) this.stoppedBotIds.add(cleanNorm);

      for (const [key, runner] of Array.from(this.runners.entries())) {
        if (key === targetId || (cleanNorm && this.normalizeBotKey(key) === cleanNorm)) {
          await runner.stop({ dropPendingUpdates: true }).catch(() => {});
          this.runners.delete(key);
        }
      }
      if (cleanNorm && activeBots[cleanNorm]) {
        await activeBots[cleanNorm].stop({ dropPendingUpdates: true }).catch(() => {});
        delete activeBots[cleanNorm];
      }
      if (activeBots[targetId]) {
        await activeBots[targetId].stop({ dropPendingUpdates: true }).catch(() => {});
        delete activeBots[targetId];
      }

      if (target) {
        await mainStorage.saveClonedBot({ ...target, status: 'stopped' }).catch(() => {});
        return true;
      }
      return false;
    });
  }

  public static async startBot(id: string): Promise<boolean> {
    if (!id || id === 'main') {
      return await TelegramService.startBot();
    }
    if (this.isBotDeleted(id)) return false;

    const mainStorage = StorageManager.getMainStorage();
    const bots = await mainStorage.getClonedBots().catch(() => []);
    const cleanNorm = this.normalizeBotKey(id);
    const target = bots.find(b => b.id === id || this.normalizeBotKey(b.id) === cleanNorm);
    if (!target) return false;

    BotSingletonLock.clearConflict(target.id);
    this.stoppedBotIds.delete(target.id);
    this.stoppedBotIds.delete(cleanNorm);

    const updated: ClonedBotRecord = { ...target, status: 'active' };
    const started = await this.startBotInstance(updated);
    if (!started) {
      return false;
    }
    await mainStorage.saveClonedBot(updated).catch(() => {});
    return true;
  }

  public static async restartBot(id: string): Promise<boolean> {
    if (!id || id === 'main') {
      const res = await TelegramService.restartBot();
      return res.ok;
    }
    if (this.isBotDeleted(id)) return false;

    const mainStorage = StorageManager.getMainStorage();
    const bots = await mainStorage.getClonedBots().catch(() => []);
    const cleanNorm = this.normalizeBotKey(id);
    const target = bots.find(b => b.id === id || this.normalizeBotKey(b.id) === cleanNorm);
    if (!target) return false;

    await this.stopBot(target.id);
    await TelegramService.cleanBotMemory(StorageManager.getStorage(target.id)).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    return this.startBot(target.id);
  }

  public static async cleanMemory(id?: string): Promise<{
    clearedRuntimeEntries: number;
    clearedStorageEntries: number;
    rssMb: number;
    heapUsedMb: number;
  }> {
    const targetStorage = (id && id !== 'main') ? StorageManager.getStorage(id) : undefined;
    return TelegramService.cleanBotMemory(targetStorage);
  }

  public static async validateCloneToken(token: string): Promise<{ ok: boolean; cleanToken?: string; info?: any; error?: string }> {
    const cleanToken = token.trim().replace(/^["']|["']$/g, '');
    const verification = await this.verifyBotToken(cleanToken);
    if (!verification.ok || !verification.info) {
      return { ok: false, error: verification.error || 'Invalid bot token' };
    }

    const info = verification.info;
    const botId = String(info.id).replace(/[^a-zA-Z0-9]/g, '');

    // 1. Check if token matches main bot's active token
    const mainBotToken = await TelegramService.getBotToken();
    if (cleanToken && mainBotToken && cleanToken === mainBotToken) {
      return { ok: false, error: 'Already this bot is already running.' };
    }

    // 2. Check if token or bot ID is already in cloned bots registry
    const mainStorage = StorageManager.getMainStorage();
    const existing = await mainStorage.getClonedBots();
    const foundExisting = existing.find((b: ClonedBotRecord) =>
      b.token === cleanToken ||
      b.id === botId ||
      b.id === `clone_${info.id}`
    );
    if (foundExisting) {
      return { ok: false, error: 'Already this bot is already running.' };
    }

    return { ok: true, cleanToken, info };
  }

  public static async cloneBot(
    token: string,
    createdBy?: string,
    customBaseUrl?: string,
    ownerInput?: { ownerId?: string; ownerUsername?: string },
    botMode: BotOperationalMode = 'file_bot'
  ): Promise<{ success: boolean; bot?: ClonedBotRecord; error?: string }> {
    const validation = await this.validateCloneToken(token);
    if (!validation.ok || !validation.info || !validation.cleanToken) {
      return { success: false, error: validation.error || 'Invalid bot token' };
    }

    const cleanToken = validation.cleanToken;
    const info = validation.info;
    const botId = String(info.id).replace(/[^a-zA-Z0-9]/g, '');
    const normalizedMode: BotOperationalMode = botMode === 'post_bot' ? 'post_bot' : 'file_bot';

    // Ensure tombstone flags are cleared if this bot ID is being freshly cloned
    this.deletedBotIds.delete(botId);
    this.deletedBotIds.delete(`clone_${botId}`);
    this.stoppedBotIds.delete(botId);
    this.stoppedBotIds.delete(`clone_${botId}`);

    // 1. Resolve official Owner User ID and/or Username
    const mainStorage = StorageManager.getMainStorage();
    let ownerId = (ownerInput?.ownerId || '').trim().replace(/^@+/, '');
    let ownerUsername = (ownerInput?.ownerUsername || '').trim().replace(/^@+/, '');

    if (ownerId && !/^\d+$/.test(ownerId) && !ownerUsername) {
      ownerUsername = ownerId;
      ownerId = '';
    }

    const lookupKey = ownerId || ownerUsername;
    if (lookupKey) {
      const foundUser = await mainStorage.findUserByIdOrUsername(lookupKey).catch(() => null);
      if (foundUser) {
        if (!ownerId && foundUser.id) ownerId = String(foundUser.id).trim();
        if (!ownerUsername && foundUser.username) ownerUsername = foundUser.username.replace(/^@+/, '').trim();
      }
    }

    const resolvedOwnerTelegramId = ownerId || ownerUsername || createdBy || String(info.id);

    // 2. Generate secure password and use clean Bot ID (e.g. 9112185641) as login identifier
    const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
    const numPart = Math.floor(100 + Math.random() * 900);
    const adminPassword = `Zexi#${randPart}${numPart}`;
    const baseDomain = this.getActiveBaseUrl(customBaseUrl);
    const panelUrl = `${baseDomain}/panel?bot_id=${botId}`;

    const newBot: ClonedBotRecord = {
      id: botId,
      token: cleanToken,
      name: info.first_name || 'Cloned Bot',
      username: info.username || '',
      status: 'active',
      botMode: normalizedMode,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || 'admin',
      ownerId: resolvedOwnerTelegramId,
      ownerUsername: ownerUsername || undefined,
      filesCount: 0,
      usersCount: 0,
      adminUsername: botId, // Login identifier is the clean Bot ID (e.g. 9112185641)
      adminPassword,
      panelUrl
    };

    await mainStorage.saveClonedBot(newBot);

    // 3. Initialize isolated storage for this cloned bot and assign official Owner & operational mode
    const botStorage = StorageManager.getStorage(botId);
    await botStorage.init();
    await botStorage.updateSettings({
      botToken: cleanToken,
      botUsername: info.username || '',
      rootAdminId: resolvedOwnerTelegramId,
      botMode: normalizedMode
    });

    // 4. Register official Owner strictly inside isolated bot storage with full administrative permissions
    const subAdminAccount = {
      id: /^\d+$/.test(resolvedOwnerTelegramId) ? resolvedOwnerTelegramId : `owner${botId}`,
      telegramId: resolvedOwnerTelegramId,
      name: ownerUsername ? `@${ownerUsername}` : `${info.first_name || 'Bot'} Owner`,
      username: ownerUsername || botId,
      role: 'owner' as const,
      passwordHash: await hashPassword(adminPassword),
      permissions: {
        files_view: true, files_add: true, files_edit: true, files_delete: true,
        links_view: true, links_add: true, links_edit: true, links_delete: true,
        messages_view: true, messages_edit: true, admins_manage: true,
        design_edit: true, settings_edit: true, cleanup_manage: true
      },
      status: 'active' as const,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    await botStorage.saveAdmin(subAdminAccount);
    await botStorage.syncToFirebaseCloud();

    // Commit cloned bot owner/credentials into Firebase Realtime Database under isolated paths
    try {
      const rtdbToken = await mainStorage.getFirebaseAuthToken();
      const isSecondary = process.env.FIREBASE_PROJECT_PROFILE === 'secondary' || process.env.ACTIVE_BOT_PROFILE === 'secondary';
      const baseUrl = (process.env.FIREBASE_DATABASE_URL || (isSecondary ? 'https://zexi-official-default-rtdb.asia-southeast1.firebasedatabase.app' : 'https://zexiofficial844-default-rtdb.asia-southeast1.firebasedatabase.app')).replace(/\/+$/, '');

      const subAdminData = {
        botId,
        botName: newBot.name,
        botUsername: newBot.username,
        botMode: normalizedMode,
        ownerId: resolvedOwnerTelegramId,
        ownerUsername: ownerUsername || '',
        adminUsername: botId,
        adminPassword,
        status: 'active',
        enabled: true,
        permissions: subAdminAccount.permissions,
        createdAt: newBot.createdAt,
        panelUrl
      };

      const botSubAdminUrl = rtdbToken
        ? `${baseUrl}/cloned_bots/${botId}/sub_admins/${botId}.json?auth=${encodeURIComponent(rtdbToken)}`
        : `${baseUrl}/cloned_bots/${botId}/sub_admins/${botId}.json`;
      fetch(botSubAdminUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subAdminData)
      }).catch(() => {});

      const globalSubAdminUrl = rtdbToken
        ? `${baseUrl}/sub_admins/${botId}.json?auth=${encodeURIComponent(rtdbToken)}`
        : `${baseUrl}/sub_admins/${botId}.json`;
      fetch(globalSubAdminUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subAdminData)
      }).catch(() => {});
    } catch (e: any) {
      console.warn('[TelegramBotManager] Error writing sub-admin to Firebase RTDB:', e?.message || e);
    }

    this.startBotInstance(newBot).catch(() => {});
    console.info(`[TelegramBotManager] Cloned bot @${newBot.username} (${newBot.id}) started in ${normalizedMode} mode! Owner: ${resolvedOwnerTelegramId}${ownerUsername ? ` (@${ownerUsername})` : ''}`);
    return { success: true, bot: newBot };
  }

  public static async setBotMode(id: string, mode: BotOperationalMode): Promise<{ ok: boolean; botMode: BotOperationalMode; error?: string }> {
    const cleanId = String(id || '').trim() || 'main';
    const nextMode: BotOperationalMode = mode === 'post_bot' ? 'post_bot' : 'file_bot';

    if (cleanId === 'main') {
      const mainStorage = StorageManager.getMainStorage();
      await mainStorage.updateSettings({ botMode: nextMode });
      return { ok: true, botMode: nextMode };
    }

    if (this.isBotDeleted(cleanId)) {
      return { ok: false, botMode: nextMode, error: 'Cloned bot has been deleted.' };
    }

    const mainStorage = StorageManager.getMainStorage();
    const cloned = await mainStorage.getClonedBots().catch(() => []);
    const cleanNorm = this.normalizeBotKey(cleanId);
    const target = cloned.find(b => b.id === cleanId || this.normalizeBotKey(b.id) === cleanNorm);
    if (!target) {
      return { ok: false, botMode: nextMode, error: 'Cloned bot not found.' };
    }

    target.botMode = nextMode;
    await mainStorage.saveClonedBot({ ...target, botMode: nextMode });

    const botStorage = StorageManager.getStorage(target.id);
    await botStorage.init().catch(() => {});
    await botStorage.updateSettings({ botMode: nextMode });

    console.info(`[TelegramBotManager] Bot ${target.id} (@${target.username}) switched mode to ${nextMode}`);
    return { ok: true, botMode: nextMode };
  }

  public static async deleteClonedBot(id: string): Promise<boolean> {
    if (!id || id === 'main') return false;
    const cleanId = String(id).trim();
    const cleanNorm = this.normalizeBotKey(cleanId);
    const candidateIds = Array.from(new Set([cleanId, cleanNorm, cleanNorm ? `clone_${cleanNorm}` : ''].filter(Boolean)));

    // 1. Immediately mark tombstones so in-flight updates, callbacks, or watchdogs stop instantly
    for (const cid of candidateIds) {
      this.deletedBotIds.add(cid);
      this.stoppedBotIds.add(cid);
    }

    // 2. Hard-stop any matching active runners, abort in-flight polling fetch, and drop Telegram webhook/pending updates
    const mainStorage = StorageManager.getMainStorage();
    const existingList = await mainStorage.getClonedBots().catch(() => []);
    const matchedBot = existingList.find(b => candidateIds.includes(b.id) || this.normalizeBotKey(b.id) === cleanNorm);

    for (const [runnerKey, runner] of Array.from(this.runners.entries())) {
      if (candidateIds.includes(runnerKey) || this.normalizeBotKey(runnerKey) === cleanNorm) {
        await runner.stop({ dropPendingUpdates: true }).catch(() => {});
        this.runners.delete(runnerKey);
      }
    }
    for (const cid of candidateIds) {
      if (activeBots[cid]) {
        await activeBots[cid].stop({ dropPendingUpdates: true }).catch(() => {});
        delete activeBots[cid];
      }
    }
    if (matchedBot?.token) {
      await BotSingletonLock.release(matchedBot.token, cleanId).catch(() => {});
      await TelegramService.callTelegramApi('deleteWebhook', { drop_pending_updates: true }, matchedBot.token).catch(() => {});
    }
    BotSingletonLock.clearConflict(cleanId);

    // 3. Destroy isolated StorageManager instance, local JSON files, and isolated Firebase RTDB records
    await StorageManager.destroyStorage(cleanId);
    const removed = await mainStorage.deleteClonedBot(cleanId);
    console.info(`[TelegramBotManager] Deleted cloned bot (${cleanId}): runner destroyed and isolated data purged.`);
    return removed;
  }

  public static async getAllBots(): Promise<Array<{
    id: string;
    name: string;
    username: string;
    isMain: boolean;
    status: 'active' | 'stopped';
    botMode: BotOperationalMode;
    filesCount: number;
    usersCount: number;
    createdAt?: string;
    ownerId?: string;
    ownerUsername?: string;
    adminUsername?: string;
    adminPassword?: string;
    panelUrl?: string;
  }>> {
    const mainStorage = StorageManager.getMainStorage();
    const mainSettings = await mainStorage.getSettings().catch(() => ({} as any));
    const mainItems = await mainStorage.getItems().catch(() => []);
    const mainUsers = await mainStorage.getBotUsers().catch(() => []);

    const mainStopped = TelegramService.isManuallyStopped() || Boolean(mainSettings?.botStopped);
    const list: any[] = [{
      id: 'main',
      name: mainSettings.botUsername ? `@${mainSettings.botUsername}` : 'Main Bot',
      username: mainSettings.botUsername || '',
      isMain: true,
      status: mainStopped ? 'stopped' : 'active',
      botMode: mainSettings.botMode === 'post_bot' ? 'post_bot' : 'file_bot',
      filesCount: mainItems.length,
      usersCount: mainUsers.length
    }];

    const cloned = await mainStorage.getClonedBots().catch(() => []);
    for (const c of cloned) {
      if (this.isBotDeleted(c.id)) continue;
      const cStorage = StorageManager.getStorage(c.id);
      const cSettings = await cStorage.getSettings().catch(() => ({} as any));
      const cItems = await cStorage.getItems().catch(() => []);
      const cUsers = await cStorage.getBotUsers().catch(() => []);
      const cleanBotId = String(c.id).replace(/^clone_/i, '').replace(/[:_-]/g, '');
      const isStopped = c.status === 'stopped' || this.isBotStopped(c.id);
      const effectiveMode: BotOperationalMode =
        cSettings?.botMode === 'post_bot' || (!cSettings?.botMode && c.botMode === 'post_bot')
          ? 'post_bot'
          : 'file_bot';
      list.push({
        id: c.id,
        name: c.name || `@${c.username}`,
        username: c.username,
        isMain: false,
        status: isStopped ? 'stopped' : 'active',
        botMode: effectiveMode,
        filesCount: cItems.length,
        usersCount: cUsers.length,
        createdAt: c.createdAt,
        ownerId: c.ownerId,
        ownerUsername: c.ownerUsername,
        adminUsername: cleanBotId,
        adminPassword: c.adminPassword,
        panelUrl: (c.panelUrl && c.panelUrl.startsWith('http'))
          ? c.panelUrl
          : `${this.getActiveBaseUrl()}${c.panelUrl || `/panel?bot_id=${cleanBotId}`}`
      });
    }

    return list;
  }
}
