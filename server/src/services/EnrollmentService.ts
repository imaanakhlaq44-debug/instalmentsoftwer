import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import { EnrollmentToken, QRType, Device, UserRole, Dealer } from '../types/index.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';

export interface EnrollmentActor {
  userId: string;
  userName: string;
  userRole: UserRole;
}

/** Tokens live for one hour by default; the caller may shorten but not extend past a day. */
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 1440;

export class EnrollmentService {
  public static generateToken(params: {
    dealerId: string;
    deviceId?: string;
    customerId?: string;
    qrType: QRType;
    expiresInMinutes?: number;
    actor: EnrollmentActor;
    ipAddress?: string;
  }): EnrollmentToken {
    const ttl = Math.min(params.expiresInMinutes || DEFAULT_TTL_MINUTES, MAX_TTL_MINUTES);
    const nowIso = new Date().toISOString();

    if (params.deviceId) {
      const device = db.findById<Device>('devices', params.deviceId);
      if (!device) throw AppError.notFound('Device');
      if (device.dealerId !== params.dealerId) {
        throw AppError.forbidden('You cannot generate an enrollment token for another dealer\'s device.');
      }
      if (device.status === 'ACTIVE' || device.status === 'LOCKED') {
        throw AppError.badRequest('This device is already enrolled and under management.');
      }

      // Only one live token per device — otherwise an old printed QR keeps working.
      const existing = db.find<EnrollmentToken>(
        'enrollmentTokens',
        (t) => t.deviceId === params.deviceId && t.status === 'WAITING' && new Date(t.expiresAt) > new Date()
      );
      for (const old of existing) {
        db.update<EnrollmentToken>('enrollmentTokens', old.id, { status: 'EXPIRED' });
      }
    }

    // Cryptographically random, not a truncated UUID plus a timestamp — the old
    // format leaked when the token was created and had far less entropy.
    const secret = crypto.randomBytes(24).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    const tokenStr = `EMIS-${params.qrType.substring(0, 3)}-${secret}`;

    const token = db.insert<EnrollmentToken>('enrollmentTokens', {
      id: `tok-${uuidv4().substring(0, 8)}`,
      dealerId: params.dealerId,
      deviceId: params.deviceId,
      customerId: params.customerId,
      token: tokenStr,
      qrType: params.qrType,
      status: 'WAITING',
      expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
      createdAt: nowIso,
    });

    AuditService.log({
      dealerId: params.dealerId,
      userId: params.actor.userId,
      actorName: params.actor.userName,
      actorRole: params.actor.userRole,
      action: 'ENROLLMENT_QR_GENERATED',
      targetType: 'ENROLLMENT_TOKEN',
      targetId: token.id,
      details: `Generated a ${params.qrType} enrollment QR for device ${params.deviceId || '(unassigned)'}, valid for ${ttl} minutes.`,
      ipAddress: params.ipAddress,
    });

    return token;
  }

  /** The provisioning JSON an Android DPC reads out of the QR code. */
  public static buildQrPayload(token: EnrollmentToken): string {
    const dealer = db.findById<Dealer>('dealers', token.dealerId);
    return JSON.stringify({
      version: '2.4.0',
      type: token.qrType,
      token: token.token,
      serverUrl: process.env.DPC_SERVER_URL || 'https://api.emishield.pk/dpc/v1',
      dealerCode: dealer?.code ?? token.dealerId,
      expiresAt: token.expiresAt,
    });
  }

  /**
   * Redeems a token and completes enrollment.
   *
   * Note the device is taken from the TOKEN, not from the request. The previous
   * version used `params.deviceId || tokenRecord.deviceId`, which let a caller
   * redeem customer A's token against customer B's phone.
   */
  public static async verifyAndEnroll(params: {
    token: string;
    /** Only used when the token was issued without a device attached. */
    deviceId?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; device: Device; message: string }> {
    const tokenRecord = db.findOne<EnrollmentToken>('enrollmentTokens', (t) => t.token === params.token);

    if (!tokenRecord) {
      throw AppError.badRequest('This enrollment code is not valid.');
    }

    if (tokenRecord.status === 'ENROLLED') {
      throw AppError.badRequest('This enrollment code has already been used. Please generate a new QR.');
    }

    if (tokenRecord.status === 'EXPIRED' || new Date(tokenRecord.expiresAt) < new Date()) {
      db.update<EnrollmentToken>('enrollmentTokens', tokenRecord.id, { status: 'EXPIRED' });
      throw AppError.badRequest('This enrollment code has expired. Please generate a new QR.');
    }

    // The token's own device binding always wins.
    let targetDeviceId = tokenRecord.deviceId;

    if (!targetDeviceId) {
      if (!params.deviceId) {
        throw AppError.badRequest('This enrollment code is not linked to a device, and no device was supplied.');
      }
      const candidate = db.findById<Device>('devices', params.deviceId);
      if (!candidate) throw AppError.notFound('Device');
      if (candidate.dealerId !== tokenRecord.dealerId) {
        throw AppError.forbidden('This enrollment code belongs to a different dealer.');
      }
      targetDeviceId = candidate.id;
    } else if (params.deviceId && params.deviceId !== targetDeviceId) {
      throw AppError.badRequest('This enrollment code was issued for a different device.');
    }

    const device = db.findById<Device>('devices', targetDeviceId);
    if (!device) throw AppError.notFound('Device');

    db.update<EnrollmentToken>('enrollmentTokens', tokenRecord.id, { status: 'VERIFYING' });

    try {
      const result = await deviceManagementService.enrollDevice(device.id, tokenRecord.token, params.ipAddress);

      db.update<EnrollmentToken>('enrollmentTokens', tokenRecord.id, {
        status: 'ENROLLED',
        deviceId: device.id,
      });

      AuditService.log({
        dealerId: device.dealerId,
        userId: 'system',
        actorName: 'Enrollment Client',
        actorRole: 'DEALER_STAFF',
        action: 'DEVICE_ENROLLED',
        targetType: 'DEVICE',
        targetId: device.id,
        details: `${device.brand} ${device.model} completed provisioning and is now under management.`,
        ipAddress: params.ipAddress,
      });

      return {
        success: true,
        device: result.device,
        message: `${device.brand} ${device.model} was enrolled successfully and is now active.`,
      };
    } catch (err) {
      // Leave the token reusable so a transient failure does not burn the QR.
      db.update<EnrollmentToken>('enrollmentTokens', tokenRecord.id, { status: 'WAITING' });
      throw err;
    }
  }
}
