import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction, saveDatabase } from '../server/db.js';
import { runPendingMigrations } from '../server/migrations.js';
import {
  getControlCenterSummary,
  invalidateControlCenterSummaryCache,
} from '../server/admin_control_center.js';
import { compressionMiddleware } from '../server/http_middleware.js';
import { isChunkLoadError } from '../src/components/AdminErrorBoundary.tsx';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../src/api.ts';

describe('Buyoll Admin Control Center: Summary, Pagination, Compression, Cache & UI Reliability', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('enforces 401/403 on GET /api/admin/control-center/summary, returns accurate counts quickly, and caches/invalidates properly', async () => {
    // 1. Unauthenticated -> 401
    const unauth = await fetch(`${harness.baseUrl}/api/admin/control-center/summary`);
    assert.equal(unauth.status, 401);

    // 2. Non-admin roles (member, merchant, lender) -> 403
    const roleUserIds: number[] = [];
    await runDatabaseTransaction(async (db) => {
      for (const role of ['member', 'merchant', 'lender'] as const) {
        const id = db.nextIds.user++;
        db.users.push({
          id,
          uuid: `test-cc-${role}-${id}`,
          name: `Test ${role}`,
          username: `cc_${role}_${id}`,
          usernameDisplay: `cc_${role}_${id}`,
          usernameLower: `cc_${role}_${id}`,
          email: `cc_${role}_${id}@buyoll.test`,
          phone: null,
          phoneNormalized: null,
          password: 'hashed_dummy_value_for_test',
          role,
          roles: [role],
          activeRole: role,
          platformId: `BYL-T-${id}`,
          verified: role === 'merchant',
          isDisabled: false,
          isSuspended: false,
          credit: 2500,
          coins: 50,
          points: 25,
          createdAt: Date.now(),
        } as any);
        roleUserIds.push(id);
      }

      // Seed > 25 payments to verify pagination & O(N) statement matching
      for (let i = 1; i <= 26; i++) {
        const payId = db.nextIds.payment++;
        const code = `CCPAY${String(i).padStart(4, '0')}`;
        db.payments.push({
          id: payId,
          userId: roleUserIds[0],
          userName: 'Test member',
          groupId: 1,
          productId: 1,
          productName: 'Solar Lantern',
          amount: 500 + i,
          code,
          status: i <= 22 ? 'pending' : 'approved',
          createdAt: Date.now() - i * 1000,
        } as any);
        if (i % 2 === 0) {
          db.mpesaStatements.push({
            id: `stmt_${i}`,
            code,
            amount: 500 + i,
            channel: 'Till 196853',
            payerName: 'Test member',
            timestamp: Date.now() - i * 1000,
          } as any);
        }
      }
    });

    for (let i = 0; i < roleUserIds.length; i++) {
      const role = (['member', 'merchant', 'lender'] as const)[i];
      const tok = await harness.issueToken(roleUserIds[i], role);
      const deniedSummary = await fetch(`${harness.baseUrl}/api/admin/control-center/summary`, {
        headers: { Authorization: `Bearer ${tok}`, 'x-buyoll-role': role },
      });
      assert.equal(deniedSummary.status, 403, `Expected 403 for ${role} on control-center/summary`);

      const deniedPayments = await fetch(`${harness.baseUrl}/api/admin/payments?page=1&limit=20`, {
        headers: { Authorization: `Bearer ${tok}`, 'x-buyoll-role': role },
      });
      assert.equal(deniedPayments.status, 403, `Expected 403 for ${role} on admin/payments`);
    }

    // 3. Admin request succeeds cleanly and fast
    const { accessToken } = await harness.loginAdmin();
    invalidateControlCenterSummaryCache(harness.dbFile);

    const t0 = performance.now();
    const res1 = await fetch(`${harness.baseUrl}/api/admin/control-center/summary`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-buyoll-role': 'admin' },
    });
    const elapsed1 = performance.now() - t0;
    assert.equal(res1.status, 200);
    assert.ok(elapsed1 < 500, `Expected summary under 500ms, took ${elapsed1.toFixed(1)}ms`);

    const sum1 = await res1.json();
    assert.equal(sum1.cache.cacheHit, false);
    assert.ok(Array.isArray(sum1.unavailableFields));
    assert.ok(sum1.users.total >= 4);
    assert.ok(sum1.payments.pending >= 22);
    assert.ok(sum1.wallets.totalCredit >= 7500);

    // 4. Second request uses TTL cache
    const res2 = await fetch(`${harness.baseUrl}/api/admin/control-center/summary`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(res2.status, 200);
    const sum2 = await res2.json();
    assert.equal(sum2.cache.cacheHit, true);

    // 5. ?refresh=true bypasses cache
    const resRefresh = await fetch(`${harness.baseUrl}/api/admin/control-center/summary?refresh=true`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(resRefresh.status, 200);
    const sumRefresh = await resRefresh.json();
    assert.equal(sumRefresh.cache.cacheHit, false);

    // 6. Database write invalidates cache automatically
    await runDatabaseTransaction(async (db) => {
      db.auditLogs.unshift({
        id: Date.now(),
        actorId: 1,
        actorName: 'Test Admin',
        action: 'TEST_INVALIDATE',
        details: 'Verify cache invalidation on write',
        timestamp: Date.now(),
      } as any);
    });
    const resAfterWrite = await fetch(`${harness.baseUrl}/api/admin/control-center/summary`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-buyoll-role': 'admin' },
    });
    const sumAfterWrite = await resAfterWrite.json();
    assert.equal(sumAfterWrite.cache.cacheHit, false);

    // 7. Per-section fault isolation in getControlCenterSummary (one throwing getter doesn't break summary)
    const brokenDb = new Proxy(await getDatabase(), {
      get(target, prop) {
        if (prop === 'peerLoans') {
          throw new Error('Simulated peerLoans outage');
        }
        return (target as any)[prop];
      },
    });
    const resilient = await getControlCenterSummary(brokenDb as any, `${harness.dbFile}_fault`, {
      bypassCache: true,
    });
    assert.equal(resilient.loans.unavailable, true);
    assert.ok(resilient.unavailableFields.includes('loans'));
    assert.equal(resilient.users.unavailable, undefined);
    assert.ok(resilient.users.total >= 4);
  });

  it('paginates every admin list endpoint (?page=&limit=20), filters/searches safely, and strips sensitive user fields', async () => {
    const { accessToken } = await harness.loginAdmin();
    const headers = { Authorization: `Bearer ${accessToken}`, 'x-buyoll-role': 'admin' };

    // Payments page 1 & page 2 (with status=pending filter)
    const payP1 = await fetch(`${harness.baseUrl}/api/admin/payments?page=1&limit=20&status=pending`, { headers });
    assert.equal(payP1.status, 200);
    const payData1 = await payP1.json();
    assert.equal(payData1.payments.length, 20);
    assert.equal(payData1.pagination.page, 1);
    assert.equal(payData1.pagination.limit, 20);
    assert.equal(payData1.pagination.hasMore, true);
    // Statement matching fields present cleanly
    assert.ok(payData1.payments.some((p: any) => p.statementMatch?.matched === true && p.matchedTillEntry));

    const payP2 = await fetch(`${harness.baseUrl}/api/admin/payments?page=2&limit=20&status=pending`, { headers });
    assert.equal(payP2.status, 200);
    const payData2 = await payP2.json();
    assert.ok(payData2.payments.length >= 2);
    assert.equal(payData2.pagination.page, 2);

    // Overview returns paginated sections & omits raw allUsers dump
    const ovRes = await fetch(`${harness.baseUrl}/api/admin/overview?page=1&limit=20`, { headers });
    assert.equal(ovRes.status, 200);
    const ov = await ovRes.json();
    assert.equal(ov.allUsers, undefined);
    assert.ok(ov.pendingPayments.length <= 20);
    assert.ok(ov.pagination?.payments?.limit === 20);

    // Users strips sensitive fields and supports search + role filter
    const usrRes = await fetch(`${harness.baseUrl}/api/admin/users?page=1&limit=20&role=merchant`, { headers });
    assert.equal(usrRes.status, 200);
    const usr = await usrRes.json();
    assert.ok(usr.users.length >= 1);
    assert.ok(usr.pagination.limit === 20);
    for (const u of usr.users) {
      assert.equal(u.password, undefined);
      assert.equal(u.adminPasskeyHash, undefined);
      assert.equal(u.role, 'merchant');
    }

    // Wallets exposes both credit and balance fields
    const walRes = await fetch(`${harness.baseUrl}/api/admin/wallets?page=1&limit=20`, { headers });
    assert.equal(walRes.status, 200);
    const wal = await walRes.json();
    assert.ok(wal.wallets.length >= 1);
    assert.ok(typeof wal.wallets[0].balance === 'number');
    assert.ok(typeof wal.wallets[0].credit === 'number');
    assert.ok(typeof wal.wallets[0].nonWithdrawableBalance === 'number');

    // Remaining paginated endpoints return 200 + pagination metadata
    const listEndpoints = [
      '/api/admin/refunds?page=1&limit=20',
      '/api/admin/audit-logs?page=1&limit=20',
      '/api/admin/chat-logs?page=1&limit=20',
      '/api/admin/wallet-deposits?page=1&limit=20',
      '/api/admin/merchant-verifications?page=1&limit=20',
      '/api/admin/merchant-subscriptions?page=1&limit=20',
      '/api/admin/subscriptions/requests?page=1&limit=20',
      '/api/admin/featured-products?page=1&limit=20',
    ];
    for (const ep of listEndpoints) {
      const r = await fetch(`${harness.baseUrl}${ep}`, { headers });
      assert.equal(r.status, 200, `Expected 200 from ${ep}`);
      const json = await r.json();
      assert.ok(json.pagination, `Expected pagination object from ${ep}`);
      assert.equal(json.pagination.limit, 20, `Expected limit=20 on ${ep}`);
    }
  });

  it('applies migration 012_admin_control_center_indexes non-destructively and preserves all data', async () => {
    const db = await getDatabase();
    const usersBefore = db.users.length;
    const paymentsBefore = db.payments.length;

    const result = await runPendingMigrations(db);
    assert.ok(db.migrationsApplied?.some((m) => m.id === '012_admin_control_center_indexes'));
    assert.ok(db.controlCenterIndexes);
    assert.ok(Array.isArray(db.controlCenterIndexes.columns.users));
    assert.ok(Array.isArray(db.controlCenterIndexes.columns.payments));

    // Re-running is idempotent and non-destructive
    const resultAgain = await runPendingMigrations(db);
    assert.equal(resultAgain.applied.length, 0);
    assert.equal(db.users.length, usersBefore);
    assert.equal(db.payments.length, paymentsBefore);
    assert.ok(result);
    await saveDatabase(db);
  });

  it('compresses JSON payloads >= 1KB with gzip/br via compressionMiddleware and configures cache headers', async () => {
    const app = express();
    app.use(compressionMiddleware);
    app.get('/api/large', (_req, res) => {
      res.json({ items: Array.from({ length: 80 }, (_, i) => ({ id: i, text: 'Buyoll Admin Control Center payload' })) });
    });
    app.get('/api/small', (_req, res) => {
      res.json({ ok: true });
    });

    const srv = http.createServer(app);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', () => resolve()));
    const port = (srv.address() as { port: number }).port;

    try {
      // Request raw compressed bytes over http module so Node fetch doesn't transparently hide encoding check
      const gzipRes = await new Promise<{ status: number; encoding: string | undefined; vary: string | undefined; decoded: any }>((resolve, reject) => {
        http.get(
          `http://127.0.0.1:${port}/api/large`,
          { headers: { 'Accept-Encoding': 'gzip' } },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              const rawBuf = Buffer.concat(chunks);
              const inflated = zlib.gunzipSync(rawBuf).toString('utf-8');
              resolve({
                status: res.statusCode || 0,
                encoding: res.headers['content-encoding'],
                vary: res.headers['vary'],
                decoded: JSON.parse(inflated),
              });
            });
          }
        ).on('error', reject);
      });
      assert.equal(gzipRes.status, 200);
      assert.equal(gzipRes.encoding, 'gzip');
      assert.equal(gzipRes.vary, 'Accept-Encoding');
      assert.equal(gzipRes.decoded.items.length, 80);

      // Small payloads (< 1KB) stay uncompressed
      const smallRes = await new Promise<{ encoding: string | undefined }>((resolve, reject) => {
        http.get(
          `http://127.0.0.1:${port}/api/small`,
          { headers: { 'Accept-Encoding': 'gzip' } },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ encoding: res.headers['content-encoding'] }));
          }
        ).on('error', reject);
      });
      assert.equal(smallRes.encoding, undefined);
    } finally {
      srv.closeAllConnections?.();
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }

    // Verify Vercel, Service Worker, and Server cache headers configuration
    const vercelJson = JSON.parse(await fs.readFile(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
    const assetsHdr = vercelJson.headers?.find((h: any) => h.source === '/assets/(.*)');
    const htmlHdr = vercelJson.headers?.find((h: any) => h.source === '/index.html');
    const swHdr = vercelJson.headers?.find((h: any) => h.source === '/sw.js');
    assert.ok(assetsHdr?.headers?.some((x: any) => /immutable/.test(x.value)));
    assert.ok(htmlHdr?.headers?.some((x: any) => /no-store/.test(x.value)));
    assert.ok(swHdr?.headers?.some((x: any) => /no-store/.test(x.value)));

    const swSource = await fs.readFile(path.resolve(process.cwd(), 'public/sw.js'), 'utf-8');
    assert.ok(swSource.includes("buyoll-cache-v2"));
  });

  it('verifies client 10s AbortController timeout, chunk error detection, Header admin-only links, and non-blocking Control Center architecture', async () => {
    assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 10_000);
    assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module /assets/AdminDashboardPage.js')), true);
    assert.equal(isChunkLoadError(new Error('ChunkLoadError: Loading chunk 4 failed.')), true);
    assert.equal(isChunkLoadError(new Error('Validation error')), false);

    // Header.tsx: exact 'Buyoll Admin Control Center' in both summary & menu slots gated on activeRole === 'admin'
    const headerSrc = await fs.readFile(path.resolve(process.cwd(), 'src/components/Header.tsx'), 'utf-8');
    assert.ok(headerSrc.includes('data-testid="admin-summary-control-center-link"'));
    assert.ok(headerSrc.includes('data-testid="admin-menu-control-center-item"'));
    const labelMatches = headerSrc.match(/<span>Buyoll Admin Control Center<\/span>/g) || [];
    assert.equal(labelMatches.length, 2, 'Header must render Buyoll Admin Control Center in both summary and menu slots');
    // Both occurrences sit inside activeRole === 'admin' guards and appear before My Profile
    const summaryIdx = headerSrc.indexOf('admin-summary-control-center-link');
    const menuIdx = headerSrc.indexOf('admin-menu-control-center-item');
    const profileIdx = headerSrc.indexOf('<span>My Profile</span>');
    assert.ok(summaryIdx > 0 && menuIdx > summaryIdx && profileIdx > menuIdx);
    const guardMatches = headerSrc.match(/\{activeRole === 'admin' &&/g) || [];
    assert.ok(guardMatches.length >= 2);

    // AdminDashboardPage.tsx: no blocking full-page loading gate, uses Promise.allSettled, IntersectionObserver, and Retry banners
    const adminPageSrc = await fs.readFile(path.resolve(process.cwd(), 'src/pages/AdminDashboardPage.tsx'), 'utf-8');
    assert.ok(!adminPageSrc.includes('if (loading || !data)'), 'Must not block entire page on full-page spinner');
    assert.ok(adminPageSrc.includes('Promise.allSettled'));
    assert.ok(adminPageSrc.includes('IntersectionObserver'));
    assert.ok(adminPageSrc.includes('SectionErrorBanner'));
    assert.ok(adminPageSrc.includes('finally {'));
  });
});
