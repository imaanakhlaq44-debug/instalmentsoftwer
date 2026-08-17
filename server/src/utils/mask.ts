import { UserRole } from '../types/index.js';

/**
 * PII redaction helpers.
 *
 * The rule enforced across the API: a raw IMEI, CNIC or full address is only
 * ever serialised for a role that genuinely needs it. Everyone else — including
 * dealer staff on list screens — receives a masked string, and the raw field is
 * REMOVED from the payload rather than merely shadowed by a masked twin.
 */

/** Roles allowed to see a full, unmasked IMEI (needed for warranty/PTA claims). */
const IMEI_FULL_ACCESS: UserRole[] = ['SUPER_ADMIN', 'DEALER_ADMIN'];

/** Roles allowed to see a full CNIC (needed for KYC / contract paperwork). */
const CNIC_FULL_ACCESS: UserRole[] = ['SUPER_ADMIN', 'DEALER_ADMIN'];

export function maskImei(imei: string | undefined): string {
  if (!imei) return 'N/A';
  const digits = String(imei);
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskCnic(cnic: string | undefined): string {
  if (!cnic) return 'N/A';
  const raw = String(cnic).trim();

  // Already masked by an earlier version of the system.
  if (raw.includes('*')) return raw;

  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 13) return '*****-*******-*';
  return `${digits.slice(0, 5)}-*******-${digits.slice(-1)}`;
}

export function maskPhone(phone: string | undefined): string {
  if (!phone) return 'N/A';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${digits.slice(0, 4)}-***${digits.slice(-2)}`;
}

/** Keeps only the city-level tail of an address for low-privilege viewers. */
export function maskAddress(address: string | undefined): string {
  if (!address) return 'N/A';
  const parts = String(address).split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? `••••, ${parts[parts.length - 1]}` : '••••';
}

export interface ImeiView {
  imei?: string;
  maskedImei: string;
  imeiMasked: boolean;
}

/**
 * Produces the IMEI fields for a response. When the role is not permitted,
 * `imei` is `undefined` so the caller can spread it and the raw value simply
 * does not appear in the JSON.
 */
export function imeiView(imei: string | undefined, role: UserRole): ImeiView {
  const allowed = IMEI_FULL_ACCESS.includes(role);
  return {
    imei: allowed ? imei : undefined,
    maskedImei: maskImei(imei),
    imeiMasked: !allowed,
  };
}

export function cnicView(cnic: string | undefined, role: UserRole): { cnic: string; cnicMasked: boolean } {
  const allowed = CNIC_FULL_ACCESS.includes(role);
  return {
    cnic: allowed ? (cnic || 'N/A') : maskCnic(cnic),
    cnicMasked: !allowed,
  };
}

/**
 * Returns a device object safe to send to `role`, with the raw IMEI and serial
 * number stripped unless the role is permitted to see them.
 */
export function sanitizeDevice<
  T extends { imei?: string; serialNumber?: string; authTokenHash?: string }
>(
  device: T,
  role: UserRole
): Omit<T, 'imei' | 'serialNumber' | 'authTokenHash'> & ImeiView & { serialNumber?: string } {
  // `authTokenHash` is destructured out and never re-added. It is the handset's
  // credential: no role has a reason to see it, and it would otherwise ride
  // along in `rest` on every device response in the system.
  const { imei, serialNumber, authTokenHash: _authTokenHash, ...rest } = device;
  const view = imeiView(imei, role);
  const allowed = IMEI_FULL_ACCESS.includes(role);

  return {
    ...rest,
    ...view,
    serialNumber: allowed ? serialNumber : undefined,
  };
}

/**
 * Returns a customer object safe to send to `role`. Customers viewing their own
 * record keep their full details; everyone below dealer-admin gets masked PII.
 */
export function sanitizeCustomer<T extends { id?: string; cnic?: string; address?: string; phone?: string; emergencyContactPhone?: string }>(
  customer: T,
  role: UserRole,
  viewerCustomerId?: string
): T {
  const isSelf = role === 'CUSTOMER' && viewerCustomerId !== undefined && customer.id === viewerCustomerId;
  if (isSelf || CNIC_FULL_ACCESS.includes(role)) {
    return { ...customer, cnic: customer.cnic ? maskCnicForNonAdmin(customer.cnic, role) : customer.cnic };
  }

  return {
    ...customer,
    cnic: maskCnic(customer.cnic),
    address: maskAddress(customer.address),
    phone: maskPhone(customer.phone),
    emergencyContactPhone: maskPhone(customer.emergencyContactPhone),
  };
}

function maskCnicForNonAdmin(cnic: string, role: UserRole): string {
  return CNIC_FULL_ACCESS.includes(role) ? cnic : maskCnic(cnic);
}
