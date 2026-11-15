# Buyoll Platform Improvements Changelog

## Item 1: Announcements and Notices (Admin-Only)
- **Migrations & Schema**: Added full announcement fields (`type`, `title`, `body`, `imageUrl`, `ctaLabel`, `ctaUrl`, `status`, `pinned`, `publishAt`, `expiresAt`, `targetAudience`, `revision`), `AnnouncementDismissal`, and `AnnouncementRevisionRecord`.
- **Backend (`/server/announcements_api.ts`, `/server/events.ts`)**: Enforced admin-only creation, editing, publish/unpublish, pin/unpin, delete, and image upload with MIME/size validation and Zod validation; public/non-admin callers only receive currently active published announcements; emits `announcement.updated` SSE events and logs all admin actions to `auditLogs`.
- **Frontend (`/src/components/AnnouncementsBanner.tsx`, `/src/pages/AdminDashboardPage.tsx`, `/src/pages/HomePage.tsx`)**: Added admin manager for text, image, or text+image promotional announcements with live SSE updates and per-user dismissal.

## Item 2: Yearly Billing, User Avatars, Real-Time Profile Sync, Draft Isolation & ProductCard Extensions
- **Migrations & Schema**: Added `tierOverrides`, `avatarUpdatedAt`, `publicationStatus`, and `productsInGroup` group-product associations.
- **Backend (`/server/subscriptions_api.ts`, `/server/profile_and_groups_api.ts`)**: Added configurable yearly billing fees (`yearlyFee`, `yearlyDiscountPercent`) on merchant tiers; added `PATCH /api/users/me` and multipart `POST /api/users/me/avatar` with SSE broadcast; enforced `includeDrafts` isolation (unauthenticated/non-owners never see drafts); added group product management endpoints (`/api/groups/:id/products`).
- **Frontend (`/src/components/Header.tsx`, `/src/pages/ProfilePage.tsx`, `/src/pages/VendorDashboardPage.tsx`, `/src/components/ProductCard.tsx`)**: Added Monthly/Yearly billing toggle in Merchant tier signup/management, avatar upload + header initials fallback, real-time `onProfileUpdate` callback across components, and `ProductCard` props (`groupId`, `isGroupManager`, `isInGroup`, `isDraft`, `isFeaturedInGroup`, `onAddToGroup`, `onRemoveFromGroup`, `onFeatureInGroup`, `onRequestLoan`).

## Item 3: Remove "Show admin-managed areas" Globally
- **Audit & Removal**: Removed the developer/helper switch and copy across all frontend components, routes, and storage keys (`buyoll_show_admin_areas`), ensuring admin UI visibility is driven strictly by authenticated user role (`ADMIN`).

## Item 4: Footer Cleanup & Centralized Support Email
- **Footer Cleanup (`/src/components/Footer.tsx`)**: Removed the `"Transparent Manual Payments"` block from the site footer cleanly.
- **Support Config (`/server/config.ts`, `/src/config/support.ts`, `/server/migrations.ts`)**: Centralized `SUPPORT_EMAIL = 'buyoll@customerservive.com'` across backend and frontend contact links and migrated seeded admin email away from legacy addresses.

## Item 5: Robust Authentication
- **Migrations & Schema**: Added `username`, `failedLoginCount`, `lockedUntil`, `tokenVersion`, `emailVerifiedAt`, `phoneVerifiedAt`, `RefreshTokenRecord`, and `PasswordResetRecord`.
- **Backend (`/server/auth_api.ts`, `/server/auth_utils.ts`)**: Implemented Sign Up (`/api/auth/register`), identifier Login (`email` | `phone` | `username`), scrypt password hashing, 5-attempt / 15-minute persisted account lockout, signed JWT access tokens + HTTP-only rotating refresh tokens with reuse detection (revoking token family + bumping `tokenVersion`), logout, password reset request/confirm, and username availability check (`/api/auth/check-username`).
- **Frontend (`/src/components/AuthModal.tsx`, `/src/context/UserContext.tsx`, `/src/api.ts`)**: Updated auth modal with real-time username availability feedback, show/hide password toggles, inline validation, Remember Me, and forgot-password flow plus silent 401 token refresh.

## Item 6: "Join This Group" Functionality
- **Migrations & Schema**: Added `joinPolicy` (`OPEN` | `APPROVAL` | `INVITE_ONLY`), `maxMembers`, `memberCode`, and `GroupJoinRequest` queue.
- **Backend (`/server/group_membership_api.ts`)**: Implemented stateful `GET /api/groups/:id` membership status, `POST /api/groups/:id/join` (`OPEN` instant join, `APPROVAL` request queue, `INVITE_ONLY` invite code validation, duplicate `409`, full `400`, role isolation `403`), cancel request, leave group with unsettled loan guard, and Moderator-only approve/reject/remove member + policy update endpoints.
- **Frontend (`/src/pages/GroupDetailPage.tsx`, `/src/App.tsx`, `/src/pages/HomePage.tsx`, `/src/pages/ProductDetailPage.tsx`)**: Added stateful `"Join This Group"` primary button, auth redirect return-to-group flow, `Request Sent / Cancel Request`, `Leave Group` React confirmation modal, Moderator admission policy selector, and join request approval queue.

## Item 7: Restore Loan Mechanism in Group Products
- **Config & Schema (`/server/config.ts`, `/server/migrations.ts`, `/src/types.ts`)**: Configured `LOAN_PLATFORM_FEE_RATE = 0.01`, `GroupLenderAuthorization`, `PlatformFeeEntry`, `restrictedLoanBalance`, and `restrictedLoanByGroup` with integer cents math (`toCents`, `fromCents`, `computeFeeCents`).
- **Backend (`/server/group_loans_api.ts`)**: Implemented group-scoped lender authorization/revocation (Moderator/Admin only), member loan request with borrower code, `contacted` status transition, atomic transactional loan funding (`409` idempotent double-fund guard, debits lender wallet by principal, records `1%` fee in `platformFees`, credits `99%` net to borrower's group-locked restricted balance), and strict enforcement blocking cash withdrawals (`400 LOAN_FUNDS_NOT_WITHDRAWABLE`) and off-group spending (`400 LOAN_FUNDS_GROUP_ONLY`).
- **Frontend (`/src/pages/GroupDetailPage.tsx`, `/src/pages/LendersDashboardPage.tsx`, `/src/pages/WalletPage.tsx`, `/src/components/Footer.tsx`, `/src/pages/ProductDetailPage.tsx`, `/src/pages/ProfilePage.tsx`)**: Updated P2P Loan Desk and Lenders Hub for moderator-authorized group lenders, `Mark Contacted`, atomic `1%` fee / `99%` group-locked funding modal, and explicit Wallet balance separation between Available Balance and Group-Locked Restricted Loan Balance.
