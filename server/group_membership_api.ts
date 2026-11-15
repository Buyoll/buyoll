import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction, DatabaseSchema } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { sendApiError, sendZodError } from './errors.js';
import { emitPlatformEvent } from './events.js';
import { ChamaGroup, GroupJoinPolicy, GroupJoinRequest, GroupSlot, User } from '../src/types.js';

export const groupMembershipRouter = Router();

function isNumericIdParam(raw: string): boolean {
  return /^\d+$/.test(String(raw || '').trim());
}

function getEffectiveRole(user: User): string {
  return user.activeRole || (user.role === 'buyer' ? 'member' : user.role) || 'member';
}

function getEffectiveJoinPolicy(group: ChamaGroup): GroupJoinPolicy {
  if (group.joinPolicy === 'OPEN' || group.joinPolicy === 'APPROVAL' || group.joinPolicy === 'INVITE_ONLY') {
    return group.joinPolicy;
  }
  return group.isInviteOnly ? 'INVITE_ONLY' : 'OPEN';
}

function getMaxMembers(group: ChamaGroup): number {
  return Number(group.maxMembers || group.size || group.totalSlots || 10);
}

function isGroupModerator(group: ChamaGroup, user: User): boolean {
  if (group.moderatorId === user.id) return true;
  if (Array.isArray(group.moderators) && group.moderators.includes(user.id)) return true;
  if (group.adminId === user.id && group.vendorId !== user.id) return true;
  return false;
}

function isProductLive(product: any): boolean {
  if (!product) return true;
  if (product.status === 'PUBLISHED') return true;
  if (product.status === 'DRAFT') return false;
  return product.publicationStatus !== 'draft' && product.live !== false;
}

function computeCallerMembership(db: DatabaseSchema, group: ChamaGroup, user: User | null) {
  const joinPolicy = getEffectiveJoinPolicy(group);
  const maxMembers = getMaxMembers(group);
  const occupiedCount = group.slots.filter((s) => s.status === 'active').length;
  const isFull = occupiedCount >= maxMembers || group.status === 'full';
  const pendingCount = (db.groupJoinRequests || []).filter(
    (r) => r.groupId === group.id && r.status === 'PENDING'
  ).length;

  if (!user) {
    return {
      isMember: false,
      isModerator: false,
      joinPolicy,
      maxMembers,
      occupiedCount,
      isFull,
      joinRequestStatus: 'NONE' as const,
      pendingRequestId: null,
      memberCode: null,
      slotNumber: null,
      canJoin: !isFull && group.status === 'active',
      pendingJoinRequestsCount: 0,
    };
  }

  const activeRole = getEffectiveRole(user);
  const mySlot = group.slots.find((s) => s.userId === user.id && s.status === 'active');
  const isMember = Boolean(mySlot);
  const isMod = isGroupModerator(group, user);
  const myPending = (db.groupJoinRequests || []).find(
    (r) => r.groupId === group.id && r.userId === user.id && r.status === 'PENDING'
  );
  const myLatestRejected = (db.groupJoinRequests || []).find(
    (r) => r.groupId === group.id && r.userId === user.id && r.status === 'REJECTED'
  );

  let joinRequestStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' = 'NONE';
  if (isMember) joinRequestStatus = 'APPROVED';
  else if (myPending) joinRequestStatus = 'PENDING';
  else if (myLatestRejected) joinRequestStatus = 'REJECTED';

  const canJoin =
    activeRole === 'member' &&
    !isMember &&
    !isFull &&
    group.status === 'active' &&
    joinRequestStatus !== 'PENDING' &&
    group.vendorId !== user.id;

  return {
    isMember,
    isModerator: isMod,
    joinPolicy,
    maxMembers,
    occupiedCount,
    isFull,
    joinRequestStatus,
    pendingRequestId: myPending?.id || null,
    memberCode: mySlot?.memberCode || mySlot?.inviteCode || null,
    slotNumber: mySlot?.slotNumber || null,
    canJoin,
    pendingJoinRequestsCount: isMod || activeRole === 'admin' ? pendingCount : 0,
  };
}

function enrollMemberIntoSlot(
  db: DatabaseSchema,
  group: ChamaGroup,
  memberUser: User,
  requestedSlotNumber?: number,
  referredByCode?: string
): { slot: GroupSlot; isModerator: boolean } | null {
  let targetSlot: GroupSlot | undefined;
  if (requestedSlotNumber) {
    const reqSlot = group.slots.find((s) => s.slotNumber === Number(requestedSlotNumber));
    if (reqSlot && (reqSlot.status === 'open' || reqSlot.status === 'replacement_eligible')) {
      targetSlot = reqSlot;
    }
  }
  if (!targetSlot) {
    targetSlot =
      group.slots.find((s) => s.status === 'replacement_eligible') ||
      group.slots.find((s) => s.status === 'open');
  }
  if (!targetSlot) return null;

  const now = Date.now();
  const memberCode = `BYL-${String(1000 + group.id * 10 + targetSlot.slotNumber)}`;
  targetSlot.userId = memberUser.id;
  targetSlot.userName = memberUser.name;
  targetSlot.userPhone = memberUser.phone;
  targetSlot.userAvatar = memberUser.avatar || memberUser.avatarUrl || null;
  targetSlot.memberCode = memberCode;
  if (referredByCode) {
    targetSlot.referredByCode = referredByCode;
  }
  targetSlot.status = 'active';
  targetSlot.joinedAt = now;
  targetSlot.isDefaulter = false;
  targetSlot.paidDays = targetSlot.paidDays || [];
  targetSlot.pendingDays = targetSlot.pendingDays || [];
  targetSlot.dailyPaymentRecords = targetSlot.dailyPaymentRecords || [];

  const hasRealModerator = Boolean(
    group.moderatorId &&
      group.moderatorId !== group.vendorId &&
      group.slots.some((s) => s.userId === group.moderatorId && s.status === 'active')
  );
  let assignedAsModerator = false;
  if (!hasRealModerator) {
    group.moderatorId = memberUser.id;
    group.moderators = [memberUser.id];
    group.adminId = memberUser.id;
    assignedAsModerator = true;
  }

  const maxMembers = getMaxMembers(group);
  group.occupiedCount = group.slots.filter((s) => s.status === 'active').length;
  group.availableCount = Math.max(0, maxMembers - group.occupiedCount);
  if (group.occupiedCount >= maxMembers) {
    group.status = 'full';
  }

  group.chat.push({
    id: `chat_${now}_${targetSlot.slotNumber}`,
    senderId: memberUser.id,
    senderName: memberUser.name,
    kind: 'system',
    text: assignedAsModerator
      ? `${memberUser.name} joined as Member #${targetSlot.slotNumber} (${memberCode}) and was assigned as Group Moderator!`
      : `${memberUser.name} joined as Member #${targetSlot.slotNumber} (${memberCode})!`,
    timestamp: now,
  });

  if (!group.notifications) group.notifications = [];
  group.notifications.unshift({
    id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
    groupId: group.id,
    groupName: group.name,
    title: assignedAsModerator ? 'Group Moderator Assigned' : 'New Member Joined',
    message: assignedAsModerator
      ? `${memberUser.name} joined as Member #${targetSlot.slotNumber} and is now the Group Moderator!`
      : `${memberUser.name} joined as Member #${targetSlot.slotNumber}. Welcome to the cycle!`,
    type: 'system',
    timestamp: now,
  });

  // Mark any pending requests for this user as APPROVED
  for (const r of db.groupJoinRequests || []) {
    if (r.groupId === group.id && r.userId === memberUser.id && r.status === 'PENDING') {
      r.status = 'APPROVED';
      r.reviewedAt = now;
    }
  }

  return { slot: targetSlot, isModerator: assignedAsModerator };
}

// GET /api/groups/:id — Returns group details + caller membership state (numeric IDs only)
groupMembershipRouter.get('/groups/:id', async (req: Request, res: Response, next: NextFunction) => {
  if (!isNumericIdParam(req.params.id)) return next();

  const db = await getDatabase();
  const groupId = Number(req.params.id);
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Group not found.');
  }

  const user = await resolveAuthenticatedUser(req, db);
  if (user) {
    const activeRole = getEffectiveRole(user);

    if (activeRole === 'admin') {
      return sendApiError(
        res,
        403,
        'FORBIDDEN',
        'Access denied. Administrative oversight must live inside the Admin dashboard.'
      );
    }

    if (activeRole === 'merchant') {
      const product = db.products.find((p) => p.id === group.productId);
      const isCreator =
        group.adminId === user.id || group.vendorId === user.id || product?.vendorId === user.id;
      const hasNotification = (db.userNotifications || []).some(
        (n) =>
          n.userId === user.id &&
          (n.groupId === group.id || (n.link && n.link.includes(`/chama/${group.id}`)))
      );
      if (!isCreator && !hasNotification) {
        return sendApiError(
          res,
          403,
          'FORBIDDEN',
          'Access denied. Merchants can only view groups they created or groups linked in notifications.'
        );
      }
    }

    if (activeRole === 'lender') {
      const isAssignedLender =
        group.lenderId === user.id ||
        (db.groupLenders || []).some(
          (gl) => gl.groupId === group.id && gl.userId === user.id && gl.status === 'ACTIVE'
        );
      const hasFundedLoan = (db.peerLoans || []).some(
        (l) => l.groupId === group.id && l.lenderId === user.id
      );
      const hasNotification = (db.userNotifications || []).some(
        (n) =>
          n.userId === user.id &&
          (n.groupId === group.id || (n.link && n.link.includes(`/chama/${group.id}`)))
      );
      if (!isAssignedLender && !hasFundedLoan && !hasNotification) {
        return sendApiError(
          res,
          403,
          'FORBIDDEN',
          'Access denied. Lenders can only view groups where they are authorized or via a received notification.'
        );
      }
    }
  }

  const membership = computeCallerMembership(db, group, user);
  return res.json({
    group: {
      ...group,
      joinPolicy: membership.joinPolicy,
      maxMembers: membership.maxMembers,
    },
    membership,
  });
});

// POST /api/groups/:id/join — Join open/invite-only group or submit request for approval-only group
groupMembershipRouter.post('/groups/:id/join', async (req: Request, res: Response, next: NextFunction) => {
  if (!isNumericIdParam(req.params.id)) return next();

  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Please sign in as a Member to join this group.');
  }

  const activeRole = getEffectiveRole(authUser);
  if (activeRole === 'merchant' || activeRole === 'lender' || activeRole === 'admin') {
    return sendApiError(
      res,
      403,
      'ROLE_ISOLATION_MEMBER_REQUIRED',
      'Merchants, Lenders, and Admins cannot join groups. Log out and sign in as a Member to join.'
    );
  }

  const groupId = Number(req.params.id);
  const { inviteCode, slotNumber, note } = req.body || {};

  const outcome = await runDatabaseTransaction(async (db) => {
    const dbUser = db.users.find((u) => u.id === authUser.id);
    if (!dbUser) {
      return { status: 401, code: 'UNAUTHORIZED', message: 'User account not found.' };
    }

    const group = db.groups.find((g) => g.id === groupId);
    if (!group) {
      return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };
    }

    const product = db.products.find((p) => p.id === group.productId);
    if (group.vendorId === dbUser.id || product?.vendorId === dbUser.id) {
      return {
        status: 403,
        code: 'FORBIDDEN',
        message: 'Merchants cannot join groups created for their own products.',
      };
    }

    if (product && !isProductLive(product)) {
      return {
        status: 400,
        code: 'PRODUCT_NOT_POSTED',
        message: 'This product has not been published to Announcements yet.',
      };
    }

    const existingSlot = group.slots.find((s) => s.userId === dbUser.id && s.status === 'active');
    if (existingSlot) {
      return {
        status: 409,
        code: 'ALREADY_MEMBER',
        message: `You are already Member #${existingSlot.slotNumber} in this group.`,
      };
    }

    if (group.status !== 'active') {
      return {
        status: 409,
        code: group.status === 'full' ? 'GROUP_FULL' : 'GROUP_UNAVAILABLE',
        message:
          group.status === 'full'
            ? 'This group is currently full. No open slots remain.'
            : `This group is ${group.status} and cannot accept new members.`,
      };
    }

    const maxMembers = getMaxMembers(group);
    const activeCount = group.slots.filter((s) => s.status === 'active').length;
    if (activeCount >= maxMembers) {
      group.status = 'full';
      return {
        status: 409,
        code: 'GROUP_FULL',
        message: 'This group has reached its maximum member capacity.',
      };
    }

    const policy = getEffectiveJoinPolicy(group);
    const upperCode = String(inviteCode || '').trim().toUpperCase();

    // Check if an explicit invite code was provided (or required by INVITE_ONLY)
    const approvedReq = (group.inviteRequests || []).find(
      (r) => r.userId === dbUser.id && r.status === 'approved'
    );
    const hasValidInvite = (() => {
      if (!upperCode) return false;
      if (
        (dbUser.referralCode && dbUser.referralCode.toUpperCase() === upperCode) ||
        group.slots.some((s) => s.userId === dbUser.id && s.inviteCode?.toUpperCase() === upperCode)
      ) {
        return 'SELF_REFERRAL' as const;
      }
      const friendUserMatch = db.users.some(
        (u) => u.id !== dbUser.id && u.referralCode && u.referralCode.toUpperCase() === upperCode
      );
      const memberSlotInviteMatch = group.slots.some(
        (s) =>
          s.userId !== null &&
          s.userId !== dbUser.id &&
          s.status === 'active' &&
          s.inviteCode?.toUpperCase() === upperCode
      );
      const groupCodeMatch = group.inviteCode && group.inviteCode.toUpperCase() === upperCode;
      const approvedInviteMatch = Boolean(
        (approvedReq && approvedReq.issuedCode?.toUpperCase() === upperCode) ||
          (group.inviteRequests || []).some(
            (r) => r.status === 'approved' && r.issuedCode?.toUpperCase() === upperCode
          )
      );
      return friendUserMatch || memberSlotInviteMatch || groupCodeMatch || approvedInviteMatch;
    })();

    if (hasValidInvite === 'SELF_REFERRAL') {
      return {
        status: 403,
        code: 'SELF_REFERRAL_FORBIDDEN',
        message: 'You cannot use your own referral code to join.',
      };
    }

    if (policy === 'INVITE_ONLY') {
      if (!upperCode) {
        return {
          status: 403,
          code: 'INVITE_CODE_REQUIRED',
          message: 'An approved invite or friend referral code is required to join this group.',
        };
      }
      if (!hasValidInvite) {
        return {
          status: 403,
          code: 'INVALID_INVITE_CODE',
          message: `Invite code "${upperCode}" is invalid.`,
        };
      }
    }

    if (policy === 'APPROVAL' && !hasValidInvite) {
      if (!db.groupJoinRequests) db.groupJoinRequests = [];
      const alreadyPending = db.groupJoinRequests.find(
        (r) => r.groupId === group.id && r.userId === dbUser.id && r.status === 'PENDING'
      );
      if (alreadyPending) {
        return {
          status: 409,
          code: 'ALREADY_PENDING',
          message: 'You already have a pending join request for this group.',
        };
      }

      const now = Date.now();
      const joinReq: GroupJoinRequest = {
        id: `gjr_${now}_${Math.random().toString(36).slice(2, 7)}`,
        groupId: group.id,
        userId: dbUser.id,
        userName: dbUser.name,
        userPhone: dbUser.phone,
        userAvatar: dbUser.avatar || dbUser.avatarUrl,
        note: note ? String(note).trim().slice(0, 300) : undefined,
        desiredSlot: slotNumber ? Number(slotNumber) : undefined,
        status: 'PENDING',
        createdAt: now,
      };
      db.groupJoinRequests.unshift(joinReq);
      logAudit(
        db,
        dbUser.id,
        dbUser.name,
        'GROUP_JOIN_REQUESTED',
        `Submitted join request for Group #${group.id} (${group.name}).`
      );
      return {
        status: 202,
        pending: true,
        joinRequest: joinReq,
        group,
        membership: computeCallerMembership(db, group, dbUser),
        message: 'Join request sent to the group moderator for approval.',
      };
    }

    // Reject invalid code even in OPEN if user explicitly typed a garbage code
    if (upperCode && !hasValidInvite) {
      return {
        status: 403,
        code: 'INVALID_INVITE_CODE',
        message: `Referral or invite code "${upperCode}" is invalid.`,
      };
    }

    const enrolled = enrollMemberIntoSlot(db, group, dbUser, slotNumber, upperCode || undefined);
    if (!enrolled) {
      group.status = 'full';
      return {
        status: 409,
        code: 'GROUP_FULL',
        message: 'This group is full. No available slots remain.',
      };
    }

    logAudit(
      db,
      dbUser.id,
      dbUser.name,
      'MEMBER_JOINED',
      `Joined Group #${group.id} as Member #${enrolled.slot.slotNumber} (${enrolled.slot.memberCode}).`
    );

    return {
      status: 200,
      pending: false,
      group,
      assignedSlot: enrolled.slot.slotNumber,
      memberCode: enrolled.slot.memberCode,
      isModerator: enrolled.isModerator,
      membership: computeCallerMembership(db, group, dbUser),
      message: enrolled.isModerator
        ? `Welcome! You are Member #${enrolled.slot.slotNumber} (${enrolled.slot.memberCode}) and Group Moderator.`
        : `Successfully joined Group as Member #${enrolled.slot.slotNumber} (${enrolled.slot.memberCode})!`,
    };
  });

  if (outcome.status >= 400) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
  }

  emitPlatformEvent('group.membership.updated', {
    groupId,
    userId: authUser.id,
    action: outcome.pending ? 'REQUESTED' : 'JOINED',
  });

  return res.status(outcome.status).json(outcome);
});

// DELETE /api/groups/:id/join-request — Cancel caller's own PENDING join request
groupMembershipRouter.delete(
  '/groups/:id/join-request',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const groupId = Number(req.params.id);
    const outcome = await runDatabaseTransaction(async (db) => {
      const pending = (db.groupJoinRequests || []).find(
        (r) => r.groupId === groupId && r.userId === authUser.id && r.status === 'PENDING'
      );
      if (!pending) {
        return { status: 404, code: 'REQUEST_NOT_FOUND', message: 'No pending join request found.' };
      }
      pending.status = 'CANCELLED';
      pending.reviewedAt = Date.now();
      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_JOIN_REQUEST_CANCELLED',
        `Cancelled pending join request for Group #${groupId}.`
      );
      return { status: 200 };
    });

    if (outcome.status !== 200) {
      return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
    }

    emitPlatformEvent('group.membership.updated', {
      groupId,
      userId: authUser.id,
      action: 'CANCELLED',
    });
    return res.json({ success: true, message: 'Join request cancelled.' });
  }
);

// POST /api/groups/:id/leave — Leave group if no unsettled active loan or arrears
groupMembershipRouter.post('/groups/:id/leave', async (req: Request, res: Response, next: NextFunction) => {
  if (!isNumericIdParam(req.params.id)) return next();

  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const groupId = Number(req.params.id);
  const outcome = await runDatabaseTransaction(async (db) => {
    const group = db.groups.find((g) => g.id === groupId);
    if (!group) {
      return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };
    }

    const mySlot = group.slots.find((s) => s.userId === authUser.id && s.status === 'active');
    if (!mySlot) {
      return { status: 404, code: 'NOT_A_MEMBER', message: 'You are not an active member of this group.' };
    }

    const hasUnsettledLoan = (db.peerLoans || []).some(
      (l) =>
        l.groupId === group.id &&
        l.requesterId === authUser.id &&
        ['funded', 'fee_pending', 'fee_verified'].includes(String(l.status || '').toLowerCase())
    );
    if (hasUnsettledLoan) {
      return {
        status: 409,
        code: 'CANNOT_LEAVE_ACTIVE_LOAN',
        message: 'You cannot leave a group while you have an active funded loan in this group.',
      };
    }

    if (mySlot.isDefaulter) {
      return {
        status: 409,
        code: 'CANNOT_LEAVE_WITH_ARREARS',
        message: 'Please resolve your slot arrears before leaving this group.',
      };
    }

    mySlot.userId = null;
    mySlot.userName = null;
    mySlot.userPhone = null;
    mySlot.userAvatar = null;
    mySlot.memberCode = undefined;
    mySlot.status = 'open';
    mySlot.joinedAt = undefined;

    const maxMembers = getMaxMembers(group);
    group.occupiedCount = group.slots.filter((s) => s.status === 'active').length;
    group.availableCount = Math.max(0, maxMembers - group.occupiedCount);
    if (group.status === 'full' && group.occupiedCount < maxMembers) {
      group.status = 'active';
    }

    // Reassign moderator cleanly if leaving member was moderator
    if (group.moderatorId === authUser.id) {
      const nextMember = group.slots.find((s) => s.status === 'active' && s.userId);
      group.moderatorId = nextMember?.userId || null;
      group.moderators = nextMember?.userId ? [nextMember.userId] : [];
      group.adminId = nextMember?.userId || 0;
    }

    const now = Date.now();
    group.chat.push({
      id: `chat_leave_${now}`,
      senderId: authUser.id,
      senderName: authUser.name,
      kind: 'system',
      text: `${authUser.name} left Slot #${mySlot.slotNumber}. Slot is now open.`,
      timestamp: now,
    });

    logAudit(db, authUser.id, authUser.name, 'MEMBER_LEFT_GROUP', `Left Group #${group.id} (Slot #${mySlot.slotNumber}).`);
    return { status: 200, group };
  });

  if (outcome.status !== 200) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
  }

  emitPlatformEvent('group.membership.updated', {
    groupId,
    userId: authUser.id,
    action: 'LEFT',
  });
  return res.json({ success: true, group: outcome.group, message: 'You have left the group.' });
});

// GET /api/groups/:id/join-requests — Moderator or Admin views pending/recent join requests (numeric IDs)
groupMembershipRouter.get(
  '/groups/:id/join-requests',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const db = await getDatabase();
    const groupId = Number(req.params.id);
    const group = db.groups.find((g) => g.id === groupId);
    if (!group) {
      return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Group not found.');
    }

    const role = getEffectiveRole(authUser);
    if (role !== 'admin' && !isGroupModerator(group, authUser)) {
      return sendApiError(
        res,
        403,
        'FORBIDDEN',
        'Only the Group Moderator or Admin can review group join requests.'
      );
    }

    const requests = (db.groupJoinRequests || []).filter((r) => r.groupId === groupId);
    return res.json({ requests });
  }
);

// POST /api/groups/:id/join-requests/:reqId/approve
groupMembershipRouter.post(
  '/groups/:id/join-requests/:reqId/approve',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const groupId = Number(req.params.id);
    const reqId = req.params.reqId;

    const outcome = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };

      const role = getEffectiveRole(authUser);
      if (role !== 'admin' && !isGroupModerator(group, authUser)) {
        return { status: 403, code: 'FORBIDDEN', message: 'Only the Group Moderator or Admin can approve join requests.' };
      }

      const joinReq = (db.groupJoinRequests || []).find((r) => r.id === reqId && r.groupId === groupId);
      if (!joinReq) return { status: 404, code: 'REQUEST_NOT_FOUND', message: 'Join request not found.' };
      if (joinReq.status !== 'PENDING') {
        return { status: 409, code: 'ALREADY_REVIEWED', message: `Request is already ${joinReq.status}.` };
      }

      const applicant = db.users.find((u) => u.id === joinReq.userId);
      if (!applicant) return { status: 404, code: 'USER_NOT_FOUND', message: 'Applicant user not found.' };

      if (group.slots.some((s) => s.userId === applicant.id && s.status === 'active')) {
        joinReq.status = 'APPROVED';
        joinReq.reviewedBy = authUser.id;
        joinReq.reviewedAt = Date.now();
        return { status: 200, group, joinReq };
      }

      const enrolled = enrollMemberIntoSlot(db, group, applicant, joinReq.desiredSlot);
      if (!enrolled) {
        return { status: 409, code: 'GROUP_FULL', message: 'Group has no available slots to approve applicant.' };
      }

      joinReq.status = 'APPROVED';
      joinReq.reviewedBy = authUser.id;
      joinReq.reviewedAt = Date.now();

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_JOIN_APPROVED',
        `Approved ${applicant.name} into Group #${groupId} Slot #${enrolled.slot.slotNumber}.`
      );
      return { status: 200, group, joinReq };
    });

    if (outcome.status !== 200) {
      return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
    }

    emitPlatformEvent('group.membership.updated', {
      groupId,
      requestId: reqId,
      action: 'APPROVED',
    });
    return res.json({ success: true, group: outcome.group, joinRequest: outcome.joinReq });
  }
);

// POST /api/groups/:id/join-requests/:reqId/reject
groupMembershipRouter.post(
  '/groups/:id/join-requests/:reqId/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const groupId = Number(req.params.id);
    const reqId = req.params.reqId;
    const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 200) : undefined;

    const outcome = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };

      const role = getEffectiveRole(authUser);
      if (role !== 'admin' && !isGroupModerator(group, authUser)) {
        return { status: 403, code: 'FORBIDDEN', message: 'Only the Group Moderator or Admin can reject join requests.' };
      }

      const joinReq = (db.groupJoinRequests || []).find((r) => r.id === reqId && r.groupId === groupId);
      if (!joinReq) return { status: 404, code: 'REQUEST_NOT_FOUND', message: 'Join request not found.' };
      if (joinReq.status !== 'PENDING') {
        return { status: 409, code: 'ALREADY_REVIEWED', message: `Request is already ${joinReq.status}.` };
      }

      joinReq.status = 'REJECTED';
      joinReq.reviewedBy = authUser.id;
      joinReq.reviewedAt = Date.now();
      joinReq.reason = reason;

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_JOIN_REJECTED',
        `Rejected join request ${reqId} for Group #${groupId}.`
      );
      return { status: 200, joinReq };
    });

    if (outcome.status !== 200) {
      return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
    }

    emitPlatformEvent('group.membership.updated', {
      groupId,
      requestId: reqId,
      action: 'REJECTED',
    });
    return res.json({ success: true, joinRequest: outcome.joinReq });
  }
);

// DELETE /api/groups/:id/members/:userId — Moderator or Admin removes a member
groupMembershipRouter.delete(
  '/groups/:id/members/:userId',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const groupId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);

    const outcome = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };

      const role = getEffectiveRole(authUser);
      if (role !== 'admin' && !isGroupModerator(group, authUser)) {
        return { status: 403, code: 'FORBIDDEN', message: 'Only the Group Moderator or Admin can remove members.' };
      }

      const slot = group.slots.find((s) => s.userId === targetUserId && s.status === 'active');
      if (!slot) {
        return { status: 404, code: 'MEMBER_NOT_FOUND', message: 'Active member slot not found.' };
      }

      const activeOtherMembers = group.slots.filter((s) => s.status === 'active' && s.userId !== targetUserId).length;
      if (group.moderatorId === targetUserId && activeOtherMembers > 0 && role !== 'admin') {
        return {
          status: 409,
          code: 'TRANSFER_MODERATOR_FIRST',
          message: 'Transfer moderator role to another member before removing yourself.',
        };
      }

      const hasUnsettledLoan = (db.peerLoans || []).some(
        (l) =>
          l.groupId === groupId &&
          l.requesterId === targetUserId &&
          String(l.status || '').toLowerCase() === 'funded'
      );
      if (hasUnsettledLoan) {
        return {
          status: 409,
          code: 'MEMBER_HAS_ACTIVE_LOAN',
          message: 'Cannot remove a member with an active funded loan.',
        };
      }

      const removedName = slot.userName || `Member #${slot.slotNumber}`;
      slot.userId = null;
      slot.userName = null;
      slot.userPhone = null;
      slot.userAvatar = null;
      slot.memberCode = undefined;
      slot.status = 'open';
      slot.joinedAt = undefined;

      const maxMembers = getMaxMembers(group);
      group.occupiedCount = group.slots.filter((s) => s.status === 'active').length;
      group.availableCount = Math.max(0, maxMembers - group.occupiedCount);
      if (group.status === 'full' && group.occupiedCount < maxMembers) {
        group.status = 'active';
      }

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_MEMBER_REMOVED',
        `Removed ${removedName} (User #${targetUserId}) from Group #${groupId}.`
      );
      return { status: 200, group };
    });

    if (outcome.status !== 200) {
      return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
    }

    emitPlatformEvent('group.membership.updated', {
      groupId,
      userId: targetUserId,
      action: 'REMOVED',
    });
    return res.json({ success: true, group: outcome.group });
  }
);

const joinPolicySchema = z.object({
  joinPolicy: z.enum(['OPEN', 'APPROVAL', 'INVITE_ONLY']),
});

// PATCH /api/groups/:id/join-policy — Moderator or Admin sets OPEN | APPROVAL | INVITE_ONLY
groupMembershipRouter.patch(
  '/groups/:id/join-policy',
  async (req: Request, res: Response, next: NextFunction) => {
    if (!isNumericIdParam(req.params.id)) return next();

    const authUser = await resolveAuthenticatedUser(req);
    if (!authUser) {
      return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    const parsed = joinPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, 422);
    }

    const groupId = Number(req.params.id);
    const outcome = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) return { status: 404, code: 'GROUP_NOT_FOUND', message: 'Group not found.' };

      const role = getEffectiveRole(authUser);
      if (role !== 'admin' && !isGroupModerator(group, authUser)) {
        return {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only the Group Moderator or Admin can change group join policy.',
        };
      }

      group.joinPolicy = parsed.data.joinPolicy;
      group.isInviteOnly = parsed.data.joinPolicy === 'INVITE_ONLY';
      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_JOIN_POLICY_UPDATED',
        `Updated Group #${groupId} joinPolicy to ${parsed.data.joinPolicy}.`
      );
      return { status: 200, group };
    });

    if (outcome.status !== 200) {
      return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
    }

    emitPlatformEvent('group.membership.updated', {
      groupId,
      action: 'POLICY_UPDATED',
      joinPolicy: parsed.data.joinPolicy,
    });
    return res.json({ success: true, group: outcome.group });
  }
);
