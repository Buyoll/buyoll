import React, { useState, useEffect } from 'react';
import { Product, ChamaGroup, SpeedOption, User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  ShieldCheck,
  Truck,
  RotateCcw,
  Users,
  ChevronRight,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  Info,
  Calendar,
  AlertCircle,
  Store,
  Tag,
  Edit3,
  Gift,
  Flame,
  Star,
  Plus,
  CreditCard,
  Lock,
  Bot,
  HelpCircle,
} from 'lucide-react';
import { VendorProductEditorModal } from './VendorProductEditorModal.tsx';
import { BuyollAIModal } from '../components/BuyollAIModal.tsx';

interface ProductDetailPageProps {
  productId: number;
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const ProductDetailPage: React.FC<ProductDetailPageProps> = ({
  productId,
  currentUser,
  onNavigate,
  onOpenAuth,
  onNotify,
}) => {
  const [product, setProduct] = useState<Product | null>(null);
  const [groups, setGroups] = useState<ChamaGroup[]>([]);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingProduct, setIsEditingProduct] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);

  // Gallery state
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Mandatory speed selection state
  const [selectedSpeed, setSelectedSpeed] = useState<number | null>(null);
  const [soloMonths, setSoloMonths] = useState<number>(3); // 1 to 6 months for 1-member Lipa Mdogomdogo
  const [customGroupName, setCustomGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [generatingGroups, setGeneratingGroups] = useState(false);

  // Joining group state
  const [joiningGroupId, setJoiningGroupId] = useState<number | null>(null);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [submittingJoin, setSubmittingJoin] = useState(false);

  useEffect(() => {
    loadProductDetails();
  }, [productId]);

  async function loadProductDetails() {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, allProdRes] = await Promise.all([
        api.getProduct(productId),
        api.getProducts(),
      ]);
      setProduct(prodRes.product);
      setGroups(prodRes.groups || []);

      // Default to 10-member speed if available
      if (prodRes.product.speedOptions && prodRes.product.speedOptions.length > 0) {
        setSelectedSpeed(prodRes.product.speedOptions[0].size);
      }

      // Filter products from other items/merchants (guaranteeing at least 5 recommendations)
      const others = allProdRes.products.filter(
        (p: Product) => p.id !== Number(productId)
      );
      setRecommendedProducts(others);
    } catch (err: any) {
      setError(err.message || 'Failed to load product details.');
    } finally {
      setLoading(false);
    }
  }

  // Pre-create 4 speed groups (10, 8, 6, 4 or 2 members) - Store Owner / Merchant / Admin action
  async function handleGenerateGroups() {
    if (!currentUser) {
      onNotify('info', 'Please sign in to manage Chama groups.');
      onOpenAuth();
      return;
    }
    if (!product) return;

    setGeneratingGroups(true);
    try {
      const res = await api.generateProductGroups(product.id);
      onNotify('success', res.message || 'Successfully created 4 speed groups!');
      loadProductDetails();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to generate speed groups');
    } finally {
      setGeneratingGroups(false);
    }
  }

  // Handle Merchant Custom Group Creation
  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) {
      onNotify('info', 'Please sign in to start a Chama group.');
      onOpenAuth();
      return;
    }

    if (!selectedSpeed) {
      onNotify('error', 'Mandatory speed selection required. Please choose a speed to continue.');
      return;
    }

    setCreatingGroup(true);
    try {
      const res = await api.createGroup({
        productId: product!.id,
        size: selectedSpeed,
        name: customGroupName.trim() || undefined,
      });

      onNotify('success', `Chama group created! Platform Till: 522533.`);
      onNavigate('group', res.group.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to start group.');
    } finally {
      setCreatingGroup(false);
    }
  }

  // Handle Join with Member's Invite Code
  async function handleJoinWithCode(targetGroupId?: number) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to join a Chama group.');
      onOpenAuth();
      return;
    }

    const trimmed = inviteCodeInput.trim().toUpperCase();
    if (!trimmed) {
      onNotify('error', 'Please enter a valid member invite code.');
      return;
    }

    setSubmittingJoin(true);
    try {
      const gid = targetGroupId || (groups.length > 0 ? groups[0].id : productId);
      const res = await api.joinGroup(gid, trimmed);
      onNotify('success', res.message || 'Joined Chama group successfully!');
      onNavigate('group', res.group.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to join group with this invite code.');
    } finally {
      setSubmittingJoin(false);
    }
  }

  // Direct join button on a specific group card
  async function handleDirectJoinGroup(targetGroup: ChamaGroup) {
    if (!currentUser) {
      onNotify('info', 'Please sign in to join a Chama group.');
      onOpenAuth();
      return;
    }

    const openSlot = targetGroup.slots.find(s => s.status === 'open' || s.status === 'replacement_eligible');
    const code = openSlot?.inviteCode || targetGroup.inviteCode;

    setSubmittingJoin(true);
    try {
      const res = await api.joinGroup(targetGroup.id, code);
      onNotify('success', res.message || 'Joined Chama group successfully!');
      onNavigate('group', res.group.id);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to join group.');
    } finally {
      setSubmittingJoin(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-8 h-8 border-4 border-[#0E5A3C] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm text-slate-500">Loading product announcement...</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="p-4 bg-red-50 text-red-700 rounded-xl mb-4 text-sm">
          {error || 'Product not found'}
        </div>
        <button
          onClick={() => onNavigate('home')}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
        >
          Return to Announcements
        </button>
      </div>
    );
  }

  const rawImages = product.images && product.images.length > 0
    ? product.images
    : ['./images/cookware_set.jpg'];

  const images = rawImages.map(img => resolveImageUrl(img));
  const currentImage = images[selectedImageIndex] || images[0];

  const selectedSpeedOption: SpeedOption | undefined = product.speedOptions.find(
    s => s.size === selectedSpeed
  );

  const isMerchantOrAdmin = currentUser && (currentUser.id === product.vendorId || currentUser.role === 'merchant' || currentUser.role === 'admin');

  // Groups filtered by selected speed (or all active groups)
  const speedMatchedGroups = selectedSpeed
    ? groups.filter(g => g.size === selectedSpeed)
    : groups;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-500 mb-6">
        <button onClick={() => onNavigate('home')} className="hover:text-slate-900 transition-colors">
          Home
        </button>
        <ChevronRight className="w-3 h-3 text-slate-400" />
        <button onClick={() => onNavigate('home')} className="hover:text-slate-900 transition-colors">
          {product.category}
        </button>
        <ChevronRight className="w-3 h-3 text-slate-400" />
        <span className="text-slate-900 font-medium truncate max-w-xs">{product.title}</span>
      </nav>

      {/* Main 2-Column Split: Left Gallery, Right Details & Speed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-16">
        {/* LEFT COLUMN: Gallery & Description (~58%) */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Main Large Image Container (Standardized Square 1000x1000 target standard) */}
          <div className="relative aspect-square w-full bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 shadow-xs">
            <img
              src={currentImage}
              alt={product.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover object-center"
            />

            {/* Promotion Ribbon */}
            {product.promotionType && product.promotionType !== 'none' && (
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-1">
                {product.promotionType === 'daily' && (
                  <span className="px-3 py-1 bg-rose-600 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 fill-current" />
                    <span>Daily Promotion Deal</span>
                  </span>
                )}
                {product.promotionType === 'weekly' && (
                  <span className="px-3 py-1 bg-amber-500 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 fill-current" />
                    <span>Weekly Special</span>
                  </span>
                )}
                {product.promotionType === 'monthly' && (
                  <span className="px-3 py-1 bg-indigo-600 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>Monthly Mega Promo</span>
                  </span>
                )}
              </div>
            )}

            {product.discountPercent && product.discountPercent > 0 && (
              <div className="absolute top-4 right-4 px-3 py-1 bg-[#FF6A00] text-white text-xs font-bold rounded-lg shadow-sm">
                SAVE {product.discountPercent}%
              </div>
            )}

            {/* Global Buyoll.ai Action Button directly on Product */}
            <button
              onClick={() => setIsAIOpen(true)}
              className="absolute bottom-4 right-4 px-3.5 py-2 bg-slate-900/90 hover:bg-[#0E5A3C] text-white text-xs font-bold rounded-xl shadow-lg backdrop-blur-xs flex items-center gap-1.5 border border-white/20 transition-all hover:scale-105"
            >
              <Sparkles className="w-4 h-4 text-amber-300 fill-current" />
              <span>Ask Buyoll.ai Assistant</span>
            </button>
          </div>

          {/* Thumbnail Strip */}
          {images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {images.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImageIndex(idx)}
                  className={`relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-all shrink-0 bg-slate-50 ${
                    selectedImageIndex === idx
                      ? 'border-[#0E5A3C] ring-2 ring-[#0E5A3C]/20'
                      : 'border-slate-200 opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {/* Enticing Free Bonus Gift Callout (Phone, Watch, Soap, Airtime) */}
          {product.bonusGift && (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-300/80 rounded-2xl flex items-center gap-3.5 shadow-xs">
              <div className="w-10 h-10 rounded-xl bg-[#0E5A3C] text-amber-300 flex items-center justify-center shrink-0">
                <Gift className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-black text-[#0E5A3C] uppercase tracking-wider">
                  🎁 Enticing Merchant Bonus Included
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  Free Gift: <span className="text-[#0E5A3C] font-extrabold">{product.bonusGift}</span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Delivered absolutely free along with your item when your Chama group cycle completes!
                </p>
              </div>
            </div>
          )}

          {/* Product Description & Technical Specifications */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="text-base font-bold text-slate-900 mb-3">Product Overview & Specifications</h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              {product.description}
            </p>

            {product.attributes && Object.keys(product.attributes).length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-3">
                  Key Specifications
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {Object.entries(product.attributes).map(([key, val]) => (
                    <div key={key} className="flex justify-between py-1.5 border-b border-slate-100">
                      <dt className="text-slate-500">{key}</dt>
                      <dd className="font-semibold text-slate-900">{val}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Trust Assurances */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 mt-6 border-t border-slate-100 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0E5A3C]" />
                <span>Buyoll 5-Star Verified Merchant</span>
              </div>
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#0E5A3C]" />
                <span>Doorstep Delivery on Cycle</span>
              </div>
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[#0E5A3C]" />
                <span>Manual Till Verification</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Buy & Chama Speed Selector (~42%) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            {/* Seller info with 5 stars and Buyoll Verified */}
            <div className="flex items-center justify-between gap-1.5 text-xs text-slate-500 mb-2">
              <div className="flex items-center gap-1.5 truncate">
                <span>Sold by</span>
                <span className="font-bold text-slate-900 flex items-center gap-1 truncate">
                  {product.vendorName.replace(/Buyoll Direct Official/gi, 'Buyoll Verified')}
                  <span className="text-amber-500 text-[11px] tracking-tighter">★★★★★</span>
                  <span className="text-[11px] font-bold text-emerald-800">(Buyoll Verified)</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                </span>
              </div>

              {currentUser && (currentUser.id === product.vendorId || currentUser.role === 'admin') && (
                <button
                  onClick={() => setIsEditingProduct(true)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold rounded-lg transition-colors shrink-0 border border-amber-200"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}
            </div>

            {/* Title */}
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug mb-3">
              {product.title}
            </h1>

            {/* Price Presentation */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 mb-6">
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-1 font-semibold">
                Cash / Full Value Price
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-extrabold text-slate-900 tabular-nums">
                  KSh {product.price.toLocaleString()}
                </span>
                {product.wasPrice && product.wasPrice > product.price && (
                  <span className="text-sm text-slate-400 line-through tabular-nums">
                    KSh {product.wasPrice.toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Pay flexibly in small daily installments with an active Buyoll Chama group below.
              </p>
            </div>

            {/* SECTION 1: MANDATORY "CHOOSE YOUR SPEED" */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <span>1. Choose Your Speed</span>
                  <span className="text-xs text-red-500 font-semibold">*Mandatory</span>
                </label>
                {selectedSpeed && (
                  <span className="text-xs text-[#0E5A3C] font-semibold">
                    {selectedSpeed === 1 ? '1 Member Solo (Lipa Mdogomdogo)' : `${selectedSpeed} members selected`}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Select your preferred group speed (10, 8, 6, 4, 2, or 1-member solo Lipa Mdogomdogo).
              </p>

              {/* Speed Option Cards */}
              <div className="space-y-2.5">
                {(() => {
                  const hasSolo = product.speedOptions?.some(s => s.size === 1);
                  const displayOptions: SpeedOption[] = [
                    ...(product.speedOptions || []),
                    ...(!hasSolo ? [{
                      size: 1,
                      cycleDays: soloMonths * 30,
                      dailyAmount: Math.ceil(product.price / (soloMonths * 30)),
                      totalAmount: product.price,
                      description: `1 Member Solo (Lipa Mdogomdogo) · ${soloMonths} Months gradual payment`,
                    }] : []),
                  ];

                  return displayOptions.map((opt) => {
                    const isSelected = selectedSpeed === opt.size;
                    const daily = opt.size === 1 ? Math.ceil(product.price / (soloMonths * 30)) : opt.dailyAmount;

                    return (
                      <div
                        key={opt.size}
                        onClick={() => setSelectedSpeed(opt.size)}
                        className={`relative flex items-center justify-between p-3.5 rounded-xl border-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#0E5A3C] bg-emerald-50/40 shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="speedSelection"
                            checked={isSelected}
                            onChange={() => setSelectedSpeed(opt.size)}
                            className="w-4 h-4 text-[#0E5A3C] focus:ring-[#0E5A3C] border-slate-300"
                          />
                          <div>
                            <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                              <span>{opt.size === 1 ? '1 Member Speed (Solo Lipa Mdogomdogo)' : `${opt.size} Members Speed`}</span>
                              {opt.size === 10 && (
                                <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">
                                  Most Popular
                                </span>
                              )}
                              {opt.size === 1 && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded">
                                  Pay Slowly (1-6 Months)
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {opt.size === 1
                                ? `Contribute gradually over ${soloMonths} month${soloMonths > 1 ? 's' : ''} (${soloMonths * 30} days) without waiting for others`
                                : opt.description || `Delivery cycle every ${opt.cycleDays} days`}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-extrabold text-[#0E5A3C] tabular-nums">
                            KSh {daily.toLocaleString()}
                            <span className="text-xs font-normal text-slate-500"> / day</span>
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            Total: KSh {opt.totalAmount.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* 1-MEMBER SPECIAL DURATION SELECTOR (1 to 6 Months Lipa Mdogomdogo) */}
              {selectedSpeed === 1 && (
                <div className="mt-3.5 p-4 bg-emerald-50 border-2 border-emerald-300 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-950">
                      Select Solo Contribution Duration (1 to 6 Months Maximum):
                    </span>
                    <span className="text-xs font-black text-[#0E5A3C]">
                      {soloMonths} Month{soloMonths > 1 ? 's' : ''} ({soloMonths * 30} Days)
                    </span>
                  </div>

                  <div className="grid grid-cols-6 gap-1.5">
                    {[1, 2, 3, 4, 5, 6].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSoloMonths(m)}
                        className={`py-1.5 text-xs font-bold rounded-lg transition-colors ${
                          soloMonths === m
                            ? 'bg-[#0E5A3C] text-white shadow-xs'
                            : 'bg-white text-slate-700 border border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {m} Mo
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between text-xs text-emerald-900 pt-1">
                    <span>Daily rate: <b>KSh {Math.ceil(product.price / (soloMonths * 30)).toLocaleString()} / day</b></span>
                    <span>Monthly rate: <b>KSh {Math.ceil(product.price / soloMonths).toLocaleString()} / month</b></span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateGroup}
                    disabled={creatingGroup}
                    className="w-full py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                  >
                    {creatingGroup ? 'Starting Plan...' : `Confirm & Start ${soloMonths}-Month Solo Contribution Plan`}
                  </button>
                </div>
              )}
            </div>

            {/* SECTION 2: PROMINENT JOIN AREA (RETAINED BOLDLY & NEATLY IN VISIBLE PLACE) */}
            <div className="border-t border-slate-200 pt-5">
              <div className="text-sm font-bold text-slate-900 mb-2">
                2. Choose your speed to continue, Join a Chama Group
              </div>

              {/* RETAINED SECTION: BOLD, NEAT, CLEAN IN PROMINENT VISIBLE PLACE */}
              <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl mb-4 shadow-xs">
                <div className="flex items-start gap-2.5 mb-2.5">
                  <CheckCircle2 className="w-5 h-5 text-[#0E5A3C] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-emerald-950 leading-snug">
                      Join an existing active group with a member's invite code and start saving towards this item.
                    </h3>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Enter the member invite code you received to lock in your rotation slot and start saving immediately.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                    placeholder="Enter Invite Code (e.g. SOLAR9X1)"
                    className="flex-1 px-3 py-2 bg-white border border-emerald-300 rounded-xl text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#0E5A3C]"
                  />
                  <button
                    onClick={() => handleJoinWithCode()}
                    disabled={submittingJoin || !inviteCodeInput.trim()}
                    className="px-4 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-xl transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {submittingJoin ? 'Joining...' : 'Join Group'}
                  </button>
                </div>
              </div>

              {/* Pre-Created Speed Groups Action (For Store Owners / Merchants / Admin) */}
              {isMerchantOrAdmin ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Store Owner Group Management</span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded">
                      Merchant Hub
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Pre-create standard speed groups (10, 8, 6, 4, 2, and 1-member solo) so buyers can choose speed and save immediately.
                  </p>
                  <button
                    onClick={handleGenerateGroups}
                    disabled={generatingGroups}
                    className="w-full py-2.5 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{generatingGroups ? 'Generating...' : 'Pre-Create Speed Groups (10, 8, 6, 4, 2, 1 Members)'}</span>
                  </button>
                </div>
              ) : null}
            </div>

            {/* Official Till & Manual Payment Notice */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col gap-1 text-xs text-slate-500">
              <div className="flex items-center justify-between">
                <span>Platform Till: <b className="text-[#0E5A3C] font-mono">196853</b> · Paybill: <b className="text-[#0E5A3C] font-mono">522533</b> (Acc: <b>4363</b>)</span>
                <span>Merchant Till: <b className="text-slate-900 font-mono">3463533</b></span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Manual M-Pesa on Till or Paybill. No automated STK push or escrow. Pay to Till and submit your M-Pesa reference code for verification.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ACTIVE CHAMA SPEED GROUPS SECTION */}
      <section className="border-t border-slate-200 pt-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Active Chama Speed Groups
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Store-created Chama groups for 10, 8, 6, 4 or 2 members. Select your speed and start saving immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              {groups.length} active group{groups.length !== 1 ? 's' : ''} available
            </span>
          </div>
        </div>

        {/* Groups Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((grp) => {
            const openSlots = grp.slots.filter(s => s.status === 'open' || s.status === 'replacement_eligible').length;
            const isMember = currentUser && grp.slots.some(s => s.userId === currentUser.id && s.status === 'active');
            const isJoiningThis = joiningGroupId === grp.id;

            return (
              <div
                key={grp.id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 hover:shadow-xs transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold px-2 py-0.5 bg-emerald-50 text-[#0E5A3C] rounded-md">
                      {grp.size}-member speed
                    </span>
                    <span className="text-xs font-bold text-[#0E5A3C] uppercase tracking-wider">
                      {grp.status}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 mb-1 line-clamp-1">
                    {grp.name}
                  </h3>
                  <p className="text-xs text-slate-500 mb-3">
                    Rotation delivery every <b>{grp.cycleDays} days</b> · M-Pesa Till: <b>522533</b>
                  </p>

                  {/* Capacity Progress Bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>{grp.occupiedCount} of {grp.size} members joined</span>
                      <span className="font-semibold text-emerald-700">{openSlots} slots available</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0E5A3C] rounded-full transition-all"
                        style={{ width: `${(grp.occupiedCount / grp.size) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Daily Rate */}
                  <div className="text-xs text-slate-600 mb-4">
                    Daily rate: <b className="text-slate-900">KSh {grp.dailyAmount.toLocaleString()}</b> / day
                  </div>
                </div>

                {/* Actions */}
                <div>
                  {isMember ? (
                    <button
                      onClick={() => onNavigate('group', grp.id)}
                      className="w-full py-2 bg-emerald-50 text-[#0E5A3C] font-semibold text-xs rounded-lg hover:bg-emerald-100 transition-colors"
                    >
                      You are a Member · Open Group
                    </button>
                  ) : isJoiningThis ? (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-700">
                        Enter Chama Invite Code:
                      </label>
                      <input
                        type="text"
                        value={inviteCodeInput}
                        onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                        placeholder="e.g. SOLAR9X1"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded bg-white font-mono uppercase"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleJoinWithCode(grp.id)}
                          disabled={submittingJoin}
                          className="flex-1 py-1.5 bg-[#FF6A00] text-white text-xs font-bold rounded"
                        >
                          {submittingJoin ? 'Joining...' : 'Confirm Join'}
                        </button>
                        <button
                          onClick={() => {
                            setJoiningGroupId(null);
                            setInviteCodeInput('');
                          }}
                          className="px-2.5 py-1.5 bg-slate-200 text-slate-700 text-xs rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onNavigate('group', grp.id)}
                        className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors"
                      >
                        View Details
                      </button>
                      {openSlots > 0 && (
                        <button
                          onClick={() => handleDirectJoinGroup(grp)}
                          className="flex-1 py-2 bg-[#FF6A00] hover:bg-[#e85f00] text-white text-xs font-bold rounded-lg transition-colors shadow-xs"
                        >
                          Join Group
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* RECOMMENDED FROM OTHER SHOPS & MERCHANTS */}
      <section className="border-t border-slate-200 pt-12 mt-12">
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
              Explore alternative verified items from independent partner merchants across Kenya.
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
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {rec.discountPercent && rec.discountPercent > 0 && (
                      <span className="absolute top-2 left-2 bg-[#FF6A00] text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                        -{rec.discountPercent}%
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mb-1 flex items-center justify-between">
                    <span className="truncate">{rec.category}</span>
                    <span className="text-amber-500 font-bold">★★★★★</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 line-clamp-2 leading-snug mb-2">
                    {rec.title}
                  </h4>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <div className="text-xs font-extrabold text-slate-900">
                    KSh {rec.price.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-[#0E5A3C] font-semibold">
                    From KSh {minDaily.toLocaleString()}/day
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Vendor Product Editor Modal */}
      {isEditingProduct && product && (
        <VendorProductEditorModal
          product={product}
          onClose={() => setIsEditingProduct(false)}
          onSaved={(updated) => {
            setProduct(updated);
            setIsEditingProduct(false);
            loadProductDetails();
          }}
          onNotify={onNotify}
        />
      )}

      {/* Global Buyoll.ai Dedicated Assistant Modal */}
      {isAIOpen && product && (
        <BuyollAIModal
          product={product}
          currentUser={currentUser}
          onClose={() => setIsAIOpen(false)}
          onNotify={onNotify}
          onOpenAuth={onOpenAuth}
        />
      )}
    </div>
  );
};
