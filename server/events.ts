import { Request, Response } from 'express';

export type PlatformEventType =
  | 'connected'
  | 'user.profile.updated'
  | 'announcement.updated'
  | 'group.chat.message'
  | 'group.loan.updated'
  | 'group.membership.updated'
  | 'group.products.updated'
  | 'subscription.updated'
  | 'subscription.activated'
  | 'subscription.expired'
  | 'user.wallet.updated';

interface SseClient {
  id: string;
  userId: number | null;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function emitPlatformEvent(
  type: PlatformEventType,
  payload: Record<string, any>,
  targetUserIds?: number[]
): void {
  const serialized = `event: ${type}\ndata: ${JSON.stringify({ type, payload, timestamp: Date.now() })}\n\n`;
  for (const client of clients.values()) {
    if (targetUserIds && targetUserIds.length > 0) {
      if (!client.userId || !targetUserIds.includes(client.userId)) {
        continue;
      }
    }
    try {
      client.res.write(serialized);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function handleEventsSse(req: Request, res: Response, userId: number | null): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  clients.set(clientId, { id: clientId, userId, res });

  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, userId, timestamp: Date.now() })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(keepAlive);
      clients.delete(clientId);
    }
  }, 25000);
  keepAlive.unref?.();

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(clientId);
  });
}

export function getActiveSseClientCount(): number {
  return clients.size;
}
