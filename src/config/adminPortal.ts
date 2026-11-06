/**
 * Buyoll Private Administrator Portal Configuration
 *
 * The admin dashboard is hidden behind this single private route.
 * To change the private path (e.g. when connecting a custom domain),
 * simply update ADMIN_PORTAL_PATH here.
 */
export const ADMIN_PORTAL_PATH = '/admin-portal-k7x2q9';
export const ADMIN_PORTAL_ROUTE = 'admin-portal-k7x2q9';

export function isAdminPortalPath(pathname: string): boolean {
  if (!pathname) return false;
  const clean = pathname.toLowerCase().replace(/\/+$/, '');
  const target = ADMIN_PORTAL_PATH.toLowerCase().replace(/\/+$/, '');
  return clean === target;
}
