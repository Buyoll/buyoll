import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDatabase, saveDatabase, logAudit } from './db.js';
import {
  User,
  TrustChamaGroup,
  TrustGroupMember,
  TrustJoinRequest,
  PlatformAnnouncementSlot,
  PlatformAnnouncementRevision,
  JoinRelationship,
} from '../src/types.js';

export const chamaTrustRouter = Router();

// ----------------------------------------------------------------------
// AUTH & SESSION HELPERS
// ----------------------------------------------------------------------
async function getAuthUser(req: Request): Promise<User | null> {
  const userIdHeader = req.headers['x-user-id'] || req.headers['authorization'] || req.query.authUserId;
  if (!userIdHeader) return null;
  const idStr = String(userIdHeader).replace(/^Bearer\s+/, '').trim();
  const db = await getDatabase();
  const uid = Number(idStr);
  if (!isNaN(uid)) {
    const user = db.users.find((u) => u.id === uid);
    if (user) return user;
  }
  // Also check email if provided in header
  const userByEmail = db.users.find((u) => u.email?.toLowerCase() === idStr.toLowerCase());
  return userByEmail || null;
}

// ----------------------------------------------------------------------
// MEMBER CODE GENERATOR (CH-XXXX-XXXX)
// Unambiguous alphabet: no 0, O, 1, I
// ----------------------------------------------------------------------
const UNAMBIGUOUS_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateMemberCode(): string {
  const bytes = crypto.randomBytes(8);
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += UNAMBIGUOUS_CHARS[bytes[i] % UNAMBIGUOUS_CHARS.length];
    p2 += UNAMBIGUOUS_CHARS[bytes[i + 4] % UNAMBIGUOUS_CHARS.length];
  }
  return `CH-${p1}-${p2}`;
}

// ----------------------------------------------------------------------
// RATE LIMITER: 5 failed code attempts per user per hour
// ----------------------------------------------------------------------
interface FailedAttemptRecord {
  count: number;
  lockedUntil?: number;
  timestamps: number[];
}
const failedJoinAttemptsByUser = new Map<string, FailedAttemptRecord>();

function checkJoinRateLimit(userKey: string): { allowed: boolean; waitMinutes?: number } {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const record = failedJoinAttemptsByUser.get(userKey);

  if (record && record.lockedUntil && record.lockedUntil > now) {
    const waitMinutes = Math.ceil((record.lockedUntil - now) / 60000);
    return { allowed: false, waitMinutes };
  }

  return { allowed: true };
}

function recordFailedAttempt(userKey: string): { locked: boolean; waitMinutes?: number } {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  let record = failedJoinAttemptsByUser.get(userKey);

  if (!record) {
    record = { count: 1, timestamps: [now] };
    failedJoinAttemptsByUser.set(userKey, record);
    return { locked: false };
  }

  // Filter timestamps to past hour
  record.timestamps = record.timestamps.filter((t) => t > oneHourAgo);
  record.timestamps.push(now);
  record.count = record.timestamps.length;

  if (record.count >= 5) {
    record.lockedUntil = now + 60 * 60 * 1000; // 1 hour lock
    return { locked: true, waitMinutes: 60 };
  }

  return { locked: false };
}

function clearFailedAttempts(userKey: string): void {
  failedJoinAttemptsByUser.delete(userKey);
}

// ----------------------------------------------------------------------
// SINGLE CREATION GATE: addMemberFromApprovedRequest
// CRITICAL: Members must NEVER be created any other way!
// This is the sole authorized function that inserts a groupMember.
// ----------------------------------------------------------------------
export function addMemberFromApprovedRequest(
  db: any,
  request: TrustJoinRequest,
  moderatorUser: User
): TrustGroupMember {
  // Ensure code uniqueness platform-wide
  let code = generateMemberCode();
  const allCodes = new Set((db.trustGroupMembers || []).map((m: any) => m.memberCode));
  while (allCodes.has(code)) {
    code = generateMemberCode();
  }

  const newMember: TrustGroupMember = {
    id: `gm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    groupId: request.groupId,
    userEmail: request.applicantEmail.toLowerCase(),
    userName: request.applicantName,
    phone: request.applicantPhone,
    role: 'member',
    status: 'active',
    memberCode: code,
    referredByMemberId: request.referrerMemberId,
    workplace: request.applicantWorkplace || request.employer || '',
    residence: request.applicantResidence || request.residentialAddress || '',
    joinedAt: Date.now(),
  };

  if (!db.trustGroupMembers) db.trustGroupMembers = [];
  db.trustGroupMembers.push(newMember);

  // In-app notifications
  if (!db.userNotifications) db.userNotifications = [];

  // 1. Notify applicant: Friendly Kenyan Karibu welcome
  const applicantUser = db.users.find((u: any) => u.email?.toLowerCase() === request.applicantEmail.toLowerCase());
  if (applicantUser) {
    db.userNotifications.unshift({
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId: applicantUser.id,
      title: 'Karibu! Your Group Membership is Approved 🎉',
      message: `You are now an active member! Your personal referral code is ${code}. Save, borrow, and contribute with trust.`,
      type: 'group',
      read: false,
      timestamp: Date.now(),
    });
  }

  // 2. Notify referrer that their friend was admitted
  const referrerMember = db.trustGroupMembers.find((m: any) => m.id === request.referrerMemberId);
  if (referrerMember) {
    const referrerUser = db.users.find((u: any) => u.email?.toLowerCase() === referrerMember.userEmail?.toLowerCase());
    if (referrerUser) {
      db.userNotifications.unshift({
        id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        userId: referrerUser.id,
        title: 'Referral Admitted to Group',
        message: `${request.applicantName}, who you vouched for, has been admitted to the Group!`,
        type: 'group',
        read: false,
        timestamp: Date.now(),
      });
    }
  }

  // 3. Audit log
  logAudit(
    db,
    moderatorUser.id,
    moderatorUser.name,
    'CHAMA_MEMBER_ADMITTED',
    `Admitted ${request.applicantName} (${request.applicantEmail}) to group #${request.groupId}. Vouched by member #${request.referrerMemberId}. Issued code ${code}.`
  );

  return newMember;
}

// ----------------------------------------------------------------------
// HTML SANITIZATION HELPER FOR PLAIN TEXT
// ----------------------------------------------------------------------
export function sanitizePlainText(str: string): string {
  if (!str) return '';
  return str
    .replace(/<[^>]*>?/gm, '') // strip all HTML tags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ======================================================================
// FEATURE A: CHAMA GROUPS API ENDPOINTS
// ======================================================================

// 1. POST /groups - Create a new Chama group (creator becomes first moderator + member with code)
chamaTrustRouter.post('/groups', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { name, description, contributionNote, maxMembers, workplace, residence } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'Group description is required' });

  const db = await getDatabase();
  if (!db.trustGroups) db.trustGroups = [];
  if (!db.trustGroupMembers) db.trustGroupMembers = [];

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const parsedMax = Math.max(3, Math.min(100, Number(maxMembers) || 15));

  const newGroup: TrustChamaGroup = {
    id: `grp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: sanitizePlainText(name),
    description: sanitizePlainText(description),
    contributionAmount: Number(req.body.contributionAmount) || 2000,
    cycleType: (req.body.cycleType as any) || 'monthly',
    rules: req.body.rules ? sanitizePlainText(req.body.rules) : undefined,
    contributionNote: contributionNote ? sanitizePlainText(contributionNote) : undefined,
    createdBy: userEmail,
    moderatorEmails: [userEmail],
    status: 'active',
    maxMembers: parsedMax,
    createdAt: Date.now(),
  };

  db.trustGroups.unshift(newGroup);

  // Group creator becomes first moderator and gets initial unique member code
  let creatorCode = generateMemberCode();
  const allCodes = new Set(db.trustGroupMembers.map((m) => m.memberCode));
  while (allCodes.has(creatorCode)) {
    creatorCode = generateMemberCode();
  }

  const creatorMember: TrustGroupMember = {
    id: `gm_${Date.now()}_creator`,
    groupId: newGroup.id,
    userEmail,
    userName: user.name,
    phone: user.phone,
    role: 'moderator',
    status: 'active',
    memberCode: creatorCode,
    referredByMemberId: null,
    workplace: workplace ? sanitizePlainText(workplace) : 'Self-employed / Business',
    residence: residence ? sanitizePlainText(residence) : 'Nairobi',
    joinedAt: Date.now(),
  };

  db.trustGroupMembers.push(creatorMember);

  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_GROUP_CREATED',
    `Created trust Chama group "${newGroup.name}" (${newGroup.id}). Creator assigned moderator role with code ${creatorCode}.`
  );
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    group: newGroup,
    member: {
      id: creatorMember.id,
      groupId: creatorMember.groupId,
      role: creatorMember.role,
      memberCode: creatorMember.memberCode,
      joinedAt: creatorMember.joinedAt,
    },
    message: `Group "${newGroup.name}" created! You are the moderator. Your referral code is ${creatorCode}.`,
  });
});

// 2. GET /groups/mine - List groups where signed-in user is a member or moderator
chamaTrustRouter.get('/groups/mine', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();

  const myMemberships = (db.trustGroupMembers || []).filter(
    (m) => m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const groupIds = new Set(myMemberships.map((m) => m.groupId));
  const groups = (db.trustGroups || []).filter((g) => groupIds.has(g.id));

  // Compute membership summaries
  const result = groups.map((g) => {
    const myMem = myMemberships.find((m) => m.groupId === g.id);
    const activeMembersCount = (db.trustGroupMembers || []).filter(
      (m) => m.groupId === g.id && m.status === 'active'
    ).length;
    const isMod = myMem?.role === 'moderator' || g.moderatorEmails.includes(userEmail);

    return {
      id: g.id,
      name: g.name,
      description: g.description,
      contributionNote: g.contributionNote,
      status: g.status,
      maxMembers: g.maxMembers,
      activeMembersCount,
      createdAt: g.createdAt,
      myRole: myMem?.role || 'member',
      myStatus: myMem?.status || 'active',
      myMemberCode: myMem?.memberCode,
      isModerator: isMod,
    };
  });

  res.json({ groups: result });
});

// 3. GET /groups/:id - Single group details (members and moderators only)
chamaTrustRouter.get('/groups/:id', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = req.params.id;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  if (!myMem && user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. You are not a member of this Group.' });
  }

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  const activeMembersCount = (db.trustGroupMembers || []).filter(
    (m) => m.groupId === groupId && m.status === 'active'
  ).length;

  res.json({
    group: {
      ...group,
      activeMembersCount,
      isModerator: isMod,
      myMemberCode: myMem?.memberCode,
      myRole: myMem?.role || (user.role === 'admin' ? 'admin' : 'member'),
    },
  });
});

// 4. GET /groups/:id/my-code - Returns the member's own referral code
chamaTrustRouter.get('/groups/:id/my-code', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = req.params.id;
  const db = await getDatabase();
  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();

  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  if (!myMem) {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }

  if (myMem.status === 'suspended') {
    return res.status(403).json({ error: 'Your membership is suspended. Your referral code is deactivated.' });
  }

  res.json({
    memberCode: myMem.memberCode,
    groupId: myMem.groupId,
    status: myMem.status,
  });
});

// 5. POST /groups/join-requests - Submit join request with member referral code
chamaTrustRouter.post('/groups/join-requests', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const userKey = (user.email || `${user.phone}@buyoll.com`).toLowerCase();

  // Rate-limiting check: 5 failed attempts per hour
  const rateCheck = checkJoinRateLimit(userKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: `Too many invalid code attempts. Temporary lock active. Please wait ${rateCheck.waitMinutes || 60} minutes before trying again.`,
    });
  }

  const {
    referralCode,
    workplace,
    residence,
    phone,
    relationship,
    yearsKnown,
    consentGiven,
  } = req.body;

  const genericErrorCode = 'That code is not valid for joining.';

  if (!referralCode || typeof referralCode !== 'string') {
    recordFailedAttempt(userKey);
    return res.status(400).json({ error: genericErrorCode });
  }

  const cleanCode = referralCode.trim().toUpperCase();

  if (!workplace || !residence || !phone || !relationship) {
    return res.status(400).json({
      error: 'Workplace, residence area, phone number, and relationship with referrer are all mandatory.',
    });
  }

  if (!consentGiven) {
    return res.status(400).json({
      error: 'You must agree that the group may verify your details with the member who referred you.',
    });
  }

  const validRelationships: JoinRelationship[] = [
    'family',
    'close_friend',
    'colleague',
    'neighbour',
    'church_or_community',
  ];
  if (!validRelationships.includes(relationship)) {
    return res.status(400).json({ error: 'Please select a valid relationship with your referrer.' });
  }

  const db = await getDatabase();
  if (!db.trustGroupMembers) db.trustGroupMembers = [];
  if (!db.trustJoinRequests) db.trustJoinRequests = [];
  if (!db.trustGroups) db.trustGroups = [];

  // Look up referrer by member code
  const referrer = db.trustGroupMembers.find((m) => m.memberCode === cleanCode);

  // SECURITY: Invalid, unknown, suspended-member, or self-referral codes all return generic error
  if (!referrer || referrer.status !== 'active' || referrer.userEmail.toLowerCase() === userKey) {
    const failResult = recordFailedAttempt(userKey);
    if (failResult.locked) {
      return res.status(429).json({
        error: `Too many invalid code attempts. Temporary lock active for ${failResult.waitMinutes} minutes.`,
      });
    }
    return res.status(400).json({ error: genericErrorCode });
  }

  // Clear failed attempts on valid code
  clearFailedAttempts(userKey);

  const targetGroup = db.trustGroups.find((g) => g.id === referrer.groupId);
  if (!targetGroup || targetGroup.status !== 'active') {
    return res.status(400).json({ error: genericErrorCode });
  }

  // Prevent duplicate: already a member
  const alreadyMember = db.trustGroupMembers.find(
    (m) => m.groupId === targetGroup.id && m.userEmail.toLowerCase() === userKey && m.status !== 'removed'
  );
  if (alreadyMember) {
    return res.status(409).json({ error: 'You are already an active member of this Group.' });
  }

  // Prevent duplicate open join requests for this group
  const existingOpenRequest = db.trustJoinRequests.find(
    (r) =>
      r.groupId === targetGroup.id &&
      r.applicantEmail.toLowerCase() === userKey &&
      (r.status === 'awaiting_referrer' || r.status === 'awaiting_moderator_call')
  );
  if (existingOpenRequest) {
    return res.status(409).json({
      error: 'You already have a pending join request for this Group. Please wait for verification.',
    });
  }

  // Cap pending referrals per member (default 3 open at once)
  const openReferralsCount = db.trustJoinRequests.filter(
    (r) =>
      r.referrerMemberId === referrer.id &&
      (r.status === 'awaiting_referrer' || r.status === 'awaiting_moderator_call')
  ).length;

  if (openReferralsCount >= 3) {
    return res.status(400).json({
      error: 'This referring member currently has the maximum number of active pending invitations (3). Please try again later.',
    });
  }

  // Create request in 'awaiting_referrer' status (NEVER auto-approved)
  const newRequest: TrustJoinRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    groupId: targetGroup.id,
    applicantEmail: userKey,
    applicantName: user.name,
    applicantPhone: sanitizePlainText(phone),
    applicantWorkplace: sanitizePlainText(workplace),
    applicantResidence: sanitizePlainText(residence),
    referralCode: cleanCode,
    referrerMemberId: referrer.id,
    relationship,
    yearsKnown: Math.max(0, Math.min(60, Number(yearsKnown) || 1)),
    referrerConfirmed: 'pending',
    status: 'awaiting_referrer',
    createdAt: Date.now(),
  };

  db.trustJoinRequests.unshift(newRequest);

  // Notify the referring member in-app
  if (!db.userNotifications) db.userNotifications = [];
  const referrerUser = db.users.find((u) => u.email?.toLowerCase() === referrer.userEmail?.toLowerCase());
  if (referrerUser) {
    db.userNotifications.unshift({
      id: `notif_${Date.now()}_ref`,
      userId: referrerUser.id,
      title: 'Someone Used Your Group Referral Code',
      message: `${user.name} applied to join "${targetGroup.name}" using your code. Please confirm if you know them.`,
      type: 'group',
      link: '/chamas',
      read: false,
      timestamp: Date.now(),
    });
  }

  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_JOIN_REQUESTED',
    `Applicant ${user.name} submitted join request for Chama "${targetGroup.name}" using code of ${referrer.userName}. Status: awaiting_referrer.`
  );
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    request: {
      id: newRequest.id,
      groupId: newRequest.groupId,
      groupName: targetGroup.name,
      status: newRequest.status,
      createdAt: newRequest.createdAt,
    },
    message: `Application submitted! We have notified ${referrer.userName} to confirm they know you well before moderator vetting begins.`,
  });
});

// 6. GET /groups/join-requests/mine - Applicant's own requests
chamaTrustRouter.get('/groups/join-requests/mine', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const userKey = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const db = await getDatabase();

  const myRequests = (db.trustJoinRequests || [])
    .filter((r) => r.applicantEmail.toLowerCase() === userKey)
    .map((r) => {
      const group = (db.trustGroups || []).find((g) => g.id === r.groupId);
      const referrer = (db.trustGroupMembers || []).find((m) => m.id === r.referrerMemberId);
      return {
        id: r.id,
        groupId: r.groupId,
        groupName: group?.name || 'Group Circle',
        referrerName: referrer?.userName || 'Member',
        status: r.status,
        referrerConfirmed: r.referrerConfirmed,
        relationship: r.relationship,
        yearsKnown: r.yearsKnown,
        rejectionReason: r.rejectionReason,
        createdAt: r.createdAt,
      };
    });

  res.json({ requests: myRequests });
});

// 7. POST /groups/join-requests/:rid/withdraw - Applicant withdraws pending request
chamaTrustRouter.post('/groups/join-requests/:rid/withdraw', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const userKey = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const db = await getDatabase();
  const request = (db.trustJoinRequests || []).find((r) => r.id === req.params.rid);

  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.applicantEmail.toLowerCase() !== userKey) {
    return res.status(403).json({ error: 'You can only withdraw your own requests.' });
  }

  if (request.status !== 'awaiting_referrer' && request.status !== 'awaiting_moderator_call') {
    return res.status(400).json({ error: `Cannot withdraw request with status: ${request.status}` });
  }

  request.status = 'withdrawn';
  request.decidedAt = Date.now();
  request.decidedBy = userKey;

  logAudit(db, user.id, user.name, 'CHAMA_REQUEST_WITHDRAWN', `Withdrew join request #${request.id}`);
  await saveDatabase(db);

  res.json({ success: true, message: 'Your application has been withdrawn.' });
});

// 8. GET /groups/referrals/pending - Requests awaiting the signed-in member's confirmation
chamaTrustRouter.get('/groups/referrals/pending', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const userKey = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const db = await getDatabase();

  const myMemberIds = (db.trustGroupMembers || [])
    .filter((m) => m.userEmail.toLowerCase() === userKey)
    .map((m) => m.id);

  const pending = (db.trustJoinRequests || [])
    .filter((r) => myMemberIds.includes(r.referrerMemberId) && r.status === 'awaiting_referrer')
    .map((r) => {
      const grp = (db.trustGroups || []).find((g) => g.id === r.groupId);
      return {
        id: r.id,
        groupId: r.groupId,
        groupName: grp?.name || 'Group Circle',
        applicantName: r.applicantName,
        relationship: r.relationship,
        yearsKnown: r.yearsKnown,
        createdAt: r.createdAt,
      };
    });

  const totalVouchedCount = (db.trustGroupMembers || []).filter(
    (m) => m.referredByMemberId && myMemberIds.includes(m.referredByMemberId)
  ).length;

  res.json({
    pendingRequests: pending,
    totalVouchedMembersCount: totalVouchedCount,
  });
});

// 9. POST /groups/join-requests/:rid/referrer-response - Referrer responds: yes | no
chamaTrustRouter.post('/groups/join-requests/:rid/referrer-response', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { response } = req.body;
  if (response !== 'yes' && response !== 'no') {
    return res.status(400).json({ error: 'Response must be "yes" or "no".' });
  }

  const userKey = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const db = await getDatabase();
  const request = (db.trustJoinRequests || []).find((r) => r.id === req.params.rid);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // Verify that signed-in user is the referrer
  const referrer = (db.trustGroupMembers || []).find((m) => m.id === request.referrerMemberId);
  if (!referrer || referrer.userEmail.toLowerCase() !== userKey) {
    return res.status(403).json({ error: 'Only the member who was given as referrer can confirm.' });
  }

  if (request.status !== 'awaiting_referrer') {
    return res.status(400).json({ error: `Request is not awaiting referrer confirmation (current: ${request.status})` });
  }

  if (response === 'no') {
    // Referrer denied knowing applicant: auto-reject
    request.referrerConfirmed = 'no';
    request.status = 'rejected';
    request.rejectionReason = 'The referring member indicated they do not know the applicant well enough to vouch.';
    request.decidedAt = Date.now();
    request.decidedBy = userKey;

    logAudit(
      db,
      user.id,
      user.name,
      'REFERRER_CONFIRMATION_DENIED',
      `Referrer ${user.name} denied vouching for ${request.applicantName} in request #${request.id}. Auto-rejected.`
    );
    await saveDatabase(db);

    return res.json({
      success: true,
      message: 'You indicated you do not vouch for this applicant. The request has been declined.',
    });
  }

  // response === 'yes': move to awaiting_moderator_call
  request.referrerConfirmed = 'yes';
  request.status = 'awaiting_moderator_call';

  // Notify moderators of the group
  const group = (db.trustGroups || []).find((g) => g.id === request.groupId);
  if (group && db.userNotifications) {
    const modEmails = new Set(group.moderatorEmails.map((e) => e.toLowerCase()));
    (db.users || []).forEach((u) => {
      if (u.email && modEmails.has(u.email.toLowerCase())) {
        db.userNotifications.unshift({
          id: `notif_${Date.now()}_mod`,
          userId: u.id,
          title: `New Group Vetting Queue: ${request.applicantName}`,
          message: `${request.applicantName} was confirmed by ${user.name}. Please phone the referrer to complete vetting.`,
          type: 'group',
          link: `/chamas`,
          read: false,
          timestamp: Date.now(),
        });
      }
    });
  }

  logAudit(
    db,
    user.id,
    user.name,
    'REFERRER_CONFIRMED',
    `Referrer ${user.name} confirmed vouching for ${request.applicantName}. Moved to awaiting_moderator_call.`
  );
  await saveDatabase(db);

  res.json({
    success: true,
    message: 'Thank you! You confirmed you know this applicant. The request is now in the moderator phone-vetting queue.',
  });
});

// 10. GET /groups/:id/join-requests - Moderator vetting queue for a group
chamaTrustRouter.get('/groups/:id/join-requests', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = req.params.id;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Access denied. Only group moderators can view the vetting queue.' });
  }

  const requests = (db.trustJoinRequests || [])
    .filter((r) => r.groupId === groupId)
    .map((r) => {
      const referrer = (db.trustGroupMembers || []).find((m) => m.id === r.referrerMemberId);
      return {
        id: r.id,
        groupId: r.groupId,
        applicantEmail: r.applicantEmail,
        applicantName: r.applicantName,
        applicantPhone: r.applicantPhone,
        applicantWorkplace: r.applicantWorkplace,
        applicantResidence: r.applicantResidence,
        referralCode: r.referralCode,
        referrerMemberId: r.referrerMemberId,
        referrerName: referrer?.userName || 'Member',
        referrerPhone: referrer?.phone || '',
        relationship: r.relationship,
        yearsKnown: r.yearsKnown,
        referrerConfirmed: r.referrerConfirmed,
        status: r.status,
        vetting: r.vetting,
        rejectionReason: r.rejectionReason,
        createdAt: r.createdAt,
      };
    });

  res.json({ requests });
});

// 11. POST /groups/:id/join-requests/:rid/log-call - Moderator logs phone call with referrer
chamaTrustRouter.post('/groups/:id/join-requests/:rid/log-call', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { id: groupId, rid: requestId } = req.params;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators can log vetting calls.' });
  }

  const request = (db.trustJoinRequests || []).find((r) => r.id === requestId && r.groupId === groupId);
  if (!request) return res.status(404).json({ error: 'Join request not found' });

  // Moderator cannot approve their own application if they were the applicant
  if (request.applicantEmail.toLowerCase() === userEmail) {
    return res.status(403).json({ error: 'You cannot log calls or decide your own join request.' });
  }

  const { referrerKnowsWorkplaceOrResidence, referrerAcceptsResponsibility, notes } = req.body;

  if (typeof referrerKnowsWorkplaceOrResidence !== 'boolean' || typeof referrerAcceptsResponsibility !== 'boolean') {
    return res.status(400).json({ error: 'Checklist answers must be explicit booleans.' });
  }

  request.vetting = {
    calledAt: Date.now(),
    calledByEmail: userEmail,
    referrerKnowsWorkplaceOrResidence: Boolean(referrerKnowsWorkplaceOrResidence),
    referrerAcceptsResponsibility: Boolean(referrerAcceptsResponsibility),
    notes: sanitizePlainText(String(notes || '')),
  };

  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_VETTING_CALL_LOGGED',
    `Moderator ${user.name} logged phone verification call for request #${request.id}. Knows location: ${referrerKnowsWorkplaceOrResidence}, Accepts responsibility: ${referrerAcceptsResponsibility}.`
  );
  await saveDatabase(db);

  res.json({
    success: true,
    vetting: request.vetting,
    message: 'Phone call log saved successfully.',
  });
});

// 12. POST /groups/:id/join-requests/:rid/approve - Moderator approves vetted applicant
chamaTrustRouter.post('/groups/:id/join-requests/:rid/approve', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { id: groupId, rid: requestId } = req.params;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators can approve requests.' });
  }

  const request = (db.trustJoinRequests || []).find((r) => r.id === requestId && r.groupId === groupId);
  if (!request) return res.status(404).json({ error: 'Join request not found' });

  // Moderator cannot approve their own application
  if (request.applicantEmail.toLowerCase() === userEmail) {
    return res.status(403).json({ error: 'A moderator cannot approve their own request.' });
  }

  // -------------------------------------------------------------
  // SERVER-SIDE GATE (Non-negotiable security requirements):
  // 1. Status must be 'awaiting_moderator_call'
  // 2. referrerConfirmed must be 'yes'
  // 3. A call log exists
  // 4. referrerKnowsWorkplaceOrResidence === true
  // 5. referrerAcceptsResponsibility === true
  // -------------------------------------------------------------
  if (request.status !== 'awaiting_moderator_call') {
    return res.status(403).json({
      error: `Approval rejected: Request must be in awaiting_moderator_call status (currently: ${request.status}).`,
    });
  }

  if (request.referrerConfirmed !== 'yes') {
    return res.status(403).json({
      error: 'Approval rejected: The referring member has not confirmed they know this applicant.',
    });
  }

  if (!request.vetting) {
    return res.status(403).json({
      error: 'Approval rejected: Moderator phone verification call has not been logged.',
    });
  }

  if (!request.vetting.referrerKnowsWorkplaceOrResidence || !request.vetting.referrerAcceptsResponsibility) {
    return res.status(403).json({
      error: 'Approval rejected: Vetting checklist requirement not satisfied. The referrer must confirm both location knowledge and accountability.',
    });
  }

  // Check group capacity
  const currentActiveMembers = (db.trustGroupMembers || []).filter(
    (m) => m.groupId === groupId && m.status === 'active'
  ).length;
  if (currentActiveMembers >= group.maxMembers) {
    return res.status(400).json({ error: 'Group has reached its maximum member limit.' });
  }

  // Call the single creation gate: addMemberFromApprovedRequest
  const newMember = addMemberFromApprovedRequest(db, request, user);

  request.status = 'approved';
  request.decidedAt = Date.now();
  request.decidedBy = userEmail;

  await saveDatabase(db);

  res.json({
    success: true,
    member: newMember,
    message: `Karibu! ${request.applicantName} approved and admitted to ${group.name}. Personal code ${newMember.memberCode} issued.`,
  });
});

// 13. POST /groups/:id/join-requests/:rid/reject - Moderator rejects applicant
chamaTrustRouter.post('/groups/:id/join-requests/:rid/reject', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { id: groupId, rid: requestId } = req.params;
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A specific reason is required for rejecting a join request.' });
  }

  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators can reject requests.' });
  }

  const request = (db.trustJoinRequests || []).find((r) => r.id === requestId && r.groupId === groupId);
  if (!request) return res.status(404).json({ error: 'Join request not found' });

  request.status = 'rejected';
  request.rejectionReason = sanitizePlainText(reason);
  request.decidedAt = Date.now();
  request.decidedBy = userEmail;

  // Politely notify applicant
  if (!db.userNotifications) db.userNotifications = [];
  const applicantUser = db.users.find((u) => u.email?.toLowerCase() === request.applicantEmail.toLowerCase());
  if (applicantUser) {
    db.userNotifications.unshift({
      id: `notif_${Date.now()}_rej`,
      userId: applicantUser.id,
      title: 'Update on Your Group Application',
      message: `Your request to join "${group.name}" was not approved at this time: ${request.rejectionReason}`,
      type: 'group',
      read: false,
      timestamp: Date.now(),
    });
  }

  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_REQUEST_REJECTED',
    `Moderator ${user.name} rejected join request #${request.id} for ${request.applicantName}. Reason: ${request.rejectionReason}`
  );
  await saveDatabase(db);

  res.json({ success: true, message: 'Join request has been rejected and the applicant notified politely.' });
});

// 14. GET /groups/:id/members - Members list with privacy protection
chamaTrustRouter.get('/groups/:id/members', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = req.params.id;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  if (!myMem && user.role !== 'admin') {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';

  // Check default flags on members who vouched for someone who defaulted
  const defaultedReferralIds = new Set(
    (db.trustGroupMembers || [])
      .filter((m) => m.groupId === groupId && m.status === 'defaulted' && m.referredByMemberId)
      .map((m) => m.referredByMemberId!)
  );

  const groupMembers = (db.trustGroupMembers || []).filter((m) => m.groupId === groupId && m.status !== 'removed');

  if (isMod) {
    // Moderators see full details, member codes, workplace, residence, phone, and vouch flags
    const fullList = groupMembers.map((m) => {
      const referrer = groupMembers.find((r) => r.id === m.referredByMemberId);
      return {
        id: m.id,
        groupId: m.groupId,
        userEmail: m.userEmail,
        userName: m.userName,
        phone: m.phone,
        role: m.role,
        status: m.status,
        memberCode: m.memberCode,
        referredByMemberId: m.referredByMemberId,
        referredByName: referrer?.userName || 'Founder / Direct',
        workplace: m.workplace,
        residence: m.residence,
        hasVouchFlag: defaultedReferralIds.has(m.id),
        joinedAt: m.joinedAt,
      };
    });
    return res.json({ members: fullList, isModerator: true });
  }

  // Ordinary members: names, roles, and join dates only! Never return workplace, residence, phone or other member codes.
  const publicList = groupMembers.map((m) => {
    return {
      id: m.id,
      groupId: m.groupId,
      userName: m.userName,
      role: m.role,
      status: m.status === 'active' ? 'active' : 'inactive',
      joinedAt: m.joinedAt,
    };
  });

  res.json({ members: publicList, isModerator: false });
});

// 15. PATCH /groups/:id/members/:memberId/status - Moderator updates member status
chamaTrustRouter.patch('/groups/:id/members/:memberId/status', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { id: groupId, memberId } = req.params;
  const { status, role } = req.body;

  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators can change member status or roles.' });
  }

  const member = (db.trustGroupMembers || []).find((m) => m.id === memberId && m.groupId === groupId);
  if (!member) return res.status(404).json({ error: 'Member not found in this group' });

  if (status) {
    const validStatuses = ['active', 'suspended', 'defaulted', 'removed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    member.status = status;
  }

  if (role) {
    const validRoles = ['moderator', 'member'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    member.role = role;
    if (role === 'moderator' && !group.moderatorEmails.includes(member.userEmail.toLowerCase())) {
      group.moderatorEmails.push(member.userEmail.toLowerCase());
    } else if (role === 'member') {
      group.moderatorEmails = group.moderatorEmails.filter((e) => e.toLowerCase() !== member.userEmail.toLowerCase());
    }
  }

  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_MEMBER_STATUS_CHANGED',
    `Moderator ${user.name} changed member #${member.id} (${member.userName}) status to ${member.status}, role to ${member.role}.`
  );
  await saveDatabase(db);

  res.json({ success: true, member, message: `Updated ${member.userName}'s record successfully.` });
});

// 16. GET /groups/:id/members/:memberId/trace - Trace card for defaulted/repayment follow-up (Moderators only, Audited)
chamaTrustRouter.get('/groups/:id/members/:memberId/trace', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { id: groupId, memberId } = req.params;
  const db = await getDatabase();
  const group = (db.trustGroups || []).find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const userEmail = (user.email || `${user.phone}@buyoll.com`).toLowerCase();
  const myMem = (db.trustGroupMembers || []).find(
    (m) => m.groupId === groupId && m.userEmail.toLowerCase() === userEmail && m.status !== 'removed'
  );

  const isMod = myMem?.role === 'moderator' || group.moderatorEmails.includes(userEmail) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators can access the private Trace Card.' });
  }

  const member = (db.trustGroupMembers || []).find((m) => m.id === memberId && m.groupId === groupId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const referrer = (db.trustGroupMembers || []).find((m) => m.id === member.referredByMemberId);

  // Trace view audit log
  logAudit(
    db,
    user.id,
    user.name,
    'CHAMA_TRACE_CARD_ACCESSED',
    `Moderator ${user.name} opened private Trace Card for member ${member.userName} (${member.id}). Vouched by ${referrer?.userName || 'Direct'}.`
  );
  await saveDatabase(db);

  res.json({
    traceCard: {
      memberId: member.id,
      memberName: member.userName,
      memberEmail: member.userEmail,
      memberPhone: member.phone,
      workplace: member.workplace,
      residence: member.residence,
      status: member.status,
      joinedAt: member.joinedAt,
      referrer: referrer
        ? {
            id: referrer.id,
            name: referrer.userName,
            phone: referrer.phone,
            email: referrer.userEmail,
            workplace: referrer.workplace,
            residence: referrer.residence,
          }
        : null,
    },
  });
});

// ======================================================================
// FEATURE B: ADMIN-EDITABLE PLATFORM ANNOUNCEMENTS (3 HERO SLOTS)
// ======================================================================

// Helper: Seeded defaults if a slot is unconfigured or unpublished
function getDefaultSlot(slot: 1 | 2 | 3): PlatformAnnouncementSlot {
  if (slot === 1) {
    return {
      slot: 1,
      title: 'Welcome to Buyoll Community Groups',
      message: 'Safe, vetted community savings circles. Join trusted circles with verified member referrals and moderator vetting.',
      badge: 'Notice',
      accent: 'emerald',
      ctaLabel: 'Explore Groups',
      ctaUrl: '/groups',
      status: 'published',
      updatedBy: 'cityandcountyre@gmail.com',
      updatedAt: Date.now() - 86400000,
      version: 1,
    };
  }
  if (slot === 2) {
    return {
      slot: 2,
      title: 'Know Someone to Join: Trust & Vetting',
      message: 'Every new Group member must be vouched for by an active member and verified via moderator phone check before admission.',
      badge: 'Update',
      accent: 'violet',
      ctaLabel: 'How It Works',
      ctaUrl: '/groups',
      status: 'published',
      updatedBy: 'cityandcountyre@gmail.com',
      updatedAt: Date.now() - 43200000,
      version: 1,
    };
  }
  return {
    slot: 3,
    title: 'Direct Merchant Escrow & Safe Payouts',
    message: 'Zero defaults, guaranteed rotating payouts, and Lipa Mdogomdogo fulfillment backed by official M-Pesa statements.',
    badge: 'Promo',
    accent: 'amber',
    ctaLabel: 'Browse Deals',
    ctaUrl: '/announcements',
    status: 'published',
    updatedBy: 'cityandcountyre@gmail.com',
    updatedAt: Date.now() - 21600000,
    version: 1,
  };
}

// 1. GET /announcement-cards (and alias /platform-announcements): Public admin-managed announcements inside schedule window
chamaTrustRouter.get('/announcement-cards', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const now = Date.now();

  const results: PlatformAnnouncementSlot[] = (db.announcementCards || []).filter((c) => {
    const isPublished = c.status === 'published';
    const startsValid = !c.startsAt || c.startsAt <= now;
    const endsValid = !c.endsAt || c.endsAt >= now;
    return isPublished && startsValid && endsValid;
  });

  // Sort by slot number
  results.sort((a, b) => a.slot - b.slot);

  const etag = `W/"ann_${results.map((r) => `${r.slot}_${r.version}_${r.updatedAt}`).join('-')}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.json({ announcements: results, cards: results });
});

// 2. GET /admin/announcement-cards: Admin view for all three slots (including drafts & schedule info)
chamaTrustRouter.get('/admin/announcement-cards', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const db = await getDatabase();
  const slots: (1 | 2 | 3)[] = [1, 2, 3];

  const cards = slots.map((s) => {
    const found = (db.announcementCards || []).find((c) => c.slot === s);
    return found || getDefaultSlot(s);
  });

  res.json({ cards });
});

// 3. PUT /admin/announcement-cards/:slot - Edit ONE slot independently with validation & optimistic locking
chamaTrustRouter.put('/admin/announcement-cards/:slot', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const slotNum = Number(req.params.slot);
  if (slotNum !== 1 && slotNum !== 2 && slotNum !== 3) {
    return res.status(400).json({ error: 'Invalid slot number. Must be 1, 2, or 3.' });
  }

  const { title, message, badge, accent, ctaLabel, ctaUrl, status, startsAt, endsAt, version } = req.body;

  // Strict validation
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'Title is required.' });
  if (title.length > 80) return res.status(400).json({ error: 'Title must be 80 characters or fewer.' });

  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message is required.' });
  if (message.length > 280) return res.status(400).json({ error: 'Message must be 280 characters or fewer.' });

  if (badge && String(badge).length > 20) {
    return res.status(400).json({ error: 'Badge must be 20 characters or fewer.' });
  }

  if (ctaLabel && String(ctaLabel).length > 24) {
    return res.status(400).json({ error: 'Button CTA label must be 24 characters or fewer.' });
  }

  if (ctaUrl && typeof ctaUrl === 'string') {
    const trimmedUrl = ctaUrl.trim();
    if (!trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('https://')) {
      return res.status(400).json({ error: 'Button link must be a relative path (e.g. /chamas) or https URL.' });
    }
  }

  const validAccents = ['pink', 'violet', 'emerald', 'amber', 'sky'];
  const cleanAccent = validAccents.includes(accent) ? accent : 'emerald';

  const cleanStartsAt = startsAt ? Number(startsAt) : undefined;
  const cleanEndsAt = endsAt ? Number(endsAt) : undefined;
  if (cleanStartsAt && cleanEndsAt && cleanStartsAt >= cleanEndsAt) {
    return res.status(400).json({ error: 'Schedule start date must be before end date.' });
  }

  const db = await getDatabase();
  if (!db.announcementCards) db.announcementCards = [];
  if (!db.announcementRevisions) db.announcementRevisions = [];

  let current = db.announcementCards.find((c) => c.slot === slotNum);
  if (!current) {
    current = getDefaultSlot(slotNum as any);
    db.announcementCards.push(current);
  }

  // Optimistic version check: 409 if version mismatch
  if (version !== undefined && Number(version) !== current.version) {
    return res.status(409).json({
      error: `Conflict: This announcement was modified by another administrator (version ${current.version}). Please reload and merge changes.`,
      current,
    });
  }

  // Save revision snapshot (keep last 20 per slot)
  const revision: PlatformAnnouncementRevision = {
    id: `rev_${Date.now()}_slot${slotNum}`,
    slot: slotNum as 1 | 2 | 3,
    snapshot: JSON.parse(JSON.stringify(current)),
    changedBy: user.email || user.name,
    changedAt: Date.now(),
  };
  db.announcementRevisions.unshift(revision);
  const slotRevisions = db.announcementRevisions.filter((r) => r.slot === slotNum);
  if (slotRevisions.length > 20) {
    const toRemove = slotRevisions.slice(20);
    const toRemoveIds = new Set(toRemove.map((r) => r.id));
    db.announcementRevisions = db.announcementRevisions.filter((r) => !toRemoveIds.has(r.id));
  }

  // Strip all HTML tags
  current.title = sanitizePlainText(title);
  current.message = sanitizePlainText(message);
  current.badge = badge ? sanitizePlainText(badge) : 'Notice';
  current.accent = cleanAccent as any;
  current.ctaLabel = ctaLabel ? sanitizePlainText(ctaLabel) : undefined;
  current.ctaUrl = ctaUrl ? ctaUrl.trim() : undefined;
  if (status === 'draft' || status === 'published') current.status = status;
  current.startsAt = cleanStartsAt;
  current.endsAt = cleanEndsAt;
  current.updatedBy = user.email || user.name;
  current.updatedAt = Date.now();
  current.version = (current.version || 1) + 1;

  logAudit(
    db,
    user.id,
    user.name,
    'ANNOUNCEMENT_HERO_EDITED',
    `Admin edited Hero Card Slot #${slotNum} "${current.title}" (v${current.version}, status: ${current.status}).`
  );
  await saveDatabase(db);

  res.json({
    success: true,
    card: current,
    message: `Slot #${slotNum} saved successfully (v${current.version}).`,
  });
});

// 4. POST /admin/announcement-cards/:slot/publish
chamaTrustRouter.post('/admin/announcement-cards/:slot/publish', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const slotNum = Number(req.params.slot);
  if (slotNum !== 1 && slotNum !== 2 && slotNum !== 3) {
    return res.status(400).json({ error: 'Invalid slot number.' });
  }

  const db = await getDatabase();
  let current = (db.announcementCards || []).find((c) => c.slot === slotNum);
  if (!current) {
    current = getDefaultSlot(slotNum as any);
    db.announcementCards.push(current);
  }

  current.status = 'published';
  current.updatedBy = user.email || user.name;
  current.updatedAt = Date.now();
  current.version = (current.version || 1) + 1;

  logAudit(
    db,
    user.id,
    user.name,
    'ANNOUNCEMENT_HERO_PUBLISHED',
    `Admin published Hero Card Slot #${slotNum} "${current.title}"`
  );
  await saveDatabase(db);

  res.json({ success: true, card: current, message: `Slot #${slotNum} is now live on the public hero!` });
});

// 5. POST /admin/announcement-cards/:slot/unpublish
chamaTrustRouter.post('/admin/announcement-cards/:slot/unpublish', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const slotNum = Number(req.params.slot);
  if (slotNum !== 1 && slotNum !== 2 && slotNum !== 3) {
    return res.status(400).json({ error: 'Invalid slot number.' });
  }

  const db = await getDatabase();
  let current = (db.announcementCards || []).find((c) => c.slot === slotNum);
  if (!current) {
    current = getDefaultSlot(slotNum as any);
    db.announcementCards.push(current);
  }

  current.status = 'draft';
  current.updatedBy = user.email || user.name;
  current.updatedAt = Date.now();
  current.version = (current.version || 1) + 1;

  logAudit(
    db,
    user.id,
    user.name,
    'ANNOUNCEMENT_HERO_UNPUBLISHED',
    `Admin unpublished Hero Card Slot #${slotNum} (switched to draft)`
  );
  await saveDatabase(db);

  res.json({ success: true, card: current, message: `Slot #${slotNum} is now unpublished (Draft). Fallback default is shown.` });
});

// 6. GET /admin/announcement-cards/:slot/history - Return revision history for slot
chamaTrustRouter.get('/admin/announcement-cards/:slot/history', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const slotNum = Number(req.params.slot);
  const db = await getDatabase();
  const history = (db.announcementRevisions || [])
    .filter((r) => r.slot === slotNum)
    .sort((a, b) => (b.changedAt || 0) - (a.changedAt || 0))
    .slice(0, 20);

  res.json({ history, revisions: history });
});

// 7. POST /admin/announcement-cards/:slot/revert - Revert to an earlier revision
chamaTrustRouter.post('/admin/announcement-cards/:slot/revert', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrative role required.' });
  }

  const slotNum = Number(req.params.slot);
  const { revisionId } = req.body;
  if (!revisionId) return res.status(400).json({ error: 'revisionId is required' });

  const db = await getDatabase();
  const targetRev = (db.announcementRevisions || []).find(
    (r) => r.id === revisionId && r.slot === slotNum
  );

  if (!targetRev || !targetRev.snapshot) {
    return res.status(404).json({ error: 'Revision not found or has no snapshot' });
  }

  let current = (db.announcementCards || []).find((c) => c.slot === slotNum);
  if (!current) {
    current = getDefaultSlot(slotNum as any);
    db.announcementCards.push(current);
  }

  // Save current as revision before reverting
  db.announcementRevisions.unshift({
    id: `rev_${Date.now()}_before_revert`,
    slot: slotNum as any,
    snapshot: JSON.parse(JSON.stringify(current)),
    changedBy: user.email || user.name,
    changedAt: Date.now(),
  });

  const snap = targetRev.snapshot;
  current.title = snap.title;
  current.message = snap.message;
  current.badge = snap.badge;
  current.accent = snap.accent;
  current.ctaLabel = snap.ctaLabel;
  current.ctaUrl = snap.ctaUrl;
  current.status = snap.status || 'published';
  current.startsAt = snap.startsAt;
  current.endsAt = snap.endsAt;
  current.updatedBy = user.email || user.name;
  current.updatedAt = Date.now();
  current.version = (current.version || 1) + 1;

  const revDate = new Date(targetRev.changedAt || Date.now()).toLocaleString();

  logAudit(
    db,
    user.id,
    user.name,
    'ANNOUNCEMENT_HERO_REVERTED',
    `Reverted Hero Card Slot #${slotNum} to revision from ${revDate}.`
  );
  await saveDatabase(db);

  res.json({
    success: true,
    card: current,
    message: `Slot #${slotNum} reverted to revision from ${revDate}!`,
  });
});
