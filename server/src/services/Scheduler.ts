import cron from 'node-cron';
import { OverdueEngine } from './OverdueEngine.js';
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

export function startScheduler(): SchedulerHandle {
  if (config.isTest) {
    return { stop: () => {}, runAllNow: async () => {} };
  }

  const overdueJob = cron.schedule(OVERDUE_CRON, runOverdueEvaluation, { timezone: TIMEZONE });
  const cleanupJob = cron.schedule(TOKEN_CLEANUP_CRON, () => void expireStaleTokens(), { timezone: TIMEZONE });

  console.log(`[scheduler] Overdue evaluation scheduled at "${OVERDUE_CRON}" (${TIMEZONE}).`);
  console.log(`[scheduler] Enrollment token cleanup scheduled at "${TOKEN_CLEANUP_CRON}" (${TIMEZONE}).`);

  // Catch up on anything missed while the server was down, without blocking boot.
  setTimeout(() => {
    void expireStaleTokens();
    void runOverdueEvaluation();
  }, 5_000).unref();

  return {
    stop() {
      overdueJob.stop();
      cleanupJob.stop();
      console.log('[scheduler] Background jobs stopped.');
    },
    async runAllNow() {
      await expireStaleTokens();
      await runOverdueEvaluation();
    },
  };
}
