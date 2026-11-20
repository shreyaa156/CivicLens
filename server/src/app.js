import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { openDatabase } from './db/index.js';
import { apiLimiter } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errors.js';
import routes from './routes/index.js';

export function createApp() {
  openDatabase();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
          scriptSrc: ["'self'"],
        },
      },
    }),
  );
  // CORS only matters for the API. Same-origin requests (the built frontend served by this
  // server) are always allowed; cross-origin callers must be listed in CORS_ORIGINS.
  const apiCors = cors((req, cb) => {
    const origin = req.get('origin');
    let sameOrigin = false;
    let devLoopback = false;
    try {
      const url = origin ? new URL(origin) : null;
      sameOrigin = !!url && url.host === req.get('host');
      // Development convenience: any localhost port (e.g. Vite moving to 5174 when 5173 is busy).
      devLoopback = !config.isProduction && !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch {
      /* malformed origin */
    }
    if (!origin || sameOrigin || devLoopback || config.corsOrigins.includes(origin)) return cb(null, { origin: true });
    cb(new Error('CORS: origin not allowed'));
  });
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', apiCors, apiLimiter, routes);
  app.use('/api', notFound);

  // Uploaded images (filenames are server-generated random names).
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      fallthrough: false,
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  // Production: serve the built React app from the same origin.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
