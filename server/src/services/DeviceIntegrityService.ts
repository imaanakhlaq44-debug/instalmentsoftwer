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
import {
  AttestationPayload,
  AttestationResult,
  enrollmentChallenge,
  newCheckInChallenge,
  verifyKeyAttestation,
} from './attestation/KeyAttestation.js';

export type TamperFlag =
  | 'IMEI_MISMATCH'
  | 'BOOTLOADER_UNLOCKED'
  | 'ROOTED'
  | 'CUSTOM_ROM_TEST_KEYS'
  | 'DEVICE_OWNER_LOST'
  /** The handset serial differs from the one pinned after enrollment. */
  | 'SERIAL_MISMATCH'
  /** The secure chip's factory IMEI is not the registered IMEI. */
  | 'ATTESTED_IMEI_MISMATCH'
  /** A hardware attestation chain was forged or malformed. */
  | 'ATTESTATION_INVALID'
  /** A hardware attestation chain used a certificate Google has revoked (leaked keybox). */
  | 'ATTESTATION_REVOKED';

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
  /** TEE/StrongBox key attestation chain (DPC 1.5+). */
  attestation?: AttestationPayload;
}

export interface IntegrityEvaluation {
  imeis: string[];
  primaryReportedImei: string | undefined;
  imeiMatched: boolean | undefined;
  tamperFlags: TamperFlag[];
  severeTamper: boolean;
  tamperReason: string | undefined;
  hasAnySignal: boolean;
  /** The serial this evaluation trusts most: attested when available, else reported. */
  effectiveSerial: string | undefined;
}

const IMEI_PATTERN = /^\d{14,16}$/;
const SILENT_THRESHOLD_HOURS = 72;
const SEVERE_FLAGS = new Set<TamperFlag>([
  'IMEI_MISMATCH',
  'BOOTLOADER_UNLOCKED',
  'ROOTED',
  'SERIAL_MISMATCH',
  'ATTESTED_IMEI_MISMATCH',
]);
/** Flags that refuse an enrollment outright. */
const ENROLL_BLOCKING_FLAGS = new Set<TamperFlag>(['IMEI_MISMATCH', 'ATTESTED_IMEI_MISMATCH']);
/** A fresh hardware attestation is asked for once a day. */
const ATTESTATION_INTERVAL_MS = 24 * 3_600_000;

function sameSerial(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function maskSerial(serial: string | undefined): string {
  if (!serial) return 'N/A';
  return serial.length <= 4 ? '****' : `${'*'.repeat(serial.length - 4)}${serial.slice(-4)}`;
}

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
  integrity?: IntegrityReportPayload,
  attestation?: AttestationResult,
  effectiveSerial?: string
): string {
  switch (flag) {
    case 'IMEI_MISMATCH':
      return `Reported handset IMEI (${maskImei(primaryReportedImei)}) does not match registered IMEI (${maskImei(device.imei)}).`;
    case 'BOOTLOADER_UNLOCKED': {
      if (
        attestation?.status === 'VERIFIED' &&
        (attestation.deviceLocked === false ||
          attestation.verifiedBootState === 'UNVERIFIED' ||
          attestation.verifiedBootState === 'FAILED')
      ) {
        return `Secure chip reports the bootloader unlocked (deviceLocked=${attestation.deviceLocked}, verifiedBoot=${attestation.verifiedBootState ?? 'unknown'}).`;
      }
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
    case 'SERIAL_MISMATCH':
      return `Handset serial (${maskSerial(effectiveSerial)}) does not match the serial recorded at enrollment (${maskSerial(device.enrolledSerial)}).`;
    case 'ATTESTED_IMEI_MISMATCH':
      return `Secure-chip factory IMEI (${(attestation?.imeis ?? []).map((v) => maskImei(v)).join(', ') || 'N/A'}) does not match registered IMEI (${maskImei(device.imei)}).`;
    case 'ATTESTATION_INVALID':
      return `Hardware attestation failed verification: ${attestation?.reason ?? 'invalid chain'}`;
    case 'ATTESTATION_REVOKED':
      return 'Hardware attestation used a certificate Google has revoked (likely a leaked/spoofed keybox).';
  }
}

export class DeviceIntegrityService {
  static evaluate(device: Device, payload?: TelemetryPayload, attestation?: AttestationResult): IntegrityEvaluation {
    const imeis = normalizeImeis(payload?.imeis);
    const serial = payload?.serialNumber?.trim() || undefined;
    const hasAnySignal =
      imeis.length > 0 ||
      serial !== undefined ||
      payload?.isDeviceOwner !== undefined ||
      payload?.integrity !== undefined ||
      attestation !== undefined;
    const verified = attestation?.status === 'VERIFIED' ? attestation : undefined;
    const effectiveSerial = verified?.serial ?? serial;

    const imeiMatched = imeis.length > 0 ? imeis.includes(device.imei) : undefined;
    const primaryReportedImei = imeiMatched === true ? device.imei : imeis[0];

    const tamperFlags: TamperFlag[] = [];
    if (imeiMatched === false) tamperFlags.push('IMEI_MISMATCH');
    if (payload?.integrity?.bootloaderUnlocked) tamperFlags.push('BOOTLOADER_UNLOCKED');
    if (payload?.integrity?.rooted) tamperFlags.push('ROOTED');
    if (payload?.integrity?.testKeys) tamperFlags.push('CUSTOM_ROM_TEST_KEYS');
    if (payload?.isDeviceOwner === false) tamperFlags.push('DEVICE_OWNER_LOST');

    // The pinned serial is compared on every contact once it exists. A first
    // enrollment has no pin yet; a re-enrolment of the same record does.
    if (effectiveSerial && device.enrolledSerial && !sameSerial(effectiveSerial, device.enrolledSerial)) {
      tamperFlags.push('SERIAL_MISMATCH');
    }

    if (verified) {
      if (verified.imeis.length > 0 && !verified.imeis.includes(device.imei)) {
        tamperFlags.push('ATTESTED_IMEI_MISMATCH');
      }
      const bootOpen =
        verified.deviceLocked === false ||
        verified.verifiedBootState === 'UNVERIFIED' ||
        verified.verifiedBootState === 'FAILED';
      if (bootOpen && !tamperFlags.includes('BOOTLOADER_UNLOCKED')) tamperFlags.push('BOOTLOADER_UNLOCKED');
      if (verified.verifiedBootState === 'SELF_SIGNED' && !tamperFlags.includes('CUSTOM_ROM_TEST_KEYS')) {
        tamperFlags.push('CUSTOM_ROM_TEST_KEYS');
      }
    } else if (attestation?.status === 'INVALID') {
      tamperFlags.push('ATTESTATION_INVALID');
    } else if (attestation?.status === 'REVOKED') {
      tamperFlags.push('ATTESTATION_REVOKED');
    }

    const severeTamper = tamperFlags.some((f) => SEVERE_FLAGS.has(f));
    const tamperReason =
      tamperFlags.length > 0
        ? tamperFlags
            .map((f) => describeFlag(f, device, primaryReportedImei, payload?.integrity, attestation, effectiveSerial))
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
      effectiveSerial,
    };
  }

  /** Columns recording an attestation outcome. Untrusted results leave the attested IDs as they were. */
  static attestationUpdates(result: AttestationResult | undefined, nowIso: string): Partial<Device> {
    if (!result) return {};
    const updates: Partial<Device> = {
      attestationStatus: result.status,
      attestationReason: result.reason?.slice(0, 300),
    };
    // A stale challenge is not an answer: keep the outstanding one and let the
    // response hand it out again.
    if (result.status === 'CHALLENGE_MISMATCH') return updates;

    updates.attestationCheckedAt = nowIso;
    updates.attestationChallenge = undefined;
    updates.attestationChallengeAt = undefined;
    if (result.status === 'VERIFIED') {
      updates.attestedAt = nowIso;
      updates.attestationSecurityLevel = result.securityLevel;
      updates.attestedImeis = result.imeis;
      updates.attestedSerial = result.serial;
      updates.attestedBrand = result.brand?.slice(0, 64);
      updates.attestedModel = result.model?.slice(0, 64);
      updates.attestedBootLocked = result.deviceLocked;
      updates.attestedBootState = result.verifiedBootState;
    }
    return updates;
  }

  /**
   * The challenge to hand the handset on this check-in, if a fresh attestation
   * is due. Re-sends an outstanding one rather than minting a new one each
   * time, so a handset that missed a response still answers the right one.
   */
  static async attestationChallengeFor(device: Device, now: Date = new Date()): Promise<string | undefined> {
    if (device.noLock) return undefined;
    const t = now.getTime();
    const checkedAt = device.attestationCheckedAt ? new Date(device.attestationCheckedAt).getTime() : 0;
    if (t - checkedAt < ATTESTATION_INTERVAL_MS) return undefined;

    const issuedAt = device.attestationChallengeAt ? new Date(device.attestationChallengeAt).getTime() : 0;
    if (device.attestationChallenge && t - issuedAt < ATTESTATION_INTERVAL_MS) return device.attestationChallenge;

    const challenge = newCheckInChallenge();
    await repo.devices.update(device.id, {
      attestationChallenge: challenge,
      attestationChallengeAt: now.toISOString(),
    });
    return challenge;
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
    ipAddress?: string,
    enrollmentToken?: string
  ): Promise<{ updates: Partial<Device> }> {
    // At enrollment the challenge is derived from the single-use token, which
    // only this handset and this server hold — no extra round trip needed.
    const attestation = await verifyKeyAttestation(
      payload?.attestation,
      enrollmentToken ? enrollmentChallenge(enrollmentToken) : undefined,
      new Date(nowIso)
    );
    const evaluation = this.evaluate(device, payload, attestation);
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
      ...this.attestationUpdates(attestation, nowIso),
    };

    if (evaluation.tamperFlags.some((f) => ENROLL_BLOCKING_FLAGS.has(f))) {
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
        message: `${device.brand} ${device.model} failed hardware identity check at enrollment. ${evaluation.tamperReason ?? ''}`.trim(),
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

    // Pin the serial on a first enrollment. A record that already has one keeps
    // it: a re-enrolment with a different serial stays flagged until the shop
    // inspects the phone and clears the alert.
    if (!device.enrolledSerial && evaluation.effectiveSerial) {
      baseUpdates.enrolledSerial = evaluation.effectiveSerial;
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
    const expected = device.attestationChallenge ? Buffer.from(device.attestationChallenge, 'base64url') : undefined;
    const attestation = await verifyKeyAttestation(payload?.attestation, expected, new Date(nowIso));
    const evaluation = this.evaluate(device, payload, attestation);
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
      ...this.attestationUpdates(attestation, nowIso),
      // The first serial seen after enrollment (a DPC upgraded from 1.3, or a
      // phone enrolled before serials were reported) becomes the pin.
      ...(!device.enrolledSerial && evaluation.effectiveSerial ? { enrolledSerial: evaluation.effectiveSerial } : {}),
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

