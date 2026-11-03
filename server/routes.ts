import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import dotenv from 'dotenv';
import { storage, AdminUser, ItemRecord, TriggerType, OpenMode } from './storage';
import { TelegramService, getItemPayload } from './telegram';
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from './auth';

dotenv.config({ override: true });

export const apiRouter = Router();

// Lightweight Health check endpoint for network monitoring and offline detection
apiRouter.all('/health', async (_req: Request, res: Response) => {
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
      isPolling: TelegramService.isPollingActive()
    }
  });
});

// Multer upload middleware for direct binary/multipart file streaming (up to 200MB)
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB limit
  }
});

// Middleware to authenticate session via HTTP-only cookie or Bearer token
async function authenticate(req: Request, res: Response, next: NextFunction) {
  const rawHeader = req.cookies?.tg_admin_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!rawHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Verify HMAC signature if token was signed, or fallback to raw token for backward compatibility
  const verifiedToken = verifySessionToken(rawHeader) || rawHeader;

  const session = await storage.getSession(verifiedToken);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  const admin = await storage.getAdmin(session.adminId);
  if (!admin || !admin.enabled) {
    return res.status(401).json({ error: 'Admin account disabled or not found' });
  }

  (req as any).admin = admin;
  (req as any).session = session;
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

// ============================================================================
// AUTHENTICATION
// ============================================================================

// POST /api/auth/login
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const telegramId = req.body.telegramId || req.body.username || req.body.adminName;
  const { password } = req.body;
  if (!telegramId || !password) {
    return res.status(400).json({ error: 'Admin Name and password required' });
  }

  const cleanId = String(telegramId).trim().replace(/^@/, '');
  const cleanPassword = String(password).trim();
  console.info('[Auth] Admin login attempt for identifier/name:', cleanId);

  // Force-reload fresh data from persistent storage
  await storage.loadLatest(true);

  // Reload latest environment variables if .env was changed
  try {
    dotenv.config({ override: true });
  } catch {}

  // Read environment variables for Admin Name and Password
  const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();
  const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ROOT_ADMIN_PASSWORD || '').trim();
  const envRootId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '').trim();

  const cleanNormalized = cleanId.replace(/\s+/g, '').toLowerCase();
  const envNameNormalized = envAdminName.replace(/\s+/g, '').toLowerCase();

  const isEnvNameMatch = !!envAdminName && (
    cleanId.toLowerCase() === envAdminName.toLowerCase() ||
    cleanNormalized === envNameNormalized
  );
  const isEnvRootMatch = !!envRootId && cleanId === envRootId;
  const isEnvPasswordMatch = !!envAdminPassword && cleanPassword === envAdminPassword;

  const allAdmins = await storage.getAdmins();

  // 1. First, search for admin by exact or normalized ID/name
  let admin = await storage.getAdmin(cleanId);

  // 2. If not found by getAdmin, check if cleanId matches owner aliases or env name
  if (!admin) {
    const isOwnerAlias = ['admin', 'owner', 'owner admin', 'owneradmin', 'root', 'sohan'].includes(cleanNormalized);
    if (isOwnerAlias || isEnvNameMatch || isEnvRootMatch) {
      admin = allAdmins.find(a => a.role === 'owner') || null;
    }
  }

  // 3. If there is only one admin/owner account in the entire system, any valid entered identifier resolves to that owner
  if (!admin && allAdmins.length === 1 && allAdmins[0].role === 'owner') {
    admin = allAdmins[0];
  }

  // 4. Fallback search across all admins
  if (!admin) {
    for (const a of allAdmins) {
      if (
        String(a.id).trim() === cleanId ||
        String(a.telegramId).trim() === cleanId ||
        (a.name && a.name.trim().toLowerCase() === cleanId.toLowerCase()) ||
        (a.name && a.name.replace(/\s+/g, '').toLowerCase() === cleanNormalized)
      ) {
        admin = a;
        break;
      }
    }
  }

  // 5. If still no admin exists in the system, initialize Owner Admin from entered credentials
  if (!admin) {
    if (allAdmins.length === 0 || (isEnvPasswordMatch && (isEnvNameMatch || !envAdminName))) {
      console.info('[Auth] Initializing Owner Admin account from credentials/ENV:', cleanId);
      const hash = await hashPassword(cleanPassword);
      const newOwner: AdminUser = {
        id: envRootId || cleanId || '8153757163',
        telegramId: envRootId || cleanId || '8153757163',
        name: envAdminName || cleanId || 'Owner Admin',
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
      await storage.saveAdmin(newOwner);
      admin = newOwner;
    }
  }

  if (!admin || !admin.enabled) {
    console.warn('[Auth] Login failed: admin account not found or disabled for identifier/name:', cleanId);
    return res.status(401).json({ error: 'Invalid Admin Name or account not found' });
  }

  // Verify password: check stored hash, env password, and fallback defaults ('123456' / 'admin')
  let validPassword = await verifyPassword(cleanPassword, admin.passwordHash);

  if (!validPassword && isEnvPasswordMatch) {
    validPassword = true;
  }

  if (!validPassword && admin.role === 'owner') {
    if (cleanPassword === '123456' || cleanPassword === 'admin') {
      validPassword = true;
    }
  }

  // Sync hash if password was validated via ENV or default
  if (validPassword && isEnvPasswordMatch && admin.role === 'owner') {
    admin.passwordHash = await hashPassword(envAdminPassword);
    if (envAdminName) {
      admin.name = envAdminName;
    }
    await storage.saveAdmin(admin);
  }

  if (!validPassword) {
    console.warn('[Auth] Login failed: incorrect password for identifier/name:', cleanId);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  console.info('[Auth] Login successful for identifier/name:', cleanId);

  // Create session
  const rawToken = await storage.createSession(admin.id, admin.role);
  const signedToken = signSessionToken(rawToken);

  // Set secure cookie with SameSite: None for seamless iframe support
  res.cookie('tg_admin_session', signedToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  });

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  return res.json({
    success: true,
    token: signedToken,
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      role: admin.role,
      permissions: admin.permissions
    }
  });
});

// POST /api/auth/validate-credentials (Real-time credentials checking without creating a session)
apiRouter.post('/auth/validate-credentials', async (req: Request, res: Response) => {
  const { telegramId, username, password } = req.body;
  const rawId = (username !== undefined && String(username).trim() !== '') ? username : telegramId;
  if (!rawId || password === undefined || password === null) {
    return res.json({ valid: false });
  }

  const cleanId = String(rawId).trim().replace(/^@/, '');
  const cleanPassword = String(password).trim();
  if (!cleanId || !cleanPassword) {
    return res.json({ valid: false });
  }

  try {
    dotenv.config({ override: true });
  } catch {}

  const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();
  const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ROOT_ADMIN_PASSWORD || '').trim();
  const envRootId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '').trim();

  const cleanNormalized = cleanId.replace(/\s+/g, '').toLowerCase();
  const envNameNormalized = envAdminName.replace(/\s+/g, '').toLowerCase();

  const isEnvNameMatch = !!envAdminName && (
    cleanId.toLowerCase() === envAdminName.toLowerCase() ||
    cleanNormalized === envNameNormalized
  );
  const isEnvRootMatch = !!envRootId && cleanId === envRootId;
  const isEnvPasswordMatch = !!envAdminPassword && cleanPassword === envAdminPassword;

  // 1. Root / Environment match
  if (isEnvPasswordMatch && (isEnvNameMatch || isEnvRootMatch || cleanNormalized === 'admin' || cleanNormalized === 'owner')) {
    return res.json({ valid: true });
  }

  // 2. Lookup existing admin in database
  await storage.loadLatest(true);
  const allAdmins = await storage.getAdmins();

  let admin = await storage.getAdmin(cleanId);
  if (!admin) {
    const isOwnerAlias = ['admin', 'owner', 'owner admin', 'owneradmin', 'root', 'sohan'].includes(cleanNormalized);
    if (isOwnerAlias || isEnvNameMatch || isEnvRootMatch) {
      admin = allAdmins.find(a => a.role === 'owner') || null;
    }
  }

  if (!admin && allAdmins.length === 1 && allAdmins[0].role === 'owner') {
    admin = allAdmins[0];
  }

  if (!admin) {
    if (allAdmins.length === 0 && cleanPassword.length >= 4) {
      return res.json({ valid: true, isFirstAdmin: true });
    }
    return res.json({ valid: false });
  }

  if (!admin.enabled) {
    return res.json({ valid: false });
  }

  let validPassword = await verifyPassword(cleanPassword, admin.passwordHash);
  if (!validPassword && (isEnvPasswordMatch || (admin.role === 'owner' && (cleanPassword === '123456' || cleanPassword === 'admin')))) {
    validPassword = true;
  }

  return res.json({ valid: validPassword });
});

// POST /api/auth/firebase-login (Firebase Authentication Session Creator)
apiRouter.post('/auth/firebase-login', async (req: Request, res: Response) => {
  const { idToken, email, displayName } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  
  if (!cleanEmail) {
    return res.status(400).json({ error: 'Email is required for authentication' });
  }

  // Reload admins
  await storage.loadLatest(true);
  const allAdmins = await storage.getAdmins();
  const rootAdminId = String(process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '8153757163').trim();
  const rootAdminName = (process.env.ADMIN_NAME || 'Owner Admin').trim();
  // Strict Whitelist Check for Admin Access (sohanrahman07565@gmail.com or configured admin email)
  const configuredWhitelistedEmails = new Set<string>([
    'sohanrahman07565@gmail.com',
    ...(process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL.toLowerCase().trim()] : [])
  ]);

  // Include any emails explicitly configured in existing admin records
  for (const a of allAdmins) {
    if (a.name && a.name.includes('@')) {
      configuredWhitelistedEmails.add(a.name.toLowerCase().trim());
    }
  }

  const isWhitelisted = configuredWhitelistedEmails.has(cleanEmail) || cleanEmail === 'sohanrahman07565@gmail.com';

  if (!isWhitelisted) {
    console.warn('[Firebase Auth] Strict whitelist rejection for unauthorized email:', cleanEmail);
    return res.status(403).json({ 
      error: `Access Denied: Account (${cleanEmail}) is not authorized. Only designated administrators can access this panel.` 
    });
  }

  const isOwnerEmail = cleanEmail === 'sohanrahman07565@gmail.com';

  // Find matching admin by email or name
  let admin = allAdmins.find(a => 
    (a.name && a.name.toLowerCase() === cleanEmail) ||
    (a.telegramId && a.telegramId.toLowerCase() === cleanEmail) ||
    (a.id && a.id.toLowerCase() === cleanEmail)
  );

  // If owner email or first admin in the system, authorize as owner
  if (!admin) {
    if (isOwnerEmail || allAdmins.length === 0) {
      console.info('[Firebase Auth] Auto-provisioning Owner Admin for:', cleanEmail);
      const newOwner: AdminUser = {
        id: rootAdminId || '8153757163',
        telegramId: rootAdminId || '8153757163',
        name: displayName || rootAdminName || cleanEmail.split('@')[0],
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
  }

  if (!admin) {
    // If only one owner admin exists, associate with that owner
    const owner = allAdmins.find(a => a.role === 'owner');
    if (owner && isOwnerEmail) {
      admin = owner;
    }
  }

  if (!admin || !admin.enabled) {
    console.warn('[Firebase Auth] Access denied for email:', cleanEmail);
    return res.status(403).json({ error: 'Access Denied: This email is not authorized as an administrator.' });
  }

  // Create session
  const rawToken = await storage.createSession(admin.id, admin.role);
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  });

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  console.info('[Firebase Auth] Session successfully created for admin:', admin.name, admin.role);

  return res.json({
    success: true,
    token: signedToken,
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      role: admin.role,
      permissions: admin.permissions
    }
  });
});

// POST /api/auth/logout
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const rawHeader = req.cookies?.tg_admin_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (rawHeader) {
    const verifiedToken = verifySessionToken(rawHeader) || rawHeader;
    await storage.deleteSession(verifiedToken);
  }
  res.clearCookie('tg_admin_session');
  return res.json({ success: true, message: 'Logged out' });
});

// GET /api/auth/me
apiRouter.get('/auth/me', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  return res.json({
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      role: admin.role,
      permissions: admin.permissions
    }
  });
});

// POST /api/auth/forgot-password (Validates WebCode from /webcode command)
apiRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  const { telegramId, code, newPassword } = req.body;
  if (!telegramId || !code || !newPassword) {
    return res.status(400).json({ error: 'Telegram ID, verification code, and new password are required' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const cleanId = String(telegramId).trim();
  const cleanCode = String(code).trim();
  console.info('[Auth] Forgot-password reset attempt for telegramId:', cleanId);

  // Force-reload fresh data from persistent storage
  await storage.loadLatest(true);

  const isValidCode = await storage.verifyAndConsumeWebCode(cleanId, cleanCode);
  if (!isValidCode) {
    console.warn('[Auth] Forgot-password failed: invalid or expired verification code for telegramId:', cleanId);
    return res.status(400).json({ error: 'Invalid or expired verification code. Use /webcode in Telegram to get a fresh code.' });
  }

  const admin = await storage.getAdmin(cleanId);
  if (!admin) {
    console.warn('[Auth] Forgot-password failed: admin account not found for telegramId:', cleanId);
    return res.status(404).json({ error: 'Admin account not found' });
  }

  admin.passwordHash = await hashPassword(String(newPassword));
  const saved = await storage.saveAdmin(admin);
  if (!saved) {
    console.error('[Auth] Failed to persist new password during reset for telegramId:', cleanId);
    return res.status(500).json({ error: 'Storage error saving new password' });
  }

  console.info('[Auth] Password successfully reset for telegramId:', cleanId);
  return res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
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

// Helper to verify Telegram authentication data and check admin whitelist
async function verifyAndAuthorizeTelegramUser(tgUser: any): Promise<{ ok: boolean; admin?: AdminUser; error?: string; statusCode?: number }> {
  if (!tgUser || !tgUser.id) {
    return { ok: false, error: 'Telegram account information is required', statusCode: 400 };
  }

  // Force-reload fresh data from persistent storage
  await storage.loadLatest(true);
  const settings = await storage.getSettings();
  const botToken = process.env.TELEGRAM_CLIENT_SECRET || process.env.TELEGRAM_BOT_TOKEN || settings.botToken || '';

  // 1. Verify Telegram cryptographic hash signature if hash and token are provided
  if (tgUser.hash && botToken) {
    try {
      const secretKey = crypto.createHash('sha256').update(botToken).digest();
      const checkArray: string[] = [];
      const keys = Object.keys(tgUser).filter(k => k !== 'hash').sort();
      for (const k of keys) {
        checkArray.push(`${k}=${tgUser[k]}`);
      }
      const dataCheckString = checkArray.join('\n');
      const calculatedHmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

      if (calculatedHmac !== tgUser.hash) {
        console.warn('[Auth] Telegram Login Hash signature verification failed for user ID:', tgUser.id);
        return { ok: false, error: 'Telegram authentication verification failed: Invalid cryptographic signature.', statusCode: 401 };
      }

      // Check auth_date expiration (within 24 hours)
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
  const rawUsername = tgUser.username ? String(tgUser.username).trim().replace(/^@/, '').toLowerCase() : '';
  const rootAdminId = String(settings.rootAdminId || process.env.ROOT_ADMIN_ID || '').trim();
  const envAdminName = String(process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
  
  const allAdmins = await storage.getAdmins();
  let admin: AdminUser | null = null;

  // Check 1: Root admin ID match
  if (rootAdminId && (userIdStr === rootAdminId || rootAdminId.includes(userIdStr))) {
    admin = allAdmins.find(a => a.role === 'owner') || null;
    if (!admin) {
      // Auto-create root owner account for this verified Telegram user
      const newOwner: AdminUser = {
        id: userIdStr,
        telegramId: userIdStr,
        name: tgUser.first_name || (rawUsername ? `@${rawUsername}` : 'Owner Admin'),
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
      await storage.saveAdmin(newOwner);
      admin = newOwner;
    }
  }

  // Check 2: Match against registered admins whitelist
  if (!admin) {
    for (const a of allAdmins) {
      const aId = String(a.id || '').trim();
      const aTgId = String(a.telegramId || '').trim();
      const aName = String(a.name || '').trim().replace(/^@/, '').toLowerCase();
      const aTgUsername = String((a as any).telegramUsername || '').trim().replace(/^@/, '').toLowerCase();

      if (aId === userIdStr || aTgId === userIdStr) {
        admin = a;
        break;
      }
      if (rawUsername && (aName === rawUsername || aTgUsername === rawUsername)) {
        admin = a;
        break;
      }
    }
  }

  // Check 3: ENV Admin Username match
  if (!admin && envAdminName && rawUsername && rawUsername === envAdminName) {
    admin = allAdmins.find(a => a.role === 'owner') || null;
  }

  // Check 4: If system has zero admins, first authenticating Telegram user becomes initial Owner Admin
  if (!admin && allAdmins.length === 0) {
    console.info('[Auth] No existing admins found. Initializing Owner Admin from Telegram account:', userIdStr);
    const newOwner: AdminUser = {
      id: userIdStr,
      telegramId: userIdStr,
      name: tgUser.first_name || (rawUsername ? `@${rawUsername}` : 'Owner Admin'),
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
    await storage.saveAdmin(newOwner);
    await storage.updateSettings({ rootAdminId: userIdStr });
    admin = newOwner;
  }

  // STRICT WHITELIST RESTRICTION:
  // If the Telegram ID is not explicitly configured and authorized as an admin, deny access completely!
  if (!admin) {
    console.warn(`[Auth] Access Denied: Telegram account ${userIdStr} (@${rawUsername || 'none'}) is NOT in the admin whitelist.`);
    return {
      ok: false,
      error: `Access Denied: Telegram account (${rawUsername ? '@' + rawUsername : 'ID: ' + userIdStr}) is not in the authorized Admin whitelist. Please contact the Owner Admin to authorize this account.`,
      statusCode: 403
    };
  }

  if (!admin.enabled) {
    return { ok: false, error: 'Access Denied: Your administrator account has been disabled.', statusCode: 403 };
  }

  return { ok: true, admin };
}

// GET /api/auth/callback (Telegram OAuth / Login Widget Redirect Callback)
apiRouter.get('/auth/callback', async (req: Request, res: Response) => {
  const query = req.query as Record<string, string>;
  const authResult = await verifyAndAuthorizeTelegramUser(query);
  if (!authResult.ok || !authResult.admin) {
    return res.redirect('/?error=' + encodeURIComponent(authResult.error || 'Access Denied'));
  }

  const admin = authResult.admin;
  const rawToken = await storage.createSession(admin.id, admin.role);
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000
  });

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  console.info(`[Auth Callback] Verified Telegram Admin redirected in: ${admin.name} (Telegram ID: ${admin.id})`);
  return res.redirect(`/?auth_token=${encodeURIComponent(signedToken)}`);
});

// POST /api/auth/telegram-login (Telegram Login Widget / OpenID Connect with Admin Whitelist Verification)
apiRouter.post('/auth/telegram-login', async (req: Request, res: Response) => {
  const tgUser = req.body;
  const authResult = await verifyAndAuthorizeTelegramUser(tgUser);
  if (!authResult.ok || !authResult.admin) {
    return res.status(authResult.statusCode || 403).json({ error: authResult.error || 'Access Denied' });
  }

  const admin = authResult.admin;
  const rawToken = await storage.createSession(admin.id, admin.role);
  const signedToken = signSessionToken(rawToken);

  res.cookie('tg_admin_session', signedToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 12 * 60 * 60 * 1000
  });

  admin.lastLoginAt = new Date().toISOString();
  await storage.saveAdmin(admin);

  console.info(`[Auth] Verified Telegram Admin logged in: ${admin.name} (Telegram ID: ${admin.id})`);

  return res.json({
    success: true,
    token: signedToken,
    admin: {
      id: admin.id,
      telegramId: admin.telegramId,
      name: admin.name,
      role: admin.role,
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
  const admin = (req as any).admin as AdminUser | undefined;
  if (admin && (admin.telegramId || admin.id)) {
    try {
      await storage.trackBotUser({
        id: admin.telegramId || admin.id,
        firstName: admin.name || 'Admin',
        username: admin.name ? `@${admin.name.replace(/^@+/, '').trim()}` : undefined
      });
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

  const enriched = users.map(u => ({
    ...u,
    isAdmin: adminIds.has(String(u.id))
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
    const { keyword, matchType, action, duration, maxWarnings, warningText, mediaUrl, mediaType, enabled } = req.body;
    const existing = (await storage.getFraudRules()).find(r => r.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Fraud rule not found' });
    }

    const updated = await storage.saveFraudRule({
      id,
      keyword: keyword !== undefined ? String(keyword).trim() : existing.keyword,
      matchType: matchType !== undefined ? matchType : existing.matchType,
      action: action !== undefined ? action : existing.action,
      duration: duration !== undefined ? duration : (existing.duration || 'permanent'),
      maxWarnings: maxWarnings !== undefined ? Number(maxWarnings) : (existing.maxWarnings || 3),
      warningText: warningText !== undefined ? String(warningText).trim() : (existing.warningText || existing.customMessage),
      customMessage: warningText !== undefined ? String(warningText).trim() : (existing.customMessage || existing.warningText),
      mediaUrl: mediaUrl !== undefined ? String(mediaUrl).trim() : existing.mediaUrl,
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
    item.replyMessage = replyMessage || undefined;
  }

  // Setup Video System configuration
  item.hasSetupVideo = req.body.hasSetupVideo === true;
  if (item.hasSetupVideo) {
    item.setupVideoUrl = req.body.setupVideoUrl ? String(req.body.setupVideoUrl).trim() : undefined;
    item.setupVideoType = req.body.setupVideoType === 'upload' ? 'upload' : 'url';
    item.setupVideoFileName = req.body.setupVideoFileName ? String(req.body.setupVideoFileName).trim() : undefined;
    item.setupVideoButtonText = req.body.setupVideoButtonText ? String(req.body.setupVideoButtonText).trim() : '🎬 Setup Video';
    item.setupResourceButtonText = req.body.setupResourceButtonText ? String(req.body.setupResourceButtonText).trim() : (item.type === 'file' ? '📁 Get File' : '🔗 Open Link');
    item.setupVideoMessage = req.body.setupVideoMessage ? String(req.body.setupVideoMessage).trim() : undefined;
  } else {
    item.setupVideoUrl = undefined;
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
    caption: caption !== undefined ? caption : existing.caption,
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

// POST /api/items/upload (Upload direct media from phone storage/browser via multipart FormData or base64)
apiRouter.post('/items/upload', authenticate, uploadMiddleware.single('file'), async (req: Request, res: Response) => {
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
    const file = await storage.getUploadedFile(req.params.fileId);
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
    forceSubEnabled: settings.forceSubEnabled ?? false,
    requiredChannels: Array.isArray(settings.requiredChannels) ? settings.requiredChannels : [],
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
  if (deliveryTimeoutMinutes !== undefined) updates.deliveryTimeoutMinutes = Number(deliveryTimeoutMinutes) || 10;
  if (autoDeleteNoticeEnabled !== undefined) updates.autoDeleteNoticeEnabled = Boolean(autoDeleteNoticeEnabled);
  if (req.body.maintenanceMode !== undefined) updates.maintenanceMode = Boolean(req.body.maintenanceMode);
  if (req.body.maintenanceNotice !== undefined) updates.maintenanceNotice = String(req.body.maintenanceNotice).trim();
  if (forceSubEnabled !== undefined) updates.forceSubEnabled = Boolean(forceSubEnabled);
  if (req.body.autoApproveJoinRequests !== undefined) updates.autoApproveJoinRequests = Boolean(req.body.autoApproveJoinRequests);
  if (req.body.antiForwardEnabled !== undefined) updates.antiForwardEnabled = Boolean(req.body.antiForwardEnabled);
  if (requiredChannels !== undefined) {
    if (Array.isArray(requiredChannels)) {
      updates.requiredChannels = requiredChannels
        .map((c: any) => ({
          id: String(c.id || `ch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`),
          name: String(c.name || '').trim(),
          chatId: String(c.chatId || '').trim(),
          inviteLink: String(c.inviteLink || '').trim(),
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

  const newSettings = await storage.updateSettings(updates);
  return res.json({ 
    success: true, 
    settings: {
      ...newSettings,
      antiForwardEnabled: newSettings.antiForwardEnabled ?? false,
      forceSubEnabled: newSettings.forceSubEnabled ?? false,
      autoApproveJoinRequests: newSettings.autoApproveJoinRequests ?? true,
      requiredChannels: Array.isArray(newSettings.requiredChannels) ? newSettings.requiredChannels : []
    } 
  });
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

    return res.json({ success: true, result: approveRes });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to approve join request' });
  }
});

// POST /api/bot/set-webhook
apiRouter.post('/bot/set-webhook', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  const appUrl = (req.body.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) {
    return res.status(400).json({ error: 'App URL is required to set webhook' });
  }

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

// GET /api/bot/info
apiRouter.get('/bot/info', authenticate, async (_req: Request, res: Response) => {
  const result = await TelegramService.callTelegramApi('getMe', {});
  if (result?.ok && result.result?.username) {
    const settings = await storage.getSettings().catch(() => null);
    if (settings && settings.botUsername !== result.result.username) {
      await storage.updateSettings({ botUsername: result.result.username }).catch(() => {});
    }
  }
  return res.json(result);
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
apiRouter.post('/broadcast', authenticate, uploadMiddleware.single('media'), async (req: Request, res: Response) => {
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
apiRouter.post('/broadcast/test', authenticate, uploadMiddleware.single('media'), async (req: Request, res: Response) => {
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
          // STRICT RULE: Only valid hashtags starting with '#' (e.g., #box, #crack). Ignore/reject slash commands or plain text!
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
