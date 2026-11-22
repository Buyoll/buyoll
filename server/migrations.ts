import crypto from 'crypto';
import { DatabaseSchema, logAudit } from './db.js';
import { fromCents, LOAN_PLATFORM_FEE_RATE, SUPPORT_EMAIL, toCents } from './config.js';
import {
  hashPasskey,
  hashPassword,
  normalizeEastAfricanPhone,
  normalizeUsername,
  normalizeUsernameSeed,
  sendSecurityEmail,
} from './auth_utils.js';
import { assertWalletAndDepositConstraints, creditWalletCents, ensureWallet } from './wallet_service.js';
import { User, UserRole } from '../src/types.js';
import { STANDARD_MEMBER_SPEEDS, buildAllSpeedOptions } from '../src/utils/speedOptions.js';
import { buildControlCenterIndexSnapshot } from './admin_control_center.js';
import { getEatTimeKeys, recordIncomeInTx, runWalletReconciliationInTx } from './admin_wallet_service.js';
import {
  DEFAULT_FEATURED_PLACEMENTS,
  DEFAULT_FEATURED_PRICING,
  DEFAULT_TIER_FEATURED_LIMITS,
  getFeaturedSettings,
  sweepFeaturedPlacementsInTx,
} from './featured_service.js';

export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: number;
}

export interface MigrationContext {
  alreadyApplied: boolean;
}

export interface MigrationDefinition {
  id: string;
  name: string;
  up: (db: DatabaseSchema, ctx: MigrationContext) => Promise<boolean> | boolean;
  down: (db: DatabaseSchema) => Promise<boolean> | boolean;
}

function scrubRoleValue(role?: string | null): UserRole {
  if (role === 'merchant' || role === 'lender' || role === 'admin') return role;
  return 'member';
}

export const MIGRATIONS: MigrationDefinition[] = [
  {
    id: '001_announcements_notices_and_dismissals',
    name: 'Extend announcements with lifecycle, audience, pin, schedule, dismissals, and revisions',
    up(db) {
      let changed = false;
      if (!db.announcements) {
        db.announcements = [];
        changed = true;
      }
      if (!db.announcementDismissals) {
        db.announcementDismissals = [];
        changed = true;
      }
      if (!db.announcementItemRevisions) {
        db.announcementItemRevisions = [];
        changed = true;
      }
      if (!db.nextIds.announcement) {
        db.nextIds.announcement = (db.announcements.length || 0) + 1;
        changed = true;
      }
      for (const ann of db.announcements) {
        if (!ann.type) {
          ann.type = ann.imageUrl ? 'PROMOTION' : 'ANNOUNCEMENT';
          changed = true;
        }
        if (!ann.audience) {
          ann.audience = 'ALL';
          changed = true;
        }
        if (!ann.status) {
          ann.status = 'PUBLISHED';
          changed = true;
        }
        if (ann.pinned === undefined) {
          ann.pinned = false;
          changed = true;
        }
        if (!ann.publishedAt && ann.status === 'PUBLISHED') {
          ann.publishedAt = ann.createdAt || Date.now();
          changed = true;
        }
        if (!ann.version) {
          ann.version = 1;
          changed = true;
        }
      }
      return changed;
    },
    down(db) {
      delete (db as any).announcementDismissals;
      delete (db as any).announcementItemRevisions;
      for (const ann of db.announcements || []) {
        delete ann.type;
        delete ann.audience;
        delete ann.status;
        delete ann.pinned;
        delete ann.startsAt;
        delete ann.endsAt;
        delete ann.ctaLabel;
        delete ann.ctaUrl;
      }
      return true;
    },
  },
  {
    id: '002_yearly_billing_avatars_product_status',
    name: 'Sync product status enum, avatar timestamps, and yearly subscription interval metadata',
    up(db) {
      let changed = false;
      for (const u of db.users || []) {
        if ((u.avatar || u.avatarUrl) && !u.avatarUpdatedAt) {
          u.avatarUpdatedAt = u.lastActive || u.createdAt || Date.now();
          changed = true;
        }
      }
      for (const sub of db.merchantSubscriptions || []) {
        if (!sub.billingInterval) {
          sub.billingInterval = sub.billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY';
          changed = true;
        }
        if (sub.autoRenew === undefined) {
          sub.autoRenew = true;
          changed = true;
        }
        if (!sub.currentPeriodEnd && sub.expiresAt) {
          sub.currentPeriodEnd = sub.expiresAt;
          changed = true;
        }
      }
      for (const p of db.products || []) {
        const expected =
          p.publicationStatus === 'draft' || p.live === false ? 'DRAFT' : 'PUBLISHED';
        if (!p.status) {
          p.status = expected;
          changed = true;
        }
      }
      return changed;
    },
    down(db) {
      for (const sub of db.merchantSubscriptions || []) {
        delete sub.billingInterval;
        delete sub.autoRenew;
        delete sub.canceledAt;
        delete sub.currentPeriodEnd;
      }
      for (const p of db.products || []) {
        delete p.status;
      }
      return true;
    },
  },
  {
    id: '003_auth_usernames_sessions_resets',
    name: 'Backfill unique lowercase usernames, login lockout counters, tokenVersion, refreshTokens, and passwordResets',
    up(db) {
      let changed = false;
      if (!db.refreshTokens) {
        db.refreshTokens = [];
        changed = true;
      }
      if (!db.passwordResets) {
        db.passwordResets = [];
        changed = true;
      }
      const usedUsernames = new Set<string>();
      for (const u of db.users || []) {
        if (u.username) {
          usedUsernames.add(u.username.toLowerCase());
        }
      }
      for (const u of db.users || []) {
        if (!u.username) {
          const emailPrefix = u.email ? u.email.split('@')[0] : u.name;
          let candidate = normalizeUsernameSeed(emailPrefix, u.id);
          if (usedUsernames.has(candidate)) {
            candidate = `${candidate.slice(0, 24)}_${u.id}`;
          }
          u.username = candidate;
          usedUsernames.add(candidate);
          changed = true;
        }
        if (u.failedLoginCount === undefined) {
          u.failedLoginCount = 0;
          changed = true;
        }
        if (!u.tokenVersion) {
          u.tokenVersion = 1;
          changed = true;
        }
      }
      return changed;
    },
    down(db) {
      delete (db as any).refreshTokens;
      delete (db as any).passwordResets;
      return true;
    },
  },
  {
    id: '004_group_join_policies_and_members',
    name: 'Add joinPolicy, maxMembers, memberCode, groupJoinRequests, and group product assignments',
    up(db) {
      let changed = false;
      if (!db.groupJoinRequests) {
        db.groupJoinRequests = [];
        changed = true;
      }
      for (const g of db.groups || []) {
        if (!g.joinPolicy) {
          g.joinPolicy = g.isInviteOnly ? 'INVITE_ONLY' : 'OPEN';
          changed = true;
        }
        if (!g.maxMembers) {
          g.maxMembers = g.size || g.totalSlots || 10;
          changed = true;
        }
        if (!g.productsInGroup) {
          g.productsInGroup = g.productId
            ? [
                {
                  productId: g.productId,
                  addedBy: g.vendorId || 2,
                  addedAt: g.createdAt || Date.now(),
                  isFeatured: true,
                  sortOrder: 0,
                },
              ]
            : [];
          changed = true;
        }
        for (const s of g.slots || []) {
          if (s.userId && s.status === 'active' && !s.memberCode) {
            s.memberCode = `BYL-${String(1000 + g.id * 10 + s.slotNumber)}`;
            changed = true;
          }
        }
      }
      return changed;
    },
    down(db) {
      delete (db as any).groupJoinRequests;
      for (const g of db.groups || []) {
        delete g.joinPolicy;
        delete g.maxMembers;
        delete g.productsInGroup;
      }
      return true;
    },
  },
  {
    id: '005_group_lenders_and_restricted_loans',
    name: 'Initialize groupLenders, platformFees ledger, restrictedLoanBalance, and borrower codes',
    up(db) {
      let changed = false;
      if (!db.groupLenders) {
        db.groupLenders = [];
        changed = true;
      }
      if (!db.platformFees) {
        db.platformFees = [];
        changed = true;
      }
      for (const u of db.users || []) {
        if (u.restrictedLoanBalance === undefined) {
          u.restrictedLoanBalance = Number(u.nonWithdrawableBalance || 0);
          changed = true;
        }
        if (u.nonWithdrawableBalance === undefined) {
          u.nonWithdrawableBalance = u.restrictedLoanBalance;
          changed = true;
        }
      }
      for (const g of db.groups || []) {
        if (g.lenderId) {
          const exists = db.groupLenders.some(
            (gl) => gl.groupId === g.id && gl.userId === g.lenderId
          );
          if (!exists) {
            db.groupLenders.push({
              id: `gl_${g.id}_${g.lenderId}`,
              groupId: g.id,
              userId: g.lenderId,
              userName: g.lenderName || 'Authorized Lender',
              authorizedBy: g.moderatorId || g.adminId || 1,
              authorizedByName: 'Group Moderator',
              status: 'ACTIVE',
              createdAt: g.lenderJoinedAt || g.createdAt || Date.now(),
            });
            changed = true;
          }
        }
      }
      for (const loan of db.peerLoans || []) {
        if (loan.feeRate === undefined) {
          loan.feeRate = LOAN_PLATFORM_FEE_RATE;
          changed = true;
        }
        if (!loan.borrowerCode) {
          loan.borrowerCode = `BYL-${String(1000 + (loan.groupId || 1) * 10 + (loan.slotNumber || 1))}`;
          changed = true;
        }
      }
      return changed;
    },
    down(db) {
      delete (db as any).groupLenders;
      delete (db as any).platformFees;
      return true;
    },
  },
  {
    id: '006_support_email_sync',
    name: 'Sync seed administrator and default support email references to SUPPORT_EMAIL',
    up(db) {
      let changed = false;
      const legacy = 'cityandcountyre@gmail.com';
      const admin = (db.users || []).find((u) => u.id === 1 && u.email?.toLowerCase() === legacy);
      if (admin) {
        admin.email = SUPPORT_EMAIL;
        changed = true;
      }
      for (const c of db.announcementCards || []) {
        if (c.updatedBy === legacy) {
          c.updatedBy = SUPPORT_EMAIL;
          changed = true;
        }
      }
      return changed;
    },
    down() {
      return false;
    },
  },
  {
    id: '007_role_normalization_and_terminology_cleanup',
    name: 'Normalize legacy buyer role references to member, compute usernameNormalized, and initialize security/session stores',
    up(db) {
      let changed = false;
      if (!db.sessions) {
        db.sessions = [];
        changed = true;
      }
      if (!db.otpChallenges) {
        db.otpChallenges = [];
        changed = true;
      }
      if (!db.subscriptionActivationNotices) {
        db.subscriptionActivationNotices = [];
        changed = true;
      }
      if (!db.emailOutbox) {
        db.emailOutbox = [];
        changed = true;
      }

      const seenNormUsernames = new Set<string>();
      for (const u of db.users || []) {
        const cleanActive = scrubRoleValue((u.activeRole || u.role) as string);
        if ((u.role as any) === 'buyer' || u.role !== cleanActive) {
          u.role = cleanActive;
          changed = true;
        }
        if ((u.activeRole as any) === 'buyer' || !u.activeRole) {
          u.activeRole = cleanActive;
          changed = true;
        }
        if (Array.isArray(u.roles)) {
          const cleanRoles = Array.from(new Set(u.roles.map((r) => scrubRoleValue(r as string))));
          if (JSON.stringify(cleanRoles) !== JSON.stringify(u.roles)) {
            u.roles = cleanRoles;
            changed = true;
          }
        } else {
          u.roles = [cleanActive];
          changed = true;
        }
        if (u.roleWallets && (u.roleWallets as any).buyer) {
          if (!u.roleWallets.member) {
            u.roleWallets.member = (u.roleWallets as any).buyer;
          }
          delete (u.roleWallets as any).buyer;
          changed = true;
        }
        let norm = normalizeUsername(u.username || '');
        if (!norm || norm.length < 3) {
          const fallbackSeed = normalizeUsernameSeed(u.email?.split('@')[0] || u.name, u.id);
          u.username = fallbackSeed;
          norm = normalizeUsername(fallbackSeed);
          changed = true;
        }
        if (seenNormUsernames.has(norm)) {
          u.username = `${(u.username || 'user').slice(0, 22)}_${u.id}`;
          norm = normalizeUsername(u.username);
          changed = true;
        }
        seenNormUsernames.add(norm);
        if (u.usernameNormalized !== norm) {
          u.usernameNormalized = norm;
          changed = true;
        }
      }

      for (const msg of db.helpChat || []) {
        if ((msg.userRole as any) === 'buyer') {
          msg.userRole = 'member';
          changed = true;
        }
      }

      for (const p of db.products || []) {
        if (p.hiddenReason === undefined) {
          p.hiddenReason = null;
          changed = true;
        }
      }

      return changed;
    },
    down() {
      return false;
    },
  },
  {
    id: '008_admin_replacement_and_security_fields',
    name: 'Disable legacy admin accounts, strip prior admin rights, and seed active argon2id platform admin from environment variables',
    async up(db, ctx) {
      let changed = false;
      const now = Date.now();

      const adminUsername = (process.env.ADMIN_USERNAME || 'jobsimiyu').trim();
      const adminUsernameNorm = normalizeUsername(adminUsername);
      const adminFullName = (process.env.ADMIN_FULL_NAME || 'Job Simiyu').trim();
      const adminEmail = (process.env.ADMIN_EMAIL || 'Jobsimiyu8@gmail.com').trim().toLowerCase();
      const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD;
      const adminInitialPasskey = process.env.ADMIN_INITIAL_PASSKEY;
      const forceCredentialChange =
        String(process.env.ADMIN_FORCE_CREDENTIAL_CHANGE || 'false').toLowerCase() === 'true';

      // Locate designated admin account (only match by configured username or email — never old id:1 unless it matches)
      let designatedAdmin = (db.users || []).find(
        (u) =>
          (u.usernameNormalized && u.usernameNormalized === adminUsernameNorm) ||
          (u.username && normalizeUsername(u.username) === adminUsernameNorm) ||
          (u.email && u.email.toLowerCase() === adminEmail)
      );

      // Disable and revoke ALL other legacy accounts carrying admin rights
      for (const u of db.users || []) {
        if (designatedAdmin && u.id === designatedAdmin.id) continue;
        const hadAdminRights =
          u.role === 'admin' ||
          u.activeRole === 'admin' ||
          (Array.isArray(u.roles) && u.roles.includes('admin')) ||
          u.username?.toLowerCase() === 'buyoll_admin' ||
          u.username?.toLowerCase() === 'admin2';
        if (hadAdminRights) {
          u.role = 'member';
          u.activeRole = 'member';
          u.roles = (u.roles || []).filter((r) => r !== 'admin');
          if (u.roles.length === 0) u.roles = ['member'];
          u.isDisabled = true;
          u.isSuspended = true;
          u.disabledAt = u.disabledAt || now;
          u.disabledReason = 'LEGACY_ADMIN_REPLACED';
          u.tokenVersion = (u.tokenVersion || 1) + 1;
          delete u.adminPasskeyHash;
          // Revoke all refreshTokens & sessions for disabled old admins
          for (const rt of db.refreshTokens || []) {
            if (rt.userId === u.id && !rt.revokedAt) rt.revokedAt = now;
          }
          for (const s of db.sessions || []) {
            if (s.userId === u.id && !s.revokedAt) {
              s.revokedAt = now;
              s.revokeReason = 'ADMIN_REPLACED';
            }
          }
          changed = true;
        }
      }

      if (!designatedAdmin) {
        const maxId = (db.users || []).reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
        if (db.nextIds.user <= maxId) db.nextIds.user = maxId + 1;
        const newAdminId = db.nextIds.user++;

        const passwordHash = adminInitialPassword ? await hashPassword(adminInitialPassword) : undefined;
        const passkeyHash = adminInitialPasskey ? await hashPasskey(adminInitialPasskey) : undefined;

        designatedAdmin = {
          id: newAdminId,
          name: adminFullName,
          username: adminUsername.toLowerCase(),
          usernameNormalized: adminUsernameNorm,
          email: adminEmail,
          phone: '0700000001',
          password: passwordHash,
          adminPasskeyHash: passkeyHash,
          role: 'admin',
          roles: ['admin'],
          activeRole: 'admin',
          platformId: `BYL-A-${10000 + newAdminId}`,
          verified: true,
          isDisabled: false,
          isSuspended: false,
          credit: 0,
          coins: 500,
          points: 500,
          failedLoginCount: 0,
          tokenVersion: 1,
          mustChangeCredentials: forceCredentialChange,
          lastPasswordChangedAt: null,
          lastPasskeyChangedAt: null,
          securityBannerDismissedAt: null,
          securityBannerSnoozedUntil: null,
          roleWallets: {
            admin: { credit: 0, coins: 500, points: 500 },
          },
          lastActive: now,
          createdAt: now,
        };
        db.users.unshift(designatedAdmin);
        logAudit(
          db,
          newAdminId,
          adminFullName,
          'ADMIN_REPLACED_BY_MIGRATION',
          `Seeded platform administrator @${designatedAdmin.username} and disabled prior admin accounts.`
        );
        sendSecurityEmail(db, {
          to: adminEmail,
          subject: 'Buyoll Administrator Account Initialized',
          body: `Hello ${adminFullName}, your Buyoll administrator account (@${designatedAdmin.username}) has been initialized.`,
          kind: 'security_alert',
          userId: newAdminId,
        });
        changed = true;
      } else {
        // Idempotent ensure fields exist WITHOUT overwriting rotated password/passkey!
        if (!ctx.alreadyApplied) {
          if (adminInitialPassword && !designatedAdmin.lastPasswordChangedAt) {
            designatedAdmin.password = await hashPassword(adminInitialPassword);
            changed = true;
          }
          if (adminInitialPasskey && !designatedAdmin.lastPasskeyChangedAt) {
            designatedAdmin.adminPasskeyHash = await hashPasskey(adminInitialPasskey);
            changed = true;
          }
        } else {
          if (adminInitialPassword && !designatedAdmin.password) {
            designatedAdmin.password = await hashPassword(adminInitialPassword);
            changed = true;
          }
          if (adminInitialPasskey && !designatedAdmin.adminPasskeyHash) {
            designatedAdmin.adminPasskeyHash = await hashPasskey(adminInitialPasskey);
            changed = true;
          }
        }
        if (designatedAdmin.isDisabled) {
          designatedAdmin.isDisabled = false;
          designatedAdmin.isSuspended = false;
          changed = true;
        }
        if (designatedAdmin.role !== 'admin' || designatedAdmin.activeRole !== 'admin') {
          designatedAdmin.role = 'admin';
          designatedAdmin.activeRole = 'admin';
          designatedAdmin.roles = ['admin'];
          changed = true;
        }
      }

      return changed;
    },
    down() {
      return false;
    },
  },
  {
    id: '009_wallets_and_integer_ledger',
    name: 'Create canonical wallets and integer-cents walletLedger preserving all existing balances',
    up(db) {
      let changed = false;
      if (!db.wallets) {
        db.wallets = [];
        changed = true;
      }
      if (!db.walletLedger) {
        db.walletLedger = [];
        changed = true;
      }

      const beforeWalletsCount = db.wallets.length;
      const beforeLedgerCount = db.walletLedger.length;

      for (const u of db.users || []) {
        const roles = new Set<UserRole>();
        roles.add(scrubRoleValue(u.activeRole || u.role));
        for (const r of u.roles || []) {
          roles.add(scrubRoleValue(r));
        }
        if (u.roleWallets) {
          for (const k of Object.keys(u.roleWallets)) {
            if (k === 'member' || k === 'merchant' || k === 'lender' || k === 'admin') {
              roles.add(k);
            }
          }
        }
        for (const role of roles) {
          ensureWallet(db, u, role);
          // Reconcile if user.roleWallets[role].credit was higher/updated directly in legacy seed
          const w = db.wallets.find((x) => x.userId === u.id && x.role === role);
          const roleCreditCents = toCents(u.roleWallets?.[role]?.credit ?? (role === (u.activeRole || u.role) ? u.credit : 0) ?? 0);
          if (w && w.balanceCents === 0 && roleCreditCents > 0) {
            const now = Date.now();
            w.balanceCents = roleCreditCents;
            w.updatedAt = now;
            db.walletLedger.push({
              id: `wled_${now}_${w.id}_sync`,
              walletId: w.id,
              userId: u.id,
              role,
              direction: 'CREDIT',
              amountCents: roleCreditCents,
              balanceAfterCents: roleCreditCents,
              category: 'MIGRATION_OPENING_BALANCE',
              idempotencyKey: `opening_sync_${w.id}`,
              note: `Opening wallet balance sync for ${role} role`,
              createdAt: now,
            });
            changed = true;
          } else if (w) {
            // Ensure projection matches canonical wallet
            if (u.roleWallets?.[role] && u.roleWallets[role]!.credit !== fromCents(w.balanceCents)) {
              u.roleWallets[role]!.credit = fromCents(w.balanceCents);
              changed = true;
            }
            if (scrubRoleValue(u.activeRole || u.role) === role && u.credit !== fromCents(w.balanceCents)) {
              u.credit = fromCents(w.balanceCents);
              changed = true;
            }
          }
        }
      }

      if (db.wallets.length !== beforeWalletsCount || db.walletLedger.length !== beforeLedgerCount) {
        changed = true;
      }
      return changed;
    },
    down(db) {
      delete (db as any).wallets;
      delete (db as any).walletLedger;
      return true;
    },
  },
  {
    id: '010_auth_hardening_e164_phone_and_resets',
    name: 'Backfill UUIDs, display/lowercase usernames, E.164 nullable phone normalization, verification flags, and audit legacy credential issues without deleting data',
    up(db) {
      let changed = false;
      if (!db.passwordResets) {
        db.passwordResets = [];
        changed = true;
      }

      const now = Date.now();
      const emailCounts = new Map<string, number>();
      const usernameCounts = new Map<string, number>();
      const phoneCounts = new Map<string, number>();

      for (const u of db.users || []) {
        if (!u.uuid) {
          u.uuid = crypto.randomUUID();
          changed = true;
        }
        if (u.username) {
          const display = (u.usernameDisplay || u.username).trim();
          const lower = display.toLowerCase();
          if (!u.usernameDisplay) {
            u.usernameDisplay = display;
            changed = true;
          }
          if (u.usernameLower !== lower) {
            u.usernameLower = lower;
            changed = true;
          }
        }
        if (!u.updatedAt) {
          u.updatedAt = u.lastActive || u.createdAt || now;
          changed = true;
        }
        if (typeof u.emailVerified !== 'boolean') {
          u.emailVerified = Boolean(u.emailVerifiedAt);
          changed = true;
        }
        if (typeof u.phoneVerified !== 'boolean') {
          u.phoneVerified = false;
          changed = true;
        }
        if (u.failedLoginCount === undefined) {
          u.failedLoginCount = 0;
          changed = true;
        }
        if (u.lockedUntil === undefined) {
          u.lockedUntil = null;
          changed = true;
        }

        // Normalize phone into E.164 while keeping blank/absent phone as null
        const rawPhone = typeof u.phone === 'string' ? u.phone.trim() : '';
        if (!rawPhone) {
          if (u.phone !== null) {
            u.phone = null;
            changed = true;
          }
          if (u.phoneNormalized !== null) {
            u.phoneNormalized = null;
            changed = true;
          }
        } else {
          const normRes = normalizeEastAfricanPhone(rawPhone);
          const targetNorm = normRes.valid && normRes.normalized ? normRes.normalized : rawPhone;
          if (normRes.valid && normRes.normalized && u.phone !== normRes.normalized) {
            u.phone = normRes.normalized;
            changed = true;
          }
          if (u.phoneNormalized !== targetNorm) {
            u.phoneNormalized = targetNorm;
            changed = true;
          }
        }

        // Flag any non-hashed plain-text password on active accounts without deleting data
        if (u.password && typeof u.password === 'string' && !u.password.startsWith('$argon2') && !u.password.includes(':')) {
          if (!u.mustResetPassword) {
            u.mustResetPassword = true;
            u.mustChangeCredentials = true;
            changed = true;
          }
        }

        if (!u.isDisabled) {
          if (u.email) {
            const eKey = u.email.trim().toLowerCase();
            emailCounts.set(eKey, (emailCounts.get(eKey) || 0) + 1);
          }
          if (u.usernameLower) {
            usernameCounts.set(u.usernameLower, (usernameCounts.get(u.usernameLower) || 0) + 1);
          }
          if (u.phoneNormalized) {
            phoneCounts.set(u.phoneNormalized, (phoneCounts.get(u.phoneNormalized) || 0) + 1);
          }
        }
      }

      const dupEmails = Array.from(emailCounts.entries()).filter(([, c]) => c > 1).map(([k]) => k);
      const dupUsernames = Array.from(usernameCounts.entries()).filter(([, c]) => c > 1).map(([k]) => k);
      const dupPhones = Array.from(phoneCounts.entries()).filter(([, c]) => c > 1).map(([k]) => k);
      if (dupEmails.length > 0 || dupUsernames.length > 0 || dupPhones.length > 0) {
        logAudit(
          db,
          0,
          'System Migration 010',
          'MIGRATION_DUPLICATE_IDENTITY_NOTICE',
          `Detected duplicate legacy identities without deletion (emails=${dupEmails.length}, usernames=${dupUsernames.length}, phones=${dupPhones.length}).`
        );
        changed = true;
      }

      return changed;
    },
    down(db) {
      for (const u of db.users || []) {
        delete u.uuid;
        delete u.usernameDisplay;
        delete u.usernameLower;
        delete u.phoneNormalized;
        delete u.emailVerified;
        delete u.phoneVerified;
        delete u.mustResetPassword;
      }
      return true;
    },
  },
  {
    id: '011_standardize_all_ten_member_speeds',
    name: 'Normalize all product speedOptions to include all 10 member speeds (10, 9, 8, 7, 6, 5, 4, 3, 2, 1)',
    up(db) {
      let changed = false;
      const expectedSizes = [...STANDARD_MEMBER_SPEEDS];
      for (const p of db.products || []) {
        const currentSizes = Array.isArray(p.speedOptions)
          ? p.speedOptions.map((s) => Number(s.size))
          : [];
        const matchesCanonical =
          currentSizes.length === expectedSizes.length &&
          expectedSizes.every((sz, idx) => currentSizes[idx] === sz);
        const normalized = buildAllSpeedOptions(p.price, p.speedOptions);
        if (
          !matchesCanonical ||
          JSON.stringify(p.speedOptions) !== JSON.stringify(normalized)
        ) {
          p.speedOptions = normalized;
          p.updatedAt = Date.now();
          changed = true;
        }
      }
      return changed;
    },
    down() {
      return false;
    },
  },
  {
    id: '012_admin_control_center_indexes',
    name: 'Initialize non-destructive Control Center lookup index metadata on users, payments, deposits, subscriptions, loans, groups, refunds, and products',
    up(db, ctx) {
      const snapshot = buildControlCenterIndexSnapshot(db);
      if (!ctx.alreadyApplied || !db.controlCenterIndexes) {
        db.controlCenterIndexes = snapshot;
        return true;
      }
      // Refresh index counts only if underlying collection sizes drifted
      const prevCounts = JSON.stringify(db.controlCenterIndexes.counts);
      const nextCounts = JSON.stringify(snapshot.counts);
      if (prevCounts !== nextCounts) {
        db.controlCenterIndexes = snapshot;
        return true;
      }
      return false;
    },
    down(db) {
      delete db.controlCenterIndexes;
      return true;
    },
  },
  {
    id: '013_featured_paid_placements',
    name: 'Initialize paid Featured placements, duration pricing, subscription tier featured limits, stats store, and active seeded featured requests',
    up(db) {
      let changed = false;
      const now = Date.now();

      if (!db.featuredPlacements || db.featuredPlacements.length === 0) {
        db.featuredPlacements = DEFAULT_FEATURED_PLACEMENTS.map((p) => ({ ...p, updatedAt: now }));
        changed = true;
      }

      if (!db.featuredPricing || db.featuredPricing.length === 0) {
        db.featuredPricing = DEFAULT_FEATURED_PRICING.map((p) => ({ ...p, updatedAt: now }));
        changed = true;
      }

      if (!db.tierFeaturedLimits || Object.keys(db.tierFeaturedLimits).length === 0) {
        db.tierFeaturedLimits = {};
        for (const [tierId, cfg] of Object.entries(DEFAULT_TIER_FEATURED_LIMITS)) {
          db.tierFeaturedLimits[tierId] = { ...cfg, updatedAt: now };
        }
        changed = true;
      }

      if (!db.featuredSettings) {
        db.featuredSettings = {
          ...getFeaturedSettings(db),
          updatedAt: now,
        };
        changed = true;
      }

      if (!db.featuredRequests) {
        db.featuredRequests = [];
        changed = true;
      }

      if (!db.featuredStatsDaily) {
        db.featuredStatsDaily = [];
        changed = true;
      }

      // Non-destructive backfill: migrate existing seeded featured live products into 30-day ACTIVE placements
      if (db.featuredRequests.length === 0) {
        const dayMs = 24 * 60 * 60 * 1000;
        const cap = db.featuredPlacements[0]?.maxSlots || 10;
        let seededCount = 0;
        for (const p of db.products || []) {
          if (seededCount >= cap) break;
          if (p.isFeatured && p.live !== false && p.publicationStatus !== 'draft') {
            const reqId = `freq_seed_${p.id}`;
            db.featuredRequests.push({
              id: reqId,
              merchantId: p.vendorId,
              productId: p.id,
              placementKey: 'homepage_featured',
              durationDays: 30,
              tierIdSnapshot: 'tier_500',
              basePriceCents: 50000,
              discountPercent: 0,
              amountPaidCents: 50000,
              currency: 'KES',
              status: 'ACTIVE',
              startsAt: now - dayMs,
              endsAt: now + 29 * dayMs,
              approvedAt: now - dayMs,
              approvedBy: 1,
              createdAt: now - dayMs,
              updatedAt: now,
            });
            seededCount++;
            changed = true;
          }
        }
      }

      if (sweepFeaturedPlacementsInTx(db, now).changed) {
        changed = true;
      }

      return changed;
    },
    down(db) {
      delete db.featuredPlacements;
      delete db.featuredPricing;
      delete db.featuredRequests;
      delete db.featuredStatsDaily;
      delete db.tierFeaturedLimits;
      delete db.featuredSettings;
      return true;
    },
  },
  {
    id: '014_admin_wallet_outbox_and_indexes',
    name: 'Initialize unified Admin Wallet incomeLedger, specialRefundCredits, transactional outboxEvents, reconciliationReports, exportJobs, and backfill ledger totals',
    up(db, ctx) {
      let changed = false;
      if (!db.incomeLedger) {
        db.incomeLedger = [];
        changed = true;
      }
      if (!db.specialRefundCredits) {
        db.specialRefundCredits = [];
        changed = true;
      }
      if (!db.outboxEvents) {
        db.outboxEvents = [];
        changed = true;
      }
      if (!db.reconciliationReports) {
        db.reconciliationReports = [];
        changed = true;
      }
      if (!db.exportJobs) {
        db.exportJobs = [];
        changed = true;
      }

      if (!ctx.alreadyApplied) {
        // Backfill historical subscription revenue (KES channels only so coin-only plans stay separate)
        const usersById = new Map((db.users || []).map((u) => [u.id, u]));
        for (const sub of db.merchantSubscriptions || []) {
          if ((sub.status === 'active' || sub.status === 'expired') && Number(sub.amount || 0) > 0) {
            if (sub.paymentMethod === 'wallet_coins') continue;
            const channel = sub.paymentMethod === 'wallet_credit' ? 'WALLET' : 'MPESA_DIRECT';
            const merchant = usersById.get(sub.merchantId);
            const res = recordIncomeInTx(db, {
              source: 'SUBSCRIPTION',
              paymentChannel: channel,
              amountCents: toCents(sub.amount),
              userId: sub.merchantId,
              userName: merchant?.shopName || merchant?.name || `Merchant #${sub.merchantId}`,
              referenceId: sub.paymentCode || sub.id,
              description: `Subscription: ${sub.tierName}`,
              idempotencyKey: `mig014_sub_${sub.id}`,
              createdAt: sub.approvedAt || sub.startDate || sub.createdAt,
            });
            if (!res.deduplicated) changed = true;
          }
        }

        // Backfill settled Featured Placements
        for (const fr of db.featuredRequests || []) {
          if (
            (fr.status === 'ACTIVE' || fr.status === 'APPROVED' || fr.status === 'EXPIRED') &&
            Number(fr.amountPaidCents || 0) > 0
          ) {
            const merchant = usersById.get(fr.merchantId);
            const isSeeded = fr.id.startsWith('freq_seed_');
            const res = recordIncomeInTx(db, {
              source: 'FEATURED',
              paymentChannel: isSeeded ? 'MPESA_DIRECT' : 'WALLET',
              amountCents: fr.amountPaidCents,
              userId: fr.merchantId,
              userName: merchant?.shopName || merchant?.name || `Merchant #${fr.merchantId}`,
              referenceId: fr.id,
              description: `Featured Placement #${fr.id} (${fr.durationDays}d)`,
              idempotencyKey: `mig014_feat_${fr.id}`,
              createdAt: fr.approvedAt || fr.createdAt,
            });
            if (!res.deduplicated) changed = true;
          }
        }

        // Backfill Group Loan 1% platform commission fees
        for (const fee of db.platformFees || []) {
          if (Number(fee.feeAmountCents || 0) > 0) {
            const lender = usersById.get(fee.lenderId);
            const res = recordIncomeInTx(db, {
              source: 'LOAN_FEE',
              paymentChannel: 'WALLET',
              amountCents: fee.feeAmountCents,
              userId: fee.lenderId,
              userName: lender?.name || `Lender #${fee.lenderId}`,
              referenceId: `LOAN_FEE_${fee.loanId}`,
              description: `Loan #${fee.loanId} platform commission fee`,
              idempotencyKey: `mig014_loanfee_${fee.loanId}`,
              createdAt: fee.createdAt,
            });
            if (!res.deduplicated) changed = true;
          }
        }

        // Backfill EAT keys on any income record missing them
        for (const inc of db.incomeLedger) {
          if (!inc.eatDateKey || !inc.eatHourKey || !inc.eatMonthKey || !inc.eatYearKey) {
            const keys = getEatTimeKeys(inc.createdAt);
            inc.eatDateKey = keys.eatDateKey;
            inc.eatHourKey = keys.eatHourKey;
            inc.eatMonthKey = keys.eatMonthKey;
            inc.eatYearKey = keys.eatYearKey;
            changed = true;
          }
        }

        db.controlCenterIndexes = buildControlCenterIndexSnapshot(db);
        if (db.reconciliationReports.length === 0) {
          runWalletReconciliationInTx(db, 'scheduled');
        }
        changed = true;
      }

      return changed;
    },
    down(db) {
      delete db.incomeLedger;
      delete db.specialRefundCredits;
      delete db.outboxEvents;
      delete db.reconciliationReports;
      delete db.exportJobs;
      return true;
    },
  },
  {
    id: '015_repair_legacy_wallet_subs_and_recon',
    name: 'Repair orphaned WALLET-* payment queue rows, resync active merchant subscription statuses, and refresh baseline reconciliation',
    up(db, ctx) {
      let changed = false;
      const now = Date.now();

      if (!ctx.alreadyApplied) {
        // 1. Reconcile any orphaned pending internal WALLET-* subscription rows in db.payments
        // against their linked merchantSubscriptions / subscriptionRequests status.
        for (const p of db.payments || []) {
          if (p.type !== 'merchant_subscription' || p.status !== 'pending') continue;
          const codeUpper = String(p.code || '').trim().toUpperCase();
          if (!codeUpper.startsWith('WALLET-')) continue;

          const suffix = codeUpper.replace(/^WALLET-/, '');
          const matchedSub = (db.merchantSubscriptions || []).find(
            (s) =>
              s.merchantId === p.userId &&
              ((s.paymentCode && String(s.paymentCode).trim().toUpperCase() === codeUpper) ||
                s.id.slice(-6).toUpperCase() === suffix)
          );

          if (matchedSub) {
            if (matchedSub.status === 'active') {
              p.status = 'approved';
              p.approvedAt = matchedSub.approvedAt || matchedSub.startDate || now;
              p.verifiedAt = p.approvedAt;
              p.verifiedBy = p.verifiedBy || 'Migration 015 Ledger Sync';
              changed = true;
            } else if (matchedSub.status === 'declined') {
              p.status = 'rejected';
              p.rejectionReason = p.rejectionReason || 'Synchronized with declined wallet subscription record';
              changed = true;
            }
          }
        }

        // 2. Resync any merchant user whose merchantSubscriptions has a non-expired active subscription
        // while user.merchantSubscriptionStatus drifted (e.g. stuck on pending_verification or inactive).
        for (const u of db.users || []) {
          const activeSubs = (db.merchantSubscriptions || [])
            .filter((s) => s.merchantId === u.id && s.status === 'active' && s.expiresAt && s.expiresAt > now)
            .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
          if (activeSubs.length > 0) {
            const latestActive = activeSubs[0];
            if (
              u.merchantSubscriptionStatus !== 'active' ||
              u.merchantSubscriptionPlan !== latestActive.tierId ||
              Number(u.merchantSubscriptionExpiresAt || 0) < Number(latestActive.expiresAt || 0)
            ) {
              u.merchantSubscriptionStatus = 'active';
              u.merchantSubscriptionPlan = latestActive.tierId as any;
              u.merchantSubscriptionExpiresAt = latestActive.expiresAt;
              u.verified = true;
              u.verifiedAt = u.verifiedAt || latestActive.startDate || now;
              changed = true;
            }
          }
        }

        // 3. Record a clean baseline reconciliation report after double-count fix
        runWalletReconciliationInTx(db, 'scheduled');
        db.controlCenterIndexes = buildControlCenterIndexSnapshot(db);
        changed = true;
      }

      return changed;
    },
    down(db) {
      if (Array.isArray(db.reconciliationReports) && db.reconciliationReports.length > 1) {
        db.reconciliationReports.shift();
      }
      return true;
    },
  },
  {
    id: '016_sync_wallet_deposit_payments',
    name: 'Sync walletDeposits <-> payments queue records and backfill target wallet roles',
    up(db, ctx) {
      let changed = false;
      if (!db.walletDeposits) db.walletDeposits = [];
      if (!db.payments) db.payments = [];
      if (!db.walletLedger) db.walletLedger = [];

      const usersById = new Map<number, User>();
      for (const u of db.users || []) {
        usersById.set(Number(u.id), u);
      }

      const inferRole = (dep: any, payment: any, user: User | undefined): UserRole => {
        const explicit = dep?.role || payment?.role;
        if (explicit === 'member' || explicit === 'merchant' || explicit === 'lender' || explicit === 'admin') {
          return explicit;
        }
        const notes = `${payment?.notes || ''} ${payment?.channel || ''} ${dep?.notes || ''}`.toLowerCase();
        if (notes.includes('merchant wallet') || String(payment?.type || '').toLowerCase().includes('merchant')) {
          return 'merchant';
        }
        if (notes.includes('lender wallet')) return 'lender';
        if (notes.includes('admin wallet')) return 'admin';
        if (user) {
          if (user.activeRole === 'merchant' || user.role === 'merchant') return 'merchant';
          if (user.activeRole === 'lender' || user.role === 'lender') return 'lender';
          if (user.activeRole === 'admin' || user.role === 'admin') return 'admin';
          if (Array.isArray(user.roles) && user.roles.includes('merchant') && !user.roles.includes('member')) {
            return 'merchant';
          }
          return scrubRoleValue(user.activeRole || user.role);
        }
        return 'member';
      };

      const isDepositType = (t?: string) => {
        const lower = String(t || '').trim().toLowerCase();
        return lower === 'wallet_deposit' || lower === 'merchant_wallet_deposit' || lower === 'wallet_topup';
      };

      const paymentByCode = new Map<string, any>();
      for (const p of db.payments) {
        const codeUpper = String(p.code || '').trim().toUpperCase();
        if (codeUpper && isDepositType(p.type) && !paymentByCode.has(codeUpper)) {
          paymentByCode.set(codeUpper, p);
        }
      }

      const depositByCode = new Map<string, any>();
      for (const d of db.walletDeposits) {
        const codeUpper = String(d.mpesaCode || '').trim().toUpperCase();
        if (codeUpper && !depositByCode.has(codeUpper)) {
          depositByCode.set(codeUpper, d);
        }
      }

      // 1. Backfill missing roles on existing walletDeposits and create missing payment rows
      for (const d of db.walletDeposits) {
        const codeUpper = String(d.mpesaCode || '').trim().toUpperCase();
        const linkedPayment = codeUpper ? paymentByCode.get(codeUpper) : undefined;
        const owner = usersById.get(Number(d.userId));
        if (!d.role) {
          d.role = inferRole(d, linkedPayment, owner);
          changed = true;
        }
        if (linkedPayment && !linkedPayment.role) {
          linkedPayment.role = d.role;
          changed = true;
        }
        if (!linkedPayment && codeUpper) {
          const newPay: any = {
            id: db.nextIds.payment++,
            type: 'wallet_deposit',
            userId: d.userId,
            userName: d.userName || owner?.name || 'User',
            userPhone: d.userPhone || owner?.phone,
            role: d.role,
            code: codeUpper,
            amount: fromCents(toCents(d.amount)),
            status: d.status === 'approved' ? 'approved' : d.status === 'declined' ? 'rejected' : 'pending',
            rejectionReason: d.status === 'declined' ? d.notes || 'Declined' : undefined,
            channel: 'M-Pesa Deposit Till 196853',
            createdAt: d.createdAt || Date.now(),
            approvedAt: d.status === 'approved' ? d.processedAt || d.createdAt : undefined,
            verifiedAt: d.status === 'approved' ? d.processedAt || d.createdAt : undefined,
            verifiedBy: d.processedBy,
            notes: d.notes || `Wallet deposit of KSh ${d.amount} to ${d.role} wallet. Code: ${codeUpper}.`,
            __migrated016: true,
          };
          db.payments.unshift(newPay);
          paymentByCode.set(codeUpper, newPay);
          changed = true;
        }
      }

      // 2. Ensure every wallet_deposit payment has a matching walletDeposits record and ledger credit if approved
      for (const p of db.payments) {
        if (!isDepositType(p.type)) continue;
        const codeUpper = String(p.code || '').trim().toUpperCase();
        if (!codeUpper) continue;
        const owner = usersById.get(Number(p.userId));
        let dep = depositByCode.get(codeUpper);
        const resolvedRole = inferRole(dep, p, owner);
        if (!p.role) {
          p.role = resolvedRole;
          changed = true;
        }
        if (!dep) {
          dep = {
            id: `dep_mig_${p.id}_${codeUpper}`,
            userId: p.userId,
            userName: p.userName || owner?.name || 'User',
            userPhone: p.userPhone || owner?.phone || '',
            role: resolvedRole,
            amount: fromCents(toCents(p.amount)),
            mpesaCode: codeUpper,
            status: p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'declined' : 'pending',
            createdAt: p.createdAt || Date.now(),
            processedAt: p.status !== 'pending' ? p.approvedAt || p.verifiedAt || p.createdAt : undefined,
            processedBy: p.verifiedBy,
            notes: p.rejectionReason || p.notes || `Synced from Payment #${p.id}`,
            __migrated016: true,
          };
          db.walletDeposits.unshift(dep);
          depositByCode.set(codeUpper, dep);
          changed = true;
        }

        if (dep.status === 'approved' && owner) {
          const alreadyCredited = db.walletLedger.some(
            (e) =>
              e.category === 'DEPOSIT' &&
              (e.idempotencyKey === `dep_${dep.id}_${dep.mpesaCode}` ||
                (String(e.referenceId || '').trim().toUpperCase() === codeUpper && Number(e.userId) === Number(owner.id)))
          );
          if (!alreadyCredited && toCents(dep.amount) > 0) {
            creditWalletCents(db, {
              userId: owner.id,
              role: resolvedRole,
              amountCents: toCents(dep.amount),
              category: 'DEPOSIT',
              referenceId: dep.mpesaCode,
              idempotencyKey: `dep_${dep.id}_${dep.mpesaCode}`,
              note: `Migration 016 backfill for approved M-Pesa deposit ${dep.mpesaCode}`,
              actorId: 1,
            });
            changed = true;
          }
        }
      }

      if (!ctx.alreadyApplied || changed) {
        runWalletReconciliationInTx(db, 'scheduled');
        db.controlCenterIndexes = buildControlCenterIndexSnapshot(db);
        changed = true;
      }

      return changed;
    },
    down(db) {
      db.payments = (db.payments || []).filter((p: any) => !p.__migrated016);
      db.walletDeposits = (db.walletDeposits || []).filter((d: any) => !d.__migrated016);
      return true;
    },
  },
  {
    id: '017_enrich_deposit_queue_metadata',
    name: 'Backfill referenceNumber, paymentMethod, workflowStatus, amountCents, and declineReason on walletDeposits & payments',
    up(db, ctx) {
      let changed = false;
      if (!db.walletDeposits) db.walletDeposits = [];
      if (!db.payments) db.payments = [];

      const usersById = new Map<number, User>();
      for (const u of db.users || []) {
        usersById.set(Number(u.id), u);
      }

      const toWorkflowStatus = (st?: string) => {
        const lower = String(st || '').toLowerCase();
        if (lower === 'approved') return 'APPROVED' as const;
        if (lower === 'declined' || lower === 'rejected') return 'DECLINED' as const;
        if (lower === 'processing') return 'PROCESSING' as const;
        return 'PENDING' as const;
      };

      const payByCode = new Map<string, any>();
      for (const p of db.payments) {
        const codeKey = String(p.code || '').trim().toUpperCase();
        if (codeKey && !payByCode.has(codeKey)) {
          payByCode.set(codeKey, p);
        }
      }

      for (const d of db.walletDeposits) {
        const owner = usersById.get(Number(d.userId));
        const codeUpper = String(d.mpesaCode || '').trim().toUpperCase();
        const linkedPay = codeUpper ? payByCode.get(codeUpper) : undefined;
        const wf = toWorkflowStatus(d.status);

        if (!d.referenceNumber && codeUpper) {
          d.referenceNumber = codeUpper;
          changed = true;
        }
        if (!d.paymentMethod) {
          d.paymentMethod = linkedPay?.channel || 'M-Pesa Deposit Till 196853';
          changed = true;
        }
        if (!d.paymentReference && codeUpper && !codeUpper.startsWith('DEP')) {
          d.paymentReference = codeUpper;
          changed = true;
        }
        if (d.workflowStatus !== wf) {
          d.workflowStatus = wf;
          changed = true;
        }
        if (typeof d.amountCents !== 'number') {
          d.amountCents = toCents(d.amount);
          changed = true;
        }
        if (d.status === 'approved' && !d.approvedAt) {
          d.approvedAt = d.processedAt || linkedPay?.approvedAt || d.createdAt;
          changed = true;
        }
        if (d.status === 'declined') {
          if (!d.declinedAt) {
            d.declinedAt = d.processedAt || d.createdAt;
            changed = true;
          }
          if (!d.declineReason) {
            d.declineReason = linkedPay?.rejectionReason || d.notes || 'Declined by admin';
            changed = true;
          }
        }
        if (owner) {
          if (!d.shopName && owner.shopName) {
            d.shopName = owner.shopName;
            changed = true;
          }
          if (!d.userEmail && owner.email) {
            d.userEmail = owner.email;
            changed = true;
          }
          if (!d.platformId && owner.platformId) {
            d.platformId = owner.platformId;
            changed = true;
          }
        }

        if (linkedPay) {
          if (!linkedPay.referenceNumber) {
            linkedPay.referenceNumber = d.referenceNumber || codeUpper;
            changed = true;
          }
          if (!linkedPay.paymentMethod) {
            linkedPay.paymentMethod = d.paymentMethod;
            changed = true;
          }
          if (!linkedPay.paymentReference && d.paymentReference) {
            linkedPay.paymentReference = d.paymentReference;
            changed = true;
          }
          if (linkedPay.workflowStatus !== wf) {
            linkedPay.workflowStatus = wf;
            changed = true;
          }
          if (owner && !linkedPay.platformId && owner.platformId) {
            linkedPay.platformId = owner.platformId;
            changed = true;
          }
          if (owner && !linkedPay.userEmail && owner.email) {
            linkedPay.userEmail = owner.email;
            changed = true;
          }
        }
      }

      if (!ctx.alreadyApplied || changed) {
        db.controlCenterIndexes = buildControlCenterIndexSnapshot(db);
        changed = true;
      }

      return changed;
    },
    down(db) {
      for (const d of db.walletDeposits || []) {
        delete d.workflowStatus;
        delete d.referenceNumber;
        delete d.paymentMethod;
      }
      return true;
    },
  },
  {
    id: '018_wallet_deposit_constraints_and_backfill',
    name: 'Backfill missing merchant wallets, repair deposit rows with null merchantId/walletId/userId, and enforce NOT NULL + FK constraints',
    up(db, ctx) {
      let changed = false;
      if (!db.wallets) db.wallets = [];
      if (!db.walletDeposits) db.walletDeposits = [];
      if (!db.payments) db.payments = [];

      const usersById = new Map<number, User>();
      const usersByEmail = new Map<string, User>();
      const usersByPhone = new Map<string, User>();
      for (const u of db.users || []) {
        usersById.set(Number(u.id), u);
        if (u.email) usersByEmail.set(u.email.trim().toLowerCase(), u);
        if (u.phoneNormalized) usersByPhone.set(u.phoneNormalized.trim(), u);
        if (u.phone) usersByPhone.set(String(u.phone).trim(), u);
      }

      // 1. Backfill missing wallets for all existing merchants (and multi-role merchant holders)
      const prevWalletCount = db.wallets.length;
      for (const u of db.users || []) {
        if (u.isDisabled) continue;
        const holdsMerchant =
          u.role === 'merchant' ||
          u.activeRole === 'merchant' ||
          (Array.isArray(u.roles) && u.roles.includes('merchant'));
        if (holdsMerchant) {
          ensureWallet(db, u, 'merchant');
        }
        const primaryRole = scrubRoleValue(u.activeRole || u.role);
        ensureWallet(db, u, primaryRole);
      }
      if (db.wallets.length !== prevWalletCount) {
        changed = true;
      }

      // 2. Repair walletDeposits rows with null/missing userId, merchantId, or walletId
      const payByCode = new Map<string, any>();
      for (const p of db.payments) {
        const key = String(p.code || '').trim().toUpperCase();
        if (key && !payByCode.has(key)) {
          payByCode.set(key, p);
        }
      }

      for (const d of db.walletDeposits as any[]) {
        const codeUpper = String(d.mpesaCode || d.referenceNumber || '').trim().toUpperCase();
        const linkedPay = codeUpper ? payByCode.get(codeUpper) : undefined;

        // Repair null userId from merchantId, linked payment, email, or phone
        if (!Number.isInteger(d.userId) || Number(d.userId) <= 0) {
          let recoveredUserId: number | null = null;
          if (Number.isInteger(d.merchantId) && Number(d.merchantId) > 0 && usersById.has(Number(d.merchantId))) {
            recoveredUserId = Number(d.merchantId);
          } else if (linkedPay && Number.isInteger(linkedPay.userId) && usersById.has(Number(linkedPay.userId))) {
            recoveredUserId = Number(linkedPay.userId);
          } else if (d.userEmail && usersByEmail.has(String(d.userEmail).trim().toLowerCase())) {
            recoveredUserId = usersByEmail.get(String(d.userEmail).trim().toLowerCase())!.id;
          } else if (d.userPhone && usersByPhone.has(String(d.userPhone).trim())) {
            recoveredUserId = usersByPhone.get(String(d.userPhone).trim())!.id;
          }
          if (recoveredUserId) {
            d.userId = recoveredUserId;
            changed = true;
          }
        }

        const owner = usersById.get(Number(d.userId));
        if (!owner) continue;

        // Determine canonical role for the deposit
        const inferredRole: UserRole =
          d.role === 'merchant' || d.role === 'member' || d.role === 'lender' || d.role === 'admin'
            ? d.role
            : d.merchantId
            ? 'merchant'
            : linkedPay?.role === 'merchant' || linkedPay?.role === 'member' || linkedPay?.role === 'lender' || linkedPay?.role === 'admin'
            ? linkedPay.role
            : owner.activeRole === 'merchant' || owner.role === 'merchant'
            ? 'merchant'
            : scrubRoleValue(owner.activeRole || owner.role);

        if (d.role !== inferredRole) {
          d.role = inferredRole;
          changed = true;
        }

        // Repair null merchantId for merchant deposits
        if (inferredRole === 'merchant' && (!Number.isInteger(d.merchantId) || Number(d.merchantId) <= 0)) {
          d.merchantId = owner.id;
          changed = true;
        }

        // Ensure canonical wallet exists and repair null/invalid walletId FK
        const targetWallet = ensureWallet(db, owner, inferredRole);
        if (d.walletId !== targetWallet.id) {
          d.walletId = targetWallet.id;
          changed = true;
        }

        // Sync onto linked payment record if present
        if (linkedPay) {
          if (linkedPay.walletId !== targetWallet.id) {
            linkedPay.walletId = targetWallet.id;
            changed = true;
          }
          if (inferredRole === 'merchant' && linkedPay.merchantId !== d.merchantId) {
            linkedPay.merchantId = d.merchantId;
            changed = true;
          }
        }
      }

      // 3. Enable NOT NULL and Foreign Key schema constraints and validate immediately
      if (!db.schemaConstraints) db.schemaConstraints = {};
      if (!db.schemaConstraints.walletsEnforced || !db.schemaConstraints.walletDepositsEnforced) {
        db.schemaConstraints.walletsEnforced = true;
        db.schemaConstraints.walletDepositsEnforced = true;
        changed = true;
      }

      assertWalletAndDepositConstraints(db, { checkAllMerchants: true });

      if (!ctx.alreadyApplied || changed) {
        db.controlCenterIndexes = buildControlCenterIndexSnapshot(db);
        changed = true;
      }

      return changed;
    },
    down(db) {
      if (db.schemaConstraints) {
        delete db.schemaConstraints.walletsEnforced;
        delete db.schemaConstraints.walletDepositsEnforced;
        if (Object.keys(db.schemaConstraints).length === 0) {
          delete db.schemaConstraints;
        }
      }
      return true;
    },
  },
];

export async function runPendingMigrations(db: DatabaseSchema): Promise<{
  applied: string[];
  dirty: boolean;
}> {
  if (!db.migrationsApplied) {
    db.migrationsApplied = [];
  }
  const appliedIds = new Set(db.migrationsApplied.map((m) => m.id));
  const newlyApplied: string[] = [];
  let dirty = false;

  const maxUserId = (db.users || []).reduce((max, u) => Math.max(max, Number(u.id) || 0), 0);
  if (!db.nextIds.user || db.nextIds.user <= maxUserId) {
    db.nextIds.user = maxUserId + 1;
    dirty = true;
  }

  for (const migration of MIGRATIONS) {
    const alreadyApplied = appliedIds.has(migration.id);
    if (!alreadyApplied) {
      const modified = await migration.up(db, { alreadyApplied: false });
      db.migrationsApplied.push({
        id: migration.id,
        name: migration.name,
        appliedAt: Date.now(),
      });
      newlyApplied.push(migration.id);
      if (modified) dirty = true;
      dirty = true;
    } else {
      if (await migration.up(db, { alreadyApplied: true })) {
        dirty = true;
      }
    }
  }

  return { applied: newlyApplied, dirty };
}

export async function rollbackLastMigration(db: DatabaseSchema): Promise<{
  rolledBack: string | null;
}> {
  if (!db.migrationsApplied || db.migrationsApplied.length === 0) {
    return { rolledBack: null };
  }
  const last = db.migrationsApplied.pop()!;
  const def = MIGRATIONS.find((m) => m.id === last.id);
  if (def) {
    await def.down(db);
  }
  return { rolledBack: last.id };
}
