import React, { useState, useEffect } from 'react';
import { User, PeerLoanRequest, ChamaGroup } from '../types.ts';
import { api } from '../api.ts';
import {
  HandCoins,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Users,
  AlertTriangle,
  Info,
  RefreshCw,
  Wallet,
  Coins,
  Filter,
  X,
  Phone,
} from 'lucide-react';

interface LendersDashboardPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const LendersDashboardPage: React.FC<LendersDashboardPageProps> = ({
  currentUser,
  onNavigate,
  onOpenAuth,
  onNotify,
}) => {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [myLenderGroups, setMyLenderGroups] = useState<ChamaGroup[]>([]);
  const [defaultedPool, setDefaultedPool] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'my-groups' | 'open' | 'funded' | 'my-claimed' | 'all'>('my-groups');
  const [claimingGroupId, setClaimingGroupId] = useState<number | null>(null);
  const [contactTarget, setContactTarget] = useState<{
    role: 'Borrower' | 'Moderator';
    name: string;
    phone: string;
    groupName: string;
    amount?: number;
  } | null>(null);

  useEffect(() => {
    loadLendersData();
  }, []);

  async function loadLendersData() {
    setLoading(true);
    try {
      const [alertsRes, groupsRes, defaultsRes, myGroupsRes] = await Promise.all([
        api.getLenderAlerts().catch(() => ({ alerts: [] })),
        api.getGroups(),
        api.getMyDefaults().catch(() => ({ defaults: [], refunds: [] })),
        api.getMyGroups().catch(() => ({ groups: [] })),
      ]);
      setAlerts(alertsRes.alerts || []);
      setGroups(groupsRes.groups || []);
      setDefaultedPool(defaultsRes.defaults || []);
      setMyLenderGroups(myGroupsRes.groups || []);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load Lenders Desk data.');
    } finally {
      setLoading(false);
    }
  }

  const [markingContactedId, setMarkingContactedId] = useState<number | null>(null);
  const [selectedLoanToFund, setSelectedLoanToFund] = useState<any | null>(null);
  const [submittingFund, setSubmittingFund] = useState(false);

  async function handleMarkContacted(loan: any) {
    if (!currentUser) {
      onNotify('info', 'Please sign in first.');
      onOpenAuth();
      return;
    }
    setMarkingContactedId(loan.id);
    try {
      const res = await api.markLoanContacted(loan.groupId, loan.id);
      onNotify('success', res.message);
      loadLendersData();
    } catch (err: any) {
      onNotify('error', err.message || 'Could not mark loan contacted.');
    } finally {
      setMarkingContactedId(null);
    }
  }

  async function handleConfirmFund(loan: any) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to fund this peer loan.');
      onOpenAuth();
      return;
    }

    const currentBalance = Number(currentUser.roleWallets?.lender?.credit ?? currentUser.credit ?? 0);
    if (currentBalance < loan.amount) {
      onNotify('error', `Insufficient wallet balance. You have KSh ${currentBalance.toLocaleString()} but need KSh ${loan.amount.toLocaleString()} to fund this loan. Please deposit funds first.`);
      return;
    }

    setSubmittingFund(true);
    try {
      const res = await api.fundLoan(loan.id, loan.groupId);
      if (res.lenderBalance !== undefined) {
        currentUser.credit = res.lenderBalance;
      }
      onNotify('success', res.message || 'Loan funded atomically! 99% net credited to borrower group-locked balance, 1% platform fee recorded.');
      setSelectedLoanToFund(null);
      loadLendersData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to fund loan');
    } finally {
      setSubmittingFund(false);
    }
  }

  // Filter alerts
  const filteredAlerts = alerts.filter(a => {
    if (filterTab === 'open') return a.status === 'open' || a.status === 'contacted';
    if (filterTab === 'funded') return a.status === 'funded';
    if (filterTab === 'my-claimed') return Boolean(a.isAuthorizedForGroup || (currentUser && a.groupLenderId === currentUser.id));
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-md mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 text-emerald-300 rounded-full text-xs font-bold uppercase tracking-wider mb-3 border border-emerald-500/30">
              <HandCoins className="w-3.5 h-3.5" />
              <span>Group Peer-to-Peer Capital Desk</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">
              Lenders Hub & Group Financing Requests
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed">
              Review financing requests from groups where a Group Moderator has authorized you. Upon atomic funding from your lender wallet, a <b>1% platform fee</b> is recorded for Buyoll and <b>99% net</b> is credited directly to the borrower’s non-withdrawable balance locked strictly to that group. Loan contracts and repayments are handled externally.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0">
            <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-xl p-3.5 text-center sm:text-left">
              <div className="text-xs text-emerald-200 uppercase font-semibold">Active Group Alerts</div>
              <div className="text-2xl font-black text-white">{alerts.filter(a => a.status === 'open' || a.status === 'contacted').length} Open</div>
            </div>
            <button
              onClick={loadLendersData}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-emerald-950 font-bold text-xs rounded-xl hover:bg-emerald-50 transition-colors shadow-sm cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Desk</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rules & Policy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-xs">
        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#ff6600] flex items-center justify-center shrink-0 font-bold">
            1
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">Group-Scoped Authorization</span>
            <span className="text-slate-500 leading-normal">
              Group Moderators or Admins authorize lenders per group before borrowers’ contact details and funding unlock.
            </span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold">
            2
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">1% Platform Fee (Atomic)</span>
            <span className="text-slate-500 leading-normal">
              1% fee is recorded atomically on disbursement; 99% net is credited directly to the borrower’s group wallet.
            </span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center shrink-0 font-bold">
            3
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">Group-Locked Proceeds</span>
            <span className="text-slate-500 leading-normal">
              Disbursed loan funds are non-withdrawable and locked exclusively to the funded group’s installments.
            </span>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilterTab('my-groups')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              filterTab === 'my-groups'
                ? 'bg-[#ff6600] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            My Groups ({myLenderGroups.length})
          </button>
          <button
            onClick={() => setFilterTab('open')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              filterTab === 'open'
                ? 'bg-[#ff6600] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Open Loan Requests ({alerts.filter(a => a.status === 'open').length})
          </button>
          <button
            onClick={() => setFilterTab('funded')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              filterTab === 'funded'
                ? 'bg-[#ff6600] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Funded ({alerts.filter(a => a.status === 'funded').length})
          </button>
          {currentUser && (
            <button
              onClick={() => setFilterTab('my-claimed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                filterTab === 'my-claimed'
                  ? 'bg-[#ff6600] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              My Claimed Groups
            </button>
          )}
          <button
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              filterTab === 'all'
                ? 'bg-[#ff6600] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Alerts ({alerts.length})
          </button>
        </div>

        <span className="text-xs text-slate-500 font-medium">
          {filterTab === 'my-groups'
            ? `${myLenderGroups.length} Active Lender Group${myLenderGroups.length !== 1 ? 's' : ''}`
            : `Showing ${filteredAlerts.length} alert${filteredAlerts.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* MY GROUPS (LENDER) VIEW */}
      {filterTab === 'my-groups' && (
        <div className="mb-12">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-emerald-950">
                  My Groups (Lender Portfolio)
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full uppercase">
                  Read-Only Oversight
                </span>
              </div>
              <p className="text-xs text-emerald-800/90 mt-0.5">
                Shows every group where you have lent money to a member. Track member progress, view loan requests, and contact moderators or borrowers.
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-900 bg-white border border-emerald-200 px-3 py-1.5 rounded-xl shrink-0 self-start sm:self-auto">
              {myLenderGroups.length} Funded Group{myLenderGroups.length !== 1 ? 's' : ''}
            </span>
          </div>

          {myLenderGroups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-900 mb-1">No funded groups yet</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                Ask a Group Moderator to authorize you, then review open loan requests in that group to fund members safely inside an atomic transaction (1% platform fee).
              </p>
              <button
                onClick={() => setFilterTab('open')}
                className="px-4 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Browse Open Loan Requests
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {myLenderGroups.map((g) => {
                const groupCapacity = g.totalSlots || g.size || 10;
                const totalCollected = g.slots.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
                const target = (g.productPrice || 0) * groupCapacity;
                const progress = Math.min(100, Math.round((totalCollected / (target || 1)) * 100));

                return (
                  <div
                    key={g.id}
                    className="bg-white border border-slate-200 hover:border-emerald-300 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                          Lender Desk Assigned
                        </span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded">
                          {g.occupiedCount} of {groupCapacity} Members
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 mb-0.5 line-clamp-1">{g.name}</h4>
                      <p className="text-xs text-slate-500 line-clamp-1 mb-3">{g.productTitle}</p>

                      <div className="p-3 bg-slate-50 rounded-xl mb-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Group Rotation Progress:</span>
                          <b className="text-slate-900">{progress}%</b>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff6600] rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 pt-0.5">
                          <span>Paid: KSh {totalCollected.toLocaleString()}</span>
                          <span>Daily: KSh {g.dailyAmount?.toLocaleString()}/day</span>
                        </div>
                      </div>

                      {/* Contact Actions */}
                      <div className="flex items-center gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setContactTarget({
                            role: 'Moderator',
                            name: (g as any).adminName || 'Group Moderator',
                            phone: (g as any).adminPhone || '0722000000',
                            groupName: g.name,
                          })}
                          className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors"
                        >
                          <Phone className="w-3 h-3 text-slate-600" />
                          <span>Contact Mod</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setContactTarget({
                            role: 'Borrower',
                            name: 'Funded Member',
                            phone: '0712345678',
                            groupName: g.name,
                          })}
                          className="flex-1 py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors"
                        >
                          <Phone className="w-3 h-3 text-emerald-600" />
                          <span>Contact Borrower</span>
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => onNavigate('group', g.id)}
                      className="w-full py-2 bg-slate-900 hover:bg-[#ff6600] text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>View Progress &amp; Members (Read-Only)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Alerts Grid (when not in my-groups tab) */}
      {filterTab !== 'my-groups' && filteredAlerts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center mb-12">
          <HandCoins className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            No loan alerts in this filter
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            When standard members in Groups request loan support for their daily contributions, their requests appear here with direct group links.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {filteredAlerts.map((alert) => {
            const isFunded = alert.status === 'funded';
            const isContacted = alert.status === 'contacted';
            const fee = alert.platformFeeAmount ?? Math.round(alert.amount * 0.01);
            const netAmt = alert.netDisbursedAmount ?? (alert.amount - fee);
            const isAuthorized = Boolean(alert.isAuthorizedForGroup || currentUser?.role === 'admin');

            return (
              <div
                key={alert.id}
                className={`bg-white border rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-md ${
                  isFunded
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : isContacted
                    ? 'border-blue-200 bg-blue-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  {/* Card Header: Group & Status */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                      Group #{alert.groupId}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        isFunded
                          ? 'bg-emerald-100 text-emerald-800'
                          : isContacted
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {isFunded ? 'Funded' : isContacted ? 'Contacted' : 'Awaiting Lender'}
                    </span>
                  </div>

                  {/* Product Title */}
                  <h3 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1">
                    {alert.productTitle || alert.groupName}
                  </h3>
                  <div className="text-xs text-slate-500 mb-3 truncate">
                    Group: <b>{alert.groupName}</b>
                  </div>

                  {/* Loan Amount Callout */}
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl mb-3 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Requested Loan
                      </span>
                      <span className="text-base font-extrabold text-slate-900">
                        KSh {alert.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>1% Platform Fee:</span>
                      <span className="font-bold text-[#FF6A00]">KSh {fee.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-emerald-700 font-semibold">
                      <span>99% Net Group-Locked:</span>
                      <span>KSh {netAmt.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Member & Description */}
                  <div className="text-xs text-slate-700 mb-3 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Borrower:</span>
                      <span className="font-semibold text-slate-900">
                        {alert.requesterName} ({alert.borrowerCode || `Slot #${alert.slotNumber}`})
                      </span>
                    </div>
                    {alert.requesterPhone && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Direct Phone:</span>
                        <a href={`tel:${alert.requesterPhone}`} className="font-mono font-bold text-[#ff6600] hover:underline">
                          {alert.requesterPhone}
                        </a>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400">Purpose: </span>
                      <span className="italic text-slate-600">{alert.purpose}</span>
                    </div>
                  </div>

                  {/* Group Authorization Status */}
                  <div className="p-2.5 rounded-lg border text-xs mb-4 flex items-center justify-between gap-2 bg-slate-50 border-slate-200">
                    <span className="text-[11px] text-slate-600 font-medium">Group Access:</span>
                    {isAuthorized ? (
                      <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Authorized for Group</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                        Moderator Authorization Needed
                      </span>
                    )}
                  </div>
                </div>

                {/* Direct Actions */}
                <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                  {!isFunded && isAuthorized && !isContacted && (
                    <button
                      onClick={() => handleMarkContacted(alert)}
                      disabled={markingContactedId === alert.id}
                      className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {markingContactedId === alert.id ? 'Updating...' : 'Mark Contacted'}
                    </button>
                  )}
                  {!isFunded && isAuthorized && (
                    <button
                      onClick={() => setSelectedLoanToFund(alert)}
                      className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <HandCoins className="w-3.5 h-3.5" />
                      <span>Fund Loan (KSh {alert.amount.toLocaleString()})</span>
                    </button>
                  )}
                  <button
                    onClick={() => onNavigate('group', alert.groupId)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Open Group #{alert.groupId}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ATOMIC LOAN FUNDING MODAL (1% PLATFORM FEE / 99% GROUP-LOCKED) */}
      {selectedLoanToFund && (() => {
        const fee1Pct = selectedLoanToFund.platformFeeAmount ?? Math.round(selectedLoanToFund.amount * 0.01);
        const net99Pct = selectedLoanToFund.netDisbursedAmount ?? (selectedLoanToFund.amount - fee1Pct);
        const lenderBal = Number(currentUser?.roleWallets?.lender?.credit ?? currentUser?.credit ?? 0);
        return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedLoanToFund(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <HandCoins className="w-4 h-4" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">
                Fund Loan Request #{selectedLoanToFund.id}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Atomic transaction credits 99% net to borrower’s group-locked wallet balance and records the 1% platform fee.
            </p>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-500">Borrower:</span>
                <b className="text-slate-900">{selectedLoanToFund.requesterName} ({selectedLoanToFund.borrowerCode || `Slot #${selectedLoanToFund.slotNumber}`})</b>
              </div>
              {selectedLoanToFund.requesterPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Borrower Phone:</span>
                  <b className="text-slate-900 font-mono">{selectedLoanToFund.requesterPhone}</b>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Group:</span>
                <span className="text-slate-700">{selectedLoanToFund.groupName}</span>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex justify-between">
                <span className="text-slate-500">Loan Principal Debited:</span>
                <b className="text-slate-900 font-mono">KSh {selectedLoanToFund.amount.toLocaleString()}</b>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>99% Net Disbursed (Group-Locked):</span>
                <b className="font-mono">KSh {net99Pct.toLocaleString()}</b>
              </div>
              <div className="flex justify-between text-[#FF6A00]">
                <span>1% Platform Fee (Buyoll):</span>
                <b className="font-mono">KSh {fee1Pct.toLocaleString()}</b>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex justify-between">
                <span className="text-slate-500">Your Wallet Balance:</span>
                <b className={`font-mono ${lenderBal >= selectedLoanToFund.amount ? 'text-emerald-700' : 'text-red-600'}`}>
                  KSh {lenderBal.toLocaleString()}
                </b>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 mb-4 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <b>External Repayment Disclaimer:</b> Buyoll provides non-withdrawable shopping and Group installment credit only. All repayment schedules, interest, and debt collection are arranged and executed manually between you and the borrower off-platform.
              </div>
            </div>

            {/* Balance check warning */}
            {(currentUser?.credit || 0) < selectedLoanToFund.amount && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 mb-4 flex items-center justify-between">
                <span>Insufficient balance! Top up your wallet to proceed.</span>
                <button
                  onClick={() => onNavigate('wallet')}
                  className="px-2.5 py-1 bg-red-600 text-white font-bold rounded text-[11px]"
                >
                  Go to Wallet
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedLoanToFund(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmFund(selectedLoanToFund)}
                disabled={submittingFund || lenderBal < selectedLoanToFund.amount}
                className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {submittingFund ? 'Disbursing Funds...' : 'Confirm Atomic Funding'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* SECTION: REMOVED MEMBERS & REFUND POOL */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-[#ff6600]" />
              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                Removed Members & Re-Entry Pool
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              When members are removed by moderators for missing daily contributions, their funds are refunded directly to their Buyoll wallet. 
              They can use their refunded balance to start fresh or join another active speed group immediately.
            </p>
          </div>
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors shrink-0 self-start sm:self-auto"
          >
            <span>Explore Active Speeds</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div className="p-4 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
            <div className="flex items-center gap-2 font-bold text-emerald-900 mb-1">
              <Wallet className="w-4 h-4 text-emerald-700" />
              <span>Instant Wallet Refund</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Moderator removal immediately vacates the slot and refunds all contributed installment funds to the user's wallet credit.
            </p>
          </div>

          <div className="p-4 bg-blue-50/60 border border-blue-200/60 rounded-xl">
            <div className="flex items-center gap-2 font-bold text-blue-900 mb-1">
              <RefreshCw className="w-4 h-4 text-blue-700" />
              <span>Re-Join Any Speed</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Removed members do not lose money; they can use their wallet credit to take an open slot in a 10, 8, 6, 4, or 2 member group.
            </p>
          </div>

          <div className="p-4 bg-amber-50/60 border border-amber-200/60 rounded-xl">
            <div className="flex items-center gap-2 font-bold text-amber-900 mb-1">
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span>Vacant Slot Openings</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Once a member is removed, their vacant slot is immediately open for new incoming members with the group invite code.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Moderator / Borrower Modal */}
      {contactTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setContactTarget(null)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 bg-emerald-100 text-emerald-800 rounded-full flex items-center justify-center mb-3">
              <Phone className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900 mb-1">
              Contact {contactTarget.role}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Direct connection for loan oversight and repayment coordination in <b>{contactTarget.groupName}</b>.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1 mb-4">
              <div className="flex justify-between">
                <span className="text-slate-500">Contact Name:</span>
                <b className="text-slate-900">{contactTarget.name}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Phone Number:</span>
                <b className="text-slate-900 font-mono">{contactTarget.phone}</b>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={`tel:${contactTarget.phone}`}
                className="w-full py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl text-center shadow-xs"
              >
                Call Phone ({contactTarget.phone})
              </a>
              <a
                href={`https://wa.me/${contactTarget.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hello ${contactTarget.name}, reaching out regarding Buyoll Group "${contactTarget.groupName}".`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 bg-[#25D366] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl text-center shadow-xs"
              >
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
