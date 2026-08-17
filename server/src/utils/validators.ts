import { z } from 'zod';

/**
 * Pakistani CNIC: 13 digits, conventionally written 00000-0000000-0.
 * Masked forms produced by this system (35202-*******-1) are also accepted so
 * existing records round-trip without being rejected on update.
 */
export const cnicSchema = z
  .string()
  .trim()
  .refine(
    (v) => /^\d{5}-\d{7}-\d$/.test(v) || /^\d{13}$/.test(v) || /^\d{5}-\*{7}-\d$/.test(v),
    'CNIC must be in the format 35202-1234567-1 (13 digits).'
  );

/** Pakistani mobile: 03XX-XXXXXXX, +923XXXXXXXXX, or 03XXXXXXXXX. */
export const pakistaniPhoneSchema = z
  .string()
  .trim()
  .refine(
    (v) => /^03\d{2}-?\d{7}$/.test(v) || /^\+923\d{9}$/.test(v) || /^923\d{9}$/.test(v),
    'Phone must be a valid Pakistani mobile number, e.g. 0300-1234567.'
  );

/** Normalises any accepted phone format to 03XX-XXXXXXX for consistent storage. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('92') ? '0' + digits.slice(2) : digits;
  if (local.length !== 11) return raw.trim();
  return `${local.slice(0, 4)}-${local.slice(4)}`;
}

/**
 * IMEI is 15 digits whose final digit is a Luhn checksum. Validating it here
 * stops typo'd IMEIs from entering the system, where they would silently break
 * every future device command.
 */
export function isValidImei(imei: string): boolean {
  const digits = imei.replace(/\D/g, '');
  if (!/^\d{15}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[i]);
    // Double every second digit counting from the left (positions 1,3,5,...).
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const imeiSchema = z
  .string()
  .trim()
  .refine((v) => isValidImei(v), 'IMEI must be 15 digits with a valid checksum. Please re-check the number (dial *#06# on the phone).');

export const moneySchema = z
  .number({ message: 'Amount must be a number.' })
  .finite('Amount must be a valid number.')
  .nonnegative('Amount cannot be negative.')
  .max(100_000_000, 'Amount exceeds the maximum allowed value.');

/** A positive amount — used for payments, where zero makes no sense. */
export const positiveMoneySchema = moneySchema.refine((v) => v > 0, 'Amount must be greater than zero.');

export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Date is not a real calendar date.');

export const idSchema = z.string().trim().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Applies page/limit to an already-filtered array and returns a standard envelope. */
/**
 * Wraps a repository page in the response envelope the dashboard expects.
 *
 * The counterpart to `paginate` below, for data the database already sliced.
 * `data` is passed separately because routes enrich rows (joining a customer
 * name, masking PII) before serialising them.
 */
export function pageEnvelope<T>(
  data: T[],
  page: { total: number; page: number },
  limit: number
) {
  const totalPages = Math.max(1, Math.ceil(page.total / limit));
  return {
    data,
    pagination: {
      page: page.page,
      limit,
      total: page.total,
      totalPages,
      hasNextPage: page.page < totalPages,
      hasPreviousPage: page.page > 1,
    },
  };
}

export function paginate<T>(items: T[], { page, limit }: Pagination) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  return {
    data: items.slice(start, start + limit),
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1,
    },
  };
}
