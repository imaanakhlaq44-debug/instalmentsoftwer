import crypto from 'crypto';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../config.js';
import { repo } from '../db/repositories/index.js';
import { runInTransaction, Tx } from '../db/prisma.js';
import { EnrollmentToken, QRType, Device, UserRole } from '../types/index.js';
import { deviceManagementService } from './DeviceManagementService.js';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';
import { issueDeviceToken } from '../utils/deviceToken.js';

export interface EnrollmentActor {
  userId: string;
  userName: string;
  userRole: UserRole;
}

/** Tokens live for one hour by default; the caller may shorten but not extend past a day. */
const DEFAULT_TTL_MINUTES = 60;
const MAX_TTL_MINUTES = 1440;

export class EnrollmentService {
  public static async generateToken(params: {
    dealerId: string;
    deviceId?: string;
    customerId?: string;
    qrType: QRType;
    expiresInMinutes?: number;
    actor: EnrollmentActor;
    ipAddress?: string;
  }): Promise<EnrollmentToken> {
    const ttl = Math.min(params.expiresInMinutes || DEFAULT_TTL_MINUTES, MAX_TTL_MINUTES);
    const nowIso = new Date().toISOString();

    if (params.deviceId) {
      const device = await repo.devices.findById(params.deviceId);
      if (!device) throw AppError.notFound('Device');
      if (device.dealerId !== params.dealerId) {
        throw AppError.forbidden('You cannot generate an enrollment token for another dealer\'s device.');
      }
      if (device.status === 'ACTIVE' || device.status === 'LOCKED') {
        throw AppError.badRequest('This device is already enrolled and under management.');
      }
    }

    // Cryptographically random, not a truncated UUID plus a timestamp — the old
    // format leaked when the token was created and had far less entropy.
    const secret = crypto.randomBytes(24).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    const tokenStr = `EMIS-${params.qrType.substring(0, 3)}-${secret}`;

    const token = await runInTransaction(async (tx) => {
      // Only one live token per device — otherwise an old printed QR keeps
      // working. Retiring the old ones and issuing the new one in a single
      // transaction means there is never a moment with two valid QRs, nor one
      // with none at all.
      if (params.deviceId) {
        await repo.enrollmentTokens.updateMany(
          { deviceId: params.deviceId, status: 'WAITING', expiresAt: { gt: new Date() } },
          { status: 'EXPIRED' },
          tx
        );
      }

      const created = await repo.enrollmentTokens.create(
        {
          id: `tok-${uuidv4().substring(0, 8)}`,
          dealerId: params.dealerId,
          deviceId: params.deviceId,
          customerId: params.customerId,
          token: tokenStr,
          qrType: params.qrType,
          status: 'WAITING',
          expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
          createdAt: nowIso,
        },
        tx
      );

      await AuditService.log(
        {
          dealerId: params.dealerId,
          userId: params.actor.userId,
          actorName: params.actor.userName,
          actorRole: params.actor.userRole,
          action: 'ENROLLMENT_QR_GENERATED',
          targetType: 'ENROLLMENT_TOKEN',
          targetId: created.id,
          details: `Generated a ${params.qrType} enrollment QR for device ${params.deviceId || '(unassigned)'}, valid for ${ttl} minutes.`,
          ipAddress: params.ipAddress,
        },
        tx
      );

      return created;
    });

    return token;
  }

  /**
   * The QR a factory-reset handset scans during setup.
   *
   * This is Android's own provisioning format, not a shape of our choosing —
   * the setup wizard reads these exact `android.app.extra.PROVISIONING_*` keys,
   * downloads the DPC from `PACKAGE_DOWNLOAD_LOCATION`, verifies its signing
   * certificate against `SIGNATURE_CHECKSUM`, installs it as **device owner**,
   * and hands `ADMIN_EXTRAS_BUNDLE` to `EmiDeviceAdminReceiver`. The enrollment
   * code travels in that bundle, which is how the phone knows which device it
   * is without anybody typing anything.
   *
   * Device owner is the whole point. An app the customer merely installed can
   * be uninstalled the day a payment is missed; a device owner survives until a
   * factory reset, which provisioning is what blocks.
   *
   * `provisioningReady` is false when the APK URL or its checksum has not been
   * configured. The payload is still returned — a DPC already installed on the
   * handset can redeem it — but nothing will install the app for a phone that
   * does not have it, and the dashboard should say so rather than print a QR
   * that silently does nothing at setup.
   */
  public static async buildQrPayload(
    token: EnrollmentToken,
    tx?: Tx
  ): Promise<{ payload: string; imageDataUrl: string; provisioningReady: boolean; warning?: string }> {
    const dealer = await repo.dealers.findById(token.dealerId, tx);
    const dpc = config.dpc;

    const payload: Record<string, unknown> = {
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': dpc.adminComponent,
      'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': dpc.leaveSystemAppsEnabled,
      'android.app.extra.PROVISIONING_SKIP_ENCRYPTION': dpc.skipEncryption,
      'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
        // Read by EmiDeviceAdminReceiver.onProfileProvisioningComplete.
        enrollmentToken: token.token,
        serverUrl: dpc.serverUrl || `http://localhost:${config.port}/api/dpc`,
        dealerCode: dealer?.code ?? token.dealerId,
        qrType: token.qrType,
        expiresAt: token.expiresAt,
      },
    };

    if (dpc.apkUrl) {
      payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'] = dpc.apkUrl;
    }
    if (dpc.apkSignatureChecksum) {
      payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'] = dpc.apkSignatureChecksum;
    }

    const missing: string[] = [];
    if (!dpc.apkUrl) missing.push('DPC_APK_URL');
    if (!dpc.apkSignatureChecksum) missing.push('DPC_APK_SIGNATURE_CHECKSUM');
    if (!dpc.serverUrl) missing.push('DPC_SERVER_URL');

    const payloadString = JSON.stringify(payload);

    return {
      payload: payloadString,
      /**
       * The QR itself, rendered here rather than in the browser.
       *
       * A setup wizard scans this off a screen or a printed slip, so it has to
       * be a real code — the dashboard used to draw a QR-shaped icon, which
       * looks identical in a screenshot and provisions nothing.
       */
      imageDataUrl: await QRCode.toDataURL(payloadString, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512,
      }),
      provisioningReady: missing.length === 0,
      warning: missing.length
        ? `This QR cannot provision a factory-reset phone until ${missing.join(', ')} are configured on the server. ` +
          'A handset that already has the DPC installed can still redeem the code.'
        : undefined,
    };
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
    /** DPC build on the handset, recorded for support. */
    dpcVersion?: string;
    ipAddress?: string;
  }): Promise<{ success: boolean; device: Device; deviceToken: string; message: string }> {
    const tokenRecord = await repo.enrollmentTokens.findByToken(params.token);

    if (!tokenRecord) {
      throw AppError.badRequest('This enrollment code is not valid.');
    }

    if (tokenRecord.status === 'ENROLLED') {
      throw AppError.badRequest('This enrollment code has already been used. Please generate a new QR.');
    }

    if (tokenRecord.status === 'EXPIRED' || new Date(tokenRecord.expiresAt) < new Date()) {
      await repo.enrollmentTokens.update(tokenRecord.id, { status: 'EXPIRED' });
      throw AppError.badRequest('This enrollment code has expired. Please generate a new QR.');
    }

    // The token's own device binding always wins.
    let targetDeviceId = tokenRecord.deviceId;

    if (!targetDeviceId) {
      if (!params.deviceId) {
        throw AppError.badRequest('This enrollment code is not linked to a device, and no device was supplied.');
      }
      const candidate = await repo.devices.findById(params.deviceId);
      if (!candidate) throw AppError.notFound('Device');
      if (candidate.dealerId !== tokenRecord.dealerId) {
        throw AppError.forbidden('This enrollment code belongs to a different dealer.');
      }
      targetDeviceId = candidate.id;
    } else if (params.deviceId && params.deviceId !== targetDeviceId) {
      throw AppError.badRequest('This enrollment code was issued for a different device.');
    }

    const device = await repo.devices.findById(targetDeviceId);
    if (!device) throw AppError.notFound('Device');

    /**
     * Claim the token before doing the work.
     *
     * `updateMany` with the status in the filter is a compare-and-set: only one
     * of two concurrent redemptions of the same QR can move it out of its
     * current state, and the loser is told the code is already in use. The JSON
     * store had no way to express this.
     */
    const claimed = await repo.enrollmentTokens.updateMany(
      { id: tokenRecord.id, status: { in: ['WAITING', 'SCANNED'] } },
      { status: 'VERIFYING' }
    );
    if (claimed === 0) {
      throw AppError.conflict('This enrollment code is already being redeemed. Please generate a new QR.');
    }

    try {
      const result = await deviceManagementService.enrollDevice(device.id, tokenRecord.token, params.ipAddress);

      /**
       * Issue the handset its own credentials.
       *
       * Re-enrolling rotates the token, which is what makes a factory reset or
       * a handset swap safe: whatever the previous installation held stops
       * working the moment a new one completes.
       */
      const credentials = issueDeviceToken();
      await repo.devices.update(device.id, {
        authTokenHash: credentials.tokenHash,
        authTokenIssuedAt: new Date().toISOString(),
        dpcVersion: params.dpcVersion,
        updatedAt: new Date().toISOString(),
      });

      await repo.enrollmentTokens.update(tokenRecord.id, {
        status: 'ENROLLED',
        deviceId: device.id,
      });

      await AuditService.log({
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
        deviceToken: credentials.token,
        message: `${device.brand} ${device.model} was enrolled successfully and is now active.`,
      };
    } catch (err) {
      // Leave the token reusable so a transient failure does not burn the QR.
      await repo.enrollmentTokens.update(tokenRecord.id, { status: 'WAITING' });
      throw err;
    }
  }
}
