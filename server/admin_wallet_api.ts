import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import type { AdminExportJob, UserRole } from '../src/types.js';
import { getDatabase, logAudit, runDatabaseTransaction } from './db.js';
import { resolveAuthenticatedUser } from './auth_utils.js';
import { fromCents, getEatDateParts, toCents } from './config.js';
import { paginateList, parsePaginationQuery } from './admin_control_center.js';
import {
  ALL_INCOME_SOURCES,
  buildExportCsvContent,
  getAdminWalletIncomeBreakdown,
  getAdminWalletSummary,
  normalizeIncomeSource,
  recordIncomeInTx,
  runWalletReconciliationInTx,
} from './admin_wallet_service.js';
import { creditWalletCents, normalizeRoleValue } from './wallet_service.js';
import { enqueueOutboxInTx, flushOutboxEvents } from './outbox_service.js';

export const adminWalletRouter = Router();

async function requireStrictAdmin(req: Request, res: Response) {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const activeRole = user.activeRole || user.role;
  const isAuthorizedAdmin =
    activeRole === 'admin' &&
    (user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin')));
  if (!isAuthorizedAdmin) {
    res.status(403).json({ error: 'FORBIDDEN: Admin access required' });
    return null;
  }
  const db = await getDatabase();
  return { user, db };
}

// GET /api/admin/wallet/summary
adminWalletRouter.get('/admin/wallet/summary', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const summary = getAdminWalletSummary(auth.db);
  res.json(summary);
});

// GET /api/admin/wallet/deposits
adminWalletRouter.get('/admin/wallet/deposits', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const { db } = auth;

  const { page, limit } = parsePaginationQuery(req.query, 20, 100);
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'all';
  const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  const usersById = new Map((db.users || []).map((u) => [u.id, u]));
  const allDeposits = [...(db.walletDeposits || [])].sort((a, b) => b.createdAt - a.createdAt);

  const filtered = allDeposits.filter((d) => {
    const st = String(d.status || 'pending').toLowerCase();
    if (statusFilter !== 'all') {
      if (statusFilter === 'declined' || statusFilter === 'rejected') {
        if (st !== 'declined' && st !== 'rejected') return false;
      } else if (st !== statusFilter) {
        return false;
      }
    }
    const depRole = String(d.role || usersById.get(d.userId)?.activeRole || 'member').toLowerCase();
    if (roleFilter !== 'all' && depRole !== roleFilter) return false;
    if (search) {
      const u = usersById.get(d.userId);
      const hay = `${d.mpesaCode || ''} ${d.userName || ''} ${d.userPhone || (d as any).phone || ''} ${u?.email || ''} ${u?.shopName || ''} ${d.notes || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const paged = paginateList(filtered, page, limit);
  const enriched = paged.items.map((d) => {
    const u = usersById.get(d.userId);
    return {
      ...d,
      role: d.role || u?.activeRole || u?.role || 'member',
      userEmail: u?.email || '',
      shopName: u?.shopName || '',
      platformId: u?.platformId || '',
      amountCents: toCents(d.amount || 0),
    };
  });

  res.json({
    deposits: enriched,
    pagination: paged.pagination,
  });
});

// GET /api/admin/wallet/income?granularity=hour|day|month|year
adminWalletRouter.get('/admin/wallet/income', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;

  const { page, limit } = parsePaginationQuery(req.query, 20, 100);
  const granularity = typeof req.query.granularity === 'string' ? req.query.granularity : 'day';
  const source = typeof req.query.source === 'string' ? req.query.source : 'all';
  const channel = typeof req.query.channel === 'string' ? req.query.channel : 'all';

  const result = getAdminWalletIncomeBreakdown(auth.db, {
    granularity: granularity as any,
    source,
    channel,
    page,
    limit,
  });

  res.json(result);
});

// POST /api/admin/wallet/income - Record verified direct platform revenue (e.g. TRIP_DATING, AIRBUS_PLUS, ADVERTISING, OTHER)
adminWalletRouter.post('/admin/wallet/income', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const { user } = auth;

  const { source, amountKes, referenceId, description, userId, idempotencyKey } = req.body || {};
  const normalizedSource = normalizeIncomeSource(source);
  if (!ALL_INCOME_SOURCES.includes(normalizedSource)) {
    return res.status(400).json({ error: 'Invalid income source category' });
  }
  const amountNum = Number(amountKes);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Amount (KES) must be greater than 0' });
  }
  const ref = String(referenceId || '').trim();
  const desc = String(description || '').trim();
  if (!ref || desc.length < 3) {
    return res.status(400).json({ error: 'Reference ID and clear description are required' });
  }

  try {
    const out = await runDatabaseTransaction((txDb) => {
      const targetUser = userId ? txDb.users.find((u) => u.id === Number(userId)) : undefined;
      const key = String(idempotencyKey || `adm_inc_${normalizedSource}_${ref}`).trim();
      const { record, deduplicated } = recordIncomeInTx(txDb, {
        source: normalizedSource,
        paymentChannel: 'MPESA_DIRECT',
        amountCents: toCents(amountNum),
        userId: targetUser?.id ?? null,
        userName: targetUser?.name || targetUser?.shopName || 'External Payer',
        referenceId: ref,
        description: desc,
        idempotencyKey: key,
        actorId: user.id,
        creditAdminWalletIfDirect: true,
      });

      if (!deduplicated) {
        logAudit(
          txDb,
          user.id,
          user.name,
          'ADMIN_INCOME_RECORDED',
          `Recorded ${normalizedSource} income of KSh ${amountNum.toLocaleString()} (Ref: ${ref}): ${desc}`
        );
      }
      return { record, deduplicated };
    });

    res.status(out.deduplicated ? 200 : 201).json(out);
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to record income entry' });
  }
});

// GET /api/admin/wallet/held
adminWalletRouter.get('/admin/wallet/held', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const { db } = auth;

  const { page, limit } = parsePaginationQuery(req.query, 20, 100);
  const roleFilter = typeof req.query.role === 'string' ? req.query.role.trim().toLowerCase() : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  const rolesList: UserRole[] = ['member', 'merchant', 'lender', 'admin'];
  const summaryByRole = rolesList.map((role) => {
    const matchingWallets = (db.wallets || []).filter((w) => w.role === role);
    const availableCents = matchingWallets.reduce((s, w) => s + w.balanceCents, 0);
    const restrictedCents =
      role === 'member'
        ? (db.users || [])
            .filter((u) => !u.isDisabled)
            .reduce((s, u) => s + toCents(Number(u.restrictedLoanBalance || 0)), 0)
        : 0;
    return {
      role,
      walletCount: matchingWallets.length,
      availableCents,
      availableKes: fromCents(availableCents),
      restrictedCents,
      restrictedKes: fromCents(restrictedCents),
      totalHeldCents: availableCents + restrictedCents,
      totalHeldKes: fromCents(availableCents + restrictedCents),
    };
  });

  const rows = (db.users || [])
    .filter((u) => !u.isDisabled)
    .map((u) => {
      const activeRole = normalizeRoleValue(u.activeRole || u.role);
      const wallet = (db.wallets || []).find((w) => w.userId === u.id && w.role === activeRole);
      const availableCents = wallet ? wallet.balanceCents : toCents(Number(u.credit || 0));
      const restrictedCents = toCents(Number(u.restrictedLoanBalance || 0));
      return {
        userId: u.id,
        platformId: u.platformId || '',
        name: u.name,
        shopName: u.shopName || '',
        phone: u.phone || '',
        email: u.email || '',
        role: activeRole,
        availableCents,
        availableKes: fromCents(availableCents),
        restrictedCents,
        restrictedKes: fromCents(restrictedCents),
        totalCents: availableCents + restrictedCents,
        totalKes: fromCents(availableCents + restrictedCents),
        coins: Number(u.coins || 0),
        points: Number(u.points || 0),
        updatedAt: wallet?.updatedAt || u.updatedAt || u.createdAt,
      };
    })
    .filter((row) => {
      if (roleFilter !== 'all' && row.role !== roleFilter) return false;
      if (search) {
        const hay = `${row.name} ${row.shopName} ${row.phone} ${row.email} ${row.platformId}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  const paged = paginateList(rows, page, limit);
  res.json({
    summaryByRole,
    wallets: paged.items,
    pagination: paged.pagination,
  });
});

// GET /api/admin/wallet/reconciliation
adminWalletRouter.get('/admin/wallet/reconciliation', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const { db } = auth;

  const history = db.reconciliationReports || [];
  const latest = history[0] || null;

  res.json({
    latest,
    history: history.slice(0, 20),
  });
});

// POST /api/admin/wallet/reconciliation/run
adminWalletRouter.post('/admin/wallet/reconciliation/run', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;

  try {
    const report = await runDatabaseTransaction((txDb) => {
      const rep = runWalletReconciliationInTx(txDb, 'manual');
      logAudit(
        txDb,
        auth.user.id,
        auth.user.name,
        'ADMIN_RECONCILIATION_RUN',
        `Triggered manual wallet reconciliation: status=${rep.status}, diff=KSh ${fromCents(rep.diffCents)}`
      );
      return rep;
    });
    res.json({ report });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Reconciliation failed' });
  }
});

// GET /api/admin/wallet/export (direct authenticated CSV stream)
adminWalletRouter.get('/admin/wallet/export', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const { filename, csvContent } = buildExportCsvContent(auth.db, 'admin_wallet');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvContent);
});

// ASYNC / BACKGROUND CSV EXPORT JOBS (Wallets CSV, Users & Merchants CSV, Admin Wallet CSV)
adminWalletRouter.post('/admin/exports', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;

  const rawType = String(req.body?.type || 'wallets').trim().toLowerCase();
  const type: AdminExportJob['type'] =
    rawType === 'users' || rawType === 'admin_wallet' ? rawType : 'wallets';

  try {
    const job = await runDatabaseTransaction((txDb) => {
      if (!txDb.exportJobs) txDb.exportJobs = [];
      const now = Date.now();
      const { dateKey } = getEatDateParts(now);
      const id = `exp_${now}_${crypto.randomBytes(4).toString('hex')}`;
      const newJob: AdminExportJob = {
        id,
        type,
        status: 'queued',
        createdBy: auth.user.id,
        filename: `buyoll_${type}_${dateKey}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        totalRows: 0,
        createdAt: now,
        completedAt: null,
      };
      txDb.exportJobs.unshift(newJob);
      if (txDb.exportJobs.length > 30) {
        txDb.exportJobs.length = 30;
      }
      logAudit(txDb, auth.user.id, auth.user.name, 'ADMIN_EXPORT_QUEUED', `Queued background ${type} CSV export (${id})`);
      return newJob;
    });

    // Process export asynchronously in background without blocking the HTTP response
    setImmediate(() => {
      runDatabaseTransaction((txDb) => {
        const target = (txDb.exportJobs || []).find((j) => j.id === job.id);
        if (!target) return;
        target.status = 'processing';
        const built = buildExportCsvContent(txDb, target.type);
        target.filename = built.filename;
        target.csvContent = built.csvContent;
        target.totalRows = built.totalRows;
        target.status = 'completed';
        target.completedAt = Date.now();
      }).catch((err) => {
        runDatabaseTransaction((txDb) => {
          const target = (txDb.exportJobs || []).find((j) => j.id === job.id);
          if (target) {
            target.status = 'failed';
            target.error = err?.message || 'Export generation failed';
          }
        }).catch(() => {});
      });
    });

    res.status(202).json({
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        filename: job.filename,
        totalRows: job.totalRows,
        createdAt: job.createdAt,
      },
    });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Could not queue CSV export' });
  }
});

adminWalletRouter.get('/admin/exports/:id', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const job = (auth.db.exportJobs || []).find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  res.json({
    job: {
      id: job.id,
      type: job.type,
      status: job.status,
      filename: job.filename,
      mimeType: job.mimeType,
      totalRows: job.totalRows,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
  });
});

adminWalletRouter.get('/admin/exports/:id/download', async (req: Request, res: Response) => {
  const auth = await requireStrictAdmin(req, res);
  if (!auth) return;
  const job = (auth.db.exportJobs || []).find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (job.status !== 'completed' || !job.csvContent) {
    return res.status(409).json({ error: `Export job is currently ${job.status}` });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${job.filename}"`);
  res.send(job.csvContent);
});

// Helper used across deposit approval routes when an external special credit / deposit needs outbox notification
export function queueWalletDepositDecisionOutboxInTx(
  txDb: any,
  params: {
    userId: number;
    depositId: number;
    amountKes: number;
    mpesaCode: string;
    role: UserRole;
    decision: 'approve' | 'decline';
    reason?: string;
    balanceKes?: number;
  }
) {
  const isApprove = params.decision === 'approve';
  return enqueueOutboxInTx(txDb, {
    userId: params.userId,
    eventType: 'deposit.updated',
    entityType: 'deposit',
    entityId: String(params.depositId),
    title: isApprove ? 'Wallet Deposit Approved' : 'Wallet Deposit Declined',
    message: isApprove
      ? `Your M-Pesa deposit of KSh ${params.amountKes.toLocaleString()} (Code: ${params.mpesaCode}) was approved and credited to your ${params.role} wallet.`
      : `Your M-Pesa deposit of KSh ${params.amountKes.toLocaleString()} (Code: ${params.mpesaCode}) was declined: ${params.reason || 'Could not match M-Pesa statement'}.`,
    notificationType: 'payment',
    link: '/wallet',
    payload: {
      depositId: params.depositId,
      status: isApprove ? 'approved' : 'declined',
      amountKes: params.amountKes,
      mpesaCode: params.mpesaCode,
      role: params.role,
      balanceKes: params.balanceKes,
      reason: params.reason,
    },
    alsoAddNotification: false, // caller adds or already added notification if needed
  });
}

export { creditWalletCents, normalizeRoleValue, flushOutboxEvents };
