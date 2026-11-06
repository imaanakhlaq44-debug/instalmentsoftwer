import { repo } from '../db/repositories/index.js';
import { Device, DevicePolicy, UserRole } from '../types/index.js';
import { ContractService } from './ContractService.js';
import { ContractSnapshot, termsDiscloseLocation } from './contractTerms.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { DEFAULT_POLICY } from './InstallmentMath.js';
import { AppError } from '../utils/AppError.js';

/**
 * Location, for recovering a phone. Nothing else.
 *
 * The rules, all enforced here rather than on the handset or the dashboard:
 *
 *   1. The shop has turned it on, and the customer's signed agreement (terms
 *      v1.3 or later, signed while it was on) says so.
 *   2. The phone is restricted, or an installment is overdue. A customer who
 *      is up to date is never located.
 *   3. A shop owner asks, with a reason. The phone is told to report while the
 *      request is open (24 hours) and reports once; the request then closes.
 *   4. Every request, every fix and every view is written to the audit trail.
 *   5. Coordinates are never part of an ordinary device response. They are
 *      fetched on purpose, by an owner, and that fetch is logged.
 *   6. A released phone loses its stored location with everything else.
 */

export const REQUEST_OPEN_HOURS = 24;

const RECOVERY_STATUSES = new Set(['LOCKED', 'LOCK_PENDING', 'OVERDUE']);

export interface LocationActor {
  userId: string;
  userName: string;
  userRole: UserRole;
  ipAddress?: string;
}

export interface Eligibility {
  allowed: boolean;
  /** Why not, in words a shop owner can act on. */
  reason?: string;
}

function signedLocation(snapshotJson: string): boolean {
  try {
    return (JSON.parse(snapshotJson) as ContractSnapshot).locationOnRecovery?.enabled === true;
  } catch {
    return false;
  }
}

export class LocationService {
  static async eligibility(device: Device, policy?: DevicePolicy): Promise<Eligibility> {
    if (device.noLock) return { allowed: false, reason: 'This phone was sold without a lock, so it has no location.' };
    if (device.status === 'INACTIVE' || device.status === 'REMOVED') {
      return { allowed: false, reason: 'This phone has been released.' };
    }
    if (device.status === 'PENDING' || !device.authTokenHash) {
      return { allowed: false, reason: 'This phone has not been connected yet.' };
    }

    const p = policy ?? (await repo.devicePolicies.findByDealer(device.dealerId)) ?? ({ ...DEFAULT_POLICY } as DevicePolicy);
    if (p.locationOnRecoveryEnabled !== true) {
      return { allowed: false, reason: 'Location for recovery is off. Turn it on in Settings.' };
    }

    const consent = await ContractService.consentForDevice(device.id);
    if (!consent.allowed || !consent.contract) {
      return { allowed: false, reason: 'The customer has not signed a valid agreement for this phone.' };
    }
    if (!termsDiscloseLocation(consent.contract.termsVersion) || !signedLocation(consent.contract.snapshot)) {
      return {
        allowed: false,
        reason: 'This customer signed an agreement that does not allow location. A new agreement must be signed.',
      };
    }

    if (!(await this.inRecovery(device))) {
      return { allowed: false, reason: 'Only a locked or overdue phone can be located. This customer is up to date.' };
    }

    return { allowed: true };
  }

  /** Restricted, self-locked, or an installment overdue past its grace period. */
  static async inRecovery(device: Device): Promise<boolean> {
    if (RECOVERY_STATUSES.has(device.status) || device.offlineLockActive) return true;
    const plan = await repo.installmentPlans.findByDevice(device.id);
    if (!plan) return false;
    const installments = await repo.installments.findByPlan(plan.id);
    return installments.some((i) => i.status === 'OVERDUE');
  }

  static requestOpen(device: Device, now = Date.now()): boolean {
    if (!device.locationRequestedAt) return false;
    return now - new Date(device.locationRequestedAt).getTime() < REQUEST_OPEN_HOURS * 3_600_000;
  }

  /** What the handset is told. Re-checked on every check-in: paying up closes the request. */
  static async shouldReport(device: Device, policy?: DevicePolicy): Promise<boolean> {
    if (!this.requestOpen(device)) return false;
    return (await this.eligibility(device, policy)).allowed;
  }

  static async request(device: Device, actor: LocationActor, reason: string): Promise<Device> {
    const eligible = await this.eligibility(device);
    if (!eligible.allowed) throw AppError.badRequest(eligible.reason ?? 'Location cannot be asked for this phone.');

    const nowIso = new Date().toISOString();
    const updated = await repo.devices.update(device.id, {
      locationRequestedAt: nowIso,
      locationRequestedBy: actor.userName,
      updatedAt: nowIso,
    });
    if (!updated) throw AppError.notFound('Device');

    await deviceManagementService.recordAction({
      deviceId: device.id,
      dealerId: device.dealerId,
      userId: actor.userId,
      userName: actor.userName,
      action: 'STATUS_CHANGE',
      reason: `Location requested by ${actor.userName} to recover the phone. Reason: ${reason}`,
      ipAddress: actor.ipAddress,
    });
    await AuditService.log({
      dealerId: device.dealerId,
      userId: actor.userId,
      actorName: actor.userName,
      actorRole: actor.userRole,
      action: 'LOCATION_REQUESTED',
      targetType: 'DEVICE',
      targetId: device.id,
      details: `${actor.userName} asked ${device.brand} ${device.model} for its location. Reason: ${reason}`,
      ipAddress: actor.ipAddress,
    });
    return updated;
  }

  /**
   * A fix sent by the handset. Kept only if a request is open and still
   * allowed; anything else is dropped without being stored.
   */
  static async acceptReport(
    device: Device,
    fix: { lat: number; lng: number; accuracy?: number; capturedAt?: string }
  ): Promise<boolean> {
    if (!(await this.shouldReport(device))) return false;

    const nowIso = new Date().toISOString();
    await repo.devices.update(device.id, {
      locationLat: fix.lat,
      locationLng: fix.lng,
      locationAccuracy: fix.accuracy,
      locationAt: fix.capturedAt ?? nowIso,
      // Answered: the phone stops reporting until somebody asks again.
      locationRequestedAt: undefined,
      locationRequestedBy: undefined,
      updatedAt: nowIso,
    });

    await deviceManagementService.recordAction({
      deviceId: device.id,
      dealerId: device.dealerId,
      userId: 'system',
      userName: 'Device DPC Client',
      action: 'STATUS_CHANGE',
      reason: 'The phone reported its location in answer to the shop\'s request, and showed the customer a notice.',
      deviceAck: true,
    });
    return true;
  }

  /** The coordinates, for an owner, logged every time they are looked at. */
  static async view(device: Device, actor: LocationActor) {
    const eligible = await this.eligibility(device);
    const view = {
      eligible: eligible.allowed,
      reason: eligible.reason ?? null,
      requestOpen: this.requestOpen(device),
      requestedAt: device.locationRequestedAt ?? null,
      requestedBy: device.locationRequestedBy ?? null,
      location:
        device.locationLat != null && device.locationLng != null
          ? {
              lat: device.locationLat,
              lng: device.locationLng,
              accuracy: device.locationAccuracy ?? null,
              at: device.locationAt ?? null,
            }
          : null,
    };

    if (view.location) {
      await AuditService.log({
        dealerId: device.dealerId,
        userId: actor.userId,
        actorName: actor.userName,
        actorRole: actor.userRole,
        action: 'LOCATION_VIEWED',
        targetType: 'DEVICE',
        targetId: device.id,
        details: `${actor.userName} viewed the location of ${device.brand} ${device.model}.`,
        ipAddress: actor.ipAddress,
      });
    }
    return view;
  }
}
