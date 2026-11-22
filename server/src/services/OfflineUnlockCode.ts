import crypto from 'crypto';

import { repo } from '../db/repositories/index.js';
import { DeviceStatus, UserRole } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';
import { AuditService } from './AuditService.js';

/**
 * A code that lifts a restriction on a handset that cannot reach the server.
 *
 * A locked phone with no working internet connection cannot hear an unlock
 * command. If the customer pays at the counter, the shop needs another way to
 * open it. The lock screen shows an 8-digit "phone code" (a random challenge
 * the handset makes and keeps). The shop types it into the dashboard, which
 * answers with an 8-digit unlock code. The customer types that into the phone.
 *
 * The answer is an HMAC over the device id and the challenge. Its key is the
 * SHA-256 of the handset's own credential: the phone holds the credential and
 * the server holds exactly that hash, so both sides can compute the code
 * without the credential ever being stored on the server or sent again.
 *
 * The handset makes a new challenge after every successful unlock, so a code
 * works only once. It also limits wrong attempts. The Kotlin side is
 * `pk.almassdm.dpc.admin.OfflineUnlock`; both are tested against the same
 * fixed vector.
 */

export const OFFLINE_UNLOCK_DOMAIN = 'almas-offline-unlock-v1';
const CHALLENGE_DIGITS = 8;
const CODE_DIGITS = 8;

/** Statuses in which the server itself wants the phone held. Unlock in the dashboard first. */
const HELD_STATUSES = new Set<DeviceStatus>(['LOCKED', 'LOCK_PENDING']);
/** Statuses with no live handset to unlock. */
const UNMANAGED_STATUSES = new Set<DeviceStatus>(['PENDING', 'INACTIVE', 'REMOVED']);

/** Strips spaces and dashes; returns null unless exactly eight digits remain. */
export function normaliseChallenge(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CHALLENGE_DIGITS}}$`).test(digits) ? digits : null;
}

/**
 * The unlock code for one challenge.
 *
 * `tokenHash` is the lowercase hex SHA-256 of the device credential, used as
 * UTF-8 key bytes. Truncation is the HOTP one (RFC 4226 §5.3) over HMAC-SHA256.
 */
export function offlineUnlockCode(tokenHash: string, deviceId: string, challenge: string): string {
  const mac = crypto
    .createHmac('sha256', Buffer.from(tokenHash, 'utf8'))
    .update(`${OFFLINE_UNLOCK_DOMAIN}|${deviceId}|${challenge}`, 'utf8')
    .digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
}

export class OfflineUnlockService {
  /** Issues a code for a device the caller has already been checked against. */
  public static async issue(params: {
    deviceId: string;
    challenge: string;
    userId: string;
    userName: string;
    userRole: UserRole;
    ipAddress?: string;
  }): Promise<{ code: string }> {
    const challenge = normaliseChallenge(params.challenge);
    if (!challenge) {
      throw AppError.badRequest('The phone code is the 8 digits shown on the locked phone.');
    }

    const device = await repo.devices.findById(params.deviceId);
    if (!device) throw AppError.notFound('Device');

    if (UNMANAGED_STATUSES.has(device.status) || !device.authTokenHash) {
      throw AppError.badRequest('This phone is not registered with the lock app, so it has nothing to unlock.');
    }
    if (HELD_STATUSES.has(device.status)) {
      throw AppError.conflict(
        'This phone is still locked in the dashboard. Record the payment and unlock it first, then make the code.'
      );
    }

    const code = offlineUnlockCode(device.authTokenHash, device.id, challenge);

    await AuditService.log({
      dealerId: device.dealerId,
      userId: params.userId,
      actorName: params.userName,
      actorRole: params.userRole,
      action: 'DEVICE_UNLOCKED',
      targetType: 'DEVICE',
      targetId: device.id,
      details:
        `Offline unlock code issued for ${device.brand} ${device.model} (IMEI ${maskImei(device.imei)}). ` +
        'The phone opens once the customer types it in.',
      ipAddress: params.ipAddress,
    });

    return { code };
  }
}
