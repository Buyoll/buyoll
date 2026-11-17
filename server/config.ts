import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'buyoll@customerservive.com';

const rawFeeRate = Number(process.env.LOAN_PLATFORM_FEE_RATE ?? '0.01');
export const LOAN_PLATFORM_FEE_RATE =
  Number.isFinite(rawFeeRate) && rawFeeRate >= 0 && rawFeeRate <= 0.25 ? rawFeeRate : 0.01;

// Never fall back to a hardcoded literal secret; generate a cryptographic ephemeral secret if unset in dev/test
const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');
export const TOKEN_SECRET =
  process.env.AUTH_SECRET || process.env.JWT_SECRET || EPHEMERAL_FALLBACK_SECRET;

export const PASSWORD_PEPPER = process.env.PASSWORD_PEPPER || TOKEN_SECRET;
export const ENFORCE_GLOBAL_UNIQUE_PASSWORD =
  String(process.env.ENFORCE_GLOBAL_UNIQUE_PASSWORD || 'false').toLowerCase() === 'true';

export const FORGOT_USERNAME_MODE: 'reset' | 'send_existing' =
  String(process.env.FORGOT_USERNAME_MODE || 'reset').toLowerCase() === 'send_existing'
    ? 'send_existing'
    : 'reset';

const rawIdleMs = Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? String(20 * 60 * 1000));
export const SESSION_IDLE_TIMEOUT_MS =
  Number.isFinite(rawIdleMs) && rawIdleMs >= 1000 ? rawIdleMs : 20 * 60 * 1000; // Default 20 minutes

export const SESSION_ABSOLUTE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days max session lifetime (bounded by idle timeout)
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_SHORT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

export const SUBSCRIPTION_RENEWAL_MODE: 'reset' | 'stack' =
  String(process.env.SUBSCRIPTION_RENEWAL_MODE || 'reset').toLowerCase() === 'stack'
    ? 'stack'
    : 'reset';

const rawSweepMs = Number(process.env.SUBSCRIPTION_EXPIRY_SWEEP_MS ?? String(5 * 60 * 1000));
export const SUBSCRIPTION_EXPIRY_SWEEP_MS =
  Number.isFinite(rawSweepMs) && rawSweepMs >= 10000 ? rawSweepMs : 5 * 60 * 1000;

export const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_MAX_ATTEMPTS = 5;
export const ADMIN_MAX_FAILED_ATTEMPTS = 3;
export const ADMIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
export const RECENT_REAUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/+$/, '');
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const PUBLIC_DIR = path.resolve(__dirname, '../public');
export const UPLOADS_DIR = path.resolve(PUBLIC_DIR, 'uploads');
export const ANNOUNCEMENT_UPLOADS_DIR = path.resolve(UPLOADS_DIR, 'announcements');
export const AVATAR_UPLOADS_DIR = path.resolve(UPLOADS_DIR, 'avatars');

export const MAX_ANNOUNCEMENT_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

export interface ValidatedImage {
  ext: 'jpg' | 'png' | 'webp';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function validateImageBuffer(buffer: Buffer, declaredMime?: string): ValidatedImage | null {
  if (!buffer || buffer.length < 12) return null;
  if (declaredMime && !ALLOWED_IMAGE_MIME.has(declaredMime.toLowerCase())) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

export function toCents(kesAmount: number): number {
  return Math.round(Number(kesAmount || 0) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function computeFeeCents(principalKes: number, feeRate = LOAN_PLATFORM_FEE_RATE): {
  principalCents: number;
  feeCents: number;
  netCents: number;
  feeKes: number;
  netKes: number;
} {
  const principalCents = toCents(principalKes);
  const feeBps = Math.round(feeRate * 10000);
  const feeCents = Math.round((principalCents * feeBps) / 10000);
  const netCents = Math.max(0, principalCents - feeCents);
  return {
    principalCents,
    feeCents,
    netCents,
    feeKes: fromCents(feeCents),
    netKes: fromCents(netCents),
  };
}

// ======================================================================
// Africa/Nairobi (EAT, UTC+03:00) Calendar Helpers
// ======================================================================
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const eatDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Nairobi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getEatDateParts(utcMs: number): {
  year: number;
  month: number;
  day: number;
  dateKey: string;
  startOfEatDayUtcMs: number;
} {
  const dateKey = eatDateFmt.format(new Date(utcMs));
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10));
  // Africa/Nairobi is permanently UTC+3 without DST; 00:00 EAT is 21:00 UTC previous calendar day
  const startOfEatDayUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - EAT_OFFSET_MS;
  return { year: y, month: m, day: d, dateKey, startOfEatDayUtcMs };
}

export function differenceInEatDays(targetUtcMs: number, fromUtcMs = Date.now()): number {
  const a = getEatDateParts(targetUtcMs).startOfEatDayUtcMs;
  const b = getEatDateParts(fromUtcMs).startOfEatDayUtcMs;
  return Math.round((a - b) / DAY_MS);
}

export function getNextEatMidnightUtc(fromUtcMs = Date.now()): number {
  const { startOfEatDayUtcMs } = getEatDateParts(fromUtcMs);
  return startOfEatDayUtcMs + DAY_MS;
}

export function computeSubscriptionStatusEat(
  expiresAtUtcMs: number | null | undefined,
  isActive: boolean,
  nowUtcMs = Date.now()
): {
  status: 'ACTIVE' | 'EXPIRED' | 'NONE';
  days_remaining: number;
  alarm_level: 'GREEN' | 'RED' | 'EXPIRED';
  expires_at_utc: number | null;
  expires_at_eat_date: string | null;
  next_eat_midnight_utc: number;
} {
  const nextEatMidnight = getNextEatMidnightUtc(nowUtcMs);
  if (!expiresAtUtcMs) {
    return {
      status: 'NONE',
      days_remaining: 0,
      alarm_level: 'EXPIRED',
      expires_at_utc: null,
      expires_at_eat_date: null,
      next_eat_midnight_utc: nextEatMidnight,
    };
  }
  const eatDays = differenceInEatDays(expiresAtUtcMs, nowUtcMs);
  const expiresEatDate = getEatDateParts(expiresAtUtcMs).dateKey;
  if (!isActive || expiresAtUtcMs <= nowUtcMs || eatDays < 0) {
    return {
      status: 'EXPIRED',
      days_remaining: 0,
      alarm_level: 'EXPIRED',
      expires_at_utc: expiresAtUtcMs,
      expires_at_eat_date: expiresEatDate,
      next_eat_midnight_utc: nextEatMidnight,
    };
  }
  const alarm_level: 'GREEN' | 'RED' = eatDays <= 3 ? 'RED' : 'GREEN';
  return {
    status: 'ACTIVE',
    days_remaining: eatDays,
    alarm_level,
    expires_at_utc: expiresAtUtcMs,
    expires_at_eat_date: expiresEatDate,
    next_eat_midnight_utc: nextEatMidnight,
  };
}
