import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { AdminPaginationMeta } from '../api.ts';
import type {
  IncomeSource,
  PlatformIncomeRecord,
  ReconciliationReport,
  WalletDepositRequest,
} from '../types.ts';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

interface AdminWalletPanelProps {
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onChanged?: () => void;
}

type WalletSubTab = 'deposits' | 'income' | 'held';
type Granularity = 'hour' | 'day' | 'month' | 'year';

const INCOME_SOURCE_META: Array<{ key: IncomeSource; label: string }> = [
  { key: 'SUBSCRIPTION', label: 'Merchant Subscriptions' },
  { key: 'FEATURED', label: 'Featured Placements' },
  { key: 'LOAN_FEE', label: 'Loan Platform Fees' },
  { key: 'TRIP_DATING', label: 'Trip & Dating Services' },
  { key: 'AIRBUS_PLUS', label: 'AirbusPlus Pass' },
  { key: 'ADVERTISING', label: 'Platform Advertising' },
  { key: 'OTHER', label: 'Other Services' },
];

function formatKes(amount: number): string {
  return `KSh ${Number(amount || 0).toLocaleString()}`;
}

export const AdminWalletPanel: React.FC<AdminWalletPanelProps> = ({
  onNotify,
  onChanged,
}) => {
  const [subTab, setSubTab] = useState<WalletSubTab>('deposits');
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<Awaited<
    ReturnType<typeof api.getAdminWalletSummary>
  > | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [runningRecon, setRunningRecon] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  // Sub-tab 1: Deposits
  const [deposits, setDeposits] = useState<WalletDepositRequest[]>([]);
  const [depositsPagination, setDepositsPagination] = useState<AdminPaginationMeta | null>(null);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositsError, setDepositsError] = useState<string | null>(null);
  const [depositStatusFilter, setDepositStatusFilter] = useState<string>('all');
  const [depositRoleFilter, setDepositRoleFilter] = useState<string>('all');
  const [depositSearch, setDepositSearch] = useState('');
  const [depositPage, setDepositPage] = useState(1);
  const [processingDepositId, setProcessingDepositId] = useState<number | string | null>(null);
  const [declineModal, setDeclineModal] = useState<{
    open: boolean;
    deposit: WalletDepositRequest | null;
    reason: string;
  }>({ open: false, deposit: null, reason: '' });

  // Sub-tab 2: Income & Revenue
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [incomeSourceFilter, setIncomeSourceFilter] = useState<string>('all');
  const [incomeChannelFilter, setIncomeChannelFilter] = useState<string>('all');
  const [incomePage, setIncomePage] = useState(1);
  const [incomeData, setIncomeData] = useState<Awaited<
    ReturnType<typeof api.getAdminWalletIncome>
  > | null>(null);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [recordIncomeModal, setRecordIncomeModal] = useState<{
    open: boolean;
    source: IncomeSource;
    amountKes: string;
    referenceId: string;
    description: string;
  }>({
    open: false,
    source: 'ADVERTISING',
    amountKes: '',
    referenceId: '',
    description: '',
  });
  const [savingIncome, setSavingIncome] = useState(false);

  // Sub-tab 3: Held in Wallets
  const [heldData, setHeldData] = useState<Awaited<
    ReturnType<typeof api.getAdminWalletHeld>
  > | null>(null);
  const [heldLoading, setHeldLoading] = useState(false);
  const [heldError, setHeldError] = useState<string | null>(null);
  const [heldRoleFilter, setHeldRoleFilter] = useState<string>('all');
  const [heldSearch, setHeldSearch] = useState('');
  const [heldPage, setHeldPage] = useState(1);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const [sumRes, recRes] = await Promise.all([
        api.getAdminWalletSummary(),
        api.getAdminWalletReconciliation().catch(() => null),
      ]);
      setSummaryData(sumRes);
      setReconciliation(recRes?.latest || sumRes.latestReconciliation || null);
    } catch (err: any) {
      setSummaryError(err?.message || 'Unable to load Admin Wallet summary.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadDeposits = useCallback(
    async (page = depositPage) => {
      setDepositsLoading(true);
      setDepositsError(null);
      try {
        const res = await api.getAdminWalletDepositsPage({
          page,
          limit: 20,
          status: depositStatusFilter,
          role: depositRoleFilter,
          search: depositSearch.trim() || undefined,
        });
        setDeposits(res.deposits || []);
        setDepositsPagination(res.pagination || null);
      } catch (err: any) {
        setDepositsError(err?.message || 'Unable to load M-Pesa deposits.');
      } finally {
        setDepositsLoading(false);
      }
    },
    [depositPage, depositStatusFilter, depositRoleFilter, depositSearch]
  );

  const loadIncome = useCallback(
    async (page = incomePage) => {
      setIncomeLoading(true);
      setIncomeError(null);
      try {
        const res = await api.getAdminWalletIncome({
          granularity,
          source: incomeSourceFilter,
          channel: incomeChannelFilter,
          page,
          limit: 20,
        });
        setIncomeData(res);
      } catch (err: any) {
        setIncomeError(err?.message || 'Unable to load income ledger.');
      } finally {
        setIncomeLoading(false);
      }
    },
    [granularity, incomeSourceFilter, incomeChannelFilter, incomePage]
  );

  const loadHeld = useCallback(
    async (page = heldPage) => {
      setHeldLoading(true);
      setHeldError(null);
      try {
        const res = await api.getAdminWalletHeld({
          page,
          limit: 20,
          role: heldRoleFilter,
          search: heldSearch.trim() || undefined,
        });
        setHeldData(res);
      } catch (err: any) {
        setHeldError(err?.message || 'Unable to load held wallet balances.');
      } finally {
        setHeldLoading(false);
      }
    },
    [heldPage, heldRoleFilter, heldSearch]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (subTab === 'deposits') void loadDeposits(depositPage);
  }, [subTab, depositPage, depositStatusFilter, depositRoleFilter, loadDeposits]);

  useEffect(() => {
    if (subTab !== 'deposits') return;
    const t = setTimeout(() => {
      void loadDeposits(1);
    }, 250);
    return () => clearTimeout(t);
  }, [depositSearch, subTab]);

  useEffect(() => {
    if (subTab === 'income') void loadIncome(incomePage);
  }, [subTab, incomePage, granularity, incomeSourceFilter, incomeChannelFilter, loadIncome]);

  useEffect(() => {
    if (subTab === 'held') void loadHeld(heldPage);
  }, [subTab, heldPage, heldRoleFilter, loadHeld]);

  useEffect(() => {
    if (subTab !== 'held') return;
    const t = setTimeout(() => {
      void loadHeld(1);
    }, 250);
    return () => clearTimeout(t);
  }, [heldSearch, subTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onWalletChanged = () => {
      void loadSummary();
      if (subTab === 'deposits') void loadDeposits(depositPage);
      if (subTab === 'income') void loadIncome(incomePage);
      if (subTab === 'held') void loadHeld(heldPage);
    };
    window.addEventListener('buyoll:admin-wallet-updated', onWalletChanged);
    window.addEventListener('buyoll:deposit-updated', onWalletChanged);
    return () => {
      window.removeEventListener('buyoll:admin-wallet-updated', onWalletChanged);
      window.removeEventListener('buyoll:deposit-updated', onWalletChanged);
    };
  }, [subTab, depositPage, incomePage, heldPage, loadSummary, loadDeposits, loadIncome, loadHeld]);

  async function handleRunReconciliation() {
    setRunningRecon(true);
    try {
      const res = await api.runAdminWalletReconciliation();
      setReconciliation(res.report);
      await loadSummary();
      onNotify(
        res.report.status === 'PASSED' ? 'success' : 'error',
        res.report.status === 'PASSED'
          ? 'Wallet reconciliation passed with zero discrepancy.'
          : `Reconciliation mismatch detected: ${formatKes(Math.abs(res.report.diffCents / 100))}`
      );
    } catch (err: any) {
      onNotify('error', err?.message || 'Reconciliation failed.');
    } finally {
      setRunningRecon(false);
    }
  }

  async function handleExportAdminWalletCsv() {
    setExportingCsv(true);
    try {
      const res = await api.runAsyncCsvDownload('admin_wallet');
      onNotify('success', `Downloaded ${res.filename} (${res.totalRows} rows).`);
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to export Admin Wallet CSV.');
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleApproveDeposit(dep: WalletDepositRequest) {
    setProcessingDepositId(dep.id);
    try {
      const res = await api.decideWalletDeposit(dep.id, { action: 'approve' });
      onNotify('success', res.message || `Deposit ${dep.mpesaCode} approved and credited.`);
      await Promise.all([loadSummary(), loadDeposits(depositPage)]);
      onChanged?.();
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to approve deposit.');
    } finally {
      setProcessingDepositId(null);
    }
  }

  async function handleConfirmDeclineDeposit(e: React.FormEvent) {
    e.preventDefault();
    const dep = declineModal.deposit;
    const reason = declineModal.reason.trim();
    if (!dep) return;
    if (reason.length < 3) {
      onNotify('error', 'Decline reason (at least 3 characters) is mandatory.');
      return;
    }
    setProcessingDepositId(dep.id);
    try {
      const res = await api.decideWalletDeposit(dep.id, {
        action: 'decline',
        reason,
        notes: reason,
      });
      onNotify('info', res.message || `Deposit ${dep.mpesaCode} declined.`);
      setDeclineModal({ open: false, deposit: null, reason: '' });
      await Promise.all([loadSummary(), loadDeposits(depositPage)]);
      onChanged?.();
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to decline deposit.');
    } finally {
      setProcessingDepositId(null);
    }
  }

  async function handleSubmitDirectIncome(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(recordIncomeModal.amountKes);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      onNotify('error', 'Enter a valid amount in KES greater than 0.');
      return;
    }
    if (!recordIncomeModal.referenceId.trim() || recordIncomeModal.description.trim().length < 3) {
      onNotify('error', 'M-Pesa reference code and description are required.');
      return;
    }
    setSavingIncome(true);
    try {
      await api.recordAdminWalletIncome({
        source: recordIncomeModal.source,
        amountKes: amountNum,
        referenceId: recordIncomeModal.referenceId.trim().toUpperCase(),
        description: recordIncomeModal.description.trim(),
      });
      onNotify('success', `Recorded ${formatKes(amountNum)} platform revenue.`);
      setRecordIncomeModal({
        open: false,
        source: 'ADVERTISING',
        amountKes: '',
        referenceId: '',
        description: '',
      });
      await Promise.all([loadSummary(), loadIncome(1)]);
      onChanged?.();
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to record income.');
    } finally {
      setSavingIncome(false);
    }
  }

  const kpis = summaryData?.kpis;

  return (
    <div className="space-y-6" data-testid="admin-wallet-panel">
      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#ff6600]" />
            <span>Buyoll Unified Admin Wallet & Treasury</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            M-Pesa deposit verification, platform income ledger (EAT), held wallet balances, and automated ledger reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => void handleExportAdminWalletCsv()}
            disabled={exportingCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {exportingCsv ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>{exportingCsv ? 'Generating CSV...' : 'Export Ledger CSV'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRunReconciliation()}
            disabled={runningRecon}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningRecon ? 'animate-spin' : ''}`} />
            <span>{runningRecon ? 'Reconciling...' : 'Run Reconciliation'}</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      {summaryError && !kpis ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div className="text-xs text-red-800">
            <b className="block font-bold">Could not load Admin Wallet KPIs</b>
            <span>{summaryError}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="px-4 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      ) : summaryLoading && !kpis ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
              <div className="h-3 w-32 bg-slate-200 rounded" />
              <div className="h-7 w-28 bg-slate-300 rounded" />
              <div className="h-3 w-40 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500 mb-1">Total Deposits Approved</div>
            <div className="text-2xl font-black text-slate-900 tabular-nums" data-testid="kpi-deposits-approved">
              {formatKes(kpis?.totalDepositsApprovedKes || 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span>{kpis?.approvedDepositCount || 0} approved</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 font-semibold">
                {kpis?.pendingDepositCount || 0} pending ({formatKes(kpis?.totalDepositsPendingKes || 0)})
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500 mb-1">Total Income / Revenue</div>
            <div className="text-2xl font-black text-emerald-700 tabular-nums" data-testid="kpi-total-income">
              {formatKes(kpis?.totalIncomeRevenueKes || 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span>Wallet: {formatKes(kpis?.walletFundedIncomeKes || 0)}</span>
              <span aria-hidden="true">·</span>
              <span>M-Pesa Direct: {formatKes(kpis?.directMpesaIncomeKes || 0)}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500 mb-1">Total Held in User Wallets</div>
            <div className="text-2xl font-black text-slate-900 tabular-nums" data-testid="kpi-total-held">
              {formatKes(kpis?.totalHeldInUserWalletsKes || 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span>Available: {formatKes(kpis?.availableHeldKes || 0)}</span>
              <span aria-hidden="true">·</span>
              <span>Locked Loans: {formatKes(kpis?.restrictedHeldKes || 0)}</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500 mb-1">Platform Wallet Balance</div>
            <div className="text-2xl font-black text-[#ff6600] tabular-nums" data-testid="kpi-platform-balance">
              {formatKes(kpis?.platformWalletBalanceKes || 0)}
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5">
              <span>Treasury account</span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  reconciliation?.status === 'MISMATCH'
                    ? 'text-red-700 font-bold'
                    : 'text-emerald-700 font-semibold'
                }
              >
                {reconciliation ? `Reconciliation: ${reconciliation.status}` : 'Ready'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reconciliation Status Banner */}
      {reconciliation && (
        <div
          className={`border rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
            reconciliation.status === 'MISMATCH'
              ? 'bg-red-50 border-red-200 text-red-950'
              : 'bg-emerald-50 border-emerald-200 text-emerald-950'
          }`}
          data-testid="reconciliation-status-banner"
        >
          <div className="flex items-start gap-3">
            {reconciliation.status === 'MISMATCH' ? (
              <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">
                  Ledger Reconciliation: {reconciliation.status}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums font-mono">{reconciliation.eatTimestamp}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">Trigger: {reconciliation.trigger}</span>
              </div>
              <p className="text-[11px] opacity-90">
                {reconciliation.notes} · Diff:{' '}
                <b className="tabular-nums">{formatKes(reconciliation.diffCents / 100)}</b> · Wallet Ledger Mismatches:{' '}
                <b className="tabular-nums">{reconciliation.walletMismatchCount}</b>
              </p>
            </div>
          </div>

          <div className="text-[11px] font-mono tabular-nums text-right shrink-0 space-y-0.5">
            <div>Expected Pool: {formatKes(reconciliation.leftSideCents / 100)}</div>
            <div>Held + Revenue: {formatKes(reconciliation.rightSideCents / 100)}</div>
          </div>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('deposits')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'deposits' ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            M-Pesa Deposits ({kpis?.pendingDepositCount || 0} Pending)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('income')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'income' ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Income & Revenue
          </button>
          <button
            type="button"
            onClick={() => setSubTab('held')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              subTab === 'held' ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Held in Wallets
          </button>
        </div>

        {subTab === 'income' && (
          <button
            type="button"
            onClick={() => setRecordIncomeModal((prev) => ({ ...prev, open: true }))}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Direct M-Pesa Income</span>
          </button>
        )}
      </div>

      {/* SUB-TAB 1: M-PESA DEPOSITS */}
      {subTab === 'deposits' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={depositSearch}
                onChange={(e) => {
                  setDepositSearch(e.target.value);
                  setDepositPage(1);
                }}
                placeholder="Search M-Pesa code, merchant/member name, or phone..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={depositStatusFilter}
                onChange={(e) => {
                  setDepositStatusFilter(e.target.value);
                  setDepositPage(1);
                }}
                className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending Only</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
              </select>

              <select
                value={depositRoleFilter}
                onChange={(e) => {
                  setDepositRoleFilter(e.target.value);
                  setDepositPage(1);
                }}
                className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">All Roles</option>
                <option value="merchant">Merchants</option>
                <option value="member">Members</option>
                <option value="lender">Lenders</option>
              </select>
            </div>
          </div>

          {depositsError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-red-800">{depositsError}</p>
              <button
                type="button"
                onClick={() => void loadDeposits(depositPage)}
                className="px-4 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : depositsLoading && deposits.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-11 bg-slate-100 rounded-lg" />
              ))}
            </div>
          ) : deposits.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No deposits match this filter</p>
              <p className="text-[11px] text-slate-500 mt-1">
                When merchants, members, or lenders submit M-Pesa wallet deposits, they appear here for verification.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">User / Account</th>
                      <th className="py-3 px-4">M-Pesa Code</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Submitted (UTC)</th>
                      <th className="py-3 px-4">Status & Notes</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deposits.map((dep: any) => (
                      <tr key={dep.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{dep.userName}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                            <span className="capitalize">{dep.role || 'member'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{dep.userPhone || dep.phone}</span>
                            {dep.shopName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{dep.shopName}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{dep.mpesaCode}</td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900 tabular-nums">
                          {formatKes(dep.amount)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-slate-500 tabular-nums">
                          {new Date(dep.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <div
                            className={`text-xs font-semibold flex items-center gap-1.5 ${
                              dep.status === 'approved'
                                ? 'text-emerald-700'
                                : dep.status === 'declined' || dep.status === 'rejected'
                                ? 'text-red-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {dep.status === 'approved' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : dep.status === 'declined' || dep.status === 'rejected' ? (
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span className="capitalize">{dep.status}</span>
                          </div>
                          {dep.notes && (
                            <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                              {dep.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {dep.status === 'pending' ? (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                disabled={processingDepositId === dep.id}
                                onClick={() => void handleApproveDeposit(dep)}
                                className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                              >
                                {processingDepositId === dep.id ? 'Processing...' : 'Approve & Credit'}
                              </button>
                              <button
                                type="button"
                                disabled={processingDepositId === dep.id}
                                onClick={() => setDeclineModal({ open: true, deposit: dep, reason: '' })}
                                className="px-3 py-1.5 bg-white hover:bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                              >
                                Decline
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              {dep.processedBy ? `By ${dep.processedBy}` : 'Settled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {depositsPagination && depositsPagination.totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs">
                  <span className="text-slate-600 tabular-nums">
                    Page {depositsPagination.page} of {depositsPagination.totalPages} · {depositsPagination.total} records
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={depositsLoading || depositsPagination.page <= 1}
                      onClick={() => setDepositPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous</span>
                    </button>
                    <button
                      type="button"
                      disabled={depositsLoading || depositsPagination.page >= depositsPagination.totalPages}
                      onClick={() => setDepositPage((p) => p + 1)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: INCOME & REVENUE */}
      {subTab === 'income' && (
        <div className="space-y-5">
          {/* Category Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {INCOME_SOURCE_META.map(({ key, label }) => {
              const cat = incomeData?.totalsBySource?.find((t) => t.source === key);
              const val = cat?.totalKes ?? summaryData?.bySourceKes?.[key] ?? 0;
              const active = incomeSourceFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setIncomeSourceFilter(active ? 'all' : key);
                    setIncomePage(1);
                  }}
                  className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#fff4ec] border-[#ff6600] text-slate-900'
                      : 'bg-white border-slate-200 hover:border-slate-300 text-slate-900'
                  }`}
                >
                  <div className="text-[11px] font-medium text-slate-500 truncate">{label}</div>
                  <div className="text-sm font-black tabular-nums mt-1">{formatKes(val)}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                    {cat?.count ?? 0} entries
                  </div>
                </button>
              );
            })}
          </div>

          {/* Time Rollup Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              {(['hour', 'day', 'month', 'year'] as Granularity[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize cursor-pointer ${
                    granularity === g ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  By {g} (EAT)
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={incomeSourceFilter}
                onChange={(e) => {
                  setIncomeSourceFilter(e.target.value);
                  setIncomePage(1);
                }}
                className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">All Income Sources</option>
                {INCOME_SOURCE_META.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>

              <select
                value={incomeChannelFilter}
                onChange={(e) => {
                  setIncomeChannelFilter(e.target.value);
                  setIncomePage(1);
                }}
                className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">All Payment Channels</option>
                <option value="WALLET">User Wallet Spend</option>
                <option value="MPESA_DIRECT">Direct M-Pesa</option>
              </select>
            </div>
          </div>

          {incomeError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-red-800">{incomeError}</p>
              <button
                type="button"
                onClick={() => void loadIncome(incomePage)}
                className="px-4 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : incomeLoading && !incomeData ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* EAT Time Series Buckets */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 capitalize">
                    {granularity}ly Revenue Rollup (EAT)
                  </h3>
                  <span className="text-[11px] text-slate-500">Africa/Nairobi</span>
                </div>
                {(incomeData?.series || []).length === 0 ? (
                  <p className="text-xs text-slate-500 p-8 text-center">No revenue buckets for current filters.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Period (EAT)</th>
                          <th className="py-2.5 px-3 text-right">Wallet</th>
                          <th className="py-2.5 px-3 text-right">Direct</th>
                          <th className="py-2.5 px-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(incomeData?.series || []).map((row) => (
                          <tr key={row.bucket} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">{row.bucket}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {formatKes(row.walletKes)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {formatKes(row.mpesaDirectKes)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-bold text-emerald-700">
                              {formatKes(row.totalKes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Paginated Income Ledger */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">Platform Income Ledger</h3>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {incomeData?.pagination?.total || 0} entries
                  </span>
                </div>
                {(incomeData?.entries || []).length === 0 ? (
                  <p className="text-xs text-slate-500 p-8 text-center">No income entries recorded yet.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 px-3">Source & Details</th>
                            <th className="py-2.5 px-3">Channel</th>
                            <th className="py-2.5 px-3">EAT Date</th>
                            <th className="py-2.5 px-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(incomeData?.entries || []).map((entry: PlatformIncomeRecord & { amountKes: number; sourceLabel: string }) => (
                            <tr key={entry.id} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-slate-900">{entry.sourceLabel}</div>
                                <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-xs">
                                  {entry.userName || 'Platform'} · <span className="font-mono">{entry.referenceId}</span> · {entry.description}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-slate-600">
                                {entry.paymentChannel === 'MPESA_DIRECT' ? 'M-Pesa Direct' : 'Wallet Spend'}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                {entry.eatDateKey}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-700 tabular-nums">
                                {formatKes(entry.amountKes)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {incomeData?.pagination && incomeData.pagination.totalPages > 1 && (
                      <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs">
                        <span className="text-slate-600 tabular-nums">
                          Page {incomeData.pagination.page} of {incomeData.pagination.totalPages}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={incomeLoading || incomeData.pagination.page <= 1}
                            onClick={() => setIncomePage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            disabled={incomeLoading || incomeData.pagination.page >= incomeData.pagination.totalPages}
                            onClick={() => setIncomePage((p) => p + 1)}
                            className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: HELD IN USER WALLETS */}
      {subTab === 'held' && (
        <div className="space-y-4">
          {heldData?.summaryByRole && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {heldData.summaryByRole.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => {
                    setHeldRoleFilter(heldRoleFilter === r.role ? 'all' : r.role);
                    setHeldPage(1);
                  }}
                  className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                    heldRoleFilter === r.role
                      ? 'bg-[#fff4ec] border-[#ff6600]'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-600 capitalize">{r.role} Wallets</div>
                  <div className="text-lg font-black text-slate-900 tabular-nums mt-1">
                    {formatKes(r.totalHeldKes)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                    {r.walletCount} accounts · Restricted: {formatKes(r.restrictedKes)}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={heldSearch}
                onChange={(e) => {
                  setHeldSearch(e.target.value);
                  setHeldPage(1);
                }}
                placeholder="Search holder name, shop, phone, or platform ID..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
              />
            </div>

            <select
              value={heldRoleFilter}
              onChange={(e) => {
                setHeldRoleFilter(e.target.value);
                setHeldPage(1);
              }}
              className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Roles</option>
              <option value="member">Members</option>
              <option value="merchant">Merchants</option>
              <option value="lender">Lenders</option>
              <option value="admin">Admin Treasury</option>
            </select>
          </div>

          {heldError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center space-y-2">
              <p className="text-xs font-semibold text-red-800">{heldError}</p>
              <button
                type="button"
                onClick={() => void loadHeld(heldPage)}
                className="px-4 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : heldLoading && !heldData ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 animate-pulse">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Account Holder</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4 text-right">Available Balance</th>
                      <th className="py-3 px-4 text-right">Restricted Loan Balance</th>
                      <th className="py-3 px-4 text-right">Total Held</th>
                      <th className="py-3 px-4 text-right">Coins / Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(heldData?.wallets || []).map((w) => (
                      <tr key={`${w.userId}_${w.role}`} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{w.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {w.platformId || `#${w.userId}`} · {w.phone}
                            {w.shopName ? ` · ${w.shopName}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 capitalize text-slate-700 font-medium">{w.role}</td>
                        <td className="py-3 px-4 text-right tabular-nums font-semibold text-slate-900">
                          {formatKes(w.availableKes)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-amber-700 font-semibold">
                          {formatKes(w.restrictedKes)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums font-black text-slate-900">
                          {formatKes(w.totalKes)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-[11px] text-slate-500">
                          {w.coins.toLocaleString()} coins · {w.points.toLocaleString()} pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {heldData?.pagination && heldData.pagination.totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs">
                  <span className="text-slate-600 tabular-nums">
                    Page {heldData.pagination.page} of {heldData.pagination.totalPages} · {heldData.pagination.total} wallets
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={heldLoading || heldData.pagination.page <= 1}
                      onClick={() => setHeldPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={heldLoading || heldData.pagination.page >= heldData.pagination.totalPages}
                      onClick={() => setHeldPage((p) => p + 1)}
                      className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700 disabled:opacity-40 cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MANDATORY DEPOSIT DECLINE REASON MODAL */}
      {declineModal.open && declineModal.deposit && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmDeclineDeposit}
            className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Decline M-Pesa Deposit</h3>
              <button
                type="button"
                onClick={() => setDeclineModal({ open: false, deposit: null, reason: '' })}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Declining <b>{formatKes(declineModal.deposit.amount)}</b> (Code:{' '}
              <b className="font-mono">{declineModal.deposit.mpesaCode}</b>) for <b>{declineModal.deposit.userName}</b>. No funds will be credited.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Mandatory Decline Reason <span className="text-red-600">*</span>
              </label>
              <textarea
                required
                minLength={3}
                rows={3}
                value={declineModal.reason}
                onChange={(e) => setDeclineModal((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="e.g. M-Pesa transaction code not found in Till 196853 statement."
                className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeclineModal({ open: false, deposit: null, reason: '' })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={processingDepositId === declineModal.deposit.id || declineModal.reason.trim().length < 3}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg disabled:opacity-50 cursor-pointer"
              >
                Confirm Decline
              </button>
            </div>
          </form>
        </div>
      )}

      {/* RECORD DIRECT PLATFORM REVENUE MODAL */}
      {recordIncomeModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitDirectIncome}
            className="bg-white rounded-2xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Record Direct M-Pesa Income</h3>
              <button
                type="button"
                onClick={() => setRecordIncomeModal((prev) => ({ ...prev, open: false }))}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Revenue Source</label>
                <select
                  value={recordIncomeModal.source}
                  onChange={(e) =>
                    setRecordIncomeModal((prev) => ({ ...prev, source: e.target.value as IncomeSource }))
                  }
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                >
                  {INCOME_SOURCE_META.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Amount (KES)</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  required
                  value={recordIncomeModal.amountKes}
                  onChange={(e) => setRecordIncomeModal((prev) => ({ ...prev, amountKes: e.target.value }))}
                  placeholder="e.g. 2500"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">M-Pesa / Reference Code</label>
                <input
                  type="text"
                  required
                  value={recordIncomeModal.referenceId}
                  onChange={(e) => setRecordIncomeModal((prev) => ({ ...prev, referenceId: e.target.value.toUpperCase() }))}
                  placeholder="e.g. TJK890MNP2"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  required
                  minLength={3}
                  rows={2}
                  value={recordIncomeModal.description}
                  onChange={(e) => setRecordIncomeModal((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="e.g. Homepage campaign banner fee or pass revenue"
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecordIncomeModal((prev) => ({ ...prev, open: false }))}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingIncome}
                className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg disabled:opacity-50 cursor-pointer"
              >
                {savingIncome ? 'Recording...' : 'Record Revenue'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AdminWalletPanel;
