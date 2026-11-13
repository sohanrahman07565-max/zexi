import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { apiRouter } from './server/routes';
import { storage } from './server/storage';
import { TelegramService, TelegramBotManager } from './server/telegram';

dotenv.config();

// Global 24/7 Process Guards: Prevent Node.js from exiting on network drops or unhandled promises
process.on('uncaughtException', (err: any) => {
  console.error('🛡️ [Process Guard] Caught uncaughtException (service kept online 24/7):', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('🛡️ [Process Guard] Caught unhandledRejection (service kept online 24/7):', reason?.message || reason);
});

// Graceful shutdown: Ensure all in-flight database changes are saved to Firebase Cloud before exit
process.on('SIGTERM', async () => {
  console.log('🛑 [Process] SIGTERM received. Flushing storage to Firebase Cloud before shutdown...');
  await storage.flush().catch(() => {});
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 [Process] SIGINT received. Flushing storage to Firebase Cloud before shutdown...');
  await storage.flush().catch(() => {});
  process.exit(0);
});

// Render Keep-Alive 24/7 Heartbeat Monitor (Prevents Render Free Tier Idle Sleep)
function initRenderKeepAlive(port: number) {
  const PING_INTERVAL_MS = 8 * 60 * 1000; // 8 minutes (Render sleeps after 15 minutes of inactivity)
  const externalUrl = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || '').trim();

  console.log(`💓 [Render Keep-Alive] Initialized 24/7 heartbeat monitor (interval: 8m, target: "${externalUrl || `http://127.0.0.1:${port}/api/health`}").`);

  async function ping() {
    const targetUrl = externalUrl
      ? `${externalUrl.replace(/\/+$/, '')}/api/health`
      : `http://127.0.0.1:${port}/api/health`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.ok) {
        console.log(`💓 [Render Keep-Alive] Heartbeat ping successful to ${targetUrl} (HTTP ${res.status}) - service kept active 24/7.`);
      } else {
        console.warn(`⚠️ [Render Keep-Alive] Heartbeat ping returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      if (externalUrl) {
        try {
          const fallbackRes = await fetch(`http://127.0.0.1:${port}/api/health`);
          if (fallbackRes.ok) {
            console.log(`💓 [Render Keep-Alive] Local fallback ping successful (HTTP ${fallbackRes.status}).`);
            return;
          }
        } catch {}
      }
      console.warn(`⚠️ [Render Keep-Alive] Heartbeat ping notice:`, err?.message || err);
    }
  }

  // Initial ping 30s after boot, then recurring every 8 minutes
  setTimeout(ping, 30000);
  setInterval(ping, PING_INTERVAL_MS);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-bot-id, X-Requested-With, Cache-Control, Pragma');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Initialize storage
  await storage.init();

  // Explicitly check BOT_TOKEN from environment variables upon boot
  const envBotToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TG_BOT_TOKEN || process.env.BOT_API_TOKEN || process.env.TOKEN || '').trim().replace(/^["']|["']$/g, '');
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

  // Mount API Router
  app.use('/api', apiRouter);

  // In development, hook up Vite dev server middleware
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    initRenderKeepAlive(PORT);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
