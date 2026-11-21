export type UserRole = 'member' | 'merchant' | 'admin' | 'lender';

export interface RoleWallet {
  credit: number;
  balance?: number;
  nonWithdrawableBalance?: number;
  coins: number;
  points: number;
}

export type RoleWallets = {
  member?: RoleWallet;
  merchant?: RoleWallet;
  lender?: RoleWallet;
  admin?: RoleWallet;
  [key: string]: RoleWallet | undefined;
};

export interface MerchantReview {
  id: string;
  userId: number;
  userName: string;
  rating: number; // 1 to 5
  comment: string;
  createdAt: number;
}

export type BillingPeriod = 'monthly' | 'yearly';

export type PaymentReceivingMode = 'paybill' | 'till' | 'pochi' | 'bank_paybill';

export interface PaymentReceivingDetails {
  mode: PaymentReceivingMode;
  paybillNumber?: string;
  accountNumber?: string;
  paybillAccount?: string;
  tillNumber?: string;
  pochiPhone?: string;
  pochiNumber?: string;
  bankName?: string;
  bankPaybillNumber?: string;
  bankAccountNumber?: string;
  accountName?: string;
}

export interface User {
  id: number;
  uuid?: string;
  name: string;
  phone?: string | null;
  phoneNormalized?: string | null;
  email?: string;
  password?: string;
  role: UserRole;
  roles?: UserRole[];
  activeRole?: UserRole;
  platformId?: string; // Unique customer permanent platform ID (e.g. BYL-M-30003)
  roleWallets?: RoleWallets;
  avatar?: string;
  avatarUrl?: string;
  shopName?: string;
  shopDescription?: string;
  verified?: boolean;
  verificationNotes?: string;
  merchantVerificationNotes?: string;
  verifiedAt?: number;
  isSuspended?: boolean;
  suspendReason?: string;
  isMuted?: boolean;
  merchantSubscriptionStatus?: 'inactive' | 'pending' | 'pending_verification' | 'active';
  merchantSubscriptionPlan?: 'starter' | 'pro' | 'enterprise' | 'tier_250' | 'tier_500' | 'tier_1500' | 'tier_3500' | 'tier_7500';
  merchantSubscriptionTxCode?: string;
  merchantSubscriptionExpiresAt?: number;
  referralCode?: string;
  referredBy?: string;
  starRating?: number; // 1 to 5
  ratingCount?: number;
  reviews?: MerchantReview[];
  tillNumber?: string; // e.g. merchant M-Pesa till
  paybillNumber?: string;
  paymentReceiving?: PaymentReceivingDetails;
  credit: number; // in KSh
  nonWithdrawableBalance?: number; // in KSh
  coins: number;
  points: number;
  merchantCategory?: string;
  sessionToken?: string;
  merchantLocation?: string;
  lenderName?: string;
  lenderType?: string;
  lenderLocation?: string;
  verification_status?: 'pending' | 'approved';
  preferences?: UserPreferences;
  username?: string;
  usernameDisplay?: string;
  usernameLower?: string;
  usernameNormalized?: string;
  avatarUpdatedAt?: number;
  restrictedLoanBalance?: number;
  restrictedLoanByGroup?: Record<number, number>;
  failedLoginCount?: number;
  lockedUntil?: number | null;
  tokenVersion?: number;
  isDisabled?: boolean;
  disabledAt?: number | null;
  disabledReason?: string | null;
  adminPasskeyHash?: string;
  lastPasswordChangedAt?: number | null;
  lastPasskeyChangedAt?: number | null;
  securityBannerDismissedAt?: number | null;
  securityBannerSnoozedUntil?: number | null;
  passwordHmac?: string;
  mustChangeCredentials?: boolean;
  mustResetPassword?: boolean;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  emailVerifiedAt?: number;
  phoneVerifiedAt?: number;
  lastActive: number;
  createdAt: number;
  updatedAt?: number;
}

export interface UserPreferences {
  pushNotificationsEnabled?: boolean;
  smsAlertsEnabled?: boolean;
  instantPayReminderEnabled?: boolean;
  autoRollAnnouncementsEnabled?: boolean;
  theme?: 'light' | 'dark';
  enterprisePriceAgreed?: boolean;
  enterpriseAgreedPrice?: number;
}

export interface SpeedOption {
  size: number; // number of members: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
  cycleDays: number; // e.g., 10 days per member distribution, or up to 180 days for 1-member Lipa Mdogomdogo
  dailyAmount: number; // KSh / day
  totalAmount: number; // Total product price
  description?: string;
}

export interface ProductAIInquiry {
  id: string;
  userId?: number;
  userName?: string;
  question: string;
  answer: string;
  timestamp: number;
}

export interface Product {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;
  wasPrice?: number;
  discountPercent?: number;
  images: string[];
  vendorId: number;
  vendorName: string;
  isFeatured?: boolean;
  featuredRequestId?: string | null;
  featuredPlacementKey?: string | null;
  featuredEndsAt?: number | null;
  live: boolean;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publicationStatus?: 'draft' | 'posted';
  publishedAt?: number | null;
  hiddenReason?: 'SUBSCRIPTION_EXPIRED' | 'MERCHANT_DRAFT' | 'ADMIN_REMOVED' | null;
  hiddenAt?: number | null;
  paymentReceiving?: PaymentReceivingDetails;
  moderationStatus: 'approved' | 'pending' | 'returned';
  moderationNote?: string;
  speedOptions: SpeedOption[];
  stockQuantity: number;
  attributes?: Record<string, string>;
  // Trip & Stay Media (up to 3 photos, up to 2 videos)
  videos?: string[];
  isTripListing?: boolean;
  // Promotions and free bonus items:
  promotionType?: 'none' | 'daily' | 'weekly' | 'monthly';
  promotionDiscount?: number;
  bonusGift?: string; // e.g. "Free Phone", "Smart Watch", "Luxury Soap Pack", "KSh 200 Airtime", etc.
  aiInquiries?: ProductAIInquiry[];
  createdAt: number;
  updatedAt: number;
}

export interface DailyPaymentRecord {
  day: number;
  code: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
  rejectionReason?: string;
}

export interface GroupSlot {
  slotNumber: number; // 1 to size
  userId: number | null;
  userName: string | null;
  userPhone?: string | null;
  userAvatar?: string | null; // Circle profile photo in upper right corner
  status: 'active' | 'open' | 'replacement_eligible' | 'defaulted';
  inviteCode: string;
  paidAmount: number;
  targetAmount: number;
  paidDays?: number[]; // list of days that have been approved (e.g. [1, 2, 3])
  pendingDays?: number[]; // list of days with pending submission (e.g. [4])
  dailyPaymentRecords?: DailyPaymentRecord[];
  lastPaymentDate?: number;
  joinedAt?: number;
  memberCode?: string | null;
  referredByCode?: string | null;
  isDefaulter?: boolean;
  // Chama Priority and Payout Logic Engine
  priorityLevel?: 'Best' | 'Better' | 'Good';
  memberStatus?: 'good_standing' | 'slow_payer' | 'dormant';
  slowPayerSince?: number;
  consecutiveOnTimeCycles?: number;
  dormantSince?: number;
  dormantWarning?: {
    date: number;
    reason: string;
    moderatorName: string;
    deadline: number;
    active: boolean;
  };
  paidOut?: boolean;
  deliveryDay?: number;
  progressPercent?: number;
}

export type GroupChatTopic = 'general' | 'goal' | 'coordination' | 'reminder';

export interface GroupChatMessage {
  id: string;
  senderId: number;
  senderName: string;
  senderRole?: string;
  kind?: 'normal' | 'reward' | 'nudge' | 'system';
  topic?: GroupChatTopic;
  text: string;
  pinned?: boolean;
  pinnedBy?: number;
  pinnedAt?: number;
  replyToId?: string;
  replyToSender?: string;
  replyToSnippet?: string;
  clientMsgId?: string;
  isFlagged?: boolean;
  timestamp: number;
}

export interface GroupChatPresenceMember {
  userId: number;
  name: string;
  roleLabel: string;
}

export interface GroupChatGoalSummary {
  totalCollected: number;
  totalTarget: number;
  progressPercent: number;
  activeMembers: number;
  maxMembers: number;
  completedRounds: number;
  dailyAmount: number;
  cycleDays: number;
  payoutOption?: 'turn_by_turn' | 'end_together';
}

export interface GroupNotification {
  id: string;
  groupId: number;
  groupName: string;
  recipientUserId?: number; // if null, broadcast to entire group or system
  title: string;
  message: string;
  link?: string;
  type: 'payment_submitted' | 'payment_approved' | 'missed_payment' | 'loan_request' | 'new_group_created' | 'invite_requested' | 'invite_approved' | 'invite_declined' | 'system';
  timestamp: number;
}

export interface GroupInviteRequest {
  id: string;
  groupId: number;
  groupName: string;
  userId: number;
  userName: string;
  userPhone: string;
  desiredSlot?: number;
  note?: string;
  status: 'pending' | 'approved' | 'declined';
  issuedCode?: string;
  createdAt: number;
  decidedAt?: number;
}

export interface HelpChatMessage {
  id: string;
  userId?: number;
  userName: string;
  userRole?: string;
  category: 'inquiry' | 'complaint' | 'feedback' | 'general';
  text: string;
  adminReply?: string;
  timestamp: number;
}

export interface DeliveredRound {
  roundNumber: number;
  recipientSlot: number;
  recipientName: string;
  deliveredAt: number;
  totalPaid: number;
}

export type GroupJoinPolicy = 'OPEN' | 'APPROVAL' | 'INVITE_ONLY';

export interface GroupProductEntry {
  productId: number;
  addedBy: number;
  addedAt: number;
  isFeatured?: boolean;
  featured?: boolean;
  sortOrder?: number;
  order?: number;
}

export interface ChamaGroup {
  id: number;
  productId: number;
  productTitle: string;
  productPrice: number;
  productImage?: string;
  name: string;
  size: number;
  totalSlots?: number;
  vendorId?: number;
  adminId: number; // initial creator or primary moderator
  moderatorId?: number | null; // assigned automatically to first joining member
  moderators: number[]; // array of userIds
  status: 'active' | 'full' | 'completed' | 'cancelled';
  inviteCode: string;
  dailyAmount: number;
  cycleDays: number;
  paymentDurationDays?: number;
  payoutOption?: 'turn_by_turn' | 'end_together';
  payoutOptionSetBy?: number | null;
  payoutAgreedUserIds?: number[];
  payoutLocked?: boolean;
  payoutLockedAt?: number;
  paymentReceiving?: PaymentReceivingDetails;
  slots: GroupSlot[];
  occupiedCount: number;
  availableCount: number;
  chat: GroupChatMessage[];
  notifications?: GroupNotification[];
  createdAt: number;
  // Payment Collection Mode: Option A (merchant till) vs Option B (platform till)
  paymentMode?: 'platform' | 'merchant';
  // Manual Till & Paybill details (No escrow):
  platformTill?: string; // '196853'
  platformPaybill?: string; // '522533'
  platformAccount?: string; // 'code4363'
  merchantTill?: string; // e.g. '3463533' or custom
  merchantPaybill?: string; // e.g. '26253326'
  merchantAccount?: string; // e.g. 'Code4533'
  // Group contribution round / cycle tracking:
  currentRound?: number; // 1 to size
  currentRecipientSlot?: number; // Slot # of the member who receives this round's item
  currentRoundPaid?: number; // Total paid by members towards this round's item
  targetAmountPerRound?: number; // Equals productPrice
  roundBalanceRemaining?: number; // productPrice - currentRoundPaid
  isReadyForPickup?: boolean; // true when currentRoundPaid >= productPrice
  deliveredRounds?: DeliveredRound[];
  // Dedicated 1-lender per group rule:
  lenderId?: number | null;
  lenderName?: string | null;
  lenderJoinedAt?: number | null;
  // Invite-only and Entry requests
  isInviteOnly?: boolean;
  joinPolicy?: GroupJoinPolicy;
  maxMembers?: number;
  productsInGroup?: GroupProductEntry[];
  inviteRequests?: GroupInviteRequest[];
  // Chama activity feed
  activities?: ChamaActivityItem[];
  // Slot reordering and status audit logs (system-generated & moderator warnings)
  slotAuditLogs?: Array<{
    id: string;
    timestamp: number;
    type: 'system_slot_reorder' | 'moderator_warning' | 'priority_change' | 'status_change';
    description: string;
    actorName: string;
    isSystemGenerated?: boolean;
    details?: any;
    previousSlot?: number;
    newSlot?: number;
    slotNumber?: number;
    reason?: string;
  }>;
  theme?: 'light' | 'dark';
}

export interface ChamaActivityItem {
  id: string;
  groupId: number;
  type: 'contribution' | 'loan_application' | 'loan_funded' | 'status_update' | 'coin_award' | 'member_joined';
  title: string;
  description: string;
  amount?: number;
  coins?: number;
  mpesaCode?: string;
  actorId?: number;
  actorName: string;
  actorAvatar?: string;
  targetSlotNumber?: number;
  targetUserId?: number;
  targetUserName?: string;
  timestamp: number;
}

export interface WalletDepositRequest {
  id: string;
  userId: number;
  userName: string;
  userPhone: string;
  role?: string;
  amount: number;
  mpesaCode: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: number;
  processedAt?: number;
  processedBy?: string;
  notes?: string;
}

export interface DefaultRecord {
  id: number;
  userId: number;
  userName: string;
  groupId: number;
  groupName: string;
  slotNumber: number;
  productTitle: string;
  totalObligation: number;
  amountPaid: number;
  amountOutstanding: number;
  defaultDate: number;
  reason: string;
  replacementStatus: 'available' | 'claimed';
  replacementUserId?: number;
  resolutionOption?: 'refund' | 'store_credit' | 'alternate_purchase';
  resolutionStatus: 'pending' | 'completed';
  refundRequestId?: number;
}

export interface RefundRequest {
  id: number;
  userId: number;
  userName: string;
  userPhone: string;
  defaultRecordId: number;
  groupId: number;
  productTitle: string;
  amountPaid: number;
  eligibleRefundAmount: number;
  status: 'requested' | 'under_review' | 'approved' | 'processing' | 'completed' | 'rejected';
  adminNote?: string;
  requestedAt: number;
  processedAt?: number;
}

export interface MpesaStatementRecord {
  code: string;
  amount: number;
  phone?: string;
  payerName?: string;
  senderName?: string;
  tillOrPaybill?: string;
  timestamp?: number | string;
  channel?: string;
}

export interface PaymentRecord {
  id: number;
  type: 'group_installment' | 'listing_fee' | 'coin_purchase' | 'loan_fee' | 'merchant_subscription' | 'wallet_deposit';
  userId: number;
  userName: string;
  code: string; // M-Pesa transaction reference
  amount: number;
  groupId?: number;
  groupName?: string;
  slotNumber?: number;
  productId?: number;
  loanId?: number;
  daysPaid?: number[]; // e.g. [1] or [1, 2]
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  matchedTillEntry?: MpesaStatementRecord;
  idempotencyKey?: string;
  userPhone?: string;
  role?: UserRole;
  targetWalletRole?: string;
  payerRole?: string;
  shopName?: string;
  channel?: string;
  verifiedAt?: number | null;
  verifiedBy?: string | null;
  notes?: string;
  createdAt: number;
  approvedAt?: number;
}

export interface CoinLedgerEntry {
  id: string | number;
  senderId: number;
  senderName: string;
  recipientId: number;
  recipientName: string;
  amount: number;
  senderBalanceAfter?: number;
  recipientBalanceAfter?: number;
  type: 'member_award' | 'platform_reward' | 'reward_platform' | 'coin_deposit' | 'loan_funding' | 'transfer' | 'deposit';
  note?: string;
  reason?: string;
  timestamp: number;
}

export interface ChatModerationEvent {
  id: string;
  groupId?: number;
  groupName?: string;
  messageId?: string;
  senderId?: number;
  senderName?: string;
  targetUserId?: number;
  targetUserName?: string;
  messageText?: string;
  action: string;
  reason: string;
  adminId?: number;
  adminName?: string;
  moderatorId?: number;
  moderatorName?: string;
  timestamp: number;
}


export interface StoreCreditLedgerEntry {
  id: number;
  userId: number;
  amount: number; // + or -
  balanceAfter: number;
  type: 'default_conversion' | 'point_redemption' | 'purchase_deduction' | 'admin_adjustment' | 'loan_disbursement' | 'loan_funding' | 'loan_commission' | 'deposit' | 'refund_credit' | 'transfer_out';
  referenceId?: string;
  note: string;
  createdAt: number;
}

export interface PeerLoanRequest {
  id: number;
  groupId: number;
  groupName: string;
  slotNumber: number;
  requesterId: number;
  requesterName: string;
  requesterPhone?: string;
  borrowerId?: number;
  borrowerName?: string;
  productTitle?: string;
  productImage?: string;
  amount: number;
  requestedAmount?: number;
  approvedAmount?: number;
  purpose: string;
  repaymentPeriod?: string;
  repaymentDays?: number;
  status: 'open' | 'contacted' | 'fee_pending' | 'fee_verified' | 'funded' | 'cancelled';
  createdAt: number;
  fundedByUserId?: number;
  fundedByUserName?: string;
  lenderName?: string;
  fundedAt?: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  platformFeePaymentCode?: string;
  platformFeeStatus: 'pending' | 'submitted' | 'approved' | 'paid';
  externalAgreementAcknowledged: boolean;
  borrowerCode?: string;
  lenderId?: number | null;
  productId?: number;
  feeRate?: number;
  platformFeeCents?: number;
  netDisbursedCents?: number;
  netDisbursedAmount?: number;
  contactedAt?: number | null;
  contactedBy?: number | null;
  contactedByName?: string | null;
  lenderIdempotencyKey?: string;
}

export interface MemberStatement {
  user: User;
  totalPaid: number;
  currentCredit: number;
  activeSlots: {
    groupId: number;
    groupName: string;
    productTitle: string;
    slotNumber: number;
    dailyAmount: number;
    targetAmount: number;
    paidAmount: number;
    progressPercent: number;
    cycleDays: number;
    deliveryDay: number;
    status: string;
  }[];
  transactions: {
    id: number;
    date: number;
    reference: string;
    type: string;
    description: string;
    debit?: number;
    credit?: number;
    status: string;
  }[];
}

export interface AuditLog {
  id: number;
  timestamp: number;
  actorId: number;
  actorName: string;
  action: string;
  details: string;
}

export type AnnouncementType = 'NOTICE' | 'ANNOUNCEMENT' | 'PROMOTION';
export type AnnouncementAudience = 'ALL' | 'MEMBERS' | 'MERCHANTS';
export type AnnouncementLifecycleStatus = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';

export interface Announcement {
  id: string | number;
  title: string;
  body: string;
  imageUrl?: string | null;
  category?: string;
  type?: AnnouncementType;
  audience?: AnnouncementAudience;
  status?: AnnouncementLifecycleStatus;
  pinned?: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
  ctaLabel?: string;
  ctaUrl?: string;
  publishedAt?: number | null;
  archivedAt?: number | null;
  createdBy?: number;
  updatedBy?: number;
  version?: number;
  createdAt: number;
  updatedAt?: number;
  authorId?: number;
  authorName?: string;
  productId?: number;
  isSystemGenerated?: boolean;
  isFeaturedBadge?: boolean;
}

export interface AnnouncementDismissal {
  id: string;
  announcementId: string | number;
  userId: number;
  dismissedAt: number;
}

export interface AnnouncementRevisionRecord {
  id: string;
  announcementId: string | number;
  snapshot: Partial<Announcement>;
  changedBy: number;
  changedByName: string;
  changedAt: number;
}

export interface SupportTicketReply {
  id: string;
  authorId: number;
  authorName: string;
  isAdmin: boolean;
  text: string;
  createdAt: number;
}

export interface SupportTicket {
  id: string;
  userId: number;
  userName: string;
  userEmail?: string;
  userPhone?: string;
  subject: string;
  message: string;
  category: 'inquiry' | 'payment' | 'chama' | 'technical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: number;
  updatedAt: number;
  replies?: SupportTicketReply[];
}

export interface UserNotification {
  id: string | number;
  userId: number;
  title: string;
  message: string;
  type: 'broadcast' | 'order' | 'group' | 'warning' | 'chat' | 'payment' | 'verification' | 'system';
  groupId?: number;
  link?: string;
  read: boolean;
  timestamp: number;
}

export interface DeliveryAddress {
  id: string;
  userId: number;
  fullName: string;
  phone: string;
  county: string;
  city: string;
  streetAddress: string;
  isDefault: boolean;
  createdAt: number;
}

export interface MemberOrder {
  id: string;
  userId: number;
  groupId: number;
  groupName: string;
  productId: number;
  productTitle: string;
  productImage?: string;
  productPrice: number;
  slotNumber: number;
  speed: number;
  status: 'pending' | 'in_progress' | 'confirmed' | 'delivered' | 'cancelled';
  totalPaid: number;
  targetAmount: number;
  expectedDeliveryDate?: number;
  deliveredAt?: number;
  createdAt: number;
}

export interface MerchantSubscriptionTier {
  id: 'tier_250' | 'tier_500' | 'tier_1500' | 'tier_3500' | 'tier_7500' | 'enterprise';
  name: string;
  monthlyFee: number;
  yearlyFee?: number;
  yearlyDiscountPercent?: number;
  maxProducts: number; // -1 for unlimited
  maxGroupsPerProduct: number;
  maxActiveFeatured?: number;
  maxPendingFeatured?: number;
  maxFeaturedDaysPerRequest?: number;
  allowedDurations?: number[];
  allowedPlacements?: string[];
  featuredDiscountPercent?: number;
  description: string;
  features: string[];
}

export interface MerchantExemption {
  requirement: 'physical_shop' | 'trading_licence' | 'id_or_passport' | 'three_years_operating' | 'shop_visit' | 'all';
  reason: string;
  grantedBy: string;
  grantedAt: number;
}

export interface MerchantVerificationRecord {
  merchantId: number;
  status: 'pending_review' | 'visit_scheduled' | 'visit_completed' | 'verified' | 'declined';
  hasPhysicalShop: boolean;
  tradingLicenceNumber?: string;
  tradingLicenceUrl?: string;
  nationalIdOrPassport: string;
  yearsOperating: number;
  businessType?: string;
  shopLocation: string;
  shopVisitScheduledAt?: number;
  shopVisitCompletedAt?: number;
  shopVisitRepresentative?: string;
  shopVisitNotes?: string;
  shopVisitPhotos?: string[];
  advertInstalledAt?: number;
  advertPhotoUrl?: string;
  exemptions?: MerchantExemption[];
  declineReason?: string;
  submittedAt: number;
  reviewedAt?: number;
}

export interface MerchantSubscriptionRecord {
  id: string;
  merchantId: number;
  tierId: string;
  tierName: string;
  billingPeriod?: BillingPeriod;
  billingInterval?: 'MONTHLY' | 'YEARLY';
  autoRenew?: boolean;
  canceledAt?: number | null;
  currentPeriodEnd?: number | null;
  amount: number;
  paymentMethod: 'wallet_coins' | 'wallet_credit' | 'mpesa_till_paybill';
  paymentCode?: string;
  status: 'pending' | 'active' | 'expired' | 'declined' | 'cancelled' | 'rejected';
  startDate?: number;
  expiresAt?: number;
  approvedBy?: number;
  approvedAt?: number;
  createdAt: number;
  notes?: string;
}

export interface GroupJoinRequest {
  id: string;
  groupId: number;
  userId: number;
  userName: string;
  userPhone?: string;
  userAvatar?: string;
  desiredSlot?: number;
  note?: string;
  referralCode?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedBy?: number | null;
  reviewedAt?: number | null;
  reason?: string;
  createdAt: number;
}

export interface GroupCallerMembership {
  isMember: boolean;
  isModerator: boolean;
  joinPolicy: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY';
  maxMembers: number;
  occupiedCount: number;
  isFull: boolean;
  joinRequestStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  pendingRequestId: string | null;
  memberCode: string | null;
  slotNumber: number | null;
  canJoin: boolean;
  pendingJoinRequestsCount: number;
}

export interface GroupLenderAuthorization {
  id: string;
  groupId: number;
  userId: number;
  userName: string;
  userPhone?: string;
  authorizedBy: number;
  authorizedByName: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: number;
  revokedAt?: number | null;
}

export interface PlatformFeeEntry {
  id: string;
  loanId: number;
  groupId: number;
  lenderId: number;
  borrowerId: number;
  grossAmountCents: number;
  feeRate: number;
  feeAmountCents: number;
  netAmountCents: number;
  createdAt: number;
}

export interface RefreshTokenRecord {
  id: string;
  userId: number;
  role?: UserRole;
  tokenHash: string;
  rememberMe: boolean;
  expiresAt: number;
  revokedAt?: number | null;
  createdAt: number;
}

export interface PasswordResetRecord {
  id: string;
  userId: number;
  tokenHash: string;
  codeHash?: string;
  contact?: string;
  expiresAt: number;
  usedAt?: number | null;
  createdAt: number;
}

export interface SubscriptionRequest {
  id: string;
  merchantId: number;
  merchantName?: string;
  shopName?: string;
  phone?: string;
  email?: string;
  planId: string;
  planKey?: string;
  planName: string;
  billingPeriod?: BillingPeriod;
  amountExpected: number;
  paymentMethod: 'mpesa' | 'wallet' | 'coins';
  mpesaCode?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminId?: number;
  approvedBy?: number;
  approvedAt?: number;
  reviewedAt?: number;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatStrikeRecord {
  userId: number;
  userName: string;
  strikeCount: number;
  isMuted: boolean;
  mutedUntil?: number;
  isBlacklisted: boolean;
  blacklistReason?: string;
  lastViolationAt: number;
  warnings?: Array<{ reason: string; timestamp: number }>;
}

// -------------------------------------------------------------
// FEATURE A: CHAMA TRUST & VETTED REFERRAL GROUPS
// -------------------------------------------------------------
// FEATURE A: CHAMA TRUST & VETTED REFERRAL GROUPS
// -------------------------------------------------------------
export interface TrustChamaGroup {
  id: string;
  name: string;
  description: string;
  contributionAmount: number;
  cycleType: 'weekly' | 'biweekly' | 'monthly';
  rules?: string;
  contributionNote?: string;
  createdBy: string; // creator user email
  moderatorEmails: string[];
  status: 'active' | 'closed';
  maxMembers: number;
  createdAt: number;
}

export type GroupMemberRole = 'moderator' | 'member';
export type GroupMemberStatus = 'active' | 'suspended' | 'defaulted' | 'removed';

export interface TrustGroupMember {
  id: string;
  groupId: string;
  userEmail: string;
  userName: string;
  name?: string;
  phone: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  memberCode: string; // CH-XXXX-XXXX
  referredByMemberId: string | null;
  workplace: string;
  residence: string;
  joinedAt: number;
}

export type JoinRelationship =
  | 'family'
  | 'close_friend'
  | 'coworker'
  | 'colleague'
  | 'neighbor'
  | 'neighbour'
  | 'church_or_community'
  | 'church_mosque';

export type ReferrerConfirmation = 'pending' | 'yes' | 'no';
export type JoinRequestStatus =
  | 'awaiting_referrer'
  | 'awaiting_moderator_call'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export interface VettingCallLog {
  calledAt: number;
  calledByEmail: string;
  phoneCalled?: string;
  spokeWithReferrer?: boolean;
  confirmedWorkplaceResidence?: boolean;
  referrerKnowsWorkplaceOrResidence?: boolean;
  referrerAcceptsResponsibility?: boolean;
  notes: string;
}

export interface TrustJoinRequest {
  id: string;
  groupId: string;
  applicantEmail: string;
  applicantName: string;
  applicantPhone: string;
  employer?: string;
  workplaceAddress?: string;
  applicantWorkplace?: string;
  residentialAddress?: string;
  residentialLandmark?: string;
  applicantResidence?: string;
  referralCode: string;
  referrerMemberId: string;
  relationship: JoinRelationship | string;
  yearsKnown: number;
  referrerConfirmed: ReferrerConfirmation | string;
  status: JoinRequestStatus | string;
  vetting?: VettingCallLog;
  vettingCallLog?: VettingCallLog;
  rejectionReason?: string;
  decidedBy?: string;
  decidedAt?: number;
  createdAt: number;
}

export interface MemberTraceCard {
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberCode: string;
  memberStatus: GroupMemberStatus;
  joinedAt: number;
  referrerName: string;
  referrerPhone: string;
  vouchedAt: number;
  employer: string;
  workplaceAddress: string;
  residentialAddress: string;
  residentialLandmark: string;
  vettingModeratorName: string;
  vettedAt: number;
  vettingNotes?: string;
}

// -------------------------------------------------------------
// FEATURE B: ADMIN-EDITABLE PLATFORM ANNOUNCEMENTS (3 CARDS)
// -------------------------------------------------------------
export type AnnouncementBadge = 'Notice' | 'Update' | 'Promo' | string;
export type AnnouncementAccent = 'pink' | 'violet' | 'emerald' | 'amber' | 'sky';
export type AnnouncementStatus = 'draft' | 'published';

export interface PlatformAnnouncementSlot {
  slot: 1 | 2 | 3;
  title: string;
  message: string;
  badge: AnnouncementBadge;
  accent: AnnouncementAccent;
  ctaLabel?: string;
  ctaUrl?: string;
  status?: AnnouncementStatus;
  isPublished?: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
  updatedBy: string;
  updatedAt: number | string;
  version: number;
}

export interface PlatformAnnouncementRevision {
  id: string;
  slot: 1 | 2 | 3;
  snapshot?: PlatformAnnouncementSlot;
  version?: number;
  title?: string;
  message?: string;
  badge?: string;
  accent?: string;
  changedBy?: string;
  changedAt?: number;
  updatedBy?: string;
  timestamp?: number;
}

export interface SessionRecord {
  id: string;
  userId: number;
  role: UserRole;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  revokedAt?: number | null;
  revokeReason?: string | null;
  userAgent?: string;
  ip?: string;
  lastReauthAt?: number;
}

export interface OtpChallengeRecord {
  id: string;
  purpose: 'forgot_password' | 'forgot_username' | 'admin_forgot';
  userId?: number | null;
  contact: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  maxAttempts: number;
  verifiedAt?: number | null;
  verificationTokenHash?: string | null;
  consumedAt?: number | null;
  createdAt: number;
}

export interface SubscriptionActivationNotice {
  id: string;
  merchantId: number;
  subscriptionId: string;
  planId: string;
  planName: string;
  billingPeriod: BillingPeriod;
  expiresAt: number;
  createdAt: number;
  seenAt?: number | null;
}

export interface WalletRecord {
  id: string;
  userId: number;
  role: UserRole;
  balanceCents: number;
  updatedAt: number;
  createdAt: number;
}

export type WalletLedgerCategory =
  | 'DEPOSIT'
  | 'SUBSCRIPTION_PAYMENT'
  | 'SUBSCRIPTION_REVENUE'
  | 'PROMOTION_PAYMENT'
  | 'PROMOTION_REVENUE'
  | 'FEATURED_HOLD'
  | 'FEATURED_REVENUE'
  | 'FEATURED_REFUND'
  | 'LOAN_FUNDING'
  | 'LOAN_DISBURSEMENT'
  | 'GROUP_INSTALLMENT'
  | 'PLATFORM_FEE'
  | 'ADMIN_ADJUSTMENT'
  | 'REFUND'
  | 'MIGRATION_OPENING_BALANCE';

export interface WalletLedgerRecord {
  id: string;
  walletId: string;
  userId: number;
  role: UserRole;
  direction: 'CREDIT' | 'DEBIT';
  amountCents: number;
  balanceAfterCents: number;
  category: WalletLedgerCategory;
  referenceId?: string;
  idempotencyKey?: string;
  note: string;
  actorId?: number;
  createdAt: number;
}

export interface EmailOutboxRecord {
  id: string;
  to: string;
  subject: string;
  body: string;
  kind: 'security_alert' | 'otp' | 'credential_changed' | 'subscription_notice' | 'general';
  userId?: number;
  createdAt: number;
  meta?: Record<string, any>;
}

// ==============================================================
// PAID FEATURED PLACEMENTS, TIER LIMITS, MODERATION & ANALYTICS
// ==============================================================
export type FeaturedRequestStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REMOVED';

export interface FeaturedPlacement {
  key: string;
  name: string;
  description?: string;
  maxSlots: number;
  enabled: boolean;
  sortOrder: number;
  updatedAt?: number;
}

export interface FeaturedPricing {
  id: string;
  placementKey: string;
  durationDays: number;
  priceCents: number;
  currency: 'KES';
  active: boolean;
  updatedAt?: number;
}

export interface TierFeaturedLimits {
  tierId: string;
  maxActiveFeatured: number;
  maxPendingFeatured: number;
  maxFeaturedDaysPerRequest: number;
  allowedDurations: number[];
  allowedPlacements: string[];
  featuredDiscountPercent: number;
  updatedAt?: number;
}

export interface FeaturedSettings {
  featuredRequiresGroup: boolean;
  takedownRefundMode: 'none' | 'prorata';
  extendOnSubExpiry: boolean;
  defaultMaxDays: number;
  allowedDurations: number[];
  expirySweepMs: number;
  updatedAt?: number;
}

export interface FeaturedRequest {
  id: string;
  merchantId: number;
  productId: number;
  placementKey: string;
  durationDays: number;
  tierIdSnapshot: string;
  basePriceCents: number;
  discountPercent: number;
  amountPaidCents: number;
  currency: 'KES';
  status: FeaturedRequestStatus;
  requestedStartAt?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
  approvedAt?: number | null;
  approvedBy?: number | null;
  rejectedAt?: number | null;
  rejectedBy?: number | null;
  rejectionReason?: string | null;
  cancelledAt?: number | null;
  removedAt?: number | null;
  removedBy?: number | null;
  removalReason?: string | null;
  refundedCents?: number;
  idempotencyKey?: string;
  holdLedgerId?: string;
  revenueLedgerId?: string;
  refundLedgerId?: string;
  expiryWarnedAt?: number | null;
  expiredNotifiedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface FeaturedStatsDaily {
  id: string;
  featuredRequestId: string;
  productId: number;
  merchantId: number;
  date: string; // YYYY-MM-DD (Africa/Nairobi EAT)
  impressions: number;
  uniqueViewers: number;
  uniqueViewerKeys?: string[];
  clicks: number;
  productViews: number;
  joins: number;
  orders: number;
}

export interface MerchantLimitsSummary {
  merchantId: number;
  hasActiveSubscription: boolean;
  isExpired: boolean;
  subscriptionStatus: string;
  tierId: string;
  tierName: string;
  expiresAt: number | null;
  maxProducts: number;
  productsUsed: number;
  maxGroupsPerProduct: number;
  maxActiveFeatured: number;
  activeFeaturedUsed: number;
  maxPendingFeatured: number;
  pendingFeaturedUsed: number;
  maxFeaturedDaysPerRequest: number;
  allowedDurations: number[];
  allowedPlacements: string[];
  featuredDiscountPercent: number;
}

// ==============================================================
// UNIFIED ADMIN WALLET, INCOME LEDGER, OUTBOX & EXPORTS
// ==============================================================
export type IncomeSource =
  | 'SUBSCRIPTION'
  | 'FEATURED'
  | 'LOAN_FEE'
  | 'TRIP_DATING'
  | 'AIRBUS_PLUS'
  | 'ADVERTISING'
  | 'OTHER';

export interface PlatformIncomeRecord {
  id: string;
  source: IncomeSource;
  paymentChannel: 'WALLET' | 'MPESA_DIRECT';
  amountCents: number;
  currency: 'KES';
  userId?: number | null;
  userName?: string;
  referenceId: string;
  description: string;
  eatDateKey: string; // YYYY-MM-DD in Africa/Nairobi
  eatHourKey: string; // YYYY-MM-DD HH in Africa/Nairobi
  eatMonthKey: string; // YYYY-MM in Africa/Nairobi
  eatYearKey: string; // YYYY in Africa/Nairobi
  idempotencyKey: string;
  actorId?: number | null;
  createdAt: number;
}

export interface SpecialRefundCreditRecord {
  id: string;
  refundRequestId?: number;
  userId: number;
  role: UserRole;
  amountCents: number;
  kind: 'SPECIAL_EXTERNAL_REFUND' | 'DEFAULT_STORE_CREDIT' | 'GROUP_REMOVAL_REFUND' | 'POINTS_REDEMPTION';
  referenceId: string;
  note: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface OutboxEventRecord {
  id: string;
  userId: number;
  eventType: string;
  entityType: 'deposit' | 'payment' | 'subscription' | 'featured' | 'refund' | 'verification' | 'announcement' | 'wallet';
  entityId: string;
  title: string;
  message: string;
  notificationType: UserNotification['type'];
  link?: string;
  payload?: Record<string, any>;
  deliveredAt?: number | null;
  acknowledgedAt?: number | null;
  createdAt: number;
}

export interface WalletReconciliationMismatch {
  walletId: string;
  userId: number;
  role: UserRole;
  walletBalanceCents: number;
  ledgerNetCents: number;
  diffCents: number;
}

export interface ReconciliationReport {
  id: string;
  status: 'PASSED' | 'MISMATCH';
  trigger: 'scheduled' | 'manual' | 'mutation';
  checkedAt: number;
  eatTimestamp: string;
  approvedDepositsCents: number;
  openingUserWalletCents: number;
  approvedSpecialRefundsCents: number;
  totalUserWalletsHeldCents: number;
  nonAdminAvailableHeldCents: number;
  restrictedHeldCents: number;
  platformWalletBalanceCents: number;
  walletFundedRevenueCents: number;
  directMpesaRevenueCents: number;
  totalIncomeRevenueCents: number;
  leftSideCents: number;
  rightSideCents: number;
  diffCents: number;
  walletMismatchCount: number;
  walletMismatches: WalletReconciliationMismatch[];
  notes: string;
}

export interface AdminExportJob {
  id: string;
  type: 'wallets' | 'users' | 'admin_wallet';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdBy: number;
  filename: string;
  mimeType: string;
  totalRows: number;
  csvContent?: string;
  error?: string;
  createdAt: number;
  completedAt?: number | null;
}


