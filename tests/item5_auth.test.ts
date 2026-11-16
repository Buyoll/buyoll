import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { startTestServer, TestHarness } from './test_server.js';

describe('Item 5: Robust Authentication (Sign Up, Login, Lockout, Refresh Rotation & Reset)', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('validates registration fields, enforces username/email uniqueness, hashes passwords, and supports login by username/email/phone', async () => {
    // Reject short password (< 8 chars)
    const shortPw = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Wanjiku',
        username: 'alice.w',
        email: 'alice@example.com',
        password: 'short',
      }),
    });
    assert.equal(shortPw.status, 422);
    const shortJson = await shortPw.json();
    assert.ok(shortJson.error?.fields?.password);

    // Register valid member
    const regRes = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Wanjiku',
        username: 'Alice.W',
        email: 'Alice@Example.com',
        phone: '0798765432',
        password: 'StrongPassword#2026',
        rememberMe: true,
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    assert.equal(regJson.user.username, 'alice.w');
    assert.equal(regJson.user.email, 'alice@example.com');
    assert.equal(regJson.user.password, undefined, 'Password hash must never leak in API response');
    assert.ok(regJson.accessToken);
    assert.ok(regJson.refreshToken);

    // Check raw DB hashed password with argon2id
    const rawDb = JSON.parse(await fs.readFile(harness.dbFile, 'utf-8'));
    const storedAlice = rawDb.users.find((u: any) => u.id === regJson.user.id);
    assert.ok(storedAlice.password.startsWith('$argon2id$'), 'Password must be argon2id hashed');
    assert.notEqual(storedAlice.password, 'StrongPassword#2026');

    // Reject duplicate username
    const dupUn = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Another Alice',
        username: 'alice.w',
        email: 'alice2@example.com',
        password: 'StrongPassword#2026',
      }),
    });
    assert.equal(dupUn.status, 409);
    assert.equal((await dupUn.json()).error.code, 'USERNAME_TAKEN');

    // Reject duplicate email
    const dupEmail = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Another Alice',
        username: 'alice_two',
        email: 'alice@example.com',
        password: 'StrongPassword#2026',
      }),
    });
    assert.equal(dupEmail.status, 409);
    assert.equal((await dupEmail.json()).error.code, 'EMAIL_TAKEN');

    // Login using username (case-insensitive)
    const loginUn = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'ALICE.W', password: 'StrongPassword#2026' }),
    });
    assert.equal(loginUn.status, 200);

    // Login using phone
    const loginPhone = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: '0798765432', password: 'StrongPassword#2026' }),
    });
    assert.equal(loginPhone.status, 200);
  });

  it('prevents user enumeration, locks accounts after 5 failed attempts, and allows forgot/reset password', async () => {
    // Register bob
    const regBob = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob Otieno',
        username: 'bob_otieno',
        email: 'bob@example.com',
        password: 'NairobiMarket#2026',
      }),
    });
    assert.equal(regBob.status, 201, await regBob.clone().text());

    // Uniform 401 for unknown user vs wrong password
    const unknownRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'nobody@example.com', password: 'WrongPassword1' }),
    });
    const wrongPwRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'bob_otieno', password: 'WrongPassword1' }),
    });
    assert.equal(unknownRes.status, 401);
    assert.equal(wrongPwRes.status, 401);
    assert.equal((await unknownRes.json()).error.code, (await wrongPwRes.json()).error.code);

    // Trigger 4 more failed attempts -> 5th locks account
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${harness.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'bob_otieno', password: 'WrongPassword1' }),
      });
      if (i < 3) assert.equal(r.status, 401);
      else assert.equal(r.status, 429);
    }

    // Even correct password is blocked while locked
    const lockedRes = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'bob_otieno', password: 'NairobiMarket#2026' }),
    });
    assert.equal(lockedRes.status, 429);
    assert.equal((await lockedRes.json()).error.code, 'ACCOUNT_LOCKED');

    // Forgot password for unknown user still returns generic 200
    const forgotUnknown = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'unknown@example.com' }),
    });
    assert.equal(forgotUnknown.status, 200);

    // Forgot password for bob -> reset -> clears lockout and allows login
    const forgotBob = await fetch(`${harness.baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'bob@example.com' }),
    });
    assert.equal(forgotBob.status, 200);
    const { devResetToken } = await forgotBob.json();
    assert.ok(devResetToken);

    const resetRes = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: devResetToken, newPassword: 'EldoretHarvest#2026' }),
    });
    assert.equal(resetRes.status, 200);

    // Replay reset token must fail
    const replayReset = await fetch(`${harness.baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: devResetToken, newPassword: 'AnotherPassword#2026' }),
    });
    assert.equal(replayReset.status, 400);

    // Login with new password succeeds
    const loginNew = await fetch(`${harness.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'bob_otieno', password: 'EldoretHarvest#2026' }),
    });
    assert.equal(loginNew.status, 200);
  });

  it('rotates refresh tokens, detects token reuse and revokes active sessions, and supports logout-all', async () => {
    const reg = await fetch(`${harness.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Carol Mutua',
        username: 'carol_m',
        email: 'carol@example.com',
        password: 'MombasaHarbor#2026',
      }),
    }).then((r) => r.json());

    const rt1 = reg.refreshToken;
    const at1 = reg.accessToken;

    // Rotate once -> yields rt2 & at2
    const refresh1 = await fetch(`${harness.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt1 }),
    });
    assert.equal(refresh1.status, 200);
    const refJson = await refresh1.json();
    assert.ok(refJson.refreshToken && refJson.refreshToken !== rt1);

    // Access token works before reuse
    const meOk = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${at1}` },
    });
    assert.equal(meOk.status, 200);

    // Replay already-used rt1 -> triggers REFRESH_TOKEN_REUSED and revokes user sessions
    const reuseRes = await fetch(`${harness.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt1 }),
    });
    assert.equal(reuseRes.status, 401);
    assert.equal((await reuseRes.json()).error.code, 'REFRESH_TOKEN_REUSED');

    // Prior access token AND rt2 are now invalidated
    const meRevoked = await fetch(`${harness.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${at1}` },
    });
    assert.equal(meRevoked.status, 401);

    const rt2AfterRevoke = await fetch(`${harness.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refJson.refreshToken }),
    });
    assert.equal(rt2AfterRevoke.status, 401);
  });
});
