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
  Notification, NotificationTemplate, SmsRelay, Contract,
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

/**
 * The filters each list screen sends.
 *
 * Declared as named types rather than inferred from the method that consumes
 * them: a repository referring to its own method's parameter type from inside
 * its object literal makes the inferred type circular.
 */
export interface TransactionFilters {
  dealerId: string | null;
  customerId?: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface AuditLogFilters {
  dealerId: string | null;
  action?: string;
  targetType?: string;
  userId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface NotificationFilters {
  dealerId: string | null;
  customerId?: string;
  status?: string;
  type?: string;
}

export interface PaymentFilters {
  dealerId: string | null;
  customerId?: string;
  planId?: string;
  status?: string;
  method?: string;
  search?: string;
  from?: string;
  to?: string;
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
    args: {
      dealerId: string | null;
      customerId?: string;
      search?: string;
      /** Derived from the customer's plans, not stored on the row. */
      paymentStatus?: 'ALL' | 'CURRENT' | 'OVERDUE' | 'COMPLETED';
      orderBy?: unknown;
    } & PageArgs,
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

    /**
     * Payment status is a property of the customer's plans, so it becomes a
     * relation filter rather than a post-filter over fetched rows — otherwise
     * the page size and the total would both be computed from the wrong set.
     */
    if (args.paymentStatus === 'OVERDUE') {
      where.installmentPlans = { some: { status: 'OVERDUE' } };
    } else if (args.paymentStatus === 'COMPLETED') {
      where.installmentPlans = { some: {}, every: { status: 'COMPLETED' } };
    } else if (args.paymentStatus === 'CURRENT') {
      where.installmentPlans = { none: { status: 'OVERDUE' } };
      where.NOT = { installmentPlans: { some: {}, every: { status: 'COMPLETED' } } };
    }

    return this.paginate({ where, orderBy: args.orderBy ?? { createdAt: 'desc' }, ...args }, tx);
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
    args: { dealerId: string | null; customerId?: string; status?: string; search?: string } & PageArgs,
    tx?: Tx
  ): Promise<Page<InstallmentPlan>> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    if (args.search) {
      // Reaches through the customer and device relations so the search box
      // matches a buyer's name or a handset model, not just the plan id.
      where.OR = [
        { id: contains(args.search) },
        { customer: { is: { name: contains(args.search) } } },
        { device: { is: { model: contains(args.search) } } },
        { device: { is: { brand: contains(args.search) } } },
      ];
    }

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

  buildWhere(args: PaymentFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.planId) where.planId = args.planId;
    if (args.status && args.status !== 'ALL') where.status = args.status;
    if (args.method && args.method !== 'ALL') where.paymentMethod = args.method;
    if (args.search) {
      where.OR = [
        { referenceNumber: contains(args.search) },
        { receiptNumber: contains(args.search) },
        { paymentMethod: contains(args.search) },
        { customer: { is: { name: contains(args.search) } } },
      ];
    }

    if (args.from || args.to) {
      const range: Record<string, Date> = {};
      if (args.from) range.gte = new Date(args.from);
      if (args.to) range.lte = new Date(`${args.to}T23:59:59.999Z`);
      where.createdAt = range;
    }

    return where;
  },

  list(args: PaymentFilters & PageArgs, tx?: Tx): Promise<Page<Payment>> {
    return this.paginate({ where: this.buildWhere(args), orderBy: { createdAt: 'desc' }, ...args }, tx);
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
  ): Promise<{
    count: number;
    verifiedCount: number;
    verifiedAmount: number;
    pendingAmount: number;
    reversedAmount: number;
  }> {
    const d = delegate('payment', tx);
    const settled = { ...where, status: 'VERIFIED', reversedAt: null };

    const [count, verifiedCount, verified, pending, reversed] = await Promise.all([
      d.count({ where }),
      d.count({ where: settled }),
      d.aggregate({ where: settled, _sum: { amount: true } }),
      d.aggregate({ where: { ...where, status: 'PENDING' }, _sum: { amount: true } }),
      d.aggregate({ where: { ...where, reversedAt: { not: null } }, _sum: { amount: true } }),
    ]);

    const sum = (r: unknown) => ((r as { _sum: { amount: number | null } })._sum.amount ?? 0);

    return {
      count,
      verifiedCount,
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

  /** The `where` a list request implies, shared by `list` and `totals`. */
  buildWhere(args: TransactionFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.type && args.type !== 'ALL') where.type = args.type;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    if (args.from || args.to) {
      const range: Record<string, Date> = {};
      if (args.from) range.gte = new Date(args.from);
      // An inclusive end date means the whole of that day.
      if (args.to) range.lte = new Date(`${args.to}T23:59:59.999Z`);
      where.date = range;
    }

    return where;
  },

  list(args: TransactionFilters & PageArgs, tx?: Tx): Promise<Page<Transaction>> {
    return this.paginate({ where: this.buildWhere(args), orderBy: { date: 'desc' }, ...args }, tx);
  },

  /**
   * Money in versus money out for a filtered set, so the ledger footer balances.
   * Both sums come from the database and cover the whole filter, not one page.
   */
  async totals(
    where: Record<string, unknown>,
    tx?: Tx
  ): Promise<{ count: number; inflow: number; outflow: number; net: number }> {
    const d = delegate('transaction', tx);
    const completed = { ...where, status: 'COMPLETED' };

    const [count, credits, debits] = await Promise.all([
      d.count({ where }),
      d.aggregate({ where: { ...completed, amount: { gt: 0 } }, _sum: { amount: true } }),
      d.aggregate({ where: { ...completed, amount: { lt: 0 } }, _sum: { amount: true } }),
    ]);

    const sum = (r: unknown) => ((r as { _sum: { amount: number | null } })._sum.amount ?? 0);
    const inflow = sum(credits);
    const outflow = Math.abs(sum(debits));

    return { count, inflow, outflow, net: inflow - outflow };
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

  buildWhere(args: AuditLogFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.action && args.action !== 'ALL') where.action = args.action;
    if (args.targetType && args.targetType !== 'ALL') where.targetType = args.targetType;
    if (args.userId) where.userId = args.userId;
    if (args.search) {
      where.OR = [
        { actorName: contains(args.search) },
        { action: contains(args.search) },
        { details: contains(args.search) },
      ];
    }

    if (args.from || args.to) {
      const range: Record<string, Date> = {};
      if (args.from) range.gte = new Date(args.from);
      if (args.to) range.lte = new Date(`${args.to}T23:59:59.999Z`);
      where.createdAt = range;
    }

    return where;
  },

  list(args: AuditLogFilters & PageArgs, tx?: Tx): Promise<Page<AuditLog>> {
    return this.paginate({ where: this.buildWhere(args), orderBy: { createdAt: 'desc' }, ...args }, tx);
  },

  /**
   * The distinct values behind the filter dropdowns.
   *
   * Two grouped queries over the filtered set, rather than loading every log
   * row into memory to collect its distinct actions.
   */
  async facets(
    where: Record<string, unknown>,
    tx?: Tx
  ): Promise<{ actions: string[]; targetTypes: string[] }> {
    const d = delegate('auditLog', tx);

    const [actions, targetTypes] = await Promise.all([
      d.groupBy({ by: ['action'], where }),
      d.groupBy({ by: ['targetType'], where }),
    ]);

    return {
      actions: (actions as { action: string }[]).map((r) => r.action).sort(),
      targetTypes: (targetTypes as { targetType: string }[]).map((r) => r.targetType).sort(),
    };
  },
};

export const notifications = {
  ...makeRepository<Notification>('notification'),

  buildWhere(args: NotificationFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;
    if (args.type && args.type !== 'ALL') where.type = args.type;
    return where;
  },

  list(args: NotificationFilters & PageArgs, tx?: Tx): Promise<Page<Notification>> {
    return this.paginate({ where: this.buildWhere(args), orderBy: { createdAt: 'desc' }, ...args }, tx);
  },

  /** Delivery-state tallies over the whole filter, counted by the database. */
  async statusCounts(
    where: Record<string, unknown>,
    tx?: Tx
  ): Promise<{ queued: number; sent: number; failed: number }> {
    const rows = (await delegate('notification', tx).groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    })) as { status: string; _count: { _all: number } }[];

    const by = (status: string) => rows.find((r) => r.status === status)?._count._all ?? 0;
    return { queued: by('QUEUED'), sent: by('SENT'), failed: by('FAILED') };
  },

  /**
   * Claims queued SMS for one relay to send.
   *
   * The claim is an `updateMany` whose filter names the state it expects, which
   * makes it a compare-and-set: of two relays polling at the same instant, only
   * one can move a given row, and the other is handed nothing rather than the
   * same message. A read-then-write here would text a customer twice about the
   * same overdue payment.
   *
   * The ids are chosen first so the lease can be applied to exactly that set —
   * `updateMany` cannot express "the oldest twenty" on its own.
   */
  async claimForRelay(
    dealerId: string,
    limit: number,
    leaseUntil: Date,
    tx?: Tx
  ): Promise<Notification[]> {
    const now = new Date();

    const candidates = (await delegate('notification', tx).findMany({
      where: {
        dealerId,
        channel: 'SMS',
        status: 'QUEUED',
        // Free, or held by a relay that stopped answering.
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })) as Record<string, unknown>[];

    const ids = candidates.map((row) => row.id as string);
    if (ids.length === 0) return [];

    await delegate('notification', tx).updateMany({
      where: {
        id: { in: ids },
        status: 'QUEUED',
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil, attempts: { increment: 1 } },
    });

    // Re-read so the caller sees the rows it actually won, not the ones it
    // hoped to: a concurrent poll may have taken some of them in between.
    const claimed = (await delegate('notification', tx).findMany({
      where: { id: { in: ids }, leaseUntil },
      orderBy: { createdAt: 'asc' },
    })) as Record<string, unknown>[];

    return toDomainList<Notification>(claimed);
  },
};

/** Signed financing agreements. One per device, which is what makes these lookups unique. */
export const contracts = {
  ...makeRepository<Contract>('contract'),

  findByDevice(deviceId: string, tx?: Tx): Promise<Contract | undefined> {
    return this.findFirst({ deviceId }, tx);
  },

  findByPlan(planId: string, tx?: Tx): Promise<Contract | undefined> {
    return this.findFirst({ planId }, tx);
  },

  list(args: { dealerId: string | null; status?: string; customerId?: string } & PageArgs, tx?: Tx) {
    const where: Record<string, unknown> = { ...dealerScope(args.dealerId) };
    if (args.customerId) where.customerId = args.customerId;
    if (args.status && args.status !== 'ALL') where.status = args.status;

    return this.paginate({ where, orderBy: { createdAt: 'desc' }, ...args }, tx);
  },
};

/**
 * Phones paired to send a dealership's SMS.
 *
 * The lookup is by token hash, exactly as the DPC's is — the relay presents its
 * id alongside, so this is an indexed read rather than a scan.
 */
export const smsRelays = {
  ...makeRepository<SmsRelay>('smsRelay'),

  findActiveByDealer(dealerId: string, tx?: Tx): Promise<SmsRelay[]> {
    return this.findMany({ where: { dealerId, revokedAt: null }, orderBy: { createdAt: 'desc' } }, tx);
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
  smsRelays,
  contracts,
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
