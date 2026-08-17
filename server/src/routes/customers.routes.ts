import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import {
  Customer, Device, InstallmentPlan, Installment, Payment, Notification, LicenseKey,
} from '../types/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import { AuditService } from '../services/AuditService.js';
import { buildInstallmentSchedule } from '../services/InstallmentMath.js';
import {
  requireDealerStaff, requireDealerAdmin, getAuthUser, resolveDealerScope,
  resolveWritableDealerId, assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';
import { sanitizeCustomer, sanitizeDevice } from '../utils/mask.js';
import {
  cnicSchema, pakistaniPhoneSchema, imeiSchema, isoDateSchema, moneySchema,
  normalizePhone, paginationSchema, paginate,
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

customersRouter.get('/', validateQuery(listQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  let customers = db.find<Customer>('customers', (c) => {
    if (scope !== null && c.dealerId !== scope) return false;
    // A customer login only ever sees itself.
    if (user.role === 'CUSTOMER' && c.id !== user.customerId) return false;
    return true;
  });

  if (q.search) {
    const needle = q.search.toLowerCase();
    customers = customers.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.phone.includes(needle) ||
        c.cnic.includes(needle)
    );
  }

  // Single-pass joins rather than per-row lookups.
  const devicesByCustomer = db.groupBy<Device>('devices', (d) => d.customerId);
  const plansByCustomer = db.groupBy<InstallmentPlan>('installmentPlans', (p) => p.customerId);
  const paymentsByCustomer = db.groupBy<Payment>('payments', (p) => p.customerId);

  const withStats = customers.map((c) => {
    const custDevices = devicesByCustomer.get(c.id) ?? [];
    const custPlans = plansByCustomer.get(c.id) ?? [];
    const verifiedPayments = (paymentsByCustomer.get(c.id) ?? []).filter((p) => p.status === 'VERIFIED');

    const outstandingBalance = custPlans.reduce((sum, p) => sum + (p.remainingBalance || 0), 0);
    const outstandingLateFees = custPlans.reduce((sum, p) => sum + (p.outstandingLateFees || 0), 0);
    const creditBalance = custPlans.reduce((sum, p) => sum + (p.creditBalance || 0), 0);
    const lastPayment = verifiedPayments
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

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

  const filtered =
    q.status === 'ALL' ? withStats : withStats.filter((c) => c.paymentStatus === q.status);

  filtered.sort((a, b) => a.name.localeCompare(b.name));

  res.json(paginate(filtered, { page: q.page, limit: q.limit }));
});

// ---------------------------------------------------------------------------
// DETAIL
// ---------------------------------------------------------------------------

customersRouter.get('/:id', (req, res) => {
  const user = getAuthUser(req);
  const customer = db.findById<Customer>('customers', routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');

  assertDealerAccess(req, customer.dealerId, 'customer');
  if (user.role === 'CUSTOMER' && customer.id !== user.customerId) {
    throw AppError.notFound('Customer');
  }

  const devices = db.find<Device>('devices', (d) => d.customerId === customer.id);
  const plans = db.find<InstallmentPlan>('installmentPlans', (p) => p.customerId === customer.id);
  const installments = db
    .find<Installment>('installments', (i) => i.customerId === customer.id)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const payments = db
    .find<Payment>('payments', (p) => p.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const notifications = db
    .find<Notification>('notifications', (n) => n.customerId === customer.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

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
});

// ---------------------------------------------------------------------------
// CREATE (customer + optional device + financing plan)
// ---------------------------------------------------------------------------

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
});

customersRouter.post('/', requireDealerStaff, validateBody(createSchema), (req, res) => {
  const user = getAuthUser(req);
  const body = req.body as z.infer<typeof createSchema>;
  const dealerId = resolveWritableDealerId(req, body.dealerId);

  // A device may not be financed without a plan, and vice versa.
  if (body.device && !body.plan) {
    throw AppError.badRequest('A financing plan is required when registering a device.');
  }
  if (body.plan && !body.device) {
    throw AppError.badRequest('A device is required when creating a financing plan.');
  }

  const normalizedPhone = normalizePhone(body.customer.phone);

  // Duplicate guard — the same person being entered twice at the counter is the
  // single most common data-quality problem in these shops.
  const duplicate = db.findOne<Customer>(
    'customers',
    (c) => c.dealerId === dealerId && c.active && (c.cnic === body.customer.cnic || c.phone === normalizedPhone)
  );
  if (duplicate) {
    throw AppError.conflict(
      `A customer with this ${duplicate.cnic === body.customer.cnic ? 'CNIC' : 'phone number'} already exists: ${duplicate.name}.`
    );
  }

  if (body.device) {
    if (db.findOne<Device>('devices', (d) => d.imei === body.device!.imei)) {
      throw AppError.conflict(`A device with this IMEI is already registered in the system.`);
    }

    // Enforce the dealer's licensed device limit.
    const license = db.findOne<LicenseKey>('licenseKeys', (l) => l.dealerId === dealerId);
    if (license) {
      if (license.status !== 'ACTIVE') {
        throw AppError.forbidden(`Your license is ${license.status}. Please renew it to register new devices.`);
      }
      if (license.expiryDate < new Date().toISOString().split('T')[0]) {
        throw AppError.forbidden('Your license has expired. Please renew it to register new devices.');
      }
      const inUse = db.find<Device>('devices', (d) => d.dealerId === dealerId && d.status !== 'REMOVED').length;
      if (inUse >= license.deviceLimit) {
        throw AppError.forbidden(
          `Your ${license.plan} plan allows ${license.deviceLimit} devices and ${inUse} are already registered. Please upgrade to add more.`
        );
      }
    }
  }

  const result = db.batch(() => {
    const nowIso = new Date().toISOString();

    const customer = db.insert<Customer>('customers', {
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
    });

    let device: Device | undefined;
    let plan: InstallmentPlan | undefined;
    let installments: Installment[] = [];
    let enrollmentToken: unknown;

    if (body.device && body.plan) {
      const price = body.device.purchasePrice;

      if (body.plan.downPayment >= price) {
        throw AppError.badRequest('The down payment cannot be equal to or greater than the device price.');
      }

      device = db.insert<Device>('devices', {
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
        lastSeen: nowIso,
        batteryLevel: 100,
        isOnline: false,
        osVersion: body.device.osVersion,
        securityPatch: nowIso.split('T')[0],
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const planId = `plan-${uuidv4().substring(0, 8)}`;

      // Schedule generation lives in one place so the rounding is provably exact.
      const schedule = buildInstallmentSchedule({
        financedAmount: price - body.plan.downPayment,
        totalInstallments: body.plan.totalInstallments,
        firstDueDate: body.plan.firstDueDate,
        gracePeriodDays: body.plan.gracePeriodDays,
      });

      plan = db.insert<InstallmentPlan>('installmentPlans', {
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
      });

      installments = schedule.rows.map((row) =>
        db.insert<Installment>('installments', {
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
        })
      );

      // The down payment is real money that changed hands — it belongs in the
      // ledger. The original code dropped it entirely.
      if (body.plan.downPayment > 0) {
        db.insert('transactions', {
          id: `tx-${uuidv4().substring(0, 8)}`,
          dealerId,
          customerId: customer.id,
          planId,
          type: 'DOWN_PAYMENT' as const,
          amount: body.plan.downPayment,
          status: 'COMPLETED' as const,
          date: nowIso,
          notes: `Down payment collected at the time of sale for ${device.brand} ${device.model}.`,
        });
      }

      enrollmentToken = EnrollmentService.generateToken({
        dealerId,
        deviceId: device.id,
        customerId: customer.id,
        qrType: body.qrType,
        actor: { userId: user.userId, userName: user.name, userRole: user.role },
      });
    }

    AuditService.log({
      dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'CUSTOMER_CREATED',
      targetType: 'CUSTOMER',
      targetId: customer.id,
      details: device
        ? `Registered ${customer.name} with financed device ${device.brand} ${device.model} (Rs. ${device.purchasePrice.toLocaleString()}).`
        : `Registered customer ${customer.name} with no device.`,
      ipAddress: clientIp(req),
    });

    return {
      success: true,
      customer: sanitizeCustomer(customer, user.role, user.customerId),
      device: device ? sanitizeDevice(device, user.role) : undefined,
      plan,
      installments,
      enrollmentToken,
    };
  });

  res.status(201).json(result);
});

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

customersRouter.patch('/:id', requireDealerStaff, validateBody(updateSchema), (req, res) => {
  const user = getAuthUser(req);
  const customer = db.findById<Customer>('customers', routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');
  assertDealerAccess(req, customer.dealerId, 'customer');

  const body = req.body as z.infer<typeof updateSchema>;
  if (Object.keys(body).length === 0) throw AppError.badRequest('No changes were supplied.');

  // Changing CNIC or phone must not create a duplicate of another customer.
  if (body.cnic || body.phone) {
    const newPhone = body.phone ? normalizePhone(body.phone) : customer.phone;
    const clash = db.findOne<Customer>(
      'customers',
      (c) =>
        c.id !== customer.id &&
        c.dealerId === customer.dealerId &&
        c.active &&
        ((body.cnic !== undefined && c.cnic === body.cnic) || c.phone === newPhone)
    );
    if (clash) {
      throw AppError.conflict(`Another customer (${clash.name}) already uses this CNIC or phone number.`);
    }
  }

  const updates: Partial<Customer> = { ...body };
  if (body.phone) updates.phone = normalizePhone(body.phone);
  if (body.emergencyContactPhone) updates.emergencyContactPhone = normalizePhone(body.emergencyContactPhone);

  const updated = db.update<Customer>('customers', customer.id, updates);
  if (!updated) throw AppError.notFound('Customer');

  AuditService.log({
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
});

/**
 * Deactivation, never deletion — payments, installments and audit entries all
 * reference the customer id. Blocked while money is still owed.
 */
customersRouter.delete('/:id', requireDealerAdmin, (req, res) => {
  const user = getAuthUser(req);
  const customer = db.findById<Customer>('customers', routeParam(req, 'id'));
  if (!customer) throw AppError.notFound('Customer');
  assertDealerAccess(req, customer.dealerId, 'customer');

  const openPlans = db.find<InstallmentPlan>(
    'installmentPlans',
    (p) => p.customerId === customer.id && p.status !== 'COMPLETED' && p.status !== 'CANCELLED'
  );
  if (openPlans.length > 0) {
    const owed = openPlans.reduce((s, p) => s + (p.remainingBalance || 0), 0);
    throw AppError.badRequest(
      `This customer still has ${openPlans.length} active financing plan(s) with Rs. ${owed.toLocaleString()} outstanding. ` +
        'Close or settle the plans before deactivating the customer.'
    );
  }

  db.update<Customer>('customers', customer.id, { active: false });

  AuditService.log({
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
});
