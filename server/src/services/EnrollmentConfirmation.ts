import { runInShopTransaction } from '../db/prisma.js';
import { repo } from '../db/repositories/index.js';
import { AuditService } from './AuditService.js';
import { deviceCommandSignal } from './DeviceCommandSignal.js';
import { AppError } from '../utils/AppError.js';
import { Device } from '../types/index.js';

export async function confirmEnrollment(device: Device, nowIso: string): Promise<Device> {
  const result = await runInShopTransaction(device.dealerId, async tx => {
    const current = await repo.devices.findById(device.id, tx);
    if (!current || current.authTokenHash !== device.authTokenHash) throw AppError.unauthorized('Enrollment credentials changed.');
    if (current.status !== 'ENROLLED') return current;
    const shop = await tx.dealer.findUnique({ where: { id: current.dealerId } });
    if (!shop?.active || shop.deletedAt) throw AppError.forbidden('This shop is no longer active.');
    const pending = await tx.enrollmentToken.count({ where: { deviceId: device.id, status: 'VERIFYING' } });
    if (!pending) throw AppError.conflict('This enrollment is no longer pending. Contact the shop.');
    const active = await repo.devices.update(device.id, { status: 'ACTIVE', isOnline: true, lastSeen: nowIso, lastCheckInAt: nowIso, updatedAt: nowIso }, tx);
    await tx.enrollmentToken.updateMany({ where: { deviceId: device.id, status: 'VERIFYING' }, data: { status: 'ENROLLED' } });
    await AuditService.log({ dealerId: device.dealerId, userId: 'system', actorName: 'Device setup confirmation', actorRole: 'DEALER_STAFF', action: 'DEVICE_ENROLLED', targetType: 'DEVICE', targetId: device.id, details: 'The authenticated handset confirmed Device Owner and completed Android setup.' }, tx);
    return active!;
  });
  deviceCommandSignal.notify(device.id);
  return result;
}
