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
    // Keep database timestamp comparisons independent of the server/session timezone.
    options: '-c timezone=UTC',
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

/** Advisory-lock namespaces (first int of the two-int form). */
const GLOBAL_LOCK_SPACE = 167026;
const SHOP_LOCK_SPACE = 167027;

/**
 * Runs `fn` in a transaction serialised against conflicting writers.
 *
 * Every multi-record mutation takes an advisory lock before it reads anything,
 * so no worker acts on a stale financial snapshot.
 *
 * - With no `dealerId` it takes the **global** lock exclusively: it waits for,
 *   and blocks, every other transaction on every shop. Use this for anything
 *   that spans shops or platform-wide state.
 * - With a `dealerId` it takes the global lock **shared** plus that shop's own
 *   lock exclusively. Two shops' writes no longer wait on each other; writes in
 *   the same shop still run one at a time, and a global writer still excludes
 *   everybody. Only pass a `dealerId` when everything the transaction changes
 *   belongs to that one shop (shop-wide uniqueness such as IMEI is still held
 *   by database constraints).
 *
 * The shop key is `hashtext(dealerId)`. Two shops whose ids collide just share
 * a lock — slower, never wrong.
 */
export function runInTransaction<T>(fn: (tx: Tx) => Promise<T>, opts: { dealerId?: string } = {}): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (opts.dealerId) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(${GLOBAL_LOCK_SPACE}::int, 1)::text`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SHOP_LOCK_SPACE}::int, hashtext(${opts.dealerId}))::text`;
    } else {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${GLOBAL_LOCK_SPACE}::int, 1)::text`;
    }
    return fn(tx);
  }, {
    // Financial writes must not interleave with a concurrent read-modify-write
    // on the same plan.
    isolationLevel: 'ReadCommitted',
    timeout: 15_000,
  });
}

/** `runInTransaction` holding one shop's lock only. See the rules there. */
export function runInShopTransaction<T>(dealerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!dealerId) throw new Error('runInShopTransaction needs a dealerId.');
  return runInTransaction(fn, { dealerId });
}

