import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, groupBy } from '../db/repositories/index.js';
import { runInTransaction, Tx } from '../db/prisma.js';
import {
  Customer, Device, InstallmentPlan, Installment, Payment,
} from '../types/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import { ContractService } from '../services/ContractService.js';
import { LicenseService } from '../services/LicenseService.js';
import { AuditService } from '../services/AuditService.js';
import { buildInstallmentSchedule } from '../services/InstallmentMath.js';
import {
  requireDealerStaff, requireDealerAdmin, getAuthUser, resolveDealerScope,
  resolveWritableDealerId, assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { sanitizeCustomer, sanitizeDevice } from '../utils/mask.js';
import {
  cnicSchema, pakistaniPhoneSchema, imeiSchema, isoDateSchema, moneySchema,
  normalizePhone, paginationSchema, pageEnvelope,
} from '../utils/validators.js';

export const customersRouter = Router();

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['ALL', 'CURRENT', 'OVERDUE', 'COMPLETED']).default('ALL'),
  dealerId: z.string().trim().max(64).optional(),
});

customersRouter.get('/', validateQuery(listQuerySchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  // Search and the payment-status filter are both applied by the database, so
  // the page and the total describe the same set. The old code filtered after
  // paginating, which made the page counter disagree with the rows shown.
  const page = await repo.customers.list({
    dealerId: scope,
    customerId: user.role === 'CUSTOMER' ? user.customerId : undefined,
    search: q.search,
    paymentStatus: q.status,
    orderBy: { name: 'asc' },
    page: q.page,
    limit: q.limit,
  });

  // The joins below cover only the customers on this page.
  const ids = page.data.map((c) => c.id);
  const [deviceRows, planRows, paymentRows] = await Promise.all([
    repo.devices.findMany({ where: { customerId: { in: ids } } }),
    repo.installmentPlans.findMany({ where: { customerId: { in: ids } } }),
    repo.payments.findMany({
      where: { customerId: { in: ids }, status: 'VERIFIED' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const devicesByCustomer = groupBy<Device>(deviceRows, (d) => d.customerId);
  const plansByCustomer = groupBy<InstallmentPlan>(planRows, (p) => p.customerId);
  const paymentsByCustomer = groupBy<Payment>(paymentRows, (p) => p.customerId);

  const withStats = page.data.map((c) => {
    const custDevices = devicesByCustomer.get(c.id) ?? [];
    const custPlans = plansByCustomer.get(c.id) ?? [];
    const verifiedPayments = paymentsByCustomer.get(c.id) ?? [];

    const outstandingBalance = custPlans.reduce((sum, p) => sum + (p.remainingBalance || 0), 0);
    const outstandingLateFees = custPlans.reduce((sum, p) => sum + (p.outstandingLateFees || 0), 0);
    const creditBalance = custPlans.reduce((sum, p) => sum + (p.creditBalance || 0), 0);
    // Already ordered newest-first by the query.
    const lastPayment = verifiedPayments[0];

    const hasOverdue = custPlans.some((p) => p.status === 'OVERDUE');
    const allComplete = custPlans.length > 0 && custPlans.every((p) => p.status === 'COMPLETED');

    return {
      ...sanitizeCustomer(c, user.role, user.customerId),
      totalDevices: custDevices.length,
      lockedDevices: custDevices.filter((d) => d.status === 'LOCKED' || d.status === 'LOCK_PENDING').length,
      outstandingBalance,
      outstandingLateFees,
      creditBalance,
      paymentStatus: hasOverdue ? 'OVERDUE' : allComplete ? 'COMPLETED' : 'CURRENT',
      lastPaymentDate: lastPayment?.createdAt ?? null,
      lastPaymentAmount: lastPayment?.amount ?? 0,
    };
  });

  res.json(pageEnvelope(withStats, page, q.limit));
}));

// ---------------------------------------------------------------------------
// DETAIL
// ---------------------------------------------------------------------------

customersRouter.get('/:id', asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const customer = await repo.customers.findById(routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');

  assertDealerAccess(req, customer.dealerId, 'customer');
  if (user.role === 'CUSTOMER' && customer.id !== user.customerId) {
    throw AppError.notFound('Customer');
  }

  const [devices, plans, installments, payments, notifications] = await Promise.all([
    repo.devices.findByCustomer(customer.id),
    repo.installmentPlans.findByCustomer(customer.id),
    repo.installments.findMany({
      where: { customerId: customer.id },
      orderBy: [{ dueDate: 'asc' }, { installmentNumber: 'asc' }],
    }),
    repo.payments.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } }),
    repo.notifications.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  res.json({
    customer: sanitizeCustomer(customer, user.role, user.customerId),
    devices: devices.map((d) => sanitizeDevice(d, user.role)),
    plans,
    installments,
    payments,
    notifications,
    summary: {
      totalFinanced: plans.reduce((s, p) => s + p.financedAmount, 0),
      outstandingBalance: plans.reduce((s, p) => s + (p.remainingBalance || 0), 0),
      outstandingLateFees: plans.reduce((s, p) => s + (p.outstandingLateFees || 0), 0),
      creditBalance: plans.reduce((s, p) => s + (p.creditBalance || 0), 0),
      totalPaid: payments.filter((p) => p.status === 'VERIFIED').reduce((s, p) => s + p.amount, 0),
      overdueInstallments: installments.filter((i) => i.status === 'OVERDUE').length,
    },
  });
}));

// ---------------------------------------------------------------------------
// CREATE (customer + optional device + financing plan)
// ---------------------------------------------------------------------------

/** Both spellings a CNIC may be stored under: 35202-1234567-1 and 3520212345671. */
function cnicForms(cnic: string): string[] {
  const digits = cnic.replace(/\D/g, '');
  if (digits.length !== 13) return [cnic.trim()];
  return [`${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`, digits];
}

/** Names compared without case, extra spaces or dots: "M. Aslam" ≠ "Muhammad Aslam", but "muhammad  ASLAM" = "Muhammad Aslam". */
function comparableName(name: string): string {
  return name.toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
}

const createSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  customer: z.object({
    name: z.string().trim().min(3, 'Customer name must be at least 3 characters.').max(120),
    phone: pakistaniPhoneSchema,
    cnic: cnicSchema,
    address: z.string().trim().min(5, 'Please enter a complete address.').max(300),
    emergencyContactName: z.string().trim().min(3, 'Emergency contact name is required.').max(120),
    emergencyContactPhone: pakistaniPhoneSchema,
    notes: z.string().trim().max(1000).optional(),
  }),
  device: z
    .object({
      brand: z.string().trim().min(1).max(40),
      model: z.string().trim().min(1).max(60),
      imei: imeiSchema,
      serialNumber: z.string().trim().max(64).optional(),
      color: z.string().trim().max(30).default('Black'),
      ramStorage: z.string().trim().max(40).default('8GB / 128GB'),
      purchasePrice: moneySchema.refine((v) => v > 0, 'Purchase price must be greater than zero.'),
      osVersion: z.string().trim().max(40).default('Android 14'),
    })
    .optional(),
  plan: z
    .object({
      downPayment: moneySchema,
      totalInstallments: z.number().int().min(1, 'At least 1 installment is required.').max(60, 'Maximum 60 installments.'),
      firstDueDate: isoDateSchema,
      gracePeriodDays: z.number().int().min(0).max(30).default(3),
    })
    .optional(),
  qrType: z.enum(['STANDARD', 'PRO', 'LEGACY', 'QC']).default('STANDARD'),
  /**
   * The phone cannot be locked (newer Huawei, iPhone, very old Android). The
   * plan, contract and ledger are kept as for any sale, but no lock is needed
   * or spent and no QR is issued.
   */
  noLock: z.boolean().default(false),
});

customersRouter.post('/', requireDealerStaff, validateBody(createSchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const body = req.body as z.infer<typeof createSchema>;
  const dealerId = await resolveWritableDealerId(req, body.dealerId);

  // A device may not be financed without a plan, and vice versa.
  if (body.device && !body.plan) {
    throw AppError.badRequest('A financing plan is required when registering a device.');
  }
  if (body.plan && !body.device) {
    throw AppError.badRequest('A device is required when creating a financing plan.');
  }

  const normalizedPhone = normalizePhone(body.customer.phone);

  /**
   * One person, many phones.
   *
   * A CNIC already on file is the same customer coming back for a second or
   * third handset. The sale is added to that record rather than refused, so
   * their plans, payments and history stay together. Entering the same person
   * twice with no phone to sell is still a duplicate, and so is a CNIC typed
   * under somebody else's name — that is far more often a wrong CNIC than a
   * returning customer.
   */
  const sameCnic = await repo.customers.findFirst({ dealerId, cnic: { in: cnicForms(body.customer.cnic) } });
  let returningCustomer: Customer | undefined;
  if (sameCnic) {
    if (!body.device) {
      throw AppError.conflict(`A customer with this CNIC already exists: ${sameCnic.name}.`);
    }
    if (comparableName(sameCnic.name) !== comparableName(body.customer.name)) {
      throw AppError.conflict(
        `This CNIC is already on file for ${sameCnic.name}. To sell them another phone, enter the name exactly as on file. ` +
          'If this is a different person, check the CNIC.'
      );
    }
    returningCustomer = sameCnic;
  } else {
    // A phone number already used by a different CNIC is still refused.
    const duplicate = await repo.customers.findDuplicate({
      dealerId,
      cnic: body.customer.cnic,
      phone: normalizedPhone,
    });
    if (duplicate) {
      throw AppError.conflict(`A customer with this phone number already exists: ${duplicate.name}.`);
    }
  }

  if (body.device) {
    if (await repo.devices.findByImei(body.device.imei)) {
      throw AppError.conflict(`A device with this IMEI is already registered in the system.`);
    }

    /**
     * A phone that cannot be locked is not a financed sale, so the counter is
     * stopped here rather than at enrolment — sending the customer home with a
     * handset and discovering the shop is out of locks when the QR is scanned
     * is the worst possible moment to find out.
     *
     * The lock is not spent yet. It is claimed when the handset actually
     * enrols, so a sale that falls through costs the dealer nothing.
     */
    const locksLeft = body.noLock ? 1 : await LicenseService.countAvailable(dealerId);
    if (locksLeft <= 0) {
      throw AppError.forbidden(
        'You have no device locks left. Each handset needs its own lock, and a lock is not returned when a plan is paid off. Buy a pack before registering another financed sale.'
      );
    }
  }

  // Customer, device, plan, every installment and the down-payment entry are
  // one unit. Under the JSON store a failure part-way left a customer with a
  // device and no schedule — a financed phone nobody was billed for.
  const result = await runInTransaction(async (tx: Tx) => {
    const nowIso = new Date().toISOString();

    const customer = returningCustomer
      ? returningCustomer.active
        ? returningCustomer
        : ((await repo.customers.update(returningCustomer.id, { active: true }, tx)) ?? returningCustomer)
      : await repo.customers.create({
      id: `cust-${uuidv4().substring(0, 8)}`,
      dealerId,
      name: body.customer.name,
      phone: normalizedPhone,
      cnic: body.customer.cnic,
      address: body.customer.address,
      emergencyContactName: body.customer.emergencyContactName,
      emergencyContactPhone: normalizePhone(body.customer.emergencyContactPhone),
      notes: body.customer.notes,
      active: true,
      createdAt: nowIso,
    }, tx);

    let device: Device | undefined;
    let plan: InstallmentPlan | undefined;
    let installments: Installment[] = [];

    if (body.device && body.plan) {
      const price = body.device.purchasePrice;

      if (body.plan.downPayment >= price) {
        throw AppError.badRequest('The down payment cannot be equal to or greater than the device price.');
      }

      device = await repo.devices.create({
        id: `dev-${uuidv4().substring(0, 8)}`,
        dealerId,
        customerId: customer.id,
        brand: body.device.brand,
        model: body.device.model,
        imei: body.device.imei,
        serialNumber:
          body.device.serialNumber ||
          `SN${body.device.brand.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-6)}`,
        color: body.device.color,
        ramStorage: body.device.ramStorage,
        purchasePrice: price,
        status: 'PENDING',
        noLock: body.noLock,
        lastSeen: nowIso,
        batteryLevel: 100,
        isOnline: false,
        osVersion: body.device.osVersion,
        securityPatch: nowIso.split('T')[0],
        createdAt: nowIso,
        updatedAt: nowIso,
      }, tx);

      const planId = `plan-${uuidv4().substring(0, 8)}`;

      // Schedule generation lives in one place so the rounding is provably exact.
      const schedule = buildInstallmentSchedule({
        financedAmount: price - body.plan.downPayment,
        totalInstallments: body.plan.totalInstallments,
        firstDueDate: body.plan.firstDueDate,
        gracePeriodDays: body.plan.gracePeriodDays,
      });

      plan = await repo.installmentPlans.create({
        id: planId,
        dealerId,
        customerId: customer.id,
        deviceId: device.id,
        totalAmount: price,
        downPayment: body.plan.downPayment,
        financedAmount: price - body.plan.downPayment,
        monthlyInstallment: schedule.baseInstallment,
        totalInstallments: body.plan.totalInstallments,
        paidInstallments: 0,
        remainingBalance: price - body.plan.downPayment,
        firstDueDate: body.plan.firstDueDate,
        gracePeriodDays: body.plan.gracePeriodDays,
        status: 'CURRENT',
        creditBalance: 0,
        outstandingLateFees: 0,
        createdAt: nowIso,
      }, tx);

      installments = [];
      for (const row of schedule.rows) {
        installments.push(await repo.installments.create({
          id: `inst-${planId}-${row.installmentNumber}`,
          planId,
          dealerId,
          customerId: customer.id,
          installmentNumber: row.installmentNumber,
          amountDue: row.amountDue,
          amountPaid: 0,
          dueDate: row.dueDate,
          graceDate: row.graceDate,
          status: row.installmentNumber === 1 ? 'DUE_SOON' : 'PENDING',
          lateFee: 0,
          lateFeePaid: 0,
          createdAt: nowIso,
        }, tx));
      }

      /**
       * The contract is drafted with the sale, not after it.
       *
       * A financed device that exists with nothing for the customer to sign is
       * exactly the gap this closes — and drafting it inside the transaction
       * means there is never a handset in the system whose consent document was
       * never created.
       */
      await ContractService.createDraft(
        { dealerId, customerId: customer.id, deviceId: device.id, plan, installments },
        tx
      );

      // The down payment is real money that changed hands — it belongs in the
      // ledger. The original code dropped it entirely.
      if (body.plan.downPayment > 0) {
        await repo.transactions.create({
          id: `tx-${uuidv4().substring(0, 8)}`,
          dealerId,
          customerId: customer.id,
          planId,
          type: 'DOWN_PAYMENT' as const,
          amount: body.plan.downPayment,
          status: 'COMPLETED' as const,
          date: nowIso,
          notes: `Down payment collected at the time of sale for ${device.brand} ${device.model}.`,
        }, tx);
      }
    }

    await AuditService.log({
      dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: returningCustomer ? 'CUSTOMER_SALE_ADDED' : 'CUSTOMER_CREATED',
      targetType: 'CUSTOMER',
      targetId: customer.id,
      details: returningCustomer && device
        ? `Added another financed device for returning customer ${customer.name}: ${device.brand} ${device.model} (Rs. ${device.purchasePrice.toLocaleString()})${device.noLock ? ', sold without a lock' : ''}.`
        : device
        ? `Registered ${customer.name} with financed device ${device.brand} ${device.model} (Rs. ${device.purchasePrice.toLocaleString()})${device.noLock ? ', sold without a lock' : ''}.`
        : `Registered customer ${customer.name} with no device.`,
      ipAddress: clientIp(req),
    }, tx);

    return { customer, device, plan, installments };
  });

  /**
   * The enrollment QR is issued after the registration commits.
   *
   * It opens a transaction of its own to retire any earlier token, and Prisma
   * has no nested interactive transactions. Issuing it second is also the right
   * order: a QR must never exist for a device the registration failed to write.
   */
  const enrollmentToken = result.device && !result.device.noLock
    ? await EnrollmentService.generateToken({
        dealerId,
        deviceId: result.device.id,
        customerId: result.customer.id,
        qrType: body.qrType,
        actor: { userId: user.userId, userName: user.name, userRole: user.role },
      })
    : undefined;

  // The real QR, so the sale screen can show it straight away. It used to show
  // a QR-shaped icon there, which a phone's scanner reads as nothing at all.
  const qr = enrollmentToken ? await EnrollmentService.buildQrPayload(enrollmentToken) : undefined;

  res.status(201).json({
    success: true,
    qrImageDataUrl: qr?.imageDataUrl,
    qrProvisioningReady: qr?.provisioningReady,
    customer: sanitizeCustomer(result.customer, user.role, user.customerId),
    device: result.device ? sanitizeDevice(result.device, user.role) : undefined,
    plan: result.plan,
    installments: result.installments,
    enrollmentToken,
  });
}));

// ---------------------------------------------------------------------------
// UPDATE / DEACTIVATE — neither existed before, so a typo was permanent
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  phone: pakistaniPhoneSchema.optional(),
  cnic: cnicSchema.optional(),
  address: z.string().trim().min(5).max(300).optional(),
  emergencyContactName: z.string().trim().min(3).max(120).optional(),
  emergencyContactPhone: pakistaniPhoneSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

customersRouter.patch('/:id', requireDealerStaff, validateBody(updateSchema), asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const customer = await repo.customers.findById(routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');
  assertDealerAccess(req, customer.dealerId, 'customer');

  const body = req.body as z.infer<typeof updateSchema>;
  if (Object.keys(body).length === 0) throw AppError.badRequest('No changes were supplied.');

  // Changing CNIC or phone must not create a duplicate of another customer.
  if (body.cnic || body.phone) {
    const newPhone = body.phone ? normalizePhone(body.phone) : customer.phone;
    const clash = await repo.customers.findDuplicate({
      dealerId: customer.dealerId,
      cnic: body.cnic ?? customer.cnic,
      phone: newPhone,
      excludeId: customer.id,
    });
    if (clash) {
      throw AppError.conflict(`Another customer (${clash.name}) already uses this CNIC or phone number.`);
    }
  }

  const updates: Partial<Customer> = { ...body };
  if (body.phone) updates.phone = normalizePhone(body.phone);
  if (body.emergencyContactPhone) updates.emergencyContactPhone = normalizePhone(body.emergencyContactPhone);

  const updated = await repo.customers.update(customer.id, updates);
  if (!updated) throw AppError.notFound('Customer');

  await AuditService.log({
    dealerId: customer.dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: 'CUSTOMER_UPDATED',
    targetType: 'CUSTOMER',
    targetId: customer.id,
    details: `${user.name} updated ${customer.name}: ${Object.keys(body).join(', ')}.`,
    ipAddress: clientIp(req),
  });

  res.json(sanitizeCustomer(updated, user.role, user.customerId));
}));

/**
 * Deactivation, never deletion — payments, installments and audit entries all
 * reference the customer id. Blocked while money is still owed.
 */
customersRouter.delete('/:id', requireDealerAdmin, asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const customer = await repo.customers.findById(routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');
  assertDealerAccess(req, customer.dealerId, 'customer');

  const openPlans = await repo.installmentPlans.findOpenForCustomer(customer.id);
  if (openPlans.length > 0) {
    const owed = openPlans.reduce((s, p) => s + (p.remainingBalance || 0), 0);
    throw AppError.badRequest(
      `This customer still has ${openPlans.length} active financing plan(s) with Rs. ${owed.toLocaleString()} outstanding. ` +
        'Close or settle the plans before deactivating the customer.'
    );
  }

  await repo.customers.update(customer.id, { active: false });

  await AuditService.log({
    dealerId: customer.dealerId,
    userId: user.userId,
    actorName: user.name,
    actorRole: user.role,
    action: 'CUSTOMER_DEACTIVATED',
    targetType: 'CUSTOMER',
    targetId: customer.id,
    details: `${user.name} deactivated customer ${customer.name}.`,
    ipAddress: clientIp(req),
  });

  res.json({ success: true, message: `${customer.name} has been deactivated.` });
}));
