import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction } from '../server/db.js';
import { runPendingMigrations, rollbackLastMigration } from '../server/migrations.js';
import { toCents } from '../server/config.js';
import { isChunkLoadError } from '../src/components/AdminErrorBoundary.tsx';

describe('Unified Admin Wallet, Merchant M-Pesa Deposit Chain, Outbox, Reconciliation & Audit Log', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('blocks unauthenticated (401) and non-admin roles (403) across Admin Wallet, Exports, and Audit endpoints', async () => {
    const endpoints = [
      { method: 'GET', url: '/api/admin/wallet/summary' },
      { method: 'GET', url: '/api/admin/wallet/deposits' },
      { method: 'GET', url: '/api/admin/wallet/income?granularity=day' },
      { method: 'POST', url: '/api/admin/wallet/income' },
      { method: 'GET', url: '/api/admin/wallet/held' },
      { method: 'GET', url: '/api/admin/wallet/reconciliation' },
      { method: 'POST', url: '/api/admin/wallet/reconciliation/run' },
      { method: 'POST', url: '/api/admin/exports' },
      { method: 'GET', url: '/api/admin/audit-logs' },
      { method: 'GET', url: '/api/admin/wallet-deposits' },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${harness.baseUrl}${ep.url}`, {
        method: ep.method,
        headers: ep.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      assert.equal(res.status, 401, `Expected 401 unauthenticated for ${ep.method} ${ep.url}`);
    }

    const seededIds: Array<{ id: number; role: 'member' | 'merchant' | 'lender' }> = [];
    await runDatabaseTransaction(async (db) => {
      for (const role of ['member', 'merchant', 'lender'] as const) {
        const id = db.nextIds.user++;
        db.users.push({
          id,
          uuid: `rbac-${role}-${id}`,
          name: `RBAC ${role}`,
          username: `rbac_${role}_${id}`,
          usernameDisplay: `rbac_${role}_${id}`,
          usernameLower: `rbac_${role}_${id}`,
          usernameNormalized: `rbac_${role}_${id}`,
          email: `rbac_${role}_${id}@buyoll.test`,
          phone: `+254799000${String(id).padStart(3, '0')}`,
          phoneNormalized: `254799000${String(id).padStart(3, '0')}`,
          password: 'hashed_test_password',
          role,
          roles: [role],
          activeRole: role,
          platformId: `BYL-RBAC-${id}`,
          verified: true,
          isDisabled: false,
          isSuspended: false,
          credit: 0,
          coins: 0,
          points: 0,
          createdAt: Date.now(),
        } as any);
        seededIds.push({ id, role });
      }
    });

    for (const entry of seededIds) {
      const token = await harness.issueToken(entry.id, entry.role);
      for (const ep of endpoints) {
        const res = await fetch(`${harness.baseUrl}${ep.url}`, {
          method: ep.method,
          headers: {
            Authorization: `Bearer ${token}`,
            'x-buyoll-role': entry.role,
            ...(ep.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: ep.method === 'POST' ? JSON.stringify({}) : undefined,
        });
        assert.equal(
          res.status,
          403,
          `Expected 403 Forbidden for role=${entry.role} on ${ep.method} ${ep.url}`
        );
      }
    }
  });

  it('executes complete Merchant M-Pesa deposit -> Admin approval -> Exact wallet credit -> Subscription & Featured spend -> Revenue & Reconciliation PASSED', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    // Seed verified merchant account with zero balance
    let merchantId = 0;
    await runDatabaseTransaction(async (db) => {
      merchantId = db.nextIds.user++;
      db.users.push({
        id: merchantId,
        uuid: `merchant-e2e-${merchantId}`,
        name: 'Amani Electronics',
        shopName: 'Amani Electronics Nairobi',
        username: `amani_${merchantId}`,
        usernameDisplay: `amani_${merchantId}`,
        usernameLower: `amani_${merchantId}`,
        usernameNormalized: `amani_${merchantId}`,
        email: `amani_${merchantId}@buyoll.test`,
        phone: '+254712345678',
        phoneNormalized: '254712345678',
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        platformId: `BYL-M-${merchantId}`,
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
    });
    const merchantToken = await harness.issueToken(merchantId, 'merchant');

    // 1. Merchant submits M-Pesa deposit of KSh 5,000
    const depRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        amount: 5000,
        mpesaCode: 'MERCHDEP01',
        notes: 'Merchant float deposit',
        role: 'merchant',
      }),
    });
    assert.equal(depRes.status, 201);
    const depData = await depRes.json();
    assert.equal(depData.deposit.status, 'pending');
    const depositId1 = depData.deposit.id;

    // 2. Balance MUST remain 0 prior to Admin approval
    const meBefore = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant' },
    }).then((r) => r.json());
    assert.equal(meBefore.user.roleWallets.merchant.credit, 0);

    // 3. Deposit must be visible in Admin Wallet Deposits endpoint & searchable by phone/code
    const listRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet/deposits?status=pending&role=merchant&search=MERCHDEP01`,
      { headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' } }
    );
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.ok(listJson.deposits.some((d: any) => d.id === depositId1 && d.amount === 5000));

    // 4. Duplicate M-Pesa code globally rejected (409)
    const dupRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        amount: 2000,
        mpesaCode: 'MERCHDEP01',
        role: 'merchant',
      }),
    });
    assert.equal(dupRes.status, 409);

    // 5. Submit second deposit & test mandatory decline reason (400 if empty, success with reason)
    const depRes2 = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        amount: 1200,
        mpesaCode: 'MERCHBAD02',
        role: 'merchant',
      }),
    }).then((r) => r.json());

    const badDecline = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${depRes2.deposit.id}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'decline', reason: '' }),
      }
    );
    assert.equal(badDecline.status, 400);

    const goodDecline = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${depRes2.deposit.id}/decide`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ action: 'decline', reason: 'Code not present on Paybill statement' }),
      }
    );
    assert.equal(goodDecline.status, 200);

    // 6. Admin approves deposit #1 -> credits exact 5,000 KES to merchant wallet + creates outbox event
    const approveRes = await fetch(
      `${harness.baseUrl}/api/admin/wallet-deposits/${depositId1}/decide`,
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
    const approveJson = await approveRes.json();
    assert.equal(approveJson.deposit.status, 'approved');

    // Verify exact merchant wallet balance (5000 KES)
    const meAfter = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant' },
    }).then((r) => r.json());
    assert.equal(meAfter.user.roleWallets.merchant.credit, 5000);

    // Verify persistent Outbox queue received notification and can be acknowledged
    const outboxPending = await fetch(`${harness.baseUrl}/api/user/outbox/pending`, {
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant' },
    }).then((r) => r.json());
    assert.ok(outboxPending.events.some((e: any) => e.entityType === 'deposit' && e.payload?.status === 'approved'));

    const ackIds = outboxPending.events.map((e: any) => e.id);
    const ackRes = await fetch(`${harness.baseUrl}/api/user/outbox/ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({ ids: ackIds }),
    });
    assert.equal(ackRes.status, 200);

    const outboxAfterAck = await fetch(`${harness.baseUrl}/api/user/outbox/pending`, {
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant' },
    }).then((r) => r.json());
    assert.equal(outboxAfterAck.events.length, 0);

    // 7. Merchant purchases tier_500 Monthly Subscription using wallet (500 KES)
    const subRes = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
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
    assert.equal(subRes.status, 201);
    const subJson = await subRes.json();
    assert.equal(subJson.request.status, 'approved');

    // Merchant balance should now be 4500 KES
    const mePostSub = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant' },
    }).then((r) => r.json());
    assert.equal(mePostSub.user.roleWallets.merchant.credit, 4500);

    // 8. Seed a published product + open group for this merchant, then request 1-day Featured placement via wallet
    let productId = 0;
    await runDatabaseTransaction(async (db) => {
      productId = db.nextIds.product++;
      db.products.push({
        id: productId,
        vendorId: merchantId,
        vendorName: 'Amani Electronics Nairobi',
        title: 'Solar Fridge Pro 90L',
        category: 'Electronics',
        price: 25000,
        status: 'PUBLISHED',
        publicationStatus: 'published',
        live: true,
        moderationStatus: 'approved',
        stock: 10,
        images: ['/img/fridge.jpg'],
        description: 'High efficiency DC solar refrigerator.',
        createdAt: Date.now(),
      } as any);
      const groupId = db.nextIds.group++;
      db.groups.push({
        id: groupId,
        productId,
        productTitle: 'Solar Fridge Pro 90L',
        name: 'Solar Fridge 10-Member Group',
        size: 10,
        occupiedCount: 0,
        targetAmount: 25000,
        dailyAmount: 250,
        status: 'active',
        slots: Array.from({ length: 10 }, (_, idx) => ({
          slotNumber: idx + 1,
          status: 'open',
        })),
        createdAt: Date.now(),
      } as any);
    });

    const featReqRes = await fetch(`${harness.baseUrl}/api/merchant/featured`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        productId,
        placementKey: 'homepage_featured',
        durationDays: 1,
      }),
    });
    assert.equal(featReqRes.status, 201);
    const featReqJson = await featReqRes.json();
    const featReqId = featReqJson.request.id;

    // Approve Featured Placement as Admin
    const featApprRes = await fetch(`${harness.baseUrl}/api/admin/featured/${featReqId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'x-buyoll-role': 'admin',
      },
    });
    assert.equal(featApprRes.status, 200);
    const featApprJson = await featApprRes.json();
    assert.equal(featApprJson.request.status, 'ACTIVE');

    // 9. Admin records direct platform M-Pesa income (TRIP_DATING and AIRBUS_PLUS)
    for (const entry of [
      { source: 'TRIP_DATING', amountKes: 750, referenceId: 'TRIPMPESA01', description: 'Mombasa Trip booking fee' },
      { source: 'AIRBUS_PLUS', amountKes: 1500, referenceId: 'AIRPLUS01', description: 'AirbusPlus Pass subscription' },
    ]) {
      const incRes = await fetch(`${harness.baseUrl}/api/admin/wallet/income`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify(entry),
      });
      assert.equal(incRes.status, 201);
    }

    // Check Income Rollups across hour, day, month, year granularities
    for (const gran of ['hour', 'day', 'month', 'year']) {
      const incGet = await fetch(`${harness.baseUrl}/api/admin/wallet/income?granularity=${gran}`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
      });
      assert.equal(incGet.status, 200);
      const incJson = await incGet.json();
      assert.ok(Array.isArray(incJson.series) && incJson.series.length >= 1);
      const bySrc = new Map<string, any>((incJson.totalsBySource || []).map((t: any) => [t.source, t]));
      assert.ok(bySrc.get('SUBSCRIPTION').totalCents >= 50000);
      assert.ok(bySrc.get('FEATURED').totalCents >= 100);
      assert.equal(bySrc.get('TRIP_DATING').totalCents, 75000);
      assert.equal(bySrc.get('AIRBUS_PLUS').totalCents, 150000);
    }

    // 10. Verify Admin Wallet Summary & Held Balances by role
    const summaryRes = await fetch(`${harness.baseUrl}/api/admin/wallet/summary`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(summaryRes.status, 200);
    const summaryJson = await summaryRes.json();
    assert.ok(summaryJson.kpis.totalDepositsApprovedCents >= 500000);
    assert.ok(summaryJson.kpis.totalIncomeRevenueCents > 0);
    assert.ok(summaryJson.kpis.totalHeldInUserWalletsCents > 0);

    const heldRes = await fetch(`${harness.baseUrl}/api/admin/wallet/held?role=merchant`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(heldRes.status, 200);
    const heldJson = await heldRes.json();
    assert.ok(heldJson.summaryByRole.some((r: any) => r.role === 'merchant'));

    // 11. Run Reconciliation and confirm PASSED with diffCents === 0 and walletMismatchCount === 0
    const recRes = await fetch(`${harness.baseUrl}/api/admin/wallet/reconciliation/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(recRes.status, 200);
    const recJson = await recRes.json();
    assert.equal(recJson.report.status, 'PASSED');
    assert.equal(recJson.report.diffCents, 0);
    assert.equal(recJson.report.walletMismatchCount, 0);
  });

  it('detects ledger drift on reconciliation and logs WALLET_RECONCILIATION_MISMATCH audit event', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    // Introduce deliberate drift inside a wallet without touching walletLedger
    let driftedUserId = 0;
    let prevCents = 0;
    await runDatabaseTransaction(async (db) => {
      const walletsList = db.wallets || [];
      const targetWallet = walletsList.find((w) => w.role === 'merchant') || walletsList[0];
      assert.ok(targetWallet, 'Expected at least one wallet in DB');
      driftedUserId = targetWallet.userId;
      prevCents = targetWallet.balanceCents;
      targetWallet.balanceCents += toCents(777);
    });

    const mismatchRes = await fetch(`${harness.baseUrl}/api/admin/wallet/reconciliation/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(mismatchRes.status, 200);
    const mismatchJson = await mismatchRes.json();
    assert.equal(mismatchJson.report.status, 'MISMATCH');
    assert.ok(mismatchJson.report.walletMismatchCount >= 1);
    assert.notEqual(mismatchJson.report.diffCents, 0);

    // Verify audit log contains WALLET_RECONCILIATION_MISMATCH
    const auditRes = await fetch(
      `${harness.baseUrl}/api/admin/audit-logs?action=WALLET_RECONCILIATION_MISMATCH`,
      { headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' } }
    );
    assert.equal(auditRes.status, 200);
    const auditJson = await auditRes.json();
    assert.ok(auditJson.auditLogs.some((l: any) => l.action === 'WALLET_RECONCILIATION_MISMATCH'));

    // Restore wallet balance cleanly so subsequent tests start clean
    await runDatabaseTransaction(async (db) => {
      const walletsList = db.wallets || [];
      const targetWallet = walletsList.find((w) => w.userId === driftedUserId && w.role === 'merchant') || walletsList[0];
      if (targetWallet) targetWallet.balanceCents = prevCents;
    });
  });

  it('queues and completes async background CSV exports for wallets, users, and admin_wallet', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    for (const exportType of ['wallets', 'users', 'admin_wallet'] as const) {
      const createRes = await fetch(`${harness.baseUrl}/api/admin/exports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'x-buyoll-role': 'admin',
        },
        body: JSON.stringify({ type: exportType }),
      });
      assert.equal(createRes.status, 202);
      const { job } = await createRes.json();
      assert.ok(job.id);

      let completedJob: any = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 40));
        const pollRes = await fetch(`${harness.baseUrl}/api/admin/exports/${job.id}`, {
          headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
        });
        assert.equal(pollRes.status, 200);
        const pollData = await pollRes.json();
        if (pollData.job.status === 'completed') {
          completedJob = pollData.job;
          break;
        }
      }
      assert.ok(completedJob, `Export job ${exportType} did not complete in time`);

      const dlRes = await fetch(`${harness.baseUrl}/api/admin/exports/${job.id}/download`, {
        headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
      });
      assert.equal(dlRes.status, 200);
      assert.ok((dlRes.headers.get('content-type') || '').includes('text/csv'));
      const csv = await dlRes.text();
      assert.ok(csv.length > 20, `Expected non-empty CSV for ${exportType}`);
    }
  });

  it('preserves > 500 append-only audit logs and filters accurately by action and timestamp range', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();
    const baseTime = Date.now() - 10_000_000;

    await runDatabaseTransaction(async (db) => {
      for (let i = 1; i <= 525; i++) {
        db.auditLogs.push({
          id: db.nextIds.audit++,
          actorId: 1,
          actorName: 'Audit Verifier',
          action: i % 2 === 0 ? 'APPEND_TEST_EVEN' : 'APPEND_TEST_ODD',
          details: `Append-only verification entry #${i}`,
          timestamp: baseTime + i * 1000,
        });
      }
    });

    const allRes = await fetch(`${harness.baseUrl}/api/admin/audit-logs?page=1&limit=20`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    }).then((r) => r.json());
    assert.ok(allRes.pagination.total >= 525, `Expected >= 525 audit logs, got ${allRes.pagination.total}`);

    const filteredRes = await fetch(
      `${harness.baseUrl}/api/admin/audit-logs?action=APPEND_TEST_EVEN&after=${baseTime}&before=${baseTime + 200_000}&page=1&limit=50`,
      { headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' } }
    ).then((r) => r.json());
    assert.ok(filteredRes.auditLogs.length > 0);
    assert.ok(
      filteredRes.auditLogs.every(
        (l: any) =>
          l.action === 'APPEND_TEST_EVEN' &&
          l.timestamp >= baseTime &&
          l.timestamp <= baseTime + 200_000
      )
    );
  });

  it('verifies Migration 015 & 014 reversibility (down -> up), orphan WALLET-* cleanup, and chunk load retry detection helper', async () => {
    assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module')), true);
    assert.equal(isChunkLoadError(new Error('Regular error')), false);

    const db = await getDatabase();
    const rollback15 = await rollbackLastMigration(db);
    assert.equal(rollback15.rolledBack, '015_repair_legacy_wallet_subs_and_recon');

    const rollback14 = await rollbackLastMigration(db);
    assert.equal(rollback14.rolledBack, '014_admin_wallet_outbox_and_indexes');
    assert.equal(db.incomeLedger, undefined);
    assert.equal(db.outboxEvents, undefined);

    const reapplied = await runPendingMigrations(db);
    assert.ok(reapplied.applied.includes('014_admin_wallet_outbox_and_indexes'));
    assert.ok(reapplied.applied.includes('015_repair_legacy_wallet_subs_and_recon'));
    assert.ok(Array.isArray(db.incomeLedger));
    assert.ok(Array.isArray(db.outboxEvents));
    assert.ok(Array.isArray(db.reconciliationReports));
    assert.equal(db.reconciliationReports[0]?.status, 'PASSED');
    assert.equal(db.reconciliationReports[0]?.diffCents, 0);
  });

  it('activates /merchant/subscription/pay-coins atomically, frees merchant to create/publish products, flags WALLET-* cleanly without statement errors, and responds fast', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    // Seed verified merchant with 0 balance + a legacy WALLET-TEST01 pending payment row to verify matching flag
    let merchantId = 0;
    await runDatabaseTransaction(async (db) => {
      merchantId = db.nextIds.user++;
      db.users.push({
        id: merchantId,
        uuid: `merchant-paycoins-${merchantId}`,
        name: 'Kibera Tech Store',
        shopName: 'Kibera Tech Store',
        username: `kibera_${merchantId}`,
        usernameDisplay: `kibera_${merchantId}`,
        usernameLower: `kibera_${merchantId}`,
        usernameNormalized: `kibera_${merchantId}`,
        email: `kibera_${merchantId}@buyoll.test`,
        phone: '+254722111222',
        phoneNormalized: '254722111222',
        password: 'hashed_test_password',
        role: 'merchant',
        roles: ['merchant'],
        activeRole: 'merchant',
        merchantSubscriptionStatus: 'inactive',
        platformId: `BYL-M-${merchantId}`,
        verified: true,
        isDisabled: false,
        isSuspended: false,
        credit: 0,
        coins: 0,
        points: 0,
        roleWallets: { merchant: { credit: 0, balance: 0, coins: 0, points: 0 } },
        createdAt: Date.now(),
      } as any);

      db.payments.unshift({
        id: db.nextIds.payment++,
        userId: merchantId,
        userName: 'Kibera Tech Store',
        code: 'WALLET-LEG250',
        amount: 250,
        status: 'pending',
        type: 'merchant_subscription',
        channel: 'Merchant Wallet Credit (KES)',
        createdAt: Date.now(),
      });
    });
    const merchantToken = await harness.issueToken(merchantId, 'merchant');

    // Admin payments queue MUST classify WALLET-* as internal_wallet (never unmatched_code)
    const t0 = Date.now();
    const paymentsRes = await fetch(`${harness.baseUrl}/api/admin/payments?status=pending&page=1&limit=20`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    const elapsedMs = Date.now() - t0;
    assert.equal(paymentsRes.status, 200);
    assert.ok(elapsedMs < 2000, `Expected /admin/payments < 2000ms, got ${elapsedMs}ms`);
    const paymentsJson = await paymentsRes.json();
    const walPay = (paymentsJson.payments || []).find((p: any) => p.code === 'WALLET-LEG250');
    assert.ok(walPay, 'Expected WALLET-LEG250 in payments response');
    assert.equal(walPay.verificationFlag, 'internal_wallet');
    assert.equal(walPay.statementMatch.isInternalWallet, true);
    assert.equal(walPay.statementMatch.matched, true);

    // Merchant submits M-Pesa deposit -> Admin approves -> exact KSh 2,000 credited
    const depRes = await fetch(`${harness.baseUrl}/api/wallet/deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({ amount: 2000, mpesaCode: 'KIBERADEP1', role: 'merchant' }),
    }).then((r) => r.json());
    assert.equal(depRes.deposit.status, 'pending');

    const apprRes = await fetch(`${harness.baseUrl}/api/admin/wallet-deposits/${depRes.deposit.id}/decide`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'x-buyoll-role': 'admin',
      },
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(apprRes.status, 200);
    const apprJson = await apprRes.json();
    assert.equal(apprJson.newBalance, 2000);

    // Merchant pays subscription via /merchant/subscription/pay-coins -> instant active & NO pending payment row created
    const payRes = await fetch(`${harness.baseUrl}/api/merchant/subscription/pay-coins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({ tierId: 'tier_500', paymentMethod: 'wallet_credit', billingPeriod: 'monthly' }),
    });
    assert.equal(payRes.status, 200);
    const payJson = await payRes.json();
    assert.equal(payJson.subscription.status, 'active');
    assert.equal(payJson.user.merchantSubscriptionStatus, 'active');
    assert.equal(payJson.walletBalanceKes, 1500);

    // Merchant is now unlocked to create a product, add a group, and publish freely
    const createProdRes = await fetch(`${harness.baseUrl}/api/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        title: 'Inverter Blender 1200W',
        price: 6000,
        category: 'Home Appliances',
        description: 'Heavy duty blender.',
        images: ['/img/smart_tv.jpg'],
        stock: 5,
      }),
    });
    assert.equal(createProdRes.status, 201);
    const prodJson = await createProdRes.json();
    const createdProdId = prodJson.product.id;

    const createGrpRes = await fetch(`${harness.baseUrl}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
      body: JSON.stringify({
        productId: createdProdId,
        size: 10,
        paymentMode: 'platform',
      }),
    });
    assert.equal(createGrpRes.status, 201);

    const pubRes = await fetch(`${harness.baseUrl}/api/products/${createdProdId}/publish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${merchantToken}`,
        'x-buyoll-role': 'merchant',
      },
    });
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.product.live, true);

    // Reconciliation must still report PASSED with 0 discrepancy
    const recRun = await fetch(`${harness.baseUrl}/api/admin/wallet/reconciliation/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'x-buyoll-role': 'admin' },
    });
    assert.equal(recRun.status, 200);
    const recJson = await recRun.json();
    assert.equal(recJson.report.status, 'PASSED');
    assert.equal(recJson.report.diffCents, 0);
  });
});
