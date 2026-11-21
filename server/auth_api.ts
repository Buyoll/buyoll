import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction, saveDatabase } from './db.js';
import {
  ALL_ROLE_COOKIES,
  canonicalizeUsernameInput,
  clearAuthCookies,
  clearRoleSessionCookie,
  computePasswordHmac,
  createAccessToken,
  createDbSession,
  evaluatePasswordStrength,
  getClientIp,
  hashOpaqueToken,
  hashPasskey,
  hashPassword,
  isPasswordReusedGlobally,
  isValidStrictUsername,
  isValidUsername,
  issueAuthTokensForUser,
  looksLikePhoneNumber,
  normalizeEastAfricanPhone,
  normalizeUsername,
  normalizeUsernameSeed,
  resolveAuthenticatedSession,
  ROLE_COOKIE_NAMES,
  sanitizeUser,
  sendSecurityEmail,
  setAuthCookies,
  setRoleSessionCookie,
  verifyAccessToken,
  verifyDummyPassword,
  verifyPasskey,
  verifyPassword,
  verifySessionCookieValue,
} from './auth_utils.js';
import { buildResetLink, dispatchContactNotification } from './messaging.js';
import { sendApiError, sendZodError, wrapRouterAsync } from './errors.js';
import {
  ADMIN_LOCKOUT_MS,
  ADMIN_MAX_FAILED_ATTEMPTS,
  FORGOT_USERNAME_MODE,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  RECENT_REAUTH_WINDOW_MS,
  RESET_TOKEN_TTL_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SUPPORT_EMAIL,
} from './config.js';
import { ensureWallet, findPlatformAdminUser, normalizeRoleValue } from './wallet_service.js';
import { OtpChallengeRecord, User, UserRole } from '../src/types.js';

export const authRouter = wrapRouterAsync(Router());

const NON_ADMIN_SOFT_PROMPT_THRESHOLD = 3;
const NON_ADMIN_MAX_ATTEMPTS = 5;
const IP_LOGIN_MAX_ATTEMPTS = 30;
const LOCKOUT_MS = 15 * 60 * 1000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const RECOVERY_MAX_PER_CONTACT = 3;
const RECOVERY_MAX_PER_IP = 20;

const IS_TEST_MODE = (): boolean =>
  process.env.BUYOLL_TEST_MODE === '1' || process.env.NODE_ENV === 'test';

const slidingWindows = new Map<string, number[]>();

function pruneWindow(key: string, windowMs: number, now = Date.now()): number[] {
  const cutoff = now - windowMs;
  const arr = (slidingWindows.get(key) || []).filter((ts) => ts > cutoff);
  if (arr.length > 0) {
    slidingWindows.set(key, arr);
  } else {
    slidingWindows.delete(key);
  }
  return arr;
}

function isSlidingWindowLimited(
  key: string,
  maxCount: number,
  windowMs: number
): { limited: boolean; waitMinutes: number } {
  const now = Date.now();
  const arr = pruneWindow(key, windowMs, now);
  if (arr.length >= maxCount) {
    const oldest = arr[0] || now;
    const waitMinutes = Math.max(1, Math.ceil((oldest + windowMs - now) / 60000));
    return { limited: true, waitMinutes };
  }
  return { limited: false, waitMinutes: 0 };
}

function recordSlidingFailure(key: string, windowMs: number): void {
  const now = Date.now();
  const arr = pruneWindow(key, windowMs, now);
  arr.push(now);
  slidingWindows.set(key, arr);
}

function checkAndRecordSlidingWindow(
  key: string,
  maxCount: number,
  windowMs: number
): { allowed: boolean; waitMinutes: number } {
  const check = isSlidingWindowLimited(key, maxCount, windowMs);
  if (check.limited) {
    return { allowed: false, waitMinutes: check.waitMinutes };
  }
  recordSlidingFailure(key, windowMs);
  return { allowed: true, waitMinutes: 0 };
}

interface FailedAttemptBucket {
  count: number;
  lockedUntil?: number;
  lastAttemptAt: number;
}
const loginAttemptsByKey = new Map<string, FailedAttemptBucket>();

function getBucketStatus(key: string): { locked: boolean; waitMinutes: number; count: number } {
  const rec = loginAttemptsByKey.get(key);
  if (!rec) return { locked: false, waitMinutes: 0, count: 0 };
  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return {
      locked: true,
      waitMinutes: Math.max(1, Math.ceil((rec.lockedUntil - now) / 60000)),
      count: rec.count,
    };
  }
  if (rec.lockedUntil && rec.lockedUntil <= now) {
    loginAttemptsByKey.delete(key);
    return { locked: false, waitMinutes: 0, count: 0 };
  }
  return { locked: false, waitMinutes: 0, count: rec.count };
}

function recordBucketFailure(key: string, maxAttempts: number, lockoutMs: number): { count: number; justLocked: boolean } {
  const now = Date.now();
  const existing = loginAttemptsByKey.get(key) || { count: 0, lastAttemptAt: now };
  if (existing.lockedUntil && existing.lockedUntil <= now) {
    existing.count = 0;
    existing.lockedUntil = undefined;
  }
  existing.count += 1;
  existing.lastAttemptAt = now;
  let justLocked = false;
  if (existing.count >= maxAttempts) {
    existing.lockedUntil = now + lockoutMs;
    justLocked = true;
  }
  loginAttemptsByKey.set(key, existing);
  return { count: existing.count, justLocked };
}

function clearBucket(key: string): void {
  loginAttemptsByKey.delete(key);
}

function clearUserLoginBuckets(user: User): void {
  const candidates = new Set<string>();
  if (user.username) {
    candidates.add(normalizeUsername(user.username));
    candidates.add(user.username.toLowerCase());
  }
  if (user.usernameNormalized) candidates.add(user.usernameNormalized);
  if (user.usernameLower) candidates.add(user.usernameLower);
  if (user.email) {
    candidates.add(user.email.toLowerCase());
    candidates.add(normalizeUsername(user.email));
  }
  if (user.phoneNormalized) candidates.add(user.phoneNormalized.toLowerCase());
  if (user.phone) {
    candidates.add(user.phone.toLowerCase());
    candidates.add(normalizeUsername(user.phone));
  }
  for (const key of Array.from(loginAttemptsByKey.keys())) {
    const firstColon = key.indexOf(':');
    const lastColon = key.lastIndexOf(':');
    if (firstColon > 0 && lastColon > firstColon) {
      const idPart = key.slice(firstColon + 1, lastColon);
      if (candidates.has(idPart)) {
        loginAttemptsByKey.delete(key);
      }
    }
  }
}

function generateCode(length = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateNumericOtp(digits = 6): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  return String(crypto.randomInt(min, max + 1));
}

function extractRefreshToken(req: Request): string | null {
  if (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken.trim()) {
    return req.body.refreshToken.trim();
  }
  const roleHintRaw = req.headers['x-buyoll-role'] || req.query.role || req.body?.role;
  const roleHint =
    roleHintRaw === 'admin' || roleHintRaw === 'merchant' || roleHintRaw === 'member' || roleHintRaw === 'lender'
      ? roleHintRaw
      : null;
  if (roleHint && req.cookies?.[`buyoll_refresh_${roleHint}`]) {
    return String(req.cookies[`buyoll_refresh_${roleHint}`]);
  }
  if (req.cookies?.buyoll_refresh) {
    return String(req.cookies.buyoll_refresh);
  }
  if (req.headers.cookie) {
    const parts = req.headers.cookie.split(';').map((s) => s.trim());
    if (roleHint) {
      const roleMatch = parts.find((s) => s.startsWith(`buyoll_refresh_${roleHint}=`));
      if (roleMatch) return decodeURIComponent(roleMatch.split('=').slice(1).join('='));
    }
    const match = parts.find((s) => s.startsWith('buyoll_refresh='));
    if (match) return decodeURIComponent(match.split('=').slice(1).join('='));
  }
  return null;
}

function syncUserRoleAndWallet(user: User): void {
  const activeRole = normalizeRoleValue(user.activeRole || user.role);
  user.activeRole = activeRole;
  user.role = activeRole;
  if (!user.roles || !Array.isArray(user.roles) || user.roles.length === 0) {
    user.roles = [activeRole];
  }
  if (!user.platformId) {
    const prefix =
      activeRole === 'merchant'
        ? 'BYL-V'
        : activeRole === 'lender'
        ? 'BYL-L'
        : activeRole === 'admin'
        ? 'BYL-A'
        : 'BYL-M';
    user.platformId = `${prefix}-${(10000 + user.id).toString()}`;
  }
  if (!user.referralCode) {
    user.referralCode = `BYL-${10000 + user.id}-${generateCode(3)}`;
  }
  if (user.roleWallets && user.roleWallets[activeRole]) {
    user.credit = user.roleWallets[activeRole]!.credit;
    user.coins = user.roleWallets[activeRole]!.coins;
    user.points = user.roleWallets[activeRole]!.points;
  }
}

const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters.')
    .max(100, 'Full name must be 100 characters or fewer.'),
  username: z.string().optional(),
  email: z.string().trim().email('Please provide a valid email address.').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
  confirmPassword: z.string().optional(),
  phone: z.union([z.string().trim().max(30), z.null()]).optional(),
  role: z.enum(['member', 'merchant', 'lender', 'admin']).optional(),
  shopName: z.union([z.string().trim().max(100), z.null()]).optional(),
  shopDescription: z.union([z.string().trim().max(500), z.null()]).optional(),
  lenderType: z.union([z.string().trim().max(80), z.null()]).optional(),
  referredBy: z.union([z.string().trim().max(60), z.null()]).optional(),
  rememberMe: z.boolean().optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().optional(),
  username: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  password: z.string().optional(),
  passkey: z.string().optional(),
  adminPasskey: z.string().optional(),
  role: z.string().trim().optional(),
  rememberMe: z.boolean().optional(),
});

// ======================================================================
// USERNAME AVAILABILITY (Normalized uniqueness + strict char check)
// ======================================================================
async function handleUsernameAvailable(req: Request, res: Response) {
  const raw = String(req.query.u || req.query.username || '').trim();
  const norm = normalizeUsername(raw);
  const lower = canonicalizeUsernameInput(raw);
  const db = await getDatabase();

  // Check collision first so legacy/punctuation-equivalent conflicts report conflict cleanly
  const taken =
    norm.length >= 3 &&
    (db.users || []).some(
      (u) =>
        (u.usernameLower && u.usernameLower === lower) ||
        (u.usernameNormalized && u.usernameNormalized === norm) ||
        (u.username && normalizeUsername(u.username) === norm)
    );

  if (taken) {
    return res.json({
      valid: false,
      available: false,
      normalized: norm,
      message: 'That username is not available. Please choose a different one.',
    });
  }

  const valid = isValidStrictUsername(raw);
  if (!valid) {
    return res.json({
      valid: false,
      available: false,
      normalized: norm,
      message: 'Use 3–30 characters: letters, numbers, dots (.), or underscores (_).',
    });
  }

  return res.json({
    valid: true,
    available: true,
    normalized: norm,
    message: 'Username is available.',
  });
}

authRouter.get('/auth/username-available', handleUsernameAvailable);
authRouter.get('/auth/check-username', handleUsernameAvailable);

// ======================================================================
// SESSION CHECK (/auth/me & /auth/keepalive)
// ======================================================================
authRouter.get('/auth/me', async (req: Request, res: Response) => {
  const requestedRole = req.query.role
    ? normalizeRoleValue(String(req.query.role))
    : req.headers['x-buyoll-role']
    ? normalizeRoleValue(String(req.headers['x-buyoll-role']))
    : undefined;

  const resDb = await getDatabase();
  const prevWalletCount = (resDb.wallets || []).length;
  const auth = await resolveAuthenticatedSession(req, resDb, {
    touchActivity: false,
    requestedRole,
  });

  if (!auth.user || !auth.session) {
    if (auth.errorCode === 'SESSION_IDLE_EXPIRED') {
      await saveDatabase(resDb);
      if (requestedRole) clearRoleSessionCookie(res, requestedRole);
      return sendApiError(
        res,
        401,
        'SESSION_IDLE_EXPIRED',
        auth.errorMessage || 'Your session expired after 20 minutes of inactivity. Please log in again.'
      );
    }
    return sendApiError(res, 401, auth.errorCode || 'UNAUTHORIZED', 'Not authenticated');
  }

  const prevRole = auth.user.activeRole;
  const prevCredit = auth.user.credit;
  syncUserRoleAndWallet(auth.user);
  ensureWallet(resDb, auth.user, auth.session.role);
  const now = Date.now();
  const shouldTouchActivity = !auth.session.lastActivityAt || now - auth.session.lastActivityAt >= 60_000;
  if (shouldTouchActivity) {
    auth.session.lastActivityAt = now;
  }
  const mutated =
    shouldTouchActivity ||
    (resDb.wallets || []).length !== prevWalletCount ||
    auth.user.activeRole !== prevRole ||
    auth.user.credit !== prevCredit;
  if (mutated) {
    await saveDatabase(resDb);
  }
  return res.json({
    user: sanitizeUser(auth.user),
    session: {
      id: auth.session.id,
      role: auth.session.role,
      createdAt: auth.session.createdAt,
      lastActivityAt: auth.session.lastActivityAt,
      expiresAt: auth.session.expiresAt,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      idleExpiresAt: auth.session.lastActivityAt + SESSION_IDLE_TIMEOUT_MS,
      serverNow: now,
    },
  });
});

authRouter.post('/auth/keepalive', async (req: Request, res: Response) => {
  const requestedRole = req.body?.role
    ? normalizeRoleValue(String(req.body.role))
    : req.headers['x-buyoll-role']
    ? normalizeRoleValue(String(req.headers['x-buyoll-role']))
    : undefined;

  const result = await runDatabaseTransaction(async (db) => {
    const auth = await resolveAuthenticatedSession(req, db, {
      touchActivity: true,
      requestedRole,
    });
    if (!auth.user || !auth.session) {
      return {
        status: 401,
        code: auth.errorCode || 'UNAUTHORIZED',
        message: auth.errorMessage || 'Session expired or not authenticated.',
      };
    }
    return { status: 200, session: auth.session };
  });

  if (result.status !== 200) {
    if (requestedRole && result.code === 'SESSION_IDLE_EXPIRED') {
      clearRoleSessionCookie(res, requestedRole);
    }
    return sendApiError(res, result.status, result.code!, result.message!);
  }

  const s = result.session!;
  return res.json({
    ok: true,
    sessionId: s.id,
    role: s.role,
    lastActivityAt: s.lastActivityAt,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    idleExpiresAt: s.lastActivityAt + SESSION_IDLE_TIMEOUT_MS,
    serverNow: Date.now(),
  });
});

// ======================================================================
// REGISTRATION (Non-Admin Only — Admin Self-Registration Removed)
// ======================================================================
authRouter.post('/auth/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const input = parsed.data;
  if (input.role === 'admin') {
    return sendApiError(
      res,
      403,
      'ADMIN_REGISTRATION_CLOSED',
      'Administrator registration is disabled. Sign in with the platform administrator credentials.'
    );
  }

  const cleanRole: UserRole =
    input.role === 'merchant' || input.role === 'lender' ? input.role : 'member';
  const cleanEmail = input.email.trim().toLowerCase();

  // Confirm password check when supplied
  if (input.confirmPassword !== undefined && input.confirmPassword !== input.password) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Passwords do not match.', {
      confirmPassword: 'Passwords do not match.',
    });
  }

  // Normalize optional phone to East African E.164 (nullable)
  const phoneParse = normalizeEastAfricanPhone(input.phone ?? null);
  if (!phoneParse.valid) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', phoneParse.error || 'Phone number appears invalid.', {
      phone: phoneParse.error || 'Enter a valid East African or international phone number.',
    });
  }
  const normalizedPhone = phoneParse.normalized;

  // Evaluate password strength WITHOUT trimming password
  const pwEval = evaluatePasswordStrength(input.password, {
    username: input.username,
    name: input.name,
    email: cleanEmail,
    phone: normalizedPhone || input.phone || undefined,
  });
  if (!pwEval.valid) {
    return sendApiError(res, 422, 'WEAK_PASSWORD', pwEval.error!, { password: pwEval.error! });
  }

  const passwordHash = await hashPassword(input.password);
  const passwordHmac = computePasswordHmac(input.password);

  const result = await runDatabaseTransaction(async (db) => {
    if (isPasswordReusedGlobally(db, input.password)) {
      return {
        error: {
          status: 422,
          code: 'PASSWORD_NOT_ALLOWED',
          message: 'Please choose a unique password that is not already in use.',
          fields: { password: 'Please choose a different password.' },
        },
      };
    }

    if (db.users.some((u) => !u.isDisabled && u.email && u.email.trim().toLowerCase() === cleanEmail)) {
      return {
        error: {
          status: 409,
          code: 'EMAIL_TAKEN',
          message: 'An account with this email address already exists. Please log in instead.',
          fields: { email: 'This email address is already registered.' },
        },
      };
    }

    if (
      normalizedPhone &&
      db.users.some((u) => {
        if (u.isDisabled) return false;
        if (u.phoneNormalized && u.phoneNormalized === normalizedPhone) return true;
        if (!u.phone) return false;
        const p = normalizeEastAfricanPhone(u.phone);
        return p.valid && p.normalized === normalizedPhone;
      })
    ) {
      return {
        error: {
          status: 409,
          code: 'PHONE_TAKEN',
          message: 'This phone number is already registered to another account.',
          fields: { phone: 'This phone number is already registered.' },
        },
      };
    }

    let finalUsername: string;
    let usernameDisplay: string;
    let finalNorm: string;
    if (input.username !== undefined) {
      const displayRaw = input.username.normalize('NFKC').trim();
      finalUsername = displayRaw.toLowerCase();
      usernameDisplay = displayRaw;
      finalNorm = normalizeUsername(finalUsername);

      if (finalUsername.length < 3 || finalUsername.length > 30) {
        return {
          error: {
            status: 422,
            code: 'INVALID_USERNAME',
            message: 'Username must be 3–30 characters.',
            fields: { username: 'Use 3–30 characters.' },
          },
        };
      }

      const conflict = db.users.some(
        (u) =>
          (u.usernameLower && u.usernameLower === finalUsername) ||
          (u.usernameNormalized && u.usernameNormalized === finalNorm) ||
          (u.username && normalizeUsername(u.username) === finalNorm)
      );
      if (conflict) {
        return {
          error: {
            status: 409,
            code: 'USERNAME_TAKEN',
            message: 'That username is not available. Please choose a different one.',
            fields: { username: 'That username is not available. Please choose a different one.' },
          },
        };
      }

      if (!isValidStrictUsername(displayRaw)) {
        return {
          error: {
            status: 422,
            code: 'INVALID_USERNAME',
            message: 'Username must be 3–30 characters using letters, numbers, dots (.), or underscores (_).',
            fields: { username: 'Use only letters, numbers, "." or "_" (3–30 chars).' },
          },
        };
      }
    } else {
      const seedBase = cleanEmail.split('@')[0] || input.name;
      const candidateSeed = normalizeUsernameSeed(seedBase, (db.nextIds.user || 1));
      const takenNorms = new Set(
        db.users.map((u) => u.usernameNormalized || normalizeUsername(u.username || '')).filter(Boolean)
      );
      finalUsername = takenNorms.has(normalizeUsername(candidateSeed))
        ? `${candidateSeed.slice(0, 22)}_${db.nextIds.user || Date.now().toString().slice(-4)}`
        : candidateSeed;
      usernameDisplay = finalUsername;
      finalNorm = normalizeUsername(finalUsername);
    }

    const maxExistingId = db.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
    if (db.nextIds.user <= maxExistingId) {
      db.nextIds.user = maxExistingId + 1;
    }
    const newId = db.nextIds.user++;

    const prefix = cleanRole === 'merchant' ? 'BYL-V' : cleanRole === 'lender' ? 'BYL-L' : 'BYL-M';
    const platformId = `${prefix}-${(10000 + newId).toString()}`;
    const startingCoins = cleanRole === 'member' ? 100 : cleanRole === 'merchant' ? 200 : 300;
    const startingPoints = cleanRole === 'member' ? 25 : 50;
    const now = Date.now();

    const newUser: User = {
      id: newId,
      uuid: crypto.randomUUID(),
      name: input.name,
      username: finalUsername,
      usernameDisplay,
      usernameLower: finalUsername,
      usernameNormalized: finalNorm,
      email: cleanEmail,
      phone: normalizedPhone,
      phoneNormalized: normalizedPhone,
      password: passwordHash,
      passwordHmac,
      role: cleanRole,
      roles: [cleanRole],
      activeRole: cleanRole,
      platformId,
      referralCode: `BYL-${10000 + newId}-${generateCode(3)}`,
      referredBy: input.referredBy || undefined,
      shopName: cleanRole === 'merchant' ? input.shopName || input.name : undefined,
      shopDescription: cleanRole === 'merchant' ? input.shopDescription || 'Verified seller on Buyoll' : undefined,
      lenderType: cleanRole === 'lender' ? input.lenderType || undefined : undefined,
      verified: false,
      emailVerified: false,
      phoneVerified: false,
      merchantSubscriptionStatus: cleanRole === 'merchant' ? 'inactive' : undefined,
      credit: 0,
      nonWithdrawableBalance: 0,
      restrictedLoanBalance: 0,
      coins: startingCoins,
      points: startingPoints,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: 1,
      roleWallets: {
        [cleanRole]: {
          credit: 0,
          nonWithdrawableBalance: 0,
          coins: startingCoins,
          points: startingPoints,
        },
      },
      lastActive: now,
      createdAt: now,
      updatedAt: now,
    };

    db.users.push(newUser);
    ensureWallet(db, newUser, cleanRole);
    const tokens = issueAuthTokensForUser(db, newUser, input.rememberMe ?? true, req, cleanRole);
    logAudit(
      db,
      newUser.id,
      newUser.name,
      'AUTH_USER_REGISTERED',
      `Registered ${cleanRole} account (@${finalUsername}, ${platformId}).`
    );

    return { user: newUser, tokens };
  });

  if ('error' in result && result.error) {
    return sendApiError(
      res,
      result.error.status,
      result.error.code,
      result.error.message,
      result.error.fields
    );
  }

  const { user, tokens } = result as {
    user: User;
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number; session: any };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt, cleanRole, tokens.session.id);
  const displayRole = cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1);
  return res.status(201).json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    session: {
      id: tokens.session.id,
      role: cleanRole,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      lastActivityAt: tokens.session.lastActivityAt,
    },
    notice: `Account created successfully as ${displayRole}! Welcome to Buyoll.`,
  });
});

// ======================================================================
// LOGIN (Admin requires username + password + passkey; 3-fail lockout + alert;
//        Non-admin uses normalized username lookup, 3-fail recovery prompt)
// ======================================================================
async function handleLogin(req: Request, res: Response, forcedAdmin = false) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const rawIdentifier = parsed.data.identifier || parsed.data.username || parsed.data.phone || '';
  const cleanLookup = rawIdentifier.trim();
  const password = parsed.data.password; // NEVER trim password!
  const passkey = parsed.data.passkey ?? parsed.data.adminPasskey; // NEVER trim passkey!
  const requestedRoleRaw = forcedAdmin ? 'admin' : parsed.data.role;
  const reqRole = requestedRoleRaw ? normalizeRoleValue(requestedRoleRaw) : undefined;
  const isAdminLogin = reqRole === 'admin';
  const clientIp = getClientIp(req);

  if (!cleanLookup) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Please enter your username, email, or phone number.', {
      identifier: 'Username, email, or phone number is required.',
    });
  }
  if (!password) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Password is required.', {
      password: 'Password is required.',
    });
  }
  if (isAdminLogin && !passkey) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Security passkey is required for administrator sign-in.', {
      passkey: 'Security passkey is required.',
    });
  }

  const isEmailLookup = cleanLookup.includes('@');
  const isPhoneLookup = !isEmailLookup && looksLikePhoneNumber(cleanLookup);
  const normalizedPhoneLookup = isPhoneLookup ? normalizeEastAfricanPhone(cleanLookup).normalized : null;
  const lookupNorm = normalizeUsername(cleanLookup);
  const lookupLower = cleanLookup.toLowerCase();
  const bucketId = isEmailLookup
    ? lookupLower
    : normalizedPhoneLookup
    ? normalizedPhoneLookup.toLowerCase()
    : lookupNorm || lookupLower;
  const attemptBucketKey = `${isAdminLogin ? 'admin' : 'user'}:${bucketId}:${clientIp}`;
  const ipFailureKey = `login_ip_fail:${clientIp}`;

  const bucketStatus = getBucketStatus(attemptBucketKey);
  if (bucketStatus.locked) {
    return sendApiError(
      res,
      429,
      'ACCOUNT_LOCKED',
      `Too many failed login attempts. Try again in ${bucketStatus.waitMinutes} minute(s).`
    );
  }
  const ipRateStatus = isSlidingWindowLimited(ipFailureKey, IP_LOGIN_MAX_ATTEMPTS, LOCKOUT_MS);
  if (ipRateStatus.limited) {
    return sendApiError(
      res,
      429,
      'RATE_LIMITED',
      `Too many failed login attempts from your network. Try again in ${ipRateStatus.waitMinutes} minute(s).`
    );
  }

  const outcome = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const user = (db.users || []).find((u) => {
      if (isAdminLogin) {
        return (
          (u.usernameLower && u.usernameLower === lookupLower) ||
          (u.usernameNormalized && u.usernameNormalized === lookupNorm) ||
          (u.username && normalizeUsername(u.username) === lookupNorm) ||
          (isEmailLookup && u.email && u.email.toLowerCase() === lookupLower)
        );
      }
      if (isEmailLookup) {
        return Boolean(u.email && u.email.trim().toLowerCase() === lookupLower);
      }
      if (isPhoneLookup) {
        if (normalizedPhoneLookup) {
          if (u.phoneNormalized && u.phoneNormalized === normalizedPhoneLookup) return true;
          if (u.phone) {
            const p = normalizeEastAfricanPhone(u.phone);
            if (p.valid && p.normalized === normalizedPhoneLookup) return true;
          }
        }
        return Boolean(u.phone && u.phone.toLowerCase() === lookupLower);
      }
      return (
        (u.usernameLower && u.usernameLower === lookupLower) ||
        (u.usernameNormalized && u.usernameNormalized === lookupNorm) ||
        (u.username && normalizeUsername(u.username) === lookupNorm)
      );
    });

    if (!user || user.isDisabled) {
      await verifyDummyPassword(password);
      recordSlidingFailure(ipFailureKey, LOCKOUT_MS);

      if (isAdminLogin) {
        const failInfo = recordBucketFailure(attemptBucketKey, ADMIN_MAX_FAILED_ATTEMPTS, ADMIN_LOCKOUT_MS);
        if (failInfo.justLocked) {
          const activeAdmin = findPlatformAdminUser(db);
          sendSecurityEmail(db, {
            to: activeAdmin?.email || SUPPORT_EMAIL,
            subject: 'Security Alert: Multiple Failed Admin Sign-In Attempts',
            body: `Three consecutive failed administrator sign-in attempts were detected from IP ${clientIp}. Login has been locked for 15 minutes.`,
            kind: 'security_alert',
            userId: activeAdmin?.id,
            meta: { ip: clientIp },
          });
          logAudit(db, 0, 'System', 'AUTH_ADMIN_LOCKED', `Locked admin login attempts from IP ${clientIp}.`);
          return {
            status: 429,
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed administrator login attempts. Account locked for 15 minutes.',
          };
        }
        return {
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials. Please check your details and try again.',
        };
      }

      const failInfo = recordBucketFailure(attemptBucketKey, NON_ADMIN_MAX_ATTEMPTS, LOCKOUT_MS);
      if (failInfo.justLocked) {
        logAudit(db, 0, 'System', 'AUTH_LOGIN_LOCKED', `Rate-limited login attempts (${clientIp}).`);
        return {
          status: 429,
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed login attempts. Please try again in 15 minutes or recover your account.',
          fields: { showRecoveryPrompt: 'true' },
        };
      }
      return {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials. Please check your details and try again.',
        fields: failInfo.count >= NON_ADMIN_SOFT_PROMPT_THRESHOLD ? { showRecoveryPrompt: 'true' } : undefined,
      };
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const waitMin = Math.max(1, Math.ceil((user.lockedUntil - now) / 60000));
      return {
        status: 429,
        code: 'ACCOUNT_LOCKED',
        message: `Account temporarily locked after failed login attempts. Please try again in ${waitMin} minute(s).`,
        fields: !isAdminLogin ? { showRecoveryPrompt: 'true' } : undefined,
      };
    }

    if (user.isSuspended) {
      return {
        status: 403,
        code: 'ACCOUNT_SUSPENDED',
        message: user.suspendReason
          ? `Account suspended: ${user.suspendReason}`
          : `Your account is suspended. Please contact ${SUPPORT_EMAIL}.`,
      };
    }

    const userRoles = user.roles || [normalizeRoleValue(user.activeRole || user.role)];

    // Verify Admin credentials strictly (username + argon2id password + argon2id passkey + active admin role)
    if (isAdminLogin) {
      const hasAdminRole = user.role === 'admin' || user.activeRole === 'admin' || userRoles.includes('admin');
      const pwOk = user.password ? await verifyPassword(password, user.password) : false;
      const pkOk = user.adminPasskeyHash ? await verifyPasskey(passkey!, user.adminPasskeyHash) : false;

      if (!hasAdminRole || !pwOk || !pkOk) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        recordBucketFailure(attemptBucketKey, ADMIN_MAX_FAILED_ATTEMPTS, ADMIN_LOCKOUT_MS);
        recordSlidingFailure(ipFailureKey, LOCKOUT_MS);
        if (user.failedLoginCount >= ADMIN_MAX_FAILED_ATTEMPTS) {
          user.lockedUntil = now + ADMIN_LOCKOUT_MS;
          sendSecurityEmail(db, {
            to: user.email || SUPPORT_EMAIL,
            subject: 'Security Alert: Administrator Account Locked',
            body: `Your Buyoll administrator account (@${user.username}) was locked for 15 minutes after ${user.failedLoginCount} failed login attempts from IP ${clientIp}. If this was not you, reset your password and passkey immediately.`,
            kind: 'security_alert',
            userId: user.id,
            meta: { ip: clientIp, failedAttempts: user.failedLoginCount },
          });
          logAudit(
            db,
            user.id,
            user.name,
            'AUTH_ADMIN_LOCKED',
            `Administrator account locked for 15 minutes after ${user.failedLoginCount} failed login attempts (${clientIp}).`
          );
          return {
            status: 429,
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed administrator login attempts. Account locked for 15 minutes.',
          };
        }
        logAudit(
          db,
          user.id,
          user.name,
          'AUTH_ADMIN_LOGIN_FAILED',
          `Failed admin login attempt #${user.failedLoginCount} from ${clientIp}.`
        );
        return {
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials. Please check your details and try again.',
        };
      }
    } else {
      // Non-admin password check
      if (userRoles.includes('admin') && !userRoles.some((r) => r !== 'admin')) {
        return {
          status: 403,
          code: 'ADMIN_PORTAL_REQUIRED',
          message: 'Please sign in through the Administrator portal.',
        };
      }
      const pwOk = user.password ? await verifyPassword(password, user.password) : false;
      if (!pwOk) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        recordBucketFailure(attemptBucketKey, NON_ADMIN_MAX_ATTEMPTS, LOCKOUT_MS);
        recordSlidingFailure(ipFailureKey, LOCKOUT_MS);
        if (user.failedLoginCount >= NON_ADMIN_MAX_ATTEMPTS) {
          user.lockedUntil = now + LOCKOUT_MS;
          logAudit(db, user.id, user.name, 'AUTH_LOGIN_LOCKED', `Account locked for 15 minutes after ${user.failedLoginCount} failed login attempts.`);
          return {
            status: 429,
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed login attempts. Your account has been locked for 15 minutes.',
            fields: { showRecoveryPrompt: 'true' },
          };
        }
        logAudit(db, user.id, user.name, 'AUTH_LOGIN_FAILED', `Failed login attempt #${user.failedLoginCount}.`);
        return {
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials. Please check your details and try again.',
          fields:
            user.failedLoginCount >= NON_ADMIN_SOFT_PROMPT_THRESHOLD
              ? { showRecoveryPrompt: 'true', failedCount: String(user.failedLoginCount) }
              : undefined,
        };
      }
      // Transparently upgrade legacy non-argon2 password hashes on successful sign-in
      if (user.password && !user.password.startsWith('$argon2')) {
        user.password = await hashPassword(password);
        user.passwordHmac = computePasswordHmac(password);
      }
    }

    if (reqRole && !isAdminLogin) {
      if (userRoles.includes(reqRole)) {
        user.activeRole = reqRole;
        user.role = reqRole;
      } else {
        const primaryRole = normalizeRoleValue(user.activeRole || user.role);
        const displayRole =
          primaryRole === 'member'
            ? 'Member'
            : primaryRole === 'merchant'
            ? 'Merchant'
            : primaryRole === 'lender'
            ? 'Lender'
            : 'Admin';
        return {
          status: 403,
          code: 'ROLE_MISMATCH',
          message: `This account is registered as a ${displayRole}. Please sign in as a ${displayRole} or register a ${reqRole} account.`,
        };
      }
    }

    const activeRole: UserRole = isAdminLogin ? 'admin' : normalizeRoleValue(reqRole || user.activeRole || user.role);
    user.role = activeRole;
    user.activeRole = activeRole;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastActive = now;
    user.updatedAt = now;
    syncUserRoleAndWallet(user);
    ensureWallet(db, user, activeRole);
    clearBucket(attemptBucketKey);
    clearUserLoginBuckets(user);

    const tokens = issueAuthTokensForUser(db, user, parsed.data.rememberMe ?? true, req, activeRole);
    logAudit(db, user.id, user.name, 'AUTH_LOGIN_SUCCESS', `Signed in as ${activeRole} (@${user.username || user.id}).`);

    return { status: 200, user, activeRole, tokens };
  });

  if (outcome.status !== 200) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!, (outcome as any).fields);
  }

  const { user, activeRole, tokens } = outcome as {
    status: 200;
    user: User;
    activeRole: UserRole;
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number; session: any };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt, activeRole, tokens.session.id);
  return res.json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    session: {
      id: tokens.session.id,
      role: activeRole,
      lastActivityAt: tokens.session.lastActivityAt,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    },
    mustChangeCredentials: Boolean(user.mustChangeCredentials),
    notice: `Welcome back, ${user.name}!`,
  });
}

authRouter.post('/auth/login', (req: Request, res: Response) => handleLogin(req, res, false));
authRouter.post('/admin/auth/login', (req: Request, res: Response) => handleLogin(req, res, true));

// ======================================================================
// TOKEN REFRESH & PER-ROLE LOGOUT
// ======================================================================
authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  const rawToken = extractRefreshToken(req);
  if (!rawToken) {
    return sendApiError(res, 401, 'NO_REFRESH_TOKEN', 'Refresh token missing.');
  }

  const tokenHash = hashOpaqueToken(rawToken);
  const result = await runDatabaseTransaction(async (db) => {
    const records = db.refreshTokens || [];
    const rec = records.find((r) => r.tokenHash === tokenHash);
    if (!rec) {
      return { status: 401, code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token.' };
    }

    const now = Date.now();
    const user = db.users.find((u) => u.id === rec.userId);

    if (rec.revokedAt) {
      for (const r of records) {
        if (r.userId === rec.userId && !r.revokedAt) r.revokedAt = now;
      }
      if (user) {
        user.tokenVersion = (user.tokenVersion || 1) + 1;
        for (const s of db.sessions || []) {
          if (s.userId === user.id && !s.revokedAt) {
            s.revokedAt = now;
            s.revokeReason = 'REFRESH_REUSE_DETECTED';
          }
        }
        logAudit(db, user.id, user.name, 'AUTH_REFRESH_REUSE_DETECTED', 'Revoked active sessions due to refresh token replay.');
      }
      return {
        status: 401,
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Session security alert: refresh token reuse detected. Please log in again.',
      };
    }

    if (rec.expiresAt <= now) {
      rec.revokedAt = now;
      return { status: 401, code: 'REFRESH_TOKEN_EXPIRED', message: 'Your session has expired. Please log in again.' };
    }

    if (!user || user.isDisabled || user.isSuspended) {
      rec.revokedAt = now;
      return { status: 401, code: 'ACCOUNT_UNAVAILABLE', message: 'Account unavailable or suspended.' };
    }

    rec.revokedAt = now;
    syncUserRoleAndWallet(user);
    const activeRole = normalizeRoleValue(rec.role || user.activeRole || user.role);
    user.activeRole = activeRole;
    user.role = activeRole;
    const tokens = issueAuthTokensForUser(db, user, rec.rememberMe, req, activeRole);
    return { status: 200, user, activeRole, tokens };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!);
  }

  const { user, activeRole, tokens } = result as any;
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt, activeRole, tokens.session.id);
  return res.json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    session: {
      id: tokens.session.id,
      role: activeRole,
      lastActivityAt: tokens.session.lastActivityAt,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    },
  });
});

// Per-role isolated logout: clears ONLY the specified or resolved role cookie/session
authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const roleParam = req.body?.role || req.query.role || req.headers['x-buyoll-role'];
  const requestedRole = roleParam ? normalizeRoleValue(String(roleParam)) : undefined;
  let clearedRole: UserRole | undefined = requestedRole;

  await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const auth = await resolveAuthenticatedSession(req, db, {
      touchActivity: false,
      requestedRole,
    });
    if (auth.session) {
      auth.session.revokedAt = now;
      auth.session.revokeReason = 'USER_LOGOUT';
      clearedRole = auth.session.role;
    } else if (requestedRole) {
      // Also check raw cookie in case session was already expired
      const rawCookie = req.cookies?.[ROLE_COOKIE_NAMES[requestedRole]];
      const sid = rawCookie ? verifySessionCookieValue(String(rawCookie)) : null;
      if (sid) {
        const sess = (db.sessions || []).find((s) => s.id === sid);
        if (sess && !sess.revokedAt) {
          sess.revokedAt = now;
          sess.revokeReason = 'USER_LOGOUT';
        }
      }
    }

    const rawRefresh = extractRefreshToken(req);
    if (rawRefresh) {
      const tokenHash = hashOpaqueToken(rawRefresh);
      const rec = (db.refreshTokens || []).find((r) => r.tokenHash === tokenHash);
      if (rec && !rec.revokedAt && (!clearedRole || !auth.user || rec.userId === auth.user.id)) {
        rec.revokedAt = now;
      }
    }
  });

  if (clearedRole) {
    clearRoleSessionCookie(res, clearedRole);
  } else {
    clearAuthCookies(res);
  }
  return res.json({ success: true, loggedOutRole: clearedRole || 'all' });
});

authRouter.post('/auth/logout-all', async (req: Request, res: Response) => {
  const auth = await resolveAuthenticatedSession(req);
  if (!auth.user) {
    return sendApiError(res, 401, auth.errorCode || 'UNAUTHORIZED', 'Authentication required.');
  }
  await runDatabaseTransaction(async (db) => {
    const user = db.users.find((u) => u.id === auth.user!.id);
    const now = Date.now();
    if (user) {
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      for (const s of db.sessions || []) {
        if (s.userId === user.id && !s.revokedAt) {
          s.revokedAt = now;
          s.revokeReason = 'LOGOUT_ALL';
        }
      }
      for (const r of db.refreshTokens || []) {
        if (r.userId === user.id && !r.revokedAt) r.revokedAt = now;
      }
      logAudit(db, user.id, user.name, 'AUTH_LOGOUT_ALL', 'Signed out of all active devices/sessions.');
    }
  });
  clearAuthCookies(res);
  return res.json({ success: true });
});

// ======================================================================
// ADMIN SECURITY SETTINGS & SELF-RECOVERY (Section 3.1)
// ======================================================================
authRouter.get('/admin/settings/security', async (req: Request, res: Response) => {
  const db = await getDatabase();
  const auth = await resolveAuthenticatedSession(req, db, { requestedRole: 'admin' });
  if (!auth.user || !auth.session) {
    return sendApiError(res, 401, auth.errorCode || 'UNAUTHORIZED', auth.errorMessage || 'Authentication required.');
  }
  if (auth.session.role !== 'admin' && auth.user.role !== 'admin') {
    return sendApiError(res, 403, 'FORBIDDEN', 'Administrator access required.');
  }
  const now = Date.now();
  const u = auth.user;
  const dismissed = Boolean(u.securityBannerDismissedAt);
  const snoozed = Boolean(u.securityBannerSnoozedUntil && u.securityBannerSnoozedUntil > now);
  const showSecurityBanner =
    Boolean(u.mustChangeCredentials) || (!dismissed && !snoozed && (!u.lastPasswordChangedAt || !u.lastPasskeyChangedAt));

  return res.json({
    username: u.username,
    email: u.email,
    mustChangeCredentials: Boolean(u.mustChangeCredentials),
    lastPasswordChangedAt: u.lastPasswordChangedAt || null,
    lastPasskeyChangedAt: u.lastPasskeyChangedAt || null,
    securityBannerDismissedAt: u.securityBannerDismissedAt || null,
    securityBannerSnoozedUntil: u.securityBannerSnoozedUntil || null,
    showSecurityBanner,
    recentReauthValid: Boolean(auth.session.lastReauthAt && now - auth.session.lastReauthAt <= RECENT_REAUTH_WINDOW_MS),
  });
});

authRouter.post('/admin/settings/security/dismiss', async (req: Request, res: Response) => {
  const mode = req.body?.mode === 'snooze' ? 'snooze' : 'dismiss';
  const result = await runDatabaseTransaction(async (db) => {
    const auth = await resolveAuthenticatedSession(req, db, { requestedRole: 'admin' });
    if (!auth.user || !auth.session) {
      return { status: 401, code: auth.errorCode || 'UNAUTHORIZED', message: 'Authentication required.' };
    }
    if (auth.session.role !== 'admin' && auth.user.role !== 'admin') {
      return { status: 403, code: 'FORBIDDEN', message: 'Administrator access required.' };
    }
    const now = Date.now();
    if (mode === 'snooze') {
      auth.user.securityBannerSnoozedUntil = now + 7 * 86400000;
    } else {
      auth.user.securityBannerDismissedAt = now;
    }
    return { status: 200, user: auth.user };
  });
  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!);
  }
  return res.json({
    success: true,
    showSecurityBanner: Boolean(result.user!.mustChangeCredentials),
    securityBannerDismissedAt: result.user!.securityBannerDismissedAt || null,
    securityBannerSnoozedUntil: result.user!.securityBannerSnoozedUntil || null,
  });
});

const adminChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  currentPasskey: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(128),
});

authRouter.post('/admin/settings/change-password', async (req: Request, res: Response) => {
  const parsed = adminChangePasswordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }
  const { currentPassword, currentPasskey, newPassword } = parsed.data; // NEVER trim!

  const result = await runDatabaseTransaction(async (db) => {
    const auth = await resolveAuthenticatedSession(req, db, { requestedRole: 'admin' });
    if (!auth.user || !auth.session) {
      return { status: 401, code: auth.errorCode || 'UNAUTHORIZED', message: 'Authentication required.' };
    }
    if (auth.session.role !== 'admin' && auth.user.role !== 'admin') {
      return { status: 403, code: 'FORBIDDEN', message: 'Administrator access required.' };
    }
    const adminUser = auth.user;
    const now = Date.now();
    const withinReauthWindow = Boolean(
      auth.session.lastReauthAt && now - auth.session.lastReauthAt <= RECENT_REAUTH_WINDOW_MS
    );

    if (currentPassword !== undefined && currentPassword !== '') {
      const ok = await verifyPassword(currentPassword, adminUser.password);
      if (!ok) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect.',
          fields: { currentPassword: 'Incorrect current password.' },
        };
      }
    } else if (currentPasskey !== undefined && currentPasskey !== '') {
      const ok = await verifyPasskey(currentPasskey, adminUser.adminPasskeyHash);
      if (!ok) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSKEY',
          message: 'Current security passkey is incorrect.',
          fields: { currentPasskey: 'Incorrect security passkey.' },
        };
      }
    } else if (!withinReauthWindow) {
      return {
        status: 401,
        code: 'REAUTH_REQUIRED',
        message: 'Please enter your current password or security passkey to change the admin password.',
      };
    }

    const evalRes = evaluatePasswordStrength(newPassword, {
      username: adminUser.username,
      name: adminUser.name,
      email: adminUser.email,
    });
    if (!evalRes.valid) {
      return {
        status: 422,
        code: 'WEAK_PASSWORD',
        message: evalRes.error!,
        fields: { newPassword: evalRes.error! },
      };
    }

    adminUser.password = await hashPassword(newPassword);
    adminUser.passwordHmac = computePasswordHmac(newPassword);
    adminUser.lastPasswordChangedAt = now;
    adminUser.mustChangeCredentials = false;
    adminUser.tokenVersion = (adminUser.tokenVersion || 1) + 1;
    auth.session.lastReauthAt = now;

    // Revoke ALL other admin sessions and refresh tokens
    for (const s of db.sessions || []) {
      if (s.userId === adminUser.id && s.id !== auth.session.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'ADMIN_PASSWORD_CHANGED';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === adminUser.id && !rt.revokedAt) {
        rt.revokedAt = now;
      }
    }

    const newAccessToken = createAccessToken(adminUser, auth.session.id, 'admin');
    if (adminUser.email) {
      sendSecurityEmail(db, {
        to: adminUser.email,
        subject: 'Buyoll Admin Password Updated',
        body: `Your Buyoll administrator password for @${adminUser.username} was changed on ${new Date(now).toISOString()}. All other admin sessions have been signed out.`,
        kind: 'credential_changed',
        userId: adminUser.id,
      });
    }
    logAudit(db, adminUser.id, adminUser.name, 'ADMIN_PASSWORD_CHANGED', 'Administrator changed password and revoked other sessions.');
    return { status: 200, user: adminUser, accessToken: newAccessToken, session: auth.session };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }
  setRoleSessionCookie(res, 'admin', result.session!.id);
  return res.json({
    success: true,
    user: sanitizeUser(result.user!),
    accessToken: result.accessToken,
    lastPasswordChangedAt: result.user!.lastPasswordChangedAt,
    message: 'Administrator password updated and all other sessions signed out.',
  });
});

const adminChangePasskeySchema = z.object({
  currentPassword: z.string().optional(),
  currentPasskey: z.string().optional(),
  newPasskey: z.string().min(8, 'New security passkey must be at least 8 characters long.').max(128),
});

authRouter.post('/admin/settings/change-passkey', async (req: Request, res: Response) => {
  const parsed = adminChangePasskeySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }
  const { currentPassword, currentPasskey, newPasskey } = parsed.data; // NEVER trim!

  const result = await runDatabaseTransaction(async (db) => {
    const auth = await resolveAuthenticatedSession(req, db, { requestedRole: 'admin' });
    if (!auth.user || !auth.session) {
      return { status: 401, code: auth.errorCode || 'UNAUTHORIZED', message: 'Authentication required.' };
    }
    if (auth.session.role !== 'admin' && auth.user.role !== 'admin') {
      return { status: 403, code: 'FORBIDDEN', message: 'Administrator access required.' };
    }
    const adminUser = auth.user;
    const now = Date.now();
    const withinReauthWindow = Boolean(
      auth.session.lastReauthAt && now - auth.session.lastReauthAt <= RECENT_REAUTH_WINDOW_MS
    );

    if (currentPasskey !== undefined && currentPasskey !== '') {
      const ok = await verifyPasskey(currentPasskey, adminUser.adminPasskeyHash);
      if (!ok) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSKEY',
          message: 'Current security passkey is incorrect.',
          fields: { currentPasskey: 'Incorrect security passkey.' },
        };
      }
    } else if (currentPassword !== undefined && currentPassword !== '') {
      const ok = await verifyPassword(currentPassword, adminUser.password);
      if (!ok) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect.',
          fields: { currentPassword: 'Incorrect current password.' },
        };
      }
    } else if (!withinReauthWindow) {
      return {
        status: 401,
        code: 'REAUTH_REQUIRED',
        message: 'Please provide your current password or current security passkey.',
      };
    }

    adminUser.adminPasskeyHash = await hashPasskey(newPasskey);
    adminUser.lastPasskeyChangedAt = now;
    adminUser.mustChangeCredentials = false;
    adminUser.tokenVersion = (adminUser.tokenVersion || 1) + 1;
    auth.session.lastReauthAt = now;

    for (const s of db.sessions || []) {
      if (s.userId === adminUser.id && s.id !== auth.session.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'ADMIN_PASSKEY_CHANGED';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === adminUser.id && !rt.revokedAt) {
        rt.revokedAt = now;
      }
    }

    const newAccessToken = createAccessToken(adminUser, auth.session.id, 'admin');
    if (adminUser.email) {
      sendSecurityEmail(db, {
        to: adminUser.email,
        subject: 'Buyoll Admin Security Passkey Rotated',
        body: `Your Buyoll administrator security passkey for @${adminUser.username} was changed on ${new Date(now).toISOString()}. All other admin sessions have been signed out.`,
        kind: 'credential_changed',
        userId: adminUser.id,
      });
    }
    logAudit(db, adminUser.id, adminUser.name, 'ADMIN_PASSKEY_CHANGED', 'Administrator rotated security passkey and revoked other sessions.');
    return { status: 200, user: adminUser, accessToken: newAccessToken, session: auth.session };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }
  setRoleSessionCookie(res, 'admin', result.session!.id);
  return res.json({
    success: true,
    user: sanitizeUser(result.user!),
    accessToken: result.accessToken,
    lastPasskeyChangedAt: result.user!.lastPasskeyChangedAt,
    message: 'Security passkey updated and all other sessions signed out.',
  });
});

// ======================================================================
// ADMIN FORGOT PASSWORD / PASSKEY OTP FLOW
// ======================================================================
authRouter.post('/admin/auth/forgot/start', async (req: Request, res: Response) => {
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Enter your administrator username or email.');
  }

  const devOtp = await runDatabaseTransaction(async (db) => {
    const adminUser = findPlatformAdminUser(db);
    if (!adminUser) return null;
    const norm = normalizeUsername(identifier);
    const lower = identifier.toLowerCase();
    const matches =
      (adminUser.usernameNormalized && adminUser.usernameNormalized === norm) ||
      (adminUser.username && normalizeUsername(adminUser.username) === norm) ||
      (adminUser.email && adminUser.email.toLowerCase() === lower);
    if (!matches) return null;

    if (!db.otpChallenges) db.otpChallenges = [];
    const now = Date.now();
    for (const c of db.otpChallenges) {
      if (c.userId === adminUser.id && c.purpose === 'admin_forgot' && !c.consumedAt) {
        c.consumedAt = now;
      }
    }
    const otp = generateNumericOtp(6);
    const challenge: OtpChallengeRecord = {
      id: `otp_${now}_${crypto.randomBytes(4).toString('hex')}`,
      purpose: 'admin_forgot',
      userId: adminUser.id,
      contact: adminUser.email || SUPPORT_EMAIL,
      codeHash: hashOpaqueToken(otp),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      verifiedAt: null,
      verificationTokenHash: null,
      consumedAt: null,
      createdAt: now,
    };
    db.otpChallenges.unshift(challenge);
    if (db.otpChallenges.length > 300) db.otpChallenges = db.otpChallenges.slice(0, 300);

    sendSecurityEmail(db, {
      to: adminUser.email || SUPPORT_EMAIL,
      subject: 'Buyoll Administrator Recovery Verification Code',
      body: `Your single-use verification code is ${otp}. It expires in 10 minutes.`,
      kind: 'otp',
      userId: adminUser.id,
      meta: { purpose: 'admin_forgot', challengeId: challenge.id },
    });
    logAudit(db, adminUser.id, adminUser.name, 'ADMIN_RECOVERY_OTP_ISSUED', 'Issued OTP for administrator credential recovery.');
    return otp;
  });

  const payload: Record<string, any> = {
    success: true,
    message: 'If the administrator details match our records, a 6-digit verification code has been sent to the registered email.',
  };
  if (IS_TEST_MODE() && devOtp) {
    payload.devOtp = devOtp;
  }
  return res.json(payload);
});

authRouter.post('/admin/auth/forgot/verify', async (req: Request, res: Response) => {
  const identifier = String(req.body?.identifier || '').trim();
  const otp = String(req.body?.otp || '').trim();
  if (!identifier || !otp) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Identifier and 6-digit OTP are required.');
  }

  const outcome = await runDatabaseTransaction(async (db) => {
    const adminUser = findPlatformAdminUser(db);
    if (!adminUser) return { status: 400, code: 'INVALID_OTP', message: 'Invalid or expired verification code.' };
    const norm = normalizeUsername(identifier);
    const lower = identifier.toLowerCase();
    const matches =
      (adminUser.usernameNormalized && adminUser.usernameNormalized === norm) ||
      (adminUser.username && normalizeUsername(adminUser.username) === norm) ||
      (adminUser.email && adminUser.email.toLowerCase() === lower);
    if (!matches) return { status: 400, code: 'INVALID_OTP', message: 'Invalid or expired verification code.' };

    const now = Date.now();
    const challenge = (db.otpChallenges || []).find(
      (c) => c.userId === adminUser.id && c.purpose === 'admin_forgot' && !c.consumedAt
    );
    if (!challenge || challenge.expiresAt < now || challenge.attempts >= challenge.maxAttempts) {
      return { status: 400, code: 'OTP_EXPIRED', message: 'Verification code is invalid, expired, or has exceeded max attempts.' };
    }

    const suppliedHash = hashOpaqueToken(otp);
    const a = Buffer.from(suppliedHash);
    const b = Buffer.from(challenge.codeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      challenge.attempts += 1;
      return {
        status: 400,
        code: 'INVALID_OTP',
        message: `Incorrect verification code (${Math.max(0, challenge.maxAttempts - challenge.attempts)} attempt(s) remaining).`,
      };
    }

    const rawVerificationToken = crypto.randomBytes(24).toString('hex');
    challenge.verifiedAt = now;
    challenge.verificationTokenHash = hashOpaqueToken(rawVerificationToken);
    return { status: 200, verificationToken: rawVerificationToken };
  });

  if (outcome.status !== 200) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
  }
  return res.json({ success: true, verificationToken: outcome.verificationToken });
});

authRouter.post('/admin/auth/forgot/reset', async (req: Request, res: Response) => {
  const token = String(req.body?.verificationToken || '').trim();
  const newPassword = req.body?.newPassword; // NEVER trim
  const newPasskey = req.body?.newPasskey; // NEVER trim

  if (!token) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Verification token is required.');
  }
  if (!newPassword && !newPasskey) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Provide a new password and/or new security passkey.');
  }
  if (newPasskey !== undefined && String(newPasskey).length < 8) {
    return sendApiError(res, 422, 'WEAK_PASSKEY', 'Security passkey must be at least 8 characters long.');
  }

  const tokenHash = hashOpaqueToken(token);
  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const challenge = (db.otpChallenges || []).find(
      (c) => c.purpose === 'admin_forgot' && !c.consumedAt && c.verificationTokenHash === tokenHash
    );
    if (!challenge || challenge.expiresAt < now || !challenge.userId) {
      return { status: 400, code: 'INVALID_RESET_TOKEN', message: 'Recovery token is invalid or has expired.' };
    }
    const adminUser = db.users.find((u) => u.id === challenge.userId && !u.isDisabled);
    if (!adminUser) {
      return { status: 404, code: 'USER_NOT_FOUND', message: 'Administrator account not found.' };
    }

    if (newPassword !== undefined) {
      const pwEval = evaluatePasswordStrength(String(newPassword), {
        username: adminUser.username,
        name: adminUser.name,
        email: adminUser.email,
      });
      if (!pwEval.valid) {
        return { status: 422, code: 'WEAK_PASSWORD', message: pwEval.error! };
      }
      adminUser.password = await hashPassword(String(newPassword));
      adminUser.passwordHmac = computePasswordHmac(String(newPassword));
      adminUser.lastPasswordChangedAt = now;
    }

    if (newPasskey !== undefined) {
      adminUser.adminPasskeyHash = await hashPasskey(String(newPasskey));
      adminUser.lastPasskeyChangedAt = now;
    }

    challenge.consumedAt = now;
    adminUser.failedLoginCount = 0;
    adminUser.lockedUntil = null;
    adminUser.mustChangeCredentials = false;
    adminUser.tokenVersion = (adminUser.tokenVersion || 1) + 1;
    clearUserLoginBuckets(adminUser);

    for (const s of db.sessions || []) {
      if (s.userId === adminUser.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'ADMIN_RECOVERY_RESET';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === adminUser.id && !rt.revokedAt) rt.revokedAt = now;
    }

    if (adminUser.email) {
      sendSecurityEmail(db, {
        to: adminUser.email,
        subject: 'Buyoll Admin Credentials Reset Completed',
        body: `Your Buyoll administrator credentials for @${adminUser.username} were reset via OTP recovery. All prior sessions have been signed out.`,
        kind: 'credential_changed',
        userId: adminUser.id,
      });
    }
    logAudit(db, adminUser.id, adminUser.name, 'ADMIN_RECOVERY_COMPLETED', 'Administrator reset credentials via verified OTP.');
    return { status: 200 };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!);
  }
  return res.json({
    success: true,
    message: 'Administrator credentials updated. You can now sign in with your new credentials.',
  });
});

// Helper to match non-admin user by email, E.164/local phone, or username
function findRecoveryTargetUser(db: any, identifier: string, allowUsername: boolean): User | undefined {
  const clean = identifier.trim();
  const lower = clean.toLowerCase();
  const isEmail = clean.includes('@');
  const isPhone = !isEmail && looksLikePhoneNumber(clean);
  const normPhone = isPhone ? normalizeEastAfricanPhone(clean).normalized : null;
  const normUn = normalizeUsername(clean);

  return (db.users || []).find((u: User) => {
    if (u.isDisabled || u.role === 'admin') return false;
    if (isEmail) {
      return Boolean(u.email && u.email.trim().toLowerCase() === lower);
    }
    if (isPhone) {
      if (normPhone) {
        if (u.phoneNormalized && u.phoneNormalized === normPhone) return true;
        if (u.phone) {
          const p = normalizeEastAfricanPhone(u.phone);
          if (p.valid && p.normalized === normPhone) return true;
        }
      }
      return Boolean(u.phone && u.phone.trim() === clean);
    }
    if (!allowUsername) return false;
    return (
      (u.usernameLower && u.usernameLower === lower) ||
      (u.usernameNormalized && u.usernameNormalized === normUn) ||
      (u.username && normalizeUsername(u.username) === normUn)
    );
  });
}

// ======================================================================
// USER FORGOT PASSWORD / FORGOT USERNAME FLOWS (15-min hashed tokens + SMS/Email)
// ======================================================================
authRouter.post('/auth/forgot/start', async (req: Request, res: Response) => {
  const purpose: 'forgot_password' | 'forgot_username' =
    req.body?.type === 'forgot_username' || req.body?.purpose === 'forgot_username'
      ? 'forgot_username'
      : 'forgot_password';
  const identifier = String(req.body?.identifier || req.body?.contact || '').trim();
  if (!identifier) {
    return sendApiError(
      res,
      422,
      'VALIDATION_ERROR',
      purpose === 'forgot_username'
        ? 'Enter your registered email address or phone number.'
        : 'Enter your username, email, or phone number.'
    );
  }

  const clientIp = getClientIp(req);
  const normPhone = looksLikePhoneNumber(identifier) ? normalizeEastAfricanPhone(identifier).normalized : null;
  const contactKey = (normPhone || identifier).toLowerCase();

  const ipCheck = checkAndRecordSlidingWindow(`rec_ip:${clientIp}`, RECOVERY_MAX_PER_IP, RECOVERY_WINDOW_MS);
  if (!ipCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many recovery requests. Try again in ${ipCheck.waitMinutes} minute(s).`);
  }
  const contactCheck = checkAndRecordSlidingWindow(`rec_${purpose}:${contactKey}`, RECOVERY_MAX_PER_CONTACT, RECOVERY_WINDOW_MS);
  if (!contactCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many recovery attempts for this contact. Try again in ${contactCheck.waitMinutes} minute(s).`);
  }

  const outcome = await runDatabaseTransaction(async (db) => {
    const user = findRecoveryTargetUser(db, identifier, purpose === 'forgot_password');
    if (!user) return null;

    if (!db.otpChallenges) db.otpChallenges = [];
    const now = Date.now();
    for (const c of db.otpChallenges) {
      if (c.userId === user.id && c.purpose === purpose && !c.consumedAt) {
        c.consumedAt = now;
      }
    }

    const otp = generateNumericOtp(6);
    const challenge: OtpChallengeRecord = {
      id: `otp_${now}_${crypto.randomBytes(4).toString('hex')}`,
      purpose,
      userId: user.id,
      contact: user.email || user.phoneNormalized || user.phone || contactKey,
      codeHash: hashOpaqueToken(otp),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      verifiedAt: null,
      verificationTokenHash: null,
      consumedAt: null,
      createdAt: now,
    };
    db.otpChallenges.unshift(challenge);
    if (db.otpChallenges.length > 300) db.otpChallenges = db.otpChallenges.slice(0, 300);

    const subject = purpose === 'forgot_username' ? 'Buyoll Username Recovery Code' : 'Buyoll Password Reset Code';
    const msgBody = `Your 6-digit Buyoll verification code is ${otp}. It expires in 15 minutes.`;

    if (user.email || user.phone) {
      sendSecurityEmail(db, {
        to: user.email || user.phone!,
        subject,
        body: msgBody,
        kind: 'otp',
        userId: user.id,
        meta: { purpose, challengeId: challenge.id },
      });
    }

    logAudit(db, user.id, user.name, 'AUTH_RECOVERY_OTP_ISSUED', `Issued ${purpose} OTP for user #${user.id}.`);
    return {
      otp,
      challengeId: challenge.id,
      email: user.email,
      phone: user.phoneNormalized || user.phone,
      preferSms: looksLikePhoneNumber(identifier),
    };
  });

  if (outcome) {
    await dispatchContactNotification({
      email: outcome.email,
      phone: outcome.phone,
      preferChannel: outcome.preferSms ? 'sms' : 'email',
      subject: purpose === 'forgot_username' ? 'Buyoll Username Recovery Code' : 'Buyoll Password Reset Code',
      body: `Your 6-digit Buyoll verification code is ${outcome.otp}. It expires in 15 minutes.`,
    });
  }

  const payload: Record<string, any> = {
    success: true,
    purpose,
    mode: FORGOT_USERNAME_MODE,
    message: "If an account exists for that contact, we've sent verification instructions.",
  };
  if (IS_TEST_MODE() && outcome?.otp) {
    payload.devOtp = outcome.otp;
    payload.challengeId = outcome.challengeId;
  }
  return res.json(payload);
});

authRouter.post('/auth/forgot/verify', async (req: Request, res: Response) => {
  const purpose: 'forgot_password' | 'forgot_username' =
    req.body?.type === 'forgot_username' || req.body?.purpose === 'forgot_username'
      ? 'forgot_username'
      : 'forgot_password';
  const identifier = String(req.body?.identifier || req.body?.contact || '').trim();
  const otp = String(req.body?.otp || '').trim();
  if (!identifier || !otp) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Identifier and 6-digit OTP code are required.');
  }

  const outcome = await runDatabaseTransaction(async (db) => {
    const user = findRecoveryTargetUser(db, identifier, purpose === 'forgot_password');
    if (!user) return { status: 400, code: 'INVALID_OTP', message: 'Invalid or expired verification code.' };

    const now = Date.now();
    const challenge = (db.otpChallenges || []).find(
      (c) => c.userId === user.id && c.purpose === purpose && !c.consumedAt
    );
    if (!challenge || challenge.expiresAt < now || challenge.attempts >= challenge.maxAttempts) {
      return { status: 400, code: 'OTP_EXPIRED', message: 'Verification code is invalid, expired, or exceeded max attempts.' };
    }

    const suppliedHash = hashOpaqueToken(otp);
    const a = Buffer.from(suppliedHash);
    const b = Buffer.from(challenge.codeHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      challenge.attempts += 1;
      return {
        status: 400,
        code: 'INVALID_OTP',
        message: `Incorrect verification code (${Math.max(0, challenge.maxAttempts - challenge.attempts)} attempt(s) remaining).`,
      };
    }

    const rawVerificationToken = crypto.randomBytes(24).toString('hex');
    challenge.verifiedAt = now;
    challenge.verificationTokenHash = hashOpaqueToken(rawVerificationToken);

    if (purpose === 'forgot_username' && FORGOT_USERNAME_MODE === 'send_existing') {
      challenge.consumedAt = now;
      const usernameToDeliver = user.usernameDisplay || user.username || '';
      sendSecurityEmail(db, {
        to: user.email || user.phone || '',
        subject: 'Your Buyoll Username Reminder',
        body: `Your Buyoll username is: ${usernameToDeliver}`,
        kind: 'otp',
        userId: user.id,
      });
      return {
        status: 200,
        mode: 'send_existing',
        sentExisting: true,
        email: user.email,
        phone: user.phoneNormalized || user.phone,
        deliverUsername: usernameToDeliver,
        username: IS_TEST_MODE() ? user.username : undefined,
        message: 'If an account exists for that contact, your username has been sent to your registered email or phone.',
      };
    }

    return {
      status: 200,
      mode: FORGOT_USERNAME_MODE,
      verificationToken: rawVerificationToken,
    };
  });

  if (outcome.status !== 200) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
  }
  if ((outcome as any).deliverUsername) {
    await dispatchContactNotification({
      email: (outcome as any).email,
      phone: (outcome as any).phone,
      preferChannel: looksLikePhoneNumber(identifier) ? 'sms' : 'email',
      subject: 'Your Buyoll Username Reminder',
      body: `Your Buyoll username is: ${(outcome as any).deliverUsername}`,
    });
  }
  const { deliverUsername: _du, email: _em, phone: _ph, ...safeOutcome } = outcome as any;
  return res.json({ success: true, ...safeOutcome });
});

authRouter.post('/auth/forgot/reset-password', async (req: Request, res: Response) => {
  const token = String(req.body?.verificationToken || req.body?.token || '').trim();
  const newPassword = req.body?.newPassword; // NEVER trim!
  if (!token || !newPassword) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Verification token and new password are required.');
  }

  const tokenHash = hashOpaqueToken(token);
  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const challenge = (db.otpChallenges || []).find(
      (c) => c.purpose === 'forgot_password' && !c.consumedAt && c.verificationTokenHash === tokenHash
    );
    if (!challenge || challenge.expiresAt < now || !challenge.userId) {
      return { status: 400, code: 'INVALID_RESET_TOKEN', message: 'Verification token is invalid or has expired.' };
    }

    const user = db.users.find((u) => u.id === challenge.userId && !u.isDisabled);
    if (!user) return { status: 404, code: 'USER_NOT_FOUND', message: 'User account not found.' };

    const pwEval = evaluatePasswordStrength(String(newPassword), {
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone || undefined,
    });
    if (!pwEval.valid) {
      return { status: 422, code: 'WEAK_PASSWORD', message: pwEval.error!, fields: { newPassword: pwEval.error! } };
    }
    if (isPasswordReusedGlobally(db, String(newPassword), user.id)) {
      return { status: 422, code: 'PASSWORD_NOT_ALLOWED', message: 'Please choose a different password.' };
    }

    challenge.consumedAt = now;
    user.password = await hashPassword(String(newPassword));
    user.passwordHmac = computePasswordHmac(String(newPassword));
    user.lastPasswordChangedAt = now;
    user.updatedAt = now;
    user.mustResetPassword = false;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.tokenVersion = (user.tokenVersion || 1) + 1;
    clearUserLoginBuckets(user);

    for (const s of db.sessions || []) {
      if (s.userId === user.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'PASSWORD_RESET';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === user.id && !rt.revokedAt) rt.revokedAt = now;
    }

    if (user.email) {
      sendSecurityEmail(db, {
        to: user.email,
        subject: 'Your Buyoll Password Was Reset',
        body: `Your Buyoll password for @${user.username} was changed on ${new Date(now).toISOString()}. If this wasn't you, contact support immediately.`,
        kind: 'credential_changed',
        userId: user.id,
      });
    }
    logAudit(db, user.id, user.name, 'AUTH_PASSWORD_RESET_COMPLETED', 'Password reset via OTP verification.');
    return { status: 200, email: user.email, phone: user.phoneNormalized || user.phone, username: user.username };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }
  await dispatchContactNotification({
    email: result.email,
    phone: result.phone,
    subject: 'Your Buyoll Password Was Changed',
    body: `Your Buyoll password for @${result.username} was changed successfully. All active sessions were signed out.`,
  });
  return res.json({
    success: true,
    message: 'Your password has been updated. You can now log in with your new password.',
  });
});

authRouter.post('/auth/forgot/reset-username', async (req: Request, res: Response) => {
  const token = String(req.body?.verificationToken || '').trim();
  const newUsernameRaw = String(req.body?.newUsername || '').trim();
  if (!token || !newUsernameRaw) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Verification token and new username are required.');
  }
  if (!isValidStrictUsername(newUsernameRaw)) {
    return sendApiError(
      res,
      422,
      'INVALID_USERNAME',
      'Username must be 3–30 characters (letters, numbers, dots, or underscores).',
      { newUsername: 'Use 3–30 letters, numbers, ".", or "_".' }
    );
  }

  const displayCopy = newUsernameRaw.normalize('NFKC').trim();
  const cleanUsername = displayCopy.toLowerCase();
  const norm = normalizeUsername(cleanUsername);
  const tokenHash = hashOpaqueToken(token);

  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const challenge = (db.otpChallenges || []).find(
      (c) => c.purpose === 'forgot_username' && !c.consumedAt && c.verificationTokenHash === tokenHash
    );
    if (!challenge || challenge.expiresAt < now || !challenge.userId) {
      return { status: 400, code: 'INVALID_RESET_TOKEN', message: 'Verification token is invalid or has expired.' };
    }
    const user = db.users.find((u) => u.id === challenge.userId && !u.isDisabled);
    if (!user) return { status: 404, code: 'USER_NOT_FOUND', message: 'User account not found.' };

    const conflict = db.users.some(
      (u) =>
        u.id !== user.id &&
        ((u.usernameLower && u.usernameLower === cleanUsername) ||
          (u.usernameNormalized && u.usernameNormalized === norm) ||
          (u.username && normalizeUsername(u.username) === norm))
    );
    if (conflict) {
      return {
        status: 409,
        code: 'USERNAME_TAKEN',
        message: 'That username is not available. Please choose a different one.',
        fields: { newUsername: 'That username is not available. Please choose a different one.' },
      };
    }

    const oldUsername = user.username;
    challenge.consumedAt = now;
    user.username = cleanUsername;
    user.usernameDisplay = displayCopy;
    user.usernameLower = cleanUsername;
    user.usernameNormalized = norm;
    user.updatedAt = now;
    if (user.email) {
      sendSecurityEmail(db, {
        to: user.email,
        subject: 'Your Buyoll Username Was Updated',
        body: `Your Buyoll username was updated from "${oldUsername}" to "${cleanUsername}".`,
        kind: 'credential_changed',
        userId: user.id,
      });
    }
    logAudit(db, user.id, user.name, 'AUTH_USERNAME_RESET', `Username updated from @${oldUsername} to @${cleanUsername} via OTP.`);
    return { status: 200, username: cleanUsername };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }
  return res.json({
    success: true,
    username: result.username,
    message: 'Your username has been updated. You can now log in with your new username.',
  });
});

// ======================================================================
// DIRECT FORGOT PASSWORD, RESET PASSWORD (15-min LINK + CODE), & FORGOT USERNAME
// ======================================================================
const forgotLegacySchema = z.object({
  identifier: z.string().trim().min(2, 'Please enter your email address, phone number, or username.').optional(),
  contact: z.string().trim().min(2).optional(),
});

authRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  const parsed = forgotLegacySchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const rawContact = (parsed.data.identifier || parsed.data.contact || '').trim();
  if (!rawContact) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Please enter your email address, phone number, or username.');
  }

  const clientIp = getClientIp(req);
  const normPhone = looksLikePhoneNumber(rawContact) ? normalizeEastAfricanPhone(rawContact).normalized : null;
  const contactKey = (normPhone || rawContact).toLowerCase();

  const ipCheck = checkAndRecordSlidingWindow(`rec_ip:${clientIp}`, RECOVERY_MAX_PER_IP, RECOVERY_WINDOW_MS);
  if (!ipCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many reset requests. Please try again in ${ipCheck.waitMinutes} minute(s).`);
  }
  const contactCheck = checkAndRecordSlidingWindow(`rec_fp:${contactKey}`, RECOVERY_MAX_PER_CONTACT, RECOVERY_WINDOW_MS);
  if (!contactCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many password reset requests for this contact. Please try again in ${contactCheck.waitMinutes} minute(s).`);
  }

  const issued = await runDatabaseTransaction(async (db) => {
    const user = findRecoveryTargetUser(db, rawContact, true);
    if (!user) return null;

    if (!db.passwordResets) db.passwordResets = [];
    const now = Date.now();
    for (const r of db.passwordResets) {
      if (r.userId === user.id && !r.usedAt) r.usedAt = now;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const otpCode = generateNumericOtp(6);
    db.passwordResets.unshift({
      id: `pr_${now}_${crypto.randomBytes(3).toString('hex')}`,
      userId: user.id,
      tokenHash: hashOpaqueToken(rawToken),
      codeHash: hashOpaqueToken(otpCode),
      contact: user.email || user.phoneNormalized || user.phone || contactKey,
      expiresAt: now + RESET_TOKEN_TTL_MS,
      usedAt: null,
      createdAt: now,
    });
    if (db.passwordResets.length > 200) db.passwordResets = db.passwordResets.slice(0, 200);

    const resetUrl = buildResetLink(rawToken);
    if (user.email || user.phone) {
      sendSecurityEmail(db, {
        to: user.email || user.phone!,
        subject: 'Buyoll Password Reset Instructions',
        body: `Use code ${otpCode} or open ${resetUrl} to reset your password. This link and code expire in 15 minutes.`,
        kind: 'otp',
        userId: user.id,
      });
    }
    logAudit(db, user.id, user.name, 'AUTH_PASSWORD_RESET_REQUESTED', `Password reset token issued for user #${user.id}.`);
    return {
      rawToken,
      otpCode,
      resetUrl,
      email: user.email,
      phone: user.phoneNormalized || user.phone,
      preferSms: looksLikePhoneNumber(rawContact),
    };
  });

  if (issued) {
    await dispatchContactNotification({
      email: issued.email,
      phone: issued.phone,
      preferChannel: issued.preferSms ? 'sms' : 'email',
      subject: 'Buyoll Password Reset Instructions',
      body: `Your Buyoll password reset code is ${issued.otpCode} (valid for 15 minutes). Or open: ${issued.resetUrl}`,
    });
  }

  const payload: Record<string, any> = {
    success: true,
    message: "If an account exists for that contact, we've sent reset instructions.",
  };
  if (IS_TEST_MODE() && issued) {
    payload.devResetToken = issued.rawToken;
    payload.devOtp = issued.otpCode;
  }
  return res.json(payload);
});

const resetPasswordSchema = z.object({
  token: z.string().trim().optional(),
  identifier: z.string().trim().optional(),
  contact: z.string().trim().optional(),
  code: z.string().trim().optional(),
  otp: z.string().trim().optional(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
  confirmPassword: z.string().optional(),
});

authRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  const parsed = resetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  if (parsed.data.confirmPassword !== undefined && parsed.data.confirmPassword !== parsed.data.newPassword) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Passwords do not match.', {
      confirmPassword: 'Passwords do not match.',
    });
  }

  const rawToken = (parsed.data.token || '').trim();
  const rawCode = (parsed.data.code || parsed.data.otp || '').trim();
  const rawContact = (parsed.data.identifier || parsed.data.contact || '').trim();

  if (!rawToken && !rawCode) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Provide a valid reset token or 6-digit verification code.');
  }
  if (rawToken && rawToken.length < 16) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Invalid or malformed reset token.');
  }

  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    let rec: any = null;
    if (rawToken) {
      const tokenHash = hashOpaqueToken(rawToken);
      rec = (db.passwordResets || []).find((r) => r.tokenHash === tokenHash);
    } else if (rawCode) {
      const codeHash = hashOpaqueToken(rawCode);
      const targetUser = rawContact ? findRecoveryTargetUser(db, rawContact, true) : undefined;
      rec = (db.passwordResets || []).find(
        (r) =>
          r.codeHash === codeHash &&
          !r.usedAt &&
          (!targetUser || r.userId === targetUser.id)
      );
    }

    if (!rec || rec.usedAt || rec.expiresAt < now) {
      return { status: 400, code: 'INVALID_RESET_TOKEN', message: 'This password reset link or code is invalid or has expired.' };
    }
    const user = db.users.find((u) => u.id === rec.userId && !u.isDisabled);
    if (!user) return { status: 404, code: 'USER_NOT_FOUND', message: 'Associated user account could not be found.' };

    const pwEval = evaluatePasswordStrength(parsed.data.newPassword, {
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone || undefined,
    });
    if (!pwEval.valid) {
      return { status: 422, code: 'WEAK_PASSWORD', message: pwEval.error!, fields: { newPassword: pwEval.error! } };
    }

    rec.usedAt = now;
    user.password = await hashPassword(parsed.data.newPassword);
    user.passwordHmac = computePasswordHmac(parsed.data.newPassword);
    user.lastPasswordChangedAt = now;
    user.updatedAt = now;
    user.mustResetPassword = false;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.tokenVersion = (user.tokenVersion || 1) + 1;
    clearUserLoginBuckets(user);

    for (const s of db.sessions || []) {
      if (s.userId === user.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'PASSWORD_RESET';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === user.id && !rt.revokedAt) rt.revokedAt = now;
    }

    if (user.email) {
      sendSecurityEmail(db, {
        to: user.email,
        subject: 'Your Buyoll Password Was Changed',
        body: `Your Buyoll password for @${user.username} was changed successfully. All active sessions have been signed out.`,
        kind: 'credential_changed',
        userId: user.id,
      });
    }
    logAudit(db, user.id, user.name, 'AUTH_PASSWORD_RESET_COMPLETED', 'Password reset and prior sessions invalidated.');
    return { status: 200, email: user.email, phone: user.phoneNormalized || user.phone, username: user.username };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }

  await dispatchContactNotification({
    email: result.email,
    phone: result.phone,
    subject: 'Your Buyoll Password Was Changed',
    body: `Your Buyoll password for @${result.username} was changed on ${new Date().toISOString()}. If this wasn't you, contact support immediately.`,
  });

  return res.json({ success: true, message: 'Your password has been updated. You can now log in with your new password.' });
});

authRouter.post('/auth/forgot-username', async (req: Request, res: Response) => {
  const rawContact = String(req.body?.contact || req.body?.identifier || '').trim();
  if (!rawContact) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Please enter your registered email address or phone number.', {
      contact: 'Email or phone number is required.',
    });
  }

  const clientIp = getClientIp(req);
  const normPhone = looksLikePhoneNumber(rawContact) ? normalizeEastAfricanPhone(rawContact).normalized : null;
  const contactKey = (normPhone || rawContact).toLowerCase();

  const ipCheck = checkAndRecordSlidingWindow(`rec_ip:${clientIp}`, RECOVERY_MAX_PER_IP, RECOVERY_WINDOW_MS);
  if (!ipCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many recovery requests. Please try again in ${ipCheck.waitMinutes} minute(s).`);
  }
  const contactCheck = checkAndRecordSlidingWindow(`rec_fu:${contactKey}`, RECOVERY_MAX_PER_CONTACT, RECOVERY_WINDOW_MS);
  if (!contactCheck.allowed) {
    return sendApiError(res, 429, 'RATE_LIMITED', `Too many username recovery requests for this contact. Try again in ${contactCheck.waitMinutes} minute(s).`);
  }

  const lookup = await runDatabaseTransaction(async (db) => {
    const user = findRecoveryTargetUser(db, rawContact, false);
    if (!user) return null;
    const usernameValue = user.usernameDisplay || user.username || '';
    if (!usernameValue) return null;

    if (user.email || user.phone) {
      sendSecurityEmail(db, {
        to: user.email || user.phone!,
        subject: 'Your Buyoll Username',
        body: `Your registered Buyoll username is: ${usernameValue}`,
        kind: 'otp',
        userId: user.id,
      });
    }
    logAudit(db, user.id, user.name, 'AUTH_USERNAME_REMINDER_SENT', `Username reminder dispatched to registered contact.`);
    return {
      usernameValue,
      email: user.email,
      phone: user.phoneNormalized || user.phone,
      preferSms: looksLikePhoneNumber(rawContact),
    };
  });

  if (lookup) {
    await dispatchContactNotification({
      email: lookup.email,
      phone: lookup.phone,
      preferChannel: lookup.preferSms ? 'sms' : 'email',
      subject: 'Your Buyoll Username Reminder',
      body: `Hello! Your registered Buyoll username is: ${lookup.usernameValue}`,
    });
  }

  // Strictly neutral response — NEVER expose the username in API JSON or browser UI
  return res.json({
    success: true,
    message: "If an account exists for that contact, we've sent your username to your registered email or phone.",
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(128),
});

authRouter.post('/auth/change-password', async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error, 422);

  const result = await runDatabaseTransaction(async (db) => {
    const auth = await resolveAuthenticatedSession(req, db, { touchActivity: true });
    if (!auth.user || !auth.session) {
      return { status: 401, code: auth.errorCode || 'UNAUTHORIZED', message: 'Authentication required.' };
    }
    const user = auth.user;
    if (user.password) {
      if (!parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, user.password))) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect.',
          fields: { currentPassword: 'Incorrect current password.' },
        };
      }
    }

    const pwEval = evaluatePasswordStrength(parsed.data.newPassword, {
      username: user.username,
      name: user.name,
      email: user.email,
      phone: user.phone || undefined,
    });
    if (!pwEval.valid) {
      return { status: 422, code: 'WEAK_PASSWORD', message: pwEval.error!, fields: { newPassword: pwEval.error! } };
    }
    if (isPasswordReusedGlobally(db, parsed.data.newPassword, user.id)) {
      return { status: 422, code: 'PASSWORD_NOT_ALLOWED', message: 'Please choose a different password.' };
    }

    const now = Date.now();
    user.password = await hashPassword(parsed.data.newPassword);
    user.passwordHmac = computePasswordHmac(parsed.data.newPassword);
    user.lastPasswordChangedAt = now;
    user.tokenVersion = (user.tokenVersion || 1) + 1;

    for (const s of db.sessions || []) {
      if (s.userId === user.id && s.id !== auth.session.id && !s.revokedAt) {
        s.revokedAt = now;
        s.revokeReason = 'PASSWORD_CHANGED';
      }
    }
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === user.id && !rt.revokedAt) rt.revokedAt = now;
    }

    const activeRole = normalizeRoleValue(auth.session.role || user.activeRole || user.role);
    const tokens = issueAuthTokensForUser(db, user, true, req, activeRole);
    syncUserRoleAndWallet(user);
    logAudit(db, user.id, user.name, 'AUTH_PASSWORD_CHANGED', 'User changed account password.');
    return { status: 200, user, activeRole, tokens };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }

  const { user, activeRole, tokens } = result as any;
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt, activeRole, tokens.session.id);
  return res.json({
    success: true,
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});
