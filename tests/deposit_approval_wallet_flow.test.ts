import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction } from '../server/db.js';
import { assertWalletLedgerConsistency } from '../server/wallet_service.js';

describe('Complete Merchant Deposit Request, Admin Approval Queue & Wallet Integration', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('submits frictionless deposit without Bearer/cookies, auto-generates unique references, handles idempotency, admin approve/decline, and wallet spend for subscription & featured', async () => {
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

    // 1. Submit deposit WITHOUT Authorization header or cookie, using account context + blank reference (auto-generated)
    const idemKey1 = `test_dep_auto_${Date.now()}`;
    const autoDepRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId,
        platformId: merchantPlatformId,
        email: merchantEmail,
        role: 'merchant',
        amount: 2500,
        paymentMethod: 'Bank Transfer',
        notes: 'Float top-up without manual M-Pesa code',
        idempotencyKey: idemKey1,
      }),
    });
    assert.equal(autoDepRes.status, 201, 'Deposit without Bearer/cookie must NEVER return 401 and must succeed with 201');
    const autoDepData = await autoDepRes.json() as any;
    assert.equal(autoDepData.success, true);
    assert.equal(autoDepData.deposit.amount, 2500);
    assert.equal(autoDepData.deposit.workflowStatus, 'PENDING');
    assert.equal(autoDepData.deposit.paymentMethod, 'Bank Transfer');
    assert.ok(autoDepData.deposit.referenceNumber?.startsWith('DEP-'), 'Expected auto-generated DEP-YYYYMMDD-XXXXXX referenceNumber');
    assert.ok(autoDepData.deposit.mpesaCode?.startsWith('DEP'), 'Expected auto-generated DEP code');
    assert.ok(autoDepData.adminPaymentQueue?.paymentId, 'Expected linked payment queue entry');

    // Duplicate idempotencyKey returns existing submission without duplicating rows
    const dupIdemRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId,
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
      `${harness.baseUrl}/api/wallet/history?userId=${merchantId}&role=merchant`
    );
    assert.equal(historyAfterApproveRes.status, 200, 'Wallet history with merchant userId must work seamlessly');
    const historyAfterApprove = await historyAfterApproveRes.json() as any;
    assert.equal(historyAfterApprove.balanceKes, 2500);
    assert.equal(historyAfterApprove.balanceCents, 250000);
    const approvedDepRecord = historyAfterApprove.deposits.find((d: any) => d.id === autoDepData.deposit.id);
    assert.equal(approvedDepRecord.workflowStatus, 'APPROVED');
    assert.equal(approvedDepRecord.balanceAfterKes, 2500);

    // 5. Submit second deposit & test Admin Decline validation + non-credit + declineReason visibility
    const depToDeclineRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: merchantId,
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
      `${harness.baseUrl}/api/wallet/deposits?userId=${merchantId}&role=merchant`
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
    const histAfterSub = await fetch(`${harness.baseUrl}/api/wallet/history?userId=${merchantId}&role=merchant`).then((r) => r.json()) as any;
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
        id: `wallet_${lowMerchantId}_merchant`,
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
});
