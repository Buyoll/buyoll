import type http from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { getDatabase, runDatabaseTransaction } from './db.js';
import { resolveAuthenticatedSession } from './auth_utils.js';
import {
  broadcastGroupChatDelta,
  buildGroupGoalSummary,
  canUserModerateGroupChat,
  checkChatMuteOrBlacklist,
  postGroupChatMessageInTx,
  registerGroupChatRoomHooks,
  resolveSenderGroupRoleLabel,
  VALID_CHAT_TOPICS,
} from './group_chat_service.js';
import type { GroupChatPresenceMember, GroupChatTopic, User } from '../src/types.js';

interface RoomClient {
  ws: WebSocket;
  groupId: number;
  user: User | null;
  roleLabel: string;
  isAlive: boolean;
  lastTypingAt: number;
}

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function attachGroupChatWebSocketServer(httpServer: http.Server): () => void {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<number, Set<RoomClient>>();

  const getRoomPresence = (groupId: number): GroupChatPresenceMember[] => {
    const set = rooms.get(groupId);
    if (!set) return [];
    const seen = new Map<number, GroupChatPresenceMember>();
    for (const c of set) {
      if (c.user && c.ws.readyState === WebSocket.OPEN && !seen.has(c.user.id)) {
        seen.set(c.user.id, {
          userId: c.user.id,
          name: c.user.name,
          roleLabel: c.roleLabel,
        });
      }
    }
    return Array.from(seen.values());
  };

  const sendJson = (ws: WebSocket, data: Record<string, any>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // Ignore send error on closing socket
    }
  };

  const broadcastToRoom = (
    groupId: number,
    data: Record<string, any>,
    excludeWs?: WebSocket
  ) => {
    const set = rooms.get(groupId);
    if (!set || set.size === 0) return;
    const encoded = JSON.stringify(data);
    for (const client of set) {
      if (excludeWs && client.ws === excludeWs) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(encoded);
        } catch {
          // Ignore send errors; heartbeat sweeps dead sockets
        }
      }
    }
  };

  registerGroupChatRoomHooks({
    broadcast: (groupId, eventType, payload) => {
      broadcastToRoom(groupId, {
        type: eventType,
        groupId,
        ...payload,
        timestamp: Date.now(),
      });
    },
    getPresence: getRoomPresence,
  });

  const broadcastPresence = (groupId: number) => {
    const presence = getRoomPresence(groupId);
    broadcastToRoom(groupId, {
      type: 'chat:presence',
      groupId,
      presence,
      onlineCount: presence.length,
      timestamp: Date.now(),
    });
  };

  const removeClient = (client: RoomClient) => {
    const set = rooms.get(client.groupId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        rooms.delete(client.groupId);
      } else {
        broadcastPresence(client.groupId);
      }
    }
  };

  const onUpgrade = async (
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => {
    const rawUrl = req.url || '/';
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
    } catch {
      return;
    }

    if (parsedUrl.pathname !== '/ws/chat') {
      // Leave Vite HMR and any unrelated WebSocket upgrades untouched
      return;
    }

    const groupId = Number(parsedUrl.searchParams.get('groupId') || 0);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const tokenParam = parsedUrl.searchParams.get('token') || undefined;
    const roleParam = parsedUrl.searchParams.get('role') || undefined;
    const cookies = parseCookieHeader(req.headers.cookie);

    const db = await getDatabase();
    const group = (db.groups || []).find((g) => g.id === groupId);
    if (!group) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const reqLike: any = {
      headers: {
        ...req.headers,
        ...(tokenParam ? { authorization: `Bearer ${tokenParam}` } : {}),
        ...(roleParam ? { 'x-buyoll-role': roleParam } : {}),
      },
      cookies,
      query: {
        ...(tokenParam ? { token: tokenParam } : {}),
      },
    };

    const sessionRes = await resolveAuthenticatedSession(reqLike, db, { touchActivity: true }).catch(
      () => ({ user: null })
    );
    const user = sessionRes?.user && !sessionRes.user.isDisabled && !sessionRes.user.isSuspended
      ? sessionRes.user
      : null;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const roleLabel = user ? resolveSenderGroupRoleLabel(db, group, user) : 'Viewer';
      const client: RoomClient = {
        ws,
        groupId,
        user,
        roleLabel,
        isAlive: true,
        lastTypingAt: 0,
      };

      if (!rooms.has(groupId)) rooms.set(groupId, new Set());
      rooms.get(groupId)!.add(client);

      const allMsgs = [...(group.chat || [])].sort((a, b) => a.timestamp - b.timestamp);
      const pinnedMessages = allMsgs.filter((m) => Boolean(m.pinned));
      const presence = getRoomPresence(groupId);

      sendJson(ws, {
        type: 'chat:init',
        groupId,
        messages: allMsgs,
        pinnedMessages,
        presence,
        onlineCount: presence.length,
        goalSummary: buildGroupGoalSummary(group),
        canModerate: user ? canUserModerateGroupChat(db, group, user) : false,
        authenticated: Boolean(user),
        timestamp: Date.now(),
      });

      broadcastPresence(groupId);

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('message', async (raw) => {
        try {
          const textData = typeof raw === 'string' ? raw : raw.toString('utf8');
          if (!textData || textData.length > 8192) return;
          const payload = JSON.parse(textData);
          if (!payload || typeof payload !== 'object') return;

          if (payload.type === 'ping') {
            client.isAlive = true;
            sendJson(ws, { type: 'pong', timestamp: Date.now() });
            return;
          }

          if (payload.type === 'typing') {
            if (!client.user) return;
            const now = Date.now();
            if (payload.isTyping && now - client.lastTypingAt < 1200) {
              return; // Throttle rapid typing pulses
            }
            client.lastTypingAt = now;
            const liveDb = await getDatabase();
            const restriction = checkChatMuteOrBlacklist(liveDb, client.user);
            if (restriction.blocked) return;

            broadcastToRoom(
              client.groupId,
              {
                type: 'chat:typing',
                groupId: client.groupId,
                userId: client.user.id,
                userName: client.user.name,
                roleLabel: client.roleLabel,
                isTyping: Boolean(payload.isTyping),
                timestamp: now,
              },
              ws
            );
            return;
          }

          if (payload.type === 'chat:send') {
            if (!client.user) {
              sendJson(ws, {
                type: 'chat:error',
                clientMsgId: payload.clientMsgId,
                code: 'UNAUTHORIZED',
                error: 'Sign in to participate in group discussion.',
              });
              return;
            }

            const topic: GroupChatTopic =
              typeof payload.topic === 'string' && VALID_CHAT_TOPICS.has(payload.topic as GroupChatTopic)
                ? (payload.topic as GroupChatTopic)
                : 'general';

            try {
              const result = await runDatabaseTransaction(async (txDb) => {
                return postGroupChatMessageInTx(txDb, {
                  groupId: client.groupId,
                  user: client.user!,
                  text: String(payload.text || ''),
                  topic,
                  replyToId: typeof payload.replyToId === 'string' ? payload.replyToId : undefined,
                  clientMsgId: typeof payload.clientMsgId === 'string' ? payload.clientMsgId : undefined,
                  pinned: Boolean(payload.pinned),
                });
              });

              if (!result.deduplicated) {
                broadcastGroupChatDelta(client.groupId, 'chat:message', {
                  message: result.message,
                  goalSummary: result.goalSummary,
                });
              }

              sendJson(ws, {
                type: 'chat:ack',
                clientMsgId: payload.clientMsgId,
                message: result.message,
                censored: result.censored,
                deduplicated: result.deduplicated,
              });
            } catch (err: any) {
              sendJson(ws, {
                type: 'chat:error',
                clientMsgId: payload.clientMsgId,
                code: err?.code || 'CHAT_SEND_FAILED',
                error: err?.message || 'Unable to send message.',
              });
            }
          }
        } catch {
          // Ignore malformed JSON frames cleanly
        }
      });

      ws.on('close', () => {
        removeClient(client);
      });

      ws.on('error', () => {
        removeClient(client);
      });
    });
  };

  httpServer.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const [gid, set] of rooms.entries()) {
      let removed = false;
      for (const client of set) {
        if (!client.isAlive || client.ws.readyState !== WebSocket.OPEN) {
          set.delete(client);
          removed = true;
          try {
            client.ws.terminate();
          } catch {
            // ignore
          }
          continue;
        }
        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          set.delete(client);
          removed = true;
        }
      }
      if (set.size === 0) {
        rooms.delete(gid);
      } else if (removed) {
        broadcastPresence(gid);
      }
    }
  }, 30000);
  heartbeat.unref?.();

  return () => {
    clearInterval(heartbeat);
    httpServer.off('upgrade', onUpgrade);
    for (const set of rooms.values()) {
      for (const client of set) {
        try {
          client.ws.close(1001, 'Server shutting down');
        } catch {
          // ignore
        }
      }
    }
    rooms.clear();
    try {
      wss.close();
    } catch {
      // ignore
    }
  };
}
