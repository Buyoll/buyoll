import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import { emitPlatformEvent } from './events.js';
import { enqueueOutboxInTx, flushOutboxEvents } from './outbox_service.js';
import {
  ANNOUNCEMENT_UPLOADS_DIR,
  MAX_ANNOUNCEMENT_IMAGE_BYTES,
  validateImageBuffer,
} from './config.js';
import {
  Announcement,
  AnnouncementAudience,
  AnnouncementLifecycleStatus,
  AnnouncementType,
  User,
} from '../src/types.js';

export const announcementsRouter = wrapRouterAsync(Router());

const uploadAnnouncementImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ANNOUNCEMENT_IMAGE_BYTES,
    files: 1,
  },
});

const ctaUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (val) =>
      val === '' ||
      val.startsWith('/') ||
      val.startsWith('https://') ||
      val.startsWith('http://'),
    'CTA URL must be a relative path (/...) or an http(s) URL.'
  );

const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title must be 120 characters or fewer'),
  body: z.string().trim().min(1, 'Body is required').max(3000, 'Body must be 3000 characters or fewer'),
  type: z.enum(['NOTICE', 'ANNOUNCEMENT', 'PROMOTION']).optional().default('ANNOUNCEMENT'),
  audience: z.enum(['ALL', 'MEMBERS', 'MERCHANTS']).optional().default('ALL'),
  category: z.string().trim().max(60).optional(),
  pinned: z.boolean().optional().default(false),
  startsAt: z.union([z.number(), z.string(), z.null()]).optional(),
  endsAt: z.union([z.number(), z.string(), z.null()]).optional(),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  ctaUrl: ctaUrlSchema.optional().nullable(),
  imageUrl: z.string().trim().max(2_000_000).optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED', 'ARCHIVED']).optional(),
  publishNow: z.boolean().optional(),
});

const updateAnnouncementSchema = createAnnouncementSchema.partial();

function parseTimestamp(val: number | string | null | undefined): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const parsedNum = Number(val);
  if (Number.isFinite(parsedNum) && /^\d+$/.test(String(val).trim())) return parsedNum;
  const dateMs = Date.parse(val);
  return Number.isFinite(dateMs) ? dateMs : null;
}

function isUserAdmin(user: User | null): boolean {
  if (!user) return false;
  return (
    user.role === 'admin' ||
    user.activeRole === 'admin' ||
    (Array.isArray(user.roles) && user.roles.includes('admin'))
  );
}

async function requireAdmin(req: Request, res: Response): Promise<User | null> {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
    return null;
  }
  if (!isUserAdmin(user)) {
    sendApiError(res, 403, 'FORBIDDEN', 'Only administrators can manage announcements and notices.');
    return null;
  }
  return user;
}

function isAnnouncementVisibleNow(ann: Announcement, now: number): boolean {
  const status = ann.status || 'PUBLISHED';
  if (status === 'DRAFT' || status === 'ARCHIVED') return false;
  if (ann.startsAt && ann.startsAt > now) return false;
  if (ann.endsAt && ann.endsAt <= now) return false;
  return status === 'PUBLISHED' || status === 'SCHEDULED';
}

function matchesAudience(ann: Announcement, user: User | null, requestedAudience?: string): boolean {
  const audience = ann.audience || 'ALL';
  if (requestedAudience && requestedAudience !== 'ALL') {
    if (audience !== 'ALL' && audience !== requestedAudience) return false;
  }
  if (!user) {
    return audience === 'ALL' || audience === 'MEMBERS';
  }
  const activeRole = user.activeRole || user.role;
  if (activeRole === 'admin') return true;
  if (activeRole === 'merchant') return audience === 'ALL' || audience === 'MERCHANTS';
  if (activeRole === 'member') return audience === 'ALL' || audience === 'MEMBERS';
  return audience === 'ALL';
}

function sanitizeImageInput(imageUrl: string | null | undefined): string | undefined {
  if (!imageUrl) return undefined;
  const trimmed = String(imageUrl).trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }
  return undefined;
}

// ----------------------------------------------------------------------
// ADMIN IMAGE UPLOAD FOR PROMOTIONAL ANNOUNCEMENTS
// ----------------------------------------------------------------------
announcementsRouter.post(
  '/admin/uploads/announcement-image',
  (req: Request, res: Response, next) => {
    uploadAnnouncementImage.single('image')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendApiError(res, 400, 'FILE_TOO_LARGE', 'Promotional image must be 3 MB or smaller.');
        }
        return sendApiError(res, 400, 'UPLOAD_ERROR', err.message || 'Image upload failed.');
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    let buffer: Buffer | null = null;
    let declaredMime: string | undefined;

    if (req.file) {
      buffer = req.file.buffer;
      declaredMime = req.file.mimetype;
    } else if (typeof req.body?.dataUrl === 'string' && req.body.dataUrl.startsWith('data:image/')) {
      const match = req.body.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        return sendApiError(res, 400, 'INVALID_IMAGE', 'Malformed base64 image data.');
      }
      declaredMime = match[1];
      buffer = Buffer.from(match[2], 'base64');
    }

    if (!buffer) {
      return sendApiError(res, 400, 'IMAGE_REQUIRED', 'Please attach a JPG, PNG, or WebP image file (max 3 MB).');
    }

    if (buffer.length > MAX_ANNOUNCEMENT_IMAGE_BYTES) {
      return sendApiError(res, 400, 'FILE_TOO_LARGE', 'Promotional image exceeds 3 MB maximum size.');
    }

    const validated = validateImageBuffer(buffer, declaredMime);
    if (!validated) {
      return sendApiError(
        res,
        400,
        'INVALID_IMAGE_TYPE',
        'Invalid image file. Only JPG, PNG, and WebP images are supported.'
      );
    }

    const filename = `ann_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${validated.ext}`;
    let url: string;
    if (process.env.VERCEL !== '1' && process.env.VERCEL !== 'true') {
      try {
        await fs.mkdir(ANNOUNCEMENT_UPLOADS_DIR, { recursive: true });
        const targetPath = path.join(ANNOUNCEMENT_UPLOADS_DIR, filename);
        await fs.writeFile(targetPath, buffer);
        url = `/uploads/announcements/${filename}`;
      } catch {
        url = `data:${validated.mime};base64,${buffer.toString('base64')}`;
      }
    } else {
      url = `data:${validated.mime};base64,${buffer.toString('base64')}`;
    }
    await runDatabaseTransaction((db) => {
      logAudit(db, admin.id, admin.name, 'ANNOUNCEMENT_IMAGE_UPLOADED', `Uploaded promotional image ${filename} (${buffer!.length} bytes)`);
    });

    return res.status(201).json({
      success: true,
      url,
      mime: validated.mime,
      size: buffer.length,
    });
  }
);

// Non-admin direct hits to /admin/announcements* strictly blocked
announcementsRouter.use('/admin/announcements', async (req: Request, res: Response, next) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  (req as any).adminUser = admin;
  next();
});

// ----------------------------------------------------------------------
// ADMIN CRUD + LIFECYCLE
// ----------------------------------------------------------------------
announcementsRouter.get('/admin/announcements', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  const db = await getDatabase();
  const { status, type, audience, search } = req.query;
  let items = [...(db.announcements || [])];

  if (status && typeof status === 'string' && status !== 'ALL') {
    items = items.filter((a) => (a.status || 'PUBLISHED') === status.toUpperCase());
  }
  if (type && typeof type === 'string' && type !== 'ALL') {
    items = items.filter((a) => (a.type || 'ANNOUNCEMENT') === type.toUpperCase());
  }
  if (audience && typeof audience === 'string' && audience !== 'ALL') {
    items = items.filter((a) => (a.audience || 'ALL') === audience.toUpperCase());
  }
  if (search && typeof search === 'string' && search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q) ||
        (a.category || '').toLowerCase().includes(q)
    );
  }

  items.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });

  res.json({ announcements: items, total: items.length });
});

announcementsRouter.post('/admin/announcements', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  const parsed = createAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 400);
  }

  const data = parsed.data;
  const startsAt = parseTimestamp(data.startsAt);
  const endsAt = parseTimestamp(data.endsAt);

  if (startsAt && endsAt && endsAt <= startsAt) {
    return sendApiError(res, 400, 'INVALID_SCHEDULE', 'End date must be after start date.', {
      endsAt: 'End date must be after start date',
    });
  }

  const now = Date.now();
  let status: AnnouncementLifecycleStatus = data.status || (data.publishNow ? 'PUBLISHED' : 'DRAFT');
  if (!data.status && data.publishNow && startsAt && startsAt > now) {
    status = 'SCHEDULED';
  }
  if (status === 'PUBLISHED' && startsAt && startsAt > now) {
    status = 'SCHEDULED';
  }

  const announcement = await runDatabaseTransaction((db) => {
    if (!db.announcements) db.announcements = [];
    if (!db.nextIds.announcement) db.nextIds.announcement = (db.announcements.length || 0) + 1;

    const id = db.nextIds.announcement++;
    const item: Announcement = {
      id,
      title: data.title,
      body: data.body,
      imageUrl: sanitizeImageInput(data.imageUrl),
      category:
        data.category ||
        (data.type === 'NOTICE'
          ? 'Platform Notice'
          : data.type === 'PROMOTION'
          ? 'Promotional Campaign'
          : 'Platform Announcement'),
      type: data.type as AnnouncementType,
      audience: data.audience as AnnouncementAudience,
      status,
      pinned: Boolean(data.pinned),
      startsAt,
      endsAt,
      ctaLabel: data.ctaLabel || undefined,
      ctaUrl: data.ctaUrl || undefined,
      publishedAt: status === 'PUBLISHED' ? now : null,
      archivedAt: null,
      createdBy: admin.id,
      updatedBy: admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      authorId: admin.id,
      authorName: admin.name,
    };

    db.announcements.unshift(item);

    const outboxBatch: any[] = [];
    if (status === 'PUBLISHED') {
      if (!db.userNotifications) db.userNotifications = [];
      for (const u of db.users) {
        if (u.isDisabled) continue;
        const uRole = u.activeRole || u.role;
        const ok =
          item.audience === 'ALL' ||
          (item.audience === 'MEMBERS' && uRole === 'member') ||
          (item.audience === 'MERCHANTS' && uRole === 'merchant');
        if (!ok) continue;
        const evt = enqueueOutboxInTx(db, {
          userId: u.id,
          eventType: 'announcement.updated',
          entityType: 'announcement',
          entityId: String(item.id),
          title: `${item.type === 'PROMOTION' ? '🎁' : item.type === 'NOTICE' ? '📌' : '📢'} ${item.title}`,
          message: item.body.slice(0, 220),
          notificationType: 'broadcast',
          link: item.ctaUrl || '/announcements',
          payload: { action: 'created', announcementId: item.id, status: item.status },
          alsoAddNotification: true,
          now,
        });
        outboxBatch.push(evt);
      }
    }

    logAudit(
      db,
      admin.id,
      admin.name,
      'ADMIN_ANNOUNCEMENT_CREATED',
      `Admin created ${item.type} #${item.id} "${item.title}" [${item.status}, audience=${item.audience}]`
    );
    return { item, outboxBatch };
  });

  if (announcement.outboxBatch.length > 0) {
    flushOutboxEvents(announcement.outboxBatch);
  }
  emitPlatformEvent('announcement.updated', {
    action: 'created',
    announcementId: announcement.item.id,
    status: announcement.item.status,
  });

  return res.status(201).json({
    success: true,
    announcement: announcement.item,
    message:
      announcement.item.status === 'PUBLISHED'
        ? 'Announcement published live.'
        : announcement.item.status === 'SCHEDULED'
        ? 'Announcement scheduled for publication.'
        : 'Announcement saved as draft.',
  });
});

async function handleUpdateAnnouncement(req: Request, res: Response) {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  const parsed = updateAnnouncementSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 400);
  }
  const data = parsed.data;

  try {
    const updated = await runDatabaseTransaction((db) => {
      const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
      if (!item) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Announcement not found.' };
      }

      const now = Date.now();
      if (!db.announcementItemRevisions) db.announcementItemRevisions = [];
      db.announcementItemRevisions.unshift({
        id: `annrev_${now}_${Math.random().toString(36).slice(2, 6)}`,
        announcementId: item.id,
        snapshot: JSON.parse(JSON.stringify(item)),
        changedBy: admin.id,
        changedByName: admin.name,
        changedAt: now,
      });

      const nextStartsAt = data.startsAt !== undefined ? parseTimestamp(data.startsAt) : (item.startsAt ?? null);
      const nextEndsAt = data.endsAt !== undefined ? parseTimestamp(data.endsAt) : (item.endsAt ?? null);
      if (nextStartsAt && nextEndsAt && nextEndsAt <= nextStartsAt) {
        throw { status: 400, code: 'INVALID_SCHEDULE', message: 'End date must be after start date.' };
      }

      if (data.title !== undefined) item.title = data.title;
      if (data.body !== undefined) item.body = data.body;
      if (data.type !== undefined) item.type = data.type;
      if (data.audience !== undefined) item.audience = data.audience;
      if (data.category !== undefined) item.category = data.category;
      if (data.pinned !== undefined) item.pinned = data.pinned;
      if (data.startsAt !== undefined) item.startsAt = nextStartsAt;
      if (data.endsAt !== undefined) item.endsAt = nextEndsAt;
      if (data.ctaLabel !== undefined) item.ctaLabel = data.ctaLabel || undefined;
      if (data.ctaUrl !== undefined) item.ctaUrl = data.ctaUrl || undefined;
      if (data.imageUrl !== undefined) item.imageUrl = sanitizeImageInput(data.imageUrl);
      if (data.status !== undefined) {
        item.status = data.status;
        if (data.status === 'PUBLISHED' && !item.publishedAt) item.publishedAt = now;
        if (data.status === 'ARCHIVED') item.archivedAt = now;
      }

      item.updatedBy = admin.id;
      item.updatedAt = now;
      item.version = (item.version || 1) + 1;

      logAudit(
        db,
        admin.id,
        admin.name,
        'ADMIN_ANNOUNCEMENT_UPDATED',
        `Admin updated announcement #${item.id} "${item.title}" (v${item.version})`
      );
      return item;
    });

    emitPlatformEvent('announcement.updated', {
      action: 'updated',
      announcementId: updated.id,
      status: updated.status,
    });

    return res.json({ success: true, announcement: updated, message: 'Announcement updated.' });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'UPDATE_FAILED', err.message || 'Update failed.');
  }
}

announcementsRouter.patch('/admin/announcements/:id', handleUpdateAnnouncement);
announcementsRouter.put('/admin/announcements/:id', handleUpdateAnnouncement);

announcementsRouter.post('/admin/announcements/:id/publish', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  try {
    const out = await runDatabaseTransaction((db) => {
      const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
      if (!item) throw { status: 404, code: 'NOT_FOUND', message: 'Announcement not found.' };

      const now = Date.now();
      item.status = item.startsAt && item.startsAt > now ? 'SCHEDULED' : 'PUBLISHED';
      item.publishedAt = now;
      item.archivedAt = null;
      item.updatedBy = admin.id;
      item.updatedAt = now;
      item.version = (item.version || 1) + 1;

      const outboxBatch: any[] = [];
      if (item.status === 'PUBLISHED') {
        for (const u of db.users) {
          if (u.isDisabled) continue;
          const uRole = u.activeRole || u.role;
          const ok =
            item.audience === 'ALL' ||
            (item.audience === 'MEMBERS' && uRole === 'member') ||
            (item.audience === 'MERCHANTS' && uRole === 'merchant');
          if (!ok) continue;
          outboxBatch.push(
            enqueueOutboxInTx(db, {
              userId: u.id,
              eventType: 'announcement.updated',
              entityType: 'announcement',
              entityId: String(item.id),
              title: `${item.type === 'PROMOTION' ? '🎁' : item.type === 'NOTICE' ? '📌' : '📢'} ${item.title}`,
              message: item.body.slice(0, 220),
              notificationType: 'broadcast',
              link: item.ctaUrl || '/announcements',
              payload: { action: 'published', announcementId: item.id, status: item.status },
              alsoAddNotification: true,
              now,
            })
          );
        }
      }

      logAudit(db, admin.id, admin.name, 'ADMIN_ANNOUNCEMENT_PUBLISHED', `Published announcement #${item.id} "${item.title}"`);
      return { item, outboxBatch };
    });

    if (out.outboxBatch.length > 0) {
      flushOutboxEvents(out.outboxBatch);
    }
    emitPlatformEvent('announcement.updated', { action: 'published', announcementId: out.item.id });
    return res.json({ success: true, announcement: out.item, message: 'Announcement published live.' });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'PUBLISH_FAILED', err.message || 'Publish failed.');
  }
});

async function handlePullDown(req: Request, res: Response) {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  const targetStatus: AnnouncementLifecycleStatus = req.body?.archive ? 'ARCHIVED' : 'DRAFT';
  try {
    const updated = await runDatabaseTransaction((db) => {
      const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
      if (!item) throw { status: 404, code: 'NOT_FOUND', message: 'Announcement not found.' };

      const now = Date.now();
      item.status = targetStatus;
      if (targetStatus === 'ARCHIVED') item.archivedAt = now;
      item.updatedBy = admin.id;
      item.updatedAt = now;
      item.version = (item.version || 1) + 1;

      logAudit(
        db,
        admin.id,
        admin.name,
        targetStatus === 'ARCHIVED' ? 'ADMIN_ANNOUNCEMENT_ARCHIVED' : 'ADMIN_ANNOUNCEMENT_UNPUBLISHED',
        `Pulled down announcement #${item.id} "${item.title}" -> ${targetStatus}`
      );
      return item;
    });

    emitPlatformEvent('announcement.updated', { action: 'unpublished', announcementId: updated.id });
    return res.json({ success: true, announcement: updated, message: 'Announcement pulled down from live feed.' });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'UNPUBLISH_FAILED', err.message || 'Unpublish failed.');
  }
}

announcementsRouter.post('/admin/announcements/:id/unpublish', handlePullDown);
announcementsRouter.post('/admin/announcements/:id/pull-down', handlePullDown);

announcementsRouter.post('/admin/announcements/:id/pin', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  try {
    const updated = await runDatabaseTransaction((db) => {
      const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
      if (!item) throw { status: 404, code: 'NOT_FOUND', message: 'Announcement not found.' };

      const nextPinned = req.body?.pinned !== undefined ? Boolean(req.body.pinned) : !Boolean(item.pinned);
      item.pinned = nextPinned;
      item.updatedBy = admin.id;
      item.updatedAt = Date.now();

      logAudit(
        db,
        admin.id,
        admin.name,
        'ADMIN_ANNOUNCEMENT_PINNED',
        `${nextPinned ? 'Pinned' : 'Unpinned'} announcement #${item.id} "${item.title}"`
      );
      return item;
    });

    emitPlatformEvent('announcement.updated', { action: 'pinned', announcementId: updated.id, pinned: updated.pinned });
    return res.json({ success: true, announcement: updated });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'PIN_FAILED', err.message || 'Pin update failed.');
  }
});

announcementsRouter.delete('/admin/announcements/:id', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  try {
    const archived = await runDatabaseTransaction((db) => {
      const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
      if (!item) throw { status: 404, code: 'NOT_FOUND', message: 'Announcement not found.' };

      const now = Date.now();
      item.status = 'ARCHIVED';
      item.archivedAt = now;
      item.pinned = false;
      item.updatedBy = admin.id;
      item.updatedAt = now;

      logAudit(
        db,
        admin.id,
        admin.name,
        'ADMIN_ANNOUNCEMENT_ARCHIVED',
        `Soft-archived announcement #${item.id} "${item.title}"`
      );
      return item;
    });

    emitPlatformEvent('announcement.updated', { action: 'archived', announcementId: archived.id });
    return res.json({ success: true, announcement: archived, message: 'Announcement archived.' });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'ARCHIVE_FAILED', err.message || 'Archive failed.');
  }
});

announcementsRouter.get('/admin/announcements/:id/revisions', async (req: Request, res: Response) => {
  const admin = (req as any).adminUser as User;
  if (!admin) return;

  const db = await getDatabase();
  const revisions = (db.announcementItemRevisions || []).filter(
    (r) => String(r.announcementId) === String(req.params.id)
  );
  return res.json({ revisions });
});

// ----------------------------------------------------------------------
// PUBLIC & MEMBER VIEW / DISMISSAL ENDPOINTS
// ----------------------------------------------------------------------
announcementsRouter.get('/announcements', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const user = await resolveAuthenticatedUser(req, db);
  const now = Date.now();
  const { type, audience, pinnedOnly, includeDismissed } = req.query;

  const dismissedIds = new Set<string>(
    user && includeDismissed !== 'true'
      ? (db.announcementDismissals || [])
          .filter((d) => d.userId === user.id)
          .map((d) => String(d.announcementId))
      : []
  );

  let items = (db.announcements || []).filter((a) => {
    if (!isAnnouncementVisibleNow(a, now)) return false;
    if (!matchesAudience(a, user, typeof audience === 'string' ? audience : undefined)) return false;
    if (dismissedIds.has(String(a.id))) return false;
    if (type && typeof type === 'string' && type !== 'ALL' && (a.type || 'ANNOUNCEMENT') !== type.toUpperCase()) {
      return false;
    }
    if (pinnedOnly === 'true' && !a.pinned) return false;
    return true;
  });

  items = items
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      imageUrl: a.imageUrl,
      category: a.category || 'General',
      type: a.type || 'ANNOUNCEMENT',
      audience: a.audience || 'ALL',
      status: a.status || 'PUBLISHED',
      pinned: Boolean(a.pinned),
      startsAt: a.startsAt ?? null,
      endsAt: a.endsAt ?? null,
      ctaLabel: a.ctaLabel,
      ctaUrl: a.ctaUrl,
      publishedAt: a.publishedAt ?? a.createdAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      authorName: a.authorName || 'Buyoll Admin',
    }))
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt);
    });

  const limit = req.query.limit ? Math.max(1, Math.min(100, Number(req.query.limit))) : 50;
  const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;
  const paged = items.slice(offset, offset + limit);

  res.json({ announcements: paged, total: items.length });
});

announcementsRouter.get('/announcements/:id', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const user = await resolveAuthenticatedUser(req, db);
  const now = Date.now();
  const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
  if (!item) {
    return sendApiError(res, 404, 'NOT_FOUND', 'Announcement not found.');
  }
  if (!isUserAdmin(user)) {
    if (!isAnnouncementVisibleNow(item, now) || !matchesAudience(item, user)) {
      return sendApiError(res, 404, 'NOT_FOUND', 'Announcement not found.');
    }
  }
  res.json({ announcement: item });
});

announcementsRouter.post('/announcements/:id/dismiss', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const user = await resolveAuthenticatedUser(req, db);
  if (!user) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Sign in to dismiss notices persistently.');
  }
  const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
  if (!item) {
    return sendApiError(res, 404, 'NOT_FOUND', 'Announcement not found.');
  }

  await runDatabaseTransaction((txDb) => {
    if (!txDb.announcementDismissals) txDb.announcementDismissals = [];
    const exists = txDb.announcementDismissals.some(
      (d) => String(d.announcementId) === String(item.id) && d.userId === user.id
    );
    if (!exists) {
      txDb.announcementDismissals.push({
        id: `dis_${Date.now()}_${user.id}_${item.id}`,
        announcementId: item.id,
        userId: user.id,
        dismissedAt: Date.now(),
      });
    }
  });

  return res.json({ success: true, announcementId: item.id });
});

// Admin-only enforcement on legacy /announcements write routes too
announcementsRouter.post('/announcements', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  (req as any).adminUser = admin;
  const parsed = createAnnouncementSchema.safeParse({ ...req.body, publishNow: true });
  if (!parsed.success) return sendZodError(res, parsed.error, 400);

  const now = Date.now();
  const created = await runDatabaseTransaction((db) => {
    if (!db.announcements) db.announcements = [];
    if (!db.nextIds.announcement) db.nextIds.announcement = (db.announcements.length || 0) + 1;
    const item: Announcement = {
      id: db.nextIds.announcement++,
      title: parsed.data.title,
      body: parsed.data.body,
      imageUrl: sanitizeImageInput(parsed.data.imageUrl),
      category: parsed.data.category || 'Platform News',
      type: parsed.data.type,
      audience: parsed.data.audience,
      status: 'PUBLISHED',
      pinned: Boolean(parsed.data.pinned),
      ctaLabel: parsed.data.ctaLabel || undefined,
      ctaUrl: parsed.data.ctaUrl || undefined,
      publishedAt: now,
      createdBy: admin.id,
      updatedBy: admin.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      authorId: admin.id,
      authorName: admin.name,
    };
    db.announcements.unshift(item);
    logAudit(db, admin.id, admin.name, 'ANNOUNCEMENT_CREATED', `Created announcement #${item.id} "${item.title}"`);
    return item;
  });

  emitPlatformEvent('announcement.updated', { action: 'created', announcementId: created.id });
  return res.status(201).json({ success: true, announcement: created });
});

announcementsRouter.put('/announcements/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  (req as any).adminUser = admin;
  return handleUpdateAnnouncement(req, res);
});

announcementsRouter.delete('/announcements/:id', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const archived = await runDatabaseTransaction((db) => {
    const item = (db.announcements || []).find((a) => String(a.id) === String(req.params.id));
    if (!item) return null;
    item.status = 'ARCHIVED';
    item.archivedAt = Date.now();
    item.updatedBy = admin.id;
    item.updatedAt = Date.now();
    logAudit(db, admin.id, admin.name, 'ANNOUNCEMENT_ARCHIVED', `Archived announcement #${item.id} "${item.title}"`);
    return item;
  });
  if (!archived) return sendApiError(res, 404, 'NOT_FOUND', 'Announcement not found.');
  emitPlatformEvent('announcement.updated', { action: 'archived', announcementId: archived.id });
  return res.json({ success: true, message: 'Announcement archived.' });
});
