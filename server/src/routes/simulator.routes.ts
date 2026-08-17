import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy, groupBy, dealerScope } from '../db/repositories/index.js';
import { Customer, InstallmentPlan, Installment, Dealer, DevicePolicy } from '../types/index.js';
import { deviceManagementService } from '../services/DeviceManagementService.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import { amountOutstanding, DEFAULT_POLICY } from '../services/InstallmentMath.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, assertDealerAccess, clientIp,
} from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { sanitizeDevice } from '../utils/mask.js';

export const simulatorRouter = Router();

// The simulator can lock and unlock real records — it is a staff tool.
simulatorRouter.use(requireDealerStaff);

/** Virtual phones the simulator can drive, scoped to the caller's dealership. */
simulatorRouter.get('/devices', asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);

  const devices = await repo.devices.findMany({
    where: dealerScope(scope),
    orderBy: { updatedAt: 'desc' },
  });

  if (devices.length === 0) {
    res.json([]);
    return;
  }

  // Each related table is fetched once, for the ids these devices actually
  // reference, and joined in memory afterwards.
  const dealerIds = [...new Set(devices.map((d) => d.dealerId))];
  const [customerRows, dealerRows, policyRows, plans] = await Promise.all([
    repo.customers.findByIds([...new Set(devices.map((d) => d.customerId))]),
    repo.dealers.findByIds(dealerIds),
    repo.devicePolicies.findByDealers(dealerIds),
    repo.installmentPlans.findByDevices(devices.map((d) => d.id)),
  ]);

  const customersById = indexBy<Customer>(customerRows, (c) => c.id);
  const dealersById = indexBy<Dealer>(dealerRows, (d) => d.id);
  const policiesByDealer = indexBy<DevicePolicy>(policyRows, (p) => p.dealerId);
  const plansByDevice = indexBy<InstallmentPlan>(plans, (p) => p.deviceId);
  const installmentsByPlan = groupBy<Installment>(
    await repo.installments.findByPlans(plans.map((p) => p.id)),
    (i) => i.planId
  );

  const simulated = devices.map((d) => {
    const customer = customersById.get(d.customerId);
    const dealer = dealersById.get(d.dealerId);
    const plan = plansByDevice.get(d.id);
    const rows = plan ? installmentsByPlan.get(plan.id) ?? [] : [];
    const policy = policiesByDealer.get(d.dealerId) ?? ({ ...DEFAULT_POLICY, dealerId: d.dealerId } as DevicePolicy);

    const overdueRows = rows.filter((i) => i.status === 'OVERDUE');
    const nextDue = rows.filter((i) => i.status !== 'PAID').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

    return {
      ...sanitizeDevice(d, user.role),
      customerName: customer?.name ?? 'Unknown Customer',
      customerPhone: customer?.phone ?? 'N/A',
      dealerName: dealer?.name ?? 'EMI Shield Dealer',
      dealerPhone: dealer?.phone ?? 'N/A',

      // These drive the lock screen. They must be the real figures — showing a
      // fabricated fallback amount on a lock screen would be indefensible.
      overdueAmount: overdueRows.reduce((s, i) => s + amountOutstanding(i), 0),
      nextDueDate: nextDue?.dueDate ?? null,
      nextDueAmount: nextDue ? amountOutstanding(nextDue) : 0,
      totalRemainingBalance: plan?.remainingBalance ?? 0,
      monthlyInstallment: plan?.monthlyInstallment ?? 0,
      hasPlan: Boolean(plan),

      emergencyCallsAllowed: policy.emergencyCallsAllowed !== false,
      paymentMethodsOnLock: policy.paymentMethodsOnLock ?? ['CASH'],
      pendingCommand: d.pendingCommand ?? null,
    };
  });

  res.json(simulated);
}));

const updateStateSchema = z.object({
  deviceId: z.string().trim().min(1, 'Device id is required.'),
  action: z.enum([
    'TOGGLE_ONLINE',
    'SET_BATTERY',
    'SIMULATE_OVERDUE',
    'FORCE_LOCK',
    'FORCE_UNLOCK',
    'SCAN_QR_TOKEN',
    'SIMULATE_REBOOT',
  ]),
  // Defaulted to an empty object so a missing payload can no longer throw a
  // TypeError inside the handler.
  payload: z
    .object({
      isOnline: z.boolean().optional(),
      batteryLevel: z.number().min(0).max(100).optional(),
      token: z.string().trim().max(120).optional(),
    })
    .default({}),
});

simulatorRouter.post(
  '/update-state',
  validateBody(updateStateSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const { deviceId, action, payload } = req.body as z.infer<typeof updateStateSchema>;

    const device = await repo.devices.findById(deviceId);
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');

    const nowIso = new Date().toISOString();
    // Each action contributes its own result shape onto the response.
    let extra: Record<string, unknown> = {};
    const merge = (value: object) => {
      extra = { ...extra, ...value };
    };

    switch (action) {
      case 'TOGGLE_ONLINE': {
        const nextOnline = payload.isOnline ?? !device.isOnline;
        await repo.devices.update(device.id, {
          isOnline: nextOnline,
          lastSeen: nowIso,
          updatedAt: nowIso,
        });

        // Coming back online is exactly when a queued lock/unlock takes effect.
        if (nextOnline && device.pendingCommand) {
          merge(await deviceManagementService.acknowledgeCommand(device.id));
        }
        break;
      }

      case 'SET_BATTERY': {
        const level = payload.batteryLevel ?? 50;
        await repo.devices.update(device.id, {
          batteryLevel: Math.round(level),
          lastSeen: nowIso,
          updatedAt: nowIso,
        });
        break;
      }

      case 'SIMULATE_OVERDUE': {
        const plan = await repo.installmentPlans.findByDevice(device.id);
        if (!plan) {
          throw AppError.badRequest('This device has no financing plan, so it cannot become overdue.');
        }

        const [nextUnpaid] = await repo.installments.findMany({
          where: { planId: plan.id, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
          take: 1,
        });

        if (!nextUnpaid) {
          throw AppError.badRequest('Every installment on this plan is already paid.');
        }

        await repo.installments.update(nextUnpaid.id, { status: 'OVERDUE' });
        await repo.installmentPlans.update(plan.id, { status: 'OVERDUE' });

        if (device.status === 'ACTIVE' || device.status === 'ENROLLED') {
          await repo.devices.update(device.id, {
            status: 'OVERDUE',
            lockReason: `Installment #${nextUnpaid.installmentNumber} marked overdue from the simulator.`,
            updatedAt: nowIso,
          });
        }
        merge({ installmentNumber: nextUnpaid.installmentNumber, amountDue: amountOutstanding(nextUnpaid) });
        break;
      }

      case 'FORCE_LOCK': {
        merge(await deviceManagementService.lockDevice({
          deviceId: device.id,
          userId: user.userId,
          userName: `${user.name} (Simulator)`,
          userRole: user.role,
          reason: 'Manual lock triggered from the device simulator.',
          ipAddress: clientIp(req),
        }));
        break;
      }

      case 'FORCE_UNLOCK': {
        merge(await deviceManagementService.unlockDevice({
          deviceId: device.id,
          userId: user.userId,
          userName: `${user.name} (Simulator)`,
          userRole: user.role,
          reason: 'Manual unlock triggered from the device simulator.',
          ipAddress: clientIp(req),
        }));
        break;
      }

      case 'SCAN_QR_TOKEN': {
        if (!payload.token) {
          throw AppError.badRequest('Please enter the enrollment code from the QR to scan it.');
        }
        const result = await EnrollmentService.verifyAndEnroll({
          token: payload.token,
          deviceId: device.id,
          ipAddress: clientIp(req),
        });
        merge({ message: result.message });
        break;
      }

      case 'SIMULATE_REBOOT': {
        merge(await deviceManagementService.rebootDevice({
          deviceId: device.id,
          userId: user.userId,
          userName: `${user.name} (Simulator)`,
          ipAddress: clientIp(req),
        }));

        // A reboot is also a check-in, so a queued command applies on restart.
        if (device.pendingCommand) {
          const applied = await deviceManagementService.acknowledgeCommand(device.id);
          merge({ pendingCommandApplied: applied });
        }
        break;
      }
    }

    const updated = await repo.devices.findById(device.id);
    if (!updated) throw AppError.notFound('Device');
    res.json({ success: true, ...extra, device: sanitizeDevice(updated, user.role) });
  })
);
