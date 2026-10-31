import React, { useState, useEffect } from 'react';
import { User } from './types.ts';
import { api, getStoredUser, setStoredUser, resolveImageUrl } from './api.ts';
import { Header } from './components/Header.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ProductDetailPage } from './pages/ProductDetailPage.tsx';
import { GroupDetailPage } from './pages/GroupDetailPage.tsx';
import { MyChamasPage } from './pages/MyChamasPage.tsx';
import { WalletPage } from './pages/WalletPage.tsx';
import { VendorDashboardPage } from './pages/VendorDashboardPage.tsx';
import { AdminDashboardPage } from './pages/AdminDashboardPage.tsx';
import { AdminLoginPage } from './pages/AdminLoginPage.tsx';
import { LendersDashboardPage } from './pages/LendersDashboardPage.tsx';
import { AuthModal } from './pages/AuthModal.tsx';
import { Footer } from './components/Footer.tsx';
import { HelpSupportModal } from './pages/HelpSupportModal.tsx';
import {
  Home,
  Users,
  Wallet as WalletIcon,
  Store,
  Shield,
  CheckCircle2,
  AlertCircle,
  X,
  HandCoins,
  Landmark,
} from 'lucide-react';

import {
  registerServiceWorker,
  checkAndTriggerPaymentDueAlerts,
  triggerVisualPushAlert,
} from './utils/notifications.ts';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser());
  const [currentView, setCurrentView] = useState<'home' | 'product' | 'group' | 'my-chamas' | 'wallet' | 'vendor-dashboard' | 'admin-dashboard' | 'admin-login' | 'lenders-dashboard'>('home');
  const [viewArg, setViewArg] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialRole, setAuthInitialRole] = useState<'member' | 'merchant' | 'lender' | 'admin'>('member');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [helpCategory, setHelpCategory] = useState<string>('inquiry');

  // Pending return target route for authenticated redirect (Section 4)
  const [pendingTargetView, setPendingTargetView] = useState<string | null>(null);
  const [pendingTargetArg, setPendingTargetArg] = useState<any>(null);

  // Notification state
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    // 1. Register Service Worker for Push Notifications
    registerServiceWorker();

    // 2. Listen for push notification click messages from service worker
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const swListener = (event: MessageEvent) => {
        if (event.data?.type === 'NOTIFICATION_CLICKED' && event.data?.groupId) {
          handleNavigate('group', Number(event.data.groupId));
        }
      };
      navigator.serviceWorker.addEventListener('message', swListener);
    }

    // 3. Dedicated URL & Hash routing for /announcements, /chamas, /wallet, /merchant, /lender, /admin/login
    const syncRouteFromUrl = () => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname;
      const hash = window.location.hash.toLowerCase();
      const search = new URLSearchParams(window.location.search);

      if (path === '/admin/login' || hash === '#admin' || hash === '#admin-login' || search.get('admin') === 'login') {
        handleNavigate('admin-login');
      } else if (path === '/admin/dashboard' || path === '/admin' || hash === '#admin-dashboard' || search.get('admin') === 'dashboard') {
        if (!currentUser || currentUser.role !== 'admin') {
          handleNavigate('admin-login');
        } else {
          handleNavigate('admin-dashboard');
        }
      } else if (path === '/announcements' || path === '/home' || path === '/') {
        handleNavigate('home');
      } else if (path === '/chamas' || path === '/my-chamas') {
        if (!currentUser) {
          setPendingTargetView('my-chamas');
          handleOpenAuth('member');
          handleNavigate('home');
        } else {
          handleNavigate('my-chamas');
        }
      } else if (path === '/wallet') {
        if (!currentUser) {
          setPendingTargetView('wallet');
          handleOpenAuth('member');
          handleNavigate('home');
        } else {
          handleNavigate('wallet');
        }
      } else if (path === '/merchant') {
        if (!currentUser) {
          setPendingTargetView('vendor-dashboard');
          handleOpenAuth('merchant');
          handleNavigate('home');
        } else {
          handleNavigate('vendor-dashboard');
        }
      } else if (path === '/lender') {
        if (!currentUser) {
          setPendingTargetView('lenders-dashboard');
          handleOpenAuth('lender');
          handleNavigate('home');
        } else {
          handleNavigate('lenders-dashboard');
        }
      } else if (path === '/help') {
        handleOpenHelp('faq');
      } else {
        const chamaMatch = path.match(/\/chama\/(\d+)/);
        if (chamaMatch && chamaMatch[1]) {
          handleNavigate('group', Number(chamaMatch[1]));
        }
      }
    };

    syncRouteFromUrl();
    window.addEventListener('popstate', syncRouteFromUrl);
    window.addEventListener('hashchange', syncRouteFromUrl);

    // 4. Check session on load & trigger payment due checks
    if (currentUser) {
      api.getMe()
        .then(res => {
          setCurrentUser(res.user);
          // Check payment due reminders
          api.getGroups().then(grpRes => {
            checkAndTriggerPaymentDueAlerts(res.user, grpRes.groups);
          }).catch(() => {});
        })
        .catch(() => {});
    }

    // 5. Capture referral code if opened via /join?ref=... or ?ref=...
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const refParam = params.get('ref');
      if (refParam) {
        try {
          localStorage.setItem('buyoll_referrer', refParam);
        } catch {
          // Ignore
        }
      }
    }

    return () => {
      window.removeEventListener('popstate', syncRouteFromUrl);
      window.removeEventListener('hashchange', syncRouteFromUrl);
    };
  }, [currentUser]);

  function handleNotify(type: 'success' | 'error' | 'info', message: string) {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }

  function handleNavigate(view: string, arg?: any) {
    // Protected private route check: redirect unauthenticated visitors to login, preserving destination
    if (!currentUser && (view === 'my-chamas' || view === 'wallet' || view === 'vendor-dashboard' || view === 'lenders-dashboard')) {
      setPendingTargetView(view);
      setPendingTargetArg(arg ?? null);
      const targetRole = view === 'vendor-dashboard' ? 'merchant' : view === 'lenders-dashboard' ? 'lender' : 'member';
      handleOpenAuth(targetRole);
      return;
    }

    setCurrentView(view as any);
    setViewArg(arg ?? null);

    // Synchronize browser history path for clean, bookmarkable URLs
    if (typeof window !== 'undefined') {
      let targetPath = '/announcements';
      if (view === 'home') targetPath = '/announcements';
      else if (view === 'my-chamas') targetPath = '/chamas';
      else if (view === 'wallet') targetPath = '/wallet';
      else if (view === 'vendor-dashboard') targetPath = '/merchant';
      else if (view === 'lenders-dashboard') targetPath = '/lender';
      else if (view === 'group' && arg) targetPath = `/chama/${arg}`;
      else if (view === 'admin-login') targetPath = '/admin/login';
      else if (view === 'admin-dashboard') targetPath = '/admin/dashboard';
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLogout() {
    api.logout();
    setCurrentUser(null);
    setPendingTargetView(null);
    setPendingTargetArg(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('alibaird_client_db');
    }
    handleNotify('info', 'You have been signed out.');
    handleNavigate('home');
  }

  function handleOpenHelp(tab?: string) {
    setHelpCategory(tab || 'faq');
    setIsHelpOpen(true);
  }

  function handleOpenAuth(role?: 'member' | 'merchant' | 'lender' | 'admin') {
    if (role) {
      setAuthInitialRole(role);
    } else {
      setAuthInitialRole('member');
    }
    setIsAuthOpen(true);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9FBF9] dark:bg-[#0B1210] text-slate-900 dark:text-[#F3F4F6] font-sans selection:bg-[#0E5A3C] selection:text-white transition-colors duration-200">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-20 right-4 z-50 max-w-sm w-full animate-in fade-in slide-in-from-top-4 duration-200">
          <div
            className={`flex items-start gap-3 p-4 rounded-xl shadow-lg border text-xs font-medium ${
              notification.type === 'success'
                ? 'bg-emerald-900 text-emerald-50 border-emerald-700'
                : notification.type === 'error'
                ? 'bg-red-900 text-red-50 border-red-700'
                : 'bg-slate-900 text-slate-50 border-slate-700'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 leading-snug">{notification.message}</div>
            <button
              onClick={() => setNotification(null)}
              className="text-white/60 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Top Header */}
      <Header
        currentUser={currentUser}
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenAuth={handleOpenAuth}
        onLogout={handleLogout}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={(q) => setSearchQuery(q)}
        onOpenHelp={handleOpenHelp}
        onNotify={handleNotify}
      />

      {/* Main Content View Container */}
      <main className="flex-1 pb-20 md:pb-8">
        {currentView === 'home' && (
          <HomePage
            currentUser={currentUser}
            onSelectProduct={(id) => handleNavigate('product', id)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearSearch={() => setSearchQuery('')}
            onOpenAuth={() => handleOpenAuth('member')}
            onNavigate={handleNavigate}
          />
        )}

        {currentView === 'product' && viewArg && (
          <ProductDetailPage
            productId={Number(viewArg)}
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => handleOpenAuth('member')}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'group' && viewArg && (
          <GroupDetailPage
            groupId={Number(viewArg)}
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => handleOpenAuth('member')}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'my-chamas' && (
          <MyChamasPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => handleOpenAuth('member')}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'wallet' && (
          <WalletPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => handleOpenAuth('member')}
            onNotify={handleNotify}
            onUserUpdate={() => {
              if (currentUser) {
                api.getMe().then(r => setCurrentUser(r.user)).catch(() => {});
              }
            }}
          />
        )}

        {currentView === 'vendor-dashboard' && (
          <VendorDashboardPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'admin-login' && (
          <AdminLoginPage
            onSuccess={(user) => {
              setCurrentUser(user);
              handleNavigate('admin-dashboard');
            }}
            onNavigate={handleNavigate}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'admin-dashboard' && (
          <AdminDashboardPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'lenders-dashboard' && (
          <LendersDashboardPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => handleOpenAuth('lender')}
            onNotify={handleNotify}
          />
        )}
      </main>

      {/* Comprehensive Buyoll Footer */}
      <Footer
        onNavigate={handleNavigate}
        onOpenHelp={handleOpenHelp}
        onOpenAuth={handleOpenAuth}
      />

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#111A17] border-t border-slate-200 dark:border-[#24312C] z-40 flex items-center justify-around h-16 px-2 shadow-lg transition-colors">
        <button
          onClick={() => handleNavigate('home')}
          className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
            currentView === 'home' ? 'text-[#0E5A3C] dark:text-[#4ADE9A] font-bold' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>Home</span>
        </button>

        {currentUser && (
          <button
            onClick={() => handleNavigate('my-chamas')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
              currentView === 'my-chamas' ? 'text-[#0E5A3C] dark:text-[#4ADE9A] font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span>Chamas</span>
          </button>
        )}

        {currentUser && (
          <button
            onClick={() => handleNavigate('wallet')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
              currentView === 'wallet' ? 'text-[#0E5A3C] dark:text-[#4ADE9A] font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <WalletIcon className="w-5 h-5 mb-0.5" />
            <span>Wallet</span>
          </button>
        )}

        {currentUser?.role === 'merchant' && (
          <button
            onClick={() => handleNavigate('vendor-dashboard')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
              currentView === 'vendor-dashboard' ? 'text-[#0E5A3C] dark:text-[#4ADE9A] font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Store className="w-5 h-5 mb-0.5" />
            <span>Shop</span>
          </button>
        )}
      </nav>

      {/* Auth Modal */}
      {isAuthOpen && (
        <AuthModal
          initialRole={authInitialRole}
          onClose={() => setIsAuthOpen(false)}
          onSuccess={(user, targetRoute) => {
            setCurrentUser(user);
            setIsAuthOpen(false);
            if (targetRoute) {
              handleNavigate(targetRoute);
            }
          }}
          onNotify={handleNotify}
        />
      )}

      {/* Community Help & Support Modal */}
      {isHelpOpen && (
        <HelpSupportModal
          currentUser={currentUser}
          initialCategory={helpCategory}
          onClose={() => setIsHelpOpen(false)}
          onNotify={handleNotify}
          onOpenAuth={() => setIsAuthOpen(true)}
        />
      )}
    </div>
  );
}
