import crypto, { KeyObject, X509Certificate } from 'crypto';

import {
  children,
  content,
  DER_CLASS_CONTEXT,
  DER_TAG,
  DerError,
  DerNode,
  expectUniversal,
  findCertificateExtension,
  readBoolean,
  readNode,
  readSmallInt,
} from './der.js';
import { GOOGLE_ATTESTATION_ROOTS_PEM } from './googleRoots.js';
import { AttestationRevocationList } from './RevocationList.js';

/**
 * Android hardware Key Attestation.
 *
 * The handset asks its secure chip (TEE or StrongBox) to make a key and sign a
 * certificate for it. That certificate carries a record the chip wrote: our
 * challenge, the bootloader lock state, and — when the Device Owner asks for
 * ID attestation — the IMEI and serial that were burned into the chip at the
 * factory. Rewriting the modem's IMEI with a box tool does not change those,
 * and a rooted phone cannot forge the record without the chip's private key,
 * which chains up to Google's root.
 *
 * So a VERIFIED result here is the strongest statement this system can make
 * about which physical phone it is talking to.
 *
 * Reference: https://source.android.com/docs/security/features/keystore/attestation
 */

export const KEY_ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';

/** Prefix for the enrollment challenge; the DPC derives the same bytes. */
export const ENROLL_CHALLENGE_PREFIX = 'almas-sdm/enroll-attestation/v1:';

export type AttestationStatus =
  /** Chain verifies to Google, challenge matches, record is from TEE/StrongBox. */
  | 'VERIFIED'
  /** Malformed or forged: a signature in the chain does not verify, or the record is broken. */
  | 'INVALID'
  /** Well-formed, but does not end at a Google root (non-GMS phone, or self-made chain). */
  | 'UNTRUSTED_ROOT'
  /** A certificate in the chain is on Google's revocation list (typically a leaked keybox). */
  | 'REVOKED'
  /** Genuine-looking, but signed over a challenge other than the one we issued. */
  | 'CHALLENGE_MISMATCH'
  /** Only software-backed attestation; says nothing about the hardware. */
  | 'SOFTWARE_ONLY'
  /** The handset could not produce an attestation at all. */
  | 'UNAVAILABLE';

export type SecurityLevel = 'SOFTWARE' | 'TEE' | 'STRONGBOX';
export type VerifiedBootState = 'VERIFIED' | 'SELF_SIGNED' | 'UNVERIFIED' | 'FAILED';

export interface AttestationPayload {
  /** Base64 DER certificates, leaf first. */
  chain?: string[];
  /** Whether the handset managed to include device IDs (IMEI/serial). */
  idsAttested?: boolean;
  /** Why the handset could not attest, when it could not. */
  error?: string;
}

export interface AttestationResult {
  status: AttestationStatus;
  reason?: string;
  securityLevel?: SecurityLevel;
  /** IMEIs from the hardware-enforced list (slot 1 and, on Android 14+, slot 2). */
  imeis: string[];
  serial?: string;
  brand?: string;
  model?: string;
  deviceLocked?: boolean;
  verifiedBootState?: VerifiedBootState;
}

interface AuthorizationList {
  deviceLocked?: boolean;
  verifiedBootState?: VerifiedBootState;
  brand?: string;
  serial?: string;
  imei?: string;
  secondImei?: string;
  model?: string;
}

// AuthorizationList tags (KeyMint Tag numbers, low 28 bits).
const TAG_ROOT_OF_TRUST = 704;
const TAG_ID_BRAND = 710;
const TAG_ID_SERIAL = 713;
const TAG_ID_IMEI = 714;
const TAG_ID_MODEL = 717;
const TAG_ID_SECOND_IMEI = 723;

const BOOT_STATES: VerifiedBootState[] = ['VERIFIED', 'SELF_SIGNED', 'UNVERIFIED', 'FAILED'];
const SECURITY_LEVELS: SecurityLevel[] = ['SOFTWARE', 'TEE', 'STRONGBOX'];

const MAX_CHAIN = 8;
const MAX_CERT_BYTES = 16 * 1024;

// ---------------------------------------------------------------------------
// Trust anchors
// ---------------------------------------------------------------------------

function spkiFingerprint(key: KeyObject): string {
  return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

const googleRootKeys: KeyObject[] = GOOGLE_ATTESTATION_ROOTS_PEM.map((pem) => new X509Certificate(pem).publicKey);
let extraTestRoots: KeyObject[] = [];

/** Lets the test suite sign its own chains. Ignored outside NODE_ENV=test. */
export function setExtraTrustedRootsForTesting(pemsOrKeys: (string | KeyObject)[]): void {
  if (process.env.NODE_ENV !== 'test') return;
  extraTestRoots = pemsOrKeys.map((k) => (typeof k === 'string' ? crypto.createPublicKey(k) : k));
}

function trustedRoots(): KeyObject[] {
  return [...googleRootKeys, ...extraTestRoots];
}

// ---------------------------------------------------------------------------
// Parsing the attestation record
// ---------------------------------------------------------------------------

function utf8(node: DerNode): string | undefined {
  const value = content(expectUniversal(node, DER_TAG.OCTET_STRING, 'ID OCTET STRING')).toString('utf8').trim();
  return value.length > 0 ? value : undefined;
}

function parseAuthorizationList(node: DerNode): AuthorizationList {
  expectUniversal(node, DER_TAG.SEQUENCE, 'AuthorizationList');
  const out: AuthorizationList = {};

  for (const entry of children(node)) {
    if (entry.cls !== DER_CLASS_CONTEXT || !entry.constructed) continue;
    const inner = children(entry)[0];
    if (!inner) continue;

    switch (entry.tag) {
      case TAG_ROOT_OF_TRUST: {
        const rot = children(expectUniversal(inner, DER_TAG.SEQUENCE, 'RootOfTrust'));
        out.deviceLocked = readBoolean(expectUniversal(rot[1], DER_TAG.BOOLEAN, 'deviceLocked'));
        const state = readSmallInt(expectUniversal(rot[2], DER_TAG.ENUMERATED, 'verifiedBootState'));
        out.verifiedBootState = BOOT_STATES[state] ?? 'FAILED';
        break;
      }
      case TAG_ID_BRAND:
        out.brand = utf8(inner);
        break;
      case TAG_ID_SERIAL:
        out.serial = utf8(inner);
        break;
      case TAG_ID_IMEI:
        out.imei = utf8(inner);
        break;
      case TAG_ID_SECOND_IMEI:
        out.secondImei = utf8(inner);
        break;
      case TAG_ID_MODEL:
        out.model = utf8(inner);
        break;
      default:
        break;
    }
  }
  return out;
}

interface KeyDescription {
  attestationSecurityLevel: SecurityLevel;
  challenge: Buffer;
  hardwareEnforced: AuthorizationList;
}

export function parseKeyDescription(extensionValue: Buffer): KeyDescription {
  const root = expectUniversal(readNode(extensionValue, 0), DER_TAG.SEQUENCE, 'KeyDescription');
  const f = children(root);
  if (f.length < 8) throw new DerError('KeyDescription is missing fields.');

  const level = readSmallInt(expectUniversal(f[1], DER_TAG.ENUMERATED, 'attestationSecurityLevel'));
  return {
    attestationSecurityLevel: SECURITY_LEVELS[level] ?? 'SOFTWARE',
    challenge: Buffer.from(content(expectUniversal(f[4], DER_TAG.OCTET_STRING, 'attestationChallenge'))),
    hardwareEnforced: parseAuthorizationList(f[7]),
  };
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

function normalizeSerial(hex: string): string {
  return hex.toLowerCase().replace(/^0+(?=.)/, '');
}

function decodeChain(chain: string[]): { ders: Buffer[]; certs: X509Certificate[] } {
  if (chain.length < 2 || chain.length > MAX_CHAIN) throw new DerError('Unexpected chain length.');
  const ders = chain.map((b64) => {
    const der = Buffer.from(b64, 'base64');
    if (der.length === 0 || der.length > MAX_CERT_BYTES) throw new DerError('Certificate size out of range.');
    return der;
  });
  return { ders, certs: ders.map((d) => new X509Certificate(d)) };
}

function withinValidity(cert: X509Certificate, now: Date): boolean {
  const from = new Date(cert.validFrom).getTime();
  const to = new Date(cert.validTo).getTime();
  const t = now.getTime();
  return Number.isFinite(from) && Number.isFinite(to) && t >= from && t <= to;
}

function unavailable(reason: string): AttestationResult {
  return { status: 'UNAVAILABLE', reason, imeis: [] };
}

/**
 * Verifies a handset's attestation chain and reads the hardware record.
 *
 * Nothing in the result is trusted unless `status === 'VERIFIED'`.
 */
export async function verifyKeyAttestation(
  payload: AttestationPayload | undefined,
  expectedChallenge: Buffer | undefined,
  now: Date = new Date()
): Promise<AttestationResult | undefined> {
  if (!payload) return undefined;
  const chain = payload.chain ?? [];
  if (chain.length === 0) {
    return unavailable(payload.error?.slice(0, 200) || 'The handset did not return an attestation.');
  }

  let ders: Buffer[];
  let certs: X509Certificate[];
  try {
    ({ ders, certs } = decodeChain(chain));
  } catch (e) {
    return { status: 'INVALID', reason: `Unreadable certificate chain (${(e as Error).message}).`, imeis: [] };
  }

  // 1. Every link signed by the next one.
  for (let i = 0; i < certs.length - 1; i++) {
    let ok = false;
    try {
      ok = certs[i].verify(certs[i + 1].publicKey);
    } catch {
      ok = false;
    }
    if (!ok) {
      return { status: 'INVALID', reason: `Certificate ${i} is not signed by certificate ${i + 1}.`, imeis: [] };
    }
    // The leaf's dates are set by the handset's keystore and are often
    // nonsense (1970–2048); the issuing certificates' are not.
    if (i + 1 < certs.length - 1 && !withinValidity(certs[i + 1], now)) {
      return { status: 'INVALID', reason: `Certificate ${i + 1} is outside its validity period.`, imeis: [] };
    }
  }

  // 2. Only the leaf may carry an attestation record. A record further up
  //    means someone used an attested key to sign a forged leaf.
  for (let i = 1; i < ders.length; i++) {
    try {
      if (findCertificateExtension(ders[i], KEY_ATTESTATION_OID)) {
        return { status: 'INVALID', reason: 'Attestation record found above the leaf certificate.', imeis: [] };
      }
    } catch {
      return { status: 'INVALID', reason: `Certificate ${i} could not be parsed.`, imeis: [] };
    }
  }

  // 3. Revocation (leaked keyboxes end up here).
  const revoked = await AttestationRevocationList.revokedSerials();
  if (revoked) {
    for (const cert of certs) {
      if (revoked.has(normalizeSerial(cert.serialNumber))) {
        return { status: 'REVOKED', reason: 'A certificate in the chain has been revoked by Google.', imeis: [] };
      }
    }
  }

  // 4. Anchored at Google.
  const top = certs[certs.length - 1];
  const roots = trustedRoots();
  const topFingerprint = spkiFingerprint(top.publicKey);
  const anchored = roots.some((root) => {
    if (spkiFingerprint(root) === topFingerprint) return true;
    try {
      return top.verify(root);
    } catch {
      return false;
    }
  });
  if (!anchored) {
    return { status: 'UNTRUSTED_ROOT', reason: 'The chain does not end at a Google attestation root.', imeis: [] };
  }

  // 5. The record itself.
  let description: KeyDescription;
  try {
    const ext = findCertificateExtension(ders[0], KEY_ATTESTATION_OID);
    if (!ext) return { status: 'INVALID', reason: 'Leaf certificate has no attestation record.', imeis: [] };
    description = parseKeyDescription(ext);
  } catch (e) {
    return { status: 'INVALID', reason: `Malformed attestation record (${(e as Error).message}).`, imeis: [] };
  }

  if (
    !expectedChallenge ||
    description.challenge.length !== expectedChallenge.length ||
    !crypto.timingSafeEqual(description.challenge, expectedChallenge)
  ) {
    return { status: 'CHALLENGE_MISMATCH', reason: 'Attestation was made for a different challenge.', imeis: [] };
  }

  if (description.attestationSecurityLevel === 'SOFTWARE') {
    return { status: 'SOFTWARE_ONLY', securityLevel: 'SOFTWARE', reason: 'Attestation is not hardware-backed.', imeis: [] };
  }

  const hw = description.hardwareEnforced;
  const imeis = [...new Set([hw.imei, hw.secondImei].filter((v): v is string => !!v && /^\d{14,16}$/.test(v)))];

  return {
    status: 'VERIFIED',
    securityLevel: description.attestationSecurityLevel,
    imeis,
    serial: hw.serial,
    brand: hw.brand,
    model: hw.model,
    deviceLocked: hw.deviceLocked,
    verifiedBootState: hw.verifiedBootState,
  };
}

/** The challenge a handset signs over when it enrolls: bound to the single-use token. */
export function enrollmentChallenge(token: string): Buffer {
  return crypto.createHash('sha256').update(ENROLL_CHALLENGE_PREFIX + token, 'utf8').digest();
}

export function newCheckInChallenge(): string {
  return crypto.randomBytes(32).toString('base64url');
}
