import cron from 'node-cron';
import { OverdueEngine } from './OverdueEngine.js';
import { SmsAggregatorService } from './SmsAggregatorService.js';
import { repo } from '../db/repositories/index.js';
import { config } from '../config.js';

export interface SchedulerHandle {
  stop(): void;
  /** Runs every scheduled job once, immediately. Used by tests and manual triggers. */
  runAllNow(): Promise<void>;
}

/**
 * Background jobs.
 *
 * Before this existed the overdue engine only ran when somebody happened to
 * click a button in the dashboard — meaning a shop that did not log in for a
 * week never flagged a single late payment.
 */

/** 00:30 every day, Pakistan Standard Time. */
const OVERDUE_CRON = '30 0 * * *';
/** Hourly cleanup of expired enrollment QR tokens. */
const TOKEN_CLEANUP_CRON = '5 * * * *';

const TIMEZONE = 'Asia/Karachi';

async function runOverdueEvaluation(): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await OverdueEngine.runEvaluation();
    console.log(
      `[scheduler] Overdue evaluation finished in ${Date.now() - startedAt}ms — ` +
        `evaluated ${result.evaluatedCount}, newly overdue ${result.newlyOverdueCount}, ` +
        `auto-locked ${result.devicesLockedCount}, flagged ${result.devicesFlaggedCount}, ` +
        `notifications ${result.notificationsQueued}.`
    );
  } catch (err) {
    // A failed nightly job must never take the server down.
    console.error('[scheduler] Overdue evaluation failed:', err);
  }
}

async function expireStaleTokens(): Promise<void> {
  try {
    // One UPDATE with the predicate in the WHERE clause, instead of loading
    // every token and updating the stale ones row by row.
    const expired = await repo.enrollmentTokens.expireStale(new Date());

    if (expired > 0) {
      console.log(`[scheduler] Expired ${expired} stale enrollment token(s).`);
    }
  } catch (err) {
    console.error('[scheduler] Token cleanup failed:', err);
  }
}

/**
 * Sends waiting SMS through the aggregator. A no-op on a server with no
 * aggregator account, so it costs nothing where only paired phones are used.
 */
async function drainSmsQueue(): Promise<void> {
  try {
    const r = await SmsAggregatorService.drainOnce();
    if (r.claimed > 0) {
      console.log(
        `[scheduler] SMS aggregator: sent ${r.sent}, retrying ${r.retried}, failed ${r.failed}, ` +
          `handed to paired phone ${r.handedToPhone}.`
      );
    }
  } catch (err) {
    console.error('[scheduler] SMS aggregator pass failed:', err);
  }
}

export function startScheduler(): SchedulerHandle {
  if (config.isTest) {
    return { stop: () => {}, runAllNow: async () => {} };
  }

  const overdueJob = cron.schedule(OVERDUE_CRON, runOverdueEvaluation, { timezone: TIMEZONE });
  const cleanupJob = cron.schedule(TOKEN_CLEANUP_CRON, () => void expireStaleTokens(), { timezone: TIMEZONE });

  console.log(`[scheduler] Overdue evaluation scheduled at "${OVERDUE_CRON}" (${TIMEZONE}).`);
  console.log(`[scheduler] Enrollment token cleanup scheduled at "${TOKEN_CLEANUP_CRON}" (${TIMEZONE}).`);

  const aggregator = SmsAggregatorService.describe();
  const smsTimer = aggregator.configured
    ? setInterval(() => void drainSmsQueue(), config.sms.pollSeconds * 1000)
    : undefined;
  smsTimer?.unref();
  console.log(
    aggregator.configured
      ? `[scheduler] SMS aggregator "${aggregator.provider}" draining the queue every ${config.sms.pollSeconds}s` +
          (aggregator.senderMask ? ` as "${aggregator.senderMask}".` : '.')
      : '[scheduler] No SMS aggregator configured — reminders go through paired phones only.'
  );

  // Catch up on anything missed while the server was down, without blocking boot.
  setTimeout(() => {
    void expireStaleTokens();
    void runOverdueEvaluation();
  }, 5_000).unref();

  return {
    stop() {
      overdueJob.stop();
      cleanupJob.stop();
      if (smsTimer) clearInterval(smsTimer);
      console.log('[scheduler] Background jobs stopped.');
    },
    async runAllNow() {
      await expireStaleTokens();
      await runOverdueEvaluation();
      await drainSmsQueue();
    },
  };
}
