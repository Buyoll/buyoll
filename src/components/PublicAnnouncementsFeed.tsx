import React, { useState, useEffect, useCallback } from 'react';
import { Announcement, User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { Megaphone, Pin, X, ArrowRight, Sparkles, Bell } from 'lucide-react';

interface PublicAnnouncementsFeedProps {
  currentUser: User | null;
  onNavigate?: (view: string, arg?: any) => void;
}

export const PublicAnnouncementsFeed: React.FC<PublicAnnouncementsFeedProps> = ({
  currentUser,
  onNavigate,
}) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filterType, setFilterType] = useState<'ALL' | 'NOTICE' | 'ANNOUNCEMENT' | 'PROMOTION'>('ALL');
  const [loading, setLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    try {
      const res = await api.getAnnouncements({
        type: filterType === 'ALL' ? undefined : filterType,
      });
      setAnnouncements(res.announcements || []);
    } catch {
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed, currentUser?.id, currentUser?.activeRole]);

  // Listen for real-time announcement updates dispatched globally by UserContext SSE
  useEffect(() => {
    const handler = () => loadFeed();
    window.addEventListener('buyoll:announcement-updated', handler);
    return () => window.removeEventListener('buyoll:announcement-updated', handler);
  }, [loadFeed]);

  async function handleDismiss(id: string | number) {
    setAnnouncements((prev) => prev.filter((a) => String(a.id) !== String(id)));
    if (currentUser) {
      try {
        await api.dismissAnnouncement(id);
      } catch {
        // local optimistic dismissal already applied
      }
    }
  }

  function handleCta(ctaUrl?: string) {
    if (!ctaUrl) return;
    if (ctaUrl === '/groups' || ctaUrl === '/chamas' || ctaUrl.startsWith('/group')) {
      onNavigate?.('my-chamas');
    } else if (ctaUrl === '/merchant') {
      onNavigate?.('vendor-dashboard');
    } else if (ctaUrl === '/lender') {
      onNavigate?.('lenders-dashboard');
    } else if (ctaUrl === '/announcements') {
      onNavigate?.('home');
    }
  }

  if (loading && announcements.length === 0) {
    return null;
  }

  if (announcements.length === 0 && filterType === 'ALL') {
    return null;
  }

  const badgeStyles: Record<string, string> = {
    PROMOTION: 'bg-[#FF6A00] text-white',
    NOTICE: 'bg-slate-900 text-white',
    ANNOUNCEMENT: 'bg-orange-100 text-[#ff6600]',
  };

  return (
    <div className="mt-5 pt-5 border-t border-slate-100 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800 uppercase tracking-wide">
          <Megaphone className="w-3.5 h-3.5 text-[#ff6600]" />
          <span>Admin Promotions & Official Notices ({announcements.length})</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'PROMOTION', 'NOTICE', 'ANNOUNCEMENT'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                filterType === t
                  ? 'bg-[#ff6600] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {announcements.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
          No active {filterType.toLowerCase()} notices right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {announcements.map((item) => {
            const typeKey = item.type || 'ANNOUNCEMENT';
            const isExternalCta = item.ctaUrl && /^https?:\/\//i.test(item.ctaUrl);
            return (
              <article
                key={item.id}
                className="relative bg-slate-50/80 border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between hover:border-[#ff6600] transition-colors"
              >
                {item.imageUrl && (
                  <div className="relative h-40 w-full bg-slate-200 overflow-hidden">
                    <img
                      src={resolveImageUrl(item.imageUrl)}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                    {item.pinned && (
                      <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 bg-[#ff6600] text-white text-[10px] font-bold rounded-md shadow-xs">
                        <Pin className="w-2.5 h-2.5" /> Pinned
                      </span>
                    )}
                  </div>
                )}

                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-md ${
                            badgeStyles[typeKey] || badgeStyles.ANNOUNCEMENT
                          }`}
                        >
                          {typeKey === 'PROMOTION' ? (
                            <Sparkles className="w-2.5 h-2.5" />
                          ) : (
                            <Bell className="w-2.5 h-2.5" />
                          )}
                          {typeKey}
                        </span>
                        {!item.imageUrl && item.pinned && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-[#ff6600] text-[10px] font-bold rounded-md">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDismiss(item.id)}
                        aria-label={`Dismiss ${item.title}`}
                        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer"
                        title="Dismiss notice"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <h3 className="text-sm font-extrabold text-slate-900 leading-snug mb-1.5">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                      {item.body}
                    </p>
                  </div>

                  {item.ctaLabel && item.ctaUrl && (
                    <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between">
                      {isExternalCta ? (
                        <a
                          href={item.ctaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff6600] hover:bg-[#e85d00] text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          <span>{item.ctaLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCta(item.ctaUrl)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff6600] hover:bg-[#e85d00] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                        >
                          <span>{item.ctaLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <span className="text-[10px] font-mono text-slate-400">Admin Verified</span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
