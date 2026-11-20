import crypto from 'node:crypto';
import { runInTransaction, Tx } from '../db/prisma.js';
import { AppError } from '../utils/AppError.js';
import { isValidImei } from '../utils/validators.js';
import { repo } from '../db/repositories/index.js';

export interface PhoneReport {
  brand: string;
  model: string;
  osVersion?: string;
  imeis?: string[];
  serialNumber?: string;
  isDeviceOwner?: boolean;
}

/** Intake credentials never authorize a lock or a financial record. */
export class PhoneIntakeService {
  static async receive(token: string, report: PhoneReport) {
    return runInTransaction(async (tx) => {
      const enrollment = await tx.enrollmentToken.findUnique({ where: { token } });
      if (!enrollment) return null;
      const session = await tx.phoneIntake.findUnique({ where: { tokenId: enrollment.id } });
      if (!session) return null;
      if (enrollment.expiresAt <= new Date() || enrollment.status !== 'WAITING') {
        // A cancelled intake never had a financial sale. Let its own DPC step
        // down instead of leaving an unassigned phone stuck as Device Owner.
        if (!session.deviceId) return { pending: false, cancelled: true, deviceId: null };
        throw AppError.badRequest('This phone scan has expired or was cancelled. Generate a new QR.');
      }
      if (!report.isDeviceOwner) throw AppError.badRequest('Scan this QR from the Android welcome screen to provision Device Owner.');
      if (report.brand === 'Unknown' || report.model === 'Unknown') throw AppError.badRequest('This phone scan needs Almas DPC 1.6.0 or newer. Use the latest welcome-screen QR.');
      const imeis = [...new Set((report.imeis ?? []).filter(isValidImei))];
      const rawSerial = report.serialNumber?.trim();
      const serial = rawSerial && !['unknown', 'null', 'undefined'].includes(rawSerial.toLowerCase()) ? rawSerial : undefined;
      if (!imeis.length && (!serial || serial.toLowerCase() === 'unknown')) {
        throw AppError.badRequest('This phone did not provide an IMEI or serial. Use manual registration.');
      }
      const identityHash = crypto.createHash('sha256').update(JSON.stringify({ imeis: [...imeis].sort(), serial })).digest('hex');
      if (session.identityHash && session.identityHash !== identityHash) {
        throw AppError.conflict('This QR has already been scanned by another phone.');
      }
      if (!session.report) {
        await tx.phoneIntake.update({ where: { id: session.id }, data: {
          identityHash, report: { ...report, imeis, ...(serial ? { serialNumber: serial } : { serialNumber: '' }) }, reportedAt: new Date(),
        } });
      }
      return { pending: !session.deviceId, deviceId: session.deviceId };
    });
  }

  /** Runs inside the sale transaction: a failed sale leaves its scan reusable. */
  static async attach(tx: Tx, id: string, dealerId: string, device: { id: string; imei: string; serialNumber?: string; customerId: string }) {
    const session = await tx.phoneIntake.findUnique({ where: { id }, include: { token: true } });
    if (!session || session.dealerId !== dealerId) throw AppError.notFound('Phone scan');
    if (session.deviceId || !session.report || session.token.status !== 'WAITING' || session.token.expiresAt <= new Date()) {
      throw AppError.badRequest('This phone scan is no longer available. Generate a new QR.');
    }
    const report = session.report as unknown as PhoneReport;
    if (report.imeis?.length && !report.imeis.includes(device.imei)) {
      throw AppError.badRequest('The entered IMEI does not match the scanned phone.');
    }
    if (report.serialNumber && device.serialNumber?.trim().toUpperCase() !== report.serialNumber.toUpperCase()) {
      throw AppError.badRequest('The entered serial does not match the scanned phone.');
    }
    await tx.phoneIntake.update({ where: { id }, data: { deviceId: device.id } });
    await tx.enrollmentToken.update({ where: { id: session.tokenId }, data: {
      deviceId: device.id, customerId: device.customerId,
    } });
    return (await repo.enrollmentTokens.findById(session.tokenId, tx))!;
  }
}
