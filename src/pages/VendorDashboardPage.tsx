import React, { useState, useEffect } from 'react';
import { User, Product, ChamaGroup, MerchantSubscriptionTier, BillingPeriod, PaymentReceivingMode, PaymentReceivingDetails, WalletDepositRequest } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { useUser } from '../context/UserContext.tsx';
import { VendorProductEditorModal } from './VendorProductEditorModal.tsx';
import { FeaturedRequestModal } from '../components/FeaturedRequestModal.tsx';
import { MerchantFeaturedSection } from '../components/MerchantFeaturedSection.tsx';
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
  const { refreshUser } = useUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [featuredModalProduct, setFeaturedModalProduct] = useState<Product | null>(null);
  const [isFeaturedModalOpen, setIsFeaturedModalOpen] = useState(false);
  const [featuredRefreshTick, setFeaturedRefreshTick] = useState(0);

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
  const [subBillingPeriod, setSubBillingPeriod] = useState<BillingPeriod>('monthly');
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

  // 10-Speed Group Creation modal (1-10 members, payment duration, payment receiving reuse)
  const [isSpeedGroupModalOpen, setIsSpeedGroupModalOpen] = useState(false);
  const [selectedProductForGroup, setSelectedProductForGroup] = useState<Product | null>(null);
  const [selectedSpeedSize, setSelectedSpeedSize] = useState<number>(10);
  const [selectedDurationDays, setSelectedDurationDays] = useState<number>(90);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<'platform' | 'merchant'>('merchant');
  const [grpPayMode, setGrpPayMode] = useState<PaymentReceivingMode>('paybill');
  const [grpPaybillNumber, setGrpPaybillNumber] = useState('');
  const [grpPaybillAccount, setGrpPaybillAccount] = useState('');
  const [grpTillNumber, setGrpTillNumber] = useState('');
  const [grpPochiNumber, setGrpPochiNumber] = useState('');
  const [grpBankName, setGrpBankName] = useState('');
  const [grpBankPaybill, setGrpBankPaybill] = useState('');
  const [grpBankAccount, setGrpBankAccount] = useState('');
  const [grpAccountName, setGrpAccountName] = useState('');
  const [submittingSpeedGroup, setSubmittingSpeedGroup] = useState(false);
  const [publishingProductId, setPublishingProductId] = useState<number | null>(null);
  const [productStatusFilter, setProductStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [switchingInterval, setSwitchingInterval] = useState(false);
  const [isCancelAutoRenewModalOpen, setIsCancelAutoRenewModalOpen] = useState(false);
  const [cancelingAutoRenew, setCancelingAutoRenew] = useState(false);
  const [subStatus, setSubStatus] = useState<{
    status: 'ACTIVE' | 'EXPIRED' | 'NONE';
    alarm_level: 'GREEN' | 'RED' | 'EXPIRED' | 'NONE';
    days_remaining: number;
    expiresAt: number | null;
    expiresAtEatDate: string | null;
    currentEatDate: string;
    nextEatMidnightUtcMs: number;
    renewalMode: 'reset' | 'stack';
    warningMessage: string | null;
  } | null>(null);
  const [pendingNotices, setPendingNotices] = useState<any[]>([]);
  const [earlyRenewalConfirmOpen, setEarlyRenewalConfirmOpen] = useState(false);
  const [acknowledgingNoticeId, setAcknowledgingNoticeId] = useState<string | null>(null);
  const [walletDeposits, setWalletDeposits] = useState<Array<WalletDepositRequest & { paymentId?: number; paymentStatus?: string }>>([]);

  const fallbackTiers: MerchantSubscriptionTier[] = [
    { id: 'tier_250', name: 'Micro-Merchant', monthlyFee: 250, yearlyFee: 2500, yearlyDiscountPercent: 17, maxProducts: 2, maxGroupsPerProduct: 2, description: 'Caters to very small businesses and solo makers', features: [] },
    { id: 'tier_500', name: 'Growing Merchant', monthlyFee: 500, yearlyFee: 5000, yearlyDiscountPercent: 17, maxProducts: 10, maxGroupsPerProduct: 5, description: 'Ideal for growing neighborhood retailers', features: [] },
    { id: 'tier_1500', name: 'Pro Merchant', monthlyFee: 1500, yearlyFee: 15000, yearlyDiscountPercent: 17, maxProducts: 50, maxGroupsPerProduct: 10, description: 'For active retail businesses and popular shops', features: [] },
    { id: 'tier_3500', name: 'Commercial', monthlyFee: 3500, yearlyFee: 35000, yearlyDiscountPercent: 17, maxProducts: 100, maxGroupsPerProduct: 30, description: 'High capacity volume sales for established stores', features: [] },
    { id: 'tier_7500', name: 'Enterprise Scale', monthlyFee: 7500, yearlyFee: 75000, yearlyDiscountPercent: 17, maxProducts: -1, maxGroupsPerProduct: 50, description: 'Unlimited catalog for major retail distributors', features: [] },
    { id: 'enterprise', name: 'Custom Enterprise', monthlyFee: 15000, yearlyFee: 150000, yearlyDiscountPercent: 17, maxProducts: -1, maxGroupsPerProduct: 100, description: 'Custom SLA and limits set by Buyoll Admin', features: [] },
  ];
  const displayTiers = tiersList.length > 0 ? tiersList : fallbackTiers;

  const now = Date.now();
  const subExpiresAt = subscriptionInfo?.subscription?.expiresAt || currentUser?.merchantSubscriptionExpiresAt;
  const isSubscriptionExpired = subExpiresAt ? subExpiresAt <= now : Boolean(subscriptionInfo?.isExpired);
  const isSubscribedAndVerified = Boolean(
    (currentUser?.merchantSubscriptionStatus === 'active' || subscriptionInfo?.subscription?.status === 'active' || subscriptionInfo?.hasSubscription) &&
    !isSubscriptionExpired
  );

  async function handleSubscriptionPay(forceResetConfirmed = false) {
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

    // Early renewal forfeit confirmation when SUBSCRIPTION_RENEWAL_MODE=reset
    if (
      !forceResetConfirmed &&
      subStatus?.status === 'ACTIVE' &&
      subStatus?.renewalMode === 'reset' &&
      subStatus?.days_remaining > 0
    ) {
      setEarlyRenewalConfirmOpen(true);
      return;
    }

    setSubmittingSubscription(true);

    try {
      const plan = displayTiers.find((t) => t.id === selectedTierId) || displayTiers[1];
      const expectedFee = subBillingPeriod === 'yearly'
        ? (plan.yearlyFee ?? Math.round(plan.monthlyFee * 10))
        : plan.monthlyFee;
      const normalizedMethod =
        subPaymentMethod === 'wallet_credit' ? 'wallet' : subPaymentMethod === 'wallet_coins' ? 'coins' : 'mpesa';

      const res = await api.submitSubscriptionRequest({
        planId: selectedTierId,
        paymentMethod: normalizedMethod,
        mpesaCode: normalizedMethod === 'mpesa' ? subPaymentCode.trim().toUpperCase() : undefined,
        billingPeriod: subBillingPeriod,
      });

      // Successful submission -> Render Success View
      setSubModalSuccess({
        planName: `${plan.name} (${subBillingPeriod === 'yearly' ? 'Yearly · 365 Days' : '30-Day'})`,
        amount: res.request?.amountExpected || expectedFee,
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
      await Promise.all([loadVendorData(), refreshUser()]);
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

  async function handleSwitchBillingInterval(nextPeriod: BillingPeriod) {
    setSwitchingInterval(true);
    try {
      const res = await api.changeSubscriptionInterval(nextPeriod);
      onNotify('success', res.message || `Updated billing interval to ${nextPeriod}.`);
      await loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update billing interval');
    } finally {
      setSwitchingInterval(false);
    }
  }

  async function handleConfirmCancelAutoRenew() {
    setCancelingAutoRenew(true);
    try {
      const res = await api.cancelMerchantSubscription();
      onNotify('info', res.message || 'Auto-renewal cancelled.');
      setIsCancelAutoRenewModalOpen(false);
      await loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to cancel auto-renewal');
    } finally {
      setCancelingAutoRenew(false);
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

  function openGroupCreatorForProduct(product: Product) {
    if (!isSubscribedAndVerified && currentUser?.role === 'merchant') {
      onNotify('error', 'Active merchant subscription required to create groups.');
      setIsSubscriptionModalOpen(true);
      return;
    }
    const existingCount = groups.filter(g => g.productId === product.id).length;
    const maxPerProduct = subscriptionInfo?.tier?.maxGroupsPerProduct ?? 5;
    if (existingCount >= maxPerProduct) {
      onNotify('error', `Group limit reached (${existingCount} of ${maxPerProduct} allowed). Upgrade your plan to add more groups.`);
      setIsSubscriptionModalOpen(true);
      return;
    }
    const pr: PaymentReceivingDetails | undefined = product.paymentReceiving || currentUser?.paymentReceiving;
    setSelectedProductForGroup(product);
    setSelectedSpeedSize(10);
    setSelectedDurationDays(90);
    setSelectedPaymentMode('merchant');
    setGrpPayMode(pr?.mode || (currentUser?.tillNumber ? 'till' : 'paybill'));
    setGrpPaybillNumber(pr?.paybillNumber || '');
    setGrpPaybillAccount(pr?.paybillAccount || '');
    setGrpTillNumber(pr?.tillNumber || currentUser?.tillNumber || '');
    setGrpPochiNumber(pr?.pochiNumber || currentUser?.phone || '');
    setGrpBankName(pr?.bankName || '');
    setGrpBankPaybill(pr?.bankPaybillNumber || '');
    setGrpBankAccount(pr?.bankAccountNumber || '');
    setGrpAccountName(pr?.accountName || currentUser?.shopName || currentUser?.name || '');
    setIsSpeedGroupModalOpen(true);
  }

  async function handlePublishProduct(product: Product) {
    if (!isSubscribedAndVerified && currentUser?.role === 'merchant') {
      onNotify('error', 'Active merchant subscription required to post products live.');
      setIsSubscriptionModalOpen(true);
      return;
    }
    const productGroups = groups.filter(g => g.productId === product.id);
    if (productGroups.length === 0) {
      onNotify('error', 'Create at least 1 group inside this product before posting.');
      openGroupCreatorForProduct(product);
      return;
    }
    setPublishingProductId(product.id);
    try {
      const res = await api.publishProduct(product.id);
      onNotify('success', res.message || `"${product.title}" is now posted live in Announcements!`);
      await loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to post product live');
    } finally {
      setPublishingProductId(null);
    }
  }

  async function handleCreateSpeedGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductForGroup) return;

    if (!isSubscribedAndVerified && currentUser?.role === 'merchant') {
      onNotify('error', 'Active merchant subscription required to launch speed groups.');
      setIsSubscriptionModalOpen(true);
      return;
    }

    const paymentReceiving: PaymentReceivingDetails = {
      mode: grpPayMode,
      accountName: grpAccountName.trim() || undefined,
      ...(grpPayMode === 'paybill' ? { paybillNumber: grpPaybillNumber.trim(), paybillAccount: grpPaybillAccount.trim() } : {}),
      ...(grpPayMode === 'till' ? { tillNumber: grpTillNumber.trim() } : {}),
      ...(grpPayMode === 'pochi' ? { pochiNumber: grpPochiNumber.trim() } : {}),
      ...(grpPayMode === 'bank_paybill' ? {
        bankName: grpBankName.trim(),
        bankPaybillNumber: grpBankPaybill.trim(),
        bankAccountNumber: grpBankAccount.trim(),
      } : {}),
    };

    setSubmittingSpeedGroup(true);
    try {
      const res = await api.createGroup({
        productId: selectedProductForGroup.id,
        size: selectedSpeedSize,
        paymentMode: selectedPaymentMode,
        paymentDurationDays: selectedSpeedSize === 1 ? selectedDurationDays : undefined,
        paymentReceiving,
      });
      onNotify('success', `Created ${selectedSpeedSize}-Member Group inside "${selectedProductForGroup.title}"!`);
      triggerVisualPushAlert({
        title: '🎉 New Group Created!',
        body: `${(currentUser as any)?.businessName || currentUser?.name || 'A merchant'} added a ${selectedSpeedSize}-member group for "${selectedProductForGroup.title}".`,
        url: `/chama/${res.group.id}`,
        tag: `new-group-${res.group.id}`,
      });
      setIsSpeedGroupModalOpen(false);
      await loadVendorData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to create speed group');
      if (err?.code === 'GROUP_LIMIT_REACHED') {
        setIsSpeedGroupModalOpen(false);
        setIsSubscriptionModalOpen(true);
      }
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

  useEffect(() => {
    if (!currentUserId || typeof window === 'undefined') return;
    const handleLiveVendorEvent = () => {
      void loadVendorData();
      void refreshUser();
      setFeaturedRefreshTick((t) => t + 1);
    };
    window.addEventListener('buyoll:subscription-activated', handleLiveVendorEvent);
    window.addEventListener('buyoll:subscription-updated', handleLiveVendorEvent);
    window.addEventListener('buyoll:subscription-expired', handleLiveVendorEvent);
    window.addEventListener('buyoll:wallet-updated', handleLiveVendorEvent);
    window.addEventListener('buyoll:deposit-updated', handleLiveVendorEvent);
    window.addEventListener('buyoll:verification-updated', handleLiveVendorEvent);
    window.addEventListener('buyoll:featured-updated', handleLiveVendorEvent);
    window.addEventListener('buyoll:outbox-notification', handleLiveVendorEvent);
    return () => {
      window.removeEventListener('buyoll:subscription-activated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:subscription-updated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:subscription-expired', handleLiveVendorEvent);
      window.removeEventListener('buyoll:wallet-updated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:deposit-updated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:verification-updated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:featured-updated', handleLiveVendorEvent);
      window.removeEventListener('buyoll:outbox-notification', handleLiveVendorEvent);
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!subStatus?.nextEatMidnightUtcMs || typeof window === 'undefined') return;
    const delayMs = Math.max(5000, subStatus.nextEatMidnightUtcMs - Date.now() + 1500);
    const cappedDelay = Math.min(delayMs, 24 * 60 * 60 * 1000);
    const timer = window.setTimeout(() => {
      loadVendorData();
    }, cappedDelay);
    return () => window.clearTimeout(timer);
  }, [subStatus?.nextEatMidnightUtcMs]);

  async function handleAcknowledgeNotice(noticeId: string) {
    setAcknowledgingNoticeId(noticeId);
    try {
      await api.markMerchantNoticeSeen(noticeId);
      setPendingNotices((prev) => prev.filter((n) => n.id !== noticeId));
    } catch (err: any) {
      onNotify('error', err.message || 'Could not dismiss notice.');
    } finally {
      setAcknowledgingNoticeId(null);
    }
  }

  async function loadVendorData(isInitial = false) {
    if (!currentUser) return;
    if (isInitial || !hasLoaded) {
      setLoading(true);
    }
    try {
      const [prodRes, grpRes, subRes, tiersRes, verifRes, myReqRes, subStatusRes, noticesRes, depositsRes] = await Promise.all([
        api.getProducts({ vendorId: currentUser.id, includeDrafts: true }),
        api.getGroups(),
        api.getMerchantSubscriptionCurrent().catch(() => null),
        api.getSubscriptionTiers().catch(() => ({ tiers: [] })),
        api.getMerchantVerificationStatus().catch(() => null),
        api.getMySubscriptionRequest().catch(() => null),
        api.getMerchantSubscriptionStatus().catch(() => null),
        api.getPendingMerchantNotices().catch(() => ({ notices: [] })),
        api.getMyWalletDeposits().catch(() => ({ deposits: [] })),
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
      if (subStatusRes) setSubStatus(subStatusRes);
      if (noticesRes?.notices) setPendingNotices(noticesRes.notices);
      if (depositsRes?.deposits) setWalletDeposits(depositsRes.deposits);
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
      if (subscriptionInfo?.pendingSubscription) {
        onNotify('info', 'Your 30-day merchant plan request is currently awaiting Admin approval. You will be able to post products as soon as it is approved.');
        return;
      }
      if (isSubscriptionExpired) {
        onNotify('info', 'Your 30-day merchant selling window has expired. Please choose a 30-Day Merchant Plan to continue.');
      } else {
        onNotify('info', 'Active 30-day merchant subscription required to post products. Please choose a plan.');
      }
      setIsSubscriptionModalOpen(true);
      return;
    }
    setEditingProduct(null);
    setIsEditorOpen(true);
  }

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-[#ff6600] dark:text-[#ff8000] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Store className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Merchant Portal</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          Sign in or register your merchant store to post genuine verified items, manage Group rotation orders, and activate 10-day speed groups.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-6 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-sm transition-all"
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
            Manage your catalog, edit pricing and speed configurations, and track Group orders.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigate('wallet', { action: 'deposit', returnTo: 'vendor-dashboard' })}
            data-testid="merchant-deposit-wallet-btn"
            title="View Merchant Operating Wallet and submit an M-Pesa deposit"
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-300 hover:border-[#ff6600] text-slate-900 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-[#ff6600]" />
            <span className="tabular-nums">
              Wallet: KSh {(currentUser?.roleWallets?.merchant?.credit ?? currentUser?.credit ?? 0).toLocaleString()}
            </span>
            <span className="text-[#ff6600] font-extrabold">+ Deposit</span>
          </button>

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
            <span>Post New Product</span>
          </button>
        </div>
      </div>

      {/* ONE-TIME THANK-YOU SUBSCRIPTION ACTIVATION NOTICE */}
      {pendingNotices.length > 0 && (
        <div className="mb-6 space-y-3">
          {pendingNotices.map((notice) => (
            <div
              key={notice.id}
              role="status"
              className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-emerald-950">{notice.title || 'Subscription Activated!'}</h3>
                  <p className="text-xs text-emerald-900 mt-0.5 leading-relaxed">{notice.message}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={acknowledgingNoticeId === notice.id}
                onClick={() => handleAcknowledgeNotice(notice.id)}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shrink-0 cursor-pointer disabled:opacity-50"
              >
                {acknowledgingNoticeId === notice.id ? 'Dismissing...' : 'Got It'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* EAT SUBSCRIPTION COUNTDOWN & ALARM INDICATOR */}
      {subStatus && subStatus.status === 'ACTIVE' && (
        <div
          className={`mb-6 p-4 rounded-2xl border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
            subStatus.alarm_level === 'RED'
              ? 'bg-red-50/90 border-red-400 text-red-950'
              : 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
          }`}
        >
          <div className="flex items-center gap-3">
            {subStatus.alarm_level === 'RED' ? (
              <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 buyoll-alarm-red-badge">
                <AlertTriangle className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-emerald-100 border border-emerald-300 flex items-center justify-center shrink-0">
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 buyoll-alarm-green-dot" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                    subStatus.alarm_level === 'RED'
                      ? 'bg-red-600 text-white'
                      : 'bg-emerald-700 text-white'
                  }`}
                >
                  {subStatus.alarm_level === 'RED' ? 'Urgent Renewal Alarm' : 'Subscription Healthy'}
                </span>
                <span className="text-xs font-extrabold">
                  {subStatus.days_remaining} day{subStatus.days_remaining === 1 ? '' : 's'} remaining (EAT)
                </span>
                {subStatus.expiresAtEatDate && (
                  <span className="text-[11px] opacity-80">· Ends {subStatus.expiresAtEatDate}</span>
                )}
              </div>
              <p className="text-xs mt-1 font-medium">
                {subStatus.alarm_level === 'RED'
                  ? subStatus.warningMessage || 'Your subscription is running out. Top up / renew now to keep your listings live.'
                  : 'Your store listings and groups are live and visible to members.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsSubscriptionModalOpen(true)}
            className={`px-4 py-2 text-xs font-bold rounded-xl shrink-0 cursor-pointer transition-colors ${
              subStatus.alarm_level === 'RED'
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
                : 'bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300'
            }`}
          >
            {subStatus.alarm_level === 'RED' ? 'Renew Now' : 'Renew / Upgrade'}
          </button>
        </div>
      )}

      {/* ACTIVE SUBSCRIPTION MANAGEMENT BAR (Interval Switch & Auto-Renew) */}
      {subscriptionInfo?.subscription && !subscriptionInfo.isExpired && (
        <div className="mb-6 p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 bg-emerald-700 text-white text-[10px] font-black uppercase rounded-full">
                {subscriptionInfo.subscription.billingInterval === 'YEARLY' || subscriptionInfo.subscription.billingPeriod === 'yearly'
                  ? 'Yearly Plan (365d)'
                  : 'Monthly Plan (30d)'}
              </span>
              <span className="text-xs font-bold text-emerald-950">
                {subscriptionInfo.tier?.name || subscriptionInfo.subscription.tierName}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                subscriptionInfo.subscription.autoRenew === false
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-white text-emerald-700 border border-emerald-200'
              }`}>
                {subscriptionInfo.subscription.autoRenew === false ? 'Auto-Renew Off' : 'Auto-Renew Active'}
              </span>
            </div>
            <p className="text-xs text-emerald-900 mt-1">
              {subscriptionInfo.subscription.autoRenew === false
                ? `Active until ${new Date(subscriptionInfo.subscription.expiresAt).toLocaleDateString()} (will not auto-renew).`
                : `Next renewal: ${new Date(subscriptionInfo.subscription.expiresAt).toLocaleDateString()}.`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {subscriptionInfo.subscription.billingPeriod === 'yearly' || subscriptionInfo.subscription.billingInterval === 'YEARLY' ? (
              <button
                type="button"
                disabled={switchingInterval}
                onClick={() => handleSwitchBillingInterval('monthly')}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {switchingInterval ? 'Updating...' : 'Switch Next Renewal to 30-Day'}
              </button>
            ) : (
              <button
                type="button"
                disabled={switchingInterval}
                onClick={() => handleSwitchBillingInterval('yearly')}
                className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {switchingInterval ? 'Updating...' : 'Switch to Yearly (Save 17%)'}
              </button>
            )}
            {subscriptionInfo.subscription.autoRenew !== false && (
              <button
                type="button"
                onClick={() => setIsCancelAutoRenewModalOpen(true)}
                className="px-3 py-1.5 bg-white hover:bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Cancel Auto-Renew
              </button>
            )}
          </div>
        </div>
      )}

      {/* PENDING MERCHANT WALLET DEPOSITS BANNER */}
      {(() => {
        const pendingDeposits = walletDeposits.filter((d) => d.status === 'pending');
        if (pendingDeposits.length === 0) return null;
        const latestDep = pendingDeposits[0];
        const totalPendingKes = pendingDeposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
        return (
          <div
            data-testid="merchant-pending-deposit-banner"
            className="mb-6 p-4 bg-emerald-50/90 border-2 border-emerald-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                  Merchant Wallet Deposit Queued for Admin Approval ({pendingDeposits.length})
                </h4>
                <p className="text-xs text-emerald-900 mt-0.5">
                  Latest submission: <b className="font-mono">{latestDep.mpesaCode}</b> for{' '}
                  <b>KSh {Number(latestDep.amount).toLocaleString()}</b>
                  {latestDep.paymentId ? ` (Admin Queue #${latestDep.paymentId})` : ''}.{' '}
                  {pendingDeposits.length > 1 ? `Total pending: KSh ${totalPendingKes.toLocaleString()}. ` : ''}
                  Once verified by Admin, your Merchant Operating Wallet will be credited automatically.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              <span className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full text-[11px] font-bold uppercase tracking-wider">
                Sent to Admin Queue
              </span>
              <button
                type="button"
                onClick={() => onNavigate('wallet', { action: 'deposit', returnTo: 'vendor-dashboard' })}
                className="px-3 py-1.5 bg-white hover:bg-emerald-100/60 border border-emerald-300 text-emerald-900 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                View Wallet
              </button>
            </div>
          </div>
        );
      })()}

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
                Your request for <b>{subscriptionInfo.pendingSubscription.tierName}</b> ({subscriptionInfo.pendingSubscription.paymentCode || (subscriptionInfo.pendingSubscription.paymentMethod === 'wallet_credit' ? 'Wallet Credit' : 'Wallet Coins')}) is awaiting Admin verification against M-Pesa statements. Once approved, your catalog limits will activate for {subscriptionInfo.pendingSubscription.billingPeriod === 'yearly' ? '365 days' : '30 days'}!
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
              <span className="px-2 py-0.5 bg-[#ff6600] text-white text-[10px] font-black uppercase rounded-full">
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
            className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-colors shadow-xs shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <span>Upgrade / Choose Plan</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}


      {/* KPI Stats Strip with Plan Catalog Limits */}
      {(() => {
        const maxProds = subscriptionInfo?.tier?.maxProducts ?? 10;
        const maxGrpsPerProd = subscriptionInfo?.tier?.maxGroupsPerProduct ?? 5;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Products Listed</span>
                <Package className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {products.length} <span className="text-xs font-semibold text-slate-400">/ {maxProds >= 999 ? '∞' : maxProds}</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {products.length} of {maxProds >= 999 ? 'Unlimited' : maxProds} allowed by plan
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Active Groups</span>
                <Users className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {myGroups.length}
              </div>
              <div className="text-[11px] text-emerald-700 font-semibold mt-1">
                Max {maxGrpsPerProd >= 999 ? '∞' : maxGrpsPerProd} groups per product
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Members Enrolled</span>
                <Users className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {totalMembersEnrolled}
              </div>
              <div className="text-[11px] text-indigo-700 font-semibold mt-1">
                Across {myGroups.length} active group{myGroups.length !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Total Value In Escrow</span>
                <TrendingUp className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-[#ff6600] tabular-nums">
                KSh {totalRevenue.toLocaleString()}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Released as slots mature</div>
            </div>
          </div>
        );
      })()}

      {/* FEATURED DEAL HERO SHOWCASE PROMOTION */}
      <div className="bg-gradient-to-r from-emerald-900 to-[#ff6600] rounded-2xl p-6 text-white mb-8 shadow-sm border border-emerald-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 bg-amber-400 text-slate-900 rounded-md">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
              Paid Featured Showcase Placements
            </span>
            <span className="px-2 py-0.5 bg-white/20 text-white text-[10px] font-bold rounded-full">
              1–7 Days & 30 Days · Merchant Wallet
            </span>
          </div>
          <h3 className="text-base font-bold text-white">
            Promote Your Published Products on the Homepage Hero
          </h3>
          <p className="text-xs text-emerald-100/90 mt-1 max-w-2xl">
            Pay directly from your existing Buyoll Merchant Wallet for 1–7 or 30-day Featured placements (tier limits & discounts apply). Requests go to Admin moderation with 100% automatic wallet refund if rejected.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFeaturedModalProduct(null);
            setIsFeaturedModalOpen(true);
          }}
          className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-sm shrink-0 flex items-center gap-1.5 cursor-pointer"
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Request Featured Slot</span>
        </button>
      </div>

      {/* Product Listings Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs mb-8">
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Your Product Listings</h2>
            <span className="text-xs text-slate-500">{products.length} total items</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl self-start sm:self-auto">
            {([
              { id: 'all', label: `All (${products.length})` },
              { id: 'published', label: `Published (${products.filter((p) => p.publicationStatus !== 'draft' && p.live !== false).length})` },
              { id: 'draft', label: `Drafts (${products.filter((p) => p.publicationStatus === 'draft' || p.live === false).length})` },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setProductStatusFilter(tab.id)}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  productStatusFilter === tab.id ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading your listings...</div>
        ) : products.length === 0 ? (
          <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 mb-1">No products listed yet</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
              Add your first genuine product listing with customized Group speeds and start selling.
            </p>

            {!isSubscribedAndVerified ? (
              <div className="mb-4 max-w-md mx-auto p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-left">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="w-4 h-4 text-[#ff6600]" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-950">
                    Buyoll Merchant 30-Day Subscriptions
                  </span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed mb-3">
                  No posting products without subscription. Choose your 30-day merchant plan to activate your selling window and start listing products.
                </p>
                <button
                  type="button"
                  onClick={() => setIsSubscriptionModalOpen(true)}
                  className="w-full py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs text-center"
                >
                  Choose Your 30-Day Merchant Plan
                </button>
              </div>
            ) : (
              <button
                onClick={handleOpenCreateProduct}
                className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs"
              >
                Post First Product
              </button>
            )}
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
                {products
                  .filter((p) => {
                    const isDraftItem = p.publicationStatus === 'draft' || p.live === false;
                    if (productStatusFilter === 'draft') return isDraftItem;
                    if (productStatusFilter === 'published') return !isDraftItem;
                    return true;
                  })
                  .map((p) => {
                  const itemGroups = myGroups.filter(g => g.productId === p.id);
                  const members = itemGroups.reduce((a, g) => a + g.occupiedCount, 0);
                  const isDraft = p.publicationStatus === 'draft' || p.live === false;
                  const maxPerProd = subscriptionInfo?.tier?.maxGroupsPerProduct ?? 5;

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
                              {members} members in {itemGroups.length} / {maxPerProd >= 999 ? '∞' : maxPerProd} groups
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
                        {isDraft ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-full text-[10px]">
                            Draft · Add Groups & Post
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-full text-[10px]">
                            Posted Live
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isDraft ? (
                            <>
                              <button
                                onClick={() => openGroupCreatorForProduct(p)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                                title="Create 1–10 member group inside this product"
                              >
                                <Users className="w-3.5 h-3.5" />
                                <span>Create Group</span>
                              </button>
                              <button
                                onClick={() => handlePublishProduct(p)}
                                disabled={publishingProductId === p.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-colors cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{publishingProductId === p.id ? 'Posting...' : 'Post'}</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setFeaturedModalProduct(p);
                                  setIsFeaturedModalOpen(true);
                                }}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold rounded-lg text-xs transition-colors cursor-pointer"
                                title="Request paid Featured hero placement"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-[#ff6600]" />
                                <span>{p.isFeatured ? 'Featured Active' : 'Feature'}</span>
                              </button>
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                                Groups Read-Only
                              </span>
                            </>
                          )}
                          <button
                            onClick={() => onNavigate('product', p.id)}
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
                            title="View Product Page"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingProduct(p);
                              setIsEditorOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white font-semibold rounded-lg text-xs cursor-pointer"
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

      {/* My Groups (Merchant Catalog) - Product Staging & Read-Only Posted Groups */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                My Groups (Merchant)
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full uppercase">
                Read-Only Oversight Once Posted
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Create 1 to 10-member groups inside your draft products (within your plan limit), then click <b>Post</b>. Once posted, groups are strictly read-only.
            </p>
          </div>
          <span className="text-xs text-slate-600 font-semibold bg-slate-100 px-3 py-1.5 rounded-xl shrink-0 self-start sm:self-auto">
            {myGroups.length} Active Group{myGroups.length !== 1 ? 's' : ''}
          </span>
        </div>

        {products.length === 0 && myGroups.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200">
            <Users className="w-8 h-8 text-[#ff6600] mx-auto mb-2" />
            <h4 className="text-xs font-bold text-slate-800">No Groups Created Yet</h4>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1 mb-3">
              Post a new product first, then create 1 to 10-member groups inside it before publishing to Announcements.
            </p>
            {!isSubscribedAndVerified ? (
              <div className="mb-4 max-w-md mx-auto p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-left">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="w-4 h-4 text-[#ff6600]" />
                  <span className="text-xs font-black uppercase tracking-wider text-amber-950">
                    Buyoll Merchant 30-Day Subscriptions
                  </span>
                </div>
                <p className="text-[11px] text-amber-900 leading-relaxed mb-3">
                  No posting products without subscription. Choose your 30-day or yearly merchant plan to activate your selling window.
                </p>
                <button
                  type="button"
                  onClick={() => setIsSubscriptionModalOpen(true)}
                  className="w-full py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs text-center"
                >
                  Choose Your 30-Day Merchant Plan
                </button>
              </div>
            ) : (
              <button
                onClick={handleOpenCreateProduct}
                className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer"
              >
                Post New Product
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {products.map((prod) => {
              const prodGroups = myGroups.filter(g => g.productId === prod.id);
              const isDraft = prod.publicationStatus === 'draft' || prod.live === false;
              const maxPerProd = subscriptionInfo?.tier?.maxGroupsPerProduct ?? 5;
              const limitReached = prodGroups.length >= maxPerProd;

              return (
                <div key={prod.id} className={`rounded-2xl border p-4 sm:p-5 ${isDraft ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={resolveImageUrl(prod.images[0])}
                        alt={prod.title}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-extrabold text-sm text-slate-900 truncate">{prod.title}</h3>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                            isDraft ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {isDraft ? 'Draft · Not Posted Yet' : 'Posted Live (Read-Only)'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900">KSh {prod.price.toLocaleString()}</span>
                          <span>·</span>
                          <span className={`font-bold ${limitReached ? 'text-rose-700' : 'text-emerald-800'}`}>
                            {prodGroups.length} of {maxPerProd >= 999 ? '∞' : maxPerProd} groups used
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      {limitReached && (
                        <button
                          type="button"
                          onClick={() => setIsSubscriptionModalOpen(true)}
                          className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          Upgrade your plan
                        </button>
                      )}
                      {isDraft && (
                        <>
                          <button
                            type="button"
                            onClick={() => openGroupCreatorForProduct(prod)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Create Group</span>
                          </button>
                          <button
                            type="button"
                            disabled={publishingProductId === prod.id}
                            onClick={() => handlePublishProduct(prod)}
                            className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{publishingProductId === prod.id ? 'Posting...' : 'Post'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {prodGroups.length === 0 ? (
                    <div className="p-5 text-center bg-white rounded-xl border border-dashed border-amber-300 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800 mb-1">No groups added to this product yet.</p>
                      <p className="text-[11px] text-slate-500 mb-3">
                        Click <b>Create Group</b> above to set up your first 1–10 member group before clicking <b>Post</b>.
                      </p>
                      <button
                        type="button"
                        onClick={() => openGroupCreatorForProduct(prod)}
                        className="px-3.5 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer"
                      >
                        + Create First Group (1–10 Members)
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {prodGroups.map((g) => {
                        const capacity = g.size || 10;
                        const percent = Math.min(100, Math.round(((g.occupiedCount || 0) / capacity) * 100));

                        return (
                          <div
                            key={g.id}
                            onClick={() => onNavigate('group', g.id)}
                            className="p-4 rounded-xl border border-slate-200 hover:border-[#ff6600] hover:shadow-xs transition-all cursor-pointer bg-slate-50/70 hover:bg-white flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex justify-between items-start gap-2 mb-2">
                                <h4 className="font-bold text-slate-900 text-xs line-clamp-1">{g.name}</h4>
                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded shrink-0">
                                  {g.status}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 mb-2 flex items-center justify-between">
                                <span>Size: <b>{capacity} {capacity === 1 ? 'member (Solo)' : 'members'}</b></span>
                                <span><b>KSh {g.dailyAmount?.toLocaleString() || 0}/day</b></span>
                              </div>

                              <div className="text-[10px] text-slate-500 mb-3 flex items-center justify-between">
                                <span>Duration: <b>{g.paymentDurationDays || g.cycleDays || 10}d</b></span>
                                <span className="uppercase font-mono">{g.paymentReceiving?.mode || g.paymentMode}</span>
                              </div>

                              {/* Progress Bar */}
                              <div className="bg-slate-200 rounded-full h-1.5 w-full mb-1.5 overflow-hidden">
                                <div
                                  className="bg-[#ff6600] h-full rounded-full transition-all"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-slate-500 mb-3">
                                <span>{g.occupiedCount} of {capacity} members</span>
                                <span>{percent}% Filled</span>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                              <span className="text-[10.5px] font-semibold text-emerald-700">
                                {isDraft ? 'Staged (Pending Post)' : 'Read-Only View'}
                              </span>
                              <span className="text-xs font-bold text-slate-900 flex items-center gap-1 text-[11px]">
                                View Members & Payments <ArrowRight className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* My Featured Placements & Performance Analytics */}
      <MerchantFeaturedSection
        products={products}
        groups={myGroups}
        onRequestFeature={(prod) => {
          setFeaturedModalProduct(prod || null);
          setIsFeaturedModalOpen(true);
        }}
        onOpenSubscription={() => setIsSubscriptionModalOpen(true)}
        onNavigate={onNavigate}
        onNotify={onNotify}
        refreshTrigger={featuredRefreshTick}
      />

      {/* Editor Modal */}
      {isEditorOpen && (
        <VendorProductEditorModal
          product={editingProduct}
          currentUser={currentUser}
          onClose={() => setIsEditorOpen(false)}
          onSaved={() => {
            loadVendorData();
          }}
          onNotify={onNotify}
        />
      )}

      {/* Paid Featured Request Modal */}
      <FeaturedRequestModal
        isOpen={isFeaturedModalOpen}
        product={featuredModalProduct}
        products={products}
        groups={groups}
        onClose={() => setIsFeaturedModalOpen(false)}
        onSubmitted={() => {
          setFeaturedRefreshTick((t) => t + 1);
          void loadVendorData();
          void refreshUser();
        }}
        onOpenSubscription={() => setIsSubscriptionModalOpen(true)}
        onNotify={onNotify}
      />

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
                <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4 shadow-xs">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800 block mb-1">
                  Buyoll Merchant Plan
                </span>
                <h3 className="text-2xl font-black text-slate-900 mb-2">
                  {subModalSuccess.status === 'Active' ? 'Subscription Active!' : 'Request submitted!'}
                </h3>
                <p className="text-xs text-slate-600 max-w-md mx-auto mb-6">
                  {subModalSuccess.status === 'Active'
                    ? 'Your Merchant Wallet settled cleanly and your store is unlocked immediately to upload products and launch groups.'
                    : 'Your merchant plan request has been logged successfully and routed to Buyoll Admin for verification.'}
                </p>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left max-w-md mx-auto mb-6 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">Selected Plan:</span>
                    <span className="font-extrabold text-slate-900">{subModalSuccess.planName}</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">Payment Method:</span>
                    <span className="font-bold text-slate-800">{subModalSuccess.method}</span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">Amount:</span>
                    <span className="font-mono font-bold text-[#ff6600]">KSh {subModalSuccess.amount.toLocaleString()}</span>
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
                    {subModalSuccess.status === 'Active' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Active · Store Unlocked
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Pending admin approval
                      </span>
                    )}
                  </div>
                </div>

                {subModalSuccess.status === 'Active' ? (
                  <div className="p-3.5 bg-emerald-50/90 border border-emerald-200 rounded-xl text-xs text-emerald-900 max-w-md mx-auto mb-6 font-medium">
                    Your plan is live! You can now add products, configure groups, and pay for Featured placements directly.
                  </div>
                ) : (
                  <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 max-w-md mx-auto mb-6">
                    We'll notify you as soon as an admin verifies your M-Pesa code against Till / Paybill statements.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsSubscriptionModalOpen(false);
                    setSubModalSuccess(null);
                  }}
                  className="w-full max-w-md mx-auto py-3 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer block"
                >
                  {subModalSuccess.status === 'Active' ? 'Continue to My Store' : 'Done'}
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
                      <span className="font-mono font-bold text-[#ff6600] text-xs">
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
                <div className="pb-3 border-b border-slate-100 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#ff6600] block">
                      Buyoll Merchant Subscriptions
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900">
                      Choose Your {subBillingPeriod === 'yearly' ? 'Yearly (365-Day)' : '30-Day'} Merchant Plan
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Subscribe every 30 days or yearly (365 days) for your catalog tier limits.
                    </p>
                  </div>

                  <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200 shrink-0 self-start">
                    <button
                      type="button"
                      onClick={() => setSubBillingPeriod('monthly')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                        subBillingPeriod === 'monthly' ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      30-Day Plan
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubBillingPeriod('yearly')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                        subBillingPeriod === 'yearly' ? 'bg-white text-[#ff6600] shadow-xs' : 'text-slate-600'
                      }`}
                    >
                      Yearly (365d) <span className="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-black">Save {displayTiers[0]?.yearlyDiscountPercent ?? 17}%</span>
                    </button>
                  </div>
                </div>

                {/* 6 Tiers Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  {displayTiers.map((tier) => {
                    const annualBaseline = tier.monthlyFee * 12;
                    const yearlyFee = tier.yearlyFee ?? Math.round(tier.monthlyFee * 10);
                    const discountPct = tier.yearlyDiscountPercent ?? Math.round(((annualBaseline - yearlyFee) / annualBaseline) * 100);
                    const displayFee = subBillingPeriod === 'yearly' ? yearlyFee : tier.monthlyFee;
                    const prodsText = tier.maxProducts < 0 ? 'Unlimited Products' : `Up to ${tier.maxProducts} Products`;
                    const grpsText = `${tier.maxGroupsPerProduct} Groups / Product`;
                    return (
                    <div
                      key={tier.id}
                      onClick={() => {
                        setSelectedTierId(tier.id);
                        setSubModalError(null);
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                        selectedTierId === tier.id
                          ? 'border-[#ff6600] bg-emerald-50/60 shadow-xs ring-1 ring-[#ff6600]'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <span className="font-bold text-xs text-slate-900">{tier.name}</span>
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold text-[#ff6600]">
                            KSh {displayFee.toLocaleString()}
                            <span className="text-[10px] font-normal text-slate-500">{subBillingPeriod === 'yearly' ? '/yr' : '/30d'}</span>
                          </span>
                          {subBillingPeriod === 'yearly' && discountPct > 0 && (
                            <span className="block text-[9px] font-extrabold text-emerald-700">
                              Save {discountPct}% (vs KSh {annualBaseline.toLocaleString()})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-800 mb-1">
                        {prodsText} · {grpsText}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-tight">{tier.description}</p>
                    </div>
                  );})}
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
                          ? 'border-[#ff6600] bg-white ring-2 ring-[#ff6600]/20 shadow-xs'
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
                          ? 'border-[#ff6600] bg-white ring-2 ring-[#ff6600]/20 shadow-xs'
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
                          ? 'border-[#ff6600] bg-white ring-2 ring-[#ff6600]/20 shadow-xs'
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

                  {(() => {
                    const activePlan = displayTiers.find((t) => t.id === selectedTierId) || displayTiers[1];
                    const calcFee = subBillingPeriod === 'yearly'
                      ? (activePlan.yearlyFee ?? Math.round(activePlan.monthlyFee * 10))
                      : activePlan.monthlyFee;
                    const periodLabel = subBillingPeriod === 'yearly' ? '365-day yearly' : '30-day';
                    return (
                      <>
                        {subPaymentMethod === 'mpesa_till' && (
                          <div className="space-y-2 pt-2 border-t border-slate-200">
                            <div className="text-[11px] text-emerald-900 font-medium">
                              Pay KSh {calcFee.toLocaleString()} ({periodLabel}) to <b>Buy Goods Till 196853</b> (Buyoll Platform) or <b>Paybill 522533</b> (Acc: code4363).
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
                                className={`w-full px-3.5 py-2.5 text-xs font-mono border rounded-lg uppercase tracking-wider focus:ring-2 focus:ring-[#ff6600] outline-none ${
                                  subCodeTouched && subPaymentCode.length > 0 && !/^[A-Z0-9]{10}$/.test(subPaymentCode)
                                    ? 'border-rose-400 bg-rose-50/30'
                                    : 'border-slate-300 bg-white'
                                }`}
                              />
                              {subCodeTouched && subPaymentCode.length > 0 && !/^[A-Z0-9]{10}$/.test(subPaymentCode) && (
                                <p className="text-xs text-rose-600 font-medium mt-1 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  <span>Enter the 10-character M-Pesa code, e.g. QGH7K2L9MN</span>
                                </p>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500">
                              Admin verifies your code against M-Pesa statements and activates your store for {subBillingPeriod === 'yearly' ? '365 days' : '30 days'}.
                            </p>
                          </div>
                        )}

                        {subPaymentMethod === 'wallet_credit' && (
                          <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                            <p className="text-[11px] text-emerald-900 font-medium">
                              KSh {calcFee.toLocaleString()} will be deducted from your Merchant Wallet and your {periodLabel} plan activated immediately!
                            </p>
                          </div>
                        )}

                        {subPaymentMethod === 'wallet_coins' && (
                          <div className="pt-2 border-t border-slate-200 text-xs text-slate-600">
                            <p className="text-[11px] text-amber-900 font-medium">
                              {calcFee.toLocaleString()} coins will be deducted from your wallet and your {periodLabel} plan activated immediately!
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(subModalError.code === 'INSUFFICIENT_WALLET_BALANCE' ||
                        subModalError.message.toLowerCase().includes('insufficient')) && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsSubscriptionModalOpen(false);
                            onNavigate('wallet', {
                              action: 'deposit',
                              returnTo: 'vendor-dashboard',
                            });
                          }}
                          className="px-2.5 py-1 bg-[#ff6600] hover:bg-[#ff8000] text-white font-bold rounded-md flex items-center gap-1 cursor-pointer"
                        >
                          <Wallet className="w-3 h-3" />
                          <span>Deposit M-Pesa</span>
                        </button>
                      )}
                      {subModalError.canRetry && (
                        <button
                          type="button"
                          onClick={() => handleSubscriptionPay(false)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-md flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
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
                    onClick={() => handleSubscriptionPay(false)}
                    disabled={
                      submittingSubscription ||
                      (subPaymentMethod === 'mpesa_till' && (!subPaymentCode.trim() || !/^[A-Z0-9]{10}$/.test(subPaymentCode.trim())))
                    }
                    className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* CANCEL AUTO-RENEW CONFIRMATION MODAL (No window.confirm) */}
      {isCancelAutoRenewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-extrabold text-slate-900 mb-2">
              Cancel Subscription Auto-Renewal?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Your current merchant subscription will remain active with full catalog limits until{' '}
              <b>
                {subscriptionInfo?.subscription?.expiresAt
                  ? new Date(subscriptionInfo.subscription.expiresAt).toLocaleDateString()
                  : 'the end of your billing cycle'}
              </b>
              , and you will not be billed automatically at renewal.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsCancelAutoRenewModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Keep Auto-Renew
              </button>
              <button
                type="button"
                disabled={cancelingAutoRenew}
                onClick={handleConfirmCancelAutoRenew}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
              >
                {cancelingAutoRenew ? 'Cancelling...' : 'Confirm Cancel Auto-Renew'}
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
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#ff6600] flex items-center justify-center">
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#ff6600] outline-none"
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#ff6600] outline-none"
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#ff6600] outline-none"
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#ff6600] outline-none"
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#ff6600] outline-none"
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
                  className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                >
                  {submittingVerification ? 'Submitting Application...' : 'Submit Verification Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROMPT 4: 10-SPEED GROUP CREATION MODAL */}
      {isSpeedGroupModalOpen && selectedProductForGroup && (() => {
        const usedGroupsCount = myGroups.filter(g => g.productId === selectedProductForGroup.id).length;
        const maxPerProd = subscriptionInfo?.tier?.maxGroupsPerProduct ?? 5;
        const limitReached = usedGroupsCount >= maxPerProd;
        const soloDaily = Math.ceil(selectedProductForGroup.price / Math.max(1, selectedDurationDays));

        return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsSpeedGroupModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-between gap-2 mb-2 pr-8">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Create Group Inside Product
                </h3>
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${limitReached ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {usedGroupsCount} of {maxPerProd >= 999 ? '∞' : maxPerProd} groups used
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Add a new Group for <b>{selectedProductForGroup.title}</b> (KSh {selectedProductForGroup.price.toLocaleString()}) with 1 to 10 members.
            </p>

            {limitReached ? (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-3">
                <p className="font-bold text-amber-950">
                  You have reached your subscription limit ({usedGroupsCount} of {maxPerProd} groups used for this product).
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSpeedGroupModalOpen(false)}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-semibold text-slate-700"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSpeedGroupModalOpen(false);
                      setIsSubscriptionModalOpen(true);
                    }}
                    className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white font-bold rounded-lg cursor-pointer"
                  >
                    Upgrade your plan
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleCreateSpeedGroup} className="space-y-4">
              {/* 10 Speed Selection Options */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Choose Group Size (1 to 10 Members):
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sz) => {
                    const isSolo = sz === 1;
                    const daily = isSolo
                      ? soloDaily
                      : Math.ceil(selectedProductForGroup.price / sz / 10);

                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setSelectedSpeedSize(sz)}
                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                          selectedSpeedSize === sz
                            ? 'border-[#ff6600] bg-emerald-50 text-[#ff6600] font-black ring-2 ring-[#ff6600]/30'
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

              {/* 1-Member Payment Duration */}
              {selectedSpeedSize === 1 && (
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-900">
                      1-Member Payment Duration (Days)
                    </label>
                    <span className="text-xs font-mono font-bold text-[#ff6600]">
                      KSh {soloDaily.toLocaleString()} / day
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {[30, 60, 90, 120, 150, 180].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setSelectedDurationDays(days)}
                        className={`py-1.5 text-[11px] font-bold rounded-lg border cursor-pointer ${
                          selectedDurationDays === days
                            ? 'bg-[#ff6600] text-white border-[#ff6600]'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {days}d
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-slate-600">Or custom days:</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={selectedDurationDays}
                      onChange={(e) => setSelectedDurationDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
                      className="w-24 px-2.5 py-1 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Payment Receiving Mode Prefill */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800">
                    Payment Receiving Method (Paybill / Till / Pochi / Bank Paybill)
                  </label>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'paybill', label: 'Paybill' },
                    { id: 'till', label: 'Till' },
                    { id: 'pochi', label: 'Pochi' },
                    { id: 'bank_paybill', label: 'Bank Paybill' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setGrpPayMode(m.id as PaymentReceivingMode)}
                      className={`py-1.5 text-[11px] font-bold rounded-lg border cursor-pointer ${
                        grpPayMode === m.id ? 'border-[#ff6600] bg-white text-[#ff6600]' : 'border-slate-200 bg-white/60 text-slate-600'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {grpPayMode === 'paybill' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={grpPaybillNumber}
                      onChange={(e) => setGrpPaybillNumber(e.target.value)}
                      placeholder="Paybill No."
                      className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                    />
                    <input
                      type="text"
                      required
                      value={grpPaybillAccount}
                      onChange={(e) => setGrpPaybillAccount(e.target.value)}
                      placeholder="Account No."
                      className="px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                )}
                {grpPayMode === 'till' && (
                  <input
                    type="text"
                    required
                    value={grpTillNumber}
                    onChange={(e) => setGrpTillNumber(e.target.value)}
                    placeholder="Till Number"
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                  />
                )}
                {grpPayMode === 'pochi' && (
                  <input
                    type="text"
                    required
                    value={grpPochiNumber}
                    onChange={(e) => setGrpPochiNumber(e.target.value)}
                    placeholder="Pochi Phone Number"
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                  />
                )}
                {grpPayMode === 'bank_paybill' && (
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      value={grpBankName}
                      onChange={(e) => setGrpBankName(e.target.value)}
                      placeholder="Bank Name"
                      className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                    />
                    <input
                      type="text"
                      required
                      value={grpBankPaybill}
                      onChange={(e) => setGrpBankPaybill(e.target.value)}
                      placeholder="Bank Paybill"
                      className="px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                    />
                    <input
                      type="text"
                      required
                      value={grpBankAccount}
                      onChange={(e) => setGrpBankAccount(e.target.value)}
                      placeholder="Account No."
                      className="px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg bg-white"
                    />
                  </div>
                )}
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
                  className="px-5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {submittingSpeedGroup ? 'Creating Group...' : `Create ${selectedSpeedSize}-Member Group`}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
        );
      })()}

      {/* EARLY RENEWAL FORFEIT CONFIRMATION DIALOG (reset mode) */}
      {earlyRenewalConfirmOpen && (
        <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-amber-300 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Early Renewal Confirmation</h3>
                <p className="text-xs text-slate-500">Billing cycle reset notice</p>
              </div>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Your current subscription still has <b>{subStatus?.days_remaining || 0} day(s)</b> remaining. Renewing now will reset your billing cycle from today and forfeit the remaining unused days of your current cycle. Do you want to proceed?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEarlyRenewalConfirmOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setEarlyRenewalConfirmOpen(false);
                  handleSubscriptionPay(true);
                }}
                className="px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Yes, Renew & Reset Cycle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
