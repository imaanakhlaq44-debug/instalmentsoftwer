import crypto from 'crypto';

/**
 * Credentials the Device Policy Controller uses to authenticate.
 *
 * Deliberately NOT bcrypt, which the rest of the system uses for passwords.
 * bcrypt is slow on purpose, because a human-chosen password has little entropy
 * and must be expensive to guess. These tokens are 32 bytes from the system CSPRNG
 * — brute force is not a threat, and every phone in the fleet authenticates on
 * every check-in, so a deliberately slow hash would be a self-inflicted denial
 * of service. SHA-256 over a high-entropy secret is the right tool, and the
 * comparison below is still timing-safe.
 */

/** 32 bytes, URL-safe — survives being pasted into a QR payload or a header. */
const TOKEN_BYTES = 32;

export interface DeviceCredentials {
  /** Handed to the phone once, at the end of enrollment. Never stored. */
  token: string;
  /** What goes in the database. */
  tokenHash: string;
}

export function issueDeviceToken(): DeviceCredentials {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashDeviceToken(token) };
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hashes.
 *
 * The lookup itself is by hash, so this guards the final confirmation rather
 * than the search — but an equality check on a secret should not leak how much
 * of it matched, regardless.
 */
export function deviceTokenMatches(candidateHash: string, storedHash: string): boolean {
  if (candidateHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(storedHash));
}

/**
 * Parses an `Authorization: Device <deviceId>.<token>` header.
 *
 * The device id travels with the token so the lookup is a single indexed read
 * rather than a scan, and so a token presented for the wrong device is rejected
 * outright instead of silently authenticating a different handset.
 */
export function parseDeviceAuthorization(header: string | undefined): { deviceId: string; token: string } | null {
  if (!header || !header.startsWith('Device ')) return null;

  const credential = header.slice('Device '.length).trim();
  const separator = credential.indexOf('.');
  if (separator <= 0 || separator === credential.length - 1) return null;

  return {
    deviceId: credential.slice(0, separator),
    token: credential.slice(separator + 1),
  };
}
