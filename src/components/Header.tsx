import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types.ts';
import { getUserActiveRole, getUserRoles } from '../utils/rbac.ts';
import { Share2, Menu, X, Copy, Check, MessageCircle, Bell } from 'lucide-react';
import { api, resolveImageUrl } from '../api.ts';
import {
  getInAppNotifications,
  requestNotificationPermission,
  getNotificationPermission,
  InAppNotification,
} from '../utils/notifications.ts';

interface HeaderProps {
  currentUser: User | null;
  currentView: string;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: (role?: 'member' | 'merchant' | 'lender') => void;
  onLogout: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit?: (q: string) => void;
  onOpenHelp?: (tab?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentView,
  onNavigate,
  onOpenAuth,
  onLogout,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onNotify,
}) => {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isNotifMenuOpen, setIsNotifMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [, setNotifPermission] = useState<NotificationPermission>('default');
  const [topPromoBanner, setTopPromoBanner] = useState<any>(null);
  const [isPromoDismissed, setIsPromoDismissed] = useState(false);
  const [showAdminManagedAreas, setShowAdminManagedAreas] = useState(false);

  useEffect(() => {
    api.getHeroAnnouncementCards()
      .then((res) => {
        const published = (res.cards || res.announcements || []).filter((c: any) => c.status === 'published');
        if (published.length > 0) {
          setTopPromoBanner(published[0]);
        }
      })
      .catch(() => {});
  }, []);

  const userRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const loadNotifications = () => {
    const localList = getInAppNotifications();
    setNotifications(localList);
    setNotifPermission(getNotificationPermission());

    api.getSystemNotifications()
      .then((res) => {
        if (res?.notifications) {
          const mapped: InAppNotification[] = res.notifications.map((n: any) => ({
            id: n.id,
            title: n.title,
            body: n.message,
            url: n.link || `/chama/${n.groupId}`,
            groupId: n.groupId,
            type: n.type || 'system',
            timestamp: n.timestamp,
            isRead: false,
          }));
          setNotifications((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            const newItems = mapped.filter((m) => !ids.has(m.id));
            return [...prev, ...newItems].sort((a, b) => b.timestamp - a.timestamp);
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadNotifications();
    const handleNotifUpdate = () => {
      setNotifications(getInAppNotifications());
    };
    window.addEventListener('buyoll_notifications_updated', handleNotifUpdate);
    return () => window.removeEventListener('buyoll_notifications_updated', handleNotifUpdate);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifMenuOpen(false);
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('#buyoll-hamburger-btn')
      ) {
        setIsMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = currentUser?.name
    ? currentUser.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'BY';

  const activeRole = getUserActiveRole(currentUser);
  const userRoles = getUserRoles(currentUser);

  const userRoleLabel =
    activeRole === 'admin'
      ? 'Admin'
      : activeRole === 'merchant'
      ? 'Merchant'
      : activeRole === 'lender'
      ? 'Lender'
      : 'Member';

  // Referral / Share Link logic
  const referralCode = currentUser?.id || currentUser?.phone || 'buyoll';
  const referralLink = typeof window !== 'undefined'
    ? `${window.location.origin}/join?ref=${referralCode}`
    : `https://buyoll.com/join?ref=${referralCode}`;

  const handleShareApp = async () => {
    const shareData = {
      title: 'Join me on Buyoll',
      text: 'Save together, lend smarter. Join my Group on Buyoll.',
      url: referralLink,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(referralLink);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 3000);
        onNotify?.('success', 'Invite link copied to clipboard!');
        return;
      } catch {
        // Fallback to modal
      }
    }

    setIsShareModalOpen(true);
  };

  const handleCopyFromModal = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
      onNotify?.('success', 'Invite link copied!');
    } catch {
      onNotify?.('info', 'Please select and copy the link manually.');
    }
  };

  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearchSubmit) {
      onSearchSubmit(searchQuery);
    }
    onNavigate('home');
  };

  const toggleAdminOutline = (checked: boolean) => {
    setShowAdminManagedAreas(checked);
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('adm', checked);
    }
  };

  return (
    <>
      <header className="hdr sticky top-0 z-50 bg-[var(--surface)] border-t-[3px] border-t-[#ff6600] shadow-[0_1px_0_var(--line)]">
        {/* Promo banner (admin / 11.11 promo) */}
        {!isPromoDismissed && (
          <div
            className="promo bg-gradient-to-r from-[#d9102f] via-[#f91c3f] to-[#d9102f] text-white relative transition-all duration-200"
            id="promo"
            data-admin="Promo banner · text, dates, link, on/off"
          >
            <div className="wrap max-w-[1280px] mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-center gap-3 sm:gap-4.5 relative text-center">
              {topPromoBanner ? (
                <>
                  <b className="text-base sm:text-2xl font-bold tracking-tight">Buyoll</b>
                  <span className="big text-xl sm:text-3xl font-bold text-[#ffe27a]">
                    [{topPromoBanner.badge || 'HOT'}]
                  </span>
                  <b className="text-xs sm:text-lg font-bold truncate max-w-[280px] sm:max-w-xl">
                    {topPromoBanner.title} · {topPromoBanner.message}
                  </b>
                  <button
                    onClick={() => onNavigate('home')}
                    className="tag hidden md:inline-block border-2 border-white rounded-full px-4 py-1 font-bold text-xs sm:text-sm hover:bg-white hover:text-[#f91c3f] transition-colors cursor-pointer"
                  >
                    Join now
                  </button>
                </>
              ) : (
                <>
                  <b className="text-lg sm:text-2xl font-bold tracking-tight">Buyoll</b>
                  <span className="big text-xl sm:text-3xl font-bold text-[#ffe27a]">11.11</span>
                  <b className="text-xs sm:text-lg font-bold">Mega Sale · up to 15% off</b>
                  <button
                    onClick={() => onNavigate('home')}
                    className="tag hidden md:inline-block border-2 border-white rounded-full px-4 py-1 font-bold text-xs sm:text-sm hover:bg-white hover:text-[#f91c3f] transition-colors cursor-pointer"
                  >
                    Join the sale
                  </button>
                </>
              )}
              <button
                type="button"
                className="x absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 bg-black/25 hover:bg-black/40 text-white w-6 h-6 rounded-full grid place-items-center cursor-pointer transition-colors border-0"
                aria-label="Close banner"
                onClick={() => setIsPromoDismissed(true)}
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Main row: Logo, Search Box, Sign In / Join */}
        <div className="main">
          <div className="wrap max-w-[1280px] mx-auto px-4 sm:px-6 py-2.5 sm:py-0 min-h-[76px] sm:h-[92px] flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-8">
            {/* Logo */}
            <a
              href="#home"
              onClick={(e) => {
                e.preventDefault();
                onSearchChange('');
                onNavigate('home');
              }}
              className="logo flex-none bg-white rounded-md leading-none hover:opacity-95 transition-opacity duration-150 cursor-pointer mr-auto sm:mr-0 p-1"
              aria-label="Buyoll home"
            >
              <img
                src={resolveImageUrl('buyoll_logo.png')}
                alt="Buyoll"
                className="w-24 h-14 sm:w-[112px] sm:h-[76px] block object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.src.endsWith('Buyoll_Shopping_Cart_Logo_23c2cc30.png')) {
                    target.src = './assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png';
                  }
                }}
              />
            </a>

            {/* Search Box */}
            <form
              onSubmit={handleSearchFormSubmit}
              className="box order-3 sm:order-2 flex-1 basis-full sm:basis-auto flex items-center border-2 border-[#ff6600] rounded-lg overflow-hidden bg-[var(--surface)] h-[46px] max-w-full sm:max-w-[760px] mx-auto focus-within:shadow-[0_0_0_3px_rgba(255,102,0,0.25)] transition-shadow"
              role="search"
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] ml-3.5 mr-2 self-center text-[var(--muted)] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search groups, members, loans…"
                aria-label="Search"
                className="flex-1 min-w-0 border-0 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] px-1"
              />
              <button
                type="submit"
                className="border-0 bg-[#ff8000] hover:bg-[#ff6600] text-white font-bold text-[15px] tracking-wide px-6 sm:px-9 h-full cursor-pointer transition-colors shrink-0"
              >
                Search
              </button>
            </form>

            {/* Right section: CTA Button or User Profile / Dropdown */}
            <div className="order-2 sm:order-3 flex items-center gap-2 shrink-0">
              {currentUser ? (
                <div className="relative" ref={userRef}>
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    aria-label="Account menu"
                    aria-expanded={isUserMenuOpen}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] transition-colors cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-[#ff6600]"
                  >
                    <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#ff6600] text-white grid place-items-center font-bold text-xs sm:text-[13px] shrink-0 shadow-xs">
                      {initials}
                    </span>
                    <span className="hidden md:block text-left leading-[1.2]">
                      <b className="block text-[var(--text)] text-[13px] font-semibold max-w-[120px] truncate">
                        {currentUser.name}
                      </b>
                      <span className="inline-block mt-0.5 bg-[#fff4ec] dark:bg-[#2a1608] text-[#ff6600] text-[10.5px] font-bold px-1.5 rounded-full">
                        {userRoleLabel}
                      </span>
                    </span>
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] min-w-[240px] bg-[var(--surface)] border border-[var(--line)] rounded-xl p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.7)] z-50 animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-2 border-b border-[var(--line)] mb-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[var(--text)]">{currentUser.name}</p>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 bg-[#fff4ec] dark:bg-[#2a1608] text-[#ff6600] rounded uppercase">
                            {activeRole}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--muted)] truncate">{currentUser.phone || currentUser.email}</p>
                        {currentUser.platformId && (
                          <div className="mt-1.5 flex items-center justify-between bg-[var(--field)] px-2 py-1 rounded text-[10.5px] font-mono text-[var(--text)]">
                            <span className="font-semibold text-[var(--muted)]">ID:</span>
                            <span className="font-bold">{currentUser.platformId}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(currentUser.platformId || '');
                                onNotify?.('success', 'Platform ID copied to clipboard!');
                              }}
                              title="Copy Customer ID"
                              className="text-[#ff6600] hover:text-[#ff8000] ml-1"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[11px]">
                          <span className="text-[#ff6600] font-semibold">Coins: {currentUser.coins || 0}</span>
                          <span className="text-[var(--muted)]">·</span>
                          <span className="text-[#ff8000] font-semibold">Points: {currentUser.points || 0}</span>
                        </div>
                      </div>

                      {/* Role Isolation Note */}
                      <div className="px-3 py-1.5 bg-[var(--field)] rounded-lg my-1 text-[10.5px] text-[var(--muted)]">
                        Signed in as <b className="capitalize text-[var(--text)]">{activeRole}</b>. To use another role, please log out and sign in with that account.
                      </div>

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('profile');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-[#ff6600] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] transition-colors flex items-center justify-between"
                      >
                        <span>My Profile</span>
                        <span className="text-[10px] bg-[#ff6600] text-white px-1.5 py-0.2 rounded-full font-bold">Private</span>
                      </button>

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('profile', 'overview');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[var(--text)] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] hover:text-[#ff6600] transition-colors"
                      >
                        My {userRoleLabel} Wallet
                      </button>

                      {activeRole === 'merchant' && (
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('vendor-dashboard');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[var(--text)] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] hover:text-[#ff6600] transition-colors"
                        >
                          Merchant Dashboard
                        </button>
                      )}

                      {activeRole === 'lender' && (
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('lenders-dashboard');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[var(--text)] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] hover:text-[#ff6600] transition-colors"
                        >
                          Lenders Desk
                        </button>
                      )}

                      <div className="my-1 border-t border-[var(--line)]" />

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#f91c3f] hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center justify-between"
                      >
                        <span>Log out</span>
                        <svg className="w-4 h-4 stroke-[#f91c3f]" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenAuth('member')}
                  className="cta bg-[#ff6600] hover:bg-[#ff8000] text-white border-0 rounded-lg h-[46px] px-6 font-bold text-[14px] cursor-pointer whitespace-nowrap transition-colors shadow-xs"
                >
                  Sign In / Join
                </button>
              )}

              {/* Mobile Hamburger (<768px) */}
              <button
                id="buyoll-hamburger-btn"
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
                className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg text-[var(--muted)] hover:bg-[#fff4ec] dark:hover:bg-[#2a1608] hover:text-[#ff6600] transition-colors focus:outline-none"
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Primary nav: background #f5f5f5, border-top 1px solid #e5e5e5, height 46px */}
        <nav className="nav bg-[var(--field)] border-t border-[var(--line)]" aria-label="Main Navigation">
          <div className="wrap max-w-[1280px] mx-auto px-4 sm:px-6 flex items-stretch h-[46px] overflow-x-auto no-scrollbar">
            {/* 1. Announcements */}
            <a
              href="#announcements"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('home');
              }}
              data-admin="Announcements & Notices · written by admin"
              className={`flex items-center gap-2 px-5 font-semibold whitespace-nowrap transition-colors border-b-[3px] text-[13.5px] cursor-pointer ${
                currentView === 'home'
                  ? 'on text-[#ff6600] border-[#ff6600] bg-[var(--surface)]'
                  : 'text-[var(--muted)] border-transparent hover:text-[#ff6600]'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H3v6h3l5 4V5z" />
                <path d="M16 9a4 4 0 010 6" />
              </svg>
              <span>Announcements</span>
            </a>

            {/* 2. My Groups */}
            <a
              href="#my-groups"
              onClick={(e) => {
                e.preventDefault();
                if (!currentUser) {
                  onOpenAuth('member');
                } else if (activeRole === 'merchant') {
                  onNotify?.('info', 'Merchants have a dedicated My Groups oversight in the Merchant Dashboard.');
                  onNavigate('vendor-dashboard');
                } else if (activeRole === 'lender') {
                  onNotify?.('info', 'Lenders can review and fund groups from the Lenders Desk.');
                  onNavigate('lenders-dashboard');
                } else {
                  onNavigate('my-chamas');
                }
              }}
              className={`flex items-center gap-2 px-5 font-semibold whitespace-nowrap transition-colors border-b-[3px] text-[13.5px] cursor-pointer ${
                currentView === 'my-chamas'
                  ? 'on text-[#ff6600] border-[#ff6600] bg-[var(--surface)]'
                  : 'text-[var(--muted)] border-transparent hover:text-[#ff6600]'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3" />
                <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                <circle cx="17" cy="9" r="2.5" />
                <path d="M17 14c2.2 0 4 1.8 4 4" />
              </svg>
              <span>My Groups</span>
            </a>

            {/* 3. Merchant */}
            <a
              href="#merchant"
              onClick={(e) => {
                e.preventDefault();
                if (currentUser && activeRole === 'merchant') {
                  onNavigate('vendor-dashboard');
                } else if (currentUser) {
                  onNotify?.('info', `You are currently signed in as a ${activeRole}. To access the Merchant dashboard, please log out and sign in or register as a Merchant.`);
                } else {
                  onOpenAuth('merchant');
                }
              }}
              className={`flex items-center gap-2 px-5 font-semibold whitespace-nowrap transition-colors border-b-[3px] text-[13.5px] cursor-pointer ${
                currentView === 'vendor-dashboard'
                  ? 'on text-[#ff6600] border-[#ff6600] bg-[var(--surface)]'
                  : 'text-[var(--muted)] border-transparent hover:text-[#ff6600]'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3" />
              </svg>
              <span>Merchant</span>
            </a>

            {/* 4. Lender */}
            <a
              href="#lender"
              onClick={(e) => {
                e.preventDefault();
                if (currentUser && activeRole === 'lender') {
                  onNavigate('lenders-dashboard');
                } else if (currentUser) {
                  onNotify?.('info', `You are currently signed in as a ${activeRole}. To access the Lenders Desk, please log out and sign in or register as a Lender.`);
                } else {
                  onOpenAuth('lender');
                }
              }}
              className={`flex items-center gap-2 px-5 font-semibold whitespace-nowrap transition-colors border-b-[3px] text-[13.5px] cursor-pointer ${
                currentView === 'lenders-dashboard'
                  ? 'on text-[#ff6600] border-[#ff6600] bg-[var(--surface)]'
                  : 'text-[var(--muted)] border-transparent hover:text-[#ff6600]'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
              </svg>
              <span>Lender</span>
            </a>

            {/* 5. Share */}
            <a
              href="#share"
              onClick={(e) => {
                e.preventDefault();
                handleShareApp();
              }}
              className="flex items-center gap-2 px-5 font-semibold whitespace-nowrap transition-colors border-b-[3px] border-transparent text-[13.5px] text-[var(--muted)] hover:text-[#ff6600] cursor-pointer ml-auto sm:ml-0"
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
              </svg>
              <span>Share</span>
            </a>
          </div>
        </nav>

        {/* Mobile Slide-Down Menu */}
        {isMobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="md:hidden border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-lg animate-in slide-in-from-top-2 duration-150"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile Navigation">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onNavigate('home');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  currentView === 'home'
                    ? 'text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608]'
                    : 'text-[var(--text)] hover:bg-[var(--field)]'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M11 5L6 9H3v6h3l5 4V5z" />
                  <path d="M16 9a4 4 0 010 6" />
                </svg>
                <span>Announcements</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (!currentUser) onOpenAuth('member');
                  else if (activeRole === 'merchant') {
                    onNotify?.('info', 'Merchants have a dedicated My Groups oversight in the Merchant Dashboard.');
                    onNavigate('vendor-dashboard');
                  } else if (activeRole === 'lender') {
                    onNotify?.('info', 'Lenders can review and fund groups from the Lenders Desk.');
                    onNavigate('lenders-dashboard');
                  } else onNavigate('my-chamas');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  currentView === 'my-chamas'
                    ? 'text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608]'
                    : 'text-[var(--text)] hover:bg-[var(--field)]'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M17 14c2.2 0 4 1.8 4 4" />
                </svg>
                <span>My Groups</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentUser && activeRole === 'merchant') onNavigate('vendor-dashboard');
                  else if (currentUser) {
                    onNotify?.('info', `You are currently signed in as a ${activeRole}. To access the Merchant dashboard, please log out and sign in or register as a Merchant.`);
                  } else onOpenAuth('merchant');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  currentView === 'vendor-dashboard'
                    ? 'text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608]'
                    : 'text-[var(--text)] hover:bg-[var(--field)]'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 9l1-5h14l1 5M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3" />
                </svg>
                <span>Merchant</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (currentUser && activeRole === 'lender') onNavigate('lenders-dashboard');
                  else if (currentUser) {
                    onNotify?.('info', `You are currently signed in as a ${activeRole}. To access the Lenders Desk, please log out and sign in or register as a Lender.`);
                  } else onOpenAuth('lender');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  currentView === 'lenders-dashboard'
                    ? 'text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608]'
                    : 'text-[var(--text)] hover:bg-[var(--field)]'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
                </svg>
                <span>Lender</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleShareApp();
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608] transition-colors"
              >
                <Share2 className="w-5 h-5 shrink-0" />
                <span>Share</span>
              </button>

              {currentUser && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onNavigate('profile');
                  }}
                  className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold border-t border-[var(--line)] mt-1 pt-2 transition-colors ${
                    currentView === 'profile'
                      ? 'text-[#ff6600] bg-[#fff4ec] dark:bg-[#2a1608]'
                      : 'text-[var(--text)] hover:bg-[var(--field)]'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-[#ff6600] text-white flex items-center justify-center text-[10px] font-bold">
                    {initials}
                  </span>
                  <span>My Profile ({currentUser.platformId || activeRole})</span>
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Admin Demo Bar */}
      <div className="bar max-w-[1280px] mx-auto my-3 px-4 sm:px-6 flex gap-4 items-center flex-wrap text-xs text-[var(--muted)]">
        <label className="flex gap-2 items-center cursor-pointer text-[var(--text)]">
          <input
            type="checkbox"
            checked={showAdminManagedAreas}
            onChange={(e) => toggleAdminOutline(e.target.checked)}
            className="rounded text-[#ff6600] focus:ring-[#ff6600]"
          />
          <span>Show admin-managed areas</span>
        </label>
        {isPromoDismissed && (
          <button
            type="button"
            onClick={() => setIsPromoDismissed(false)}
            className="border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] rounded-md px-3 py-1 cursor-pointer hover:border-[#ff6600] transition-colors"
          >
            Restore banner
          </button>
        )}
      </div>

      {/* Share Fallback Modal */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] mb-4">
              <h3 className="font-bold text-[var(--text)] text-sm flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#ff6600]" />
                <span>Invite Friends to Buyoll</span>
              </h3>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-1.5 text-[var(--muted)] hover:text-[var(--text)] rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--muted)] mb-4 leading-relaxed">
              Share your referral link. When new members join your Group, both of you earn platform reward coins!
            </p>

            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={referralLink}
                className="flex-1 bg-[var(--field)] border border-[var(--line)] text-xs font-mono text-[var(--text)] rounded-xl px-3 py-2.5 select-all focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyFromModal}
                className="px-3.5 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `Save together, lend smarter. Join my Group on Buyoll: ${referralLink}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold text-xs rounded-xl transition-colors shadow-xs"
            >
              <MessageCircle className="w-4 h-4" />
              <span>Share on WhatsApp</span>
            </a>
          </div>
        </div>
      )}
    </>
  );
};
