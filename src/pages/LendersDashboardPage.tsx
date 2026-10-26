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
  const [defaultedPool, setDefaultedPool] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'open' | 'funded' | 'my-claimed' | 'all'>('open');
  const [claimingGroupId, setClaimingGroupId] = useState<number | null>(null);

  useEffect(() => {
    loadLendersData();
  }, []);

  async function loadLendersData() {
    setLoading(true);
    try {
      const [alertsRes, groupsRes, defaultsRes] = await Promise.all([
        api.getLenderAlerts().catch(() => ({ alerts: [] })),
        api.getGroups(),
        api.getMyDefaults().catch(() => ({ defaults: [], refunds: [] })),
      ]);
      setAlerts(alertsRes.alerts || []);
      setGroups(groupsRes.groups || []);
      setDefaultedPool(defaultsRes.defaults || []);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load Lenders Desk data.');
    } finally {
      setLoading(false);
    }
  }

  // Claim lender seat in a group (enforcing 1 lender per group limit: 1st come, 1st served)
  async function handleEnterGroupAsLender(groupId: number) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to enter as a 3rd-party lender.');
      onOpenAuth();
      return;
    }

    setClaimingGroupId(groupId);
    try {
      const res = await api.claimGroupLender(groupId);
      onNotify('success', res.message || 'You have entered this Chama group as the dedicated lender!');
      // Navigate straight to the group page
      onNavigate('group', groupId);
    } catch (err: any) {
      onNotify('error', err.message || 'Could not claim lender seat.');
      // Still navigate if already claimed by this user
      if (err.message && err.message.includes('already')) {
        onNavigate('group', groupId);
      }
    } finally {
      setClaimingGroupId(null);
    }
  }

  // Filter alerts
  const filteredAlerts = alerts.filter(a => {
    if (filterTab === 'open') return a.status === 'open';
    if (filterTab === 'funded') return a.status === 'funded';
    if (filterTab === 'my-claimed') return currentUser && a.groupLenderId === currentUser.id;
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
              <span>Chama Peer-to-Peer Capital Desk</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">
              Lenders Hub & Group Financing Requests
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed">
              Review individual Chama group financing alerts, enter groups directly, and fund member wallets. 
              Each Chama group accepts strictly <b>1 lender at a time (first-come, first-served)</b>. 
              Lenders pay a mandatory <b>3% platform commission</b> (Platform Till: <b>196853</b>, Paybill: <b>522533</b>, Acc: <b>4363</b>) before loan disbursement console unlocks. Disbursed funds are non-withdrawable. Loan contracts and manual repayments are handled externally.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col gap-3 shrink-0">
            <div className="bg-white/10 backdrop-blur-xs border border-white/20 rounded-xl p-3.5 text-center sm:text-left">
              <div className="text-xs text-emerald-200 uppercase font-semibold">Active Group Alerts</div>
              <div className="text-2xl font-black text-white">{alerts.filter(a => a.status === 'open').length} Open</div>
            </div>
            <button
              onClick={loadLendersData}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-emerald-950 font-bold text-xs rounded-xl hover:bg-emerald-50 transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Desk</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rules & Policy Accordion / Notice */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-xs">
        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#0E5A3C] flex items-center justify-center shrink-0 font-bold">
            1
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">1 Lender Per Group Rule</span>
            <span className="text-slate-500 leading-normal">
              A group only accepts 1 lender at a time. The first lender to accept serves that group exclusively.
            </span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold">
            2
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">3% Mandatory Platform Fee</span>
            <span className="text-slate-500 leading-normal">
              Lender pays 3% fee to Platform Till: 196853 / Paybill: 522533 (Acc: 4363). Console unlocks upon admin approval.
            </span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-start gap-3 shadow-xs">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center shrink-0 font-bold">
            3
          </div>
          <div>
            <span className="font-bold text-slate-900 block mb-0.5">Non-Withdrawable Proceeds</span>
            <span className="text-slate-500 leading-normal">
              Disbursed principal is deposited into member wallet as non-withdrawable funds for shopping/chama only.
            </span>
          </div>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterTab('open')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterTab === 'open'
                ? 'bg-[#0E5A3C] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Open Loan Requests ({alerts.filter(a => a.status === 'open').length})
          </button>
          <button
            onClick={() => setFilterTab('funded')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterTab === 'funded'
                ? 'bg-[#0E5A3C] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Funded ({alerts.filter(a => a.status === 'funded').length})
          </button>
          {currentUser && (
            <button
              onClick={() => setFilterTab('my-claimed')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                filterTab === 'my-claimed'
                  ? 'bg-[#0E5A3C] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              My Claimed Groups
            </button>
          )}
          <button
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              filterTab === 'all'
                ? 'bg-[#0E5A3C] text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Alerts ({alerts.length})
          </button>
        </div>

        <span className="text-xs text-slate-500 font-medium">
          Showing {filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Alerts Grid */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center mb-12">
          <HandCoins className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            No loan alerts in this filter
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            When standard members in Chama groups request loan support for their daily contributions, their requests appear here with direct group links.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {filteredAlerts.map((alert) => {
            const isFunded = alert.status === 'funded';
            const fee = alert.platformFeeAmount || Math.max(1, Math.round(alert.amount * 0.03));
            const hasLender = Boolean(alert.groupLenderId);
            const isMyClaimed = currentUser && alert.groupLenderId === currentUser.id;

            return (
              <div
                key={alert.id}
                className={`bg-white border rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-md ${
                  isFunded
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  {/* Card Header: Group & Status */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                      Chama #{alert.groupId}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        isFunded
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {isFunded ? 'Funded' : 'Awaiting Lender'}
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
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl mb-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Requested Loan
                      </span>
                      <span className="text-base font-extrabold text-slate-900">
                        KSh {alert.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>3% Platform Commission:</span>
                      <span className="font-bold text-[#FF6A00]">KSh {fee.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Member & Description */}
                  <div className="text-xs text-slate-700 mb-3 space-y-1">
                    <div>
                      <span className="text-slate-400">Borrower: </span>
                      <span className="font-semibold">{alert.requesterName}</span> (Slot #{alert.slotNumber})
                    </div>
                    <div>
                      <span className="text-slate-400">Purpose: </span>
                      <span className="italic text-slate-600">{alert.purpose}</span>
                    </div>
                  </div>

                  {/* 1-Lender Per Group Indicator */}
                  <div className="p-2.5 rounded-lg border text-xs mb-4 flex items-center justify-between gap-2 bg-slate-50 border-slate-200">
                    <span className="text-[11px] text-slate-600 font-medium">Group Lender:</span>
                    {hasLender ? (
                      <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{isMyClaimed ? 'Served by You' : alert.groupLenderName || 'Assigned'}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                        Vacant · 1st Come 1st Served
                      </span>
                    )}
                  </div>
                </div>

                {/* Direct Group Link Button */}
                <div className="pt-2 border-t border-slate-100">
                  {hasLender && !isMyClaimed && !isFunded ? (
                    <button
                      onClick={() => onNavigate('group', alert.groupId)}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>View Group Chama #{alert.groupId}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleEnterGroupAsLender(alert.groupId)}
                      disabled={claimingGroupId === alert.groupId}
                      className="w-full py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5"
                    >
                      {claimingGroupId === alert.groupId ? (
                        <span>Entering Group...</span>
                      ) : (
                        <>
                          <span>{isMyClaimed ? 'Open My Group Desk' : 'Enter Group as 1st Lender'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION: REMOVED MEMBERS & REFUND POOL */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-[#0E5A3C]" />
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
    </div>
  );
};
