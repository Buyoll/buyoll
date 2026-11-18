import type { DatabaseSchema } from './db.js';
import type { User } from '../src/types.js';

export const CONTROL_CENTER_SUMMARY_TTL_MS = 45_000;

export interface ControlCenterIndexSnapshot {
  version: number;
  updatedAt: number;
  columns: {
    users: string[];
    payments: string[];
    walletDeposits: string[];
    merchantSubscriptions: string[];
    subscriptionRequests: string[];
    peerLoans: string[];
    groups: string[];
    refundRequests: string[];
    products: string[];
    merchantVerifications: string[];
  };
  counts: {
    usersByRole: Record<string, number>;
    paymentsByStatus: Record<string, number>;
    depositsByStatus: Record<string, number>;
    subscriptionsByStatus: Record<string, number>;
    loansByStatus: Record<string, number>;
    groupsByStatus: Record<string, number>;
    refundsByStatus: Record<string, number>;
    featuredProductIds: number[];
  };
}

export interface ControlCenterSummaryPayload {
  users: {
    total: number;
    members: number;
    merchants: number;
    lenders: number;
    admins: number;
    suspended: number;
    verifiedMerchants: number;
    unavailable?: boolean;
  };
  groups: {
    total: number;
    active: number;
    completed: number;
    unavailable?: boolean;
  };
  payments: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    pendingAmount: number;
    unavailable?: boolean;
  };
  deposits: {
    total: number;
    pending: number;
    approved: number;
    declined: number;
    pendingAmount: number;
    unavailable?: boolean;
  };
  subscriptions: {
    total: number;
    active: number;
    pending: number;
    declined: number;
    expired: number;
    unavailable?: boolean;
  };
  verifications: {
    total: number;
    pending: number;
    verified: number;
    declined: number;
    unavailable?: boolean;
  };
  refunds: {
    total: number;
    requested: number;
    approved: number;
    completed: number;
    unavailable?: boolean;
  };
  loans: {
    total: number;
    pending: number;
    funded: number;
    repaid: number;
    defaulted: number;
    unavailable?: boolean;
  };
  wallets: {
    totalCredit: number;
    totalCoins: number;
    totalPoints: number;
    totalAccounts: number;
    unavailable?: boolean;
  };
  products: {
    total: number;
    live: number;
    featured: number;
    unavailable?: boolean;
  };
  moderation: {
    totalChatMessages: number;
    flaggedMessages: number;
    moderationEvents: number;
    unavailable?: boolean;
  };
  audit: {
    totalLogs: number;
    unavailable?: boolean;
  };
  unavailableFields: string[];
  cache: {
    cachedAt: number;
    ttlMs: number;
    cacheHit: boolean;
  };
}

interface CacheEntry {
  summary: Omit<ControlCenterSummaryPayload, 'cache'>;
  cachedAt: number;
}

const summaryCacheByDb = new Map<string, CacheEntry>();

export function invalidateControlCenterSummaryCache(dbKey?: string): void {
  if (dbKey) {
    summaryCacheByDb.delete(dbKey);
  } else {
    summaryCacheByDb.clear();
  }
}

export function buildControlCenterIndexSnapshot(db: DatabaseSchema): ControlCenterIndexSnapshot {
  const usersByRole: Record<string, number> = { member: 0, merchant: 0, lender: 0, admin: 0 };
  for (const u of db.users || []) {
    if (u.isDisabled) continue;
    const role = String(u.activeRole || u.role || 'member');
    usersByRole[role] = (usersByRole[role] || 0) + 1;
  }

  const paymentsByStatus: Record<string, number> = {};
  for (const p of db.payments || []) {
    const st = String(p.status || 'pending');
    paymentsByStatus[st] = (paymentsByStatus[st] || 0) + 1;
  }

  const depositsByStatus: Record<string, number> = {};
  for (const d of db.walletDeposits || []) {
    const st = String(d.status || 'pending');
    depositsByStatus[st] = (depositsByStatus[st] || 0) + 1;
  }

  const subscriptionsByStatus: Record<string, number> = {};
  const subRequests = db.subscriptionRequests || [];
  if (subRequests.length > 0) {
    for (const r of subRequests) {
      const st = r.status === 'approved' ? 'active' : r.status === 'rejected' ? 'declined' : String(r.status || 'pending');
      subscriptionsByStatus[st] = (subscriptionsByStatus[st] || 0) + 1;
    }
  } else {
    for (const s of db.merchantSubscriptions || []) {
      const st = String(s.status || 'pending');
      subscriptionsByStatus[st] = (subscriptionsByStatus[st] || 0) + 1;
    }
  }

  const loansByStatus: Record<string, number> = {};
  for (const l of db.peerLoans || []) {
    const st = String(l.status || 'pending');
    loansByStatus[st] = (loansByStatus[st] || 0) + 1;
  }

  const groupsByStatus: Record<string, number> = {};
  for (const g of db.groups || []) {
    const st = String(g.status || 'active');
    groupsByStatus[st] = (groupsByStatus[st] || 0) + 1;
  }

  const refundsByStatus: Record<string, number> = {};
  for (const r of db.refundRequests || []) {
    const st = String(r.status || 'requested');
    refundsByStatus[st] = (refundsByStatus[st] || 0) + 1;
  }

  const featuredProductIds: number[] = [];
  for (const p of db.products || []) {
    if (p.isFeatured) featuredProductIds.push(p.id);
  }

  return {
    version: 1,
    updatedAt: Date.now(),
    columns: {
      users: ['role', 'activeRole', 'isDisabled', 'isSuspended', 'verified'],
      payments: ['status', 'code', 'createdAt', 'userId'],
      walletDeposits: ['status', 'createdAt', 'userId'],
      merchantSubscriptions: ['status', 'merchantId', 'expiresAt'],
      subscriptionRequests: ['status', 'merchantId', 'createdAt'],
      peerLoans: ['status', 'groupId', 'borrowerId'],
      groups: ['status', 'productId', 'vendorId'],
      refundRequests: ['status', 'userId'],
      products: ['isFeatured', 'live', 'vendorId', 'category'],
      merchantVerifications: ['status', 'merchantId'],
    },
    counts: {
      usersByRole,
      paymentsByStatus,
      depositsByStatus,
      subscriptionsByStatus,
      loansByStatus,
      groupsByStatus,
      refundsByStatus,
      featuredProductIds,
    },
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export function parsePaginationQuery(query: Record<string, any>, defaultLimit = 20, maxLimit = 100): PaginationParams {
  const rawPage = Number(query?.page);
  const rawLimit = Number(query?.limit);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(maxLimit, Math.floor(rawLimit)) : defaultLimit;
  return { page, limit };
}

export function paginateList<T>(items: T[], page: number, limit: number): { items: T[]; pagination: PaginationMeta } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * limit;
  const sliced = items.slice(start, start + limit);
  return {
    items: sliced,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
    },
  };
}

export function projectAdminUserRow(u: User) {
  return {
    id: u.id,
    name: u.name,
    username: u.usernameDisplay || u.username || '',
    phone: u.phone || '',
    email: u.email || '',
    role: u.activeRole || u.role,
    activeRole: u.activeRole || u.role,
    platformId: u.platformId || '',
    shopName: u.shopName || '',
    verified: Boolean(u.verified),
    merchantVerificationNotes: u.merchantVerificationNotes || u.verificationNotes || '',
    points: Number(u.points || 0),
    coins: Number(u.coins || 0),
    credit: Number(u.credit || 0),
    isSuspended: Boolean(u.isSuspended),
    isDisabled: Boolean(u.isDisabled),
    createdAt: u.createdAt,
  };
}

export async function getControlCenterSummary(
  db: DatabaseSchema,
  dbKey: string,
  options: { bypassCache?: boolean } = {}
): Promise<ControlCenterSummaryPayload> {
  const now = Date.now();
  if (!options.bypassCache) {
    const cached = summaryCacheByDb.get(dbKey);
    if (cached && now - cached.cachedAt < CONTROL_CENTER_SUMMARY_TTL_MS) {
      return {
        ...cached.summary,
        cache: {
          cachedAt: cached.cachedAt,
          ttlMs: CONTROL_CENTER_SUMMARY_TTL_MS,
          cacheHit: true,
        },
      };
    }
  }

  const unavailableFields: string[] = [];

  const [
    usersRes,
    groupsRes,
    paymentsRes,
    depositsRes,
    subsRes,
    verifsRes,
    refundsRes,
    loansRes,
    walletsRes,
    productsRes,
    modRes,
    auditRes,
  ] = await Promise.allSettled([
    Promise.resolve().then(() => {
      let total = 0;
      let members = 0;
      let merchants = 0;
      let lenders = 0;
      let admins = 0;
      let suspended = 0;
      let verifiedMerchants = 0;
      for (const u of db.users || []) {
        if (u.isDisabled) continue;
        total++;
        const r = u.activeRole || u.role;
        if (r === 'merchant') {
          merchants++;
          if (u.verified) verifiedMerchants++;
        } else if (r === 'lender') {
          lenders++;
        } else if (r === 'admin') {
          admins++;
        } else {
          members++;
        }
        if (u.isSuspended) suspended++;
      }
      return { total, members, merchants, lenders, admins, suspended, verifiedMerchants };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let active = 0;
      let completed = 0;
      for (const g of db.groups || []) {
        total++;
        if (g.status === 'completed') completed++;
        else active++;
      }
      return { total, active, completed };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let pending = 0;
      let approved = 0;
      let rejected = 0;
      let pendingAmount = 0;
      for (const p of db.payments || []) {
        total++;
        if (p.status === 'pending') {
          pending++;
          pendingAmount += Number(p.amount || 0);
        } else if (p.status === 'approved') {
          approved++;
        } else {
          rejected++;
        }
      }
      return { total, pending, approved, rejected, pendingAmount };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let pending = 0;
      let approved = 0;
      let declined = 0;
      let pendingAmount = 0;
      for (const d of db.walletDeposits || []) {
        total++;
        if (d.status === 'pending') {
          pending++;
          pendingAmount += Number(d.amount || 0);
        } else if (d.status === 'approved') {
          approved++;
        } else {
          declined++;
        }
      }
      return { total, pending, approved, declined, pendingAmount };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let active = 0;
      let pending = 0;
      let declined = 0;
      let expired = 0;
      const seenKeys = new Set<string>();
      for (const r of db.subscriptionRequests || []) {
        total++;
        seenKeys.add(r.id);
        if (r.mpesaCode) seenKeys.add(`code:${r.mpesaCode}`);
        const st = String(r.status || 'pending').toLowerCase();
        if (st === 'approved' || st === 'active') active++;
        else if (st === 'rejected' || st === 'declined') declined++;
        else if (st === 'expired') expired++;
        else pending++;
      }
      for (const s of db.merchantSubscriptions || []) {
        if (seenKeys.has(s.id) || (s.paymentCode && seenKeys.has(`code:${s.paymentCode}`))) continue;
        total++;
        if (s.status === 'active') active++;
        else if (s.status === 'declined') declined++;
        else if (s.status === 'expired') expired++;
        else pending++;
      }
      return { total, active, pending, declined, expired };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let pending = 0;
      let verified = 0;
      let declined = 0;
      for (const v of db.merchantVerifications || []) {
        total++;
        if (v.status === 'verified') verified++;
        else if (v.status === 'declined') declined++;
        else pending++;
      }
      return { total, pending, verified, declined };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let requested = 0;
      let approved = 0;
      let completed = 0;
      for (const r of db.refundRequests || []) {
        total++;
        if (r.status === 'completed') completed++;
        else if (r.status === 'approved') approved++;
        else if (r.status === 'requested') requested++;
      }
      return { total, requested, approved, completed };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let pending = 0;
      let funded = 0;
      let repaid = 0;
      let defaulted = 0;
      for (const l of db.peerLoans || []) {
        total++;
        if (l.status === 'pending') pending++;
        else if (l.status === 'funded') funded++;
        else if (l.status === 'repaid') repaid++;
        else if (l.status === 'defaulted') defaulted++;
      }
      return { total, pending, funded, repaid, defaulted };
    }),
    Promise.resolve().then(() => {
      let totalCredit = 0;
      let totalCoins = 0;
      let totalPoints = 0;
      let totalAccounts = 0;
      for (const u of db.users || []) {
        totalAccounts++;
        totalCredit += Number(u.credit || 0);
        totalCoins += Number(u.coins || 0);
        totalPoints += Number(u.points || 0);
      }
      return { totalCredit, totalCoins, totalPoints, totalAccounts };
    }),
    Promise.resolve().then(() => {
      let total = 0;
      let live = 0;
      let featured = 0;
      for (const p of db.products || []) {
        total++;
        if (p.live !== false) live++;
        if (p.isFeatured) featured++;
      }
      return { total, live, featured };
    }),
    Promise.resolve().then(() => {
      let totalChatMessages = 0;
      let flaggedMessages = 0;
      for (const g of db.groups || []) {
        for (const msg of g.chat || []) {
          totalChatMessages++;
          if ((msg as any).isFlagged) flaggedMessages++;
        }
      }
      return {
        totalChatMessages,
        flaggedMessages,
        moderationEvents: (db.chatModerationLogs || []).length,
      };
    }),
    Promise.resolve().then(() => ({
      totalLogs: (db.auditLogs || []).length,
    })),
  ]);

  const users = usersRes.status === 'fulfilled'
    ? usersRes.value
    : (unavailableFields.push('users'), { total: 0, members: 0, merchants: 0, lenders: 0, admins: 0, suspended: 0, verifiedMerchants: 0, unavailable: true });

  const groups = groupsRes.status === 'fulfilled'
    ? groupsRes.value
    : (unavailableFields.push('groups'), { total: 0, active: 0, completed: 0, unavailable: true });

  const payments = paymentsRes.status === 'fulfilled'
    ? paymentsRes.value
    : (unavailableFields.push('payments'), { total: 0, pending: 0, approved: 0, rejected: 0, pendingAmount: 0, unavailable: true });

  const deposits = depositsRes.status === 'fulfilled'
    ? depositsRes.value
    : (unavailableFields.push('deposits'), { total: 0, pending: 0, approved: 0, declined: 0, pendingAmount: 0, unavailable: true });

  const subscriptions = subsRes.status === 'fulfilled'
    ? subsRes.value
    : (unavailableFields.push('subscriptions'), { total: 0, active: 0, pending: 0, declined: 0, expired: 0, unavailable: true });

  const verifications = verifsRes.status === 'fulfilled'
    ? verifsRes.value
    : (unavailableFields.push('verifications'), { total: 0, pending: 0, verified: 0, declined: 0, unavailable: true });

  const refunds = refundsRes.status === 'fulfilled'
    ? refundsRes.value
    : (unavailableFields.push('refunds'), { total: 0, requested: 0, approved: 0, completed: 0, unavailable: true });

  const loans = loansRes.status === 'fulfilled'
    ? loansRes.value
    : (unavailableFields.push('loans'), { total: 0, pending: 0, funded: 0, repaid: 0, defaulted: 0, unavailable: true });

  const wallets = walletsRes.status === 'fulfilled'
    ? walletsRes.value
    : (unavailableFields.push('wallets'), { totalCredit: 0, totalCoins: 0, totalPoints: 0, totalAccounts: 0, unavailable: true });

  const products = productsRes.status === 'fulfilled'
    ? productsRes.value
    : (unavailableFields.push('products'), { total: 0, live: 0, featured: 0, unavailable: true });

  const moderation = modRes.status === 'fulfilled'
    ? modRes.value
    : (unavailableFields.push('moderation'), { totalChatMessages: 0, flaggedMessages: 0, moderationEvents: 0, unavailable: true });

  const audit = auditRes.status === 'fulfilled'
    ? auditRes.value
    : (unavailableFields.push('audit'), { totalLogs: 0, unavailable: true });

  const summaryBody: Omit<ControlCenterSummaryPayload, 'cache'> = {
    users,
    groups,
    payments,
    deposits,
    subscriptions,
    verifications,
    refunds,
    loans,
    wallets,
    products,
    moderation,
    audit,
    unavailableFields,
  };

  summaryCacheByDb.set(dbKey, { summary: summaryBody, cachedAt: now });

  return {
    ...summaryBody,
    cache: {
      cachedAt: now,
      ttlMs: CONTROL_CENTER_SUMMARY_TTL_MS,
      cacheHit: false,
    },
  };
}
