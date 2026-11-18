import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_MEMBER_SPEEDS,
  SOLO_DURATION_MONTHS,
  buildAllSpeedOptions,
  calculateDailyContribution,
  calculateRotationPoolAmount,
  calculateTotalDurationDays,
  getLowestGroupDailyAmount,
} from '../src/utils/speedOptions.ts';
import { getFallbackProducts, getFallbackProduct } from '../src/data/publicCatalogFallback.ts';
import { runPendingMigrations } from '../server/migrations.ts';
import { startTestServer, TestHarness } from './test_server.ts';

describe('Global Member Speeds (10, 9, 8, 7, 6, 5, 4, 3, 2, 1)', () => {
  let harness: TestHarness | null = null;

  beforeEach(async () => {
    harness = await startTestServer();
  });

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = null;
    }
  });

  it('computes all 10 member speeds and solo 1-6 month calculations accurately', () => {
    assert.deepEqual([...STANDARD_MEMBER_SPEEDS], [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

    const price = 68000;
    const all = buildAllSpeedOptions(price, [
      { size: 10, cycleDays: 10, dailyAmount: 680, totalAmount: 68000 },
      { size: 6, cycleDays: 10, dailyAmount: 1134, totalAmount: 68000 },
      { size: 4, cycleDays: 10, dailyAmount: 1700, totalAmount: 68000 },
    ]);

    assert.deepEqual(
      all.map((s) => s.size),
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    );

    const expectedDailyBySize: Record<number, number> = {
      10: Math.ceil(price / (10 * 10)), // 680
      9: Math.ceil(price / (9 * 10)),   // 756
      8: Math.ceil(price / (8 * 10)),   // 850
      7: Math.ceil(price / (7 * 10)),   // 972
      6: Math.ceil(price / (6 * 10)),   // 1134
      5: Math.ceil(price / (5 * 10)),   // 1360
      4: Math.ceil(price / (4 * 10)),   // 1700
      3: Math.ceil(price / (3 * 10)),   // 2267
      2: Math.ceil(price / (2 * 10)),   // 3400
      1: Math.ceil(price / 90),         // 756 (default 3-month / 90-day solo)
    };

    for (const opt of all) {
      assert.equal(opt.dailyAmount, expectedDailyBySize[opt.size], `Unexpected dailyAmount for size ${opt.size}`);
      assert.equal(opt.totalAmount, price);
      if (opt.size >= 2) {
        assert.equal(calculateTotalDurationDays(opt.size, opt.cycleDays), opt.size * 10);
        assert.ok(
          calculateRotationPoolAmount(opt.dailyAmount, opt.size, opt.cycleDays) >= price,
          `Rotation pool should cover target price for size ${opt.size}`
        );
      }
    }

    for (const months of SOLO_DURATION_MONTHS) {
      const soloList = buildAllSpeedOptions(price, all, months);
      const solo = soloList.find((s) => s.size === 1)!;
      assert.equal(solo.cycleDays, months * 30);
      assert.equal(solo.dailyAmount, Math.ceil(price / (months * 30)));
    }

    assert.equal(getLowestGroupDailyAmount(price, all), 680);
  });

  it('populates all 10 speeds on every static catalog fallback product', () => {
    const { products } = getFallbackProducts();
    assert.ok(products.length >= 8);
    for (const p of products) {
      assert.deepEqual(
        p.speedOptions.map((s) => s.size),
        [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        `Fallback product #${p.id} missing speeds`
      );
    }
    const detail = getFallbackProduct(1);
    assert.ok(detail);
    assert.equal(detail.product.speedOptions.length, 10);
  });

  it('returns all 10 speeds from GET /api/products and GET /api/products/:id', async () => {
    const listRes = await fetch(`${harness!.baseUrl}/api/products`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.products.length > 0);
    for (const p of listData.products) {
      assert.deepEqual(
        p.speedOptions.map((s: any) => s.size),
        [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      );
    }

    const detailRes = await fetch(`${harness!.baseUrl}/api/products/1`);
    assert.equal(detailRes.status, 200);
    const detailData = await detailRes.json();
    assert.deepEqual(
      detailData.product.speedOptions.map((s: any) => s.size),
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    );
  });

  it('allows merchant/admin to create products and groups across every speed 10 down to 1 with accurate daily math', async () => {
    const { accessToken } = await harness!.loginAdmin();

    const prodRes = await fetch(`${harness!.baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: 'Speed Test Espresso Machine',
        description: 'Commercial kitchen espresso maker',
        category: 'Kitchen',
        price: 30000,
        stockQuantity: 12,
      }),
    });
    assert.equal(prodRes.status, 201);
    const { product } = await prodRes.json();
    assert.deepEqual(
      product.speedOptions.map((s: any) => s.size),
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    );

    // Create a group for every speed tier (including 9, 7, 5, 3, and 1-member solo)
    for (const size of STANDARD_MEMBER_SPEEDS) {
      const grpRes = await fetch(`${harness!.baseUrl}/api/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          productId: product.id,
          size,
          paymentDurationDays: size === 1 ? 120 : undefined,
        }),
      });
      assert.equal(grpRes.status, 201, `Failed creating group for size ${size}`);
      const { group } = await grpRes.json();
      assert.equal(group.size, size);
      assert.equal(group.slots.length, size);
      assert.equal(
        group.dailyAmount,
        calculateDailyContribution(30000, size, size === 1 ? 120 : 10)
      );
    }
  });

  it('migrates legacy 4-speed products to all 10 speeds without altering user or group records', async () => {
    const fakeDb: any = {
      users: [{ id: 99, name: 'Keep Me', role: 'member', credit: 500, coins: 10, points: 10 }],
      products: [
        {
          id: 500,
          title: 'Legacy Product',
          price: 18000,
          speedOptions: [
            { size: 10, cycleDays: 10, dailyAmount: 180, totalAmount: 18000 },
            { size: 6, cycleDays: 10, dailyAmount: 300, totalAmount: 18000 },
            { size: 4, cycleDays: 10, dailyAmount: 450, totalAmount: 18000 },
            { size: 2, cycleDays: 10, dailyAmount: 900, totalAmount: 18000 },
          ],
        },
      ],
      groups: [],
      auditLogs: [],
      emailOutbox: [],
      wallets: [],
      walletLedger: [],
      sessions: [],
      refreshTokens: [],
      nextIds: { user: 100, product: 501, group: 1 },
      migrationsApplied: [
        { id: '001_initial_schema', name: 'init', appliedAt: Date.now() },
        { id: '002_admin_seed', name: 'adm', appliedAt: Date.now() },
        { id: '003_terminology_cleanup', name: 'clean', appliedAt: Date.now() },
        { id: '004_wallet_settlement_fields', name: 'wallet', appliedAt: Date.now() },
        { id: '005_merchant_subscriptions_and_notifications', name: 'sub', appliedAt: Date.now() },
        { id: '006_auth_sessions_and_security', name: 'auth', appliedAt: Date.now() },
        { id: '007_platform_cleanup_and_canonical_roles', name: 'roles', appliedAt: Date.now() },
        { id: '008_admin_replacement_and_security_fields', name: 'admin', appliedAt: Date.now() },
        { id: '009_wallets_and_integer_ledger', name: 'wled', appliedAt: Date.now() },
        { id: '010_auth_hardening_e164_phone_and_resets', name: 'e164', appliedAt: Date.now() },
      ],
    };

    const res = await runPendingMigrations(fakeDb);
    assert.ok(res.applied.includes('011_standardize_all_ten_member_speeds'));
    assert.deepEqual(
      fakeDb.products[0].speedOptions.map((s: any) => s.size),
      [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    );
    const preservedUser = fakeDb.users.find((u: any) => u.id === 99);
    assert.equal(preservedUser.credit, 500);
  });
});
