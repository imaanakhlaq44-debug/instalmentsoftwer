import { repo } from '../db/repositories/index.js';
import { runInTransaction } from '../db/prisma.js';
import { Device, UserRole } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';
import { AuditService } from './AuditService.js';
import { DeviceReleaseService } from './DeviceReleaseService.js';
import { deviceManagementService } from './DeviceManagementService.js';

export interface ClosureActor {
  userId: string;
  userName: string;
  userRole: UserRole;
  dealerId: string | null;
  ipAddress?: string;
}

/** What the sale form is told about an IMEI before it tries to register it. */
export type ImeiStatus =
  | { registered: false }
  | {
      registered: true;
      /** The live registration belongs to the asking shop (always true for a super admin). */
      sameShop: true;
      /** Only the shop owner (or the platform) may close a registration. */
      canClose: boolean;
      device: {
        id: string;
        brand: string;
        model: string;
        status: string;
        registeredAt: string;
        customerName: string | null;
        plan: { status: string; remainingBalance: number; outstandingLateFees: number } | null;
      };
    }
  | { registered: true; sameShop: false; canClose: false };

const OPEN_PLAN = (status?: string) => !!status && status !== 'COMPLETED' && status !== 'CANCELLED';

/**
 * Closing a registration, so a phone the shop took back can be sold again.
 *
 * An IMEI is unique among *live* registrations only. Closing one:
 *
 *  - releases the phone if it is still managed, so its app unwinds every
 *    restriction and steps down at its next check-in (see DeviceReleaseService);
 *  - cancels any open installment plan, which stops reminders, late fees and
 *    locks for the previous customer — the balance still owed is written into
 *    the audit trail, never deleted;
 *  - expires any QR still waiting for that record;
 *  - stamps `retiredAt`, which frees the IMEI for a new registration.
 *
 * Nothing is deleted. The old customer, plan, payments, contract and timeline
 * stay exactly as they were, and the lock spent on the old sale is not
 * returned: the next sale is a new handset sale and spends its own.
 *
 * Only the shop that holds the registration can close it (or the platform).
 * Another shop is told the IMEI is taken and nothing else — otherwise anyone
 * could wipe the lien on a financed phone they had come by.
 */
export class RegistrationClosureService {
  static async imeiStatus(imei: string, actor: ClosureActor): Promise<ImeiStatus> {
    const device = await repo.devices.findByImei(imei);
    if (!device) return { registered: false };

    const isPlatform = actor.userRole === 'SUPER_ADMIN';
    if (!isPlatform && device.dealerId !== actor.dealerId) {
      return { registered: true, sameShop: false, canClose: false };
    }

    const [customer, plan] = await Promise.all([
      repo.customers.findById(device.customerId),
      repo.installmentPlans.findByDevice(device.id),
    ]);

    return {
      registered: true,
      sameShop: true,
      canClose: isPlatform || actor.userRole === 'DEALER_ADMIN',
      device: {
        id: device.id,
        brand: device.brand,
        model: device.model,
        status: device.status,
        registeredAt: device.createdAt,
        customerName: customer?.name ?? null,
        plan: plan
          ? {
              status: plan.status,
              remainingBalance: plan.remainingBalance,
              outstandingLateFees: plan.outstandingLateFees ?? 0,
            }
          : null,
      },
    };
  }

  static async close(
    deviceId: string,
    params: { actor: ClosureActor; reason: string; confirmImeiLast4: string }
  ): Promise<{ device: Device; imei: string; outstanding: number }> {
    const { actor, reason } = params;

    return runInTransaction(async (tx) => {
      const device = await repo.devices.findById(deviceId, tx);
      if (!device || (actor.userRole !== 'SUPER_ADMIN' && device.dealerId !== actor.dealerId)) {
        throw AppError.notFound('Device');
      }
      if (device.retiredAt) {
        throw AppError.conflict('This registration is already closed.');
      }
      // Typing the IMEI's last four digits makes closing the wrong phone's
      // record a deliberate act, not a slip of the finger in a list.
      if (device.imei.slice(-4) !== params.confirmImeiLast4) {
        throw AppError.badRequest('The last 4 digits do not match this phone\'s IMEI.');
      }

      // 1. A phone still under management is released, so it lets go of the
      //    restrictions and its device-owner status at its next check-in.
      let current = device;
      if (DeviceReleaseService.RELEASABLE.has(device.status)) {
        current = await DeviceReleaseService.release(
          device,
          {
            actor: { userId: actor.userId, userName: actor.userName, userRole: actor.userRole, ipAddress: actor.ipAddress },
            reason: `Registration closed so the phone can be registered again. Reason: ${reason}`,
            automatic: false,
          },
          tx
        );
      }

      // 2. The previous customer's plan stops: no more reminders, fees or locks.
      const plan = await repo.installmentPlans.findByDevice(device.id, tx);
      const outstanding = plan && OPEN_PLAN(plan.status) ? plan.remainingBalance + (plan.outstandingLateFees ?? 0) : 0;
      if (plan && OPEN_PLAN(plan.status)) {
        await repo.installmentPlans.update(plan.id, { status: 'CANCELLED' }, tx);
      }

      // 3. A QR still waiting for this record must not enrol a phone onto it.
      await tx.enrollmentToken.updateMany({
        where: { deviceId: device.id, status: { in: ['WAITING', 'SCANNED', 'VERIFYING'] } },
        data: { status: 'EXPIRED' },
      });

      // 4. Free the IMEI. The row, and everything that points at it, stays.
      const closedAt = new Date().toISOString();
      const updated = await repo.devices.update(device.id, { retiredAt: closedAt, updatedAt: closedAt }, tx);
      if (!updated) throw AppError.notFound('Device');

      const customer = await repo.customers.findById(device.customerId, tx);
      const owed = outstanding > 0 ? ` Rs ${outstanding.toLocaleString('en-PK')} was still owed on the plan, which is now cancelled.` : '';

      await deviceManagementService.recordAction(
        {
          deviceId: device.id,
          dealerId: device.dealerId,
          userId: actor.userId,
          userName: actor.userName,
          action: 'STATUS_CHANGE',
          reason: `Registration closed by ${actor.userName} (was ${current.status === device.status ? device.status : `${device.status}, released`}).${owed} Reason: ${reason}`,
          ipAddress: actor.ipAddress,
        },
        tx
      );

      await AuditService.log(
        {
          dealerId: device.dealerId,
          userId: actor.userId,
          actorName: actor.userName,
          actorRole: actor.userRole,
          action: 'DEVICE_REGISTRATION_CLOSED',
          targetType: 'DEVICE',
          targetId: device.id,
          details:
            `${device.brand} ${device.model} (IMEI ${maskImei(device.imei)}) of ${customer?.name ?? 'an unknown customer'} ` +
            `was closed so the IMEI can be registered again.${owed} Reason: ${reason}`,
          ipAddress: actor.ipAddress,
        },
        tx
      );

      return { device: updated, imei: device.imei, outstanding };
    });
  }
}
