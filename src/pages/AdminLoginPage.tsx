import React, { useState } from 'react';
import { User } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import { Shield, Lock, Mail, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AdminLoginPageProps {
  onSuccess: (user: User) => void;
  onNavigate: (view: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({
  onSuccess,
  onNavigate,
  onNotify,
}) => {
  const [identifier, setIdentifier] = useState('cityandcountyre@gmail.com');
  const [password, setPassword] = useState('admin123');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identifier.trim()) {
      setError('Please provide your administrative email or credentials.');
      return;
    }
    if (!password) {
      setError('Please enter your administrator security password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.login({
        identifier: identifier.trim(),
        password,
        role: 'admin',
      });

      if (!res.user || res.user.role !== 'admin') {
        setError('Access Denied (403): This account does not hold verified administrative permissions.');
        onNotify('error', 'Access Denied: Administrative permissions required.');
        return;
      }

      onNotify('success', `Welcome to Buyoll Admin Console, ${res.user.name}!`);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Administrator authentication failed.');
      onNotify('error', err.message || 'Authentication error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white dark:bg-[#111A17] border border-[#E5E7EB] dark:border-[#24312C] rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Top Accent Strip */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#0F5C3A] via-emerald-500 to-[#0F5C3A]" />

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[#E7F3EC] dark:bg-[#12372A] text-[#0F5C3A] dark:text-[#4ADE9A] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-[#111827] dark:text-[#F3F4F6] tracking-tight">
            Administrator Gateway
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Restricted Access · Authorized Buyoll System Administrators
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-snug">{error}</p>
          </div>
        )}

        <form onSubmit={handleAdminLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Admin Email / Phone
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="cityandcountyre@gmail.com"
                required
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-[#1A2622] border border-slate-200 dark:border-[#24312C] rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F5C3A]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Administrator Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-[#1A2622] border border-slate-200 dark:border-[#24312C] rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0F5C3A]"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#0F5C3A] hover:bg-[#0b4830] text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{submitting ? 'Authenticating Admin...' : 'Sign In to Admin Console'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100 dark:border-[#24312C] text-center">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Public Marketplace</span>
          </button>
        </div>
      </div>
    </div>
  );
};
