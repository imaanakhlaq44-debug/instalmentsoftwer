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

/**
 * The SMS aggregator account, if there is one.
 *
 * Everything here comes from the environment — credentials never live in the
 * repository or the database. A half-filled configuration is reported and
 * treated as "no aggregator" rather than stopping the server: reminders then
 * simply keep going through paired phones, as they did before.
 */
function resolveSms() {
  const env = (name: string) => (process.env[name] || '').trim();
  const requested = env('SMS_PROVIDER').toLowerCase();
  const phoneFormat = env('SMS_HTTP_PHONE_FORMAT').toLowerCase();

  const http = {
    url: env('SMS_HTTP_URL'),
    method: env('SMS_HTTP_METHOD').toUpperCase() === 'POST' ? ('POST' as const) : ('GET' as const),
    bodyFormat: env('SMS_HTTP_BODY_FORMAT').toLowerCase() === 'json' ? ('json' as const) : ('form' as const),
    username: env('SMS_HTTP_USERNAME'),
    password: env('SMS_HTTP_PASSWORD'),
    apiKey: env('SMS_HTTP_API_KEY'),
    senderMask: env('SMS_SENDER_MASK'),
    paramUsername: process.env.SMS_HTTP_PARAM_USERNAME?.trim() ?? 'username',
    paramPassword: process.env.SMS_HTTP_PARAM_PASSWORD?.trim() ?? 'password',
    paramApiKey: process.env.SMS_HTTP_PARAM_API_KEY?.trim() ?? 'api_key',
    paramSender: process.env.SMS_HTTP_PARAM_SENDER?.trim() ?? 'sender',
    paramTo: process.env.SMS_HTTP_PARAM_TO?.trim() || 'to',
    paramMessage: process.env.SMS_HTTP_PARAM_MESSAGE?.trim() || 'message',
    extraParams: env('SMS_HTTP_EXTRA_PARAMS'),
    unicodeParams: env('SMS_HTTP_UNICODE_PARAMS'),
    authHeader: env('SMS_HTTP_AUTH_HEADER'),
    phoneFormat:
      phoneFormat === 'plus' ? ('plus' as const) : phoneFormat === 'local' ? ('local' as const) : ('international' as const),
    successPattern: env('SMS_HTTP_SUCCESS_PATTERN'),
    failurePattern: env('SMS_HTTP_FAILURE_PATTERN'),
    messageIdPattern: env('SMS_HTTP_MESSAGE_ID_PATTERN'),
  };

  const twilio = {
    accountSid: env('TWILIO_ACCOUNT_SID'),
    authToken: env('TWILIO_AUTH_TOKEN'),
    from: env('TWILIO_FROM') || env('SMS_SENDER_MASK'),
    messagingServiceSid: env('TWILIO_MESSAGING_SERVICE_SID'),
  };

  let provider: 'none' | 'http' | 'twilio' = 'none';
  let problem = '';

  if (requested === 'http') {
    if (!/^https?:\/\//i.test(http.url)) problem = 'SMS_PROVIDER=http needs SMS_HTTP_URL (the gateway\'s send URL).';
    else provider = 'http';
  } else if (requested === 'twilio') {
    if (!twilio.accountSid || !twilio.authToken) problem = 'SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.';
    else if (!twilio.from && !twilio.messagingServiceSid) problem = 'SMS_PROVIDER=twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.';
    else provider = 'twilio';
  } else if (requested && requested !== 'none') {
    problem = `SMS_PROVIDER="${requested}" is not recognised. Use http, twilio or none.`;
  }

  if (problem) {
    console.warn(`[config] ${problem} The SMS aggregator stays OFF; paired phones keep working.`);
  }

  return {
    provider,
    http,
    twilio,
    /** How long one gateway call may take before it counts as a failure. */
    timeoutMs: num(process.env.SMS_TIMEOUT_MS, 10_000),
    /** Tries through the aggregator before a message is failed or handed to the phone. */
    maxAttempts: Math.min(num(process.env.SMS_MAX_ATTEMPTS, 4), 10),
    /** How often the worker looks at the queue. */
    pollSeconds: Math.max(num(process.env.SMS_POLL_SECONDS, 30), 5),
  };
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

  /** Shop sign-ups per address. Every request counts, successful or not. */
  signupRateLimit: {
    windowMs: num(process.env.SIGNUP_RATE_LIMIT_WINDOW_MINUTES, 60) * 60_000,
    max: num(process.env.SIGNUP_RATE_LIMIT_MAX, 5),
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

  /** The SMS aggregator account. `provider` is 'none' when there is not one. */
  sms: resolveSms(),

  /** Max JSON request body size — blocks trivial memory-exhaustion payloads. */
  bodyLimit: '256kb',

  /**
   * What goes into the enrollment QR the Android Device Policy Controller scans
   * during setup.
   *
   * `apkUrl` and `apkSignatureChecksum` are what make the QR a real Android
   * provisioning QR: the setup wizard downloads the DPC from that URL and
   * refuses to install it unless the signing certificate matches the checksum.
   * Without both, the phone has no app to become device owner and the QR can
   * only be used by a DPC that is already installed — see
   * `EnrollmentService.buildQrPayload`.
   */
  dpc: {
    serverUrl: (process.env.DPC_SERVER_URL || '').trim(),
    adminComponent:
      (process.env.DPC_ADMIN_COMPONENT || '').trim() ||
      'pk.almassdm.dpc/pk.almassdm.dpc.admin.AlmasDeviceAdminReceiver',
    apkUrl: (process.env.DPC_APK_URL || '').trim(),
    apkSignatureChecksum: (process.env.DPC_APK_SIGNATURE_CHECKSUM || '').trim(),
    /** Leaving system apps enabled keeps the phone a usable phone, not a kiosk terminal. */
    leaveSystemAppsEnabled: bool(process.env.DPC_LEAVE_SYSTEM_APPS_ENABLED, true),
    skipEncryption: bool(process.env.DPC_SKIP_ENCRYPTION, false),
  },

  /**
   * The contract PDF is printed by the system's Chromium (see
   * `ContractPdfService`). Leave unset to use the usual install locations.
   */
  pdf: {
    chromiumPath: (process.env.PDF_CHROMIUM_PATH || '').trim(),
  },
} as const;
