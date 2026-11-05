import React, { useState, useEffect, useRef } from 'react';
import { Product, ChamaGroup } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { ProductCard } from '../components/ProductCard.tsx';
import { BuyollAIModal } from '../components/BuyollAIModal.tsx';
import {
  Sparkles,
  Users,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Tag,
  Store,
  CheckCircle2,
  TrendingUp,
  Percent,
  Flame,
  X,
  Megaphone,
  Bell,
  LogIn,
  Plus,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { User, Announcement, PlatformAnnouncementSlot } from '../types.ts';
import { useSearchHistory } from '../hooks/useSearchHistory.ts';

interface HomePageProps {
  currentUser?: User | null;
  onSelectProduct: (productId: number) => void;
  searchQuery: string;
  onSearchChange?: (query: string) => void;
  onClearSearch?: () => void;
  onOpenAuth?: () => void;
  onNavigate?: (view: string, arg?: any) => void;
}

const CATEGORIES = [
  'All',
  'Appliances',
  'Kitchen',
  'Phones, Tablets & TV',
  'Home & Office Furniture',
  'Bedding',
  'Computing',
  'Gaming',
  'Baby',
];

type DayFilter = 'all' | 0 | 1 | 2 | 3 | 5 | 6 | 7;

const DEFAULT_HERO_SLOTS: PlatformAnnouncementSlot[] = [
  {
    slot: 1,
    title: 'Chama Groups Are Strictly Referral-Only',
    message: 'Strangers cannot join. Every member must be vouched for by an active member and verified by phone by a moderator.',
    badge: 'RULE',
    accent: 'emerald',
    ctaLabel: 'Read Chama Rules',
    ctaUrl: '/chamas',
    status: 'published',
    isPublished: true,
    startsAt: undefined,
    endsAt: undefined,
    updatedAt: Date.now(),
    updatedBy: 'System',
    version: 1,
  },
  {
    slot: 2,
    title: 'Scheduled System Maintenance',
    message: 'M-Pesa reconciliation batch runs nightly from 02:00 to 02:30 EAT. Instant payouts will queue during this window.',
    badge: 'MAINTENANCE',
    accent: 'amber',
    ctaLabel: 'View Status',
    ctaUrl: '/announcements',
    status: 'published',
    isPublished: true,
    startsAt: undefined,
    endsAt: undefined,
    updatedAt: Date.now(),
    updatedBy: 'System',
    version: 1,
  },
  {
    slot: 3,
    title: 'Merchant Payout Policy',
    message: 'Funds are released to merchants only after the chama group moderator and buyer confirm receipt.',
    badge: 'POLICY',
    accent: 'sky',
    ctaLabel: 'Merchant Handbook',
    ctaUrl: '/merchant',
    status: 'published',
    isPublished: true,
    startsAt: undefined,
    endsAt: undefined,
    updatedAt: Date.now(),
    updatedBy: 'System',
    version: 1,
  },
];

const ACCENT_CARD_STYLES: Record<string, {
  card: string;
  badge: string;
  dot: string;
  cta: string;
}> = {
  emerald: {
    card: 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-[#11241C] hover:border-emerald-500/80',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    dot: 'bg-emerald-500',
    cta: 'bg-emerald-700 hover:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 shadow-emerald-900/20',
  },
  pink: {
    card: 'border-pink-200 dark:border-pink-900/60 bg-pink-50/40 dark:bg-[#251218] hover:border-pink-500/80',
    badge: 'bg-pink-100 text-pink-800 dark:bg-pink-950/80 dark:text-pink-300 border-pink-300 dark:border-pink-800',
    dot: 'bg-pink-500',
    cta: 'bg-pink-700 hover:bg-pink-800 text-white dark:bg-pink-600 dark:hover:bg-pink-500 shadow-pink-900/20',
  },
  violet: {
    card: 'border-violet-200 dark:border-violet-900/60 bg-violet-50/40 dark:bg-[#1D142A] hover:border-violet-500/80',
    badge: 'bg-violet-100 text-violet-800 dark:bg-violet-950/80 dark:text-violet-300 border-violet-300 dark:border-violet-800',
    dot: 'bg-violet-500',
    cta: 'bg-violet-700 hover:bg-violet-800 text-white dark:bg-violet-600 dark:hover:bg-violet-500 shadow-violet-900/20',
  },
  amber: {
    card: 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-[#261C10] hover:border-amber-500/80',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    dot: 'bg-amber-500',
    cta: 'bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-600 dark:hover:bg-amber-500 shadow-amber-900/20',
  },
  sky: {
    card: 'border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-[#101F29] hover:border-sky-500/80',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border-sky-300 dark:border-sky-800',
    dot: 'bg-sky-500',
    cta: 'bg-sky-700 hover:bg-sky-800 text-white dark:bg-sky-600 dark:hover:bg-sky-500 shadow-sky-900/20',
  },
};

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  onSelectProduct,
  searchQuery,
  onSearchChange,
  onClearSearch,
  onOpenAuth,
  onNavigate,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [aiModalProduct, setAiModalProduct] = useState<Product | null>(null);

  // Admin announcement creation state
  const [showAnnForm, setShowAnnForm] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annImageUrl, setAnnImageUrl] = useState('');
  const [submittingAnn, setSubmittingAnn] = useState(false);

  // Featured announcements slider state
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [jumpIndexInput, setJumpIndexInput] = useState('');
  const [isFeaturedPaused, setIsFeaturedPaused] = useState(false);

  // Admin-controlled 3 Hero Announcement Cards (Feature B)
  const [heroSlots, setHeroSlots] = useState<PlatformAnnouncementSlot[]>(DEFAULT_HERO_SLOTS);
  const [heroLoading, setHeroLoading] = useState(true);

  async function loadHeroSlots() {
    try {
      const res = await api.getHeroAnnouncementCards();
      const list = res.cards || res.announcements || [];
      const merged: PlatformAnnouncementSlot[] = [1, 2, 3].map((s) => {
        const found = list.find((c) => c.slot === s);
        return found || DEFAULT_HERO_SLOTS[s - 1];
      });
      setHeroSlots(merged);
    } catch {
      setHeroSlots(DEFAULT_HERO_SLOTS);
    } finally {
      setHeroLoading(false);
    }
  }

  useEffect(() => {
    loadHeroSlots();
    const interval = setInterval(loadHeroSlots, 60000);
    const handleFocus = () => loadHeroSlots();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Newly posted announcements state
  const [selectedDayFilter, setSelectedDayFilter] = useState<DayFilter>('all');
  const [newlyPostedIndex, setNewlyPostedIndex] = useState(0);
  const [isNewPaused, setIsNewPaused] = useState(false);

  useEffect(() => {
    loadHomeData();
  }, [selectedCategory, searchQuery]);

  async function loadHomeData() {
    setLoading(true);
    try {
      const [prodRes, grpRes, annRes] = await Promise.all([
        api.getProducts({
          category: selectedCategory !== 'All' ? selectedCategory : undefined,
          search: searchQuery || undefined,
        }),
        api.getGroups(),
        api.getAnnouncements().catch(() => ({ announcements: [] })),
      ]);
      setProducts(prodRes.products);
      setGroups(grpRes.groups);
      setAnnouncements(annRes.announcements || []);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!annTitle.trim() || !annBody.trim()) return;
    setSubmittingAnn(true);
    try {
      const res = await api.createAnnouncement({
        title: annTitle.trim(),
        body: annBody.trim(),
        imageUrl: annImageUrl.trim() || undefined,
      });
      setAnnouncements(prev => [res.announcement, ...prev]);
      setAnnTitle('');
      setAnnBody('');
      setAnnImageUrl('');
      setShowAnnForm(false);
    } catch {
      // ignore
    } finally {
      setSubmittingAnn(false);
    }
  }

  async function handleDeleteAnnouncement(id: string | number) {
    try {
      await api.deleteAnnouncement(id);
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch {
      // ignore
    }
  }

  // Count active groups per product
  const groupCountMap = groups.reduce((acc, g) => {
    acc[g.productId] = (acc[g.productId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  // Featured announcements (items with isFeatured === true, or fallback to all)
  const featuredAnnouncements = products.filter(p => p.isFeatured);
  const displayFeatured = featuredAnnouncements.length > 0 ? featuredAnnouncements : products;

  // 2.5-second right-to-left automatic slide for Featured Announcements
  useEffect(() => {
    if (displayFeatured.length <= 1 || isFeaturedPaused) return;

    const timer = setInterval(() => {
      setFeaturedIndex(prev => (prev + 1) % displayFeatured.length);
    }, 2500); // Exactly 2.5 second interval as requested

    return () => clearInterval(timer);
  }, [displayFeatured.length, isFeaturedPaused]);

  // Calculate day difference for newly posted items
  function getDaysAgo(createdAt: number): number {
    const diffMs = Math.max(0, Date.now() - createdAt);
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Filter newly posted announcements: strictly within 7 days (1 week)
  const allNewlyPosted = products.filter(p => {
    const days = getDaysAgo(p.createdAt);
    return days <= 7;
  });

  // Filter based on selected day tab
  const filteredNewlyPosted = allNewlyPosted.filter(p => {
    const days = getDaysAgo(p.createdAt);
    if (selectedDayFilter === 'all') return true;
    return days === selectedDayFilter;
  });

  // 2.5-second right-to-left automatic slide for Newly Posted Announcements
  useEffect(() => {
    if (filteredNewlyPosted.length <= 1 || isNewPaused) return;

    const timer = setInterval(() => {
      setNewlyPostedIndex(prev => (prev + 1) % filteredNewlyPosted.length);
    }, 2500); // Exactly 2.5 second interval as requested

    return () => clearInterval(timer);
  }, [filteredNewlyPosted.length, isNewPaused]);

  // Jump to specific featured announcement up to 100,000 scale
  function handleJumpToFeatured(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(jumpIndexInput.trim(), 10);
    if (!isNaN(parsed) && parsed >= 1 && displayFeatured.length > 0) {
      const targetIndex = (parsed - 1) % displayFeatured.length;
      setFeaturedIndex(targetIndex);
      setJumpIndexInput('');
    }
  }

  const { history, addSearch, removeSearch, clearHistory } = useSearchHistory(currentUser?.id);

  // When searchQuery changes from a submitted query, add to history
  useEffect(() => {
    if (searchQuery && searchQuery.trim().length > 1) {
      addSearch(searchQuery.trim());
    }
  }, [searchQuery, addSearch]);

  const currentFeatured = displayFeatured[featuredIndex] || displayFeatured[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* Search History Chips Row (Prompt 2 Feature A) */}
      {history && history.length > 0 && (
        <div
          role="region"
          aria-label="Recent search history"
          className="mb-5 flex items-center gap-2 flex-wrap text-xs animate-in fade-in duration-150"
        >
          <span className="text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1.5 shrink-0 select-none">
            <Clock className="w-3.5 h-3.5 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
            <span>Recent searches:</span>
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {history.map((query) => (
              <div
                key={query}
                className="inline-flex items-center gap-1 pl-3 pr-1 py-0.5 bg-slate-100 dark:bg-[#1A2622] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] text-slate-700 dark:text-slate-300 hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] rounded-full transition-colors border border-slate-200 dark:border-[#24312C] text-xs"
              >
                <button
                  type="button"
                  onClick={() => {
                    addSearch(query);
                    onSearchChange?.(query);
                  }}
                  className="cursor-pointer font-medium hover:underline focus:outline-none"
                  aria-label={`Search for ${query}`}
                >
                  {query}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSearch(query);
                  }}
                  className="w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  aria-label={`Remove ${query} from search history`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={clearHistory}
            className="text-[11px] font-medium text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400 underline ml-1 cursor-pointer transition-colors"
            aria-label="Clear all search history"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Guest Welcome & Authentication Prompt Strip (Public Announcements Landing) */}
      {!currentUser && (
        <div className="bg-gradient-to-r from-emerald-900 via-[#0E5A3C] to-emerald-950 text-white rounded-2xl p-4 sm:p-5 mb-8 shadow-md border border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0 shadow-sm font-black">
              <Megaphone className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold tracking-tight">
                  Welcome to Buyoll — Kenya's Social Fintech Chama Marketplace
                </h2>
                <span className="px-2 py-0.5 bg-emerald-700/80 text-emerald-100 text-[10px] font-bold rounded-full uppercase tracking-wider">
                  Public Feed
                </span>
              </div>
              <p className="text-xs text-emerald-100/80 mt-0.5 max-w-2xl leading-relaxed">
                Explore official announcements and genuine merchant Chama deals below. Sign in to access your private Chamas, Wallet, Merchant Catalog, or Peer Lending Desk.
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenAuth?.()}
            className="self-start sm:self-auto px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-sm shrink-0 flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <LogIn className="w-4 h-4" />
            <span>Log in / Sign up</span>
          </button>
        </div>
      )}

      {/* Platform Announcements & Notices (3 Admin-Controlled Hero Slots - Feature B) */}
      {!searchQuery && selectedCategory === 'All' && (
        <section className="bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl sm:rounded-3xl p-5 sm:p-6 mb-8 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-[#1E2B26] mb-5">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-emerald-50 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] rounded-xl">
                <Bell className="w-4 h-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                    Platform Announcements & Notices
                  </h2>
                  <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] text-[10px] font-extrabold rounded-full uppercase tracking-wider">
                    Verified
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Official rules, operational schedules, and policy updates verified by Buyoll Administration.
                </p>
              </div>
            </div>

            {currentUser?.role === 'admin' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onNavigate?.('admin-dashboard')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Manage Hero Cards</span>
                </button>
              </div>
            )}
          </div>

          {/* 3 Hero Cards Grid (Feature B) */}
          {heroLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-48 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#16221E] animate-pulse p-5 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                    <div className="h-5 w-3/4 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                    <div className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                    <div className="h-4 w-2/3 bg-slate-200 dark:bg-slate-700 rounded-md"></div>
                  </div>
                  <div className="h-8 w-28 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {heroSlots.map((card) => {
                const style = ACCENT_CARD_STYLES[card.accent] || ACCENT_CARD_STYLES.emerald;
                return (
                  <div
                    key={card.slot}
                    className={`rounded-2xl border p-5 flex flex-col justify-between transition-all duration-200 shadow-2xs hover:shadow-md ${style.card}`}
                  >
                    <div>
                      {/* Badge Pill & Slot Identifier */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-black tracking-wider uppercase rounded-md border ${style.badge}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          {card.badge || `NOTICE ${card.slot}`}
                        </span>
                        <span className="text-[10px] font-mono font-medium text-slate-400 dark:text-slate-500">
                          Slot #{card.slot}
                        </span>
                      </div>

                      {/* Card Title */}
                      <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white mb-2 leading-snug">
                        {card.title}
                      </h3>

                      {/* Card Message */}
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {card.message}
                      </p>
                    </div>

                    {/* Optional CTA Button */}
                    {card.ctaLabel && (
                      <div className="mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-800/60 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            if (!card.ctaUrl) return;
                            if (card.ctaUrl.startsWith('http')) {
                              window.open(card.ctaUrl, '_blank', 'noopener,noreferrer');
                            } else if (card.ctaUrl === '/chamas' || card.ctaUrl.startsWith('/chama')) {
                              onNavigate?.('my-chamas');
                            } else if (card.ctaUrl === '/merchant') {
                              onNavigate?.('vendor-dashboard');
                            } else if (card.ctaUrl === '/lender') {
                              onNavigate?.('lenders-dashboard');
                            } else if (card.ctaUrl === '/announcements') {
                              onNavigate?.('home');
                            } else {
                              window.location.href = card.ctaUrl;
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all active:scale-95 ${style.cta}`}
                        >
                          <span>{card.ctaLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>

                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                          Official
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 1. FEATURED DEAL SECTION ON HERO (Moving right-to-left at 2.5s interval, KSh 500/image merchant fee, 100k scale) */}
      {!searchQuery && selectedCategory === 'All' && currentFeatured && (
        <section
          onMouseEnter={() => setIsFeaturedPaused(true)}
          onMouseLeave={() => setIsFeaturedPaused(false)}
          className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#072418] via-[#0E5A3C] to-[#0a422c] text-white p-6 sm:p-10 mb-10 shadow-xl border border-emerald-900/40"
        >
          {/* Header Metadata Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-400 text-slate-950 font-black text-xs rounded-full uppercase tracking-wider shadow-sm">
                <Sparkles className="w-3.5 h-3.5" />
                Featured Deal
              </span>
            </div>

            {/* 100,000 Capacity Scale Counter & Direct Jump */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-emerald-200 font-mono">
                Showing Deal <b className="text-amber-300">#{featuredIndex + 1}</b> of <b className="text-white">100,000+</b>
              </span>
              <form onSubmit={handleJumpToFeatured} className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={jumpIndexInput}
                  onChange={(e) => setJumpIndexInput(e.target.value)}
                  placeholder="Jump #"
                  className="w-20 px-2 py-1 text-xs bg-black/40 border border-white/20 rounded-md text-white placeholder-emerald-200/50 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-md transition-colors"
                >
                  Go
                </button>
              </form>
            </div>
          </div>

          {/* Hero Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-200 mb-2">
                <Store className="w-3.5 h-3.5 text-amber-300" />
                <span>{currentFeatured.vendorName}</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                <span className="text-white/40">·</span>
                <span>{currentFeatured.category}</span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight leading-tight mb-3 text-white">
                {currentFeatured.title}
              </h1>

              <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed max-w-xl mb-6 line-clamp-3">
                {currentFeatured.description}
              </p>

              {/* Price & Discount Showcase */}
              <div className="bg-black/30 backdrop-blur-md rounded-2xl p-4 border border-white/10 mb-6 max-w-lg">
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-2xl sm:text-3xl font-black text-amber-300 tabular-nums">
                    KSh {currentFeatured.price.toLocaleString()}
                  </span>
                  {currentFeatured.wasPrice && currentFeatured.wasPrice > currentFeatured.price && (
                    <span className="text-sm text-emerald-200/70 line-through tabular-nums">
                      KSh {currentFeatured.wasPrice.toLocaleString()}
                    </span>
                  )}
                  {currentFeatured.discountPercent && currentFeatured.discountPercent > 0 && (
                    <span className="px-2 py-0.5 bg-[#FF6A00] text-white text-xs font-black rounded-md">
                      -{currentFeatured.discountPercent}% OFF
                    </span>
                  )}
                </div>
                <div className="text-xs text-emerald-200 font-semibold flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-300" />
                  <span>
                    Chama savings from{' '}
                    <b className="text-white">
                      KSh {Math.ceil(currentFeatured.price / 10 / 10).toLocaleString()} / day
                    </b>{' '}
                    · Instant Slot #1 Activation
                  </span>
                </div>
              </div>

              {/* CTA and Controls */}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={() => onSelectProduct(currentFeatured.id)}
                  className="flex items-center gap-2 px-6 py-3 bg-[#FF6A00] hover:bg-[#e85f00] text-white font-bold text-sm rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-95"
                >
                  <span>Explore Featured Chama Deal</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {/* Manual Navigation Controls (right-to-left) */}
                <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md px-2 py-1.5 rounded-xl border border-white/15">
                  <button
                    onClick={() =>
                      setFeaturedIndex(prev => (prev - 1 + displayFeatured.length) % displayFeatured.length)
                    }
                    title="Previous announcement"
                    className="p-1.5 hover:bg-white/20 text-white rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono px-2 text-emerald-200">
                    {featuredIndex + 1} / 100,000+
                  </span>
                  <button
                    onClick={() => setFeaturedIndex(prev => (prev + 1) % displayFeatured.length)}
                    title="Next announcement (move right to left)"
                    className="p-1.5 hover:bg-white/20 text-white rounded-lg transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Hero Right Visual */}
            <div className="lg:col-span-5">
              <div
                onClick={() => onSelectProduct(currentFeatured.id)}
                className="group relative bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-4 cursor-pointer hover:bg-white/15 transition-all shadow-2xl"
              >
                <div className="relative aspect-4/3 rounded-xl overflow-hidden mb-3 bg-black/20">
                  <img
                    src={resolveImageUrl(currentFeatured.images[0])}
                    alt={currentFeatured.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  {currentFeatured.discountPercent && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 bg-[#FF6A00] text-white text-xs font-black rounded-lg shadow-md">
                      SAVE {currentFeatured.discountPercent}%
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-black/70 backdrop-blur-md text-amber-300 text-xs font-mono font-bold rounded-lg border border-amber-300/30">
                    Deal #{featuredIndex + 1}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-emerald-200">
                  <span>Merchant: {currentFeatured.vendorName}</span>
                  <span className="font-bold text-amber-300">
                    Stock: {currentFeatured.stockQuantity || 20} available
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Featured Dots Tracker */}
          <div className="flex items-center justify-center gap-1.5 mt-6 pt-4 border-t border-white/10">
            {displayFeatured.slice(0, 10).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setFeaturedIndex(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  featuredIndex === idx ? 'w-6 bg-amber-400' : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
                title={`Go to featured deal ${idx + 1}`}
              />
            ))}
            {displayFeatured.length > 10 && (
              <span className="text-[10px] text-emerald-200/70 ml-1 font-mono">
                +{displayFeatured.length - 10} more
              </span>
            )}
          </div>
        </section>
      )}

      {/* 2. NEWLY POSTED ANNOUNCEMENTS SECTION (Stays for 1 week / 7 days, 2.5s auto & manual slide right-to-left) */}
      {!searchQuery && selectedCategory === 'All' && (
        <section
          onMouseEnter={() => setIsNewPaused(true)}
          onMouseLeave={() => setIsNewPaused(false)}
          className="bg-white border border-slate-200 rounded-3xl p-6 mb-10 shadow-sm"
        >
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="p-1.5 bg-orange-100 text-[#FF6A00] rounded-lg">
                  <Flame className="w-4 h-4" />
                </span>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Newly Posted Announcements
                </h2>
                <span className="px-2 py-0.5 bg-emerald-100 text-[#0E5A3C] text-[11px] font-bold rounded-full">
                  1-Week Active Window
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Announcements remain in this section for strictly 1 week (7 days) before leaving space for new products. All items remain permanently in Live Product Announcements below.
              </p>
            </div>

            {/* Navigation & Speed Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() =>
                  setNewlyPostedIndex(prev => (prev - 1 + filteredNewlyPosted.length) % Math.max(1, filteredNewlyPosted.length))
                }
                className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                title="Scroll Left"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setNewlyPostedIndex(prev => (prev + 1) % Math.max(1, filteredNewlyPosted.length))
                }
                className="p-2 border border-slate-200 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                title="Scroll Right (Auto moves right-to-left)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Day Filter Tabs: All New, Posted Today, Posted 1 day ago ... Posted 7 days ago */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-none">
            <button
              onClick={() => {
                setSelectedDayFilter('all');
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All New (7 Days) ({allNewlyPosted.length})
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(0);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 0
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
            >
              Posted Today
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(1);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 1
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 1 day ago
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(2);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 2
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 2 days ago
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(3);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 3
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 3 days ago
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(5);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 5
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 5 days ago
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(6);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 6
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 6 days ago
            </button>
            <button
              onClick={() => {
                setSelectedDayFilter(7);
                setNewlyPostedIndex(0);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                selectedDayFilter === 7
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Posted 7 days ago
            </button>
          </div>

          {/* Announcements Scrolling Track (moving right to left) */}
          {filteredNewlyPosted.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              No new announcements matching this specific post-date filter.
            </div>
          ) : (
            <div className="relative overflow-hidden">
              <div
                className="flex gap-4 transition-transform duration-700 ease-out"
                style={{
                  transform: `translateX(-${(newlyPostedIndex % filteredNewlyPosted.length) * 280}px)`,
                }}
              >
                {/* Duplicate the array to create seamless loop */}
                {[...filteredNewlyPosted, ...filteredNewlyPosted].map((prod, idx) => {
                  const daysAgo = getDaysAgo(prod.createdAt);
                  const minDaily = prod.speedOptions && prod.speedOptions.length > 0
                    ? Math.min(...prod.speedOptions.map(s => s.dailyAmount))
                    : Math.ceil(prod.price / 10 / 10);

                  return (
                    <div
                      key={`${prod.id}-${idx}`}
                      onClick={() => onSelectProduct(prod.id)}
                      className="w-64 shrink-0 bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden hover:border-[#0E5A3C] hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        {/* Image */}
                        <div className="relative aspect-4/3 w-full bg-slate-200 overflow-hidden">
                          <img
                            src={resolveImageUrl(prod.images[0])}
                            alt={prod.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          {/* Age badge */}
                          <div className="absolute top-2 left-2 px-2 py-0.5 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold rounded flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-amber-400" />
                            <span>
                              {daysAgo === 0 ? 'Posted Today' : `Posted ${daysAgo}d ago`}
                            </span>
                          </div>

                          {/* Optional merchant discount */}
                          {prod.discountPercent && prod.discountPercent > 0 && (
                            <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-[#FF6A00] text-white text-[10px] font-black rounded">
                              -{prod.discountPercent}%
                            </div>
                          )}
                        </div>

                        {/* Card Info */}
                        <div className="p-3">
                          <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1 truncate">
                            <Store className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{prod.vendorName}</span>
                          </div>

                          <h3 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mb-2">
                            {prod.title}
                          </h3>

                          <div className="flex items-baseline gap-1.5 mb-1">
                            <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                              KSh {prod.price.toLocaleString()}
                            </span>
                            {prod.wasPrice && prod.wasPrice > prod.price && (
                              <span className="text-[11px] text-slate-400 line-through tabular-nums">
                                KSh {prod.wasPrice.toLocaleString()}
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-[#0E5A3C] font-semibold">
                            Chama: KSh {minDaily.toLocaleString()} / day
                          </div>
                        </div>
                      </div>

                      <div className="p-3 pt-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectProduct(prod.id);
                          }}
                          className="w-full py-1.5 bg-slate-900 hover:bg-[#FF6A00] text-white text-[11px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                          <span>Join Chama</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3-Step Process Strip */}
      {!searchQuery && selectedCategory === 'All' && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#0E5A3C] flex items-center justify-center font-black text-sm shrink-0">
              01
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Choose Your Speed</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Select 10, 6, 4, or 2 members with clear daily installments and scheduled distribution dates.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-black text-sm shrink-0">
              02
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Starts Immediately</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                No waiting for every slot to fill. Your group is active on Member #1, and slots can be claimed anytime.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-sm shrink-0">
              03
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Track & Receive</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Pay daily to Platform Till <b>196853</b>, Paybill <b>522533</b> (Acc: <b>4363</b>), or Merchant Till <b>3463533</b>. One verified member receives their product every 10-day cycle.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-4 mb-6 border-b border-slate-200">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              selectedCategory === cat
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product Catalog Section: LIVE PRODUCT ANNOUNCEMENTS */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              {searchQuery ? `Search Results for "${searchQuery}"` : selectedCategory === 'All' ? 'Live Product Announcements' : selectedCategory}
            </h2>
            {searchQuery && (
              <span className="text-xs bg-amber-100 text-amber-900 font-bold px-2.5 py-0.5 rounded-full">
                {products.length} found
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {products.length} verified item{products.length !== 1 ? 's' : ''} available for Chama savings · Permanent inventory
          </p>
        </div>

        {searchQuery && onClearSearch && (
          <button
            onClick={onClearSearch}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors self-start sm:self-auto"
          >
            <X className="w-3.5 h-3.5" />
            <span>Clear Search</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-4 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-slate-400">Loading catalog...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 mb-1">No products available yet.</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery
              ? 'Try adjusting your search terms or view all categories.'
              : 'Registered merchants will post genuine verified products here shortly.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onSelect={onSelectProduct}
              activeGroupCount={groupCountMap[p.id] || 0}
              onAskAI={(prod) => setAiModalProduct(prod)}
            />
          ))}
        </div>
      )}

      {/* Dedicated Buyoll.ai Assistant Modal when launched from any Product Card */}
      {aiModalProduct && (
        <BuyollAIModal
          product={aiModalProduct}
          currentUser={null}
          onClose={() => setAiModalProduct(null)}
          onSelectProduct={(id) => {
            setAiModalProduct(null);
            onSelectProduct(id);
          }}
          onNotify={() => {}}
        />
      )}
    </div>
  );
};
