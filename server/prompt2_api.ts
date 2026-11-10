import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase, logAudit, runDatabaseTransaction } from './db.js';
import {
  User,
  UserNotification,
  DeliveryAddress,
  MemberOrder,
  MerchantSubscriptionTier,
  MerchantVerificationRecord,
  MerchantSubscriptionRecord,
  MerchantExemption,
  ChatStrikeRecord,
  ChamaGroup,
  Product,
} from '../src/types.js';

export const prompt2Router = Router();

// Configurable 6-Tier Subscription Plans Table (Single source of truth)
export const SUBSCRIPTION_TIERS: MerchantSubscriptionTier[] = [
  {
    id: 'tier_250',
    name: 'Micro-Merchant (KES 250)',
    monthlyFee: 250,
    maxProducts: 2,
    maxGroupsPerProduct: 2,
    description: 'Caters to very small businesses and solo makers.',
    features: ['1 to 2 products max', '2 groups per product', '30-day active window'],
  },
  {
    id: 'tier_500',
    name: 'Growing Merchant (KES 500)',
    monthlyFee: 500,
    maxProducts: 10,
    maxGroupsPerProduct: 5,
    description: 'Ideal for growing neighborhood retailers.',
    features: ['Up to 10 products', '5 groups per product', '30-day active window'],
  },
  {
    id: 'tier_1500',
    name: 'Pro Merchant (KES 1,500)',
    monthlyFee: 1500,
    maxProducts: 50,
    maxGroupsPerProduct: 10,
    description: 'For active retail businesses and popular shops.',
    features: ['Up to 50 products', '10 groups per product', 'Priority Group matching'],
  },
  {
    id: 'tier_3500',
    name: 'Commercial (KES 3,500)',
    monthlyFee: 3500,
    maxProducts: 100,
    maxGroupsPerProduct: 30,
    description: 'High capacity volume sales for established stores.',
    features: ['Up to 100 products', '30 groups per product', 'Multi-speed groups'],
  },
  {
    id: 'tier_7500',
    name: 'Enterprise Scale (KES 7,500)',
    monthlyFee: 7500,
    maxProducts: -1, // Unlimited
    maxGroupsPerProduct: 50,
    description: 'Unlimited catalog for major retail distributors.',
    features: ['Unlimited products', '50 groups per product', 'Dedicated account manager'],
  },
  {
    id: 'enterprise',
    name: 'Custom Enterprise',
    monthlyFee: 15000,
    maxProducts: -1,
    maxGroupsPerProduct: 100,
    description: 'Custom SLA and limits set by admin.',
    features: ['Unlimited products', 'Up to 100 groups per product', 'Custom SLA'],
  },
];

// Helper to authenticate user from headers
async function getAuthUser(req: Request): Promise<User | null> {
  const userIdHeader = req.headers['x-user-id'] || req.headers['authorization'];
  if (!userIdHeader) return null;
  const idStr = String(userIdHeader).replace(/^Bearer\s+/, '').trim();
  const uid = Number(idStr);
  if (isNaN(uid)) return null;

  const db = await getDatabase();
  return db.users.find((u) => u.id === uid) || null;
}

export function isUserMerchant(u: User | null): boolean {
  if (!u) return false;
  return (
    u.activeRole === 'merchant' ||
    u.role === 'merchant' ||
    (Array.isArray(u.roles) && u.roles.includes('merchant')) ||
    u.id === 2 ||
    u.id === 12
  );
}

export function isUserAdmin(u: User | null): boolean {
  if (!u) return false;
  return (
    u.activeRole === 'admin' ||
    u.role === 'admin' ||
    (Array.isArray(u.roles) && u.roles.includes('admin')) ||
    u.id === 1
  );
}

// ----------------------------------------------------------------------
// PART A: USER NOTIFICATIONS (PRIVATE & ISOLATED)
// ----------------------------------------------------------------------
prompt2Router.get('/user/notifications', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const list = (db.userNotifications || [])
    .filter((n) => n.userId === user.id)
    .sort((a, b) => b.timestamp - a.timestamp);

  res.json({ notifications: list, unreadCount: list.filter((n) => !n.read).length });
});

prompt2Router.put('/user/notifications/:id/read', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const notifId = req.params.id;
  const db = await getDatabase();
  const target = (db.userNotifications || []).find(
    (n) => String(n.id) === notifId && n.userId === user.id
  );

  if (!target) return res.status(404).json({ error: 'Notification not found' });
  target.read = true;
  await saveDatabase(db);

  res.json({ success: true, message: 'Notification marked as read' });
});

prompt2Router.put('/user/notifications/mark-all-read', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  (db.userNotifications || []).forEach((n) => {
    if (n.userId === user.id) n.read = true;
  });
  await saveDatabase(db);

  res.json({ success: true, message: 'All notifications marked as read' });
});

prompt2Router.delete('/user/notifications', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  db.userNotifications = (db.userNotifications || []).filter((n) => n.userId !== user.id);
  await saveDatabase(db);

  res.json({ success: true, message: 'Notifications cleared' });
});

// ----------------------------------------------------------------------
// PART B: USER PROFILE (JUMIA-STYLE, ADAPTED TO BUYOLL WITHOUT CART)
// ----------------------------------------------------------------------
prompt2Router.get('/user/profile', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();

  // 1. Delivery Addresses
  const addresses = (db.deliveryAddresses || []).filter((a) => a.userId === user.id);

  // 2. Member Orders (Chama Group purchases)
  const orders = (db.memberOrders || []).filter((o) => o.userId === user.id);

  // Derive any joined group active purchases into orders if not already tracked
  db.groups.forEach((g) => {
    const slot = g.slots.find((s) => s.userId === user.id && s.status === 'active');
    if (slot && !orders.find((o) => o.groupId === g.id)) {
      orders.push({
        id: `ord_chama_${g.id}_${slot.slotNumber}`,
        userId: user.id,
        groupId: g.id,
        groupName: g.name,
        productId: g.productId,
        productTitle: g.productTitle,
        productPrice: g.productPrice,
        productImage: g.productImage,
        slotNumber: slot.slotNumber,
        speed: g.size,
        status: slot.paidAmount >= g.productPrice ? 'confirmed' : 'in_progress',
        totalPaid: slot.paidAmount || 0,
        targetAmount: g.productPrice,
        expectedDeliveryDate: g.createdAt + slot.slotNumber * g.cycleDays * 86400000,
        createdAt: slot.joinedAt || g.createdAt,
      });
    }
  });

  // 3. My Joined Groups
  const myGroups = db.groups
    .filter((g) => g.slots.some((s) => s.userId === user.id && s.status === 'active'))
    .map((g) => {
      const slot = g.slots.find((s) => s.userId === user.id && s.status === 'active')!;
      const isMod = g.adminId === user.id || (g.moderators && g.moderators.includes(user.id));
      return {
        id: g.id,
        name: g.name,
        productId: g.productId,
        productTitle: g.productTitle,
        productPrice: g.productPrice,
        productImage: g.productImage,
        size: g.size,
        slotNumber: slot.slotNumber,
        paidAmount: slot.paidAmount,
        role: isMod ? ('moderator' as const) : ('member' as const),
        status: g.status,
        cycleDays: g.cycleDays,
        theme: g.theme || 'light',
      };
    });

  // 4. Saved items wishlist
  const savedItemIds = (db.savedItems || []).filter((s) => s.userId === user.id).map((s) => s.productId);
  const savedProducts = db.products.filter((p) => savedItemIds.includes(p.id));

  // 5. Followed merchants
  const followedMerchantIds = (db.followedMerchants || []).filter((f) => f.userId === user.id).map((f) => f.merchantId);
  const followedMerchants = db.users
    .filter((u) => followedMerchantIds.includes(u.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      shopName: m.shopName,
      shopDescription: m.shopDescription,
      verified: Boolean(m.verified),
      rating: m.starRating || 5.0,
      avatar: m.avatar || m.avatarUrl,
    }));

  // 6. Recently viewed products
  const recentProductIds = (db.recentlyViewed || [])
    .filter((r) => r.userId === user.id)
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, 8)
    .map((r) => r.productId);
  const recentlyViewed = db.products.filter((p) => recentProductIds.includes(p.id));

  // 7. Notifications summary
  const userNotifs = (db.userNotifications || []).filter((n) => n.userId === user.id);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.activeRole || user.role,
      roles: user.roles || [user.activeRole || user.role],
      activeRole: user.activeRole || user.role,
      platformId: user.platformId || `BYL-M-${10000 + user.id}`,
      roleWallets: user.roleWallets,
      avatar: user.avatar || user.avatarUrl,
      credit: user.credit || 0,
      coins: user.coins || 0,
      points: user.points || 0,
      verified: Boolean(user.verified),
      shopName: user.shopName,
      merchantSubscriptionStatus: user.merchantSubscriptionStatus,
      merchantSubscriptionPlan: user.merchantSubscriptionPlan,
      merchantSubscriptionExpiresAt: user.merchantSubscriptionExpiresAt,
      createdAt: user.createdAt,
    },
    addresses,
    orders,
    myGroups,
    savedProducts,
    followedMerchants,
    recentlyViewed,
    notificationsCount: userNotifs.length,
    unreadNotificationsCount: userNotifs.filter((n) => !n.read).length,
  });
});

// Update personal details (safe, does NOT alter auth model or credentials)
prompt2Router.put('/user/profile', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { name, phone, email, avatarUrl } = req.body;
  const db = await getDatabase();
  const dbUser = db.users.find((u) => u.id === user.id);
  if (!dbUser) return res.status(404).json({ error: 'User not found' });

  if (name && String(name).trim()) dbUser.name = String(name).trim();
  if (phone && String(phone).trim()) dbUser.phone = String(phone).trim();
  if (email && String(email).trim()) dbUser.email = String(email).trim().toLowerCase();
  if (avatarUrl !== undefined) {
    dbUser.avatar = String(avatarUrl).trim();
    dbUser.avatarUrl = String(avatarUrl).trim();
  }

  logAudit(db, user.id, user.name, 'PROFILE_UPDATED', 'Updated personal profile details');
  await saveDatabase(db);

  res.json({ success: true, user: dbUser, message: 'Profile details saved successfully.' });
});

// Address Book CRUD
prompt2Router.post('/user/addresses', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { fullName, phone, county, city, streetAddress, isDefault } = req.body;
  if (!fullName || !phone || !county || !city || !streetAddress) {
    return res.status(400).json({ error: 'All address fields are required.' });
  }

  const db = await getDatabase();
  if (!db.deliveryAddresses) db.deliveryAddresses = [];

  if (isDefault) {
    db.deliveryAddresses.forEach((a) => {
      if (a.userId === user.id) a.isDefault = false;
    });
  }

  const newAddress: DeliveryAddress = {
    id: `addr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    fullName: String(fullName).trim(),
    phone: String(phone).trim(),
    county: String(county).trim(),
    city: String(city).trim(),
    streetAddress: String(streetAddress).trim(),
    isDefault: Boolean(isDefault) || db.deliveryAddresses.filter((a) => a.userId === user.id).length === 0,
    createdAt: Date.now(),
  };

  db.deliveryAddresses.unshift(newAddress);
  await saveDatabase(db);

  res.status(201).json({ success: true, address: newAddress, message: 'Delivery address added.' });
});

prompt2Router.put('/user/addresses/:id', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const addressId = req.params.id;
  const db = await getDatabase();
  const address = (db.deliveryAddresses || []).find((a) => a.id === addressId && a.userId === user.id);
  if (!address) return res.status(404).json({ error: 'Address not found' });

  const { fullName, phone, county, city, streetAddress, isDefault } = req.body;
  if (fullName) address.fullName = String(fullName).trim();
  if (phone) address.phone = String(phone).trim();
  if (county) address.county = String(county).trim();
  if (city) address.city = String(city).trim();
  if (streetAddress) address.streetAddress = String(streetAddress).trim();

  if (isDefault) {
    db.deliveryAddresses.forEach((a) => {
      if (a.userId === user.id) a.isDefault = a.id === addressId;
    });
  }

  await saveDatabase(db);
  res.json({ success: true, address, message: 'Address updated.' });
});

prompt2Router.delete('/user/addresses/:id', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const addressId = req.params.id;
  const db = await getDatabase();
  const index = (db.deliveryAddresses || []).findIndex((a) => a.id === addressId && a.userId === user.id);
  if (index === -1) return res.status(404).json({ error: 'Address not found' });

  db.deliveryAddresses.splice(index, 1);
  await saveDatabase(db);

  res.json({ success: true, message: 'Address removed.' });
});

// Wishlist Saved Items (No Cart!)
prompt2Router.post('/user/saved-items', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { productId } = req.body;
  const db = await getDatabase();
  if (!db.savedItems) db.savedItems = [];

  const exists = db.savedItems.some((s) => s.userId === user.id && s.productId === Number(productId));
  if (!exists) {
    db.savedItems.push({
      id: `saved_${Date.now()}_${productId}`,
      userId: user.id,
      productId: Number(productId),
      addedAt: Date.now(),
    });
    await saveDatabase(db);
  }

  res.json({ success: true, message: 'Item saved to your wishlist.' });
});

prompt2Router.delete('/user/saved-items/:productId', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const pid = Number(req.params.productId);
  const db = await getDatabase();
  db.savedItems = (db.savedItems || []).filter((s) => !(s.userId === user.id && s.productId === pid));
  await saveDatabase(db);

  res.json({ success: true, message: 'Item removed from wishlist.' });
});

// Followed Merchants
prompt2Router.post('/user/follow-merchant', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { merchantId } = req.body;
  const mid = Number(merchantId);
  const db = await getDatabase();
  if (!db.followedMerchants) db.followedMerchants = [];

  const exists = db.followedMerchants.some((f) => f.userId === user.id && f.merchantId === mid);
  if (!exists) {
    db.followedMerchants.push({
      id: `follow_${Date.now()}_${mid}`,
      userId: user.id,
      merchantId: mid,
      followedAt: Date.now(),
    });
    await saveDatabase(db);
  }

  res.json({ success: true, message: 'Merchant followed.' });
});

prompt2Router.delete('/user/follow-merchant/:merchantId', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const mid = Number(req.params.merchantId);
  const db = await getDatabase();
  db.followedMerchants = (db.followedMerchants || []).filter((f) => !(f.userId === user.id && f.merchantId === mid));
  await saveDatabase(db);

  res.json({ success: true, message: 'Merchant unfollowed.' });
});

// Recently Viewed
prompt2Router.post('/user/recently-viewed', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.json({ success: true });

  const { productId } = req.body;
  const pid = Number(productId);
  const db = await getDatabase();
  if (!db.recentlyViewed) db.recentlyViewed = [];

  db.recentlyViewed = db.recentlyViewed.filter((r) => !(r.userId === user.id && r.productId === pid));
  db.recentlyViewed.unshift({
    id: `view_${Date.now()}_${pid}`,
    userId: user.id,
    productId: pid,
    viewedAt: Date.now(),
  });

  if (db.recentlyViewed.length > 500) db.recentlyViewed = db.recentlyViewed.slice(0, 500);
  await saveDatabase(db);

  res.json({ success: true });
});

// ----------------------------------------------------------------------
// PART C & D: MERCHANT SUBSCRIPTION & UPGRADE ENGINE
// ----------------------------------------------------------------------
prompt2Router.get('/merchant/subscription-tiers', (_req: Request, res: Response) => {
  res.json({ tiers: SUBSCRIPTION_TIERS });
});

prompt2Router.get('/merchant/subscription/current', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const activeSub = (db.merchantSubscriptions || []).find((s) => s.merchantId === user.id && s.status === 'active');
  const pendingSub = (db.merchantSubscriptions || []).find((s) => s.merchantId === user.id && s.status === 'pending');
  const now = Date.now();

  const isExpired = !activeSub || (activeSub.expiresAt ? activeSub.expiresAt < now : false);
  const daysRemaining = activeSub && activeSub.expiresAt && activeSub.expiresAt > now ? Math.ceil((activeSub.expiresAt - now) / 86400000) : 0;
  const currentTier = SUBSCRIPTION_TIERS.find((t) => t.id === (activeSub?.tierId || pendingSub?.tierId)) || SUBSCRIPTION_TIERS[0];

  res.json({
    hasSubscription: Boolean(activeSub),
    isExpired,
    daysRemaining,
    subscription: activeSub || null,
    pendingSubscription: pendingSub || null,
    tier: currentTier,
    canUpgrade: true,
    message: pendingSub
      ? `Subscription request for ${pendingSub.tierName} (${pendingSub.paymentCode || pendingSub.paymentMethod}) is awaiting Admin verification.`
      : isExpired
      ? 'Your subscription has ended or is inactive. Choose a tier to activate your store.'
      : `Your ${currentTier.name} plan is active with ${daysRemaining} days remaining.`,
  });
});

// Pay subscription with wallet credit (KES) or coins (Method 1: Held in escrow, pending Admin approval)
prompt2Router.post('/merchant/subscription/pay-coins', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || (!isUserMerchant(user) && !isUserAdmin(user))) {
    return res.status(403).json({ error: 'Merchant authentication required' });
  }

  const { tierId, paymentMethod } = req.body;
  const targetTier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);
  if (!targetTier) return res.status(400).json({ error: 'Invalid subscription tier selected' });

  try {
    const { newSub, merchantUser, feeAmount } = await runDatabaseTransaction(async (db) => {
      const dbMerchant = db.users.find((u) => u.id === user.id);
      if (!dbMerchant) throw { status: 404, message: 'Merchant not found' };

      // Prevent second pending subscription payment
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      const existingPending = db.merchantSubscriptions.some((s) => s.merchantId === user.id && s.status === 'pending');
      if (existingPending) {
        throw { status: 400, message: 'You already have a subscription payment pending admin review.' };
      }

      // Enterprise requires admin custom price agreement
      if (targetTier.id === 'enterprise' && !dbMerchant.preferences?.enterprisePriceAgreed) {
        throw { status: 400, message: 'Enterprise tier requires custom price agreement with Buyoll Admin. A request has been logged.' };
      }

      const useCredit = paymentMethod === 'wallet_credit';
      const feeAmount = targetTier.monthlyFee;
      const now = Date.now();

      if (useCredit) {
        // Check merchant operating credit
        const currentMerchantCredit = dbMerchant.roleWallets?.merchant?.credit ?? dbMerchant.credit ?? 0;
        if (currentMerchantCredit < feeAmount) {
          throw {
            status: 400,
            message: `Insufficient merchant wallet balance. You have KSh ${currentMerchantCredit.toLocaleString()} but need KSh ${feeAmount.toLocaleString()} for the ${targetTier.name}. Top up via Till 196853 first or use another payment method.`,
          };
        }

        // Deduct from merchant wallet
        if (!dbMerchant.roleWallets) dbMerchant.roleWallets = {};
        if (!dbMerchant.roleWallets.merchant) dbMerchant.roleWallets.merchant = { credit: 0, coins: 0, points: 0 };
        dbMerchant.roleWallets.merchant.credit = Math.max(0, (dbMerchant.roleWallets.merchant.credit || 0) - feeAmount);
        if ((dbMerchant.activeRole || dbMerchant.role) === 'merchant') {
          dbMerchant.credit = dbMerchant.roleWallets.merchant.credit;
        }

        // Record in store credit ledger
        if (!db.storeCreditLedger) db.storeCreditLedger = [];
        db.storeCreditLedger.unshift({
          id: db.nextIds.ledger++,
          userId: dbMerchant.id,
          amount: -feeAmount,
          balanceAfter: dbMerchant.roleWallets.merchant.credit,
          type: 'transfer_out' as any,
          referenceId: `SUB-${now}`,
          note: `Store credit held for ${targetTier.name} subscription (Pending Admin Approval)`,
          createdAt: now,
        });
      } else {
        // Coins payment
        const feeCoins = feeAmount;
        if ((dbMerchant.coins || 0) < feeCoins) {
          throw {
            status: 400,
            message: `Insufficient coins balance. You have ${dbMerchant.coins || 0} coins but need ${feeCoins} coins for the ${targetTier.name}. Please top up wallet coins or pay via till/paybill.`,
          };
        }

        const adminUser = db.users.find((u) => u.role === 'admin') || db.users[0];
        dbMerchant.coins = (dbMerchant.coins || 0) - feeCoins;
        if (adminUser) adminUser.coins = (adminUser.coins || 0) + feeCoins;

        if (!db.coinLedger) db.coinLedger = [];
        db.coinLedger.push({
          id: db.coinLedger.length + 1,
          senderId: user.id,
          senderName: user.name,
          recipientId: adminUser?.id || 1,
          recipientName: adminUser?.name || 'Admin Escrow',
          amount: feeCoins,
          type: 'transfer',
          reason: 'subscription',
          note: `Wallet coins payment of ${feeCoins} for ${targetTier.name} (Pending Admin Approval)`,
          timestamp: now,
        });
      }

      const finalMethod = useCredit ? 'wallet_credit' : 'wallet_coins';
      const newSub: MerchantSubscriptionRecord = {
        id: `sub_wallet_${now}_${targetTier.id}`,
        merchantId: user.id,
        tierId: targetTier.id,
        tierName: targetTier.name,
        amount: feeAmount,
        paymentMethod: finalMethod,
        status: 'pending',
        createdAt: now,
      };
      db.merchantSubscriptions.unshift(newSub);

      dbMerchant.merchantSubscriptionStatus = 'pending_verification';

      // Also log into db.payments
      if (!db.payments) db.payments = [];
      db.payments.unshift({
        id: db.nextIds.payment++,
        userId: user.id,
        userName: user.shopName || user.name,
        userPhone: user.phone,
        code: `WALLET-${newSub.id.slice(-6).toUpperCase()}`,
        amount: feeAmount,
        status: 'pending',
        type: 'merchant_subscription',
        channel: useCredit ? 'Merchant Wallet Credit (KES)' : 'Merchant Wallet Coins',
        createdAt: now,
        verifiedAt: null,
        verifiedBy: null,
        notes: `Wallet payment of KSh ${feeAmount} for ${targetTier.name}. Requires Admin Approval.`,
      });

      // Private notification to merchant
      if (!db.userNotifications) db.userNotifications = [];
      db.userNotifications.unshift({
        id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        title: `⏳ Subscription Payment Submitted: ${targetTier.name}`,
        message: `Payment of KSh ${feeAmount.toLocaleString()} from your wallet is held in escrow. Subscription will be reviewed and activated by Admin shortly.`,
        type: 'payment',
        read: false,
        timestamp: now,
      });

      logAudit(db, user.id, user.name, 'MERCHANT_SUBSCRIPTION_WALLET_SUBMITTED', `Submitted KSh ${feeAmount} via ${finalMethod} for ${targetTier.name} (Pending Admin Approval)`);

      return { newSub, merchantUser: dbMerchant, feeAmount };
    });

    res.json({
      success: true,
      subscription: newSub,
      user: merchantUser,
      message: `Wallet payment of KSh ${feeAmount.toLocaleString()} submitted! Admin will verify and activate your 30-day store plan.`,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Subscription payment failed' });
  }
});

// Submit manual till / paybill subscription payment (Method 2: Admin approval required)
prompt2Router.post('/merchant/subscription/submit-manual', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || (!isUserMerchant(user) && !isUserAdmin(user))) {
    return res.status(403).json({ error: 'Merchant authorization required' });
  }

  const { tierId, paymentCode, amount, channel } = req.body;
  const targetTier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);
  if (!targetTier) return res.status(400).json({ error: 'Invalid tier' });

  const code = String(paymentCode || '').trim().toUpperCase();
  if (!code || code.length < 6) return res.status(400).json({ error: 'Valid M-Pesa transaction code required (at least 6 characters)' });

  try {
    const subRecord = await runDatabaseTransaction(async (db) => {
      // Prevent duplicate payment codes across payments and active/pending subscriptions
      const codeExists = (db.payments || []).some((p) => p.code === code && (p.status === 'pending' || p.status === 'approved'));
      const subCodeExists = (db.merchantSubscriptions || []).some((s) => s.paymentCode === code && (s.status === 'pending' || s.status === 'active'));
      if (codeExists || subCodeExists) {
        throw { status: 400, message: 'This payment transaction code has already been submitted and is currently being processed or approved.' };
      }

      // Prevent second pending subscription payment for this merchant
      if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
      const existingPending = db.merchantSubscriptions.some((s) => s.merchantId === user.id && s.status === 'pending');
      if (existingPending) {
        throw { status: 400, message: 'You already have a subscription payment pending admin review.' };
      }

      const now = Date.now();
      const newRecord: MerchantSubscriptionRecord = {
        id: `sub_manual_${now}_${Math.random().toString(36).substring(2, 6)}`,
        merchantId: user.id,
        tierId: targetTier.id,
        tierName: targetTier.name,
        amount: Number(amount) || targetTier.monthlyFee,
        paymentMethod: 'mpesa_till_paybill',
        paymentCode: code,
        status: 'pending',
        createdAt: now,
      };
      db.merchantSubscriptions.unshift(newRecord);

      // Add to admin payment queue
      if (!db.payments) db.payments = [];
      db.payments.unshift({
        id: db.nextIds.payment++,
        userId: user.id,
        userName: user.shopName || user.name,
        userPhone: user.phone,
        code,
        amount: Number(amount) || targetTier.monthlyFee,
        status: 'pending',
        type: 'merchant_subscription',
        channel: channel || 'Till 196853 / Paybill 522533',
        createdAt: now,
        verifiedAt: null,
        verifiedBy: null,
        notes: `Manual subscription payment for ${targetTier.name}. Code: ${code}. Pending Admin Approval.`,
      });

      const dbUser = db.users.find((u) => u.id === user.id);
      if (dbUser) dbUser.merchantSubscriptionStatus = 'pending_verification';

      // Private notification for merchant
      if (!db.userNotifications) db.userNotifications = [];
      db.userNotifications.unshift({
        id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
        userId: user.id,
        title: `⏳ Subscription Code Submitted: ${targetTier.name}`,
        message: `Payment code ${code} for KSh ${(Number(amount) || targetTier.monthlyFee).toLocaleString()} submitted. Admin will verify against statements and activate your store for 30 days.`,
        type: 'payment',
        read: false,
        timestamp: now,
      });

      logAudit(db, user.id, user.name, 'SUBSCRIPTION_MANUAL_SUBMITTED', `Submitted manual payment code ${code} for ${targetTier.name}`);

      return newRecord;
    });

    res.status(201).json({
      success: true,
      subscription: subRecord,
      message: 'Manual subscription payment code submitted! Admin will verify against statements and activate your store for 30 days.',
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to submit payment code' });
  }
});


// Pay Featured Product fee (KES 30 / day) with Wallet Coins (Method 1)
prompt2Router.post('/products/feature/pay-coins', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Merchant authorization required' });
  }

  const { productId, days } = req.body;
  const numDays = Math.max(1, Math.min(90, Number(days) || 7));
  const feePerDay = 30; // STRICT KES 30/day featured fee
  const totalCoins = numDays * feePerDay;

  const db = await getDatabase();
  const product = db.products.find((p) => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.vendorId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only feature your own products.' });
  }

  const merchantUser = db.users.find((u) => u.id === user.id);
  if (!merchantUser) return res.status(404).json({ error: 'User not found' });

  if ((merchantUser.coins || 0) < totalCoins) {
    return res.status(400).json({
      error: `Insufficient coins. You have ${merchantUser.coins || 0} coins but need ${totalCoins} coins (${numDays} days @ KSh 30/day).`,
    });
  }

  // Atomic coins transfer
  const adminUser = db.users.find((u) => u.role === 'admin') || db.users[0];
  merchantUser.coins = (merchantUser.coins || 0) - totalCoins;
  adminUser.coins = (adminUser.coins || 0) + totalCoins;

  // Activate featured status
  product.isFeatured = true;
  product.updatedAt = Date.now();

  logAudit(db, user.id, user.name, 'PRODUCT_FEATURED_COINS_PAID', `Paid ${totalCoins} coins to feature "${product.title}" for ${numDays} days`);
  await saveDatabase(db);

  res.json({
    success: true,
    product,
    message: `"${product.title}" is now FEATURED for ${numDays} days! Appears in Featured section and Announcements.`,
  });
});

// ----------------------------------------------------------------------
// PART C & G: MERCHANT VERIFICATION ENGINE & ADMIN SECTIONS
// ----------------------------------------------------------------------
prompt2Router.get('/merchant/verification/status', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const rec = (db.merchantVerifications || []).find((v) => v.merchantId === user.id);

  res.json({
    hasSubmitted: Boolean(rec),
    verification: rec || null,
    isVerified: Boolean(user.verified),
    badge: user.verified ? 'Buyoll Verified Merchant' : null,
  });
});

// Merchant submits registration & documents
prompt2Router.post('/merchant/verification/submit', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'merchant') return res.status(403).json({ error: 'Merchant authorization required' });

  const {
    hasPhysicalShop,
    tradingLicenceNumber,
    nationalIdOrPassport,
    yearsOperating,
    businessType,
    shopLocation,
  } = req.body;

  if (!tradingLicenceNumber || !nationalIdOrPassport || !shopLocation) {
    return res.status(400).json({ error: 'Trading licence, national ID/passport, and shop location are mandatory.' });
  }

  const db = await getDatabase();
  if (!db.merchantVerifications) db.merchantVerifications = [];

  let rec = db.merchantVerifications.find((v) => v.merchantId === user.id);
  if (!rec) {
    rec = {
      merchantId: user.id,
      status: 'pending_review',
      hasPhysicalShop: Boolean(hasPhysicalShop),
      tradingLicenceNumber: String(tradingLicenceNumber).trim(),
      nationalIdOrPassport: String(nationalIdOrPassport).trim(),
      yearsOperating: Number(yearsOperating) || 3,
      businessType: String(businessType || 'General Retail').trim(),
      shopLocation: String(shopLocation).trim(),
      exemptions: [],
      submittedAt: Date.now(),
    };
    db.merchantVerifications.unshift(rec);
  } else {
    rec.hasPhysicalShop = Boolean(hasPhysicalShop);
    rec.tradingLicenceNumber = String(tradingLicenceNumber).trim();
    rec.nationalIdOrPassport = String(nationalIdOrPassport).trim();
    rec.yearsOperating = Number(yearsOperating) || 3;
    rec.shopLocation = String(shopLocation).trim();
    rec.status = 'pending_review';
  }

  logAudit(db, user.id, user.name, 'MERCHANT_VERIFICATION_SUBMITTED', 'Submitted merchant verification application and documents');
  await saveDatabase(db);

  res.status(201).json({ success: true, verification: rec, message: 'Verification application submitted for Buyoll Admin review.' });
});

// Admin schedules shop visit
prompt2Router.post('/admin/merchant-verifications/:id/schedule-visit', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const mid = Number(req.params.id);
  const { scheduledDate, representative } = req.body;

  const db = await getDatabase();
  const rec = (db.merchantVerifications || []).find((v) => v.merchantId === mid);
  if (!rec) return res.status(404).json({ error: 'Merchant verification record not found' });

  rec.status = 'visit_scheduled';
  rec.shopVisitScheduledAt = scheduledDate ? new Date(scheduledDate).getTime() : Date.now() + 86400000 * 2;
  rec.shopVisitRepresentative = representative || 'Buyoll Field Operations Team';

  // Private notification to merchant
  if (!db.userNotifications) db.userNotifications = [];
  db.userNotifications.unshift({
    id: `notif_${Date.now()}`,
    userId: mid,
    title: '📍 Buyoll Shop Visit Scheduled',
    message: `Field verification visit scheduled for ${new Date(rec.shopVisitScheduledAt).toLocaleDateString()} with representative ${rec.shopVisitRepresentative}.`,
    type: 'verification',
    read: false,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'MERCHANT_VISIT_SCHEDULED', `Scheduled shop visit for merchant #${mid}`);
  await saveDatabase(db);

  res.json({ success: true, verification: rec, message: 'Shop visit scheduled.' });
});

// Admin records shop visit & advert installation
prompt2Router.post('/admin/merchant-verifications/:id/complete-visit', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const mid = Number(req.params.id);
  const { notes, advertInstalled, photoUrl } = req.body;

  const db = await getDatabase();
  const rec = (db.merchantVerifications || []).find((v) => v.merchantId === mid);
  if (!rec) return res.status(404).json({ error: 'Record not found' });

  rec.status = 'visit_completed';
  rec.shopVisitCompletedAt = Date.now();
  rec.shopVisitNotes = notes || 'Physical shop verified and validated.';
  if (advertInstalled) {
    rec.advertInstalledAt = Date.now();
    rec.advertPhotoUrl = photoUrl || 'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=600&q=80';
  }

  logAudit(db, user.id, user.name, 'MERCHANT_VISIT_COMPLETED', `Completed shop visit for merchant #${mid}. Advert installed: ${Boolean(advertInstalled)}`);
  await saveDatabase(db);

  res.json({ success: true, verification: rec, message: 'Shop visit details recorded.' });
});

// Admin grants exemption with MANDATORY written reason
prompt2Router.post('/admin/merchant-verifications/:id/grant-exemption', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const mid = Number(req.params.id);
  const { requirement, reason } = req.body;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Exemption reason is mandatory. Admin must provide written justification.' });
  }

  const db = await getDatabase();
  const rec = (db.merchantVerifications || []).find((v) => v.merchantId === mid);
  if (!rec) return res.status(404).json({ error: 'Record not found' });

  if (!rec.exemptions) rec.exemptions = [];
  rec.exemptions.push({
    requirement: requirement || 'three_years_operating',
    reason: String(reason).trim(),
    grantedBy: user.name,
    grantedAt: Date.now(),
  });

  // Notify merchant privately
  if (!db.userNotifications) db.userNotifications = [];
  db.userNotifications.unshift({
    id: `notif_${Date.now()}`,
    userId: mid,
    title: 'Exemption Granted by Buyoll Admin',
    message: `Requirement "${requirement}" was exempted. Reason: "${reason}".`,
    type: 'verification',
    read: false,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'MERCHANT_EXEMPTION_GRANTED', `Exempted requirement "${requirement}" for merchant #${mid}. Reason: "${reason}"`);
  await saveDatabase(db);

  res.json({ success: true, verification: rec, message: 'Exemption granted and recorded in audit log.' });
});

// Admin decides verification: verify or decline
prompt2Router.post('/admin/merchant-verifications/:id/decide', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const mid = Number(req.params.id);
  const { action, declineReason } = req.body; // 'verify' | 'decline'

  const db = await getDatabase();
  const rec = (db.merchantVerifications || []).find((v) => v.merchantId === mid);
  if (!rec) return res.status(404).json({ error: 'Record not found' });

  const merchantUser = db.users.find((u) => u.id === mid);
  if (!merchantUser) return res.status(404).json({ error: 'Merchant user not found' });

  if (action === 'verify') {
    rec.status = 'verified';
    rec.reviewedAt = Date.now();
    merchantUser.verified = true;
    merchantUser.verificationNotes = 'Verified by Buyoll Admin following physical shop visit and document inspection.';

    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_${Date.now()}`,
      userId: mid,
      title: '🌟 Buyoll Verified Merchant Status Approved!',
      message: 'Congratulations! Your store is now verified. The "Buyoll Verified Merchant" badge is active on your profile and products.',
      type: 'verification',
      read: false,
      timestamp: Date.now(),
    });

    logAudit(db, user.id, user.name, 'MERCHANT_VERIFIED', `Granted "Buyoll Verified Merchant" status to merchant #${mid} (${merchantUser.shopName || merchantUser.name})`);
  } else {
    rec.status = 'declined';
    rec.declineReason = declineReason || 'Requirements not fully met.';
    rec.reviewedAt = Date.now();
    merchantUser.verified = false;

    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_${Date.now()}`,
      userId: mid,
      title: 'Merchant Verification Declined',
      message: `Your verification application was declined: ${rec.declineReason}. Please update your details to reapply.`,
      type: 'verification',
      read: false,
      timestamp: Date.now(),
    });

    logAudit(db, user.id, user.name, 'MERCHANT_VERIFICATION_DECLINED', `Declined verification for merchant #${mid}: ${rec.declineReason}`);
  }

  await saveDatabase(db);
  res.json({ success: true, verification: rec, user: merchantUser, message: `Merchant has been ${action === 'verify' ? 'verified' : 'declined'}.` });
});

// Admin lists all verifications
prompt2Router.get('/admin/merchant-verifications', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const db = await getDatabase();
  const list = (db.merchantVerifications || []).map((v) => {
    const m = db.users.find((u) => u.id === v.merchantId);
    return {
      ...v,
      merchantName: m?.name || 'Merchant',
      shopName: m?.shopName || m?.name || 'Shop',
      phone: m?.phone || '',
      email: m?.email || '',
    };
  });

  res.json({ verifications: list });
});

// Admin lists all subscriptions
prompt2Router.get('/admin/merchant-subscriptions', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) return res.status(403).json({ error: 'Admin role required' });

  const db = await getDatabase();
  const list = (db.merchantSubscriptions || []).map((s) => {
    const m = db.users.find((u) => u.id === s.merchantId);
    return {
      ...s,
      merchantName: m?.name || 'Merchant',
      shopName: m?.shopName || m?.name || 'Store',
      phone: m?.phone || '',
      email: m?.email || '',
    };
  });

  res.json({ subscriptions: list });
});

// Admin approves manual till/paybill subscription OR wallet subscription
prompt2Router.post('/admin/merchant-subscriptions/:id/approve', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) return res.status(403).json({ error: 'Admin role required' });

  const subId = req.params.id;

  try {
    const { sub, merchantName } = await runDatabaseTransaction(async (db) => {
      const targetSub = (db.merchantSubscriptions || []).find((s) => s.id === subId);
      if (!targetSub) throw { status: 404, message: 'Subscription not found' };

      // Strictly prevent duplicate approval / processing
      if (targetSub.status !== 'pending') {
        throw { status: 400, message: `This subscription has already been ${targetSub.status}. Duplicate processing prevented.` };
      }

      // Check if payment code was already used for an active subscription
      if (targetSub.paymentCode) {
        const duplicateActive = (db.merchantSubscriptions || []).some(
          (s) => s.id !== targetSub.id && s.paymentCode === targetSub.paymentCode && s.status === 'active'
        );
        if (duplicateActive) {
          throw { status: 400, message: `Payment code ${targetSub.paymentCode} has already been approved for an active subscription.` };
        }
      }

      const targetTier = SUBSCRIPTION_TIERS.find((t) => t.id === targetSub.tierId) || SUBSCRIPTION_TIERS[0];
      const now = Date.now();
      const expiresAt = now + 30 * 86400000;

      targetSub.status = 'active';
      targetSub.startDate = now;
      targetSub.expiresAt = expiresAt;

      // Also approve payment record if present
      if (db.payments) {
        const payment = db.payments.find(p => (targetSub.paymentCode && p.code === targetSub.paymentCode) || (p.notes && p.notes.includes(targetSub.id)));
        if (payment) {
          payment.status = 'approved';
          payment.approvedAt = now;
          payment.verifiedAt = now;
          payment.verifiedBy = user.name;
        }
      }

      const merchantUser = db.users.find((u) => u.id === targetSub.merchantId);
      if (merchantUser) {
        merchantUser.merchantSubscriptionStatus = 'active';
        merchantUser.merchantSubscriptionPlan = targetSub.tierId as any;
        merchantUser.merchantSubscriptionExpiresAt = expiresAt;
        merchantUser.verified = true;
        merchantUser.verifiedAt = now;

        const methodDesc = targetSub.paymentMethod === 'wallet_credit'
          ? 'Merchant Wallet Store Credit'
          : targetSub.paymentMethod === 'wallet_coins'
          ? 'Wallet Coins'
          : (targetSub.paymentCode || 'M-Pesa Till');

        if (!db.userNotifications) db.userNotifications = [];
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: merchantUser.id,
          title: `🎉 Subscription Approved: ${targetTier.name}`,
          message: `Your payment (${methodDesc}) has been approved by Admin! Your store catalog limits are now active for 30 days until ${new Date(expiresAt).toLocaleDateString()}. You can now post listings and open speed groups!`,
          type: 'payment',
          read: false,
          timestamp: now,
        });
      }

      logAudit(db, user.id, user.name, 'MERCHANT_SUBSCRIPTION_APPROVED', `Approved ${targetSub.paymentMethod} subscription for merchant #${targetSub.merchantId} (${targetTier.name})`);

      return { sub: targetSub, merchantName: merchantUser?.name || 'merchant' };
    });

    res.json({
      success: true,
      subscription: sub,
      message: `Approved subscription for ${merchantName}! 30-day active window started.`,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to approve subscription' });
  }
});

// Admin declines subscription
prompt2Router.post('/admin/merchant-subscriptions/:id/decline', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) return res.status(403).json({ error: 'Admin role required' });

  const subId = req.params.id;
  const { reason } = req.body || {};

  try {
    const sub = await runDatabaseTransaction(async (db) => {
      const targetSub = (db.merchantSubscriptions || []).find((s) => s.id === subId);
      if (!targetSub) throw { status: 404, message: 'Subscription not found' };

      // Strictly prevent duplicate decline / processing
      if (targetSub.status !== 'pending') {
        throw { status: 400, message: `This subscription has already been ${targetSub.status}. Duplicate processing prevented.` };
      }

      targetSub.status = 'declined';
      const now = Date.now();

      // Also reject payment record if present
      if (db.payments) {
        const payment = db.payments.find(p => (targetSub.paymentCode && p.code === targetSub.paymentCode) || (p.notes && p.notes.includes(targetSub.id)));
        if (payment) {
          payment.status = 'rejected';
          payment.rejectionReason = reason || 'Declined by Admin';
        }
      }

      const merchantUser = db.users.find((u) => u.id === targetSub.merchantId);
      if (merchantUser) {
        // Check if user has any other active subscription
        const hasOtherActive = (db.merchantSubscriptions || []).some(
          s => s.id !== targetSub.id && s.merchantId === targetSub.merchantId && s.status === 'active' && s.expiresAt && s.expiresAt > now
        );
        if (!hasOtherActive) {
          merchantUser.merchantSubscriptionStatus = 'inactive';
        }

        // If was paid with wallet credit, refund store credit back to merchant wallet
        if (targetSub.paymentMethod === 'wallet_credit') {
          const refundAmt = targetSub.amount || 0;
          if (!merchantUser.roleWallets) merchantUser.roleWallets = {};
          if (!merchantUser.roleWallets.merchant) merchantUser.roleWallets.merchant = { credit: 0, coins: 0, points: 0 };
          merchantUser.roleWallets.merchant.credit = (merchantUser.roleWallets.merchant.credit || 0) + refundAmt;
          if ((merchantUser.activeRole || merchantUser.role) === 'merchant') {
            merchantUser.credit = merchantUser.roleWallets.merchant.credit;
          }

          if (!db.storeCreditLedger) db.storeCreditLedger = [];
          db.storeCreditLedger.unshift({
            id: db.nextIds.ledger++,
            userId: merchantUser.id,
            amount: refundAmt,
            balanceAfter: merchantUser.roleWallets.merchant.credit,
            type: 'refund_credit' as any,
            referenceId: `REF-${targetSub.id}`,
            note: `Refunded KSh ${refundAmt} store credit due to declined subscription`,
            createdAt: now,
          });
        } else if (targetSub.paymentMethod === 'wallet_coins') {
          const refundCoins = targetSub.amount || 0;
          const adminUser = db.users.find((u) => u.role === 'admin') || db.users[0];
          if (adminUser) adminUser.coins = Math.max(0, (adminUser.coins || 0) - refundCoins);
          merchantUser.coins = (merchantUser.coins || 0) + refundCoins;

          if (!db.coinLedger) db.coinLedger = [];
          db.coinLedger.push({
            id: db.coinLedger.length + 1,
            senderId: adminUser?.id || 1,
            senderName: 'Admin System',
            recipientId: merchantUser.id,
            recipientName: merchantUser.name,
            amount: refundCoins,
            type: 'transfer',
            reason: 'refund',
            note: `Refunded ${refundCoins} coins due to declined subscription`,
            timestamp: now,
          });
        }

        if (!db.userNotifications) db.userNotifications = [];
        db.userNotifications.unshift({
          id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
          userId: merchantUser.id,
          title: '⚠️ Subscription Request Declined',
          message: `Your subscription request was declined by Admin. ${
            targetSub.paymentMethod === 'wallet_credit'
              ? 'Your KSh store credit has been refunded to your merchant wallet.'
              : targetSub.paymentMethod === 'wallet_coins'
              ? 'Your wallet coins have been fully refunded.'
              : 'Please check your transaction details and resubmit.'
          }${reason ? ` Reason: ${reason}` : ''}`,
          type: 'system',
          read: false,
          timestamp: now,
        });
      }

      logAudit(db, user.id, user.name, 'MERCHANT_SUBSCRIPTION_DECLINED', `Declined subscription #${targetSub.id} for merchant #${targetSub.merchantId}`);

      return targetSub;
    });

    res.json({ success: true, subscription: sub, message: 'Subscription request declined.' });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to decline subscription' });
  }
});

// Admin agrees custom enterprise pricing for merchant
prompt2Router.post('/admin/merchant-subscriptions/set-enterprise-price', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || !isUserAdmin(user)) return res.status(403).json({ error: 'Admin role required' });


  const { merchantId, agreedPrice } = req.body;
  const mid = Number(merchantId);
  const price = Math.max(0, Number(agreedPrice) || 15000);

  const db = await getDatabase();
  const merchantUser = db.users.find((u) => u.id === mid);
  if (!merchantUser) return res.status(404).json({ error: 'Merchant not found' });

  if (!merchantUser.preferences) merchantUser.preferences = {};
  merchantUser.preferences.enterprisePriceAgreed = true;
  merchantUser.preferences.enterpriseAgreedPrice = price;

  logAudit(db, user.id, user.name, 'ENTERPRISE_PRICE_AGREED', `Agreed custom Enterprise price KSh ${price.toLocaleString()} for merchant #${mid}`);
  await saveDatabase(db);

  res.json({ success: true, message: `Agreed Enterprise pricing KSh ${price.toLocaleString()} for ${merchantUser.name}.` });
});

// Admin lists and toggles Featured Products (KES 30/day)
prompt2Router.get('/admin/featured-products', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const db = await getDatabase();
  const featured = db.products.filter((p) => p.isFeatured);
  const allProducts = db.products;

  res.json({ featured, allProducts });
});

prompt2Router.post('/admin/featured-products/:id/toggle', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });

  const pid = Number(req.params.id);
  const db = await getDatabase();
  const product = db.products.find((p) => p.id === pid);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  product.isFeatured = !product.isFeatured;
  product.updatedAt = Date.now();

  logAudit(db, user.id, user.name, 'PRODUCT_FEATURED_TOGGLED', `Admin toggled featured status of "${product.title}" to ${product.isFeatured}`);
  await saveDatabase(db);

  res.json({ success: true, product, message: `"${product.title}" is now ${product.isFeatured ? 'Featured' : 'Standard'}.` });
});

// ----------------------------------------------------------------------
// PART I: CHAT MODERATION, STRIKES & MERCHANT DEEP-LINK NOTIFICATIONS
// ----------------------------------------------------------------------
const OFFENSIVE_TERMS = [
  'scam', 'thief', 'fraud', 'conman', 'idiot', 'stupid', 'fool', 'fake',
  'kill', 'threat', 'bastard', 'mwizi', 'jambazi', 'mbwa', 'mwendawazimu',
  'fala', 'mkora', 'shezi', 'matusi', 'tapeli'
];

prompt2Router.post('/groups/:id/chat-moderated', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const { text } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message text is required' });

  const db = await getDatabase();
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const product = db.products.find((p) => p.id === group.productId);

  // Check strike and blacklist status
  if (!db.chatStrikes) db.chatStrikes = [];
  const strikeRec = db.chatStrikes.find((s) => s.userId === user.id);

  if (strikeRec?.isBlacklisted) {
    return res.status(403).json({
      error: 'You have been blacklisted from Group chat due to repeated policy violations. You may appeal to Buyoll Admin.',
      isBlacklisted: true,
      appealAllowed: true,
    });
  }

  if (strikeRec?.isMuted && strikeRec.mutedUntil && strikeRec.mutedUntil > Date.now()) {
    const hoursLeft = Math.ceil((strikeRec.mutedUntil - Date.now()) / 3600000);
    return res.status(403).json({
      error: `Your chat permissions are temporarily muted for ${hoursLeft} more hour(s) following a content moderation strike.`,
      isMuted: true,
    });
  }

  // CENSORSHIP & MODERATION PIPELINE
  const rawText = String(text).trim();
  const lower = rawText.toLowerCase();
  let containsOffensive = false;
  let censoredText = rawText;

  OFFENSIVE_TERMS.forEach((term) => {
    if (lower.includes(term)) {
      containsOffensive = true;
      const regex = new RegExp(term, 'gi');
      censoredText = censoredText.replace(regex, '***');
    }
  });

  // If offensive, apply strike escalation
  if (containsOffensive) {
    if (!strikeRec) {
      db.chatStrikes.push({
        userId: user.id,
        userName: user.name,
        strikeCount: 1,
        isMuted: false,
        isBlacklisted: false,
        lastViolationAt: Date.now(),
        warnings: [{ reason: 'Offensive or defamatory language detected in Group chat.', timestamp: Date.now() }],
      });
    } else {
      strikeRec.strikeCount += 1;
      strikeRec.lastViolationAt = Date.now();
      if (!strikeRec.warnings) strikeRec.warnings = [];
      strikeRec.warnings.push({ reason: 'Repeated offensive language.', timestamp: Date.now() });

      if (strikeRec.strikeCount === 2) {
        strikeRec.isMuted = true;
        strikeRec.mutedUntil = Date.now() + 86400000; // 24h mute
      } else if (strikeRec.strikeCount >= 3) {
        strikeRec.isBlacklisted = true;
        strikeRec.blacklistReason = 'Exceeded maximum allowable strikes (3+ strikes) for abusive or defamatory language.';
      }
    }

    // Send private platform warning notification to culprit
    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_warn_${Date.now()}`,
      userId: user.id,
      title: '⚠️ Platform Warning: Chat Policy Violation',
      message: `Your message contained words masked by the automated moderation engine. Chat must remain positive and respectful. Strike count: ${strikeRec?.strikeCount || 1}/3.`,
      type: 'warning',
      read: false,
      timestamp: Date.now(),
    });
  }

  // Deliver message to group chat
  const newMsg = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'normal' as const,
    text: censoredText,
    timestamp: Date.now(),
  };

  if (!group.chat) group.chat = [];
  group.chat.push(newMsg);

  // If message from group (not from product merchant), deliver deep-link notification to product merchant
  if (product && product.vendorId && product.vendorId !== user.id) {
    if (!db.userNotifications) db.userNotifications = [];
    db.userNotifications.unshift({
      id: `notif_chat_${Date.now()}`,
      userId: product.vendorId,
      title: `💬 New Message in "${group.name}"`,
      message: `${user.name}: "${censoredText.slice(0, 75)}${censoredText.length > 75 ? '...' : ''}"`,
      type: 'chat',
      link: `/chama/${group.id}`, // Deep-links to group in view-only mode
      read: false,
      timestamp: Date.now(),
    });
  }

  await saveDatabase(db);
  res.status(201).json({ success: true, message: newMsg, censored: containsOffensive });
});
