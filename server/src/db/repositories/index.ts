/**
 * The repository layer — the only place the application talks to PostgreSQL.
 *
 * Every aggregate gets the shared CRUD from `makeRepository`, plus the query
 * methods its own screens need. The rule that matters: **filtering, sorting and
 * pagination happen in SQL**. The JSON store loaded every row into memory and
 * filtered with a JavaScript predicate; doing that against a database would be
 * strictly worse, so no method here fetches a table to narrow it afterwards.
 */
import { Tx } from '../prisma.js';
import { makeRepository, delegate, toSkipTake, Page, PageArgs } from './base.js';
import { toDomainList } from '../mappers.js';
import {
  Dealer, User, Customer, Device, EnrollmentToken, InstallmentPlan, Installment,
  Payment, Transaction, DeviceActionLog, AuditLog, LicenseKey, DevicePolicy,
  Notification, NotificationTemplate,
} from '../../types/index.js';

export type { Page, PageArgs };

// ---------------------------------------------------------------------------
// Shared query fragments
// ---------------------------------------------------------------------------

/**
 * Restricts a query to one dealer, or to every dealer for a super admin.
 *
 * `resolveDealerScope` returns `null` to mean "no dealer filter", and that is
 * reachable only by SUPER_ADMIN. Spreading this into a `where` keeps the
 * decision in one place instead of at every call site.
 */
export function dealerScope(dealerId: string | null): { dealerId?: string } {
  return dealerId === null ? {} : { dealerId };
}

/** Case-insensitive `LIKE %needle%`, executed by the database. */
function contains(needle: string) {
  return { contains: needle, mode: 'insensitive' as const };
}

// ---------------------------------------------------------------------------
// Dealers, users, policies, licences
// ---------------------------------------------------------------------------

export const dealers = {
  ...makeRepository<Dealer>('dealer'),

  findByIds(ids: string[], tx?: Tx): Promise<Dealer[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.findMany({ where: { id: { in: ids } } }, tx);
  },

  findByCode(code: string, tx?: Tx): Promise<Dealer | undefined> {
    return this.findFirst({ code }, tx);
  },
};

export const users = {
  ...makeRepository<User>('user'),

  /** Email is matched case-insensitively; the login form does not enforce case. */
  async findByEmail(email: string, tx?: Tx): Promise<User | undefined> {
    const trimmed = email.trim();
    if (!trimmed) return undefined;
    return this.findFirst({ email: { equals: trimmed, mode: 'insensitive' } }, tx);
  },

  listForDealer(
    args: { dealerId: string | null; search?: string; role?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<User>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.role && args.role !== 'ALL') where.role = args.role;
    if (args.search) {
      where.OR = [{ name: contains(args.search) }, { email: contains(args.search) }];
    }

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },
};

export const devicePolicies = {
  ...makeRepository<DevicePolicy>('devicePolicy'),

  findByDealer(dealerId: string, tx?: Tx): Promise<DevicePolicy | undefined> {
    return this.findFirst({ dealerId }, tx);
  },

  findByDealers(dealerIds: string[], tx?: Tx): Promise<DevicePolicy[]> {
    if (dealerIds.length === 0) return Promise.resolve([]);
    return this.findMany({ where: { dealerId: { in: dealerIds } } }, tx);
  },
};

export const licenseKeys = {
  ...makeRepository<LicenseKey>('licenseKey'),

  findByDealer(dealerId: string, tx?: Tx): Promise<LicenseKey | undefined> {
    return this.findFirst({ dealerId }, tx);
  },
};

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customers = {
  ...makeRepository<Customer>('customer'),

  findByIds(ids: string[], tx?: Tx): Promise<Customer[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.findMany({ where: { id: { in: ids } } }, tx);
  },

  /**
   * The duplicate guard at the counter: the same person entered twice is the
   * commonest data-quality problem in these shops. A unique index on
   * (dealer, cnic) backs this up for the concurrent case.
   */
  findDuplicate(
    args: { dealerId: string; cnic: string; phone: string; excludeId?: string },
    tx?: Tx
  ): Promise<Customer | undefined> {
    return this.findFirst(
      {
        dealerId: args.dealerId,
        active: true,
        OR: [{ cnic: args.cnic }, { phone: args.phone }],
        ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
      },
      tx
    );
  },

  list(
    args: { dealerId: string | null; customerId?: string; search?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<Customer>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };

    // A CUSTOMER login only ever sees itself.
    if (args.customerId) where.id = args.customerId;

    if (args.search) {
      where.OR = [
        { name: contains(args.search) },
        { phone: contains(args.search) },
        { cnic: contains(args.search) },
      ];
    }

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },
};

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const devices = {
  ...makeRepository<Device>('device'),

  findByImei(imei: string, tx?: Tx): Promise<Device | undefined> {
    return this.findFirst({ imei }, tx);
  },

  findByCustomer(customerId: string, tx?: Tx): Promise<Device[]> {
    return this.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } }, tx);
  },

  findByIds(ids: string[], tx?: Tx): Promise<Device[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.findMany({ where: { id: { in: ids } } }, tx);
  },

  /** Devices counting against a dealer's licensed limit. */
  countActiveForDealer(dealerId: string, tx?: Tx): Promise<number> {
    return this.count({ dealerId, status: { not: 'REMOVED' } }, tx);
  },

  list(
    args: {
      dealerId: string | null;
      customerId?: string;
      status?: string;
      brand?: string;
      search?: string;
    } & PageArgs,
    tx?: Tx
  ): Promise<Page<Device>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };

    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;
    if (args.brand && args.brand !== 'ALL') where.brand = { equals: args.brand, mode: 'insensitive' };

    if (args.search) {
      // Searching the customer's name and phone as well is why this reaches
      // through the relation rather than filtering two result sets in JS.
      where.OR = [
        { brand: contains(args.search) },
        { model: contains(args.search) },
        { imei: { contains: args.search } },
        { customer: { is: { name: contains(args.search) } } },
        { customer: { is: { phone: { contains: args.search } } } },
      ];
    }

    return this.paginate({ where, orderBy: { updatedAt: 'desc' }, ...args }, tx);
  },

  /** Status tallies for the dashboard, counted by the database in one pass. */
  async countByStatus(dealerId: string | null, tx?: Tx): Promise<Record<string, number>> {
    const rows = await delegate('device', tx).groupBy({
      by: ['status'],
      where: dealerScope(dealerId),
      _count: { _all: true },
    });

    const out: Record<string, number> = {};
    for (const row of rows as { status: string; _count: { _all: number } }[]) {
      out[row.status] = row._count._all;
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Plans and installments
// ---------------------------------------------------------------------------

export const installmentPlans = {
  ...makeRepository<InstallmentPlan>('installmentPlan'),

  findByDevice(deviceId: string, tx?: Tx): Promise<InstallmentPlan | undefined> {
    return this.findFirst({ deviceId }, tx);
  },

  findByDevices(deviceIds: string[], tx?: Tx): Promise<InstallmentPlan[]> {
    if (deviceIds.length === 0) return Promise.resolve([]);
    return this.findMany({ where: { deviceId: { in: deviceIds } } }, tx);
  },

  findByCustomer(customerId: string, tx?: Tx): Promise<InstallmentPlan[]> {
    return this.findMany({ where: { customerId } }, tx);
  },

  /** Plans a payment could be applied to — neither finished nor cancelled. */
  findOpenForCustomer(customerId: string, tx?: Tx): Promise<InstallmentPlan[]> {
    return this.findMany(
      { where: { customerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
      tx
    );
  },

  list(
    args: { dealerId: string | null; customerId?: string; status?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<InstallmentPlan>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },

  /** Outstanding balance across a scope, summed by the database. */
  async totals(dealerId: string | null, tx?: Tx): Promise<{ financed: number; remaining: number }> {
    const result = (await delegate('installmentPlan', tx).aggregate({
      where: dealerScope(dealerId),
      _sum: { financedAmount: true, remainingBalance: true },
    })) as { _sum: { financedAmount: number | null; remainingBalance: number | null } };

    return {
      financed: result._sum.financedAmount ?? 0,
      remaining: result._sum.remainingBalance ?? 0,
    };
  },
};

export const installments = {
  ...makeRepository<Installment>('installment'),

  findByPlan(planId: string, tx?: Tx): Promise<Installment[]> {
    return this.findMany({ where: { planId }, orderBy: { installmentNumber: 'asc' } }, tx);
  },

  findByPlans(planIds: string[], tx?: Tx): Promise<Installment[]> {
    if (planIds.length === 0) return Promise.resolve([]);
    return this.findMany(
      { where: { planId: { in: planIds } }, orderBy: { installmentNumber: 'asc' } },
      tx
    );
  },

  /**
   * Everything the nightly overdue job has to look at: unpaid, past its grace
   * date. The `(status, grace_date)` index turns this into a range scan rather
   * than a scan of every installment ever written.
   */
  findOverdueAsOf(asOfDate: Date, dealerId: string | null, tx?: Tx): Promise<Installment[]> {
    return this.findMany(
      {
        where: {
          ...dealerScope(dealerId),
          status: { not: 'PAID' },
          graceDate: { lt: asOfDate },
        },
        orderBy: { graceDate: 'asc' },
      },
      tx
    );
  },

  /** Installments falling due within the next `days`, for reminders. */
  findDueBetween(from: Date, to: Date, dealerId: string | null, tx?: Tx): Promise<Installment[]> {
    return this.findMany(
      {
        where: {
          ...dealerScope(dealerId),
          status: { not: 'PAID' },
          dueDate: { gte: from, lte: to },
        },
        orderBy: { dueDate: 'asc' },
      },
      tx
    );
  },

  list(
    args: { dealerId: string | null; customerId?: string; planId?: string; status?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<Installment>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.planId) where.planId = args.planId;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    return this.paginate({ where, orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }], ...args }, tx);
  },
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const payments = {
  ...makeRepository<Payment>('payment'),

  /**
   * The double-submit guard. A unique index on (dealer, reference) enforces the
   * same rule for two requests racing each other; this returns the existing
   * payment so the counter clerk gets a useful message instead of a 500.
   */
  findByReference(dealerId: string, referenceNumber: string, tx?: Tx): Promise<Payment | undefined> {
    return this.findFirst(
      { dealerId, referenceNumber, status: { not: 'FAILED' }, reversedAt: null },
      tx
    );
  },

  findByPlan(planId: string, tx?: Tx): Promise<Payment[]> {
    return this.findMany({ where: { planId }, orderBy: { createdAt: 'desc' } }, tx);
  },

  /**
   * The next receipt number for a dealer this year.
   *
   * Counting rows was fine in a single-process JSON store; against a database
   * it would hand two concurrent payments the same number. Taking the maximum
   * already issued and adding one is still not race-proof on its own — the
   * caller runs it inside the payment's transaction, where the row lock makes
   * it so.
   */
  async nextReceiptNumber(dealerId: string, year: number, tx?: Tx): Promise<string> {
    const prefix = `RCP-${year}-`;

    const rows = await delegate('payment', tx).findMany({
      where: { dealerId, receiptNumber: { startsWith: prefix } },
      orderBy: { receiptNumber: 'desc' },
      take: 1,
      select: { receiptNumber: true },
    });

    const last = (rows[0] as { receiptNumber?: string } | undefined)?.receiptNumber;
    const lastSequence = last ? Number(last.slice(prefix.length)) : 0;
    const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;

    return `${prefix}${String(next).padStart(6, '0')}`;
  },

  list(
    args: {
      dealerId: string | null;
      customerId?: string;
      planId?: string;
      status?: string;
      method?: string;
      search?: string;
    } & PageArgs,
    tx?: Tx
  ): Promise<Page<Payment>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.planId) where.planId = args.planId;
    if (args.status && args.status !== 'ALL') where.status = args.status;
    if (args.method && args.method !== 'ALL') where.paymentMethod = args.method;
    if (args.search) {
      where.OR = [
        { referenceNumber: contains(args.search) },
        { receiptNumber: contains(args.search) },
        { customer: { is: { name: contains(args.search) } } },
      ];
    }

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },

  /**
   * Collection totals for a filtered set, summed in SQL.
   *
   * The list screen shows totals for the whole filter, not the visible page, so
   * these must not be computed from `list()`'s rows.
   */
  async totals(
    where: Record<string, unknown>,
    tx?: Tx
  ): Promise<{ count: number; verifiedAmount: number; pendingAmount: number; reversedAmount: number }> {
    const d = delegate('payment', tx);

    const [count, verified, pending, reversed] = await Promise.all([
      d.count({ where }),
      d.aggregate({ where: { ...where, status: 'VERIFIED', reversedAt: null }, _sum: { amount: true } }),
      d.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true } }),
      d.aggregate({ where: { ...where, reversedAt: { not: null } }, _sum: { amount: true } }),
    ]);

    const sum = (r: unknown) => ((r as { _sum: { amount: number | null } })._sum.amount ?? 0);

    return {
      count,
      verifiedAmount: sum(verified),
      pendingAmount: sum(pending),
      reversedAmount: sum(reversed),
    };
  },

  /** Total collected in a period, for the dashboard. */
  async collectedBetween(dealerId: string | null, from: Date, to: Date, tx?: Tx): Promise<number> {
    const result = (await delegate('payment', tx).aggregate({
      where: {
        ...dealerScope(dealerId),
        status: 'VERIFIED',
        reversedAt: null,
        createdAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    })) as { _sum: { amount: number | null } };

    return result._sum.amount ?? 0;
  },
};

export const transactions = {
  ...makeRepository<Transaction>('transaction'),

  findByPayment(paymentId: string, tx?: Tx): Promise<Transaction | undefined> {
    return this.findFirst({ paymentId }, tx);
  },

  list(
    args: { dealerId: string | null; customerId?: string; type?: string; status?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<Transaction>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.type && args.type !== 'ALL') where.type = args.type;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    return this.paginate({ where, orderBy: { date: 'desc' }, ...args }, tx);
  },
};

// ---------------------------------------------------------------------------
// Enrollment, logs, notifications
// ---------------------------------------------------------------------------

export const enrollmentTokens = {
  ...makeRepository<EnrollmentToken>('enrollmentToken'),

  findByToken(token: string, tx?: Tx): Promise<EnrollmentToken | undefined> {
    return this.findFirst({ token }, tx);
  },

  findByDevice(deviceId: string, tx?: Tx): Promise<EnrollmentToken[]> {
    return this.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' } }, tx);
  },

  /** The hourly cleanup: expire anything still waiting past its expiry. */
  expireStale(now: Date, tx?: Tx): Promise<number> {
    return this.updateMany(
      { status: { in: ['WAITING', 'SCANNED', 'VERIFYING'] }, expiresAt: { lt: now } },
      { status: 'EXPIRED' },
      tx
    );
  },
};

export const deviceActionLogs = {
  ...makeRepository<DeviceActionLog>('deviceActionLog'),

  findByDevice(deviceId: string, limit = 50, tx?: Tx): Promise<DeviceActionLog[]> {
    return this.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: limit }, tx);
  },
};

export const auditLogs = {
  ...makeRepository<AuditLog>('auditLog'),

  list(
    args: { dealerId: string | null; action?: string; targetType?: string; search?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<AuditLog>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.action && args.action !== 'ALL') where.action = args.action;
    if (args.targetType && args.targetType !== 'ALL') where.targetType = args.targetType;
    if (args.search) {
      where.OR = [{ actorName: contains(args.search) }, { details: contains(args.search) }];
    }

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },
};

export const notifications = {
  ...makeRepository<Notification>('notification'),

  list(
    args: { dealerId: string | null; customerId?: string; status?: string; type?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<Notification>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;
    if (args.type && args.type !== 'ALL') where.type = args.type;

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },
};

export const notificationTemplates = makeRepository<NotificationTemplate>('notificationTemplate');

// ---------------------------------------------------------------------------

/** Every repository, for call sites that would otherwise import a dozen names. */
export const repo = {
  dealers,
  users,
  customers,
  devices,
  enrollmentTokens,
  installmentPlans,
  installments,
  payments,
  transactions,
  deviceActionLogs,
  auditLogs,
  licenseKeys,
  devicePolicies,
  notifications,
  notificationTemplates,
};

/**
 * Builds a `Map` keyed by one field from a list already fetched.
 *
 * This is the replacement for the old store's `indexBy`: the rows come from one
 * `WHERE id IN (...)` query rather than a lookup per row, and this only turns
 * that result into a map for the join.
 */
export function indexBy<T>(rows: T[], key: (row: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const k = key(row);
    if (k !== undefined) map.set(k, row);
  }
  return map;
}

/** `indexBy` for a one-to-many join. */
export function groupBy<T>(rows: T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === undefined) continue;
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export { toSkipTake, toDomainList };
