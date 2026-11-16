import crypto from 'crypto';
import argon2 from 'argon2';
import { Request, Response } from 'express';
import {
  ACCESS_TOKEN_TTL_MS,
  ADMIN_LOCKOUT_MS,
  ADMIN_MAX_FAILED_ATTEMPTS,
  ENFORCE_GLOBAL_UNIQUE_PASSWORD,
  PASSWORD_PEPPER,
  REFRESH_TOKEN_SHORT_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  TOKEN_SECRET,
} from './config.js';
import { getDatabase, DatabaseSchema } from './db.js';
import {
  EmailOutboxRecord,
  RefreshTokenRecord,
  SessionRecord,
  User,
  UserRole,
} from '../src/types.js';
import { normalizeRoleValue } from './wallet_service.js';

export const ROLE_COOKIE_NAMES: Record<UserRole, string> = {
  admin: 'buyoll_admin',
  merchant: 'buyoll_merchant',
  member: 'buyoll_member',
  lender: 'buyoll_lender',
};

export const ALL_ROLE_COOKIES = Object.values(ROLE_COOKIE_NAMES);

const BREACHED_COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyui',
  'qwerty12',
  '11111111',
  '00000000',
  'abc12345',
  'letmein1',
  'welcome1',
  'admin123',
  'admin1234',
  'iloveyou1',
  'monkey12',
  'dragon12',
  'sunshine1',
  'princess1',
  'football1',
  'passw0rd',
  'buyoll123',
  'buyoll2026',
  'kenya123',
  'nairobi1',
]);

// ======================================================================
// Password & Passkey Hashing (argon2id + legacy scrypt fallback)
// ======================================================================
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  if (!storedHash || typeof storedHash !== 'string' || password === undefined || password === null || password === '') {
    return false;
  }
  if (storedHash.startsWith('$argon2')) {
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }
  if (storedHash.includes(':')) {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    try {
      const keyBuffer = Buffer.from(key, 'hex');
      const derivedKey = crypto.scryptSync(password, salt, 64);
      if (keyBuffer.length !== derivedKey.length) return false;
      return crypto.timingSafeEqual(keyBuffer, derivedKey);
    } catch {
      return false;
    }
  }
  // Legacy plaintext (exact char compare using timingSafeEqual via sha256 digest)
  const a = crypto.createHash('sha256').update(password).digest();
  const b = crypto.createHash('sha256').update(storedHash).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function hashPasskey(passkey: string): Promise<string> {
  return hashPassword(passkey);
}

export async function verifyPasskey(passkey: string, storedHash?: string): Promise<boolean> {
  return verifyPassword(passkey, storedHash);
}

export function computePasswordHmac(password: string): string {
  return crypto.createHmac('sha256', PASSWORD_PEPPER).update(password).digest('hex');
}

export function isPasswordReusedGlobally(
  db: DatabaseSchema,
  password: string,
  excludeUserId?: number
): boolean {
  if (!ENFORCE_GLOBAL_UNIQUE_PASSWORD) return false;
  const hmac = computePasswordHmac(password);
  return (db.users || []).some(
    (u) => u.id !== excludeUserId && !u.isDisabled && u.passwordHmac === hmac
  );
}

// ======================================================================
// Username Normalization & Validation
// ======================================================================
export function normalizeUsername(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[._-]/g, '');
}

export function canonicalizeUsernameInput(raw: string): string {
  return String(raw || '').normalize('NFKC').trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  const cleaned = canonicalizeUsernameInput(raw);
  if (cleaned.length < 3 || cleaned.length > 30) return false;
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(cleaned)) return false;
  const norm = normalizeUsername(cleaned);
  return norm.length >= 3;
}

export function normalizeUsernameSeed(raw: string, fallbackId: number): string {
  const cleaned = String(raw || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/^[_.]+|[_.]+$/g, '');
  if (cleaned.length >= 3 && cleaned.length <= 30 && normalizeUsername(cleaned).length >= 3) {
    return cleaned;
  }
  return `user_${fallbackId}`;
}

// ======================================================================
// Password Strength & Policy Checker (NEVER trims password)
// ======================================================================
export interface PasswordEvaluation {
  valid: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  error: string | null;
  checks: {
    minLength: boolean;
    hasLetter: boolean;
    hasNumber: boolean;
    notCommon: boolean;
    notSimilarToIdentity: boolean;
  };
}

export function evaluatePasswordStrength(
  password: string,
  context?: { username?: string; name?: string; email?: string; phone?: string }
): PasswordEvaluation {
  const pw = String(password ?? '');
  const minLength = pw.length >= 8 && pw.length <= 128;
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const pwLower = pw.toLowerCase();
  const pwNorm = normalizeUsername(pw);
  const notCommon = !BREACHED_COMMON_PASSWORDS.has(pwLower) && !BREACHED_COMMON_PASSWORDS.has(pwNorm);

  let notSimilarToIdentity = true;
  if (context) {
    const tokens: string[] = [];
    if (context.username) {
      tokens.push(canonicalizeUsernameInput(context.username));
      tokens.push(normalizeUsername(context.username));
    }
    if (context.email) {
      const local = context.email.split('@')[0] || '';
      if (local.length >= 3) tokens.push(local.toLowerCase(), normalizeUsername(local));
    }
    if (context.name) {
      for (const part of context.name.toLowerCase().split(/\s+/)) {
        if (part.length >= 3) tokens.push(part);
      }
    }
    if (context.phone) {
      const digits = context.phone.replace(/\D/g, '');
      if (digits.length >= 5) tokens.push(digits, digits.slice(-6));
    }
    for (const tok of tokens) {
      if (tok && tok.length >= 3 && (pwLower.includes(tok) || pwNorm.includes(tok))) {
        notSimilarToIdentity = false;
        break;
      }
    }
  }

  let error: string | null = null;
  if (!minLength) {
    error = 'Password must be between 8 and 128 characters long.';
  } else if (!hasLetter || !hasNumber) {
    error = 'Password must contain at least one letter and one number (symbols are also allowed).';
  } else if (!notCommon) {
    error = 'This password is too common. Please choose a less predictable password.';
  } else if (!notSimilarToIdentity) {
    error = 'Password cannot contain or closely match your username, name, email, or phone number.';
  }

  let scoreCount = 0;
  if (pw.length >= 8) scoreCount++;
  if (pw.length >= 12) scoreCount++;
  if (hasLetter && hasNumber) scoreCount++;
  if (/[^a-zA-Z0-9]/.test(pw)) scoreCount++;
  const score = Math.min(4, error ? Math.min(1, scoreCount) : Math.max(2, scoreCount)) as 0 | 1 | 2 | 3 | 4;
  const label = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';

  return {
    valid: error === null,
    score,
    label,
    error,
    checks: {
      minLength,
      hasLetter,
      hasNumber,
      notCommon,
      notSimilarToIdentity,
    },
  };
}

// ======================================================================
// Opaque Tokens & Signed Session Cookies + JWT Access Tokens
// ======================================================================
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signSessionCookieValue(sessionId: string): string {
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(sessionId).digest('base64url');
  return `${sessionId}.${sig}`;
}

export function verifySessionCookieValue(cookieVal: string): string | null {
  if (!cookieVal || !cookieVal.includes('.')) return null;
  const idx = cookieVal.lastIndexOf('.');
  const sessionId = cookieVal.slice(0, idx);
  const sig = cookieVal.slice(idx + 1);
  if (!sessionId || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(sessionId).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return sessionId;
  } catch {
    return null;
  }
}

export interface SignedAccessPayload {
  sub: number;
  sid: string;
  role: UserRole;
  tv: number;
  iat: number;
  exp: number;
}

export function createAccessToken(user: User, sessionId: string, role?: UserRole): string {
  const now = Date.now();
  const activeRole = normalizeRoleValue(role || user.activeRole || user.role);
  const payload: SignedAccessPayload = {
    sub: user.id,
    sid: sessionId,
    role: activeRole,
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
    if (!decoded || typeof decoded.sub !== 'number' || typeof decoded.exp !== 'number' || !decoded.sid) {
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

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function createDbSession(
  db: DatabaseSchema,
  user: User,
  roleInput: UserRole,
  req?: Request,
  options?: { revokeSameRoleOtherSessions?: boolean }
): SessionRecord {
  if (!db.sessions) db.sessions = [];
  const now = Date.now();
  const role = normalizeRoleValue(roleInput);

  if (options?.revokeSameRoleOtherSessions) {
    for (const s of db.sessions) {
      if (s.userId === user.id && s.role === role && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'REPLACED_BY_CREDENTIAL_ROTATION';
      }
    }
  }

  const session: SessionRecord = {
    id: `sess_${now}_${crypto.randomBytes(12).toString('hex')}`,
    userId: user.id,
    role,
    createdAt: now,
    lastActivityAt: now,
    expiresAt: now + SESSION_ABSOLUTE_TTL_MS,
    revokedAt: null,
    revokeReason: null,
    userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 240) : undefined,
    ip: req ? getClientIp(req) : undefined,
    lastReauthAt: now,
  };
  db.sessions.unshift(session);
  if (db.sessions.length > 1000) {
    db.sessions = db.sessions.slice(0, 1000);
  }
  return session;
}

export function invalidateUserOtherSessions(
  db: DatabaseSchema,
  userId: number,
  keepSessionId?: string,
  reason = 'CREDENTIAL_ROTATION'
): number {
  const now = Date.now();
  let count = 0;
  for (const s of db.sessions || []) {
    if (s.userId === userId && !s.revokedAt && (!keepSessionId || s.id !== keepSessionId)) {
      s.revokedAt = now;
      s.revokeReason = reason;
      count++;
    }
  }
  const user = (db.users || []).find((u) => u.id === userId);
  if (user) {
    user.tokenVersion = (user.tokenVersion || 1) + 1;
  }
  return count;
}

export function issueAuthTokensForUser(
  db: DatabaseSchema,
  user: User,
  rememberMe = true,
  req?: Request,
  roleOverride?: UserRole
): { accessToken: string; refreshToken: string; refreshExpiresAt: number; session: SessionRecord } {
  if (!user.tokenVersion) user.tokenVersion = 1;
  const role = normalizeRoleValue(roleOverride || user.activeRole || user.role);
  const session = createDbSession(db, user, role, req);
  const accessToken = createAccessToken(user, session.id, role);
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
  return { accessToken, refreshToken: rawRefresh, refreshExpiresAt: record.expiresAt, session };
}

export function setRoleSessionCookie(res: Response, role: UserRole, sessionId: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieName = ROLE_COOKIE_NAMES[role];
  const signed = signSessionCookieValue(sessionId);
  res.cookie(cookieName, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: SESSION_ABSOLUTE_TTL_MS,
    path: '/',
  });
}

export function clearRoleSessionCookie(res: Response, role: UserRole): void {
  res.clearCookie(ROLE_COOKIE_NAMES[role], { path: '/' });
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: number,
  role?: UserRole,
  sessionId?: string
): void {
  const isProd = process.env.NODE_ENV === 'production';
  const maxAgeRefresh = Math.max(60000, refreshExpiresAt - Date.now());
  if (role && sessionId) {
    setRoleSessionCookie(res, role, sessionId);
  }
  res.cookie('buyoll_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: maxAgeRefresh,
    path: '/',
  });
  // Keep buyoll_access only when non-role specific cookie needed, no client readable secrets
  res.cookie('buyoll_access', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: ACCESS_TOKEN_TTL_MS,
    path: '/',
  });
}

export function clearAuthCookies(res: Response, roleOnly?: UserRole): void {
  if (roleOnly) {
    clearRoleSessionCookie(res, roleOnly);
    return;
  }
  for (const cookieName of ALL_ROLE_COOKIES) {
    res.clearCookie(cookieName, { path: '/' });
  }
  res.clearCookie('buyoll_access', { path: '/' });
  res.clearCookie('buyoll_refresh', { path: '/' });
  res.clearCookie('buyoll_session', { path: '/' });
}

function parseCookiesHeader(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  if (req.cookies && typeof req.cookies === 'object') {
    for (const [k, v] of Object.entries(req.cookies)) {
      if (typeof v === 'string') result[k] = v;
    }
  }
  if (req.headers.cookie) {
    for (const part of req.headers.cookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (!(k in result)) {
          try {
            result[k] = decodeURIComponent(v);
          } catch {
            result[k] = v;
          }
        }
      }
    }
  }
  return result;
}

export function extractBearerOrCookieToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim();
    if (t) return t;
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  const cookies = parseCookiesHeader(req);
  if (cookies.buyoll_access) return cookies.buyoll_access;
  return null;
}

export interface AuthSessionResolution {
  user: User | null;
  session: SessionRecord | null;
  role: UserRole | null;
  errorCode: 'UNAUTHORIZED' | 'SESSION_IDLE_EXPIRED' | 'SESSION_REVOKED' | null;
  errorMessage?: string;
}

function pickCookieRolesForRequest(req: Request, requestedRole?: UserRole): UserRole[] {
  if (requestedRole) return [requestedRole];
  const headerRole = req.headers['x-buyoll-role'] || req.query.role;
  if (headerRole === 'admin' || headerRole === 'merchant' || headerRole === 'member' || headerRole === 'lender') {
    return [headerRole];
  }
  const urlPath = (req.originalUrl || req.path || '').toLowerCase();
  if (urlPath.includes('/admin/')) return ['admin', 'merchant', 'member', 'lender'];
  if (urlPath.includes('/merchant/')) return ['merchant', 'admin', 'member', 'lender'];
  return ['member', 'merchant', 'lender', 'admin'];
}

export async function resolveAuthenticatedSession(
  req: Request,
  existingDb?: DatabaseSchema,
  options?: { touchActivity?: boolean; requestedRole?: UserRole }
): Promise<AuthSessionResolution> {
  const db = existingDb || (await getDatabase());
  const now = Date.now();
  const touch = options?.touchActivity !== false;
  const cookies = parseCookiesHeader(req);

  const validateSession = (sessionId: string): AuthSessionResolution => {
    const session = (db.sessions || []).find((s) => s.id === sessionId);
    if (!session) {
      return {
        user: null,
        session: null,
        role: null,
        errorCode: 'SESSION_REVOKED',
        errorMessage: 'Session no longer exists. Please log in again.',
      };
    }
    if (session.revokedAt) {
      return {
        user: null,
        session: null,
        role: null,
        errorCode: session.revokeReason === 'IDLE_EXPIRED' ? 'SESSION_IDLE_EXPIRED' : 'SESSION_REVOKED',
        errorMessage:
          session.revokeReason === 'IDLE_EXPIRED'
            ? 'Your session expired after 20 minutes of inactivity. Please log in again.'
            : 'Your session was signed out. Please log in again.',
      };
    }
    if (session.expiresAt <= now) {
      session.revokedAt = now;
      session.revokeReason = 'ABSOLUTE_EXPIRED';
      return {
        user: null,
        session: null,
        role: null,
        errorCode: 'SESSION_REVOKED',
        errorMessage: 'Your session has expired. Please log in again.',
      };
    }
    if (now - session.lastActivityAt > SESSION_IDLE_TIMEOUT_MS) {
      session.revokedAt = now;
      session.revokeReason = 'IDLE_EXPIRED';
      return {
        user: null,
        session: null,
        role: null,
        errorCode: 'SESSION_IDLE_EXPIRED',
        errorMessage: 'Session expired due to 20 minutes of inactivity. Please log in again.',
      };
    }

    const user = db.users.find((u) => u.id === session.userId);
    if (!user || user.isDisabled || user.isSuspended) {
      return {
        user: null,
        session: null,
        role: null,
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Account is disabled or suspended.',
      };
    }

    if (touch) {
      session.lastActivityAt = now;
      user.lastActive = now;
    }

    return {
      user,
      session,
      role: session.role,
      errorCode: null,
    };
  };

  // 1. Check role-specific httpOnly session cookies first if requestedRole or cookie exists
  const candidateRoles = pickCookieRolesForRequest(req, options?.requestedRole);
  let lastIdleError: AuthSessionResolution | null = null;

  // If Bearer token is supplied explicitly (and no specific requestedRole cookie overrides it), validate JWT + its DB session
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' && req.query.token.trim() ? req.query.token.trim() : null;
  const explicitBearer =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

  if (explicitBearer) {
    const payload = verifyAccessToken(explicitBearer);
    if (payload && payload.sid) {
      const res = validateSession(payload.sid);
      if (res.user) {
        if ((res.user.tokenVersion || 1) === payload.tv) {
          (req as any)._authSession = res.session;
          (req as any)._authRole = res.role;
          return res;
        }
        return {
          user: null,
          session: null,
          role: null,
          errorCode: 'SESSION_REVOKED',
          errorMessage: 'Session invalidated after security update.',
        };
      }
      if (res.errorCode === 'SESSION_IDLE_EXPIRED') {
        lastIdleError = res;
      }
    }
  }

  for (const r of candidateRoles) {
    const rawCookie = cookies[ROLE_COOKIE_NAMES[r]];
    if (!rawCookie) continue;
    const sessionId = verifySessionCookieValue(rawCookie);
    if (!sessionId) continue;
    const res = validateSession(sessionId);
    if (res.user) {
      (req as any)._authSession = res.session;
      (req as any)._authRole = res.role;
      return res;
    }
    if (res.errorCode === 'SESSION_IDLE_EXPIRED') {
      lastIdleError = res;
    }
  }

  // Fallback to buyoll_access cookie if not checked yet
  if (!explicitBearer && cookies.buyoll_access) {
    const payload = verifyAccessToken(cookies.buyoll_access);
    if (payload && payload.sid) {
      const res = validateSession(payload.sid);
      if (res.user && (res.user.tokenVersion || 1) === payload.tv) {
        (req as any)._authSession = res.session;
        (req as any)._authRole = res.role;
        return res;
      }
      if (res.errorCode === 'SESSION_IDLE_EXPIRED') {
        lastIdleError = res;
      }
    }
  }

  if (lastIdleError) {
    (req as any)._authFailureCode = lastIdleError.errorCode;
    (req as any)._authFailureMessage = lastIdleError.errorMessage;
    return lastIdleError;
  }

  return {
    user: null,
    session: null,
    role: null,
    errorCode: 'UNAUTHORIZED',
    errorMessage: 'Authentication required.',
  };
}

export async function resolveAuthenticatedUser(
  req: Request,
  existingDb?: DatabaseSchema
): Promise<User | null> {
  const resolution = await resolveAuthenticatedSession(req, existingDb, { touchActivity: true });
  return resolution.user;
}

export function sanitizeUser(user: User): Omit<User, 'password' | 'adminPasskeyHash' | 'passwordHmac'> {
  const {
    password: _pw,
    adminPasskeyHash: _pk,
    passwordHmac: _ph,
    ...safe
  } = user as any;
  const restricted = Number(safe.restrictedLoanBalance ?? safe.nonWithdrawableBalance ?? 0);
  const activeRole = normalizeRoleValue(safe.activeRole || safe.role);
  return {
    ...safe,
    role: activeRole,
    activeRole,
    avatar: safe.avatar || safe.avatarUrl,
    avatarUrl: safe.avatarUrl || safe.avatar,
    restrictedLoanBalance: restricted,
    nonWithdrawableBalance: restricted,
  };
}

export function sendSecurityEmail(
  db: DatabaseSchema,
  params: {
    to: string;
    subject: string;
    body: string;
    kind: EmailOutboxRecord['kind'];
    userId?: number;
    meta?: Record<string, any>;
  }
): EmailOutboxRecord {
  if (!db.emailOutbox) db.emailOutbox = [];
  const now = Date.now();
  const record: EmailOutboxRecord = {
    id: `mail_${now}_${crypto.randomBytes(4).toString('hex')}`,
    to: params.to,
    subject: params.subject,
    body: params.body,
    kind: params.kind,
    userId: params.userId,
    createdAt: now,
    meta: params.meta,
  };
  db.emailOutbox.unshift(record);
  if (db.emailOutbox.length > 500) {
    db.emailOutbox = db.emailOutbox.slice(0, 500);
  }
  return record;
}

export function getAuthLockoutPolicy() {
  return {
    adminMaxFailedAttempts: ADMIN_MAX_FAILED_ATTEMPTS,
    adminLockoutMs: ADMIN_LOCKOUT_MS,
  };
}
