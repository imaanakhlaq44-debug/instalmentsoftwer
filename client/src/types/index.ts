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
  /** Set for CUSTOMER logins — the customer record this account may view. */
  customerId?: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  active: boolean;
  lastLoginAt?: string;
  /** True after an admin reset; the user must set a new password to continue. */
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  dealerId: string;
  name: string;
  phone: string;
  cnic: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes?: string;
  active: boolean;
  totalDevices?: number;
  outstandingBalance?: number;
  paymentStatus?: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  createdAt: string;
}

export interface Device {
  id: string;
  dealerId: string;
  customerId: string;
  brand: string;
  model: string;
  imei: string;
  maskedImei?: string;
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
  customerName?: string;
  customerPhone?: string;
  monthlyAmount?: number;
  nextDueDate?: string;
  installmentStatus?: string;
  createdAt: string;
  updatedAt: string;
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
  customerName?: string;
  customerPhone?: string;
  deviceBrand?: string;
  deviceModel?: string;
  deviceImei?: string;
  deviceStatus?: string;
  nextDueDate?: string;
  overdueInstallmentsCount?: number;
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
  customerName?: string;
  customerPhone?: string;
  planDetails?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  dealerId: string;
  customerId: string;
  paymentId?: string;
  type: 'DOWN_PAYMENT' | 'MONTHLY_INSTALLMENT' | 'LATE_FEE' | 'REFUND';
  amount: number;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  date: string;
  notes?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface DeviceActionLog {
  id: string;
  deviceId: string;
  dealerId: string;
  userId: string;
  userName: string;
  action: string;
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
  availableDevices?: number;
  dealerName?: string;
  dealerCity?: string;
  utilizationPercentage?: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  dealerId: string;
  customerId?: string;
  deviceId?: string;
  type: string;
  channel: string;
  title: string;
  message: string;
  status: string;
  sentAt?: string;
  customerName?: string;
  customerPhone?: string;
  deviceModel?: string;
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

export interface EnrollmentToken {
  id: string;
  dealerId: string;
  deviceId?: string;
  customerId?: string;
  token: string;
  qrType: QRType;
  status: string;
  expiresAt: string;
  deviceInfo?: string;
  customerName?: string;
  isExpired?: boolean;
  createdAt: string;
}
