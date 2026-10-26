import React, { useState, useEffect, useRef } from 'react';
import { Product, ProductAIInquiry, User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  Sparkles,
  X,
  Send,
  Bot,
  User as UserIcon,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  HelpCircle,
  ShoppingBag,
  Gift,
  Flame,
  ChevronRight,
  ShieldCheck,
  Tag,
} from 'lucide-react';

interface BuyollAIModalProps {
  product: Product;
  currentUser: User | null;
  onClose: () => void;
  onSelectProduct?: (productId: number) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onOpenAuth?: () => void;
}

const SUGGESTED_PROMPTS = [
  'What are the main benefits of this product?',
  'Why should I consider buying it?',
  'What features and specifications does it have?',
  'Is there a discount or promotion available?',
  'Can I buy this using my Buyoll wallet?',
  'Can I join a Chama group to contribute gradually?',
  'Are there free promotional items or gifts?',
  'Can I pay via 1-member speed over 1 to 6 months?',
];

export const BuyollAIModal: React.FC<BuyollAIModalProps> = ({
  product,
  currentUser,
  onClose,
  onSelectProduct,
  onNotify,
  onOpenAuth,
}) => {
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string; timestamp: number }>>([]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'comparison' | 'insights'>('chat');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isOwner = currentUser && (currentUser.id === product.vendorId || currentUser.role === 'admin');

  useEffect(() => {
    // Load existing inquiries for this product
    if (product.aiInquiries && product.aiInquiries.length > 0) {
      const historyItems: Array<{ sender: 'user' | 'ai'; text: string; timestamp: number }> = [];
      product.aiInquiries.slice(0, 10).reverse().forEach(inq => {
        historyItems.push({ sender: 'user', text: inq.question, timestamp: inq.timestamp });
        historyItems.push({ sender: 'ai', text: inq.answer, timestamp: inq.timestamp + 500 });
      });
      setMessages(historyItems);
    } else {
      // Welcome message from Buyoll.ai
      setMessages([
        {
          sender: 'ai',
          text: `Hello! I am your dedicated Buyoll.ai Assistant for "${product.title}". How can I help you discover its great benefits, specifications, and flexible Chama contribution speeds today?`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [product.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSendQuestion(questionText: string) {
    const q = questionText.trim();
    if (!q || loading) return;

    // Add user message immediately
    const userMsg = { sender: 'user' as const, text: q, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInputQuestion('');
    setLoading(true);

    try {
      const res = await api.askProductAI(product.id, q);
      const aiMsg = { sender: 'ai' as const, text: res.inquiry.answer, timestamp: res.inquiry.timestamp };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      // Positive fallback
      const bonusText = product.bonusGift ? ` plus you receive an enticing free merchant bonus: ${product.bonusGift}!` : '!';
      const fallbackAns = `The ${product.title} is an exceptional, high-grade product offering premium durability, outstanding performance, and superb value${bonusText} At only KSh ${product.price.toLocaleString()}, you can acquire it immediately or start saving with our flexible Chama daily contribution speeds. We warmly encourage you to join a group or buy today!`;
      setMessages(prev => [...prev, { sender: 'ai', text: fallbackAns, timestamp: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }

  // Calculate daily payment speeds for comparison chart
  const speedsForChart = (product.speedOptions && product.speedOptions.length > 0)
    ? product.speedOptions
    : [
        { size: 10, cycleDays: 10, dailyAmount: Math.ceil(product.price / 10 / 10), totalAmount: product.price, description: '10 members · 100 days' },
        { size: 6, cycleDays: 10, dailyAmount: Math.ceil(product.price / 6 / 10), totalAmount: product.price, description: '6 members · 60 days' },
        { size: 4, cycleDays: 10, dailyAmount: Math.ceil(product.price / 4 / 10), totalAmount: product.price, description: '4 members · 40 days' },
        { size: 2, cycleDays: 10, dailyAmount: Math.ceil(product.price / 2 / 10), totalAmount: product.price, description: '2 members · 20 days' },
        { size: 1, cycleDays: 90, dailyAmount: Math.ceil(product.price / 90), totalAmount: product.price, description: '1 member · 3 Months Lipa Mdogomdogo' },
      ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full flex flex-col shadow-2xl my-auto overflow-hidden border border-emerald-900/10 max-h-[92vh]">
        
        {/* Header with Product Thumbnail & Buyoll.ai Branding */}
        <div className="bg-gradient-to-r from-emerald-950 via-[#0E5A3C] to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-white/10 shrink-0 border border-white/20">
              <img
                src={resolveImageUrl(product.images?.[0])}
                alt={product.title}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
              <div className="absolute -bottom-1 -right-1 bg-amber-400 text-slate-900 rounded-full p-0.5">
                <Sparkles className="w-3 h-3" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 fill-current" /> Buyoll.ai
                </span>
                <span className="text-[10px] bg-emerald-500/30 text-emerald-200 px-2 py-0.2 rounded-full font-semibold">
                  Product Sales Advisor
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-bold text-white truncate max-w-sm sm:max-w-md">
                {product.title}
              </h2>
              <div className="text-xs text-emerald-200/90 font-medium flex items-center gap-2">
                <span>KSh {product.price.toLocaleString()}</span>
                {product.discountPercent && product.discountPercent > 0 && (
                  <span className="bg-[#FF6A00] text-white text-[10px] px-1.5 py-0.2 rounded font-bold">
                    -{product.discountPercent}% OFF
                  </span>
                )}
                <span>· {product.vendorName}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-slate-200 bg-slate-50 px-4 text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveTab('chat')}
            className={`py-2.5 px-3 border-b-2 font-bold flex items-center gap-1.5 transition-colors ${
              activeTab === 'chat'
                ? 'border-[#0E5A3C] text-[#0E5A3C] bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Chat Advisor</span>
          </button>

          <button
            onClick={() => setActiveTab('comparison')}
            className={`py-2.5 px-3 border-b-2 font-bold flex items-center gap-1.5 transition-colors ${
              activeTab === 'comparison'
                ? 'border-[#0E5A3C] text-[#0E5A3C] bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Speed & Payment Breakdown</span>
          </button>

          {isOwner && (
            <button
              onClick={() => setActiveTab('insights')}
              className={`py-2.5 px-3 border-b-2 font-bold flex items-center gap-1.5 transition-colors ${
                activeTab === 'insights'
                  ? 'border-[#0E5A3C] text-[#0E5A3C] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-4 h-4 text-amber-600" />
              <span>Merchant Insights ({product.aiInquiries?.length || 0})</span>
            </button>
          )}
        </div>

        {/* Body Content */}
        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
            {/* Scrollable Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[46vh]">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 max-w-[88%] ${m.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                      m.sender === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'bg-gradient-to-br from-[#0E5A3C] to-emerald-600 text-white shadow-xs'
                    }`}
                  >
                    {m.sender === 'user' ? <UserIcon className="w-3.5 h-3.5" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div
                    className={`rounded-2xl p-3.5 text-xs leading-relaxed shadow-xs ${
                      m.sender === 'user'
                        ? 'bg-slate-900 text-white rounded-tr-none'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <span
                      className={`text-[9px] block mt-1 font-mono ${
                        m.sender === 'user' ? 'text-slate-400 text-right' : 'text-slate-400'
                      }`}
                    >
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5 mr-auto">
                  <div className="w-7 h-7 rounded-full bg-[#0E5A3C] text-white flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 animate-pulse" />
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-3 shadow-xs text-xs text-slate-500 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#0E5A3C] animate-ping" />
                    <span>Buyoll.ai is formulating helpful recommendations...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick Suggested Prompts Pill Strip */}
            <div className="p-2.5 bg-white border-t border-slate-200 overflow-x-auto shrink-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <HelpCircle className="w-3 h-3 text-[#0E5A3C]" /> Suggested Questions
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {SUGGESTED_PROMPTS.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendQuestion(prompt)}
                    disabled={loading}
                    className="text-[11px] font-medium bg-emerald-50 hover:bg-emerald-100 text-[#0E5A3C] border border-emerald-200/80 px-2.5 py-1 rounded-full transition-colors whitespace-nowrap text-left disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendQuestion(inputQuestion);
              }}
              className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
            >
              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                placeholder={`Ask Buyoll.ai about ${product.title}...`}
                className="flex-1 px-3.5 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0E5A3C] bg-slate-50"
              />
              <button
                type="submit"
                disabled={loading || !inputQuestion.trim()}
                className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1.5 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ask</span>
              </button>
            </form>
          </div>
        )}

        {/* Speed Comparison & Visual Breakdown Tab */}
        {activeTab === 'comparison' && (
          <div className="p-5 flex-1 overflow-y-auto space-y-4 max-h-[60vh]">
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-[#0E5A3C] shrink-0 mt-0.5" />
              <div>
                <b>Buyoll Chama Savings & Solo Speed Breakdown:</b>
                <p className="text-slate-600 mt-0.5">
                  Acquire <b>{product.title}</b> (KSh {product.price.toLocaleString()}) comfortably by choosing any speed from 10 down to 1-member Lipa Mdogomdogo.
                </p>
              </div>
            </div>

            {/* Visual Bar Chart Comparison */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-[#0E5A3C]" />
                <span>Daily Contribution Comparison by Speed</span>
              </h4>

              <div className="space-y-3">
                {speedsForChart.map((s, idx) => {
                  const maxDaily = Math.max(...speedsForChart.map(x => x.dailyAmount));
                  const barWidth = Math.max(12, Math.round((s.dailyAmount / maxDaily) * 100));

                  return (
                    <div key={idx} className="text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-800">
                          {s.size === 1 ? '1-Member Solo (Lipa Mdogomdogo)' : `${s.size}-Member Speed`}
                        </span>
                        <span className="font-extrabold text-[#0E5A3C] font-mono">
                          KSh {s.dailyAmount.toLocaleString()} / day
                        </span>
                      </div>

                      <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden p-0.5 border border-slate-200">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-[#0E5A3C] rounded-full transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>

                      <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between">
                        <span>{s.description || `Rotation every ${s.cycleDays} days`}</span>
                        <span>Total: KSh {s.totalAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Specifications Summary */}
            {product.attributes && Object.keys(product.attributes).length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
                  Verified Product Specifications
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(product.attributes).map(([k, v]) => (
                    <div key={k} className="p-2 bg-slate-50 rounded-lg">
                      <span className="text-slate-500 block text-[10px]">{k}</span>
                      <span className="font-bold text-slate-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Free Bonus Gift Tag */}
            {product.bonusGift && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs flex items-center gap-2.5">
                <Gift className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold text-amber-950 block">Free Bonus Gift Included!</span>
                  <span className="text-amber-800">Receive <b>{product.bonusGift}</b> free when your contribution completes.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Merchant Insights Tab */}
        {activeTab === 'insights' && isOwner && (
          <div className="p-5 flex-1 overflow-y-auto space-y-4 max-h-[60vh]">
            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-950">
              <span className="font-bold block mb-0.5">Merchant AI Insights Dashboard</span>
              <p className="text-slate-600">
                Review questions and customer interests for "{product.title}". Use these trends to improve descriptions, specifications, and promotions.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
                Customer Inquiries History ({product.aiInquiries?.length || 0})
              </h4>

              {(!product.aiInquiries || product.aiInquiries.length === 0) ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  No questions asked yet. Customer inquiries will appear here automatically.
                </p>
              ) : (
                <div className="space-y-3">
                  {product.aiInquiries.map((inq, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                      <div className="flex items-center justify-between text-slate-400 text-[10px] mb-1">
                        <span className="font-semibold text-slate-700">{inq.userName || 'Shopper'} asked:</span>
                        <span>{new Date(inq.timestamp).toLocaleDateString()} {new Date(inq.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="font-bold text-slate-900 mb-1">"{inq.question}"</p>
                      <div className="p-2 bg-emerald-50 rounded text-emerald-950 text-[11px] border border-emerald-200">
                        <span className="font-semibold text-[#0E5A3C]">Buyoll.ai Answer: </span>
                        {inq.answer}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-3.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-500">
            Platform Till: <b className="text-slate-900 font-mono">196853</b> · Paybill: <b className="text-slate-900 font-mono">522533</b> (Acc: 4363)
          </div>

          <div className="flex items-center gap-2">
            {onSelectProduct && (
              <button
                onClick={() => {
                  onSelectProduct(product.id);
                  onClose();
                }}
                className="px-4 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-xl transition-colors shadow-xs flex items-center gap-1.5"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>View Product & Speeds</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-2 bg-white text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
