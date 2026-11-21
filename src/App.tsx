import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from './types.ts';
import { api, getStoredUser, setStoredUser, resolveImageUrl } from './api.ts';
import { Header } from './components/Header.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ProductDetailPage } from './pages/ProductDetailPage.tsx';
import { GroupDetailPage } from './pages/GroupDetailPage.tsx';
import { MyChamasPage } from './pages/MyChamasPage.tsx';
import { WalletPage } from './pages/WalletPage.tsx';
import { VendorDashboardPage } from './pages/VendorDashboardPage.tsx';
import { AdminPortalPage } from './pages/AdminPortalPage.tsx';
import { LendersDashboardPage } from './pages/LendersDashboardPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { AuthModal } from './pages/AuthModal.tsx';
import { Footer } from './components/Footer.tsx';
import { HelpSupportModal } from './pages/HelpSupportModal.tsx';
import { IdleTimeoutModal } from './components/IdleTimeoutModal.tsx';
import { ADMIN_PORTAL_PATH, isAdminPortalPath } from './config/adminPortal.ts';

import { PromoPopup } from './components/PromoPopup.tsx';
import { usePromoTrigger } from './hooks/usePromoTrigger.ts';
import type { PromoCTA } from './config/promoConfig.ts';
import {
  AdminControlCenterErrorBoundary,
  AdminControlCenterSkeleton,
  importAdminControlCenterModule,
  lazyWithChunkRetry,
} from './components/AdminErrorBoundary.tsx';

// Lazy-load Admin Dashboard with chunk-load retry guard
const AdminDashboardPage = lazyWithChunkRetry(() =>
  importAdminControlCenterModule().then((m) => ({ default: m.AdminDashboardPage }))
);
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

import { RoleGuard } from './components/RoleGuard.tsx';
import { getUserActiveRole, getRoleHomeRoute, isRouteAllowedForRole } from './utils/rbac.ts';
import {
  registerServiceWorker,
  checkAndTriggerPaymentDueAlerts,
  triggerVisualPushAlert,
} from './utils/notifications.ts';

import { useUser } from './context/UserContext.tsx';

export default function App() {
  const { currentUser, authLoading, setCurrentUser, onProfileUpdate, logoutRole } = useUser();
  const [currentView, setCurrentView] = useState<'home' | 'product' | 'group' | 'my-chamas' | 'wallet' | 'vendor-dashboard' | 'admin-dashboard' | 'admin-portal' | 'lenders-dashboard' | 'profile'>('home');
  const [viewArg, setViewArg] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialRole, setAuthInitialRole] = useState<'member' | 'merchant' | 'lender'>('member');
  const [resetTokenFromUrl, setResetTokenFromUrl] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [helpCategory, setHelpCategory] = useState<string>('inquiry');

  // Pending return target route for authenticated redirect (Section 4)
  const [pendingTargetView, setPendingTargetView] = useState<string | null>(null);
  const [pendingTargetArg, setPendingTargetArg] = useState<any>(null);

  // User and View refs to stabilize callbacks and prevent infinite re-render loops
  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;

  const currentViewRef = useRef<{ view: string; arg: any }>({ view: currentView, arg: viewArg });
  currentViewRef.current = { view: currentView, arg: viewArg };

  // Notification state
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // 3D Bundle Deals Promotional Pop-up trigger & rotation
  const {
    isOpen: isPromoOpen,
    triggerType: promoTriggerType,
    messageIndex: promoMessageIndex,
    closePopup: closePromoPopup,
    handleCtaClick: handlePromoCtaClick,
  } = usePromoTrigger(currentUser);

  const handleOpenAuth = useCallback((role?: 'member' | 'merchant' | 'lender') => {
    if (role) {
      setAuthInitialRole(role);
    } else {
      setAuthInitialRole('member');
    }
    setIsAuthOpen(true);
  }, []);

  const handleOpenHelp = useCallback((tab?: string) => {
    setHelpCategory(tab || 'faq');
    setIsHelpOpen(true);
  }, []);

  const handleNavigate = useCallback((view: string, arg?: any, options?: { forceScroll?: boolean }) => {
    const user = currentUserRef.current;
    const activeRole = getUserActiveRole(user);

    // While session bootstrap is loading, avoid prematurely opening AuthModal for protected routes
    if (!user && authLoading && (view === 'my-chamas' || view === 'wallet' || view === 'vendor-dashboard' || view === 'lenders-dashboard' || view === 'profile' || view === 'admin-dashboard')) {
      setCurrentView(view as any);
      setViewArg(arg ?? null);
      return;
    }

    // Protected private route check: redirect unauthenticated visitors to login, preserving destination
    if (!user && (view === 'my-chamas' || view === 'wallet' || view === 'vendor-dashboard' || view === 'lenders-dashboard' || view === 'profile')) {
      setPendingTargetView(view);
      setPendingTargetArg(arg ?? null);
      const targetRole = view === 'vendor-dashboard' ? 'merchant' : view === 'lenders-dashboard' ? 'lender' : 'member';
      handleOpenAuth(targetRole);
      return;
    }

    // Role-Based Access Control check for logged-in users
    if (user) {
      if (view === 'vendor-dashboard' && activeRole !== 'merchant') {
        handleNotify('error', "You don't have access to that page");
        const home = getRoleHomeRoute(activeRole);
        handleNavigate(home.view);
        return;
      }
      if (view === 'lenders-dashboard' && activeRole !== 'lender') {
        handleNotify('error', "You don't have access to that page");
        const home = getRoleHomeRoute(activeRole);
        handleNavigate(home.view);
        return;
      }
      if (view === 'admin-dashboard' && activeRole !== 'admin') {
        handleNotify('error', "You don't have access to that page");
        const home = getRoleHomeRoute(activeRole);
        handleNavigate(home.view);
        return;
      }
      if (view === 'my-chamas' && (activeRole === 'lender' || activeRole === 'admin')) {
        handleNotify('error', "You don't have access to that page");
        const home = getRoleHomeRoute(activeRole);
        handleNavigate(home.view);
        return;
      }
    }

    const prev = currentViewRef.current;
    const isSameView = prev.view === view && prev.arg === (arg ?? null);

    setCurrentView(view as any);
    setViewArg(arg ?? null);

    // Synchronize browser history path for clean, bookmarkable URLs
    if (typeof window !== 'undefined') {
      let targetPath = '/announcements';
      if (view === 'home') targetPath = '/announcements';
      else if (view === 'my-chamas') targetPath = '/groups';
      else if (view === 'wallet') targetPath = '/wallet';
      else if (view === 'profile') targetPath = '/profile';
      else if (view === 'vendor-dashboard') targetPath = '/merchant';
      else if (view === 'lenders-dashboard') targetPath = '/lender';
      else if (view === 'group' && arg) targetPath = `/group/${arg}`;
      else if (view === 'admin-portal' || view === 'admin-dashboard') targetPath = ADMIN_PORTAL_PATH;
      if (window.location.pathname !== targetPath) {
        window.history.pushState(null, '', targetPath);
      }
    }

    if (!isSameView || options?.forceScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [authLoading, handleOpenAuth]);

  // Promotional CTA Navigation handler
  const handlePromoAction = useCallback((cta: PromoCTA) => {
    handlePromoCtaClick(cta.id);
    if (cta.id === 'buy') {
      handleNavigate('home');
      setTimeout(() => {
        const el = document.getElementById('featured-deals') || document.querySelector('[data-products-grid]');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else if (cta.id === 'group') {
      if (!currentUserRef.current) {
        setPendingTargetView('my-chamas');
        handleOpenAuth('member');
      } else {
        handleNavigate('my-chamas');
      }
    } else if (cta.id === 'merchant') {
      if (!currentUserRef.current) {
        setPendingTargetView('vendor-dashboard');
        handleOpenAuth('merchant');
      } else {
        handleNavigate('vendor-dashboard');
      }
    } else if (cta.id === 'lender') {
      if (!currentUserRef.current) {
        setPendingTargetView('lenders-dashboard');
        handleOpenAuth('lender');
      } else {
        handleNavigate('lenders-dashboard');
      }
    } else if (cta.id === 'lipa') {
      handleNavigate('home');
      setTimeout(() => {
        const el = document.getElementById('newly-posted-announcements') || document.getElementById('featured-deals');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } else if (cta.href) {
      if (cta.href.startsWith('/')) {
        const route = cta.href.replace('/', '').split('#')[0];
        handleNavigate(route || 'home');
      } else {
        window.location.href = cta.href;
      }
    }
  }, [handlePromoCtaClick, handleNavigate, handleOpenAuth]);

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

    // 3. Dedicated URL & Hash routing for /announcements, /chamas, /wallet, /merchant, /lender, and private admin portal
    const syncRouteFromUrl = () => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname;
      const hash = window.location.hash.toLowerCase();
      const search = new URLSearchParams(window.location.search);
      const user = currentUserRef.current;
      const activeRole = getUserActiveRole(user);

      if (isAdminPortalPath(path)) {
        if (user && activeRole === 'admin') {
          handleNavigate('admin-dashboard');
        } else {
          handleNavigate('admin-portal');
        }
      } else if (
        path === '/admin' ||
        path.startsWith('/admin/') ||
        hash.startsWith('#admin') ||
        search.has('admin')
      ) {
        // Silently cleanse URL and show normal public marketplace (Requirements 1 & 2)
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '/announcements');
        }
        handleNavigate('home');
      } else if (path === '/announcements' || path === '/home' || path === '/') {
        handleNavigate('home');
      } else if (path === '/groups' || path === '/my-groups' || path === '/chamas' || path === '/my-chamas') {
        if (path === '/chamas' || path === '/my-chamas') {
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, '', '/groups');
          }
        }
        if (!user) {
          setPendingTargetView('my-chamas');
          handleOpenAuth('member');
          handleNavigate('home');
        } else if (activeRole === 'merchant') {
          handleNavigate('vendor-dashboard');
        } else if (activeRole === 'lender') {
          handleNavigate('lenders-dashboard');
        } else if (activeRole === 'admin') {
          handleNotify('error', "You don't have access to that page");
          handleNavigate(getRoleHomeRoute(activeRole).view);
        } else {
          handleNavigate('my-chamas');
        }
      } else if (path === '/wallet') {
        if (!user) {
          setPendingTargetView('wallet');
          handleOpenAuth('member');
          handleNavigate('home');
        } else {
          const actionParam = search.get('action');
          const fromParam = search.get('from');
          const walletArg =
            actionParam === 'deposit'
              ? {
                  action: 'deposit',
                  returnTo: fromParam === 'merchant' ? 'vendor-dashboard' : undefined,
                }
              : undefined;
          handleNavigate('wallet', walletArg);
        }
      } else if (path === '/merchant') {
        if (!user) {
          setPendingTargetView('vendor-dashboard');
          handleOpenAuth('merchant');
          handleNavigate('home');
        } else if (activeRole !== 'merchant') {
          handleNotify('error', "You don't have access to that page");
          handleNavigate(getRoleHomeRoute(activeRole).view);
        } else {
          handleNavigate('vendor-dashboard');
        }
      } else if (path === '/lender') {
        if (!user) {
          setPendingTargetView('lenders-dashboard');
          handleOpenAuth('lender');
          handleNavigate('home');
        } else if (activeRole !== 'lender') {
          handleNotify('error', "You don't have access to that page");
          handleNavigate(getRoleHomeRoute(activeRole).view);
        } else {
          handleNavigate('lenders-dashboard');
        }
      } else if (path === '/profile' || hash === '#profile') {
        if (!user) {
          setPendingTargetView('profile');
          handleOpenAuth('member');
          handleNavigate('home');
        } else {
          handleNavigate('profile', search.get('tab') || undefined);
        }
      } else if (path === '/help') {
        handleOpenHelp('faq');
      } else {
        const groupMatch = path.match(/\/(?:group|chama)\/(\d+)/);
        if (groupMatch && groupMatch[1]) {
          handleNavigate('group', Number(groupMatch[1]));
        }
      }
    };

    const handleNotifyEvent = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail?.message) {
        handleNotify(detail.type || 'info', detail.message);
      }
    };
    window.addEventListener('buyoll:notify', handleNotifyEvent);

    if (!authLoading) {
      syncRouteFromUrl();
    }
    window.addEventListener('popstate', syncRouteFromUrl);
    window.addEventListener('hashchange', syncRouteFromUrl);

    // 4. Capture referral code (?ref=...) or password reset link (?reset_token=...)
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
      const rtParam = params.get('reset_token');
      if (rtParam && rtParam.trim().length >= 16) {
        setResetTokenFromUrl(rtParam.trim());
        setIsAuthOpen(true);
        if (window.history && window.history.replaceState) {
          params.delete('reset_token');
          const cleanQs = params.toString();
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${cleanQs ? `?${cleanQs}` : ''}${window.location.hash}`
          );
        }
      }
    }

    return () => {
      window.removeEventListener('buyoll:notify', handleNotifyEvent);
      window.removeEventListener('popstate', syncRouteFromUrl);
      window.removeEventListener('hashchange', syncRouteFromUrl);
    };
  }, [authLoading, handleNavigate, handleOpenAuth, handleOpenHelp]);

  // Session verification: depend strictly on primitive user ID (not object reference)
  const currentUserId = currentUser?.id;
  useEffect(() => {
    if (!currentUserId) return;
    const activeRole = getUserActiveRole(currentUserRef.current) || undefined;
    api.getMe(activeRole)
      .then(res => {
        if (!res?.user) return;
        setCurrentUser(prev => {
          if (!prev) return res.user;
          if (
            prev.id === res.user.id &&
            prev.credit === res.user.credit &&
            prev.coins === res.user.coins &&
            prev.points === res.user.points &&
            prev.role === res.user.role &&
            prev.activeRole === res.user.activeRole &&
            prev.platformId === res.user.platformId &&
            prev.referralCode === res.user.referralCode &&
            prev.avatar === res.user.avatar &&
            prev.avatarUrl === res.user.avatarUrl &&
            prev.name === res.user.name &&
            prev.phone === res.user.phone
          ) {
            return prev;
          }
          try {
            localStorage.setItem('alibaird_current_user', JSON.stringify(res.user));
          } catch {}
          return res.user;
        });

        api.getGroups().then(grpRes => {
          if (grpRes?.groups) {
            checkAndTriggerPaymentDueAlerts(res.user, grpRes.groups);
          }
        }).catch(() => {});
      })
      .catch(() => {});
  }, [currentUserId]);

  const handleNotify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  async function handleLogout() {
    const activeRole = getUserActiveRole(currentUserRef.current);
    const wasAdmin = activeRole === 'admin' || (typeof window !== 'undefined' && isAdminPortalPath(window.location.pathname));
    await logoutRole(activeRole);
    setPendingTargetView(null);
    setPendingTargetArg(null);
    handleNotify('info', 'You have been signed out.');
    handleNavigate(wasAdmin ? 'admin-portal' : 'home');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9FBF9] dark:bg-[#0B1210] text-slate-900 dark:text-[#F3F4F6] font-sans selection:bg-[#ff6600] selection:text-white transition-colors duration-200">
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
            onOpenAuth={() => {
              setPendingTargetView('group');
              setPendingTargetArg(Number(viewArg));
              handleOpenAuth('member');
            }}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'my-chamas' && (
          <RoleGuard allow={['member']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            <MyChamasPage
              currentUser={currentUser}
              onNavigate={handleNavigate}
              onOpenAuth={() => handleOpenAuth('member')}
              onNotify={handleNotify}
            />
          </RoleGuard>
        )}

        {currentView === 'wallet' && (
          <RoleGuard allow={['member', 'merchant', 'lender', 'admin']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            <WalletPage
              currentUser={currentUser}
              initialAction={viewArg}
              onNavigate={handleNavigate}
              onOpenAuth={() => handleOpenAuth('member')}
              onNotify={handleNotify}
              onUserUpdate={() => {
                onProfileUpdate();
              }}
            />
          </RoleGuard>
        )}

        {currentView === 'vendor-dashboard' && (
          <RoleGuard allow={['merchant']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            <VendorDashboardPage
              currentUser={currentUser}
              onNavigate={handleNavigate}
              onNotify={handleNotify}
            />
          </RoleGuard>
        )}

        {currentView === 'admin-portal' && (
          <AdminPortalPage
            currentUser={currentUser}
            onSuccess={(user) => {
              currentUserRef.current = user;
              onProfileUpdate(user);
              handleNavigate('admin-dashboard');
            }}
            onNavigate={handleNavigate}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'admin-dashboard' && (
          <RoleGuard allow={['admin']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            <AdminControlCenterErrorBoundary onNavigateHome={() => handleNavigate('home')}>
              <React.Suspense fallback={<AdminControlCenterSkeleton />}>
                <AdminDashboardPage
                  currentUser={currentUser}
                  onNavigate={handleNavigate}
                  onNotify={handleNotify}
                  initialTab={typeof viewArg === 'string' ? (viewArg as any) : undefined}
                />
              </React.Suspense>
            </AdminControlCenterErrorBoundary>
          </RoleGuard>
        )}

        {currentView === 'lenders-dashboard' && (
          <RoleGuard allow={['lender']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            <LendersDashboardPage
              currentUser={currentUser}
              onNavigate={handleNavigate}
              onOpenAuth={() => handleOpenAuth('lender')}
              onNotify={handleNotify}
            />
          </RoleGuard>
        )}

        {currentView === 'profile' && (
          <RoleGuard allow={['member', 'merchant', 'lender', 'admin']} currentUser={currentUser} authLoading={authLoading} onNavigate={handleNavigate} onNotify={handleNotify} onLogout={handleLogout}>
            {currentUser && (
              <ProfilePage
                currentUser={currentUser}
                onNavigate={handleNavigate}
                onOpenAuth={() => handleOpenAuth('member')}
                onNotify={handleNotify}
                onProfileUpdate={onProfileUpdate}
                onUserUpdate={(updated?: User) => {
                  onProfileUpdate(updated);
                }}
                initialTab={viewArg || 'overview'}
              />
            )}
          </RoleGuard>
        )}
      </main>

      {/* Comprehensive Buyoll Footer */}
      <Footer
        onNavigate={handleNavigate}
        onOpenHelp={handleOpenHelp}
        onOpenAuth={handleOpenAuth}
      />

      {/* Mobile Bottom Navigation Bar: strictly role-specific, hidden on admin dashboard & portal */}
      {currentView !== 'admin-dashboard' && currentView !== 'admin-portal' && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#111A17] border-t border-slate-200 dark:border-[#24312C] z-40 flex items-center justify-around h-16 px-2 shadow-lg transition-colors">
        {!currentUser && (
          <>
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'home' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Home className="w-5 h-5 mb-0.5" />
              <span>Home</span>
            </button>
            <button
              onClick={() => handleOpenAuth('member')}
              className="flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium text-[#ff6600] dark:text-[#ff8000]"
            >
              <Users className="w-5 h-5 mb-0.5" />
              <span>Sign In / Join</span>
            </button>
          </>
        )}

        {currentUser && getUserActiveRole(currentUser) === 'member' && (
          <>
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'home' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Home className="w-5 h-5 mb-0.5" />
              <span>Announcements</span>
            </button>
            <button
              onClick={() => handleNavigate('my-chamas')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'my-chamas' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Users className="w-5 h-5 mb-0.5" />
              <span>My Groups</span>
            </button>
            <button
              onClick={() => handleNavigate('profile')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'profile' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="w-5 h-5 mb-0.5 rounded-full bg-[#ff6600] text-white flex items-center justify-center text-[9px] font-bold">
                {currentUser.name ? currentUser.name.slice(0, 1).toUpperCase() : 'M'}
              </span>
              <span>Profile</span>
            </button>
          </>
        )}

        {currentUser && getUserActiveRole(currentUser) === 'merchant' && (
          <>
            <button
              onClick={() => handleNavigate('vendor-dashboard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'vendor-dashboard' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Store className="w-5 h-5 mb-0.5" />
              <span>Merchant</span>
            </button>
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'home' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Home className="w-5 h-5 mb-0.5" />
              <span>Announce</span>
            </button>
            <button
              onClick={() => handleNavigate('profile')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'profile' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="w-5 h-5 mb-0.5 rounded-full bg-[#ff6600] text-white flex items-center justify-center text-[9px] font-bold">
                {currentUser.name ? currentUser.name.slice(0, 1).toUpperCase() : 'M'}
              </span>
              <span>Profile</span>
            </button>
          </>
        )}

        {currentUser && getUserActiveRole(currentUser) === 'lender' && (
          <>
            <button
              onClick={() => handleNavigate('lenders-dashboard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'lenders-dashboard' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Landmark className="w-5 h-5 mb-0.5" />
              <span>Lender</span>
            </button>
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'home' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Home className="w-5 h-5 mb-0.5" />
              <span>Home</span>
            </button>
            <button
              onClick={() => handleNavigate('profile')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'profile' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="w-5 h-5 mb-0.5 rounded-full bg-[#ff6600] text-white flex items-center justify-center text-[9px] font-bold">
                {currentUser.name ? currentUser.name.slice(0, 1).toUpperCase() : 'L'}
              </span>
              <span>Profile</span>
            </button>
          </>
        )}

        {currentUser && getUserActiveRole(currentUser) === 'admin' && (
          <>
            <button
              onClick={() => handleNavigate('home')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'home' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Home className="w-5 h-5 mb-0.5" />
              <span>Announcements</span>
            </button>
            <button
              onClick={() => handleNavigate('profile')}
              className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium transition-colors ${
                currentView === 'profile' ? 'text-[#ff6600] dark:text-[#ff8000] font-bold' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="w-5 h-5 mb-0.5 rounded-full bg-[#ff6600] text-white flex items-center justify-center text-[9px] font-bold">
                {currentUser.name ? currentUser.name.slice(0, 1).toUpperCase() : 'A'}
              </span>
              <span>Profile</span>
            </button>
          </>
        )}
      </nav>
      )}

      {/* Auth Modal */}
      {isAuthOpen && (
        <AuthModal
          initialRole={authInitialRole}
          initialResetToken={resetTokenFromUrl}
          onClose={() => {
            setIsAuthOpen(false);
            setResetTokenFromUrl(null);
          }}
          onSuccess={(user, targetRoute) => {
            currentUserRef.current = user;
            onProfileUpdate(user);
            setIsAuthOpen(false);
            setResetTokenFromUrl(null);
            if (pendingTargetView) {
              const nextView = pendingTargetView;
              const nextArg = pendingTargetArg;
              setPendingTargetView(null);
              setPendingTargetArg(null);
              handleNavigate(nextView, nextArg);
            } else if (targetRoute) {
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

      {/* 3D Bundle Deals Promotional Pop-up */}
      <PromoPopup
        isOpen={isPromoOpen}
        messageIndex={promoMessageIndex}
        triggerType={promoTriggerType}
        currentUser={currentUser}
        onClose={closePromoPopup}
        onCtaClick={handlePromoAction}
      />

      {/* 20-Minute Inactivity Warning Modal */}
      <IdleTimeoutModal
        onLoggedOut={(role) => {
          setPendingTargetView(null);
          setPendingTargetArg(null);
          handleNavigate(role === 'admin' ? 'admin-portal' : 'home');
        }}
      />
    </div>
  );
}
