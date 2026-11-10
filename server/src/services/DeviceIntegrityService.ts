import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../db/prisma.js';
import { repo } from '../db/repositories/index.js';
import { toDomainList } from '../db/mappers.js';
import { Device } from '../types/index.js';
import { AuditService } from './AuditService.js';
import { ContractService } from './ContractService.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';

export type TamperFlag =
  | 'IMEI_MISMATCH'
  | 'BOOTLOADER_UNLOCKED'
  | 'ROOTED'
  | 'CUSTOM_ROM_TEST_KEYS'
  | 'DEVICE_OWNER_LOST';

export interface IntegrityReportPayload {
  rooted?: boolean;
  bootloaderUnlocked?: boolean;
  testKeys?: boolean;
  verifiedBootState?: string;
  flashLocked?: string;
}

export interface TelemetryPayload {
  imeis?: string[];
  serialNumber?: string;
  isDeviceOwner?: boolean;
  integrity?: IntegrityReportPayload;
}

export interface IntegrityEvaluation {
  imeis: string[];
  primaryReportedImei: string | undefined;
  imeiMatched: boolean | undefined;
  tamperFlags: TamperFlag[];
  severeTamper: boolean;
  tamperReason: string | undefined;
  hasAnySignal: boolean;
}

const IMEI_PATTERN = /^\d{14,16}$/;
const SILENT_THRESHOLD_HOURS = 72;
const SEVERE_FLAGS = new Set<TamperFlag>(['IMEI_MISMATCH', 'BOOTLOADER_UNLOCKED', 'ROOTED']);

function normalizeImeis(raw?: string[]): string[] {
  if (!raw || raw.length === 0) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    const clean = item.trim();
    if (IMEI_PATTERN.test(clean)) {
      unique.add(clean);
      if (unique.size >= 4) break;
    }
  }
  return [...unique];
}

function mergeFlags(existing: string[] | undefined, incoming: string[]): string[] {
  return [...new Set([...(existing ?? []), ...incoming])];
}

function describeFlag(
  flag: TamperFlag,
  device: Device,
  primaryReportedImei?: string,
  integrity?: IntegrityReportPayload
): string {
  switch (flag) {
    case 'IMEI_MISMATCH':
      return `Reported handset IMEI (${maskImei(primaryReportedImei)}) does not match registered IMEI (${maskImei(device.imei)}).`;
    case 'BOOTLOADER_UNLOCKED': {
      const detail = [
        integrity?.verifiedBootState ? `verifiedBoot=${integrity.verifiedBootState}` : null,
        integrity?.flashLocked ? `flashLocked=${integrity.flashLocked}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return detail
        ? `Bootloader reports unlocked state (${detail}).`
        : 'Bootloader reports unlocked state.';
    }
    case 'ROOTED':
      return 'Root/Superuser binaries detected on handset.';
    case 'CUSTOM_ROM_TEST_KEYS':
      return 'OS image is signed with development test-keys.';
    case 'DEVICE_OWNER_LOST':
      return 'DPC lacks Device Owner privileges; OS-level restrictions cannot be enforced.';
  }
}

export class DeviceIntegrityService {
  static evaluate(device: Device, payload?: TelemetryPayload): IntegrityEvaluation {
    const imeis = normalizeImeis(payload?.imeis);
    const serial = payload?.serialNumber?.trim() || undefined;
    const hasAnySignal =
      imeis.length > 0 ||
      serial !== undefined ||
      payload?.isDeviceOwner !== undefined ||
      payload?.integrity !== undefined;

    const imeiMatched = imeis.length > 0 ? imeis.includes(device.imei) : undefined;
    const primaryReportedImei = imeiMatched === true ? device.imei : imeis[0];

    const tamperFlags: TamperFlag[] = [];
    if (imeiMatched === false) tamperFlags.push('IMEI_MISMATCH');
    if (payload?.integrity?.bootloaderUnlocked) tamperFlags.push('BOOTLOADER_UNLOCKED');
    if (payload?.integrity?.rooted) tamperFlags.push('ROOTED');
    if (payload?.integrity?.testKeys) tamperFlags.push('CUSTOM_ROM_TEST_KEYS');
    if (payload?.isDeviceOwner === false) tamperFlags.push('DEVICE_OWNER_LOST');

    const severeTamper = tamperFlags.some((f) => SEVERE_FLAGS.has(f));
    const tamperReason =
      tamperFlags.length > 0
        ? tamperFlags
            .map((f) => describeFlag(f, device, primaryReportedImei, payload?.integrity))
            .join(' ')
        : undefined;

    return {
      imeis,
      primaryReportedImei,
      imeiMatched,
      tamperFlags,
      severeTamper,
      tamperReason,
      hasAnySignal,
    };
  }

  /**
   * Verifies hardware identity & integrity telemetry sent during `POST /api/dpc/enroll`.
   *
   * Rejects an explicit IMEI mismatch BEFORE claiming the enrollment token or burning
   * a dealer lock licence so a mismatched phone cannot consume inventory.
   */
  static async processEnrollmentTelemetry(
    device: Device,
    payload: TelemetryPayload | undefined,
    nowIso: string,
    ipAddress?: string
  ): Promise<{ updates: Partial<Device> }> {
    const evaluation = this.evaluate(device, payload);
    if (!evaluation.hasAnySignal) {
      return { updates: {} };
    }

    const baseUpdates: Partial<Device> = {
      integrityCheckedAt: nowIso,
      ...(evaluation.primaryReportedImei ? { reportedImei: evaluation.primaryReportedImei } : {}),
      ...(evaluation.imeis.length > 0 ? { reportedImeis: evaluation.imeis } : {}),
      ...(payload?.serialNumber ? { reportedSerial: payload.serialNumber } : {}),
      ...(payload?.isDeviceOwner !== undefined ? { isDeviceOwner: payload.isDeviceOwner } : {}),
      ...(evaluation.imeiMatched === true ? { imeiVerifiedAt: nowIso } : {}),
    };

    if (evaluation.tamperFlags.includes('IMEI_MISMATCH')) {
      const mergedFlags = mergeFlags(device.tamperFlags, evaluation.tamperFlags);
      await repo.devices.update(device.id, {
        ...baseUpdates,
        tamperFlags: mergedFlags,
        tamperDetectedAt: device.tamperDetectedAt ?? nowIso,
        tamperReason: evaluation.tamperReason,
        updatedAt: nowIso,
      });

      await deviceManagementService.recordAction({
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: 'system',
        userName: 'Enrollment Client',
        action: 'STATUS_CHANGE',
        reason: 'Enrollment blocked: handset hardware identifier did not match the registered device.',
        deviceAck: true,
        ipAddress,
      });

      await AuditService.log({
        dealerId: device.dealerId,
        userId: 'system',
        actorName: 'Enrollment Client',
        actorRole: 'DEALER_STAFF',
        action: 'SECURITY_ALERT',
        targetType: 'DEVICE',
        targetId: device.id,
        details:
          `Enrollment rejected for ${device.brand} ${device.model}: ${evaluation.tamperReason ?? 'Hardware verification failed.'}`,
        ipAddress,
      });

      await this.createSecurityAlert({
        dealerId: device.dealerId,
        customerId: device.customerId,
        deviceId: device.id,
        title: 'Hardware Tamper Alert (Enrollment Blocked)',
        message: `${device.brand} ${device.model} failed hardware identity check at enrollment (${maskImei(evaluation.primaryReportedImei)} vs registered ${maskImei(device.imei)}).`,
        nowIso,
      });

      // Keep DPC HTTP responses free of hardware-ID field names (privacy test contract).
      throw AppError.conflict('Hardware identity verification failed. This handset does not match the registered device.');
    }

    if (evaluation.tamperFlags.length > 0) {
      const mergedFlags = mergeFlags(device.tamperFlags, evaluation.tamperFlags);
      baseUpdates.tamperFlags = mergedFlags;
      baseUpdates.tamperDetectedAt = device.tamperDetectedAt ?? nowIso;
      baseUpdates.tamperReason = evaluation.tamperReason;

      await deviceManagementService.recordAction({
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: 'system',
        userName: 'Enrollment Client',
        action: 'STATUS_CHANGE',
        reason: `Integrity warning during enrollment (${evaluation.tamperFlags.join(', ')}).`,
        deviceAck: true,
        ipAddress,
      });

      await AuditService.log({
        dealerId: device.dealerId,
        userId: 'system',
        actorName: 'Enrollment Client',
        actorRole: 'DEALER_STAFF',
        action: 'SECURITY_ALERT',
        targetType: 'DEVICE',
        targetId: device.id,
        details: `Integrity warning at enrollment for ${device.brand} ${device.model}: ${evaluation.tamperReason}`,
        ipAddress,
      });

      await this.createSecurityAlert({
        dealerId: device.dealerId,
        customerId: device.customerId,
        deviceId: device.id,
        title: 'Device Security Integrity Alert',
        message: `${device.brand} ${device.model} enrolled with integrity warning: ${evaluation.tamperReason}`,
        nowIso,
      });
    }

    return { updates: baseUpdates };
  }

  /**
   * Processes hardware & integrity telemetry on `POST /api/dpc/check-in`.
   *
   * On severe tampering (`IMEI_MISMATCH`, `BOOTLOADER_UNLOCKED`, `ROOTED`), queues an
   * automatic LOCK command if the device is lockable (`!noLock`), in a lockable status,
   * and covered by a valid signed contract (`ContractService.consentForDevice`).
   */
  static async processCheckInTelemetry(
    device: Device,
    payload: TelemetryPayload | undefined,
    nowIso: string,
    ipAddress?: string
  ): Promise<{ device: Device; tamperLocked: boolean }> {
    const evaluation = this.evaluate(device, payload);
    if (!evaluation.hasAnySignal) {
      return { device, tamperLocked: false };
    }

    const updates: Partial<Device> = {
      integrityCheckedAt: nowIso,
      ...(evaluation.primaryReportedImei ? { reportedImei: evaluation.primaryReportedImei } : {}),
      ...(evaluation.imeis.length > 0 ? { reportedImeis: evaluation.imeis } : {}),
      ...(payload?.serialNumber ? { reportedSerial: payload.serialNumber } : {}),
      ...(payload?.isDeviceOwner !== undefined ? { isDeviceOwner: payload.isDeviceOwner } : {}),
      ...(evaluation.imeiMatched === true ? { imeiVerifiedAt: nowIso } : {}),
    };

    const previousFlags = device.tamperFlags ?? [];
    const mergedFlags = mergeFlags(previousFlags, evaluation.tamperFlags);
    const newFlags = evaluation.tamperFlags.filter((f) => !previousFlags.includes(f));

    if (evaluation.tamperFlags.length > 0) {
      updates.tamperFlags = mergedFlags;
      updates.tamperDetectedAt = device.tamperDetectedAt ?? nowIso;
      updates.tamperReason = evaluation.tamperReason;
    }

    let tamperLocked = false;
    const canQueueLock =
      evaluation.severeTamper &&
      !device.noLock &&
      ['ACTIVE', 'OVERDUE', 'ENROLLED'].includes(device.status) &&
      device.pendingCommand !== 'LOCK';

    if (canQueueLock) {
      const consent = await ContractService.consentForDevice(device.id);
      if (consent.allowed) {
        updates.status = 'LOCK_PENDING';
        updates.pendingCommand = 'LOCK';
        updates.pendingCommandAt = nowIso;
        updates.lockReason = 'Automated security restriction triggered by device integrity verification.';
        updates.lockMessage =
          'DEVICE RESTRICTED: Security verification failed or unauthorized system modification detected. Contact your dealer.';
        tamperLocked = true;
      }
    }

    const updated =
      (await repo.devices.update(device.id, {
        ...updates,
        updatedAt: nowIso,
      })) ?? device;

    if (newFlags.length > 0 || tamperLocked) {
      await deviceManagementService.recordAction({
        deviceId: device.id,
        dealerId: device.dealerId,
        userId: 'system',
        userName: 'Device Integrity Monitor',
        action: tamperLocked ? 'LOCK' : 'STATUS_CHANGE',
        oldStatus: tamperLocked ? device.status : undefined,
        newStatus: tamperLocked ? 'LOCK_PENDING' : undefined,
        reason: tamperLocked
          ? 'Security tamper detected on check-in; lock command queued for handset.'
          : `Integrity alert detected on check-in (${mergedFlags.join(', ')}).`,
        deviceAck: false,
        ipAddress,
      });

      await AuditService.log({
        dealerId: device.dealerId,
        userId: 'system',
        actorName: 'Device Integrity Monitor',
        actorRole: 'SUPER_ADMIN',
        action: 'SECURITY_ALERT',
        targetType: 'DEVICE',
        targetId: device.id,
        details:
          `${device.brand} ${device.model} raised security flag(s) [${mergedFlags.join(', ')}]` +
          (tamperLocked ? ' and queued an automatic restriction.' : '.') +
          (evaluation.tamperReason ? ` ${evaluation.tamperReason}` : ''),
        ipAddress,
      });

      await this.createSecurityAlert({
        dealerId: device.dealerId,
        customerId: device.customerId,
        deviceId: device.id,
        title: tamperLocked ? 'Security Tamper Alert — Auto-Lock Queued' : 'Device Security Integrity Alert',
        message: `${device.brand} ${device.model} triggered ${mergedFlags.join(', ')}. ${evaluation.tamperReason ?? ''}`.trim(),
        nowIso,
      });
    }

    return { device: updated, tamperLocked };
  }

  /**
   * Silent-heartbeat watchdog: flags managed (`noLock: false`) enrolled handsets that have
   * not checked in for more than 72 hours. Runs daily inside OverdueEngine.
   */
  static async flagSilentDevices(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SILENT_THRESHOLD_HOURS * 3_600_000);
    const nowIso = now.toISOString();

    const rows = (await prisma.device.findMany({
      where: {
        noLock: false,
        status: { in: ['ACTIVE', 'OVERDUE', 'LOCK_PENDING', 'LOCKED', 'UNLOCK_PENDING'] },
        OR: [
          { lastCheckInAt: { lt: cutoff } },
          { lastCheckInAt: null, lastSeen: { lt: cutoff } },
        ],
      },
    })) as Record<string, unknown>[];

    const silentDevices = toDomainList<Device>(rows);
    let alertedCount = 0;

    for (const device of silentDevices) {
      if (device.isOnline) {
        await repo.devices.update(device.id, { isOnline: false, updatedAt: nowIso });
      }

      const lastContactIso = device.lastCheckInAt ?? device.lastSeen;
      const hoursSilent = Math.max(
        SILENT_THRESHOLD_HOURS,
        Math.floor((now.getTime() - new Date(lastContactIso).getTime()) / 3_600_000)
      );

      const created = await this.createSecurityAlert({
        dealerId: device.dealerId,
        customerId: device.customerId,
        deviceId: device.id,
        title: 'Silent Handset Alert',
        message:
          `${device.brand} ${device.model} has not checked in for ${hoursSilent} hour(s) (over 72 hours). ` +
          `Verify whether the handset is powered off, offline, or tampered with.`,
        nowIso,
      });
      if (created) alertedCount++;
    }

    return alertedCount;
  }

  private static async createSecurityAlert(params: {
    dealerId: string;
    customerId?: string;
    deviceId: string;
    title: string;
    message: string;
    nowIso?: string;
  }): Promise<boolean> {
    const now = params.nowIso ? new Date(params.nowIso) : new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    const existing = await repo.notifications.findFirst({
      dealerId: params.dealerId,
      deviceId: params.deviceId,
      type: 'SECURITY_ALERT',
      title: params.title,
      createdAt: { gte: dayStart },
    });
    if (existing) return false;

    const timestamp = params.nowIso ?? new Date().toISOString();
    await repo.notifications.create({
      id: `notif-${uuidv4().substring(0, 8)}`,
      dealerId: params.dealerId,
      customerId: params.customerId,
      deviceId: params.deviceId,
      type: 'SECURITY_ALERT',
      channel: 'IN_APP',
      title: params.title,
      message: params.message,
      status: 'SENT',
      sentAt: timestamp,
      createdAt: timestamp,
    });
    return true;
  }
}

