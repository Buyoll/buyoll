export type UserRole = 'buyer' | 'member' | 'merchant' | 'admin' | 'lender';

export interface MerchantReview {
  id: string;
  userId: number;
  userName: string;
  rating: number; // 1 to 5
  comment: string;
  createdAt: number;
}

export interface User {
  id: number;
  name: string;
  phone: string;
  email?: string;
  password?: string;
  role: UserRole;
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
  merchantSubscriptionPlan?: 'starter' | 'pro' | 'enterprise';
  merchantSubscriptionTxCode?: string;
  merchantSubscriptionExpiresAt?: number;
  referralCode?: string;
  referredBy?: string;
  starRating?: number; // 1 to 5
  ratingCount?: number;
  reviews?: MerchantReview[];
  tillNumber?: string; // e.g. merchant M-Pesa till
  paybillNumber?: string;
  credit: number; // in KSh
  nonWithdrawableBalance?: number; // in KSh
  coins: number;
  points: number;
  preferences?: UserPreferences;
  lastActive: number;
  createdAt: number;
}

export interface UserPreferences {
  pushNotificationsEnabled?: boolean;
  smsAlertsEnabled?: boolean;
  instantPayReminderEnabled?: boolean;
  autoRollAnnouncementsEnabled?: boolean;
  theme?: 'light' | 'dark';
}

export interface SpeedOption {
  size: number; // number of members: 10, 8, 6, 4, 2, 1
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
  live: boolean;
  moderationStatus: 'approved' | 'pending' | 'returned';
  moderationNote?: string;
  speedOptions: SpeedOption[];
  stockQuantity: number;
  attributes?: Record<string, string>;
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

export interface GroupChatMessage {
  id: string;
  senderId: number;
  senderName: string;
  kind?: 'normal' | 'reward' | 'nudge' | 'system';
  text: string;
  isFlagged?: boolean;
  timestamp: number;
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

export interface ChamaGroup {
  id: number;
  productId: number;
  productTitle: string;
  productPrice: number;
  productImage?: string;
  name: string;
  size: number;
  adminId: number; // initial creator and moderator
  moderators: number[]; // array of userIds
  status: 'active' | 'full' | 'completed' | 'cancelled';
  inviteCode: string;
  dailyAmount: number;
  cycleDays: number;
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
  type: 'default_conversion' | 'point_redemption' | 'purchase_deduction' | 'admin_adjustment' | 'loan_disbursement' | 'loan_funding' | 'loan_commission';
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
  status: 'open' | 'fee_pending' | 'fee_verified' | 'funded' | 'cancelled';
  createdAt: number;
  fundedByUserId?: number;
  fundedByUserName?: string;
  lenderName?: string;
  fundedAt?: number;
  platformFeePercent: number; // 3% of amount
  platformFeeAmount: number; // 3% of amount
  platformFeePaymentCode?: string;
  platformFeeStatus: 'pending' | 'submitted' | 'approved' | 'paid';
  externalAgreementAcknowledged: boolean;
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

