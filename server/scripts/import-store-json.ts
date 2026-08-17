/**
 * Migrates the legacy JSON store into PostgreSQL.
 *
 *   npm run db:import                 # imports server/data/store.json
 *   npm run db:import -- --file=path  # or a specific file
 *   npm run db:import -- --dry-run    # report only, write nothing
 *
 * Properties this script guarantees:
 *
 *  * **Idempotent.** Every row is upserted by primary key, so running it twice
 *    produces the same database rather than duplicates.
 *  * **Ordered.** Tables are imported parent-first so foreign keys always hold.
 *  * **Honest about bad data.** The JSON store had no referential integrity, so
 *    it can contain rows pointing at records that no longer exist. Those are
 *    skipped and reported rather than silently dropped or force-inserted.
 */
import fs from 'fs';
import path from 'path';
import { prisma, connectDatabase } from '../src/db/prisma.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArg = args.find((a) => a.startsWith('--file='));
const STORE_FILE = fileArg
  ? path.resolve(fileArg.slice('--file='.length))
  : path.join(process.cwd(), 'data', 'store.json');

/** ISO timestamp string -> Date. Falls back to now() for missing values. */
function ts(value: unknown, fallback: Date = new Date()): Date {
  if (!value) return fallback;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function tsOrNull(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 'YYYY-MM-DD' -> midnight UTC.
 *
 * Parsed as UTC deliberately: `new Date('2026-08-20')` is already UTC, but
 * `new Date(2026, 7, 20)` would be local and could shift the due date by a day
 * for anyone east of Greenwich — which includes Pakistan.
 */
function dateOnly(value: unknown, fallback = '1970-01-01'): Date {
  const raw = String(value ?? fallback).slice(0, 10);
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? new Date(`${fallback}T00:00:00.000Z`) : d;
}

function dateOnlyOrNull(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Money is stored as whole rupees. */
function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function int(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

/** Trims to a column's length so an over-long legacy value cannot abort the run. */
function clip(value: unknown, max: number, fallback = ''): string {
  return str(value, fallback).slice(0, max);
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = String(value ?? '').toUpperCase() as T;
  return allowed.includes(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface Report {
  imported: Record<string, number>;
  skipped: { table: string; id: string; reason: string }[];
}

const report: Report = { imported: {}, skipped: [] };

function counted(table: string, n: number) {
  report.imported[table] = n;
}

function skip(table: string, id: string, reason: string) {
  report.skipped.push({ table, id, reason });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(STORE_FILE)) {
    console.error(`\n[import] No JSON store found at ${STORE_FILE}`);
    console.error('[import] Nothing to migrate. If this is a fresh install, run `npm run seed` instead.\n');
    process.exit(1);
  }

  console.log(`[import] Reading ${STORE_FILE}`);
  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));

  await connectDatabase();

  if (DRY_RUN) {
    console.log('[import] DRY RUN — no rows will be written.\n');
  }

  // Sets of ids that made it in, used to reject orphaned children.
  const dealerIds = new Set<string>();
  const customerIds = new Set<string>();
  const deviceIds = new Set<string>();
  const planIds = new Set<string>();
  const installmentIds = new Set<string>();
  const paymentIds = new Set<string>();

  // -------------------------------------------------------------------------
  // 1. Dealers
  // -------------------------------------------------------------------------
  const dealers = (store.dealers ?? []) as any[];
  for (const d of dealers) {
    dealerIds.add(d.id);
    if (DRY_RUN) continue;
    await prisma.dealer.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        name: clip(d.name, 120),
        code: clip(d.code, 40),
        ownerName: clip(d.ownerName, 120),
        email: clip(d.email, 255).toLowerCase(),
        phone: clip(d.phone, 20),
        city: clip(d.city, 60),
        address: clip(d.address, 300),
        licenseKeyId: d.licenseKeyId ?? null,
        active: d.active !== false,
        createdAt: ts(d.createdAt),
      },
      update: {
        name: clip(d.name, 120),
        ownerName: clip(d.ownerName, 120),
        phone: clip(d.phone, 20),
        city: clip(d.city, 60),
        address: clip(d.address, 300),
        active: d.active !== false,
      },
    });
  }
  counted('dealers', dealers.length);

  // -------------------------------------------------------------------------
  // 2. License keys
  // -------------------------------------------------------------------------
  const licenses = (store.licenseKeys ?? []) as any[];
  let licenseCount = 0;
  for (const l of licenses) {
    if (!dealerIds.has(l.dealerId)) {
      skip('license_keys', l.id, `dealer ${l.dealerId} does not exist`);
      continue;
    }
    licenseCount++;
    if (DRY_RUN) continue;
    await prisma.licenseKey.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        dealerId: l.dealerId,
        licenseKey: clip(l.licenseKey, 60),
        plan: enumOr(l.plan, ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const, 'PROFESSIONAL'),
        deviceLimit: int(l.deviceLimit, 100),
        usedDevices: int(l.usedDevices),
        expiryDate: dateOnly(l.expiryDate, '2027-01-01'),
        status: enumOr(l.status, ['ACTIVE', 'EXPIRED', 'SUSPENDED'] as const, 'ACTIVE'),
        createdAt: ts(l.createdAt),
      },
      update: {
        plan: enumOr(l.plan, ['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const, 'PROFESSIONAL'),
        deviceLimit: int(l.deviceLimit, 100),
        expiryDate: dateOnly(l.expiryDate, '2027-01-01'),
        status: enumOr(l.status, ['ACTIVE', 'EXPIRED', 'SUSPENDED'] as const, 'ACTIVE'),
      },
    });
  }
  counted('license_keys', licenseCount);

  // -------------------------------------------------------------------------
  // 3. Customers (before users, because a CUSTOMER login points at one)
  // -------------------------------------------------------------------------
  const customers = (store.customers ?? []) as any[];
  let customerCount = 0;
  const seenCnic = new Set<string>();
  for (const c of customers) {
    if (!dealerIds.has(c.dealerId)) {
      skip('customers', c.id, `dealer ${c.dealerId} does not exist`);
      continue;
    }
    // The new schema enforces one CNIC per dealer; the JSON store never did.
    const cnicKey = `${c.dealerId}::${c.cnic}`;
    if (seenCnic.has(cnicKey)) {
      skip('customers', c.id, `duplicate CNIC ${c.cnic} for dealer ${c.dealerId}`);
      continue;
    }
    seenCnic.add(cnicKey);
    customerIds.add(c.id);
    customerCount++;
    if (DRY_RUN) continue;

    await prisma.customer.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        dealerId: c.dealerId,
        name: clip(c.name, 120),
        phone: clip(c.phone, 20),
        cnic: clip(c.cnic, 20),
        address: clip(c.address, 300),
        emergencyContactName: clip(c.emergencyContactName, 120, 'Not recorded'),
        emergencyContactPhone: clip(c.emergencyContactPhone, 20, '0300-0000000'),
        notes: c.notes ? clip(c.notes, 1000) : null,
        active: c.active !== false,
        createdAt: ts(c.createdAt),
      },
      update: {
        name: clip(c.name, 120),
        phone: clip(c.phone, 20),
        address: clip(c.address, 300),
        active: c.active !== false,
      },
    });
  }
  counted('customers', customerCount);

  // -------------------------------------------------------------------------
  // 4. Users
  // -------------------------------------------------------------------------
  const users = (store.users ?? []) as any[];
  let userCount = 0;
  const seenEmail = new Set<string>();
  for (const u of users) {
    const email = clip(u.email, 255).toLowerCase();
    if (seenEmail.has(email)) {
      skip('users', u.id, `duplicate email ${email}`);
      continue;
    }
    seenEmail.add(email);

    // Drop links that would violate a foreign key rather than failing the run.
    const dealerId = u.dealerId && dealerIds.has(u.dealerId) ? u.dealerId : null;
    const customerId = u.customerId && customerIds.has(u.customerId) ? u.customerId : null;
    if (u.dealerId && !dealerId) skip('users', u.id, `dealer ${u.dealerId} missing — link cleared`);
    if (u.customerId && !customerId) skip('users', u.id, `customer ${u.customerId} missing — link cleared`);

    userCount++;
    if (DRY_RUN) continue;

    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        dealerId,
        customerId,
        name: clip(u.name, 120),
        email,
        passwordHash: clip(u.passwordHash, 255),
        role: enumOr(u.role, ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'] as const, 'DEALER_STAFF'),
        phone: clip(u.phone, 20),
        active: u.active !== false,
        lastLoginAt: tsOrNull(u.lastLoginAt),
        failedLoginAttempts: int(u.failedLoginAttempts),
        lockedUntil: tsOrNull(u.lockedUntil),
        mustChangePassword: u.mustChangePassword === true,
        passwordChangedAt: tsOrNull(u.passwordChangedAt),
        createdAt: ts(u.createdAt),
      },
      update: {
        name: clip(u.name, 120),
        passwordHash: clip(u.passwordHash, 255),
        role: enumOr(u.role, ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'] as const, 'DEALER_STAFF'),
        active: u.active !== false,
        dealerId,
        customerId,
      },
    });
  }
  counted('users', userCount);

  // -------------------------------------------------------------------------
  // 5. Devices
  // -------------------------------------------------------------------------
  const devices = (store.devices ?? []) as any[];
  let deviceCount = 0;
  const seenImei = new Set<string>();
  for (const d of devices) {
    if (!dealerIds.has(d.dealerId) || !customerIds.has(d.customerId)) {
      skip('devices', d.id, `dealer/customer missing (${d.dealerId} / ${d.customerId})`);
      continue;
    }
    if (seenImei.has(d.imei)) {
      skip('devices', d.id, `duplicate IMEI ${d.imei}`);
      continue;
    }
    seenImei.add(d.imei);
    deviceIds.add(d.id);
    deviceCount++;
    if (DRY_RUN) continue;

    const common = {
      brand: clip(d.brand, 40),
      model: clip(d.model, 60),
      serialNumber: clip(d.serialNumber, 64, 'UNKNOWN'),
      color: clip(d.color, 30, 'Black'),
      ramStorage: clip(d.ramStorage, 40, 'Unknown'),
      purchasePrice: money(d.purchasePrice),
      status: enumOr(
        d.status,
        ['PENDING', 'ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING', 'INACTIVE', 'REMOVED'] as const,
        'PENDING'
      ),
      lastSeen: ts(d.lastSeen),
      batteryLevel: Math.max(0, Math.min(100, int(d.batteryLevel, 100))),
      isOnline: d.isOnline === true,
      osVersion: clip(d.osVersion, 40, 'Unknown'),
      securityPatch: clip(d.securityPatch, 20, '1970-01-01'),
      lockReason: d.lockReason ? clip(d.lockReason, 500) : null,
      lockMessage: d.lockMessage ? clip(d.lockMessage, 300) : null,
      locationLat: d.locationLat ?? null,
      locationLng: d.locationLng ?? null,
      simCarrier: d.simCarrier ? clip(d.simCarrier, 40) : null,
      wifiSsid: d.wifiSsid ? clip(d.wifiSsid, 60) : null,
      pendingCommand: d.pendingCommand === 'LOCK' || d.pendingCommand === 'UNLOCK' ? d.pendingCommand : null,
      pendingCommandAt: tsOrNull(d.pendingCommandAt),
      updatedAt: ts(d.updatedAt),
    };

    await prisma.device.upsert({
      where: { id: d.id },
      create: {
        id: d.id,
        dealerId: d.dealerId,
        customerId: d.customerId,
        imei: clip(d.imei, 20),
        createdAt: ts(d.createdAt),
        ...common,
      },
      update: common,
    });
  }
  counted('devices', deviceCount);

  // -------------------------------------------------------------------------
  // 6. Installment plans
  // -------------------------------------------------------------------------
  const plans = (store.installmentPlans ?? []) as any[];
  let planCount = 0;
  const seenDevicePlan = new Set<string>();
  for (const p of plans) {
    if (!dealerIds.has(p.dealerId) || !customerIds.has(p.customerId) || !deviceIds.has(p.deviceId)) {
      skip('installment_plans', p.id, `dealer/customer/device missing`);
      continue;
    }
    // One plan per device is now a database constraint.
    if (seenDevicePlan.has(p.deviceId)) {
      skip('installment_plans', p.id, `device ${p.deviceId} already has a plan`);
      continue;
    }
    seenDevicePlan.add(p.deviceId);
    planIds.add(p.id);
    planCount++;
    if (DRY_RUN) continue;

    const common = {
      totalAmount: money(p.totalAmount),
      downPayment: money(p.downPayment),
      financedAmount: money(p.financedAmount),
      monthlyInstallment: money(p.monthlyInstallment),
      totalInstallments: int(p.totalInstallments, 1),
      paidInstallments: int(p.paidInstallments),
      remainingBalance: money(p.remainingBalance),
      firstDueDate: dateOnly(p.firstDueDate),
      gracePeriodDays: int(p.gracePeriodDays, 3),
      status: enumOr(p.status, ['CURRENT', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'COMPLETED', 'CANCELLED'] as const, 'CURRENT'),
      creditBalance: money(p.creditBalance),
      outstandingLateFees: money(p.outstandingLateFees),
      closedAt: tsOrNull(p.closedAt),
      closureReason: p.closureReason ? clip(p.closureReason, 500) : null,
    };

    await prisma.installmentPlan.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        dealerId: p.dealerId,
        customerId: p.customerId,
        deviceId: p.deviceId,
        createdAt: ts(p.createdAt),
        ...common,
      },
      update: common,
    });
  }
  counted('installment_plans', planCount);

  // -------------------------------------------------------------------------
  // 7. Installments
  // -------------------------------------------------------------------------
  const installments = (store.installments ?? []) as any[];
  let installmentCount = 0;
  for (const i of installments) {
    if (!planIds.has(i.planId) || !dealerIds.has(i.dealerId) || !customerIds.has(i.customerId)) {
      skip('installments', i.id, `plan/dealer/customer missing`);
      continue;
    }
    installmentIds.add(i.id);
    installmentCount++;
    if (DRY_RUN) continue;

    const common = {
      installmentNumber: int(i.installmentNumber, 1),
      amountDue: money(i.amountDue),
      amountPaid: money(i.amountPaid),
      dueDate: dateOnly(i.dueDate),
      graceDate: dateOnly(i.graceDate ?? i.dueDate),
      status: enumOr(i.status, ['PENDING', 'DUE_SOON', 'DUE_TODAY', 'OVERDUE', 'PAID'] as const, 'PENDING'),
      paidAt: tsOrNull(i.paidAt),
      lateFee: money(i.lateFee),
      lateFeePaid: money(i.lateFeePaid),
      lateFeeWaivedAt: tsOrNull(i.lateFeeWaivedAt),
      lateFeeWaivedBy: i.lateFeeWaivedBy ? clip(i.lateFeeWaivedBy, 64) : null,
      lateFeeWaiverReason: i.lateFeeWaiverReason ? clip(i.lateFeeWaiverReason, 500) : null,
      lateFeeAccruedThrough: dateOnlyOrNull(i.lateFeeAccruedThrough),
    };

    await prisma.installment.upsert({
      where: { id: i.id },
      create: {
        id: i.id,
        planId: i.planId,
        dealerId: i.dealerId,
        customerId: i.customerId,
        createdAt: ts(i.createdAt),
        ...common,
      },
      update: common,
    });
  }
  counted('installments', installmentCount);

  // -------------------------------------------------------------------------
  // 8. Payments
  // -------------------------------------------------------------------------
  const payments = (store.payments ?? []) as any[];
  let paymentCount = 0;
  const seenRef = new Set<string>();
  for (const p of payments) {
    if (!dealerIds.has(p.dealerId) || !customerIds.has(p.customerId)) {
      skip('payments', p.id, `dealer/customer missing`);
      continue;
    }
    // (dealerId, referenceNumber) is now unique.
    const refKey = `${p.dealerId}::${p.referenceNumber}`;
    if (seenRef.has(refKey)) {
      skip('payments', p.id, `duplicate reference ${p.referenceNumber} for dealer ${p.dealerId}`);
      continue;
    }
    seenRef.add(refKey);
    paymentIds.add(p.id);
    paymentCount++;
    if (DRY_RUN) continue;

    const common = {
      installmentId: p.installmentId && installmentIds.has(p.installmentId) ? p.installmentId : null,
      planId: p.planId && planIds.has(p.planId) ? p.planId : null,
      amount: money(p.amount),
      paymentMethod: enumOr(
        p.paymentMethod,
        ['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'RAAST', 'ONLINE'] as const,
        'CASH'
      ),
      notes: p.notes ? clip(p.notes, 500) : null,
      status: enumOr(p.status, ['PENDING', 'VERIFIED', 'FAILED', 'REFUNDED'] as const, 'PENDING'),
      verifiedBy: p.verifiedBy ? clip(p.verifiedBy, 64) : null,
      verifiedAt: tsOrNull(p.verifiedAt),
      reversedAt: tsOrNull(p.reversedAt),
      reversedBy: p.reversedBy ? clip(p.reversedBy, 64) : null,
      reversalReason: p.reversalReason ? clip(p.reversalReason, 500) : null,
      reversalOfPaymentId: p.reversalOfPaymentId ? clip(p.reversalOfPaymentId, 64) : null,
      lateFeePortion: money(p.lateFeePortion),
      receiptNumber: p.receiptNumber ? clip(p.receiptNumber, 40) : null,
      recordedBy: p.recordedBy ? clip(p.recordedBy, 64) : null,
    };

    await prisma.payment.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        dealerId: p.dealerId,
        customerId: p.customerId,
        referenceNumber: clip(p.referenceNumber, 60),
        createdAt: ts(p.createdAt),
        ...common,
      },
      update: common,
    });
  }
  counted('payments', paymentCount);

  // -------------------------------------------------------------------------
  // 9. Transactions
  // -------------------------------------------------------------------------
  const transactions = (store.transactions ?? []) as any[];
  let txCount = 0;
  for (const t of transactions) {
    if (!dealerIds.has(t.dealerId) || !customerIds.has(t.customerId)) {
      skip('transactions', t.id, `dealer/customer missing`);
      continue;
    }
    txCount++;
    if (DRY_RUN) continue;

    const common = {
      paymentId: t.paymentId && paymentIds.has(t.paymentId) ? t.paymentId : null,
      planId: t.planId && planIds.has(t.planId) ? t.planId : null,
      type: enumOr(
        t.type,
        ['DOWN_PAYMENT', 'MONTHLY_INSTALLMENT', 'LATE_FEE', 'LATE_FEE_WAIVER', 'REFUND', 'REVERSAL', 'ADVANCE_CREDIT', 'EARLY_SETTLEMENT'] as const,
        'MONTHLY_INSTALLMENT'
      ),
      amount: money(t.amount),
      status: enumOr(t.status, ['COMPLETED', 'PENDING', 'FAILED', 'REVERSED'] as const, 'COMPLETED'),
      date: ts(t.date),
      notes: t.notes ? clip(t.notes, 500) : null,
    };

    await prisma.transaction.upsert({
      where: { id: t.id },
      create: { id: t.id, dealerId: t.dealerId, customerId: t.customerId, ...common },
      update: common,
    });
  }
  counted('transactions', txCount);

  // -------------------------------------------------------------------------
  // 10. Device policies
  // -------------------------------------------------------------------------
  const policies = (store.devicePolicies ?? []) as any[];
  let policyCount = 0;
  const seenPolicyDealer = new Set<string>();
  for (const p of policies) {
    if (!dealerIds.has(p.dealerId) || seenPolicyDealer.has(p.dealerId)) {
      skip('device_policies', p.id, `dealer missing or already has a policy`);
      continue;
    }
    seenPolicyDealer.add(p.dealerId);
    policyCount++;
    if (DRY_RUN) continue;

    const common = {
      gracePeriodDays: int(p.gracePeriodDays, 3),
      autoLockEnabled: p.autoLockEnabled === true,
      autoUnlockEnabled: p.autoUnlockEnabled !== false,
      lockWarningDays: int(p.lockWarningDays, 2),
      customerReminderEnabled: p.customerReminderEnabled !== false,
      emergencyCallsAllowed: p.emergencyCallsAllowed !== false,
      paymentMethodsOnLock: Array.isArray(p.paymentMethodsOnLock)
        ? p.paymentMethodsOnLock.map((m: unknown) => String(m))
        : ['CASH'],
      lateFeeEnabled: p.lateFeeEnabled === true,
      lateFeeType: enumOr(p.lateFeeType, ['FIXED', 'PERCENTAGE'] as const, 'FIXED'),
      lateFeeAmount: money(p.lateFeeAmount ?? 500),
      lateFeeFrequency: enumOr(p.lateFeeFrequency, ['ONE_TIME', 'DAILY'] as const, 'ONE_TIME'),
      lateFeeMaxPerInstallment: money(p.lateFeeMaxPerInstallment ?? 5000),
      updatedAt: ts(p.updatedAt),
    };

    await prisma.devicePolicy.upsert({
      where: { id: p.id },
      create: { id: p.id, dealerId: p.dealerId, createdAt: ts(p.createdAt), ...common },
      update: common,
    });
  }
  counted('device_policies', policyCount);

  // -------------------------------------------------------------------------
  // 11. Enrollment tokens
  // -------------------------------------------------------------------------
  const tokens = (store.enrollmentTokens ?? []) as any[];
  let tokenCount = 0;
  const seenToken = new Set<string>();
  for (const t of tokens) {
    if (!dealerIds.has(t.dealerId) || seenToken.has(t.token)) {
      skip('enrollment_tokens', t.id, `dealer missing or duplicate token`);
      continue;
    }
    seenToken.add(t.token);
    tokenCount++;
    if (DRY_RUN) continue;

    const common = {
      deviceId: t.deviceId && deviceIds.has(t.deviceId) ? t.deviceId : null,
      customerId: t.customerId && customerIds.has(t.customerId) ? t.customerId : null,
      qrType: enumOr(t.qrType, ['STANDARD', 'PRO', 'LEGACY', 'QC'] as const, 'STANDARD'),
      status: enumOr(
        t.status,
        ['WAITING', 'SCANNED', 'VERIFYING', 'ENROLLED', 'EXPIRED', 'FAILED'] as const,
        'EXPIRED'
      ),
      expiresAt: ts(t.expiresAt),
    };

    await prisma.enrollmentToken.upsert({
      where: { id: t.id },
      create: { id: t.id, dealerId: t.dealerId, token: clip(t.token, 120), createdAt: ts(t.createdAt), ...common },
      update: common,
    });
  }
  counted('enrollment_tokens', tokenCount);

  // -------------------------------------------------------------------------
  // 12. Device action logs
  // -------------------------------------------------------------------------
  const actionLogs = (store.deviceActionLogs ?? []) as any[];
  let actionCount = 0;
  for (const l of actionLogs) {
    if (!deviceIds.has(l.deviceId) || !dealerIds.has(l.dealerId)) {
      skip('device_action_logs', l.id, `device/dealer missing`);
      continue;
    }
    actionCount++;
    if (DRY_RUN) continue;

    const statuses = [
      'PENDING', 'ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING', 'INACTIVE', 'REMOVED',
    ] as const;

    await prisma.deviceActionLog.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        deviceId: l.deviceId,
        dealerId: l.dealerId,
        userId: clip(l.userId, 64, 'system'),
        userName: clip(l.userName, 120, 'System'),
        action: enumOr(
          l.action,
          ['LOCK', 'UNLOCK', 'REGISTER', 'ENROLL', 'REBOOT', 'SEND_MESSAGE', 'STATUS_CHANGE'] as const,
          'STATUS_CHANGE'
        ),
        oldStatus: l.oldStatus && statuses.includes(l.oldStatus) ? l.oldStatus : null,
        newStatus: l.newStatus && statuses.includes(l.newStatus) ? l.newStatus : null,
        reason: l.reason ? clip(l.reason, 600) : null,
        commandPayload: l.commandPayload ? String(l.commandPayload) : null,
        deviceAck: l.deviceAck === true,
        ipAddress: clip(l.ipAddress, 64, 'unknown'),
        createdAt: ts(l.createdAt),
      },
      update: {},
    });
  }
  counted('device_action_logs', actionCount);

  // -------------------------------------------------------------------------
  // 13. Audit logs
  // -------------------------------------------------------------------------
  const auditLogs = (store.auditLogs ?? []) as any[];
  let auditCount = 0;
  for (const a of auditLogs) {
    const dealerId = a.dealerId && dealerIds.has(a.dealerId) ? a.dealerId : null;
    auditCount++;
    if (DRY_RUN) continue;

    await prisma.auditLog.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        dealerId,
        userId: clip(a.userId, 64, 'system'),
        actorName: clip(a.actorName, 120, 'System'),
        actorRole: enumOr(a.actorRole, ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'] as const, 'SUPER_ADMIN'),
        action: clip(a.action, 60, 'UNKNOWN'),
        targetType: clip(a.targetType, 40, 'SYSTEM'),
        targetId: clip(a.targetId, 64, '-'),
        details: clip(a.details, 1000),
        ipAddress: clip(a.ipAddress, 64, 'unknown'),
        createdAt: ts(a.createdAt),
      },
      update: {},
    });
  }
  counted('audit_logs', auditCount);

  // -------------------------------------------------------------------------
  // 14. Notifications
  // -------------------------------------------------------------------------
  const notifications = (store.notifications ?? []) as any[];
  let notifCount = 0;
  for (const n of notifications) {
    if (!dealerIds.has(n.dealerId)) {
      skip('notifications', n.id, `dealer ${n.dealerId} missing`);
      continue;
    }
    notifCount++;
    if (DRY_RUN) continue;

    await prisma.notification.upsert({
      where: { id: n.id },
      create: {
        id: n.id,
        dealerId: n.dealerId,
        customerId: n.customerId && customerIds.has(n.customerId) ? n.customerId : null,
        deviceId: n.deviceId && deviceIds.has(n.deviceId) ? n.deviceId : null,
        type: enumOr(
          n.type,
          ['PAYMENT_DUE', 'PAYMENT_OVERDUE', 'DEVICE_LOCKED', 'DEVICE_UNLOCKED', 'DEVICE_OFFLINE', 'ENROLLMENT_SUCCESS', 'SECURITY_ALERT'] as const,
          'PAYMENT_DUE'
        ),
        channel: enumOr(n.channel, ['IN_APP', 'SMS', 'EMAIL', 'PUSH'] as const, 'SMS'),
        title: clip(n.title, 120),
        message: clip(n.message, 600),
        status: enumOr(n.status, ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'] as const, 'QUEUED'),
        sentAt: tsOrNull(n.sentAt),
        createdAt: ts(n.createdAt),
      },
      update: {},
    });
  }
  counted('notifications', notifCount);

  // -------------------------------------------------------------------------
  // 15. Notification templates
  // -------------------------------------------------------------------------
  const templates = (store.notificationTemplates ?? []) as any[];
  for (const t of templates) {
    if (DRY_RUN) continue;
    await prisma.notificationTemplate.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: clip(t.name, 120),
        triggerEvent: clip(t.triggerEvent, 60),
        channel: clip(t.channel, 20, 'SMS'),
        subjectTemplate: clip(t.subjectTemplate, 200),
        bodyTemplate: clip(t.bodyTemplate, 1000),
      },
      update: {
        name: clip(t.name, 120),
        subjectTemplate: clip(t.subjectTemplate, 200),
        bodyTemplate: clip(t.bodyTemplate, 1000),
      },
    });
  }
  counted('notification_templates', templates.length);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n──────────────────────────────────────────────');
  console.log(DRY_RUN ? ' DRY RUN — rows that WOULD be imported' : ' Imported');
  console.log('──────────────────────────────────────────────');
  for (const [table, n] of Object.entries(report.imported)) {
    console.log(`  ${table.padEnd(24)} ${String(n).padStart(6)}`);
  }

  if (report.skipped.length > 0) {
    console.log('\n──────────────────────────────────────────────');
    console.log(` Skipped ${report.skipped.length} row(s) that would violate integrity`);
    console.log('──────────────────────────────────────────────');
    const byTable = new Map<string, typeof report.skipped>();
    for (const s of report.skipped) {
      const list = byTable.get(s.table) ?? [];
      list.push(s);
      byTable.set(s.table, list);
    }
    for (const [table, rows] of byTable) {
      console.log(`  ${table} (${rows.length}):`);
      for (const r of rows.slice(0, 5)) console.log(`    - ${r.id}: ${r.reason}`);
      if (rows.length > 5) console.log(`    …and ${rows.length - 5} more`);
    }
  } else {
    console.log('\n  No integrity problems found in the source data.');
  }

  if (!DRY_RUN) {
    console.log('\n Verifying row counts in PostgreSQL…');
    const actual = {
      dealers: await prisma.dealer.count(),
      users: await prisma.user.count(),
      customers: await prisma.customer.count(),
      devices: await prisma.device.count(),
      installment_plans: await prisma.installmentPlan.count(),
      installments: await prisma.installment.count(),
      payments: await prisma.payment.count(),
      transactions: await prisma.transaction.count(),
    };
    let mismatch = false;
    for (const [table, n] of Object.entries(actual)) {
      const expected = report.imported[table];
      const ok = expected === undefined || expected === n;
      if (!ok) mismatch = true;
      console.log(`  ${ok ? '✓' : '✗'} ${table.padEnd(20)} ${String(n).padStart(6)}${ok ? '' : ` (expected ${expected})`}`);
    }
    if (mismatch) {
      console.error('\n  Row counts do not match. Investigate before trusting this database.\n');
      process.exitCode = 1;
    } else {
      console.log('\n  All row counts match.\n');
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('\n[import] Failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
