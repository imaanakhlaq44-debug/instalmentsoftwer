import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

/**
 * Secrets that were previously hardcoded in the source. If any of these ever
 * shows up in an environment file we refuse to boot — they are public knowledge.
 */
const KNOWN_LEAKED_SECRETS = [
  'emi-shield-secret-key-production-prototype-2026',
  'secret',
  'changeme',
  'jwt-secret',
];

function fail(message: string): never {
  console.error('\n[CONFIG ERROR] ' + message + '\n');
  process.exit(1);
}

function resolveJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim();

  if (isProduction) {
    if (!secret) {
      fail(
        'JWT_SECRET is not set. Production refuses to start without it.\n' +
          'Generate one with:\n' +
          '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
      );
    }
    if (secret.length < 32) {
      fail(`JWT_SECRET is too short (${secret.length} chars). Use at least 32 characters.`);
    }
    if (KNOWN_LEAKED_SECRETS.includes(secret.toLowerCase())) {
      fail('JWT_SECRET is a known/default value that has been published in source control. Generate a fresh one.');
    }
    return secret;
  }

  if (secret) return secret;

  // Development convenience: ephemeral secret, regenerated on every restart.
  // This intentionally invalidates old tokens so nobody builds on a fixed dev secret.
  const ephemeral = crypto.randomBytes(48).toString('hex');
  console.warn(
    '[config] JWT_SECRET not set — generated a temporary development secret.\n' +
      '         All existing sessions are invalid and will be again on next restart.\n' +
      '         Set JWT_SECRET in server/.env to keep sessions stable.'
  );
  return ephemeral;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function corsOrigins(): string[] {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  if (isProduction) {
    fail('CORS_ORIGINS is not set. Production requires an explicit allow-list of dashboard origins.');
  }
  return ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

function requireDatabaseUrl(): string {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) {
    fail(
      'DATABASE_URL is not set.\n' +
        '  Development: start the bundled PostgreSQL with  npm run db:dev\n' +
        '  Then set DATABASE_URL in server/.env (see .env.example).'
    );
  }
  return url;
}

const autoSeed = bool(process.env.AUTO_SEED, !isProduction);
if (isProduction && autoSeed) {
  fail('AUTO_SEED must be false in production. Demo data must never be written to a live database.');
}

export const config = {
  env: NODE_ENV,
  isProduction,
  isTest: NODE_ENV === 'test',
  port: num(process.env.PORT, 5000),

  jwt: {
    secret: resolveJwtSecret(),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  bcryptRounds: num(process.env.BCRYPT_ROUNDS, isProduction ? 12 : 10),

  corsOrigins: corsOrigins(),

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60_000,
    max: num(process.env.RATE_LIMIT_MAX, 500),
  },

  loginRateLimit: {
    windowMs: num(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15) * 60_000,
    max: num(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  },

  databaseUrl: requireDatabaseUrl(),

  /** Connection pool size. 1 for the PGlite dev server, which is single-connection. */
  dbPoolMax: num(process.env.DB_POOL_MAX, isProduction ? 20 : 1),

  autoSeed,
  seedDefaultPassword: process.env.SEED_DEFAULT_PASSWORD || 'ChangeMe#2026',

  /** Max JSON request body size — blocks trivial memory-exhaustion payloads. */
  bodyLimit: '256kb',
} as const;
