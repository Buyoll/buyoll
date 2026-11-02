import React, { useEffect, useRef } from 'react';
import { User, UserRole } from '../types.ts';
import { getUserActiveRole, getRoleHomeRoute } from '../utils/rbac.ts';
import { ShieldAlert } from 'lucide-react';

interface RoleGuardProps {
  allow: UserRole[];
  currentUser: User | null;
  onNavigate: (view: string, arg?: any) => void;
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void;
  children: React.ReactNode;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({
  allow,
  currentUser,
  onNavigate,
  onNotify,
  children,
}) => {
  const activeRole = getUserActiveRole(currentUser);
  const isAllowed = allow.includes(activeRole);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!isAllowed && !hasRedirected.current) {
      hasRedirected.current = true;
      const target = getRoleHomeRoute(activeRole);
      if (onNotify) {
        onNotify('error', "You don't have access to that page");
      }
      onNavigate(target.view);
    }
  }, [isAllowed, activeRole, onNavigate, onNotify]);

  if (!isAllowed) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-white dark:bg-[#111A17] border border-amber-200 dark:border-amber-900/40 rounded-2xl shadow-sm text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center mx-auto mb-4 text-amber-600">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
          Access Restricted
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
          You don't have access to that page. Redirecting you to your {activeRole} dashboard…
        </p>
        <button
          onClick={() => onNavigate(getRoleHomeRoute(activeRole).view)}
          className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
        >
          Go to My Dashboard
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
