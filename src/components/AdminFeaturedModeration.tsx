import React, { useState, useEffect, useCallback } from 'react';
import {
  FeaturedPlacement,
  FeaturedPricing,
  FeaturedSettings,
  TierFeaturedLimits,
} from '../types.ts';
import { api, resolveImageUrl, AdminPaginationMeta } from '../api.ts';
import {
  Sparkles,
  Check,
  X,
  Search,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Settings,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Save,
  AlertTriangle,
} from 'lucide-react';

interface AdminFeaturedModerationProps {
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onChanged?: () => void;
}

type ModerationView = 'PENDING_APPROVAL' | 'ACTIVE' | 'HISTORY' | 'SETTINGS';

function formatEat(ms?: number | null): string {
  if (!ms) return '—';
  try {
    return (
      new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ms)) + ' EAT'
    );
  } catch {
    return new Date(ms).toISOString();
  }
}

export const AdminFeaturedModeration: React.FC<AdminFeaturedModerationProps> = ({
  onNotify,
  onChanged,
}) => {
  const [view, setView] = useState<ModerationView>('PENDING_APPROVAL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pagination, setPagination] = useState<AdminPaginationMeta | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Reason modal for reject or remove
  const [reasonModal, setReasonModal] = useState<{
    open: boolean;
    mode: 'reject' | 'remove';
    requestId: string;
    productTitle: string;
    merchantName: string;
    reason: string;
  }>({
    open: false,
    mode: 'reject',
    requestId: '',
    productTitle: '',
    merchantName: '',
    reason: '',
  });

  // Settings editor state
  const [settingsState, setSettingsState] = useState<FeaturedSettings | null>(null);
  const [placementsState, setPlacementsState] = useState<FeaturedPlacement[]>([]);
  const [pricingState, setPricingState] = useState<Array<FeaturedPricing & { priceKes: number }>>([]);
  const [tierLimitsState, setTierLimitsState] = useState<Array<TierFeaturedLimits & { tierName: string }>>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadModeration = useCallback(async () => {
    setLoading(true);
    try {
      const effectiveStatus =
        view === 'PENDING_APPROVAL'
          ? 'PENDING_APPROVAL'
          : view === 'ACTIVE'
          ? 'ACTIVE'
          : view === 'HISTORY'
          ? historyStatusFilter === 'ALL'
            ? 'ALL'
            : historyStatusFilter
          : 'ALL';

      const res = await api.getAdminFeaturedRequests({
        status: effectiveStatus,
        search: search.trim() || undefined,
        page,
        limit: 20,
      });
      setRequests(res.requests || []);
      setCounts(res.counts || {});
      setPagination(res.pagination || null);
      setSettingsState(res.settings || null);
      setPlacementsState(res.placements || []);
      setPricingState(res.pricing || []);
      setTierLimitsState(res.tierLimits || []);
      setSelectedIds([]);
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to load featured moderation queue.');
    } finally {
      setLoading(false);
    }
  }, [view, historyStatusFilter, search, page, onNotify]);

  useEffect(() => {
    loadModeration();
  }, [loadModeration]);

  async function handleApprove(requestId: string) {
    setProcessingId(requestId);
    try {
      const res = await api.approveAdminFeatured(requestId);
      onNotify('success', res.message || 'Featured request approved!');
      onChanged?.();
      await loadModeration();
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to approve request.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleBulkApprove() {
    if (selectedIds.length === 0) return;
    setProcessingId('bulk');
    try {
      const res = await api.bulkApproveAdminFeatured(selectedIds);
      onNotify('success', res.message || `Approved ${res.approvedIds.length} request(s).`);
      if (res.failed?.length > 0) {
        onNotify('info', `${res.failed.length} request(s) skipped: ${res.failed[0]?.message}`);
      }
      onChanged?.();
      await loadModeration();
    } catch (err: any) {
      onNotify('error', err?.message || 'Bulk approve failed.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReasonSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanReason = reasonModal.reason.trim();
    if (cleanReason.length < 3) {
      onNotify('error', 'Please enter a clear reason (at least 3 characters).');
      return;
    }
    setProcessingId(reasonModal.requestId);
    try {
      if (reasonModal.mode === 'reject') {
        const res = await api.rejectAdminFeatured(reasonModal.requestId, cleanReason);
        onNotify('success', res.message || 'Featured request rejected and refunded.');
      } else {
        const res = await api.removeAdminFeatured(reasonModal.requestId, cleanReason);
        onNotify('success', res.message || 'Active featured placement removed.');
      }
      setReasonModal({ ...reasonModal, open: false, reason: '' });
      onChanged?.();
      await loadModeration();
    } catch (err: any) {
      onNotify('error', err?.message || 'Action failed.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsState) return;
    setSavingSettings(true);
    try {
      const res = await api.updateAdminFeaturedSettings({
        settings: {
          featuredRequiresGroup: settingsState.featuredRequiresGroup,
          takedownRefundMode: settingsState.takedownRefundMode,
          extendOnSubExpiry: settingsState.extendOnSubExpiry,
        },
        placements: placementsState.map((pl) => ({
          key: pl.key,
          maxSlots: Number(pl.maxSlots),
          enabled: pl.enabled,
        })),
        pricing: pricingState.map((pr) => ({
          placementKey: pr.placementKey,
          durationDays: pr.durationDays,
          priceKes: Number(pr.priceKes),
          active: pr.active,
        })),
        tierLimits: tierLimitsState.map((tl) => ({
          tierId: tl.tierId,
          maxActiveFeatured: Number(tl.maxActiveFeatured),
          maxPendingFeatured: Number(tl.maxPendingFeatured),
          maxFeaturedDaysPerRequest: Number(tl.maxFeaturedDaysPerRequest),
          featuredDiscountPercent: Number(tl.featuredDiscountPercent),
        })),
      });
      onNotify('success', res.message || 'Featured moderation settings saved.');
      onChanged?.();
      await loadModeration();
    } catch (err: any) {
      onNotify('error', err?.message || 'Could not save featured settings.');
    } finally {
      setSavingSettings(false);
    }
  }

  const allPendingSelected =
    view === 'PENDING_APPROVAL' && requests.length > 0 && selectedIds.length === requests.length;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
        <div className="p-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-100 text-[#ff6600] rounded-lg">
                  <Sparkles className="w-4 h-4" />
                </span>
                <h2 className="text-base font-extrabold text-slate-900">
                  Featured Moderation & Placement Control
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Approve paid wallet-held merchant requests, inspect active expiry windows (EAT), take down non-compliant items, and manage pricing & tier quotas.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {view !== 'SETTINGS' && (
                <div className="relative w-56">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search merchant or product..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={loadModeration}
                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
                title="Refresh queue"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setView('PENDING_APPROVAL');
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 ${
                  view === 'PENDING_APPROVAL'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Pending Queue ({counts.PENDING_APPROVAL ?? 0})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setView('ACTIVE');
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 ${
                  view === 'ACTIVE'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Active ({counts.ACTIVE ?? 0})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setView('HISTORY');
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl cursor-pointer ${
                  view === 'HISTORY'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Scheduled & History ({(counts.APPROVED ?? 0) + (counts.EXPIRED ?? 0) + (counts.REJECTED ?? 0) + (counts.CANCELLED ?? 0) + (counts.REMOVED ?? 0)})
              </button>

              <button
                type="button"
                onClick={() => setView('SETTINGS')}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 ${
                  view === 'SETTINGS'
                    ? 'bg-[#ff6600] text-white shadow-xs'
                    : 'bg-orange-50 text-[#ff6600] hover:bg-orange-100'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings & Pricing</span>
              </button>
            </div>

            {view === 'PENDING_APPROVAL' && selectedIds.length > 0 && (
              <button
                type="button"
                disabled={processingId === 'bulk'}
                onClick={handleBulkApprove}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {processingId === 'bulk' ? 'Approving...' : `Bulk Approve (${selectedIds.length})`}
                </span>
              </button>
            )}

            {view === 'HISTORY' && (
              <select
                value={historyStatusFilter}
                onChange={(e) => {
                  setHistoryStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white font-semibold"
              >
                <option value="ALL">All Statuses</option>
                <option value="APPROVED">Scheduled (Approved)</option>
                <option value="EXPIRED">Expired</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="REMOVED">Removed by Admin</option>
              </select>
            )}
          </div>

          {/* VIEW: SETTINGS */}
          {view === 'SETTINGS' && settingsState ? (
            <form onSubmit={handleSaveSettings} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsState.featuredRequiresGroup}
                    onChange={(e) =>
                      setSettingsState({ ...settingsState, featuredRequiresGroup: e.target.checked })
                    }
                    className="mt-0.5 rounded text-[#ff6600]"
                  />
                  <div>
                    <span className="font-bold text-slate-900 block">Require Active Group</span>
                    <span className="text-[11px] text-slate-500">Products must have ≥ 1 active group before featuring.</span>
                  </div>
                </label>

                <div>
                  <label className="block font-bold text-slate-900 mb-1">Admin Takedown Refund Mode</label>
                  <select
                    value={settingsState.takedownRefundMode}
                    onChange={(e) =>
                      setSettingsState({
                        ...settingsState,
                        takedownRefundMode: e.target.value as 'none' | 'prorata',
                      })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                  >
                    <option value="none">No Refund on Policy Takedown (none)</option>
                    <option value="prorata">Pro-Rata Unused Days Refund (prorata)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-900 mb-1">Subscription Expiry Policy</label>
                  <select
                    value={settingsState.extendOnSubExpiry ? 'pause_extend' : 'hide_only'}
                    onChange={(e) =>
                      setSettingsState({
                        ...settingsState,
                        extendOnSubExpiry: e.target.value === 'pause_extend',
                      })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white text-xs"
                  >
                    <option value="hide_only">Hide until renewed (window keeps running)</option>
                    <option value="pause_extend">Pause & extend remaining days on renewal</option>
                  </select>
                </div>
              </div>

              {/* Placement Slots */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">
                  Featured Placement Areas & Slot Caps
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {placementsState.map((pl, idx) => (
                    <div key={pl.key} className="p-3.5 border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-bold text-slate-900">{pl.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{pl.key}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-600">Slots:</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={pl.maxSlots}
                            onChange={(e) => {
                              const copy = [...placementsState];
                              copy[idx] = { ...pl, maxSlots: Number(e.target.value) };
                              setPlacementsState(copy);
                            }}
                            className="w-16 px-2 py-1 border border-slate-300 rounded-lg font-mono text-xs"
                          />
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pl.enabled}
                            onChange={(e) => {
                              const copy = [...placementsState];
                              copy[idx] = { ...pl, enabled: e.target.checked };
                              setPlacementsState(copy);
                            }}
                          />
                          <span>Enabled</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Base Duration Pricing (KES) */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">
                  Duration Pricing Tiers (KES)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {pricingState.map((pr, idx) => (
                    <div key={pr.id} className="p-3 border border-slate-200 rounded-xl bg-slate-50/50 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900">{pr.durationDays} Day{pr.durationDays > 1 ? 's' : ''}</span>
                        <input
                          type="checkbox"
                          checked={pr.active}
                          onChange={(e) => {
                            const copy = [...pricingState];
                            copy[idx] = { ...pr, active: e.target.checked };
                            setPricingState(copy);
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500">KSh</span>
                        <input
                          type="number"
                          min={0}
                          value={pr.priceKes}
                          onChange={(e) => {
                            const copy = [...pricingState];
                            copy[idx] = { ...pr, priceKes: Number(e.target.value) };
                            setPricingState(copy);
                          }}
                          className="w-full px-2 py-1 border border-slate-300 rounded-lg bg-white font-mono text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subscription Tier Featured Limits */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">
                  Subscription Tier Featured Limits & Discounts
                </h3>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3">Plan Tier</th>
                        <th className="py-2 px-3">Max Active</th>
                        <th className="py-2 px-3">Max Pending</th>
                        <th className="py-2 px-3">Max Days / Req</th>
                        <th className="py-2 px-3">Discount (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tierLimitsState.map((tl, idx) => (
                        <tr key={tl.tierId}>
                          <td className="py-2 px-3 font-bold text-slate-900">{tl.tierName}</td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={tl.maxActiveFeatured}
                              onChange={(e) => {
                                const copy = [...tierLimitsState];
                                copy[idx] = { ...tl, maxActiveFeatured: Number(e.target.value) };
                                setTierLimitsState(copy);
                              }}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg font-mono"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={tl.maxPendingFeatured}
                              onChange={(e) => {
                                const copy = [...tierLimitsState];
                                copy[idx] = { ...tl, maxPendingFeatured: Number(e.target.value) };
                                setTierLimitsState(copy);
                              }}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg font-mono"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={1}
                              max={30}
                              value={tl.maxFeaturedDaysPerRequest}
                              onChange={(e) => {
                                const copy = [...tierLimitsState];
                                copy[idx] = { ...tl, maxFeaturedDaysPerRequest: Number(e.target.value) };
                                setTierLimitsState(copy);
                              }}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg font-mono"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={tl.featuredDiscountPercent}
                              onChange={(e) => {
                                const copy = [...tierLimitsState];
                                copy[idx] = { ...tl, featuredDiscountPercent: Number(e.target.value) };
                                setTierLimitsState(copy);
                              }}
                              className="w-20 px-2 py-1 border border-slate-300 rounded-lg font-mono"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{savingSettings ? 'Saving Settings...' : 'Save Featured Settings & Pricing'}</span>
                </button>
              </div>
            </form>
          ) : loading ? (
            <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#ff6600]" />
              <span>Loading moderation records...</span>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
              No featured requests found in this queue.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    {view === 'PENDING_APPROVAL' && (
                      <th className="py-2.5 px-3 w-8">
                        <input
                          type="checkbox"
                          checked={allPendingSelected}
                          onChange={(e) =>
                            setSelectedIds(e.target.checked ? requests.map((r) => r.id) : [])
                          }
                        />
                      </th>
                    )}
                    <th className="py-2.5 px-3">Product & Groups</th>
                    <th className="py-2.5 px-3">Merchant & Tier</th>
                    <th className="py-2.5 px-3">Duration & Window (EAT)</th>
                    <th className="py-2.5 px-3">Wallet Hold / Paid</th>
                    <th className="py-2.5 px-3">Metrics / Status</th>
                    <th className="py-2.5 px-3 text-right">Moderation Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {requests.map((req) => {
                    const checked = selectedIds.includes(req.id);
                    const statsTotals = req.stats?.totals || {};
                    return (
                      <tr key={req.id} className="hover:bg-slate-50/70">
                        {view === 'PENDING_APPROVAL' && (
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedIds((prev) =>
                                  e.target.checked ? [...prev, req.id] : prev.filter((id) => id !== req.id)
                                )
                              }
                            />
                          </td>
                        )}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={resolveImageUrl(req.product?.images?.[0])}
                              alt={req.product?.title || 'Product'}
                              className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                            <div>
                              <b className="text-slate-900 block line-clamp-1 max-w-[200px]">
                                {req.product?.title || `Product #${req.productId}`}
                              </b>
                              <span className="text-[10px] text-slate-500">
                                {req.groupCount ?? 0} active group{(req.groupCount ?? 0) !== 1 ? 's' : ''} · {req.placementKey}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{req.merchant?.shopName || req.merchant?.name || `Merchant #${req.merchantId}`}</div>
                          <div className="text-[10px] text-slate-500">{req.tierIdSnapshot}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{req.durationDays} Day{req.durationDays > 1 ? 's' : ''}</div>
                          <div className="text-[10px] text-slate-500">
                            {req.startsAt ? `${formatEat(req.startsAt)} → ${formatEat(req.endsAt)}` : `Requested ${formatEat(req.createdAt)}`}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-[#ff6600]">
                            KSh {Number(req.amountPaidKes || 0).toLocaleString()}
                          </div>
                          {req.holdLedgerId && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-semibold">
                              <ShieldCheck className="w-3 h-3" /> Hold Verified
                            </span>
                          )}
                          {req.refundedKes > 0 && (
                            <div className="text-[10px] text-rose-700 font-semibold">
                              Refunded KSh {Number(req.refundedKes).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-800">
                            {req.status}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-1">
                            {statsTotals.impressions ?? 0} impr · {statsTotals.clicks ?? 0} clicks · {statsTotals.joins ?? 0} joins
                          </div>
                          {(req.rejectionReason || req.removalReason) && (
                            <div className="text-[10px] text-rose-700 mt-0.5 max-w-[180px] truncate" title={req.rejectionReason || req.removalReason}>
                              {req.rejectionReason || req.removalReason}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {req.status === 'PENDING_APPROVAL' && (
                              <>
                                <button
                                  type="button"
                                  disabled={processingId === req.id}
                                  onClick={() => handleApprove(req.id)}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={processingId === req.id}
                                  onClick={() =>
                                    setReasonModal({
                                      open: true,
                                      mode: 'reject',
                                      requestId: req.id,
                                      productTitle: req.product?.title || `#${req.productId}`,
                                      merchantName: req.merchant?.shopName || req.merchant?.name || `#${req.merchantId}`,
                                      reason: '',
                                    })
                                  }
                                  className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                            {(req.status === 'ACTIVE' || req.status === 'APPROVED') && (
                              <button
                                type="button"
                                disabled={processingId === req.id}
                                onClick={() =>
                                  setReasonModal({
                                    open: true,
                                    mode: 'remove',
                                    requestId: req.id,
                                    productTitle: req.product?.title || `#${req.productId}`,
                                    merchantName: req.merchant?.shopName || req.merchant?.name || `#${req.merchantId}`,
                                    reason: '',
                                  })
                                }
                                className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {view !== 'SETTINGS' && pagination && pagination.total > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between text-xs">
            <span className="text-slate-600">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                type="button"
                disabled={loading || page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reject / Remove Reason Modal */}
      {reasonModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-extrabold">
                {reasonModal.mode === 'reject' ? 'Reject Featured Request (100% Refund)' : 'Take Down Featured Placement'}
              </h3>
            </div>
            <p className="text-xs text-slate-600 mb-3">
              Product: <b>{reasonModal.productTitle}</b> · Merchant: <b>{reasonModal.merchantName}</b>
            </p>
            <form onSubmit={handleReasonSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Reason (required for merchant notice & audit log)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={3}
                  value={reasonModal.reason}
                  onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
                  placeholder={
                    reasonModal.mode === 'reject'
                      ? 'e.g. Misleading price or incomplete group setup'
                      : 'e.g. Policy violation or merchant product taken offline'
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReasonModal({ ...reasonModal, open: false })}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === reasonModal.requestId}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
                >
                  {processingId === reasonModal.requestId
                    ? 'Processing...'
                    : reasonModal.mode === 'reject'
                    ? 'Reject & Refund Wallet'
                    : 'Confirm Takedown'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
