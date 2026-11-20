import crypto from 'crypto';
import type { DatabaseSchema } from './db.js';
import type { OutboxEventRecord, UserNotification } from '../src/types.js';
import { emitPlatformEvent, type PlatformEventType } from './events.js';

export interface EnqueueOutboxParams {
  userId: number;
  eventType: PlatformEventType;
  entityType: OutboxEventRecord['entityType'];
  entityId: string;
  title: string;
  message: string;
  notificationType: UserNotification['type'];
  link?: string;
  payload?: Record<string, any>;
  alsoAddNotification?: boolean;
  now?: number;
}

export function enqueueOutboxInTx(db: DatabaseSchema, params: EnqueueOutboxParams): OutboxEventRecord {
  if (!db.outboxEvents) db.outboxEvents = [];
  if (!db.userNotifications) db.userNotifications = [];
  const now = params.now ?? Date.now();

  const record: OutboxEventRecord = {
    id: `out_${now}_${crypto.randomBytes(4).toString('hex')}`,
    userId: params.userId,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    title: params.title,
    message: params.message,
    notificationType: params.notificationType,
    link: params.link,
    payload: params.payload,
    deliveredAt: null,
    acknowledgedAt: null,
    createdAt: now,
  };
  db.outboxEvents.unshift(record);

  if (params.alsoAddNotification !== false) {
    db.userNotifications.unshift({
      id: `notif_${now}_${crypto.randomBytes(3).toString('hex')}`,
      userId: params.userId,
      title: params.title,
      message: params.message,
      type: params.notificationType,
      link: params.link,
      read: false,
      timestamp: now,
    });
  }

  return record;
}

export function flushOutboxEvents(events: OutboxEventRecord[], extraBroadcasts?: Array<{ type: PlatformEventType; payload: Record<string, any>; targetUserIds?: number[] }>): void {
  const now = Date.now();
  for (const evt of events) {
    evt.deliveredAt = evt.deliveredAt || now;
    const targets = evt.userId > 0 ? [evt.userId] : undefined;
    emitPlatformEvent(
      'outbox.notification',
      {
        outboxId: evt.id,
        userId: evt.userId,
        eventType: evt.eventType,
        entityType: evt.entityType,
        entityId: evt.entityId,
        title: evt.title,
        message: evt.message,
        notificationType: evt.notificationType,
        link: evt.link,
        payload: evt.payload,
        createdAt: evt.createdAt,
      },
      targets
    );

    if (evt.eventType && evt.eventType !== 'outbox.notification') {
      emitPlatformEvent(
        evt.eventType as PlatformEventType,
        {
          outboxId: evt.id,
          userId: evt.userId,
          entityId: evt.entityId,
          ...(evt.payload || {}),
        },
        targets
      );
    }
  }

  if (extraBroadcasts) {
    for (const b of extraBroadcasts) {
      emitPlatformEvent(b.type, b.payload, b.targetUserIds);
    }
  }
}

export function getPendingOutboxForUser(db: DatabaseSchema, userId: number, limit = 50): OutboxEventRecord[] {
  const list = (db.outboxEvents || []).filter(
    (e) => e.userId === userId && !e.acknowledgedAt
  );
  return list.slice(0, limit);
}

export function acknowledgeOutboxForUser(db: DatabaseSchema, userId: number, ids: string[]): number {
  if (!db.outboxEvents || ids.length === 0) return 0;
  const idSet = new Set(ids.map(String));
  const now = Date.now();
  let updated = 0;
  for (const evt of db.outboxEvents) {
    if (evt.userId === userId && idSet.has(evt.id) && !evt.acknowledgedAt) {
      evt.acknowledgedAt = now;
      if (!evt.deliveredAt) evt.deliveredAt = now;
      updated++;
    }
  }
  return updated;
}
