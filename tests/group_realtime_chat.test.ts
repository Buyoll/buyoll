import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startTestServer, TestHarness } from './test_server.js';
import { getDatabase, runDatabaseTransaction } from '../server/db.js';
import { runPendingMigrations } from '../server/migrations.js';

function connectWs(url: string): Promise<{
  ws: WebSocket;
  frames: any[];
  waitForFrame: (predicate: (f: any) => boolean, timeoutMs?: number) => Promise<any>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: any[] = [];
    const waiters: Array<{
      predicate: (f: any) => boolean;
      resolve: (f: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }> = [];

    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        frames.push(parsed);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].predicate(parsed)) {
            const w = waiters[i];
            waiters.splice(i, 1);
            clearTimeout(w.timer);
            w.resolve(parsed);
          }
        }
      } catch {
        // ignore non-json
      }
    });

    const waitForFrame = (predicate: (f: any) => boolean, timeoutMs = 4000) => {
      const existing = frames.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === res);
          if (idx !== -1) waiters.splice(idx, 1);
          rej(new Error('Timed out waiting for WebSocket frame'));
        }, timeoutMs);
        waiters.push({ predicate, resolve: res, reject: rej, timer });
      });
    };

    ws.on('open', () => resolve({ ws, frames, waitForFrame }));
    ws.on('error', (err) => reject(err));
  });
}

describe('Real-Time Group Discussion & Coordination (WebSockets + Goals + Moderation)', () => {
  let harness: TestHarness;
  let adminToken = '';
  let merchantToken = '';
  let modToken = '';
  let memberToken = '';
  let merchantId = 0;
  let modUserId = 0;
  let memberUserId = 0;
  let groupAId = 0;
  let groupBId = 0;

  before(async () => {
    harness = await startTestServer();
    const adminAuth = await harness.loginAdmin();
    adminToken = adminAuth.accessToken;
    const now = Date.now();

    await runDatabaseTransaction(async (db) => {
      await runPendingMigrations(db);

      const mkUser = (username: string, role: 'merchant' | 'member') => {
        const id = db.nextIds.user++;
        db.users.push({
          id,
          uuid: `test-rt-${username}-${id}`,
          name: `Test ${username}`,
          username,
          usernameDisplay: username,
          usernameLower: username.toLowerCase(),
          email: `${username.toLowerCase()}@buyoll.test`,
          phone: `+2547${String(20000000 + id).slice(-8)}`,
          phoneNormalized: `+2547${String(20000000 + id).slice(-8)}`,
          password: 'hashed_dummy_value',
          role,
          roles: [role],
          activeRole: role,
          platformId: `BYL-RT-${id}`,
          verified: true,
          isDisabled: false,
          isSuspended: false,
          credit: 0,
          coins: 50,
          points: 50,
          createdAt: now,
        } as any);
        return id;
      };

      merchantId = mkUser('rt_merch', 'merchant');
      modUserId = mkUser('rt_mod', 'member');
      memberUserId = mkUser('rt_member', 'member');

      const prodId = db.nextIds.product++;
      db.products.push({
        id: prodId,
        title: 'Realtime Solar Kit',
        description: 'Solar home backup system',
        category: 'Energy',
        price: 10000,
        stockQuantity: 10,
        images: ['./images/solar_power.jpg'],
        vendorId: merchantId,
        vendorName: 'Test rt_merch',
        live: true,
        publicationStatus: 'posted',
        moderationStatus: 'approved',
        speedOptions: [{ size: 10, cycleDays: 10, dailyAmount: 100, totalAmount: 10000, description: '10 members' }],
        createdAt: now,
      } as any);

      groupAId = db.nextIds.group++;
      db.groups.push({
        id: groupAId,
        name: 'Solar Chama Alpha',
        productId: prodId,
        productTitle: 'Realtime Solar Kit',
        productPrice: 1000,
        size: 10,
        cycleDays: 10,
        dailyAmount: 100,
        totalPrice: 10000,
        vendorId: merchantId,
        moderatorId: modUserId,
        moderators: [modUserId],
        status: 'active',
        occupiedCount: 2,
        slots: Array.from({ length: 10 }, (_, i) => ({
          slotNumber: i + 1,
          status: i < 2 ? 'active' : 'open',
          userId: i === 0 ? modUserId : i === 1 ? memberUserId : undefined,
          userName: i === 0 ? 'Test rt_mod' : i === 1 ? 'Test rt_member' : undefined,
          paidAmount: i === 0 ? 1000 : i === 1 ? 500 : 0,
        })),
        chat: [
          {
            id: `sys_init_${groupAId}`,
            senderId: modUserId,
            senderName: 'Test rt_mod',
            kind: 'system',
            text: 'Group created for Realtime Solar Kit.',
            timestamp: now - 5000,
          },
        ],
        notifications: [],
        joinPolicy: 'OPEN',
        createdAt: now,
      } as any);

      groupBId = db.nextIds.group++;
      db.groups.push({
        id: groupBId,
        name: 'Solar Chama Beta',
        productId: prodId,
        productTitle: 'Realtime Solar Kit',
        productPrice: 2000,
        size: 5,
        cycleDays: 5,
        dailyAmount: 400,
        totalPrice: 10000,
        vendorId: merchantId,
        status: 'active',
        occupiedCount: 0,
        slots: Array.from({ length: 5 }, (_, i) => ({
          slotNumber: i + 1,
          status: 'open',
          paidAmount: 0,
        })),
        chat: [],
        notifications: [],
        joinPolicy: 'OPEN',
        createdAt: now,
      } as any);
    });

    merchantToken = await harness.issueToken(merchantId, 'merchant');
    modToken = await harness.issueToken(modUserId, 'member');
    memberToken = await harness.issueToken(memberUserId, 'member');
  });

  after(async () => {
    await harness.close();
  });

  it('connects multi-user WS rooms, syncs goalSummary & presence, broadcasts typing & deltas with room isolation', async () => {
    const wsBase = harness.baseUrl.replace(/^http/, 'ws');
    const cMod = await connectWs(`${wsBase}/ws/chat?groupId=${groupAId}&token=${encodeURIComponent(modToken)}&role=member`);
    const cMem = await connectWs(`${wsBase}/ws/chat?groupId=${groupAId}&token=${encodeURIComponent(memberToken)}&role=member`);
    const cOtherRoom = await connectWs(`${wsBase}/ws/chat?groupId=${groupBId}&token=${encodeURIComponent(adminToken)}&role=admin`);

    try {
      const initMod = await cMod.waitForFrame((f) => f.type === 'chat:init');
      assert.equal(initMod.groupId, groupAId);
      assert.equal(initMod.canModerate, true);
      assert.equal(initMod.goalSummary.totalCollected, 1500);
      assert.equal(initMod.goalSummary.activeMembers, 2);

      // Presence includes both connected signed-in participants
      const presFrame = await cMod.waitForFrame(
        (f) => f.type === 'chat:presence' && Array.isArray(f.presence) && f.presence.length === 2
      );
      assert.equal(presFrame.onlineCount, 2);

      // Typing event sent by Member arrives on Moderator socket, NOT Group B socket
      cMem.ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
      const typingFrame = await cMod.waitForFrame(
        (f) => f.type === 'chat:typing' && f.userId === memberUserId
      );
      assert.equal(typingFrame.isTyping, true);

      // Member posts a goal message via HTTP POST -> instantly delivered via WS to Moderator, NOT Group B
      const cMsgId = `client_goal_${Date.now()}`;
      const postRes = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'x-buyoll-role': 'member',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Let us clear Day 3 contributions before 5 PM EAT today.',
          topic: 'goal',
          clientMsgId: cMsgId,
        }),
      });
      assert.equal(postRes.status, 201);
      const postJson = await postRes.json();
      assert.equal(postJson.message.topic, 'goal');
      assert.equal(postJson.message.senderRole, 'Member · Slot #2');

      const wsMsg = await cMod.waitForFrame(
        (f) => f.type === 'chat:message' && f.message?.id === postJson.message.id
      );
      assert.equal(wsMsg.message.text, 'Let us clear Day 3 contributions before 5 PM EAT today.');

      // Duplicate retry with identical clientMsgId deduplicates cleanly (HTTP 200, no extra row)
      const retryRes = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${memberToken}`,
          'x-buyoll-role': 'member',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Let us clear Day 3 contributions before 5 PM EAT today.',
          topic: 'goal',
          clientMsgId: cMsgId,
        }),
      });
      assert.equal(retryRes.status, 200);
      assert.equal((await retryRes.json()).deduplicated, true);

      // WebSocket direct chat:send with replyToId also persists & broadcasts
      const wsClientId = `ws_msg_${Date.now()}`;
      cMod.ws.send(
        JSON.stringify({
          type: 'chat:send',
          text: 'Agreed! Slot #1 already submitted.',
          topic: 'coordination',
          replyToId: postJson.message.id,
          clientMsgId: wsClientId,
        })
      );
      const replyWsFrame = await cMem.waitForFrame(
        (f) => f.type === 'chat:message' && f.message?.clientMsgId === wsClientId
      );
      assert.equal(replyWsFrame.message.replyToId, postJson.message.id);
      assert.equal(replyWsFrame.message.senderRole, 'Moderator · Slot #1');

      // Group B room received ZERO Group A messages or typing frames
      await new Promise((r) => setTimeout(r, 100));
      const leaked = cOtherRoom.frames.filter(
        (f) => (f.type === 'chat:message' || f.type === 'chat:typing') && f.groupId === groupAId
      );
      assert.equal(leaked.length, 0);
    } finally {
      cMod.ws.close();
      cMem.ws.close();
      cOtherRoom.ws.close();
    }
  });

  it('enforces pin governance, message deletion, system log protection, and profanity/strike moderation', async () => {
    // 1. Fetch existing messages in Group A
    const listRes = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member' },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const goalMsg = listJson.messages.find((m: any) => m.topic === 'goal');
    const sysMsg = listJson.messages.find((m: any) => m.kind === 'system');
    assert.ok(goalMsg);
    assert.ok(sysMsg);

    // 2. Member and Merchant CANNOT pin messages (403); Moderator CAN pin
    const memPin = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages/${goalMsg.id}/pin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(memPin.status, 403);

    const merchPin = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages/${goalMsg.id}/pin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${merchantToken}`, 'x-buyoll-role': 'merchant', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(merchPin.status, 403);

    const modPin = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages/${goalMsg.id}/pin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${modToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(modPin.status, 200);
    assert.equal((await modPin.json()).message.pinned, true);

    // 3. Moderator cannot delete protected system log (403), but can delete normal message
    const delSys = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages/${sysMsg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${modToken}`, 'x-buyoll-role': 'member' },
    });
    assert.equal(delSys.status, 403);

    const delGoal = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages/${goalMsg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${modToken}`, 'x-buyoll-role': 'member' },
    });
    assert.equal(delGoal.status, 200);

    // 4. Offensive language masked + strike 2 triggers mute -> 3rd post rejected with 403 CHAT_MUTED
    const bad1 = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Do not be an idiot about deadlines' }),
    });
    assert.equal(bad1.status, 201);
    const bad1Json = await bad1.json();
    assert.equal(bad1Json.censored, true);
    assert.ok(bad1Json.message.text.includes('***'));

    const bad2 = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Stop acting like a crook' }),
    });
    assert.equal(bad2.status, 201);

    const blockedAfterMute = await fetch(`${harness.baseUrl}/api/groups/${groupAId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'x-buyoll-role': 'member', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Can I send now?' }),
    });
    assert.equal(blockedAfterMute.status, 403);
    assert.equal((await blockedAfterMute.json()).error?.code, 'CHAT_MUTED');
  });
});
