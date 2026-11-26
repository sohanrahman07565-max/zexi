import fs from 'node:fs';
import path from 'node:path';
import { StorageManager } from './storage';

const UPSTREAM_PLAYER_API_ORIGIN = 'https://auraffxserverinfocheckerapi.onrender.com';

function isPresent(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const t = val.trim().toLowerCase();
    return Boolean(t) && t !== 'none' && t !== 'null' && t !== 'n/a' && t !== '0';
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0;
  }
  return true;
}

function safeAssetId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function getDataSubdir(...segments: string[]): string {
  try {
    return path.join(StorageManager.getMainStorage().getDataDir(), ...segments);
  } catch {
    return path.join(process.cwd(), 'data', ...segments);
  }
}

function getLocalBannerDirectories(): string[] {
  const dirs: string[] = [];
  const envDirs = [
    (process.env.BANNER_ASSETS_DIR || '').trim(),
    (process.env.FF_BANNER_ASSETS_DIR || '').trim()
  ].filter(Boolean);
  dirs.push(...envDirs);
  dirs.push(getDataSubdir('ff-assets', 'banners'));
  dirs.push(getDataSubdir('banners'));
  dirs.push(path.join(process.cwd(), 'banners'));
  return Array.from(new Set(dirs));
}

function getLocalAvatarDirectories(): string[] {
  const dirs: string[] = [];
  const envDirs = [
    (process.env.AVATAR_ASSETS_DIR || '').trim(),
    (process.env.FF_AVATAR_ASSETS_DIR || '').trim()
  ].filter(Boolean);
  dirs.push(...envDirs);
  dirs.push(getDataSubdir('ff-assets', 'avatars'));
  dirs.push(getDataSubdir('avatars'));
  dirs.push(path.join(process.cwd(), 'avatars'));
  return Array.from(new Set(dirs));
}

function getCacheFilePath(category: 'banners' | 'avatars', assetId: string, ext: string = '.png'): string {
  return getDataSubdir('ff-assets', category, `${assetId}${ext}`);
}

export interface ResolvedBannerAsset {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  bannerId: string;
  source: 'local' | 'remote';
}

export interface ResolvedAvatarAsset {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  avatarId: string;
  source: 'local' | 'remote';
}

export interface RealBannerLookupResult {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  bannerId: string;
  avatarId: string;
  source: 'banner_api' | 'direct_url' | 'banner_asset' | 'avatar_asset';
}

function parsePlayerLayers(apiData: any) {
  const p = apiData?.player && typeof apiData.player === 'object' && !apiData.player.error ? apiData.player : apiData;
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

  const equipment = p?.equipment || apiData?.equipment || {};
  const equippedItems = parsedRawData?.EquippedItemsInfo || {};
  const basicInfo = parsedRawData?.AccountInfo || parsedRawData?.basicInfo || {};

  return { p, raw, parsedRawData, equipment, equippedItems, basicInfo };
}

function resolveCandidateUrl(rawUrl: unknown, originFallback: string = UPSTREAM_PLAYER_API_ORIGIN): string {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed || /^(?:none|null|n\/a)$/i.test(trimmed)) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    return `${originFallback.replace(/\/+$/, '')}${trimmed}`;
  }
  return '';
}

export function extractEquippedBannerId(apiData: any): { bannerId: string; directUrl: string } {
  const { p, raw, equipment, equippedItems, basicInfo } = parsePlayerLayers(apiData);

  const rawBannerId =
    equipment?.banner_id ??
    p?.equipped_banner_id ??
    p?.banner_id ??
    apiData?.equipped_banner_id ??
    apiData?.banner_id ??
    raw?.equipped_banner_id ??
    raw?.banner_id ??
    equippedItems?.EquippedBannerId ??
    basicInfo?.BannerId ??
    basicInfo?.bannerId;

  const bannerId = isPresent(rawBannerId) ? safeAssetId(String(rawBannerId).trim()) : '';

  const urlCandidate =
    resolveCandidateUrl(apiData?.banner_url) ||
    resolveCandidateUrl(p?.banner_url) ||
    resolveCandidateUrl(raw?.banner_url) ||
    resolveCandidateUrl(raw?.banner_image) ||
    resolveCandidateUrl(p?.banner_image) ||
    resolveCandidateUrl(apiData?.banner_image);

  return {
    bannerId,
    directUrl: urlCandidate
  };
}

export function extractEquippedAvatarId(apiData: any): { avatarId: string; directUrl: string } {
  const { p, raw, equipment, equippedItems, basicInfo } = parsePlayerLayers(apiData);

  const rawAvatarId =
    equipment?.avatar_id ??
    p?.equipped_avatar_id ??
    p?.avatar_id ??
    p?.head_pic ??
    p?.headPic ??
    apiData?.equipped_avatar_id ??
    apiData?.avatar_id ??
    apiData?.head_pic ??
    apiData?.headPic ??
    raw?.equipped_avatar_id ??
    raw?.avatar_id ??
    raw?.head_pic ??
    raw?.headPic ??
    equippedItems?.EquippedAvatarId ??
    basicInfo?.AvatarId ??
    basicInfo?.avatarId ??
    basicInfo?.headPic;

  const avatarId = isPresent(rawAvatarId) ? safeAssetId(String(rawAvatarId).trim()) : '';

  const urlCandidate =
    resolveCandidateUrl(apiData?.avatar_url) ||
    resolveCandidateUrl(p?.avatar_url) ||
    resolveCandidateUrl(raw?.avatar_url) ||
    resolveCandidateUrl(raw?.avatar_image) ||
    resolveCandidateUrl(p?.avatar_image) ||
    resolveCandidateUrl(apiData?.avatar_image);

  return {
    avatarId,
    directUrl: urlCandidate
  };
}

function readLocalImageFromDirs(dirs: string[], candidateIds: string[]): {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  matchedId: string;
} | null {
  const exts: Array<{ ext: string; mimeType: string }> = [
    { ext: '.png', mimeType: 'image/png' },
    { ext: '.jpg', mimeType: 'image/jpeg' },
    { ext: '.jpeg', mimeType: 'image/jpeg' },
    { ext: '.webp', mimeType: 'image/webp' }
  ];

  for (const rawId of candidateIds) {
    const cleanId = safeAssetId(rawId);
    if (!cleanId) continue;

    for (const dir of dirs) {
      for (const { ext, mimeType } of exts) {
        const filePath = path.join(dir, `${cleanId}${ext}`);
        try {
          if (!fs.existsSync(filePath)) continue;
          const stat = fs.statSync(filePath);
          if (!stat.isFile() || stat.size === 0 || stat.size > 10 * 1024 * 1024) continue;
          const buffer = fs.readFileSync(filePath);
          if (buffer.length > 0) {
            return { buffer, mimeType, fileName: `${cleanId}${ext}`, matchedId: cleanId };
          }
        } catch {
          // Continue searching
        }
      }
    }
  }

  return null;
}

function extFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '.png';
}

async function fetchRemoteImage(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 7000
): Promise<{
  buffer: Buffer;
  mimeType: string;
} | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'image/png,image/jpeg,image/webp,image/*,*/*',
        'User-Agent': 'Mozilla/5.0',
        ...headers
      }
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const rawCt = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!rawCt.startsWith('image/')) return null;

    const arr = await res.arrayBuffer();
    if (!arr || arr.byteLength === 0 || arr.byteLength > 10 * 1024 * 1024) return null;

    return {
      buffer: Buffer.from(arr),
      mimeType: rawCt
    };
  } catch {
    return null;
  }
}

async function fetchRemoteImageAndCache(
  url: string,
  cacheCategory: 'banners' | 'avatars',
  assetId: string,
  timeoutMs = 5000
): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  cleanId: string;
} | null> {
  const fetched = await fetchRemoteImage(url, {}, timeoutMs);
  if (!fetched) return null;

  const ext = extFromMime(fetched.mimeType);
  const cleanId = safeAssetId(assetId) || cacheCategory;
  try {
    const cachePath = getCacheFilePath(cacheCategory, cleanId, ext);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, fetched.buffer);
  } catch {}

  return {
    buffer: fetched.buffer,
    mimeType: fetched.mimeType,
    fileName: `${cleanId}${ext}`,
    cleanId
  };
}

function decodeBase64Image(raw: string): { buffer: Buffer; mimeType: string } | null {
  const trimmed = String(raw || '').trim();
  const dataUriMatch = trimmed.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataUriMatch[1].toLowerCase();
    const buffer = Buffer.from(dataUriMatch[2].replace(/\s+/g, ''), 'base64');
    return buffer.length > 0 ? { buffer, mimeType } : null;
  }
  return null;
}

async function fetchFromConfiguredBannerApi(params: {
  uid: string;
  region: string;
  bannerId: string;
  avatarId: string;
  name: string;
}): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
  const apiTemplate = (
    process.env.BANNER_API_URL ||
    process.env.FF_BANNER_API_URL ||
    process.env.FF_PLAYER_BANNER_API_URL ||
    ''
  ).trim();
  if (!apiTemplate) return null;

  const apiKey = (
    process.env.BANNER_API_KEY ||
    process.env.FF_BANNER_API_KEY ||
    ''
  ).trim();

  let targetUrl = apiTemplate;
  const hasPlaceholders = /\{(?:uid|region|banner_id|avatar_id|name)\}/i.test(apiTemplate);
  if (hasPlaceholders) {
    targetUrl = apiTemplate
      .replace(/\{uid\}/gi, encodeURIComponent(params.uid))
      .replace(/\{region\}/gi, encodeURIComponent(params.region))
      .replace(/\{banner_id\}/gi, encodeURIComponent(params.bannerId))
      .replace(/\{avatar_id\}/gi, encodeURIComponent(params.avatarId))
      .replace(/\{name\}/gi, encodeURIComponent(params.name));
  } else {
    try {
      const u = new URL(apiTemplate);
      if (!u.searchParams.has('uid')) u.searchParams.set('uid', params.uid);
      if (params.region && !u.searchParams.has('region')) u.searchParams.set('region', params.region);
      if (params.bannerId && !u.searchParams.has('banner_id')) u.searchParams.set('banner_id', params.bannerId);
      if (params.avatarId && !u.searchParams.has('avatar_id')) u.searchParams.set('avatar_id', params.avatarId);
      targetUrl = u.toString();
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(targetUrl)) return null;

  const headers: Record<string, string> = {
    Accept: 'image/png,image/jpeg,image/webp,application/json,*/*',
    'User-Agent': 'Mozilla/5.0'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const rawCt = String(res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (rawCt.startsWith('image/')) {
      const arr = await res.arrayBuffer();
      if (!arr || arr.byteLength === 0 || arr.byteLength > 10 * 1024 * 1024) return null;
      const buffer = Buffer.from(arr);
      const ext = extFromMime(rawCt);
      return {
        buffer,
        mimeType: rawCt,
        fileName: `ff_banner_${safeAssetId(params.uid) || 'player'}${ext}`
      };
    }

    if (rawCt.includes('json')) {
      const json: any = await res.json().catch(() => null);
      if (!json || json.success === false || json.error) return null;

      const candidateValues = [
        json.banner_url,
        json.url,
        json.image_url,
        json.banner_image,
        json.image,
        json.data?.banner_url,
        json.data?.url,
        json.data?.image_url,
        json.data?.image
      ];

      for (const val of candidateValues) {
        if (typeof val !== 'string' || !val.trim()) continue;
        const decoded = decodeBase64Image(val);
        if (decoded) {
          return {
            ...decoded,
            fileName: `ff_banner_${safeAssetId(params.uid) || 'player'}${extFromMime(decoded.mimeType)}`
          };
        }
        const resolvedUrl = resolveCandidateUrl(val, new URL(targetUrl).origin);
        if (resolvedUrl) {
          const img = await fetchRemoteImage(resolvedUrl, headers, 8000);
          if (img) {
            return {
              ...img,
              fileName: `ff_banner_${safeAssetId(params.uid) || 'player'}${extFromMime(img.mimeType)}`
            };
          }
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function resolveExistingBannerAsset(
  apiData: any,
  uidHint?: string
): Promise<{
  bannerId: string;
  asset: ResolvedBannerAsset | null;
}> {
  const { bannerId, directUrl } = extractEquippedBannerId(apiData);
  const cleanUid = safeAssetId(uidHint || '');
  const localCandidates = [
    ...(cleanUid ? [cleanUid, `banner_${cleanUid}`] : []),
    ...(bannerId ? [bannerId] : [])
  ];

  if (localCandidates.length > 0) {
    const localAsset = readLocalImageFromDirs(getLocalBannerDirectories(), localCandidates);
    if (localAsset) {
      return {
        bannerId: bannerId || localAsset.matchedId,
        asset: {
          buffer: localAsset.buffer,
          mimeType: localAsset.mimeType,
          fileName: localAsset.fileName,
          bannerId: bannerId || localAsset.matchedId,
          source: 'local'
        }
      };
    }
  }

  if (directUrl) {
    const fetched = await fetchRemoteImage(directUrl, {}, 5000);
    if (fetched) {
      const ext = extFromMime(fetched.mimeType);
      const idLabel = bannerId || cleanUid || 'banner';
      return {
        bannerId,
        asset: {
          buffer: fetched.buffer,
          mimeType: fetched.mimeType,
          fileName: `${idLabel}${ext}`,
          bannerId: idLabel,
          source: 'remote'
        }
      };
    }
  }

  if (bannerId) {
    const customCdn = (process.env.FF_BANNER_CDN_URL || '').trim();
    const urlTemplates = [
      customCdn,
      'https://raw.githubusercontent.com/90xExe/FreeFireAllIconBy90x/main/BANNERS/{id}.png',
      'https://cdn.jsdelivr.net/gh/90xExe/FreeFireAllIconBy90x@main/BANNERS/{id}.png'
    ].filter(Boolean);

    for (const tpl of urlTemplates) {
      const targetUrl = tpl.includes('{id}')
        ? tpl.replace(/\{id\}/g, encodeURIComponent(bannerId))
        : `${tpl.replace(/\/+$/, '')}/${encodeURIComponent(bannerId)}.png`;
      const fetched = await fetchRemoteImageAndCache(targetUrl, 'banners', bannerId);
      if (fetched) {
        return {
          bannerId,
          asset: {
            buffer: fetched.buffer,
            mimeType: fetched.mimeType,
            fileName: fetched.fileName,
            bannerId: fetched.cleanId,
            source: 'remote'
          }
        };
      }
    }
  }

  return { bannerId, asset: null };
}

export async function resolveExistingAvatarAsset(
  apiData: any,
  uidHint?: string
): Promise<{
  avatarId: string;
  asset: ResolvedAvatarAsset | null;
}> {
  const { avatarId, directUrl } = extractEquippedAvatarId(apiData);
  const cleanUid = safeAssetId(uidHint || '');
  const localCandidates = [
    ...(cleanUid ? [cleanUid, `avatar_${cleanUid}`] : []),
    ...(avatarId ? [avatarId] : [])
  ];

  if (localCandidates.length > 0) {
    const localAsset = readLocalImageFromDirs(getLocalAvatarDirectories(), localCandidates);
    if (localAsset) {
      return {
        avatarId: avatarId || localAsset.matchedId,
        asset: {
          buffer: localAsset.buffer,
          mimeType: localAsset.mimeType,
          fileName: localAsset.fileName,
          avatarId: avatarId || localAsset.matchedId,
          source: 'local'
        }
      };
    }
  }

  if (directUrl) {
    const fetched = await fetchRemoteImage(directUrl, {}, 5000);
    if (fetched) {
      const ext = extFromMime(fetched.mimeType);
      const idLabel = avatarId || cleanUid || 'avatar';
      return {
        avatarId,
        asset: {
          buffer: fetched.buffer,
          mimeType: fetched.mimeType,
          fileName: `${idLabel}${ext}`,
          avatarId: idLabel,
          source: 'remote'
        }
      };
    }
  }

  if (avatarId) {
    const customCdn = (process.env.FF_AVATAR_CDN_URL || '').trim();
    const urlTemplates = [
      customCdn,
      'https://raw.githubusercontent.com/90xExe/FreeFireAllIconBy90x/main/icons/{id}.png',
      'https://cdn.jsdelivr.net/gh/90xExe/FreeFireAllIconBy90x@main/icons/{id}.png'
    ].filter(Boolean);

    for (const tpl of urlTemplates) {
      const targetUrl = tpl.includes('{id}')
        ? tpl.replace(/\{id\}/g, encodeURIComponent(avatarId))
        : `${tpl.replace(/\/+$/, '')}/${encodeURIComponent(avatarId)}.png`;
      const fetched = await fetchRemoteImageAndCache(targetUrl, 'avatars', avatarId);
      if (fetched) {
        return {
          avatarId,
          asset: {
            buffer: fetched.buffer,
            mimeType: fetched.mimeType,
            fileName: fetched.fileName,
            avatarId: fetched.cleanId,
            source: 'remote'
          }
        };
      }
    }
  }

  return { avatarId, asset: null };
}

export async function resolveRealBannerImage(
  apiData: any,
  fallbackUid: string
): Promise<RealBannerLookupResult | null> {
  const { p } = parsePlayerLayers(apiData);
  const uid = String(p?.uid || apiData?.uid || fallbackUid || '').trim();
  const region = isPresent(p?.region || apiData?.region) ? String(p?.region || apiData?.region).trim().toUpperCase() : '';
  const name = isPresent(p?.name || apiData?.name) ? String(p?.name || apiData?.name).trim() : '';

  const { bannerId, directUrl: directBannerUrl } = extractEquippedBannerId(apiData);
  const { avatarId } = extractEquippedAvatarId(apiData);

  // 1. Configured Real Banner API (BANNER_API_URL / FF_BANNER_API_URL)
  const fromApi = await fetchFromConfiguredBannerApi({
    uid,
    region,
    bannerId,
    avatarId,
    name
  });
  if (fromApi) {
    return {
      ...fromApi,
      bannerId,
      avatarId,
      source: 'banner_api'
    };
  }

  // 2. Direct real banner URL from upstream player API response (if valid HTTP 200 image)
  if (directBannerUrl) {
    const fetchedDirect = await fetchRemoteImage(directBannerUrl, {}, 6000);
    if (fetchedDirect) {
      const ext = extFromMime(fetchedDirect.mimeType);
      return {
        buffer: fetchedDirect.buffer,
        mimeType: fetchedDirect.mimeType,
        fileName: `ff_banner_${safeAssetId(uid) || bannerId || 'player'}${ext}`,
        bannerId,
        avatarId,
        source: 'direct_url'
      };
    }
  }

  // 3. Real banner asset files (BANNER_ASSETS_DIR / FF_BANNER_CDN_URL / FF banner repository)
  const bannerLookup = await resolveExistingBannerAsset(apiData, uid);
  if (bannerLookup.asset) {
    return {
      buffer: bannerLookup.asset.buffer,
      mimeType: bannerLookup.asset.mimeType,
      fileName: bannerLookup.asset.fileName,
      bannerId: bannerLookup.bannerId,
      avatarId,
      source: 'banner_asset'
    };
  }

  // 4. Real avatar asset files (AVATAR_ASSETS_DIR / FF_AVATAR_CDN_URL / FF avatar repository)
  const avatarLookup = await resolveExistingAvatarAsset(apiData, uid);
  if (avatarLookup.asset) {
    return {
      buffer: avatarLookup.asset.buffer,
      mimeType: avatarLookup.asset.mimeType,
      fileName: avatarLookup.asset.fileName,
      bannerId,
      avatarId: avatarLookup.avatarId,
      source: 'avatar_asset'
    };
  }

  return null;
}
