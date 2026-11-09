import React, { useState, useEffect } from 'react';
import {
  User,
  TrustChamaGroup,
  TrustGroupMember,
  TrustJoinRequest,
  VettingCallLog,
  MemberTraceCard,
} from '../types.ts';
import { api } from '../api.ts';
import {
  Users,
  ShieldCheck,
  UserCheck,
  PhoneCall,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Share2,
  Plus,
  ArrowRight,
  Clock,
  MapPin,
  Building2,
  FileCheck2,
  AlertCircle,
  X,
  Check,
  Phone,
  RefreshCw,
  Search,
  ExternalLink,
} from 'lucide-react';

interface TrustChamaSectionProps {
  currentUser: User;
  onNavigate: (view: string, arg?: any) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const TrustChamaSection: React.FC<TrustChamaSectionProps> = ({
  currentUser,
  onNavigate,
  onNotify,
}) => {
  // Navigation sub-tab
  const [subTab, setSubTab] = useState<'my-groups' | 'join' | 'referrals' | 'queue' | 'members'>('my-groups');

  // Groups and member data
  const [trustGroups, setTrustGroups] = useState<Array<TrustChamaGroup & { myRole?: string; myStatus?: string; myCode?: string; totalMembers?: number }>>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Selected group for details / moderator views
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<TrustGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isModeratorOfSelected, setIsModeratorOfSelected] = useState(false);

  // Trace Card Modal
  const [traceCardModal, setTraceCardModal] = useState<{ open: boolean; card: MemberTraceCard | null; loading: boolean }>({
    open: false,
    card: null,
    loading: false,
  });

  // Pending Referrals Inbox (Applicant used my code)
  const [pendingReferrals, setPendingReferrals] = useState<TrustJoinRequest[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [processingRefId, setProcessingRefId] = useState<string | null>(null);

  // Moderator Vetting Queue
  const [vettingQueue, setVettingQueue] = useState<Array<TrustJoinRequest & { referrerName?: string; referrerPhone?: string; referrerTrustScore?: number; referrerJoinDate?: string }>>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

  // Phone Call Log Modal
  const [callLogModal, setCallLogModal] = useState<{
    open: boolean;
    request: (TrustJoinRequest & { referrerName?: string; referrerPhone?: string }) | null;
    phoneCalled: string;
    spokeWithReferrer: boolean;
    confirmedWorkplaceResidence: boolean;
    notes: string;
    submitting: boolean;
  }>({
    open: false,
    request: null,
    phoneCalled: '',
    spokeWithReferrer: false,
    confirmedWorkplaceResidence: false,
    notes: '',
    submitting: false,
  });

  // Join Application Form State
  const [applyCode, setApplyCode] = useState('');
  const [applicantName, setApplicantName] = useState(currentUser.name || '');
  const [applicantPhone, setApplicantPhone] = useState(currentUser.phone || '');
  const [employer, setEmployer] = useState('');
  const [workplaceAddress, setWorkplaceAddress] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [residentialLandmark, setResidentialLandmark] = useState('');
  const [relationship, setRelationship] = useState<'family' | 'coworker' | 'close_friend' | 'neighbor' | 'church_mosque'>('close_friend');
  const [yearsKnown, setYearsKnown] = useState<number>(3);
  const [consentSigned, setConsentSigned] = useState(false);
  const [submittingApply, setSubmittingApply] = useState(false);

  // Create Chama Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupAmount, setNewGroupAmount] = useState<number>(2000);
  const [newGroupCycle, setNewGroupCycle] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [newGroupRules, setNewGroupRules] = useState('1. Punctual contributions. 2. Strictly referral-vetted membership. 3. Zero defaults tolerated.');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Load all user's trust groups
  async function loadTrustGroups() {
    setLoadingGroups(true);
    try {
      const res = await api.getMyTrustGroups();
      setTrustGroups(res.groups || []);
      if (res.groups && res.groups.length > 0 && !selectedGroupId) {
        setSelectedGroupId(res.groups[0].id);
      }
    } catch {
      setTrustGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }

  // Load pending referrals where others used my code
  async function loadPendingReferrals() {
    setLoadingReferrals(true);
    try {
      const res = await api.getPendingReferrals();
      setPendingReferrals(res.referrals || []);
    } catch {
      setPendingReferrals([]);
    } finally {
      setLoadingReferrals(false);
    }
  }

  // Load vetting queue if user is a moderator of the selected group
  async function loadVettingQueue(groupId: string) {
    setLoadingQueue(true);
    try {
      const res = await api.getGroupVettingQueue(groupId);
      setVettingQueue(res.queue || []);
    } catch {
      setVettingQueue([]);
    } finally {
      setLoadingQueue(false);
    }
  }

  // Load members of selected group
  async function loadGroupMembers(groupId: string) {
    setLoadingMembers(true);
    try {
      const res = await api.getGroupMembers(groupId);
      setGroupMembers(res.members || []);
      setIsModeratorOfSelected(res.isModerator);
    } catch {
      setGroupMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }

  // Initial load
  useEffect(() => {
    loadTrustGroups();
    loadPendingReferrals();
  }, []);

  // When selected group changes
  useEffect(() => {
    if (selectedGroupId) {
      loadGroupMembers(selectedGroupId);
      loadVettingQueue(selectedGroupId);
    }
  }, [selectedGroupId]);

  // Copy code with formatted share message
  function handleCopyCode(groupName: string, code: string) {
    const text = `Join my Chama group '${groupName}' on Buyoll using my referral code: ${code}. Note: I will need to confirm I know you, and a moderator will call me to verify your workplace and residence before you're admitted.`;
    navigator.clipboard.writeText(text);
    onNotify('success', `Referral code ${code} and invite message copied to clipboard!`);
  }

  // Submit Join Request
  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consentSigned) {
      onNotify('error', 'You must agree to the address verification and financial consent clause to proceed.');
      return;
    }
    const cleanCode = applyCode.trim().toUpperCase();
    if (!cleanCode) {
      onNotify('error', 'Please enter a valid member referral code.');
      return;
    }

    setSubmittingApply(true);
    try {
      const res = await api.submitJoinRequest({
        memberCode: cleanCode,
        applicantName: applicantName.trim(),
        applicantPhone: applicantPhone.trim(),
        employer: employer.trim(),
        workplaceAddress: workplaceAddress.trim(),
        residentialAddress: residentialAddress.trim(),
        residentialLandmark: residentialLandmark.trim(),
        relationship,
        yearsKnown: Number(yearsKnown),
        consentSigned: true,
      });

      onNotify('success', res.message || 'Application submitted! A notification was sent to your referrer to confirm.');
      // Reset form
      setApplyCode('');
      setEmployer('');
      setWorkplaceAddress('');
      setResidentialAddress('');
      setResidentialLandmark('');
      setConsentSigned(false);
      setSubmittingApply(false);
      // Switch back to groups
      setSubTab('my-groups');
      loadTrustGroups();
    } catch (err: any) {
      onNotify('error', err.message || 'That code is not valid for joining.');
      setSubmittingApply(false);
    }
  }

  // Referrer confirm / deny
  async function handleReferralResponse(requestId: string, action: 'confirm' | 'deny') {
    setProcessingRefId(requestId);
    try {
      const res = await api.respondToReferral(requestId, { action });
      onNotify('success', res.message);
      loadPendingReferrals();
      if (selectedGroupId) loadVettingQueue(selectedGroupId);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update referral response');
    } finally {
      setProcessingRefId(null);
    }
  }

  // Open Call Log Modal
  function handleOpenCallLog(req: TrustJoinRequest & { referrerName?: string; referrerPhone?: string }) {
    setCallLogModal({
      open: true,
      request: req,
      phoneCalled: req.referrerPhone || '',
      spokeWithReferrer: false,
      confirmedWorkplaceResidence: false,
      notes: '',
      submitting: false,
    });
  }

  // Submit Call Log
  async function handleSaveCallLog(e: React.FormEvent) {
    e.preventDefault();
    if (!callLogModal.request) return;
    if (!callLogModal.spokeWithReferrer || !callLogModal.confirmedWorkplaceResidence) {
      onNotify('error', 'Both verification checkboxes are mandatory before logging this vetting call.');
      return;
    }

    setCallLogModal(prev => ({ ...prev, submitting: true }));
    try {
      const res = await api.logVettingCall(callLogModal.request.id, {
        phoneCalled: callLogModal.phoneCalled,
        spokeWithReferrer: callLogModal.spokeWithReferrer,
        confirmedWorkplaceResidence: callLogModal.confirmedWorkplaceResidence,
        notes: callLogModal.notes.trim(),
      });
      onNotify('success', res.message || 'Phone verification recorded successfully!');
      setCallLogModal(prev => ({ ...prev, open: false, submitting: false }));
      if (selectedGroupId) loadVettingQueue(selectedGroupId);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to record vetting call');
      setCallLogModal(prev => ({ ...prev, submitting: false }));
    }
  }

  // Moderator Approve Join Request
  async function handleApproveRequest(requestId: string) {
    setProcessingQueueId(requestId);
    try {
      const res = await api.approveJoinRequest(requestId);
      onNotify('success', res.message || `Member approved and admitted! Member code: ${res.memberCode}`);
      if (selectedGroupId) {
        loadVettingQueue(selectedGroupId);
        loadGroupMembers(selectedGroupId);
      }
      loadTrustGroups();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to approve request. Ensure a verified phone call has been logged.');
    } finally {
      setProcessingQueueId(null);
    }
  }

  // Moderator Reject Join Request
  async function handleRejectRequest(requestId: string) {
    const reason = window.prompt('Enter reason for rejecting this applicant:') || 'Applicant did not meet group vetting criteria.';
    setProcessingQueueId(requestId);
    try {
      const res = await api.rejectJoinRequest(requestId, { reason });
      onNotify('info', res.message || 'Application rejected.');
      if (selectedGroupId) loadVettingQueue(selectedGroupId);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to reject request');
    } finally {
      setProcessingQueueId(null);
    }
  }

  // Open Member Trace Card
  async function handleViewTraceCard(memberId: string) {
    if (!selectedGroupId) return;
    setTraceCardModal({ open: true, card: null, loading: true });
    try {
      const res = await api.getMemberTraceCard(selectedGroupId, memberId);
      setTraceCardModal({ open: true, card: res.traceCard, loading: false });
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load trace card. Moderator access required.');
      setTraceCardModal({ open: false, card: null, loading: false });
    }
  }

  // Toggle member default status
  async function handleToggleMemberStatus(memberId: string, currentStatus: string) {
    if (!selectedGroupId) return;
    const newStatus = currentStatus === 'defaulted' ? 'active' : 'defaulted';
    const reason = window.prompt(`Confirm changing status to ${newStatus}. Enter citation note:`) || `Admin status updated to ${newStatus}`;
    try {
      const res = await api.updateGroupMemberStatus(selectedGroupId, memberId, {
        status: newStatus as any,
        reason,
      });
      onNotify('success', res.message);
      loadGroupMembers(selectedGroupId);
      if (traceCardModal.open && traceCardModal.card) {
        setTraceCardModal(prev => ({
          ...prev,
          card: prev.card ? { ...prev.card, memberStatus: newStatus as any } : null,
        }));
      }
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update member status');
    }
  }

  // Create new Trust Chama Group
  async function handleCreateGroupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) {
      onNotify('error', 'Group name is required.');
      return;
    }
    setCreatingGroup(true);
    try {
      const res = await api.createTrustGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        contributionAmount: Number(newGroupAmount),
        cycleType: newGroupCycle,
        rules: newGroupRules.trim(),
      });
      onNotify('success', `Chama '${res.group.name}' created! You are the first moderator. Your code: ${res.memberCode}`);
      setShowCreateModal(false);
      setNewGroupName('');
      setNewGroupDesc('');
      setCreatingGroup(false);
      await loadTrustGroups();
      setSelectedGroupId(res.group.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to create group');
      setCreatingGroup(false);
    }
  }

  const selectedGroup = trustGroups.find(g => g.id === selectedGroupId);
  const myMembershipInSelected = selectedGroup?.myRole;
  const isSelectedModerator = myMembershipInSelected === 'moderator' || myMembershipInSelected === 'creator';

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-emerald-900 via-[#0E5A3C] to-emerald-950 text-white rounded-2xl p-6 shadow-md border border-emerald-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="p-2 bg-amber-400 text-slate-950 rounded-xl font-black">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-black tracking-tight">
              Community Trust Chamas
            </h2>
            <span className="px-2.5 py-0.5 bg-emerald-700/80 text-emerald-100 text-[10px] font-black rounded-full uppercase tracking-wider">
              Referral Vetted Only
            </span>
          </div>
          <p className="text-xs text-emerald-100/90 max-w-2xl leading-relaxed">
            Strictly closed-circle savings. Every new member must be invited via an active member's code, confirmed in-app, and verified by telephone interview with a moderator before admittance.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('join')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer active:scale-95"
          >
            <UserCheck className="w-4 h-4" />
            <span>Join with Code</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-all border border-white/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Start a Chama</span>
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-2 scrollbar-none">
        <button
          type="button"
          onClick={() => setSubTab('my-groups')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'my-groups' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>My Groups ({trustGroups.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('join')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'join' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Join with Code</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('referrals')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'referrals' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>
            Pending Referrals {pendingReferrals.length > 0 && `(${pendingReferrals.length})`}
          </span>
          {pendingReferrals.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>

        {isSelectedModerator && (
          <button
            type="button"
            onClick={() => setSubTab('queue')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'queue' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <PhoneCall className="w-4 h-4" />
            <span>
              Moderator Vetting Queue {vettingQueue.length > 0 && `(${vettingQueue.length})`}
            </span>
            {vettingQueue.length > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500 text-white text-[10px] rounded-full font-mono">
                {vettingQueue.length}
              </span>
            )}
          </button>
        )}

        {selectedGroupId && (
          <button
            type="button"
            onClick={() => setSubTab('members')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'members' ? 'bg-[#0E5A3C] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Group Roster & Trace Cards</span>
          </button>
        )}
      </div>

      {/* SUB-TAB 1: MY GROUPS */}
      {subTab === 'my-groups' && (
        <div className="space-y-6">
          {loadingGroups ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-500">
              <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading your trust groups...
            </div>
          ) : trustGroups.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 mb-1">
                You have not joined any Trust Chama yet
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
                Chama groups in this tier are strictly referral-only. Ask an active member for their personal <b className="text-slate-700">CH-XXXX-XXXX</b> member code, or launch your own group to become its first moderator.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setSubTab('join')}
                  className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl"
                >
                  Enter Member Code
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl"
                >
                  Start New Chama
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: List of Groups */}
              <div className="lg:col-span-2 space-y-4">
                {trustGroups.map((group) => {
                  const isSelected = group.id === selectedGroupId;
                  const isMod = group.myRole === 'moderator' || group.myRole === 'creator';
                  return (
                    <div
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#0E5A3C] bg-emerald-50/20 shadow-sm ring-1 ring-[#0E5A3C]'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-extrabold text-slate-900">
                              {group.name}
                            </h3>
                            {isMod && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-black rounded-md uppercase">
                                Moderator
                              </span>
                            )}
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase ${
                              group.myStatus === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {group.myStatus}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                            {group.description}
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-slate-900 block">
                            KSh {(group.contributionAmount || 0).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-slate-400 capitalize">
                            per {group.cycleType || 'cycle'}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1 text-[11px]">
                            <Users className="w-3.5 h-3.5 text-slate-400" />
                            <b>{group.totalMembers || 1}</b> Members
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Created {new Date(group.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedGroupId(group.id);
                              setSubTab('members');
                            }}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                          >
                            Roster
                          </button>
                          {isMod && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedGroupId(group.id);
                                setSubTab('queue');
                              }}
                              className="px-2.5 py-1 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg"
                            >
                              Vetting Queue
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Right Column: Member Referral Code Card for selected group */}
              <div className="space-y-4">
                {selectedGroup ? (
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Your Member Referral Card
                        </span>
                        <h4 className="text-xs font-extrabold text-slate-900">
                          {selectedGroup.name}
                        </h4>
                      </div>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                        Active Code
                      </span>
                    </div>

                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 text-center">
                      <span className="text-[10px] font-semibold text-emerald-800 block mb-1">
                        YOUR EXCLUSIVE INVITE CODE
                      </span>
                      <div className="font-mono text-xl font-black text-[#0E5A3C] tracking-widest my-1 select-all">
                        {selectedGroup.myCode || 'CH-MEMBER-CODE'}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Give this to close personal friends or coworkers. You will be asked to vouch for them.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => handleCopyCode(selectedGroup.name, selectedGroup.myCode || '')}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code & Instructions</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const text = `Join my Chama group '${selectedGroup.name}' on Buyoll using my referral code: ${selectedGroup.myCode}. Note: I will need to confirm I know you, and a moderator will call me to verify your workplace and residence before you're admitted.`;
                          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-bold rounded-xl border border-emerald-200 transition-colors cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Share on WhatsApp</span>
                      </button>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-600 space-y-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Vouching Responsibilities:</span>
                      </div>
                      <p>
                        • Maximum <b>3 open pending referrals</b> at any one time.
                      </p>
                      <p>
                        • A moderator will telephone you to verify you know where the applicant lives and works.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
                    Select a group to view your referral code and roster.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: JOIN WITH CODE (4-STEP EXPLAINER + FULL APPLICATION FORM) */}
      {subTab === 'join' && (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* 4-Step Process Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-4 text-center">
              How Joining a Chama Works (4-Step Integrity Protocol)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="w-6 h-6 rounded-full bg-[#0E5A3C] text-white text-xs font-bold flex items-center justify-center mx-auto mb-1.5">
                  1
                </span>
                <p className="text-xs font-bold text-slate-900">Enter Code</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Use friend's valid member code</p>
              </div>

              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="w-6 h-6 rounded-full bg-[#0E5A3C] text-white text-xs font-bold flex items-center justify-center mx-auto mb-1.5">
                  2
                </span>
                <p className="text-xs font-bold text-slate-900">Referrer Confirms</p>
                <p className="text-[10px] text-slate-500 mt-0.5">They vouch in-app that they know you</p>
              </div>

              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="w-6 h-6 rounded-full bg-[#0E5A3C] text-white text-xs font-bold flex items-center justify-center mx-auto mb-1.5">
                  3
                </span>
                <p className="text-xs font-bold text-slate-900">Phone Vetting</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Moderator calls referrer to verify work/home</p>
              </div>

              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
                <span className="w-6 h-6 rounded-full bg-[#0E5A3C] text-white text-xs font-bold flex items-center justify-center mx-auto mb-1.5">
                  4
                </span>
                <p className="text-xs font-bold text-slate-900">Admitted</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Receive your own unique member code</p>
              </div>
            </div>
          </div>

          {/* Join Application Form */}
          <form onSubmit={handleJoinSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900">
                Chama Membership Application
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every detail is strictly verified with your referring member by phone.
              </p>
            </div>

            {/* Member Code */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Referral Member Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={applyCode}
                onChange={(e) => setApplyCode(e.target.value.toUpperCase())}
                placeholder="e.g. CH-74B9-A12C"
                className="w-full px-3 py-2.5 text-xs font-mono font-bold uppercase tracking-wider border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C] bg-slate-50"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Obtained directly from an active member of the group you wish to join.
              </p>
            </div>

            {/* Applicant Name & Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Full Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={applicantName}
                  onChange={(e) => setApplicantName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Primary Mobile Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={applicantPhone}
                  onChange={(e) => setApplicantPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            {/* Workplace Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Current Employer / Business <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  placeholder="e.g. Safaricom PLC / Nairobi Electronics"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Workplace Physical Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={workplaceAddress}
                  onChange={(e) => setWorkplaceAddress(e.target.value)}
                  placeholder="e.g. Delta Corner Annex, 4th Floor, Westlands"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            {/* Residence Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Residential Physical Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={residentialAddress}
                  onChange={(e) => setResidentialAddress(e.target.value)}
                  placeholder="e.g. Kilimani, Rose Avenue, House #14"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Nearest Landmark / Stage <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={residentialLandmark}
                  onChange={(e) => setResidentialLandmark(e.target.value)}
                  placeholder="e.g. Opposite Quickmart Kilimani"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            {/* Relationship & Years Known */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Relationship to Referrer <span className="text-red-500">*</span>
                </label>
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C] bg-white"
                >
                  <option value="close_friend">Close Personal Friend</option>
                  <option value="coworker">Coworker / Colleague</option>
                  <option value="family">Immediate / Extended Family</option>
                  <option value="neighbor">Neighbor / Resident</option>
                  <option value="church_mosque">Fellow Congregation / Fellowship Member</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  How many years have you known them? <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={yearsKnown}
                  onChange={(e) => setYearsKnown(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            {/* Mandatory Consent Checkbox */}
            <div className="pt-2">
              <label className="flex items-start gap-2.5 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={consentSigned}
                  onChange={(e) => setConsentSigned(e.target.checked)}
                  className="mt-0.5 rounded text-[#0E5A3C] focus:ring-[#0E5A3C]"
                />
                <span className="text-[11px] text-amber-950 leading-relaxed">
                  <b className="font-extrabold text-amber-900 block mb-0.5">Mandatory Verification & Recovery Consent:</b>
                  I understand and agree that my workplace and residential address will be verified with my referrer by a group moderator, and that this information may be used by the group to locate me if I default on my financial contributions.
                </span>
              </label>
            </div>

            {/* Submit Action */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSubTab('my-groups')}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingApply || !consentSigned}
                className="px-6 py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {submittingApply ? 'Verifying & Submitting...' : 'Submit Join Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUB-TAB 3: PENDING REFERRALS INBOX */}
      {subTab === 'referrals' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Pending Referrals (Someone Used Your Code)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Applicants who submitted your referral code must be confirmed by you before a moderator begins telephone verification.
              </p>
            </div>
            <span className="px-3 py-1 bg-slate-100 text-slate-700 text-xs font-mono font-bold rounded-lg">
              {pendingReferrals.length} Open Request{pendingReferrals.length === 1 ? '' : 's'}
            </span>
          </div>

          {loadingReferrals ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-500">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading your referral inbox...
            </div>
          ) : pendingReferrals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
              <UserCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="text-xs font-bold text-slate-900">No pending referral requests</h4>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1">
                When a friend uses your member code to apply, their verification card will appear here for your confirmation.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingReferrals.map((req) => (
                <div
                  key={req.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Applied {new Date(req.createdAt).toLocaleDateString()}
                      </span>
                      <h4 className="text-sm font-extrabold text-slate-900">
                        {req.applicantName}
                      </h4>
                      <p className="text-xs text-slate-600 font-mono">
                        {req.applicantPhone}
                      </p>
                    </div>

                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded uppercase">
                      Awaiting You
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                    <p className="text-slate-700">
                      Claimed Relationship: <b className="capitalize text-slate-900">{(req.relationship || '').replace('_', ' ')}</b>
                    </p>
                    <p className="text-slate-700">
                      Years Known: <b className="text-slate-900">{req.yearsKnown} years</b>
                    </p>
                    <p className="text-slate-700">
                      Employer: <b className="text-slate-900">{req.employer || req.applicantWorkplace || 'Pending'}</b>
                    </p>
                  </div>

                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={processingRefId === req.id}
                      onClick={() => handleReferralResponse(req.id, 'confirm')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Yes, I Know Them Well</span>
                    </button>

                    <button
                      type="button"
                      disabled={processingRefId === req.id}
                      onClick={() => handleReferralResponse(req.id, 'deny')}
                      className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl transition-colors cursor-pointer border border-red-200 disabled:opacity-50"
                    >
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: MODERATOR VETTING QUEUE */}
      {subTab === 'queue' && isSelectedModerator && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="p-1.5 bg-amber-100 text-amber-900 rounded-lg">
                  <PhoneCall className="w-4 h-4" />
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Moderator Vetting Queue ({selectedGroup?.name})
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                You must call the referring member to verify workplace and residential address before admitting any applicant.
              </p>
            </div>

            <button
              type="button"
              onClick={() => selectedGroupId && loadVettingQueue(selectedGroupId)}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {loadingQueue ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-500">
              <div className="w-6 h-6 border-2 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading vetting queue...
            </div>
          ) : vettingQueue.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h4 className="text-xs font-bold text-slate-900">Vetting queue is empty</h4>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1">
                All join requests have been processed or are still waiting for referrer confirmation.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {vettingQueue.map((req) => {
                const log = req.vettingCallLog || req.vetting;
                const callLogged = !!(log && (log.spokeWithReferrer || log.referrerKnowsWorkplaceOrResidence));
                const isProcessing = processingQueueId === req.id;

                return (
                  <div
                    key={req.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4"
                  >
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-extrabold text-slate-900">
                            Applicant: {req.applicantName}
                          </h4>
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">
                            Referrer Confirmed
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          Phone: {req.applicantPhone}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] font-mono text-slate-400">
                          Applied {new Date(req.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Side-by-side details */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Applicant Vetting Info */}
                      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Applicant Verification Info
                        </span>
                        <div className="flex items-start gap-2">
                          <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-slate-800">{req.employer || req.applicantWorkplace}</p>
                            <p className="text-[11px] text-slate-500">{req.workplaceAddress || req.applicantWorkplace}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 pt-1 border-t border-slate-200/60">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold text-slate-800">{req.residentialAddress || req.applicantResidence}</p>
                            <p className="text-[11px] text-slate-500">Landmark: {req.residentialLandmark || 'Near Stage'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Right: Referrer Details & Call Action */}
                      <div className="p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100 text-xs space-y-2 flex flex-col justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                            Referring Member to Telephone
                          </span>
                          <p className="font-extrabold text-slate-900 mt-0.5">
                            {req.referrerName || 'Active Member'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <a
                              href={`tel:${req.referrerPhone}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-emerald-200 text-[#0E5A3C] font-mono font-bold text-xs rounded-lg hover:bg-emerald-100 transition-colors"
                            >
                              <Phone className="w-3 h-3 text-[#0E5A3C]" />
                              <span>{req.referrerPhone || 'Call Phone'}</span>
                            </a>
                            <span className="text-[10px] text-slate-500">
                              (Tap to call)
                            </span>
                          </div>
                        </div>

                        {log ? (
                          <div className="p-2 bg-emerald-100/70 rounded-lg text-[10px] text-emerald-900 font-semibold space-y-0.5">
                            <p className="flex items-center gap-1 font-bold text-emerald-950">
                              <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                              <span>Phone Interview Verified</span>
                            </p>
                            <p>Called: {log.phoneCalled || req.referrerPhone} on {new Date(log.calledAt).toLocaleTimeString()}</p>
                            {log.notes && <p className="italic">"{log.notes}"</p>}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenCallLog(req)}
                            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-2xs"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            <span>Log Phone Call with Referrer</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">
                        {callLogged
                          ? 'Phone verification satisfied. You can now approve admittance.'
                          : 'Admittance disabled until telephone verification is completed.'}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => handleRejectRequest(req.id)}
                          className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 font-bold rounded-lg transition-colors"
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          disabled={isProcessing || !callLogged}
                          onClick={() => handleApproveRequest(req.id)}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve & Admit Member</span>
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

      {/* SUB-TAB 5: GROUP ROSTER & TRACE CARDS */}
      {subTab === 'members' && selectedGroupId && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex items-center justify-between">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Member Roster: {selectedGroup?.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isModeratorOfSelected
                  ? 'Full contact records and Trace Cards are unlocked for group moderators.'
                  : 'Privacy-protected roster. Full locator details are restricted to moderators.'}
              </p>
            </div>
            <span className="px-3 py-1 bg-slate-100 text-slate-800 text-xs font-bold rounded-lg">
              {groupMembers.length} Admitted Members
            </span>
          </div>

          {loadingMembers ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-xs text-slate-500">
              <div className="w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading member records...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupMembers.map((m) => {
                const isDefaulted = m.status === 'defaulted';
                return (
                  <div
                    key={m.id}
                    className={`p-4 rounded-2xl border bg-white shadow-2xs space-y-3 ${
                      isDefaulted ? 'border-red-300 ring-1 ring-red-400 bg-red-50/20' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-bold text-slate-900">
                            {m.userName || m.name || m.userEmail}
                          </h4>
                          {m.role === 'moderator' && (
                            <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[9px] font-bold rounded uppercase">
                              Mod
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">
                          Joined {new Date(m.joinedAt).toLocaleDateString()}
                        </p>
                      </div>

                      <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase ${
                        isDefaulted
                          ? 'bg-red-100 text-red-800 font-black'
                          : m.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {m.status}
                      </span>
                    </div>

                    {isDefaulted && (
                      <div className="p-2 bg-red-100 text-red-900 text-[10px] font-bold rounded-lg flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                        <span>DEFAULTED MEMBER — LOCATOR ACTIVE</span>
                      </div>
                    )}

                    {/* Moderator controls & Trace Card button */}
                    {isModeratorOfSelected && (
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <button
                          type="button"
                          onClick={() => handleViewTraceCard(m.id)}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                        >
                          View Trace Card
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleMemberStatus(m.id, m.status)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer ${
                            isDefaulted
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-red-100 text-red-700 hover:bg-red-200'
                          }`}
                        >
                          {isDefaulted ? 'Clear Default' : 'Flag Default'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: LOG PHONE CALL INTERVIEW */}
      {callLogModal.open && callLogModal.request && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCallLog}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center font-bold">
                  <PhoneCall className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Record Referrer Phone Interview
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Mandatory telephone vetting for {callLogModal.request.applicantName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCallLogModal(prev => ({ ...prev, open: false }))}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Referring Member Phone Dialed <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={callLogModal.phoneCalled}
                  onChange={(e) => setCallLogModal(prev => ({ ...prev, phoneCalled: e.target.value }))}
                  className="w-full px-3 py-2 font-mono text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={callLogModal.spokeWithReferrer}
                    onChange={(e) => setCallLogModal(prev => ({ ...prev, spokeWithReferrer: e.target.checked }))}
                    className="mt-0.5 rounded text-[#0E5A3C]"
                  />
                  <span className="text-[11px] font-semibold text-slate-800">
                    I have spoken directly with the referring member ({callLogModal.request.referrerName}) on the phone
                  </span>
                </label>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={callLogModal.confirmedWorkplaceResidence}
                    onChange={(e) => setCallLogModal(prev => ({ ...prev, confirmedWorkplaceResidence: e.target.checked }))}
                    className="mt-0.5 rounded text-[#0E5A3C]"
                  />
                  <span className="text-[11px] font-semibold text-slate-800">
                    The referring member confirmed they personally know the applicant and can identify their workplace or residence if needed
                  </span>
                </label>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Vetting Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={callLogModal.notes}
                  onChange={(e) => setCallLogModal(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="e.g. Referrer works with applicant at Westlands branch for 4 years; vouched strongly."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCallLogModal(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={callLogModal.submitting || !callLogModal.spokeWithReferrer || !callLogModal.confirmedWorkplaceResidence}
                className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl disabled:opacity-50"
              >
                {callLogModal.submitting ? 'Saving...' : 'Save Call Verification'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: TRACE CARD (ANTI-DEFAULT PROTECTION) */}
      {traceCardModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-700" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Member Trace Card (Anti-Default)
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Restricted Moderator Access • Confidential Locator Record
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTraceCardModal({ open: false, card: null, loading: false })}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {traceCardModal.loading || !traceCardModal.card ? (
              <div className="py-8 text-center text-xs text-slate-500">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Loading trace records...
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {traceCardModal.card.memberStatus === 'defaulted' && (
                  <div className="p-3 bg-red-600 text-white rounded-xl flex items-center gap-2 font-bold shadow-xs">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>MEMBER DEFAULTED — ACTIVE LOCATOR RECOVERY AUTHORIZED</span>
                  </div>
                )}

                {/* Member Basic */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Member Identity
                  </span>
                  <p className="text-sm font-extrabold text-slate-900 mt-0.5">
                    {traceCardModal.card.memberName}
                  </p>
                  <p className="text-xs text-slate-600 font-mono">
                    Phone: {traceCardModal.card.memberPhone}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400">
                    Code: {traceCardModal.card.memberCode} · Joined {new Date(traceCardModal.card.joinedAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Referrer Verification Anchor */}
                <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-1">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Referring Member Anchor
                  </span>
                  <p className="font-bold text-slate-900">
                    {traceCardModal.card.referrerName}
                  </p>
                  <p className="font-mono text-slate-700">
                    Phone: {traceCardModal.card.referrerPhone}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Vouched on {new Date(traceCardModal.card.vouchedAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Workplace & Home Locations */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Workplace at Joining
                    </span>
                    <p className="font-bold text-slate-900 mt-0.5">
                      {traceCardModal.card.employer}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      {traceCardModal.card.workplaceAddress}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Residence & Landmark
                    </span>
                    <p className="font-bold text-slate-900 mt-0.5">
                      {traceCardModal.card.residentialAddress}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Landmark: {traceCardModal.card.residentialLandmark}
                    </p>
                  </div>
                </div>

                {/* Vetting Moderator Stamp */}
                <div className="p-2.5 bg-slate-100 rounded-lg text-[10px] text-slate-600 flex items-center justify-between font-mono">
                  <span>Verified by Mod {traceCardModal.card.vettingModeratorName}</span>
                  <span>{new Date(traceCardModal.card.vettedAt).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTraceCardModal({ open: false, card: null, loading: false })}
                className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
              >
                Close Trace Card
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: START NEW TRUST CHAMA */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateGroupSubmit}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#0E5A3C] text-white flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Start a New Trust Chama
                  </h3>
                  <p className="text-xs text-slate-500">
                    You will be the first moderator with your own member code.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Chama Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Westlands Traders Trust Chama"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Description / Purpose
                </label>
                <textarea
                  rows={2}
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="e.g. Monthly rotational capital pool for verified local shop owners."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Contribution (KES) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    required
                    value={newGroupAmount}
                    onChange={(e) => setNewGroupAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 font-mono text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Cycle
                  </label>
                  <select
                    value={newGroupCycle}
                    onChange={(e) => setNewGroupCycle(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C] bg-white"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Group Rules
                </label>
                <textarea
                  rows={2}
                  value={newGroupRules}
                  onChange={(e) => setNewGroupRules(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0E5A3C]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingGroup}
                className="px-5 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl shadow-xs"
              >
                {creatingGroup ? 'Creating...' : 'Launch Chama'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
