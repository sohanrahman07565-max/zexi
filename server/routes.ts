import express, { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import dotenv from 'dotenv';
import { storage, StorageManager, storageContext, AdminUser, ItemRecord, TriggerType, OpenMode, ClonedBotRecord, SharedStorageService } from './storage';
import { TelegramService, TelegramBotManager, BotSingletonLock, getItemPayload } from './telegram';
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from './auth';

dotenv.config({ override: true });

export const apiRouter = Router();

// Multi-Bot Request Routing Middleware:
// Sets active bot storage context for the current HTTP request via x-bot-id header, ?bot_id=, or req.body.bot_id
apiRouter.use(async (req: Request, _res: Response, next: NextFunction) => {
  let botId = 
    (req.headers['x-bot-id'] as string) || 
    (req.query.bot_id as string) || 
    (req.query.botId as string) || 
    (req.body?.bot_id as string) || 
    (req.body?.botId as string) || 
    'main';
  if (botId && botId !== 'main') {
    const cleanLookup = botId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    const mainStorage = StorageManager.getMainStorage();
    const cloned = await mainStorage.getClonedBots().catch(() => []);
    const matched = cloned.find(b =>
      b.id === botId ||
      b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '') === cleanLookup
    );
    if (matched) {
      botId = matched.id;
    }
  }
  const botStorage = StorageManager.getStorage(botId);
  storageContext.run(botStorage, () => {
    next();
  });
});

// Lightweight Health check and ping endpoint for network monitoring and Render keep-alive
apiRouter.all(['/health', '/ping'], async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const settings = await storage.getSettings().catch(() => null);
  const botToken = await TelegramService.getBotToken().catch(() => '');
  return res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now(),
    uptime: Math.floor(process.uptime()),
    bot: {
      hasToken: Boolean(botToken),
      botUsername: settings?.botUsername || null,
      isPolling: TelegramService.isPollingActive(),
      conflict: BotSingletonLock.getConflict('main'),
      conflicts: BotSingletonLock.getAllConflicts()
    }
  });
});

// Multer upload middleware for direct binary/multipart file streaming (up to 500MB)
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  }
});

// Express wrapper for Multer so size/multipart errors ALWAYS return structured JSON instead of HTML
function handleMulterSingle(fieldName: string) {
  const middleware = uploadMiddleware.single(fieldName);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: any) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'File exceeds single-request limit. Retrying or use chunked upload for large files.'
          });
        }
        return res.status(400).json({ error: err.message || 'Multipart upload error' });
      }
      return res.status(400).json({ error: err?.message || 'File upload failed' });
    });
  };
}

// Middleware to authenticate session via Bearer token (priority) or HTTP-only cookie
async function authenticate(req: Request, res: Response, next: NextFunction) {
  const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const cookieToken = req.cookies?.tg_admin_session ? String(req.cookies.tg_admin_session).trim() : '';
  const rawHeader = bearerToken || cookieToken;

  if (!rawHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const requestedBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    (req.body?.bot_id as string) ||
    (req.body?.botId as string) ||
    'main'
  ).trim() || 'main';

  // Verify HMAC signature if token was signed, or fallback to raw token for backward compatibility
  const verifiedToken = verifySessionToken(rawHeader) || rawHeader;
  const mainStorage = StorageManager.getMainStorage();
  const activeStorage = StorageManager.getStorage(requestedBotId);

  let session = activeStorage !== mainStorage ? await activeStorage.getSession(verifiedToken) : null;
  let admin: AdminUser | null = null;

  if (session) {
    admin = await activeStorage.getAdmin(session.adminId);
  }

  if (!session) {
    session = await mainStorage.getSession(verifiedToken);
    if (session) {
      const sessionScope = session.botId || 'main';
      if (sessionScope !== 'main') {
        const scopedStorage = StorageManager.getStorage(sessionScope);
        admin = await scopedStorage.getAdmin(session.adminId);
      } else {
        admin = await mainStorage.getAdmin(session.adminId);
      }
    }
  }

  // Fallback: check isolated cloned bot storages ONLY if token isn't found in active/main
  if (!session) {
    const clonedBots = await mainStorage.getClonedBots().catch(() => []);
    for (const b of clonedBots) {
      const bStorage = StorageManager.getStorage(b.id);
      const foundSess = await bStorage.getSession(verifiedToken);
      if (foundSess) {
        session = foundSess;
        if (!session.botId) session.botId = b.id;
        admin = await bStorage.getAdmin(session.adminId);
        break;
      }
    }
  }

  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  // STRICT ISOLATION: A cloned bot sub-admin session is locked exclusively to its own botId
  const sessionBotId = session.botId || 'main';
  const normalizedSessionBotId = sessionBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
  const normalizedRequestedBotId = requestedBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
  if (sessionBotId !== 'main' && normalizedRequestedBotId !== normalizedSessionBotId) {
    return res.status(403).json({
      error: 'Access Denied: Your session is restricted to its assigned cloned bot panel.'
    });
  }

  if (!admin || !admin.enabled) {
    return res.status(401).json({ error: 'Admin account disabled or not found' });
  }

  (req as any).admin = admin;
  (req as any).session = session;
  (req as any).sessionBotId = sessionBotId;
  next();
}

// Permission checking helper
function requirePermission(permKey: keyof AdminUser['permissions']) {
  return (req: Request, res: Response, next: NextFunction) => {
    const admin = (req as any).admin as AdminUser;
    if (!admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (admin.role === 'owner') {
      return next(); // Owner has complete permission
    }
    if (admin.permissions && admin.permissions[permKey]) {
      return next();
    }
    return res.status(403).json({ error: `Permission denied: ${permKey} required` });
  };
}

// Build cookie options that work reliably on both HTTPS (TMA/Render/WebView) and HTTP localhost
function getSessionCookieOptions(req: Request, maxAge: number = 12 * 60 * 60 * 1000) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').toLowerCase();
  const isHttps = Boolean(req.secure || req.protocol === 'https' || forwardedProto.includes('https'));
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge
  };
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

// Helper to look up cloned bot sub-admin credentials strictly scoped to requestedBotId
async function findClonedBotAuth(cleanId: string, requestedBotId?: string): Promise<{
  clonedBot: ClonedBotRecord;
  adminUser: AdminUser;
  storedPassword?: string;
  storage: SharedStorageService;
} | null> {
  // STRICT ISOLATION: Cloned bot sub-admin logins are ONLY allowed when a specific cloned bot_id is targeted
  if (!requestedBotId || requestedBotId === 'main') {
    return null;
  }

  const mainStorage = StorageManager.getMainStorage();
  await mainStorage.loadLatest(false);
  const clonedBots = await mainStorage.getClonedBots();

  const cleanLower = cleanId.toLowerCase().replace(/^@/, '').trim();
  const cleanRequested = requestedBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase();
  const target = clonedBots.find(b =>
    b.id === requestedBotId ||
    b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase() === cleanRequested
  );
  if (!target) {
    return null;
  }

  // Load the targeted cloned bot's isolated storage
  const botStorage = StorageManager.getStorage(target.id);
  await botStorage.loadLatest(false);
  const botAdmins = await botStorage.getAdmins();

  const rawNumericBotId = target.id.replace(/^clone_/, '').toLowerCase();
  const isTargetBotIdMatch =
    target.id.toLowerCase() === cleanLower ||
    rawNumericBotId === cleanLower ||
    (target.adminUsername && target.adminUsername.toLowerCase().trim() === cleanLower) ||
    (target.username && target.username.toLowerCase().trim() === cleanLower) ||
    (target.username && `admin_${target.username.toLowerCase().trim()}` === cleanLower);

  let adminUser = botAdmins.find(a =>
    (a.username && a.username.toLowerCase().trim() === cleanLower) ||
    (a.id && a.id.toLowerCase().trim() === cleanLower) ||
    (a.telegramId && a.telegramId.toLowerCase().trim() === cleanLower) ||
    (a.name && a.name.toLowerCase().trim() === cleanLower)
  );

  if (!adminUser && isTargetBotIdMatch) {
    adminUser = botAdmins.find(a => a.role === 'owner');
  }

  if (!adminUser && isTargetBotIdMatch) {
    const resolvedTgId = target.ownerId || target.ownerUsername || target.id.replace(/^clone_/, '');
    adminUser = {
      id: /^\d+$/.test(resolvedTgId) ? resolvedTgId : `owner_${target.id.replace(/^clone_/, '')}`,
      telegramId: resolvedTgId,
      name: target.ownerUsername ? `@${target.ownerUsername.replace(/^@+/, '')}` : `${target.name || 'Bot'} Owner`,
      username: target.id,
      role: 'owner',
      passwordHash: await hashPassword(target.adminPassword || 'Dark#Admin123'),
      permissions: {
        files_view: true, files_add: true, files_edit: true, files_delete: true,
        links_view: true, links_add: true, links_edit: true, links_delete: true,
        messages_view: true, messages_edit: true, admins_manage: true,
        design_edit: true, settings_edit: true, cleanup_manage: true
      },
      enabled: true,
      createdAt: new Date().toISOString()
    };
    await botStorage.saveAdmin(adminUser);
  }

  if (!adminUser) {
    return null;
  }

  return {
    clonedBot: target,
    adminUser,
    storedPassword: target.adminPassword,
    storage: botStorage
  };
}

// POST /api/auth/login
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const telegramId = req.body.telegramId || req.body.username || req.body.adminName || req.body.email || req.body.botId || req.body.bot_id;
  const { password } = req.body;
  if (!telegramId || !password) {
    return res.status(400).json({ error: 'Bot ID / Username and password are required' });
  }

  const cleanId = String(telegramId).trim();
  const cleanLowerInput = cleanId.toLowerCase().replace(/^@/, '').trim();
  const cleanPassword = String(password).trim();
  console.info('[Auth] Admin login attempt for identifier:', cleanId);

  let requestedBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    (req.body?.bot_id as string) ||
    (req.body?.botId as string) ||
    'main'
  ).trim() || 'main';

  // If logging in from main/root URL using a Cloned Bot ID (e.g. 9112185641), route strictly to that cloned bot
  if (requestedBotId === 'main') {
    const mainStore = StorageManager.getMainStorage();
    await mainStore.loadLatest(false);
    const allCloned = await mainStore.getClonedBots();
    const matchedByBotId = allCloned.find(b =>
      b.id.toLowerCase() === cleanLowerInput ||
      b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase() === cleanLowerInput ||
      (b.adminUsername && b.adminUsername.toLowerCase() === cleanLowerInput)
    );
    if (matchedByBotId) {
      requestedBotId = matchedByBotId.id;
    }
  }

  // --- 1. CLONED BOT SUB-ADMIN AUTHENTICATION (Strictly Isolated to requestedBotId) ---
  if (requestedBotId !== 'main') {
    const clonedAuth = await findClonedBotAuth(cleanId, requestedBotId);
    if (!clonedAuth) {
      console.warn(`[Auth] Rejected login on cloned bot panel ${requestedBotId} for unknown identifier: ${cleanId}`);
      return res.status(401).json({ error: 'Access Denied', field: 'email' });
    }

    console.info(`[Auth] Cloned bot sub-admin login attempt for bot @${clonedAuth.clonedBot.username} (${clonedAuth.clonedBot.id}) with identifier: ${cleanId}`);

    let isPasswordValid = false;
    if (clonedAuth.storedPassword && cleanPassword === clonedAuth.storedPassword) {
      isPasswordValid = true;
    }
    if (!isPasswordValid && clonedAuth.adminUser.passwordHash) {
      isPasswordValid = await verifyPassword(cleanPassword, clonedAuth.adminUser.passwordHash);
    }

    if (!isPasswordValid) {
      console.warn(`[Auth] Incorrect password for cloned bot sub-admin: ${cleanId}`);
      return res.status(401).json({ error: 'Incorrect password', field: 'password' });
    }

    // Create isolated session strictly scoped to this cloned bot ID
    const rawToken = await clonedAuth.storage.createSession(clonedAuth.adminUser.id, clonedAuth.adminUser.role, clonedAuth.clonedBot.id);
    const signedToken = signSessionToken(rawToken);

    res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

    clonedAuth.adminUser.lastLoginAt = new Date().toISOString();
    await clonedAuth.storage.saveAdmin(clonedAuth.adminUser);

    console.info(`[Auth] Cloned bot sub-admin successfully authenticated for @${clonedAuth.clonedBot.username} (${clonedAuth.clonedBot.id})!`);
    return res.json({
      success: true,
      token: signedToken,
      botId: clonedAuth.clonedBot.id,
      admin: {
        id: clonedAuth.adminUser.id,
        telegramId: clonedAuth.adminUser.telegramId,
        name: clonedAuth.adminUser.name,
        username: clonedAuth.adminUser.username,
        photoUrl: clonedAuth.adminUser.photoUrl,
        role: clonedAuth.adminUser.role,
        botId: clonedAuth.clonedBot.id,
        permissions: clonedAuth.adminUser.permissions
      }
    });
  }

  // --- 2. PRIMARY MAIN BOT / OWNER AUTHENTICATION ---
  // Force-reload fresh data from persistent storage (Firebase RTDB)
  await storage.loadLatest(true);

  // Reload latest environment variables if .env was changed
  try {
    dotenv.config({ override: true });
  } catch {}

  // Read environment variables for primary Owner / Administrator
  const envAdminEmail = (process.env.ADMIN_EMAIL || 'sohanrahman07565@gmail.com').trim().toLowerCase();
  const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();
  const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ROOT_ADMIN_PASSWORD || '').trim();
  const envRootId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '8153757163').trim();

  const cleanLower = cleanId.toLowerCase().replace(/^@/, '');
  const cleanNormalized = cleanLower.replace(/\s+/g, '');

  const allAdmins = await storage.getAdmins();
  const ownerAdmin = allAdmins.find(a => a.role === 'owner');

  // Known authorized owner emails
  const ownerEmails = new Set<string>([
    'sohanrahman07565@gmail.com',
    'zexiofficial8884@gmail.com',
    ...(envAdminEmail ? [envAdminEmail] : [])
  ]);

  let matchedAdmin: AdminUser | null = null;
  let isOwnerAttempt = false;

  // 1. Check if the entered identifier matches the MAIN OWNER/ADMIN credentials defined in ENV:
  // - Matches owner email (e.g. ADMIN_EMAIL, sohanrahman07565@gmail.com)
  // - Matches owner Telegram ID (ADMIN_ID / ROOT_ADMIN_ID, e.g. 8153757163)
  // - Matches owner Admin Name (ADMIN_NAME / ADMIN_USERNAME)
  // - Matches existing owner account in database (by id, telegramId, name)
  if (
    ownerEmails.has(cleanLower) ||
    (envRootId && cleanId === envRootId) ||
    (envAdminName && (cleanLower === envAdminName.toLowerCase() || cleanNormalized === envAdminName.toLowerCase().replace(/\s+/g, ''))) ||
    (ownerAdmin && (
      String(ownerAdmin.id).trim().toLowerCase() === cleanLower ||
      String(ownerAdmin.telegramId).trim().toLowerCase() === cleanLower ||
      (ownerAdmin.name && ownerAdmin.name.trim().toLowerCase() === cleanLower) ||
      (ownerAdmin.name && ownerAdmin.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized)
    ))
  ) {
    isOwnerAttempt = true;
    matchedAdmin = ownerAdmin || null;
  }

  // 2. If not owner, check if the identifier matches an AUTHORIZED SUB-ADMIN explicitly belonging to MAIN bot (never cloned bot sub-admins!)
  if (!matchedAdmin && !isOwnerAttempt) {
    const subAdmin = allAdmins.find(a => 
      a.role !== 'owner' &&
      a.enabled &&
      !((a as any).botId && (a as any).botId !== 'main') &&
      !String(a.id || '').startsWith('subadm_clone_') &&
      (
        String(a.id).trim().toLowerCase() === cleanLower ||
        String(a.telegramId).trim().toLowerCase() === cleanLower ||
        (a.username && a.username.trim().replace(/^@/, '').toLowerCase() === cleanLower) ||
        (a.name && a.name.trim().toLowerCase() === cleanLower) ||
        (a.name && a.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized) ||
        ((a as any).email && String((a as any).email).trim().toLowerCase() === cleanLower)
      )
    );
    if (subAdmin) {
      matchedAdmin = subAdmin;
    }
  }

  // 3. STRICT REJECTION: If neither owner nor an authorized sub-admin -> Reject immediately!
  if (!matchedAdmin && !isOwnerAttempt) {
    console.warn('[Auth] Login REJECTED: unauthorized account/email attempted:', cleanId);
    return res.status(401).json({ 
      error: 'Access Denied', 
      field: 'email' 
    });
  }

  // If owner attempt and no owner in database yet: auto-bootstrap owner only if credentials match
  if (!matchedAdmin && isOwnerAttempt) {
    if (envAdminPassword && cleanPassword === envAdminPassword) {
      const newOwner: AdminUser = {
        id: envRootId || 'sohan',
        telegramId: envRootId || 'sohan',
        name: envAdminName || 'Sohan',
        role: 'owner',
        passwordHash: await hashPassword(cleanPassword),
        permissions: {
          files_view: true, files_add: true, files_edit: true, files_delete: true,
          links_view: true, links_add: true, links_edit: true, links_delete: true,
          messages_view: true, messages_edit: true, admins_manage: true,
          design_edit: true, settings_edit: true, cleanup_manage: true
        },
        enabled: true,
        createdAt: new Date().toISOString()
      };
      await storage.saveAdmin(newOwner);
      matchedAdmin = newOwner;
    } else {
      return res.status(401).json({ error: 'Incorrect password', field: 'password' });
    }
  }

  if (!matchedAdmin || !matchedAdmin.enabled) {
    return res.status(401).json({ error: 'Access Denied: This administrator account has been disabled.', field: 'email' });
  }

  // 4. STRICT PASSWORD VERIFICATION
  let isPasswordValid = false;

  // Check stored password hash
  if (matchedAdmin.passwordHash) {
    isPasswordValid = await verifyPassword(cleanPassword, matchedAdmin.passwordHash);
  }

  // For owner, also allow env password if defined
  if (!isPasswordValid && isOwnerAttempt && envAdminPassword) {
    if (cleanPassword === envAdminPassword) {
      isPasswordValid = true;
      matchedAdmin.passwordHash = await hashPassword(envAdminPassword);
      await storage.saveAdmin(matchedAdmin);
    }
  }

  // ZERO backdoor or default passwords!
  if (!isPasswordValid) {
    console.warn('[Auth] Login REJECTED: incorrect password for:', cleanId);
    return res.status(401).json({ error: 'Incorrect password', field: 'password' });
  }

  console.info('[Auth] Admin login SUCCESSFUL for:', cleanId, matchedAdmin.name, matchedAdmin.role);

  // Create session scoped to main panel
  const rawToken = await storage.createSession(matchedAdmin.id, matchedAdmin.role, 'main');
  const mainStorage = StorageManager.getMainStorage();
  if (storage !== mainStorage) {
    await mainStorage.createSessionWithToken(rawToken, matchedAdmin.id, matchedAdmin.role, undefined, 'main');
  }
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

  matchedAdmin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(matchedAdmin);

  return res.json({
    success: true,
    token: signedToken,
    botId: 'main',
    admin: {
      id: matchedAdmin.id,
      telegramId: matchedAdmin.telegramId,
      name: matchedAdmin.name,
      username: matchedAdmin.username,
      photoUrl: matchedAdmin.photoUrl,
      role: matchedAdmin.role,
      botId: 'main',
      permissions: matchedAdmin.permissions
    }
  });
});

// POST /api/auth/validate-credentials (Real-time credentials checking without creating a session)
apiRouter.post('/auth/validate-credentials', async (req: Request, res: Response) => {
  const { telegramId, username, email, password } = req.body;
  const rawId = (username !== undefined && String(username).trim() !== '') ? username : (email || telegramId);
  if (!rawId || password === undefined || password === null) {
    return res.json({ valid: false });
  }

  const cleanId = String(rawId).trim();
  const cleanPassword = String(password).trim();
  if (!cleanId || !cleanPassword) {
    return res.json({ valid: false });
  }

  try {
    dotenv.config({ override: true });
  } catch {}

  const envAdminEmail = (process.env.ADMIN_EMAIL || 'sohanrahman07565@gmail.com').trim().toLowerCase();
  const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();
  const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ROOT_ADMIN_PASSWORD || '').trim();
  const envRootId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '8153757163').trim();

  const cleanLower = cleanId.toLowerCase().replace(/^@/, '');
  const cleanNormalized = cleanLower.replace(/\s+/g, '');

  const requestedBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    req.body?.bot_id ||
    req.body?.botId ||
    'main'
  ).trim() || 'main';

  if (requestedBotId !== 'main') {
    const clonedMatch = await findClonedBotAuth(cleanId, requestedBotId);
    if (clonedMatch) {
      let isClonedPassValid = false;
      if (clonedMatch.adminUser.passwordHash) {
        isClonedPassValid = await verifyPassword(cleanPassword, clonedMatch.adminUser.passwordHash);
      }
      if (!isClonedPassValid && clonedMatch.storedPassword) {
        isClonedPassValid = (cleanPassword === clonedMatch.storedPassword);
      }
      return res.json({ valid: isClonedPassValid });
    }
    return res.json({ valid: false });
  }

  await storage.loadLatest(false);
  const allAdmins = await storage.getAdmins();
  const ownerAdmin = allAdmins.find(a => a.role === 'owner');

  const ownerEmails = new Set<string>([
    'sohanrahman07565@gmail.com',
    'zexiofficial8884@gmail.com',
    ...(envAdminEmail ? [envAdminEmail] : [])
  ]);

  let matchedAdmin: AdminUser | null = null;
  let isOwner = false;

  if (
    ownerEmails.has(cleanLower) ||
    (envRootId && cleanId === envRootId) ||
    (envAdminName && (cleanLower === envAdminName.toLowerCase() || cleanNormalized === envAdminName.toLowerCase().replace(/\s+/g, ''))) ||
    (ownerAdmin && (
      String(ownerAdmin.id).trim().toLowerCase() === cleanLower ||
      String(ownerAdmin.telegramId).trim().toLowerCase() === cleanLower ||
      (ownerAdmin.name && ownerAdmin.name.trim().toLowerCase() === cleanLower) ||
      (ownerAdmin.name && ownerAdmin.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized)
    ))
  ) {
    isOwner = true;
    matchedAdmin = ownerAdmin || null;
  }

  if (!matchedAdmin && !isOwner) {
    const subAdmin = allAdmins.find(a => 
      a.role !== 'owner' &&
      a.enabled &&
      !((a as any).botId && (a as any).botId !== 'main') &&
      !String(a.id || '').startsWith('subadm_clone_') &&
      (
        String(a.id).trim().toLowerCase() === cleanLower ||
        String(a.telegramId).trim().toLowerCase() === cleanLower ||
        (a.name && a.name.trim().toLowerCase() === cleanLower) ||
        (a.name && a.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized) ||
        ((a as any).email && String((a as any).email).trim().toLowerCase() === cleanLower)
      )
    );
    if (subAdmin) {
      matchedAdmin = subAdmin;
    }
  }

  if (!matchedAdmin && !isOwner) {
    return res.json({ valid: false });
  }

  if (matchedAdmin && !matchedAdmin.enabled) {
    return res.json({ valid: false });
  }

  let isPasswordValid = false;
  if (matchedAdmin && matchedAdmin.passwordHash) {
    isPasswordValid = await verifyPassword(cleanPassword, matchedAdmin.passwordHash);
  }

  if (!isPasswordValid && isOwner && envAdminPassword) {
    if (cleanPassword === envAdminPassword) {
      isPasswordValid = true;
    }
  }

  return res.json({ valid: isPasswordValid });
});

// POST /api/auth/firebase-login (Firebase Authentication Session Creator)
apiRouter.post('/auth/firebase-login', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const requestedBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    (req.body?.bot_id as string) ||
    'main'
  ).trim() || 'main';

  if (requestedBotId !== 'main') {
    return res.status(403).json({
      error: 'Access Denied: Please sign in using your cloned bot sub-admin credentials.',
      field: 'email'
    });
  }

  const { idToken, email, displayName } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  
  if (!cleanEmail) {
    return res.status(400).json({ error: 'Email is required for authentication' });
  }

  // Reload admins strictly from main storage
  const mainStorage = StorageManager.getMainStorage();
  await mainStorage.loadLatest(true);
  const allAdmins = await mainStorage.getAdmins();
  const rootAdminId = String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '8153757163').trim();
  const rootAdminName = (process.env.ADMIN_NAME || 'Sohan').trim();
  const envAdminEmail = (process.env.ADMIN_EMAIL || 'sohanrahman07565@gmail.com').trim().toLowerCase();

  // Strict Whitelist of Authorized Admin Emails:
  // 1. Owner email from ENV (or designated default sohanrahman07565@gmail.com, zexiofficial8884@gmail.com)
  // 2. Explicitly added sub-admins stored in the database
  const authorizedEmails = new Set<string>([
    'sohanrahman07565@gmail.com',
    'zexiofficial8884@gmail.com',
    ...(envAdminEmail ? [envAdminEmail] : [])
  ]);

  for (const a of allAdmins) {
    if (a.name && a.name.includes('@')) {
      authorizedEmails.add(a.name.toLowerCase().trim());
    }
    if ((a as any).email) {
      authorizedEmails.add(String((a as any).email).toLowerCase().trim());
    }
  }

  const isAuthorized = authorizedEmails.has(cleanEmail);

  if (!isAuthorized) {
    console.warn('[Firebase Auth] Strict whitelist rejection for unauthorized email:', cleanEmail);
    return res.status(403).json({ 
      error: 'Access Denied',
      field: 'email'
    });
  }

  const isOwnerEmail = cleanEmail === 'sohanrahman07565@gmail.com' || 
                       cleanEmail === 'zexiofficial8884@gmail.com' ||
                       (envAdminEmail && cleanEmail === envAdminEmail);

  // Find matching admin by email or name
  let admin = allAdmins.find(a => 
    (a.name && a.name.toLowerCase() === cleanEmail) ||
    ((a as any).email && String((a as any).email).toLowerCase() === cleanEmail) ||
    (a.telegramId && a.telegramId.toLowerCase() === cleanEmail) ||
    (a.id && a.id.toLowerCase() === cleanEmail)
  );

  // If owner email, connect to the database owner account
  if (!admin && isOwnerEmail) {
    admin = allAdmins.find(a => a.role === 'owner');
  }

  // If owner email and no admin exists at all, bootstrap owner
  if (!admin && isOwnerEmail) {
    console.info('[Firebase Auth] Auto-provisioning Owner Admin for:', cleanEmail);
    const newOwner: AdminUser = {
      id: rootAdminId || 'sohan',
      telegramId: rootAdminId || 'sohan',
      name: displayName || rootAdminName || 'Sohan',
      role: 'owner',
      passwordHash: await hashPassword(cleanEmail + '_admin_secret'),
      permissions: {
        files_view: true, files_add: true, files_edit: true, files_delete: true,
        links_view: true, links_add: true, links_edit: true, links_delete: true,
        messages_view: true, messages_edit: true, admins_manage: true,
        design_edit: true, settings_edit: true, cleanup_manage: true
      },
      enabled: true,
      createdAt: new Date().toISOString()
    };
    await storage.saveAdmin(newOwner);
    admin = newOwner;
  }

  if (!admin || !admin.enabled) {
    console.warn('[Firebase Auth] Access denied for disabled admin email:', cleanEmail);
    return res.status(403).json({ error: 'Access Denied: This administrator account has been disabled.' });
  }

  // Create session scoped to main panel
  const mainStorageForSession = StorageManager.getMainStorage();
  const rawToken = await mainStorageForSession.createSession(admin.id, admin.role, 'main');
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

  if (idToken) {
    mainStorageForSession.setCloudAuthToken(idToken);
  }

  admin.lastLoginAt = new Date().toISOString();
  await mainStorageForSession.saveAdmin(admin);

  console.info('[Firebase Auth] Session successfully created for admin:', admin.name, admin.role);

  return res.json({
    success: true,
    token: signedToken,
    botId: 'main',
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      username: admin.username,
      photoUrl: admin.photoUrl,
      role: admin.role,
      botId: 'main',
      permissions: admin.permissions
    }
  });
});

// POST /api/auth/logout
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const bearerHeader = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const cookieHeader = req.cookies?.tg_admin_session ? String(req.cookies.tg_admin_session).trim() : '';
  const tokensToRevoke = Array.from(new Set([bearerHeader, cookieHeader].filter(Boolean)));

  const mainStorage = StorageManager.getMainStorage();
  for (const rawHeader of tokensToRevoke) {
    const verifiedToken = verifySessionToken(rawHeader) || rawHeader;
    await storage.deleteSession(verifiedToken).catch(() => {});
    if (storage !== mainStorage) {
      await mainStorage.deleteSession(verifiedToken).catch(() => {});
    }
    const clonedBots = await mainStorage.getClonedBots().catch(() => []);
    for (const b of clonedBots) {
      const bStorage = StorageManager.getStorage(b.id);
      await bStorage.deleteSession(verifiedToken).catch(() => {});
    }
  }

  const cookieOpts = getSessionCookieOptions(req);
  res.clearCookie('tg_admin_session', {
    httpOnly: cookieOpts.httpOnly,
    secure: cookieOpts.secure,
    sameSite: cookieOpts.sameSite,
    path: '/'
  });
  res.clearCookie('tg_admin_session', { path: '/' });
  return res.json({ success: true, message: 'Logged out' });
});

// GET /api/firebase-rules (Returns active secured RTDB rules & Firestore rules)
apiRouter.get('/firebase-rules', authenticate, async (_req: Request, res: Response) => {
  const rtdbRules = {
    rules: {
      ".read": "auth != null",
      ".write": "auth != null",
      "app_state": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "admins": {
        ".read": "auth != null",
        ".write": "auth != null && (auth.token.email == 'sohanrahman07565@gmail.com' || auth.token.email == 'zexiofficial8884@gmail.com' || auth.token.admin == true)"
      },
      "bot_config": {
        ".read": "auth != null",
        ".write": "auth != null"
      },
      "users": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  };

  return res.json({
    success: true,
    rtdbRules,
    rtdbRulesFormatted: JSON.stringify(rtdbRules, null, 2),
    authorizedAdmins: [
      'sohanrahman07565@gmail.com',
      'zexiofficial8884@gmail.com'
    ],
    publicAccessBlocked: true,
    backendSyncSecured: true,
    primaryProject: 'zexiofficial844',
    secondaryProject: 'zexi-official'
  });
});

// GET /api/auth/me
apiRouter.get('/auth/me', authenticate, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const admin = (req as any).admin as AdminUser;
  const sessionBotId = (req as any).sessionBotId || 'main';
  return res.json({
    botId: sessionBotId,
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      username: admin.username,
      photoUrl: admin.photoUrl,
      role: admin.role,
      botId: sessionBotId,
      permissions: admin.permissions
    }
  });
});

// In-memory short cache for Telegram user profile photos (avoids repeated Bot API round-trips)
const avatarCache = new Map<string, { buffer: Buffer | null; contentType: string; expiresAt: number }>();

// GET /api/auth/avatar (Securely proxies current admin's Telegram profile photo without leaking bot token)
apiRouter.get('/auth/avatar', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  const sessionBotId = (req as any).sessionBotId || 'main';
  const tgId = String(admin.telegramId || '').trim();
  const cacheKey = `${sessionBotId}:${tgId || admin.id}`;
  const now = Date.now();
  const cached = avatarCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if (!cached.buffer) {
      return res.status(204).end();
    }
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(cached.buffer);
  }

  // 1. Try Telegram Bot API getUserProfilePhotos when numeric Telegram user ID is available
  if (/^\d+$/.test(tgId)) {
    const candidateTokens: string[] = [];
    const activeToken = await TelegramService.getBotToken().catch(() => '');
    if (activeToken) candidateTokens.push(activeToken);

    const mainStorage = StorageManager.getMainStorage();
    const mainSettings = await mainStorage.getSettings().catch(() => null);
    const mainEnvToken = (
      process.env.BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.TG_BOT_TOKEN ||
      mainSettings?.botToken ||
      ''
    ).trim();
    if (mainEnvToken && !candidateTokens.includes(mainEnvToken)) {
      candidateTokens.push(mainEnvToken);
    }

    for (const token of candidateTokens) {
      try {
        const photosRes = await TelegramService.callTelegramApi(
          'getUserProfilePhotos',
          { user_id: Number(tgId), limit: 1 },
          token
        );
        const sizes = photosRes?.ok && Array.isArray(photosRes?.result?.photos) ? photosRes.result.photos[0] : null;
        if (Array.isArray(sizes) && sizes.length > 0) {
          const chosen = sizes[Math.min(1, sizes.length - 1)] || sizes[0];
          if (chosen?.file_id) {
            const fileRes = await TelegramService.callTelegramApi('getFile', { file_id: chosen.file_id }, token);
            const filePath = fileRes?.ok ? fileRes?.result?.file_path : null;
            if (filePath) {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 8000);
              try {
                const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
                  signal: controller.signal
                });
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  if (buf.length > 0) {
                    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                    avatarCache.set(cacheKey, { buffer: buf, contentType, expiresAt: now + 5 * 60 * 1000 });
                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Cache-Control', 'private, max-age=300');
                    return res.send(buf);
                  }
                }
              } finally {
                clearTimeout(timer);
              }
            }
          }
        }
      } catch {}
    }
  }

  // 2. Fallback: fetch stored Telegram photoUrl server-side if present
  if (admin.photoUrl && /^https:\/\//i.test(admin.photoUrl)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const imgRes = await fetch(admin.photoUrl, { signal: controller.signal });
      const contentType = imgRes.headers.get('content-type') || '';
      if (imgRes.ok && contentType.startsWith('image/')) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        if (buf.length > 0) {
          avatarCache.set(cacheKey, { buffer: buf, contentType, expiresAt: now + 5 * 60 * 1000 });
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(buf);
        }
      }
    } catch {} finally {
      clearTimeout(timer);
    }
  }

  avatarCache.set(cacheKey, { buffer: null, contentType: '', expiresAt: now + 2 * 60 * 1000 });
  return res.status(204).end();
});

// Public info for login screen styling & bot info for Telegram Login Widget
apiRouter.get('/auth/login-design', async (req: Request, res: Response) => {
  const design = await storage.getDesign();
  const settings = await storage.getSettings();
  let botUsername = '';
  try {
    botUsername = await TelegramService.getBotUsername();
  } catch {}

  const botToken = process.env.TELEGRAM_CLIENT_SECRET || process.env.TELEGRAM_BOT_TOKEN || settings.botToken || '';
  const clientId = process.env.TELEGRAM_CLIENT_ID || process.env.TELEGRAM_BOT_ID || (botToken.includes(':') ? botToken.split(':')[0] : '');

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const currentOrigin = `${protocol}://${host}`;

  return res.json({
    botUsername: botUsername ? botUsername.replace(/^@/, '') : '',
    clientId,
    clientSecretConfigured: Boolean(botToken),
    redirectUri: `${currentOrigin}/api/auth/callback`,
    deployedUrls: {
      dev: 'https://ais-dev-5pmvaj2s66z7xu34aogymi-761412699643.asia-east1.run.app/api/auth/callback',
      shared: 'https://ais-pre-5pmvaj2s66z7xu34aogymi-761412699643.asia-east1.run.app/api/auth/callback'
    },
    loginTitle: design.loginTitle || 'ADMIN PANEL',
    loginSubtitle: design.loginSubtitle || 'SECURE ACCESS',
    loginLogoUrl: design.loginLogoUrl || '',
    loginLogoSymbol: design.loginLogoSymbol || '惡',
    loginIdLabel: design.loginIdLabel || 'ADMIN NAME',
    loginIdPlaceholder: design.loginIdPlaceholder || 'Enter admin name',
    loginPassLabel: design.loginPassLabel || 'PASSWORD',
    loginPassPlaceholder: design.loginPassPlaceholder || 'Enter password',
    loginButtonText: design.loginButtonText || 'SIGN IN',
    loginAccentColor: design.loginAccentColor || '#ef4444',
    primaryColor: design.primaryColor,
    accentColor: design.accentColor,
    backgroundStyle: design.backgroundStyle,
    cardStyle: design.cardStyle,
    borderRadius: design.borderRadius,
    buttonAnimationStyle: design.buttonAnimationStyle || 'orbit'
  });
});

// Verify Telegram Mini App (WebApp.initData) cryptographic HMAC signature
function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string
): { ok: boolean; user?: any; authDate?: number; error?: string } {
  if (!initData || !botToken) {
    return { ok: false, error: 'Missing initData or bot token' };
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = (params.get('hash') || '').trim();
    if (!hash) {
      return { ok: false, error: 'Missing hash in initData' };
    }

    const pairs: string[] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') {
        pairs.push(`${key}=${value}`);
      }
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const sigBuf = Buffer.from(hash, 'hex');
    const calcBuf = Buffer.from(calculatedHash, 'hex');
    if (sigBuf.length === 0 || sigBuf.length !== calcBuf.length || !crypto.timingSafeEqual(sigBuf, calcBuf)) {
      return { ok: false, error: 'Invalid TMA cryptographic signature' };
    }

    const authDate = Number(params.get('auth_date') || '0');
    if (authDate && (Date.now() / 1000 - authDate > 86400)) {
      return { ok: false, error: 'Telegram Mini App session expired. Please reopen the app.' };
    }

    const userJson = params.get('user');
    if (!userJson) {
      return { ok: false, error: 'Telegram user payload missing in initData' };
    }
    const user = JSON.parse(userJson);
    if (!user || !user.id) {
      return { ok: false, error: 'Invalid Telegram user object in initData' };
    }
    return { ok: true, user, authDate };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to parse TMA initData' };
  }
}

// Helper to verify Telegram authentication data and check admin whitelist (supports Main and Cloned bots)
async function verifyAndAuthorizeTelegramUser(
  tgUser: any,
  targetBotId: string = 'main',
  skipWidgetHashCheck: boolean = false
): Promise<{ ok: boolean; admin?: AdminUser; botId?: string; storage?: SharedStorageService; error?: string; statusCode?: number }> {
  if (!tgUser || !tgUser.id) {
    return { ok: false, error: 'Telegram account information is required', statusCode: 400 };
  }

  const mainStorage = StorageManager.getMainStorage();
  await mainStorage.loadLatest(true);

  let activeStorage = mainStorage;
  let resolvedBotId = 'main';
  let matchedClonedBot: ClonedBotRecord | undefined;

  if (targetBotId && targetBotId !== 'main') {
    const cleanTarget = targetBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase();
    const clonedBots = await mainStorage.getClonedBots().catch(() => []);
    matchedClonedBot = clonedBots.find(b =>
      b.id === targetBotId ||
      b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase() === cleanTarget
    );
    if (!matchedClonedBot) {
      return { ok: false, error: 'Target bot instance not found', statusCode: 404 };
    }
    resolvedBotId = matchedClonedBot.id;
    activeStorage = StorageManager.getStorage(matchedClonedBot.id);
    await activeStorage.loadLatest(true);
  }

  const settings = await activeStorage.getSettings();
  const botToken = matchedClonedBot?.token || process.env.TELEGRAM_CLIENT_SECRET || process.env.TELEGRAM_BOT_TOKEN || settings.botToken || '';

  // 1. Verify Telegram Login Widget cryptographic hash signature if provided and not already verified via TMA initData
  if (!skipWidgetHashCheck && tgUser.hash && botToken) {
    try {
      const secretKey = crypto.createHash('sha256').update(botToken).digest();
      const checkArray: string[] = [];
      const keys = Object.keys(tgUser).filter(k => k !== 'hash').sort();
      for (const k of keys) {
        checkArray.push(`${k}=${tgUser[k]}`);
      }
      const dataCheckString = checkArray.join('\n');
      const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      const sigBuf = Buffer.from(String(tgUser.hash), 'utf8');
      const calcBuf = Buffer.from(calculatedHmac, 'utf8');
      if (sigBuf.length !== calcBuf.length || !crypto.timingSafeEqual(sigBuf, calcBuf)) {
        console.warn('[Auth] Telegram Login Hash signature verification failed for user ID:', tgUser.id);
        return { ok: false, error: 'Telegram authentication verification failed: Invalid cryptographic signature.', statusCode: 401 };
      }

      if (tgUser.auth_date && (Date.now() / 1000 - Number(tgUser.auth_date) > 86400)) {
        return { ok: false, error: 'Telegram authentication data has expired. Please log in again.', statusCode: 401 };
      }
    } catch (err: any) {
      console.error('[Auth] Error verifying Telegram hash signature:', err);
      return { ok: false, error: 'Internal error verifying Telegram authentication.', statusCode: 500 };
    }
  }

  // 2. ADMIN WHITELIST & AUTHORIZATION CHECK
  const userIdStr = String(tgUser.id).trim();
  const rawUsername = tgUser.username ? String(tgUser.username).trim().replace(/^@+/, '').toLowerCase() : '';
  const rootAdminRaw = resolvedBotId === 'main'
    ? String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || settings.rootAdminId || '8153757163').trim()
    : String(matchedClonedBot?.ownerId || settings.rootAdminId || '').trim();
  const rootAdminIds = rootAdminRaw
    .split(',')
    .map(s => s.trim().replace(/^@+/, '').toLowerCase())
    .filter(Boolean);
  const envAdminName = resolvedBotId === 'main'
    ? String(process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || '').trim().replace(/^@+/, '').toLowerCase()
    : '';

  const allAdmins = await activeStorage.getAdmins();
  let admin: AdminUser | null = null;

  const isRootOwnerMatch =
    rootAdminIds.includes(userIdStr.toLowerCase()) ||
    (rawUsername && rootAdminIds.includes(rawUsername)) ||
    (matchedClonedBot?.ownerUsername && rawUsername && matchedClonedBot.ownerUsername.replace(/^@+/, '').toLowerCase() === rawUsername);

  // Check 1: Root owner ID / owner username match
  if (isRootOwnerMatch) {
    admin = allAdmins.find(a => a.role === 'owner') || null;
    if (!admin) {
      const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();
      const newOwner: AdminUser = {
        id: userIdStr,
        telegramId: userIdStr,
        name: fullName || (rawUsername ? `@${rawUsername}` : 'Owner Admin'),
        username: rawUsername || undefined,
        role: 'owner',
        passwordHash: await hashPassword(matchedClonedBot?.adminPassword || crypto.randomBytes(16).toString('hex')),
        permissions: {
          files_view: true, files_add: true, files_edit: true, files_delete: true,
          links_view: true, links_add: true, links_edit: true, links_delete: true,
          messages_view: true, messages_edit: true, admins_manage: true,
          design_edit: true, settings_edit: true, cleanup_manage: true
        },
        enabled: true,
        createdAt: new Date().toISOString()
      };
      await activeStorage.saveAdmin(newOwner);
      admin = newOwner;
    } else if (/^\d+$/.test(userIdStr) && !/^\d+$/.test(String(admin.telegramId || ''))) {
      admin.telegramId = userIdStr;
      if (rawUsername && !admin.username) admin.username = rawUsername;
      await activeStorage.saveAdmin(admin);
    }
  }

  // Check 2: Match against registered admins whitelist (by numeric ID, telegramId, username, telegramUsername, or name)
  if (!admin) {
    for (const a of allAdmins) {
      const aId = String(a.id || '').trim();
      const aTgId = String(a.telegramId || '').trim();
      const aName = String(a.name || '').trim().replace(/^@+/, '').toLowerCase();
      const aUsername = String(a.username || '').trim().replace(/^@+/, '').toLowerCase();
      const aTgUsername = String((a as any).telegramUsername || '').trim().replace(/^@+/, '').toLowerCase();

      if (aId === userIdStr || aTgId === userIdStr) {
        admin = a;
        break;
      }
      if (rawUsername && (aUsername === rawUsername || aTgUsername === rawUsername || aName === rawUsername || aTgId.replace(/^@+/, '').toLowerCase() === rawUsername)) {
        admin = a;
        break;
      }
    }
  }

  // Auto-bind numeric telegramId if matched via @username
  if (admin && /^\d+$/.test(userIdStr) && (!/^\d+$/.test(String(admin.telegramId || '')) || (rawUsername && !admin.username))) {
    if (!/^\d+$/.test(String(admin.telegramId || ''))) {
      admin.telegramId = userIdStr;
    }
    if (rawUsername && !admin.username) {
      admin.username = rawUsername;
    }
    await activeStorage.saveAdmin(admin).catch(() => {});
  }

  // Check 3: ENV Admin Username match (Main bot)
  if (!admin && envAdminName && rawUsername && rawUsername === envAdminName) {
    admin = allAdmins.find(a => a.role === 'owner') || null;
  }

  // Check 4: If Main system has zero admins, first authenticating Telegram user becomes initial Owner Admin
  if (!admin && resolvedBotId === 'main' && allAdmins.length === 0) {
    console.info('[Auth] No existing admins found. Initializing Owner Admin from Telegram account:', userIdStr);
    const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ').trim();
    const newOwner: AdminUser = {
      id: userIdStr,
      telegramId: userIdStr,
      name: fullName || (rawUsername ? `@${rawUsername}` : 'Owner Admin'),
      username: rawUsername || undefined,
      role: 'owner',
      passwordHash: await hashPassword(crypto.randomBytes(16).toString('hex')),
      permissions: {
        files_view: true, files_add: true, files_edit: true, files_delete: true,
        links_view: true, links_add: true, links_edit: true, links_delete: true,
        messages_view: true, messages_edit: true, admins_manage: true,
        design_edit: true, settings_edit: true, cleanup_manage: true
      },
      enabled: true,
      createdAt: new Date().toISOString()
    };
    await activeStorage.saveAdmin(newOwner);
    await activeStorage.updateSettings({ rootAdminId: userIdStr });
    admin = newOwner;
  }

  if (!admin) {
    console.warn(`[Auth] Access Denied: Telegram account ${userIdStr} (@${rawUsername || 'none'}) is NOT in the admin whitelist for bot ${resolvedBotId}.`);
    return {
      ok: false,
      error: `Access Denied: Telegram account (${rawUsername ? '@' + rawUsername : 'ID: ' + userIdStr}) is not in the authorized Admin whitelist.`,
      statusCode: 403
    };
  }

  if (!admin.enabled) {
    return { ok: false, error: 'Access Denied: Your administrator account has been disabled.', statusCode: 403 };
  }

  const incomingPhotoUrl = typeof tgUser.photo_url === 'string' && /^https?:\/\//i.test(tgUser.photo_url.trim())
    ? tgUser.photo_url.trim()
    : '';
  if (incomingPhotoUrl && admin.photoUrl !== incomingPhotoUrl) {
    admin.photoUrl = incomingPhotoUrl;
    await activeStorage.saveAdmin(admin).catch(() => {});
  }

  return { ok: true, admin, botId: resolvedBotId, storage: activeStorage };
}

// GET /api/auth/callback (Telegram OAuth / Login Widget Redirect Callback)
apiRouter.get('/auth/callback', async (req: Request, res: Response) => {
  const query = req.query as Record<string, string>;
  const authResult = await verifyAndAuthorizeTelegramUser(query, 'main');
  if (!authResult.ok || !authResult.admin) {
    return res.redirect('/?error=' + encodeURIComponent(authResult.error || 'Access Denied'));
  }

  const admin = authResult.admin;
  const rawToken = await storage.createSession(admin.id, admin.role, 'main');
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  console.info(`[Auth Callback] Verified Telegram Admin redirected in: ${admin.name} (Telegram ID: ${admin.id})`);
  return res.redirect(`/?auth_token=${encodeURIComponent(signedToken)}`);
});

// POST /api/auth/telegram-login (Telegram Login Widget / OpenID Connect with Admin Whitelist Verification)
apiRouter.post('/auth/telegram-login', async (req: Request, res: Response) => {
  const requestedBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    'main'
  ).trim() || 'main';
  if (requestedBotId !== 'main') {
    return res.status(403).json({ error: 'Access Denied: Please log in with your cloned bot sub-admin credentials.' });
  }

  const tgUser = req.body;
  const authResult = await verifyAndAuthorizeTelegramUser(tgUser, 'main');
  if (!authResult.ok || !authResult.admin) {
    return res.status(authResult.statusCode || 403).json({ error: authResult.error || 'Access Denied' });
  }

  const admin = authResult.admin;
  const rawToken = await storage.createSession(admin.id, admin.role, 'main');
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  console.info(`[Auth] Verified Telegram Admin logged in: ${admin.name} (Telegram ID: ${admin.id})`);

  return res.json({
    success: true,
    token: signedToken,
    botId: 'main',
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      username: admin.username,
      photoUrl: admin.photoUrl,
      role: admin.role,
      botId: 'main',
      permissions: admin.permissions
    }
  });
});

// POST /api/auth/tma (Telegram Mini App WebApp.initData HMAC Authentication for Owner & Sub-Admins)
apiRouter.post('/auth/tma', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const rawInitData = String(
    req.body?.initData ||
    req.headers['x-tma-init-data'] ||
    req.headers['x-telegram-init-data'] ||
    ''
  ).trim();

  if (!rawInitData) {
    return res.status(400).json({ error: 'Telegram Mini App initData is required' });
  }

  const requestedBotId = (
    (req.body?.bot_id as string) ||
    (req.body?.botId as string) ||
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    'main'
  ).trim() || 'main';

  const mainStorage = StorageManager.getMainStorage();
  await mainStorage.loadLatest(true);
  const mainSettings = await mainStorage.getSettings();
  const mainBotToken = (
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_CLIENT_SECRET ||
    mainSettings.botToken ||
    ''
  ).trim();
  const clonedBots = await mainStorage.getClonedBots().catch(() => []);

  let verifiedUser: any = null;
  let verifiedBotId = 'main';
  let lastVerifyError = 'Unable to verify Telegram Mini App session signature';

  if (requestedBotId !== 'main') {
    const cleanReq = requestedBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase();
    const targetClone = clonedBots.find(b =>
      b.id === requestedBotId ||
      b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '').toLowerCase() === cleanReq
    );
    if (!targetClone || !targetClone.token) {
      return res.status(404).json({ error: 'Target cloned bot not found for TMA login' });
    }
    const cloneCheck = verifyTelegramWebAppInitData(rawInitData, targetClone.token);
    if (cloneCheck.ok && cloneCheck.user) {
      verifiedUser = cloneCheck.user;
      verifiedBotId = targetClone.id;
    } else if (mainBotToken) {
      // Also allow Main bot TMA container opening a cloned bot URL only if user is the cloned bot owner
      const mainCheck = verifyTelegramWebAppInitData(rawInitData, mainBotToken);
      if (mainCheck.ok && mainCheck.user) {
        verifiedUser = mainCheck.user;
        verifiedBotId = targetClone.id;
      } else {
        lastVerifyError = cloneCheck.error || mainCheck.error || lastVerifyError;
      }
    } else {
      lastVerifyError = cloneCheck.error || lastVerifyError;
    }
  } else {
    // Check main bot token first, then fall back to cloned bot tokens if TMA was opened from a cloned bot WebApp button
    if (mainBotToken) {
      const mainCheck = verifyTelegramWebAppInitData(rawInitData, mainBotToken);
      if (mainCheck.ok && mainCheck.user) {
        verifiedUser = mainCheck.user;
        verifiedBotId = 'main';
      } else {
        lastVerifyError = mainCheck.error || lastVerifyError;
      }
    }
    if (!verifiedUser) {
      for (const clone of clonedBots) {
        if (!clone.token) continue;
        const cloneCheck = verifyTelegramWebAppInitData(rawInitData, clone.token);
        if (cloneCheck.ok && cloneCheck.user) {
          verifiedUser = cloneCheck.user;
          verifiedBotId = clone.id;
          break;
        }
      }
    }
  }

  if (!verifiedUser) {
    console.warn('[TMA Auth] Failed to verify initData:', lastVerifyError);
    return res.status(401).json({ error: lastVerifyError });
  }

  const authResult = await verifyAndAuthorizeTelegramUser(verifiedUser, verifiedBotId, true);
  if (!authResult.ok || !authResult.admin || !authResult.storage) {
    return res.status(authResult.statusCode || 403).json({ error: authResult.error || 'Access Denied' });
  }

  const admin = authResult.admin;
  const targetStorage = authResult.storage;
  const rawToken = await targetStorage.createSession(admin.id, admin.role, verifiedBotId);
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, getSessionCookieOptions(req));

  admin.lastLoginAt = new Date().toISOString();
  await targetStorage.saveAdmin(admin);

  console.info(`[TMA Auth] Authenticated admin ${admin.name} (${admin.role}) via Telegram Mini App on bot=${verifiedBotId}`);
  return res.json({
    success: true,
    token: signedToken,
    botId: verifiedBotId,
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      username: admin.username,
      photoUrl: admin.photoUrl,
      role: admin.role,
      botId: verifiedBotId,
      permissions: admin.permissions
    }
  });
});

// Setup Initial Owner if none exists
apiRouter.post('/auth/setup-owner', async (req: Request, res: Response) => {
  await storage.loadLatest(true);
  const admins = await storage.getAdmins();
  const { telegramId, name, password } = req.body;
  if (admins.length > 0) {
    return res.status(400).json({ error: 'Owner already configured' });
  }

  if (!telegramId || !password) {
    return res.status(400).json({ error: 'Telegram ID and password required' });
  }

  const hash = await hashPassword(password);
  const owner: AdminUser = {
    id: String(telegramId),
    telegramId: String(telegramId),
    name: name || 'Owner',
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
  };

  await storage.saveAdmin(owner);
  return res.json({ success: true, message: 'Owner account created successfully' });
});

// ============================================================================
// ITEMS (FILES & LINKS)
// ============================================================================

// GET /api/items
apiRouter.get('/items', authenticate, async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const items = await storage.getItems();
  // Strip huge base64 strings so the response is lightweight and never overloads browser/network
  const sanitized = items.map(item => {
    if (item.fileBase64) {
      const { fileBase64, ...rest } = item;
      return rest;
    }
    return item;
  });
  return res.json(sanitized);
});

// GET /api/stats (Metrics including Total User Count and Online/Offline breakdown)
apiRouter.get('/stats', authenticate, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-cache, stale-while-revalidate=5');
  const admin = (req as any).admin as AdminUser | undefined;
  if (admin && (admin.telegramId || admin.id)) {
    try {
      storage.trackBotUser({
        id: admin.telegramId || admin.id,
        firstName: admin.name || 'Admin',
        username: admin.name ? `@${admin.name.replace(/^@+/, '').trim()}` : undefined
      }).catch(() => {});
    } catch {}
  }
  const userStats = await storage.getUserStats();
  const items = await storage.getItems();
  const totalDeliveries = items.reduce((acc, i) => acc + (i.deliveryCount || 0), 0);
  const totalTriggers = items.reduce((acc, i) => acc + (i.triggers?.length || 1), 0);
  const trackedCount = await storage.getTrackedCount();
  const admins = await storage.getAdmins();
  return res.json({
    totalUsers: userStats.totalUsers,
    onlineUsers: userStats.onlineUsers,
    offlineUsers: userStats.offlineUsers,
    totalDeliveries,
    totalTriggers,
    totalItems: items.length,
    trackedCount,
    adminsCount: admins.length
  });
});

// GET /api/users (List of all interacted users with online status and admin flag)
apiRouter.get('/users', authenticate, async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-cache, stale-while-revalidate=5');
  const users = await storage.getBotUsers();
  const admins = await storage.getAdmins();
  const settings = await storage.getSettings();
  const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '8153757163');

  const adminIds = new Set<string>();
  if (rootAdminId) adminIds.add(rootAdminId);
  for (const a of admins) {
    if (a.telegramId) adminIds.add(String(a.telegramId));
    if (a.id) adminIds.add(String(a.id));
  }

  // Streamlined payload: return only display fields needed by dashboard
  const enriched = users.map(u => ({
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    firstSeenAt: u.firstSeenAt,
    lastActiveAt: u.lastActiveAt,
    isOnline: u.isOnline,
    interactionCount: u.interactionCount,
    isBanned: Boolean(u.isBanned),
    isAdmin: adminIds.has(String(u.id)) || Boolean(u.isAdmin)
  }));

  return res.json(enriched);
});

// POST /api/users/:id/ban (Toggle ban status for a user; admins cannot be banned)
apiRouter.post('/users/:id/ban', authenticate, async (req: Request, res: Response) => {
  const userId = req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const updated = await storage.toggleBanUser(userId);
    // If the user was unbanned, restore access in Telegram groups/channels as well
    if (updated && !updated.isBanned) {
      TelegramService.unbanUserInConnectedChats(userId).catch(err => {
        console.warn('[Telegram] unbanUserInConnectedChats error:', err);
      });
    }
    return res.json({ success: true, user: updated });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update user ban status' });
  }
});

// POST /api/users/:id/unban
apiRouter.post('/users/:id/unban', authenticate, async (req: Request, res: Response) => {
  const userId = req.params.id;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  try {
    const updated = await storage.setBotUserBanned(userId, false);
    if (updated) {
      TelegramService.unbanUserInConnectedChats(userId).catch(err => {
        console.warn('[Telegram] unbanUserInConnectedChats error:', err);
      });
    }
    return res.json({ success: true, user: updated });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to unban user' });
  }
});

// POST /api/users/:id/grant-admin (Strictly Owner-only: promote a bot user to Administrator & issue access token)
apiRouter.post('/users/:id/grant-admin', authenticate, async (req: Request, res: Response) => {
  const currentAdmin = (req as any).admin as AdminUser;
  if (!currentAdmin || currentAdmin.role !== 'owner') {
    return res.status(403).json({ error: 'Only the main Owner can grant administrator permissions' });
  }

  const rawUserId = String(req.params.id || '').trim();
  if (!rawUserId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const { name, username, password, permissions, role } = req.body || {};
    const sessionBotId = (req as any).sessionBotId || 'main';
    const existingBotUser = await storage.findUserByIdOrUsername(rawUserId).catch(() => null);
    const resolvedId = existingBotUser ? String(existingBotUser.id).trim() : rawUserId.replace(/^@+/, '');
    const resolvedUsername = (
      username ||
      existingBotUser?.username ||
      (rawUserId.startsWith('@') ? rawUserId : '')
    ).replace(/^@+/, '').trim() || undefined;
    const resolvedName = (
      (name && String(name).trim()) ||
      [existingBotUser?.firstName, existingBotUser?.lastName].filter(Boolean).join(' ').trim() ||
      (resolvedUsername ? `@${resolvedUsername}` : `Admin ${resolvedId}`)
    );

    const existingAdmin = await storage.getAdmin(resolvedId);
    const defaultPerms = {
      files_view: true, files_add: true, files_edit: true, files_delete: false,
      links_view: true, links_add: true, links_edit: true, links_delete: false,
      messages_view: true, messages_edit: false, admins_manage: false,
      design_edit: false, settings_edit: false, cleanup_manage: false
    };

    const nextPerms = permissions
      ? { ...defaultPerms, ...permissions }
      : (existingAdmin?.permissions || defaultPerms);

    let generatedPassword: string | undefined;
    let passwordHash = existingAdmin?.passwordHash || '';
    if (password && String(password).trim().length >= 6) {
      passwordHash = await hashPassword(String(password).trim());
    } else if (!passwordHash) {
      generatedPassword = `Dark#${crypto.randomBytes(4).toString('hex')}`;
      passwordHash = await hashPassword(generatedPassword);
    }

    const adminRecord: AdminUser = {
      id: existingAdmin?.id || resolvedId,
      telegramId: resolvedId,
      name: resolvedName,
      username: resolvedUsername || existingAdmin?.username,
      role: role === 'owner' ? 'owner' : (existingAdmin?.role === 'owner' ? 'owner' : 'subadmin'),
      passwordHash,
      permissions: nextPerms,
      enabled: true,
      createdAt: existingAdmin?.createdAt || new Date().toISOString(),
      lastLoginAt: existingAdmin?.lastLoginAt
    };

    await storage.saveAdmin(adminRecord);
    await storage.setBotUserAdmin(resolvedId, true).catch(() => {});

    const rawToken = await storage.createSession(adminRecord.id, adminRecord.role, sessionBotId);
    const accessToken = signSessionToken(rawToken);
    const { passwordHash: _, ...sanitized } = adminRecord;

    return res.json({
      success: true,
      admin: sanitized,
      accessToken,
      ...(generatedPassword ? { generatedPassword } : {})
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to grant admin permissions' });
  }
});

// POST /api/users/:id/revoke-admin (Strictly Owner-only: revoke administrator permissions from a user)
apiRouter.post('/users/:id/revoke-admin', authenticate, async (req: Request, res: Response) => {
  const currentAdmin = (req as any).admin as AdminUser;
  if (!currentAdmin || currentAdmin.role !== 'owner') {
    return res.status(403).json({ error: 'Only the main Owner can revoke administrator permissions' });
  }

  const targetId = String(req.params.id || '').trim();
  if (!targetId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const admins = await storage.getAdmins();
    const cleanTarget = targetId.replace(/^@+/, '').toLowerCase();
    const matched = admins.find(a =>
      String(a.id).trim() === targetId ||
      String(a.telegramId).trim() === targetId ||
      (a.username && a.username.replace(/^@+/, '').toLowerCase() === cleanTarget)
    );

    if (matched) {
      if (matched.id === currentAdmin.id || matched.role === 'owner') {
        return res.status(400).json({ error: 'Cannot revoke Owner administrator privileges' });
      }
      await storage.deleteAdmin(matched.id);
    }

    await storage.setBotUserAdmin(targetId, false).catch(() => {});
    return res.json({ success: true, message: 'Administrator permissions revoked' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to revoke admin permissions' });
  }
});

// ============================================================================
// USER REPORTS SYSTEM
// ============================================================================

// GET /api/reports
apiRouter.get('/reports', authenticate, async (_req: Request, res: Response) => {
  try {
    const reports = await storage.getReports();
    return res.json(reports);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch reports' });
  }
});

// PUT /api/reports/:id
apiRouter.put('/reports/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const reportId = req.params.id;
    const { status, banUser } = req.body;
    const admin = (req as any).admin as AdminUser;

    const report = (await storage.getReports()).find(r => r.id === reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (banUser && report.reportedUserId) {
      await storage.setBotUserBanned(report.reportedUserId, true);
      if (report.chatId) {
        try {
          await TelegramService.callTelegramApi('banChatMember', {
            chat_id: report.chatId,
            user_id: Number(report.reportedUserId) || report.reportedUserId
          });
        } catch (e) {
          console.warn('[Routes] banChatMember on report resolution error:', e);
        }
      }
    }

    const updated = await storage.updateReportStatus(reportId, status || 'resolved', admin?.id);
    return res.json({ success: true, report: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update report' });
  }
});

// DELETE /api/reports/:id
apiRouter.delete('/reports/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const success = await storage.deleteReport(req.params.id);
    return res.json({ success });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete report' });
  }
});

// ============================================================================
// FRAUD PROTECTION & CUSTOM KEYWORD RULES
// ============================================================================

// GET /api/fraud-rules
apiRouter.get('/fraud-rules', authenticate, async (_req: Request, res: Response) => {
  try {
    const rules = await storage.getFraudRules();
    return res.json(rules);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch fraud rules' });
  }
});

// POST /api/fraud-rules
apiRouter.post('/fraud-rules', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const { keyword, matchType = 'contains', action = 'delete_and_warn', duration = 'permanent', maxWarnings = 3, warningText, mediaUrl, mediaType, enabled = true } = req.body;
    if (!keyword || String(keyword).trim().length === 0) {
      return res.status(400).json({ error: 'Keyword is required' });
    }

    const id = `fr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const rule = await storage.saveFraudRule({
      id,
      keyword: String(keyword).trim(),
      matchType: matchType || 'contains',
      action: action || 'delete_and_warn',
      duration: duration || 'permanent',
      maxWarnings: Number(maxWarnings) || 3,
      warningText: warningText ? String(warningText).trim() : undefined,
      customMessage: warningText ? String(warningText).trim() : undefined,
      mediaUrl: mediaUrl ? String(mediaUrl).trim() : undefined,
      mediaType: mediaType || undefined,
      enabled: Boolean(enabled),
      createdAt: new Date().toISOString()
    });

    return res.json({ success: true, rule });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to save fraud rule' });
  }
});

// PUT /api/fraud-rules/:id
apiRouter.put('/fraud-rules/:id', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const { keyword, matchType, action, duration, maxWarnings, warningText, customMessage, mediaUrl, mediaType, enabled } = req.body;
    const existing = (await storage.getFraudRules()).find(r => r.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Fraud rule not found' });
    }

    const nextWarningText = warningText !== undefined
      ? (String(warningText).trim() || undefined)
      : (customMessage !== undefined ? (String(customMessage).trim() || undefined) : (existing.warningText || existing.customMessage));

    const updated = await storage.saveFraudRule({
      id,
      keyword: keyword !== undefined ? String(keyword).trim() : existing.keyword,
      matchType: matchType !== undefined ? matchType : existing.matchType,
      action: action !== undefined ? action : existing.action,
      duration: duration !== undefined ? duration : (existing.duration || 'permanent'),
      maxWarnings: maxWarnings !== undefined ? Number(maxWarnings) : (existing.maxWarnings || 3),
      warningText: nextWarningText,
      customMessage: nextWarningText,
      mediaUrl: mediaUrl !== undefined ? (String(mediaUrl).trim() || undefined) : existing.mediaUrl,
      mediaType: mediaType !== undefined ? mediaType : existing.mediaType,
      enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled,
      createdAt: existing.createdAt
    });

    return res.json({ success: true, rule: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update fraud rule' });
  }
});

// DELETE /api/fraud-rules/:id
apiRouter.delete('/fraud-rules/:id', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const success = await storage.deleteFraudRule(req.params.id);
    return res.json({ success });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to delete fraud rule' });
  }
});

// POST /api/items
apiRouter.post('/items', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  const { type: rawType, name, rawKeyword, triggerType, caption, telegramFileId, uploadedFileId, fileType, fileName, fileSize, mimeType, url, openMode, buttonText, replyMessage, triggers, retentionType, retentionDays } = req.body;

  const cleanKeyword = rawKeyword ? String(rawKeyword).replace(/^[#/]/, '').trim() : '';
  if (!cleanKeyword) {
    return res.status(400).json({ error: 'Trigger keyword is required' });
  }

  // Auto-detect item type:
  // 1. If explicit 'link' or valid url provided: 'link'
  // 2. If 'text' or isTextOnly is true or no files/links provided: 'file' with isTextOnly = true
  // 3. Otherwise: 'file'
  const isExplicitLink = rawType === 'link' || Boolean(url && String(url).trim().match(/^https?:\/\//i));
  const isExplicitText = rawType === 'text' || req.body.isTextOnly === true || req.body.fileEnabled === false;
  const hasFilesAttached = Boolean(telegramFileId || uploadedFileId || req.body.hasFiles || fileType);

  let type: 'file' | 'link' = isExplicitLink ? 'link' : 'file';
  const isTextOnly = !isExplicitLink && (isExplicitText || (!hasFilesAttached && (Boolean(caption) || Boolean(replyMessage))));

  if (type === 'file' && admin.role !== 'owner' && !admin.permissions.files_add) {
    return res.status(403).json({ error: 'Permission denied: Cannot add files' });
  }
  if (type === 'link' && admin.role !== 'owner' && !admin.permissions.links_add) {
    return res.status(403).json({ error: 'Permission denied: Cannot add links' });
  }

  const resolvedName = (name && String(name).trim()) || (isTextOnly ? `Text: ${cleanKeyword}` : (fileName || `Item ${cleanKeyword}`));

  const tType: TriggerType = triggerType || 'hashtag';
  const primaryTrigger = tType === 'hashtag' ? `#${cleanKeyword}` : tType === 'slash' ? `/${cleanKeyword}` : cleanKeyword;
  const allTriggers = Array.isArray(triggers) && triggers.length > 0 ? triggers : [primaryTrigger];

  const id = `${type === 'file' ? (isTextOnly ? 't_' : 'f_') : 'l_'}${Date.now().toString(36)}`;

  const item: ItemRecord = {
    id,
    type,
    name: resolvedName,
    triggers: allTriggers,
    triggerType: tType,
    rawKeyword: cleanKeyword,
    inFiltersList: req.body.inFiltersList === true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    deliveryCount: 0
  };

  // Retention / Expiration handling (Temporary vs Permanent)
  if (type === 'file' && retentionType === 'temporary') {
    const days = Math.max(1, parseInt(String(retentionDays || '1'), 10) || 1);
    item.retentionType = 'temporary';
    item.retentionDays = days;
    item.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    item.retentionType = 'permanent';
    item.retentionDays = undefined;
    item.expiresAt = undefined;
  }

  item.isTextOnly = isTextOnly;
  item.fileEnabled = !isTextOnly;
  item.replyMessage = req.body.replyMessage || caption || resolvedName;

  if (type === 'file') {
    if (isTextOnly) {
      item.caption = caption || req.body.replyMessage || undefined;
      item.fileName = undefined;
      item.fileType = undefined;
      item.fileSize = undefined;
      item.telegramFileId = undefined;
      item.uploadedFileId = undefined;
      item.buttonText = buttonText || undefined;
    } else {
      item.telegramFileId = telegramFileId || '';
      item.uploadedFileId = uploadedFileId || (telegramFileId && (telegramFileId.startsWith('upload_') || telegramFileId.startsWith('local_') || telegramFileId.startsWith('phone_')) ? telegramFileId : undefined);
      
      // Compute fileSize from uploaded file on disk if not provided
      let calculatedSize = fileSize || 0;
      if (!calculatedSize && item.uploadedFileId) {
        const up = await storage.getUploadedFile(item.uploadedFileId);
        if (up) calculatedSize = up.size;
      }

      item.fileType = fileType || 'document';
      item.fileName = fileName || name;
      item.fileSize = calculatedSize;
      item.mimeType = mimeType || '';
      item.caption = caption || undefined;
      item.buttonText = buttonText || undefined;
    }
  } else if (type === 'link') {
    item.url = url;
    item.openMode = (openMode as OpenMode) || 'browser';
    item.buttonText = buttonText || (item.openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link');
    item.replyMessage = replyMessage || caption || undefined;
    item.caption = caption || replyMessage || undefined;
  }

  // Setup Video System configuration
  item.hasSetupVideo = req.body.hasSetupVideo === true;
  if (item.hasSetupVideo) {
    item.setupVideoUrl = req.body.setupVideoUrl ? String(req.body.setupVideoUrl).trim() : undefined;
    item.setupVideoTelegramFileId = req.body.setupVideoTelegramFileId ? String(req.body.setupVideoTelegramFileId).trim() : undefined;
    item.setupVideoType = req.body.setupVideoType === 'upload' ? 'upload' : 'url';
    item.setupVideoFileName = req.body.setupVideoFileName ? String(req.body.setupVideoFileName).trim() : undefined;
    item.setupVideoButtonText = req.body.setupVideoButtonText ? String(req.body.setupVideoButtonText).trim() : '🎬 Setup Video';
    item.setupResourceButtonText = req.body.setupResourceButtonText ? String(req.body.setupResourceButtonText).trim() : (item.type === 'file' ? '📁 Get File' : '🔗 Open Link');
    item.setupVideoMessage = req.body.setupVideoMessage ? String(req.body.setupVideoMessage).trim() : undefined;
  } else {
    item.setupVideoUrl = undefined;
    item.setupVideoTelegramFileId = undefined;
    item.setupVideoType = undefined;
    item.setupVideoFileName = undefined;
    item.setupVideoButtonText = undefined;
    item.setupResourceButtonText = undefined;
    item.setupVideoMessage = undefined;
  }

  await storage.saveItem(item);
  return res.json({ success: true, item });
});

// PUT /api/items/:id
apiRouter.put('/items/:id', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  const id = req.params.id;
  const existing = await storage.getItem(id);
  if (!existing) {
    return res.status(404).json({ error: 'Item not found' });
  }

  if (existing.type === 'file' && admin.role !== 'owner' && !admin.permissions.files_edit) {
    return res.status(403).json({ error: 'Permission denied: Cannot edit files' });
  }
  if (existing.type === 'link' && admin.role !== 'owner' && !admin.permissions.links_edit) {
    return res.status(403).json({ error: 'Permission denied: Cannot edit links' });
  }

  const { name, rawKeyword, triggerType, triggers, caption, telegramFileId, uploadedFileId, fileType, fileName, url, openMode, buttonText, replyMessage, status, retentionType, retentionDays, inFiltersList } = req.body;

  let currentTriggers = existing.triggers;
  let currentKeyword = existing.rawKeyword;
  let currentType = existing.triggerType;

  if (rawKeyword !== undefined || triggerType !== undefined) {
    currentKeyword = rawKeyword !== undefined ? String(rawKeyword).replace(/^[#/]/, '').trim() : existing.rawKeyword;
    currentType = triggerType !== undefined ? (triggerType as TriggerType) : existing.triggerType;
    const computed = currentType === 'hashtag' ? `#${currentKeyword}` : currentType === 'slash' ? `/${currentKeyword}` : currentKeyword;
    currentTriggers = Array.isArray(triggers) && triggers.length > 0 ? triggers : [computed];
  } else if (triggers !== undefined && Array.isArray(triggers)) {
    currentTriggers = triggers;
  }

  let finalRetentionType = existing.retentionType || 'permanent';
  let finalRetentionDays = existing.retentionDays;
  let finalExpiresAt = existing.expiresAt;

  if (retentionType !== undefined) {
    if (retentionType === 'temporary') {
      const days = Math.max(1, parseInt(String(retentionDays || existing.retentionDays || '1'), 10) || 1);
      finalRetentionType = 'temporary';
      finalRetentionDays = days;
      finalExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    } else {
      finalRetentionType = 'permanent';
      finalRetentionDays = undefined;
      finalExpiresAt = undefined;
    }
  } else if (retentionDays !== undefined && finalRetentionType === 'temporary') {
    const days = Math.max(1, parseInt(String(retentionDays), 10) || 1);
    finalRetentionDays = days;
    finalExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const updated: ItemRecord = {
    ...existing,
    name: name !== undefined ? String(name).trim() : existing.name,
    rawKeyword: currentKeyword,
    triggerType: currentType,
    triggers: currentTriggers,
    status: status !== undefined ? status : existing.status,
    caption: caption !== undefined ? caption : (req.body.replyMessage !== undefined ? req.body.replyMessage : existing.caption),
    telegramFileId: telegramFileId !== undefined ? telegramFileId : existing.telegramFileId,
    uploadedFileId: uploadedFileId !== undefined 
      ? uploadedFileId 
      : (telegramFileId && (telegramFileId.startsWith('upload_') || telegramFileId.startsWith('local_') || telegramFileId.startsWith('phone_')) ? telegramFileId : existing.uploadedFileId),
    fileBase64: undefined,
    fileType: fileType !== undefined ? fileType : existing.fileType,
    fileName: fileName !== undefined ? fileName : existing.fileName,
    url: url !== undefined ? url : existing.url,
    openMode: openMode !== undefined ? openMode : existing.openMode,
    buttonText: buttonText !== undefined ? buttonText : existing.buttonText,
    replyMessage: req.body.replyMessage !== undefined ? req.body.replyMessage : (caption !== undefined ? caption : existing.replyMessage),
    isTextOnly: req.body.isTextOnly !== undefined ? Boolean(req.body.isTextOnly) : existing.isTextOnly,
    fileEnabled: req.body.fileEnabled !== undefined ? Boolean(req.body.fileEnabled) : existing.fileEnabled,
    inFiltersList: inFiltersList !== undefined ? inFiltersList === true : existing.inFiltersList,
    retentionType: finalRetentionType,
    retentionDays: finalRetentionDays,
    expiresAt: finalExpiresAt,
    hasSetupVideo: req.body.hasSetupVideo !== undefined ? Boolean(req.body.hasSetupVideo) : existing.hasSetupVideo,
    setupVideoUrl: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoUrl !== undefined ? (req.body.setupVideoUrl ? String(req.body.setupVideoUrl).trim() : undefined) : existing.setupVideoUrl),
    setupVideoTelegramFileId: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoTelegramFileId !== undefined
          ? (req.body.setupVideoTelegramFileId ? String(req.body.setupVideoTelegramFileId).trim() : undefined)
          : (req.body.setupVideoUrl !== undefined && String(req.body.setupVideoUrl || '').trim() !== String(existing.setupVideoUrl || '').trim()
              ? undefined
              : existing.setupVideoTelegramFileId)),
    setupVideoType: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoType !== undefined ? req.body.setupVideoType : existing.setupVideoType),
    setupVideoFileName: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoFileName !== undefined ? req.body.setupVideoFileName : existing.setupVideoFileName),
    setupVideoButtonText: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoButtonText !== undefined ? (req.body.setupVideoButtonText ? String(req.body.setupVideoButtonText).trim() : '🎬 Setup Video') : existing.setupVideoButtonText),
    setupResourceButtonText: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupResourceButtonText !== undefined ? (req.body.setupResourceButtonText ? String(req.body.setupResourceButtonText).trim() : (existing.type === 'file' ? '📁 Get File' : '🔗 Open Link')) : existing.setupResourceButtonText),
    setupVideoMessage: req.body.hasSetupVideo === false
      ? undefined
      : (req.body.setupVideoMessage !== undefined ? (req.body.setupVideoMessage ? String(req.body.setupVideoMessage).trim() : undefined) : existing.setupVideoMessage),
    updatedAt: new Date().toISOString()
  };

  await storage.saveItem(updated);
  return res.json({ success: true, item: updated });
});

// DELETE /api/items/:id (SERVER-SIDE PERMISSION ENFORCED)
apiRouter.delete('/items/:id', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  const id = req.params.id;
  const existing = await storage.getItem(id);
  if (!existing) {
    return res.status(404).json({ error: 'Item not found' });
  }

  if (existing.type === 'file' && admin.role !== 'owner' && !admin.permissions.files_delete) {
    return res.status(403).json({ error: 'Permission denied: Cannot delete files' });
  }
  if (existing.type === 'link' && admin.role !== 'owner' && !admin.permissions.links_delete) {
    return res.status(403).json({ error: 'Permission denied: Cannot delete links' });
  }

  const deleted = await storage.deleteItem(id);
  return res.json({ success: deleted });
});

// POST /api/items/upload/init (Initialize a chunked upload session for large files)
apiRouter.post('/items/upload/init', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  if (admin.role !== 'owner' && !admin.permissions?.files_add && !admin.permissions?.links_add && !admin.permissions?.files_edit && !admin.permissions?.links_edit) {
    return res.status(403).json({ error: 'Permission denied: Cannot upload files' });
  }
  try {
    const fileName = String(req.body?.fileName || 'file').trim() || 'file';
    const fileSize = Number(req.body?.fileSize || 0);
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return res.status(400).json({ error: 'Selected file is empty or invalid size' });
    }
    const MAX_CHUNKED_FILE_SIZE = 1024 * 1024 * 1024; // 1GB max
    if (fileSize > MAX_CHUNKED_FILE_SIZE) {
      return res.status(413).json({ error: 'File size exceeds 1 GB maximum limit.' });
    }
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 2000) {
      return res.status(400).json({ error: 'Invalid chunk count for upload' });
    }

    const uploadId = `upload_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const baseDir = storage.getPrimaryUploadDir();
    const chunkDir = path.join(baseDir, '.chunks', uploadId);
    await fs.promises.mkdir(chunkDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(chunkDir, 'session.json'),
      JSON.stringify({
        uploadId,
        fileName,
        fileSize,
        totalChunks,
        mimeType: String(req.body?.mimeType || 'application/octet-stream'),
        fileType: String(req.body?.fileType || 'document'),
        createdAt: new Date().toISOString()
      })
    );

    return res.json({ success: true, uploadId });
  } catch (err: any) {
    console.error('[UploadInit] Failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to initialize chunked upload' });
  }
});

// POST /api/items/upload/chunk (Receive a single raw binary chunk)
apiRouter.post(
  '/items/upload/chunk',
  authenticate,
  express.raw({ type: '*/*', limit: '25mb' }),
  async (req: Request, res: Response) => {
    const admin = (req as any).admin as AdminUser;
    if (admin.role !== 'owner' && !admin.permissions?.files_add && !admin.permissions?.links_add && !admin.permissions?.files_edit && !admin.permissions?.links_edit) {
      return res.status(403).json({ error: 'Permission denied: Cannot upload files' });
    }
    try {
      const uploadId = String(req.query.uploadId || '').trim();
      const index = Number(req.query.index);
      if (!/^upload_[a-z0-9_]+$/i.test(uploadId)) {
        return res.status(400).json({ error: 'Invalid uploadId' });
      }
      if (!Number.isInteger(index) || index < 0 || index >= 2000) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }
      const chunkBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (!chunkBuf || chunkBuf.length === 0) {
        return res.status(400).json({ error: 'Empty chunk payload' });
      }

      const baseDir = storage.getPrimaryUploadDir();
      const chunkDir = path.join(baseDir, '.chunks', uploadId);
      if (!fs.existsSync(chunkDir)) {
        return res.status(404).json({ error: 'Upload session expired or not found. Please retry upload.' });
      }

      await fs.promises.writeFile(path.join(chunkDir, `chunk_${index}.part`), chunkBuf);
      return res.json({ success: true, index, receivedBytes: chunkBuf.length });
    } catch (err: any) {
      console.error('[UploadChunk] Failed:', err);
      return res.status(500).json({ error: err?.message || 'Failed to write upload chunk' });
    }
  }
);

// POST /api/items/upload/complete (Assemble chunks on disk without giant memory spikes & register item upload)
apiRouter.post('/items/upload/complete', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  if (admin.role !== 'owner' && !admin.permissions?.files_add && !admin.permissions?.links_add && !admin.permissions?.files_edit && !admin.permissions?.links_edit) {
    return res.status(403).json({ error: 'Permission denied: Cannot upload files' });
  }
  try {
    const uploadId = String(req.body?.uploadId || '').trim();
    const totalChunks = Number(req.body?.totalChunks || 0);
    if (!/^upload_[a-z0-9_]+$/i.test(uploadId)) {
      return res.status(400).json({ error: 'Invalid uploadId' });
    }

    const baseDir = storage.getPrimaryUploadDir();
    const chunkDir = path.join(baseDir, '.chunks', uploadId);
    if (!fs.existsSync(chunkDir)) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    let sessionMeta: any = {};
    try {
      sessionMeta = JSON.parse(await fs.promises.readFile(path.join(chunkDir, 'session.json'), 'utf8'));
    } catch {}

    const expectedChunks = Number.isInteger(totalChunks) && totalChunks > 0
      ? totalChunks
      : Number(sessionMeta.totalChunks || 0);
    if (!expectedChunks || expectedChunks < 1) {
      return res.status(400).json({ error: 'Invalid chunk count' });
    }

    for (let i = 0; i < expectedChunks; i++) {
      const partPath = path.join(chunkDir, `chunk_${i}.part`);
      if (!fs.existsSync(partPath)) {
        return res.status(400).json({ error: `Missing upload chunk ${i + 1} of ${expectedChunks}. Please retry.` });
      }
    }

    const finalPath = path.join(baseDir, uploadId);
    const writeStream = fs.createWriteStream(finalPath);
    let assembledSize = 0;

    try {
      for (let i = 0; i < expectedChunks; i++) {
        const partPath = path.join(chunkDir, `chunk_${i}.part`);
        const chunkData = await fs.promises.readFile(partPath);
        assembledSize += chunkData.length;
        if (!writeStream.write(chunkData)) {
          await new Promise<void>((resolve, reject) => {
            writeStream.once('drain', resolve);
            writeStream.once('error', reject);
          });
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.once('error', reject);
      });
    } catch (streamErr) {
      writeStream.destroy();
      throw streamErr;
    }

    // Clean up chunk staging folder
    await fs.promises.rm(chunkDir, { recursive: true, force: true }).catch(() => {});

    const fileName = String(req.body?.fileName || sessionMeta.fileName || 'file').trim() || 'file';
    const rawMime = String(req.body?.mimeType || sessionMeta.mimeType || 'application/octet-stream');
    const declaredType = String(req.body?.fileType || sessionMeta.fileType || '');
    const fType: 'document' | 'photo' | 'video' | 'audio' =
      ['document', 'photo', 'video', 'audio'].includes(declaredType)
        ? (declaredType as any)
        : rawMime.startsWith('image/')
        ? 'photo'
        : rawMime.startsWith('video/')
        ? 'video'
        : rawMime.startsWith('audio/')
        ? 'audio'
        : 'document';
    const caption: string | undefined = req.body?.caption || undefined;

    const MAX_TG_BOT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const smallBuffer = assembledSize <= MAX_TG_BOT_FILE_SIZE
      ? await fs.promises.readFile(finalPath)
      : undefined;

    await storage.registerUploadedFileFromDisk(uploadId, {
      fileName,
      fileType: fType,
      mimeType: rawMime,
      size: assembledSize,
      bufferForSmallSync: assembledSize <= 24 * 1024 * 1024 ? smallBuffer : undefined
    });

    console.info(`[ChunkUpload] Assembled "${fileName}" (${(assembledSize / (1024 * 1024)).toFixed(2)} MB) as ${uploadId}`);

    if (assembledSize > MAX_TG_BOT_FILE_SIZE) {
      return res.json({
        success: true,
        fileId: uploadId,
        uploadedFileId: uploadId,
        fileName,
        fileSize: assembledSize,
        fileType: fType,
        warning: `File size is ${(assembledSize / (1024 * 1024)).toFixed(1)} MB. Telegram Bot API allows bot files up to 50MB. File is saved to storage.`
      });
    }

    // Try Telegram pre-registration for <= 50MB files
    let result: { ok: boolean; fileId?: string; fileUniqueId?: string; error?: string } = { ok: false, error: 'Telegram upload deferred' };
    if (smallBuffer) {
      try {
        const settings = await storage.getSettings();
        const candidateChat = admin.telegramId || (admin as any).id || settings.rootAdminId || process.env.ROOT_ADMIN_ID;
        result = await TelegramService.uploadFileToTelegram(
          smallBuffer,
          fileName,
          fType,
          caption,
          candidateChat,
          rawMime
        );
        if (!result.ok && (settings.rootAdminId || process.env.ROOT_ADMIN_ID) && candidateChat !== (settings.rootAdminId || process.env.ROOT_ADMIN_ID)) {
          result = await TelegramService.uploadFileToTelegram(
            smallBuffer,
            fileName,
            fType,
            caption,
            settings.rootAdminId || process.env.ROOT_ADMIN_ID,
            rawMime
          );
        }
      } catch (tgErr: any) {
        console.warn('[ChunkUpload] Telegram pre-registration error:', tgErr?.message);
      }
    }

    if (result.ok && result.fileId) {
      return res.json({
        success: true,
        fileId: result.fileId,
        uploadedFileId: uploadId,
        fileUniqueId: result.fileUniqueId,
        fileName,
        fileSize: assembledSize,
        fileType: fType
      });
    }

    return res.json({
      success: true,
      fileId: uploadId,
      uploadedFileId: uploadId,
      fileName,
      fileSize: assembledSize,
      fileType: fType,
      warning: result.error ? `Saved to bot storage. The bot will deliver the file directly upon trigger.` : undefined
    });
  } catch (err: any) {
    console.error('[UploadComplete] Failed:', err);
    return res.status(500).json({ error: err?.message || 'Failed to finalize uploaded file' });
  }
});

// POST /api/items/upload (Upload direct media from phone storage/browser via multipart FormData or base64)
apiRouter.post('/items/upload', authenticate, handleMulterSingle('file'), async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  if (admin.role !== 'owner' && !admin.permissions?.files_add && !admin.permissions?.links_add && !admin.permissions?.files_edit && !admin.permissions?.links_edit) {
    return res.status(403).json({ error: 'Permission denied: Cannot upload files' });
  }

  try {
    let buffer: Buffer;
    let fileName: string;
    let mimeType: string;
    let fType: 'document' | 'photo' | 'video' | 'audio';
    const caption: string | undefined = req.body.caption || undefined;

    if (req.file) {
      // Multipart upload (direct binary streaming from FormData)
      buffer = req.file.buffer;
      fileName = req.file.originalname || req.body.fileName || 'file';
      mimeType = req.file.mimetype || 'application/octet-stream';
      const declaredType = req.body.fileType;
      if (declaredType && ['document', 'photo', 'video', 'audio'].includes(declaredType)) {
        fType = declaredType;
      } else {
        fType = mimeType.startsWith('image/')
          ? 'photo'
          : mimeType.startsWith('video/')
          ? 'video'
          : mimeType.startsWith('audio/')
          ? 'audio'
          : 'document';
      }
    } else {
      // JSON / Base64 upload fallback
      const { fileName: bodyFileName, fileType: bodyFileType, fileBase64, mimeType: bodyMime } = req.body;
      if (!fileBase64 || !bodyFileName) {
        return res.status(400).json({ error: 'File or fileBase64 is required' });
      }
      const cleanBase64 = String(fileBase64).replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(cleanBase64, 'base64');
      fileName = bodyFileName;
      fType = (bodyFileType as any) || 'document';
      mimeType = bodyMime || (fType === 'photo' ? 'image/jpeg' : fType === 'video' ? 'video/mp4' : fType === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Selected file is empty' });
    }

    // 1. Generate unique upload ID and ALWAYS save buffer to persistent storage!
    const uploadId = `upload_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    await storage.saveUploadedFile(uploadId, {
      buffer,
      fileName,
      fileType: fType,
      mimeType
    });
    console.info(`[Upload] Successfully stored uploaded file "${fileName}" (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) as: ${uploadId}`);

    // Check file size against Telegram Bot API 50MB limit
    const MAX_TG_BOT_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const isOverTelegramLimit = buffer.length > MAX_TG_BOT_FILE_SIZE;

    if (isOverTelegramLimit) {
      console.warn(`[Upload] File "${fileName}" (${(buffer.length / (1024 * 1024)).toFixed(1)} MB) exceeds Telegram Bot API 50MB limit.`);
      return res.json({
        success: true,
        fileId: uploadId,
        uploadedFileId: uploadId,
        fileName,
        fileSize: buffer.length,
        fileType: fType,
        warning: `File size is ${(buffer.length / (1024 * 1024)).toFixed(1)} MB. Telegram Bot API allows bot files up to 50MB. File is saved to storage.`
      });
    }

    // 2. Try to pre-register with Telegram if possible (for files <= 50MB)
    let result: { ok: boolean; fileId?: string; fileUniqueId?: string; error?: string } = { ok: false, error: 'Telegram upload deferred' };
    try {
      const settings = await storage.getSettings();
      const candidateChat = admin.telegramId || (admin as any).id || settings.rootAdminId || process.env.ROOT_ADMIN_ID;
      result = await TelegramService.uploadFileToTelegram(
        buffer,
        fileName,
        fType,
        caption,
        candidateChat,
        mimeType
      );
      if (!result.ok && (settings.rootAdminId || process.env.ROOT_ADMIN_ID) && candidateChat !== (settings.rootAdminId || process.env.ROOT_ADMIN_ID)) {
        result = await TelegramService.uploadFileToTelegram(
          buffer,
          fileName,
          fType,
          caption,
          settings.rootAdminId || process.env.ROOT_ADMIN_ID,
          mimeType
        );
      }
    } catch (tgErr: any) {
      console.warn('[Upload] Telegram pre-registration caught error:', tgErr?.message);
    }

    if (result.ok && result.fileId) {
      console.info(`[Upload] Pre-registered with Telegram Bot successfully. Real Telegram file_id: ${result.fileId}`);
      return res.json({
        success: true,
        fileId: result.fileId,
        uploadedFileId: uploadId,
        fileUniqueId: result.fileUniqueId,
        fileName,
        fileSize: buffer.length,
        fileType: fType
      });
    }

    // 3. If Telegram pre-registration was deferred, use our stored uploadId!
    // The bot will directly deliver the actual file buffer via multipart upon user trigger!
    console.warn('[Upload] Telegram pre-registration deferred. File saved locally for instant delivery:', result.error);
    return res.json({
      success: true,
      fileId: uploadId,
      uploadedFileId: uploadId,
      fileName,
      fileSize: buffer.length,
      fileType: fType,
      warning: result.error ? `Saved to bot storage. The bot will deliver the file directly upon trigger.` : undefined
    });
  } catch (err: any) {
    console.error('[Upload] Exception during file upload:', err);
    return res.status(500).json({ error: err.message || 'File upload failed' });
  }
});

// GET /api/uploads/:fileId (Stream or download stored uploaded media)
apiRouter.get('/uploads/:fileId', async (req: Request, res: Response) => {
  try {
    const cleanId = String(req.params.fileId || '').trim();
    const diskPath = storage.getUploadedFilePath(cleanId);
    if (diskPath) {
      const stat = await fs.promises.stat(diskPath);
      let meta: any = {};
      try {
        meta = JSON.parse(await fs.promises.readFile(`${diskPath}.meta.json`, 'utf8'));
      } catch {}
      res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.fileName || 'file')}"`);
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(diskPath).pipe(res);
    }

    const file = await storage.getUploadedFile(cleanId);
    if (!file) {
      return res.status(404).json({ error: 'Uploaded file not found' });
    }
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.setHeader('Content-Length', file.size);
    return res.send(file.buffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve file' });
  }
});

// ============================================================================
// TEMPLATES
// ============================================================================

// GET /api/templates
apiRouter.get('/templates', authenticate, async (_req: Request, res: Response) => {
  const templates = await storage.getTemplates();
  return res.json(templates);
});

// PUT /api/templates/:key
apiRouter.put('/templates/:key', authenticate, requirePermission('messages_edit'), async (req: Request, res: Response) => {
  const key = req.params.key;
  const { content, mediaType, mediaUrl, buttons } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Template content must be a string' });
  }
  await storage.updateTemplate(key, content, { mediaType, mediaUrl, buttons });
  const updated = await storage.getTemplate(key);
  return res.json({ success: true, template: updated });
});

// POST /api/templates/reset
apiRouter.put('/templates-reset', authenticate, requirePermission('messages_edit'), async (_req: Request, res: Response) => {
  await storage.resetTemplates();
  const all = await storage.getTemplates();
  return res.json({ success: true, templates: all });
});

// ============================================================================
// ADMINS MANAGEMENT
// ============================================================================

// GET /api/admins
apiRouter.get('/admins', authenticate, requirePermission('admins_manage'), async (_req: Request, res: Response) => {
  const admins = await storage.getAdmins();
  // Strip password hash from response
  const sanitized = admins.map(({ passwordHash, ...rest }) => rest);
  return res.json(sanitized);
});

// POST /api/admins
apiRouter.post('/admins', authenticate, requirePermission('admins_manage'), async (req: Request, res: Response) => {
  const { telegramId, name, password, role, permissions } = req.body;
  if (!telegramId || !password || !name) {
    return res.status(400).json({ error: 'Telegram ID, name, and password are required' });
  }

  const cleanId = String(telegramId).trim();
  const existing = await storage.getAdmin(cleanId);
  if (existing) {
    return res.status(400).json({ error: 'Admin with this Telegram ID already exists' });
  }

  const hash = await hashPassword(String(password));
  const newAdmin: AdminUser = {
    id: cleanId,
    telegramId: cleanId,
    name: String(name).trim(),
    role: (role as any) || 'subadmin',
    passwordHash: hash,
    permissions: permissions || {
      files_view: true, files_add: true, files_edit: true, files_delete: false,
      links_view: true, links_add: true, links_edit: true, links_delete: false,
      messages_view: true, messages_edit: false, admins_manage: false,
      design_edit: false, settings_edit: false, cleanup_manage: false
    },
    enabled: true,
    createdAt: new Date().toISOString()
  };

  await storage.saveAdmin(newAdmin);
  const { passwordHash: _, ...rest } = newAdmin;
  return res.json({ success: true, admin: rest });
});

// PUT /api/admins/:id
apiRouter.put('/admins/:id', authenticate, requirePermission('admins_manage'), async (req: Request, res: Response) => {
  const id = req.params.id;
  const admin = await storage.getAdmin(id);
  if (!admin) {
    return res.status(404).json({ error: 'Admin not found' });
  }

  const { name, password, role, permissions, enabled } = req.body;
  if (name !== undefined) admin.name = String(name).trim();
  if (enabled !== undefined) admin.enabled = Boolean(enabled);
  if (role !== undefined) admin.role = role;
  if (permissions !== undefined) admin.permissions = permissions;
  if (password && String(password).trim().length >= 6) {
    admin.passwordHash = await hashPassword(String(password).trim());
  }

  await storage.saveAdmin(admin);
  const { passwordHash: _, ...rest } = admin;
  return res.json({ success: true, admin: rest });
});

// POST /api/admins/:id/token (Issue a fresh panel access token for an enabled admin)
apiRouter.post('/admins/:id/token', authenticate, requirePermission('admins_manage'), async (req: Request, res: Response) => {
  const target = await storage.getAdmin(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'Admin not found' });
  }
  if (!target.enabled) {
    return res.status(400).json({ error: 'Cannot issue access token for a disabled administrator' });
  }
  const sessionBotId = (req as any).sessionBotId || 'main';
  const rawToken = await storage.createSession(target.id, target.role, sessionBotId);
  const accessToken = signSessionToken(rawToken);
  return res.json({ success: true, accessToken, botId: sessionBotId });
});

// DELETE /api/admins/:id
apiRouter.delete('/admins/:id', authenticate, requirePermission('admins_manage'), async (req: Request, res: Response) => {
  const currentAdmin = (req as any).admin as AdminUser;
  const id = req.params.id;
  if (currentAdmin.id === id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const target = await storage.getAdmin(id);
  if (target?.role === 'owner' && currentAdmin.role !== 'owner') {
    return res.status(403).json({ error: 'Only an owner can delete an owner' });
  }

  const deleted = await storage.deleteAdmin(id);
  if (deleted) {
    await storage.setBotUserAdmin(id, false).catch(() => {});
  }
  return res.json({ success: deleted });
});

// ============================================================================
// DESIGN CONFIGURATION
// ============================================================================

// GET /api/design
apiRouter.get('/design', authenticate, async (_req: Request, res: Response) => {
  const design = await storage.getDesign();
  return res.json(design);
});

// PUT /api/design
apiRouter.put('/design', authenticate, requirePermission('design_edit'), async (req: Request, res: Response) => {
  const updated = await storage.updateDesign(req.body);
  return res.json({ success: true, design: updated });
});

// ============================================================================
// SETTINGS & BOT
// ============================================================================

// GET /api/settings
apiRouter.get('/settings', authenticate, async (_req: Request, res: Response) => {
  const settings = await storage.getSettings();
  const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || settings.botToken || '').trim().replace(/^["']|["']$/g, '');

  let botUsername = settings.botUsername || '';
  if (token && !botUsername) {
    try {
      const me = await TelegramService.callTelegramApi('getMe', {});
      if (me?.ok && me.result?.username) {
        botUsername = me.result.username;
        await storage.updateSettings({ botUsername, botToken: token });
      }
    } catch {}
  }

  // Mask token for privacy
  const maskedToken = token ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}` : '';
  return res.json({
    ...settings,
    botToken: token,
    botUsername,
    antiForwardEnabled: settings.antiForwardEnabled ?? false,
    linkDeleteEnabled: settings.linkDeleteEnabled ?? false,
    botMode: settings.botMode === 'post_bot' ? 'post_bot' : 'file_bot',
    forceSubEnabled: settings.forceSubEnabled ?? false,
    forceJoinMode: settings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join',
    requiredChannels: Array.isArray(settings.requiredChannels) ? settings.requiredChannels : [],
    chatWhitelistEnabled: settings.chatWhitelistEnabled ?? false,
    allowedChats: (Array.isArray(settings.allowedChats) ? settings.allowedChats : []).map((entry: any) => ({
      ...entry,
      chatId: entry.chatId || entry.id || ''
    })),
    botTokenMasked: maskedToken,
    hasToken: Boolean(token),
    isConnected: Boolean(token && botUsername)
  });
});

// PUT /api/settings
apiRouter.put('/settings', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  const { 
    botToken, 
    botUsername, 
    rootAdminId, 
    maxBotMessagesPerChat, 
    dailyCleanupEnabled, 
    cleanupAgeHours, 
    adminNewPassword,
    autoDeleteDeliveryEnabled,
    deliveryTimeoutMinutes,
    autoDeleteNoticeEnabled,
    forceSubEnabled,
    forceJoinMode,
    requiredChannels
  } = req.body;
  const updates: any = {};
  if (botToken !== undefined && botToken.trim() !== '') updates.botToken = botToken.trim();
  if (botUsername !== undefined) updates.botUsername = botUsername.trim();
  if (rootAdminId !== undefined) updates.rootAdminId = rootAdminId.trim();
  if (maxBotMessagesPerChat !== undefined) updates.maxBotMessagesPerChat = Number(maxBotMessagesPerChat) || 10;
  if (dailyCleanupEnabled !== undefined) updates.dailyCleanupEnabled = Boolean(dailyCleanupEnabled);
  if (cleanupAgeHours !== undefined) updates.cleanupAgeHours = Number(cleanupAgeHours) || 24;
  if (autoDeleteDeliveryEnabled !== undefined) updates.autoDeleteDeliveryEnabled = Boolean(autoDeleteDeliveryEnabled);
  if (deliveryTimeoutMinutes !== undefined) updates.deliveryTimeoutMinutes = Math.max(1, Number(deliveryTimeoutMinutes) || 10);
  if (autoDeleteNoticeEnabled !== undefined) updates.autoDeleteNoticeEnabled = Boolean(autoDeleteNoticeEnabled);
  if (req.body.maintenanceMode !== undefined) updates.maintenanceMode = Boolean(req.body.maintenanceMode);
  if (req.body.maintenanceNotice !== undefined) updates.maintenanceNotice = String(req.body.maintenanceNotice).trim();
  if (forceSubEnabled !== undefined) updates.forceSubEnabled = Boolean(forceSubEnabled);
  if (forceJoinMode !== undefined) updates.forceJoinMode = forceJoinMode === 'request_only' ? 'request_only' : 'auto_join';
  if (req.body.autoApproveJoinRequests !== undefined) updates.autoApproveJoinRequests = Boolean(req.body.autoApproveJoinRequests);
  if (req.body.antiForwardEnabled !== undefined) updates.antiForwardEnabled = Boolean(req.body.antiForwardEnabled);
  if (req.body.linkDeleteEnabled !== undefined) updates.linkDeleteEnabled = Boolean(req.body.linkDeleteEnabled);
  if (req.body.chatWhitelistEnabled !== undefined) updates.chatWhitelistEnabled = Boolean(req.body.chatWhitelistEnabled);
  if (req.body.botMode !== undefined) updates.botMode = req.body.botMode === 'post_bot' ? 'post_bot' : 'file_bot';
  if (requiredChannels !== undefined) {
    if (Array.isArray(requiredChannels)) {
      updates.requiredChannels = requiredChannels
        .map((c: any) => ({
          id: String(c.id || `ch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`),
          name: String(c.name || '').trim(),
          chatId: String(c.chatId || '').trim(),
          inviteLink: String(c.inviteLink || '').trim(),
          ...(c.requestInviteLink ? { requestInviteLink: String(c.requestInviteLink).trim() } : {}),
          enabled: c.enabled !== false,
          isAutoDetected: Boolean(c.isAutoDetected),
          type: c.type || 'channel',
          username: c.username ? String(c.username).trim() : undefined,
          isAdmin: c.isAdmin !== undefined ? Boolean(c.isAdmin) : true,
          detectedAt: c.detectedAt || new Date().toISOString()
        }))
        .filter((c: any) => c.name && c.chatId);
    } else {
      updates.requiredChannels = [];
    }
  }

  const currentAdmin = (req as any).admin as AdminUser;
  if (adminNewPassword && String(adminNewPassword).trim().length >= 6 && currentAdmin) {
    const admin = await storage.getAdmin(currentAdmin.id);
    if (admin) {
      admin.passwordHash = await hashPassword(String(adminNewPassword).trim());
      await storage.saveAdmin(admin);
      console.info('[Settings] Admin password successfully updated for:', admin.id);
    }
  }

  cachedBotInfoPayload = null;
  const newSettings = await storage.updateSettings(updates);
  if (
    forceSubEnabled !== undefined ||
    forceJoinMode !== undefined ||
    requiredChannels !== undefined ||
    req.body.autoApproveJoinRequests !== undefined
  ) {
    TelegramService.invalidateForceSubCache();
  }
  return res.json({ 
    success: true, 
    settings: {
      ...newSettings,
      antiForwardEnabled: newSettings.antiForwardEnabled ?? false,
      linkDeleteEnabled: newSettings.linkDeleteEnabled ?? false,
      botMode: newSettings.botMode === 'post_bot' ? 'post_bot' : 'file_bot',
      forceSubEnabled: newSettings.forceSubEnabled ?? false,
      forceJoinMode: newSettings.forceJoinMode === 'request_only' ? 'request_only' : 'auto_join',
      autoApproveJoinRequests: newSettings.autoApproveJoinRequests ?? true,
      requiredChannels: Array.isArray(newSettings.requiredChannels) ? newSettings.requiredChannels : [],
      chatWhitelistEnabled: newSettings.chatWhitelistEnabled ?? false,
      allowedChats: (Array.isArray(newSettings.allowedChats) ? newSettings.allowedChats : []).map((entry: any) => ({
        ...entry,
        chatId: entry.chatId || entry.id || ''
      }))
    } 
  });
});

// =========================================================================
// CHAT WHITELIST / IGNORE MANAGEMENT ROUTES
// =========================================================================
const formatAllowedChatsResponse = (entries: any[] = []) =>
  (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    chatId: entry.chatId || entry.id || ''
  }));

apiRouter.get('/chat-whitelist', authenticate, requirePermission('settings_edit'), async (_req: Request, res: Response) => {
  try {
    await storage.loadLatest(false);
    const settings = await storage.getSettings();
    const allowedChats = await storage.getAllowedChats();
    return res.json({
      success: true,
      chatWhitelistEnabled: Boolean(settings.chatWhitelistEnabled),
      allowedChats: formatAllowedChatsResponse(allowedChats)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load chat whitelist' });
  }
});

apiRouter.post('/chat-whitelist/toggle', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const updated = await storage.updateSettings({ chatWhitelistEnabled: enabled });
    return res.json({
      success: true,
      chatWhitelistEnabled: Boolean(updated.chatWhitelistEnabled),
      allowedChats: formatAllowedChatsResponse(updated.allowedChats)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update chat whitelist toggle' });
  }
});

apiRouter.post('/chat-whitelist/add', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const rawChatId = String(req.body?.chatId || '').trim();
    if (!rawChatId || !/^-?\d+$/.test(rawChatId)) {
      return res.status(400).json({ error: 'Valid numeric Telegram chat ID is required (e.g., -1001234567890)' });
    }

    let resolvedTitle = String(req.body?.title || '').trim();
    let resolvedType: 'group' | 'supergroup' | 'channel' = req.body?.type || 'supergroup';

    try {
      const chatRes = await TelegramService.callTelegramApi('getChat', { chat_id: Number(rawChatId) });
      if (chatRes?.ok && chatRes.result) {
        resolvedTitle = resolvedTitle || chatRes.result.title || chatRes.result.username || '';
        if (chatRes.result.type === 'group' || chatRes.result.type === 'channel' || chatRes.result.type === 'supergroup') {
          resolvedType = chatRes.result.type;
        }
      }
    } catch {}

    const currentAdmin = (req as any).admin as AdminUser;
    const updatedSettings = await storage.addAllowedChat(
      rawChatId,
      resolvedTitle || `Chat ${rawChatId}`,
      resolvedType,
      currentAdmin?.id || currentAdmin?.telegramId || 'admin',
      true
    );

    return res.json({
      success: true,
      chatWhitelistEnabled: Boolean(updatedSettings.chatWhitelistEnabled),
      allowedChats: formatAllowedChatsResponse(updatedSettings.allowedChats)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to add chat to whitelist' });
  }
});

apiRouter.delete('/chat-whitelist/:chatId', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const rawChatId = decodeURIComponent(String(req.params.chatId || '')).trim();
    if (!rawChatId) {
      return res.status(400).json({ error: 'chatId is required' });
    }
    const removal = await storage.removeAllowedChat(rawChatId);
    return res.json({
      success: true,
      chatWhitelistEnabled: Boolean(removal.settings?.chatWhitelistEnabled),
      allowedChats: formatAllowedChatsResponse(removal.settings?.allowedChats)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to remove chat from whitelist' });
  }
});

// POST /api/settings/sync-channels - Auto-detect and sync channels/groups where bot is admin
apiRouter.post('/settings/sync-channels', authenticate, requirePermission('settings_edit'), async (_req: Request, res: Response) => {
  try {
    const synced = await TelegramService.syncAdminChannels();
    return res.json({
      success: true,
      channels: synced,
      message: `Successfully detected and synced ${synced.length} channel(s) & group(s)`
    });
  } catch (err: any) {
    console.error('[API] Error syncing channels:', err);
    return res.status(500).json({ error: err.message || 'Failed to auto-detect channels' });
  }
});

// POST /api/settings/toggle-channel - Toggle channel ON/OFF directly
apiRouter.post('/settings/toggle-channel', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const { channelId, enabled } = req.body;
    if (!channelId) {
      return res.status(400).json({ error: 'channelId is required' });
    }
    const updated = await storage.toggleForceSubChannel(String(channelId), enabled !== undefined ? Boolean(enabled) : undefined);
    if (!updated) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    return res.json({ success: true, channel: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to toggle channel' });
  }
});

// GET /api/settings/join-requests - View recorded private channel join requests
apiRouter.get('/settings/join-requests', authenticate, requirePermission('settings_edit'), async (_req: Request, res: Response) => {
  try {
    const requests = await storage.getJoinRequests();
    return res.json({ success: true, requests });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch join requests' });
  }
});

// POST /api/settings/approve-join-request - Manually approve a join request
apiRouter.post('/settings/approve-join-request', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }
    const cleanChatId = /^-?\d+$/.test(String(chatId)) ? Number(chatId) : String(chatId);
    const cleanUserId = Number(userId) || userId;

    const approveRes = await TelegramService.callTelegramApi('approveChatJoinRequest', {
      chat_id: cleanChatId,
      user_id: cleanUserId
    });

    await storage.updateJoinRequestStatus(String(chatId), String(userId), 'approved');
    const botScopeId = String((storage as any)?.botId || 'main').trim() || 'main';
    TelegramService.clearCachedPendingJoinRequest(botScopeId, String(chatId), String(userId));
    TelegramService.invalidateForceSubCache(String(userId));

    return res.json({ success: true, result: approveRes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to approve join request' });
  }
});

// POST /api/settings/decline-join-request - Dismiss/decline a pending join request and revoke verification
apiRouter.post('/settings/decline-join-request', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const { chatId, userId } = req.body;
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'chatId and userId are required' });
    }
    const cleanChatId = /^-?\d+$/.test(String(chatId)) ? Number(chatId) : String(chatId);
    const cleanUserId = Number(userId) || userId;

    const declineRes = await TelegramService.callTelegramApi('declineChatJoinRequest', {
      chat_id: cleanChatId,
      user_id: cleanUserId
    }).catch(() => null);

    const botScopeId = String((storage as any)?.botId || 'main').trim() || 'main';
    TelegramService.clearCachedPendingJoinRequest(botScopeId, String(chatId), String(userId));
    TelegramService.invalidateForceSubCache(String(userId));
    await storage.invalidateJoinRequest(String(chatId), String(userId));

    return res.json({ success: true, result: declineRes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to decline join request' });
  }
});

// POST /api/bot/set-webhook
apiRouter.post('/bot/set-webhook', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  const appUrl = (req.body.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) {
    return res.status(400).json({ error: 'App URL is required to set webhook' });
  }

  // Ensure polling loop is completely stopped before activating webhook
  TelegramService.stopPolling();

  const webhookUrl = `${appUrl}/api/telegram-webhook`;
  const result = await TelegramService.callTelegramApi('setWebhook', { 
    url: webhookUrl,
    allowed_updates: [
      'message', 'edited_message', 'channel_post', 'edited_channel_post',
      'inline_query', 'chosen_inline_result', 'callback_query',
      'my_chat_member', 'chat_member', 'chat_join_request'
    ]
  });
  return res.json(result);
});

// ============================================================================
// DYNAMIC BOT CLONING & FLEET MANAGEMENT
// ============================================================================

// GET /api/bots - List all active bots (main bot + all cloned bots)
apiRouter.get('/bots', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionBotId = (req as any).sessionBotId || 'main';
    if (sessionBotId !== 'main') {
      return res.status(403).json({ error: 'Cloned bot sub-admins cannot access bot fleet management.' });
    }
    const bots = await TelegramBotManager.getAllBots();
    return res.json({ ok: true, bots });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to list bots' });
  }
});

// POST /api/bots/clone - Dynamically clone a Telegram bot with its isolated database
apiRouter.post('/bots/clone', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const sessionBotId = (req as any).sessionBotId || 'main';
    const activeBotId = (req.headers['x-bot-id'] as string) || (req.query.bot_id as string) || (req.query.botId as string) || 'main';
    if (sessionBotId !== 'main' || activeBotId !== 'main') {
      return res.status(403).json({ error: 'Cloned bot panels are not permitted to clone additional bots.' });
    }

    const { token, owner, ownerId, ownerUsername, botMode } = req.body;
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'Valid Telegram bot token is required' });
    }
    const normalizedMode = botMode === 'post_bot' ? 'post_bot' : 'file_bot';

    const admin = (req as any).admin;
    const createdBy = admin?.username || admin?.name || 'admin';
    const rawOwner = typeof owner === 'string' ? owner.trim().replace(/^@+/, '') : '';
    const cleanOwnerId = typeof ownerId === 'string' && ownerId.trim()
      ? ownerId.trim().replace(/^@+/, '')
      : (/^\d{4,20}$/.test(rawOwner) ? rawOwner : undefined);
    const cleanOwnerUsername = typeof ownerUsername === 'string' && ownerUsername.trim()
      ? ownerUsername.trim().replace(/^@+/, '')
      : (rawOwner && !/^\d+$/.test(rawOwner) ? rawOwner : undefined);

    const reqHost = req.get('x-forwarded-host') || req.get('host') || '';
    const reqProto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const customBase = reqHost ? `${reqProto}://${reqHost}` : undefined;
    const result = await TelegramBotManager.cloneBot(
      token.trim(),
      createdBy,
      customBase,
      (cleanOwnerId || cleanOwnerUsername) ? { ownerId: cleanOwnerId, ownerUsername: cleanOwnerUsername } : undefined,
      normalizedMode
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error || 'Failed to clone bot' });
    }

    return res.json({ ok: true, bot: result.bot });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to clone bot' });
  }
});

let cachedBotInfoPayload: { data: any; expiresAt: number; token: string } | null = null;
const cachedClonedBotInfo = new Map<string, { data: any; expiresAt: number }>();

function invalidateBotInfoCache(botId?: string) {
  if (!botId || botId === 'main') {
    cachedBotInfoPayload = null;
  }
  if (botId && botId !== 'main') {
    const cleanLookup = botId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
    cachedClonedBotInfo.delete(botId);
    cachedClonedBotInfo.delete(cleanLookup);
    for (const key of Array.from(cachedClonedBotInfo.keys())) {
      if (key.replace(/^clone_/i, '').replace(/[:_-]/g, '') === cleanLookup) {
        cachedClonedBotInfo.delete(key);
      }
    }
  }
}

// DELETE /api/bots/:id - Delete a cloned bot instance and hard-stop its runner
apiRouter.delete('/bots/:id', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const sessionBotId = (req as any).sessionBotId || 'main';
    if (sessionBotId !== 'main') {
      return res.status(403).json({ error: 'Cloned bot sub-admins cannot delete bot instances.' });
    }
    const { id } = req.params;
    if (id === 'main') {
      return res.status(400).json({ error: 'Cannot delete the primary main bot' });
    }

    const success = await TelegramBotManager.deleteClonedBot(id);
    invalidateBotInfoCache(id);
    return res.json({ ok: success });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to delete cloned bot' });
  }
});

// Helper to verify access when controlling a bot lifecycle endpoint
function canControlBotTarget(req: Request, targetId: string): boolean {
  const sessionBotId = String((req as any).sessionBotId || 'main').trim() || 'main';
  if (sessionBotId === 'main') return true;
  if (targetId === 'main') return false;
  const cleanSession = sessionBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
  const cleanTarget = targetId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
  return cleanSession.length > 0 && cleanSession === cleanTarget;
}

// POST /api/bots/:id/start - Start / resume polling on main or cloned bot
apiRouter.post('/bots/:id/start', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id || '').trim() || 'main';
    if (!canControlBotTarget(req, targetId)) {
      return res.status(403).json({ error: 'Not authorized to control this bot instance.' });
    }
    const ok = await TelegramBotManager.startBot(targetId);
    invalidateBotInfoCache(targetId);
    if (!ok) {
      const conflict = BotSingletonLock.getConflict(targetId);
      if (conflict) {
        return res.status(409).json({ error: conflict.message, conflict });
      }
      return res.status(404).json({ error: 'Bot instance not found, deleted, or missing bot token.' });
    }
    return res.json({ ok: true, status: 'active', message: 'Bot started and listening for updates.' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to start bot' });
  }
});

// POST /api/bots/:id/stop - Gracefully stop polling and update handling for main or cloned bot
apiRouter.post('/bots/:id/stop', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id || '').trim() || 'main';
    if (!canControlBotTarget(req, targetId)) {
      return res.status(403).json({ error: 'Not authorized to control this bot instance.' });
    }
    const ok = await TelegramBotManager.stopBot(targetId);
    invalidateBotInfoCache(targetId);
    if (!ok) {
      return res.status(404).json({ error: 'Bot instance not found or already deleted.' });
    }
    return res.json({ ok: true, status: 'stopped', message: 'Bot stopped successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to stop bot' });
  }
});

// POST /api/bots/:id/restart - Cleanly restart polling worker for main or cloned bot
apiRouter.post('/bots/:id/restart', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id || '').trim() || 'main';
    if (!canControlBotTarget(req, targetId)) {
      return res.status(403).json({ error: 'Not authorized to control this bot instance.' });
    }
    const ok = await TelegramBotManager.restartBot(targetId);
    invalidateBotInfoCache(targetId);
    if (!ok) {
      const conflict = BotSingletonLock.getConflict(targetId);
      if (conflict) {
        return res.status(409).json({ error: conflict.message, conflict });
      }
      return res.status(404).json({ error: 'Bot instance not found, deleted, or missing bot token.' });
    }
    return res.json({ ok: true, status: 'active', message: 'Bot restarted cleanly.' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to restart bot' });
  }
});

// POST /api/bots/:id/clean-memory - Clear volatile caches/timers without touching persistent DB records
apiRouter.post('/bots/:id/clean-memory', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id || '').trim() || 'main';
    if (!canControlBotTarget(req, targetId)) {
      return res.status(403).json({ error: 'Not authorized to clean memory for this bot instance.' });
    }
    const result = await TelegramBotManager.cleanMemory(targetId);
    return res.json({
      ok: true,
      ...result,
      message: `Cleaned ${result.clearedRuntimeEntries + result.clearedStorageEntries} volatile cache entries (Heap: ${result.heapUsedMb} MB).`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to clean bot memory' });
  }
});

// POST & PATCH /api/bots/:id/mode - Dynamically switch bot operational mode ('file_bot' | 'post_bot')
const handleBotModeChange = async (req: Request, res: Response) => {
  try {
    const targetId = String(req.params.id || '').trim() || 'main';
    if (!canControlBotTarget(req, targetId)) {
      return res.status(403).json({ error: 'Not authorized to change mode for this bot instance.' });
    }
    const rawMode = String(req.body?.botMode || req.body?.mode || '').trim();
    if (rawMode !== 'file_bot' && rawMode !== 'post_bot') {
      return res.status(400).json({ error: 'Invalid botMode. Must be "file_bot" or "post_bot".' });
    }
    const result = await TelegramBotManager.setBotMode(targetId, rawMode);
    if (!result.ok) {
      return res.status(404).json({ error: result.error || 'Bot instance not found.' });
    }
    invalidateBotInfoCache(targetId);
    const label = result.botMode === 'post_bot' ? 'Post Bot' : 'File Bot';
    return res.json({
      ok: true,
      botId: targetId,
      botMode: result.botMode,
      message: `Switched bot operational mode to ${label}.`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to switch bot mode' });
  }
};
apiRouter.post('/bots/:id/mode', authenticate, requirePermission('settings_edit'), handleBotModeChange);
apiRouter.patch('/bots/:id/mode', authenticate, requirePermission('settings_edit'), handleBotModeChange);

// GET /api/bot/info - Dynamic bot status & profile strictly isolated per activeBotId
apiRouter.get('/bot/info', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  // Multi-bot support: if targeting a cloned bot instance, return ONLY its live status (never fall back to main bot!)
  const activeBotId = (
    (req.headers['x-bot-id'] as string) ||
    (req.query.bot_id as string) ||
    (req.query.botId as string) ||
    'main'
  ).trim() || 'main';

  if (activeBotId !== 'main') {
    if (TelegramBotManager.isBotDeleted(activeBotId)) {
      return res.status(404).json({
        ok: false,
        isMain: false,
        botId: activeBotId,
        isConnected: false,
        hasToken: false,
        botStatus: 'stopped',
        pollingActive: false,
        botName: '',
        botUsername: '',
        displayName: '',
        error: 'This cloned bot has been deleted.'
      });
    }

    const cachedCloned = cachedClonedBotInfo.get(activeBotId);
    if (cachedCloned && Date.now() < cachedCloned.expiresAt) {
      return res.json(cachedCloned.data);
    }

    try {
      const mainStorage = StorageManager.getMainStorage();
      const clonedList = await mainStorage.getClonedBots().catch(() => []);
      const cleanActiveLookup = activeBotId.replace(/^clone_/i, '').replace(/[:_-]/g, '');
      const currentCloned = clonedList.find(b =>
        b.id === activeBotId ||
        b.id.replace(/^clone_/i, '').replace(/[:_-]/g, '') === cleanActiveLookup
      );

      if (currentCloned && !TelegramBotManager.isBotDeleted(currentCloned.id)) {
        let liveName = currentCloned.name || '';
        let liveUsername = (currentCloned.username || '').replace(/^@/, '');
        let liveId: string | number = currentCloned.id;
        const isStopped = TelegramBotManager.isBotStopped(currentCloned.id) || currentCloned.status === 'stopped';
        let isLive = !isStopped;

        // Only auto-start runner if the bot is NOT manually stopped
        if (!isStopped) {
          TelegramBotManager.ensureBotRunning(currentCloned);
        }

        if (currentCloned.token) {
          const meRes = await TelegramService.callTelegramApi('getMe', {}, currentCloned.token).catch(() => null);
          if (meRes?.ok && meRes.result) {
            liveName = meRes.result.first_name || liveName;
            liveUsername = (meRes.result.username || liveUsername).replace(/^@/, '');
            liveId = meRes.result.id || liveId;
            if (!isStopped) isLive = true;
          }
        }

        const cStorage = StorageManager.getStorage(currentCloned.id);
        const cSettings = await cStorage.getSettings().catch(() => ({} as any));
        const effectiveBotMode = (cSettings?.botMode === 'post_bot' || (!cSettings?.botMode && currentCloned.botMode === 'post_bot'))
          ? 'post_bot'
          : 'file_bot';

        const payload = {
          ok: true,
          isMain: false,
          botId: currentCloned.id,
          botMode: effectiveBotMode,
          isConnected: isLive,
          botStatus: isStopped ? 'stopped' : 'active',
          pollingActive: TelegramBotManager.isBotActivelyRunning(currentCloned.id),
          lockConflict: BotSingletonLock.getConflict(currentCloned.id),
          hasToken: Boolean(currentCloned.token),
          botName: liveName || (liveUsername ? `@${liveUsername}` : 'Cloned Bot'),
          botFirstName: liveName,
          botUsername: liveUsername,
          displayName: liveName || (liveUsername ? `@${liveUsername}` : 'Cloned Bot'),
          result: {
            id: liveId,
            first_name: liveName || liveUsername || 'Cloned Bot',
            username: liveUsername
          }
        };
        cachedClonedBotInfo.set(activeBotId, { data: payload, expiresAt: Date.now() + 15000 });
        return res.json(payload);
      }

      return res.status(404).json({
        ok: false,
        isMain: false,
        botId: activeBotId,
        isConnected: false,
        botStatus: 'stopped',
        pollingActive: false,
        hasToken: false,
        botName: '',
        botUsername: '',
        displayName: ''
      });
    } catch (e) {
      console.warn('[Routes] Error resolving cloned bot info:', e);
      return res.json({
        ok: false,
        isMain: false,
        botId: activeBotId,
        isConnected: false,
        botStatus: 'stopped',
        pollingActive: false,
        hasToken: false,
        botName: '',
        botUsername: '',
        displayName: ''
      });
    }
  }

  const token = await TelegramService.getBotToken().catch(() => '');

  // Fast In-Memory Path: serve cached bot info in 0.05ms
  if (cachedBotInfoPayload && cachedBotInfoPayload.token === token && Date.now() < cachedBotInfoPayload.expiresAt) {
    return res.json(cachedBotInfoPayload.data);
  }

  const settings = await storage.getSettings().catch(() => null);

  if (!token) {
    const emptyPayload = {
      ok: false,
      isMain: true,
      botId: 'main',
      isConnected: false,
      hasToken: false,
      botUsername: settings?.botUsername || '',
      displayName: settings?.botUsername ? `@${settings.botUsername.replace(/^@/, '')}` : '',
      description: 'No bot token found in environment variables (BOT_TOKEN) or settings'
    };
    return res.json(emptyPayload);
  }

  let botUsername = (settings?.botUsername || '').replace(/^@/, '');
  let botFirstName = '';
  let isConnected = false;
  let rawResult: any = null;

  try {
    const result = await TelegramService.callTelegramApi('getMe', {});
    if (result?.ok && result.result) {
      rawResult = result.result;
      botUsername = (result.result.username || botUsername).replace(/^@/, '');
      botFirstName = result.result.first_name || '';
      isConnected = true;

      // Sync botUsername to settings so it's always persisted
      if (botUsername && settings && settings.botUsername !== botUsername) {
        storage.updateSettings({ botUsername, botToken: token }).catch(() => {});
      }
    } else if (botUsername) {
      isConnected = true;
    }
  } catch (err: any) {
    console.warn('[Telegram /bot/info] Notice fetching profile:', err?.message || err);
    if (botUsername) {
      isConnected = true;
    }
  }

  const cleanHandle = botUsername ? `@${botUsername}` : '';
  const displayName = cleanHandle || (botFirstName ? botFirstName : (isConnected ? 'Telegram Bot' : ''));

  const isManuallyStopped = TelegramService.isManuallyStopped() || Boolean(settings?.botStopped);
  const responsePayload = {
    ok: isConnected,
    isMain: true,
    botId: 'main',
    botMode: settings?.botMode === 'post_bot' ? 'post_bot' : 'file_bot',
    hasToken: Boolean(token),
    isConnected: isManuallyStopped ? false : isConnected,
    botStatus: isManuallyStopped ? 'stopped' : 'active',
    pollingActive: TelegramService.isPollingActive(),
    lockConflict: BotSingletonLock.getConflict('main'),
    botName: botFirstName || cleanHandle,
    botUsername: botUsername || (rawResult?.username ? String(rawResult.username).replace(/^@/, '') : ''),
    botFirstName,
    displayName,
    result: rawResult || (botUsername ? { username: botUsername, first_name: botFirstName || botUsername } : null)
  };

  cachedBotInfoPayload = {
    data: responsePayload,
    expiresAt: Date.now() + 20000, // 20s TTL
    token
  };

  return res.json(responsePayload);
});

// GET /api/bot/status - Dynamic bot connection and polling status check
apiRouter.get('/bot/status', async (_req: Request, res: Response) => {
  const settings = await storage.getSettings().catch(() => null);
  const token = await TelegramService.getBotToken().catch(() => '');
  const isPolling = TelegramService.isPollingActive();

  let botUsername = settings?.botUsername || '';
  let botFirstName = '';
  let isConnected = false;

  if (token) {
    try {
      const me = await TelegramService.callTelegramApi('getMe', {});
      if (me?.ok && me.result) {
        isConnected = true;
        botUsername = me.result.username || botUsername;
        botFirstName = me.result.first_name || '';
        if (botUsername && settings && botUsername !== settings.botUsername) {
          await storage.updateSettings({ botUsername }).catch(() => {});
        }
      } else if (botUsername) {
        isConnected = true;
      }
    } catch {
      if (botUsername) {
        isConnected = true;
      }
    }
  }

  return res.json({
    hasToken: Boolean(token),
    isConnected,
    isPolling,
    botUsername,
    botFirstName,
    displayName: botFirstName || (botUsername ? `@${botUsername}` : (isConnected ? 'Telegram Bot' : ''))
  });
});

// ============================================================================
// BROADCAST NOTIFICATION SYSTEM (Rich Media: Photo, Video, Audio, Voice, Text)
// ============================================================================

// POST /api/broadcast (Send broadcast message to all bot users)
apiRouter.post('/broadcast', authenticate, handleMulterSingle('media'), async (req: Request, res: Response) => {
  try {
    const { message, mediaType = 'text', mediaUrl, pinMessage } = req.body;
    const isPinned = pinMessage === true || pinMessage === 'true';
    const mType = (['text', 'photo', 'video', 'audio', 'voice'].includes(mediaType) ? mediaType : 'text') as 'text' | 'photo' | 'video' | 'audio' | 'voice';

    if (mType === 'text' && (!message || String(message).trim().length === 0)) {
      return res.status(400).json({ error: 'Notification message text is required' });
    }

    if (mType !== 'text' && !req.file && (!mediaUrl || String(mediaUrl).trim().length === 0)) {
      return res.status(400).json({ error: 'Please select a media file to upload or enter a media URL' });
    }

    const botUsers = await storage.getBotUsers();
    const activeUsers = botUsers.filter(u => !u.isBanned);
    const admins = await storage.getAdmins();
    const settings = await storage.getSettings();
    const recipientIds = new Set<string>();

    for (const u of activeUsers) {
      if (u.id) recipientIds.add(String(u.id).trim());
    }
    for (const a of admins) {
      const aid = String(a.telegramId || a.id).trim();
      if (aid) recipientIds.add(aid);
    }
    if (settings.rootAdminId) {
      recipientIds.add(String(settings.rootAdminId).trim());
    }

    const targets = Array.from(recipientIds);
    if (targets.length === 0) {
      return res.json({
        success: true,
        total: 0,
        sent: 0,
        failed: 0,
        message: 'No registered bot users found to broadcast to.'
      });
    }

    let sentCount = 0;
    let failedCount = 0;
    let cachedTelegramFileId: string | undefined = mediaUrl ? String(mediaUrl).trim() : undefined;

    for (let i = 0; i < targets.length; i++) {
      const targetChatId = targets[i];

      try {
        const sendResult = await TelegramService.sendBroadcastMessage({
          chatId: targetChatId,
          message: message ? String(message) : undefined,
          mediaType: mType,
          mediaUrl: cachedTelegramFileId,
          fileBuffer: (req.file && !cachedTelegramFileId) ? req.file.buffer : undefined,
          fileName: req.file?.originalname,
          mimeType: req.file?.mimetype,
          pinMessage: isPinned
        });

        if (sendResult.ok) {
          sentCount++;
          if (sendResult.fileId && !cachedTelegramFileId) {
            cachedTelegramFileId = sendResult.fileId;
          }
        } else {
          failedCount++;
          console.warn(`[Broadcast] Delivery failed for ${targetChatId}:`, sendResult.description);
        }
      } catch (err: any) {
        failedCount++;
        console.warn(`[Broadcast] Error sending to ${targetChatId}:`, err?.message);
      }

      if (i < targets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    }

    return res.json({
      success: true,
      total: targets.length,
      sent: sentCount,
      failed: failedCount,
      message: `Broadcast successfully sent to ${sentCount} out of ${targets.length} users.`
    });
  } catch (err: any) {
    console.error('[Broadcast] Exception during broadcast:', err);
    return res.status(500).json({ error: err.message || 'Broadcast failed' });
  }
});

// POST /api/broadcast/test (Send a single test notification to current admin)
apiRouter.post('/broadcast/test', authenticate, handleMulterSingle('media'), async (req: Request, res: Response) => {
  try {
    const admin = (req as any).admin as AdminUser;
    const settings = await storage.getSettings();
    const adminChatId = admin.telegramId || (admin as any).id || settings.rootAdminId || process.env.ROOT_ADMIN_ID;

    if (!adminChatId) {
      return res.status(400).json({ error: 'No Telegram ID found for current admin to receive test message' });
    }

    const { message, mediaType = 'text', mediaUrl, pinMessage } = req.body;
    const isPinned = pinMessage === true || pinMessage === 'true';
    const mType = (['text', 'photo', 'video', 'audio', 'voice'].includes(mediaType) ? mediaType : 'text') as 'text' | 'photo' | 'video' | 'audio' | 'voice';

    const sendResult = await TelegramService.sendBroadcastMessage({
      chatId: adminChatId,
      message: message ? String(message) : undefined,
      mediaType: mType,
      mediaUrl: mediaUrl ? String(mediaUrl).trim() : undefined,
      fileBuffer: req.file ? req.file.buffer : undefined,
      fileName: req.file?.originalname,
      mimeType: req.file?.mimetype,
      pinMessage: isPinned
    });

    if (sendResult.ok) {
      return res.json({ success: true, message: `Test message sent to Telegram ID ${adminChatId}!` });
    } else {
      return res.status(400).json({ error: sendResult.description || 'Failed to send test message via Telegram API' });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Test broadcast failed' });
  }
});

// ============================================================================
// MESSAGE CLEANUP
// ============================================================================

// GET /api/cleanup/status
apiRouter.get('/cleanup/status', authenticate, async (_req: Request, res: Response) => {
  const count = await storage.getTrackedCount();
  const settings = await storage.getSettings();
  const scheduledDeletions = await storage.getScheduledDeletions();
  return res.json({
    trackedMessagesCount: count,
    maxLimitPerChat: settings.maxBotMessagesPerChat,
    dailyCleanupEnabled: settings.dailyCleanupEnabled,
    cleanupAgeHours: settings.cleanupAgeHours,
    autoDeleteDeliveryEnabled: settings.autoDeleteDeliveryEnabled !== false,
    deliveryTimeoutMinutes: settings.deliveryTimeoutMinutes || 10,
    autoDeleteNoticeEnabled: settings.autoDeleteNoticeEnabled !== false,
    pendingScheduledDeletionsCount: scheduledDeletions.length,
    scheduledDeletions
  });
});

// POST /api/cleanup/run
apiRouter.post('/cleanup/run', authenticate, requirePermission('cleanup_manage'), async (req: Request, res: Response) => {
  const settings = await storage.getSettings();
  const hours = req.body.hours ? Number(req.body.hours) : (settings.cleanupAgeHours || 24);
  const toDelete = await storage.getMessagesOlderThan(hours);

  let deletedCount = 0;
  for (const item of toDelete) {
    const res = await TelegramService.callTelegramApi('deleteMessage', {
      chat_id: item.chatId,
      message_id: item.messageId
    });
    if (res.ok) deletedCount++;
  }

  return res.json({
    success: true,
    scanned: toDelete.length,
    deleted: deletedCount,
    message: `Cleaned ${deletedCount} messages older than ${hours} hours`
  });
});

// ============================================================================
// SIMULATOR (LIVE TELEGRAM SIMULATOR)
// ============================================================================

apiRouter.post('/simulate', authenticate, async (req: Request, res: Response) => {
  const { input, chatType = 'group' } = req.body;
  if (!input) {
    return res.status(400).json({ error: 'Input text is required' });
  }

  const cleanInput = String(input).trim();

  // Check /filters command simulation
  const isFilters = /^(?:\/|#)?(?:filters|filter|keywords)(?:@\w+)?$/i.test(cleanInput);
  if (isFilters) {
    const items = await storage.getItems();
    const filterItems = items.filter((item) => item.status === 'active' && item.inFiltersList === true);
    const templates = await storage.getTemplates();
    const botUsername = await TelegramService.getBotUsername();

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

    const uniqueTags = Array.from(new Set(hashtags)).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    const defaultTpl = "📁 Quick File Keywords\nType any of these (in a group or here) and I'll DM you the file:\n\n{keywords}";
    const rawTpl = templates.FILTERS_MESSAGE?.content || defaultTpl;
    const cleanTpl = rawTpl
      .replace(/<b>(.*?)<\/b>/gi, '$1')
      .replace(/<i>(.*?)<\/i>/gi, '$1')
      .replace(/<code>(.*?)<\/code>/gi, '$1');

    const formattedBotName = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'Bot';
    const textKeywords = uniqueTags.length > 0 ? uniqueTags.join('\n') : '(No file keywords added to filters yet)';
    const responseText = cleanTpl
      .replace(/\{keywords\}/g, textKeywords)
      .replace(/\{bot_name\}/g, formattedBotName);

    // User request: No inline buttons under filter keywords
    const buttons: any[] = [];

    return res.json({
      matched: true,
      input: cleanInput,
      chatType,
      isFilters: true,
      keywords: uniqueTags,
      botResponse: {
        isReplyToMessage: chatType === 'group',
        text: responseText,
        keywords: uniqueTags,
        buttons
      }
    });
  }

  // Check /allfile or /allfiles command simulation (defaults to Page 1 with no arguments)
  const allFileCmd = TelegramService.parseAllFileCommand(cleanInput);
  if (allFileCmd.matched) {
    await storage.loadLatest(false);
    if (storage.getItemsFast().length === 0) {
      await storage.loadLatest(true).catch(() => {});
    }
    const view = TelegramService.buildFilesListView(allFileCmd.page);
    return res.json({
      matched: true,
      input: cleanInput,
      chatType,
      isAllFile: true,
      page: view.page,
      totalPages: view.totalPages,
      totalItems: view.totalItems,
      botResponse: {
        isReplyToMessage: true,
        text: view.text.replace(/<[^>]+>/g, ''),
        buttons: view.inlineKeyboard.flat()
      }
    });
  }

  const matchedItem = await storage.findItemByTrigger(cleanInput);
  const templates = await storage.getTemplates();
  const botUsername = await TelegramService.getBotUsername();

  if (!matchedItem) {
    if (cleanInput.toLowerCase() === '/add' || cleanInput.toLowerCase().startsWith('/add@')) {
      return res.json({
        matched: true,
        input: cleanInput,
        chatType,
        item: null,
        botResponse: {
          isReplyToMessage: false,
          text: '📥 <b>Interactive Bot Menu: What would you like to add?</b>\n\nChoose an option below or send your file or link directly:\n• <b>File:</b> Document, Photo, Video, Audio\n• <b>Link:</b> Web Link (URL)',
          buttons: [
            { text: 'Add File', callback_data: 'add_choose_file', style: 'primary' },
            { text: 'Add Link', callback_data: 'add_choose_link', style: 'primary' },
            { text: 'Cancel', callback_data: 'cancel_add', style: 'danger' }
          ]
        }
      });
    }

    if (chatType === 'private' && (cleanInput.toLowerCase() === '/start' || cleanInput.toLowerCase().startsWith('/start@'))) {
      let startMsg = templates.START_MESSAGE?.content || '👋 Welcome {user_name}! Use configured group triggers to receive files and links privately.';
      startMsg = startMsg
        .replace(/\{user_name\}/g, 'SimulatedUser')
        .replace(/\{user_id\}/g, '888000111')
        .replace(/\{bot_name\}/g, botUsername || '@MyBot');
      return res.json({
        matched: true,
        input: cleanInput,
        chatType,
        item: null,
        botResponse: {
          isReplyToMessage: false,
          text: startMsg,
          buttons: []
        }
      });
    }

    return res.json({
      matched: false,
      input: cleanInput,
      chatType,
      botResponse: null,
      reason: 'No response. The bot remains completely silent for unconfigured triggers.'
    });
  }

  if (chatType === 'group') {
    const tpl = matchedItem.type === 'file' ? templates.GROUP_FILE_REPLY : templates.GROUP_LINK_REPLY;
    const btnTpl = matchedItem.type === 'file' ? templates.GET_FILE_BUTTON : templates.GET_LINK_BUTTON;

    const replyText = (tpl?.content || "👇 Tap below — I'll send your file privately.")
      .replace('{user_name}', 'SimulatedUser')
      .replace('{user_id}', '888000111')
      .replace('{trigger}', cleanInput)
      .replace('{file_name}', matchedItem.fileName || matchedItem.name)
      .replace('{title}', matchedItem.name);

    const payload = matchedItem.id.startsWith('f_') || matchedItem.id.startsWith('l_')
      ? matchedItem.id
      : `${matchedItem.type === 'file' ? 'f_' : 'l_'}${matchedItem.id}`;
    const cleanBotUsername = botUsername.replace(/^@/, '');
    const deepLink = `https://t.me/${cleanBotUsername}?start=${payload}`;

    return res.json({
      matched: true,
      input: cleanInput,
      chatType,
      item: matchedItem,
      botResponse: {
        isReplyToMessage: true,
        text: replyText,
        buttons: [
          {
            text: (btnTpl?.content || (matchedItem.type === 'file' ? 'Get File Privately' : 'Open Privately')).replace(/^🔒\s*/, ''),
            url: deepLink,
            deepLinkPayload: payload,
            style: 'primary'
          }
        ]
      },
      privateDeliveryPreview: {
        type: matchedItem.type,
        caption: matchedItem.caption || null,
        fileName: matchedItem.fileName,
        fileType: matchedItem.fileType,
        url: matchedItem.url,
        openMode: matchedItem.openMode,
        buttonText: matchedItem.buttonText,
        replyMessage: matchedItem.replyMessage
      }
    });
  } else {
    // Private chat simulation
    return res.json({
      matched: true,
      input: cleanInput,
      chatType,
      item: matchedItem,
      botResponse: {
        text: 'In private chat, content is delivered directly via deep link (/start payload).'
      }
    });
  }
});

// ============================================================================
// TELEGRAM WEBHOOK INGRESS
// ============================================================================

apiRouter.post('/telegram-webhook', async (req: Request, res: Response) => {
  try {
    const update = req.body;
    if (TelegramService.isManuallyStopped()) {
      return res.status(200).json({ ok: true, status: 'ignored_bot_stopped' });
    }
    // Strict safeguard: if polling worker is currently active, ignore webhook to eliminate duplicate message processing
    if (TelegramService.isPollingActive()) {
      return res.status(200).json({ ok: true, status: 'ignored_polling_active' });
    }

    // Process update asynchronously and return 200 immediately to Telegram
    TelegramService.handleUpdate(update).catch(err => {
      console.error('[Webhook] Update processing failed:', err);
    });
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[Webhook] Error:', err);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
});

// ============================================================================
// BACKUP SERVER & REAL-TIME REPLICATION ENDPOINTS
// ============================================================================

// 1. Silent Mirror Receiver (Protected by x-replication-token)
apiRouter.post('/backup-server/receive-mirror', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-replication-token'] as string;
    const config = await storage.getBackupConfig();

    if (!token || !config.secretKey || token.trim() !== config.secretKey.trim()) {
      return res.status(401).json({ error: 'Unauthorized: Invalid replication handshake token' });
    }

    const { snapshot, stats } = req.body;
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid snapshot payload' });
    }

    console.info(`[BackupServer] Receiving mirror snapshot from primary server...`);
    const result = await storage.restoreFromSnapshot(snapshot);

    return res.status(200).json({
      success: true,
      message: 'Mirror snapshot successfully accepted and saved into silent backup vault.',
      restored: result.restoredCounts,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[BackupServer] Error processing mirror snapshot:', err);
    return res.status(500).json({ error: err.message || 'Failed to process mirror snapshot' });
  }
});

// 2. Ping Healthcheck for replication handshake (Protected by x-replication-token)
apiRouter.get('/backup-server/ping', async (req: Request, res: Response) => {
  const token = req.headers['x-replication-token'] as string;
  const config = await storage.getBackupConfig();

  if (!token || !config.secretKey || token.trim() !== config.secretKey.trim()) {
    return res.status(401).json({ error: 'Unauthorized: Invalid replication handshake token' });
  }

  return res.status(200).json({
    status: 'ok',
    role: config.role,
    failoverActive: Boolean(config.failoverActive),
    timestamp: Date.now()
  });
});

// 3. Get Backup Server Status (Admin authenticated)
apiRouter.get('/backup-server/status', authenticate, async (_req: Request, res: Response) => {
  try {
    const config = await storage.getBackupConfig();
    const fullDb = await storage.getFullSnapshot(false);

    const localStats = {
      itemsCount: fullDb.items?.length || 0,
      usersCount: Object.keys(fullDb.botUsers || {}).length,
      filesCount: Object.keys(fullDb.uploadedFilesIndex || {}).length,
      reportsCount: fullDb.reports?.length || 0,
      rulesCount: fullDb.fraudRules?.length || 0,
      templatesCount: Object.keys(fullDb.templates || {}).length,
      channelsCount: fullDb.detectedChannels?.length || 0
    };

    return res.json({
      config,
      localStats,
      serverTime: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get backup status' });
  }
});

// 4. Update Backup Server Configuration (Admin authenticated)
apiRouter.post('/backup-server/config', authenticate, async (req: Request, res: Response) => {
  try {
    const { enabled, serverUrl, secretKey, role, autoSyncOnSave, syncIntervalMinutes } = req.body;
    const updated = await storage.updateBackupConfig({
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(serverUrl !== undefined ? { serverUrl: String(serverUrl).trim() } : {}),
      ...(secretKey !== undefined ? { secretKey: String(secretKey).trim() } : {}),
      ...(role !== undefined ? { role: role === 'backup' ? 'backup' : 'primary' } : {}),
      ...(autoSyncOnSave !== undefined ? { autoSyncOnSave: Boolean(autoSyncOnSave) } : {}),
      ...(syncIntervalMinutes !== undefined ? { syncIntervalMinutes: Number(syncIntervalMinutes) || 5 } : {})
    });

    return res.json({ success: true, config: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update backup config' });
  }
});

// 5. Trigger Immediate Sync to Backup Server (Admin authenticated)
apiRouter.post('/backup-server/sync-now', authenticate, async (_req: Request, res: Response) => {
  try {
    const result = await storage.replicateToBackupServer();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

// 6. Test Handshake Connection to Designated Backup Server (Admin authenticated)
apiRouter.post('/backup-server/test-connection', authenticate, async (req: Request, res: Response) => {
  try {
    const config = await storage.getBackupConfig();
    const targetUrl = (req.body.serverUrl || config.serverUrl || '').trim().replace(/\/+$/, '');
    const targetSecret = (req.body.secretKey || config.secretKey || '').trim();

    if (!targetUrl) {
      return res.status(400).json({ error: 'Please enter a target backup server URL' });
    }

    const endpoint = `${targetUrl}/api/backup-server/ping`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const startTime = Date.now();
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-replication-token': targetSecret
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = await response.text();
      return res.status(400).json({
        success: false,
        error: `Connection handshake failed (HTTP ${response.status}): ${errText.slice(0, 100)}`,
        latencyMs
      });
    }

    const data = await response.json().catch(() => ({}));
    return res.json({
      success: true,
      message: 'Connection successful! Backup server is online and authenticated.',
      latencyMs,
      backupServerRole: data.role || 'unknown'
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: `Could not connect to backup server: ${err.message || 'Network unreachable'}`
    });
  }
});

// 7. Failover Switch / Promote Role (Admin authenticated)
apiRouter.post('/backup-server/failover/switch-role', authenticate, async (req: Request, res: Response) => {
  try {
    const config = await storage.getBackupConfig();
    const targetRole = req.body.role || (config.role === 'primary' ? 'backup' : 'primary');
    const isPromotingToPrimary = targetRole === 'primary';

    const updated = await storage.updateBackupConfig({
      role: targetRole,
      failoverActive: isPromotingToPrimary
    });

    if (isPromotingToPrimary) {
      console.info('[Failover] Promoting server to Active Primary! Initializing bot worker...');
      await TelegramService.initPollingWorker();
    } else {
      console.info('[Failover] Switching server to Silent Backup mirror. Halting bot polling...');
      TelegramService.stopPolling();
    }

    return res.json({
      success: true,
      message: isPromotingToPrimary
        ? 'Failover activated! This server is now the Active Primary and bot operations have resumed.'
        : 'Server switched to Silent Standby Mirror mode.',
      config: updated
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to switch role' });
  }
});

// 8. Download standalone snapshot archive (Admin authenticated)
apiRouter.get('/backup-server/export-snapshot', authenticate, async (_req: Request, res: Response) => {
  try {
    const snapshot = await storage.getFullSnapshot(true);
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="bot-backup-snapshot-${dateStr}.json"`);
    return res.send(JSON.stringify(snapshot, null, 2));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to export snapshot' });
  }
});

// 9. Restore standalone snapshot archive (Admin authenticated)
apiRouter.post('/backup-server/restore-snapshot', authenticate, async (req: Request, res: Response) => {
  try {
    const snapshot = req.body.snapshot || req.body;
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ error: 'Invalid snapshot data' });
    }
    const result = await storage.restoreFromSnapshot(snapshot);
    return res.json({
      success: true,
      message: 'Snapshot successfully restored into database.',
      counts: result.restoredCounts
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to restore snapshot' });
  }
});
