import {
  Announcement,
  ChamaGroup,
  GroupSlot,
  MerchantSubscriptionTier,
  PlatformAnnouncementSlot,
  Product,
  User,
} from '../types.ts';

const DAY_MS = 86400000;

function buildSeedProducts(now: number): Product[] {
  return [
    {
      id: 1,
      title: 'EcoFlow Portable Solar Power Station (1024Wh / 1800W)',
      description:
        'Heavy duty portable solar power backup generator with ultra-fast AC charging, dual PD 100W USB-C ports, and intelligent LCD battery monitor. Ideal for home outages, off-grid appliances, and emergency power.',
      category: 'Appliances',
      price: 68000,
      wasPrice: 78000,
      discountPercent: 13,
      images: ['./images/solar_power.jpg'],
      vendorId: 2,
      vendorName: '(Buyoll Verified)',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 15,
      attributes: {
        Capacity: '1024Wh LiFePO4',
        Output: '1800W Pure Sine Wave',
        Cycles: '3,000+ Cycles to 80%',
        Warranty: '2 Years Manufacturer',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 680, totalAmount: 68000, description: '10 members · KSh 680 daily · Delivery rotation every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 1134, totalAmount: 68000, description: '6 members · KSh 1,134 daily · Accelerated 60-day cycle' },
        { size: 4, cycleDays: 10, dailyAmount: 1700, totalAmount: 68000, description: '4 members · KSh 1,700 daily · Express 40-day delivery' },
        { size: 2, cycleDays: 10, dailyAmount: 3400, totalAmount: 68000, description: '2 members · KSh 3,400 daily · Fast-track 20-day duo' },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 2,
      title: 'Culinary Pro 10-Piece Stainless Steel Tri-Ply Cookware Set',
      description:
        'Professional grade surgical stainless steel with impact-bonded aluminum core for even heat distribution. Suitable for induction, gas, and electric stovetops. Oven safe to 260°C.',
      category: 'Kitchen',
      price: 14500,
      wasPrice: 17000,
      discountPercent: 15,
      images: ['./images/cookware_set.jpg'],
      vendorId: 13,
      vendorName: 'Rift Valley Cookware Crafts',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 28,
      attributes: {
        Material: '18/10 Stainless Steel',
        Pieces: '10 Pcs with Tempered Lids',
        Compatibility: 'Induction / Gas / Ceramic',
        Cleaning: 'Dishwasher Safe',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 145, totalAmount: 14500, description: '10 members · KSh 145 daily · One set delivered every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 242, totalAmount: 14500, description: '6 members · KSh 242 daily · Completed in 60 days' },
        { size: 4, cycleDays: 10, dailyAmount: 363, totalAmount: 14500, description: '4 members · KSh 363 daily · Completed in 40 days' },
        { size: 2, cycleDays: 10, dailyAmount: 725, totalAmount: 14500, description: '2 members · KSh 725 daily · Completed in 20 days' },
      ],
      createdAt: now - 1 * DAY_MS,
      updatedAt: now - 1 * DAY_MS,
    },
    {
      id: 3,
      title: 'Titanium 55-Inch 4K UHD Bezel-Less Smart LED TV',
      description:
        'Cinema-grade 4K resolution with Quantum Color HDR10+, Dolby Audio spatial sound, built-in dual band Wi-Fi, and Google TV operating system with Netflix and YouTube pre-installed.',
      category: 'Phones, Tablets & TV',
      price: 46000,
      wasPrice: 52000,
      discountPercent: 12,
      images: ['./images/smart_tv.jpg'],
      vendorId: 11,
      vendorName: 'Apex Electronics Kenya',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 12,
      attributes: {
        Screen: '55" 4K UHD Bezel-Less',
        HDR: 'HDR10+ & HLG',
        Audio: '24W Dolby Atmos Stereo',
        OS: 'Google TV Licensed',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 460, totalAmount: 46000, description: '10 members · KSh 460 daily · Allocation every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 767, totalAmount: 46000, description: '6 members · KSh 767 daily · 60-day fulfillment' },
        { size: 4, cycleDays: 10, dailyAmount: 1150, totalAmount: 46000, description: '4 members · KSh 1,150 daily · 40-day fulfillment' },
        { size: 2, cycleDays: 10, dailyAmount: 2300, totalAmount: 46000, description: '2 members · KSh 2,300 daily · 20-day duo speed' },
      ],
      createdAt: now - 2 * DAY_MS,
      updatedAt: now - 2 * DAY_MS,
    },
    {
      id: 4,
      title: 'ErgoMatrix Aeroflex High-Back Mesh Executive Office Chair',
      description:
        'Orthopedic dynamic lumbar support with breathable Korean mesh, 3D adjustable armrests, synchronized tilt mechanism, and heavy-duty polished aluminum chassis.',
      category: 'Home & Office Furniture',
      price: 24000,
      wasPrice: 28500,
      discountPercent: 16,
      images: ['./images/office_chair.jpg'],
      vendorId: 12,
      vendorName: 'Kilimani Office & Living',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 20,
      attributes: {
        Support: 'Self-adjusting Lumbar',
        GasLift: 'Class 4 TÜV Certified',
        Base: 'Polished Cast Aluminum',
        Warranty: '3 Years Comprehensive',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 240, totalAmount: 24000, description: '10 members · KSh 240 daily · 1 chair allocated every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 400, totalAmount: 24000, description: '6 members · KSh 400 daily · 60 days total' },
        { size: 4, cycleDays: 10, dailyAmount: 600, totalAmount: 24000, description: '4 members · KSh 600 daily · 40 days total' },
        { size: 2, cycleDays: 10, dailyAmount: 1200, totalAmount: 24000, description: '2 members · KSh 1,200 daily · 20 days duo' },
      ],
      createdAt: now - 3 * DAY_MS,
      updatedAt: now - 3 * DAY_MS,
    },
    {
      id: 5,
      title: 'Smart Inverter Double-Door Refrigerator (260L Frost-Free)',
      description:
        'Energy-saving digital inverter cooling, multi-airflow humidity control crisper, interior LED lighting, and anti-bacterial gasket protection for fresh family food storage.',
      category: 'Appliances',
      price: 38500,
      wasPrice: 44000,
      discountPercent: 12,
      images: ['./images/solar_power.jpg'],
      vendorId: 15,
      vendorName: 'Nairobi Smart Living & Appliances',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 14,
      attributes: {
        Capacity: '260 Litres Double Door',
        Compressor: 'Smart Inverter 10-Yr Warranty',
        Cooling: 'Multi Air Flow No Frost',
        Power: 'A+ Energy Efficiency',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 385, totalAmount: 38500, description: '10 members · KSh 385 daily · 1 fridge every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 642, totalAmount: 38500, description: '6 members · KSh 642 daily · 60-day cycle' },
        { size: 4, cycleDays: 10, dailyAmount: 963, totalAmount: 38500, description: '4 members · KSh 963 daily · 40-day cycle' },
        { size: 2, cycleDays: 10, dailyAmount: 1925, totalAmount: 38500, description: '2 members · KSh 1,925 daily · 20-day cycle' },
      ],
      createdAt: now - 4 * DAY_MS,
      updatedAt: now - 4 * DAY_MS,
    },
    {
      id: 6,
      title: 'Orthopedic High-Density Quilted Mattress 6x6 (10-Inch)',
      description:
        'Pocket spring core with high-density pressure-relief memory foam topper, anti-allergy knitted bamboo jacquard cover, and reinforced edge perimeter for spinal alignment.',
      category: 'Bedding',
      price: 22000,
      wasPrice: 26000,
      discountPercent: 15,
      images: ['./images/cookware_set.jpg'],
      vendorId: 16,
      vendorName: 'Eldoret Fresh Bedding & Decor',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 18,
      attributes: {
        Size: '6x6 King Size 10-Inch',
        Core: 'Independent Pocket Springs',
        Cover: 'Breathable Bamboo Jacquard',
        Warranty: '5 Years Manufacturer',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 220, totalAmount: 22000, description: '10 members · KSh 220 daily · 1 mattress every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 367, totalAmount: 22000, description: '6 members · KSh 367 daily · 60 days total' },
        { size: 4, cycleDays: 10, dailyAmount: 550, totalAmount: 22000, description: '4 members · KSh 550 daily · 40 days total' },
        { size: 2, cycleDays: 10, dailyAmount: 1100, totalAmount: 22000, description: '2 members · KSh 1,100 daily · 20 days duo' },
      ],
      createdAt: now - 5 * DAY_MS,
      updatedAt: now - 5 * DAY_MS,
    },
    {
      id: 7,
      title: 'Commercial Heavy Duty Blender & Food Processor (2.5L / 1800W)',
      description:
        'Industrial high-torque copper motor with Japanese 6-blade hardened stainless steel blades. Crushes ice in 5 seconds and grinds dry spices, grains, smoothies, and nut butters effortlessly.',
      category: 'Kitchen',
      price: 7800,
      wasPrice: 9500,
      discountPercent: 18,
      images: ['./images/cookware_set.jpg'],
      vendorId: 14,
      vendorName: 'Savanna Tech & Solar Solutions',
      isFeatured: false,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 30,
      attributes: {
        Power: '1800W Pure Copper Motor',
        Capacity: '2.5L BPA-Free Pitcher',
        Speed: 'Variable Speed + Pulse Switch',
        Blades: 'Japanese 6-Leaf Stainless',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 78, totalAmount: 7800, description: '10 members · KSh 78 daily · 1 blender every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 130, totalAmount: 7800, description: '6 members · KSh 130 daily · 60 days total' },
        { size: 4, cycleDays: 10, dailyAmount: 195, totalAmount: 7800, description: '4 members · KSh 195 daily · 40 days total' },
        { size: 2, cycleDays: 10, dailyAmount: 390, totalAmount: 7800, description: '2 members · KSh 390 daily · 20 days duo' },
      ],
      createdAt: now - 6 * DAY_MS,
      updatedAt: now - 6 * DAY_MS,
    },
    {
      id: 8,
      title: 'Smart Security Solar CCTV Dual Camera with 4G SIM & Night Vision',
      description:
        '100% wire-free outdoor security with built-in solar panel, 4G LTE SIM cellular connectivity, 360° pan/tilt tracking, PIR human detection, two-way audio intercom, and color night vision.',
      category: 'Phones, Tablets & TV',
      price: 12500,
      wasPrice: 15000,
      discountPercent: 17,
      images: ['./images/smart_tv.jpg'],
      vendorId: 11,
      vendorName: 'Apex Electronics Kenya',
      isFeatured: true,
      live: true,
      publicationStatus: 'posted',
      moderationStatus: 'approved',
      stockQuantity: 25,
      attributes: {
        Connectivity: '4G LTE SIM (No Wi-Fi needed)',
        Solar: '8W High Efficiency Panel',
        Battery: '15,000mAh Rechargeable',
        Resolution: '2K 3MP Dual Lens Color Night',
      },
      speedOptions: [
        { size: 10, cycleDays: 10, dailyAmount: 125, totalAmount: 12500, description: '10 members · KSh 125 daily · 1 camera every 10 days' },
        { size: 6, cycleDays: 10, dailyAmount: 209, totalAmount: 12500, description: '6 members · KSh 209 daily · 60 days total' },
        { size: 4, cycleDays: 10, dailyAmount: 313, totalAmount: 12500, description: '4 members · KSh 313 daily · 40 days total' },
        { size: 2, cycleDays: 10, dailyAmount: 625, totalAmount: 12500, description: '2 members · KSh 625 daily · 20 days duo' },
      ],
      createdAt: now - 7 * DAY_MS,
      updatedAt: now - 7 * DAY_MS,
    },
  ];
}

function buildOpenSlots(size: number, targetAmount: number, now: number, occupied: Array<{ slotNumber: number; userId: number; userName: string; paidAmount: number }>): GroupSlot[] {
  return Array.from({ length: size }, (_, i) => {
    const slotNumber = i + 1;
    const found = occupied.find((o) => o.slotNumber === slotNumber);
    if (found) {
      return {
        slotNumber,
        userId: found.userId,
        userName: found.userName,
        status: 'active',
        inviteCode: `BYL${slotNumber}X${targetAmount.toString().slice(0, 2)}`,
        paidAmount: found.paidAmount,
        targetAmount,
        lastPaymentDate: now - DAY_MS,
        joinedAt: now - 2 * DAY_MS,
      };
    }
    return {
      slotNumber,
      userId: null,
      userName: null,
      status: 'open',
      inviteCode: `OPEN${slotNumber}K`,
      paidAmount: 0,
      targetAmount,
    };
  });
}

function buildSeedGroups(now: number): ChamaGroup[] {
  return [
    {
      id: 101,
      productId: 1,
      productTitle: 'EcoFlow Portable Solar Power Station (1024Wh / 1800W)',
      productPrice: 68000,
      productImage: './images/solar_power.jpg',
      name: 'Mwangi Solar Group',
      size: 10,
      vendorId: 2,
      adminId: 3,
      moderators: [3],
      status: 'active',
      inviteCode: 'SOLAR9X1',
      dailyAmount: 680,
      cycleDays: 10,
      slots: buildOpenSlots(10, 68000, now, [
        { slotNumber: 1, userId: 3, userName: 'Samuel Mwangi', paidAmount: 6800 },
        { slotNumber: 2, userId: 4, userName: 'Faith Chebet', paidAmount: 2040 },
      ]),
      occupiedCount: 2,
      availableCount: 8,
      platformTill: '196853',
      platformPaybill: '522533',
      platformAccount: 'code4363',
      merchantTill: '3463533',
      merchantPaybill: '26253326',
      merchantAccount: 'Code4533',
      currentRound: 1,
      currentRecipientSlot: 1,
      currentRoundPaid: 8840,
      targetAmountPerRound: 68000,
      roundBalanceRemaining: 59160,
      isReadyForPickup: false,
      deliveredRounds: [],
      chat: [
        {
          id: 'm1',
          senderId: 3,
          senderName: 'Samuel Mwangi',
          kind: 'system',
          text: 'Group started! Member #1 joined and is ready for Day 10.',
          timestamp: now - 2 * DAY_MS,
        },
        {
          id: 'm2',
          senderId: 4,
          senderName: 'Faith Chebet',
          kind: 'normal',
          text: 'Joined as Member #2! Excited for this solar station.',
          timestamp: now - 1 * DAY_MS,
        },
      ],
      createdAt: now - 2 * DAY_MS,
    },
    {
      id: 200,
      productId: 2,
      productTitle: 'Culinary Pro 10-Piece Stainless Steel Tri-Ply Cookware Set',
      productPrice: 14500,
      productImage: './images/cookware_set.jpg',
      name: 'Cookware Fast Track 6',
      size: 6,
      vendorId: 13,
      adminId: 3,
      moderators: [3],
      status: 'active',
      inviteCode: 'COOK6F2',
      dailyAmount: 242,
      cycleDays: 10,
      slots: buildOpenSlots(6, 14500, now, [
        { slotNumber: 1, userId: 3, userName: 'Samuel Mwangi', paidAmount: 2420 },
      ]),
      occupiedCount: 1,
      availableCount: 5,
      platformTill: '196853',
      platformPaybill: '522533',
      platformAccount: 'code4363',
      merchantTill: '3463533',
      currentRound: 1,
      currentRecipientSlot: 1,
      currentRoundPaid: 2420,
      targetAmountPerRound: 14500,
      roundBalanceRemaining: 12080,
      isReadyForPickup: false,
      deliveredRounds: [],
      chat: [],
      createdAt: now - 1 * DAY_MS,
    },
  ];
}

function buildSeedHeroCards(now: number): PlatformAnnouncementSlot[] {
  return [
    {
      slot: 1,
      title: 'Welcome to Buyoll Community Groups',
      message: 'Safe, vetted community savings circles. Join trusted circles with verified member referrals and moderator vetting.',
      badge: 'Notice',
      accent: 'emerald',
      ctaLabel: 'Explore Groups',
      ctaUrl: '/groups',
      status: 'published',
      isPublished: true,
      updatedBy: 'buyoll@customerservive.com',
      updatedAt: now - DAY_MS,
      version: 1,
    },
    {
      slot: 2,
      title: 'Know Someone to Join: Trust & Vetting',
      message: 'Every new Group member must be vouched for by an active member and verified via moderator phone check before admission.',
      badge: 'Update',
      accent: 'violet',
      ctaLabel: 'How It Works',
      ctaUrl: '/groups',
      status: 'published',
      isPublished: true,
      updatedBy: 'buyoll@customerservive.com',
      updatedAt: now - 43200000,
      version: 1,
    },
    {
      slot: 3,
      title: 'Direct Merchant Escrow & Safe Payouts',
      message: 'Zero defaults, guaranteed rotating payouts, and Lipa Mdogomdogo fulfillment backed by official M-Pesa statements.',
      badge: 'Promo',
      accent: 'amber',
      ctaLabel: 'Browse Deals',
      ctaUrl: '/announcements',
      status: 'published',
      isPublished: true,
      updatedBy: 'buyoll@customerservive.com',
      updatedAt: now - 21600000,
      version: 1,
    },
  ];
}

function buildSeedAnnouncements(now: number): Announcement[] {
  return [
    {
      id: 1,
      title: 'Welcome to Buyoll Group Marketplace!',
      body: 'Kenya’s first social fintech marketplace combining rotating savings groups, Lipa Mdogomdogo, and verified merchant deals.',
      category: 'Platform Update',
      type: 'ANNOUNCEMENT',
      audience: 'ALL',
      status: 'PUBLISHED',
      pinned: true,
      ctaLabel: 'Explore Deals',
      ctaUrl: '/announcements',
      publishedAt: now - 2 * DAY_MS,
      createdAt: now - 2 * DAY_MS,
      updatedAt: now - 2 * DAY_MS,
      authorName: 'Buyoll Platform Team',
    },
    {
      id: 2,
      title: 'New: Lipa Mdogomdogo Solo Plans Live',
      body: 'Save towards any appliance or smart electronics with single-member Lipa Mdogomdogo plans over 1 to 6 months. Zero interest, direct merchant fulfillment.',
      category: 'Savings Plans',
      type: 'PROMOTION',
      audience: 'ALL',
      status: 'PUBLISHED',
      pinned: false,
      ctaLabel: 'Start Saving',
      ctaUrl: '/groups',
      publishedAt: now - 1 * DAY_MS,
      createdAt: now - 1 * DAY_MS,
      updatedAt: now - 1 * DAY_MS,
      authorName: 'Buyoll Savings Desk',
    },
    {
      id: 3,
      title: 'Merchant & 3rd-Party Lender Portals Open',
      body: 'Verified merchants can list inventory with 10-speed Groups. 3rd-party lenders can fund member wallets with transparent platform terms.',
      category: 'Merchant & Lending',
      type: 'NOTICE',
      audience: 'ALL',
      status: 'PUBLISHED',
      pinned: false,
      ctaLabel: 'View Groups',
      ctaUrl: '/groups',
      publishedAt: now - 14400000,
      createdAt: now - 14400000,
      updatedAt: now - 14400000,
      authorName: 'Buyoll Operations',
    },
  ];
}

const SEED_MERCHANTS: Record<number, Partial<User>> = {
  2: {
    id: 2,
    name: '(Buyoll Verified)',
    shopName: '(Buyoll Verified)',
    shopDescription: 'Official verified distributor of solar generators, appliances & smart electronics.',
    verified: true,
    starRating: 5,
    ratingCount: 24,
    reviews: [],
    tillNumber: '892110',
  },
  11: {
    id: 11,
    name: 'Apex Electronics Kenya',
    shopName: 'Apex Electronics Kenya',
    shopDescription: 'Direct distributor of 4K Smart TVs, Home Audio & Solar Security Systems.',
    verified: true,
    starRating: 4.9,
    ratingCount: 19,
    reviews: [],
  },
  12: {
    id: 12,
    name: 'Kilimani Office & Living',
    shopName: 'Kilimani Office & Living',
    shopDescription: 'Ergonomic workspace furniture, executive chairs, and modern study decor.',
    verified: true,
    starRating: 4.9,
    ratingCount: 15,
    reviews: [],
  },
  13: {
    id: 13,
    name: 'Rift Valley Cookware Crafts',
    shopName: 'Rift Valley Cookware Crafts',
    shopDescription: 'Authentic 18/10 stainless steel cookware, induction pans & kitchen essentials.',
    verified: true,
    starRating: 5,
    ratingCount: 21,
    reviews: [],
  },
  14: {
    id: 14,
    name: 'Savanna Tech & Solar Solutions',
    shopName: 'Savanna Tech & Solar Solutions',
    shopDescription: 'Commercial blenders, off-grid power solutions and energy-efficient kitchen gear.',
    verified: true,
    starRating: 4.8,
    ratingCount: 14,
    reviews: [],
  },
  15: {
    id: 15,
    name: 'Nairobi Smart Living & Appliances',
    shopName: 'Nairobi Smart Living & Appliances',
    shopDescription: 'Inverter refrigerators, water dispensers and modern kitchen cooling appliances.',
    verified: true,
    starRating: 4.9,
    ratingCount: 17,
    reviews: [],
  },
  16: {
    id: 16,
    name: 'Eldoret Fresh Bedding & Decor',
    shopName: 'Eldoret Fresh Bedding & Decor',
    shopDescription: 'Orthopedic memory foam mattresses, luxury duvet sets and bedroom ergonomics.',
    verified: true,
    starRating: 4.9,
    ratingCount: 12,
    reviews: [],
  },
};

const SEED_SUBSCRIPTION_TIERS: MerchantSubscriptionTier[] = [
  {
    id: 'tier_250',
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
    name: 'Enterprise Scale',
    monthlyFee: 7500,
    yearlyFee: 75000,
    yearlyDiscountPercent: 17,
    maxProducts: -1,
    maxGroupsPerProduct: 50,
    description: 'Unlimited catalog for major retail distributors.',
    features: ['Unlimited products', '50 groups per product', '30-day or yearly active window'],
  },
  {
    id: 'enterprise',
    name: 'Custom Enterprise',
    monthlyFee: 15000,
    yearlyFee: 150000,
    yearlyDiscountPercent: 17,
    maxProducts: -1,
    maxGroupsPerProduct: 100,
    description: 'Custom SLA and limits set by Buyoll Admin.',
    features: ['Unlimited products', 'Up to 100 groups per product', 'Custom SLA'],
  },
];

// Capture module load timestamp once so relative ages (0..7 days) stay consistent across calls
const SESSION_NOW = Date.now();

export function getFallbackHeroAnnouncementCards(): {
  announcements: PlatformAnnouncementSlot[];
  cards: PlatformAnnouncementSlot[];
} {
  const cards = buildSeedHeroCards(SESSION_NOW);
  return { announcements: cards, cards };
}

export function getFallbackAnnouncements(params?: {
  type?: string;
  audience?: string;
  pinnedOnly?: boolean;
  limit?: number;
}): { announcements: Announcement[]; total: number } {
  let items = buildSeedAnnouncements(SESSION_NOW);

  if (params?.type && params.type !== 'ALL') {
    const targetType = params.type.toUpperCase();
    items = items.filter((a) => (a.type || 'ANNOUNCEMENT') === targetType);
  }
  if (params?.audience && params.audience !== 'ALL') {
    const targetAud = params.audience.toUpperCase();
    items = items.filter((a) => (a.audience || 'ALL') === 'ALL' || a.audience === targetAud);
  }
  if (params?.pinnedOnly) {
    items = items.filter((a) => Boolean(a.pinned));
  }

  items.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt);
  });

  const total = items.length;
  const limited = params?.limit ? items.slice(0, Math.max(1, params.limit)) : items;
  return { announcements: limited, total };
}

export function getFallbackProducts(params?: {
  category?: string;
  search?: string;
  vendorId?: number;
  merchantId?: number;
  groupId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}): { products: Product[]; total: number; limit: number; offset: number } {
  if (params?.status === 'draft') {
    return { products: [], total: 0, limit: params.limit || 0, offset: params.offset || 0 };
  }

  let items = buildSeedProducts(SESSION_NOW);

  if (params?.category && params.category !== 'All') {
    items = items.filter((p) => p.category === params.category);
  }

  if (params?.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase();
    items = items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.vendorName.toLowerCase().includes(q) ||
        (p.attributes ? Object.values(p.attributes).some((v) => String(v).toLowerCase().includes(q)) : false)
    );
  }

  const targetVendor = params?.vendorId || params?.merchantId;
  if (targetVendor) {
    items = items.filter((p) => p.vendorId === Number(targetVendor));
  }

  if (params?.groupId) {
    const gid = Number(params.groupId);
    const grp = buildSeedGroups(SESSION_NOW).find((g) => g.id === gid);
    items = grp ? items.filter((p) => p.id === grp.productId) : [];
  }

  const total = items.length;
  const offset = Math.max(0, Number(params?.offset) || 0);
  const limit = Number(params?.limit) > 0 ? Math.min(200, Number(params?.limit)) : 0;
  const paginated = limit > 0 ? items.slice(offset, offset + limit) : items.slice(offset);

  return {
    products: paginated,
    total,
    limit: limit || total,
    offset,
  };
}

export function getFallbackProduct(id: number): { product: Product; groups: ChamaGroup[] } | null {
  const product = buildSeedProducts(SESSION_NOW).find((p) => p.id === Number(id));
  if (!product) return null;
  const groups = buildSeedGroups(SESSION_NOW).filter(
    (g) => g.productId === product.id && (g.status === 'active' || g.status === 'full')
  );
  return { product, groups };
}

export function getFallbackGroups(params?: { productId?: number; status?: string }): { groups: ChamaGroup[] } {
  let groups = buildSeedGroups(SESSION_NOW);
  if (params?.productId) {
    groups = groups.filter((g) => g.productId === Number(params.productId));
  }
  if (params?.status) {
    groups = groups.filter((g) => g.status === params.status);
  }
  return { groups };
}

export function getFallbackGroup(id: number): { group: ChamaGroup } | null {
  const group = buildSeedGroups(SESSION_NOW).find((g) => g.id === Number(id));
  return group ? { group } : null;
}

export function getFallbackSearchProducts(query: string): { products: Product[]; query: string; total: number } {
  const res = getFallbackProducts({ search: query });
  return { products: res.products, query: query.trim().toLowerCase(), total: res.total };
}

export function getFallbackMerchant(merchantId: number): { merchant: User } | null {
  const m = SEED_MERCHANTS[Number(merchantId)];
  if (!m) return null;
  return {
    merchant: {
      role: 'merchant',
      phone: '',
      credit: 0,
      coins: 0,
      points: 0,
      lastActive: SESSION_NOW,
      createdAt: SESSION_NOW - 15 * DAY_MS,
      ...m,
    } as User,
  };
}

export function getFallbackSubscriptionTiers(): { tiers: MerchantSubscriptionTier[] } {
  return { tiers: SEED_SUBSCRIPTION_TIERS };
}
