import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction } from './db.js';
import {
  AVATAR_UPLOADS_DIR,
  MAX_AVATAR_IMAGE_BYTES,
  validateImageBuffer,
} from './config.js';
import { resolveAuthenticatedUser, sanitizeUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import { emitPlatformEvent } from './events.js';
import { ChamaGroup, GroupProductEntry, Product, User } from '../src/types.js';

export const profileAndGroupsRouter = wrapRouterAsync(Router());

function ensureAvatarDirSafe(): boolean {
  try {
    if (!fs.existsSync(AVATAR_UPLOADS_DIR)) {
      fs.mkdirSync(AVATAR_UPLOADS_DIR, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_IMAGE_BYTES },
});

function handleAvatarMulter(req: Request, res: Response, next: () => void) {
  const mw = avatarUpload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);
  mw(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendApiError(res, 400, 'FILE_TOO_LARGE', 'Avatar image exceeds the 2 MB limit.');
      }
      return sendApiError(res, 400, 'UPLOAD_ERROR', err.message || 'Invalid avatar upload.');
    }
    next();
  });
}

function removeLocalAvatarFile(avatarPath?: string | null) {
  if (!avatarPath || typeof avatarPath !== 'string') return;
  if (!avatarPath.startsWith('/uploads/avatars/')) return;
  const filename = path.basename(avatarPath);
  const fullPath = path.join(AVATAR_UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch {
    // non-fatal cleanup error
  }
}

function propagateAvatarToGroupSlots(db: any, userId: number, avatarUrl: string | null) {
  (db.groups || []).forEach((g: ChamaGroup) => {
    (g.slots || []).forEach((s) => {
      if (s.userId === userId) {
        s.userAvatar = avatarUrl;
      }
    });
  });
}

// ----------------------------------------------------------------------
// USER AVATAR & PROFILE ROUTES (Item 2)
// ----------------------------------------------------------------------
profileAndGroupsRouter.post('/users/me/avatar', handleAvatarMulter, async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required to upload avatar.');
  }

  let fileBuffer: Buffer | null = null;
  let declaredMime: string | undefined;

  const filesObj = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
  const uploadedFile =
    filesObj?.avatar?.[0] || filesObj?.file?.[0] || filesObj?.image?.[0] || (req as any).file;

  if (uploadedFile && uploadedFile.buffer) {
    fileBuffer = uploadedFile.buffer;
    declaredMime = uploadedFile.mimetype;
  } else if (typeof req.body?.dataUrl === 'string' && req.body.dataUrl.startsWith('data:')) {
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(req.body.dataUrl.trim());
    if (!match) {
      return sendApiError(res, 400, 'INVALID_IMAGE', 'Invalid base64 image data URL.');
    }
    declaredMime = match[1];
    fileBuffer = Buffer.from(match[2], 'base64');
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    return sendApiError(res, 400, 'IMAGE_REQUIRED', 'Please provide an avatar image file (PNG, JPEG, or WebP).');
  }

  if (fileBuffer.length > MAX_AVATAR_IMAGE_BYTES) {
    return sendApiError(res, 400, 'FILE_TOO_LARGE', 'Avatar image exceeds the 2 MB limit.');
  }

  const validated = validateImageBuffer(fileBuffer, declaredMime);
  if (!validated) {
    return sendApiError(
      res,
      400,
      'INVALID_IMAGE',
      'Only valid PNG, JPEG, or WebP images up to 2 MB are allowed.'
    );
  }

  const filename = `avatar_${authUser.id}_${Date.now()}.${validated.ext}`;
  let avatarUrl: string;
  if (process.env.VERCEL !== '1' && process.env.VERCEL !== 'true' && ensureAvatarDirSafe()) {
    try {
      const filePath = path.join(AVATAR_UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, fileBuffer);
      avatarUrl = `/uploads/avatars/${filename}`;
    } catch {
      avatarUrl = `data:${validated.mime};base64,${fileBuffer.toString('base64')}`;
    }
  } else {
    avatarUrl = `data:${validated.mime};base64,${fileBuffer.toString('base64')}`;
  }

  try {
    const updatedUser = await runDatabaseTransaction(async (db) => {
      const dbUser = db.users.find((u) => u.id === authUser.id);
      if (!dbUser) {
        throw { status: 404, code: 'NOT_FOUND', message: 'User account not found.' };
      }

      const previousUrl = dbUser.avatarUrl || dbUser.avatar;
      if (previousUrl && previousUrl !== avatarUrl) {
        removeLocalAvatarFile(previousUrl);
      }

      dbUser.avatar = avatarUrl;
      dbUser.avatarUrl = avatarUrl;
      dbUser.avatarUpdatedAt = Date.now();
      propagateAvatarToGroupSlots(db, dbUser.id, avatarUrl);

      logAudit(db, dbUser.id, dbUser.name, 'AVATAR_UPLOADED', `Uploaded new profile avatar (${avatarUrl})`);
      return sanitizeUser(dbUser);
    });

    emitPlatformEvent('user.profile.updated', { userId: updatedUser.id, user: updatedUser });

    return res.status(200).json({
      success: true,
      avatarUrl,
      user: updatedUser,
      message: 'Profile avatar updated successfully.',
    });
  } catch (err: any) {
    removeLocalAvatarFile(avatarUrl);
    return sendApiError(res, err.status || 500, err.code || 'AVATAR_UPLOAD_FAILED', err.message || 'Failed to upload avatar');
  }
});

profileAndGroupsRouter.delete('/users/me/avatar', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  try {
    const updatedUser = await runDatabaseTransaction(async (db) => {
      const dbUser = db.users.find((u) => u.id === authUser.id);
      if (!dbUser) {
        throw { status: 404, code: 'NOT_FOUND', message: 'User account not found.' };
      }

      removeLocalAvatarFile(dbUser.avatarUrl || dbUser.avatar);
      dbUser.avatar = undefined;
      dbUser.avatarUrl = undefined;
      dbUser.avatarUpdatedAt = Date.now();
      propagateAvatarToGroupSlots(db, dbUser.id, null);

      logAudit(db, dbUser.id, dbUser.name, 'AVATAR_DELETED', 'Removed profile avatar');
      return sanitizeUser(dbUser);
    });

    emitPlatformEvent('user.profile.updated', { userId: updatedUser.id, user: updatedUser });

    return res.json({
      success: true,
      user: updatedUser,
      message: 'Profile avatar removed.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'AVATAR_DELETE_FAILED', err.message || 'Failed to remove avatar');
  }
});

const PatchProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
  phone: z.string().trim().min(7, 'Valid phone number required').max(25).optional(),
  email: z.string().trim().email('Valid email address required').optional(),
  shopName: z.string().trim().min(2).max(100).optional(),
  shopDescription: z.string().trim().max(500).optional(),
  avatarUrl: z.string().trim().max(1000000).nullable().optional(),
});

profileAndGroupsRouter.patch('/users/me', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const parsed = PatchProfileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error);
  }
  const updates = parsed.data;

  try {
    const updatedUser = await runDatabaseTransaction(async (db) => {
      const dbUser = db.users.find((u) => u.id === authUser.id);
      if (!dbUser) {
        throw { status: 404, code: 'NOT_FOUND', message: 'User account not found.' };
      }

      if (updates.email) {
        const lowerEmail = updates.email.toLowerCase();
        const clash = db.users.find(
          (u) => u.id !== dbUser.id && u.email && u.email.toLowerCase() === lowerEmail
        );
        if (clash) {
          throw {
            status: 409,
            code: 'EMAIL_TAKEN',
            message: 'This email address is already registered to another account.',
            fields: { email: 'Email already in use' },
          };
        }
        dbUser.email = lowerEmail;
      }

      if (updates.name !== undefined) dbUser.name = updates.name;
      if (updates.phone !== undefined) dbUser.phone = updates.phone;
      if (updates.shopName !== undefined) dbUser.shopName = updates.shopName;
      if (updates.shopDescription !== undefined) dbUser.shopDescription = updates.shopDescription;

      if (updates.avatarUrl !== undefined) {
        if (!updates.avatarUrl) {
          removeLocalAvatarFile(dbUser.avatarUrl || dbUser.avatar);
          dbUser.avatar = undefined;
          dbUser.avatarUrl = undefined;
          propagateAvatarToGroupSlots(db, dbUser.id, null);
        } else {
          dbUser.avatar = updates.avatarUrl;
          dbUser.avatarUrl = updates.avatarUrl;
          propagateAvatarToGroupSlots(db, dbUser.id, updates.avatarUrl);
        }
        dbUser.avatarUpdatedAt = Date.now();
      }

      logAudit(db, dbUser.id, dbUser.name, 'PROFILE_UPDATED', 'Updated profile fields via PATCH /users/me');
      return sanitizeUser(dbUser);
    });

    emitPlatformEvent('user.profile.updated', { userId: updatedUser.id, user: updatedUser });

    return res.json({
      success: true,
      user: updatedUser,
      message: 'Profile updated successfully.',
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'PROFILE_UPDATE_FAILED',
      err.message || 'Failed to update profile',
      err.fields
    );
  }
});

// ----------------------------------------------------------------------
// GROUP PRODUCT MANAGEMENT ROUTES (Item 2)
// ----------------------------------------------------------------------
function canManageGroupProducts(user: User | null, group: ChamaGroup, dbProducts: Product[]): boolean {
  if (!user) return false;
  const activeRole = user.activeRole || user.role;
  if (activeRole === 'admin' || user.role === 'admin') return true;
  if (group.adminId === user.id || group.moderatorId === user.id) return true;
  if (Array.isArray(group.moderators) && group.moderators.includes(user.id)) return true;
  if (group.vendorId && group.vendorId === user.id) return true;
  const primaryProduct = dbProducts.find((p) => p.id === group.productId);
  if (primaryProduct && primaryProduct.vendorId === user.id) return true;
  return false;
}

function buildGroupProductEntries(group: ChamaGroup): GroupProductEntry[] {
  const existing = Array.isArray(group.productsInGroup) ? [...group.productsInGroup] : [];
  if (group.productId && !existing.some((e) => e.productId === group.productId)) {
    existing.unshift({
      productId: group.productId,
      addedBy: group.vendorId || group.adminId || 0,
      featured: true,
      order: 0,
      addedAt: group.createdAt || Date.now(),
    });
  }
  return existing.sort((a, b) => (a.order ?? a.sortOrder ?? 0) - (b.order ?? b.sortOrder ?? 0));
}

function resolveGroupProductItems(
  entries: GroupProductEntry[],
  dbProducts: Product[],
  includeDrafts: boolean,
  authUser: User | null
) {
  return entries
    .map((entry) => {
      const product = dbProducts.find((p) => p.id === entry.productId);
      if (!product) return null;
      const isPosted = product.publicationStatus !== 'draft' && product.live !== false;
      if (!isPosted) {
        const isOwnerOrAdmin =
          Boolean(authUser) &&
          (authUser!.role === 'admin' ||
            authUser!.activeRole === 'admin' ||
            product.vendorId === authUser!.id);
        if (!includeDrafts || !isOwnerOrAdmin) return null;
      }
      return {
        ...entry,
        product,
      };
    })
    .filter(Boolean);
}

profileAndGroupsRouter.get('/groups/:groupId/products', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  const groupId = Number(req.params.groupId);
  const db = await getDatabase();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return sendApiError(res, 404, 'NOT_FOUND', 'Group not found.');
  }

  const canManage = canManageGroupProducts(authUser, group, db.products);
  const includeDrafts = req.query.includeDrafts === 'true' && canManage;
  const entries = buildGroupProductEntries(group);
  const items = resolveGroupProductItems(entries, db.products, includeDrafts, authUser);

  return res.json({
    groupId: group.id,
    canManage,
    productsInGroup: entries,
    items,
    products: items.map((i: any) => i.product),
  });
});

const AddGroupProductSchema = z.object({
  productId: z.coerce.number().int().positive('Valid productId is required'),
  featured: z.boolean().optional(),
  order: z.coerce.number().int().min(0).optional(),
});

profileAndGroupsRouter.post('/groups/:groupId/products', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const parsed = AddGroupProductSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error);
  }

  const groupId = Number(req.params.groupId);
  const { productId, featured, order } = parsed.data;

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Group not found.' };
      }

      if (!canManageGroupProducts(authUser, group, db.products)) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only the group moderator, owning merchant, or admin can manage group products.',
        };
      }

      const product = db.products.find((p) => p.id === productId);
      if (!product) {
        throw { status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' };
      }

      const entries = buildGroupProductEntries(group);
      const existing = entries.find((e) => e.productId === productId);
      if (existing) {
        throw {
          status: 409,
          code: 'ALREADY_IN_GROUP',
          message: 'This product is already linked to the group.',
        };
      }

      const newEntry: GroupProductEntry = {
        productId,
        featured: Boolean(featured),
        order: order !== undefined ? order : entries.length,
        addedBy: authUser.id,
        addedAt: Date.now(),
      };
      entries.push(newEntry);
      group.productsInGroup = entries.sort((a, b) => (a.order ?? a.sortOrder ?? 0) - (b.order ?? b.sortOrder ?? 0));

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_PRODUCT_ADDED',
        `Added product #${productId} (${product.title}) to group #${group.id}`
      );

      return {
        groupId: group.id,
        entry: newEntry,
        productsInGroup: group.productsInGroup,
        items: resolveGroupProductItems(group.productsInGroup, db.products, true, authUser),
      };
    });

    emitPlatformEvent('group.products.updated', {
      groupId: result.groupId,
      productsInGroup: result.productsInGroup,
    });

    return res.status(201).json({
      success: true,
      ...result,
      message: 'Product added to group.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'GROUP_PRODUCT_ERROR', err.message || 'Failed to add product to group');
  }
});

const PatchGroupProductSchema = z.object({
  featured: z.boolean().optional(),
  order: z.coerce.number().int().min(0).optional(),
});

profileAndGroupsRouter.patch('/groups/:groupId/products/:productId', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const parsed = PatchGroupProductSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error);
  }

  const groupId = Number(req.params.groupId);
  const productId = Number(req.params.productId);

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Group not found.' };
      }
      if (!canManageGroupProducts(authUser, group, db.products)) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only the group moderator, owning merchant, or admin can update group products.',
        };
      }

      const entries = buildGroupProductEntries(group);
      const entry = entries.find((e) => e.productId === productId);
      if (!entry) {
        throw { status: 404, code: 'PRODUCT_NOT_IN_GROUP', message: 'Product is not linked to this group.' };
      }

      if (parsed.data.featured !== undefined) entry.featured = parsed.data.featured;
      if (parsed.data.order !== undefined) entry.order = parsed.data.order;

      group.productsInGroup = entries.sort((a, b) => (a.order ?? a.sortOrder ?? 0) - (b.order ?? b.sortOrder ?? 0));

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_PRODUCT_UPDATED',
        `Updated product #${productId} in group #${group.id} (featured=${entry.featured}, order=${entry.order})`
      );

      return {
        groupId: group.id,
        entry,
        productsInGroup: group.productsInGroup,
        items: resolveGroupProductItems(group.productsInGroup, db.products, true, authUser),
      };
    });

    emitPlatformEvent('group.products.updated', {
      groupId: result.groupId,
      productsInGroup: result.productsInGroup,
    });

    return res.json({
      success: true,
      ...result,
      message: 'Group product updated.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'GROUP_PRODUCT_ERROR', err.message || 'Failed to update group product');
  }
});

profileAndGroupsRouter.delete('/groups/:groupId/products/:productId', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  const groupId = Number(req.params.groupId);
  const productId = Number(req.params.productId);

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const group = db.groups.find((g) => g.id === groupId);
      if (!group) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Group not found.' };
      }
      if (!canManageGroupProducts(authUser, group, db.products)) {
        throw {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Only the group moderator, owning merchant, or admin can remove group products.',
        };
      }

      const entries = buildGroupProductEntries(group);
      const exists = entries.some((e) => e.productId === productId);
      if (!exists) {
        throw { status: 404, code: 'PRODUCT_NOT_IN_GROUP', message: 'Product is not linked to this group.' };
      }

      const hasActivePayments = (group.slots || []).some((s) => (s.paidAmount || 0) > 0);
      if (group.productId === productId && hasActivePayments) {
        throw {
          status: 409,
          code: 'CANNOT_REMOVE_PRIMARY_PRODUCT',
          message: 'Cannot remove the primary product from a group that already has active member payments.',
        };
      }

      group.productsInGroup = entries
        .filter((e) => e.productId !== productId)
        .map((e, idx) => ({ ...e, order: idx }));

      logAudit(
        db,
        authUser.id,
        authUser.name,
        'GROUP_PRODUCT_REMOVED',
        `Removed product #${productId} from group #${group.id}`
      );

      return {
        groupId: group.id,
        productsInGroup: group.productsInGroup,
        items: resolveGroupProductItems(group.productsInGroup, db.products, true, authUser),
      };
    });

    emitPlatformEvent('group.products.updated', {
      groupId: result.groupId,
      productsInGroup: result.productsInGroup,
    });

    return res.json({
      success: true,
      ...result,
      message: 'Product removed from group.',
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'GROUP_PRODUCT_ERROR', err.message || 'Failed to remove product from group');
  }
});
