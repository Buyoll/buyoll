import React, { useEffect, useRef } from 'react';
import { User, UserRole } from '../types.ts';
import { getUserActiveRole, getRoleHomeRoute } from '../utils/rbac.ts';
import { ShieldAlert } from 'lucide-react';

interface RoleGuardProps {
  allow: UserRole[];
  currentUser: User | null;
  authLoading?: boolean;
  onNavigate: (view: string, arg?: any) => void;
  onNotify?: (type: 'success' | 'error' | 'info', message: string) => void;
  onLogout?: () => void;
  children: React.ReactNode;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({
  allow,
  currentUser,
  authLoading = false,
  onNavigate,
  onNotify,
  onLogout,
  children,
}) => {
  const activeRole = getUserActiveRole(currentUser);
  const isAllowed = !!currentUser && allow.includes(activeRole);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAllowed && !hasRedirected.current) {
      hasRedirected.current = true;
      const target = getRoleHomeRoute(activeRole);
      if (onNotify) {
        onNotify(
          'info',
          currentUser
            ? `Role Isolation: You are signed in as a ${activeRole}. To access this area, please log out and sign in with the required account.`
            : 'Please sign in to access this area.'
        );
      }
      onNavigate(target.view);
    }
  }, [authLoading, isAllowed, activeRole, currentUser, onNavigate, onNotify]);

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto my-20 p-8 text-center">
        <div className="w-8 h-8 border-4 border-[#ff6600] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Verifying session...</p>
      </div>
    );
  }

  if (!isAllowed) {
    const requiredRoleName = allow.map(r => r.toUpperCase()).join(' or ');
    return (
      <div className="max-w-md mx-auto my-16 p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl shadow-sm text-center">
        <div className="w-12 h-12 rounded-full bg-[#fff4ec] dark:bg-[#2a1608] flex items-center justify-center mx-auto mb-4 text-[#ff6600]">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-[var(--text)] mb-2">
          Strict Role Isolation Enforced
        </h3>
        <p className="text-xs text-[var(--muted)] mb-2 leading-relaxed">
          This area is strictly restricted to <span className="font-bold text-[var(--text)]">{requiredRoleName}</span> accounts.
        </p>
        <p className="text-xs text-[var(--muted)] mb-6 leading-relaxed">
          You are currently signed in as a <b className="capitalize text-[#ff6600]">{activeRole}</b>. To access this dashboard or feature, you must log out of your current account and register or sign in with the appropriate role.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
          <button
            onClick={() => onNavigate(getRoleHomeRoute(activeRole).view)}
            className="w-full sm:w-auto px-4 py-2.5 bg-[var(--field)] hover:bg-[var(--line)] text-[var(--text)] text-xs font-bold rounded-xl transition-colors"
          >
            Go to My {activeRole} Dashboard
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full sm:w-auto px-4 py-2.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
            >
              Log Out & Switch Role
            </button>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
