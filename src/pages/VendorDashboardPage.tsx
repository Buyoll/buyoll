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
  FileCheck,
  Building,
  Check,
  AlertTriangle,
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
    tier: any;
    canUpgrade: boolean;
    message: string;
  } | null>(null);
  const [tiersList, setTiersList] = useState<MerchantSubscriptionTier[]>([]);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [selectedTierId, setSelectedTierId] = useState<string>('tier_500');
  const [subPaymentMethod, setSubPaymentMethod] = useState<'wallet_coins' | 'mpesa_till'>('wallet_coins');
  const [subPaymentCode, setSubPaymentCode] = useState('');
  const [submittingSubscription, setSubmittingSubscription] = useState(false);

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
    setSubmittingSubscription(true);
    try {
      if (subPaymentMethod === 'wallet_coins') {
        const res = await api.paySubscriptionCoins(selectedTierId);
        onNotify('success', res.message || 'Subscription payment submitted using wallet credit! Pending admin approval.');
        setIsSubscriptionModalOpen(false);
        loadVendorData();
      } else {
        const code = subPaymentCode.trim().toUpperCase();
        if (!code) {
          onNotify('error', 'Please enter your M-Pesa transaction code.');
          setSubmittingSubscription(false);
          return;
        }
        const tierFeeMap: Record<string, number> = {
          tier_250: 250,
          tier_500: 500,
          tier_1500: 1500,
          tier_3500: 3500,
          tier_7500: 7500,
          enterprise: 15000,
        };
        const amount = tierFeeMap[selectedTierId] || 500;
        const res = await api.submitManualSubscription({
          tierId: selectedTierId,
          paymentCode: code,
          amount,
        });
        onNotify('success', res.message || 'Subscription payment submitted for admin reconciliation.');
        setIsSubscriptionModalOpen(false);
        setSubPaymentCode('');
        loadVendorData();
      }
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process subscription');
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
      const [prodRes, grpRes, subRes, tiersRes, verifRes] = await Promise.all([
        api.getProducts({ vendorId: currentUser.id }),
        api.getGroups(),
        api.getMerchantSubscriptionCurrent().catch(() => null),
        api.getSubscriptionTiers().catch(() => ({ tiers: [] })),
        api.getMerchantVerificationStatus().catch(() => null),
      ]);
      setProducts(prodRes.products);
      setGroups(grpRes.groups);
      if (subRes) setSubscriptionInfo(subRes);
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
          {/* STRICT UPGRADE BUTTON RULE (Part D): Disabled if active with expiration date; enabled if expired */}
          {subscriptionInfo && !subscriptionInfo.isExpired ? (
            <button
              disabled
              title="Upgrade button disabled while 30-day subscription is active. Enabled once current plan expires."
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl cursor-not-allowed opacity-80"
            >
              <Clock className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Active: {subscriptionInfo.tier?.name?.split(' ')[0] || 'Store'} (Expires: {new Date(subscriptionInfo.subscription?.expiresAt).toLocaleDateString()}) · Upgrade on expiry
              </span>
            </button>
          ) : (
            <button
              onClick={() => setIsSubscriptionModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>{subscriptionInfo?.isExpired ? 'Upgrade / Renew Subscription' : 'Subscribe Store (30-Day Tiers)'}</span>
            </button>
          )}

          <button
            onClick={handleOpenCreateProduct}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-xl transition-colors shadow-sm self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Post New Listing</span>
          </button>
        </div>
      </div>

      {/* Subscription banner if expired or inactive */}
      {(!subscriptionInfo || subscriptionInfo.isExpired) && (
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
              Choose from 6 plans starting from KES 250/mo up to Enterprise. Pay seamlessly via Wallet Coins or manual M-Pesa Till / Paybill.
            </p>
          </div>
          <button
            onClick={() => setIsSubscriptionModalOpen(true)}
            className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs shrink-0 flex items-center gap-2"
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
              onClick={() => setIsSubscriptionModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

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
                  onClick={() => setSelectedTierId(tier.id)}
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

            {/* Payment Method Switcher (Part D) */}
            <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Select Payment Method:
              </label>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => setSubPaymentMethod('wallet_coins')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    subPaymentMethod === 'wallet_coins'
                      ? 'border-[#0E5A3C] bg-white ring-2 ring-[#0E5A3C]/20 shadow-xs'
                      : 'border-slate-200 bg-slate-100/50 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 mb-0.5">
                    <Coins className="w-4 h-4 text-amber-500" />
                    <span>Wallet Balance / Coins</span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Wallet credit payment. Requires Admin approval. Your coins: {currentUser?.coins || 0}.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setSubPaymentMethod('mpesa_till')}
                  className={`p-3 rounded-xl border text-left transition-all ${
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
                    Buy Goods Till 196853 or Paybill 522533. Reconciled by Admin.
                  </p>
                </button>
              </div>

              {subPaymentMethod === 'mpesa_till' && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="text-[11px] text-emerald-900 font-medium">
                    Pay KSh {selectedTierId === 'tier_250' ? '250' : selectedTierId === 'tier_500' ? '500' : selectedTierId === 'tier_1500' ? '1,500' : selectedTierId === 'tier_3500' ? '3,500' : selectedTierId === 'tier_7500' ? '7,500' : '15,000'} to <b>Buy Goods Till 196853</b> (Buyoll Platform) or <b>Paybill 522533</b> (Acc: code4363).
                  </div>
                  <input
                    type="text"
                    value={subPaymentCode}
                    onChange={(e) => setSubPaymentCode(e.target.value.toUpperCase())}
                    placeholder="Enter M-Pesa Transaction Code (e.g. QJL890KN12)"
                    maxLength={12}
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg uppercase focus:ring-2 focus:ring-[#0E5A3C] outline-none"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsSubscriptionModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubscriptionPay}
                disabled={submittingSubscription}
                className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
              >
                {submittingSubscription ? 'Processing...' : subPaymentMethod === 'wallet_coins' ? 'Confirm Payment with Coins' : 'Submit Code for Admin Approval'}
              </button>
            </div>
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
