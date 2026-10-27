import React, { useState, useEffect } from 'react';
import { User, PaymentRecord, RefundRequest, AuditLog, Product, ChamaGroup, MpesaStatementRecord, ChatModerationEvent } from '../types.ts';
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
  const [activeTab, setActiveTab] = useState<'payments' | 'wallets' | 'users' | 'moderation' | 'refunds' | 'audit'>('payments');
  const [processingId, setProcessingId] = useState<number | string | null>(null);

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
  const [pointsReason, setPointsReason] = useState('Faithful Chama contributions & excellent repayment streak');

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

  useEffect(() => {
    loadAllAdminData();
  }, []);

  async function loadAllAdminData() {
    setLoading(true);
    try {
      const [overviewRes, walletsRes, usersRes, chatLogsRes] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminWallets().catch(() => null),
        api.getAdminUsers().catch(() => ({ users: [] })),
        api.getAdminChatLogs().catch(() => ({ moderationEvents: [], recentChats: [] })),
      ]);

      setData(overviewRes);
      if (walletsRes) setWalletsData(walletsRes);
      if (usersRes?.users) setUsersList(usersRes.users);
      if (chatLogsRes) setChatLogs(chatLogsRes);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load administration data');
    } finally {
      setLoading(false);
    }
  }

  // Handle Payment Decision
  async function handlePaymentDecision(paymentId: number, decision: 'approve' | 'reject') {
    setProcessingId(paymentId);
    try {
      const res = await api.adminDecidePayment(paymentId, decision);
      onNotify('success', res.message || `Payment #${paymentId} ${decision}d`);
      loadAllAdminData();
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
          className="px-5 py-2.5 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="w-10 h-10 border-4 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-xs font-semibold text-slate-600">Loading Buyoll Admin Control Center...</p>
      </div>
    );
  }

  // Filtered users
  const filteredUsers = (usersList.length > 0 ? usersList : data.allUsers).filter(u => {
    const matchesSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.phone.includes(userSearch) ||
      (u.email && u.email.toLowerCase().includes(userSearch.toLowerCase())) ||
      (u.shopName && u.shopName.toLowerCase().includes(userSearch.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  // Filtered wallets
  const filteredWallets = (walletsData?.wallets || []).filter(w =>
    w.name.toLowerCase().includes(walletSearch.toLowerCase()) ||
    w.phone.includes(walletSearch) ||
    w.role.toLowerCase().includes(walletSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#0E5A3C] text-white flex items-center justify-center font-bold">
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
            Reconcile payments against Till 196853 & Paybill 522533 statements, oversee wallets, manage users, and moderate Chama chats.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={loadAllAdminData}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 mb-6 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'payments' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Payment Queue ({data.pendingPayments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('wallets')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'wallets' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Wallets & CSV Export</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'users' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Users & Merchants ({filteredUsers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('moderation')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'moderation' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat Moderation ({chatLogs.recentChats.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('refunds')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'refunds' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>Refund Requests ({data.refundRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-colors ${
            activeTab === 'audit' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Log</span>
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
                {data.pendingPayments.length} Pending
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            {data.pendingPayments.length === 0 ? (
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
                    {data.pendingPayments.map((p) => {
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
                              <div className="text-[11px] text-[#0E5A3C] font-semibold mt-0.5">
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
                                className="flex items-center gap-1 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b462f] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
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
                KSh {walletsData?.summary.totalCredit.toLocaleString() || '0'}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Platform shopping & locked Chama balances</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Total Community Coins
              </span>
              <div className="text-2xl font-black text-amber-600 tabular-nums">
                {walletsData?.summary.totalCoins.toLocaleString() || '0'}{' '}
                <span className="text-xs font-bold text-slate-400">coins</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Applaud & motivate currency held</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Reward Points Awarded
              </span>
              <div className="text-2xl font-black text-indigo-600 tabular-nums">
                {walletsData?.summary.totalPoints.toLocaleString() || '0'}{' '}
                <span className="text-xs font-bold text-slate-400">pts</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Merit points for reliable repayment</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                Registered Member Accounts
              </span>
              <div className="text-2xl font-black text-slate-900 tabular-nums">
                {walletsData?.summary.totalUsers || filteredUsers.length}
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
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
              />
            </div>

            <a
              href="/api/admin/wallets/export-csv"
              download="buyoll_wallets_export.csv"
              className="flex items-center justify-center gap-2 px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b462f] text-white text-xs font-bold rounded-xl shadow-xs transition-colors shrink-0"
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
                    <th className="py-3 px-4">Locked Chama Balance</th>
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
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-xl bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
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
                          className="text-[10px] text-[#0E5A3C] hover:underline font-bold mt-0.5 flex items-center gap-0.5"
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
                Chama Group Chat Supervision & Enforcement
              </h3>
              <p className="text-xs text-amber-900 mt-0.5">
                Inspect group discussions, flag inappropriate content, issue formal warnings, mute disruptive users (`isMuted`), or purge malicious messages.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Recent Group Chat Messages</h3>
              <span className="text-xs text-slate-500">{chatLogs.recentChats.length} recent messages</span>
            </div>

            {chatLogs.recentChats.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No active chat messages logged yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {chatLogs.recentChats.map((msg) => (
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
            <span className="text-xs text-slate-500">{data.refundRequests.length} requests</span>
          </div>

          {data.refundRequests.length === 0 ? (
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
                  {data.refundRequests.map((r) => (
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

      {/* TAB 6: AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 mb-4">
            System Security & Group Activity Audit Trail
          </h2>
          <div className="space-y-2 text-xs">
            {data.auditLogs.map((log) => (
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
                  className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
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
                className="px-5 py-2 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl shadow-xs"
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
              Rewarding points directly increases <b>{pointsUser.name}</b>'s credit standing and Chama trustworthiness score.
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
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
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
                  className="w-full text-xs p-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
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
                className="px-5 py-2 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl shadow-xs"
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
