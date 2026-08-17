/**
 * Runs before any test file is imported, and therefore before `config.ts` and
 * `db.ts` capture their values. Everything here has to be set at this point —
 * both modules read `process.env` exactly once, at import time.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emishield-test-'));

process.env.NODE_ENV = 'test';

// Keep the suite away from server/data/store.json — the real records live there.
process.env.DATA_DIR = dataDir;

// Fixed secret so a token minted in one test is still valid in the next.
process.env.JWT_SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef';

// The tests seed explicitly; booting the app must not do it for them.
process.env.AUTO_SEED = 'false';

process.env.SEED_DEFAULT_PASSWORD = 'Emishield#2026';

// Rate limits exist to be tested deliberately, not to trip a hundred fixtures.
process.env.RATE_LIMIT_MAX = '100000';
process.env.LOGIN_RATE_LIMIT_MAX = '100000';

// bcrypt cost dominates the runtime of every login. 4 is the minimum and keeps
// the suite in seconds rather than minutes; it is a test-only value.
process.env.BCRYPT_ROUNDS = '4';

// The throwaway PostgreSQL started by tests/globalSetup.ts. Note the port:
// 5433 is the developer's own database and must not be touched by a test run.
const port = process.env.TEST_PG_PORT || '5434';
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/emishield_test`;

// A real server, so a real pool — an interactive transaction holds one
// connection while other queries use another, exactly as in production.
process.env.DB_POOL_MAX = '5';

process.on('exit', () => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a run over.
  }
});
