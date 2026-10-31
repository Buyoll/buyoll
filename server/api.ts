import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { getDatabase, saveDatabase, logAudit } from './db.js';
import {
  User,
  Product,
  ChamaGroup,
  GroupSlot,
  DefaultRecord,
  RefundRequest,
  PaymentRecord,
  PeerLoanRequest,
  MemberStatement,
  HelpChatMessage,
  GroupNotification,
  GroupInviteRequest,
  ChamaActivityItem,
  WalletDepositRequest,
  Announcement,
  SupportTicket,
  UserNotification,
  DeliveryAddress,
  MemberOrder,
  MerchantSubscriptionTier,
  MerchantVerificationRecord,
  MerchantSubscriptionRecord,
  ChatStrikeRecord,
} from '../src/types.js';

export const SUBSCRIPTION_TIERS: MerchantSubscriptionTier[] = [
  {
    id: 'tier_250',
    name: 'Micro-Merchant (KES 250)',
    monthlyFee: 250,
    maxProducts: 2,
    maxGroupsPerProduct: 2,
    description: 'Caters to very small businesses.',
    features: ['1 to 2 products max', '2 groups per product', '30-day active window'],
  },
  {
    id: 'tier_500',
    name: 'Growing Merchant (KES 500)',
    monthlyFee: 500,
    maxProducts: 10,
    maxGroupsPerProduct: 5,
    description: 'Ideal for budding local stores.',
    features: ['Up to 10 products', '5 groups per product', '30-day active window'],
  },
  {
    id: 'tier_1500',
    name: 'Pro Merchant (KES 1,500)',
    monthlyFee: 1500,
    maxProducts: 50,
    maxGroupsPerProduct: 10,
    description: 'For active retail businesses.',
    features: ['Up to 50 products', '10 groups per product', 'Priority Chama matching'],
  },
  {
    id: 'tier_3500',
    name: 'Commercial (KES 3,500)',
    monthlyFee: 3500,
    maxProducts: 100,
    maxGroupsPerProduct: 30,
    description: 'High capacity volume sales.',
    features: ['Up to 100 products', '30 groups per product', 'Multi-speed groups'],
  },
  {
    id: 'tier_7500',
    name: 'Enterprise Scale (KES 7,500)',
    monthlyFee: 7500,
    maxProducts: -1, // Unlimited
    maxGroupsPerProduct: 50,
    description: 'Unlimited catalog for major distributors.',
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

import { prompt2Router } from './prompt2_api.js';

export const apiRouter = Router();
apiRouter.use(prompt2Router);

function generateCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Simple session helper: parses 'x-user-id' header or query param
async function getAuthenticatedUser(req: Request): Promise<User | null> {
  const userIdHeader = req.headers['x-user-id'] || req.query.authUserId;
  if (!userIdHeader) return null;
  const db = await getDatabase();
  const userId = Number(userIdHeader);
  return db.users.find(u => u.id === userId) || null;
}

// Section 1.3: Server-side authorization helper (401 unauthenticated, 403 non-admin)
async function requireAdminUser(req: Request, res: Response): Promise<{ user: User; db: any } | null> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in to access administration functions.' });
    return null;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Access denied. Administrative role required.' });
    return null;
  }
  const db = await getDatabase();
  return { user, db };
}

// -------------------------------------------------------------
// USER PREFERENCES (Dynamic Enable Toggles Persisted to Database)
// -------------------------------------------------------------
apiRouter.get('/user/preferences', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  res.json({ preferences: user.preferences || {} });
});

apiRouter.post('/user/preferences', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { preferences } = req.body;
  if (!preferences || typeof preferences !== 'object') {
    return res.status(400).json({ error: 'Valid preferences object required' });
  }

  const db = await getDatabase();
  const dbUser = db.users.find(u => u.id === user.id);
  if (dbUser) {
    dbUser.preferences = {
      ...(dbUser.preferences || {}),
      ...preferences,
    };
    user.preferences = dbUser.preferences;
    await saveDatabase(db);
    return res.json({ success: true, preferences: dbUser.preferences });
  }
  res.status(404).json({ error: 'User not found' });
});

// -------------------------------------------------------------
// SECTION 1 & 5: ANNOUNCEMENTS (PUBLIC FEED, ADMIN POST/DELETE)
// -------------------------------------------------------------
apiRouter.get('/announcements', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const list = (db.announcements || []).map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl,
    category: a.category || 'General',
    createdAt: a.createdAt,
    authorName: a.authorName || 'Buyoll Admin',
  }));
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ announcements: list });
});

apiRouter.post('/announcements', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { title, body, imageUrl, category } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body are required for an announcement.' });
  }

  if (!db.announcements) db.announcements = [];
  if (!db.nextIds.announcement) db.nextIds.announcement = (db.announcements.length || 0) + 1;

  const newAnnouncement: Announcement = {
    id: db.nextIds.announcement++,
    title: String(title).trim(),
    body: String(body).trim(),
    imageUrl: imageUrl ? String(imageUrl).trim() : undefined,
    category: category ? String(category).trim() : 'Platform News',
    createdAt: Date.now(),
    authorId: user.id,
    authorName: user.name,
  };

  db.announcements.unshift(newAnnouncement);
  // Admin broadcast: Post once and deliver to notifications of all users on platform (Part A)
  if (!db.userNotifications) db.userNotifications = [];
  db.users.forEach((u) => {
    db.userNotifications.unshift({
      id: `notif_broadcast_${newAnnouncement.id}_${u.id}_${Date.now()}`,
      userId: u.id,
      title: `📢 Platform Announcement: ${newAnnouncement.title}`,
      message: newAnnouncement.body,
      type: 'broadcast',
      link: '/announcements',
      read: false,
      timestamp: Date.now(),
    });
  });

  logAudit(db, user.id, user.name, 'ANNOUNCEMENT_CREATED', `Created announcement: "${newAnnouncement.title}" & broadcasted to all users.`);
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    announcement: newAnnouncement,
    message: 'Announcement posted to public feed and broadcasted to all member notification feeds.',
  });
});

apiRouter.put('/announcements/:id', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const announcementId = req.params.id;
  const announcement = (db.announcements || []).find((a) => String(a.id) === announcementId);
  if (!announcement) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }

  const { title, body, imageUrl, category } = req.body;
  if (title) announcement.title = String(title).trim();
  if (body) announcement.body = String(body).trim();
  if (imageUrl !== undefined) announcement.imageUrl = imageUrl ? String(imageUrl).trim() : undefined;
  if (category) announcement.category = String(category).trim();
  announcement.updatedAt = Date.now();

  logAudit(db, user.id, user.name, 'ANNOUNCEMENT_UPDATED', `Updated announcement #${announcement.id}`);
  await saveDatabase(db);

  res.json({ success: true, announcement, message: 'Announcement updated.' });
});

apiRouter.delete('/announcements/:id', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const announcementId = req.params.id;
  const index = (db.announcements || []).findIndex((a) => String(a.id) === announcementId);
  if (index === -1) {
    return res.status(404).json({ error: 'Announcement not found.' });
  }

  const removed = db.announcements.splice(index, 1)[0];
  logAudit(db, user.id, user.name, 'ANNOUNCEMENT_DELETED', `Deleted announcement #${removed.id} "${removed.title}"`);
  await saveDatabase(db);

  res.json({ success: true, message: 'Announcement removed from public feed.' });
});

// -------------------------------------------------------------
// SECTION 3: DARK MODE (GROUP-LEVEL, MODERATOR-ONLY)
// -------------------------------------------------------------
apiRouter.post('/groups/:id/theme', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { theme } = req.body;
  if (theme !== 'light' && theme !== 'dark') {
    return res.status(400).json({ error: 'Theme must be "light" or "dark"' });
  }

  const db = await getDatabase();
  const groupId = Number(req.params.id);
  const group = db.groups.find((g) => g.id === groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  // Strict backend moderator check:
  const isModerator =
    group.adminId === user.id ||
    (group.moderators && group.moderators.includes(user.id)) ||
    user.role === 'admin';

  if (!isModerator) {
    return res.status(403).json({
      error: 'Access denied. Only group moderators can change this Chama group theme.',
    });
  }

  group.theme = theme;
  logAudit(db, user.id, user.name, 'GROUP_THEME_CHANGED', `Changed group #${group.id} theme to ${theme}`);
  await saveDatabase(db);

  res.json({
    success: true,
    groupId: group.id,
    theme: group.theme,
    message: `Chama theme updated to ${theme} mode for this group.`,
  });
});

// -------------------------------------------------------------
// SUPPORT TICKETS (PERSONALISED & PRIVATE TO USER)
// -------------------------------------------------------------
apiRouter.get('/user/tickets', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const tickets = (db.supportTickets || []).filter((t) => t.userId === user.id);
  res.json({ tickets });
});

apiRouter.post('/user/tickets', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { subject, message, category } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }

  const db = await getDatabase();
  if (!db.supportTickets) db.supportTickets = [];
  if (!db.nextIds.supportTicket) db.nextIds.supportTicket = (db.supportTickets.length || 0) + 1;

  const newTicket: SupportTicket = {
    id: `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    subject: String(subject).trim(),
    message: String(message).trim(),
    category: category || 'inquiry',
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    replies: [],
  };

  db.supportTickets.unshift(newTicket);
  logAudit(db, user.id, user.name, 'TICKET_CREATED', `Support ticket created: "${newTicket.subject}"`);
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    ticket: newTicket,
    message: 'Your support ticket has been submitted. Our team will review and reply promptly.',
  });
});

// Data isolation: User X requesting User Y's private resource returns 404 (Not Found)
apiRouter.get('/tickets/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(404).json({ error: 'Resource not found' });

  const db = await getDatabase();
  const ticket = (db.supportTickets || []).find((t) => t.id === req.params.id);
  if (!ticket || (ticket.userId !== user.id && user.role !== 'admin')) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  res.json({ ticket });
});

apiRouter.get('/wallet/user/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(404).json({ error: 'Resource not found' });

  const targetUserId = Number(req.params.id);
  if (targetUserId !== user.id && user.role !== 'admin') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const db = await getDatabase();
  const target = db.users.find((u) => u.id === targetUserId);
  if (!target) return res.status(404).json({ error: 'Resource not found' });

  res.json({
    userId: target.id,
    credit: target.credit || 0,
    coins: target.coins || 0,
    points: target.points || 0,
  });
});

apiRouter.get('/loans/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(404).json({ error: 'Resource not found' });

  const db = await getDatabase();
  const loan = (db.peerLoans || []).find((l) => l.id === Number(req.params.id));
  if (
    !loan ||
    (loan.borrowerId !== user.id &&
      loan.requesterId !== user.id &&
      loan.fundedByUserId !== user.id &&
      user.role !== 'admin')
  ) {
    return res.status(404).json({ error: 'Resource not found' });
  }
  res.json({ loan });
});


// -------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------
apiRouter.get('/auth/me', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { identifier, phone, password, role, name, shopName, shopDescription } = req.body;
  const lookup = (identifier || phone || '').trim().toLowerCase();

  if (!lookup) {
    return res.status(400).json({ error: 'Please enter your email or phone number.' });
  }

  const db = await getDatabase();
  let user = db.users.find(
    (u) =>
      (u.email && u.email.toLowerCase() === lookup) ||
      (u.phone && u.phone.toLowerCase() === lookup) ||
      (u.name && u.name.toLowerCase() === lookup)
  );

  // If user found, validate role & password
  if (user) {
    // Check role alignment if specific role was targeted
    const reqRole = role === 'member' ? 'buyer' : role;
    const userRole = user.role === 'member' ? 'buyer' : user.role;
    if (reqRole && reqRole !== userRole && reqRole !== 'admin') {
      // If user signed up with different role, inform respectfully
      const displayRole = user.role === 'buyer' ? 'Member' : user.role === 'merchant' ? 'Merchant' : user.role === 'lender' ? 'Lender' : 'Admin';
      return res.status(400).json({
        error: `This account is registered as a ${displayRole}. Please select the ${displayRole} tab to sign in.`,
      });
    }

    if (user.password && password && user.password !== password) {
      return res.status(400).json({ error: 'Incorrect password. Please verify and try again.' });
    }

    if (password && !user.password) {
      user.password = password;
    }

    user.lastActive = Date.now();
    await saveDatabase(db);
    return res.json({ user, notice: `Welcome back, ${user.name}!` });
  }

  // User not found
  if (role === 'admin') {
    return res.status(403).json({
      error: 'Admin account not found. Admin access is restricted to verified administrators by invitation only.',
    });
  }

  // If phone was provided directly via quick-login, allow auto-creation for backward compatibility
  if (phone && !identifier) {
    const trimmedPhone = phone.trim();
    const newUser: User = {
      id: db.nextIds.user++,
      name: (name || 'User ' + trimmedPhone.slice(-4)).trim(),
      phone: trimmedPhone,
      email: `${trimmedPhone}@buyoll.com`,
      role: role === 'merchant' ? 'merchant' : role === 'lender' ? 'lender' : 'member',
      shopName: role === 'merchant' ? (shopName || name || 'My Store').trim() : undefined,
      shopDescription: role === 'merchant' ? (shopDescription || 'Authentic store on Buyoll').trim() : undefined,
      verified: role === 'merchant' ? false : undefined,
      credit: role === 'lender' ? 50000 : 0,
      coins: 50,
      points: 10,
      lastActive: Date.now(),
      createdAt: Date.now(),
    };
    db.users.push(newUser);
    logAudit(db, newUser.id, newUser.name, 'USER_REGISTERED', `Registered new ${newUser.role} account.`);
    await saveDatabase(db);
    return res.json({ user: newUser });
  }

  return res.status(404).json({
    error: 'No account found with this email/phone. Please switch to Sign up or check your credentials.',
  });
});

apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  const { role, name, email, password, phone, shopName, shopDescription } = req.body;

  if (role === 'admin') {
    return res.status(403).json({
      error: 'Admin accounts cannot be registered publicly. Access is strictly by invitation only.',
    });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Please enter your full or business name.' });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }

  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  const db = await getDatabase();
  const cleanEmail = email.trim().toLowerCase();
  const existing = db.users.find(
    (u) =>
      (u.email && u.email.toLowerCase() === cleanEmail) ||
      (phone && u.phone && u.phone === phone.trim())
  );

  if (existing) {
    return res.status(400).json({
      error: 'An account with this email address already exists. Please log in instead.',
    });
  }

  const cleanRole = role === 'merchant' ? 'merchant' : role === 'lender' ? 'lender' : 'member';
  const autoPhone = phone ? phone.trim() : '07' + Math.floor(10000000 + Math.random() * 90000000).toString();

  const newUser: User = {
    id: db.nextIds.user++,
    name: name.trim(),
    email: cleanEmail,
    phone: autoPhone,
    password: password.trim(),
    role: cleanRole,
    shopName: cleanRole === 'merchant' ? (shopName || name).trim() : undefined,
    shopDescription:
      cleanRole === 'merchant'
        ? (shopDescription || 'Verified store on Buyoll. Authentic goods with Chama installment plan.').trim()
        : undefined,
    verified: cleanRole === 'merchant' ? false : undefined,
    credit: cleanRole === 'lender' ? 50000 : 0,
    coins: 100,
    points: 25,
    lastActive: Date.now(),
    createdAt: Date.now(),
  };

  db.users.push(newUser);
  logAudit(db, newUser.id, newUser.name, 'USER_REGISTERED', `New ${newUser.role} account registered through portal.`);
  await saveDatabase(db);

  res.json({
    user: newUser,
    notice: 'Account created successfully! Welcome to Buyoll.',
  });
});

apiRouter.get('/auth/users', async (req: Request, res: Response) => {
  const db = await getDatabase();
  // Return users list for switcher/profile selection
  res.json({
    users: db.users.map(u => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      shopName: u.shopName,
      verified: u.verified,
      starRating: u.starRating || 5.0,
      ratingCount: u.ratingCount || 15,
    })),
  });
});

// -------------------------------------------------------------
// RATE MERCHANT / SHOP OWNER (MEMBER REVIEWS & REPUTATION)
// -------------------------------------------------------------
apiRouter.post('/merchants/:id/rate', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in to rate this shop owner.' });
  }

  const { rating, comment } = req.body;
  const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
  const merchantId = Number(req.params.id);

  const db = await getDatabase();
  const merchant = db.users.find(u => u.id === merchantId);
  if (!merchant) {
    return res.status(404).json({ error: 'Merchant not found.' });
  }

  if (!merchant.reviews) {
    merchant.reviews = [];
  }

  const newReview = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId: user.id,
    userName: user.name,
    rating: numRating,
    comment: (comment || 'Excellent verified merchant with prompt delivery and genuine products.').trim(),
    createdAt: Date.now(),
  };

  merchant.reviews.unshift(newReview);
  merchant.ratingCount = merchant.reviews.length;
  const sumRatings = merchant.reviews.reduce((acc, r) => acc + r.rating, 0);
  merchant.starRating = Number((sumRatings / merchant.ratingCount).toFixed(1));

  logAudit(db, user.id, user.name, 'MERCHANT_RATED', `Rated merchant "${merchant.shopName || merchant.name}" with ${numRating} stars`);
  await saveDatabase(db);

  res.json({
    success: true,
    starRating: merchant.starRating,
    ratingCount: merchant.ratingCount,
    review: newReview,
    message: `Thank you for rating ${merchant.shopName || merchant.name}! Your review helps verified merchants grow and attract new customers.`,
  });
});

apiRouter.get('/merchants/:id', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const merchantId = Number(req.params.id);
  const merchant = db.users.find(u => u.id === merchantId);
  if (!merchant) {
    return res.status(404).json({ error: 'Merchant not found.' });
  }
  res.json({
    merchant: {
      id: merchant.id,
      name: merchant.name,
      shopName: merchant.shopName,
      shopDescription: merchant.shopDescription,
      verified: merchant.verified,
      starRating: merchant.starRating || 5.0,
      ratingCount: merchant.ratingCount || (merchant.reviews ? merchant.reviews.length : 18),
      reviews: merchant.reviews || [],
      tillNumber: merchant.tillNumber,
    },
  });
});

// -------------------------------------------------------------
// SEARCH ROUTE
// -------------------------------------------------------------
apiRouter.get('/search', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const q = String(req.query.q || req.query.search || '').toLowerCase().trim();
  
  if (!q) {
    const liveProducts = db.products.filter(p => p.live);
    return res.json({ products: liveProducts, query: '', total: liveProducts.length });
  }

  const results = db.products.filter(p => {
    if (!p.live) return false;
    const titleMatch = p.title.toLowerCase().includes(q);
    const descMatch = p.description.toLowerCase().includes(q);
    const catMatch = p.category.toLowerCase().includes(q);
    const vendorMatch = p.vendorName.toLowerCase().includes(q);
    const attrMatch = p.attributes
      ? Object.values(p.attributes).some(v => String(v).toLowerCase().includes(q))
      : false;
    return titleMatch || descMatch || catMatch || vendorMatch || attrMatch;
  });

  res.json({ products: results, query: q, total: results.length });
});

// -------------------------------------------------------------
// PRODUCTS ROUTES
// -------------------------------------------------------------
apiRouter.get('/products', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const { category, search, vendorId } = req.query;

  let products = db.products.filter(p => p.live && p.moderationStatus === 'approved');

  if (category && typeof category === 'string' && category !== 'All') {
    products = products.filter(p => p.category === category);
  }

  if (search && typeof search === 'string' && search.trim()) {
    const q = search.toLowerCase().trim();
    products = products.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.vendorName.toLowerCase().includes(q)
    );
  }

  if (vendorId) {
    products = products.filter(p => p.vendorId === Number(vendorId));
  }

  res.json({ products });
});

apiRouter.get('/products/:id', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const product = db.products.find(p => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Also include the product's active Chama groups
  const groups = db.groups.filter(g => g.productId === product.id && (g.status === 'active' || g.status === 'full'));

  res.json({ product, groups });
});

// -------------------------------------------------------------
// BUYOLL.AI DEDICATED TOOL ON EACH PRODUCT
// Chat-oriented, positive recommendations only, short & on-point, inquiry history logged
// -------------------------------------------------------------
apiRouter.post('/products/:id/ai-chat', async (req: Request, res: Response) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const db = await getDatabase();
  const product = db.products.find(p => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const user = await getAuthenticatedUser(req);
  const qText = String(question).trim();

  let aiAnswer = '';

  const systemInstruction = `You are Buyoll.ai, the dedicated positive product sales assistant and enthusiastic product advocate for "${product.title}" on Buyoll (Kenya's leading social fintech Chama marketplace).
Strict Rules:
1. Speak about this product strictly in a glowing, helpful, and highly positive light.
2. Highlight its features, benefits, specifications, and exceptional value (Price: KSh ${product.price.toLocaleString()}, Category: ${product.category}, Seller: ${product.vendorName}).
3. Strongly encourage and ask the member to buy it or join an active Chama group right now (available in speeds of 10, 8, 6, 4, 2 members, or 1-member solo Lipa Mdogomdogo over 1 to 6 months).
4. FORBIDDEN: You are strictly forbidden from answering in any negative way, highlighting flaws, or discouraging the customer.
5. Keep your answer SHORT, CONCISE, and on point (2 to 4 sentences maximum).`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Customer question about ${product.title}: "${qText}". Please provide a short, positive, helpful answer that highlights benefits and strongly asks them to buy or join a Chama group today.`,
        config: {
          systemInstruction,
        },
      });

      aiAnswer = response.text?.trim() || '';
    }
  } catch (err: any) {
    console.error('Gemini API call failed, using positive fallback:', err);
  }

  // Guaranteed positive fallback response
  if (!aiAnswer) {
    const bonusMention = product.bonusGift ? ` plus you receive an enticing free merchant bonus gift: ${product.bonusGift}!` : '!';
    aiAnswer = `The ${product.title} is an incredible, highly-rated choice offering supreme quality, reliability, and top-tier value${bonusMention} At only KSh ${product.price.toLocaleString()}, you can easily acquire it today in full or through our flexible Chama daily savings (from 10, 8, 6, 4, 2 down to 1-member Lipa Mdogomdogo over 1 to 6 months). We warmly recommend securing your slot right now!`;
  }

  const inquiry = {
    id: `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    userId: user?.id,
    userName: user?.name || 'Shopper',
    question: qText,
    answer: aiAnswer,
    timestamp: Date.now(),
  };

  if (!product.aiInquiries) {
    product.aiInquiries = [];
  }
  product.aiInquiries.unshift(inquiry);
  if (product.aiInquiries.length > 100) {
    product.aiInquiries = product.aiInquiries.slice(0, 100);
  }

  await saveDatabase(db);

  res.json({
    inquiry,
    history: product.aiInquiries,
  });
});

apiRouter.get('/products/:id/ai-history', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const product = db.products.find(p => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json({
    history: product.aiInquiries || [],
  });
});

// -------------------------------------------------------------
// MERCHANT (BUYOLL DIRECT) ONBOARDING & SUBSCRIPTION FLOW
// -------------------------------------------------------------
apiRouter.post('/merchant/subscribe', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { plan, paymentCode, tillNumber, paybillNumber } = req.body;
  const cleanPlan = plan === 'enterprise' ? 'enterprise' : plan === 'pro' ? 'pro' : 'starter';
  const planAmounts: Record<string, number> = {
    starter: 1500,
    pro: 3500,
    enterprise: 7000,
  };
  const amount = planAmounts[cleanPlan];

  const trimmedCode = String(paymentCode || '').trim().toUpperCase();
  if (!trimmedCode) {
    return res.status(400).json({ error: 'Please enter your M-Pesa transaction code for the subscription payment.' });
  }

  const codeRegex = /^[A-Z0-9]{8,12}$/i;
  if (!codeRegex.test(trimmedCode)) {
    return res.status(400).json({
      error: 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters (e.g. RJL798K2MN).',
    });
  }

  const db = await getDatabase();

  // Prevent duplicate code reuse
  if (db.payments.some(p => p.code === trimmedCode)) {
    return res.status(400).json({
      error: `Transaction code "${trimmedCode}" has already been submitted on the platform.`,
    });
  }

  // Update merchant subscription details
  user.role = 'merchant';
  user.merchantSubscriptionStatus = 'pending_verification';
  user.merchantSubscriptionPlan = cleanPlan;
  user.merchantSubscriptionTxCode = trimmedCode;
  if (tillNumber) user.tillNumber = String(tillNumber).trim();
  if (paybillNumber) user.paybillNumber = String(paybillNumber).trim();

  // Matched statement check
  const matchedStatement = (db.mpesaStatements || []).find(
    s => s.code.toUpperCase() === trimmedCode && Math.abs(s.amount - amount) <= 10
  );

  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: 'merchant_subscription',
    userId: user.id,
    userName: user.name,
    code: trimmedCode,
    amount,
    status: 'pending',
    matchedTillEntry: matchedStatement,
    createdAt: Date.now(),
  };

  db.payments.unshift(paymentRecord);
  logAudit(
    db,
    user.id,
    user.name,
    'MERCHANT_SUBSCRIPTION_SUBMITTED',
    `Submitted KSh ${amount.toLocaleString()} for ${cleanPlan.toUpperCase()} merchant plan (Code: ${trimmedCode})`
  );

  await saveDatabase(db);

  res.status(201).json({
    user,
    payment: paymentRecord,
    message: `Subscription for ${cleanPlan.toUpperCase()} plan (KSh ${amount.toLocaleString()}) submitted. Awaiting Admin verification. Status: Pending Verification.`,
  });
});

// Vendor product creation
apiRouter.post('/products', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only verified merchants or admins can create products' });
  }

  const db = await getDatabase();

  // Merchant gating check: Subscription must be active, verified, and within tier product limits
  if (user.role === 'merchant') {
    if (user.merchantSubscriptionStatus !== 'active' || !user.verified) {
      return res.status(403).json({
        error: 'Active merchant subscription and Buyoll verification required to list products. Please complete subscription or wait for admin approval.',
        subscriptionStatus: user.merchantSubscriptionStatus || 'inactive',
        isVerified: Boolean(user.verified),
      });
    }

    const activeSub = (db.merchantSubscriptions || []).find(
      (s) => s.merchantId === user.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > Date.now())
    );
    const tierId = activeSub?.tierId || (user.merchantSubscriptionPlan === 'starter' ? 'tier_250' : 'tier_500');
    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId) || SUBSCRIPTION_TIERS[0];

    if (tier.maxProducts !== -1) {
      const currentProductsCount = db.products.filter((p) => p.vendorId === user.id).length;
      if (currentProductsCount >= tier.maxProducts) {
        return res.status(403).json({
          error: `You have reached your catalog limit of ${tier.maxProducts} product(s) for the ${tier.name}. Please upgrade after your current 30-day subscription ends.`,
        });
      }
    }
  }

  const { title, description, category, price, wasPrice, discountPercent, images, speedOptions, stockQuantity, attributes, promotionType, promotionDiscount, bonusGift } = req.body;

  if (!title || !description || !price || !category) {
    return res.status(400).json({ error: 'Title, description, category, and price are required' });
  }
  const numPrice = Number(price);

  // Generate standard speed options including 1-member Lipa Mdogomdogo
  const parsedSpeedOptions = Array.isArray(speedOptions) && speedOptions.length > 0
    ? speedOptions
    : [
        { size: 10, cycleDays: 10, dailyAmount: Math.ceil(numPrice / 10 / 10), totalAmount: numPrice, description: '10 members · Daily installment · Rotation every 10 days' },
        { size: 8, cycleDays: 10, dailyAmount: Math.ceil(numPrice / 8 / 10), totalAmount: numPrice, description: '8 members · Rotation every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: Math.ceil(numPrice / 6 / 10), totalAmount: numPrice, description: '6 members · 60-day cycle' },
        { size: 4, cycleDays: 10, dailyAmount: Math.ceil(numPrice / 4 / 10), totalAmount: numPrice, description: '4 members · 40-day cycle' },
        { size: 2, cycleDays: 10, dailyAmount: Math.ceil(numPrice / 2 / 10), totalAmount: numPrice, description: '2 members · 20-day cycle' },
        { size: 1, cycleDays: 180, dailyAmount: Math.ceil(numPrice / 180), totalAmount: numPrice, description: '1 member · Lipa Mdogomdogo (Installments) · 1 to 6 Months maximum' },
      ];

  const newProduct: Product = {
    id: db.nextIds.product++,
    title: title.trim(),
    description: description.trim(),
    category: category.trim(),
    price: numPrice,
    wasPrice: wasPrice ? Number(wasPrice) : undefined,
    discountPercent: discountPercent ? Number(discountPercent) : undefined,
    images: Array.isArray(images) && images.length > 0 ? images : ['/src/assets/images/stainless_cookware_set_1792852473733.jpg'],
    vendorId: user.id,
    vendorName: user.shopName || user.name,
    isFeatured: req.body.isFeatured || false,
    live: true,
    moderationStatus: 'approved',
    stockQuantity: stockQuantity ? Number(stockQuantity) : 10,
    attributes: attributes || {},
    speedOptions: parsedSpeedOptions,
    promotionType: promotionType || 'none',
    promotionDiscount: promotionDiscount ? Number(promotionDiscount) : undefined,
    bonusGift: bonusGift?.trim() || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.products.unshift(newProduct);
  logAudit(db, user.id, user.name, 'PRODUCT_CREATED', `Created product "${newProduct.title}" (KSh ${newProduct.price})`);
  await saveDatabase(db);

  res.status(201).json({ product: newProduct });
});

// PART 6: MAKE VENDOR PRODUCT INFORMATION EDITABLE
apiRouter.put('/products/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = await getDatabase();
  const productId = Number(req.params.id);
  const product = db.products.find(p => p.id === productId);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Vendor ownership or Admin authorization check
  if (product.vendorId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not have permission to edit this product. Only the owner can edit it.' });
  }

  const {
    title,
    description,
    category,
    price,
    wasPrice,
    discountPercent,
    images,
    speedOptions,
    stockQuantity,
    attributes,
    isFeatured,
    live,
  } = req.body;

  if (title !== undefined) product.title = String(title).trim();
  if (description !== undefined) product.description = String(description).trim();
  if (category !== undefined) product.category = String(category).trim();

  if (price !== undefined) {
    const p = Number(price);
    if (p <= 0) return res.status(400).json({ error: 'Price must be greater than zero' });
    product.price = p;
  }

  if (wasPrice !== undefined) {
    product.wasPrice = wasPrice ? Number(wasPrice) : undefined;
  }

  if (discountPercent !== undefined) {
    product.discountPercent = discountPercent ? Number(discountPercent) : undefined;
  }

  if (Array.isArray(images) && images.length > 0) {
    product.images = images;
  }

  if (stockQuantity !== undefined) {
    product.stockQuantity = Number(stockQuantity);
  }

  if (attributes !== undefined && typeof attributes === 'object') {
    product.attributes = attributes;
  }

  if (Array.isArray(speedOptions) && speedOptions.length > 0) {
    product.speedOptions = speedOptions;
  }

  if (isFeatured !== undefined) {
    const willBeFeatured = Boolean(isFeatured);
    if (willBeFeatured && !product.isFeatured) {
      // Record 500 KSh merchant featured listing placement
      logAudit(db, user.id, user.name, 'FEATURED_LISTING_PAID', `Merchant opted in to Featured Hero Deal for product #${product.id} (KSh 500 placement fee)`);
    }
    product.isFeatured = willBeFeatured;
  }

  if (live !== undefined) {
    product.live = Boolean(live);
  }

  if (req.body.promotionType !== undefined) {
    product.promotionType = req.body.promotionType;
  }

  if (req.body.promotionDiscount !== undefined) {
    product.promotionDiscount = Number(req.body.promotionDiscount);
  }

  if (req.body.bonusGift !== undefined) {
    product.bonusGift = req.body.bonusGift?.trim() || undefined;
  }

  product.updatedAt = Date.now();

  logAudit(db, user.id, user.name, 'PRODUCT_UPDATED', `Updated product #${product.id} "${product.title}"`);
  await saveDatabase(db);

  res.json({ product, message: 'Product updated successfully.' });
});

// DELETE / REMOVE PRODUCT (STORE OWNER OR ADMIN)
apiRouter.delete('/products/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const db = await getDatabase();
  const productId = Number(req.params.id);
  const productIndex = db.products.findIndex(p => p.id === productId);

  if (productIndex === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = db.products[productIndex];
  if (product.vendorId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the merchant owner or admin can remove this product' });
  }

  // Remove product and mark its open empty groups as cancelled
  db.products.splice(productIndex, 1);
  for (const g of db.groups) {
    if (g.productId === productId && g.occupiedCount <= 1) {
      g.status = 'cancelled';
    }
  }

  logAudit(db, user.id, user.name, 'PRODUCT_DELETED', `Deleted product #${productId} "${product.title}"`);
  await saveDatabase(db);

  res.json({ success: true, message: `Product "${product.title}" has been successfully removed.` });
});

// STORE OWNER PRE-CREATES SPEED GROUPS (UP TO ALL 10 SPEEDS: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1)
apiRouter.post('/products/:id/generate-groups', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only merchants / store owners or admins can pre-create Chama groups' });
  }

  const db = await getDatabase();
  const productId = Number(req.params.id);
  const product = db.products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  // Standard speeds: 10 down to 1
  const standardSizes = [10, 8, 6, 4, 2, 1];
  const createdGroups: ChamaGroup[] = [];

  for (const size of standardSizes) {
    const existing = db.groups.find(g => g.productId === product.id && g.size === size && g.status === 'active');
    if (!existing) {
      const isSolo = size === 1;
      const speedOpt = product.speedOptions?.find(s => s.size === size) || {
        size,
        cycleDays: isSolo ? 180 : 10,
        dailyAmount: isSolo ? Math.ceil(product.price / 180) : Math.ceil(product.price / size / 10),
        totalAmount: product.price,
      };

      const newGroup: ChamaGroup = {
        id: db.nextIds.group++,
        productId: product.id,
        productTitle: product.title,
        productPrice: product.price,
        productImage: product.images?.[0] || './images/cookware_set.jpg',
        name: isSolo
          ? `${product.title.slice(0, 22)} (1-Member Solo Lipa Mdogomdogo)`
          : `${product.title.slice(0, 24)} (${size}-Member Speed)`,
        size,
        adminId: user.id,
        moderators: [user.id],
        status: 'active',
        inviteCode: generateCode(),
        dailyAmount: speedOpt.dailyAmount,
        cycleDays: speedOpt.cycleDays || (isSolo ? 180 : 10),
        slots: Array.from({ length: size }, (_, i) => ({
          slotNumber: i + 1,
          userId: null,
          userName: null,
          userPhone: null,
          status: 'open',
          inviteCode: generateCode(),
          paidAmount: 0,
          targetAmount: product.price,
        })),
        occupiedCount: 0,
        availableCount: size,
        platformTill: '196853',
        platformPaybill: '522533',
        platformAccount: 'code4363',
        merchantTill: user.tillNumber || '3463533',
        merchantPaybill: '26253326',
        merchantAccount: 'Code4533',
        currentRound: 1,
        currentRecipientSlot: 1,
        currentRoundPaid: 0,
        targetAmountPerRound: product.price,
        roundBalanceRemaining: product.price,
        isReadyForPickup: false,
        deliveredRounds: [],
        lenderId: null,
        lenderName: null,
        chat: [
          {
            id: `chat_${Date.now()}_${size}`,
            senderId: user.id,
            senderName: user.shopName || user.name,
            kind: 'system',
            text: isSolo
              ? `Solo Lipa Mdogomdogo group opened! Save slowly over 1 to 6 months. Platform Till: 196853, Paybill: 522533 (Account: code4363). No Escrow.`
              : `Chama group pre-created with ${size}-member speed. Platform Till: 196853, Paybill: 522533 (Account: code4363). Members can choose speed, join, and begin saving!`,
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
      };
      db.groups.push(newGroup);
      createdGroups.push(newGroup);
    }
  }

  logAudit(db, user.id, user.name, 'GROUPS_PRE_CREATED', `Pre-created ${createdGroups.length} speed groups for product #${product.id}`);
  await saveDatabase(db);

  res.json({
    success: true,
    createdCount: createdGroups.length,
    groups: db.groups.filter(g => g.productId === product.id),
    message: `Generated speed groups (including 1-Member Solo Lipa Mdogomdogo and standard speeds) for this product!`,
  });
});

// -------------------------------------------------------------
// CHAMA GROUPS ROUTES
// PART 2: MANDATORY SPEED SELECTION
// PART 3: GROUP CREATOR BECOMES MEMBER #1 AND MODERATOR
// PART 4: GROUP STARTS IMMEDIATELY (ACTIVE STATUS)
// -------------------------------------------------------------
apiRouter.get('/groups', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const { productId, status } = req.query;

  let groups = db.groups;
  if (productId) {
    groups = groups.filter(g => g.productId === Number(productId));
  }
  if (status && typeof status === 'string') {
    groups = groups.filter(g => g.status === status);
  }

  res.json({ groups });
});

apiRouter.get('/groups/:id', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }
  res.json({ group });
});

// Create group: Store owners / merchants open groups with choice of speed and Till
apiRouter.post('/groups', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be signed in to start a Chama group' });
  }

  // Any authenticated user can start a Chama group or solo Lipa Mdogomdogo plan
  const { productId, size, name, months, paymentMode } = req.body;

  // Merchant check: If merchant, must be verified and active subscription
  if (user.role === 'merchant' && (user.merchantSubscriptionStatus !== 'active' || !user.verified)) {
    return res.status(403).json({
      error: 'Active merchant subscription and Buyoll verification required to create speed groups.',
    });
  }

  // Mandatory speed check
  if (!size || Number(size) <= 0) {
    return res.status(400).json({ error: 'Mandatory speed selection required. Please choose a speed to continue.' });
  }

  const db = await getDatabase();
  const product = db.products.find(p => p.id === Number(productId));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Strict ownership check: Merchant can only add groups inside products created by their store
  if (user.role === 'merchant') {
    if (product.vendorId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only create Chama groups inside products created by your store.' });
    }

    // Subscription tier group-per-product limit
    const activeSub = (db.merchantSubscriptions || []).find(
      (s) => s.merchantId === user.id && s.status === 'active' && (!s.expiresAt || s.expiresAt > Date.now())
    );
    const tierId = activeSub?.tierId || (user.merchantSubscriptionPlan === 'starter' ? 'tier_250' : 'tier_500');
    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId) || SUBSCRIPTION_TIERS[0];

    const currentGroupsForProduct = db.groups.filter((g) => g.productId === product.id).length;
    if (currentGroupsForProduct >= tier.maxGroupsPerProduct) {
      return res.status(403).json({
        error: `You have reached the maximum of ${tier.maxGroupsPerProduct} groups per product for the ${tier.name}. Please upgrade after your current 30-day subscription ends.`,
      });
    }
  }

  const speedSize = Number(size);
  if (speedSize < 1 || speedSize > 10) {
    return res.status(400).json({ error: 'Group speed must be between 1 and 10 members.' });
  }

  const soloDurationMonths = Math.min(6, Math.max(1, Number(months) || 3));
  const validSpeed = product.speedOptions.find(s => s.size === speedSize) || {
    size: speedSize,
    cycleDays: speedSize === 1 ? soloDurationMonths * 30 : 10,
    dailyAmount: speedSize === 1
      ? Math.ceil(product.price / (soloDurationMonths * 30))
      : Math.ceil(product.price / speedSize / 10),
    totalAmount: product.price,
    description: speedSize === 1
      ? `1 Member Solo (Lipa Mdogomdogo) · ${soloDurationMonths} Months`
      : `${speedSize} members · Delivery rotation every 10 days`,
  };

  // Prevent duplicate open group by the same creator for the exact same product if already active
  const existingActive = db.groups.find(
    g => g.productId === product.id && g.adminId === user.id && g.status === 'active' && g.slots.some(s => s.userId === user.id)
  );
  if (existingActive) {
    return res.status(400).json({
      error: `You already have an active group for this product: "${existingActive.name}".`,
      existingGroupId: existingActive.id,
    });
  }

  const groupName = (name || `${user.name}’s ${validSpeed.size}-Member Chama`).trim();
  const creatorCode = generateCode();
  const resolvedPaymentMode: 'platform' | 'merchant' =
    paymentMode === 'merchant' && (user.tillNumber || user.paybillNumber) ? 'merchant' : 'platform';

  // Create slots: slot #1 is assigned to creator immediately
  const slots: GroupSlot[] = Array.from({ length: validSpeed.size }, (_, i) => {
    const slotNumber = i + 1;
    if (slotNumber === 1) {
      return {
        slotNumber: 1,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone,
        status: 'active',
        inviteCode: creatorCode,
        paidAmount: 0,
        targetAmount: product.price,
        joinedAt: Date.now(),
        paidDays: [],
        pendingDays: [],
        dailyPaymentRecords: [],
      };
    }
    return {
      slotNumber,
      userId: null,
      userName: null,
      status: 'open',
      inviteCode: generateCode(),
      paidAmount: 0,
      targetAmount: product.price,
      paidDays: [],
      pendingDays: [],
      dailyPaymentRecords: [],
    };
  });

  const newGroup: ChamaGroup = {
    id: db.nextIds.group++,
    productId: product.id,
    productTitle: product.title,
    productPrice: product.price,
    productImage: product.images[0] || '',
    name: groupName,
    size: validSpeed.size,
    adminId: user.id,
    moderators: [user.id], // Creator is the default moderator
    status: 'active', // Group starts immediately!
    inviteCode: creatorCode,
    dailyAmount: validSpeed.dailyAmount,
    cycleDays: validSpeed.cycleDays,
    slots,
    occupiedCount: 1,
    availableCount: validSpeed.size - 1,
    paymentMode: resolvedPaymentMode,
    platformTill: '196853',
    platformPaybill: '522533',
    platformAccount: 'code4363',
    merchantTill: user.tillNumber || '3463533',
    merchantPaybill: user.paybillNumber || '26253326',
    merchantAccount: 'Code4533',
    currentRound: 1,
    currentRecipientSlot: 1,
    currentRoundPaid: 0,
    targetAmountPerRound: product.price,
    roundBalanceRemaining: product.price,
    isReadyForPickup: false,
    deliveredRounds: [],
    lenderId: null,
    lenderName: null,
    isInviteOnly: true,
    inviteRequests: [],
    notifications: [
      {
        id: `notif_new_grp_${db.nextIds.group}_${Date.now()}`,
        groupId: db.nextIds.group,
        groupName: groupName,
        title: `🎉 New Chama Launched by ${user.shopName || user.name}!`,
        message: `${user.shopName || user.name} just created "${groupName}" for "${product.title}" (${validSpeed.size} members @ KSh ${validSpeed.dailyAmount}/day). Click the link to check details & request an invite!`,
        link: `/chama/${db.nextIds.group}`,
        type: 'new_group_created',
        timestamp: Date.now(),
      },
    ],
    chat: [
      {
        id: `chat_${Date.now()}`,
        senderId: user.id,
        senderName: user.name,
        kind: 'system',
        text: `Chama group started! ${user.name} is Member #1 and moderator. Platform Till: 196853, Paybill: 522533 (Account: code4363). Group is active immediately. Entry is by invite only.`,
        timestamp: Date.now(),
      },
    ],
    createdAt: Date.now(),
  };

  db.groups.unshift(newGroup);
  logAudit(
    db,
    user.id,
    user.name,
    'GROUP_CREATED',
    `Created Chama #${newGroup.id} for "${product.title}" (${newGroup.size} members). Creator became Member #1 and moderator. Group activated immediately.`
  );

  await saveDatabase(db);
  res.status(201).json({ group: newGroup, message: 'Your group was created and activated immediately. You are Member #1.' });
});

// Group Immutability: Merchants CANNOT edit or delete a group once created!
apiRouter.put('/groups/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (user?.role === 'merchant') {
    return res.status(403).json({
      error: 'Merchants cannot edit Chama groups. Once created, groups belong strictly to their members and moderators.',
    });
  }
  return res.status(404).json({ error: 'Direct group modification not permitted.' });
});

apiRouter.delete('/groups/:id', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (user?.role === 'merchant') {
    return res.status(403).json({
      error: 'Merchants cannot delete, archive, or deactivate Chama groups. Groups belong strictly to their members.',
    });
  }
  return res.status(404).json({ error: 'Group deletion not permitted.' });
});

// Join group with code
apiRouter.post('/groups/:id/join', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be signed in to join a Chama group' });
  }

  const { inviteCode, slotNumber } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));

  if (!group) {
    return res.status(404).json({ error: 'Chama group not found' });
  }

  if (group.status !== 'active') {
    return res.status(400).json({ error: `This group is ${group.status} and cannot accept new members.` });
  }

  // Check if user is already in this group
  const existingSlot = group.slots.find(s => s.userId === user.id && s.status === 'active');
  if (existingSlot) {
    return res.status(400).json({
      error: `You are already Member #${existingSlot.slotNumber} in this group. Your code is ${existingSlot.inviteCode}.`,
    });
  }

  // Validate invite code / Invite-only check
  const upperCode = (inviteCode || '').trim().toUpperCase();
  const approvedReq = (group.inviteRequests || []).find(
    r => r.userId === user.id && r.status === 'approved'
  );

  if (group.isInviteOnly) {
    const isCodeMatch =
      upperCode &&
      (group.inviteCode === upperCode ||
        group.slots.some(s => s.inviteCode === upperCode) ||
        (group.inviteRequests || []).some(
          r => r.status === 'approved' && r.issuedCode?.toUpperCase() === upperCode
        ));

    if (!isCodeMatch && !approvedReq) {
      return res.status(403).json({
        error: 'This Chama is Invite-Only. Please click "Request Entry Invite" or enter an approved invite code from the moderator.',
      });
    }
  } else if (upperCode) {
    const validCode =
      group.inviteCode === upperCode ||
      group.slots.some(s => s.inviteCode === upperCode) ||
      (approvedReq && approvedReq.issuedCode?.toUpperCase() === upperCode);
    if (!validCode) {
      return res.status(400).json({ error: 'Invalid invite code for this Chama group.' });
    }
  }

  // Find target slot: if user specified slotNumber, check if it's available
  let targetSlot: GroupSlot | undefined;
  if (slotNumber) {
    const requested = group.slots.find(s => s.slotNumber === Number(slotNumber));
    if (requested && (requested.status === 'open' || requested.status === 'replacement_eligible')) {
      targetSlot = requested;
    }
  }

  // If not specified or not available, pick next available (replacement first, then open)
  if (!targetSlot) {
    targetSlot = group.slots.find(s => s.status === 'replacement_eligible') || group.slots.find(s => s.status === 'open');
  }

  if (!targetSlot) {
    group.status = 'full';
    await saveDatabase(db);
    return res.status(400).json({ error: 'This Chama group is full. No available slots remain.' });
  }

  targetSlot.userId = user.id;
  targetSlot.userName = user.name;
  targetSlot.userPhone = user.phone;
  targetSlot.status = 'active';
  targetSlot.joinedAt = Date.now();
  targetSlot.isDefaulter = false;
  targetSlot.paidDays = targetSlot.paidDays || [];
  targetSlot.pendingDays = targetSlot.pendingDays || [];
  targetSlot.dailyPaymentRecords = targetSlot.dailyPaymentRecords || [];

  group.occupiedCount = group.slots.filter(s => s.status === 'active').length;
  group.availableCount = group.size - group.occupiedCount;

  if (group.occupiedCount >= group.size) {
    group.status = 'full';
  }

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'system',
    text: `${user.name} joined as Member #${targetSlot.slotNumber}!`,
    timestamp: Date.now(),
  });

  if (!group.notifications) group.notifications = [];
  group.notifications.unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    groupId: group.id,
    groupName: group.name,
    title: 'New Member Joined',
    message: `${user.name} joined as Member #${targetSlot.slotNumber}. Welcome to the cycle!`,
    type: 'system',
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'MEMBER_JOINED', `Joined Chama #${group.id} as Member #${targetSlot.slotNumber}`);
  await saveDatabase(db);

  res.json({
    group,
    assignedSlot: targetSlot.slotNumber,
    message: `Welcome! You are Member #${targetSlot.slotNumber}. Your allocation rotation is day ${targetSlot.slotNumber * group.cycleDays}.`,
  });
});

// SUBMIT DAILY PAYMENT FOR A SPECIFIC DAY OR CLEAR MISSED ARREARS
apiRouter.post('/groups/:id/pay-day', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { slotNumber, dayNumber, days, code, amount } = req.body;
  const trimmedCode = String(code || '').trim().toUpperCase();
  const numAmount = Number(amount);

  if (!trimmedCode) {
    return res.status(400).json({ error: 'Please enter your M-Pesa transaction code.' });
  }

  const codeRegex = /^[A-Z0-9]{8,12}$/i;
  if (!codeRegex.test(trimmedCode)) {
    return res.status(400).json({
      error: 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters (e.g. RJL798K2MN).',
    });
  }

  if (numAmount <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  }

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber) && s.userId === user.id && s.status === 'active');
  if (!slot) {
    return res.status(400).json({ error: 'Active slot not found for your account in this group.' });
  }

  // Prevent duplicate transaction code reuse
  if (db.payments.some(p => p.code === trimmedCode)) {
    return res.status(400).json({
      error: `Transaction code "${trimmedCode}" has already been submitted on the platform. Please check your M-Pesa SMS.`,
    });
  }

  const daysToMark: number[] = Array.isArray(days) && days.length > 0
    ? days.map(Number)
    : dayNumber ? [Number(dayNumber)] : [1];

  slot.paidDays = slot.paidDays || [];
  slot.pendingDays = slot.pendingDays || [];
  slot.dailyPaymentRecords = slot.dailyPaymentRecords || [];

  for (const d of daysToMark) {
    if (!slot.pendingDays.includes(d) && !slot.paidDays.includes(d)) {
      slot.pendingDays.push(d);
    }
    slot.dailyPaymentRecords.unshift({
      day: d,
      code: trimmedCode,
      amount: numAmount / daysToMark.length,
      status: 'pending',
      timestamp: Date.now(),
    });
  }

  // Check matching against Till statement entries (simulated Daraja / statement check)
  const matchedStatement = (db.mpesaStatements || []).find(
    s => s.code.toUpperCase() === trimmedCode && Math.abs(s.amount - numAmount) <= 5
  );

  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: 'group_installment',
    userId: user.id,
    userName: user.name,
    code: trimmedCode,
    amount: numAmount,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    productId: group.productId,
    daysPaid: daysToMark,
    status: 'pending',
    matchedTillEntry: matchedStatement,
    createdAt: Date.now(),
  };

  db.payments.unshift(paymentRecord);

  // Real-time group notification broadcast to all members
  if (!group.notifications) group.notifications = [];
  const daysLabel = daysToMark.length === 1 ? `Day ${daysToMark[0]}` : `Days ${daysToMark.join(', ')}`;
  group.notifications.unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    groupId: group.id,
    groupName: group.name,
    title: 'Contribution Submitted',
    message: `${user.name} submitted KSh ${numAmount.toLocaleString()} for ${daysLabel} (Code: ${trimmedCode}). Pending Admin verification.`,
    type: 'payment_submitted',
    timestamp: Date.now(),
  });

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'normal',
    text: `⏳ Submitted daily installment of KSh ${numAmount.toLocaleString()} for ${daysLabel} via M-Pesa (${trimmedCode}). Pending verification.`,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'PAYMENT_SUBMITTED', `Submitted payment for Chama #${group.id} slot #${slot.slotNumber} for ${daysLabel} (${trimmedCode})`);
  await saveDatabase(db);

  res.status(201).json({
    group,
    payment: paymentRecord,
    message: `Payment code ${trimmedCode} submitted for ${daysLabel}! Status is Pending (amber clock ⏳) until Admin approval.`,
  });
});

// GET REAL-TIME GROUP NOTIFICATIONS
apiRouter.get('/groups/:id/notifications', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  res.json({ notifications: group.notifications || [] });
});

// GET SYSTEM-WIDE BROADCAST NOTIFICATIONS (New group launches, invites, dues)
apiRouter.get('/notifications/system', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  const db = await getDatabase();

  const allNotifications: GroupNotification[] = [];
  for (const g of db.groups) {
    if (g.notifications) {
      for (const n of g.notifications) {
        if (!n.recipientUserId || (user && n.recipientUserId === user.id)) {
          allNotifications.push(n);
        }
      }
    }
  }

  allNotifications.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ notifications: allNotifications.slice(0, 30) });
});

// GET GROUP INVITE REQUESTS
apiRouter.get('/groups/:id/invite-requests', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  res.json({ requests: group.inviteRequests || [] });
});

// USER SUBMITS INVITE REQUEST TO JOIN GROUP
apiRouter.post('/groups/:id/invite-request', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { desiredSlot, note } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  if (group.slots.some(s => s.userId === user.id && s.status === 'active')) {
    return res.status(400).json({ error: 'You are already an active member of this Chama group.' });
  }

  if (!group.inviteRequests) group.inviteRequests = [];
  const existingPending = group.inviteRequests.find(r => r.userId === user.id && r.status === 'pending');
  if (existingPending) {
    return res.status(400).json({ error: 'You already have a pending invite request for this group. The moderator will review it shortly!' });
  }

  const newRequest: GroupInviteRequest = {
    id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    groupId: group.id,
    groupName: group.name,
    userId: user.id,
    userName: user.name,
    userPhone: user.phone,
    desiredSlot: desiredSlot ? Number(desiredSlot) : undefined,
    note: (note || '').trim(),
    status: 'pending',
    createdAt: Date.now(),
  };

  group.inviteRequests.unshift(newRequest);

  if (!group.notifications) group.notifications = [];
  group.notifications.unshift({
    id: `notif_req_${Date.now()}`,
    groupId: group.id,
    groupName: group.name,
    title: `📩 New Invite Request from ${user.name}`,
    message: `${user.name} (${user.phone}) requested an entry invite for Slot #${newRequest.desiredSlot || 'Any'}. Note: "${newRequest.note || 'Ready to contribute on time'}"`,
    type: 'invite_requested',
    timestamp: Date.now(),
  });

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: 1,
    senderName: 'System / Gatekeeper',
    kind: 'system',
    text: `🔔 Member ${user.name} requested an entry invite to join this Chama. Moderator can approve or decline in the Invite Requests panel.`,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'INVITE_REQUESTED', `Requested invite to join Chama #${group.id} (${group.name})`);
  await saveDatabase(db);

  res.status(201).json({
    request: newRequest,
    message: `Invite request submitted! The group moderator will review your request and issue an entry code.`,
  });
});

// MODERATOR DECIDES INVITE REQUEST (APPROVE OR DECLINE)
apiRouter.post('/groups/:id/invite-decide', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { requestId, action } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isMod = group.adminId === user.id || (group.moderators || []).includes(user.id) || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only the group moderator or store owner can decide invite requests.' });
  }

  const reqItem = (group.inviteRequests || []).find(r => r.id === requestId);
  if (!reqItem) {
    return res.status(404).json({ error: 'Invite request not found' });
  }

  if (action === 'approve') {
    const issuedCode = 'INV-' + Math.floor(1000 + Math.random() * 9000);
    reqItem.status = 'approved';
    reqItem.issuedCode = issuedCode;
    reqItem.decidedAt = Date.now();

    if (!group.notifications) group.notifications = [];
    group.notifications.unshift({
      id: `notif_appr_${Date.now()}`,
      groupId: group.id,
      groupName: group.name,
      recipientUserId: reqItem.userId,
      title: `🎉 Invite Approved for ${group.name}!`,
      message: `Moderator ${user.name} approved your entry! Your unique entry code is "${issuedCode}". Click here to join your slot now!`,
      link: `/chama/${group.id}`,
      type: 'invite_approved',
      timestamp: Date.now(),
    });

    group.chat.push({
      id: `chat_${Date.now()}`,
      senderId: user.id,
      senderName: user.name,
      kind: 'system',
      text: `✅ Moderator approved entry invite for ${reqItem.userName}. Entry code "${issuedCode}" issued.`,
      timestamp: Date.now(),
    });

    logAudit(db, user.id, user.name, 'INVITE_APPROVED', `Approved invite for ${reqItem.userName} with code ${issuedCode}`);
    await saveDatabase(db);

    return res.json({
      request: reqItem,
      issuedCode,
      message: `Approved ${reqItem.userName}! Entry code "${issuedCode}" has been sent to the member.`,
    });
  } else {
    reqItem.status = 'declined';
    reqItem.decidedAt = Date.now();

    if (!group.notifications) group.notifications = [];
    group.notifications.unshift({
      id: `notif_decl_${Date.now()}`,
      groupId: group.id,
      groupName: group.name,
      recipientUserId: reqItem.userId,
      title: `Chama Invite Update: ${group.name}`,
      message: `Your invite request for ${group.name} was not approved at this time.`,
      link: `/chama/${group.id}`,
      type: 'invite_declined',
      timestamp: Date.now(),
    });

    await saveDatabase(db);
    return res.json({
      request: reqItem,
      message: `Declined invite request for ${reqItem.userName}.`,
    });
  }
});


// MEMBER REQUESTS LOAN INSIDE GROUP (TRIGGERS LENDER ALERTS)
apiRouter.post('/groups/:id/loan-request', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { amount, purpose, slotNumber } = req.body;
  const numAmount = Number(amount);
  if (numAmount <= 0) return res.status(400).json({ error: 'Loan amount must be greater than zero' });

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber) && s.userId === user.id);
  if (!slot) return res.status(400).json({ error: 'You do not hold an active slot in this group' });

  if (!db.peerLoans) db.peerLoans = [];
  const platformFee = Math.round(numAmount * 0.03); // 3% platform commission

  const newLoan: PeerLoanRequest = {
    id: db.nextIds.peerLoan++,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    requesterId: user.id,
    requesterName: user.name,
    requesterPhone: user.phone,
    productTitle: group.productTitle,
    productImage: group.productImage,
    amount: numAmount,
    purpose: (purpose || 'Chama installment advance').trim(),
    status: 'open',
    createdAt: Date.now(),
    platformFeePercent: 3,
    platformFeeAmount: platformFee,
    platformFeeStatus: 'pending',
    externalAgreementAcknowledged: true,
  };

  db.peerLoans.unshift(newLoan);

  // Group notification broadcast
  if (!group.notifications) group.notifications = [];
  group.notifications.unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    groupId: group.id,
    groupName: group.name,
    title: 'Loan Request Posted',
    message: `${user.name} requested an advance of KSh ${numAmount.toLocaleString()} for Slot #${slot.slotNumber}. Lenders notified!`,
    type: 'loan_request',
    timestamp: Date.now(),
  });

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'nudge',
    text: `📢 LOAN REQUEST: I requested a peer loan of KSh ${numAmount.toLocaleString()} to fulfill my slot contribution schedule on time. Verified 3rd-party lenders can fund this loan directly!`,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'LOAN_REQUESTED', `Requested P2P loan #${newLoan.id} of KSh ${numAmount} for Chama #${group.id}`);
  await saveDatabase(db);

  res.status(201).json({
    loan: newLoan,
    group,
    message: `Loan request of KSh ${numAmount.toLocaleString()} posted! All registered 3rd-party lenders have received a real-time notification with a direct link to your request.`,
  });
});

// PART 3.4 & 3.5: MODERATOR APPOINTMENT AND TRANSFER
apiRouter.post('/groups/:id/moderator', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { targetUserId, action } = req.body; // action: 'appoint' | 'remove' | 'transfer'
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));

  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Verify caller is a moderator
  const isCallerModerator = group.moderators.includes(user.id) || group.adminId === user.id || user.role === 'admin';
  if (!isCallerModerator) {
    return res.status(403).json({ error: 'Only group moderators or system admins can manage moderator roles.' });
  }

  const targetId = Number(targetUserId);
  if (targetId === user.id && action === 'appoint') {
    return res.status(400).json({ error: 'You cannot appoint yourself as moderator.' });
  }

  // Verify target is an existing active member of this group
  const isMember = group.slots.some(s => s.userId === targetId && s.status === 'active');
  if (!isMember) {
    return res.status(400).json({ error: 'Moderator can only be appointed from active members of this group.' });
  }

  const targetUser = db.users.find(u => u.id === targetId);
  const targetName = targetUser?.name || `User #${targetId}`;

  if (action === 'appoint') {
    if (!group.moderators.includes(targetId)) {
      group.moderators.push(targetId);
      logAudit(db, user.id, user.name, 'MODERATOR_APPOINTED', `Appointed ${targetName} as co-moderator in Chama #${group.id}`);
      group.chat.push({
        id: `chat_${Date.now()}`,
        senderId: user.id,
        senderName: user.name,
        kind: 'system',
        text: `${targetName} has been appointed as a Group Moderator by ${user.name}.`,
        timestamp: Date.now(),
      });
    }
  } else if (action === 'remove') {
    if (targetId === group.adminId) {
      return res.status(400).json({ error: 'Cannot remove primary group creator as moderator.' });
    }
    group.moderators = group.moderators.filter(id => id !== targetId);
    logAudit(db, user.id, user.name, 'MODERATOR_REMOVED', `Removed ${targetName} as moderator in Chama #${group.id}`);
  } else if (action === 'transfer') {
    if (user.id !== group.adminId && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the primary creator or admin can transfer primary leadership.' });
    }
    group.adminId = targetId;
    if (!group.moderators.includes(targetId)) group.moderators.push(targetId);
    logAudit(db, user.id, user.name, 'MODERATOR_TRANSFERRED', `Transferred primary leadership of Chama #${group.id} to ${targetName}`);
  }

  await saveDatabase(db);
  res.json({ group, message: `Moderator roles updated successfully.` });
});

// CONFIRM MEMBER ITEM PICKUP & RESET TOTAL PAID BACK TO ZERO FOR NEXT MEMBER
apiRouter.post('/groups/:id/complete-round', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Chama group not found' });

  const isMod = group.moderators.includes(user.id) || group.adminId === user.id || user.role === 'admin';
  const recipientSlot = group.currentRecipientSlot || 1;
  const isRecipient = group.slots.some(s => s.slotNumber === recipientSlot && s.userId === user.id);

  if (!isMod && !isRecipient) {
    return res.status(403).json({ error: 'Only group moderators, admins, or the recipient member can confirm item pickup and cycle reset.' });
  }

  const targetAmount = group.targetAmountPerRound || group.productPrice;
  const currentPaid = group.currentRoundPaid || 0;

  const recipientSlotObj = group.slots.find(s => s.slotNumber === recipientSlot);
  const recipientName = recipientSlotObj?.userName || `Member #${recipientSlot}`;
  const currentRoundNum = group.currentRound || 1;

  if (!group.deliveredRounds) group.deliveredRounds = [];
  group.deliveredRounds.push({
    roundNumber: currentRoundNum,
    recipientSlot,
    recipientName,
    deliveredAt: Date.now(),
    totalPaid: currentPaid,
  });

  // Cycle resets total paid back to 0 for the next member!
  group.currentRoundPaid = 0;
  group.roundBalanceRemaining = targetAmount;
  group.isReadyForPickup = false;
  group.currentRound = currentRoundNum + 1;

  // Move to next active slot
  const nextSlots = group.slots.filter(s => s.slotNumber > recipientSlot && s.status === 'active');
  if (nextSlots.length > 0) {
    group.currentRecipientSlot = nextSlots[0].slotNumber;
  } else {
    const firstActive = group.slots.find(s => s.status === 'active');
    group.currentRecipientSlot = firstActive ? firstActive.slotNumber : ((recipientSlot % group.size) || 1);
  }

  const nextRecipientObj = group.slots.find(s => s.slotNumber === group.currentRecipientSlot);
  const nextRecipientName = nextRecipientObj?.userName || `Member #${group.currentRecipientSlot}`;

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'system',
    text: `🎉 ITEM PICKED UP: ${recipientName} (Slot #${recipientSlot}) has officially picked up their ${group.productTitle}! All chama members' contributions toward this item are complete. The group total paid now resets to KSh 0 to start collecting for ${nextRecipientName} (Round #${group.currentRound})! 🚀`,
    timestamp: Date.now(),
  });

  logAudit(db, user.id, user.name, 'ROUND_COMPLETED', `Completed round #${currentRoundNum} for Chama #${group.id}. Item delivered to ${recipientName}. Group total reset to 0 for next member.`);
  await saveDatabase(db);

  res.json({
    group,
    message: `Item pickup confirmed for ${recipientName}! Total paid has reset back to KSh 0 to start collecting for ${nextRecipientName}.`,
  });
});

// PART 5: DEFAULTED MEMBERS, REFUNDS AND REPLACEMENT SLOTS
apiRouter.post('/groups/:id/default', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { slotNumber, reason } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));

  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Only moderator or admin can mark default
  const isMod = group.moderators.includes(user.id) || group.adminId === user.id || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators or admins can record member defaults.' });
  }

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber));
  if (!slot || slot.status !== 'active' || !slot.userId) {
    return res.status(400).json({ error: 'Slot is not currently active with a member.' });
  }

  const defaulterId = slot.userId;
  const defaulterName = slot.userName || 'Member';
  const amountPaid = slot.paidAmount || 0;
  const totalObligation = slot.targetAmount || group.productPrice;
  const amountOutstanding = Math.max(0, totalObligation - amountPaid);

  // 1. Record default in database
  const defaultRecord: DefaultRecord = {
    id: db.nextIds.defaultRecord++,
    userId: defaulterId,
    userName: defaulterName,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    productTitle: group.productTitle,
    totalObligation,
    amountPaid,
    amountOutstanding,
    defaultDate: Date.now(),
    reason: (reason || 'Missed scheduled Chama contribution').trim(),
    replacementStatus: 'available',
    resolutionStatus: 'pending',
  };

  db.defaultRecords.unshift(defaultRecord);

  // 2. Return slot to referral/replacement pool: mark as replacement_eligible
  slot.userId = null;
  slot.userName = null;
  slot.userPhone = null;
  slot.status = 'replacement_eligible';
  slot.inviteCode = generateCode();
  slot.paidAmount = 0; // Replacement member starts their payment schedule
  slot.isDefaulter = true;

  group.occupiedCount = group.slots.filter(s => s.status === 'active').length;
  group.availableCount = group.size - group.occupiedCount;
  group.status = 'active'; // Remains active and open for replacement!

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'system',
    text: `Slot #${slot.slotNumber} has been vacated and returned to the pool for replacement. Eligible for another buyer to join.`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'MEMBER_DEFAULTED',
    `Marked Member #${slot.slotNumber} (${defaulterName}) as defaulted in Chama #${group.id}. Paid: KSh ${amountPaid}. Slot returned to replacement pool.`
  );

  await saveDatabase(db);
  res.json({
    group,
    defaultRecord,
    message: `Member default recorded. Slot #${slot.slotNumber} is now open for replacement in the referral pool. Defaulter can choose refund, store credit, or order transfer.`,
  });
});

// MODERATOR MEMBER REMOVAL WITH INSTANT WALLET REFUND
apiRouter.post('/groups/:id/remove-member', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { slotNumber, reason } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Only moderator or admin can remove member
  const isMod = group.moderators.includes(user.id) || group.adminId === user.id || user.role === 'admin';
  if (!isMod) {
    return res.status(403).json({ error: 'Only group moderators or admins can remove members.' });
  }

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber));
  if (!slot || slot.status !== 'active' || !slot.userId) {
    return res.status(400).json({ error: 'Slot is not currently active with a member.' });
  }

  const removedUserId = slot.userId;
  const removedUserName = slot.userName || 'Member';
  const paidAmount = slot.paidAmount || 0;

  // 1. Immediately refund paid contribution into member's wallet credit balance
  const memberUser = db.users.find(u => u.id === removedUserId);
  if (memberUser && paidAmount > 0) {
    memberUser.credit = (memberUser.credit || 0) + paidAmount;
    db.storeCreditLedger.unshift({
      id: db.nextIds.ledger++,
      userId: memberUser.id,
      amount: paidAmount,
      balanceAfter: memberUser.credit,
      type: 'default_conversion',
      referenceId: `REFUND_REMOVE_${group.id}_S${slot.slotNumber}`,
      note: `Automatic wallet refund of KSh ${paidAmount.toLocaleString()} upon removal from Chama #${group.id} (${group.name}) for non-payment. Usable to join another group.`,
      createdAt: Date.now(),
    });
  }

  // Record in defaultRecords for audit and tracking
  db.defaultRecords.unshift({
    id: db.nextIds.defaultRecord++,
    userId: removedUserId,
    userName: removedUserName,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    productTitle: group.productTitle,
    totalObligation: slot.targetAmount || group.productPrice,
    amountPaid: paidAmount,
    amountOutstanding: Math.max(0, (slot.targetAmount || group.productPrice) - paidAmount),
    defaultDate: Date.now(),
    reason: (reason || 'Removed by moderator for non-participation in mandatory daily payment').trim(),
    replacementStatus: 'available',
    resolutionStatus: 'completed',
    resolutionOption: 'refund',
  });

  // 2. Slot becomes vacant / open immediately so a new member can join
  slot.userId = null;
  slot.userName = null;
  slot.userPhone = null;
  slot.status = 'open';
  slot.inviteCode = generateCode();
  slot.paidAmount = 0;
  slot.lastPaymentDate = undefined;
  slot.joinedAt = undefined;
  slot.isDefaulter = false;

  group.occupiedCount = group.slots.filter(s => s.status === 'active').length;
  group.availableCount = group.size - group.occupiedCount;
  group.status = 'active';

  // 3. Post system notice in Chama group chat
  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: 'Moderator / System',
    kind: 'system',
    text: `🚨 MEMBER REMOVED: Moderator removed ${removedUserName} (Slot #${slot.slotNumber}) for non-participation in mandatory daily payments. KSh ${paidAmount.toLocaleString()} has been refunded directly to their Buyoll wallet. Slot #${slot.slotNumber} is now vacant and open for a new member!`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'MEMBER_REMOVED',
    `Moderator removed ${removedUserName} from Chama #${group.id} Slot #${slot.slotNumber}. KSh ${paidAmount} refunded to member wallet.`
  );

  await saveDatabase(db);
  res.json({
    success: true,
    group,
    message: `Member ${removedUserName} removed. Slot #${slot.slotNumber} is now vacant for a new member. KSh ${paidAmount.toLocaleString()} was refunded to their wallet.`,
  });
});

// PART 5.3, 5.4, 5.5: DEFAULTING MEMBER RESOLUTION (REFUND / STORE CREDIT / ALTERNATE PURCHASE)
apiRouter.get('/defaults/my', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const myDefaults = db.defaultRecords.filter(d => d.userId === user.id);
  const myRefunds = db.refundRequests.filter(r => r.userId === user.id);

  res.json({ defaults: myDefaults, refunds: myRefunds });
});

apiRouter.post('/defaults/resolve', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { defaultRecordId, option, userPhone } = req.body; // option: 'refund' | 'store_credit' | 'alternate_purchase'
  const db = await getDatabase();

  const record = db.defaultRecords.find(d => d.id === Number(defaultRecordId));
  if (!record) return res.status(404).json({ error: 'Default record not found' });

  if (record.userId !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'You are not authorized to resolve this default record.' });
  }

  if (record.resolutionStatus === 'completed') {
    return res.status(400).json({ error: 'This defaulted slot obligation has already been resolved.' });
  }

  if (record.amountPaid <= 0) {
    record.resolutionStatus = 'completed';
    record.resolutionOption = option;
    await saveDatabase(db);
    return res.json({ message: 'No payments were recorded on this slot. Record closed.' });
  }

  if (option === 'refund') {
    // Option A: Submit a verified refund request
    const existingReq = db.refundRequests.find(r => r.defaultRecordId === record.id);
    if (existingReq) {
      return res.status(400).json({ error: 'A refund request is already pending for this record.', refundRequest: existingReq });
    }

    const refundRequest: RefundRequest = {
      id: db.nextIds.refundRequest++,
      userId: user.id,
      userName: user.name,
      userPhone: userPhone || user.phone,
      defaultRecordId: record.id,
      groupId: record.groupId,
      productTitle: record.productTitle,
      amountPaid: record.amountPaid,
      eligibleRefundAmount: record.amountPaid, // Full amount actually paid
      status: 'requested',
      requestedAt: Date.now(),
    };

    db.refundRequests.unshift(refundRequest);
    record.resolutionOption = 'refund';
    record.refundRequestId = refundRequest.id;

    logAudit(db, user.id, user.name, 'REFUND_REQUESTED', `Submitted refund request for KSh ${record.amountPaid} on Chama #${record.groupId}`);
    await saveDatabase(db);

    return res.json({
      message: `Refund request of KSh ${record.amountPaid} submitted successfully. Status: requested.`,
      refundRequest,
    });
  } else if (option === 'store_credit') {
    // Option B: Retain eligible value as store credit in persistent ledger
    user.credit = (user.credit || 0) + record.amountPaid;

    const ledgerEntry = {
      id: db.nextIds.ledger++,
      userId: user.id,
      amount: record.amountPaid,
      balanceAfter: user.credit,
      type: 'default_conversion' as const,
      referenceId: `DEF_${record.id}`,
      note: `Converted defaulted Chama #${record.groupId} payment to store credit`,
      createdAt: Date.now(),
    };

    db.storeCreditLedger.unshift(ledgerEntry);
    record.resolutionOption = 'store_credit';
    record.resolutionStatus = 'completed';

    logAudit(db, user.id, user.name, 'STORE_CREDIT_ISSUED', `Converted KSh ${record.amountPaid} into store credit. New balance: KSh ${user.credit}`);
    await saveDatabase(db);

    return res.json({
      message: `KSh ${record.amountPaid.toLocaleString()} successfully credited to your Alibaird store credit balance!`,
      creditBalance: user.credit,
    });
  } else if (option === 'alternate_purchase') {
    // Option C: Transfer towards another purchase / group
    user.credit = (user.credit || 0) + record.amountPaid;
    const ledgerEntry = {
      id: db.nextIds.ledger++,
      userId: user.id,
      amount: record.amountPaid,
      balanceAfter: user.credit,
      type: 'default_conversion' as const,
      referenceId: `DEF_ALT_${record.id}`,
      note: `Applied to wallet balance for alternate purchase from Chama #${record.groupId}`,
      createdAt: Date.now(),
    };
    db.storeCreditLedger.unshift(ledgerEntry);
    record.resolutionOption = 'alternate_purchase';
    record.resolutionStatus = 'completed';

    logAudit(db, user.id, user.name, 'ALTERNATE_PURCHASE_APPLIED', `Applied KSh ${record.amountPaid} for alternate purchase. New credit: KSh ${user.credit}`);
    await saveDatabase(db);

    return res.json({
      message: `KSh ${record.amountPaid.toLocaleString()} is now ready in your store balance to apply toward any product or Chama group!`,
      creditBalance: user.credit,
    });
  }

  res.status(400).json({ error: 'Invalid resolution option selected.' });
});

// -------------------------------------------------------------
// PAYMENTS & M-PESA TILL RECONCILIATION
// -------------------------------------------------------------
apiRouter.post('/payments', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { type, code, amount, groupId, slotNumber, productId } = req.body;
  const trimmedCode = String(code || '').trim().toUpperCase();
  const numAmount = Number(amount);

  if (!trimmedCode) return res.status(400).json({ error: 'M-Pesa transaction code is required' });
  if (numAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

  const db = await getDatabase();

  // Prevent duplicate code reuse
  if (db.payments.some(p => p.code === trimmedCode)) {
    return res.status(400).json({ error: 'This M-Pesa transaction code has already been posted.' });
  }

  let groupName: string | undefined;
  if (groupId) {
    const grp = db.groups.find(g => g.id === Number(groupId));
    if (grp) groupName = grp.name;
  }

  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: type || 'group_installment',
    userId: user.id,
    userName: user.name,
    code: trimmedCode,
    amount: numAmount,
    groupId: groupId ? Number(groupId) : undefined,
    groupName,
    slotNumber: slotNumber ? Number(slotNumber) : undefined,
    productId: productId ? Number(productId) : undefined,
    status: 'pending',
    createdAt: Date.now(),
  };

  db.payments.unshift(paymentRecord);
  logAudit(db, user.id, user.name, 'PAYMENT_POSTED', `Posted M-Pesa code ${trimmedCode} for KSh ${numAmount} (${paymentRecord.type})`);
  await saveDatabase(db);

  res.status(201).json({
    payment: paymentRecord,
    message: `Payment code ${trimmedCode} submitted. Awaiting admin verification on the ChaMall Till 000000.`,
  });
});

apiRouter.get('/payments/my', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const myPayments = db.payments.filter(p => p.userId === user.id);
  const myLedger = db.storeCreditLedger.filter(l => l.userId === user.id);

  res.json({
    payments: myPayments,
    ledger: myLedger,
    credit: user.credit,
    coins: user.coins,
    points: user.points,
  });
});

// Explicit backend enforcement: Wallet balances are strictly non-withdrawable
apiRouter.post('/wallet/withdraw', async (_req: Request, res: Response) => {
  return res.status(403).json({
    error: 'Cash withdrawals are prohibited under Buyoll platform rules. All store credits, loan proceeds, and points redemptions are non-withdrawable and may only be utilized for verified marketplace purchases and Chama contributions.',
  });
});

// Group chat message & applause tip
apiRouter.post('/groups/:id/chat', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { text, kind, targetUserId, coinAmount } = req.body;
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));

  if (!group) return res.status(404).json({ error: 'Group not found' });

  if (kind === 'reward') {
    const coins = Number(coinAmount) || 5;
    if ((user.coins || 0) < coins) {
      return res.status(400).json({ error: `Not enough coins in wallet. You have ${user.coins} coins.` });
    }
    const recipient = db.users.find(u => u.id === Number(targetUserId));
    if (!recipient) return res.status(404).json({ error: 'Recipient member not found' });

    user.coins -= coins;
    recipient.coins = (recipient.coins || 0) + coins;

    group.chat.push({
      id: `chat_${Date.now()}`,
      senderId: user.id,
      senderName: user.name,
      kind: 'reward',
      text: `Applauded and sent ${coins} coin${coins > 1 ? 's' : ''} to ${recipient.name}! 🌟`,
      timestamp: Date.now(),
    });

    await saveDatabase(db);
    return res.json({ group, message: `Sent ${coins} coins to ${recipient.name}!` });
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: kind || 'normal',
    text: text.trim().slice(0, 500),
    timestamp: Date.now(),
  });

  await saveDatabase(db);
  res.json({ group });
});

// -------------------------------------------------------------
// PEER-TO-PEER LOAN MODEL (3% PLATFORM COMMISSION, 1 LENDER PER GROUP)
// Repayment and loan terms handled manually outside the platform
// Member wallet funds are deposit-only, non-withdrawable
// -------------------------------------------------------------
apiRouter.get('/groups/:id/loans', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const groupId = Number(req.params.id);
  const loans = (db.peerLoans || []).filter(l => l.groupId === groupId);
  res.json({ loans });
});

apiRouter.post('/groups/:id/loans/request', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Find member's active slot in this group
  const slot = group.slots.find(s => s.userId === user.id && s.status === 'active');
  if (!slot) {
    return res.status(400).json({ error: 'You must have an active slot in this Chama to request a peer loan.' });
  }

  const { amount, purpose, repaymentPeriod, repaymentDays } = req.body;
  const numAmount = Number(amount);
  if (numAmount <= 0) {
    return res.status(400).json({ error: 'Loan amount must be greater than zero.' });
  }

  const remainingOwed = Math.max(0, (slot.targetAmount || group.productPrice) - (slot.paidAmount || 0));
  if (numAmount > remainingOwed && remainingOwed > 0) {
    return res.status(400).json({
      error: `Requested loan (KSh ${numAmount.toLocaleString()}) exceeds your remaining slot obligation of KSh ${remainingOwed.toLocaleString()}.`,
    });
  }

  // Rectified 3% platform commission
  const platformFee = Math.max(1, Math.round(numAmount * 0.03));
  const periodText = (repaymentPeriod || 'Within 7 Days').trim();
  const periodDays = Number(repaymentDays) || 7;

  const newLoan: PeerLoanRequest = {
    id: db.nextIds.peerLoan++,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    requesterId: user.id,
    requesterName: user.name,
    requesterPhone: user.phone,
    productTitle: group.productTitle,
    productImage: group.productImage,
    amount: numAmount,
    approvedAmount: numAmount,
    purpose: purpose?.trim() || `To pay for an arrears (clear missed Chama days)`,
    repaymentPeriod: periodText,
    repaymentDays: periodDays,
    status: 'open',
    createdAt: Date.now(),
    platformFeePercent: 3,
    platformFeeAmount: platformFee,
    platformFeeStatus: 'pending',
    externalAgreementAcknowledged: true,
  };

  db.peerLoans = db.peerLoans || [];
  db.peerLoans.unshift(newLoan);

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'system',
    text: `📢 PEER LOAN REQUEST: ${user.name} (Member #${slot.slotNumber}) requested KSh ${numAmount.toLocaleString()} from Lenders. Reason: "${newLoan.purpose}" · Repayment Period: ${periodText}. 3rd-party lenders: review request to fund member wallet. 3% platform commission (KSh ${platformFee}) applies.`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'PEER_LOAN_REQUESTED',
    `Requested P2P loan of KSh ${numAmount} (${periodText}) for Chama #${group.id} Slot #${slot.slotNumber}. Reason: "${newLoan.purpose}". 3% commission: KSh ${platformFee}`
  );

  await saveDatabase(db);
  res.status(201).json({
    loan: newLoan,
    message: 'Your peer loan request has been posted to the Chama group and Lenders Desk.',
  });
});

// LENDER SUBMITS 3% PLATFORM COMMISSION DEPOSIT CODE
apiRouter.post('/groups/:id/loans/:loanId/submit-fee', async (req: Request, res: Response) => {
  const lender = await getAuthenticatedUser(req);
  if (!lender) return res.status(401).json({ error: 'Authentication required' });

  const { approvedAmount, paymentCode } = req.body;
  const numApproved = Number(approvedAmount);
  const trimmedCode = String(paymentCode || '').trim().toUpperCase();

  if (numApproved <= 0) return res.status(400).json({ error: 'Please enter a valid approved loan amount' });
  if (!trimmedCode) return res.status(400).json({ error: 'M-Pesa payment code for the 3% commission is required' });

  const db = await getDatabase();
  const loan = (db.peerLoans || []).find(l => l.id === Number(req.params.loanId));
  if (!loan) return res.status(404).json({ error: 'Loan request not found' });

  const platformFee = Math.max(1, Math.round(numApproved * 0.03));

  loan.approvedAmount = numApproved;
  loan.platformFeeAmount = platformFee;
  loan.platformFeePaymentCode = trimmedCode;
  loan.platformFeeStatus = 'submitted';
  loan.status = 'fee_pending';
  loan.fundedByUserId = lender.id;
  loan.fundedByUserName = lender.name;

  // Record pending payment for admin verification
  db.payments.unshift({
    id: db.nextIds.payment++,
    type: 'loan_fee',
    userId: lender.id,
    userName: lender.name,
    code: trimmedCode,
    amount: platformFee,
    loanId: loan.id,
    groupId: loan.groupId,
    status: 'pending',
    createdAt: Date.now(),
  });

  logAudit(db, lender.id, lender.name, 'LOAN_COMMISSION_SUBMITTED', `Lender submitted 3% commission (KSh ${platformFee}, Code: ${trimmedCode}) for loan #${loan.id}`);
  await saveDatabase(db);

  res.json({
    loan,
    message: `3% platform commission of KSh ${platformFee.toLocaleString()} (Code: ${trimmedCode}) submitted. Awaiting Admin verification before funds release into member wallet.`,
  });
});

// ADMIN APPROVES 3% LOAN COMMISSION FEE
apiRouter.post('/admin/loan-fees/:loanId/approve', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db, user } = auth;
  const loan = (db.peerLoans || []).find(l => l.id === Number(req.params.loanId));
  if (!loan) return res.status(404).json({ error: 'Loan request not found' });

  loan.platformFeeStatus = 'approved';
  loan.status = 'fee_verified';

  // Mark matching payment as approved
  const p = db.payments.find(pay => pay.loanId === loan.id || pay.code === loan.platformFeePaymentCode);
  if (p) {
    p.status = 'approved';
    p.approvedAt = Date.now();
  }

  logAudit(db, user.id, user.name, 'LOAN_COMMISSION_APPROVED', `Admin approved 3% platform commission for loan #${loan.id}. Lender can now disburse loan amount.`);
  await saveDatabase(db);

  res.json({ loan, message: `3% platform commission approved! Lender can now fund member wallet.` });
});

// LENDER FUNDS MEMBER WALLET (ONLY USABLE FOR SHOPPING / SLOTS, NON-WITHDRAWABLE)
// LENDER FUNDS MEMBER WALLET (ATOMIC TRANSACTION: 97% BORROWER, 3% ADMIN COMMISSION)
// Funds are strictly non-withdrawable; repayment is negotiated and settled externally
async function processLoanFunding(lender: User, loanId: number, groupId: number | undefined, res: Response) {
  const db = await getDatabase();
  const loan = (db.peerLoans || []).find(l => l.id === loanId);
  if (!loan) return res.status(404).json({ error: 'Loan request not found' });

  if (loan.status === 'funded') {
    return res.status(400).json({ error: 'This loan request has already been funded.' });
  }

  if (loan.requesterId === lender.id) {
    return res.status(400).json({ error: 'You cannot fund your own peer loan request.' });
  }

  const requester = db.users.find(u => u.id === loan.requesterId);
  if (!requester) return res.status(404).json({ error: 'Borrowing member account not found.' });

  const resolvedGroupId = groupId || loan.groupId;
  const group = db.groups.find(g => g.id === resolvedGroupId);

  const totalAmount = loan.approvedAmount || loan.amount;

  // Enforce lender balance check
  const currentLenderBalance = lender.credit || 0;
  if (currentLenderBalance < totalAmount) {
    return res.status(400).json({
      error: `Insufficient wallet balance. You have KSh ${currentLenderBalance.toLocaleString()} but need KSh ${totalAmount.toLocaleString()} to fund this loan. Please deposit funds into your wallet to proceed.`,
      requiredAmount: totalAmount,
      currentBalance: currentLenderBalance,
    });
  }

  // Atomic 3-way split: 3% platform commission to Admin, 97% net proceeds to Borrower
  const platformCommission = Math.round(totalAmount * 0.03);
  const borrowerNet = totalAmount - platformCommission;

  // 1. Debit lender wallet
  lender.credit = currentLenderBalance - totalAmount;

  // 2. Credit admin wallet with 3% platform commission
  const adminUser = db.users.find(u => u.role === 'admin') || db.users[0];
  adminUser.credit = (adminUser.credit || 0) + platformCommission;

  // 3. Credit borrower wallet with 97% net proceeds
  requester.credit = (requester.credit || 0) + borrowerNet;

  // Write 3 atomic ledger entries
  const now = Date.now();
  db.storeCreditLedger.unshift(
    {
      id: db.nextIds.ledger++,
      userId: lender.id,
      amount: -totalAmount,
      balanceAfter: lender.credit,
      type: 'admin_adjustment',
      referenceId: `LOAN_FUND_${loan.id}`,
      note: `Disbursed loan #${loan.id} to member ${requester.name} (Amount: KSh ${totalAmount.toLocaleString()}). External repayment terms apply.`,
      createdAt: now,
    },
    {
      id: db.nextIds.ledger++,
      userId: adminUser.id,
      amount: platformCommission,
      balanceAfter: adminUser.credit,
      type: 'admin_adjustment',
      referenceId: `LOAN_COMM_${loan.id}`,
      note: `3% platform commission on P2P loan #${loan.id} funded by lender ${lender.name} for borrower ${requester.name}`,
      createdAt: now,
    },
    {
      id: db.nextIds.ledger++,
      userId: requester.id,
      amount: borrowerNet,
      balanceAfter: requester.credit,
      type: 'admin_adjustment',
      referenceId: `LOAN_RECV_${loan.id}`,
      note: `Disbursed 97% of P2P loan #${loan.id} from lender ${lender.name} (KSh ${borrowerNet.toLocaleString()}). 3% platform fee deducted. Non-withdrawable; strictly for shopping & Chama contributions. Repayment terms settled externally.`,
      createdAt: now,
    }
  );

  loan.status = 'funded';
  loan.fundedByUserId = lender.id;
  loan.fundedByUserName = lender.name;
  loan.fundedAt = now;
  loan.platformFeeStatus = 'paid';

  // Group single-lender attachment and notification
  if (group) {
    if (!group.lenderId) {
      group.lenderId = lender.id;
      group.lenderName = lender.name;
    }

    if (!group.notifications) group.notifications = [];
    group.notifications.unshift({
      id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
      groupId: group.id,
      groupName: group.name,
      title: 'Loan Funded Successfully',
      message: `Lender ${lender.name} funded ${requester.name}'s loan request of KSh ${totalAmount.toLocaleString()}! KSh ${borrowerNet.toLocaleString()} (97%) credited to wallet.`,
      type: 'system',
      timestamp: now,
    });

    group.chat.push({
      id: `chat_${now}`,
      senderId: lender.id,
      senderName: lender.name,
      kind: 'system',
      text: `✅ LOAN FUNDED ATOMICALLY: Lender ${lender.name} funded KSh ${totalAmount.toLocaleString()}. KSh ${borrowerNet.toLocaleString()} (97%) credited to ${requester.name}’s wallet for Chama installments. 3% platform fee (KSh ${platformCommission.toLocaleString()}) settled. Repayment is external.`,
      timestamp: now,
    });
  }

  logAudit(
    db,
    lender.id,
    lender.name,
    'PEER_LOAN_FUNDED',
    `Atomic funding of loan #${loan.id}: Debited lender KSh ${totalAmount}, credited admin KSh ${platformCommission} (3%), credited borrower KSh ${borrowerNet} (97%)`
  );

  await saveDatabase(db);
  return res.json({
    loan,
    lenderBalance: lender.credit,
    borrowerNet,
    platformCommission,
    message: `Loan funded successfully! KSh ${borrowerNet.toLocaleString()} (97%) was credited into ${requester.name}’s wallet. KSh ${platformCommission.toLocaleString()} (3%) platform fee was paid.`,
  });
}

apiRouter.post('/groups/:id/loans/:loanId/fund', async (req: Request, res: Response) => {
  const lender = await getAuthenticatedUser(req);
  if (!lender) return res.status(401).json({ error: 'You must be signed in to fund this peer loan.' });
  return processLoanFunding(lender, Number(req.params.loanId), Number(req.params.id), res);
});

apiRouter.post('/loans/:id/fund', async (req: Request, res: Response) => {
  const lender = await getAuthenticatedUser(req);
  if (!lender) return res.status(401).json({ error: 'You must be signed in to fund this peer loan.' });
  return processLoanFunding(lender, Number(req.params.id), undefined, res);
});

// GLOBAL COMMUNITY HELP CHAT & COMPLAINTS BOARD ROUTES
apiRouter.get('/help-chat', async (_req: Request, res: Response) => {
  const db = await getDatabase();
  res.json({ messages: db.helpChat || [] });
});

apiRouter.post('/help-chat', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  const { text, category, guestName } = req.body;
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Message text is required' });
  }

  const db = await getDatabase();
  if (!db.helpChat) db.helpChat = [];

  const msgName = user ? user.name : (guestName || 'Shopper').trim();
  const newMsg: HelpChatMessage = {
    id: `help_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    userId: user?.id,
    userName: msgName,
    userRole: user?.role || 'buyer',
    category: category || 'inquiry',
    text: String(text).trim().slice(0, 500),
    timestamp: Date.now(),
  };

  db.helpChat.unshift(newMsg);
  if (db.helpChat.length > 200) db.helpChat = db.helpChat.slice(0, 200);

  logAudit(db, user?.id || 0, msgName, 'HELP_MESSAGE_POSTED', `Posted to Community Help board: "${newMsg.text.slice(0, 60)}"`);
  await saveDatabase(db);

  res.status(201).json({ message: newMsg, allMessages: db.helpChat });
});

apiRouter.post('/help-chat/:id/reply', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can reply to help inquiries' });
  }

  const { reply } = req.body;
  if (!reply || !String(reply).trim()) {
    return res.status(400).json({ error: 'Reply text is required' });
  }

  const db = await getDatabase();
  const msg = (db.helpChat || []).find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  msg.adminReply = String(reply).trim();
  await saveDatabase(db);

  res.json({ message: msg, allMessages: db.helpChat });
});

// GET ALL LOAN ALERTS ACROSS ALL GROUPS (LENDERS DASHBOARD)
apiRouter.get('/lenders/alerts', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const alerts = (db.peerLoans || []).map(loan => {
    const group = db.groups.find(g => g.id === loan.groupId);
    const product = group ? db.products.find(p => p.id === group.productId) : null;
    return {
      ...loan,
      productTitle: group?.productTitle || product?.title || 'Chama Product',
      productImage: group?.productImage || product?.images?.[0] || './images/cookware_set.jpg',
      groupLenderId: group?.lenderId || null,
      groupLenderName: group?.lenderName || null,
      groupSize: group?.size || 0,
      dailyAmount: group?.dailyAmount || 0,
    };
  });
  res.json({ alerts });
});

// CLAIM EXCLUSIVE LENDER SEAT IN A GROUP (1 LENDER PER GROUP LIMIT: 1ST COME 1ST SERVED)
apiRouter.post('/groups/:id/claim-lender', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Check if group is already claimed by another lender
  if (group.lenderId && group.lenderId !== user.id) {
    return res.status(400).json({
      error: `This Chama group is already served by dedicated lender ${group.lenderName || 'Assigned Lender'}. A group only accepts 1 lender at a time (first-come, first-served).`,
    });
  }

  // Claim lender seat
  group.lenderId = user.id;
  group.lenderName = user.name;
  group.lenderJoinedAt = Date.now();

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'system',
    text: `🤝 3rd-Party Lender ${user.name} has officially entered this Chama group as the dedicated lender (1 lender per group limit).`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'LENDER_JOINED_GROUP',
    `Lender ${user.name} claimed dedicated lender seat for Chama #${group.id}`
  );

  await saveDatabase(db);
  res.json({
    success: true,
    group,
    message: `You have entered Chama #${group.id} as the dedicated 3rd-party lender!`,
  });
});

// Member uses wallet funds (from P2P loan or credit balance) to pay Chama slot
apiRouter.post('/groups/:id/pay-from-wallet', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const { slotNumber, amount } = req.body;
  const numAmount = Number(amount);

  if (numAmount <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  }

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber) && s.userId === user.id && s.status === 'active');
  if (!slot) {
    return res.status(400).json({ error: 'Active slot not found for your account in this group.' });
  }

  if ((user.credit || 0) < numAmount) {
    return res.status(400).json({
      error: `Insufficient wallet balance. You have KSh ${(user.credit || 0).toLocaleString()}, but attempted to pay KSh ${numAmount.toLocaleString()}.`,
    });
  }

  // Deduct from wallet
  user.credit -= numAmount;

  // Credit slot
  slot.paidAmount = (slot.paidAmount || 0) + numAmount;
  slot.lastPaymentDate = Date.now();

  // Create approved payment record
  const paymentCode = `WAL_${generateCode(6)}`;
  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: 'group_installment',
    userId: user.id,
    userName: user.name,
    code: paymentCode,
    amount: numAmount,
    groupId: group.id,
    groupName: group.name,
    slotNumber: slot.slotNumber,
    productId: group.productId,
    status: 'approved',
    createdAt: Date.now(),
    approvedAt: Date.now(),
  };
  db.payments.unshift(paymentRecord);

  // Add ledger statement entry
  const ledgerEntry = {
    id: db.nextIds.ledger++,
    userId: user.id,
    amount: -numAmount,
    balanceAfter: user.credit,
    type: 'purchase_deduction' as const,
    referenceId: paymentCode,
    note: `Chama Slot #${slot.slotNumber} installment for "${group.productTitle}" paid from wallet balance`,
    createdAt: Date.now(),
  };
  db.storeCreditLedger.unshift(ledgerEntry);

  // Reward points
  user.points = (user.points || 0) + Math.floor(numAmount / 10);

  // Post chat notification
  const progressPercent = Math.min(100, Math.round(((slot.paidAmount || 0) / group.productPrice) * 100));

  // Update group round tracking
  group.currentRoundPaid = (group.currentRoundPaid || 0) + numAmount;
  const targetAmt = group.targetAmountPerRound || group.productPrice;
  group.roundBalanceRemaining = Math.max(0, targetAmt - group.currentRoundPaid);
  if (group.currentRoundPaid >= targetAmt) {
    group.isReadyForPickup = true;
    group.chat.push({
      id: `chat_${Date.now()}_pickup`,
      senderId: 1,
      senderName: 'System Verification',
      kind: 'system',
      text: `✅ 100% PAID! Full target amount of KSh ${targetAmt.toLocaleString()} reached! Item is READY FOR PICKUP for Member #${group.currentRecipientSlot || 1}!`,
      timestamp: Date.now(),
    });
  }

  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'normal',
    text: `💳 Paid KSh ${numAmount.toLocaleString()} for Slot #${slot.slotNumber} using Buyoll wallet! Payment progress is now ${progressPercent}%. (Round total: KSh ${(group.currentRoundPaid || 0).toLocaleString()} / KSh ${targetAmt.toLocaleString()})`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'WALLET_SLOT_PAYMENT',
    `Paid KSh ${numAmount} for Chama #${group.id} Slot #${slot.slotNumber} via wallet balance. Reference: ${paymentCode}`
  );

  await saveDatabase(db);
  res.json({
    group,
    walletBalance: user.credit,
    paidAmount: slot.paidAmount,
    progressPercent,
    message: `Payment of KSh ${numAmount.toLocaleString()} successfully applied from your wallet! Dynamic progress updated to ${progressPercent}%.`,
  });
});

// Member full financial statement & ledger
apiRouter.get('/ledger/statement/:userId', async (req: Request, res: Response) => {
  const targetUserId = Number(req.params.userId);
  const db = await getDatabase();
  const targetUser = db.users.find(u => u.id === targetUserId);

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Find all active slots across all groups
  const activeSlots: any[] = [];
  let totalPaid = 0;

  for (const grp of db.groups) {
    for (const slot of grp.slots) {
      if (slot.userId === targetUserId && slot.status === 'active') {
        const slotPaid = slot.paidAmount || 0;
        totalPaid += slotPaid;
        const progressPercent = Math.min(100, Math.round((slotPaid / (slot.targetAmount || grp.productPrice || 1)) * 100));
        activeSlots.push({
          groupId: grp.id,
          groupName: grp.name,
          productTitle: grp.productTitle,
          slotNumber: slot.slotNumber,
          dailyAmount: grp.dailyAmount,
          targetAmount: slot.targetAmount || grp.productPrice,
          paidAmount: slotPaid,
          progressPercent,
          cycleDays: grp.cycleDays,
          deliveryDay: slot.slotNumber * grp.cycleDays,
          status: slot.status,
        });
      }
    }
  }

  // Build combined statement transactions
  const transactions: any[] = [];

  // 1. Payments made
  const userPayments = db.payments.filter(p => p.userId === targetUserId);
  for (const p of userPayments) {
    transactions.push({
      id: p.id,
      date: p.createdAt,
      reference: p.code,
      type: p.type === 'group_installment' ? 'Chama Installment' : p.type,
      description: p.groupName ? `${p.groupName} (Slot #${p.slotNumber || 1})` : 'Buyoll Payment',
      credit: p.amount,
      status: p.status,
    });
  }

  // 2. Ledger entries
  const userLedger = db.storeCreditLedger.filter(l => l.userId === targetUserId);
  for (const l of userLedger) {
    transactions.push({
      id: l.id + 100000,
      date: l.createdAt,
      reference: l.referenceId || `LED-${l.id}`,
      type: 'Wallet / Credit Ledger',
      description: l.note,
      debit: l.amount < 0 ? Math.abs(l.amount) : undefined,
      credit: l.amount > 0 ? l.amount : undefined,
      status: 'approved',
    });
  }

  // Sort by date descending
  transactions.sort((a, b) => b.date - a.date);

  const statement: MemberStatement = {
    user: targetUser,
    totalPaid,
    currentCredit: targetUser.credit || 0,
    activeSlots,
    transactions,
  };

  res.json({ statement });
});

// -------------------------------------------------------------
// WALLET ACTIONS: REDEEM POINTS & BUY COINS
// -------------------------------------------------------------
apiRouter.post('/wallet/redeem-points', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  if ((user.points || 0) < 100) {
    return res.status(400).json({ error: 'You need at least 100 points to redeem (100 pts = KSh 10).' });
  }

  const db = await getDatabase();
  const blocks = Math.floor(user.points / 100);
  const pointsDeducted = blocks * 100;
  const creditEarned = blocks * 10;

  user.points -= pointsDeducted;
  user.credit = (user.credit || 0) + creditEarned;

  const ledgerEntry = {
    id: db.nextIds.ledger++,
    userId: user.id,
    amount: creditEarned,
    balanceAfter: user.credit,
    type: 'point_redemption' as const,
    note: `Redeemed ${pointsDeducted} reward points for KSh ${creditEarned} store credit`,
    createdAt: Date.now(),
  };

  db.storeCreditLedger.unshift(ledgerEntry);
  logAudit(db, user.id, user.name, 'POINTS_REDEEMED', `Redeemed ${pointsDeducted} pts for KSh ${creditEarned} store credit.`);
  await saveDatabase(db);

  res.json({
    credit: user.credit,
    points: user.points,
    message: `Successfully redeemed ${pointsDeducted} points for KSh ${creditEarned} store credit!`,
  });
});

// -------------------------------------------------------------
// ADMIN PANEL ENDPOINTS
// -------------------------------------------------------------
apiRouter.get('/admin/overview', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  res.json({
    pendingPayments: (db.payments || []).filter(p => p.status === 'pending'),
    allPayments: db.payments || [],
    refundRequests: db.refundRequests || [],
    merchants: (db.users || []).filter(u => u.role === 'merchant'),
    allUsers: db.users || [],
    auditLogs: (db.auditLogs || []).slice(0, 50),
    groups: db.groups || [],
    products: db.products || [],
  });
});

apiRouter.get('/admin/payments', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  const paymentsWithMatching = db.payments.map(p => {
    const matched = (db.mpesaStatements || []).find(
      s => s.code.toUpperCase() === p.code.toUpperCase()
    );
    const hasCodeMismatch = !matched;
    const hasAmountMismatch = matched ? Math.abs(matched.amount - p.amount) > 5 : false;
    const isDuplicate = db.payments.filter(other => other.code === p.code).length > 1;

    let verificationFlag: 'perfect_match' | 'amount_mismatch' | 'unmatched_code' | 'duplicate_detected' = 'perfect_match';
    if (isDuplicate) verificationFlag = 'duplicate_detected';
    else if (hasCodeMismatch) verificationFlag = 'unmatched_code';
    else if (hasAmountMismatch) verificationFlag = 'amount_mismatch';

    return {
      ...p,
      matchedTillEntry: matched || null,
      verificationFlag,
    };
  });

  res.json({
    payments: paymentsWithMatching,
    statements: db.mpesaStatements || [],
  });
});

apiRouter.post('/admin/payments/:id/decision', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { decision, reason } = req.body; // 'approve' | 'reject'
  const payment = db.payments.find(p => p.id === Number(req.params.id));

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status !== 'pending') {
    return res.status(400).json({ error: 'This payment has already been processed' });
  }

  const now = Date.now();

  if (decision === 'approve') {
    payment.status = 'approved';
    payment.approvedAt = now;

    // 1. If it's a group installment payment, credit slot and mark days as Paid (✓)
    if (payment.type === 'group_installment' && payment.groupId && payment.slotNumber) {
      const grp = db.groups.find(g => g.id === payment.groupId);
      if (grp) {
        const slot = grp.slots.find(s => s.slotNumber === payment.slotNumber);
        if (slot) {
          slot.paidAmount = (slot.paidAmount || 0) + payment.amount;
          slot.lastPaymentDate = now;

          slot.paidDays = slot.paidDays || [];
          slot.pendingDays = slot.pendingDays || [];
          slot.dailyPaymentRecords = slot.dailyPaymentRecords || [];

          const daysApproved = payment.daysPaid && payment.daysPaid.length > 0 ? payment.daysPaid : [1];
          for (const d of daysApproved) {
            slot.pendingDays = slot.pendingDays.filter(pd => pd !== d);
            if (!slot.paidDays.includes(d)) {
              slot.paidDays.push(d);
            }
          }

          // Mark daily payment records as approved
          for (const rec of slot.dailyPaymentRecords) {
            if (rec.code === payment.code) {
              rec.status = 'approved';
            }
          }

          // Update group round tracking
          grp.currentRoundPaid = (grp.currentRoundPaid || 0) + payment.amount;
          const targetAmt = grp.targetAmountPerRound || grp.productPrice;
          grp.roundBalanceRemaining = Math.max(0, targetAmt - grp.currentRoundPaid);

          if (grp.currentRoundPaid >= targetAmt) {
            grp.isReadyForPickup = true;
            grp.chat.push({
              id: `chat_${now}_pickup`,
              senderId: 1,
              senderName: 'System Verification',
              kind: 'system',
              text: `✅ 100% PAID! Full target amount of KSh ${targetAmt.toLocaleString()} has been reached! Item is now verified & READY FOR PICKUP for Member #${grp.currentRecipientSlot || 1}!`,
              timestamp: now,
            });
          }

          // Award platform points automatically to good payer (1 point for every 10 KSh)
          const payer = db.users.find(u => u.id === payment.userId);
          if (payer) {
            const pointsEarned = Math.max(1, Math.floor(payment.amount / 10));
            payer.points = (payer.points || 0) + pointsEarned;
            payer.lastActive = now;
          }

          // Group broadcast notification
          if (!grp.notifications) grp.notifications = [];
          grp.notifications.unshift({
            id: `notif_${now}_appr`,
            groupId: grp.id,
            groupName: grp.name,
            title: 'Contribution Verified (✓)',
            message: `Admin verified KSh ${payment.amount.toLocaleString()} for ${daysApproved.map(d => `Day ${d}`).join(', ')} from ${payment.userName}. Green tick recorded!`,
            type: 'payment_approved',
            timestamp: now,
          });
        }
      }
    } else if (payment.type === 'merchant_subscription') {
      const merchant = db.users.find(u => u.id === payment.userId);
      if (merchant) {
        merchant.merchantSubscriptionStatus = 'active';
        merchant.verified = true;
        merchant.verifiedAt = now;
        merchant.starRating = 5;
        logAudit(db, user.id, user.name, 'MERCHANT_SUBSCRIPTION_ACTIVATED', `Activated merchant subscription for ${merchant.name}`);
      }
    } else if (payment.type === 'loan_fee') {
      const loan = (db.peerLoans || []).find(l => l.id === payment.loanId || l.platformFeePaymentCode === payment.code);
      if (loan) {
        loan.platformFeeStatus = 'approved';
        loan.status = 'fee_verified';
      }
    } else if (payment.type === 'coin_purchase') {
      const payer = db.users.find(u => u.id === payment.userId);
      if (payer) {
        const coinsToAdd = payment.amount * 2; // 2 coins per KSh 1
        payer.coins = (payer.coins || 0) + coinsToAdd;
        if (!db.coinLedger) db.coinLedger = [];
        db.coinLedger.unshift({
          id: `coin_${now}_${Math.random().toString(36).substring(2, 6)}`,
          type: 'deposit',
          senderId: 1,
          senderName: 'M-Pesa Deposit Till',
          recipientId: payer.id,
          recipientName: payer.name,
          amount: coinsToAdd,
          reason: `Deposited coins via M-Pesa Till (Code: ${payment.code})`,
          timestamp: now,
        });
      }
    }

    logAudit(db, user.id, user.name, 'PAYMENT_APPROVED', `Approved payment ${payment.code} for KSh ${payment.amount}`);
  } else {
    payment.status = 'rejected';
    payment.rejectionReason = (reason || 'Statement mismatch or unverified transaction code').trim();

    // If it's a group installment, revert pending days
    if (payment.type === 'group_installment' && payment.groupId && payment.slotNumber) {
      const grp = db.groups.find(g => g.id === payment.groupId);
      if (grp) {
        const slot = grp.slots.find(s => s.slotNumber === payment.slotNumber);
        if (slot) {
          const daysToRevert = payment.daysPaid && payment.daysPaid.length > 0 ? payment.daysPaid : [1];
          slot.pendingDays = (slot.pendingDays || []).filter(pd => !daysToRevert.includes(pd));
          for (const rec of slot.dailyPaymentRecords || []) {
            if (rec.code === payment.code) {
              rec.status = 'rejected';
            }
          }
        }
      }
    } else if (payment.type === 'merchant_subscription') {
      const merchant = db.users.find(u => u.id === payment.userId);
      if (merchant) {
        merchant.merchantSubscriptionStatus = 'inactive';
      }
    }

    logAudit(db, user.id, user.name, 'PAYMENT_REJECTED', `Rejected payment ${payment.code}: ${payment.rejectionReason}`);
  }

  await saveDatabase(db);
  res.json({ payment, message: `Payment ${payment.code} was ${decision}d.` });
});

apiRouter.post('/admin/refunds/:id/status', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { status, adminNote } = req.body;
  const refund = db.refundRequests.find(r => r.id === Number(req.params.id));

  if (!refund) return res.status(404).json({ error: 'Refund request not found' });

  refund.status = status;
  if (adminNote) refund.adminNote = adminNote;
  if (status === 'completed') {
    refund.processedAt = Date.now();
    const def = db.defaultRecords.find(d => d.id === refund.defaultRecordId);
    if (def) def.resolutionStatus = 'completed';
  }

  logAudit(db, user.id, user.name, 'REFUND_STATUS_UPDATED', `Updated refund #${refund.id} status to ${status}`);
  await saveDatabase(db);

  res.json({ refund, message: `Refund #${refund.id} status updated to ${status}.` });
});

// -------------------------------------------------------------
// ADMIN USER MANAGEMENT & BADGING
// -------------------------------------------------------------
apiRouter.get('/admin/users', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;
  res.json({ users: db.users });
});

apiRouter.post('/admin/merchants/:id/verify', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { verified, notes } = req.body;
  const merchant = db.users.find(u => u.id === Number(req.params.id) && u.role === 'merchant');

  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  merchant.verified = Boolean(verified);
  merchant.starRating = verified ? 5 : undefined;
  if (verified) {
    merchant.verifiedAt = Date.now();
    merchant.merchantSubscriptionStatus = 'active';
  }
  if (notes) merchant.verificationNotes = String(notes).trim();

  logAudit(db, user.id, user.name, 'MERCHANT_VERIFIED', `${verified ? 'Verified (Buyoll Verified badge awarded)' : 'Revoked verification for'} merchant ${merchant.shopName || merchant.name}`);
  await saveDatabase(db);

  res.json({
    merchant,
    message: verified ? 'Merchant verified with 5 stars & Buyoll Verified badge.' : 'Merchant verification revoked.',
  });
});

apiRouter.post('/admin/users/:id/verify', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { verified, notes } = req.body;
  const target = db.users.find(u => u.id === Number(req.params.id));

  if (!target) return res.status(404).json({ error: 'User not found' });

  target.verified = Boolean(verified);
  if (verified) {
    target.verifiedAt = Date.now();
    if (target.role === 'merchant') {
      target.starRating = 5;
      target.merchantSubscriptionStatus = 'active';
    }
  }
  if (notes) target.verificationNotes = String(notes).trim();

  logAudit(db, user.id, user.name, 'USER_VERIFIED', `${verified ? 'Verified' : 'Unverified'} user #${target.id} (${target.name})`);
  await saveDatabase(db);

  res.json({ user: target, message: `User verification updated to ${verified}.` });
});

apiRouter.post('/admin/users/:id/suspend', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { isSuspended, reason } = req.body;
  const target = db.users.find(u => u.id === Number(req.params.id));

  if (!target) return res.status(404).json({ error: 'User not found' });

  target.isSuspended = Boolean(isSuspended);
  target.suspendReason = isSuspended ? (reason || 'Violation of platform terms').trim() : undefined;

  logAudit(db, user.id, user.name, 'USER_SUSPENDED', `${isSuspended ? 'Suspended' : 'Reinstated'} user #${target.id} (${target.name})`);
  await saveDatabase(db);

  res.json({ user: target, message: `User has been ${isSuspended ? 'suspended' : 'reinstated'}.` });
});

apiRouter.post('/admin/users/:id/award-points', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { points, reason } = req.body;
  const numPoints = Number(points);
  if (!numPoints) return res.status(400).json({ error: 'Valid points amount required' });

  const target = db.users.find(u => u.id === Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'User not found' });

  target.points = (target.points || 0) + numPoints;
  logAudit(db, user.id, user.name, 'POINTS_AWARDED', `Awarded ${numPoints} points to ${target.name}. Reason: ${reason || 'Good platform standing'}`);
  await saveDatabase(db);

  res.json({ user: target, message: `Awarded ${numPoints} points to ${target.name}. New total: ${target.points} pts.` });
});

// -------------------------------------------------------------
// ADMIN WALLETS OVERSIGHT & CSV EXPORT
// -------------------------------------------------------------
apiRouter.get('/admin/wallets', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  const totalCredit = db.users.reduce((acc, u) => acc + (u.credit || 0), 0);
  const totalCoins = db.users.reduce((acc, u) => acc + (u.coins || 0), 0);
  const totalPoints = db.users.reduce((acc, u) => acc + (u.points || 0), 0);

  res.json({
    summary: { totalCredit, totalCoins, totalPoints, userCount: db.users.length, totalUsers: db.users.length },
    wallets: db.users.map(u => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.role,
      credit: u.credit || 0,
      coins: u.coins || 0,
      points: u.points || 0,
      verified: u.verified,
      isSuspended: u.isSuspended,
    })),
    recentLedger: db.storeCreditLedger.slice(0, 50),
    coinLedger: (db.coinLedger || []).slice(0, 50),
  });
});

apiRouter.get('/admin/wallets/export-csv', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  const headers = ['User ID', 'Name', 'Phone', 'Role', 'Credit Balance (KSh)', 'Coins', 'Points', 'Verified', 'Suspended'];
  const rows = db.users.map(u => [
    u.id,
    `"${(u.name || '').replace(/"/g, '""')}"`,
    `"${u.phone || ''}"`,
    u.role,
    u.credit || 0,
    u.coins || 0,
    u.points || 0,
    u.verified ? 'Yes' : 'No',
    u.isSuspended ? 'Yes' : 'No',
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="buyoll_wallets.csv"');
  res.send(csvContent);
});

// -------------------------------------------------------------
// ADMIN CHAT MODERATION
// -------------------------------------------------------------
apiRouter.get('/admin/chat-logs', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  const allGroupChats = db.groups.flatMap(g =>
    (g.chat || []).map(c => ({
      ...c,
      context: 'group',
      groupId: g.id,
      groupName: g.name,
    }))
  );

  const helpChats = (db.helpChat || []).map(h => ({
    ...h,
    context: 'help_chat',
    groupId: null,
    groupName: 'Community Help & FAQ',
  }));

  const allLogs = [...allGroupChats, ...helpChats].sort((a, b) => b.timestamp - a.timestamp);

  const recentChats = allGroupChats.slice(0, 100).map(c => ({
    groupId: c.groupId,
    groupName: c.groupName,
    messageId: c.id,
    senderId: c.senderId,
    senderName: c.senderName,
    text: c.text,
    timestamp: c.timestamp,
    isFlagged: (c as any).isFlagged || false,
  }));

  res.json({
    logs: allLogs.slice(0, 200),
    recentChats,
    moderationEvents: db.chatModerationLogs || [],
    moderationActions: db.chatModerationLogs || [],
  });
});

apiRouter.post('/admin/chat/moderate', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { action, targetUserId, groupId, messageId, reason } = req.body;
  const target = db.users.find(u => u.id === Number(targetUserId));

  if (!target) return res.status(404).json({ error: 'Target user not found' });

  const now = Date.now();
  if (action === 'mute') {
    target.isMuted = true;
  } else if (action === 'unmute') {
    target.isMuted = false;
  } else if (action === 'remove_user' && groupId) {
    const grp = db.groups.find(g => g.id === Number(groupId));
    if (grp) {
      const slot = grp.slots.find(s => s.userId === target.id);
      if (slot) {
        slot.status = 'replacement_eligible';
        slot.userId = null;
        slot.userName = null;
        slot.userPhone = null;
      }
    }
  }

  // Remove offending message if messageId provided
  if (messageId && groupId) {
    const grp = db.groups.find(g => g.id === Number(groupId));
    if (grp) {
      grp.chat = (grp.chat || []).filter(c => c.id !== messageId);
    }
  }

  if (!db.chatModerationLogs) db.chatModerationLogs = [];
  db.chatModerationLogs.unshift({
    id: `mod_${now}`,
    adminId: user.id,
    targetUserId: target.id,
    targetUserName: target.name,
    action,
    reason: (reason || 'Community guidelines violation').trim(),
    timestamp: now,
  });

  logAudit(db, user.id, user.name, 'CHAT_MODERATED', `Action: ${action} on ${target.name}. Reason: ${reason}`);
  await saveDatabase(db);

  res.json({
    success: true,
    message: `Moderation action "${action}" executed on ${target.name}.`,
    targetUser: target,
  });
});

// -------------------------------------------------------------
// PROMPT 7: COINS & PEER-TO-PEER REWARD SYSTEM
// -------------------------------------------------------------
apiRouter.post('/coins/award', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { recipientIds, amountPerRecipient, reason } = req.body;
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'Please select at least one member to reward.' });
  }

  const coinsPerPerson = Math.max(1, Number(amountPerRecipient) || 5);
  const totalCoinsNeeded = recipientIds.length * coinsPerPerson;

  // Enforce no self-awarding
  if (recipientIds.includes(user.id)) {
    return res.status(400).json({ error: 'You cannot award coins to yourself.' });
  }

  // Enforce non-negative balance and double-spend check
  const currentCoins = user.coins || 0;
  if (currentCoins < totalCoinsNeeded) {
    return res.status(400).json({
      error: `Insufficient coins balance. You have ${currentCoins} coins, but awarding ${coinsPerPerson} coins to ${recipientIds.length} member(s) requires ${totalCoinsNeeded} coins.`,
    });
  }

  const db = await getDatabase();
  const validRecipients = db.users.filter(u => recipientIds.includes(u.id));

  if (validRecipients.length === 0) {
    return res.status(400).json({ error: 'No valid recipient members found.' });
  }

  // Atomic debit
  user.coins = currentCoins - (validRecipients.length * coinsPerPerson);

  const now = Date.now();
  if (!db.coinLedger) db.coinLedger = [];

  // Atomic credits and ledger records
  for (const recipient of validRecipients) {
    recipient.coins = (recipient.coins || 0) + coinsPerPerson;
    db.coinLedger.unshift({
      id: `coin_${now}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'transfer',
      senderId: user.id,
      senderName: user.name,
      recipientId: recipient.id,
      recipientName: recipient.name,
      amount: coinsPerPerson,
      reason: (reason || 'Applauding prompt Chama commitment & great team spirit!').trim(),
      timestamp: now,
    });
  }

  logAudit(
    db,
    user.id,
    user.name,
    'COINS_AWARDED',
    `Awarded ${coinsPerPerson} coins to ${validRecipients.length} members (Total: ${validRecipients.length * coinsPerPerson})`
  );

  await saveDatabase(db);
  res.json({
    remainingCoins: user.coins,
    awardedCount: validRecipients.length,
    totalAwarded: validRecipients.length * coinsPerPerson,
    message: `Successfully awarded ${coinsPerPerson} coins each to ${validRecipients.length} member(s)! 🌟`,
  });
});

apiRouter.post('/coins/reward-platform', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { amount, message } = req.body;
  const coinsToSend = Math.max(1, Number(amount) || 10);

  const currentCoins = user.coins || 0;
  if (currentCoins < coinsToSend) {
    return res.status(400).json({
      error: `Insufficient coins. You have ${currentCoins} coins, but tried to send ${coinsToSend}.`,
    });
  }

  const db = await getDatabase();
  const adminUser = db.users.find(u => u.role === 'admin') || db.users[0];

  user.coins = currentCoins - coinsToSend;
  adminUser.coins = (adminUser.coins || 0) + coinsToSend;

  const now = Date.now();
  if (!db.coinLedger) db.coinLedger = [];
  db.coinLedger.unshift({
    id: `coin_${now}_${Math.random().toString(36).substring(2, 6)}`,
    type: 'reward_platform',
    senderId: user.id,
    senderName: user.name,
    recipientId: adminUser.id,
    recipientName: 'Buyoll Platform Escrow',
    amount: coinsToSend,
    reason: (message || 'Rewarding Buyoll community platform infrastructure').trim(),
    timestamp: now,
  });

  logAudit(db, user.id, user.name, 'PLATFORM_REWARDED', `Sent ${coinsToSend} coins to Buyoll Platform`);
  await saveDatabase(db);

  res.json({
    remainingCoins: user.coins,
    message: `Thank you! Sent ${coinsToSend} coins to the Buyoll platform community pool.`,
  });
});

apiRouter.post('/coins/deposit', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { packageId, amount, paymentCode } = req.body;
  const numAmount = Number(amount);
  const trimmedCode = String(paymentCode || '').trim().toUpperCase();

  if (!trimmedCode) {
    return res.status(400).json({ error: 'M-Pesa transaction code is required for coin purchase.' });
  }

  const codeRegex = /^[A-Z0-9]{8,12}$/i;
  if (!codeRegex.test(trimmedCode)) {
    return res.status(400).json({ error: 'Invalid M-Pesa code format. Must be 8-12 alphanumeric characters.' });
  }

  if (numAmount <= 0) {
    return res.status(400).json({ error: 'Invalid deposit amount' });
  }

  const db = await getDatabase();

  if (db.payments.some(p => p.code === trimmedCode)) {
    return res.status(400).json({ error: 'This transaction code has already been registered on the platform.' });
  }

  const matchedStatement = (db.mpesaStatements || []).find(
    s => s.code.toUpperCase() === trimmedCode && Math.abs(s.amount - numAmount) <= 5
  );

  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: 'coin_purchase',
    userId: user.id,
    userName: user.name,
    code: trimmedCode,
    amount: numAmount,
    status: 'pending',
    matchedTillEntry: matchedStatement,
    createdAt: Date.now(),
  };

  db.payments.unshift(paymentRecord);
  logAudit(db, user.id, user.name, 'COIN_DEPOSIT_SUBMITTED', `Submitted coin deposit of KSh ${numAmount} (Code: ${trimmedCode})`);
  await saveDatabase(db);

  res.status(201).json({
    payment: paymentRecord,
    message: `Coin purchase code ${trimmedCode} submitted! Once approved by admin, ${numAmount * 2} coins will be credited to your wallet.`,
  });
});

apiRouter.get('/coins/ledger', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const userLedger = (db.coinLedger || []).filter(
    l => l.senderId === user.id || l.recipientId === user.id || user.role === 'admin'
  );

  res.json({ ledger: userLedger });
});

// -------------------------------------------------------------
// CHAMA ACTIVITY FEED & IN-GROUP AWARD COINS
// -------------------------------------------------------------
apiRouter.post('/groups/:id/award-coins', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const { targetUserId, targetUserIds, coinAmount, note } = req.body;

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Section 8.1 Backend validation: awarder must be a member of the group (or admin)
  const isAwarderInGroup = group.slots.some(s => s.userId === user.id && s.status === 'active') || user.role === 'admin';
  if (!isAwarderInGroup) {
    return res.status(403).json({ error: 'You must be an active member of this Chama group to award coins.' });
  }

  const recipientIds: number[] = Array.isArray(targetUserIds) && targetUserIds.length > 0
    ? targetUserIds.map(Number)
    : targetUserId ? [Number(targetUserId)] : [];

  if (recipientIds.length === 0) {
    return res.status(400).json({ error: 'Please select at least one member to award coins to.' });
  }

  // Section 8.1: Block self-awards
  if (recipientIds.includes(user.id)) {
    return res.status(400).json({ error: 'Self-gifting is blocked. You cannot award coins to yourself.' });
  }

  // Recipients must be active group members OR the Global Admin Platform Wallet
  for (const rid of recipientIds) {
    const isMember = group.slots.some(s => s.userId === rid && s.status === 'active');
    const isAdminWallet = db.users.some(u => u.id === rid && u.role === 'admin');
    if (!isMember && !isAdminWallet) {
      return res.status(400).json({ error: `Recipient #${rid} is neither an active slot holder in this Chama nor the Buyoll Admin Platform Wallet.` });
    }
  }

  const coinsPerPerson = Math.max(1, Number(coinAmount) || 5);
  const totalCoinsNeeded = coinsPerPerson * recipientIds.length;

  // Section 8.1: Must have sufficient coin balance, balance may never go negative
  const currentCoins = user.coins || 0;
  if (currentCoins < totalCoinsNeeded) {
    return res.status(400).json({
      error: `Insufficient coins in your wallet! You have ${currentCoins} coins, but tried to award ${totalCoinsNeeded} coins (${coinsPerPerson} × ${recipientIds.length} recipient${recipientIds.length !== 1 ? 's' : ''}). Please deposit coins in your Wallet first.`,
    });
  }

  // Atomic debit from awarder
  user.coins = currentCoins - totalCoinsNeeded;
  const now = Date.now();
  if (!db.coinLedger) db.coinLedger = [];
  if (!group.activities) group.activities = [];

  const recipientNames: string[] = [];

  // Atomic credit to each recipient with synchronized ledger entries
  for (const rid of recipientIds) {
    const recipient = db.users.find(u => u.id === rid);
    if (recipient) {
      recipient.coins = (recipient.coins || 0) + coinsPerPerson;
      const isAdmin = recipient.role === 'admin';
      const displayName = isAdmin ? 'Buyoll Admin Platform Wallet' : recipient.name;
      recipientNames.push(displayName);

      db.coinLedger.unshift({
        id: `coin_${now}_${Math.random().toString(36).substring(2, 6)}`,
        type: isAdmin ? 'platform_reward' : 'transfer',
        senderId: user.id,
        senderName: user.name,
        recipientId: recipient.id,
        recipientName: displayName,
        amount: coinsPerPerson,
        reason: (note || (isAdmin ? 'Platform appreciation reward' : `Applauded in Chama "${group.name}"`)).trim(),
        timestamp: now,
      });

      // Record in Chama activity feed
      group.activities.unshift({
        id: `act_${now}_${Math.random().toString(36).substring(2, 6)}`,
        groupId: group.id,
        type: 'coin_award',
        title: isAdmin ? 'Admin Platform Wallet Rewarded' : 'Applaud Coins Awarded',
        description: `${user.name} awarded ${coinsPerPerson} Applaud Coins to ${displayName}! "${note || (isAdmin ? 'Thank you Buyoll Platform!' : 'Well done & great Chama spirit!')}"`,
        coins: coinsPerPerson,
        actorId: user.id,
        actorName: user.name,
        actorAvatar: user.avatar,
        targetUserId: recipient.id,
        targetUserName: displayName,
        timestamp: now,
      });
    }
  }

  // Post to group chat
  group.chat.push({
    id: `chat_${now}`,
    senderId: user.id,
    senderName: user.name,
    kind: 'reward',
    text: `🌟 ${user.name} awarded ${coinsPerPerson} coins to ${recipientNames.join(', ')}! "${note || 'Great Chama dedication!'}"`,
    timestamp: now,
  });

  logAudit(db, user.id, user.name, 'GROUP_COINS_AWARDED', `Awarded ${totalCoinsNeeded} coins to ${recipientNames.join(', ')} in Chama #${group.id}`);
  await saveDatabase(db);

  res.json({
    success: true,
    remainingCoins: user.coins,
    group,
    message: `Successfully awarded ${coinsPerPerson} coins to ${recipientNames.join(', ')}! 🌟`,
  });
});

// EXPORT GROUP MEMBERS CSV (Admin Only)
apiRouter.get('/groups/:id/members/export-csv', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;

  const groupId = Number(req.params.id);
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const headers = [
    'Slot Number',
    'Member Name',
    'Phone',
    'Role',
    'Status',
    'Priority Level',
    'Problem Status',
    'Cycle Delivery Day',
    'Target Obligation (KSh)',
    'Amount Paid (KSh)',
    'Remaining Arrears (KSh)',
    'Paid Days Count',
    'Joined Date',
    'Last Payment Date',
  ];

  const rows = group.slots.map(s => {
    const user = s.userId ? db.users.find(u => u.id === s.userId) : null;
    const targetAmt = s.targetAmount || group.productPrice;
    const paidAmt = s.paidAmount || 0;
    const arrears = Math.max(0, targetAmt - paidAmt);
    const deliveryDay = s.slotNumber * group.cycleDays;
    const isMod = s.userId && group.moderators?.includes(s.userId);

    return [
      s.slotNumber,
      `"${s.userName || (s.status === 'active' ? 'Active Member' : s.status === 'replacement_eligible' ? 'Vacated Slot' : 'Open Slot')}"`,
      `"${user?.phone || 'N/A'}"`,
      `"${isMod ? 'Moderator' : 'Member'}"`,
      `"${s.status}"`,
      `"${s.priorityLevel || 'Good'}"`,
      `"${s.memberStatus || 'good_standing'}"`,
      deliveryDay,
      targetAmt,
      paidAmt,
      arrears,
      (s.paidDays || []).length,
      s.joinedAt ? new Date(s.joinedAt).toISOString() : 'N/A',
      s.lastPaymentDate ? new Date(s.lastPaymentDate).toISOString() : 'N/A',
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="chama_${group.id}_members.csv"`);
  res.send(csvContent);
});

// -------------------------------------------------------------
// CHAMA ROTATING PAYOUT & STATUS ENGINE ENDPOINTS
// -------------------------------------------------------------

// Moderator Issues Formal Warning to a Dormant Member
apiRouter.post('/groups/:id/warn-dormant', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const { slotNumber, targetUserId, reason, deadlineDays } = req.body;

  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Only group moderator / store owner / system admin can issue warnings
  const isModerator = group.adminId === user.id || user.role === 'admin' || user.role === 'merchant';
  if (!isModerator) {
    return res.status(403).json({ error: 'Only the group moderator or store owner can issue formal member warnings.' });
  }

  const slot = group.slots.find(s => s.slotNumber === Number(slotNumber) && s.userId === Number(targetUserId));
  if (!slot || !slot.userId) {
    return res.status(404).json({ error: 'Target member slot not found in this group.' });
  }

  const targetUser = db.users.find(u => u.id === slot.userId);
  const now = Date.now();
  const daysLimit = Math.max(1, Number(deadlineDays) || 3);
  const deadlineDate = now + daysLimit * 86400000;
  const warningReason = (reason || 'No contributions or activity recorded for consecutive days. Arrears clearing required.').trim();

  // 1. Set warning on slot
  slot.memberStatus = 'dormant';
  slot.dormantWarning = {
    date: now,
    reason: warningReason,
    moderatorName: user.name,
    deadline: deadlineDate,
    active: true,
  };

  // 2. Audit log on group
  if (!group.slotAuditLogs) group.slotAuditLogs = [];
  const auditEntry = {
    id: `warn_${now}_${slot.slotNumber}`,
    timestamp: now,
    type: 'moderator_warning' as const,
    description: `Moderator ${user.name} issued formal warning to ${slot.userName || targetUser?.name || 'Member'}: "${warningReason}". Deadline to resume: ${new Date(deadlineDate).toLocaleDateString()}.`,
    actorName: user.name,
    isSystemGenerated: false,
    details: {
      slotNumber: slot.slotNumber,
      targetUserId: slot.userId,
      reason: warningReason,
      deadline: deadlineDate,
    },
  };
  group.slotAuditLogs.unshift(auditEntry);

  // 3. Automated Loan Suggestion Notification & Link to Dormant Member
  if (!group.notifications) group.notifications = [];
  const loanSuggestion = {
    id: `loan_sugg_${now}_${slot.slotNumber}`,
    groupId: group.id,
    groupName: group.name,
    recipientUserId: slot.userId,
    title: '⚠️ Formal Warning & Peer Loan Suggestion',
    message: `Moderator ${user.name} has flagged your Slot #${slot.slotNumber} as Dormant. Deadline to resume: ${new Date(deadlineDate).toLocaleDateString()}. You can catch up on arrears by requesting an emergency installment loan from our verified 3rd-party lenders!`,
    link: `/lenders-dashboard`,
    type: 'system' as const,
    timestamp: now,
  };
  group.notifications.unshift(loanSuggestion);

  // 4. Post warning and loan suggestion message in group chat
  group.chat.push({
    id: `chat_${now}_warn`,
    senderId: user.id,
    senderName: `${user.name} (Moderator)`,
    kind: 'system',
    text: `⚠️ FORMAL NOTICE: Member ${slot.userName || 'Slot holder'} was issued a formal warning for dormancy. Reason: ${warningReason}. Deadline: ${new Date(deadlineDate).toLocaleDateString()}. Tap Lenders Desk to request peer funding if in financial hardship.`,
    timestamp: now,
  });

  logAudit(db, user.id, user.name, 'DORMANT_WARNING_ISSUED', `Issued dormant warning to ${slot.userName} in Chama #${group.id}. Reason: ${warningReason}`);
  await saveDatabase(db);

  res.json({
    success: true,
    group,
    slot,
    message: `Formal warning issued to ${slot.userName || 'Member'}. Automated loan suggestion message dispatched!`,
  });
});

// Run Chama Slot Reordering & Priority Evaluation (Daily or Payment-Day Check)
apiRouter.post('/groups/:id/reorder-check', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const groupId = Number(req.params.id);
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const now = Date.now();
  const logs: any[] = [];
  const currentRound = group.currentRound || 1;

  // 1. Evaluate Member Priority and Problem Statuses
  for (const slot of group.slots) {
    if (!slot.userId || slot.status !== 'active') continue;

    const paidAmt = slot.paidAmount || 0;
    const targetAmt = slot.targetAmount || (group.dailyAmount * (group.cycleDays / group.size));
    const isPaidOut = Boolean(slot.paidOut || (slot.slotNumber < currentRound && group.deliveredRounds?.some(d => d.recipientSlot === slot.slotNumber)));
    slot.paidOut = isPaidOut;

    const daysPending = (slot.pendingDays || []).length;
    const daysPaid = (slot.paidDays || []).length;
    const lastActiveTime = slot.lastPaymentDate || slot.joinedAt || group.createdAt || now;
    const daysSinceLastPayment = Math.floor((now - lastActiveTime) / 86400000);

    // Problem statuses
    if (daysSinceLastPayment >= 3 && paidAmt < targetAmt) {
      if (slot.memberStatus !== 'dormant') {
        slot.memberStatus = 'dormant';
        slot.dormantSince = slot.dormantSince || now;
        logs.push({
          id: `status_${now}_${slot.slotNumber}`,
          timestamp: now,
          type: 'status_change',
          description: `Member ${slot.userName || `Slot #${slot.slotNumber}`} was flagged Dormant (${daysSinceLastPayment} days inactive).`,
          actorName: 'System Engine',
          isSystemGenerated: true,
        });
      }
    } else if (daysPending > 0 || (daysSinceLastPayment >= 1 && paidAmt < targetAmt)) {
      if (slot.memberStatus !== 'slow_payer') {
        slot.memberStatus = 'slow_payer';
        slot.slowPayerSince = slot.slowPayerSince || now;
        slot.consecutiveOnTimeCycles = 0;
        logs.push({
          id: `status_${now}_${slot.slotNumber}`,
          timestamp: now,
          type: 'status_change',
          description: `Member ${slot.userName || `Slot #${slot.slotNumber}`} was reclassified as Slow Payer (overdue contribution).`,
          actorName: 'System Engine',
          isSystemGenerated: true,
        });
      }
    } else {
      // Good Standing
      if (slot.memberStatus === 'slow_payer' || slot.memberStatus === 'dormant') {
        // Restoring a slot: member cleared all arrears and paid on time
        slot.memberStatus = 'good_standing';
        slot.priorityLevel = 'Good';
        slot.consecutiveOnTimeCycles = (slot.consecutiveOnTimeCycles || 0) + 1;
        slot.slowPayerSince = undefined;
        slot.dormantSince = undefined;
        logs.push({
          id: `status_${now}_${slot.slotNumber}`,
          timestamp: now,
          type: 'status_change',
          description: `Member ${slot.userName || `Slot #${slot.slotNumber}`} cleared arrears and was restored to Good standing!`,
          actorName: 'System Engine',
          isSystemGenerated: true,
        });
      } else {
        slot.memberStatus = 'good_standing';
        if (daysPaid > (currentRound * 2)) {
          slot.priorityLevel = 'Best';
        } else if (daysPaid >= currentRound) {
          slot.priorityLevel = slot.priorityLevel === 'Best' ? 'Best' : 'Better';
        } else {
          slot.priorityLevel = 'Good';
        }
      }
    }
  }

  // 2. Automatic daily slot reordering
  const paidOutSlots = group.slots.filter(s => s.paidOut || (s.slotNumber < currentRound && group.deliveredRounds?.some(d => d.recipientSlot === s.slotNumber)));
  const unpaidSlots = group.slots.filter(s => !paidOutSlots.some(p => p.slotNumber === s.slotNumber));

  if (unpaidSlots.length > 1) {
    const originalUnpaidOrder = [...unpaidSlots];

    const getPriorityWeight = (s: GroupSlot) => {
      if (s.memberStatus === 'slow_payer' || s.memberStatus === 'dormant') return 4;
      if (s.priorityLevel === 'Best') return 1;
      if (s.priorityLevel === 'Better') return 2;
      return 3;
    };

    unpaidSlots.sort((a, b) => {
      const weightA = getPriorityWeight(a);
      const weightB = getPriorityWeight(b);
      if (weightA !== weightB) return weightA - weightB;
      if (weightA === 4) {
        const timeA = a.slowPayerSince || a.dormantSince || now;
        const timeB = b.slowPayerSince || b.dormantSince || now;
        if (timeA !== timeB) return timeA - timeB;
      }
      return a.slotNumber - b.slotNumber;
    });

    const availableNumbers = originalUnpaidOrder.map(s => s.slotNumber).sort((a, b) => a - b);

    for (let i = 0; i < unpaidSlots.length; i++) {
      const slot = unpaidSlots[i];
      const targetSlotNumber = availableNumbers[i];
      if (slot.slotNumber !== targetSlotNumber) {
        const oldNum = slot.slotNumber;
        slot.slotNumber = targetSlotNumber;

        const notice = {
          id: `reorder_${now}_${slot.slotNumber}`,
          timestamp: now,
          type: 'system_slot_reorder' as const,
          description: `System reordered Slot #${oldNum} -> Slot #${targetSlotNumber} for ${slot.userName || 'Member'} (${slot.priorityLevel || 'Good'} standing, ${slot.memberStatus || 'good_standing'}).`,
          actorName: 'System Engine',
          isSystemGenerated: true,
          details: {
            oldSlot: oldNum,
            newSlot: targetSlotNumber,
            priorityLevel: slot.priorityLevel || 'Good',
            status: slot.memberStatus,
            effectiveDate: now,
          },
        };
        logs.push(notice);

        if (!group.notifications) group.notifications = [];
        group.notifications.unshift({
          id: `notif_${now}_reorder_${slot.slotNumber}`,
          groupId: group.id,
          groupName: group.name,
          recipientUserId: slot.userId || undefined,
          title: 'Payout Slot Reordered (System Action)',
          message: `Your Chama payout slot has been updated from Slot #${oldNum} to Slot #${targetSlotNumber} based on payment performance (${slot.priorityLevel || 'Good'} standing).`,
          type: 'system',
          timestamp: now,
        });
      }
    }
  }

  group.slots.sort((a, b) => a.slotNumber - b.slotNumber);

  if (logs.length > 0) {
    if (!group.slotAuditLogs) group.slotAuditLogs = [];
    group.slotAuditLogs.unshift(...logs);
  }

  await saveDatabase(db);
  res.json({
    success: true,
    group,
    actionsCount: logs.length,
    logs,
    message: logs.length > 0 ? `System evaluated members and applied ${logs.length} slot/status updates.` : 'All member slots verified up to date.',
  });
});

apiRouter.get('/groups/:id/activities', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Group not found' });

  if (!group.activities || group.activities.length === 0) {
    const derived: ChamaActivityItem[] = [];
    const baseTime = group.createdAt || (Date.now() - 86400000 * 2);

    derived.push({
      id: `act_init_${group.id}`,
      groupId: group.id,
      type: 'status_update',
      title: 'Chama Cycle Initialized',
      description: `Chama launched with ${group.size} speed slots for "${group.productTitle}". Daily installment KSh ${group.dailyAmount.toLocaleString()}.`,
      actorId: group.adminId,
      actorName: 'Store Owner',
      timestamp: baseTime,
    });

    for (const slot of group.slots) {
      if (slot.status === 'active' && slot.userId) {
        derived.push({
          id: `act_join_${slot.slotNumber}_${group.id}`,
          groupId: group.id,
          type: 'member_joined',
          title: `Slot #${slot.slotNumber} Claimed`,
          description: `${slot.userName || 'Member'} joined Slot #${slot.slotNumber} (Receives delivery Day ${slot.slotNumber * Math.floor(group.cycleDays / group.size)}).`,
          actorId: slot.userId,
          actorName: slot.userName || 'Member',
          targetSlotNumber: slot.slotNumber,
          timestamp: slot.joinedAt || baseTime + slot.slotNumber * 3600000,
        });

        if ((slot.paidAmount || 0) > 0) {
          derived.push({
            id: `act_pay_${slot.slotNumber}_${group.id}`,
            groupId: group.id,
            type: 'contribution',
            title: `Contribution Received · Slot #${slot.slotNumber}`,
            description: `${slot.userName || 'Member'} paid KSh ${(slot.paidAmount || 0).toLocaleString()} towards item rotation.`,
            amount: slot.paidAmount,
            actorId: slot.userId,
            actorName: slot.userName || 'Member',
            targetSlotNumber: slot.slotNumber,
            timestamp: slot.lastPaymentDate || Date.now() - 3600000,
          });
        }
      }
    }

    const groupLoans = (db.peerLoans || []).filter(l => l.groupId === group.id);
    for (const l of groupLoans) {
      const bName = l.borrowerName || l.requesterName || 'Member';
      const rAmount = l.requestedAmount || l.amount || 0;
      const bId = l.borrowerId || l.requesterId;
      derived.push({
        id: `act_loan_${l.id}`,
        groupId: group.id,
        type: 'loan_application',
        title: `Emergency Loan Requested`,
        description: `${bName} requested KSh ${rAmount.toLocaleString()} installment advance for Slot #${l.slotNumber}.`,
        amount: rAmount,
        actorId: bId,
        actorName: bName,
        targetSlotNumber: l.slotNumber,
        timestamp: l.createdAt,
      });

      if (l.status === 'funded') {
        derived.push({
          id: `act_loan_funded_${l.id}`,
          groupId: group.id,
          type: 'loan_funded',
          title: `Peer Loan Funded & Wallet Credited`,
          description: `Dedicated lender funded KSh ${rAmount.toLocaleString()} to ${bName}'s wallet to clear Chama arrears.`,
          amount: rAmount,
          actorName: l.lenderName || l.fundedByUserName || '3rd-Party Lender',
          targetSlotNumber: l.slotNumber,
          timestamp: l.fundedAt || l.createdAt + 1800000,
        });
      }
    }

    derived.sort((a, b) => b.timestamp - a.timestamp);
    group.activities = derived;
    await saveDatabase(db);
  }

  res.json({ activities: group.activities || [] });
});

// -------------------------------------------------------------
// WALLET M-PESA DEPOSIT FLOW & ADMIN APPROVAL
// -------------------------------------------------------------
apiRouter.post('/wallet/deposit', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { amount, mpesaCode, notes } = req.body;
  const numAmount = Number(amount);
  const trimmedCode = String(mpesaCode || '').trim().toUpperCase();

  if (!trimmedCode) {
    return res.status(400).json({ error: 'M-Pesa transaction code is required.' });
  }

  if (!/^[A-Z0-9]{8,12}$/i.test(trimmedCode)) {
    return res.status(400).json({
      error: 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters (e.g. RJL798K2MN).',
    });
  }

  if (numAmount <= 0) {
    return res.status(400).json({ error: 'Deposit amount must be greater than zero.' });
  }

  const db = await getDatabase();
  if (!db.walletDeposits) db.walletDeposits = [];

  // Check duplicate code in deposits
  if (db.walletDeposits.some(d => d.mpesaCode === trimmedCode)) {
    return res.status(400).json({ error: 'This M-Pesa transaction code has already been submitted for a wallet deposit.' });
  }

  const newDeposit: WalletDepositRequest = {
    id: `dep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    userId: user.id,
    userName: user.name,
    userPhone: user.phone,
    amount: numAmount,
    mpesaCode: trimmedCode,
    status: 'pending',
    createdAt: Date.now(),
    notes: (notes || '').trim(),
  };

  db.walletDeposits.unshift(newDeposit);

  // Also record in db.payments as pending
  const paymentRecord: PaymentRecord = {
    id: db.nextIds.payment++,
    type: 'wallet_deposit',
    userId: user.id,
    userName: user.name,
    code: trimmedCode,
    amount: numAmount,
    status: 'pending',
    createdAt: Date.now(),
  };
  db.payments.unshift(paymentRecord);

  logAudit(db, user.id, user.name, 'WALLET_DEPOSIT_SUBMITTED', `Submitted wallet deposit of KSh ${numAmount} (Code: ${trimmedCode})`);
  await saveDatabase(db);

  res.status(201).json({
    success: true,
    deposit: newDeposit,
    message: `Deposit request of KSh ${numAmount.toLocaleString()} (Code: ${trimmedCode}) submitted! The admin will verify and credit your wallet automatically.`,
  });
});

apiRouter.get('/wallet/deposits', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const db = await getDatabase();
  const userDeposits = (db.walletDeposits || []).filter(d => d.userId === user.id);
  res.json({ deposits: userDeposits });
});

apiRouter.get('/admin/wallet-deposits', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { db } = auth;
  res.json({ deposits: db.walletDeposits || [] });
});

apiRouter.post('/admin/wallet-deposits/:id/decide', async (req: Request, res: Response) => {
  const auth = await requireAdminUser(req, res);
  if (!auth) return;
  const { user, db } = auth;

  const { action, notes } = req.body;
  if (action !== 'approve' && action !== 'decline') {
    return res.status(400).json({ error: 'Action must be "approve" or "decline".' });
  }

  if (!db.walletDeposits) db.walletDeposits = [];

  const deposit = db.walletDeposits.find(d => d.id === req.params.id);
  if (!deposit) return res.status(404).json({ error: 'Deposit request not found' });

  if (deposit.status !== 'pending') {
    return res.status(400).json({ error: `This deposit request has already been ${deposit.status}.` });
  }

  const targetUser = db.users.find(u => u.id === deposit.userId);
  if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

  const now = Date.now();
  deposit.processedAt = now;
  deposit.processedBy = user.name;
  if (notes) deposit.notes = notes;

  const payment = db.payments.find(p => p.code === deposit.mpesaCode && p.type === 'wallet_deposit');

  if (action === 'approve') {
    deposit.status = 'approved';
    if (payment) {
      payment.status = 'approved';
      payment.approvedAt = now;
    }

    // Automatically credit user's wallet
    targetUser.credit = (targetUser.credit || 0) + deposit.amount;

    // Add to store credit ledger
    const ledgerEntry = {
      id: db.nextIds.ledger++,
      userId: targetUser.id,
      amount: deposit.amount,
      balanceAfter: targetUser.credit,
      type: 'refund_credit' as const,
      referenceId: deposit.mpesaCode,
      note: `M-Pesa Wallet Deposit (Code: ${deposit.mpesaCode}) approved & credited by Admin`,
      createdAt: now,
    };
    db.storeCreditLedger.unshift(ledgerEntry);

    logAudit(
      db,
      user.id,
      user.name,
      'WALLET_DEPOSIT_APPROVED',
      `Approved KSh ${deposit.amount} wallet deposit for ${targetUser.name} (Code: ${deposit.mpesaCode}). New balance: KSh ${targetUser.credit}`
    );
    await saveDatabase(db);

    res.json({
      success: true,
      deposit,
      newBalance: targetUser.credit,
      message: `Approved and credited KSh ${deposit.amount.toLocaleString()} to ${targetUser.name}'s wallet. New balance: KSh ${targetUser.credit.toLocaleString()}.`,
    });
  } else {
    deposit.status = 'declined';
    if (payment) {
      payment.status = 'rejected';
    }

    logAudit(
      db,
      user.id,
      user.name,
      'WALLET_DEPOSIT_DECLINED',
      `Declined KSh ${deposit.amount} wallet deposit for ${targetUser.name} (Code: ${deposit.mpesaCode})`
    );
    await saveDatabase(db);

    res.json({
      success: true,
      deposit,
      message: `Declined deposit request of KSh ${deposit.amount.toLocaleString()} for ${targetUser.name}.`,
    });
  }
});


