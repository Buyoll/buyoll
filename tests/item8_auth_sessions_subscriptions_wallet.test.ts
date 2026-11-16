import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, saveDatabase, runDatabaseTransaction } from '../server/db.js';
import {
  creditWalletCents,
  debitWalletCents,
  getWalletBalanceCents,
} from '../server/wallet_service.js';
import { enforceExpiredSubscriptions } from '../server/subscriptions_api.js';

describe('Item 8: Auth Hardening, Sessions/Idle Timeout, EAT Subscriptions & Single-Source Wallet', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('rejects x-user-id spoofing, blocks admin registration, enforces 3-field admin login & OTP recovery, and isolates per-role logout', async () => {
    // 1. x-user-id header spoofing must never authenticate
    const spoofRes = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { 'x-user-id': '1' },
    });
    assert.equal(spoofRes.status, 401);

    // 2. Admin self-registration is permanently closed
    const adminRegRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'admin',
        name: 'Fake Admin',
        username: 'fakeadmin',
        email: 'fakeadmin@example.com',
        password: 'Password123',
      }),
    });
    assert.equal(adminRegRes.status, 403);
    assert.equal((await adminRegRes.json()).error.code, 'ADMIN_REGISTRATION_CLOSED');

    // 3. Admin login missing passkey fails (422)
    const missingPasskey = await fetch(`${harness.baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: harness.adminCredentials.identifier,
        password: harness.adminCredentials.password,
      }),
    });
    assert.equal(missingPasskey.status, 422);

    // 4. Valid 3-field admin login succeeds and sets buyoll_admin cookie
    const adminRes = await fetch(`${harness.baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: harness.adminCredentials.identifier,
        password: harness.adminCredentials.password,
        passkey: harness.adminCredentials.passkey,
      }),
    });
    assert.equal(adminRes.status, 200);
    const adminSetCookie = adminRes.headers.get('set-cookie') || '';
    assert.ok(adminSetCookie.includes('buyoll_admin='));
    const adminCookiePair = adminSetCookie.split(';')[0];

    // 5. Register merchant -> get buyoll_merchant cookie -> logout admin ONLY -> merchant stays logged in!
    const merchReg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'merchant',
        name: 'Isolation Shop',
        username: 'isolation_shop',
        email: 'isolation.shop@example.com',
        password: 'Kilimanjaro#2026',
      }),
    });
    assert.equal(merchReg.status, 201);
    const merchSetCookie = merchReg.headers.get('set-cookie') || '';
    assert.ok(merchSetCookie.includes('buyoll_merchant='));
    const merchCookiePair = merchSetCookie.split(';')[0];
    const combinedCookies = `${adminCookiePair}; ${merchCookiePair}`;

    // Logout ONLY admin role
    const logoutAdmin = await fetch(`${harness.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: combinedCookies,
        'x-buyoll-role': 'admin',
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(logoutAdmin.status, 200);

    // Admin session cookie is now revoked
    const adminMeAfter = await fetch(`${harness.baseUrl}/api/auth/me?role=admin`, {
      headers: { Cookie: combinedCookies },
    });
    assert.equal(adminMeAfter.status, 401);

    // Merchant session cookie remains valid!
    const merchMeAfter = await fetch(`${harness.baseUrl}/api/auth/me?role=merchant`, {
      headers: { Cookie: combinedCookies },
    });
    assert.equal(merchMeAfter.status, 200);
    assert.equal((await merchMeAfter.json()).user.role, 'merchant');

    // 6. Admin security settings & banner snooze/dismiss
    const adminToken = (await harness.loginAdmin()).accessToken;
    const secRes = await fetch(`${harness.baseUrl}/api/admin/settings/security`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(secRes.status, 200);
    const secJson = await secRes.json();
    assert.equal(secJson.showSecurityBanner, true);

    const dismissRes = await fetch(`${harness.baseUrl}/api/admin/settings/security/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ mode: 'dismiss' }),
    });
    assert.equal(dismissRes.status, 200);
    assert.equal((await dismissRes.json()).showSecurityBanner, false);

    // 7. Admin 3-fail lockout test with wrong passkey (then reset lock via OTP recovery)
    for (let i = 0; i < 3; i++) {
      const bad = await fetch(`${harness.baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: harness.adminCredentials.identifier,
          password: harness.adminCredentials.password,
          passkey: 'WRONG_PASSKEY',
        }),
      });
      assert.equal(bad.status, i < 2 ? 401 : 429);
    }

    const lockedAdmin = await fetch(`${harness.baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: harness.adminCredentials.identifier,
        password: harness.adminCredentials.password,
        passkey: harness.adminCredentials.passkey,
      }),
    });
    assert.equal(lockedAdmin.status, 429);
    assert.equal((await lockedAdmin.json()).error.code, 'ACCOUNT_LOCKED');

    // Admin OTP recovery unlocks & rotates passkey cleanly
    const admStart = await fetch(`${harness.baseUrl}/api/admin/auth/forgot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: harness.adminCredentials.email }),
    }).then((r) => r.json());
    assert.ok(admStart.devOtp);

    const admVerify = await fetch(`${harness.baseUrl}/api/admin/auth/forgot/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: harness.adminCredentials.email, otp: admStart.devOtp }),
    }).then((r) => r.json());
    assert.ok(admVerify.verificationToken);

    const admReset = await fetch(`${harness.baseUrl}/api/admin/auth/forgot/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationToken: admVerify.verificationToken,
        newPasskey: harness.adminCredentials.passkey,
      }),
    });
    assert.equal(admReset.status, 200);

    const unlockedAdmin = await harness.loginAdmin();
    assert.ok(unlockedAdmin.accessToken);
  });

  it('normalizes usernames, preserves untrimmed special-char passwords, shows 3-fail recovery prompt, and supports OTP forgot password & username', async () => {
    // 1. Signup with untrimmed password ' 12345gg-// ' & punctuation username
    const reg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'member',
        name: 'Jane Doe',
        username: 'jane.doe_9',
        email: 'janedoe9@example.com',
        phone: '0799112233',
        password: ' 12345gg-// ',
      }),
    });
    assert.equal(reg.status, 201, await reg.clone().text());

    // 2. Normalized collision check returns exact conflict message
    const checkCol = await fetch(
      `${harness.baseUrl}/api/auth/username-available?username=${encodeURIComponent('JANE-DOE_9')}`
    ).then((r) => r.json());
    assert.equal(checkCol.available, false);
    assert.equal(checkCol.message, 'That username is not available. Please choose a different one.');

    const dupReg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'member',
        name: 'Another Jane',
        username: 'jane-doe9',
        email: 'janedoe9_other@example.com',
        password: 'LakeVictoria#2026',
      }),
    });
    assert.equal(dupReg.status, 409);

    // 3. Password is NEVER trimmed: trimmed password fails, exact spaces succeed
    const trimmedLogin = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'jane.doe_9', password: '12345gg-//' }),
    });
    assert.equal(trimmedLogin.status, 401);

    const exactLogin = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'jane.doe_9', password: ' 12345gg-// ' }),
    });
    assert.equal(exactLogin.status, 200);

    // 4. 3 failed login attempts triggers showRecoveryPrompt=true
    let thirdErr: any = null;
    for (let i = 0; i < 3; i++) {
      const fail = await fetch(`${harness.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'jane.doe_9', password: 'WrongPassword1' }),
      });
      assert.equal(fail.status, 401);
      thirdErr = await fail.json();
    }
    assert.equal(thirdErr?.error?.fields?.showRecoveryPrompt, 'true');

    // 5. Forgot Username OTP flow
    const uStart = await fetch(`${harness.baseUrl}/api/auth/forgot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'forgot_username', identifier: 'janedoe9@example.com' }),
    }).then((r) => r.json());
    assert.ok(uStart.devOtp);

    const uVerify = await fetch(`${harness.baseUrl}/api/auth/forgot/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'forgot_username',
        identifier: 'janedoe9@example.com',
        otp: uStart.devOtp,
      }),
    }).then((r) => r.json());
    assert.ok(uVerify.verificationToken);

    const uReset = await fetch(`${harness.baseUrl}/api/auth/forgot/reset-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationToken: uVerify.verificationToken,
        newUsername: 'janedoe_new9',
      }),
    });
    assert.equal(uReset.status, 200);

    // 6. Forgot Password OTP flow -> resets password & clears failure lockouts
    const pStart = await fetch(`${harness.baseUrl}/api/auth/forgot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'forgot_password', identifier: 'janedoe_new9' }),
    }).then((r) => r.json());
    assert.ok(pStart.devOtp);

    const pVerify = await fetch(`${harness.baseUrl}/api/auth/forgot/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'forgot_password',
        identifier: 'janedoe_new9',
        otp: pStart.devOtp,
      }),
    }).then((r) => r.json());
    assert.ok(pVerify.verificationToken);

    const pReset = await fetch(`${harness.baseUrl}/api/auth/forgot/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verificationToken: pVerify.verificationToken,
        newPassword: '12345gg-//',
      }),
    });
    assert.equal(pReset.status, 200);

    const loginAfterReset = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'janedoe_new9', password: '12345gg-//' }),
    });
    assert.equal(loginAfterReset.status, 200);
  });

  it('enforces 20-minute idle timeout (SESSION_IDLE_EXPIRED) and keepalive extension', async () => {
    const reg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'member',
        name: 'Idle Timer User',
        username: 'idletimer_u',
        email: 'idletimer@example.com',
        password: 'RiftValley#2026',
      }),
    }).then((r) => r.json());

    const token = reg.accessToken;
    const sessionId = reg.session.id;

    // Keepalive extends activity
    const ka = await fetch(`${harness.baseUrl}/api/auth/keepalive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    assert.equal(ka.status, 200);
    const kaJson = await ka.json();
    assert.equal(kaJson.ok, true);
    assert.ok(kaJson.idleExpiresAt > Date.now() + 19 * 60 * 1000);

    // Backdate lastActivityAt by 21 minutes -> next protected request fails with SESSION_IDLE_EXPIRED
    await runDatabaseTransaction(async (db) => {
      const s = db.sessions?.find((sess) => sess.id === sessionId);
      assert.ok(s);
      s!.lastActivityAt = Date.now() - 21 * 60 * 1000;
    });

    const expiredRes = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(expiredRes.status, 401);
    assert.equal((await expiredRes.json()).error.code, 'SESSION_IDLE_EXPIRED');
  });

  it('handles EAT subscription alarm (GREEN vs RED), expiry hiding without touching drafts, approval restoration, early-reset mode, one-time notices & integer-cents wallet ledger', async () => {
    const { accessToken: adminToken } = await harness.loginAdmin();

    // Register fresh merchant
    const merchReg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'merchant',
        name: 'Sub Lifecycle Shop',
        username: 'sublife_shop',
        email: 'sublife@example.com',
        password: 'MountKenya#2026',
        shopName: 'Sub Lifecycle Store',
      }),
    }).then((r) => r.json());
    const merchToken = merchReg.accessToken;
    const merchId = merchReg.user.id;

    // Submit & approve subscription
    const subReq = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${merchToken}` },
      body: JSON.stringify({
        planId: 'tier_500',
        paymentMethod: 'mpesa',
        mpesaCode: 'SUBLIFE001',
        billingPeriod: 'monthly',
      }),
    });
    assert.equal(subReq.status, 201);
    const reqId = (await subReq.json()).request.id;

    const approve1 = await fetch(`${harness.baseUrl}/api/admin/subscriptions/requests/${reqId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approve1.status, 200);

    // One-time activation notice created & cleared once seen
    const notices1 = await fetch(`${harness.baseUrl}/api/merchant/notices/pending`, {
      headers: { Authorization: `Bearer ${merchToken}` },
    }).then((r) => r.json());
    assert.equal(notices1.notices.length, 1);

    await fetch(`${harness.baseUrl}/api/merchant/notices/${notices1.notices[0].id}/seen`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchToken}` },
    });

    const noticesAfterSeen = await fetch(`${harness.baseUrl}/api/merchant/notices/pending`, {
      headers: { Authorization: `Bearer ${merchToken}` },
    }).then((r) => r.json());
    assert.equal(noticesAfterSeen.notices.length, 0);

    // Status should be GREEN (>=4 days left in EAT)
    const statusGreen = await fetch(`${harness.baseUrl}/api/merchant/subscription/status`, {
      headers: { Authorization: `Bearer ${merchToken}` },
    }).then((r) => r.json());
    assert.equal(statusGreen.status, 'ACTIVE');
    assert.equal(statusGreen.alarm_level, 'GREEN');
    assert.ok(statusGreen.days_remaining >= 28);

    // Seed 1 published listing & 1 draft listing for this merchant
    let publishedProductId = 0;
    let draftProductId = 0;
    await runDatabaseTransaction(async (db) => {
      publishedProductId = db.nextIds.product++;
      draftProductId = db.nextIds.product++;
      db.products.push(
        {
          id: publishedProductId,
          title: 'Active Store Listing',
          description: 'Should hide when expired and restore when renewed',
          category: 'Electronics',
          price: 4500,
          stockQuantity: 10,
          vendorId: merchId,
          vendorName: 'Sub Lifecycle Store',
          images: ['./images/smart_uhd_television_1792852474781.jpg'],
          moderationStatus: 'approved',
          speedOptions: [],
          live: true,
          publicationStatus: 'posted',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: draftProductId,
          title: 'Unfinished Merchant Draft',
          description: 'Must stay draft even after renewal',
          category: 'Electronics',
          price: 3000,
          stockQuantity: 5,
          vendorId: merchId,
          vendorName: 'Sub Lifecycle Store',
          images: ['./images/smart_uhd_television_1792852474781.jpg'],
          moderationStatus: 'approved',
          speedOptions: [],
          live: false,
          publicationStatus: 'draft',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      );

      // Move subscription expiry to 2 days from now -> RED alarm in EAT
      const user = db.users.find((u) => u.id === merchId)!;
      const twoDaysLater = Date.now() + 2 * 24 * 60 * 60 * 1000;
      user.merchantSubscriptionExpiresAt = twoDaysLater;
      for (const s of db.merchantSubscriptions || []) {
        if (s.merchantId === merchId && s.status === 'active') {
          s.expiresAt = twoDaysLater;
        }
      }
    });

    const statusRed = await fetch(`${harness.baseUrl}/api/merchant/subscription/status`, {
      headers: { Authorization: `Bearer ${merchToken}` },
    }).then((r) => r.json());
    assert.equal(statusRed.status, 'ACTIVE');
    assert.equal(statusRed.alarm_level, 'RED');
    assert.ok(statusRed.days_remaining <= 3 && statusRed.days_remaining >= 1);
    assert.match(statusRed.warningMessage || '', /running out/i);

    // Expire subscription in DB and run expiry sweep -> published listing hidden with SUBSCRIPTION_EXPIRED, draft untouched
    await runDatabaseTransaction(async (db) => {
      const user = db.users.find((u) => u.id === merchId)!;
      const past = Date.now() - 60000;
      user.merchantSubscriptionExpiresAt = past;
      for (const s of db.merchantSubscriptions || []) {
        if (s.merchantId === merchId && s.status === 'active') {
          s.expiresAt = past;
        }
      }
    });
    await enforceExpiredSubscriptions();

    const dbExpired = await getDatabase();
    const pubAfterExpire = dbExpired.products.find((p) => p.id === publishedProductId)!;
    const draftAfterExpire = dbExpired.products.find((p) => p.id === draftProductId)!;
    assert.equal(pubAfterExpire.live, false);
    assert.equal(pubAfterExpire.hiddenReason, 'SUBSCRIPTION_EXPIRED');
    assert.equal(draftAfterExpire.publicationStatus, 'draft');
    assert.equal(draftAfterExpire.hiddenReason, undefined);

    // Merchant cannot create product while expired (403 SUBSCRIPTION_EXPIRED)
    const createWhileExpired = await fetch(`${harness.baseUrl}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${merchToken}` },
      body: JSON.stringify({
        title: 'Blocked New Item',
        description: 'Blocked due to expiry',
        category: 'Energy',
        price: 1000,
        stockQuantity: 1,
      }),
    });
    assert.equal(createWhileExpired.status, 403);
    const createWhileExpiredBody = await createWhileExpired.json();
    assert.equal(createWhileExpiredBody.error?.code || createWhileExpiredBody.code, 'SUBSCRIPTION_EXPIRED');

    // Renew & approve -> published listing restored, draft STILL draft!
    const renewReq = await fetch(`${harness.baseUrl}/api/subscriptions/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${merchToken}` },
      body: JSON.stringify({
        planId: 'tier_500',
        paymentMethod: 'mpesa',
        mpesaCode: 'SUBLIFE002',
        billingPeriod: 'monthly',
      }),
    }).then((r) => r.json());

    const approve2 = await fetch(`${harness.baseUrl}/api/admin/subscriptions/requests/${renewReq.request.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(approve2.status, 200);

    const dbRestored = await getDatabase();
    const pubRestored = dbRestored.products.find((p) => p.id === publishedProductId)!;
    const draftStillDraft = dbRestored.products.find((p) => p.id === draftProductId)!;
    assert.equal(pubRestored.live, true);
    assert.equal(pubRestored.publicationStatus, 'posted');
    assert.ok(!pubRestored.hiddenReason);
    assert.equal(draftStillDraft.publicationStatus, 'draft');
    assert.equal(draftStillDraft.live, false);

    // Wallet single source of truth: integer cents ledger + atomic non-negative guard
    await runDatabaseTransaction(async (db) => {
      const mUser = db.users.find((u) => u.id === merchId)!;
      const creditRes = creditWalletCents(db, {
        userId: mUser.id,
        role: 'merchant',
        amountCents: 150050,
        category: 'DEPOSIT',
        referenceId: 'dep_1',
        note: 'Test KES 1,500.50 deposit',
        idempotencyKey: 'test_wallet_credit_1',
      });
      assert.equal(creditRes.deduplicated, false);
      assert.equal(getWalletBalanceCents(db, mUser, 'merchant'), 150050);

      // Idempotent duplicate credit is deduplicated cleanly
      const dupCredit = creditWalletCents(db, {
        userId: mUser.id,
        role: 'merchant',
        amountCents: 150050,
        category: 'DEPOSIT',
        referenceId: 'dep_1',
        note: 'Duplicate credit',
        idempotencyKey: 'test_wallet_credit_1',
      });
      assert.equal(dupCredit.deduplicated, true);
      assert.equal(getWalletBalanceCents(db, mUser, 'merchant'), 150050);

      // Cannot debit more than available balance
      assert.throws(
        () => {
          debitWalletCents(db, {
            userId: mUser.id,
            role: 'merchant',
            amountCents: 200000,
            category: 'SUBSCRIPTION_PAYMENT',
            referenceId: 'deb_over',
            note: 'Overdraft attempt',
          });
        },
        (err: any) => err?.code === 'INSUFFICIENT_BALANCE' && /Insufficient/i.test(err?.message || '')
      );

      // Exact debit leaves 0
      debitWalletCents(db, {
        userId: mUser.id,
        role: 'merchant',
        amountCents: 150050,
        category: 'SUBSCRIPTION_PAYMENT',
        referenceId: 'deb_ok',
        note: 'Exact debit',
      });
      assert.equal(getWalletBalanceCents(db, mUser, 'merchant'), 0);
    });
  });
});
