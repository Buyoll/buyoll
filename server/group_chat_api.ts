import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import {
  broadcastGroupChatDelta,
  buildGroupGoalSummary,
  canUserModerateGroupChat,
  checkChatMuteOrBlacklist,
  getOnlineGroupPresence,
  postGroupChatMessageInTx,
  VALID_CHAT_TOPICS,
} from './group_chat_service.js';
import type { GroupChatTopic } from '../src/types.js';

export const groupChatRouter = wrapRouterAsync(Router());

function checkRateBucket(map: Map<number, number[]>, userId: number, maxPerMin: number): boolean {
  const now = Date.now();
  const list = (map.get(userId) || []).filter((ts) => now - ts < 60_000);
  if (list.length >= maxPerMin) {
    map.set(userId, list);
    return false;
  }
  list.push(now);
  map.set(userId, list);
  return true;
}

const msgRateMap = new Map<number, number[]>();

// GET /api/groups/:id/messages — Authoritative message list, pinned goals, goal progress & presence
groupChatRouter.get('/groups/:id/messages', async (req: Request, res: Response) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return sendApiError(res, 400, 'INVALID_GROUP_ID', 'Invalid group identifier.');
  }

  const db = await getDatabase();
  const group = (db.groups || []).find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'GROUP_NOT_FOUND', 'Chama group not found.');
  }

  const user = await resolveAuthenticatedUser(req, db).catch(() => null);
  const topicParam = typeof req.query.topic === 'string' ? req.query.topic.trim() : '';
  const since = Number(req.query.since || 0);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 120)));

  let messages = [...(group.chat || [])].sort((a, b) => a.timestamp - b.timestamp);
  const pinnedMessages = messages.filter((m) => Boolean(m.pinned));

  if (topicParam && VALID_CHAT_TOPICS.has(topicParam as GroupChatTopic)) {
    messages = messages.filter((m) => (m.topic || 'general') === topicParam);
  }
  if (since > 0 && Number.isFinite(since)) {
    messages = messages.filter((m) => m.timestamp > since);
  }
  if (messages.length > limit) {
    messages = messages.slice(messages.length - limit);
  }

  const presence = getOnlineGroupPresence(groupId);
  const restriction = user ? checkChatMuteOrBlacklist(db, user) : { blocked: false };

  return res.json({
    groupId,
    messages,
    pinnedMessages,
    goalSummary: buildGroupGoalSummary(group),
    presence,
    onlineCount: presence.length,
    canModerate: user ? canUserModerateGroupChat(db, group, user) : false,
    viewerStatus: {
      authenticated: Boolean(user),
      isMuted: Boolean((restriction as any).isMuted),
      isBlacklisted: Boolean((restriction as any).isBlacklisted),
    },
  });
});

const PostMessageSchema = z.object({
  text: z.string().trim().min(1, 'Message text is required').max(500, 'Message cannot exceed 500 characters'),
  topic: z.enum(['general', 'goal', 'coordination', 'reminder']).optional().default('general'),
  kind: z.enum(['normal', 'system']).optional().default('normal'),
  replyToId: z.string().max(120).optional(),
  clientMsgId: z.string().max(120).optional(),
  pinned: z.boolean().optional(),
});

// POST /api/groups/:id/messages — Server-authoritative real-time message submission
groupChatRouter.post('/groups/:id/messages', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in to post messages in this Chama group.');
  }

  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || groupId <= 0) {
    return sendApiError(res, 400, 'INVALID_GROUP_ID', 'Invalid group identifier.');
  }

  if (!checkRateBucket(msgRateMap, user.id, 40)) {
    return sendApiError(res, 429, 'RATE_LIMITED', 'You are sending messages too quickly. Please wait a moment.');
  }

  const parsed = PostMessageSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      return postGroupChatMessageInTx(db, {
        groupId,
        user,
        text: parsed.data.text,
        topic: parsed.data.topic,
        kind: parsed.data.kind,
        replyToId: parsed.data.replyToId,
        clientMsgId: parsed.data.clientMsgId,
        pinned: parsed.data.pinned,
      });
    });

    if (!result.deduplicated) {
      broadcastGroupChatDelta(groupId, 'chat:message', {
        message: result.message,
        goalSummary: result.goalSummary,
      });
    }

    return res.status(result.deduplicated ? 200 : 201).json({
      success: true,
      message: result.message,
      goalSummary: result.goalSummary,
      censored: result.censored,
      deduplicated: result.deduplicated,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err?.status || 500,
      err?.code || 'CHAT_SEND_FAILED',
      err?.message || 'Unable to post message.'
    );
  }
});

// POST /api/groups/:id/messages/:msgId/pin — Moderator / Merchant / Admin pins or unpins goal/coordination message
groupChatRouter.post('/groups/:id/messages/:msgId/pin', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const groupId = Number(req.params.id);
  const msgId = String(req.params.msgId || '').trim();
  const explicitPin = typeof req.body?.pinned === 'boolean' ? req.body.pinned : undefined;

  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const group = (db.groups || []).find((g) => g.id === groupId);
      if (!group) {
        throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Chama group not found.' };
      }
      if (!canUserModerateGroupChat(db, group, user)) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only the Group Moderator, Merchant, or Buyoll Admin can pin goal notices.',
        };
      }
      const msg = (group.chat || []).find((m) => m.id === msgId);
      if (!msg) {
        throw { status: 404, code: 'MESSAGE_NOT_FOUND', message: 'Message not found in this group.' };
      }

      const nextPinned = explicitPin !== undefined ? explicitPin : !Boolean(msg.pinned);
      const now = Date.now();
      if (nextPinned) {
        const currentPinned = (group.chat || []).filter((m) => m.pinned && m.id !== msg.id);
        if (currentPinned.length >= 3) {
          throw {
            status: 400,
            code: 'PIN_LIMIT_REACHED',
            message: 'Up to 3 goal/coordination messages can be pinned per group. Unpin one first.',
          };
        }
        msg.pinned = true;
        msg.pinnedBy = user.id;
        msg.pinnedAt = now;
      } else {
        msg.pinned = false;
        delete msg.pinnedBy;
        delete msg.pinnedAt;
      }

      const pinnedMessages = (group.chat || []).filter((m) => Boolean(m.pinned));
      logAudit(
        db,
        user.id,
        user.name,
        nextPinned ? 'GROUP_CHAT_PINNED' : 'GROUP_CHAT_UNPINNED',
        `${nextPinned ? 'Pinned' : 'Unpinned'} message #${msg.id} in group #${group.id}.`
      );
      return { message: msg, pinnedMessages };
    });

    broadcastGroupChatDelta(groupId, 'chat:pinned', {
      message: outcome.message,
      pinnedMessages: outcome.pinnedMessages,
    });

    return res.json({
      success: true,
      message: outcome.message,
      pinnedMessages: outcome.pinnedMessages,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err?.status || 500,
      err?.code || 'PIN_FAILED',
      err?.message || 'Unable to update pin state.'
    );
  }
});

// DELETE /api/groups/:id/messages/:msgId — Author, Group Moderator, or Admin deletes a message
groupChatRouter.delete('/groups/:id/messages/:msgId', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const groupId = Number(req.params.id);
  const msgId = String(req.params.msgId || '').trim();

  try {
    const deleted = await runDatabaseTransaction(async (db) => {
      const group = (db.groups || []).find((g) => g.id === groupId);
      if (!group) {
        throw { status: 404, code: 'GROUP_NOT_FOUND', message: 'Chama group not found.' };
      }
      const idx = (group.chat || []).findIndex((m) => m.id === msgId);
      if (idx === -1) {
        throw { status: 404, code: 'MESSAGE_NOT_FOUND', message: 'Message not found.' };
      }
      const msg = group.chat[idx];
      const isModOrAdmin = canUserModerateGroupChat(db, group, user);
      const isAuthor = msg.senderId === user.id;
      const isAdmin = user.activeRole === 'admin' || user.role === 'admin';

      if (msg.kind === 'system' && !isAdmin) {
        throw {
          status: 403,
          code: 'SYSTEM_LOG_PROTECTED',
          message: 'System ledger messages cannot be deleted by members.',
        };
      }
      if (!isAuthor && !isModOrAdmin) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: 'You can only delete your own messages unless you moderate this group.',
        };
      }

      group.chat.splice(idx, 1);
      logAudit(
        db,
        user.id,
        user.name,
        'GROUP_CHAT_DELETED',
        `Deleted message #${msgId} in group #${group.id}.`
      );
      return msgId;
    });

    broadcastGroupChatDelta(groupId, 'chat:deleted', { messageId: deleted });
    return res.json({ success: true, messageId: deleted });
  } catch (err: any) {
    return sendApiError(
      res,
      err?.status || 500,
      err?.code || 'DELETE_FAILED',
      err?.message || 'Unable to delete message.'
    );
  }
});
