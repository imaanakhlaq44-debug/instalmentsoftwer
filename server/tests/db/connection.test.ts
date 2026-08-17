import { describe, it, expect, afterAll } from 'vitest';

import { prisma, disconnectDatabase } from '../../src/db/prisma.js';

afterAll(async () => {
  await disconnectDatabase();
});

describe('test database', () => {
  it('is reachable over the Postgres wire protocol', async () => {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows[0].one).toBe(1);
  });

  it('has the migrated schema', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `;
    const names = tables.map((t) => t.table_name);

    expect(names).toContain('customers');
    expect(names).toContain('installments');
    expect(names).toContain('payments');
    expect(names).toContain('devices');
  });

  it('is UTF8, so Urdu customer names survive', async () => {
    const [{ encoding }] = await prisma.$queryRaw<{ encoding: string }[]>`
      SELECT pg_encoding_to_char(encoding) AS encoding
      FROM pg_database WHERE datname = current_database()
    `;
    expect(encoding).toBe('UTF8');
  });

  it('round-trips an Urdu name unchanged', async () => {
    const name = 'محمد علی';
    const [{ echoed }] = await prisma.$queryRaw<{ echoed: string }[]>`
      SELECT ${name}::text AS echoed
    `;
    expect(echoed).toBe(name);
  });

  it('enforces the unique payment reference per dealer', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'payments'
    `;
    expect(indexes.some((i) => /reference/.test(i.indexname))).toBe(true);
  });
});
