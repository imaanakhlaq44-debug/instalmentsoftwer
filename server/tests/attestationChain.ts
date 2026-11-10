/**
 * Builds Android-Key-Attestation-shaped certificate chains for the tests.
 *
 * A real chain is signed by a phone's secure chip and ends at Google's root,
 * which a test cannot produce. This writes the same DER structures — X.509 v3
 * certificates and the KeyDescription extension — signed by a throwaway test
 * root that the verifier is told to trust (`setExtraTrustedRootsForTesting`).
 */
import crypto, { KeyObject } from 'crypto';

// --- DER encoding ----------------------------------------------------------

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number | Buffer, body: Buffer): Buffer {
  const t = typeof tag === 'number' ? Buffer.from([tag]) : tag;
  return Buffer.concat([t, len(body.length), body]);
}

const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const octet = (b: Buffer | string) => tlv(0x04, Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8'));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));

function intBytes(n: number | Buffer): Buffer {
  let b: Buffer;
  if (Buffer.isBuffer(n)) {
    b = n;
  } else {
    const bytes: number[] = [];
    let v = n;
    do {
      bytes.unshift(v & 0xff);
      v = Math.floor(v / 256);
    } while (v > 0);
    b = Buffer.from(bytes);
  }
  return b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b;
}
const int = (n: number | Buffer) => tlv(0x02, intBytes(n));
const enumerated = (n: number) => tlv(0x0a, intBytes(n));

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    let v = Math.floor(p / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** [n] EXPLICIT, context-specific constructed, high-tag form when n > 30. */
function explicit(n: number, inner: Buffer): Buffer {
  if (n <= 30) return tlv(0xa0 | n, inner);
  const digits: number[] = [n & 0x7f];
  let v = Math.floor(n / 128);
  while (v > 0) {
    digits.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return tlv(Buffer.from([0xbf, ...digits]), inner);
}

function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2), 'ascii')) : tlv(0x18, Buffer.from(iso, 'ascii'));
}

const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

interface CertSpec {
  serial: number;
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  signingKey: KeyObject;
  notBefore: Date;
  notAfter: Date;
  ca?: boolean;
  extraExtensions?: Buffer[];
}

function certificate(spec: CertSpec): Buffer {
  const extensions: Buffer[] = [];
  if (spec.ca) extensions.push(seq(oid('2.5.29.19'), bool(true), octet(seq(bool(true)))));
  extensions.push(...(spec.extraExtensions ?? []));

  const tbs = seq(
    explicit(0, int(2)),
    int(spec.serial),
    ECDSA_SHA256,
    name(spec.issuer),
    seq(time(spec.notBefore), time(spec.notAfter)),
    name(spec.subject),
    spec.publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions))
  );
  const signature = crypto.sign('sha256', tbs, spec.signingKey);
  return seq(tbs, ECDSA_SHA256, bitString(signature));
}

// --- Attestation record ----------------------------------------------------

export interface AttestationSpec {
  challenge: Buffer;
  imei?: string;
  secondImei?: string;
  serial?: string;
  brand?: string;
  model?: string;
  deviceLocked?: boolean;
  /** 0 Verified, 1 SelfSigned, 2 Unverified, 3 Failed. */
  bootState?: number;
  /** 0 Software, 1 TEE, 2 StrongBox. */
  securityLevel?: number;
  /** Put an attestation record on the intermediate too (the forged-leaf attack). */
  recordOnIntermediate?: boolean;
  /** Corrupt the leaf's signature. */
  breakLeafSignature?: boolean;
  /** Sign with a root the verifier does not trust. */
  untrustedRoot?: boolean;
}

function keyDescription(spec: AttestationSpec): Buffer {
  const hw: Buffer[] = [
    explicit(
      704,
      seq(octet(crypto.randomBytes(32)), bool(spec.deviceLocked ?? true), enumerated(spec.bootState ?? 0), octet(crypto.randomBytes(32)))
    ),
  ];
  if (spec.brand) hw.push(explicit(710, octet(spec.brand)));
  if (spec.serial) hw.push(explicit(713, octet(spec.serial)));
  if (spec.imei) hw.push(explicit(714, octet(spec.imei)));
  if (spec.model) hw.push(explicit(717, octet(spec.model)));
  if (spec.secondImei) hw.push(explicit(723, octet(spec.secondImei)));

  const level = spec.securityLevel ?? 1;
  return seq(int(300), enumerated(level), int(300), enumerated(level), octet(spec.challenge), octet(Buffer.alloc(0)), seq(), seq(...hw));
}

const attestationExtension = (spec: AttestationSpec) =>
  seq(oid('1.3.6.1.4.1.11129.2.1.17'), octet(keyDescription(spec)));

function ecKeys() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

export const testRoot = ecKeys();
const otherRoot = ecKeys();

export const INTERMEDIATE_SERIAL = 0x5eed;

export function buildAttestationChain(spec: AttestationSpec): string[] {
  const now = Date.now();
  const root = spec.untrustedRoot ? otherRoot : testRoot;
  const intermediate = ecKeys();
  const leaf = ecKeys();

  const rootCert = certificate({
    serial: 1,
    subject: 'Test Attestation Root',
    issuer: 'Test Attestation Root',
    publicKey: root.publicKey,
    signingKey: root.privateKey,
    notBefore: new Date(now - 86_400_000),
    notAfter: new Date(now + 10 * 365 * 86_400_000),
    ca: true,
  });
  const intermediateCert = certificate({
    serial: INTERMEDIATE_SERIAL,
    subject: 'Test Attestation Intermediate',
    issuer: 'Test Attestation Root',
    publicKey: intermediate.publicKey,
    signingKey: root.privateKey,
    notBefore: new Date(now - 86_400_000),
    notAfter: new Date(now + 5 * 365 * 86_400_000),
    ca: true,
    extraExtensions: spec.recordOnIntermediate ? [attestationExtension(spec)] : [],
  });
  let leafCert = certificate({
    serial: 1,
    subject: 'Android Keystore Key',
    issuer: 'Test Attestation Intermediate',
    publicKey: leaf.publicKey,
    signingKey: intermediate.privateKey,
    // What keystore actually writes.
    notBefore: new Date(0),
    notAfter: new Date(Date.UTC(2048, 0, 1)),
    extraExtensions: [attestationExtension(spec)],
  });
  if (spec.breakLeafSignature) {
    leafCert = Buffer.from(leafCert);
    leafCert[leafCert.length - 3] ^= 0xff;
  }

  return [leafCert, intermediateCert, rootCert].map((c) => c.toString('base64'));
}
