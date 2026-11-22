import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction } from '../server/db.js';
import { assertWalletLedgerConsistency, assertWalletAndDepositConstraints } from '../server/wallet_service.js';
import { rollbackLastMigration, runPendingMigrations } from '../server/migrations.js';

describe('Complete Merchant Deposit Request, Admin Approval Queue & Wallet Integration', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('resolves merchant & wallet from authenticated session only, auto-generates references, handles idempotency, admin approve/decline, and wallet spend', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    // Seed verified merchant with 0 wallet balance, 1 live product + 1 active group
    let merchantId = 0;
    let merchantPlatformId = '';
    let merchantEmail = '';
    let productId = 0;

    await runDatabaseTransaction(async (db) => {
      merchantId = db.nextIds.user++;
      merchantPlatformId = `BYL-DEP-${merchantId}`;
      merchantEmail = `deposit_merchant_${merchantId}@buyoll.test`;

      db.users.push({
        id: merchantId,
        uuid: `merchant-dep-flow-${merchantId}`,
        name: 'Kibali Traders',
        shopName: 'Kibali Electronics Westlands',
        username: `kibali_${merchantId}`,
        usernameDisplay: `kibali_${merchantId}`,
        usernameLower: `kibali_${merchantId}`,
        usernameNormalized: `kibali_${merchantId}`,
        email: merchantEmail,
        phone: `+254744100${String(merchantId).slice(-3).padStart(3, '0')}`,
        phoneNormalized: `254744100${String(merchantId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        platformId: merchantPlatformId,
        verified: true,
        isDisabled: false,
        isSuspended: false,
        credit: 0,
        coins: 0,
        points: 0,
        roleWallets: {
          merchant: { credit: 0, balance: 0, coins: 0, points: 0 },
        },
        createdAt: Date.now(),
      } as any);

      productId = db.nextIds.product++;
      db.products.push({
        id: productId,
        vendorId: merchantId,
        vendorName: 'Kibali Electronics Westlands',
        title: 'Kibali Pro Solar Inverter 2KVA',
        description: 'High efficiency hybrid solar inverter for homes and shops.',
        price: 25000,
        category: 'Electronics',
        images: ['/images/solar_power.jpg'],
        stock: 15,
        live: true,
        publicationStatus: 'posted',
        moderationStatus: 'approved',
        speedOptions: [1, 5, 10],
        stockQuantity: 15,
        createdAt: Date.now(),
      } as any);

      const groupId = db.nextIds.group++;
      db.groups.push({
        id: groupId,
        productId,
        productTitle: 'Kibali Pro Solar Inverter 2KVA',
        productPrice: 25000,
        productImage: '/images/solar_power.jpg',
        vendorId: merchantId,
        name: 'Westlands Solar Cycle #1',
        size: 5,
        occupiedCount: 0,
        status: 'active',
        createdAt: Date.now(),
        slots: Array.from({ length: 5 }, (_, i) => ({
          slotNumber: i + 1,
          status: 'available',
          paidAmount: 0,
          targetAmount: 25000,
        })),
      } as any);
    });

    const merchantToken = await harness.issueToken(merchantId, 'merchant');

    // 1. Authenticated merchant submits deposit without manual M-Pesa code -> auto-generates unique DEP reference and persists merchantId & walletId
    const idemKey1 = `test_dep_auto_${Date.now()}`;
    const autoDepRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        role: 'merchant',
        amount: 2500,
        paymentMethod: 'Bank Transfer',
        notes: 'Float top-up without manual M-Pesa code',
        idempotencyKey: idemKey1,
      }),
    });
    assert.equal(autoDepRes.status, 201);
    const autoDepData = await autoDepRes.json() as any;
    assert.equal(autoDepData.success, true);
    assert.equal(autoDepData.deposit.amount, 2500);
    assert.equal(autoDepData.deposit.userId, merchantId);
    assert.equal(autoDepData.deposit.merchantId, merchantId);
    assert.equal(autoDepData.deposit.walletId, `wal_${merchantId}_merchant`);
    assert.equal(autoDepData.deposit.workflowStatus, 'PENDING');
    assert.equal(autoDepData.deposit.paymentMethod, 'Bank Transfer');
    assert.ok(autoDepData.deposit.referenceNumber?.startsWith('DEP-'), 'Expected auto-generated DEP-YYYYMMDD-XXXXXX referenceNumber');
    assert.ok(autoDepData.deposit.mpesaCode?.startsWith('DEP'), 'Expected auto-generated DEP code');
    assert.ok(autoDepData.adminPaymentQueue?.paymentId, 'Expected linked payment queue entry');

    // Duplicate idempotencyKey returns existing submission without duplicating rows
    const dupIdemRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        role: 'merchant',
        amount: 2500,
        paymentMethod: 'Bank Transfer',
        idempotencyKey: idemKey1,
      }),
    });
    assert.equal(dupIdemRes.status, 200);
    const dupIdemData = await dupIdemRes.json() as any;
    assert.equal(dupIdemData.deduplicated, true);
    assert.equal(dupIdemData.deposit.id, autoDepData.deposit.id);

    // 2. Verify Admin Payment Queue & Wallet Deposits Queue receive enriched merchant metadata
    const adminPaymentsRes = await fetch(`${harness.baseUrl}/api/admin/payments?status=pending&limit=25`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-buyoll-role': 'admin',
      },
    });
    assert.equal(adminPaymentsRes.status, 200);
    const adminPaymentsData = await adminPaymentsRes.json() as any;
    const queuedPayment = adminPaymentsData.payments.find(
      (p: any) => p.id === autoDepData.adminPaymentQueue.paymentId
    );
    assert.ok(queuedPayment, 'Submitted deposit must appear in /api/admin/payments');
    assert.equal(queuedPayment.shopName, 'Kibali Electronics Westlands');
    assert.equal(queuedPayment.userEmail, merchantEmail);
    assert.equal(queuedPayment.platformId, merchantPlatformId);
    assert.equal(queuedPayment.paymentMethod, 'Bank Transfer');
    assert.equal(queuedPayment.referenceNumber, autoDepData.deposit.referenceNumber);
    assert.equal(queuedPayment.isAutoReference, true);
    assert.equal(queuedPayment.verificationFlag, 'auto_reference');
    assert.equal(queuedPayment.workflowStatus, 'PENDING');

    const adminDepositsRes = await fetch(`${harness.baseUrl}/api/admin/wallet-deposits?status=pending`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-buyoll-role': 'admin',
      },
    });
    assert.equal(adminDepositsRes.status, 200);
    const adminDepositsData = await adminDepositsRes.json() as any;
    const queuedDep = adminDepositsData.deposits.find((d: any) => d.id === autoDepData.deposit.id);
    assert.ok(queuedDep, 'Submitted deposit must appear in /api/admin/wallet-deposits');
    assert.equal(queuedDep.shopName, 'Kibali Electronics Westlands');
    assert.equal(queuedDep.paymentMethod, 'Bank Transfer');

    // 3. Before approval, insufficient wallet balance check for subscription returns structured shortfall metadata
    const subShortfallRes = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        planId: 'tier_500',
        paymentMethod: 'wallet',
        billingPeriod: 'monthly',
      }),
    });
    assert.equal(subShortfallRes.status, 400);
    const subShortfallData = await subShortfallRes.json() as any;
    assert.equal(subShortfallData.error?.code, 'INSUFFICIENT_BALANCE');
    assert.equal(subShortfallData.requiredKes, 500);
    assert.equal(subShortfallData.availableKes, 0);
    assert.equal(subShortfallData.shortfallKes, 500);
    assert.equal(subShortfallData.canDeposit, true);

    // 4. Concurrent & duplicate Admin approval attempts on BOTH endpoints credit wallet ONCE ONLY (exact KSh 2,500)
    const [approveRes1, approveRes2, approveRes3] = await Promise.all([
      fetch(`${harness.baseUrl}/api/admin/payments/${queuedPayment.id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ decision: 'approve' }),
      }),
      fetch(`${harness.baseUrl}/api/admin/wallet-deposits/${encodeURIComponent(autoDepData.deposit.id)}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'approve' }),
      }),
      fetch(`${harness.baseUrl}/api/admin/payments/${queuedPayment.id}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ decision: 'approve' }),
      }),
    ]);

    const statuses = [approveRes1.status, approveRes2.status, approveRes3.status];
    assert.equal(statuses.filter((s) => s === 200).length, 1, `Exactly one concurrent approval must succeed (got ${statuses.join(', ')})`);

    const historyAfterApproveRes = await fetch(
      `${harness.baseUrl}/api/wallet/history?role=merchant`,
      {
        headers: {
          Authorization: `Bearer ${merchantToken}`,
          'x-buyoll-role': 'merchant',
        },
      }
    );
    assert.equal(historyAfterApproveRes.status, 200);
    const historyAfterApprove = await historyAfterApproveRes.json() as any;
    assert.equal(historyAfterApprove.balanceKes, 2500);
    assert.equal(historyAfterApprove.balanceCents, 250000);
    const approvedDepRecord = historyAfterApprove.deposits.find((d: any) => d.id === autoDepData.deposit.id);
    assert.equal(approvedDepRecord.workflowStatus, 'APPROVED');
    assert.equal(approvedDepRecord.balanceAfterKes, 2500);

    // 5. Submit second deposit & test Admin Decline validation + non-credit + declineReason visibility
    const depToDeclineRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        role: 'merchant',
        amount: 900,
        paymentMethod: 'M-Pesa Paybill 522533',
        mpesaCode: 'DEC9988776',
        notes: 'Will be declined in test',
      }),
    });
    assert.equal(depToDeclineRes.status, 201);
    const depToDeclineData = await depToDeclineRes.json() as any;

    const shortReasonRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${encodeURIComponent(depToDeclineData.deposit.id)}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'decline', reason: 'no' }),
      }
    );
    assert.equal(shortReasonRes.status, 400, 'Decline without >= 3 char reason must return 400');

    const declineOkRes = await fetch(
      `${harness.baseUrl}/api/admin/payments/${depToDeclineData.adminPaymentQueue.paymentId}/decision`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ decision: 'reject', reason: 'Receipt not found on Paybill 522533 statement' }),
      }
    );
    assert.equal(declineOkRes.status, 200);

    const merchantDepsRes = await fetch(
      `${harness.baseUrl}/api/wallet/deposits?role=merchant`,
      {
        headers: {
          Authorization: `Bearer ${merchantToken}`,
          'x-buyoll-role': 'merchant',
        },
      }
    );
    assert.equal(merchantDepsRes.status, 200);
    const merchantDepsData = await merchantDepsRes.json() as any;
    const declinedDep = merchantDepsData.deposits.find((d: any) => d.id === depToDeclineData.deposit.id);
    assert.equal(declinedDep.status, 'declined');
    assert.equal(declinedDep.workflowStatus, 'DECLINED');
    assert.equal(declinedDep.declineReason, 'Receipt not found on Paybill 522533 statement');

    // Wallet balance stays exactly 2500 after decline
    const dbCheckAfterDecline = await getDatabase();
    const merchantUserAfterDecline = dbCheckAfterDecline.users.find((u) => u.id === merchantId)!;
    assert.equal(merchantUserAfterDecline.roleWallets?.merchant?.credit, 2500);

    // 6. Merchant activates Growing Merchant (KSh 500) subscription using wallet + idempotencyKey
    const subIdemKey = `sub_idem_${Date.now()}`;
    const subActivateRes = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        planId: 'tier_500',
        paymentMethod: 'wallet',
        billingPeriod: 'monthly',
        idempotencyKey: subIdemKey,
      }),
    });
    assert.equal(subActivateRes.status, 201);
    const subActivateData = await subActivateRes.json() as any;
    assert.equal(subActivateData.request.status, 'approved');

    // Duplicate idempotent subscription call must NOT charge twice
    const subDupRes = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        planId: 'tier_500',
        paymentMethod: 'wallet',
        billingPeriod: 'monthly',
        idempotencyKey: subIdemKey,
      }),
    });
    assert.equal(subDupRes.status, 200);
    const subDupData = await subDupRes.json() as any;
    assert.equal(subDupData.deduplicated, true);

    // Wallet balance should be 2500 - 500 = 2000
    const histAfterSub = await fetch(`${harness.baseUrl}/api/wallet/history?role=merchant`, {
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
    }).then((r) => r.json()) as any;
    assert.equal(histAfterSub.balanceKes, 2000);

    // 7. Merchant pays for 7-day Featured placement (KSh 250) from wallet balance (2000 -> 1750)
    const featOkRes = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        productId,
        placementKey: 'homepage_featured',
        durationDays: 7,
        idempotencyKey: `feat_ok_${Date.now()}`,
      }),
    });
    assert.equal(featOkRes.status, 201);
    const featOkData = await featOkRes.json() as any;
    assert.ok(featOkData.request?.id);
    assert.equal(featOkData.walletBalanceKes, 1750);

    // 8. Seed a low-balance subscribed merchant (KSh 20) and verify Featured Request returns structured INSUFFICIENT_BALANCE
    let lowMerchantId = 0;
    let lowProductId = 0;
    await runDatabaseTransaction(async (db) => {
      lowMerchantId = db.nextIds.user++;
      db.users.push({
        id: lowMerchantId,
        uuid: `low-merchant-${lowMerchantId}`,
        name: 'Low Balance Store',
        shopName: 'Low Balance Shop',
        username: `low_${lowMerchantId}`,
        email: `low_${lowMerchantId}@buyoll.test`,
        phone: `+254744900${String(lowMerchantId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        platformId: `BYL-LOW-${lowMerchantId}`,
        verified: true,
        isDisabled: false,
        isSuspended: false,
        merchantSubscriptionStatus: 'active',
        merchantSubscriptionTierId: 'tier_500',
        merchantSubscriptionExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        credit: 20,
        roleWallets: {
          merchant: { credit: 20, balance: 20, coins: 0, points: 0 },
        },
        createdAt: Date.now(),
      } as any);
      if (!db.wallets) db.wallets = [];
      db.wallets.push({
        id: `wal_${lowMerchantId}_merchant`,
        userId: lowMerchantId,
        role: 'merchant',
        balanceCents: 2000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      db.merchantSubscriptions.push({
        id: `sub_low_${lowMerchantId}`,
        merchantId: lowMerchantId,
        tierId: 'tier_500',
        tierName: 'Growing Merchant',
        status: 'active',
        amount: 500,
        billingPeriod: 'monthly',
        startedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
      } as any);
      lowProductId = db.nextIds.product++;
      db.products.push({
        id: lowProductId,
        vendorId: lowMerchantId,
        vendorName: 'Low Balance Shop',
        title: 'Low Balance Item',
        description: 'Item to test insufficient wallet balance on featured request.',
        price: 5000,
        category: 'Electronics',
        images: ['/images/solar_power.jpg'],
        stockQuantity: 5,
        live: true,
        publicationStatus: 'posted',
        moderationStatus: 'approved',
        speedOptions: [1, 5],
        createdAt: Date.now(),
      } as any);
      const lowGrpId = db.nextIds.group++;
      db.groups.push({
        id: lowGrpId,
        productId: lowProductId,
        productTitle: 'Low Balance Item',
        productPrice: 5000,
        vendorId: lowMerchantId,
        name: 'Low Balance Group',
        size: 5,
        occupiedCount: 0,
        status: 'active',
        createdAt: Date.now(),
        slots: Array.from({ length: 5 }, (_, i) => ({
          slotNumber: i + 1,
          status: 'available',
          paidAmount: 0,
          targetAmount: 5000,
        })),
      } as any);
    });
    const lowMerchantToken = await harness.issueToken(lowMerchantId, 'merchant');
    const featFailRes = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${lowMerchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        productId: lowProductId,
        placementKey: 'homepage_featured',
        durationDays: 1,
        idempotencyKey: `feat_fail_${Date.now()}`,
      }),
    });
    assert.equal(featFailRes.status, 400);
    const featFailData = await featFailRes.json() as any;
    assert.equal(featFailData.error?.code, 'INSUFFICIENT_BALANCE');
    assert.equal(featFailData.requiredKes, 50);
    assert.equal(featFailData.availableKes, 20);
    assert.equal(featFailData.shortfallKes, 30);
    assert.equal(featFailData.canDeposit, true);

    // 9. Verify ledger reconciliation consistency on merchant wallet in fresh DB read
    const finalDb = await getDatabase();
    const merchantWallet = (finalDb.wallets || []).find(
      (w) => w.userId === merchantId && w.role === 'merchant'
    );
    assert.ok(merchantWallet, 'Merchant wallet record must persist in database');
    assertWalletLedgerConsistency(finalDb, merchantWallet.id);
  });

  it('rejects unauthenticated deposit attempts with 401 UNAUTHORIZED (never generic "select an active account")', async () => {
    const res = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 1000,
        role: 'merchant',
        merchantId: 999999,
      }),
    });
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.code, 'UNAUTHORIZED');
    assert.ok(!String(body.error).includes('select an active account'));
  });

  it('ignores client-sent account IDs, links deposit to authenticated session merchant & wallet, and credits only session merchant on approval', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();
    let merchantAId = 0;
    let merchantBId = 0;

    await runDatabaseTransaction(async (db) => {
      merchantAId = db.nextIds.user++;
      merchantBId = db.nextIds.user++;
      for (const [id, tag] of [
        [merchantAId, 'A'],
        [merchantBId, 'B'],
      ] as Array<[number, string]>) {
        db.users.push({
          id,
          uuid: `merch-spoof-${id}`,
          name: `Merchant ${tag}`,
          shopName: `Shop ${tag}`,
          username: `merch_spoof_${id}`,
          email: `merch_spoof_${id}@buyoll.test`,
          phone: `+254745100${String(id).slice(-3).padStart(3, '0')}`,
          password: 'hashed_test_password',
          role: 'merchant',
          roles: ['merchant'],
          activeRole: 'merchant',
          platformId: `BYL-SPF-${id}`,
          verified: true,
          isDisabled: false,
          isSuspended: false,
          credit: 0,
          roleWallets: { merchant: { credit: 0, balance: 0, coins: 0, points: 0 } },
          createdAt: Date.now(),
        } as any);
      }
    });

    const tokenA = await harness.issueToken(merchantAId, 'merchant');
    const depRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        amount: 1750,
        role: 'merchant',
        // Attempt to spoof Merchant B's identifiers
        userId: merchantBId,
        merchantId: merchantBId,
        platformId: `BYL-SPF-${merchantBId}`,
        email: `merch_spoof_${merchantBId}@buyoll.test`,
      }),
    });
    assert.equal(depRes.status, 201);
    const depData = await depRes.json() as any;
    assert.equal(depData.deposit.userId, merchantAId);
    assert.equal(depData.deposit.merchantId, merchantAId);
    assert.equal(depData.deposit.walletId, `wal_${merchantAId}_merchant`);

    const approveRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${encodeURIComponent(depData.deposit.id)}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'approve' }),
      }
    );
    assert.equal(approveRes.status, 200);

    const dbAfter = await getDatabase();
    const walletA = (dbAfter.wallets || []).find((w) => w.userId === merchantAId && w.role === 'merchant');
    const walletB = (dbAfter.wallets || []).find((w) => w.userId === merchantBId && w.role === 'merchant');
    assert.equal(walletA?.balanceCents, 175000);
    assert.equal(walletB?.balanceCents ?? 0, 0);
  });

  it('auto-recovers a missing wallet row during deposit for a legacy merchant without failing, then credits exact amount on approval', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();
    let legacyMerchantId = 0;

    await runDatabaseTransaction(async (db) => {
      legacyMerchantId = db.nextIds.user++;
      db.users.push({
        id: legacyMerchantId,
        uuid: `legacy-nowallet-${legacyMerchantId}`,
        name: 'Legacy NoWallet Merchant',
        shopName: 'Legacy Shop',
        username: `leg_nw_${legacyMerchantId}`,
        email: `leg_nw_${legacyMerchantId}@buyoll.test`,
        phone: `+254746100${String(legacyMerchantId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        platformId: `BYL-NW-${legacyMerchantId}`,
        verified: true,
        isDisabled: false,
        isSuspended: false,
        credit: 0,
        createdAt: Date.now(),
      } as any);
      // Explicitly verify no wallet row exists prior to deposit
      db.wallets = (db.wallets || []).filter((w) => w.userId !== legacyMerchantId);
    });

    const legacyToken = await harness.issueToken(legacyMerchantId, 'merchant');
    const depRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${legacyToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({ amount: 3200, role: 'merchant' }),
    });
    assert.equal(depRes.status, 201);
    const depData = await depRes.json() as any;
    assert.equal(depData.deposit.walletId, `wal_${legacyMerchantId}_merchant`);
    assert.equal(depData.deposit.merchantId, legacyMerchantId);

    const approveRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${encodeURIComponent(depData.deposit.id)}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'approve' }),
      }
    );
    assert.equal(approveRes.status, 200);

    const dbAfter = await getDatabase();
    const wallet = (dbAfter.wallets || []).find((w) => w.userId === legacyMerchantId && w.role === 'merchant');
    assert.ok(wallet);
    assert.equal(wallet.balanceCents, 320000);
  });

  it('returns specific error codes and messages for suspended, disabled, and non-merchant accounts', async () => {
    let suspendedId = 0;
    let disabledId = 0;
    let memberOnlyId = 0;

    await runDatabaseTransaction(async (db) => {
      suspendedId = db.nextIds.user++;
      db.users.push({
        id: suspendedId,
        uuid: `susp-${suspendedId}`,
        name: 'Suspended Merchant',
        username: `susp_${suspendedId}`,
        email: `susp_${suspendedId}@buyoll.test`,
        phone: `+254747100${String(suspendedId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        isSuspended: true,
        suspendReason: 'Pending KYC audit review',
        isDisabled: false,
        credit: 0,
        createdAt: Date.now(),
      } as any);

      disabledId = db.nextIds.user++;
      db.users.push({
        id: disabledId,
        uuid: `dis-${disabledId}`,
        name: 'Disabled Merchant',
        username: `dis_${disabledId}`,
        email: `dis_${disabledId}@buyoll.test`,
        phone: `+254747200${String(disabledId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        isSuspended: false,
        isDisabled: true,
        disabledReason: 'Closed merchant store',
        credit: 0,
        createdAt: Date.now(),
      } as any);

      memberOnlyId = db.nextIds.user++;
      db.users.push({
        id: memberOnlyId,
        uuid: `mem-${memberOnlyId}`,
        name: 'Member Only User',
        username: `mem_${memberOnlyId}`,
        email: `mem_${memberOnlyId}@buyoll.test`,
        phone: `+254747300${String(memberOnlyId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'member',
        roles: ['member'],
        activeRole: 'member',
        isSuspended: false,
        isDisabled: false,
        credit: 0,
        createdAt: Date.now(),
      } as any);
    });

    const suspToken = await harness.issueToken(suspendedId, 'merchant');
    const suspRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${suspToken}` },
      body: JSON.stringify({ amount: 500, role: 'merchant' }),
    });
    assert.equal(suspRes.status, 403);
    const suspData = await suspRes.json() as any;
    assert.equal(suspData.code, 'ACCOUNT_SUSPENDED');
    assert.ok(String(suspData.error).includes('Pending KYC audit review'));

    const disToken = await harness.issueToken(disabledId, 'merchant');
    const disRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${disToken}` },
      body: JSON.stringify({ amount: 500, role: 'merchant' }),
    });
    assert.equal(disRes.status, 403);
    const disData = await disRes.json() as any;
    assert.equal(disData.code, 'ACCOUNT_DISABLED');

    const memToken = await harness.issueToken(memberOnlyId, 'member');
    const memRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memToken}` },
      body: JSON.stringify({ amount: 500, role: 'merchant' }),
    });
    assert.equal(memRes.status, 403);
    const memData = await memRes.json() as any;
    assert.equal(memData.code, 'MERCHANT_ACCOUNT_NOT_FOUND');
  });

  it('requires account selection ONLY when a user genuinely holds multiple merchant accounts', async () => {
    let multiMerchantId = 0;
    await runDatabaseTransaction(async (db) => {
      multiMerchantId = db.nextIds.user++;
      db.users.push({
        id: multiMerchantId,
        uuid: `multi-${multiMerchantId}`,
        name: 'Multi Store Owner',
        shopName: 'Main Store',
        username: `multi_${multiMerchantId}`,
        email: `multi_${multiMerchantId}@buyoll.test`,
        phone: `+254748100${String(multiMerchantId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        verified: true,
        isDisabled: false,
        isSuspended: false,
        credit: 0,
        merchantAccounts: [
          {
            id: `macc_${multiMerchantId}_1`,
            merchantId: multiMerchantId,
            shopName: 'Westlands Branch',
            walletId: `wal_${multiMerchantId}_merchant`,
            isActive: true,
            createdAt: Date.now(),
          },
          {
            id: `macc_${multiMerchantId}_2`,
            merchantId: multiMerchantId,
            shopName: 'Kilimani Branch',
            walletId: `wal_${multiMerchantId}_merchant`,
            isActive: true,
            createdAt: Date.now(),
          },
        ],
        createdAt: Date.now(),
      } as any);
    });

    const multiToken = await harness.issueToken(multiMerchantId, 'merchant');

    // Missing merchantAccountId -> 400 MULTIPLE_MERCHANT_ACCOUNTS_SELECT_REQUIRED
    const missingSelRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${multiToken}` },
      body: JSON.stringify({ amount: 800, role: 'merchant' }),
    });
    assert.equal(missingSelRes.status, 400);
    const missingSelData = await missingSelRes.json() as any;
    assert.equal(missingSelData.code, 'MULTIPLE_MERCHANT_ACCOUNTS_SELECT_REQUIRED');
    assert.equal(missingSelData.meta?.merchantAccounts?.length, 2);

    // Invalid/foreign merchantAccountId -> 403 MERCHANT_ACCOUNT_ACCESS_DENIED
    const foreignSelRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${multiToken}` },
      body: JSON.stringify({ amount: 800, role: 'merchant', merchantAccountId: 'macc_foreign_999' }),
    });
    assert.equal(foreignSelRes.status, 403);
    const foreignSelData = await foreignSelRes.json() as any;
    assert.equal(foreignSelData.code, 'MERCHANT_ACCOUNT_ACCESS_DENIED');

    // Valid owned merchantAccountId -> 201
    const okSelRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${multiToken}` },
      body: JSON.stringify({ amount: 800, role: 'merchant', merchantAccountId: `macc_${multiMerchantId}_2` }),
    });
    assert.equal(okSelRes.status, 201);
    const okSelData = await okSelRes.json() as any;
    assert.equal(okSelData.deposit.merchantAccountId, `macc_${multiMerchantId}_2`);
    assert.equal(okSelData.deposit.walletId, `wal_${multiMerchantId}_merchant`);
  });

  it('creates merchant wallet automatically at merchant signup and supports immediate deposit -> approval -> exact balance credit', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();
    const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const signupPhone = `+25479${String(Date.now()).slice(-7)}`;

    const regRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fresh Signup Merchant',
        username: `freshmerch_${uniqueSuffix}`,
        email: `freshmerch_${uniqueSuffix}@buyoll.test`,
        phone: signupPhone,
        password: 'StrongPassword123!',
        role: 'merchant',
        shopName: 'Fresh Mart Nairobi',
        category: 'Electronics',
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json() as any;
    const newMerchantId = regData.user.id;
    const signupToken = regData.accessToken;
    assert.ok(signupToken, 'Signup must return accessToken');

    // Verify wallet row exists immediately after signup before any deposit
    const dbAfterSignup = await getDatabase();
    const createdWallet = (dbAfterSignup.wallets || []).find(
      (w) => w.userId === newMerchantId && w.role === 'merchant'
    );
    assert.ok(createdWallet, 'Wallet must be automatically created in wallets table at merchant signup');
    assert.equal(createdWallet.balanceCents, 0);

    // Submit deposit immediately with signup session token
    const depRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signupToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        amount: 4350,
        paymentMethod: 'M-Pesa Till 196853',
      }),
    });
    assert.equal(depRes.status, 201);
    const depData = await depRes.json() as any;
    assert.equal(depData.deposit.merchantId, newMerchantId);
    assert.equal(depData.deposit.walletId, createdWallet.id);

    // Admin approves deposit -> wallet credited by exact amount (4350 KES / 435000 cents)
    const approveRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${encodeURIComponent(depData.deposit.id)}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'approve' }),
      }
    );
    assert.equal(approveRes.status, 200);

    const dbAfterApprove = await getDatabase();
    const updatedWallet = (dbAfterApprove.wallets || []).find(
      (w) => w.userId === newMerchantId && w.role === 'merchant'
    );
    assert.equal(updatedWallet?.balanceCents, 435000);
    assertWalletLedgerConsistency(dbAfterApprove, createdWallet.id);
  });

  it('Migration 018 backfills missing wallets, repairs null merchantId/walletId/userId deposits, enforces NOT NULL & FK constraints, and is reversible', async () => {
    let brokenMerchantId = 0;
    let brokenDepId1 = '';
    let brokenDepId2 = '';

    await runDatabaseTransaction(async (db) => {
      // Roll back Migration 018 cleanly to simulate pre-migration state
      const rb = await rollbackLastMigration(db);
      assert.equal(rb.rolledBack, '018_wallet_deposit_constraints_and_backfill');

      brokenMerchantId = db.nextIds.user++;
      db.users.push({
        id: brokenMerchantId,
        uuid: `mig18-merch-${brokenMerchantId}`,
        name: 'Pre-Migration Merchant',
        shopName: 'Pre-Mig Shop',
        username: `premig_${brokenMerchantId}`,
        email: `premig_${brokenMerchantId}@buyoll.test`,
        phone: `+254749100${String(brokenMerchantId).slice(-3).padStart(3, '0')}`,
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        isDisabled: false,
        isSuspended: false,
        credit: 0,
        createdAt: Date.now(),
      } as any);
      db.wallets = (db.wallets || []).filter((w) => w.userId !== brokenMerchantId);

      // Deposit missing both merchantId and walletId
      brokenDepId1 = `wdep_mig18_a_${Date.now()}`;
      (db.walletDeposits as any[]).push({
        id: brokenDepId1,
        userId: brokenMerchantId,
        userName: 'Pre-Migration Merchant',
        userEmail: `premig_${brokenMerchantId}@buyoll.test`,
        role: 'merchant',
        merchantId: null,
        walletId: null,
        amount: 1200,
        amountCents: 120000,
        mpesaCode: `MIG18A${brokenMerchantId}`.slice(0, 10).toUpperCase(),
        status: 'pending',
        createdAt: Date.now(),
      });

      // Deposit with null userId recoverable via email + missing walletId
      brokenDepId2 = `wdep_mig18_b_${Date.now()}`;
      (db.walletDeposits as any[]).push({
        id: brokenDepId2,
        userId: null,
        userName: 'Pre-Migration Merchant',
        userEmail: `premig_${brokenMerchantId}@buyoll.test`,
        role: 'merchant',
        merchantId: null,
        walletId: null,
        amount: 650,
        amountCents: 65000,
        mpesaCode: `MIG18B${brokenMerchantId}`.slice(0, 10).toUpperCase(),
        status: 'pending',
        createdAt: Date.now(),
      });

      const migRes = await runPendingMigrations(db);
      assert.ok(migRes.applied.includes('018_wallet_deposit_constraints_and_backfill'));
    });

    const dbVerified = await getDatabase();
    const backfilledWallet = (dbVerified.wallets || []).find(
      (w) => w.userId === brokenMerchantId && w.role === 'merchant'
    );
    assert.ok(backfilledWallet, 'Migration 018 must backfill missing merchant wallet');

    const repaired1 = (dbVerified.walletDeposits || []).find((d) => d.id === brokenDepId1)!;
    assert.equal(repaired1.merchantId, brokenMerchantId);
    assert.equal(repaired1.walletId, backfilledWallet.id);

    const repaired2 = (dbVerified.walletDeposits || []).find((d) => d.id === brokenDepId2)!;
    assert.equal(repaired2.userId, brokenMerchantId);
    assert.equal(repaired2.merchantId, brokenMerchantId);
    assert.equal(repaired2.walletId, backfilledWallet.id);

    // Verify NOT NULL & FK constraint enforcement rejects invalid mutations
    assert.throws(
      () => {
        const cloned = structuredClone(dbVerified);
        cloned.walletDeposits.push({
          id: 'bad_null_wallet',
          userId: brokenMerchantId,
          userName: 'Pre-Migration Merchant',
          userPhone: `+254749100${String(brokenMerchantId).slice(-3).padStart(3, '0')}`,
          role: 'merchant',
          merchantId: brokenMerchantId,
          walletId: null,
          amount: 100,
          amountCents: 10000,
          mpesaCode: 'BADWALLET1',
          status: 'pending',
          createdAt: Date.now(),
        });
        assertWalletAndDepositConstraints(cloned);
      },
      (err: any) => err.code === 'CONSTRAINT_NOT_NULL'
    );

    assert.throws(
      () => {
        const cloned = structuredClone(dbVerified);
        cloned.walletDeposits.push({
          id: 'bad_fk_wallet',
          userId: brokenMerchantId,
          userName: 'Pre-Migration Merchant',
          userPhone: `+254749100${String(brokenMerchantId).slice(-3).padStart(3, '0')}`,
          role: 'merchant',
          merchantId: brokenMerchantId,
          walletId: 'wal_nonexistent_999',
          amount: 100,
          amountCents: 10000,
          mpesaCode: 'BADFKWAL01',
          status: 'pending',
          createdAt: Date.now(),
        });
        assertWalletAndDepositConstraints(cloned);
      },
      (err: any) => err.code === 'CONSTRAINT_FOREIGN_KEY'
    );

    assert.throws(
      () => {
        const cloned = structuredClone(dbVerified);
        cloned.walletDeposits.push({
          id: 'bad_null_merchant',
          userId: brokenMerchantId,
          userName: 'Pre-Migration Merchant',
          userPhone: `+254749100${String(brokenMerchantId).slice(-3).padStart(3, '0')}`,
          role: 'merchant',
          merchantId: null,
          walletId: backfilledWallet.id,
          amount: 100,
          amountCents: 10000,
          mpesaCode: 'BADMERCH01',
          status: 'pending',
          createdAt: Date.now(),
        });
        assertWalletAndDepositConstraints(cloned);
      },
      (err: any) => err.code === 'CONSTRAINT_NOT_NULL'
    );
  });
});
