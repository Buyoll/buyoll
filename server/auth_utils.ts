import crypto from 'crypto';
import { Request, Response } from 'express';
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_SHORT_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  TOKEN_SECRET,
} from './config.js';
import { getDatabase, DatabaseSchema } from './db.js';
import { User, RefreshTokenRecord } from '../src/types.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return true;
  if (!storedHash.includes(':')) {
    return password === storedHash;
  }
  const [salt, key] = storedHash.split(':');
  try {
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface SignedAccessPayload {
  sub: number;
  role: string;
  tv: number;
  iat: number;
  exp: number;
}

export function createAccessToken(user: User): string {
  const now = Date.now();
  const payload: SignedAccessPayload = {
    sub: user.id,
    role: user.activeRole || user.role || 'member',
    tv: user.tokenVersion || 1,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyAccessToken(token: string): SignedAccessPayload | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedAccessPayload;
    if (!decoded || typeof decoded.sub !== 'number' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function issueAuthTokensForUser(
  db: DatabaseSchema,
  user: User,
  rememberMe = true
): { accessToken: string; refreshToken: string; refreshExpiresAt: number } {
  if (!user.tokenVersion) user.tokenVersion = 1;
  const accessToken = createAccessToken(user);
  const rawRefresh = crypto.randomBytes(32).toString('hex');
  const ttl = rememberMe ? REFRESH_TOKEN_TTL_MS : REFRESH_TOKEN_SHORT_TTL_MS;
  const now = Date.now();
  const record: RefreshTokenRecord = {
    id: `rt_${now}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id,
    tokenHash: hashOpaqueToken(rawRefresh),
    rememberMe,
    expiresAt: now + ttl,
    revokedAt: null,
    createdAt: now,
  };
  if (!db.refreshTokens) db.refreshTokens = [];
  db.refreshTokens.unshift(record);
  if (db.refreshTokens.length > 500) {
    db.refreshTokens = db.refreshTokens.slice(0, 500);
  }
  return { accessToken, refreshToken: rawRefresh, refreshExpiresAt: record.expiresAt };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: number
): void {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAgeRefresh = Math.max(60000, refreshExpiresAt - Date.now());
  res.cookie('buyoll_access', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: ACCESS_TOKEN_TTL_MS,
    path: '/',
  });
  res.cookie('buyoll_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: maxAgeRefresh,
    path: '/',
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('buyoll_access', { path: '/' });
  res.clearCookie('buyoll_refresh', { path: '/' });
  res.clearCookie('buyoll_session', { path: '/' });
}

export function extractBearerOrCookieToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  if (req.cookies?.buyoll_access) {
    return String(req.cookies.buyoll_access);
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('buyoll_access='));
    if (match) return decodeURIComponent(match.split('=').slice(1).join('='));
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return null;
}

export async function resolveAuthenticatedUser(req: Request, existingDb?: DatabaseSchema): Promise<User | null> {
  const db = existingDb || (await getDatabase());

  // 1. Signed access token (header or httpOnly cookie)
  const bearerToken = extractBearerOrCookieToken(req);
  if (bearerToken) {
    const payload = verifyAccessToken(bearerToken);
    if (payload) {
      const user = db.users.find((u) => u.id === payload.sub);
      if (user && !user.isSuspended && (user.tokenVersion || 1) === payload.tv) {
        return user;
      }
    }
    // Numeric Bearer fallback ONLY when numeric token matches user ID
    if (/^\d+$/.test(bearerToken)) {
      const user = db.users.find((u) => u.id === Number(bearerToken));
      if (user && !user.isSuspended) return user;
    }
  }

  // 2. Legacy cookie session token
  const sessionCookie =
    req.cookies?.buyoll_session ||
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('buyoll_session='))
      ?.split('=')
      .slice(1)
      .join('=');
  if (sessionCookie) {
    const user = db.users.find((u) => u.sessionToken === decodeURIComponent(sessionCookie));
    if (user && !user.isSuspended) return user;
  }

  // 3. Header x-user-id / query authUserId (compatibility for existing client API calls)
  const rawId = req.headers['x-user-id'] || req.query.authUserId;
  if (rawId) {
    const numId = Number(rawId);
    if (Number.isFinite(numId) && numId > 0) {
      const user = db.users.find((u) => u.id === numId);
      if (user && !user.isSuspended) return user;
    }
  }

  return null;
}

export function sanitizeUser(user: User): Omit<User, 'password'> {
  const { password: _pw, ...safe } = user as any;
  const restricted = Number(safe.restrictedLoanBalance ?? safe.nonWithdrawableBalance ?? 0);
  return {
    ...safe,
    avatar: safe.avatar || safe.avatarUrl,
    avatarUrl: safe.avatarUrl || safe.avatar,
    restrictedLoanBalance: restricted,
    nonWithdrawableBalance: restricted,
  };
}

export function normalizeUsernameSeed(raw: string, fallbackId: number): string {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/^[_.]+|[_.]+$/g, '');
  if (cleaned.length >= 3 && cleaned.length <= 30) return cleaned;
  return `user_${fallbackId}`;
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_.]{3,30}$/.test(username);
}
