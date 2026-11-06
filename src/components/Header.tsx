import React, { useState, useRef, useEffect } from 'react';
import { User, UserRole } from '../types.ts';
import { getUserActiveRole, getUserRoles } from '../utils/rbac.ts';
import { Share2, Menu, X, Copy, Check, MessageCircle, Bell, Sparkles, Clock, AlertTriangle, ArrowRight, Store, Landmark, ShieldCheck, Megaphone, Users } from 'lucide-react';
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
    if (currentUser?.id) {
      api.getUserPreferences().then((res) => {
        if (res?.preferences?.pushNotificationsEnabled !== undefined) {
          setPushEnabledInDb(Boolean(res.preferences.pushNotificationsEnabled));
        }
      }).catch(() => {});
    }
  }, [currentUser?.id]);

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

  // Platform default theme is clean light. Dark mode is group-level only (Section 3).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);


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

            {/* Desktop & Tablet: Role-specific navigation */}
            <nav
              aria-label="Main Navigation"
              className="hidden md:flex flex-1 items-center justify-center gap-1.5 lg:gap-2.5 mx-2"
            >
              {/* GUEST: Announcements, My Chamas, Merchant, Lender, Share */}
              {!currentUser && (
                <>
                  <button
                    onClick={() => onNavigate('home')}
                    aria-current={currentView === 'home' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'home'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                      <path d="M15 9a4 4 0 0 1 0 6" />
                    </svg>
                    <span className="leading-tight text-center">Announcements</span>
                  </button>

                  <button
                    onClick={() => onOpenAuth('member')}
                    className="flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M3 20a6 6 0 0 1 12 0" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M17 14a5 5 0 0 1 4 5" />
                    </svg>
                    <span className="leading-tight text-center">My Chamas</span>
                  </button>

                  <button
                    onClick={() => onOpenAuth('merchant')}
                    className="flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Store className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" aria-hidden="true" />
                    <span className="leading-tight text-center">Merchant</span>
                  </button>

                  <button
                    onClick={() => onOpenAuth('lender')}
                    className="flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Landmark className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" aria-hidden="true" />
                    <span className="leading-tight text-center">Lender</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareApp}
                    aria-label="Share App with friends"
                    className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Share2 className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                    <span className="leading-tight text-center">Share</span>
                  </button>
                </>
              )}

              {/* MEMBER ONLY: Announcements, My Chamas, Share */}
              {currentUser && activeRole === 'member' && (
                <>
                  <button
                    onClick={() => onNavigate('home')}
                    aria-current={currentView === 'home' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'home'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                      <path d="M15 9a4 4 0 0 1 0 6" />
                    </svg>
                    <span className="leading-tight text-center">Announcements</span>
                  </button>

                  <button
                    onClick={() => onNavigate('my-chamas')}
                    aria-current={currentView === 'my-chamas' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'my-chamas'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M3 20a6 6 0 0 1 12 0" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M17 14a5 5 0 0 1 4 5" />
                    </svg>
                    <span className="leading-tight text-center">My Chamas</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareApp}
                    aria-label="Share App with friends"
                    className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Share2 className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                    <span className="leading-tight text-center">Share</span>
                  </button>
                </>
              )}

              {/* MERCHANT: Merchant dashboard, My Chamas, Announcements, Share (No Lender, No Member dashboard, No Wallet) */}
              {currentUser && activeRole === 'merchant' && (
                <>
                  <button
                    onClick={() => onNavigate('vendor-dashboard')}
                    aria-current={currentView === 'vendor-dashboard' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'vendor-dashboard'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <Store className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" aria-hidden="true" />
                    <span className="leading-tight text-center">Merchant</span>
                  </button>

                  <button
                    onClick={() => onNavigate('my-chamas')}
                    aria-current={currentView === 'my-chamas' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'my-chamas'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="8" r="3" />
                      <path d="M3 20a6 6 0 0 1 12 0" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M17 14a5 5 0 0 1 4 5" />
                    </svg>
                    <span className="leading-tight text-center">My Chamas</span>
                  </button>

                  <button
                    onClick={() => onNavigate('home')}
                    aria-current={currentView === 'home' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'home'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <svg className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                      <path d="M15 9a4 4 0 0 1 0 6" />
                    </svg>
                    <span className="leading-tight text-center">Announcements</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareApp}
                    aria-label="Share App with friends"
                    className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Share2 className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                    <span className="leading-tight text-center">Share</span>
                  </button>
                </>
              )}

              {/* LENDER: Lender dashboard, Notifications, Share (No Merchant, No Member dashboard, No My Chamas, No Wallet) */}
              {currentUser && activeRole === 'lender' && (
                <>
                  <button
                    onClick={() => onNavigate('lenders-dashboard')}
                    aria-current={currentView === 'lenders-dashboard' ? 'page' : undefined}
                    className={`flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A] ${
                      currentView === 'lenders-dashboard'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                    }`}
                  >
                    <Landmark className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0" aria-hidden="true" />
                    <span className="leading-tight text-center">Lender</span>
                  </button>

                  <button
                    onClick={() => setIsNotifMenuOpen(!isNotifMenuOpen)}
                    aria-label="Notifications"
                    className="flex flex-col items-center justify-center min-w-[70px] lg:min-w-[84px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Bell className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                    <span className="leading-tight text-center">Notifications</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareApp}
                    aria-label="Share App with friends"
                    className="flex flex-col items-center justify-center min-w-[64px] lg:min-w-[76px] px-2 py-1.5 rounded-xl text-[12px] lg:text-[13px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C3A]"
                  >
                    <Share2 className="w-4 h-4 lg:w-5 lg:h-5 mb-0.5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" aria-hidden="true" />
                    <span className="leading-tight text-center">Share</span>
                  </button>
                </>
              )}
            </nav>

            {/* Right section: User Profile / Sign In Button */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">

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
                    <div className="absolute right-0 top-[calc(100%+8px)] min-w-[240px] bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.7)] z-50 animate-in fade-in zoom-in-95 duration-150">
                      {/* User Info Header */}
                      <div className="px-3 py-2 border-b border-[#E5E7EB] dark:border-[#24312C] mb-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[#111827] dark:text-[#F3F4F6]">{currentUser.name}</p>
                          <span className="text-[10px] font-extrabold px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 rounded uppercase">
                            {activeRole}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{currentUser.phone || currentUser.email}</p>
                        
                        {/* Unique Permanent Customer Platform ID */}
                        {currentUser.platformId && (
                          <div className="mt-1.5 flex items-center justify-between bg-slate-50 dark:bg-[#1A2622] px-2 py-1 rounded text-[10.5px] font-mono text-slate-700 dark:text-slate-300">
                            <span className="font-semibold text-slate-500 dark:text-slate-400">ID:</span>
                            <span className="font-bold">{currentUser.platformId}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(currentUser.platformId || '');
                                onNotify?.('success', 'Platform ID copied to clipboard!');
                              }}
                              title="Copy Customer ID"
                              className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 ml-1"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-1 text-[11px]">
                          <span className="text-[#0F5C3A] dark:text-[#4ADE9A] font-semibold">Coins: {currentUser.coins || 0}</span>
                          <span className="text-slate-400 dark:text-slate-600">·</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Points: {currentUser.points || 0}</span>
                        </div>
                      </div>

                      {/* ROLE SWITCHER: Only visible if user holds more than one role */}
                      {userRoles.length > 1 && (
                        <div className="px-3 py-2 bg-emerald-50/50 dark:bg-[#16221E] rounded-lg my-1.5 border border-emerald-100 dark:border-emerald-950/60">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 mb-1.5">
                            Switch Active Role
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {userRoles.map((r) => (
                              <button
                                key={r}
                                onClick={async () => {
                                  if (r !== activeRole) {
                                    try {
                                      await api.switchRole(r);
                                      setIsUserMenuOpen(false);
                                      onNotify?.('success', `Switched active role to ${r}!`);
                                      window.location.reload();
                                    } catch (e: any) {
                                      onNotify?.('error', e.message || 'Failed to switch role');
                                    }
                                  }
                                }}
                                className={`px-2 py-1 text-[11px] font-bold rounded-md capitalize transition-colors ${
                                  r === activeRole
                                    ? 'bg-[#0E5A3C] text-white shadow-xs'
                                    : 'bg-white dark:bg-[#1A2622] border border-slate-200 dark:border-[#24312C] text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('profile');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] transition-colors flex items-center justify-between"
                      >
                        <span>My Profile (Customer Portal)</span>
                        <span className="text-[10px] bg-[#0F5C3A] text-white px-1.5 py-0.2 rounded-full font-bold">Private</span>
                      </button>

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('profile', 'overview');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                      >
                        My {userRoleLabel} Wallet
                      </button>

                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('profile', { tab: 'notifications' });
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                      >
                        Private Notifications
                      </button>

                      {activeRole === 'merchant' && (
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('vendor-dashboard');
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
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
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                        >
                          Lenders Desk
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

        {/* Mobile Slide-Down Menu (<768px): Role-specific navigation items */}
        {isMobileMenuOpen && (
          <div
            ref={mobileMenuRef}
            className="md:hidden border-t border-[#E5E7EB] dark:border-[#24312C] bg-white dark:bg-[#111A17] px-4 py-3 shadow-lg animate-in slide-in-from-top-2 duration-150"
          >
            <nav className="flex flex-col gap-1" aria-label="Mobile Navigation">
              {/* Not Logged In View */}
              {!currentUser && (
                <>
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
                    <Megaphone className="w-5 h-5 shrink-0" />
                    <span>Announcements</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenAuth('member');
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
                  >
                    <Users className="w-5 h-5 shrink-0" />
                    <span>My Chamas</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenAuth('merchant');
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
                  >
                    <Store className="w-5 h-5 shrink-0" />
                    <span>Merchant Entrance</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onOpenAuth('lender');
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
                  >
                    <Landmark className="w-5 h-5 shrink-0" />
                    <span>Lender Desk</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleShareApp();
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A] transition-colors"
                  >
                    <Share2 className="w-5 h-5 shrink-0" />
                    <span>Share App &amp; Invite</span>
                  </button>
                </>
              )}

              {/* MEMBER: Announcements, My Chamas, Share */}
              {currentUser && activeRole === 'member' && (
                <>
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
                    <Megaphone className="w-5 h-5 shrink-0" />
                    <span>Announcements</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onNavigate('my-chamas');
                    }}
                    className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      currentView === 'my-chamas'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                    }`}
                  >
                    <Users className="w-5 h-5 shrink-0" />
                    <span>My Chamas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleShareApp();
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A] transition-colors"
                  >
                    <Share2 className="w-5 h-5 shrink-0" />
                    <span>Share</span>
                  </button>
                </>
              )}

              {/* MERCHANT: Merchant dashboard, My Chamas, Announcements, Share */}
              {currentUser && activeRole === 'merchant' && (
                <>
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onNavigate('vendor-dashboard');
                    }}
                    className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      currentView === 'vendor-dashboard'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                    }`}
                  >
                    <Store className="w-5 h-5 shrink-0" />
                    <span>Merchant Dashboard</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      onNavigate('my-chamas');
                    }}
                    className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                      currentView === 'my-chamas'
                        ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                        : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                    }`}
                  >
                    <Users className="w-5 h-5 shrink-0" />
                    <span>My Chamas</span>
                  </button>

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
                    <Megaphone className="w-5 h-5 shrink-0" />
                    <span>Announcements</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleShareApp();
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A] transition-colors"
                  >
                    <Share2 className="w-5 h-5 shrink-0" />
                    <span>Share</span>
                  </button>
                </>
              )}

              {/* LENDER: Lender dashboard, Notifications, Share */}
              {currentUser && activeRole === 'lender' && (
                <>
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
                    <Landmark className="w-5 h-5 shrink-0" />
                    <span>Lender Dashboard</span>
                  </button>

                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsNotifMenuOpen(!isNotifMenuOpen);
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622] transition-colors"
                  >
                    <Bell className="w-5 h-5 shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" />
                    <span>Notifications</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      handleShareApp();
                    }}
                    className="min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A] transition-colors"
                  >
                    <Share2 className="w-5 h-5 shrink-0" />
                    <span>Share</span>
                  </button>
                </>
              )}

              {/* My Profile option for logged in users */}
              {currentUser && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onNavigate('profile');
                  }}
                  className={`min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold border-t border-slate-100 dark:border-[#24312C] mt-1 pt-2 transition-colors ${
                    currentView === 'profile'
                      ? 'text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#12372A]'
                      : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-slate-100 dark:hover:bg-[#1A2622]'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full bg-[#0F5C3A] text-white flex items-center justify-center text-[10px] font-bold">
                    {initials}
                  </span>
                  <span>My Profile ({currentUser.platformId || activeRole})</span>
                </button>
              )}
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
