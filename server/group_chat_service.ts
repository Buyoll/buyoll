import crypto from 'crypto';
import type { DatabaseSchema } from './db.js';
import { logAudit } from './db.js';
import { emitPlatformEvent } from './events.js';
import type {
  ChamaGroup,
  GroupChatGoalSummary,
  GroupChatMessage,
  GroupChatPresenceMember,
  GroupChatTopic,
  User,
} from '../src/types.js';

export const OFFENSIVE_CHAT_TERMS = [
  'scam',
  'conman',
  'thief',
  'idiot',
  'stupid',
  'fool',
  'liar',
  'fraudster',
  'corrupt',
  'bastard',
  'shit',
  'fuck',
  'bitch',
  'asshole',
  'useless',
  'crook',
  'criminal',
  'steal',
];

export const VALID_CHAT_TOPICS: ReadonlySet<GroupChatTopic> = new Set([
  'general',
  'goal',
  'coordination',
  'reminder',
]);

export type GroupRoomBroadcastFn = (
  groupId: number,
  eventType: 'chat:message' | 'chat:pinned' | 'chat:deleted' | 'chat:goal',
  payload: Record<string, any>
) => void;

export type GroupPresenceGetterFn = (groupId: number) => GroupChatPresenceMember[];

let roomBroadcaster: GroupRoomBroadcastFn | null = null;
let roomPresenceGetter: GroupPresenceGetterFn | null = null;

export function registerGroupChatRoomHooks(hooks: {
  broadcast: GroupRoomBroadcastFn;
  getPresence: GroupPresenceGetterFn;
}): void {
  roomBroadcaster = hooks.broadcast;
  roomPresenceGetter = hooks.getPresence;
}

export function getOnlineGroupPresence(groupId: number): GroupChatPresenceMember[] {
  return roomPresenceGetter ? roomPresenceGetter(groupId) : [];
}

export function broadcastGroupChatDelta(
  groupId: number,
  eventType: 'chat:message' | 'chat:pinned' | 'chat:deleted' | 'chat:goal',
  payload: Record<string, any>
): void {
  try {
    roomBroadcaster?.(groupId, eventType, payload);
  } catch {
    // Non-fatal WebSocket fanout failure
  }
  try {
    emitPlatformEvent('group.chat.message', {
      groupId,
      eventType,
      ...payload,
    });
  } catch {
    // Non-fatal SSE fanout failure
  }
}

export function buildGroupGoalSummary(group: ChamaGroup): GroupChatGoalSummary {
  const maxMembers = Math.max(1, Number(group.maxMembers || group.size || 1));
  const activeMembers = (group.slots || []).filter((s) => s.status === 'active').length;
  const totalCollected = (group.slots || []).reduce(
    (sum, s) => sum + Math.max(0, Number(s.paidAmount || 0)),
    0
  );
  const dailyAmount = Math.max(0, Number(group.dailyAmount || 0));
  const cycleDays = Math.max(1, Number(group.paymentDurationDays || group.cycleDays || maxMembers));
  const rawPriceTotal = Number(group.productPrice || 0) * maxMembers;
  const totalTarget = Math.max(
    1,
    Number((group as any).totalPrice || rawPriceTotal || dailyAmount * cycleDays * maxMembers || 1)
  );
  const progressPercent = Math.max(0, Math.min(100, Math.round((totalCollected / totalTarget) * 100)));

  return {
    totalCollected,
    totalTarget,
    progressPercent,
    activeMembers,
    maxMembers,
    completedRounds: Number(group.deliveredRounds?.length || (group as any).completedRounds || 0),
    dailyAmount,
    cycleDays,
    payoutOption: group.payoutOption,
  };
}

export function canUserModerateGroupChat(
  db: DatabaseSchema,
  group: ChamaGroup,
  user: User | null | undefined
): boolean {
  if (!user || user.isDisabled || user.isSuspended) return false;
  const effectiveRole = user.activeRole || user.role;
  if (effectiveRole === 'admin' || user.role === 'admin') return true;
  // Merchants participate in discussions but are excluded from group moderation per global governance
  const product = (db.products || []).find((p) => p.id === group.productId);
  const isMerchantViewer =
    effectiveRole === 'merchant' ||
    user.role === 'merchant' ||
    group.vendorId === user.id ||
    product?.vendorId === user.id;
  if (isMerchantViewer) return false;

  if (
    group.moderatorId === user.id ||
    (Array.isArray(group.moderators) && group.moderators.includes(user.id)) ||
    (group.adminId > 0 && group.adminId === user.id)
  ) {
    return true;
  }
  return Boolean(
    (group.slots || []).some(
      (s) => s.status === 'active' && s.userId === user.id && Boolean((s as any).isModerator)
    )
  );
}

export function resolveSenderGroupRoleLabel(
  db: DatabaseSchema,
  group: ChamaGroup,
  user: User
): string {
  const effectiveRole = user.activeRole || user.role;
  if (effectiveRole === 'admin' || user.role === 'admin') return 'Admin';

  const product = (db.products || []).find((p) => p.id === group.productId);
  if (group.vendorId === user.id || product?.vendorId === user.id) return 'Merchant';

  const slot = (group.slots || []).find((s) => s.status === 'active' && s.userId === user.id);
  if (
    Boolean((slot as any)?.isModerator) ||
    group.moderatorId === user.id ||
    (Array.isArray(group.moderators) && group.moderators.includes(user.id))
  ) {
    return slot ? `Moderator · Slot #${slot.slotNumber}` : 'Moderator';
  }
  if (slot) return `Member · Slot #${slot.slotNumber}`;

  const isAssignedLender =
    group.lenderId === user.id ||
    (db.groupLenders || []).some((l) => l.groupId === group.id && l.userId === user.id && l.status === 'ACTIVE');
  if (isAssignedLender || effectiveRole === 'lender') return 'Lender';

  return 'Member';
}

export function checkChatMuteOrBlacklist(
  db: DatabaseSchema,
  user: User
): { blocked: boolean; status: number; code: string; message: string; isMuted?: boolean; isBlacklisted?: boolean } {
  if (user.isDisabled || user.isSuspended) {
    return {
      blocked: true,
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      message: 'Your account is suspended or disabled.',
    };
  }
  if (user.isMuted) {
    return {
      blocked: true,
      status: 403,
      code: 'CHAT_MUTED',
      message: 'Your chat permissions have been muted by Buyoll Admin.',
      isMuted: true,
    };
  }
  const strikeRec = (db.chatStrikes || []).find((s) => s.userId === user.id);
  if (strikeRec?.isBlacklisted) {
    return {
      blocked: true,
      status: 403,
      code: 'CHAT_BLACKLISTED',
      message:
        'You have been blacklisted from Group chat due to repeated policy violations. You may appeal to Buyoll Admin.',
      isBlacklisted: true,
    };
  }
  if (strikeRec?.isMuted && strikeRec.mutedUntil && strikeRec.mutedUntil > Date.now()) {
    const hoursLeft = Math.max(1, Math.ceil((strikeRec.mutedUntil - Date.now()) / 3600000));
    return {
      blocked: true,
      status: 403,
      code: 'CHAT_MUTED',
      message: `Your chat permissions are temporarily muted for ${hoursLeft} more hour(s) following a moderation strike.`,
      isMuted: true,
    };
  }
  return { blocked: false, status: 200, code: 'OK', message: 'OK' };
}

export function moderateChatTextInTx(
  db: DatabaseSchema,
  user: User,
  rawText: string
): { censoredText: string; containsOffensive: boolean } {
  const lower = rawText.toLowerCase();
  let containsOffensive = false;
  let censoredText = rawText;

  for (const term of OFFENSIVE_CHAT_TERMS) {
    if (lower.includes(term)) {
      containsOffensive = true;
      const regex = new RegExp(term, 'gi');
      censoredText = censoredText.replace(regex, '***');
    }
  }

  if (containsOffensive) {
    if (!db.chatStrikes) db.chatStrikes = [];
    const now = Date.now();
    let strikeRec = db.chatStrikes.find((s) => s.userId === user.id);
    if (!strikeRec) {
      strikeRec = {
        userId: user.id,
        userName: user.name,
        strikeCount: 1,
        isMuted: false,
        isBlacklisted: false,
        lastViolationAt: now,
        warnings: [{ reason: 'Offensive or defamatory language detected in Group chat.', timestamp: now }],
      };
      db.chatStrikes.push(strikeRec);
    } else {
      strikeRec.strikeCount += 1;
      strikeRec.lastViolationAt = now;
      if (!strikeRec.warnings) strikeRec.warnings = [];
      strikeRec.warnings.push({ reason: 'Repeated offensive language.', timestamp: now });
      if (strikeRec.strikeCount === 2) {
        strikeRec.isMuted = true;
        strikeRec.mutedUntil = now + 86400000;
      } else if (strikeRec.strikeCount >= 3) {
        strikeRec.isBlacklisted = true;
        strikeRec.blacklistReason =
          'Exceeded maximum allowable strikes (3+ strikes) for abusive or defamatory language.';
      }
    }

    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_warn_${now}_${crypto.randomBytes(3).toString('hex')}`,
      userId: user.id,
      title: 'Platform Warning: Chat Policy Violation',
      message: `Your message contained words masked by automated moderation. Keep group discussions respectful. Strike count: ${strikeRec.strikeCount}/3.`,
      type: 'warning',
      read: false,
      timestamp: now,
    });

    logAudit(
      db,
      user.id,
      user.name,
      'CHAT_MODERATION_STRIKE',
      `Automated chat moderation masked message from ${user.name} (strike ${strikeRec.strikeCount}/3).`
    );
  }

  return { censoredText, containsOffensive };
}

export function postGroupChatMessageInTx(
  db: DatabaseSchema,
  params: {
    groupId: number;
    user: User;
    text: string;
    topic?: GroupChatTopic;
    kind?: 'normal' | 'reward' | 'nudge' | 'system';
    replyToId?: string;
    clientMsgId?: string;
    pinned?: boolean;
  }
): {
  message: GroupChatMessage;
  group: ChamaGroup;
  deduplicated: boolean;
  censored: boolean;
  goalSummary: GroupChatGoalSummary;
} {
  const group = (db.groups || []).find((g) => g.id === params.groupId);
  if (!group) {
    throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Chama group not found.' };
  }
  if (!group.chat) group.chat = [];

  const dbUser = (db.users || []).find((u) => u.id === params.user.id) || params.user;
  const restriction = checkChatMuteOrBlacklist(db, dbUser);
  if (restriction.blocked) {
    throw {
      status: restriction.status,
      code: restriction.code,
      message: restriction.message,
    };
  }

  const cleanClientMsgId =
    typeof params.clientMsgId === 'string' && params.clientMsgId.trim()
      ? params.clientMsgId.trim().slice(0, 120)
      : undefined;

  if (cleanClientMsgId) {
    const existing = group.chat.find(
      (m) => m.senderId === dbUser.id && m.clientMsgId === cleanClientMsgId
    );
    if (existing) {
      return {
        message: existing,
        group,
        deduplicated: true,
        censored: false,
        goalSummary: buildGroupGoalSummary(group),
      };
    }
  }

  const trimmed = String(params.text || '').trim().slice(0, 500);
  if (!trimmed) {
    throw { status: 400, code: 'EMPTY_MESSAGE', message: 'Message text cannot be empty.' };
  }

  const topic: GroupChatTopic =
    params.topic && VALID_CHAT_TOPICS.has(params.topic) ? params.topic : 'general';

  const kind = params.kind === 'system' && canUserModerateGroupChat(db, group, dbUser)
    ? 'system'
    : 'normal';

  const { censoredText, containsOffensive } =
    kind === 'system'
      ? { censoredText: trimmed, containsOffensive: false }
      : moderateChatTextInTx(db, dbUser, trimmed);

  let replyMeta: { replyToId?: string; replyToSender?: string; replyToSnippet?: string } = {};
  if (params.replyToId) {
    const target = group.chat.find((m) => m.id === params.replyToId);
    if (target) {
      replyMeta = {
        replyToId: target.id,
        replyToSender: target.senderName,
        replyToSnippet: String(target.text || '').slice(0, 96),
      };
    }
  }

  const now = Date.now();
  const canPin = Boolean(params.pinned && canUserModerateGroupChat(db, group, dbUser));
  if (canPin) {
    const pinnedCount = group.chat.filter((m) => m.pinned).length;
    if (pinnedCount >= 3) {
      // Auto-unpin oldest pinned notice when pinning a new message on send
      const oldestPinned = [...group.chat]
        .filter((m) => m.pinned)
        .sort((a, b) => (a.pinnedAt || a.timestamp) - (b.pinnedAt || b.timestamp))[0];
      if (oldestPinned) {
        oldestPinned.pinned = false;
        delete oldestPinned.pinnedAt;
        delete oldestPinned.pinnedBy;
      }
    }
  }

  const newMsg: GroupChatMessage = {
    id: `msg_${now}_${crypto.randomBytes(4).toString('hex')}`,
    senderId: dbUser.id,
    senderName: dbUser.name,
    senderRole: resolveSenderGroupRoleLabel(db, group, dbUser),
    kind,
    topic,
    text: censoredText,
    ...(canPin ? { pinned: true, pinnedBy: dbUser.id, pinnedAt: now } : {}),
    ...replyMeta,
    ...(cleanClientMsgId ? { clientMsgId: cleanClientMsgId } : {}),
    ...(containsOffensive ? { isFlagged: true } : {}),
    timestamp: now,
  };

  group.chat.push(newMsg);

  // Notify product merchant if someone else sends a discussion message
  const product = (db.products || []).find((p) => p.id === group.productId);
  if (product && product.vendorId && product.vendorId !== dbUser.id) {
    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_chat_${now}_${crypto.randomBytes(3).toString('hex')}`,
      userId: product.vendorId,
      title: `New Message in "${group.name}"`,
      message: `${dbUser.name}: "${censoredText.slice(0, 75)}${censoredText.length > 75 ? '...' : ''}"`,
      type: 'chat',
      link: `/chama/${group.id}`,
      read: false,
      timestamp: now,
    });
  }

  return {
    message: newMsg,
    group,
    deduplicated: false,
    censored: containsOffensive,
    goalSummary: buildGroupGoalSummary(group),
  };
}
