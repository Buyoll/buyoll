import React, { useState, useEffect } from 'react';
import { ChamaGroup, User, GroupSlot, Product, PeerLoanRequest, MemberStatement } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  Users,
  Shield,
  ArrowLeft,
  Calendar,
  Send,
  Coins,
  AlertTriangle,
  UserPlus,
  CheckCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Info,
  RefreshCw,
  Store,
  ArrowRight,
  FileText,
  HandCoins,
  X,
  Printer,
  Wallet,
  Check,
  Trash2,
  UserMinus,
  Lock,
  Download,
  Moon,
  Sun,
} from 'lucide-react';
import { ChamaActivityFeed } from '../components/ChamaActivityFeed.tsx';
import { ContributionCalendar } from '../components/ContributionCalendar.tsx';

interface GroupDetailPageProps {
  groupId: number;
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const GroupDetailPage: React.FC<GroupDetailPageProps> = ({
  groupId,
  currentUser,
  onNavigate,
  onOpenAuth,
  onNotify,
}) => {
  const [group, setGroup] = useState<ChamaGroup | null>(null);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
  const [loans, setLoans] = useState<PeerLoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payment form state
  const [mpesaCode, setMpesaCode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [payingFromWallet, setPayingFromWallet] = useState(false);

  // Chat message state
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  // Moderator actions modal state
  const [selectedSlotForAction, setSelectedSlotForAction] = useState<GroupSlot | null>(null);
  const [actionType, setActionType] = useState<'moderator' | 'default' | null>(null);
  const [defaultReason, setDefaultReason] = useState('Missed scheduled Chama contribution');
  const [submittingModAction, setSubmittingModAction] = useState(false);

  // Peer-to-Peer Loan state
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [loanRequestAmount, setLoanRequestAmount] = useState<number>(0);
  const [loanRequestPurpose, setLoanRequestPurpose] = useState('To pay for an arrears (clear missed Chama days)');
  const [loanRepaymentPeriod, setLoanRepaymentPeriod] = useState<string>('Within 7 Days (Emergency Arrears Catch-up)');
  const [submittingLoanRequest, setSubmittingLoanRequest] = useState(false);
  const [exportingMembers, setExportingMembers] = useState(false);

  const [selectedLoanToFund, setSelectedLoanToFund] = useState<PeerLoanRequest | null>(null);
  const [lenderAgreedTerms, setLenderAgreedTerms] = useState(false);
  const [submittingFund, setSubmittingFund] = useState(false);
  const [loanFeePaymentCode, setLoanFeePaymentCode] = useState('');
  const [submittingLoanFee, setSubmittingLoanFee] = useState(false);
  const [submittingCompleteRound, setSubmittingCompleteRound] = useState(false);

  // Member removal modal state (for moderators)
  const [slotToRemove, setSlotToRemove] = useState<GroupSlot | null>(null);
  const [removeReason, setRemoveReason] = useState('Non-participation in mandatory daily Chama payment');
  const [submittingRemove, setSubmittingRemove] = useState(false);
  const [claimingLender, setClaimingLender] = useState(false);

  // Group-level moderator-only theme state (Section 3)
  const [togglingTheme, setTogglingTheme] = useState(false);

  async function handleToggleGroupTheme() {
    if (!group || !isModerator) return;
    const currentTheme = group.theme || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTogglingTheme(true);
    try {
      await api.updateGroupTheme(group.id, nextTheme);
      setGroup((prev) => (prev ? { ...prev, theme: nextTheme } : null));
      onNotify('success', `Chama group theme switched to ${nextTheme} mode.`);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update group theme');
    } finally {
      setTogglingTheme(false);
    }
  }

  // Member Financial Statement Modal state
  const [selectedStatementMember, setSelectedStatementMember] = useState<{ id: number; name: string } | null>(null);
  const [statementData, setStatementData] = useState<MemberStatement | null>(null);
  const [loadingStatement, setLoadingStatement] = useState(false);

  // PROMPT 3: 3-Step Slot Picking state
  const [slotPickerTarget, setSlotPickerTarget] = useState<GroupSlot | null>(null);
  const [slotPickerStep, setSlotPickerStep] = useState<1 | 2 | 3>(1);
  const [slotPickerSubmitting, setSlotPickerSubmitting] = useState(false);

  // PROMPT 3: Arrears clearing modal state
  const [showArrearsModal, setShowArrearsModal] = useState(false);
  const [selectedMissedDays, setSelectedMissedDays] = useState<number[]>([]);
  const [arrearsPaymentCode, setArrearsPaymentCode] = useState('');
  const [submittingArrears, setSubmittingArrears] = useState(false);

  // Invite-Only and Entry Request states
  const [showInviteRequestModal, setShowInviteRequestModal] = useState(false);
  const [desiredSlotForInvite, setDesiredSlotForInvite] = useState<number | null>(null);
  const [inviteRequestNote, setInviteRequestNote] = useState('');
  const [submittingInviteRequest, setSubmittingInviteRequest] = useState(false);

  const [showModeratorInvitesModal, setShowModeratorInvitesModal] = useState(false);
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null);
  const [manualInviteCodeInput, setManualInviteCodeInput] = useState('');
  const [showManualCodeModal, setShowManualCodeModal] = useState(false);

  // In-Group Award Coins Modal state (Section 8.1)
  const [showAwardCoinsModal, setShowAwardCoinsModal] = useState(false);
  const [selectedAwardRecipientIds, setSelectedAwardRecipientIds] = useState<number[]>([]);
  const [coinsToAward, setCoinsToAward] = useState<number>(5);
  const [coinAwardNote, setCoinAwardNote] = useState<string>('Applauding great Chama commitment & prompt payments! 🌟');
  const [submittingCoinAward, setSubmittingCoinAward] = useState(false);

  // Moderator Dormant Warning Modal state (Chama Status Engine)
  const [showDormantWarningModal, setShowDormantWarningModal] = useState(false);
  const [dormantTargetSlot, setDormantTargetSlot] = useState<GroupSlot | null>(null);
  const [dormantWarningReason, setDormantWarningReason] = useState('No contribution or activity recorded for consecutive days. Arrears clearing required.');
  const [dormantWarningDeadlineDays, setDormantWarningDeadlineDays] = useState<number>(3);
  const [dormantSuggestLoan, setDormantSuggestLoan] = useState<boolean>(true);
  const [submittingDormantWarning, setSubmittingDormantWarning] = useState(false);
  const [checkingSlotReorder, setCheckingSlotReorder] = useState(false);

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  async function loadGroup() {
    setLoading(true);
    setError(null);
    try {
      const [data, prodsRes, loansRes] = await Promise.all([
        api.getGroup(groupId),
        api.getProducts(),
        api.getGroupLoans(groupId).catch(() => ({ loans: [] })),
      ]);
      setGroup(data.group);
      setLoans(loansRes.loans || []);
      if (data.group && !paymentAmount) {
        setPaymentAmount(data.group.dailyAmount);
      }

      // Filter products from other items/merchants (guaranteeing at least 5 recommendations)
      const others = prodsRes.products.filter(
        (p: Product) => p.id !== data.group?.productId
      );
      setRecommendedProducts(others);
    } catch (err: any) {
      setError(err.message || 'Failed to load group details.');
    } finally {
      setLoading(false);
    }
  }

  // Find user's slot in this group
  const mySlot = currentUser && group
    ? group.slots.find(s => s.userId === currentUser.id && s.status === 'active')
    : null;

  // Pay slot directly using wallet credit balance (from loan or store credit)
  async function handlePayFromWallet() {
    if (!currentUser || !mySlot || !group) return;
    const amountToPay = Math.min(paymentAmount || group.dailyAmount, currentUser.credit || 0);
    if (amountToPay <= 0) {
      onNotify('error', 'You do not have sufficient wallet balance to pay.');
      return;
    }

    setPayingFromWallet(true);
    try {
      const res = await api.paySlotFromWallet(group.id, {
        slotNumber: mySlot.slotNumber,
        amount: amountToPay,
      });
      currentUser.credit = res.walletBalance;
      setGroup(res.group);
      onNotify('success', res.message);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to pay from wallet');
    } finally {
      setPayingFromWallet(false);
    }
  }

  // Submit Peer Loan Request
  async function handleRequestPeerLoan(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !mySlot || !group) return;
    if (loanRequestAmount <= 0) {
      onNotify('error', 'Please enter a valid loan amount.');
      return;
    }

    setSubmittingLoanRequest(true);
    try {
      const res = await api.requestPeerLoan(group.id, {
        amount: Number(loanRequestAmount),
        purpose: loanRequestPurpose.trim() || 'To pay for an arrears (clear missed Chama days)',
        repaymentPeriod: loanRepaymentPeriod,
      });
      onNotify('success', res.message);
      setShowLoanModal(false);
      setLoanRequestAmount(0);
      setLoanRequestPurpose('To pay for an arrears (clear missed Chama days)');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit loan request');
    } finally {
      setSubmittingLoanRequest(false);
    }
  }

  // Export Group Members to CSV (for Administrators)
  async function handleExportMembers() {
    if (!group) return;
    setExportingMembers(true);
    try {
      const csvData = await api.exportGroupMembersCsv(group.id);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `chama_${group.id}_members_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onNotify('success', `Exported all members of ${group.name} to CSV successfully.`);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to export members list.');
    } finally {
      setExportingMembers(false);
    }
  }

  // 3rd-Party Lender Funds Member Wallet directly
  async function handleConfirmFundLoan() {
    if (!currentUser || !selectedLoanToFund || !group) return;
    if (!lenderAgreedTerms) {
      onNotify('error', 'Please confirm that loan terms and repayments are handled manually outside the platform.');
      return;
    }

    setSubmittingFund(true);
    try {
      const res = await api.fundPeerLoan(group.id, selectedLoanToFund.id);
      onNotify('success', res.message);
      setSelectedLoanToFund(null);
      setLenderAgreedTerms(false);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to fund member wallet');
    } finally {
      setSubmittingFund(false);
    }
  }

  // Lender pays mandatory 3% platform commission to unlock console
  async function handleSubmitLoanFee(loanId: number, approvedAmount: number) {
    if (!loanFeePaymentCode.trim() || !group) {
      onNotify('error', 'Please enter your M-Pesa transaction code for the 3% platform fee payment.');
      return;
    }

    setSubmittingLoanFee(true);
    try {
      const res = await api.submitLoanFee(group.id, loanId, {
        approvedAmount,
        paymentCode: loanFeePaymentCode.trim().toUpperCase(),
      });
      onNotify('success', res.message || '3% platform commission fee submitted successfully.');
      setLoanFeePaymentCode('');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit loan fee');
    } finally {
      setSubmittingLoanFee(false);
    }
  }

  // Complete group cycle / round when 100% target is reached
  async function handleCompleteRound() {
    if (!group) return;
    setSubmittingCompleteRound(true);
    try {
      const res = await api.completeGroupRound(group.id);
      setGroup(res.group);
      onNotify('success', res.message || 'Cycle completed! Item collection recorded and active total reset to zero for the next member.');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to complete round.');
    } finally {
      setSubmittingCompleteRound(false);
    }
  }

  // Moderator notifies 3rd party lenders
  async function handleNotifyLenders() {
    if (!currentUser || !group) return;
    try {
      await api.sendGroupChat(group.id, {
        kind: 'system',
        text: `🔔 MODERATOR NOTICE: Chama members are seeking optional peer-to-peer installment loans. 3rd-party lenders in this group can review open loan requests below and fund member wallets directly (3% platform commission applies). Loan agreements and repayments are settled manually outside Buyoll.`,
      });
      onNotify('success', 'Notification alert sent to group chat and 3rd-party lenders.');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to send alert');
    }
  }

  // Open Member Statement Modal
  async function handleOpenStatement(member: { id: number; name: string }) {
    setSelectedStatementMember(member);
    setLoadingStatement(true);
    setStatementData(null);
    try {
      const res = await api.getMemberStatement(member.id);
      setStatementData(res.statement);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load member statement');
    } finally {
      setLoadingStatement(false);
    }
  }

  // Handle Moderator Removing a Member for Non-Participation
  async function handleRemoveMemberConfirm() {
    if (!group || !slotToRemove) return;
    setSubmittingRemove(true);
    try {
      const res = await api.removeMember(group.id, { slotNumber: slotToRemove.slotNumber, reason: removeReason });
      setGroup(res.group);
      onNotify('success', res.message || `Member #${slotToRemove.slotNumber} removed and funds refunded to wallet.`);
      setSlotToRemove(null);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to remove member');
    } finally {
      setSubmittingRemove(false);
    }
  }

  // Handle 3rd-Party Lender claiming this group (1 lender per group limit: 1st come 1st serve)
  async function handleClaimGroupLender() {
    if (!currentUser || !group) return;
    setClaimingLender(true);
    try {
      const res = await api.claimGroupLender(group.id);
      setGroup(res.group);
      onNotify('success', res.message || 'You are now the authorized Third-Party Lender for this Chama group!');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to claim group lender desk');
    } finally {
      setClaimingLender(false);
    }
  }

  // Check if current user is moderator
  const isModerator = currentUser && group
    ? group.moderators?.includes(currentUser.id) || group.adminId === currentUser.id || currentUser.role === 'admin'
    : false;

  // Check if current user is third party lender
  const isThirdPartyLender = Boolean(
    currentUser?.role === 'lender' ||
    (group?.lenderId && currentUser && group.lenderId === currentUser.id)
  );
  const isAssignedGroupLender = Boolean(
    group?.lenderId && currentUser && group.lenderId === currentUser.id
  );

  // Post payment code
  async function handlePostPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !mySlot || !group) return;

    if (!mpesaCode.trim()) {
      onNotify('error', 'Please enter your M-Pesa transaction code.');
      return;
    }

    setSubmittingPayment(true);
    try {
      const res = await api.postPayment({
        type: 'group_installment',
        code: mpesaCode.trim().toUpperCase(),
        amount: Number(paymentAmount),
        groupId: group.id,
        slotNumber: mySlot.slotNumber,
        productId: group.productId,
      });

      onNotify('success', res.message);
      setMpesaCode('');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit payment code');
    } finally {
      setSubmittingPayment(false);
    }
  }

  // Send chat message
  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !group) return;
    if (!chatInput.trim()) return;

    setSendingChat(true);
    try {
      const res = await api.sendGroupChat(group.id, { text: chatInput.trim() });
      setGroup(res.group);
      setChatInput('');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to send message');
    } finally {
      setSendingChat(false);
    }
  }

  // Open in-group Award Coins modal (Section 8.1)
  function handleOpenAwardCoins(targetUserId?: number) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to award coins.');
      onOpenAuth();
      return;
    }
    if ((currentUser.coins || 0) < 1) {
      onNotify('error', `Insufficient coins! Your wallet has ${currentUser.coins || 0} coins. Please deposit coins in your Wallet.`);
      return;
    }
    if (targetUserId && targetUserId !== currentUser.id) {
      setSelectedAwardRecipientIds([targetUserId]);
    } else {
      const otherActive = group?.slots.filter(s => s.status === 'active' && s.userId && s.userId !== currentUser.id) || [];
      setSelectedAwardRecipientIds(otherActive.map(s => s.userId!).slice(0, 1));
    }
    setShowAwardCoinsModal(true);
  }

  // Submit in-group Award Coins
  async function handleConfirmAwardCoins(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !group) return;
    if (selectedAwardRecipientIds.length === 0) {
      onNotify('error', 'Please select at least one member to award.');
      return;
    }
    const numCoins = Math.max(1, Number(coinsToAward) || 5);
    const totalCoins = numCoins * selectedAwardRecipientIds.length;
    if ((currentUser.coins || 0) < totalCoins) {
      onNotify('error', `Insufficient coins! You have ${currentUser.coins || 0} coins in your wallet, but tried to award ${totalCoins} coins. Please top up in your Wallet first.`);
      return;
    }

    setSubmittingCoinAward(true);
    try {
      const res = await api.awardGroupMemberCoins(group.id, {
        targetUserIds: selectedAwardRecipientIds,
        coinAmount: numCoins,
        note: coinAwardNote.trim(),
      });
      if (res.group) setGroup(res.group);
      onNotify('success', res.message || `Awarded ${numCoins} coins each! 🌟`);
      setShowAwardCoinsModal(false);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to award coins');
    } finally {
      setSubmittingCoinAward(false);
    }
  }

  // Issue Formal Dormant Warning (Chama Status Engine)
  async function handleIssueDormantWarning(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !dormantTargetSlot || !dormantTargetSlot.userId) return;
    setSubmittingDormantWarning(true);
    try {
      const res = await api.warnDormantMember(group.id, {
        slotNumber: dormantTargetSlot.slotNumber,
        targetUserId: dormantTargetSlot.userId,
        reason: dormantWarningReason.trim(),
        deadlineDays: dormantWarningDeadlineDays,
      });
      onNotify('success', res.message || 'Formal warning issued and automated loan suggestion sent!');
      setShowDormantWarningModal(false);
      setDormantTargetSlot(null);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to issue warning');
    } finally {
      setSubmittingDormantWarning(false);
    }
  }

  // Trigger Daily Performance Check & Automatic Slot Reordering
  async function handleCheckReorder() {
    if (!group) return;
    setCheckingSlotReorder(true);
    try {
      const res = await api.checkReorderGroup(group.id);
      onNotify('success', res.message || 'Slot orders and priorities updated successfully!');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to reorder slots');
    } finally {
      setCheckingSlotReorder(false);
    }
  }

  // Handle Moderator Appoint Co-moderator
  async function handleAppointModerator(targetUserId: number) {
    if (!group) return;
    setSubmittingModAction(true);
    try {
      const res = await api.manageModerator(group.id, targetUserId, 'appoint');
      setGroup(res.group);
      onNotify('success', res.message);
      setActionType(null);
      setSelectedSlotForAction(null);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to appoint moderator');
    } finally {
      setSubmittingModAction(false);
    }
  }

  // Handle Moderator Record Default (Part 5)
  async function handleRecordDefault() {
    if (!group || !selectedSlotForAction) return;
    setSubmittingModAction(true);
    try {
      const res = await api.markDefault(group.id, selectedSlotForAction.slotNumber, defaultReason);
      setGroup(res.group);
      onNotify('success', res.message);
      setActionType(null);
      setSelectedSlotForAction(null);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to record default');
    } finally {
      setSubmittingModAction(false);
    }
  }

  // Check if current user has an invite request or code
  const myApprovedInvite = group?.inviteRequests?.find(
    r => r.userId === currentUser?.id && r.status === 'approved'
  );
  const myPendingInvite = group?.inviteRequests?.find(
    r => r.userId === currentUser?.id && r.status === 'pending'
  );

  // PROMPT 3: 3-step slot picking flow with Invite-Only Gate
  function handleDirectJoin(slot: GroupSlot) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to join this Chama slot.');
      onOpenAuth();
      return;
    }
    if (!group) return;

    // If group is invite-only and user doesn't have an approved invite, prompt to request invite
    if (group.isInviteOnly && !myApprovedInvite) {
      setDesiredSlotForInvite(slot.slotNumber);
      setShowInviteRequestModal(true);
      return;
    }

    setSlotPickerTarget(slot);
    setSlotPickerStep(1);
  }

  async function handleConfirmSlotPick() {
    if (!currentUser) {
      onNotify('info', 'Please sign in to join this Chama slot.');
      onOpenAuth();
      return;
    }
    if (!slotPickerTarget || !group) return;

    const codeToUse = myApprovedInvite?.issuedCode || manualInviteCodeInput.trim().toUpperCase() || slotPickerTarget.inviteCode || group.inviteCode;

    setSlotPickerSubmitting(true);
    try {
      const res = await api.joinGroup(group.id, codeToUse, slotPickerTarget.slotNumber);
      onNotify('success', res.message);
      setSlotPickerTarget(null);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to claim slot');
    } finally {
      setSlotPickerSubmitting(false);
    }
  }

  // Submit entry invite request
  async function handleSubmitInviteRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!group) return;

    setSubmittingInviteRequest(true);
    try {
      const res = await api.requestGroupInvite(group.id, {
        desiredSlot: desiredSlotForInvite || undefined,
        note: inviteRequestNote.trim(),
      });
      onNotify('success', res.message || 'Invite request submitted! Awaiting moderator approval.');
      setShowInviteRequestModal(false);
      setInviteRequestNote('');
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit invite request');
    } finally {
      setSubmittingInviteRequest(false);
    }
  }

  // Moderator decides invite request (Approve & Issue Entry Code or Decline)
  async function handleModeratorDecideInvite(requestId: string, action: 'approve' | 'decline') {
    if (!group) return;
    setDecidingRequestId(requestId);
    try {
      const res = await api.decideGroupInvite(group.id, { requestId, action });
      onNotify('success', res.message || `Request ${action}d!`);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to process invite request');
    } finally {
      setDecidingRequestId(null);
    }
  }

  // PROMPT 3: Pay for missed days (Arrears clearing)
  async function handlePayArrearsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !mySlot || !group) return;

    const trimmedCode = arrearsPaymentCode.trim().toUpperCase();
    if (!trimmedCode) {
      onNotify('error', 'Please enter your M-Pesa transaction code.');
      return;
    }

    if (!/^[A-Z0-9]{8,12}$/i.test(trimmedCode)) {
      onNotify('error', 'Invalid M-Pesa transaction code format. Must be 8-12 alphanumeric characters.');
      return;
    }

    if (selectedMissedDays.length === 0) {
      onNotify('error', 'Please select at least one missed day to clear.');
      return;
    }

    const totalArrearsAmount = selectedMissedDays.length * group.dailyAmount;
    setSubmittingArrears(true);
    try {
      const res = await api.payDay(group.id, {
        slotNumber: mySlot.slotNumber,
        days: selectedMissedDays,
        amount: totalArrearsAmount,
        code: trimmedCode,
      });

      onNotify('success', res.message);
      setShowArrearsModal(false);
      setArrearsPaymentCode('');
      setSelectedMissedDays([]);
      loadGroup();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to submit arrears payment');
    } finally {
      setSubmittingArrears(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-4 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm text-slate-500">Loading Chama details...</p>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="p-4 bg-red-50 text-red-700 rounded-xl mb-4 text-sm">{error || 'Chama not found'}</div>
        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          Return to Announcements
        </button>
      </div>
    );
  }

  const occupiedSlots = group.slots.filter(s => s.status === 'active').length;
  const availableSlots = group.size - occupiedSlots;

  const isDarkGroup = group.theme === 'dark';

  return (
    <div className={`transition-colors duration-200 ${isDarkGroup ? 'dark bg-[#0b1411] text-white min-h-screen py-6' : 'bg-[#F9FBF9] text-slate-900 py-6'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back button */}
        <button
          onClick={() => onNavigate('product', group.productId)}
          className={`flex items-center gap-1.5 text-xs mb-4 transition-colors ${isDarkGroup ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'}`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Product Details</span>
        </button>

        {/* Chama Hero Header */}
        <div className={`border rounded-2xl p-6 sm:p-8 mb-8 shadow-xs ${isDarkGroup ? 'bg-[#121c18] border-[#20322b] text-white' : 'bg-white border-slate-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-bold px-2.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full uppercase tracking-wider">
                  {group.status === 'active' ? 'Active Group' : group.status}
                </span>
                <span className={`text-xs ${isDarkGroup ? 'text-slate-400' : 'text-slate-500'}`}>
                  {group.size}-Member Rotation · Every {group.cycleDays} Days
                </span>
                {isModerator && (
                  <>
                    <span className="text-xs bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      <span>You are a Moderator</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleGroupTheme}
                      disabled={togglingTheme}
                      title={isDarkGroup ? 'Switch this Chama group to Light theme' : 'Switch this Chama group to Dark theme'}
                      className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 border transition-all cursor-pointer shadow-xs ${
                        isDarkGroup
                          ? 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
                          : 'bg-slate-900 text-white border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      {isDarkGroup ? (
                        <>
                          <Sun className="w-3 h-3 text-slate-950" />
                          <span>Theme: Dark</span>
                        </>
                      ) : (
                        <>
                          <Moon className="w-3 h-3 text-amber-300" />
                          <span>Theme: Light</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowModeratorInvitesModal(true)}
                      className="text-xs bg-[#0E5A3C] hover:bg-[#0b4830] text-white font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>
                        Invite Requests (
                        {(group.inviteRequests || []).filter(r => r.status === 'pending').length}
                        )
                      </span>
                    </button>
                  </>
                )}
                {!isModerator && isDarkGroup && (
                  <span className="text-xs bg-slate-800 text-slate-300 font-medium px-2 py-0.5 rounded-full flex items-center gap-1 border border-slate-700">
                    <Moon className="w-3 h-3 text-amber-300" />
                    <span>Group Theme: Dark (Moderator Controlled)</span>
                  </span>
                )}
              </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {group.name}
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Saving for: <b className="text-slate-900">{group.productTitle}</b> (KSh {group.productPrice.toLocaleString()})
            </p>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 shrink-0">
            <div>
              <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                Daily Contribution
              </div>
              <div className="text-2xl font-black text-[#0E5A3C] tabular-nums">
                KSh {group.dailyAmount.toLocaleString()}
                <span className="text-xs font-normal text-slate-500"> / day</span>
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200"></div>
            <div>
              <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">
                Slot Capacity
              </div>
              <div className="text-sm font-bold text-slate-900">
                {occupiedSlots} / {group.size} Joined
              </div>
              <div className="text-[11px] text-emerald-700 font-semibold">
                {availableSlots} available
              </div>
            </div>
          </div>
        </div>

        {/* Start Notice */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 gap-2">
          <p className="flex items-center gap-1.5 text-emerald-800 font-medium">
            <Info className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Your group starts as soon as the first member joins. Other members can join while the group is active.
            </span>
          </p>
          <div className="font-mono bg-slate-100 px-2.5 py-1 rounded text-slate-700">
            Invite Code: <b className="text-slate-900">{group.inviteCode}</b>
          </div>
        </div>
      </div>

      {/* INVITE-ONLY ADMISSION & ENTRY CODE STATUS BANNER */}
      {!mySlot && (
        <div className="mb-6">
          {myApprovedInvite ? (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 font-black text-[10px] uppercase rounded-full">
                      Entry Invite Approved
                    </span>
                    <span className="font-mono font-black text-emerald-900 text-xs">
                      Code: {myApprovedInvite.issuedCode}
                    </span>
                  </div>
                  <h4 className="text-sm font-extrabold text-emerald-950 mt-0.5">
                    Your Admission Request Has Been Approved by the Moderator!
                  </h4>
                  <p className="text-xs text-emerald-800">
                    You can now join Slot #{myApprovedInvite.desiredSlot || 'Any Open Slot'} in this Chama. Click on your slot below to activate your rotation!
                  </p>
                </div>
              </div>
            </div>
          ) : myPendingInvite ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-amber-200 text-amber-900 font-black text-[10px] uppercase rounded-full">
                      Pending Moderator Review
                    </span>
                    <span className="text-xs text-amber-800 font-semibold">
                      Slot #{myPendingInvite.desiredSlot || 'Any'}
                    </span>
                  </div>
                  <h4 className="text-sm font-extrabold text-amber-950 mt-0.5">
                    Your Entry Invite Request is Awaiting Approval
                  </h4>
                  <p className="text-xs text-amber-800">
                    The group moderator will review your request and issue an entry code. You will receive a push notification alert once approved!
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-slate-50 border border-emerald-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0E5A3C] text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-[#0E5A3C] text-white font-black text-[10px] uppercase rounded-full">
                      Invite-Only Admission
                    </span>
                    <span className="text-xs text-slate-500">
                      Store Owner / Moderator Controlled
                    </span>
                  </div>
                  <h4 className="text-sm font-extrabold text-slate-900 mt-0.5">
                    Join This Chama by Moderator Invitation
                  </h4>
                  <p className="text-xs text-slate-600">
                    This Chama requires an approved entry code to guarantee member payment commitment. Request an invite or enter your code to claim a slot.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setDesiredSlotForInvite(null);
                    setShowInviteRequestModal(true);
                  }}
                  className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Request Entry Invite
                </button>
                <button
                  onClick={() => setShowManualCodeModal(true)}
                  className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Enter Invite Code
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REAL-TIME GROUP NOTIFICATIONS FEED (Prompt 3) */}
      {group.notifications && group.notifications.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                Real-Time Chama Broadcast Feed
              </h3>
            </div>
            <span className="text-[11px] font-mono text-emerald-700">
              {group.notifications.length} update{group.notifications.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {group.notifications.slice(0, 4).map((notif) => (
              <div
                key={notif.id}
                className="bg-white/80 p-2.5 rounded-xl border border-emerald-100 text-xs flex items-center justify-between gap-2 shadow-2xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">
                    {notif.type === 'loan_request' ? '📢' : notif.type === 'payment_submitted' ? '⏳' : notif.type === 'payment_approved' ? '✅' : '🔔'}
                  </span>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block truncate">{notif.title}</span>
                    <span className="text-[11px] text-slate-600 block truncate">{notif.message}</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VISUAL CONTRIBUTION CALENDAR (D3 6-MONTH SAVINGS HEAT MAP) */}
      <ContributionCalendar group={group} isDark={isDarkGroup} />

      {/* REAL-TIME CONTRIBUTION TRACKER & ROTATION CYCLE COMPONENT (Specification Section 6) */}
      {(() => {
        const currentRecipientSlot = group.currentRecipientSlot || 1;
        const currentRecipient = group.slots.find(s => s.slotNumber === currentRecipientSlot);
        const currentRecipientName = currentRecipient?.userName || `Member #${currentRecipientSlot}`;
        const totalGroupPaidTowardsCurrentRound = group.currentRoundPaid !== undefined
          ? group.currentRoundPaid
          : group.slots.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
        const targetProductAmount = group.productPrice;
        const roundBalanceRemaining = Math.max(0, targetProductAmount - totalGroupPaidTowardsCurrentRound);
        const roundProgressPercent = Math.min(100, Math.round((totalGroupPaidTowardsCurrentRound / targetProductAmount) * 100));
        const isEligibleToCollect = roundProgressPercent >= 100 || Boolean(group.isReadyForPickup);
        const canConfirmPickup = isModerator || (currentUser && currentUser.id === currentRecipient?.userId);

        return (
          <div className="bg-white border-2 border-emerald-600/30 rounded-2xl p-6 sm:p-7 mb-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0E5A3C] to-emerald-700 text-white flex items-center justify-center font-black shadow-xs shrink-0">
                  <Sparkles className="w-6 h-6 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-[#0E5A3C]">
                      Real-Time Contribution Progress Tracker · Cycle #{group.currentRound || 1}
                    </span>
                    {isEligibleToCollect && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                        <span>Ready For Pickup!</span>
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
                    Next Recipient: <span className="text-[#0E5A3C]">{currentRecipientName}</span> (Member #{currentRecipientSlot})
                  </h3>
                </div>
              </div>

              {/* Numerical Breakdown: Total Paid vs Target vs Remaining Balance */}
              <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs shrink-0">
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Total Paid Vis-à-Vis</span>
                  <b className="text-[#0E5A3C] font-mono text-sm sm:text-base">
                    KSh {totalGroupPaidTowardsCurrentRound.toLocaleString()}
                  </b>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Target Needed</span>
                  <b className="text-slate-900 font-mono text-sm sm:text-base">
                    KSh {targetProductAmount.toLocaleString()}
                  </b>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold block uppercase">Balance Remaining</span>
                  <b className={`font-mono text-sm sm:text-base ${roundBalanceRemaining === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    KSh {roundBalanceRemaining.toLocaleString()}
                  </b>
                </div>
              </div>
            </div>

            {/* Dynamic Progress Bar */}
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Cycle Progress Toward Product Acquisition:</span>
                  <b className="text-[#0E5A3C]">{roundProgressPercent}% Completed</b>
                </span>
                <span className="text-slate-500 font-mono text-[11px]">
                  {roundBalanceRemaining > 0 ? `KSh ${roundBalanceRemaining.toLocaleString()} still required` : 'Target 100% Achieved!'}
                </span>
              </div>

              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200 p-0.5 relative">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-teal-600 to-[#0E5A3C] rounded-full transition-all duration-500 shadow-xs"
                  style={{ width: `${roundProgressPercent}%` }}
                />
              </div>
            </div>

            {/* Motivational Encouragement & Lagging Members Call-to-Action */}
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-xs text-slate-600 leading-relaxed flex items-center gap-2">
                <span className="text-base">📢</span>
                <span>
                  <b>Group Motivation:</b> All Chama members: maintain scheduled daily contributions! Members lacking behind, please <b>pull up your socks</b> so {currentRecipientName} picks their item on schedule without delay.
                </span>
              </p>

              {/* When 100% achieved: Tick for Member to Pick Item & Reset to 0 for Next Member */}
              {isEligibleToCollect ? (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="px-3 py-1.5 bg-emerald-100 text-emerald-900 text-xs font-bold rounded-xl flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-700" />
                    <span>✓ Ticked for {currentRecipientName} to Pick Item</span>
                  </div>
                  {canConfirmPickup && (
                    <button
                      onClick={handleCompleteRound}
                      disabled={submittingCompleteRound}
                      className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5 shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{submittingCompleteRound ? 'Advancing Cycle...' : 'Record Collection & Advance (Resets Total to KSh 0)'}</span>
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            {/* Past Completed Rotation Cycles Ledger History */}
            {group.deliveredRounds && group.deliveredRounds.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Past Delivered Cycles Ledger ({group.deliveredRounds.length} items collected):
                </span>
                <div className="flex gap-2 flex-wrap text-xs">
                  {group.deliveredRounds.map((rd, i) => (
                    <div key={i} className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Round {rd.roundNumber}: Delivered to <b>{rd.recipientName}</b> (KSh {rd.totalPaid.toLocaleString()} paid)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Grid: Slots on Left (60%), Sidebar & Chat on Right (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: Slots Grid (~65%) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Member Slots & Allocation Rotation</span>
                <span className="text-xs font-normal text-slate-500">({group.size} total)</span>
              </h2>
              <span className="text-xs text-slate-500">
                1 item delivered every {group.cycleDays} days
              </span>
            </div>

            {/* Slots Rotating Payout Queue Order Bar */}
            <div className="mb-4 p-3 bg-gradient-to-r from-emerald-50 via-teal-50 to-amber-50/50 border border-emerald-200/80 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-slate-800 text-[11px] flex-wrap">
                  <span>Queue Priority:</span>
                  <span className="text-emerald-700 font-extrabold bg-emerald-100/70 px-1.5 py-0.5 rounded">★ Best (Early)</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-blue-700 font-extrabold bg-blue-100/70 px-1.5 py-0.5 rounded">Better (On-Time)</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-slate-600 font-extrabold bg-slate-100 px-1.5 py-0.5 rounded">Good</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-amber-800 font-extrabold bg-amber-100/80 px-1.5 py-0.5 rounded">⚠️ Slow Payer Block</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Consecutive on-time contributions advance payout queue priority. Slow/dormant members move to back of queue until arrears are cleared.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentUser && (
                  <button
                    onClick={() => handleOpenAwardCoins()}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    <span>Award Coins</span>
                  </button>
                )}
                <button
                  onClick={handleCheckReorder}
                  disabled={checkingSlotReorder}
                  title="Run daily performance audit and reorder queue"
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${checkingSlotReorder ? 'animate-spin' : ''}`} />
                  <span>{checkingSlotReorder ? 'Auditing...' : 'Audit & Reorder'}</span>
                </button>
              </div>
            </div>

            {/* Slots List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {group.slots.map((slot) => {
                const isMe = currentUser && slot.userId === currentUser.id;
                const isModSlot = slot.userId && group.moderators.includes(slot.userId);
                const isReplacement = slot.status === 'replacement_eligible';
                const isOpen = slot.status === 'open';
                const isActive = slot.status === 'active';
                const deliveryDay = slot.slotNumber * group.cycleDays;
                const percentPaid = Math.min(100, Math.round(((slot.paidAmount || 0) / group.productPrice) * 100));

                return (
                  <div
                    key={slot.slotNumber}
                    className={`relative p-4 rounded-xl border-2 transition-all flex flex-col justify-between ${
                      isMe
                        ? 'border-[#0E5A3C] bg-emerald-50/30'
                        : isReplacement
                        ? 'border-amber-400 bg-amber-50/40'
                        : isActive
                        ? 'border-slate-200 bg-white'
                        : 'border-dashed border-slate-300 bg-slate-50/50'
                    }`}
                  >
                    <div>
                      {/* Top Header of Slot with Circular Avatar in Upper-Right Corner (Specification Section 14) */}
                      <div className="flex items-start justify-between mb-2 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-7 h-7 rounded-lg flex items-center justify-center font-extrabold text-xs shrink-0 ${
                              isActive ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            #{slot.slotNumber}
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 block leading-tight truncate">
                              {isActive ? slot.userName : isReplacement ? 'Vacated Slot (Open)' : 'Open Slot'}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Receives item on <b>Day {deliveryDay}</b>
                            </span>
                          </div>
                        </div>

                        {/* Badges & Circular Avatar in Upper-Right Corner */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex flex-col items-end gap-0.5">
                            {isModSlot && (
                              <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.2 rounded">
                                Moderator
                              </span>
                            )}
                            {isMe && (
                              <span className="text-[9px] bg-[#0E5A3C] text-white font-bold px-1.5 py-0.2 rounded">
                                You
                              </span>
                            )}
                            {isReplacement && (
                              <span className="text-[9px] bg-amber-200 text-amber-900 font-bold px-1.5 py-0.2 rounded">
                                Vacated
                              </span>
                            )}
                            {isActive && slot.paidOut && (
                              <span className="text-[9px] bg-purple-100 text-purple-900 font-bold px-1.5 py-0.2 rounded border border-purple-200">
                                ✓ Paid Out
                              </span>
                            )}
                            {isActive && slot.memberStatus === 'dormant' ? (
                              <span className="text-[9px] bg-red-100 text-red-900 font-bold px-1.5 py-0.2 rounded border border-red-300 animate-pulse">
                                🛑 Dormant (3+ d)
                              </span>
                            ) : isActive && slot.memberStatus === 'slow_payer' ? (
                              <span className="text-[9px] bg-amber-100 text-amber-900 font-bold px-1.5 py-0.2 rounded border border-amber-300">
                                ⚠️ Slow Payer
                              </span>
                            ) : isActive && slot.priorityLevel === 'Best' ? (
                              <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded border border-emerald-300">
                                ★ Best
                              </span>
                            ) : isActive && slot.priorityLevel === 'Better' ? (
                              <span className="text-[9px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.2 rounded border border-blue-300">
                                Better
                              </span>
                            ) : isActive && slot.priorityLevel === 'Good' ? (
                              <span className="text-[9px] bg-slate-100 text-slate-700 font-bold px-1.5 py-0.2 rounded border border-slate-200">
                                Good
                              </span>
                            ) : null}
                          </div>

                          {/* Circular Avatar Container (Section 14) */}
                          <div className="relative shrink-0">
                            {slot.userAvatar ? (
                              <img
                                src={resolveImageUrl(slot.userAvatar)}
                                alt={slot.userName || 'Member'}
                                className="w-9 h-9 rounded-full object-cover border-2 border-emerald-600/40 shadow-xs"
                                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                              />
                            ) : isActive ? (
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-700 to-[#0E5A3C] text-white font-bold text-[11px] flex items-center justify-center border-2 border-white shadow-xs">
                                {slot.userName ? slot.userName.slice(0, 2).toUpperCase() : `M${slot.slotNumber}`}
                              </div>
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400">
                                <Users className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Payment Progress Bar for Active Members */}
                      {isActive && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-semibold text-slate-700">
                              Payment Progress:
                            </span>
                            <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded-full ${
                              percentPaid === 100
                                ? 'bg-emerald-100 text-emerald-800'
                                : percentPaid > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
                              {percentPaid}% Paid
                            </span>
                          </div>

                          {/* Dynamic Bar: Fills up alongside payment progress; if member has not paid, bar remains empty at 0% */}
                          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200 p-0.5 relative">
                            {percentPaid > 0 ? (
                              <div
                                className="h-full bg-gradient-to-r from-emerald-500 via-teal-600 to-[#0E5A3C] rounded-full transition-all duration-500 shadow-xs"
                                style={{ width: `${percentPaid}%` }}
                              />
                            ) : (
                              // Member has not paid yet -> Bar remains completely empty!
                              <div className="w-0 h-full" />
                            )}
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
                            <span>KSh {(slot.paidAmount || 0).toLocaleString()} paid</span>
                            <span>
                              {slot.paidAmount === 0 ? (
                                <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.2 rounded">
                                  0% · Bar remains empty
                                </span>
                              ) : (
                                `KSh ${Math.max(0, group.productPrice - (slot.paidAmount || 0)).toLocaleString()} remaining`
                              )}
                            </span>
                          </div>

                          {/* PROMPT 3: Daily Calendar Contribution Tracker (Paid ✓, Pending ⏳, Missed ✗) */}
                          <div className="mt-2.5 pt-2 border-t border-slate-100">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                              <span>Daily Tracker ({Math.min(group.cycleDays, 10)} Days):</span>
                              <span className="font-mono text-[9px] text-slate-400">✓ Paid · ⏳ Pending · ✗ Missed</span>
                            </div>

                            {(() => {
                              const cycleDaysTotal = Math.min(group.cycleDays, 10);
                              const currentDayNum = Math.min(
                                cycleDaysTotal,
                                Math.max(1, Math.ceil((Date.now() - (slot.joinedAt || group.createdAt)) / 86400000))
                              );
                              const missedDaysForSlot: number[] = [];

                              return (
                                <>
                                  <div className="flex flex-wrap gap-1">
                                    {Array.from({ length: cycleDaysTotal }, (_, di) => {
                                      const dayNum = di + 1;
                                      const isPaid = (slot.paidDays || []).includes(dayNum);
                                      const isPending = (slot.pendingDays || []).includes(dayNum);
                                      const isMissed = !isPaid && !isPending && dayNum < currentDayNum;
                                      if (isMissed) missedDaysForSlot.push(dayNum);

                                      return (
                                        <span
                                          key={dayNum}
                                          title={`Day ${dayNum}: ${isPaid ? 'Paid (Verified)' : isPending ? 'Pending Verification' : isMissed ? 'Missed / Arrears' : 'Upcoming'}`}
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-0.5 border ${
                                            isPaid
                                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                              : isPending
                                              ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse'
                                              : isMissed
                                              ? 'bg-red-100 text-red-800 border-red-300'
                                              : 'bg-slate-50 text-slate-400 border-slate-200'
                                          }`}
                                        >
                                          <span>D{dayNum}</span>
                                          <span>{isPaid ? '✓' : isPending ? '⏳' : isMissed ? '✗' : '○'}</span>
                                        </span>
                                      );
                                    })}
                                  </div>

                                  {/* Pay for missed days arrears button (Prompt 3) */}
                                  {isMe && missedDaysForSlot.length > 0 && (
                                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-2">
                                      <div className="text-[11px] text-red-800 font-semibold">
                                        ⚠️ {missedDaysForSlot.length} missed day{missedDaysForSlot.length !== 1 ? 's' : ''} (KSh {(missedDaysForSlot.length * group.dailyAmount).toLocaleString()})
                                      </div>
                                      <button
                                        onClick={() => {
                                          setSelectedMissedDays(missedDaysForSlot);
                                          setShowArrearsModal(true);
                                        }}
                                        className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded transition-colors shadow-xs shrink-0 cursor-pointer"
                                      >
                                        Pay Missed Days
                                      </button>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>

                          {/* Dormant Member Inactivity Notice & Automated Loan Suggestion */}
                          {slot.dormantWarning && slot.dormantWarning.active && (
                            <div className="mt-2.5 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-950">
                              <div className="flex items-center gap-1.5 font-bold text-red-800 text-[11px] mb-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                <span>Dormant Inactivity Warning · Deadline: {new Date(slot.dormantWarning.deadline).toLocaleDateString()}</span>
                              </div>
                              <p className="text-[11px] text-red-700 leading-snug">{slot.dormantWarning.reason}</p>
                              {isMe && (
                                <div className="mt-2 pt-2 border-t border-red-200/60 flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-red-800 font-semibold">Need liquidity for this cycle?</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const remaining = Math.max(0, (slot.targetAmount || group.productPrice) - (slot.paidAmount || 0));
                                      setLoanRequestAmount(Math.min(remaining, group.dailyAmount * 2));
                                      setShowLoanModal(true);
                                    }}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded transition-colors shadow-xs cursor-pointer"
                                  >
                                    Apply for Member Loan
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Slot Actions / Status Footer */}
                    <div className="mt-3 pt-2 flex items-center justify-between gap-2">
                      {isActive ? (
                        <div className="flex items-center gap-2 w-full justify-between flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-slate-400 font-mono">
                              Code: {slot.inviteCode}
                            </span>
                            {/* Member Financial Statement & Ledger button */}
                            <button
                              onClick={() => handleOpenStatement({ id: slot.userId!, name: slot.userName || 'Member' })}
                              title="View Customer Statement & Ledger"
                              className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded transition-colors cursor-pointer"
                            >
                              <FileText className="w-2.5 h-2.5 text-[#0E5A3C]" />
                              <span>Statement</span>
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Award Coins to Member mechanism on his card (Section 8.1 & Prompt 5) */}
                            {currentUser && slot.userId !== currentUser.id && (
                              <button
                                onClick={() => handleOpenAwardCoins(slot.userId ?? undefined)}
                                title={`Award Coins to ${slot.userName || 'Member'}`}
                                className="flex items-center gap-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                              >
                                <Coins className="w-3 h-3 text-amber-600" />
                                <span>Award Coins</span>
                              </button>
                            )}

                            {/* Moderator Warning Button for Slow/Dormant Members */}
                            {isModerator && slot.userId !== currentUser?.id && (
                              <button
                                onClick={() => {
                                  setDormantTargetSlot(slot);
                                  setDormantWarningReason('Unpaid daily Chama contributions exceeding 3 consecutive cycles');
                                  setShowDormantWarningModal(true);
                                }}
                                title="Issue Dormant / Missed Payment Warning"
                                className="flex items-center gap-1 px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-bold rounded transition-colors cursor-pointer"
                              >
                                <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                                <span>Warn</span>
                              </button>
                            )}

                            {/* Moderator Remove Member Icon for Daily Non-Payment (Refunds to Wallet) */}
                            {isModerator && slot.userId !== currentUser?.id && (
                              <button
                                onClick={() => {
                                  setSlotToRemove(slot);
                                  setRemoveReason('Non-participation in mandatory daily Chama payment');
                                }}
                                title="Remove Member for non-payment (Refunds balance to wallet & vacates slot)"
                                className="flex items-center gap-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold rounded transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-2.5 h-2.5 text-red-600" />
                                <span>Remove</span>
                              </button>
                            )}

                            {/* Moderator Slot Management Menu */}
                            {isModerator && slot.userId !== currentUser?.id && (
                              <button
                                onClick={() => {
                                  setSelectedSlotForAction(slot);
                                  setActionType('default');
                                }}
                                title="Moderator Options"
                                className="px-2 py-1 text-[10px] text-slate-500 hover:text-red-600 hover:bg-slate-100 rounded cursor-pointer"
                              >
                                Manage
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="w-full">
                          <button
                            onClick={() => handleDirectJoin(slot)}
                            className="w-full py-1.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors"
                          >
                            {isReplacement ? 'Claim Replacement Slot' : 'Join as Member #' + slot.slotNumber}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* PEER TO PEER (P2P) CHAMA LOAN DESK (OPTIONAL) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E5A3C] flex items-center justify-center">
                  <HandCoins className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>P2P Chama Loan Desk</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full uppercase">
                      Optional
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    3rd-party lenders fund member wallets directly · 1% platform fee · Repayment arranged outside platform
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Standard Members Only: Request Loan button (hidden for 3rd-party lenders) */}
                {mySlot && !isThirdPartyLender && currentUser?.role !== 'lender' && (
                  <button
                    onClick={() => {
                      const remaining = Math.max(0, (mySlot.targetAmount || group.productPrice) - (mySlot.paidAmount || 0));
                      setLoanRequestAmount(Math.min(remaining, group.dailyAmount * 2));
                      setShowLoanModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                  >
                    <HandCoins className="w-3.5 h-3.5" />
                    <span>Request Loan</span>
                  </button>
                )}

                {isModerator && (
                  <button
                    onClick={handleNotifyLenders}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors"
                    title="Alert 3rd-party lenders in group chat"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Alert Lenders</span>
                  </button>
                )}
              </div>
            </div>

            {/* THIRD-PARTY LENDER STATUS & 1-LENDER-PER-GROUP ENFORCEMENT */}
            <div className="mb-4">
              {group.lenderId ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-emerald-950">
                      Designated 3rd-Party Lender: <b>{group.lenderName || 'Verified Lender'}</b> (1 lender per group limit fulfilled)
                    </span>
                  </div>
                  {isAssignedGroupLender && (
                    <span className="text-[11px] font-bold bg-[#0E5A3C] text-white px-2.5 py-0.5 rounded-full shrink-0">
                      You are Serving This Group
                    </span>
                  )}
                </div>
              ) : currentUser?.role === 'lender' ? (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-indigo-950 block">This group needs an authorized Third-Party Lender!</span>
                    <span className="text-indigo-800 text-[11px]">
                      Rule: Only 1 lender is accepted per group (First come, first served).
                    </span>
                  </div>
                  <button
                    onClick={handleClaimGroupLender}
                    disabled={claimingLender}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition-colors shadow-xs shrink-0"
                  >
                    {claimingLender ? 'Claiming...' : 'Serve as Group Lender'}
                  </button>
                </div>
              ) : null}
            </div>

            {/* Information Notice */}
            <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 mb-4 flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <b>How P2P Loans Work:</b> A standard member clicks "Request Loan" to post a request to the group chat and loan board. An authorized 3rd-party lender processes the external payment manually, then marks the loan as <b>"Funded"</b> to credit the member's Buyoll wallet. A 1% platform fee log applies. All loan agreements, interest, and repayments are conducted manually outside the Buyoll platform.
              </div>
            </div>

            {/* DEDICATED THIRD-PARTY LENDER DASHBOARD SECTION */}
            {(currentUser?.role === 'lender' || isAssignedGroupLender) && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <HandCoins className="w-4 h-4 text-[#FF6A00]" />
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Third-Party Lender Group Desk & 3% Fee Audit Log
                    </h4>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {loans.filter(l => l.status === 'open' || l.status === 'fee_pending').length} Pending Requests
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mb-3">
                  Review open loan requests from standard members below. Disburse the external payment, then click <b>Mark as 'Funded'</b> to deposit credit directly to the member's wallet for Chama installment continuity.
                </p>

                {/* 3% Fee Summary Log */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-white p-3 rounded-lg border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Total Group Requests</span>
                    <b className="text-slate-900 font-mono text-sm">
                      KSh {loans.reduce((acc, l) => acc + l.amount, 0).toLocaleString()}
                    </b>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">1% Platform Fee Log</span>
                    <b className="text-[#FF6A00] font-mono text-sm">
                      KSh {loans.reduce((acc, l) => acc + (l.platformFeeAmount || Math.max(1, Math.round(l.amount * 0.01))), 0).toLocaleString()}
                    </b>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-semibold block uppercase">Funded Loans</span>
                    <b className="text-emerald-700 font-mono text-sm">
                      {loans.filter(l => l.status === 'funded').length} of {loans.length}
                    </b>
                  </div>
                </div>
              </div>
            )}

            {/* Loan Requests List */}
            {loans.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <HandCoins className="w-6 h-6 text-slate-300 mx-auto mb-1" />
                <p className="text-xs text-slate-500">No active loan requests in this Chama group.</p>
                {mySlot && !isThirdPartyLender && currentUser?.role !== 'lender' && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Need help keeping your slot active? Click "Request Loan" above.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {loans.map((loan) => {
                  const fee = loan.platformFeeAmount || Math.max(1, Math.round(loan.amount * 0.01));
                  const isFunded = loan.status === 'funded';
                  const isMyRequest = currentUser && loan.requesterId === currentUser.id;

                  return (
                    <div
                      key={loan.id}
                      className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isFunded
                          ? 'border-emerald-200 bg-emerald-50/40'
                          : 'border-slate-200 bg-white shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-slate-900">
                            {loan.requesterName} (Member #{loan.slotNumber})
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              isFunded
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isFunded ? 'Funded' : 'Pending Loan Request'}
                          </span>
                          {isMyRequest && (
                            <span className="text-[10px] bg-slate-900 text-white font-bold px-1.5 py-0.2 rounded">
                              Your Request
                            </span>
                          )}
                        </div>

                        <div className="text-sm font-black text-slate-900">
                          KSh {loan.amount.toLocaleString()}
                          <span className="text-xs font-normal text-slate-500 ml-2">
                            1% Platform Fee Log: <b className="text-[#FF6A00]">KSh {fee.toLocaleString()}</b> (Net Disbursed: KSh {loan.amount.toLocaleString()})
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 mt-0.5">
                          Purpose: {loan.purpose}
                        </p>

                        {isFunded && (
                          <div className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Funded by <b>{loan.fundedByUserName || '3rd-Party Lender'}</b> · 1% platform fee recorded · Credited to member wallet</span>
                          </div>
                        )}
                      </div>

                      {/* Action for 3rd-Party Lenders */}
                      <div>
                        {!isFunded && (
                          <button
                            onClick={() => {
                              if (!currentUser) {
                                onNotify('info', 'Please sign in to fund member loans.');
                                onOpenAuth();
                                return;
                              }
                              setSelectedLoanToFund(loan);
                              setLenderAgreedTerms(false);
                            }}
                            className="px-3.5 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap shadow-xs"
                          >
                            Mark as 'Funded' (External Payment Processed)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Payment Panel & Group Chat (~35%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Member Payment Box */}
          {mySlot ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  Your Member #{mySlot.slotNumber} Payment
                </h3>
                <span className="text-xs text-[#0E5A3C] font-bold">
                  Day {mySlot.slotNumber * group.cycleDays} Rotation
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl mb-4 text-xs text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span>Target Amount:</span>
                  <b className="text-slate-900">KSh {group.productPrice.toLocaleString()}</b>
                </div>
                <div className="flex justify-between">
                  <span>Total Paid So Far:</span>
                  <b className="text-emerald-700">KSh {(mySlot.paidAmount || 0).toLocaleString()}</b>
                </div>
                <div className="flex justify-between">
                  <span>Remaining:</span>
                  <b className="text-slate-900">
                    KSh {Math.max(0, group.productPrice - (mySlot.paidAmount || 0)).toLocaleString()}
                  </b>
                </div>
              </div>

              <form onSubmit={handlePostPayment} className="space-y-3">
                {/* Instant Wallet Payment Option (from Peer Loan or Store Credit) */}
                {currentUser && (currentUser.credit || 0) > 0 && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Wallet Credit Available</span>
                      </span>
                      <span className="text-xs font-black text-emerald-800 tabular-nums">
                        KSh {(currentUser.credit || 0).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-snug mb-2.5">
                      You have funds deposited from peer loans or previous returns. Apply them directly to pay for this slot!
                    </p>
                    <button
                      type="button"
                      disabled={payingFromWallet}
                      onClick={handlePayFromWallet}
                      className="w-full py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {payingFromWallet
                          ? 'Applying Payment...'
                          : `Pay KSh ${Math.min(paymentAmount || group.dailyAmount, currentUser.credit || 0).toLocaleString()} from Wallet`}
                      </span>
                    </button>
                  </div>
                )}

                <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-950 space-y-1">
                  <div className="flex items-center justify-between font-bold">
                    <span>
                      {group.merchantTill ? `Merchant Store Till: ${group.merchantTill}` : `Platform Till: 522533`}
                    </span>
                    <span className="text-[10px] bg-amber-200 px-1.5 py-0.2 rounded font-mono uppercase">
                      Buy Goods
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-snug">
                    <b>Manual M-Pesa Payment Notice:</b> This platform has <b>no escrow mechanism or M-Pesa STK push</b>. You must manually pay on your phone via M-Pesa Buy Goods to <b>{group.merchantTill || 'Platform Till 522533'}</b>. Once paid, key in your official M-Pesa transaction code and amount paid below for approval.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    M-Pesa Transaction Code
                  </label>
                  <input
                    type="text"
                    required
                    value={mpesaCode}
                    onChange={(e) => setMpesaCode(e.target.value.toUpperCase())}
                    placeholder="e.g. QJK4X8L2PA"
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Amount Paid (KSh)
                  </label>
                  <input
                    type="number"
                    min="10"
                    required
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="w-full py-2.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                >
                  {submittingPayment ? 'Submitting Payment Code...' : 'Post M-Pesa Code for Approval'}
                </button>
              </form>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-xs">
              <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-900 mb-1">Join this Chama to Contribute</h3>
              <p className="text-xs text-slate-500 mb-4">
                Choose an open slot from the list to join and receive this product on your rotation day.
              </p>
              {group.availableCount > 0 ? (
                <button
                  onClick={() => {
                    const firstOpen = group.slots.find(s => s.status === 'replacement_eligible' || s.status === 'open');
                    if (firstOpen) handleDirectJoin(firstOpen);
                  }}
                  className="w-full py-2.5 bg-[#FF6A00] text-white text-xs font-bold rounded-lg"
                >
                  Join Next Available Slot
                </button>
              ) : (
                <p className="text-xs text-amber-700 font-semibold">Group is currently full.</p>
              )}
            </div>
          )}

          {/* Group Chat & Rewards Activity */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col h-[400px]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h3 className="text-sm font-bold text-slate-900">Chama Chat & Peer Rewards</h3>
              <span className="text-[11px] text-slate-400">Your coins: {currentUser?.coins || 0}</span>
            </div>

            {/* Message Thread */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {group.chat && group.chat.length > 0 ? (
                group.chat.map((m) => (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-xl ${
                      m.kind === 'system'
                        ? 'bg-slate-100 text-slate-600'
                        : m.kind === 'reward'
                        ? 'bg-amber-50 text-amber-900 border border-amber-200 font-medium'
                        : 'bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <b className="text-slate-900">{m.senderName}</b>
                      <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="leading-snug">{m.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-8">No messages yet. Say hello!</p>
              )}
            </div>

            {/* Chat Input */}
            {currentUser ? (
              <form onSubmit={handleSendChat} className="pt-3 border-t border-slate-100 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Post message or update..."
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
                <button
                  type="submit"
                  disabled={sendingChat || !chatInput.trim()}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-400 text-center pt-3 border-t border-slate-100">
                Sign in to participate in group chat.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* CHAMA ACTIVITY FEED & FINANCIAL TRANSPARENCY SUMMARY VIEW */}
      <div className="mt-8 mb-8">
        <ChamaActivityFeed
          groupId={group.id}
          group={group}
          currentUser={currentUser}
          onNavigate={onNavigate}
        />
      </div>

      {/* SYSTEM-GENERATED SLOT REORDER AUDIT LOG */}
      {group.slotAuditLogs && group.slotAuditLogs.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-8 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#0E5A3C]" />
              <h3 className="text-sm font-bold text-slate-900">
                System Slot Reorder Audit Log
              </h3>
            </div>
            <span className="text-[10px] font-mono bg-emerald-50 text-[#0E5A3C] px-2 py-0.5 rounded font-bold border border-emerald-200">
              System-Generated
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Real-time record of automatic slot reordering, priority advancements, slow-payer queue shifts, and arrears restorations.
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {group.slotAuditLogs.map((log) => (
              <div
                key={log.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-extrabold text-slate-900">
                      Slot #{log.previousSlot} → #{log.newSlot}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      Member #{log.slotNumber}
                    </span>
                  </div>
                  <p className="text-slate-600 text-[11px]">{log.reason}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECOMMENDED FROM OTHER SHOPS & MERCHANTS (At least 5 recommendations) */}
      <section className="border-t border-slate-200 pt-10 mt-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="p-1.5 bg-emerald-100 text-[#0E5A3C] rounded-lg">
                <Store className="w-4 h-4" />
              </span>
              <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Recommended from Other Shops & Merchants
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Check out other active Chama products from verified merchants across Kenya.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded-full shrink-0">
            {recommendedProducts.length} Alternate Shops
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {recommendedProducts.slice(0, 10).map((rec) => {
            const minDaily = rec.speedOptions && rec.speedOptions.length > 0
              ? Math.min(...rec.speedOptions.map(s => s.dailyAmount))
              : Math.ceil(rec.price / 10 / 10);

            return (
              <div
                key={rec.id}
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  onNavigate('product', rec.id);
                }}
                className="group flex flex-col justify-between bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-[#0E5A3C] hover:shadow-md transition-all cursor-pointer p-3"
              >
                <div>
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-100 mb-2.5">
                    <img
                      src={resolveImageUrl(rec.images[0])}
                      alt={rec.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {rec.discountPercent && rec.discountPercent > 0 && (
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#FF6A00] text-white text-[10px] font-black rounded">
                        -{rec.discountPercent}%
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-slate-500 mb-1 truncate">
                    <Store className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate font-medium text-slate-600">{rec.vendorName}</span>
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mb-2 group-hover:text-[#0E5A3C] transition-colors">
                    {rec.title}
                  </h4>

                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                      KSh {rec.price.toLocaleString()}
                    </span>
                    {rec.wasPrice && rec.wasPrice > rec.price && (
                      <span className="text-[10px] text-slate-400 line-through tabular-nums">
                        KSh {rec.wasPrice.toLocaleString()}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-[#0E5A3C] font-semibold mb-3">
                    From KSh {minDaily.toLocaleString()} / day
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    onNavigate('product', rec.id);
                  }}
                  className="w-full py-1.5 bg-slate-100 group-hover:bg-[#0E5A3C] text-slate-700 group-hover:text-white text-[11px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <span>Check Shop</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* MEMBER REMOVAL CONFIRMATION MODAL (MODERATOR ACTION) */}
      {slotToRemove && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSlotToRemove(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
                <Trash2 className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                Remove Member #{slotToRemove.slotNumber} ({slotToRemove.userName})
              </h3>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Moderator action to remove a member for failing to participate in mandatory daily Chama payments.
            </p>

            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs mb-4">
              <div className="font-bold text-red-950 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Automatic Slot Vacation & Wallet Refund:</span>
              </div>
              <ul className="list-disc pl-4 text-red-900 text-[11px] space-y-1">
                <li>
                  <b>Slot Vacation:</b> Slot #{slotToRemove.slotNumber} will immediately become vacant so a new member can join.
                </li>
                <li>
                  <b>Full Refund to Wallet:</b> The total contributed amount of <b>KSh {(slotToRemove.paidAmount || 0).toLocaleString()}</b> will be automatically refunded to <b>{slotToRemove.userName}'s wallet</b> balance.
                </li>
                <li>
                  <b>Re-entry / Another Group:</b> The removed member can use their refunded wallet money to join another Chama group or start saving immediately.
                </li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason for Removal
              </label>
              <input
                type="text"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                placeholder="e.g. Non-participation in mandatory daily Chama payment"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSlotToRemove(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingRemove}
                onClick={handleRemoveMemberConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
              >
                {submittingRemove ? 'Processing Removal...' : 'Confirm Removal & Refund to Wallet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODERATOR ACTIONS MODAL */}
      {selectedSlotForAction && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900 mb-2">
              Moderator Controls · Slot #{selectedSlotForAction.slotNumber} ({selectedSlotForAction.userName})
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              As an authorized moderator, manage group roles or record defaulted contributions.
            </p>

            <div className="flex gap-2 mb-4 border-b border-slate-200 pb-3">
              <button
                onClick={() => setActionType('moderator')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg ${
                  actionType === 'moderator' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Appoint Co-Moderator
              </button>
              <button
                onClick={() => setActionType('default')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg ${
                  actionType === 'default' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Record Member Default
              </button>
            </div>

            {actionType === 'moderator' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600">
                  Appoint <b>{selectedSlotForAction.userName}</b> as an additional moderator with permissions to review member activity and manage group slots.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSelectedSlotForAction(null)}
                    className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAppointModerator(selectedSlotForAction.userId!)}
                    disabled={submittingModAction}
                    className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
                  >
                    {submittingModAction ? 'Appointing...' : 'Confirm Moderator Appointment'}
                  </button>
                </div>
              </div>
            )}

            {actionType === 'default' && (
              <div className="space-y-4">
                <div className="p-3 bg-red-50 text-red-800 rounded-xl text-xs space-y-1">
                  <p className="font-bold">Part 5 Default Policy:</p>
                  <p>1. Slot #{selectedSlotForAction.slotNumber} will be returned to the referral pool for replacement.</p>
                  <p>2. {selectedSlotForAction.userName}'s paid history of KSh {(selectedSlotForAction.paidAmount || 0).toLocaleString()} will be preserved.</p>
                  <p>3. The member will receive options for a cash refund, store credit, or order transfer.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Reason for Default
                  </label>
                  <input
                    type="text"
                    value={defaultReason}
                    onChange={(e) => setDefaultReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setSelectedSlotForAction(null)}
                    className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecordDefault}
                    disabled={submittingModAction}
                    className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700"
                  >
                    {submittingModAction ? 'Recording...' : 'Confirm Default & Release Slot'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: REQUEST PEER LOAN (Member Option) */}
      {showLoanModal && mySlot && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-7 shadow-2xl relative my-auto">
            <button
              onClick={() => setShowLoanModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#0E5A3C] flex items-center justify-center">
                <HandCoins className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Request P2P Installment Loan
                </h3>
                <p className="text-[11px] text-slate-500">
                  Apply for funding from third-party lenders in this Chama group
                </p>
              </div>
            </div>

            <form onSubmit={handleRequestPeerLoan} className="space-y-4 mt-4">
              {/* Member Slot Status Summary */}
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 border border-slate-200">
                <div className="flex justify-between">
                  <span className="text-slate-600">Your Chama Slot:</span>
                  <span className="font-bold text-slate-900">Slot #{mySlot.slotNumber} ({mySlot.userName})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Daily Contribution Rate:</span>
                  <span className="font-mono font-bold text-[#0E5A3C]">KSh {group.dailyAmount.toLocaleString()} / day</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-600">Remaining Obligation:</span>
                  <span className="font-mono font-bold text-slate-900">
                    KSh {Math.max(0, (mySlot.targetAmount || group.productPrice) - (mySlot.paidAmount || 0)).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Loan Amount Needed with Quick Chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-800">
                    Loan Amount Needed (KSh) <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[11px] text-slate-500 font-medium">Quick Presets:</span>
                </div>

                {/* Quick Chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setLoanRequestAmount(group.dailyAmount)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors"
                  >
                    1 Day (KSh {group.dailyAmount.toLocaleString()})
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoanRequestAmount(group.dailyAmount * 3)}
                    className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors"
                  >
                    3 Days (KSh {(group.dailyAmount * 3).toLocaleString()})
                  </button>
                  {mySlot.targetAmount && mySlot.targetAmount > (mySlot.paidAmount || 0) && (
                    <button
                      type="button"
                      onClick={() => setLoanRequestAmount(Math.max(0, mySlot.targetAmount - (mySlot.paidAmount || 0)))}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-[#0E5A3C] rounded-lg border border-emerald-200 transition-colors"
                    >
                      Full Obligation (KSh {Math.max(0, mySlot.targetAmount - (mySlot.paidAmount || 0)).toLocaleString()})
                    </button>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">KSh</span>
                  <input
                    type="number"
                    min="50"
                    required
                    value={loanRequestAmount || ''}
                    onChange={(e) => setLoanRequestAmount(Number(e.target.value))}
                    placeholder="e.g. 1500"
                    className="w-full pl-11 pr-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                  />
                </div>

                {loanRequestAmount > 0 && (
                  <div className="mt-1.5 p-2.5 bg-emerald-50/70 border border-emerald-200/60 rounded-lg text-xs space-y-1">
                    <div className="flex justify-between text-slate-600">
                      <span>Lender Upfront Facilitation Fee (3%):</span>
                      <span className="font-bold text-[#FF6A00]">
                        KSh {Math.max(1, Math.round(loanRequestAmount * 0.03)).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-[#0E5A3C]">
                      <span>Direct Credited to Your Wallet:</span>
                      <span>KSh {loanRequestAmount.toLocaleString()} (Non-withdrawable)</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Repayment Period Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  Repayment Period <span className="text-red-500">*</span>
                </label>
                <select
                  value={loanRepaymentPeriod}
                  onChange={(e) => setLoanRepaymentPeriod(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] bg-white font-semibold"
                >
                  <option value="Within 7 Days (Emergency Arrears Catch-up)">Within 7 Days (Emergency Arrears Catch-up)</option>
                  <option value="Within 14 Days (Standard Grace Period)">Within 14 Days (Standard Grace Period)</option>
                  <option value="Within 30 Days (1 Month Installment)">Within 30 Days (1 Month Installment)</option>
                  <option value={`1 Chama Cycle (${group.cycleDays} Days)`}>1 Chama Cycle ({group.cycleDays} Days)</option>
                  <option value="Custom Negotiation with Lender">Custom Negotiation with Lender</option>
                </select>
              </div>

              {/* Reason for Request with Arrears Priority */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-800">
                    Reason for Request <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">Click to autofill</span>
                </div>

                {/* Preset chips - Arrears is primary */}
                <div className="flex flex-col gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() => setLoanRequestPurpose('To pay for an arrears (clear missed Chama days)')}
                    className={`text-left p-2 rounded-lg border text-xs transition-colors flex items-center justify-between ${
                      loanRequestPurpose === 'To pay for an arrears (clear missed Chama days)'
                        ? 'bg-amber-50 border-amber-300 text-amber-950 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <span>🎯 To pay for an arrears (clear missed Chama days)</span>
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase">Recommended</span>
                  </button>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setLoanRequestPurpose('Cover upcoming Chama cycle installment payment')}
                      className={`text-left p-1.5 rounded-lg border text-[11px] truncate transition-colors ${
                        loanRequestPurpose === 'Cover upcoming Chama cycle installment payment'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Upcoming cycle payment
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoanRequestPurpose('Emergency temporary cashflow shortfall')}
                      className={`text-left p-1.5 rounded-lg border text-[11px] truncate transition-colors ${
                        loanRequestPurpose === 'Emergency temporary cashflow shortfall'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      Temporary cashflow gap
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  required
                  value={loanRequestPurpose}
                  onChange={(e) => setLoanRequestPurpose(e.target.value)}
                  placeholder="e.g. To pay for an arrears (clear missed Chama days)"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              {/* Regulatory & Peer Terms Notice */}
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] leading-relaxed space-y-1 text-amber-950">
                <div>⚖️ <b>Notice:</b> Interest rates, repayment schedule, and loan agreements are negotiated and settled manually outside the Buyoll platform.</div>
                <div>Lender pays an upfront <b>3% platform facilitation fee</b> to Platform Till: <b>196853</b> or Paybill: <b>522533</b> (Acc: <b>4363</b>). Loan proceeds credited to your wallet are locked for Chama contributions and product purchases only.</div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowLoanModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingLoanRequest || loanRequestAmount <= 0}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <HandCoins className="w-3.5 h-3.5" />
                  <span>{submittingLoanRequest ? 'Posting Request...' : 'Post Loan Request to Lenders'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: FUND PEER LOAN (3rd-Party Lender Action with Mandatory 3% Platform Fee Workflow) */}
      {selectedLoanToFund && (() => {
        const principal = selectedLoanToFund.approvedAmount || selectedLoanToFund.amount;
        const fee3Pct = Math.max(1, Math.round(principal * 0.03));
        const isFeeVerified = selectedLoanToFund.platformFeeStatus === 'approved' || selectedLoanToFund.status === 'fee_verified';

        return (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative my-auto">
              <button
                onClick={() => setSelectedLoanToFund(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-orange-100 text-[#FF6A00] flex items-center justify-center">
                  <HandCoins className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  Fund Member's Wallet (3rd-Party Lender Desk)
                </h3>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Funding <b>{selectedLoanToFund.requesterName}</b> (Member #{selectedLoanToFund.slotNumber}) for {group.productTitle}.
              </p>

              {/* Financial Calculation Breakdown */}
              <div className="p-4 bg-slate-50 rounded-xl space-y-2 text-xs mb-4 border border-slate-200">
                <div className="flex justify-between">
                  <span className="text-slate-600">Proposed Loan Principal:</span>
                  <span className="font-bold text-slate-900">
                    KSh {principal.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">3% Mandatory Platform Commission:</span>
                  <span className="font-bold text-[#FF6A00]">
                    KSh {fee3Pct.toLocaleString()}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-semibold text-slate-700">
                  <span>Net Credited to Member Wallet:</span>
                  <span className="font-bold text-[#0E5A3C]">
                    KSh {principal.toLocaleString()} (Non-Withdrawable)
                  </span>
                </div>
              </div>

              {/* STEP 1: Pay 3% Platform Fee (Mandatory before console unlocks) */}
              <div className={`p-4 rounded-xl border mb-4 text-xs space-y-2.5 ${
                isFeeVerified ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50/80 border-amber-300'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    {isFeeVerified ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Lock className="w-4 h-4 text-amber-600" />
                    )}
                    <span>Step 1: 3% Platform Fee Payment ({isFeeVerified ? 'Verified & Approved' : 'Action Required'})</span>
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isFeeVerified ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                  }`}>
                    {isFeeVerified ? 'Fee Approved' : 'Console Locked'}
                  </span>
                </div>

                {!isFeeVerified ? (
                  <>
                    <p className="text-[11px] text-amber-900 leading-snug">
                      Pay <b>KSh {fee3Pct.toLocaleString()}</b> (3%) to <b>Platform Till: 196853</b> or <b>Paybill: 522533</b> (Account: <b>4363</b>). Enter your M-Pesa transaction code below to unlock the disbursement console.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={loanFeePaymentCode}
                        onChange={(e) => setLoanFeePaymentCode(e.target.value.toUpperCase())}
                        placeholder="M-Pesa Reference (e.g. QJK4X8L2PA)"
                        className="flex-1 px-3 py-1.5 text-xs border border-amber-300 rounded-lg bg-white uppercase font-mono focus:ring-1 focus:ring-[#0E5A3C]"
                      />
                      <button
                        type="button"
                        disabled={submittingLoanFee || !loanFeePaymentCode.trim()}
                        onClick={() => handleSubmitLoanFee(selectedLoanToFund.id, principal)}
                        className="px-3.5 py-1.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors shadow-xs disabled:opacity-50 shrink-0"
                      >
                        {submittingLoanFee ? 'Verifying...' : 'Submit 3% Fee'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-emerald-800 leading-snug">
                    ✓ 3% platform commission of KSh {fee3Pct.toLocaleString()} is verified (Ref: {selectedLoanToFund.platformFeePaymentCode || 'FEE_PAID'}). The loan console is now unlocked for disbursement.
                  </p>
                )}
              </div>

              {/* STEP 2: Disburse Loan Proceeds to Member Wallet */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 mb-4">
                <span className="font-bold text-slate-900 block">Step 2: External Agreement & Wallet Credit</span>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Loan terms and repayments are conducted manually outside Buyoll. The principal KSh {principal.toLocaleString()} will be credited directly to {selectedLoanToFund.requesterName}’s wallet as locked loan proceeds (non-withdrawable, strictly for shopping & Chama contributions).
                </p>
                <label className="flex items-start gap-2 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lenderAgreedTerms}
                    onChange={(e) => setLenderAgreedTerms(e.target.checked)}
                    className="mt-0.5 rounded text-[#0E5A3C] focus:ring-[#0E5A3C]"
                  />
                  <span className="text-[11px] font-semibold text-slate-800">
                    I confirm external loan agreement is settled and agree to disburse non-withdrawable funds.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLoanToFund(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingFund || !lenderAgreedTerms || !isFeeVerified}
                  onClick={handleConfirmFundLoan}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  <HandCoins className="w-3.5 h-3.5" />
                  <span>{submittingFund ? 'Disbursing Funds...' : `Disburse KSh ${principal.toLocaleString()} to Member Wallet`}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 3: MEMBER FINANCIAL STATEMENT & LEDGER */}
      {selectedStatementMember && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl my-8 relative">
            <button
              onClick={() => setSelectedStatementMember(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg print:hidden"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Statement Header */}
            <div className="border-b border-slate-200 pb-4 mb-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0E5A3C] bg-emerald-50 px-2 py-0.5 rounded">
                    Official Customer Statement
                  </span>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1">
                    Buyoll Member Financial Statement
                  </h2>
                  <p className="text-xs text-slate-500">
                    Account Holder: <b>{selectedStatementMember.name}</b> · Generated on {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  onClick={() => window.print()}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg print:hidden"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Statement</span>
                </button>
              </div>
            </div>

            {loadingStatement ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading ledger records...</p>
              </div>
            ) : statementData ? (
              <div className="space-y-6">
                {/* Financial Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-500">Total Contributed</div>
                    <div className="text-lg font-black text-[#0E5A3C] mt-0.5">
                      KSh {statementData.totalPaid.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-500">Available Wallet Credit</div>
                    <div className="text-lg font-black text-slate-900 mt-0.5">
                      KSh {statementData.currentCredit.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] uppercase font-bold text-slate-500">Active Chama Slots</div>
                    <div className="text-lg font-black text-slate-900 mt-0.5">
                      {statementData.activeSlots.length} slot{statementData.activeSlots.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>

                {/* Dynamic Progress for this Chama */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    Active Chama Obligations & Dynamic Progress
                  </h4>
                  <div className="space-y-2.5">
                    {statementData.activeSlots.map((s, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-900">
                            {s.groupName} · Slot #{s.slotNumber} ({s.productTitle})
                          </span>
                          <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                            s.progressPercent === 100
                              ? 'bg-emerald-100 text-emerald-800'
                              : s.progressPercent > 0
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}>
                            {s.progressPercent}%
                          </span>
                        </div>
                        {/* Dynamic Progress Bar */}
                        <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden mb-1.5 p-0.5">
                          {s.progressPercent > 0 ? (
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-[#0E5A3C] rounded-full transition-all"
                              style={{ width: `${s.progressPercent}%` }}
                            />
                          ) : (
                            <div className="w-0 h-full" />
                          )}
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>Paid: KSh {s.paidAmount.toLocaleString()} of KSh {s.targetAmount.toLocaleString()}</span>
                          <span>Delivery on Day {s.deliveryDay}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Detailed Transactions Ledger */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    Customer Ledger & Transaction Statement
                  </h4>
                  {statementData.transactions.length === 0 ? (
                    <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                      No transaction entries recorded yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-600 font-semibold sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Date</th>
                            <th className="py-2 px-3">Reference</th>
                            <th className="py-2 px-3">Description</th>
                            <th className="py-2 px-3 text-right">Debit</th>
                            <th className="py-2 px-3 text-right">Credit</th>
                            <th className="py-2 px-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {statementData.transactions.map((tx) => (
                            <tr key={tx.id} className="hover:bg-slate-50">
                              <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                                {new Date(tx.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
                              </td>
                              <td className="py-2 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                                {tx.reference}
                              </td>
                              <td className="py-2 px-3 text-slate-700 max-w-xs truncate" title={tx.description}>
                                {tx.description}
                              </td>
                              <td className="py-2 px-3 text-right text-red-600 font-medium tabular-nums">
                                {tx.debit ? `-KSh ${tx.debit.toLocaleString()}` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right text-emerald-700 font-bold tabular-nums">
                                {tx.credit ? `+KSh ${tx.credit.toLocaleString()}` : '—'}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded uppercase bg-emerald-100 text-emerald-800">
                                  {tx.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-200 text-[11px] text-slate-400 text-center">
                  Official statement issued by Buyoll Social Fintech · Platform Till 522533 · (Buyoll Verified) Store Owners
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* PROMPT 3: 3-STEP SLOT PICKING MODAL */}

      {slotPickerTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setSlotPickerTarget(null)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Stepper Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-[#0E5A3C] block">
                  3-Step Slot Selection & Onboarding
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  {slotPickerStep === 1
                    ? 'Step 1: Choose & Confirm Slot'
                    : slotPickerStep === 2
                    ? 'Step 2: Review Cycle & Payment Mode'
                    : 'Step 3: Confirm & Join Group'}
                </h3>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${slotPickerStep === 1 ? 'bg-[#0E5A3C] text-white' : 'bg-emerald-100 text-emerald-800'}`}>1</span>
                <span className="w-3 h-0.5 bg-slate-200" />
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${slotPickerStep === 2 ? 'bg-[#0E5A3C] text-white' : 'bg-slate-100 text-slate-500'}`}>2</span>
                <span className="w-3 h-0.5 bg-slate-200" />
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${slotPickerStep === 3 ? 'bg-[#0E5A3C] text-white' : 'bg-slate-100 text-slate-500'}`}>3</span>
              </div>
            </div>

            {/* Step 1: Slot Picking */}
            {slotPickerStep === 1 && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  You are picking <b>Slot #{slotPickerTarget.slotNumber}</b> in <span className="text-slate-900 font-bold">{group.name}</span>.
                </p>

                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Your Rotation Position:</span>
                    <b className="text-slate-900 text-sm">Member #{slotPickerTarget.slotNumber}</b>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Item Delivery Day:</span>
                    <b className="text-[#0E5A3C] text-sm">Day {slotPickerTarget.slotNumber * group.cycleDays}</b>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Daily Installment:</span>
                    <b className="text-slate-900 text-sm">KSh {group.dailyAmount.toLocaleString()} / day</b>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">Total Target:</span>
                    <b className="text-slate-900 text-sm">KSh {group.productPrice.toLocaleString()}</b>
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 text-emerald-900 rounded-xl text-xs flex items-start gap-2">
                  <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>
                    Chama rotation is strictly sequential. As Member #{slotPickerTarget.slotNumber}, your delivery is scheduled when cycle round #{slotPickerTarget.slotNumber} is reached!
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setSlotPickerTarget(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setSlotPickerStep(2)}
                    className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Proceed to Step 2</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Payment Plan & Till Mode Review */}
            {slotPickerStep === 2 && (
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500">Group Speed:</span>
                    <span className="font-bold text-slate-900">{group.size} Members ({group.cycleDays} Days/Round)</span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500">Payment Collection Mode:</span>
                    <span className="font-bold text-[#0E5A3C]">
                      {group.paymentMode === 'merchant' ? 'Option A: Merchant Direct Till' : 'Option B: Buyoll Platform Till'}
                    </span>
                  </div>
                  <div className="flex justify-between pb-2 border-b border-slate-200">
                    <span className="text-slate-500">Payment Channel:</span>
                    <span className="font-mono font-bold text-slate-900">
                      Till: {group.paymentMode === 'merchant' ? (group.merchantTill || '3463533') : (group.platformTill || '196853')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Mandatory Daily Obligation:</span>
                    <span className="font-mono font-black text-slate-900">KSh {group.dailyAmount.toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Prompt Payment Policy & Platform Coins:</span>
                  </div>
                  <p>
                    Prompt payers receive automatic points on their Buyoll Financial CV and fellow members can reward you with coins. Missed days accumulate in arrears and must be settled promptly.
                  </p>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setSlotPickerStep(1)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Back to Step 1
                  </button>
                  <button
                    onClick={() => setSlotPickerStep(3)}
                    className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                  >
                    <span>Proceed to Step 3</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Final Confirmation & Activation */}
            {slotPickerStep === 3 && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2">
                  <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Slot #{slotPickerTarget.slotNumber} Ready for Activation</span>
                  </div>
                  <p className="text-emerald-900 leading-relaxed">
                    By clicking "Confirm & Join Slot", you become an active member of this Chama group. You will start making daily contributions of <b>KSh {group.dailyAmount.toLocaleString()}</b> and can begin tracking your progress immediately.
                  </p>
                </div>

                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => setSlotPickerStep(2)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                  >
                    Back to Step 2
                  </button>
                  <button
                    onClick={handleConfirmSlotPick}
                    disabled={slotPickerSubmitting}
                    className="px-6 py-2.5 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-extrabold rounded-xl transition-colors shadow-sm flex items-center gap-2"
                  >
                    {slotPickerSubmitting ? (
                      <span>Claiming Slot #{slotPickerTarget.slotNumber}...</span>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Confirm & Join as Member #{slotPickerTarget.slotNumber}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PROMPT 3: PAY FOR MISSED DAYS (ARREARS CLEARING) MODAL */}
      {showArrearsModal && mySlot && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowArrearsModal(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">
                Pay for Missed Days (Clear Arrears)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Select which missed days you are paying for to restore your green checkmarks (✓) and maintain high financial CV standing.
            </p>

            <form onSubmit={handlePayArrearsSubmit} className="space-y-4">
              {/* Day selection checklist */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Select Days to Pay:
                </label>
                <div className="grid grid-cols-5 gap-2 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {Array.from({ length: Math.min(group.cycleDays, 10) }, (_, i) => i + 1).map((dayNum) => {
                    const isAlreadyPaid = (mySlot.paidDays || []).includes(dayNum);
                    const isAlreadyPending = (mySlot.pendingDays || []).includes(dayNum);
                    const isSelected = selectedMissedDays.includes(dayNum);

                    return (
                      <button
                        key={dayNum}
                        type="button"
                        disabled={isAlreadyPaid || isAlreadyPending}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedMissedDays(prev => prev.filter(d => d !== dayNum));
                          } else {
                            setSelectedMissedDays(prev => [...prev, dayNum]);
                          }
                        }}
                        className={`p-2 rounded-lg text-xs font-mono font-bold border transition-colors flex flex-col items-center justify-center ${
                          isAlreadyPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 opacity-60 cursor-not-allowed'
                            : isAlreadyPending
                            ? 'bg-amber-50 text-amber-800 border-amber-200 opacity-70 cursor-not-allowed'
                            : isSelected
                            ? 'bg-[#0E5A3C] text-white border-[#0E5A3C] shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        <span>D{dayNum}</span>
                        <span className="text-[10px] font-normal">
                          {isAlreadyPaid ? '✓' : isAlreadyPending ? '⏳' : isSelected ? '✓ Pick' : '✗ Miss'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Total Calculation */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Total Arrears Amount:</span>
                  <span className="text-slate-700">
                    {selectedMissedDays.length} day{selectedMissedDays.length !== 1 ? 's' : ''} × KSh {group.dailyAmount.toLocaleString()}
                  </span>
                </div>
                <b className="text-lg font-mono font-black text-[#0E5A3C]">
                  KSh {(selectedMissedDays.length * group.dailyAmount).toLocaleString()}
                </b>
              </div>

              {/* Payment Till Instructions */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200/60 rounded-xl text-xs space-y-1 text-emerald-950">
                <span className="font-bold block">1. Pay via M-Pesa Buy Goods or Paybill:</span>
                <div className="font-mono text-[11px] space-y-0.5">
                  <div>Till Number: <b>{group.paymentMode === 'merchant' ? (group.merchantTill || '3463533') : (group.platformTill || '196853')}</b></div>
                  <div>Paybill: <b>{group.paymentMode === 'merchant' ? (group.merchantPaybill || '26253326') : (group.platformPaybill || '522533')}</b> (Acc: <b>{group.paymentMode === 'merchant' ? group.merchantAccount : group.platformAccount}</b>)</div>
                </div>
              </div>

              {/* M-Pesa Code Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  2. Enter M-Pesa Transaction Code <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={12}
                  value={arrearsPaymentCode}
                  onChange={(e) => setArrearsPaymentCode(e.target.value.toUpperCase())}
                  placeholder="e.g. RJL798K2MN (8-12 alphanumeric characters)"
                  className="w-full px-3 py-2 text-xs font-mono tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] uppercase"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowArrearsModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingArrears || selectedMissedDays.length === 0}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                >
                  {submittingArrears ? 'Submitting Payment...' : 'Submit Arrears Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1. REQUEST ENTRY INVITE MODAL */}
      {showInviteRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#0E5A3C] flex items-center justify-center font-bold">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Request Entry Invite</h3>
                  <p className="text-[11px] text-slate-500">
                    Moderator-controlled admission for {group.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowInviteRequestModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitInviteRequest} className="mt-4 space-y-4">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200/80 text-xs text-emerald-950 space-y-1">
                <span className="font-bold flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-[#0E5A3C]" /> Invite-Only Chama Protection
                </span>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  To protect members from missed rotations, store owners & moderators approve applicants before issuing unique entry codes.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Preferred Slot Number
                </label>
                <select
                  value={desiredSlotForInvite || ''}
                  onChange={(e) => setDesiredSlotForInvite(e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] bg-white font-semibold"
                >
                  <option value="">Any available slot (First available)</option>
                  {group.slots.filter(s => s.status === 'open').map(s => (
                    <option key={s.slotNumber} value={s.slotNumber}>
                      Slot #{s.slotNumber} (Receives item on Day {s.slotNumber * Math.floor(group.cycleDays / group.size)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Applicant Information
                </label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Name:</span>
                    <span className="font-bold text-slate-800">{currentUser?.name || 'Guest'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Phone:</span>
                    <span className="font-mono text-slate-800">{currentUser?.phone || 'Not provided'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reward Points / Rating:</span>
                    <span className="font-bold text-emerald-700">{currentUser?.points || 0} pts ({((currentUser as any)?.rating || 5.0).toFixed(1)} ★)</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Note to Moderator / Store Owner (Optional)
                </label>
                <textarea
                  rows={3}
                  value={inviteRequestNote}
                  onChange={(e) => setInviteRequestNote(e.target.value)}
                  placeholder="e.g. I work locally and can commit to daily M-Pesa payments on time."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowInviteRequestModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingInviteRequest}
                  className="px-5 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
                >
                  {submittingInviteRequest ? 'Submitting...' : 'Send Invite Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. MODERATOR REVIEW INVITES MODAL */}
      {showModeratorInvitesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Chama Entry & Invite Requests</h3>
                  <p className="text-[11px] text-slate-500">
                    Review and admit verified members into {group.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModeratorInvitesModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto py-4 space-y-3 flex-1 pr-1">
              {(!group.inviteRequests || group.inviteRequests.length === 0) ? (
                <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Shield className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-700">No Entry Requests Yet</p>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                    When prospective buyers request to join this Chama, their applications will appear here for your review and approval.
                  </p>
                </div>
              ) : (
                group.inviteRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-900">{req.userName}</span>
                        <span className="text-[11px] font-mono text-slate-500">({req.userPhone})</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          req.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : req.status === 'declined'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse'
                        }`}>
                          {req.status}
                        </span>
                        {req.desiredSlot ? (
                          <span className="text-[10px] bg-slate-200 text-slate-800 font-bold px-1.5 py-0.5 rounded">
                            Target Slot #{req.desiredSlot}
                          </span>
                        ) : (
                          <span className="text-[10px] bg-slate-100 text-slate-600 font-medium px-1.5 py-0.5 rounded">
                            Any Open Slot
                          </span>
                        )}
                      </div>

                      {req.note && (
                        <p className="text-[11px] text-slate-600 italic bg-white/70 p-1.5 rounded border border-slate-200/60">
                          "{req.note}"
                        </p>
                      )}

                      <div className="text-[10px] text-slate-400">
                        Requested: {new Date(req.createdAt).toLocaleString()}
                        {req.issuedCode && (
                          <span className="ml-2 font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            Entry Code: {req.issuedCode}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {req.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleModeratorDecideInvite(req.id, 'approve')}
                            disabled={decidingRequestId === req.id}
                            className="px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white font-bold rounded-lg text-xs shadow-xs disabled:opacity-50"
                          >
                            {decidingRequestId === req.id ? 'Processing...' : 'Approve & Issue Code'}
                          </button>
                          <button
                            onClick={() => handleModeratorDecideInvite(req.id, 'decline')}
                            disabled={decidingRequestId === req.id}
                            className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-xs disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </>
                      ) : req.status === 'approved' && req.issuedCode ? (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(req.issuedCode!);
                            onNotify('success', `Copied invite code: ${req.issuedCode}`);
                          }}
                          className="px-2.5 py-1.5 bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 font-bold rounded-lg text-xs flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" /> Copy Code
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end shrink-0">
              <button
                onClick={() => setShowModeratorInvitesModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ENTER MANUAL INVITE CODE MODAL */}
      {showManualCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#0E5A3C]" />
                <h3 className="font-extrabold text-sm text-slate-900">Enter Chama Invite Code</h3>
              </div>
              <button
                onClick={() => setShowManualCodeModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-600">
                If the group moderator or store owner gave you an invite or admission code, enter it below to unlock slot selection.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Invite / Entry Code
                </label>
                <input
                  type="text"
                  value={manualInviteCodeInput}
                  onChange={(e) => setManualInviteCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. INV-8921 or GRP-4820"
                  className="w-full px-3 py-2 text-xs font-mono tracking-wider border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] uppercase"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualCodeModal(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const code = manualInviteCodeInput.trim().toUpperCase();
                    if (!code) {
                      onNotify('error', 'Please enter an invite code.');
                      return;
                    }
                    setShowManualCodeModal(false);
                    onNotify('success', `Invite code "${code}" applied. Select your slot below to join!`);
                  }}
                  className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  Apply Code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. AWARD COINS TO GROUP MEMBERS MODAL (Section 8.1 & Prompt 5) */}
      {showAwardCoinsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-amber-500" />
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900">Award Coins to Members & Admin</h3>
                  <span className="text-[11px] text-slate-500">Applaud active Chama contributors or award platform directly</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {currentUser?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={handleExportMembers}
                    disabled={exportingMembers}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#0E5A3C] border border-emerald-300 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                    title="Export CSV list of all group members and contribution status"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{exportingMembers ? 'Exporting...' : 'Export Members'}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowAwardCoinsModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {/* Wallet Balance Info */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-950">Your Wallet Coin Balance:</span>
                </div>
                <span className="text-sm font-extrabold text-amber-900 font-mono">
                  {currentUser?.coins || 0} Coins
                </span>
              </div>

              {/* Recipient Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Select Member(s) to Award:
                  </label>
                  {(() => {
                    // Strictly occupied active slots only (no empty or unassigned slots)
                    const activeOtherMembers = group.slots
                      .filter(s => s.status === 'active' && s.userId && s.userId !== currentUser?.id)
                      .map(s => s.userId!);

                    // Include Admin wallet (id: 1) if current user is not admin
                    const allRecipientCandidates = currentUser?.id !== 1
                      ? [1, ...activeOtherMembers]
                      : activeOtherMembers;

                    const allSelected = allRecipientCandidates.length > 0 &&
                      allRecipientCandidates.every(id => selectedAwardRecipientIds.includes(id));

                    return (
                      <button
                        type="button"
                        onClick={() => {
                          if (allSelected) {
                            setSelectedAwardRecipientIds([]);
                          } else {
                            setSelectedAwardRecipientIds(allRecipientCandidates);
                          }
                        }}
                        className="text-[11px] font-bold text-[#0E5A3C] hover:underline cursor-pointer"
                      >
                        {allSelected ? 'Deselect All' : `Select All (${allRecipientCandidates.length})`}
                      </button>
                    );
                  })()}
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 rounded-xl p-2 bg-slate-50/50">
                  {/* GLOBAL OPTION: Buyoll Platform Admin Wallet (Global Wide) */}
                  {currentUser?.id !== 1 && (
                    <label
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        selectedAwardRecipientIds.includes(1)
                          ? 'bg-amber-50/90 border-amber-400 text-amber-950 shadow-xs'
                          : 'bg-white border-amber-200 text-slate-800 hover:bg-amber-50/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedAwardRecipientIds.includes(1)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAwardRecipientIds(prev => [...prev, 1]);
                            } else {
                              setSelectedAwardRecipientIds(prev => prev.filter(id => id !== 1));
                            }
                          }}
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <span>🏛️ Buyoll Platform Admin Wallet</span>
                            <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                              GLOBAL WIDE
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 truncate">
                            Award platform infrastructure & escrow maintenance directly
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
                        ADMIN
                      </span>
                    </label>
                  )}

                  {/* ACTIVE GROUP MEMBERS ONLY (Strictly filter out empty/open slots) */}
                  {group.slots
                    .filter(s => s.status === 'active' && s.userId && s.userId !== currentUser?.id)
                    .map(slot => {
                      const isSelected = selectedAwardRecipientIds.includes(slot.userId!);
                      const paidProgress = slot.progressPercent || Math.round(((slot.paidAmount || 0) / (slot.targetAmount || group.productPrice || 1)) * 100);

                      return (
                        <label
                          key={slot.slotNumber}
                          className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-amber-50/80 border-amber-300 text-amber-950 shadow-xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedAwardRecipientIds(prev => [...prev, slot.userId!]);
                                } else {
                                  setSelectedAwardRecipientIds(prev => prev.filter(id => id !== slot.userId));
                                }
                              }}
                              className="rounded text-amber-600 focus:ring-amber-500"
                            />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 block truncate">
                                Slot #{slot.slotNumber}: {slot.userName || 'Member'}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Paid: KSh {(slot.paidAmount || 0).toLocaleString()} ({paidProgress}%) · Delivery Day {slot.deliveryDay || (slot.slotNumber * Math.floor(group.cycleDays / (group.size || 1)))}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                            {slot.priorityLevel ? `★ ${slot.priorityLevel.toUpperCase()}` : 'ACTIVE'}
                          </span>
                        </label>
                      );
                    })}

                  {/* Empty fallback if no other members have joined yet */}
                  {group.slots.filter(s => s.status === 'active' && s.userId && s.userId !== currentUser?.id).length === 0 && currentUser?.id === 1 && (
                    <div className="text-center py-4 text-xs text-slate-400 italic">
                      No other active members in this Chama yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Amount per recipient */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Coins per Recipient:
                </label>
                <div className="grid grid-cols-5 gap-2 mb-2">
                  {[5, 10, 25, 50, 100].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCoinsToAward(amt)}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        coinsToAward === amt
                          ? 'bg-[#0E5A3C] text-white border-[#0E5A3C]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  value={coinsToAward}
                  onChange={(e) => setCoinsToAward(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                  placeholder="Custom amount"
                />
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Appreciation Message / Reason:
                </label>
                <input
                  type="text"
                  value={coinAwardNote}
                  onChange={(e) => setCoinAwardNote(e.target.value)}
                  placeholder="e.g. Great consistency in daily Chama contributions!"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              {/* Total Calculation & Validation */}
              {(() => {
                const totalCoinsNeeded = selectedAwardRecipientIds.length * coinsToAward;
                const hasEnough = (currentUser?.coins || 0) >= totalCoinsNeeded;

                return (
                  <div>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                      <span className="text-slate-600 font-medium">
                        Total Coins to Deduct ({selectedAwardRecipientIds.length} recipient{selectedAwardRecipientIds.length !== 1 ? 's' : ''} × {coinsToAward}):
                      </span>
                      <span className={`font-mono font-bold text-sm ${hasEnough ? 'text-slate-900' : 'text-red-600'}`}>
                        {totalCoinsNeeded} Coins
                      </span>
                    </div>

                    {!hasEnough && (
                      <p className="text-[11px] text-red-600 font-semibold mt-1">
                        ⚠️ Insufficient coin balance. Top up coins in your wallet or reduce the amount/recipients.
                      </p>
                    )}

                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 mt-3">
                      <button
                        type="button"
                        onClick={() => setShowAwardCoinsModal(false)}
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={submittingCoinAward || !hasEnough || selectedAwardRecipientIds.length === 0}
                        onClick={handleConfirmAwardCoins}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white disabled:text-slate-400 text-xs font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <Coins className="w-3.5 h-3.5" />
                        <span>{submittingCoinAward ? 'Awarding Coins...' : `Award ${totalCoinsNeeded} Coins`}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 5. DORMANT / MISSED PAYMENT WARNING MODAL */}
      {showDormantWarningModal && dormantTargetSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="font-extrabold text-sm text-slate-900">
                  Issue Dormant / Inactivity Warning
                </h3>
              </div>
              <button
                onClick={() => setShowDormantWarningModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                <div className="font-bold text-slate-900">
                  Target Member: {dormantTargetSlot.userName || 'Member'} (Slot #{dormantTargetSlot.slotNumber})
                </div>
                <div className="text-slate-500 text-[11px]">
                  Priority: <b className="uppercase">{dormantTargetSlot.priorityLevel || 'good'}</b> · Status: <b className="uppercase">{dormantTargetSlot.memberStatus || 'slow_payer'}</b>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Reason for Warning:
                </label>
                <textarea
                  rows={2}
                  value={dormantWarningReason}
                  onChange={(e) => setDormantWarningReason(e.target.value)}
                  placeholder="e.g. Unpaid daily Chama contributions exceeding 3 consecutive cycles"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Resolution Grace Period (Days):
                </label>
                <input
                  type="number"
                  min="1"
                  max="14"
                  value={dormantWarningDeadlineDays}
                  onChange={(e) => setDormantWarningDeadlineDays(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                />
              </div>

              {/* Automated Emergency Loan Suggestion Checkbox */}
              <label className="flex items-start gap-2 p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={dormantSuggestLoan}
                  onChange={(e) => setDormantSuggestLoan(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-bold text-indigo-950 block">Send Automated Loan Suggestion</span>
                  <span className="text-[11px] text-indigo-800">
                    Dispatches a notification to this member with a direct deep-link to request a loan at Lenders Desk to prevent slot default.
                  </span>
                </div>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowDormantWarningModal(false)}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submittingDormantWarning}
                  onClick={handleIssueDormantWarning}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 text-white text-xs font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{submittingDormantWarning ? 'Issuing Warning...' : 'Dispatch Warning'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};


