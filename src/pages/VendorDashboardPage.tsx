import React, { useState, useEffect } from 'react';
import { User, Product, ChamaGroup } from '../types.ts';
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

  // PROMPT 4: Merchant Onboarding & Subscription 3-Step Flow state
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [subStep, setSubStep] = useState<1 | 2 | 3>(1);
  const [subPlan, setSubPlan] = useState<'starter' | 'pro' | 'enterprise'>('starter');
  const [subPaymentCode, setSubPaymentCode] = useState('');
  const [subTillNumber, setSubTillNumber] = useState(currentUser?.tillNumber || '');
  const [subPaybillNumber, setSubPaybillNumber] = useState(currentUser?.paybillNumber || '');
  const [submittingSubscription, setSubmittingSubscription] = useState(false);

  // PROMPT 4: 10-Speed Group Creation modal
  const [isSpeedGroupModalOpen, setIsSpeedGroupModalOpen] = useState(false);
  const [selectedProductForGroup, setSelectedProductForGroup] = useState<Product | null>(null);
  const [selectedSpeedSize, setSelectedSpeedSize] = useState<number>(10);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<'platform' | 'merchant'>('platform');
  const [submittingSpeedGroup, setSubmittingSpeedGroup] = useState(false);

  const isSubscribedAndVerified = Boolean(
    currentUser?.merchantSubscriptionStatus === 'active' && currentUser?.verified
  );

  async function handleSubscriptionSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = subPaymentCode.trim().toUpperCase();
    if (!code) {
      onNotify('error', 'Please enter your M-Pesa transaction code.');
      return;
    }
    if (!/^[A-Z0-9]{8,12}$/i.test(code)) {
      onNotify('error', 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters.');
      return;
    }

    setSubmittingSubscription(true);
    try {
      const res = await api.subscribeMerchant({
        plan: subPlan,
        paymentCode: code,
        tillNumber: subTillNumber || undefined,
        paybillNumber: subPaybillNumber || undefined,
      });
      onNotify('success', res.message);
      setIsSubscriptionModalOpen(false);
      setSubPaymentCode('');
      loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit merchant subscription');
    } finally {
      setSubmittingSubscription(false);
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

  useEffect(() => {
    loadVendorData();
  }, [currentUser]);

  async function loadVendorData() {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [prodRes, grpRes] = await Promise.all([
        api.getProducts({ vendorId: currentUser.id }),
        api.getGroups(),
      ]);
      setProducts(prodRes.products);
      setGroups(grpRes.groups);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load merchant data');
    } finally {
      setLoading(false);
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
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {currentUser?.shopName || currentUser?.name} Dashboard
            </h1>
            {currentUser?.verified ? (
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Verified Merchant</span>
              </span>
            ) : (
              <span className="text-xs bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                {currentUser?.merchantSubscriptionStatus === 'pending_verification' ? 'Pending Admin Approval' : 'Subscription Inactive'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Manage your catalog, edit pricing and speed configurations, and track Chama orders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isSubscribedAndVerified && (
            <button
              onClick={() => setIsSubscriptionModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
            >
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span>{currentUser?.merchantSubscriptionStatus === 'pending_verification' ? 'View Subscription Status' : 'Subscribe & Activate Store'}</span>
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

      {/* PROMPT 4: ONBOARDING BANNER IF NOT SUBSCRIBED */}
      {!isSubscribedAndVerified && (
        <div className="mb-8 p-6 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-teal-500/10 border-2 border-emerald-600/30 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 bg-[#0E5A3C] text-white text-[10px] font-black uppercase rounded-full">
                Step 1 of 3: Merchant Onboarding
              </span>
              <span className="text-xs font-bold text-amber-800">
                {currentUser?.merchantSubscriptionStatus === 'pending_verification' ? 'Payment submitted · Awaiting Admin verification' : 'Activation Required'}
              </span>
            </div>
            <h3 className="text-base font-extrabold text-slate-900">
              {currentUser?.merchantSubscriptionStatus === 'pending_verification'
                ? 'Your Subscription Payment is Awaiting Admin Verification'
                : 'Subscribe to Buyoll Direct to Start Listing Products & Opening Speed Groups'}
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              Verified merchants can list unlimited products, configure 1-10 member speed groups, collect payments directly to their Till (Option A) or via Buyoll Escrow (Option B), and receive 5-star verified merchant badges.
            </p>
          </div>
          <button
            onClick={() => setIsSubscriptionModalOpen(true)}
            className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs shrink-0 flex items-center gap-2"
          >
            <span>{currentUser?.merchantSubscriptionStatus === 'pending_verification' ? 'Check Payment Status' : 'Choose Plan & Subscribe'}</span>
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

      {/* PROMPT 4: MERCHANT ONBOARDING & SUBSCRIPTION 3-STEP MODAL */}
      {isSubscriptionModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsSubscriptionModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Stepper Header */}
            <div className="pb-4 border-b border-slate-100 mb-5">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#0E5A3C] block">
                Buyoll Direct Merchant Onboarding · 3-Step Flow
              </span>
              <h3 className="text-base font-extrabold text-slate-900">
                {subStep === 1
                  ? 'Step 1: Choose Your Merchant Subscription Plan'
                  : subStep === 2
                  ? 'Step 2: Payment Instructions & Store Till'
                  : 'Step 3: Submit M-Pesa Code for Verification'}
              </h3>
            </div>

            {/* Step 1: Choose Plan */}
            {subStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-2.5">
                  {[
                    { id: 'starter', name: 'Starter Merchant', price: 1500, desc: 'Up to 5 listings · Standard Chama speeds · Platform Till Option B' },
                    { id: 'pro', name: 'Pro Merchant (Recommended)', price: 3500, desc: 'Up to 20 listings · 1-10 full speed spectrum · Verified store badge · Own Till Option A' },
                    { id: 'enterprise', name: 'Enterprise Store', price: 7000, desc: 'Unlimited listings · Dedicated Account Manager · Top hero placement' },
                  ].map((plan) => (
                    <div
                      key={plan.id}
                      onClick={() => setSubPlan(plan.id as any)}
                      className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                        subPlan === plan.id
                          ? 'border-[#0E5A3C] bg-emerald-50/50 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900 text-xs">{plan.name}</span>
                        <b className="text-[#0E5A3C] font-mono text-sm">KSh {plan.price.toLocaleString()} / mo</b>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-normal">{plan.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsSubscriptionModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setSubStep(2)}
                    className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <span>Proceed to Step 2</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Payment Till Instructions & Store Details */}
            {subStep === 2 && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1.5 text-emerald-950">
                  <div className="font-bold text-sm">Pay Subscription Fee via M-Pesa:</div>
                  <div className="font-mono text-xs">Amount: <b>KSh {subPlan === 'enterprise' ? '7,000' : subPlan === 'pro' ? '3,500' : '1,500'}</b></div>
                  <div className="font-mono text-xs">Buy Goods Till: <b>196853</b> (Buyoll Platform)</div>
                  <div className="font-mono text-xs">Or Paybill: <b>522533</b> · Account: <b>code4363</b></div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Your Store M-Pesa Till Number (Optional for Option A):
                    </label>
                    <input
                      type="text"
                      value={subTillNumber}
                      onChange={(e) => setSubTillNumber(e.target.value)}
                      placeholder="e.g. 3463533 (for direct member payments)"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Your Store Paybill Number (Optional):
                    </label>
                    <input
                      type="text"
                      value={subPaybillNumber}
                      onChange={(e) => setSubPaybillNumber(e.target.value)}
                      placeholder="e.g. 26253326"
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                    />
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setSubStep(1)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Back to Step 1
                  </button>
                  <button
                    onClick={() => setSubStep(3)}
                    className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <span>Proceed to Step 3</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Enter M-Pesa Code */}
            {subStep === 3 && (
              <form onSubmit={handleSubscriptionSubmit} className="space-y-4">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Plan:</span>
                    <b className="text-slate-900 uppercase">{subPlan}</b>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subscription Amount:</span>
                    <b className="text-[#0E5A3C] font-mono">
                      KSh {subPlan === 'enterprise' ? '7,000' : subPlan === 'pro' ? '3,500' : '1,500'}
                    </b>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Enter M-Pesa Transaction Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={12}
                    value={subPaymentCode}
                    onChange={(e) => setSubPaymentCode(e.target.value.toUpperCase())}
                    placeholder="e.g. QJL890KN12"
                    className="w-full px-3 py-2 text-xs font-mono tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] uppercase"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Once submitted, our Admin team verifies the Till statement and activates your store with a 5-star verified badge!
                  </p>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setSubStep(2)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Back to Step 2
                  </button>
                  <button
                    type="submit"
                    disabled={submittingSubscription}
                    className="px-5 py-2.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                  >
                    {submittingSubscription ? 'Submitting...' : 'Submit Code for Activation'}
                  </button>
                </div>
              </form>
            )}
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
