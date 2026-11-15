import crypto from 'crypto';
import type { DatabaseSchema } from './db.js';
import type { User, UserRole, WalletLedgerCategory, WalletLedgerRecord, WalletRecord } from '../src/types.js';
import { fromCents, toCents } from './config.js';
import { emitPlatformEvent } from './events.js';

export function normalizeRoleValue(role?: string | null): UserRole {
  if (role === 'merchant' || role === 'lender' || role === 'admin') return role;
  return 'member';
}

export function findPlatformAdminUser(db: DatabaseSchema): User | undefined {
  return (db.users || []).find(
    (u) =>
      !u.isDisabled &&
      !u.isSuspended &&
      (u.activeRole === 'admin' || u.role === 'admin' || (Array.isArray(u.roles) && u.roles.includes('admin')))
  );
}

export function getWalletId(userId: number, role: UserRole): string {
  return `wal_${userId}_${role}`;
}

export function ensureWallet(db: DatabaseSchema, user: User, roleInput?: UserRole): WalletRecord {
  if (!db.wallets) db.wallets = [];
  if (!db.walletLedger) db.walletLedger = [];

  const role = normalizeRoleValue(roleInput || user.activeRole || user.role);
  const walletId = getWalletId(user.id, role);
  let wallet = db.wallets.find((w) => w.id === walletId || (w.userId === user.id && w.role === role));
  const now = Date.now();

  if (!wallet) {
    const existingRoleCredit =
      user.roleWallets?.[role]?.credit ??
      (normalizeRoleValue(user.activeRole || user.role) === role ? user.credit : 0) ??
      0;
    const openingCents = Math.max(0, toCents(existingRoleCredit));
    wallet = {
      id: walletId,
      userId: user.id,
      role,
      balanceCents: openingCents,
      createdAt: now,
      updatedAt: now,
    };
    db.wallets.push(wallet);

    const hasLedgerForWallet = db.walletLedger.some((l) => l.walletId === walletId);
    if (openingCents > 0 && !hasLedgerForWallet) {
      db.walletLedger.push({
        id: `wled_${now}_${crypto.randomBytes(4).toString('hex')}`,
        walletId,
        userId: user.id,
        role,
        direction: 'CREDIT',
        amountCents: openingCents,
        balanceAfterCents: openingCents,
        category: 'MIGRATION_OPENING_BALANCE',
        idempotencyKey: `opening_${walletId}`,
        note: `Opening wallet balance for ${role} role`,
        createdAt: now,
      });
    }
  }

  syncUserWalletProjection(db, user, role);
  return wallet;
}

export function syncUserWalletProjection(db: DatabaseSchema, user: User, roleInput?: UserRole): void {
  const role = normalizeRoleValue(roleInput || user.activeRole || user.role);
  const wallet = (db.wallets || []).find((w) => w.userId === user.id && w.role === role);
  const balanceKes = wallet ? fromCents(wallet.balanceCents) : Math.max(0, Number(user.roleWallets?.[role]?.credit ?? user.credit ?? 0));

  if (!user.roleWallets) user.roleWallets = {};
  if (!user.roleWallets[role]) {
    user.roleWallets[role] = {
      credit: balanceKes,
      nonWithdrawableBalance: Number(user.restrictedLoanBalance ?? user.nonWithdrawableBalance ?? 0),
      coins: user.coins || 0,
      points: user.points || 0,
    };
  } else {
    user.roleWallets[role]!.credit = balanceKes;
  }
  user.roleWallets[role]!.balance = balanceKes;

  if (normalizeRoleValue(user.activeRole || user.role) === role) {
    user.credit = balanceKes;
  }
}

export function getWalletBalanceCents(db: DatabaseSchema, user: User, roleInput?: UserRole): number {
  const wallet = ensureWallet(db, user, roleInput);
  return wallet.balanceCents;
}

export function assertWalletLedgerConsistency(db: DatabaseSchema, walletId: string): void {
  const wallet = (db.wallets || []).find((w) => w.id === walletId);
  if (!wallet) return;
  const rows = (db.walletLedger || []).filter((r) => r.walletId === walletId);
  const netCents = rows.reduce((sum, r) => {
    return sum + (r.direction === 'CREDIT' ? r.amountCents : -r.amountCents);
  }, 0);
  if (netCents !== wallet.balanceCents) {
    throw new Error(
      `Wallet ledger reconciliation mismatch for ${walletId}: wallet=${wallet.balanceCents}, ledgerNet=${netCents}`
    );
  }
}

export function creditWalletCents(
  db: DatabaseSchema,
  params: {
    userId: number;
    role: UserRole;
    amountCents: number;
    category: WalletLedgerCategory;
    referenceId?: string;
    idempotencyKey?: string;
    note: string;
    actorId?: number;
  }
): { wallet: WalletRecord; entry: WalletLedgerRecord; deduplicated: boolean } {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw { status: 400, code: 'INVALID_AMOUNT', message: 'Wallet credit amount must be a positive integer.' };
  }
  const user = db.users.find((u) => u.id === params.userId);
  if (!user) {
    throw { status: 404, code: 'USER_NOT_FOUND', message: 'Target user not found for wallet credit.' };
  }
  if (!db.walletLedger) db.walletLedger = [];
  const wallet = ensureWallet(db, user, params.role);

  if (params.idempotencyKey) {
    const existing = db.walletLedger.find(
      (l) => l.walletId === wallet.id && l.idempotencyKey === params.idempotencyKey
    );
    if (existing) {
      return { wallet, entry: existing, deduplicated: true };
    }
  }

  const now = Date.now();
  wallet.balanceCents += params.amountCents;
  wallet.updatedAt = now;

  const entry: WalletLedgerRecord = {
    id: `wled_${now}_${crypto.randomBytes(4).toString('hex')}`,
    walletId: wallet.id,
    userId: user.id,
    role: params.role,
    direction: 'CREDIT',
    amountCents: params.amountCents,
    balanceAfterCents: wallet.balanceCents,
    category: params.category,
    referenceId: params.referenceId,
    idempotencyKey: params.idempotencyKey,
    note: params.note,
    actorId: params.actorId,
    createdAt: now,
  };
  db.walletLedger.unshift(entry);
  syncUserWalletProjection(db, user, params.role);
  assertWalletLedgerConsistency(db, wallet.id);

  emitPlatformEvent(
    'user.wallet.updated',
    { userId: user.id, role: params.role, balanceKes: fromCents(wallet.balanceCents), balanceCents: wallet.balanceCents },
    [user.id]
  );

  return { wallet, entry, deduplicated: false };
}

export function debitWalletCents(
  db: DatabaseSchema,
  params: {
    userId: number;
    role: UserRole;
    amountCents: number;
    category: WalletLedgerCategory;
    referenceId?: string;
    idempotencyKey?: string;
    note: string;
    actorId?: number;
  }
): { wallet: WalletRecord; entry: WalletLedgerRecord; deduplicated: boolean } {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw { status: 400, code: 'INVALID_AMOUNT', message: 'Wallet debit amount must be a positive integer.' };
  }
  const user = db.users.find((u) => u.id === params.userId);
  if (!user) {
    throw { status: 404, code: 'USER_NOT_FOUND', message: 'User not found for wallet debit.' };
  }
  if (!db.walletLedger) db.walletLedger = [];
  const wallet = ensureWallet(db, user, params.role);

  if (params.idempotencyKey) {
    const existing = db.walletLedger.find(
      (l) => l.walletId === wallet.id && l.idempotencyKey === params.idempotencyKey
    );
    if (existing) {
      return { wallet, entry: existing, deduplicated: true };
    }
  }

  if (wallet.balanceCents < params.amountCents) {
    throw {
      status: 400,
      code: 'INSUFFICIENT_BALANCE',
      message: `Insufficient ${params.role} wallet balance. Available: KSh ${fromCents(wallet.balanceCents).toLocaleString()}, required: KSh ${fromCents(params.amountCents).toLocaleString()}.`,
    };
  }

  const now = Date.now();
  wallet.balanceCents -= params.amountCents;
  wallet.updatedAt = now;

  const entry: WalletLedgerRecord = {
    id: `wled_${now}_${crypto.randomBytes(4).toString('hex')}`,
    walletId: wallet.id,
    userId: user.id,
    role: params.role,
    direction: 'DEBIT',
    amountCents: params.amountCents,
    balanceAfterCents: wallet.balanceCents,
    category: params.category,
    referenceId: params.referenceId,
    idempotencyKey: params.idempotencyKey,
    note: params.note,
    actorId: params.actorId,
    createdAt: now,
  };
  db.walletLedger.unshift(entry);
  syncUserWalletProjection(db, user, params.role);
  assertWalletLedgerConsistency(db, wallet.id);

  emitPlatformEvent(
    'user.wallet.updated',
    { userId: user.id, role: params.role, balanceKes: fromCents(wallet.balanceCents), balanceCents: wallet.balanceCents },
    [user.id]
  );

  return { wallet, entry, deduplicated: false };
}

export function transferBetweenWalletsCents(
  db: DatabaseSchema,
  params: {
    fromUserId: number;
    fromRole: UserRole;
    toUserId: number;
    toRole: UserRole;
    amountCents: number;
    debitCategory: WalletLedgerCategory;
    creditCategory: WalletLedgerCategory;
    referenceId?: string;
    idempotencyKey?: string;
    note: string;
    actorId?: number;
  }
): {
  debitEntry: WalletLedgerRecord;
  creditEntry: WalletLedgerRecord;
  fromWallet: WalletRecord;
  toWallet: WalletRecord;
} {
  const debitRes = debitWalletCents(db, {
    userId: params.fromUserId,
    role: params.fromRole,
    amountCents: params.amountCents,
    category: params.debitCategory,
    referenceId: params.referenceId,
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:debit` : undefined,
    note: params.note,
    actorId: params.actorId,
  });
  const creditRes = creditWalletCents(db, {
    userId: params.toUserId,
    role: params.toRole,
    amountCents: params.amountCents,
    category: params.creditCategory,
    referenceId: params.referenceId,
    idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}:credit` : undefined,
    note: params.note,
    actorId: params.actorId,
  });
  return {
    debitEntry: debitRes.entry,
    creditEntry: creditRes.entry,
    fromWallet: debitRes.wallet,
    toWallet: creditRes.wallet,
  };
}
