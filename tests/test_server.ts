import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import cookieParser from 'cookie-parser';
import { apiRouter } from '../server/api.js';
import { resetDatabaseCacheForTest, getDatabase } from '../server/db.js';
import { PUBLIC_DIR } from '../server/config.js';

export interface TestHarness {
  baseUrl: string;
  dbFile: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestHarness> {
  const dbFile = path.join(
    os.tmpdir(),
    `buyoll_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`
  );
  process.env.BUYOLL_DB_FILE = dbFile;
  resetDatabaseCacheForTest(dbFile);
  await getDatabase();

  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use('/api', apiRouter);
  app.use(express.static(PUBLIC_DIR));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    dbFile,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(dbFile, { force: true }).catch(() => {});
    },
  };
}
