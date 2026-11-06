import { User, UserRole } from '../types.ts';
import { ADMIN_PORTAL_PATH } from '../config/adminPortal.ts';

export const VALID_ROLES: UserRole[] = ['member', 'merchant', 'lender', 'admin'];

export function normalizeRole(role?: string | null): UserRole {
  if (!role) return 'member';
  const lower = role.toLowerCase().trim();
  if (lower === 'buyer' || lower === 'member') return 'member';
  if (lower === 'merchant' || lower === 'vendor') return 'merchant';
  if (lower === 'lender') return 'lender';
  if (lower === 'admin') return 'admin';
  return 'member';
}

export function getUserActiveRole(user: User | null): UserRole {
  if (!user) return 'member';
  if (user.activeRole) return normalizeRole(user.activeRole);
  return normalizeRole(user.role);
}

export function getUserRoles(user: User | null): UserRole[] {
  if (!user) return ['member'];
  if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
    return Array.from(new Set(user.roles.map(r => normalizeRole(r))));
  }
  return [getUserActiveRole(user)];
}

export function getRoleHomeRoute(role: UserRole): { view: string; path: string } {
  switch (role) {
    case 'merchant':
      return { view: 'vendor-dashboard', path: '/merchant' };
    case 'lender':
      return { view: 'lenders-dashboard', path: '/lender' };
    case 'admin':
      return { view: 'admin-dashboard', path: ADMIN_PORTAL_PATH };
    case 'member':
    default:
      return { view: 'home', path: '/announcements' };
  }
}

/**
 * Access Matrix:
 * - vendor-dashboard: ['merchant']
 * - lenders-dashboard: ['lender']
 * - admin-dashboard: ['admin']
 * - admin-portal: ['admin']
 * - my-chamas: ['member', 'merchant'] (Lenders and Admins forbidden)
 * - home / product: ['member', 'merchant'] (Admin restricted to admin dashboard)
 * - profile: all authenticated users
 * - wallet: reachable from profile for active role
 */
export const ROUTE_ACCESS: Record<string, UserRole[]> = {
  'home': ['member', 'merchant'],
  'product': ['member', 'merchant'],
  'group': ['member', 'merchant', 'lender'], // Scoped/authorized only
  'my-chamas': ['member', 'merchant'],
  'vendor-dashboard': ['merchant'],
  'lenders-dashboard': ['lender'],
  'admin-dashboard': ['admin'],
  'admin-portal': ['admin'],
  'admin-login': ['admin'],
  'wallet': ['member', 'merchant', 'lender', 'admin'],
  'profile': ['member', 'merchant', 'lender', 'admin'],
};

export function canAccessView(role: UserRole, view: string): boolean {
  // Admin must see ONLY admin dashboard and portal (and profile/wallet)
  if (role === 'admin') {
    return view === 'admin-dashboard' || view === 'admin-portal' || view === 'profile' || view === 'wallet';
  }

  const allowedRoles = ROUTE_ACCESS[view];
  if (!allowedRoles) return true;
  return allowedRoles.includes(role);
}

export const isRouteAllowedForRole = canAccessView;
