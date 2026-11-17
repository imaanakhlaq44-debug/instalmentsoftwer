import { runInTransaction } from '../db/prisma.js';
import { AuditService, AuditEntry } from './AuditService.js';
import { AppError } from '../utils/AppError.js';
import { deviceCommandSignal } from './DeviceCommandSignal.js';

export class ShopDeletionService {
  static async remove(id: string, confirmationName: string, actor: Pick<AuditEntry,'userId'|'actorName'|'actorRole'|'ipAddress'>) {
    const result = await runInTransaction(async tx => {
      // Serialize removal with lock issuance and license purchases for this shop.
      await tx.$queryRaw`SELECT id FROM dealers WHERE id = ${id} FOR UPDATE`;
      const dealer = await tx.dealer.findUnique({ where: { id } });
      if (!dealer) throw AppError.notFound('Shop');
      if (confirmationName.trim() !== dealer.name) throw AppError.badRequest('Type the exact shop name to confirm deletion.');
      if (dealer.deletedAt) return { deviceIds: [] as string[], releasedPhones: 0, voidedLocks: 0, alreadyDeleted: true };
      const now = new Date();
      await tx.dealer.update({ where: { id }, data: { active: false, deletedAt: now, requestedPackSize: null } });
      const phones = await tx.device.findMany({ where: { dealerId: id, status: { not: 'REMOVED' } }, select: { id: true } });
      await tx.user.updateMany({ where: { dealerId: id }, data: { active: false, sessionVersion: { increment: 1 } } });
      const licenses = await tx.deviceLicense.updateMany({ where: { dealerId: id, status: { not: 'VOID' } }, data: { status: 'VOID' } });
      // Keep the valid handset credential: requireDevice returns 403 for REMOVED,
      // which lets the existing DPC safely clear restrictions and Device Owner.
      await tx.device.updateMany({ where: { dealerId: id }, data: { status: 'REMOVED', noLock: true, pendingCommand: null, pendingCommandAt: null, lockReason: null, lockMessage: null, updatedAt: now } });
      await tx.enrollmentToken.updateMany({ where: { dealerId: id }, data: { status: 'EXPIRED', expiresAt: now } });
      await tx.smsRelay.updateMany({ where: { dealerId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.notification.updateMany({ where: { dealerId: id, status: 'QUEUED' }, data: { status: 'FAILED', failureReason: 'Shop deleted by the platform administrator.', leaseUntil: null } });
      await tx.lockOrder.updateMany({ where: { dealerId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await AuditService.log({ ...actor, dealerId: id, action: 'SHOP_DELETED', targetType: 'DEALER', targetId: id,
        details: 'Shop access revoked; ' + licenses.count + ' locks voided; ' + phones.length + ' phones released. Financial and agreement records retained.' }, tx);
      return { deviceIds: phones.map(p => p.id), releasedPhones: phones.length, voidedLocks: licenses.count, alreadyDeleted: false };
    });
    for (const id of result.deviceIds) deviceCommandSignal.notify(id);
    const { deviceIds: _, ...response } = result;
    return response;
  }
}
