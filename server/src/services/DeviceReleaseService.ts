import { repo } from '../db/repositories/index.js';
import { Tx } from '../db/prisma.js';
import { Device, UserRole } from '../types/index.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';

export interface ReleaseActor {
  userId: string;
  userName: string;
  userRole: UserRole;
  ipAddress?: string;
}

/**
 * Hands a phone back to its owner.
 *
 * The record moves to INACTIVE. From then on the phone's next check-in is
 * answered "no longer under management" (see requireDevice), and the app on
 * the handset unwinds everything it set: the lock, staged restrictions, the
 * reset and safe-mode blocks, Factory Reset Protection and, from app 1.2, its
 * own device-owner status, so the customer can remove it.
 *
 * Nothing is sent to the phone from here: a released phone may be off or out
 * of credit for days, and the answer is waiting for it whenever it next asks.
 */
export class DeviceReleaseService {
  /** Statuses that can be released. PENDING is included: a sale paid off before the QR was ever scanned. */
  static readonly RELEASABLE = new Set([
    'PENDING', 'ENROLLED', 'ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING',
  ]);

  static async release(
    device: Device,
    params: { actor: ReleaseActor; reason: string; automatic: boolean },
    tx?: Tx
  ): Promise<Device> {
    if (device.status === 'INACTIVE') return device;
    if (!this.RELEASABLE.has(device.status)) {
      throw AppError.badRequest(`A ${device.status.toLowerCase()} device cannot be released.`);
    }

    const updated = await repo.devices.update(
      device.id,
      {
        status: 'INACTIVE',
        // A key set to undefined is cleared (see toUpdate).
        pendingCommand: undefined,
        pendingCommandAt: undefined,
        lockReason: undefined,
        lockMessage: undefined,
        offlineLockActive: false,
        offlineLockSince: undefined,
        updatedAt: new Date().toISOString(),
      },
      tx
    );
    if (!updated) throw AppError.notFound('Device');

    const who = params.automatic ? 'automatically' : `by ${params.actor.userName}`;
    await deviceManagementService.recordAction(
      {
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: params.actor.userId,
        userName: params.actor.userName,
        action: 'STATUS_CHANGE',
        reason: `Phone released ${who} (was ${device.status}). ${params.reason}`,
        ipAddress: params.actor.ipAddress,
      },
      tx
    );

    await AuditService.log(
      {
        dealerId: device.dealerId,
        userId: params.actor.userId,
        actorName: params.actor.userName,
        actorRole: params.actor.userRole,
        action: 'DEVICE_RELEASED',
        targetType: 'DEVICE',
        targetId: device.id,
        details:
          `${device.brand} ${device.model} was released ${who} and is no longer managed. ` +
          `The app removes its restrictions at the phone's next check-in. ${params.reason}`,
        ipAddress: params.actor.ipAddress,
      },
      tx
    );

    return updated;
  }
}
