import express from 'express';
import http from 'node:http';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { apiRouter } from './server/routes';
import { storage, StorageManager } from './server/storage';
import { TelegramService, TelegramBotManager, BotSingletonLock, activeBots } from './server/telegram';

dotenv.config();

// Global 24/7 Process Guards: Prevent Node.js from exiting on network drops or unhandled promises
process.on('uncaughtException', (err: any) => {
  console.error('🛡️ [Process Guard] Caught uncaughtException (service kept online 24/7):', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('🛡️ [Process Guard] Caught unhandledRejection (service kept online 24/7):', reason?.message || reason);
});

let activeHttpServer: http.Server | null = null;
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 [Process] ${signal} received. Closing HTTP server, stopping bots & flushing storage...`);
  try {
    if (activeHttpServer) {
      activeHttpServer.close();
    }
    await Promise.race([
      Promise.allSettled([
        ...Object.values(activeBots).map((handle) => handle.stop().catch(() => {})),
        TelegramService.releaseLeaderLock().catch(() => {}),
        BotSingletonLock.releaseAll().catch(() => {}),
        StorageManager.flushAll().catch(() => {})
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 1500))
    ]);
  } catch {}
  BotSingletonLock.releaseAllSync();
  process.exit(0);
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.once('exit', () => { BotSingletonLock.releaseAllSync(); });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initBackgroundServices() {
  try {
    // Explicitly check BOT_TOKEN from environment variables upon boot
    const rawEnvBotToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || process.env.BOT_API_TOKEN || process.env.TOKEN || '').trim().replace(/^["']|["']$/g, '');
    const envBotToken = rawEnvBotToken && !rawEnvBotToken.includes('your_telegram_bot_token') ? rawEnvBotToken : '';
    const envAdminId = (process.env.ADMIN_ID || process.env.ROOT_ADMIN_ID || '').trim().replace(/^["']|["']$/g, '');

    if (envBotToken) {
      console.log('🤖 Telegram Bot Token detected from environment. Synchronizing and verifying connection...');
      const settingsUpdate: any = { botToken: envBotToken };
      if (envAdminId) settingsUpdate.rootAdminId = envAdminId;
      await storage.updateSettings(settingsUpdate);

      try {
        const me = await TelegramService.callTelegramApi('getMe', {});
        if (me?.ok && me.result) {
          const botUsername = me.result.username || '';
          const botName = me.result.first_name || 'Bot';
          console.log(`✅ [Telegram Connected] Bot: "${botName}" (@${botUsername}) | ID: ${me.result.id}`);
          await storage.updateSettings({
            botToken: envBotToken,
            botUsername: botUsername
          });
        } else {
          console.warn('⚠️ [Telegram] Connection verification returned unconfirmed:', me?.description || me);
        }
      } catch (botErr: any) {
        console.error('❌ [Telegram] Failed to connect on startup:', botErr?.message || botErr);
      }
    } else {
      console.log('ℹ️ No BOT_TOKEN or TELEGRAM_BOT_TOKEN found in environment variables. Bot features are awaiting token configuration.');
    }

    // Initialize scheduled file auto-delete worker (10-minute delivery timeout)
    await TelegramService.initScheduledDeletionWorker();

    // Initialize Telegram background polling worker immediately
    await TelegramService.initPollingWorker();

    // Initialize and run all active cloned Telegram bots
    await TelegramBotManager.initAllBots();
  } catch (err: any) {
    console.error('⚠️ [Startup] Background service initialization notice:', err?.message || err);
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const httpServer = http.createServer(app);
  httpServer.requestTimeout = 30 * 60 * 1000; // 30 minutes for large uploads
  httpServer.headersTimeout = 5 * 60 * 1000;  // 5 minutes
  httpServer.keepAliveTimeout = 65 * 1000;    // 65 seconds
  activeHttpServer = httpServer;

  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // High-performance gzip/deflate response compression
  app.use(compression({
    level: 6,
    threshold: 256,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));

  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ extended: true, limit: '200mb' }));
  app.use(cookieParser());

  // CORS & Telegram Mini App WebView Compatibility Middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-id, x-tma-init-data, x-telegram-init-data, X-Requested-With, Cache-Control, Pragma');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Start storage initialization concurrently so HTTP server binds port 3000 without network blocking
  const storageInitPromise = storage.init().catch((err: any) => {
    console.error('⚠️ [Storage] Initialization notice:', err?.message || err);
  });
  storageInitPromise.then(() => {
    void initBackgroundServices();
  });

  // Ensure API data endpoints wait for initial storage load (health endpoint responds immediately)
  app.use('/api', async (req, _res, next) => {
    if (req.path === '/health') {
      return next();
    }
    await storageInitPromise;
    next();
  });

  // Mount API Router
  app.use('/api', apiRouter);

  // In development, hook up Vite dev server middleware (bind HMR to httpServer to avoid port 24678 conflicts)
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve built frontend assets from dist
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  let listenRetries = 0;
  httpServer.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE' && listenRetries < 6) {
      listenRetries++;
      console.warn(`⚠️ [PortConflict] Port ${PORT} busy during restart (EADDRINUSE), retrying in 500ms (${listenRetries}/6)...`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch {}
        httpServer.listen(PORT, '0.0.0.0');
      }, 500);
      return;
    }
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n❌ [PortConflict] CRITICAL: Port ${PORT} is already in use (EADDRINUSE) by another running process.\n   Resolve by stopping the conflicting process on port ${PORT} or setting a different PORT env variable.\n   Terminating process safely.\n`);
    } else {
      console.error('❌ [Server] HTTP server failed to bind port:', err?.message || err);
    }
    BotSingletonLock.releaseAllSync();
    process.exit(1);
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`📁 [VPS Storage] Data Dir: ${storage.getDataDir()} | Files Dir: ${storage.getPrimaryUploadDir()}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
