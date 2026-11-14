import { DatabaseSchema } from './db.js';
import { LOAN_PLATFORM_FEE_RATE, SUPPORT_EMAIL } from './config.js';
import { normalizeUsernameSeed } from './auth_utils.js';

export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: number;
}

export interface MigrationDefinition {
  id: string;
  name: string;
  up: (db: DatabaseSchema) => boolean;
  down: (db: DatabaseSchema) => boolean;
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
];

export function runPendingMigrations(db: DatabaseSchema): {
  applied: string[];
  dirty: boolean;
} {
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
    if (!appliedIds.has(migration.id)) {
      const modified = migration.up(db);
      db.migrationsApplied.push({
        id: migration.id,
        name: migration.name,
        appliedAt: Date.now(),
      });
      newlyApplied.push(migration.id);
      if (modified) dirty = true;
      dirty = true;
    } else {
      // Ensure idempotent defaults on newly added/loaded records even if migration was recorded
      if (migration.up(db)) {
        dirty = true;
      }
    }
  }

  return { applied: newlyApplied, dirty };
}

export function rollbackLastMigration(db: DatabaseSchema): {
  rolledBack: string | null;
} {
  if (!db.migrationsApplied || db.migrationsApplied.length === 0) {
    return { rolledBack: null };
  }
  const last = db.migrationsApplied.pop()!;
  const def = MIGRATIONS.find((m) => m.id === last.id);
  if (def) {
    def.down(db);
  }
  return { rolledBack: last.id };
}
