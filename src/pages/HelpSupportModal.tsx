import React, { useState, useEffect } from 'react';
import { HelpChatMessage, User } from '../types.ts';
import { api } from '../api.ts';
import {
  HelpCircle,
  X,
  Send,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Search,
  Mail,
  ShieldCheck,
  User as UserIcon,
  RefreshCw,
  Info,
} from 'lucide-react';

interface HelpSupportModalProps {
  currentUser: User | null;
  initialCategory?: string;
  onClose: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onOpenAuth?: () => void;
}

export const HelpSupportModal: React.FC<HelpSupportModalProps> = ({
  currentUser,
  initialCategory = 'inquiry',
  onClose,
  onNotify,
  onOpenAuth,
}) => {
  const [messages, setMessages] = useState<HelpChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  
  // New Question Form state
  const [newQuestionText, setNewQuestionText] = useState('');
  const [guestName, setGuestName] = useState('');
  const [postCategory, setPostCategory] = useState<'inquiry' | 'complaint' | 'feedback' | 'general'>(
    initialCategory === 'complaint' ? 'complaint' : 'inquiry'
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadHelpFeed();
  }, []);

  async function loadHelpFeed() {
    setLoading(true);
    try {
      const res = await api.getHelpChat();
      setMessages(res.messages || []);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to load community help questions.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitQuestion(e: React.FormEvent) {
    e.preventDefault();
    const text = newQuestionText.trim();
    if (!text) {
      onNotify('error', 'Please enter your question or complaint.');
      return;
    }

    if (text.length < 8) {
      onNotify('error', 'Please provide a bit more detail (at least 8 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.postHelpMessage({
        text,
        category: postCategory,
        guestName: currentUser ? currentUser.name : guestName.trim() || 'Community Member',
      });
      setMessages(res.allMessages);
      setNewQuestionText('');
      onNotify('success', 'Your inquiry has been submitted! Our support team and administrators will reply shortly.');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to post message.');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredMessages = messages.filter((m) => {
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery = !q || m.text.toLowerCase().includes(q) || (m.adminReply && m.adminReply.toLowerCase().includes(q));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full flex flex-col shadow-2xl my-auto overflow-hidden border border-slate-200 max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-950 via-[#0E5A3C] to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <HelpCircle className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white leading-tight">
                Buyoll Community Support & Help Desk
              </h2>
              <p className="text-xs text-emerald-200/80">
                Ask questions, report issues, and view official administrator responses
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Info Banner with Email & Manual Payment Destination */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#0E5A3C] shrink-0" />
            <span>Support Email: <a href="mailto:cityandcountyre@gmail.com" className="font-mono font-bold text-[#0E5A3C] hover:underline">cityandcountyre@gmail.com</a></span>
          </div>
          <div className="text-[11px] text-slate-500">
            Platform Till: <b className="font-mono text-slate-900">196853</b> · Paybill: <b className="font-mono text-slate-900">522533</b> (Acc: <b>4363</b>)
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-3 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'All Topics' },
              { id: 'inquiry', label: 'Questions' },
              { id: 'complaint', label: 'Complaints' },
              { id: 'feedback', label: 'Feedback' },
              { id: 'general', label: 'General / FAQ' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  selectedCategory === cat.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 w-full sm:w-auto sm:ml-auto">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search help feed..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
            />
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-[240px] max-h-[38vh] bg-slate-50/40">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#0E5A3C]" />
              <span>Loading questions...</span>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              No questions found for this topic. Be the first to ask below!
            </div>
          ) : (
            filteredMessages.map((msg) => (
              <div
                key={msg.id}
                className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs text-xs space-y-2"
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-900">{msg.userName}</span>
                    <span className="capitalize px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                      {msg.category}
                    </span>
                  </div>
                  <span>{new Date(msg.timestamp).toLocaleDateString()} {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                <p className="text-slate-800 leading-relaxed font-medium">
                  {msg.text}
                </p>

                {msg.adminReply ? (
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-950 mt-2">
                    <div className="flex items-center gap-1 text-[11px] font-bold text-[#0E5A3C] mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Official Buyoll Support Reply:</span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-700">
                      {msg.adminReply}
                    </p>
                  </div>
                ) : (
                  <div className="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded inline-block font-semibold">
                    ⏳ Pending administrator reply
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Post New Question Form */}
        <form
          onSubmit={handleSubmitQuestion}
          className="p-4 bg-white border-t border-slate-200 space-y-3 shrink-0"
        >
          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
            <span>Post a Question or Report an Issue</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-normal">Topic:</span>
              <select
                value={postCategory}
                onChange={(e) => setPostCategory(e.target.value as any)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:ring-1 focus:ring-[#0E5A3C]"
              >
                <option value="inquiry">General Question</option>
                <option value="complaint">Complaint / Dispute</option>
                <option value="feedback">Platform Feedback</option>
                <option value="general">Chama Guidance</option>
              </select>
            </div>
          </div>

          {!currentUser && (
            <div>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Your Name (e.g. Samuel K.)"
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0E5A3C]"
              />
            </div>
          )}

          <div className="flex gap-2">
            <textarea
              rows={2}
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
              placeholder="Type your question or complaint here... (Never post private M-Pesa PINs or passwords)"
              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] bg-slate-50 resize-none"
            />
            <button
              type="submit"
              disabled={submitting || !newQuestionText.trim()}
              className="px-5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs disabled:opacity-50 flex flex-col items-center justify-center gap-1 shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? '...' : 'Post'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Info className="w-3 h-3 text-slate-400 shrink-0" />
            <span>Community rules apply. Sensitive financial matters can also be emailed directly to cityandcountyre@gmail.com.</span>
          </div>
        </form>

      </div>
    </div>
  );
};
