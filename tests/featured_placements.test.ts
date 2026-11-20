import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction, saveDatabase } from '../server/db.js';
import { runPendingMigrations } from '../server/migrations.js';
import { creditWalletCents, ensureWallet } from '../server/wallet_service.js';
import { toCents } from '../server/config.js';
import { sweepFeaturedPlacements } from '../server/featured_service.js';

describe('Paid Featured Placements: Tier Limits, Wallet Hold/Settle/Refund, Admin Moderation, Expiry & Analytics', () => {
  let harness: TestHarness;
  let merchantAId = 0;
  let merchantBId = 0;
  let memberId = 0;
  let unsubMerchantId = 0;
  let adminToken = '';
  let merchantAToken = '';
  let merchantBToken = '';
  let memberToken = '';
  let unsubToken = '';

  let draftProdId = 0;
  let zeroGroupPubProdId = 0;
  let eligibleProdA1Id = 0;
  let eligibleProdA2Id = 0;
  let eligibleProdB1Id = 0;
  let activeGroupA1Id = 0;

  before(async () => {
    harness = await startTestServer();
    const adminAuth = await harness.loginAdmin();
    adminToken = adminAuth.accessToken;

    const now = Date.now();
    await runDatabaseTransaction(async (db) => {
      await runPendingMigrations(db);

      // Helper to create test users directly
      const createTestUser = (
        username: string,
        role: 'merchant' | 'member',
        opts: { subStatus?: 'active' | 'expired' | 'none'; tier?: string; expiresAt?: number; creditKes?: number }
      ) => {
        const id = db.nextIds.user++;
        db.users.push({
          id,
          uuid: `test-feat-${username}-${id}`,
          name: `Test ${username}`,
          username,
          usernameDisplay: username,
          usernameLower: username.toLowerCase(),
          email: `${username.toLowerCase()}@buyoll.test`,
          phone: `+2547${String(10000000 + id).slice(-8)}`,
          phoneNormalized: `+2547${String(10000000 + id).slice(-8)}`,
          password: 'hashed_dummy_value',
          role,
          roles: [role],
          activeRole: role,
          platformId: `BYL-F-${id}`,
          verified: role === 'merchant',
          isDisabled: false,
          isSuspended: false,
          credit: 0,
          roleWallets: {
            [role]: { credit: 0, coins: 0, points: 0 },
          },
          coins: 0,
          points: 0,
          merchantSubscriptionPlan: opts.tier as any,
          merchantSubscriptionStatus: opts.subStatus === 'active' ? 'active' : opts.subStatus === 'expired' ? 'expired' : 'none',
          merchantSubscriptionExpiresAt: opts.expiresAt,
          createdAt: now,
        } as any);

        if (role === 'merchant' && opts.subStatus && opts.subStatus !== 'none') {
          db.merchantSubscriptions.push({
            id: `sub_${id}_${now}`,
            merchantId: id,
            tierId: (opts.tier || 'tier_250') as any,
            tierName: opts.tier === 'tier_3500' ? 'Commercial' : 'Micro-Merchant',
            amount: opts.tier === 'tier_3500' ? 3500 : 250,
            billingPeriod: 'monthly',
            paymentMethod: 'wallet_credit',
            status: opts.subStatus === 'active' ? 'active' : 'expired',
            startsAt: now - 5 * 86400000,
            expiresAt: opts.expiresAt || now + 25 * 86400000,
          } as any);
        }

        if ((opts.creditKes ?? 0) > 0) {
          creditWalletCents(db, {
            userId: id,
            role,
            amountCents: toCents(opts.creditKes!),
            category: 'ADMIN_ADJUSTMENT',
            referenceId: `seed_${id}`,
            idempotencyKey: `seed_wallet_${id}_${role}`,
            note: 'Initial test wallet balance',
            actorId: 1,
          });
        }
        return id;
      };

      merchantAId = createTestUser('feat_merch_a', 'merchant', {
        subStatus: 'active',
        tier: 'tier_250',
        expiresAt: now + 25 * 86400000,
        creditKes: 1000,
      });
      merchantBId = createTestUser('feat_merch_b', 'merchant', {
        subStatus: 'active',
        tier: 'tier_3500',
        expiresAt: now + 25 * 86400000,
        creditKes: 5000,
      });
      unsubMerchantId = createTestUser('feat_merch_unsub', 'merchant', {
        subStatus: 'none',
        creditKes: 500,
      });
      memberId = createTestUser('feat_member', 'member', {
        creditKes: 5000,
      });

      const addProduct = (vendorId: number, title: string, live: boolean, pubStatus: 'draft' | 'posted') => {
        const pid = db.nextIds.product++;
        db.products.push({
          id: pid,
          title,
          description: `Description for ${title}`,
          category: 'Appliances',
          price: 10000,
          stockQuantity: 15,
          images: ['./images/smart_tv.jpg'],
          vendorId,
          vendorName: `Merchant #${vendorId}`,
          live,
          publicationStatus: pubStatus,
          moderationStatus: 'approved',
          isFeatured: false,
          speedOptions: [{ size: 10, cycleDays: 10, dailyAmount: 100, totalAmount: 10000, description: '10 members' }],
          createdAt: now - 3600_000,
        } as any);
        return pid;
      };

      draftProdId = addProduct(merchantAId, 'Draft Mixer A', false, 'draft');
      zeroGroupPubProdId = addProduct(merchantAId, 'No-Group Published Kettle A', true, 'posted');
      eligibleProdA1Id = addProduct(merchantAId, 'Eligible Blender A1', true, 'posted');
      eligibleProdA2Id = addProduct(merchantAId, 'Eligible Fridge A2', true, 'posted');
      eligibleProdB1Id = addProduct(merchantBId, 'Commercial Solar B1', true, 'posted');

      const addGroup = (productId: number, vendorId: number, title: string) => {
        const gid = db.nextIds.group++;
        db.groups.push({
          id: gid,
          name: title,
          productId,
          productTitle: title,
          size: 10,
          cycleDays: 10,
          dailyAmount: 100,
          totalPrice: 10000,
          vendorId,
          status: 'active',
          occupiedCount: 0,
          slots: Array.from({ length: 10 }, (_, idx) => ({
            slotNumber: idx + 1,
            status: 'open',
            paidAmount: 0,
          })),
          chat: [],
          notifications: [],
          joinPolicy: 'OPEN',
          createdAt: now,
        } as any);
        return gid;
      };

      activeGroupA1Id = addGroup(eligibleProdA1Id, merchantAId, 'Blender A1 Group');
      addGroup(eligibleProdA2Id, merchantAId, 'Fridge A2 Group');
      addGroup(eligibleProdB1Id, merchantBId, 'Solar B1 Group');
    });

    merchantAToken = await harness.issueToken(merchantAId, 'merchant');
    merchantBToken = await harness.issueToken(merchantBId, 'merchant');
    memberToken = await harness.issueToken(memberId, 'member');
    unsubToken = await harness.issueToken(unsubMerchantId, 'merchant');
  });

  after(async () => {
    await harness.close();
  });

  it('enforces auth, role restrictions, subscription status, ownership, published state & group requirement', async () => {
    // 1. Unauthenticated -> 401
    const unauth = await fetch(`${harness.baseUrl}/api/merchant/featured`, { method: 'GET' });
    assert.equal(unauth.status, 401);

    // 2. Member cannot submit featured request -> 403
    const memberTry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 1 }),
    });
    assert.equal(memberTry.status, 403);

    // 3. Unsubscribed merchant blocked -> 403 SUBSCRIPTION_REQUIRED
    const unsubTry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${unsubToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 1 }),
    });
    assert.equal(unsubTry.status, 403);
    const unsubJson = await unsubTry.json();
    assert.equal(unsubJson.error?.code ?? unsubJson.code, 'SUBSCRIPTION_REQUIRED');

    // 4. Ownership isolation: Merchant A cannot feature Merchant B product -> 403
    const otherProdTry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdB1Id, durationDays: 1 }),
    });
    assert.equal(otherProdTry.status, 403);

    // 5. Draft product rejected -> 400 PRODUCT_NOT_PUBLISHED
    const draftTry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: draftProdId, durationDays: 1 }),
    });
    assert.equal(draftTry.status, 400);
    const draftJson = await draftTry.json();
    assert.equal(draftJson.error?.code ?? draftJson.code, 'PRODUCT_NOT_PUBLISHED');

    // 6. Published product with 0 active groups rejected -> 400 GROUPS_REQUIRED
    const noGrpTry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: zeroGroupPubProdId, durationDays: 1 }),
    });
    assert.equal(noGrpTry.status, 400);
    const noGrpJson = await noGrpTry.json();
    assert.equal(noGrpJson.error?.code ?? noGrpJson.code, 'GROUPS_REQUIRED');

    // 7. Invalid duration (31 days) rejected -> 400
    const badDur = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantBToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdB1Id, durationDays: 31 }),
    });
    assert.equal(badDur.status, 400);

    // 8. Legacy unmoderated bypasses return 400 / 410-style moderation error
    const legacyCoinBypass = await fetch(`${harness.baseUrl}/api/products/feature/pay-coins`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 7 }),
    });
    assert.equal(legacyCoinBypass.status, 400);
    const legacyJson = await legacyCoinBypass.json();
    assert.equal(legacyJson.error?.code ?? legacyJson.code, 'FEATURED_MODERATION_REQUIRED');
  });

  it('enforces subscription tier limits on featured durations, discounts, and pending/active quotas', async () => {
    // Merchant A is on tier_250 (maxActiveFeatured: 1, maxPendingFeatured: 1, allowedDurations: [1..7], 0% discount)
    // Try requesting 30 days on tier_250 -> 403 FEATURED_DURATION_RESTRICTED
    const res30d = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 30 }),
    });
    assert.equal(res30d.status, 403);
    const res30dJson = await res30d.json();
    assert.equal(res30dJson.error?.code ?? res30dJson.code, 'DURATION_EXCEEDS_TIER_LIMIT');

    // Merchant B is on tier_3500 (Commercial: 30 days allowed, 10% discount => KES 500 * 0.9 = KES 450 = 45000 cents)
    const idempB = `idem_b_${Date.now()}`;
    const resB = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${merchantBToken}`,
        'x-buyoll-role': 'merchant',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempB,
      },
      body: JSON.stringify({ productId: eligibleProdB1Id, durationDays: 30 }),
    });
    assert.equal(resB.status, 201);
    const jsonB = await resB.json();
    assert.equal(jsonB.request.amountPaidCents, 45000);
    assert.equal(jsonB.request.discountPercent, 10);
    assert.equal(jsonB.request.status, 'PENDING_APPROVAL');

    // Duplicate retry with same Idempotency-Key returns deduplicated response without double debit
    const resBRetry = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${merchantBToken}`,
        'x-buyoll-role': 'merchant',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempB,
      },
      body: JSON.stringify({ productId: eligibleProdB1Id, durationDays: 30 }),
    });
    assert.equal(resBRetry.status, 200);
    const jsonBRetry = await resBRetry.json();
    assert.equal(jsonBRetry.deduplicated, true);
    assert.equal(jsonBRetry.walletBalanceKes, 4550);
  });

  it('handles wallet hold -> cancel refund -> reject refund -> approve revenue -> expiry sweep & ledger consistency', async () => {
    // 1. Merchant A (wallet 1000 KES) requests 1-day featured (50 KES) on Prod A1
    const submit1 = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 1, idempotencyKey: 'key_a1_cancel' }),
    });
    assert.equal(submit1.status, 201);
    const data1 = await submit1.json();
    assert.equal(data1.walletBalanceKes, 950);

    // Merchant A pending cap on tier_250 is 1 -> trying a 2nd request while pending returns 403 FEATURED_PENDING_LIMIT_REACHED
    const submit2Blocked = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA2Id, durationDays: 1 }),
    });
    assert.equal(submit2Blocked.status, 403);
    const submit2Json = await submit2Blocked.json();
    assert.equal(submit2Json.error?.code ?? submit2Json.code, 'FEATURED_PENDING_LIMIT_REACHED');

    // Merchant B cannot cancel Merchant A's request -> 403
    const otherCancel = await fetch(`${harness.baseUrl}/api/merchant/featured/${data1.request.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantBToken}`, 'x-buyoll-role': 'merchant' },
    });
    assert.equal(otherCancel.status, 403);

    // Merchant A cancels pending request -> 100% refund back to 1000 KES
    const cancelRes = await fetch(`${harness.baseUrl}/api/merchant/featured/${data1.request.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant' },
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.request.status, 'CANCELLED');
    assert.equal(cancelJson.walletBalanceKes, 1000);

    // 2. Merchant A submits again (7 days = 250 KES -> wallet 750 KES); Admin rejects with reason -> 100% refund (back to 1000 KES)
    const submitForReject = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 7, idempotencyKey: 'key_a1_reject' }),
    });
    assert.equal(submitForReject.status, 201);
    const rejReqId = (await submitForReject.json()).request.id;

    // Missing reason rejected 422
    const badReject = await fetch(`${harness.baseUrl}/api/admin/featured/${rejReqId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    });
    assert.equal(badReject.status, 422);

    const goodReject = await fetch(`${harness.baseUrl}/api/admin/featured/${rejReqId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Image needs higher resolution' }),
    });
    assert.equal(goodReject.status, 200);
    const rejDone = await goodReject.json();
    assert.equal(rejDone.request.status, 'REJECTED');
    assert.equal(rejDone.request.refundedCents, 25000);

    // Rejecting again is idempotent (alreadyProcessed: true) without double refund
    const doubleReject = await fetch(`${harness.baseUrl}/api/admin/featured/${rejReqId}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Repeat attempt' }),
    });
    assert.equal(doubleReject.status, 200);
    assert.equal((await doubleReject.json()).alreadyProcessed, true);

    // 3. Merchant A submits 3-day request (130 KES -> wallet 870 KES) and Admin approves
    const submitForApprove = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: eligibleProdA1Id, durationDays: 3, idempotencyKey: 'key_a1_approve' }),
    });
    assert.equal(submitForApprove.status, 201);
    const appReqId = (await submitForApprove.json()).request.id;

    const approveRes = await fetch(`${harness.baseUrl}/api/admin/featured/${appReqId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(approveRes.status, 200);
    const appJson = await approveRes.json();
    assert.equal(appJson.request.status, 'ACTIVE');
    assert.ok(appJson.request.endsAt > appJson.request.startsAt);

    // Double-approve is idempotent & does NOT double credit admin wallet
    const approveAgain = await fetch(`${harness.baseUrl}/api/admin/featured/${appReqId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(approveAgain.status, 200);
    assert.equal((await approveAgain.json()).alreadyProcessed, true);

    // Public GET /api/featured lists Eligible Blender A1 as ACTIVE
    const pubFeat = await fetch(`${harness.baseUrl}/api/featured?placement=homepage_featured`);
    assert.equal(pubFeat.status, 200);
    const pubJson = await pubFeat.json();
    assert.ok(pubJson.items.some((it: any) => it.featuredRequestId === appReqId && it.product.id === eligibleProdA1Id));

    // Verify Merchant A wallet & ledger sum consistency
    const dbSnap = await getDatabase();
    const merchUser = dbSnap.users.find((u) => u.id === merchantAId)!;
    const merchWallet = ensureWallet(dbSnap, merchUser, 'merchant');
    assert.equal(merchWallet.balanceCents, 87000); // 1000 - 130 KES = 870 KES
    const ledgerSum = (dbSnap.walletLedger || [])
      .filter((e) => e.walletId === merchWallet.id)
      .reduce((acc, e) => acc + (e.direction === 'CREDIT' ? e.amountCents : -e.amountCents), 0);
    assert.equal(ledgerSum, merchWallet.balanceCents);

    // 4. Analytics tracking: impression (dedup uniqueViewer) + click + product_view + join conversion
    await fetch(`${harness.baseUrl}/api/featured/${appReqId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124.0' },
      body: JSON.stringify({ eventType: 'impression', sessionId: 'sess_viewer_1' }),
    });
    await fetch(`${harness.baseUrl}/api/featured/${appReqId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124.0' },
      body: JSON.stringify({ eventType: 'impression', sessionId: 'sess_viewer_1' }),
    });
    await fetch(`${harness.baseUrl}/api/featured/${appReqId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 Chrome/124.0' },
      body: JSON.stringify({ eventType: 'click', sessionId: 'sess_viewer_1' }),
    });
    // Bot User-Agent must be ignored
    await fetch(`${harness.baseUrl}/api/featured/${appReqId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' },
      body: JSON.stringify({ eventType: 'impression', sessionId: 'bot_sess' }),
    });
    // Member joins group with featuredRequestId attribution
    const joinRes = await fetch(`${harness.baseUrl}/api/groups/${activeGroupA1Id}/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ featuredRequestId: appReqId }),
    });
    assert.equal(joinRes.status, 200);

    // Merchant A views performance report -> sees 2 impressions, 1 uniqueViewer, 1 click, 1 join; Merchant B blocked (403)
    const statsA = await fetch(`${harness.baseUrl}/api/merchant/featured/${appReqId}/stats`, {
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant' },
    });
    assert.equal(statsA.status, 200);
    const statsJson = await statsA.json();
    assert.equal(statsJson.stats.totals.impressions, 2);
    assert.equal(statsJson.stats.totals.uniqueViewers, 1);
    assert.equal(statsJson.stats.totals.clicks, 1);
    assert.equal(statsJson.stats.totals.joins, 1);

    const statsBForbidden = await fetch(`${harness.baseUrl}/api/merchant/featured/${appReqId}/stats`, {
      headers: { Authorization: `Bearer ${merchantBToken}`, 'x-buyoll-role': 'merchant' },
    });
    assert.equal(statsBForbidden.status, 403);

    // 5. Simulate exact UTC/EAT expiry -> sweep removes product from Featured immediately
    await runDatabaseTransaction(async (db) => {
      const target = (db.featuredRequests || []).find((r) => r.id === appReqId)!;
      target.endsAt = Date.now() - 5000;
    });
    await sweepFeaturedPlacements(Date.now());

    const pubAfterExpiry = await fetch(`${harness.baseUrl}/api/featured?placement=homepage_featured`);
    const pubAfterJson = await pubAfterExpiry.json();
    assert.equal(
      pubAfterJson.items.some((it: any) => it.featuredRequestId === appReqId),
      false,
      'Expired featured item must no longer appear in GET /api/featured'
    );

    const prodAfterExpiry = await (await fetch(`${harness.baseUrl}/api/products/${eligibleProdA1Id}`)).json();
    assert.equal(prodAfterExpiry.product.isFeatured, false);
  });

  it('prevents duplicate announcements and enforces admin-only manual announcement security', async () => {
    // Non-admin cannot post manual admin announcement -> 403
    const merchAnnTry = await fetch(`${harness.baseUrl}/api/admin/announcements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hack notice', body: 'Should be rejected' }),
    });
    assert.equal(merchAnnTry.status, 403);

    // Create a group inside draft product, publish it once -> creates 1 announcement row, preserves createdAt
    const gRes = await fetch(`${harness.baseUrl}/api/groups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: draftProdId, size: 10 }),
    });
    assert.equal(gRes.status, 201);

    const dbBefore = await getDatabase();
    const originalCreatedAt = dbBefore.products.find((p) => p.id === draftProdId)!.createdAt;

    const pubRes = await fetch(`${harness.baseUrl}/api/products/${draftProdId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant' },
    });
    assert.equal(pubRes.status, 200);
    const publishedCreatedAt = (await pubRes.json()).product.createdAt;
    assert.ok(publishedCreatedAt >= originalCreatedAt);

    // Edit product, approve featured placement for Merchant B, and ensure product createdAt never changes & no duplicate announcement rows
    const editRes = await fetch(`${harness.baseUrl}/api/products/${draftProdId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${merchantAToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Draft Mixer A Updated' }),
    });
    assert.equal(editRes.status, 200);

    const dbMid = await getDatabase();
    const draftProdAfter = dbMid.products.find((p) => p.id === draftProdId)!;
    assert.equal(draftProdAfter.createdAt, publishedCreatedAt, 'Editing must preserve published product.createdAt');

    const pendingB = (dbMid.featuredRequests || []).find(
      (r) => r.merchantId === merchantBId && r.status === 'PENDING_APPROVAL'
    );
    assert.ok(pendingB, 'Merchant B pending featured request should exist');
    const origBCreatedAt = dbMid.products.find((p) => p.id === pendingB!.productId)!.createdAt;
    const appBRes = await fetch(`${harness.baseUrl}/api/admin/featured/${pendingB!.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(appBRes.status, 200);

    const dbAfterFeat = await getDatabase();
    assert.equal(
      dbAfterFeat.products.find((p) => p.id === pendingB!.productId)!.createdAt,
      origBCreatedAt,
      'Featuring must preserve product.createdAt'
    );

    const matchingAnns = dbAfterFeat.announcements.filter((a) => a.productId === draftProdId);
    assert.equal(matchingAnns.length, 1, 'Publishing/editing must create at most 1 system announcement row per product');
    assert.equal(matchingAnns[0].isSystemGenerated, true);

    const matchingBAnns = dbAfterFeat.announcements.filter((a) => a.productId === pendingB!.productId);
    assert.ok(matchingBAnns.length <= 1, 'Featuring must not create duplicate announcement rows');

    // Re-running migration 013 is idempotent
    const migResult = await runPendingMigrations(dbAfterFeat);
    assert.equal(migResult.applied.length, 0);
    await saveDatabase(dbAfterFeat);
  });
});
