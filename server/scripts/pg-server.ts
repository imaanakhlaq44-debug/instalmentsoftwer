/**
 * Local PostgreSQL for development, with nothing to install.
 *
 * `embedded-postgres` ships the genuine PostgreSQL server binaries as an npm
 * package and runs them as an ordinary user process — no installer, no admin
 * rights, no Docker, no service registration. Prisma, psql and anything else
 * connect with a normal postgresql:// URL.
 *
 * This replaced PGlite (PostgreSQL compiled to WebAssembly). PGlite was lighter
 * but could not run Prisma's interactive transactions: the query after any
 * transaction — including one that committed — came back desynchronised by a
 * protocol message and failed. Payment allocation depends on real transactions,
 * so the development database has to provide them.
 *
 *   npm run db:dev        # start it (leave it running)
 *   npm run db:deploy     # apply migrations
 *
 * Production points DATABASE_URL at a managed PostgreSQL server instead; no
 * application code changes.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Deliberately outside the project directory.
 *
 * The repository lives under OneDrive, and a cloud-synced folder holding a live
 * PostgreSQL data directory is a reliable way to corrupt it — sync rewrites
 * files underneath a running server. Override with EMISHIELD_PGDATA if needed.
 */
const DATA_DIR =
  process.env.EMISHIELD_PGDATA || path.join(os.homedir(), '.emishield', 'pgdata');

const PORT = Number(process.env.PGPORT || 5433);
const USER = process.env.PGUSER || 'postgres';
const PASSWORD = process.env.PGPASSWORD || 'postgres';
const DATABASE = process.env.PGDATABASE || 'emishield';

async function main() {
  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));

  const postgres = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    /**
     * Without this, initdb takes the encoding from the host locale — on a
     * Windows machine that is WIN1252, which cannot store an Urdu customer
     * name at all. C collation keeps ordering identical on every developer's
     * machine regardless of their regional settings.
     */
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (!alreadyInitialised) {
    console.log(`[postgres] First run — initialising a new cluster at ${DATA_DIR}`);
    fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
    await postgres.initialise();
  }

  await postgres.start();

  if (!alreadyInitialised) {
    await postgres.createDatabase(DATABASE);
    console.log(`[postgres] Created database "${DATABASE}".`);
  }

  const url = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}`;

  console.log('====================================================');
  console.log(`  PostgreSQL listening on port ${PORT}`);
  console.log(`  DATABASE_URL=${url}`);
  console.log(`  Data directory: ${DATA_DIR}`);
  console.log('====================================================');
  console.log('  Leave this running. In another terminal:');
  console.log('    npm run db:deploy    # apply migrations');
  console.log('    npm run dev          # start the API');

  const shutdown = async (signal: string) => {
    console.log(`\n[postgres] ${signal} received — shutting down.`);
    try {
      await postgres.stop();
    } catch (err) {
      console.error('[postgres] Shutdown reported an error:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[postgres] Failed to start:', err);
  process.exit(1);
});
