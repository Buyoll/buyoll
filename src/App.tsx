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
} from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser());
  const [currentView, setCurrentView] = useState<'home' | 'product' | 'group' | 'my-chamas' | 'wallet' | 'vendor-dashboard' | 'admin-dashboard' | 'lenders-dashboard'>('home');
  const [viewArg, setViewArg] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialRole, setAuthInitialRole] = useState<'member' | 'merchant' | 'lender' | 'admin'>('member');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [helpCategory, setHelpCategory] = useState<string>('inquiry');

  // Notification state
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    // Check session on load
    if (currentUser) {
      api.getMe()
        .then(res => setCurrentUser(res.user))
        .catch(() => {
          // If session expired or invalid, keep stored or clean up
        });
    }
  }, []);

  function handleNotify(type: 'success' | 'error' | 'info', message: string) {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }

  function handleNavigate(view: string, arg?: any) {
    setCurrentView(view as any);
    setViewArg(arg ?? null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLogout() {
    api.logout();
    setCurrentUser(null);
    handleNotify('info', 'You have been signed out.');
    handleNavigate('home');
  }

  function handleOpenHelp(tab?: string) {
    setHelpCategory(tab || 'inquiry');
    setIsHelpOpen(true);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9FBF9] text-slate-900 font-sans selection:bg-[#0E5A3C] selection:text-white">
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
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={handleLogout}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenHelp={handleOpenHelp}
      />

      {/* Main Content View Container */}
      <main className="flex-1 pb-20 md:pb-8">
        {currentView === 'home' && (
          <HomePage
            onSelectProduct={(id) => handleNavigate('product', id)}
            searchQuery={searchQuery}
            onClearSearch={() => setSearchQuery('')}
          />
        )}

        {currentView === 'product' && viewArg && (
          <ProductDetailPage
            productId={Number(viewArg)}
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => setIsAuthOpen(true)}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'group' && viewArg && (
          <GroupDetailPage
            groupId={Number(viewArg)}
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => setIsAuthOpen(true)}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'my-chamas' && (
          <MyChamasPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => setIsAuthOpen(true)}
            onNotify={handleNotify}
          />
        )}

        {currentView === 'wallet' && (
          <WalletPage
            currentUser={currentUser}
            onNavigate={handleNavigate}
            onOpenAuth={() => setIsAuthOpen(true)}
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
            onOpenAuth={() => setIsAuthOpen(true)}
            onNotify={handleNotify}
          />
        )}
      </main>

      {/* Comprehensive Buyoll Footer */}
      <Footer
        onNavigate={handleNavigate}
        onOpenHelp={handleOpenHelp}
        onOpenAuth={() => setIsAuthOpen(true)}
      />

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 flex items-center justify-around h-16 px-2 shadow-lg">
        <button
          onClick={() => handleNavigate('home')}
          className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium ${
            currentView === 'home' ? 'text-[#0E5A3C] font-bold' : 'text-slate-500'
          }`}
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>Home</span>
        </button>

        {currentUser && (
          <button
            onClick={() => handleNavigate('my-chamas')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium ${
              currentView === 'my-chamas' ? 'text-[#0E5A3C] font-bold' : 'text-slate-500'
            }`}
          >
            <Users className="w-5 h-5 mb-0.5" />
            <span>Chamas</span>
          </button>
        )}

        {currentUser && (
          <button
            onClick={() => handleNavigate('wallet')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium ${
              currentView === 'wallet' ? 'text-[#0E5A3C] font-bold' : 'text-slate-500'
            }`}
          >
            <WalletIcon className="w-5 h-5 mb-0.5" />
            <span>Wallet</span>
          </button>
        )}

        {currentUser?.role === 'merchant' && (
          <button
            onClick={() => handleNavigate('vendor-dashboard')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium ${
              currentView === 'vendor-dashboard' ? 'text-[#0E5A3C] font-bold' : 'text-slate-500'
            }`}
          >
            <Store className="w-5 h-5 mb-0.5" />
            <span>Shop</span>
          </button>
        )}

        {currentUser?.role === 'admin' && (
          <button
            onClick={() => handleNavigate('admin-dashboard')}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-[11px] font-medium ${
              currentView === 'admin-dashboard' ? 'text-[#0E5A3C] font-bold' : 'text-slate-500'
            }`}
          >
            <Shield className="w-5 h-5 mb-0.5" />
            <span>Admin</span>
          </button>
        )}
      </nav>

      {/* Auth Modal */}
      {isAuthOpen && (
        <AuthModal
          onClose={() => setIsAuthOpen(false)}
          onSuccess={(user) => {
            setCurrentUser(user);
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
