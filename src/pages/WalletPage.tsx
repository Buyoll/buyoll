import React, { useState, useEffect } from 'react';
import { User, DefaultRecord, RefundRequest, PaymentRecord, StoreCreditLedgerEntry, CoinLedgerEntry, WalletDepositRequest } from '../types.ts';
import { api } from '../api.ts';
import {
  Wallet,
  Coins,
  Award,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  History,
  FileText,
  Printer,
  ShieldCheck,
  Send,
  Heart,
  Gift,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  ArrowUpRight,
  ArrowDownLeft,
  X,
  Plus,
} from 'lucide-react';

interface WalletPageProps {
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onUserUpdate?: () => void;
}

export const WalletPage: React.FC<WalletPageProps> = ({
  currentUser,
  onNavigate,
  onOpenAuth,
  onNotify,
  onUserUpdate,
}) => {
  const [defaults, setDefaults] = useState<DefaultRecord[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [ledger, setLedger] = useState<StoreCreditLedgerEntry[]>([]);
  const [coinLedger, setCoinLedger] = useState<CoinLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Deposit Funds state (M-Pesa to Wallet)
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState<number>(1000);
  const [depositMpesaCode, setDepositMpesaCode] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [myDeposits, setMyDeposits] = useState<WalletDepositRequest[]>([]);

  // Coin topup state
  const [coinMpesaCode, setCoinMpesaCode] = useState('');
  const [coinAmount, setCoinAmount] = useState(50);
  const [selectedPackage, setSelectedPackage] = useState<number | null>(50);
  const [submittingCoin, setSubmittingCoin] = useState(false);

  // Default resolution modal
  const [selectedDefault, setSelectedDefault] = useState<DefaultRecord | null>(null);
  const [resolving, setResolving] = useState(false);
  const [showStatementModal, setShowStatementModal] = useState(false);

  // PROMPT 7: Reward Platform Modal State
  const [showPlatformModal, setShowPlatformModal] = useState(false);
  const [platformAmount, setPlatformAmount] = useState(10);
  const [platformMessage, setPlatformMessage] = useState('Support for Buyoll social fintech & Chama escrow infrastructure');
  const [rewardingPlatform, setRewardingPlatform] = useState(false);

  // Active ledger view tab
  const [historyTab, setHistoryTab] = useState<'mpesa' | 'deposits' | 'coins' | 'credit'>('mpesa');

  useEffect(() => {
    loadWalletData();
  }, [currentUser]);

  async function loadWalletData() {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [defaultsRes, paymentsRes, coinLedgerRes, depositsRes] = await Promise.all([
        api.getMyDefaults(),
        api.getMyPayments(),
        api.getCoinLedger().catch(() => ({ ledger: [] })),
        api.getMyWalletDeposits().catch(() => ({ deposits: [] })),
      ]);
      setDefaults(defaultsRes.defaults);
      setRefunds(defaultsRes.refunds);
      setPayments(paymentsRes.payments);
      setLedger(paymentsRes.ledger);
      if (coinLedgerRes?.ledger) setCoinLedger(coinLedgerRes.ledger);
      if (depositsRes?.deposits) setMyDeposits(depositsRes.deposits);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  }

  // Handle points redemption: 100 points = KSh 10 store credit
  async function handleRedeemPoints() {
    if (!currentUser || (currentUser.points || 0) < 100) {
      onNotify('error', 'You need at least 100 reward points to redeem.');
      return;
    }
    try {
      const res = await api.redeemPoints();
      onNotify('success', res.message);
      if (onUserUpdate) onUserUpdate();
      loadWalletData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to redeem points');
    }
  }

  // Handle Coin purchase / deposit
  async function handleBuyCoins(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !coinMpesaCode.trim()) return;

    const trimmed = coinMpesaCode.trim().toUpperCase();
    const codeRegex = /^[A-Z0-9]{8,12}$/i;
    if (!codeRegex.test(trimmed)) {
      onNotify('error', 'M-Pesa code must be 8-12 alphanumeric characters (e.g. QJK4X8L2PA).');
      return;
    }

    setSubmittingCoin(true);
    try {
      const res = await api.depositCoins(Number(coinAmount), trimmed);
      onNotify('success', res.message || 'Deposit code submitted for verification!');
      setCoinMpesaCode('');
      if (onUserUpdate) onUserUpdate();
      loadWalletData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit coin deposit');
    } finally {
      setSubmittingCoin(false);
    }
  }

  // Handle resolving a defaulted slot (Part 5.3: Option A, B, or C)
  async function handleResolveDefault(
    recordId: number,
    option: 'refund' | 'store_credit' | 'alternate_purchase'
  ) {
    setResolving(true);
    try {
      const res = await api.resolveDefault(recordId, option, currentUser?.phone);
      onNotify('success', res.message);
      setSelectedDefault(null);
      if (onUserUpdate) onUserUpdate();
      loadWalletData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process resolution');
    } finally {
      setResolving(false);
    }
  }

  // Deposit Funds to Wallet submission
  async function handleProcessDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) return;

    const trimmedCode = depositMpesaCode.trim().toUpperCase();
    if (!trimmedCode) {
      onNotify('error', 'Please enter your M-Pesa transaction code.');
      return;
    }

    if (!/^[A-Z0-9]{8,12}$/i.test(trimmedCode)) {
      onNotify('error', 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters (e.g. RJL798K2MN).');
      return;
    }

    if (depositAmount <= 0) {
      onNotify('error', 'Deposit amount must be greater than zero.');
      return;
    }

    setSubmittingDeposit(true);
    try {
      const res = await api.depositToWallet({
        amount: depositAmount,
        mpesaCode: trimmedCode,
        notes: depositNotes.trim() || undefined,
      });
      onNotify('success', res.message || 'Deposit submitted! The admin will verify and credit your wallet.');
      setShowDepositModal(false);
      setDepositMpesaCode('');
      setDepositNotes('');
      loadWalletData();
      if (onUserUpdate) onUserUpdate();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit deposit');
    } finally {
      setSubmittingDeposit(false);
    }
  }

  // PROMPT 7: Handle Reward Platform
  async function handleRewardPlatformSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) return;

    const amount = Math.max(1, Number(platformAmount) || 1);
    if ((currentUser.coins || 0) < amount) {
      onNotify('error', `Insufficient coins! You have ${currentUser.coins || 0} coins, but tried to send ${amount}.`);
      return;
    }

    setRewardingPlatform(true);
    try {
      const res = await api.rewardPlatform(amount, platformMessage);
      onNotify('success', res.message || `Thank you! Sent ${amount} coins to Buyoll Platform.`);
      setShowPlatformModal(false);
      if (onUserUpdate) onUserUpdate();
      loadWalletData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to send coins to platform');
    } finally {
      setRewardingPlatform(false);
    }
  }

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <Wallet className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900 mb-1">Sign in to Access Wallet</h2>
        <p className="text-xs text-slate-500 mb-4">
          View your store credit balance, rewards, Chama refund requests, and M-Pesa ledger.
        </p>
        <button
          onClick={onOpenAuth}
          className="px-5 py-2.5 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl"
        >
          Sign In / Register
        </button>
      </div>
    );
  }

  const userCoins = currentUser.coins || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Title & Introduction */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Shopping Wallet & Applaud System
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage your verified shopping balance, deposit via M-Pesa Till or Paybill, reward the platform, and track your statement.
          </p>
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          <button
            onClick={() => setShowDepositModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Deposit Funds (M-Pesa)</span>
          </button>

          <button
            onClick={() => setShowPlatformModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Heart className="w-4 h-4" />
            <span>Reward Platform</span>
          </button>
        </div>
      </div>

      {/* 3 Main Balances */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Store Credit */}
        <div className="bg-white border-2 border-emerald-500/30 rounded-2xl p-6 shadow-xs relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Store Credit Balance
              </span>
              <Wallet className="w-5 h-5 text-[#0E5A3C]" />
            </div>
            <div className="text-3xl font-black text-slate-900 tabular-nums mb-1">
              KSh {currentUser.credit.toLocaleString()}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              <span>Locked Chama Balance:</span>
              <span className="font-bold text-emerald-800 tabular-nums">
                KSh {(currentUser.nonWithdrawableBalance || 0).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Till 196853 / Paybill 522533</span>
            <button
              onClick={() => setShowDepositModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>+ Deposit Funds</span>
            </button>
          </div>
        </div>

        {/* Reward Points */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Reward Points
              </span>
              <Award className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-slate-900 tabular-nums mb-1">
              {currentUser.points} <span className="text-xs font-normal text-slate-400">pts</span>
            </div>
            <p className="text-[11px] text-slate-500">Earn 1 pt for every KSh 10 contributed on time.</p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">100 pts = KSh 10 credit</span>
            <button
              onClick={handleRedeemPoints}
              disabled={(currentUser.points || 0) < 100}
              className="px-3 py-1.5 bg-[#0E5A3C] disabled:bg-slate-200 text-white disabled:text-slate-400 text-xs font-bold rounded-lg transition-colors"
            >
              Redeem
            </button>
          </div>
        </div>

        {/* Applaud Coins */}
        <div className="bg-white border border-amber-300/80 bg-amber-50/20 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                Community Applaud Coins
              </span>
              <Coins className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-amber-600 tabular-nums mb-1">
              {userCoins}{' '}
              <span className="text-xs font-normal text-slate-400">coins</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Reward faithful payers, motivate group members, or support Buyoll platform.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-amber-200/60 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">1 KSh = 1 coin</span>
            <button
              onClick={() => {
                const depositElem = document.getElementById('coin-deposit-section');
                if (depositElem) depositElem.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-xs font-bold text-[#0E5A3C] hover:underline"
            >
              + Deposit Coins
            </button>
          </div>
        </div>
      </div>

      {/* PART 5.3: DEFAULTED SLOTS & REFUND CLAIMS RESOLUTION CENTER */}
      {defaults.length > 0 && (
        <section className="bg-amber-50/50 border-2 border-amber-300 rounded-2xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-amber-700" />
            <h2 className="text-base font-bold text-amber-950">
              Vacated / Defaulted Slot Resolution Center (Part 5)
            </h2>
          </div>
          <p className="text-xs text-amber-900 mb-4 leading-relaxed">
            When a Chama slot is vacated due to missed contributions, your historical paid amounts are protected. You can claim a cash M-Pesa refund, convert the full value to store credit, or apply it to an alternate order.
          </p>

          <div className="space-y-3">
            {defaults.map((def) => {
              const isResolved = def.resolutionStatus === 'completed';
              const hasRefundReq = refunds.find(r => r.defaultRecordId === def.id);

              return (
                <div
                  key={def.id}
                  className="bg-white rounded-xl p-4 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900">
                        {def.groupName} · Slot #{def.slotNumber}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                        {new Date(def.defaultDate).toLocaleDateString()}
                      </span>
                      {isResolved && (
                        <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded">
                          Resolved ({def.resolutionOption})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      Product: <b>{def.productTitle}</b> · Verified Paid Amount:{' '}
                      <b className="text-emerald-700 tabular-nums">KSh {def.amountPaid.toLocaleString()}</b>
                    </div>
                    {hasRefundReq && (
                      <div className="text-[11px] text-indigo-700 font-semibold mt-1">
                        Refund Status: <b>{hasRefundReq.status.toUpperCase()}</b> · Request #{hasRefundReq.id}
                      </div>
                    )}
                  </div>

                  {!isResolved && !hasRefundReq && (
                    <button
                      onClick={() => setSelectedDefault(def)}
                      className="px-4 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg shrink-0 shadow-xs"
                    >
                      Choose Refund or Credit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Two Column Grid: Top up Coins & Ledgers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-8">
        {/* LEFT: Coin Top-up Form (~35%) */}
        <div id="coin-deposit-section" className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500" />
            <span>Deposit Applaud Coins</span>
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Deposit via Buyoll Escrow Till <b>196853</b> or Paybill <b>522533</b> (Acc: <b>4363</b>). 1 KSh = 1 Coin.
          </p>

          {/* Quick Package Selector */}
          <div className="mb-4">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
              Select Package Amount
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[50, 100, 250, 500, 1000, 2000].map((pkg) => (
                <button
                  type="button"
                  key={pkg}
                  onClick={() => {
                    setSelectedPackage(pkg);
                    setCoinAmount(pkg);
                  }}
                  className={`p-2 rounded-xl text-xs font-bold border transition-colors ${
                    coinAmount === pkg
                      ? 'border-[#0E5A3C] bg-emerald-50 text-[#0E5A3C]'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  KSh {pkg}
                  <span className="block text-[10px] font-normal text-slate-500">{pkg} coins</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleBuyCoins} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Custom Amount (KSh / Coins)
              </label>
              <input
                type="number"
                min="10"
                required
                value={coinAmount}
                onChange={(e) => {
                  setCoinAmount(Number(e.target.value));
                  setSelectedPackage(null);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                M-Pesa Transaction Code
              </label>
              <input
                type="text"
                required
                value={coinMpesaCode}
                onChange={(e) => setCoinMpesaCode(e.target.value.toUpperCase())}
                placeholder="e.g. QJK4X8L2PA"
                className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">8 to 12 alphanumeric characters</span>
            </div>

            <button
              type="submit"
              disabled={submittingCoin || !coinMpesaCode.trim()}
              className="w-full py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] disabled:bg-slate-200 text-white disabled:text-slate-400 text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              {submittingCoin ? 'Submitting...' : `Deposit ${coinAmount} Coins`}
            </button>
          </form>
        </div>

        {/* RIGHT: Transaction History & Ledgers (~65%) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-4 h-4 text-[#0E5A3C]" />
                  <span>Statements & History</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  View your M-Pesa Till payments, Applaud coin transfers, and store credit ledger.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowStatementModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Print Statement</span>
                </button>
              </div>
            </div>

            {/* Sub-tabs for Ledgers */}
            <div className="flex gap-2 mb-4 border-b border-slate-100 pb-2 overflow-x-auto">
              <button
                onClick={() => setHistoryTab('mpesa')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  historyTab === 'mpesa'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                M-Pesa Till Submissions ({payments.length})
              </button>

              <button
                onClick={() => setHistoryTab('deposits')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  historyTab === 'deposits'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Wallet Deposits ({myDeposits.length})
              </button>

              <button
                onClick={() => setHistoryTab('coins')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  historyTab === 'coins'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Coins Ledger ({coinLedger.length})
              </button>

              <button
                onClick={() => setHistoryTab('credit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  historyTab === 'credit'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Store Credit Ledger ({ledger.length})
              </button>
            </div>

            {/* TAB: M-Pesa Submissions */}
            {historyTab === 'mpesa' && (
              <div>
                {payments.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No payment transactions recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Code</th>
                          <th className="py-2.5 px-3">Amount</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 px-3 text-slate-500">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-2.5 px-3 capitalize text-slate-700">{p.type.replace('_', ' ')}</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{p.code}</td>
                            <td className="py-2.5 px-3 font-semibold text-slate-900 tabular-nums">
                              KSh {p.amount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  p.status === 'approved'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : p.status === 'rejected'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {p.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB: Wallet Deposits History */}
            {historyTab === 'deposits' && (
              <div>
                {myDeposits.length === 0 ? (
                  <div className="py-10 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-700">No wallet deposits submitted yet</p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                      Click "+ Deposit Funds" to deposit via M-Pesa Till 196853 or Paybill 522533. Once processed by admin, your store credit will be credited.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">M-Pesa Code</th>
                          <th className="py-2.5 px-3">Amount</th>
                          <th className="py-2.5 px-3">Reference / Note</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {myDeposits.map((d) => (
                          <tr key={d.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 text-slate-500">
                              {new Date(d.createdAt).toLocaleDateString()}{' '}
                              <span className="text-slate-400 text-[10px]">
                                {new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{d.mpesaCode}</td>
                            <td className="py-2.5 px-3 font-bold text-emerald-800 tabular-nums">
                              KSh {d.amount.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">
                              {d.notes || <span className="text-slate-300 italic">None</span>}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  d.status === 'approved'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : d.status === 'declined'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-amber-100 text-amber-800 animate-pulse'
                                }`}
                              >
                                {d.status === 'approved' ? '✓ Credited' : d.status === 'pending' ? '⏳ Pending Approval' : '✗ Declined'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB: Coin Ledger History */}
            {historyTab === 'coins' && (
              <div>
                {coinLedger.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No coin transfer activities recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {coinLedger.map((c) => {
                      const isSender = c.senderId === currentUser.id;
                      const isPlatform = c.type === 'reward_platform';

                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                              isPlatform
                                ? 'bg-indigo-100 text-indigo-700'
                                : isSender
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {isPlatform ? (
                                <Heart className="w-4 h-4" />
                              ) : isSender ? (
                                <ArrowUpRight className="w-4 h-4" />
                              ) : (
                                <ArrowDownLeft className="w-4 h-4" />
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900">
                                {isPlatform
                                  ? 'Reward to Buyoll Platform'
                                  : isSender
                                  ? `Awarded to ${c.recipientName}`
                                  : `Received from ${c.senderName}`}
                              </div>
                              <div className="text-[11px] text-slate-500 italic mt-0.5">
                                "{c.reason}"
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1">
                                {new Date(c.timestamp).toLocaleString()}
                              </div>
                            </div>
                          </div>

                          <div className={`font-black text-sm tabular-nums shrink-0 ${
                            isSender ? 'text-amber-700' : 'text-emerald-700'
                          }`}>
                            {isSender ? '-' : '+'}{c.amount} coins
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: Store Credit Ledger */}
            {historyTab === 'credit' && (
              <div>
                {ledger.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No credit conversions yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ledger.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">{l.note}</div>
                          <div className="text-[11px] text-slate-400">
                            {new Date(l.createdAt).toLocaleString()} · Balance After: KSh {l.balanceAfter.toLocaleString()}
                          </div>
                        </div>
                        <div className="font-bold text-emerald-700 text-sm tabular-nums">
                          +KSh {l.amount.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WALLET M-PESA DEPOSIT MODAL */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#0E5A3C] flex items-center justify-center font-bold">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Deposit Funds to Wallet</h3>
                  <p className="text-[11px] text-slate-500">Fast M-Pesa automatic credit verification</p>
                </div>
              </div>
              <button
                onClick={() => setShowDepositModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProcessDeposit} className="space-y-4">
              {/* Payment Details Box */}
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs space-y-1.5 text-emerald-950">
                <span className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#0E5A3C]" />
                  Pay via M-Pesa Buy Goods Till or Paybill:
                </span>
                <div className="font-mono text-[11px] space-y-0.5 bg-white/70 p-2 rounded-lg border border-emerald-100">
                  <div className="flex justify-between">
                    <span>Till Number:</span>
                    <b className="text-slate-900">196853</b> (Buy Goods)
                  </div>
                  <div className="flex justify-between">
                    <span>Paybill Number:</span>
                    <b className="text-slate-900">522533</b>
                  </div>
                  <div className="flex justify-between">
                    <span>Account:</span>
                    <b className="text-[#0E5A3C]">WALLET-{currentUser.id}</b> or <b>{currentUser.phone}</b>
                  </div>
                </div>
                <p className="text-[10px] text-emerald-800 leading-relaxed">
                  After sending funds, input your transaction details below and click Process. The admin will verify and your balance will increase automatically.
                </p>
              </div>

              {/* Quick Amount Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount Paid (KSh) <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {[500, 1000, 2500, 5000].map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      onClick={() => setDepositAmount(amt)}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        depositAmount === amt
                          ? 'border-[#0E5A3C] bg-emerald-50 text-[#0E5A3C]'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      KSh {amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="50"
                  required
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] font-mono font-bold"
                  placeholder="Enter exact amount paid"
                />
              </div>

              {/* M-Pesa Code Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  M-Pesa Transaction Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={12}
                  value={depositMpesaCode}
                  onChange={(e) => setDepositMpesaCode(e.target.value.toUpperCase())}
                  placeholder="e.g. RJL798K2MN (8-12 alphanumeric characters)"
                  className="w-full px-3 py-2 text-xs font-mono uppercase tracking-wider border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              {/* Optional Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payment Reference / Note (Optional)
                </label>
                <input
                  type="text"
                  value={depositNotes}
                  onChange={(e) => setDepositNotes(e.target.value)}
                  placeholder="e.g. Chama deposit for Solar station"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDepositModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDeposit || !depositMpesaCode.trim() || depositAmount <= 0}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {submittingDeposit ? 'Processing...' : 'Process Deposit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROMPT 7: REWARD PLATFORM MODAL */}
      {showPlatformModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">Reward Buyoll Platform</h3>
              </div>
              <button
                onClick={() => setShowPlatformModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Support the Buyoll social fintech ecosystem. Your platform contribution fuels free fraud protection, automated statement reconciliation, and community support.
            </p>

            <form onSubmit={handleRewardPlatformSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Coins to Send
                </label>
                <div className="flex items-center gap-2 mb-2">
                  {[10, 25, 50, 100].map((amt) => (
                    <button
                      type="button"
                      key={amt}
                      onClick={() => setPlatformAmount(amt)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        platformAmount === amt
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  max={userCoins}
                  value={platformAmount}
                  onChange={(e) => setPlatformAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Message / Dedication
                </label>
                <input
                  type="text"
                  value={platformMessage}
                  onChange={(e) => setPlatformMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="flex items-center justify-between text-xs p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500">Available Balance:</span>
                <span className="font-bold text-amber-700">{userCoins} coins</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPlatformModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rewardingPlatform || userCoins < platformAmount}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 text-white disabled:text-slate-400 text-xs font-bold rounded-xl shadow-xs transition-colors"
                >
                  {rewardingPlatform ? 'Sending...' : `Send ${platformAmount} Coins`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESOLUTION MODAL FOR DEFAULTED SLOT (PART 5.3) */}
      {selectedDefault && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Select Resolution for Vacated Slot #{selectedDefault.slotNumber}
                </h3>
                <p className="text-xs text-slate-500">{selectedDefault.groupName}</p>
              </div>
              <button
                onClick={() => setSelectedDefault(null)}
                className="text-slate-400 hover:text-slate-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-emerald-50 text-[#0E5A3C] rounded-xl text-xs mb-4">
              Verified Paid Amount Eligible for Resolution:{' '}
              <b className="text-sm font-black">KSh {selectedDefault.amountPaid.toLocaleString()}</b>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              Under Part 5 default regulations, you have three protected choices for your verified contributions:
            </p>

            <div className="space-y-3 mb-6">
              {/* Option A: Cash Refund */}
              <button
                onClick={() => handleResolveDefault(selectedDefault.id, 'refund')}
                disabled={resolving}
                className="w-full text-left p-3.5 rounded-xl border border-slate-200 hover:border-[#0E5A3C] hover:bg-slate-50 transition-all flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  A
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Option A: Request Cash M-Pesa Refund</div>
                  <div className="text-[11px] text-slate-500">
                    Submit verified claim to admin. Funds disbursed to your registered M-Pesa number {currentUser.phone}.
                  </div>
                </div>
              </button>

              {/* Option B: Store Credit */}
              <button
                onClick={() => handleResolveDefault(selectedDefault.id, 'store_credit')}
                disabled={resolving}
                className="w-full text-left p-3.5 rounded-xl border-2 border-emerald-500 bg-emerald-50/30 hover:bg-emerald-50 transition-all flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  B
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Option B: Retain as Store Credit (Instant)
                  </div>
                  <div className="text-[11px] text-slate-600">
                    Immediately converts KSh {selectedDefault.amountPaid.toLocaleString()} into your account balance for future purchases.
                  </div>
                </div>
              </button>

              {/* Option C: Apply to Another Purchase */}
              <button
                onClick={() => handleResolveDefault(selectedDefault.id, 'alternate_purchase')}
                disabled={resolving}
                className="w-full text-left p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 font-bold text-xs mt-0.5">
                  C
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Option C: Apply Value to Alternate Order
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Transfer the credit to join a different Chama group of your choice.
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedDefault(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL CUSTOMER STATEMENT & LEDGER MODAL */}
      {showStatementModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl my-8 border border-slate-200">
            {/* Modal Header & Actions */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-200 mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#0E5A3C] text-white flex items-center justify-center font-black text-base shadow-sm">
                  B
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 tracking-tight">
                    BUYOLL FINANCIAL STATEMENT
                  </h3>
                  <p className="text-xs text-slate-500">
                    Official Customer Transaction Ledger · M-Pesa Platform Till <b>196853</b> / <b>522533</b>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / PDF</span>
                </button>
                <button
                  onClick={() => setShowStatementModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Account Details Header */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200/80 mb-6 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Account Name</span>
                <span className="font-bold text-slate-900">{currentUser.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Mobile Number</span>
                <span className="font-bold text-slate-900">{currentUser.phone}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Customer ID</span>
                <span className="font-mono font-bold text-slate-900">
                  BYL-{currentUser.id.toString().padStart(6, '0')}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Platform Escrow</span>
                <span className="font-bold text-[#0E5A3C]">196853 / 522533</span>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-center">
                <span className="text-[11px] font-semibold text-emerald-800 block">Total Approved</span>
                <span className="text-base font-black text-[#0E5A3C] tabular-nums">
                  KSh{' '}
                  {payments
                    .filter(p => p.status === 'approved')
                    .reduce((sum, p) => sum + p.amount, 0)
                    .toLocaleString()}
                </span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-[11px] font-semibold text-slate-600 block">Store Credit</span>
                <span className="text-base font-black text-slate-900 tabular-nums">
                  KSh {(currentUser.credit || 0).toLocaleString()}
                </span>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-center">
                <span className="text-[11px] font-semibold text-amber-800 block">Reward Points</span>
                <span className="text-base font-black text-amber-900 tabular-nums">
                  {(currentUser.points || 0).toLocaleString()} pts
                </span>
              </div>
            </div>

            {/* Itemized Transactions Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden mb-6">
              <div className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-800 border-b border-slate-200">
                Itemized Transaction History
              </div>
              {payments.length === 0 ? (
                <p className="text-xs text-slate-400 p-6 text-center">No transactions on record.</p>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">M-Pesa Code</th>
                        <th className="py-2 px-3">Amount</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {payments.map(p => (
                        <tr key={p.id}>
                          <td className="py-2 px-3 text-slate-500">
                            {new Date(p.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2 px-3 capitalize text-slate-700">
                            {p.type.replace('_', ' ')}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-900">
                            {p.code}
                          </td>
                          <td className="py-2 px-3 font-bold text-slate-900 tabular-nums">
                            KSh {p.amount.toLocaleString()}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                p.status === 'approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : p.status === 'rejected'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Verification Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 pt-4 border-t border-slate-100 gap-2">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Verified Buyoll Social Fintech Escrow Statement</span>
              </span>
              <span>Generated on {new Date().toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
