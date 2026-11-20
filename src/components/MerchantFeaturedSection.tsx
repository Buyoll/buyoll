import React, { useState, useEffect, useCallback } from 'react';
import {
  Product,
  ChamaGroup,
  MerchantLimitsSummary,
} from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  RefreshCw,
  BarChart3,
  Eye,
  MousePointerClick,
  Users,
  ShoppingBag,
  Wallet,
  RotateCcw,
  Loader2,
  Calendar,
} from 'lucide-react';

interface MerchantFeaturedSectionProps {
  products: Product[];
  groups: ChamaGroup[];
  onRequestFeature: (product?: Product) => void;
  onOpenSubscription: () => void;
  onNavigate: (view: string, arg?: any) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  refreshTrigger?: number;
}

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active Live', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  PENDING_APPROVAL: { label: 'Pending Admin', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  APPROVED: { label: 'Scheduled', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  EXPIRED: { label: 'Expired', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  REJECTED: { label: 'Rejected & Refunded', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
  CANCELLED: { label: 'Cancelled & Refunded', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  REMOVED: { label: 'Removed by Admin', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
};

function formatEatDateTime(ms?: number | null): string {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms)) + ' EAT';
  } catch {
    return new Date(ms).toLocaleString();
  }
}

export const MerchantFeaturedSection: React.FC<MerchantFeaturedSectionProps> = ({
  products,
  onRequestFeature,
  onOpenSubscription,
  onNavigate,
  onNotify,
  refreshTrigger = 0,
}) => {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<any[]>([]);
  const [limits, setLimits] = useState<MerchantLimitsSummary | null>(null);
  const [walletBalanceKes, setWalletBalanceKes] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [expandedStatsId, setExpandedStatsId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMerchantFeatured();
      setRequests(res.requests || []);
      setLimits(res.limits || null);
      setWalletBalanceKes(res.walletBalanceKes ?? 0);
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to load featured placements.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  async function handleCancel(requestId: string) {
    setCancellingId(requestId);
    try {
      const res = await api.cancelMerchantFeaturedRequest(requestId);
      onNotify('success', res.message || 'Featured request cancelled and wallet refunded.');
      await loadData();
    } catch (err: any) {
      onNotify('error', err?.message || 'Could not cancel featured request.');
    } finally {
      setCancellingId(null);
    }
  }

  const filteredRequests = requests.filter((r) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'HISTORY') return ['EXPIRED', 'REJECTED', 'CANCELLED', 'REMOVED'].includes(r.status);
    return r.status === statusFilter;
  });

  return (
    <div id="my-featured-section" className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs mb-8">
      {/* Header & Quota Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 bg-amber-100 text-[#ff6600] rounded-lg">
              <Sparkles className="w-4 h-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">
              My Featured Placements & Performance
            </h2>
            {limits && (
              <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                {limits.tierName}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Track pending holds, active showcase windows (Africa/Nairobi EAT), impressions, clicks, and group conversions.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5 text-emerald-700" />
            <span className="text-slate-600">Wallet:</span>
            <b className="font-mono text-slate-900">KSh {walletBalanceKes.toLocaleString()}</b>
          </div>

          <button
            type="button"
            onClick={loadData}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
            title="Refresh featured placements"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => onRequestFeature()}
            className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Feature a Product</span>
          </button>
        </div>
      </div>

      {/* Tier Limits KPI Row */}
      {limits && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-[11px] text-slate-500 font-medium">Active Featured Slots</div>
            <div className="text-lg font-black text-slate-900 tabular-nums mt-0.5">
              {limits.activeFeaturedUsed} <span className="text-xs font-semibold text-slate-400">/ {limits.maxActiveFeatured}</span>
            </div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-[11px] text-slate-500 font-medium">Pending Moderation Queue</div>
            <div className="text-lg font-black text-amber-700 tabular-nums mt-0.5">
              {limits.pendingFeaturedUsed} <span className="text-xs font-semibold text-slate-400">/ {limits.maxPendingFeatured}</span>
            </div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-[11px] text-slate-500 font-medium">Max Days / Request</div>
            <div className="text-lg font-black text-slate-900 tabular-nums mt-0.5">
              {limits.maxFeaturedDaysPerRequest} Days
            </div>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500 font-medium">Tier Featured Discount</div>
              <div className="text-lg font-black text-emerald-700 tabular-nums mt-0.5">
                {limits.featuredDiscountPercent}% OFF
              </div>
            </div>
            {limits.featuredDiscountPercent < 20 && (
              <button
                type="button"
                onClick={onOpenSubscription}
                className="text-[10px] font-bold px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg cursor-pointer"
              >
                Upgrade
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4">
        {[
          { id: 'ALL', label: `All (${requests.length})` },
          { id: 'ACTIVE', label: `Active (${requests.filter((r) => r.status === 'ACTIVE').length})` },
          { id: 'PENDING_APPROVAL', label: `Pending (${requests.filter((r) => r.status === 'PENDING_APPROVAL').length})` },
          { id: 'APPROVED', label: `Scheduled (${requests.filter((r) => r.status === 'APPROVED').length})` },
          {
            id: 'HISTORY',
            label: `Expired / History (${requests.filter((r) => ['EXPIRED', 'REJECTED', 'CANCELLED', 'REMOVED'].includes(r.status)).length})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
              statusFilter === tab.id
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-[#ff6600]" />
          <span>Loading your featured requests...</span>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-600">
          <Sparkles className="w-8 h-8 text-amber-500 mx-auto mb-2 opacity-80" />
          <p className="font-bold text-slate-900 mb-1">No featured placements in this view</p>
          <p className="text-[11px] text-slate-500 max-w-md mx-auto mb-3">
            Feature any published product (with at least 1 active group) for 1–7 days or 30 days directly from your Merchant Wallet.
          </p>
          <button
            type="button"
            onClick={() => onRequestFeature()}
            className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl cursor-pointer"
          >
            Submit First Featured Request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const badge = STATUS_BADGES[req.status] || { label: req.status, cls: 'bg-slate-100 text-slate-700' };
            const statsTotals = req.stats?.totals || {
              impressions: 0,
              uniqueViewers: 0,
              clicks: 0,
              productViews: 0,
              joins: 0,
              orders: 0,
              ctr: 0,
            };
            const dailyRows = req.stats?.daily || [];
            const isExpanded = expandedStatsId === req.id;
            const matchedProduct = products.find((p) => p.id === req.productId);
            const canRenew = ['EXPIRED', 'REJECTED', 'CANCELLED', 'REMOVED'].includes(req.status) && matchedProduct;

            return (
              <div key={req.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/40 hover:bg-white transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <img
                      src={resolveImageUrl(req.product?.images?.[0] || matchedProduct?.images?.[0])}
                      alt={req.product?.title || 'Product'}
                      className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0 cursor-pointer"
                      onClick={() => onNavigate('product', req.productId)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4
                          onClick={() => onNavigate('product', req.productId)}
                          className="text-sm font-bold text-slate-900 hover:text-[#ff6600] cursor-pointer truncate max-w-xs"
                        >
                          {req.product?.title || `Product #${req.productId}`}
                        </h4>
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-full border ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {req.status === 'ACTIVE' && (
                          <span className="px-2 py-0.5 bg-orange-100 text-[#ff6600] text-[10px] font-bold rounded-full">
                            {req.daysRemaining}d left
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-2 flex-wrap">
                        <span>{req.placementName || req.placementKey}</span>
                        <span>·</span>
                        <span className="font-bold text-slate-800">{req.durationDays} Day{req.durationDays > 1 ? 's' : ''}</span>
                        <span>·</span>
                        <span className="font-mono font-bold text-[#ff6600]">KSh {Number(req.amountPaidKes || 0).toLocaleString()}</span>
                        {req.refundedKes > 0 && (
                          <span className="text-emerald-700 font-semibold">
                            (Refunded KSh {Number(req.refundedKes).toLocaleString()})
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        {req.startsAt ? (
                          <span>
                            {formatEatDateTime(req.startsAt)} → <b>{formatEatDateTime(req.endsAt)}</b>
                          </span>
                        ) : (
                          <span>Submitted {formatEatDateTime(req.createdAt)}</span>
                        )}
                      </div>

                      {(req.rejectionReason || req.removalReason) && (
                        <div className="mt-1.5 text-[11px] text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 inline-flex items-center gap-1.5">
                          <Ban className="w-3 h-3 shrink-0" />
                          <span>Reason: {req.rejectionReason || req.removalReason}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick Performance Metrics + Action Buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                    <div className="grid grid-cols-4 gap-2 text-center bg-white border border-slate-200 rounded-xl px-3 py-1.5">
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-bold">Impr</div>
                        <div className="text-xs font-black text-slate-900 tabular-nums">{statsTotals.impressions}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-bold">Clicks</div>
                        <div className="text-xs font-black text-slate-900 tabular-nums">{statsTotals.clicks}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-bold">CTR</div>
                        <div className="text-xs font-black text-[#ff6600] tabular-nums">{statsTotals.ctr}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-bold">Joins</div>
                        <div className="text-xs font-black text-emerald-700 tabular-nums">{statsTotals.joins}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setExpandedStatsId(isExpanded ? null : req.id)}
                        className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <BarChart3 className="w-3.5 h-3.5 text-[#ff6600]" />
                        <span>{isExpanded ? 'Hide Report' : 'Report'}</span>
                      </button>

                      {req.status === 'PENDING_APPROVAL' && (
                        <button
                          type="button"
                          disabled={cancellingId === req.id}
                          onClick={() => handleCancel(req.id)}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{cancellingId === req.id ? 'Refunding...' : 'Cancel & Refund'}</span>
                        </button>
                      )}

                      {canRenew && (
                        <button
                          type="button"
                          onClick={() => onRequestFeature(matchedProduct)}
                          className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Renew</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expandable Daily Performance Breakdown */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-200 bg-white rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Eye className="w-3 h-3" /> Impressions
                        </div>
                        <div className="text-sm font-black text-slate-900 mt-0.5">{statsTotals.impressions.toLocaleString()}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Unique Viewers
                        </div>
                        <div className="text-sm font-black text-slate-900 mt-0.5">{statsTotals.uniqueViewers.toLocaleString()}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <MousePointerClick className="w-3 h-3" /> Banner Clicks
                        </div>
                        <div className="text-sm font-black text-slate-900 mt-0.5">{statsTotals.clicks.toLocaleString()}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500">Product Views</div>
                        <div className="text-sm font-black text-slate-900 mt-0.5">{statsTotals.productViews.toLocaleString()}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500">Group Joins</div>
                        <div className="text-sm font-black text-emerald-700 mt-0.5">{statsTotals.joins.toLocaleString()}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <ShoppingBag className="w-3 h-3" /> Orders / Contrib
                        </div>
                        <div className="text-sm font-black text-[#ff6600] mt-0.5">{statsTotals.orders.toLocaleString()}</div>
                      </div>
                    </div>

                    {dailyRows.length === 0 ? (
                      <p className="text-[11px] text-slate-400 text-center py-2">
                        Daily metrics will populate as members view and click this featured placement.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                            <tr>
                              <th className="py-1.5 px-2.5">Date (EAT)</th>
                              <th className="py-1.5 px-2.5">Impressions</th>
                              <th className="py-1.5 px-2.5">Unique Viewers</th>
                              <th className="py-1.5 px-2.5">Clicks</th>
                              <th className="py-1.5 px-2.5">Product Views</th>
                              <th className="py-1.5 px-2.5">Group Joins</th>
                              <th className="py-1.5 px-2.5">Orders</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {dailyRows.map((d: any) => (
                              <tr key={d.date}>
                                <td className="py-1.5 px-2.5 font-mono font-semibold text-slate-800">{d.date}</td>
                                <td className="py-1.5 px-2.5 tabular-nums">{d.impressions}</td>
                                <td className="py-1.5 px-2.5 tabular-nums">{d.uniqueViewers}</td>
                                <td className="py-1.5 px-2.5 tabular-nums">{d.clicks}</td>
                                <td className="py-1.5 px-2.5 tabular-nums">{d.productViews}</td>
                                <td className="py-1.5 px-2.5 tabular-nums text-emerald-700 font-bold">{d.joins}</td>
                                <td className="py-1.5 px-2.5 tabular-nums text-[#ff6600] font-bold">{d.orders}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
