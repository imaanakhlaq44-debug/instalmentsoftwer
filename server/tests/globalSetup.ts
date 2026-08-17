/**
 * Brings up a real PostgreSQL for the test run.
 *
 * `embedded-postgres` ships the genuine PostgreSQL server binaries as an npm
 * package and runs them from a throwaway data directory — no installation, no
 * admin rights, no Docker. Tests therefore exercise the same server, planner,
 * constraints and transaction semantics as production.
 *
 * This replaced PGlite, which could not be trusted here: against PGlite's
 * socket server, the query following any Prisma interactive transaction — even
 * one that committed — came back desynchronised by one protocol message and
 * failed. Transactions are the point of this migration, so the database under
 * test has to handle them.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import EmbeddedPostgres from 'embedded-postgres';
import pgDriver from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, '..', 'prisma', 'migrations');

/** Private to the test run; 5433 belongs to the developer's own database. */
export const TEST_PG_PORT = Number(process.env.TEST_PG_PORT || 5434);

const USER = 'postgres';
const PASSWORD = 'postgres';
const DATABASE = 'emishield_test';

/** The URL the test processes connect with; `tests/setup.ts` builds the same one. */
export const TEST_DATABASE_URL =
  `postgresql://${USER}:${PASSWORD}@127.0.0.1:${TEST_PG_PORT}/${DATABASE}`;

let postgres: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

/** Applies every migration's SQL in version order, as `prisma migrate deploy` would. */
async function applyMigrations(client: { query(sql: string): Promise<unknown> }): Promise<void> {
  const versions = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (versions.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR}.`);
  }

  for (const version of versions) {
    const file = path.join(MIGRATIONS_DIR, version, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    await client.query(fs.readFileSync(file, 'utf-8'));
  }
}

export async function setup(): Promise<void> {
  // Keep the data directory off OneDrive: a synced folder holding a running
  // Postgres data directory is a reliable way to corrupt it.
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emishield-pg-'));

  postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: TEST_PG_PORT,
    persistent: false,
    // Matches scripts/pg-server.ts. initdb otherwise inherits the host locale,
    // which on Windows means WIN1252 — an encoding that cannot hold an Urdu
    // customer name, so the tests would pass on a database unlike production's.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // initdb and the server are chatty on startup and shutdown; that output
    // buries the test results. Real failures still surface as thrown errors.
    onLog: () => undefined,
    onError: () => undefined,
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE);

  // A client built from the URL, rather than the one the library hands back:
  // that one is bound to the default database, and the migrations belong in
  // the test database.
  const client = new pgDriver.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await applyMigrations(client);
  } finally {
    await client.end();
  }
}

export async function teardown(): Promise<void> {
  try {
    // `persistent: false` makes the library remove the data directory itself.
    // On Windows the postgres child processes can still hold a handle on it for
    // a moment after shutdown, and the rmdir then fails with EBUSY.
    await postgres?.stop();
  } catch {
    // Nothing here can fail the run: the server is going away with the process,
    // and the data directory is under the OS temp dir either way.
  }

  if (dataDir && fs.existsSync(dataDir)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}
