import React, { useState, useEffect } from 'react';
import { User, Product, ChamaGroup, MerchantSubscriptionTier } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { VendorProductEditorModal } from './VendorProductEditorModal.tsx';
import { triggerVisualPushAlert } from '../utils/notifications.ts';
import {
  Package,
  Plus,
  Edit3,
  Users,
  Eye,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  Sparkles,
  Tag,
  X,
  Store,
  Shield,
  Coins,
  CreditCard,
  Wallet,
  FileCheck,
  Building,
  Check,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface VendorDashboardPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const VendorDashboardPage: React.FC<VendorDashboardPageProps> = ({
  currentUser,
  onNavigate,
  onNotify,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // 6-Tier Subscription & Upgrade state (Part C & D)
  const [subscriptionInfo, setSubscriptionInfo] = useState<{
    hasSubscription: boolean;
    isExpired: boolean;
    daysRemaining: number;
    subscription: any;
    pendingSubscription?: any;
    tier: any;
    canUpgrade: boolean;
    message: string;
  } | null>(null);
  const [tiersList, setTiersList] = useState<MerchantSubscriptionTier[]>([]);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<string>('tier_500');
  const [subPaymentMethod, setSubPaymentMethod] = useState<'wallet_credit' | 'wallet_coins' | 'mpesa_till'>('mpesa_till');
  const [subPaymentCode, setSubPaymentCode] = useState('');
  const [submittingSubscription, setSubmittingSubscription] = useState(false);
  const [subCodeTouched, setSubCodeTouched] = useState(false);
  const [subModalError, setSubModalError] = useState<{
    field?: string;
    code?: string;
    status?: number;
    message: string;
    canRetry?: boolean;
  } | null>(null);
  const [subModalSuccess, setSubModalSuccess] = useState<{
    planName: string;
    amount: number;
    code?: string;
    method: string;
    status: string;
  } | null>(null);

  // Merchant Verification state (Part C & G)
  const [verificationInfo, setVerificationInfo] = useState<{
    hasSubmitted: boolean;
    verification: any;
    isVerified: boolean;
    badge: string | null;
  } | null>(null);
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [verifPhysicalShop, setVerifPhysicalShop] = useState(true);
  const [verifLicence, setVerifLicence] = useState('');
  const [verifNationalId, setVerifNationalId] = useState('');
  const [verifYears, setVerifYears] = useState(3);
  const [verifLocation, setVerifLocation] = useState('');
  const [verifBusinessType, setVerifBusinessType] = useState('Retail & Electronics');
  const [submittingVerification, setSubmittingVerification] = useState(false);

  // 10-Speed Group Creation modal
  const [isSpeedGroupModalOpen, setIsSpeedGroupModalOpen] = useState(false);
  const [selectedProductForGroup, setSelectedProductForGroup] = useState<Product | null>(null);
  const [selectedSpeedSize, setSelectedSpeedSize] = useState<number>(10);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<'platform' | 'merchant'>('platform');
  const [submittingSpeedGroup, setSubmittingSpeedGroup] = useState(false);

  const isSubscribedAndVerified = Boolean(
    (currentUser?.merchantSubscriptionStatus === 'active' || (subscriptionInfo?.subscription && !subscriptionInfo?.isExpired)) &&
    (currentUser?.verified || verificationInfo?.isVerified)
  );

  async function handleSubscriptionPay() {
    setSubModalError(null);

    // Client-side validation mirroring the server
    if (subPaymentMethod === 'mpesa_till') {
      const code = subPaymentCode.trim().toUpperCase();
      if (!code) {
        setSubModalError({
          field: 'mpesaCode',
          message: 'Please enter your 10-character M-Pesa transaction code.',
        });
        setSubCodeTouched(true);
        return;
      }
      if (!/^[A-Z0-9]{10}$/.test(code)) {
        setSubModalError({
          field: 'mpesaCode',
          message: 'Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN',
        });
        setSubCodeTouched(true);
        return;
      }
    }

    setSubmittingSubscription(true);

    try {
      const tierMap: Record<string, { name: string; fee: number }> = {
        tier_250: { name: 'Micro-Merchant', fee: 250 },
        tier_500: { name: 'Growing Merchant', fee: 500 },
        tier_1500: { name: 'Pro Merchant', fee: 1500 },
        tier_3500: { name: 'Commercial', fee: 3500 },
        tier_7500: { name: 'Enterprise Scale', fee: 7500 },
        enterprise: { name: 'Custom Enterprise', fee: 15000 },
      };
      const plan = tierMap[selectedTierId] || { name: 'Growing Merchant', fee: 500 };
      const normalizedMethod =
        subPaymentMethod === 'wallet_credit' ? 'wallet' : subPaymentMethod === 'wallet_coins' ? 'coins' : 'mpesa';

      const res = await api.submitSubscriptionRequest({
        planId: selectedTierId,
        paymentMethod: normalizedMethod,
        mpesaCode: normalizedMethod === 'mpesa' ? subPaymentCode.trim().toUpperCase() : undefined,
      });

      // Successful submission -> Render Success View
      setSubModalSuccess({
        planName: plan.name,
        amount: res.request?.amountExpected || plan.fee,
        code: res.request?.mpesaCode || (normalizedMethod === 'mpesa' ? subPaymentCode.trim().toUpperCase() : undefined),
        method:
          normalizedMethod === 'wallet'
            ? 'Merchant Wallet (KES)'
            : normalizedMethod === 'coins'
            ? 'Applaud Coins'
            : 'Buy Goods Till 196853 / Paybill 522533',
        status: res.request?.status === 'approved' ? 'Active' : 'Pending admin approval',
      });

      onNotify('success', res.message || 'Subscription request submitted successfully!');
      await loadVendorData();
    } catch (err: any) {
      console.error('Subscription submission failed:', err);

      let message = err.message || 'Something went wrong. Your payment is safe, please try again.';
      let code = err.code || 'ERROR';
      const status = err.status || 500;
      let canRetry = false;

      if (status === 400 || status === 422) {
        if (code === 'INVALID_MPESA_CODE' || message.toLowerCase().includes('10-character')) {
          message = 'Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN';
        }
      } else if (status === 409) {
        if (code === 'DUPLICATE_CODE' || message.toLowerCase().includes('already been submitted')) {
          message = 'This code has already been submitted and is currently pending or approved.';
        } else if (code === 'PENDING_REQUEST_EXISTS' || message.toLowerCase().includes('pending review')) {
          message = 'You already have a subscription payment pending admin review.';
        } else if (code === 'ACTIVE_CYCLE_EXISTS') {
          message = err.message || 'Your current 30-day subscription is still active. Upgrade becomes available once this cycle expires.';
        }
      } else if (status === 401) {
        message = 'Session expired. Please sign in again to continue.';
      } else if (status === 429) {
        message = 'Too many attempts, try again shortly.';
      } else {
        message = 'Something went wrong. Your payment is safe, please try again.';
        canRetry = true;
      }

      setSubModalError({
        field: status === 422 ? 'mpesaCode' : undefined,
        code,
        status,
        message,
        canRetry,
      });

      onNotify('error', message);
    } finally {
      setSubmittingSubscription(false);
    }
  }

  async function handleVerificationSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!verifLicence.trim() || !verifNationalId.trim() || !verifLocation.trim()) {
      onNotify('error', 'Trading licence, national ID/passport, and shop location are mandatory.');
      return;
    }

    setSubmittingVerification(true);
    try {
      const res = await api.submitMerchantVerification({
        hasPhysicalShop: verifPhysicalShop,
        tradingLicenceNumber: verifLicence,
        nationalIdOrPassport: verifNationalId,
        yearsOperating: verifYears,
        shopLocation: verifLocation,
        businessType: verifBusinessType,
      });
      onNotify('success', res.message || 'Verification submitted for Buyoll Admin review!');
      setIsVerificationModalOpen(false);
      loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit verification');
    } finally {
      setSubmittingVerification(false);
    }
  }

  async function handleCreateSpeedGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductForGroup) return;

    if (!isSubscribedAndVerified && currentUser?.role === 'merchant') {
      onNotify('error', 'Active merchant subscription and verification required to launch speed groups.');
      setIsSubscriptionModalOpen(true);
      return;
    }

    setSubmittingSpeedGroup(true);
    try {
      const res = await api.createGroup({
        productId: selectedProductForGroup.id,
        size: selectedSpeedSize,
        paymentMode: selectedPaymentMode,
      });
      onNotify('success', `Created ${selectedSpeedSize}-Member Speed Group!`);
      triggerVisualPushAlert({
        title: '🎉 New Chama Group Launched!',
        body: `${(currentUser as any)?.businessName || currentUser?.name || 'A merchant'} launched "${selectedProductForGroup.title}" Chama (${selectedSpeedSize} members). Request entry now!`,
        url: `/chama/${res.group.id}`,
        tag: `new-group-${res.group.id}`,
      });
      setIsSpeedGroupModalOpen(false);
      loadVendorData();
      onNavigate('group', res.group.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to create speed group');
    } finally {
      setSubmittingSpeedGroup(false);
    }
  }

  const [hasLoaded, setHasLoaded] = useState(false);
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (currentUserId) {
      loadVendorData(true);
    } else {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [currentUserId]);

  async function loadVendorData(isInitial = false) {
    if (!currentUser) return;
    if (isInitial || !hasLoaded) {
      setLoading(true);
    }
    try {
      const [prodRes, grpRes, subRes, tiersRes, verifRes, myReqRes] = await Promise.all([
        api.getProducts({ vendorId: currentUser.id }),
        api.getGroups(),
        api.getMerchantSubscriptionCurrent().catch(() => null),
        api.getSubscriptionTiers().catch(() => ({ tiers: [] })),
        api.getMerchantVerificationStatus().catch(() => null),
        api.getMySubscriptionRequest().catch(() => null),
      ]);
      setProducts(prodRes.products);
      setGroups(grpRes.groups);
      if (subRes) setSubscriptionInfo(subRes);
      if (myReqRes?.request && myReqRes.request.status === 'pending') {
        setSubscriptionInfo((prev: any) => ({
          ...(prev || {}),
          hasSubscription: Boolean(prev?.hasSubscription || myReqRes.hasActiveSubscription),
          pendingSubscription: myReqRes.request,
        }));
      }
      if (tiersRes?.tiers?.length) setTiersList(tiersRes.tiers);
      if (verifRes) setVerificationInfo(verifRes);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load merchant data');
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }

  const myProductIds = products.map(p => p.id);
  const myGroups = groups.filter(g => myProductIds.includes(g.productId));
  const totalMembersEnrolled = myGroups.reduce((acc, g) => acc + g.occupiedCount, 0);
  const totalRevenue = myGroups.reduce((acc, g) => {
    return acc + g.slots.filter(s => s.status === 'active').reduce((sum, s) => sum + (s.paidAmount || 0), 0);
  }, 0);

  function handleOpenCreateProduct() {
    if (!isSubscribedAndVerified && currentUser?.role === 'merchant') {
      onNotify('info', 'Active merchant subscription and verification required to post products.');
      setIsSubscriptionModalOpen(true);
      return;
    }
    setEditingProduct(null);
    setIsEditorOpen(true);
  }

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Store className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Merchant Portal</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          Sign in or register your merchant store to post genuine verified items, manage Chama rotation orders, and activate 10-day speed groups.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-6 py-2.5 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl shadow-sm transition-all"
        >
          Explore Public Marketplace
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {currentUser?.shopName || currentUser?.name} Dashboard
            </h1>
            {currentUser?.verified || verificationInfo?.isVerified ? (
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-2xs border border-emerald-300">
                <Shield className="w-3.5 h-3.5 text-emerald-700" />
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span>Buyoll Verified Merchant</span>
              </span>
            ) : (
              <button
                onClick={() => setIsVerificationModalOpen(true)}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Click to submit verification details or check status"
              >
                <Shield className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  {verificationInfo?.verification?.status === 'pending_review'
                    ? 'Verification: Under Admin Review'
                    : verificationInfo?.verification?.status === 'visit_scheduled'
                    ? 'Verification: Shop Visit Scheduled'
                    : 'Apply for Verified Merchant Badge'}
                </span>
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Manage your catalog, edit pricing and speed configurations, and track Chama orders.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {subscriptionInfo?.subscription && !subscriptionInfo.isExpired ? (
            <button
              onClick={() => setIsSubscriptionModalOpen(true)}
              title="Click to upgrade or renew your 30-day merchant tier"
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-xs font-bold rounded-xl hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Active: {subscriptionInfo.tier?.name?.split(' ')[0] || 'Store'} (Expires: {new Date(subscriptionInfo.subscription?.expiresAt).toLocaleDateString()}) · Upgrade/Renew
              </span>
            </button>
          ) : (
            <button
              onClick={() => setIsSubscriptionModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-sm cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>{subscriptionInfo?.isExpired ? 'Upgrade / Renew Subscription' : 'Subscribe Store (30-Day Tiers)'}</span>
            </button>
          )}

          <button
            onClick={handleOpenCreateProduct}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-xl transition-colors shadow-sm self-start sm:self-auto cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Post New Listing</span>
          </button>
        </div>
      </div>

      {/* PENDING ADMIN APPROVAL BANNER */}
      {subscriptionInfo?.pendingSubscription && (
        <div className="mb-6 p-4 bg-amber-50/90 border-2 border-amber-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-black text-amber-950 uppercase tracking-wider">
                Subscription Request Under Admin Verification
              </h4>
              <p className="text-xs text-amber-900 mt-0.5">
                Your request for <b>{subscriptionInfo.pendingSubscription.tierName}</b> ({subscriptionInfo.pendingSubscription.paymentCode || (subscriptionInfo.pendingSubscription.paymentMethod === 'wallet_credit' ? 'Wallet Credit' : 'Wallet Coins')}) is awaiting Admin verification against M-Pesa statements. Once approved, your catalog limits will activate for 30 days!
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300 rounded-full text-[11px] font-bold uppercase tracking-wider shrink-0 self-start sm:self-auto animate-pulse">
            Pending Admin Approval
          </span>
        </div>
      )}

      {/* Subscription banner if expired or inactive */}
      {(!subscriptionInfo || subscriptionInfo.isExpired) && !subscriptionInfo?.pendingSubscription && (
        <div className="mb-8 p-6 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-teal-500/10 border-2 border-emerald-600/30 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 bg-[#0E5A3C] text-white text-[10px] font-black uppercase rounded-full">
                Merchant Subscription (30 Days)
              </span>
              <span className="text-xs font-bold text-amber-800">
                {subscriptionInfo?.isExpired ? 'Subscription Expired · Upgrade Enabled' : 'Activation Required'}
              </span>
            </div>
            <h3 className="text-base font-extrabold text-slate-900">
              {subscriptionInfo?.isExpired
                ? 'Your 30-Day Subscription has ended. Upgrade is now available to choose any tier.'
                : 'Subscribe to a 30-Day Merchant Tier to Post Products & Open Speed Groups'}
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              Choose from 6 plans starting from KES 250/mo up to Enterprise. Pay seamlessly via Wallet Coins, Store Credit or manual M-Pesa Till / Paybill.
            </p>
          </div>
          <button
            onClick={() => setIsSubscriptionModalOpen(true)}
            className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <span>Upgrade / Choose Plan</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}


      {/* KPI Stats Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Live Listings</span>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 tabular-nums">
            {products.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Available for buyer Chamas</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Members Enrolled</span>
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 tabular-nums">
            {totalMembersEnrolled}
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-1">
            Across {myGroups.length} active group{myGroups.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Total Value In Circulation</span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-[#0E5A3C] tabular-nums">
            KSh {totalRevenue.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Released as slots mature</div>
        </div>
      </div>

      {/* FEATURED DEAL HERO SHOWCASE PROMOTION */}
      <div className="bg-gradient-to-r from-emerald-900 to-[#0E5A3C] rounded-2xl p-6 text-white mb-8 shadow-sm border border-emerald-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 bg-amber-400 text-slate-900 rounded-md">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Featured Deal Section Placement
            </span>
            <span className="px-2 py-0.5 bg-white/20 text-white text-[10px] font-bold rounded-full">
              KSh 500 / month per featured image
            </span>
          </div>
          <h3 className="text-base font-bold text-white">
            Promote Your Products to Over 100,000+ Active Group Savers
          </h3>
          <p className="text-xs text-emerald-100/90 mt-1 max-w-2xl">
            Featured announcements appear at the top hero banner with 2.5-second auto-rolling visibility, guaranteed slot priority, and direct M-Pesa Till 000000 escrow integration.
          </p>
        </div>

        <button
          onClick={() => {
            setEditingProduct(null);
            setIsEditorOpen(true);
          }}
          className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-sm shrink-0 flex items-center gap-1.5"
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Feature an Announcement</span>
        </button>
      </div>

      {/* Product Listings Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs mb-8">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Your Product Listings</h2>
          <span className="text-xs text-slate-500">{products.length} items</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading your listings...</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-900 mb-1">No products listed yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Add your first genuine product listing with customized Chama speeds and start selling.
            </p>
            <button
              onClick={() => {
                setEditingProduct(null);
                setIsEditorOpen(true);
              }}
              className="px-4 py-2 bg-[#0E5A3C] text-white text-xs font-bold rounded-lg"
            >
              Post First Product
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-6">Product</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Price</th>
                  <th className="py-3 px-4">Configured Speeds</th>
                  <th className="py-3 px-4">Stock</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => {
                  const itemGroups = myGroups.filter(g => g.productId === p.id);
                  const members = itemGroups.reduce((a, g) => a + g.occupiedCount, 0);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-6">
                        <div className="flex items-center gap-3">
                          <img
                            src={resolveImageUrl(p.images[0])}
                            alt=""
                            className="w-12 h-12 object-cover rounded-lg border border-slate-200 shrink-0"
                          />
                          <div>
                            <div className="font-bold text-slate-900 line-clamp-1 max-w-xs">
                              {p.title}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {members} members in {itemGroups.length} groups
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{p.category}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 tabular-nums">
                        KSh {p.price.toLocaleString()}
                        {p.wasPrice && (
                          <div className="text-[10px] text-slate-400 line-through">
                            KSh {p.wasPrice.toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {p.speedOptions?.map(s => (
                            <span key={s.size} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono">
                              {s.size}m
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700">{p.stockQuantity}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-full text-[10px]">
                          Approved
                        </span>
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setSelectedProductForGroup(p);
                              setSelectedSpeedSize(10);
                              setSelectedPaymentMode(currentUser?.tillNumber ? 'merchant' : 'platform');
                              setIsSpeedGroupModalOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs transition-colors"
                            title="Launch 1-10 Member Speed Group"
                          >
                            <Users className="w-3.5 h-3.5" />
                            <span>Launch Speed</span>
                          </button>
                          <button
                            onClick={() => onNavigate('product', p.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
                            title="View Public Page"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingProduct(p);
                              setIsEditorOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white font-semibold rounded-lg text-xs"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit Listing</span>
                          </button>
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

      {/* Active Chama Groups under this merchant */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
        <h2 className="text-base font-bold text-slate-900 mb-4">
          Active Buyer Chamas for Your Products
        </h2>
        {myGroups.length === 0 ? (
          <p className="text-xs text-slate-500">No buyer Chamas have formed yet for your products.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myGroups.map((g) => (
              <div
                key={g.id}
                onClick={() => onNavigate('group', g.id)}
                className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer bg-slate-50/50"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-slate-900 text-xs line-clamp-1">{g.name}</h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                    {g.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mb-2">{g.productTitle}</div>
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{g.occupiedCount} of {g.size} members</span>
                  <b>KSh {g.dailyAmount.toLocaleString()}/day</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {isEditorOpen && (
        <VendorProductEditorModal
          product={editingProduct}
          onClose={() => setIsEditorOpen(false)}
          onSaved={() => {
            loadVendorData();
          }}
          onNotify={onNotify}
        />
      )}

      {/* 6-TIER MERCHANT SUBSCRIPTION MODAL (Part C & D) */}
      {isSubscriptionModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setIsSubscriptionModalOpen(false);
                setSubModalSuccess(null);
                setSubModalError(null);
              }}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* CASE 1: SUCCESS VIEW */}
            {subModalSuccess ? (
              <div className="text-center py-6 px-2 sm:px-6">
                <div className="w-16 h-16 bg-emerald-100 text-[#0E5A3C] rounded-full flex items-center justify-center mx-auto mb-4 shadow-xs">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800 block mb-1">
                  Buyoll 30-Day Merchant Plan
                </span>
                <h3 className="text-2xl font-black text-slate-900 mb-2">
                  Request submitted!
                </h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto mb-6">
                  Your 30-day merchant plan request has been logged successfully and routed to Buyoll Admin.
                </p>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left max-w-md mx-auto mb-6 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">Selected Plan:</span>
                    <span className="font-extrabold text-slate-900">{subModalSuccess.planName}</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">Amount:</span>
                    <span className="font-mono font-bold text-[#0E5A3C]">KSh {subModalSuccess.amount.toLocaleString()}</span>
                  </div>
                  {subModalSuccess.code && (
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-slate-500 font-medium">M-Pesa Code:</span>
                      <span className="font-mono font-bold uppercase text-slate-900 bg-amber-100 px-2 py-0.5 rounded">
                        {subModalSuccess.code}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Status:</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Pending admin approval
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-emerald-50/80 border border-emerald-200 rounded-xl text-xs text-emerald-900 max-w-md mx-auto mb-6">
                  We'll notify you once an admin verifies your payment against M-Pesa statements, usually within a few hours.
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsSubscriptionModalOpen(false);
                    setSubModalSuccess(null);
                  }}
                  className="w-full max-w-md mx-auto py-3 bg-[#0E5A3C] hover:bg-[#0a452e] text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer block"
                >
                  Done
                </button>
              </div>
            ) : subscriptionInfo?.pendingSubscription ? (
              /* CASE 2: READ-ONLY PENDING STATE */
              <div className="py-4 px-2 sm:px-6">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-100 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                    <Clock className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                      Verification In Progress
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900">
                      Pending Approval
                    </h3>
                  </div>
                </div>

                <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-5 mb-5 text-xs text-slate-700">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-slate-900 text-sm mb-0.5">
                        Your Subscription Request is Awaiting Admin Verification
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        You have already submitted a payment code for this store. An admin is reconciling it against Till 196853 and Paybill 522533 statements.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-amber-200/80">
                    <div className="p-2.5 bg-white rounded-lg border border-amber-100">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block mb-0.5">Requested Plan</span>
                      <span className="font-extrabold text-slate-900 text-xs">
                        {subscriptionInfo.pendingSubscription.planName || subscriptionInfo.pendingSubscription.tierName || 'Growing Merchant'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-amber-100">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block mb-0.5">Amount Expected</span>
                      <span className="font-mono font-bold text-[#0E5A3C] text-xs">
                        KSh {Number(subscriptionInfo.pendingSubscription.amountExpected || subscriptionInfo.pendingSubscription.amount || 500).toLocaleString()}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-amber-100">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block mb-0.5">Payment Method</span>
                      <span className="font-semibold text-slate-800 text-xs">
                        {subscriptionInfo.pendingSubscription.paymentMethod === 'wallet'
                          ? 'Merchant Wallet'
                          : subscriptionInfo.pendingSubscription.paymentMethod === 'coins'
                          ? 'Applaud Coins'
                          : 'Buy Goods Till / Paybill'}
                      </span>
                    </div>

                    <div className="p-2.5 bg-white rounded-lg border border-amber-100">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block mb-0.5">M-Pesa Transaction Code</span>
                      <span className="font-mono font-bold uppercase text-slate-900 text-xs bg-amber-100 px-2 py-0.5 rounded">
                        {subscriptionInfo.pendingSubscription.mpesaCode || subscriptionInfo.pendingSubscription.paymentCode || 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 mb-5 leading-relaxed">
                  💡 <b>No further action needed.</b> Your 30-day selling window will activate immediately once Buyoll Admin confirms the transaction on official M-Pesa statements.
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsSubscriptionModalOpen(false)}
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg cursor-pointer transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              /* CASE 3: SELECTION & SUBMISSION FORM */
              <div>
                <div className="pb-3 border-b border-slate-100 mb-4">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#0E5A3C] block">
                    Buyoll Merchant 30-Day Subscriptions
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Choose Your 30-Day Merchant Plan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Each subscription grants an active 30-day selling window. Upgrade to another tier becomes available once this cycle expires.
                  </p>
                </div>

                {/* 6 Tiers Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  {[
                    { id: 'tier_250', name: 'Micro-Merchant', fee: 250, prods: 'Max 2 Products', grps: '2 Groups / Product', desc: 'Caters to very small businesses and solo makers' },
                    { id: 'tier_500', name: 'Growing Merchant', fee: 500, prods: 'Up to 10 Products', grps: '5 Groups / Product', desc: 'Ideal for growing neighborhood retailers' },
                    { id: 'tier_1500', name: 'Pro Merchant', fee: 1500, prods: 'Up to 50 Products', grps: '10 Groups / Product', desc: 'For active retail businesses and popular shops' },
                    { id: 'tier_3500', name: 'Commercial', fee: 3500, prods: 'Up to 100 Products', grps: '30 Groups / Product', desc: 'High capacity volume sales for established stores' },
                    { id: 'tier_7500', name: 'Enterprise Scale', fee: 7500, prods: 'Unlimited Products', grps: '50 Groups / Product', desc: 'Unlimited catalog for major retail distributors' },
                    { id: 'enterprise', name: 'Custom Enterprise', fee: 15000, prods: 'Unlimited Products', grps: 'Up to 100 Groups', desc: 'Custom SLA and limits set by Buyoll Admin' },
                  ].map((tier) => (
                    <div
                      key={tier.id}
                      onClick={() => {
                        setSelectedTierId(tier.id);
                        setSubModalError(null);
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        selectedTierId === tier.id
                          ? 'border-[#0E5A3C] bg-emerald-50/60 shadow-xs ring-1 ring-[#0E5A3C]'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-bold text-xs text-slate-900">{tier.name}</span>
                        <span className="text-xs font-mono font-bold text-[#0E5A3C]">KSh {tier.fee.toLocaleString()}</span>
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-800 mb-1">
                        {tier.prods} · {tier.grps}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-tight">{tier.desc}</p>
                    </div>
                  ))}
                </div>

                {/* Payment Method Switcher */}
                <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    Select Payment Method:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSubPaymentMethod('mpesa_till');
                        setSubModalError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        subPaymentMethod === 'mpesa_till'
                          ? 'border-[#0E5A3C] bg-white ring-2 ring-[#0E5A3C]/20 shadow-xs'
                          : 'border-slate-200 bg-slate-100/50 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-0.5">
                        <CreditCard className="w-4 h-4 text-emerald-600" />
                        <span>M-Pesa Till / Paybill</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Till 196853 or Paybill 522533. Submit code for Admin reconciliation.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubPaymentMethod('wallet_credit');
                        setSubModalError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        subPaymentMethod === 'wallet_credit'
                          ? 'border-[#0E5A3C] bg-white ring-2 ring-[#0E5A3C]/20 shadow-xs'
                          : 'border-slate-200 bg-slate-100/50 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-0.5">
                        <Wallet className="w-4 h-4 text-emerald-700" />
                        <span>Merchant Wallet (KES)</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Operating balance: <b>KSh {(currentUser?.roleWallets?.merchant?.credit ?? currentUser?.credit ?? 0).toLocaleString()}</b>
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSubPaymentMethod('wallet_coins');
                        setSubModalError(null);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        subPaymentMethod === 'wallet_coins'
                          ? 'border-[#0E5A3C] bg-white ring-2 ring-[#0E5A3C]/20 shadow-xs'
                          : 'border-slate-200 bg-slate-100/50 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-0.5">
                        <Coins className="w-4 h-4 text-amber-500" />
                        <span>Applaud Coins</span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Coins balance: <b>{currentUser?.coins || 0} coins</b>
                      </p>
                    </button>
                  </div>

                  {subPaymentMethod === 'mpesa_till' && (
                    <div className="space-y-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] text-emerald-900 font-medium">
                        Pay KSh {selectedTierId === 'tier_250' ? '250' : selectedTierId === 'tier_500' ? '500' : selectedTierId === 'tier_1500' ? '1,500' : selectedTierId === 'tier_3500' ? '3,500' : selectedTierId === 'tier_7500' ? '7,500' : '15,000'} to <b>Buy Goods Till 196853</b> (Buyoll Platform) or <b>Paybill 522533</b> (Acc: code4363).
                      </div>
                      <div>
                        <input
                          type="text"
                          value={subPaymentCode}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
                            setSubPaymentCode(val);
                            setSubCodeTouched(true);
                            setSubModalError(null);
                          }}
                          onBlur={() => setSubCodeTouched(true)}
                          placeholder="Enter 10-character M-Pesa Code (e.g. QGH7K2L9MN)"
                          maxLength={10}
                          className={`w-full px-3.5 py-2.5 text-xs font-mono border rounded-lg uppercase tracking-wider focus:ring-2 focus:ring-[#0E5A3C] outline-none ${
                            subCodeTouched && subPaymentCode.length > 0 && !/^[A-Z0-9]{10}$/.test(subPaymentCode)
                              ? 'border-rose-400 bg-rose-50/30'
                              : 'border-slate-300 bg-white'
                          }`}
                        />
                        {/* Client-side inline error mirroring the server */}
                        {subCodeTouched && subPaymentCode.length > 0 && !/^[A-Z0-9]{10}$/.test(subPaymentCode) && (
                          <p className="text-xs text-rose-600 font-medium mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN</span>
                          </p>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Admin verifies your code against M-Pesa statements and activates your store for 30 days.
                      </p>
                    </div>
                  )}

                  {subPaymentMethod === 'wallet_credit' && (
                    <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                      <p className="text-[11px] text-emerald-900 font-medium">
                        KSh {selectedTierId === 'tier_250' ? '250' : selectedTierId === 'tier_500' ? '500' : selectedTierId === 'tier_1500' ? '1,500' : selectedTierId === 'tier_3500' ? '3,500' : selectedTierId === 'tier_7500' ? '7,500' : '15,000'} will be deducted from your Merchant Wallet and your 30-day plan activated immediately!
                      </p>
                    </div>
                  )}

                  {subPaymentMethod === 'wallet_coins' && (
                    <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                      <p className="text-[11px] text-amber-900 font-medium">
                        {selectedTierId === 'tier_250' ? '250' : selectedTierId === 'tier_500' ? '500' : selectedTierId === 'tier_1500' ? '1,500' : selectedTierId === 'tier_3500' ? '3,500' : selectedTierId === 'tier_7500' ? '7,500' : '15,000'} coins will be deducted from your wallet and your 30-day plan activated immediately!
                      </p>
                    </div>
                  )}
                </div>

                {/* Inline Error Display (Never Silently Fail) */}
                {subModalError && (
                  <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start justify-between gap-3 animate-fadeIn">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">Submission Error</span>
                        <span>{subModalError.message}</span>
                      </div>
                    </div>
                    {subModalError.canRetry && (
                      <button
                        type="button"
                        onClick={handleSubscriptionPay}
                        className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-md flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsSubscriptionModalOpen(false);
                      setSubModalError(null);
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubscriptionPay}
                    disabled={
                      submittingSubscription ||
                      (subPaymentMethod === 'mpesa_till' && (!subPaymentCode.trim() || !/^[A-Z0-9]{10}$/.test(subPaymentCode.trim())))
                    }
                    className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingSubscription ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Submitting...</span>
                      </>
                    ) : subPaymentMethod === 'mpesa_till' ? (
                      'Submit Code for Admin Approval'
                    ) : subPaymentMethod === 'wallet_credit' ? (
                      'Pay with Wallet & Activate'
                    ) : (
                      'Pay with Coins & Activate'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* MERCHANT VERIFICATION APPLICATION MODAL (Part C & G) */}
      {isVerificationModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsVerificationModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#0E5A3C] flex items-center justify-center">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Buyoll Verified Merchant Application
                </h3>
                <span className="text-[10px] font-bold text-slate-500">
                  Physical Shop Visit & Document Inspection
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Earn the <b>Buyoll Verified Merchant</b> badge. Verification requires a physical shop visit by our field operations team, trading license verification, and advert photo installation.
            </p>

            <form onSubmit={handleVerificationSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Do you operate a physical retail shop / store? <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="physical"
                      checked={verifPhysicalShop === true}
                      onChange={() => setVerifPhysicalShop(true)}
                    />
                    <span>Yes, physical walk-in store</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="physical"
                      checked={verifPhysicalShop === false}
                      onChange={() => setVerifPhysicalShop(false)}
                    />
                    <span>Online / Warehouse only</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Physical Shop Address & Landmark <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={verifLocation}
                  onChange={(e) => setVerifLocation(e.target.value)}
                  placeholder="e.g. Stall B14, Luthuli Avenue, Nairobi CBD"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Trading Licence No. <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={verifLicence}
                    onChange={(e) => setVerifLicence(e.target.value)}
                    placeholder="e.g. NCC-TL-2026-981"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    National ID / Passport <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={verifNationalId}
                    onChange={(e) => setVerifNationalId(e.target.value)}
                    placeholder="e.g. 29384756"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Years Operating
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={verifYears}
                    onChange={(e) => setVerifYears(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Business Category
                  </label>
                  <input
                    type="text"
                    value={verifBusinessType}
                    onChange={(e) => setVerifBusinessType(e.target.value)}
                    placeholder="e.g. Electronics & Solar"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                <b>Field Visit Requirement:</b> Buyoll field representatives will visit your registered premises, inspect your stock, and install an official Buyoll Merchant advert banner.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsVerificationModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingVerification}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                >
                  {submittingVerification ? 'Submitting Application...' : 'Submit Verification Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROMPT 4: 10-SPEED GROUP CREATION MODAL */}
      {isSpeedGroupModalOpen && selectedProductForGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsSpeedGroupModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">
                Launch Speed Chama Group
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Open a new Chama group for <b>{selectedProductForGroup.title}</b> (KSh {selectedProductForGroup.price.toLocaleString()}) with 1 to 10 member speed options.
            </p>

            <form onSubmit={handleCreateSpeedGroup} className="space-y-4">
              {/* 10 Speed Selection Options */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Choose Group Speed (1 to 10 Members):
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sz) => {
                    const isSolo = sz === 1;
                    const daily = isSolo
                      ? Math.ceil(selectedProductForGroup.price / 90)
                      : Math.ceil(selectedProductForGroup.price / sz / 10);

                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setSelectedSpeedSize(sz)}
                        className={`p-2.5 rounded-xl border text-center transition-all ${
                          selectedSpeedSize === sz
                            ? 'border-[#0E5A3C] bg-emerald-50 text-[#0E5A3C] font-black ring-2 ring-[#0E5A3C]/30'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700 font-bold'
                        }`}
                      >
                        <div className="text-xs">{sz} {isSolo ? 'Solo' : 'Mem'}</div>
                        <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                          KSh {daily.toLocaleString()}/d
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Mode Selection: Option A (Merchant Till) vs Option B (Platform Till) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Choose Payment Collection Mode:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setSelectedPaymentMode('merchant')}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedPaymentMode === 'merchant'
                        ? 'border-[#0E5A3C] bg-emerald-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900 mb-1">
                      Option A: Merchant Direct Till
                    </div>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      Members pay directly to your store Till ({currentUser?.tillNumber || 'Merchant Till'}). No platform escrow.
                    </p>
                  </div>

                  <div
                    onClick={() => setSelectedPaymentMode('platform')}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedPaymentMode === 'platform'
                        ? 'border-[#0E5A3C] bg-emerald-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-900 mb-1">
                      Option B: Buyoll Platform Till
                    </div>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      Members pay via Buyoll Platform Till (196853) / Paybill (522533). Released upon item collection.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSpeedGroupModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSpeedGroup}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                >
                  {submittingSpeedGroup ? 'Opening Group...' : `Launch ${selectedSpeedSize}-Member Speed Group`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
