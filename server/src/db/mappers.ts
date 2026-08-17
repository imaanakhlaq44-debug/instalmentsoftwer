/**
 * Translation between Prisma rows and the domain types in `src/types`.
 *
 * Two differences, and only two, separate the two shapes:
 *
 *   1. Prisma returns `Date`; the domain uses strings — an ISO timestamp for
 *      `timestamptz` columns and a plain `YYYY-MM-DD` for `date` columns.
 *   2. Prisma returns `null` for an absent value; the domain uses `undefined`,
 *      and the JSON store never serialised the key at all.
 *
 * Field names are identical on both sides, so this is done generically rather
 * than with fifteen hand-written mappers — one conversion rule that cannot
 * drift out of step with the schema, instead of fifteen that can.
 */

/**
 * Columns declared `@db.Date` in schema.prisma. Prisma hands these back as a
 * `Date` at UTC midnight; the domain wants the calendar date alone, with no
 * timezone attached to shift it across a day boundary.
 */
const DATE_ONLY_FIELDS = new Set([
  'dueDate',
  'graceDate',
  'lateFeeAccruedThrough',
  'firstDueDate',
  'expiryDate',
]);

export function toIso(value: Date): string {
  return value.toISOString();
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → a `Date` at UTC midnight, which is what a `date` column stores. */
export function fromDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

/**
 * Converts one Prisma row into its domain object.
 *
 * `null` fields are deleted rather than set to `undefined`, so a serialised
 * response carries no `"lockReason": null` noise and deep-equality against a
 * literal still holds.
 */
export function toDomain<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;

    if (value instanceof Date) {
      out[key] = DATE_ONLY_FIELDS.has(key) ? toDateOnly(value) : toIso(value);
      continue;
    }

    out[key] = value;
  }

  return out as T;
}

export function toDomainList<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => toDomain<T>(row));
}

/** `toDomain` for a lookup that may miss. */
export function toDomainOrUndefined<T>(row: Record<string, unknown> | null): T | undefined {
  return row ? toDomain<T>(row) : undefined;
}

/**
 * Converts a domain object (or a partial update) into Prisma input.
 *
 * A key set to `undefined` means "clear this column" throughout the codebase —
 * the JSON store implemented that by deleting the key. Prisma needs an explicit
 * `null`, so the caller passes `nullable` to say which keys may be cleared;
 * anything else that is `undefined` is simply left untouched.
 */
export function toRow(
  input: Record<string, unknown>,
  options: { nullable?: readonly string[] } = {}
): Record<string, unknown> {
  const nullable = new Set(options.nullable ?? []);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      if (nullable.has(key)) out[key] = null;
      continue;
    }

    if (typeof value === 'string' && DATE_ONLY_FIELDS.has(key)) {
      out[key] = fromDateOnly(value);
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Explicit-clear conversion for a `Partial<T>` update.
 *
 * `db.update(..., { paidAt: undefined })` used to erase the field. Repository
 * update methods route their input through this with the keys the caller
 * actually passed, so an omitted key stays untouched while a key present with
 * `undefined` becomes `NULL`.
 */
export function toUpdate<T extends object>(updates: Partial<T>): Record<string, unknown> {
  // Object.keys includes keys explicitly set to undefined, which is exactly the
  // "clear this" signal — so every key present is nullable by definition.
  return toRow(updates as Record<string, unknown>, { nullable: Object.keys(updates) });
}
