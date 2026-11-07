// Buyoll Promotional Pop-up Configuration
import { PROMO_MESSAGES, type PromoMessage } from './promoMessages.ts';

export interface PromoCTA {
  id: string;
  label: string;
  sub: string;
  href: string;
  primary?: boolean;
  targetRole?: 'member' | 'merchant' | 'lender';
}

export interface PromoConfig {
  anchor: number; // Nairobi UTC+3 timestamp
  intervalMs: number; // 3 days in ms
  mode: 'global' | 'perUser';
  excludePaths: string[];
  ctas: PromoCTA[];
  colors: {
    greenGradient: [string, string, string];
    orange: string;
    orangeLight: string;
    white: string;
    backdrop: string;
  };
}

// Deploy anchor: 00:00 EAT (UTC+3) on January 1, 2026
export const PROMO_ANCHOR = new Date('2026-01-01T00:00:00+03:00').getTime();
export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000; // 259,200,000 ms

export const PROMO_CONFIG: PromoConfig = {
  anchor: PROMO_ANCHOR,
  intervalMs: THREE_DAYS_MS,
  mode: 'global',
  excludePaths: [
    '/admin-portal-k7x2q9',
    '/admin',
    '/admin/dashboard',
    '/admin-portal',
    '/checkout',
    '/payment',
    '/verify',
    '/otp',
    '/error',
    '/404',
  ],
  ctas: [
    {
      id: 'buy',
      label: 'Shop Now',
      sub: 'Grab the bundle deals',
      href: '/announcements#products',
      primary: true,
    },
    {
      id: 'group',
      label: 'Join a Group Now',
      sub: 'Start enjoying shopping together',
      href: '/chamas',
      targetRole: 'member',
    },
    {
      id: 'lender',
      label: 'Be a Lender',
      sub: 'Fund shoppers and earn',
      href: '/lender',
      targetRole: 'lender',
    },
    {
      id: 'lipa',
      label: 'Lipa Mdogomdogo',
      sub: 'Pay in small, easy installments',
      href: '/announcements#lipa-mdogomdogo',
    },
    {
      id: 'merchant',
      label: 'Become a Merchant',
      sub: 'Get buyers for your product easily',
      href: '/merchant',
      targetRole: 'merchant',
    },
  ],
  colors: {
    greenGradient: ['#0b8a3e', '#2fbf62', '#7be39a'],
    orange: '#ff8a00',
    orangeLight: '#ffb347',
    white: '#ffffff',
    backdrop: 'rgba(8, 30, 16, 0.6)',
  },
};

/**
 * Calculates current message index based on 3-day window rotation (0 to 99).
 * In DEV mode (or if ?promoIndex=N is present), supports testing overrides.
 */
export function getActivePromoMessage(userCreatedAt?: string | number): {
  index: number;
  message: PromoMessage;
  isOverride: boolean;
} {
  // 1. Dev / Manual URL override check (?promoIndex=N)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('promoIndex');
    if (override !== null) {
      const parsed = parseInt(override, 10);
      if (!isNaN(parsed)) {
        // Accepts 1-based (1..100) or 0-based (0..99)
        const normalized = parsed >= 1 && parsed <= 100 ? parsed - 1 : ((parsed % 100) + 100) % 100;
        return {
          index: normalized,
          message: PROMO_MESSAGES[normalized] || PROMO_MESSAGES[0],
          isOverride: true,
        };
      }
    }
  }

  // 2. Determine anchor timestamp
  let anchor = PROMO_CONFIG.anchor;
  if (PROMO_CONFIG.mode === 'perUser' && userCreatedAt) {
    const userTime = typeof userCreatedAt === 'string' ? new Date(userCreatedAt).getTime() : userCreatedAt;
    if (!isNaN(userTime) && userTime > 0) {
      anchor = userTime;
    }
  }

  // 3. Formula: index = floor((now - ANCHOR) / (3 * 86400000)) % 100
  const now = Date.now();
  const rawDiff = now - anchor;
  const rawIndex = Math.floor(rawDiff / PROMO_CONFIG.intervalMs);
  const normalizedIndex = ((rawIndex % 100) + 100) % 100;

  return {
    index: normalizedIndex,
    message: PROMO_MESSAGES[normalizedIndex] || PROMO_MESSAGES[0],
    isOverride: false,
  };
}
