import React, { useState, useEffect, useMemo } from 'react';
import {
  Product,
  ChamaGroup,
  FeaturedPlacement,
  FeaturedPricing,
  FeaturedSettings,
  MerchantLimitsSummary,
} from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { useUser } from '../context/UserContext.tsx';
import {
  X,
  Sparkles,
  Calendar,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Loader2,
  Clock,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

interface FeaturedRequestModalProps {
  isOpen: boolean;
  product: Product | null;
  products?: Product[];
  groups: ChamaGroup[];
  limits?: MerchantLimitsSummary | null;
  walletBalanceKes?: number;
  onClose: () => void;
  onSubmitted: () => void;
  onOpenSubscription: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const ALL_DURATIONS = [1, 2, 3, 4, 5, 6, 7, 30];

function formatEatPreview(timestampMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampMs)) + ' EAT';
  } catch {
    return new Date(timestampMs).toISOString();
  }
}

export const FeaturedRequestModal: React.FC<FeaturedRequestModalProps> = ({
  isOpen,
  product,
  products = [],
  groups,
  limits: externalLimits,
  walletBalanceKes: externalWalletKes,
  onClose,
  onSubmitted,
  onOpenSubscription,
  onNotify,
}) => {
  const { refreshUser } = useUser();
  const [selectedProductId, setSelectedProductId] = useState<number>(product?.id || 0);
  const [placementKey, setPlacementKey] = useState<string>('homepage_featured');
  const [durationDays, setDurationDays] = useState<number>(7);
  const [startMode, setStartMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDateStr, setScheduledDateStr] = useState<string>('');
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [placements, setPlacements] = useState<FeaturedPlacement[]>([]);
  const [pricing, setPricing] = useState<
    Array<FeaturedPricing & { priceKes: number; discountPercent: number; finalPriceCents: number; finalPriceKes: number }>
  >([]);
  const [settings, setSettings] = useState<FeaturedSettings | null>(null);
  const [limits, setLimits] = useState<MerchantLimitsSummary | null>(externalLimits || null);
  const [walletKes, setWalletKes] = useState<number>(externalWalletKes ?? 0);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setIdempotencyKey(`feat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    if (product?.id) {
      setSelectedProductId(product.id);
    } else {
      const firstPublished = products.find((p) => p.publicationStatus !== 'draft' && p.live !== false);
      setSelectedProductId(firstPublished?.id || products[0]?.id || 0);
    }

    let cancelled = false;
    setLoadingConfig(true);
    Promise.all([
      api.getFeaturedPricing(),
      api.getMerchantFeatured().catch(() => null),
    ])
      .then(([pricingRes, merchantRes]) => {
        if (cancelled) return;
        setPlacements(pricingRes.placements || []);
        setPricing(pricingRes.pricing || []);
        setSettings(pricingRes.settings || null);
        if (pricingRes.limits) setLimits(pricingRes.limits);
        if (merchantRes) {
          setWalletKes(merchantRes.walletBalanceKes ?? 0);
          if (merchantRes.limits) setLimits(merchantRes.limits);
        }
        const firstEnabledPlacement = (pricingRes.placements || []).find((pl) => pl.enabled);
        if (firstEnabledPlacement) setPlacementKey(firstEnabledPlacement.key);
        const allowed = pricingRes.limits?.allowedDurations || [1, 2, 3, 4, 5, 6, 7];
        if (!allowed.includes(durationDays)) {
          setDurationDays(allowed[allowed.length - 1] || 1);
        }
      })
      .catch((err: any) => {
        if (!cancelled) setErrorMsg(err?.message || 'Could not load featured pricing.');
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, product?.id]);

  const targetProduct = useMemo(() => {
    if (product && product.id === selectedProductId) return product;
    return products.find((p) => p.id === selectedProductId) || product || null;
  }, [product, products, selectedProductId]);

  const productGroupsCount = useMemo(() => {
    if (!targetProduct) return 0;
    return groups.filter((g) => g.productId === targetProduct.id && g.status !== 'cancelled').length;
  }, [groups, targetProduct]);

  const isPublished = Boolean(
    targetProduct && targetProduct.publicationStatus !== 'draft' && targetProduct.live !== false
  );
  const requiresGroup = settings?.featuredRequiresGroup !== false;
  const hasRequiredGroup = !requiresGroup || productGroupsCount > 0;

  const selectedQuote = useMemo(() => {
    return pricing.find((p) => p.placementKey === placementKey && p.durationDays === durationDays) || null;
  }, [pricing, placementKey, durationDays]);

  const allowedDurations = limits?.allowedDurations || [1, 2, 3, 4, 5, 6, 7];
  const isDurationAllowed = allowedDurations.includes(durationDays);
  const activeUsed = limits?.activeFeaturedUsed ?? 0;
  const maxActive = limits?.maxActiveFeatured ?? 1;
  const pendingUsed = limits?.pendingFeaturedUsed ?? 0;
  const maxPending = limits?.maxPendingFeatured ?? 1;

  const finalPriceKes = selectedQuote?.finalPriceKes ?? 0;
  const basePriceKes = selectedQuote?.priceKes ?? 0;
  const discountPct = selectedQuote?.discountPercent ?? limits?.featuredDiscountPercent ?? 0;
  const hasEnoughBalance = walletKes >= finalPriceKes;

  const scheduledTimestampMs = useMemo(() => {
    if (startMode !== 'scheduled' || !scheduledDateStr) return null;
    // Interpret chosen date as 00:00:00 EAT (+03:00)
    const parsed = Date.parse(`${scheduledDateStr}T00:00:00+03:00`);
    return Number.isFinite(parsed) ? parsed : null;
  }, [startMode, scheduledDateStr]);

  const previewStartMs = scheduledTimestampMs && scheduledTimestampMs > Date.now() ? scheduledTimestampMs : Date.now();
  const previewEndMs = previewStartMs + durationDays * 24 * 60 * 60 * 1000;

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!targetProduct) {
      setErrorMsg('Please select a product to feature.');
      return;
    }
    if (!isPublished) {
      setErrorMsg('Publish this product with at least 1 group first before requesting featured placement.');
      return;
    }
    if (!hasRequiredGroup) {
      setErrorMsg('Featured products must have at least 1 active group for members to join.');
      return;
    }
    if (!isDurationAllowed) {
      setErrorMsg(`Your ${limits?.tierName || 'current'} plan does not support ${durationDays}-day featured placements.`);
      return;
    }
    if (!hasEnoughBalance) {
      setErrorMsg(
        `Insufficient Merchant Wallet balance. Need KSh ${finalPriceKes.toLocaleString()}, available KSh ${walletKes.toLocaleString()}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createMerchantFeaturedRequest({
        productId: targetProduct.id,
        placementKey,
        durationDays,
        requestedStartAt: startMode === 'scheduled' ? scheduledTimestampMs : null,
        idempotencyKey,
      });
      onNotify('success', res.message || 'Featured request submitted and payment held from your Merchant Wallet.');
      await refreshUser();
      onSubmitted();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not submit featured placement request.');
    } finally {
      setSubmitting(false);
    }
  }

  const eligibleProducts = products.filter((p) => p.publicationStatus !== 'draft' && p.live !== false);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 relative my-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
          aria-label="Close featured request modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-[#ff6600] flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Request Paid Featured Placement
            </h3>
            <p className="text-xs text-slate-500">
              Pay from your existing Merchant Wallet. Admin verifies & activates your slot; full refund if rejected.
            </p>
          </div>
        </div>

        {loadingConfig ? (
          <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#ff6600]" />
            <span>Loading tier limits, durations & wallet balance...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Subscription / Limits Summary Bar */}
            {limits && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-slate-900">{limits.tierName}</span>
                  {limits.featuredDiscountPercent > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                      {limits.featuredDiscountPercent}% Featured Discount
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span>
                    Active: <b className={activeUsed >= maxActive ? 'text-rose-600' : 'text-slate-900'}>{activeUsed}/{maxActive}</b>
                  </span>
                  <span>
                    Pending: <b className={pendingUsed >= maxPending ? 'text-rose-600' : 'text-slate-900'}>{pendingUsed}/{maxPending}</b>
                  </span>
                  <span>
                    Max: <b>{limits.maxFeaturedDaysPerRequest}d</b>
                  </span>
                </div>
              </div>
            )}

            {/* Subscription inactive warning */}
            {limits && !limits.hasActiveSubscription && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
                <span>An active merchant subscription is required to submit featured requests.</span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSubscription();
                  }}
                  className="px-3 py-1 bg-rose-600 text-white font-bold rounded-lg text-[11px] shrink-0 cursor-pointer"
                >
                  Subscribe Now
                </button>
              </div>
            )}

            {/* Product Selection (if not locked or allow switching from product list) */}
            {!product && eligibleProducts.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Select Published Product
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                >
                  {eligibleProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} (KSh {p.price.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Target Product Card */}
            {targetProduct ? (
              <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl">
                <img
                  src={resolveImageUrl(targetProduct.images?.[0])}
                  alt={targetProduct.title}
                  className="w-12 h-12 rounded-lg object-cover border border-slate-200 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-900 truncate">{targetProduct.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>KSh {targetProduct.price.toLocaleString()}</span>
                    <span>·</span>
                    <span className={isPublished ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                      {isPublished ? 'Published Live' : 'Draft (Publish First)'}
                    </span>
                    <span>·</span>
                    <span className={hasRequiredGroup ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                      {productGroupsCount} active group{productGroupsCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                Publish a product with at least 1 active group first before requesting a Featured slot.
              </div>
            )}

            {/* Placement selector */}
            {placements.length > 1 && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Featured Placement Area
                </label>
                <select
                  value={placementKey}
                  onChange={(e) => setPlacementKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                >
                  {placements.map((pl) => (
                    <option key={pl.key} value={pl.key} disabled={!pl.enabled}>
                      {pl.name} ({pl.maxSlots} max slots) {!pl.enabled ? '— Disabled' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Duration Tier Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Select Featured Duration
                </label>
                <span className="text-[11px] text-slate-500">
                  Strict EAT time-window expiry
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {ALL_DURATIONS.map((days) => {
                  const quote = pricing.find((p) => p.placementKey === placementKey && p.durationDays === days);
                  const allowed = allowedDurations.includes(days);
                  const isSelected = durationDays === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        if (allowed) {
                          setDurationDays(days);
                          setErrorMsg(null);
                        } else {
                          setErrorMsg(
                            `${days}-day featured slots require a higher merchant plan (Commercial or Enterprise).`
                          );
                        }
                      }}
                      className={`p-2.5 rounded-xl border text-left transition-all relative ${
                        !allowed
                          ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-75'
                          : isSelected
                          ? 'border-[#ff6600] bg-orange-50/70 ring-2 ring-[#ff6600]/20 cursor-pointer'
                          : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-900">
                          {days} {days === 1 ? 'Day' : 'Days'}
                        </span>
                        {!allowed && <Lock className="w-3 h-3 text-slate-400" />}
                      </div>
                      <div className="text-[11px] font-mono font-bold text-[#ff6600] mt-0.5">
                        {quote ? `KSh ${quote.finalPriceKes.toLocaleString()}` : '—'}
                      </div>
                      {!allowed && (
                        <div className="text-[9px] font-bold text-amber-700 mt-0.5">Upgrade</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {!allowedDurations.includes(30) && (
                <div className="mt-2 flex items-center justify-between text-[11px] text-amber-800 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                  <span>Need 30-day showcase placements & up to 20% featured discount?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSubscription();
                    }}
                    className="font-bold underline cursor-pointer ml-2 shrink-0"
                  >
                    Upgrade Plan
                  </button>
                </div>
              )}
            </div>

            {/* Start Schedule */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Activation Schedule
                </label>
                <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setStartMode('immediate')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg cursor-pointer ${
                      startMode === 'immediate' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Immediate
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartMode('scheduled')}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg cursor-pointer ${
                      startMode === 'scheduled' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Pick Start Date
                  </button>
                </div>
              </div>

              {startMode === 'scheduled' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Preferred Start Date (EAT)
                  </label>
                  <input
                    type="date"
                    value={scheduledDateStr}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setScheduledDateStr(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white"
                  />
                </div>
              ) : (
                <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Activates as soon as Admin approves (or next free slot).</span>
                </div>
              )}
            </div>

            {/* Wallet & Price Checkout Breakdown */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Base Price ({durationDays} day{durationDays > 1 ? 's' : ''}):</span>
                <span className="font-mono font-semibold text-slate-800">KSh {basePriceKes.toLocaleString()}</span>
              </div>
              {discountPct > 0 && (
                <div className="flex items-center justify-between text-emerald-700">
                  <span>{limits?.tierName} Discount ({discountPct}%):</span>
                  <span className="font-mono font-bold">- KSh {(basePriceKes - finalPriceKes).toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 font-extrabold text-sm text-slate-900">
                <span>Total Held from Merchant Wallet:</span>
                <span className="font-mono text-[#ff6600]">KSh {finalPriceKes.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="flex items-center gap-1 text-slate-600">
                  <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                  Available Merchant Wallet:
                </span>
                <span className={`font-mono font-bold ${hasEnoughBalance ? 'text-emerald-700' : 'text-rose-600'}`}>
                  KSh {walletKes.toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Estimated expiry if approved now: <b className="text-slate-700">{formatEatPreview(previewEndMs)}</b></span>
              </div>
            </div>

            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>
                Amount is placed on secure wallet hold pending Admin review. You may cancel anytime before approval, and rejected requests refund 100% automatically back to your Merchant Wallet.
              </span>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !targetProduct || !isPublished || !hasRequiredGroup || !isDurationAllowed || !hasEnoughBalance}
                className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Placing Hold & Submitting...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Pay KSh {finalPriceKes.toLocaleString()} & Request Featured</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
