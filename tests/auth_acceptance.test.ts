import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { startTestServer, TestHarness } from './test_server.js';
import { MIGRATIONS } from '../server/migrations.js';
import { getDatabase, saveDatabase } from '../server/db.js';
import { scrubSensitiveFields } from '../server/auth_utils.js';

describe('Auth Acceptance Suite (Parts 1–8)', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('1. API endpoints return JSON (no 405/HTML regressions), enforce 405 on wrong verbs, and handle CORS preflight', async () => {
    const preflight = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: harness.baseUrl,
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get('access-control-allow-methods')?.includes('POST'));

    const wrongMethod = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'DELETE',
    });
    assert.equal(wrongMethod.status, 405);
    assert.ok(wrongMethod.headers.get('allow')?.includes('POST'));
    const wrongMethodJson = await wrongMethod.json();
    assert.equal(wrongMethodJson.error?.code, 'METHOD_NOT_ALLOWED');

    const missingApi = await fetch(`${harness.baseUrl}/api/nonexistent-auth-probe`);
    assert.equal(missingApi.status, 404);
    const missingJson = await missingApi.json();
    assert.equal(missingJson.error?.code, 'NOT_FOUND');

    const malformedJson = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"identifier":"alice","password":',
    });
    assert.equal(malformedJson.status, 400);
    const malformedBody = await malformedJson.json();
    assert.equal(malformedBody.error?.code, 'INVALID_JSON');

    // Confirm sensitive field scrubber redacts secrets before error logging
    const scrubbed = scrubSensitiveFields({
      identifier: 'alice',
      password: 'SuperSecretPassword99!',
      confirmPassword: 'SuperSecretPassword99!',
      nested: { newPassword: 'abc', safeField: 'ok' },
    }) as any;
    assert.equal(scrubbed.password, '[REDACTED]');
    assert.equal(scrubbed.confirmPassword, '[REDACTED]');
    assert.equal(scrubbed.nested.newPassword, '[REDACTED]');
    assert.equal(scrubbed.nested.safeField, 'ok');
  });

  it('2. Supports member sign-up with display username preservation, nullable & East African E.164 phones, confirmPassword, and argon2id hashing', async () => {
    // Password mismatch -> 422
    const mismatchRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Kamau',
        username: 'Alice_2026.KE',
        email: 'Alice.Kamau@Example.com',
        phone: '0733112299',
        password: 'MarketSafe#2026',
        confirmPassword: 'DifferentPassword#2026',
      }),
    });
    assert.equal(mismatchRes.status, 422);

    // Register with mixed-case username and Kenyan local phone
    const regRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Kamau',
        username: 'Alice_2026.KE',
        email: 'Alice.Kamau@Example.com',
        phone: '0733112299',
        password: 'MarketSafe#2026',
        confirmPassword: 'MarketSafe#2026',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    assert.equal(regJson.user.usernameDisplay, 'Alice_2026.KE');
    assert.equal(regJson.user.usernameLower, 'alice_2026.ke');
    assert.equal(regJson.user.email, 'alice.kamau@example.com');
    assert.equal(regJson.user.phone, '+254733112299');
    assert.equal(regJson.user.password, undefined);
    assert.equal(regJson.user.passwordHash, undefined);
    assert.equal(regJson.user.passwordHmac, undefined);
    assert.equal(regJson.user.adminPasskeyHash, undefined);

    const rawDb = JSON.parse(await fs.readFile(harness.dbFile, 'utf-8'));
    const stored = rawDb.users.find((u: any) => u.id === regJson.user.id);
    assert.ok(stored.uuid && stored.uuid.length >= 32);
    assert.ok(stored.password.startsWith('$argon2id$'));
    assert.notEqual(stored.password, 'MarketSafe#2026');

    // Register without phone -> stores null cleanly and works for multiple members
    const noPhone1 = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Grace Wambui',
        username: 'grace.wambui',
        email: 'grace.w@example.com',
        password: 'HarakaShop#2026',
        confirmPassword: 'HarakaShop#2026',
      }),
    });
    assert.equal(noPhone1.status, 201);
    const noPhone1Json = await noPhone1.json();
    assert.equal(noPhone1Json.user.phone, null);

    // Another member with null phone is also allowed (unique index ignores null)
    const noPhone2 = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Peter Njoroge',
        username: 'peter.nj',
        email: 'peter.nj@example.com',
        phone: null,
        password: 'SavannaCraft#2026',
        confirmPassword: 'SavannaCraft#2026',
      }),
    });
    assert.equal(noPhone2.status, 201);
    assert.equal((await noPhone2.json()).user.phone, null);

    // Test regional East African E.164 normalization (TZ, UG, RW, BI, SS)
    const eaPhones = [
      { code: 'tz', phone: '+255712345678' },
      { code: 'ug', phone: '+256772345678' },
      { code: 'rw', phone: '+250788345678' },
      { code: 'bi', phone: '+25779123456' },
      { code: 'ss', phone: '+211921234567' },
    ];
    for (const item of eaPhones) {
      const r = await fetch(`${harness.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Member ${item.code.toUpperCase()}`,
          username: `member_${item.code}_01`,
          email: `member_${item.code}@example.com`,
          phone: item.phone,
          password: `RegionalPass99!${item.code}`,
          confirmPassword: `RegionalPass99!${item.code}`,
        }),
      });
      assert.equal(r.status, 201, `Failed registering ${item.phone}`);
      assert.equal((await r.json()).user.phone, item.phone);
    }
  });

  it('3. Rejects duplicate username/email/normalized phone and rejects identity-matching passwords', async () => {
    // Duplicate normalized phone (+254733112299 already registered via 0733112299)
    const dupPhone = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Different Person',
        username: 'diff_person_99',
        email: 'diff_person_99@example.com',
        phone: '+254733112299',
        password: 'RiftValley#2026',
        confirmPassword: 'RiftValley#2026',
      }),
    });
    assert.equal(dupPhone.status, 409);
    assert.equal((await dupPhone.json()).error?.code, 'PHONE_TAKEN');

    // Duplicate username (different casing / punctuation)
    const dupUsername = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Different Person',
        username: 'alice_2026_ke',
        email: 'other.alice@example.com',
        password: 'RiftValley#2026',
        confirmPassword: 'RiftValley#2026',
      }),
    });
    assert.equal(dupUsername.status, 409);
    assert.equal((await dupUsername.json()).error?.code, 'USERNAME_TAKEN');

    // Password containing username / email local part / name / phone rejected
    const identityPasswords = [
      'juma_otieno123',
      'Myjumaotieno99',
      'otieno2026pass',
      'pass+254700112233',
    ];
    for (const badPw of identityPasswords) {
      const r = await fetch(`${harness.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Juma Otieno',
          username: 'juma_99',
          email: 'juma_otieno@example.com',
          phone: '+254700112233',
          password: badPw,
          confirmPassword: badPw,
        }),
      });
      assert.equal(r.status, 422, `Expected 422 for identity password ${badPw}`);
      assert.equal((await r.json()).error?.code, 'WEAK_PASSWORD');
    }
  });

  it('4. Unified sign-in works via username, email, and E.164/local phone with uniform 401 anti-enumeration', async () => {
    for (const id of ['ALICE_2026.KE', 'alice.kamau@example.com', '0733112299', '+254733112299']) {
      const res = await fetch(`${harness.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: id, password: 'MarketSafe#2026' }),
      });
      assert.equal(res.status, 200, `Login via ${id} failed`);
      const setCookie = res.headers.get('set-cookie') || '';
      assert.ok(setCookie.toLowerCase().includes('httponly'));
      assert.ok(setCookie.toLowerCase().includes('samesite=lax'));
    }

    const unknownRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'nonexistent.member', password: 'WrongPassword9' }),
    });
    const wrongPwRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice_2026.ke', password: 'WrongPassword9' }),
    });
    assert.equal(unknownRes.status, 401);
    assert.equal(wrongPwRes.status, 401);
    const uJson = await unknownRes.json();
    const wJson = await wrongPwRes.json();
    assert.equal(uJson.error?.code, 'INVALID_CREDENTIALS');
    assert.equal(wJson.error?.code, 'INVALID_CREDENTIALS');
    assert.equal(uJson.error?.message, 'Invalid credentials. Please check your details and try again.');
    assert.equal(wJson.error?.message, uJson.error?.message);

    // 4 more failed login attempts -> 5th attempt locks account with 429
    const lockTestReg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lockout Probe',
        username: 'lockout.probe',
        email: 'lockout.probe@example.com',
        password: 'EldoretSafe#2026',
        confirmPassword: 'EldoretSafe#2026',
      }),
    });
    assert.equal(lockTestReg.status, 201);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const failRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'lockout.probe', password: 'WrongPassword99' }),
      });
      if (attempt < 5) {
        assert.equal(failRes.status, 401);
      } else {
        assert.equal(failRes.status, 429);
        assert.equal((await failRes.json()).error?.code, 'ACCOUNT_LOCKED');
      }
    }
  });

  it('5. Forgot password issues 15-min single-use hashed token + OTP, supports reset, revokes old sessions, and enforces recovery rate limit', async () => {
    const regRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Samuel Kiprop',
        username: 'samuel.kip',
        email: 'samuel.kip@example.com',
        phone: '+254722889900',
        password: 'NakuruHills#2026',
        confirmPassword: 'NakuruHills#2026',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    const initialAccessToken = regJson.accessToken;
    const initialRefreshToken = regJson.refreshToken;

    // Request password reset #1
    const forgot1 = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'samuel.kip@example.com' }),
    });
    assert.equal(forgot1.status, 200);
    const forgot1Json = await forgot1.json();
    assert.ok(forgot1Json.devResetToken && forgot1Json.devOtp);

    // Check DB stores hashed token & 15-min TTL, NOT plaintext token
    const rawDb = JSON.parse(await fs.readFile(harness.dbFile, 'utf-8'));
    const resetRec = rawDb.passwordResets.find((r: any) => r.userId === regJson.user.id && !r.usedAt);
    assert.ok(resetRec);
    assert.notEqual(resetRec.tokenHash, forgot1Json.devResetToken);
    assert.notEqual(resetRec.codeHash, forgot1Json.devOtp);
    const ttlMs = resetRec.expiresAt - resetRec.createdAt;
    assert.equal(ttlMs, 15 * 60 * 1000, 'Reset token TTL must be 15 minutes');

    // Old password still works before reset completes
    const stillOld = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'samuel.kip', password: 'NakuruHills#2026' }),
    });
    assert.equal(stillOld.status, 200);

    // Complete password reset using link token
    const resetOk = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: forgot1Json.devResetToken,
        newPassword: 'KisumuBay#2026',
        confirmPassword: 'KisumuBay#2026',
      }),
    });
    assert.equal(resetOk.status, 200);

    // Prior session and refresh token are invalidated
    const oldSessionCheck = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${initialAccessToken}` },
    });
    assert.equal(oldSessionCheck.status, 401);

    const oldRefreshCheck = await fetch(`${harness.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: initialRefreshToken }),
    });
    assert.equal(oldRefreshCheck.status, 401);

    // Replaying same reset token fails with 400
    const replay = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: forgot1Json.devResetToken,
        newPassword: 'ThikaFalls#2026',
        confirmPassword: 'ThikaFalls#2026',
      }),
    });
    assert.equal(replay.status, 400);

    // Expired token test
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const db = await getDatabase();
    if (!db.passwordResets) db.passwordResets = [];
    db.passwordResets.unshift({
      id: `pr_expired_${Date.now()}`,
      userId: regJson.user.id,
      tokenHash: crypto.createHash('sha256').update(expiredRawToken).digest('hex'),
      codeHash: crypto.createHash('sha256').update('999888').digest('hex'),
      contact: 'samuel.kip@example.com',
      expiresAt: Date.now() - 1000,
      usedAt: null,
      createdAt: Date.now() - 16 * 60 * 1000,
    });
    await saveDatabase(db);

    const expiredReset = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: expiredRawToken,
        newPassword: 'MachakosSun#2026',
        confirmPassword: 'MachakosSun#2026',
      }),
    });
    assert.equal(expiredReset.status, 400);

    // Reset via 6-digit OTP code (#2 request on samuel.kip@example.com)
    const forgot2 = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'samuel.kip@example.com' }),
    });
    assert.equal(forgot2.status, 200);
    const { devOtp } = await forgot2.json();

    const resetViaOtp = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'samuel.kip@example.com',
        code: devOtp,
        newPassword: 'MalindiCoast#2026',
        confirmPassword: 'MalindiCoast#2026',
      }),
    });
    assert.equal(resetViaOtp.status, 200);

    // 3rd request within 1 hour succeeds, 4th is rate-limited (429)
    const forgot3 = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'samuel.kip@example.com' }),
    });
    assert.equal(forgot3.status, 200);

    const forgot4 = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'samuel.kip@example.com' }),
    });
    assert.equal(forgot4.status, 429);
    assert.equal((await forgot4.json()).error?.code, 'RATE_LIMITED');
  });

  it('6. Forgot username returns identical neutral confirmation for known and unknown contacts without leaking username', async () => {
    const knownRes = await fetch(`${harness.baseUrl}/api/auth/forgot-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: 'alice.kamau@example.com' }),
    });
    const unknownRes = await fetch(`${harness.baseUrl}/api/auth/forgot-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact: 'nobody.here@example.com' }),
    });
    assert.equal(knownRes.status, 200);
    assert.equal(unknownRes.status, 200);

    const knownText = await knownRes.text();
    const unknownText = await unknownRes.text();
    assert.equal(knownText, unknownText);
    assert.ok(!knownText.toLowerCase().includes('alice_2026.ke'));
    assert.equal(
      JSON.parse(knownText).message,
      "If an account exists for that contact, we've sent your username to your registered email or phone."
    );
  });

  it('7. Migration 010 safely backfills existing users and flags legacy plaintext passwords without deleting records', async () => {
    const mig10 = MIGRATIONS.find((m) => m.id === '010_auth_hardening_e164_phone_and_resets');
    assert.ok(mig10, 'Migration 010 must exist');

    const mockDb: any = {
      users: [
        {
          id: 901,
          name: 'Legacy User',
          username: 'Legacy.User',
          email: 'LEGACY@EXAMPLE.COM',
          phone: '0711223344',
          password: 'unhashed_legacy_password',
          role: 'member',
        },
        {
          id: 902,
          name: 'Empty Phone User',
          username: 'EmptyPhone',
          email: 'empty@example.com',
          phone: '   ',
          password: '$argon2id$v=19$m=65536,t=3,p=1$fakehash',
          role: 'member',
        },
      ],
      passwordResets: [],
      auditLogs: [],
    };

    mig10.up(mockDb, { alreadyApplied: false });
    assert.equal(mockDb.users.length, 2, 'Migration must preserve all existing records');
    assert.ok(mockDb.users[0].uuid);
    assert.equal(mockDb.users[0].usernameDisplay, 'Legacy.User');
    assert.equal(mockDb.users[0].usernameLower, 'legacy.user');
    assert.equal(mockDb.users[0].phone, '+254711223344');
    assert.equal(mockDb.users[0].mustResetPassword, true);
    assert.equal(mockDb.users[1].phone, null);
    assert.equal(Boolean(mockDb.users[1].mustResetPassword), false);
  });

  it('8. Copy updates in HomePage, Footer, and index.html match exact approved copy', async () => {
    const root = process.cwd();
    const home = await fs.readFile(path.join(root, 'src/pages/HomePage.tsx'), 'utf8');
    const footer = await fs.readFile(path.join(root, 'src/components/Footer.tsx'), 'utf8');
    const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');

    const expectedFooterCopy =
      'Buyoll connects shoppers, merchants, and lenders across East Africa, enabling product discovery, group contributions through 1–10 member Lipa Mdogomdogo groups, flexible instalment payments, and merchant-sponsored promotions.';
    const expectedHomeHeading =
      'Welcome to Buyoll — Kenya&apos;s Social Fintech Marketplace.';
    const expectedHomeSubcopy =
      'Explore featured products, announcements, and merchant group deals below. Sign in to access your Groups, Wallet, Merchant Catalog, and Peer Lending Desk.';

    assert.ok(footer.includes(expectedFooterCopy), 'Footer copy must match Part 1A');
    assert.ok(html.includes(expectedFooterCopy), 'index.html description copy must match Part 1A');
    assert.ok(home.includes(expectedHomeHeading), 'HomePage hero heading must match Part 1B');
    assert.ok(home.includes(expectedHomeSubcopy), 'HomePage hero subcopy must match Part 1B');
    assert.ok(!home.includes('Public Feed'), 'Public Feed heading must be removed');
    assert.ok(!home.includes('across Kenya through product discovery'));
    assert.ok(!footer.includes('across Kenya through product discovery'));
  });
});
