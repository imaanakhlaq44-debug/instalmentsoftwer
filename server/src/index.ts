import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { connectDatabase, disconnectDatabase } from './db/prisma.js';
import { repo } from './db/repositories/index.js';
import { seedPostgres } from './db/seedPostgres.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { startScheduler } from './services/Scheduler.js';

import { authRouter } from './routes/auth.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { devicesRouter } from './routes/devices.routes.js';
import { customersRouter } from './routes/customers.routes.js';
import { installmentsRouter } from './routes/installments.routes.js';
import { paymentsRouter } from './routes/payments.routes.js';
import { transactionsRouter } from './routes/transactions.routes.js';
import { enrollmentRouter } from './routes/enrollment.routes.js';
import { licensesRouter } from './routes/licenses.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { settingsRouter } from './routes/settings.routes.js';
import { simulatorRouter } from './routes/simulator.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { dpcRouter } from './routes/dpc.routes.js';
import { smsRelayRouter } from './routes/smsRelay.routes.js';
import { contractsRouter } from './routes/contracts.routes.js';

const app = express();

// Behind nginx/Heroku/Render the real client IP arrives in X-Forwarded-For.
// Rate limiting and audit logs are worthless without this.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.use(
  helmet({
    // The API serves JSON only; a restrictive CSP costs nothing here.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls carry no Origin header.
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      console.warn(`[security] Blocked CORS request from disallowed origin: ${origin}`);
      return callback(new Error('This origin is not allowed to access the EMI Shield API.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.', code: 'RATE_LIMITED' },
});

const authLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  max: config.loginRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed sign-in attempts count towards the limit
  message: {
    error: 'Too many sign-in attempts from this network. Please wait before trying again.',
    code: 'LOGIN_RATE_LIMITED',
  },
});

/**
 * The DPC fleet gets its own budget.
 *
 * A shop's handsets share one mobile network and often one NAT, so they arrive
 * from a handful of addresses. Under the dashboard's limit a busy dealership
 * would rate-limit its own phones out of enforcement. Enrollment stays tight,
 * because that route is unauthenticated and a redemption attempt is a guess at
 * a token.
 */
const dpcLimiter = rateLimit({
  windowMs: 60_000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many device requests. Slow down.', code: 'DPC_RATE_LIMITED' },
});

const dpcEnrollLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many enrollment attempts. Please wait before trying again.', code: 'DPC_ENROLL_RATE_LIMITED' },
});

app.use('/api', generalLimiter);

// ---------------------------------------------------------------------------
// Request logging (skipped during tests to keep output readable)
// ---------------------------------------------------------------------------
if (!config.isTest) {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      const actor = req.user ? `${req.user.role}:${req.user.userId}` : 'anonymous';
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms [${actor}]`;
      if (res.statusCode >= 500) console.error('[http]', line);
      else if (res.statusCode >= 400) console.warn('[http]', line);
      else console.log('[http]', line);
    });
    next();
  });
}

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'EMI Shield Backend API',
    version: '1.1.0',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});

// Auth router handles its own per-route protection: /login and /register-dealer
// are public, everything else inside it requires a session.
app.use('/api/auth', authLimiter, authRouter);

/**
 * The Device Policy Controller API.
 *
 * Mounted outside `requireAuth`: a handset authenticates with its own device
 * credential, not a staff session. Enrollment is the single public route, and
 * the enrollment token is what protects it.
 */
app.use('/api/dpc/enroll', dpcEnrollLimiter);
app.use('/api/dpc', dpcLimiter, dpcRouter);

/**
 * The SMS relay API — a phone the shop paired to send its messages.
 *
 * Outside `requireAuth` for the same reason as the DPC: the handset holds a
 * credential of its own and must never carry a staff token. It polls, so it
 * shares the DPC's limiter rather than the dashboard's.
 */
app.use('/api/sms-relay', dpcLimiter, smsRelayRouter);

// ---------------------------------------------------------------------------
// Protected routes — every single one requires a valid JWT
// ---------------------------------------------------------------------------
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/devices', requireAuth, devicesRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/installments', requireAuth, installmentsRouter);
app.use('/api/payments', requireAuth, paymentsRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/enrollment', requireAuth, enrollmentRouter);
app.use('/api/contracts', requireAuth, contractsRouter);
app.use('/api/licenses', requireAuth, licensesRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/audit-logs', requireAuth, auditRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/simulator', requireAuth, simulatorRouter);
app.use('/api/users', requireAuth, usersRouter);

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
/**
 * Verifies the database is reachable and, in development, loads the demo
 * dataset into an empty one.
 *
 * This is async and therefore runs before `listen` rather than at import time
 * as it used to — the server must not accept a request it cannot serve.
 */
async function prepareDatabase(): Promise<void> {
  await connectDatabase();

  if (config.autoSeed && (await repo.dealers.count()) === 0) {
    console.log('[startup] Database is empty — seeding the demo dataset.');
    await seedPostgres();
  }
}

export async function startServer() {
  await prepareDatabase();

  const server = app.listen(config.port, () => {
    console.log('====================================================');
    console.log(`  EMI Shield Server listening on port ${config.port}`);
    console.log(`  REST API base : http://localhost:${config.port}/api`);
    console.log(`  Environment   : ${config.env}`);
    console.log(`  CORS origins  : ${config.corsOrigins.join(', ')}`);
    console.log(`  Device service: MOCK_DPC`);
    console.log('====================================================');
  });

  const scheduler = startScheduler();

  const shutdown = (signal: string) => {
    console.log(`\n[shutdown] ${signal} received — closing gracefully.`);
    scheduler.stop();
    server.close(() => {
      void disconnectDatabase().finally(() => {
        console.log('[shutdown] Server closed and database connections released.');
        process.exit(0);
      });
    });
    // Do not hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] Unhandled promise rejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[fatal] Uncaught exception:', err);
    // Committed data is the database's problem now, not a file to flush.
    process.exit(1);
  });

  return server;
}

if (!config.isTest) {
  startServer().catch((err) => {
    console.error('[fatal] The server could not start:', err);
    process.exit(1);
  });
}

export { app };
