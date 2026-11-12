import { config } from '../config.js';
import { Router } from 'express';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import { offlineLockDaysFor } from '../services/OfflineLockPolicy.js';
import { RESTRICTED_APPS, restrictionLevelFor } from '../services/StagedRestrictions.js';
import { LocationService } from '../services/LocationService.js';
import { resetProtectionDisclosedFor } from '../services/DisclosurePolicy.js';
import { DeviceIntegrityService } from '../services/DeviceIntegrityService.js';
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
  /**
   * The two numbers the offline rule is made of. `offlineLockAfterDays` is 0
   * whenever the handset is not permitted to restrict itself, so a phone never
   * has to reason about consent, policy or contract versions — it is told the
   * answer or it is told zero.
   */
  offlineLockAfterDays: number;
  gracePeriodDays: number;
  /**
   * Google account ids allowed to set the phone up after a recovery-mode
   * factory reset. Sent only while something is still owed: once the plan is
   * paid off the list goes empty and the phone drops the protection, so a
   * customer who owns their handset outright is never left needing the
   * dealer's account to use it. Also empty unless the customer's signed
   * agreement (terms v1.4 or later) tells them about it.
   */
  frpAccountIds: string[];
  /**
   * Staged restrictions short of a full lock: 0 none, 1 outgoing calls and SMS
   * off, 2 also the apps in `restrictedApps` suspended. Always 0 while locked
   * (the lock covers everything) and whenever the signed contract does not
   * describe the stages.
   */
  restrictionLevel: 0 | 1 | 2;
  restrictedApps: string[];
  /**
   * The shop has asked for this phone's location to recover it, and is still
   * allowed to (signed consent, phone restricted or overdue). The phone takes
   * one fix, tells the customer, reports it, and the request closes.
   */
  reportLocation: boolean;
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

  const locked = device.status === 'LOCKED';
  const restrictionLevel = locked ? 0 : await restrictionLevelFor(device, policy, installments);

  return {
    locked,
    lockMessage: device.status === 'LOCKED' ? device.lockMessage ?? device.lockReason ?? null : null,
    emergencyCallsAllowed: policy.emergencyCallsAllowed !== false,
    paymentMethods: policy.paymentMethodsOnLock ?? ['CASH'],
    amountDue: overdue.reduce((sum, i) => sum + amountOutstanding(i), 0),
    nextDueDate: unpaid[0]?.dueDate ?? null,
    offlineLockAfterDays: await offlineLockDaysFor(device, policy),
    gracePeriodDays: policy.gracePeriodDays ?? DEFAULT_POLICY.gracePeriodDays,
    frpAccountIds:
      unpaid.length > 0 && (policy.frpAccountIds?.length ?? 0) > 0 && (await resetProtectionDisclosedFor(device))
        ? policy.frpAccountIds ?? []
        : [],
    restrictionLevel,
    restrictedApps: restrictionLevel >= 2 ? [...RESTRICTED_APPS] : [],
    reportLocation: await LocationService.shouldReport(device, policy),
    contact: dealer ? { dealerName: dealer.name, dealerPhone: dealer.phone } : null,
  };
}

// ---------------------------------------------------------------------------
// ENROLL — the only unauthenticated route here. The enrollment token IS the
// credential, which is why it is single-use, short-lived and device-bound.
// ---------------------------------------------------------------------------

const integritySchema = z
  .object({
    rooted: z.boolean().optional(),
    bootloaderUnlocked: z.boolean().optional(),
    testKeys: z.boolean().optional(),
    verifiedBootState: z.string().trim().max(32).optional(),
    flashLocked: z.string().trim().max(16).optional(),
  })
  .optional();

const imeiArraySchema = z
  .array(z.string().trim().regex(/^\d{14,16}$/))
  .max(4)
  .optional();

/**
 * A hardware key attestation chain: base64 DER certificates, leaf first. Real
 * chains are 3–5 certificates of about 1 KB each.
 */
const attestationSchema = z
  .object({
    chain: z.array(z.string().trim().max(16_384).regex(/^[A-Za-z0-9+/=]*$/)).max(8).optional(),
    idsAttested: z.boolean().optional(),
    error: z.string().trim().max(300).optional(),
  })
  .optional();

const frpSchema = z
  .object({
    status: z.enum(['ACTIVE', 'LEGACY', 'REFUSED', 'NOT_CONFIGURED']),
    detail: z.string().trim().max(300).optional(),
    verifiedAccountsCount: z.number().int().min(0).max(10).optional(),
  })
  .optional();

const enrollSchema = z.object({
  token: z.string().trim().min(8, 'Enrollment code is required.').max(120),
  /** Only needed for a token issued without a device attached. */
  deviceId: z.string().trim().max(64).optional(),
  dpcVersion: z.string().trim().max(20).optional(),
  imeis: imeiArraySchema,
  serialNumber: z.string().trim().max(64).optional(),
  isDeviceOwner: z.boolean().optional(),
  integrity: integritySchema,
  attestation: attestationSchema,
  frp: frpSchema,
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
      telemetry: {
        imeis: body.imeis,
        serialNumber: body.serialNumber,
        isDeviceOwner: body.isDeviceOwner,
        integrity: body.integrity,
        attestation: body.attestation,
        frp: body.frp,
      },
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
  imeis: imeiArraySchema,
  serialNumber: z.string().trim().max(64).optional(),
  isDeviceOwner: z.boolean().optional(),
  integrity: integritySchema,
  attestation: attestationSchema,
  frp: frpSchema,
  /**
   * The handset reporting that it restricted itself under the offline rule
   * while it could not reach anybody. It is a report of something already done,
   * not a request — the phone was the only party present when it happened.
   */
  offlineLockActive: z.boolean().optional(),
  offlineLockSince: z.string().datetime().optional(),
  /** Sent only in answer to `reportLocation`, and kept only if the request is still open. */
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().min(0).max(100_000).optional(),
      capturedAt: z.string().datetime().optional(),
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
    const ip = clientIp(req);

    const offlineLockActive = body.offlineLockActive === true;
    const wasOfflineLocked = device.offlineLockActive === true;

    const updated = await repo.devices.update(device.id, {
      isOnline: true,
      lastSeen: nowIso,
      lastCheckInAt: nowIso,
      offlineLockActive,
      // Preserve the moment the phone says it started, not the moment the news
      // arrived — the gap between them is the whole point of the rule.
      offlineLockSince: offlineLockActive
        ? body.offlineLockSince ?? device.offlineLockSince ?? nowIso
        : undefined,
      batteryLevel: body.batteryLevel ?? device.batteryLevel,
      osVersion: body.osVersion ?? device.osVersion,
      securityPatch: body.securityPatch ?? device.securityPatch,
      simCarrier: body.simCarrier ?? device.simCarrier,
      wifiSsid: body.wifiSsid ?? device.wifiSsid,
      dpcVersion: body.dpcVersion ?? device.dpcVersion,
      updatedAt: nowIso,
    });

    const afterIntegrity = await DeviceIntegrityService.processCheckInTelemetry(
      updated ?? device,
      {
        imeis: body.imeis,
        serialNumber: body.serialNumber,
        isDeviceOwner: body.isDeviceOwner,
        integrity: body.integrity,
        attestation: body.attestation,
        frp: body.frp,
      },
      nowIso,
      ip
    );

    // A location is stored only in answer to an open, still-permitted request.
    const located = body.location ? await LocationService.acceptReport(afterIntegrity.device, body.location) : false;

    /**
     * A self-lock is written to the device's timeline the moment the shop first
     * hears of it, and again when it ends. Neither is a status change: the
     * handset restricted itself, nobody issued a command, and folding that into
     * LOCKED would make the dashboard claim an authority it did not exercise.
     */
    if (offlineLockActive !== wasOfflineLocked) {
      const since = offlineLockActive ? body.offlineLockSince ?? device.offlineLockSince : undefined;
      await deviceManagementService.recordAction({
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: 'system',
        userName: 'Device DPC Client',
        action: 'STATUS_CHANGE',
        reason: offlineLockActive
          ? 'The handset restricted itself under the offline rule: it could not reach this server for ' +
            `longer than the dealer's limit${since ? `, since ${since}` : ''}.`
          : 'The handset lifted the restriction it had applied under the offline rule, having reached ' +
            'this server again.',
        deviceAck: true,
        ipAddress: ip,
      });
    }

    /**
     * The waiting command is reported, not applied.
     *
     * The device moves to LOCKED only once it acknowledges below. Applying it
     * here would let the dashboard show a lock that never reached the handset —
     * exactly the dishonesty LOCK_PENDING exists to prevent.
     */
    const current = (located ? await repo.devices.findById(device.id) : afterIntegrity.device) ?? afterIntegrity.device;
    const command = current.pendingCommand
      ? { type: current.pendingCommand, issuedAt: current.pendingCommandAt ?? null }
      : null;

    // Once a day the handset is asked to prove, with its secure chip, which
    // phone it is. It answers on its next check-in.
    const attestationChallenge = await DeviceIntegrityService.attestationChallengeFor(current);

    res.json({
      status: current.status,
      command,
      checkInIntervalSeconds: 900,
      policy: await buildPolicyView(current),
      ...(attestationChallenge ? { attestationChallenge } : {}),
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
// APK — a short, stable download link for the provisioning QR. The long
// release URL made the QR too dense for older phones to scan off a screen.
// ---------------------------------------------------------------------------

dpcRouter.get('/apk', (_req, res) => {
  if (!config.dpc.apkUrl) {
    res.status(404).json({ error: 'No app download is configured on this server.' });
    return;
  }
  res.redirect(302, config.dpc.apkUrl);
});

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
