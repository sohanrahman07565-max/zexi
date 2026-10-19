import { TelegramService } from '../../server/telegram';
import { storage } from '../../server/storage';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    await storage.loadLatest(true);
    const body = event.body ? JSON.parse(event.body) : {};
    // Process update
    await TelegramService.handleUpdate(body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err: any) {
    console.error('Netlify Telegram webhook error:', err);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  }
};
