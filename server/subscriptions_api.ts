import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase, DatabaseSchema, logAudit, runDatabaseTransaction } from './db.js';
import { User, SubscriptionRequest, MerchantSubscriptionTier, MerchantSubscriptionRecord, SubscriptionActivationNotice } from '../src/types.js';
import { resolveAuthenticatedSession, resolveAuthenticatedUser, sanitizeUser } from './auth_utils.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import { emitPlatformEvent } from './events.js';
import {
  computeSubscriptionStatusEat,
  SUBSCRIPTION_RENEWAL_MODE,
  toCents,
} from './config.js';
import { debitWalletCents, findPlatformAdminUser, transferBetweenWalletsCents } from './wallet_service.js';
import { paginateList, parsePaginationQuery } from './admin_control_center.js';

export const subscriptionsRouter = wrapRouterAsync(Router());

// Standard 6-Tier Merchant Subscription Catalog (Single source of truth)
// Yearly pricing reflects ~17% annual discount (2 months free compared to 12x monthly)
export const SUBSCRIPTION_PLANS: Array<{
  id: string;
  key: string;
  name: string;
  monthlyFee: number;
  yearlyFee: number;
  yearlyDiscountPercent: number;
  maxProducts: number;
  maxGroupsPerProduct: number;
  description: string;
  features: string[];
}> = [
  {
    id: 'tier_250',
    key: 'micro',
    name: 'Micro-Merchant',
    monthlyFee: 250,
    yearlyFee: 2500,
    yearlyDiscountPercent: 17,
    maxProducts: 2,
    maxGroupsPerProduct: 2,
    description: 'Caters to very small businesses and solo makers.',
    features: ['1 to 2 products max', '2 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'tier_500',
    key: 'growing',
    name: 'Growing Merchant',
    monthlyFee: 500,
    yearlyFee: 5000,
    yearlyDiscountPercent: 17,
    maxProducts: 10,
    maxGroupsPerProduct: 5,
    description: 'Ideal for growing neighborhood retailers.',
    features: ['Up to 10 products', '5 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'tier_1500',
    key: 'pro',
    name: 'Pro Merchant',
    monthlyFee: 1500,
    yearlyFee: 15000,
    yearlyDiscountPercent: 17,
    maxProducts: 50,
    maxGroupsPerProduct: 10,
    description: 'For active retail businesses and popular shops.',
    features: ['Up to 50 products', '10 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'tier_3500',
    key: 'commercial',
    name: 'Commercial',
    monthlyFee: 3500,
    yearlyFee: 35000,
    yearlyDiscountPercent: 17,
    maxProducts: 100,
    maxGroupsPerProduct: 30,
    description: 'High capacity volume sales for established stores.',
    features: ['Up to 100 products', '30 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'tier_7500',
    key: 'enterprise',
    name: 'Enterprise Scale',
    monthlyFee: 7500,
    yearlyFee: 75000,
    yearlyDiscountPercent: 17,
    maxProducts: -1, // Unlimited
    maxGroupsPerProduct: 50,
    description: 'Unlimited catalog for major retail distributors.',
    features: ['Unlimited products', '50 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'enterprise',
    key: 'custom',
    name: 'Custom Enterprise',
    monthlyFee: 15000,
    yearlyFee: 150000,
    yearlyDiscountPercent: 17,
    maxProducts: -1, // Unlimited
    maxGroupsPerProduct: 100,
    description: 'Custom SLA and limits set by Buyoll Admin.',
    features: ['Unlimited products', 'Up to 100 groups per product', 'Custom SLA'],
  },
];

export function computeYearlyDiscountPercent(monthlyFee: number, yearlyFee: number): number {
  const annualBaseline = monthlyFee * 12;
  if (!annualBaseline || yearlyFee >= annualBaseline) return 0;
  return Math.max(0, Math.round(((annualBaseline - yearlyFee) / annualBaseline) * 100));
}

export function getComputedSubscriptionTiers(db?: DatabaseSchema): MerchantSubscriptionTier[] {
  const overrides = db?.tierOverrides || {};
  return SUBSCRIPTION_PLANS.map((plan) => {
    const ov = overrides[plan.id] || {};
    const monthlyFee = typeof ov.monthlyFee === 'number' && ov.monthlyFee > 0 ? ov.monthlyFee : plan.monthlyFee;
    let yearlyFee = typeof ov.yearlyFee === 'number' && ov.yearlyFee > 0 ? ov.yearlyFee : plan.yearlyFee;
    if (typeof ov.yearlyDiscountPercent === 'number' && ov.yearlyDiscountPercent >= 0 && ov.yearlyDiscountPercent <= 90 && typeof ov.yearlyFee !== 'number') {
      yearlyFee = Math.round(monthlyFee * 12 * (1 - ov.yearlyDiscountPercent / 100));
    }
    const yearlyDiscountPercent =
      typeof ov.yearlyDiscountPercent === 'number' && typeof ov.yearlyFee !== 'number'
        ? Math.round(ov.yearlyDiscountPercent)
        : computeYearlyDiscountPercent(monthlyFee, yearlyFee);
    return {
      id: plan.id as MerchantSubscriptionTier['id'],
      name: plan.name,
      monthlyFee,
      yearlyFee,
      yearlyDiscountPercent,
      maxProducts: plan.maxProducts,
      maxGroupsPerProduct: plan.maxGroupsPerProduct,
      description: plan.description,
      features: plan.features,
    };
  });
}

export function resolvePlan(keyOrId: string, db?: DatabaseSchema) {
  if (!keyOrId) return null;
  const norm = String(keyOrId).toLowerCase().trim();
  const base = SUBSCRIPTION_PLANS.find(
    (p) => p.id.toLowerCase() === norm || p.key.toLowerCase() === norm
  );
  if (!base) return null;
  const computed = getComputedSubscriptionTiers(db).find((t) => t.id === base.id);
  return {
    ...base,
    monthlyFee: computed?.monthlyFee ?? base.monthlyFee,
    yearlyFee: computed?.yearlyFee ?? base.yearlyFee,
    yearlyDiscountPercent: computed?.yearlyDiscountPercent ?? base.yearlyDiscountPercent,
  };
}

// In-memory sliding window rate limiter: 5 requests per 60s per user ID
const submitRateLimitMap = new Map<number, number[]>();

function checkRateLimit(userId: number, maxReqs = 5, windowMs = 60000): boolean {
  const now = Date.now();
  const timestamps = submitRateLimitMap.get(userId) || [];
  const valid = timestamps.filter((t) => now - t < windowMs);
  if (valid.length >= maxReqs) {
    submitRateLimitMap.set(userId, valid);
    return false;
  }
  valid.push(now);
  submitRateLimitMap.set(userId, valid);
  return true;
}

// Helper to authenticate user from signed session cookie or Bearer token
async function getAuthUser(req: Request): Promise<User | null> {
  return resolveAuthenticatedUser(req);
}

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

/**
 * Enforces expiry across active merchant subscriptions (or for a single merchant inline).
 * Marks expired subscriptions EXPIRED and hides ONLY live published products with hiddenReason = 'SUBSCRIPTION_EXPIRED'.
 */
export async function enforceExpiredSubscriptions(merchantIdFilter?: number): Promise<number[]> {
  const expiredMerchantIds: number[] = [];
  const now = Date.now();

  await runDatabaseTransaction(async (db) => {
    const subs = db.merchantSubscriptions || [];
    const affectedMerchants = new Set<number>();

    for (const sub of subs) {
      if (merchantIdFilter && sub.merchantId !== merchantIdFilter) continue;
      if (sub.status === 'active' && sub.expiresAt && sub.expiresAt <= now) {
        sub.status = 'expired';
        affectedMerchants.add(sub.merchantId);
      }
    }

    for (const u of db.users || []) {
      if (merchantIdFilter && u.id !== merchantIdFilter) continue;
      if (u.merchantSubscriptionStatus === 'active' && u.merchantSubscriptionExpiresAt && u.merchantSubscriptionExpiresAt <= now) {
        const stillActive = subs.some(
          (s) => s.merchantId === u.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
        );
        if (!stillActive) {
          u.merchantSubscriptionStatus = 'inactive';
          affectedMerchants.add(u.id);
        }
      }
    }

    for (const mId of affectedMerchants) {
      const mUser = db.users.find((u) => u.id === mId);
      const stillActive = subs.some(
        (s) => s.merchantId === mId && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
      );
      if (stillActive) continue;
      if (mUser) {
        mUser.merchantSubscriptionStatus = 'inactive';
      }
      let hiddenCount = 0;
      for (const p of db.products || []) {
        if (p.vendorId === mId && p.publicationStatus !== 'draft' && p.live !== false) {
          p.live = false;
          p.hiddenReason = 'SUBSCRIPTION_EXPIRED';
          p.hiddenAt = now;
          p.updatedAt = now;
          hiddenCount++;
        }
      }
      if (hiddenCount > 0 || mUser) {
        expiredMerchantIds.push(mId);
        if (!db.userNotifications) db.userNotifications = [];
        db.userNotifications.unshift({
          id: `notif_exp_${now}_${mId}`,
          userId: mId,
          title: 'Subscription Expired — Listings Hidden',
          message: `Your merchant subscription has expired. ${hiddenCount} live listing(s) have been hidden until you renew.`,
          type: 'warning',
          read: false,
          timestamp: now,
        });
        logAudit(
          db,
          mId,
          mUser?.name || `Merchant #${mId}`,
          'SUBSCRIPTION_EXPIRED_ENFORCED',
          `Subscription expired; hid ${hiddenCount} live listing(s) with hiddenReason=SUBSCRIPTION_EXPIRED.`
        );
      }
    }
  });

  for (const mId of expiredMerchantIds) {
    emitPlatformEvent('subscription.expired', { merchantId: mId, status: 'EXPIRED' }, [mId]);
    emitPlatformEvent('subscription.updated', { merchantId: mId, status: 'EXPIRED' }, [mId]);
  }
  return expiredMerchantIds;
}

/**
 * Single-transaction helper to activate a merchant subscription, compute expiry (supporting reset vs stack policy),
 * restore ONLY products hidden due to SUBSCRIPTION_EXPIRED, create a one-time activation notice, and log audit.
 */
export function activateSubscriptionInTx(
  db: DatabaseSchema,
  params: {
    merchantUser: User;
    planId: string;
    planName: string;
    billingPeriod: 'monthly' | 'yearly';
    subscriptionId: string;
    actorId: number;
    actorName: string;
    paymentSummary: string;
    now?: number;
  }
): {
  startDate: number;
  expiresAt: number;
  restoredProductIds: number[];
  activationNotice: SubscriptionActivationNotice;
  statusPayload: ReturnType<typeof computeSubscriptionStatusEat>;
} {
  const now = params.now ?? Date.now();
  const durationDays = params.billingPeriod === 'yearly' ? 365 : 30;
  const durationMs = durationDays * 86400000;

  let baseTime = now;
  const existingActives = (db.merchantSubscriptions || []).filter(
    (s) =>
      s.merchantId === params.merchantUser.id &&
      s.id !== params.subscriptionId &&
      s.status === 'active' &&
      s.expiresAt &&
      s.expiresAt > now
  );
  if (SUBSCRIPTION_RENEWAL_MODE === 'stack' && existingActives.length > 0) {
    const maxExpiry = Math.max(...existingActives.map((s) => s.expiresAt || now));
    baseTime = Math.max(now, maxExpiry);
  }
  // Supersede prior active rows cleanly so there is a single active window
  for (const prev of existingActives) {
    prev.status = 'expired';
    prev.notes = prev.notes
      ? `${prev.notes} (Superseded by renewal ${params.subscriptionId})`
      : `Superseded by renewal ${params.subscriptionId}`;
  }

  const expiresAt = baseTime + durationMs;
  params.merchantUser.merchantSubscriptionStatus = 'active';
  params.merchantUser.merchantSubscriptionPlan = params.planId as any;
  params.merchantUser.merchantSubscriptionExpiresAt = expiresAt;
  params.merchantUser.verified = true;
  params.merchantUser.verifiedAt = now;

  // Restore ONLY products previously hidden due to SUBSCRIPTION_EXPIRED — NEVER touch drafts!
  const restoredProductIds: number[] = [];
  for (const p of db.products || []) {
    if (p.vendorId === params.merchantUser.id && p.hiddenReason === 'SUBSCRIPTION_EXPIRED') {
      p.live = true;
      p.status = 'PUBLISHED';
      p.publicationStatus = 'posted';
      p.hiddenReason = null;
      p.hiddenAt = null;
      p.updatedAt = now;
      restoredProductIds.push(p.id);
    }
  }

  if (!db.subscriptionActivationNotices) db.subscriptionActivationNotices = [];
  let activationNotice = db.subscriptionActivationNotices.find(
    (n) => n.subscriptionId === params.subscriptionId
  );
  if (!activationNotice) {
    activationNotice = {
      id: `sub_notice_${now}_${crypto.randomBytes(4).toString('hex')}`,
      merchantId: params.merchantUser.id,
      subscriptionId: params.subscriptionId,
      planId: params.planId,
      planName: params.planName,
      billingPeriod: params.billingPeriod,
      expiresAt,
      createdAt: now,
      seenAt: null,
    };
    db.subscriptionActivationNotices.unshift(activationNotice);
  }

  if (!db.userNotifications) db.userNotifications = [];
  const durationLabel = params.billingPeriod === 'yearly' ? '1-year (365 days)' : '30-day';
  db.userNotifications.unshift({
    id: `notif_${now}_${crypto.randomBytes(3).toString('hex')}`,
    userId: params.merchantUser.id,
    title: `Thank you! ${params.planName} Approved`,
    message: `Your payment (${params.paymentSummary}) has been verified! Your ${durationLabel} selling window is active until ${new Date(expiresAt).toLocaleDateString()}.${restoredProductIds.length > 0 ? ` ${restoredProductIds.length} paused listing(s) have been restored live.` : ''}`,
    type: 'payment',
    read: false,
    timestamp: now,
  });

  logAudit(
    db,
    params.actorId,
    params.actorName,
    'SUBSCRIPTION_ACTIVATED',
    `Activated ${params.billingPeriod} subscription ${params.subscriptionId} for merchant #${params.merchantUser.id} (${params.planName}, mode=${SUBSCRIPTION_RENEWAL_MODE}, restored=${restoredProductIds.length})`
  );

  const statusPayload = computeSubscriptionStatusEat(expiresAt, true, now);
  return {
    startDate: now,
    expiresAt,
    restoredProductIds,
    activationNotice,
    statusPayload,
  };
}

// ======================================================================
// 1. POST /subscriptions/requests - Authenticated Merchant
// ======================================================================
subscriptionsRouter.post('/subscriptions/requests', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required. Please sign in to submit a subscription request.' },
    });
  }

  // Rate limit: 5 submissions per minute
  if (!checkRateLimit(user.id, 5, 60000)) {
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in a minute.' },
    });
  }

  const { planId, planKey, paymentMethod, mpesaCode, notes, billingPeriod } = req.body || {};
  const targetPlan = resolvePlan(planId || planKey);
  const normalizedPeriod: 'monthly' | 'yearly' =
    String(billingPeriod || 'monthly').toLowerCase().trim() === 'yearly' ? 'yearly' : 'monthly';
  const durationDays = normalizedPeriod === 'yearly' ? 365 : 30;
  const durationLabel = normalizedPeriod === 'yearly' ? '1-year (365 days)' : '30-day';

  if (!targetPlan) {
    return res.status(422).json({
      error: { code: 'INVALID_PLAN', message: 'Invalid merchant subscription plan. Please select a valid plan.' },
    });
  }

  const methodNorm = String(paymentMethod || 'mpesa').toLowerCase().trim();
  const normalizedMethod: 'mpesa' | 'wallet' | 'coins' =
    methodNorm === 'wallet' || methodNorm === 'wallet_credit'
      ? 'wallet'
      : methodNorm === 'coins' || methodNorm === 'wallet_coins'
      ? 'coins'
      : 'mpesa';

  let cleanedCode: string | undefined = undefined;
  if (normalizedMethod === 'mpesa') {
    cleanedCode = String(mpesaCode || '').trim().toUpperCase();
    if (!cleanedCode || !/^[A-Z0-9]{10}$/.test(cleanedCode)) {
      return res.status(422).json({
        error: {
          code: 'INVALID_MPESA_CODE',
          message: 'Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN (letters and digits only).',
        },
      });
    }
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const merchantUser = db.users.find((u) => u.id === user.id);
      if (!merchantUser) throw { status: 404, code: 'NOT_FOUND', message: 'Merchant account not found.' };

      // Ensure arrays exist
      if (!db.subscriptionRequests) db.subscriptionRequests = [];
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      if (!db.payments) db.payments = [];
      if (!db.userNotifications) db.userNotifications = [];

      // 1. Check active cycle against SUBSCRIPTION_RENEWAL_MODE ('reset' or 'stack' allow early renewal)
      const activeSub = (db.merchantSubscriptions || []).find(
        (s) => s.merchantId === user.id && s.status === 'active' && s.expiresAt && s.expiresAt > now
      );
      const replacingActiveCycle = Boolean(
        activeSub ||
          (merchantUser.merchantSubscriptionStatus === 'active' &&
            merchantUser.merchantSubscriptionExpiresAt &&
            merchantUser.merchantSubscriptionExpiresAt > now)
      );

      // 2. Prevent second pending subscription payment for this merchant
      const existingPending =
        db.subscriptionRequests.some((r) => r.merchantId === user.id && r.status === 'pending') ||
        db.merchantSubscriptions.some((s) => s.merchantId === user.id && s.status === 'pending');

      if (existingPending) {
        throw {
          status: 409,
          code: 'PENDING_REQUEST_EXISTS',
          message: 'You already have a subscription payment pending admin review. Please wait for admin approval.',
        };
      }

      // 3. Prevent duplicate M-Pesa codes across all pending or approved requests
      if (normalizedMethod === 'mpesa' && cleanedCode) {
        const codeInReqs = db.subscriptionRequests.some(
          (r) => r.mpesaCode === cleanedCode && (r.status === 'pending' || r.status === 'approved')
        );
        const codeInSubs = db.merchantSubscriptions.some(
          (s) => s.paymentCode === cleanedCode && (s.status === 'pending' || s.status === 'active')
        );
        const codeInPayments = db.payments.some(
          (p) => p.code === cleanedCode && (p.status === 'pending' || p.status === 'approved')
        );

        if (codeInReqs || codeInSubs || codeInPayments) {
          throw {
            status: 409,
            code: 'DUPLICATE_CODE',
            message: 'This M-Pesa transaction code has already been submitted and is currently pending or approved.',
          };
        }
      }

      const effectivePlan = resolvePlan(targetPlan.id, db) || targetPlan;
      const amountExpected = normalizedPeriod === 'yearly' ? effectivePlan.yearlyFee : effectivePlan.monthlyFee; // DERIVED SERVER-SIDE FROM PLAN CATALOG

      // METHOD A: M-PESA TILL / PAYBILL (Creates Pending Request for Admin Review)
      if (normalizedMethod === 'mpesa') {
        const newReq: SubscriptionRequest = {
          id: `sub_req_${now}_${Math.random().toString(36).substring(2, 6)}`,
          merchantId: user.id,
          merchantName: user.name,
          shopName: user.shopName || user.name,
          phone: user.phone || undefined,
          email: user.email,
          planId: targetPlan.id,
          planKey: targetPlan.key,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          amountExpected,
          paymentMethod: 'mpesa',
          mpesaCode: cleanedCode,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        db.subscriptionRequests.unshift(newReq);

        // Keep merchantSubscriptions synchronized
        db.merchantSubscriptions.unshift({
          id: newReq.id,
          merchantId: user.id,
          tierId: targetPlan.id,
          tierName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          billingInterval: normalizedPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
          autoRenew: true,
          canceledAt: null,
          amount: amountExpected,
          paymentMethod: 'mpesa_till_paybill',
          paymentCode: cleanedCode,
          status: 'pending',
          createdAt: now,
          notes: notes ? String(notes).trim() : undefined,
        });

        // Add to db.payments queue for Admin
        db.payments.unshift({
          id: db.nextIds.payment++,
          userId: user.id,
          userName: user.shopName || user.name,
          userPhone: user.phone || undefined,
          code: cleanedCode!,
          amount: amountExpected,
          status: 'pending',
          type: 'merchant_subscription',
          channel: 'Buy Goods Till 196853 / Paybill 522533',
          createdAt: now,
          verifiedAt: null,
          verifiedBy: null,
          notes: `Subscription request for ${targetPlan.name} (${durationLabel}). Code: ${cleanedCode}. Pending Admin Approval.`,
        });

        merchantUser.merchantSubscriptionStatus = 'pending_verification';

        // Notify merchant in-app
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: user.id,
          title: `⏳ Subscription Code Submitted: ${targetPlan.name}`,
          message: `M-Pesa confirmation code ${cleanedCode} for KSh ${amountExpected.toLocaleString()} (${durationLabel}) submitted. Admin will verify against statements and activate your store for ${durationLabel}.`,
          type: 'payment',
          read: false,
          timestamp: now,
        });

        // Notify admin of new pending request
        const adminUser = db.users.find((u) => u.role === 'admin');
        if (adminUser) {
          db.userNotifications.unshift({
            id: `notif_adm_${now}_${Math.random().toString(36).substring(2, 6)}`,
            userId: adminUser.id,
            title: `🔔 New Merchant Plan Code: ${targetPlan.name}`,
            message: `Merchant ${user.name} submitted M-Pesa code ${cleanedCode} (KSh ${amountExpected.toLocaleString()}). Ready for verification.`,
            type: 'system',
            read: false,
            timestamp: now,
          });
        }

        logAudit(
          db,
          user.id,
          user.name,
          'SUBSCRIPTION_REQUEST_SUBMITTED',
          `Submitted M-Pesa code ${cleanedCode} for ${targetPlan.name} (KSh ${amountExpected})`
        );

        return {
          request: newReq,
          message: 'Subscription request submitted! An admin will review and verify your payment code against statements.',
        };
      }

      // METHOD B: MERCHANT WALLET (Atomic ledger transfer + instant activation)
      if (normalizedMethod === 'wallet') {
        const subId = `sub_req_${now}_${crypto.randomBytes(3).toString('hex')}`;
        const adminUser = findPlatformAdminUser(db);
        const amountCents = toCents(amountExpected);
        if (adminUser) {
          transferBetweenWalletsCents(db, {
            fromUserId: merchantUser.id,
            fromRole: 'merchant',
            toUserId: adminUser.id,
            toRole: 'admin',
            amountCents,
            debitCategory: 'SUBSCRIPTION_PAYMENT',
            creditCategory: 'SUBSCRIPTION_REVENUE',
            referenceId: subId,
            idempotencyKey: `sub_pay_${subId}`,
            note: `Merchant ${normalizedPeriod} subscription payment for ${targetPlan.name}`,
            actorId: merchantUser.id,
          });
        } else {
          const { debitWalletCents } = await import('./wallet_service.js');
          debitWalletCents(db, {
            userId: merchantUser.id,
            role: 'merchant',
            amountCents,
            category: 'SUBSCRIPTION_PAYMENT',
            referenceId: subId,
            idempotencyKey: `sub_pay_${subId}`,
            note: `Merchant ${normalizedPeriod} subscription payment for ${targetPlan.name}`,
            actorId: merchantUser.id,
          });
        }

        const updatedBalance = merchantUser.roleWallets?.merchant?.credit ?? merchantUser.credit ?? 0;
        if (!db.storeCreditLedger) db.storeCreditLedger = [];
        db.storeCreditLedger.unshift({
          id: db.nextIds.ledger++,
          userId: merchantUser.id,
          amount: -amountExpected,
          balanceAfter: updatedBalance,
          type: 'transfer_out',
          referenceId: subId,
          note: `Merchant subscription fee for ${targetPlan.name} (Instant Activation)`,
          createdAt: now,
        });

        const activation = activateSubscriptionInTx(db, {
          merchantUser,
          planId: targetPlan.id,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          subscriptionId: subId,
          actorId: merchantUser.id,
          actorName: merchantUser.name,
          paymentSummary: `Wallet KSh ${amountExpected.toLocaleString()}`,
          now,
        });

        const newReq: SubscriptionRequest = {
          id: subId,
          merchantId: user.id,
          merchantName: user.name,
          shopName: user.shopName || user.name,
          phone: user.phone || undefined,
          email: user.email,
          planId: targetPlan.id,
          planKey: targetPlan.key,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          amountExpected,
          paymentMethod: 'wallet',
          status: 'approved',
          adminId: adminUser?.id || user.id,
          reviewedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        db.subscriptionRequests.unshift(newReq);

        db.merchantSubscriptions.unshift({
          id: subId,
          merchantId: user.id,
          tierId: targetPlan.id,
          tierName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          billingInterval: normalizedPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
          autoRenew: true,
          canceledAt: null,
          currentPeriodEnd: activation.expiresAt,
          amount: amountExpected,
          paymentMethod: 'wallet_credit',
          status: 'active',
          startDate: activation.startDate,
          expiresAt: activation.expiresAt,
          approvedBy: adminUser?.id || user.id,
          approvedAt: now,
          createdAt: now,
          notes: replacingActiveCycle ? `Early renewal (${SUBSCRIPTION_RENEWAL_MODE} mode)` : undefined,
        });

        return {
          request: newReq,
          instantActivated: true,
          activation,
          message: `Subscription activated immediately! Your ${targetPlan.name} is active for ${durationLabel}.`,
        };
      }

      // METHOD C: APPLAUD COINS (Instant Atomic Activation)
      if (normalizedMethod === 'coins') {
        const coinsRequired = amountExpected;
        if ((merchantUser.coins || 0) < coinsRequired) {
          throw {
            status: 400,
            code: 'INSUFFICIENT_COINS',
            message: `Insufficient coins. You have ${merchantUser.coins || 0} coins but need ${coinsRequired} coins for the ${targetPlan.name}.`,
          };
        }

        merchantUser.coins = (merchantUser.coins || 0) - coinsRequired;
        const adminUser = db.users.find((u) => u.role === 'admin') || db.users[0];
        if (adminUser) adminUser.coins = (adminUser.coins || 0) + coinsRequired;

        if (!db.coinLedger) db.coinLedger = [];
        db.coinLedger.push({
          id: db.coinLedger.length + 1,
          senderId: user.id,
          senderName: user.name,
          recipientId: adminUser?.id || 1,
          recipientName: adminUser?.name || 'Admin',
          amount: coinsRequired,
          type: 'transfer',
          reason: 'subscription',
          note: `Coins subscription fee for ${targetPlan.name}`,
          timestamp: now,
        });

        const expiresAt = now + durationDays * 86400000;
        merchantUser.merchantSubscriptionStatus = 'active';
        merchantUser.merchantSubscriptionPlan = targetPlan.id as any;
        merchantUser.merchantSubscriptionExpiresAt = expiresAt;
        merchantUser.verified = true;
        merchantUser.verifiedAt = now;

        const newReq: SubscriptionRequest = {
          id: `sub_req_${now}_${Math.random().toString(36).substring(2, 6)}`,
          merchantId: user.id,
          merchantName: user.name,
          shopName: user.shopName || user.name,
          phone: user.phone || undefined,
          email: user.email,
          planId: targetPlan.id,
          planKey: targetPlan.key,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          amountExpected,
          paymentMethod: 'coins',
          status: 'approved',
          adminId: 1,
          reviewedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        db.subscriptionRequests.unshift(newReq);

        db.merchantSubscriptions.unshift({
          id: newReq.id,
          merchantId: user.id,
          tierId: targetPlan.id,
          tierName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          billingInterval: normalizedPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
          autoRenew: true,
          canceledAt: null,
          currentPeriodEnd: expiresAt,
          amount: amountExpected,
          paymentMethod: 'wallet_coins',
          status: 'active',
          startDate: now,
          expiresAt,
          createdAt: now,
        });

        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: user.id,
          title: `🎉 ${normalizedPeriod === 'yearly' ? 'Yearly' : '30-Day'} Merchant Plan Active: ${targetPlan.name}`,
          message: `${coinsRequired} coins paid. Store catalog limits active for ${durationLabel} until ${new Date(expiresAt).toLocaleDateString()}.`,
          type: 'payment',
          read: false,
          timestamp: now,
        });

        logAudit(
          db,
          user.id,
          user.name,
          'SUBSCRIPTION_COINS_ACTIVATED',
          `Instantly activated ${targetPlan.name} (${normalizedPeriod}) via Applaud Coins`
        );

        return {
          request: newReq,
          message: `Subscription activated immediately! Your ${targetPlan.name} is active for ${durationLabel}.`,
        };
      }

      throw { status: 400, code: 'INVALID_METHOD', message: 'Unsupported payment method.' };
    });

    if ((result as any).instantActivated && (result as any).activation) {
      const act = (result as any).activation;
      emitPlatformEvent(
        'subscription.activated',
        {
          merchantId: user.id,
          subscriptionId: result.request.id,
          notice: act.activationNotice,
          status: act.statusPayload,
          restoredProductIds: act.restoredProductIds,
        },
        [user.id]
      );
      emitPlatformEvent('subscription.updated', { merchantId: user.id, status: act.statusPayload }, [user.id]);
    }

    return res.status(201).json({
      success: true,
      request: result.request,
      renewalMode: SUBSCRIPTION_RENEWAL_MODE,
      activationNotice: (result as any).activation?.activationNotice || null,
      message: result.message,
    });
  } catch (err: any) {
    console.error('Subscription request submission error:', err);
    const status = err.status || 500;
    const code = err.code || 'SERVER_ERROR';
    const message = err.message || 'Something went wrong processing your request. Please try again.';
    return res.status(status).json({
      error: { code, message },
    });
  }
});

// ======================================================================
// 2. GET /subscriptions/requests/me - Merchant's Latest Request & Status
// ======================================================================
subscriptionsRouter.get('/subscriptions/requests/me', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  }

  const db = await getDatabase();
  const dbUser = db.users.find((u) => u.id === user.id) || user;

  const userReqs = (db.subscriptionRequests || []).filter((r) => r.merchantId === user.id);
  const latestReq = userReqs.length > 0 ? userReqs[0] : null;

  const now = Date.now();
  const activeSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === user.id && s.status === 'active' && s.expiresAt && s.expiresAt > now
  );

  const hasPending =
    (latestReq && latestReq.status === 'pending') ||
    (db.merchantSubscriptions || []).some((s) => s.merchantId === user.id && s.status === 'pending');

  res.json({
    success: true,
    request: latestReq,
    hasPendingRequest: Boolean(hasPending),
    hasActiveSubscription: Boolean(activeSub || (dbUser.merchantSubscriptionStatus === 'active' && dbUser.merchantSubscriptionExpiresAt && dbUser.merchantSubscriptionExpiresAt > now)),
    activeSubscription: activeSub || null,
    plan: activeSub ? resolvePlan(activeSub.tierId) : null,
    user: dbUser,
  });
});

// ======================================================================
// 3. GET /admin/subscriptions/requests?status=pending - Admin Only
// ======================================================================
subscriptionsRouter.get('/admin/subscriptions/requests', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrative access required' },
    });
  }

  const statusFilter = req.query.status ? String(req.query.status).toLowerCase().trim() : undefined;
  const { page, limit } = parsePaginationQuery(req.query, 20, 100);
  const db = await getDatabase();

  const userMap = new Map<number, User>();
  for (const u of db.users || []) userMap.set(u.id, u);

  let list = [...(db.subscriptionRequests || [])];
  const existingIds = new Set(list.map((r) => r.id));
  const existingCodes = new Set(list.map((r) => r.mpesaCode).filter(Boolean));

  // Reconcile with merchantSubscriptions if any are missing in subscriptionRequests
  (db.merchantSubscriptions || []).forEach((ms) => {
    if (!existingIds.has(ms.id) && !(ms.paymentCode && existingCodes.has(ms.paymentCode))) {
      const m = userMap.get(ms.merchantId);
      const plan = resolvePlan(ms.tierId);
      list.push({
        id: ms.id,
        merchantId: ms.merchantId,
        merchantName: m?.name || 'Merchant',
        shopName: m?.shopName || m?.name || 'Store',
        phone: m?.phone || '',
        email: m?.email || '',
        planId: ms.tierId,
        planKey: plan?.key || 'custom',
        planName: ms.tierName || plan?.name || 'Merchant Plan',
        amountExpected: ms.amount,
        billingPeriod: ms.billingPeriod || 'monthly',
        paymentMethod: ms.paymentMethod === 'wallet_credit' ? 'wallet' : ms.paymentMethod === 'wallet_coins' ? 'coins' : 'mpesa',
        mpesaCode: ms.paymentCode,
        status: ms.status === 'active' ? 'approved' : ms.status === 'declined' ? 'rejected' : 'pending',
        createdAt: ms.createdAt,
        updatedAt: ms.createdAt,
      });
    }
  });

  if (statusFilter) {
    list = list.filter((r) => r.status.toLowerCase() === statusFilter);
  }

  // Sort latest first
  list.sort((a, b) => b.createdAt - a.createdAt);
  const paged = paginateList(list, page, limit);

  res.json({
    success: true,
    requests: paged.items,
    pagination: paged.pagination,
  });
});

// ======================================================================
// 4. POST /admin/subscriptions/requests/:id/approve - Admin Only
// ======================================================================
subscriptionsRouter.post('/admin/subscriptions/requests/:id/approve', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrative access required' },
    });
  }

  const reqId = req.params.id;

  try {
    const result = await runDatabaseTransaction(async (db) => {
      if (!db.subscriptionRequests) db.subscriptionRequests = [];
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      if (!db.payments) db.payments = [];
      if (!db.userNotifications) db.userNotifications = [];

      let targetReq = db.subscriptionRequests.find((r) => r.id === reqId);
      let targetSub = db.merchantSubscriptions.find((s) => s.id === reqId);

      // Idempotency: if already approved, return success without duplicating
      if (targetReq && targetReq.status === 'approved') {
        return { request: targetReq, message: 'Subscription request is already approved.' };
      }
      if (targetSub && targetSub.status === 'active') {
        return { request: targetReq || targetSub, message: 'Subscription is already active.' };
      }

      if (!targetReq && !targetSub) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Subscription request not found' };
      }

      const now = Date.now();
      const billingPeriod: 'monthly' | 'yearly' =
        targetReq?.billingPeriod === 'yearly' || targetSub?.billingPeriod === 'yearly' ? 'yearly' : 'monthly';
      const merchantId = targetReq?.merchantId || targetSub?.merchantId!;
      const merchantUser = db.users.find((u) => u.id === merchantId);
      if (!merchantUser) {
        throw { status: 404, code: 'MERCHANT_NOT_FOUND', message: 'Merchant account not found.' };
      }

      const planId = targetReq?.planId || targetSub?.tierId || 'tier_500';
      const plan = resolvePlan(planId, db);
      const mpesaCode = targetReq?.mpesaCode || targetSub?.paymentCode;
      if (mpesaCode) {
        const duplicateActive = db.subscriptionRequests.some(
          (r) => r.id !== reqId && r.mpesaCode === mpesaCode && r.status === 'approved'
        );
        if (duplicateActive) {
          throw {
            status: 409,
            code: 'DUPLICATE_CODE',
            message: `M-Pesa code ${mpesaCode} has already been approved for another subscription.`,
          };
        }
      }

      const subId = targetSub?.id || targetReq?.id || reqId;
      const activation = activateSubscriptionInTx(db, {
        merchantUser,
        planId,
        planName: plan?.name || targetSub?.tierName || 'Merchant Plan',
        billingPeriod,
        subscriptionId: subId,
        actorId: user.id,
        actorName: user.name,
        paymentSummary: mpesaCode ? `M-Pesa ${mpesaCode}` : 'Admin Approval',
        now,
      });

      if (targetReq) {
        targetReq.status = 'approved';
        targetReq.billingPeriod = billingPeriod;
        targetReq.adminId = user.id;
        targetReq.reviewedAt = now;
        targetReq.updatedAt = now;
      } else {
        targetReq = {
          id: targetSub!.id,
          merchantId,
          merchantName: merchantUser.name || 'Merchant',
          shopName: merchantUser.shopName || 'Store',
          planId,
          planName: plan?.name || targetSub!.tierName,
          billingPeriod,
          amountExpected: targetSub!.amount,
          paymentMethod: 'mpesa',
          mpesaCode,
          status: 'approved',
          adminId: user.id,
          reviewedAt: now,
          createdAt: targetSub!.createdAt,
          updatedAt: now,
        };
        db.subscriptionRequests.unshift(targetReq);
      }

      if (targetSub) {
        targetSub.status = 'active';
        targetSub.billingPeriod = billingPeriod;
        targetSub.billingInterval = billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY';
        targetSub.startDate = activation.startDate;
        targetSub.expiresAt = activation.expiresAt;
        targetSub.currentPeriodEnd = activation.expiresAt;
        targetSub.approvedBy = user.id;
        targetSub.approvedAt = now;
      } else {
        db.merchantSubscriptions.unshift({
          id: subId,
          merchantId,
          tierId: planId,
          tierName: plan?.name || 'Merchant Plan',
          billingPeriod,
          billingInterval: billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
          autoRenew: true,
          currentPeriodEnd: activation.expiresAt,
          amount: targetReq.amountExpected,
          paymentMethod:
            targetReq.paymentMethod === 'wallet'
              ? 'wallet_credit'
              : targetReq.paymentMethod === 'coins'
              ? 'wallet_coins'
              : 'mpesa_till_paybill',
          paymentCode: mpesaCode,
          status: 'active',
          startDate: activation.startDate,
          expiresAt: activation.expiresAt,
          approvedBy: user.id,
          approvedAt: now,
          createdAt: targetReq.createdAt,
        });
      }

      if (mpesaCode) {
        const p = db.payments.find((pay) => pay.code === mpesaCode);
        if (p) {
          p.status = 'approved';
          p.approvedAt = now;
          p.verifiedAt = now;
          p.verifiedBy = user.name;
        }
      }

      return {
        merchantId,
        request: targetReq,
        activation,
        subscription: {
          id: subId,
          merchantId,
          tierId: planId,
          tierName: plan?.name || 'Merchant Plan',
          billingPeriod,
          status: 'active',
          startDate: activation.startDate,
          expiresAt: activation.expiresAt,
          activeUntil: activation.expiresAt,
        },
        message: `Subscription approved for ${merchantUser.name}! ${billingPeriod === 'yearly' ? '365-day yearly' : '30-day'} selling window is active.`,
      };
    });

    if ((result as any).merchantId && (result as any).activation) {
      const mId = (result as any).merchantId;
      const act = (result as any).activation;
      emitPlatformEvent(
        'subscription.activated',
        {
          merchantId: mId,
          subscriptionId: (result as any).subscription.id,
          notice: act.activationNotice,
          status: act.statusPayload,
          restoredProductIds: act.restoredProductIds,
        },
        [mId]
      );
      emitPlatformEvent('subscription.updated', { merchantId: mId, status: act.statusPayload }, [mId]);
    }

    return res.json({
      success: true,
      request: result.request,
      subscription: (result as any).subscription,
      activationNotice: (result as any).activation?.activationNotice || null,
      restoredProductIds: (result as any).activation?.restoredProductIds || [],
      message: result.message,
    });
  } catch (err: any) {
    console.error('Approve subscription request error:', err);
    return res.status(err.status || 500).json({
      error: { code: err.code || 'SERVER_ERROR', message: err.message || 'Failed to approve subscription request' },
    });
  }
});

// ======================================================================
// 5. POST /admin/subscriptions/requests/:id/reject - Admin Only
// ======================================================================
subscriptionsRouter.post('/admin/subscriptions/requests/:id/reject', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Administrative access required' },
    });
  }

  const reqId = req.params.id;
  const { reason } = req.body || {};
  const trimmedReason = String(reason || '').trim();

  if (!trimmedReason) {
    return res.status(400).json({
      error: { code: 'REASON_REQUIRED', message: 'A reason is mandatory when rejecting a subscription request.' },
    });
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      let targetReq = (db.subscriptionRequests || []).find((r) => r.id === reqId);
      let targetSub = (db.merchantSubscriptions || []).find((s) => s.id === reqId);

      if (!targetReq && !targetSub) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Subscription request not found' };
      }

      const now = Date.now();
      const merchantId = targetReq?.merchantId || targetSub?.merchantId!;
      const merchantUser = db.users.find((u) => u.id === merchantId);

      if (targetReq) {
        targetReq.status = 'rejected';
        targetReq.rejectionReason = trimmedReason;
        targetReq.adminId = user.id;
        targetReq.reviewedAt = now;
        targetReq.updatedAt = now;
      }

      if (targetSub) {
        targetSub.status = 'declined';
      }

      // Reject in payments queue
      const mpesaCode = targetReq?.mpesaCode || targetSub?.paymentCode;
      if (mpesaCode && db.payments) {
        const p = db.payments.find((pay) => pay.code === mpesaCode);
        if (p) {
          p.status = 'rejected';
          p.rejectionReason = trimmedReason;
        }
      }

      // Set merchant subscription status to inactive if no other active sub
      if (merchantUser) {
        const hasOtherActive = (db.merchantSubscriptions || []).some(
          (s) => s.id !== reqId && s.merchantId === merchantId && s.status === 'active' && s.expiresAt && s.expiresAt > now
        );
        if (!hasOtherActive) {
          merchantUser.merchantSubscriptionStatus = 'inactive';
        }

        // Notify merchant in-app
        if (!db.userNotifications) db.userNotifications = [];
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: merchantUser.id,
          title: '⚠️ Subscription Request Rejected',
          message: `Your merchant plan request was rejected by Admin. Reason: ${trimmedReason}. Please check your transaction details and resubmit.`,
          type: 'system',
          read: false,
          timestamp: now,
        });
      }

      logAudit(
        db,
        user.id,
        user.name,
        'SUBSCRIPTION_REQUEST_REJECTED',
        `Rejected subscription request ${reqId} for merchant #${merchantId}. Reason: ${trimmedReason}`
      );

      return {
        request: targetReq || targetSub,
        message: 'Subscription request has been rejected.',
      };
    });

    return res.json({
      success: true,
      request: result.request,
      message: result.message,
    });
  } catch (err: any) {
    console.error('Reject subscription request error:', err);
    return res.status(err.status || 500).json({
      error: { code: err.code || 'SERVER_ERROR', message: err.message || 'Failed to reject subscription request' },
    });
  }
});

// ======================================================================
// 6. ITEM 2: UNIFIED SUBSCRIPTION TIERS & YEARLY BILLING LIFECYCLE
// ======================================================================

subscriptionsRouter.get('/subscription-tiers', async (_req: Request, res: Response) => {
  const db = await getDatabase();
  const tiers = getComputedSubscriptionTiers(db);
  return res.json({ tiers });
});

const AdminUpdateTierSchema = z.object({
  monthlyFee: z.coerce.number().int().positive().max(1000000).optional(),
  yearlyFee: z.coerce.number().int().positive().max(12000000).optional(),
  yearlyDiscountPercent: z.coerce.number().min(0).max(90).optional(),
});

subscriptionsRouter.patch('/admin/subscription-tiers/:id', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserAdmin(user)) return sendApiError(res, 403, 'FORBIDDEN', 'Administrator access required');

  const tierId = String(req.params.id || '').trim();
  const parsed = AdminUpdateTierSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error);

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === tierId || p.key === tierId);
  if (!plan) return sendApiError(res, 404, 'NOT_FOUND', 'Subscription tier not found');

  const { tier: updatedTier, tiers: updatedTiers } = await runDatabaseTransaction(async (db) => {
    if (!db.tierOverrides) db.tierOverrides = {};
    const existing = db.tierOverrides[plan.id] || {};
    const nextOverride = { ...existing, ...parsed.data };
    db.tierOverrides[plan.id] = nextOverride;
    const tiers = getComputedSubscriptionTiers(db);
    const tier = tiers.find((t) => t.id === plan.id)!;
    logAudit(
      db,
      user.id,
      user.name,
      'SUBSCRIPTION_TIER_UPDATED',
      `Updated ${plan.name}: KSh ${tier.monthlyFee}/mo, KSh ${tier.yearlyFee}/yr (${tier.yearlyDiscountPercent}% savings)`
    );
    return { tier, tiers };
  });

  emitPlatformEvent('subscription.updated', { tier: updatedTier, tiers: updatedTiers });
  return res.json({ success: true, tier: updatedTier, tiers: updatedTiers });
});

subscriptionsRouter.get('/merchant/subscription', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');

  const db = await getDatabase();
  const tiers = getComputedSubscriptionTiers(db);
  const now = Date.now();
  const activeSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === user.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
  );
  const pendingSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === user.id && s.status === 'pending'
  );
  const latestSub = activeSub || (db.merchantSubscriptions || []).find((s) => s.merchantId === user.id) || null;
  const tier = tiers.find((t) => t.id === (activeSub?.tierId || pendingSub?.tierId || latestSub?.tierId)) || tiers[0];
  const billingPeriod = activeSub?.billingPeriod || (activeSub?.billingInterval === 'YEARLY' ? 'yearly' : 'monthly');
  const daysRemaining =
    activeSub?.expiresAt && activeSub.expiresAt > now
      ? Math.max(0, Math.ceil((activeSub.expiresAt - now) / 86400000))
      : 0;

  return res.json({
    hasSubscription: Boolean(activeSub),
    isExpired: !activeSub,
    daysRemaining,
    billingPeriod,
    billingInterval: billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
    autoRenew: activeSub ? activeSub.autoRenew !== false : false,
    nextRenewalDate: activeSub?.expiresAt || null,
    canceledAt: activeSub?.canceledAt || null,
    subscription: activeSub || latestSub,
    pendingSubscription: pendingSub || null,
    tier,
    tiers,
  });
});

const CreateMerchantSubscriptionSchema = z.object({
  tierId: z.string().min(1).optional(),
  planId: z.string().min(1).optional(),
  interval: z.enum(['MONTHLY', 'YEARLY', 'monthly', 'yearly']).optional(),
  billingPeriod: z.enum(['monthly', 'yearly']).optional(),
  paymentMethod: z.enum(['mpesa', 'wallet', 'coins', 'wallet_credit', 'wallet_coins']).default('wallet'),
  mpesaCode: z.string().optional(),
  autoRenew: z.boolean().optional(),
});

subscriptionsRouter.post('/merchant/subscription', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can subscribe to a merchant plan');
  }

  const parsed = CreateMerchantSubscriptionSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error);

  const data = parsed.data;
  const planKeyOrId = data.tierId || data.planId;
  if (!planKeyOrId) {
    return sendApiError(res, 400, 'VALIDATION_ERROR', 'tierId or planId is required', { tierId: 'Select a subscription tier' });
  }

  const normalizedPeriod: 'monthly' | 'yearly' =
    (data.billingPeriod || data.interval || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const normalizedMethod: 'mpesa' | 'wallet' | 'coins' =
    data.paymentMethod === 'wallet' || data.paymentMethod === 'wallet_credit'
      ? 'wallet'
      : data.paymentMethod === 'coins' || data.paymentMethod === 'wallet_coins'
      ? 'coins'
      : 'mpesa';

  const cleanedCode = data.mpesaCode ? data.mpesaCode.trim().toUpperCase() : undefined;
  if (normalizedMethod === 'mpesa' && (!cleanedCode || !/^[A-Z0-9]{10}$/.test(cleanedCode))) {
    return sendApiError(
      res,
      422,
      'INVALID_MPESA_CODE',
      'Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN (letters and digits only).',
      { mpesaCode: '10-character M-Pesa code required' }
    );
  }

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const targetPlan = resolvePlan(planKeyOrId, db);
      if (!targetPlan) {
        throw { status: 422, code: 'INVALID_PLAN', message: 'Invalid merchant subscription tier.' };
      }

      const merchantUser = db.users.find((u) => u.id === user.id);
      if (!merchantUser) throw { status: 404, code: 'NOT_FOUND', message: 'Merchant account not found.' };

      const now = Date.now();
      if (!db.subscriptionRequests) db.subscriptionRequests = [];
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      if (!db.payments) db.payments = [];
      if (!db.userNotifications) db.userNotifications = [];

      const amountExpected = normalizedPeriod === 'yearly' ? targetPlan.yearlyFee : targetPlan.monthlyFee;
      const amountCents = toCents(amountExpected);
      const billingInterval = normalizedPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY';
      const subId = `sub_${now}_${crypto.randomBytes(3).toString('hex')}`;

      if (normalizedMethod === 'wallet') {
        const adminUser = findPlatformAdminUser(db);
        let nextMerchantBalanceKes = 0;
        if (adminUser && adminUser.id !== merchantUser.id) {
          const txRes = transferBetweenWalletsCents(db, {
            fromUserId: merchantUser.id,
            fromRole: 'merchant',
            toUserId: adminUser.id,
            toRole: 'admin',
            amountCents,
            debitCategory: 'SUBSCRIPTION_PAYMENT',
            creditCategory: 'SUBSCRIPTION_REVENUE',
            referenceId: subId,
            idempotencyKey: `sub_pay_${subId}`,
            note: `Merchant ${normalizedPeriod} subscription for ${targetPlan.name}`,
            actorId: merchantUser.id,
          });
          nextMerchantBalanceKes = txRes.fromWallet.balanceCents / 100;
        } else {
          const txRes = debitWalletCents(db, {
            userId: merchantUser.id,
            role: 'merchant',
            amountCents,
            category: 'SUBSCRIPTION_PAYMENT',
            referenceId: subId,
            idempotencyKey: `sub_pay_${subId}`,
            note: `Merchant ${normalizedPeriod} subscription for ${targetPlan.name}`,
            actorId: merchantUser.id,
          });
          nextMerchantBalanceKes = txRes.wallet.balanceCents / 100;
        }
        if (!db.storeCreditLedger) db.storeCreditLedger = [];
        db.storeCreditLedger.unshift({
          id: db.nextIds.ledger++,
          userId: merchantUser.id,
          amount: -amountExpected,
          balanceAfter: nextMerchantBalanceKes,
          type: 'transfer_out',
          referenceId: `SUB-${now}`,
          note: `Merchant ${normalizedPeriod} subscription for ${targetPlan.name}`,
          createdAt: now,
        });
      } else if (normalizedMethod === 'coins') {
        if ((merchantUser.coins || 0) < amountExpected) {
          throw {
            status: 400,
            code: 'INSUFFICIENT_COINS',
            message: `Insufficient coins. Need ${amountExpected}, available ${merchantUser.coins || 0}.`,
          };
        }
        merchantUser.coins = (merchantUser.coins || 0) - amountExpected;
      }

      const isInstant = normalizedMethod !== 'mpesa';
      const reqRecord: SubscriptionRequest = {
        id: subId,
        merchantId: user.id,
        merchantName: merchantUser.name,
        shopName: merchantUser.shopName || merchantUser.name,
        phone: merchantUser.phone || undefined,
        email: merchantUser.email,
        planId: targetPlan.id,
        planKey: targetPlan.key,
        planName: targetPlan.name,
        billingPeriod: normalizedPeriod,
        amountExpected,
        paymentMethod: normalizedMethod,
        mpesaCode: cleanedCode,
        status: isInstant ? 'approved' : 'pending',
        approvedBy: isInstant ? merchantUser.id : undefined,
        approvedAt: isInstant ? now : undefined,
        createdAt: now,
        updatedAt: now,
      };
      db.subscriptionRequests.unshift(reqRecord);

      const subRecord = {
        id: subId,
        merchantId: user.id,
        tierId: targetPlan.id,
        tierName: targetPlan.name,
        billingPeriod: normalizedPeriod,
        billingInterval: billingInterval as 'MONTHLY' | 'YEARLY',
        autoRenew: data.autoRenew !== false,
        canceledAt: null,
        currentPeriodEnd: null as number | null,
        amount: amountExpected,
        paymentMethod: (normalizedMethod === 'wallet'
          ? 'wallet_credit'
          : normalizedMethod === 'coins'
          ? 'wallet_coins'
          : 'mpesa_till_paybill') as 'wallet_credit' | 'wallet_coins' | 'mpesa_till_paybill',
        paymentCode: cleanedCode,
        status: (isInstant ? 'active' : 'pending') as 'active' | 'pending',
        approvedBy: isInstant ? merchantUser.id : undefined,
        approvedAt: isInstant ? now : undefined,
        startDate: undefined as number | undefined,
        expiresAt: undefined as number | undefined,
        createdAt: now,
      };
      db.merchantSubscriptions.unshift(subRecord);

      let activationInfo: ReturnType<typeof activateSubscriptionInTx> | null = null;
      if (isInstant) {
        activationInfo = activateSubscriptionInTx(db, {
          merchantUser,
          planId: targetPlan.id,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          subscriptionId: subId,
          actorId: merchantUser.id,
          actorName: merchantUser.name,
          paymentSummary: normalizedMethod === 'wallet' ? 'Merchant Wallet Credit' : 'Wallet Coins',
          now,
        });
        subRecord.startDate = activationInfo.startDate;
        subRecord.expiresAt = activationInfo.expiresAt;
        subRecord.currentPeriodEnd = activationInfo.expiresAt;
      } else {
        merchantUser.merchantSubscriptionStatus = 'pending_verification';
        logAudit(
          db,
          user.id,
          user.name,
          'MERCHANT_SUBSCRIPTION_CREATED',
          `Submitted ${normalizedPeriod} subscription (${targetPlan.name}, KSh ${amountExpected}) via M-Pesa code ${cleanedCode}`
        );
      }

      return {
        request: reqRecord,
        subscription: subRecord,
        user: sanitizeUser(merchantUser),
        activationInfo,
        isInstant,
      };
    });

    if (result.isInstant && result.activationInfo) {
      emitPlatformEvent(
        'subscription.activated',
        {
          merchantId: result.user.id,
          subscription: result.subscription,
          notice: result.activationInfo.activationNotice,
          status: result.activationInfo.statusPayload,
          restoredProductIds: result.activationInfo.restoredProductIds,
        },
        [result.user.id]
      );
      emitPlatformEvent('user.wallet.updated', { userId: result.user.id }, [result.user.id]);
    }
    emitPlatformEvent('subscription.updated', {
      merchantId: result.user.id,
      subscription: result.subscription,
    });

    return res.status(201).json({
      success: true,
      request: result.request,
      subscription: result.subscription,
      user: result.user,
      restoredProductIds: result.activationInfo?.restoredProductIds || [],
      notice: result.activationInfo?.activationNotice || null,
      message: `Subscription ${result.subscription.status === 'active' ? 'activated' : 'submitted for admin approval'}.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'SUBSCRIPTION_ERROR', err.message || 'Subscription failed');
  }
});

const ChangeIntervalSchema = z.object({
  interval: z.enum(['MONTHLY', 'YEARLY', 'monthly', 'yearly']).optional(),
  billingPeriod: z.enum(['monthly', 'yearly']).optional(),
});

subscriptionsRouter.post('/merchant/subscription/change-interval', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can change billing interval');
  }

  const parsed = ChangeIntervalSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error);

  const rawInterval = parsed.data.billingPeriod || parsed.data.interval;
  if (!rawInterval) {
    return sendApiError(res, 400, 'VALIDATION_ERROR', 'billingPeriod or interval (monthly/yearly) is required');
  }
  const targetPeriod: 'monthly' | 'yearly' = rawInterval.toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  const targetInterval = targetPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY';

  try {
    const result = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const activeSub = (db.merchantSubscriptions || []).find(
        (s) => s.merchantId === user.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
      );
      if (!activeSub) {
        throw { status: 404, code: 'NO_ACTIVE_SUBSCRIPTION', message: 'No active merchant subscription found to update.' };
      }

      const plan = resolvePlan(activeSub.tierId, db);
      const nextRenewalRate = plan ? (targetPeriod === 'yearly' ? plan.yearlyFee : plan.monthlyFee) : activeSub.amount;
      activeSub.billingPeriod = targetPeriod;
      activeSub.billingInterval = targetInterval;
      activeSub.notes = `Renewal interval switched to ${targetInterval} (next renewal KSh ${nextRenewalRate.toLocaleString()})`;

      logAudit(
        db,
        user.id,
        user.name,
        'SUBSCRIPTION_INTERVAL_CHANGED',
        `Changed subscription #${activeSub.id} renewal interval to ${targetInterval} (next renewal KSh ${nextRenewalRate})`
      );

      return { subscription: activeSub, nextRenewalRate };
    });

    return res.json({
      success: true,
      subscription: result.subscription,
      billingPeriod: targetPeriod,
      billingInterval: targetInterval,
      nextRenewalRate: result.nextRenewalRate,
      message: `Renewal interval updated to ${targetPeriod === 'yearly' ? 'Yearly (365 days)' : 'Monthly (30 days)'} starting on next cycle.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'INTERVAL_CHANGE_ERROR', err.message || 'Failed to change interval');
  }
});

subscriptionsRouter.post('/merchant/subscription/cancel', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isUserMerchant(user) && !isUserAdmin(user)) {
    return sendApiError(res, 403, 'FORBIDDEN', 'Only merchants can cancel subscription auto-renewal');
  }

  try {
    const sub = await runDatabaseTransaction(async (db) => {
      const now = Date.now();
      const activeSub = (db.merchantSubscriptions || []).find(
        (s) => s.merchantId === user.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
      );
      if (!activeSub) {
        throw { status: 404, code: 'NO_ACTIVE_SUBSCRIPTION', message: 'No active merchant subscription found.' };
      }
      activeSub.autoRenew = false;
      activeSub.canceledAt = now;
      activeSub.currentPeriodEnd = activeSub.expiresAt || now;

      logAudit(
        db,
        user.id,
        user.name,
        'SUBSCRIPTION_AUTOREW_CANCELLED',
        `Cancelled auto-renewal for subscription #${activeSub.id}; access remains active until ${new Date(activeSub.expiresAt || now).toLocaleDateString()}`
      );
      return activeSub;
    });

    return res.json({
      success: true,
      subscription: sub,
      autoRenew: false,
      activeUntil: sub.expiresAt,
      message: `Auto-renewal cancelled. Your merchant access remains active until ${new Date(sub.expiresAt || Date.now()).toLocaleDateString()}.`,
    });
  } catch (err: any) {
    return sendApiError(res, err.status || 500, err.code || 'CANCEL_ERROR', err.message || 'Failed to cancel auto-renewal');
  }
});

// ======================================================================
// 7. AFRICA/NAIROBI (EAT) SUBSCRIPTION COUNTDOWN, ALARM & THANK-YOU NOTICES
// ======================================================================
subscriptionsRouter.get('/merchant/subscription/status', async (req: Request, res: Response) => {
  const auth = await resolveAuthenticatedSession(req, undefined, { touchActivity: true });
  if (!auth.user) {
    return sendApiError(res, 401, auth.errorCode || 'UNAUTHORIZED', auth.errorMessage || 'Authentication required');
  }

  await enforceExpiredSubscriptions(auth.user.id);
  const db = await getDatabase();
  const now = Date.now();
  const dbUser = db.users.find((u) => u.id === auth.user!.id) || auth.user;

  const activeSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === dbUser.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > now)
  );
  const pendingSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === dbUser.id && s.status === 'pending'
  );
  const latestSub =
    activeSub ||
    (db.merchantSubscriptions || []).find((s) => s.merchantId === dbUser.id) ||
    null;

  const expiresAt = activeSub?.expiresAt || dbUser.merchantSubscriptionExpiresAt || latestSub?.expiresAt || null;
  const isActive = Boolean(
    activeSub ||
      (dbUser.merchantSubscriptionStatus === 'active' &&
        dbUser.merchantSubscriptionExpiresAt &&
        dbUser.merchantSubscriptionExpiresAt > now)
  );

  const eatStatus = computeSubscriptionStatusEat(expiresAt, isActive, now);
  const tiers = getComputedSubscriptionTiers(db);
  const tier = tiers.find((t) => t.id === (activeSub?.tierId || dbUser.merchantSubscriptionPlan || latestSub?.tierId)) || null;

  return res.json({
    ...eatStatus,
    hasActiveSubscription: eatStatus.status === 'ACTIVE',
    hasPendingRequest: Boolean(pendingSub),
    pendingSubscription: pendingSub || null,
    activeSubscription: activeSub || null,
    latestSubscription: latestSub,
    planId: tier?.id || activeSub?.tierId || dbUser.merchantSubscriptionPlan || null,
    planName: tier?.name || activeSub?.tierName || null,
    billingPeriod: activeSub?.billingPeriod || latestSub?.billingPeriod || 'monthly',
    renewalMode: SUBSCRIPTION_RENEWAL_MODE,
    warningMessage:
      eatStatus.alarm_level === 'RED' && eatStatus.status === 'ACTIVE'
        ? 'Your subscription is running out. Top up / renew now to keep your listings live.'
        : eatStatus.status === 'EXPIRED'
        ? 'Your subscription has expired. Listings are hidden until you renew.'
        : null,
  });
});

subscriptionsRouter.get('/merchant/notices/pending', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required');

  const db = await getDatabase();
  const pending = (db.subscriptionActivationNotices || []).filter(
    (n) => n.merchantId === user.id && !n.seenAt
  );
  return res.json({ notices: pending });
});

subscriptionsRouter.post('/merchant/notices/:id/seen', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required');

  const noticeId = String(req.params.id || '').trim();
  const result = await runDatabaseTransaction(async (db) => {
    const notice = (db.subscriptionActivationNotices || []).find(
      (n) => n.id === noticeId && n.merchantId === user.id
    );
    if (!notice) return null;
    if (!notice.seenAt) {
      notice.seenAt = Date.now();
    }
    return notice;
  });

  if (!result) {
    return sendApiError(res, 404, 'NOT_FOUND', 'Activation notice not found');
  }
  return res.json({ success: true, notice: result });
});
