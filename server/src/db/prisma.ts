import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';

/**
 * The single PrismaClient for the process.
 *
 * `tsx watch` reloads modules on every save; without caching the instance on
 * globalThis each reload would open a fresh connection pool and the database
 * would run out of connections within a few edits.
 */
const globalForPrisma = globalThis as unknown as { __emiPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = config.databaseUrl;

  const adapter = new PrismaPg({
    connectionString,
    /**
     * Pool size.
     *
     * The local PGlite dev server speaks the Postgres wire protocol over a
     * single socket and serves one connection at a time — a larger pool makes
     * Prisma open a second connection mid-query and the first one is dropped
     * ("Server has closed the connection"). Real PostgreSQL has no such limit,
     * so production gets a normal pool.
     */
    max: config.dbPoolMax,
  });

  return new PrismaClient({
    adapter,
    log: config.isProduction
      ? [{ emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
  });
}

export const prisma: PrismaClient = globalForPrisma.__emiPrisma ?? createClient();

if (!config.isProduction) {
  globalForPrisma.__emiPrisma = prisma;
}

// Surface database problems in the server log rather than swallowing them.
prisma.$on('error' as never, (e: unknown) => {
  console.error('[prisma] ', e);
});

/** Verifies the database is reachable, with a clear message when it is not. */
export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[prisma] Database connection established.');
  } catch (err) {
    console.error('[prisma] Cannot reach the database at the configured DATABASE_URL.');
    console.error('         In development, start the local database first:  npm run db:dev');
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export type { PrismaClient };

/**
 * A transaction handle. Every repository method accepts one of these so a
 * multi-table operation (customer + device + plan + installments) commits or
 * rolls back as a unit — something the old JSON store could not do at all.
 */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

export function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    // Financial writes must not interleave with a concurrent read-modify-write
    // on the same plan.
    isolationLevel: 'ReadCommitted',
    timeout: 15_000,
  });
}
