import crypto from 'crypto';
import type { DatabaseSchema } from './db.js';
import { logAudit, runDatabaseTransaction } from './db.js';
import {
  FEATURED_ALLOWED_DURATIONS,
  FEATURED_EXPIRY_SWEEP_MS,
  FEATURED_MAX_DAYS,
  FEATURED_REQUIRES_GROUP,
  FEATURED_TAKEDOWN_REFUND_MODE,
  fromCents,
  getEatDateParts,
} from './config.js';
import {
  creditWalletCents,
  debitWalletCents,
  findPlatformAdminUser,
} from './wallet_service.js';
import { emitPlatformEvent } from './events.js';
import { recordIncomeInTx } from './admin_wallet_service.js';
import { enqueueOutboxInTx } from './outbox_service.js';
import type {
  ChamaGroup,
  FeaturedPlacement,
  FeaturedPricing,
  FeaturedRequest,
  FeaturedSettings,
  FeaturedStatsDaily,
  Product,
  TierFeaturedLimits,
  User,
} from '../src/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FEATURED_PLACEMENTS: FeaturedPlacement[] = [
  {
    key: 'homepage_featured',
    name: 'Homepage Featured Hero',
    description: 'Top showcase carousel rotating right-to-left across the Buyoll Marketplace.',
    maxSlots: 10,
    enabled: true,
    sortOrder: 1,
  },
];

// Configurable pricing defaults in integer cents (KES * 100) for allowed fixed durations
export const DEFAULT_FEATURED_PRICING: FeaturedPricing[] = [
  { id: 'fpr_home_1', placementKey: 'homepage_featured', durationDays: 1, priceCents: 5000, currency: 'KES', active: true },
  { id: 'fpr_home_2', placementKey: 'homepage_featured', durationDays: 2, priceCents: 9000, currency: 'KES', active: true },
  { id: 'fpr_home_3', placementKey: 'homepage_featured', durationDays: 3, priceCents: 13000, currency: 'KES', active: true },
  { id: 'fpr_home_4', placementKey: 'homepage_featured', durationDays: 4, priceCents: 17000, currency: 'KES', active: true },
  { id: 'fpr_home_5', placementKey: 'homepage_featured', durationDays: 5, priceCents: 20000, currency: 'KES', active: true },
  { id: 'fpr_home_6', placementKey: 'homepage_featured', durationDays: 6, priceCents: 23000, currency: 'KES', active: true },
  { id: 'fpr_home_7', placementKey: 'homepage_featured', durationDays: 7, priceCents: 25000, currency: 'KES', active: true },
  { id: 'fpr_home_30', placementKey: 'homepage_featured', durationDays: 30, priceCents: 50000, currency: 'KES', active: true },
];

export const DEFAULT_TIER_FEATURED_LIMITS: Record<string, TierFeaturedLimits> = {
  tier_250: {
    tierId: 'tier_250',
    maxActiveFeatured: 1,
    maxPendingFeatured: 1,
    maxFeaturedDaysPerRequest: 7,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 0,
  },
  tier_500: {
    tierId: 'tier_500',
    maxActiveFeatured: 2,
    maxPendingFeatured: 2,
    maxFeaturedDaysPerRequest: 7,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 0,
  },
  tier_1500: {
    tierId: 'tier_1500',
    maxActiveFeatured: 3,
    maxPendingFeatured: 2,
    maxFeaturedDaysPerRequest: 7,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 5,
  },
  tier_3500: {
    tierId: 'tier_3500',
    maxActiveFeatured: 5,
    maxPendingFeatured: 4,
    maxFeaturedDaysPerRequest: 30,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7, 30],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 10,
  },
  tier_7500: {
    tierId: 'tier_7500',
    maxActiveFeatured: 10,
    maxPendingFeatured: 6,
    maxFeaturedDaysPerRequest: 30,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7, 30],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 15,
  },
  enterprise: {
    tierId: 'enterprise',
    maxActiveFeatured: 20,
    maxPendingFeatured: 10,
    maxFeaturedDaysPerRequest: 30,
    allowedDurations: [1, 2, 3, 4, 5, 6, 7, 30],
    allowedPlacements: ['homepage_featured'],
    featuredDiscountPercent: 20,
  },
};

export function getFeaturedSettings(db: DatabaseSchema): FeaturedSettings {
  const s = db.featuredSettings;
  return {
    featuredRequiresGroup: s?.featuredRequiresGroup ?? FEATURED_REQUIRES_GROUP,
    takedownRefundMode: s?.takedownRefundMode || FEATURED_TAKEDOWN_REFUND_MODE,
    extendOnSubExpiry: s?.extendOnSubExpiry ?? false,
    defaultMaxDays: s?.defaultMaxDays ?? FEATURED_MAX_DAYS,
    allowedDurations:
      Array.isArray(s?.allowedDurations) && s!.allowedDurations.length > 0
        ? s!.allowedDurations
        : FEATURED_ALLOWED_DURATIONS,
    expirySweepMs: s?.expirySweepMs ?? FEATURED_EXPIRY_SWEEP_MS,
    updatedAt: s?.updatedAt,
  };
}

export function getTierFeaturedLimits(db: DatabaseSchema | undefined, tierId: string): TierFeaturedLimits {
  const fallback = DEFAULT_TIER_FEATURED_LIMITS[tierId] || DEFAULT_TIER_FEATURED_LIMITS.tier_250;
  const override = db?.tierFeaturedLimits?.[tierId];
  if (!override) return { ...fallback };
  return {
    tierId,
    maxActiveFeatured:
      typeof override.maxActiveFeatured === 'number' ? override.maxActiveFeatured : fallback.maxActiveFeatured,
    maxPendingFeatured:
      typeof override.maxPendingFeatured === 'number' ? override.maxPendingFeatured : fallback.maxPendingFeatured,
    maxFeaturedDaysPerRequest:
      typeof override.maxFeaturedDaysPerRequest === 'number'
        ? override.maxFeaturedDaysPerRequest
        : fallback.maxFeaturedDaysPerRequest,
    allowedDurations:
      Array.isArray(override.allowedDurations) && override.allowedDurations.length > 0
        ? override.allowedDurations
        : fallback.allowedDurations,
    allowedPlacements:
      Array.isArray(override.allowedPlacements) && override.allowedPlacements.length > 0
        ? override.allowedPlacements
        : fallback.allowedPlacements,
    featuredDiscountPercent:
      typeof override.featuredDiscountPercent === 'number'
        ? Math.max(0, Math.min(90, override.featuredDiscountPercent))
        : fallback.featuredDiscountPercent,
    updatedAt: override.updatedAt,
  };
}

export function getFeaturedPlacements(db: DatabaseSchema): FeaturedPlacement[] {
  if (!db.featuredPlacements || db.featuredPlacements.length === 0) {
    return DEFAULT_FEATURED_PLACEMENTS.map((p) => ({ ...p }));
  }
  return [...db.featuredPlacements].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getFeaturedPricingList(db: DatabaseSchema): FeaturedPricing[] {
  if (!db.featuredPricing || db.featuredPricing.length === 0) {
    return DEFAULT_FEATURED_PRICING.map((p) => ({ ...p }));
  }
  return [...db.featuredPricing].sort((a, b) => a.durationDays - b.durationDays);
}

export function isProductPublishedAndLive(product: Product | undefined): boolean {
  if (!product) return false;
  if (product.status === 'DRAFT' || product.status === 'ARCHIVED') return false;
  if (product.publicationStatus === 'draft' || product.live === false) return false;
  if (product.hiddenReason === 'SUBSCRIPTION_EXPIRED' || product.hiddenReason === 'ADMIN_REMOVED') return false;
  if (product.moderationStatus !== 'approved') return false;
  return true;
}

export function getEligibleGroupsForProduct(db: DatabaseSchema, productId: number): ChamaGroup[] {
  return (db.groups || []).filter(
    (g) => g.productId === productId && g.status !== 'cancelled' && (g.status === 'active' || g.status === 'full')
  );
}

export function isProductEligibleForFeatured(
  db: DatabaseSchema,
  product: Product | undefined,
  settings = getFeaturedSettings(db)
): { eligible: boolean; code?: string; reason?: string; groupCount: number } {
  if (!product) {
    return { eligible: false, code: 'PRODUCT_NOT_FOUND', reason: 'Product does not exist.', groupCount: 0 };
  }
  if (!isProductPublishedAndLive(product)) {
    return {
      eligible: false,
      code: 'PRODUCT_NOT_PUBLISHED',
      reason: 'Product must be published and live before it can be featured.',
      groupCount: 0,
    };
  }
  const merchant = (db.users || []).find((u) => u.id === product.vendorId);
  if (!merchant || merchant.isDisabled || merchant.isSuspended) {
    return {
      eligible: false,
      code: 'MERCHANT_INACTIVE',
      reason: 'Merchant account is inactive or suspended.',
      groupCount: 0,
    };
  }
  const groups = getEligibleGroupsForProduct(db, product.id);
  if (settings.featuredRequiresGroup && groups.length === 0) {
    return {
      eligible: false,
      code: 'GROUPS_REQUIRED',
      reason: 'Create at least one group inside this product in My Groups before featuring it.',
      groupCount: 0,
    };
  }
  return { eligible: true, groupCount: groups.length };
}

/**
 * Ensures a published/featured product has at most ONE idempotent system announcement entry
 * without duplicating or mutating its createdAt timestamp.
 */
export function ensureProductInAnnouncementsInTx(
  db: DatabaseSchema,
  product: Product,
  merchant?: User | null,
  groups?: ChamaGroup[],
  options?: { isFeaturedBadge?: boolean }
): boolean {
  if (!db.announcements) db.announcements = [];
  if (!db.nextIds.announcement) db.nextIds.announcement = (db.announcements.length || 0) + 1;

  const existing = db.announcements.find(
    (a) =>
      Number(a.productId) === product.id ||
      (a.isSystemGenerated && a.authorId === product.vendorId && a.title.includes(product.title))
  );

  if (existing) {
    let mutated = false;
    if (!existing.productId) {
      existing.productId = product.id;
      mutated = true;
    }
    if (options?.isFeaturedBadge !== undefined && existing.isFeaturedBadge !== options.isFeaturedBadge) {
      existing.isFeaturedBadge = options.isFeaturedBadge;
      mutated = true;
    }
    return mutated;
  }

  const prodGroups = groups || getEligibleGroupsForProduct(db, product.id);
  const speedsSummary = prodGroups.length > 0 ? prodGroups.map((g) => `${g.size}-member`).join(', ') : '1-10 member';
  const shopLabel = merchant?.shopName || merchant?.name || product.vendorName;
  const createdAt = product.publishedAt || product.createdAt || Date.now();

  db.announcements.unshift({
    id: db.nextIds.announcement++,
    productId: product.id,
    isSystemGenerated: true,
    isFeaturedBadge: Boolean(options?.isFeaturedBadge),
    title: `New Group Open: ${product.title}`,
    body: `${shopLabel} posted "${product.title}" with ${prodGroups.length} open group(s) (${speedsSummary}). Browse or join a group today.`,
    imageUrl: product.images?.[0],
    category: product.category || 'Product Announcements',
    type: 'ANNOUNCEMENT',
    audience: 'ALL',
    status: 'PUBLISHED',
    pinned: false,
    publishedAt: createdAt,
    createdAt,
    authorId: product.vendorId,
    authorName: shopLabel,
  });

  return true;
}

export function isBotUserAgent(userAgent?: string): boolean {
  if (!userAgent) return false;
  return /\b(googlebot|bingbot|yandexbot|baiduspider|duckduckbot|slurp|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|headlesschrome|phantomjs|selenium|webdriver)\b/i.test(
    userAgent
  );
}

/**
 * Transitions APPROVED -> ACTIVE and ACTIVE -> EXPIRED based strictly on UTC timestamps,
 * syncs Product.isFeatured cache flags, and sends deduplicated 1-day-left / expired notices.
 */
export function sweepFeaturedPlacementsInTx(
  db: DatabaseSchema,
  now = Date.now()
): { activatedIds: string[]; expiredIds: string[]; changed: boolean } {
  if (!db.featuredRequests) db.featuredRequests = [];
  if (!db.userNotifications) db.userNotifications = [];

  const activatedIds: string[] = [];
  const expiredIds: string[] = [];
  let changed = false;

  // 1. Expire strictly whenever now >= endsAt
  for (const req of db.featuredRequests) {
    if (req.status === 'ACTIVE' && req.endsAt && now >= req.endsAt) {
      req.status = 'EXPIRED';
      req.updatedAt = now;
      expiredIds.push(req.id);
      changed = true;
    } else if (req.status === 'APPROVED' && req.endsAt && now >= req.endsAt) {
      req.status = 'EXPIRED';
      req.updatedAt = now;
      expiredIds.push(req.id);
      changed = true;
    }
  }

  // 2. Promote APPROVED -> ACTIVE when startsAt <= now and placement slot capacity permits
  const placements = getFeaturedPlacements(db);
  const maxSlotsByKey = new Map<string, number>();
  for (const pl of placements) {
    maxSlotsByKey.set(pl.key, pl.maxSlots);
  }

  const activeCountByKey = new Map<string, number>();
  for (const req of db.featuredRequests) {
    if (req.status === 'ACTIVE') {
      activeCountByKey.set(req.placementKey, (activeCountByKey.get(req.placementKey) || 0) + 1);
    }
  }

  const readyToActivate = db.featuredRequests
    .filter((r) => r.status === 'APPROVED' && r.startsAt && r.startsAt <= now && (!r.endsAt || r.endsAt > now))
    .sort((a, b) => (a.startsAt || a.createdAt) - (b.startsAt || b.createdAt));

  for (const req of readyToActivate) {
    const cap = maxSlotsByKey.get(req.placementKey) ?? 10;
    const current = activeCountByKey.get(req.placementKey) || 0;
    if (current < cap) {
      req.status = 'ACTIVE';
      req.updatedAt = now;
      activeCountByKey.set(req.placementKey, current + 1);
      activatedIds.push(req.id);
      changed = true;
    }
  }

  // 3. Send deduplicated 1-day-left and expired notifications
  const settings = getFeaturedSettings(db);
  const productById = new Map<number, Product>();
  for (const p of db.products || []) productById.set(p.id, p);

  for (const req of db.featuredRequests) {
    const prod = productById.get(req.productId);
    const prodLabel = prod?.title || `Product #${req.productId}`;
    if (
      req.status === 'ACTIVE' &&
      !req.expiryWarnedAt &&
      req.endsAt &&
      req.endsAt - now > 0 &&
      req.endsAt - now <= DAY_MS
    ) {
      req.expiryWarnedAt = now;
      const endsEat = getEatDateParts(req.endsAt).dateKey;
      db.userNotifications.unshift({
        id: `notif_feat_warn_${req.id}`,
        userId: req.merchantId,
        title: 'Featured Placement Expiring Soon',
        message: `Your featured placement for "${prodLabel}" expires within 24 hours (${endsEat} EAT). Renew anytime from My Featured.`,
        link: '/vendor-dashboard',
        type: 'system',
        read: false,
        timestamp: now,
      });
      changed = true;
    }

    if (req.status === 'EXPIRED' && !req.expiredNotifiedAt) {
      req.expiredNotifiedAt = now;
      db.userNotifications.unshift({
        id: `notif_feat_exp_${req.id}`,
        userId: req.merchantId,
        title: 'Featured Placement Ended',
        message: `Your ${req.durationDays}-day featured placement for "${prodLabel}" has ended. Renew placement in My Featured if you want another run.`,
        link: '/vendor-dashboard',
        type: 'system',
        read: false,
        timestamp: now,
      });
      changed = true;
    }
  }

  // 4. Synchronize cached Product.isFeatured flags strictly from active valid placements
  const activeByProductId = new Map<number, FeaturedRequest>();
  for (const req of db.featuredRequests) {
    if (
      req.status === 'ACTIVE' &&
      req.startsAt &&
      req.endsAt &&
      req.startsAt <= now &&
      now < req.endsAt
    ) {
      const prod = productById.get(req.productId);
      const elig = isProductEligibleForFeatured(db, prod, settings);
      if (elig.eligible) {
        activeByProductId.set(req.productId, req);
      }
    }
  }

  for (const p of db.products || []) {
    const activeReq = activeByProductId.get(p.id) || null;
    const shouldBeFeatured = Boolean(activeReq);
    if (Boolean(p.isFeatured) !== shouldBeFeatured) {
      p.isFeatured = shouldBeFeatured;
      changed = true;
    }
    if ((p.featuredRequestId || null) !== (activeReq?.id || null)) {
      p.featuredRequestId = activeReq?.id || null;
      p.featuredPlacementKey = activeReq?.placementKey || null;
      p.featuredEndsAt = activeReq?.endsAt || null;
      changed = true;
    }
  }

  // Sync Announcement badge flags idempotently without changing announcement ordering
  for (const ann of db.announcements || []) {
    if (ann.productId) {
      const activeBadge = activeByProductId.has(Number(ann.productId));
      if (Boolean(ann.isFeaturedBadge) !== activeBadge) {
        ann.isFeaturedBadge = activeBadge;
        changed = true;
      }
    }
  }

  return { activatedIds, expiredIds, changed };
}

export async function sweepFeaturedPlacements(now = Date.now()): Promise<{
  activatedIds: string[];
  expiredIds: string[];
  changed: boolean;
}> {
  const outcome = await runDatabaseTransaction(async (db) => {
    return sweepFeaturedPlacementsInTx(db, now);
  });

  if (outcome.changed) {
    emitPlatformEvent('featured.updated', {
      activatedIds: outcome.activatedIds,
      expiredIds: outcome.expiredIds,
      timestamp: now,
    });
  }

  return outcome;
}

export function computeFeaturedQuote(
  db: DatabaseSchema,
  tierLimits: TierFeaturedLimits,
  placementKey: string,
  durationDays: number
): {
  valid: boolean;
  status?: number;
  code?: string;
  message?: string;
  placement?: FeaturedPlacement;
  pricing?: FeaturedPricing;
  basePriceCents: number;
  discountPercent: number;
  finalPriceCents: number;
} {
  const settings = getFeaturedSettings(db);
  const placements = getFeaturedPlacements(db);
  const placement = placements.find((p) => p.key === placementKey);
  if (!placement || !placement.enabled) {
    return {
      valid: false,
      status: 400,
      code: 'INVALID_PLACEMENT',
      message: `Featured placement "${placementKey}" is unavailable.`,
      basePriceCents: 0,
      discountPercent: 0,
      finalPriceCents: 0,
    };
  }

  if (
    tierLimits.allowedPlacements.length > 0 &&
    !tierLimits.allowedPlacements.includes(placementKey)
  ) {
    return {
      valid: false,
      status: 403,
      code: 'PLACEMENT_NOT_ALLOWED_FOR_TIER',
      message: `Your current merchant tier does not allow placement "${placement.name}". Upgrade your plan to unlock it.`,
      basePriceCents: 0,
      discountPercent: 0,
      finalPriceCents: 0,
    };
  }

  const days = Number(durationDays);
  if (
    !Number.isInteger(days) ||
    days <= 0 ||
    days > settings.defaultMaxDays ||
    !settings.allowedDurations.includes(days)
  ) {
    return {
      valid: false,
      status: 400,
      code: 'INVALID_DURATION',
      message: `Invalid featured duration (${durationDays} days). Allowed durations: ${settings.allowedDurations.join(', ')} days (max ${settings.defaultMaxDays}).`,
      basePriceCents: 0,
      discountPercent: 0,
      finalPriceCents: 0,
    };
  }

  if (days > tierLimits.maxFeaturedDaysPerRequest || !tierLimits.allowedDurations.includes(days)) {
    return {
      valid: false,
      status: 403,
      code: 'DURATION_EXCEEDS_TIER_LIMIT',
      message: `Your merchant subscription tier allows up to ${tierLimits.maxFeaturedDaysPerRequest} days (${tierLimits.allowedDurations.join(', ')}d). Upgrade your plan to unlock ${days}-day featured placements.`,
      basePriceCents: 0,
      discountPercent: 0,
      finalPriceCents: 0,
    };
  }

  const pricing = getFeaturedPricingList(db).find(
    (p) => p.placementKey === placementKey && p.durationDays === days && p.active
  );
  if (!pricing || !Number.isInteger(pricing.priceCents) || pricing.priceCents <= 0) {
    return {
      valid: false,
      status: 400,
      code: 'PRICING_NOT_CONFIGURED',
      message: `Pricing is not configured for ${placement.name} (${days} days).`,
      basePriceCents: 0,
      discountPercent: 0,
      finalPriceCents: 0,
    };
  }

  const discountPercent = Math.max(0, Math.min(90, tierLimits.featuredDiscountPercent || 0));
  const finalPriceCents = Math.max(100, Math.round((pricing.priceCents * (100 - discountPercent)) / 100));

  return {
    valid: true,
    placement,
    pricing,
    basePriceCents: pricing.priceCents,
    discountPercent,
    finalPriceCents,
  };
}

/**
 * Computes next available start timestamp respecting placement maxSlots.
 */
export function resolveSlotStartTimestamp(
  db: DatabaseSchema,
  placementKey: string,
  maxSlots: number,
  requestedStartAt?: number | null,
  now = Date.now()
): number {
  const desiredStart = requestedStartAt && requestedStartAt > now ? requestedStartAt : now;
  const activeOrScheduled = (db.featuredRequests || []).filter(
    (r) =>
      r.placementKey === placementKey &&
      (r.status === 'ACTIVE' || r.status === 'APPROVED') &&
      r.startsAt &&
      r.endsAt &&
      r.endsAt > desiredStart &&
      r.startsAt <= desiredStart
  );

  if (activeOrScheduled.length < maxSlots) {
    return desiredStart;
  }

  // Schedule immediately after the earliest ending active slot
  const sortedEnds = activeOrScheduled
    .map((r) => r.endsAt || desiredStart)
    .sort((a, b) => a - b);
  return sortedEnds[0] || desiredStart;
}

/**
 * Returns strictly active paid featured listings within [startsAt, endsAt),
 * filtered for published/live product + active groups, and rotated fairly.
 */
export function getPublicFeaturedListings(
  db: DatabaseSchema,
  opts: {
    placementKey?: string;
    page?: number;
    limit?: number;
    seed?: string;
    now?: number;
  } = {}
): {
  items: Array<{
    featuredRequestId: string;
    placementKey: string;
    durationDays: number;
    startsAt: number;
    endsAt: number;
    endsAtEat: string;
    daysRemaining: number;
    product: Product;
    groups: Array<{
      id: number;
      name: string;
      size: number;
      dailyAmount: number;
      cycleDays: number;
      occupiedCount: number;
      availableCount: number;
      status: string;
    }>;
  }>;
  total: number;
  page: number;
  limit: number;
  maxSlots: number;
  totalPages: number;
  seed: string;
} {
  const now = opts.now ?? Date.now();
  const placementKey = opts.placementKey || 'homepage_featured';
  const placements = getFeaturedPlacements(db);
  const placement = placements.find((p) => p.key === placementKey);
  const settings = getFeaturedSettings(db);

  if (!placement || !placement.enabled) {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: opts.limit || 20,
      maxSlots: placement?.maxSlots ?? 0,
      totalPages: 0,
      seed: opts.seed || getEatDateParts(now).dateKey,
    };
  }

  const productById = new Map<number, Product>();
  for (const p of db.products || []) productById.set(p.id, p);

  const validEntries: Array<{
    req: FeaturedRequest;
    product: Product;
    groups: ChamaGroup[];
  }> = [];

  for (const req of db.featuredRequests || []) {
    if (req.placementKey !== placementKey) continue;
    if (req.status !== 'ACTIVE') continue;
    if (!req.startsAt || !req.endsAt) continue;
    if (req.startsAt > now || now >= req.endsAt) continue;

    const product = productById.get(req.productId);
    const elig = isProductEligibleForFeatured(db, product, settings);
    if (!elig.eligible || !product) continue;

    const groups = getEligibleGroupsForProduct(db, product.id);
    validEntries.push({ req, product, groups });
  }

  // Fair rotation: interleave merchants round-robin + deterministic EAT hourly/seed shift
  const hourBucket = Math.floor(now / (60 * 60 * 1000));
  const eatDay = getEatDateParts(now).dateKey;
  const effectiveSeed = opts.seed || `${eatDay}:${hourBucket}`;

  const hashOrder = (val: string) => {
    const hex = crypto.createHash('sha256').update(`${effectiveSeed}:${val}`).digest('hex');
    return parseInt(hex.slice(0, 8), 16);
  };

  // Group by merchantId so multiple active items from the same merchant are spaced fairly
  const byMerchant = new Map<number, typeof validEntries>();
  for (const entry of validEntries) {
    const list = byMerchant.get(entry.req.merchantId) || [];
    list.push(entry);
    byMerchant.set(entry.req.merchantId, list);
  }

  const merchantQueues = Array.from(byMerchant.entries())
    .sort((a, b) => hashOrder(`m:${a[0]}`) - hashOrder(`m:${b[0]}`))
    .map(([, list]) => list.sort((a, b) => hashOrder(`r:${a.req.id}`) - hashOrder(`r:${b.req.id}`)));

  const fairlyRotated: typeof validEntries = [];
  let roundIdx = 0;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const q of merchantQueues) {
      if (roundIdx < q.length) {
        fairlyRotated.push(q[roundIdx]);
        remaining = true;
      }
    }
    roundIdx++;
  }

  const cappedBySlots = fairlyRotated.slice(0, Math.max(1, placement.maxSlots));
  const total = cappedBySlots.length;
  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || placement.maxSlots || 20));
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  const startIdx = (page - 1) * limit;
  const slice = cappedBySlots.slice(startIdx, startIdx + limit);

  const items = slice.map(({ req, product, groups }) => {
    const remainingMs = Math.max(0, (req.endsAt || now) - now);
    const daysRemaining = Math.max(1, Math.ceil(remainingMs / DAY_MS));
    return {
      featuredRequestId: req.id,
      placementKey: req.placementKey,
      durationDays: req.durationDays,
      startsAt: req.startsAt!,
      endsAt: req.endsAt!,
      endsAtEat: getEatDateParts(req.endsAt!).dateKey,
      daysRemaining,
      product: {
        ...product,
        isFeatured: true,
        featuredRequestId: req.id,
        featuredPlacementKey: req.placementKey,
        featuredEndsAt: req.endsAt!,
      },
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        size: g.size,
        dailyAmount: g.dailyAmount,
        cycleDays: g.cycleDays,
        occupiedCount: g.occupiedCount,
        availableCount: g.availableCount,
        status: g.status,
      })),
    };
  });

  return {
    items,
    total,
    page,
    limit,
    maxSlots: placement.maxSlots,
    totalPages,
    seed: effectiveSeed,
  };
}

export function getOrCreateDailyStatsRow(
  db: DatabaseSchema,
  req: FeaturedRequest,
  dateKey: string
): FeaturedStatsDaily {
  if (!db.featuredStatsDaily) db.featuredStatsDaily = [];
  const rowId = `${req.id}_${dateKey}`;
  let row = db.featuredStatsDaily.find((s) => s.id === rowId);
  if (!row) {
    row = {
      id: rowId,
      featuredRequestId: req.id,
      productId: req.productId,
      merchantId: req.merchantId,
      date: dateKey,
      impressions: 0,
      uniqueViewers: 0,
      uniqueViewerKeys: [],
      clicks: 0,
      productViews: 0,
      joins: 0,
      orders: 0,
    };
    db.featuredStatsDaily.push(row);
  }
  return row;
}

export function recordFeaturedEventInTx(
  db: DatabaseSchema,
  params: {
    featuredRequestId: string;
    eventType: 'impression' | 'click' | 'product_view' | 'join' | 'order';
    viewerKey?: string;
    now?: number;
  }
): boolean {
  const now = params.now ?? Date.now();
  const req = (db.featuredRequests || []).find((r) => r.id === params.featuredRequestId);
  if (!req) return false;
  if (req.status !== 'ACTIVE' && params.eventType === 'impression') {
    return false;
  }

  const dateKey = getEatDateParts(now).dateKey;
  const row = getOrCreateDailyStatsRow(db, req, dateKey);

  if (params.eventType === 'impression') {
    row.impressions += 1;
    if (params.viewerKey) {
      if (!row.uniqueViewerKeys) row.uniqueViewerKeys = [];
      if (!row.uniqueViewerKeys.includes(params.viewerKey)) {
        row.uniqueViewerKeys.push(params.viewerKey);
        if (row.uniqueViewerKeys.length > 5000) {
          row.uniqueViewerKeys = row.uniqueViewerKeys.slice(-5000);
        }
        row.uniqueViewers += 1;
      }
    }
  } else if (params.eventType === 'click') {
    row.clicks += 1;
  } else if (params.eventType === 'product_view') {
    row.productViews += 1;
  } else if (params.eventType === 'join') {
    row.joins += 1;
  } else if (params.eventType === 'order') {
    row.orders += 1;
  }

  return true;
}

/**
 * Attributes a group join or payment/order to the product's currently ACTIVE featured request
 * (when featuredRequestId is supplied or the product is actively featured at the moment of conversion).
 */
export function attributeProductConversionInTx(
  db: DatabaseSchema,
  params: {
    productId: number;
    eventType: 'join' | 'order';
    featuredRequestId?: string;
    now?: number;
  }
): void {
  const now = params.now ?? Date.now();
  const targetReq = params.featuredRequestId
    ? (db.featuredRequests || []).find(
        (r) =>
          r.id === params.featuredRequestId &&
          r.productId === params.productId &&
          r.status === 'ACTIVE' &&
          (!r.endsAt || r.endsAt > now)
      )
    : (db.featuredRequests || []).find(
        (r) =>
          r.productId === params.productId &&
          r.status === 'ACTIVE' &&
          (!r.startsAt || r.startsAt <= now) &&
          (!r.endsAt || r.endsAt > now)
      );

  if (targetReq) {
    recordFeaturedEventInTx(db, {
      featuredRequestId: targetReq.id,
      eventType: params.eventType,
      now,
    });
  }
}

export function summarizeFeaturedRequestStats(db: DatabaseSchema, featuredRequestId: string) {
  const rows = (db.featuredStatsDaily || [])
    .filter((s) => s.featuredRequestId === featuredRequestId)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = rows.reduce(
    (acc, r) => {
      acc.impressions += r.impressions;
      acc.uniqueViewers += r.uniqueViewers;
      acc.clicks += r.clicks;
      acc.productViews += r.productViews;
      acc.joins += r.joins;
      acc.orders += r.orders;
      return acc;
    },
    { impressions: 0, uniqueViewers: 0, clicks: 0, productViews: 0, joins: 0, orders: 0 }
  );

  const ctr =
    totals.impressions > 0 ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0;

  return {
    totals: {
      ...totals,
      ctr,
    },
    daily: rows.map((r) => ({
      date: r.date,
      impressions: r.impressions,
      uniqueViewers: r.uniqueViewers,
      clicks: r.clicks,
      productViews: r.productViews,
      joins: r.joins,
      orders: r.orders,
    })),
  };
}

/**
 * Core transaction helpers for Refunding or Approving Featured Requests safely with integer cents & idempotency.
 */
export function refundFeaturedRequestInTx(
  db: DatabaseSchema,
  req: FeaturedRequest,
  amountToRefundCents: number,
  reasonNote: string,
  actorId: number
): string | undefined {
  if (amountToRefundCents <= 0) return undefined;
  const idempotencyKey = `feat_refund_${req.id}`;
  const adminUser = findPlatformAdminUser(db);

  // If revenue had already settled to admin wallet (e.g. prorata takedown), debit admin wallet when present
  if (req.revenueLedgerId && adminUser && adminUser.id !== req.merchantId) {
    const adminWallet = (db.wallets || []).find((w) => w.userId === adminUser.id && w.role === 'admin');
    if (adminWallet && adminWallet.balanceCents >= amountToRefundCents) {
      debitWalletCents(db, {
        userId: adminUser.id,
        role: 'admin',
        amountCents: amountToRefundCents,
        category: 'FEATURED_REFUND',
        referenceId: req.id,
        idempotencyKey: `${idempotencyKey}:admin_debit`,
        note: reasonNote,
        actorId,
      });
    }
  }

  const { entry } = creditWalletCents(db, {
    userId: req.merchantId,
    role: 'merchant',
    amountCents: amountToRefundCents,
    category: 'FEATURED_REFUND',
    referenceId: req.id,
    idempotencyKey,
    note: reasonNote,
    actorId,
  });

  if (!db.storeCreditLedger) db.storeCreditLedger = [];
  const existsLegacy = db.storeCreditLedger.some((l) => l.referenceId === `FEAT-REF-${req.id}`);
  if (!existsLegacy) {
    const refundKes = fromCents(amountToRefundCents);
    const merchant = (db.users || []).find((u) => u.id === req.merchantId);
    db.storeCreditLedger.unshift({
      id: db.nextIds.ledger++,
      userId: req.merchantId,
      amount: refundKes,
      balanceAfter: merchant?.roleWallets?.merchant?.credit ?? merchant?.credit ?? refundKes,
      type: 'refund_credit',
      referenceId: `FEAT-REF-${req.id}`,
      note: reasonNote,
      createdAt: Date.now(),
    });
  }

  req.refundedCents = amountToRefundCents;
  req.refundLedgerId = entry.id;
  return entry.id;
}

export function approveFeaturedRequestInTx(
  db: DatabaseSchema,
  params: {
    req: FeaturedRequest;
    adminUser: User;
    getMerchantLimitsFn: (db: DatabaseSchema, merchantId: number) => {
      hasActiveSubscription: boolean;
      maxActiveFeatured: number;
      activeFeaturedUsed: number;
      tierName: string;
    };
    now?: number;
  }
): { alreadyProcessed: boolean; req: FeaturedRequest; product?: Product; outboxEvent?: any } {
  const now = params.now ?? Date.now();
  const { req, adminUser } = params;

  if (req.status === 'APPROVED' || req.status === 'ACTIVE') {
    return { alreadyProcessed: true, req };
  }

  if (req.status !== 'PENDING_APPROVAL') {
    throw {
      status: 409,
      code: 'INVALID_FEATURED_STATE',
      message: `Cannot approve featured request in status "${req.status}".`,
    };
  }

  const merchant = (db.users || []).find((u) => u.id === req.merchantId);
  if (!merchant || merchant.isDisabled || merchant.isSuspended) {
    throw { status: 403, code: 'MERCHANT_INACTIVE', message: 'Merchant account is disabled or suspended.' };
  }

  const limits = params.getMerchantLimitsFn(db, req.merchantId);
  if (!limits.hasActiveSubscription) {
    throw {
      status: 403,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Merchant subscription has expired or is inactive. Cannot approve featured placement.',
    };
  }

  if (limits.maxActiveFeatured !== -1 && limits.activeFeaturedUsed >= limits.maxActiveFeatured) {
    throw {
      status: 409,
      code: 'FEATURED_ACTIVE_LIMIT_REACHED',
      message: `Merchant has reached their ${limits.tierName} limit of ${limits.maxActiveFeatured} active/scheduled featured products.`,
    };
  }

  const product = (db.products || []).find((p) => p.id === req.productId);
  const settings = getFeaturedSettings(db);
  const elig = isProductEligibleForFeatured(db, product, settings);
  if (!elig.eligible || !product) {
    throw {
      status: 400,
      code: elig.code || 'PRODUCT_INELIGIBLE',
      message: elig.reason || 'Product is not eligible for featured placement.',
    };
  }

  const placement = getFeaturedPlacements(db).find((p) => p.key === req.placementKey);
  if (!placement || !placement.enabled) {
    throw { status: 400, code: 'INVALID_PLACEMENT', message: 'Target featured placement is disabled or missing.' };
  }

  // Prevent duplicate active/approved overlap on same (productId, placementKey)
  const overlapping = (db.featuredRequests || []).some(
    (other) =>
      other.id !== req.id &&
      other.productId === req.productId &&
      other.placementKey === req.placementKey &&
      (other.status === 'ACTIVE' || other.status === 'APPROVED') &&
      (!other.endsAt || other.endsAt > now)
  );
  if (overlapping) {
    throw {
      status: 409,
      code: 'OVERLAPPING_FEATURED',
      message: 'This product already has an active or scheduled featured placement in this slot.',
    };
  }

  // Schedule start timestamp respecting maxSlots queue
  const startsAt = resolveSlotStartTimestamp(db, req.placementKey, placement.maxSlots, req.requestedStartAt, now);
  const endsAt = startsAt + req.durationDays * DAY_MS;

  // Settle held fee to platform admin wallet once via idempotency key
  const { entry: revEntry } = creditWalletCents(db, {
    userId: adminUser.id,
    role: 'admin',
    amountCents: req.amountPaidCents,
    category: 'FEATURED_REVENUE',
    referenceId: req.id,
    idempotencyKey: `feat_rev_${req.id}`,
    note: `Featured placement revenue: "${product.title}" (${req.durationDays}d, ${placement.name})`,
    actorId: adminUser.id,
  });

  req.startsAt = startsAt;
  req.endsAt = endsAt;
  req.approvedAt = now;
  req.approvedBy = adminUser.id;
  req.revenueLedgerId = revEntry.id;
  req.status = startsAt <= now ? 'ACTIVE' : 'APPROVED';
  req.updatedAt = now;

  if (req.status === 'ACTIVE') {
    product.isFeatured = true;
    product.featuredRequestId = req.id;
    product.featuredPlacementKey = req.placementKey;
    product.featuredEndsAt = endsAt;
  }

  // Ensure product appears idempotently in Announcements without duplicating or resetting createdAt
  const prodGroups = getEligibleGroupsForProduct(db, product.id);
  ensureProductInAnnouncementsInTx(db, product, merchant, prodGroups, {
    isFeaturedBadge: req.status === 'ACTIVE',
  });

  // Record official platform income in incomeLedger idempotently
  recordIncomeInTx(db, {
    source: 'FEATURED',
    paymentChannel: 'WALLET',
    amountCents: req.amountPaidCents,
    userId: req.merchantId,
    userName: merchant.shopName || merchant.name,
    referenceId: req.id,
    description: `Featured placement "${product.title}" (${req.durationDays}d, ${placement.name})`,
    idempotencyKey: `inc_feat_${req.id}`,
    actorId: adminUser.id,
    createdAt: now,
  });

  if (!db.userNotifications) db.userNotifications = [];
  const eatEnd = getEatDateParts(endsAt).dateKey;
  const eatStart = getEatDateParts(startsAt).dateKey;
  const notifTitle = req.status === 'ACTIVE' ? 'Featured Placement Live!' : 'Featured Placement Approved & Scheduled';
  const notifMessage =
    req.status === 'ACTIVE'
      ? `Your featured placement for "${product.title}" (${req.durationDays}d) is now LIVE until ${eatEnd} (EAT).`
      : `Your featured placement for "${product.title}" (${req.durationDays}d) is approved and scheduled to start on ${eatStart} until ${eatEnd} (EAT).`;

  const outboxEvent = enqueueOutboxInTx(db, {
    userId: req.merchantId,
    eventType: 'featured.updated',
    entityType: 'featured',
    entityId: req.id,
    title: notifTitle,
    message: notifMessage,
    notificationType: 'payment',
    link: '/vendor-dashboard',
    payload: {
      id: req.id,
      productId: req.productId,
      status: req.status,
      startsAt,
      endsAt,
    },
    alsoAddNotification: true,
    now,
  });

  logAudit(
    db,
    adminUser.id,
    adminUser.name,
    'FEATURED_REQUEST_APPROVED',
    `Approved featured request #${req.id} for "${product.title}" (${req.durationDays}d, KSh ${fromCents(req.amountPaidCents)} -> ${req.status}, ${eatStart} to ${eatEnd} EAT)`
  );

  return { alreadyProcessed: false, req, product, outboxEvent };
}
