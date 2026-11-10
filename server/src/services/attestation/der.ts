/**
 * A minimal, strict DER reader — just enough to walk an X.509 certificate and
 * the Android Key Attestation extension inside it.
 *
 * Node's `X509Certificate` verifies signatures but does not expose arbitrary
 * extensions, and the attestation record is a nested ASN.1 structure with
 * high-number context tags ([704], [714], …). Pulling in a full ASN.1 library
 * for that would be more surface than the job needs, so this reads exactly
 * what DER allows (definite lengths only) and throws on anything else.
 * Every read is bounds-checked: the input comes from a handset.
 */

export class DerError extends Error {}

export const DER_CLASS_UNIVERSAL = 0;
export const DER_CLASS_CONTEXT = 2;

export const DER_TAG = {
  BOOLEAN: 1,
  INTEGER: 2,
  OCTET_STRING: 4,
  OID: 6,
  ENUMERATED: 10,
  SEQUENCE: 16,
  SET: 17,
} as const;

export interface DerNode {
  /** 0 universal, 1 application, 2 context-specific, 3 private. */
  cls: number;
  constructed: boolean;
  tag: number;
  /** Offset of the identifier octet. */
  start: number;
  contentStart: number;
  /** Exclusive end of the content. */
  end: number;
  buf: Buffer;
}

const MAX_DEPTH_TAG = 0x0fffffff;

export function readNode(buf: Buffer, offset: number, limit: number = buf.length): DerNode {
  if (offset < 0 || offset >= limit) throw new DerError('Truncated DER: no identifier.');
  let i = offset;
  const first = buf[i++];
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;

  if (tag === 0x1f) {
    tag = 0;
    for (;;) {
      if (i >= limit) throw new DerError('Truncated DER: high tag number.');
      const b = buf[i++];
      tag = tag * 128 + (b & 0x7f);
      if (tag > MAX_DEPTH_TAG) throw new DerError('DER tag number too large.');
      if ((b & 0x80) === 0) break;
    }
  }

  if (i >= limit) throw new DerError('Truncated DER: no length.');
  const lenByte = buf[i++];
  let length: number;
  if (lenByte < 0x80) {
    length = lenByte;
  } else {
    const count = lenByte & 0x7f;
    if (count === 0) throw new DerError('Indefinite lengths are not DER.');
    if (count > 4) throw new DerError('DER length too large.');
    if (i + count > limit) throw new DerError('Truncated DER: length octets.');
    length = 0;
    for (let k = 0; k < count; k++) length = length * 256 + buf[i++];
  }

  const end = i + length;
  if (end > limit) throw new DerError('Truncated DER: content runs past its parent.');
  return { cls, constructed, tag, start: offset, contentStart: i, end, buf };
}

export function children(node: DerNode): DerNode[] {
  if (!node.constructed) throw new DerError('Expected a constructed DER element.');
  const out: DerNode[] = [];
  let pos = node.contentStart;
  while (pos < node.end) {
    const child = readNode(node.buf, pos, node.end);
    out.push(child);
    pos = child.end;
  }
  return out;
}

export function content(node: DerNode): Buffer {
  return node.buf.subarray(node.contentStart, node.end);
}

export function expectUniversal(node: DerNode | undefined, tag: number, what: string): DerNode {
  if (!node || node.cls !== DER_CLASS_UNIVERSAL || node.tag !== tag) {
    throw new DerError(`Expected ${what}.`);
  }
  return node;
}

/** Non-negative INTEGER / ENUMERATED small enough for a JS number. */
export function readSmallInt(node: DerNode): number {
  const bytes = content(node);
  if (bytes.length === 0 || bytes.length > 6) throw new DerError('Integer out of range.');
  if (bytes[0] & 0x80) throw new DerError('Negative integers are not expected here.');
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

export function readBoolean(node: DerNode): boolean {
  const bytes = content(node);
  if (bytes.length !== 1) throw new DerError('Malformed BOOLEAN.');
  return bytes[0] !== 0;
}

export function decodeOid(node: DerNode): string {
  const bytes = content(node);
  if (bytes.length === 0) throw new DerError('Empty OID.');
  const parts: number[] = [];
  let value = 0;
  for (let k = 0; k < bytes.length; k++) {
    value = value * 128 + (bytes[k] & 0x7f);
    if ((bytes[k] & 0x80) === 0) {
      if (parts.length === 0) {
        const first = value < 80 ? Math.floor(value / 40) : 2;
        parts.push(first, value - first * 40);
      } else {
        parts.push(value);
      }
      value = 0;
    }
  }
  return parts.join('.');
}

/**
 * The raw value of an X.509 v3 extension, or undefined when the certificate
 * does not carry it.
 */
export function findCertificateExtension(certDer: Buffer, oid: string): Buffer | undefined {
  const cert = expectUniversal(readNode(certDer, 0), DER_TAG.SEQUENCE, 'Certificate');
  const tbs = expectUniversal(children(cert)[0], DER_TAG.SEQUENCE, 'TBSCertificate');

  for (const field of children(tbs)) {
    if (field.cls !== DER_CLASS_CONTEXT || field.tag !== 3) continue;
    const extensions = expectUniversal(children(field)[0], DER_TAG.SEQUENCE, 'Extensions');
    for (const ext of children(extensions)) {
      const parts = children(ext);
      const id = expectUniversal(parts[0], DER_TAG.OID, 'extension OID');
      if (decodeOid(id) !== oid) continue;
      const value = expectUniversal(parts[parts.length - 1], DER_TAG.OCTET_STRING, 'extension value');
      return content(value);
    }
  }
  return undefined;
}
