import React, { useState, useEffect } from 'react';
import { User } from '../types.ts';
import { AuthModal } from './AuthModal.tsx';
import { Shield, Lock, ArrowRight, ArrowLeft } from 'lucide-react';

interface AdminPortalPageProps {
  currentUser: User | null;
  onSuccess: (user: User) => void;
  onNavigate: (view: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const AdminPortalPage: React.FC<AdminPortalPageProps> = ({
  currentUser,
  onSuccess,
  onNavigate,
  onNotify,
}) => {
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Set <meta name="robots" content="noindex, nofollow"> dynamically
  useEffect(() => {
    let metaTag = document.querySelector('meta[name="robots"]') as HTMLMetaElement;
    let created = false;
    if (!metaTag) {
      metaTag = document.createElement('meta');
      metaTag.name = 'robots';
      document.head.appendChild(metaTag);
      created = true;
    }
    const previousContent = metaTag.content;
    metaTag.content = 'noindex, nofollow';

    return () => {
      if (created) {
        metaTag.remove();
      } else {
        metaTag.content = previousContent || '';
      }
    };
  }, []);

  // If already logged in as admin, skip straight to dashboard
  useEffect(() => {
    if (currentUser && (currentUser.role === 'admin' || currentUser.activeRole === 'admin')) {
      onSuccess(currentUser);
    }
  }, [currentUser, onSuccess]);

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-gradient-to-b from-slate-50 via-slate-100/60 to-slate-50 dark:from-[#0a1410] dark:via-[#0e1c17] dark:to-[#0a1410]">
      <div className="w-full max-w-md bg-white dark:bg-[#111A17] border border-slate-200/90 dark:border-[#24312C] rounded-3xl p-8 sm:p-10 shadow-2xl relative overflow-hidden text-center transition-all">
        {/* Top Accent Strip */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#ff6600] via-emerald-500 to-[#ff6600]" />

        {/* Brand Emblem */}
        <div className="relative mx-auto mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-[#fff4ec] to-emerald-100 dark:from-[#2a1608] dark:to-[#184635] text-[#ff6600] dark:text-[#ff8000] rounded-3xl flex items-center justify-center mx-auto shadow-md border border-emerald-200/50 dark:border-emerald-800/40">
            <Shield className="w-10 h-10" />
          </div>
          <div className="absolute -bottom-1 right-1/2 translate-x-7 bg-[#ff6600] text-white p-1 rounded-full shadow-sm">
            <Lock className="w-3 h-3" />
          </div>
        </div>

        {/* Header Titles */}
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          Buyoll Admin Portal
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
          Authorized control center for marketplace governance, escrow reconciliation, and system management.
        </p>

        {/* Non-admin notice if user is logged in as another role */}
        {currentUser && currentUser.role !== 'admin' && (
          <div className="mt-5 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl text-left text-xs text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Signed in as {currentUser.name} ({currentUser.role})</p>
            <p className="mt-0.5 text-amber-700/90 dark:text-amber-300/80">
              Your current account does not have administrator privileges. Please sign in with administrator credentials.
            </p>
          </div>
        )}

        {/* Single Primary "Sign In" Button */}
        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="w-full py-3.5 px-6 bg-[#ff6600] hover:bg-[#ff8000] active:scale-[0.99] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer flex items-center justify-center gap-2 group"
          >
            <Lock className="w-4 h-4 text-emerald-200 group-hover:text-white transition-colors" />
            <span>Sign in to Administrator Portal</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Clean Return link */}
        <div className="mt-8 pt-6 border-t border-slate-100 dark:border-[#24312C]/80">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Buyoll Marketplace</span>
          </button>
        </div>
      </div>

      {/* REUSED EXISTING AUTH MODAL CARD IN PORTAL MODE */}
      {showAuthModal && (
        <AuthModal
          portalMode={true}
          initialRole="admin"
          onClose={() => setShowAuthModal(false)}
          onSuccess={(user) => {
            setShowAuthModal(false);
            if (user.role === 'admin' || user.activeRole === 'admin') {
              onSuccess(user);
            } else {
              onNotify('error', 'Authentication rejected: Administrator privileges required.');
            }
          }}
          onNotify={onNotify}
        />
      )}
    </div>
  );
};
