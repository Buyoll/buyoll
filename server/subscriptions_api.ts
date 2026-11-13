import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase, logAudit, runDatabaseTransaction } from './db.js';
import { User, SubscriptionRequest, MerchantSubscriptionTier } from '../src/types.js';

export const subscriptionsRouter = Router();

// Standard 6-Tier Merchant Subscription Catalog (Single source of truth)
export const SUBSCRIPTION_PLANS: Array<{
  id: string;
  key: string;
  name: string;
  monthlyFee: number;
  yearlyFee: number;
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
    yearlyFee: 3000,
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
    yearlyFee: 6000,
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
    yearlyFee: 18000,
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
    yearlyFee: 42000,
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
    yearlyFee: 90000,
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
    yearlyFee: 180000,
    maxProducts: -1, // Unlimited
    maxGroupsPerProduct: 100,
    description: 'Custom SLA and limits set by Buyoll Admin.',
    features: ['Unlimited products', 'Up to 100 groups per product', 'Custom SLA'],
  },
];

export function resolvePlan(keyOrId: string) {
  if (!keyOrId) return null;
  const norm = String(keyOrId).toLowerCase().trim();
  return (
    SUBSCRIPTION_PLANS.find(
      (p) => p.id.toLowerCase() === norm || p.key.toLowerCase() === norm
    ) || null
  );
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

// Helper to authenticate user from headers or cookies
async function getAuthUser(req: Request): Promise<User | null> {
  const userIdHeader = req.headers['x-user-id'] || req.headers['authorization'];
  let uid: number | null = null;

  if (userIdHeader) {
    const idStr = String(userIdHeader).replace(/^Bearer\s+/, '').trim();
    const parsed = Number(idStr);
    if (!isNaN(parsed) && parsed > 0) uid = parsed;
  }

  const db = await getDatabase();

  // Also check cookie session token if header is not present
  if (!uid && req.headers.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
      })
    );
    if (cookies.buyoll_session) {
      const sessUser = db.users.find((u) => u.sessionToken === cookies.buyoll_session);
      if (sessUser) return sessUser;
    }
  }

  if (!uid) return null;
  return db.users.find((u) => u.id === uid) || null;
}

function isUserAdmin(u: User | null): boolean {
  if (!u) return false;
  return (
    u.activeRole === 'admin' ||
    u.role === 'admin' ||
    (Array.isArray(u.roles) && u.roles.includes('admin')) ||
    u.id === 1
  );
}

function isUserMerchant(u: User | null): boolean {
  if (!u) return false;
  return (
    u.activeRole === 'merchant' ||
    u.role === 'merchant' ||
    (Array.isArray(u.roles) && u.roles.includes('merchant')) ||
    u.id === 2 ||
    u.id === 11 ||
    u.id === 12
  );
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

      // 1. Check if user already has an active 30-day subscription (reject upgrades until cycle expires)
      const hasActiveCycle =
        (db.merchantSubscriptions || []).some(
          (s) => s.merchantId === user.id && s.status === 'active' && s.expiresAt && s.expiresAt > now
        ) ||
        (merchantUser.merchantSubscriptionStatus === 'active' &&
          merchantUser.merchantSubscriptionExpiresAt &&
          merchantUser.merchantSubscriptionExpiresAt > now);

      if (hasActiveCycle) {
        const expDate = merchantUser.merchantSubscriptionExpiresAt
          ? new Date(merchantUser.merchantSubscriptionExpiresAt).toLocaleDateString()
          : 'the end of your 30-day cycle';
        throw {
          status: 409,
          code: 'ACTIVE_CYCLE_EXISTS',
          message: `Your current 30-day subscription is still active until ${expDate}. Upgrade becomes available once this cycle expires.`,
        };
      }

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

      const amountExpected = normalizedPeriod === 'yearly' ? targetPlan.yearlyFee : targetPlan.monthlyFee; // DERIVED SERVER-SIDE FROM PLAN CATALOG

      // METHOD A: M-PESA TILL / PAYBILL (Creates Pending Request for Admin Review)
      if (normalizedMethod === 'mpesa') {
        const newReq: SubscriptionRequest = {
          id: `sub_req_${now}_${Math.random().toString(36).substring(2, 6)}`,
          merchantId: user.id,
          merchantName: user.name,
          shopName: user.shopName || user.name,
          phone: user.phone,
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
          userPhone: user.phone,
          code: cleanedCode!,
          amount: amountExpected,
          status: 'pending',
          type: 'merchant_subscription',
          channel: 'Buy Goods Till 196853 / Paybill 522533',
          createdAt: now,
          verifiedAt: null,
          verifiedBy: null,
          notes: `Subscription request for ${targetPlan.name}. Code: ${cleanedCode}. Pending Admin Approval.`,
        });

        merchantUser.merchantSubscriptionStatus = 'pending_verification';

        // Notify merchant in-app
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: user.id,
          title: `⏳ Subscription Code Submitted: ${targetPlan.name}`,
          message: `M-Pesa confirmation code ${cleanedCode} for KSh ${amountExpected.toLocaleString()} submitted. Admin will verify against statements and activate your store for 30 days.`,
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

      // METHOD B: MERCHANT WALLET (Instant Atomic Activation)
      if (normalizedMethod === 'wallet') {
        const walletCredit = merchantUser.roleWallets?.merchant?.credit ?? merchantUser.credit ?? 0;
        if (walletCredit < amountExpected) {
          throw {
            status: 400,
            code: 'INSUFFICIENT_BALANCE',
            message: `Insufficient merchant wallet balance. You have KSh ${walletCredit.toLocaleString()} but need KSh ${amountExpected.toLocaleString()} for the ${targetPlan.name}.`,
          };
        }

        // Deduct atomically
        if (!merchantUser.roleWallets) merchantUser.roleWallets = {};
        if (!merchantUser.roleWallets.merchant) merchantUser.roleWallets.merchant = { credit: 0, coins: 0, points: 0 };
        merchantUser.roleWallets.merchant.credit = Math.max(0, merchantUser.roleWallets.merchant.credit - amountExpected);
        if ((merchantUser.activeRole || merchantUser.role) === 'merchant') {
          merchantUser.credit = merchantUser.roleWallets.merchant.credit;
        }

        // Ledger entry
        if (!db.storeCreditLedger) db.storeCreditLedger = [];
        db.storeCreditLedger.unshift({
          id: db.nextIds.ledger++,
          userId: merchantUser.id,
          amount: -amountExpected,
          balanceAfter: merchantUser.roleWallets.merchant.credit,
          type: 'transfer_out',
          referenceId: `SUB-${now}`,
          note: `Merchant subscription fee for ${targetPlan.name} (Instant Activation)`,
          createdAt: now,
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
          phone: user.phone,
          email: user.email,
          planId: targetPlan.id,
          planKey: targetPlan.key,
          planName: targetPlan.name,
          billingPeriod: normalizedPeriod,
          amountExpected,
          paymentMethod: 'wallet',
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
          amount: amountExpected,
          paymentMethod: 'wallet_credit',
          status: 'active',
          startDate: now,
          expiresAt,
          createdAt: now,
        });

        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: user.id,
          title: `🎉 ${normalizedPeriod === 'yearly' ? 'Yearly' : '30-Day'} Merchant Plan Active: ${targetPlan.name}`,
          message: `KSh ${amountExpected.toLocaleString()} paid from Merchant Wallet. Store catalog limits active for ${durationLabel} until ${new Date(expiresAt).toLocaleDateString()}.`,
          type: 'payment',
          read: false,
          timestamp: now,
        });

        logAudit(
          db,
          user.id,
          user.name,
          'SUBSCRIPTION_WALLET_ACTIVATED',
          `Instantly activated ${targetPlan.name} (${normalizedPeriod}) via Merchant Wallet`
        );

        return {
          request: newReq,
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
          phone: user.phone,
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

    return res.status(201).json({
      success: true,
      request: result.request,
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
  const db = await getDatabase();

  let list = db.subscriptionRequests || [];

  // Reconcile with merchantSubscriptions if any are missing in subscriptionRequests
  (db.merchantSubscriptions || []).forEach((ms) => {
    if (!list.some((r) => r.id === ms.id || (ms.paymentCode && r.mpesaCode === ms.paymentCode))) {
      const m = db.users.find((u) => u.id === ms.merchantId);
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

  res.json({
    success: true,
    requests: list,
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
      const durationDays = billingPeriod === 'yearly' ? 365 : 30;
      const expiresAt = now + durationDays * 86400000;
      const merchantId = targetReq?.merchantId || targetSub?.merchantId!;
      const merchantUser = db.users.find((u) => u.id === merchantId);

      const planId = targetReq?.planId || targetSub?.tierId || 'tier_500';
      const plan = resolvePlan(planId);

      // Check duplicate code against other approved requests
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

      // Update SubscriptionRequest record
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
          merchantName: merchantUser?.name || 'Merchant',
          shopName: merchantUser?.shopName || 'Store',
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

      // Update merchantSubscriptions record
      if (targetSub) {
        targetSub.status = 'active';
        targetSub.billingPeriod = billingPeriod;
        targetSub.startDate = now;
        targetSub.expiresAt = expiresAt;
      } else {
        db.merchantSubscriptions.unshift({
          id: targetReq.id,
          merchantId,
          tierId: planId,
          tierName: plan?.name || 'Merchant Plan',
          billingPeriod,
          amount: targetReq.amountExpected,
          paymentMethod: targetReq.paymentMethod === 'wallet' ? 'wallet_credit' : targetReq.paymentMethod === 'coins' ? 'wallet_coins' : 'mpesa_till_paybill',
          paymentCode: mpesaCode,
          status: 'active',
          startDate: now,
          expiresAt,
          createdAt: targetReq.createdAt,
        });
      }

      // Approve in payments queue
      if (mpesaCode) {
        const p = db.payments.find((pay) => pay.code === mpesaCode);
        if (p) {
          p.status = 'approved';
          p.approvedAt = now;
          p.verifiedAt = now;
          p.verifiedBy = user.name;
        }
      }

      // Update merchant user state
      if (merchantUser) {
        merchantUser.merchantSubscriptionStatus = 'active';
        merchantUser.merchantSubscriptionPlan = planId as any;
        merchantUser.merchantSubscriptionExpiresAt = expiresAt;
        merchantUser.verified = true;
        merchantUser.verifiedAt = now;

        // In-app notification to merchant
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: merchantUser.id,
          title: `🎉 ${billingPeriod === 'yearly' ? 'Yearly' : '30-Day'} Merchant Plan Approved: ${plan?.name || 'Store'}`,
          message: `Your payment code ${mpesaCode || ''} has been approved by Buyoll Admin! Your ${billingPeriod === 'yearly' ? '1-year (365 days)' : '30-day'} selling window and catalog limits are active until ${new Date(expiresAt).toLocaleDateString()}.`,
          type: 'payment',
          read: false,
          timestamp: now,
        });
      }

      logAudit(
        db,
        user.id,
        user.name,
        'SUBSCRIPTION_REQUEST_APPROVED',
        `Approved ${billingPeriod} subscription request ${reqId} for merchant #${merchantId} (${plan?.name || planId})`
      );

      return {
        request: targetReq,
        subscription: {
          id: targetReq?.id || targetSub?.id,
          merchantId,
          tierId: planId,
          tierName: plan?.name || 'Merchant Plan',
          billingPeriod,
          status: 'active',
          startDate: now,
          expiresAt,
          activeUntil: expiresAt,
        },
        message: `Subscription approved for ${merchantUser?.name || 'merchant'}! ${billingPeriod === 'yearly' ? '365-day yearly' : '30-day'} selling window is active.`,
      };
    });

    return res.json({
      success: true,
      request: result.request,
      subscription: (result as any).subscription,
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
