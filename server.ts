import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { apiRouter } from './server/routes';
import { storage } from './server/storage';
import { TelegramService } from './server/telegram';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ extended: true, limit: '200mb' }));
  app.use(cookieParser());

  // Initialize storage
  await storage.init();

  // Explicitly check BOT_TOKEN from environment variables upon boot
  const envBotToken = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
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
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
