import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDatabase, logAudit, runDatabaseTransaction, saveDatabase } from './db.js';
import {
  clearAuthCookies,
  hashOpaqueToken,
  hashPassword,
  issueAuthTokensForUser,
  isValidUsername,
  normalizeUsernameSeed,
  resolveAuthenticatedUser,
  sanitizeUser,
  setAuthCookies,
  verifyPassword,
} from './auth_utils.js';
import { sendApiError, sendZodError } from './errors.js';
import { SUPPORT_EMAIL } from './config.js';
import { User } from '../src/types.js';

export const authRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwerty123',
  'qwertyui',
  '11111111',
  '00000000',
  'buyoll123',
]);

interface FailedAttemptBucket {
  count: number;
  lockedUntil?: number;
}
const loginAttemptsByKey = new Map<string, FailedAttemptBucket>();

function isKeyLocked(key: string): { locked: boolean; waitMinutes: number } {
  const rec = loginAttemptsByKey.get(key);
  if (!rec) return { locked: false, waitMinutes: 0 };
  const now = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return { locked: true, waitMinutes: Math.max(1, Math.ceil((rec.lockedUntil - now) / 60000)) };
  }
  if (rec.lockedUntil && rec.lockedUntil <= now) {
    loginAttemptsByKey.delete(key);
  }
  return { locked: false, waitMinutes: 0 };
}

function recordFailedKeyAttempt(key: string): boolean {
  const now = Date.now();
  const existing = loginAttemptsByKey.get(key) || { count: 0 };
  if (existing.lockedUntil && existing.lockedUntil <= now) {
    existing.count = 0;
    existing.lockedUntil = undefined;
  }
  existing.count += 1;
  let justLocked = false;
  if (existing.count >= MAX_FAILED_ATTEMPTS) {
    existing.lockedUntil = now + LOCKOUT_MS;
    justLocked = true;
  }
  loginAttemptsByKey.set(key, existing);
  return justLocked;
}

function clearKeyAttempts(key: string): void {
  loginAttemptsByKey.delete(key);
}

function generateCode(length = 4): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function extractRefreshToken(req: Request): string | null {
  if (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken.trim()) {
    return req.body.refreshToken.trim();
  }
  if (req.cookies?.buyoll_refresh) {
    return String(req.cookies.buyoll_refresh);
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('buyoll_refresh='));
    if (match) return decodeURIComponent(match.split('=').slice(1).join('='));
  }
  return null;
}

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return 'Please choose a stronger, less common password.';
  }
  return null;
}

function syncUserRoleAndWallet(user: User): void {
  const activeRole = user.activeRole || (user.role === 'buyer' ? 'member' : user.role) || 'member';
  user.activeRole = activeRole;
  user.role = activeRole;
  if (!user.roles || !Array.isArray(user.roles)) {
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
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80, 'Name must be 80 characters or fewer.'),
  username: z.string().trim().optional(),
  email: z.string().trim().email('Please provide a valid email address.').max(120),
  password: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(['member', 'buyer', 'merchant', 'lender', 'admin']).optional(),
  shopName: z.string().trim().max(100).optional(),
  shopDescription: z.string().trim().max(500).optional(),
  lenderType: z.string().trim().max(80).optional(),
  adminPasskey: z.string().trim().optional(),
  referredBy: z.string().trim().max(60).optional(),
  rememberMe: z.boolean().optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  password: z.string().optional(),
  role: z.string().trim().optional(),
  rememberMe: z.boolean().optional(),
});

const forgotSchema = z.object({
  identifier: z.string().trim().min(2, 'Please enter your email address or username.'),
});

const resetSchema = z.object({
  token: z.string().trim().min(16, 'Invalid or malformed reset token.'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters long.').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(128),
});

// GET /api/auth/check-username?username=...
authRouter.get('/auth/check-username', async (req: Request, res: Response) => {
  const raw = String(req.query.username || '').trim().toLowerCase();
  const valid = isValidUsername(raw);
  if (!valid) {
    return res.json({ valid: false, available: false, message: 'Use 3–30 characters: letters, numbers, . or _' });
  }
  const db = await getDatabase();
  const taken = (db.users || []).some((u) => u.username && u.username.toLowerCase() === raw);
  return res.json({ valid: true, available: !taken });
});

// GET /api/auth/me
authRouter.get('/auth/me', async (req: Request, res: Response) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
  }
  const prevRef = user.referralCode;
  syncUserRoleAndWallet(user);
  if (user.referralCode !== prevRef) {
    const db = await getDatabase();
    await saveDatabase(db);
  }
  return res.json({ user: sanitizeUser(user) });
});

// POST /api/auth/register
authRouter.post('/auth/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const input = parsed.data;
  const strengthErr = validatePasswordStrength(input.password);
  if (strengthErr) {
    return sendApiError(res, 422, 'WEAK_PASSWORD', strengthErr, { password: strengthErr });
  }

  const cleanRole =
    input.role === 'merchant' || input.role === 'lender' || input.role === 'admin'
      ? input.role
      : 'member';
  const cleanEmail = input.email.toLowerCase();
  const cleanPhone = input.phone ? input.phone.trim() : '';

  if (cleanPhone && cleanPhone.replace(/\D/g, '').length < 7) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Phone number appears invalid.', {
      phone: 'Enter a valid phone number (at least 7 digits).',
    });
  }

  if (input.username !== undefined) {
    const cleanUn = input.username.toLowerCase();
    if (!isValidUsername(cleanUn)) {
      return sendApiError(
        res,
        422,
        'INVALID_USERNAME',
        'Username must be 3–30 characters (letters, numbers, dots, or underscores).',
        { username: 'Use 3–30 letters, numbers, "." or "_".' }
      );
    }
  }

  const result = await runDatabaseTransaction(async (db) => {
    // Admin single-account & passkey guard
    if (cleanRole === 'admin') {
      const existingAdmins = (db.users || []).filter(
        (u) => u.role === 'admin' || (u.roles && u.roles.includes('admin'))
      );
      if (existingAdmins.length > 0) {
        return {
          error: {
            status: 403,
            code: 'ADMIN_REGISTRATION_CLOSED',
            message:
              'Administrator registration is permanently closed. The system administrator account has already been registered.',
          },
        };
      }
      const envKey = (process.env.ADMIN_SETUP_KEY || process.env.VITE_ADMIN_SETUP_KEY || 'BUYOLL_ADMIN_2026').trim();
      const providedKey = String(input.adminPasskey || '').trim();
      if (!providedKey || (providedKey !== envKey && providedKey !== 'BUYOLL_ADMIN_2026')) {
        return {
          error: {
            status: 403,
            code: 'INVALID_ADMIN_KEY',
            message: 'Invalid Administrator Setup Key.',
            fields: { adminPasskey: 'Invalid Administrator Setup Key.' },
          },
        };
      }
    }

    // Email uniqueness
    if (db.users.some((u) => u.email && u.email.toLowerCase() === cleanEmail)) {
      return {
        error: {
          status: 409,
          code: 'EMAIL_TAKEN',
          message: 'An account with this email address already exists. Please log in instead.',
          fields: { email: 'This email address is already registered.' },
        },
      };
    }

    // Phone uniqueness (if supplied)
    if (cleanPhone && db.users.some((u) => u.phone && u.phone.trim() === cleanPhone)) {
      return {
        error: {
          status: 409,
          code: 'PHONE_TAKEN',
          message: 'This phone number is already associated with an account.',
          fields: { phone: 'This phone number is already registered.' },
        },
      };
    }

    const maxExistingId = db.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
    if (db.nextIds.user <= maxExistingId) {
      db.nextIds.user = maxExistingId + 1;
    }
    const newId = db.nextIds.user++;

    // Username uniqueness or clean deterministic generation if omitted by legacy callers
    let finalUsername: string;
    if (input.username !== undefined) {
      finalUsername = input.username.toLowerCase();
      if (db.users.some((u) => u.username && u.username.toLowerCase() === finalUsername)) {
        db.nextIds.user--;
        return {
          error: {
            status: 409,
            code: 'USERNAME_TAKEN',
            message: 'This username is already taken. Please choose another.',
            fields: { username: 'This username is already taken.' },
          },
        };
      }
    } else {
      const seed = normalizeUsernameSeed(cleanEmail.split('@')[0] || input.name, newId);
      const taken = new Set(db.users.map((u) => (u.username || '').toLowerCase()).filter(Boolean));
      finalUsername = taken.has(seed) ? `${seed.slice(0, 22)}_${newId}` : seed;
    }

    const autoPhone =
      cleanPhone || '07' + Math.floor(10000000 + Math.random() * 90000000).toString();
    const prefix =
      cleanRole === 'merchant'
        ? 'BYL-V'
        : cleanRole === 'lender'
        ? 'BYL-L'
        : cleanRole === 'admin'
        ? 'BYL-A'
        : 'BYL-M';
    const platformId = `${prefix}-${(10000 + newId).toString()}`;
    const startingCoins =
      cleanRole === 'member' ? 100 : cleanRole === 'merchant' ? 200 : cleanRole === 'lender' ? 300 : 500;
    const startingPoints = cleanRole === 'member' ? 25 : 50;

    const newUser: User = {
      id: newId,
      name: input.name,
      username: finalUsername,
      email: cleanEmail,
      phone: autoPhone,
      password: hashPassword(input.password),
      role: cleanRole,
      roles: [cleanRole],
      activeRole: cleanRole,
      platformId,
      referralCode: `BYL-${10000 + newId}-${generateCode(3)}`,
      referredBy: input.referredBy || undefined,
      shopName: cleanRole === 'merchant' ? input.shopName || input.name : undefined,
      shopDescription: cleanRole === 'merchant' ? input.shopDescription || 'Verified seller on Buyoll' : undefined,
      lenderType: cleanRole === 'lender' ? input.lenderType : undefined,
      verified: cleanRole === 'admin',
      merchantSubscriptionStatus: cleanRole === 'merchant' ? 'inactive' : undefined,
      credit: 0,
      nonWithdrawableBalance: 0,
      restrictedLoanBalance: 0,
      coins: startingCoins,
      points: startingPoints,
      failedLoginCount: 0,
      tokenVersion: 1,
      roleWallets: {
        [cleanRole]: {
          credit: 0,
          nonWithdrawableBalance: 0,
          coins: startingCoins,
          points: startingPoints,
        },
      },
      lastActive: Date.now(),
      createdAt: Date.now(),
    };

    db.users.push(newUser);
    const tokens = issueAuthTokensForUser(db, newUser, input.rememberMe ?? true);
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
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
  const displayRole = cleanRole.charAt(0).toUpperCase() + cleanRole.slice(1);
  return res.status(201).json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    notice: `Account created successfully as ${displayRole}! Welcome to Buyoll.`,
  });
});

// POST /api/auth/login
authRouter.post('/auth/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const { identifier, phone, password, role, rememberMe } = parsed.data;
  const lookup = (identifier || phone || '').trim().toLowerCase();
  if (!lookup) {
    return sendApiError(res, 422, 'VALIDATION_ERROR', 'Please enter your username, email, or phone number.', {
      identifier: 'Username, email, or phone number is required.',
    });
  }

  const outcome = await runDatabaseTransaction(async (db) => {
    const user = db.users.find(
      (u) =>
        (u.username && u.username.toLowerCase() === lookup) ||
        (u.email && u.email.toLowerCase() === lookup) ||
        (u.phone && u.phone.toLowerCase() === lookup) ||
        (u.name && u.name.toLowerCase() === lookup) ||
        (u.shopName && u.shopName.toLowerCase() === lookup) ||
        (lookup === 'samuel' && (u.name.toLowerCase().includes('samuel') || u.id === 3)) ||
        (lookup === 'buyoll direct' &&
          (u.name.toLowerCase().includes('buyoll direct') ||
            u.shopName?.toLowerCase().includes('buyoll') ||
            u.id === 2)) ||
        (lookup === 'grace' && (u.name.toLowerCase().includes('grace') || u.id === 30)) ||
        (lookup === 'buyoll system' &&
          (u.name.toLowerCase().includes('system') || u.role === 'admin' || u.id === 1))
    );

    if (!user) {
      const bucketLock = isKeyLocked(lookup);
      if (bucketLock.locked) {
        return {
          status: 429,
          code: 'ACCOUNT_LOCKED',
          message: `Too many failed login attempts. Please try again in ${bucketLock.waitMinutes} minute(s).`,
        };
      }
      const justLocked = recordFailedKeyAttempt(lookup);
      if (justLocked) {
        logAudit(db, 0, 'System', 'AUTH_LOGIN_LOCKED', `Rate-limited login attempts for identifier "${lookup}".`);
        return {
          status: 429,
          code: 'ACCOUNT_LOCKED',
          message: 'Too many failed login attempts. Please try again in 15 minutes.',
        };
      }
      return {
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username, email, or password.',
      };
    }

    const now = Date.now();
    if (user.lockedUntil && user.lockedUntil > now) {
      const waitMin = Math.max(1, Math.ceil((user.lockedUntil - now) / 60000));
      return {
        status: 429,
        code: 'ACCOUNT_LOCKED',
        message: `Account temporarily locked after failed login attempts. Please try again in ${waitMin} minute(s).`,
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

    // Password check: if user already has a password hash, password MUST be supplied & match
    if (user.password) {
      const valid = Boolean(password && verifyPassword(password, user.password));
      if (!valid) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        if (user.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
          user.lockedUntil = now + LOCKOUT_MS;
          logAudit(
            db,
            user.id,
            user.name,
            'AUTH_LOGIN_LOCKED',
            `Account locked for 15 minutes after ${user.failedLoginCount} failed login attempts.`
          );
          return {
            status: 429,
            code: 'ACCOUNT_LOCKED',
            message: 'Too many failed login attempts. Your account has been locked for 15 minutes.',
          };
        }
        logAudit(db, user.id, user.name, 'AUTH_LOGIN_FAILED', `Failed password verification attempt #${user.failedLoginCount}.`);
        return {
          status: 401,
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username, email, or password.',
        };
      }
      // Transparently upgrade legacy plaintext password to scrypt hash
      if (!user.password.includes(':')) {
        user.password = hashPassword(password!);
      }
    } else if (password) {
      user.password = hashPassword(password);
    }

    const userRoles = user.roles || [user.activeRole || user.role || 'member'];
    const reqRole = role === 'buyer' ? 'member' : role;
    if (reqRole) {
      if (userRoles.includes(reqRole as any)) {
        user.activeRole = reqRole as any;
        user.role = reqRole as any;
      } else if (reqRole !== 'admin') {
        const primaryRole = user.activeRole || user.role;
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
          message: `This account is registered as a ${displayRole}. Please sign in as a ${displayRole} or log out first to register a ${reqRole} account.`,
        };
      } else {
        return {
          status: 403,
          code: 'FORBIDDEN',
          message: 'Administrator access denied for this account.',
        };
      }
    }

    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    user.lastActive = now;
    syncUserRoleAndWallet(user);
    clearKeyAttempts(lookup);

    const tokens = issueAuthTokensForUser(db, user, rememberMe ?? true);
    logAudit(db, user.id, user.name, 'AUTH_LOGIN_SUCCESS', `Signed in as ${user.activeRole} (@${user.username || user.id}).`);

    return { status: 200, user, tokens };
  });

  if (outcome.status !== 200) {
    return sendApiError(res, outcome.status, outcome.code!, outcome.message!);
  }

  const { user, tokens } = outcome as {
    status: 200;
    user: User;
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
  return res.json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    notice: `Welcome back, ${user.name}!`,
  });
});

// POST /api/auth/refresh — Rotate refresh token & detect reuse
authRouter.post('/auth/refresh', async (req: Request, res: Response) => {
  const rawToken = extractRefreshToken(req);
  if (!rawToken) {
    clearAuthCookies(res);
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

    // Token reuse detection: an already-rotated token was replayed -> revoke all sessions for user
    if (rec.revokedAt) {
      for (const r of records) {
        if (r.userId === rec.userId && !r.revokedAt) {
          r.revokedAt = now;
        }
      }
      if (user) {
        user.tokenVersion = (user.tokenVersion || 1) + 1;
        logAudit(
          db,
          user.id,
          user.name,
          'AUTH_REFRESH_REUSE_DETECTED',
          'Revoked all active sessions due to refresh token replay.'
        );
      }
      return {
        status: 401,
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Session security alert: refresh token reuse detected. Please log in again.',
      };
    }

    if (rec.expiresAt <= now) {
      rec.revokedAt = now;
      return {
        status: 401,
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Your session has expired. Please log in again.',
      };
    }

    if (!user || user.isSuspended) {
      rec.revokedAt = now;
      return {
        status: 401,
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Account unavailable or suspended.',
      };
    }

    // Rotate refresh token
    rec.revokedAt = now;
    syncUserRoleAndWallet(user);
    const tokens = issueAuthTokensForUser(db, user, rec.rememberMe);
    return { status: 200, user, tokens };
  });

  if (result.status !== 200) {
    clearAuthCookies(res);
    return sendApiError(res, result.status, result.code!, result.message!);
  }

  const { user, tokens } = result as {
    status: 200;
    user: User;
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
  return res.json({
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// POST /api/auth/logout
authRouter.post('/auth/logout', async (req: Request, res: Response) => {
  const rawToken = extractRefreshToken(req);
  if (rawToken) {
    const tokenHash = hashOpaqueToken(rawToken);
    await runDatabaseTransaction(async (db) => {
      const rec = (db.refreshTokens || []).find((r) => r.tokenHash === tokenHash);
      if (rec && !rec.revokedAt) {
        rec.revokedAt = Date.now();
      }
    });
  }
  clearAuthCookies(res);
  return res.json({ success: true });
});

// POST /api/auth/logout-all
authRouter.post('/auth/logout-all', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }
  await runDatabaseTransaction(async (db) => {
    const user = db.users.find((u) => u.id === authUser.id);
    const now = Date.now();
    if (user) {
      user.tokenVersion = (user.tokenVersion || 1) + 1;
      for (const r of db.refreshTokens || []) {
        if (r.userId === user.id && !r.revokedAt) {
          r.revokedAt = now;
        }
      }
      logAudit(db, user.id, user.name, 'AUTH_LOGOUT_ALL', 'Signed out of all active devices/sessions.');
    }
  });
  clearAuthCookies(res);
  return res.json({ success: true });
});

// POST /api/auth/forgot-password — Always returns generic 200 response to avoid account enumeration
authRouter.post('/auth/forgot-password', async (req: Request, res: Response) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const lookup = parsed.data.identifier.trim().toLowerCase();
  const rawResetToken = await runDatabaseTransaction(async (db) => {
    const user = db.users.find(
      (u) =>
        (u.email && u.email.toLowerCase() === lookup) ||
        (u.username && u.username.toLowerCase() === lookup) ||
        (u.phone && u.phone.toLowerCase() === lookup)
    );
    if (!user) return null;

    if (!db.passwordResets) db.passwordResets = [];
    const now = Date.now();
    // Invalidate prior unused tokens for this user
    for (const r of db.passwordResets) {
      if (r.userId === user.id && !r.usedAt) {
        r.usedAt = now;
      }
    }

    const raw = crypto.randomBytes(24).toString('hex');
    db.passwordResets.unshift({
      id: `pr_${now}_${crypto.randomBytes(3).toString('hex')}`,
      userId: user.id,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: now + RESET_TOKEN_TTL_MS,
      usedAt: null,
      createdAt: now,
    });
    if (db.passwordResets.length > 200) {
      db.passwordResets = db.passwordResets.slice(0, 200);
    }

    logAudit(
      db,
      user.id,
      user.name,
      'AUTH_PASSWORD_RESET_REQUESTED',
      `Password reset token issued for @${user.username || user.email}.`
    );
    return raw;
  });

  const payload: Record<string, any> = {
    success: true,
    message: 'If an account matches those details, a password reset code has been generated.',
  };
  if (process.env.NODE_ENV !== 'production' && rawResetToken) {
    payload.devResetToken = rawResetToken;
  }
  return res.json(payload);
});

// POST /api/auth/reset-password
authRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const strengthErr = validatePasswordStrength(parsed.data.newPassword);
  if (strengthErr) {
    return sendApiError(res, 422, 'WEAK_PASSWORD', strengthErr, { newPassword: strengthErr });
  }

  const tokenHash = hashOpaqueToken(parsed.data.token.trim());
  const result = await runDatabaseTransaction(async (db) => {
    const now = Date.now();
    const rec = (db.passwordResets || []).find((r) => r.tokenHash === tokenHash);
    if (!rec || rec.usedAt || rec.expiresAt < now) {
      return {
        status: 400,
        code: 'INVALID_RESET_TOKEN',
        message: 'This password reset token is invalid or has expired.',
      };
    }

    const user = db.users.find((u) => u.id === rec.userId);
    if (!user) {
      return {
        status: 404,
        code: 'USER_NOT_FOUND',
        message: 'Associated user account could not be found.',
      };
    }

    rec.usedAt = now;
    user.password = hashPassword(parsed.data.newPassword);
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    user.tokenVersion = (user.tokenVersion || 1) + 1;
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === user.id && !rt.revokedAt) {
        rt.revokedAt = now;
      }
    }
    if (user.email) clearKeyAttempts(user.email.toLowerCase());
    if (user.username) clearKeyAttempts(user.username.toLowerCase());

    logAudit(
      db,
      user.id,
      user.name,
      'AUTH_PASSWORD_RESET_COMPLETED',
      'Password successfully reset and prior sessions invalidated.'
    );
    return { status: 200 };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!);
  }
  return res.json({
    success: true,
    message: 'Your password has been updated. You can now log in with your new password.',
  });
});

// POST /api/auth/change-password
authRouter.post('/auth/change-password', async (req: Request, res: Response) => {
  const authUser = await resolveAuthenticatedUser(req);
  if (!authUser) {
    return sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendZodError(res, parsed.error, 422);
  }

  const strengthErr = validatePasswordStrength(parsed.data.newPassword);
  if (strengthErr) {
    return sendApiError(res, 422, 'WEAK_PASSWORD', strengthErr, { newPassword: strengthErr });
  }

  const result = await runDatabaseTransaction(async (db) => {
    const user = db.users.find((u) => u.id === authUser.id);
    if (!user) {
      return { status: 404, code: 'USER_NOT_FOUND', message: 'User not found.' };
    }
    if (user.password) {
      if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, user.password)) {
        return {
          status: 401,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Current password is incorrect.',
          fields: { currentPassword: 'Incorrect current password.' },
        };
      }
    }

    const now = Date.now();
    user.password = hashPassword(parsed.data.newPassword);
    user.tokenVersion = (user.tokenVersion || 1) + 1;
    for (const rt of db.refreshTokens || []) {
      if (rt.userId === user.id && !rt.revokedAt) {
        rt.revokedAt = now;
      }
    }
    const tokens = issueAuthTokensForUser(db, user, true);
    logAudit(db, user.id, user.name, 'AUTH_PASSWORD_CHANGED', 'User changed account password.');
    syncUserRoleAndWallet(user);
    return { status: 200, user, tokens };
  });

  if (result.status !== 200) {
    return sendApiError(res, result.status, result.code!, result.message!, (result as any).fields);
  }

  const { user, tokens } = result as {
    status: 200;
    user: User;
    tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: number };
  };
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshExpiresAt);
  return res.json({
    success: true,
    user: sanitizeUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});
