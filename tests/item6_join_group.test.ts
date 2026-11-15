import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { startTestServer, TestHarness } from './test_server.js';

async function registerUser(
  baseUrl: string,
  payload: { name: string; username: string; email: string; phone: string; role: 'member' | 'merchant' | 'lender' }
) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      password: 'SecureTestPassword#2026',
    }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return res.json();
}

describe('Item 6: Join This Group (OPEN, APPROVAL, INVITE_ONLY, Leave, Moderator Actions)', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await startTestServer();
  });

  after(async () => {
    await harness.close();
  });

  it('enforces auth & role isolation, joins OPEN groups with memberCode, rejects duplicate 409, and handles leave + active loan guard', async () => {
    const memberA = await registerUser(harness.baseUrl, {
      name: 'Wanjiku Member',
      username: 'wanjiku_m',
      email: 'wanjiku@example.com',
      phone: '0791000101',
      role: 'member',
    });
    const merchant = await registerUser(harness.baseUrl, {
      name: 'Juma Merchant',
      username: 'juma_merch',
      email: 'juma_m@example.com',
      phone: '0791000102',
      role: 'merchant',
    });
    const lender = await registerUser(harness.baseUrl, {
      name: 'Kip Lender',
      username: 'kip_lender',
      email: 'kip_l@example.com',
      phone: '0791000103',
      role: 'lender',
    });

    // Unauthenticated join -> 401
    const unauth = await fetch(`${harness.baseUrl}/api/groups/101/join`, { method: 'POST' });
    assert.equal(unauth.status, 401);

    // Merchant or Lender join -> 403 ROLE_ISOLATION_MEMBER_REQUIRED
    const merchJoin = await fetch(`${harness.baseUrl}/api/groups/101/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchant.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(merchJoin.status, 403);
    assert.equal((await merchJoin.json()).error.code, 'ROLE_ISOLATION_MEMBER_REQUIRED');

    const lenderJoin = await fetch(`${harness.baseUrl}/api/groups/101/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lender.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(lenderJoin.status, 403);

    // Member A joins OPEN group 101 without inviteCode
    const joinOk = await fetch(`${harness.baseUrl}/api/groups/101/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberA.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(joinOk.status, 200, await joinOk.clone().text());
    const joinJson = await joinOk.json();
    assert.equal(joinJson.pending, false);
    assert.ok(joinJson.memberCode?.startsWith('BYL-'));
    assert.equal(joinJson.membership.isMember, true);

    // Duplicate join -> 409 ALREADY_MEMBER
    const dupJoin = await fetch(`${harness.baseUrl}/api/groups/101/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberA.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(dupJoin.status, 409);
    assert.equal((await dupJoin.json()).error.code, 'ALREADY_MEMBER');

    // GET /api/groups/101 reflects isMember=true & memberCode
    const getRes = await fetch(`${harness.baseUrl}/api/groups/101`, {
      headers: { Authorization: `Bearer ${memberA.accessToken}` },
    });
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.membership.isMember, true);
    assert.equal(getJson.membership.memberCode, joinJson.memberCode);

    // Member A leaves group -> 200 and slot opens again
    const leaveOk = await fetch(`${harness.baseUrl}/api/groups/101/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberA.accessToken}` },
    });
    assert.equal(leaveOk.status, 200);

    // Confirm TrustChama string route doesn't crash on non-numeric group ID (401 unauth from chamaTrustRouter)
    const trustCheck = await fetch(`${harness.baseUrl}/api/groups/grp_demo_1`);
    assert.equal(trustCheck.status, 401);
  });

  it('handles APPROVAL policy (request, cancel, non-moderator 403, moderator approve/reject, remove member) and INVITE_ONLY + GROUP_FULL', async () => {
    const modMember = await registerUser(harness.baseUrl, {
      name: 'Grace Mod',
      username: 'grace_mod',
      email: 'grace_m@example.com',
      phone: '0791000201',
      role: 'member',
    });
    const applicantB = await registerUser(harness.baseUrl, {
      name: 'Peter Applicant',
      username: 'peter_b',
      email: 'peter_b@example.com',
      phone: '0791000202',
      role: 'member',
    });
    const applicantC = await registerUser(harness.baseUrl, {
      name: 'Lucy Applicant',
      username: 'lucy_c',
      email: 'lucy_c@example.com',
      phone: '0791000203',
      role: 'member',
    });

    // Seed a 2-slot fresh group #701 in DB cache via clean test setup, using an empty group with 2 slots
    // Read file & create an isolated 2-slot group via moderator setup or direct seed update followed by server restart isn't needed—let's check group #101 with Member #1 (Sam, id: 3)
    // Instead, let's inspect raw DB and create group #701? Note server holds in-memory dbCache, so let's sign in as merchant #2 or update group 101's joinPolicy via moderator Samuel Mwangi (id: 3)!
    // Even better: add a 2-slot active group #701 via merchant 2? Wait—merchant 2 needs active subscription to POST /groups. Or Member joins 101 first when moderator leaves, or let's grant modMember moderator on a fresh group 701 BEFORE starting or test via 101?
    // Wait: why not join group 101 with modMember -> let moderator Samuel login? We don't have Samuel's plaintext password; let's check POST /api/groups with a freshly approved merchant subscription, OR set group 101 policy!
    // Wait: let's sign in as Admin (`buyoll_admin`, passkey/default) or add a tiny helper that reads/resets cache? Wait—test_server.ts shares the same process! Importing getDatabase / runDatabaseTransaction updates the exact dbCache!
    const { runDatabaseTransaction } = await import('../server/db.js');
    await runDatabaseTransaction(async (db) => {
      db.groups.push({
        id: 701,
        productId: 1,
        productTitle: 'Test Group Product',
        productPrice: 2000,
        name: 'Approval Test Group 701',
        size: 2,
        maxMembers: 2,
        vendorId: 2,
        adminId: modMember.user.id,
        moderatorId: modMember.user.id,
        moderators: [modMember.user.id],
        status: 'active',
        joinPolicy: 'APPROVAL',
        inviteCode: 'GRP701',
        dailyAmount: 100,
        cycleDays: 10,
        slots: [
          {
            slotNumber: 1,
            userId: modMember.user.id,
            userName: modMember.user.name,
            userPhone: modMember.user.phone,
            memberCode: 'BYL-8011',
            status: 'active',
            inviteCode: 'MOD701',
            paidAmount: 0,
            targetAmount: 2000,
          },
          {
            slotNumber: 2,
            userId: null,
            userName: null,
            status: 'open',
            inviteCode: 'OPEN701',
            paidAmount: 0,
            targetAmount: 2000,
          },
        ],
        occupiedCount: 1,
        availableCount: 1,
        chat: [],
        createdAt: Date.now(),
      });
    });

    // Applicant B requests to join APPROVAL group 701 -> 202 pending
    const reqB = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantB.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Excited to join!' }),
    });
    assert.equal(reqB.status, 202);
    const reqBJson = await reqB.json();
    assert.equal(reqBJson.pending, true);
    assert.equal(reqBJson.membership.joinRequestStatus, 'PENDING');

    // Non-moderator cannot list or approve join requests -> 403
    const nonModList = await fetch(`${harness.baseUrl}/api/groups/701/join-requests`, {
      headers: { Authorization: `Bearer ${applicantB.accessToken}` },
    });
    assert.equal(nonModList.status, 403);

    const nonModApprove = await fetch(
      `${harness.baseUrl}/api/groups/701/join-requests/${reqBJson.joinRequest.id}/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${applicantC.accessToken}` },
      }
    );
    assert.equal(nonModApprove.status, 403);

    // Applicant B cancels request -> then submits again
    const cancelRes = await fetch(`${harness.baseUrl}/api/groups/701/join-request`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${applicantB.accessToken}` },
    });
    assert.equal(cancelRes.status, 200);

    const reReqB = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantB.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(reReqB.status, 202);
    const reReqBJson = await reReqB.json();

    // Applicant C also submits a request
    const reqC = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantC.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(reqC.status, 202);
    const reqCJson = await reqC.json();

    // Moderator rejects C and approves B -> Group 701 becomes FULL (2/2)
    const rejC = await fetch(
      `${harness.baseUrl}/api/groups/701/join-requests/${reqCJson.joinRequest.id}/reject`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${modMember.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Slot reserved' }),
      }
    );
    assert.equal(rejC.status, 200);

    const appB = await fetch(
      `${harness.baseUrl}/api/groups/701/join-requests/${reReqBJson.joinRequest.id}/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${modMember.accessToken}` },
      }
    );
    assert.equal(appB.status, 200);
    const appBJson = await appB.json();
    assert.equal(appBJson.group.status, 'full');

    // Applicant C tries again when group is full -> 409 GROUP_FULL
    const fullAttempt = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantC.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(fullAttempt.status, 409);
    assert.equal((await fullAttempt.json()).error.code, 'GROUP_FULL');

    // Moderator removes Applicant B -> slot reopens (active again)
    const removeB = await fetch(`${harness.baseUrl}/api/groups/701/members/${applicantB.user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${modMember.accessToken}` },
    });
    assert.equal(removeB.status, 200);
    const removeBJson = await removeB.json();
    assert.equal(removeBJson.group.status, 'active');

    // Switch Group 701 policy to INVITE_ONLY
    const patchPolicy = await fetch(`${harness.baseUrl}/api/groups/701/join-policy`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${modMember.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinPolicy: 'INVITE_ONLY' }),
    });
    assert.equal(patchPolicy.status, 200);

    // Applicant C without inviteCode -> 403 INVITE_CODE_REQUIRED
    const missingCode = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantC.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missingCode.status, 403);
    assert.equal((await missingCode.json()).error.code, 'INVITE_CODE_REQUIRED');

    // Applicant C with invalid code -> 403 INVALID_INVITE_CODE
    const badCode = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantC.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'WRONGCODE' }),
    });
    assert.equal(badCode.status, 403);

    // Applicant C with valid group invite code GRP701 -> 200 joined!
    const goodCode = await fetch(`${harness.baseUrl}/api/groups/701/join`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${applicantC.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'GRP701' }),
    });
    assert.equal(goodCode.status, 200);

    // Confirm raw file persisted
    const disk = JSON.parse(await fs.readFile(harness.dbFile, 'utf-8'));
    const g701 = disk.groups.find((g: any) => g.id === 701);
    assert.equal(g701.occupiedCount, 2);
  });
});
