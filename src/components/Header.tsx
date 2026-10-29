import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types.ts';
import { Share2, Menu, X, Copy, Check, MessageCircle, Bell, Sparkles, Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { api, resolveImageUrl } from '../api.ts';
import {
  getInAppNotifications,
  markAllNotificationsAsRead,
  clearInAppNotifications,
  requestNotificationPermission,
  getNotificationPermission,
  InAppNotification,
} from '../utils/notifications.ts';

interface HeaderProps {
  currentUser: User | null;
  currentView: string;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: (role?: 'member' | 'merchant' | 'lender' | 'admin') => void;
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
  onOpenHelp,
  onNotify,
}) => {
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isNotifMenuOpen, setIsNotifMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  const adminRef = useRef<HTMLDivElement>(null);
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

  // Dynamic push notifications preference persisted to database per user
  const [pushEnabledInDb, setPushEnabledInDb] = useState<boolean>(() => {
    return Boolean(currentUser?.preferences?.pushNotificationsEnabled);
  });

  useEffect(() => {
    if (currentUser) {
      api.getUserPreferences().then((res) => {
        if (res?.preferences?.pushNotificationsEnabled !== undefined) {
          setPushEnabledInDb(Boolean(res.preferences.pushNotificationsEnabled));
        }
      }).catch(() => {});
    }
  }, [currentUser]);

  const handleTogglePushNotifications = async () => {
    const nextState = !pushEnabledInDb;
    let granted = notifPermission === 'granted';
    if (nextState && !granted) {
      granted = await requestNotificationPermission();
      setNotifPermission(getNotificationPermission());
    }

    setPushEnabledInDb(nextState);
    if (currentUser) {
      try {
        await api.updateUserPreferences({ pushNotificationsEnabled: nextState });
      } catch (e) {
        console.warn('Failed to persist push notification preference to DB:', e);
      }
    }
    if (onNotify) {
      onNotify('success', nextState ? 'Push alerts enabled & saved to your account!' : 'Push alerts disabled.');
    }
  };

  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;

  // Dark mode state with persistence & system preference detection
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem('buyoll_theme');
    if (saved) return saved === 'dark';
    return (
      document.documentElement.classList.contains('dark') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('buyoll_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('buyoll_theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark((prev) => !prev);
  };

  // Scroll listener for soft shadow on scroll
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(event.target as Node)) {
        setIsAdminMenuOpen(false);
      }
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

  const userRoleLabel =
    currentUser?.role === 'admin'
      ? 'Admin'
      : currentUser?.role === 'merchant'
      ? 'Merchant'
      : currentUser?.role === 'lender'
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
      text: 'Save together, lend smarter. Join my Chama on Buyoll.',
      url: referralLink,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        // Ignore user cancellation (AbortError) without displaying an error
        if (err.name === 'AbortError') return;
      }
    }

    // Fallback 1: Clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(referralLink);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 3000);
        onNotify?.('success', 'Invite link copied to clipboard!');
        return;
      } catch {
        // Fallback 2: Open modal
      }
    }

    // Fallback 2: Open modal
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

  return (
    <>
      {/* Top green announcement bar: keeps full width */}
      <div className="w-full bg-[#0F5C3A] dark:bg-[#12372A] text-white dark:text-[#4ADE9A] text-[13px] text-center h-9 leading-9 font-medium px-4 tracking-normal select-none border-b border-transparent dark:border-[#24312C] transition-colors duration-150">
        Welcome back to Buyoll — save together, lend smarter.
      </div>

      {/* Main Sticky Header */}
      <header
        className={`sticky top-0 z-50 bg-white dark:bg-[#111A17] border-b border-[#E5E7EB] dark:border-[#24312C] transition-all duration-150 ${
          isScrolled ? 'shadow-md dark:shadow-[0_4px_20px_rgba(0,0,0,0.6)]' : 'shadow-xs'
        }`}
      >
        {/* Centered container: max-width 1200px, margin 0 auto, horizontal padding 16px (mobile) / 24px (desktop) */}
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-2.5 sm:py-3">
          {/* Row 1: Logo left, Nav items CENTERED in available space, Divider + Sign In / Join on right */}
          <div className="flex items-center justify-between gap-2 lg:gap-4 h-14 sm:h-16">
            {/* Logo on the LEFT */}
            <button
              onClick={() => {
                onSearchChange('');
                onNavigate('home');
              }}
              className="flex shrink-0 items-center hover:opacity-95 transition-opacity duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] rounded-lg"
              aria-label="Buyoll Home"
            >
              <img
                src={resolveImageUrl('buyoll_logo.png')}
                alt="Buyoll"
                className="h-11 sm:h-14 lg:h-16 w-auto object-contain block py-0.5"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (!target.src.endsWith('Buyoll_Shopping_Cart_Logo_23c2cc30.png')) {
                    target.src = './assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png';
                  }
                }}
              />
            </button>

            {/* Desktop & Tablet: Nav items CENTERED in the available space with even gap (8-12px) */}
            <nav
              aria-label="Main Navigation"
              className="hidden md:flex flex-1 items-center justify-center gap-1.5 lg:gap-2.5 mx-2"
            >
              {/* Announcements */}
              <button
                onClick={() => onNavigate('home')}
                aria-current={currentView === 'home' ? 'page' : undefined}
                className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                  currentView === 'home'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                }`}
              >
                <svg
                  className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                  <path d="M15 9a4 4 0 0 1 0 6" />
                </svg>
                <span className="leading-tight text-center">Announcements</span>
              </button>

              {/* My Chamas */}
              <button
                onClick={() => {
                  if (!currentUser) onOpenAuth('member');
                  else onNavigate('my-chamas');
                }}
                aria-current={currentView === 'my-chamas' ? 'page' : undefined}
                className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                  currentView === 'my-chamas'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                }`}
              >
                <svg
                  className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3 20a6 6 0 0 1 12 0" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M17 14a5 5 0 0 1 4 5" />
                </svg>
                <span className="leading-tight text-center">My Chamas</span>
              </button>

              {/* Wallet */}
              <button
                onClick={() => {
                  if (!currentUser) onOpenAuth('member');
                  else onNavigate('wallet');
                }}
                aria-current={currentView === 'wallet' ? 'page' : undefined}
                className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                  currentView === 'wallet'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                }`}
              >
                <svg
                  className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18M16 14.5h2" />
                </svg>
                <span className="leading-tight text-center">Wallet</span>
              </button>

              {/* Help & FAQ */}
              <button
                onClick={() => onOpenHelp?.('faq')}
                className="flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
              >
                <svg
                  className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
                </svg>
                <span className="leading-tight text-center">Help &amp; FAQ</span>
              </button>

              {/* Dark Mode Theme Toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDark ? 'Switch to light theme' : 'Switch to high-contrast dark theme'}
                title={isDark ? 'Light Theme' : 'High-Contrast Dark Theme'}
                className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
              >
                {isDark ? (
                  <svg
                    className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-amber-300"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-slate-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                  </svg>
                )}
                <span className="leading-tight text-center">{isDark ? 'Light' : 'Dark'}</span>
              </button>

              {/* Share App button (Prompt 2 Feature B) */}
              <button
                type="button"
                onClick={handleShareApp}
                aria-label="Share App with friends"
                title="Share App & Earn referral points"
                className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
              >
                <Share2 className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                <span className="leading-tight text-center">Share</span>
              </button>
            </nav>

            {/* Right section: Notification Bell + Vertical Divider + User Profile / Sign In Button */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              {/* Notification Bell Dropdown */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => {
                    setIsNotifMenuOpen(!isNotifMenuOpen);
                    if (!isNotifMenuOpen) {
                      markAllNotificationsAsRead();
                    }
                  }}
                  aria-label="Notifications"
                  aria-expanded={isNotifMenuOpen}
                  title="Chama Alerts & Push Notifications"
                  className="relative flex items-center justify-center p-2 rounded-xl text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                >
                  <Bell className="w-5 h-5" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center shadow-xs animate-pulse">
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                  )}
                </button>

                {isNotifMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+8px)] w-80 sm:w-96 bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-2xl p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EB] dark:border-[#24312C] mb-2">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-[#0F5C3A] dark:text-[#4ADE9A]" />
                        <h4 className="text-xs font-black text-[#111827] dark:text-[#F3F4F6] uppercase tracking-wider">
                          Chama Alerts &amp; Invites
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        {notifications.length > 0 && (
                          <button
                            onClick={() => {
                              clearInAppNotifications();
                              setNotifications([]);
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            Clear
                          </button>
                        )}
                        <span className="text-[10px] bg-[#E7F3EC] dark:bg-[#12372A] text-[#0F5C3A] dark:text-[#4ADE9A] font-bold px-2 py-0.5 rounded-full">
                          {notifications.length} Total
                        </span>
                      </div>
                    </div>

                    {/* Dynamic Push Notifications Banner */}
                    <div className="mb-2 p-2.5 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-2">
                      <div className="text-[11px] text-emerald-950 dark:text-emerald-200">
                        <p className="font-bold flex items-center gap-1.5">
                          <span>Push Notifications</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${pushEnabledInDb ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'}`}>
                            {pushEnabledInDb ? 'Active' : 'Off'}
                          </span>
                        </p>
                        <p className="text-[10px] text-emerald-800 dark:text-emerald-300">Get alerts even when app is minimized</p>
                      </div>
                      <button
                        onClick={handleTogglePushNotifications}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-lg shadow-xs shrink-0 cursor-pointer transition-colors ${
                          pushEnabledInDb ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-[#0F5C3A] hover:bg-[#0b4830] text-white'
                        }`}
                      >
                        {pushEnabledInDb ? 'Enabled (✓)' : 'Enable'}
                      </button>
                    </div>

                    {/* Notifications list */}
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                        <Bell className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                        <p>No new notifications</p>
                        <p className="text-[10px] mt-0.5">You're all caught up with your Chamas!</p>
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {notifications.map((notif) => (
                          <div
                            key={notif.id}
                            onClick={() => {
                              setIsNotifMenuOpen(false);
                              if (notif.groupId) {
                                onNavigate('group', notif.groupId);
                              } else if (notif.url) {
                                const match = notif.url.match(/\/chama\/(\d+)/);
                                if (match) onNavigate('group', Number(match[1]));
                                else if (notif.url.includes('wallet')) onNavigate('wallet');
                              }
                            }}
                            className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all hover:scale-[1.01] ${
                              notif.type === 'payment_due'
                                ? 'bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40 text-amber-950 dark:text-amber-200'
                                : notif.type === 'new_group_created'
                                ? 'bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-950 dark:text-emerald-200'
                                : notif.type === 'invite_approved'
                                ? 'bg-teal-50/80 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900/40 text-teal-950 dark:text-teal-200'
                                : 'bg-slate-50 dark:bg-[#1A2622] border-slate-200 dark:border-[#24312C] text-slate-900 dark:text-slate-200'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span className="text-base shrink-0 mt-0.5">
                                {notif.type === 'payment_due'
                                  ? '⏰'
                                  : notif.type === 'new_group_created'
                                  ? '🎉'
                                  : notif.type === 'invite_approved'
                                  ? '✅'
                                  : '🔔'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="font-extrabold block truncate leading-tight">
                                  {notif.title}
                                </span>
                                <p className="text-[11px] opacity-90 line-clamp-2 mt-0.5">
                                  {notif.body}
                                </p>
                                <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
                                  <span>{new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  <span className="font-bold text-[#0F5C3A] dark:text-[#4ADE9A] flex items-center gap-0.5">
                                    <span>Check details</span>
                                    <ArrowRight className="w-3 h-3" />
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Vertical divider */}
              <span className="hidden md:block w-[1px] h-8 bg-[#E5E7EB] dark:bg-[#24312C] my-auto" aria-hidden="true" />

              {/* User Account / Sign In Pill */}
              {currentUser ? (
                <div className="relative" ref={userRef}>
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    aria-label="Account menu"
                    aria-expanded={isUserMenuOpen}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] transition-colors duration-150 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#0F5C3A] dark:bg-[#4ADE9A] text-white dark:text-[#06140D] grid place-items-center font-bold text-[13px] shrink-0 shadow-xs">
                      {initials}
                    </span>
                    <span className="hidden xl:block text-left leading-[1.2]">
                      <b className="block text-[#111827] dark:text-[#F3F4F6] text-[13px] font-semibold max-w-[120px] truncate">
                        {currentUser.name}
                      </b>
                      <span className="inline-block mt-0.5 bg-[#E7F3EC] dark:bg-[#12372A] text-[#0F5C3A] dark:text-[#4ADE9A] text-[10.5px] font-bold px-1.5 py-0.2 rounded-full">
                        {userRoleLabel}
                      </span>
                    </span>
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+8px)] min-w-[220px] bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.7)] z-50 animate-in fade-in zoom-in-95 duration-150">
                      <div className="px-3 py-2 border-b border-[#E5E7EB] dark:border-[#24312C] mb-1">
                        <p className="text-xs font-bold text-[#111827] dark:text-[#F3F4F6]">{currentUser.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{currentUser.phone || currentUser.email}</p>
                        <div className="flex items-center gap-2 mt-1 text-[11px]">
                          <span className="text-[#0F5C3A] dark:text-[#4ADE9A] font-semibold">Coins: {currentUser.coins || 0}</span>
                          <span className="text-slate-400 dark:text-slate-600">·</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Points: {currentUser.points || 0}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('wallet');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                      >
                        Profile &amp; Wallet Statement
                      </button>

                      {currentUser.role === 'merchant' && (
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('vendor-dashboard');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                        >
                          Merchant Storefront
                        </button>
                      )}

                      {currentUser.role === 'admin' && (
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('admin-dashboard');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                        >
                          Admin Console &amp; Logs
                        </button>
                      )}

                      <div className="my-1 border-t border-[#E5E7EB] dark:border-[#24312C]" />

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#DC2626] dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center justify-between"
                      >
                        <span>Log out</span>
                        <svg className="w-4 h-4 stroke-[#DC2626] dark:stroke-rose-400" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  onClick={() => onOpenAuth('member')}
                  className="px-3.5 sm:px-4 py-2 bg-[#0F5C3A] hover:bg-[#0b4830] dark:bg-[#4ADE9A] dark:hover:bg-[#34d399] text-white dark:text-[#06140D] text-[13px] sm:text-[13.5px] font-bold rounded-xl transition-all duration-150 shadow-xs cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                >
                  Sign In / Join
                </button>
              )}

              {/* Mobile Hamburger Menu Button (<768px): Touch targets at least 44px */}
              <button
                id="buyoll-hamburger-btn"
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
                className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-xl text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Row 2: Search bar centered horizontally, width 100% with max-width 640px, margin 0 auto, 12px vertical spacing */}
          <div className="w-full mt-3">
            <form
              onSubmit={handleSearchFormSubmit}
              className="w-full max-w-[640px] mx-auto relative"
              role="search"
            >
              <button
                type="submit"
                aria-label="Search"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4B5563] dark:text-[#A7B0AB] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
              >
                <svg
                  className="w-[18px] h-[18px]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </button>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search chamas, members, loans..."
                aria-label="Search chamas, members, loans"
                className="w-full h-11 border border-slate-200 dark:border-[#24312C] bg-[#F3F4F6] dark:bg-[#1A2622] text-[#111827] dark:text-[#F3F4F6] rounded-xl pl-10 pr-4 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0F5C3A] dark:focus:ring-[#4ADE9A] focus:bg-white dark:focus:bg-[#111A17] transition-all duration-150 placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF]"
              />
            </form>
          </div>
        </div>

        {/* Mobile Slide-Down Menu (<768px): same items in same order with >=44px touch targets */}
        {isMobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="md:hidden border-t border-[#E5E7EB] dark:border-[#24312C] bg-white dark:bg-[#111A17] px-4 py-3 shadow-lg animate-in slide-in-from-top-2 duration-150"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile Navigation">
              {/* Announcements */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onNavigate('home');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentView === 'home'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                }`}
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                  <path d="M15 9a4 4 0 0 1 0 6" />
                </svg>
                <span>Announcements</span>
              </button>

              {/* My Chamas */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (!currentUser) onOpenAuth('member');
                  else onNavigate('my-chamas');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentView === 'my-chamas'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                }`}
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3 20a6 6 0 0 1 12 0" />
                  <circle cx="17" cy="9" r="2.5" />
                  <path d="M17 14a5 5 0 0 1 4 5" />
                </svg>
                <span>My Chamas</span>
              </button>

              {/* Wallet */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (!currentUser) onOpenAuth('member');
                  else onNavigate('wallet');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentView === 'wallet'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                }`}
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18M16 14.5h2" />
                </svg>
                <span>Wallet</span>
              </button>



              {/* Lenders Desk */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onNavigate('lenders-dashboard');
                }}
                className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  currentView === 'lenders-dashboard'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                }`}
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
                </svg>
                <span>Lenders Desk (3% fee)</span>
              </button>

              {/* Help & FAQ */}
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenHelp?.('faq');
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
                </svg>
                <span>Help &amp; FAQ</span>
              </button>

              {/* Dark Mode Toggle */}
              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                }}
                className="min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isDark ? (
                    <svg className="w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                    </svg>
                  )}
                  <span>Theme: {isDark ? 'Dark (Active)' : 'Light (Active)'}</span>
                </div>
                <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded font-mono">
                  Toggle
                </span>
              </button>

              {/* Share App */}
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleShareApp();
                }}
                className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A] transition-colors"
              >
                <Share2 className="w-5 h-5 shrink-0" />
                <span>Share App &amp; Invite Members</span>
              </button>
            </nav>
          </div>
        )}
      </header>

      {/* Share Fallback Modal (if navigator.share and direct clipboard aren't supported) */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#24312C] mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Share2 className="w-4 h-4 text-[#0F5C3A] dark:text-[#4ADE9A]" />
                <span>Invite Friends to Buyoll</span>
              </h3>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
              Share your referral link. When new members join your Chama, both of you earn platform reward coins!
            </p>

            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={referralLink}
                className="flex-1 bg-slate-50 dark:bg-[#1A2622] border border-slate-200 dark:border-[#24312C] text-xs font-mono text-slate-800 dark:text-slate-200 rounded-xl px-3 py-2.5 select-all focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyFromModal}
                className="px-3.5 py-2.5 bg-[#0F5C3A] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 transition-colors"
              >
                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `Save together, lend smarter. Join my Chama on Buyoll: ${referralLink}`
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
