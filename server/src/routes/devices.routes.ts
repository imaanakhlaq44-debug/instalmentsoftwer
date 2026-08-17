import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/db.js';
import { Device, Customer, InstallmentPlan, Installment, DeviceActionLog } from '../types/index.js';
import { deviceManagementService } from '../services/DeviceManagementService.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerAdmin,
  requireDealerStaff,
  getAuthUser,
  resolveDealerScope,
  assertDealerAccess,
  clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { sanitizeDevice, sanitizeCustomer, maskImei } from '../utils/mask.js';
import { paginationSchema, paginate } from '../utils/validators.js';

export const devicesRouter = Router();

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  brand: z.string().trim().max(40).optional(),
  customerId: z.string().trim().max(64).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

/**
 * Device directory.
 *
 * Scoping rules applied here:
 *  - dealer users only ever see their own dealership's devices (JWT-derived);
 *  - a CUSTOMER only ever sees devices linked to their own customer record;
 *  - raw IMEI and serial number are stripped for roles below dealer admin.
 */
devicesRouter.get(
  '/',
  validateQuery(listQuerySchema),
  (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    let devices = db.find<Device>('devices', (d) => {
      if (scope !== null && d.dealerId !== scope) return false;
      if (user.role === 'CUSTOMER' && d.customerId !== user.customerId) return false;
      if (q.status && q.status !== 'ALL' && d.status !== q.status) return false;
      if (q.brand && q.brand !== 'ALL' && d.brand.toLowerCase() !== q.brand.toLowerCase()) return false;
      if (q.customerId && d.customerId !== q.customerId) return false;
      return true;
    });

    // Join once up front instead of a findById per row (the original was O(n*m)).
    const customersById = db.indexBy<Customer>('customers', (c) => c.id);
    const plansByDevice = db.indexBy<InstallmentPlan>('installmentPlans', (p) => p.deviceId);
    const installmentsByPlan = db.groupBy<Installment>('installments', (i) => i.planId);

    if (q.search) {
      const needle = q.search.toLowerCase();
      devices = devices.filter((d) => {
        const customer = customersById.get(d.customerId);
        return (
          d.brand.toLowerCase().includes(needle) ||
          d.model.toLowerCase().includes(needle) ||
          d.imei.includes(needle) ||
          (customer?.name.toLowerCase().includes(needle) ?? false) ||
          (customer?.phone.includes(needle) ?? false)
        );
      });
    }

    devices.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const page = paginate(devices, { page: q.page, limit: q.limit });

    const enriched = page.data.map((d) => {
      const customer = customersById.get(d.customerId);
      const plan = plansByDevice.get(d.id);
      const planInstallments = plan ? installmentsByPlan.get(plan.id) ?? [] : [];
      const nextInstallment = planInstallments
        .filter((i) => i.status !== 'PAID')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

      return {
        ...sanitizeDevice(d, user.role),
        customerName: customer?.name ?? 'Unknown',
        customerPhone: customer?.phone ?? 'N/A',
        monthlyAmount: plan?.monthlyInstallment ?? 0,
        remainingBalance: plan?.remainingBalance ?? 0,
        nextDueDate: nextInstallment?.dueDate ?? null,
        installmentStatus: nextInstallment?.status ?? 'PAID',
        overdueCount: planInstallments.filter((i) => i.status === 'OVERDUE').length,
      };
    });

    res.json({ ...page, data: enriched });
  }
);

/** Device 360 profile. */
devicesRouter.get('/:id', (req, res) => {
  const user = getAuthUser(req);
  const device = db.findById<Device>('devices', routeParam(req, 'id'));
  if (!device) throw AppError.notFound('Device');

  assertDealerAccess(req, device.dealerId, 'device');
  if (user.role === 'CUSTOMER' && device.customerId !== user.customerId) {
    throw AppError.notFound('Device');
  }

  const customer = db.findById<Customer>('customers', device.customerId);
  const plan = db.findOne<InstallmentPlan>('installmentPlans', (p) => p.deviceId === device.id);
  const installments = plan
    ? db
        .find<Installment>('installments', (i) => i.planId === plan.id)
        .sort((a, b) => a.installmentNumber - b.installmentNumber)
    : [];

  // Customers do not need — and must not receive — the internal enforcement log.
  const actionLogs =
    user.role === 'CUSTOMER'
      ? []
      : db
          .find<DeviceActionLog>('deviceActionLogs', (l) => l.deviceId === device.id)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 100);

  res.json({
    ...sanitizeDevice(device, user.role),
    customer: customer ? sanitizeCustomer(customer, user.role, user.customerId) : null,
    plan: plan ?? null,
    installments,
    actionLogs,
  });
});

// ---------------------------------------------------------------------------
// Enforcement actions — dealer admin only. Locking someone's phone is not a
// counter-staff decision, and a customer must never be able to call these.
// ---------------------------------------------------------------------------

const lockSchema = z.object({
  reason: z.string().trim().min(5, 'Please give a reason of at least 5 characters.').max(500),
  lockMessage: z.string().trim().max(300).optional(),
});

devicesRouter.post(
  '/:id/lock',
  requireDealerAdmin,
  validateBody(lockSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const body = req.body as z.infer<typeof lockSchema>;

    const result = await deviceManagementService.lockDevice({
      deviceId: device.id,
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      reason: body.reason,
      lockMessage: body.lockMessage,
      ipAddress: clientIp(req),
    });

    res.json(result);
  })
);

const unlockSchema = z.object({
  reason: z.string().trim().min(5, 'Please give a reason of at least 5 characters.').max(500),
});

devicesRouter.post(
  '/:id/unlock',
  requireDealerAdmin,
  validateBody(unlockSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const result = await deviceManagementService.unlockDevice({
      deviceId: device.id,
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      reason: (req.body as z.infer<typeof unlockSchema>).reason,
      ipAddress: clientIp(req),
    });

    res.json(result);
  })
);

const messageSchema = z.object({
  title: z.string().trim().min(2).max(80),
  message: z.string().trim().min(2).max(400),
});

devicesRouter.post(
  '/:id/message',
  requireDealerStaff,
  validateBody(messageSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const body = req.body as z.infer<typeof messageSchema>;
    const result = await deviceManagementService.sendNotification({
      deviceId: device.id,
      title: body.title,
      message: body.message,
      userId: user.userId,
      userName: user.name,
      ipAddress: clientIp(req),
    });

    res.json(result);
  })
);

devicesRouter.post(
  '/:id/reboot',
  requireDealerAdmin,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const result = await deviceManagementService.rebootDevice({
      deviceId: device.id,
      userId: user.userId,
      userName: user.name,
      ipAddress: clientIp(req),
    });

    res.json(result);
  })
);

/** Correct a mistyped device record. Previously there was no way to fix one. */
const updateDeviceSchema = z.object({
  brand: z.string().trim().min(1).max(40).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().min(1).max(30).optional(),
  ramStorage: z.string().trim().min(1).max(40).optional(),
  serialNumber: z.string().trim().min(1).max(64).optional(),
  simCarrier: z.string().trim().max(40).optional(),
});

devicesRouter.patch(
  '/:id',
  requireDealerAdmin,
  validateBody(updateDeviceSchema),
  (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const updates = req.body as z.infer<typeof updateDeviceSchema>;
    if (Object.keys(updates).length === 0) {
      throw AppError.badRequest('No changes were supplied.');
    }

    const updated = db.update<Device>('devices', device.id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) throw AppError.notFound('Device');

    deviceManagementService.recordAction({
      deviceId: device.id,
      dealerId: device.dealerId,
      userId: user.userId,
      userName: user.name,
      action: 'STATUS_CHANGE',
      reason: `Device record edited (${Object.keys(updates).join(', ')}) by ${user.name}.`,
      ipAddress: clientIp(req),
    });

    AuditService.log({
      dealerId: device.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'DEVICE_UPDATED',
      targetType: 'DEVICE',
      targetId: device.id,
      details: `${user.name} updated ${device.brand} ${device.model}: ${Object.keys(updates).join(', ')}.`,
      ipAddress: clientIp(req),
    });

    res.json(sanitizeDevice(updated, user.role));
  }
);

/**
 * IMEI is the device's identity — changing it silently would break every future
 * command, so it gets its own endpoint with an explicit reason and a hard audit
 * entry. Super admin only.
 */
const correctImeiSchema = z.object({
  imei: z.string().trim().regex(/^\d{15}$/, 'IMEI must be exactly 15 digits.'),
  reason: z.string().trim().min(10, 'Please explain why the IMEI is being corrected.').max(500),
});

devicesRouter.post(
  '/:id/correct-imei',
  requireDealerAdmin,
  validateBody(correctImeiSchema),
  (req, res) => {
    const user = getAuthUser(req);
    const device = db.findById<Device>('devices', routeParam(req, 'id'));
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const body = req.body as z.infer<typeof correctImeiSchema>;

    if (db.findOne<Device>('devices', (d) => d.imei === body.imei && d.id !== device.id)) {
      throw AppError.conflict('Another device is already registered with this IMEI.');
    }

    const previous = device.imei;
    const updated = db.update<Device>('devices', device.id, {
      imei: body.imei,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) throw AppError.notFound('Device');

    deviceManagementService.recordAction({
      deviceId: device.id,
      dealerId: device.dealerId,
      userId: user.userId,
      userName: user.name,
      action: 'STATUS_CHANGE',
      reason: `IMEI corrected from ${maskImei(previous)} to ${maskImei(body.imei)}. Reason: ${body.reason}`,
      ipAddress: clientIp(req),
    });

    // Changing a device's identity is a dealership-level event, not just a
    // device-timeline note — it belongs in the global audit trail too.
    AuditService.log({
      dealerId: device.dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'DEVICE_IMEI_CORRECTED',
      targetType: 'DEVICE',
      targetId: device.id,
      details:
        `IMEI for ${device.brand} ${device.model} corrected from ${maskImei(previous)} ` +
        `to ${maskImei(body.imei)}. Reason: ${body.reason}`,
      ipAddress: clientIp(req),
    });

    res.json(sanitizeDevice(updated, user.role));
  }
);

devicesRouter.get('/:id/actions', requireDealerStaff, (req, res) => {
  const device = db.findById<Device>('devices', routeParam(req, 'id'));
  if (!device) throw AppError.notFound('Device');
  assertDealerAccess(req, device.dealerId, 'device');

  const logs = db
    .find<DeviceActionLog>('deviceActionLogs', (l) => l.deviceId === device.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(logs);
});
