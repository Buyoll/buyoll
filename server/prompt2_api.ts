import { Router, Request, Response } from 'express';
import { getDatabase, saveDatabase, logAudit } from './db.js';
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
    features: ['Up to 50 products', '10 groups per product', 'Priority Chama matching'],
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
      role: user.role,
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
  const sub = (db.merchantSubscriptions || []).find((s) => s.merchantId === user.id && s.status === 'active');
  const now = Date.now();

  const isExpired = !sub || (sub.expiresAt ? sub.expiresAt < now : false);
  const daysRemaining = sub && sub.expiresAt && sub.expiresAt > now ? Math.ceil((sub.expiresAt - now) / 86400000) : 0;
  const currentTier = SUBSCRIPTION_TIERS.find((t) => t.id === sub?.tierId) || SUBSCRIPTION_TIERS[0];

  res.json({
    hasSubscription: Boolean(sub),
    isExpired,
    daysRemaining,
    subscription: sub || null,
    tier: currentTier,
    canUpgrade: isExpired, // STRICT RULE: Upgrade enabled ONLY when expired!
    message: isExpired
      ? 'Your subscription has ended. Upgrade is now available to choose any tier.'
      : `Your ${currentTier.name} plan is active with ${daysRemaining} days remaining. You can upgrade after it ends.`,
  });
});

// Pay subscription with wallet coins (Method 1: Automatic atomic debit/credit)
prompt2Router.post('/merchant/subscription/pay-coins', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'merchant') {
    return res.status(403).json({ error: 'Merchant authentication required' });
  }

  const { tierId } = req.body;
  const targetTier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);
  if (!targetTier) return res.status(400).json({ error: 'Invalid subscription tier selected' });

  const db = await getDatabase();
  const merchantUser = db.users.find((u) => u.id === user.id);
  if (!merchantUser) return res.status(404).json({ error: 'Merchant not found' });

  // STRICT UPGRADE RULE: Upgrade allowed ONLY if current subscription is expired
  const activeSub = (db.merchantSubscriptions || []).find(
    (s) => s.merchantId === user.id && s.status === 'active' && s.expiresAt && s.expiresAt > Date.now()
  );
  if (activeSub) {
    const daysLeft = Math.ceil((activeSub.expiresAt! - Date.now()) / 86400000);
    return res.status(400).json({
      error: `Your current 30-day subscription is still active (${daysLeft} days remaining). You can upgrade after it ends.`,
    });
  }

  // Enterprise requires admin custom price agreement
  if (targetTier.id === 'enterprise' && !merchantUser.preferences?.enterprisePriceAgreed) {
    return res.status(400).json({
      error: 'Enterprise tier requires custom price agreement with Buyoll Admin. A request has been logged.',
    });
  }

  const feeCoins = targetTier.monthlyFee;
  if ((merchantUser.coins || 0) < feeCoins) {
    return res.status(400).json({
      error: `Insufficient coins balance. You have ${merchantUser.coins || 0} coins but need ${feeCoins} coins for the ${targetTier.name}. Please top up wallet coins or pay via till/paybill.`,
    });
  }

  // ATOMIC WALLET TRANSFER: Debit merchant, credit admin (User 1)
  const adminUser = db.users.find((u) => u.role === 'admin') || db.users[0];
  merchantUser.coins = (merchantUser.coins || 0) - feeCoins;
  adminUser.coins = (adminUser.coins || 0) + feeCoins;

  // Ledger entries
  if (!db.coinLedger) db.coinLedger = [];
  const txId = `sub_coins_${Date.now()}_${user.id}`;
  db.coinLedger.push({
    id: db.coinLedger.length + 1,
    userId: user.id,
    amount: -feeCoins,
    type: 'spend',
    reason: 'subscription',
    reference: `Paid 30-day subscription for ${targetTier.name}`,
    timestamp: Date.now(),
  });
  db.coinLedger.push({
    id: db.coinLedger.length + 1,
    userId: adminUser.id,
    amount: feeCoins,
    type: 'earn',
    reason: 'subscription',
    reference: `Merchant #${user.id} subscription payment for ${targetTier.name}`,
    timestamp: Date.now(),
  });

  // Activate 30-day subscription
  const now = Date.now();
  const expiresAt = now + 30 * 86400000;
  if (!db.merchantSubscriptions) db.merchantSubscriptions = [];

  // Expire previous subscriptions
  db.merchantSubscriptions.forEach((s) => {
    if (s.merchantId === user.id) s.status = 'expired';
  });

  const newSub: MerchantSubscriptionRecord = {
    id: `sub_${Date.now()}_${targetTier.id}`,
    merchantId: user.id,
    tierId: targetTier.id,
    tierName: targetTier.name,
    amount: targetTier.monthlyFee,
    paymentMethod: 'wallet_coins',
    status: 'active',
    startDate: now,
    expiresAt,
    createdAt: now,
  };
  db.merchantSubscriptions.unshift(newSub);

  merchantUser.merchantSubscriptionStatus = 'active';
  merchantUser.merchantSubscriptionPlan = targetTier.id as any;
  merchantUser.merchantSubscriptionExpiresAt = expiresAt;

  // Send private notification to merchant
  if (!db.userNotifications) db.userNotifications = [];
  db.userNotifications.unshift({
    id: `notif_${Date.now()}`,
    userId: user.id,
    title: `🎉 30-Day Subscription Activated: ${targetTier.name}`,
    message: `Payment of ${feeCoins} coins confirmed. Your store can now post up to ${targetTier.maxProducts === -1 ? 'unlimited' : targetTier.maxProducts} products with up to ${targetTier.maxGroupsPerProduct} groups per product. Valid until ${new Date(expiresAt).toLocaleDateString()}.`,
    type: 'payment',
    read: false,
    timestamp: now,
  });

  logAudit(db, user.id, user.name, 'MERCHANT_SUBSCRIPTION_COINS_PAID', `Paid ${feeCoins} coins for 30-day plan ${targetTier.name}`);
  await saveDatabase(db);

  res.json({
    success: true,
    subscription: newSub,
    user: merchantUser,
    message: `Successfully activated ${targetTier.name}! 30-day active window started.`,
  });
});

// Submit manual till / paybill subscription payment (Method 2: Admin approval required)
prompt2Router.post('/merchant/subscription/submit-manual', async (req: Request, res: Response) => {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'merchant') return res.status(403).json({ error: 'Merchant authorization required' });

  const { tierId, paymentCode, amount, channel } = req.body;
  const targetTier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);
  if (!targetTier) return res.status(400).json({ error: 'Invalid tier' });

  const code = String(paymentCode || '').trim().toUpperCase();
  if (!code || code.length < 6) return res.status(400).json({ error: 'Valid M-Pesa transaction code required' });

  const db = await getDatabase();

  // Prevent duplicate payment codes
  const codeExists = db.payments.some((p) => p.code === code);
  if (codeExists) {
    return res.status(400).json({ error: 'This payment transaction code has already been submitted.' });
  }

  // Prevent second pending subscription payment
  if (!db.merchantSubscriptions) db.merchantSubscriptions = [];
  const existingPending = db.merchantSubscriptions.some((s) => s.merchantId === user.id && s.status === 'pending');
  if (existingPending) {
    return res.status(400).json({ error: 'You already have a subscription payment pending admin review.' });
  }

  const now = Date.now();
  const subRecord: MerchantSubscriptionRecord = {
    id: `sub_manual_${now}`,
    merchantId: user.id,
    tierId: targetTier.id,
    tierName: targetTier.name,
    amount: Number(amount) || targetTier.monthlyFee,
    paymentMethod: 'mpesa_till_paybill',
    paymentCode: code,
    status: 'pending',
    createdAt: now,
  };
  db.merchantSubscriptions.unshift(subRecord);

  // Add to admin payment queue
  db.payments.unshift({
    id: db.nextIds.payment++,
    userId: user.id,
    userName: user.shopName || user.name,
    userPhone: user.phone,
    code,
    amount: Number(amount) || targetTier.monthlyFee,
    status: 'pending',
    type: 'platform_fee',
    channel: channel || 'Till 196853',
    createdAt: now,
    verifiedAt: null,
    verifiedBy: null,
    notes: `Manual subscription payment for ${targetTier.name}`,
  });

  const dbUser = db.users.find((u) => u.id === user.id);
  if (dbUser) dbUser.merchantSubscriptionStatus = 'pending_verification';

  logAudit(db, user.id, user.name, 'SUBSCRIPTION_MANUAL_SUBMITTED', `Submitted manual payment code ${code} for ${targetTier.name}`);
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    subscription: subRecord,
    message: 'Manual subscription payment submitted. Admin will reconcile against statement and activate your store.',
  });
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
      error: 'You have been blacklisted from Chama chat due to repeated policy violations. You may appeal to Buyoll Admin.',
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
        warnings: [{ reason: 'Offensive or defamatory language detected in Chama chat.', timestamp: Date.now() }],
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
