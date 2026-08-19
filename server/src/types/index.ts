export type UserRole = 'SUPER_ADMIN' | 'DEALER_ADMIN' | 'DEALER_STAFF' | 'CUSTOMER';

export type DeviceStatus = 
  | 'PENDING'
  | 'ENROLLED'
  | 'ACTIVE'
  | 'OVERDUE'
  | 'LOCK_PENDING'
  | 'LOCKED'
  | 'UNLOCK_PENDING'
  | 'INACTIVE'
  | 'REMOVED';

export type InstallmentStatus = 
  | 'PENDING'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'PAID';

export type PlanStatus = 
  | 'CURRENT'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod = 
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'JAZZCASH'
  | 'EASYPAISA'
  | 'RAAST'
  | 'ONLINE';

export type PaymentStatus = 
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'REFUNDED';

export type QRType = 'STANDARD' | 'PRO' | 'LEGACY' | 'QC';

export type EnrollmentTokenStatus = 
  | 'WAITING'
  | 'SCANNED'
  | 'VERIFYING'
  | 'ENROLLED'
  | 'EXPIRED'
  | 'FAILED';

export interface Dealer {
  id: string;
  name: string;
  code: string;
  ownerName: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  licenseKeyId: string;
  active: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  dealerId?: string;
  /** Set for CUSTOMER accounts — links the login to the customer record it may view. */
  customerId?: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  phone: string;
  active: boolean;
  lastLoginAt?: string;
  /** Consecutive failed login attempts; reset on success. */
  failedLoginAttempts?: number;
  /** ISO timestamp until which login is blocked after repeated failures. */
  lockedUntil?: string;
  /** Forces a password change on next login (e.g. after an admin reset). */
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  createdAt: string;
}

/** The authenticated principal decoded from a JWT and attached to every request. */
export interface AuthenticatedUser {
  userId: string;
  dealerId?: string;
  customerId?: string;
  role: UserRole;
  name: string;
  email: string;
}

export interface Customer {
  id: string;
  dealerId: string;
  name: string;
  phone: string;
  cnic: string; // e.g. "35202-*******-1" or full
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes?: string;
  active: boolean;
  createdAt: string;
}

export interface Device {
  id: string;
  dealerId: string;
  customerId: string;
  brand: string;
  model: string;
  imei: string;
  serialNumber: string;
  color: string;
  ramStorage: string;
  purchasePrice: number;
  status: DeviceStatus;
  lastSeen: string;
  batteryLevel: number;
  isOnline: boolean;
  osVersion: string;
  securityPatch: string;
  lockReason?: string;
  lockMessage?: string;
  locationLat?: number;
  locationLng?: number;
  simCarrier?: string;
  wifiSsid?: string;
  /**
   * A lock/unlock command issued while the device was offline. It is applied
   * when the device next checks in, which is what LOCK_PENDING/UNLOCK_PENDING
   * actually mean.
   */
  pendingCommand?: 'LOCK' | 'UNLOCK';
  pendingCommandAt?: string;

  // --- DPC credentials -------------------------------------------------------
  /**
   * SHA-256 of the token the Device Policy Controller presents. The token
   * itself is shown once, when enrollment completes, and never stored.
   * Must never be serialised into an API response — see `sanitizeDevice`.
   */
  authTokenHash?: string;
  authTokenIssuedAt?: string;
  /** DPC build running on the handset. */
  dpcVersion?: string;
  /** Last successful DPC check-in, as distinct from any dashboard activity. */
  lastCheckInAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentToken {
  id: string;
  dealerId: string;
  deviceId?: string;
  customerId?: string;
  token: string;
  qrType: QRType;
  status: EnrollmentTokenStatus;
  expiresAt: string;
  createdAt: string;
}

export interface InstallmentPlan {
  id: string;
  dealerId: string;
  customerId: string;
  deviceId: string;
  totalAmount: number;
  downPayment: number;
  financedAmount: number;
  monthlyInstallment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingBalance: number;
  firstDueDate: string;
  gracePeriodDays: number;
  status: PlanStatus;
  /**
   * Money received beyond what was due — an overpayment is held here and
   * applied to the next installment instead of silently disappearing.
   */
  creditBalance?: number;
  /** Late fees charged across this plan that have not been paid yet. */
  outstandingLateFees?: number;
  closedAt?: string;
  closureReason?: string;
  createdAt: string;
}

export interface Installment {
  id: string;
  planId: string;
  dealerId: string;
  customerId: string;
  installmentNumber: number;
  amountDue: number;
  amountPaid: number;
  dueDate: string;
  graceDate: string;
  status: InstallmentStatus;
  paidAt?: string;
  /** Penalty accrued on this installment for being past its grace date. */
  lateFee?: number;
  lateFeePaid?: number;
  /** Set when a dealer forgives the penalty; keeps the reason for the audit trail. */
  lateFeeWaivedAt?: string;
  lateFeeWaivedBy?: string;
  lateFeeWaiverReason?: string;
  /** Last date the late-fee accrual job processed this row (prevents double charging). */
  lateFeeAccruedThrough?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  dealerId: string;
  customerId: string;
  installmentId?: string;
  planId?: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  notes?: string;
  status: PaymentStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  /** Populated when a payment is reversed (bounced cheque, wrong entry, refund). */
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  /** Set on the correcting entry, pointing back at the payment it reverses. */
  reversalOfPaymentId?: string;
  /** Portion of this payment that settled late fees rather than principal. */
  lateFeePortion?: number;
  receiptNumber?: string;
  recordedBy?: string;
  /**
   * Who put this payment into the system. A CUSTOMER payment is a claim until
   * somebody at the shop verifies it; a COUNTER one was seen by staff.
   */
  source?: 'COUNTER' | 'CUSTOMER' | 'GATEWAY';
  /** The customer's screenshot of the transfer, as a data URL. */
  proofImage?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  dealerId: string;
  customerId: string;
  paymentId?: string;
  planId?: string;
  type:
    | 'DOWN_PAYMENT'
    | 'MONTHLY_INSTALLMENT'
    | 'LATE_FEE'
    | 'LATE_FEE_WAIVER'
    | 'REFUND'
    | 'REVERSAL'
    | 'ADVANCE_CREDIT'
    | 'EARLY_SETTLEMENT';
  amount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED';
  date: string;
  notes?: string;
}

export interface DeviceActionLog {
  id: string;
  deviceId: string;
  dealerId: string;
  userId: string;
  userName: string;
  action: 'LOCK' | 'UNLOCK' | 'REGISTER' | 'ENROLL' | 'REBOOT' | 'SEND_MESSAGE' | 'STATUS_CHANGE';
  oldStatus?: DeviceStatus;
  newStatus?: DeviceStatus;
  reason?: string;
  commandPayload?: string;
  deviceAck: boolean;
  ipAddress: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  dealerId?: string;
  userId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  ipAddress: string;
  createdAt: string;
}

export interface LicenseKey {
  id: string;
  dealerId: string;
  licenseKey: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';
  deviceLimit: number;
  usedDevices: number;
  expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  createdAt: string;
}

export interface DevicePolicy {
  id: string;
  dealerId: string;
  gracePeriodDays: number;
  autoLockEnabled: boolean;
  autoUnlockEnabled: boolean;
  lockWarningDays: number;
  customerReminderEnabled: boolean;
  emergencyCallsAllowed: boolean;
  paymentMethodsOnLock: string[];

  // --- Late fee policy -----------------------------------------------------
  lateFeeEnabled?: boolean;
  /** 'FIXED' = flat rupee amount, 'PERCENTAGE' = share of the installment. */
  lateFeeType?: 'FIXED' | 'PERCENTAGE';
  lateFeeAmount?: number;
  /** 'ONE_TIME' charges once; 'DAILY' accrues per day past the grace date. */
  lateFeeFrequency?: 'ONE_TIME' | 'DAILY';
  /** Upper bound so a long-overdue account cannot accrue an unpayable penalty. */
  lateFeeMaxPerInstallment?: number;

  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  dealerId: string;
  customerId?: string;
  deviceId?: string;
  type: 'PAYMENT_DUE' | 'PAYMENT_OVERDUE' | 'DEVICE_LOCKED' | 'DEVICE_UNLOCKED' | 'DEVICE_OFFLINE' | 'ENROLLMENT_SUCCESS' | 'SECURITY_ALERT';
  channel: 'IN_APP' | 'SMS' | 'EMAIL' | 'PUSH';
  title: string;
  message: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  sentAt?: string;
  createdAt: string;
  /** Held by the relay currently trying to send this message. */
  leaseUntil?: string;
  attempts?: number;
  failureReason?: string;
}

/**
 * The customer's recorded consent to the terms and to the device restriction.
 *
 * `snapshot` is JSON — the facts the document was rendered from, frozen at
 * signing — and `documentHash` covers it together with `termsVersion`.
 */
export interface Contract {
  id: string;
  dealerId: string;
  customerId: string;
  deviceId: string;
  planId: string;
  termsVersion: string;
  snapshot: string;
  status: 'DRAFT' | 'SIGNED' | 'VOID';
  signedAt?: string;
  signerName?: string;
  signatureImage?: string;
  signedIp?: string;
  documentHash?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
}

/**
 * A phone paired to a dealership to send its SMS.
 *
 * The token is shown once, at pairing, and only its hash is stored — the same
 * arrangement the DPC uses, for the same reason.
 */
export interface SmsRelay {
  id: string;
  dealerId: string;
  name: string;
  tokenHash: string;
  lastSeenAt?: string;
  sentCount: number;
  failedCount: number;
  revokedAt?: string;
  createdAt: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  triggerEvent: string;
  channel: string;
  subjectTemplate: string;
  bodyTemplate: string;
}
