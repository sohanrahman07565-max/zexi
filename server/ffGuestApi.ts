import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StorageManager, storage } from './storage';

export interface GuestSessionRecord {
  token: string;
  openId?: string;
  guestUid?: string;
  expiresAt: number;
  obtainedAt: number;
  source: 'env_token' | 'guest_login';
  credentialFingerprint: string;
}

export type GuestBancheckResult =
  | {
      ok: true;
      uid: string;
      username: string;
      nickname: string;
      region: string;
      level: string;
      likes: string;
      is_banned: boolean;
      status: 'Banned' | 'Not Banned';
      ban_type?: string;
      ban_time?: string;
      ban_reason?: string;
      source: 'guest_api';
    }
  | {
      ok: false;
      code:
        | 'INVALID_UID'
        | 'GUEST_CREDENTIALS_MISSING'
        | 'INVALID_GUEST_CREDENTIALS'
        | 'PLAYER_NOT_FOUND'
        | 'UPSTREAM_ERROR';
      error: string;
    };

export type GuestAccountValidationResult =
  | {
      ok: true;
      guestUid: string;
      inGameUid?: string;
      accountName: string;
    }
  | {
      ok: false;
      code: 'ACCOUNT_BANNED' | 'UNAUTHORIZED';
      error: string;
      accountName?: string;
      inGameUid?: string;
      banType?: string;
      banReason?: string;
    };

export interface GuestAccountInspectionResult {
  authOk: boolean;
  guestUid: string;
  inGameUid?: string;
  accountName: string;
  nameResolved: boolean;
  isBanned: boolean;
  banType?: string;
  banReason?: string;
  unauthorized?: boolean;
}

function isPresent(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return Boolean(s) && s !== 'none' && s !== 'null' && s !== 'n/a';
  }
  return true;
}

function parseBanBoolean(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
    return null;
  }
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (!s) return null;
    if (/\b(not[\s_-]?banned|unbanned|clean|safe|no)\b/i.test(s) || s === '0' || s === 'false') {
      return false;
    }
    if (/\b(banned|suspended|yes)\b/i.test(s) || s === '1' || s === 'true') {
      return true;
    }
  }
  return null;
}

function extractBanMeta(
  json: any,
  container: any,
  pObj: any,
  isBanned: boolean | null
): { banType?: string; banTime?: string; banReason?: string } {
  if (isBanned !== true) return {};

  const rawBanType =
    json?.ban_type ??
    json?.banType ??
    container?.ban_type ??
    container?.banType ??
    pObj?.ban_type ??
    pObj?.banType;

  const rawBanTime =
    json?.ban_time ??
    json?.banTime ??
    json?.ban_duration ??
    json?.banDuration ??
    json?.remaining_time ??
    json?.remainingTime ??
    json?.ban_until ??
    json?.banUntil ??
    json?.expires_at ??
    json?.expire_at ??
    json?.period ??
    container?.ban_time ??
    container?.banTime ??
    container?.ban_duration ??
    container?.banDuration ??
    container?.remaining_time ??
    container?.ban_until ??
    container?.expires_at ??
    container?.period ??
    pObj?.ban_time ??
    pObj?.ban_duration ??
    pObj?.ban_until ??
    pObj?.period;

  const rawMsg =
    typeof json?.msg === 'string' &&
    json.msg.trim() &&
    !/^(T_P_WRONG_ACCOUNT|success|ok)$/i.test(json.msg.trim())
      ? json.msg
      : undefined;

  const rawBanReason =
    json?.ban_reason ??
    json?.banReason ??
    json?.reason ??
    container?.ban_reason ??
    container?.banReason ??
    container?.reason ??
    pObj?.ban_reason ??
    pObj?.banReason ??
    pObj?.reason ??
    rawMsg;

  let banType = 'Permanent';
  if (isPresent(rawBanType)) {
    const s = String(rawBanType).trim();
    banType = /temp/i.test(s) ? 'Temporary' : /perm/i.test(s) ? 'Permanent' : s;
  } else if (isPresent(rawBanTime) && !/^(perm|permanent|forever|lifetime|0|-1)$/i.test(String(rawBanTime).trim())) {
    banType = 'Temporary';
  }

  let banTime = banType === 'Permanent' ? 'Permanent' : 'Unknown';
  if (banType !== 'Permanent' && isPresent(rawBanTime)) {
    const s = String(rawBanTime).trim();
    if (/^\d{10}$/.test(s)) {
      banTime = new Date(Number(s) * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    } else if (/^\d{13}$/.test(s)) {
      banTime = new Date(Number(s)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    } else {
      banTime = s;
    }
  }

  const banReason = isPresent(rawBanReason)
    ? String(rawBanReason).trim()
    : 'Not provided';

  return { banType, banTime, banReason };
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (typeof payload?.exp === 'number' && Number.isFinite(payload.exp) && payload.exp > 0) {
      return payload.exp * 1000;
    }
  } catch {}
  return null;
}

export class FreeFireGuestService {
  private static cachedSession: GuestSessionRecord | null = null;
  private static refreshInFlight: Promise<{ ok: true; session: GuestSessionRecord } | { ok: false; code: 'GUEST_CREDENTIALS_MISSING' | 'INVALID_GUEST_CREDENTIALS'; error: string }> | null = null;
  private static playerCache: Map<string, { data: any; fetchedAt: number }> = new Map();

  private static getEnvCredentials(): {
    guestUid: string;
    guestPassword: string;
    guestToken: string;
    guestOpenId: string;
    loginUrl: string;
    playerUrl: string;
    bancheckUpstreamUrl: string;
    fingerprint: string;
  } {
    const guestUid = (process.env.FF_GUEST_UID || '').trim();
    const guestPassword = (process.env.FF_GUEST_PASSWORD || '').trim();
    const guestToken = (process.env.FF_GUEST_TOKEN || '').trim();
    const guestOpenId = (process.env.FF_GUEST_OPEN_ID || '').trim();
    const loginUrl = (process.env.FF_GUEST_LOGIN_URL || 'https://100067.connect.garena.com/oauth/guest/token/grant').trim();
    const playerUrl = (process.env.FF_GUEST_PLAYER_URL || '').trim();
    const bancheckUpstreamUrl = (process.env.FF_BANCHECK_UPSTREAM_URL || '').trim();

    const fingerprint = crypto
      .createHash('sha256')
      .update(`${guestUid}|${guestPassword}|${guestToken}|${guestOpenId}|${loginUrl}`)
      .digest('hex')
      .slice(0, 24);

    return {
      guestUid,
      guestPassword,
      guestToken,
      guestOpenId,
      loginUrl,
      playerUrl,
      bancheckUpstreamUrl,
      fingerprint
    };
  }

  private static getSessionCacheFilePath(): string {
    const dataDir = StorageManager.getMainStorage().getDataDir();
    return path.join(dataDir, 'ff_guest_session.json');
  }

  private static loadDiskSession(expectedFingerprint: string): GuestSessionRecord | null {
    try {
      const filePath = this.getSessionCacheFilePath();
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as GuestSessionRecord;
      if (
        !parsed ||
        typeof parsed.token !== 'string' ||
        !parsed.token ||
        parsed.credentialFingerprint !== expectedFingerprint
      ) {
        return null;
      }
      if (typeof parsed.expiresAt !== 'number' || Date.now() >= parsed.expiresAt - 60_000) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private static saveDiskSession(session: GuestSessionRecord): void {
    try {
      const filePath = this.getSessionCacheFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
    } catch (err: any) {
      console.warn('[FFGuestAPI] Failed to persist guest session cache:', err?.message || err);
    }
  }

  private static clearCachedSession(): void {
    this.cachedSession = null;
    try {
      const filePath = this.getSessionCacheFilePath();
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }

  public static getStatus(): {
    configured: boolean;
    hasGuestUid: boolean;
    hasGuestPassword: boolean;
    hasGuestToken: boolean;
    sessionCached: boolean;
    expiresAt: number | null;
  } {
    const creds = this.getEnvCredentials();
    const hasLoginPair = Boolean(creds.guestUid && creds.guestPassword);
    const hasToken = Boolean(creds.guestToken);
    const active =
      (this.cachedSession &&
        this.cachedSession.credentialFingerprint === creds.fingerprint &&
        Date.now() < this.cachedSession.expiresAt - 60_000
        ? this.cachedSession
        : null) || this.loadDiskSession(creds.fingerprint);

    return {
      configured: hasLoginPair || hasToken,
      hasGuestUid: Boolean(creds.guestUid),
      hasGuestPassword: Boolean(creds.guestPassword),
      hasGuestToken: hasToken,
      sessionCached: Boolean(active),
      expiresAt: active ? active.expiresAt : null
    };
  }

  public static async ensureGuestSession(
    forceRefresh: boolean = false
  ): Promise<
    | { ok: true; session: GuestSessionRecord }
    | { ok: false; code: 'GUEST_CREDENTIALS_MISSING' | 'INVALID_GUEST_CREDENTIALS'; error: string }
  > {
    const creds = this.getEnvCredentials();
    const hasLoginPair = Boolean(creds.guestUid && creds.guestPassword);
    const hasDirectToken = Boolean(creds.guestToken);

    if (!hasLoginPair && !hasDirectToken) {
      return {
        ok: false,
        code: 'GUEST_CREDENTIALS_MISSING',
        error: 'Free Fire Guest credentials are not configured. Set FF_GUEST_UID and FF_GUEST_PASSWORD (or FF_GUEST_TOKEN) in .env.'
      };
    }

    if (!forceRefresh) {
      if (
        this.cachedSession &&
        this.cachedSession.credentialFingerprint === creds.fingerprint &&
        Date.now() < this.cachedSession.expiresAt - 60_000
      ) {
        return { ok: true, session: this.cachedSession };
      }

      const fromDisk = this.loadDiskSession(creds.fingerprint);
      if (fromDisk) {
        this.cachedSession = fromDisk;
        return { ok: true, session: fromDisk };
      }
    } else {
      this.clearCachedSession();
    }

    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        // Prefer credential grant login when FF_GUEST_UID & FF_GUEST_PASSWORD are set and refreshing or no static token
        if (hasLoginPair && (forceRefresh || !hasDirectToken)) {
          const authResult = await this.authenticateGuestAccount(creds);
          if (authResult.ok) {
            this.cachedSession = authResult.session;
            this.saveDiskSession(authResult.session);
            return authResult;
          }
          // Fall back to static FF_GUEST_TOKEN only if not forced refresh and static token is set
          if (!hasDirectToken || forceRefresh) {
            return authResult;
          }
        }

        if (hasDirectToken) {
          const jwtExp = decodeJwtExpMs(creds.guestToken);
          const now = Date.now();
          const session: GuestSessionRecord = {
            token: creds.guestToken,
            openId: creds.guestOpenId || undefined,
            guestUid: creds.guestUid || undefined,
            obtainedAt: now,
            expiresAt: jwtExp && jwtExp > now ? jwtExp : now + 6 * 3600 * 1000,
            source: 'env_token',
            credentialFingerprint: creds.fingerprint
          };
          this.cachedSession = session;
          this.saveDiskSession(session);
          return { ok: true as const, session };
        }

        return {
          ok: false as const,
          code: 'GUEST_CREDENTIALS_MISSING' as const,
          error: 'Free Fire Guest credentials are incomplete. Provide FF_GUEST_UID and FF_GUEST_PASSWORD, or FF_GUEST_TOKEN.'
        };
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  private static async authenticateGuestAccount(creds: {
    guestUid: string;
    guestPassword: string;
    guestOpenId: string;
    loginUrl: string;
    fingerprint: string;
  }): Promise<
    | { ok: true; session: GuestSessionRecord }
    | { ok: false; code: 'INVALID_GUEST_CREDENTIALS'; error: string }
  > {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);

        const formParams = new URLSearchParams({
          uid: creds.guestUid,
          password: creds.guestPassword,
          response_type: 'token',
          client_id: '100067',
          client_type: '2',
          redirect_uri: 'https://api.ff.garena.co.id/auth/auth/callback_n?site=https://api-ticket.ff.garena.co.id'
        });

        const res = await fetch(creds.loginUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'GarenaMSDK/4.0.19P8(Redmi Note 8 ;Android 11;en;US;)'
          },
          body: formParams.toString(),
          signal: controller.signal
        });
        clearTimeout(timer);

        const json: any = await res.json().catch(() => null);
        const token =
          json?.access_token ||
          json?.token ||
          json?.jwt ||
          json?.data?.access_token ||
          json?.data?.token;

        if (!res.ok || !token || typeof token !== 'string') {
          if ((res.status === 429 || res.status >= 500) && attempt < 2) {
            await new Promise((r) => setTimeout(r, 350));
            continue;
          }
          const errCode = [
            json?.error,
            json?.error_description,
            json?.msg,
            json?.message,
            json?.reason
          ]
            .filter((v) => typeof v === 'string' && v.trim())
            .join(' ')
            .trim();
          return {
            ok: false,
            code: 'INVALID_GUEST_CREDENTIALS',
            error: errCode
              ? `Free Fire Guest login rejected (${errCode}). Verify FF_GUEST_UID and FF_GUEST_PASSWORD.`
              : 'Free Fire Guest login failed. Verify FF_GUEST_UID and FF_GUEST_PASSWORD in .env.'
          };
        }

        const now = Date.now();
        const expiresInSec = Number(json?.expires_in || json?.data?.expires_in || 0);
        const jwtExp = decodeJwtExpMs(token);
        const expiresAt =
          jwtExp && jwtExp > now
            ? jwtExp
            : now + (Number.isFinite(expiresInSec) && expiresInSec > 60 ? expiresInSec * 1000 : 6 * 3600 * 1000);

        const session: GuestSessionRecord = {
          token,
          openId: String(json?.open_id || json?.data?.open_id || creds.guestOpenId || '').trim() || undefined,
          guestUid: creds.guestUid,
          obtainedAt: now,
          expiresAt,
          source: 'guest_login',
          credentialFingerprint: creds.fingerprint
        };

        return { ok: true, session };
      } catch (err: any) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        return {
          ok: false,
          code: 'INVALID_GUEST_CREDENTIALS',
          error: `Free Fire Guest authentication request failed: ${err?.message || 'network error'}`
        };
      }
    }

    return {
      ok: false,
      code: 'INVALID_GUEST_CREDENTIALS',
      error: 'Free Fire Guest authentication failed.'
    };
  }

  private static async fetchPlayerProfile(
    uid: string,
    session: GuestSessionRecord,
    customPlayerUrl: string
  ): Promise<any | null> {
    const cached = this.playerCache.get(uid);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
      return cached.data;
    }

    const urlsToTry: Array<{ url: string; headers: Record<string, string> }> = [];
    if (customPlayerUrl) {
      const targetUrl = customPlayerUrl.includes('{uid}')
        ? customPlayerUrl.replace(/\{uid\}/g, encodeURIComponent(uid))
        : `${customPlayerUrl}${customPlayerUrl.includes('?') ? '&' : '?'}uid=${encodeURIComponent(uid)}`;
      urlsToTry.push({
        url: targetUrl,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.token}`,
          ...(session.openId ? { 'X-Open-Id': session.openId } : {}),
          ...(session.guestUid ? { 'X-Guest-Uid': session.guestUid } : {})
        }
      });
    }

    urlsToTry.push({
      url: `https://auraffxserverinfocheckerapi.onrender.com/api/player?uid=${encodeURIComponent(uid)}`,
      headers: { Accept: 'application/json' }
    });

    for (const candidate of urlsToTry) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);
        const res = await fetch(candidate.url, {
          method: 'GET',
          headers: candidate.headers,
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) continue;

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || json.error) continue;

        const playerObj = json.player && typeof json.player === 'object' && !json.player.error ? json.player : json;
        if (
          isPresent(playerObj?.name) ||
          isPresent(playerObj?.nickname) ||
          isPresent(playerObj?.username) ||
          isPresent(json?.name) ||
          isPresent(playerObj?.uid) ||
          isPresent(json?.uid)
        ) {
          if (this.playerCache.size > 200) {
            const oldest = this.playerCache.keys().next().value;
            if (oldest) this.playerCache.delete(oldest);
          }
          this.playerCache.set(uid, { data: json, fetchedAt: Date.now() });
          return json;
        }
      } catch {}
    }

    return null;
  }

  private static async queryUpstreamBancheck(
    uid: string,
    session: GuestSessionRecord,
    upstreamOverrideUrl: string
  ): Promise<{
    unauthorized?: boolean;
    notFound?: boolean;
    isBanned: boolean | null;
    banType?: string;
    banTime?: string;
    banReason?: string;
    playerOverride?: {
      name?: string;
      region?: string;
      level?: string;
      likes?: string;
    };
  }> {
    const targetUrl = upstreamOverrideUrl
      ? (upstreamOverrideUrl.includes('{uid}')
          ? upstreamOverrideUrl.replace(/\{uid\}/g, encodeURIComponent(uid))
          : `${upstreamOverrideUrl}${upstreamOverrideUrl.includes('?') ? '&' : '?'}uid=${encodeURIComponent(uid)}`)
      : `https://ff.garena.com/api/antihack/check_banned?lang=en&uid=${encodeURIComponent(uid)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
      Authorization: `Bearer ${session.token}`,
      ...(session.openId ? { 'X-Open-Id': session.openId } : {}),
      ...(session.guestUid ? { 'X-Guest-Uid': session.guestUid } : {})
    };

    if (!upstreamOverrideUrl) {
      headers.Referer = 'https://ff.garena.com/en/support/';
      headers['x-requested-with'] = 'B6FksShzIgjfrYImLpTsadjS86sddhFH';
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        return { unauthorized: true, isBanned: null };
      }
      if (!res.ok) {
        return { isBanned: null };
      }

      const json: any = await res.json().catch(() => null);
      if (!json) return { isBanned: null };

      if (json?.msg === 'T_P_WRONG_ACCOUNT') {
        return { notFound: true, isBanned: null };
      }

      const container = json?.data && typeof json.data === 'object' ? json.data : json;
      const rawStatus =
        json?.is_banned ??
        json?.isBanned ??
        json?.banned ??
        container?.is_banned ??
        container?.isBanned ??
        container?.banned ??
        (json?.status !== 'success' && json?.status !== 'error' ? json?.status : undefined);

      const isBanned = parseBanBoolean(rawStatus);
      const pObj = json?.player && typeof json.player === 'object' ? json.player : container;
      const banMeta = extractBanMeta(json, container, pObj, isBanned);
      const playerOverride = {
        name: isPresent(pObj?.username || pObj?.nickname || pObj?.name)
          ? String(pObj.username || pObj.nickname || pObj.name).trim()
          : undefined,
        region: isPresent(pObj?.region_name || pObj?.region)
          ? String(pObj.region_name || pObj.region).trim()
          : undefined,
        level: isPresent(pObj?.level) ? String(pObj.level).trim() : undefined,
        likes: isPresent(pObj?.likes) ? String(pObj.likes).trim() : undefined
      };

      return {
        isBanned,
        banType: banMeta.banType,
        banTime: banMeta.banTime,
        banReason: banMeta.banReason,
        playerOverride
      };
    } catch {
      return { isBanned: null };
    }
  }

  public static async checkBanStatus(rawUid: string): Promise<GuestBancheckResult> {
    const cleanUid = String(rawUid || '').trim();
    if (!/^\d{5,20}$/.test(cleanUid)) {
      return {
        ok: false,
        code: 'INVALID_UID',
        error: 'Please provide a valid numeric Free Fire UID.'
      };
    }

    const sessionRes = await this.ensureGuestSession(false);
    if (!sessionRes.ok) {
      return sessionRes;
    }

    const creds = this.getEnvCredentials();
    let activeSession = sessionRes.session;

    const playerPromise = this.fetchPlayerProfile(cleanUid, activeSession, creds.playerUrl).catch(() => null);
    let banRes = await this.queryUpstreamBancheck(cleanUid, activeSession, creds.bancheckUpstreamUrl);

    // Auto-refresh expired/rejected session once if login credentials are available
    if (banRes.unauthorized && creds.guestUid && creds.guestPassword) {
      const refreshed = await this.ensureGuestSession(true);
      if (!refreshed.ok) {
        return refreshed;
      }
      activeSession = refreshed.session;
      banRes = await this.queryUpstreamBancheck(cleanUid, activeSession, creds.bancheckUpstreamUrl);
    }

    if (banRes.unauthorized) {
      return {
        ok: false,
        code: 'INVALID_GUEST_CREDENTIALS',
        error: 'Free Fire Guest session token was rejected. Update FF_GUEST_TOKEN or FF_GUEST_UID / FF_GUEST_PASSWORD in .env.'
      };
    }

    const playerData = await playerPromise;
    if (banRes.notFound || (banRes.isBanned === null && !playerData)) {
      return {
        ok: false,
        code: 'PLAYER_NOT_FOUND',
        error: `No Free Fire account found for UID ${cleanUid}.`
      };
    }

    if (banRes.isBanned === null) {
      return {
        ok: false,
        code: 'UPSTREAM_ERROR',
        error: 'Bancheck upstream service did not return a ban status. Please try again.'
      };
    }

    const p =
      playerData?.player && typeof playerData.player === 'object' && !playerData.player.error
        ? playerData.player
        : playerData;

    const username =
      banRes.playerOverride?.name ||
      (isPresent(p?.name)
        ? String(p.name).trim()
        : isPresent(playerData?.name)
          ? String(playerData.name).trim()
          : 'Unknown');

    let region = banRes.playerOverride?.region || '';
    if (!region) {
      const regionFlag = isPresent(p?.region_flag || playerData?.region_flag)
        ? String(p?.region_flag || playerData?.region_flag).trim()
        : '';
      const regionName = isPresent(p?.region_name || playerData?.region_name)
        ? String(p?.region_name || playerData?.region_name).trim()
        : '';
      const regionCode = isPresent(p?.region || playerData?.region)
        ? String(p?.region || playerData?.region).trim()
        : '';
      const regionText =
        regionName && regionCode && regionName.toLowerCase() !== regionCode.toLowerCase()
          ? `${regionName} (${regionCode})`
          : regionName || regionCode || 'Unknown';
      region = regionFlag ? `${regionFlag} ${regionText}` : regionText;
    }

    const level =
      banRes.playerOverride?.level ||
      (isPresent(p?.level ?? playerData?.level) ? String(p?.level ?? playerData?.level) : 'Unknown');
    const likes =
      banRes.playerOverride?.likes ||
      (isPresent(p?.likes ?? playerData?.likes) ? String(p?.likes ?? playerData?.likes) : '0');

    return {
      ok: true,
      uid: cleanUid,
      username,
      nickname: username,
      region,
      level,
      likes,
      is_banned: banRes.isBanned,
      status: banRes.isBanned ? 'Banned' : 'Not Banned',
      ...(banRes.isBanned
        ? {
            ban_type: banRes.banType || 'Permanent',
            ban_time: (banRes.banType || 'Permanent') === 'Permanent' ? 'Permanent' : (banRes.banTime || 'Unknown'),
            ban_reason: banRes.banReason || 'Not provided'
          }
        : {}),
      source: 'guest_api'
    };
  }

  // =========================================================================
  // FREE FIRE GUEST LIKE ENGINE (/like <uid>)
  // =========================================================================
  private static readonly FF_AES_KEY = Buffer.from('Yg&tc%DEuh6%Zc^8', 'utf8');
  private static readonly FF_AES_IV = Buffer.from('6oyZDr22E3ychjM%', 'utf8');

  private static aesEncryptFreeFire(plain: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.FF_AES_KEY, this.FF_AES_IV);
    return Buffer.concat([cipher.update(plain), cipher.final()]);
  }

  private static encodeProtobufVarint(value: bigint | number): Buffer {
    let v = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.trunc(value)));
    const bytes: number[] = [];
    while (v >= 0x80n) {
      bytes.push(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    bytes.push(Number(v));
    return Buffer.from(bytes);
  }

  private static encodeProtobufTag(fieldNumber: number, wireType: 0 | 2): Buffer {
    return this.encodeProtobufVarint((fieldNumber << 3) | wireType);
  }

  private static encodeProtobufBytesField(fieldNumber: number, data: Buffer): Buffer {
    return Buffer.concat([
      this.encodeProtobufTag(fieldNumber, 2),
      this.encodeProtobufVarint(data.length),
      data
    ]);
  }

  private static encodeProtobufStringField(fieldNumber: number, str: string): Buffer {
    return this.encodeProtobufBytesField(fieldNumber, Buffer.from(str, 'utf8'));
  }

  private static encodeProtobufVarintField(fieldNumber: number, value: bigint | number): Buffer {
    return Buffer.concat([
      this.encodeProtobufTag(fieldNumber, 0),
      this.encodeProtobufVarint(value)
    ]);
  }

  private static buildLikeProfilePayload(targetUid: string, regionCode: string): Buffer {
    const uidBigInt = BigInt(targetUid);
    const cleanRegion = (regionCode || 'IND').trim().toUpperCase() || 'IND';
    return Buffer.concat([
      this.encodeProtobufVarintField(1, uidBigInt),
      this.encodeProtobufStringField(2, cleanRegion)
    ]);
  }

  private static buildMajorLoginPayload(openId: string, accessToken: string): Buffer {
    const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const deviceRand = crypto.randomBytes(6).toString('hex');
    const chunks: Buffer[] = [
      this.encodeProtobufStringField(3, nowIso),
      this.encodeProtobufStringField(4, 'free fire'),
      this.encodeProtobufVarintField(5, 1),
      this.encodeProtobufStringField(7, '1.111.1'),
      this.encodeProtobufStringField(8, 'Android OS 11 / API-30 (RKQ1.200826.002/V12.5.1.0)'),
      this.encodeProtobufStringField(9, 'Handheld'),
      this.encodeProtobufStringField(10, 'Xiaomi'),
      this.encodeProtobufStringField(11, 'WIFI'),
      this.encodeProtobufVarintField(12, 1080),
      this.encodeProtobufVarintField(13, 2400),
      this.encodeProtobufStringField(14, '440'),
      this.encodeProtobufStringField(15, 'Qualcomm Technologies, Inc SM8250|Adreno (TM) 650|7596'),
      this.encodeProtobufVarintField(16, 7596),
      this.encodeProtobufStringField(17, deviceRand),
      this.encodeProtobufStringField(18, 'Google Play'),
      this.encodeProtobufStringField(19, `gaid_${deviceRand}`),
      this.encodeProtobufStringField(22, openId),
      this.encodeProtobufStringField(23, '1'),
      this.encodeProtobufStringField(24, 'en'),
      this.encodeProtobufStringField(25, 'en'),
      this.encodeProtobufStringField(29, accessToken),
      this.encodeProtobufStringField(30, '1'),
      this.encodeProtobufStringField(60, '0'),
      this.encodeProtobufStringField(73, '4'),
      this.encodeProtobufStringField(95, '0')
    ];
    return Buffer.concat(chunks);
  }

  private static extractProtobufStrings(buf: Buffer): string[] {
    const out: string[] = [];
    let offset = 0;

    const readVarint = (): { value: number; next: number } | null => {
      let result = 0;
      let shift = 0;
      let pos = offset;
      while (pos < buf.length && shift <= 49) {
        const b = buf[pos++];
        result += (b & 0x7f) * 2 ** shift;
        if ((b & 0x80) === 0) {
          return { value: result, next: pos };
        }
        shift += 7;
      }
      return null;
    };

    while (offset < buf.length) {
      const tagRes = readVarint();
      if (!tagRes) break;
      offset = tagRes.next;
      const wireType = tagRes.value & 0x07;
      if (wireType === 0) {
        const valRes = readVarint();
        if (!valRes) break;
        offset = valRes.next;
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 2) {
        const lenRes = readVarint();
        if (!lenRes) break;
        offset = lenRes.next;
        const end = offset + lenRes.value;
        if (end > buf.length || lenRes.value < 0) break;
        const slice = buf.subarray(offset, end);
        const text = slice.toString('utf8');
        if (/^[\x20-\x7e]+$/.test(text)) {
          out.push(text);
        }
        offset = end;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        break;
      }
    }

    return out;
  }

  private static extractLoginTokenAndUrl(buf: Buffer): { jwtToken?: string; serverUrl?: string; accountRegion?: string } {
    const strings = this.extractProtobufStrings(buf);
    let jwtToken = strings.find((s) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s));
    let serverUrl = strings.find((s) => /^https?:\/\/[a-z0-9.-]+/i.test(s) && /freefire|ggblueshark|ggbluefox/i.test(s));
    let accountRegion = strings.find((s) => /^(IND|ID|BR|SG|BD|PK|VN|TH|TW|ME|NA|US|SAC|EU|RU)$/i.test(s));

    if (!jwtToken || !serverUrl) {
      const ascii = buf.toString('latin1');
      if (!jwtToken) {
        const jwtMatch = ascii.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
        if (jwtMatch) jwtToken = jwtMatch[0];
      }
      if (!serverUrl) {
        const urlMatch = ascii.match(/https?:\/\/[a-z0-9.-]+(?:freefiremobile|ggblueshark|ggbluefox)\.com(?::\d+)?/i);
        if (urlMatch) serverUrl = urlMatch[0];
      }
    }

    return { jwtToken, serverUrl, accountRegion };
  }

  private static extractMajorLoginDetails(buf: Buffer): {
    jwtToken?: string;
    serverUrl?: string;
    accountRegion?: string;
    inGameUid?: string;
    nickname?: string;
    isBannedHint: boolean;
  } {
    const base = this.extractLoginTokenAndUrl(buf);
    const strings = this.extractProtobufStrings(buf);
    const rawUtf8 = buf.toString('utf8');
    const isBannedHint =
      strings.some((s) => /\b(banned|account_banned|suspended|t_p_ban)\b/i.test(s)) ||
      /\b(account_banned|t_p_ban|err_account_banned)\b/i.test(rawUtf8);

    let inGameUid: string | undefined;
    let nickname: string | undefined;
    let accountRegion = base.accountRegion;

    if (base.jwtToken) {
      try {
        const parts = base.jwtToken.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
          const payload = JSON.parse(payloadJson);
          const rawId = payload?.account_id ?? payload?.accountId ?? payload?.uid;
          if (rawId !== undefined && rawId !== null && /^\d{5,20}$/.test(String(rawId).trim())) {
            inGameUid = String(rawId).trim();
          }
          const rawNick = payload?.nickname ?? payload?.name ?? payload?.account_name ?? payload?.username;
          if (isPresent(rawNick)) {
            nickname = String(rawNick).trim();
          }
          const rawReg = payload?.lock_region ?? payload?.noti_region ?? payload?.region;
          if (!accountRegion && isPresent(rawReg)) {
            accountRegion = String(rawReg).trim().toUpperCase();
          }
        }
      } catch {}
    }

    // Fallback: parse top-level protobuf field 1 (varint uint64 account_id) from MajorLoginRes
    if (!inGameUid && buf.length > 2) {
      try {
        let pos = 0;
        while (pos < buf.length) {
          let tag = 0n;
          let shift = 0n;
          while (pos < buf.length && shift <= 56n) {
            const b = BigInt(buf[pos++]);
            tag |= (b & 0x7fn) << shift;
            if ((b & 0x80n) === 0n) break;
            shift += 7n;
          }
          const fieldNum = Number(tag >> 3n);
          const wireType = Number(tag & 0x07n);
          if (wireType === 0) {
            let val = 0n;
            let vShift = 0n;
            while (pos < buf.length && vShift <= 63n) {
              const b = BigInt(buf[pos++]);
              val |= (b & 0x7fn) << vShift;
              if ((b & 0x80n) === 0n) break;
              vShift += 7n;
            }
            if (fieldNum === 1 && val >= 10000n) {
              inGameUid = val.toString();
              break;
            }
          } else if (wireType === 1) {
            pos += 8;
          } else if (wireType === 2) {
            let len = 0;
            let lShift = 0;
            while (pos < buf.length && lShift <= 35) {
              const b = buf[pos++];
              len += (b & 0x7f) * 2 ** lShift;
              if ((b & 0x80) === 0) break;
              lShift += 7;
            }
            if (len < 0 || pos + len > buf.length) break;
            pos += len;
          } else if (wireType === 5) {
            pos += 4;
          } else {
            break;
          }
        }
      } catch {}
    }

    return {
      jwtToken: base.jwtToken,
      serverUrl: base.serverUrl,
      accountRegion,
      inGameUid,
      nickname,
      isBannedHint
    };
  }

  private static async resolveTokenInspectInfo(
    accessToken: string
  ): Promise<{ openId?: string; nickname?: string; uid?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(
        `https://100067.connect.garena.com/oauth/token/inspect?token=${encodeURIComponent(accessToken)}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'GarenaMSDK/4.0.19P8(Redmi Note 8 ;Android 11;en;US;)'
          },
          signal: controller.signal
        }
      );
      clearTimeout(timer);
      const json: any = await res.json().catch(() => null);
      const openId = String(json?.open_id || json?.openId || json?.data?.open_id || '').trim() || undefined;
      const rawNick = json?.nickname ?? json?.name ?? json?.username ?? json?.data?.nickname ?? json?.data?.name;
      const nickname = isPresent(rawNick) ? String(rawNick).trim() : undefined;
      const rawUid = json?.uid ?? json?.account_id ?? json?.data?.uid;
      const uid = rawUid && /^\d{5,20}$/.test(String(rawUid).trim()) ? String(rawUid).trim() : undefined;
      return { openId, nickname, uid };
    } catch {
      return {};
    }
  }

  private static async resolveOpenIdFromToken(accessToken: string): Promise<string | undefined> {
    const info = await this.resolveTokenInspectInfo(accessToken);
    return info.openId;
  }

  private static async checkDirectBanStatus(
    uid: string,
    session?: GuestSessionRecord
  ): Promise<{
    notFound?: boolean;
    isBanned: boolean | null;
    banType?: string;
    banReason?: string;
    playerName?: string;
  }> {
    const cleanUid = String(uid || '').trim();
    if (!/^\d{5,20}$/.test(cleanUid)) {
      return { isBanned: null };
    }

    const upstreamOverride = (process.env.FF_BANCHECK_UPSTREAM_URL || '').trim();
    const targetUrl = upstreamOverride
      ? (upstreamOverride.includes('{uid}')
          ? upstreamOverride.replace(/\{uid\}/g, encodeURIComponent(cleanUid))
          : `${upstreamOverride}${upstreamOverride.includes('?') ? '&' : '?'}uid=${encodeURIComponent(cleanUid)}`)
      : `https://ff.garena.com/api/antihack/check_banned?lang=en&uid=${encodeURIComponent(cleanUid)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0'
    };
    if (!upstreamOverride) {
      headers.Referer = 'https://ff.garena.com/en/support/';
      headers['x-requested-with'] = 'B6FksShzIgjfrYImLpTsadjS86sddhFH';
    }
    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
      if (session.openId) headers['X-Open-Id'] = session.openId;
      if (session.guestUid) headers['X-Guest-Uid'] = session.guestUid;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(targetUrl, { method: 'GET', headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return { isBanned: null };

      const json: any = await res.json().catch(() => null);
      if (!json) return { isBanned: null };
      if (json?.msg === 'T_P_WRONG_ACCOUNT') {
        return { notFound: true, isBanned: null };
      }

      const container = json?.data && typeof json.data === 'object' ? json.data : json;
      const rawStatus =
        json?.is_banned ??
        json?.isBanned ??
        json?.banned ??
        container?.is_banned ??
        container?.isBanned ??
        container?.banned ??
        (json?.status !== 'success' && json?.status !== 'error' ? json?.status : undefined);
      const isBanned = parseBanBoolean(rawStatus);
      const pObj = json?.player && typeof json.player === 'object' ? json.player : container;
      const banMeta = extractBanMeta(json, container, pObj, isBanned);
      const playerName = isPresent(pObj?.username || pObj?.nickname || pObj?.name)
        ? String(pObj.username || pObj.nickname || pObj.name).trim()
        : undefined;

      return {
        isBanned,
        banType: banMeta.banType,
        banReason: banMeta.banReason,
        playerName
      };
    } catch {
      return { isBanned: null };
    }
  }

  private static extractPlayerStatsFromPersonalShow(buf: Buffer): {
    nickname?: string;
    region?: string;
    likes?: number;
  } {
    const readFields = (slice: Buffer): Array<{ fieldNum: number; wireType: number; varint?: bigint; data?: Buffer }> => {
      const fields: Array<{ fieldNum: number; wireType: number; varint?: bigint; data?: Buffer }> = [];
      let pos = 0;
      const readVarBig = (): bigint | null => {
        let res = 0n;
        let shift = 0n;
        while (pos < slice.length && shift <= 63n) {
          const b = BigInt(slice[pos++]);
          res |= (b & 0x7fn) << shift;
          if ((b & 0x80n) === 0n) return res;
          shift += 7n;
        }
        return null;
      };
      while (pos < slice.length) {
        const tag = readVarBig();
        if (tag === null) break;
        const fieldNum = Number(tag >> 3n);
        const wireType = Number(tag & 0x07n);
        if (wireType === 0) {
          const val = readVarBig();
          if (val === null) break;
          fields.push({ fieldNum, wireType, varint: val });
        } else if (wireType === 1) {
          pos += 8;
        } else if (wireType === 2) {
          const lenBig = readVarBig();
          if (lenBig === null) break;
          const len = Number(lenBig);
          if (!Number.isFinite(len) || len < 0 || pos + len > slice.length) break;
          const data = slice.subarray(pos, pos + len);
          pos += len;
          fields.push({ fieldNum, wireType, data });
        } else if (wireType === 5) {
          pos += 4;
        } else {
          break;
        }
      }
      return fields;
    };

    try {
      const topFields = readFields(buf);
      const basicInfo = topFields.find((f) => f.fieldNum === 1 && f.wireType === 2 && f.data);
      if (basicInfo?.data) {
        const innerFields = readFields(basicInfo.data);
        let nickname: string | undefined;
        let region: string | undefined;
        let likes: number | undefined;

        const nickField = innerFields.find((f) => f.fieldNum === 3 && f.wireType === 2 && f.data);
        if (nickField?.data && nickField.data.length > 0 && nickField.data.length <= 64) {
          const text = nickField.data.toString('utf8').replace(/\0/g, '').trim();
          if (isPresent(text) && !/^https?:\/\//i.test(text)) {
            nickname = text;
          }
        }

        const regionField = innerFields.find((f) => f.fieldNum === 5 && f.wireType === 2 && f.data);
        if (regionField?.data && regionField.data.length > 0 && regionField.data.length <= 16) {
          const regText = regionField.data.toString('utf8').replace(/\0/g, '').trim().toUpperCase();
          if (/^[A-Z]{2,6}$/.test(regText)) {
            region = regText;
          }
        }

        const likesField = innerFields.find((f) => f.fieldNum === 21 && f.wireType === 0 && f.varint !== undefined);
        if (likesField?.varint !== undefined) {
          const likesNum = Number(likesField.varint);
          if (Number.isFinite(likesNum) && likesNum >= 0) {
            likes = likesNum;
          }
        }

        return { nickname, region, likes };
      }
    } catch {}
    return {};
  }

  private static extractNicknameFromPersonalShow(buf: Buffer): string | undefined {
    return this.extractPlayerStatsFromPersonalShow(buf).nickname;
  }

  private static async fetchPlayerStatsViaGameServer(
    serverUrl: string,
    jwtToken: string,
    targetUid: string
  ): Promise<{ nickname?: string; region?: string; likes?: number }> {
    if (!serverUrl || !jwtToken || !/^\d{5,20}$/.test(targetUid)) return {};
    try {
      const payload = Buffer.concat([
        this.encodeProtobufVarintField(1, BigInt(targetUid)),
        this.encodeProtobufVarintField(2, 1)
      ]);
      const encrypted = this.aesEncryptFreeFire(payload);
      const endpoint = `${serverUrl.replace(/\/+$/, '')}/GetPlayerPersonalShow`;
      const releaseVer = (process.env.FF_RELEASE_VERSION || 'OB49').trim() || 'OB49';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Redmi Note 8 Build/RKQ1.200826.002)',
          Connection: 'Keep-Alive',
          'Accept-Encoding': 'gzip',
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Unity-Version': '2018.4.11f1',
          'X-GA': 'v1 1',
          ReleaseVersion: releaseVer
        },
        body: new Uint8Array(encrypted),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) return {};
      const rawBuf = Buffer.from(await res.arrayBuffer());
      if (rawBuf.length === 0) return {};
      return this.extractPlayerStatsFromPersonalShow(rawBuf);
    } catch {
      return {};
    }
  }

  private static async fetchPlayerNameViaGameServer(
    serverUrl: string,
    jwtToken: string,
    inGameUid: string
  ): Promise<string | undefined> {
    const stats = await this.fetchPlayerStatsViaGameServer(serverUrl, jwtToken, inGameUid);
    return stats.nickname;
  }

  private static async performMajorLoginHandshake(session: GuestSessionRecord): Promise<{
    ok: boolean;
    banned?: boolean;
    unauthorized?: boolean;
    jwtToken?: string;
    serverUrl?: string;
    accountRegion?: string;
    inGameUid?: string;
    nickname?: string;
    error?: string;
  }> {
    const openId = session.openId || (await this.resolveOpenIdFromToken(session.token)) || session.guestUid || '';
    const loginPayload = this.aesEncryptFreeFire(this.buildMajorLoginPayload(openId, session.token));

    const loginEndpoints = [
      'https://loginbp.ggblueshark.com/MajorLogin',
      'https://loginbp.common.ggbluefox.com/MajorLogin'
    ];

    let lastErr = 'MajorLogin handshake failed';
    let sawUnauthorized = false;
    let preservedUid: string | undefined;
    let preservedNick: string | undefined;
    let preservedRegion: string | undefined;

    for (const loginEndpoint of loginEndpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(loginEndpoint, {
          method: 'POST',
          headers: {
            'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Redmi Note 8 Build/RKQ1.200826.002)',
            Connection: 'Keep-Alive',
            'Accept-Encoding': 'gzip',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Unity-Version': '2018.4.11f1',
            'X-GA': 'v1 1',
            ReleaseVersion: 'OB49'
          },
          body: new Uint8Array(loginPayload),
          signal: controller.signal
        });
        clearTimeout(timer);

        const rawBuf = Buffer.from(await res.arrayBuffer());
        const rawText = rawBuf.toString('utf8');
        const details = rawBuf.length > 0 ? this.extractMajorLoginDetails(rawBuf) : { isBannedHint: false };

        if (details.inGameUid && !preservedUid) preservedUid = details.inGameUid;
        if (details.nickname && !preservedNick) preservedNick = details.nickname;
        if (details.accountRegion && !preservedRegion) preservedRegion = details.accountRegion;

        if (/\b(banned|account_banned|suspended|t_p_ban)\b/i.test(rawText) || details.isBannedHint) {
          return {
            ok: false,
            banned: true,
            inGameUid: preservedUid,
            nickname: preservedNick,
            accountRegion: preservedRegion,
            error: 'Account Banned'
          };
        }

        if (res.status === 401 || res.status === 403) {
          sawUnauthorized = true;
          lastErr = `MajorLogin HTTP ${res.status}`;
          continue;
        }

        if (!res.ok || rawBuf.length === 0) {
          lastErr = `MajorLogin HTTP ${res.status}`;
          continue;
        }

        if (details.jwtToken) {
          return {
            ok: true,
            jwtToken: details.jwtToken,
            serverUrl: details.serverUrl || this.getRegionServerUrl(details.accountRegion || 'IND'),
            accountRegion: details.accountRegion || 'IND',
            inGameUid: details.inGameUid,
            nickname: details.nickname
          };
        }
      } catch (err: any) {
        lastErr = err?.message || 'MajorLogin network error';
      }
    }

    return {
      ok: false,
      unauthorized: sawUnauthorized,
      inGameUid: preservedUid,
      nickname: preservedNick,
      accountRegion: preservedRegion,
      error: lastErr
    };
  }

  public static async inspectGuestAccount(
    guestUid: string,
    guestPassword: string
  ): Promise<GuestAccountInspectionResult> {
    const cleanUid = String(guestUid || '').trim();
    const cleanPassword = String(guestPassword || '').trim();

    if (!cleanUid || !cleanPassword) {
      return {
        authOk: false,
        guestUid: cleanUid,
        accountName: 'Guest Account',
        nameResolved: false,
        isBanned: false,
        unauthorized: true
      };
    }

    const authRes = await this.authenticateGuestCredentials(cleanUid, cleanPassword);
    if (!authRes.ok) {
      const authBanMatch = /\b(ban|banned|suspend|suspended|freeze|locked)\b/i.test(authRes.error || '');
      let directBan: {
        notFound?: boolean;
        isBanned: boolean | null;
        banType?: string;
        banReason?: string;
        playerName?: string;
      } = { isBanned: null };
      let liveName = '';

      if (/^\d{5,20}$/.test(cleanUid)) {
        const [banCheck, livePlayer] = await Promise.all([
          this.checkDirectBanStatus(cleanUid).catch(() => ({ isBanned: null as boolean | null })),
          this.fetchLivePlayerForLike(cleanUid).catch(() => null)
        ]);
        directBan = banCheck;
        if (livePlayer?.found && isPresent(livePlayer.name) && livePlayer.name !== 'Unknown') {
          liveName = livePlayer.name;
        }
        if (!liveName && isPresent((banCheck as any)?.playerName)) {
          liveName = String((banCheck as any).playerName).trim();
        }
      }

      if (authBanMatch || directBan.isBanned === true) {
        return {
          authOk: false,
          guestUid: cleanUid,
          accountName: liveName || 'Guest Account',
          nameResolved: Boolean(liveName),
          isBanned: true,
          banType: directBan.banType || 'Permanent',
          banReason: directBan.banReason || 'Account Banned'
        };
      }

      return {
        authOk: false,
        guestUid: cleanUid,
        accountName: liveName || 'Guest Account',
        nameResolved: Boolean(liveName),
        isBanned: false,
        unauthorized: true
      };
    }

    const [majorRes, inspectInfo] = await Promise.all([
      this.performMajorLoginHandshake(authRes.session),
      this.resolveTokenInspectInfo(authRes.session.token)
    ]);

    const candidateUid =
      majorRes.inGameUid ||
      inspectInfo.uid ||
      (/^\d{5,20}$/.test(cleanUid) ? cleanUid : '');

    let isBanned = Boolean(majorRes.banned);
    let banType: string | undefined = isBanned ? 'Permanent' : undefined;
    let banReason: string | undefined = isBanned ? 'Account Banned' : undefined;
    let banPlayerName: string | undefined;

    if (candidateUid) {
      const banRes = await this.checkDirectBanStatus(candidateUid, authRes.session);
      if (isPresent(banRes.playerName)) banPlayerName = banRes.playerName;
      if (banRes.isBanned === true) {
        isBanned = true;
        banType = banRes.banType || 'Permanent';
        banReason = banRes.banReason || 'Account Banned';
      } else if (banRes.isBanned === null && candidateUid !== cleanUid && /^\d{5,20}$/.test(cleanUid)) {
        const cleanBanRes = await this.checkDirectBanStatus(cleanUid, authRes.session);
        if (!banPlayerName && isPresent(cleanBanRes.playerName)) banPlayerName = cleanBanRes.playerName;
        if (cleanBanRes.isBanned === true) {
          isBanned = true;
          banType = cleanBanRes.banType || 'Permanent';
          banReason = cleanBanRes.banReason || 'Account Banned';
        }
      }
    }

    let resolvedName = '';
    if (candidateUid) {
      const livePlayer = await this.fetchLivePlayerForLike(candidateUid).catch(() => null);
      if (livePlayer?.found && isPresent(livePlayer.name) && livePlayer.name !== 'Unknown') {
        resolvedName = livePlayer.name;
      }
      if (!isBanned && livePlayer?.isBanned === true) {
        isBanned = true;
        banType = banType || 'Permanent';
        banReason = banReason || 'Account Banned';
      }
    }

    if (!resolvedName && /^\d{5,20}$/.test(cleanUid) && candidateUid !== cleanUid) {
      const liveCleanPlayer = await this.fetchLivePlayerForLike(cleanUid).catch(() => null);
      if (liveCleanPlayer?.found && isPresent(liveCleanPlayer.name) && liveCleanPlayer.name !== 'Unknown') {
        resolvedName = liveCleanPlayer.name;
      }
      if (!isBanned && liveCleanPlayer?.isBanned === true) {
        isBanned = true;
        banType = banType || 'Permanent';
        banReason = banReason || 'Account Banned';
      }
    }

    if (!resolvedName && majorRes.jwtToken && majorRes.serverUrl && candidateUid) {
      const showName = await this.fetchPlayerNameViaGameServer(
        majorRes.serverUrl,
        majorRes.jwtToken,
        candidateUid
      ).catch(() => undefined);
      if (isPresent(showName)) {
        resolvedName = showName!;
      }
    }

    if (!resolvedName && isPresent(banPlayerName)) {
      resolvedName = banPlayerName!;
    }
    if (!resolvedName && isPresent(majorRes.nickname)) {
      resolvedName = majorRes.nickname!;
    }
    if (!resolvedName && isPresent(inspectInfo.nickname)) {
      resolvedName = inspectInfo.nickname!;
    }

    const isUnauth = Boolean(!isBanned && majorRes.unauthorized && !majorRes.jwtToken);

    return {
      authOk: !isBanned && !isUnauth,
      guestUid: cleanUid,
      ...(candidateUid ? { inGameUid: candidateUid } : {}),
      accountName: resolvedName || 'Guest Account',
      nameResolved: Boolean(resolvedName),
      isBanned,
      ...(isBanned ? { banType: banType || 'Permanent', banReason: banReason || 'Account Banned' } : {}),
      ...(isUnauth ? { unauthorized: true } : {})
    };
  }

  public static async validateAndResolveGuestAccount(
    guestUid: string,
    guestPassword: string
  ): Promise<GuestAccountValidationResult> {
    const inspected = await this.inspectGuestAccount(guestUid, guestPassword);

    if (inspected.isBanned) {
      return {
        ok: false,
        code: 'ACCOUNT_BANNED',
        error: 'Account Banned',
        accountName: inspected.accountName,
        ...(inspected.inGameUid ? { inGameUid: inspected.inGameUid } : {}),
        banType: inspected.banType || 'Permanent',
        banReason: inspected.banReason || 'Account Banned'
      };
    }

    if (!inspected.authOk || inspected.unauthorized) {
      return {
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Unauthorized'
      };
    }

    return {
      ok: true,
      guestUid: inspected.guestUid,
      ...(inspected.inGameUid ? { inGameUid: inspected.inGameUid } : {}),
      accountName: inspected.accountName
    };
  }

  public static async authenticateGuestCredentials(
    guestUid: string,
    guestPassword: string
  ): Promise<
    | { ok: true; session: GuestSessionRecord }
    | { ok: false; code: 'INVALID_GUEST_CREDENTIALS'; error: string }
  > {
    const cleanUid = String(guestUid || '').trim();
    const cleanPassword = String(guestPassword || '').trim();
    if (!cleanUid || !cleanPassword) {
      return {
        ok: false,
        code: 'INVALID_GUEST_CREDENTIALS',
        error: 'Guest UID and password are required.'
      };
    }

    const creds = this.getEnvCredentials();
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${cleanUid}|${cleanPassword}|${creds.loginUrl}`)
      .digest('hex')
      .slice(0, 24);

    const authResult = await this.authenticateGuestAccount({
      guestUid: cleanUid,
      guestPassword: cleanPassword,
      guestOpenId: '',
      loginUrl: creds.loginUrl,
      fingerprint
    });

    if (authResult.ok && !authResult.session.openId) {
      const inspectedOpenId = await this.resolveOpenIdFromToken(authResult.session.token);
      if (inspectedOpenId) {
        authResult.session.openId = inspectedOpenId;
      }
    }

    return authResult;
  }

  private static getRegionServerUrl(regionCode: string): string {
    const r = (regionCode || '').trim().toUpperCase();
    if (r === 'IND') return 'https://client.ind.freefiremobile.com';
    if (r === 'BR' || r === 'US' || r === 'SAC' || r === 'NA') return 'https://client.us.freefiremobile.com';
    return 'https://clientbp.ggblueshark.com';
  }

  private static async sendLikeViaCustomApi(
    likeApiUrl: string,
    likeApiKey: string,
    payload: {
      targetUid: string;
      guestUid: string;
      guestPassword: string;
      accessToken: string;
      openId?: string;
      regionCode: string;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const resolvedUrl = likeApiUrl
        .replace(/\{uid\}/gi, encodeURIComponent(payload.targetUid))
        .replace(/\{target_uid\}/gi, encodeURIComponent(payload.targetUid));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 16000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      };
      if (likeApiKey) {
        headers.Authorization = `Bearer ${likeApiKey}`;
        headers['X-API-Key'] = likeApiKey;
      }

      const res = await fetch(resolvedUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          uid: payload.targetUid,
          target_uid: payload.targetUid,
          guest_uid: payload.guestUid,
          guest_password: payload.guestPassword,
          access_token: payload.accessToken,
          open_id: payload.openId || '',
          region: payload.regionCode
        }),
        signal: controller.signal
      });
      clearTimeout(timer);

      const text = await res.text().catch(() => '');
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}

      if (!res.ok) {
        return {
          ok: false,
          error: String(json?.error || json?.message || `HTTP ${res.status}`)
        };
      }

      if (json) {
        if (json.ok === false || json.success === false) {
          return { ok: false, error: String(json.error || json.message || 'Like API rejected request') };
        }
        const statusNum = Number(json.status);
        if (Number.isFinite(statusNum) && statusNum !== 1 && statusNum !== 200 && json.ok !== true && json.success !== true) {
          return { ok: false, error: String(json.message || `Like API returned status ${statusNum}`) };
        }
        const given = Number(json.likes_given ?? json.likesGiven ?? json.LikesGivenByAPI ?? NaN);
        if (Number.isFinite(given) && given <= 0 && json.liked !== true && json.ok !== true) {
          return { ok: false, error: String(json.message || 'No like added by upstream API') };
        }
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Custom Like API request failed' };
    }
  }

  private static async sendLikeViaDirectFreeFire(
    session: GuestSessionRecord,
    targetUid: string,
    regionCode: string
  ): Promise<{
    ok: boolean;
    banned?: boolean;
    jwtToken?: string;
    serverUrl?: string;
    accountRegion?: string;
    error?: string;
  }> {
    const majorRes = await this.performMajorLoginHandshake(session);
    if (!majorRes.ok || !majorRes.jwtToken) {
      return {
        ok: false,
        banned: Boolean(majorRes.banned),
        error: majorRes.error || 'MajorLogin handshake failed'
      };
    }

    const resolvedRegion = (regionCode || majorRes.accountRegion || 'IND').trim().toUpperCase() || 'IND';
    const serverUrl = majorRes.serverUrl || this.getRegionServerUrl(majorRes.accountRegion || resolvedRegion);
    const releaseVer = (process.env.FF_RELEASE_VERSION || 'OB49').trim() || 'OB49';

    const encryptedLike = this.aesEncryptFreeFire(
      this.buildLikeProfilePayload(targetUid, resolvedRegion)
    );
    const likeEndpoint = `${serverUrl.replace(/\/+$/, '')}/LikeProfile`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      const likeRes = await fetch(likeEndpoint, {
        method: 'POST',
        headers: {
          'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 11; Redmi Note 8 Build/RKQ1.200826.002)',
          Connection: 'Keep-Alive',
          'Accept-Encoding': 'gzip',
          Authorization: `Bearer ${majorRes.jwtToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Unity-Version': '2018.4.11f1',
          'X-GA': 'v1 1',
          ReleaseVersion: releaseVer
        },
        body: new Uint8Array(encryptedLike),
        signal: controller.signal
      });
      clearTimeout(timer);

      const respBuf = Buffer.from(await likeRes.arrayBuffer());
      const respText = respBuf.toString('utf8');

      if (!likeRes.ok) {
        return {
          ok: false,
          jwtToken: majorRes.jwtToken,
          serverUrl,
          accountRegion: majorRes.accountRegion,
          error: `LikeProfile HTTP ${likeRes.status}`
        };
      }

      if (
        /(?:^|[^a-z])(limit|already|error|err|fail|failed|invalid|banned|suspend|denied|reject|cooldown|not_found|wrong_account)(?:[^a-z]|$)/i.test(respText) ||
        /(?:BR_LIKE_|ERR_|T_P_)/i.test(respText)
      ) {
        const isBanErr = /(?:account_banned|t_p_ban|banned|suspend)/i.test(respText);
        return {
          ok: false,
          banned: isBanErr,
          jwtToken: majorRes.jwtToken,
          serverUrl,
          accountRegion: majorRes.accountRegion,
          error: isBanErr ? 'Account Banned' : 'Daily like limit reached or target rejected'
        };
      }

      return {
        ok: true,
        jwtToken: majorRes.jwtToken,
        serverUrl,
        accountRegion: majorRes.accountRegion || resolvedRegion
      };
    } catch (err: any) {
      return {
        ok: false,
        jwtToken: majorRes.jwtToken,
        serverUrl,
        accountRegion: majorRes.accountRegion,
        error: err?.message || 'LikeProfile request failed'
      };
    }
  }

  private static async fetchLivePlayerForLike(
    uid: string
  ): Promise<{ found: boolean; name: string; regionCode: string; regionDisplay: string; likes: number; isBanned?: boolean | null }> {
    const cleanUid = String(uid || '').trim();
    const customPlayerUrl = (process.env.FF_GUEST_PLAYER_URL || '').trim();
    const candidates: string[] = [];
    if (customPlayerUrl) {
      candidates.push(
        customPlayerUrl.includes('{uid}')
          ? customPlayerUrl.replace(/\{uid\}/g, encodeURIComponent(cleanUid))
          : `${customPlayerUrl}${customPlayerUrl.includes('?') ? '&' : '?'}uid=${encodeURIComponent(cleanUid)}`
      );
    }
    candidates.push(
      `https://auraffxserverinfocheckerapi.onrender.com/api/player?uid=${encodeURIComponent(cleanUid)}&_t=${Date.now()}`
    );

    for (const url of candidates) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 14000);
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'Cache-Control': 'no-cache'
            },
            signal: controller.signal
          });
          clearTimeout(timer);

          if (!res.ok) {
            if ((res.status === 429 || res.status >= 500) && attempt < 2) {
              await new Promise((r) => setTimeout(r, 400));
              continue;
            }
            break;
          }

          const json: any = await res.json().catch(() => null);
          if (!json || json.success === false || json.error) break;

          const p = json.player && typeof json.player === 'object' && !json.player.error ? json.player : json;
          const rawNameCandidate =
            p?.name ??
            p?.nickname ??
            p?.username ??
            json?.name ??
            json?.nickname ??
            json?.username;
          const name = isPresent(rawNameCandidate) ? String(rawNameCandidate).trim() : '';
          if (!name && !isPresent(p?.uid) && !isPresent(json?.uid)) break;

          const rawLikes = String(p?.likes ?? json?.likes ?? '0').replace(/[^\d]/g, '');
          const likesNum = rawLikes ? Number(rawLikes) : 0;

          const regionFlag = isPresent(p?.region_flag || json?.region_flag)
            ? String(p?.region_flag || json?.region_flag).trim()
            : '';
          const regionName = isPresent(p?.region_name || json?.region_name)
            ? String(p?.region_name || json?.region_name).trim()
            : '';
          const regionCode = isPresent(p?.region || json?.region)
            ? String(p?.region || json?.region).trim().toUpperCase()
            : 'IND';
          const regionText =
            regionName && regionCode && regionName.toLowerCase() !== regionCode.toLowerCase()
              ? `${regionName} (${regionCode})`
              : regionName || regionCode || 'Unknown';
          const regionDisplay = regionFlag ? `${regionFlag} ${regionText}` : regionText;

          const isBanned = parseBanBoolean(
            p?.is_banned ?? p?.isBanned ?? p?.banned ?? json?.is_banned ?? json?.isBanned ?? json?.banned
          );

          return {
            found: true,
            name: name || 'Unknown',
            regionCode,
            regionDisplay,
            likes: Number.isFinite(likesNum) ? likesNum : 0,
            isBanned
          };
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
      }
    }

    return {
      found: false,
      name: 'Unknown',
      regionCode: 'IND',
      regionDisplay: 'Unknown',
      likes: 0,
      isBanned: null
    };
  }

  public static async processLikesForUid(
    rawUid: string,
    guestAccounts: Array<{ id: string; guestUid: string; guestPassword: string; enabled?: boolean; isBanned?: boolean }>,
    onAccountProgress?: (completed: number, total: number, succeeded: number) => Promise<void> | void
  ): Promise<
    | {
        ok: true;
        uid: string;
        playerName: string;
        region: string;
        beforeLikes: number;
        afterLikes: number;
        likesGiven: number;
        totalAccounts: number;
        succeededAccounts: number;
        failedAccounts: number;
        statusLabel: string;
      }
    | {
        ok: false;
        code: 'INVALID_UID' | 'NO_GUEST_ACCOUNTS' | 'PLAYER_NOT_FOUND' | 'ALL_ACCOUNTS_FAILED';
        error: string;
        uid?: string;
        playerName?: string;
        beforeLikes?: number;
      }
  > {
    const cleanUid = String(rawUid || '').trim();
    if (!/^\d{5,20}$/.test(cleanUid)) {
      return {
        ok: false,
        code: 'INVALID_UID',
        error: 'Please provide a valid numeric Free Fire UID.'
      };
    }

    const activeAccounts = (Array.isArray(guestAccounts) ? guestAccounts : []).filter(
      (acc) => acc && acc.enabled !== false && acc.isBanned !== true
    );
    if (activeAccounts.length === 0) {
      return {
        ok: false,
        code: 'NO_GUEST_ACCOUNTS',
        error: 'Like API is currently unavailable.'
      };
    }

    // Step 1: Fetch target player profile & initial likes before running guest accounts
    let beforePlayer = await this.fetchLivePlayerForLike(cleanUid);
    if (!beforePlayer.found) {
      const banFallback = await this.checkDirectBanStatus(cleanUid).catch(() => ({
        notFound: true,
        isBanned: null as boolean | null,
        playerName: undefined as string | undefined
      }));
      if (banFallback.notFound || banFallback.isBanned === null) {
        return {
          ok: false,
          code: 'PLAYER_NOT_FOUND',
          error: `No Free Fire account found for UID ${cleanUid}.`,
          uid: cleanUid
        };
      }
      beforePlayer = {
        found: true,
        name: banFallback.playerName || 'Unknown',
        regionCode: 'IND',
        regionDisplay: 'Unknown',
        likes: 0
      };
    }

    console.info(
      `[FFLike] Step 1 target=${cleanUid} name="${beforePlayer.name}" region=${beforePlayer.regionCode} likesBefore=${beforePlayer.likes} accounts=${activeAccounts.length}`
    );

    const customLikeApiUrl = (process.env.FF_LIKE_API_URL || process.env.LIKE_API_URL || '').trim();
    const customLikeApiKey = (process.env.FF_LIKE_API_KEY || process.env.LIKE_API_KEY || '').trim();

    let succeededAccounts = 0;
    let failedAccounts = 0;
    let lastActiveJwt: { jwtToken: string; serverUrl: string } | null = null;
    const statusUpdates: Array<{
      id: string;
      status: 'ok' | 'auth_failed' | 'like_failed';
      message?: string;
      usedAt: string;
      isBanned?: boolean;
      banType?: string;
      banReason?: string;
    }> = [];

    // Step 2 & 3: Authenticate each enabled, non-banned guest account and send LikeProfileReq sequentially
    for (let i = 0; i < activeAccounts.length; i++) {
      const account = activeAccounts[i];
      const usedAt = new Date().toISOString();

      try {
        const authRes = await this.authenticateGuestCredentials(account.guestUid, account.guestPassword);
        if (!authRes.ok) {
          failedAccounts++;
          const authBan = /\b(ban|banned|suspend|suspended|freeze|locked)\b/i.test(authRes.error || '');
          console.warn(`[FFLike] Account ${i + 1}/${activeAccounts.length} OAuth failed (${authBan ? 'banned' : 'auth_error'})`);
          statusUpdates.push({
            id: account.id,
            status: 'auth_failed',
            message: authRes.error,
            usedAt,
            ...(authBan ? { isBanned: true, banType: 'Permanent', banReason: authRes.error || 'Account Banned' } : {})
          });
        } else if (customLikeApiUrl) {
          const likeRes = await this.sendLikeViaCustomApi(customLikeApiUrl, customLikeApiKey, {
            targetUid: cleanUid,
            guestUid: account.guestUid,
            guestPassword: account.guestPassword,
            accessToken: authRes.session.token,
            openId: authRes.session.openId,
            regionCode: beforePlayer.regionCode
          });
          if (likeRes.ok) {
            succeededAccounts++;
            statusUpdates.push({
              id: account.id,
              status: 'ok',
              usedAt,
              isBanned: false
            });
          } else {
            failedAccounts++;
            const likeErr = likeRes.error || 'Like request failed';
            const likeBan = /\b(account_banned|banned|suspended)\b/i.test(likeErr);
            console.warn(`[FFLike] Account ${i + 1}/${activeAccounts.length} custom like failed: ${likeErr}`);
            statusUpdates.push({
              id: account.id,
              status: 'like_failed',
              message: likeErr,
              usedAt,
              ...(likeBan ? { isBanned: true, banType: 'Permanent', banReason: likeErr } : {})
            });
          }
        } else {
          const likeRes = await this.sendLikeViaDirectFreeFire(authRes.session, cleanUid, beforePlayer.regionCode);
          if (likeRes.jwtToken && likeRes.serverUrl) {
            lastActiveJwt = { jwtToken: likeRes.jwtToken, serverUrl: likeRes.serverUrl };
          }

          if (likeRes.ok) {
            succeededAccounts++;
            console.info(`[FFLike] Account ${i + 1}/${activeAccounts.length} LikeProfile succeeded`);
            statusUpdates.push({
              id: account.id,
              status: 'ok',
              usedAt,
              isBanned: false
            });
          } else {
            failedAccounts++;
            const likeErr = likeRes.error || 'Like request failed';
            const likeBan = Boolean(likeRes.banned) || /(?:account_banned|banned|suspended)/i.test(likeErr);
            console.warn(`[FFLike] Account ${i + 1}/${activeAccounts.length} LikeProfile skipped: ${likeErr}`);
            statusUpdates.push({
              id: account.id,
              status: 'like_failed',
              message: likeErr,
              usedAt,
              ...(likeBan ? { isBanned: true, banType: 'Permanent', banReason: likeErr } : {})
            });
          }
        }
      } catch (accountErr: any) {
        failedAccounts++;
        console.warn(`[FFLike] Account ${i + 1}/${activeAccounts.length} threw error: ${accountErr?.message || 'error'}`);
        statusUpdates.push({
          id: account.id,
          status: 'like_failed',
          message: accountErr?.message || 'Account processing failed',
          usedAt
        });
      }

      if (onAccountProgress) {
        await Promise.resolve(onAccountProgress(i + 1, activeAccounts.length, succeededAccounts)).catch(() => {});
      }

      if (i < activeAccounts.length - 1) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    await storage.updateGuestAccountStatuses(statusUpdates).catch(() => {});

    if (succeededAccounts === 0) {
      return {
        ok: false,
        code: 'ALL_ACCOUNTS_FAILED',
        error: 'Like API could not deliver likes right now. Please try again later.',
        uid: cleanUid,
        playerName: beforePlayer.name,
        beforeLikes: beforePlayer.likes
      };
    }

    // Step 4: Re-fetch target player profile to calculate likesGiven accurately
    await new Promise((r) => setTimeout(r, 800));
    const afterPlayer = await this.fetchLivePlayerForLike(cleanUid);
    let fetchedAfterLikes = afterPlayer.found ? afterPlayer.likes : beforePlayer.likes;

    if ((!afterPlayer.found || fetchedAfterLikes <= beforePlayer.likes) && lastActiveJwt) {
      const serverStats = await this.fetchPlayerStatsViaGameServer(
        lastActiveJwt.serverUrl,
        lastActiveJwt.jwtToken,
        cleanUid
      ).catch(() => null);
      if (serverStats && typeof serverStats.likes === 'number' && serverStats.likes > fetchedAfterLikes) {
        fetchedAfterLikes = serverStats.likes;
      }
    }

    const afterLikes =
      fetchedAfterLikes > beforePlayer.likes
        ? fetchedAfterLikes
        : beforePlayer.likes + succeededAccounts;
    const effectiveLikesGiven = Math.max(succeededAccounts, afterLikes - beforePlayer.likes);

    console.info(
      `[FFLike] Step 4 complete target=${cleanUid} likesBefore=${beforePlayer.likes} likesNow=${afterLikes} likesGiven=+${effectiveLikesGiven} ok=${succeededAccounts} failed=${failedAccounts}`
    );

    return {
      ok: true,
      uid: cleanUid,
      playerName: beforePlayer.name,
      region: beforePlayer.regionDisplay,
      beforeLikes: beforePlayer.likes,
      afterLikes,
      likesGiven: effectiveLikesGiven,
      totalAccounts: activeAccounts.length,
      succeededAccounts,
      failedAccounts,
      statusLabel: 'Liked By API'
    };
  }
}
