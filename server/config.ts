import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'buyoll@customerservive.com';

const rawFeeRate = Number(process.env.LOAN_PLATFORM_FEE_RATE ?? '0.01');
export const LOAN_PLATFORM_FEE_RATE =
  Number.isFinite(rawFeeRate) && rawFeeRate >= 0 && rawFeeRate <= 0.25 ? rawFeeRate : 0.01;

export const TOKEN_SECRET =
  process.env.AUTH_SECRET || process.env.JWT_SECRET || process.env.ADMIN_SETUP_KEY || 'buyoll_dev_session_secret_2026';

export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_SHORT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours (when rememberMe is false)

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

/**
 * Validates an uploaded image buffer via both declared MIME type and magic bytes.
 */
export function validateImageBuffer(buffer: Buffer, declaredMime?: string): ValidatedImage | null {
  if (!buffer || buffer.length < 12) return null;
  if (declaredMime && !ALLOWED_IMAGE_MIME.has(declaredMime.toLowerCase())) {
    return null;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
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
  // WebP: RIFF .... WEBP
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

/**
 * Converts integer KES amount (or cents) cleanly without floating-point drift.
 */
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
  const feeBps = Math.round(feeRate * 10000); // e.g., 0.01 -> 100 bps
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
