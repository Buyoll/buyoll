import React, { useState, useEffect } from 'react';
import { ChamaActivityItem, ChamaGroup, User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  Activity,
  Coins,
  CreditCard,
  HandCoins,
  Users,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Filter,
  ArrowUpRight,
  ShieldCheck,
  Award,
} from 'lucide-react';

interface ChamaActivityFeedProps {
  groupId: number;
  group: ChamaGroup;
  currentUser: User | null;
  onNavigate?: (view: string, arg?: any) => void;
}

export const ChamaActivityFeed: React.FC<ChamaActivityFeedProps> = ({
  groupId,
  group,
  currentUser,
  onNavigate,
}) => {
  const [activities, setActivities] = useState<ChamaActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    loadActivities();
  }, [groupId]);

  async function loadActivities() {
    setLoading(true);
    try {
      const res = await api.getGroupActivities(groupId);
      setActivities(res.activities || []);
    } catch (err) {
      console.warn('Failed to fetch group activities:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await api.getGroupActivities(groupId);
      setActivities(res.activities || []);
    } finally {
      setRefreshing(false);
    }
  }

  const filteredActivities = activities.filter((act) => {
    if (filterType === 'all') return true;
    if (filterType === 'contributions') return act.type === 'contribution';
    if (filterType === 'loans') return act.type === 'loan_application' || act.type === 'loan_funded';
    if (filterType === 'coins') return act.type === 'coin_award';
    if (filterType === 'milestones') return act.type === 'status_update' || act.type === 'member_joined';
    return true;
  });

  const getActivityIcon = (type: ChamaActivityItem['type']) => {
    switch (type) {
      case 'contribution':
        return <CreditCard className="w-4 h-4 text-emerald-600" />;
      case 'loan_application':
        return <Clock className="w-4 h-4 text-amber-500" />;
      case 'loan_funded':
        return <HandCoins className="w-4 h-4 text-indigo-600" />;
      case 'coin_award':
        return <Coins className="w-4 h-4 text-amber-500" />;
      case 'member_joined':
        return <Users className="w-4 h-4 text-teal-600" />;
      case 'status_update':
      default:
        return <Sparkles className="w-4 h-4 text-blue-600" />;
    }
  };

  const getActivityBadge = (type: ChamaActivityItem['type']) => {
    switch (type) {
      case 'contribution':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Paid Installment</span>;
      case 'loan_application':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Loan Request</span>;
      case 'loan_funded':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">Peer Funded</span>;
      case 'coin_award':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 flex items-center gap-1">🌟 Applauded</span>;
      case 'member_joined':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">Member Joined</span>;
      case 'status_update':
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Milestone</span>;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs mb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-[#0E5A3C] flex items-center justify-center font-bold">
              <Activity className="w-4 h-4" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
              Chama Activity Feed
            </h3>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold text-xs rounded-full">
              {activities.length} Events
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time audit log of member contributions, loan applications, peer funding, and coin awards.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Financial Transparency Summary View: Total Member Contributions vs. Individual Goals */}
      {(() => {
        const totalContributed = group.slots.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
        const groupTarget = group.targetAmountPerRound || group.productPrice || (group.dailyAmount * group.cycleDays);
        const progressPercent = Math.min(100, Math.round((totalContributed / Math.max(1, groupTarget)) * 100));
        const activeMembers = group.slots.filter(s => s.status === 'active' && s.userId);
        const totalArrears = group.slots.reduce((sum, s) => {
          const target = s.targetAmount || group.dailyAmount;
          return sum + Math.max(0, target - (s.paidAmount || 0));
        }, 0);

        return (
          <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-emerald-50/80 via-teal-50/40 to-slate-50 border border-emerald-200/80 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-emerald-200/60">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-[#0E5A3C] text-white rounded-lg shadow-xs">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-emerald-950 uppercase tracking-wide">
                    Financial Transparency Summary
                  </h4>
                  <p className="text-[11px] text-emerald-800/80">
                    Total member contributions vs. individual goals across {group.size} Chama slots
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-mono font-black text-[#0E5A3C] bg-white px-2.5 py-1 rounded-full border border-emerald-300 shadow-2xs">
                  {progressPercent}% Complete
                </span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Total Collected
                </span>
                <span className="text-base sm:text-lg font-black text-[#0E5A3C] tabular-nums">
                  KSh {totalContributed.toLocaleString()}
                </span>
                <span className="text-[10px] text-emerald-700 block mt-0.5">
                  From {activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Target Round Goal
                </span>
                <span className="text-base sm:text-lg font-black text-slate-900 tabular-nums">
                  KSh {groupTarget.toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  1 item per round cycle
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Daily Installment
                </span>
                <span className="text-base sm:text-lg font-black text-amber-700 tabular-nums">
                  KSh {group.dailyAmount.toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Due daily per slot
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Outstanding Arrears
                </span>
                <span className="text-base sm:text-lg font-black text-red-600 tabular-nums">
                  KSh {totalArrears.toLocaleString()}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  Pending recovery
                </span>
              </div>
            </div>

            {/* Overall Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between items-center text-[11px] mb-1.5 font-bold text-slate-700">
                <span>Round Delivery Progress</span>
                <span className="text-[#0E5A3C]">KSh {totalContributed.toLocaleString()} / KSh {groupTarget.toLocaleString()}</span>
              </div>
              <div className="w-full bg-emerald-100/70 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-[#0E5A3C] to-emerald-500 h-2.5 rounded-full transition-all duration-500 shadow-xs"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Individual Member Contributions vs. Goals Mini-Breakdown */}
            <details className="group/details mt-2">
              <summary className="text-xs font-bold text-[#0E5A3C] hover:text-emerald-800 cursor-pointer flex items-center justify-between list-none select-none py-1">
                <span>View Member-by-Member Goal Progress ({group.slots.length} slots)</span>
                <span className="text-[11px] bg-emerald-100 text-[#0E5A3C] px-2 py-0.5 rounded-full group-open/details:rotate-180 transition-transform">
                  ▼
                </span>
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                {group.slots.map((slot) => {
                  const slotTarget = slot.targetAmount || (group.productPrice / group.size);
                  const slotPaid = slot.paidAmount || 0;
                  const slotPercent = Math.min(100, Math.round((slotPaid / Math.max(1, slotTarget)) * 100));
                  const isCurrent = currentUser && slot.userId === currentUser.id;

                  return (
                    <div
                      key={slot.slotNumber}
                      className={`p-2.5 rounded-xl border text-xs transition-colors ${
                        isCurrent
                          ? 'bg-emerald-50/90 border-emerald-300 font-medium'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold text-slate-800 truncate">
                          Slot #{slot.slotNumber}: {slot.userName || (slot.status === 'open' ? 'Open Slot' : 'Unassigned')}
                          {isCurrent && <span className="text-[10px] text-emerald-700 ml-1 font-bold">(You)</span>}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-slate-600 shrink-0">
                          {slotPercent}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-1">
                        <div
                          className={`h-1.5 rounded-full ${
                            slotPercent >= 100 ? 'bg-emerald-500' : slotPercent > 50 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${slotPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Paid: KSh {slotPaid.toLocaleString()}</span>
                        <span>Goal: KSh {Math.round(slotTarget).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        );
      })()}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-1 text-xs">
        {[
          { key: 'all', label: 'All Activities' },
          { key: 'contributions', label: 'Contributions' },
          { key: 'loans', label: 'Peer Loans' },
          { key: 'coins', label: 'Coin Applauds' },
          { key: 'milestones', label: 'Milestones & Joins' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilterType(tab.key)}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
              filterType === tab.key
                ? 'bg-[#0E5A3C] text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Feed Content */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 space-y-2">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#0E5A3C]" />
          <p className="text-xs font-semibold">Loading Chama live activity log...</p>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="py-12 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-bold text-slate-700">No matching activities found</p>
          <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
            When members contribute daily M-Pesa payments, request emergency loans, or applaud each other with coins, events will appear here.
          </p>
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {filteredActivities.map((act) => (
            <div key={act.id} className="relative group">
              {/* Timeline Pin Dot */}
              <div className="absolute -left-6 top-1.5 w-6 h-6 rounded-full bg-white border-2 border-slate-300 group-hover:border-[#0E5A3C] flex items-center justify-center transition-colors shadow-xs">
                {getActivityIcon(act.type)}
              </div>

              {/* Activity Card */}
              <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl p-3.5 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-extrabold text-slate-900">
                      {act.title}
                    </span>
                    {getActivityBadge(act.type)}
                    {act.targetSlotNumber && (
                      <span className="text-[10px] font-mono font-bold bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded">
                        Slot #{act.targetSlotNumber}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(act.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">
                  {act.description}
                </p>

                {/* Amount or Coin Tag */}
                {(act.amount || act.coins) && (
                  <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-500 font-medium">Recorded Value:</span>
                    {act.amount && (
                      <span className="font-mono font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        KSh {act.amount.toLocaleString()}
                      </span>
                    )}
                    {act.coins && (
                      <span className="font-mono font-black text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-amber-500" />
                        {act.coins} Coins
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
