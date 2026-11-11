import React, { useState, useEffect } from 'react';
import { User, ChamaGroup } from '../types.ts';
import { api } from '../api.ts';
import { getUserActiveRole } from '../utils/rbac.ts';
import { Users, ArrowRight, ShieldCheck, Clock, CheckCircle, Store, Shield } from 'lucide-react';
import { TrustChamaSection } from '../components/TrustChamaSection.tsx';

interface MyChamasPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const MyChamasPage: React.FC<MyChamasPageProps> = ({
  currentUser,
  onNavigate,
  onOpenAuth,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'trust' | 'product'>('product');
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [recommendedGroups, setRecommendedGroups] = useState<ChamaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [quickJoinCode, setQuickJoinCode] = useState('');
  const [submittingJoin, setSubmittingJoin] = useState(false);

  const activeRole = getUserActiveRole(currentUser);
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (currentUserId) {
      loadMyGroups(true);
    } else {
      setGroups([]);
      setRecommendedGroups([]);
      setLoading(false);
      setHasLoaded(true);
    }
  }, [currentUserId]);

  async function loadMyGroups(isInitial = false) {
    if (!currentUser) return;
    if (isInitial || !hasLoaded) {
      setLoading(true);
    }
    try {
      const [res, allGroupsRes] = await Promise.all([
        api.getMyGroups(),
        api.getGroups().catch(() => ({ groups: [] })),
      ]);
      const myJoined = res.groups || [];
      setGroups(myJoined);
      const myIds = new Set(myJoined.map(g => g.id));
      const openVacant = (allGroupsRes.groups || []).filter(
        g => !myIds.has(g.id) && (g.occupiedCount || 0) < (g.size || 10) && g.status === 'active'
      );
      setRecommendedGroups(openVacant.slice(0, 6));
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load your groups');
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }

  async function handleQuickJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    const code = quickJoinCode.trim().toUpperCase();
    if (!code) return;

    setSubmittingJoin(true);
    try {
      // Find group matching code
      const allGroups = await api.getGroups();
      const match = allGroups.groups.find(
        g => g.inviteCode === code || g.slots.some(s => s.inviteCode === code)
      );

      if (!match) {
        onNotify('error', 'That Group code is not valid.');
        setSubmittingJoin(false);
        return;
      }

      const res = await api.joinGroup(match.id, code);
      onNotify('success', res.message);
      setQuickJoinCode('');
      onNavigate('group', match.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to join Group');
    } finally {
      setSubmittingJoin(false);
    }
  }

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 mb-1">Sign in to View Your Groups</h2>
        <p className="text-xs text-slate-500 mb-4">
          Track your active slots, delivery cycles, and contribution histories in your private groups.
        </p>
        <button
          onClick={onOpenAuth}
          className="px-5 py-2.5 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Primary Category Selector */}
      <div className="flex items-center gap-2 mb-6 p-1 bg-slate-100 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('product')}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'product'
              ? 'bg-[#ff6600] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>My Groups ({groups.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('trust')}
          className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'trust'
              ? 'bg-[#ff6600] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Community Trust Groups</span>
        </button>
      </div>

      {/* Trust Chamas View */}
      {activeTab === 'trust' && (
        <TrustChamaSection
          currentUser={currentUser}
          onNavigate={onNavigate}
          onNotify={onNotify}
        />
      )}

      {/* Product Groups View */}
      {activeTab === 'product' && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                  My Groups
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full uppercase">
                  Member Read-Only
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                All groups you have joined (past, present, and current). Wallet balance: <b>KSh {currentUser.credit.toLocaleString()}</b> · Points: <b>{currentUser.points}</b>
              </p>
            </div>

            {/* Quick Join With Referral Code Box */}
            <form onSubmit={handleQuickJoin} className="flex gap-2 max-w-sm w-full">
              <input
                type="text"
                value={quickJoinCode}
                onChange={(e) => setQuickJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter Invite / Group Code"
                className="flex-1 px-3 py-2 text-xs uppercase font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff6600] bg-white"
              />
              <button
                type="submit"
                disabled={submittingJoin || !quickJoinCode.trim()}
                className="px-4 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap shadow-xs cursor-pointer"
              >
                {submittingJoin ? 'Joining...' : 'Join This Group'}
              </button>
            </form>
          </div>

          {loading && !hasLoaded ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-xs min-h-[380px] flex flex-col items-center justify-center">
              <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mb-4" />
              <h3 className="text-base font-bold text-slate-900 mb-1">Loading your groups...</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Retrieving your group memberships and contribution schedules
              </p>
            </div>
          ) : groups.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs mb-10 flex flex-col items-center justify-center">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 mb-1">
                You have not joined any group yet
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-6">
                Browse our verified announcements, pick an open vacant group, or accept an invitation to start saving together.
              </p>
              <button
                onClick={() => onNavigate('home')}
                className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Browse Announcements
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
              {groups.map((g) => {
                const groupCapacity = g.totalSlots || g.size || 10;
                const slot = g.slots.find(s => s.userId === currentUser.id);
                const deliveryDay = slot ? slot.slotNumber * g.cycleDays : (g.cycleDays * groupCapacity);
                const totalCollected = g.slots.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
                const paid = slot ? slot.paidAmount || 0 : totalCollected;
                const target = slot ? g.productPrice : (g.productPrice * groupCapacity);
                const progress = Math.min(100, Math.round((paid / (target || 1)) * 100));

                return (
                  <div
                    key={g.id}
                    className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        {slot ? (
                          <span className="text-xs font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                            Member #{slot.slotNumber}
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-800 rounded-md">
                            Enrolled Member
                          </span>
                        )}
                        <span className="text-xs text-slate-500 font-medium">
                          {slot ? `Day ${deliveryDay} Delivery` : `${g.slots.filter(s => s.userId).length}/${groupCapacity} Slots Filled`}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 mb-1">{g.name}</h3>
                      <div className="text-xs text-slate-500 mb-4">{g.productTitle}</div>

                      {/* Progress */}
                      <div className="p-3.5 bg-slate-50 rounded-xl mb-4 space-y-1.5 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Contribution Progress:</span>
                          <b className="text-slate-900">{progress}%</b>
                        </div>
                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff6600] rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                          <span>Paid: KSh {paid.toLocaleString()}</span>
                          <span>Target: KSh {target.toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-500 space-y-1 mb-4">
                        <div>
                          Daily rate: <b className="text-slate-900">KSh {g.dailyAmount.toLocaleString()} / day</b>
                        </div>
                        {slot?.inviteCode && (
                          <div>
                            Your invite code: <b className="font-mono text-indigo-700">{slot.inviteCode}</b>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => onNavigate('group', g.id)}
                      className="w-full py-2.5 bg-slate-900 hover:bg-[#ff6600] text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Open Group Dashboard (Read-Only)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommended Groups to Join */}
          {recommendedGroups.length > 0 && (
            <div className="border-t border-slate-200 pt-8 mt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Recommended Groups to Join
                  </h3>
                  <p className="text-xs text-slate-500">
                    Active groups with vacant spots ready for new members. Join and start rotating!
                  </p>
                </div>
                <button
                  onClick={() => onNavigate('home')}
                  className="text-xs font-bold text-[#ff6600] hover:underline"
                >
                  View All Announcements
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recommendedGroups.map((rg) => {
                  const slotsLeft = (rg.size || 10) - (rg.occupiedCount || 0);
                  return (
                    <div
                      key={rg.id}
                      className="p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-xs transition-all bg-white flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-start gap-2 mb-1.5">
                          <h4 className="font-bold text-slate-900 text-xs line-clamp-1">{rg.name}</h4>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded shrink-0">
                            {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} left
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 line-clamp-1 mb-2 font-medium">
                          {rg.productTitle}
                        </div>
                        <div className="text-xs text-slate-500 flex justify-between mb-3">
                          <span>Speed: <b>{rg.size} members</b></span>
                          <span className="text-[#ff6600] font-bold">KSh {rg.dailyAmount?.toLocaleString()}/day</span>
                        </div>
                      </div>

                      <button
                        onClick={() => onNavigate('group', rg.id)}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                      >
                        <span>Join This Group</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
