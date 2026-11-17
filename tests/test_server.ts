import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { apiRouter } from '../server/api.js';
import {
  createApiNotFoundOrMethodHandler,
  globalJsonErrorHandler,
  securityAndCorsMiddleware,
} from '../server/http_middleware.js';
import { resetDatabaseCacheForTest, getDatabase, runDatabaseTransaction } from '../server/db.js';
import { PUBLIC_DIR } from '../server/config.js';
import { createDbSession, createAccessToken } from '../server/auth_utils.js';
import type { UserRole } from '../src/types.ts';

export interface TestHarness {
  baseUrl: string;
  dbFile: string;
  adminCredentials: {
    identifier: string;
    password: string;
    passkey: string;
    email: string;
  };
  issueToken: (userId: number, role?: UserRole) => Promise<string>;
  loginAdmin: () => Promise<{ accessToken: string; user: any; cookie: string }>;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestHarness> {
  process.env.BUYOLL_TEST_MODE = '1';
  if (!process.env.ADMIN_USERNAME) process.env.ADMIN_USERNAME = 'testadmin';
  if (!process.env.ADMIN_FULL_NAME) process.env.ADMIN_FULL_NAME = 'Test Platform Admin';
  if (!process.env.ADMIN_EMAIL) process.env.ADMIN_EMAIL = 'testadmin@buyoll.test';
  if (!process.env.ADMIN_INITIAL_PASSWORD) {
    process.env.ADMIN_INITIAL_PASSWORD = `Adm!${crypto.randomBytes(6).toString('hex')}1`;
  }
  if (!process.env.ADMIN_INITIAL_PASSKEY) {
    process.env.ADMIN_INITIAL_PASSKEY = `PK_${crypto.randomBytes(8).toString('hex')}`;
  }

  const dbFile = path.join(
    os.tmpdir(),
    `buyoll_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.json`
  );
  process.env.BUYOLL_DB_FILE = dbFile;
  resetDatabaseCacheForTest(dbFile);
  await getDatabase();

  const app = express();
  app.use(securityAndCorsMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use('/api', apiRouter);
  app.use('/api', createApiNotFoundOrMethodHandler(apiRouter));
  app.use(express.static(PUBLIC_DIR));
  app.use(globalJsonErrorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const adminCredentials = {
    identifier: process.env.ADMIN_USERNAME!,
    password: process.env.ADMIN_INITIAL_PASSWORD!,
    passkey: process.env.ADMIN_INITIAL_PASSKEY!,
    email: process.env.ADMIN_EMAIL!.toLowerCase(),
  };

  async function issueToken(userId: number, explicitRole?: UserRole): Promise<string> {
    return runDatabaseTransaction(async (db) => {
      const user = db.users.find((u) => u.id === userId);
      if (!user) throw new Error(`User #${userId} not found in test DB`);
      const role = explicitRole || user.activeRole || user.role;
      const session = createDbSession(db, user, role);
      return createAccessToken(user, session.id, role);
    });
  }

  async function loginAdmin(): Promise<{ accessToken: string; user: any; cookie: string }> {
    const res = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: adminCredentials.identifier,
        password: adminCredentials.password,
        passkey: adminCredentials.passkey,
      }),
    });
    const data = await res.json();
    if (res.status !== 200 || !data.accessToken) {
      throw new Error(`Admin test login failed (${res.status}): ${JSON.stringify(data)}`);
    }
    const setCookie = res.headers.get('set-cookie') || '';
    return { accessToken: data.accessToken, user: data.user, cookie: setCookie };
  }

  return {
    baseUrl,
    dbFile,
    adminCredentials,
    issueToken,
    loginAdmin,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(dbFile, { force: true }).catch(() => {});
    },
  };
}
