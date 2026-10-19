import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import { apiRouter } from '../../server/routes';
import { storage } from '../../server/storage';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Init storage middleware
app.use(async (_req, _res, next) => {
  await storage.loadLatest(true);
  next();
});

// Mount routes: either under /.netlify/functions/api or /api
app.use(['/api', '/.netlify/functions/api'], apiRouter);

// Export handler
let cachedHandler: any = null;

export const handler = async (event: any, context: any) => {
  if (!cachedHandler) {
    // Dynamically require serverless-http or adapt
    try {
      const serverless = (await import('serverless-http')).default;
      cachedHandler = serverless(app);
    } catch {
      // If serverless-http is not bundled, simple fallback
      cachedHandler = async (evt: any) => {
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'API Function' })
        };
      };
    }
  }
  return cachedHandler(event, context);
};
