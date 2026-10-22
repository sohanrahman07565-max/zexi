import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import dotenv from 'dotenv';
import { storage, AdminUser, ItemRecord, TriggerType, OpenMode } from './storage';
import { TelegramService, getItemPayload } from './telegram';
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from '../netlify/functions/lib/auth';

dotenv.config({ override: true });

export const apiRouter = Router();

// Lightweight Health check endpoint for network monitoring and offline detection
apiRouter.all('/health', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.status(200).json({ status: 'ok', timestamp: Date.now() });
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

  // Force-reload fresh data from shared persistent storage (Netlify Blobs / disk)
  await storage.loadLatest(true);

  // Reload latest environment variables if .env was changed
  try {
    dotenv.config({ override: true });
  } catch {}

  // Read environment variables for Admin Name and Password
  const envAdminName = (process.env.ADMIN_NAME || process.env.ADMIN_USERNAME || process.env.ROOT_ADMIN_NAME || '').trim();
  const envAdminPassword = (process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ROOT_ADMIN_PASSWORD || '').trim();
  const envRootId = (process.env.ROOT_ADMIN_ID || '').trim();

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
  const envRootId = (process.env.ROOT_ADMIN_ID || '').trim();

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

// Public info for login screen styling
apiRouter.get('/auth/login-design', async (_req: Request, res: Response) => {
  const design = await storage.getDesign();
  return res.json({
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

// GET /api/stats (Metrics including Total User Count)
apiRouter.get('/stats', authenticate, async (_req: Request, res: Response) => {
  const totalUsers = await storage.getTotalUserCount();
  const items = await storage.getItems();
  const totalDeliveries = items.reduce((acc, i) => acc + (i.deliveryCount || 0), 0);
  const totalTriggers = items.reduce((acc, i) => acc + (i.triggers?.length || 1), 0);
  const trackedCount = await storage.getTrackedCount();
  const admins = await storage.getAdmins();
  return res.json({
    totalUsers,
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
    return res.json({ success: true, user: updated });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to update user ban status' });
  }
});

// POST /api/items
apiRouter.post('/items', authenticate, async (req: Request, res: Response) => {
  const admin = (req as any).admin as AdminUser;
  const { type, name, rawKeyword, triggerType, caption, telegramFileId, uploadedFileId, fileType, fileName, fileSize, mimeType, url, openMode, buttonText, replyMessage, triggers, retentionType, retentionDays } = req.body;

  if (type === 'file' && admin.role !== 'owner' && !admin.permissions.files_add) {
    return res.status(403).json({ error: 'Permission denied: Cannot add files' });
  }
  if (type === 'link' && admin.role !== 'owner' && !admin.permissions.links_add) {
    return res.status(403).json({ error: 'Permission denied: Cannot add links' });
  }

  if (!type || !name || !rawKeyword) {
    return res.status(400).json({ error: 'Type, name, and keyword are required' });
  }

  const cleanKeyword = String(rawKeyword).replace(/^[#/]/, '').trim();
  const tType: TriggerType = triggerType || 'hashtag';
  const primaryTrigger = tType === 'hashtag' ? `#${cleanKeyword}` : tType === 'slash' ? `/${cleanKeyword}` : cleanKeyword;
  const allTriggers = Array.isArray(triggers) && triggers.length > 0 ? triggers : [primaryTrigger];

  const id = `${type === 'file' ? 'f_' : 'l_'}${Date.now().toString(36)}`;

  const item: ItemRecord = {
    id,
    type,
    name: String(name).trim(),
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

  if (type === 'file') {
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
  } else if (type === 'link') {
    item.url = url;
    item.openMode = (openMode as OpenMode) || 'browser';
    item.buttonText = buttonText || (item.openMode === 'webapp' ? '📱 Launch App' : '🌐 Open Link');
    item.replyMessage = replyMessage || undefined;
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
    inFiltersList: inFiltersList !== undefined ? inFiltersList === true : existing.inFiltersList,
    retentionType: finalRetentionType,
    retentionDays: finalRetentionDays,
    expiresAt: finalExpiresAt,
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
  if (admin.role !== 'owner' && !admin.permissions?.files_add) {
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
    const settings = await storage.getSettings();
    const candidateChat = admin.telegramId || (admin as any).id || settings.rootAdminId || process.env.ROOT_ADMIN_ID;
    let result = await TelegramService.uploadFileToTelegram(
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
  // Mask token for privacy
  const maskedToken = settings.botToken ? `${settings.botToken.substring(0, 6)}...${settings.botToken.substring(settings.botToken.length - 4)}` : '';
  return res.json({
    ...settings,
    botTokenMasked: maskedToken,
    hasToken: Boolean(settings.botToken)
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
    autoDeleteNoticeEnabled
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
  return res.json({ success: true, settings: newSettings });
});

// POST /api/bot/set-webhook
apiRouter.post('/bot/set-webhook', authenticate, requirePermission('settings_edit'), async (req: Request, res: Response) => {
  const appUrl = (req.body.appUrl || process.env.APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) {
    return res.status(400).json({ error: 'App URL is required to set webhook' });
  }

  const webhookUrl = `${appUrl}/api/telegram-webhook`;
  const result = await TelegramService.callTelegramApi('setWebhook', { url: webhookUrl });
  return res.json(result);
});

// GET /api/bot/info
apiRouter.get('/bot/info', authenticate, async (_req: Request, res: Response) => {
  const result = await TelegramService.callTelegramApi('getMe', {});
  return res.json(result);
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
