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
} from '../src/types.js';

export const apiRouter = Router();

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

// -------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------
apiRouter.get('/auth/me', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { phone, name, role, shopName, shopDescription } = req.body;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  const db = await getDatabase();
  const trimmedPhone = phone.trim();
  let user = db.users.find(u => u.phone === trimmedPhone);

  if (!user) {
    user = {
      id: db.nextIds.user++,
      name: (name || 'User ' + trimmedPhone.slice(-4)).trim(),
      phone: trimmedPhone,
      role: role === 'merchant' ? 'merchant' : role === 'admin' ? 'admin' : 'buyer',
      shopName: role === 'merchant' ? (shopName || name || 'My Store').trim() : undefined,
      shopDescription: role === 'merchant' ? (shopDescription || 'Authentic store on Alibaird').trim() : undefined,
      verified: role === 'merchant' ? false : undefined,
      credit: 0,
      coins: 50,
      points: 10,
      lastActive: Date.now(),
      createdAt: Date.now(),
    };
    db.users.push(user);
    logAudit(db, user.id, user.name, 'USER_REGISTERED', `Registered new ${user.role} account.`);
    await saveDatabase(db);
  } else {
    user.lastActive = Date.now();
    await saveDatabase(db);
  }

  res.json({ user });
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
    })),
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

// Vendor product creation
apiRouter.post('/products', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || (user.role !== 'merchant' && user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only verified merchants or admins can create products' });
  }

  const { title, description, category, price, wasPrice, discountPercent, images, speedOptions, stockQuantity, attributes, promotionType, promotionDiscount, bonusGift } = req.body;

  if (!title || !description || !price || !category) {
    return res.status(400).json({ error: 'Title, description, category, and price are required' });
  }

  const db = await getDatabase();
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
  const { productId, size, name, months } = req.body;

  // Mandatory speed check
  if (!size || Number(size) <= 0) {
    return res.status(400).json({ error: 'Mandatory speed selection required. Please choose a speed to continue.' });
  }

  const db = await getDatabase();
  const product = db.products.find(p => p.id === Number(productId));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
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
        id: `chat_${Date.now()}`,
        senderId: user.id,
        senderName: user.name,
        kind: 'system',
        text: `Chama group started! ${user.name} is Member #1 and moderator. Platform Till: 196853, Paybill: 522533 (Account: code4363). Group is active immediately.`,
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

// Join group with code
apiRouter.post('/groups/:id/join', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'You must be signed in to join a Chama group' });
  }

  const { inviteCode } = req.body;
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

  // Validate code if provided
  const upperCode = (inviteCode || '').trim().toUpperCase();
  if (upperCode) {
    const validCode =
      group.inviteCode === upperCode ||
      group.slots.some(s => s.inviteCode === upperCode);
    if (!validCode) {
      return res.status(400).json({ error: 'Invalid invite code for this Chama group.' });
    }
  }

  // Find next available slot: prefer replacement_eligible first, then open
  let targetSlot = group.slots.find(s => s.status === 'replacement_eligible');
  if (!targetSlot) {
    targetSlot = group.slots.find(s => s.status === 'open');
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

  logAudit(db, user.id, user.name, 'MEMBER_JOINED', `Joined Chama #${group.id} as Member #${targetSlot.slotNumber}`);
  await saveDatabase(db);

  res.json({
    group,
    assignedSlot: targetSlot.slotNumber,
    message: `Welcome! You are Member #${targetSlot.slotNumber}. Your allocation rotation is day ${targetSlot.slotNumber * group.cycleDays}.`,
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

  const { amount, purpose } = req.body;
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
    purpose: purpose?.trim() || `Installment support for Slot #${slot.slotNumber} (${group.productTitle})`,
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
    text: `📢 PEER LOAN REQUEST: ${user.name} (Member #${slot.slotNumber}) requested a P2P loan of KSh ${numAmount.toLocaleString()}. 3rd-party lenders: review request and enter approved loan amount. 3% platform commission (KSh ${platformFee}) applies. All repayments and terms are settled manually outside Buyoll.`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    user.id,
    user.name,
    'PEER_LOAN_REQUESTED',
    `Requested P2P loan of KSh ${numAmount} for Chama #${group.id} Slot #${slot.slotNumber}. 3% commission: KSh ${platformFee}`
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
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const db = await getDatabase();
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
apiRouter.post('/groups/:id/loans/:loanId/fund', async (req: Request, res: Response) => {
  const lender = await getAuthenticatedUser(req);
  if (!lender) return res.status(401).json({ error: 'You must be signed in to fund this peer loan.' });

  const groupId = Number(req.params.id);
  const loanId = Number(req.params.loanId);
  const db = await getDatabase();
  const group = db.groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

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

  const disburseAmount = loan.approvedAmount || loan.amount;

  // Credit member's wallet balance directly (deposit-only, non-withdrawable)
  requester.credit = (requester.credit || 0) + disburseAmount;

  // Record member ledger statement entry for loan received
  const requesterLedger = {
    id: db.nextIds.ledger++,
    userId: requester.id,
    amount: disburseAmount,
    balanceAfter: requester.credit,
    type: 'admin_adjustment' as const,
    referenceId: `P2P_LOAN_${loan.id}`,
    note: `P2P Loan received from 3rd-party lender ${lender.name} (KSh ${disburseAmount.toLocaleString()}) for Chama #${group.id} Slot #${loan.slotNumber}. Non-withdrawable; strictly for shopping and Chama contributions. Repayment external.`,
    createdAt: Date.now(),
  };
  db.storeCreditLedger.unshift(requesterLedger);

  loan.status = 'funded';
  loan.fundedByUserId = lender.id;
  loan.fundedByUserName = lender.name;
  loan.fundedAt = Date.now();
  loan.platformFeeStatus = 'paid';

  // Group chat announcement
  group.chat.push({
    id: `chat_${Date.now()}`,
    senderId: lender.id,
    senderName: lender.name,
    kind: 'system',
    text: `✅ PEER LOAN FUNDED: 3rd-party lender ${lender.name} has released KSh ${disburseAmount.toLocaleString()} directly into ${requester.name}’s wallet! 3% platform commission verified. ${requester.name} can now use these wallet funds to pay for Slot #${loan.slotNumber} or shop items. (Loan repayment is handled manually outside Buyoll).`,
    timestamp: Date.now(),
  });

  logAudit(
    db,
    lender.id,
    lender.name,
    'PEER_LOAN_FUNDED',
    `Funded P2P loan #${loan.id} of KSh ${disburseAmount} for ${requester.name}. 3% commission settled.`
  );

  await saveDatabase(db);
  res.json({
    loan,
    message: `Loan funded successfully! KSh ${disburseAmount.toLocaleString()} was transferred directly into ${requester.name}’s wallet.`,
  });
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
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const db = await getDatabase();
  res.json({
    pendingPayments: db.payments.filter(p => p.status === 'pending'),
    allPayments: db.payments,
    refundRequests: db.refundRequests,
    merchants: db.users.filter(u => u.role === 'merchant'),
    allUsers: db.users,
    auditLogs: db.auditLogs.slice(0, 50),
    groups: db.groups,
    products: db.products,
  });
});

apiRouter.post('/admin/payments/:id/decision', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { decision } = req.body; // 'approve' | 'reject'
  const db = await getDatabase();
  const payment = db.payments.find(p => p.id === Number(req.params.id));

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status !== 'pending') {
    return res.status(400).json({ error: 'This payment has already been processed' });
  }

  if (decision === 'approve') {
    payment.status = 'approved';
    payment.approvedAt = Date.now();

    // If it's a group payment, credit slot
    if (payment.type === 'group_installment' && payment.groupId && payment.slotNumber) {
      const grp = db.groups.find(g => g.id === payment.groupId);
      if (grp) {
        const slot = grp.slots.find(s => s.slotNumber === payment.slotNumber);
        if (slot) {
          slot.paidAmount = (slot.paidAmount || 0) + payment.amount;
          slot.lastPaymentDate = Date.now();

          // Update group round tracking
          grp.currentRoundPaid = (grp.currentRoundPaid || 0) + payment.amount;
          const targetAmt = grp.targetAmountPerRound || grp.productPrice;
          grp.roundBalanceRemaining = Math.max(0, targetAmt - grp.currentRoundPaid);
          if (grp.currentRoundPaid >= targetAmt) {
            grp.isReadyForPickup = true;
            grp.chat.push({
              id: `chat_${Date.now()}_pickup`,
              senderId: 1,
              senderName: 'System Verification',
              kind: 'system',
              text: `✅ 100% PAID! Full target amount of KSh ${targetAmt.toLocaleString()} has been reached! Item is now verified & READY FOR PICKUP for Member #${grp.currentRecipientSlot || 1}!`,
              timestamp: Date.now(),
            });
          }

          // Award reward points: 1 point for every 10 KSh paid
          const payer = db.users.find(u => u.id === payment.userId);
          if (payer) {
            payer.points = (payer.points || 0) + Math.floor(payment.amount / 10);
            payer.lastActive = Date.now();
          }
        }
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
        payer.coins = (payer.coins || 0) + payment.amount;
      }
    }

    logAudit(db, user.id, user.name, 'PAYMENT_APPROVED', `Approved payment ${payment.code} for KSh ${payment.amount}`);
  } else {
    payment.status = 'rejected';
    logAudit(db, user.id, user.name, 'PAYMENT_REJECTED', `Rejected payment ${payment.code}`);
  }

  await saveDatabase(db);
  res.json({ payment, message: `Payment ${payment.code} was ${decision}d.` });
});

apiRouter.post('/admin/refunds/:id/status', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { status, adminNote } = req.body;
  const db = await getDatabase();
  const refund = db.refundRequests.find(r => r.id === Number(req.params.id));

  if (!refund) return res.status(404).json({ error: 'Refund request not found' });

  refund.status = status;
  if (adminNote) refund.adminNote = adminNote;
  if (status === 'completed') {
    refund.processedAt = Date.now();
    // Mark associated default record as completed
    const def = db.defaultRecords.find(d => d.id === refund.defaultRecordId);
    if (def) def.resolutionStatus = 'completed';
  }

  logAudit(db, user.id, user.name, 'REFUND_STATUS_UPDATED', `Updated refund #${refund.id} status to ${status}`);
  await saveDatabase(db);

  res.json({ refund, message: `Refund #${refund.id} status updated to ${status}.` });
});

apiRouter.post('/admin/merchants/:id/verify', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { verified } = req.body;
  const db = await getDatabase();
  const merchant = db.users.find(u => u.id === Number(req.params.id) && u.role === 'merchant');

  if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

  merchant.verified = Boolean(verified);
  merchant.starRating = verified ? 5 : undefined;
  logAudit(db, user.id, user.name, 'MERCHANT_VERIFIED', `${verified ? 'Verified with 5 stars (Buyoll Verified)' : 'Suspended'} merchant ${merchant.shopName || merchant.name}`);
  await saveDatabase(db);

  res.json({
    merchant,
    message: verified ? 'Merchant verified with 5 stars (Buyoll Verified).' : 'Merchant verification revoked.',
  });
});
