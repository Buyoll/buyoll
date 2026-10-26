import React from 'react';
import { Product } from '../types.ts';
import { resolveImageUrl } from '../api.ts';
import { Users, CheckCircle2, Gift, Sparkles, Flame, Star } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onSelect: (productId: number) => void;
  activeGroupCount?: number;
  onAskAI?: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onSelect,
  activeGroupCount = 0,
  onAskAI,
}) => {
  // Lowest daily amount across configured speed options
  const minDaily = product.speedOptions && product.speedOptions.length > 0
    ? Math.min(...product.speedOptions.map(s => s.dailyAmount))
    : Math.ceil(product.price / 10 / 10);

  const mainImage = resolveImageUrl(product.images?.[0]);

  // Clean vendor name: replace old "Buyoll Direct Official" or "Alibaird Direct Official"
  let cleanVendor = (product.vendorName || 'Buyoll Verified')
    .replace(/Alibaird Direct Official/gi, 'Buyoll Verified')
    .replace(/Buyoll Direct Official/gi, 'Buyoll Verified');

  return (
    <article
      onClick={() => onSelect(product.id)}
      className="group flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 hover:shadow-md transition-all cursor-pointer relative"
    >
      {/* Standardized Square Product Image (1000x1000 target standard) */}
      <div className="relative aspect-square w-full bg-slate-50 overflow-hidden">
        <img
          src={mainImage}
          alt={product.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />

        {/* Promotion Badges (Daily, Weekly, Monthly) */}
        {product.promotionType && product.promotionType !== 'none' && (
          <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1">
            {product.promotionType === 'daily' && (
              <span className="px-2 py-0.5 bg-rose-600 text-white text-[10px] font-black uppercase tracking-wider rounded shadow-xs flex items-center gap-1">
                <Flame className="w-3 h-3 fill-current" />
                <span>Daily Promo</span>
              </span>
            )}
            {product.promotionType === 'weekly' && (
              <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider rounded shadow-xs flex items-center gap-1">
                <Sparkles className="w-3 h-3 fill-current" />
                <span>Weekly Deal</span>
              </span>
            )}
            {product.promotionType === 'monthly' && (
              <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider rounded shadow-xs flex items-center gap-1">
                <Star className="w-3 h-3 fill-current" />
                <span>Monthly Promo</span>
              </span>
            )}
          </div>
        )}

        {/* Discount Badge */}
        {product.discountPercent && product.discountPercent > 0 && (
          <div className="absolute top-2.5 right-2.5 px-2 py-0.5 bg-[#FF6A00] text-white text-[11px] font-bold rounded shadow-xs">
            -{product.discountPercent}% OFF
          </div>
        )}

        {/* Bonus Free Gift Tag (Phone, Watch, Soap, Airtime) */}
        {product.bonusGift && (
          <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1 bg-emerald-950/90 backdrop-blur-xs text-emerald-200 text-[11px] font-bold rounded-lg shadow-sm flex items-center gap-1.5 truncate border border-emerald-500/30">
            <Gift className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">FREE Gift: <span className="text-white font-extrabold">{product.bonusGift}</span></span>
          </div>
        )}
      </div>

      {/* Product Body */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          {/* Merchant Header with Buyoll Verified & 5-Star Rating */}
          <div className="flex items-center justify-between gap-1.5 text-xs text-slate-500 mb-1.5">
            <span className="truncate">{product.category}</span>
            <span className="flex items-center gap-1 text-emerald-700 font-semibold shrink-0">
              <span className="text-amber-500 tracking-tighter text-[11px]">★★★★★</span>
              <span className="text-[11px] font-bold text-slate-800">(Buyoll Verified)</span>
              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2 min-h-10 mb-2">
            {product.title}
          </h3>

          {/* Price Block */}
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-lg font-bold text-slate-900 tabular-nums">
              KSh {product.price.toLocaleString()}
            </span>
            {product.wasPrice && product.wasPrice > product.price && (
              <span className="text-xs text-slate-400 line-through tabular-nums">
                KSh {product.wasPrice.toLocaleString()}
              </span>
            )}
          </div>

          {/* Daily Chama rate */}
          <div className="text-xs text-[#0E5A3C] font-semibold mb-3">
            From KSh {minDaily.toLocaleString()} / day in Chama
          </div>
        </div>

        {/* Card Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 flex-wrap">
          {onAskAI && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAskAI(product);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-[#0E5A3C] text-[11px] font-bold rounded-lg border border-emerald-200 transition-colors"
              title="Ask Buyoll.ai about this product"
            >
              <Sparkles className="w-3 h-3 text-amber-500 fill-current" />
              <span>Ask Buyoll.ai</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect(product.id);
            }}
            className="ml-auto px-3 py-1.5 bg-slate-900 group-hover:bg-[#FF6A00] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            View Details
          </button>
        </div>
      </div>
    </article>
  );
};
