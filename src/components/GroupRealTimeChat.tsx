import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Award,
  CornerUpLeft,
  Pin,
  PinOff,
  Search,
  Send,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, getAccessToken } from '../api.ts';
import type {
  ChamaGroup,
  GroupChatGoalSummary,
  GroupChatMessage,
  GroupChatPresenceMember,
  GroupChatTopic,
  User,
} from '../types.ts';

interface GroupRealTimeChatProps {
  group: ChamaGroup;
  currentUser: User | null;
  canModerate: boolean;
  onNotify: (type: 'success' | 'error' | 'info', text: string) => void;
  onOpenAwardCoins?: () => void;
  onGroupUpdated?: () => void;
}

type FilterTab = 'all' | GroupChatTopic | 'activity';

interface DisplayChatMessage extends GroupChatMessage {
  pending?: boolean;
}

const TOPIC_OPTIONS: Array<{ value: GroupChatTopic; label: string; placeholder: string }> = [
  { value: 'general', label: 'General', placeholder: 'Discuss plans or coordinate with your group...' },
  { value: 'goal', label: 'Goal', placeholder: 'Share a savings target or milestone update...' },
  { value: 'coordination', label: 'Coordination', placeholder: 'Coordinate turn order, delivery, or payments...' },
  { value: 'reminder', label: 'Reminder', placeholder: 'Post a payment or cycle deadline reminder...' },
];

const TOPIC_LABELS: Record<GroupChatTopic, string> = {
  general: 'General',
  goal: 'Goal',
  coordination: 'Coordination',
  reminder: 'Reminder',
};

function mergeMessagesIdempotent(
  prev: DisplayChatMessage[],
  incoming: GroupChatMessage
): DisplayChatMessage[] {
  const next = [...prev];
  const byIdIdx = next.findIndex((m) => m.id === incoming.id);
  if (byIdIdx !== -1) {
    next[byIdIdx] = { ...incoming, pending: false };
    return next.sort((a, b) => a.timestamp - b.timestamp);
  }
  if (incoming.clientMsgId) {
    const byClientIdx = next.findIndex(
      (m) => m.clientMsgId && m.clientMsgId === incoming.clientMsgId
    );
    if (byClientIdx !== -1) {
      next[byClientIdx] = { ...incoming, pending: false };
      return next.sort((a, b) => a.timestamp - b.timestamp);
    }
  }
  next.push({ ...incoming, pending: false });
  return next.sort((a, b) => a.timestamp - b.timestamp);
}

function buildGoalFromGroup(group: ChamaGroup): GroupChatGoalSummary {
  const maxMembers = Math.max(1, Number(group.maxMembers || group.size || 1));
  const activeMembers = (group.slots || []).filter((s) => s.status === 'active').length;
  const totalCollected = (group.slots || []).reduce(
    (sum, s) => sum + Math.max(0, Number(s.paidAmount || 0)),
    0
  );
  const dailyAmount = Math.max(0, Number(group.dailyAmount || 0));
  const cycleDays = Math.max(1, Number(group.paymentDurationDays || group.cycleDays || maxMembers));
  const rawPriceTotal = Number(group.productPrice || 0) * maxMembers;
  const totalTarget = Math.max(
    1,
    Number((group as any).totalPrice || rawPriceTotal || dailyAmount * cycleDays * maxMembers || 1)
  );
  const progressPercent = Math.max(0, Math.min(100, Math.round((totalCollected / totalTarget) * 100)));
  return {
    totalCollected,
    totalTarget,
    progressPercent,
    activeMembers,
    maxMembers,
    completedRounds: Number(group.deliveredRounds?.length || (group as any).completedRounds || 0),
    dailyAmount,
    cycleDays,
    payoutOption: group.payoutOption,
  };
}

function formatMessageTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const GroupRealTimeChat: React.FC<GroupRealTimeChatProps> = ({
  group,
  currentUser,
  canModerate,
  onNotify,
  onOpenAwardCoins,
  onGroupUpdated,
}) => {
  const [messages, setMessages] = useState<DisplayChatMessage[]>(() =>
    [...(group.chat || [])].sort((a, b) => a.timestamp - b.timestamp)
  );
  const [goalSummary, setGoalSummary] = useState<GroupChatGoalSummary>(() =>
    buildGoalFromGroup(group)
  );
  const [presence, setPresence] = useState<GroupChatPresenceMember[]>([]);
  const [serverCanModerate, setServerCanModerate] = useState<boolean>(canModerate);
  const [viewerMuted, setViewerMuted] = useState(false);
  const [viewerBlacklisted, setViewerBlacklisted] = useState(false);

  const [connectionState, setConnectionState] = useState<'connecting' | 'live' | 'reconnecting'>(
    'connecting'
  );
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedTopic, setSelectedTopic] = useState<GroupChatTopic>('general');
  const [chatInput, setChatInput] = useState('');
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const [typingUsers, setTypingUsers] = useState<Record<number, { name: string; expiresAt: number }>>({});
  const [hasNewUnread, setHasNewUnread] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const lastTypingEmitRef = useRef(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveCanModerate = canModerate || serverCanModerate;

  // Keep baseline synchronized whenever parent group prop updates (e.g. after payment/join)
  useEffect(() => {
    setGoalSummary(buildGoalFromGroup(group));
    setMessages((prev) => {
      let merged = [...prev];
      for (const m of group.chat || []) {
        merged = mergeMessagesIdempotent(merged, m);
      }
      return merged;
    });
  }, [group.id, group.chat, group.occupiedCount, group.deliveredRounds?.length, group.payoutOption]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setHasNewUnread(false);
    nearBottomRef.current = true;
  }, []);

  const syncFromServer = useCallback(async () => {
    try {
      const data = await api.getGroupMessages(group.id, { limit: 150 });
      setMessages((prev) => {
        const pendingOnly = prev.filter((p) => p.pending);
        let merged: DisplayChatMessage[] = [...data.messages];
        for (const p of pendingOnly) {
          merged = mergeMessagesIdempotent(merged, p);
        }
        return merged.sort((a, b) => a.timestamp - b.timestamp);
      });
      setGoalSummary(data.goalSummary);
      setPresence(data.presence || []);
      setServerCanModerate(Boolean(data.canModerate));
      setViewerMuted(Boolean(data.viewerStatus?.isMuted));
      setViewerBlacklisted(Boolean(data.viewerStatus?.isBlacklisted));
    } catch {
      // Keep cached messages visible if transient network issue occurs
    }
  }, [group.id]);

  // Real WebSocket room connection with auto-reconnect and server state sync
  useEffect(() => {
    let cancelled = false;

    const connectWs = () => {
      if (cancelled) return;
      if (typeof WebSocket === 'undefined') {
        setConnectionState('reconnecting');
        return;
      }

      const wsOrigin = window.location.origin.replace(/^http/, 'ws');
      const params = new URLSearchParams({ groupId: String(group.id) });
      const token = getAccessToken();
      if (token) params.set('token', token);
      const activeRole = currentUser?.activeRole || currentUser?.role;
      if (activeRole) params.set('role', activeRole);

      const ws = new WebSocket(`${wsOrigin}/ws/chat?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttemptRef.current = 0;
        setConnectionState('live');
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(ev.data);
          if (!data || typeof data !== 'object') return;

          if (data.type === 'chat:init') {
            if (Array.isArray(data.messages)) {
              setMessages(
                [...data.messages].sort((a: GroupChatMessage, b: GroupChatMessage) => a.timestamp - b.timestamp)
              );
            }
            if (Array.isArray(data.presence)) setPresence(data.presence);
            if (data.goalSummary) setGoalSummary(data.goalSummary);
            if (typeof data.canModerate === 'boolean') setServerCanModerate(data.canModerate);
            requestAnimationFrame(() => scrollToBottom(false));
            return;
          }

          if (data.type === 'chat:presence') {
            if (Array.isArray(data.presence)) setPresence(data.presence);
            return;
          }

          if (data.type === 'chat:typing') {
            if (data.userId === currentUser?.id) return;
            setTypingUsers((prev) => {
              const next = { ...prev };
              if (data.isTyping) {
                next[Number(data.userId)] = {
                  name: String(data.userName || 'Member'),
                  expiresAt: Date.now() + 4000,
                };
              } else {
                delete next[Number(data.userId)];
              }
              return next;
            });
            return;
          }

          if (data.type === 'chat:message' && data.message) {
            setMessages((prev) => mergeMessagesIdempotent(prev, data.message));
            if (data.goalSummary) setGoalSummary(data.goalSummary);
            if (data.message.senderId !== currentUser?.id) {
              setTypingUsers((prev) => {
                if (!prev[data.message.senderId]) return prev;
                const copy = { ...prev };
                delete copy[data.message.senderId];
                return copy;
              });
            }
            if (nearBottomRef.current || data.message.senderId === currentUser?.id) {
              requestAnimationFrame(() => scrollToBottom(true));
            } else {
              setHasNewUnread(true);
            }
            return;
          }

          if (data.type === 'chat:pinned' && data.message) {
            setMessages((prev) =>
              prev.map((m) => (m.id === data.message.id ? { ...m, ...data.message } : m))
            );
            return;
          }

          if (data.type === 'chat:deleted' && data.messageId) {
            setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
          }
        } catch {
          // Ignore malformed WS payloads
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        wsRef.current = null;
        setConnectionState('reconnecting');
        const delayMs = Math.min(15000, 1000 * Math.pow(2, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          void syncFromServer();
          connectWs();
        }, delayMs);
      };

      ws.onerror = () => {
        // Handled cleanly in onclose
      };
    };

    void syncFromServer();
    connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [group.id, currentUser?.id, currentUser?.activeRole, currentUser?.role, syncFromServer, scrollToBottom]);

  // Fallback SSE sync for cross-tab system events (loans, joins, admin actions)
  useEffect(() => {
    const onSseChat = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail || Number(detail.groupId) !== Number(group.id)) return;
      if (detail.eventType === 'chat:message' && detail.message) {
        setMessages((prev) => mergeMessagesIdempotent(prev, detail.message));
        if (detail.goalSummary) setGoalSummary(detail.goalSummary);
      } else if (detail.eventType === 'chat:pinned' && detail.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === detail.message.id ? { ...m, ...detail.message } : m))
        );
      } else if (detail.eventType === 'chat:deleted' && detail.messageId) {
        setMessages((prev) => prev.filter((m) => m.id !== detail.messageId));
      } else {
        void syncFromServer();
      }
    };
    window.addEventListener('buyoll:group-chat-message', onSseChat);
    return () => window.removeEventListener('buyoll:group-chat-message', onSseChat);
  }, [group.id, syncFromServer]);

  // Clear expired typing indicators
  useEffect(() => {
    const keys = Object.keys(typingUsers);
    if (keys.length === 0) return;
    const timer = setTimeout(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt > now) next[Number(k)] = v;
        }
        return next;
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [typingUsers]);

  const emitTyping = useCallback((isTyping: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentUser) return;
    const now = Date.now();
    if (isTyping && now - lastTypingEmitRef.current < 1500) return;
    lastTypingEmitRef.current = now;
    try {
      ws.send(JSON.stringify({ type: 'typing', isTyping }));
    } catch {
      // ignore
    }
  }, [currentUser]);

  function handleInputChange(value: string) {
    setChatInput(value);
    if (!currentUser) return;
    if (value.trim().length > 0) {
      emitTyping(true);
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = setTimeout(() => emitTyping(false), 2500);
    } else {
      emitTyping(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || sending) return;
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    const clientMsgId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMsg: DisplayChatMessage = {
      id: clientMsgId,
      clientMsgId,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: currentUser.activeRole || currentUser.role || 'Member',
      kind: 'normal',
      topic: selectedTopic,
      text: trimmed.slice(0, 500),
      ...(replyTo
        ? {
            replyToId: replyTo.id,
            replyToSender: replyTo.senderName,
            replyToSnippet: replyTo.text.slice(0, 96),
          }
        : {}),
      timestamp: Date.now(),
      pending: true,
    };

    const replyTarget = replyTo;
    setMessages((prev) => mergeMessagesIdempotent(prev, optimisticMsg));
    setChatInput('');
    setReplyTo(null);
    emitTyping(false);
    setSending(true);
    requestAnimationFrame(() => scrollToBottom(true));

    try {
      const res = await api.postGroupMessage(group.id, {
        text: trimmed.slice(0, 500),
        topic: selectedTopic,
        replyToId: replyTarget?.id,
        clientMsgId,
      });
      setMessages((prev) => mergeMessagesIdempotent(prev, res.message));
      if (res.goalSummary) setGoalSummary(res.goalSummary);
      if (res.censored) {
        onNotify(
          'info',
          'Some words were masked by automated moderation. Please keep group discussion respectful.'
        );
      }
      onGroupUpdated?.();
    } catch (err: any) {
      // Roll back optimistic message cleanly
      setMessages((prev) => prev.filter((m) => m.clientMsgId !== clientMsgId));
      setChatInput(trimmed);
      onNotify('error', err?.message || 'Unable to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleTogglePin(msg: GroupChatMessage) {
    if (!effectiveCanModerate || pinBusyId) return;
    setPinBusyId(msg.id);
    try {
      const res = await api.togglePinGroupMessage(group.id, msg.id, !Boolean(msg.pinned));
      setMessages((prev) =>
        prev.map((m) => (m.id === res.message.id ? { ...m, ...res.message } : m))
      );
      onNotify('success', res.message.pinned ? 'Pinned to Group Goals bar.' : 'Unpinned message.');
    } catch (err: any) {
      onNotify('error', err?.message || 'Unable to update pin state');
    } finally {
      setPinBusyId(null);
    }
  }

  async function handleDeleteMessage(msg: GroupChatMessage) {
    if (deleteBusyId) return;
    setDeleteBusyId(msg.id);
    try {
      await api.deleteGroupMessage(group.id, msg.id);
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      onNotify('success', 'Message removed.');
    } catch (err: any) {
      onNotify('error', err?.message || 'Unable to delete message');
    } finally {
      setDeleteBusyId(null);
    }
  }

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    nearBottomRef.current = nearBottom;
    if (nearBottom && hasNewUnread) setHasNewUnread(false);
  }

  const pinnedMessages = useMemo(
    () =>
      messages
        .filter((m) => Boolean(m.pinned))
        .sort((a, b) => (b.pinnedAt || b.timestamp) - (a.pinnedAt || a.timestamp)),
    [messages]
  );

  const visibleMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return messages.filter((m) => {
      if (filterTab === 'activity') {
        if (m.kind !== 'system' && m.kind !== 'reward') return false;
      } else if (filterTab !== 'all') {
        if ((m.topic || 'general') !== filterTab) return false;
      }
      if (q) {
        const hay = `${m.senderName} ${m.text} ${m.senderRole || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [messages, filterTab, searchQuery]);

  const activeTypingNames = Object.values(typingUsers).map((t) => t.name);

  return (
    <div className="bg-white border border-slate-200 rounded-2xl flex flex-col h-[540px] overflow-hidden">
      {/* Header: Title + Real Connection Telemetry + Online Room Participants */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/70">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 truncate">
              Group Discussion & Coordination
            </h3>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 shrink-0"
              title={
                connectionState === 'live'
                  ? 'Real-time WebSocket connected'
                  : 'Reconnecting real-time room...'
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionState === 'live' ? 'bg-emerald-600' : 'bg-amber-500 animate-pulse'
                }`}
              />
              {connectionState === 'live' ? 'Live' : 'Reconnecting'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 tabular-nums">
            <span>{presence.length > 0 ? `${presence.length} online` : 'Room active'}</span>
            {currentUser && (
              <>
                <span aria-hidden="true">·</span>
                <span>{currentUser.coins || 0} coins</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowSearch((s) => !s)}
            aria-label="Search group messages"
            className={`p-2 rounded-lg text-xs transition-colors cursor-pointer ${
              showSearch
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          {currentUser && onOpenAwardCoins && (
            <button
              type="button"
              onClick={onOpenAwardCoins}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Award className="w-3.5 h-3.5" />
              <span>Applaud</span>
            </button>
          )}
        </div>
      </div>

      {/* Chama Goal & Member Coordination Strip */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1.5 tabular-nums">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
            <Target className="w-3.5 h-3.5 text-[#FF6A00]" />
            <span>
              Goal: KSh {goalSummary.totalCollected.toLocaleString()} / KSh{' '}
              {goalSummary.totalTarget.toLocaleString()}
            </span>
          </span>
          <span className="font-semibold text-slate-700">
            {goalSummary.progressPercent}% · {goalSummary.activeMembers}/{goalSummary.maxMembers} slots
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#FF6A00] transition-all duration-300"
            style={{ width: `${goalSummary.progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 tabular-nums">
          <span>
            KSh {goalSummary.dailyAmount.toLocaleString()}/day · {goalSummary.cycleDays}d cycle
          </span>
          <span>
            {goalSummary.payoutOption === 'end_together' ? 'End Together Payout' : 'Turn-by-Turn Payout'}
          </span>
        </div>
      </div>

      {/* Pinned Goal / Coordination Notices */}
      {pinnedMessages.length > 0 && (
        <div className="px-4 py-2 border-b border-amber-200/80 bg-amber-50/70 space-y-1.5">
          {pinnedMessages.map((pm) => (
            <div key={pm.id} className="flex items-start justify-between gap-2 text-[11px]">
              <div className="min-w-0 flex items-start gap-1.5">
                <Pin className="w-3 h-3 text-amber-700 shrink-0 mt-0.5" />
                <p className="text-slate-800 leading-snug break-words">
                  <strong className="font-semibold text-slate-900">{pm.senderName}:</strong>{' '}
                  {pm.text}
                </p>
              </div>
              {effectiveCanModerate && (
                <button
                  type="button"
                  onClick={() => void handleTogglePin(pm)}
                  disabled={pinBusyId === pm.id}
                  title="Unpin message"
                  className="text-slate-500 hover:text-slate-900 p-0.5 shrink-0 cursor-pointer"
                >
                  <PinOff className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search Bar & Topic Filter Tabs */}
      <div className="px-3 py-2 border-b border-slate-100 bg-white space-y-2">
        {showSearch && (
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter messages by keyword or member..."
              className="w-full pl-3 pr-8 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'goal', label: 'Goals' },
              { key: 'coordination', label: 'Coordination' },
              { key: 'reminder', label: 'Reminders' },
              { key: 'activity', label: 'Logs & Coins' },
            ] as Array<{ key: FilterTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterTab(tab.key)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filterTab === tab.key
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chronological Message Stream */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="h-full overflow-y-auto px-4 py-3 space-y-3 text-xs"
        >
          {visibleMessages.length > 0 ? (
            visibleMessages.map((m) => {
              const isMine = Boolean(currentUser && m.senderId === currentUser.id);
              const isSystem = m.kind === 'system';
              const isReward = m.kind === 'reward';
              const canDelete = Boolean(
                currentUser &&
                  !m.pending &&
                  ((isMine && !isSystem) ||
                    (effectiveCanModerate && !isSystem) ||
                    currentUser.role === 'admin' ||
                    currentUser.activeRole === 'admin')
              );

              return (
                <div
                  key={m.id}
                  className={`group rounded-xl p-2.5 border transition-colors ${
                    isSystem
                      ? 'bg-slate-50 border-slate-200/80 text-slate-700'
                      : isReward
                      ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                      : isMine
                      ? 'bg-orange-50/40 border-orange-200/70 text-slate-900'
                      : 'bg-white border-slate-200/80 text-slate-800'
                  } ${m.pending ? 'opacity-70' : ''}`}
                >
                  {/* Unboxed quiet metadata line */}
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="font-semibold text-slate-900 truncate">{m.senderName}</span>
                      {m.senderRole && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600 truncate">{m.senderRole}</span>
                        </>
                      )}
                      {m.topic && m.topic !== 'general' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#FF6A00]">
                            {TOPIC_LABELS[m.topic] || m.topic}
                          </span>
                        </>
                      )}
                      {m.pinned && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-amber-700">Pinned</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        {m.pending ? 'Sending...' : formatMessageTime(m.timestamp)}
                      </span>
                      {currentUser && !m.pending && (
                        <div className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => setReplyTo(m)}
                            title="Reply to message"
                            className="p-1 text-slate-400 hover:text-slate-800 rounded cursor-pointer"
                          >
                            <CornerUpLeft className="w-3 h-3" />
                          </button>
                          {effectiveCanModerate && (
                            <button
                              type="button"
                              onClick={() => void handleTogglePin(m)}
                              disabled={pinBusyId === m.id}
                              title={m.pinned ? 'Unpin' : 'Pin to top'}
                              className="p-1 text-slate-400 hover:text-amber-700 rounded cursor-pointer"
                            >
                              {m.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteMessage(m)}
                              disabled={deleteBusyId === m.id}
                              title="Delete message"
                              className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quoted Reply Context */}
                  {m.replyToId && m.replyToSnippet && (
                    <div className="mb-1.5 px-2 py-1 bg-slate-100/80 rounded text-[11px] text-slate-600 truncate">
                      Replying to <strong className="font-semibold">{m.replyToSender}</strong>:{' '}
                      {m.replyToSnippet}
                    </div>
                  )}

                  <p className="leading-relaxed whitespace-pre-wrap break-words text-xs">{m.text}</p>
                </div>
              );
            })
          ) : (
            <div className="py-10 text-center text-slate-400 space-y-1.5">
              <Users className="w-6 h-6 mx-auto text-slate-300" />
              <p className="text-xs font-medium text-slate-500">
                {searchQuery || filterTab !== 'all'
                  ? 'No messages match this filter.'
                  : 'No group messages yet.'}
              </p>
              <p className="text-[11px] text-slate-400">
                Coordinate savings goals, turn schedules, or payment reminders with your Chama.
              </p>
            </div>
          )}
        </div>

        {hasNewUnread && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-900 text-white text-[11px] font-semibold rounded-full shadow-md inline-flex items-center gap-1 cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" />
            <span>New messages</span>
          </button>
        )}
      </div>

      {/* Live Typing Telemetry */}
      {activeTypingNames.length > 0 && (
        <div className="px-4 py-1 text-[11px] text-slate-500 border-t border-slate-100 bg-slate-50/50">
          {activeTypingNames.length === 1
            ? `${activeTypingNames[0]} is typing...`
            : `${activeTypingNames.slice(0, 2).join(', ')} are typing...`}
        </div>
      )}

      {/* Composer */}
      {currentUser ? (
        viewerBlacklisted || viewerMuted ? (
          <div className="px-4 py-3 border-t border-red-100 bg-red-50/70 text-[11px] text-red-700 font-medium">
            {viewerBlacklisted
              ? 'Your chat access is restricted due to policy strikes. Appeal via Buyoll Support.'
              : 'Your chat permissions are temporarily muted.'}
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 bg-white space-y-2">
            {/* Reply Target Banner */}
            {replyTo && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-100 rounded-lg text-[11px] text-slate-700">
                <span className="truncate">
                  Replying to <strong>{replyTo.senderName}</strong>: {replyTo.text}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Topic Selector + Char Count */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 overflow-x-auto">
                {TOPIC_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setSelectedTopic(t.value)}
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedTopic === t.value
                        ? 'bg-[#FF6A00] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                {chatInput.length}/500
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                maxLength={500}
                value={chatInput}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder={
                  TOPIC_OPTIONS.find((t) => t.value === selectedTopic)?.placeholder ||
                  'Write a message...'
                }
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6A00]"
              />
              <button
                type="submit"
                disabled={sending || !chatInput.trim()}
                aria-label="Send message"
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer shrink-0 inline-flex items-center justify-center"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )
      ) : (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/70 text-center">
          <p className="text-xs text-slate-500">
            Sign in to join real-time group goal discussions and coordination.
          </p>
        </div>
      )}
    </div>
  );
};
