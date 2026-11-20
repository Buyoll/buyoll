import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import { emitPlatformEvent } from './events.js';
import { enqueueOutboxInTx, flushOutboxEvents } from './outbox_service.js';
import { fromCents, getEatDateParts, toCents } from './config.js';
import {
  debitWalletCents,
  findPlatformAdminUser,
  getWalletBalanceCents,
} from './wallet_service.js';
import { paginateList, parsePaginationQuery } from './admin_control_center.js';
import { enforceExpiredSubscriptions, getMerchantLimits, SUBSCRIPTION_PLANS } from './subscriptions_api.js';
import {
  approveFeaturedRequestInTx,
  computeFeaturedQuote,
  getEligibleGroupsForProduct,
  getFeaturedPlacements,
  getFeaturedPricingList,
  getFeaturedSettings,
  getPublicFeaturedListings,
  getTierFeaturedLimits,
  isBotUserAgent,
  isProductEligibleForFeatured,
  recordFeaturedEventInTx,
  refundFeaturedRequestInTx,
  summarizeFeaturedRequestStats,
  sweepFeaturedPlacements,
  sweepFeaturedPlacementsInTx,
} from './featured_service.js';
import type { FeaturedRequest, User } from '../src/types.js';

export const featuredRouter = wrapRouterAsync(Router());

function isUserAdmin(u: User | null): boolean {
  if (!u || u.isDisabled || u.isSuspended) return false;
  return (
    u.activeRole === 'admin' ||
    u.role === 'admin' ||
    (Array.isArray(u.roles) && u.roles.includes('admin'))
  );
}

function isUserMerchant(u: User | null): boolean {
  if (!u || u.isDisabled || u.isSuspended) return false;
  return (
    u.activeRole === 'merchant' ||
    u.role === 'merchant' ||
    (Array.isArray(u.roles) && u.roles.includes('merchant'))
  );
}

// Rate limiters
const submitRateMap = new Map<number, number[]>();
const eventRateMap = new Map<string, number[]>();

function checkBucketRate(map: Map<any, number[]>, key: any, maxReqs: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= maxReqs) {
    map.set(key, list);
    return false;
  }
  list.push(now);
  map.set(key, list);
  return true;
}

async function requireAdmin(req: Request, res: Response): Promise<User | null> {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
    return null;
  }
  if (!isUserAdmin(user)) {
    sendApiError(res, 403, 'FORBIDDEN', 'Administrator privileges required');
    return null;
  }
  return user;
}

// ======================================================================
// 1. PUBLIC FEATURED FEED, PRICING & ANALYTICS INGESTION
// ======================================================================

featuredRouter.get('/featured', async (req: Request, res: Response) => {
  await sweepFeaturedPlacements();
  const db = await getDatabase();

  const placementKey = typeof req.query.placement === 'string' && req.query.placement.trim()
    ? req.query.placement.trim()
    : 'homepage_featured';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const seed = typeof req.query.seed === 'string' && req.query.seed.trim() ? req.query.seed.trim() : undefined;

  const result = getPublicFeaturedListings(db, { placementKey, page, limit, seed });
  return res.json(result);
});

featuredRouter.get('/featured/pricing', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const settings = getFeaturedSettings(db);
  const placements = getFeaturedPlacements(db);
  const pricing = getFeaturedPricingList(db).map((p) => ({
    ...p,
    priceKes: fromCents(p.priceCents),
  }));

  const user = await resolveAuthenticatedUser(req).catch(() => null);
  let limits: ReturnType<typeof getMerchantLimits> | null = null;
  let quotedPricing = pricing.map((p) => ({
    ...p,
    discountPercent: 0,
    finalPriceCents: p.priceCents,
    finalPriceKes: fromCents(p.priceCents),
  }));

  if (user && (isUserMerchant(user) || isUserAdmin(user))) {
    limits = getMerchantLimits(db, user.id);
    const disc = limits.featuredDiscountPercent || 0;
    quotedPricing = pricing.map((p) => {
      const finalPriceCents = Math.max(100, Math.round((p.priceCents * (100 - disc)) / 100));
      return {
        ...p,
        discountPercent: disc,
        finalPriceCents,
        finalPriceKes: fromCents(finalPriceCents),
      };
    });
  }

  return res.json({
    placements,
    pricing: quotedPricing,
    settings,
    limits,
  });
});

const SingleEventSchema = z.object({
  eventType: z.enum(['impression', 'click', 'product_view', 'join', 'order']),
  sessionId: z.string().max(120).optional(),
});

featuredRouter.post('/featured/:id/events', async (req: Request, res: Response) => {
  const ua = String(req.headers['user-agent'] || '');
  if (isBotUserAgent(ua)) {
    return res.json({ success: true, ignored: true });
  }

  const clientKey = req.ip || 'anon';
  if (!checkBucketRate(eventRateMap, clientKey, 180, 60000)) {
    return sendApiError(res, 429, 'RATE_LIMITED', 'Too many analytics events; slow down.');
  }

  const parsed = SingleEventSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const authUser = await resolveAuthenticatedUser(req).catch(() => null);
  const viewerKey = authUser
    ? `u_${authUser.id}`
    : parsed.data.sessionId
    ? `s_${parsed.data.sessionId}`
    : `ip_${crypto.createHash('sha256').update(`${clientKey}:${ua}`).digest('hex').slice(0, 16)}`;

  const featuredRequestId = String(req.params.id || '').trim();
  const recorded = await runDatabaseTransaction(async (db) => {
    return recordFeaturedEventInTx(db, {
      featuredRequestId,
      eventType: parsed.data.eventType,
      viewerKey,
    });
  });

  if (!recorded) {
    return sendApiError(res, 404, 'FEATURED_NOT_FOUND', 'Active featured placement not found for event.');
  }
  return res.json({ success: true });
});

const BatchEventsSchema = z.object({
  events: z
    .array(
      z.object({
        featuredRequestId: z.string().min(1).max(120),
        eventType: z.enum(['impression', 'click', 'product_view', 'join', 'order']),
      })
    )
    .min(1)
    .max(50),
  sessionId: z.string().max(120).optional(),
});

featuredRouter.post('/featured/events/batch', async (req: Request, res: Response) => {
  const ua = String(req.headers['user-agent'] || '');
  if (isBotUserAgent(ua)) {
    return res.json({ success: true, recorded: 0, ignored: true });
  }

  const clientKey = req.ip || 'anon';
  if (!checkBucketRate(eventRateMap, clientKey, 120, 60000)) {
    return sendApiError(res, 429, 'RATE_LIMITED', 'Too many analytics events; slow down.');
  }

  const parsed = BatchEventsSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const authUser = await resolveAuthenticatedUser(req).catch(() => null);
  const viewerKey = authUser
    ? `u_${authUser.id}`
    : parsed.data.sessionId
    ? `s_${parsed.data.sessionId}`
    : `ip_${crypto.createHash('sha256').update(`${clientKey}:${ua}`).digest('hex').slice(0, 16)}`;

  const count = await runDatabaseTransaction(async (db) => {
    let recordedCount = 0;
    for (const ev of parsed.data.events) {
      const ok = recordFeaturedEventInTx(db, {
        featuredRequestId: ev.featuredRequestId,
        eventType: ev.eventType,
        viewerKey,
      });
      if (ok) recordedCount++;
    }
    return recordedCount;
  });

  return res.json({ success: true, recorded: count });
});

// ======================================================================
// 2. MERCHANT FEATURED REQUESTS, CANCELLATION & PERFORMANCE STATS
// ======================================================================

function enrichFeaturedRequest(
  db: Awaited<ReturnType<typeof getDatabase>>,
  req: FeaturedRequest,
  now = Date.now()
) {
  const product = (db.products || []).find((p) => p.id === req.productId);
  const merchant = (db.users || []).find((u) => u.id === req.merchantId);
  const placement = getFeaturedPlacements(db).find((pl) => pl.key === req.placementKey);
  const groups = getEligibleGroupsForProduct(db, req.productId);
  const stats = summarizeFeaturedRequestStats(db, req.id);
  const daysRemaining =
    req.status === 'ACTIVE' && req.endsAt && req.endsAt > now
      ? Math.max(1, Math.ceil((req.endsAt - now) / 86400000))
      : 0;

  return {
    ...req,
    amountPaidKes: fromCents(req.amountPaidCents),
    basePriceKes: fromCents(req.basePriceCents),
    refundedKes: fromCents(req.refundedCents || 0),
    startsAtEat: req.startsAt ? getEatDateParts(req.startsAt).dateKey : null,
    endsAtEat: req.endsAt ? getEatDateParts(req.endsAt).dateKey : null,
    daysRemaining,
    placementName: placement?.name || req.placementKey,
    product: product
      ? {
          id: product.id,
          title: product.title,
          price: product.price,
          category: product.category,
          image: product.images?.[0] || './images/smart_tv.jpg',
          publicationStatus: product.publicationStatus,
          live: product.live,
          hiddenReason: product.hiddenReason || null,
          groupCount: groups.length,
        }
      : null,
    merchant: merchant
      ? {
          id: merchant.id,
          name: merchant.name,
          shopName: merchant.shopName || merchant.name,
          email: merchant.email,
        }
      : null,
    groupCount: groups.length,
    stats,
  };
}

featuredRouter.get('/merchant/featured', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can access Featured Requests');
  }

  await enforceExpiredSubscriptions(user.id);
  await sweepFeaturedPlacements();

  const db = await getDatabase();
  const dbUser = db.users.find((u) => u.id === user.id) || user;
  const now = Date.now();
  const limits = getMerchantLimits(db, user.id, now);
  const settings = getFeaturedSettings(db);
  const placements = getFeaturedPlacements(db);
  const pricing = getFeaturedPricingList(db).map((p) => {
    const disc = limits.featuredDiscountPercent || 0;
    const finalPriceCents = Math.max(100, Math.round((p.priceCents * (100 - disc)) / 100));
    return {
      ...p,
      priceKes: fromCents(p.priceCents),
      discountPercent: disc,
      finalPriceCents,
      finalPriceKes: fromCents(finalPriceCents),
    };
  });

  const requests = (db.featuredRequests || [])
    .filter((r) => r.merchantId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => enrichFeaturedRequest(db, r, now));

  const walletBalanceCents = getWalletBalanceCents(db, dbUser, 'merchant');

  return res.json({
    requests,
    limits,
    settings,
    placements,
    pricing,
    walletBalanceCents,
    walletBalanceKes: fromCents(walletBalanceCents),
  });
});

const CreateFeaturedRequestSchema = z.object({
  productId: z.coerce.number().int().positive(),
  placementKey: z.string().min(1).max(80).default('homepage_featured'),
  durationDays: z.coerce.number().int(),
  requestedStartAt: z.coerce.number().int().positive().nullable().optional(),
  idempotencyKey: z.string().min(4).max(120).optional(),
});

featuredRouter.post('/merchant/featured', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can request Featured placements');
  }

  if (!checkBucketRate(submitRateMap, user.id, 20, 60000)) {
    return sendApiError(res, 429, 'RATE_LIMITED', 'Too many featured requests. Please wait a moment.');
  }

  const parsed = CreateFeaturedRequestSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  await enforceExpiredSubscriptions(user.id);

  const headerIdem = req.header('Idempotency-Key') || req.header('idempotency-key');
  const rawIdempotencyKey = (parsed.data.idempotencyKey || headerIdem || '').trim() || undefined;

  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      sweepFeaturedPlacementsInTx(db, now);

      const merchantUser = db.users.find((u) => u.id === user.id);
      if (!merchantUser || merchantUser.isDisabled || merchantUser.isSuspended) {
        throw { status: 403, code: 'ACCOUNT_INACTIVE', message: 'Your merchant account is inactive or suspended.' };
      }

      if (!db.featuredRequests) db.featuredRequests = [];

      // Idempotent replay check before any checks/debit
      if (rawIdempotencyKey) {
        const existingReplay = db.featuredRequests.find(
          (r) => r.merchantId === user.id && r.idempotencyKey === rawIdempotencyKey
        );
        if (existingReplay) {
          return {
            deduplicated: true,
            request: enrichFeaturedRequest(db, existingReplay, now),
            walletBalanceKes: fromCents(getWalletBalanceCents(db, merchantUser, 'merchant')),
            limits: getMerchantLimits(db, user.id, now),
          };
        }
      }

      // Subscription check
      const limits = getMerchantLimits(db, user.id, now);
      if (!limits.hasActiveSubscription) {
        throw {
          status: 403,
          code: limits.isExpired ? 'SUBSCRIPTION_EXPIRED' : 'SUBSCRIPTION_REQUIRED',
          message: limits.isExpired
            ? 'Your merchant subscription has expired. Renew your plan before featuring products.'
            : 'An active merchant subscription is required to feature products.',
        };
      }

      // Product ownership & eligibility check (published + >= 1 group)
      const product = (db.products || []).find((p) => p.id === parsed.data.productId);
      if (!product) {
        throw { status: 404, code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' };
      }
      if (product.vendorId !== user.id && !isUserAdmin(user)) {
        throw {
          status: 403,
          code: 'FORBIDDEN_OWNERSHIP',
          message: 'You can only request featured placement for your own products.',
        };
      }

      const settings = getFeaturedSettings(db);
      const elig = isProductEligibleForFeatured(db, product, settings);
      if (!elig.eligible) {
        throw {
          status: 400,
          code: elig.code || 'PRODUCT_INELIGIBLE',
          message: elig.reason || 'Product is not eligible for featured placement.',
        };
      }

      // Enforce tier active + pending featured limits BEFORE wallet hold
      if (limits.maxActiveFeatured !== -1 && limits.activeFeaturedUsed >= limits.maxActiveFeatured) {
        throw {
          status: 403,
          code: 'FEATURED_ACTIVE_LIMIT_REACHED',
          message: `You have reached your ${limits.tierName} limit of ${limits.maxActiveFeatured} active/scheduled featured product(s). Upgrade your plan for more slots.`,
        };
      }
      if (limits.maxPendingFeatured !== -1 && limits.pendingFeaturedUsed >= limits.maxPendingFeatured) {
        throw {
          status: 403,
          code: 'FEATURED_PENDING_LIMIT_REACHED',
          message: `You already have ${limits.pendingFeaturedUsed} pending featured request(s), which is the max (${limits.maxPendingFeatured}) for ${limits.tierName}. Wait for review or cancel one first.`,
        };
      }

      // Prevent duplicate pending/approved/active placement for the same product + placementKey
      const duplicateOpen = db.featuredRequests.find(
        (r) =>
          r.productId === product.id &&
          r.placementKey === parsed.data.placementKey &&
          (r.status === 'PENDING_APPROVAL' || r.status === 'APPROVED' || r.status === 'ACTIVE') &&
          (!r.endsAt || r.endsAt > now)
      );
      if (duplicateOpen) {
        throw {
          status: 409,
          code: 'DUPLICATE_FEATURED_REQUEST',
          message: `"${product.title}" already has an active or pending featured placement (${duplicateOpen.status}).`,
        };
      }

      // Price calculation purely on server from DB pricing + tier limits
      const tierLimits = getTierFeaturedLimits(db, limits.tierId);
      const quote = computeFeaturedQuote(
        db,
        tierLimits,
        parsed.data.placementKey,
        parsed.data.durationDays
      );
      if (!quote.valid) {
        throw {
          status: quote.status || 400,
          code: quote.code || 'INVALID_FEATURED_QUOTE',
          message: quote.message || 'Unable to price featured request.',
        };
      }

      if (
        parsed.data.requestedStartAt &&
        parsed.data.requestedStartAt < now - 5 * 60 * 1000
      ) {
        throw {
          status: 400,
          code: 'INVALID_START_DATE',
          message: 'Requested start time cannot be in the past.',
        };
      }

      const reqId = `freq_${now}_${crypto.randomBytes(4).toString('hex')}`;
      const holdKey = `feat_hold_${reqId}`;

      // Hold fee from merchant wallet atomically
      const { wallet, entry: holdEntry } = debitWalletCents(db, {
        userId: user.id,
        role: 'merchant',
        amountCents: quote.finalPriceCents,
        category: 'FEATURED_HOLD',
        referenceId: reqId,
        idempotencyKey: holdKey,
        note: `Hold for ${parsed.data.durationDays}-day Featured Placement: "${product.title}"`,
        actorId: user.id,
      });

      const finalKes = fromCents(quote.finalPriceCents);
      if (!db.storeCreditLedger) db.storeCreditLedger = [];
      db.storeCreditLedger.unshift({
        id: db.nextIds.ledger++,
        userId: user.id,
        amount: -finalKes,
        balanceAfter: fromCents(wallet.balanceCents),
        type: 'transfer_out',
        referenceId: `FEAT-HOLD-${reqId}`,
        note: `Featured placement hold (${parsed.data.durationDays}d) for "${product.title}"`,
        createdAt: now,
      });

      const record: FeaturedRequest = {
        id: reqId,
        merchantId: user.id,
        productId: product.id,
        placementKey: parsed.data.placementKey,
        durationDays: parsed.data.durationDays,
        tierIdSnapshot: limits.tierId,
        basePriceCents: quote.basePriceCents,
        discountPercent: quote.discountPercent,
        amountPaidCents: quote.finalPriceCents,
        currency: 'KES',
        status: 'PENDING_APPROVAL',
        requestedStartAt: parsed.data.requestedStartAt || null,
        startsAt: null,
        endsAt: null,
        idempotencyKey: rawIdempotencyKey,
        holdLedgerId: holdEntry.id,
        createdAt: now,
        updatedAt: now,
      };
      db.featuredRequests.unshift(record);

      // Notify platform admin
      const adminUser = findPlatformAdminUser(db);
      if (adminUser) {
        if (!db.userNotifications) db.userNotifications = [];
        db.userNotifications.unshift({
          id: `notif_admin_feat_${reqId}`,
          userId: adminUser.id,
          title: 'New Featured Placement Pending Review',
          message: `${merchantUser.shopName || merchantUser.name} paid KSh ${finalKes.toLocaleString()} (held) to feature "${product.title}" for ${parsed.data.durationDays} days.`,
          link: '/admin-dashboard',
          type: 'system',
          read: false,
          timestamp: now,
        });
      }

      logAudit(
        db,
        user.id,
        merchantUser.name,
        'FEATURED_REQUEST_SUBMITTED',
        `Submitted featured request #${reqId} for "${product.title}" (${parsed.data.durationDays}d, held KSh ${finalKes})`
      );

      return {
        deduplicated: false,
        request: enrichFeaturedRequest(db, record, now),
        walletBalanceKes: fromCents(wallet.balanceCents),
        limits: getMerchantLimits(db, user.id, now),
      };
    });

    emitPlatformEvent('featured.request.submitted', {
      request: outcome.request,
      merchantId: user.id,
    });

    return res.status(outcome.deduplicated ? 200 : 201).json({
      success: true,
      ...outcome,
      message: outcome.deduplicated
        ? 'Featured request already received (duplicate prevented).'
        : `Featured request submitted! KSh ${outcome.request.amountPaidKes.toLocaleString()} held in escrow pending Admin approval.`,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'FEATURED_REQUEST_ERROR',
      err.message || 'Failed to submit featured placement request.'
    );
  }
});

featuredRouter.post('/merchant/featured/:id/cancel', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can cancel featured requests');
  }

  const reqId = String(req.params.id || '').trim();
  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const target = (db.featuredRequests || []).find((r) => r.id === reqId);
      if (!target) {
        throw { status: 404, code: 'FEATURED_NOT_FOUND', message: 'Featured request not found.' };
      }
      if (target.merchantId !== user.id && !isUserAdmin(user)) {
        throw { status: 403, code: 'FORBIDDEN_OWNERSHIP', message: 'You cannot cancel another merchant’s featured request.' };
      }
      if (target.status !== 'PENDING_APPROVAL') {
        throw {
          status: 409,
          code: 'CANNOT_CANCEL_NON_PENDING',
          message: `Only pending featured requests can be cancelled & refunded (current status: ${target.status}).`,
        };
      }

      const product = (db.products || []).find((p) => p.id === target.productId);
      const refundNote = `Refund of held Featured Placement fee: "${product?.title || `#${target.productId}`}" (${target.durationDays}d)`;
      refundFeaturedRequestInTx(db, target, target.amountPaidCents, refundNote, user.id);

      target.status = 'CANCELLED';
      target.cancelledAt = now;
      target.updatedAt = now;

      logAudit(
        db,
        user.id,
        user.name,
        'FEATURED_REQUEST_CANCELLED',
        `Merchant cancelled pending featured request #${target.id}; refunded KSh ${fromCents(target.amountPaidCents)}`
      );

      const merchantUser = db.users.find((u) => u.id === target.merchantId)!;
      return {
        request: enrichFeaturedRequest(db, target, now),
        walletBalanceKes: fromCents(getWalletBalanceCents(db, merchantUser, 'merchant')),
      };
    });

    emitPlatformEvent('featured.updated', { id: reqId, status: 'CANCELLED' });
    return res.json({
      success: true,
      ...outcome,
      message: `Featured request cancelled and KSh ${outcome.request.refundedKes.toLocaleString()} refunded to your merchant wallet.`,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'FEATURED_CANCEL_ERROR',
      err.message || 'Failed to cancel featured request.'
    );
  }
});

featuredRouter.get('/merchant/featured/:id/stats', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Merchant or admin role required');
  }

  const db = await getDatabase();
  const reqId = String(req.params.id || '').trim();
  const target = (db.featuredRequests || []).find((r) => r.id === reqId);
  if (!target) {
    return sendApiError(res, 404, 'FEATURED_NOT_FOUND', 'Featured request not found.');
  }
  if (target.merchantId !== user.id && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN_OWNERSHIP', 'Access denied to another merchant’s featured stats.');
  }

  return res.json({
    request: enrichFeaturedRequest(db, target),
    stats: summarizeFeaturedRequestStats(db, target.id),
  });
});

// ======================================================================
// 3. ADMIN FEATURED MODERATION & SETTINGS
// ======================================================================

featuredRouter.get('/admin/featured', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  await sweepFeaturedPlacements();
  const db = await getDatabase();
  const now = Date.now();
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.toUpperCase().trim() : 'ALL';
  const placementFilter = typeof req.query.placement === 'string' ? req.query.placement.trim() : '';
  const merchantIdFilter = req.query.merchantId ? Number(req.query.merchantId) : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const { page, limit } = parsePaginationQuery(req.query, 20, 100);

  const allReqs = db.featuredRequests || [];
  const counts = {
    ALL: allReqs.length,
    PENDING_APPROVAL: allReqs.filter((r) => r.status === 'PENDING_APPROVAL').length,
    APPROVED: allReqs.filter((r) => r.status === 'APPROVED').length,
    ACTIVE: allReqs.filter((r) => r.status === 'ACTIVE').length,
    EXPIRED: allReqs.filter((r) => r.status === 'EXPIRED').length,
    REJECTED: allReqs.filter((r) => r.status === 'REJECTED').length,
    CANCELLED: allReqs.filter((r) => r.status === 'CANCELLED').length,
    REMOVED: allReqs.filter((r) => r.status === 'REMOVED').length,
  };

  let filtered = allReqs.map((r) => enrichFeaturedRequest(db, r, now));
  if (statusFilter && statusFilter !== 'ALL') {
    filtered = filtered.filter((r) => r.status === statusFilter);
  }
  if (placementFilter) {
    filtered = filtered.filter((r) => r.placementKey === placementFilter);
  }
  if (merchantIdFilter) {
    filtered = filtered.filter((r) => r.merchantId === merchantIdFilter);
  }
  if (search) {
    filtered = filtered.filter((r) =>
      `${r.id} ${r.product?.title || ''} ${r.merchant?.name || ''} ${r.merchant?.shopName || ''} ${r.status}`
        .toLowerCase()
        .includes(search)
    );
  }

  filtered.sort((a, b) => b.createdAt - a.createdAt);
  const paged = paginateList(filtered, page, limit);

  const settings = getFeaturedSettings(db);
  const placements = getFeaturedPlacements(db);
  const pricing = getFeaturedPricingList(db).map((p) => ({
    ...p,
    priceKes: fromCents(p.priceCents),
  }));
  const tierLimits = SUBSCRIPTION_PLANS.map((plan) => ({
    ...getTierFeaturedLimits(db, plan.id),
    tierName: plan.name,
  }));

  return res.json({
    requests: paged.items,
    pagination: paged.pagination,
    counts,
    settings,
    placements,
    pricing,
    tierLimits,
  });
});

featuredRouter.post('/admin/featured/:id/approve', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const reqId = String(req.params.id || '').trim();
  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      sweepFeaturedPlacementsInTx(db, now);
      const target = (db.featuredRequests || []).find((r) => r.id === reqId);
      if (!target) {
        throw { status: 404, code: 'FEATURED_NOT_FOUND', message: 'Featured request not found.' };
      }

      const resAppr = approveFeaturedRequestInTx(db, {
        req: target,
        adminUser: admin,
        getMerchantLimitsFn: (innerDb, mId) => getMerchantLimits(innerDb, mId, now),
        now,
      });

      return {
        alreadyProcessed: resAppr.alreadyProcessed,
        request: enrichFeaturedRequest(db, resAppr.req, now),
        outboxEvent: resAppr.outboxEvent,
      };
    });

    if (!outcome.alreadyProcessed) {
      if (outcome.outboxEvent) {
        flushOutboxEvents([outcome.outboxEvent]);
      }
      emitPlatformEvent('featured.updated', { id: reqId, status: outcome.request.status });
    }

    return res.json({
      success: true,
      ...outcome,
      message: outcome.alreadyProcessed
        ? `Featured request is already ${outcome.request.status}.`
        : outcome.request.status === 'ACTIVE'
        ? `Approved! "${outcome.request.product?.title}" is now ACTIVE in Featured until ${outcome.request.endsAtEat} (EAT).`
        : `Approved and scheduled for ${outcome.request.startsAtEat} (EAT) when a slot opens.`,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'FEATURED_APPROVE_ERROR',
      err.message || 'Failed to approve featured request.'
    );
  }
});

const BulkApproveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
});

featuredRouter.post('/admin/featured/bulk-approve', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = BulkApproveSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const outcome = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    sweepFeaturedPlacementsInTx(db, now);
    const approvedIds: string[] = [];
    const failed: Array<{ id: string; code: string; message: string }> = [];
    const outboxEvents: any[] = [];

    for (const id of parsed.data.ids) {
      const target = (db.featuredRequests || []).find((r) => r.id === id);
      if (!target) {
        failed.push({ id, code: 'FEATURED_NOT_FOUND', message: 'Not found' });
        continue;
      }
      try {
        const resAppr = approveFeaturedRequestInTx(db, {
          req: target,
          adminUser: admin,
          getMerchantLimitsFn: (innerDb, mId) => getMerchantLimits(innerDb, mId, now),
          now,
        });
        if (resAppr.outboxEvent) outboxEvents.push(resAppr.outboxEvent);
        approvedIds.push(id);
      } catch (err: any) {
        failed.push({
          id,
          code: err.code || 'APPROVE_FAILED',
          message: err.message || 'Failed to approve',
        });
      }
    }

    return { approvedIds, failed, outboxEvents };
  });

  if (outcome.outboxEvents.length > 0) {
    flushOutboxEvents(outcome.outboxEvents);
  }
  if (outcome.approvedIds.length > 0) {
    emitPlatformEvent('featured.updated', { bulkApprovedIds: outcome.approvedIds });
  }

  return res.json({
    success: true,
    ...outcome,
    message: `Approved ${outcome.approvedIds.length} request(s)${outcome.failed.length > 0 ? `, ${outcome.failed.length} skipped` : ''}.`,
  });
});

const ReasonBodySchema = z.object({
  reason: z.string().trim().min(3, 'A clear moderation reason (at least 3 characters) is required.').max(500),
});

featuredRouter.post('/admin/featured/:id/reject', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = ReasonBodySchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const reqId = String(req.params.id || '').trim();
  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const target = (db.featuredRequests || []).find((r) => r.id === reqId);
      if (!target) {
        throw { status: 404, code: 'FEATURED_NOT_FOUND', message: 'Featured request not found.' };
      }
      if (target.status === 'REJECTED') {
        return { alreadyProcessed: true, request: enrichFeaturedRequest(db, target, now) };
      }
      if (target.status !== 'PENDING_APPROVAL') {
        throw {
          status: 409,
          code: 'INVALID_FEATURED_STATE',
          message: `Cannot reject featured request in status "${target.status}".`,
        };
      }

      const product = (db.products || []).find((p) => p.id === target.productId);
      const refundNote = `Rejected Featured Request #${target.id} ("${product?.title || `#${target.productId}`}"): ${parsed.data.reason}`;
      refundFeaturedRequestInTx(db, target, target.amountPaidCents, refundNote, admin.id);

      target.status = 'REJECTED';
      target.rejectedAt = now;
      target.rejectedBy = admin.id;
      target.rejectionReason = parsed.data.reason;
      target.updatedAt = now;

      const outboxEvent = enqueueOutboxInTx(db, {
        userId: target.merchantId,
        eventType: 'featured.updated',
        entityType: 'featured',
        entityId: target.id,
        title: 'Featured Request Rejected (Refunded)',
        message: `Your featured placement request for "${product?.title || `#${target.productId}`}" was rejected. Reason: ${parsed.data.reason}. KSh ${fromCents(target.amountPaidCents).toLocaleString()} has been refunded to your merchant wallet.`,
        notificationType: 'system',
        link: '/vendor-dashboard',
        payload: { id: target.id, status: 'REJECTED', reason: parsed.data.reason },
        alsoAddNotification: true,
        now,
      });

      logAudit(
        db,
        admin.id,
        admin.name,
        'FEATURED_REQUEST_REJECTED',
        `Rejected featured request #${target.id} for "${product?.title || `#${target.productId}`}" (Reason: ${parsed.data.reason}); refunded KSh ${fromCents(target.amountPaidCents)}`
      );

      return { alreadyProcessed: false, request: enrichFeaturedRequest(db, target, now), outboxEvent };
    });

    if (outcome.outboxEvent) {
      flushOutboxEvents([outcome.outboxEvent]);
    }
    emitPlatformEvent('featured.updated', { id: reqId, status: 'REJECTED' });
    return res.json({
      success: true,
      request: outcome.request,
      alreadyProcessed: outcome.alreadyProcessed,
      message: `Featured request rejected and KSh ${outcome.request.refundedKes.toLocaleString()} refunded to merchant wallet.`,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'FEATURED_REJECT_ERROR',
      err.message || 'Failed to reject featured request.'
    );
  }
});

featuredRouter.post('/admin/featured/:id/remove', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = ReasonBodySchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const reqId = String(req.params.id || '').trim();
  try {
    const outcome = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const target = (db.featuredRequests || []).find((r) => r.id === reqId);
      if (!target) {
        throw { status: 404, code: 'FEATURED_NOT_FOUND', message: 'Featured request not found.' };
      }
      if (target.status === 'REMOVED') {
        return { alreadyProcessed: true, request: enrichFeaturedRequest(db, target, now) };
      }
      if (!['ACTIVE', 'APPROVED', 'PENDING_APPROVAL'].includes(target.status)) {
        throw {
          status: 409,
          code: 'INVALID_FEATURED_STATE',
          message: `Cannot take down placement in status "${target.status}".`,
        };
      }

      const prevStatus = target.status;
      const settings = getFeaturedSettings(db);
      const product = (db.products || []).find((p) => p.id === target.productId);

      let refundCents = 0;
      if (prevStatus === 'PENDING_APPROVAL') {
        refundCents = target.amountPaidCents;
      } else if (settings.takedownRefundMode === 'prorata' && target.startsAt && target.endsAt && target.endsAt > now) {
        const totalDurationMs = Math.max(1, target.endsAt - target.startsAt);
        const remainingMs = Math.min(totalDurationMs, target.endsAt - now);
        refundCents = Math.round((target.amountPaidCents * remainingMs) / totalDurationMs);
      }

      if (refundCents > 0) {
        refundFeaturedRequestInTx(
          db,
          target,
          refundCents,
          `Takedown refund (${settings.takedownRefundMode}) for Featured #${target.id}: ${parsed.data.reason}`,
          admin.id
        );
      }

      target.status = 'REMOVED';
      target.removedAt = now;
      target.removedBy = admin.id;
      target.removalReason = parsed.data.reason;
      target.updatedAt = now;

      sweepFeaturedPlacementsInTx(db, now);

      const outboxEvent = enqueueOutboxInTx(db, {
        userId: target.merchantId,
        eventType: 'featured.updated',
        entityType: 'featured',
        entityId: target.id,
        title: 'Featured Placement Removed by Moderation',
        message: `Your featured placement for "${product?.title || `#${target.productId}`}" was removed by Admin. Reason: ${parsed.data.reason}.${refundCents > 0 ? ` Refunded KSh ${fromCents(refundCents).toLocaleString()} to your wallet.` : ''}`,
        notificationType: 'system',
        link: '/vendor-dashboard',
        payload: { id: target.id, status: 'REMOVED', reason: parsed.data.reason, refundedCents: refundCents },
        alsoAddNotification: true,
        now,
      });

      logAudit(
        db,
        admin.id,
        admin.name,
        'FEATURED_PLACEMENT_REMOVED',
        `Removed featured placement #${target.id} (prev=${prevStatus}, reason="${parsed.data.reason}", refundMode=${settings.takedownRefundMode}, refundedCents=${refundCents})`
      );

      return { alreadyProcessed: false, request: enrichFeaturedRequest(db, target, now), outboxEvent };
    });

    if (outcome.outboxEvent) {
      flushOutboxEvents([outcome.outboxEvent]);
    }
    emitPlatformEvent('featured.updated', { id: reqId, status: 'REMOVED' });
    return res.json({
      success: true,
      request: outcome.request,
      alreadyProcessed: outcome.alreadyProcessed,
      message: `Featured placement removed${outcome.request.refundedKes > 0 ? ` and KSh ${outcome.request.refundedKes.toLocaleString()} refunded` : ''}.`,
    });
  } catch (err: any) {
    return sendApiError(
      res,
      err.status || 500,
      err.code || 'FEATURED_REMOVE_ERROR',
      err.message || 'Failed to remove featured placement.'
    );
  }
});

featuredRouter.get('/admin/featured/settings', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const db = await getDatabase();
  return res.json({
    settings: getFeaturedSettings(db),
    placements: getFeaturedPlacements(db),
    pricing: getFeaturedPricingList(db).map((p) => ({
      ...p,
      priceKes: fromCents(p.priceCents),
    })),
    tierLimits: SUBSCRIPTION_PLANS.map((plan) => ({
      ...getTierFeaturedLimits(db, plan.id),
      tierName: plan.name,
    })),
  });
});

const UpdateSettingsSchema = z.object({
  settings: z
    .object({
      featuredRequiresGroup: z.boolean().optional(),
      takedownRefundMode: z.enum(['none', 'prorata']).optional(),
      extendOnSubExpiry: z.boolean().optional(),
      defaultMaxDays: z.coerce.number().int().min(1).max(365).optional(),
      allowedDurations: z.array(z.coerce.number().int().min(1).max(365)).min(1).optional(),
    })
    .optional(),
  placements: z
    .array(
      z.object({
        key: z.string().min(1).max(80),
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(400).optional(),
        maxSlots: z.coerce.number().int().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .optional(),
  pricing: z
    .array(
      z.object({
        placementKey: z.string().min(1).max(80),
        durationDays: z.coerce.number().int().min(1).max(365),
        priceKes: z.coerce.number().positive().max(1000000).optional(),
        priceCents: z.coerce.number().int().positive().max(100000000).optional(),
        active: z.boolean().optional(),
      })
    )
    .optional(),
  tierLimits: z
    .array(
      z.object({
        tierId: z.string().min(1),
        maxActiveFeatured: z.coerce.number().int().min(-1).max(500).optional(),
        maxPendingFeatured: z.coerce.number().int().min(-1).max(500).optional(),
        maxFeaturedDaysPerRequest: z.coerce.number().int().min(1).max(365).optional(),
        allowedDurations: z.array(z.coerce.number().int().min(1).max(365)).min(1).optional(),
        allowedPlacements: z.array(z.string().min(1)).optional(),
        featuredDiscountPercent: z.coerce.number().min(0).max(90).optional(),
      })
    )
    .optional(),
});

featuredRouter.put('/admin/featured/settings', async (req: Request, res: Response) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const parsed = UpdateSettingsSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const before = {
      settings: getFeaturedSettings(db),
      placements: getFeaturedPlacements(db),
      pricingCount: (db.featuredPricing || []).length,
    };

    if (parsed.data.settings) {
      const current = getFeaturedSettings(db);
      db.featuredSettings = {
        ...current,
        ...parsed.data.settings,
        allowedDurations: parsed.data.settings.allowedDurations
          ? Array.from(new Set(parsed.data.settings.allowedDurations)).sort((a, b) => a - b)
          : current.allowedDurations,
        updatedAt: now,
      };
    }

    if (parsed.data.placements) {
      if (!db.featuredPlacements || db.featuredPlacements.length === 0) {
        db.featuredPlacements = getFeaturedPlacements(db);
      }
      for (const patch of parsed.data.placements) {
        const pl = db.featuredPlacements.find((p) => p.key === patch.key);
        if (pl) {
          if (patch.name !== undefined) pl.name = patch.name;
          if (patch.description !== undefined) pl.description = patch.description;
          if (patch.maxSlots !== undefined) pl.maxSlots = patch.maxSlots;
          if (patch.enabled !== undefined) pl.enabled = patch.enabled;
          pl.updatedAt = now;
        }
      }
    }

    if (parsed.data.pricing) {
      if (!db.featuredPricing || db.featuredPricing.length === 0) {
        db.featuredPricing = getFeaturedPricingList(db);
      }
      for (const item of parsed.data.pricing) {
        const nextCents =
          item.priceCents !== undefined
            ? item.priceCents
            : item.priceKes !== undefined
            ? toCents(item.priceKes)
            : undefined;
        let row = db.featuredPricing.find(
          (p) => p.placementKey === item.placementKey && p.durationDays === item.durationDays
        );
        if (!row && nextCents !== undefined) {
          row = {
            id: `fpr_${item.placementKey}_${item.durationDays}`,
            placementKey: item.placementKey,
            durationDays: item.durationDays,
            priceCents: nextCents,
            currency: 'KES',
            active: item.active !== undefined ? item.active : true,
            updatedAt: now,
          };
          db.featuredPricing.push(row);
        } else if (row) {
          if (nextCents !== undefined) row.priceCents = nextCents;
          if (item.active !== undefined) row.active = item.active;
          row.updatedAt = now;
        }
      }
    }

    if (parsed.data.tierLimits) {
      if (!db.tierFeaturedLimits) db.tierFeaturedLimits = {};
      for (const ov of parsed.data.tierLimits) {
        const current = getTierFeaturedLimits(db, ov.tierId);
        db.tierFeaturedLimits[ov.tierId] = {
          ...current,
          ...ov,
          allowedDurations: ov.allowedDurations
            ? Array.from(new Set(ov.allowedDurations)).sort((a, b) => a - b)
            : current.allowedDurations,
          updatedAt: now,
        };
      }
    }

    logAudit(
      db,
      admin.id,
      admin.name,
      'FEATURED_SETTINGS_UPDATED',
      `Updated Featured moderation settings (before maxSlots=${before.placements[0]?.maxSlots}, requiresGroup=${before.settings.featuredRequiresGroup}, after requiresGroup=${db.featuredSettings?.featuredRequiresGroup})`
    );

    return {
      settings: getFeaturedSettings(db),
      placements: getFeaturedPlacements(db),
      pricing: getFeaturedPricingList(db).map((p) => ({
        ...p,
        priceKes: fromCents(p.priceCents),
      })),
      tierLimits: SUBSCRIPTION_PLANS.map((plan) => ({
        ...getTierFeaturedLimits(db, plan.id),
        tierName: plan.name,
      })),
    };
  });

  emitPlatformEvent('featured.updated', { settingsUpdated: true });
  return res.json({ success: true, ...result, message: 'Featured placement settings & pricing saved.' });
});
