import React, { useState, useEffect } from 'react';
import { User, PaymentRecord, RefundRequest, AuditLog, Product, ChamaGroup, MpesaStatementRecord, ChatModerationEvent, WalletDepositRequest, PlatformAnnouncementSlot, PlatformAnnouncementRevision } from '../types.ts';
import { api } from '../api.ts';
import {
  Shield,
  Check,
  X,
  CreditCard,
  RotateCcw,
  Store,
  FileText,
  AlertCircle,
  RefreshCw,
  Download,
  Users,
  MessageSquare,
  Award,
  Ban,
  UserCheck,
  AlertTriangle,
  Search,
  CheckCircle2,
  Clock,
  Sparkles,
  VolumeX,
  Trash2,
  Wallet,
  Tag,
  Megaphone,
  History,
  Save,
  Eye,
  ArrowRight,
  ExternalLink,
  KeyRound,
  LogOut,
  Lock,
  Loader2,
  XCircle,
} from 'lucide-react';

interface AdminDashboardPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  currentUser,
  onNavigate,
  onNotify,
}) => {
  const [data, setData] = useState<{
    pendingPayments: PaymentRecord[];
    allPayments: PaymentRecord[];
    refundRequests: RefundRequest[];
    merchants: User[];
    allUsers: User[];
    auditLogs: AuditLog[];
    groups: ChamaGroup[];
    products: Product[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'payments' | 'deposits' | 'wallets' | 'users' | 'moderation' | 'refunds' | 'audit' | 'verifications' | 'subscriptions' | 'featured' | 'announcements' | 'settings'>('payments');
  const [processingId, setProcessingId] = useState<number | string | null>(null);

  // Settings State
  const [adminName, setAdminName] = useState(currentUser?.name || 'Administrator');
  const [adminEmail, setAdminEmail] = useState(currentUser?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Wallet deposits data
  const [walletDeposits, setWalletDeposits] = useState<WalletDepositRequest[]>([]);

  // Wallets data
  const [walletsData, setWalletsData] = useState<{
    summary: { totalCredit: number; totalCoins: number; totalPoints: number; totalUsers: number };
    wallets: Array<{
      id: number;
      name: string;
      phone: string;
      role: string;
      balance: number;
      nonWithdrawableBalance?: number;
      coins: number;
      points: number;
      isSuspended?: boolean;
    }>;
  } | null>(null);
  const [walletSearch, setWalletSearch] = useState('');

  // Users data & state
  const [usersList, setUsersList] = useState<User[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Verify modal state
  const [verifyingUser, setVerifyingUser] = useState<User | null>(null);
  const [verificationNotes, setVerificationNotes] = useState('');

  // Points modal state
  const [pointsUser, setPointsUser] = useState<User | null>(null);
  const [pointsAmount, setPointsAmount] = useState(50);
  const [pointsReason, setPointsReason] = useState('Faithful Group contributions & excellent repayment streak');

  // Moderation state
  const [chatLogs, setChatLogs] = useState<{
    moderationEvents: ChatModerationEvent[];
    recentChats: Array<{
      groupId: number;
      groupName: string;
      messageId: string;
      senderId: number;
      senderName: string;
      text: string;
      timestamp: number;
      isFlagged?: boolean;
    }>;
  }>({ moderationEvents: [], recentChats: [] });
  const [moderationReason, setModerationReason] = useState('');
  const [activeChatGroupFilter, setActiveChatGroupFilter] = useState<number | 'all'>('all');

  // Merchant Verifications state (Part C & G)
  const [verificationsList, setVerificationsList] = useState<any[]>([]);
  const [scheduleModal, setScheduleModal] = useState<{ open: boolean; merchantId: number; scheduledDate: string; representative: string }>({
    open: false,
    merchantId: 0,
    scheduledDate: '',
    representative: 'Buyoll Field Operations Team',
  });
  const [completeVisitModal, setCompleteVisitModal] = useState<{ open: boolean; merchantId: number; notes: string; advertInstalled: boolean; photoUrl: string }>({
    open: false,
    merchantId: 0,
    notes: 'Physical shop verified and inventory validated.',
    advertInstalled: true,
    photoUrl: 'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=600&q=80',
  });
  const [exemptionModal, setExemptionModal] = useState<{ open: boolean; merchantId: number; requirement: string; reason: string }>({
    open: false,
    merchantId: 0,
    requirement: 'three_years_operating',
    reason: '',
  });

  // Merchant Subscriptions state (Part C & D)
  const [subscriptionsList, setSubscriptionsList] = useState<any[]>([]);
  const [enterprisePriceModal, setEnterprisePriceModal] = useState<{ open: boolean; merchantId: number; price: number }>({
    open: false,
    merchantId: 0,
    price: 15000,
  });
  const [subRejectModal, setSubRejectModal] = useState<{
    open: boolean;
    subId: string;
    merchantName: string;
    planName: string;
    reason: string;
  }>({
    open: false,
    subId: '',
    merchantName: '',
    planName: '',
    reason: '',
  });

  // Featured Products state (Part E & G)
  const [featuredProducts, setFeaturedProducts] = useState<any[]>([]);
  const [allProductsList, setAllProductsList] = useState<any[]>([]);

  // Hero Announcements Editor State (Feature B)
  const [adminHeroCards, setAdminHeroCards] = useState<PlatformAnnouncementSlot[]>([]);
  const [loadingHeroCards, setLoadingHeroCards] = useState(false);
  const [savingSlot, setSavingSlot] = useState<number | null>(null);
  const [historySlot, setHistorySlot] = useState<number | null>(null);
  const [historyRevisions, setHistoryRevisions] = useState<PlatformAnnouncementRevision[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    loadAllAdminData();
  }, []);

  async function loadAllAdminData() {
    setLoading(true);
    try {
      const [overviewRes, walletsRes, usersRes, chatLogsRes, depositsRes, verifsRes, subsRes, featRes] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminWallets().catch(() => null),
        api.getAdminUsers().catch(() => ({ users: [] })),
        api.getAdminChatLogs().catch(() => ({ moderationEvents: [], recentChats: [] })),
        api.getAdminWalletDeposits().catch(() => ({ deposits: [] })),
        api.getAdminMerchantVerifications().catch(() => ({ verifications: [] })),
        api.getAdminMerchantSubscriptions().catch(() => ({ subscriptions: [] })),
        api.getAdminFeaturedProducts().catch(() => ({ featured: [], allProducts: [] })),
      ]);

      if (overviewRes) {
        setData({
          pendingPayments: overviewRes.pendingPayments || [],
          allPayments: overviewRes.allPayments || [],
          refundRequests: overviewRes.refundRequests || [],
          merchants: overviewRes.merchants || [],
          allUsers: overviewRes.allUsers || [],
          auditLogs: overviewRes.auditLogs || [],
          groups: overviewRes.groups || [],
          products: overviewRes.products || [],
        });
      }
      if (walletsRes) {
        setWalletsData({
          summary: {
            totalCredit: walletsRes.summary?.totalCredit || 0,
            totalCoins: walletsRes.summary?.totalCoins || 0,
            totalPoints: walletsRes.summary?.totalPoints || 0,
            totalUsers: walletsRes.summary?.totalUsers || walletsRes.summary?.userCount || 0,
          },
          wallets: walletsRes.wallets || [],
        });
      }
      if (usersRes?.users) setUsersList(usersRes.users || []);
      if (chatLogsRes) {
        const recent = chatLogsRes.recentChats || (chatLogsRes.logs || []).map((l: any) => ({
          groupId: l.groupId || 1,
          groupName: l.groupName || 'Group',
          messageId: l.id || `msg_${l.timestamp}`,
          senderId: l.senderId || 0,
          senderName: l.senderName || 'Member',
          text: l.text || '',
          timestamp: l.timestamp || Date.now(),
          isFlagged: l.isFlagged,
        })) || [];
        setChatLogs({
          moderationEvents: chatLogsRes.moderationEvents || chatLogsRes.moderationActions || [],
          recentChats: recent,
        });
      }
      if (depositsRes?.deposits) setWalletDeposits(depositsRes.deposits || []);
      if (verifsRes?.verifications) setVerificationsList(verifsRes.verifications || []);
      if (subsRes?.subscriptions) setSubscriptionsList(subsRes.subscriptions || []);
      if (featRes) {
        setFeaturedProducts(featRes.featured || []);
        setAllProductsList(featRes.allProducts || []);
      }
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load administration data');
    } finally {
      setLoading(false);
    }
  }

  // Handle Wallet Deposit Decision (Approve & Credit Wallet or Decline)
  async function handleDepositDecision(depositId: string, action: 'approve' | 'decline') {
    setProcessingId(depositId);
    try {
      const res = await api.decideWalletDeposit(depositId, { action });
      onNotify('success', res.message || `Deposit request ${action}d!`);
      await loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process deposit request');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Payment Decision
  async function handlePaymentDecision(paymentId: number, decision: 'approve' | 'reject') {
    setProcessingId(paymentId);
    try {
      const res = await api.adminDecidePayment(paymentId, decision);
      onNotify('success', res.message || `Payment #${paymentId} ${decision}d`);
      await loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process payment');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Refund Status
  async function handleRefundStatus(refundId: number, status: string) {
    setProcessingId(refundId);
    try {
      const res = await api.adminRefundStatus(refundId, status);
      onNotify('success', res.message);
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update refund status');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Verify User / Merchant
  async function submitUserVerification() {
    if (!verifyingUser) return;
    setProcessingId(verifyingUser.id);
    try {
      const res = await api.adminVerifyUser(verifyingUser.id, true, verificationNotes);
      onNotify('success', res.message || `Merchant ${verifyingUser.name} verified!`);
      setVerifyingUser(null);
      setVerificationNotes('');
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to verify merchant');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Award Points
  async function submitAwardPoints() {
    if (!pointsUser) return;
    setProcessingId(pointsUser.id);
    try {
      const res = await api.adminAwardPoints(pointsUser.id, pointsAmount, pointsReason);
      onNotify('success', res.message || `Awarded ${pointsAmount} points to ${pointsUser.name}`);
      setPointsUser(null);
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to award points');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Suspend / Reinstate User
  async function handleToggleSuspend(targetUser: User) {
    const willSuspend = !targetUser.isSuspended;
    setProcessingId(targetUser.id);
    try {
      const res = await api.adminSuspendUser(
        targetUser.id,
        willSuspend,
        willSuspend ? 'Suspended by system administrator for security review' : 'Reinstated by admin'
      );
      onNotify('success', res.message || `User account status updated`);
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update user status');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Chat Moderation
  async function handleChatModerate(
    action: 'flag' | 'warn' | 'mute' | 'remove_message' | 'remove_user',
    targetUserId: number,
    groupId?: number,
    messageId?: string
  ) {
    const reasonPrompt = moderationReason.trim() || `Admin enforced action: ${action}`;
    setProcessingId(`${action}_${messageId || targetUserId}`);
    try {
      const res = await api.moderateChat({
        action,
        targetUserId,
        groupId,
        messageId,
        reason: reasonPrompt,
      });
      onNotify('success', res.message || `Moderation action "${action}" applied`);
      setModerationReason('');
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to apply moderation action');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Schedule Shop Visit (Part C & G)
  async function handleScheduleVisitSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProcessingId(`sched_${scheduleModal.merchantId}`);
    try {
      const res = await api.adminScheduleVisit(scheduleModal.merchantId, {
        scheduledDate: scheduleModal.scheduledDate,
        representative: scheduleModal.representative,
      });
      onNotify('success', res.message || 'Shop visit scheduled!');
      setScheduleModal({ ...scheduleModal, open: false });
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to schedule shop visit');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Record Completed Visit & Advert Photo (Part C & G)
  async function handleCompleteVisitSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProcessingId(`visit_${completeVisitModal.merchantId}`);
    try {
      const res = await api.adminCompleteVisit(completeVisitModal.merchantId, {
        notes: completeVisitModal.notes,
        advertInstalled: completeVisitModal.advertInstalled,
        photoUrl: completeVisitModal.photoUrl,
      });
      onNotify('success', res.message || 'Shop visit details recorded!');
      setCompleteVisitModal({ ...completeVisitModal, open: false });
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to record shop visit');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Grant Exemption with Mandatory Reason (Part C & G)
  async function handleGrantExemptionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exemptionModal.reason.trim()) {
      onNotify('error', 'Exemption reason is mandatory. Written justification required.');
      return;
    }
    setProcessingId(`ex_${exemptionModal.merchantId}`);
    try {
      const res = await api.adminGrantExemption(exemptionModal.merchantId, {
        requirement: exemptionModal.requirement,
        reason: exemptionModal.reason,
      });
      onNotify('success', res.message || 'Exemption granted and logged in audit trail!');
      setExemptionModal({ ...exemptionModal, open: false, reason: '' });
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to grant exemption');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Verification Decision (Verify or Decline)
  async function handleVerificationDecision(merchantId: number, action: 'verify' | 'decline') {
    let declineReason = '';
    if (action === 'decline') {
      const promptRes = window.prompt('Enter reason for declining verification:');
      if (promptRes === null) return;
      declineReason = promptRes;
    }
    setProcessingId(`dec_${merchantId}`);
    try {
      const res = await api.adminDecideVerification(merchantId, { action, declineReason });
      onNotify('success', res.message || `Merchant verification ${action === 'verify' ? 'approved' : 'declined'}`);
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update verification status');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Manual Subscription Approval & Rejection (Part C & D)
  async function handleApproveSubscription(subId: string) {
    setProcessingId(subId);
    try {
      const res = await api.approveAdminMerchantSubscription(subId);
      onNotify('success', res.message || 'Subscription approved and store activated for 30 days!');
      await loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to approve subscription');
    } finally {
      setProcessingId(null);
    }
  }

  function handleOpenRejectSubscription(sub: any) {
    setSubRejectModal({
      open: true,
      subId: sub.id,
      merchantName: sub.shopName || sub.merchantName || `Merchant #${sub.merchantId}`,
      planName: sub.tierName || sub.planName || 'Merchant Plan',
      reason: 'M-Pesa payment code could not be verified against statement records. Please verify transaction details and resubmit.',
    });
  }

  async function handleConfirmRejectSubscription(e: React.FormEvent) {
    e.preventDefault();
    const reason = subRejectModal.reason.trim();
    if (!reason || reason.length < 3) {
      onNotify('error', 'A rejection reason of at least 3 characters is mandatory.');
      return;
    }
    setProcessingId(subRejectModal.subId);
    try {
      const res = await api.declineAdminMerchantSubscription(subRejectModal.subId, reason);
      onNotify('success', res.message || 'Subscription request rejected.');
      setSubRejectModal({ open: false, subId: '', merchantName: '', planName: '', reason: '' });
      await loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to reject subscription');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Enterprise Price Agreement (Part C & D)
  async function handleSetEnterprisePriceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProcessingId(`ent_${enterprisePriceModal.merchantId}`);
    try {
      const res = await api.setAdminEnterprisePrice(enterprisePriceModal.merchantId, enterprisePriceModal.price);
      onNotify('success', res.message || 'Custom Enterprise price agreed!');
      setEnterprisePriceModal({ ...enterprisePriceModal, open: false });
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to set Enterprise price');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Toggle Featured Product (KES 30/day)
  async function handleToggleFeatured(productId: number) {
    setProcessingId(`feat_${productId}`);
    try {
      const res = await api.toggleAdminFeaturedProduct(productId);
      onNotify('success', res.message || 'Featured product updated!');
      loadAllAdminData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update featured product');
    } finally {
      setProcessingId(null);
    }
  }

  // Hero Announcements Handlers (Feature B)
  async function loadAdminHeroCards() {
    setLoadingHeroCards(true);
    try {
      const res = await api.getAdminHeroAnnouncementCards();
      setAdminHeroCards(res.cards || []);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load announcement cards');
    } finally {
      setLoadingHeroCards(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'announcements') {
      loadAdminHeroCards();
    }
  }, [activeTab]);

  function handleCardFieldChange(slot: number, field: keyof PlatformAnnouncementSlot, value: any) {
    setAdminHeroCards(prev => prev.map(c => c.slot === slot ? { ...c, [field]: value } : c));
  }

  async function handleSaveCard(slot: number, publishDirect = false) {
    const card = adminHeroCards.find(c => c.slot === slot);
    if (!card) return;
    if (!card.title.trim()) {
      onNotify('error', 'Title is required');
      return;
    }
    if (!card.message.trim()) {
      onNotify('error', 'Message is required');
      return;
    }
    setSavingSlot(slot);
    try {
      const res = await api.updateAdminHeroAnnouncementCard(slot, {
        title: card.title.trim(),
        message: card.message.trim(),
        badge: card.badge?.trim() || '',
        accent: card.accent,
        ctaLabel: card.ctaLabel?.trim() || undefined,
        ctaUrl: card.ctaUrl?.trim() || undefined,
        status: publishDirect ? 'published' : (card.status || (card.isPublished ? 'published' : 'draft')),
        startsAt: card.startsAt || undefined,
        endsAt: card.endsAt || undefined,
        version: card.version,
      });
      onNotify('success', res.message || `Hero Card Slot #${slot} updated successfully!`);
      setAdminHeroCards(prev => prev.map(c => c.slot === slot ? res.card : c));
    } catch (err: any) {
      if (err.message && err.message.includes('Conflict')) {
        onNotify('error', 'Another admin updated this card while you were editing. Reloading latest version...');
        loadAdminHeroCards();
      } else {
        onNotify('error', err.message || 'Failed to update hero card');
      }
    } finally {
      setSavingSlot(null);
    }
  }

  async function handleTogglePublish(slot: number, currentlyPublished: boolean) {
    setSavingSlot(slot);
    try {
      if (currentlyPublished) {
        const res = await api.unpublishAdminHeroAnnouncementCard(slot);
        onNotify('info', res.message || `Slot #${slot} set to draft.`);
        setAdminHeroCards(prev => prev.map(c => c.slot === slot ? res.card : c));
      } else {
        const res = await api.publishAdminHeroAnnouncementCard(slot);
        onNotify('success', res.message || `Slot #${slot} published to public hero.`);
        setAdminHeroCards(prev => prev.map(c => c.slot === slot ? res.card : c));
      }
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to toggle published status');
    } finally {
      setSavingSlot(null);
    }
  }

  async function openHistoryDrawer(slot: number) {
    setHistorySlot(slot);
    setLoadingHistory(true);
    try {
      const res = await api.getAdminHeroAnnouncementHistory(slot);
      setHistoryRevisions(res.revisions || res.history || []);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load card history');
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleRevert(slot: number, revId: string) {
    setSavingSlot(slot);
    try {
      const res = await api.revertAdminHeroAnnouncementCard(slot, revId);
      onNotify('success', res.message || `Slot #${slot} successfully reverted!`);
      setAdminHeroCards(prev => prev.map(c => c.slot === slot ? res.card : c));
      setHistorySlot(null);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to revert card version');
    } finally {
      setSavingSlot(null);
    }
  }

  // Password strength calculator helper
  const getPasswordStrength = (pw: string) => {
    if (!pw) return { score: 0, label: 'Not entered', color: 'bg-slate-200', textCol: 'text-slate-400', width: '0%' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (pw.length < 6) {
      return { score: 1, label: 'Too short (min 6 chars)', color: 'bg-red-500', textCol: 'text-red-600', width: '20%' };
    }
    if (score === 1) return { score: 1, label: 'Weak', color: 'bg-red-500', textCol: 'text-red-600', width: '25%' };
    if (score === 2) return { score: 2, label: 'Fair', color: 'bg-amber-500', textCol: 'text-amber-600', width: '50%' };
    if (score === 3) return { score: 3, label: 'Good', color: 'bg-sky-500', textCol: 'text-sky-600', width: '75%' };
    return { score: 4, label: 'Strong', color: 'bg-emerald-600', textCol: 'text-emerald-700', width: '100%' };
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsNotice(null);
    try {
      const res = await api.updateAdminAccount({
        name: adminName.trim(),
        email: adminEmail.trim(),
      });
      setSettingsNotice({ type: 'success', text: res.message || 'Profile information updated successfully.' });
      onNotify('success', 'Administrator username/email updated.');
    } catch (err: any) {
      setSettingsNotice({ type: 'error', text: err.message || 'Failed to update administrator profile.' });
      onNotify('error', err.message || 'Profile update error.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsNotice(null);

    if (!currentPassword) {
      setSettingsNotice({ type: 'error', text: 'Please enter your current password to authorize this change.' });
      setSavingSettings(false);
      return;
    }
    if (newPassword.length < 6) {
      setSettingsNotice({ type: 'error', text: 'New password must be at least 6 characters long.' });
      setSavingSettings(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsNotice({ type: 'error', text: 'New password and confirmation do not match.' });
      setSavingSettings(false);
      return;
    }

    try {
      const res = await api.updateAdminAccount({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSettingsNotice({ type: 'success', text: 'Administrator password changed successfully! Your session remains active.' });
      onNotify('success', 'Administrator password updated successfully.');
    } catch (err: any) {
      setSettingsNotice({ type: 'error', text: err.message || 'Could not update password. Please check your current password.' });
      onNotify('error', err.message || 'Password update failed.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="w-14 h-14 bg-red-100 text-red-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Shield className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">Restricted Access</h2>
        <p className="text-xs text-slate-600 mb-6">
          This area requires administrative role permissions (RBAC). Please sign in with an authorized Buyoll Admin account.
        </p>
        <button
          onClick={() => onNavigate('home')}
          className="px-5 py-2.5 bg-[#ff6600] text-white text-xs font-bold rounded-xl"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-10 h-10 border-4 border-[#ff6600] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-xs font-semibold text-slate-600">Loading Buyoll Admin Control Center...</p>
      </div>
    );
  }

  // Filtered users
  const filteredUsers = (usersList.length > 0 ? usersList : (data?.allUsers || [])).filter(u => {
    const matchesSearch =
      (u.name || '').toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.phone || '').includes(userSearch) ||
      (u.email && u.email.toLowerCase().includes(userSearch.toLowerCase())) ||
      (u.shopName && u.shopName.toLowerCase().includes(userSearch.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  // Filtered wallets
  const filteredWallets = (walletsData?.wallets || []).filter(w =>
    (w.name || '').toLowerCase().includes(walletSearch.toLowerCase()) ||
    (w.phone || '').includes(walletSearch) ||
    (w.role || '').toLowerCase().includes(walletSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#ff6600] text-white flex items-center justify-center font-bold">
              <Shield className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Buyoll System Administration & Escrow
            </h1>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase rounded-full">
              Super Admin
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Reconcile payments against Till 196853 & Paybill 522533 statements, oversee wallets, manage users, and moderate Group chats.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-[#ff6600] text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>

          <button
            onClick={loadAllAdminData}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <button
            onClick={async () => {
              if (window.confirm('Are you sure you want to log out of the Buyoll Admin Console?')) {
                try {
                  await api.logout();
                } catch {}
                localStorage.removeItem('buyoll_auth_user');
                onNavigate('admin-portal');
                onNotify('info', 'Logged out of administrator session.');
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'payments' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Payment Queue ({(data?.pendingPayments || []).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('deposits')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'deposits' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet Deposits ({(walletDeposits || []).filter(d => d.status === 'pending').length})</span>
        </button>

        <button
          onClick={() => setActiveTab('wallets')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'wallets' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Wallets & CSV Export</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'users' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Users & Merchants ({filteredUsers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'moderation' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat Moderation ({(chatLogs?.recentChats || []).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('refunds')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'refunds' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Refund Requests ({(data?.refundRequests || []).length})</span>
        </button>

        <button
          onClick={() => setActiveTab('verifications')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'verifications' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Merchant Verifications ({verificationsList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('subscriptions')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'subscriptions' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Subscriptions ({subscriptionsList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('featured')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'featured' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Tag className="w-4 h-4" />
          <span>Featured Products ({featuredProducts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('announcements')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'announcements' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Megaphone className="w-4 h-4" />
          <span>Hero Announcements (3 Cards)</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'audit' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Log</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'settings' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Account Settings</span>
        </button>
      </div>

      {/* TAB 1: PAYMENTS VERIFICATION QUEUE WITH SIDE-BY-SIDE MATCHING */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                  Automated Side-by-Side Statement Matching
                </h3>
                <p className="text-xs text-emerald-900 mt-0.5">
                  Submissions are matched in real-time against bank & till records (Till <b>196853</b> / Paybill <b>522533</b>).
                  Verify matched names and amounts before approving.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold shrink-0">
              <span className="px-2 py-1 bg-white border border-emerald-200 rounded-lg text-emerald-800">
                {(data?.pendingPayments || []).length} Pending
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {(data?.pendingPayments || []).length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2 opacity-80" />
                <p className="text-xs font-bold text-slate-600">All submissions are fully reconciled!</p>
                <p className="text-[11px] text-slate-400 mt-1">No pending payments requiring admin authorization.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Submission / User</th>
                      <th className="py-3 px-4">Payment Type</th>
                      <th className="py-3 px-4">Member Input (Code & Amt)</th>
                      <th className="py-3 px-4">Till Statement Match (Side-by-Side)</th>
                      <th className="py-3 px-4">Verification Status</th>
                      <th className="py-3 px-6 text-right">Escrow Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data?.pendingPayments || []).map((p) => {
                      const match = (p as any).statementMatch;
                      const hasDuplicate = match?.duplicateDetected;
                      const isMatched = match?.matched;
                      const reason = match?.reason;
                      const stmt = match?.statementRecord as MpesaStatementRecord | undefined;

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900">{p.userName}</div>
                            <div className="text-[11px] text-slate-400">
                              {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })},{' '}
                              {new Date(p.createdAt).toLocaleDateString()}
                            </div>
                            {p.groupName && (
                              <div className="text-[11px] text-[#ff6600] font-semibold mt-0.5">
                                {p.groupName} {p.slotNumber ? `(Slot #${p.slotNumber})` : ''}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <span className="capitalize px-2 py-0.5 rounded-md font-bold text-[10px] bg-slate-100 text-slate-700">
                              {p.type.replace('_', ' ')}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-mono font-black text-indigo-700 text-sm tracking-wide">
                              {p.code}
                            </div>
                            <div className="font-extrabold text-slate-900 tabular-nums">
                              KSh {p.amount.toLocaleString()}
                            </div>
                          </td>

                          {/* Side-by-side statement view */}
                          <td className="py-3 px-4">
                            {stmt ? (
                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 max-w-xs space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500">Till:</span>
                                  <span className="font-bold text-slate-800">{stmt.tillOrPaybill}</span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500">Sender:</span>
                                  <span className="font-bold text-slate-800 truncate max-w-[130px]">{stmt.senderName}</span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-500">Stmt Amount:</span>
                                  <span className={`font-black tabular-nums ${stmt.amount === p.amount ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    KSh {stmt.amount.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-400">
                                  <span>Time:</span>
                                  <span>{stmt.timestamp}</span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 max-w-xs">
                                ⚠ No matching record found on statement feed for code <b>{p.code}</b>. Please check physical Till portal.
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            {hasDuplicate ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-800 font-extrabold rounded-full text-[10px]">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Duplicate Code</span>
                              </span>
                            ) : isMatched ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold rounded-full text-[10px]">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Statement Matched</span>
                              </span>
                            ) : reason === 'amount_mismatch' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-800 font-extrabold rounded-full text-[10px]">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Amount Mismatch</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 font-bold rounded-full text-[10px]">
                                <Clock className="w-3 h-3" />
                                <span>Unverified Code</span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-6 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handlePaymentDecision(p.id, 'reject')}
                                disabled={processingId === p.id}
                                className="px-2.5 py-1.5 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-lg transition-colors"
                              >
                                Decline
                              </button>
                              <button
                                onClick={() => handlePaymentDecision(p.id, 'approve')}
                                disabled={processingId === p.id}
                                className="flex items-center gap-1 px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve</span>
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
        </div>
      )}

      {/* TAB: WALLET DEPOSITS APPROVAL QUEUE */}
      {activeTab === 'deposits' && (
        <div className="space-y-6">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                  Member Wallet M-Pesa Deposits Verification Queue
                </h3>
                <p className="text-xs text-emerald-900 mt-0.5">
                  Members deposit funds via Platform Till <b>196853</b> or Paybill <b>522533</b>. Approving automatically credits the user's Store Credit wallet balance in real-time.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold shrink-0">
              <span className="px-2.5 py-1 bg-white border border-emerald-200 rounded-lg text-emerald-800">
                {walletDeposits.filter(d => d.status === 'pending').length} Pending Deposits
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {walletDeposits.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2 opacity-80" />
                <p className="text-xs font-bold text-slate-600">No wallet deposits recorded yet</p>
                <p className="text-[11px] text-slate-400 mt-1">When members submit deposit requests from their Wallet, they will appear here for one-click approval.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Member / User</th>
                      <th className="py-3 px-4">Deposit Amount</th>
                      <th className="py-3 px-4">M-Pesa Code</th>
                      <th className="py-3 px-4">Submitted Date</th>
                      <th className="py-3 px-4">Member Note</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-6 text-right">Escrow Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {walletDeposits.map((dep) => (
                      <tr key={dep.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{dep.userName}</span>
                            {dep.role && (
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                dep.role === 'merchant'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : dep.role === 'lender'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}>
                                {dep.role}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">{dep.userPhone}</div>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-mono font-black text-emerald-800 text-sm">
                            KSh {dep.amount.toLocaleString()}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="px-2 py-1 bg-slate-100 text-slate-800 font-mono font-bold text-xs rounded-md uppercase border border-slate-200">
                            {dep.mpesaCode}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-[11px] text-slate-500">
                          {new Date(dep.createdAt).toLocaleDateString()}{' '}
                          <span className="text-slate-400">
                            {new Date(dep.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                          {dep.notes || <span className="text-slate-400 italic">None</span>}
                        </td>

                        <td className="py-3 px-4">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            dep.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : dep.status === 'declined'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse'
                          }`}>
                            {dep.status}
                          </span>
                          {dep.processedBy && (
                            <div className="text-[9px] text-slate-400 mt-0.5">by {dep.processedBy}</div>
                          )}
                        </td>

                        <td className="py-3 px-6 text-right">
                          {dep.status === 'pending' ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleDepositDecision(dep.id, 'approve')}
                                disabled={processingId === dep.id}
                                className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white font-bold rounded-lg text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                              >
                                {processingId === dep.id ? 'Crediting...' : 'Approve & Credit'}
                              </button>
                              <button
                                onClick={() => handleDepositDecision(dep.id, 'decline')}
                                disabled={processingId === dep.id}
                                className="px-2.5 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-700 font-semibold rounded-lg text-xs disabled:opacity-50 cursor-pointer"
                              >
                                Decline
                              </button>
                            </div>
                          ) : dep.status === 'approved' ? (
                            <span className="text-xs text-emerald-700 font-bold flex items-center justify-end gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Credited to Wallet
                            </span>
                          ) : (
                            <span className="text-xs text-red-600 font-medium">Declined</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: WALLETS OVERSIGHT & CSV EXPORT */}
      {activeTab === 'wallets' && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Total Credit in Circulation
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                KSh {walletsData?.summary?.totalCredit?.toLocaleString() || '0'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Platform shopping & locked Group balances</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Total Community Coins
              </span>
              <div className="text-2xl font-black text-amber-600 tabular-nums">
                {walletsData?.summary?.totalCoins?.toLocaleString() || '0'}{' '}
                <span className="text-xs font-bold text-slate-400">coins</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Applaud & motivate currency held</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Reward Points Awarded
              </span>
              <div className="text-2xl font-black text-indigo-600 tabular-nums">
                {walletsData?.summary?.totalPoints?.toLocaleString() || '0'}{' '}
                <span className="text-xs font-bold text-slate-400">pts</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Merit points for reliable repayment</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Registered Member Accounts
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {walletsData?.summary?.totalUsers || (filteredUsers || []).length}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Buyers, merchants, lenders, admins</p>
            </div>
          </div>

          {/* Action bar with search & CSV export */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={walletSearch}
                onChange={(e) => setWalletSearch(e.target.value)}
                placeholder="Search member by name, phone or role..."
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
              />
            </div>

            <a
              href="/api/admin/wallets/export-csv"
              download="buyoll_wallets_export.csv"
              className="flex items-center justify-center gap-2 px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Download Wallets CSV</span>
            </a>
          </div>

          {/* Ledger Table */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">User Details</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Withdrawable / Shopping Credit</th>
                    <th className="py-3 px-4">Locked Group Balance</th>
                    <th className="py-3 px-4">Coins</th>
                    <th className="py-3 px-4">Points</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredWallets.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{w.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{w.phone}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="capitalize px-2 py-0.5 rounded-md font-bold text-[10px] bg-slate-100 text-slate-700">
                          {w.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 tabular-nums">
                        KSh {w.balance.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-800 tabular-nums">
                        KSh {(w.nonWithdrawableBalance || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-bold text-amber-600 tabular-nums">
                        {w.coins.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-bold text-indigo-700 tabular-nums">
                        {w.points.toLocaleString()} pts
                      </td>
                      <td className="py-3 px-4">
                        {w.isSuspended ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 font-bold text-[10px] rounded-full">
                            Suspended
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold text-[10px] rounded-full">
                            Active
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: USER & MERCHANT MANAGEMENT */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name, phone, shop..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                />
              </div>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
              >
                <option value="all">All Roles</option>
                <option value="merchant">Merchants</option>
                <option value="buyer">Buyers / Members</option>
                <option value="lender">Lenders</option>
                <option value="admin">Admins</option>
              </select>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Showing <b>{filteredUsers.length}</b> accounts
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Member / Merchant</th>
                    <th className="py-3 px-4">Role & Store</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Verification & Badges</th>
                    <th className="py-3 px-4">Merit Points</th>
                    <th className="py-3 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{u.name}</span>
                          {u.verified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400">ID #{u.id}</div>
                      </td>

                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                          u.role === 'merchant'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'admin'
                            ? 'bg-slate-900 text-white'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {u.role.toUpperCase()}
                        </span>
                        {u.shopName && (
                          <div className="text-[11px] font-semibold text-slate-700 mt-1 flex items-center gap-1">
                            <Store className="w-3 h-3 text-slate-400" />
                            <span>{u.shopName}</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-mono text-slate-700">{u.phone}</div>
                        {u.email && <div className="text-[11px] text-slate-400">{u.email}</div>}
                      </td>

                      <td className="py-3 px-4">
                        {u.verified ? (
                          <div>
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-extrabold rounded-full text-[10px] inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Verified Merchant</span>
                            </span>
                            {u.merchantVerificationNotes && (
                              <div className="text-[10px] text-slate-500 mt-1 italic max-w-xs truncate">
                                "{u.merchantVerificationNotes}"
                              </div>
                            )}
                          </div>
                        ) : u.role === 'merchant' ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-full text-[10px]">
                            Pending Verification
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-bold text-indigo-700 tabular-nums">
                          {u.points || 0} pts
                        </div>
                        <button
                          onClick={() => setPointsUser(u)}
                          className="text-[10px] text-[#ff6600] hover:underline font-bold mt-0.5 flex items-center gap-0.5"
                        >
                          <Award className="w-3 h-3" />
                          <span>+ Award Points</span>
                        </button>
                      </td>

                      <td className="py-3 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {u.role === 'merchant' && !u.verified && (
                            <button
                              onClick={() => {
                                setVerifyingUser(u);
                                setVerificationNotes('Approved after reviewing business permits and physical shop inventory.');
                              }}
                              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg transition-colors"
                            >
                              Verify
                            </button>
                          )}

                          <button
                            onClick={() => handleToggleSuspend(u)}
                            disabled={processingId === u.id || u.role === 'admin'}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${
                              u.isSuspended
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'text-red-600 hover:bg-red-50'
                            }`}
                          >
                            {u.isSuspended ? 'Reinstate' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CHAT MODERATION */}
      {activeTab === 'moderation' && (
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xs font-black text-amber-950 uppercase tracking-wider">
                Group Chat Supervision & Enforcement
              </h3>
              <p className="text-xs text-amber-900 mt-0.5">
                Inspect group discussions, flag inappropriate content, issue formal warnings, mute disruptive users (`isMuted`), or purge malicious messages.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Recent Group Chat Messages</h3>
              <span className="text-xs text-slate-500">{(chatLogs?.recentChats || []).length} recent messages</span>
            </div>

            {(chatLogs?.recentChats || []).length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No active chat messages logged yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(chatLogs?.recentChats || []).map((msg) => (
                  <div key={msg.messageId} className="p-4 hover:bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{msg.senderName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-md">
                          Group #{msg.groupId} ({msg.groupName})
                        </span>
                        {msg.isFlagged && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 text-[10px] font-bold rounded-md">
                            FLAGGED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100 max-w-2xl">
                        {msg.text}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center">
                      <button
                        onClick={() => handleChatModerate('warn', msg.senderId, msg.groupId, msg.messageId)}
                        className="px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        Warn Member
                      </button>

                      <button
                        onClick={() => handleChatModerate('mute', msg.senderId, msg.groupId, msg.messageId)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>Mute</span>
                      </button>

                      <button
                        onClick={() => handleChatModerate('remove_message', msg.senderId, msg.groupId, msg.messageId)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: REFUND REQUESTS */}
      {activeTab === 'refunds' && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Member Refund Claims (Part 5 Default Policy)
              </h2>
              <p className="text-xs text-slate-500">
                Verified claims from members whose slots were vacated.
              </p>
            </div>
            <span className="text-xs text-slate-500">{(data?.refundRequests || []).length} requests</span>
          </div>

          {(data?.refundRequests || []).length === 0 ? (
            <p className="text-xs text-slate-400 py-12 text-center">No refund requests submitted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Claim ID</th>
                    <th className="py-3 px-4">Member Name</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-4">Product Title</th>
                    <th className="py-3 px-4">Refund Amount</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.refundRequests || []).map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono">#{r.id}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{r.userName}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{r.userPhone}</td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{r.productTitle}</td>
                      <td className="py-3 px-4 font-bold text-emerald-800 tabular-nums">
                        KSh {r.eligibleRefundAmount.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.status === 'approved'
                              ? 'bg-blue-100 text-blue-800'
                              : r.status === 'rejected'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {r.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-right">
                        {r.status === 'requested' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleRefundStatus(r.id, 'approved')}
                              className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRefundStatus(r.id, 'rejected')}
                              className="px-2 py-1 text-red-600 hover:bg-red-50 text-xs font-semibold rounded"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {r.status === 'approved' && (
                          <button
                            onClick={() => handleRefundStatus(r.id, 'completed')}
                            className="px-3 py-1 bg-emerald-700 text-white text-xs font-bold rounded"
                          >
                            Mark Disbursed
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: HERO ANNOUNCEMENTS & NOTICES (3 SLOTS) - FEATURE B */}
      {activeTab === 'announcements' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="p-2 bg-emerald-50 text-[#ff6600] rounded-xl">
                  <Megaphone className="w-4 h-4" />
                </span>
                <h2 className="text-base font-extrabold text-slate-900">
                  Announcements & Notices
                </h2>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                  Admin Managed
                </span>
              </div>
              <p className="text-xs text-slate-500 max-w-2xl">
                Edit the 3 high-visibility announcement slots on the marketplace hero. Changes support instant live previews, optimistic locking (409 protection), and full version history with one-click restore.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={loadAdminHeroCards}
                disabled={loadingHeroCards}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingHeroCards ? 'animate-spin' : ''}`} />
                <span>Reload Cards</span>
              </button>
            </div>
          </div>

          {loadingHeroCards && adminHeroCards.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              <div className="w-8 h-8 border-3 border-[#ff6600] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading Hero Announcement Slots...
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((slotNumber) => {
                const card = adminHeroCards.find((c) => c.slot === slotNumber) || {
                  slot: slotNumber as 1 | 2 | 3,
                  title: '',
                  message: '',
                  badge: 'NOTICE',
                  accent: 'emerald' as const,
                  ctaLabel: '',
                  ctaUrl: '',
                  isPublished: true,
                  startsAt: null,
                  endsAt: null,
                  updatedAt: new Date().toISOString(),
                  updatedBy: 'admin',
                  version: 1,
                };

                const accentPreviewStyles: Record<string, { card: string; badge: string; dot: string; cta: string }> = {
                  emerald: {
                    card: 'border-emerald-300 bg-emerald-50/50 text-slate-900',
                    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
                    dot: 'bg-emerald-500',
                    cta: 'bg-emerald-700 hover:bg-emerald-800 text-white',
                  },
                  pink: {
                    card: 'border-pink-300 bg-pink-50/50 text-slate-900',
                    badge: 'bg-pink-100 text-pink-800 border-pink-300',
                    dot: 'bg-pink-500',
                    cta: 'bg-pink-700 hover:bg-pink-800 text-white',
                  },
                  violet: {
                    card: 'border-violet-300 bg-violet-50/50 text-slate-900',
                    badge: 'bg-violet-100 text-violet-800 border-violet-300',
                    dot: 'bg-violet-500',
                    cta: 'bg-violet-700 hover:bg-violet-800 text-white',
                  },
                  amber: {
                    card: 'border-amber-300 bg-amber-50/50 text-slate-900',
                    badge: 'bg-amber-100 text-amber-800 border-amber-300',
                    dot: 'bg-amber-500',
                    cta: 'bg-amber-600 hover:bg-amber-700 text-white',
                  },
                  sky: {
                    card: 'border-sky-300 bg-sky-50/50 text-slate-900',
                    badge: 'bg-sky-100 text-sky-800 border-sky-300',
                    dot: 'bg-sky-500',
                    cta: 'bg-sky-700 hover:bg-sky-800 text-white',
                  },
                };

                const currentAccentStyle = accentPreviewStyles[card.accent] || accentPreviewStyles.emerald;
                const isSaving = savingSlot === slotNumber;

                return (
                  <div
                    key={slotNumber}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4"
                  >
                    <div>
                      {/* Slot Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center justify-center">
                            #{slotNumber}
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            Slot {slotNumber}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            v{card.version}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {(card.status === 'published' || card.isPublished) ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                              Published
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full">
                              Draft
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => openHistoryDrawer(slotNumber)}
                            className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-700 rounded-md transition-colors cursor-pointer"
                            title="View Revision History"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Live Preview Box */}
                      <div className="mb-4">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">
                          Live Hero Card Preview
                        </label>
                        <div className={`p-4 rounded-xl border shadow-2xs transition-all ${currentAccentStyle.card}`}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-black uppercase rounded-md border ${currentAccentStyle.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${currentAccentStyle.dot}`} />
                              {card.badge || 'NOTICE'}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400">Preview</span>
                          </div>
                          <h4 className="text-xs font-extrabold text-slate-900 mb-1 leading-snug line-clamp-2">
                            {card.title || 'Untitled Card'}
                          </h4>
                          <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-3">
                            {card.message || 'No description provided.'}
                          </p>
                          {card.ctaLabel && (
                            <div className="mt-2 pt-2 border-t border-slate-200/50 flex items-center justify-between">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded ${currentAccentStyle.cta}`}>
                                {card.ctaLabel}
                                <ArrowRight className="w-2.5 h-2.5" />
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono">
                                {card.ctaUrl || '#'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Form Fields */}
                      <div className="space-y-3">
                        {/* Title with Character Counter (max 80) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold text-slate-700">
                              Title <span className="text-red-500">*</span>
                            </label>
                            <span className={`text-[10px] font-mono ${card.title.length > 70 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                              {card.title.length}/80
                            </span>
                          </div>
                          <input
                            type="text"
                            maxLength={80}
                            value={card.title}
                            onChange={(e) => handleCardFieldChange(slotNumber, 'title', e.target.value)}
                            placeholder="e.g. Scheduled System Maintenance"
                            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                          />
                        </div>

                        {/* Message with Character Counter (max 280) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold text-slate-700">
                              Message <span className="text-red-500">*</span>
                            </label>
                            <span className={`text-[10px] font-mono ${card.message.length > 250 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                              {card.message.length}/280
                            </span>
                          </div>
                          <textarea
                            rows={3}
                            maxLength={280}
                            value={card.message}
                            onChange={(e) => handleCardFieldChange(slotNumber, 'message', e.target.value)}
                            placeholder="e.g. Details regarding this notice..."
                            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                          />
                        </div>

                        {/* Badge with Character Counter (max 20) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold text-slate-700">
                              Badge Pill
                            </label>
                            <span className="text-[10px] font-mono text-slate-400">
                              {(card.badge || '').length}/20
                            </span>
                          </div>
                          <input
                            type="text"
                            maxLength={20}
                            value={card.badge}
                            onChange={(e) => handleCardFieldChange(slotNumber, 'badge', e.target.value.toUpperCase())}
                            placeholder="e.g. RULE, MAINTENANCE, POLICY"
                            className="w-full px-3 py-2 text-xs uppercase font-mono font-bold border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                          />
                        </div>

                        {/* Accent Color Picker */}
                        <div>
                          <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Accent Color
                          </label>
                          <div className="flex items-center gap-2">
                            {(['emerald', 'pink', 'violet', 'amber', 'sky'] as const).map((acc) => {
                              const colorMap: Record<string, string> = {
                                emerald: 'bg-emerald-500 hover:bg-emerald-600',
                                pink: 'bg-pink-500 hover:bg-pink-600',
                                violet: 'bg-violet-500 hover:bg-violet-600',
                                amber: 'bg-amber-500 hover:bg-amber-600',
                                sky: 'bg-sky-500 hover:bg-sky-600',
                              };
                              const isSelected = card.accent === acc;
                              return (
                                <button
                                  key={acc}
                                  type="button"
                                  onClick={() => handleCardFieldChange(slotNumber, 'accent', acc)}
                                  className={`w-7 h-7 rounded-lg ${colorMap[acc]} text-white flex items-center justify-center transition-transform cursor-pointer ${
                                    isSelected ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'opacity-80 hover:opacity-100'
                                  }`}
                                  title={acc}
                                >
                                  {isSelected && <Check className="w-3.5 h-3.5" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Type, Start & End Dates */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              Type
                            </label>
                            <select
                              value={card.badge ? (card.badge.charAt(0).toUpperCase() + card.badge.slice(1).toLowerCase()) : 'Announcement'}
                              onChange={(e) => handleCardFieldChange(slotNumber, 'badge', e.target.value.toUpperCase())}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600] bg-white"
                            >
                              <option value="Announcement">Announcement</option>
                              <option value="Notice">Notice</option>
                              <option value="Alert">Alert</option>
                              <option value="Promo">Promo</option>
                              <option value="Update">Update</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              Start Date
                            </label>
                            <input
                              type="date"
                              value={card.startsAt ? new Date(card.startsAt).toISOString().split('T')[0] : ''}
                              onChange={(e) => handleCardFieldChange(slotNumber, 'startsAt', e.target.value ? new Date(e.target.value).getTime() : null)}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              End Date (Optional)
                            </label>
                            <input
                              type="date"
                              value={card.endsAt ? new Date(card.endsAt).toISOString().split('T')[0] : ''}
                              onChange={(e) => handleCardFieldChange(slotNumber, 'endsAt', e.target.value ? new Date(e.target.value).getTime() : null)}
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                        </div>

                        {/* CTA Label & URL */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              CTA Label (max 24)
                            </label>
                            <input
                              type="text"
                              maxLength={24}
                              value={card.ctaLabel || ''}
                              onChange={(e) => handleCardFieldChange(slotNumber, 'ctaLabel', e.target.value)}
                              placeholder="e.g. Read Rules"
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              CTA URL / Path
                            </label>
                            <input
                              type="text"
                              value={card.ctaUrl || ''}
                              onChange={(e) => handleCardFieldChange(slotNumber, 'ctaUrl', e.target.value)}
                              placeholder="e.g. /groups"
                              className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions Row */}
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>Updated by {card.updatedBy || 'admin'}</span>
                        <span>{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : ''}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveCard(slotNumber)}
                          disabled={isSaving}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTogglePublish(slotNumber, card.status === 'published' || !!card.isPublished)}
                          disabled={isSaving}
                          className={`px-3 py-2 text-xs font-bold rounded-xl transition-colors cursor-pointer border ${
                            (card.status === 'published' || card.isPublished)
                              ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {(card.status === 'published' || card.isPublished) ? 'Unpublish' : 'Publish'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* REVISION HISTORY DRAWER / MODAL */}
      {historySlot !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl border border-slate-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Slot #{historySlot} Revision History
                  </h3>
                  <p className="text-xs text-slate-500">
                    Audit log of previous content revisions and quick rollback.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHistorySlot(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              {loadingHistory ? (
                <div className="text-center py-10 text-xs text-slate-500">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Loading revisions...
                </div>
              ) : historyRevisions.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-500">
                  No revisions recorded for Slot #{historySlot} yet.
                </div>
              ) : (
                historyRevisions.map((rev) => (
                  <div
                    key={rev.id}
                    className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-bold">
                          v{rev.version || rev.snapshot?.version || 1}
                        </span>
                        <span className="font-bold text-slate-900">
                          {rev.updatedBy || rev.changedBy || rev.snapshot?.updatedBy || 'admin'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(rev.timestamp || rev.changedAt || Date.now()).toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-slate-900">{rev.title || rev.snapshot?.title || 'Notice'}</p>
                      <p className="text-[11px] text-slate-600 line-clamp-2 mt-0.5">{rev.message || rev.snapshot?.message || ''}</p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-700 font-mono font-bold rounded">
                          {rev.badge || rev.snapshot?.badge || 'NOTICE'}
                        </span>
                        <span className="capitalize text-slate-500 font-mono">
                          {rev.accent || rev.snapshot?.accent || 'emerald'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRevert(historySlot, rev.id)}
                        disabled={savingSlot === historySlot}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Revert to this
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end shrink-0 mt-3">
              <button
                type="button"
                onClick={() => setHistorySlot(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 mb-4">
            System Security & Group Activity Audit Trail
          </h2>
          <div className="space-y-2 text-xs">
            {(data?.auditLogs || []).map((log) => (
              <div key={log.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-3">
                <span className="font-mono text-[10px] text-slate-400 shrink-0 mt-0.5">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="font-bold text-indigo-700 shrink-0 font-mono text-[11px]">
                  {log.action}
                </span>
                <div className="flex-1 text-slate-700">
                  <span className="font-semibold text-slate-900">{log.actorName}:</span> {log.details}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: MERCHANT VERIFICATIONS (Part C & G) */}
      {activeTab === 'verifications' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Merchant Verification & Physical Shop Inspection
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review merchant applications, schedule field inspections, record advert banner installations, and grant written exemptions.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">
                  Total Records: {verificationsList.length}
                </span>
              </div>
            </div>

            {verificationsList.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <Shield className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No merchant verification applications submitted yet.
              </div>
            ) : (
              <div className="space-y-4">
                {verificationsList.map((verif) => (
                  <div
                    key={verif.merchantId}
                    className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <b className="text-sm text-slate-900">{verif.shopName || verif.merchantName}</b>
                          <span className="text-xs text-slate-500 font-mono">#{verif.merchantId}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              verif.status === 'verified'
                                ? 'bg-emerald-100 text-emerald-800'
                                : verif.status === 'declined'
                                ? 'bg-red-100 text-red-800'
                                : verif.status === 'visit_scheduled'
                                ? 'bg-blue-100 text-blue-800'
                                : verif.status === 'visit_completed'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {verif.status?.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Owner: {verif.merchantName} · Phone: {verif.phone} · Category: {verif.businessType}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {verif.status === 'pending_review' && (
                          <button
                            onClick={() =>
                              setScheduleModal({
                                open: true,
                                merchantId: verif.merchantId,
                                scheduledDate: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
                                representative: 'Buyoll Field Operations Team',
                              })
                            }
                            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                          >
                            Schedule Visit
                          </button>
                        )}

                        {verif.status === 'visit_scheduled' && (
                          <button
                            onClick={() =>
                              setCompleteVisitModal({
                                open: true,
                                merchantId: verif.merchantId,
                                notes: 'Physical premises verified; stock inspected.',
                                advertInstalled: true,
                                photoUrl: 'https://images.unsplash.com/photo-1555421689-491a97ff2040?auto=format&fit=crop&w=600&q=80',
                              })
                            }
                            className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                          >
                            Record Visit & Advert
                          </button>
                        )}

                        <button
                          onClick={() =>
                            setExemptionModal({
                              open: true,
                              merchantId: verif.merchantId,
                              requirement: 'three_years_operating',
                              reason: '',
                            })
                          }
                          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          Grant Exemption
                        </button>

                        {verif.status !== 'verified' && (
                          <button
                            onClick={() => handleVerificationDecision(verif.merchantId, 'verify')}
                            disabled={processingId === `dec_${verif.merchantId}`}
                            className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verify (Badge)</span>
                          </button>
                        )}

                        {verif.status !== 'declined' && (
                          <button
                            onClick={() => handleVerificationDecision(verif.merchantId, 'decline')}
                            disabled={processingId === `dec_${verif.merchantId}`}
                            className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                          >
                            Decline
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">Premises & Documents</span>
                        <div className="text-slate-900 mt-1">
                          <b>Physical Store:</b> {verif.hasPhysicalShop ? 'Yes (Walk-in)' : 'No (Online/Warehouse)'}
                        </div>
                        <div className="text-slate-700 mt-0.5">
                          <b>Location:</b> {verif.shopLocation || 'N/A'}
                        </div>
                        <div className="text-slate-700 mt-0.5">
                          <b>Trading Licence:</b> <span className="font-mono">{verif.tradingLicenceNumber}</span>
                        </div>
                        <div className="text-slate-700 mt-0.5">
                          <b>National ID:</b> <span className="font-mono">{verif.nationalIdOrPassport}</span>
                        </div>
                        <div className="text-slate-700 mt-0.5">
                          <b>Years Operating:</b> {verif.yearsOperating} year(s)
                        </div>
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">Field Inspection</span>
                        {verif.shopVisitScheduledAt && (
                          <div className="text-slate-800 mt-1">
                            <b>Visit Scheduled:</b> {new Date(verif.shopVisitScheduledAt).toLocaleDateString()}
                          </div>
                        )}
                        {verif.shopVisitRepresentative && (
                          <div className="text-slate-600 mt-0.5">
                            <b>Field Officer:</b> {verif.shopVisitRepresentative}
                          </div>
                        )}
                        {verif.shopVisitNotes && (
                          <div className="text-slate-600 mt-0.5 italic">
                            "{verif.shopVisitNotes}"
                          </div>
                        )}
                        {verif.advertInstalledAt && (
                          <div className="text-emerald-700 font-bold mt-1 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>Buyoll Advert Photo Installed</span>
                          </div>
                        )}
                      </div>

                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] font-bold uppercase">Exemptions Granted ({verif.exemptions?.length || 0})</span>
                        {(verif.exemptions || []).length === 0 ? (
                          <div className="text-slate-400 mt-1 italic">No exemptions granted.</div>
                        ) : (
                          <div className="space-y-1 mt-1">
                            {verif.exemptions.map((ex: any, idx: number) => (
                              <div key={idx} className="p-1.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                                <b>{ex.requirement}:</b> {ex.reason}
                                <span className="block text-[9px] text-amber-700 mt-0.5">By {ex.grantedBy}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 8: MERCHANT SUBSCRIPTIONS & TIERS (Part C & D) */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Merchant Subscriptions & 6-Tier Catalog Management
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Review active 30-day subscriptions, reconcile manual M-Pesa payments, and manage custom Enterprise tier pricing.
                </p>
              </div>
            </div>

            {/* 6-Tier Reference Matrix */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-6">
              {[
                { name: 'Tier 1 (KES 250)', prods: 'Max 2 Prods', grps: '2 Grps / Prod' },
                { name: 'Tier 2 (KES 500)', prods: 'Max 10 Prods', grps: '5 Grps / Prod' },
                { name: 'Tier 3 (KES 1,500)', prods: 'Max 50 Prods', grps: '10 Grps / Prod' },
                { name: 'Tier 4 (KES 3,500)', prods: 'Max 100 Prods', grps: '30 Grps / Prod' },
                { name: 'Tier 5 (KES 7,500)', prods: 'Unlimited Prods', grps: '50 Grps / Prod' },
                { name: 'Enterprise', prods: 'Unlimited Prods', grps: 'Up to 100 Grps' },
              ].map((t, idx) => (
                <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div className="font-bold text-xs text-slate-900">{t.name}</div>
                  <div className="text-[10px] text-emerald-800 font-semibold mt-0.5">{t.prods}</div>
                  <div className="text-[10px] text-slate-500">{t.grps}</div>
                </div>
              ))}
            </div>

            {/* Subscriptions Table */}
            {subscriptionsList.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                No merchant subscriptions logged yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Merchant</th>
                      <th className="py-2.5 px-3">Tier</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Code / Ref</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Dates (Active)</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subscriptionsList.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-3">
                          <b className="text-slate-900 block">{sub.shopName || sub.merchantName}</b>
                          <span className="text-[10px] text-slate-500 font-mono">#{sub.merchantId} · {sub.phone}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-slate-900">{sub.tierName}</span>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-[#ff6600]">
                          KSh {Number(sub.amount || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-semibold">
                            {sub.paymentMethod === 'wallet_credit'
                              ? 'Merchant Wallet (KES)'
                              : sub.paymentMethod === 'wallet_coins'
                              ? 'Wallet Coins'
                              : 'M-Pesa Till/Paybill'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono font-bold uppercase text-slate-800">
                          {sub.paymentCode || 'ATOMIC'}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              sub.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : sub.status === 'pending'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {sub.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[11px] text-slate-600">
                          {sub.startDate ? (
                            <div>
                              <span>{new Date(sub.startDate).toLocaleDateString()}</span>
                              <span className="text-slate-400"> → </span>
                              <b>{new Date(sub.expiresAt).toLocaleDateString()}</b>
                            </div>
                          ) : (
                            <span className="text-slate-400">Pending Activation</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {sub.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApproveSubscription(sub.id)}
                                  disabled={processingId === sub.id}
                                  className="px-3 py-1 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {processingId === sub.id ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Approving...</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>Approve (30d)</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() => handleOpenRejectSubscription(sub)}
                                  disabled={processingId === sub.id}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1 disabled:opacity-50"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}

                            {sub.tierId === 'enterprise' && (
                              <button
                                onClick={() =>
                                  setEnterprisePriceModal({
                                    open: true,
                                    merchantId: sub.merchantId,
                                    price: sub.amount || 15000,
                                  })
                                }
                                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg cursor-pointer"
                              >
                                Set Custom Price
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 9: FEATURED PRODUCTS (Part E & G) */}
      {activeTab === 'featured' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  Featured Products Showcase & Announcement System
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Announcements are free and broadcasted to private user profiles. Featured placement on the homepage banner carries a fee of <b>KES 30 / day</b>.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-[#ff6600] text-white text-[10px] font-black uppercase rounded">
                    Free
                  </span>
                  <b className="text-xs text-[#ff6600]">System Announcements</b>
                </div>
                <p className="text-xs text-slate-600 leading-normal">
                  Free of charge. When posted by admin or merchant, updates fan out automatically to all members' private notification center in their customer portal.
                </p>
              </div>

              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-black uppercase rounded">
                    KES 30 / Day
                  </span>
                  <b className="text-xs text-amber-900">Featured Listing Placements</b>
                </div>
                <p className="text-xs text-slate-600 leading-normal">
                  Merchants pay KES 30/day via wallet coins or M-Pesa. Featured items appear in the hero showcase carousel with top priority across Group searches.
                </p>
              </div>
            </div>

            {/* Products List & Toggle */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">Price</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Merchant ID</th>
                    <th className="py-2.5 px-3">Featured Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allProductsList.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 flex items-center gap-2.5">
                        <img
                          src={prod.image || './images/smart_tv.jpg'}
                          alt={prod.title}
                          className="w-10 h-10 object-cover rounded-lg border border-slate-200 shrink-0"
                        />
                        <div>
                          <b className="text-slate-900 block">{prod.title}</b>
                          <span className="text-[10px] text-slate-500">{prod.chamaOptions || 'Standard Speed'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                        KSh {Number(prod.price || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 capitalize">{prod.category}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600">Vendor #{prod.vendorId}</td>
                      <td className="py-2.5 px-3">
                        {prod.isFeatured ? (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-600" />
                            <span>Featured (KES 30/day)</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Standard</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleToggleFeatured(prod.id)}
                          disabled={processingId === `feat_${prod.id}`}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                            prod.isFeatured
                              ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                              : 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                          }`}
                        >
                          {prod.isFeatured ? 'Demote to Standard' : 'Promote to Featured'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE VISIT MODAL */}
      {scheduleModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleScheduleVisitSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-3">Schedule Shop Verification Visit</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Visit Date</label>
                <input
                  type="date"
                  required
                  value={scheduleModal.scheduledDate}
                  onChange={(e) => setScheduleModal({ ...scheduleModal, scheduledDate: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Field Representative Name</label>
                <input
                  type="text"
                  required
                  value={scheduleModal.representative}
                  onChange={(e) => setScheduleModal({ ...scheduleModal, representative: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScheduleModal({ ...scheduleModal, open: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-blue-700 text-white text-xs font-bold rounded-xl"
              >
                Confirm Schedule
              </button>
            </div>
          </form>
        </div>
      )}

      {/* COMPLETE VISIT MODAL */}
      {completeVisitModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleCompleteVisitSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-3">Record Shop Inspection & Advert</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Field Inspection Report / Notes</label>
                <textarea
                  rows={3}
                  required
                  value={completeVisitModal.notes}
                  onChange={(e) => setCompleteVisitModal({ ...completeVisitModal, notes: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs text-slate-800 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={completeVisitModal.advertInstalled}
                    onChange={(e) => setCompleteVisitModal({ ...completeVisitModal, advertInstalled: e.target.checked })}
                  />
                  <span>Official Buyoll Advert Poster Installed in Shop</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Advert Evidence Photo URL</label>
                <input
                  type="text"
                  value={completeVisitModal.photoUrl}
                  onChange={(e) => setCompleteVisitModal({ ...completeVisitModal, photoUrl: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCompleteVisitModal({ ...completeVisitModal, open: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-700 text-white text-xs font-bold rounded-xl"
              >
                Save Inspection Record
              </button>
            </div>
          </form>
        </div>
      )}

      {/* GRANT EXEMPTION MODAL WITH MANDATORY REASON */}
      {exemptionModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleGrantExemptionSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-2">Grant Policy Exemption</h3>
            <p className="text-xs text-slate-500 mb-4">
              A written justification reason is <b>mandatory</b> and permanently recorded in the system audit trail.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Requirement to Exempt</label>
                <select
                  value={exemptionModal.requirement}
                  onChange={(e) => setExemptionModal({ ...exemptionModal, requirement: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                >
                  <option value="three_years_operating">3-Year Operating History (Exemption)</option>
                  <option value="physical_premises">Ground Floor Walk-in Shop (Exemption)</option>
                  <option value="county_licence">Annual County Trade Licence (Exemption)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Written Justification Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Enter detailed reason for granting exemption..."
                  value={exemptionModal.reason}
                  onChange={(e) => setExemptionModal({ ...exemptionModal, reason: e.target.value })}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExemptionModal({ ...exemptionModal, open: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-amber-600 text-white text-xs font-bold rounded-xl"
              >
                Grant Exemption
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 12: ACCOUNT SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-4xl">
          {/* Header Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#fff4ec] text-[#ff6600] flex items-center justify-center font-bold">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Administrator Account & Security Settings
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update your display name, administrative username, and secure password.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-emerald-100 text-[#ff6600] text-xs font-extrabold rounded-full">
                Single Platform Administrator
              </span>
            </div>
          </div>

          {/* Feedback Notice */}
          {settingsNotice && (
            <div
              className={`p-4 rounded-xl text-xs flex items-start gap-3 border ${
                settingsNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {settingsNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <p className="font-medium leading-relaxed">{settingsNotice.text}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Administrator Profile Details */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <UserCheck className="w-4 h-4 text-[#ff6600]" />
                  <h3 className="text-sm font-bold text-slate-900">Administrator Identity</h3>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Display Name / Username
                    </label>
                    <input
                      type="text"
                      required
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      placeholder="e.g. Buyoll Lead Admin"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Appears on audit records, announcement revisions, and system notices.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Administrator Email
                    </label>
                    <input
                      type="email"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="e.g. admin@buyoll.com"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Used for signing in to the private administrator portal.
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="w-full py-2.5 px-4 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingSettings ? 'Saving...' : 'Save Profile Changes'}</span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-500">
                <p className="font-semibold text-slate-700">Account Security Note:</p>
                <p className="mt-0.5">
                  Platform policy strictly guarantees exactly one administrator account. Registration cannot be reopened.
                </p>
              </div>
            </div>

            {/* Card 2: Password Update with Live Strength Meter */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <Lock className="w-4 h-4 text-[#ff6600]" />
                  <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
                </div>

                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Current Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      New Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />

                    {/* Live Strength Meter */}
                    {newPassword && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Password strength:</span>
                          <span className={`font-bold ${getPasswordStrength(newPassword).textCol}`}>
                            {getPasswordStrength(newPassword).label}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${getPasswordStrength(newPassword).color}`}
                            style={{ width: getPasswordStrength(newPassword).width }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Confirm New Password <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                    {confirmPassword && confirmPassword !== newPassword && (
                      <p className="text-[11px] text-red-500 mt-1">Passwords do not match.</p>
                    )}
                    {confirmPassword && confirmPassword === newPassword && (
                      <p className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Passwords match!
                      </p>
                    )}
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingSettings || !currentPassword || !newPassword || newPassword !== confirmPassword}
                      className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{savingSettings ? 'Changing Password...' : 'Update Password'}</span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">End active session:</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm('Log out of administrator session?')) {
                      try { await api.logout(); } catch {}
                      localStorage.removeItem('buyoll_auth_user');
                      onNavigate('admin-portal');
                      onNotify('info', 'Logged out.');
                    }
                  }}
                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Log Out</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ENTERPRISE PRICE MODAL */}
      {enterprisePriceModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleSetEnterprisePriceSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-2">Set Custom Enterprise Pricing</h3>
            <p className="text-xs text-slate-500 mb-4">
              Agree on custom monthly subscription pricing for merchant #{enterprisePriceModal.merchantId}.
            </p>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Agreed Monthly Fee (KES)</label>
              <input
                type="number"
                min={0}
                step={500}
                required
                value={enterprisePriceModal.price}
                onChange={(e) => setEnterprisePriceModal({ ...enterprisePriceModal, price: Number(e.target.value) })}
                className="w-full text-xs p-2.5 border border-slate-200 rounded-xl font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEnterprisePriceModal({ ...enterprisePriceModal, open: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl"
              >
                Save Agreed Price
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REJECT SUBSCRIPTION REQUEST MODAL */}
      {subRejectModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleConfirmRejectSubscription} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Reject Subscription Request</h3>
                  <p className="text-xs text-slate-500">Provide an audit reason for the merchant</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubRejectModal({ ...subRejectModal, open: false })}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 text-xs space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Merchant:</span>
                <span className="font-bold text-slate-900">{subRejectModal.merchantName}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Plan requested:</span>
                <span className="font-bold text-[#ff6600]">{subRejectModal.planName}</span>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={subRejectModal.reason}
                onChange={(e) => setSubRejectModal({ ...subRejectModal, reason: e.target.value })}
                placeholder="e.g. M-Pesa code not found in statement or already claimed."
                className="w-full text-xs p-3 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-rose-500 resize-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                This reason will be recorded in the audit log and sent to the merchant's dashboard notifications.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubRejectModal({ ...subRejectModal, open: false })}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={processingId === subRejectModal.subId || !subRejectModal.reason.trim()}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {processingId === subRejectModal.subId ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Rejecting...</span>
                  </>
                ) : (
                  <span>Confirm Rejection</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: VERIFY MERCHANT */}
      {verifyingUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Verify Merchant Store</h3>
              </div>
              <button onClick={() => setVerifyingUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Verifying <b>{verifyingUser.name}</b> ({verifyingUser.shopName || 'Shop'}) grants them the official <b>Verified Merchant</b> badge, allows group launching, and boosts trust across member searches.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Verification Audit Notes
                </label>
                <textarea
                  rows={3}
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                  placeholder="e.g. Physical inventory verified; tax and business permit documentation on file."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setVerifyingUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={submitUserVerification}
                disabled={processingId === verifyingUser.id}
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Confirm Verification
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AWARD MERIT POINTS */}
      {pointsUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900">Award Member Points</h3>
              </div>
              <button onClick={() => setPointsUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Rewarding points directly increases <b>{pointsUser.name}</b>'s credit standing and Group trustworthiness score.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Points to Credit
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={pointsAmount}
                  onChange={(e) => setPointsAmount(Number(e.target.value))}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason / Citation
                </label>
                <input
                  type="text"
                  value={pointsReason}
                  onChange={(e) => setPointsReason(e.target.value)}
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                  placeholder="e.g. Completed 10-day cycle with zero missed contributions."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPointsUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={submitAwardPoints}
                disabled={processingId === pointsUser.id}
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                Award Points
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
