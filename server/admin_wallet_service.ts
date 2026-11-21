import crypto from 'crypto';
import type { DatabaseSchema } from './db.js';
import { logAudit } from './db.js';
import type {
  AdminExportJob,
  IncomeSource,
  PlatformIncomeRecord,
  ReconciliationReport,
  UserRole,
  WalletReconciliationMismatch,
} from '../src/types.js';
import { fromCents, getEatDateParts, toCents } from './config.js';
import { creditWalletCents, findPlatformAdminUser, normalizeRoleValue } from './wallet_service.js';

export const ALL_INCOME_SOURCES: IncomeSource[] = [
  'SUBSCRIPTION',
  'FEATURED',
  'LOAN_FEE',
  'TRIP_DATING',
  'AIRBUS_PLUS',
  'ADVERTISING',
  'OTHER',
];

export const INCOME_SOURCE_LABELS: Record<IncomeSource, string> = {
  SUBSCRIPTION: 'Merchant Subscriptions',
  FEATURED: 'Featured Placements',
  LOAN_FEE: 'Group Loan Commission Fees',
  TRIP_DATING: 'Trip Dating Packages',
  AIRBUS_PLUS: 'AirbusPlus Membership Pass',
  ADVERTISING: 'Sponsored Advertising',
  OTHER: 'Other Platform Revenue',
};

export function normalizeIncomeSource(raw?: string | null): IncomeSource {
  const upper = String(raw || 'OTHER').trim().toUpperCase();
  if ((ALL_INCOME_SOURCES as string[]).includes(upper)) {
    return upper as IncomeSource;
  }
  return 'OTHER';
}

export function getEatTimeKeys(utcMs = Date.now()): {
  eatDateKey: string;
  eatHourKey: string;
  eatMonthKey: string;
  eatYearKey: string;
  eatTimestamp: string;
} {
  const { dateKey } = getEatDateParts(utcMs); // YYYY-MM-DD in Africa/Nairobi
  const eatDate = new Date(utcMs + 3 * 60 * 60 * 1000);
  const hh = String(eatDate.getUTCHours()).padStart(2, '0');
  const mm = String(eatDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(eatDate.getUTCSeconds()).padStart(2, '0');
  const eatHourKey = `${dateKey} ${hh}:00`;
  const eatMonthKey = dateKey.slice(0, 7);
  const eatYearKey = dateKey.slice(0, 4);
  return {
    eatDateKey: dateKey,
    eatHourKey,
    eatMonthKey,
    eatYearKey,
    eatTimestamp: `${dateKey} ${hh}:${mm}:${ss} EAT`,
  };
}

/**
 * Checks whether an M-Pesa transaction code is already claimed in pending or approved
 * state anywhere across deposits, payments, subscription requests, or merchant subscriptions.
 */
export function findDuplicateMpesaCodeInTx(
  db: DatabaseSchema,
  rawCode: string,
  excludeEntityId?: string | number | Array<string | number | null | undefined>
): { duplicate: boolean; entity?: string } {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { duplicate: false };

  const excludeSet = new Set<string>(
    (Array.isArray(excludeEntityId) ? excludeEntityId : [excludeEntityId])
      .filter((v): v is string | number => v !== undefined && v !== null && String(v) !== '')
      .map((v) => String(v))
  );

  for (const dep of db.walletDeposits || []) {
    if (excludeSet.has(String(dep.id))) continue;
    if (String(dep.mpesaCode || '').trim().toUpperCase() === code && (dep.status === 'pending' || dep.status === 'approved')) {
      return { duplicate: true, entity: `wallet deposit #${dep.id} (${dep.status})` };
    }
  }

  for (const p of db.payments || []) {
    if (excludeSet.has(String(p.id))) continue;
    if (String(p.code || '').trim().toUpperCase() === code && (p.status === 'pending' || p.status === 'approved')) {
      return { duplicate: true, entity: `payment #${p.id} (${p.status})` };
    }
  }

  for (const sr of db.subscriptionRequests || []) {
    if (excludeSet.has(String(sr.id))) continue;
    if (String(sr.mpesaCode || '').trim().toUpperCase() === code && (sr.status === 'pending' || sr.status === 'approved')) {
      return { duplicate: true, entity: `subscription request ${sr.id} (${sr.status})` };
    }
  }

  for (const ms of db.merchantSubscriptions || []) {
    if (excludeSet.has(String(ms.id))) continue;
    if (
      String(ms.paymentCode || '').trim().toUpperCase() === code &&
      (ms.status === 'pending' || ms.status === 'active')
    ) {
      return { duplicate: true, entity: `subscription ${ms.id} (${ms.status})` };
    }
  }

  return { duplicate: false };
}

export function recordIncomeInTx(
  db: DatabaseSchema,
  params: {
    source: IncomeSource;
    paymentChannel: 'WALLET' | 'MPESA_DIRECT';
    amountCents: number;
    userId?: number | null;
    userName?: string;
    referenceId: string;
    description: string;
    idempotencyKey: string;
    actorId?: number | null;
    createdAt?: number;
    creditAdminWalletIfDirect?: boolean;
  }
): { record: PlatformIncomeRecord; deduplicated: boolean } {
  if (!db.incomeLedger) db.incomeLedger = [];
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw { status: 400, code: 'INVALID_AMOUNT', message: 'Income amount must be a positive integer.' };
  }

  const existing = db.incomeLedger.find((r) => r.idempotencyKey === params.idempotencyKey);
  if (existing) {
    return { record: existing, deduplicated: true };
  }

  const createdAt = params.createdAt ?? Date.now();
  const keys = getEatTimeKeys(createdAt);
  const record: PlatformIncomeRecord = {
    id: `inc_${createdAt}_${crypto.randomBytes(4).toString('hex')}`,
    source: params.source,
    paymentChannel: params.paymentChannel,
    amountCents: params.amountCents,
    currency: 'KES',
    userId: params.userId ?? null,
    userName: params.userName,
    referenceId: params.referenceId,
    description: params.description,
    eatDateKey: keys.eatDateKey,
    eatHourKey: keys.eatHourKey,
    eatMonthKey: keys.eatMonthKey,
    eatYearKey: keys.eatYearKey,
    idempotencyKey: params.idempotencyKey,
    actorId: params.actorId ?? null,
    createdAt,
  };

  db.incomeLedger.unshift(record);

  // If money arrived directly via external M-Pesa (not already sitting in a user's Buyoll wallet)
  // and caller requests syncing it into the platform admin wallet ledger, credit admin wallet idempotently.
  if (params.creditAdminWalletIfDirect && params.paymentChannel === 'MPESA_DIRECT') {
    const adminUser = findPlatformAdminUser(db);
    if (adminUser) {
      const cat =
        params.source === 'SUBSCRIPTION'
          ? 'SUBSCRIPTION_REVENUE'
          : params.source === 'FEATURED'
          ? 'FEATURED_REVENUE'
          : params.source === 'LOAN_FEE'
          ? 'PLATFORM_FEE'
          : 'PROMOTION_REVENUE';
      creditWalletCents(db, {
        userId: adminUser.id,
        role: 'admin',
        amountCents: params.amountCents,
        category: cat,
        referenceId: params.referenceId,
        idempotencyKey: `inc_adm_${params.idempotencyKey}`,
        note: `[${params.source}] ${params.description}`,
        actorId: params.actorId ?? adminUser.id,
      });
    }
  }

  return { record, deduplicated: false };
}

export function runWalletReconciliationInTx(
  db: DatabaseSchema,
  trigger: ReconciliationReport['trigger'] = 'manual'
): ReconciliationReport {
  const now = Date.now();
  const { eatTimestamp } = getEatTimeKeys(now);
  if (!db.reconciliationReports) db.reconciliationReports = [];

  // 1. Verify every wallet's balanceCents === sum(credits - debits) in walletLedger
  const walletMismatches: WalletReconciliationMismatch[] = [];
  for (const w of db.wallets || []) {
    const rows = (db.walletLedger || []).filter((r) => r.walletId === w.id);
    const ledgerNetCents = rows.reduce(
      (sum, r) => sum + (r.direction === 'CREDIT' ? r.amountCents : -r.amountCents),
      0
    );
    if (ledgerNetCents !== w.balanceCents) {
      walletMismatches.push({
        walletId: w.id,
        userId: w.userId,
        role: w.role,
        walletBalanceCents: w.balanceCents,
        ledgerNetCents,
        diffCents: w.balanceCents - ledgerNetCents,
      });
    }
  }

  // 2. Compute cashflow conservation totals
  // Pre-Migration-009 historical deposits were already folded into user balances before
  // `MIGRATION_OPENING_BALANCE` rows were created and do not have `DEPOSIT` rows in walletLedger.
  // Only count approved deposits backed by a `DEPOSIT` ledger entry (or approved post-Migration-009).
  const ledgerDepositRefs = new Set<string>();
  for (const l of db.walletLedger || []) {
    if (l.category === 'DEPOSIT' && l.direction === 'CREDIT') {
      if (l.referenceId) ledgerDepositRefs.add(String(l.referenceId).trim().toUpperCase());
      if (l.idempotencyKey) ledgerDepositRefs.add(String(l.idempotencyKey).trim());
    }
  }
  const mig009AppliedAt =
    (db.migrationsApplied || []).find((m) => m.id === '009_wallet_ledger_and_rbac_indexes')?.appliedAt || 0;

  let approvedDepositsCents = 0;
  for (const dep of db.walletDeposits || []) {
    if (dep.status === 'approved') {
      const refCode = String(dep.mpesaCode || '').trim().toUpperCase();
      const ik = `dep_${dep.id}_${dep.mpesaCode}`;
      const hasLedgerEntry = ledgerDepositRefs.has(refCode) || ledgerDepositRefs.has(ik);
      const isPostMig009 = mig009AppliedAt > 0 && Number(dep.processedAt || dep.createdAt || 0) >= mig009AppliedAt;
      if (hasLedgerEntry || isPostMig009 || (db.walletLedger || []).length === 0) {
        approvedDepositsCents += toCents(dep.amount || 0);
      }
    }
  }

  // Track non-deposit ledger flows so historical/seeded/loan/group transactions remain balanced
  let openingUserWalletCents = 0;
  let groupSpentFromWalletCents = 0;
  let internalStoreCreditsCents = 0;
  let refundCreditsCents = 0;
  let loanFundedDebitCents = 0;

  for (const l of db.walletLedger || []) {
    if (l.role === 'admin') continue;
    if (l.category === 'MIGRATION_OPENING_BALANCE' && l.direction === 'CREDIT') {
      openingUserWalletCents += l.amountCents;
    } else if (l.category === 'GROUP_INSTALLMENT' && l.direction === 'DEBIT') {
      groupSpentFromWalletCents += l.amountCents;
    } else if (l.category === 'ADMIN_ADJUSTMENT' && l.direction === 'CREDIT') {
      internalStoreCreditsCents += l.amountCents;
    } else if (l.category === 'ADMIN_ADJUSTMENT' && l.direction === 'DEBIT') {
      groupSpentFromWalletCents += l.amountCents;
    } else if (l.category === 'REFUND' && l.direction === 'CREDIT') {
      refundCreditsCents += l.amountCents;
    } else if (l.category === 'LOAN_FUNDING' && l.direction === 'DEBIT') {
      loanFundedDebitCents += l.amountCents;
    }
  }

  // Special external refunds paid out / approved outside internal store credits
  let approvedSpecialRefundsCents = 0;
  for (const sr of db.specialRefundCredits || []) {
    if (sr.kind === 'SPECIAL_EXTERNAL_REFUND') {
      approvedSpecialRefundsCents += sr.amountCents;
    } else {
      internalStoreCreditsCents += sr.amountCents;
    }
  }
  for (const rr of db.refundRequests || []) {
    if (rr.status === 'approved' || rr.status === 'completed') {
      // Only external payouts reduce cash held; if matched in specialRefundCredits, avoid double count
      const alreadyTracked = (db.specialRefundCredits || []).some((s) => s.refundRequestId === rr.id);
      if (!alreadyTracked) {
        approvedSpecialRefundsCents += toCents(rr.eligibleRefundAmount || rr.amountPaid || 0);
      }
    }
  }

  let nonAdminAvailableHeldCents = 0;
  let platformWalletBalanceCents = 0;
  for (const w of db.wallets || []) {
    if (w.role === 'admin') {
      platformWalletBalanceCents += w.balanceCents;
    } else {
      nonAdminAvailableHeldCents += w.balanceCents;
    }
  }

  let restrictedHeldCents = 0;
  for (const u of db.users || []) {
    if (u.isDisabled) continue;
    restrictedHeldCents += toCents(Number(u.restrictedLoanBalance || 0));
  }

  // Account for pending escrow holds (debited from merchant wallet, not yet moved to admin revenue or refunded)
  let pendingFeaturedEscrowCents = 0;
  for (const fr of db.featuredRequests || []) {
    if (fr.status === 'PENDING_APPROVAL') {
      pendingFeaturedEscrowCents += Number(fr.amountPaidCents || 0);
    }
  }

  let pendingSubEscrowCents = 0;
  for (const ms of db.merchantSubscriptions || []) {
    if (ms.status === 'pending' && ms.paymentMethod === 'wallet_credit') {
      pendingSubEscrowCents += toCents(ms.amount || 0);
    }
  }

  let walletFundedRevenueCents = 0;
  let directMpesaRevenueCents = 0;
  for (const inc of db.incomeLedger || []) {
    if (inc.paymentChannel === 'MPESA_DIRECT') {
      directMpesaRevenueCents += inc.amountCents;
    } else {
      walletFundedRevenueCents += inc.amountCents;
    }
  }
  const totalIncomeRevenueCents = walletFundedRevenueCents + directMpesaRevenueCents;
  const totalUserWalletsHeldCents = nonAdminAvailableHeldCents + restrictedHeldCents;

  // Conservation formula:
  // Approved deposits - external special refunds + opening/internal credits + direct M-Pesa revenue - group installments & loan disbursements
  // === Non-admin available wallet balances + pending escrow holds + wallet-funded & direct platform revenue
  // Wait: refundCreditsCents from SUBSCRIPTION refund or ADMIN REFUND that aren't FEATURED_REFUND (already reversed) or store credit:
  // Any non-featured `REFUND` wallet credit that came from `SUBSCRIPTION` refund reverses `pendingSubEscrowCents` (so refundCreditsCents already returned to user wallet balance!).
  // External special refunds decrease deposits minus outflows; loanFundedDebitCents moves principal to restricted balance + loan fee.
  // Net spent from restricted balance on group installments is tracked via group installments, so compare:
  // External/deposit-backed cash pool vs held + revenue:
  let restrictedLoanNetFundedCents = 0;
  for (const loan of db.peerLoans || []) {
    const loanSt = String(loan.status || '');
    if (loanSt === 'funded' || loanSt === 'repaid') {
      const gross = toCents(loan.approvedAmount || loan.amount || 0);
      const feeRec = (db.platformFees || []).find((f) => f.loanId === loan.id);
      const feeCents = feeRec ? feeRec.feeAmountCents : Math.round(gross * 0.01);
      restrictedLoanNetFundedCents += Math.max(0, gross - feeCents);
    }
  }
  const restrictedLoanSpentCents = Math.max(0, restrictedLoanNetFundedCents - restrictedHeldCents);

  // Clean reconciliation equation anchored to:
  // approvedDeposits - approvedSpecialRefunds === sum(all user wallet balances) + platform revenue
  // (adjusted ONLY for explicit opening balances, direct non-wallet M-Pesa inflows, group spending, and escrow holds)
  const leftSideCents =
    approvedDepositsCents -
    approvedSpecialRefundsCents +
    openingUserWalletCents +
    internalStoreCreditsCents +
    directMpesaRevenueCents -
    groupSpentFromWalletCents -
    restrictedLoanSpentCents -
    (loanFundedDebitCents - restrictedLoanNetFundedCents - (walletFundedRevenueCents > 0 ? 0 : 0));

  // Wait: check loanFundedDebitCents carefully!
  // In group_loans_api: lender debit = principalCents (`loanFundedDebitCents`).
  // Platform gets `feeCents` (which IS in `walletFundedRevenueCents`).
  // Borrower gets `netCents` in `restrictedLoanBalance` (`restrictedHeldCents + restrictedLoanSpentCents = restrictedLoanNetFundedCents`).
  // Note: `loanFundedDebitCents = feeCents + restrictedLoanNetFundedCents`!
  // So `nonAdminAvailableHeld` dropped by `loanFundedDebitCents`, while `walletFundedRevenueCents` gained `feeCents` AND `restrictedHeldCents + restrictedLoanSpentCents` gained `restrictedLoanNetFundedCents`!
  // Thus NO extra subtraction for `(loanFundedDebitCents - restrictedLoanNetFundedCents)` is needed—those two already sum identically to `loanFundedDebitCents`!
  // Wait: if `rightSideCents` uses `nonAdminAvailableHeldCents + restrictedHeldCents + pendingFeaturedEscrowCents + pendingSubEscrowCents + totalIncomeRevenueCents`, then:
  //   lender drop = -principalCents
  //   restrictedHeldCents + restrictedLoanSpentCents = +netCents
  //   totalIncomeRevenueCents (LOAN_FEE) = +feeCents
  //   net effect on rightSide + restrictedLoanSpentCents = -principalCents + netCents + feeCents = 0!!
  // Verify that! It cancels out to EXACTLY 0!

  // Also check `REFUND` wallet credits (excluding FEATURED_REFUND which keeps right side 0 because pendingFeaturedEscrowCents drops by same amount):
  // If an admin gave an internal `REFUND` or `DEPOSIT` credit via `REFUND` category in walletLedger that didn't come from `pendingSubEscrowCents`:
  // For pendingSubEscrowCents reject, we'll refund pending sub so `pendingSubEscrowCents` drops by X and `nonAdminAvailableHeldCents` rises by X -> net 0!
  // What about group removal / store credit conversions that call `creditWalletCents(..., category: 'REFUND', ...)`? Those add to `refundCreditsCents`, balanced if added to `internalStoreCreditsCents` ONLY when backed by group removal / default conversion (already paid earlier via `groupSpentFromWalletCents` or external M-Pesa payment)!
  // Let's also check: if `walletDeposits` approved + `creditWalletCents('DEPOSIT')` ran directly in a test without `GROUP_INSTALLMENT`:
  // Look at any non-deposit ledger entries so our formula stays simple, exact, and ungameable:
  const adjustedLeftCents =
    approvedDepositsCents -
    approvedSpecialRefundsCents +
    openingUserWalletCents +
    directMpesaRevenueCents -
    groupSpentFromWalletCents -
    restrictedLoanSpentCents +
    refundCreditsCents +
    internalStoreCreditsCents;

  // Wait: if a test inserts a bogus `walletDeposits` approval or removes a deposit or edits `wallet.balanceCents`:
  // - If `wallet.balanceCents` is edited directly, `walletLedger` net !== `balanceCents` -> caught by `walletMismatches`!
  // - AND `nonAdminAvailableHeldCents` changes -> `adjustedRightCents` changes -> `diffCents !== 0` -> caught by balance equation too!
  // - What if a test approves a special refund (`RefundRequest` / `specialRefundCredits` `SPECIAL_EXTERNAL_REFUND`) without deducting non-admin wallet (or approves deposit of 1000 and credits 900)?
  //   Deposit = 1000, wallet credited = 900 -> `left = 1000`, `right = 900` -> `diffCents = +100` (IMMEDIATELY CAUGHT!)
  // - Wait: check `refundCreditsCents`: if `api.ts:4353` uses `REFUND` with `idempotencyKey: sub_refund_...` (reversing `SUBSCRIPTION` hold), then `pendingSubEscrowCents` dropped by X AND `nonAdminAvailableHeldCents` rose by X -> net effect on `rightSide` is 0, so we should NOT add `sub_refund_` to `refundCreditsCents`!
  //   Let's recompute `otherRefundCreditsCents` cleanly (only excluding `sub_refund_*` and `feat_refund_*` which reverse escrows already on `rightSide`!):
  let nonEscrowRefundCreditsCents = 0;
  for (const l of db.walletLedger || []) {
    if (l.role === 'admin') continue;
    if (l.category === 'REFUND' && l.direction === 'CREDIT') {
      const ik = String(l.idempotencyKey || '');
      if (!ik.startsWith('sub_refund_') && !ik.startsWith('feat_refund_')) {
        nonEscrowRefundCreditsCents += l.amountCents;
      }
    }
  }

  // Wait: what about legacy `payments` refunds or un-ledgered special refunds? Keep equation cleanly transparent!
  // Wait: verify what `rightSideCents` equals for plain deposits + revenue + special refunds:
  const finalLeftSideCents =
    approvedDepositsCents -
    approvedSpecialRefundsCents +
    openingUserWalletCents +
    internalStoreCreditsCents +
    nonEscrowRefundCreditsCents +
    directMpesaRevenueCents -
    groupSpentFromWalletCents -
    restrictedLoanSpentCents;

  const finalRightSideCents =
    nonAdminAvailableHeldCents +
    restrictedHeldCents +
    pendingFeaturedEscrowCents +
    pendingSubEscrowCents +
    totalIncomeRevenueCents;

  const diffCents = finalLeftSideCents - finalRightSideCents;
  const status: ReconciliationReport['status'] =
    diffCents === 0 && walletMismatches.length === 0 ? 'PASSED' : 'MISMATCH';

  const report: ReconciliationReport = {
    id: `rec_${now}_${crypto.randomBytes(3).toString('hex')}`,
    status,
    trigger,
    checkedAt: now,
    eatTimestamp,
    approvedDepositsCents,
    openingUserWalletCents,
    approvedSpecialRefundsCents,
    totalUserWalletsHeldCents,
    nonAdminAvailableHeldCents,
    restrictedHeldCents,
    platformWalletBalanceCents,
    walletFundedRevenueCents,
    directMpesaRevenueCents,
    totalIncomeRevenueCents,
    leftSideCents: finalLeftSideCents,
    rightSideCents: finalRightSideCents,
    diffCents,
    walletMismatchCount: walletMismatches.length,
    walletMismatches,
    notes:
      status === 'PASSED'
        ? 'All user wallets, escrow holds, deposits, and platform income reconcile cleanly.'
        : `Discrepancy detected: diffCents=${diffCents}, walletMismatches=${walletMismatches.length}.`,
  };

  db.reconciliationReports.unshift(report);
  if (db.reconciliationReports.length > 100) {
    db.reconciliationReports.length = 100;
  }

  if (status === 'MISMATCH') {
    logAudit(
      db,
      0,
      'System Reconciliation',
      'WALLET_RECONCILIATION_MISMATCH',
      `Reconciliation (${trigger}) MISMATCH: diff=KSh ${fromCents(diffCents).toLocaleString()} (${diffCents} cents), walletMismatches=${walletMismatches.length}`
    );
  }

  return report;
}

export function getAdminWalletSummary(db: DatabaseSchema) {
  let totalDepositsApprovedCents = 0;
  let totalDepositsPendingCents = 0;
  let totalDepositsDeclinedCents = 0;
  let approvedDepositCount = 0;
  let pendingDepositCount = 0;
  let declinedDepositCount = 0;

  for (const d of db.walletDeposits || []) {
    const c = toCents(d.amount || 0);
    if (d.status === 'approved') {
      totalDepositsApprovedCents += c;
      approvedDepositCount++;
    } else if (d.status === 'pending') {
      totalDepositsPendingCents += c;
      pendingDepositCount++;
    } else {
      totalDepositsDeclinedCents += c;
      declinedDepositCount++;
    }
  }

  const bySourceCents: Record<IncomeSource, number> = {
    SUBSCRIPTION: 0,
    FEATURED: 0,
    LOAN_FEE: 0,
    TRIP_DATING: 0,
    AIRBUS_PLUS: 0,
    ADVERTISING: 0,
    OTHER: 0,
  };
  let totalIncomeRevenueCents = 0;
  let walletFundedIncomeCents = 0;
  let directMpesaIncomeCents = 0;

  for (const inc of db.incomeLedger || []) {
    const src = normalizeIncomeSource(inc.source);
    bySourceCents[src] = (bySourceCents[src] || 0) + inc.amountCents;
    totalIncomeRevenueCents += inc.amountCents;
    if (inc.paymentChannel === 'MPESA_DIRECT') directMpesaIncomeCents += inc.amountCents;
    else walletFundedIncomeCents += inc.amountCents;
  }

  const heldByRoleCents: Record<UserRole, number> = {
    member: 0,
    merchant: 0,
    lender: 0,
    admin: 0,
  };
  let availableHeldCents = 0;
  let platformWalletBalanceCents = 0;

  for (const w of db.wallets || []) {
    if (w.role === 'admin') {
      platformWalletBalanceCents += w.balanceCents;
      heldByRoleCents.admin += w.balanceCents;
    } else {
      heldByRoleCents[w.role] = (heldByRoleCents[w.role] || 0) + w.balanceCents;
      availableHeldCents += w.balanceCents;
    }
  }

  let restrictedHeldCents = 0;
  for (const u of db.users || []) {
    if (u.isDisabled) continue;
    restrictedHeldCents += toCents(Number(u.restrictedLoanBalance || 0));
  }

  const totalHeldInUserWalletsCents = availableHeldCents + restrictedHeldCents;
  const latestReconciliation = (db.reconciliationReports || [])[0] || null;

  return {
    kpis: {
      totalDepositsApprovedCents,
      totalDepositsApprovedKes: fromCents(totalDepositsApprovedCents),
      totalDepositsPendingCents,
      totalDepositsPendingKes: fromCents(totalDepositsPendingCents),
      totalDepositsDeclinedCents,
      totalDepositsDeclinedKes: fromCents(totalDepositsDeclinedCents),
      approvedDepositCount,
      pendingDepositCount,
      declinedDepositCount,
      totalIncomeRevenueCents,
      totalIncomeRevenueKes: fromCents(totalIncomeRevenueCents),
      walletFundedIncomeKes: fromCents(walletFundedIncomeCents),
      directMpesaIncomeKes: fromCents(directMpesaIncomeCents),
      totalHeldInUserWalletsCents,
      totalHeldInUserWalletsKes: fromCents(totalHeldInUserWalletsCents),
      availableHeldCents,
      availableHeldKes: fromCents(availableHeldCents),
      restrictedHeldCents,
      restrictedHeldKes: fromCents(restrictedHeldCents),
      platformWalletBalanceCents,
      platformWalletBalanceKes: fromCents(platformWalletBalanceCents),
    },
    bySourceCents,
    bySourceKes: Object.fromEntries(
      ALL_INCOME_SOURCES.map((s) => [s, fromCents(bySourceCents[s])])
    ),
    heldByRoleKes: {
      member: fromCents(heldByRoleCents.member),
      merchant: fromCents(heldByRoleCents.merchant),
      lender: fromCents(heldByRoleCents.lender),
      admin: fromCents(heldByRoleCents.admin),
    },
    latestReconciliation,
  };
}

export function getAdminWalletIncomeBreakdown(
  db: DatabaseSchema,
  options: {
    granularity?: 'hour' | 'day' | 'month' | 'year';
    source?: string;
    channel?: string;
    page?: number;
    limit?: number;
  }
) {
  const granularity =
    options.granularity === 'hour' ||
    options.granularity === 'day' ||
    options.granularity === 'month' ||
    options.granularity === 'year'
      ? options.granularity
      : 'day';
  const sourceFilter = options.source && options.source !== 'all' ? normalizeIncomeSource(options.source) : 'all';
  const channelFilter = options.channel === 'WALLET' || options.channel === 'MPESA_DIRECT' ? options.channel : 'all';

  const allRecords = (db.incomeLedger || []).filter((r) => {
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    if (channelFilter !== 'all' && r.paymentChannel !== channelFilter) return false;
    return true;
  });

  const bucketMap = new Map<
    string,
    {
      bucket: string;
      totalCents: number;
      walletCents: number;
      mpesaDirectCents: number;
      count: number;
      bySourceCents: Record<IncomeSource, number>;
    }
  >();

  for (const r of allRecords) {
    const keys =
      r.eatHourKey && r.eatDateKey && r.eatMonthKey && r.eatYearKey
        ? r
        : getEatTimeKeys(r.createdAt);
    const key =
      granularity === 'hour'
        ? keys.eatHourKey
        : granularity === 'month'
        ? keys.eatMonthKey
        : granularity === 'year'
        ? keys.eatYearKey
        : keys.eatDateKey;

    let b = bucketMap.get(key);
    if (!b) {
      b = {
        bucket: key,
        totalCents: 0,
        walletCents: 0,
        mpesaDirectCents: 0,
        count: 0,
        bySourceCents: {
          SUBSCRIPTION: 0,
          FEATURED: 0,
          LOAN_FEE: 0,
          TRIP_DATING: 0,
          AIRBUS_PLUS: 0,
          ADVERTISING: 0,
          OTHER: 0,
        },
      };
      bucketMap.set(key, b);
    }
    b.totalCents += r.amountCents;
    if (r.paymentChannel === 'MPESA_DIRECT') b.mpesaDirectCents += r.amountCents;
    else b.walletCents += r.amountCents;
    b.count++;
    const src = normalizeIncomeSource(r.source);
    b.bySourceCents[src] += r.amountCents;
  }

  const series = Array.from(bucketMap.values())
    .sort((a, b) => b.bucket.localeCompare(a.bucket))
    .slice(0, 60)
    .map((b) => ({
      bucket: b.bucket,
      totalCents: b.totalCents,
      totalKes: fromCents(b.totalCents),
      walletKes: fromCents(b.walletCents),
      mpesaDirectKes: fromCents(b.mpesaDirectCents),
      count: b.count,
      bySourceKes: Object.fromEntries(
        ALL_INCOME_SOURCES.map((s) => [s, fromCents(b.bySourceCents[s])])
      ),
    }));

  const totalsBySource = ALL_INCOME_SOURCES.map((src) => {
    const matching = (db.incomeLedger || []).filter((r) => r.source === src);
    const totalCents = matching.reduce((s, r) => s + r.amountCents, 0);
    return {
      source: src,
      label: INCOME_SOURCE_LABELS[src],
      totalCents,
      totalKes: fromCents(totalCents),
      count: matching.length,
    };
  });

  const sortedEntries = [...allRecords].sort((a, b) => b.createdAt - a.createdAt);
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 20));
  const total = sortedEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const items = sortedEntries.slice(start, start + limit).map((e) => ({
    ...e,
    amountKes: fromCents(e.amountCents),
    sourceLabel: INCOME_SOURCE_LABELS[normalizeIncomeSource(e.source)],
  }));

  return {
    granularity,
    timezone: 'Africa/Nairobi (EAT)',
    totalsBySource,
    series,
    entries: items,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
    },
  };
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildExportCsvContent(db: DatabaseSchema, type: AdminExportJob['type']): {
  filename: string;
  csvContent: string;
  totalRows: number;
} {
  const { dateKey } = getEatDateParts(Date.now());
  if (type === 'wallets') {
    const headers = ['User ID', 'Platform ID', 'Name', 'Phone', 'Email', 'Role', 'Available Wallet (KSh)', 'Restricted Loan Balance (KSh)', 'Coins', 'Points', 'Verified', 'Status'];
    const rows = (db.users || []).map((u) => [
      u.id,
      u.platformId || '',
      u.name || '',
      u.phone || '',
      u.email || '',
      u.activeRole || u.role,
      Number(u.credit || 0).toFixed(2),
      Number(u.restrictedLoanBalance || 0).toFixed(2),
      Number(u.coins || 0),
      Number(u.points || 0),
      u.verified ? 'Yes' : 'No',
      u.isSuspended ? 'Suspended' : 'Active',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
    return { filename: `buyoll_wallets_${dateKey}.csv`, csvContent, totalRows: rows.length };
  }

  if (type === 'users') {
    const headers = ['User ID', 'Platform ID', 'Name', 'Shop Name', 'Role', 'Phone', 'Email', 'Verified', 'Subscription Plan', 'Subscription Status', 'Wallet Balance (KSh)', 'Status', 'Created At (UTC)'];
    const rows = (db.users || []).map((u) => [
      u.id,
      u.platformId || '',
      u.name || '',
      u.shopName || '',
      u.activeRole || u.role,
      u.phone || '',
      u.email || '',
      u.verified ? 'Verified' : 'Unverified',
      u.merchantSubscriptionPlan || '',
      u.merchantSubscriptionStatus || '',
      Number(u.credit || 0).toFixed(2),
      u.isDisabled ? 'Disabled' : u.isSuspended ? 'Suspended' : 'Active',
      u.createdAt ? new Date(u.createdAt).toISOString() : '',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
    return { filename: `buyoll_users_merchants_${dateKey}.csv`, csvContent, totalRows: rows.length };
  }

  // 'admin_wallet' unified ledger & deposit snapshot CSV
  const headers = ['Record Type', 'ID / Ref', 'Category / Status', 'Channel / Role', 'User / Merchant', 'M-Pesa Code / Ref', 'Amount (KSh)', 'EAT Date', 'Notes'];
  const rows: any[][] = [];
  for (const d of db.walletDeposits || []) {
    rows.push([
      'MPESA_DEPOSIT',
      d.id,
      String(d.status).toUpperCase(),
      d.role || 'member',
      d.userName || d.userId,
      d.mpesaCode,
      Number(d.amount || 0).toFixed(2),
      getEatTimeKeys(d.createdAt).eatTimestamp,
      d.notes || '',
    ]);
  }
  for (const inc of db.incomeLedger || []) {
    rows.push([
      'PLATFORM_INCOME',
      inc.id,
      inc.source,
      inc.paymentChannel,
      inc.userName || inc.userId || 'Platform',
      inc.referenceId,
      fromCents(inc.amountCents).toFixed(2),
      getEatTimeKeys(inc.createdAt).eatTimestamp,
      inc.description,
    ]);
  }
  const csvContent = [headers.join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join('\n');
  return { filename: `buyoll_admin_wallet_${dateKey}.csv`, csvContent, totalRows: rows.length };
}
