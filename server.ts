import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import cookieParser from 'cookie-parser';
import { apiRouter } from './server/api.js';
import {
  createApiNotFoundOrMethodHandler,
  globalJsonErrorHandler,
  securityAndCorsMiddleware,
} from './server/http_middleware.js';
import { SUBSCRIPTION_EXPIRY_SWEEP_MS } from './server/config.js';
import { enforceExpiredSubscriptions } from './server/subscriptions_api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const p = parseInt(process.argv[portArgIdx + 1], 10);
    if (!isNaN(p) && p > 0) return p;
  }
  return 3000;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = resolvePort();

  app.set('trust proxy', 1);
  app.use(securityAndCorsMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // API router + JSON 404/405 catch-all so /api/* never falls through to SPA HTML
  app.use('/api', apiRouter);
  app.use('/api', createApiNotFoundOrMethodHandler(apiRouter));

  // Serve static assets from public if any
  app.use(express.static(path.resolve(__dirname, 'public')));

  let vite: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Initialize Vite middleware concurrently so port 3000 binds immediately without timing out on cold starts
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const viteReady = createViteServer({
      server: {
        middlewareMode: true,
        ws: isHmrDisabled ? false : undefined,
        hmr: isHmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    })
      .then((server) => {
        vite = server;
        return server;
      })
      .catch((err) => {
        console.error('Failed to initialize Vite dev server:', err);
        process.exit(1);
      });

    app.use(async (req, res, next) => {
      try {
        const v = await viteReady;
        v.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(globalJsonErrorHandler);

  // Schedule background subscription expiry sweep (Africa/Nairobi EAT & UTC expiry check)
  enforceExpiredSubscriptions().catch((err) => {
    console.warn('Initial subscription expiry sweep warning:', err);
  });
  const expirySweepTimer = setInterval(() => {
    enforceExpiredSubscriptions().catch((err) => {
      console.warn('Scheduled subscription expiry sweep warning:', err);
    });
  }, SUBSCRIPTION_EXPIRY_SWEEP_MS);
  expirySweepTimer.unref?.();

  const shutdown = () => {
    clearInterval(expirySweepTimer);
    if (vite) {
      vite.close().catch(() => {});
    }
    httpServer.closeAllConnections?.();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 250).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`Buyoll server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
