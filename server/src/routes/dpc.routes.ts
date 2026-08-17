import { Router } from 'express';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import { deviceManagementService } from '../services/DeviceManagementService.js';
import { AuditService } from '../services/AuditService.js';
import { amountOutstanding, DEFAULT_POLICY } from '../services/InstallmentMath.js';
import { requireDevice, getDevice } from '../middleware/deviceAuth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { clientIp } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { Device, DevicePolicy } from '../types/index.js';

/**
 * The API the Device Policy Controller on the customer's phone talks to.
 *
 * This is not the dashboard API with a different prefix. It differs in three
 * ways that matter:
 *
 *  1. **Its own authentication.** A handset has no user session and must never
 *     hold a staff token. It presents `Authorization: Device <id>.<token>`,
 *     issued at enrollment and revocable on its own.
 *  2. **It answers to the device, not about it.** Responses carry only what the
 *     phone needs to enforce policy — never dealership data, other customers,
 *     or the raw IMEI it already knows.
 *  3. **The device is the source of truth for its own state.** A lock is not
 *     `LOCKED` because the dashboard said so; it is `LOCKED` when the handset
 *     acknowledges that it applied the restriction.
 */
export const dpcRouter = Router();

/** What the phone is told about its own lock state. */
interface DevicePolicyView {
  locked: boolean;
  lockMessage: string | null;
  emergencyCallsAllowed: boolean;
  paymentMethods: string[];
  /** Figures for the lock screen. Real ones — a fabricated amount here would be indefensible. */
  amountDue: number;
  nextDueDate: string | null;
  contact: { dealerName: string; dealerPhone: string } | null;
}

async function buildPolicyView(device: Device): Promise<DevicePolicyView> {
  const [dealer, dealerPolicy, plan] = await Promise.all([
    repo.dealers.findById(device.dealerId),
    repo.devicePolicies.findByDealer(device.dealerId),
    repo.installmentPlans.findByDevice(device.id),
  ]);

  const policy = dealerPolicy ?? ({ ...DEFAULT_POLICY, dealerId: device.dealerId } as DevicePolicy);
  const installments = plan ? await repo.installments.findByPlan(plan.id) : [];
  const unpaid = installments.filter((i) => i.status !== 'PAID');
  const overdue = installments.filter((i) => i.status === 'OVERDUE');

  return {
    locked: device.status === 'LOCKED',
    lockMessage: device.status === 'LOCKED' ? device.lockMessage ?? device.lockReason ?? null : null,
    emergencyCallsAllowed: policy.emergencyCallsAllowed !== false,
    paymentMethods: policy.paymentMethodsOnLock ?? ['CASH'],
    amountDue: overdue.reduce((sum, i) => sum + amountOutstanding(i), 0),
    nextDueDate: unpaid[0]?.dueDate ?? null,
    contact: dealer ? { dealerName: dealer.name, dealerPhone: dealer.phone } : null,
  };
}

// ---------------------------------------------------------------------------
// ENROLL — the only unauthenticated route here. The enrollment token IS the
// credential, which is why it is single-use, short-lived and device-bound.
// ---------------------------------------------------------------------------

const enrollSchema = z.object({
  token: z.string().trim().min(8, 'Enrollment code is required.').max(120),
  /** Only needed for a token issued without a device attached. */
  deviceId: z.string().trim().max(64).optional(),
  dpcVersion: z.string().trim().max(20).optional(),
});

dpcRouter.post(
  '/enroll',
  validateBody(enrollSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof enrollSchema>;

    const result = await EnrollmentService.verifyAndEnroll({
      token: body.token,
      deviceId: body.deviceId,
      dpcVersion: body.dpcVersion,
      ipAddress: clientIp(req),
    });

    // The only time the token is ever transmitted. From here the handset holds
    // it and the server keeps nothing but its hash.
    res.status(201).json({
      deviceId: result.device.id,
      deviceToken: result.deviceToken,
      checkInIntervalSeconds: 900,
      policy: await buildPolicyView(result.device),
    });
  })
);

// ---------------------------------------------------------------------------
// CHECK-IN — the heartbeat. Reports telemetry, collects any waiting command.
// ---------------------------------------------------------------------------

const checkInSchema = z.object({
  batteryLevel: z.number().int().min(0).max(100).optional(),
  osVersion: z.string().trim().max(40).optional(),
  securityPatch: z.string().trim().max(20).optional(),
  simCarrier: z.string().trim().max(40).optional(),
  wifiSsid: z.string().trim().max(60).optional(),
  dpcVersion: z.string().trim().max(20).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});

dpcRouter.post(
  '/check-in',
  requireDevice,
  validateBody(checkInSchema),
  asyncHandler(async (req, res) => {
    const device = getDevice(req);
    const body = req.body as z.infer<typeof checkInSchema>;
    const nowIso = new Date().toISOString();

    const updated = await repo.devices.update(device.id, {
      isOnline: true,
      lastSeen: nowIso,
      lastCheckInAt: nowIso,
      batteryLevel: body.batteryLevel ?? device.batteryLevel,
      osVersion: body.osVersion ?? device.osVersion,
      securityPatch: body.securityPatch ?? device.securityPatch,
      simCarrier: body.simCarrier ?? device.simCarrier,
      wifiSsid: body.wifiSsid ?? device.wifiSsid,
      dpcVersion: body.dpcVersion ?? device.dpcVersion,
      locationLat: body.location?.lat ?? device.locationLat,
      locationLng: body.location?.lng ?? device.locationLng,
      updatedAt: nowIso,
    });

    /**
     * The waiting command is reported, not applied.
     *
     * The device moves to LOCKED only once it acknowledges below. Applying it
     * here would let the dashboard show a lock that never reached the handset —
     * exactly the dishonesty LOCK_PENDING exists to prevent.
     */
    const command = updated?.pendingCommand
      ? { type: updated.pendingCommand, issuedAt: updated.pendingCommandAt ?? null }
      : null;

    res.json({
      status: updated?.status ?? device.status,
      command,
      checkInIntervalSeconds: 900,
      policy: await buildPolicyView(updated ?? device),
    });
  })
);

// ---------------------------------------------------------------------------
// ACKNOWLEDGE — the handset confirms it applied the command.
// ---------------------------------------------------------------------------

const ackSchema = z.object({
  command: z.enum(['LOCK', 'UNLOCK']),
  applied: z.boolean(),
  /** Why it could not be applied, when `applied` is false. */
  error: z.string().trim().max(300).optional(),
});

dpcRouter.post(
  '/commands/ack',
  requireDevice,
  validateBody(ackSchema),
  asyncHandler(async (req, res) => {
    const device = getDevice(req);
    const body = req.body as z.infer<typeof ackSchema>;

    if (!device.pendingCommand) {
      throw AppError.conflict('There is no command waiting for this device.');
    }

    if (device.pendingCommand !== body.command) {
      throw AppError.conflict(`The waiting command is ${device.pendingCommand}, not ${body.command}.`);
    }

    // A failure leaves the command queued so the next check-in retries it, and
    // records why on the device's own timeline for support to read.
    if (!body.applied) {
      await deviceManagementService.recordAction({
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: 'system',
        userName: 'Device DPC Client',
        action: 'STATUS_CHANGE',
        reason: `Device reported it could not apply the queued ${body.command}: ${body.error ?? 'no reason given'}`,
        deviceAck: false,
        ipAddress: clientIp(req),
      });

      res.json({
        status: device.status,
        commandCleared: false,
        message: 'Failure recorded. The command stays queued and will be retried.',
      });
      return;
    }

    const result = await deviceManagementService.acknowledgeCommand(device.id);

    await AuditService.log({
      dealerId: device.dealerId,
      userId: 'system',
      actorName: 'Device DPC Client',
      actorRole: 'DEALER_ADMIN',
      action: body.command === 'LOCK' ? 'DEVICE_LOCKED' : 'DEVICE_UNLOCKED',
      targetType: 'DEVICE',
      targetId: device.id,
      details: `${device.brand} ${device.model} confirmed it applied the queued ${body.command}.`,
      ipAddress: clientIp(req),
    });

    res.json({ status: result.status, commandCleared: result.applied, message: result.message });
  })
);

// ---------------------------------------------------------------------------
// POLICY — what to show, for a handset that restarted and needs to re-render
// its lock screen without waiting for the next heartbeat.
// ---------------------------------------------------------------------------

dpcRouter.get(
  '/policy',
  requireDevice,
  asyncHandler(async (req, res) => {
    const device = getDevice(req);
    res.json({ status: device.status, policy: await buildPolicyView(device) });
  })
);
