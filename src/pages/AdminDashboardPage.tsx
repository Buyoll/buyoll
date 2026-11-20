import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  PaymentRecord,
  RefundRequest,
  AuditLog,
  MpesaStatementRecord,
  ChatModerationEvent,
  WalletDepositRequest,
  PlatformAnnouncementSlot,
  PlatformAnnouncementRevision,
} from '../types.ts';
import { api, AdminControlCenterSummary, AdminPaginationMeta } from '../api.ts';
import { useUser } from '../context/UserContext.tsx';
import { lazyWithChunkRetry } from '../components/AdminErrorBoundary.tsx';

const AdminAnnouncementsManager = lazyWithChunkRetry(() =>
  import('../components/AdminAnnouncementsManager.tsx').then((m) => ({
    default: m.AdminAnnouncementsManager,
  }))
);
const AdminFeaturedModeration = lazyWithChunkRetry(() =>
  import('../components/AdminFeaturedModeration.tsx').then((m) => ({
    default: m.AdminFeaturedModeration,
  }))
);
const AdminWalletPanel = lazyWithChunkRetry(() =>
  import('../components/AdminWalletPanel.tsx').then((m) => ({
    default: m.AdminWalletPanel,
  }))
);
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
  ArrowRight,
  KeyRound,
  LogOut,
  Lock,
  Loader2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Activity,
} from 'lucide-react';

interface AdminDashboardPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  initialTab?: AdminTabKey;
}

export type AdminTabKey =
  | 'wallet'
  | 'payments'
  | 'deposits'
  | 'wallets'
  | 'users'
  | 'moderation'
  | 'refunds'
  | 'audit'
  | 'verifications'
  | 'subscriptions'
  | 'featured'
  | 'announcements'
  | 'settings';

type PaginatedSectionKey =
  | 'payments'
  | 'deposits'
  | 'wallets'
  | 'users'
  | 'moderation'
  | 'refunds'
  | 'verifications'
  | 'subscriptions'
  | 'featured'
  | 'audit';

interface SectionStatus {
  loading: boolean;
  error: string | null;
  loaded: boolean;
  pagination: AdminPaginationMeta | null;
}

const DEFAULT_PAGE_LIMIT = 20;

const INITIAL_SECTION_STATUS: SectionStatus = {
  loading: false,
  error: null,
  loaded: false,
  pagination: null,
};

function createInitialSectionStates(): Record<PaginatedSectionKey, SectionStatus> {
  return {
    payments: { ...INITIAL_SECTION_STATUS },
    deposits: { ...INITIAL_SECTION_STATUS },
    wallets: { ...INITIAL_SECTION_STATUS },
    users: { ...INITIAL_SECTION_STATUS },
    moderation: { ...INITIAL_SECTION_STATUS },
    refunds: { ...INITIAL_SECTION_STATUS },
    verifications: { ...INITIAL_SECTION_STATUS },
    subscriptions: { ...INITIAL_SECTION_STATUS },
    featured: { ...INITIAL_SECTION_STATUS },
    audit: { ...INITIAL_SECTION_STATUS },
  };
}

const PaginationBar: React.FC<{
  pagination: AdminPaginationMeta | null;
  loading?: boolean;
  onPageChange: (nextPage: number) => void;
}> = ({ pagination, loading, onPageChange }) => {
  if (!pagination || pagination.total === 0) return null;
  const { page, totalPages, total, limit } = pagination;
  const startIdx = (page - 1) * limit + 1;
  const endIdx = Math.min(page * limit, total);

  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
      <span className="text-slate-600 font-medium">
        Showing <b>{startIdx}</b>–<b>{endIdx}</b> of <b>{total.toLocaleString()}</b> records (Page {page} of {totalPages})
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={loading || page <= 1}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Previous</span>
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={loading || page >= totalPages}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <span>Next</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const SectionErrorBanner: React.FC<{
  title: string;
  message: string;
  onRetry: () => void;
}> = ({ title, message, onRetry }) => (
  <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-3">
    <AlertTriangle className="w-7 h-7 text-red-600 mx-auto" />
    <div>
      <h3 className="text-sm font-bold text-red-900">{title}</h3>
      <p className="text-xs text-red-700 mt-1 max-w-md mx-auto">{message}</p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
    >
      <RefreshCw className="w-3.5 h-3.5" />
      <span>Retry</span>
    </button>
  </div>
);

const SectionTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-12 bg-slate-100 rounded-xl" />
    ))}
  </div>
);

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  currentUser,
  onNavigate,
  onNotify,
  initialTab,
}) => {
  const isAdmin = currentUser?.activeRole === 'admin' || currentUser?.role === 'admin';
  const { logoutRole } = useUser();

  const [activeTab, setActiveTab] = useState<AdminTabKey>(initialTab || 'payments');
  const [processingId, setProcessingId] = useState<number | string | null>(null);
  const [exportingCsvType, setExportingCsvType] = useState<'wallets' | 'users' | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Lightweight KPI Summary State
  const [summary, setSummary] = useState<AdminControlCenterSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Per-section independent state & pagination (20 rows per page)
  const [sectionStates, setSectionStates] = useState<Record<PaginatedSectionKey, SectionStatus>>(
    createInitialSectionStates
  );
  const inFlightSectionsRef = useRef<Partial<Record<PaginatedSectionKey, boolean>>>({});
  const heroCardsLoadedRef = useRef(false);
  const securityLoadedRef = useRef(false);

  // Payments Queue state
  const [paymentsList, setPaymentsList] = useState<PaymentRecord[]>([]);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');

  // Refunds & Audit state
  const [refundsList, setRefundsList] = useState<RefundRequest[]>([]);
  const [auditLogsList, setAuditLogsList] = useState<AuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditAfterDate, setAuditAfterDate] = useState('');
  const [auditBeforeDate, setAuditBeforeDate] = useState('');

  // Mandatory reason modal for rejections / declines (zero window.prompt)
  const [declineReasonModal, setDeclineReasonModal] = useState<{
    open: boolean;
    kind: 'deposit' | 'payment' | 'refund' | 'verification';
    targetId: number | string;
    title: string;
    subtitle: string;
    reason: string;
  }>({
    open: false,
    kind: 'deposit',
    targetId: '',
    title: '',
    subtitle: '',
    reason: '',
  });

  // Settings & Security State
  const [adminName, setAdminName] = useState(currentUser?.name || 'Administrator');
  const [adminEmail, setAdminEmail] = useState(currentUser?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPasskeyInput, setCurrentPasskeyInput] = useState('');
  const [newPasskeyInput, setNewPasskeyInput] = useState('');
  const [confirmPasskeyInput, setConfirmPasskeyInput] = useState('');
  const [savingPasskey, setSavingPasskey] = useState(false);
  const [adminSecurity, setAdminSecurity] = useState<{
    username: string;
    email: string;
    mustChangeCredentials: boolean;
    lastPasswordChangedAt: number | null;
    lastPasskeyChangedAt: number | null;
    showSecurityBanner: boolean;
    recentReauthValid: boolean;
  } | null>(null);
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
      balance?: number;
      credit?: number;
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

  // Merchant Verifications state
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

  // Merchant Subscriptions state
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

  // Hero Announcements Editor State
  const [adminHeroCards, setAdminHeroCards] = useState<PlatformAnnouncementSlot[]>([]);
  const [loadingHeroCards, setLoadingHeroCards] = useState(false);
  const [heroCardsError, setHeroCardsError] = useState<string | null>(null);
  const [savingSlot, setSavingSlot] = useState<number | null>(null);
  const [historySlot, setHistorySlot] = useState<number | null>(null);
  const [historyRevisions, setHistoryRevisions] = useState<PlatformAnnouncementRevision[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Below-the-fold lazy IntersectionObserver ref for recent audit activity
  const activityViewportRef = useRef<HTMLDivElement | null>(null);

  // Refs for latest filter values to keep loadSection stable and loop-free
  const filtersRef = useRef({
    paymentStatusFilter,
    walletSearch,
    userSearch,
    roleFilter,
    auditSearch,
    auditActionFilter,
    auditAfterDate,
    auditBeforeDate,
  });
  filtersRef.current = {
    paymentStatusFilter,
    walletSearch,
    userSearch,
    roleFilter,
    auditSearch,
    auditActionFilter,
    auditAfterDate,
    auditBeforeDate,
  };

  const loadSummary = useCallback(async (forceRefresh = false) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await api.getAdminControlCenterSummary(forceRefresh);
      setSummary(res);
    } catch (err: any) {
      setSummaryError(err?.message || 'Unable to load platform summary metrics.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadSecuritySettings = useCallback(async () => {
    if (securityLoadedRef.current) return;
    try {
      const secRes = await api.getAdminSecuritySettings();
      securityLoadedRef.current = true;
      setAdminSecurity(secRes);
      if (secRes?.email) setAdminEmail(secRes.email);
    } catch {
      // Non-blocking background metadata
    }
  }, []);

  const loadSection = useCallback(
    async (
      section: PaginatedSectionKey,
      options: {
        page?: number;
        force?: boolean;
        statusOverride?: string;
        searchOverride?: string;
        roleOverride?: string;
        actionOverride?: string;
        afterOverride?: string;
        beforeOverride?: string;
      } = {}
    ) => {
      if (inFlightSectionsRef.current[section] && !options.force) return;
      inFlightSectionsRef.current[section] = true;
      const targetPage = options.page ?? 1;

      setSectionStates((prev) => ({
        ...prev,
        [section]: { ...prev[section], loading: true, error: null },
      }));

      try {
        const f = filtersRef.current;
        if (section === 'payments') {
          const status = options.statusOverride ?? f.paymentStatusFilter;
          const res = await api.getAdminPayments({
            page: targetPage,
            limit: DEFAULT_PAGE_LIMIT,
            status,
          });
          setPaymentsList(res.payments || []);
          setSectionStates((prev) => ({
            ...prev,
            payments: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'deposits') {
          const res = await api.getAdminWalletDeposits({ page: targetPage, limit: DEFAULT_PAGE_LIMIT });
          setWalletDeposits(res.deposits || []);
          setSectionStates((prev) => ({
            ...prev,
            deposits: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'wallets') {
          const search = options.searchOverride !== undefined ? options.searchOverride : f.walletSearch;
          const res = await api.getAdminWallets({
            page: targetPage,
            limit: DEFAULT_PAGE_LIMIT,
            search: search.trim() || undefined,
          });
          setWalletsData({
            summary: {
              totalCredit: res.summary?.totalCredit || 0,
              totalCoins: res.summary?.totalCoins || 0,
              totalPoints: res.summary?.totalPoints || 0,
              totalUsers: res.summary?.totalUsers || res.summary?.userCount || 0,
            },
            wallets: res.wallets || [],
          });
          setSectionStates((prev) => ({
            ...prev,
            wallets: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'users') {
          const search = options.searchOverride !== undefined ? options.searchOverride : f.userSearch;
          const role = options.roleOverride !== undefined ? options.roleOverride : f.roleFilter;
          const res = await api.getAdminUsers({
            page: targetPage,
            limit: DEFAULT_PAGE_LIMIT,
            search: search.trim() || undefined,
            role: role && role !== 'all' ? role : undefined,
          });
          setUsersList(res.users || []);
          setSectionStates((prev) => ({
            ...prev,
            users: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'moderation') {
          const res = await api.getAdminChatLogs({ page: targetPage, limit: DEFAULT_PAGE_LIMIT });
          const recent =
            res.recentChats ||
            (res.logs || []).map((l: any) => ({
              groupId: l.groupId || 1,
              groupName: l.groupName || 'Group',
              messageId: l.id || `msg_${l.timestamp}`,
              senderId: l.senderId || 0,
              senderName: l.senderName || 'Member',
              text: l.text || '',
              timestamp: l.timestamp || Date.now(),
              isFlagged: l.isFlagged,
            })) ||
            [];
          setChatLogs({
            moderationEvents: res.moderationEvents || res.moderationActions || [],
            recentChats: recent,
          });
          setSectionStates((prev) => ({
            ...prev,
            moderation: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'refunds') {
          const res = await api.getAdminRefunds({ page: targetPage, limit: DEFAULT_PAGE_LIMIT });
          setRefundsList(res.refundRequests || []);
          setSectionStates((prev) => ({
            ...prev,
            refunds: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'verifications') {
          const res = await api.getAdminMerchantVerifications({ page: targetPage, limit: DEFAULT_PAGE_LIMIT });
          setVerificationsList(res.verifications || []);
          setSectionStates((prev) => ({
            ...prev,
            verifications: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'subscriptions') {
          const res = await api.getAdminMerchantSubscriptions({ page: targetPage, limit: DEFAULT_PAGE_LIMIT });
          setSubscriptionsList(res.subscriptions || []);
          setSectionStates((prev) => ({
            ...prev,
            subscriptions: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        } else if (section === 'featured') {
          setSectionStates((prev) => ({
            ...prev,
            featured: { loading: false, error: null, loaded: true, pagination: null },
          }));
        } else if (section === 'audit') {
          const searchVal = options.searchOverride !== undefined ? options.searchOverride : f.auditSearch;
          const actionVal = options.actionOverride !== undefined ? options.actionOverride : f.auditActionFilter;
          const afterStr = options.afterOverride !== undefined ? options.afterOverride : f.auditAfterDate;
          const beforeStr = options.beforeOverride !== undefined ? options.beforeOverride : f.auditBeforeDate;
          const afterMs = afterStr ? new Date(`${afterStr}T00:00:00+03:00`).getTime() : undefined;
          const beforeMs = beforeStr ? new Date(`${beforeStr}T23:59:59.999+03:00`).getTime() : undefined;
          const res = await api.getAdminAuditLogs({
            page: targetPage,
            limit: DEFAULT_PAGE_LIMIT,
            search: searchVal.trim() || undefined,
            action: actionVal.trim() || undefined,
            after: Number.isFinite(afterMs) ? afterMs : undefined,
            before: Number.isFinite(beforeMs) ? beforeMs : undefined,
          });
          setAuditLogsList(res.auditLogs || []);
          setSectionStates((prev) => ({
            ...prev,
            audit: { loading: false, error: null, loaded: true, pagination: res.pagination || null },
          }));
        }
      } catch (err: any) {
        const msg = err?.message || `Failed to load ${section} data.`;
        setSectionStates((prev) => ({
          ...prev,
          [section]: { ...prev[section], loading: false, error: msg },
        }));
      } finally {
        inFlightSectionsRef.current[section] = false;
      }
    },
    []
  );

  const loadAdminHeroCards = useCallback(async () => {
    setLoadingHeroCards(true);
    setHeroCardsError(null);
    try {
      const res = await api.getAdminHeroAnnouncementCards();
      heroCardsLoadedRef.current = true;
      setAdminHeroCards(res.cards || []);
    } catch (err: any) {
      const msg = err?.message || 'Failed to load announcement cards';
      setHeroCardsError(msg);
      onNotify('error', msg);
    } finally {
      setLoadingHeroCards(false);
    }
  }, [onNotify]);

  // Initial lightweight boot: Summary + Security Settings (and active section only when needed)
  useEffect(() => {
    if (!isAdmin) return;
    void Promise.allSettled([
      loadSummary(false),
      loadSecuritySettings(),
    ]);
  }, [isAdmin, loadSummary, loadSecuritySettings]);

  // Lazy load each tab when opened for the first time
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'wallet') return;
    if (activeTab === 'announcements') {
      if (!heroCardsLoadedRef.current) {
        void loadAdminHeroCards();
      }
      return;
    }
    if (activeTab === 'settings') {
      void loadSecuritySettings();
      return;
    }
    const status = sectionStates[activeTab];
    if (status && !status.loaded && !status.loading && !inFlightSectionsRef.current[activeTab]) {
      void loadSection(activeTab, { page: 1 });
    }
  }, [isAdmin, activeTab, sectionStates, loadSection, loadAdminHeroCards, loadSecuritySettings]);

  // Lazy-load recent audit activity snapshot when below-the-fold panel scrolls into view
  useEffect(() => {
    if (!isAdmin) return;
    const node = activityViewportRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          if (!sectionStates.audit.loaded && !inFlightSectionsRef.current.audit) {
            void loadSection('audit', { page: 1 });
          }
          observer.disconnect();
        }
      },
      { rootMargin: '120px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isAdmin, sectionStates.audit.loaded, loadSection]);

  // Debounced backend search for Users tab
  useEffect(() => {
    if (!isAdmin || activeTab !== 'users' || !sectionStates.users.loaded) return;
    const t = setTimeout(() => {
      void loadSection('users', { page: 1, force: true, searchOverride: userSearch, roleOverride: roleFilter });
    }, 250);
    return () => clearTimeout(t);
  }, [userSearch, roleFilter, activeTab, isAdmin]);

  // Debounced backend search for Wallets tab
  useEffect(() => {
    if (!isAdmin || activeTab !== 'wallets' || !sectionStates.wallets.loaded) return;
    const t = setTimeout(() => {
      void loadSection('wallets', { page: 1, force: true, searchOverride: walletSearch });
    }, 250);
    return () => clearTimeout(t);
  }, [walletSearch, activeTab, isAdmin]);

  const refreshActiveView = useCallback(async () => {
    const tasks: Array<Promise<any>> = [loadSummary(true)];
    if (activeTab === 'announcements') {
      tasks.push(loadAdminHeroCards());
    } else if (activeTab === 'settings') {
      securityLoadedRef.current = false;
      tasks.push(loadSecuritySettings());
    } else if (activeTab !== 'wallet') {
      const currentPage = sectionStates[activeTab]?.pagination?.page || 1;
      tasks.push(loadSection(activeTab, { page: currentPage, force: true }));
    }
    await Promise.allSettled(tasks);
  }, [activeTab, loadSummary, loadAdminHeroCards, loadSecuritySettings, loadSection, sectionStates]);

  async function handleAsyncCsvExport(type: 'wallets' | 'users') {
    setExportingCsvType(type);
    try {
      await api.runAsyncCsvDownload(type);
      onNotify('success', `${type === 'wallets' ? 'Wallets' : 'Users'} CSV exported successfully.`);
    } catch (err: any) {
      onNotify('error', err?.message || `Failed to export ${type} CSV`);
    } finally {
      setExportingCsvType(null);
    }
  }

  // Handle Wallet Deposit Decision
  async function handleDepositDecision(depositId: string, action: 'approve' | 'decline', label?: string) {
    if (action === 'decline') {
      setDeclineReasonModal({
        open: true,
        kind: 'deposit',
        targetId: depositId,
        title: 'Decline Wallet Deposit',
        subtitle: label || `Deposit #${depositId}`,
        reason: '',
      });
      return;
    }
    setProcessingId(depositId);
    try {
      const res = await api.decideWalletDeposit(depositId, { action });
      onNotify('success', res.message || `Deposit request approved!`);
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process deposit request');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Payment Decision
  async function handlePaymentDecision(paymentId: number, decision: 'approve' | 'reject', label?: string) {
    if (decision === 'reject') {
      setDeclineReasonModal({
        open: true,
        kind: 'payment',
        targetId: paymentId,
        title: 'Decline M-Pesa Payment Submission',
        subtitle: label || `Payment #${paymentId}`,
        reason: '',
      });
      return;
    }
    setProcessingId(paymentId);
    try {
      const res = await api.adminDecidePayment(paymentId, decision);
      onNotify('success', res.message || `Payment #${paymentId} approved`);
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process payment');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Refund Status
  async function handleRefundStatus(refundId: number, status: string, label?: string) {
    if (status === 'rejected') {
      setDeclineReasonModal({
        open: true,
        kind: 'refund',
        targetId: refundId,
        title: 'Reject Refund Claim',
        subtitle: label || `Refund Claim #${refundId}`,
        reason: '',
      });
      return;
    }
    setProcessingId(refundId);
    try {
      const res = await api.adminRefundStatus(refundId, status);
      onNotify('success', res.message);
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update refund status');
    } finally {
      setProcessingId(null);
    }
  }

  async function submitDeclineReasonModal(e: React.FormEvent) {
    e.preventDefault();
    const reason = declineReasonModal.reason.trim();
    if (reason.length < 3) {
      onNotify('error', 'Please enter a clear reason (at least 3 characters).');
      return;
    }
    const { kind, targetId } = declineReasonModal;
    setProcessingId(kind === 'verification' ? `dec_${targetId}` : targetId);
    try {
      if (kind === 'deposit') {
        const res = await api.decideWalletDeposit(String(targetId), { action: 'decline', reason });
        onNotify('success', res.message || 'Deposit request declined.');
      } else if (kind === 'payment') {
        const res = await api.adminDecidePayment(Number(targetId), 'reject', reason);
        onNotify('success', res.message || `Payment #${targetId} declined.`);
      } else if (kind === 'refund') {
        const res = await api.adminRefundStatus(Number(targetId), 'rejected', reason);
        onNotify('success', res.message || `Refund #${targetId} rejected.`);
      } else if (kind === 'verification') {
        const res = await api.adminDecideVerification(Number(targetId), { action: 'decline', declineReason: reason });
        onNotify('success', res.message || 'Merchant verification declined.');
      }
      setDeclineReasonModal((prev) => ({ ...prev, open: false, reason: '' }));
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err?.message || 'Failed to submit decision');
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
      await refreshActiveView();
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
      await refreshActiveView();
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
      await refreshActiveView();
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
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to apply moderation action');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Schedule Shop Visit
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
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to schedule shop visit');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Record Completed Visit & Advert Photo
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
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to record shop visit');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Grant Exemption with Mandatory Reason
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
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to grant exemption');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Verification Decision
  async function handleVerificationDecision(merchantId: number, action: 'verify' | 'decline', label?: string) {
    if (action === 'decline') {
      setDeclineReasonModal({
        open: true,
        kind: 'verification',
        targetId: merchantId,
        title: 'Decline Merchant Verification',
        subtitle: label || `Merchant #${merchantId}`,
        reason: '',
      });
      return;
    }
    setProcessingId(`dec_${merchantId}`);
    try {
      const res = await api.adminDecideVerification(merchantId, { action });
      onNotify('success', res.message || 'Merchant verification approved');
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update verification status');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Manual Subscription Approval & Rejection
  async function handleApproveSubscription(subId: string) {
    setProcessingId(subId);
    try {
      const res = await api.approveAdminMerchantSubscription(subId);
      onNotify('success', res.message || 'Subscription approved and merchant store activated!');
      await refreshActiveView();
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
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to reject subscription');
    } finally {
      setProcessingId(null);
    }
  }

  // Handle Enterprise Price Agreement
  async function handleSetEnterprisePriceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProcessingId(`ent_${enterprisePriceModal.merchantId}`);
    try {
      const res = await api.setAdminEnterprisePrice(enterprisePriceModal.merchantId, enterprisePriceModal.price);
      onNotify('success', res.message || 'Custom Enterprise price agreed!');
      setEnterprisePriceModal({ ...enterprisePriceModal, open: false });
      await refreshActiveView();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to set Enterprise price');
    } finally {
      setProcessingId(null);
    }
  }

  function handleCardFieldChange(slot: number, field: keyof PlatformAnnouncementSlot, value: any) {
    setAdminHeroCards((prev) => prev.map((c) => (c.slot === slot ? { ...c, [field]: value } : c)));
  }

  async function handleSaveCard(slot: number, publishDirect = false) {
    const card = adminHeroCards.find((c) => c.slot === slot);
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
        status: publishDirect ? 'published' : card.status || (card.isPublished ? 'published' : 'draft'),
        startsAt: card.startsAt || undefined,
        endsAt: card.endsAt || undefined,
        version: card.version,
      });
      onNotify('success', res.message || `Hero Card Slot #${slot} updated successfully!`);
      setAdminHeroCards((prev) => prev.map((c) => (c.slot === slot ? res.card : c)));
    } catch (err: any) {
      if (err.message && err.message.includes('Conflict')) {
        onNotify('error', 'Another admin updated this card while you were editing. Reloading latest version...');
        void loadAdminHeroCards();
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
        setAdminHeroCards((prev) => prev.map((c) => (c.slot === slot ? res.card : c)));
      } else {
        const res = await api.publishAdminHeroAnnouncementCard(slot);
        onNotify('success', res.message || `Slot #${slot} published to public hero.`);
        setAdminHeroCards((prev) => prev.map((c) => (c.slot === slot ? res.card : c)));
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
      setAdminHeroCards((prev) => prev.map((c) => (c.slot === slot ? res.card : c)));
      setHistorySlot(null);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to revert card version');
    } finally {
      setSavingSlot(null);
    }
  }

  const getPasswordStrength = (pw: string) => {
    if (!pw) return { score: 0, label: 'Not entered', color: 'bg-slate-200', textCol: 'text-slate-400', width: '0%' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (pw.length < 8) {
      return { score: 1, label: 'Too short (min 8 chars)', color: 'bg-red-500', textCol: 'text-red-600', width: '20%' };
    }
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      return { score: 1, label: 'Needs letter & number', color: 'bg-amber-500', textCol: 'text-amber-600', width: '35%' };
    }
    if (score <= 2) return { score: 2, label: 'Fair', color: 'bg-amber-500', textCol: 'text-amber-600', width: '55%' };
    if (score === 3) return { score: 3, label: 'Good', color: 'bg-sky-500', textCol: 'text-sky-600', width: '80%' };
    return { score: 4, label: 'Strong', color: 'bg-emerald-600', textCol: 'text-emerald-700', width: '100%' };
  };

  const handleDismissBanner = async (mode: 'dismiss' | 'snooze') => {
    try {
      const res = await api.dismissAdminSecurityBanner(mode);
      setAdminSecurity((prev) => (prev ? { ...prev, showSecurityBanner: res.showSecurityBanner } : prev));
      onNotify('info', mode === 'snooze' ? 'Reminder snoozed for 24 hours.' : 'Security recommendation dismissed.');
    } catch (err: any) {
      onNotify('error', err.message || 'Could not update reminder.');
    }
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
      onNotify('success', 'Administrator profile/email updated.');
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
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setSettingsNotice({ type: 'error', text: 'New password must be at least 8 characters and contain at least one letter and one number.' });
      setSavingSettings(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setSettingsNotice({ type: 'error', text: 'New password and confirmation do not match.' });
      setSavingSettings(false);
      return;
    }

    try {
      const res = await api.adminChangePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setAdminSecurity((prev) =>
        prev
          ? {
              ...prev,
              lastPasswordChangedAt: res.lastPasswordChangedAt,
              mustChangeCredentials: false,
              showSecurityBanner: prev.lastPasskeyChangedAt ? false : prev.showSecurityBanner,
            }
          : prev
      );
      setSettingsNotice({ type: 'success', text: res.message || 'Administrator password updated successfully!' });
      onNotify('success', 'Administrator password updated successfully.');
    } catch (err: any) {
      setSettingsNotice({ type: 'error', text: err.message || 'Could not update password. Please check your current password.' });
      onNotify('error', err.message || 'Password update failed.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangePasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPasskey(true);
    setSettingsNotice(null);

    if (!currentPasskeyInput) {
      setSettingsNotice({ type: 'error', text: 'Enter your current security passkey to authorize passkey rotation.' });
      setSavingPasskey(false);
      return;
    }
    if (newPasskeyInput.length < 8) {
      setSettingsNotice({ type: 'error', text: 'New security passkey must be at least 8 characters long.' });
      setSavingPasskey(false);
      return;
    }
    if (newPasskeyInput !== confirmPasskeyInput) {
      setSettingsNotice({ type: 'error', text: 'New security passkey and confirmation do not match.' });
      setSavingPasskey(false);
      return;
    }

    try {
      const res = await api.adminChangePasskey({
        currentPasskey: currentPasskeyInput,
        newPasskey: newPasskeyInput,
      });
      setCurrentPasskeyInput('');
      setNewPasskeyInput('');
      setConfirmPasskeyInput('');
      setAdminSecurity((prev) =>
        prev
          ? {
              ...prev,
              lastPasskeyChangedAt: res.lastPasskeyChangedAt,
              mustChangeCredentials: false,
              showSecurityBanner: prev.lastPasswordChangedAt ? false : prev.showSecurityBanner,
            }
          : prev
      );
      setSettingsNotice({ type: 'success', text: res.message || 'Administrator security passkey rotated successfully!' });
      onNotify('success', 'Security passkey updated.');
    } catch (err: any) {
      setSettingsNotice({ type: 'error', text: err.message || 'Could not update passkey.' });
      onNotify('error', err.message || 'Passkey update failed.');
    } finally {
      setSavingPasskey(false);
    }
  };

  if (!isAdmin) {
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
          className="px-5 py-2.5 bg-[#ff6600] text-white text-xs font-bold rounded-xl cursor-pointer"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  const pendingPaymentsCount = summary?.payments.pending ?? paymentsList.filter((p) => p.status === 'pending').length;
  const pendingDepositsCount = summary?.deposits.pending ?? walletDeposits.filter((d) => d.status === 'pending').length;
  const totalUsersCount = summary?.users.total ?? sectionStates.users.pagination?.total ?? usersList.length;
  const moderationCount = summary?.moderation.totalChatMessages ?? sectionStates.moderation.pagination?.total ?? chatLogs.recentChats.length;
  const refundsCount = summary?.refunds.total ?? sectionStates.refunds.pagination?.total ?? refundsList.length;
  const verifsCount = summary?.verifications.total ?? sectionStates.verifications.pagination?.total ?? verificationsList.length;
  const subsCount = summary?.subscriptions.total ?? sectionStates.subscriptions.pagination?.total ?? subscriptionsList.length;
  const featuredCount = summary?.products.featured ?? 0;
  const auditCount = summary?.audit.totalLogs ?? sectionStates.audit.pagination?.total ?? auditLogsList.length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="buyoll-admin-control-center">
      {/* Header rendered immediately */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-[#ff6600] text-white flex items-center justify-center font-bold">
              <Shield className="w-4 h-4" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Buyoll Admin Control Center
            </h1>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase rounded-full">
              Super Admin
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Reconcile payments against Till 196853 & Paybill 522533 statements, oversee wallets, manage accounts, and moderate Group chats.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <button
            type="button"
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
            type="button"
            onClick={refreshActiveView}
            disabled={summaryLoading}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${summaryLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              await logoutRole('admin');
              onNavigate('admin-portal');
              onNotify('info', 'Logged out of administrator session.');
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      {/* Dismissible / Snoozable Admin Security Recommendation Banner */}
      {adminSecurity?.showSecurityBanner && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black text-amber-950 uppercase tracking-wider">
                Security Recommendation: Rotate Initial Admin Credentials
              </h3>
              <p className="text-xs text-amber-900 mt-0.5 leading-relaxed">
                For stronger platform protection, update your initial administrator password and security passkey in Settings whenever convenient.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer"
            >
              Change Now
            </button>
            <button
              type="button"
              onClick={() => handleDismissBanner('snooze')}
              className="px-3 py-1.5 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Remind Later
            </button>
            <button
              type="button"
              onClick={() => handleDismissBanner('dismiss')}
              className="px-3 py-1.5 text-amber-800 hover:bg-amber-100 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Top KPI Summary Cards Strip (loaded first from /api/admin/control-center/summary) */}
      <div className="mb-6">
        {summaryError && !summary ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span><b>Summary unavailable:</b> {summaryError}</span>
            </div>
            <button
              type="button"
              onClick={() => loadSummary(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : summaryLoading && !summary ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                <div className="h-3 w-28 bg-slate-200 rounded" />
                <div className="h-7 w-20 bg-slate-300 rounded" />
                <div className="h-3 w-36 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Registered Accounts
              </span>
              {summary?.users.unavailable ? (
                <span className="text-xs font-bold text-red-600">Unavailable</span>
              ) : (
                <>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">
                    {(summary?.users.total || 0).toLocaleString()}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary?.users.members || 0} Members · {summary?.users.merchants || 0} Merchants · {summary?.users.lenders || 0} Lenders
                  </p>
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Pending Approvals
              </span>
              {summary?.payments.unavailable && summary?.deposits.unavailable ? (
                <span className="text-xs font-bold text-red-600">Unavailable</span>
              ) : (
                <>
                  <div className="text-2xl font-black text-[#ff6600] tabular-nums">
                    {((summary?.payments.pending || 0) + (summary?.deposits.pending || 0)).toLocaleString()}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary?.payments.pending || 0} Payments · {summary?.deposits.pending || 0} Deposits · {summary?.refunds.requested || 0} Refunds
                  </p>
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Subscriptions & Verifications
              </span>
              {summary?.subscriptions.unavailable ? (
                <span className="text-xs font-bold text-red-600">Unavailable</span>
              ) : (
                <>
                  <div className="text-2xl font-black text-emerald-700 tabular-nums">
                    {(summary?.subscriptions.active || 0).toLocaleString()} Active
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary?.subscriptions.pending || 0} Pending Subs · {summary?.verifications.pending || 0} Pending Verifs
                  </p>
                </>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Groups, Wallets & Loans
              </span>
              {summary?.groups.unavailable ? (
                <span className="text-xs font-bold text-red-600">Unavailable</span>
              ) : (
                <>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">
                    KSh {(summary?.wallets.totalCredit || 0).toLocaleString()}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {summary?.groups.active || 0} Active Groups · {summary?.loans.total || 0} Loans · {summary?.products.featured || 0} Featured
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs rendered immediately */}
      <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          data-testid="admin-tab-wallet"
          onMouseEnter={() => { void import('../components/AdminWalletPanel.tsx'); }}
          onClick={() => setActiveTab('wallet')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'wallet' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Admin Wallet</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'payments' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Payment Queue ({pendingPaymentsCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('deposits')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'deposits' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>Wallet Deposits ({pendingDepositsCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('wallets')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'wallets' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Wallets & CSV Export</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'users' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Users & Merchants ({totalUsersCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'moderation' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat Moderation ({moderationCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('refunds')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'refunds' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Refund Requests ({refundsCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('verifications')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'verifications' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Merchant Verifications ({verifsCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('subscriptions')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'subscriptions' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Subscriptions ({subsCount})</span>
        </button>

        <button
          type="button"
          onMouseEnter={() => { void import('../components/AdminFeaturedModeration.tsx'); }}
          onClick={() => setActiveTab('featured')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'featured' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Tag className="w-4 h-4" />
          <span>Featured Products ({featuredCount})</span>
        </button>

        <button
          type="button"
          onMouseEnter={() => { void import('../components/AdminAnnouncementsManager.tsx'); }}
          onClick={() => setActiveTab('announcements')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'announcements' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Megaphone className="w-4 h-4" />
          <span>Hero Announcements (3 Cards)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'audit' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Log ({auditCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'settings' ? 'bg-[#ff6600] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Account Settings</span>
        </button>
      </div>

      {/* TAB 1: PAYMENTS VERIFICATION QUEUE */}
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
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold shrink-0">
              <select
                value={paymentStatusFilter}
                onChange={(e) => {
                  const nextStatus = e.target.value as 'pending' | 'all' | 'approved' | 'rejected';
                  setPaymentStatusFilter(nextStatus);
                  void loadSection('payments', { page: 1, force: true, statusOverride: nextStatus });
                }}
                className="px-2.5 py-1.5 bg-white border border-emerald-200 rounded-lg text-xs font-semibold text-slate-700"
              >
                <option value="pending">Pending Only</option>
                <option value="all">All Statuses</option>
                <option value="approved">Approved</option>
                <option value="rejected">Declined</option>
              </select>
              <span className="px-2 py-1 bg-white border border-emerald-200 rounded-lg text-emerald-800">
                {pendingPaymentsCount} Pending
              </span>
            </div>
          </div>

          {sectionStates.payments.loading && !sectionStates.payments.loaded ? (
            <SectionTableSkeleton />
          ) : sectionStates.payments.error ? (
            <SectionErrorBanner
              title="Could not load payment queue"
              message={sectionStates.payments.error}
              onRetry={() => loadSection('payments', { page: 1, force: true })}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              {paymentsList.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2 opacity-80" />
                  <p className="text-xs font-bold text-slate-600">All submissions are fully reconciled!</p>
                  <p className="text-[11px] text-slate-400 mt-1">No payments matching this filter.</p>
                </div>
              ) : (
                <>
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
                        {paymentsList.map((p) => {
                          const match = (p as any).statementMatch;
                          const hasDuplicate = match?.duplicateDetected;
                          const isMatched = match?.matched;
                          const reason = match?.reason;
                          const stmt = (match?.statementRecord || p.matchedTillEntry) as MpesaStatementRecord | undefined;

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
                                  KSh {Number(p.amount || 0).toLocaleString()}
                                </div>
                              </td>

                              <td className="py-3 px-4">
                                {stmt ? (
                                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 max-w-xs space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-500">Till:</span>
                                      <span className="font-bold text-slate-800">{stmt.tillOrPaybill || (stmt as any).channel || 'Till 196853'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-500">Sender:</span>
                                      <span className="font-bold text-slate-800 truncate max-w-[130px]">{stmt.senderName || (stmt as any).payerName || 'Customer'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-500">Stmt Amount:</span>
                                      <span className={`font-black tabular-nums ${stmt.amount === p.amount ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        KSh {Number(stmt.amount || 0).toLocaleString()}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 max-w-xs">
                                    No matching record found on statement feed for code <b>{p.code}</b>. Please check physical Till portal.
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
                                    <span>{p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Declined' : 'Unverified Code'}</span>
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-6 text-right">
                                {p.status === 'pending' ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handlePaymentDecision(p.id, 'reject', `${p.userName} · ${p.code} (KSh ${p.amount})`)}
                                      disabled={processingId === p.id}
                                      className="px-2.5 py-1.5 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                                    >
                                      Decline
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handlePaymentDecision(p.id, 'approve')}
                                      disabled={processingId === p.id}
                                      className="flex items-center gap-1 px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Approve</span>
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs font-bold capitalize text-slate-500">{p.status}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <PaginationBar
                    pagination={sectionStates.payments.pagination}
                    loading={sectionStates.payments.loading}
                    onPageChange={(page) => void loadSection('payments', { page, force: true })}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: WALLET DEPOSITS APPROVAL QUEUE */}
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
                {pendingDepositsCount} Pending Deposits
              </span>
            </div>
          </div>

          {sectionStates.deposits.loading && !sectionStates.deposits.loaded ? (
            <SectionTableSkeleton />
          ) : sectionStates.deposits.error ? (
            <SectionErrorBanner
              title="Could not load wallet deposits"
              message={sectionStates.deposits.error}
              onRetry={() => loadSection('deposits', { page: 1, force: true })}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              {walletDeposits.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-400 mb-2 opacity-80" />
                  <p className="text-xs font-bold text-slate-600">No wallet deposits recorded yet</p>
                  <p className="text-[11px] text-slate-400 mt-1">When members submit deposit requests from their Wallet, they will appear here for one-click approval.</p>
                </div>
              ) : (
                <>
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
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                      dep.role === 'merchant'
                                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                        : dep.role === 'lender'
                                        ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                        : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    }`}
                                  >
                                    {dep.role}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono">{dep.userPhone}</div>
                            </td>

                            <td className="py-3 px-4">
                              <span className="font-mono font-black text-emerald-800 text-sm">
                                KSh {Number(dep.amount || 0).toLocaleString()}
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
                              <span
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  dep.status === 'approved'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : dep.status === 'declined'
                                    ? 'bg-red-100 text-red-800 border border-red-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
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
                                    type="button"
                                    onClick={() => handleDepositDecision(dep.id, 'approve')}
                                    disabled={processingId === dep.id}
                                    className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white font-bold rounded-lg text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                                  >
                                    {processingId === dep.id ? 'Crediting...' : 'Approve & Credit'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDepositDecision(dep.id, 'decline', `${dep.userName} · ${dep.mpesaCode} (KSh ${dep.amount})`)}
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
                  <PaginationBar
                    pagination={sectionStates.deposits.pagination}
                    loading={sectionStates.deposits.loading}
                    onPageChange={(page) => void loadSection('deposits', { page, force: true })}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WALLETS OVERSIGHT & CSV EXPORT */}
      {activeTab === 'wallets' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Total Credit in Circulation
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                KSh {(walletsData?.summary?.totalCredit ?? summary?.wallets.totalCredit ?? 0).toLocaleString()}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Platform shopping & locked Group balances</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Total Community Coins
              </span>
              <div className="text-2xl font-black text-amber-600 tabular-nums">
                {(walletsData?.summary?.totalCoins ?? summary?.wallets.totalCoins ?? 0).toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-400">coins</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Applaud & motivate currency held</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Reward Points Awarded
              </span>
              <div className="text-2xl font-black text-indigo-600 tabular-nums">
                {(walletsData?.summary?.totalPoints ?? summary?.wallets.totalPoints ?? 0).toLocaleString()}{' '}
                <span className="text-xs font-bold text-slate-400">pts</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Merit points for reliable repayment</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Registered Member Accounts
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {(walletsData?.summary?.totalUsers ?? summary?.wallets.totalAccounts ?? totalUsersCount).toLocaleString()}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Members, merchants, lenders, admins</p>
            </div>
          </div>

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

            <button
              type="button"
              onClick={() => void handleAsyncCsvExport('wallets')}
              disabled={exportingCsvType === 'wallets'}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer disabled:opacity-50"
            >
              {exportingCsvType === 'wallets' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{exportingCsvType === 'wallets' ? 'Preparing CSV...' : 'Export Wallets CSV'}</span>
            </button>
          </div>

          {sectionStates.wallets.loading && !sectionStates.wallets.loaded ? (
            <SectionTableSkeleton />
          ) : sectionStates.wallets.error ? (
            <SectionErrorBanner
              title="Could not load wallet ledger"
              message={sectionStates.wallets.error}
              onRetry={() => loadSection('wallets', { page: 1, force: true })}
            />
          ) : (
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
                    {(walletsData?.wallets || []).map((w) => (
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
                          KSh {Number(w.balance ?? w.credit ?? 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-800 tabular-nums">
                          KSh {Number(w.nonWithdrawableBalance || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-amber-600 tabular-nums">
                          {Number(w.coins || 0).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-indigo-700 tabular-nums">
                          {Number(w.points || 0).toLocaleString()} pts
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
              <PaginationBar
                pagination={sectionStates.wallets.pagination}
                loading={sectionStates.wallets.loading}
                onPageChange={(page) => void loadSection('wallets', { page, force: true })}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 4: USER & MERCHANT MANAGEMENT */}
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
                <option value="member">Members</option>
                <option value="lender">Lenders</option>
                <option value="admin">Admins</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-slate-500 font-medium">
                Showing <b>{usersList.length}</b> of <b>{sectionStates.users.pagination?.total ?? usersList.length}</b> accounts
              </div>
              <button
                type="button"
                onClick={() => void handleAsyncCsvExport('users')}
                disabled={exportingCsvType === 'users'}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {exportingCsvType === 'users' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exportingCsvType === 'users' ? 'Exporting...' : 'Export Users CSV'}</span>
              </button>
            </div>
          </div>

          {sectionStates.users.loading && !sectionStates.users.loaded ? (
            <SectionTableSkeleton />
          ) : sectionStates.users.error ? (
            <SectionErrorBanner
              title="Could not load user directory"
              message={sectionStates.users.error}
              onRetry={() => loadSection('users', { page: 1, force: true })}
            />
          ) : (
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
                    {usersList.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{u.name}</span>
                            {u.verified && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                          </div>
                          <div className="text-[11px] text-slate-400">ID #{u.id}</div>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${
                              u.role === 'merchant'
                                ? 'bg-purple-100 text-purple-800'
                                : u.role === 'admin'
                                ? 'bg-slate-900 text-white'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
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
                          <div className="font-bold text-indigo-700 tabular-nums">{u.points || 0} pts</div>
                          <button
                            type="button"
                            onClick={() => setPointsUser(u)}
                            className="text-[10px] text-[#ff6600] hover:underline font-bold mt-0.5 flex items-center gap-0.5 cursor-pointer"
                          >
                            <Award className="w-3 h-3" />
                            <span>+ Award Points</span>
                          </button>
                        </td>

                        <td className="py-3 px-6 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {u.role === 'merchant' && !u.verified && (
                              <button
                                type="button"
                                onClick={() => {
                                  setVerifyingUser(u);
                                  setVerificationNotes('Approved after reviewing business permits and physical shop inventory.');
                                }}
                                className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                              >
                                Verify
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleToggleSuspend(u)}
                              disabled={processingId === u.id || u.role === 'admin'}
                              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
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
              <PaginationBar
                pagination={sectionStates.users.pagination}
                loading={sectionStates.users.loading}
                onPageChange={(page) => void loadSection('users', { page, force: true })}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 5: CHAT MODERATION */}
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

          {sectionStates.moderation.loading && !sectionStates.moderation.loaded ? (
            <SectionTableSkeleton />
          ) : sectionStates.moderation.error ? (
            <SectionErrorBanner
              title="Could not load chat moderation logs"
              message={sectionStates.moderation.error}
              onRetry={() => loadSection('moderation', { page: 1, force: true })}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recent Group Chat Messages</h3>
                <span className="text-xs text-slate-500">
                  {sectionStates.moderation.pagination?.total ?? chatLogs.recentChats.length} messages
                </span>
              </div>

              {chatLogs.recentChats.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No active chat messages logged yet.
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {chatLogs.recentChats.map((msg) => (
                      <div key={msg.messageId} className="p-4 hover:bg-slate-50/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
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
                            type="button"
                            onClick={() => handleChatModerate('warn', msg.senderId, msg.groupId, msg.messageId)}
                            className="px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                          >
                            Warn Member
                          </button>

                          <button
                            type="button"
                            onClick={() => handleChatModerate('mute', msg.senderId, msg.groupId, msg.messageId)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <VolumeX className="w-3.5 h-3.5" />
                            <span>Mute</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleChatModerate('remove_message', msg.senderId, msg.groupId, msg.messageId)}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <PaginationBar
                    pagination={sectionStates.moderation.pagination}
                    loading={sectionStates.moderation.loading}
                    onPageChange={(page) => void loadSection('moderation', { page, force: true })}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: REFUND REQUESTS */}
      {activeTab === 'refunds' && (
        sectionStates.refunds.loading && !sectionStates.refunds.loaded ? (
          <SectionTableSkeleton />
        ) : sectionStates.refunds.error ? (
          <SectionErrorBanner
            title="Could not load refund claims"
            message={sectionStates.refunds.error}
            onRetry={() => loadSection('refunds', { page: 1, force: true })}
          />
        ) : (
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
              <span className="text-xs text-slate-500">
                {sectionStates.refunds.pagination?.total ?? refundsList.length} requests
              </span>
            </div>

            {refundsList.length === 0 ? (
              <p className="text-xs text-slate-400 py-12 text-center">No refund requests submitted yet.</p>
            ) : (
              <>
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
                      {refundsList.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono">#{r.id}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">{r.userName}</td>
                          <td className="py-3 px-4 font-mono text-slate-600">{r.userPhone}</td>
                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate">{r.productTitle}</td>
                          <td className="py-3 px-4 font-bold text-emerald-800 tabular-nums">
                            KSh {Number(r.eligibleRefundAmount || 0).toLocaleString()}
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
                                  type="button"
                                  onClick={() => handleRefundStatus(r.id, 'approved')}
                                  className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRefundStatus(r.id, 'rejected', `${r.userName} · ${r.productTitle} (KSh ${r.eligibleRefundAmount})`)}
                                  className="px-2 py-1 text-red-600 hover:bg-red-50 text-xs font-semibold rounded cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                            {r.status === 'approved' && (
                              <button
                                type="button"
                                onClick={() => handleRefundStatus(r.id, 'completed')}
                                className="px-3 py-1 bg-emerald-700 text-white text-xs font-bold rounded cursor-pointer"
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
                <PaginationBar
                  pagination={sectionStates.refunds.pagination}
                  loading={sectionStates.refunds.loading}
                  onPageChange={(page) => void loadSection('refunds', { page, force: true })}
                />
              </>
            )}
          </div>
        )
      )}

      {/* TAB 7: MERCHANT VERIFICATIONS */}
      {activeTab === 'verifications' && (
        sectionStates.verifications.loading && !sectionStates.verifications.loaded ? (
          <SectionTableSkeleton />
        ) : sectionStates.verifications.error ? (
          <SectionErrorBanner
            title="Could not load merchant verifications"
            message={sectionStates.verifications.error}
            onRetry={() => loadSection('verifications', { page: 1, force: true })}
          />
        ) : (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="p-6">
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
                      Total Records: {sectionStates.verifications.pagination?.total ?? verificationsList.length}
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
                            <div className="flex items-center gap-2 flex-wrap">
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

                          <div className="flex items-center gap-2 flex-wrap">
                            {verif.status === 'pending_review' && (
                              <button
                                type="button"
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
                                type="button"
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
                              type="button"
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
                                type="button"
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
                                type="button"
                                onClick={() => handleVerificationDecision(verif.merchantId, 'decline', verif.shopName || verif.merchantName)}
                                disabled={processingId === `dec_${verif.merchantId}`}
                                className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                              >
                                Decline
                              </button>
                            )}
                          </div>
                        </div>

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
              <PaginationBar
                pagination={sectionStates.verifications.pagination}
                loading={sectionStates.verifications.loading}
                onPageChange={(page) => void loadSection('verifications', { page, force: true })}
              />
            </div>
          </div>
        )
      )}

      {/* TAB 8: MERCHANT SUBSCRIPTIONS & TIERS */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">
                    Merchant Subscriptions & 6-Tier Catalog Management
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review active 30-day and yearly (365-day) subscriptions, reconcile manual M-Pesa payments, and manage custom Enterprise tier pricing.
                  </p>
                </div>
              </div>

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

              {sectionStates.subscriptions.loading && !sectionStates.subscriptions.loaded ? (
                <SectionTableSkeleton />
              ) : sectionStates.subscriptions.error ? (
                <SectionErrorBanner
                  title="Could not load merchant subscriptions"
                  message={sectionStates.subscriptions.error}
                  onRetry={() => loadSection('subscriptions', { page: 1, force: true })}
                />
              ) : subscriptionsList.length === 0 ? (
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
                            <span className="font-semibold text-slate-900 block">{sub.tierName}</span>
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                sub.billingPeriod === 'yearly'
                                  ? 'bg-indigo-100 text-indigo-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {sub.billingPeriod === 'yearly' ? 'Yearly · 365d' : '30-Day'}
                            </span>
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
                                    type="button"
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
                                        <span>{sub.billingPeriod === 'yearly' ? 'Approve (365d)' : 'Approve (30d)'}</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
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
                                  type="button"
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
            <PaginationBar
              pagination={sectionStates.subscriptions.pagination}
              loading={sectionStates.subscriptions.loading}
              onPageChange={(page) => void loadSection('subscriptions', { page, force: true })}
            />
          </div>
        </div>
      )}

      {/* TAB: UNIFIED ADMIN WALLET */}
      {activeTab === 'wallet' && (
        <React.Suspense fallback={<SectionTableSkeleton />}>
          <AdminWalletPanel
            onNotify={onNotify}
            onChanged={() => void loadSummary(true)}
          />
        </React.Suspense>
      )}

      {/* TAB 9: FEATURED MODERATION & PLACEMENT CONTROL */}
      {activeTab === 'featured' && (
        <React.Suspense fallback={<SectionTableSkeleton />}>
          <AdminFeaturedModeration
            onNotify={onNotify}
            onChanged={() => void loadSummary(true)}
          />
        </React.Suspense>
      )}

      {/* TAB 10: ADMIN-ONLY ANNOUNCEMENTS, PROMOTIONS & HERO SLOTS */}
      {activeTab === 'announcements' && (
        <div className="space-y-6">
          <React.Suspense fallback={<SectionTableSkeleton rows={3} />}>
            <AdminAnnouncementsManager onNotify={onNotify} />
          </React.Suspense>
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
                type="button"
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
          ) : heroCardsError && adminHeroCards.length === 0 ? (
            <SectionErrorBanner
              title="Could not load hero announcement cards"
              message={heroCardsError}
              onRetry={loadAdminHeroCards}
            />
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
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center justify-center">
                            #{slotNumber}
                          </span>
                          <span className="text-xs font-bold text-slate-900">Slot {slotNumber}</span>
                          <span className="text-[10px] font-mono text-slate-400">v{card.version}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {card.status === 'published' || card.isPublished ? (
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
                              <span className="text-[9px] text-slate-400 font-mono">{card.ctaUrl || '#'}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
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

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold text-slate-700">Badge Pill</label>
                            <span className="text-[10px] font-mono text-slate-400">{(card.badge || '').length}/20</span>
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

                        <div>
                          <label className="text-xs font-bold text-slate-700 block mb-1.5">Accent Color</label>
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

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">Type</label>
                            <select
                              value={card.badge ? card.badge.charAt(0).toUpperCase() + card.badge.slice(1).toLowerCase() : 'Announcement'}
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
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">Start Date</label>
                            <input
                              type="date"
                              value={card.startsAt ? new Date(card.startsAt).toISOString().split('T')[0] : ''}
                              onChange={(e) =>
                                handleCardFieldChange(slotNumber, 'startsAt', e.target.value ? new Date(e.target.value).getTime() : null)
                              }
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">End Date (Optional)</label>
                            <input
                              type="date"
                              value={card.endsAt ? new Date(card.endsAt).toISOString().split('T')[0] : ''}
                              onChange={(e) =>
                                handleCardFieldChange(slotNumber, 'endsAt', e.target.value ? new Date(e.target.value).getTime() : null)
                              }
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">CTA Label (max 24)</label>
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
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">CTA URL / Path</label>
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
                            card.status === 'published' || card.isPublished
                              ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {card.status === 'published' || card.isPublished ? 'Unpublish' : 'Publish'}
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
                  <h3 className="text-base font-bold text-slate-900">Slot #{historySlot} Revision History</h3>
                  <p className="text-xs text-slate-500">Audit log of previous content revisions and quick rollback.</p>
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
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 11: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        sectionStates.audit.loading && !sectionStates.audit.loaded ? (
          <SectionTableSkeleton />
        ) : sectionStates.audit.error ? (
          <SectionErrorBanner
            title="Could not load audit trail"
            message={sectionStates.audit.error}
            onRetry={() => loadSection('audit', { page: 1, force: true })}
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    System Security & Group Activity Audit Trail
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Append-only platform event log with East Africa Time (EAT) filtering.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search actor or details..."
                      className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff6600] w-44"
                    />
                  </div>
                  <input
                    type="text"
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    placeholder="Action prefix (e.g. WALLET_)"
                    className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff6600] w-40"
                  />
                  <input
                    type="date"
                    aria-label="Audit start date"
                    value={auditAfterDate}
                    onChange={(e) => setAuditAfterDate(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700"
                  />
                  <input
                    type="date"
                    aria-label="Audit end date"
                    value={auditBeforeDate}
                    onChange={(e) => setAuditBeforeDate(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => void loadSection('audit', { page: 1, force: true })}
                    className="px-3 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    Filter
                  </button>
                  {(auditSearch || auditActionFilter || auditAfterDate || auditBeforeDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuditSearch('');
                        setAuditActionFilter('');
                        setAuditAfterDate('');
                        setAuditBeforeDate('');
                        void loadSection('audit', {
                          page: 1,
                          force: true,
                          searchOverride: '',
                          actionOverride: '',
                          afterOverride: '',
                          beforeOverride: '',
                        });
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {auditLogsList.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">No audit events matching this filter.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {auditLogsList.map((log) => (
                    <div key={log.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-start gap-3">
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 mt-0.5 tabular-nums">
                        {new Date(log.timestamp).toLocaleString('en-KE', {
                          timeZone: 'Africa/Nairobi',
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="font-bold text-indigo-700 shrink-0 font-mono text-[11px]">{log.action}</span>
                      <div className="flex-1 text-slate-700">
                        <span className="font-semibold text-slate-900">{log.actorName}:</span> {log.details}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <PaginationBar
              pagination={sectionStates.audit.pagination}
              loading={sectionStates.audit.loading}
              onPageChange={(page) => void loadSection('audit', { page, force: true })}
            />
          </div>
        )
      )}

      {/* TAB 12: ACCOUNT SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6 max-w-4xl">
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

            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#ff6600]" />
                      <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
                    </div>
                    {adminSecurity?.lastPasswordChangedAt && (
                      <span className="text-[10px] text-slate-500 font-medium">
                        Updated {new Date(adminSecurity.lastPasswordChangedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <form onSubmit={handleChangePassword} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        New Password <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 8 chars, at least 1 letter & 1 number"
                        className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                      />

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
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
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

                    <div className="pt-1">
                      <button
                        type="submit"
                        disabled={savingSettings || !currentPassword || !newPassword || newPassword !== confirmPassword}
                        className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>{savingSettings ? 'Updating Password...' : 'Update Password'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#ff6600]" />
                    <h3 className="text-sm font-bold text-slate-900">Change Security Passkey</h3>
                  </div>
                  {adminSecurity?.lastPasskeyChangedAt && (
                    <span className="text-[10px] text-slate-500 font-medium">
                      Updated {new Date(adminSecurity.lastPasskeyChangedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <form onSubmit={handleChangePasskey} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Current Security Passkey <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={currentPasskeyInput}
                      onChange={(e) => setCurrentPasskeyInput(e.target.value)}
                      placeholder="Enter current security passkey"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      New Security Passkey (min 8 chars) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={newPasskeyInput}
                      onChange={(e) => setNewPasskeyInput(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Confirm New Passkey <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPasskeyInput}
                      onChange={(e) => setConfirmPasskeyInput(e.target.value)}
                      placeholder="Re-enter new security passkey"
                      className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                    />
                    {confirmPasskeyInput && confirmPasskeyInput !== newPasskeyInput && (
                      <p className="text-[11px] text-red-500 mt-1">Passkeys do not match.</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={savingPasskey || !currentPasskeyInput || !newPasskeyInput || newPasskeyInput !== confirmPasskeyInput}
                    className="w-full py-2.5 px-4 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{savingPasskey ? 'Rotating Passkey...' : 'Update Security Passkey'}</span>
                  </button>
                </form>

                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">End active admin session:</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await logoutRole('admin');
                      onNavigate('admin-portal');
                      onNotify('info', 'Logged out of administrator session.');
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
        </div>
      )}

      {/* Below-the-fold Lazy Audit Activity Snapshot (loads when scrolled into view) */}
      {activeTab !== 'audit' && (
        <div
          ref={activityViewportRef}
          className="mt-8 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#ff6600]" />
              <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                Recent Platform Activity Snapshot
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className="text-xs font-bold text-[#ff6600] hover:underline cursor-pointer"
            >
              View full audit log ({auditCount})
            </button>
          </div>
          {sectionStates.audit.loading && !sectionStates.audit.loaded ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-8 bg-slate-100 rounded-lg" />
              <div className="h-8 bg-slate-100 rounded-lg" />
            </div>
          ) : sectionStates.audit.error ? (
            <div className="flex items-center justify-between text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
              <span>{sectionStates.audit.error}</span>
              <button
                type="button"
                onClick={() => void loadSection('audit', { page: 1, force: true })}
                className="px-3 py-1 bg-[#ff6600] text-white font-bold rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : auditLogsList.length === 0 ? (
            <p className="text-xs text-slate-400">Scroll into view to load recent system events.</p>
          ) : (
            <div className="space-y-1.5 text-xs">
              {auditLogsList.slice(0, 5).map((log) => (
                <div key={log.id} className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 flex items-center gap-3">
                  <span className="font-mono text-[10px] text-slate-400 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-bold text-indigo-700 font-mono text-[11px] shrink-0">{log.action}</span>
                  <span className="text-slate-600 truncate">
                    <b className="text-slate-900">{log.actorName}:</b> {log.details}
                  </span>
                </div>
              ))}
            </div>
          )}
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
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-blue-700 text-white text-xs font-bold rounded-xl cursor-pointer"
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
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-700 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Save Inspection Record
              </button>
            </div>
          </form>
        </div>
      )}

      {/* GRANT EXEMPTION MODAL */}
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
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Grant Exemption
              </button>
            </div>
          </form>
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
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl cursor-pointer"
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
              <button type="button" onClick={() => setVerifyingUser(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Verifying <b>{verifyingUser.name}</b> ({verifyingUser.shopName || 'Shop'}) grants them the official <b>Verified Merchant</b> badge, allows group launching, and boosts trust across member searches.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Verification Audit Notes</label>
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
                type="button"
                onClick={() => setVerifyingUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitUserVerification}
                disabled={processingId === verifyingUser.id}
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
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
              <button type="button" onClick={() => setPointsUser(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Rewarding points directly increases <b>{pointsUser.name}</b>'s credit standing and Group trustworthiness score.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Points to Credit</label>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason / Citation</label>
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
                type="button"
                onClick={() => setPointsUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAwardPoints}
                disabled={processingId === pointsUser.id}
                className="px-5 py-2 bg-[#ff6600] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
              >
                Award Points
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MANDATORY DECLINE / REJECTION REASON */}
      {declineReasonModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={submitDeclineReasonModal}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-slate-900">{declineReasonModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeclineReasonModal((prev) => ({ ...prev, open: false, reason: '' }))}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
              {declineReasonModal.subtitle}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Mandatory Written Reason *
              </label>
              <textarea
                rows={3}
                required
                minLength={3}
                value={declineReasonModal.reason}
                onChange={(e) => setDeclineReasonModal((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Explain why this submission is declined (recorded in Audit Trail and sent to user)..."
                className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeclineReasonModal((prev) => ({ ...prev, open: false, reason: '' }))}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={declineReasonModal.reason.trim().length < 3 || processingId !== null}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
              >
                {processingId !== null ? 'Submitting...' : 'Confirm Decline'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
export default AdminDashboardPage;
