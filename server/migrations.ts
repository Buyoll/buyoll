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
import { ensureWallet } from './wallet_service.js';
import { User, UserRole } from '../src/types.js';
import { STANDARD_MEMBER_SPEEDS, buildAllSpeedOptions } from '../src/utils/speedOptions.js';

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
