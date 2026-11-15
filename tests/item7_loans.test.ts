import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, saveDatabase } from '../server/db.js';
import { hashPassword } from '../server/api.js';

async function requestJson(
  baseUrl: string,
  urlPath: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('Item 7: Restored Group Loans (1% Fee, Group-Scoped Lenders, Atomic Funding, Group-Locked Balance)', () => {
  let harness: TestHarness;
  let memberToken = '';
  let modToken = '';
  let lenderAuthToken = '';
  let lenderUnauthToken = '';
  let merchantToken = '';
  let memberId = 0;
  let modId = 0;
  let lenderAuthId = 0;
  let lenderUnauthId = 0;
  let groupAId = 0;
  let groupBId = 0;

  before(async () => {
    harness = await startTestServer();
    const db = await getDatabase();
    const now = Date.now();
    const pw = hashPassword('LoanTestPass!1');

    modId = db.nextIds.user++;
    memberId = db.nextIds.user++;
    lenderAuthId = db.nextIds.user++;
    lenderUnauthId = db.nextIds.user++;
    const merchId = db.nextIds.user++;

    db.users.push(
      {
        id: modId,
        name: 'Loan Mod User',
        phone: '0790100101',
        email: 'loanmod@buyoll.test',
        username: 'loanmod',
        password: pw,
        role: 'member',
        activeRole: 'member',
        roles: ['member'],
        credit: 5000,
        coins: 0,
        points: 0,
        lastActive: now,
        createdAt: now,
      },
      {
        id: memberId,
        name: 'Loan Borrower User',
        phone: '0790100102',
        email: 'loanborrower@buyoll.test',
        username: 'loanborrower',
        password: pw,
        role: 'member',
        activeRole: 'member',
        roles: ['member'],
        credit: 0,
        restrictedLoanBalance: 0,
        nonWithdrawableBalance: 0,
        coins: 0,
        points: 0,
        lastActive: now,
        createdAt: now,
      },
      {
        id: lenderAuthId,
        name: 'Authorized Group Lender',
        phone: '0790100103',
        email: 'authlender@buyoll.test',
        username: 'authlender',
        password: pw,
        role: 'lender',
        activeRole: 'lender',
        roles: ['lender'],
        credit: 25000,
        roleWallets: {
          member: { credit: 0, coins: 0, points: 0 },
          merchant: { credit: 0, coins: 0, points: 0 },
          lender: { credit: 25000, coins: 0, points: 0 },
        },
        coins: 0,
        points: 0,
        lastActive: now,
        createdAt: now,
      },
      {
        id: lenderUnauthId,
        name: 'Rogue Lender',
        phone: '0790100104',
        email: 'roguelender@buyoll.test',
        username: 'roguelender',
        password: pw,
        role: 'lender',
        activeRole: 'lender',
        roles: ['lender'],
        credit: 50000,
        roleWallets: {
          member: { credit: 0, coins: 0, points: 0 },
          merchant: { credit: 0, coins: 0, points: 0 },
          lender: { credit: 50000, coins: 0, points: 0 },
        },
        coins: 0,
        points: 0,
        lastActive: now,
        createdAt: now,
      },
      {
        id: merchId,
        name: 'Loan Test Merchant',
        phone: '0790100105',
        email: 'loanmerch@buyoll.test',
        username: 'loanmerch',
        password: pw,
        role: 'merchant',
        activeRole: 'merchant',
        roles: ['merchant'],
        credit: 0,
        coins: 0,
        points: 0,
        lastActive: now,
        createdAt: now,
      }
    );

    groupAId = db.nextIds.group++;
    groupBId = db.nextIds.group++;

    db.groups.push(
      {
        id: groupAId,
        productId: 1,
        productTitle: '4K Smart UHD TV 55"',
        productPrice: 30000,
        productImage: './images/smart_uhd_television_1792852474781.jpg',
        name: 'Loan Target Group A',
        size: 6,
        adminId: modId,
        moderatorId: modId,
        moderators: [modId],
        vendorId: merchId,
        joinPolicy: 'OPEN',
        maxMembers: 6,
        status: 'active',
        inviteCode: 'LOANGRPA',
        dailyAmount: 500,
        cycleDays: 10,
        slots: [
          {
            slotNumber: 1,
            userId: modId,
            userName: 'Loan Mod User',
            userPhone: '0790100101',
            status: 'active',
            paidAmount: 500,
            targetAmount: 30000,
            inviteCode: 'LOANGRPA-1',
            memberCode: 'BYL-9011',
          },
          {
            slotNumber: 2,
            userId: memberId,
            userName: 'Loan Borrower User',
            userPhone: '0790100102',
            status: 'active',
            paidAmount: 0,
            targetAmount: 30000,
            inviteCode: 'LOANGRPA-2',
            memberCode: 'BYL-9012',
          },
          { slotNumber: 3, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 30000, inviteCode: 'LOANGRPA-3' },
          { slotNumber: 4, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 30000, inviteCode: 'LOANGRPA-4' },
          { slotNumber: 5, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 30000, inviteCode: 'LOANGRPA-5' },
          { slotNumber: 6, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 30000, inviteCode: 'LOANGRPA-6' },
        ],
        occupiedCount: 2,
        availableCount: 4,
        platformTill: '522533',
        merchantTill: '892110',
        lenderId: null,
        lenderName: null,
        chat: [],
        createdAt: now,
      },
      {
        id: groupBId,
        productId: 2,
        productTitle: 'Solar Backup Generator',
        productPrice: 20000,
        productImage: './images/solar_power_backup_station_1792852473757.jpg',
        name: 'Separate Group B',
        size: 4,
        adminId: modId,
        moderatorId: modId,
        moderators: [modId],
        vendorId: merchId,
        joinPolicy: 'OPEN',
        maxMembers: 4,
        status: 'active',
        inviteCode: 'LOANGRPB',
        dailyAmount: 500,
        cycleDays: 10,
        slots: [
          {
            slotNumber: 1,
            userId: memberId,
            userName: 'Loan Borrower User',
            userPhone: '0790100102',
            status: 'active',
            paidAmount: 0,
            targetAmount: 20000,
            inviteCode: 'LOANGRPB-1',
            memberCode: 'BYL-9021',
          },
          { slotNumber: 2, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 20000, inviteCode: 'LOANGRPB-2' },
          { slotNumber: 3, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 20000, inviteCode: 'LOANGRPB-3' },
          { slotNumber: 4, userId: null, userName: null, userPhone: null, status: 'open', paidAmount: 0, targetAmount: 20000, inviteCode: 'LOANGRPB-4' },
        ],
        occupiedCount: 1,
        availableCount: 3,
        platformTill: '522533',
        merchantTill: '892110',
        lenderId: null,
        lenderName: null,
        chat: [],
        createdAt: now,
      }
    );

    await saveDatabase(db);

    const loginUser = async (identifier: string) => {
      const r = await requestJson(harness.baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { identifier, password: 'LoanTestPass!1' },
      });
      assert.equal(r.status, 200, `Expected 200 login for ${identifier}, got ${r.status}: ${JSON.stringify(r.data)}`);
      assert.ok(r.data.accessToken);
      return r.data.accessToken as string;
    };

    modToken = await loginUser('loanmod@buyoll.test');
    memberToken = await loginUser('loanborrower@buyoll.test');
    lenderAuthToken = await loginUser('authlender@buyoll.test');
    lenderUnauthToken = await loginUser('roguelender@buyoll.test');
    merchantToken = await loginUser('loanmerch@buyoll.test');
  });

  after(async () => {
    await harness.close();
  });

  it('enforces group-scoped lender auth, contacted status, atomic 1% fee / 99% group-locked funding, idempotency, and spending restrictions', async () => {
    // 1. Merchant cannot request member loans -> 403
    const merchReq = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans`, {
      method: 'POST',
      token: merchantToken,
      body: { amount: 5000, purpose: 'Unauthorized request' },
    });
    assert.equal(merchReq.status, 403);

    // 2. Active Member in Group A requests a 10,000 KES loan
    const reqRes = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans`, {
      method: 'POST',
      token: memberToken,
      body: {
        amount: 10000,
        purpose: 'Catch up group installments',
        repaymentDays: 14,
      },
    });
    assert.equal(reqRes.status, 201);
    assert.equal(reqRes.data.loan.amount, 10000);
    assert.equal(reqRes.data.loan.platformFeeAmount, 100);
    assert.equal(reqRes.data.loan.netDisbursedAmount, 9900);
    assert.equal(reqRes.data.loan.borrowerCode, 'BYL-9012');
    const loanId = reqRes.data.loan.id;

    // 3. Unauthorized lender CANNOT self-claim, mark contacted, or fund
    const selfClaim = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/claim-lender`, {
      method: 'POST',
      token: lenderUnauthToken,
    });
    assert.equal(selfClaim.status, 403);

    const rogueContact = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans/${loanId}/contacted`, {
      method: 'POST',
      token: lenderUnauthToken,
    });
    assert.equal(rogueContact.status, 403);

    const rogueFund = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans/${loanId}/fund`, {
      method: 'POST',
      token: lenderUnauthToken,
    });
    assert.equal(rogueFund.status, 403);
    assert.equal(rogueFund.data.error.code, 'UNAUTHORIZED_LENDER');

    // Lender cannot authorize themselves (403)
    const selfAuthorize = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/lenders`, {
      method: 'POST',
      token: lenderAuthToken,
      body: { userId: lenderAuthId },
    });
    assert.equal(selfAuthorize.status, 403);

    // 4. Group Moderator authorizes lenderAuthId for Group A
    const authLenderRes = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/lenders`, {
      method: 'POST',
      token: modToken,
      body: { identifier: 'authlender@buyoll.test' },
    });
    assert.equal(authLenderRes.status, 201);
    assert.equal(authLenderRes.data.lenders.length, 1);
    assert.equal(authLenderRes.data.lenders[0].userId, lenderAuthId);

    // 5. Authorized lender sees unmasked borrower phone & marks loan contacted
    const listLoansAuth = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans`, {
      token: lenderAuthToken,
    });
    assert.equal(listLoansAuth.status, 200);
    assert.equal(listLoansAuth.data.loans[0].requesterPhone, '0790100102');

    const contactRes = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans/${loanId}/contacted`, {
      method: 'POST',
      token: lenderAuthToken,
    });
    assert.equal(contactRes.status, 200);
    assert.equal(contactRes.data.loan.status, 'contacted');
    assert.ok(contactRes.data.loan.contactedAt);

    // 6. Authorized lender funds 10,000 KES loan atomically -> 1% fee (100 KES), 99% net (9,900 KES)
    const fundRes = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans/${loanId}/fund`, {
      method: 'POST',
      token: lenderAuthToken,
    });
    assert.equal(fundRes.status, 200);
    assert.equal(fundRes.data.lenderBalance, 15000); // 25,000 - 10,000
    assert.equal(fundRes.data.feeAmount, 100);
    assert.equal(fundRes.data.netCredited, 9900);
    assert.equal(fundRes.data.borrowerRestrictedBalance, 9900);
    assert.equal(fundRes.data.loan.status, 'funded');

    // Verify DB platformFees ledger & regular credit untouched
    const dbAfterFund = await getDatabase();
    const feeRow = (dbAfterFund.platformFees || []).find((f) => f.loanId === loanId);
    assert.ok(feeRow);
    assert.equal(feeRow!.grossAmountCents, 1000000);
    assert.equal(feeRow!.feeAmountCents, 10000);
    assert.equal(feeRow!.netAmountCents, 990000);
    const borrowerDb = dbAfterFund.users.find((u) => u.id === memberId)!;
    assert.equal(borrowerDb.credit, 0);
    assert.equal(borrowerDb.restrictedLoanBalance, 9900);
    assert.equal(borrowerDb.restrictedLoanByGroup?.[groupAId], 9900);

    // 7. Double-fund idempotency -> 409 ALREADY_FUNDED
    const doubleFund = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans/${loanId}/fund`, {
      method: 'POST',
      token: lenderAuthToken,
    });
    assert.equal(doubleFund.status, 409);
    assert.equal(doubleFund.data.error.code, 'ALREADY_FUNDED');

    // 8. Borrower cannot withdraw restricted loan balance -> 400 LOAN_FUNDS_NOT_WITHDRAWABLE
    const withdrawRes = await requestJson(harness.baseUrl, '/api/wallet/withdraw', {
      method: 'POST',
      token: memberToken,
      body: { amount: 1000 },
    });
    assert.equal(withdrawRes.status, 400);
    assert.equal(withdrawRes.data.error.code, 'LOAN_FUNDS_NOT_WITHDRAWABLE');

    // 9. Borrower cannot spend Group A loan funds inside Group B -> 400 LOAN_FUNDS_GROUP_ONLY
    const crossGroupPay = await requestJson(harness.baseUrl, `/api/groups/${groupBId}/pay-from-wallet`, {
      method: 'POST',
      token: memberToken,
      body: { slotNumber: 1, amount: 500 },
    });
    assert.equal(crossGroupPay.status, 400);
    assert.equal(crossGroupPay.data.error.code, 'LOAN_FUNDS_GROUP_ONLY');

    // 10. Borrower CAN pay inside funded Group A using restricted loan funds -> 200
    const inGroupPay = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/pay-from-wallet`, {
      method: 'POST',
      token: memberToken,
      body: { slotNumber: 2, amount: 500 },
    });
    assert.equal(inGroupPay.status, 200);
    assert.equal(inGroupPay.data.restrictedLoanBalance, 9400);
    assert.equal(inGroupPay.data.paidAmount, 500);

    // 11. Moderator revokes lender -> lender cannot fund a new loan in Group A (403)
    const secondReq = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans`, {
      method: 'POST',
      token: memberToken,
      body: { amount: 2000, purpose: 'Second installment loan' },
    });
    assert.equal(secondReq.status, 201);

    const revokeRes = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/lenders/${lenderAuthId}`, {
      method: 'DELETE',
      token: modToken,
    });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.data.lenders.length, 0);

    const fundAfterRevoke = await requestJson(
      harness.baseUrl,
      `/api/groups/${groupAId}/loans/${secondReq.data.loan.id}/fund`,
      { method: 'POST', token: lenderAuthToken }
    );
    assert.equal(fundAfterRevoke.status, 403);
    assert.equal(fundAfterRevoke.data.error.code, 'UNAUTHORIZED_LENDER');

    // 12. Re-authorize & test insufficient balance (15,000 remaining vs 20,000 request) -> 400 INSUFFICIENT_FUNDS
    await requestJson(harness.baseUrl, `/api/groups/${groupAId}/lenders`, {
      method: 'POST',
      token: modToken,
      body: { userId: lenderAuthId },
    });
    const bigReq = await requestJson(harness.baseUrl, `/api/groups/${groupAId}/loans`, {
      method: 'POST',
      token: memberToken,
      body: { amount: 20000, purpose: 'Large advance test' },
    });
    assert.equal(bigReq.status, 201);
    const insuffRes = await requestJson(
      harness.baseUrl,
      `/api/groups/${groupAId}/loans/${bigReq.data.loan.id}/fund`,
      { method: 'POST', token: lenderAuthToken }
    );
    assert.equal(insuffRes.status, 400);
    assert.equal(insuffRes.data.error.code, 'INSUFFICIENT_FUNDS');
  });
});
