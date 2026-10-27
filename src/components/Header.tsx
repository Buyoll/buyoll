import React, { useState, useRef, useEffect } from 'react';
import { User } from '../types.ts';
import { resolveImageUrl } from '../api.ts';

interface HeaderProps {
  currentUser: User | null;
  currentView: string;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: (role?: 'member' | 'merchant' | 'lender' | 'admin') => void;
  onLogout: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenHelp?: (tab?: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  currentView,
  onNavigate,
  onOpenAuth,
  onLogout,
  searchQuery,
  onSearchChange,
  onOpenHelp,
}) => {
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(event.target as Node)) {
        setIsAdminMenuOpen(false);
      }
      if (userRef.current && !userRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
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

  return (
    <>
      {/* Top Banner Strip */}
      <div className="bg-[#0F5C3A] dark:bg-[#12372A] text-white dark:text-[#4ADE9A] text-[13px] text-center h-9 leading-9 font-medium px-4 tracking-normal select-none border-b border-transparent dark:border-[#24312C] transition-colors">
        Welcome back to Buyoll — save together, lend smarter.
      </div>

      <header className="bg-white dark:bg-[#111A17] border-b border-[#E5E7EB] dark:border-[#24312C] sticky top-0 z-40 shadow-xs transition-colors">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-[76px] flex items-center justify-between gap-4">
          {/* Logo */}
          <button
            onClick={() => {
              onSearchChange('');
              onNavigate('home');
            }}
            className="flex shrink-0 items-center hover:opacity-95 transition-opacity cursor-pointer"
            aria-label="Buyoll home"
          >
            <img
              src={resolveImageUrl('buyoll_logo.png')}
              alt="Buyoll"
              className="h-14 sm:h-[76px] w-auto object-contain block py-1"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (!target.src.endsWith('Buyoll_Shopping_Cart_Logo_23c2cc30.png')) {
                  target.src = './assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png';
                }
              }}
            />
          </button>

          {/* Navigation */}
          <nav aria-label="Main" className="ml-auto flex gap-1 sm:gap-1.5 items-center">
            {/* Announcements */}
            <button
              onClick={() => onNavigate('home')}
              className={`flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer border-b-2 border-transparent ${
                currentView === 'home'
                  ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                  : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
              }`}
            >
              <span className="hidden sm:inline leading-none">Announcements</span>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
                <path d="M15 9a4 4 0 0 1 0 6" />
              </svg>
            </button>

            {/* My Chamas */}
            <button
              onClick={() => {
                if (!currentUser) onOpenAuth('member');
                else onNavigate('my-chamas');
              }}
              className={`flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer border-b-2 border-transparent ${
                currentView === 'my-chamas'
                  ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                  : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
              }`}
            >
              <span className="hidden sm:inline leading-none">My Chamas</span>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3" />
                <path d="M3 20a6 6 0 0 1 12 0" />
                <circle cx="17" cy="9" r="2.5" />
                <path d="M17 14a5 5 0 0 1 4 5" />
              </svg>
            </button>

            {/* Wallet */}
            <button
              onClick={() => {
                if (!currentUser) onOpenAuth('member');
                else onNavigate('wallet');
              }}
              className={`flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer border-b-2 border-transparent ${
                currentView === 'wallet'
                  ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                  : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
              }`}
            >
              <span className="hidden sm:inline leading-none">Wallet</span>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2" />
                <path d="M3 10h18M16 14.5h2" />
              </svg>
            </button>

            {/* Admin Menu Dropdown */}
            <div className="relative" ref={adminRef}>
              <button
                type="button"
                onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
                className={`flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer border-b-2 border-transparent ${
                  currentView === 'admin-dashboard' || currentView === 'lenders-dashboard'
                    ? 'text-[#0F5C3A] dark:text-[#4ADE9A] font-bold bg-[#E7F3EC] dark:bg-[#12372A] shadow-[inset_0_-2px_0_#0F5C3A] dark:shadow-[inset_0_-2px_0_#4ADE9A]'
                    : 'text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A]'
                }`}
              >
                <span className="hidden sm:inline leading-none">Admin</span>
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z" />
                </svg>
              </button>

              {isAdminMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] min-w-[210px] bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.6)] z-50 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    onClick={() => {
                      setIsAdminMenuOpen(false);
                      if (!currentUser || currentUser.role !== 'admin') {
                        onOpenAuth('admin');
                      } else {
                        onNavigate('admin-dashboard');
                      }
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors flex items-center justify-between"
                  >
                    <span>Admin Console</span>
                    {currentUser?.role === 'admin' ? (
                      <span className="text-[10px] bg-[#E7F3EC] dark:bg-[#12372A] text-[#0F5C3A] dark:text-[#4ADE9A] font-bold px-1.5 py-0.5 rounded">
                        Full Access
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        Login
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsAdminMenuOpen(false);
                      onNavigate('lenders-dashboard');
                    }}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors flex items-center justify-between"
                  >
                    <span>Lenders Desk</span>
                    <span className="text-[10px] bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded">
                      3% Rate
                    </span>
                  </button>
                  {currentUser?.role === 'merchant' && (
                    <button
                      onClick={() => {
                        setIsAdminMenuOpen(false);
                        onNavigate('vendor-dashboard');
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors"
                    >
                      <span>Merchant Dashboard</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Help & FAQ */}
            <button
              onClick={() => onOpenHelp?.('faq')}
              className="flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors cursor-pointer"
            >
              <span className="hidden sm:inline leading-none">Help &amp; FAQ</span>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
              </svg>
            </button>

            {/* Dark Mode Toggle Button (High-Contrast) */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to high-contrast dark theme'}
              title={isDark ? 'Light Theme' : 'High-Contrast Dark Theme'}
              className="flex flex-col items-center gap-1 px-2.5 sm:px-3 py-2 rounded-xl text-[13.5px] font-medium text-[#4B5563] dark:text-[#A7B0AB] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors cursor-pointer"
            >
              <span className="hidden sm:inline leading-none text-xs">{isDark ? 'Light' : 'Dark'}</span>
              {isDark ? (
                <svg className="w-5 h-5 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            {/* Divider separator */}
            <span className="hidden sm:block w-[1px] h-9 bg-[#E5E7EB] dark:bg-[#24312C] mx-1" />

            {/* User Account / Sign In Pill */}
            {currentUser ? (
              <div className="relative" ref={userRef}>
                <button
                  type="button"
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  aria-label="Account menu"
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] transition-colors cursor-pointer text-left"
                >
                  <span className="w-9 h-9 rounded-full bg-[#0F5C3A] dark:bg-[#4ADE9A] text-white dark:text-[#06140D] grid place-items-center font-bold text-[13px] shrink-0 shadow-xs">
                    {initials}
                  </span>
                  <span className="hidden lg:block text-left leading-[1.25]">
                    <b className="block text-[#111827] dark:text-[#F3F4F6] text-[13.5px] font-semibold max-w-[130px] truncate">
                      {currentUser.name}
                    </b>
                    <span className="inline-block mt-0.5 bg-[#E7F3EC] dark:bg-[#12372A] text-[#0F5C3A] dark:text-[#4ADE9A] text-[11px] font-bold px-2 py-0.2 rounded-full">
                      {userRoleLabel}
                    </span>
                  </span>
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] min-w-[210px] bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.6)] z-50 animate-in fade-in zoom-in-95 duration-150">
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
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors"
                    >
                      Profile &amp; Wallet Statement
                    </button>

                    {currentUser.role === 'merchant' && (
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('vendor-dashboard');
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors"
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
                        className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#111827] dark:text-[#F3F4F6] hover:bg-[#E7F3EC] dark:hover:bg-[#12372A] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] font-medium transition-colors"
                      >
                        Admin Settings &amp; Logs
                      </button>
                    )}

                    <div className="my-1 border-t border-[#E5E7EB] dark:border-[#24312C]" />

                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#DC2626] dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-medium transition-colors flex items-center justify-between"
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
                className="px-3.5 sm:px-4 py-2 bg-[#0F5C3A] hover:bg-[#0b4830] dark:bg-[#4ADE9A] dark:hover:bg-[#34d399] text-white dark:text-[#06140D] text-[13.5px] font-bold rounded-xl transition-all shadow-xs cursor-pointer"
              >
                Sign In / Join
              </button>
            )}
          </nav>
        </div>

        {/* Subbar with Search input */}
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pb-3 flex justify-end">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onNavigate('home');
            }}
            className="relative w-full max-w-sm sm:max-w-[420px]"
          >
            <svg
              className="absolute left-3 top-3 w-[18px] h-[18px] text-[#4B5563] dark:text-[#A7B0AB]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search chamas, members, loans…"
              aria-label="Search"
              className="w-full h-10 border border-transparent dark:border-[#24312C] bg-[#F3F4F6] dark:bg-[#1A2622] text-[#111827] dark:text-[#F3F4F6] rounded-xl pl-9.5 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F5C3A] dark:focus:ring-[#4ADE9A] focus:bg-white dark:focus:bg-[#111A17] transition-all placeholder:text-[#4B5563] dark:placeholder:text-[#A7B0AB]"
            />
          </form>
        </div>
      </header>
    </>
  );
};
