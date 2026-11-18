import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction, DatabaseSchema } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import { emitPlatformEvent } from './events.js';
import { LOAN_PLATFORM_FEE_RATE, toCents, fromCents, computeFeeCents } from './config.js';
import {
  creditWalletCents,
  debitWalletCents,
  findPlatformAdminUser,
} from './wallet_service.js';
import {
  ChamaGroup,
  GroupLenderAuthorization,
  PaymentRecord,
  PeerLoanRequest,
  User,
} from '../src/types.js';

export const groupLoansRouter = wrapRouterAsync(Router());

function ensureNumericGroupId(req: Request, res: Response, next: NextFunction) {
  const raw = req.params.id;
  if (!/^\d+$/.test(String(raw || ''))) {
    return next();
  }
  return next();
}

function isGroupModerator(user: User | null | undefined, group: ChamaGroup): boolean {
  if (!user) return false;
  const activeRole = user.activeRole || user.role;
  if (activeRole === 'merchant' || user.role === 'merchant') {
    // Unless super-admin, merchants do not moderate customer chamas
    if (user.role !== 'admin') return false;
  }
  if (user.role === 'admin' || activeRole === 'admin') return true;
  if (group.moderatorId && group.moderatorId === user.id) return true;
  if (group.adminId && group.adminId === user.id && group.vendorId !== user.id) return true;
  if (Array.isArray(group.moderators) && group.moderators.includes(user.id)) return true;
  const slot1 = group.slots?.find((s) => s.slotNumber === 1 && s.status === 'active');
  if (slot1?.userId === user.id) return true;
  return false;
}

function getActiveGroupLenders(db: DatabaseSchema, groupId: number): GroupLenderAuthorization[] {
  return (db.groupLenders || []).filter(
    (gl) => gl.groupId === groupId && gl.status === 'ACTIVE'
  );
}

function isAuthorizedLenderForGroup(db: DatabaseSchema, user: User | null | undefined, groupId: number): boolean {
  if (!user) return false;
  return (db.groupLenders || []).some(
    (gl) => gl.groupId === groupId && gl.userId === user.id && gl.status === 'ACTIVE'
  );
}

function sanitizeLoanForViewer(
  loan: PeerLoanRequest,
  viewer: User | null,
  db: DatabaseSchema,
  group?: ChamaGroup
): PeerLoanRequest {
  const isViewerAdmin = viewer?.role === 'admin' || viewer?.activeRole === 'admin';
  const isRequester = viewer?.id === loan.requesterId;
  const isMod = group ? isGroupModerator(viewer, group) : false;
  const isAuthLender = viewer ? isAuthorizedLenderForGroup(db, viewer, loan.groupId) : false;
  const canSeePhone = Boolean(isViewerAdmin || isRequester || isMod || isAuthLender);

  const principal = Number(loan.approvedAmount || loan.amount || 0);
  const { feeCents, netCents } = computeFeeCents(principal, LOAN_PLATFORM_FEE_RATE);
  return {
    ...loan,
    requesterPhone: canSeePhone ? loan.requesterPhone : undefined,
    feeRate: loan.feeRate ?? LOAN_PLATFORM_FEE_RATE,
    platformFeePercent: Math.round((loan.feeRate ?? LOAN_PLATFORM_FEE_RATE) * 100),
    platformFeeAmount: loan.platformFeeCents !== undefined ? fromCents(loan.platformFeeCents) : fromCents(feeCents),
    platformFeeCents: loan.platformFeeCents ?? feeCents,
    netDisbursedCents: loan.netDisbursedCents ?? netCents,
    netDisbursedAmount: loan.netDisbursedAmount ?? fromCents(netCents),
    borrowerCode: loan.borrowerCode || `BYL-${String(1000 + loan.groupId * 10 + (loan.slotNumber || 1))}`,
  };
}

function getLenderSpendableBalance(user: User): number {
  const activeRole = user.activeRole || user.role;
  if (activeRole === 'lender') {
    return Number(user.roleWallets?.lender?.credit ?? user.credit ?? 0);
  }
  if (user.roleWallets?.lender && Number(user.roleWallets.lender.credit || 0) > 0) {
    return Number(user.roleWallets.lender.credit || 0);
  }
  return Number(user.credit || 0);
}

function deductLenderBalance(user: User, principalKes: number): number {
  const currentBalance = getLenderSpendableBalance(user);
  const nextCents = toCents(currentBalance) - toCents(principalKes);
  const nextBalance = fromCents(Math.max(0, nextCents));

  if (!user.roleWallets) {
    user.roleWallets = {
      member: { credit: Number(user.credit || 0), coins: Number(user.coins || 0), points: Number(user.points || 0) },
      merchant: { credit: 0, coins: 0, points: 0 },
      lender: { credit: currentBalance, coins: 0, points: 0 },
    };
  }
  if (!user.roleWallets.lender) {
    user.roleWallets.lender = { credit: nextBalance, coins: 0, points: 0 };
  } else {
    user.roleWallets.lender.credit = nextBalance;
  }

  const activeRole = user.activeRole || user.role;
  if (activeRole === 'lender' || user.role === 'lender') {
    user.credit = nextBalance;
  } else if (Number(user.credit || 0) >= principalKes) {
    user.credit = fromCents(toCents(user.credit || 0) - toCents(principalKes));
  }
  return nextBalance;
}

function generateWalletRef(prefix: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}_${suffix}`;
}

// 1. GET /api/groups/:id/lenders — list authorized lenders for group
groupLoansRouter.get('/groups/:id/lenders', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const groupId = Number(req.params.id);
  const db = await getDatabase();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Group not found.');
  }

  const lenders = getActiveGroupLenders(db, groupId);
  return res.json({
    lenders,
    feeRate: LOAN_PLATFORM_FEE_RATE,
  });
});

const authorizeLenderSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  identifier: z.string().trim().min(2).max(120).optional(),
}).refine((d) => Boolean(d.userId || d.identifier), {
  message: 'Provide a lender userId or identifier (email, phone, or username).',
});

// 2. POST /api/groups/:id/lenders — Moderator or Admin authorizes a group-scoped lender
groupLoansRouter.post('/groups/:id/lenders', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required to authorize a lender.');
  }

  const parsed = authorizeLenderSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const groupId = Number(req.params.id);

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
      }

      const actor = db.users.find((u) => u.id === authUser.id) || authUser;
      if (!isGroupModerator(actor, group)) {
        throw Object.assign(
          new Error('Only the Group Moderator or Admin can authorize lenders for this group.'),
          { status: 403, code: 'FORBIDDEN' }
        );
      }

      let targetUser: User | undefined;
      if (parsed.data.userId) {
        targetUser = db.users.find((u) => u.id === parsed.data.userId);
      } else if (parsed.data.identifier) {
        const needle = parsed.data.identifier.toLowerCase();
        targetUser = db.users.find(
          (u) =>
            u.email?.toLowerCase() === needle ||
            u.username?.toLowerCase() === needle ||
            u.phone?.toLowerCase() === needle
        );
      }

      if (!targetUser) {
        throw Object.assign(new Error('Target user not found.'), { status: 404, code: 'USER_NOT_FOUND' });
      }

      const hasLenderRole =
        targetUser.role === 'lender' ||
        targetUser.activeRole === 'lender' ||
        Boolean(targetUser.roles?.includes('lender'));
      if (!hasLenderRole && targetUser.role !== 'admin') {
        throw Object.assign(
          new Error('Only accounts registered with the Lender role can be authorized as group lenders.'),
          { status: 400, code: 'INVALID_LENDER_ROLE' }
        );
      }

      if (!db.groupLenders) db.groupLenders = [];
      const now = Date.now();
      let record = db.groupLenders.find((gl) => gl.groupId === groupId && gl.userId === targetUser!.id);

      if (record) {
        record.status = 'ACTIVE';
        record.authorizedBy = actor.id;
        record.authorizedByName = actor.name;
        record.revokedAt = null;
        record.userName = targetUser.name;
        record.userPhone = targetUser.phone || undefined;
      } else {
        record = {
          id: `gl_${groupId}_${targetUser.id}`,
          groupId,
          userId: targetUser.id,
          userName: targetUser.name,
          userPhone: targetUser.phone || undefined,
          authorizedBy: actor.id,
          authorizedByName: actor.name,
          status: 'ACTIVE',
          createdAt: now,
          revokedAt: null,
        };
        db.groupLenders.push(record!);
      }

      if (!group.lenderId) {
        group.lenderId = targetUser.id;
        group.lenderName = targetUser.name;
        group.lenderJoinedAt = now;
      }

      group.chat.push({
        id: `chat_${now}_lender_auth`,
        senderId: actor.id,
        senderName: actor.name,
        kind: 'system',
        text: `🤝 ${targetUser.name} has been authorized by ${actor.name} as an approved Group Lender.`,
        timestamp: now,
      });

      logAudit(
        db,
        actor.id,
        actor.name,
        'GROUP_LENDER_AUTHORIZED',
        `Authorized lender #${targetUser.id} (${targetUser.name}) for group #${groupId}`
      );

      return {
        lender: record,
        lenders: getActiveGroupLenders(db, groupId),
        group,
      };
    });

    emitPlatformEvent('group.loan.updated', {
      groupId,
      action: 'lender_authorized',
      lenderId: result.lender!.userId,
    });

    return res.status(201).json({
      lender: result.lender!,
      lenders: result.lenders,
      group: result.group,
      message: `${result.lender!.userName} is now authorized as a lender for this group.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to authorize lender.');
  }
});

// 3. DELETE /api/groups/:id/lenders/:userId — Moderator or Admin revokes group lender authorization
groupLoansRouter.delete('/groups/:id/lenders/:userId', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
  }

  const groupId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    return sendApiError(res, 400, 'INVALID_USER_ID', 'Invalid lender userId.');
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
      }

      const actor = db.users.find((u) => u.id === authUser.id) || authUser;
      if (!isGroupModerator(actor, group)) {
        throw Object.assign(
          new Error('Only the Group Moderator or Admin can revoke group lender access.'),
          { status: 403, code: 'FORBIDDEN' }
        );
      }

      const record = (db.groupLenders || []).find(
        (gl) => gl.groupId === groupId && gl.userId === targetUserId && gl.status === 'ACTIVE'
      );
      if (!record) {
        throw Object.assign(new Error('Active lender authorization not found for this group.'), {
          status: 404,
          code: 'LENDER_NOT_FOUND',
        });
      }

      const now = Date.now();
      record.status = 'REVOKED';
      record.revokedAt = now;

      const remainingActive = getActiveGroupLenders(db, groupId);
      if (group.lenderId === targetUserId) {
        const nextPrimary = remainingActive[0];
        group.lenderId = nextPrimary ? nextPrimary.userId : null;
        group.lenderName = nextPrimary ? nextPrimary.userName : null;
      }

      logAudit(
        db,
        actor.id,
        actor.name,
        'GROUP_LENDER_REVOKED',
        `Revoked lender #${targetUserId} (${record.userName}) from group #${groupId}`
      );

      return { revoked: record, lenders: remainingActive, group };
    });

    emitPlatformEvent('group.loan.updated', {
      groupId,
      action: 'lender_revoked',
      lenderId: targetUserId,
    });

    return res.json({
      lenders: result.lenders,
      group: result.group,
      message: `${result.revoked.userName} has been removed as an authorized lender for this group.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to revoke lender.');
  }
});

// Block legacy self-claim bypass so moderators stay in control of group lenders
groupLoansRouter.post('/groups/:id/claim-lender', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const groupId = Number(req.params.id);
  const db = await getDatabase();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Group not found.');
  }

  if (isAuthorizedLenderForGroup(db, authUser, groupId)) {
    return res.json({
      success: true,
      group,
      message: 'You are already authorized as a lender for this group.',
    });
  }

  return sendApiError(
    res,
    403,
    'UNAUTHORIZED_LENDER',
    'Group lenders are group-scoped and must be authorized by the Group Moderator or Admin.'
  );
});

// 4. GET /api/groups/:id/loans — list group loans + authorized lenders
groupLoansRouter.get('/groups/:id/loans', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const groupId = Number(req.params.id);
  const viewer = await resolveAuthenticatedUser(req).catch(() => null);
  const db = await getDatabase();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Group not found.');
  }

  const loans = (db.peerLoans || [])
    .filter((l) => l.groupId === groupId)
    .map((l) => sanitizeLoanForViewer(l, viewer, db, group));

  return res.json({
    loans,
    lenders: getActiveGroupLenders(db, groupId),
    feeRate: LOAN_PLATFORM_FEE_RATE,
  });
});

const requestLoanSchema = z.object({
  amount: z.coerce.number().positive('Loan amount must be greater than zero.').max(10000000),
  purpose: z.string().trim().min(3).max(400).optional(),
  repaymentPeriod: z.string().trim().max(120).optional(),
  repaymentDays: z.coerce.number().int().positive().max(365).optional(),
  productId: z.coerce.number().int().positive().optional(),
});

async function handleCreateLoanRequest(req: Request, res: Response, next: NextFunction) {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required to request a loan.');
  }

  const parsed = requestLoanSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const groupId = Number(req.params.id);

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
      }

      const actor = db.users.find((u) => u.id === authUser.id) || authUser;
      const activeRole = actor.activeRole || actor.role;
      if (activeRole === 'merchant' || activeRole === 'lender' || actor.role === 'merchant' || actor.role === 'lender') {
        throw Object.assign(
          new Error('Only active Group Members can request a loan in a group.'),
          { status: 403, code: 'FORBIDDEN' }
        );
      }

      const slot = group.slots.find((s) => s.userId === actor.id && s.status === 'active');
      if (!slot) {
        throw Object.assign(
          new Error('You must be an active member with an assigned slot in this group to request a loan.'),
          { status: 403, code: 'NOT_GROUP_MEMBER' }
        );
      }

      const numAmount = Math.round(parsed.data.amount * 100) / 100;
      const remainingOwed = Math.max(0, (slot.targetAmount || group.productPrice) - (slot.paidAmount || 0));
      if (remainingOwed > 0 && numAmount > remainingOwed) {
        throw Object.assign(
          new Error(`Requested loan (KSh ${numAmount.toLocaleString()}) exceeds your remaining group obligation of KSh ${remainingOwed.toLocaleString()}.`),
          { status: 400, code: 'AMOUNT_EXCEEDS_OBLIGATION' }
        );
      }

      const { feeCents, netCents } = computeFeeCents(numAmount, LOAN_PLATFORM_FEE_RATE);
      const feeKes = fromCents(feeCents);
      const netKes = fromCents(netCents);
      const now = Date.now();
      const borrowerCode = slot.memberCode || `BYL-${String(1000 + group.id * 10 + slot.slotNumber)}`;
      const periodText = (parsed.data.repaymentPeriod || 'Within 7 Days').trim();
      const periodDays = Number(parsed.data.repaymentDays) || 7;
      const purposeText = parsed.data.purpose?.trim() || 'To pay for an arrears (clear missed Chama days)';

      const newLoan: PeerLoanRequest = {
        id: db.nextIds.peerLoan++,
        groupId: group.id,
        groupName: group.name,
        slotNumber: slot.slotNumber,
        requesterId: actor.id,
        requesterName: actor.name,
        requesterPhone: actor.phone || undefined,
        borrowerId: actor.id,
        borrowerName: actor.name,
        borrowerCode,
        productId: parsed.data.productId || group.productId,
        productTitle: group.productTitle,
        productImage: group.productImage,
        amount: numAmount,
        requestedAmount: numAmount,
        approvedAmount: numAmount,
        purpose: purposeText,
        repaymentPeriod: periodText,
        repaymentDays: periodDays,
        status: 'open',
        createdAt: now,
        feeRate: LOAN_PLATFORM_FEE_RATE,
        platformFeePercent: 1,
        platformFeeAmount: feeKes,
        platformFeeCents: feeCents,
        netDisbursedCents: netCents,
        netDisbursedAmount: netKes,
        platformFeeStatus: 'pending',
        externalAgreementAcknowledged: true,
      };

      db.peerLoans = db.peerLoans || [];
      db.peerLoans.unshift(newLoan);

      group.chat.push({
        id: `chat_${now}_loan_req`,
        senderId: actor.id,
        senderName: actor.name,
        kind: 'system',
        text: `📢 LOAN REQUEST: ${actor.name} (${borrowerCode}, Slot #${slot.slotNumber}) requested KSh ${numAmount.toLocaleString()}. 1% platform fee (KSh ${feeKes.toLocaleString()}) deducted on funding · Net KSh ${netKes.toLocaleString()} credited to group-locked wallet. Reason: "${purposeText}".`,
        timestamp: now,
      });

      logAudit(
        db,
        actor.id,
        actor.name,
        'PEER_LOAN_REQUESTED',
        `Requested loan #${newLoan.id} of KSh ${numAmount} for Group #${group.id} (${borrowerCode})`
      );

      return { loan: newLoan, group };
    });

    emitPlatformEvent('group.loan.updated', {
      groupId,
      loanId: result.loan.id,
      status: result.loan.status,
    });
    emitPlatformEvent('group.chat.message', { groupId });

    return res.status(201).json({
      loan: result.loan,
      message: 'Your loan request has been posted to the group loan desk.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to create loan request.');
  }
}

groupLoansRouter.post('/groups/:id/loans', ensureNumericGroupId, handleCreateLoanRequest);
groupLoansRouter.post('/groups/:id/loans/request', ensureNumericGroupId, handleCreateLoanRequest);

// 5. POST /api/groups/:id/loans/:loanId/contacted — Authorized lender marks borrower contacted
groupLoansRouter.post('/groups/:id/loans/:loanId/contacted', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required.');
  }

  const groupId = Number(req.params.id);
  const loanId = Number(req.params.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return sendApiError(res, 400, 'INVALID_LOAN_ID', 'Invalid loan ID.');
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
      }
      const loan = (db.peerLoans || []).find((l) => l.id === loanId && l.groupId === groupId);
      if (!loan) {
        throw Object.assign(new Error('Loan request not found in this group.'), { status: 404, code: 'LOAN_NOT_FOUND' });
      }

      const actor = db.users.find((u) => u.id === authUser.id) || authUser;
      const isAllowed =
        actor.role === 'admin' ||
        actor.activeRole === 'admin' ||
        isGroupModerator(actor, group) ||
        isAuthorizedLenderForGroup(db, actor, groupId);

      if (!isAllowed) {
        throw Object.assign(
          new Error('You must be an authorized lender for this group to mark borrowers contacted.'),
          { status: 403, code: 'UNAUTHORIZED_LENDER' }
        );
      }

      if (String(loan.status).toLowerCase() === 'funded') {
        throw Object.assign(new Error('This loan has already been funded.'), {
          status: 409,
          code: 'ALREADY_FUNDED',
        });
      }

      const now = Date.now();
      loan.status = 'contacted';
      loan.contactedAt = now;
      loan.contactedBy = actor.id;
      loan.contactedByName = actor.name;

      logAudit(
        db,
        actor.id,
        actor.name,
        'LOAN_BORROWER_CONTACTED',
        `Marked loan #${loan.id} (Group #${groupId}) as contacted by ${actor.name}`
      );

      return { loan: sanitizeLoanForViewer(loan, actor, db, group) };
    });

    emitPlatformEvent('group.loan.updated', {
      groupId,
      loanId,
      status: 'contacted',
    });

    return res.json({
      loan: result.loan,
      message: 'Borrower marked as contacted.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to update loan status.');
  }
});

// 6. POST /api/groups/:id/loans/:loanId/fund & /api/loans/:loanId/fund — Atomic transactional funding
async function processAtomicLoanFunding(authUser: User, loanId: number, explicitGroupId?: number) {
  return runDatabaseTransaction(async (db) => {
    const loan = (db.peerLoans || []).find((l) => l.id === loanId);
    if (!loan || (explicitGroupId !== undefined && loan.groupId !== explicitGroupId)) {
      throw Object.assign(new Error('Loan request not found.'), { status: 404, code: 'LOAN_NOT_FOUND' });
    }

    const resolvedGroupId = explicitGroupId ?? loan.groupId;
    const group = db.groups.find((g) => g.id === resolvedGroupId);
    if (!group) {
      throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
    }

    const lender = db.users.find((u) => u.id === authUser.id);
    if (!lender) {
      throw Object.assign(new Error('Lender account not found.'), { status: 404, code: 'USER_NOT_FOUND' });
    }

    const isAdmin = lender.role === 'admin' || lender.activeRole === 'admin';
    const isAuthorized = isAdmin || isAuthorizedLenderForGroup(db, lender, resolvedGroupId);
    if (!isAuthorized) {
      throw Object.assign(
        new Error('You are not an authorized lender for this group. Ask the Group Moderator or Admin to authorize you.'),
        { status: 403, code: 'UNAUTHORIZED_LENDER' }
      );
    }

    if (loan.requesterId === lender.id) {
      throw Object.assign(new Error('You cannot fund your own loan request.'), {
        status: 400,
        code: 'SELF_FUND_FORBIDDEN',
      });
    }

    if (String(loan.status).toLowerCase() === 'funded') {
      throw Object.assign(new Error('This loan request has already been funded.'), {
        status: 409,
        code: 'ALREADY_FUNDED',
      });
    }

    const requester = db.users.find((u) => u.id === loan.requesterId);
    if (!requester) {
      throw Object.assign(new Error('Borrowing member account not found.'), {
        status: 404,
        code: 'BORROWER_NOT_FOUND',
      });
    }

    const principalKes = Number(loan.approvedAmount || loan.amount);
    const { principalCents, feeCents, netCents } = computeFeeCents(principalKes, LOAN_PLATFORM_FEE_RATE);
    const feeKes = fromCents(feeCents);
    const netKes = fromCents(netCents);

    let updatedLenderWallet;
    try {
      const debitRes = debitWalletCents(db, {
        userId: lender.id,
        role: 'lender',
        amountCents: principalCents,
        category: 'LOAN_FUNDING',
        referenceId: `LOAN_FUND_${loan.id}`,
        idempotencyKey: `loan_fund_debit_${loan.id}`,
        note: `Funded loan #${loan.id} for ${requester.name} in Group #${resolvedGroupId} (Principal: KSh ${principalKes.toLocaleString()}, 1% platform fee: KSh ${feeKes.toLocaleString()})`,
        actorId: lender.id,
      });
      updatedLenderWallet = debitRes.wallet;
    } catch (err: any) {
      if (err?.code === 'INSUFFICIENT_BALANCE') {
        throw Object.assign(new Error(err.message || 'Insufficient available lender wallet balance.'), {
          status: 400,
          code: 'INSUFFICIENT_FUNDS',
        });
      }
      throw err;
    }
    const nextLenderBalance = fromCents(updatedLenderWallet.balanceCents);

    const platformAdmin = findPlatformAdminUser(db);
    if (platformAdmin && feeCents > 0) {
      creditWalletCents(db, {
        userId: platformAdmin.id,
        role: 'admin',
        amountCents: feeCents,
        category: 'PLATFORM_FEE',
        referenceId: `LOAN_FEE_${loan.id}`,
        idempotencyKey: `loan_fee_${loan.id}`,
        note: `1% platform fee on loan #${loan.id} (Group #${resolvedGroupId})`,
        actorId: lender.id,
      });
    }

    // Credit borrower's restricted group-locked non-withdrawable loan balance (99% net)
    const nextRestrictedTotal = fromCents(toCents(requester.restrictedLoanBalance || 0) + netCents);
    requester.restrictedLoanBalance = nextRestrictedTotal;
    requester.nonWithdrawableBalance = nextRestrictedTotal;
    if (!requester.restrictedLoanByGroup) requester.restrictedLoanByGroup = {};
    requester.restrictedLoanByGroup[resolvedGroupId] = fromCents(
      toCents(requester.restrictedLoanByGroup[resolvedGroupId] || 0) + netCents
    );

    if (!requester.roleWallets) {
      requester.roleWallets = {
        member: {
          credit: Number(requester.credit || 0),
          nonWithdrawableBalance: nextRestrictedTotal,
          coins: Number(requester.coins || 0),
          points: Number(requester.points || 0),
        },
        merchant: { credit: 0, coins: 0, points: 0 },
        lender: { credit: 0, coins: 0, points: 0 },
      };
    } else if (requester.roleWallets.member) {
      requester.roleWallets.member.nonWithdrawableBalance = nextRestrictedTotal;
    }

    const now = Date.now();
    if (!db.platformFees) db.platformFees = [];
    const feeEntry = {
      id: `pfee_${now}_${loan.id}`,
      loanId: loan.id,
      groupId: resolvedGroupId,
      lenderId: lender.id,
      borrowerId: requester.id,
      grossAmountCents: principalCents,
      feeRate: LOAN_PLATFORM_FEE_RATE,
      feeAmountCents: feeCents,
      netAmountCents: netCents,
      createdAt: now,
    };
    db.platformFees.unshift(feeEntry);

    db.storeCreditLedger.unshift(
      {
        id: db.nextIds.ledger++,
        userId: lender.id,
        amount: -principalKes,
        balanceAfter: nextLenderBalance,
        type: 'loan_disbursement',
        referenceId: `LOAN_FUND_${loan.id}`,
        note: `Funded loan #${loan.id} for ${requester.name} in Group #${resolvedGroupId} (Principal: KSh ${principalKes.toLocaleString()}, 1% platform fee: KSh ${feeKes.toLocaleString()})`,
        createdAt: now,
      },
      {
        id: db.nextIds.ledger++,
        userId: requester.id,
        amount: netKes,
        balanceAfter: nextRestrictedTotal,
        type: 'loan_funding',
        referenceId: `LOAN_RECV_${loan.id}`,
        note: `Group-locked loan credit received from ${lender.name} (Net KSh ${netKes.toLocaleString()} after 1% platform fee KSh ${feeKes.toLocaleString()}). Restricted to Group #${resolvedGroupId}.`,
        createdAt: now,
      }
    );

    loan.status = 'funded';
    loan.fundedByUserId = lender.id;
    loan.fundedByUserName = lender.name;
    loan.lenderId = lender.id;
    loan.lenderName = lender.name;
    loan.fundedAt = now;
    loan.feeRate = LOAN_PLATFORM_FEE_RATE;
    loan.platformFeePercent = 1;
    loan.platformFeeAmount = feeKes;
    loan.platformFeeCents = feeCents;
    loan.netDisbursedCents = netCents;
    loan.netDisbursedAmount = netKes;
    loan.platformFeeStatus = 'paid';

    if (!group.lenderId) {
      group.lenderId = lender.id;
      group.lenderName = lender.name;
      group.lenderJoinedAt = now;
    }

    if (!group.notifications) group.notifications = [];
    group.notifications.unshift({
      id: `notif_${now}_${loan.id}`,
      groupId: group.id,
      groupName: group.name,
      title: 'Loan Funded (Group-Locked)',
      message: `${lender.name} funded ${requester.name}'s loan of KSh ${principalKes.toLocaleString()}. Net KSh ${netKes.toLocaleString()} (99%) credited to restricted group balance; 1% fee (KSh ${feeKes.toLocaleString()}) recorded.`,
      type: 'system',
      timestamp: now,
    });

    group.chat.push({
      id: `chat_${now}_loan_funded_${loan.id}`,
      senderId: lender.id,
      senderName: lender.name,
      kind: 'system',
      text: `✅ LOAN FUNDED: ${lender.name} funded KSh ${principalKes.toLocaleString()} for ${requester.name} (Slot #${loan.slotNumber}). Net KSh ${netKes.toLocaleString()} credited to ${requester.name}'s Group #${group.id} locked wallet after 1% platform fee (KSh ${feeKes.toLocaleString()}).`,
      timestamp: now,
    });

    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `unotif_${now}_${loan.id}`,
      userId: requester.id,
      title: 'Loan Credited to Group Wallet',
      message: `KSh ${netKes.toLocaleString()} (99% net after 1% fee) from ${lender.name} is now available to pay contributions in "${group.name}". Loan funds are non-withdrawable and locked to this group.`,
      type: 'payment',
      read: false,
      timestamp: now,
    });

    logAudit(
      db,
      lender.id,
      lender.name,
      'PEER_LOAN_FUNDED',
      `Funded loan #${loan.id} atomically: Principal KSh ${principalKes}, 1% Fee KSh ${feeKes}, Net Group-Locked KSh ${netKes} for Group #${resolvedGroupId}`
    );

    return {
      loan: sanitizeLoanForViewer(loan, lender, db, group),
      lenderBalance: nextLenderBalance,
      borrowerRestrictedBalance: nextRestrictedTotal,
      borrowerGroupLockedBalance: requester.restrictedLoanByGroup[resolvedGroupId],
      feeAmount: feeKes,
      feeAmountCents: feeCents,
      netCredited: netKes,
      netDisbursedCents: netCents,
      platformFee: feeEntry,
      groupId: resolvedGroupId,
      borrowerId: requester.id,
      lenderId: lender.id,
    };
  });
}

groupLoansRouter.post('/groups/:id/loans/:loanId/fund', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required to fund this loan.');
  }

  const groupId = Number(req.params.id);
  const loanId = Number(req.params.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return sendApiError(res, 400, 'INVALID_LOAN_ID', 'Invalid loan ID.');
  }

  try {
    const result = await processAtomicLoanFunding(authUser, loanId, groupId);
    emitPlatformEvent('group.loan.updated', {
      groupId: result.groupId,
      loanId: result.loan.id,
      status: 'funded',
    });
    emitPlatformEvent('group.chat.message', { groupId: result.groupId });
    emitPlatformEvent(
      'user.wallet.updated',
      {
        borrowerId: result.borrowerId,
        lenderId: result.lenderId,
        groupId: result.groupId,
      },
      [result.borrowerId, result.lenderId]
    );

    return res.json({
      ...result,
      message: `Loan funded! KSh ${result.netCredited.toLocaleString()} credited to borrower's group-locked balance (1% fee: KSh ${result.feeAmount.toLocaleString()}).`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to fund loan.');
  }
});

groupLoansRouter.post('/loans/:loanId/fund', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in required to fund this loan.');
  }
  const loanId = Number(req.params.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return sendApiError(res, 400, 'INVALID_LOAN_ID', 'Invalid loan ID.');
  }

  try {
    const result = await processAtomicLoanFunding(authUser, loanId, undefined);
    emitPlatformEvent('group.loan.updated', {
      groupId: result.groupId,
      loanId: result.loan.id,
      status: 'funded',
    });
    emitPlatformEvent(
      'user.wallet.updated',
      {
        borrowerId: result.borrowerId,
        lenderId: result.lenderId,
        groupId: result.groupId,
      },
      [result.borrowerId, result.lenderId]
    );

    return res.json({
      ...result,
      message: `Loan funded! KSh ${result.netCredited.toLocaleString()} credited to borrower's group-locked balance (1% fee: KSh ${result.feeAmount.toLocaleString()}).`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Failed to fund loan.');
  }
});

// 7. GET /api/lenders/alerts — role-enforced alerts for lenders (masked unless group-authorized)
groupLoansRouter.get('/lenders/alerts', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const activeRole = authUser.activeRole || authUser.role || 'member';
  if (activeRole !== 'lender' && authUser.role !== 'admin') {
    return sendApiError(
      res,
      403,
      'FORBIDDEN',
      'Access denied. Lender role required to access loan alerts.'
    );
  }

  const db = await getDatabase();
  const alerts = (db.peerLoans || []).map((loan) => {
    const group = db.groups.find((g) => g.id === loan.groupId);
    const product = group ? db.products.find((p) => p.id === group.productId) : null;
    const sanitized = sanitizeLoanForViewer(loan, authUser, db, group);
    return {
      ...sanitized,
      productTitle: group?.productTitle || product?.title || 'Group Product',
      productImage: group?.productImage || product?.images?.[0] || './images/cookware_set.jpg',
      groupLenderId: group?.lenderId || null,
      groupLenderName: group?.lenderName || null,
      isAuthorizedForGroup: isAuthorizedLenderForGroup(db, authUser, loan.groupId),
      groupSize: group?.size || 0,
      dailyAmount: group?.dailyAmount || 0,
    };
  });

  return res.json({ alerts, feeRate: LOAN_PLATFORM_FEE_RATE });
});

// 8. POST /api/groups/:id/pay-from-wallet — Group installment payment consuming group-locked loan balance first, then available credit
const payFromWalletSchema = z.object({
  slotNumber: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive('Payment amount must be greater than zero.'),
});

groupLoansRouter.post('/groups/:id/pay-from-wallet', ensureNumericGroupId, async (req: Request, res: Response, next: NextFunction) => {
  if (!/^\d+$/.test(String(req.params.id || ''))) return next();
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const parsed = payFromWalletSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const groupId = Number(req.params.id);
  const { slotNumber, amount: numAmount } = parsed.data;
  const amountCents = toCents(numAmount);

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const user = db.users.find((u) => u.id === authUser.id);
      if (!user) {
        throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' });
      }
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw Object.assign(new Error('Group not found.'), { status: 404, code: 'GROUP_NOT_FOUND' });
      }

      const slot = group.slots.find(
        (s) => s.slotNumber === slotNumber && s.userId === user.id && s.status === 'active'
      );
      if (!slot) {
        throw Object.assign(
          new Error('Active slot not found for your account in this group.'),
          { status: 400, code: 'SLOT_NOT_FOUND' }
        );
      }

      const groupLockedKes = Number(user.restrictedLoanByGroup?.[groupId] || 0);
      const totalRestrictedKes = Number(user.restrictedLoanBalance || 0);
      const otherGroupLockedCents = Math.max(0, toCents(totalRestrictedKes) - toCents(groupLockedKes));
      const generalCreditKes = Number(user.credit || 0);
      const availableCents = toCents(groupLockedKes) + toCents(generalCreditKes);

      if (availableCents < amountCents) {
        if (otherGroupLockedCents > 0) {
          throw Object.assign(
            new Error(
              'Your restricted loan balance is locked to the group where the loan was funded and cannot be spent in another group.'
            ),
            { status: 400, code: 'LOAN_FUNDS_GROUP_ONLY' }
          );
        }
        throw Object.assign(
          new Error(
            `Insufficient wallet balance. Available for this group: KSh ${fromCents(availableCents).toLocaleString()}, required: KSh ${numAmount.toLocaleString()}.`
          ),
          { status: 400, code: 'INSUFFICIENT_FUNDS' }
        );
      }

      // Deduct group-locked loan funds first, then general available wallet credit
      const fromLockedCents = Math.min(toCents(groupLockedKes), amountCents);
      const fromCreditCents = amountCents - fromLockedCents;

      if (fromLockedCents > 0) {
        if (!user.restrictedLoanByGroup) user.restrictedLoanByGroup = {};
        user.restrictedLoanByGroup[groupId] = fromCents(toCents(groupLockedKes) - fromLockedCents);
        user.restrictedLoanBalance = fromCents(Math.max(0, toCents(totalRestrictedKes) - fromLockedCents));
        user.nonWithdrawableBalance = user.restrictedLoanBalance;
        if (user.roleWallets?.member) {
          user.roleWallets.member.nonWithdrawableBalance = user.restrictedLoanBalance;
        }
      }

      const now = Date.now();
      const paymentCode = generateWalletRef('WAL');

      if (fromCreditCents > 0) {
        debitWalletCents(db, {
          userId: user.id,
          role: 'member',
          amountCents: fromCreditCents,
          category: 'GROUP_INSTALLMENT',
          referenceId: paymentCode,
          idempotencyKey: `group_pay_${paymentCode}`,
          note: `Group #${group.id} Slot #${slot.slotNumber} installment paid from wallet`,
          actorId: user.id,
        });
      }

      slot.paidAmount = (slot.paidAmount || 0) + numAmount;
      slot.lastPaymentDate = now;
      const paymentRecord: PaymentRecord = {
        id: db.nextIds.payment++,
        type: 'group_installment',
        userId: user.id,
        userName: user.name,
        code: paymentCode,
        amount: numAmount,
        groupId: group.id,
        groupName: group.name,
        slotNumber: slot.slotNumber,
        productId: group.productId,
        status: 'approved',
        createdAt: now,
        approvedAt: now,
      };
      db.payments.unshift(paymentRecord);

      db.storeCreditLedger.unshift({
        id: db.nextIds.ledger++,
        userId: user.id,
        amount: -numAmount,
        balanceAfter: user.credit,
        type: 'purchase_deduction',
        referenceId: paymentCode,
        note: `Group #${group.id} Slot #${slot.slotNumber} installment paid from wallet${fromLockedCents > 0 ? ` (includes KSh ${fromCents(fromLockedCents).toLocaleString()} group-locked loan funds)` : ''}`,
        createdAt: now,
      });

      user.points = (user.points || 0) + Math.floor(numAmount / 10);

      const progressPercent = Math.min(100, Math.round(((slot.paidAmount || 0) / group.productPrice) * 100));
      group.currentRoundPaid = (group.currentRoundPaid || 0) + numAmount;
      const targetAmt = group.targetAmountPerRound || group.productPrice;
      group.roundBalanceRemaining = Math.max(0, targetAmt - group.currentRoundPaid);
      if (group.currentRoundPaid >= targetAmt) {
        group.isReadyForPickup = true;
        group.chat.push({
          id: `chat_${now}_pickup`,
          senderId: 1,
          senderName: 'System Verification',
          kind: 'system',
          text: `✅ 100% PAID! Full target amount of KSh ${targetAmt.toLocaleString()} reached! Item is READY FOR PICKUP for Member #${group.currentRecipientSlot || 1}!`,
          timestamp: now,
        });
      }

      group.chat.push({
        id: `chat_${now}_wpay`,
        senderId: user.id,
        senderName: user.name,
        kind: 'normal',
        text: `💳 Paid KSh ${numAmount.toLocaleString()} for Slot #${slot.slotNumber} from wallet balance. Progress is now ${progressPercent}%.`,
        timestamp: now,
      });

      logAudit(
        db,
        user.id,
        user.name,
        'WALLET_SLOT_PAYMENT',
        `Paid KSh ${numAmount} for Group #${group.id} Slot #${slot.slotNumber} (Locked used: KSh ${fromCents(fromLockedCents)}, Credit used: KSh ${fromCents(fromCreditCents)})`
      );

      return {
        group,
        walletBalance: user.credit,
        restrictedLoanBalance: user.restrictedLoanBalance || 0,
        restrictedLoanByGroup: user.restrictedLoanByGroup || {},
        paidAmount: slot.paidAmount,
        progressPercent,
        userId: user.id,
      };
    });

    emitPlatformEvent('user.wallet.updated', { userId: result.userId, groupId }, [result.userId]);
    emitPlatformEvent('group.membership.updated', { groupId });

    return res.json({
      group: result.group,
      walletBalance: result.walletBalance,
      restrictedLoanBalance: result.restrictedLoanBalance,
      restrictedLoanByGroup: result.restrictedLoanByGroup,
      paidAmount: result.paidAmount,
      progressPercent: result.progressPercent,
      message: `Payment of KSh ${numAmount.toLocaleString()} applied from your wallet! Progress is now ${result.progressPercent}%.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERNAL_ERROR', err.message || 'Payment failed.');
  }
});

// 9. POST /api/wallet/withdraw — Block cash withdrawal, explicitly flagging restricted loan funds
groupLoansRouter.post('/wallet/withdraw', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const db = await getDatabase();
  const user = db.users.find((u) => u.id === authUser.id) || authUser;
  const restricted = Number(user.restrictedLoanBalance || user.nonWithdrawableBalance || 0);

  if (restricted > 0) {
    return sendApiError(
      res,
      400,
      'LOAN_FUNDS_NOT_WITHDRAWABLE',
      'Loan proceeds are group-locked and non-withdrawable. You can only use them to pay contributions inside the funded group.'
    );
  }

  return sendApiError(
    res,
    403,
    'WITHDRAWALS_DISABLED',
    'Cash withdrawals are disabled on Buyoll. Store credits can only be used on verified marketplace purchases and Group contributions.'
  );
});

// 10. POST /api/wallet/spend — Generic wallet spend check enforcing group-lock on loan balance
const walletSpendSchema = z.object({
  amount: z.coerce.number().positive(),
  groupId: z.coerce.number().int().positive().optional(),
  note: z.string().trim().max(200).optional(),
});

groupLoansRouter.post('/wallet/spend', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const parsed = walletSpendSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const { amount, groupId } = parsed.data;
  const db = await getDatabase();
  const user = db.users.find((u) => u.id === authUser.id) || authUser;
  const generalCredit = Number(user.credit || 0);
  const restrictedTotal = Number(user.restrictedLoanBalance || 0);
  const groupLocked = groupId ? Number(user.restrictedLoanByGroup?.[groupId] || 0) : 0;

  if (toCents(generalCredit + groupLocked) < toCents(amount)) {
    if (toCents(restrictedTotal) > 0) {
      return sendApiError(
        res,
        400,
        'LOAN_FUNDS_GROUP_ONLY',
        'Restricted loan funds can only be spent inside the funded group.'
      );
    }
    return sendApiError(res, 400, 'INSUFFICIENT_FUNDS', 'Insufficient available wallet balance.');
  }

  return res.json({
    allowed: true,
    availableCredit: generalCredit,
    groupLockedBalance: groupLocked,
  });
});
